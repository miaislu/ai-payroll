export const RATINGS = ['S', 'A', 'B', 'C', 'D']
export const RAISE_BY_RATING = { S: 0.12, A: 0.08, B: 0.03, C: 0, D: 0 }

export function suggestRaise(monthlyBase, rating) {
  if (!RATINGS.includes(rating)) return null
  const pct = RAISE_BY_RATING[rating] ?? 0
  const from_monthly = Math.round(Number(monthlyBase) || 0)
  const to_monthly = Math.round(from_monthly * (1 + pct))
  return {
    rating,
    pct,
    from_monthly,
    to_monthly,
    annual_from: from_monthly * 12,
    annual_to: to_monthly * 12
  }
}

export function isCycle(value) {
  return /^\d{4}-H[12]$/.test(String(value || ''))
}
