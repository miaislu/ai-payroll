// 对标数据表（v0.2 已按 benchmark-data/benchmark-dataset.json 真实数据校准）
// 校准依据：《集成电路行业人才洞察报告2024》/上市公司年报（概伦/长电/中芯）/猎聘·脉脉·拉勾职位区间
// 关键修正：模拟IC 58→50（偏高10-20%）；工艺45→36、设备40→32、封装44→36（原型明显高估）；
// 趋势按 2024 分化：工艺/设备↑，模拟/数字前后端/测试/软件↓
// 注意：审批/薪酬单等流程演示页数字为独立演示口径，与对标校准值不构成绑定
export const DIRECTIONS = {
  '模拟IC设计': { p50: 50, rarity: 1.15, sample: 137, trend: '-1.5%' },
  '数字前端(RTL)': { p50: 52, rarity: 1.00, sample: 210, trend: '-2.0%' },
  '数字验证': { p50: 50, rarity: 1.00, sample: 240, trend: '-1.8%' },
  '数字后端': { p50: 50, rarity: 1.05, sample: 120, trend: '-2.5%' },
  '版图设计': { p50: 38, rarity: 1.00, sample: 150, trend: '-0.5%' },
  '工艺工程师(光刻)': { p50: 36, rarity: 1.10, sample: 90, trend: '+5.2%' },
  '工艺整合PIE': { p50: 40, rarity: 1.10, sample: 75, trend: '+4.5%' },
  '设备工程师': { p50: 32, rarity: 1.00, sample: 110, trend: '+7.5%' },
  '器件/TCAD': { p50: 45, rarity: 1.10, sample: 60, trend: '+2.0%' },
  'EDA研发': { p50: 50, rarity: 1.20, sample: 55, trend: '+3.5%' },
  '芯片测试ATE': { p50: 40, rarity: 1.00, sample: 130, trend: '-1.2%' },
  '封装(先进封装)': { p50: 36, rarity: 1.10, sample: 85, trend: '+3.0%' },
  '芯片固件/驱动': { p50: 38, rarity: 1.00, sample: 160, trend: '-2.0%' }
}
export const CITIES = { 上海: 1.0, 北京: 1.06, 深圳: 1.0, 苏州: 0.90, 无锡: 0.86, 合肥: 0.84, 武汉: 0.86, 成都: 0.85, 西安: 0.82, 杭州: 0.97, 南京: 0.95, 广州: 0.95, 厦门: 0.90 }
export const EXPS = { '1-3年': 0.58, '3-5年': 1.0, '5-8年': 1.36, '8-10年': 1.62, '10年以上': 1.90 }
export const TYPES = { Fabless: 1.0, 晶圆厂: 0.93, IDM: 0.90, 设备材料: 0.95, 封测: 0.82, EDA: 1.08, 初创: 0.90 }
export const STAGES = { 天使轮: 0.25, A轮: 0.35, B轮: 0.45, 'C轮+': 0.55, 已上市: 0.10 }
export const TREND_LABELS = ['7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月', '4月', '5月', '6月']

export const PAGES = {
  dashboard: ['工作台', '创始人视角 · 员工/招聘/成本一屏总览'],
  // 招聘管理（重点模块）
  recruiting: ['招聘总览', '漏斗 · 周期 · 成本 · 进行中需求'],
  candidates: ['候选人管线', 'Kanban 看板 · 阶段流转 · Offer'],
  requisitions: ['招聘需求', '编制 · 预算区间 · 状态管理'],
  interviews: ['面试记录', '轮次 · 面试官 · 评分'],
  channels: ['渠道与成本', '渠道效果 · 费用 · 人均招聘成本'],
  // 员工管理
  employees: ['员工档案', 'HR/创始人 · 员工档案 CRUD + 入转调离'],
  'employee-profile': ['员工完整档案', '基本信息 / 联系 / 紧急联系人 / 教育 / 工作经历 / 家庭 / 合同社保'],
  org: ['组织架构', '部门树 · 编制 vs 实际'],
  // 薪酬
  payroll: ['算薪工作台', 'HR 视角 · 2025-06 核算'],
  benchmark: ['对标与带宽', 'HR 视角 · 招聘定薪与带宽管理'],
  option: ['期权模拟', '创始人/HR · 期权估值模拟'],
  equity: ['期权授予台账', '期权池 · 授予记录 · 摊销联动成本预测'],
  payslip: ['员工薪酬单', '员工视角 · 仅本人数据'],
  // 薪酬成本（重点模块）
  cost: ['成本总览', '公司口径薪酬成本 · 部门×类别构成'],
  budget: ['预算对比', '预算 vs 实际 · 部门×成本类别'],
  forecast: ['成本预测', '编制计划 → 未来 6 个月成本'],
  // 其他
  copilot: ['AI 助手', '制度 + 政策 + 招聘/成本知识问答'],
  approvals: ['审批中心', '流程与审批 · F1/F2/F4/F5'],
  'band-approval': ['带宽审批', 'F1 流程 · 2025 下半年带宽刷新'],
  'raise-approval': ['调薪审批', 'F4 流程 · 王** 调薪申请'],
  'offer-approval': ['Offer 审批', 'F2 流程 · 周* Offer 建议'],
  settings: ['知识库 / 设置', '管理员视角 · 治理与数据源']
}
export const ROLE_VIEWS = {
  founder: ['dashboard', 'recruiting', 'candidates', 'requisitions', 'interviews', 'channels', 'employees', 'employee-profile', 'org', 'payroll', 'benchmark', 'option', 'equity', 'cost', 'budget', 'forecast', 'copilot', 'approvals', 'band-approval', 'raise-approval', 'offer-approval', 'settings'],
  hr: ['dashboard', 'recruiting', 'candidates', 'requisitions', 'interviews', 'channels', 'employees', 'employee-profile', 'org', 'payroll', 'benchmark', 'option', 'equity', 'cost', 'budget', 'forecast', 'copilot', 'approvals', 'band-approval', 'raise-approval', 'offer-approval', 'settings'],
  emp: ['dashboard', 'copilot', 'payslip']
}
export const PARENT = { 'band-approval': 'approvals', 'raise-approval': 'approvals', 'offer-approval': 'approvals', 'employee-profile': 'employees' }
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
  { group: '薪酬与期权' },
  { page: 'payroll', ico: '🧮', label: '算薪工作台' },
  { page: 'benchmark', ico: '🎯', label: '对标与带宽' },
  { page: 'option', ico: '📈', label: '期权模拟' },
  { page: 'equity', ico: '📜', label: '期权授予台账' },
  { page: 'payslip', ico: '🧾', label: '员工薪酬单' },
  { group: '薪酬成本' },
  { page: 'cost', ico: '💰', label: '成本总览' },
  { page: 'budget', ico: '📊', label: '预算对比' },
  { page: 'forecast', ico: '🔮', label: '成本预测' },
  { group: '协同' },
  { page: 'approvals', ico: '✅', label: '审批中心', badge: true },
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
export const INITIAL_APPROVALS = [
  { id: 'A-101', type: 'band', title: '带宽刷新 · 模拟IC设计（上海 3-5年）', who: 'HR 李明 · 06-16 10:20', key: 'P50 58万 → 62万（+6.9%）', summary: 'AI 草稿 · 样本137 · 稀缺性1.15', status: 'pending', page: 'band-approval' },
  { id: 'A-102', type: 'raise', title: '调薪申请 · 王**（模拟IC设计 P5）', who: 'CTO 陈** · 06-16 09:40', key: '建议 +12%（58万 → 65万）', summary: 'P18 分位 + 绩效 S + 留才预警', status: 'pending', page: 'raise-approval' },
  { id: 'A-103', type: 'option', title: '期权授予 · 李**（EDA 工具 P5）', who: 'HR 李明 · 06-15 17:30', key: '授予 0.3% · B轮估值', summary: '等值现金 ≈ 12万/年（4年归属）', status: 'pending', page: 'option' },
  { id: 'A-104', type: 'offer', title: 'Offer 建议 · 周*（数字后端 P6）', who: 'HR 李明 · 06-15 15:10', key: '总包 95万（现金68+期权27）', summary: '带宽 P72 · HBM 接口稀缺技能', status: 'pending', page: 'offer-approval' },
  { id: 'A-105', type: 'raise', title: '调薪申请 · 郑*（版图设计 P4）', who: 'CTO 陈** · 06-14 11:00', key: '+8% · 已通过', summary: '带宽内 · 影响可控', status: 'approved', page: 'raise-approval' }
]

// Copilot 知识库（种子版，来源于附录 E 政策口径）
export const KB = [
  { k: ['试用期', '社保'], a: '按制度第 3 条：试用期工资 ≥ 转正工资的 80% 且不低于当地最低工资。\n深圳 2025 社保基数下限 ¥6,120/月，个人比例：养老 8%、医疗 2%、失业 0.3%、公积金 5%-12%（公司选定 7%）。\n试用期按实际工资申报缴费。', s: '来源：薪酬制度 v3.2 P3 · 深圳市社保局 2025 缴费基数通知' },
  { k: ['加班'], a: '工作日加班：1.5 倍；休息日加班：2 倍（可调休）；法定节假日：3 倍。\n加班基数 = 基本工资 ÷ 21.75 天。', s: '来源：《劳动法》第 44 条 · 公司加班管理制度 v2.1' },
  { k: ['递延', '101号', '期权'], a: '非上市公司股权激励符合财税〔2016〕101 号可递延纳税：行权时不征税，转让时按"财产转让所得" 20% 缴纳。\n条件：激励计划备案、期权池设立、员工真实行权、持股平台合规等。', s: '来源：财税〔2016〕101 号 · 政策库 #45' },
  { k: ['补贴', '人才'], a: '各地半导体人才政策差异大，常见：落户（上海/深圳/苏州）、购房补贴（无锡 20-50 万）、个税返还（合肥/成都）、一次性安家费。\n建议按员工所在城市检索政策库，可自动生成申报材料。', s: '来源：政策知识库 · 人才补贴类 23 条' },
  { k: ['税', '个税'], a: '个税 = 累计预扣法。2025 年专项附加扣除：子女教育 2000/月、住房贷款 1000/月、赡养老人 3000/月（独生子女）等。\n示例：张三（月薪 25K，社保公积金 3950）个税 ≈ 2,310 元。', s: '来源：个人所得税法 · 国家税务总局 2025 年专项附加扣除公告' },
  { k: ['离职', '结算'], a: '离职结算：当月工资 + 未休年假折算 + 经济补偿（N：每满一年一个月工资；违法解除 N×2）。\n社保：离职当月由公司缴纳，次月起停缴。', s: '来源：《劳动合同法》第 46-47 条 · 离职结算制度 v1.5' }
]
