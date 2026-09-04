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
INITIAL_ADMIN_PASSWORD="${INITIAL_ADMIN_PASSWORD:-}"
TLS_CERT_PATH="${TLS_CERT_PATH:-}"
TLS_KEY_PATH="${TLS_KEY_PATH:-}"
PORT=3001
SERVICE=payroll-api
DATA_DIR=/var/lib/payroll

log() { echo -e "\033[1;32m[deploy]\033[0m $*"; }
warn() { echo -e "\033[1;33m[deploy!]\033[0m $*"; }

# 0. 前置检查
[ "$(id -u)" -eq 0 ] || { warn "请用 root 运行（或 sudo bash deploy.sh）"; exit 1; }
[ -d "$APP_DIR/payroll-backend" ] || { warn "未找到 $APP_DIR/payroll-backend——请先把项目代码上传到 $APP_DIR（scp -r 或 git clone）"; exit 1; }
[ "$DOMAIN" != "payroll.example.com" ] || { warn "必须通过 DOMAIN 设置真实域名"; exit 1; }
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || { warn "DOMAIN 只能包含字母、数字、点和连字符"; exit 1; }
[ "${#INITIAL_ADMIN_PASSWORD}" -ge 12 ] || { warn "必须设置至少 12 位 INITIAL_ADMIN_PASSWORD"; exit 1; }
[[ "$INITIAL_ADMIN_PASSWORD" != *$'\n'* ]] || { warn "INITIAL_ADMIN_PASSWORD 不能包含换行"; exit 1; }
[ -f "$TLS_CERT_PATH" ] && [ -f "$TLS_KEY_PATH" ] || { warn "必须设置有效的 TLS_CERT_PATH 与 TLS_KEY_PATH"; exit 1; }

# 1. Node 版本检查（使用系统级 Node，避免服务引用 root 私有 nvm 路径）
command -v node >/dev/null || { warn "请先安装系统级 Node.js >=22.12.0"; exit 1; }
node -e "const [a,b]=process.versions.node.split('.').map(Number); if(a<22||(a===22&&b<12)) process.exit(1)" || { warn "Node.js 必须 >=22.12.0"; exit 1; }
log "Node: $(node -v)"

# 2. 后端依赖 + 生产 .env
log "安装后端依赖..."
cd "$APP_DIR/payroll-backend"
npm ci --omit=dev --no-fund --cache /tmp/npm-cache-deploy
touch .env
EXISTING_DB_PATH="$(sed -n 's/^DB_PATH=//p' .env | tail -n 1)"
EXISTING_UPLOAD_DIR="$(sed -n 's/^UPLOAD_DIR=//p' .env | tail -n 1)"
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}
grep -q '^LLM_API_KEY=' .env || printf 'LLM_API_KEY=%s\n' "$LLM_API_KEY" >> .env
grep -q '^LLM_BASE_URL=' .env || printf 'LLM_BASE_URL=https://api.deepseek.com\n' >> .env
grep -q '^LLM_MODEL=' .env || printf 'LLM_MODEL=deepseek-chat\n' >> .env
grep -q '^COPILOT_EXTERNAL_LLM=' .env || printf 'COPILOT_EXTERNAL_LLM=false\n' >> .env
grep -q '^RESUME_EXTERNAL_LLM=' .env || printf 'RESUME_EXTERNAL_LLM=false\n' >> .env
grep -q '^INITIAL_ADMIN_PASSWORD=' .env || printf 'INITIAL_ADMIN_PASSWORD=%s\n' "$INITIAL_ADMIN_PASSWORD" >> .env
set_env NODE_ENV production
set_env COOKIE_SECURE 1
set_env CORS_ORIGINS "https://$DOMAIN"
set_env DB_PATH "$DATA_DIR/payroll.db"
set_env UPLOAD_DIR "$DATA_DIR/uploads"
chmod 600 .env

# 3. 前端构建
log "构建前端..."
cd "$APP_DIR/payroll-react"
npm ci --no-fund --cache /tmp/npm-cache-deploy
npm run build

# 4. systemd 服务
log "安装 systemd 服务 $SERVICE..."
id -u payroll >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin payroll
systemctl is-active --quiet "$SERVICE" && systemctl stop "$SERVICE" || true
install -d -m 700 -o payroll -g payroll "$DATA_DIR" "$DATA_DIR/uploads"
if [ -n "$EXISTING_DB_PATH" ] && [[ "$EXISTING_DB_PATH" != /* ]]; then
  EXISTING_DB_PATH="$APP_DIR/payroll-backend/$EXISTING_DB_PATH"
fi
if [ ! -f "$DATA_DIR/payroll.db" ]; then
  DB_SOURCE="$EXISTING_DB_PATH"
  [ -f "$DB_SOURCE" ] || DB_SOURCE="$APP_DIR/payroll-backend/payroll.db"
  if [ -f "$DB_SOURCE" ] && [ "$DB_SOURCE" != "$DATA_DIR/payroll.db" ]; then
    log "迁移旧数据库 $DB_SOURCE 到 $DATA_DIR"
    install -m 600 -o payroll -g payroll "$DB_SOURCE" "$DATA_DIR/payroll.db"
  fi
fi
if [ -n "$EXISTING_UPLOAD_DIR" ] && [[ "$EXISTING_UPLOAD_DIR" != /* ]]; then
  EXISTING_UPLOAD_DIR="$APP_DIR/payroll-backend/$EXISTING_UPLOAD_DIR"
fi
[ -d "$EXISTING_UPLOAD_DIR" ] || EXISTING_UPLOAD_DIR="$APP_DIR/payroll-backend/uploads"
if [ -d "$EXISTING_UPLOAD_DIR" ] && [ "$EXISTING_UPLOAD_DIR" != "$DATA_DIR/uploads" ] && [ -z "$(find "$DATA_DIR/uploads" -mindepth 1 -print -quit)" ]; then
  log "迁移旧上传文件到 $DATA_DIR/uploads"
  cp -a "$EXISTING_UPLOAD_DIR/." "$DATA_DIR/uploads/"
fi
chown -R payroll:payroll "$DATA_DIR"
chown payroll:payroll "$APP_DIR/payroll-backend/.env"
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=AI Payroll API
After=network.target

[Service]
WorkingDirectory=$APP_DIR/payroll-backend
ExecStart=$(command -v node) server.js
Environment=NODE_ENV=production
Environment=PORT=$PORT
EnvironmentFile=$APP_DIR/payroll-backend/.env
Restart=always
RestartSec=3
User=payroll
Group=payroll
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=$DATA_DIR
CapabilityBoundingSet=
LockPersonality=true
RestrictSUIDSGID=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now $SERVICE
sleep 1
if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null; then
  log "后端健康检查通过"
else
  warn "后端未就绪，部署中止。日志如下："
  journalctl -u "$SERVICE" -n 50 --no-pager || true
  exit 1
fi

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
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl http2;
    server_name $DOMAIN;
    ssl_certificate $TLS_CERT_PATH;
    ssl_certificate_key $TLS_KEY_PATH;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'" always;
    client_max_body_size 10m;
    root $APP_DIR/payroll-react/dist;
    index index.html;
    location /api/ {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
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
  HTTPS 入口: https://$DOMAIN
  安全清单  : 防火墙仅开放 80/443；定期轮换管理员密码与 TLS 证书
────────────────────────────────────────────
EOF
