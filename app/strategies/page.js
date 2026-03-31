'use client'
import { useState, useEffect } from 'react'
import { Plus, Edit3, Trash2, Copy, FlaskConical, Info, BarChart2, Layers, Search } from 'lucide-react'
import { getStrategies, saveStrategy, deleteStrategy, duplicateStrategy } from '@/lib/strategies'
import { DEFAULT_STRATEGY } from '@/lib/constants'
import StrategyBuilder from '@/components/StrategyBuilder'
import Link from 'next/link'

function StrategyCard({ strategy, onEdit, onDelete, onDuplicate, onBacktest }) {
  const [delConfirm, setDelConfirm] = useState(false)
  const indicators = strategy.indicators || []
  const longConds = strategy.conditions?.longEntry?.length || 0
  const shortConds = strategy.conditions?.shortEntry?.length || 0

  return (
    <div className="strategy-card rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display font-bold text-base text-textprimary">{strategy.name}</h3>
            <span className={`badge ${strategy.market === 'indian' ? 'badge-green' : strategy.market === 'crypto' ? 'badge-yellow' : 'badge-blue'}`}>
              {strategy.market === 'indian' ? 'NSE' : strategy.market === 'crypto' ? 'Crypto' : 'US'}
            </span>
            <span className="badge badge-blue">{strategy.tradeDirection === 'both' ? 'L+S' : strategy.tradeDirection === 'long_only' ? 'Long' : 'Short'}</span>
          </div>
          {strategy.description && (
            <p className="text-xs text-muted font-mono mt-1 line-clamp-2">{strategy.description}</p>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={() => onDuplicate(strategy.id)} title="Duplicate" className="p-2 text-muted hover:text-accent transition-colors">
            <Copy size={14} />
          </button>
          <button onClick={() => onEdit(strategy)} title="Edit" className="p-2 text-muted hover:text-accent transition-colors">
            <Edit3 size={14} />
          </button>
          {!delConfirm ? (
            <button onClick={() => setDelConfirm(true)} title="Delete" className="p-2 text-muted hover:text-danger transition-colors">
              <Trash2 size={14} />
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={() => { onDelete(strategy.id); setDelConfirm(false) }} className="text-xs px-2 py-1 bg-danger/20 text-danger rounded border border-danger/30 font-mono">
                Confirm
              </button>
              <button onClick={() => setDelConfirm(false)} className="text-xs px-2 py-1 text-muted font-mono hover:text-textprimary">
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Indicator pills */}
      <div className="flex flex-wrap gap-2">
        {indicators.map(ind => (
          <span key={ind.id} className="flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded-md bg-surface border border-border">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ind.color || '#00E5A0' }} />
            {ind.type}({ind.period || ind.fast || ''})
          </span>
        ))}
        {indicators.length === 0 && <span className="text-xs text-muted font-mono">No indicators</span>}
      </div>

      {/* Conditions summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-accent/5 border border-accent/10 rounded-lg p-2.5">
          <p className="text-xs text-accent font-mono font-semibold mb-1">▲ LONG</p>
          <p className="text-xs text-textsecondary font-mono">Entry: {longConds} condition{longConds !== 1 ? 's' : ''}</p>
          <p className="text-xs text-textsecondary font-mono">Exit: {strategy.conditions?.longExit?.length || 0} condition{(strategy.conditions?.longExit?.length || 0) !== 1 ? 's' : ''}</p>
        </div>
        {(strategy.tradeDirection === 'short_only' || strategy.tradeDirection === 'both') && (
          <div className="bg-danger/5 border border-danger/10 rounded-lg p-2.5">
            <p className="text-xs text-danger font-mono font-semibold mb-1">▼ SHORT</p>
            <p className="text-xs text-textsecondary font-mono">Entry: {shortConds} condition{shortConds !== 1 ? 's' : ''}</p>
            <p className="text-xs text-textsecondary font-mono">Exit: {strategy.conditions?.shortExit?.length || 0} condition{(strategy.conditions?.shortExit?.length || 0) !== 1 ? 's' : ''}</p>
          </div>
        )}
      </div>

      {/* Risk management */}
      <div className="flex gap-3 text-xs font-mono text-muted">
        <span>🛡 SL: {strategy.stopLoss?.type?.replace(/_/g, ' ') || 'none'}</span>
        <span>🎯 TP: {strategy.takeProfit?.type?.replace(/_/g, ' ') || 'none'}</span>
        <span>📊 {strategy.positionSize || 10}% size</span>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1 border-t border-border">
        <button onClick={() => onEdit(strategy)}
          className="btn-ghost text-xs flex-1 flex items-center justify-center gap-1.5">
          <Edit3 size={12} /> Edit
        </button>
        <Link href={`/backtest?strategy=${strategy.id}`}
          className="btn-primary text-xs flex-1 flex items-center justify-center gap-1.5">
          <FlaskConical size={12} /> Backtest
        </Link>
      </div>

      {/* Timestamps */}
      <p className="text-[10px] text-muted font-mono">
        Created {new Date(strategy.createdAt).toLocaleDateString('en-IN')} ·
        Updated {new Date(strategy.updatedAt).toLocaleDateString('en-IN')}
      </p>
    </div>
  )
}

function StrategyModal({ strategy, onSave, onClose }) {
  const [draft, setDraft] = useState(strategy)

  const handleSave = () => {
    if (!draft.name?.trim()) { alert('Please enter a strategy name'); return }
    onSave(draft)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 modal-backdrop overflow-y-auto">
      <div className="w-full max-w-2xl my-4 glass rounded-2xl border border-border overflow-hidden">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface">
          <div>
            <h2 className="font-display font-bold text-lg text-textprimary">
              {strategy.id && strategy.createdAt ? 'Edit Strategy' : 'New Strategy'}
            </h2>
            <p className="text-xs text-muted font-mono mt-0.5">Configure indicators, conditions and risk management</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-textprimary transition-colors px-3 py-1 text-sm">✕ Close</button>
        </div>

        {/* Modal body */}
        <div className="p-6 overflow-y-auto max-h-[75vh]">
          <StrategyBuilder strategy={draft} onChange={setDraft} />
        </div>

        {/* Modal footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-border bg-surface">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={handleSave} className="btn-primary flex-1">
            Save Strategy
          </button>
        </div>
      </div>
    </div>
  )
}

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editingStrategy, setEditingStrategy] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    setStrategies(getStrategies())
  }, [])

  const handleNew = () => {
    setEditingStrategy({
      ...DEFAULT_STRATEGY,
      id: crypto.randomUUID(),
      createdAt: null,
      updatedAt: null,
    })
    setModalOpen(true)
  }

  const handleEdit = (strategy) => {
    setEditingStrategy({ ...strategy })
    setModalOpen(true)
  }

  const handleSave = (strategy) => {
    saveStrategy(strategy)
    setStrategies(getStrategies())
    setModalOpen(false)
    setEditingStrategy(null)
  }

  const handleDelete = (id) => {
    deleteStrategy(id)
    setStrategies(getStrategies())
  }

  const handleDuplicate = (id) => {
    duplicateStrategy(id)
    setStrategies(getStrategies())
  }

  const filtered = strategies.filter(s =>
    s.name?.toLowerCase().includes(search.toLowerCase()) ||
    s.description?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-textprimary">
            Trading <span className="gradient-text">Strategies</span>
          </h1>
          <p className="text-xs text-muted font-mono mt-1">
            {strategies.length} strateg{strategies.length !== 1 ? 'ies' : 'y'} saved locally
          </p>
        </div>
        <button onClick={handleNew} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> New Strategy
        </button>
      </div>

      {/* Search */}
      {strategies.length > 0 && (
        <div className="flex items-center gap-2 glass rounded-xl px-4 py-3 border border-border max-w-md">
          <Search size={14} className="text-muted" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Filter strategies..."
            className="flex-1 bg-transparent border-none outline-none text-sm text-textprimary placeholder:text-muted" />
        </div>
      )}

      {/* Empty state */}
      {strategies.length === 0 && (
        <div className="text-center py-20 space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto">
            <Layers size={28} className="text-accent" />
          </div>
          <div>
            <h2 className="font-display font-bold text-xl text-textprimary">No Strategies Yet</h2>
            <p className="text-muted font-mono text-sm mt-2 max-w-md mx-auto">
              Create your first trading strategy with custom indicators, entry/exit conditions, and risk management rules.
            </p>
          </div>
          <button onClick={handleNew} className="btn-primary mx-auto">
            <Plus size={16} className="inline mr-2" /> Create First Strategy
          </button>

          {/* Example strategy preview */}
          <div className="glass rounded-xl border border-accent/20 p-5 max-w-lg mx-auto text-left mt-8">
            <p className="text-xs text-accent font-mono mb-3">📖 Example — EMA 9/20 Crossover</p>
            <div className="space-y-2 text-xs font-mono text-textsecondary">
              <p>• <span className="text-accent">Buy</span> when EMA-9 crosses above EMA-20 (uptrend)</p>
              <p>• <span className="text-danger">Sell</span> when EMA-9 crosses below EMA-20 (downtrend)</p>
              <p>• Stop Loss: Low of the previous candle</p>
              <p>• Works on NSE stocks & Crypto</p>
            </div>
          </div>
        </div>
      )}

      {/* Strategy grid */}
      {filtered.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(s => (
            <StrategyCard
              key={s.id}
              strategy={s}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onBacktest={id => {}}
            />
          ))}
        </div>
      )}

      {filtered.length === 0 && strategies.length > 0 && (
        <div className="text-center py-12 text-muted font-mono">
          No strategies match "{search}"
        </div>
      )}

      {/* Modal */}
      {modalOpen && editingStrategy && (
        <StrategyModal
          strategy={editingStrategy}
          onSave={handleSave}
          onClose={() => { setModalOpen(false); setEditingStrategy(null) }}
        />
      )}
    </div>
  )
}
