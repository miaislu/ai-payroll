#!/bin/bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_BACKEND="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_ROOT="$(cd "$SOURCE_BACKEND/.." && pwd)"
SOURCE_FRONTEND="$SOURCE_ROOT/payroll-react"
USER_HOME_DIR="${HOME:?无法确定用户主目录}"
APP_ROOT="${PAYROLL_APP_ROOT:-$USER_HOME_DIR/Library/Application Support/AI Payroll}"
DATA_DIR="${PAYROLL_DATA_DIR:-$APP_ROOT/data}"
RELEASES_DIR="$APP_ROOT/releases"
CURRENT_LINK="$APP_ROOT/current"
BACKUP_DIR="${PAYROLL_BACKUP_DIR:-$USER_HOME_DIR/Library/Application Support/AI Payroll Backups}"
LAUNCH_AGENTS_DIR="$USER_HOME_DIR/Library/LaunchAgents"
APP_LABEL="com.aipayroll.local"
BACKUP_LABEL="com.aipayroll.backup"
APP_PLIST="$LAUNCH_AGENTS_DIR/$APP_LABEL.plist"
BACKUP_PLIST="$LAUNCH_AGENTS_DIR/$BACKUP_LABEL.plist"
MODEL_LABEL="com.aipayroll.resume-model"
MODEL_PLIST="$LAUNCH_AGENTS_DIR/$MODEL_LABEL.plist"
LAUNCH_DOMAIN="gui/$(id -u)"
NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"
STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
RELEASE_DIR="$RELEASES_DIR/$STAMP"
DB_PATH="$DATA_DIR/payroll.db"
UPLOAD_DIR="$DATA_DIR/uploads"
LOG_DIR="$APP_ROOT/logs"
INITIAL_PASSWORD=""
NEW_DATABASE=0

fail() { echo "[install] 错误：$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "此安装脚本仅支持 macOS"
[ -n "$NODE_BIN" ] || fail "未找到 Node.js"
[ -n "$NPM_BIN" ] || fail "未找到 npm"
command -v sqlite3 >/dev/null || fail "未找到 sqlite3"
command -v launchctl >/dev/null || fail "未找到 launchctl"

NODE_MAJOR="$($NODE_BIN -p 'Number(process.versions.node.split(".")[0])')"
[ "$NODE_MAJOR" -ge 22 ] || fail "需要 Node.js 22 或更高版本，当前为 $($NODE_BIN --version)"

case "$BACKUP_DIR/" in
  "$DATA_DIR"/*) fail "备份目录不能位于数据目录内" ;;
esac

mkdir -p -m 700 "$APP_ROOT" "$DATA_DIR" "$UPLOAD_DIR" "$RELEASES_DIR" "$BACKUP_DIR" "$LOG_DIR" "$LAUNCH_AGENTS_DIR"

if [ -s "$DB_PATH" ]; then
  echo "[install] 创建并验证升级前备份…"
  APP_LABEL="$APP_LABEL" APP_PLIST="$APP_PLIST" DATA_DIR="$DATA_DIR" DB_PATH="$DB_PATH" \
    UPLOAD_DIR="$UPLOAD_DIR" BACKUP_DIR="$BACKUP_DIR" \
    "$SOURCE_BACKEND/deploy/backup-macos.sh"
fi

echo "[install] 构建前端…"
(cd "$SOURCE_FRONTEND" && "$NPM_BIN" ci && "$NPM_BIN" run build)

echo "[install] 创建版本：$RELEASE_DIR"
mkdir -p -m 700 "$RELEASE_DIR/backend" "$RELEASE_DIR/frontend"
rsync -a \
  --exclude node_modules \
  --exclude .env \
  --exclude 'payroll.db*' \
  --exclude uploads \
  "$SOURCE_BACKEND/" "$RELEASE_DIR/backend/"
ditto "$SOURCE_FRONTEND/dist" "$RELEASE_DIR/frontend"

echo "[install] 安装后端生产依赖…"
(cd "$RELEASE_DIR/backend" && "$NPM_BIN" ci --omit=dev)
chmod +x "$RELEASE_DIR/backend/deploy/backup-macos.sh"

if [ ! -s "$DB_PATH" ]; then
  NEW_DATABASE=1
  INITIAL_PASSWORD="${INITIAL_ADMIN_PASSWORD:-$(openssl rand -hex 16)}"
  [ "${#INITIAL_PASSWORD}" -ge 12 ] || fail "INITIAL_ADMIN_PASSWORD 至少需要 12 位"
fi

cat > "$RELEASE_DIR/backend/.env" <<EOF
NODE_ENV=production
DEMO_MODE=false
PORT=3001
DB_PATH=$DB_PATH
UPLOAD_DIR=$UPLOAD_DIR
JOB_CATALOG_FILE=$DATA_DIR/job-catalog.json
COOKIE_SECURE=0
CORS_ORIGINS=http://127.0.0.1:3001,http://localhost:3001
SERVE_FRONTEND=true
FRONTEND_DIST=$CURRENT_LINK/frontend
COPILOT_EXTERNAL_LLM=false
RESUME_EXTERNAL_LLM=false
EOF
if [ "$NEW_DATABASE" -eq 1 ]; then
  printf 'INITIAL_ADMIN_PASSWORD=%s\nINITIAL_ADMIN_USERNAME=founder\nINITIAL_ADMIN_NAME=管理员\n' "$INITIAL_PASSWORD" >> "$RELEASE_DIR/backend/.env"
fi
chmod 600 "$RELEASE_DIR/backend/.env"

# Preserve local model configuration across upgrades; explicit install flag overrides it.
"$NODE_BIN" --input-type=module - "$CURRENT_LINK/backend/.env" "$RELEASE_DIR/backend/.env" <<'JS'
import { readFileSync, appendFileSync } from 'node:fs'
const old = {}
try {
  for (const line of readFileSync(process.argv[2], 'utf8').split('\n')) {
    const match = line.match(/^(RESUME_LOCAL_(?:LLM|BASE_URL|MODEL|TIMEOUT_MS))=(.*)$/)
    if (match) old[match[1]] = match[2]
  }
} catch {}
const enabled = process.env.PAYROLL_LOCAL_RESUME_MODEL ?? old.RESUME_LOCAL_LLM ?? 'false'
if (!['true', 'false'].includes(enabled)) throw new Error('PAYROLL_LOCAL_RESUME_MODEL 必须为 true 或 false')
const config = {
  RESUME_LOCAL_LLM: enabled,
  RESUME_LOCAL_BASE_URL: old.RESUME_LOCAL_BASE_URL || 'http://127.0.0.1:1234/v1',
  RESUME_LOCAL_MODEL: old.RESUME_LOCAL_MODEL || 'hr-resume-qwen3-vl-8b',
  RESUME_LOCAL_TIMEOUT_MS: old.RESUME_LOCAL_TIMEOUT_MS || '180000'
}
appendFileSync(process.argv[3], Object.entries(config).map(([k, v]) => `${k}=${v}\n`).join(''))
JS

if grep -q '^RESUME_LOCAL_LLM=true$' "$RELEASE_DIR/backend/.env"; then
  [ -x "$USER_HOME_DIR/.lmstudio/bin/lms" ] || fail "本地模型已启用，但尚未安装 LM Studio CLI"
  chmod +x "$RELEASE_DIR/backend/deploy/start-local-resume-model.sh"
  cat > "$MODEL_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$MODEL_LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$CURRENT_LINK/backend/deploy/start-local-resume-model.sh</string></array>
  <key>EnvironmentVariables</key><dict><key>NODE_BIN</key><string>$NODE_BIN</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>ProcessType</key><string>Background</string>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/resume-model.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/resume-model-error.log</string>
</dict></plist>
EOF
  chmod 600 "$MODEL_PLIST"
  plutil -lint "$MODEL_PLIST" >/dev/null
fi

launchctl bootout "$LAUNCH_DOMAIN/$APP_LABEL" >/dev/null 2>&1 || true
launchctl bootout "$LAUNCH_DOMAIN/$BACKUP_LABEL" >/dev/null 2>&1 || true
launchctl bootout "$LAUNCH_DOMAIN/$MODEL_LABEL" >/dev/null 2>&1 || true
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
if grep -q '^RESUME_LOCAL_LLM=true$' "$RELEASE_DIR/backend/.env"; then
  launchctl bootstrap "$LAUNCH_DOMAIN" "$MODEL_PLIST"
fi

if [ "$NEW_DATABASE" -eq 1 ]; then
  echo "[install] 初始化正式空库…"
  (cd "$CURRENT_LINK/backend" && "$NODE_BIN" -e "import('./seed.js').then(m => m.seedIfEmpty())")
  ENV_TMP="$RELEASE_DIR/backend/.env.tmp"
  grep -v '^INITIAL_ADMIN_PASSWORD=' "$RELEASE_DIR/backend/.env" > "$ENV_TMP"
  chmod 600 "$ENV_TMP"
  mv "$ENV_TMP" "$RELEASE_DIR/backend/.env"
  echo "[install] 初始账号：founder"
  echo "[install] 初始密码：${INITIAL_PASSWORD}"
  echo "[install] 请先保存此密码；明文已从 .env 中删除。"
fi

[ "$(sqlite3 "$DB_PATH" 'PRAGMA quick_check;')" = "ok" ] || fail "数据库完整性检查失败"

cat > "$APP_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$APP_LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE_BIN</string><string>$CURRENT_LINK/backend/server.js</string></array>
  <key>WorkingDirectory</key><string>$CURRENT_LINK/backend</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Interactive</string>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/app.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/app-error.log</string>
</dict>
</plist>
EOF

cat > "$BACKUP_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$BACKUP_LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$CURRENT_LINK/backend/deploy/backup-macos.sh</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>APP_LABEL</key><string>$APP_LABEL</string>
    <key>APP_PLIST</key><string>$APP_PLIST</string>
    <key>DATA_DIR</key><string>$DATA_DIR</string>
    <key>DB_PATH</key><string>$DB_PATH</string>
    <key>UPLOAD_DIR</key><string>$UPLOAD_DIR</string>
    <key>BACKUP_DIR</key><string>$BACKUP_DIR</string>
    <key>BACKUP_RETENTION_DAYS</key><string>30</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>30</integer></dict>
  <key>ProcessType</key><string>Background</string>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/backup.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/backup-error.log</string>
</dict>
</plist>
EOF
chmod 600 "$APP_PLIST" "$BACKUP_PLIST"
plutil -lint "$APP_PLIST" >/dev/null
plutil -lint "$BACKUP_PLIST" >/dev/null

launchctl bootstrap "$LAUNCH_DOMAIN" "$APP_PLIST"
launchctl bootstrap "$LAUNCH_DOMAIN" "$BACKUP_PLIST"
launchctl kickstart -k "$LAUNCH_DOMAIN/$APP_LABEL"

HEALTH_OK=0
for _ in {1..30}; do
  if curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1; then HEALTH_OK=1; break; fi
  sleep 1
done
[ "$HEALTH_OK" -eq 1 ] || fail "服务未能启动，请查看 $LOG_DIR/app-error.log"

echo "[install] 创建并验证首次备份…"
APP_LABEL="$APP_LABEL" APP_PLIST="$APP_PLIST" DATA_DIR="$DATA_DIR" DB_PATH="$DB_PATH" \
  UPLOAD_DIR="$UPLOAD_DIR" BACKUP_DIR="$BACKUP_DIR" \
  "$CURRENT_LINK/backend/deploy/backup-macos.sh"

cat > "$APP_ROOT/打开HR系统.command" <<EOF
#!/bin/bash
launchctl kickstart "$LAUNCH_DOMAIN/$APP_LABEL" >/dev/null 2>&1 || true
launchctl kickstart "$LAUNCH_DOMAIN/$MODEL_LABEL" >/dev/null 2>&1 || true
for _ in {1..20}; do
  if curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1; then break; fi
  sleep 1
done
open http://127.0.0.1:3001
EOF
chmod 700 "$APP_ROOT/打开HR系统.command"
ln -sfn "$APP_ROOT/打开HR系统.command" "$USER_HOME_DIR/Desktop/打开HR系统.command"
ln -sfn "$BACKUP_DIR" "$USER_HOME_DIR/Desktop/HR系统备份"

echo ""
echo "[install] 安装完成"
echo "[install] 地址：http://127.0.0.1:3001"
echo "[install] 数据：$DATA_DIR"
echo "[install] 备份：${BACKUP_DIR}（每天 02:30，保留 30 天）"
if [ "$NEW_DATABASE" -eq 1 ]; then
  echo "[install] 初始账号：founder"
  echo "[install] 初始密码：$INITIAL_PASSWORD"
  echo "[install] 登录后请立即修改密码。此密码已从 .env 中删除。"
else
  echo "[install] 沿用现有数据库和账号。"
fi
