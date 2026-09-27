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

// Wilder's recursive smoothing: a simple average over the first `period`
// non-null values as the seed, then the standard (prev*(period-1)+new)/period
// recursion — the exact convention `atr()` in indicators.ts already uses.
// Assumes `data` has no internal gaps once it starts being non-null (true for
// every series this is applied to below).
function wilderSmoothSeries(data: Series, period: number): Series {
  const n = data.length
  const result: Series = new Array(n).fill(null)
  const start = data.findIndex(v => v != null)
  if (start === -1 || start + period > n) return result
  let sum = 0
  for (let k = 0; k < period; k++) sum += data[start + k] as number
  const seedIdx = start + period - 1
  result[seedIdx] = sum / period
  for (let i = seedIdx + 1; i < n; i++) {
    result[i] = ((result[i - 1] as number) * (period - 1) + (data[i] as number)) / period
  }
  return result
}

/** ADX / +DI / -DI (Wilder). +DI/-DI are plain series a strategy can feed
 * directly into crossover/crossunder; ADX itself is a trend-STRENGTH
 * filter (commonly gated via above_value, e.g. "ADX > 25") rather than a
 * directional signal on its own. */
export interface AdxResult {
  plusDI: Series
  minusDI: Series
  adx: Series
}

export function computeAdx(candles: Candle[], period = 14): AdxResult {
  const highs = candles.map(c => c.high)
  const lows = candles.map(c => c.low)
  const closes = candles.map(c => c.close)
  const n = candles.length

  const tr: Series = new Array(n).fill(null)
  const plusDM: Series = new Array(n).fill(null)
  const minusDM: Series = new Array(n).fill(null)
  tr[0] = highs[0] - lows[0]
  plusDM[0] = 0
  minusDM[0] = 0
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]))
    const upMove = highs[i] - highs[i - 1]
    const downMove = lows[i - 1] - lows[i]
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0
  }

  const smoothedTR = wilderSmoothSeries(tr, period)
  const smoothedPlusDM = wilderSmoothSeries(plusDM, period)
  const smoothedMinusDM = wilderSmoothSeries(minusDM, period)

  const plusDI: Series = new Array(n).fill(null)
  const minusDI: Series = new Array(n).fill(null)
  const dx: Series = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    const trVal = smoothedTR[i]
    if (trVal == null || trVal === 0) continue
    plusDI[i] = (100 * (smoothedPlusDM[i] as number)) / trVal
    minusDI[i] = (100 * (smoothedMinusDM[i] as number)) / trVal
    const sum = (plusDI[i] as number) + (minusDI[i] as number)
    dx[i] = sum === 0 ? 0 : (100 * Math.abs((plusDI[i] as number) - (minusDI[i] as number))) / sum
  }

  const adx = wilderSmoothSeries(dx, period)
  return { plusDI, minusDI, adx }
}

/** Williams %R: identical shape to Stochastic's raw %K, rebased to a
 * -100..0 scale (%R = rawK - 100). Overbought > -20, oversold < -80. */
export function computeWilliamsR(candles: Candle[], period = 14): Series {
  const highs = candles.map(c => c.high)
  const lows = candles.map(c => c.low)
  const closes = candles.map(c => c.close)
  const n = candles.length
  const result: Series = new Array(n).fill(null)
  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity
    let lo = Infinity
    for (let k = i - period + 1; k <= i; k++) {
      if (highs[k] > hi) hi = highs[k]
      if (lows[k] < lo) lo = lows[k]
    }
    result[i] = hi === lo ? -50 : ((closes[i] - hi) / (hi - lo)) * 100
  }
  return result
}

/** OBV (On-Balance Volume): a cumulative running total, so it's defined
 * from bar 0 with no warmup. Exposed with its own SMA, since OBV's raw
 * value only means something as a trend versus that average — a strategy
 * reacts via crossover(obv, obv_ma), the same pattern as price vs. a
 * moving average. */
export interface ObvResult {
  obv: Series
  ma: Series
}

export function computeObv(candles: Candle[], maPeriod = 20): ObvResult {
  const n = candles.length
  const obv: Series = new Array(n).fill(null)
  obv[0] = candles[0]?.volume ?? 0
  for (let i = 1; i < n; i++) {
    const prevObv = obv[i - 1] as number
    if (candles[i].close > candles[i - 1].close) obv[i] = prevObv + (candles[i].volume ?? 0)
    else if (candles[i].close < candles[i - 1].close) obv[i] = prevObv - (candles[i].volume ?? 0)
    else obv[i] = prevObv
  }
  return { obv, ma: smaOfSeries(obv, maPeriod) }
}

/** MFI (Money Flow Index): RSI's formula applied to volume-weighted typical
 * price instead of raw price — a rolling SUM of positive/negative money
 * flow over `period` bars (not Wilder-smoothed, matching the standard MFI
 * definition, unlike RSI's own smoothing). */
export function computeMfi(candles: Candle[], period = 14): Series {
  const n = candles.length
  const tp = candles.map(c => (c.high + c.low + c.close) / 3)
  const rawFlow = candles.map((c, i) => tp[i] * (c.volume ?? 0))
  const positiveFlow: number[] = new Array(n).fill(0)
  const negativeFlow: number[] = new Array(n).fill(0)
  for (let i = 1; i < n; i++) {
    if (tp[i] > tp[i - 1]) positiveFlow[i] = rawFlow[i]
    else if (tp[i] < tp[i - 1]) negativeFlow[i] = rawFlow[i]
  }

  const result: Series = new Array(n).fill(null)
  for (let i = period; i < n; i++) {
    let posSum = 0
    let negSum = 0
    for (let k = i - period + 1; k <= i; k++) {
      posSum += positiveFlow[k]
      negSum += negativeFlow[k]
    }
    if (negSum === 0) result[i] = 100
    else {
      const ratio = posSum / negSum
      result[i] = 100 - 100 / (1 + ratio)
    }
  }
  return result
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
