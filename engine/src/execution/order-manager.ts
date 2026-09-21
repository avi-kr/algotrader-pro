import { prisma } from '@algotrader/db'
import type { BrokerAdapter, Order, RiskCheckResult } from '@algotrader/shared-types'
import { RiskEngine, type RiskContext } from '../risk/risk-engine'
import { AuditLog } from '../audit/audit-log'
import { PortfolioLedger } from '../portfolio/ledger'

/**
 * The Order Management System: the one place a signal becomes a real order.
 * Every order passes through risk checks BEFORE the broker ever sees it
 * (risk-officer.md rule #4), and every step — the risk decision, the
 * submission, the fill — is written to the audit log as part of the same
 * operation (CLAUDE.md non-negotiable #2), not best-effort afterwards.
 */
export class OrderManager {
  constructor(
    private broker: BrokerAdapter,
    private risk: RiskEngine,
    private audit: AuditLog = new AuditLog(),
    private portfolio: PortfolioLedger = new PortfolioLedger()
  ) {}

  /** Returns the risk check results either way — a caller needs to know
   * WHY an order was rejected, not just that it was. */
  async placeOrder(order: Order, ctx: RiskContext): Promise<{ accepted: boolean; riskResults: RiskCheckResult[]; brokerOrderId?: string }> {
    const riskResults = this.risk.checkOrder(order, ctx)
    const passed = this.risk.passesAll(riskResults)

    await this.audit.record({
      type: 'risk_check',
      mode: order.mode,
      strategyId: order.strategyId,
      symbol: order.symbol,
      payload: { order, riskResults, passed },
    })

    if (!passed) {
      await this.audit.record({
        type: 'order_rejected',
        mode: order.mode,
        strategyId: order.strategyId,
        symbol: order.symbol,
        payload: { order, reason: riskResults.filter(r => !r.passed) },
      })
      return { accepted: false, riskResults }
    }

    // Idempotent: persist the order (keyed on clientOrderId) BEFORE calling
    // the broker, so a crash between submission and recording can't lose
    // track of an order that the broker actually accepted.
    const dbOrder = await prisma.order.upsert({
      where: { clientOrderId: order.clientOrderId },
      create: {
        clientOrderId: order.clientOrderId,
        strategyId: order.strategyId,
        mode: order.mode,
        symbol: order.symbol,
        side: order.side,
        qty: order.qty,
        type: order.type,
        limitPrice: order.limitPrice,
        status: 'submitted',
      },
      update: {},
    })

    const { brokerOrderId } = await this.broker.submitOrder(order)

    await prisma.order.update({ where: { id: dbOrder.id }, data: { brokerOrderId, status: 'submitted' } })
    await this.audit.record({
      type: 'order_submitted',
      mode: order.mode,
      strategyId: order.strategyId,
      symbol: order.symbol,
      payload: { order, brokerOrderId },
    })

    return { accepted: true, riskResults, brokerOrderId }
  }

  /** Polls the broker for fills and reconciles them into the portfolio
   * ledger + audit log. In a running engine this is called on a timer or in
   * response to a broker webhook/stream event, not invoked here — this
   * class only defines the reconciliation logic. */
  async reconcileOrder(order: Order, brokerOrderId: string): Promise<void> {
    const { status, fills } = await this.broker.getOrderStatus(brokerOrderId)

    for (const fill of fills) {
      await this.portfolio.applyFill(order, fill)
      await this.audit.record({
        type: 'order_filled',
        mode: order.mode,
        strategyId: order.strategyId,
        symbol: order.symbol,
        payload: { order, fill },
      })
    }

    await prisma.order.updateMany({ where: { clientOrderId: order.clientOrderId }, data: { status } })
  }
}
