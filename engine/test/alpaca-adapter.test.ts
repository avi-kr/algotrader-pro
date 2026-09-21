import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Order } from '@algotrader/shared-types'
import { AlpacaBrokerAdapter } from '../src/broker-adapters/alpaca'

const baseOrder: Order = {
  clientOrderId: 'client-abc-123',
  strategyId: 'strat-1',
  mode: 'paper',
  symbol: 'AAPL',
  side: 'buy',
  qty: 5,
  type: 'market',
  status: 'new',
}

describe('AlpacaBrokerAdapter', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('fails closed: refuses to construct without credentials (security-auditor.md rule #4)', () => {
    expect(() => new AlpacaBrokerAdapter({ apiKeyId: undefined, apiSecretKey: undefined, baseUrl: 'https://paper-api.alpaca.markets' })).toThrow()
    expect(() => new AlpacaBrokerAdapter({ apiKeyId: 'k', apiSecretKey: undefined, baseUrl: 'https://paper-api.alpaca.markets' })).toThrow()
  })

  it('submits an order with the client_order_id as the idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'broker-order-999' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new AlpacaBrokerAdapter({ apiKeyId: 'k', apiSecretKey: 's', baseUrl: 'https://paper-api.alpaca.markets' })
    const result = await adapter.submitOrder(baseOrder)

    expect(result.brokerOrderId).toBe('broker-order-999')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://paper-api.alpaca.markets/v2/orders')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.client_order_id).toBe('client-abc-123')
    expect(body.symbol).toBe('AAPL')
    expect(init.headers['APCA-API-KEY-ID']).toBe('k')
    expect(init.headers['APCA-API-SECRET-KEY']).toBe('s')
  })

  it('throws with the response body when Alpaca rejects the request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => 'insufficient buying power' })
    )
    const adapter = new AlpacaBrokerAdapter({ apiKeyId: 'k', apiSecretKey: 's', baseUrl: 'https://paper-api.alpaca.markets' })
    await expect(adapter.submitOrder(baseOrder)).rejects.toThrow(/422/)
  })

  it('maps Alpaca order statuses to the shared OrderStatus enum and extracts fills', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'broker-order-999', status: 'filled', filled_qty: '5', filled_avg_price: '190.25' }),
      })
    )
    const adapter = new AlpacaBrokerAdapter({ apiKeyId: 'k', apiSecretKey: 's', baseUrl: 'https://paper-api.alpaca.markets' })
    const { status, fills } = await adapter.getOrderStatus('broker-order-999')
    expect(status).toBe('filled')
    expect(fills).toHaveLength(1)
    expect(fills[0].price).toBe(190.25)
    expect(fills[0].qty).toBe(5)
  })
})
