// 城市政策参数表 v0.3（真实数据补录完成）
// 数据来源：
//  - 社保基数上下限：各省市 2025 年社保缴费基数（2024 社平工资口径）汇总表
//    https://www.rz12345.com/472.html （26 省，养老/失业/工伤/医疗统一基数）
//  - 北京官方通告全文（2025.7 起 7162/35811）：http://www.hr668.com/ldbzzt/ldbzzt20250919.html
//  - 深圳特殊口径（养老 4492~27501，2024.7-2025.6 有效）：http://bsy.sz.bendibao.com/bsyDetail/636939.html
//  - 上海（社平 12434×60%/300%）：https://news.sohu.com/a/936465015_122270847
// 注意：公积金基数与最低工资按城市另行规定（多数待录）；深圳为养老口径，医疗/失业等险种另见本地宝。
export const KNOWN_CITIES = ['上海', '北京', '深圳', '苏州', '无锡', '合肥', '武汉', '成都', '西安', '杭州', '南京', '广州', '厦门']

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
  const p = CITY_POLICIES.find(x => x.city === city)
  if (!p) return `[城市参数] ${city}：该城市未收录政策参数，需人工核实。`
  const fields = []
  if (p.social_base_min) fields.push(`社保基数下限 ${p.social_base_min} 元/月`)
  if (p.social_base_max) fields.push(`社保基数上限 ${p.social_base_max} 元/月`)
  if (p.fund_min) fields.push(`公积金下限 ${p.fund_min} 元/月`)
  if (p.fund_max) fields.push(`公积金上限 ${p.fund_max} 元/月`)
  if (p.fund_rate) fields.push(`公积金比例 ${p.fund_rate}`)
  if (p.min_wage) fields.push(`最低工资 ${p.min_wage} 元/月`)
  const known = fields.length ? `（${fields.join('，')}）` : '（暂无数值）'
  const gap = p.note ? ` 注意：${p.note}` : ''
  const src = p.source ? ` 来源：${p.source}` : ''
  return `[城市参数] ${city} ${p.year}：${known}${gap}${src}`
}
