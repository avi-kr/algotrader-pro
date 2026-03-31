'use client'
import { useState } from 'react'
import { AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { TrendingUp, TrendingDown, Target, AlertTriangle, Award, ChevronDown, ChevronUp, BarChart2, List } from 'lucide-react'
import InfoTooltip from './InfoTooltip'

const fmt = (v, dec = 2) => v != null ? v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '--'
const fmtPct = v => v != null ? `${v >= 0 ? '+' : ''}${fmt(v)}%` : '--'
const fmtINR = v => v != null ? `₹${fmt(Math.abs(v))}` : '--'

function MetricCard({ label, value, sub, color, topic }) {
  return (
    <div className="metric-card rounded-xl p-4">
      <div className="flex items-start justify-between mb-1">
        <span className="text-xs text-textsecondary font-mono">{label}</span>
        {topic && <InfoTooltip topic={topic} />}
      </div>
      <div className={`text-xl font-display font-bold ${color || 'text-textprimary'} num`}>{value}</div>
      {sub && <div className="text-xs text-muted mt-1 font-mono">{sub}</div>}
    </div>
  )
}

function ScoreGauge({ value, max, label, colorFn }) {
  const pct = Math.min(Math.max((value / max) * 100, 0), 100)
  const color = colorFn(value)
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs font-mono">
        <span className="text-textsecondary">{label}</span>
        <span className={color}>{fmt(value, 2)}</span>
      </div>
      <div className="h-1.5 bg-surface2 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color === 'text-accent' ? '#00E5A0' : color === 'text-danger' ? '#FF4560' : '#FFB800' }} />
      </div>
    </div>
  )
}

export default function BacktestReport({ result, symbol, strategy }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [sortField, setSortField] = useState('id')
  const [sortDir, setSortDir] = useState('asc')

  if (!result) return null
  if (result.error) return (
    <div className="bg-surface2 border border-border rounded-xl p-6 text-center">
      <AlertTriangle size={24} className="text-danger mx-auto mb-2" />
      <p className="text-danger font-mono text-sm">{result.error}</p>
    </div>
  )

  const { trades = [], equityCurve = [], metrics = {} } = result
  const m = metrics

  const isProfit = m.netPnl >= 0
  const winRateColor = m.winRate >= 55 ? 'text-accent' : m.winRate >= 40 ? 'text-warning' : 'text-danger'
  const sharpeColor = m.sharpeRatio >= 1.5 ? 'text-accent' : m.sharpeRatio >= 0.5 ? 'text-warning' : 'text-danger'
  const pfColor = m.profitFactor >= 2 ? 'text-accent' : m.profitFactor >= 1.2 ? 'text-warning' : 'text-danger'

  // Equity curve data
  const equityData = equityCurve.map(p => ({
    date: new Date(p.date * 1000).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
    value: p.value,
    pnl: p.value - (m.initialCapital || 100000),
  }))

  // Monthly P&L
  const monthlyData = Object.entries(m.monthlyPnl || {}).map(([month, pnl]) => ({
    month: month.slice(2), // "23-01" etc
    pnl,
    color: pnl >= 0 ? '#00E5A0' : '#FF4560',
  })).slice(-24)

  // Trade P&L distribution
  const tradeData = trades.map(t => ({ id: t.id, pnl: t.pnl, pct: t.pnlPct }))

  // Sort trades
  const sortedTrades = [...trades].sort((a, b) => {
    const av = a[sortField], bv = b[sortField]
    return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
  })

  const handleSort = field => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: BarChart2 },
    { id: 'trades', label: `Trades (${trades.length})`, icon: List },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-lg text-textprimary">Backtest Report</h2>
          <p className="text-xs text-muted font-mono mt-0.5">
            {symbol} · {strategy?.name} · {trades.length} trades · {m.totalBars} bars
          </p>
        </div>
        <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border ${isProfit ? 'border-accent/20 bg-accent/5' : 'border-danger/20 bg-danger/5'}`}>
          {isProfit ? <TrendingUp size={16} className="text-accent" /> : <TrendingDown size={16} className="text-danger" />}
          <div>
            <div className={`font-display font-bold text-lg num ${isProfit ? 'text-accent' : 'text-danger'}`}>
              {isProfit ? '+' : '-'}₹{fmt(Math.abs(m.netPnl))}
            </div>
            <div className={`text-xs font-mono ${isProfit ? 'text-accent' : 'text-danger'}`}>
              {fmtPct(m.netPnlPct)} return
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface2 p-1 rounded-lg border border-border">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 flex-1 justify-center px-4 py-2 rounded-md text-xs font-display font-medium transition-all ${
              activeTab === id ? 'bg-surface text-textprimary border border-border' : 'text-muted hover:text-textsecondary'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <>
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard label="Net P&L" value={`${isProfit ? '+' : ''}₹${fmt(m.netPnl)}`} sub={fmtPct(m.netPnlPct)} color={isProfit ? 'text-accent' : 'text-danger'} />
            <MetricCard label="Win Rate" value={fmtPct(m.winRate)} sub={`${m.winningTrades}W / ${m.losingTrades}L`} color={m.winRate >= 50 ? 'text-accent' : 'text-danger'} topic="winrate" />
            <MetricCard label="Profit Factor" value={isFinite(m.profitFactor) ? fmt(m.profitFactor) : '∞'} sub={`Gross: ₹${fmt(m.grossProfit)}`} color={m.profitFactor >= 1.5 ? 'text-accent' : 'text-danger'} topic="profitfactor" />
            <MetricCard label="Max Drawdown" value={fmtPct(-m.maxDrawdownPct)} sub={`₹${fmt(m.maxDrawdown)}`} color="text-danger" topic="drawdown" />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard label="Sharpe Ratio" value={fmt(m.sharpeRatio)} sub="Annualized" color={m.sharpeRatio >= 1 ? 'text-accent' : 'text-danger'} topic="sharpe" />
            <MetricCard label="Sortino Ratio" value={fmt(m.sortinoRatio)} sub="Downside risk adj." color={m.sortinoRatio >= 1 ? 'text-accent' : 'text-warning'} />
            <MetricCard label="Annual Return" value={fmtPct(m.annualReturn)} sub="CAGR" color={m.annualReturn >= 0 ? 'text-accent' : 'text-danger'} />
            <MetricCard label="Calmar Ratio" value={fmt(m.calmarRatio)} sub="Return / Drawdown" color={m.calmarRatio >= 1 ? 'text-accent' : 'text-warning'} />
          </div>

          {/* Score bars */}
          <div className="glass rounded-xl p-5 border border-border">
            <h3 className="text-sm font-display font-semibold mb-4 text-textprimary">Strategy Quality Scores</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <ScoreGauge value={m.winRate} max={100} label="Win Rate" colorFn={v => v >= 55 ? 'text-accent' : v >= 40 ? 'text-warning' : 'text-danger'} />
              <ScoreGauge value={Math.min(m.profitFactor, 4)} max={4} label="Profit Factor (max 4)" colorFn={v => v >= 2 ? 'text-accent' : v >= 1.2 ? 'text-warning' : 'text-danger'} />
              <ScoreGauge value={Math.max(0, Math.min(m.sharpeRatio, 3))} max={3} label="Sharpe Ratio (max 3)" colorFn={v => v >= 1.5 ? 'text-accent' : v >= 0.5 ? 'text-warning' : 'text-danger'} />
              <ScoreGauge value={Math.max(0, 100 - m.maxDrawdownPct)} max={100} label="Drawdown Health" colorFn={v => v >= 85 ? 'text-accent' : v >= 70 ? 'text-warning' : 'text-danger'} />
            </div>
          </div>

          {/* Equity Curve */}
          <div className="glass rounded-xl p-5 border border-border">
            <h3 className="text-sm font-display font-semibold mb-4 text-textprimary">Equity Curve</h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={isProfit ? '#00E5A0' : '#FF4560'} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={isProfit ? '#00E5A0' : '#FF4560'} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E2330" />
                  <XAxis dataKey="date" stroke="#64748B" tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono' }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis stroke="#64748B" tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono' }} tickLine={false} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ background: '#0F1117', border: '1px solid #1E2330', borderRadius: '8px', fontFamily: 'IBM Plex Mono', fontSize: 11 }}
                    formatter={v => [`₹${fmt(v)}`, 'Equity']}
                  />
                  <ReferenceLine y={m.initialCapital} stroke="#64748B" strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="value" stroke={isProfit ? '#00E5A0' : '#FF4560'} strokeWidth={2} fill="url(#equityGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Monthly P&L */}
          {monthlyData.length > 0 && (
            <div className="glass rounded-xl p-5 border border-border">
              <h3 className="text-sm font-display font-semibold mb-4 text-textprimary">Monthly P&L</h3>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E2330" />
                    <XAxis dataKey="month" stroke="#64748B" tick={{ fontSize: 9, fontFamily: 'IBM Plex Mono' }} tickLine={false} />
                    <YAxis stroke="#64748B" tick={{ fontSize: 9, fontFamily: 'IBM Plex Mono' }} tickLine={false} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: '#0F1117', border: '1px solid #1E2330', borderRadius: '8px', fontFamily: 'IBM Plex Mono', fontSize: 11 }}
                      formatter={v => [`${v >= 0 ? '+' : ''}₹${fmt(v)}`, 'P&L']}
                    />
                    <ReferenceLine y={0} stroke="#64748B" />
                    <Bar dataKey="pnl" fill="#00E5A0" radius={[2, 2, 0, 0]}
                      cell={monthlyData.map((_, i) => <rect key={i} fill={monthlyData[i].pnl >= 0 ? '#00E5A0' : '#FF4560'} />)}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Stats table */}
          <div className="glass rounded-xl p-5 border border-border">
            <h3 className="text-sm font-display font-semibold mb-4 text-textprimary">Detailed Statistics</h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2">
              {[
                ['Total Trades', m.totalTrades],
                ['Winning Trades', m.winningTrades],
                ['Losing Trades', m.losingTrades],
                ['Avg Trade', `${m.avgTrade >= 0 ? '+' : ''}₹${fmt(m.avgTrade)}`],
                ['Avg Win', `+₹${fmt(m.avgWin)}`],
                ['Avg Loss', `-₹${fmt(Math.abs(m.avgLoss))}`],
                ['Best Trade', `+₹${fmt(m.bestTrade)}`],
                ['Worst Trade', `-₹${fmt(Math.abs(m.worstTrade))}`],
                ['Avg Bars Held', fmt(m.avgBarsHeld, 1)],
                ['Initial Capital', `₹${fmt(m.initialCapital)}`],
                ['Final Equity', `₹${fmt(m.finalEquity)}`],
                ['Gross Profit', `₹${fmt(m.grossProfit)}`],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-xs font-mono py-1.5 border-b border-border/50">
                  <span className="text-textsecondary">{label}</span>
                  <span className="text-textprimary">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {activeTab === 'trades' && (
        <div className="glass rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-border bg-surface2">
                  {[
                    ['id', '#'],
                    ['type', 'Direction'],
                    ['entryDate', 'Entry Date'],
                    ['exitDate', 'Exit Date'],
                    ['entryPrice', 'Entry ₹'],
                    ['exitPrice', 'Exit ₹'],
                    ['qty', 'Qty'],
                    ['pnl', 'P&L ₹'],
                    ['pnlPct', 'P&L %'],
                    ['barsHeld', 'Bars'],
                    ['exitReason', 'Exit Reason'],
                  ].map(([field, label]) => (
                    <th key={field}
                      className="px-3 py-3 text-left text-textsecondary cursor-pointer hover:text-textprimary whitespace-nowrap"
                      onClick={() => handleSort(field)}
                    >
                      {label} {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedTrades.map(t => (
                  <tr key={t.id} className="border-b border-border/30 table-row-hover">
                    <td className="px-3 py-2.5 text-muted">{t.id}</td>
                    <td className="px-3 py-2.5">
                      <span className={`badge ${t.type === 'long' ? 'badge-green' : 'badge-red'}`}>
                        {t.type === 'long' ? '▲ Long' : '▼ Short'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-textsecondary">
                      {new Date(t.entryDate * 1000).toLocaleDateString('en-IN')}
                    </td>
                    <td className="px-3 py-2.5 text-textsecondary">
                      {new Date(t.exitDate * 1000).toLocaleDateString('en-IN')}
                    </td>
                    <td className="px-3 py-2.5 text-textprimary">{fmt(t.entryPrice)}</td>
                    <td className="px-3 py-2.5 text-textprimary">{fmt(t.exitPrice)}</td>
                    <td className="px-3 py-2.5 text-textprimary">{t.qty}</td>
                    <td className={`px-3 py-2.5 font-semibold ${t.pnl >= 0 ? 'text-accent' : 'text-danger'}`}>
                      {t.pnl >= 0 ? '+' : ''}₹{fmt(t.pnl)}
                    </td>
                    <td className={`px-3 py-2.5 ${t.pnlPct >= 0 ? 'text-accent' : 'text-danger'}`}>
                      {fmtPct(t.pnlPct)}
                    </td>
                    <td className="px-3 py-2.5 text-textsecondary">{t.barsHeld}</td>
                    <td className="px-3 py-2.5">
                      <span className={`badge ${t.exitReason === 'Stop Loss' ? 'badge-red' : t.exitReason === 'Take Profit' ? 'badge-green' : 'badge-blue'}`}>
                        {t.exitReason}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
