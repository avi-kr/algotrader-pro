import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Order } from '@algotrader/shared-types'
import { DhanBrokerAdapter } from '../src/broker-adapters/dhan'
import { clearDhanInstrumentCache } from '../src/market-data/dhan-instruments'

const CSV = [
  'SEM_EXM_EXCH_ID,SEM_SEGMENT,SEM_SMST_SECURITY_ID,SEM_TRADING_SYMBOL,SEM_INSTRUMENT_NAME,SEM_LOT_UNITS',
  'NSE,E,1333,RELIANCE,EQUITY,1',
].join('\n')

const baseOrder: Order = {
  clientOrderId: 'client-abc-123',
  strategyId: 'strat-1',
  mode: 'live',
  symbol: 'RELIANCE.NS',
  side: 'buy',
  qty: 10,
  type: 'market',
  status: 'new',
}

/** Dispatches by URL: the instrument-master CSV vs. the Dhan trading API. */
function mockFetch(apiHandler: (url: string, init?: RequestInit) => { ok: boolean; status?: number; json?: () => Promise<unknown>; text?: () => Promise<string> }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('images.dhan.co')) {
      return { ok: true, text: async () => CSV }
    }
    return apiHandler(String(url), init)
  })
}

describe('DhanBrokerAdapter', () => {
  beforeEach(() => {
    clearDhanInstrumentCache()
    vi.unstubAllGlobals()
  })

  it('fails closed: refuses to construct without credentials (security-auditor.md rule #4)', () => {
    expect(() => new DhanBrokerAdapter({ clientId: undefined, accessToken: undefined })).toThrow()
    expect(() => new DhanBrokerAdapter({ clientId: '100', accessToken: undefined })).toThrow()
  })

  it('resolves the symbol to a securityId and submits with correlationId as the idempotency key', async () => {
    const fetchMock = mockFetch(url => {
      if (url.includes('/orders/external/')) return { ok: false, status: 404, text: async () => 'not found' }
      if (url.endsWith('/orders')) return { ok: true, json: async () => ({ orderId: 'broker-999', orderStatus: 'PENDING' }) }
      throw new Error(`unexpected URL ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new DhanBrokerAdapter({ clientId: '100', accessToken: 'tok' })
    const result = await adapter.submitOrder(baseOrder)

    expect(result.brokerOrderId).toBe('broker-999')
    const orderCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/orders'))
    expect(orderCall).toBeDefined()
    const body = JSON.parse((orderCall![1] as RequestInit).body as string)
    expect(body.securityId).toBe('1333')
    expect(body.exchangeSegment).toBe('NSE_EQ')
    expect(body.correlationId).toBe('client-abc-123')
    expect(body.transactionType).toBe('BUY')
  })

  it('is idempotent on correlationId: a retry finds the existing order instead of placing a second one (platform-engineer.md rule #3)', async () => {
    const fetchMock = mockFetch(url => {
      if (url.includes('/orders/external/client-abc-123')) {
        return { ok: true, json: async () => ({ orderId: 'broker-999', orderStatus: 'PENDING' }) }
      }
      throw new Error(`should not place a new order — called ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new DhanBrokerAdapter({ clientId: '100', accessToken: 'tok' })
    const result = await adapter.submitOrder(baseOrder)
    expect(result.brokerOrderId).toBe('broker-999')
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/orders'))).toBe(false)
  })

  it('maps Dhan order statuses to the shared OrderStatus enum and extracts fills', async () => {
    const fetchMock = mockFetch(() => ({
      ok: true,
      json: async () => ({ orderId: 'broker-999', orderStatus: 'TRADED', filledQty: 10, averageTradedPrice: 2500.5 }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new DhanBrokerAdapter({ clientId: '100', accessToken: 'tok' })
    const { status, fills } = await adapter.getOrderStatus('broker-999')
    expect(status).toBe('filled')
    expect(fills).toHaveLength(1)
    expect(fills[0].price).toBe(2500.5)
    expect(fills[0].qty).toBe(10)
  })

  it('throws with the response body when Dhan rejects the request (e.g. DH-905 for a non-whitelisted IP)', async () => {
    const fetchMock = mockFetch(() => ({ ok: false, status: 400, text: async () => 'DH-905: Invalid IP' }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new DhanBrokerAdapter({ clientId: '100', accessToken: 'tok' })
    await expect(adapter.cancelOrder('broker-999')).rejects.toThrow(/DH-905/)
  })

  it('reads availabelBalance (Dhan\'s own misspelled field) as account equity', async () => {
    const fetchMock = mockFetch(() => ({ ok: true, json: async () => ({ availabelBalance: 123456.78 }) }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new DhanBrokerAdapter({ clientId: '100', accessToken: 'tok' })
    expect(await adapter.getAccountEquity()).toBe(123456.78)
  })
})
