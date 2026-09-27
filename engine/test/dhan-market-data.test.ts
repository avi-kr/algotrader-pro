import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DhanMarketDataAdapter, parseDhanFeedPacket } from '../src/market-data/dhan'
import { clearDhanInstrumentCache } from '../src/market-data/dhan-instruments'

const CSV = [
  'SEM_EXM_EXCH_ID,SEM_SEGMENT,SEM_SMST_SECURITY_ID,SEM_TRADING_SYMBOL,SEM_INSTRUMENT_NAME,SEM_LOT_UNITS',
  'NSE,E,1333,RELIANCE,EQUITY,1',
].join('\n')

function buildPacket(feedCode: number, securityId: number, fields: number[]): ArrayBuffer {
  // header (8 bytes: code, 2-byte length, exchSegment, 4-byte securityId) + payload
  const buf = new ArrayBuffer(8 + fields.length)
  const view = new DataView(buf)
  view.setUint8(0, feedCode)
  view.setInt16(1, 0, true)
  view.setUint8(3, 1) // exchange segment byte, unused by the parser
  view.setInt32(4, securityId, true)
  return buf
}

describe('parseDhanFeedPacket', () => {
  it('parses a Ticker packet (code 2): LTP + last trade time, no volume', () => {
    const buf = new ArrayBuffer(16)
    const view = new DataView(buf)
    view.setUint8(0, 2)
    view.setInt32(4, 1333, true)
    view.setFloat32(8, 2500.5, true)
    view.setInt32(12, 1700000000, true)

    const parsed = parseDhanFeedPacket(buf)
    expect(parsed).toEqual({ securityId: '1333', feedCode: 2, ltp: 2500.5, ltt: 1700000000, cumulativeVolume: null })
  })

  it('parses a Quote packet (code 4): LTP, last trade time, and cumulative day volume', () => {
    const buf = new ArrayBuffer(26)
    const view = new DataView(buf)
    view.setUint8(0, 4)
    view.setInt32(4, 1333, true)
    view.setFloat32(8, 2501.25, true)
    view.setInt16(12, 5, true) // LTQ, not read by the parser
    view.setInt32(14, 1700000060, true)
    view.setFloat32(18, 2500.9, true) // ATP, not read by the parser
    view.setInt32(22, 50000, true)

    const parsed = parseDhanFeedPacket(buf)
    expect(parsed).toEqual({ securityId: '1333', feedCode: 4, ltp: 2501.25, ltt: 1700000060, cumulativeVolume: 50000 })
  })

  it('returns null for packet types it does not parse (Full/depth, OI, PrevClose)', () => {
    expect(parseDhanFeedPacket(buildPacket(8, 1333, [0, 0, 0, 0]))).toBeNull()
    expect(parseDhanFeedPacket(buildPacket(5, 1333, [0, 0, 0, 0]))).toBeNull()
  })
})

describe('DhanMarketDataAdapter.getHistoricalCandles', () => {
  beforeEach(() => {
    clearDhanInstrumentCache()
    vi.unstubAllGlobals()
  })

  it('pages a >90-day intraday range into multiple /charts/intraday requests', async () => {
    const intradayCalls: unknown[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('images.dhan.co')) return { ok: true, text: async () => CSV }
      if (String(url).endsWith('/charts/intraday')) {
        intradayCalls.push(JSON.parse((init!.body as string)))
        return { ok: true, json: async () => ({ open: [1], high: [1], low: [1], close: [1], volume: [1], timestamp: [1700000000] }) }
      }
      throw new Error(`unexpected URL ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new DhanMarketDataAdapter({ clientId: '100', accessToken: 'tok' })
    const to = new Date('2026-01-01T00:00:00Z')
    const from = new Date('2025-08-01T00:00:00Z') // ~153 days -> needs 2 windows of 89 days
    const candles = await adapter.getHistoricalCandles({ symbol: 'RELIANCE.NS', timeframe: '1m', from, to })

    expect(intradayCalls.length).toBe(2)
    expect(candles.length).toBe(2) // one candle per mocked window response, concatenated
    for (const call of intradayCalls as Array<{ securityId: string; exchangeSegment: string; interval: number }>) {
      expect(call.securityId).toBe('1333')
      expect(call.exchangeSegment).toBe('NSE_EQ')
      expect(call.interval).toBe(1)
    }
  })

  it('uses /charts/historical (not paginated) for 1d candles', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('images.dhan.co')) return { ok: true, text: async () => CSV }
      if (String(url).endsWith('/charts/historical')) {
        return { ok: true, json: async () => ({ open: [100, 200], high: [110, 210], low: [90, 190], close: [105, 205], volume: [1000, 2000], timestamp: [1700000000, 1700086400] }) }
      }
      throw new Error(`unexpected URL ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new DhanMarketDataAdapter({ clientId: '100', accessToken: 'tok' })
    const candles = await adapter.getHistoricalCandles({
      symbol: 'RELIANCE.NS', timeframe: '1d',
      from: new Date('2020-01-01'), to: new Date('2026-01-01'),
    })
    expect(candles).toHaveLength(2)
    expect(candles[0]).toEqual({ time: 1700000000, open: 100, high: 110, low: 90, close: 105, volume: 1000 })
  })

  it('builds 4h candles by aggregating four native 60-minute candles with real OHLCV (not a synthetic point)', async () => {
    // 8 hourly candles, strictly increasing highs/decreasing lows so the
    // aggregate's max/min are unambiguous and distinguishable from a naive
    // "just take one candle's values" bug.
    const hourly = {
      open: [10, 11, 12, 13, 20, 21, 22, 23],
      high: [15, 16, 17, 18, 25, 26, 27, 28],
      low: [5, 4, 3, 2, 15, 14, 13, 12],
      close: [11, 12, 13, 14, 21, 22, 23, 24],
      volume: [100, 100, 100, 100, 200, 200, 200, 200],
      timestamp: [0, 3600, 7200, 10800, 14400, 18000, 21600, 25200],
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('images.dhan.co')) return { ok: true, text: async () => CSV }
      if (String(url).endsWith('/charts/intraday')) return { ok: true, json: async () => hourly }
      throw new Error(`unexpected URL ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new DhanMarketDataAdapter({ clientId: '100', accessToken: 'tok' })
    const candles = await adapter.getHistoricalCandles({
      symbol: 'RELIANCE.NS', timeframe: '4h',
      from: new Date(0), to: new Date(30000 * 1000),
    })

    expect(candles).toHaveLength(2)
    expect(candles[0]).toEqual({ time: 0, open: 10, high: 18, low: 2, close: 14, volume: 400 })
    expect(candles[1]).toEqual({ time: 14400, open: 20, high: 28, low: 12, close: 24, volume: 800 })
  })

  it('aggregates daily candles into weekly by ISO calendar week, not a fixed 7-count grouping', async () => {
    // Jan 5-9 2026 is Mon-Fri of one ISO week; Jan 12 2026 is the following
    // Monday, a new ISO week -- 6 daily candles should become 2 weekly ones
    // (5 + 1), not split 7-and-nothing or otherwise misaligned.
    const days = [5, 6, 7, 8, 9, 12].map(d => Math.floor(Date.UTC(2026, 0, d) / 1000))
    const daily = {
      open: [1, 2, 3, 4, 5, 6],
      high: [10, 20, 30, 40, 50, 60],
      low: [1, 1, 1, 1, 1, 6],
      close: [1, 2, 3, 4, 5, 6],
      volume: [10, 10, 10, 10, 10, 99],
      timestamp: days,
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('images.dhan.co')) return { ok: true, text: async () => CSV }
      if (String(url).endsWith('/charts/historical')) return { ok: true, json: async () => daily }
      throw new Error(`unexpected URL ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new DhanMarketDataAdapter({ clientId: '100', accessToken: 'tok' })
    const candles = await adapter.getHistoricalCandles({
      symbol: 'RELIANCE.NS', timeframe: '1wk',
      from: new Date('2026-01-01'), to: new Date('2026-01-31'),
    })

    expect(candles).toHaveLength(2)
    expect(candles[0]).toEqual({ time: days[0], open: 1, high: 50, low: 1, close: 5, volume: 50 })
    expect(candles[1]).toEqual({ time: days[5], open: 6, high: 60, low: 6, close: 6, volume: 99 })
  })
})
