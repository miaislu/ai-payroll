# 生产部署指南（小公司人力管理系统）

> 适用：把 MVP 部署到服务器（Linux，Nginx/Caddy + Node 22 + pm2/systemd + SQLite）
> 当前边界：SQLite 单机、会话库表。默认不会创建任何演示业务数据，首次启动必须提供强管理员密码。

## 1. 环境变量（后端）

| 变量 | 必填 | 说明 |
|---|---|---|
| `LLM_API_KEY` | 否 | 启用外部 LLM 时填写；简历解析仍需用户逐次授权 |
| `COPILOT_EXTERNAL_LLM` | 否 | 默认 `false`；设为 `true` 后仍需用户逐次授权，发送前会脱敏 |
| `RESUME_EXTERNAL_LLM` | 否 | 默认 `false`；简历外发的独立总开关，仍需用户逐次授权 |
| `INITIAL_ADMIN_PASSWORD` | 首次启动必填 | 生产环境至少 12 位；只创建 founder 管理员 |
| `DEMO_MODE` | 否 | 仅本地演示可设为 `true`；生产严禁开启 |
| `CORS_ORIGINS` | 生产建议 | 额外允许的前端 Origin，逗号分隔 |
| `LLM_BASE_URL` / `LLM_MODEL` | 否 | 切换 OpenAI / 阿里云百炼等兼容端点 |
| `PORT` | 否 | 默认 3001 |
| `DB_PATH` | 否 | SQLite 文件路径，默认 `payroll.db` |
| `UPLOAD_DIR` | 否 | 上传文件目录；生产建议放在加密数据卷 |
| `CITY_POLICY_FILE` | 正式月结必填 | 经负责人核验的城市政策 JSON；有效期覆盖账期且字段完整时才能月结 |
| `COOKIE_SECURE` | 生产必填 | HTTPS 部署设为 `1`，会话 cookie 只通过安全连接发送 |
| `NODE_ENV` | 建议 | `production` |

政策文件示例（费率均为小数；每个实际用工城市和账期都要有有效记录）：

```json
{
  "policies": [{
    "city": "上海",
    "verified": true,
    "effective_from": "2026-07",
    "effective_to": "2027-06",
    "source": "人社、公积金中心及统计部门官方文件编号或链接",
    "social_base_min": 0,
    "social_base_max": 0,
    "fund_min": 0,
    "fund_max": 0,
    "personal_pension_rate": 0,
    "personal_medical_rate": 0,
    "personal_unemployment_rate": 0,
    "personal_social_rate": 0,
    "employer_social_rate": 0,
    "personal_fund_rate": 0,
    "employer_fund_rate": 0,
    "min_wage": 0,
    "local_avg_monthly_wage": 0
  }]
}
```

示例中的 `0` 只是字段占位，不是可直接使用的政策数值；录入后须由薪税负责人复核来源和有效期。

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

- **备份**（默认生产路径为 `/var/lib/payroll/payroll.db`；SQLite 在线备份最稳妥）：
  ```bash
  sqlite3 /var/lib/payroll/payroll.db ".backup '/backup/payroll-$(date +%F).db'"
  # crontab 每日执行
  ```
- **迁移**：`db.js` 内置 `schema_version` 表 + `MIGRATIONS` 数组，启动时按序自动应用——新增迁移只需往数组追加 `{version, sql}`。
- **上线前**：使用全新数据库或经核验的生产备份；不要通过自动迁移删除业务数据。
- **旧 v10 恢复**：若历史版本曾把工资移入 `payroll_archive_v10`，先备份数据库，再运行 `npm run payroll:recover-v10 -- --apply`。脚本默认仅检查，不自动覆盖现有工资。

## 5. 上线前安全清单（必须逐项执行）

| 项 | 操作 |
|---|---|
| 初始管理员 | 设置至少 12 位 `INITIAL_ADMIN_PASSWORD`；默认只创建 founder，不创建员工、工资、审批或其他演示数据 |
| 隐藏 `.env` | `.env` 已在 `.gitignore`；检查服务器上权限 `chmod 600 .env` |
| 会话安全 | 12h 服务端会话存库，浏览器仅持有 `HttpOnly`、`SameSite=Strict` cookie；生产必须启用 HTTPS 与 `COOKIE_SECURE=1` |
| 限流与防爆破 | 已启用按可信代理解析的 IP+账号失败限速；公网高流量部署建议再接网关级限流 |
| 抓取合规 | 对标抓取链路（如启用）遵守附录 A.2 风险地图，仅公开页低频抓取 |
| 审计日志 | 核心审批、入职和员工变更写入 `audit_logs`；另配置不可篡改日志导出和保留期限 |
| 静态加密 | SQLite 和上传文件必须位于云盘/文件系统加密卷；密钥不得与数据同卷保存 |
| 银行/证件数据 | 演示数据不是正式申报数据；接入真实信息前，数据库和备份必须位于加密卷，导出后应走受控传输并及时清理文件 |

## 6. 容量与演进（MVP → 生产）

| 项 | 当前 | 演进 |
|---|---|---|
| 数据库 | SQLite 单机 | 员工规模 >1000 或需多实例时迁 PostgreSQL（迁移机制已预留） |
| 会话 | 库表 | Redis 会话 / JWT |
| 鉴权 | 用户名密码 + scrypt | 对接企业 SSO / OIDC |
| LLM | DeepSeek API | 可切换私有化部署模型（数据不出域） |
| 申报文件 | 锁定批次 CSV（字段完整性校验） | 上线前按当地税务/社保/银行当期规范完成验收，或对接官方接口 |

## 7. 健康检查与监控

- `GET /api/health` → 存活探针（Caddy/Nginx 健康检查）
- 建议：`pm2 monit`、uptime 探针（如 UptimeRobot）监控 `/api/health`
- 日志：`pm2 logs` 或 systemd journal；LLM 调用失败会打 `[copilot] LLM 调用失败` 警告
