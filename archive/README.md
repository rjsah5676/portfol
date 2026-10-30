# archive — 빌드에서 뺀 게임 원형

2026-10-21에 게임 목록에서 내리고 빌드(웹 · 서버 Docker 이미지, tsc, eslint, 테스트)에서 뺀 게임들의 코드 · 에셋입니다.
`archive/` 아래는 원래 레포 경로를 그대로 따릅니다 (`archive/web/src/lib/marble` = 원래 `web/src/lib/marble`).

| 게임 | 원래 키 | 주요 폴더 |
|---|---|---|
| DICE TOWN | `marble` | `web/src/{lib,components}/Marble`, `web/public/marble`, `server/src/games/marble` |
| PIXEL TOWN SURVIVOR | `survivor` | `web/src/{lib,components}/Survivor`, `web/public/survivor`, `server/src/games/survivor.ts` |
| PIXEL RESET STORY | `rogue` | `web/src/{lib,components}/Rogue`, `web/public/rogue`, `server/src/games/rogue.ts` |
| PIXEL PATROL | `patrol` | `web/src/{lib,components}/Patrol`, `web/public/patrol`, `server/src/games/patrol.ts` |
| TABLE TOWN (2026-10-22) | `town` | `web/src/app/games/town`, `web/src/{lib/town,components/Town}`, `web/src/css/town.css`, `web/public/town`, `server/src/games/town.ts`, `server/test/town.test.ts` |

### TABLE TOWN 따로 메모 (2026-10-22 에 뺌)
- 원카드 1종 · 실시간 방(서버) · 게스트/회원 · 코스튬 뽑기 · 코인 상점(GP → 코인) · 마을 채팅까지 완성된 상태로 보관. 원카드 규칙은 `web/src/lib/town/onecard.ts` (서버 · 화면 공용 순수 함수).
- 메뉴 아이콘 `web/public/icons/games/town.webp`, 메뉴 사진 `web/src/img/menu/town.jpg`, 공유 이미지 `web/assets/og/shots/games__town.jpg` 도 같이 옮김. GPT 원본 그림은 `web/assets/town-src/`(git 에서 무시, 로컬에만).
- 살릴 때: 위 경로 `git mv` 로 되돌리기 → `server.ts` 에 `registerTown(deps, overrides.town)` · `liveGames.town` · `town.close()`, `server/test/helpers.ts` 의 `TownOptions`(봇 지연 등) → `navMenu.ts` 메뉴(`px:town`) · `sitemap.ts` · `og/shots.ts` 의 `games/town` 다시 넣기 (이 커밋 diff 참고).
- DB 컬렉션 `town_profiles` 는 지우지 않았습니다.

공용으로 쓰던 `web/src/lib/cast.ts`(다이스 타운 · 서바이버 캐릭터 명단)와 시뮬 스크립트(`server/scripts/*-sim.ts`, `cast-check.ts`), 테스트(`server/test/marble.test.ts`, `rogue.test.ts`)도 같이 옮겼습니다.

## 남겨 둔 것
- 디펜스 「해피 타운」이 쓰는 예전 마블 효과음 · 건물 · 랜드마크 · 특수 칸 그림은 `web/public/defense/town/` 으로 옮겨 계속 씁니다.
- GP 원장에 남은 예전 기록이 이름으로 보이게 `web/src/lib/points.ts` 의 게임 이름(`POINT_GAMES` 등)과 업적 숫자 타입은 그대로 두고, 업적 · 반복 업적 · 일일 미션 줄만 주석 처리했습니다.
- DB 컬렉션(`marble_profile`, `survivor_*`, `rogue_*`, `patrol_*`, `rogue_plays`)은 지우지 않았습니다.

## 따로 떼어 둔 조각
- `server/achievements-metrics.ts.txt` — `server/src/achievements.ts` 의 `metricsOf` 안에 있던 네 게임 블록
- `web/gameGuides-archived.tsx.txt` — `web/src/data/gameGuides.tsx` 끝에 있던 네 게임 가이드

## 다시 살리려면
1. 해당 폴더 · 파일을 `git mv archive/<경로> <경로>` 로 되돌리기
2. `server/src/server.ts` 에 `register…` 다시 넣기 (다이스 타운은 `registerMarble` 결과의 `meta` 를 서바이버가 씀), 관리자 라이브 방 · 초기화 API 되살리기 (`git log -- archive` 의 이 커밋 diff 참고)
3. `points.ts` 의 주석 처리한 업적 · 일일 미션 줄 풀기, 위 조각 두 개 붙이기
4. `navMenu.ts` 에 메뉴 추가

## 2026-10-22 관리자 전용으로 되돌림
다섯 게임의 코드 · 에셋(페이지 · 컴포넌트 · lib · realtime · css · public · 서버 게임)은 원래 자리로 다시 옮겨 빌드에 들어감. 대신
- 메뉴 · 사이트맵 · 공유 이미지 · 포트폴리오에는 없음, 페이지는 noindex + `AdminGate`(관리자만), 관리자 「내린 게임」 탭에서 들어감
- 서버는 `gateway.adminOnly(["marble", "survivor", "rogue", "patrol", "town"])` 로 그 게임 요청 · 구독을 관리자에게만 받음, 마블 로비 AI 방은 끔
- 업적 · 일일 미션 · 관리자 초기화 · 테스트 · 시뮬 스크립트 · 메뉴 그림 · 공유 이미지는 여기(archive) 그대로
- 디펜스가 쓰던 마블 효과음 · 건물 그림은 `public/defense/town` 과 `public/marble` 양쪽에 있음

## 2026-10-31 픽셀 프로야구 (`baseball`) 내림
디테일 챙길 게 너무 많아 현실적으로 힘들다고 보고 폐기. 다른 내린 게임처럼 관리자 「내린 게임」 탭에서만 들어감.
- 코드 · 에셋(`web/src/{components/Baseball,lib/baseball,data/baseball}`, `web/public/baseball`, `web/scripts/baseball-*`)은 제자리 · 빌드에 그대로. 페이지는 noindex + `AdminGate`
- 메뉴(`navMenu.ts` 항목 · 메인 추천 칸)에서 뺌, 메뉴 사진은 `archive/web/src/img/menu/baseball.jpg`
- 서버: 클라우드 세이브(`/api/baseball/save`)만 남기고 관리자 · 테스터만 받음. 밸런스 분석용 플레이 기록(`POST /api/baseball/log` · `/api/admin/baseball/*`)과 관리자 「야구 플레이 데이터」 탭(`archive/web/src/components/Admin/BaseballData.tsx`)은 뺌, 브라우저 `lib/baseball/telemetry.ts` 는 빈 함수
- DB 컬렉션 `baseball_logs` · `baseball_saves` 는 지우지 않았습니다
- 안 쓰던 스프라이트 6개(`batter-stance` · 타자 마스크 3개 · `fielder-*-stand`) 지움
- 3D 시험(트리포 · 메시 모델, three.js 시험 페이지)은 레포 밖(작업 폴더 · 다운로드 폴더)에만 있었음
- 살릴 때: `navMenu.ts` 에 메뉴 다시 넣고(사진 `git mv`), `layout.tsx` 의 `AdminGate` 빼고, 세이브 권한 · 기록 API 는 이 커밋 diff 참고
