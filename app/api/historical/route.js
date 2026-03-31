import { NextResponse } from 'next/server'

export const runtime = 'edge'

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
  // Map interval
  const yfInterval = interval === '4h' ? '60m' : interval

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${yfInterval}&range=${range}&includePrePost=false&events=div%2Csplit`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
    next: { revalidate: 300 }
  })

  if (!response.ok) {
    throw new Error(`Yahoo Finance chart error: ${response.status}`)
  }

  const data = await response.json()
  const result = data?.chart?.result?.[0]

  if (!result) {
    throw new Error('No data returned for symbol: ' + symbol)
  }

  const timestamps = result.timestamp || []
  const ohlcv = result.indicators?.quote?.[0] || {}
  const { open = [], high = [], low = [], close = [], volume = [] } = ohlcv

  const candles = []
  for (let i = 0; i < timestamps.length; i++) {
    if (close[i] == null) continue
    candles.push({
      time: timestamps[i],
      open: open[i] || close[i],
      high: high[i] || close[i],
      low: low[i] || close[i],
      close: close[i],
      volume: volume[i] || 0,
    })
  }

  return NextResponse.json({
    symbol,
    interval,
    range,
    candles,
    meta: {
      currency: result.meta?.currency || 'INR',
      exchangeName: result.meta?.exchangeName,
      regularMarketPrice: result.meta?.regularMarketPrice,
    }
  })
}

async function getCryptoHistory(coinId, interval, range) {
  // CoinGecko uses days
  const daysMap = {
    '1d': '365', '1wk': 'max', '60m': '90', '15m': '30', '5m': '7', '1m': '1'
  }
  const days = daysMap[interval] || '365'
  const cgInterval = interval === '1d' || interval === '1wk' ? 'daily' : 'hourly'

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
