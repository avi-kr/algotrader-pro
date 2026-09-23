import { NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'
import { TOP_CRYPTO } from '@/lib/constants'

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] })

// Convert range string to a period1 start date
function rangeToPeriod1(range) {
  const now = new Date()
  const map = {
    '3mo': () => { const d = new Date(now); d.setMonth(d.getMonth() - 3); return d },
    '6mo': () => { const d = new Date(now); d.setMonth(d.getMonth() - 6); return d },
    '1y':  () => { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return d },
    '2y':  () => { const d = new Date(now); d.setFullYear(d.getFullYear() - 2); return d },
    '5y':  () => { const d = new Date(now); d.setFullYear(d.getFullYear() - 5); return d },
    'max': () => new Date('2000-01-01'),
  }
  return (map[range] || map['1y'])()
}

// Map frontend interval values to valid yahoo-finance2 intervals
function mapInterval(interval) {
  const map = {
    '1m': '1m', '5m': '5m', '15m': '15m',
    '60m': '60m', '1h': '60m', '4h': '60m',
    '1d': '1d', '1wk': '1wk', '1mo': '1mo',
  }
  return map[interval] || '1d'
}

// The frontend sends crypto symbols as Binance-style tickers (e.g. BTCUSDT);
// map those back to Coinbase Exchange product IDs (e.g. BTC-USD).
const SYMBOL_TO_COINBASE_PRODUCT = Object.fromEntries(
  TOP_CRYPTO.map(c => [`${c.symbol}USDT`, `${c.symbol}-USD`])
)

// Coinbase Exchange's public candles endpoint only offers these granularities
// (seconds). There's no native 4h or 1w — those are built by aggregating 1h
// and 1d candles respectively, using *real* OHLCV from the underlying bars
// (true high/low/volume across the group), not a single degenerate point.
const COINBASE_GRANULARITY_SEC = {
  '1m': 60, '5m': 300, '15m': 900,
  '60m': 3600, '1h': 3600, '4h': 3600,
  '1d': 86400, '1wk': 86400,
}
const COINBASE_AGGREGATE_GROUP = { '4h': 4, '1wk': 7 }

// Each request is capped at 300 candles by Coinbase, and finer granularities
// over a long lookback would mean a very large number of paginated calls —
// clamp those so a single request finishes well inside a serverless function
// timeout. Daily/weekly (cheap: ~7 calls even for 5 years) use the full
// requested range instead.
const INTRADAY_LOOKBACK_DAYS = { '1m': 1, '5m': 3, '15m': 7, '60m': 60, '1h': 60, '4h': 90 }

const COINBASE_MAX_CANDLES_PER_REQUEST = 300

async function fetchCoinbaseCandles(productId, granularitySec, startSec, endSec) {
  const candles = []
  let windowEnd = endSec

  // Coinbase returns candles newest-first for a window and rejects windows
  // spanning more than 300 buckets — page backwards from `end` toward `start`.
  while (windowEnd > startSec) {
    const windowStart = Math.max(startSec, windowEnd - (COINBASE_MAX_CANDLES_PER_REQUEST - 1) * granularitySec)
    const url = new URL(`https://api.exchange.coinbase.com/products/${productId}/candles`)
    url.searchParams.set('start', new Date(windowStart * 1000).toISOString())
    url.searchParams.set('end', new Date(windowEnd * 1000).toISOString())
    url.searchParams.set('granularity', String(granularitySec))

    const res = await fetch(url)
    if (!res.ok) throw new Error(`Coinbase candles error (${res.status})`)
    const rows = await res.json()
    if (!Array.isArray(rows)) throw new Error('Coinbase candles returned an unexpected response')

    // Coinbase row shape is [time, low, high, open, close, volume] — note
    // low/high come *before* open/close, unlike most OHLC APIs.
    for (const [time, low, high, open, close, volume] of rows) {
      candles.push({ time, open, high, low, close, volume })
    }
    if (rows.length === 0) break
    windowEnd = windowStart - granularitySec
  }

  candles.sort((a, b) => a.time - b.time)
  const seen = new Set()
  return candles.filter(c => (seen.has(c.time) ? false : (seen.add(c.time), true)))
}

// Combine `groupSize` consecutive candles into one, using real aggregated
// OHLCV (true high/low across the group, summed volume) rather than a
// synthetic single-point bar.
function aggregateCandles(candles, groupSize) {
  const out = []
  for (let i = 0; i < candles.length; i += groupSize) {
    const group = candles.slice(i, i + groupSize)
    if (group.length === 0) continue
    out.push({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map(c => c.high)),
      low: Math.min(...group.map(c => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    })
  }
  return out
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')
  const interval = searchParams.get('interval') || '1d'
  const range = searchParams.get('range') || '1y'
  const market = searchParams.get('market') || 'indian'

  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })

  try {
    if (market === 'crypto') {
      // Binance's public API returns HTTP 451 ("Unavailable For Legal
      // Reasons") for requests from the United States — and Vercel's build
      // region here is Washington, D.C., so every server-side call was
      // geo-blocked. Coinbase Exchange is a US-based, US-compliant venue
      // with a public, unauthenticated candles endpoint that isn't blocked
      // for US-origin traffic, and — unlike CoinGecko's free-tier
      // market_chart endpoint — returns genuine per-candle OHLC *and* real
      // traded volume, which Strategy 4's VWAP calculation actually needs.
      const productId = SYMBOL_TO_COINBASE_PRODUCT[symbol]
      if (!productId) {
        throw new Error(`${symbol} isn't listed on Coinbase; crypto backtests are limited to coins traded there`)
      }

      const nowSec = Math.floor(Date.now() / 1000)
      const clampDays = INTRADAY_LOOKBACK_DAYS[interval]
      const fromSec = clampDays
        ? nowSec - clampDays * 24 * 60 * 60
        : Math.floor(rangeToPeriod1(range).getTime() / 1000)

      const aggregateGroup = COINBASE_AGGREGATE_GROUP[interval]
      const granularitySec = COINBASE_GRANULARITY_SEC[interval] || 86400

      const raw = await fetchCoinbaseCandles(productId, granularitySec, fromSec, nowSec)
      const candles = aggregateGroup ? aggregateCandles(raw, aggregateGroup) : raw

      return NextResponse.json({ symbol, interval, range, candles, meta: { currency: 'USD' } })
    }

    // Intraday intervals have Yahoo-imposed max lookback limits
    const intradayIntervals = ['1m', '5m', '15m', '60m', '4h']
    let period1Date
    if (intradayIntervals.includes(interval)) {
      const maxDays = { '1m': 7, '5m': 30, '15m': 60, '60m': 60, '4h': 60 }
      const days = maxDays[interval] || 60
      period1Date = new Date()
      period1Date.setDate(period1Date.getDate() - days)
    } else {
      period1Date = rangeToPeriod1(range)
    }
    const period1 = period1Date.toISOString().split('T')[0]  // "YYYY-MM-DD"
    const yfInterval = mapInterval(interval)

    const result = await yf.chart(symbol, { interval: yfInterval, period1 })

    const quotes = result?.quotes || []
    const candles = quotes
      .filter(q => q.close != null)
      .map(q => ({
        time: Math.floor(new Date(q.date).getTime() / 1000),
        open:   q.open   ?? q.close,
        high:   q.high   ?? q.close,
        low:    q.low    ?? q.close,
        close:  q.close,
        volume: q.volume ?? 0,
      }))

    return NextResponse.json({
      symbol, interval, range, candles,
      meta: { currency: result?.meta?.currency || 'INR' }
    })
  } catch (err) {
    console.error('historical error:', err.message)
    return NextResponse.json({ error: err.message, candles: [] }, { status: 500 })
  }
}
