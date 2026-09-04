# 小公司人力管理系统

> 面向 **30–150 人小公司**（当前演示场景是半导体 Fabless/IDM/设备材料初创）的内部人力系统：组织与员工档案、招聘入职、考勤绩效、算薪与成本、期权与报销，都在一套里。招聘定薪和对标带宽仍是能力，但不再是产品边界。
>
> 角色四种：**CEO（founder）**、**HR**、**财务**、**员工**。带宽由 HR 或 CEO 审批；调薪 / 期权 / Offer / 报销 / 月结由 **财务或 CEO** 审批。不做多级会签。
>
> 架构见 [`NEW-ARCHITECTURE.md`](NEW-ARCHITECTURE.md)；早期薪酬专项设计稿见 [`ai-compensation-product-design.md`](ai-compensation-product-design.md)。

## 模块一览

| 模块 | 页面 | 说明 |
|---|---|---|
| 工作台 | `/` dashboard | 在职人数、招聘、待审批、成本一屏 |
| 招聘 | 招聘总览 · 候选人 · 需求 · 面试 · 渠道 | 漏斗与周期；Kanban；Offer 引用对标带宽；**Offer 审批通过后办理入职** |
| 员工与组织 | 员工档案 · 完整档案 · 组织架构 | 档案 CRUD、入转调离、部门树与编制 |
| 考勤与绩效 | 考勤加班 · 绩效评级 | 加班进未提交月份算薪；S/A/B 可发起调薪审批 |
| 薪酬与期权 | 算薪工作台 · 对标带宽 · 期权模拟 · 授予台账 · 薪酬单 | 累计预扣、城市社保公积金、期权摊销进成本 |
| 成本 | 成本总览 · 预算 · 预测 | 公司口径（应发 + 公司社保公积金 + 期权 + 招聘摊销） |
| 协同 | 审批中心 · 报销预支 · AI 助手 · 设置 | 带宽 HR/CEO；发钱类财务/CEO；员工报销 |

## 技术栈

- **后端**：Node.js ≥ 22（内置 `node:sqlite`）+ Express，数据库 `payroll.db`
- **前端**：React 18 + Vite
- **权限**：服务端 12h 会话 + `HttpOnly`、`SameSite=Strict` Cookie（不向前端 JavaScript 暴露 token），角色 founder / hr / finance / emp

## 运行

```bash
# 后端（端口 3001）
cd payroll-backend && npm install && npm start

# 前端（端口 5173，/api 自动代理到 3001）
cd payroll-react && npm install && npm run dev
```

浏览器打开 **http://127.0.0.1:5173**

演示账号（仅在显式执行 `DEMO_MODE=true npm start` 或 `npm run seed:demo` 后存在）：

> 默认启动不会创建演示业务数据。非演示模式的空数据库首次启动必须设置至少 12 位 `INITIAL_ADMIN_PASSWORD`，且只创建 founder 管理员。生产环境严禁设置 `DEMO_MODE=true`。

| 账号 | 密码 | 角色 |
|---|---|---|
| founder | admin123 | CEO：人事全模块、审批兜底、账号与审计 |
| hr | hr123 | HR：人事与招聘、带宽审批、发起发钱类审批 |
| finance | finance123 | 财务：算薪锁定、报销、调薪/Offer/期权审批、成本 |
| emp | emp123 | 员工：工作台 / AI / 薪酬单 / 报销 / 本人考勤与绩效 |

## 演示路径（10 分钟）

1. **工作台** → **候选人管线**（看板：新简历→初筛→面试→Offer→已入职）
2. Offer 阶段候选人 → **定薪建议** → **发起 Offer 审批** → 财务或 CEO 同意 → **办理入职**（自动建档、记入职事件）
3. **员工档案** → 完整档案（合同/社保/银行/教育经历）；底部可上传简历并 AI 解析
4. **考勤加班** → 填写加班小时 → 未提交月份的算薪与公司成本会带上加班费
5. **绩效评级** → S/A/B 发起调薪 → 财务或 CEO 同意后改月薪
6. **算薪工作台** → 预览工资单 → **财务复核并锁定** → 导出内部税社核对/银行代发清单；需完整证件/卡号，脱敏种子会 409
7. **成本总览 / 预算 / 预测** → 公司口径成本、超预算、编制计划

## 公司薪酬成本口径

```
公司月度成本 = 应发工资(base+perf+ot)
            + 公司社保(缴费基数×城市费率)
            + 公司公积金(缴费基数×城市费率)
            + 期权摊销(台账月摊销，无台账则回退年度价值÷12)
```

招聘渠道费用在预算对比中作为独立的全公司成本类别展示，不混入员工薪酬成本。预算按 `部门 × 成本类别(salary/social/fund/option/recruiting/other)` 维护；预测按 `headcount_plan` 聚合到顶层部门 × 人均成本。

## 数据库

首次启动自动建表并执行增量迁移；默认只创建初始管理员。演示种子必须通过 `DEMO_MODE=true` 显式开启。表结构变更走 `payroll-backend/db.js` 的 `MIGRATIONS`；重置前应先备份，生产库不得通过删库重置。

## 验证

```bash
cd payroll-backend && npm run check
cd payroll-react && npm test && npm run build
cd benchmark-data && python3 validate_benchmark.py
```

基准数据脚本只自动验证结构、区间、元数据与数字锚点；“通过”不替代对来源正文、样本口径和数值推导的人工复核。仓库内 CSV 仅为内部核对/导入清单，不宣称兼容任何税务、社保或银行的当前官方模板。生产部署必须使用 HTTPS、至少 12 位初始管理员密码、独立低权限系统用户，并确认数据库卷具备静态加密和备份恢复能力。
