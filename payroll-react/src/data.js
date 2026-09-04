// 岗位与城市仅作为录入词典；薪酬数字必须来自后端已导入、已审批的带宽。
export const DIRECTIONS = Object.fromEntries([
  '模拟IC设计', '数字前端(RTL)', '数字验证', '数字后端', '版图设计', '工艺工程师(光刻)',
  '工艺整合PIE', '设备工程师', '器件/TCAD', 'EDA研发', '芯片测试ATE', '封装(先进封装)', '芯片固件/驱动'
].map(name => [name, true]))
export const CITIES = Object.fromEntries(['上海', '北京', '深圳', '苏州', '无锡', '合肥', '武汉', '成都', '西安', '杭州', '南京', '广州', '厦门'].map(name => [name, true]))

export const PAGES = {
  dashboard: ['工作台', '小公司人力 · 员工 / 招聘 / 审批 / 成本'],
  recruiting: ['招聘总览', '漏斗 · 周期 · 成本 · 进行中需求'],
  candidates: ['候选人管线', 'Kanban 看板 · 阶段流转 · Offer'],
  requisitions: ['招聘需求', '编制 · 预算区间 · 状态管理'],
  interviews: ['面试记录', '轮次 · 面试官 · 评分'],
  channels: ['渠道与成本', '渠道效果 · 费用 · 人均招聘成本'],
  employees: ['员工档案', '档案 CRUD · 入转调离'],
  'employee-profile': ['员工完整档案', '基本信息 / 联系 / 紧急联系人 / 教育 / 工作经历 / 家庭 / 合同社保'],
  org: ['组织架构', '部门树 · 编制 vs 实际'],
  attendance: ['考勤加班', '工作日 1.5 倍 / 休息日 2 倍 / 法定假 3 倍，写入未提交算薪'],
  performance: ['绩效评级', '周期评级 · 按 S/A/B 发起调薪审批'],
  payroll: ['算薪工作台', '累计预扣 · 财务或 CEO 锁定月结'],
  benchmark: ['对标与带宽', '招聘定薪与带宽管理'],
  option: ['期权模拟', '期权估值模拟'],
  equity: ['期权授予台账', '期权池 · 授予记录 · 摊销联动成本'],
  payslip: ['员工薪酬单', '仅本人数据'],
  cost: ['成本总览', '公司口径人力成本 · 部门×类别构成'],
  budget: ['预算对比', '预算 vs 实际 · 部门×成本类别'],
  forecast: ['成本预测', '编制计划 → 未来 6 个月成本'],
  copilot: ['AI 助手', '制度 · 政策 · 人事口径问答'],
  expenses: ['报销与预支', '员工报销 · 预支 · 财务/CEO 审批 · 核销'],
  approvals: ['审批中心', '带宽 HR/CEO · 发钱类财务/CEO'],
  'band-approval': ['带宽审批', '导入样本草稿 · HR 或 CEO 固化'],
  'raise-approval': ['调薪审批', '绩效或留才 · 财务或 CEO 生效'],
  'offer-approval': ['Offer 审批', '候选人 Offer · 财务或 CEO'],
  'option-approval': ['期权审批', '授予台账 · 财务或 CEO 写入'],
  settings: ['知识库 / 设置', '账号（CEO）· 对标导入 · 审计']
}
export const ROLE_VIEWS = {
  founder: ['dashboard', 'recruiting', 'candidates', 'requisitions', 'interviews', 'channels', 'employees', 'employee-profile', 'org', 'attendance', 'performance', 'payroll', 'benchmark', 'option', 'equity', 'cost', 'budget', 'forecast', 'copilot', 'expenses', 'approvals', 'band-approval', 'raise-approval', 'offer-approval', 'option-approval', 'settings'],
  hr: ['dashboard', 'recruiting', 'candidates', 'requisitions', 'interviews', 'channels', 'employees', 'employee-profile', 'org', 'attendance', 'performance', 'payroll', 'benchmark', 'option', 'equity', 'cost', 'budget', 'forecast', 'copilot', 'expenses', 'approvals', 'band-approval', 'raise-approval', 'offer-approval', 'option-approval', 'settings'],
  finance: ['dashboard', 'org', 'attendance', 'payroll', 'option', 'equity', 'cost', 'budget', 'forecast', 'copilot', 'expenses', 'approvals', 'raise-approval', 'offer-approval', 'option-approval'],
  emp: ['dashboard', 'copilot', 'payslip', 'expenses', 'attendance', 'performance']
}
/** 带宽：HR/CEO；调薪/期权/Offer：财务/CEO。CEO 均可。 */
export const MONEY_APPROVAL_TYPES = ['raise', 'option', 'offer']
export const CAN_APPROVE = (role, type) => {
  if (role === 'founder') return true
  if (type === 'band') return role === 'hr'
  if (MONEY_APPROVAL_TYPES.includes(type)) return role === 'finance'
  return false
}
export const CAN_FINANCE = role => role === 'finance' || role === 'founder'
export const CAN_OPS = role => role === 'hr' || role === 'finance' || role === 'founder'
export const PARENT = { 'band-approval': 'approvals', 'raise-approval': 'approvals', 'offer-approval': 'approvals', 'option-approval': 'approvals', 'employee-profile': 'employees' }
export const NAV = [
  { page: 'dashboard', ico: '📊', label: '工作台' },
  { group: '招聘管理' },
  { page: 'recruiting', ico: '🎯', label: '招聘总览' },
  { page: 'candidates', ico: '📋', label: '候选人管线' },
  { page: 'requisitions', ico: '📌', label: '招聘需求' },
  { page: 'interviews', ico: '🤝', label: '面试记录' },
  { page: 'channels', ico: '📣', label: '渠道与成本' },
  { group: '员工管理' },
  { page: 'employees', ico: '👥', label: '员工档案' },
  { page: 'org', ico: '🏢', label: '组织架构' },
  { page: 'attendance', ico: '🗓️', label: '考勤加班' },
  { page: 'performance', ico: '🏅', label: '绩效评级' },
  { group: '薪酬与期权' },
  { page: 'payroll', ico: '🧮', label: '算薪工作台' },
  { page: 'benchmark', ico: '🎯', label: '对标与带宽' },
  { page: 'option', ico: '📈', label: '期权模拟' },
  { page: 'equity', ico: '📜', label: '期权授予台账' },
  { page: 'payslip', ico: '🧾', label: '员工薪酬单' },
  { group: '成本' },
  { page: 'cost', ico: '💰', label: '成本总览' },
  { page: 'budget', ico: '📊', label: '预算对比' },
  { page: 'forecast', ico: '🔮', label: '成本预测' },
  { group: '协同' },
  { page: 'approvals', ico: '✅', label: '审批中心', badge: true },
  { page: 'expenses', ico: '🧾', label: '报销与预支' },
  { page: 'copilot', ico: '💬', label: 'AI 助手' },
  { page: 'settings', ico: '⚙️', label: '知识库 / 设置' }
]

// 招聘阶段（与后端 CANDIDATE_STAGES 一致）
export const CANDIDATE_STAGES = [
  { key: 'new', label: '新简历', color: '#64748b' },
  { key: 'screening', label: '初筛', color: '#0ea5e9' },
  { key: 'interview', label: '面试', color: '#8b5cf6' },
  { key: 'offer', label: 'Offer', color: '#f59e0b' },
  { key: 'hired', label: '已入职', color: '#10b981' },
  { key: 'rejected', label: '已淘汰', color: '#ef4444' },
  { key: 'withdrawn', label: '已放弃', color: '#94a3b8' }
]
export const REQUISITION_STATUS = [
  { key: 'draft', label: '草稿' }, { key: 'open', label: '招聘中' },
  { key: 'interview', label: '面试中' }, { key: 'closed', label: '已关闭' },
  { key: 'cancelled', label: '已取消' }
]
export const COST_CATEGORY_LABELS = { salary: '应发工资', social: '公司社保', fund: '公司公积金', option: '期权摊销', recruiting: '招聘成本', other: '其他' }

export const TYPE_LABEL = { band: '带宽', raise: '调薪', option: '期权', offer: 'Offer' }
