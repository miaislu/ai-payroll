// 对标样本导入与分位汇总。不做猎聘/Boss 等平台抓取。
export const INGEST_SOURCES = ['import:seed', 'import:csv', 'import:json', 'import:manual']

export function splitCsvLine(line) {
  const out = []
  let cur = '', quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

export function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const headers = splitCsvLine(lines[0]).map(h => h.trim())
  return lines.slice(1).map(line => {
    const cols = splitCsvLine(line)
    const row = {}
    headers.forEach((h, i) => { row[h] = cols[i] == null ? '' : cols[i] })
    return row
  })
}

export function normalizeSample(row) {
  if (!row || typeof row !== 'object') return null
  const direction = String(row.direction || '').trim()
  const city = String(row.city || '上海').trim() || '上海'
  const exp_band = String(row.exp_band || row.exp || '3-5年').trim() || '3-5年'
  const company_type = String(row.company_type || row.type || 'Fabless').trim() || 'Fabless'
  const annual_cash_wan = Number(row.annual_cash_wan ?? row.cash_wan ?? row.p50)
  const source = String(row.source || 'import:manual').trim().slice(0, 80) || 'import:manual'
  if (!direction || direction.length > 40) return null
  if (!Number.isFinite(annual_cash_wan) || annual_cash_wan <= 0 || annual_cash_wan > 500) return null
  return {
    direction,
    city,
    exp_band,
    company_type,
    annual_cash_wan: Math.round(annual_cash_wan * 10) / 10,
    source,
    title: String(row.title || '').trim().slice(0, 200),
    collected_at: String(row.collected_at || new Date().toISOString().slice(0, 10)).slice(0, 10)
  }
}

export function percentiles(values) {
  const sorted = values.filter(v => Number.isFinite(v)).slice().sort((a, b) => a - b)
  if (!sorted.length) return null
  const at = p => {
    const idx = (sorted.length - 1) * p
    const lo = Math.floor(idx), hi = Math.ceil(idx)
    if (lo === hi) return sorted[lo]
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
  }
  const round = v => Math.round(v)
  return { p25: round(at(0.25)), p50: round(at(0.5)), p75: round(at(0.75)), n: sorted.length }
}

export function bandFromSamples(samples) {
  return percentiles((samples || []).map(sample => Number(sample.annual_cash_wan)))
}
