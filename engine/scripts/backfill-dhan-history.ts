// Backfills real Dhan historical candles into the shared Candle table (the
// same table /api/candles/import writes to), so /api/historical serves them
// ahead of any live fetch. This is a standalone script, not a Vercel route:
// a 3-year 1-minute backfill across many symbols means hundreds of paginated
// requests (Dhan caps intraday history at 90 days/request), which would
// blow well past a serverless function's execution time limit — this is
// exactly the kind of long-running job engine/ exists for, per
// docs/ARCHITECTURE.md's Vercel/engine split.
//
// Usage (from engine/):
//   npm run backfill:dhan -- --symbols=RELIANCE.NS,TCS.NS --years=3 --timeframe=1m
//   npm run backfill:dhan -- --symbols-file=./symbols.json --years=3 --timeframe=1m
//
// symbols.json is a plain JSON array of strings, e.g. ["RELIANCE.NS", "TCS.NS"].
// Requires DHAN_CLIENT_ID / DHAN_ACCESS_TOKEN in the environment.

import { readFileSync } from 'node:fs'
import { prisma } from '@algotrader/db'
import type { Timeframe } from '@algotrader/shared-types'
import { DhanMarketDataAdapter } from '../src/market-data/dhan'

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

// Data APIs are capped at 5 req/sec (docs.dhanhq.co/api/v2 rate limits) —
// this script issues requests sequentially per symbol already (see
// DhanMarketDataAdapter.getHistoricalCandles), so a small delay between
// SYMBOLS is enough headroom without needing a token-bucket limiter.
const DELAY_BETWEEN_SYMBOLS_MS = 500
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const CANDLE_INSERT_BATCH = 5000

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const years = Number(args.years ?? 3)
  const timeframe = (args.timeframe ?? '1m') as Timeframe

  let symbols: string[]
  if (args['symbols-file']) {
    symbols = JSON.parse(readFileSync(args['symbols-file'], 'utf-8'))
  } else if (args.symbols) {
    symbols = args.symbols.split(',').map(s => s.trim()).filter(Boolean)
  } else {
    console.error('Usage: --symbols=A.NS,B.NS or --symbols-file=path.json [--years=3] [--timeframe=1m]')
    process.exit(1)
  }

  const adapter = new DhanMarketDataAdapter({
    clientId: process.env.DHAN_CLIENT_ID,
    accessToken: process.env.DHAN_ACCESS_TOKEN,
  })

  const to = new Date()
  const from = new Date(to)
  from.setFullYear(from.getFullYear() - years)

  console.log(`Backfilling ${symbols.length} symbol(s), ${timeframe}, ${years}y (${from.toISOString().slice(0, 10)} -> ${to.toISOString().slice(0, 10)})`)

  for (const symbol of symbols) {
    try {
      const candles = await adapter.getHistoricalCandles({ symbol, timeframe, from, to })
      let inserted = 0
      for (let i = 0; i < candles.length; i += CANDLE_INSERT_BATCH) {
        const chunk = candles.slice(i, i + CANDLE_INSERT_BATCH).map(c => ({ symbol, timeframe, ...c }))
        const result = await prisma.candle.createMany({ data: chunk, skipDuplicates: true })
        inserted += result.count
      }
      console.log(`${symbol}: fetched ${candles.length}, inserted ${inserted} new (rest already cached)`)
    } catch (err) {
      console.error(`${symbol}: FAILED — ${(err as Error).message}`)
    }
    await sleep(DELAY_BETWEEN_SYMBOLS_MS)
  }

  await prisma.$disconnect()
  console.log('Done.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
