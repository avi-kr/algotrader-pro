import { describe, it, expect } from 'vitest'
import type { Candle } from '@algotrader/shared-types'
import { ema, atr } from '../src/indicators'
import {
  computeSupertrend, computeKeltner, computeStochastic, computeParabolicSar,
  computeCci, computeIchimokuTK,
} from '../src/moreIndicators'

const DAY = 86400

function candle(time: number, open: number, high: number, low: number, close: number, volume = 1000): Candle {
  return { time, open, high, low, close, volume }
}

describe('computeCci', () => {
  it('matches a hand-computed value on doji bars (high=low=close, so typicalPrice=close)', () => {
    // period=3. Typical prices: 10, 10, 10, 13.
    // At i=2: mean=(10+10+10)/3=10, meanDev=0 -> CCI=0.
    // At i=3: window [10,10,13], mean=11, meanDev=(1+1+2)/3=4/3,
    //   CCI=(13-11)/(0.015*4/3)=2/0.02=100.
    const candles: Candle[] = [10, 10, 10, 13].map((tp, i) => candle(i * DAY, tp, tp, tp, tp))
    const result = computeCci(candles, 3)
    expect(result[1]).toBeNull()
    expect(result[2]).toBeCloseTo(0, 6)
    expect(result[3]).toBeCloseTo(100, 6)
  })
})

describe('computeIchimokuTK', () => {
  it('matches hand-computed Tenkan/Kijun midpoints', () => {
    const highs = [10, 11, 12, 13]
    const lows = [8, 9, 10, 11]
    const candles: Candle[] = highs.map((h, i) => candle(i * DAY, h, h, lows[i], h))
    const result = computeIchimokuTK(candles, 2, 3)
    // Tenkan (period 2): i=1 window[0,1] hi=11 lo=8 -> 9.5; i=2 window[1,2] hi=12 lo=9 -> 10.5; i=3 -> 11.5
    expect(result.tenkan[0]).toBeNull()
    expect(result.tenkan[1]).toBeCloseTo(9.5, 6)
    expect(result.tenkan[2]).toBeCloseTo(10.5, 6)
    expect(result.tenkan[3]).toBeCloseTo(11.5, 6)
    // Kijun (period 3): i=2 window[0,1,2] hi=12 lo=8 -> 10; i=3 window[1,2,3] hi=13 lo=9 -> 11
    expect(result.kijun[1]).toBeNull()
    expect(result.kijun[2]).toBeCloseTo(10, 6)
    expect(result.kijun[3]).toBeCloseTo(11, 6)
  })
})

describe('computeStochastic', () => {
  it('matches a hand-computed %K with no smoothing', () => {
    const candles: Candle[] = [
      candle(0 * DAY, 9, 10, 8, 9),
      candle(1 * DAY, 10, 11, 9, 10),
      candle(2 * DAY, 11, 12, 10, 11),
      candle(3 * DAY, 12, 13, 11, 12),
    ]
    // period=3, smoothK=1, smoothD=1 (pass-through, exact values).
    // At i=2: window[0,1,2] hi=12 lo=8 close=11 -> (11-8)/(12-8)*100=75
    // At i=3: window[1,2,3] hi=13 lo=9 close=12 -> (12-9)/(13-9)*100=75
    const result = computeStochastic(candles, 3, 1, 1)
    expect(result.k[1]).toBeNull()
    expect(result.k[2]).toBeCloseTo(75, 6)
    expect(result.k[3]).toBeCloseTo(75, 6)
    expect(result.d[2]).toBeCloseTo(75, 6)
    expect(result.d[3]).toBeCloseTo(75, 6)
  })

  it('returns null %K/%D before enough bars exist to smooth', () => {
    const candles: Candle[] = [
      candle(0 * DAY, 9, 10, 8, 9),
      candle(1 * DAY, 10, 11, 9, 10),
    ]
    const result = computeStochastic(candles, 14, 3, 3)
    expect(result.k.every(v => v === null)).toBe(true)
    expect(result.d.every(v => v === null)).toBe(true)
  })
})

describe('computeKeltner', () => {
  it('the upper/lower bands sit exactly middle +/- multiplier*ATR, and middle matches the plain EMA', () => {
    const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
    const highs = closes.map(c => c + 1)
    const lows = closes.map(c => c - 1)
    const candles: Candle[] = closes.map((c, i) => candle(i * DAY, c, highs[i], lows[i], c))

    const emaPeriod = 3
    const atrPeriod = 3
    const multiplier = 2
    const result = computeKeltner(candles, emaPeriod, atrPeriod, multiplier)
    const expectedMiddle = ema(closes, emaPeriod)
    const expectedAtr = atr(highs, lows, closes, atrPeriod)

    for (let i = 0; i < closes.length; i++) {
      expect(result.middle[i]).toEqual(expectedMiddle[i])
      if (expectedMiddle[i] != null && expectedAtr[i] != null) {
        expect(result.upper[i]).toBeCloseTo((expectedMiddle[i] as number) + multiplier * (expectedAtr[i] as number), 6)
        expect(result.lower[i]).toBeCloseTo((expectedMiddle[i] as number) - multiplier * (expectedAtr[i] as number), 6)
      } else {
        expect(result.upper[i]).toBeNull()
        expect(result.lower[i]).toBeNull()
      }
    }
  })
})

describe('computeSupertrend', () => {
  it('flags a bullish flip once a falling trend sharply reverses upward, and never flags bearish during the initial fall', () => {
    const closes = [
      50, 48, 46, 44, 42, 40, 38, 36, 34, 32, 30, // falling leg
      33, 38, 45, 54, 65, 78, 93, 110, 130, 153,  // sharply rising leg
    ]
    const candles: Candle[] = closes.map((c, i) => candle(i * DAY, c, c + 1, c - 1, c))
    const result = computeSupertrend(candles, 5, 3)

    const bullFlips = result.bullFlip.map((v, i) => (v === 1 ? i : null)).filter(v => v !== null) as number[]
    // A bear flip can legitimately fire in the first bar or two after ATR
    // warms up (the very first bar has to guess an initial trend, and a
    // falling series immediately corrects that guess) — that's cold-start
    // resolution, not a spurious signal. What must NOT happen is a bear
    // flip appearing once the series has been unambiguously falling for a
    // while, or anywhere in the sharply-rising leg after the reversal.
    const bearFlipsAfterSettled = result.bearFlip.slice(3, 11).filter(v => v === 1)
    const bearFlipsAfterReversal = result.bearFlip.slice(11).filter(v => v === 1)

    expect(bullFlips.length).toBeGreaterThan(0)
    expect(Math.min(...bullFlips)).toBeGreaterThanOrEqual(11)
    expect(bearFlipsAfterSettled.length).toBe(0)
    expect(bearFlipsAfterReversal.length).toBe(0)
  })

  it('keeps the line below price throughout a clean, steady uptrend', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i * 2)
    const candles: Candle[] = closes.map((c, i) => candle(i * DAY, c, c + 1, c - 1, c))
    const result = computeSupertrend(candles, 5, 3)
    for (let i = 15; i < closes.length; i++) {
      expect(result.value[i]).not.toBeNull()
      expect(result.value[i] as number).toBeLessThan(closes[i])
    }
  })
})

describe('computeParabolicSar', () => {
  it('tracks below price in a steady uptrend and flips when a sharp reversal breaches it', () => {
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i * 2)
    const closes = [...rising, 90, 80, 70, 60, 50] // sharp reversal
    const candles: Candle[] = closes.map((c, i) => candle(i * DAY, c, c + 1, c - 1, c))
    const result = computeParabolicSar(candles)

    for (let i = 5; i < rising.length; i++) {
      expect(result.value[i]).not.toBeNull()
      expect(result.value[i] as number).toBeLessThan(candles[i].low)
    }

    const bearFlips = result.bearFlip.map((v, i) => (v === 1 ? i : null)).filter(v => v !== null) as number[]
    expect(bearFlips.length).toBeGreaterThan(0)
    expect(Math.min(...bearFlips)).toBeGreaterThanOrEqual(rising.length)
  })
})
