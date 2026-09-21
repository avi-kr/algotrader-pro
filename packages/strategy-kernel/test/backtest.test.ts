import { describe, it, expect } from 'vitest'
import type { Candle, StrategyConfig } from '@algotrader/shared-types'
import { runBacktest, type BacktestResult } from '../src/backtest'

const DAY = 86400

function makeCandlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1]
    const high = Math.max(open, close) + 0.5
    const low = Math.min(open, close) - 0.5
    return { time: i * DAY, open, high, low, close, volume: 1000 }
  })
}

/** SMA with period 1 is mathematically identical to the raw close series —
 * used here as a "raw price" indicator so entry timing can be pinned to an
 * exact, hand-known bar without depending on real EMA lag dynamics. */
const rawPriceStrategy: StrategyConfig = {
  name: 'raw-price-threshold',
  assetClass: 'us_equity',
  indicators: [{ id: 'price', type: 'SMA', period: 1 }],
  conditions: {
    longEntry: [{ type: 'above_value', a: 'price', value: 50 }],
    longExit: [{ type: 'below_value', a: 'price', value: 50 }],
    shortEntry: [],
    shortExit: [],
  },
  stopLoss: { type: 'none' },
  takeProfit: { type: 'none' },
  tradeDirection: 'long_only',
  positionSizePct: 10,
}

describe('runBacktest — fill timing (no look-ahead)', () => {
  it('fills the entry at the OPEN of the bar AFTER the signal bar, never the signal bar itself', () => {
    // Flat at 10 for 60 bars to satisfy the >=50 candle minimum, then a jump
    // to 100 at bar 60 which crosses the `above_value: 50` threshold.
    const closes = [...Array(60).fill(10), 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]
    const candles = makeCandlesFromCloses(closes)
    const signalBarIdx = 60 // first bar whose CLOSE (100) exceeds the threshold

    const result = runBacktest(candles, rawPriceStrategy, { capital: 100000, positionSizePct: 10 }) as Extract<
      BacktestResult,
      { trades: unknown }
    >
    expect(result.trades.length).toBeGreaterThan(0)
    const entry = result.trades[0]

    // The fill must happen at the OPEN of the bar strictly after the signal bar.
    expect(entry.entryDate).toBe(candles[signalBarIdx + 1].time)
    expect(entry.entryDate).not.toBe(candles[signalBarIdx].time)
    // entryPrice is candle[signalBarIdx+1].open plus slippage, not candle[signalBarIdx].open (10).
    expect(entry.entryPrice).toBeCloseTo(candles[signalBarIdx + 1].open * 1.0001, 2)
  })
})

describe('runBacktest — no look-ahead regression', () => {
  it('trades fully resolved before a divergence point are identical regardless of what happens after it', () => {
    const CUTOFF = 100
    const TOTAL = 160

    // Deterministic oscillating-with-trend price path, guaranteed to produce
    // several EMA9/EMA20 crossovers before the cutoff.
    const basePrices = Array.from({ length: TOTAL }, (_, i) => 100 + 15 * Math.sin(i / 8) + i * 0.05)

    const variantA = [...basePrices]
    const variantB = [
      ...basePrices.slice(0, CUTOFF + 1),
      // Completely different, discontinuous future after the cutoff.
      ...Array.from({ length: TOTAL - CUTOFF - 1 }, (_, k) => 200 - k * 3),
    ]

    const strategy: StrategyConfig = {
      name: 'ema-crossover',
      assetClass: 'us_equity',
      indicators: [
        { id: 'ema9', type: 'EMA', period: 9 },
        { id: 'ema20', type: 'EMA', period: 20 },
      ],
      conditions: {
        longEntry: [{ type: 'crossover', a: 'ema9', b: 'ema20' }],
        longExit: [{ type: 'crossunder', a: 'ema9', b: 'ema20' }],
        shortEntry: [],
        shortExit: [],
      },
      stopLoss: { type: 'none' },
      takeProfit: { type: 'none' },
      tradeDirection: 'long_only',
      positionSizePct: 10,
    }

    const resultA = runBacktest(makeCandlesFromCloses(variantA), strategy) as Extract<
      BacktestResult,
      { trades: unknown }
    >
    const resultB = runBacktest(makeCandlesFromCloses(variantB), strategy) as Extract<
      BacktestResult,
      { trades: unknown }
    >

    const cutoffTime = CUTOFF * DAY
    const resolvedA = resultA.trades.filter(t => t.exitDate <= cutoffTime)
    const resolvedB = resultB.trades.filter(t => t.exitDate <= cutoffTime)

    // Sanity: the scenario must actually exercise at least one full trade
    // before the cutoff, or this test would pass vacuously.
    expect(resolvedA.length).toBeGreaterThan(0)
    expect(resolvedA).toEqual(resolvedB)
  })
})
