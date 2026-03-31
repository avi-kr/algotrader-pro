import { NextResponse } from 'next/server'
import yahooFinance from 'yahoo-finance2'

export const runtime = 'nodejs'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q') || ''

  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] })
  }

  try {
    const data = await yahooFinance.search(q, {
      quotesCount: 10,
      newsCount: 0,
    })

    const quotes = data?.quotes || []

    const results = quotes
      .filter(q => q.quoteType === 'EQUITY' || q.quoteType === 'CRYPTOCURRENCY')
      .slice(0, 8)
      .map(q => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        exchange: q.exchange,
        type: q.quoteType,
        market: q.quoteType === 'CRYPTOCURRENCY' ? 'crypto'
              : (q.exchange === 'NSE' || q.exchange === 'BSE') ? 'indian' : 'us',
      }))

    return NextResponse.json({ results })
  } catch (error) {
    return NextResponse.json({ error: error.message, results: [] }, { status: 500 })
  }
}
