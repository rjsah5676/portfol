# syntax=docker/dockerfile:1
# 프론트(Next.js 서버 모드) 이미지. 빌드 컨텍스트는 web 폴더:
#   docker build -t portfolio-web web
# 실행 중에 필요한 값: API_URL(백엔드 내부 주소), REVALIDATE_SECRET — docker-compose.yml 참고

# ── 1) 빌드 ──
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# NEXT_PUBLIC_* 값은 빌드할 때 결과물에 박힘
#   NEXT_PUBLIC_API_URL  브라우저가 부를 백엔드 주소. "/" = 사이트와 같은 주소 (프록시가 /api, /socket.io 를 백엔드로 넘겨줌)
#   NEXT_PUBLIC_SITE_URL 정식 주소 (canonical·사이트맵·공유 이미지 주소에 쓰임)
ARG NEXT_PUBLIC_API_URL=/
ARG NEXT_PUBLIC_SITE_URL=https://gunmo.my
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
# 빌드 중에는 백엔드가 없어도 됨 (글·방명록은 요청 때 서버에서 읽고, 랭킹은 실행 후 1분 안에 채워짐)
RUN npm run build

# ── 2) 실행: standalone 출력(필요한 파일만) + 정적 파일 ──
FROM node:24-slim
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=Asia/Seoul
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# node 이미지에 들어 있는 일반 사용자(uid 1000)로 실행
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/robots.txt').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]
