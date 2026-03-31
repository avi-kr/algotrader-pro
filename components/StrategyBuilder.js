'use client'
import { useState } from 'react'
import { Plus, Trash2, ChevronDown, Info } from 'lucide-react'
import { INDICATOR_TYPES, CONDITION_TYPES, STOP_LOSS_TYPES, TAKE_PROFIT_TYPES } from '@/lib/constants'
import InfoTooltip from './InfoTooltip'

const COLORS = ['#00E5A0', '#FFB800', '#00B4FF', '#FF4560', '#A855F7', '#F97316', '#EC4899']
const DIRECTIONS = ['long_only', 'short_only', 'both']

function Section({ title, children, topic }) {
  return (
    <div className="glass rounded-xl p-5 border border-border">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="font-display font-semibold text-sm text-textprimary">{title}</h3>
        {topic && <InfoTooltip topic={topic} />}
      </div>
      {children}
    </div>
  )
}

function IndicatorRow({ ind, index, onChange, onRemove, allIndicators }) {
  const def = INDICATOR_TYPES.find(t => t.type === ind.type) || INDICATOR_TYPES[0]

  return (
    <div className="flex flex-wrap gap-2 p-3 bg-surface2 rounded-lg border border-border items-end">
      {/* Type */}
      <div className="flex flex-col gap-1 min-w-[100px]">
        <label className="text-xs text-muted font-mono">Type</label>
        <select value={ind.type} onChange={e => onChange(index, { ...ind, type: e.target.value })} className="text-xs">
          {INDICATOR_TYPES.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
        </select>
      </div>

      {/* ID */}
      <div className="flex flex-col gap-1 w-24">
        <label className="text-xs text-muted font-mono">ID</label>
        <input type="text" value={ind.id} onChange={e => onChange(index, { ...ind, id: e.target.value })} className="text-xs" placeholder="e.g. ema9" />
      </div>

      {/* Params */}
      {def.params.map(p => (
        <div key={p.name} className="flex flex-col gap-1 w-20">
          <label className="text-xs text-muted font-mono">{p.label}</label>
          <input type="number" value={ind[p.name] ?? p.default} onChange={e => onChange(index, { ...ind, [p.name]: parseInt(e.target.value) })} className="text-xs" />
        </div>
      ))}

      {/* Color */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted font-mono">Color</label>
        <div className="flex gap-1">
          {COLORS.map(c => (
            <button key={c} onClick={() => onChange(index, { ...ind, color: c })}
              className="w-5 h-5 rounded-full border-2 transition-all"
              style={{ background: c, borderColor: ind.color === c ? 'white' : 'transparent' }}
            />
          ))}
        </div>
      </div>

      <button onClick={() => onRemove(index)} className="btn-danger text-xs px-2 py-1.5 ml-auto">
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function ConditionRow({ cond, index, onChange, onRemove, indicators }) {
  return (
    <div className="flex flex-wrap gap-2 p-3 bg-surface2 rounded-lg border border-border items-end">
      {/* Indicator A */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted font-mono">Indicator A</label>
        <select value={cond.a} onChange={e => onChange(index, { ...cond, a: e.target.value })} className="text-xs">
          {indicators.map(ind => <option key={ind.id} value={ind.id}>{ind.id} ({ind.type})</option>)}
          {['open', 'high', 'low', 'close', 'volume'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Condition type */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted font-mono">Condition</label>
        <select value={cond.type} onChange={e => onChange(index, { ...cond, type: e.target.value })} className="text-xs">
          {CONDITION_TYPES.map(c => <option key={c.type} value={c.type}>{c.label}</option>)}
        </select>
      </div>

      {/* Indicator B or value */}
      {CONDITION_TYPES.find(c => c.type === cond.type)?.requiresValue ? (
        <div className="flex flex-col gap-1 w-24">
          <label className="text-xs text-muted font-mono">Value</label>
          <input type="number" value={cond.value ?? ''} onChange={e => onChange(index, { ...cond, value: e.target.value })} className="text-xs" placeholder="e.g. 70" />
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted font-mono">Indicator B</label>
          <select value={cond.b || ''} onChange={e => onChange(index, { ...cond, b: e.target.value })} className="text-xs">
            <option value="">-- select --</option>
            {indicators.map(ind => <option key={ind.id} value={ind.id}>{ind.id} ({ind.type})</option>)}
          </select>
        </div>
      )}

      <button onClick={() => onRemove(index)} className="btn-danger text-xs px-2 py-1.5 ml-auto">
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function ConditionGroup({ title, conditions, onChange, indicators, color, topic }) {
  const addCondition = () => {
    const first = indicators[0]?.id || 'ema9'
    onChange([...conditions, { type: 'crossover', a: first, b: indicators[1]?.id || first }])
  }
  const updateCond = (i, cond) => onChange(conditions.map((c, idx) => idx === i ? cond : c))
  const removeCond = (i) => onChange(conditions.filter((_, idx) => idx !== i))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded" style={{ background: `${color}15`, color }}>{title}</span>
          {topic && <InfoTooltip topic={topic} />}
        </div>
        <button onClick={addCondition} className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 font-mono">
          <Plus size={12} /> Add condition
        </button>
      </div>
      {conditions.length === 0 ? (
        <div className="text-xs text-muted font-mono p-3 bg-surface2 rounded-lg border border-dashed border-border text-center">
          No conditions — click "Add condition"
        </div>
      ) : (
        conditions.map((cond, i) => (
          <ConditionRow key={i} cond={cond} index={i} onChange={updateCond} onRemove={removeCond} indicators={indicators} />
        ))
      )}
    </div>
  )
}

export default function StrategyBuilder({ strategy, onChange }) {
  const set = (key, val) => onChange({ ...strategy, [key]: val })
  const setCondition = (key, val) => onChange({ ...strategy, conditions: { ...strategy.conditions, [key]: val } })

  const addIndicator = () => {
    const newInd = { id: `ind${strategy.indicators.length + 1}`, type: 'EMA', period: 20, source: 'close', color: COLORS[strategy.indicators.length % COLORS.length] }
    set('indicators', [...strategy.indicators, newInd])
  }
  const updateIndicator = (i, ind) => set('indicators', strategy.indicators.map((v, idx) => idx === i ? ind : v))
  const removeIndicator = (i) => set('indicators', strategy.indicators.filter((_, idx) => idx !== i))

  return (
    <div className="space-y-4">
      {/* Basic Info */}
      <Section title="Strategy Info">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted font-mono">Strategy Name</label>
            <input type="text" value={strategy.name} onChange={e => set('name', e.target.value)} placeholder="My Strategy" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted font-mono">Market</label>
            <select value={strategy.market} onChange={e => set('market', e.target.value)}>
              <option value="indian">Indian (NSE/BSE)</option>
              <option value="crypto">Crypto</option>
              <option value="us">US Stocks</option>
            </select>
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className="text-xs text-muted font-mono">Description</label>
            <input type="text" value={strategy.description || ''} onChange={e => set('description', e.target.value)} placeholder="Describe your strategy..." />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted font-mono">Trade Direction</label>
            <select value={strategy.tradeDirection} onChange={e => set('tradeDirection', e.target.value)}>
              <option value="both">Long & Short</option>
              <option value="long_only">Long Only</option>
              <option value="short_only">Short Only</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted font-mono">Position Size (% of capital)</label>
            <input type="number" value={strategy.positionSize ?? 10} min="1" max="100"
              onChange={e => set('positionSize', parseInt(e.target.value))} />
          </div>
        </div>
      </Section>

      {/* Indicators */}
      <Section title="Indicators">
        <div className="space-y-2 mb-3">
          {strategy.indicators.map((ind, i) => (
            <IndicatorRow key={i} ind={ind} index={i} onChange={updateIndicator} onRemove={removeIndicator} allIndicators={strategy.indicators} />
          ))}
        </div>
        <button onClick={addIndicator} className="btn-ghost text-xs flex items-center gap-2 w-full justify-center">
          <Plus size={14} /> Add Indicator
        </button>
      </Section>

      {/* Entry / Exit Conditions */}
      <Section title="Entry & Exit Conditions" topic="crossover">
        <div className="space-y-5">
          <ConditionGroup title="LONG ENTRY" color="#00E5A0"
            conditions={strategy.conditions?.longEntry || []}
            onChange={v => setCondition('longEntry', v)}
            indicators={strategy.indicators}
            topic="crossover"
          />
          <ConditionGroup title="LONG EXIT" color="#FF4560"
            conditions={strategy.conditions?.longExit || []}
            onChange={v => setCondition('longExit', v)}
            indicators={strategy.indicators}
          />
          {(strategy.tradeDirection === 'short_only' || strategy.tradeDirection === 'both') && <>
            <ConditionGroup title="SHORT ENTRY" color="#FF4560"
              conditions={strategy.conditions?.shortEntry || []}
              onChange={v => setCondition('shortEntry', v)}
              indicators={strategy.indicators}
            />
            <ConditionGroup title="SHORT EXIT" color="#00E5A0"
              conditions={strategy.conditions?.shortExit || []}
              onChange={v => setCondition('shortExit', v)}
              indicators={strategy.indicators}
            />
          </>}
        </div>
      </Section>

      {/* Stop Loss / Take Profit */}
      <Section title="Risk Management" topic="stoploss">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted font-mono">Stop Loss</label>
              <InfoTooltip topic="stoploss" />
            </div>
            <select value={strategy.stopLoss?.type || 'none'} onChange={e => set('stopLoss', { ...strategy.stopLoss, type: e.target.value })}>
              {STOP_LOSS_TYPES.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
            </select>
            {STOP_LOSS_TYPES.find(t => t.type === strategy.stopLoss?.type)?.hasValue && (
              <input type="number" step="0.1"
                value={strategy.stopLoss?.value ?? ''}
                onChange={e => set('stopLoss', { ...strategy.stopLoss, value: e.target.value })}
                placeholder={STOP_LOSS_TYPES.find(t => t.type === strategy.stopLoss?.type)?.valuePlaceholder}
              />
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs text-muted font-mono">Take Profit</label>
            <select value={strategy.takeProfit?.type || 'none'} onChange={e => set('takeProfit', { ...strategy.takeProfit, type: e.target.value })}>
              {TAKE_PROFIT_TYPES.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
            </select>
            {TAKE_PROFIT_TYPES.find(t => t.type === strategy.takeProfit?.type)?.hasValue && (
              <input type="number" step="0.1"
                value={strategy.takeProfit?.value ?? ''}
                onChange={e => set('takeProfit', { ...strategy.takeProfit, value: e.target.value })}
                placeholder={TAKE_PROFIT_TYPES.find(t => t.type === strategy.takeProfit?.type)?.valuePlaceholder}
              />
            )}
          </div>
        </div>
      </Section>
    </div>
  )
}
