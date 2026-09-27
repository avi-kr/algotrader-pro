'use client'
import { useState, useCallback } from 'react'
import { UploadCloud, CheckCircle2, AlertCircle, Database } from 'lucide-react'

const CHUNK_SIZE = 5000

// Matches common export-column spellings (Dhan, Zerodha Kite, generic OHLCV
// CSVs) without requiring an exact header. Whichever list the file's header
// happens to use, this maps it back to our own {time, open, high, low,
// close, volume} shape.
const COLUMN_ALIASES = {
  time: ['time', 'timestamp', 'date', 'datetime', 'date_time'],
  open: ['open', 'o'],
  high: ['high', 'h'],
  low: ['low', 'l'],
  close: ['close', 'c', 'ltp'],
  volume: ['volume', 'vol', 'v'],
}

function detectColumns(headerRow) {
  const normalized = headerRow.map(h => h.trim().toLowerCase())
  const colIndex = {}
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = normalized.findIndex(h => aliases.includes(h))
    if (idx !== -1) colIndex[field] = idx
  }
  return colIndex
}

// Dependency-free CSV line splitter — sufficient for numeric OHLCV exports
// (no embedded commas/quoted fields expected in these files).
function parseCsvLine(line) {
  return line.split(',').map(cell => cell.trim())
}

function parseTimeValue(raw) {
  const trimmed = String(raw).trim()
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed)
    // Heuristic: 10-digit numbers are unix seconds, 13-digit are milliseconds.
    return trimmed.length >= 13 ? Math.floor(num / 1000) : num
  }
  const parsed = new Date(trimmed).getTime()
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length < 2) throw new Error('File has no data rows')

  const header = parseCsvLine(lines[0])
  const colIndex = detectColumns(header)
  const missing = ['time', 'open', 'high', 'low', 'close'].filter(f => !(f in colIndex))
  if (missing.length > 0) {
    throw new Error(`Could not find column(s) for: ${missing.join(', ')}. Header found: ${header.join(', ')}`)
  }

  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i])
    const time = parseTimeValue(cells[colIndex.time])
    const open = parseFloat(cells[colIndex.open])
    const high = parseFloat(cells[colIndex.high])
    const low = parseFloat(cells[colIndex.low])
    const close = parseFloat(cells[colIndex.close])
    const volume = colIndex.volume != null ? parseFloat(cells[colIndex.volume]) : 0
    if (time == null || ![open, high, low, close].every(Number.isFinite)) continue
    rows.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 })
  }
  return rows
}

export default function DataImportPage() {
  const [symbol, setSymbol] = useState('')
  const [timeframe, setTimeframe] = useState('1m')
  const [file, setFile] = useState(null)
  const [status, setStatus] = useState(null) // { phase, uploaded, total, inserted, skipped, invalid, error }
  const [cacheInfo, setCacheInfo] = useState(null)

  const checkCache = useCallback(async (sym, tf) => {
    if (!sym || !tf) return
    try {
      const res = await fetch(`/api/candles/import?symbol=${encodeURIComponent(sym)}&timeframe=${encodeURIComponent(tf)}`)
      const data = await res.json()
      setCacheInfo(data)
    } catch {
      setCacheInfo(null)
    }
  }, [])

  const handleUpload = async () => {
    if (!symbol.trim()) { setStatus({ phase: 'error', error: 'Symbol is required' }); return }
    if (!file) { setStatus({ phase: 'error', error: 'Choose a CSV file first' }); return }

    setStatus({ phase: 'parsing' })
    let rows
    try {
      const text = await file.text()
      rows = parseCsv(text)
    } catch (e) {
      setStatus({ phase: 'error', error: e.message })
      return
    }
    if (rows.length === 0) {
      setStatus({ phase: 'error', error: 'No valid rows parsed from this file' })
      return
    }

    let inserted = 0, skipped = 0, invalid = 0
    const totalChunks = Math.ceil(rows.length / CHUNK_SIZE)
    for (let i = 0; i < totalChunks; i++) {
      const chunk = rows.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
      setStatus({ phase: 'uploading', uploaded: i, total: totalChunks })
      try {
        const res = await fetch('/api/candles/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: symbol.trim(), timeframe, candles: chunk }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`)
        inserted += data.inserted
        skipped += data.skippedDuplicates
        invalid += data.invalidRows
      } catch (e) {
        setStatus({ phase: 'error', error: `Failed on chunk ${i + 1}/${totalChunks}: ${e.message}. ${inserted} rows were already saved before this — re-uploading the same file is safe and will skip those.` })
        return
      }
    }

    setStatus({ phase: 'done', uploaded: totalChunks, total: totalChunks, inserted, skipped, invalid, rowsParsed: rows.length })
    checkCache(symbol.trim(), timeframe)
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="font-display font-bold text-xl text-textprimary flex items-center gap-2">
          <Database size={20} className="text-accent" /> Import Historical Data
        </h1>
        <p className="text-sm text-muted font-mono mt-1">
          Upload your own OHLCV CSV (e.g. Dhan-exported NSE candles). Once cached here, /api/historical
          serves it directly instead of Yahoo Finance — bypassing Yahoo's 7-day cap on 1-minute data.
        </p>
      </div>

      <div className="bg-surface2 border border-border rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted font-mono block mb-1.5">Symbol (exactly as you'll search it later)</label>
            <input
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              onBlur={() => checkCache(symbol.trim(), timeframe)}
              placeholder="e.g. RELIANCE.NS"
              className="w-full"
            />
          </div>
          <div>
            <label className="text-xs text-muted font-mono block mb-1.5">Timeframe</label>
            <select value={timeframe} onChange={e => { setTimeframe(e.target.value); checkCache(symbol.trim(), e.target.value) }} className="w-full">
              <option value="1m">1m</option>
              <option value="5m">5m</option>
              <option value="15m">15m</option>
              <option value="60m">60m (1H)</option>
              <option value="4h">4h</option>
              <option value="1d">1d</option>
              <option value="1wk">1wk</option>
            </select>
          </div>
        </div>

        {cacheInfo && cacheInfo.count > 0 && (
          <div className="text-xs font-mono text-muted bg-surface rounded-lg p-3">
            Already cached: {cacheInfo.count.toLocaleString()} candles, {new Date(cacheInfo.fromTime * 1000).toLocaleDateString()} → {new Date(cacheInfo.toTime * 1000).toLocaleDateString()}
          </div>
        )}

        <div>
          <label className="text-xs text-muted font-mono block mb-1.5">CSV file</label>
          <input type="file" accept=".csv,text/csv" onChange={e => setFile(e.target.files?.[0] || null)} className="w-full text-sm" />
          <p className="text-xs text-muted mt-1">
            Header row required. Columns are auto-detected by name (time/date/timestamp, open, high, low, close, volume) —
            order doesn't matter. Time can be a date string or a unix timestamp (seconds or milliseconds).
          </p>
        </div>

        <button
          onClick={handleUpload}
          disabled={status?.phase === 'parsing' || status?.phase === 'uploading'}
          className="btn-primary flex items-center gap-2 px-4 py-2 rounded-lg disabled:opacity-50"
        >
          <UploadCloud size={16} /> Parse & Upload
        </button>

        {status?.phase === 'parsing' && (
          <p className="text-xs font-mono text-muted">Parsing file…</p>
        )}
        {status?.phase === 'uploading' && (
          <p className="text-xs font-mono text-muted">Uploading chunk {status.uploaded + 1} of {status.total}…</p>
        )}
        {status?.phase === 'error' && (
          <div className="flex items-start gap-2 text-xs font-mono text-danger bg-danger/10 border border-danger/30 rounded-lg p-3">
            <AlertCircle size={14} className="shrink-0 mt-0.5" /> {status.error}
          </div>
        )}
        {status?.phase === 'done' && (
          <div className="flex items-start gap-2 text-xs font-mono text-accent bg-accent/10 border border-accent/30 rounded-lg p-3">
            <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
            Parsed {status.rowsParsed.toLocaleString()} rows · inserted {status.inserted.toLocaleString()} ·
            {' '}skipped {status.skipped.toLocaleString()} already-cached duplicates
            {status.invalid > 0 ? ` · ${status.invalid} invalid rows ignored` : ''}.
          </div>
        )}
      </div>
    </div>
  )
}
