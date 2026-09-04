/** 证件号/银行卡是否未录入或仍为脱敏占位（含 *） */
export function isMaskedOrEmpty(value) {
  const s = String(value ?? '').trim()
  if (!s) return true
  if (s.includes('*')) return true
  if (/^x+$/i.test(s)) return true
  return false
}

export function missingExportFields(employees, type) {
  const field = type === 'bank' ? 'bank_account' : type === 'tax' ? 'id_number' : null
  if (!field) return []
  return employees.filter(e => isMaskedOrEmpty(e[field])).map(e => e.name || `#${e.id}`)
}

/**
 * 外部模型只接收经过本地规则脱敏的文本。该函数故意偏向多遮盖：
 * 宁可降低一点回答质量，也不把可识别个人或凭证发到第三方。
 */
export function redactForExternalLlm(value) {
  let text = String(value ?? '')
  const kinds = new Set()
  const replace = (pattern, label) => {
    text = text.replace(pattern, () => {
      kinds.add(label)
      return `[已脱敏:${label}]`
    })
  }
  replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '邮箱')
  replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '手机号')
  replace(/(?<![0-9A-Z])\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9X](?![0-9A-Z])/gi, '身份证号')
  replace(/(?<!\d)(?:\d[ -]?){16,19}(?!\d)/g, '银行卡号')
  replace(/\b(?:sk|api)[-_][A-Za-z0-9_-]{12,}\b/gi, '访问凭证')
  replace(/(?:姓名|员工|候选人)\s*[:：]\s*[\u4e00-\u9fff·]{2,12}/g, '姓名')
  return { text, kinds: [...kinds] }
}
