// 城市政策参数表 v0.3（历史预览数据，正式使用前必须逐项核验）
import './env.js'
import { readFileSync } from 'node:fs'
// 数据来源：
//  - 社保基数上下限：各省市 2025 年社保缴费基数（2024 社平工资口径）汇总表
//    https://www.rz12345.com/472.html （26 省，养老/失业/工伤/医疗统一基数）
//  - 北京官方通告全文（2025.7 起 7162/35811）：http://www.hr668.com/ldbzzt/ldbzzt20250919.html
//  - 深圳特殊口径（养老 4492~27501，2024.7-2025.6 有效）：http://bsy.sz.bendibao.com/bsyDetail/636939.html
//  - 上海（社平 12434×60%/300%）：https://news.sohu.com/a/936465015_122270847
// 注意：公积金基数与最低工资按城市另行规定（多数待录）；深圳为养老口径，医疗/失业等险种另见本地宝。
export const KNOWN_CITIES = ['上海', '北京', '深圳', '苏州', '无锡', '合肥', '武汉', '成都', '西安', '杭州', '南京', '广州', '厦门']

/** 未核验城市时的估算费率；只能用于预览，不能用于正式月结。 */
export const DEFAULT_RATES = {
  personal_pension_rate: 0.08,
  personal_medical_rate: 0.02,
  personal_unemployment_rate: 0.003,
  personal_social_rate: 0.103,
  employer_social_rate: 0.26,
  personal_fund_rate: 0.07,
  employer_fund_rate: 0.07
}

let configuredCache
function configuredPolicies() {
  if (configuredCache !== undefined) return configuredCache
  const filename = String(process.env.CITY_POLICY_FILE || '').trim()
  if (!filename) return (configuredCache = [])
  let parsed
  try { parsed = JSON.parse(readFileSync(filename, 'utf8')) } catch (error) {
    throw new Error(`CITY_POLICY_FILE 无法读取或不是合法 JSON：${error.message}`)
  }
  const rows = Array.isArray(parsed) ? parsed : parsed?.policies
  if (!Array.isArray(rows) || !rows.length) throw new Error('CITY_POLICY_FILE 必须包含非空 policies 数组')
  const requiredNumbers = [
    'social_base_min', 'social_base_max', 'fund_min', 'fund_max',
    'personal_pension_rate', 'personal_medical_rate', 'personal_unemployment_rate',
    'personal_social_rate', 'employer_social_rate', 'personal_fund_rate', 'employer_fund_rate',
    'min_wage', 'local_avg_monthly_wage'
  ]
  for (const [index, row] of rows.entries()) {
    const validPeriod = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''))
    if (!row || row.verified !== true || !String(row.city || '').trim() || !validPeriod(row.effective_from) || !validPeriod(row.effective_to) || row.effective_from > row.effective_to || !String(row.source || '').trim()) {
      throw new Error(`CITY_POLICY_FILE policies[${index}] 缺少 verified=true、城市、有效期或来源`)
    }
    if (requiredNumbers.some(key => !Number.isFinite(Number(row[key])) || Number(row[key]) < 0)) throw new Error(`CITY_POLICY_FILE policies[${index}] 数值字段不完整`)
    if (Number(row.social_base_min) > Number(row.social_base_max) || Number(row.fund_min) > Number(row.fund_max)) throw new Error(`CITY_POLICY_FILE policies[${index}] 基数上下限颠倒`)
    for (const key of ['social_base_min', 'social_base_max', 'fund_min', 'fund_max', 'min_wage', 'local_avg_monthly_wage']) {
      if (Number(row[key]) <= 0) throw new Error(`CITY_POLICY_FILE policies[${index}].${key} 必须大于 0`)
    }
    for (const key of ['personal_pension_rate', 'personal_medical_rate', 'personal_unemployment_rate', 'personal_social_rate', 'employer_social_rate', 'personal_fund_rate', 'employer_fund_rate']) if (Number(row[key]) > 1) throw new Error(`CITY_POLICY_FILE policies[${index}].${key} 必须在 0-1`)
    const personalSocialParts = Number(row.personal_pension_rate) + Number(row.personal_medical_rate) + Number(row.personal_unemployment_rate)
    if (Math.abs(personalSocialParts - Number(row.personal_social_rate)) > 0.000001) {
      throw new Error(`CITY_POLICY_FILE policies[${index}] 个人养老、医疗、失业费率之和必须等于 personal_social_rate`)
    }
  }
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[i].city === rows[j].city && rows[i].effective_from <= rows[j].effective_to && rows[j].effective_from <= rows[i].effective_to) {
        throw new Error(`CITY_POLICY_FILE 中 ${rows[i].city} 存在重叠有效期`)
      }
    }
  }
  configuredCache = rows.map(row => ({ ...row, year: Number(row.year || row.effective_from.slice(0, 4)) }))
  return configuredCache
}

function capBase(amount, min, max) {
  let b = Number(amount) || 0
  if (min != null && b < min) b = min
  if (max != null && b > max) b = max
  return b
}

/**
 * 按账期读取城市政策。现有 2025 数据仅供预览，尚未包含逐险种官方费率核验，
 * 因此 verified=false；未知或过期参数绝不伪装成可用于正式月结的政策。
 */
export function getCityPolicy(city = '上海', period = null) {
  const wanted = period || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const p = [...configuredPolicies(), ...CITY_POLICIES].find(x => x.city === city && wanted >= (x.effective_from || `${x.year}-01`) && wanted <= (x.effective_to || `${x.year}-12`)) || null
  const complete = Boolean(
    p?.verified && p.social_base_min != null && p.social_base_max != null && p.fund_min != null && p.fund_max != null &&
    p.personal_pension_rate != null && p.personal_medical_rate != null && p.personal_unemployment_rate != null &&
    p.personal_social_rate != null && p.employer_social_rate != null && p.personal_fund_rate != null &&
    p.employer_fund_rate != null && p.min_wage != null && p.local_avg_monthly_wage != null
  )
  return {
    city,
    year: p?.year || Number(wanted.slice(0, 4)),
    found: Boolean(p),
    social_base_min: p?.social_base_min ?? null,
    social_base_max: p?.social_base_max ?? null,
    effective_from: p?.effective_from || (p ? `${p.year}-01` : null),
    effective_to: p?.effective_to || (p ? `${p.year}-12` : null),
    verified: Boolean(p?.verified),
    payroll_ready: complete,
    fund_min: p?.fund_min ?? null,
    fund_max: p?.fund_max ?? null,
    personal_pension_rate: p?.personal_pension_rate ?? DEFAULT_RATES.personal_pension_rate,
    personal_medical_rate: p?.personal_medical_rate ?? DEFAULT_RATES.personal_medical_rate,
    personal_unemployment_rate: p?.personal_unemployment_rate ?? DEFAULT_RATES.personal_unemployment_rate,
    personal_social_rate: p?.personal_social_rate ?? DEFAULT_RATES.personal_social_rate,
    employer_social_rate: p?.employer_social_rate ?? DEFAULT_RATES.employer_social_rate,
    personal_fund_rate: p?.personal_fund_rate ?? DEFAULT_RATES.personal_fund_rate,
    employer_fund_rate: p?.employer_fund_rate ?? DEFAULT_RATES.employer_fund_rate,
    min_wage: p?.min_wage ?? null,
    local_avg_monthly_wage: p?.local_avg_monthly_wage ?? null,
    fund_rate: p?.fund_rate ?? null,
    source: p?.source ?? null,
    note: p?.note ?? (p ? null : `该城市在 ${wanted} 没有有效政策参数；当前结果仅为估算，禁止正式月结。`)
  }
}

export function capSocialBase(amount, city = '上海', period = null) {
  const p = getCityPolicy(city, period)
  return capBase(amount, p.social_base_min, p.social_base_max)
}

export function capFundBase(amount, city = '上海', period = null) {
  const p = getCityPolicy(city, period)
  return capBase(amount, p.fund_min, p.fund_max)
}

export const CITY_POLICIES = [
  {
    city: '上海', year: 2025,
    social_base_min: 7460, social_base_max: 37302,
    fund_min: 2690, fund_max: 37302, fund_rate: '5%-7%（公司选定）', min_wage: null,
    source: 'https://www.rz12345.com/472.html · https://news.sohu.com/a/936465015_122270847',
    note: '社保下限 7460、上限 37302（社平 12434×60%/300%）已双源核实；公积金下限 2690 为 2024 口径待复核。'
  },
  {
    city: '北京', year: 2025,
    social_base_min: 7162, social_base_max: 35811,
    fund_min: null, fund_max: null, fund_rate: null, min_wage: 2420,
    source: 'http://www.hr668.com/ldbzzt/ldbzzt20250919.html（官方通告全文）· https://www.rz12345.com/472.html',
    note: '2025 年 7 月起，养老/失业/工伤/医疗（含生育）月缴费基数上限 35811、下限 7162（官方通告确认，下限由 6821 调至 7162）；公积金待录；最低工资 2420 待复核。'
  },
  {
    city: '深圳', year: 2025,
    social_base_min: 4492, social_base_max: 27501,
    fund_min: null, fund_max: null, fund_rate: null, min_wage: 2360,
    source: 'http://bsy.sz.bendibao.com/bsyDetail/636939.html',
    note: '深圳特殊口径：养老保险基数 4492~27501（2024.7-2025.6 有效，7 月起新口径待录）；医疗/生育/失业/工伤基数见本地宝分险种；最低工资 2360 待复核。'
  },
  {
    city: '广州', year: 2025,
    social_base_min: 4775, social_base_max: 27549,
    fund_min: null, fund_max: null, fund_rate: null, min_wage: null,
    source: 'https://www.rz12345.com/472.html（广东 9183/4775/27549）',
    note: '广东省全口径口径（养老/失业/工伤/医疗统一 4775~27549）；公积金与最低工资按广州另行规定待录。'
  },
  {
    city: '苏州', year: 2025,
    social_base_min: 4952, social_base_max: 24762,
    fund_min: null, fund_max: null, fund_rate: null, min_wage: null,
    source: 'https://www.rz12345.com/472.html（江苏 8254/4952/24762）',
    note: '江苏省全口径口径；公积金与最低工资按苏州另行规定待录。'
  },
  {
    city: '无锡', year: 2025,
    social_base_min: 4952, social_base_max: 24762,
    fund_min: null, fund_max: null, fund_rate: null, min_wage: null,
    source: 'https://www.rz12345.com/472.html（江苏 8254/4952/24762）',
    note: '江苏省全口径口径；公积金与最低工资按无锡另行规定待录。'
  },
  {
    city: '合肥', year: 2025,
    social_base_min: 4311, social_base_max: 21556,
    fund_min: 2060, fund_max: null, fund_rate: null, min_wage: null,
    source: 'https://www.rz12345.com/472.html（安徽 7185/4311/21556）· https://m.toutiao.com/w/1840397619055628/',
    note: '省级口径下限 4311（此前 4227 为早前/特定口径，以省级表为准）；公积金下限 2060 已核实。'
  },
  {
    city: '武汉', year: 2025,
    social_base_min: 4498, social_base_max: 22488,
    fund_min: null, fund_max: null, fund_rate: null, min_wage: null,
    source: 'https://www.rz12345.com/472.html（湖北 7496/4498/22488）',
    note: '湖北省全口径口径；公积金与最低工资按武汉另行规定待录。'
  },
  {
    city: '成都', year: 2025,
    social_base_min: 4588, social_base_max: 22938,
    fund_min: null, fund_max: null, fund_rate: null, min_wage: null,
    source: 'https://www.rz12345.com/472.html（四川 7646/4588/22938）',
    note: '四川省全口径口径；公积金与最低工资按成都另行规定待录。'
  },
  {
    city: '西安', year: 2025,
    social_base_min: 4650, social_base_max: 23250,
    fund_min: null, fund_max: null, fund_rate: null, min_wage: null,
    source: 'https://www.rz12345.com/472.html（陕西 7750/4650/23250）',
    note: '陕西省全口径口径；公积金与最低工资按西安另行规定待录。'
  },
  {
    city: '杭州', year: 2025,
    social_base_min: 4986, social_base_max: 25299,
    fund_min: null, fund_max: null, fund_rate: null, min_wage: null,
    source: 'https://www.rz12345.com/472.html（浙江 8433/4986/25299）',
    note: '浙江省全口径口径；公积金与最低工资按杭州另行规定待录。'
  },
  {
    city: '南京', year: 2025,
    social_base_min: 4952, social_base_max: 24762,
    fund_min: null, fund_max: null, fund_rate: null, min_wage: null,
    source: 'https://www.rz12345.com/472.html（江苏 8254/4952/24762）',
    note: '江苏省全口径口径；公积金与最低工资按南京另行规定待录。'
  },
  {
    city: '厦门', year: 2025,
    social_base_min: 4043, social_base_max: 22607,
    fund_min: null, fund_max: null, fund_rate: null, min_wage: null,
    source: 'https://www.rz12345.com/472.html（福建 7535/4043/22607）',
    note: '福建省全口径口径；公积金与最低工资按厦门另行规定待录。'
  }
]

// 从问题中识别城市（支持"在苏州""苏州的"等句式）
export function detectCity(question) {
  return KNOWN_CITIES.find(c => question.includes(c)) || null
}

// 构造城市政策上下文块（注入 RAG）
export function cityContext(city) {
  const p = getCityPolicy(city)
  if (!p.found) return `[城市参数] ${city}：该城市当前账期没有已收录且有效的政策参数，正式计算前需人工核验。`
  const fields = []
  if (p.social_base_min) fields.push(`社保基数下限 ${p.social_base_min} 元/月`)
  if (p.social_base_max) fields.push(`社保基数上限 ${p.social_base_max} 元/月`)
  if (p.fund_min) fields.push(`公积金下限 ${p.fund_min} 元/月`)
  if (p.fund_max) fields.push(`公积金上限 ${p.fund_max} 元/月`)
  fields.push(`个人社保 ${(p.personal_social_rate * 100).toFixed(1)}%`)
  fields.push(`公司社保 ${(p.employer_social_rate * 100).toFixed(0)}%`)
  fields.push(`公积金个人/公司 ${(p.personal_fund_rate * 100).toFixed(0)}%/${(p.employer_fund_rate * 100).toFixed(0)}%`)
  if (p.fund_rate) fields.push(`公积金政策口径 ${p.fund_rate}`)
  if (p.min_wage) fields.push(`最低工资 ${p.min_wage} 元/月`)
  const known = fields.length ? `（${fields.join('，')}）` : '（暂无数值）'
  const gap = p.note ? ` 注意：${p.note}` : ''
  const src = p.source ? ` 来源：${p.source}` : ''
  const readiness = p.payroll_ready ? '已完成正式核验' : '历史预览数据，未完成正式核验，不得直接用于申报或发薪'
  return `[城市参数] ${city} ${p.year}：${known}；${readiness}${gap}${src}`
}
