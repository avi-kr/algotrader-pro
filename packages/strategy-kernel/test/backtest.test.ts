import { describe, it, expect } from 'vitest'
import type { Candle, StrategyConfig } from '@algotrader/shared-types'
import { runBacktest, computeStopLossPrice, computeTakeProfitPrice, computePositionQty, type BacktestResult } from '../src/backtest'

const DAY = 86400

describe('computePositionQty', () => {
  it('us_equity floors to whole shares', () => {
    expect(computePositionQty('us_equity', 10000, 190.5)).toBe(Math.floor(10000 / 190.5))
  })

  it('crypto keeps fractional precision (regression — flooring to a whole unit at BTC-scale prices zeroed every crypto trade)', () => {
    const qty = computePositionQty('crypto', 10000, 30000)
    expect(qty).toBeGreaterThan(0)
    expect(qty).toBeCloseTo(10000 / 30000, 6)
  })

  it('a position smaller than one unit still floors to exactly 0 for equities (no fractional shares)', () => {
    expect(computePositionQty('us_equity', 100, 500)).toBe(0)
  })
})

describe('computeStopLossPrice', () => {
  const refCandle: Candle = { time: 0, open: 100, high: 102, low: 98, close: 100, volume: 1 }

  it('long: atr_multiplier subtracts from entry', () => {
    const price = computeStopLossPrice({
      type: 'long',
      entryPrice: 100,
      stopLoss: { type: 'atr_multiplier', value: 2 },
      refCandle,
      atrValue: 3,
    })
    expect(price).toBe(100 - 2 * 3)
  })

  it('short: atr_multiplier adds to entry (regression — this branch was missing and silently fell back to a flat 5% stop)', () => {
    const price = computeStopLossPrice({
      type: 'short',
      entryPrice: 100,
      stopLoss: { type: 'atr_multiplier', value: 2 },
      refCandle,
      atrValue: 3,
    })
    expect(price).toBe(100 + 2 * 3)
    expect(price).not.toBeCloseTo(100 * 1.05, 5) // the old buggy fallback value
  })

  it('long: last_candle_low uses the reference candle low', () => {
    expect(
      computeStopLossPrice({ type: 'long', entryPrice: 100, stopLoss: { type: 'last_candle_low' }, refCandle, atrValue: null })
    ).toBe(98)
  })

  it('short: last_candle_low uses the reference candle high', () => {
    expect(
      computeStopLossPrice({ type: 'short', entryPrice: 100, stopLoss: { type: 'last_candle_low' }, refCandle, atrValue: null })
    ).toBe(102)
  })

  it('long/short: fixed_percent is symmetric around entry', () => {
    const long = computeStopLossPrice({ type: 'long', entryPrice: 100, stopLoss: { type: 'fixed_percent', value: 5 }, refCandle, atrValue: null })
    const short = computeStopLossPrice({ type: 'short', entryPrice: 100, stopLoss: { type: 'fixed_percent', value: 5 }, refCandle, atrValue: null })
    expect(long).toBe(95)
    expect(short).toBe(105)
  })
})

describe('computeTakeProfitPrice', () => {
  it('long: risk_reward scales the entry-to-stop distance by the ratio', () => {
    // risk = 100 - 90 = 10; target = entry + 10 * 3 = 130
    const price = computeTakeProfitPrice({ type: 'long', entryPrice: 100, stopLossPrice: 90, takeProfit: { type: 'risk_reward', value: 3 } })
    expect(price).toBe(130)
  })

  it('short: risk_reward scales the entry-to-stop distance by the ratio, on the other side', () => {
    // risk = 110 - 100 = 10; target = entry - 10 * 3 = 70
    const price = computeTakeProfitPrice({ type: 'short', entryPrice: 100, stopLossPrice: 110, takeProfit: { type: 'risk_reward', value: 3 } })
    expect(price).toBe(70)
  })

  it('type "none" returns null (no take-profit order)', () => {
    expect(computeTakeProfitPrice({ type: 'long', entryPrice: 100, stopLossPrice: 90, takeProfit: { type: 'none' } })).toBeNull()
  })
})

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
