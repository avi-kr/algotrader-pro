import type { Candle, IndicatorConfig, Condition } from '@algotrader/shared-types'

export type Series = Array<number | null>

export function ema(data: number[], period: number): Series {
  if (!data || data.length < period) return []
  const k = 2 / (period + 1)
  const result: Series = new Array(data.length).fill(null)

  let sum = 0
  for (let i = 0; i < period; i++) sum += data[i]
  result[period - 1] = sum / period

  for (let i = period; i < data.length; i++) {
    result[i] = data[i] * k + (result[i - 1] as number) * (1 - k)
  }
  return result
}

export function sma(data: number[], period: number): Series {
  if (!data || data.length < period) return []
  const result: Series = new Array(data.length).fill(null)

  let sum = 0
  for (let i = 0; i < period; i++) sum += data[i]
  result[period - 1] = sum / period

  for (let i = period; i < data.length; i++) {
    sum = sum - data[i - period] + data[i]
    result[i] = sum / period
  }
  return result
}

export function rsi(data: number[], period = 14): Series {
  if (!data || data.length < period + 1) return []
  const result: Series = new Array(data.length).fill(null)

  let gains = 0
  let losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = data[i] - data[i - 1]
    if (diff > 0) gains += diff
    else losses -= diff
  }

  let avgGain = gains / period
  let avgLoss = losses / period
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return result
}

export function macd(data: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(data, fast)
  const emaSlow = ema(data, slow)
  const macdLine: Series = data.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? (emaFast[i] as number) - (emaSlow[i] as number) : null
  )
  const macdValues = macdLine.filter((v): v is number => v != null)
  const signalValues = ema(macdValues, signal)

  const signalLine: Series = new Array(data.length).fill(null)
  let signalIdx = 0
  for (let i = 0; i < data.length; i++) {
    if (macdLine[i] != null) {
      signalLine[i] = signalValues[signalIdx++] ?? null
    }
  }

  const histogram: Series = data.map((_, i) =>
    macdLine[i] != null && signalLine[i] != null ? (macdLine[i] as number) - (signalLine[i] as number) : null
  )

  return { macd: macdLine, signal: signalLine, histogram }
}

export function bollingerBands(data: number[], period = 20, stdDev = 2) {
  const middle = sma(data, period)
  const upper: Series = new Array(data.length).fill(null)
  const lower: Series = new Array(data.length).fill(null)

  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1)
    const mean = middle[i] as number
    const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period
    const sd = Math.sqrt(variance)
    upper[i] = mean + stdDev * sd
    lower[i] = mean - stdDev * sd
  }
  return { upper, middle, lower }
}

export function atr(highs: number[], lows: number[], closes: number[], period = 14): Series {
  const tr: Series = new Array(highs.length).fill(null)
  const result: Series = new Array(highs.length).fill(null)

  tr[0] = highs[0] - lows[0]
  for (let i = 1; i < highs.length; i++) {
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    )
  }

  let sum = 0
  for (let i = 0; i < period; i++) sum += tr[i] as number
  result[period - 1] = sum / period

  for (let i = period; i < tr.length; i++) {
    result[i] = ((result[i - 1] as number) * (period - 1) + (tr[i] as number)) / period
  }
  return result
}

export function vwap(highs: number[], lows: number[], closes: number[], volumes: number[]): Series {
  const result: Series = []
  let cumulativeTPV = 0
  let cumulativeVolume = 0

  for (let i = 0; i < closes.length; i++) {
    const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3
    cumulativeTPV += typicalPrice * volumes[i]
    cumulativeVolume += volumes[i]
    result.push(cumulativeVolume === 0 ? null : cumulativeTPV / cumulativeVolume)
  }
  return result
}

export function crossover(a: Series, b: Series, i: number): boolean {
  if (i === 0) return false
  return (
    a[i - 1] != null && b[i - 1] != null &&
    a[i] != null && b[i] != null &&
    (a[i - 1] as number) <= (b[i - 1] as number) && (a[i] as number) > (b[i] as number)
  )
}

export function crossunder(a: Series, b: Series, i: number): boolean {
  if (i === 0) return false
  return (
    a[i - 1] != null && b[i - 1] != null &&
    a[i] != null && b[i] != null &&
    (a[i - 1] as number) >= (b[i - 1] as number) && (a[i] as number) < (b[i] as number)
  )
}

export type ComputedSeries = Record<string, Series>

/** Computes every indicator series over the FULL candle array. This is safe
 * for use at bar `i` in the backtester because every indicator here (EMA,
 * SMA, RSI, MACD, BB, ATR, VWAP) is causal — `series[i]` is a function of
 * `candles[0..i]` only, never of future bars. The no-look-ahead guarantee for
 * signals therefore reduces to "only read `computed[key][i]`, never
 * `computed[key][j]` for `j > i`", which is exactly what `checkConditions`
 * below does. */
export function calculateIndicators(candles: Candle[], indicators: IndicatorConfig[]): ComputedSeries {
  const closes = candles.map(c => c.close)
  const highs = candles.map(c => c.high)
  const lows = candles.map(c => c.low)
  const volumes = candles.map(c => c.volume ?? 1)

  const computed: ComputedSeries = {}

  for (const ind of indicators) {
    switch (ind.type) {
      case 'EMA':
        computed[ind.id] = ema(closes, ind.period ?? 20)
        break
      case 'SMA':
        computed[ind.id] = sma(closes, ind.period ?? 20)
        break
      case 'RSI':
        computed[ind.id] = rsi(closes, ind.period ?? 14)
        break
      case 'MACD': {
        const m = macd(closes, ind.fast ?? 12, ind.slow ?? 26, ind.signal ?? 9)
        computed[`${ind.id}_macd`] = m.macd
        computed[`${ind.id}_signal`] = m.signal
        computed[`${ind.id}_hist`] = m.histogram
        computed[ind.id] = m.macd
        break
      }
      case 'BB': {
        const bb = bollingerBands(closes, ind.period ?? 20, ind.stdDev ?? 2)
        computed[`${ind.id}_upper`] = bb.upper
        computed[`${ind.id}_middle`] = bb.middle
        computed[`${ind.id}_lower`] = bb.lower
        computed[ind.id] = bb.middle
        break
      }
      case 'ATR':
        computed[ind.id] = atr(highs, lows, closes, ind.period ?? 14)
        break
      case 'VWAP':
        computed[ind.id] = vwap(highs, lows, closes, volumes)
        break
      default:
        break
    }
  }

  return computed
}

export function checkCondition(condition: Condition, computed: ComputedSeries, i: number): boolean {
  const { type, a, b, value } = condition
  const seriesA = computed[a]
  const seriesB = b ? computed[b] : null

  if (!seriesA) return false

  switch (type) {
    case 'crossover':
      return seriesB ? crossover(seriesA, seriesB, i) : false
    case 'crossunder':
      return seriesB ? crossunder(seriesA, seriesB, i) : false
    case 'above':
      return seriesA[i] != null && seriesB?.[i] != null && (seriesA[i] as number) > (seriesB[i] as number)
    case 'below':
      return seriesA[i] != null && seriesB?.[i] != null && (seriesA[i] as number) < (seriesB[i] as number)
    case 'above_value':
      return seriesA[i] != null && (seriesA[i] as number) > parseFloat(String(value))
    case 'below_value':
      return seriesA[i] != null && (seriesA[i] as number) < parseFloat(String(value))
    default:
      return false
  }
}

/** AND-logic evaluation of a condition group at bar `i`. Only ever call this
 * with `i` = the bar whose CLOSE has just been observed — never a future bar
 * — and use the result to place an order that fills at bar `i+1`'s open. See
 * `runBacktest` in `./backtest.ts` for the enforced fill timing. */
export function checkConditions(conditions: Condition[] | undefined, computed: ComputedSeries, i: number): boolean {
  if (!conditions || conditions.length === 0) return false
  return conditions.every(c => checkCondition(c, computed, i))
}
