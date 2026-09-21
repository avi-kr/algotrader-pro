import type { BrokerAdapter, Order, Fill, Position } from '@algotrader/shared-types'

export interface AlpacaConfig {
  apiKeyId: string | undefined
  apiSecretKey: string | undefined
  /** https://paper-api.alpaca.markets for paper, https://api.alpaca.markets
   * for live. Same REST surface either way — CLAUDE.md non-negotiable #7. */
  baseUrl: string
}

/**
 * Alpaca trading REST adapter — paper and live are the SAME code path,
 * differing only by `baseUrl`/credentials (platform-engineer.md rule #2).
 *
 * security-auditor.md rule #4 (fail closed): the constructor throws if
 * credentials are missing, so a misconfigured deployment can never fall back
 * to submitting unauthenticated or default-account orders.
 *
 * Unit-tested against a mocked `fetch` (see engine/test/alpaca-adapter.test.ts)
 * — real end-to-end verification requires the user's own Alpaca API keys and
 * is a follow-up, not something this session could do.
 */
export class AlpacaBrokerAdapter implements BrokerAdapter {
  readonly name = 'alpaca'
  private readonly headers: Record<string, string>

  constructor(private config: AlpacaConfig) {
    if (!config.apiKeyId || !config.apiSecretKey) {
      throw new Error(
        'AlpacaBrokerAdapter: missing ALPACA_API_KEY_ID/ALPACA_API_SECRET_KEY — refusing to start rather than trade unauthenticated.'
      )
    }
    this.headers = {
      'APCA-API-KEY-ID': config.apiKeyId,
      'APCA-API-SECRET-KEY': config.apiSecretKey,
      'Content-Type': 'application/json',
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.config.baseUrl}${path}`, { ...init, headers: this.headers })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Alpaca API ${res.status} on ${path}: ${body}`)
    }
    return res.json() as Promise<T>
  }

  /** `order.clientOrderId` is sent as Alpaca's own `client_order_id` — if the
   * caller retries with the same order object after a network failure,
   * Alpaca itself rejects the duplicate instead of double-submitting
   * (platform-engineer.md rule #3). */
  async submitOrder(order: Order): Promise<{ brokerOrderId: string }> {
    const body = {
      symbol: order.symbol,
      qty: order.qty,
      side: order.side,
      type: order.type,
      time_in_force: 'day',
      limit_price: order.limitPrice,
      client_order_id: order.clientOrderId,
    }
    const res = await this.request<{ id: string }>('/v2/orders', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return { brokerOrderId: res.id }
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    await this.request(`/v2/orders/${brokerOrderId}`, { method: 'DELETE' })
  }

  async getOrderStatus(brokerOrderId: string): Promise<{ status: Order['status']; fills: Fill[] }> {
    const res = await this.request<{
      status: string
      filled_qty: string
      filled_avg_price: string | null
      id: string
    }>(`/v2/orders/${brokerOrderId}`)

    const status = mapAlpacaStatus(res.status)
    const fills: Fill[] =
      res.filled_avg_price && Number(res.filled_qty) > 0
        ? [
            {
              orderId: brokerOrderId,
              price: Number(res.filled_avg_price),
              qty: Number(res.filled_qty),
              commission: 0, // Alpaca is commission-free on US equities
              filledAt: Math.floor(Date.now() / 1000),
            },
          ]
        : []
    return { status, fills }
  }

  async getPositions(): Promise<Position[]> {
    const res = await this.request<
      Array<{ symbol: string; qty: string; avg_entry_price: string; side: string }>
    >('/v2/positions')
    return res.map(p => ({
      strategyId: '', // Alpaca positions are account-wide; caller attributes them to a strategy
      mode: this.config.baseUrl.includes('paper') ? 'paper' : 'live',
      symbol: p.symbol,
      qty: Number(p.qty),
      avgEntryPrice: Number(p.avg_entry_price),
      side: p.side === 'long' ? 'long' : p.side === 'short' ? 'short' : 'flat',
    }))
  }

  async getAccountEquity(): Promise<number> {
    const res = await this.request<{ equity: string }>('/v2/account')
    return Number(res.equity)
  }
}

function mapAlpacaStatus(status: string): Order['status'] {
  switch (status) {
    case 'new':
    case 'accepted':
    case 'pending_new':
      return 'submitted'
    case 'partially_filled':
      return 'partially_filled'
    case 'filled':
      return 'filled'
    case 'canceled':
    case 'expired':
      return 'canceled'
    case 'rejected':
      return 'rejected'
    default:
      return 'submitted'
  }
}
