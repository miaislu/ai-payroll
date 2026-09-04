// 演示种子数据（与 schema/迁移分离，避免 db.js 膨胀）
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { db, hashPassword, migrate, DB_PATH } from './db.js'
import { computeCumulative } from './lib/payroll.js'
import { upsertCompensationTerm } from './lib/employee_terms.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const USERS = [
  { username: 'founder', password: 'admin123', role: 'founder', name: '创始人' },
  { username: 'hr', password: 'hr123', role: 'hr', name: 'HR 李明' },
  { username: 'finance', password: 'finance123', role: 'finance', name: '财务 孙*' },
  { username: 'emp', password: 'emp123', role: 'emp', name: '员工 张三' }
]

// hire_month 用于成本趋势的真实增长；leave_month 为离职结算月
// category: tech=技术岗（工程师）/ support=职能岗（HR/财务/行政等）/ mgmt=管理岗（M1+）
const EMPLOYEES = [
  // ── 技术岗 ──
  { name: '张三', grade: 'P5', job_family: '模拟IC设计', city: '上海', category: 'tech', monthly_base: 25000, perf_ratio: 0.32, ot_amount: 0, flag: '社保基数调整', hire_month: '2025-01', special_deduction: 3000 },
  { name: '李四', grade: 'P4', job_family: '数字前端(RTL)', city: '上海', category: 'tech', monthly_base: 18000, perf_ratio: 0.30, ot_amount: 4200, flag: '转正生效', hire_month: '2025-01' },
  { name: '王五', grade: 'P6', job_family: '模拟IC设计', city: '上海', category: 'tech', monthly_base: 45000, perf_ratio: 0.30, ot_amount: 0, status: 'departed', leave_month: '2025-06', hire_month: '2025-01', flag: '离职结算' },
  { name: '赵六', grade: 'P4', job_family: '数字后端', city: '深圳', category: 'tech', monthly_base: 19000, perf_ratio: 0.30, ot_amount: 3200, flag: '加班费存疑', hire_month: '2025-01' },
  { name: '王**', grade: 'P5', job_family: '模拟IC设计', city: '上海', category: 'tech', monthly_base: 48333, perf_ratio: 0.30, ot_amount: 0, flag: '留才预警', hire_month: '2025-02' },
  { name: '李**', grade: 'P5', job_family: 'EDA研发', city: '上海', category: 'tech', monthly_base: 45000, perf_ratio: 0.30, ot_amount: 0, hire_month: '2025-02' },
  { name: '郑*', grade: 'P4', job_family: '版图设计', city: '上海', category: 'tech', monthly_base: 30000, perf_ratio: 0.30, ot_amount: 0, hire_month: '2025-03' },
  { name: '陈七', grade: 'P4', job_family: '数字验证', city: '苏州', category: 'tech', monthly_base: 22000, perf_ratio: 0.30, ot_amount: 0, hire_month: '2025-03', leave_month: '2025-08' }, // 计划离职（待离职）
  { name: '吴八', grade: 'P5', job_family: '工艺工程师(光刻)', city: '无锡', category: 'tech', monthly_base: 26000, perf_ratio: 0.30, ot_amount: 0, hire_month: '2025-04' },
  { name: '林九', grade: 'P4', job_family: '芯片测试ATE', city: '合肥', category: 'tech', monthly_base: 21000, perf_ratio: 0.30, ot_amount: 0, hire_month: '2025-05' },
  // ── 职能岗 ──
  { name: '孙财务', grade: 'P4', job_family: '财务', city: '上海', category: 'support', monthly_base: 16000, perf_ratio: 0.25, ot_amount: 0, hire_month: '2025-01' },
  { name: '周HR', grade: 'P4', job_family: '人力资源', city: '上海', category: 'support', monthly_base: 14000, perf_ratio: 0.25, ot_amount: 0, hire_month: '2025-02' },
  { name: '吴行政', grade: 'P4', job_family: '行政', city: '上海', category: 'support', monthly_base: 12000, perf_ratio: 0.20, ot_amount: 0, hire_month: '2025-03' },
  // ── 管理岗 ──
  { name: '钱经理', grade: 'M1', job_family: '工程管理', city: '上海', category: 'mgmt', monthly_base: 55000, perf_ratio: 0.30, ot_amount: 0, hire_month: '2025-01' },
  // ── 招聘管线（发offer未入职 / 待入职）──
  { name: '周OFFER1', grade: 'P5', job_family: '数字后端', city: '上海', category: 'tech', status: 'offer', monthly_base: 40000, perf_ratio: 0.30, ot_amount: 0, hire_month: '2025-07' },
  { name: '周OFFER2', grade: 'P4', job_family: '芯片测试ATE', city: '合肥', category: 'tech', status: 'offer', monthly_base: 22000, perf_ratio: 0.30, ot_amount: 0, hire_month: '2025-08' },
  // ── 顾问 / 实习生（劳务报酬 & 无社保口径演示）──
  { name: '顾工·顾问', grade: 'P6', job_family: '模拟IC设计', city: '上海', category: 'tech', employment_type: 'consultant', monthly_base: 30000, perf_ratio: 0, ot_amount: 0, hire_month: '2025-04' },
  { name: '小陈·实习', grade: 'P4', job_family: '数字验证', city: '上海', category: 'tech', employment_type: 'intern', monthly_base: 8000, perf_ratio: 0, ot_amount: 0, hire_month: '2025-06' }
]

const APPROVALS = [
  { id: 'A-101', type: 'band', title: '带宽刷新 · 模拟IC设计（上海 3-5年）', who: 'HR 李明 · 06-16 10:20', key: 'P50 50万 → 55万（+10%）', summary: '导入样本草稿 · 上海 3-5年', page: 'band-approval', payload: { kind: 'band', direction: '模拟IC设计', city: '上海', exp: '3-5年', from: { p25: 42, p50: 50, p75: 62 }, to: { p25: 45, p50: 55, p75: 68 }, sample: 20, source: 'import:seed' } },
  { id: 'A-102', type: 'raise', title: '调薪申请 · 王**（模拟IC设计 P5）', who: 'CTO 陈** · 06-16 09:40', key: '建议 +12%（58万 → 65万）', summary: 'P18 分位 + 绩效 S + 留才预警', page: 'raise-approval', payload: { kind: 'raise', employee_id: 5, from_monthly: 48333, to_monthly: 54167, option_share_count: 0, rating: 'S', note: '绩效 S + 留才预警' } },
  { id: 'A-103', type: 'option', title: '期权授予 · 李**（EDA 工具 P5）', who: 'HR 李明 · 06-15 17:30', key: '授予 3 万股 · B轮估值', summary: '等值现金 ≈ 12万/年（4年归属）', page: 'option-approval', payload: { kind: 'option', employee_id: 6, share_count: 3, exercise_price: 1, fair_value: 50, vesting_months: 48, cliff_months: 12, note: 'EDA 核心加授' } },
  { id: 'A-104', type: 'offer', title: 'Offer 建议 · 吴敏（数字前端 P5）', who: 'HR 李明 · 06-15 15:10', key: '月薪 58,000', summary: '候选人管线 Offer 待审', page: 'offer-approval', payload: { kind: 'offer', candidate_id: 2 } },
  { id: 'A-105', type: 'raise', title: '调薪申请 · 郑*（版图设计 P4）', who: 'CTO 陈** · 06-14 11:00', key: '+8% · 已通过', summary: '带宽内 · 影响可控', status: 'approved', page: 'raise-approval', payload: { kind: 'raise', employee_id: 7, from_monthly: 30000, to_monthly: 32400, option_share_count: 0, rating: 'A', note: '已通过（种子不回放落库）' } }
]

const DIR_MAP = {
  '模拟IC设计工程师': '模拟IC设计', '数字IC前端工程师': '数字前端(RTL)', '数字验证工程师': '数字验证',
  '数字后端工程师': '数字后端', '版图设计工程师': '版图设计', '工艺工程师': '工艺工程师(光刻)',
  '工艺整合PIE': '工艺整合PIE', '设备工程师': '设备工程师', 'EDA研发工程师': 'EDA研发',
  '芯片测试工程师': '芯片测试ATE', '封装工程师': '封装(先进封装)', '器件工程师': '器件/TCAD',
  '芯片固件/嵌入式': '芯片固件/驱动'
}

// ── v2 种子：组织架构 / 招聘 / 成本（半导体初创场景）──
const DEPARTMENTS = [
  { name: '芯片设计部', parent_id: null, head: 'CTO 陈**', budget_owner: 'CEO' },
  { name: '工艺与制造部', parent_id: null, head: 'VP 制造 刘**', budget_owner: 'CEO' },
  { name: '市场与销售部', parent_id: null, head: 'VP 销售 马**', budget_owner: 'CEO' },
  { name: '职能部', parent_id: null, head: 'HR 李明', budget_owner: 'COO' },
  { name: '数字前端组', parent_id: 1, head: '经理 钱经理', budget_owner: 'CTO 陈**' },
  { name: '模拟设计组', parent_id: 1, head: '首席 王**', budget_owner: 'CTO 陈**' },
  { name: '验证与测试组', parent_id: 1, head: '经理 郑*', budget_owner: 'CTO 陈**' }
]

const REQUISITIONS = [
  { title: '数字前端(RTL)工程师', department_id: 5, job_family: '数字前端(RTL)', grade: 'P5', city: '上海', headcount: 2, priority: 'high', status: 'open', salary_min: 45000, salary_max: 58000, reason: 'HBM 接口项目扩张，2025-Q4 需到岗 2 人', created_by: 'HR 李明', created_at: '2025-06-01', closed_at: null },
  { title: '模拟IC设计工程师（资深）', department_id: 6, job_family: '模拟IC设计', grade: 'P6', city: '上海', headcount: 1, priority: 'high', status: 'open', salary_min: 58000, salary_max: 75000, reason: '高速 SerDes 方向，稀缺技能，对标带宽 P72', created_by: 'CTO 陈**', created_at: '2025-06-05', closed_at: null },
  { title: '芯片测试ATE工程师', department_id: 7, job_family: '芯片测试ATE', grade: 'P4', city: '合肥', headcount: 1, priority: 'normal', status: 'interview', salary_min: 18000, salary_max: 24000, reason: '合肥封测产线扩产', created_by: 'HR 李明', created_at: '2025-05-20', closed_at: null },
  { title: '版图设计工程师', department_id: 6, job_family: '版图设计', grade: 'P4', city: '苏州', headcount: 1, priority: 'normal', status: 'closed', salary_min: 22000, salary_max: 30000, reason: '已到岗（郑*）', created_by: 'HR 李明', created_at: '2025-04-10', closed_at: '2025-06-15' },
  { title: '设备工程师（光刻）', department_id: 2, job_family: '设备工程师', grade: 'P4', city: '无锡', headcount: 2, priority: 'normal', status: 'draft', salary_min: 20000, salary_max: 28000, reason: '无锡产线设备维护', created_by: 'VP 制造 刘**', created_at: '2025-06-18', closed_at: null }
]

const CANDIDATES = [
  { name: '陈晓', phone: '138****2211', email: 'chenxiao@mail.com', source_channel: '内推', requisition_id: 1, stage: 'interview', apply_date: '2025-06-10', expected_salary: 52000, offer_amount: null, offer_date: null, onboard_date: null, eval_score: 86, reject_reason: null, created_at: '2025-06-10' },
  { name: '吴敏', phone: '139****3344', email: 'wumin@mail.com', source_channel: '猎头', requisition_id: 1, stage: 'offer', apply_date: '2025-06-12', expected_salary: 56000, offer_amount: 58000, offer_date: '2025-06-28', onboard_date: null, eval_score: 91, reject_reason: null, created_at: '2025-06-12' },
  { name: '郑凯', phone: '137****5566', email: 'zhengkai@mail.com', source_channel: 'BOSS直聘', requisition_id: 2, stage: 'hired', apply_date: '2025-06-15', expected_salary: 72000, offer_amount: 75000, offer_date: '2025-07-01', onboard_date: '2025-08-01', eval_score: 95, reject_reason: null, created_at: '2025-06-15' },
  { name: '林悦', phone: '136****7788', email: 'linyue@mail.com', source_channel: '猎聘', requisition_id: 3, stage: 'interview', apply_date: '2025-06-20', expected_salary: 22000, offer_amount: null, offer_date: null, onboard_date: null, eval_score: 82, reject_reason: null, created_at: '2025-06-20' },
  { name: '高翔', phone: '135****9900', email: 'gaoxiang@mail.com', source_channel: 'BOSS直聘', requisition_id: 1, stage: 'screening', apply_date: '2025-06-25', expected_salary: 48000, offer_amount: null, offer_date: null, onboard_date: null, eval_score: null, reject_reason: null, created_at: '2025-06-25' },
  { name: '孙倩', phone: '134****1122', email: 'sunqian@mail.com', source_channel: '校园招聘', requisition_id: 3, stage: 'new', apply_date: '2025-06-26', expected_salary: 18000, offer_amount: null, offer_date: null, onboard_date: null, eval_score: null, reject_reason: null, created_at: '2025-06-26' },
  { name: '赵磊', phone: '133****2233', email: 'zhaolei@mail.com', source_channel: '猎头', requisition_id: 2, stage: 'rejected', apply_date: '2025-06-08', expected_salary: 80000, offer_amount: null, offer_date: null, onboard_date: null, eval_score: 68, reject_reason: '期望薪资超出带宽 P90，谈判未达成', created_at: '2025-06-08' },
  { name: '刘畅', phone: '132****4455', email: 'liuchang@mail.com', source_channel: '内推', requisition_id: 1, stage: 'screening', apply_date: '2025-06-22', expected_salary: 50000, offer_amount: null, offer_date: null, onboard_date: null, eval_score: null, reject_reason: null, created_at: '2025-06-22' }
]

const INTERVIEWS = [
  { candidate_id: 1, round_no: 1, interviewer: '钱经理', interview_date: '2025-06-16', result: 'pass', score: 84, notes: 'RTL 基础扎实，HBM 经验 2 年' },
  { candidate_id: 1, round_no: 2, interviewer: 'CTO 陈**', interview_date: '2025-06-20', result: 'pass', score: 88, notes: '架构理解好，可带小团队' },
  { candidate_id: 3, round_no: 1, interviewer: '首席 王**', interview_date: '2025-06-18', result: 'pass', score: 92, notes: 'SerDes 方向 8 年，稀缺' },
  { candidate_id: 3, round_no: 2, interviewer: 'CTO 陈**', interview_date: '2025-06-24', result: 'pass', score: 97, notes: '强烈推荐，对标 P72' },
  { candidate_id: 4, round_no: 1, interviewer: '经理 郑*', interview_date: '2025-06-25', result: 'pending', score: 82, notes: 'ATE 经验 3 年，待二面' },
  { candidate_id: 7, round_no: 1, interviewer: '首席 王**', interview_date: '2025-06-12', result: 'fail', score: 68, notes: '薪资期望过高，技术匹配一般' }
]

const RECRUITING_CHANNELS = [
  { name: 'BOSS直聘', type: 'job_board', contact: '客户经理 张', note: '年费 ¥16,800，2025 续约' },
  { name: '猎聘', type: 'job_board', contact: '—', note: '按职位发布收费' },
  { name: '猎头公司（半导体组）', type: 'headhunter', contact: '顾问 周', note: '费率 22%（入职年薪），成功收费' },
  { name: '内推', type: 'employee_ref', contact: '全员', note: '内推奖金：P5+ ¥10,000 / 其他 ¥5,000' },
  { name: '校园招聘', type: 'university', contact: 'HR 李明', note: '2025 秋招，合肥/成都高校' }
]

const CHANNEL_EXPENSES = [
  { channel_id: 1, year_month: '2025-06', amount: 1400, note: 'BOSS直聘 月度推广' },
  { channel_id: 2, year_month: '2025-06', amount: 800, note: '猎聘 职位发布' },
  { channel_id: 5, year_month: '2025-06', amount: 12000, note: '合肥高校宣讲差旅' },
  { channel_id: 3, year_month: '2025-06', amount: 153120, note: '吴敏/郑凯 猎头费（22%×现金年薪）' },
  { channel_id: 4, year_month: '2025-06', amount: 10000, note: '内推奖金 郑凯' },
  { channel_id: 1, year_month: '2025-05', amount: 1400, note: 'BOSS直聘 月度推广' },
  { channel_id: 3, year_month: '2025-05', amount: 0, note: '猎头费（5 月无成功入职）' }
]

const COST_BUDGETS = [
  { year_month: '2025-06', department_id: 1, category: 'salary', amount: 680000, note: '芯片设计部 应发工资预算' },
  { year_month: '2025-06', department_id: 1, category: 'social', amount: 180000, note: '公司社保公积金' },
  { year_month: '2025-06', department_id: 2, category: 'salary', amount: 150000, note: '工艺制造部' },
  { year_month: '2025-06', department_id: 2, category: 'social', amount: 40000, note: '公司社保公积金' },
  { year_month: '2025-06', department_id: 3, category: 'salary', amount: 80000, note: '市场销售部' },
  { year_month: '2025-06', department_id: 4, category: 'salary', amount: 100000, note: '职能部' },
  { year_month: '2025-06', department_id: 4, category: 'social', amount: 26000, note: '公司社保公积金' },
  { year_month: '2025-06', department_id: null, category: 'recruiting', amount: 180000, note: '招聘渠道与猎头费预算' },
  { year_month: '2025-07', department_id: 1, category: 'salary', amount: 720000, note: '7 月含新入职 2 人' },
  { year_month: '2025-07', department_id: 1, category: 'social', amount: 190000, note: '' },
  { year_month: '2025-07', department_id: 4, category: 'salary', amount: 100000, note: '' },
  { year_month: '2025-07', department_id: null, category: 'recruiting', amount: 120000, note: '7 月招聘预算' }
]

const HEADCOUNT_PLAN = [
  { department_id: 1, year_month: '2025-06', planned: 14, note: '现有' },
  { department_id: 2, year_month: '2025-06', planned: 4, note: '现有' },
  { department_id: 3, year_month: '2025-06', planned: 3, note: '现有' },
  { department_id: 4, year_month: '2025-06', planned: 5, note: '现有' },
  { department_id: 1, year_month: '2025-07', planned: 15, note: '+1 数字前端（吴敏）' },
  { department_id: 1, year_month: '2025-08', planned: 17, note: '+1 模拟（郑凯 8-1 入职）' },
  { department_id: 1, year_month: '2025-09', planned: 18, note: '+1 数字前端' },
  { department_id: 2, year_month: '2025-09', planned: 5, note: '+1 设备工程师' },
  { department_id: 1, year_month: '2025-10', planned: 20, note: '+2 验证与测试' },
  { department_id: 1, year_month: '2025-11', planned: 21, note: '+1' },
  { department_id: 1, year_month: '2025-12', planned: 22, note: '+1' }
]

const EMPLOYEE_EVENTS = [
  { employee_id: 1, type: 'onboard', event_date: '2025-01-02', from_value: null, to_value: '模拟IC设计 P5', note: '社招入职' },
  { employee_id: 1, type: 'regularize', event_date: '2025-04-02', from_value: '试用期', to_value: '转正', note: '绩效 S，提前 1 个月转正' },
  { employee_id: 9, type: 'onboard', event_date: '2025-05-06', from_value: null, to_value: '芯片测试ATE P4', note: '合肥入职' },
  { employee_id: 14, type: 'promotion', event_date: '2025-06-01', from_value: 'P4', to_value: 'M1', note: '晋升工程管理经理' },
  { employee_id: 3, type: 'offboard', event_date: '2025-06-30', from_value: '模拟IC设计 P6', to_value: null, note: '主动离职，N+1 结算' },
  { employee_id: 5, type: 'transfer', event_date: '2025-06-15', from_value: '数字后端组', to_value: '模拟设计组', note: '内部转岗支持 SerDes' }
]

const PERIODS = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06']

function demoModeEnabled() {
  return process.env.DEMO_MODE === 'true'
}

/** 已有演示库补财务账号，并关联「孙财务」档案 */
export function ensureDemoFinanceUser() {
  if (!demoModeEnabled()) return
  if (!db.prepare("SELECT id FROM users WHERE username='hr'").get()) return
  let finance = db.prepare("SELECT id, employee_id FROM users WHERE username='finance'").get()
  if (!finance) {
    db.prepare('INSERT INTO users(username,password_hash,role,name) VALUES(?,?,?,?)')
      .run('finance', hashPassword('finance123'), 'finance', '财务 孙*')
    finance = db.prepare("SELECT id, employee_id FROM users WHERE username='finance'").get()
    console.log('[seed] 已创建演示账号 finance / finance123')
  }
  if (finance && !finance.employee_id) {
    const emp = db.prepare("SELECT id FROM employees WHERE name='孙财务'").get()
    if (emp) db.prepare('UPDATE users SET employee_id=? WHERE id=?').run(emp.id, finance.id)
  }
}

function ensureInitialAdmin() {
  const u = db.prepare('SELECT COUNT(*) c FROM users').get()
  if (u.c > 0) return
  const password = process.env.INITIAL_ADMIN_PASSWORD || ''
  if (password.length < 12) {
    throw new Error('非演示模式首次启动必须设置至少 12 位 INITIAL_ADMIN_PASSWORD')
  }
  db.prepare('INSERT INTO users(username,password_hash,role,name) VALUES(?,?,?,?)')
    .run(process.env.INITIAL_ADMIN_USERNAME || 'founder', hashPassword(password), 'founder', process.env.INITIAL_ADMIN_NAME || '创始人')
  console.log('[seed] 已创建初始 founder 管理员；未创建任何演示业务数据')
}

/**
 * 初始化数据库。默认只迁移 schema 并创建初始管理员；只有显式 DEMO_MODE=true
 * 才允许写入员工、工资、审批等演示业务数据。
 */
export function seedIfEmpty({ demo = demoModeEnabled() } = {}) {
  migrate()
  if (!demo) {
    ensureInitialAdmin()
    return
  }
  const u = db.prepare('SELECT COUNT(*) c FROM users').get()
  if (u.c === 0) {
    const insU = db.prepare('INSERT INTO users(username,password_hash,role,name) VALUES(?,?,?,?)')
    USERS.forEach(u => insU.run(u.username, hashPassword(u.password), u.role, u.name))
    const insE = db.prepare('INSERT INTO employees(name,grade,job_family,city,category,status,monthly_base,perf_ratio,ot_amount,flag,hire_month,leave_month,special_deduction,employment_type) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    EMPLOYEES.forEach(e => insE.run(e.name, e.grade, e.job_family, e.city, e.category || 'tech', e.status || 'active', e.monthly_base, e.perf_ratio, e.ot_amount, e.flag || null, e.hire_month || '2025-01', e.leave_month || null, e.special_deduction || 0, e.employment_type || 'employee'))
    const insA = db.prepare('INSERT INTO approvals(id,type,title,who,key,summary,status,page,payload_json) VALUES(?,?,?,?,?,?,?,?,?)')
    APPROVALS.forEach(a => insA.run(a.id, a.type, a.title, a.who, a.key, a.summary, a.status || 'pending', a.page, a.payload ? JSON.stringify(a.payload) : null))
  }
  const b = db.prepare('SELECT COUNT(*) c FROM benchmarks').get()
  if (b.c === 0) {
    const ds = JSON.parse(readFileSync(path.join(__dirname, '..', 'benchmark-data', 'benchmark-dataset.json'), 'utf-8'))
    const insB = db.prepare('INSERT INTO benchmarks(direction,p25,p50,p75,rarity,sample,trend,annual_months,evidence,sources,verified) VALUES(?,?,?,?,?,?,?,?,?,?,0)')
    let n = 0
    for (const e of ds.directions) {
      const short = DIR_MAP[e.direction]
      if (!short) { console.warn('跳过未映射方向:', e.direction); continue }
      insB.run(short, e.p25_wan, e.cash_p50_wan, e.p75_wan, e.rarity_factor, 0, null, e.annual_months, e.evidence, JSON.stringify(e.sources))
      n++
    }
    console.log(`[seed] benchmarks 灌库 ${n} 条`)
  }
  // ── v2 种子：部门/招聘/成本（含员工部门/期权/补充公积金归属）──
  seedV2()
  for (const employee of db.prepare('SELECT * FROM employees').all()) {
    upsertCompensationTerm(employee, employee.hire_month, { actor: 'demo-seed' })
  }
  // ── payroll 依赖归属后的员工（部门/期权/补充公积金），须在 seedV2 之后生成 ──
  const p = db.prepare('SELECT COUNT(*) c FROM payroll').get()
  if (p.c === 0) seedPayroll()

  // ── v3 种子：员工完整档案 ──
  seedV3()
  // ── v6 种子：期权台账 + 期权池 ──
  seedV6()
  // ── v8 种子：报销与预支 ──
  seedV8()
  // ── v13 种子：考勤 / 绩效 / 对标样本 / 审批 payload 回填 ──
  seedV13()
  ensureDemoFinanceUser()
}

// ── v8 种子：报销单 + 预支（参考 Frappe HR Expense Claim / Employee Advance）──
const EXPENSE_CLAIMS_SEED = [
  { employee_id: 1, expense_type: '差旅', amount: 1500, claim_date: '2025-06-10', description: '上海→深圳客户拜访高铁+住宿', status: 'approved', submitted_by: '张三', submitted_at: '2025-06-11', approver: 'HR 李明', approved_at: '2025-06-12', comment: '符合差旅标准', advance_offset: 0 },
  { employee_id: 1, expense_type: '餐饮', amount: 300, claim_date: '2025-06-20', description: '团队聚餐', status: 'submitted', submitted_by: '张三', submitted_at: '2025-06-21', advance_offset: 0 },
  { employee_id: 12, expense_type: '办公', amount: 800, claim_date: '2025-06-15', description: '办公用品采购', status: 'approved', submitted_by: '周HR', submitted_at: '2025-06-16', approver: '创始人', approved_at: '2025-06-16', comment: '', advance_offset: 0 },
  { employee_id: 14, expense_type: '招待', amount: 2000, claim_date: '2025-06-18', description: '客户商务宴请', status: 'submitted', submitted_by: '钱经理', submitted_at: '2025-06-19', advance_offset: 0 }
]
const ADVANCES_SEED = [
  { employee_id: 1, amount: 5000, reason: '出差预支差旅费', advance_date: '2025-06-05', status: 'approved', outstanding: 2000, approver: 'HR 李明', approved_at: '2025-06-05', comment: '' }
]
function seedV8() {
  if (db.prepare('SELECT COUNT(*) c FROM expense_claims').get().c === 0) {
    const ins = db.prepare('INSERT INTO expense_claims(employee_id,expense_type,amount,claim_date,description,status,submitted_by,submitted_at,approver,approved_at,comment,advance_offset) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    const N = v => v ?? null
    EXPENSE_CLAIMS_SEED.forEach(x => ins.run(x.employee_id, x.expense_type, x.amount, x.claim_date, x.description, x.status, x.submitted_by, x.submitted_at, N(x.approver), N(x.approved_at), N(x.comment), N(x.advance_offset) ?? 0))
    console.log(`[seed] v8 报销单灌库 ${EXPENSE_CLAIMS_SEED.length} 条`)
  }
  if (db.prepare('SELECT COUNT(*) c FROM employee_advances').get().c === 0) {
    const ins = db.prepare('INSERT INTO employee_advances(employee_id,amount,reason,advance_date,status,outstanding,approver,approved_at,comment) VALUES(?,?,?,?,?,?,?,?,?)')
    const N = v => v ?? null
    ADVANCES_SEED.forEach(x => ins.run(x.employee_id, x.amount, x.reason, x.advance_date, x.status, x.outstanding, N(x.approver), N(x.approved_at), N(x.comment)))
    console.log('[seed] v8 预支灌库 1 条')
  }
}

// ── v6 种子：期权池 + 授予台账（与 employees.annual_option_value 口径对齐）──
// total_value = share_count × (fair_value - exercise_price)；monthly_amort = total_value / vesting_months
const OPTION_POOL_SEED = { pool_percent: 15, total_shares: 1000, valuation_wan: 50000 } // 15% 池 · 1000 万股 · B 轮估值 5 亿
const OPTION_GRANTS_SEED = [
  // employee_id: 授予股数(万) / 行权价 / 公允价(元) / 归属期(月) / cliff / 备注
  // 年摊销 = total_value/归属年 与 annual_option_value 对齐：张三 15万/年、王** 24万/年…
  { employee_id: 1, grant_date: '2025-01-02', share_count: 1.25, exercise_price: 1.0, fair_value: 50, vesting_months: 48, cliff_months: 12, note: '核心模拟工程师 · 年度授予' },
  { employee_id: 5, grant_date: '2025-02-10', share_count: 2.0, exercise_price: 1.0, fair_value: 50, vesting_months: 48, cliff_months: 12, note: '首席模拟 · 留才绑定' },
  { employee_id: 6, grant_date: '2025-02-17', share_count: 1.65, exercise_price: 1.0, fair_value: 50, vesting_months: 48, cliff_months: 12, note: 'EDA 核心' },
  { employee_id: 14, grant_date: '2025-01-02', share_count: 1.5, exercise_price: 1.0, fair_value: 50, vesting_months: 48, cliff_months: 12, note: '工程经理' },
  { employee_id: 11, grant_date: '2025-01-02', share_count: 0.65, exercise_price: 1.0, fair_value: 50, vesting_months: 48, cliff_months: 12, note: '财务负责人' },
  { employee_id: 12, grant_date: '2025-02-10', share_count: 0.82, exercise_price: 1.0, fair_value: 50, vesting_months: 48, cliff_months: 12, note: 'HR 负责人' }
]
function seedV6() {
  const p = db.prepare('SELECT COUNT(*) c FROM option_pool').get()
  if (p.c === 0) {
    db.prepare('INSERT INTO option_pool(pool_percent,total_shares,valuation_wan,updated_at) VALUES(?,?,?,?)')
      .run(OPTION_POOL_SEED.pool_percent, OPTION_POOL_SEED.total_shares, OPTION_POOL_SEED.valuation_wan, new Date().toISOString().slice(0, 10))
  }
  const g = db.prepare('SELECT COUNT(*) c FROM option_grants').get()
  if (g.c === 0) {
    const ins = db.prepare('INSERT INTO option_grants(employee_id,grant_date,share_count,exercise_price,fair_value,vesting_months,cliff_months,total_value,monthly_amort,status,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    for (const x of OPTION_GRANTS_SEED) {
      const tv = Math.round(x.share_count * 10000 * (x.fair_value - x.exercise_price))
      const ma = Math.round(tv / x.vesting_months)
      ins.run(x.employee_id, x.grant_date, x.share_count, x.exercise_price, x.fair_value, x.vesting_months, x.cliff_months, tv, ma, 'granted', x.note)
    }
    console.log(`[seed] v6 期权池 + 授予台账灌库 ${OPTION_GRANTS_SEED.length} 条`)
  }
  // emp 账号关联员工「张三」(id=1)，founder/hr 为管理员不关联
  const empUser = db.prepare("SELECT id, employee_id FROM users WHERE username='emp'").get()
  if (empUser && !empUser.employee_id) {
    const zhang = db.prepare("SELECT id FROM employees WHERE name='张三'").get()
    if (zhang) db.prepare('UPDATE users SET employee_id=? WHERE id=?').run(zhang.id, empUser.id)
  }
  const hrUser = db.prepare("SELECT id, employee_id FROM users WHERE username='hr'").get()
  if (hrUser && !hrUser.employee_id) {
    const hrEmp = db.prepare("SELECT id FROM employees WHERE name='周HR'").get()
    if (hrEmp) db.prepare('UPDATE users SET employee_id=? WHERE id=?').run(hrEmp.id, hrUser.id)
  }
}

// ── v3 种子：员工完整档案（基础信息/联系/紧急联系人/教育/工作经历/家庭/合同社保）──
const PROFILE_BASE = [
  { id: 1, gender: '男', date_of_birth: '1991-04-12', marital_status: '已婚', nationality: '汉族', education_level: '硕士', id_number: '3101***********1234', mobile: '138****2211', personal_email: 'zhangsan@personal.com', alternate_mobile: '139****2211', current_address: '上海市浦东新区张江高科苑 5-201', permanent_address: '江苏省南京市玄武区', contract_type: '固定期限', contract_start: '2025-01-02', contract_end: '2028-01-01', probation_end: '2025-04-01', confirmation_date: '2025-04-02', social_security_no: 'SS-3101-0001', housing_fund_no: 'HF-3101-0001', bank_name: '招商银行', bank_account: '6225***********1234', skills: '模拟IC设计,SerDes,高速接口', notice_period: '30 天' },
  { id: 2, gender: '男', date_of_birth: '1994-08-23', marital_status: '未婚', nationality: '汉族', education_level: '硕士', mobile: '138****3344', current_address: '上海市闵行区', contract_type: '固定期限', contract_start: '2025-01-06', probation_end: '2025-04-05', confirmation_date: '2025-04-06', social_security_no: 'SS-3101-0002', bank_name: '工商银行', bank_account: '6222***********5678', skills: 'RTL,Verilog,低功耗设计', notice_period: '30 天' },
  { id: 5, gender: '男', date_of_birth: '1988-11-02', marital_status: '已婚', nationality: '汉族', education_level: '博士', mobile: '136****9900', current_address: '上海市浦东新区碧云路', contract_type: '无固定期限', contract_start: '2025-02-10', probation_end: '2025-05-09', confirmation_date: '2025-05-10', social_security_no: 'SS-3101-0005', bank_name: '浦发银行', bank_account: '6217***********4321', skills: '模拟IC,电源管理,BCD工艺', notice_period: '60 天' },
  { id: 6, gender: '女', date_of_birth: '1992-02-15', marital_status: '已婚', nationality: '汉族', education_level: '硕士', mobile: '135****6677', current_address: '上海市徐汇区', contract_type: '固定期限', contract_start: '2025-02-17', probation_end: '2025-05-16', confirmation_date: '2025-05-17', skills: 'EDA,PDK,时序分析', notice_period: '30 天' },
  { id: 11, gender: '女', date_of_birth: '1990-06-30', marital_status: '已婚', nationality: '汉族', education_level: '本科', mobile: '131****1122', current_address: '上海市杨浦区', contract_type: '固定期限', contract_start: '2025-01-02', probation_end: '2025-04-01', confirmation_date: '2025-04-02', skills: '财务核算,预算管理', notice_period: '30 天' },
  { id: 12, gender: '女', date_of_birth: '1995-03-08', marital_status: '未婚', nationality: '汉族', education_level: '本科', mobile: '132****3344', current_address: '上海市静安区', contract_type: '固定期限', contract_start: '2025-02-10', probation_end: '2025-05-09', confirmation_date: '2025-05-10', skills: '招聘,员工关系,薪酬', notice_period: '30 天' },
  { id: 14, gender: '男', date_of_birth: '1986-09-19', marital_status: '已婚', nationality: '汉族', education_level: '硕士', mobile: '133****5566', current_address: '上海市浦东新区花木', contract_type: '无固定期限', contract_start: '2025-01-02', probation_end: '2025-04-01', confirmation_date: '2025-04-02', social_security_no: 'SS-3101-0014', bank_name: '建设银行', bank_account: '6210***********9876', skills: '项目管理,芯片验证,团队管理', notice_period: '60 天' }
]
// 其余员工程序化补基础信息（性别/生日/手机按 id 派生，便于演示）
const GENERIC_GENDER = ['男', '女']
function seedV3() {
  const done = db.prepare("SELECT COUNT(*) c FROM employees WHERE date_of_birth IS NOT NULL").get().c
  if (done === 0) {
    const upd = db.prepare(`UPDATE employees SET gender=?, date_of_birth=?, marital_status=?, nationality=?, education_level=?,
      mobile=?, personal_email=?, current_address=?, contract_type=?, contract_start=?, probation_end=?, confirmation_date=?, notice_period=? WHERE id=?`)
    const N = v => v ?? null
    for (const p of PROFILE_BASE) {
      upd.run(N(p.gender), N(p.date_of_birth), N(p.marital_status), N(p.nationality), N(p.education_level), N(p.mobile), N(p.personal_email), N(p.current_address), N(p.contract_type), N(p.contract_start), N(p.probation_end), N(p.confirmation_date), N(p.notice_period), p.id)
      const detail = db.prepare(`UPDATE employees SET id_number=?, alternate_mobile=?, permanent_address=?, contract_end=?, social_security_no=?, housing_fund_no=?, bank_name=?, bank_account=?, skills=? WHERE id=?`)
      detail.run(N(p.id_number), N(p.alternate_mobile), N(p.permanent_address), N(p.contract_end), N(p.social_security_no), N(p.housing_fund_no), N(p.bank_name), N(p.bank_account), N(p.skills), p.id)
    }
    // 其余员工基础信息（派生）
    const rest = db.prepare('SELECT id, name FROM employees WHERE date_of_birth IS NULL').all()
    for (const e of rest) {
      const g = GENERIC_GENDER[e.id % 2]
      const y = 1987 + (e.id % 9)
      const m = 1 + (e.id % 12)
      upd.run(g, `${y}-${String(m).padStart(2, '0')}-15`, '未婚', '汉族', '本科', `13${(e.id % 10)}8****${1000 + e.id}`, `${e.name}@personal.com`, `示例市示例区路 ${e.id} 号`, '固定期限', '2025-01-02', '2025-04-01', '2025-04-02', '30 天', e.id)
    }
    console.log(`[seed] v3 员工档案基础信息灌库 ${PROFILE_BASE.length + rest.length} 条`)
  }
  seedProfileChildren()
}

// 紧急联系人 / 教育 / 工作经历 / 家庭 种子（按员工 id 配置）
const EMERGENCY_CONTACTS = [
  { employee_id: 1, name: '张母', relation: '母亲', mobile: '139****0001', address: '江苏南京', is_primary: 1 },
  { employee_id: 1, name: '李婷', relation: '配偶', mobile: '139****0002', address: '上海浦东', is_primary: 0 },
  { employee_id: 5, name: '王父', relation: '父亲', mobile: '136****0005', address: '浙江杭州', is_primary: 1 },
  { employee_id: 14, name: '钱母', relation: '母亲', mobile: '133****0014', address: '上海浦东', is_primary: 1 },
  { employee_id: 12, name: '周父', relation: '父亲', mobile: '132****0012', address: '安徽合肥', is_primary: 1 }
]
const EDUCATION = [
  { employee_id: 1, school: '东南大学', qualification: '硕士', major: '微电子学与固体电子学', graduation_year: 2016, note: '国家奖学金' },
  { employee_id: 1, school: '南京邮电大学', qualification: '本科', major: '电子科学与技术', graduation_year: 2013, note: '' },
  { employee_id: 5, school: '清华大学', qualification: '博士', major: '集成电路设计', graduation_year: 2016, note: 'SerDes 方向' },
  { employee_id: 14, school: '上海交通大学', qualification: '硕士', major: '电子与通信工程', graduation_year: 2011, note: '' },
  { employee_id: 12, school: '安徽大学', qualification: '本科', major: '人力资源管理', graduation_year: 2017, note: '' },
  { employee_id: 11, school: '上海财经大学', qualification: '本科', major: '会计学', graduation_year: 2012, note: 'CPA 在考' }
]
const WORK_EXPERIENCE = [
  { employee_id: 1, company: '某通信芯片公司', title: '高级模拟工程师', start_date: '2016-07', end_date: '2024-12', note: 'SerDes PHY 团队' },
  { employee_id: 5, company: '某 IDM 大厂', title: '模拟设计专家', start_date: '2016-07', end_date: '2025-01', note: '电源管理方向' },
  { employee_id: 14, company: '某 EDA 公司', title: '验证经理', start_date: '2011-07', end_date: '2024-12', note: '芯片验证团队' },
  { employee_id: 11, company: '某会计师事务所', title: '高级审计', start_date: '2012-07', end_date: '2024-12', note: '' }
]
const FAMILY = [
  { employee_id: 1, name: '张一', relation: '儿子', note: '2019 年生' },
  { employee_id: 5, name: '王二', relation: '女儿', note: '2021 年生' },
  { employee_id: 14, name: '钱三', relation: '儿子', note: '2015 年生' }
]
function seedProfileChildren() {
  const c = db.prepare('SELECT COUNT(*) c FROM emergency_contacts').get().c
  if (c > 0) return
  const insEc = db.prepare('INSERT INTO emergency_contacts(employee_id,name,relation,mobile,address,is_primary) VALUES(?,?,?,?,?,?)')
  EMERGENCY_CONTACTS.forEach(x => insEc.run(x.employee_id, x.name, x.relation, x.mobile, x.address, x.is_primary))
  const insEd = db.prepare('INSERT INTO employee_education(employee_id,school,qualification,major,graduation_year,note) VALUES(?,?,?,?,?,?)')
  EDUCATION.forEach(x => insEd.run(x.employee_id, x.school, x.qualification, x.major, x.graduation_year, x.note))
  const insW = db.prepare('INSERT INTO employee_work_experience(employee_id,company,title,start_date,end_date,note) VALUES(?,?,?,?,?,?)')
  WORK_EXPERIENCE.forEach(x => insW.run(x.employee_id, x.company, x.title, x.start_date, x.end_date, x.note))
  const insF = db.prepare('INSERT INTO employee_family(employee_id,name,relation,note) VALUES(?,?,?,?)')
  FAMILY.forEach(x => insF.run(x.employee_id, x.name, x.relation, x.note))
  console.log('[seed] v3 紧急联系人/教育/工作经历/家庭 灌库完成')
}

function seedV2() {
  // 每张表独立判断是否为空，避免部分清空后重启不补种
  const empty = table => db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c === 0
  if (empty('departments')) {
    const insD = db.prepare('INSERT INTO departments(name,parent_id,head,budget_owner) VALUES(?,?,?,?)')
    DEPARTMENTS.forEach(d => insD.run(d.name, d.parent_id, d.head, d.budget_owner))
  }
  if (empty('job_requisitions')) {
    const insR = db.prepare('INSERT INTO job_requisitions(title,department_id,job_family,grade,city,headcount,priority,status,salary_min,salary_max,reason,created_by,created_at,closed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    REQUISITIONS.forEach(r => insR.run(r.title, r.department_id, r.job_family, r.grade, r.city, r.headcount, r.priority, r.status, r.salary_min, r.salary_max, r.reason, r.created_by, r.created_at, r.closed_at))
  }
  if (empty('candidates')) {
    const insC = db.prepare('INSERT INTO candidates(name,phone,email,source_channel,requisition_id,stage,apply_date,expected_salary,offer_amount,offer_date,onboard_date,eval_score,reject_reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    CANDIDATES.forEach(c => insC.run(c.name, c.phone, c.email, c.source_channel, c.requisition_id, c.stage, c.apply_date, c.expected_salary, c.offer_amount, c.offer_date, c.onboard_date, c.eval_score, c.reject_reason, c.created_at))
  }
  if (empty('interviews')) {
    const insI = db.prepare('INSERT INTO interviews(candidate_id,round_no,interviewer,interview_date,result,score,notes) VALUES(?,?,?,?,?,?,?)')
    INTERVIEWS.forEach(i => insI.run(i.candidate_id, i.round_no, i.interviewer, i.interview_date, i.result, i.score, i.notes))
  }
  if (empty('recruiting_channels')) {
    const insCh = db.prepare('INSERT INTO recruiting_channels(name,type,contact,note) VALUES(?,?,?,?)')
    RECRUITING_CHANNELS.forEach(c => insCh.run(c.name, c.type, c.contact, c.note))
  }
  if (empty('channel_expenses')) {
    const insE = db.prepare('INSERT INTO channel_expenses(channel_id,year_month,amount,note) VALUES(?,?,?,?)')
    CHANNEL_EXPENSES.forEach(e => insE.run(e.channel_id, e.year_month, e.amount, e.note))
  }
  if (empty('cost_budgets')) {
    const insB = db.prepare('INSERT INTO cost_budgets(year_month,department_id,category,amount,note) VALUES(?,?,?,?,?)')
    COST_BUDGETS.forEach(b => insB.run(b.year_month, b.department_id, b.category, b.amount, b.note))
  }
  if (empty('headcount_plan')) {
    const insH = db.prepare('INSERT INTO headcount_plan(department_id,year_month,planned,note) VALUES(?,?,?,?)')
    HEADCOUNT_PLAN.forEach(h => insH.run(h.department_id, h.year_month, h.planned, h.note))
  }
  if (empty('employee_events')) {
    const insEv = db.prepare('INSERT INTO employee_events(employee_id,type,event_date,from_value,to_value,note) VALUES(?,?,?,?,?,?)')
    EMPLOYEE_EVENTS.forEach(ev => insEv.run(ev.employee_id, ev.type, ev.event_date, ev.from_value, ev.to_value, ev.note))
  }
  assignEmployeeDepartments()
  assignOptionValues()
  assignSupplementalFund()
}

// 补充公积金比例（元/比例，0-8%）：部分员工按公司制度缴纳补充公积金
const SUPPLEMENTAL_FUND = { 1: 0.05, 5: 0.05, 6: 0.05, 14: 0.05, 11: 0.05, 12: 0.05 }
function assignSupplementalFund() {
  const upd = db.prepare('UPDATE employees SET supplemental_fund_rate=? WHERE id=? AND supplemental_fund_rate=0')
  for (const [id, v] of Object.entries(SUPPLEMENTAL_FUND)) upd.run(v, Number(id))
}

// 期权摊销价值（元/年，v2 成本模块用）——按种子员工 id 配置
const OPTION_VALUES = { 1: 150000, 5: 240000, 6: 200000, 12: 100000, 14: 180000, 2: 60000, 11: 80000 }
function assignOptionValues() {
  const upd = db.prepare('UPDATE employees SET annual_option_value=? WHERE id=? AND annual_option_value=0')
  for (const [id, v] of Object.entries(OPTION_VALUES)) upd.run(v, Number(id))
}

// 存量员工部门归属（按岗位族映射；部门 id 按名称查，避免依赖自增顺序）
const FAMILY_TO_DEPT = {
  '模拟IC设计': '模拟设计组', '数字前端(RTL)': '数字前端组', '数字验证': '验证与测试组',
  '数字后端': '数字前端组', '版图设计': '模拟设计组', 'EDA研发': '芯片设计部',
  '芯片测试ATE': '验证与测试组', '芯片固件/驱动': '芯片设计部',
  '工艺工程师(光刻)': '工艺与制造部', '工艺整合PIE': '工艺与制造部', '设备工程师': '工艺与制造部',
  '封装(先进封装)': '工艺与制造部', '器件/TCAD': '工艺与制造部',
  '财务': '职能部', '人力资源': '职能部', '行政': '职能部',
  '工程管理': '数字前端组', '销售': '市场与销售部', '市场': '市场与销售部'
}
function assignEmployeeDepartments() {
  const missing = db.prepare("SELECT id, job_family FROM employees WHERE department_id IS NULL").all()
  if (!missing.length) return
  const deptId = name => db.prepare('SELECT id FROM departments WHERE name=?').get(name)?.id || 1
  const upd = db.prepare('UPDATE employees SET department_id=? WHERE id=?')
  for (const e of missing) {
    const dname = FAMILY_TO_DEPT[e.job_family] || '职能部'
    upd.run(deptId(dname), e.id)
  }
  console.log(`[seed] 员工部门归属补录 ${missing.length} 条`)
}

const ATTENDANCE_SEED = [
  { employee_id: 1, period: '2025-06', work_days: 22, ot_weekday_hours: 0, ot_rest_hours: 0, ot_holiday_hours: 0, unpaid_leave_days: 0, note: '' },
  { employee_id: 2, period: '2025-06', work_days: 22, ot_weekday_hours: 27, ot_rest_hours: 0, ot_holiday_hours: 0, unpaid_leave_days: 0, note: '转正月加班' },
  { employee_id: 4, period: '2025-06', work_days: 21, ot_weekday_hours: 8, ot_rest_hours: 8, ot_holiday_hours: 0, unpaid_leave_days: 0, note: '含休息日加班，按 2 倍计' },
  { employee_id: 5, period: '2025-06', work_days: 22, ot_weekday_hours: 0, ot_rest_hours: 0, ot_holiday_hours: 0, unpaid_leave_days: 0, note: '' }
]
const PERFORMANCE_SEED = [
  { employee_id: 1, cycle: '2025-H1', rating: 'A', score: 88, comment: '项目交付稳定', created_by: 'CTO 陈**' },
  { employee_id: 2, cycle: '2025-H1', rating: 'B', score: 76, comment: '转正达标', created_by: '钱经理' },
  { employee_id: 4, cycle: '2025-H1', rating: 'B', score: 74, comment: '加班需合规复核', created_by: '钱经理' },
  { employee_id: 5, cycle: '2025-H1', rating: 'S', score: 95, comment: 'SerDes 方向关键贡献，留才', created_by: 'CTO 陈**' },
  { employee_id: 6, cycle: '2025-H1', rating: 'A', score: 90, comment: 'EDA 工具链推进', created_by: 'CTO 陈**' },
  { employee_id: 7, cycle: '2025-H1', rating: 'A', score: 86, comment: '版图质量稳定', created_by: '首席 王**' }
]

function seedV13() {
  if (db.prepare('SELECT COUNT(*) c FROM attendance_days').get().c === 0) {
    const ins = db.prepare('INSERT INTO attendance_days(employee_id,period,work_days,ot_weekday_hours,ot_rest_hours,ot_holiday_hours,unpaid_leave_days,note,updated_at,scheduled_work_days) VALUES(?,?,?,?,?,?,?,?,?,?)')
    ATTENDANCE_SEED.forEach(r => ins.run(r.employee_id, r.period, r.work_days, r.ot_weekday_hours, r.ot_rest_hours, r.ot_holiday_hours, r.unpaid_leave_days, r.note, '2025-06-30 18:00', 22))
    console.log(`[seed] v13 考勤灌库 ${ATTENDANCE_SEED.length} 条`)
  }
  if (db.prepare('SELECT COUNT(*) c FROM performance_reviews').get().c === 0) {
    const ins = db.prepare('INSERT INTO performance_reviews(employee_id,cycle,rating,score,comment,created_by,created_at) VALUES(?,?,?,?,?,?,?)')
    PERFORMANCE_SEED.forEach(r => ins.run(r.employee_id, r.cycle, r.rating, r.score, r.comment, r.created_by, '2025-06-20 10:00'))
    console.log(`[seed] v13 绩效灌库 ${PERFORMANCE_SEED.length} 条`)
  }
  if (db.prepare('SELECT COUNT(*) c FROM market_samples').get().c === 0) {
    const dirs = db.prepare('SELECT direction, p25, p50, p75 FROM benchmarks').all()
    const now = '2025-06-15 12:00'
    const insI = db.prepare('INSERT INTO market_ingests(source,sample_count,created_by,note,created_at) VALUES(?,?,?,?,?)')
    const ingestId = insI.run('import:seed', 0, 'system', '演示样本（非平台抓取）', now).lastInsertRowid
    const ins = db.prepare('INSERT INTO market_samples(ingest_id,direction,city,exp_band,company_type,annual_cash_wan,source,collected_at,title) VALUES(?,?,?,?,?,?,?,?,?)')
    let n = 0
    for (const d of dirs) {
      const count = 12
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1)
        const wan = t < 0.5 ? d.p25 + (d.p50 - d.p25) * t * 2 : d.p50 + (d.p75 - d.p50) * (t - 0.5) * 2
        const bump = d.direction === '模拟IC设计' ? 4 : 0
        ins.run(ingestId, d.direction, '上海', '3-5年', 'Fabless', Math.round((wan + bump) * 10) / 10, 'import:seed', '2025-06-01', '')
        n++
      }
    }
    db.prepare('UPDATE market_ingests SET sample_count=? WHERE id=?').run(n, ingestId)
    console.log(`[seed] v13 对标样本灌库 ${n} 条`)
  }
  const a101 = db.prepare("SELECT * FROM approvals WHERE id='A-101'").get()
  if (a101 && !a101.payload_json) {
    const b = db.prepare("SELECT * FROM benchmarks WHERE direction='模拟IC设计'").get()
    const from = b ? { p25: b.p25, p50: b.p50, p75: b.p75 } : { p25: 42, p50: 50, p75: 62 }
    const payload = { kind: 'band', direction: '模拟IC设计', city: '上海', exp: '3-5年', from, to: { p25: 45, p50: 55, p75: 68 }, sample: 20, source: 'import:seed' }
    db.prepare('UPDATE approvals SET payload_json=?, key=?, summary=? WHERE id=?').run(JSON.stringify(payload), `P50 ${from.p50}万 → 55万`, '导入样本草稿 · 上海 3-5年', 'A-101')
  }
  const a102 = db.prepare("SELECT * FROM approvals WHERE id='A-102'").get()
  if (a102 && !a102.payload_json) {
    db.prepare('UPDATE approvals SET payload_json=? WHERE id=?').run(JSON.stringify({ kind: 'raise', employee_id: 5, from_monthly: 48333, to_monthly: 54167, option_share_count: 0, rating: 'S', note: '绩效 S + 留才预警' }), 'A-102')
  }
  const a103 = db.prepare("SELECT * FROM approvals WHERE id='A-103'").get()
  if (a103) {
    if (!a103.payload_json) {
      db.prepare('UPDATE approvals SET payload_json=?, page=?, key=? WHERE id=?').run(JSON.stringify({ kind: 'option', employee_id: 6, share_count: 3, exercise_price: 1, fair_value: 50, vesting_months: 48, cliff_months: 12, note: 'EDA 核心加授' }), 'option-approval', '授予 3 万股 · B轮估值', 'A-103')
    } else if (a103.page === 'option') {
      db.prepare("UPDATE approvals SET page='option-approval' WHERE id='A-103'")
    }
  }
  const a104 = db.prepare("SELECT * FROM approvals WHERE id='A-104'").get()
  if (a104 && !a104.ref_id) {
    const wu = db.prepare("SELECT id, offer_amount FROM candidates WHERE name='吴敏'").get()
    if (wu) {
      db.prepare("UPDATE approvals SET ref_type='candidate', ref_id=?, title=?, key=?, summary=?, payload_json=? WHERE id='A-104'")
        .run(wu.id, 'Offer 建议 · 吴敏（数字前端 P5）', `月薪 ${(wu.offer_amount || 58000).toLocaleString('zh-CN')}`, '候选人管线 Offer 待审', JSON.stringify({ kind: 'offer', candidate_id: wu.id }))
    }
  }
  const a105 = db.prepare("SELECT * FROM approvals WHERE id='A-105'").get()
  if (a105 && !a105.payload_json) {
    db.prepare('UPDATE approvals SET payload_json=? WHERE id=?').run(JSON.stringify({ kind: 'raise', employee_id: 7, from_monthly: 30000, to_monthly: 32400, option_share_count: 0, rating: 'A', note: '已通过（种子不回放落库）' }), 'A-105')
  }
}

// 生成 2025-01 ~ 2025-06 历史工资单（累计预扣法 + 城市基数封顶，供趋势/仪表盘使用）
export function seedPayroll() {
  const employees = db.prepare('SELECT * FROM employees').all()
  const ins = db.prepare('INSERT INTO payroll(period,employee_id,name,grade,status,base,perf,ot,social,fund,supplemental_fund,severance,tax,net,flags) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  let rows = 0
  for (const row of computeCumulative(PERIODS, employees)) {
    ins.run(row.period, row.employee_id, row.name, row.grade, row.status, row.base, row.perf, row.ot, row.social, row.fund, row.supplemental_fund || 0, row.severance || 0, row.tax, row.net, JSON.stringify(row.flags))
    rows++
  }
  console.log(`[seed] payroll 生成 ${rows} 条（累计预扣法，${PERIODS.length} 个月）`)
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  if (!demoModeEnabled()) {
    throw new Error('拒绝写入演示数据：请显式使用 DEMO_MODE=true npm run seed:demo')
  }
  seedIfEmpty({ demo: true })
  console.log('[seed] 完成，数据库:', DB_PATH)
}
