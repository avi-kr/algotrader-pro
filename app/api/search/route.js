import { NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'

// v3 requires instantiation — calling methods on the class directly throws
// "Call `const yahooFinance = new YahooFinance()` first"
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] })

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q') || ''
  if (!q || q.length < 2) return NextResponse.json({ results: [] })

  try {
    const result = await yf.search(q, { quotesCount: 8, newsCount: 0 })
    const results = (result?.quotes || [])
      .filter(r => r.symbol && (r.quoteType === 'EQUITY' || r.quoteType === 'CRYPTOCURRENCY'))
      .slice(0, 8)
      .map(r => ({
        symbol: r.symbol,
        name: r.shortname || r.longname || r.symbol,
        exchange: r.exchange,
        type: r.quoteType,
        market: r.exchange === 'NSE' || r.exchange === 'BSE' ? 'indian' : 'us',
      }))
    return NextResponse.json({ results })
  } catch (err) {
    console.error('search error:', err.message)
    return NextResponse.json({ error: err.message, results: [] }, { status: 500 })
  }
}
