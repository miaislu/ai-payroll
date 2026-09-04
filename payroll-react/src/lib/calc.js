// 期权情景模拟的纯计算逻辑；输入概率和倍数均由用户显式提供。

// 简化综合所得税率表（无速算扣除，原型演示口径）
export function bracketTax(w) {
  if (w <= 3.6) return 0.03
  if (w <= 14.4) return 0.10
  if (w <= 30) return 0.20
  if (w <= 42) return 0.25
  if (w <= 66) return 0.30
  if (w <= 96) return 0.35
  return 0.45
}

// 期权模拟（附录 E）：返回保守/中性/乐观/等值现金/敏感性
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
    if (taxMode) {
      tax = 0.2 * gross
    } else {
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

// 敏感性曲线：中性期权价值 vs IPO 退出倍数 1x-8x
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
