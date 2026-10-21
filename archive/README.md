# archive — 빌드에서 뺀 게임 원형

2026-10-21에 게임 목록에서 내리고 빌드(웹 · 서버 Docker 이미지, tsc, eslint, 테스트)에서 뺀 게임들의 코드 · 에셋입니다.
`archive/` 아래는 원래 레포 경로를 그대로 따릅니다 (`archive/web/src/lib/marble` = 원래 `web/src/lib/marble`).

| 게임 | 원래 키 | 주요 폴더 |
|---|---|---|
| DICE TOWN | `marble` | `web/src/{lib,components}/Marble`, `web/public/marble`, `server/src/games/marble` |
| PIXEL TOWN SURVIVOR | `survivor` | `web/src/{lib,components}/Survivor`, `web/public/survivor`, `server/src/games/survivor.ts` |
| PIXEL RESET STORY | `rogue` | `web/src/{lib,components}/Rogue`, `web/public/rogue`, `server/src/games/rogue.ts` |
| PIXEL PATROL | `patrol` | `web/src/{lib,components}/Patrol`, `web/public/patrol`, `server/src/games/patrol.ts` |

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
