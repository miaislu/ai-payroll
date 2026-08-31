# AI 员工管理系统 v2 架构设计（半导体初创 · 招聘 + 薪酬成本双主线）

> 基于 `ai-payroll` MVP 重构。参考 [Frappe HR](https://github.com/frappe/hrms) 的模块化设计（Employee/Recruitment/Payroll/Performance 分模块、角色化视图、审批流），保持 Node+Express+node:sqlite 零依赖后端与 React+Vite 前端。
> 目标公司画像：30-150 人 Fabless/IDM/设备材料初创，快速扩张期，HR 1-2 人。

---

## 1. 定位一句话

> **半导体初创的"员工全生命周期 + 薪酬成本驾驶舱"：招聘定薪有依据（对标带宽）、薪酬成本看得见（公司口径成本 + 预算 + 预测）、AI 随叫随到。**

## 2. 模块全景（对比 Frappe HR 映射）

| 新模块 | 对应 Frappe HR | 核心功能 | 优先级 |
|---|---|---|---|
| 工作台 Dashboard | HR Dashboard | 员工/招聘/成本三合一 KPI | P0 |
| **招聘管理 Recruitment** ⭐ | Job Opening / Job Applicant / Interview / Job Offer / Employee Onboarding | 招聘需求、候选人管线（Kanban）、面试记录、Offer（现金+期权拆分+带宽引用+审批）、渠道与成本 | **P0** |
| 员工管理 Employees | Employee / Employee Promotion / Transfer / Separation | 员工档案 + 部门归属 + 入转调离事件流 | P0 |
| 组织架构 Org | Department | 部门树 + 编制计划 | P0 |
| 薪酬与算薪 Payroll | Payroll / Salary Structure | 算薪工作台、累计预扣、对标带宽、薪酬单、期权模拟（保留） | P0（保留） |
| **薪酬成本管理 Cost** ⭐ | 会计集成 / 成本分析（自研） | 公司口径成本（应发+公司社保公积金+期权摊销+招聘摊销）、部门×类别构成、预算 vs 实际、编制→成本预测、单位经济 | **P0** |
| 审批中心 Approvals | Workflow | 带宽/调薪/期权/Offer/招聘需求审批（保留+扩展） | P0 |
| AI 助手 Copilot | Frappe Assist（对标） | 制度+政策 RAG 问答（保留+扩展招聘/成本知识） | P1 |
| 设置 Settings | Setup | 知识库、城市政策、账号（保留） | P2 |

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
            + 公司社保(缴费基数×26%≈养老16+医疗9.5+失业0.5+工伤0.2)
            + 公司公积金(缴费基数×7%，与个人同比例)
            + 期权摊销(年度期权价值/12，可配置)
            + 招聘摊销(该员工入职月份渠道成本/12，可配置)
```

- 个人侧（net/社保公积金/个税）沿用现有 `payroll.js` 规则引擎，**成本侧为新增独立计算**（计算与展示分离）。
- 预算按 `部门 × 成本类别(salary/social/fund/option/recruiting/other)` 维护，实际由工资单 + 渠道费用聚合。

## 5. 招聘漏斗与成本指标

- 漏斗：新简历 → 初筛 → 面试 → Offer → 入职（各阶段转化率）
- 周期：平均招聘周期（申请→入职 天数）
- 成本：人均招聘成本 = 期间渠道费用 / 期间入职人数；Offer 接受率；渠道 ROI
- 每个 Offer 建议引用对标带宽（P25/P50/P75）+ 影响测算（相对带宽分位）

## 6. 前端导航（Frappe 风格模块分组）

```
📊 工作台        总览
🎯 招聘管理      招聘总览 · 候选人管线 · 招聘需求 · 面试记录 · 渠道与成本
👥 员工管理      员工档案 · 组织架构
🧮 薪酬          算薪工作台 · 员工薪酬单 · 对标与带宽 · 期权模拟
💰 薪酬成本      成本总览 · 预算对比 · 成本预测
✅ 审批中心
💬 AI 助手
⚙️ 设置
```

角色视图：founder/hr 全量；emp 仅 工作台/AI/薪酬单。

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

后续可选（未做，超出本轮范围）：考勤/请假、绩效评估、审批流程引擎化、期权授予台账（与成本预测打通）、LLM 真实接入。

### 8.2 简历与 AI 解析（员工档案 v4）

- **上传**：`POST /api/employees/:id/resume`（multipart，multer，≤10MB）→ 存 `payroll-backend/uploads/resumes/` + `employee_resumes` 表（含 parse_status/parsed_data/text_preview）
- **解析**：`POST /api/employees/:id/resume/:rid/parse` → `lib/resume_parser.js` 文本提取（txt/md 直读、docx=mammoth、pdf=pdf-parse）→ **LLM 优先（.env 配 LLM_API_KEY 后启用），未配置降级中文简历规则引擎**（姓名/性别/生日/婚姻/民族/学历/手机/邮箱/地址/技能 + 教育/工作经历结构化提取）
- **应用**：`POST /api/employees/:id/resume/:rid/apply` → 白名单更新 employees 基础字段 + 追加教育/工作经历（同校/同公司去重）
- **前端**：员工档案页「简历与 AI 解析」区块：上传 → AI 解析 → 预览确认 → 一键应用；附件可下载/删除

### 8.3 招聘 → 成本全链路（v5）

- **候选人简历 AI 解析**：`POST /api/recruiting/candidates/:id/resume`（上传）+ `/parse`（解析）→ 自动打标签：技能列表、**岗位族推断**（13 类半导体岗位关键词规则）、**经验年数**（工作经历累加）；候选人页可上传/解析/下载/删除
- **Offer 审批流真实化**：`POST /api/recruiting/candidates/:id/offer-approval` 发起（自动引用对标带宽分位）→ 审批中心真实展示（候选人信息 + 现金 + 分位）→ founder 审批带**意见留痕**（action_by/action_at/comment）→ 批准/驳回联动候选人 `offer_status`
- **需求 → 编制 → 成本预测联动**：招聘需求设置「预计到岗月」（target_month），进行中（open/interview）需求按 headcount 自动计入当月成本预测（`/api/cost/forecast` 的 plannedManual/plannedRequisition 拆分），需求关闭/取消自动移除；前端预测页展示「手动编制 vs 🎯招聘需求」来源
- 迁移 v3：candidates +7 字段 / job_requisitions +1 / approvals +5（ref_type/ref_id/action_by/action_at/comment）

### 8.4 期权授予台账（v6）

- **期权池** `option_pool`：池占比 / 总股数 / 估值 → 自动计算每股公允价、已授予/剩余股数
- **授予记录** `option_grants`：员工 / 授予日 / 股数 / 行权价 / 公允价 / 归属期（默认 48 月 + 12 月 cliff）
  - `授予价值 = 股数×10000 × (公允价 − 行权价)`；`月摊销 = 价值 ÷ 归属期`（后端自动计算）
  - 状态：归属中 / 已归属 / 已行权 / 已失效
- **摊销联动成本**：`lib/company_cost.js` 期权摊销改为 **台账优先**（active grants 月摊销求和），无台账员工回退 `annual_option_value/12` 估算；成本总览/预测自动更新（实测：新增授予即时 +5,104/月，编辑/删除即时联动）
- **前端**：期权授予台账页（池卡片 + 授予列表 + 新增/编辑/删除 + 按员工/部门摊销分布 + 实时价值预览）；成本页标注摊销来源（台账/估算）
- API：`/api/equity/{pool,grants,summary}`（GET/PUT/POST/DELETE）

### 8.5 多用工类型（v7：正式 / 顾问 / 实习生）

- 迁移 v5：`employees.employment_type`（employee / consultant / intern）
- **个税口径分三种**：
  - 正式员工：工资薪金，累计预扣法 + 社保公积金（原有）
  - **顾问**：劳务报酬，按月独立预扣（减 20% 或 800 → 20%/30%/40% 三级预扣率，速算扣除 0/2000/7000），**不缴社保公积金**、无绩效/加班；`consultantTax()` 实现在 `lib/payroll.js`
  - **实习生**：在校生实习按工资薪金累计预扣（5000/月减除 + 专项附加），**不缴社保公积金**
- **成本口径**：`lib/company_cost.js` 按类型分支——顾问成本 = 顾问费本身；实习生无公司社保/公积金负担（27%+7% 不叠加）
- 种子新增演示：顾工·顾问（模拟IC P6，3 万/月，劳务报酬预扣 5,200 → 实发 24,800）、小陈·实习（数字验证，8 千/月，累计预扣 90 → 实发 7,910）
- 前端：员工列表/表单/档案页显示「正式 / 顾问 / 实习生」用工类型
- 修复：`perf_ratio || 0.32` → `?? 0.32`（0 绩效被 falsy 误回退）
