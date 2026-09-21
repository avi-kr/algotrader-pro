// Strategy persistence — backed by Postgres via /api/strategies, not
// localStorage. Strategies need to survive across devices and feed the
// audit trail (see CLAUDE.md), so client-only storage isn't an option.

const BASE = '/api/strategies'

export async function getStrategies() {
  try {
    const res = await fetch(BASE, { cache: 'no-store' })
    if (!res.ok) return []
    const data = await res.json()
    return data.strategies || []
  } catch (e) {
    console.error('Failed to load strategies:', e)
    return []
  }
}

export async function getStrategy(id) {
  try {
    const res = await fetch(`${BASE}/${id}`, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    return data.strategy || null
  } catch (e) {
    console.error('Failed to load strategy:', e)
    return null
  }
}

export async function saveStrategy(strategy) {
  const isUpdate = Boolean(strategy.id)
  const url = isUpdate ? `${BASE}/${strategy.id}` : BASE
  const method = isUpdate ? 'PUT' : 'POST'
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(strategy),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(typeof err.error === 'string' ? err.error : 'Failed to save strategy')
  }
  const data = await res.json()
  return data.strategy
}

export async function deleteStrategy(id) {
  const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete strategy')
}

export async function duplicateStrategy(id) {
  const original = await getStrategy(id)
  if (!original) return null
  const { id: _drop, createdAt, updatedAt, ...rest } = original
  return saveStrategy({ ...rest, name: `${original.name} (Copy)` })
}
