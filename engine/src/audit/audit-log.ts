import { prisma, Prisma } from '@algotrader/db'
import type { AuditEventType, TradeMode } from '@algotrader/shared-types'

/**
 * Append-only by construction: this class exposes `record` and nothing
 * else — no update, no delete. CLAUDE.md non-negotiable #2: every signal,
 * risk check, order, and fill is recorded here. Database-level enforcement
 * (revoking UPDATE/DELETE grants on the audit_events table for the app's
 * Postgres role) is a documented follow-up in docs/ARCHITECTURE.md.
 */
export class AuditLog {
  async record(event: {
    type: AuditEventType
    mode: TradeMode
    strategyId?: string
    symbol?: string
    payload: Record<string, unknown>
  }): Promise<void> {
    await prisma.auditEvent.create({
      data: {
        type: event.type,
        mode: event.mode,
        strategyId: event.strategyId,
        symbol: event.symbol,
        payload: event.payload as Prisma.InputJsonValue,
      },
    })
  }
}
