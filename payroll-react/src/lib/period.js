export function currentPeriod(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function currentDate(date = new Date()) {
  return `${currentPeriod(date)}-${String(date.getDate()).padStart(2, '0')}`
}

export function addMonths(period, delta) {
  const [year, month] = period.split('-').map(Number)
  const date = new Date(year, month - 1 + delta, 1)
  return currentPeriod(date)
}

export function periodOptions(center = currentPeriod(), before = 24, after = 6) {
  const periods = []
  for (let i = -before; i <= after; i++) periods.push(addMonths(center, i))
  return periods.reverse()
}

export function currentCycle(date = new Date()) {
  return `${date.getFullYear()}-${date.getMonth() < 6 ? 'H1' : 'H2'}`
}

export function cycleOptions(date = new Date()) {
  const year = date.getFullYear()
  return [`${year}-H2`, `${year}-H1`, `${year - 1}-H2`, `${year - 1}-H1`]
}
