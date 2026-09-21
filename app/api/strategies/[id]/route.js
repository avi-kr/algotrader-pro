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

export async function GET(_request, { params }) {
  const { id } = await params
  const strategy = await prisma.strategy.findUnique({ where: { id } })
  if (!strategy) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ strategy: toApiStrategy(strategy) })
}

export async function PUT(request, { params }) {
  const { id } = await params
  const body = await request.json()
  const err = validate(body)
  if (err) return NextResponse.json({ error: err }, { status: 400 })

  try {
    const updated = await prisma.strategy.update({
      where: { id },
      data: {
        name: body.name,
        description: body.description || null,
        assetClass: body.assetClass === 'crypto' ? 'crypto' : 'us_equity',
        tradeDirection: body.tradeDirection || 'both',
        positionSizePct: Number(body.positionSizePct) || 10,
        config: body,
      },
    })
    return NextResponse.json({ strategy: toApiStrategy(updated) })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}

export async function DELETE(_request, { params }) {
  const { id } = await params
  try {
    await prisma.strategy.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
