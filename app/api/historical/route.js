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

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')
  const interval = searchParams.get('interval') || '1d'
  const range = searchParams.get('range') || '1y'
  const market = searchParams.get('market') || 'indian'

  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })

  try {
    if (market === 'crypto') {
      const daysMap = { '1d': 365, '1wk': 730, '60m': 90, '15m': 30, '5m': 7, '1m': 1 }
      const days = daysMap[interval] || 365
      const url = `https://api.coingecko.com/api/v3/coins/${symbol}/ohlc?vs_currency=inr&days=${days}`
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
      if (!res.ok) throw new Error('CoinGecko OHLC error')
      const raw = await res.json()
      const candles = raw.map(([time, open, high, low, close]) => ({
        time: Math.floor(time / 1000), open, high, low, close, volume: 0,
      }))
      return NextResponse.json({ symbol, interval, range, candles, meta: { currency: 'INR' } })
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
