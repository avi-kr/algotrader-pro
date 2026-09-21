import { NextResponse } from 'next/server'
import { prisma } from '@algotrader/db'

function toApiStrategy(row) {
  return {
    ...row.config,
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function validate(body) {
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return 'name is required'
  }
  if (!body.conditions || typeof body.conditions !== 'object') {
    return 'conditions is required'
  }
  return null
}

export async function GET() {
  const strategies = await prisma.strategy.findMany({ orderBy: { updatedAt: 'desc' } })
  return NextResponse.json({ strategies: strategies.map(toApiStrategy) })
}

export async function POST(request) {
  const body = await request.json()
  const err = validate(body)
  if (err) return NextResponse.json({ error: err }, { status: 400 })

  const created = await prisma.strategy.create({
    data: {
      name: body.name,
      description: body.description || null,
      assetClass: body.assetClass === 'crypto' ? 'crypto' : 'us_equity',
      tradeDirection: body.tradeDirection || 'both',
      positionSizePct: Number(body.positionSizePct) || 10,
      config: body,
    },
  })
  return NextResponse.json({ strategy: toApiStrategy(created) }, { status: 201 })
}
