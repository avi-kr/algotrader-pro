// ── Technical Indicators Library ──────────────────────────────────────────────

/**
 * EMA - Exponential Moving Average
 */
export function ema(data, period) {
  if (!data || data.length < period) return []
  const k = 2 / (period + 1)
  const result = new Array(data.length).fill(null)
  
  // Seed with SMA for first value
  let sum = 0
  for (let i = 0; i < period; i++) sum += data[i]
  result[period - 1] = sum / period
  
  for (let i = period; i < data.length; i++) {
    result[i] = data[i] * k + result[i - 1] * (1 - k)
  }
  return result
}

/**
 * SMA - Simple Moving Average
 */
export function sma(data, period) {
  if (!data || data.length < period) return []
  const result = new Array(data.length).fill(null)
  
  let sum = 0
  for (let i = 0; i < period; i++) sum += data[i]
  result[period - 1] = sum / period
  
  for (let i = period; i < data.length; i++) {
    sum = sum - data[i - period] + data[i]
    result[i] = sum / period
  }
  return result
}

/**
 * RSI - Relative Strength Index
 */
export function rsi(data, period = 14) {
  if (!data || data.length < period + 1) return []
  const result = new Array(data.length).fill(null)
  
  let gains = 0, losses = 0
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

/**
 * MACD - Moving Average Convergence Divergence
 * Returns { macd, signal, histogram }
 */
export function macd(data, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(data, fast)
  const emaSlow = ema(data, slow)
  const macdLine = data.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  )
  const macdValues = macdLine.filter(v => v != null)
  const signalValues = ema(macdValues, signal)
  
  const signalLine = new Array(data.length).fill(null)
  let signalIdx = 0
  for (let i = 0; i < data.length; i++) {
    if (macdLine[i] != null) {
      signalLine[i] = signalValues[signalIdx++] ?? null
    }
  }
  
  const histogram = data.map((_, i) =>
    macdLine[i] != null && signalLine[i] != null ? macdLine[i] - signalLine[i] : null
  )
  
  return { macd: macdLine, signal: signalLine, histogram }
}

/**
 * Bollinger Bands
 * Returns { upper, middle, lower }
 */
export function bollingerBands(data, period = 20, stdDev = 2) {
  const middle = sma(data, period)
  const upper = new Array(data.length).fill(null)
  const lower = new Array(data.length).fill(null)
  
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1)
    const mean = middle[i]
    const variance = slice.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / period
    const sd = Math.sqrt(variance)
    upper[i] = mean + stdDev * sd
    lower[i] = mean - stdDev * sd
  }
  return { upper, middle, lower }
}

/**
 * ATR - Average True Range
 */
export function atr(highs, lows, closes, period = 14) {
  const tr = new Array(highs.length).fill(null)
  const result = new Array(highs.length).fill(null)
  
  tr[0] = highs[0] - lows[0]
  for (let i = 1; i < highs.length; i++) {
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    )
  }
  
  // Wilder's smoothing
  let sum = 0
  for (let i = 0; i < period; i++) sum += tr[i]
  result[period - 1] = sum / period
  
  for (let i = period; i < tr.length; i++) {
    result[i] = (result[i - 1] * (period - 1) + tr[i]) / period
  }
  return result
}

/**
 * VWAP - Volume Weighted Average Price
 */
export function vwap(highs, lows, closes, volumes) {
  const result = []
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

/**
 * Check if series A crosses over series B at index i
 */
export function crossover(a, b, i) {
  if (i === 0) return false
  return (
    a[i - 1] != null && b[i - 1] != null &&
    a[i] != null && b[i] != null &&
    a[i - 1] <= b[i - 1] && a[i] > b[i]
  )
}

/**
 * Check if series A crosses under series B at index i
 */
export function crossunder(a, b, i) {
  if (i === 0) return false
  return (
    a[i - 1] != null && b[i - 1] != null &&
    a[i] != null && b[i] != null &&
    a[i - 1] >= b[i - 1] && a[i] < b[i]
  )
}

/**
 * Calculate all indicators for a strategy
 */
export function calculateIndicators(candles, indicators) {
  const closes = candles.map(c => c.close)
  const highs = candles.map(c => c.high)
  const lows = candles.map(c => c.low)
  const volumes = candles.map(c => c.volume ?? 1)
  
  const computed = {}
  
  for (const ind of indicators) {
    switch (ind.type) {
      case 'EMA':
        computed[ind.id] = ema(closes, ind.period)
        break
      case 'SMA':
        computed[ind.id] = sma(closes, ind.period)
        break
      case 'RSI':
        computed[ind.id] = rsi(closes, ind.period)
        break
      case 'MACD': {
        const m = macd(closes, ind.fast || 12, ind.slow || 26, ind.signal || 9)
        computed[`${ind.id}_macd`] = m.macd
        computed[`${ind.id}_signal`] = m.signal
        computed[`${ind.id}_hist`] = m.histogram
        computed[ind.id] = m.macd
        break
      }
      case 'BB': {
        const bb = bollingerBands(closes, ind.period || 20, ind.stdDev || 2)
        computed[`${ind.id}_upper`] = bb.upper
        computed[`${ind.id}_middle`] = bb.middle
        computed[`${ind.id}_lower`] = bb.lower
        computed[ind.id] = bb.middle
        break
      }
      case 'ATR':
        computed[ind.id] = atr(highs, lows, closes, ind.period || 14)
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

/**
 * Check a single condition at index i
 */
export function checkCondition(condition, computed, candles, i) {
  const { type, a, b, value } = condition
  const seriesA = computed[a]
  const seriesB = b ? computed[b] : null
  
  if (!seriesA) return false
  
  switch (type) {
    case 'crossover':
      return crossover(seriesA, seriesB, i)
    case 'crossunder':
      return crossunder(seriesA, seriesB, i)
    case 'above':
      return seriesA[i] != null && seriesB[i] != null && seriesA[i] > seriesB[i]
    case 'below':
      return seriesA[i] != null && seriesB[i] != null && seriesA[i] < seriesB[i]
    case 'above_value':
      return seriesA[i] != null && seriesA[i] > parseFloat(value)
    case 'below_value':
      return seriesA[i] != null && seriesA[i] < parseFloat(value)
    default:
      return false
  }
}

/**
 * Check all conditions (AND logic) at index i
 */
export function checkConditions(conditions, computed, candles, i) {
  if (!conditions || conditions.length === 0) return false
  return conditions.every(c => checkCondition(c, computed, candles, i))
}
