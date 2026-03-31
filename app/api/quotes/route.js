import { NextResponse } from 'next/server'

export const runtime = 'edge'
export const revalidate = 30  // 30s cache

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') || 'indian'
  const symbols = searchParams.get('symbols')

  try {
    if (type === 'crypto') {
      return await getCryptoQuotes(symbols)
    } else {
      return await getStockQuotes(symbols, type)
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

async function getStockQuotes(symbolsParam, type) {
  const defaultSymbols = type === 'indian'
    ? 'RELIANCE.NS,TCS.NS,HDFCBANK.NS,INFY.NS,HINDUNILVR.NS,ICICIBANK.NS,KOTAKBANK.NS,SBIN.NS,BHARTIARTL.NS,ITC.NS,AXISBANK.NS,LT.NS,ASIANPAINT.NS,MARUTI.NS,BAJFINANCE.NS,SUNPHARMA.NS,TITAN.NS,WIPRO.NS,ULTRACEMCO.NS,TECHM.NS,BAJAJFINSV.NS,HCLTECH.NS,NESTLEIND.NS,POWERGRID.NS,NTPC.NS,TATAMOTORS.NS,HDFCLIFE.NS,SBILIFE.NS,GRASIM.NS,BPCL.NS,DIVISLAB.NS,CIPLA.NS,EICHERMOT.NS,ONGC.NS,TATACONSUM.NS,HEROMOTOCO.NS,DRREDDY.NS,ADANIPORTS.NS,JSWSTEEL.NS,COALINDIA.NS,BRITANNIA.NS,HINDALCO.NS,INDUSINDBK.NS,APOLLOHOSP.NS,UPL.NS,SHRIRAMFIN.NS,BAJAJ-AUTO.NS,TRENT.NS,M%26M.NS,TATASTEEL.NS'
    : symbolsParam || 'AAPL,MSFT,GOOGL,AMZN,NVDA,META,TSLA,NFLX,AMD,INTC'

  const symbols = symbolsParam || defaultSymbols

  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,regularMarketVolume,marketCap,regularMarketPreviousClose,shortName,longName`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
    next: { revalidate: 30 }
  })

  if (!response.ok) {
    throw new Error(`Yahoo Finance error: ${response.status}`)
  }

  const data = await response.json()
  const quotes = data?.quoteResponse?.result || []

  const formatted = quotes.map(q => ({
    symbol: q.symbol,
    name: q.shortName || q.longName || q.symbol,
    price: q.regularMarketPrice ?? 0,
    change: q.regularMarketChange ?? 0,
    changePct: q.regularMarketChangePercent ?? 0,
    open: q.regularMarketOpen ?? 0,
    high: q.regularMarketDayHigh ?? 0,
    low: q.regularMarketDayLow ?? 0,
    volume: q.regularMarketVolume ?? 0,
    prevClose: q.regularMarketPreviousClose ?? 0,
    marketCap: q.marketCap ?? 0,
    currency: q.currency || 'INR',
    market: type,
  }))

  return NextResponse.json({ quotes: formatted, updatedAt: Date.now() })
}

async function getCryptoQuotes(symbolsParam) {
  const ids = symbolsParam ||
    'bitcoin,ethereum,binancecoin,ripple,solana,dogecoin,cardano,avalanche-2,polkadot,tron,shiba-inu,chainlink,litecoin,near,uniswap,internet-computer,cosmos,monero,stellar,okb'

  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=inr&ids=${ids}&order=market_cap_desc&per_page=50&page=1&sparkline=false&price_change_percentage=24h`

  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    next: { revalidate: 30 }
  })

  if (!response.ok) {
    throw new Error(`CoinGecko error: ${response.status}`)
  }

  const coins = await response.json()

  const formatted = coins.map(c => ({
    symbol: c.symbol?.toUpperCase() + '/INR',
    id: c.id,
    name: c.name,
    image: c.image,
    price: c.current_price ?? 0,
    change: c.price_change_24h ?? 0,
    changePct: c.price_change_percentage_24h ?? 0,
    high: c.high_24h ?? 0,
    low: c.low_24h ?? 0,
    volume: c.total_volume ?? 0,
    marketCap: c.market_cap ?? 0,
    rank: c.market_cap_rank ?? 0,
    currency: 'INR',
    market: 'crypto',
  }))

  return NextResponse.json({ quotes: formatted, updatedAt: Date.now() })
}
