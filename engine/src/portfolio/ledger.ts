import { prisma } from '@algotrader/db'
import type { Fill, Order, Position, TradeMode } from '@algotrader/shared-types'

/**
 * Source of truth for positions independent of the broker — reconciled
 * against it, never blindly trusting it (platform-engineer.md). Persisted so
 * the engine can restart and reconstruct state from the database instead of
 * memory (platform-engineer.md rule #6).
 */
export class PortfolioLedger {
  async applyFill(order: Order, fill: Fill): Promise<Position> {
    const signedQty = order.side === 'buy' ? fill.qty : -fill.qty

    const existing = await prisma.position.findUnique({
      where: { strategyId_mode_symbol: { strategyId: order.strategyId, mode: order.mode, symbol: order.symbol } },
    })

    let newQty: number
    let newAvgEntry: number
    if (!existing || existing.qty === 0) {
      newQty = signedQty
      newAvgEntry = fill.price
    } else {
      newQty = existing.qty + signedQty
      // Adding to an existing position in the same direction moves the
      // average entry price; closing/flipping resets it to the fill price.
      const sameDirection = Math.sign(existing.qty) === Math.sign(signedQty)
      newAvgEntry = sameDirection
        ? (existing.avgEntryPrice * existing.qty + fill.price * signedQty) / newQty
        : fill.price
    }

    const side = newQty > 0 ? 'long' : newQty < 0 ? 'short' : 'flat'

    const updated = await prisma.position.upsert({
      where: { strategyId_mode_symbol: { strategyId: order.strategyId, mode: order.mode, symbol: order.symbol } },
      create: {
        strategyId: order.strategyId,
        mode: order.mode,
        symbol: order.symbol,
        qty: newQty,
        avgEntryPrice: newAvgEntry,
        side,
      },
      update: { qty: newQty, avgEntryPrice: newAvgEntry, side },
    })

    return {
      strategyId: updated.strategyId,
      mode: updated.mode as TradeMode,
      symbol: updated.symbol,
      qty: updated.qty,
      avgEntryPrice: updated.avgEntryPrice,
      side: updated.side as Position['side'],
    }
  }

  async getPosition(strategyId: string, mode: TradeMode, symbol: string): Promise<Position | null> {
    const row = await prisma.position.findUnique({
      where: { strategyId_mode_symbol: { strategyId, mode, symbol } },
    })
    if (!row) return null
    return {
      strategyId: row.strategyId,
      mode: row.mode as TradeMode,
      symbol: row.symbol,
      qty: row.qty,
      avgEntryPrice: row.avgEntryPrice,
      side: row.side as Position['side'],
    }
  }
}
