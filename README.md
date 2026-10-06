# portfolio (gunmo.my)

기존 프론트(`rjsah5676.github.io`)에 백엔드를 붙인 레포.

```
web/      Next.js 16 (서버 모드) — 화면은 기존 그대로, 데이터만 server 에서 읽음
server/   Express 5 + socket.io + MongoDB — API·실시간(게임 방·채팅·방명록)
```

- Firebase 는 **로그인(Auth)만** 계속 씀 (게임용 익명 로그인, 관리자 이메일 로그인). 서버가 Firebase 토큰을 검증.
- Firestore / Realtime Database 는 더 이상 쓰지 않음 → MongoDB + 웹소켓.
- 체스·장기·오목 방은 DB 에 저장(서버를 재시작해도 이어짐). 스케치 퀴즈·격투 방은 서버 메모리(재시작하면 사라짐).

## 로컬 실행

Node 22 이상 (`.nvmrc` 는 24).

```bash
npm run setup     # web, server 의존성 설치 (처음 한 번)
npm run dev       # server(4000) + web(3000) 같이 실행 → http://localhost:3000
```

DB 는 셋 중 하나:

| 방법 | 설정 |
| --- | --- |
| 내장 MongoDB (기본) | 설정 없음. 첫 실행 때 mongod 를 내려받음(용량 큼). 데이터는 `~/.portfolio-dev/mongo` |
| Docker | `docker compose up -d mongo` → `server/.env` 에 `MONGODB_URI=mongodb://localhost:27017` |
| 직접 설치·Atlas | `server/.env` 에 `MONGODB_URI=...` |

환경변수는 전부 선택. 예시: `server/.env.example` → `server/.env`, `web/.env.example` → `web/.env.local`.

### 기존 데이터 가져오기 (Firestore → MongoDB)

```bash
npm run import:firestore -- --dry-run     # 개수만 확인
npm run import:firestore                  # 랭킹·방명록·방문자 수·글
npm run import:firestore -- --admin-email <관리자 이메일> --admin-password <비밀번호>   # 문의함까지
```

여러 번 돌려도 같은 문서는 덮어씀(중복 없음). 내장 MongoDB 에 넣을 때는 `npm run dev` 를 끄고 실행.

## 명령

| 명령 | 내용 |
| --- | --- |
| `npm run dev` | 개발 서버 (server + web) |
| `npm run build` / `npm start` | 빌드 / 빌드한 것 실행 |
| `npm test` | 서버 테스트 (vitest) |
| `npm run typecheck` / `npm run lint` | 타입 검사 / 린트 |
| `npm run seo:audit -- http://localhost:3000 --images` | 떠 있는 사이트의 모든 페이지 메타(제목·설명·대표 이미지) 점검 |

## SEO

- 글·방명록·랭킹은 서버에서 그려서 내려감(SSR). 새 글은 재배포 없이 목록·글 페이지·사이트맵에 바로 반영.
- 페이지마다 제목·설명·canonical 이 다르고, 대표 이미지도 페이지별로 생성: `/og/<페이지 경로>.png`.
- 정식 주소는 `NEXT_PUBLIC_SITE_URL` (기본 `https://gunmo.my`).

## 배포 (Docker)

```
브라우저 → Caddy(80/443, HTTPS 자동) ─┬─ /api, /socket.io → server:4000 ─ mongo
                                      └─ 그 외            → web:3000
```

1. 서버에 Docker 설치, 도메인(gunmo.my) DNS 를 서버 IP 로, 80·443 포트 열기
2. 레포를 받고 `.env.example` → `.env` (`SITE_ADDRESS`, `REVALIDATE_SECRET` 등)
3. `docker compose up -d --build`
4. 데이터 이전: `MONGODB_URI=mongodb://localhost:27017 npm run import:firestore` (서버에서 실행하거나, 내 PC 에서 SSH 터널로 27017 을 연결해서)
5. Firebase 콘솔 → Authentication → 설정 → 승인된 도메인에 `gunmo.my` 추가 (API 키에 리퍼러 제한을 걸어뒀다면 거기에도 추가)

CI(`.github/workflows/ci.yml`): push·PR 마다 서버 테스트 + 프론트 린트·타입·빌드, main 에 push 되면 Docker 이미지 두 개(`ghcr.io/<계정>/<레포>-server`, `-web`)를 올림.
이미지를 받아 쓰려면 `.env` 에 `SERVER_IMAGE`, `WEB_IMAGE` 를 적고 `docker compose pull && docker compose up -d --no-build`.

### 자동 배포

main 에 push → 이미지가 올라간 뒤 `deploy` job 이 서버에 접속해 `scripts/deploy.sh` 를 실행(이미지 받기 → 바뀐 컨테이너만 다시 띄움).
저장소 Settings → Secrets and variables → Actions 에 `DEPLOY_HOST`(Variable), `DEPLOY_SSH_KEY`(Secret)가 있어야 동작하고, 없으면 건너뜀.
다시 띄우는 몇 초 동안 접속이 끊기고(자동 재연결), 진행 중이던 스케치·격투 방은 사라짐.

### 백업

`scripts/backup-db.sh` 가 DB 전체를 `~/backups` 에 뜨고 14일 지난 것은 지움. 매일 돌리는 등록 방법과 되돌리는 명령은 파일 맨 위 주석.
백업 파일이 같은 서버에 있으므로 서버 자체가 날아가는 경우까지 대비하려면 Lightsail 스냅샷도 같이 켤 것.

## 참고

- 서버는 프로세스 하나로 띄우는 것을 전제로 함 (방 상태·구독이 메모리에 있음). 여러 대로 늘리려면 socket.io 어댑터와 방 상태 공유가 필요.
- `web/.github/`, `web/firebase.json`, `web/*.rules` 는 예전 Firebase 배포용 파일. 이 레포에서는 동작하지 않음(지워도 됨).
- 서버가 `web/src/lib/{janggi,omok}/engine.ts` 를 직접 가져다 씀 → 규칙을 고치면 서버도 같이 바뀜.
