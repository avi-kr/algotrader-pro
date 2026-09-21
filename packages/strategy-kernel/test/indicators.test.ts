import { describe, it, expect } from 'vitest'
import { ema, sma, rsi, crossover, crossunder } from '../src/indicators'

describe('sma', () => {
  it('matches hand-computed values', () => {
    // last-3 averages of [1,2,3,4,5]: (1+2+3)/3=2, (2+3+4)/3=3, (3+4+5)/3=4
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
  })
})

describe('ema', () => {
  it('matches hand-computed values (k=0.5 for period 3)', () => {
    // seed = SMA(1,2,3) = 2; k = 2/(3+1) = 0.5
    // ema[3] = 4*0.5 + 2*0.5 = 3; ema[4] = 5*0.5 + 3*0.5 = 4
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
  })
})

describe('rsi', () => {
  it('is exactly 100 for a strictly increasing series (zero average loss)', () => {
    const data = Array.from({ length: 16 }, (_, i) => i + 1) // 1..16, period 14
    const result = rsi(data, 14)
    expect(result[14]).toBe(100)
  })

  it('is exactly 0 for a strictly decreasing series (zero average gain)', () => {
    const data = Array.from({ length: 16 }, (_, i) => 16 - i) // 16..1, period 14
    const result = rsi(data, 14)
    expect(result[14]).toBe(0)
  })
})

describe('crossover / crossunder', () => {
  const a = [1, 1, 3, 3]
  const b = [2, 2, 2, 2]
  it('detects an upward cross the bar it happens', () => {
    expect(crossover(a, b, 1)).toBe(false)
    expect(crossover(a, b, 2)).toBe(true) // a goes 1<=2 -> 3>2
    expect(crossover(a, b, 3)).toBe(false) // already above, not a fresh cross
  })
  it('detects a downward cross the bar it happens', () => {
    const c = [3, 3, 1, 1]
    expect(crossunder(c, b, 2)).toBe(true)
    expect(crossunder(c, b, 3)).toBe(false)
  })
})
