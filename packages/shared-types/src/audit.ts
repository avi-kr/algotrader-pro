import { z } from 'zod'
import { TradeModeSchema } from './strategy'

/** Append-only. CLAUDE.md non-negotiable #2: every signal, risk check, order,
 * and fill is written here before or as part of the action it records — this
 * type is deliberately a closed union so every event kind is explicit and
 * queryable, not a free-form "details" blob. */
export const AuditEventTypeSchema = z.enum([
  'signal_generated',
  'risk_check',
  'order_submitted',
  'order_rejected',
  'order_filled',
  'order_canceled',
  'kill_switch_engaged',
  'kill_switch_cleared',
])
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>

export const AuditEventSchema = z.object({
  id: z.string().optional(),
  type: AuditEventTypeSchema,
  mode: TradeModeSchema,
  strategyId: z.string().optional(),
  symbol: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.number().int(),
})
export type AuditEvent = z.infer<typeof AuditEventSchema>
