import { NextResponse } from 'next/server'
import { prisma } from '@algotrader/db'
import { runBacktest } from '@algotrader/strategy-kernel'

// Runs the SAME strategy-kernel code path that (later) drives paper and live
// trading — CLAUDE.md non-negotiable #7. The client fetches candles from
// /api/historical for charting and posts them here so the actual backtest
// math (and its no-look-ahead fill timing) runs server-side, once, and gets
// persisted as a durable BacktestRun instead of a throwaway client number.
export async function POST(request) {
  // Every other route here (/api/historical, /api/candles/import) wraps its
  // work in try/catch and always returns JSON on failure. This one didn't —
  // an uncaught throw anywhere below (runBacktest on a malformed strategy,
  // or a DB write hitting a storage cap) crashed the whole handler with an
  // empty/non-JSON response, which surfaces client-side as the unhelpful
  // "Unexpected end of JSON input" instead of the real error message.
  try {
    const body = await request.json()
    const { strategyId, strategy: inlineStrategy, symbol, timeframe, candles, capital, positionSizePct, commissionPct } = body

    let strategyRow = null
    let strategyConfig

    if (strategyId) {
      strategyRow = await prisma.strategy.findUnique({ where: { id: strategyId } })
      if (!strategyRow) return NextResponse.json({ error: 'Strategy not found' }, { status: 404 })
      strategyConfig = strategyRow.config
    } else if (inlineStrategy) {
      strategyConfig = inlineStrategy
    } else {
      return NextResponse.json({ error: 'strategyId or strategy is required' }, { status: 400 })
    }

    if (!Array.isArray(candles) || candles.length < 50) {
      return NextResponse.json({ error: 'candles (at least 50 bars) are required' }, { status: 400 })
    }

    const result = runBacktest(candles, strategyConfig, {
      capital: capital != null ? Number(capital) : undefined,
      positionSizePct: positionSizePct != null ? Number(positionSizePct) : undefined,
      commissionPct: commissionPct != null ? Number(commissionPct) : undefined,
    })

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    let backtestRunId = null
    if (strategyRow) {
      try {
        // Persisting the BacktestRun is a nice-to-have record of this run,
        // not the reason the user is here — a DB write failure (e.g. a
        // storage cap) shouldn't hide the backtest result they just waited
        // for. Log it and return the result anyway with backtestRunId: null.
        const run = await prisma.backtestRun.create({
          data: {
            strategyId: strategyRow.id,
            symbol: symbol || 'UNKNOWN',
            timeframe: timeframe || '1d',
            fromTime: candles[0].time,
            toTime: candles[candles.length - 1].time,
            capital: capital != null ? Number(capital) : 100000,
            metrics: result.metrics,
            trades: result.trades,
            equityCurve: result.equityCurve,
          },
        })
        backtestRunId = run.id
      } catch (persistErr) {
        console.error('backtest run persist failed (returning result anyway):', persistErr.message)
      }
    }

    return NextResponse.json({ ...result, backtestRunId })
  } catch (err) {
    console.error('backtest error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
