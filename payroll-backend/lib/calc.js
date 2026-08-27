// 纯计算逻辑（服务端版，与前端 lib/calc.js 保持一致）
export const CITIES = { 上海: 1.0, 北京: 1.06, 深圳: 1.0, 苏州: 0.90, 无锡: 0.86, 合肥: 0.84, 武汉: 0.86, 成都: 0.85, 西安: 0.82, 杭州: 0.97, 南京: 0.95, 广州: 0.95, 厦门: 0.90 }
export const EXPS = { '1-3年': 0.58, '3-5年': 1.0, '5-8年': 1.36, '8-10年': 1.62, '10年以上': 1.90 }
export const TYPES = { Fabless: 1.0, 晶圆厂: 0.93, IDM: 0.90, 设备材料: 0.95, 封测: 0.82, EDA: 1.08, 初创: 0.90 }
export const STAGES = { 天使轮: 0.25, A轮: 0.35, B轮: 0.45, 'C轮+': 0.55, 已上市: 0.10 }

// 带宽卡：direction 为数据库中的记录（含 p25/p50/p75/rarity/sample/trend）
export function benchmarkCard(direction, city, exp, type, stage) {
  const p50 = Math.round(direction.p50 * CITIES[city] * EXPS[exp] * TYPES[type])
  const p25 = Math.round(direction.p25 * CITIES[city] * EXPS[exp] * TYPES[type])
  const p75 = Math.round(direction.p75 * CITIES[city] * EXPS[exp] * TYPES[type])
  const total = Math.round(p50 * (1 + STAGES[stage]) * direction.rarity)
  const conf = direction.sample >= 120 ? '高' : (direction.sample >= 60 ? '中' : '低')
  return { p25, p50, p75, total, rarity: direction.rarity, trend: direction.trend, sample: direction.sample, hidden: direction.sample > 100 ? 18 : 25, conf }
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
