#!/usr/bin/env bash
# 生产数据自动备份：SQLite 一致性快照 + 上传附件 + 城市政策文件。
set -Eeuo pipefail
umask 0077

DATA_DIR="${DATA_DIR:-/var/lib/payroll}"
DB_PATH="${DB_PATH:-$DATA_DIR/payroll.db}"
UPLOAD_DIR="${UPLOAD_DIR:-$DATA_DIR/uploads}"
CITY_POLICY_FILE="${CITY_POLICY_FILE:-}"
JOB_CATALOG_FILE="${JOB_CATALOG_FILE:-$DATA_DIR/job-catalog.json}"
FEISHU_CONFIG_FILE="${FEISHU_CONFIG_FILE:-$DATA_DIR/feishu-config.json}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/payroll}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
PAYROLL_SERVICE="${PAYROLL_SERVICE:-payroll-api}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
RCLONE_CONFIG="${RCLONE_CONFIG:-/etc/payroll/rclone.conf}"
BACKUP_REASON="${BACKUP_REASON:-scheduled}"

log() { printf '[backup] %s\n' "$*"; }
fail() { printf '[backup!] %s\n' "$*" >&2; exit 1; }

[[ "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] && [ "$BACKUP_RETENTION_DAYS" -ge 1 ] || fail "BACKUP_RETENTION_DAYS 必须是正整数"
[[ "$BACKUP_DIR" == /* ]] || fail "BACKUP_DIR 必须是绝对路径"
case "$BACKUP_DIR/" in "$DATA_DIR/"*) fail "BACKUP_DIR 不能位于 DATA_DIR 内" ;; esac
[ -s "$DB_PATH" ] || fail "数据库不存在或为空：$DB_PATH"
for command_name in sqlite3 tar gzip sha256sum flock; do
  command -v "$command_name" >/dev/null 2>&1 || fail "缺少命令：$command_name"
done

install -d -m 700 "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || fail "已有备份任务在运行"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="payroll-$stamp"
if [ -e "$BACKUP_DIR/$name.tar.gz" ]; then name="$name-$$"; fi
stage="$(mktemp -d "$BACKUP_DIR/.stage-$stamp-XXXXXX")"
archive_tmp="$BACKUP_DIR/.$name.tar.gz.tmp"
checksum_tmp="$BACKUP_DIR/.$name.tar.gz.sha256.tmp"
archive="$BACKUP_DIR/$name.tar.gz"
checksum="$archive.sha256"
restart_service=0

restart_payroll() {
  if [ "$restart_service" -eq 1 ]; then
    log "重启 $PAYROLL_SERVICE"
    systemctl start "$PAYROLL_SERVICE"
    restart_service=0
  fi
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  rm -rf -- "$stage"
  rm -f -- "$archive_tmp" "$checksum_tmp"
  if [ "$restart_service" -eq 1 ]; then
    systemctl start "$PAYROLL_SERVICE" || status=1
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

# 附件路径与数据库引用需要在同一时点备份，故短暂停止 API。
# 对 30–150 人规模，通常只需数秒，并避免备份中出现数据库已引用但附件尚未拷贝的窗口。
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet "$PAYROLL_SERVICE"; then
  log "短暂停止 $PAYROLL_SERVICE 以生成一致性备份"
  systemctl stop "$PAYROLL_SERVICE"
  restart_service=1
fi

mkdir -p "$stage/payload"
case "$stage/payload/payroll.db" in
  *"'"*) fail "备份路径不能包含单引号" ;;
esac
sqlite3 "$DB_PATH" ".timeout 5000" ".backup '$stage/payload/payroll.db'"
quick_check="$(sqlite3 "$stage/payload/payroll.db" 'PRAGMA quick_check;')"
[ "$quick_check" = "ok" ] || fail "SQLite 快照完整性检查失败：$quick_check"

if [ -d "$UPLOAD_DIR" ]; then
  cp -a "$UPLOAD_DIR" "$stage/payload/uploads"
else
  mkdir -p "$stage/payload/uploads"
fi
if [ -n "$CITY_POLICY_FILE" ] && [ -f "$CITY_POLICY_FILE" ]; then
  cp -a "$CITY_POLICY_FILE" "$stage/payload/city-policies.json"
fi
if [ -f "$JOB_CATALOG_FILE" ]; then
  cp -a "$JOB_CATALOG_FILE" "$stage/payload/job-catalog.json"
fi
if [ -f "$FEISHU_CONFIG_FILE" ]; then
  cp -a "$FEISHU_CONFIG_FILE" "$stage/payload/feishu-config.json"
  chmod 600 "$stage/payload/feishu-config.json"
fi
if [ -d "$DATA_DIR/private-tools" ]; then
  cp -a "$DATA_DIR/private-tools" "$stage/payload/private-tools"
fi

db_sha="$(sha256sum "$stage/payload/payroll.db" | awk '{print $1}')"
cat > "$stage/payload/manifest.txt" <<EOF
created_at_utc=$stamp
hostname=$(hostname -f 2>/dev/null || hostname)
reason=$BACKUP_REASON
database_source=$DB_PATH
upload_source=$UPLOAD_DIR
city_policy_source=$CITY_POLICY_FILE
database_sha256=$db_sha
sqlite_quick_check=$quick_check
EOF

# 一致性快照已经落到临时目录；压缩与异地上传不再需要保持 API 停机。
restart_payroll

tar -C "$stage/payload" -czf "$archive_tmp" .
gzip -t "$archive_tmp"
mv "$archive_tmp" "$archive"
(
  cd "$BACKUP_DIR"
  sha256sum "$(basename "$archive")" > "$(basename "$checksum_tmp")"
)
mv "$checksum_tmp" "$checksum"
chmod 600 "$archive" "$checksum"

find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'payroll-*.tar.gz' -o -name 'payroll-*.tar.gz.sha256' \) \
  -mtime "+$BACKUP_RETENTION_DAYS" -delete

if [ -n "$RCLONE_REMOTE" ]; then
  command -v rclone >/dev/null 2>&1 || fail "已配置 RCLONE_REMOTE，但未安装 rclone"
  [ -f "$RCLONE_CONFIG" ] || fail "已配置 RCLONE_REMOTE，但缺少 $RCLONE_CONFIG"
  remote="${RCLONE_REMOTE%/}"
  rclone --config "$RCLONE_CONFIG" copyto "$archive" "$remote/$(basename "$archive")"
  rclone --config "$RCLONE_CONFIG" copyto "$checksum" "$remote/$(basename "$checksum")"
  log "已上传异地备份到 $remote"
fi

log "备份完成：$archive"
