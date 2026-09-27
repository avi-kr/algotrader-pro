import { NextResponse } from 'next/server'
import { prisma } from '@algotrader/db'
import { DhanMarketDataAdapter } from '@algotrader/engine/src/market-data/dhan'

// Runs the Dhan historical-data fetch server-side, on Vercel — not from a
// local machine or the Claude Code sandbox, both of which either can't reach
// api.dhan.co (network policy) or aren't pointed at the real production
// database. This mirrors /api/candles/import's upsert shape exactly (same
// Candle table, same skipDuplicates safety), so a full backfill is safe to
// re-run if it's interrupted partway through.
//
// One call = one Dhan API request's worth of data: the full range for
// daily/weekly (Dhan has no range cap there), or a single caller-supplied
// window (<=90 days) for intraday, since Dhan itself caps intraday requests
// at 90 days. The browser-console script that drives this chunks a 3-year
// intraday backfill into <=89-day windows itself and calls this once per
// window per symbol — keeping each individual request comfortably inside
// this route's execution time limit instead of one giant multi-minute call.
export const maxDuration = 60

export async function POST(request) {
  const body = await request.json()
  const { symbol, timeframe, fromDate, toDate } = body

  if (!symbol || !timeframe || !fromDate || !toDate) {
    return NextResponse.json({ error: 'symbol, timeframe, fromDate, toDate are required' }, { status: 400 })
  }
  if (!process.env.DHAN_CLIENT_ID || !process.env.DHAN_ACCESS_TOKEN) {
    return NextResponse.json({ error: 'DHAN_CLIENT_ID/DHAN_ACCESS_TOKEN are not set in this deployment\'s environment variables' }, { status: 500 })
  }

  try {
    const adapter = new DhanMarketDataAdapter({
      clientId: process.env.DHAN_CLIENT_ID,
      accessToken: process.env.DHAN_ACCESS_TOKEN,
    })
    const candles = await adapter.getHistoricalCandles({
      symbol,
      timeframe,
      from: new Date(fromDate),
      to: new Date(toDate),
    })

    if (candles.length === 0) {
      return NextResponse.json({ symbol, timeframe, fetched: 0, inserted: 0 })
    }

    const rows = candles.map(c => ({ symbol, timeframe, ...c }))
    const result = await prisma.candle.createMany({ data: rows, skipDuplicates: true })

    return NextResponse.json({
      symbol, timeframe,
      fetched: candles.length,
      inserted: result.count,
      skippedDuplicates: rows.length - result.count,
    })
  } catch (err) {
    console.error('Dhan backfill error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
