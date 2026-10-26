export const JOB_CATALOG = {
  tech: {
    label: '技术',
    jobs: [
      '模拟IC设计', '数字前端(RTL)', '数字验证', '数字后端', '版图设计',
      '工艺工程师(光刻)', '工艺整合PIE', '设备工程师', '器件/TCAD',
      'EDA研发', '芯片测试ATE', '封装(先进封装)', '芯片固件/驱动'
    ]
  },
  mgmt: {
    label: '管理',
    jobs: ['工程管理', '研发管理', '项目管理', '生产管理', '供应链管理', '职能管理']
  },
  support: {
    label: '职能',
    jobs: ['人力资源', '财务', '行政', '法务', '市场', '销售', '采购', '质量体系', '商务', '客户支持']
  }
}

const DEFAULT_JOB_CATALOG = structuredClone(JOB_CATALOG)
export const resetJobCatalog = () => setJobCatalog(DEFAULT_JOB_CATALOG)

export function setJobCatalog(catalog) {
  for (const key of ['tech', 'mgmt', 'support']) {
    if (!Array.isArray(catalog?.[key]?.jobs) || catalog[key].jobs.some(job => typeof job !== 'string')) throw new Error('岗位词典格式不正确')
  }
  for (const key of ['tech', 'mgmt', 'support']) JOB_CATALOG[key].jobs = [...catalog[key].jobs]
}

export const categoryForJob = job => Object.entries(JOB_CATALOG).find(([, group]) => group.jobs.includes(job))?.[0] || 'tech'

export const SPECIAL_DEDUCTIONS = [
  { key: 'child_education', label: '子女教育', defaultAmount: () => 2000, note: '每名子女；夫妻可选择一方 100% 或双方各 50%' },
  { key: 'infant_care', label: '3岁以下婴幼儿照护', defaultAmount: () => 2000, note: '每名婴幼儿；夫妻可选择一方 100% 或双方各 50%' },
  { key: 'continuing_education', label: '学历（学位）继续教育', defaultAmount: () => 400, note: '最长 48 个月' },
  { key: 'serious_illness', label: '大病医疗', defaultAmount: () => 0, note: '年度汇算据实填写，不计入每月预扣', annual: true },
  { key: 'housing_loan', label: '首套住房贷款利息', defaultAmount: () => 1000, note: '与住房租金不可同时享受' },
  { key: 'housing_rent', label: '住房租金', defaultAmount: city => ['苏州', '无锡'].includes(city) ? 1100 : 1500, note: '按主要工作城市标准；与住房贷款利息不可同时享受' },
  { key: 'elderly_support', label: '赡养老人', defaultAmount: () => 3000, note: '非独生子女请改为实际分摊额，个人每月不超过 1500 元' },
  { key: 'other_declared', label: '既有已申报金额', defaultAmount: () => 0, note: '仅用于保留升级前已经录入的月度金额', legacy: true }
]

export function parseSpecialDeductions(value, fallback = 0) {
  let parsed = value
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { parsed = {} }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {}
  if (!Object.keys(parsed).length && Number(fallback) > 0) {
    parsed = { other_declared: { enabled: true, amount: Number(fallback) } }
  }
  return parsed
}

export function monthlySpecialDeductionTotal(items) {
  return SPECIAL_DEDUCTIONS.filter(def => !def.annual && items?.[def.key]?.enabled)
    .reduce((sum, def) => sum + (Number(items[def.key].amount) || 0), 0)
}
