import { describe, it, expect } from 'vitest'
import type { Order } from '@algotrader/shared-types'
import { SimulatedPaperAdapter } from '../src/broker-adapters/simulated'

const order: Order = {
  clientOrderId: 'client-1',
  strategyId: 'strat-1',
  mode: 'paper',
  symbol: 'BTCUSDT',
  side: 'buy',
  qty: 1,
  type: 'market',
  status: 'new',
}

describe('SimulatedPaperAdapter', () => {
  it('fills a buy above the last price (slippage works against the trader, not for them)', async () => {
    const adapter = new SimulatedPaperAdapter(() => 50000, { slippagePct: 0.1 })
    const { brokerOrderId } = await adapter.submitOrder(order)
    const { status, fills } = await adapter.getOrderStatus(brokerOrderId)

    expect(status).toBe('filled')
    expect(fills[0].price).toBeGreaterThan(50000)
  })

  it('reflects the fill in getPositions', async () => {
    const adapter = new SimulatedPaperAdapter(() => 50000)
    await adapter.submitOrder(order)
    const positions = await adapter.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].symbol).toBe('BTCUSDT')
    expect(positions[0].qty).toBe(1)
    expect(positions[0].side).toBe('long')
  })

  it('is idempotent on clientOrderId: retrying the same order never double-fills', async () => {
    const adapter = new SimulatedPaperAdapter(() => 50000)
    const first = await adapter.submitOrder(order)
    const second = await adapter.submitOrder(order) // simulate a retry after a dropped response

    expect(second.brokerOrderId).toBe(first.brokerOrderId)
    const positions = await adapter.getPositions()
    expect(positions[0].qty).toBe(1) // NOT 2 — a duplicate submit must not double-fill
  })

  it('a sell reduces/flips the position rather than opening a separate one', async () => {
    const adapter = new SimulatedPaperAdapter(() => 50000)
    await adapter.submitOrder(order)
    await adapter.submitOrder({ ...order, clientOrderId: 'client-2', side: 'sell', qty: 1.5 })

    const positions = await adapter.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].qty).toBeCloseTo(-0.5)
    expect(positions[0].side).toBe('short')
  })
})
