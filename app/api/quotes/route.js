import { NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'

// v3 requires instantiation — calling methods on the class directly throws
// "Call `const yahooFinance = new YahooFinance()` first"
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] })

const NIFTY50_SYMBOLS = [
  'RELIANCE.NS','TCS.NS','HDFCBANK.NS','INFY.NS','HINDUNILVR.NS',
  'ICICIBANK.NS','KOTAKBANK.NS','SBIN.NS','BHARTIARTL.NS','ITC.NS',
  'AXISBANK.NS','LT.NS','ASIANPAINT.NS','MARUTI.NS','BAJFINANCE.NS',
  'SUNPHARMA.NS','TITAN.NS','WIPRO.NS','ULTRACEMCO.NS','TECHM.NS',
  'BAJAJFINSV.NS','HCLTECH.NS','NESTLEIND.NS','POWERGRID.NS','NTPC.NS',
  'TATAMOTORS.NS','HDFCLIFE.NS','SBILIFE.NS','GRASIM.NS','BPCL.NS',
  'DIVISLAB.NS','CIPLA.NS','EICHERMOT.NS','ONGC.NS','TATACONSUM.NS',
  'HEROMOTOCO.NS','DRREDDY.NS','ADANIPORTS.NS','JSWSTEEL.NS','COALINDIA.NS',
  'BRITANNIA.NS','HINDALCO.NS','INDUSINDBK.NS','APOLLOHOSP.NS','UPL.NS',
  'SHRIRAMFIN.NS','BAJAJ-AUTO.NS','TRENT.NS','M&M.NS','TATASTEEL.NS'
]

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') || 'indian'

  try {
    if (type === 'crypto') {
      const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=inr&ids=bitcoin,ethereum,binancecoin,ripple,solana,dogecoin,cardano,avalanche-2,polkadot,tron,shiba-inu,chainlink,litecoin,near,uniswap,internet-computer,cosmos,monero,stellar,okb&order=market_cap_desc&per_page=50&page=1&sparkline=false`
      const res = await fetch(url, { headers: { 'Accept': 'application/json' }, next: { revalidate: 60 } })
      if (!res.ok) throw new Error('CoinGecko error')
      const coins = await res.json()
      const quotes = coins.map(c => ({
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
        currency: 'INR',
        market: 'crypto',
      }))
      return NextResponse.json({ quotes, updatedAt: Date.now() })
    }

    // Fetch in 2 batches of 25 to avoid timeouts
    const batch1 = NIFTY50_SYMBOLS.slice(0, 25)
    const batch2 = NIFTY50_SYMBOLS.slice(25)

    const [res1, res2] = await Promise.allSettled([
      yf.quote(batch1),
      yf.quote(batch2),
    ])

    const raw = [
      ...(res1.status === 'fulfilled' ? (Array.isArray(res1.value) ? res1.value : [res1.value]) : []),
      ...(res2.status === 'fulfilled' ? (Array.isArray(res2.value) ? res2.value : [res2.value]) : []),
    ]

    const quotes = raw.filter(Boolean).map(q => ({
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
      currency: 'INR',
      market: 'indian',
    }))

    return NextResponse.json({ quotes, updatedAt: Date.now() })
  } catch (err) {
    console.error('quotes error:', err.message)
    return NextResponse.json({ error: err.message, quotes: [] }, { status: 500 })
  }
}
