export function changeRequisitionHeadcount(form, field, raw) {
  const value = raw === '' ? '' : Number(raw)
  const next = { ...form, [field]: value }
  if (field === 'headcount' && Number.isInteger(value) && value >= 0
    && (form.headcount_max == null || form.headcount_max === '' || Number(form.headcount_max) < value)) {
    next.headcount_max = value
  }
  return next
}

export function requisitionHeadcountError(form) {
  const valid = value => value !== '' && value != null && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 1000
  if (!valid(form.headcount)) return '基准编制须为0–1000的整数'
  if (!valid(form.headcount_max)) return '弹性上限须为0–1000的整数'
  if (Number(form.headcount_max) < Number(form.headcount)) return '弹性上限不能低于基准编制，请调整后保存'
  return ''
}
