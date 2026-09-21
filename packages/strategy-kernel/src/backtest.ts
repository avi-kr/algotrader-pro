import type { Candle, StrategyConfig } from '@algotrader/shared-types'
import { calculateIndicators, checkConditions, atr as atrFn, type ComputedSeries, type Series } from './indicators'

export interface BacktestOptions {
  capital?: number
  positionSizePct?: number
  commissionPct?: number
  slippagePct?: number
}

export interface Trade {
  id: number
  type: 'long' | 'short'
  entryDate: number
  exitDate: number
  entryPrice: number
  exitPrice: number
  qty: number
  pnl: number
  pnlPct: number
  barsHeld: number
  exitReason: 'Stop Loss' | 'Take Profit' | 'Strategy Signal' | 'End of Test'
  equity: number
}

export interface EquityPoint {
  date: number
  value: number
}

export interface BacktestMetrics {
  totalTrades: number
  winningTrades: number
  losingTrades: number
  winRate: number
  netPnl: number
  netPnlPct: number
  grossProfit: number
  grossLoss: number
  profitFactor: number
  avgTrade: number
  avgWin: number
  avgLoss: number
  bestTrade: number
  worstTrade: number
  maxDrawdown: number
  maxDrawdownPct: number
  sharpeRatio: number
  sortinoRatio: number
  annualReturn: number
  calmarRatio: number
  avgBarsHeld: number
  monthlyPnl: Record<string, number>
  initialCapital: number
  finalEquity: number
  totalBars: number
}

export type BacktestResult =
  | { error: string }
  | { trades: Trade[]; equityCurve: EquityPoint[]; metrics: BacktestMetrics }

interface OpenPosition {
  type: 'long' | 'short'
  entryPrice: number
  entryIdx: number
  qty: number
  stopLoss: number
  takeProfit: number | null
  highWater: number
}

type PendingAction =
  | { kind: 'exit' }
  | { kind: 'enter_long' }
  | { kind: 'enter_short' }

/**
 * Event-driven backtester. No-look-ahead is enforced structurally: strategy
 * conditions for bar `i` are evaluated in step 3 of the loop using data
 * through bar `i`'s close (via `calculateIndicators`, which is causal — see
 * `indicators.ts`), and the resulting `pending` action is only ever executed
 * at bar `i + 1`'s OPEN, in step 1 of the next iteration. A signal can never
 * be filled on the same bar that produced it. Stop-loss/take-profit levels
 * are fixed at entry and only ever checked against the CURRENT bar's
 * high/low while a position is already open — that's real-time order
 * monitoring, not a forward-looking signal, so it's fine to check intrabar.
 */
export function runBacktest(
  candles: Candle[],
  strategy: StrategyConfig,
  options: BacktestOptions = {}
): BacktestResult {
  const {
    capital = 100000,
    positionSizePct = strategy.positionSizePct ?? 10,
    commissionPct = 0.05,
    slippagePct = 0.01,
  } = options

  if (!candles || candles.length < 50) {
    return { error: 'Need at least 50 candles for backtesting' }
  }

  const computed: ComputedSeries = calculateIndicators(candles, strategy.indicators || [])

  let atrValues: Series | null = null
  if (strategy.stopLoss?.type === 'atr_multiplier') {
    atrValues = atrFn(
      candles.map(c => c.high),
      candles.map(c => c.low),
      candles.map(c => c.close),
      14
    )
  }

  const trades: Trade[] = []
  let equity = capital
  let position: OpenPosition | null = null
  const equityCurve: EquityPoint[] = [{ date: candles[0].time, value: capital }]

  const { longEntry, longExit, shortEntry, shortExit } = strategy.conditions
  const tradeDir = strategy.tradeDirection ?? 'both'
  const sl = strategy.stopLoss ?? { type: 'none' }
  const tp = strategy.takeProfit ?? { type: 'none' }

  let pending: PendingAction | null = null

  const closePosition = (exitPrice: number, exitTime: number, reason: Trade['exitReason'], idx: number) => {
    if (!position) return
    const slip = (exitPrice * slippagePct) / 100
    const actualExit = position.type === 'long' ? exitPrice - slip : exitPrice + slip

    const pnl =
      position.type === 'long'
        ? (actualExit - position.entryPrice) * position.qty
        : (position.entryPrice - actualExit) * position.qty

    const comm = (actualExit * position.qty * commissionPct) / 100
    const netPnl = pnl - comm
    equity += netPnl

    trades.push({
      id: trades.length + 1,
      type: position.type,
      entryDate: candles[position.entryIdx].time,
      exitDate: exitTime,
      entryPrice: position.entryPrice,
      exitPrice: actualExit,
      qty: position.qty,
      pnl: netPnl,
      pnlPct: (netPnl / (position.entryPrice * position.qty)) * 100,
      barsHeld: idx - position.entryIdx,
      exitReason: reason,
      equity,
    })
    equityCurve.push({ date: exitTime, value: equity })
    position = null
  }

  // fillIdx: the bar whose OPEN we're filling at. refIdx = fillIdx - 1 is the
  // last fully-completed bar as of the decision — every value used to size
  // the entry (ATR, "last candle low") must come from refIdx, never fillIdx,
  // since fillIdx's own close hasn't happened yet at the moment of its open.
  const openPosition = (type: 'long' | 'short', fillIdx: number) => {
    const candle = candles[fillIdx]
    const refCandle = candles[fillIdx - 1]
    const equityAtEntry = equity
    const positionCapital = (equityAtEntry * positionSizePct) / 100

    const entryPrice = type === 'long' ? candle.open * (1 + slippagePct / 100) : candle.open * (1 - slippagePct / 100)
    const qty = Math.floor(positionCapital / entryPrice)
    if (qty <= 0) return

    let stopLossPrice: number
    if (type === 'long') {
      if (sl.type === 'last_candle_low') stopLossPrice = refCandle.low
      else if (sl.type === 'atr_multiplier') {
        const atrVal = atrValues ? (atrValues[fillIdx - 1] as number | null) : null
        stopLossPrice = entryPrice - parseFloat(String(sl.value ?? 2)) * (atrVal ?? entryPrice * 0.02)
      } else if (sl.type === 'fixed_percent' || sl.type === 'trailing') {
        stopLossPrice = entryPrice * (1 - parseFloat(String(sl.value ?? 2)) / 100)
      } else {
        stopLossPrice = entryPrice * 0.95
      }
    } else {
      if (sl.type === 'last_candle_low') stopLossPrice = refCandle.high
      else if (sl.type === 'fixed_percent' || sl.type === 'trailing') {
        stopLossPrice = entryPrice * (1 + parseFloat(String(sl.value ?? 2)) / 100)
      } else {
        stopLossPrice = entryPrice * 1.05
      }
    }

    let takeProfitPrice: number | null = null
    if (type === 'long') {
      if (tp.type === 'risk_reward') {
        const risk = entryPrice - stopLossPrice
        takeProfitPrice = entryPrice + risk * parseFloat(String(tp.value ?? 2))
      } else if (tp.type === 'fixed_percent') {
        takeProfitPrice = entryPrice * (1 + parseFloat(String(tp.value ?? 5)) / 100)
      }
    } else {
      if (tp.type === 'risk_reward') {
        const risk = stopLossPrice - entryPrice
        takeProfitPrice = entryPrice - risk * parseFloat(String(tp.value ?? 2))
      } else if (tp.type === 'fixed_percent') {
        takeProfitPrice = entryPrice * (1 - parseFloat(String(tp.value ?? 5)) / 100)
      }
    }

    const comm = (entryPrice * qty * commissionPct) / 100
    equity -= comm

    position = {
      type,
      entryPrice,
      entryIdx: fillIdx,
      qty,
      stopLoss: stopLossPrice,
      takeProfit: takeProfitPrice,
      highWater: type === 'long' ? candle.high : candle.low,
    }
  }

  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i]

    // ---- 1. Execute whatever the PREVIOUS bar's close decided, at THIS bar's open ----
    if (pending?.kind === 'exit' && position) {
      closePosition(candle.open, candle.time, 'Strategy Signal', i)
    } else if (pending?.kind === 'enter_long' && !position) {
      openPosition('long', i)
    } else if (pending?.kind === 'enter_short' && !position) {
      openPosition('short', i)
    }
    pending = null

    // ---- 2. Intrabar stop-loss / take-profit monitoring on the (possibly just-opened) position ----
    if (position) {
      const pos: OpenPosition = position
      if (pos.type === 'long') {
        if (sl.type === 'trailing' && candle.high > pos.highWater) {
          pos.highWater = candle.high
          pos.stopLoss = pos.highWater * (1 - parseFloat(String(sl.value ?? 2)) / 100)
        }
        if (candle.low <= pos.stopLoss) {
          closePosition(Math.max(candle.open, pos.stopLoss), candle.time, 'Stop Loss', i)
        } else if (pos.takeProfit && candle.high >= pos.takeProfit) {
          closePosition(pos.takeProfit, candle.time, 'Take Profit', i)
        }
      } else {
        if (sl.type === 'trailing' && candle.low < pos.highWater) {
          pos.highWater = candle.low
          pos.stopLoss = pos.highWater * (1 + parseFloat(String(sl.value ?? 2)) / 100)
        }
        if (candle.high >= pos.stopLoss) {
          closePosition(Math.min(candle.open, pos.stopLoss), candle.time, 'Stop Loss', i)
        } else if (pos.takeProfit && candle.low <= pos.takeProfit) {
          closePosition(pos.takeProfit, candle.time, 'Take Profit', i)
        }
      }
    }

    // ---- 3. Decide the NEXT action using data through THIS bar's close (never executed before i+1) ----
    if (position) {
      const pos: OpenPosition = position
      const exitConds = pos.type === 'long' ? longExit : shortExit
      if (checkConditions(exitConds, computed, i)) pending = { kind: 'exit' }
    } else {
      if ((tradeDir === 'long_only' || tradeDir === 'both') && checkConditions(longEntry, computed, i)) {
        pending = { kind: 'enter_long' }
      } else if ((tradeDir === 'short_only' || tradeDir === 'both') && checkConditions(shortEntry, computed, i)) {
        pending = { kind: 'enter_short' }
      }
    }
  }

  // Close any still-open position at the final close — there's no future bar left to fill an exit signal on.
  if (position) {
    const lastCandle = candles[candles.length - 1]
    closePosition(lastCandle.close, lastCandle.time, 'End of Test', candles.length - 1)
  }

  return {
    trades,
    equityCurve,
    metrics: calculateMetrics(trades, capital, equity, equityCurve, candles),
  }
}

function calculateMetrics(
  trades: Trade[],
  initialCapital: number,
  finalEquity: number,
  equityCurve: EquityPoint[],
  candles: Candle[]
): BacktestMetrics {
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      netPnl: 0,
      netPnlPct: 0,
      grossProfit: 0,
      grossLoss: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      avgTrade: 0,
      avgWin: 0,
      avgLoss: 0,
      bestTrade: 0,
      worstTrade: 0,
      totalBars: candles.length,
      avgBarsHeld: 0,
      calmarRatio: 0,
      annualReturn: 0,
      monthlyPnl: {},
      initialCapital,
      finalEquity,
    }
  }

  const winners = trades.filter(t => t.pnl > 0)
  const losers = trades.filter(t => t.pnl <= 0)
  const netPnl = finalEquity - initialCapital
  const grossProfit = winners.reduce((sum, t) => sum + t.pnl, 0)
  const grossLoss = Math.abs(losers.reduce((sum, t) => sum + t.pnl, 0))

  let peak = initialCapital
  let maxDD = 0
  let maxDDPct = 0
  for (const point of equityCurve) {
    if (point.value > peak) peak = point.value
    const dd = peak - point.value
    const ddPct = (dd / peak) * 100
    if (dd > maxDD) {
      maxDD = dd
      maxDDPct = ddPct
    }
  }

  const returns = trades.map(t => t.pnlPct / 100)
  const avgReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1)
  const variance = returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / (returns.length || 1)
  const stdDev = Math.sqrt(variance)
  const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0

  const negReturns = returns.filter(r => r < 0)
  const downVariance = negReturns.reduce((sum, r) => sum + r * r, 0) / (negReturns.length || 1)
  const downStdDev = Math.sqrt(downVariance)
  const sortino = downStdDev > 0 ? (avgReturn / downStdDev) * Math.sqrt(252) : 0

  const monthly: Record<string, number> = {}
  for (const trade of trades) {
    const d = new Date(trade.exitDate * 1000)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthly[key] = (monthly[key] || 0) + trade.pnl
  }

  const firstDate = new Date(candles[0].time * 1000)
  const lastDate = new Date(candles[candles.length - 1].time * 1000)
  const years = Math.max((lastDate.getTime() - firstDate.getTime()) / (365 * 24 * 3600 * 1000), 0.1)
  const annualReturn = (Math.pow(finalEquity / initialCapital, 1 / years) - 1) * 100

  return {
    totalTrades: trades.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRate: (winners.length / trades.length) * 100,
    netPnl,
    netPnlPct: (netPnl / initialCapital) * 100,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgTrade: netPnl / trades.length,
    avgWin: winners.length > 0 ? grossProfit / winners.length : 0,
    avgLoss: losers.length > 0 ? -(grossLoss / losers.length) : 0,
    bestTrade: Math.max(...trades.map(t => t.pnl)),
    worstTrade: Math.min(...trades.map(t => t.pnl)),
    maxDrawdown: maxDD,
    maxDrawdownPct: maxDDPct,
    sharpeRatio: sharpe,
    sortinoRatio: sortino,
    annualReturn,
    calmarRatio: maxDDPct > 0 ? annualReturn / maxDDPct : 0,
    avgBarsHeld: trades.reduce((sum, t) => sum + t.barsHeld, 0) / trades.length,
    monthlyPnl: monthly,
    initialCapital,
    finalEquity,
    totalBars: candles.length,
  }
}
