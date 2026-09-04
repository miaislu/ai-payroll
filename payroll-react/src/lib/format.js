/** @param {number} yuan */
export function formatWan(yuan) {
  const n = Number(yuan) || 0
  return '¥' + (Math.round(n / 10000 * 10) / 10) + '万'
}

/** 整数万元（招聘渠道等） */
export function formatWanInt(yuan) {
  const n = Number(yuan) || 0
  return '¥' + (Math.round(n / 100) / 100).toFixed(0) + '万'
}

export function formatYuan(yuan) {
  return '¥' + Number(yuan || 0).toLocaleString('zh-CN')
}

/** 证件号 / 银行卡 / 手机 / 邮箱展示脱敏 */
export function maskPii(value) {
  const s = String(value || '').trim()
  if (!s) return ''
  if (/[*•]/.test(s)) return s
  if (s.includes('@')) {
    const [local, domain] = s.split('@')
    return `${(local || '').slice(0, 1)}***@${domain || ''}`
  }
  if (s.length <= 4) return '•'.repeat(s.length)
  const keepStart = s.length >= 11 ? 3 : 2
  const keepEnd = s.length >= 11 ? 4 : 2
  const hidden = Math.min(8, Math.max(2, s.length - keepStart - keepEnd))
  return s.slice(0, keepStart) + '•'.repeat(hidden) + s.slice(-keepEnd)
}
