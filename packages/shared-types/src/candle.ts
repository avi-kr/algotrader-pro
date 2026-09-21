import { z } from 'zod'

/** Canonical OHLCV bar. `time` is a Unix epoch second (UTC), matching the
 * existing chart components' expectations. Every market-data adapter
 * (Alpaca, Binance/Coinbase, Yahoo, CoinGecko) normalizes into this shape —
 * nothing downstream should know which provider a candle came from. */
export const CandleSchema = z.object({
  time: z.number().int(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().default(0),
})
export type Candle = z.infer<typeof CandleSchema>

export const AssetClassSchema = z.enum(['us_equity', 'crypto'])
export type AssetClass = z.infer<typeof AssetClassSchema>

export const TimeframeSchema = z.enum(['1m', '5m', '15m', '1h', '4h', '1d', '1wk'])
export type Timeframe = z.infer<typeof TimeframeSchema>
