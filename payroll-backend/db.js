// 数据库连接、schema 与迁移（种子数据见 seed.js）
import './lib/env.js'
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
process.umask(0o077)
export const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'payroll.db')
export const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode=WAL')
db.exec('PRAGMA foreign_keys=ON')
db.exec('PRAGMA busy_timeout=5000')

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
-- ── v2：组织与招聘成本管理 ──
CREATE TABLE IF NOT EXISTS departments(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, parent_id INTEGER,
  head TEXT, budget_owner TEXT
);
CREATE TABLE IF NOT EXISTS job_requisitions(
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, department_id INTEGER,
  job_family TEXT, grade TEXT, city TEXT, headcount INTEGER DEFAULT 1,
  priority TEXT DEFAULT 'normal', status TEXT DEFAULT 'open',
  salary_min INTEGER, salary_max INTEGER, reason TEXT,
  created_by TEXT, created_at TEXT, closed_at TEXT
);
CREATE TABLE IF NOT EXISTS candidates(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT, email TEXT,
  source_channel TEXT, requisition_id INTEGER, stage TEXT DEFAULT 'new',
  apply_date TEXT, expected_salary INTEGER, offer_amount INTEGER, offer_date TEXT,
  onboard_date TEXT, eval_score REAL, reject_reason TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS interviews(
  id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id INTEGER NOT NULL, round_no INTEGER DEFAULT 1,
  interviewer TEXT, interview_date TEXT, result TEXT DEFAULT 'pending',
  score REAL, notes TEXT
);
CREATE TABLE IF NOT EXISTS recruiting_channels(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT,
  contact TEXT, note TEXT
);
CREATE TABLE IF NOT EXISTS channel_expenses(
  id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id INTEGER NOT NULL,
  year_month TEXT NOT NULL, amount INTEGER DEFAULT 0, note TEXT
);
CREATE TABLE IF NOT EXISTS cost_budgets(
  id INTEGER PRIMARY KEY AUTOINCREMENT, year_month TEXT NOT NULL, department_id INTEGER,
  category TEXT DEFAULT 'salary', amount INTEGER DEFAULT 0, note TEXT
);
CREATE TABLE IF NOT EXISTS employee_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL,
  type TEXT NOT NULL, event_date TEXT NOT NULL, from_value TEXT, to_value TEXT, note TEXT
);
CREATE TABLE IF NOT EXISTS headcount_plan(
  id INTEGER PRIMARY KEY AUTOINCREMENT, department_id INTEGER NOT NULL,
  year_month TEXT NOT NULL, planned INTEGER DEFAULT 0, note TEXT,
  UNIQUE(department_id, year_month)
);
-- ── v3：员工完整档案（基础信息/联系/紧急联系人/教育/工作经历/家庭）──
CREATE TABLE IF NOT EXISTS emergency_contacts(
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL,
  name TEXT NOT NULL, relation TEXT, mobile TEXT, address TEXT, is_primary INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS employee_education(
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL,
  school TEXT, qualification TEXT, major TEXT, graduation_year INTEGER, note TEXT
);
CREATE TABLE IF NOT EXISTS employee_work_experience(
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL,
  company TEXT, title TEXT, start_date TEXT, end_date TEXT, note TEXT
);
CREATE TABLE IF NOT EXISTS employee_family(
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL,
  name TEXT, relation TEXT, note TEXT
);
-- ── v4：简历附件与 AI 解析结果 ──
CREATE TABLE IF NOT EXISTS employee_resumes(
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL,
  filename TEXT NOT NULL, original_name TEXT, content_type TEXT,
  size INTEGER DEFAULT 0, file_path TEXT, uploaded_at TEXT,
  parse_status TEXT DEFAULT 'pending', parse_engine TEXT, parsed_data TEXT,
  text_preview TEXT
);
-- ── v6：期权授予台账 + 期权池（摊销联动成本预测）──
CREATE TABLE IF NOT EXISTS option_pool(
  id INTEGER PRIMARY KEY CHECK(id=1),
  pool_percent REAL DEFAULT 15, total_shares REAL DEFAULT 1000,
  valuation_wan INTEGER DEFAULT 50000, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS option_grants(
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL,
  grant_date TEXT, share_count REAL, exercise_price REAL, fair_value REAL,
  vesting_months INTEGER DEFAULT 48, cliff_months INTEGER DEFAULT 12,
  total_value INTEGER DEFAULT 0, monthly_amort INTEGER DEFAULT 0,
  status TEXT DEFAULT 'granted', note TEXT
);
`)

// ── 迁移机制：schema_version 表记录当前版本，按序执行未应用迁移 ──
// 用法：未来改表结构时向 MIGRATIONS 追加 {version, sql}（先 CREATE TABLE 再 ALTER 等），启动自动应用。
// 注意：初始表结构由上方 CREATE TABLE IF NOT EXISTS 直接建立（版本 0），迁移仅用于后续增量变更。
const MIGRATIONS = [
  // v1：员工表增加部门归属 + 年度期权价值（成本归因与摊销用）
  {
    version: 1,
    sql: `ALTER TABLE employees ADD COLUMN department_id INTEGER;
          ALTER TABLE employees ADD COLUMN annual_option_value INTEGER DEFAULT 0;`
  },
  // v2：员工完整档案字段（基础信息 / 联系方式 / 合同社保 / 银行 / 技能）
  {
    version: 2,
    sql: `ALTER TABLE employees ADD COLUMN gender TEXT;
          ALTER TABLE employees ADD COLUMN date_of_birth TEXT;
          ALTER TABLE employees ADD COLUMN marital_status TEXT;
          ALTER TABLE employees ADD COLUMN nationality TEXT;
          ALTER TABLE employees ADD COLUMN education_level TEXT;
          ALTER TABLE employees ADD COLUMN id_number TEXT;
          ALTER TABLE employees ADD COLUMN mobile TEXT;
          ALTER TABLE employees ADD COLUMN personal_email TEXT;
          ALTER TABLE employees ADD COLUMN alternate_mobile TEXT;
          ALTER TABLE employees ADD COLUMN current_address TEXT;
          ALTER TABLE employees ADD COLUMN permanent_address TEXT;
          ALTER TABLE employees ADD COLUMN contract_type TEXT;
          ALTER TABLE employees ADD COLUMN contract_start TEXT;
          ALTER TABLE employees ADD COLUMN contract_end TEXT;
          ALTER TABLE employees ADD COLUMN probation_end TEXT;
          ALTER TABLE employees ADD COLUMN confirmation_date TEXT;
          ALTER TABLE employees ADD COLUMN social_security_no TEXT;
          ALTER TABLE employees ADD COLUMN housing_fund_no TEXT;
          ALTER TABLE employees ADD COLUMN bank_name TEXT;
          ALTER TABLE employees ADD COLUMN bank_account TEXT;
          ALTER TABLE employees ADD COLUMN skills TEXT;
          ALTER TABLE employees ADD COLUMN notice_period TEXT;`
  },
  // v3：招聘到成本链路（候选人简历/技能标签 + 需求到岗月 + 审批关联与留痕）
  {
    version: 3,
    sql: `ALTER TABLE candidates ADD COLUMN resume_name TEXT;
          ALTER TABLE candidates ADD COLUMN resume_path TEXT;
          ALTER TABLE candidates ADD COLUMN resume_parsed TEXT;
          ALTER TABLE candidates ADD COLUMN skills TEXT;
          ALTER TABLE candidates ADD COLUMN tags TEXT;
          ALTER TABLE candidates ADD COLUMN experience_years INTEGER;
          ALTER TABLE candidates ADD COLUMN offer_status TEXT;
          ALTER TABLE job_requisitions ADD COLUMN target_month TEXT;
          ALTER TABLE approvals ADD COLUMN ref_type TEXT;
          ALTER TABLE approvals ADD COLUMN ref_id INTEGER;
          ALTER TABLE approvals ADD COLUMN action_by TEXT;
          ALTER TABLE approvals ADD COLUMN action_at TEXT;
          ALTER TABLE approvals ADD COLUMN comment TEXT;`
  },
  // v4：users 关联员工（emp 角色 → 本人员工档案，payslip/me 按登录身份返回）
  {
    version: 4,
    sql: `ALTER TABLE users ADD COLUMN employee_id INTEGER;`
  },
  // v5：用工类型（employee 正式 / consultant 顾问 / intern 实习生）
  {
    version: 5,
    sql: `ALTER TABLE employees ADD COLUMN employment_type TEXT DEFAULT 'employee';`
  },
  // v6：补充公积金比例（员工，0-8%；0 表示无补充公积金）
  {
    version: 6,
    sql: `ALTER TABLE employees ADD COLUMN supplemental_fund_rate REAL DEFAULT 0;`
  },
  // v7：工资单补充公积金列（个人缴纳部分，薪酬单展示用）
  {
    version: 7,
    sql: `ALTER TABLE payroll ADD COLUMN supplemental_fund INTEGER DEFAULT 0;`
  },
  // v8：报销与预支（Expense Claim + Employee Advance，参考 Frappe HR）
  {
    version: 8,
    sql: `CREATE TABLE IF NOT EXISTS expense_claims(
            id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL,
            expense_type TEXT DEFAULT '其他', amount INTEGER NOT NULL, claim_date TEXT,
            description TEXT, status TEXT DEFAULT 'submitted',
            submitted_by TEXT, submitted_at TEXT,
            approver TEXT, approved_at TEXT, comment TEXT,
            advance_offset INTEGER DEFAULT 0
          );
          CREATE TABLE IF NOT EXISTS employee_advances(
            id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL,
            amount INTEGER NOT NULL, reason TEXT, advance_date TEXT,
            status TEXT DEFAULT 'submitted', outstanding INTEGER,
            approver TEXT, approved_at TEXT, comment TEXT
          );`
  },
  // v9：离职补偿显式录入、候选人入职幂等关联、审计日志
  {
    version: 9,
    sql: `ALTER TABLE employees ADD COLUMN severance_amount INTEGER DEFAULT 0;
          ALTER TABLE payroll ADD COLUMN severance INTEGER DEFAULT 0;
          ALTER TABLE candidates ADD COLUMN employee_id INTEGER;
          CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_employee_id ON candidates(employee_id) WHERE employee_id IS NOT NULL;
          CREATE TABLE IF NOT EXISTS audit_logs(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_user_id INTEGER, actor_name TEXT, action TEXT NOT NULL,
            entity_type TEXT NOT NULL, entity_id TEXT, before_json TEXT, after_json TEXT,
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id, id);`
  },
  // v10：保留兼容版本号。旧实现曾按月份/数量猜测演示数据并删除工资历史，
  // 这种启发式迁移可能命中真实小公司数据，因此新安装只创建空归档表，绝不改写业务数据。
  {
    version: 10,
    sql: `CREATE TABLE IF NOT EXISTS payroll_archive_v10 AS SELECT * FROM payroll WHERE 0;`
  },
  // v11：工资批次提交状态持久化
  {
    version: 11,
    sql: `CREATE TABLE IF NOT EXISTS payroll_runs(
            period TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'submitted',
            submitted_by TEXT NOT NULL, submitted_at TEXT NOT NULL
          );`
  },
  // v12：查询索引 + Copilot 会话持久化
  {
    version: 12,
    sql: `CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
          CREATE INDEX IF NOT EXISTS idx_payroll_period ON payroll(period);
          CREATE INDEX IF NOT EXISTS idx_payroll_employee ON payroll(employee_id);
          CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);
          CREATE INDEX IF NOT EXISTS idx_employee_events_emp ON employee_events(employee_id);
          CREATE INDEX IF NOT EXISTS idx_candidates_req ON candidates(requisition_id);
          CREATE INDEX IF NOT EXISTS idx_channel_expenses_channel ON channel_expenses(channel_id);
          CREATE TABLE IF NOT EXISTS copilot_sessions(
            session_key TEXT PRIMARY KEY,
            messages_json TEXT NOT NULL DEFAULT '[]',
            updated_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_copilot_sessions_updated ON copilot_sessions(updated_at);`
  },
  // v13：审批 payload、考勤、绩效、对标样本导入（不做平台抓取）
  {
    version: 13,
    sql: `ALTER TABLE approvals ADD COLUMN payload_json TEXT;
          CREATE TABLE IF NOT EXISTS attendance_days(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER NOT NULL,
            period TEXT NOT NULL,
            work_days REAL DEFAULT 0,
            ot_weekday_hours REAL DEFAULT 0,
            ot_rest_hours REAL DEFAULT 0,
            ot_holiday_hours REAL DEFAULT 0,
            unpaid_leave_days REAL DEFAULT 0,
            note TEXT,
            updated_at TEXT,
            UNIQUE(employee_id, period)
          );
          CREATE INDEX IF NOT EXISTS idx_attendance_period ON attendance_days(period);
          CREATE TABLE IF NOT EXISTS performance_reviews(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER NOT NULL,
            cycle TEXT NOT NULL,
            rating TEXT NOT NULL,
            score REAL,
            comment TEXT,
            created_by TEXT,
            created_at TEXT,
            UNIQUE(employee_id, cycle)
          );
          CREATE INDEX IF NOT EXISTS idx_performance_cycle ON performance_reviews(cycle);
          CREATE TABLE IF NOT EXISTS market_ingests(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            sample_count INTEGER DEFAULT 0,
            created_by TEXT,
            note TEXT,
            created_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS market_samples(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ingest_id INTEGER,
            direction TEXT NOT NULL,
            city TEXT,
            exp_band TEXT,
            company_type TEXT,
            annual_cash_wan REAL NOT NULL,
            source TEXT,
            collected_at TEXT,
            title TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_market_samples_dir ON market_samples(direction, city, exp_band);`
  },
  // v14：生效日薪酬条款、精确入离职日期、考勤计薪天数与锁定成本快照
  {
    version: 14,
    sql: `ALTER TABLE employees ADD COLUMN hire_date TEXT;
          ALTER TABLE employees ADD COLUMN leave_date TEXT;
          ALTER TABLE approvals ADD COLUMN created_by_user_id INTEGER;
          UPDATE employees SET hire_date=hire_month || '-01' WHERE hire_date IS NULL AND hire_month IS NOT NULL;
          UPDATE employees SET leave_date=date(leave_month || '-01','start of month','+1 month','-1 day') WHERE leave_date IS NULL AND leave_month IS NOT NULL;
          ALTER TABLE attendance_days ADD COLUMN scheduled_work_days REAL;
          UPDATE attendance_days SET scheduled_work_days=CASE WHEN work_days>0 THEN work_days ELSE 21.75 END WHERE scheduled_work_days IS NULL;
          CREATE TABLE IF NOT EXISTS employee_compensation_terms(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER NOT NULL,
            effective_month TEXT NOT NULL CHECK(effective_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
            monthly_base INTEGER NOT NULL CHECK(monthly_base BETWEEN 0 AND 500000),
            perf_ratio REAL NOT NULL CHECK(perf_ratio BETWEEN 0 AND 1),
            city TEXT NOT NULL,
            department_id INTEGER,
            employment_type TEXT NOT NULL CHECK(employment_type IN ('employee','consultant','intern')),
            supplemental_fund_rate REAL NOT NULL DEFAULT 0 CHECK(supplemental_fund_rate BETWEEN 0 AND 0.08),
            special_deduction INTEGER NOT NULL DEFAULT 0 CHECK(special_deduction BETWEEN 0 AND 10000),
            annual_option_value INTEGER NOT NULL DEFAULT 0 CHECK(annual_option_value >= 0),
            source_approval_id TEXT,
            created_by TEXT,
            created_at TEXT NOT NULL,
            UNIQUE(employee_id,effective_month),
            FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE,
            FOREIGN KEY(department_id) REFERENCES departments(id)
          );
          CREATE INDEX IF NOT EXISTS idx_comp_terms_period ON employee_compensation_terms(employee_id,effective_month);
          INSERT OR IGNORE INTO employee_compensation_terms(
            employee_id,effective_month,monthly_base,perf_ratio,city,department_id,employment_type,
            supplemental_fund_rate,special_deduction,annual_option_value,created_by,created_at
          )
          SELECT id,COALESCE(hire_month,'1900-01'),COALESCE(monthly_base,0),COALESCE(perf_ratio,0),COALESCE(city,''),department_id,
                 COALESCE(employment_type,'employee'),COALESCE(supplemental_fund_rate,0),COALESCE(special_deduction,0),
                 COALESCE(annual_option_value,0),'migration-v14',datetime('now')
          FROM employees;
          CREATE TABLE IF NOT EXISTS company_cost_snapshots(
            period TEXT NOT NULL,
            employee_id INTEGER NOT NULL,
            row_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY(period,employee_id),
            FOREIGN KEY(employee_id) REFERENCES employees(id)
          );
          CREATE INDEX IF NOT EXISTS idx_cost_snapshots_period ON company_cost_snapshots(period);`
  },
  // v15：工资导出字段冻结、已月结快照不可变、旧表的关键外键守卫
  {
    version: 15,
    sql: `ALTER TABLE payroll ADD COLUMN city TEXT;
          ALTER TABLE payroll ADD COLUMN category TEXT;
          ALTER TABLE payroll ADD COLUMN employment_type TEXT;
          ALTER TABLE payroll ADD COLUMN special_deduction INTEGER DEFAULT 0;
          ALTER TABLE payroll ADD COLUMN supplemental_fund_rate REAL DEFAULT 0;
          ALTER TABLE payroll ADD COLUMN social_base INTEGER DEFAULT 0;
          ALTER TABLE payroll ADD COLUMN fund_base INTEGER DEFAULT 0;
          ALTER TABLE payroll ADD COLUMN id_number TEXT;
          ALTER TABLE payroll ADD COLUMN bank_account TEXT;

          CREATE TRIGGER IF NOT EXISTS payroll_locked_no_update BEFORE UPDATE ON payroll
          WHEN EXISTS(SELECT 1 FROM payroll_runs WHERE period=OLD.period)
          BEGIN SELECT RAISE(ABORT,'已月结工资快照不可修改'); END;
          CREATE TRIGGER IF NOT EXISTS payroll_locked_no_delete BEFORE DELETE ON payroll
          WHEN EXISTS(SELECT 1 FROM payroll_runs WHERE period=OLD.period)
          BEGIN SELECT RAISE(ABORT,'已月结工资快照不可删除'); END;
          CREATE TRIGGER IF NOT EXISTS cost_snapshot_locked_no_update BEFORE UPDATE ON company_cost_snapshots
          WHEN EXISTS(SELECT 1 FROM payroll_runs WHERE period=OLD.period)
          BEGIN SELECT RAISE(ABORT,'已月结成本快照不可修改'); END;
          CREATE TRIGGER IF NOT EXISTS cost_snapshot_locked_no_delete BEFORE DELETE ON company_cost_snapshots
          WHEN EXISTS(SELECT 1 FROM payroll_runs WHERE period=OLD.period)
          BEGIN SELECT RAISE(ABORT,'已月结成本快照不可删除'); END;

          CREATE TRIGGER IF NOT EXISTS fk_option_grants_employee_insert BEFORE INSERT ON option_grants
          WHEN NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.employee_id)
          BEGIN SELECT RAISE(ABORT,'option_grants.employee_id 不存在'); END;
          CREATE TRIGGER IF NOT EXISTS fk_attendance_employee_insert BEFORE INSERT ON attendance_days
          WHEN NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.employee_id)
          BEGIN SELECT RAISE(ABORT,'attendance_days.employee_id 不存在'); END;
          CREATE TRIGGER IF NOT EXISTS fk_performance_employee_insert BEFORE INSERT ON performance_reviews
          WHEN NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.employee_id)
          BEGIN SELECT RAISE(ABORT,'performance_reviews.employee_id 不存在'); END;
          CREATE TRIGGER IF NOT EXISTS fk_event_employee_insert BEFORE INSERT ON employee_events
          WHEN NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.employee_id)
          BEGIN SELECT RAISE(ABORT,'employee_events.employee_id 不存在'); END;
          CREATE TRIGGER IF NOT EXISTS fk_claim_employee_insert BEFORE INSERT ON expense_claims
          WHEN NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.employee_id)
          BEGIN SELECT RAISE(ABORT,'expense_claims.employee_id 不存在'); END;
          CREATE TRIGGER IF NOT EXISTS fk_advance_employee_insert BEFORE INSERT ON employee_advances
          WHEN NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.employee_id)
          BEGIN SELECT RAISE(ABORT,'employee_advances.employee_id 不存在'); END;
          CREATE TRIGGER IF NOT EXISTS fk_contact_employee_insert BEFORE INSERT ON emergency_contacts
          WHEN NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.employee_id)
          BEGIN SELECT RAISE(ABORT,'emergency_contacts.employee_id 不存在'); END;
          CREATE TRIGGER IF NOT EXISTS fk_education_employee_insert BEFORE INSERT ON employee_education
          WHEN NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.employee_id)
          BEGIN SELECT RAISE(ABORT,'employee_education.employee_id 不存在'); END;
          CREATE TRIGGER IF NOT EXISTS fk_work_employee_insert BEFORE INSERT ON employee_work_experience
          WHEN NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.employee_id)
          BEGIN SELECT RAISE(ABORT,'employee_work_experience.employee_id 不存在'); END;
          CREATE TRIGGER IF NOT EXISTS fk_family_employee_insert BEFORE INSERT ON employee_family
          WHEN NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.employee_id)
          BEGIN SELECT RAISE(ABORT,'employee_family.employee_id 不存在'); END;
          CREATE TRIGGER IF NOT EXISTS fk_resume_employee_insert BEFORE INSERT ON employee_resumes
          WHEN NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.employee_id)
          BEGIN SELECT RAISE(ABORT,'employee_resumes.employee_id 不存在'); END;
          CREATE TRIGGER IF NOT EXISTS fk_interview_candidate_insert BEFORE INSERT ON interviews
          WHEN NOT EXISTS(SELECT 1 FROM candidates WHERE id=NEW.candidate_id)
          BEGIN SELECT RAISE(ABORT,'interviews.candidate_id 不存在'); END;
          CREATE TRIGGER IF NOT EXISTS fk_channel_expense_insert BEFORE INSERT ON channel_expenses
          WHEN NOT EXISTS(SELECT 1 FROM recruiting_channels WHERE id=NEW.channel_id)
          BEGIN SELECT RAISE(ABORT,'channel_expenses.channel_id 不存在'); END;
          CREATE TRIGGER IF NOT EXISTS fk_headcount_department_insert BEFORE INSERT ON headcount_plan
          WHEN NOT EXISTS(SELECT 1 FROM departments WHERE id=NEW.department_id)
          BEGIN SELECT RAISE(ABORT,'headcount_plan.department_id 不存在'); END;
          CREATE TRIGGER IF NOT EXISTS fk_budget_department_insert BEFORE INSERT ON cost_budgets
          WHEN NEW.department_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM departments WHERE id=NEW.department_id)
          BEGIN SELECT RAISE(ABORT,'cost_budgets.department_id 不存在'); END;
          CREATE TRIGGER IF NOT EXISTS attendance_values_insert BEFORE INSERT ON attendance_days
          WHEN NEW.scheduled_work_days<=0 OR NEW.work_days<0 OR NEW.work_days>NEW.scheduled_work_days OR NEW.ot_weekday_hours<0 OR NEW.ot_rest_hours<0 OR NEW.ot_holiday_hours<0 OR NEW.unpaid_leave_days<0
          BEGIN SELECT RAISE(ABORT,'考勤数值不合法'); END;
          CREATE TRIGGER IF NOT EXISTS attendance_values_update BEFORE UPDATE ON attendance_days
          WHEN NEW.scheduled_work_days<=0 OR NEW.work_days<0 OR NEW.work_days>NEW.scheduled_work_days OR NEW.ot_weekday_hours<0 OR NEW.ot_rest_hours<0 OR NEW.ot_holiday_hours<0 OR NEW.unpaid_leave_days<0
          BEGIN SELECT RAISE(ABORT,'考勤数值不合法'); END;
          CREATE TRIGGER IF NOT EXISTS option_values_insert BEFORE INSERT ON option_grants
          WHEN NEW.share_count<=0 OR NEW.exercise_price<0 OR NEW.fair_value<NEW.exercise_price OR NEW.vesting_months<1 OR NEW.cliff_months<0 OR NEW.cliff_months>NEW.vesting_months
          BEGIN SELECT RAISE(ABORT,'期权授予数值不合法'); END;
          CREATE TRIGGER IF NOT EXISTS option_values_update BEFORE UPDATE ON option_grants
          WHEN NEW.share_count<=0 OR NEW.exercise_price<0 OR NEW.fair_value<NEW.exercise_price OR NEW.vesting_months<1 OR NEW.cliff_months<0 OR NEW.cliff_months>NEW.vesting_months
          BEGIN SELECT RAISE(ABORT,'期权授予数值不合法'); END;`
  },
  // v16：岗位与职级也进入生效月条款，防止未来调薪提前污染当前与历史预览
  {
    version: 16,
    sql: `ALTER TABLE employee_compensation_terms ADD COLUMN grade TEXT;
          ALTER TABLE employee_compensation_terms ADD COLUMN job_family TEXT;
          ALTER TABLE employee_compensation_terms ADD COLUMN category TEXT;
          UPDATE employee_compensation_terms
          SET grade=(SELECT e.grade FROM employees e WHERE e.id=employee_id),
              job_family=(SELECT e.job_family FROM employees e WHERE e.id=employee_id),
              category=(SELECT e.category FROM employees e WHERE e.id=employee_id)
          WHERE grade IS NULL OR job_family IS NULL OR category IS NULL;`
  },
  // v17：冻结社保个人逐险种费率，确保锁定批次的申报拆分不受后续政策变更影响
  {
    version: 17,
    sql: `ALTER TABLE payroll ADD COLUMN personal_pension_rate REAL;
          ALTER TABLE payroll ADD COLUMN personal_medical_rate REAL;
          ALTER TABLE payroll ADD COLUMN personal_unemployment_rate REAL;`
  },
  // v18：带宽须经审批后才可进入 Offer 分位判断；历史/演示对标默认未核验
  {
    version: 18,
    sql: `ALTER TABLE benchmarks ADD COLUMN verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1));`
  },
  // v19：旧会话曾以可直接使用的 token 存储；升级后只保存摘要并主动注销旧会话
  {
    version: 19,
    sql: `DELETE FROM sessions;`
  },
  // v20：费用制单人与审批人分离，防止财务或 CEO 自批本人提交的报销/预支
  {
    version: 20,
    sql: `ALTER TABLE expense_claims ADD COLUMN created_by_user_id INTEGER;
          ALTER TABLE employee_advances ADD COLUMN created_by_user_id INTEGER;`
  },
  // v21：冻结累计预扣所需的应发与税额拆分，后续月份以锁定历史为准
  {
    version: 21,
    sql: `ALTER TABLE payroll ADD COLUMN gross INTEGER;
          ALTER TABLE payroll ADD COLUMN regular_tax INTEGER;
          ALTER TABLE payroll ADD COLUMN severance_tax INTEGER;`
  }
]
export function migrate() {
  // 逐条记录已应用版本（applied_migrations），避免 MAX(version) 在版本缺口时漏应用
  db.exec('CREATE TABLE IF NOT EXISTS applied_migrations(version INTEGER PRIMARY KEY)')
  const applied = new Set(db.prepare('SELECT version FROM applied_migrations').all().map(r => r.version))
  // 兼容历史库：早期用 schema_version 的 MAX 判断，v1..legacyMax 均已被应用过
  if (applied.size === 0) {
    const legacy = db.prepare('SELECT COALESCE(MAX(version),0) v FROM schema_version').get().v
    for (let v = 1; v <= legacy; v++) {
      db.prepare('INSERT OR IGNORE INTO applied_migrations(version) VALUES(?)').run(v)
      applied.add(v)
    }
  }
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue
    db.exec('BEGIN')
    try {
      db.exec(m.sql)
      db.prepare('INSERT INTO applied_migrations(version) VALUES(?)').run(m.version)
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
  const calc = scryptSync(pw, salt, 32)
  const storedBuf = Buffer.from(hash, 'hex')
  if (calc.length !== storedBuf.length) return false
  return timingSafeEqual(calc, storedBuf)
}
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000

export function sessionTokenHash(token) {
  return createHash('sha256').update(String(token || '')).digest('hex')
}

export function createSession(userId) {
  const token = randomBytes(32).toString('base64url')
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
  const expires = Date.now() + SESSION_MAX_AGE_MS
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(sessionTokenHash(token), userId, expires)
  return token
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(sessionTokenHash(token))
}

const AUDIT_REDACT = new Set(['password_hash', 'token', 'id_number', 'bank_account', 'social_security_no', 'housing_fund_no', 'mobile', 'phone', 'personal_email', 'email', 'resume_parsed', 'resume_path', 'file_path', 'filename', 'original_name', 'resume_name', 'parsed_data', 'text_preview'])
function sanitizeAudit(value) {
  if (Array.isArray(value)) return value.map(sanitizeAudit)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, AUDIT_REDACT.has(key) ? '[REDACTED]' : sanitizeAudit(item)]))
}

export function audit(user, action, entityType, entityId, before = null, after = null) {
  db.prepare('INSERT INTO audit_logs(actor_user_id,actor_name,action,entity_type,entity_id,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(user?.id || null, user?.name || 'system', action, entityType, entityId == null ? null : String(entityId), before == null ? null : JSON.stringify(sanitizeAudit(before)), after == null ? null : JSON.stringify(sanitizeAudit(after)), new Date().toISOString())
}

export function inTransaction(fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}


if (process.argv.includes('--seed-only')) {
  import('./seed.js').then(m => {
    m.seedIfEmpty()
    console.log('[seed] 完成，数据库:', DB_PATH)
  })
}
