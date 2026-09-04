// 纯计算逻辑（服务端版）

export function normalizeOptionInput(value) {
  const inp = value && typeof value === 'object' ? value : null
  if (!inp || !inp.p || typeof inp.p !== 'object') throw Object.assign(new Error('缺少完整的期权模拟参数'), { statusCode: 400 })
  const positive = ['n', 'v0yi', 'shares', 'vest', 'lq', 'mI', 'mA']
  const nonnegative = ['k', 'dil']
  const normalized = { ...inp, p: {} }
  for (const key of positive) {
    normalized[key] = Number(inp[key])
    if (!Number.isFinite(normalized[key]) || normalized[key] <= 0) throw Object.assign(new Error(`${key} 须为大于 0 的有限数字`), { statusCode: 400 })
  }
  for (const key of nonnegative) {
    normalized[key] = Number(inp[key])
    if (!Number.isFinite(normalized[key]) || normalized[key] < 0) throw Object.assign(new Error(`${key} 须为非负有限数字`), { statusCode: 400 })
  }
  if (normalized.dil >= 100) throw Object.assign(new Error('稀释比例 dil 必须小于 100'), { statusCode: 400 })
  if (normalized.lq > 1) throw Object.assign(new Error('流动性折扣 lq 须在 0-1 之间'), { statusCode: 400 })
  for (const key of ['ipo', 'acq', 'hold', 'fail']) {
    normalized.p[key] = Number(inp.p[key])
    if (!Number.isFinite(normalized.p[key]) || normalized.p[key] < 0) throw Object.assign(new Error(`概率 p.${key} 须为非负有限数字`), { statusCode: 400 })
  }
  if (Object.values(normalized.p).reduce((sum, n) => sum + n, 0) <= 0) throw Object.assign(new Error('场景概率之和须大于 0'), { statusCode: 400 })
  return normalized
}

// 带宽卡只返回审批后的原始口径；不使用无证据的城市/经验/公司/融资轮次系数外推。
export function benchmarkCard(direction) {
  const evidenceConfidence = { 强: '高', 中: '中', 弱: '低' }
  return {
    p25: Number(direction.p25), p50: Number(direction.p50), p75: Number(direction.p75),
    rarity: Number(direction.rarity) || 1,
    sample: Number(direction.sample) || 0,
    conf: direction.verified ? (evidenceConfidence[direction.evidence] || '待复核') : '未核验',
    verified: Boolean(direction.verified)
  }
}

// 简化综合所得税率表（原型演示口径）
export function bracketTax(w) {
  if (w <= 3.6) return 0.03
  if (w <= 14.4) return 0.10
  if (w <= 30) return 0.20
  if (w <= 42) return 0.25
  if (w <= 66) return 0.30
  if (w <= 96) return 0.35
  return 0.45
}

export function optionMetrics(inp, taxMode) {
  const { n, k, v0yi, shares, dil, vest, lq, p, mI, mA } = inp
  const N = n * 10000
  const V0 = v0yi * 1e8 / (shares * 10000)
  const Naft = N * (1 - dil / 100)
  const q = { ...p }
  const sum = q.ipo + q.acq + q.hold + q.fail
  ;['ipo', 'acq', 'hold', 'fail'].forEach(key => (q[key] /= sum))
  const scenario = (mult) => {
    const Vex = V0 * mult
    const gross = Math.max(0, (Vex - k) * Naft)
    let tax
    if (taxMode) tax = 0.2 * gross
    else {
      const spread = Math.max(0, (V0 - k) * Naft)
      tax = spread * bracketTax(spread / 10000) + Math.max(0, (Vex - V0) * Naft) * 0.2
    }
    return Math.max(0, gross - tax)
  }
  const expected = (mi, ma) => q.ipo * scenario(mi) + q.acq * scenario(ma)
  const mid = expected(mI, mA)
  const w = v => Math.round(v / 10000)
  return {
    cons: w(expected(mI * 0.5, mA * 0.6)),
    mid: w(mid),
    opt: w(expected(mI * 1.7, mA * 1.4)),
    equiv: w(mid / vest * lq),
    sens: mid > 0 ? Math.round((expected(mI * 2, mA) - mid) / mid * 100) : 0
  }
}

export function optionSensitivity(inp, taxMode) {
  const { n, k, v0yi, shares, dil, p, mA } = inp
  const N = n * 10000
  const V0 = v0yi * 1e8 / (shares * 10000)
  const Naft = N * (1 - dil / 100)
  const q = { ...p }
  const sum = q.ipo + q.acq + q.hold + q.fail
  ;['ipo', 'acq', 'hold', 'fail'].forEach(key => (q[key] /= sum))
  const scenario = (mult) => {
    const Vex = V0 * mult
    const gross = Math.max(0, (Vex - k) * Naft)
    let tax
    if (taxMode) tax = 0.2 * gross
    else {
      const spread = Math.max(0, (V0 - k) * Naft)
      tax = spread * bracketTax(spread / 10000) + Math.max(0, (Vex - V0) * Naft) * 0.2
    }
    return Math.max(0, gross - tax)
  }
  const pts = []
  for (let mi = 1; mi <= 8; mi += 0.5) {
    pts.push({ label: (mi % 1 === 0 ? mi : mi.toFixed(1)) + 'x', value: Math.round((q.ipo * scenario(mi) + q.acq * scenario(mA)) / 10000) })
  }
  return pts
}
