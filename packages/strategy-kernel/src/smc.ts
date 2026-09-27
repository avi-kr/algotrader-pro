import type { Candle } from '@algotrader/shared-types'
import { computeMarketStructure, type Series } from './indicators'

/**
 * Liquidity Sweep: a wick pokes past the active swing level but the CLOSE
 * rejects back to the original side, same bar. Deliberately distinct from
 * Break of Structure (which is close-based) — a sweep is exactly the
 * wick-only fakeout that does NOT register as a structural break, so the
 * two never fire on the same bar for the same level by construction.
 */
export interface LiquiditySweepResult {
  sweepBull: Series
  sweepBear: Series
}

export function computeLiquiditySweep(candles: Candle[], swingWidth = 2): LiquiditySweepResult {
  const closes = candles.map(c => c.close)
  const ms = computeMarketStructure(closes, swingWidth)
  const n = candles.length
  const result: LiquiditySweepResult = {
    sweepBull: new Array(n).fill(null),
    sweepBear: new Array(n).fill(null),
  }

  for (let i = 0; i < n; i++) {
    const swingHigh = ms.swingHighLevel[i]
    const swingLow = ms.swingLowLevel[i]
    if (swingHigh != null && candles[i].high > swingHigh && candles[i].close < swingHigh) {
      result.sweepBear[i] = 1
    }
    if (swingLow != null && candles[i].low < swingLow && candles[i].close > swingLow) {
      result.sweepBull[i] = 1
    }
  }
  return result
}

/**
 * Fair Value Gap: the standard 3-candle non-overlap pattern, fully causal at
 * bar `i` (all 3 candles are already closed — no confirmation delay needed,
 * unlike swing points). Only the most recent unfilled gap of each direction
 * is tracked, mirroring how Market Structure tracks only the active swing.
 * `minGapAtrMultiple` filters out gaps too small to be meaningful.
 */
export interface FVGResult {
  bullRetest: Series // 1 on the bar price first re-enters an unfilled bullish gap
  bearRetest: Series
  bullZoneTop: Series
  bullZoneBottom: Series
  bearZoneTop: Series
  bearZoneBottom: Series
}

export function computeFVG(candles: Candle[], atr: Series, minGapAtrMultiple = 0.25, maxAgeBars = 50): FVGResult {
  const n = candles.length
  const result: FVGResult = {
    bullRetest: new Array(n).fill(null),
    bearRetest: new Array(n).fill(null),
    bullZoneTop: new Array(n).fill(null),
    bullZoneBottom: new Array(n).fill(null),
    bearZoneTop: new Array(n).fill(null),
    bearZoneBottom: new Array(n).fill(null),
  }

  let activeBull: { top: number; bottom: number; formedIdx: number } | null = null
  let activeBear: { top: number; bottom: number; formedIdx: number } | null = null

  for (let i = 2; i < n; i++) {
    const atrVal = atr[i]
    if (atrVal != null) {
      if (candles[i - 2].high < candles[i].low) {
        const size = candles[i].low - candles[i - 2].high
        if (size >= minGapAtrMultiple * atrVal) {
          activeBull = { top: candles[i].low, bottom: candles[i - 2].high, formedIdx: i }
        }
      }
      if (candles[i - 2].low > candles[i].high) {
        const size = candles[i - 2].low - candles[i].high
        if (size >= minGapAtrMultiple * atrVal) {
          activeBear = { top: candles[i - 2].low, bottom: candles[i].high, formedIdx: i }
        }
      }
    }

    if (activeBull && i - activeBull.formedIdx > maxAgeBars) activeBull = null
    if (activeBear && i - activeBear.formedIdx > maxAgeBars) activeBear = null

    result.bullZoneTop[i] = activeBull ? activeBull.top : null
    result.bullZoneBottom[i] = activeBull ? activeBull.bottom : null
    result.bearZoneTop[i] = activeBear ? activeBear.top : null
    result.bearZoneBottom[i] = activeBear ? activeBear.bottom : null

    if (activeBull && i > activeBull.formedIdx) {
      if (candles[i].close < activeBull.bottom) {
        activeBull = null // invalidated: closed fully through the gap
      } else if (candles[i].low <= activeBull.top) {
        result.bullRetest[i] = 1
        activeBull = null // consumed — one retest trigger per gap
      }
    }
    if (activeBear && i > activeBear.formedIdx) {
      if (candles[i].close > activeBear.top) {
        activeBear = null
      } else if (candles[i].high >= activeBear.bottom) {
        result.bearRetest[i] = 1
        activeBear = null
      }
    }
  }
  return result
}

/**
 * Order Block: the last opposite-colored candle before a confirmed BOS,
 * scanning back up to `lookback` bars. Mitigation Block and Breaker Block
 * are NOT separate detectors — they're states layered on the same Order
 * Block: `mitigated` flips true the first time price touches the zone
 * without invalidating it; a Breaker is what an Order Block becomes once
 * price closes fully through it (the zone flips polarity and is now traded
 * in the opposite direction on its next retest).
 */
export interface OrderBlockResult {
  bullEntry: Series // retest of an active bullish OB — long entry trigger
  bearEntry: Series
  bullMitigated: Series // first touch of a still-valid bullish OB
  bearMitigated: Series
  breakerBullEntry: Series // retest of a zone that flipped from a failed bearish OB — long entry
  breakerBearEntry: Series // retest of a zone that flipped from a failed bullish OB — short entry
  activeBullZoneTop: Series
  activeBullZoneBottom: Series
  activeBearZoneTop: Series
  activeBearZoneBottom: Series
}

export function computeOrderBlocks(candles: Candle[], swingWidth = 2, lookback = 10): OrderBlockResult {
  const closes = candles.map(c => c.close)
  const ms = computeMarketStructure(closes, swingWidth)
  const n = candles.length
  const result: OrderBlockResult = {
    bullEntry: new Array(n).fill(null),
    bearEntry: new Array(n).fill(null),
    bullMitigated: new Array(n).fill(null),
    bearMitigated: new Array(n).fill(null),
    breakerBullEntry: new Array(n).fill(null),
    breakerBearEntry: new Array(n).fill(null),
    activeBullZoneTop: new Array(n).fill(null),
    activeBullZoneBottom: new Array(n).fill(null),
    activeBearZoneTop: new Array(n).fill(null),
    activeBearZoneBottom: new Array(n).fill(null),
  }

  let activeBullOB: { top: number; bottom: number; mitigated: boolean } | null = null
  let activeBearOB: { top: number; bottom: number; mitigated: boolean } | null = null
  let bullBreaker: { top: number; bottom: number } | null = null
  let bearBreaker: { top: number; bottom: number } | null = null

  for (let i = 0; i < n; i++) {
    if (ms.bosBull[i] === 1) {
      for (let k = i - 1; k >= Math.max(0, i - lookback); k--) {
        if (candles[k].close < candles[k].open) {
          activeBullOB = { top: candles[k].high, bottom: candles[k].low, mitigated: false }
          break
        }
      }
    }
    if (ms.bosBear[i] === 1) {
      for (let k = i - 1; k >= Math.max(0, i - lookback); k--) {
        if (candles[k].close > candles[k].open) {
          activeBearOB = { top: candles[k].high, bottom: candles[k].low, mitigated: false }
          break
        }
      }
    }

    result.activeBullZoneTop[i] = activeBullOB ? activeBullOB.top : null
    result.activeBullZoneBottom[i] = activeBullOB ? activeBullOB.bottom : null
    result.activeBearZoneTop[i] = activeBearOB ? activeBearOB.top : null
    result.activeBearZoneBottom[i] = activeBearOB ? activeBearOB.bottom : null

    if (activeBullOB) {
      if (candles[i].close < activeBullOB.bottom) {
        bearBreaker = { top: activeBullOB.top, bottom: activeBullOB.bottom }
        activeBullOB = null
      } else if (candles[i].low <= activeBullOB.top) {
        if (!activeBullOB.mitigated) {
          activeBullOB.mitigated = true
          result.bullMitigated[i] = 1
        }
        result.bullEntry[i] = 1
      }
    }
    if (activeBearOB) {
      if (candles[i].close > activeBearOB.top) {
        bullBreaker = { top: activeBearOB.top, bottom: activeBearOB.bottom }
        activeBearOB = null
      } else if (candles[i].high >= activeBearOB.bottom) {
        if (!activeBearOB.mitigated) {
          activeBearOB.mitigated = true
          result.bearMitigated[i] = 1
        }
        result.bearEntry[i] = 1
      }
    }

    if (bullBreaker && candles[i].low <= bullBreaker.top && candles[i].high >= bullBreaker.bottom) {
      result.breakerBullEntry[i] = 1
      bullBreaker = null
    }
    if (bearBreaker && candles[i].high >= bearBreaker.bottom && candles[i].low <= bearBreaker.top) {
      result.breakerBearEntry[i] = 1
      bearBreaker = null
    }
  }
  return result
}

/** Imbalance: a single candle whose body alone is large relative to ATR —
 * kept deliberately distinct from FVG (a 3-candle non-overlap pattern). */
export interface ImbalanceResult {
  bullImbalance: Series
  bearImbalance: Series
}

export function computeImbalance(candles: Candle[], atr: Series, bodyAtrMultiple = 1.5): ImbalanceResult {
  const n = candles.length
  const result: ImbalanceResult = { bullImbalance: new Array(n).fill(null), bearImbalance: new Array(n).fill(null) }
  for (let i = 0; i < n; i++) {
    const atrVal = atr[i]
    if (atrVal == null) continue
    const body = candles[i].close - candles[i].open
    if (body > 0 && body >= bodyAtrMultiple * atrVal) result.bullImbalance[i] = 1
    if (body < 0 && -body >= bodyAtrMultiple * atrVal) result.bearImbalance[i] = 1
  }
  return result
}

/** Liquidity Void: a run of `runLength` consecutive same-direction candles,
 * each with a small-wick/mostly-body shape (fast, thin, one-sided trading) —
 * distinct from FVG by being a multi-candle run rather than a single
 * 3-candle non-overlap. */
export interface LiquidityVoidResult {
  bullFormed: Series
  bearFormed: Series
  bullVoidTop: Series
  bullVoidBottom: Series
  bearVoidTop: Series
  bearVoidBottom: Series
}

export function computeLiquidityVoid(candles: Candle[], runLength = 3, bodyRatio = 0.6): LiquidityVoidResult {
  const n = candles.length
  const result: LiquidityVoidResult = {
    bullFormed: new Array(n).fill(null),
    bearFormed: new Array(n).fill(null),
    bullVoidTop: new Array(n).fill(null),
    bullVoidBottom: new Array(n).fill(null),
    bearVoidTop: new Array(n).fill(null),
    bearVoidBottom: new Array(n).fill(null),
  }
  const isCleanBull = (c: Candle) => c.close > c.open && c.high > c.low && c.close - c.open >= bodyRatio * (c.high - c.low)
  const isCleanBear = (c: Candle) => c.close < c.open && c.high > c.low && c.open - c.close >= bodyRatio * (c.high - c.low)

  for (let i = runLength - 1; i < n; i++) {
    let allBull = true
    let allBear = true
    for (let k = i - runLength + 1; k <= i; k++) {
      if (!isCleanBull(candles[k])) allBull = false
      if (!isCleanBear(candles[k])) allBear = false
    }
    if (allBull) {
      result.bullFormed[i] = 1
      result.bullVoidBottom[i] = candles[i - runLength + 1].low
      result.bullVoidTop[i] = candles[i].high
    }
    if (allBear) {
      result.bearFormed[i] = 1
      result.bearVoidTop[i] = candles[i - runLength + 1].high
      result.bearVoidBottom[i] = candles[i].low
    }
  }
  return result
}

/** Premium / Discount / Equilibrium (Base Zone): splits the active swing
 * range (from Market Structure) by percentage — above the base band around
 * the 50% midpoint is Premium (expensive — favors selling), below is
 * Discount (cheap — favors buying). `baseZonePct` is the half-width of the
 * equilibrium band as a fraction of the full range (default 5% each side
 * of the midpoint = a 10%-of-range-wide base zone). */
export interface PremiumDiscountResult {
  zone: Series // 1 = premium, -1 = discount, 0 = base/equilibrium
  equilibrium: Series
  rangeTop: Series
  rangeBottom: Series
}

export function computePremiumDiscount(candles: Candle[], swingWidth = 2, baseZonePct = 0.05): PremiumDiscountResult {
  const closes = candles.map(c => c.close)
  const ms = computeMarketStructure(closes, swingWidth)
  const n = candles.length
  const result: PremiumDiscountResult = {
    zone: new Array(n).fill(null),
    equilibrium: new Array(n).fill(null),
    rangeTop: new Array(n).fill(null),
    rangeBottom: new Array(n).fill(null),
  }
  for (let i = 0; i < n; i++) {
    const top = ms.swingHighLevel[i]
    const bottom = ms.swingLowLevel[i]
    if (top == null || bottom == null || top <= bottom) continue
    const eq = (top + bottom) / 2
    const halfBase = baseZonePct * (top - bottom)
    result.rangeTop[i] = top
    result.rangeBottom[i] = bottom
    result.equilibrium[i] = eq
    const price = closes[i]
    if (price > eq + halfBase) result.zone[i] = 1
    else if (price < eq - halfBase) result.zone[i] = -1
    else result.zone[i] = 0
  }
  return result
}

/**
 * Breakout + Retest: a confirmed BOS/CHOCH is the breakout; price then has
 * up to `retestWindow` bars to come back and touch the broken level (within
 * an ATR-scaled tolerance) without closing back through it with room to
 * spare. The first close back beyond the level after that touch is the
 * entry — same bar as the touch (a sharp V-rejection) or a later one.
 *
 * NOTE on stop-loss: the request was to size the stop from 15-MINUTE ATR
 * specifically, regardless of what timeframe this strategy trades on. That
 * needs genuine multi-timeframe data (fetching a parallel 15m candle series
 * for the same symbol/range and aligning it to this timeframe's bars by
 * timestamp) — the engine only ever loads one timeframe's candles per
 * backtest today. This function takes the ATR of whatever timeframe it's
 * actually given as an interim stand-in; wiring in a real higher-timeframe
 * ATR is separate, not-yet-built work.
 */
export interface BreakoutRetestResult {
  bullEntry: Series
  bearEntry: Series
}

export function computeBreakoutRetest(
  candles: Candle[],
  atr: Series,
  swingWidth = 2,
  retestWindow = 10,
  toleranceAtrMultiple = 0.25
): BreakoutRetestResult {
  const closes = candles.map(c => c.close)
  const ms = computeMarketStructure(closes, swingWidth)
  const n = candles.length
  const result: BreakoutRetestResult = { bullEntry: new Array(n).fill(null), bearEntry: new Array(n).fill(null) }

  let pendingBull: { level: number; brokeAt: number; touched: boolean } | null = null
  let pendingBear: { level: number; brokeAt: number; touched: boolean } | null = null

  for (let i = 0; i < n; i++) {
    if (ms.bosBull[i] === 1 || ms.chochBull[i] === 1) {
      const level = ms.swingHighLevel[i]
      if (level != null) pendingBull = { level, brokeAt: i, touched: false }
    }
    if (ms.bosBear[i] === 1 || ms.chochBear[i] === 1) {
      const level = ms.swingLowLevel[i]
      if (level != null) pendingBear = { level, brokeAt: i, touched: false }
    }

    if (pendingBull && i > pendingBull.brokeAt) {
      if (i - pendingBull.brokeAt > retestWindow) {
        pendingBull = null
      } else {
        const atrVal = atr[i]
        const tolerance = atrVal != null ? toleranceAtrMultiple * atrVal : 0
        if (!pendingBull.touched) {
          if (candles[i].low <= pendingBull.level + tolerance) pendingBull.touched = true
          else if (candles[i].close < pendingBull.level - tolerance) pendingBull = null // ran without ever retesting
        }
        if (pendingBull && pendingBull.touched && candles[i].close > pendingBull.level) {
          result.bullEntry[i] = 1
          pendingBull = null
        }
      }
    }
    if (pendingBear && i > pendingBear.brokeAt) {
      if (i - pendingBear.brokeAt > retestWindow) {
        pendingBear = null
      } else {
        const atrVal = atr[i]
        const tolerance = atrVal != null ? toleranceAtrMultiple * atrVal : 0
        if (!pendingBear.touched) {
          if (candles[i].high >= pendingBear.level - tolerance) pendingBear.touched = true
          else if (candles[i].close > pendingBear.level + tolerance) pendingBear = null
        }
        if (pendingBear && pendingBear.touched && candles[i].close < pendingBear.level) {
          result.bearEntry[i] = 1
          pendingBear = null
        }
      }
    }
  }
  return result
}

/**
 * Opening Range Breakout: the opening range is simply the FIRST candle of
 * each trading session — this automatically scales to whatever timeframe
 * the chart is on (the first 3-minute candle on a 3m chart, the first
 * 15-minute candle on a 15m chart, etc.), rather than a fixed minute count.
 * Sessions are detected by calendar day in IST (NSE hours) — this doesn't
 * have a natural equivalent for 24/7 crypto. One trade per session: only
 * the first breakout of the range counts.
 */
export interface ORBResult {
  bullEntry: Series
  bearEntry: Series
  rangeHigh: Series
  rangeLow: Series
}

export function computeORB(candles: Candle[]): ORBResult {
  const n = candles.length
  const result: ORBResult = {
    bullEntry: new Array(n).fill(null),
    bearEntry: new Array(n).fill(null),
    rangeHigh: new Array(n).fill(null),
    rangeLow: new Array(n).fill(null),
  }

  const dayKey = (t: number) => {
    const ist = new Date((t + 5.5 * 3600) * 1000) // shift to IST, then read UTC fields as local calendar day
    return `${ist.getUTCFullYear()}-${ist.getUTCMonth()}-${ist.getUTCDate()}`
  }

  let currentDay: string | null = null
  let rangeHigh: number | null = null
  let rangeLow: number | null = null
  let traded = false

  for (let i = 0; i < n; i++) {
    const day = dayKey(candles[i].time)
    if (day !== currentDay) {
      currentDay = day
      rangeHigh = candles[i].high
      rangeLow = candles[i].low
      traded = false
      // The opening-range bar itself sets the range but can't trigger a
      // breakout of a range it's still forming.
    } else {
      result.rangeHigh[i] = rangeHigh
      result.rangeLow[i] = rangeLow
      if (!traded && rangeHigh != null && rangeLow != null) {
        if (candles[i].close > rangeHigh) {
          result.bullEntry[i] = 1
          traded = true
        } else if (candles[i].close < rangeLow) {
          result.bearEntry[i] = 1
          traded = true
        }
      }
    }
  }
  return result
}

/**
 * Support/Resistance + Price Action: entry at the active swing level (from
 * Market Structure) confirmed by one of two standard, deterministic
 * rejection patterns — a pin bar (a wick at least `wickBodyRatio`x its own
 * body, on the side facing away from the level) or a bullish/bearish
 * engulfing candle. "Price action" alone isn't a rule; these two patterns
 * are the concrete, standard ones it's pinned to.
 */
export interface SRPriceActionResult {
  bullEntry: Series
  bearEntry: Series
}

export function computeSRPriceAction(candles: Candle[], swingWidth = 2, wickBodyRatio = 2): SRPriceActionResult {
  const closes = candles.map(c => c.close)
  const ms = computeMarketStructure(closes, swingWidth)
  const n = candles.length
  const result: SRPriceActionResult = { bullEntry: new Array(n).fill(null), bearEntry: new Array(n).fill(null) }

  for (let i = 1; i < n; i++) {
    const swingLow = ms.swingLowLevel[i]
    const swingHigh = ms.swingHighLevel[i]
    const c = candles[i]
    const body = Math.abs(c.close - c.open)
    const lowerWick = Math.min(c.open, c.close) - c.low
    const upperWick = c.high - Math.max(c.open, c.close)
    const prev = candles[i - 1]
    const isBullEngulf = c.close > c.open && prev.close < prev.open && c.close >= prev.open && c.open <= prev.close
    const isBearEngulf = c.close < c.open && prev.close > prev.open && c.close <= prev.open && c.open >= prev.close
    const isBullPin = body > 0 && lowerWick >= wickBodyRatio * body
    const isBearPin = body > 0 && upperWick >= wickBodyRatio * body

    // 0.1% proximity tolerance for "at the level" — exact equality is unrealistic.
    if (swingLow != null && c.low <= swingLow * 1.001 && (isBullPin || isBullEngulf)) {
      result.bullEntry[i] = 1
    }
    if (swingHigh != null && c.high >= swingHigh * 0.999 && (isBearPin || isBearEngulf)) {
      result.bearEntry[i] = 1
    }
  }
  return result
}
