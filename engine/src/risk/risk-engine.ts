import type { Order, RiskCheckResult, RiskLimits } from '@algotrader/shared-types'

export interface RiskContext {
  /** Total account equity right now (paper or live, whichever mode this order is for). */
  accountEquity: number
  /** Realized + unrealized P&L so far today, negative = loss. */
  dailyPnl: number
  /** Current absolute notional exposure already held in `order.symbol`, before this order. */
  currentSymbolExposure: number
  /** Current market price for `order.symbol` — used to size a market order's
   * notional exposure, since it has no `limitPrice` of its own. A market
   * order without this would silently price itself at 0 and sail through
   * every size check below. */
  currentPrice: number
}

/**
 * Pure, dependency-free risk checks — deliberately has no broker/DB calls so
 * it's trivial to unit test exhaustively (qa-engineer.md rule #1) and so it
 * can run in the hot path of every order submission without I/O latency.
 *
 * risk-officer.md rule #2: the kill switch defaults to engaged and every
 * check runs before submission, never only in the UI.
 */
export class RiskEngine {
  constructor(private limits: RiskLimits) {}

  engageKillSwitch(): void {
    this.limits = { ...this.limits, killSwitchEngaged: true }
  }

  clearKillSwitch(): void {
    this.limits = { ...this.limits, killSwitchEngaged: false }
  }

  get isKillSwitchEngaged(): boolean {
    return this.limits.killSwitchEngaged
  }

  /** Runs every check and returns ALL results (pass and fail) for the audit
   * log — never short-circuits, so a rejected order still has a full record
   * of which other limits it did or didn't also violate. */
  checkOrder(order: Order, ctx: RiskContext): RiskCheckResult[] {
    const orderNotional = order.qty * (order.limitPrice ?? ctx.currentPrice)
    const results: RiskCheckResult[] = []

    results.push({
      passed: !this.limits.killSwitchEngaged,
      rule: 'kill_switch',
      limit: 0,
      observed: this.limits.killSwitchEngaged ? 1 : 0,
      reason: this.limits.killSwitchEngaged ? 'Kill switch is engaged; no orders may be submitted.' : undefined,
    })

    const positionSizePct = ctx.accountEquity > 0 ? (orderNotional / ctx.accountEquity) * 100 : Infinity
    results.push({
      passed: positionSizePct <= this.limits.maxPositionSizePct,
      rule: 'max_position_size_pct',
      limit: this.limits.maxPositionSizePct,
      observed: positionSizePct,
      reason:
        positionSizePct > this.limits.maxPositionSizePct
          ? `Order is ${positionSizePct.toFixed(2)}% of equity, limit is ${this.limits.maxPositionSizePct}%.`
          : undefined,
    })

    const dailyLossPct = ctx.accountEquity > 0 ? (-ctx.dailyPnl / ctx.accountEquity) * 100 : 0
    results.push({
      passed: dailyLossPct <= this.limits.maxDailyLossPct,
      rule: 'max_daily_loss_pct',
      limit: this.limits.maxDailyLossPct,
      observed: dailyLossPct,
      reason:
        dailyLossPct > this.limits.maxDailyLossPct
          ? `Today's loss is ${dailyLossPct.toFixed(2)}% of equity, limit is ${this.limits.maxDailyLossPct}%.`
          : undefined,
    })

    const projectedExposurePct =
      ctx.accountEquity > 0 ? ((ctx.currentSymbolExposure + orderNotional) / ctx.accountEquity) * 100 : Infinity
    results.push({
      passed: projectedExposurePct <= this.limits.maxSymbolExposurePct,
      rule: 'max_symbol_exposure_pct',
      limit: this.limits.maxSymbolExposurePct,
      observed: projectedExposurePct,
      reason:
        projectedExposurePct > this.limits.maxSymbolExposurePct
          ? `${order.symbol} exposure would be ${projectedExposurePct.toFixed(2)}% of equity, limit is ${this.limits.maxSymbolExposurePct}%.`
          : undefined,
    })

    return results
  }

  passesAll(results: RiskCheckResult[]): boolean {
    return results.every(r => r.passed)
  }
}

/** Safe defaults for a brand-new engine instance — small size limits, kill
 * switch engaged. A human raises these deliberately; code never should. */
export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxPositionSizePct: 5,
  maxDailyLossPct: 3,
  maxSymbolExposurePct: 10,
  killSwitchEngaged: true,
}
