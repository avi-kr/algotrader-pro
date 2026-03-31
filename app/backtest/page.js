'use client'
import { useState, useEffect, Suspense, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { FlaskConical, Play, ChevronDown, Settings, RefreshCw, AlertCircle } from 'lucide-react'
import { getStrategies, getStrategy } from '@/lib/strategies'
import { calculateIndicators } from '@/lib/indicators'
import { NIFTY50, TOP_CRYPTO, TIMEFRAMES } from '@/lib/constants'
import InfoTooltip from '@/components/InfoTooltip'
import BacktestReport from '@/components/BacktestReport'

const TradingChart = dynamic(() => import('@/components/TradingChart'), { ssr: false })

function BacktestInner() {
  const searchParams = useSearchParams()

  const [strategies, setStrategies] = useState([])
  const [selectedStrategyId, setSelectedStrategyId] = useState(searchParams.get('strategy') || '')
  const [selectedStrategy, setSelectedStrategy] = useState(null)
  const [symbol, setSymbol] = useState('RELIANCE.NS')
  const [market, setMarket] = useState('indian')
  const [timeframe, setTimeframe] = useState('1d')
  const [range, setRange] = useState('5y')
  const [capital, setCapital] = useState(100000)
  const [positionSize, setPositionSize] = useState(10)
  const [commission, setCommission] = useState(0.05)

  const [candles, setCandles] = useState([])
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [tradeOverlays, setTradeOverlays] = useState([])
  const [computedIndicators, setComputedIndicators] = useState({})

  const tf = TIMEFRAMES.find(t => t.value === timeframe) || TIMEFRAMES[5]
  const isIntraday = ['1m', '5m', '15m', '60m', '4h'].includes(timeframe)

  useEffect(() => {
    const strats = getStrategies()
    setStrategies(strats)
    if (searchParams.get('strategy')) {
      const s = strats.find(x => x.id === searchParams.get('strategy'))
      if (s) { setSelectedStrategy(s); setMarket(s.market || 'indian') }
    }
  }, [])

  useEffect(() => {
    if (selectedStrategyId) {
      const s = strategies.find(x => x.id === selectedStrategyId)
      if (s) { setSelectedStrategy(s); setMarket(s.market || 'indian') }
    }
  }, [selectedStrategyId, strategies])

  // Auto-clamp range when switching to intraday timeframe
  useEffect(() => {
    if (['1m'].includes(timeframe)) setRange('3mo')
    else if (['5m'].includes(timeframe)) setRange('3mo')
    else if (['15m', '60m', '4h'].includes(timeframe)) setRange('3mo')
  }, [timeframe])

  const fetchHistory = useCallback(async () => {
    if (!symbol) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/historical?symbol=${encodeURIComponent(symbol)}&interval=${tf.yf}&range=${range}&market=${market}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setCandles(data.candles || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [symbol, timeframe, range, market])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  // Compute indicators for chart preview
  useEffect(() => {
    if (!candles.length || !selectedStrategy?.indicators?.length) return
    const computed = calculateIndicators(candles, selectedStrategy.indicators)
    setComputedIndicators(computed)
  }, [candles, selectedStrategy])

  const runBacktest = async () => {
    if (!selectedStrategy) { setError('Please select a strategy'); return }
    if (candles.length < 50) { setError('Need more historical data. Try a longer range.'); return }
    setRunning(true)
    setError(null)
    setResult(null)

    try {
      // Dynamic import to avoid SSR issues
      const { runBacktest: bt } = await import('@/lib/backtesting')
      const res = bt(candles, selectedStrategy, {
        capital: parseFloat(capital),
        positionSizePct: parseFloat(positionSize),
        commission: parseFloat(commission),
      })

      setResult(res)

      // Build trade overlays for chart
      if (res.trades) {
        const markers = []
        for (const trade of res.trades) {
          markers.push({ time: trade.entryDate, type: trade.type === 'long' ? 'buy' : 'sell' })
          markers.push({ time: trade.exitDate, type: trade.type === 'long' ? 'sell' : 'buy' })
        }
        setTradeOverlays(markers)
      }
    } catch (e) {
      setError('Backtest error: ' + e.message)
    } finally {
      setRunning(false)
    }
  }

  const symbolList = market === 'crypto'
    ? TOP_CRYPTO.map(c => ({ symbol: c.id, name: c.name }))
    : NIFTY50.map(s => ({ symbol: s.symbol, name: s.name }))

  const RANGES = [
    { label: '3M', value: '3mo' },
    { label: '6M', value: '6mo' },
    { label: '1Y', value: '1y' },
    { label: '2Y', value: '2y' },
    { label: '5Y', value: '5y' },
    { label: 'Max', value: 'max' },
  ]

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-textprimary">
            Strategy <span className="gradient-text">Backtester</span>
          </h1>
          <p className="text-xs text-muted font-mono mt-1">
            Test your strategies on historical data · {candles.length} candles loaded
          </p>
        </div>
        <div className="flex items-center gap-2">
          <InfoTooltip topic="backtesting" />
        </div>
      </div>

      {/* Config panel */}
      <div className="glass rounded-xl border border-border p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {/* Strategy */}
          <div className="sm:col-span-2">
            <label className="text-xs text-muted font-mono block mb-1.5">Strategy</label>
            {strategies.length === 0 ? (
              <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg text-xs text-warning font-mono">
                No strategies yet. <a href="/strategies" className="underline">Create one →</a>
              </div>
            ) : (
              <select value={selectedStrategyId} onChange={e => setSelectedStrategyId(e.target.value)} className="w-full">
                <option value="">-- Select a strategy --</option>
                {strategies.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Market */}
          <div>
            <label className="text-xs text-muted font-mono block mb-1.5">Market</label>
            <select value={market} onChange={e => { setMarket(e.target.value); setSymbol(e.target.value === 'indian' ? 'RELIANCE.NS' : 'bitcoin') }} className="w-full">
              <option value="indian">Indian (NSE)</option>
              <option value="crypto">Crypto</option>
              <option value="us">US Stocks</option>
            </select>
          </div>

          {/* Symbol */}
          <div>
            <label className="text-xs text-muted font-mono block mb-1.5">Symbol</label>
            <select value={symbol} onChange={e => setSymbol(e.target.value)} className="w-full">
              {symbolList.map(s => (
                <option key={s.symbol} value={s.symbol}>
                  {s.symbol.replace('.NS', '').replace('.BO', '')} — {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Timeframe */}
          <div>
            <label className="text-xs text-muted font-mono block mb-1.5">Candle Timeframe</label>
            <select value={timeframe} onChange={e => setTimeframe(e.target.value)} className="w-full">
              {TIMEFRAMES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* Date range */}
          <div>
            <label className="text-xs text-muted font-mono block mb-1.5">Historical Range</label>
            {isIntraday ? (
              <span className="text-xs text-warning font-mono px-3 py-1.5 bg-warning/10 border border-warning/20 rounded-lg inline-block">
                ⚡ Intraday: max 7–60 days of data
              </span>
            ) : (
              <div className="flex gap-1">
                {RANGES.map(r => (
                  <button key={r.value} onClick={() => setRange(r.value)}
                    className={`flex-1 py-1.5 rounded text-xs font-mono transition-all ${range === r.value ? 'bg-accent text-bg font-bold' : 'bg-surface2 border border-border text-muted hover:text-textprimary'}`}>
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Capital */}
          <div>
            <label className="text-xs text-muted font-mono block mb-1.5">Initial Capital (₹)</label>
            <input type="number" value={capital} onChange={e => setCapital(e.target.value)} className="w-full" />
          </div>

          {/* Position size */}
          <div>
            <label className="text-xs text-muted font-mono block mb-1.5">Position Size (% per trade)</label>
            <input type="number" value={positionSize} min="1" max="100" onChange={e => setPositionSize(e.target.value)} className="w-full" />
          </div>

          {/* Commission */}
          <div>
            <label className="text-xs text-muted font-mono block mb-1.5">Commission % (each way)</label>
            <input type="number" value={commission} step="0.01" onChange={e => setCommission(e.target.value)} className="w-full" />
          </div>
        </div>

        {/* Run button */}
        <div className="mt-4 flex gap-3">
          <button
            onClick={runBacktest}
            disabled={running || loading || !selectedStrategyId}
            className="btn-primary flex items-center gap-2 px-8 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {running ? (
              <>
                <div className="w-4 h-4 border-2 border-bg border-t-transparent rounded-full animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play size={16} /> Run Backtest
              </>
            )}
          </button>
          <button onClick={fetchHistory} className="btn-ghost flex items-center gap-2" disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Reload Data
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-danger/10 border border-danger/30 rounded-xl text-danger text-sm font-mono">
          <AlertCircle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {/* Strategy info */}
      {selectedStrategy && (
        <div className="glass rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-mono text-muted">Active strategy:</span>
            <span className="font-display font-semibold text-sm text-textprimary">{selectedStrategy.name}</span>
            {selectedStrategy.indicators?.map(ind => (
              <span key={ind.id} className="flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded bg-surface border border-border">
                <span className="w-2 h-2 rounded-full" style={{ background: ind.color }} />
                {ind.type}({ind.period || ind.fast || ''})
              </span>
            ))}
            <span className="text-xs text-muted font-mono ml-auto">
              {candles.length} candles · {timeframe} · {range}
            </span>
          </div>
        </div>
      )}

      {/* Chart preview */}
      {(loading || candles.length > 0) && (
        <div className="space-y-2">
          <h2 className="text-sm font-display font-semibold text-textprimary">
            Chart Preview {result ? '· with Trade Signals' : ''}
          </h2>
          {loading ? (
            <div className="chart-container relative overflow-hidden" style={{ height: 380 }}>
              {/* Skeleton candles */}
              <div className="absolute inset-0 flex items-end gap-1 px-4 pb-8 opacity-20">
                {Array.from({ length: 60 }).map((_, i) => {
                  const h = 30 + Math.sin(i * 0.4) * 25 + Math.random() * 40
                  const isUp = Math.random() > 0.45
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                      <div className="w-px animate-pulse" style={{ height: h * 0.3, background: isUp ? '#00E5A0' : '#FF4560', opacity: 0.4 }} />
                      <div className="w-full rounded-sm animate-pulse" style={{ height: h, background: isUp ? '#00E5A0' : '#FF4560', opacity: 0.15, animationDelay: `${i * 30}ms` }} />
                    </div>
                  )
                })}
              </div>
              {/* Overlay text */}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <div className="flex items-center gap-3 text-sm font-mono text-muted">
                  <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  Fetching candles for {symbol.replace('.NS', '').replace('.BO', '')}...
                </div>
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <TradingChart
              candles={candles}
              indicators={computedIndicators}
              indicatorDefs={selectedStrategy?.indicators || []}
              overlays={tradeOverlays}
              height={380}
            />
          )}
        </div>
      )}

      {/* Report */}
      {result && !running && (
        <BacktestReport
          result={result}
          symbol={symbol.replace('.NS', '').replace('.BO', '')}
          strategy={selectedStrategy}
        />
      )}

      {/* Empty prompts */}
      {!result && !running && strategies.length > 0 && candles.length > 0 && (
        <div className="text-center py-12">
          <FlaskConical size={36} className="text-muted mx-auto mb-3" />
          <p className="text-muted font-mono text-sm">Select a strategy above and click <strong className="text-accent">Run Backtest</strong></p>
        </div>
      )}
    </div>
  )
}

export default function BacktestPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted font-mono">Loading backtester...</div>}>
      <BacktestInner />
    </Suspense>
  )
}
