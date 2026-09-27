import type { Candle } from '@algotrader/shared-types'
import { atr, sma, type Series } from './indicators'

function smaOfSeries(data: Series, period: number): Series {
  const n = data.length
  const result: Series = new Array(n).fill(null)
  if (period <= 0) return result
  for (let i = period - 1; i < n; i++) {
    let sum = 0
    let ok = true
    for (let k = 0; k < period; k++) {
      const v = data[i - k]
      if (v == null) { ok = false; break }
      sum += v
    }
    if (ok) result[i] = sum / period
  }
  return result
}

/** Supertrend: the classic ATR-based trend-following line. Bullish when
 * price holds above it (it then tracks as a rising support floor);
 * bearish when price holds below (tracks as a falling resistance ceiling).
 * Flip events fire exactly on the bar the trend switches. */
export interface SupertrendResult {
  value: Series
  bullFlip: Series
  bearFlip: Series
}

export function computeSupertrend(candles: Candle[], atrPeriod = 10, multiplier = 3): SupertrendResult {
  const highs = candles.map(c => c.high)
  const lows = candles.map(c => c.low)
  const closes = candles.map(c => c.close)
  const atrSeries = atr(highs, lows, closes, atrPeriod)
  const n = candles.length
  const result: SupertrendResult = { value: new Array(n).fill(null), bullFlip: new Array(n).fill(null), bearFlip: new Array(n).fill(null) }

  let finalUpper: number | null = null
  let finalLower: number | null = null
  let trendBullish: boolean | null = null

  for (let i = 0; i < n; i++) {
    const atrVal = atrSeries[i]
    if (atrVal == null) continue
    const basicUpper = (highs[i] + lows[i]) / 2 + multiplier * atrVal
    const basicLower = (highs[i] + lows[i]) / 2 - multiplier * atrVal

    if (finalUpper == null || finalLower == null) {
      finalUpper = basicUpper
      finalLower = basicLower
      // `closes[i] > basicLower` is a bad seed here: basicLower is
      // constructed to sit below price by design, so that comparison is
      // true almost regardless of actual trend direction, which produced a
      // spurious flip one bar after warmup in genuine downtrends. Seed off
      // real price movement instead — has price net risen or fallen over
      // the ATR lookback window.
      const lookbackIdx = Math.max(0, i - atrPeriod)
      trendBullish = closes[i] >= closes[lookbackIdx]
      result.value[i] = trendBullish ? finalLower : finalUpper
      continue
    }

    const prevClose = closes[i - 1]
    finalUpper = basicUpper < finalUpper || prevClose > finalUpper ? basicUpper : finalUpper
    finalLower = basicLower > finalLower || prevClose < finalLower ? basicLower : finalLower

    const wasBullish = trendBullish
    if (trendBullish) {
      if (closes[i] < finalLower) trendBullish = false
    } else {
      if (closes[i] > finalUpper) trendBullish = true
    }

    result.value[i] = trendBullish ? finalLower : finalUpper
    if (wasBullish != null && trendBullish !== wasBullish) {
      if (trendBullish) result.bullFlip[i] = 1
      else result.bearFlip[i] = 1
    }
  }
  return result
}

/** Keltner Channel: EMA middle line +/- an ATR multiple. Exposed as plain
 * numeric series — a strategy reacts to breakouts the same way BB-based
 * strategies already do, via crossover/crossunder against `close`. */
export interface KeltnerResult {
  middle: Series
  upper: Series
  lower: Series
}

export function computeKeltner(candles: Candle[], emaPeriod = 20, atrPeriod = 10, multiplier = 2): KeltnerResult {
  const closes = candles.map(c => c.close)
  const highs = candles.map(c => c.high)
  const lows = candles.map(c => c.low)
  // Local EMA (avoids a circular import with indicators.ts for a one-liner).
  const n = candles.length
  const middle: Series = new Array(n).fill(null)
  if (n >= emaPeriod) {
    const k = 2 / (emaPeriod + 1)
    let sum = 0
    for (let i = 0; i < emaPeriod; i++) sum += closes[i]
    middle[emaPeriod - 1] = sum / emaPeriod
    for (let i = emaPeriod; i < n; i++) middle[i] = closes[i] * k + (middle[i - 1] as number) * (1 - k)
  }
  const atrSeries = atr(highs, lows, closes, atrPeriod)
  const upper: Series = new Array(n).fill(null)
  const lower: Series = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    if (middle[i] == null || atrSeries[i] == null) continue
    upper[i] = (middle[i] as number) + multiplier * (atrSeries[i] as number)
    lower[i] = (middle[i] as number) - multiplier * (atrSeries[i] as number)
  }
  return { middle, upper, lower }
}

/** Stochastic Oscillator: %K = 100 * (close - lowestLow(period)) /
 * (highestHigh(period) - lowestLow(period)), smoothed by smoothK, then %D
 * is a further SMA(smoothD) of %K. */
export interface StochasticResult {
  k: Series
  d: Series
}

export function computeStochastic(candles: Candle[], period = 14, smoothK = 3, smoothD = 3): StochasticResult {
  const highs = candles.map(c => c.high)
  const lows = candles.map(c => c.low)
  const closes = candles.map(c => c.close)
  const n = candles.length
  const rawK: Series = new Array(n).fill(null)
  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity
    let lo = Infinity
    for (let k = i - period + 1; k <= i; k++) {
      if (highs[k] > hi) hi = highs[k]
      if (lows[k] < lo) lo = lows[k]
    }
    rawK[i] = hi === lo ? 50 : ((closes[i] - lo) / (hi - lo)) * 100
  }
  const k = smoothK > 1 ? smaOfSeries(rawK, smoothK) : rawK
  const d = smaOfSeries(k, smoothD)
  return { k, d }
}

/** Parabolic SAR: Wilder's original iterative formula. Flip events fire
 * exactly on the bar price crosses the current SAR and the trend reverses. */
export interface ParabolicSarResult {
  value: Series
  bullFlip: Series
  bearFlip: Series
}

export function computeParabolicSar(candles: Candle[], step = 0.02, maxStep = 0.2): ParabolicSarResult {
  const n = candles.length
  const result: ParabolicSarResult = { value: new Array(n).fill(null), bullFlip: new Array(n).fill(null), bearFlip: new Array(n).fill(null) }
  if (n < 2) return result

  let isUptrend = candles[1].close > candles[0].close
  let sar = isUptrend ? candles[0].low : candles[0].high
  let ep = isUptrend ? candles[0].high : candles[0].low
  let af = step
  result.value[0] = sar

  for (let i = 1; i < n; i++) {
    let nextSar = sar + af * (ep - sar)
    const prevExtreme = i >= 2 ? candles[i - 2] : candles[i - 1]

    if (isUptrend) {
      nextSar = Math.min(nextSar, candles[i - 1].low, prevExtreme.low)
      if (candles[i].high > ep) { ep = candles[i].high; af = Math.min(af + step, maxStep) }
      if (candles[i].low < nextSar) {
        isUptrend = false
        nextSar = ep
        ep = candles[i].low
        af = step
        result.bearFlip[i] = 1
      }
    } else {
      nextSar = Math.max(nextSar, candles[i - 1].high, prevExtreme.high)
      if (candles[i].low < ep) { ep = candles[i].low; af = Math.min(af + step, maxStep) }
      if (candles[i].high > nextSar) {
        isUptrend = true
        nextSar = ep
        ep = candles[i].high
        af = step
        result.bullFlip[i] = 1
      }
    }
    sar = nextSar
    result.value[i] = sar
  }
  return result
}

/** CCI (Commodity Channel Index): (typicalPrice - SMA(typicalPrice)) /
 * (0.015 * meanAbsoluteDeviation). Standard constant, unchanged. */
export function computeCci(candles: Candle[], period = 20): Series {
  const n = candles.length
  const tp = candles.map(c => (c.high + c.low + c.close) / 3)
  const smaTp = sma(tp, period)
  const result: Series = new Array(n).fill(null)
  for (let i = period - 1; i < n; i++) {
    if (smaTp[i] == null) continue
    const mean = smaTp[i] as number
    let meanDev = 0
    for (let k = i - period + 1; k <= i; k++) meanDev += Math.abs(tp[k] - mean)
    meanDev /= period
    result[i] = meanDev === 0 ? 0 : (tp[i] - mean) / (0.015 * meanDev)
  }
  return result
}

/** Ichimoku Tenkan-sen/Kijun-sen (the "TK cross" — the most commonly
 * automated Ichimoku signal). Exposed as plain numeric series; a strategy
 * uses crossover/crossunder against them the same way it would EMA/SMA. */
export interface IchimokuTKResult {
  tenkan: Series
  kijun: Series
}

export function computeIchimokuTK(candles: Candle[], tenkanPeriod = 9, kijunPeriod = 26): IchimokuTKResult {
  const highs = candles.map(c => c.high)
  const lows = candles.map(c => c.low)
  const n = candles.length
  const midpoint = (period: number): Series => {
    const result: Series = new Array(n).fill(null)
    for (let i = period - 1; i < n; i++) {
      let hi = -Infinity
      let lo = Infinity
      for (let k = i - period + 1; k <= i; k++) {
        if (highs[k] > hi) hi = highs[k]
        if (lows[k] < lo) lo = lows[k]
      }
      result[i] = (hi + lo) / 2
    }
    return result
  }
  return { tenkan: midpoint(tenkanPeriod), kijun: midpoint(kijunPeriod) }
}
