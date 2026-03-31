import { NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] })

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')
  const interval = searchParams.get('interval') || '1d'
  const range = searchParams.get('range') || '1y'
  const market = searchParams.get('market') || 'indian'

  if (!symbol) {
    return NextResponse.json({ error: 'Symbol required' }, { status: 400 })
  }

  try {
    if (market === 'crypto') {
      return await getCryptoHistory(symbol, interval, range)
    }
    return await getStockHistory(symbol, interval, range)
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

async function getStockHistory(symbol, interval, range) {
  // yahoo-finance2 chart interval: 4h not supported, map to 60m
  const yfInterval = interval === '4h' ? '60m' : interval

  const result = await yf.chart(symbol, {
    interval: yfInterval,
    range,
    includePrePost: false,
  })

  const quotes = result?.quotes || []

  const candles = quotes
    .filter(q => q.close != null)
    .map(q => ({
      time: Math.floor(new Date(q.date).getTime() / 1000),
      open: q.open || q.close,
      high: q.high || q.close,
      low: q.low || q.close,
      close: q.close,
      volume: q.volume || 0,
    }))

  return NextResponse.json({
    symbol,
    interval,
    range,
    candles,
    meta: {
      currency: result?.meta?.currency || 'INR',
      exchangeName: result?.meta?.exchangeName,
      regularMarketPrice: result?.meta?.regularMarketPrice,
    }
  })
}

async function getCryptoHistory(coinId, interval, range) {
  const daysMap = {
    '1d': '365', '1wk': 'max', '60m': '90', '15m': '30', '5m': '7', '1m': '1'
  }
  const days = daysMap[interval] || '365'

  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=inr&days=${days}`

  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    next: { revalidate: 300 }
  })

  if (!response.ok) {
    throw new Error(`CoinGecko OHLC error: ${response.status}`)
  }

  const raw = await response.json()

  const candles = raw.map(([time, open, high, low, close]) => ({
    time: Math.floor(time / 1000),
    open, high, low, close,
    volume: 0,
  }))

  return NextResponse.json({
    symbol: coinId,
    interval,
    range,
    candles,
    meta: { currency: 'INR' }
  })
}
