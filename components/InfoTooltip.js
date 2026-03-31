'use client'
import { useState } from 'react'
import { Info, X } from 'lucide-react'
import { INFO_EXPLANATIONS } from '@/lib/constants'

const SVGGraphics = {
  ema: () => (
    <svg viewBox="0 0 200 80" className="w-full">
      {/* Price line jagged */}
      <polyline points="0,60 15,40 30,55 45,35 60,50 75,30 90,45 105,20 120,35 135,25 150,40 165,20 200,30"
        fill="none" stroke="#64748B" strokeWidth="1" opacity="0.5" />
      {/* Slow SMA */}
      <polyline points="0,58 30,52 60,46 90,40 120,35 150,30 200,28"
        fill="none" stroke="#FFB800" strokeWidth="1.5" strokeDasharray="4,2" />
      {/* Fast EMA */}
      <polyline points="0,56 20,45 40,42 60,34 80,32 100,26 120,30 150,24 200,22"
        fill="none" stroke="#00E5A0" strokeWidth="2" />
      <text x="4" y="26" fill="#00E5A0" fontSize="8" fontFamily="IBM Plex Mono">EMA (fast)</text>
      <text x="4" y="38" fill="#FFB800" fontSize="8" fontFamily="IBM Plex Mono">SMA (slow)</text>
    </svg>
  ),
  crossover: () => (
    <svg viewBox="0 0 200 80" className="w-full">
      {/* Slow line */}
      <polyline points="0,55 40,50 80,45 120,40 160,35 200,30"
        fill="none" stroke="#FFB800" strokeWidth="1.5" />
      {/* Fast line crosses over */}
      <polyline points="0,65 40,60 75,50 90,40 120,28 160,22 200,18"
        fill="none" stroke="#00E5A0" strokeWidth="1.5" />
      {/* Cross point */}
      <circle cx="82" cy="47" r="4" fill="#00E5A0" opacity="0.3" />
      <circle cx="82" cy="47" r="2" fill="#00E5A0" />
      {/* Arrow up */}
      <path d="M82 38 L78 44 L82 42 L86 44 Z" fill="#00E5A0" />
      <text x="88" y="32" fill="#00E5A0" fontSize="8" fontFamily="IBM Plex Mono">BUY signal</text>
      <text x="4" y="74" fill="#FFB800" fontSize="7" fontFamily="IBM Plex Mono">EMA Slow</text>
      <text x="4" y="20" fill="#00E5A0" fontSize="7" fontFamily="IBM Plex Mono">EMA Fast</text>
    </svg>
  ),
  rsi: () => (
    <svg viewBox="0 0 200 80" className="w-full">
      {/* Overbought zone */}
      <rect x="0" y="5" width="200" height="18" fill="rgba(255,69,96,0.08)" />
      {/* Oversold zone */}
      <rect x="0" y="57" width="200" height="18" fill="rgba(0,229,160,0.08)" />
      {/* RSI line */}
      <polyline points="0,35 20,20 40,12 60,18 80,30 100,50 120,62 140,70 160,58 180,40 200,30"
        fill="none" stroke="#00B4FF" strokeWidth="2" />
      {/* 70 line */}
      <line x1="0" y1="23" x2="200" y2="23" stroke="#FF4560" strokeWidth="1" strokeDasharray="4,2" />
      {/* 30 line */}
      <line x1="0" y1="57" x2="200" y2="57" stroke="#00E5A0" strokeWidth="1" strokeDasharray="4,2" />
      <text x="4" y="20" fill="#FF4560" fontSize="7" fontFamily="IBM Plex Mono">70 — Overbought</text>
      <text x="4" y="76" fill="#00E5A0" fontSize="7" fontFamily="IBM Plex Mono">30 — Oversold</text>
    </svg>
  ),
  drawdown: () => (
    <svg viewBox="0 0 200 80" className="w-full">
      <polyline points="0,60 20,50 40,38 60,28 80,20 95,24 110,35 125,45 140,38 160,28 180,20 200,15"
        fill="none" stroke="#00E5A0" strokeWidth="2" />
      {/* Shade drawdown area */}
      <polygon points="80,20 95,24 110,35 125,45 140,38 160,28 180,20 160,20 140,20 120,20 100,20 80,20"
        fill="rgba(255,69,96,0.15)" />
      <line x1="80" y1="20" x2="125" y2="20" stroke="#FF4560" strokeWidth="1" strokeDasharray="3,2" />
      <line x1="125" y1="20" x2="125" y2="45" stroke="#FF4560" strokeWidth="1.5" />
      <text x="128" y="35" fill="#FF4560" fontSize="8" fontFamily="IBM Plex Mono">Max DD</text>
      <text x="4" y="14" fill="#00E5A0" fontSize="7" fontFamily="IBM Plex Mono">Peak</text>
    </svg>
  ),
  backtest: () => (
    <svg viewBox="0 0 200 80" className="w-full">
      <text x="10" y="18" fill="#64748B" fontSize="7" fontFamily="IBM Plex Mono">Historical Data →</text>
      {/* Candles */}
      {[20, 36, 52, 68, 84, 100, 116, 132].map((x, i) => (
        <g key={x}>
          <rect x={x} y={i % 2 === 0 ? 30 : 40} width="10" height={i % 2 === 0 ? 20 : 15}
            fill={i % 3 === 0 ? '#FF4560' : '#00E5A0'} opacity="0.8" />
        </g>
      ))}
      <text x="155" y="42" fill="#00E5A0" fontSize="8" fontFamily="IBM Plex Mono">→ Report</text>
      <path d="M148 38 L154 38" stroke="#00B4FF" strokeWidth="1.5" markerEnd="url(#arrow)" />
    </svg>
  ),
  sharpe: () => (
    <svg viewBox="0 0 200 80" className="w-full">
      {/* Two equity curves */}
      <polyline points="0,60 40,30 80,50 120,20 160,40 200,15"
        fill="none" stroke="#00E5A0" strokeWidth="2" />
      <polyline points="0,60 20,50 40,20 60,55 80,15 100,60 120,20 140,65 160,30 180,65 200,35"
        fill="none" stroke="#FF4560" strokeWidth="1.5" opacity="0.6" />
      <text x="5" y="12" fill="#00E5A0" fontSize="7" fontFamily="IBM Plex Mono">High Sharpe (smooth)</text>
      <text x="5" y="76" fill="#FF4560" fontSize="7" fontFamily="IBM Plex Mono">Low Sharpe (volatile)</text>
    </svg>
  ),
  stoploss: () => (
    <svg viewBox="0 0 200 80" className="w-full">
      <polyline points="0,60 30,45 60,35 85,22 100,38 120,55 140,70"
        fill="none" stroke="#00E5A0" strokeWidth="2" />
      {/* Stop loss line */}
      <line x1="60" y1="52" x2="140" y2="52" stroke="#FF4560" strokeWidth="1.5" strokeDasharray="4,2" />
      <circle cx="120" cy="52" r="4" fill="#FF4560" />
      <text x="4" y="50" fill="#FF4560" fontSize="7" fontFamily="IBM Plex Mono">Stop Loss Level</text>
      <text x="122" y="70" fill="#FF4560" fontSize="7" fontFamily="IBM Plex Mono">Exit here</text>
    </svg>
  ),
}

export default function InfoTooltip({ topic, size = 16 }) {
  const [open, setOpen] = useState(false)
  const info = INFO_EXPLANATIONS[topic]

  if (!info) return null
  const SVGComp = SVGGraphics[info.svg]

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface2 border border-border text-muted hover:text-accent hover:border-accent/40 transition-all duration-200 shrink-0"
        title={`Learn about ${info.title}`}
      >
        <Info size={10} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 modal-backdrop"
          onClick={() => setOpen(false)}
        >
          <div
            className="info-tooltip rounded-xl p-6 max-w-sm w-full relative"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setOpen(false)}
              className="absolute top-4 right-4 text-muted hover:text-textprimary"
            >
              <X size={16} />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <span className="w-6 h-6 rounded bg-accent/15 flex items-center justify-center">
                <Info size={12} className="text-accent" />
              </span>
              <h3 className="font-display font-semibold text-sm text-textprimary">{info.title}</h3>
            </div>

            {SVGComp && (
              <div className="bg-surface2 rounded-lg p-3 mb-4 border border-border">
                <SVGComp />
              </div>
            )}

            <p className="text-textsecondary text-sm leading-relaxed mb-3">{info.simple}</p>

            {info.analogy && (
              <div className="bg-accent/5 border border-accent/15 rounded-lg p-3">
                <p className="text-xs text-accent font-mono">
                  💡 {info.analogy}
                </p>
              </div>
            )}

            {info.formula && (
              <div className="mt-3 bg-surface2 rounded-lg p-3 font-mono text-xs text-textsecondary border border-border">
                {info.formula}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
