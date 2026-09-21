import type { Candle, Timeframe } from './candle'
import type { Order, Fill, Position } from './order'

/** Contract every market data provider (Alpaca, Binance/Coinbase, and the
 * existing Yahoo/CoinGecko routes) must implement. Business logic — the
 * strategy kernel, the backtester, the engine's signal loop — depends only
 * on this interface, never on a provider SDK directly
 * (platform-engineer.md rule #2). */
export interface MarketDataAdapter {
  readonly name: string
  getHistoricalCandles(params: {
    symbol: string
    timeframe: Timeframe
    from: Date
    to: Date
  }): Promise<Candle[]>
  subscribeLive(params: {
    symbols: string[]
    onCandle: (symbol: string, candle: Candle) => void
  }): Promise<() => void /* unsubscribe */>
}

/** Contract every broker adapter (Alpaca paper+live, the simulated crypto
 * paper adapter) must implement. Paper and live use the SAME adapter shape —
 * only credentials/base URL differ — so switching modes never changes the
 * calling code (CLAUDE.md non-negotiable #7). */
export interface BrokerAdapter {
  readonly name: string
  submitOrder(order: Order): Promise<{ brokerOrderId: string }>
  cancelOrder(brokerOrderId: string): Promise<void>
  getOrderStatus(brokerOrderId: string): Promise<{ status: Order['status']; fills: Fill[] }>
  getPositions(): Promise<Position[]>
  getAccountEquity(): Promise<number>
}
