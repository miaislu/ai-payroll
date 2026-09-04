export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

export function isPeriod(value) {
  return PERIOD_RE.test(String(value || ''))
}

export function isDate(value) {
  const text = String(value || '')
  if (!DATE_RE.test(text)) return false
  const [year, month, day] = text.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function currentPeriod(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function addMonths(period, delta) {
  if (!isPeriod(period)) return null
  const [year, month] = period.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function periodOptions(center = currentPeriod(), before = 12, after = 6) {
  const out = []
  for (let i = -before; i <= after; i++) out.push(addMonths(center, i))
  return out.reverse()
}

export function weekdaysInRange(start, end) {
  if (!isDate(start) || !isDate(end) || start > end) return 0
  const cursor = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  let count = 0
  while (cursor <= last) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) count++
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return count
}

export function monthBounds(period) {
  if (!isPeriod(period)) return null
  const [year, month] = period.split('-').map(Number)
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { start: `${period}-01`, end: `${period}-${String(last).padStart(2, '0')}` }
}
