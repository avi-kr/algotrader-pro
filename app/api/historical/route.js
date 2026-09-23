import { NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'

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

// Binance's own interval strings, plus how far back it's reasonable to
// paginate for each one (Binance has no fixed lookback limit like Yahoo/
// CoinGecko, but a 1-minute request over years of history would mean
// thousands of paginated calls in a single request — clamp the very fine
// granularities, let daily/weekly honor the full requested range).
const BINANCE_INTERVAL_MAP = {
  '1m': '1m', '5m': '5m', '15m': '15m',
  '60m': '1h', '1h': '1h', '4h': '4h',
  '1d': '1d', '1wk': '1w',
}
const BINANCE_MAX_LOOKBACK_DAYS = {
  '1m': 7, '5m': 30, '15m': 60, '60m': 180, '1h': 180, '4h': 730,
}

async function fetchBinanceKlines(symbol, interval, fromMs, toMs) {
  const binanceInterval = BINANCE_INTERVAL_MAP[interval] || '1d'
  const candles = []
  let cursor = fromMs

  // Binance caps each response at 1000 candles — page forward using each
  // batch's own last close time so this covers the full requested range
  // regardless of how many candles that is.
  while (cursor < toMs) {
    const url = new URL('https://api.binance.com/api/v3/klines')
    url.searchParams.set('symbol', symbol)
    url.searchParams.set('interval', binanceInterval)
    url.searchParams.set('startTime', String(cursor))
    url.searchParams.set('endTime', String(toMs))
    url.searchParams.set('limit', '1000')

    const res = await fetch(url)
    if (!res.ok) throw new Error(`Binance klines error (${res.status})`)
    const rows = await res.json()
    if (!Array.isArray(rows) || rows.length === 0) break

    for (const row of rows) {
      candles.push({
        time: Math.floor(row[0] / 1000),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      })
    }

    const lastCloseTime = rows[rows.length - 1][6]
    if (lastCloseTime <= cursor) break // guard against a malformed/stuck response
    cursor = lastCloseTime + 1
  }

  return candles
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
      // Binance's public klines endpoint (no API key needed) gives real
      // OHLCV at the actually-requested granularity over the actually-
      // requested range. The previous CoinGecko /ohlc endpoint silently
      // ignored `range` entirely and auto-degrades candle granularity for
      // large `days` values (365 days there returns ~91 FOUR-DAY candles
      // mislabeled as daily) — that's what was capping every crypto
      // backtest at ~92 candles regardless of the range picked in the UI.
      const now = Date.now()
      const toMs = now
      let fromMs
      const clampDays = BINANCE_MAX_LOOKBACK_DAYS[interval]
      if (clampDays) {
        fromMs = now - clampDays * 24 * 60 * 60 * 1000
      } else {
        const period1Date = rangeToPeriod1(range)
        fromMs = period1Date.getTime()
      }

      const candles = await fetchBinanceKlines(symbol, interval, fromMs, toMs)
      // Binance quotes against USDT, not INR — meta.currency reflects that
      // even though some UI labels still show a ₹ prefix (a pre-existing
      // cosmetic mismatch, not something this fix changes the meaning of).
      return NextResponse.json({ symbol, interval, range, candles, meta: { currency: 'USDT' } })
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
