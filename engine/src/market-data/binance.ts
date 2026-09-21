import type { Candle, MarketDataAdapter, Timeframe } from '@algotrader/shared-types'

const TIMEFRAME_MAP: Record<Timeframe, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
  '1wk': '1w',
}

// [openTime, open, high, low, close, volume, closeTime, ...]
type BinanceKline = [number, string, string, string, string, string, number, ...unknown[]]

/** Binance public market data. Historical klines and the live kline
 * WebSocket stream are both unauthenticated/public endpoints — no API key
 * needed for market data (only for trading, which crypto in this system
 * never does live against Binance directly; paper crypto trades fill
 * against `SimulatedPaperAdapter` using these same prices). */
export class BinanceMarketDataAdapter implements MarketDataAdapter {
  readonly name = 'binance-market-data'
  private readonly baseUrl = 'https://api.binance.com'

  async getHistoricalCandles(params: { symbol: string; timeframe: Timeframe; from: Date; to: Date }): Promise<Candle[]> {
    const candles: Candle[] = []
    let startTime = params.from.getTime()
    const endTime = params.to.getTime()

    // Binance caps each response at 1000 candles — page forward by re-querying
    // from the last candle's close time until we reach `to`.
    while (startTime < endTime) {
      const url = new URL(`${this.baseUrl}/api/v3/klines`)
      url.searchParams.set('symbol', params.symbol)
      url.searchParams.set('interval', TIMEFRAME_MAP[params.timeframe])
      url.searchParams.set('startTime', String(startTime))
      url.searchParams.set('endTime', String(endTime))
      url.searchParams.set('limit', '1000')

      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`Binance klines ${res.status} for ${params.symbol}: ${await res.text().catch(() => '')}`)
      }
      const rows = (await res.json()) as BinanceKline[]
      if (rows.length === 0) break

      for (const row of rows) {
        candles.push({
          time: Math.floor(row[0] / 1000),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5]),
        })
      }

      const lastCloseTime = rows[rows.length - 1][6]
      if (lastCloseTime <= startTime) break // safety against an infinite loop on malformed data
      startTime = lastCloseTime + 1
    }

    return candles
  }

  /** wss://stream.binance.com:9443/ws/<symbol>@kline_<interval> — one stream
   * per symbol; only forwards CLOSED candles (`k.x === true`) so a partial,
   * still-forming bar never gets treated as a completed one by anything
   * downstream (that would be its own flavor of look-ahead). Structurally
   * complete, not yet exercised against Binance's real servers in this
   * session. */
  async subscribeLive(params: { symbols: string[]; onCandle: (symbol: string, candle: Candle) => void }): Promise<() => void> {
    const sockets = params.symbols.map(symbol => {
      const interval = TIMEFRAME_MAP['1m']
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`)
      ws.addEventListener('message', event => {
        const msg = JSON.parse(String(event.data)) as { k: { t: number; o: string; h: string; l: string; c: string; v: string; x: boolean } }
        if (!msg.k.x) return // ignore not-yet-closed candles
        params.onCandle(symbol, {
          time: Math.floor(msg.k.t / 1000),
          open: Number(msg.k.o),
          high: Number(msg.k.h),
          low: Number(msg.k.l),
          close: Number(msg.k.c),
          volume: Number(msg.k.v),
        })
      })
      return ws
    })

    return () => sockets.forEach(ws => ws.close())
  }
}
