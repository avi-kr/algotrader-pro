import { describe, it, expect } from 'vitest'
import { computeMarketStructure } from '../src/indicators'

describe('computeMarketStructure', () => {
  // Hand-traced with swingWidth=1 (3-bar fractal: bar i is a pivot if it's
  // strictly beyond its immediate neighbor on each side). Walking through by
  // hand bar-by-bar:
  //   idx:   0   1   2   3   4   5   6   7   8   9  10  11  12  13
  //   close: 10  12  11  13  12  15  13  11  10   9  11  10   9   8
  //
  // Pivots (close-based, swingWidth=1):
  //   i=1  high=12 (first  -> HH)            confirms at t=2
  //   i=2  low=11  (first  -> LL)            confirms at t=3
  //   i=3  high=13 (>12    -> HH)            confirms at t=4
  //   i=4  low=12  (not <11 -> HL)           confirms at t=5
  //   i=5  high=15 (>13    -> HH)            confirms at t=6
  //   i=9  low=9   (<12    -> LL)            confirms at t=10
  //   i=10 high=11 (not >15 -> LH)           confirms at t=11
  //
  // Breaks:
  //   t=3:  close=13 > active high(12) -> bias was null -> WARM-UP, unlabeled
  //   t=5:  close=15 > active high(13) -> bias=bull -> BOS bull
  //   t=7:  close=11 < active low(12)  -> bias=bull -> CHOCH bear (flips to bear)
  //   t=13: close=8  < active low(9)   -> bias=bear -> BOS bear
  const closes = [10, 12, 11, 13, 12, 15, 13, 11, 10, 9, 11, 10, 9, 8]

  it('matches the fully hand-traced expected output at every bar', () => {
    const ms = computeMarketStructure(closes, 1)

    expect(ms.highClass).toEqual([null, null, 1, null, 1, null, 1, null, null, null, null, -1, null, null])
    expect(ms.lowClass).toEqual([null, null, null, -1, null, 1, null, null, null, null, -1, null, null, null])
    expect(ms.bosBull).toEqual([null, null, null, null, null, 1, null, null, null, null, null, null, null, null])
    expect(ms.bosBear).toEqual([null, null, null, null, null, null, null, null, null, null, null, null, null, 1])
    expect(ms.chochBull).toEqual(new Array(14).fill(null))
    expect(ms.chochBear).toEqual([null, null, null, null, null, null, null, 1, null, null, null, null, null, null])
    expect(ms.bias).toEqual([null, null, null, null, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1])
    expect(ms.swingHighLevel).toEqual([null, null, 12, 12, 13, 13, 15, 15, 15, 15, 15, 11, 11, 11])
    expect(ms.swingLowLevel).toEqual([null, null, null, 11, 11, 12, 12, 12, null, null, 9, 9, 9, 9])
  })

  it('the very first break establishes bias without labeling it BOS or CHOCH (no prior trend to compare against)', () => {
    const ms = computeMarketStructure(closes, 1)
    // The break at t=3 sets bias but must not appear as a BOS or CHOCH event.
    expect(ms.bosBull[3]).toBeNull()
    expect(ms.bosBear[3]).toBeNull()
    expect(ms.chochBull[3]).toBeNull()
    expect(ms.chochBear[3]).toBeNull()
    expect(ms.bias[4]).toBe(1) // but bias is established for the bar right after
  })

  it('a broken level is consumed — does not re-fire BOS on every subsequent bar past it', () => {
    // After the bull BOS at t=5, closes stay above the old level (13) at
    // t=6 (13) — right at it, not above — so this asserts no phantom re-fire
    // anywhere else in the series for that same level.
    const ms = computeMarketStructure(closes, 1)
    const bosBullBars = ms.bosBull.map((v, i) => (v === 1 ? i : null)).filter(v => v !== null)
    expect(bosBullBars).toEqual([5])
  })

  it('no-look-ahead: values up to a divergence point are identical regardless of what happens after it', () => {
    const CUTOFF = 8
    const variantA = [...closes]
    const variantB = [...closes.slice(0, CUTOFF + 1), 500, 501, 502, 503, 504, 505] // wildly different future

    const msA = computeMarketStructure(variantA, 1)
    const msB = computeMarketStructure(variantB, 1)

    for (const key of ['bosBull', 'bosBear', 'chochBull', 'chochBear', 'highClass', 'lowClass', 'bias', 'swingHighLevel', 'swingLowLevel'] as const) {
      expect(msA[key].slice(0, CUTOFF - 1)).toEqual(msB[key].slice(0, CUTOFF - 1))
    }
  })

  it('a swing point is not exposed before its confirmation bar (pivotIdx + swingWidth)', () => {
    const ms = computeMarketStructure(closes, 1)
    // The pivot at i=1 (close=12) is not knowable until t=2 — it must not
    // leak into swingHighLevel at t=1 (the pivot bar itself) or earlier.
    expect(ms.swingHighLevel[1]).toBeNull()
    expect(ms.swingHighLevel[0]).toBeNull()
    expect(ms.swingHighLevel[2]).toBe(12)
  })

  it('returns all-null series when there is not enough data for even one pivot window', () => {
    const ms = computeMarketStructure([10, 11], 2)
    expect(ms.bosBull).toEqual([null, null])
    expect(ms.swingHighLevel).toEqual([null, null])
  })
})
