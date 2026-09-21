import { z } from 'zod'
import { TradeModeSchema } from './strategy'

export const OrderSideSchema = z.enum(['buy', 'sell'])
export type OrderSide = z.infer<typeof OrderSideSchema>

export const OrderStatusSchema = z.enum([
  'new',
  'submitted',
  'partially_filled',
  'filled',
  'rejected',
  'canceled',
])
export type OrderStatus = z.infer<typeof OrderStatusSchema>

/** `clientOrderId` is the idempotency key — platform-engineer.md rule #3:
 * a retry after a network failure must reuse the same id, never mint a new
 * one, so a broker that already accepted the order rejects the duplicate
 * instead of double-filling it. */
export const OrderSchema = z.object({
  id: z.string().optional(),
  clientOrderId: z.string().min(1),
  strategyId: z.string(),
  mode: TradeModeSchema,
  symbol: z.string(),
  side: OrderSideSchema,
  qty: z.number().positive(),
  type: z.enum(['market', 'limit']),
  limitPrice: z.number().positive().optional(),
  status: OrderStatusSchema.default('new'),
  brokerOrderId: z.string().optional(),
  createdAt: z.number().int().optional(),
})
export type Order = z.infer<typeof OrderSchema>

export const FillSchema = z.object({
  id: z.string().optional(),
  orderId: z.string(),
  price: z.number().positive(),
  qty: z.number().positive(),
  commission: z.number().nonnegative().default(0),
  filledAt: z.number().int(),
})
export type Fill = z.infer<typeof FillSchema>

export const PositionSchema = z.object({
  strategyId: z.string(),
  mode: TradeModeSchema,
  symbol: z.string(),
  qty: z.number(),
  avgEntryPrice: z.number(),
  side: z.enum(['long', 'short', 'flat']),
})
export type Position = z.infer<typeof PositionSchema>

export const RiskCheckResultSchema = z.object({
  passed: z.boolean(),
  rule: z.string(),
  limit: z.number(),
  observed: z.number(),
  reason: z.string().optional(),
})
export type RiskCheckResult = z.infer<typeof RiskCheckResultSchema>

export const RiskLimitsSchema = z.object({
  maxPositionSizePct: z.number().positive().max(100),
  maxDailyLossPct: z.number().positive().max(100),
  maxSymbolExposurePct: z.number().positive().max(100),
  killSwitchEngaged: z.boolean().default(true),
})
export type RiskLimits = z.infer<typeof RiskLimitsSchema>
