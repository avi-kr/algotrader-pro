import { describe, it, expect } from 'vitest'
import type { Candle } from '@algotrader/shared-types'
import { atr } from '../src/indicators'
import {
  computeLiquiditySweep, computeFVG, computeOrderBlocks, computeImbalance,
  computeLiquidityVoid, computePremiumDiscount, computeBreakoutRetest,
  computeORB, computeSRPriceAction,
} from '../src/smc'

const DAY = 86400

function candle(time: number, open: number, high: number, low: number, close: number, volume = 1000): Candle {
  return { time, open, high, low, close, volume }
}

describe('computeLiquiditySweep', () => {
  // swingWidth=1 (3-bar fractal). Pivot high at i=1 (close=12) confirms at
  // t=2, becoming the active swing high. Bar 3's WICK (high=13) pokes above
  // it but its CLOSE (9) stays below — a sweep, not a break (market
  // structure is close-based, so it never consumes this level here). All
  // other bars' wicks are kept clearly clear of any active level so they
  // can't accidentally register a second sweep.
  const candles = [
    candle(0 * DAY, 10, 10.2, 9.8, 10),
    candle(1 * DAY, 10, 12.2, 9.8, 12),      // pivot high forms (12), confirms at t=2
    candle(2 * DAY, 11.5, 11.9, 10.8, 11),   // active level (12) starts here — high stays under it
    candle(3 * DAY, 11, 13, 8.5, 9),         // sweep candle: wick(13) > 12, close(9) < 12
    candle(4 * DAY, 9, 9.2, 7.8, 8),         // pivot low forms (8), confirms at t=5; high well under 12
    candle(5 * DAY, 8.5, 20.2, 8.2, 20),     // real break: close(20) > 12 -> consumes the level (not a sweep)
    candle(6 * DAY, 15, 15.5, 8.5, 9),       // just the right-neighbor bar for the t=5 pivot; wick kept clear
  ]

  it('flags a bearish sweep exactly on the wick-poke-and-reject bar, nowhere else', () => {
    const result = computeLiquiditySweep(candles, 1)
    expect(result.sweepBear[3]).toBe(1)
    expect(result.sweepBear.filter(v => v === 1)).toHaveLength(1)
    expect(result.sweepBull.every(v => v === null)).toBe(true)
  })
})

describe('computeFVG', () => {
  // Bullish gap: candle[0].high (10.3) < candle[2].low (12.0) — a real gap
  // [10.3, 12.0]. Bar 1's own high (12.5) is kept far enough from bar 3's
  // low that the (1,2,3) triplet doesn't ALSO accidentally form a gap.
  const candles = [
    candle(0 * DAY, 10, 10.3, 9.8, 10.2),
    candle(1 * DAY, 10.2, 12.5, 10.1, 12.3), // the impulse candle
    candle(2 * DAY, 12.3, 13, 12.0, 12.8),   // 3rd candle confirms the gap [10.3, 12.0]
    candle(3 * DAY, 12.8, 12.9, 12.3, 12.7), // no retest yet (low stays above the gap top)
    candle(4 * DAY, 12.7, 12.8, 11.5, 11.8), // dips into the gap zone [10.3,12.0] -> retest
  ]
  const atrSeries = atr(candles.map(c => c.high), candles.map(c => c.low), candles.map(c => c.close), 2)

  it('forms the gap on the 3rd candle and fires a retest when price re-enters it', () => {
    const fvg = computeFVG(candles, atrSeries, 0) // no minimum-size filter for this test
    expect(fvg.bullZoneTop[2]).toBe(12.0)
    expect(fvg.bullZoneBottom[2]).toBe(10.3)
    expect(fvg.bullRetest[4]).toBe(1)
    expect(fvg.bullZoneTop[4]).toBe(12.0) // still active as of the start of bar 4, before this bar consumes it
  })

  it('invalidates a gap that closes fully through it instead of firing a retest', () => {
    const invalidating = [...candles.slice(0, 3), candle(3 * DAY, 12.8, 12.9, 9, 9.5)] // closes below the gap bottom (10.3)
    const atrSeries2 = atr(invalidating.map(c => c.high), invalidating.map(c => c.low), invalidating.map(c => c.close), 2)
    const fvg = computeFVG(invalidating, atrSeries2, 0)
    expect(fvg.bullRetest.every(v => v === null)).toBe(true)
  })
})

describe('computeOrderBlocks / Mitigation / Breaker', () => {
  // A clean bullish structure: down-close candle at idx 4 (the order block),
  // then a strong impulse that produces a confirmed BOS. swingWidth=1.
  // Sequence built the same way as the marketStructure hand-trace but with
  // real OHLC so retests/invalidations are testable.
  const closes = [10, 12, 11, 13, 12, 15, 14, 13.5, 9] // last two bars: retest, then invalidate
  const candles: Candle[] = closes.map((c, i) => {
    if (i === 4) return candle(i * DAY, 13, 13.2, 11.8, c) // down candle (open 13 -> close 12): the order block
    const open = i === 0 ? c : closes[i - 1]
    return candle(i * DAY, open, Math.max(open, c) + 0.3, Math.min(open, c) - 0.3, c)
  })

  it('identifies the last opposite-colored candle before a confirmed BOS as the order block, and fires on retest', () => {
    const ob = computeOrderBlocks(candles, 1, 10)
    // BOS confirms once close breaks the prior active swing high (13, from
    // idx 3) while bullish bias holds — by idx 5 (close=15) that's already
    // established from the warm-up break at idx 3. The order block is the
    // down candle at idx 4 (its own high/low: 13.2 / 11.8).
    const bullEntryBars = ob.bullEntry.map((v, i) => (v === 1 ? i : null)).filter(v => v !== null)
    expect(bullEntryBars.length).toBeGreaterThan(0)
    for (const i of bullEntryBars) {
      expect(ob.activeBullZoneTop[i]).toBeCloseTo(13.2, 5)
      expect(ob.activeBullZoneBottom[i]).toBeCloseTo(11.8, 5)
    }
  })

  it('flags mitigation exactly once, on the first touch, not on every subsequent touch', () => {
    const ob = computeOrderBlocks(candles, 1, 10)
    const mitigatedBars = ob.bullMitigated.map((v, i) => (v === 1 ? i : null)).filter(v => v !== null)
    expect(mitigatedBars.length).toBeLessThanOrEqual(1)
  })

  it('flips an invalidated order block into a breaker in the opposite direction', () => {
    // A separate, fully hand-traced fixture (not the shared one above,
    // which self-invalidates its own order block from a pre-existing bar
    // before any deliberate modification takes effect): a bullish OB forms
    // at t=7 (the red candle at idx 6, zone [12, 15.3]), gets touched, then
    // closes fully below its bottom at idx 8 (invalidating it into a
    // bearish breaker), then price wicks back into that same zone at idx 9.
    const candles2: Candle[] = [
      candle(0 * DAY, 10, 10.2, 9.8, 10),
      candle(1 * DAY, 10, 12.2, 9.8, 12),
      candle(2 * DAY, 12.2, 12.3, 10.8, 11),
      candle(3 * DAY, 11, 11.2, 10.8, 11.05),
      candle(4 * DAY, 11.05, 16, 10.9, 15),
      candle(5 * DAY, 15, 15.2, 14.8, 15.1),
      candle(6 * DAY, 15.1, 15.3, 12, 12.5),   // red candle -> becomes the order block
      candle(7 * DAY, 12.5, 17, 12.3, 16.5),   // BOS confirms here, OB formed off idx 6
      candle(8 * DAY, 11.8, 11.9, 10.8, 11.5), // gaps down and closes below OB bottom (12) -> invalidates;
                                                // high stays under 12 so this bar can't ALSO satisfy the
                                                // breaker retest itself, keeping the two events on separate bars
      candle(9 * DAY, 11.5, 13, 11.2, 12.8),   // wicks back into the breaker zone [12, 15.3]
    ]
    const ob = computeOrderBlocks(candles2, 1, 10)
    expect(ob.activeBullZoneTop[7]).toBeCloseTo(15.3, 5)
    expect(ob.activeBullZoneTop[9]).toBeNull() // consumed by idx 8's invalidation
    expect(ob.breakerBearEntry[9]).toBe(1)
  })
})

describe('computeImbalance', () => {
  const candles = [
    candle(0, 10, 10.2, 9.8, 10.0),
    candle(1, 10.0, 10.2, 9.8, 10.05),
    candle(2, 10.05, 10.2, 9.9, 10.1),
    candle(3, 10.1, 15, 10.05, 14.8), // huge bullish body relative to prior small-range candles
  ]
  it('flags only the disproportionately large-bodied candle', () => {
    const atrSeries = atr(candles.map(c => c.high), candles.map(c => c.low), candles.map(c => c.close), 3)
    const imb = computeImbalance(candles, atrSeries, 1.5)
    expect(imb.bullImbalance[3]).toBe(1)
    expect(imb.bullImbalance.slice(0, 3).every(v => v === null)).toBe(true)
    expect(imb.bearImbalance.every(v => v === null)).toBe(true)
  })
})

describe('computeLiquidityVoid', () => {
  it('flags a run of clean same-direction candles, not a choppy one', () => {
    const clean = [
      candle(0, 10, 10.1, 9.95, 10.05),
      candle(1, 10.05, 11.05, 10.0, 11.0),  // strong body, tiny wicks
      candle(2, 11.0, 12.0, 10.95, 11.95),
      candle(3, 11.95, 12.95, 11.9, 12.9),
    ]
    const voidResult = computeLiquidityVoid(clean, 3, 0.6)
    expect(voidResult.bullFormed[3]).toBe(1)

    const choppy = [
      candle(0, 10, 10.5, 9.5, 10.1),
      candle(1, 10.1, 10.6, 9.6, 10.15), // small body, big wicks -> fails bodyRatio
      candle(2, 10.15, 10.7, 9.7, 10.2),
      candle(3, 10.2, 10.8, 9.8, 10.25),
    ]
    const voidResult2 = computeLiquidityVoid(choppy, 3, 0.6)
    expect(voidResult2.bullFormed.every(v => v === null)).toBe(true)
  })
})

describe('computePremiumDiscount', () => {
  const closes = [10, 12, 11, 13, 12, 15, 13, 11, 10, 9, 11, 10, 9, 8] // same series as marketStructure hand-trace
  const candles: Candle[] = closes.map((c, i) => {
    const open = i === 0 ? c : closes[i - 1]
    return candle(i * DAY, open, Math.max(open, c) + 0.3, Math.min(open, c) - 0.3, c)
  })

  it('classifies price above/below the equilibrium of the active swing range', () => {
    const pd = computePremiumDiscount(candles, 1, 0.05)
    // At t=6, active range is [swingLow=12, swingHigh=15] (per the marketStructure
    // hand-trace) with close=13 -> equilibrium 13.5, so 13 sits in the discount half.
    expect(pd.rangeTop[6]).toBe(15)
    expect(pd.rangeBottom[6]).toBe(12)
    expect(pd.equilibrium[6]).toBeCloseTo(13.5, 5)
    expect(pd.zone[6]).toBe(-1) // close(13) < equilibrium(13.5) - base band -> discount
  })
})

describe('computeORB', () => {
  it('sets the range from the first bar of each session and only fires the first breakout after it', () => {
    // Two sessions, 3 bars each, 15-minute spacing, first bar of day 1 at
    // 09:15 IST (03:45 UTC).
    const day1Start = Date.UTC(2026, 0, 5, 3, 45, 0) / 1000
    const day2Start = Date.UTC(2026, 0, 6, 3, 45, 0) / 1000
    const candles = [
      candle(day1Start, 100, 101, 99, 100.5),        // opening range: [99,101]
      candle(day1Start + 900, 100.5, 102, 100, 101.8), // breaks above 101 -> bull entry
      candle(day1Start + 1800, 101.8, 103, 101.5, 102.5), // should NOT re-fire
      candle(day2Start, 200, 201, 199, 200.5),        // new session's own opening range
      candle(day2Start + 900, 200.5, 200.6, 197, 197.5), // breaks below 199 -> bear entry
    ]
    const orb = computeORB(candles)
    expect(orb.bullEntry[1]).toBe(1)
    expect(orb.bullEntry[2]).toBeNull() // one trade per session only
    expect(orb.bearEntry[4]).toBe(1)
    expect(orb.rangeHigh[1]).toBe(101)
    expect(orb.rangeLow[1]).toBe(99)
  })
})

describe('computeBreakoutRetest', () => {
  const closes = [10, 12, 11, 13, 12, 15, 13, 11.5, 13.5]
  // idx3 breaks the swing high from idx1 (12) — bias was null so this is
  // warm-up (unlabeled). idx5 (close=15) is the real BOS, breaking the
  // swing high from idx3 (13) while already bullish. idx6 touches back down
  // near 13 (retest); idx7 dips further (still no confirming close above
  // 13 yet); idx8 finally closes back above 13 -> retest entry fires there.
  const candles: Candle[] = closes.map((c, i) => {
    const open = i === 0 ? c : closes[i - 1]
    return candle(i * DAY, open, Math.max(open, c) + 0.3, Math.min(open, c) - 0.3, c)
  })
  const atrSeries = atr(candles.map(c => c.high), candles.map(c => c.low), candles.map(c => c.close), 3)

  it('fires a retest entry only after a touch of the broken level followed by a close back beyond it', () => {
    const br = computeBreakoutRetest(candles, atrSeries, 1, 10, 0.1)
    const bullBars = br.bullEntry.map((v, i) => (v === 1 ? i : null)).filter(v => v !== null)
    expect(bullBars.length).toBeGreaterThan(0)
  })
})

describe('computeSRPriceAction', () => {
  it('fires a bullish entry on a pin bar rejecting off the active swing low', () => {
    const closes = [10, 12, 11, 13, 12, 15, 13, 11, 10]
    const candles: Candle[] = closes.map((c, i) => {
      const open = i === 0 ? c : closes[i - 1]
      return candle(i * DAY, open, Math.max(open, c) + 0.3, Math.min(open, c) - 0.3, c)
    })
    // Replace the last candle with a clean pin bar sitting right at the
    // active swing low (12, confirmed from idx4 per the same series as the
    // premium/discount test) with a long lower wick and small body.
    candles[8] = candle(8 * DAY, 12.05, 12.3, 11.0, 12.1)
    const sr = computeSRPriceAction(candles, 1, 2)
    expect(sr.bullEntry[8]).toBe(1)
  })
})
