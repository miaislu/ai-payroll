# 生产部署指南（AI 薪酬管理系统）

> 适用：把 MVP 部署到服务器（Linux，Nginx/Caddy + Node 22 + pm2/systemd + SQLite）
> 当前边界：SQLite 单机、会话库表。生产环境不会创建演示账号，首次启动必须提供强管理员密码。

## 1. 环境变量（后端）

| 变量 | 必填 | 说明 |
|---|---|---|
| `LLM_API_KEY` | 否 | 启用外部 LLM 时填写；简历解析仍需用户逐次授权 |
| `INITIAL_ADMIN_PASSWORD` | 首次启动必填 | 生产环境至少 12 位；只创建 founder 管理员 |
| `LLM_BASE_URL` / `LLM_MODEL` | 否 | 切换 OpenAI / 阿里云百炼等兼容端点 |
| `PORT` | 否 | 默认 3001 |
| `DB_PATH` | 否 | SQLite 文件路径，默认 `payroll.db` |
| `NODE_ENV` | 建议 | `production` |

## 2. 进程管理

**pm2（推荐）：**
```bash
npm i -g pm2
cd payroll-backend
pm2 start server.js --name payroll-api --env production
pm2 save && pm2 startup   # 开机自启
pm2 logs payroll-api
```

**systemd 单元（/etc/systemd/system/payroll-api.service）：**
```ini
[Unit]
Description=AI Payroll API
After=network.target

[Service]
WorkingDirectory=/opt/payroll/payroll-backend
ExecStart=/usr/bin/node server.js
Environment=NODE_ENV=production
Restart=always
RestartSec=3
User=payroll

[Install]
WantedBy=multi-user.target
```

## 3. HTTPS 反向代理（必须：薪酬数据最高敏感）

**Caddy（自动 HTTPS，推荐）：**
```
payroll.example.com {
    reverse_proxy 127.0.0.1:3001
}
```
**Nginx：**
```nginx
server {
    listen 443 ssl;
    server_name payroll.example.com;
    ssl_certificate     /etc/letsencrypt/live/payroll.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/payroll.example.com/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
前端构建产物（`payroll-react/dist`）由同一域名静态服务，`/api` 反代到后端。

## 4. 数据库备份与迁移

- **备份**（SQLite 在线备份最稳妥）：
  ```bash
  sqlite3 payroll.db ".backup '/backup/payroll-$(date +%F).db'"
  # crontab 每日执行
  ```
- **迁移**：`db.js` 内置 `schema_version` 表 + `MIGRATIONS` 数组，启动时按序自动应用——新增迁移只需往数组追加 `{version, sql}`。
- **上线前**：删除演示数据 `rm payroll.db` 重新初始化，或用生产数据重建。

## 5. 上线前安全清单（必须逐项执行）

| 项 | 操作 |
|---|---|
| 初始管理员 | 设置至少 12 位 `INITIAL_ADMIN_PASSWORD`；生产不会创建 founder/hr/emp 演示账号 |
| 隐藏 `.env` | `.env` 已在 `.gitignore`；检查服务器上权限 `chmod 600 .env` |
| 会话安全 | 当前 12h 会话 token 存库表；生产建议加 refresh token + 失效吊销 UI |
| 限流与防爆破 | 已启用按可信代理解析的 IP+账号失败限速；公网高流量部署建议再接网关级限流 |
| 抓取合规 | 对标抓取链路（如启用）遵守附录 A.2 风险地图，仅公开页低频抓取 |
| 审计日志 | 核心审批、入职和员工变更写入 `audit_logs`；另配置不可篡改日志导出和保留期限 |
| 静态加密 | SQLite 和上传文件必须位于云盘/文件系统加密卷；密钥不得与数据同卷保存 |
| 银行/证件数据 | 导出文件中的卡号/证件号为脱敏演示值；接入真实银行代发需替换为加密存储的真实账号并走银行规范格式 |

## 6. 容量与演进（MVP → 生产）

| 项 | 当前 | 演进 |
|---|---|---|
| 数据库 | SQLite 单机 | 员工规模 >1000 或需多实例时迁 PostgreSQL（迁移机制已预留） |
| 会话 | 库表 | Redis 会话 / JWT |
| 鉴权 | 用户名密码 + scrypt | 对接企业 SSO / OIDC |
| LLM | DeepSeek API | 可切换私有化部署模型（数据不出域） |
| 申报文件 | CSV 脱敏演示 | 对接税务/社保/银行官方接口或格式规范 |

## 7. 健康检查与监控

- `GET /api/health` → 存活探针（Caddy/Nginx 健康检查）
- 建议：`pm2 monit`、uptime 探针（如 UptimeRobot）监控 `/api/health`
- 日志：`pm2 logs` 或 systemd journal；LLM 调用失败会打 `[copilot] LLM 调用失败` 警告
