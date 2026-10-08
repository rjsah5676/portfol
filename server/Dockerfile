# syntax=docker/dockerfile:1
# 서버 이미지. 빌드 컨텍스트는 레포 루트:
#   docker build -f server/Dockerfile -t portfolio-server .
# (서버가 web/src 의 게임 규칙·점수 계산·채보를 상대 경로로 import 해서 server/ 만으로는 빌드할 수 없음)

# ── 1) 빌드: 의존성 전체 설치 → tsup 으로 dist/index.js 한 파일로 묶음 ──
FROM node:24-slim AS build
# 레포와 같은 상대 위치(/repo/server, /repo/web/src/lib/…)로 둬야 ../../../../web/src/lib/… import 가 맞음
WORKDIR /repo/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json server/tsup.config.ts ./
COPY server/src ./src
COPY web/src/lib/janggi/engine.ts /repo/web/src/lib/janggi/engine.ts
COPY web/src/lib/omok/engine.ts /repo/web/src/lib/omok/engine.ts
# 랭킹 기록 검증용: 점수 공식, 멜론게임 한 판 길이, 리듬게임 채보
COPY web/src/lib/aiScore.ts /repo/web/src/lib/aiScore.ts
COPY web/src/lib/melon/logic.ts /repo/web/src/lib/melon/logic.ts
COPY web/src/data/rhythm /repo/web/src/data/rhythm
# 포커: 카드·족보·판돈 규칙 (서버와 화면이 같이 씀)
COPY web/src/lib/poker /repo/web/src/lib/poker
# 랭크전 봇전 확인: 브라우저에서 한 경기를 서버가 같은 입력으로 다시 돌림 (games/fightBot.ts)
COPY web/src/lib/fight /repo/web/src/lib/fight
RUN npm run build

# ── 2) 실행: 운영 의존성 + dist 만 ──
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /repo/server/dist ./dist
# node 이미지에 들어 있는 일반 사용자(uid 1000)로 실행
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/index.js"]
