import type { BrokerAdapter, Order, Fill, Position } from '@algotrader/shared-types'

/**
 * Crypto exchanges don't offer a real paper-trading account the way Alpaca
 * does, so paper crypto trading runs against THIS simulator instead: real
 * market prices (from a live MarketDataAdapter), simulated fills. It
 * implements the same `BrokerAdapter` interface as the real Alpaca adapter,
 * so nothing upstream (risk engine, OMS, portfolio) can tell the difference
 * — CLAUDE.md non-negotiable #7.
 *
 * Fills are immediate, at the last known price, with a configurable slippage
 * and commission — the same cost model the backtester uses, so paper results
 * stay comparable to backtest results.
 */
export class SimulatedPaperAdapter implements BrokerAdapter {
  readonly name = 'simulated-paper'
  private orders = new Map<string, { order: Order; status: Order['status']; fills: Fill[] }>()
  private positions = new Map<string, Position>()
  private equity: number

  constructor(
    private getLastPrice: (symbol: string) => number,
    options: { startingEquity?: number; slippagePct?: number; commissionPct?: number } = {}
  ) {
    this.equity = options.startingEquity ?? 100000
    this.slippagePct = options.slippagePct ?? 0.05
    this.commissionPct = options.commissionPct ?? 0.1
  }

  private slippagePct: number
  private commissionPct: number

  /** Idempotent on `clientOrderId`: a retry with the same order returns the
   * SAME broker order id instead of creating a second fill
   * (platform-engineer.md rule #3). */
  async submitOrder(order: Order): Promise<{ brokerOrderId: string }> {
    const existing = this.orders.get(order.clientOrderId)
    if (existing) return { brokerOrderId: existing.order.clientOrderId }

    const lastPrice = this.getLastPrice(order.symbol)
    const slip = (lastPrice * this.slippagePct) / 100
    const fillPrice = order.side === 'buy' ? lastPrice + slip : lastPrice - slip
    const commission = (fillPrice * order.qty * this.commissionPct) / 100

    const fill: Fill = {
      orderId: order.clientOrderId,
      price: fillPrice,
      qty: order.qty,
      commission,
      filledAt: Math.floor(Date.now() / 1000),
    }

    this.orders.set(order.clientOrderId, { order, status: 'filled', fills: [fill] })
    this.applyFillToPosition(order, fill)
    return { brokerOrderId: order.clientOrderId }
  }

  private applyFillToPosition(order: Order, fill: Fill) {
    const key = order.symbol
    const existing = this.positions.get(key)
    const signedQty = order.side === 'buy' ? fill.qty : -fill.qty

    if (!existing || existing.side === 'flat') {
      this.positions.set(key, {
        strategyId: order.strategyId,
        mode: order.mode,
        symbol: key,
        qty: signedQty,
        avgEntryPrice: fill.price,
        side: signedQty > 0 ? 'long' : signedQty < 0 ? 'short' : 'flat',
      })
    } else {
      const newQty = existing.qty + signedQty
      this.positions.set(key, {
        ...existing,
        qty: newQty,
        side: newQty > 0 ? 'long' : newQty < 0 ? 'short' : 'flat',
      })
    }

    this.equity -= fill.commission
  }

  async cancelOrder(): Promise<void> {
    // Fills are immediate/synchronous in this simulator, so there is never
    // an outstanding order to cancel by the time a caller could ask.
  }

  async getOrderStatus(brokerOrderId: string): Promise<{ status: Order['status']; fills: Fill[] }> {
    const entry = this.orders.get(brokerOrderId)
    if (!entry) throw new Error(`SimulatedPaperAdapter: unknown order ${brokerOrderId}`)
    return { status: entry.status, fills: entry.fills }
  }

  async getPositions(): Promise<Position[]> {
    return [...this.positions.values()].filter(p => p.side !== 'flat')
  }

  async getAccountEquity(): Promise<number> {
    return this.equity
  }
}
