# 小公司人力管理系统 · 架构

> 基于 `ai-payroll` MVP 扩展。参考 [Frappe HR](https://github.com/frappe/hrms) 的模块切分（Employee / Recruitment / Payroll / Performance），保持 Node + Express + `node:sqlite` 与 React + Vite。
> 目标画像：**30–150 人小公司**（演示种子是半导体初创），HR 1–2 人，CEO 兼兜底审批，**财务审发钱类事项**。

---

## 1. 定位一句话

> **小公司的内部人力系统：人、招聘、考勤绩效、算薪成本、期权报销在一套里。** 对标带宽帮助定薪，成本驾驶舱帮助看烧钱。带宽 HR/CEO 审；调薪、期权、Offer、报销、月结由财务或 CEO 审。

## 2. 模块全景（对比 Frappe HR 映射）

| 模块 | 对应 Frappe HR | 核心功能 | 优先级 |
|---|---|---|---|
| 工作台 Dashboard | HR Dashboard | 在职 / 招聘 / 待审批 / 成本 | P0 |
| 招聘 Recruitment | Job Opening / Applicant / Interview / Offer / Onboarding | 需求、Kanban、面试、Offer（带宽引用 + HR/CEO 审批）、入职建档、渠道费用 | P0 |
| 员工 Employees | Employee / Promotion / Transfer / Separation | 档案、完整人事字段、入转调离 | P0 |
| 组织 Org | Department | 部门树、编制计划 | P0 |
| 考勤 Attendance | Attendance | 加班小时写入未提交算薪 | P0 |
| 绩效 Performance | Performance | 周期评级；S/A/B 发起调薪 | P0 |
| 薪酬 Payroll | Payroll / Salary Structure | 累计预扣、城市社保公积金、薪酬单；财务/CEO 提交月结 | P0 |
| 成本 Cost | 成本分析（自研） | 公司口径成本、预算、编制预测 | P0 |
| 期权 Equity | ESOP（自研） | 模拟 + 授予台账摊销 | P0 |
| 报销 Expenses | Expense Claim / Advance | 员工提交；财务/CEO 审批与核销 | P0 |
| 审批 Approvals | Workflow | 带宽：HR/CEO；调薪/期权/Offer：财务/CEO。报销与月结同财务。无多级会签 | P0 |
| AI 助手 Copilot | Assist | 制度与政策问答 | P1 |
| 设置 Settings | Setup | 账号（仅 CEO）、对标样本导入、审计 | P2 |

## 3. 关键数据模型（新增表）

```
departments(id, name, parent_id, head, budget_owner)          -- 组织树
job_requisitions(id, title, department_id, job_family, grade, city,
                 headcount, priority, status, salary_min, salary_max, reason,
                 created_by, created_at, closed_at)            -- 招聘需求/编制
candidates(id, name, phone, email, source_channel, requisition_id, stage,
           apply_date, expected_salary, offer_amount, offer_date,
           onboard_date, eval_score, reject_reason)            -- 候选人管线
interviews(id, candidate_id, round_no, interviewer, interview_date,
           result, score, notes)                               -- 面试轮次
recruiting_channels(id, name, type, contact, note)             -- 招聘渠道
channel_expenses(id, channel_id, year_month, amount, note)     -- 渠道费用
cost_budgets(id, year_month, department_id, category, amount, note) -- 成本预算
employee_events(id, employee_id, type, event_date, from_value, to_value, note) -- 入转调离
headcount_plan(id, department_id, year_month, planned, note)   -- 编制计划
```

## 4. 公司薪酬成本口径（成本管理核心）

```
公司月度成本 = 应发工资(gross=base+perf+ot)
            + 公司社保(社保基数×员工城市/账期的政策费率)
            + 公司公积金(公积金基数×员工城市/账期的政策费率)
            + 期权摊销(逐笔授予从授予月起按归属期直线确认)
```

- 个人侧（net/社保公积金/个税）沿用现有 `payroll.js` 规则引擎，**成本侧为新增独立计算**（计算与展示分离）。
- 招聘渠道费用作为独立经营成本进入预算对比，不混入员工薪酬成本；预算按 `部门 × 成本类别(salary/social/fund/option/recruiting/other)` 维护。

## 5. 招聘漏斗与成本指标

- 漏斗：新简历 → 初筛 → 面试 → Offer → 入职（各阶段转化率）
- 周期：平均招聘周期（申请→入职 天数）
- 成本：人均招聘成本 = 期间渠道费用 / 期间入职人数；Offer 接受率；渠道 ROI
- 每个 Offer 建议引用对标带宽（P25/P50/P75）+ 影响测算（相对带宽分位）

## 6. 前端导航

```
工作台
招聘管理      招聘总览 · 候选人管线 · 招聘需求 · 面试记录 · 渠道与成本
员工管理      员工档案 · 组织架构 · 考勤加班 · 绩效评级
薪酬与期权    算薪工作台 · 对标与带宽 · 期权模拟 · 授予台账 · 员工薪酬单
成本          成本总览 · 预算对比 · 成本预测
协同          审批中心 · 报销与预支 · AI 助手 · 设置
```

角色：CEO 全模块（账号与审计仅 CEO）；HR 人事与招聘（带宽审批、发起发钱类）；财务看算薪/成本/报销并审批发钱类；员工仅工作台、AI、本人薪酬单、报销、考勤与绩效。

---

## 7. 实现状态（v2 已落地）

| 项 | 状态 | 说明 |
|---|---|---|
| 数据模型 9 张新表 + 迁移 v1 | ✅ | departments / job_requisitions / candidates / interviews / recruiting_channels / channel_expenses / cost_budgets / employee_events / headcount_plan |
| 招聘管理 API + 页面 | ✅ | 需求 CRUD、Kanban 阶段流转、面试记录、渠道费用、漏斗/周期/成本统计、Offer 定薪建议 |
| **Offer → 入职闭环** | ✅ | `POST /api/recruiting/candidates/:id/onboard`：自动生成员工档案（部门/职级/月薪联动）+ 入职事件 + 需求满编自动关闭 |
| 薪酬成本 API + 页面 | ✅ | 成本总览（公司口径/部门×类别/环比归因）、预算对比、编制→成本预测、单位经济 |
| 预算/编制维护 | ✅ | `cost_budgets` 与 `headcount_plan` CRUD，预测与对比即时联动 |
| 员工生命周期 + 组织架构 | ✅ | 入转调离事件流、部门树、编制 vs 实际 |
| **员工完整档案 v3** | ✅ | 迁移 v2（22 个档案字段：性别/生日/婚姻/民族/学历/证件/手机/邮箱/地址/合同/社保/公积金/银行/技能等）+ 4 张子表（紧急联系人/教育经历/工作经历/家庭）；完整档案页（分区块展示 + 编辑 + 子表 CRUD） |
| AI 助手知识扩展 | ✅ | 新增 招聘成本/编制预测/公司成本口径/Offer 定薪 4 条知识 |
| 运行文档 | ✅ | README.md（运行 + 演示路径 + 演示账号） |

已补：考勤加班、绩效评级、期权台账、报销预支、审批落库、对标样本导入、财务角色。不做平台抓取；请假日历 / SSO / Postgres 仍不在范围内。

### 8.2 简历与 AI 解析（员工档案 v4）

- **上传**：`POST /api/employees/:id/resume`（multipart，multer，≤10MB）→ 存 `payroll-backend/uploads/resumes/` + `employee_resumes` 表（含 parse_status/parsed_data/text_preview）
- **解析**：`POST /api/employees/:id/resume/:rid/parse` → `lib/resume_parser.js` 文本提取（txt/md 直读、docx=mammoth、pdf=pdf-parse）→ 默认本地规则解析；只有 `RESUME_EXTERNAL_LLM=true`、已配置 Key 且用户逐次确认时才把脱敏正文发送给外部 LLM
- **应用**：`POST /api/employees/:id/resume/:rid/apply` → 白名单更新 employees 基础字段 + 追加教育/工作经历（同校/同公司去重）
- **前端**：员工档案页「简历与 AI 解析」区块：上传 → AI 解析 → 预览确认 → 一键应用；附件可下载/删除

### 8.3 招聘 → 成本全链路（v5）

- **候选人简历 AI 解析**：`POST /api/recruiting/candidates/:id/resume`（上传）+ `/parse`（解析）→ 自动打标签：技能列表、**岗位族推断**（13 类半导体岗位关键词规则）、**经验年数**（工作经历累加）；候选人页可上传/解析/下载/删除
- **Offer 审批流真实化**：`POST /api/recruiting/candidates/:id/offer-approval` 发起（自动引用对标带宽分位）→ 审批中心真实展示（候选人信息 + 现金 + 分位）→ **财务或 CEO** 审批带意见留痕（action_by/action_at/comment）→ 批准/驳回联动候选人 `offer_status`
- **需求 → 编制 → 成本预测联动**：招聘需求设置「预计到岗月」（target_month），进行中（open/interview）需求按 headcount 自动计入当月成本预测（`/api/cost/forecast` 的 plannedManual/plannedRequisition 拆分），需求关闭/取消自动移除；前端预测页展示「手动编制 vs 🎯招聘需求」来源
- 迁移 v3：candidates +7 字段 / job_requisitions +1 / approvals +5（ref_type/ref_id/action_by/action_at/comment）

### 8.4 期权授予台账（v6）

- **期权池** `option_pool`：池占比 / 总股数 / 估值 → 自动计算每股公允价、已授予/剩余股数
- **授予记录** `option_grants`：员工 / 授予日 / 股数 / 行权价 / 公允价 / 归属期（默认 48 月 + 12 月 cliff）
  - `授予价值 = 股数×10000 × (公允价 − 行权价)`；`月摊销 = 价值 ÷ 归属期`（后端自动计算）
  - 状态：归属中 / 已归属 / 已行权 / 已失效
- **摊销联动成本**：`lib/company_cost.js` 期权摊销为 **台账优先**，逐笔授予从授予月起按服务期直线确认，cliff 只影响归属状态而不延迟成本确认；无台账员工回退 `annual_option_value/12` 估算
- **前端**：期权授予台账页（池卡片 + 授予列表 + 新增/编辑/删除 + 按员工/部门摊销分布 + 实时价值预览）；成本页标注摊销来源（台账/估算）
- API：`/api/equity/{pool,grants,summary}`（GET/PUT/POST/DELETE）

### 8.5 多用工类型（v7：正式 / 顾问 / 实习生）

- 迁移 v5：`employees.employment_type`（employee / consultant / intern）
- **个税口径分三种**：
  - 正式员工：工资薪金，累计预扣法 + 社保公积金（原有）
  - **顾问**：劳务报酬，按月独立预扣（减 20% 或 800 → 20%/30%/40% 三级预扣率，速算扣除 0/2000/7000），**不缴社保公积金**、无绩效/加班；`consultantTax()` 实现在 `lib/payroll.js`
  - **实习生**：在校生实习按工资薪金累计预扣（5000/月减除 + 专项附加），**不缴社保公积金**
- **成本口径**：`lib/company_cost.js` 按类型分支——顾问成本 = 顾问费本身；实习生不叠加公司社保/公积金；正式员工费率来自城市账期政策配置
- 种子新增演示：顾工·顾问（模拟IC P6，3 万/月，劳务报酬预扣 5,200 → 实发 24,800）、小陈·实习（数字验证，8 千/月，累计预扣 90 → 实发 7,910）
- 前端：员工列表/表单/档案页显示「正式 / 顾问 / 实习生」用工类型
- 修复：`perf_ratio || 0.32` → `?? 0.32`（0 绩效被 falsy 误回退）

### 8.6 报销与预支（v8，参考 Frappe HR Expense Claim / Employee Advance）

- **数据模型**：`expense_claims`（报销单：类型/金额/日期/说明/状态/核销预支金额/审批留痕）+ `employee_advances`（预支：金额/事由/未核销余额/状态）
- **报销流程**：提交 → 审批（approve/reject，留痕）→ 打款（paid）；费用类型：差旅/餐饮/交通/办公/招待/其他
- **预支流程**：申请 → 发放（outstanding=金额）→ 报销核销（自动扣减 outstanding，结清标记 cleared）或还款（repay）
- **核销联动**：报销审批通过时，按 `advance_offset` 从该员工未核销预支中自动扣减（实测 2000→1000）
- **角色权限**：emp 可提交/查看本人；报销审批限 finance/founder；已审批的报销/预支不可删除
- 修复：org 挂载的 `writeAuth` 曾全局拦截所有 /api 非 GET 请求（导致 emp 报销被 403），已改为 org.js 内部写操作加角色中间件
