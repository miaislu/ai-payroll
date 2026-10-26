#!/bin/bash
set -Eeuo pipefail
umask 077

APP_LABEL="${APP_LABEL:-com.aipayroll.local}"
APP_PLIST="${APP_PLIST:-$HOME/Library/LaunchAgents/$APP_LABEL.plist}"
DATA_DIR="${DATA_DIR:-$HOME/Library/Application Support/AI Payroll/data}"
DB_PATH="${DB_PATH:-$DATA_DIR/payroll.db}"
UPLOAD_DIR="${UPLOAD_DIR:-$DATA_DIR/uploads}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/Library/Application Support/AI Payroll Backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
CITY_POLICY_FILE="${CITY_POLICY_FILE:-}"
JOB_CATALOG_FILE="${JOB_CATALOG_FILE:-$DATA_DIR/job-catalog.json}"
LAUNCH_DOMAIN="gui/$(id -u)"
LOCK_DIR="$DATA_DIR/.backup.lock"
APP_WAS_LOADED=0
APP_STOPPED=0
STAGE=""

fail() {
  echo "[backup] 错误：$*" >&2
  exit 1
}

restart_app() {
  if [ "$APP_WAS_LOADED" -eq 1 ] && [ "$APP_STOPPED" -eq 1 ] && [ -f "$APP_PLIST" ]; then
    launchctl bootstrap "$LAUNCH_DOMAIN" "$APP_PLIST" >/dev/null 2>&1 || true
    launchctl kickstart -k "$LAUNCH_DOMAIN/$APP_LABEL" >/dev/null 2>&1 || true
    APP_STOPPED=0
  fi
}

cleanup() {
  local code=$?
  restart_app
  if [ -n "$STAGE" ] && [ -d "$STAGE" ]; then rm -rf "$STAGE"; fi
  rmdir "$LOCK_DIR" >/dev/null 2>&1 || true
  exit "$code"
}
trap cleanup EXIT INT TERM

command -v sqlite3 >/dev/null || fail "缺少 sqlite3"
command -v shasum >/dev/null || fail "缺少 shasum"
[ -s "$DB_PATH" ] || fail "数据库不存在或为空：$DB_PATH"
case "$BACKUP_DIR" in
  /*) ;;
  *) fail "BACKUP_DIR 必须是绝对路径" ;;
esac
case "$BACKUP_DIR/" in
  "$DATA_DIR"/*) fail "备份目录不能位于数据目录内" ;;
esac
[[ "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] || fail "BACKUP_RETENTION_DAYS 必须是非负整数"

mkdir -p -m 700 "$DATA_DIR" "$BACKUP_DIR"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  fail "已有备份任务在运行（锁：$LOCK_DIR）"
fi

# 为保证数据库记录与简历附件属于同一时间点，备份时短暂停止本地服务。
if launchctl print "$LAUNCH_DOMAIN/$APP_LABEL" >/dev/null 2>&1; then
  APP_WAS_LOADED=1
  launchctl bootout "$LAUNCH_DOMAIN/$APP_LABEL" >/dev/null
  APP_STOPPED=1
fi

STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/ai-payroll-backup.XXXXXX")"
mkdir -m 700 "$STAGE/payload"

sqlite3 "$DB_PATH" ".timeout 5000" ".backup '$STAGE/payload/payroll.db'"
[ "$(sqlite3 "$STAGE/payload/payroll.db" 'PRAGMA quick_check;')" = "ok" ] || fail "备份数据库完整性检查失败"

if [ -d "$UPLOAD_DIR" ]; then
  ditto "$UPLOAD_DIR" "$STAGE/payload/uploads"
else
  mkdir -m 700 "$STAGE/payload/uploads"
fi
if [ -n "$CITY_POLICY_FILE" ] && [ -f "$CITY_POLICY_FILE" ]; then
  cp -p "$CITY_POLICY_FILE" "$STAGE/payload/city-policies.json"
fi
if [ -f "$JOB_CATALOG_FILE" ]; then
  cp -p "$JOB_CATALOG_FILE" "$STAGE/payload/job-catalog.json"
fi
if [ -d "$DATA_DIR/private-tools" ]; then
  ditto "$DATA_DIR/private-tools" "$STAGE/payload/private-tools"
fi

DB_SHA="$(shasum -a 256 "$STAGE/payload/payroll.db" | awk '{print $1}')"
cat > "$STAGE/payload/MANIFEST.txt" <<EOF
created_utc=$STAMP
host=$(scutil --get LocalHostName 2>/dev/null || hostname)
database_source=$DB_PATH
upload_source=$UPLOAD_DIR
city_policy_source=$CITY_POLICY_FILE
database_sha256=$DB_SHA
EOF

# 数据快照完成后立即恢复服务；压缩和校验在恢复后进行。
restart_app

ARCHIVE="$BACKUP_DIR/ai-payroll-$STAMP.tar.gz"
tar -C "$STAGE" -czf "$ARCHIVE" payload
shasum -a 256 "$ARCHIVE" > "$ARCHIVE.sha256"
chmod 600 "$ARCHIVE" "$ARCHIVE.sha256"
shasum -a 256 -c "$ARCHIVE.sha256" >/dev/null
tar -tzf "$ARCHIVE" >/dev/null

if [ "$BACKUP_RETENTION_DAYS" -gt 0 ]; then
  find "$BACKUP_DIR" -type f \( -name 'ai-payroll-*.tar.gz' -o -name 'ai-payroll-*.tar.gz.sha256' \) -mtime "+$BACKUP_RETENTION_DAYS" -delete
fi

echo "[backup] 完成：$ARCHIVE"
echo "[backup] 校验：$ARCHIVE.sha256"
