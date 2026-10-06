#!/usr/bin/env bash
# 서버에서 실행: MongoDB 전체를 파일 하나로 떠서 ~/backups 에 두고, 오래된 것은 지움.
#   bash scripts/backup-db.sh
# 매일 04:17(KST) 에 돌리기 (한 번만 등록):
#   (crontab -l 2>/dev/null; echo "17 19 * * * mkdir -p \$HOME/backups && bash \$HOME/app/scripts/backup-db.sh >> \$HOME/backups/backup.log 2>&1") | crontab -
# 되돌리기 (지금 DB 를 그 시점 내용으로 덮어씀):
#   docker compose exec -T mongo mongorestore --archive --gzip --drop < ~/backups/<파일>
set -euo pipefail
cd "$(dirname "$0")/.."

DIR="${BACKUP_DIR:-$HOME/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$DIR"

out="$DIR/mongo-$(date +%Y%m%d-%H%M%S).archive.gz"
# 다 떠진 뒤에 이름을 바꿈 → 중간에 실패한 반쪽 파일이 백업으로 남지 않게
docker compose exec -T mongo mongodump --quiet --archive --gzip > "$out.tmp"
[ -s "$out.tmp" ] || { echo "$(date -Is) 실패: 백업이 비어 있음" >&2; rm -f "$out.tmp"; exit 1; }
mv "$out.tmp" "$out"

find "$DIR" -name 'mongo-*.archive.gz' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) $out ($(du -h "$out" | cut -f1))"
