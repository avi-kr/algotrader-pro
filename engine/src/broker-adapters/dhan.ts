import type { BrokerAdapter, Order, Fill, Position } from '@algotrader/shared-types'
import { resolveDhanInstrument } from '../market-data/dhan-instruments'

export interface DhanConfig {
  clientId: string | undefined
  accessToken: string | undefined
  /** 'INTRADAY' (MIS, squared off same day) or 'CNC' (delivery). Passed
   * through as Dhan's own `productType` — see docs/ARCHITECTURE.md for why
   * this isn't per-order configurable yet. */
  productType?: 'INTRADAY' | 'CNC'
}

interface DhanOrderResponse {
  orderId: string
  orderStatus: string
}

interface DhanOrderDetail {
  orderId: string
  orderStatus: string
  omsErrorDescription?: string | null
  filledQty?: number
  averageTradedPrice?: number
}

/**
 * Dhan trading REST adapter for NSE equities — paper and live are the SAME
 * code path (CLAUDE.md non-negotiable #7); paper mode never actually
 * constructs this class (see createBrokerAdapter in ./index.ts), since
 * Dhan's own Sandbox has unrealistic flat-price fills and no live quotes —
 * paper trading runs through SimulatedPaperAdapter instead, fed by
 * DhanMarketDataAdapter's real prices.
 *
 * Two things make this adapter meaningfully different from AlpacaBrokerAdapter:
 *
 * 1. Dhan is keyed by numeric `securityId`, not by symbol — every order
 *    resolves through the instrument master first (see dhan-instruments.ts).
 * 2. Dhan's `correlationId` is a user-defined LOOKUP TAG, not a
 *    server-enforced idempotency key the way Alpaca's `client_order_id` is —
 *    submitting the same correlationId twice creates two separate orders.
 *    This adapter closes that gap itself: before submitting, it checks
 *    `GET /orders/external/{correlationId}` and returns the existing order
 *    if one is already there, so a caller retrying after a network failure
 *    (platform-engineer.md rule #3) can't double-submit.
 *
 * Order placement/modification/cancellation additionally require a static
 * IP whitelisted on the Dhan account (SEBI requirement) — see
 * docs/ARCHITECTURE.md for the registration steps. A request from a
 * non-whitelisted IP fails with Dhan error DH-905, which surfaces here as an
 * ordinary thrown error (this adapter does not special-case it).
 *
 * Unit-tested against a mocked `fetch` — real end-to-end verification needs
 * the user's own Dhan access token and static IP, which is a follow-up.
 */
export class DhanBrokerAdapter implements BrokerAdapter {
  readonly name = 'dhan'
  private readonly baseUrl = 'https://api.dhan.co/v2'
  private readonly headers: Record<string, string>
  private readonly productType: 'INTRADAY' | 'CNC'

  constructor(private config: DhanConfig) {
    if (!config.clientId || !config.accessToken) {
      throw new Error(
        'DhanBrokerAdapter: missing DHAN_CLIENT_ID/DHAN_ACCESS_TOKEN — refusing to start rather than trade unauthenticated.'
      )
    }
    this.headers = {
      'access-token': config.accessToken,
      'Content-Type': 'application/json',
    }
    this.productType = config.productType ?? 'INTRADAY'
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers: this.headers })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Dhan API ${res.status} on ${path}: ${body}`)
    }
    return res.json() as Promise<T>
  }

  /** Renews an already-active access token by 24h (GET /RenewToken). Does
   * NOT mint a brand-new token — that requires either an interactive
   * browser login or the account's trading PIN + TOTP, which this codebase
   * deliberately never handles (see docs/ARCHITECTURE.md). Call this
   * periodically (well inside 24h) from a long-running engine process to
   * avoid the token expiring mid-session. */
  async renewToken(): Promise<void> {
    await this.request('/RenewToken', {
      method: 'GET',
      headers: { ...this.headers, dhanClientId: this.config.clientId as string },
    })
  }

  async submitOrder(order: Order): Promise<{ brokerOrderId: string }> {
    const existing = await this.findByCorrelationId(order.clientOrderId)
    if (existing) return { brokerOrderId: existing.orderId }

    const instrument = await resolveDhanInstrument(order.symbol)
    const body = {
      dhanClientId: this.config.clientId,
      correlationId: order.clientOrderId,
      transactionType: order.side === 'buy' ? 'BUY' : 'SELL',
      exchangeSegment: instrument.exchangeSegment,
      productType: this.productType,
      orderType: order.type === 'market' ? 'MARKET' : 'LIMIT',
      validity: 'DAY',
      securityId: instrument.securityId,
      quantity: order.qty,
      price: order.type === 'limit' ? order.limitPrice : 0,
    }
    const res = await this.request<DhanOrderResponse>('/orders', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return { brokerOrderId: res.orderId }
  }

  private async findByCorrelationId(correlationId: string): Promise<DhanOrderDetail | null> {
    try {
      return await this.request<DhanOrderDetail>(`/orders/external/${correlationId}`)
    } catch {
      // No order exists yet for this correlationId (Dhan returns a 4xx) —
      // that's the expected, common case, not a real failure.
      return null
    }
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    await this.request(`/orders/${brokerOrderId}`, { method: 'DELETE' })
  }

  async getOrderStatus(brokerOrderId: string): Promise<{ status: Order['status']; fills: Fill[] }> {
    const res = await this.request<DhanOrderDetail>(`/orders/${brokerOrderId}`)
    const status = mapDhanStatus(res.orderStatus)
    const fills: Fill[] =
      res.averageTradedPrice && (res.filledQty ?? 0) > 0
        ? [
            {
              orderId: brokerOrderId,
              price: res.averageTradedPrice,
              qty: res.filledQty as number,
              commission: 0, // computed from the Trade Book / postback separately, not exposed here
              filledAt: Math.floor(Date.now() / 1000),
            },
          ]
        : []
    return { status, fills }
  }

  async getPositions(): Promise<Position[]> {
    const res = await this.request<
      Array<{ tradingSymbol: string; netQty: number; buyAvg: number; sellAvg: number; positionType: string }>
    >('/positions')
    return res
      .filter(p => p.netQty !== 0)
      .map(p => ({
        strategyId: '', // Dhan positions are account-wide; caller attributes them to a strategy
        mode: 'live',
        symbol: p.tradingSymbol,
        qty: Math.abs(p.netQty),
        avgEntryPrice: p.netQty > 0 ? p.buyAvg : p.sellAvg,
        side: p.netQty > 0 ? 'long' : p.netQty < 0 ? 'short' : 'flat',
      }))
  }

  async getAccountEquity(): Promise<number> {
    const res = await this.request<{ availabelBalance: number }>('/fundlimit')
    // "availabelBalance" is Dhan's own (misspelled) field name — not a typo here.
    return res.availabelBalance
  }
}

function mapDhanStatus(status: string): Order['status'] {
  switch (status) {
    case 'TRANSIT':
    case 'PENDING':
      return 'submitted'
    case 'PART_TRADED':
      return 'partially_filled'
    case 'TRADED':
      return 'filled'
    case 'CANCELLED':
    case 'EXPIRED':
      return 'canceled'
    case 'REJECTED':
      return 'rejected'
    default:
      return 'submitted'
  }
}
