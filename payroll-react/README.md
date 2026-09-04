# 小公司人力管理系统 · 前端

React + Vite 客户端，对接 `payroll-backend`。产品覆盖组织与档案、招聘入职、考勤绩效、算薪成本、期权报销。带宽由 HR/CEO 审批；调薪、期权、Offer、报销、月结由财务或 CEO 审批。

## 架构

```
payroll-react/      React 前端（Vite，:5173，/api 代理到后端）
payroll-backend/    Node 后端（Express + SQLite，:3001）
benchmark-data/     历史对标推导样例（默认未核验）+ 结构质量验证
```

## 快速开始（两个终端）

```bash
# 终端 1：后端（默认空库只创建初始 founder）
cd payroll-backend
npm install            # 若系统 npm 缓存报 EPERM，加 --cache /tmp/npm-cache-xxx
INITIAL_ADMIN_PASSWORD='<至少12位强密码>' npm start
# 仅本地演示时：DEMO_MODE=true npm start

# 终端 2：前端
cd payroll-react
npm install
npm run dev            # http://127.0.0.1:5173
```

打开 http://127.0.0.1:5173 —— 右上角显示「● 已连接后端」即联调成功；后端未启动时页面会明确提示数据不可用，不会用本地假数据代替。

## 接入真实 LLM（Copilot）

默认本地知识库检索即可用；外部 LLM 必须同时配置 Key、开启对应环境开关，并由用户逐次确认：

```bash
cd payroll-backend
cp .env.example .env        # 填入 LLM_API_KEY（DeepSeek 平台创建）
# 可选：LLM_BASE_URL / LLM_MODEL 切换 OpenAI / 阿里云百炼等兼容端点
npm start
```

- 引擎状态：前端 Copilot 标题显示「● LLM 引擎已启用」/「知识库引擎」
- **本地检索**：`lib/rag.js` 使用中文词项、字符二元组、同义词归一与 TF-IDF 余弦混合排序；调试接口 `GET /api/copilot/retrieval?q=...` 返回命中与评分。它不是法规时效性验证工具
- **多轮会话记忆**：同一 sessionId 保留最近 5 轮对话，支持追问（如"那公积金呢？"无需重复城市名）；「新会话」按钮清空记忆
- **城市政策参数表**：内置 13 个城市的历史资料只供预览。正式月结必须通过 `CITY_POLICY_FILE` 提供账期有效、来源明确且逐项核验的基数、逐险种费率、最低工资和上年社平工资；缺失时阻断月结
- 数据源策略（推荐分层，而非每次联网搜索）：① 城市参数表（主力，可控/快/便宜）→ ② 权威文档入库 RAG → ③ 联网搜索仅作"最新/未收录"补充（需另接搜索服务，待接入）
- 外部 LLM 默认关闭；Copilot 与简历解析各有独立环境开关，并要求用户逐次同意，发送前执行本地脱敏。未开启时使用本地检索/规则解析

## 后端 API（MVP）

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| POST | /api/auth/login | 用户名+密码登录（scrypt 哈希，会话 12h） | — |
| POST | /api/auth/logout | 注销会话 | 登录 |

| POST | /api/employees | 新增员工（校验职级/岗位/城市/月薪） | hr/founder |
| PUT | /api/employees/:id | 编辑员工 | hr/founder |
| DELETE | /api/employees/:id | 删除无工资/招聘历史的员工；有历史时须改离职 | hr/founder |
| GET | /api/health | 健康检查 | — |

| GET | /api/benchmarks/directions | 对标方向列表；演示带宽默认未核验 | 登录 |
| GET | /api/benchmarks?direction=&city=&exp=&type=&stage= | 带宽卡（服务端计算） | 登录 |
| GET | /api/approvals | 审批列表（SQLite 持久化） | 登录 |
| POST | /api/approvals/:id/action | approve/reject（刷新后状态保留） | 按类型：带宽 hr/founder；发钱类 finance/founder |
| GET | /api/payroll/:period | 算薪预览或读取锁定快照 | hr/finance/founder |
| POST | /api/payroll/:period/submit | 财务复核并锁定该月工资 | finance / founder |
| GET | /api/payroll/:period/export/:type | 内部核对/导入清单（tax/social/bank CSV） | finance/founder |
| GET | /api/dashboard/summary?period= | 成本汇总 + 环比归因 | hr/finance/founder |
| GET | /api/dashboard/trend?months=6 | 月度成本趋势 | hr/finance/founder |
| GET | /api/dashboard/distribution | 职级薪资分布 + 已审批市场 P50 参考 | hr/finance/founder |
| GET | /api/dashboard/attrition | 留才预警 | hr/finance/founder |
| GET | /api/dashboard/forecast?target=60 | 扩编成本预测 | hr/finance/founder |
| GET | /api/payslip/me | 本人薪酬单 | 登录 |
| POST | /api/copilot/ask | 本地知识检索；外部 LLM 需双重开启与逐次同意 | 登录 |
| POST | /api/option/simulate | 期权模拟（服务端计算） | hr/finance/founder |

快速测试：`curl http://127.0.0.1:3001/api/health`；浏览器登录后使用服务端会话 Cookie。API 不接受 `Authorization: Bearer` 旁路。

## 数据库

- SQLite（Node 内置 `node:sqlite`，零原生依赖）：`payroll-backend/payroll.db`
- 首次启动自动建表并迁移。默认只在空库创建由 `INITIAL_ADMIN_PASSWORD` 指定的 founder；只有显式 `DEMO_MODE=true` 才灌入演示账号和业务数据
- 迁移机制：`schema_version` 表 + `MIGRATIONS` 数组，未来改表结构按序自动应用
- 生产部署：见 `payroll-backend/DEPLOY.md`（进程/HTTPS/备份/安全清单）
- 重置演示状态：删除 `payroll.db` 重启即可（审批恢复 4 pending）

## 前端数据边界

| 页面 | 数据来源 |
|---|---|
| 总览仪表盘 | 后端计算数据；后端不可用时明确报错，不注入演示回退 |
| 对标与带宽 | 后端对标库；只有导入同口径样本并经双人审批的带宽可进入 Offer 判断 |
| 算薪工作台 | 后端累计预扣规则、账期政策、考勤与显式离职补偿；锁定后读不可变快照 |
| 导出 | 锁定批次的内部税社核对/银行导入清单；上线前须按接收方当期模板验收 |
| 审批中心 | 后端 SQLite 持久化；制单人与审批人分离 |
| AI 助手 | 后端本地知识检索；外部发送默认关闭且先脱敏 |
| 员工薪酬单 | 后端数据；员工仅能读取本人 |
| 期权模拟 | 前端纯函数计算（逻辑与后端一致，服务端接口已就绪） |

## 算薪规则引擎（lib/payroll.js v2）

- **累计预扣法**：全年累计收入 − 累计减除(5000/月) − 累计社保公积金 − 累计专项附加 → 年度综合所得税率表 → 减已预扣；逐月顺序生成 2025-01~06（已验证：张三 6 个月税额合计 = 按年累计口径一致）
- **城市社保公积金**：按 `城市 × 账期` 的经核验配置计算并冻结进锁定工资快照；未收录、过期或字段不完整的政策只做预览并阻断正式月结
- **离职结算**：补偿金额必须由 HR 显式录入；系统不擅自推导 N、代通知金或年假折算。录入金额在当地上年社平 3 倍以内免税，超出部分按年度税率表单独计税
- 未锁定月份按生效日薪酬条款和考勤实时预览；锁定后从不可变工资及公司成本快照读取
- 仪表盘趋势/归因由后端工资与成本口径计算

## 目录结构

```
payroll-backend/
├── server.js          # Express 装配、安全头与同源保护
├── db.js              # node:sqlite schema、迁移与审计
├── seed.js            # 初始管理员与显式演示种子
├── routes/            # 按业务域拆分的 API
├── lib/               # 算薪、成本、权限、政策与检索规则
└── payroll.db         # SQLite（自动生成）

payroll-react/
├── vite.config.js     # /api 代理 → :3001
└── src/
    ├── api.js         # API 客户端（仅 HttpOnly Cookie 会话，不保存 token）
    ├── App.jsx        # 壳：登录/权限/审批状态/后端连接状态
    ├── data.js        # 录入词典、导航与前端权限映射
    ├── lib/calc.js    # 前端纯计算（与后端一致）
    ├── components/    # Chart(SVG) / ui
    └── pages/         # 11 个页面
```

## 上线前仍需完成

1. 用官方来源维护各城市、各账期完整 `CITY_POLICY_FILE`，复核逐险种费率与有效期
2. 导入至少 5 条同城市/经验段/公司类型的可追溯样本，并由另一人审批带宽
3. 按目标税务、社保和银行的当期接口或模板对 CSV 做联调验收
4. 配置加密存储、离线备份恢复演练、集中不可篡改审计和企业 SSO/OIDC
