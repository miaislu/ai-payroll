#!/usr/bin/env bash
# AI 薪酬管理系统 · 一键部署脚本（Ubuntu/Debian/CentOS 通用，幂等可重跑）
# 用法（在服务器上）：
#   sudo bash deploy.sh
# 环境变量可覆盖：
#   APP_DIR=/opt/payroll DOMAIN=payroll.example.com LLM_API_KEY=sk-xxx
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/payroll}"
DOMAIN="${DOMAIN:-payroll.example.com}"
LLM_API_KEY="${LLM_API_KEY:-}"
PORT=3001
SERVICE=payroll-api

log() { echo -e "\033[1;32m[deploy]\033[0m $*"; }
warn() { echo -e "\033[1;33m[deploy!]\033[0m $*"; }

# 0. 前置检查
[ "$(id -u)" -eq 0 ] || { warn "请用 root 运行（或 sudo bash deploy.sh）"; exit 1; }
[ -d "$APP_DIR/payroll-backend" ] || { warn "未找到 $APP_DIR/payroll-backend——请先把项目代码上传到 $APP_DIR（scp -r 或 git clone）"; exit 1; }

# 1. Node 22（nvm 安装，避免发行版仓库版本过旧）
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  log "安装 Node 22（nvm）..."
  export NVM_DIR="$HOME/.nvm"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  . "$NVM_DIR/nvm.sh"
  nvm install 22
  nvm alias default 22
  export PATH="$NVM_DIR/versions/node/$(ls "$NVM_DIR/versions/node" | tail -1)/bin:$PATH"
fi
log "Node: $(node -v)"

# 2. 后端依赖 + 生产 .env
log "安装后端依赖..."
cd "$APP_DIR/payroll-backend"
npm install --omit=dev --no-audit --no-fund --cache /tmp/npm-cache-deploy || npm install --no-audit --no-fund --cache /tmp/npm-cache-deploy
if [ -n "$LLM_API_KEY" ]; then
  [ -f .env ] || printf 'LLM_API_KEY=%s\nLLM_BASE_URL=https://api.deepseek.com\nLLM_MODEL=deepseek-chat\nNODE_ENV=production\n' "$LLM_API_KEY" > .env
  chmod 600 .env
else
  [ -f .env ] || warn "未提供 LLM_API_KEY——已跳过 .env 生成，可之后手动创建（cp .env.example .env）"
fi

# 3. 前端构建
log "构建前端..."
cd "$APP_DIR/payroll-react"
npm install --no-audit --no-fund --cache /tmp/npm-cache-deploy
npm run build

# 4. systemd 服务
log "安装 systemd 服务 $SERVICE..."
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=AI Payroll API
After=network.target

[Service]
WorkingDirectory=$APP_DIR/payroll-backend
ExecStart=$(command -v node) server.js
Environment=NODE_ENV=production
Environment=PORT=$PORT
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now $SERVICE
sleep 1
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null && log "后端健康检查通过" || { warn "后端未就绪，查看日志: journalctl -u $SERVICE -n 50"; }

# 5. 反向代理（nginx）
if ! command -v nginx >/dev/null; then
  log "安装 nginx..."
  if command -v apt-get >/dev/null; then apt-get update -qq && apt-get install -y -qq nginx
  elif command -v dnf >/dev/null; then dnf install -y nginx
  fi
fi
cat > /etc/nginx/conf.d/payroll.conf <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 10m;
    root $APP_DIR/payroll-react/dist;
    index index.html;
    location /api/ {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    location / { try_files \$uri /index.html; }
}
EOF
nginx -t && systemctl enable --now nginx && systemctl reload nginx

# 6. 防火墙（按发行版）
command -v ufw >/dev/null && { ufw allow 80/tcp >/dev/null 2>&1; ufw allow 443/tcp >/dev/null 2>&1 || true; }
command -v firewall-cmd >/dev/null && { firewall-cmd --permanent --add-service=http 2>/dev/null || true; firewall-cmd --permanent --add-service=https 2>/dev/null || true; firewall-cmd --reload 2>/dev/null || true; }

log "部署完成！"
cat <<EOF
────────────────────────────────────────────
  后端服务  : http://127.0.0.1:$PORT/api/health
  HTTP 入口 : http://$DOMAIN
  HTTPS     : 配置域名解析后执行：
              apt install -y certbot python3-certbot-nginx && certbot --nginx -d $DOMAIN
  安全清单  : 1) 修改种子密码（db.js USERS） 2) 防火墙仅开放 80/443
              3) 薪酬数据在海外服务器的出境合规请阅读 DEPLOY-VOLCANO.md
────────────────────────────────────────────
EOF
