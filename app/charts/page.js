'use client'
import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Search, BarChart2, ChevronDown, Plus, X, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react'
import { NIFTY50, TOP_CRYPTO, TIMEFRAMES, INDICATOR_TYPES } from '@/lib/constants'
import { calculateIndicators } from '@/lib/indicators'
import InfoTooltip from '@/components/InfoTooltip'

const TradingChart = dynamic(() => import('@/components/TradingChart'), { ssr: false })

const COLORS = ['#00E5A0', '#FFB800', '#00B4FF', '#FF4560', '#A855F7', '#F97316']
const fmt = v => v != null ? Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'

function ChartsInner() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [symbol, setSymbol] = useState(searchParams.get('symbol') || 'RELIANCE.NS')
  const [market, setMarket] = useState(searchParams.get('market') || 'indian')
  const [timeframe, setTimeframe] = useState('1d')
  const [candles, setCandles] = useState([])
  const [loading, setLoading] = useState(false)
  const [quote, setQuote] = useState(null)
  const [indicators, setIndicators] = useState([
    { id: 'ema9', type: 'EMA', period: 9, color: '#00E5A0' },
    { id: 'ema20', type: 'EMA', period: 20, color: '#FFB800' },
  ])
  const [computedIndicators, setComputedIndicators] = useState({})
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [symbolListOpen, setSymbolListOpen] = useState(false)
  const [error, setError] = useState(null)

  const tf = TIMEFRAMES.find(t => t.value === timeframe) || TIMEFRAMES[5]
  const isIntraday = ['1m', '5m', '15m', '60m', '4h'].includes(timeframe)

  const fetchChart = useCallback(async () => {
    if (!symbol) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/historical?symbol=${encodeURIComponent(symbol)}&interval=${tf.yf}&range=${tf.range}&market=${market}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setCandles(data.candles || [])
    } catch (e) {
      setError(e.message)
      setCandles([])
    } finally {
      setLoading(false)
    }
  }, [symbol, timeframe, market])

  useEffect(() => { fetchChart() }, [fetchChart])

  // Compute indicators whenever candles or indicator defs change
  useEffect(() => {
    if (candles.length < 5) { setComputedIndicators({}); return }
    const computed = calculateIndicators(candles, indicators)
    setComputedIndicators(computed)
  }, [candles, indicators])

  // Search
  useEffect(() => {
    if (!searchQ || searchQ.length < 2) { setSearchResults([]); return }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQ)}`)
        const data = await res.json()
        setSearchResults(data.results || [])
      } catch { setSearchResults([]) }
    }, 350)
    return () => clearTimeout(t)
  }, [searchQ])

  const selectSymbol = (sym, mkt) => {
    setSymbol(sym)
    setMarket(mkt || market)
    setSearchQ('')
    setSearchResults([])
    setSymbolListOpen(false)
    router.push(`/charts?symbol=${sym}&market=${mkt || market}`, { shallow: true })
  }

  const addIndicator = () => {
    const newId = `ind${Date.now()}`
    setIndicators(prev => [...prev, { id: newId, type: 'EMA', period: 50, color: COLORS[prev.length % COLORS.length] }])
  }

  const updateIndicator = (id, updates) => {
    setIndicators(prev => prev.map(ind => ind.id === id ? { ...ind, ...updates } : ind))
  }

  const removeIndicator = (id) => {
    setIndicators(prev => prev.filter(ind => ind.id !== id))
  }

  const symbolList = market === 'crypto' ? TOP_CRYPTO.map(c => ({ symbol: c.id, name: c.name })) : NIFTY50.map(s => ({ symbol: s.symbol, name: s.name }))

  const latestCandle = candles[candles.length - 1]
  const prevCandle = candles[candles.length - 2]
  const priceChange = latestCandle && prevCandle ? latestCandle.close - prevCandle.close : 0
  const pricePct = prevCandle?.close ? (priceChange / prevCandle.close) * 100 : 0
  const isUp = priceChange >= 0

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Symbol selector */}
        <div className="relative">
          <button
            onClick={() => setSymbolListOpen(!symbolListOpen)}
            className="flex items-center gap-2 bg-surface2 border border-border rounded-lg px-4 py-2.5 text-sm font-display font-semibold hover:border-accent/40 transition-all"
          >
            <span className="text-textprimary">{symbol.replace('.NS', '').replace('.BO', '')}</span>
            <ChevronDown size={14} className="text-muted" />
          </button>
          {symbolListOpen && (
            <div className="absolute top-full left-0 z-50 mt-1 w-72 glass rounded-xl border border-border overflow-hidden">
              <div className="p-2 border-b border-border">
                <input type="text" placeholder="Search symbol..." value={searchQ}
                  onChange={e => setSearchQ(e.target.value)} autoFocus
                  className="w-full text-xs" />
              </div>
              <div className="max-h-64 overflow-y-auto">
                {(searchQ && searchResults.length > 0 ? searchResults : symbolList).map((s, i) => (
                  <button key={i}
                    onClick={() => selectSymbol(s.symbol, market)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface2 border-b border-border/20 last:border-0 transition-colors"
                  >
                    <span className="text-xs font-display font-semibold text-textprimary">{s.symbol?.replace('.NS', '').replace('.BO', '')}</span>
                    <span className="text-xs text-muted font-mono truncate">{s.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Search bar */}
        <div className="flex items-center gap-2 bg-surface2 border border-border rounded-lg px-3 py-2 flex-1 min-w-[200px] max-w-xs">
          <Search size={13} className="text-muted" />
          <input type="text" placeholder="Search & switch symbol..." value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            className="flex-1 bg-transparent border-none outline-none text-xs text-textprimary placeholder:text-muted" />
        </div>
        {searchResults.length > 0 && searchQ && (
          <div className="absolute mt-10 z-50 glass rounded-xl border border-border overflow-hidden w-72">
            {searchResults.map((r, i) => (
              <button key={i} onClick={() => selectSymbol(r.symbol, r.market)}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-surface2 text-left text-xs border-b border-border/30">
                <span className="font-display font-semibold text-textprimary">{r.symbol}</span>
                <span className="text-muted">{r.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Market toggle */}
        <div className="flex gap-1 bg-surface2 rounded-lg p-1 border border-border">
          {['indian', 'crypto'].map(m => (
            <button key={m} onClick={() => { setMarket(m); setSymbol(m === 'indian' ? 'RELIANCE.NS' : 'bitcoin') }}
              className={`px-3 py-1.5 rounded-md text-xs font-display font-medium transition-all ${market === m ? 'bg-accent text-bg' : 'text-muted hover:text-textprimary'}`}>
              {m === 'indian' ? 'NSE' : 'Crypto'}
            </button>
          ))}
        </div>

        {/* Timeframes */}
        <div className="flex gap-1 bg-surface2 rounded-lg p-1 border border-border">
          {TIMEFRAMES.map(t => (
            <button key={t.value} onClick={() => setTimeframe(t.value)}
              className={`px-2.5 py-1.5 rounded-md text-xs font-mono font-medium transition-all ${timeframe === t.value ? 'bg-surface text-accent border border-accent/20' : 'text-muted hover:text-textprimary'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {isIntraday && (
          <span className="text-xs text-warning font-mono px-3 py-1.5 bg-warning/10 border border-warning/20 rounded-lg">
            ⚡ Intraday: max 7–60 days of data
          </span>
        )}

        <button onClick={fetchChart} className="p-2 text-muted hover:text-accent transition-colors" title="Refresh">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Price info bar */}
      {latestCandle && (
        <div className="flex flex-wrap items-center gap-4 px-4 py-3 glass rounded-xl border border-border text-xs font-mono">
          <span className="font-display font-bold text-lg text-textprimary">₹{fmt(latestCandle.close)}</span>
          <span className={isUp ? 'text-accent' : 'text-danger'}>
            {isUp ? '+' : ''}{fmt(priceChange)} ({isUp ? '+' : ''}{pricePct.toFixed(2)}%)
          </span>
          <span className="text-muted">O: ₹{fmt(latestCandle.open)}</span>
          <span className="text-accent">H: ₹{fmt(latestCandle.high)}</span>
          <span className="text-danger">L: ₹{fmt(latestCandle.low)}</span>
          <span className="text-muted">Vol: {latestCandle.volume ? (latestCandle.volume / 1e6).toFixed(2) + 'M' : '--'}</span>
          <span className="text-muted ml-auto">{candles.length} candles</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-4">
        {/* Chart */}
        <div className="space-y-2">
          {error && (
            <div className="p-4 bg-danger/10 border border-danger/30 rounded-xl text-danger text-sm font-mono">
              ⚠️ {error}. Try another symbol or timeframe.
            </div>
          )}
          {loading ? (
            <div className="chart-container relative overflow-hidden" style={{ height: 480 }}>
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
              indicatorDefs={indicators}
              height={480}
            />
          )}
        </div>

        {/* Indicator panel */}
        <div className="glass rounded-xl border border-border p-4 space-y-4 h-fit">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-display font-semibold text-textprimary">Indicators</h3>
            <button onClick={addIndicator} className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 font-mono">
              <Plus size={12} /> Add
            </button>
          </div>

          <div className="space-y-3">
            {indicators.map(ind => {
              const def = INDICATOR_TYPES.find(t => t.type === ind.type)
              const infoTopic = ind.type.toLowerCase().replace('bollinger bands', 'bb')
              return (
                <div key={ind.id} className="p-3 bg-surface2 rounded-lg border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ background: ind.color }} />
                      <span className="text-xs font-mono font-semibold text-textprimary">
                        {ind.type}({ind.period || ''})
                      </span>
                      <InfoTooltip topic={ind.type.toLowerCase()} />
                    </div>
                    <button onClick={() => removeIndicator(ind.id)} className="text-muted hover:text-danger transition-colors">
                      <X size={12} />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-muted font-mono block mb-1">Type</label>
                      <select value={ind.type} onChange={e => updateIndicator(ind.id, { type: e.target.value })} className="text-xs w-full">
                        {INDICATOR_TYPES.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
                      </select>
                    </div>

                    {def?.params.map(p => (
                      <div key={p.name}>
                        <label className="text-xs text-muted font-mono block mb-1">{p.label}</label>
                        <input type="number" value={ind[p.name] ?? p.default}
                          onChange={e => updateIndicator(ind.id, { [p.name]: parseInt(e.target.value) })}
                          className="text-xs w-full" />
                      </div>
                    ))}

                    <div>
                      <label className="text-xs text-muted font-mono block mb-1">Color</label>
                      <div className="flex gap-1 flex-wrap mt-1">
                        {COLORS.map(c => (
                          <button key={c} onClick={() => updateIndicator(ind.id, { color: c })}
                            className="w-4 h-4 rounded-full border-2 transition-all shrink-0"
                            style={{ background: c, borderColor: ind.color === c ? 'white' : 'transparent' }} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}

            {indicators.length === 0 && (
              <div className="text-center py-4 text-xs text-muted font-mono">
                No indicators added.<br />Click "Add" to begin.
              </div>
            )}
          </div>

          {/* Quick indicator presets */}
          <div>
            <p className="text-xs text-muted font-mono mb-2">Quick Add</p>
            <div className="flex flex-wrap gap-1.5">
              {[
                { type: 'EMA', period: 9, color: '#00E5A0' },
                { type: 'EMA', period: 20, color: '#FFB800' },
                { type: 'EMA', period: 50, color: '#00B4FF' },
                { type: 'RSI', period: 14, color: '#A855F7' },
                { type: 'MACD', fast: 12, slow: 26, signal: 9, color: '#F97316' },
                { type: 'BB', period: 20, stdDev: 2, color: '#6366F1' },
                { type: 'VWAP', color: '#EC4899' },
              ].map((preset, i) => (
                <button key={i}
                  onClick={() => setIndicators(prev => [
                    ...prev,
                    { ...preset, id: `${preset.type.toLowerCase()}${Date.now()}` }
                  ])}
                  className="text-xs px-2 py-1 rounded bg-surface border border-border text-muted hover:text-accent hover:border-accent/30 font-mono transition-all">
                  {preset.type}{preset.period ? `(${preset.period})` : ''}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ChartsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted font-mono">Loading charts...</div>}>
      <ChartsInner />
    </Suspense>
  )
}
