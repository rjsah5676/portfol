# GLITCH DEFENSE (글리치 디펜스) — 인수인계 · 작업 가이드

> PIXEL FIGHT 외전 랜덤 디펜스. **알파** (그림 없이 자리표시, 메뉴 미노출 · noindex).
> 주소: `/games/defense/` · 처음 만든 날: 2026-10-13
> 이 문서만 읽으면 바로 이어서 작업할 수 있게 정리함. Claude 로 작업한다면 이 파일부터 읽히기.

---

## 1. 한 줄 요약

메운디(메이플 운빨 디펜스)의 단순함 + 원랜디의 조합식 · 항법 + 나랜디의 랭크 미션 + 운빨존많겜의 칸 쌓기 · 합성 UX.
**세 세력(기사단 · 기계공방 · 마도회) = 공격 상성**, 등급 노말→레어→에픽→레전드(합성) → 신화 · 히든(조합식).
픽셀 세계를 먹는 글리치 몬스터를 막고, 10웨이브마다 **글리치에 오염된 PIXEL FIGHT 파이터**가 보스로 나옴. 60웨이브 보스(카이)를 잡으면 클리어.

## 2. 실행 · 확인

```bash
npm run dev                                   # 평소처럼 → http://localhost:3000/games/defense/
cd server
npx tsx scripts/defense-sim.ts                # 봇 전략 8종 × 20판 밸런스 표 (결정론도 같이 검사)
npx tsx scripts/defense-sim.ts -n 100 -b 마도회 --curve   # 한 전략 · 웨이브별 적 체력 vs DPS 곡선
npx tsx scripts/defense-trace.ts -b 기사단 --seed 7        # 봇 한 판을 웨이브마다 찍어 원인 찾기
npm test -- defense                           # 엔진 · 랭킹 검증 · 멀티 턴 테스트
```

관리자 계정이면 게임 화면 오른쪽 위 **DEV** 버튼: 봇 자동 플레이 · ×5/×10/×20 · 골드/행운석 (쓰면 그 판은 랭킹 안 올라감).

## 3. 파일 지도

| 위치 | 하는 일 |
| --- | --- |
| `web/src/lib/defense/balance.ts` | **밸런스 수치 전부** (웨이브 · 체력 곡선 · 경제 · 확률 · 보상). 바꾸면 `BALANCE_VER` 올리기 |
| `web/src/lib/defense/units.ts` | 유닛 41종 (세력 · 등급 · 피해 · 스킬) + 조합식 `RECIPES` + 상성표 `SIZE_MULT` |
| `web/src/lib/defense/enemies.ts` | 글리치 몬스터 8종 · 웨이브별 종류 순서 · 보스 6명(기술) |
| `web/src/lib/defense/meta.ts` | 패치(항법) 4종 · 미션 11종 정의 |
| `web/src/lib/defense/sim.ts` | **결정론 시뮬** — 상태 · 명령(`apply`) · 한 tick 진행(`step`) · 보스 기술 · 미션 판정 |
| `web/src/lib/defense/replay.ts` | 명령 기록 다시 돌리기 · 기록 검사 · 점수 · 멀티 턴 상수 |
| `web/src/lib/defense/bot.ts` | 밸런스용 봇 전략 (`BOTS`) |
| `web/src/lib/defense/rng.ts` | 시드 난수 (mulberry32) |
| `web/src/lib/defense/assets.ts` | **그림 · 소리 연결표** — 에셋 받으면 여기 한 줄 |
| `web/src/components/Defense/DefenseApp.tsx` | 메뉴 · 솔로 시작 · 멀티 로비/방 · 랭킹 목록 |
| `web/src/components/Defense/GameView.tsx` | 게임 화면 (위 바 · 필드 · 아래 정보 · 오른쪽 패널 · 창들 · 결과) |
| `web/src/components/Defense/controller.ts` | 화면 쪽 진행: 솔로(즉시 실행 + 기록) / 멀티(서버 턴 받아 락스텝) |
| `web/src/components/Defense/render.ts` | 캔버스 필드 그리기 (그림 있으면 그림, 없으면 도트 자리표시) |
| `web/src/components/Defense/Stage.tsx` | 1024×576 무대 · 화면 맞춤 · 폰 가로 전용 · 전체화면 |
| `web/src/components/Defense/Codex.tsx` · `ui.tsx` | 도감 · 공용 버튼/창 |
| `web/src/realtime/defense.ts` | 서버 통신 (rpc · 구독) |
| `web/src/app/games/defense/` | 페이지 (GameHeader + 랭킹) · layout(메타, noindex) |
| `web/src/css/defense.css` | 애니메이션 · 글리치 효과 키프레임만 |
| `server/src/games/defense.ts` | 랭킹(시드 발급 · 기록 검증 · 순위) + 멀티 방(턴 릴레이) |
| `server/src/games/defenseVerify.worker.ts` | 기록 검증 작업 스레드 (tsup 엔트리에 추가돼 있음) |
| `server/scripts/defense-sim.ts` · `defense-trace.ts` | 밸런스 시뮬 CLI |
| `server/test/defense.test.ts` | 테스트 |
| `web/docs/defense/ASSETS.md` | 에셋 요청서 (규격 · 목록) |

## 4. 꼭 지킬 규칙 — 결정론

시뮬(`lib/defense/sim.ts` 와 거기서 부르는 모든 것)은 **같은 시드 + 같은 명령 기록 → 어디서 돌려도 같은 결과**여야 함.
랭킹 검증(서버가 기록을 다시 돌려 점수 계산) · 멀티(락스텝) · 봇 시뮬이 전부 여기에 기대고 있음.

- `Math.random` · `Date` · `performance` 금지 → `rnd(b.rng)` 만
- `Math.pow / sin / cos / exp / log` 금지 (엔진마다 끝자리가 다를 수 있음). `+ − × ÷ sqrt 비교 Math.floor/round/min/max` 만. 거듭제곱은 `HP_TABLE` 처럼 곱을 차례로
- 배열 · 객체 순회 순서가 늘 같게 (Set/Map 은 넣은 순서라 OK, 정렬은 동점 깨는 기준까지)
- 명령이 실패하면 상태를 **하나도** 안 바꿔야 함 (`apply` 는 검사 → 변경 순서)
- 화면용 값(`fx`, `ev`)은 결과에 영향 없게 (null 이면 안 쌓음)
- **수치를 바꾸면 `BALANCE_VER` 올리기** — 랭킹이 버전별로 따로 쌓임 (예전 버전 기록은 재검증 불가)
- 확인: `npx tsx scripts/defense-sim.ts` 가 매 판 기록을 다시 돌려 비교함 (깨지면 바로 에러)

## 5. 자주 하는 작업

**유닛 추가** — `units.ts` `UNITS` 에 한 줄 (스킬은 `splash · chain · crit · procs · aura · boss · ult · onKill` 조합).
새 종류의 스킬이 필요하면 `sim.ts` 의 `attack` / `ult` 에 분기 추가 + `UnitDef` 타입 + 도감 설명.
세력 · 등급 풀은 자동 (`poolOf`). 신화 · 히든이면 `RECIPES` 에도.

**적 · 보스** — `enemies.ts`. 보스 기술은 `BossSkill` 종류(heal · whip · dash · shield · summon · evade) 조합, 새 기술은 `sim.ts bossTick`.

**미션 · 패치** — `meta.ts` 에 정의 + `sim.ts` 의 `missionDone` / 패치 효과(`b.patch === "…"` 검색).

**밸런스** — `balance.ts` · 유닛/보스 수치 수정 → `defense-sim.ts` 로 확인 → `BALANCE_VER` 올림.
봇은 사람보다 못함(배치 최적화 X, 균열 단순). 봇 클리어율 0~10%, 평균 30~45웨이브 정도면 사람 기준 적당하다고 봄 (알파 기준선).

**에셋 입히기** — `assets.ts` 의 `UNIT_ART / ENEMY_ART / BOSS_ART / FIELD_ART / SFX` 에 한 줄씩. 파일은 `web/public/defense/…`. 규격은 `ASSETS.md`.
연결표에 없는 것은 자동으로 자리표시 그림이라 일부만 넣어도 됨.

## 6. 구조 설명

### 랭킹 (회원만)
1. 판 시작: `defense.start` → 서버가 시드 · run id 발급 (`defense_runs`)
2. 판 중: 클라이언트는 명령을 `[tick, 0, 명령]` 으로 기록 (`controller.log`)
3. 판 끝: `defense.finish { run, log }` → 서버 작업 스레드가 처음부터 다시 돌려 결과 계산 → 점수 저장 (`defense_rank`, `_id = 버전:uid`, 최고 기록만)
   - 같은 run 두 번 X, 4시간 지난 run X, 버전 다르면 X
   - 걸린 실제 시간 ≥ 게임 시간 / 최대 배속(3) − 5초 (속도핵 막기)
4. 점수: 클리어 = `1e9 − tick` (빠를수록), 아니면 `웨이브 × 1e6 + 처치 수`

### 멀티 (락스텝, 회원만, 최대 4명)
- 서버는 시뮬을 돌리지 않음. 100ms(=3 tick)마다 그 사이 모인 명령을 `turn { n, c }` 로 뿌림
- 클라이언트는 턴 n 을 받아야 tick 3n ~ 3n+2 를 돌릴 수 있음 → 모두 같은 화면. 뒤처지면 한 프레임에 여러 tick 으로 따라잡음
- 새로고침 · 재접속: 방 구독 첫 데이터에 지금까지 기록 → `controller.loadLog` 로 빈 턴 채움
- 내 명령은 복사본에 먼저 해 보고(바로 오류 안내) 되는 것만 보냄
- 끝: 모두 `defense.over` 를 보내면 서버가 기록을 다시 돌려 순위 → `result`
- 지금은 보드끼리 영향 없음(생존 경쟁, 같은 시드라 운은 같음)

**"남 돕기" 넣는 법 (다음 단계)**: 명령에 다른 보드를 가리키는 종류를 추가(예: `{ t: "gift", to, c }`) → `isCmd` · `apply` 에서 `g.boards[to]` 를 바꾸면 끝.
같은 기록 · 같은 시뮬이라 서버 · 동기화 구조는 그대로. 웨이브는 보드마다 따로 흐르므로, 협동 모드를 만들 땐 웨이브 시계를 `Game` 으로 올리는 것도 고려.

### 화면
- 무대 1024×576 고정 배치를 화면에 맞춰 통째로 확대/축소 (PC = 폰). 폰은 가로 전용 (ANIME POKER 와 같은 방식)
- 필드는 캔버스, 나머지 UI 는 DOM. HUD 는 100ms 마다 다시 그림
- 조작: 칸 누르기 = 정보, 끌기 = 자리 바꾸기(같은 유닛이면 모음). 단축키 Q 소환 · W 합성 · E 판매 · 1 2 3 강화 · 4 확률 · R 조합식 · Space 일시정지 · F 배속 · Esc

## 7. 알파 상태 · 다음 할 일

- [x] 엔진 · 봇 시뮬 · 랭킹 검증 · 멀티 락스텝 · 화면 전체 (자리표시 그림)
- [ ] 에셋 (`ASSETS.md`) — 유닛 41 · 적 8 · 필드 · 효과음
- [ ] 메뉴 노출: `web/src/data/navMenu.ts` (썸네일 `img/menu/defense.jpg`) · `app/sitemap.ts` · layout 의 `noindex` 빼기 · 게임 가이드(`data/gameGuides.tsx`)
- [ ] 밸런스: 지금은 **보스만 패배 원인**(필드 100마리로 죽는 판이 거의 없음) → 후반 웨이브 압박 올리기. 기사단 봇이 약함(보스가 중 · 대형이라). 10 · 20 보스가 벽
- [ ] 멀티 "남 돕기" · 협동 보스 · 관전
- [ ] 효과음 · 배경음 연결 (`assets.ts SFX` 는 자리만 있음, 재생 코드는 아직)
- [ ] 배포 때 방 이어받기(live.ts) — 지금 멀티 방은 서버 재시작하면 사라짐
- [ ] 멀티 어긋남 감시 (`hashGame` 은 있음 — 몇 턴마다 서버로 보내 비교하는 건 아직)

## 8. 테스트 메모
- 2026-10-13: 서버 · 웹 타입체크 통과. 봇 시뮬 결정론 확인(전략 8종). 멀티 락스텝을 가짜 서버로 돌려 두 클라이언트 + 중간 입장 클라이언트 해시 일치 확인.
- `server/test/defense.test.ts` 는 작성만 (윈도우에서 `npm test -- defense` 로 돌려 볼 것).
