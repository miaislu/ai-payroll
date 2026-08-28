// 数据库初始化 + 种子数据（node:sqlite，零原生依赖）
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, scryptSync, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { computeCumulative } from './lib/payroll.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'payroll.db')
export const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode=WAL')

db.exec(`
CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL, name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS employees(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, grade TEXT, job_family TEXT, city TEXT,
  category TEXT DEFAULT 'tech', status TEXT DEFAULT 'active', monthly_base INTEGER, perf_ratio REAL DEFAULT 0.32,
  ot_amount INTEGER DEFAULT 0, flag TEXT, hire_month TEXT DEFAULT '2025-01',
  leave_month TEXT, special_deduction INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS benchmarks(
  id INTEGER PRIMARY KEY, direction TEXT UNIQUE NOT NULL, p25 INTEGER, p50 INTEGER, p75 INTEGER,
  rarity REAL, sample INTEGER, trend TEXT, annual_months INTEGER, evidence TEXT, sources TEXT
);
CREATE TABLE IF NOT EXISTS approvals(
  id TEXT PRIMARY KEY, type TEXT, title TEXT, who TEXT, key TEXT, summary TEXT,
  status TEXT DEFAULT 'pending', page TEXT
);
CREATE TABLE IF NOT EXISTS payroll(
  id INTEGER PRIMARY KEY AUTOINCREMENT, period TEXT NOT NULL, employee_id INTEGER NOT NULL,
  name TEXT, grade TEXT, status TEXT, base INTEGER, perf INTEGER, ot INTEGER,
  social INTEGER, fund INTEGER, tax INTEGER, net INTEGER, flags TEXT,
  UNIQUE(period, employee_id)
);
`)

// ── 迁移机制：schema_version 表记录当前版本，按序执行未应用迁移 ──
// 用法：未来改表结构时向 MIGRATIONS 追加 {version, sql}（先 CREATE TABLE 再 ALTER 等），启动自动应用。
// 注意：初始表结构由上方 CREATE TABLE IF NOT EXISTS 直接建立（版本 0），迁移仅用于后续增量变更。
const MIGRATIONS = []
export function migrate() {
  const v = db.prepare('SELECT version FROM schema_version').get()?.version || 0
  for (const m of MIGRATIONS) {
    if (m.version <= v) continue
    db.exec('BEGIN')
    try {
      db.exec(m.sql)
      db.prepare('INSERT OR REPLACE INTO schema_version(version) VALUES(?)').run(m.version)
      db.exec('COMMIT')
      console.log(`[migrate] 应用迁移 v${m.version}`)
    } catch (e) { db.exec('ROLLBACK'); throw e }
  }
}

export function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(pw, salt, 32).toString('hex')
  return `${salt}:${hash}`
}
export function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':')
  if (!salt || !hash) return false
  const calc = scryptSync(pw, salt, 32).toString('hex')
  return calc === hash
}
export function createSession(userId) {
  const token = randomUUID().replace(/-/g, '')
  const expires = Date.now() + 12 * 60 * 60 * 1000 // 12h
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token, userId, expires)
  return token
}

const USERS = [
  { username: 'founder', password: 'admin123', role: 'founder', name: '创始人' },
  { username: 'hr', password: 'hr123', role: 'hr', name: 'HR 李明' },
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
  { name: '周OFFER2', grade: 'P4', job_family: '芯片测试ATE', city: '合肥', category: 'tech', status: 'offer', monthly_base: 22000, perf_ratio: 0.30, ot_amount: 0, hire_month: '2025-08' }
]

const APPROVALS = [
  { id: 'A-101', type: 'band', title: '带宽刷新 · 模拟IC设计（上海 3-5年）', who: 'HR 李明 · 06-16 10:20', key: 'P50 58万 → 62万（+6.9%）', summary: 'AI 草稿 · 样本137 · 稀缺性1.15', page: 'band-approval' },
  { id: 'A-102', type: 'raise', title: '调薪申请 · 王**（模拟IC设计 P5）', who: 'CTO 陈** · 06-16 09:40', key: '建议 +12%（58万 → 65万）', summary: 'P18 分位 + 绩效 S + 留才预警', page: 'raise-approval' },
  { id: 'A-103', type: 'option', title: '期权授予 · 李**（EDA 工具 P5）', who: 'HR 李明 · 06-15 17:30', key: '授予 0.3% · B轮估值', summary: '等值现金 ≈ 12万/年（4年归属）', page: 'option' },
  { id: 'A-104', type: 'offer', title: 'Offer 建议 · 周*（数字后端 P6）', who: 'HR 李明 · 06-15 15:10', key: '总包 95万（现金68+期权27）', summary: '带宽 P72 · HBM 接口稀缺技能', page: 'offer-approval' },
  { id: 'A-105', type: 'raise', title: '调薪申请 · 郑*（版图设计 P4）', who: 'CTO 陈** · 06-14 11:00', key: '+8% · 已通过', summary: '带宽内 · 影响可控', status: 'approved', page: 'raise-approval' }
]

const DIR_MAP = {
  '模拟IC设计工程师': '模拟IC设计', '数字IC前端工程师': '数字前端(RTL)', '数字验证工程师': '数字验证',
  '数字后端工程师': '数字后端', '版图设计工程师': '版图设计', '工艺工程师': '工艺工程师(光刻)',
  '工艺整合PIE': '工艺整合PIE', '设备工程师': '设备工程师', 'EDA研发工程师': 'EDA研发',
  '芯片测试工程师': '芯片测试ATE', '封装工程师': '封装(先进封装)', '器件工程师': '器件/TCAD',
  '芯片固件/嵌入式': '芯片固件/驱动'
}

const PERIODS = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06']

export function seedIfEmpty() {
  migrate()
  const u = db.prepare('SELECT COUNT(*) c FROM users').get()
  if (u.c === 0) {
    const insU = db.prepare('INSERT INTO users(username,password_hash,role,name) VALUES(?,?,?,?)')
    USERS.forEach(u => insU.run(u.username, hashPassword(u.password), u.role, u.name))
    const insE = db.prepare('INSERT INTO employees(name,grade,job_family,city,category,status,monthly_base,perf_ratio,ot_amount,flag,hire_month,leave_month,special_deduction) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    EMPLOYEES.forEach(e => insE.run(e.name, e.grade, e.job_family, e.city, e.category || 'tech', e.status || 'active', e.monthly_base, e.perf_ratio, e.ot_amount, e.flag || null, e.hire_month || '2025-01', e.leave_month || null, e.special_deduction || 0))
    const insA = db.prepare('INSERT INTO approvals(id,type,title,who,key,summary,status,page) VALUES(?,?,?,?,?,?,?,?)')
    APPROVALS.forEach(a => insA.run(a.id, a.type, a.title, a.who, a.key, a.summary, a.status || 'pending', a.page))
  }
  const b = db.prepare('SELECT COUNT(*) c FROM benchmarks').get()
  if (b.c === 0) {
    const ds = JSON.parse(readFileSync(path.join(__dirname, '..', 'benchmark-data', 'benchmark-dataset.json'), 'utf-8'))
    const insB = db.prepare('INSERT INTO benchmarks(direction,p25,p50,p75,rarity,sample,trend,annual_months,evidence,sources) VALUES(?,?,?,?,?,?,?,?,?,?)')
    let n = 0
    for (const e of ds.directions) {
      const short = DIR_MAP[e.direction]
      if (!short) { console.warn('跳过未映射方向:', e.direction); continue }
      insB.run(short, e.p25_wan, e.cash_p50_wan, e.p75_wan, e.rarity_factor, 55 + (n * 37) % 200, e.evidence === '强' ? '+3.0%' : e.evidence === '中' ? '+2.0%' : '+1.0%', e.annual_months, e.evidence, JSON.stringify(e.sources))
      n++
    }
    console.log(`[seed] benchmarks 灌库 ${n} 条`)
  }
  const p = db.prepare('SELECT COUNT(*) c FROM payroll').get()
  if (p.c === 0) seedPayroll()
}

// 生成 2025-01 ~ 2025-06 历史工资单（累计预扣法 + 城市基数封顶，供趋势/仪表盘使用）
export function seedPayroll() {
  const employees = db.prepare('SELECT * FROM employees').all()
  const ins = db.prepare('INSERT INTO payroll(period,employee_id,name,grade,status,base,perf,ot,social,fund,tax,net,flags) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
  let rows = 0
  for (const row of computeCumulative(PERIODS, employees)) {
    ins.run(row.period, row.employee_id, row.name, row.grade, row.status, row.base, row.perf, row.ot, row.social, row.fund, row.tax, row.net, JSON.stringify(row.flags))
    rows++
  }
  console.log(`[seed] payroll 生成 ${rows} 条（累计预扣法，${PERIODS.length} 个月）`)
}

if (process.argv.includes('--seed-only')) {
  seedIfEmpty()
  console.log('[seed] 完成，数据库:', DB_PATH)
}
