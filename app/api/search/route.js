import { NextResponse } from 'next/server'

export const runtime = 'edge'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q') || ''

  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] })
  }

  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0&enableFuzzyQuery=true&enableNavLinks=false&enableEnhancedTrivialQuery=true&enableResearchReports=false&enableCb=true&recommendCount=0&enableSaving=false`

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    })

    if (!response.ok) throw new Error('Search failed')

    const data = await response.json()
    const quotes = data?.quotes || []

    const results = quotes
      .filter(q => q.quoteType === 'EQUITY' || q.quoteType === 'CRYPTOCURRENCY')
      .slice(0, 8)
      .map(q => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        exchange: q.exchange,
        type: q.quoteType,
        market: q.quoteType === 'CRYPTOCURRENCY' ? 'crypto' : 
                (q.exchange === 'NSE' || q.exchange === 'BSE') ? 'indian' : 'us',
      }))

    return NextResponse.json({ results })
  } catch (error) {
    return NextResponse.json({ error: error.message, results: [] }, { status: 500 })
  }
}
