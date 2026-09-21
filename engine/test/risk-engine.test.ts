import { describe, it, expect } from 'vitest'
import type { Order } from '@algotrader/shared-types'
import { RiskEngine, DEFAULT_RISK_LIMITS } from '../src/risk/risk-engine'

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    clientOrderId: 'test-1',
    strategyId: 'strat-1',
    mode: 'paper',
    symbol: 'AAPL',
    side: 'buy',
    qty: 10,
    type: 'market',
    status: 'new',
    ...overrides,
  }
}

describe('RiskEngine', () => {
  it('defaults to kill switch engaged and rejects every order until cleared', () => {
    const engine = new RiskEngine(DEFAULT_RISK_LIMITS)
    expect(engine.isKillSwitchEngaged).toBe(true)

    const results = engine.checkOrder(makeOrder(), {
      accountEquity: 100000,
      dailyPnl: 0,
      currentSymbolExposure: 0,
      currentPrice: 10,
    })
    expect(engine.passesAll(results)).toBe(false)
    expect(results.find(r => r.rule === 'kill_switch')?.passed).toBe(false)
  })

  it('passes a small order once the kill switch is cleared and limits are respected', () => {
    const engine = new RiskEngine(DEFAULT_RISK_LIMITS)
    engine.clearKillSwitch()

    // qty 10 @ $10 = $100 notional on $100,000 equity = 0.1%, well under 5%.
    const results = engine.checkOrder(makeOrder({ qty: 10 }), {
      accountEquity: 100000,
      dailyPnl: 0,
      currentSymbolExposure: 0,
      currentPrice: 10,
    })
    expect(engine.passesAll(results)).toBe(true)
  })

  it('rejects an order that exceeds max position size', () => {
    const engine = new RiskEngine(DEFAULT_RISK_LIMITS)
    engine.clearKillSwitch()

    // qty 1000 @ $100 = $100,000 notional == 100% of equity, limit is 5%.
    const results = engine.checkOrder(makeOrder({ qty: 1000 }), {
      accountEquity: 100000,
      dailyPnl: 0,
      currentSymbolExposure: 0,
      currentPrice: 100,
    })
    const sizeCheck = results.find(r => r.rule === 'max_position_size_pct')
    expect(sizeCheck?.passed).toBe(false)
    expect(engine.passesAll(results)).toBe(false)
  })

  it('sizes a MARKET order (no limitPrice) using the supplied current price, not zero', () => {
    const engine = new RiskEngine(DEFAULT_RISK_LIMITS)
    engine.clearKillSwitch()

    const results = engine.checkOrder(makeOrder({ type: 'market', qty: 1000 }), {
      accountEquity: 100000,
      dailyPnl: 0,
      currentSymbolExposure: 0,
      currentPrice: 100, // 1000 * 100 = $100,000 = 100% of equity — must be rejected
    })
    expect(engine.passesAll(results)).toBe(false)
  })

  it('rejects once the daily loss limit is breached, independent of order size', () => {
    const engine = new RiskEngine(DEFAULT_RISK_LIMITS)
    engine.clearKillSwitch()

    const results = engine.checkOrder(makeOrder({ qty: 1 }), {
      accountEquity: 100000,
      dailyPnl: -5000, // -5% on a 3% limit
      currentSymbolExposure: 0,
      currentPrice: 1,
    })
    const lossCheck = results.find(r => r.rule === 'max_daily_loss_pct')
    expect(lossCheck?.passed).toBe(false)
  })

  it('rejects once projected per-symbol exposure exceeds the limit', () => {
    const engine = new RiskEngine(DEFAULT_RISK_LIMITS)
    engine.clearKillSwitch()

    const results = engine.checkOrder(makeOrder({ qty: 10 }), {
      accountEquity: 100000,
      dailyPnl: 0,
      currentSymbolExposure: 9950, // already 9.95% of equity, limit is 10%
      currentPrice: 10, // + $100 more (10.05% total) pushes it over
    })
    const exposureCheck = results.find(r => r.rule === 'max_symbol_exposure_pct')
    expect(exposureCheck?.passed).toBe(false)
  })

  it('re-engaging the kill switch after clearing it blocks orders again', () => {
    const engine = new RiskEngine(DEFAULT_RISK_LIMITS)
    engine.clearKillSwitch()
    engine.engageKillSwitch()
    const results = engine.checkOrder(makeOrder(), {
      accountEquity: 100000,
      dailyPnl: 0,
      currentSymbolExposure: 0,
      currentPrice: 10,
    })
    expect(engine.passesAll(results)).toBe(false)
  })

  it('never short-circuits — reports every rule even when the first one fails', () => {
    const engine = new RiskEngine(DEFAULT_RISK_LIMITS) // kill switch engaged
    const results = engine.checkOrder(makeOrder({ qty: 1000 }), {
      accountEquity: 100000,
      dailyPnl: -10000,
      currentSymbolExposure: 50000,
      currentPrice: 100,
    })
    expect(results.map(r => r.rule)).toEqual([
      'kill_switch',
      'max_position_size_pct',
      'max_daily_loss_pct',
      'max_symbol_exposure_pct',
    ])
    expect(results.every(r => !r.passed)).toBe(true)
  })
})
