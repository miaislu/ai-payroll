# 生产部署指南（HR 管理系统）

> 适用：把 MVP 部署到服务器（Linux，Nginx + Node 22.12+ + systemd + SQLite）
> 当前边界：SQLite 单机、会话库表。默认不会创建任何演示业务数据，首次启动必须提供强管理员密码。

## 1. 环境变量（后端）

| 变量 | 必填 | 说明 |
|---|---|---|
| `LLM_API_KEY` | 否 | 启用外部 LLM 时填写；简历解析仍需用户逐次授权 |
| `COPILOT_EXTERNAL_LLM` | 否 | 默认 `false`；设为 `true` 后仍需用户逐次授权，发送前会脱敏 |
| `RESUME_EXTERNAL_LLM` | 否 | 默认 `false`；简历外发的独立总开关，仍需用户逐次授权 |
| `INITIAL_ADMIN_PASSWORD` | 首次启动必填 | 生产环境至少 12 位；只创建 founder 管理员；脚本初始化后会从 `.env` 移除 |
| `DEMO_MODE` | 否 | 仅本地演示可设为 `true`；生产严禁开启 |
| `CORS_ORIGINS` | 生产建议 | 额外允许的前端 Origin，逗号分隔 |
| `LLM_BASE_URL` / `LLM_MODEL` | 否 | 切换 OpenAI / 阿里云百炼等兼容端点 |
| `PORT` | 否 | 默认 3001 |
| `DB_PATH` | 否 | SQLite 文件路径，默认 `payroll.db` |
| `UPLOAD_DIR` | 否 | 上传文件目录；生产建议放在加密数据卷 |
| `CITY_POLICY_FILE` | 正式月结必填 | 经负责人核验的城市政策 JSON；有效期覆盖账期且字段完整时才能月结 |
| `COOKIE_SECURE` | 生产必填 | HTTPS 部署设为 `1`，会话 cookie 只通过安全连接发送 |
| `NODE_ENV` | 建议 | `production` |
| `BACKUP_DIR` | 否 | 默认 `/var/backups/payroll`；应位于加密磁盘，最好与数据盘分离 |
| `BACKUP_RETENTION_DAYS` | 否 | 本地备份保留天数，默认 30 |
| `BACKUP_RCLONE_REMOTE` | 否 | 可选 rclone 异地目标，例如 `s3:company-payroll/prod` |
| `BACKUP_RCLONE_CONFIG` | 否 | rclone 配置，默认 `/etc/payroll/rclone.conf` |

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

### 一键部署

```bash
cd /opt/payroll
sudo env \
  APP_DIR=/opt/payroll \
  DOMAIN=payroll.example.com \
  INITIAL_ADMIN_PASSWORD='密码管理器生成的随机长密码' \
  TLS_CERT_PATH=/etc/letsencrypt/live/payroll.example.com/fullchain.pem \
  TLS_KEY_PATH=/etc/letsencrypt/live/payroll.example.com/privkey.pem \
  CITY_POLICY_FILE=/etc/payroll/city-policies.json \
  BACKUP_RETENTION_DAYS=30 \
  bash payroll-backend/deploy/deploy.sh
```

脚本会在第一次部署后立即生成备份，并启用 `payroll-backup.timer`。后续重复部署时，已有数据库不再要求传入 `INITIAL_ADMIN_PASSWORD`，且会在启动迁移前生成 `pre-deploy` 备份。

## 2. 进程管理

**systemd（生产推荐，一键脚本会自动生成）：**
```bash
systemctl status payroll-api
journalctl -u payroll-api -f
```

**手动部署时的 systemd 单元示例：**
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

## 4. 自动备份、恢复与迁移

### 自动备份

部署脚本会安装 `/usr/local/sbin/payroll-backup`、`payroll-backup.service` 和 `payroll-backup.timer`。定时器每日 02:30 执行，最多随机延迟 15 分钟；关机错过后会在下次开机补跑。

每份归档包含：

- 通过 SQLite `.backup` 生成并经 `PRAGMA quick_check` 验证的 `payroll.db`。
- `/var/lib/payroll/uploads` 中的简历和附件。
- 已配置的 `city-policies.json`。
- 备份时间、原路径和数据库 SHA-256 的 `manifest.txt`。
- 整个 `.tar.gz` 归档的 `.sha256` 校验文件。

为保证数据库与附件属于同一一致性时点，备份会在低峰期短暂停止 API，归档完成后立即自动恢复。

```bash
# 查看下次执行时间
systemctl list-timers payroll-backup.timer

# 立即手动生成一份备份
systemctl start payroll-backup.service

# 检查最近执行日志和失败状态
journalctl -u payroll-backup.service -n 100 --no-pager
systemctl is-failed payroll-backup.service

# 校验归档未损坏
cd /var/backups/payroll
sha256sum -c payroll-YYYYMMDDTHHMMSSZ.tar.gz.sha256
```

默认备份只在本机保留 30 天。本地备份不能防范整机或云账号故障，正式上线应配置异地备份：

```bash
# 先用 root 配置并测试 /etc/payroll/rclone.conf，权限必须为 600
sudo chmod 600 /etc/payroll/rclone.conf

# 部署时传入（也可手工写入 /etc/payroll/backup.env）
BACKUP_RCLONE_REMOTE='s3:company-payroll/prod' bash payroll-backend/deploy/deploy.sh
```

异地目标应开启服务端加密、版本管理/不可变保留和独立权限。如已配置 `RCLONE_REMOTE` 但上传失败，本地备份仍会保留，但 systemd 任务会标记为失败，便于告警。

### 恢复演练

恢复会覆盖生产数据，应先进入维护窗口、确认目标归档，并先运行一次当前数据备份。

```bash
systemctl start payroll-backup.service
systemctl stop payroll-api

RESTORE_DIR="$(mktemp -d)"
cd /var/backups/payroll
sha256sum -c payroll-YYYYMMDDTHHMMSSZ.tar.gz.sha256
tar -xzf payroll-YYYYMMDDTHHMMSSZ.tar.gz -C "$RESTORE_DIR"
sqlite3 "$RESTORE_DIR/payroll.db" 'PRAGMA quick_check;'

install -m 600 -o payroll -g payroll "$RESTORE_DIR/payroll.db" /var/lib/payroll/payroll.db
rsync -a --delete "$RESTORE_DIR/uploads/" /var/lib/payroll/uploads/
chown -R payroll:payroll /var/lib/payroll/uploads
systemctl start payroll-api
curl -fsS http://127.0.0.1:3001/api/health
```

每季度至少在隔离环境完成一次恢复演练，并记录恢复时间和数据完整性。

- **迁移**：`db.js` 内置 `schema_version` 表 + `MIGRATIONS` 数组，启动时按序自动应用——新增迁移只需往数组追加 `{version, sql}`。
- **上线前**：使用全新数据库或经核验的生产备份；不要通过自动迁移删除业务数据。
- **旧 v10 恢复**：若历史版本曾把工资移入 `payroll_archive_v10`，先备份数据库，再运行 `npm run payroll:recover-v10 -- --apply`。脚本默认仅检查，不自动覆盖现有工资。

## 5. 上线前安全清单（必须逐项执行）

| 项 | 操作 |
|---|---|
| 初始管理员 | 设置至少 12 位 `INITIAL_ADMIN_PASSWORD`；默认只创建 founder；脚本初始化后不持久化该明文密码 |
| 隐藏 `.env` | `.env` 已在 `.gitignore`；检查服务器上权限 `chmod 600 .env` |
| 会话安全 | 12h 服务端会话存库，浏览器仅持有 `HttpOnly`、`SameSite=Strict` cookie；生产必须启用 HTTPS 与 `COOKIE_SECURE=1` |
| 限流与防爆破 | 已启用按可信代理解析的 IP+账号失败限速；公网高流量部署建议再接网关级限流 |
| 抓取合规 | 对标抓取链路（如启用）遵守附录 A.2 风险地图，仅公开页低频抓取 |
| 审计日志 | 核心审批、入职和员工变更写入 `audit_logs`；另配置不可篡改日志导出和保留期限 |
| 静态加密 | SQLite 和上传文件必须位于云盘/文件系统加密卷；密钥不得与数据同卷保存 |
| 银行/证件数据 | 演示数据不是正式申报数据；接入真实信息前，数据库和备份必须位于加密卷，导出后应走受控传输并及时清理文件 |
| 备份告警 | 监控 `payroll-backup.service` 失败状态；异地目标必须定期恢复演练，不只检查“有文件” |

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
- 建议：uptime 探针监控 `/api/health`，并对 `payroll-api.service` 失败配置告警
- 日志：`journalctl -u payroll-api`；LLM 调用失败会打 `[copilot] LLM 调用失败` 警告
- 备份：监控 `payroll-backup.service` 最后成功时间和 `/var/backups/payroll` 剩余空间；失败必须发送告警
