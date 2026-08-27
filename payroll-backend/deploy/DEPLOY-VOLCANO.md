# AI 薪酬管理系统 · 火山云海外服务器部署指南

> 适用：火山云（Volcano Engine）海外地域服务器（如新加坡/美西等 Linux 实例）
> 前置：已将项目代码上传到服务器（`scp -r payroll-backend payroll-react /opt/payroll/` 或 git clone），已开通 80/443 端口安全组

## 一、可行性结论

**可以部署**，且非常轻量：

| 项 | 要求 | 说明 |
|---|---|---|
| 服务器 | 1C2G 起 | Node + SQLite，当前规模绰绰有余 |
| 系统 | Ubuntu 20.04+/Debian 11+/CentOS 7+ | 脚本自动识别 |
| Node | 22+ | deploy.sh 自动装（nvm） |
| 域名 | 建议有（HTTPS 需要） | 无域名可先用 IP + HTTP 内网使用 |

## 二、部署步骤

```bash
# 1. 上传代码（本地执行）
scp -r payroll-backend payroll-react root@<服务器IP>:/opt/payroll/

# 2. SSH 到服务器，一键部署
ssh root@<服务器IP>
cd /opt/payroll
LLM_API_KEY=sk-你的Key DOMAIN=payroll.example.com bash payroll-backend/deploy/deploy.sh

# 3. 配置域名 DNS → 服务器 IP，然后启用 HTTPS
apt install -y certbot python3-certbot-nginx
certbot --nginx -d payroll.example.com
```

## 三、海外服务器特有注意事项

### 1. DeepSeek API 可达性 ✅
- `api.deepseek.com` 面向全球服务，从火山云海外地域**通常可直接访问**
- 万一被网络策略限制，改用国内可达的兼容端点（`.env` 修改）：
  ```
  LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
  LLM_MODEL=qwen-plus
  ```
  或 OpenAI 兼容任意端点

### 2. ⚠️ 数据出境合规（最重要，务必先评估）
系统存储**员工薪酬/社保/证件等敏感个人信息**。部署在**海外服务器 = 个人信息出境**，按《个人信息保护法》需：
- **最低要求**：向员工明示并取得同意（告知境外存储事实）；建立出境记录
- **正式路径**（数据量大/正式上线）：通过数据出境安全评估、或个人信息保护认证、或签订标准合同（三者选一）
- **替代建议**：
  - 薪酬数据留在境内服务器，海外只跑无敏感数据的功能；
  - 或干脆部署在火山云**国内地域**（本方案完全兼容，成本更低、无出境问题）
  - 若仅是团队内部试用、数据为测试数据：问题不大，但上线前必须处理

### 3. 国内同事访问海外服务器的延迟
- 国内 → 海外线路可能有 100-300ms 延迟与抖动；交互类页面可接受，但建议：
  - 测试连通性：`ping <IP>`、浏览器实测
  - 若体验差，考虑火山云国内地域或国内 CDN 加速

### 4. 安全加固（上线前必做）
| 项 | 操作 |
|---|---|
| 改种子密码 | `db.js` 中 `USERS` 的 admin123/hr123/emp123 必须改 |
| 安全组 | 火山云控制台仅放行 80/443/22（22 建议限定 IP） |
| HTTPS | certbot 自动证书；HTTP 强制跳转 |
| 限流 | 登录接口加 `express-rate-limit`（防止爆破） |
| 数据备份 | `sqlite3 payroll.db ".backup ..."` 每日 cron |

## 四、验证清单

```bash
curl http://127.0.0.1:3001/api/health          # 后端存活
curl -X POST http://<域名>/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"hr","password":"hr123"}'     # 登录
# 浏览器打开 https://<域名> → 登录 → 总览/算薪/导出各点一遍
```

## 五、回滚与运维

```bash
systemctl restart payroll-api      # 重启后端
journalctl -u payroll-api -f       # 看日志
cd /opt/payroll && git pull        # 更新代码后: npm run build && systemctl restart payroll-api
```
