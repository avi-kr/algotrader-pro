import { z } from 'zod'
import { AssetClassSchema } from './candle'

export const IndicatorConfigSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    'EMA', 'SMA', 'RSI', 'MACD', 'BB', 'ATR', 'VWAP', 'MARKET_STRUCTURE',
    'LIQUIDITY_SWEEP', 'FVG', 'ORDER_BLOCK', 'IMBALANCE', 'LIQUIDITY_VOID',
    'PREMIUM_DISCOUNT', 'BREAKOUT_RETEST', 'ORB', 'SR_PRICE_ACTION',
  ]),
  period: z.number().int().positive().optional(),
  fast: z.number().int().positive().optional(),
  slow: z.number().int().positive().optional(),
  signal: z.number().int().positive().optional(),
  stdDev: z.number().positive().optional(),
  color: z.string().optional(),
  // Generic numeric knobs for the structure/SMC indicator types above —
  // each type documents its own meaning for these in strategy-kernel's
  // indicators.ts/smc.ts, rather than overloading MACD's fast/slow/signal
  // for unrelated concepts. `period` doubles as swingWidth for every type
  // built on Market Structure, matching the existing MARKET_STRUCTURE
  // convention.
  lookback: z.number().int().positive().optional(),
  atrMultiple: z.number().positive().optional(),
  windowBars: z.number().int().positive().optional(),
  runLength: z.number().int().positive().optional(),
  bodyRatio: z.number().positive().optional(),
  zonePct: z.number().positive().optional(),
})
export type IndicatorConfig = z.infer<typeof IndicatorConfigSchema>

export const ConditionSchema = z.object({
  type: z.enum(['crossover', 'crossunder', 'above', 'below', 'above_value', 'below_value']),
  a: z.string(),
  b: z.string().optional(),
  value: z.union([z.number(), z.string()]).optional(),
})
export type Condition = z.infer<typeof ConditionSchema>

export const StopLossSchema = z.object({
  type: z.enum(['none', 'last_candle_low', 'atr_multiplier', 'fixed_percent', 'trailing']),
  value: z.union([z.number(), z.string(), z.null()]).optional(),
})
export type StopLoss = z.infer<typeof StopLossSchema>

export const TakeProfitSchema = z.object({
  type: z.enum(['none', 'risk_reward', 'fixed_percent']),
  value: z.union([z.number(), z.string(), z.null()]).optional(),
})
export type TakeProfit = z.infer<typeof TakeProfitSchema>

export const StrategyConfigSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  assetClass: AssetClassSchema.default('us_equity'),
  indicators: z.array(IndicatorConfigSchema).default([]),
  conditions: z.object({
    longEntry: z.array(ConditionSchema).default([]),
    longExit: z.array(ConditionSchema).default([]),
    shortEntry: z.array(ConditionSchema).default([]),
    shortExit: z.array(ConditionSchema).default([]),
  }),
  stopLoss: StopLossSchema.default({ type: 'none' }),
  takeProfit: TakeProfitSchema.default({ type: 'none' }),
  tradeDirection: z.enum(['long_only', 'short_only', 'both']).default('both'),
  positionSizePct: z.number().positive().max(100).default(10),
})
export type StrategyConfig = z.infer<typeof StrategyConfigSchema>

/** Which pipeline this run/order belongs to. `CLAUDE.md` non-negotiable #7:
 * all three modes run through the same strategy-kernel code path — this enum
 * exists to LABEL the run, never to fork the signal logic. */
export const TradeModeSchema = z.enum(['backtest', 'paper', 'live'])
export type TradeMode = z.infer<typeof TradeModeSchema>

export const SignalSchema = z.object({
  strategyId: z.string(),
  symbol: z.string(),
  mode: TradeModeSchema,
  barTime: z.number().int(),
  action: z.enum(['long_entry', 'long_exit', 'short_entry', 'short_exit']),
  generatedAt: z.number().int(),
})
export type Signal = z.infer<typeof SignalSchema>
