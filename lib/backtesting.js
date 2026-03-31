import { calculateIndicators, checkConditions, atr as atrFn } from './indicators'

/**
 * Main backtesting engine
 * Returns trades list + performance metrics
 */
export function runBacktest(candles, strategy, options = {}) {
  const {
    capital = 100000,
    positionSizePct = 10,   // % of capital per trade
    commission = 0.05,       // % per trade (0.05%)
    slippage = 0.01,         // % slippage
  } = options

  if (!candles || candles.length < 50) {
    return { error: 'Need at least 50 candles for backtesting' }
  }

  // Calculate all indicators
  const computed = calculateIndicators(candles, strategy.indicators || [])

  // ATR for stop loss calculations
  let atrValues = null
  if (strategy.stopLoss?.type === 'atr_multiplier') {
    atrValues = atrFn(
      candles.map(c => c.high),
      candles.map(c => c.low),
      candles.map(c => c.close),
      14
    )
  }

  const trades = []
  let equity = capital
  let position = null   // { type: 'long'|'short', entryPrice, entryIdx, qty, stopLoss, takeProfit, highWater }
  let equityCurve = [{ date: candles[0].time, value: capital }]

  const { longEntry, longExit, shortEntry, shortExit } = strategy.conditions || {}
  const tradeDir = strategy.tradeDirection || 'both'
  const sl = strategy.stopLoss || { type: 'none' }
  const tp = strategy.takeProfit || { type: 'none' }

  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i]
    const prevCandle = candles[i - 1]

    // ── Manage open position ──────────────────────────────────────
    if (position) {
      let exitPrice = null
      let exitReason = null

      // Check stop loss
      if (position.type === 'long') {
        // Update trailing stop
        if (sl.type === 'trailing' && candle.high > position.highWater) {
          position.highWater = candle.high
          position.stopLoss = position.highWater * (1 - parseFloat(sl.value || 2) / 100)
        }
        if (candle.low <= position.stopLoss) {
          exitPrice = Math.max(candle.open, position.stopLoss)
          exitReason = 'Stop Loss'
        } else if (position.takeProfit && candle.high >= position.takeProfit) {
          exitPrice = position.takeProfit
          exitReason = 'Take Profit'
        } else if (checkConditions(longExit, computed, candles, i)) {
          exitPrice = candle.open
          exitReason = 'Strategy Signal'
        }
      } else if (position.type === 'short') {
        if (sl.type === 'trailing' && candle.low < position.highWater) {
          position.highWater = candle.low
          position.stopLoss = position.highWater * (1 + parseFloat(sl.value || 2) / 100)
        }
        if (candle.high >= position.stopLoss) {
          exitPrice = Math.min(candle.open, position.stopLoss)
          exitReason = 'Stop Loss'
        } else if (position.takeProfit && candle.low <= position.takeProfit) {
          exitPrice = position.takeProfit
          exitReason = 'Take Profit'
        } else if (checkConditions(shortExit, computed, candles, i)) {
          exitPrice = candle.open
          exitReason = 'Strategy Signal'
        }
      }

      if (exitPrice != null) {
        // Apply slippage
        const slip = exitPrice * slippage / 100
        const actualExit = position.type === 'long' ? exitPrice - slip : exitPrice + slip

        // Calculate P&L
        const pnl = position.type === 'long'
          ? (actualExit - position.entryPrice) * position.qty
          : (position.entryPrice - actualExit) * position.qty

        // Commission on exit
        const comm = actualExit * position.qty * commission / 100
        const netPnl = pnl - comm

        equity += netPnl

        trades.push({
          id: trades.length + 1,
          type: position.type,
          entryDate: candles[position.entryIdx].time,
          exitDate: candle.time,
          entryPrice: position.entryPrice,
          exitPrice: actualExit,
          qty: position.qty,
          pnl: netPnl,
          pnlPct: (netPnl / (position.entryPrice * position.qty)) * 100,
          barsHeld: i - position.entryIdx,
          exitReason,
          equity,
        })

        equityCurve.push({ date: candle.time, value: equity })
        position = null
      }
    }

    // ── Check for new entries ─────────────────────────────────────
    if (!position) {
      const positionCapital = equity * positionSizePct / 100

      // Long entry
      if ((tradeDir === 'long_only' || tradeDir === 'both') && checkConditions(longEntry, computed, candles, i)) {
        const entryPrice = candle.open * (1 + slippage / 100)
        const qty = Math.floor(positionCapital / entryPrice)
        if (qty > 0) {
          // Calculate stop loss
          let stopLossPrice = 0
          if (sl.type === 'last_candle_low') {
            stopLossPrice = prevCandle.low
          } else if (sl.type === 'atr_multiplier') {
            const atrVal = atrValues ? atrValues[i] : entryPrice * 0.02
            stopLossPrice = entryPrice - parseFloat(sl.value || 2) * (atrVal || entryPrice * 0.02)
          } else if (sl.type === 'fixed_percent') {
            stopLossPrice = entryPrice * (1 - parseFloat(sl.value || 2) / 100)
          } else if (sl.type === 'trailing') {
            stopLossPrice = entryPrice * (1 - parseFloat(sl.value || 2) / 100)
          } else {
            stopLossPrice = entryPrice * 0.95
          }

          // Take profit
          let takeProfitPrice = null
          if (tp.type === 'risk_reward') {
            const risk = entryPrice - stopLossPrice
            takeProfitPrice = entryPrice + risk * parseFloat(tp.value || 2)
          } else if (tp.type === 'fixed_percent') {
            takeProfitPrice = entryPrice * (1 + parseFloat(tp.value || 5) / 100)
          }

          const comm = entryPrice * qty * commission / 100
          equity -= comm

          position = {
            type: 'long',
            entryPrice,
            entryIdx: i,
            qty,
            stopLoss: stopLossPrice,
            takeProfit: takeProfitPrice,
            highWater: candle.high,
          }
        }
      }
      // Short entry
      else if ((tradeDir === 'short_only' || tradeDir === 'both') && checkConditions(shortEntry, computed, candles, i)) {
        const entryPrice = candle.open * (1 - slippage / 100)
        const qty = Math.floor(positionCapital / entryPrice)
        if (qty > 0) {
          let stopLossPrice = 0
          if (sl.type === 'last_candle_low') {
            stopLossPrice = prevCandle.high
          } else if (sl.type === 'fixed_percent') {
            stopLossPrice = entryPrice * (1 + parseFloat(sl.value || 2) / 100)
          } else if (sl.type === 'trailing') {
            stopLossPrice = entryPrice * (1 + parseFloat(sl.value || 2) / 100)
          } else {
            stopLossPrice = entryPrice * 1.05
          }

          let takeProfitPrice = null
          if (tp.type === 'risk_reward') {
            const risk = stopLossPrice - entryPrice
            takeProfitPrice = entryPrice - risk * parseFloat(tp.value || 2)
          } else if (tp.type === 'fixed_percent') {
            takeProfitPrice = entryPrice * (1 - parseFloat(tp.value || 5) / 100)
          }

          const comm = entryPrice * qty * commission / 100
          equity -= comm

          position = {
            type: 'short',
            entryPrice,
            entryIdx: i,
            qty,
            stopLoss: stopLossPrice,
            takeProfit: takeProfitPrice,
            highWater: candle.low,
          }
        }
      }
    }
  }

  // Close any open position at end
  if (position) {
    const lastCandle = candles[candles.length - 1]
    const exitPrice = lastCandle.close
    const pnl = position.type === 'long'
      ? (exitPrice - position.entryPrice) * position.qty
      : (position.entryPrice - exitPrice) * position.qty
    equity += pnl
    trades.push({
      id: trades.length + 1,
      type: position.type,
      entryDate: candles[position.entryIdx].time,
      exitDate: lastCandle.time,
      entryPrice: position.entryPrice,
      exitPrice,
      qty: position.qty,
      pnl,
      pnlPct: (pnl / (position.entryPrice * position.qty)) * 100,
      barsHeld: candles.length - 1 - position.entryIdx,
      exitReason: 'End of Test',
      equity,
    })
    equityCurve.push({ date: lastCandle.time, value: equity })
  }

  return {
    trades,
    equityCurve,
    metrics: calculateMetrics(trades, capital, equity, equityCurve, candles),
  }
}

function calculateMetrics(trades, initialCapital, finalEquity, equityCurve, candles) {
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      netPnl: 0,
      netPnlPct: 0,
      winRate: 0,
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
      winningTrades: 0,
      losingTrades: 0,
      avgBarsHeld: 0,
      calmarRatio: 0,
    }
  }

  const winners = trades.filter(t => t.pnl > 0)
  const losers = trades.filter(t => t.pnl <= 0)
  const netPnl = finalEquity - initialCapital
  const grossProfit = winners.reduce((sum, t) => sum + t.pnl, 0)
  const grossLoss = Math.abs(losers.reduce((sum, t) => sum + t.pnl, 0))

  // Max Drawdown
  let peak = initialCapital
  let maxDD = 0
  let maxDDPct = 0
  for (const point of equityCurve) {
    if (point.value > peak) peak = point.value
    const dd = peak - point.value
    const ddPct = (dd / peak) * 100
    if (dd > maxDD) { maxDD = dd; maxDDPct = ddPct }
  }

  // Sharpe Ratio (annualized, assuming daily bars)
  const returns = trades.map(t => t.pnlPct / 100)
  const avgReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1)
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length || 1)
  const stdDev = Math.sqrt(variance)
  const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0

  // Sortino Ratio
  const negReturns = returns.filter(r => r < 0)
  const downVariance = negReturns.reduce((sum, r) => sum + r * r, 0) / (negReturns.length || 1)
  const downStdDev = Math.sqrt(downVariance)
  const sortino = downStdDev > 0 ? (avgReturn / downStdDev) * Math.sqrt(252) : 0

  // Monthly P&L
  const monthly = {}
  for (const trade of trades) {
    const d = new Date(trade.exitDate * 1000)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthly[key] = (monthly[key] || 0) + trade.pnl
  }

  // Annual return
  const firstDate = new Date(candles[0].time * 1000)
  const lastDate = new Date(candles[candles.length - 1].time * 1000)
  const years = Math.max((lastDate - firstDate) / (365 * 24 * 3600 * 1000), 0.1)
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
