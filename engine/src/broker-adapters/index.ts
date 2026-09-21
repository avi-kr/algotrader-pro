import type { AssetClass, BrokerAdapter, TradeMode } from '@algotrader/shared-types'
import { AlpacaBrokerAdapter } from './alpaca'
import { SimulatedPaperAdapter } from './simulated'

export { AlpacaBrokerAdapter } from './alpaca'
export { SimulatedPaperAdapter } from './simulated'

/**
 * The only place `mode`/`assetClass` are allowed to affect which adapter
 * gets constructed — everything after this returns a plain `BrokerAdapter`,
 * so no other code branches on mode (CLAUDE.md non-negotiable #7).
 *
 * security-auditor.md rule #3: live is never reachable unless
 * LIVE_TRADING_ENABLED is explicitly "true" AND live credentials exist.
 */
export function createBrokerAdapter(
  mode: TradeMode,
  assetClass: AssetClass,
  getLastPrice: (symbol: string) => number
): BrokerAdapter {
  if (assetClass === 'crypto') {
    // No real paper account exists on crypto exchanges — paper and backtest
    // both run through the simulator; live crypto trading isn't wired up in
    // this pass (see docs/ARCHITECTURE.md).
    if (mode === 'live') {
      throw new Error('Live crypto trading is not implemented yet — see docs/ARCHITECTURE.md.')
    }
    return new SimulatedPaperAdapter(getLastPrice)
  }

  if (mode === 'live' && process.env.LIVE_TRADING_ENABLED !== 'true') {
    throw new Error(
      'Refusing to create a LIVE broker adapter: LIVE_TRADING_ENABLED is not "true". A human must set this explicitly (CLAUDE.md non-negotiable #1).'
    )
  }

  return new AlpacaBrokerAdapter({
    apiKeyId: process.env.ALPACA_API_KEY_ID,
    apiSecretKey: process.env.ALPACA_API_SECRET_KEY,
    baseUrl:
      mode === 'live'
        ? 'https://api.alpaca.markets'
        : process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets',
  })
}
