# AI 薪酬管理系统 · 前后端 MVP

将 `payroll-prototype.html`（纯 HTML 原型）工程化并接入真实后端的前后端应用（对应设计文档 Phase 0）。

## 架构

```
payroll-react/      React 前端（Vite，:5173，/api 代理到后端）
payroll-backend/    Node 后端（Express + SQLite，:3001）
benchmark-data/     真实对标数据集（灌库来源）+ 质量验证
```

## 快速开始（两个终端）

```bash
# 终端 1：后端（首次自动建库并灌入 13 条真实对标数据）
cd payroll-backend
npm install            # 若系统 npm 缓存报 EPERM，加 --cache /tmp/npm-cache-xxx
npm start              # http://127.0.0.1:3001

# 终端 2：前端
cd payroll-react
npm install
npm run dev            # http://127.0.0.1:5173
```

打开 http://127.0.0.1:5173 —— 右上角显示「● 已连接后端」即联调成功；若后端未启动，前端自动降级为本地演示数据并提示。

## 接入真实 LLM（Copilot）

默认知识库规则匹配即可用；配置 Key 后自动切换 **RAG + 真实 LLM**：

```bash
cd payroll-backend
cp .env.example .env        # 填入 LLM_API_KEY（DeepSeek 平台创建）
# 可选：LLM_BASE_URL / LLM_MODEL 切换 OpenAI / 阿里云百炼等兼容端点
npm start
```

- 引擎状态：前端 Copilot 标题显示「● LLM 引擎已启用」/「知识库引擎」
- **向量检索（RAG 升级）**：`lib/rag.js` 采用**混合检索**：中文分词（词典最大匹配 + 字符二元组 + 同义词归一 11 组 + 停用词过滤）→ TF-IDF 稀疏向量余弦 → **关键词命中为主排序、余弦为次级**；能处理"员工被裁员了赔偿怎么算""被公司开除了有补偿吗"等说法（裁员→解除、赔偿→补偿同义扩展）。24 个回归用例全部命中目标语料。调试接口 `GET /api/copilot/retrieval?q=...` 返回命中/关键词分/余弦分。稠密 embedding（本地模型需 HuggingFace，当前网络不可达；也可接 embedding API）留作后续替换接口
- **多轮会话记忆**：同一 sessionId 保留最近 5 轮对话，支持追问（如"那公积金呢？"无需重复城市名）；「新会话」按钮清空记忆
- **城市政策参数表**：`lib/city_policies.js` 覆盖 12 个半导体城市；已收录（上海 7460/合肥 4227 等，带来源）直接回答，**未收录城市诚实提示"需人工核实"，不编数字**；数值每年随人社局通告人工更新
- 数据源策略（推荐分层，而非每次联网搜索）：① 城市参数表（主力，可控/快/便宜）→ ② 权威文档入库 RAG → ③ 联网搜索仅作"最新/未收录"补充（需另接搜索服务，待接入）
- 已用 Mock LLM 验证完整链路（RAG 命中 → 请求格式 → 降级路径），真实 DeepSeek 已联调通过

## 后端 API（MVP）

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| POST | /api/auth/login | 用户名+密码登录（scrypt 哈希，会话 12h） | — |
| POST | /api/auth/logout | 注销会话 | 登录 |

| POST | /api/employees | 新增员工（校验职级/岗位/城市/月薪） | hr/founder |
| PUT | /api/employees/:id | 编辑员工 | hr/founder |
| DELETE | /api/employees/:id | 删除员工（历史工资单保留快照） | hr/founder |
| GET | /api/health | 健康检查 | — |

| GET | /api/benchmarks/directions | 对标方向列表（13 方向，来自真实数据集） | 登录 |
| GET | /api/benchmarks?direction=&city=&exp=&type=&stage= | 带宽卡（服务端计算） | 登录 |
| GET | /api/approvals | 审批列表（SQLite 持久化） | 登录 |
| POST | /api/approvals/:id/action | approve/reject（刷新后状态保留） | founder |
| GET | /api/payroll/:period | 算薪（规则引擎生成并持久化的工资单） | 登录 |
| POST | /api/payroll/:period/submit | 提交财务复核 | hr |
| GET | /api/payroll/:period/export/:type | 申报导出（tax 个税/social 社保/bank 银行代发 CSV） | hr/founder |
| GET | /api/dashboard/summary?period= | 成本汇总 + 环比归因（新招聘/离职结算/社保调整/其他） | 登录 |
| GET | /api/dashboard/trend?months=6 | 月度成本趋势（真实工资单历史） | 登录 |
| GET | /api/dashboard/distribution | 职级薪资分布 + 市场 P50 参考 | 登录 |
| GET | /api/dashboard/attrition | 留才预警（低于带宽 P50×85% 或标记） | 登录 |
| GET | /api/dashboard/forecast?target=60 | 扩编成本预测（线性外推） | 登录 |
| GET | /api/payslip/me | 本人薪酬单 | 登录 |
| POST | /api/copilot/ask | 知识库问答（真实 LLM 待接入） | 登录 |
| POST | /api/option/simulate | 期权模拟（服务端计算，供调用/测试） | 登录 |

快速测试：`curl http://127.0.0.1:3001/api/health`；登录拿 token 后带 `Authorization: Bearer <token>`。

## 数据库

- SQLite（Node 内置 `node:sqlite`，零原生依赖）：`payroll-backend/payroll.db`
- 首次启动自动建表并灌入：用户 3 个（founder/admin123 · hr/hr123 · emp/emp123，scrypt 哈希）/ 员工 10 人 / 审批 5 条 / 对标 13 方向 / 6 个月工资单
- 迁移机制：`schema_version` 表 + `MIGRATIONS` 数组，未来改表结构按序自动应用
- 生产部署：见 `payroll-backend/DEPLOY.md`（进程/HTTPS/备份/安全清单）
- 重置演示状态：删除 `payroll.db` 重启即可（审批恢复 4 pending）

## 前端对接情况

| 页面 | 数据来源 |
|---|---|
| 总览仪表盘 | 后端真实数据（成本/归因/趋势/分布/预警/预测），后端不可用回退演示 |
| 对标与带宽 | 后端对标库（真实数据集）· 后端不可用回退本地表 |
| 算薪工作台 | 后端规则引擎工资单（个税月度预扣/社保 17.3%/加班/离职 N+1）· 回退本地演示行 |
| 申报导出 | 后端生成真实格式 CSV（个税扣缴/社保申报/银行代发），前端一键下载 |
| 审批中心 | 后端 SQLite（持久化，刷新不丢）· 回退本地 |
| AI 助手 | 后端知识库 · 回退本地 KB |
| 员工薪酬单 | 后端实时计算 · 回退静态 |
| 期权模拟 | 前端纯函数计算（逻辑与后端一致，服务端接口已就绪） |

## 算薪规则引擎（lib/payroll.js v2）

- **累计预扣法**：全年累计收入 − 累计减除(5000/月) − 累计社保公积金 − 累计专项附加 → 年度综合所得税率表 → 减已预扣；逐月顺序生成 2025-01~06（已验证：张三 6 个月税额合计 = 按年累计口径一致）
- **城市社保基数上下限**：缴费基数按城市参数表封顶（上海 2025：下限 7460 / 上限 37302=社平 12434×3，来源见城市参数表）；未收录城市不封顶
- 社保个人 10.3%（养老 8% + 医疗 2% + 失业 0.3%）+ 公积金 7% = 17.3%（按封顶后基数）
- **离职结算**：N+1 + 年假折算；补偿金当地上年社平 3 倍以内免税，超出按年度税率表单独计税
- 种子外月份（如 2025-07）走月度预扣兜底并标注 `fallback: true`
- 仪表盘趋势/归因全部由这些真实工资单计算（归因各项之和 = 环比增量，已校验）

## 目录结构

```
payroll-backend/
├── server.js          # Express 路由 + 鉴权中间件
├── db.js              # node:sqlite 建库 + 种子灌库
├── lib/calc.js        # 服务端计算（对标/期权/税率）
└── payroll.db         # SQLite（自动生成）

payroll-react/
├── vite.config.js     # /api 代理 → :3001
└── src/
    ├── api.js         # API 客户端（token 管理 + 降级）
    ├── App.jsx        # 壳：登录/权限/审批状态/后端连接状态
    ├── data.js        # 本地兜底数据 + 权限表
    ├── lib/calc.js    # 前端纯计算（与后端一致）
    ├── components/    # Chart(SVG) / ui
    └── pages/         # 11 个页面
```

## 下一步（Phase 0 → Phase 1）

1. 接真实 LLM（Copilot 从规则匹配 → RAG + 模型）
2. 仪表盘接口（成本趋势/归因从员工与工资单数据计算）
3. 申报/代发文件真实生成（个税/社保/银行格式）
4. 员工/审批管理页面（CRUD 补全，而非种子数据）
5. 生产部署（数据库迁移、鉴权升级、HTTPS）
