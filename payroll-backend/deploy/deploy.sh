#!/usr/bin/env bash
# AI 薪酬管理系统 · 一键部署脚本（Ubuntu/Debian/CentOS 通用，幂等可重跑）
# 用法（在服务器上）：
#   sudo bash deploy.sh
# 环境变量可覆盖：
#   APP_DIR=/opt/payroll DOMAIN=payroll.example.com LLM_API_KEY=sk-xxx
#   BACKUP_DIR=/var/backups/payroll BACKUP_RETENTION_DAYS=30
set -euo pipefail
umask 0077

APP_DIR="${APP_DIR:-/opt/payroll}"
DOMAIN="${DOMAIN:-payroll.example.com}"
LLM_API_KEY="${LLM_API_KEY:-}"
INITIAL_ADMIN_PASSWORD="${INITIAL_ADMIN_PASSWORD:-}"
TLS_CERT_PATH="${TLS_CERT_PATH:-}"
TLS_KEY_PATH="${TLS_KEY_PATH:-}"
CITY_POLICY_FILE="${CITY_POLICY_FILE:-}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/payroll}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_RCLONE_REMOTE="${BACKUP_RCLONE_REMOTE:-}"
BACKUP_RCLONE_CONFIG="${BACKUP_RCLONE_CONFIG:-/etc/payroll/rclone.conf}"
PORT=3001
SERVICE=payroll-api
DATA_DIR=/var/lib/payroll
BACKUP_SERVICE=payroll-backup
BACKUP_ENV=/etc/payroll/backup.env

log() { echo -e "\033[1;32m[deploy]\033[0m $*"; }
warn() { echo -e "\033[1;33m[deploy!]\033[0m $*"; }

# 0. 前置检查
[ "$(id -u)" -eq 0 ] || { warn "请用 root 运行（或 sudo bash deploy.sh）"; exit 1; }
[ -d "$APP_DIR/payroll-backend" ] || { warn "未找到 $APP_DIR/payroll-backend——请先把项目代码上传到 $APP_DIR（scp -r 或 git clone）"; exit 1; }
[ "$DOMAIN" != "payroll.example.com" ] || { warn "必须通过 DOMAIN 设置真实域名"; exit 1; }
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || { warn "DOMAIN 只能包含字母、数字、点和连字符"; exit 1; }
[[ "$INITIAL_ADMIN_PASSWORD" != *$'\n'* ]] || { warn "INITIAL_ADMIN_PASSWORD 不能包含换行"; exit 1; }
[[ "$BACKUP_DIR" == /* && "$BACKUP_DIR" != *[[:space:]]* ]] || { warn "BACKUP_DIR 必须是不含空白的绝对路径"; exit 1; }
case "$BACKUP_DIR/" in "$DATA_DIR/"*) warn "BACKUP_DIR 不能位于 DATA_DIR 内"; exit 1 ;; esac
[[ "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] && [ "$BACKUP_RETENTION_DAYS" -ge 1 ] || { warn "BACKUP_RETENTION_DAYS 必须是正整数"; exit 1; }
[[ "$BACKUP_RCLONE_REMOTE" != *[[:space:]]* ]] || { warn "BACKUP_RCLONE_REMOTE 不能包含空白"; exit 1; }
[ -f "$TLS_CERT_PATH" ] && [ -f "$TLS_KEY_PATH" ] || { warn "必须设置有效的 TLS_CERT_PATH 与 TLS_KEY_PATH"; exit 1; }

# 1. Node 版本检查（使用系统级 Node，避免服务引用 root 私有 nvm 路径）
command -v node >/dev/null || { warn "请先安装系统级 Node.js >=22.12.0"; exit 1; }
node -e "const [a,b]=process.versions.node.split('.').map(Number); if(a<22||(a===22&&b<12)) process.exit(1)" || { warn "Node.js 必须 >=22.12.0"; exit 1; }
NODE_BIN="$(command -v node)"
log "Node: $($NODE_BIN -v)"

# 备份依赖：SQLite 在线快照 + flock 防止重复执行。
if ! command -v sqlite3 >/dev/null 2>&1 || ! command -v flock >/dev/null 2>&1; then
  log "安装备份工具..."
  if command -v apt-get >/dev/null; then
    apt-get update -qq && apt-get install -y -qq sqlite3 util-linux
  elif command -v dnf >/dev/null; then
    dnf install -y sqlite util-linux
  else
    warn "请先安装 sqlite3 与 flock(util-linux)"
    exit 1
  fi
fi

# 2. 后端依赖 + 生产 .env
log "安装后端依赖..."
cd "$APP_DIR/payroll-backend"
npm ci --omit=dev --no-fund --cache /tmp/npm-cache-deploy
touch .env
EXISTING_DB_PATH="$(sed -n 's/^DB_PATH=//p' .env | tail -n 1)"
EXISTING_UPLOAD_DIR="$(sed -n 's/^UPLOAD_DIR=//p' .env | tail -n 1)"
set_env_file() {
  local file="$1" key="$2" value="$3" tmp
  [[ "$value" != *$'\n'* ]] || { warn "$key 不能包含换行"; exit 1; }
  tmp="$(mktemp "$(dirname "$file")/.env-XXXXXX")"
  grep -v "^${key}=" "$file" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$file"
}
remove_env_file() {
  local file="$1" key="$2" tmp
  [ -f "$file" ] || return 0
  tmp="$(mktemp "$(dirname "$file")/.env-XXXXXX")"
  grep -v "^${key}=" "$file" > "$tmp" || true
  chmod 600 "$tmp"
  mv "$tmp" "$file"
}
set_env() { set_env_file .env "$1" "$2"; }

if [ -n "$LLM_API_KEY" ]; then set_env LLM_API_KEY "$LLM_API_KEY"
else grep -q '^LLM_API_KEY=' .env || set_env LLM_API_KEY ''
fi
grep -q '^LLM_BASE_URL=' .env || printf 'LLM_BASE_URL=https://api.deepseek.com\n' >> .env
grep -q '^LLM_MODEL=' .env || printf 'LLM_MODEL=deepseek-chat\n' >> .env
grep -q '^COPILOT_EXTERNAL_LLM=' .env || printf 'COPILOT_EXTERNAL_LLM=false\n' >> .env
grep -q '^RESUME_EXTERNAL_LLM=' .env || printf 'RESUME_EXTERNAL_LLM=false\n' >> .env
remove_env_file .env INITIAL_ADMIN_PASSWORD
set_env NODE_ENV production
set_env COOKIE_SECURE 1
set_env DEMO_MODE false
set_env CORS_ORIGINS "https://$DOMAIN"
set_env DB_PATH "$DATA_DIR/payroll.db"
set_env UPLOAD_DIR "$DATA_DIR/uploads"
if [ -n "$CITY_POLICY_FILE" ]; then set_env CITY_POLICY_FILE "$CITY_POLICY_FILE"; fi
chmod 600 .env

# 3. 前端构建
log "构建前端..."
cd "$APP_DIR/payroll-react"
npm ci --no-fund --cache /tmp/npm-cache-deploy
npm run build

# 4. systemd 服务
log "安装 systemd 服务 $SERVICE..."
cd "$APP_DIR/payroll-backend"
id -u payroll >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin payroll
systemctl is-active --quiet "$SERVICE" && systemctl stop "$SERVICE" || true
install -d -m 700 -o payroll -g payroll "$DATA_DIR" "$DATA_DIR/uploads"
if [ -n "$EXISTING_DB_PATH" ] && [[ "$EXISTING_DB_PATH" != /* ]]; then
  EXISTING_DB_PATH="$APP_DIR/payroll-backend/$EXISTING_DB_PATH"
fi
if [ ! -f "$DATA_DIR/payroll.db" ]; then
  DB_SOURCE="$EXISTING_DB_PATH"
  [ -s "$DB_SOURCE" ] || DB_SOURCE="$APP_DIR/payroll-backend/payroll.db"
  if [ -s "$DB_SOURCE" ] && [ "$DB_SOURCE" != "$DATA_DIR/payroll.db" ]; then
    log "迁移旧数据库 $DB_SOURCE 到 $DATA_DIR"
    sqlite3 "$DB_SOURCE" ".timeout 5000" ".backup '$DATA_DIR/payroll.db'"
    chmod 600 "$DATA_DIR/payroll.db"
    chown payroll:payroll "$DATA_DIR/payroll.db"
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

# 4a. 安装备份程序与配置。现有数据库在任何迁移/启动前先备份。
install -m 750 -o root -g root "$APP_DIR/payroll-backend/deploy/backup.sh" /usr/local/sbin/payroll-backup
install -d -m 700 /etc/payroll "$BACKUP_DIR"
touch "$BACKUP_ENV"
set_env_file "$BACKUP_ENV" DATA_DIR "$DATA_DIR"
set_env_file "$BACKUP_ENV" DB_PATH "$DATA_DIR/payroll.db"
set_env_file "$BACKUP_ENV" UPLOAD_DIR "$DATA_DIR/uploads"
set_env_file "$BACKUP_ENV" CITY_POLICY_FILE "${CITY_POLICY_FILE:-$(sed -n 's/^CITY_POLICY_FILE=//p' "$APP_DIR/payroll-backend/.env" | tail -n 1)}"
set_env_file "$BACKUP_ENV" BACKUP_DIR "$BACKUP_DIR"
set_env_file "$BACKUP_ENV" BACKUP_RETENTION_DAYS "$BACKUP_RETENTION_DAYS"
set_env_file "$BACKUP_ENV" PAYROLL_SERVICE "$SERVICE"
set_env_file "$BACKUP_ENV" RCLONE_CONFIG "$BACKUP_RCLONE_CONFIG"
if [ -n "$BACKUP_RCLONE_REMOTE" ] || ! grep -q '^RCLONE_REMOTE=' "$BACKUP_ENV"; then
  set_env_file "$BACKUP_ENV" RCLONE_REMOTE "$BACKUP_RCLONE_REMOTE"
fi
chmod 600 "$BACKUP_ENV"

if [ -s "$DATA_DIR/payroll.db" ]; then
  log "生成部署前安全备份..."
  DATA_DIR="$DATA_DIR" DB_PATH="$DATA_DIR/payroll.db" UPLOAD_DIR="$DATA_DIR/uploads" \
    CITY_POLICY_FILE="$(sed -n 's/^CITY_POLICY_FILE=//p' .env | tail -n 1)" \
    BACKUP_DIR="$BACKUP_DIR" BACKUP_RETENTION_DAYS="$BACKUP_RETENTION_DAYS" \
    PAYROLL_SERVICE="$SERVICE" RCLONE_REMOTE="$BACKUP_RCLONE_REMOTE" \
    RCLONE_CONFIG="$BACKUP_RCLONE_CONFIG" BACKUP_REASON=pre-deploy \
    /usr/local/sbin/payroll-backup
else
  [ "${#INITIAL_ADMIN_PASSWORD}" -ge 12 ] || { warn "全新数据库首次部署必须设置至少 12 位 INITIAL_ADMIN_PASSWORD"; exit 1; }
  log "初始化空数据库与 founder 管理员..."
  set_env INITIAL_ADMIN_PASSWORD "$INITIAL_ADMIN_PASSWORD"
  chown payroll:payroll .env
  if ! runuser -u payroll -- "$NODE_BIN" --input-type=module -e "import('./seed.js').then(m => m.seedIfEmpty())"; then
    remove_env_file .env INITIAL_ADMIN_PASSWORD
    warn "数据库初始化失败"
    exit 1
  fi
  remove_env_file .env INITIAL_ADMIN_PASSWORD
  chown payroll:payroll .env "$DATA_DIR/payroll.db" "$DATA_DIR/payroll.db-wal" "$DATA_DIR/payroll.db-shm" 2>/dev/null || true
fi

cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=AI Payroll API
After=network.target

[Service]
WorkingDirectory=$APP_DIR/payroll-backend
ExecStart=$NODE_BIN server.js
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

cat > /etc/systemd/system/$BACKUP_SERVICE.service <<EOF
[Unit]
Description=AI Payroll data backup
After=local-fs.target $SERVICE.service

[Service]
Type=oneshot
EnvironmentFile=$BACKUP_ENV
ExecStart=/usr/local/sbin/payroll-backup
User=root
Group=root
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
TimeoutStartSec=30min
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=$DATA_DIR $BACKUP_DIR
UMask=0077
EOF

cat > /etc/systemd/system/$BACKUP_SERVICE.timer <<EOF
[Unit]
Description=Daily AI Payroll backup

[Timer]
OnCalendar=*-*-* 02:30:00
RandomizedDelaySec=15m
Persistent=true
AccuracySec=1m
Unit=$BACKUP_SERVICE.service

[Install]
WantedBy=timers.target
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
    client_max_body_size 12m;
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

# certbot 续期后必须 reload nginx，否则会继续提供旧证书。
if command -v certbot >/dev/null 2>&1 && [ -d /etc/letsencrypt/renewal-hooks/deploy ]; then
  cat > /etc/letsencrypt/renewal-hooks/deploy/reload-payroll-nginx <<'EOF'
#!/usr/bin/env sh
systemctl reload nginx
EOF
  chmod 750 /etc/letsencrypt/renewal-hooks/deploy/reload-payroll-nginx
fi

# 6. 防火墙（按发行版）
command -v ufw >/dev/null && { ufw allow 80/tcp >/dev/null 2>&1; ufw allow 443/tcp >/dev/null 2>&1 || true; }
command -v firewall-cmd >/dev/null && { firewall-cmd --permanent --add-service=http 2>/dev/null || true; firewall-cmd --permanent --add-service=https 2>/dev/null || true; firewall-cmd --reload 2>/dev/null || true; }

# 7. 启用每日定时备份，并立即生成一份可验证的初始备份。
systemctl enable $BACKUP_SERVICE.timer
log "生成部署后初始备份..."
systemctl start $BACKUP_SERVICE.service
systemctl start $BACKUP_SERVICE.timer
systemctl is-enabled --quiet $BACKUP_SERVICE.timer && systemctl is-active --quiet $BACKUP_SERVICE.timer \
  || { warn "自动备份定时器未正常启用"; exit 1; }
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null || { warn "备份后 API 未恢复"; exit 1; }
LATEST_BACKUP="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'payroll-*.tar.gz' -print | sort | tail -n 1)"
[ -n "$LATEST_BACKUP" ] && [ -f "$LATEST_BACKUP.sha256" ] || { warn "初始备份或校验文件未生成"; exit 1; }

log "部署完成！"
cat <<EOF
────────────────────────────────────────────
  后端服务  : http://127.0.0.1:$PORT/api/health
  HTTPS 入口: https://$DOMAIN
  自动备份  : 每日 02:30（随机延迟 <=15 分钟）→ $BACKUP_DIR
  初始备份  : $LATEST_BACKUP
  安全清单  : 防火墙仅开放 80/443；定期轮换管理员密码与 TLS 证书
────────────────────────────────────────────
EOF
