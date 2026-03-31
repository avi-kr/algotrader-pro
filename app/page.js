'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, TrendingUp, TrendingDown, RefreshCw, ArrowUpRight, ArrowDownRight, X, Zap, Globe, Bitcoin } from 'lucide-react'
import { NIFTY50, TOP_CRYPTO } from '@/lib/constants'
import InfoTooltip from '@/components/InfoTooltip'
import Link from 'next/link'

const fmt = (v, dec = 2) => v != null ? Number(v).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '--'
const fmtCr = v => {
  if (!v) return '--'
  if (v >= 1e12) return `₹${(v / 1e12).toFixed(1)}L Cr`
  if (v >= 1e9) return `₹${(v / 1e9).toFixed(1)}k Cr`
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(1)} Cr`
  return `₹${fmt(v)}`
}

function MiniSparkline({ change }) {
  const up = change >= 0
  const color = up ? '#00E5A0' : '#FF4560'
  const points = up
    ? '0,12 8,10 16,8 24,9 32,6 40,4 48,2'
    : '0,2 8,4 16,6 24,5 32,8 40,10 48,12'
  return (
    <svg width="50" height="14" viewBox="0 0 50 14">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" opacity="0.8" />
    </svg>
  )
}

function TickerBar({ quotes }) {
  if (!quotes.length) return null
  const doubled = [...quotes, ...quotes]
  return (
    <div className="ticker-wrap bg-surface border-y border-border py-2">
      <div className="ticker-content">
        {doubled.map((q, i) => {
          const up = q.changePct >= 0
          return (
            <span key={i} className="inline-flex items-center gap-2 mx-6 text-xs font-mono">
              <span className="text-textprimary font-semibold">{q.symbol?.replace('.NS', '').replace('.BO', '')}</span>
              <span className={up ? 'text-accent' : 'text-danger'}>₹{fmt(q.price)}</span>
              <span className={`${up ? 'text-accent' : 'text-danger'} flex items-center gap-0.5`}>
                {up ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                {Math.abs(q.changePct).toFixed(2)}%
              </span>
              <span className="text-border">|</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

function QuoteRow({ q, onClick }) {
  const up = q.changePct >= 0
  return (
    <tr
      className="border-b border-border/30 table-row-hover cursor-pointer transition-all"
      onClick={() => onClick(q)}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {q.image && <img src={q.image} className="w-6 h-6 rounded-full" alt="" />}
          <div>
            <div className="text-sm font-display font-semibold text-textprimary">
              {q.symbol?.replace('.NS', '').replace('.BO', '')}
            </div>
            <div className="text-xs text-muted font-mono truncate max-w-[150px]">{q.name}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-right num font-mono text-sm text-textprimary">
        ₹{fmt(q.price)}
      </td>
      <td className={`px-4 py-3 text-right num font-mono text-sm ${up ? 'text-accent' : 'text-danger'}`}>
        {up ? '+' : ''}{fmt(q.change)}
      </td>
      <td className={`px-4 py-3 text-right num font-mono text-sm ${up ? 'text-accent' : 'text-danger'}`}>
        <div className="flex items-center justify-end gap-1">
          {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          {Math.abs(q.changePct).toFixed(2)}%
        </div>
      </td>
      <td className="px-4 py-3 text-right hidden md:table-cell">
        <MiniSparkline change={q.changePct} />
      </td>
      <td className="px-4 py-3 text-right text-xs text-muted font-mono hidden lg:table-cell">
        {fmtCr(q.marketCap)}
      </td>
      <td className="px-4 py-3 text-right text-xs text-muted font-mono hidden xl:table-cell">
        {q.volume ? `${(q.volume / 1e6).toFixed(2)}M` : '--'}
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          href={`/charts?symbol=${q.symbol || q.id}&market=${q.market}`}
          className="text-xs text-accent hover:underline font-mono"
          onClick={e => e.stopPropagation()}
        >
          Chart →
        </Link>
      </td>
    </tr>
  )
}

function StatCard({ label, value, sub, icon: Icon, color }) {
  return (
    <div className="glass rounded-xl p-5 border border-border flex items-start gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0`} style={{ background: `${color}18` }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div>
        <p className="text-xs text-muted font-mono">{label}</p>
        <p className="text-xl font-display font-bold text-textprimary num mt-0.5">{value}</p>
        {sub && <p className="text-xs text-muted font-mono mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function SearchDropdown({ results, onSelect, onClose, loading }) {
  if (loading) return (
    <div className="absolute top-full left-0 right-0 z-50 mt-1 glass rounded-xl border border-border p-4 text-center text-xs text-muted font-mono">
      Searching...
    </div>
  )
  if (!results.length) return null
  return (
    <div className="absolute top-full left-0 right-0 z-50 mt-1 glass rounded-xl border border-border overflow-hidden">
      {results.map((r, i) => (
        <button key={i} onClick={() => { onSelect(r); onClose() }}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface2 border-b border-border/30 last:border-0 transition-colors">
          <div>
            <span className="text-sm font-display font-semibold text-textprimary">{r.symbol}</span>
            <span className="text-xs text-muted font-mono ml-2">{r.name}</span>
          </div>
          <span className="text-xs text-muted font-mono">{r.exchange}</span>
        </button>
      ))}
    </div>
  )
}

export default function HomePage() {
  const [market, setMarket] = useState('indian')
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [pinned, setPinned] = useState([])
  const searchRef = useRef(null)
  const searchTimeout = useRef(null)

  const fetchQuotes = useCallback(async () => {
    try {
      const res = await fetch(`/api/quotes?type=${market}`)
      const data = await res.json()
      if (data.quotes) {
        setQuotes(data.quotes)
        setLastUpdated(new Date())
      }
    } catch (e) {
      console.error('Quote fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [market])

  useEffect(() => {
    setLoading(true)
    setQuotes([])
    fetchQuotes()
    const interval = setInterval(fetchQuotes, 30000)
    return () => clearInterval(interval)
  }, [fetchQuotes])

  // Search debounce
  useEffect(() => {
    if (!searchQ || searchQ.length < 2) { setSearchResults([]); return }
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQ)}`)
        const data = await res.json()
        setSearchResults(data.results || [])
      } catch { setSearchResults([]) }
      setSearchLoading(false)
    }, 400)
    return () => clearTimeout(searchTimeout.current)
  }, [searchQ])

  const gainers = [...quotes].sort((a, b) => b.changePct - a.changePct).slice(0, 3)
  const losers = [...quotes].sort((a, b) => a.changePct - b.changePct).slice(0, 3)
  const advancing = quotes.filter(q => q.changePct > 0).length
  const declining = quotes.filter(q => q.changePct < 0).length

  const handleSymbolSelect = (sym) => {
    window.location.href = `/charts?symbol=${sym.symbol}&market=${sym.market || market}`
  }

  return (
    <div className="bg-grid min-h-screen">
      {/* Ticker */}
      {!loading && quotes.length > 0 && <TickerBar quotes={quotes.slice(0, 20)} />}

      <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-textprimary">
              Market <span className="gradient-text">Dashboard</span>
            </h1>
            <p className="text-xs text-muted font-mono mt-1">
              {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString('en-IN')} · Auto-refreshes every 30s` : 'Loading live data...'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Market toggle */}
            <div className="flex items-center gap-1 bg-surface2 rounded-lg p-1 border border-border">
              {[
                { key: 'indian', label: 'NSE', icon: Globe },
                { key: 'crypto', label: 'Crypto', icon: Bitcoin },
              ].map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setMarket(key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-display font-medium transition-all ${market === key ? 'bg-accent text-bg' : 'text-muted hover:text-textprimary'}`}
                >
                  <Icon size={12} />
                  {label}
                </button>
              ))}
            </div>
            <button onClick={fetchQuotes} className="p-2 text-muted hover:text-accent transition-colors" title="Refresh">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Market Overview Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Advancing" value={advancing} sub="stocks up today" icon={TrendingUp} color="#00E5A0" />
          <StatCard label="Declining" value={declining} sub="stocks down today" icon={TrendingDown} color="#FF4560" />
          <StatCard label="Top Gainer" value={gainers[0] ? `+${gainers[0].changePct.toFixed(2)}%` : '--'}
            sub={gainers[0]?.symbol?.replace('.NS', '')} icon={ArrowUpRight} color="#00E5A0" />
          <StatCard label="Top Loser" value={losers[0] ? `${losers[0].changePct.toFixed(2)}%` : '--'}
            sub={losers[0]?.symbol?.replace('.NS', '')} icon={ArrowDownRight} color="#FF4560" />
        </div>

        {/* Search */}
        <div className="relative" ref={searchRef}>
          <div className="flex items-center gap-3 glass rounded-xl px-4 py-3 border border-border focus-within:border-accent/40 transition-colors">
            <Search size={16} className="text-muted shrink-0" />
            <input
              type="text"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Search any stock or crypto... (e.g. INFY, Nifty, BTC)"
              className="flex-1 bg-transparent border-none outline-none text-sm text-textprimary placeholder:text-muted"
            />
            {searchQ && (
              <button onClick={() => { setSearchQ(''); setSearchResults([]) }}>
                <X size={14} className="text-muted hover:text-textprimary" />
              </button>
            )}
          </div>
          <SearchDropdown results={searchResults} onSelect={handleSymbolSelect} onClose={() => { setSearchQ(''); setSearchResults([]) }} loading={searchLoading} />
        </div>

        {/* Main Table */}
        <div className="glass rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-accent pulse-live" />
              <span className="text-sm font-display font-semibold text-textprimary">
                {market === 'indian' ? 'NIFTY 50 Stocks' : 'Top Cryptocurrencies'}
              </span>
              <span className="badge badge-blue">{quotes.length} symbols</span>
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center">
              <div className="inline-flex items-center gap-3 text-sm text-muted font-mono">
                <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                Fetching live market data...
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-surface2 text-xs font-mono text-muted">
                    <th className="px-4 py-3 text-left">Symbol</th>
                    <th className="px-4 py-3 text-right">Price</th>
                    <th className="px-4 py-3 text-right">Change</th>
                    <th className="px-4 py-3 text-right">Change %</th>
                    <th className="px-4 py-3 text-right hidden md:table-cell">Trend</th>
                    <th className="px-4 py-3 text-right hidden lg:table-cell">Mkt Cap</th>
                    <th className="px-4 py-3 text-right hidden xl:table-cell">Volume</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q, i) => (
                    <QuoteRow key={q.symbol || q.id || i} q={q} onClick={handleSymbolSelect} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Quick links */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { href: '/charts', title: 'Live Charts', desc: 'TradingView-style charts with indicators', color: '#00E5A0', icon: '📈' },
            { href: '/strategies', title: 'Strategies', desc: 'Build, view, edit & delete trading strategies', color: '#FFB800', icon: '⚡' },
            { href: '/backtest', title: 'Backtest', desc: 'Test strategies on historical data', color: '#00B4FF', icon: '🔬' },
          ].map(({ href, title, desc, color, icon }) => (
            <Link key={href} href={href}
              className="strategy-card rounded-xl p-5 flex items-start gap-4 group"
              style={{ borderColor: `${color}20` }}
            >
              <span className="text-2xl">{icon}</span>
              <div>
                <h3 className="font-display font-semibold text-sm group-hover:text-accent transition-colors" style={{ color }}>{title}</h3>
                <p className="text-xs text-muted font-mono mt-1">{desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
