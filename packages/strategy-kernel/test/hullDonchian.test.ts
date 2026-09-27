import { describe, it, expect } from 'vitest'
import type { Candle } from '@algotrader/shared-types'
import { hma, computeHullSuite, computeRollingExtreme } from '../src/indicators'

const DAY = 86400

function candle(time: number, open: number, high: number, low: number, close: number, volume = 1000): Candle {
  return { time, open, high, low, close, volume }
}

describe('hma (Hull Moving Average)', () => {
  it('matches a hand-computed value for a simple linear ramp', () => {
    // For period=4: halfPeriod=2, sqrtPeriod=round(sqrt(4))=2.
    // closes: 1,2,3,4,5,6,7,8,9,10
    const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const result = hma(closes, 4)

    // WMA(2) of closes at i=1..9: WMA2[i] = (closes[i]*2 + closes[i-1]*1) / 3
    // WMA(4) of closes at i=3..9: WMA4[i] = (c[i]*4+c[i-1]*3+c[i-2]*2+c[i-3]*1)/10
    // For a pure linear ramp with step 1, WMA(n)[i] = closes[i] - (n-1)/3
    // exactly (a known identity for WMA on a linear series). So:
    //   WMA2[i] = closes[i] - 1/3
    //   WMA4[i] = closes[i] - 1
    //   raw[i] = 2*WMA2[i] - WMA4[i] = 2*(closes[i]-1/3) - (closes[i]-1) = closes[i] - 2/3 + 1
    //          = closes[i] + 1/3
    // Then HMA = WMA(2) of raw, and raw is ALSO a linear ramp (same step 1,
    // just shifted up by a constant) starting from i=3 (once both WMA2 and
    // WMA4 are defined) — WMA(2) of a linear ramp = raw[i] - 1/3 = closes[i].
    // So on a pure linear ramp, HMA should track price almost exactly once
    // warmed up (this is the well-known "HMA hugs a straight line exactly"
    // property) — check it holds at a comfortably warmed-up index.
    expect(result[8]).not.toBeNull()
    expect(result[8]).toBeCloseTo(closes[8], 5)
    expect(result[9]).toBeCloseTo(closes[9], 5)
  })

  it('returns null before the series has enough data to warm up', () => {
    const result = hma([1, 2, 3], 10)
    expect(result.every(v => v === null)).toBe(true)
  })
})

describe('computeHullSuite', () => {
  it('flags a bullish flip exactly once when a falling HMA turns to rising', () => {
    // A V-shaped price series: falls then sharply rises. period=4 keeps the
    // warm-up short enough to actually see both phases in a small test.
    const closes = [
      20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, // falling leg
      12, 15, 19, 24, 30, 37, 45, 54, 64, 75,     // rising leg
    ]
    const result = computeHullSuite(closes, 4)

    const bullFlips = result.bullFlip.map((v, i) => (v === 1 ? i : null)).filter(v => v !== null)
    const bearFlips = result.bearFlip.map((v, i) => (v === 1 ? i : null)).filter(v => v !== null)

    // Falling then sharply rising should produce at least one bullish flip
    // once the HMA itself turns up, and it should happen once the price
    // trend actually reverses (well into the rising leg's index range or
    // right at the transition), not during the initial fall.
    expect(bullFlips.length).toBeGreaterThan(0)
    expect(Math.min(...bullFlips)).toBeGreaterThanOrEqual(10)
    // No bearish flip should register during a monotonic initial fall
    // (there's nothing to flip FROM yet in that stretch).
    expect(bearFlips.filter(i => i < 10).length).toBe(0)
  })
})

describe('computeRollingExtreme', () => {
  // Fixed 3-bar rolling window. Highs/lows chosen so the rolling
  // highest/lowest is easy to hand-verify at each step.
  const candles: Candle[] = [
    candle(0 * DAY, 10, 10, 9, 10),
    candle(1 * DAY, 10, 12, 9, 11),
    candle(2 * DAY, 11, 11, 8, 10),
    candle(3 * DAY, 10, 13, 9.5, 12.5), // close(12.5) > highest of bars[0..2]=12 -> breakout high
    candle(4 * DAY, 12.5, 12.6, 6, 7),  // close(7) < lowest of bars[1..3]=8 -> breakout low
  ]

  it('computes the rolling highest/lowest from the PRIOR window only, excluding the current bar', () => {
    const result = computeRollingExtreme(candles, 3)
    // At i=3: window is bars[0,1,2] -> highest=12 (bar1), lowest=8 (bar2)
    expect(result.highest[3]).toBe(12)
    expect(result.lowest[3]).toBe(8)
    expect(result.breakoutHigh[3]).toBe(1)
    // At i=4: window is bars[1,2,3] -> highest=13 (bar3), lowest=8 (bar2)
    expect(result.highest[4]).toBe(13)
    expect(result.lowest[4]).toBe(8)
    expect(result.breakoutLow[4]).toBe(1)
  })

  it('uses an expanding all-time window when period is 0 (or omitted)', () => {
    const result = computeRollingExtreme(candles, 0)
    // At i=4, the expanding window covers bars[0..3] -> highest=13, lowest=8
    expect(result.highest[4]).toBe(13)
    expect(result.lowest[4]).toBe(8)
  })

  it('has no value on the very first bar (no prior bars to compare against)', () => {
    const result = computeRollingExtreme(candles, 3)
    expect(result.highest[0]).toBeNull()
    expect(result.lowest[0]).toBeNull()
  })
})
