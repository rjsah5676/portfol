#!/usr/bin/env bash
# 서버에서 실행: 새 이미지를 받아 다시 띄움. CI 의 deploy job 이 부르고, 서버에서 직접 실행해도 됨.
#   bash scripts/deploy.sh
# GHCR_USER 가 있으면 표준 입력으로 받은 토큰으로 이번 실행에서만 로그인함 (서버에 토큰을 남기지 않음).
# 없으면 서버에 이미 해 둔 docker login 을 씀.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "${GHCR_USER:-}" ]; then
  DOCKER_CONFIG="$(mktemp -d)"
  export DOCKER_CONFIG
  trap 'rm -rf "$DOCKER_CONFIG"' EXIT
  docker login ghcr.io -u "$GHCR_USER" --password-stdin
fi

docker compose pull server web
# 이미지가 바뀐 컨테이너만 다시 만듦 (mongo·caddy 는 그대로)
docker compose up -d --no-build --remove-orphans
# Caddyfile 이 바뀌었으면 반영 (끊김 없이 다시 읽음)
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
# 안 쓰는 옛 이미지 정리 (디스크가 차지 않게)
docker image prune -f
docker compose ps
