/**
 * AlgoTrader Pro engine — the long-running process that runs paper and (once
 * a human enables it) live trading. NOT deployed to Vercel: it needs to hold
 * broker/market-data WebSocket connections and a persistent trading loop,
 * neither of which fit a serverless request/response model
 * (platform-engineer.md rule #6).
 *
 * This module exports the department building blocks; it does not start a
 * loop on import. Wiring a `main()` that actually runs continuously against
 * real accounts is a follow-up that needs the user's own Alpaca/Binance
 * credentials to verify end-to-end (see docs/ARCHITECTURE.md) — shipping an
 * unverified always-on trading loop would violate qa-engineer.md rule #4
 * ("tested manually" doesn't count, and this hasn't been tested at all).
 *
 * The intended composition, once wired up, per bar/tick:
 *
 *   MarketDataAdapter.subscribeLive
 *     -> strategy-kernel signal evaluation (same code as the backtester)
 *     -> RiskEngine.checkOrder
 *     -> OrderManager.placeOrder (broker submission + audit + idempotency)
 *     -> OrderManager.reconcileOrder (fills -> PortfolioLedger + audit)
 */

export * from './risk/risk-engine'
export * from './audit/audit-log'
export * from './portfolio/ledger'
export * from './execution/order-manager'
export * from './broker-adapters/index'
export * from './market-data/alpaca'
export * from './market-data/binance'
