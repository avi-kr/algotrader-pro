import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BrokerAdapter, Order } from '@algotrader/shared-types'
import { RiskEngine, DEFAULT_RISK_LIMITS } from '../src/risk/risk-engine'

const prismaMock = {
  order: { upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  auditEvent: { create: vi.fn() },
  position: { findUnique: vi.fn(), upsert: vi.fn() },
}

vi.mock('@algotrader/db', () => ({ prisma: prismaMock }))

const { OrderManager } = await import('../src/execution/order-manager.js')

const order: Order = {
  clientOrderId: 'client-1',
  strategyId: 'strat-1',
  mode: 'paper',
  symbol: 'AAPL',
  side: 'buy',
  qty: 1,
  type: 'market',
  status: 'new',
}

const riskCtx = { accountEquity: 100000, dailyPnl: 0, currentSymbolExposure: 0, currentPrice: 100 }

function makeBroker(): BrokerAdapter {
  return {
    name: 'stub',
    submitOrder: vi.fn().mockResolvedValue({ brokerOrderId: 'broker-1' }),
    cancelOrder: vi.fn(),
    getOrderStatus: vi.fn().mockResolvedValue({ status: 'filled', fills: [] }),
    getPositions: vi.fn().mockResolvedValue([]),
    getAccountEquity: vi.fn().mockResolvedValue(100000),
  }
}

describe('OrderManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.order.upsert.mockResolvedValue({ id: 'db-order-1' })
  })

  it('never reaches the broker when the risk engine rejects the order (kill switch engaged)', async () => {
    const broker = makeBroker()
    const risk = new RiskEngine(DEFAULT_RISK_LIMITS) // kill switch engaged by default
    const manager = new OrderManager(broker, risk)

    const result = await manager.placeOrder(order, riskCtx)

    expect(result.accepted).toBe(false)
    expect(broker.submitOrder).not.toHaveBeenCalled()
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'order_rejected' }) })
    )
  })

  it('submits to the broker and records order_submitted once risk checks pass', async () => {
    const broker = makeBroker()
    const risk = new RiskEngine(DEFAULT_RISK_LIMITS)
    risk.clearKillSwitch()
    const manager = new OrderManager(broker, risk)

    const result = await manager.placeOrder(order, riskCtx)

    expect(result.accepted).toBe(true)
    expect(result.brokerOrderId).toBe('broker-1')
    expect(broker.submitOrder).toHaveBeenCalledTimes(1)
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'order_submitted' }) })
    )
  })
})
