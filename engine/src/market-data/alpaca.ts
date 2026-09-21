import type { Candle, MarketDataAdapter, Timeframe } from '@algotrader/shared-types'

const TIMEFRAME_MAP: Record<Timeframe, string> = {
  '1m': '1Min',
  '5m': '5Min',
  '15m': '15Min',
  '1h': '1Hour',
  '4h': '4Hour',
  '1d': '1Day',
  '1wk': '1Week',
}

export interface AlpacaMarketDataConfig {
  apiKeyId: string | undefined
  apiSecretKey: string | undefined
  baseUrl?: string // defaults to https://data.alpaca.markets
  feed?: 'iex' | 'sip' // 'iex' works on the free tier; 'sip' needs a paid subscription
}

interface AlpacaBar {
  t: string
  o: number
  h: number
  l: number
  c: number
  v: number
}

/** Alpaca market-data REST + streaming adapter for US equities. Same
 * fail-closed contract as the trading adapter: refuses to start without
 * credentials rather than silently returning no data. */
export class AlpacaMarketDataAdapter implements MarketDataAdapter {
  readonly name = 'alpaca-market-data'
  private readonly headers: Record<string, string>
  private readonly baseUrl: string
  private readonly feed: string

  constructor(config: AlpacaMarketDataConfig) {
    if (!config.apiKeyId || !config.apiSecretKey) {
      throw new Error('AlpacaMarketDataAdapter: missing API credentials — refusing to start.')
    }
    this.headers = {
      'APCA-API-KEY-ID': config.apiKeyId,
      'APCA-API-SECRET-KEY': config.apiSecretKey,
    }
    this.baseUrl = config.baseUrl ?? 'https://data.alpaca.markets'
    this.feed = config.feed ?? 'iex'
  }

  async getHistoricalCandles(params: { symbol: string; timeframe: Timeframe; from: Date; to: Date }): Promise<Candle[]> {
    const candles: Candle[] = []
    let pageToken: string | undefined

    do {
      const url = new URL(`${this.baseUrl}/v2/stocks/${params.symbol}/bars`)
      url.searchParams.set('timeframe', TIMEFRAME_MAP[params.timeframe])
      url.searchParams.set('start', params.from.toISOString())
      url.searchParams.set('end', params.to.toISOString())
      url.searchParams.set('feed', this.feed)
      url.searchParams.set('limit', '10000')
      if (pageToken) url.searchParams.set('page_token', pageToken)

      const res = await fetch(url, { headers: this.headers })
      if (!res.ok) {
        throw new Error(`Alpaca market data ${res.status} for ${params.symbol}: ${await res.text().catch(() => '')}`)
      }
      const data = (await res.json()) as { bars: AlpacaBar[]; next_page_token: string | null }
      for (const bar of data.bars ?? []) {
        candles.push({
          time: Math.floor(new Date(bar.t).getTime() / 1000),
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
          volume: bar.v,
        })
      }
      pageToken = data.next_page_token ?? undefined
    } while (pageToken)

    return candles
  }

  /** Real Alpaca streaming protocol (wss://stream.data.alpaca.markets/v2/{feed}):
   * auth, then subscribe to the `bars` channel for each symbol. This is
   * structurally complete but — like every live-data path in this repo —
   * has not been exercised against Alpaca's real servers in this session,
   * since that needs the user's own API keys (see docs/ARCHITECTURE.md). */
  async subscribeLive(params: { symbols: string[]; onCandle: (symbol: string, candle: Candle) => void }): Promise<() => void> {
    const ws = new WebSocket(`wss://stream.data.alpaca.markets/v2/${this.feed}`)

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ action: 'auth', key: this.headers['APCA-API-KEY-ID'], secret: this.headers['APCA-API-SECRET-KEY'] }))
      ws.send(JSON.stringify({ action: 'subscribe', bars: params.symbols }))
    })

    ws.addEventListener('message', event => {
      const messages = JSON.parse(String(event.data)) as Array<Record<string, unknown>>
      for (const msg of messages) {
        if (msg.T !== 'b') continue // bar message type
        params.onCandle(msg.S as string, {
          time: Math.floor(new Date(msg.t as string).getTime() / 1000),
          open: msg.o as number,
          high: msg.h as number,
          low: msg.l as number,
          close: msg.c as number,
          volume: msg.v as number,
        })
      }
    })

    return () => ws.close()
  }
}
