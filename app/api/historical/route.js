import { NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'

// v3 requires instantiation — calling methods on the class directly throws
// "Call `const yahooFinance = new YahooFinance()` first"
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] })

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
      const res = await fetch(url, { headers: { 'Accept': 'application/json' }, next: { revalidate: 300 } })
      if (!res.ok) throw new Error('CoinGecko OHLC error')
      const raw = await res.json()
      const candles = raw.map(([time, open, high, low, close]) => ({
        time: Math.floor(time / 1000), open, high, low, close, volume: 0,
      }))
      return NextResponse.json({ symbol, interval, range, candles, meta: { currency: 'INR' } })
    }

    const result = await yf.chart(symbol, { interval, range })

    const quotes = result?.quotes || []
    const candles = quotes
      .filter(q => q.close != null)
      .map(q => ({
        time: Math.floor(new Date(q.date).getTime() / 1000),
        open: q.open ?? q.close,
        high: q.high ?? q.close,
        low: q.low ?? q.close,
        close: q.close,
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
