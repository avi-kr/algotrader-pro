import { NextResponse } from 'next/server'
import { prisma } from '@algotrader/db'

// Bulk-caches real historical candles (e.g. Dhan-exported NSE data) into our
// own DB, so /api/historical can serve them directly instead of hitting
// Yahoo Finance's free API — which hard-caps 1-minute data at 7 days of
// lookback and can't provide years of intraday history at all. One request
// is capped at MAX_ROWS_PER_REQUEST to stay well inside a serverless
// function's execution time limit; the browser-side importer chunks a full
// file into several requests of this size.
const MAX_ROWS_PER_REQUEST = 5000

function validateRow(row) {
  return (
    row &&
    Number.isFinite(row.time) &&
    Number.isFinite(row.open) &&
    Number.isFinite(row.high) &&
    Number.isFinite(row.low) &&
    Number.isFinite(row.close)
  )
}

export async function POST(request) {
  const body = await request.json()
  const { symbol, timeframe, candles } = body

  if (!symbol || typeof symbol !== 'string') {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 })
  }
  if (!timeframe || typeof timeframe !== 'string') {
    return NextResponse.json({ error: 'timeframe is required' }, { status: 400 })
  }
  if (!Array.isArray(candles) || candles.length === 0) {
    return NextResponse.json({ error: 'candles must be a non-empty array' }, { status: 400 })
  }
  if (candles.length > MAX_ROWS_PER_REQUEST) {
    return NextResponse.json({ error: `Max ${MAX_ROWS_PER_REQUEST} candles per request — chunk the upload client-side` }, { status: 400 })
  }

  const rows = candles.filter(validateRow).map(c => ({
    symbol,
    timeframe,
    time: Math.floor(c.time),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: Number.isFinite(c.volume) ? c.volume : 0,
  }))

  const invalidCount = candles.length - rows.length
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No valid rows in this chunk (need numeric time/open/high/low/close)' }, { status: 400 })
  }

  try {
    // skipDuplicates relies on the @@unique([symbol, timeframe, time])
    // constraint — re-uploading the same file (e.g. after a partial failure)
    // is safe and idempotent; it only ever inserts rows that don't exist yet.
    const result = await prisma.candle.createMany({ data: rows, skipDuplicates: true })
    return NextResponse.json({
      inserted: result.count,
      skippedDuplicates: rows.length - result.count,
      invalidRows: invalidCount,
    })
  } catch (err) {
    console.error('candles import error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Trims cached candles older than a cutoff for one symbol/timeframe — used
// to free space under a database storage cap (e.g. Neon's free-tier 512MB
// limit) by shrinking how far back 1-minute history goes for symbols
// already backfilled, rather than losing the whole dataset. Requires an
// explicit beforeTime rather than a vague "keep last N days" default: this
// is a real, non-reversible delete, and the caller should know exactly what
// cutoff it's computing.
export async function DELETE(request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')
  const timeframe = searchParams.get('timeframe')
  const beforeTime = Number(searchParams.get('beforeTime'))

  if (!symbol || !timeframe) {
    return NextResponse.json({ error: 'symbol and timeframe are required' }, { status: 400 })
  }
  if (!Number.isFinite(beforeTime)) {
    return NextResponse.json({ error: 'beforeTime (unix seconds) is required' }, { status: 400 })
  }

  try {
    const result = await prisma.candle.deleteMany({ where: { symbol, timeframe, time: { lt: beforeTime } } })
    return NextResponse.json({ symbol, timeframe, beforeTime, deleted: result.count })
  } catch (err) {
    console.error('candles trim error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Lets the import page show what's already cached for a symbol before
// uploading, and lets /api/historical check candle-count/date-range quickly.
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')
  const timeframe = searchParams.get('timeframe')
  if (!symbol || !timeframe) {
    return NextResponse.json({ error: 'symbol and timeframe are required' }, { status: 400 })
  }

  const [count, earliest, latest] = await Promise.all([
    prisma.candle.count({ where: { symbol, timeframe } }),
    prisma.candle.findFirst({ where: { symbol, timeframe }, orderBy: { time: 'asc' } }),
    prisma.candle.findFirst({ where: { symbol, timeframe }, orderBy: { time: 'desc' } }),
  ])

  return NextResponse.json({
    symbol, timeframe, count,
    fromTime: earliest?.time ?? null,
    toTime: latest?.time ?? null,
  })
}
