const STORAGE_KEY = 'algotrader_strategies'

export function getStrategies() {
  if (typeof window === 'undefined') return []
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

export function saveStrategy(strategy) {
  if (typeof window === 'undefined') return strategy
  try {
    const strategies = getStrategies()
    const idx = strategies.findIndex(s => s.id === strategy.id)
    if (idx >= 0) {
      strategies[idx] = { ...strategy, updatedAt: Date.now() }
    } else {
      strategies.push({ ...strategy, createdAt: Date.now(), updatedAt: Date.now() })
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(strategies))
    return strategy
  } catch (e) {
    console.error('Failed to save strategy:', e)
    return strategy
  }
}

export function deleteStrategy(id) {
  if (typeof window === 'undefined') return
  try {
    const strategies = getStrategies().filter(s => s.id !== id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(strategies))
  } catch (e) {
    console.error('Failed to delete strategy:', e)
  }
}

export function getStrategy(id) {
  return getStrategies().find(s => s.id === id) || null
}

export function duplicateStrategy(id) {
  const original = getStrategy(id)
  if (!original) return null
  const copy = {
    ...original,
    id: crypto.randomUUID(),
    name: `${original.name} (Copy)`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  saveStrategy(copy)
  return copy
}
