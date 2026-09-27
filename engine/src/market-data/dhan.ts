import type { Candle, MarketDataAdapter, Timeframe } from '@algotrader/shared-types'
import { resolveDhanInstrument } from './dhan-instruments'

export interface DhanMarketDataConfig {
  clientId: string | undefined
  accessToken: string | undefined
}

const DAY_MS = 24 * 60 * 60 * 1000
// Dhan caps a single /charts/intraday request at 90 days of history — page
// backwards in windows of this size (see docs/ARCHITECTURE.md).
const INTRADAY_WINDOW_MS = 89 * DAY_MS

// Dhan's native intraday granularities. '4h' has no native equivalent and is
// built by aggregating 4 consecutive 60-minute candles, the same real-OHLCV
// aggregation approach already used for crypto in app/api/historical/route.js
// (true high/low across the group, summed volume — never a synthetic
// single-point bar).
const NATIVE_INTERVAL: Partial<Record<Timeframe, number>> = {
  '1m': 1, '5m': 5, '15m': 15, '1h': 60,
}

interface DhanChartResponse {
  open: number[]
  high: number[]
  low: number[]
  close: number[]
  volume: number[]
  timestamp: number[]
}

function toCandles(res: DhanChartResponse): Candle[] {
  const n = res.timestamp?.length ?? 0
  const candles: Candle[] = []
  for (let i = 0; i < n; i++) {
    candles.push({
      time: res.timestamp[i],
      open: res.open[i],
      high: res.high[i],
      low: res.low[i],
      close: res.close[i],
      volume: res.volume?.[i] ?? 0,
    })
  }
  return candles
}

function aggregate(candles: Candle[], groupSize: number): Candle[] {
  const out: Candle[] = []
  for (let i = 0; i < candles.length; i += groupSize) {
    const group = candles.slice(i, i + groupSize)
    if (group.length === 0) continue
    out.push({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map(c => c.high)),
      low: Math.min(...group.map(c => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    })
  }
  return out
}

function isoWeekKey(unixSec: number): string {
  const d = new Date(unixSec * 1000)
  const day = (d.getUTCDay() + 6) % 7 // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - day + 3) // nearest Thursday, ISO week convention
  const isoYear = d.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4))
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / DAY_MS - 3) / 7)
  return `${isoYear}-${week}`
}

// Daily candles aggregated to weekly by calendar ISO week, not a fixed
// 7-count grouping — NSE trading weeks have holidays, so a fixed count would
// misalign week boundaries over any real multi-month range.
function aggregateWeekly(daily: Candle[]): Candle[] {
  const out: Candle[] = []
  let currentKey: string | null = null
  let group: Candle[] = []
  const flush = () => {
    if (group.length === 0) return
    out.push({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map(c => c.high)),
      low: Math.min(...group.map(c => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    })
  }
  for (const c of daily) {
    const key = isoWeekKey(c.time)
    if (key !== currentKey) {
      flush()
      group = []
      currentKey = key
    }
    group.push(c)
  }
  flush()
  return out
}

export interface DhanFeedTick {
  securityId: string
  feedCode: number
  ltp: number
  ltt: number
  /** Cumulative DAY volume, from a Quote/Full packet — null for a Ticker
   * packet, which carries no volume field at all. Callers must diff this
   * against the previous value themselves to get a per-tick delta. */
  cumulativeVolume: number | null
}

/**
 * Parses one binary WebSocket packet per the documented v2 live-feed layout
 * (docs.dhanhq.co/api/v2/guides/live-market-feed — little-endian, an 8-byte
 * header shared by every packet type: byte 0 feed response code, bytes 1-2
 * message length, byte 3 exchange segment, bytes 4-7 security ID). Only
 * Ticker (code 2) and Quote (code 4) are parsed — the two that carry price,
 * which is all candle aggregation needs; Full/depth (8) and OI/PrevClose
 * (5/6) are intentionally ignored. Returns null for any other packet type.
 */
export function parseDhanFeedPacket(buf: ArrayBuffer): DhanFeedTick | null {
  const view = new DataView(buf)
  const feedCode = view.getUint8(0)
  const securityId = String(view.getInt32(4, true))

  if (feedCode === 2) {
    return { securityId, feedCode, ltp: view.getFloat32(8, true), ltt: view.getInt32(12, true), cumulativeVolume: null }
  }
  if (feedCode === 4) {
    return {
      securityId,
      feedCode,
      ltp: view.getFloat32(8, true),
      ltt: view.getInt32(14, true),
      cumulativeVolume: view.getInt32(22, true),
    }
  }
  return null
}

/**
 * Dhan market data for NSE equities — historical candles via the
 * /charts/intraday and /charts/historical REST endpoints, live prices via
 * the binary WebSocket feed. Same causal contract as every other
 * MarketDataAdapter (Alpaca, Binance): getHistoricalCandles never returns a
 * partial/forming bar, and subscribeLive only ever forwards CLOSED candles.
 *
 * Feeds DhanBrokerAdapter's live trading AND the paper-trading
 * SimulatedPaperAdapter (via subscribeLive's price updates) — Dhan's own
 * Sandbox is unsuitable for paper trading (flat fills, no live quotes), so
 * this adapter is what makes realistic Indian-equity paper trading possible
 * at all. See docs/ARCHITECTURE.md.
 */
export class DhanMarketDataAdapter implements MarketDataAdapter {
  readonly name = 'dhan-market-data'
  private readonly baseUrl = 'https://api.dhan.co/v2'
  private readonly headers: Record<string, string>

  constructor(private config: DhanMarketDataConfig) {
    if (!config.clientId || !config.accessToken) {
      throw new Error('DhanMarketDataAdapter: missing DHAN_CLIENT_ID/DHAN_ACCESS_TOKEN.')
    }
    this.headers = { 'access-token': config.accessToken, 'Content-Type': 'application/json' }
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Dhan API ${res.status} on ${path}: ${text}`)
    }
    return res.json() as Promise<T>
  }

  async getHistoricalCandles(params: { symbol: string; timeframe: Timeframe; from: Date; to: Date }): Promise<Candle[]> {
    const instrument = await resolveDhanInstrument(params.symbol)

    if (params.timeframe === '1d' || params.timeframe === '1wk') {
      const res = await this.request<DhanChartResponse>('/charts/historical', {
        securityId: instrument.securityId,
        exchangeSegment: instrument.exchangeSegment,
        instrument: 'EQUITY',
        fromDate: params.from.toISOString().slice(0, 10),
        toDate: params.to.toISOString().slice(0, 10),
      })
      const daily = toCandles(res)
      return params.timeframe === '1wk' ? aggregateWeekly(daily) : daily
    }

    const nativeInterval = NATIVE_INTERVAL[params.timeframe] ?? NATIVE_INTERVAL['1h']
    const fetchInterval = params.timeframe === '4h' ? 60 : nativeInterval

    // Page backwards through 90-day windows — Dhan rejects a wider range in
    // one /charts/intraday call.
    const windows: Array<{ from: Date; to: Date }> = []
    let windowEnd = params.to.getTime()
    const startMs = params.from.getTime()
    while (windowEnd > startMs) {
      const windowStart = Math.max(startMs, windowEnd - INTRADAY_WINDOW_MS)
      windows.unshift({ from: new Date(windowStart), to: new Date(windowEnd) })
      windowEnd = windowStart - 1000
    }

    const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ')
    let candles: Candle[] = []
    for (const w of windows) {
      const res = await this.request<DhanChartResponse>('/charts/intraday', {
        securityId: instrument.securityId,
        exchangeSegment: instrument.exchangeSegment,
        instrument: 'EQUITY',
        interval: fetchInterval,
        fromDate: fmt(w.from),
        toDate: fmt(w.to),
      })
      candles = candles.concat(toCandles(res))
    }

    return params.timeframe === '4h' ? aggregate(candles, 4) : candles
  }

  /**
   * Aggregates Dhan's tick-level WebSocket feed into 1-minute candles —
   * Dhan streams individual ticks (LTP + cumulative day volume), not
   * pre-formed candles the way Binance's kline stream does, so this adapter
   * builds them itself. A candle is only emitted once its minute has fully
   * elapsed (flushed on the first tick of the NEXT minute, or by a 60s
   * timer if a symbol goes quiet), matching every other adapter's rule of
   * never forwarding a still-forming bar.
   *
   * Structurally complete against the documented binary packet layout
   * (docs.dhanhq.co/api/v2/guides/live-market-feed) but — like
   * BinanceMarketDataAdapter's WS code — not yet exercised against Dhan's
   * real feed in this session; that needs the user's own access token.
   */
  async subscribeLive(params: { symbols: string[]; onCandle: (symbol: string, candle: Candle) => void }): Promise<() => void> {
    const instruments = await Promise.all(
      params.symbols.map(async symbol => ({ symbol, instrument: await resolveDhanInstrument(symbol) }))
    )
    const securityIdToSymbol = new Map(instruments.map(i => [i.instrument.securityId, i.symbol]))

    const url = `wss://api-feed.dhan.co?version=2&token=${this.config.accessToken}&clientId=${this.config.clientId}&authType=2`
    const ws = new WebSocket(url)

    type Bucket = { minuteStart: number; open: number; high: number; low: number; close: number; volume: number }
    const buckets = new Map<string, Bucket>()
    const lastCumulativeVolume = new Map<string, number>()

    const flush = (symbol: string) => {
      const bucket = buckets.get(symbol)
      if (!bucket) return
      params.onCandle(symbol, {
        time: bucket.minuteStart,
        open: bucket.open, high: bucket.high, low: bucket.low, close: bucket.close, volume: bucket.volume,
      })
      buckets.delete(symbol)
    }

    const onTick = (symbol: string, ltp: number, ltt: number, cumulativeVolume: number | null) => {
      const minuteStart = Math.floor(ltt / 60) * 60
      const existing = buckets.get(symbol)
      if (existing && existing.minuteStart !== minuteStart) flush(symbol)

      let volumeDelta = 0
      if (cumulativeVolume != null) {
        const prev = lastCumulativeVolume.get(symbol)
        if (prev != null && cumulativeVolume >= prev) volumeDelta = cumulativeVolume - prev
        lastCumulativeVolume.set(symbol, cumulativeVolume)
      }

      const bucket = buckets.get(symbol)
      if (!bucket || bucket.minuteStart !== minuteStart) {
        buckets.set(symbol, { minuteStart, open: ltp, high: ltp, low: ltp, close: ltp, volume: volumeDelta })
      } else {
        bucket.high = Math.max(bucket.high, ltp)
        bucket.low = Math.min(bucket.low, ltp)
        bucket.close = ltp
        bucket.volume += volumeDelta
      }
    }

    ws.addEventListener('open', () => {
      // Max 100 instruments per subscribe message (see dhan-instruments.ts
      // for why every symbol needs a resolved securityId first).
      for (let i = 0; i < instruments.length; i += 100) {
        const chunk = instruments.slice(i, i + 100)
        ws.send(JSON.stringify({
          RequestCode: 15,
          InstrumentCount: chunk.length,
          InstrumentList: chunk.map(c => ({ ExchangeSegment: c.instrument.exchangeSegment, SecurityId: c.instrument.securityId })),
        }))
      }
    })

    ws.addEventListener('message', async event => {
      const buf = event.data instanceof ArrayBuffer ? event.data : await (event.data as Blob).arrayBuffer()
      const parsed = parseDhanFeedPacket(buf)
      if (!parsed) return
      const symbol = securityIdToSymbol.get(parsed.securityId)
      if (!symbol) return
      onTick(symbol, parsed.ltp, parsed.ltt, parsed.cumulativeVolume)
    })

    // Server closes the connection after 40s of inactivity; a lightweight
    // ping keeps it alive well within that window (docs.dhanhq.co).
    const pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ RequestCode: 15, InstrumentCount: 0, InstrumentList: [] }))
    }, 20000)

    return () => {
      clearInterval(pingInterval)
      for (const symbol of buckets.keys()) flush(symbol)
      ws.close()
    }
  }
}
