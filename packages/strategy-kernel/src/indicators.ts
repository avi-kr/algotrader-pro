import type { Candle, IndicatorConfig, Condition } from '@algotrader/shared-types'
import {
  computeLiquiditySweep, computeFVG, computeOrderBlocks, computeImbalance,
  computeLiquidityVoid, computePremiumDiscount, computeBreakoutRetest,
  computeORB, computeSRPriceAction,
} from './smc'

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

function wmaNumeric(data: number[], period: number): Series {
  const n = data.length
  const result: Series = new Array(n).fill(null)
  if (period <= 0) return result
  const denom = (period * (period + 1)) / 2
  for (let i = period - 1; i < n; i++) {
    let sum = 0
    for (let k = 0; k < period; k++) sum += data[i - k] * (period - k)
    result[i] = sum / denom
  }
  return result
}

function wmaOfSeries(data: Series, period: number): Series {
  const n = data.length
  const result: Series = new Array(n).fill(null)
  if (period <= 0) return result
  const denom = (period * (period + 1)) / 2
  for (let i = period - 1; i < n; i++) {
    let sum = 0
    let ok = true
    for (let k = 0; k < period; k++) {
      const v = data[i - k]
      if (v == null) { ok = false; break }
      sum += v * (period - k)
    }
    if (ok) result[i] = sum / denom
  }
  return result
}

/** Hull Moving Average: HMA(n) = WMA(2*WMA(price, n/2) - WMA(price, n), round(sqrt(n))).
 * Standard formula, unchanged from the classic definition. */
export function hma(closes: number[], period: number): Series {
  const halfPeriod = Math.max(1, Math.round(period / 2))
  const sqrtPeriod = Math.max(1, Math.round(Math.sqrt(period)))
  const wmaHalf = wmaNumeric(closes, halfPeriod)
  const wmaFull = wmaNumeric(closes, period)
  const raw: Series = closes.map((_, i) => {
    if (wmaHalf[i] == null || wmaFull[i] == null) return null
    return 2 * (wmaHalf[i] as number) - (wmaFull[i] as number)
  })
  return wmaOfSeries(raw, sqrtPeriod)
}

/** Hull Suite: the popular TradingView indicator's own convention — color
 * (trend) is bullish when the HMA sits above its own value 2 bars back,
 * bearish otherwise. A "switch"/flip event fires exactly on the bar this
 * comparison changes sign, not on every bar of the same color. */
export interface HullSuiteResult {
  hma: Series
  bullFlip: Series
  bearFlip: Series
}

export function computeHullSuite(closes: number[], period = 55): HullSuiteResult {
  const h = hma(closes, period)
  const n = closes.length
  const result: HullSuiteResult = { hma: h, bullFlip: new Array(n).fill(null), bearFlip: new Array(n).fill(null) }
  let prevBullish: boolean | null = null
  for (let i = 2; i < n; i++) {
    if (h[i] == null || h[i - 2] == null) continue
    const bullish = (h[i] as number) > (h[i - 2] as number)
    if (prevBullish != null) {
      if (bullish && !prevBullish) result.bullFlip[i] = 1
      if (!bullish && prevBullish) result.bearFlip[i] = 1
    }
    prevBullish = bullish
  }
  return result
}

/** Rolling High/Low breakout (Donchian-style): highest/lowest over the
 * PRIOR `period` bars, excluding the current bar (so "today's close breaks
 * the prior N-bar high" is meaningful rather than trivially true of every
 * bar's own extreme). `period <= 0` means an EXPANDING, all-time window
 * from the very first available bar up to (but not including) the current
 * one — used for the "All-Time High/Low" variant. */
export interface RollingExtremeResult {
  highest: Series
  lowest: Series
  breakoutHigh: Series
  breakoutLow: Series
}

export function computeRollingExtreme(candles: Candle[], period = 0): RollingExtremeResult {
  const n = candles.length
  const result: RollingExtremeResult = {
    highest: new Array(n).fill(null),
    lowest: new Array(n).fill(null),
    breakoutHigh: new Array(n).fill(null),
    breakoutLow: new Array(n).fill(null),
  }
  for (let i = 1; i < n; i++) {
    const start = period > 0 ? Math.max(0, i - period) : 0
    let hi = -Infinity
    let lo = Infinity
    for (let k = start; k < i; k++) {
      if (candles[k].high > hi) hi = candles[k].high
      if (candles[k].low < lo) lo = candles[k].low
    }
    if (hi === -Infinity) continue
    result.highest[i] = hi
    result.lowest[i] = lo
    if (candles[i].close > hi) result.breakoutHigh[i] = 1
    if (candles[i].close < lo) result.breakoutLow[i] = 1
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

export interface MarketStructure {
  /** +1 once a bullish BOS confirms on this bar, else null. Consumed on
   * confirmation — never repeats every bar while price stays above the
   * broken level, only fires on the specific break bar. */
  bosBull: Series
  bosBear: Series
  /** +1 on the bar a bullish/bearish Change of Character confirms. */
  chochBull: Series
  chochBear: Series
  /** The active (most recently confirmed, not yet broken) swing high/low
   * price, held constant bar-to-bar until broken or replaced — this is the
   * "resistance"/"support" ray a chart would draw. */
  swingHighLevel: Series
  swingLowLevel: Series
  /** +1 = Higher High / Higher Low, -1 = Lower High / Lower Low. Only set on
   * the bar a swing is CONFIRMED, else null. */
  highClass: Series
  lowClass: Series
  /** +1 bullish, -1 bearish, null = not yet established (fewer than one
   * confirmed swing high AND low exist, or the very first, unlabeled break). */
  bias: Series
}

/**
 * Deterministic market-structure detection: swing highs/lows (close-price
 * fractals, confirmed `swingWidth` bars after they form — a pivot at bar `i`
 * cannot be known until bar `i + swingWidth`, so every series here only
 * becomes non-null starting at each event's own confirmation bar, never at
 * the pivot bar itself), Break of Structure (a confirmed break past the
 * active swing level in the direction of the prevailing bias — continuation),
 * and Change of Character (the first break in the OPPOSITE direction —
 * reversal, which flips bias). A broken level is consumed immediately so
 * BOS/CHOCH fire exactly once per break, not on every subsequent bar that
 * stays past it. `maxAgeBars` drops a confirmed swing from consideration
 * once it's this stale, so structure logic never reacts to an ancient,
 * irrelevant level on a long-quiet chart.
 */
export function computeMarketStructure(closes: number[], swingWidth = 2, maxAgeBars = 500): MarketStructure {
  const n = closes.length
  const result: MarketStructure = {
    bosBull: new Array(n).fill(null),
    bosBear: new Array(n).fill(null),
    chochBull: new Array(n).fill(null),
    chochBear: new Array(n).fill(null),
    swingHighLevel: new Array(n).fill(null),
    swingLowLevel: new Array(n).fill(null),
    highClass: new Array(n).fill(null),
    lowClass: new Array(n).fill(null),
    bias: new Array(n).fill(null),
  }
  if (n < swingWidth * 2 + 1) return result

  // Pass 1: raw fractal pivots on CLOSE price, each carrying the bar index
  // at which it becomes knowable (pivotIdx + swingWidth) and its HH/LH or
  // HL/LL classification relative to the previous confirmed swing of the
  // same type — classification only compares same-type swings, independent
  // of trend bias.
  type SwingEvent = { confirmIdx: number; type: 'high' | 'low'; price: number; pivotIdx: number; cls: 1 | -1 }
  const events: SwingEvent[] = []
  let prevHighPrice: number | null = null
  let prevLowPrice: number | null = null

  for (let i = swingWidth; i < n - swingWidth; i++) {
    let isHigh = true
    let isLow = true
    for (let k = 1; k <= swingWidth; k++) {
      if (isHigh && !(closes[i] > closes[i - k] && closes[i] > closes[i + k])) isHigh = false
      if (isLow && !(closes[i] < closes[i - k] && closes[i] < closes[i + k])) isLow = false
      if (!isHigh && !isLow) break
    }
    if (isHigh) {
      const cls: 1 | -1 = prevHighPrice === null || closes[i] > prevHighPrice ? 1 : -1
      events.push({ confirmIdx: i + swingWidth, type: 'high', price: closes[i], pivotIdx: i, cls })
      prevHighPrice = closes[i]
    }
    if (isLow) {
      const cls: 1 | -1 = prevLowPrice === null || closes[i] < prevLowPrice ? -1 : 1
      events.push({ confirmIdx: i + swingWidth, type: 'low', price: closes[i], pivotIdx: i, cls })
      prevLowPrice = closes[i]
    }
  }
  // confirmIdx = pivotIdx + swingWidth is strictly increasing with pivotIdx,
  // and pivotIdx only increases through the loop above, so events are
  // already confirmIdx-ordered — no sort needed.

  // Pass 2: walk bar-by-bar, applying swing confirmations as we reach them,
  // then checking whether THIS bar's close breaks the active level.
  let eventPtr = 0
  let activeHigh: { price: number; pivotIdx: number } | null = null
  let activeLow: { price: number; pivotIdx: number } | null = null
  let bias: 'bull' | 'bear' | null = null

  for (let t = 0; t < n; t++) {
    while (eventPtr < events.length && events[eventPtr].confirmIdx === t) {
      const ev = events[eventPtr]
      if (ev.type === 'high') {
        activeHigh = { price: ev.price, pivotIdx: ev.pivotIdx }
        result.highClass[t] = ev.cls
      } else {
        activeLow = { price: ev.price, pivotIdx: ev.pivotIdx }
        result.lowClass[t] = ev.cls
      }
      eventPtr++
    }

    result.swingHighLevel[t] = activeHigh ? activeHigh.price : null
    result.swingLowLevel[t] = activeLow ? activeLow.price : null
    result.bias[t] = bias === 'bull' ? 1 : bias === 'bear' ? -1 : null

    const highStale = activeHigh != null && t - activeHigh.pivotIdx > maxAgeBars
    const lowStale = activeLow != null && t - activeLow.pivotIdx > maxAgeBars

    if (activeHigh && !highStale && closes[t] > activeHigh.price) {
      if (bias === 'bull') result.bosBull[t] = 1
      else if (bias === 'bear') { result.chochBull[t] = 1; bias = 'bull' }
      else bias = 'bull' // warm-up: first break establishes bias, unlabeled
      activeHigh = null // consumed — won't re-trigger every bar past this level
    } else if (activeLow && !lowStale && closes[t] < activeLow.price) {
      if (bias === 'bear') result.bosBear[t] = 1
      else if (bias === 'bull') { result.chochBear[t] = 1; bias = 'bear' }
      else bias = 'bear'
      activeLow = null
    }
  }

  return result
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
  const opens = candles.map(c => c.open)
  const volumes = candles.map(c => c.volume ?? 1)

  // Raw OHLC price series, always available for conditions to reference
  // directly (e.g. "close is below the Bollinger lower band," "close is
  // above SMA 200") without needing a dedicated "price" indicator. Also
  // causal — bar `i`'s value is just candles[i]'s own price, so the
  // no-look-ahead guarantee above still holds. An indicator explicitly
  // declared with one of these ids overwrites the raw series below, on
  // purpose — indicators are processed after this block.
  const computed: ComputedSeries = {
    open: opens,
    high: highs,
    low: lows,
    close: closes,
    volume: volumes,
  }

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
      case 'MARKET_STRUCTURE': {
        // `period` doubles as swingWidth here (BB reuses its own `period`/
        // `stdDev` fields the same way) — a strategy's condition config
        // reacts to these as 0/1-ish event series via above_value/below_value
        // against 0.5, e.g. { type: 'above_value', a: 'ms_bos_bull', value: 0.5 }
        // fires exactly on the bar a bullish BOS confirms.
        const ms = computeMarketStructure(closes, ind.period ?? 2)
        computed[`${ind.id}_bos_bull`] = ms.bosBull
        computed[`${ind.id}_bos_bear`] = ms.bosBear
        computed[`${ind.id}_choch_bull`] = ms.chochBull
        computed[`${ind.id}_choch_bear`] = ms.chochBear
        computed[`${ind.id}_swing_high`] = ms.swingHighLevel
        computed[`${ind.id}_swing_low`] = ms.swingLowLevel
        computed[`${ind.id}_high_class`] = ms.highClass
        computed[`${ind.id}_low_class`] = ms.lowClass
        computed[`${ind.id}_bias`] = ms.bias
        break
      }
      case 'LIQUIDITY_SWEEP': {
        const sweep = computeLiquiditySweep(candles, ind.period ?? 2)
        computed[`${ind.id}_bull`] = sweep.sweepBull
        computed[`${ind.id}_bear`] = sweep.sweepBear
        break
      }
      case 'FVG': {
        const internalAtr = atr(highs, lows, closes, 14)
        const fvg = computeFVG(candles, internalAtr, ind.atrMultiple ?? 0.25)
        computed[`${ind.id}_bull_retest`] = fvg.bullRetest
        computed[`${ind.id}_bear_retest`] = fvg.bearRetest
        computed[`${ind.id}_bull_top`] = fvg.bullZoneTop
        computed[`${ind.id}_bull_bottom`] = fvg.bullZoneBottom
        computed[`${ind.id}_bear_top`] = fvg.bearZoneTop
        computed[`${ind.id}_bear_bottom`] = fvg.bearZoneBottom
        break
      }
      case 'ORDER_BLOCK': {
        const ob = computeOrderBlocks(candles, ind.period ?? 2, ind.lookback ?? 10)
        computed[`${ind.id}_bull_entry`] = ob.bullEntry
        computed[`${ind.id}_bear_entry`] = ob.bearEntry
        computed[`${ind.id}_bull_mitigated`] = ob.bullMitigated
        computed[`${ind.id}_bear_mitigated`] = ob.bearMitigated
        computed[`${ind.id}_breaker_bull_entry`] = ob.breakerBullEntry
        computed[`${ind.id}_breaker_bear_entry`] = ob.breakerBearEntry
        break
      }
      case 'IMBALANCE': {
        const internalAtr = atr(highs, lows, closes, 14)
        const imb = computeImbalance(candles, internalAtr, ind.atrMultiple ?? 1.5)
        computed[`${ind.id}_bull`] = imb.bullImbalance
        computed[`${ind.id}_bear`] = imb.bearImbalance
        break
      }
      case 'LIQUIDITY_VOID': {
        const void_ = computeLiquidityVoid(candles, ind.runLength ?? 3, ind.bodyRatio ?? 0.6)
        computed[`${ind.id}_bull`] = void_.bullFormed
        computed[`${ind.id}_bear`] = void_.bearFormed
        computed[`${ind.id}_bull_top`] = void_.bullVoidTop
        computed[`${ind.id}_bull_bottom`] = void_.bullVoidBottom
        computed[`${ind.id}_bear_top`] = void_.bearVoidTop
        computed[`${ind.id}_bear_bottom`] = void_.bearVoidBottom
        break
      }
      case 'PREMIUM_DISCOUNT': {
        const pd = computePremiumDiscount(candles, ind.period ?? 2, ind.zonePct ?? 0.05)
        computed[`${ind.id}_zone`] = pd.zone
        computed[`${ind.id}_equilibrium`] = pd.equilibrium
        computed[`${ind.id}_range_top`] = pd.rangeTop
        computed[`${ind.id}_range_bottom`] = pd.rangeBottom
        break
      }
      case 'BREAKOUT_RETEST': {
        const internalAtr = atr(highs, lows, closes, 14)
        const br = computeBreakoutRetest(candles, internalAtr, ind.period ?? 2, ind.windowBars ?? 10, ind.atrMultiple ?? 0.25)
        computed[`${ind.id}_bull`] = br.bullEntry
        computed[`${ind.id}_bear`] = br.bearEntry
        break
      }
      case 'ORB': {
        const orb = computeORB(candles)
        computed[`${ind.id}_bull`] = orb.bullEntry
        computed[`${ind.id}_bear`] = orb.bearEntry
        computed[`${ind.id}_range_high`] = orb.rangeHigh
        computed[`${ind.id}_range_low`] = orb.rangeLow
        break
      }
      case 'SR_PRICE_ACTION': {
        const sr = computeSRPriceAction(candles, ind.period ?? 2, ind.bodyRatio ?? 2)
        computed[`${ind.id}_bull`] = sr.bullEntry
        computed[`${ind.id}_bear`] = sr.bearEntry
        break
      }
      case 'DONCHIAN': {
        // `period` omitted (or 0) means an expanding, all-time window —
        // used for the All-Time High/Low breakout variant. A positive
        // period is a fixed rolling lookback in bars (e.g. 252 for a
        // 52-week high/low on daily candles).
        const re = computeRollingExtreme(candles, ind.period ?? 0)
        computed[`${ind.id}_highest`] = re.highest
        computed[`${ind.id}_lowest`] = re.lowest
        computed[`${ind.id}_breakout_high`] = re.breakoutHigh
        computed[`${ind.id}_breakout_low`] = re.breakoutLow
        break
      }
      case 'HULL_MA': {
        const hs = computeHullSuite(closes, ind.period ?? 55)
        computed[ind.id] = hs.hma
        computed[`${ind.id}_bull_flip`] = hs.bullFlip
        computed[`${ind.id}_bear_flip`] = hs.bearFlip
        break
      }
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
