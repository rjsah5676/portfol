# PIXEL GLITCH DEFENSE (픽셀 글리치 디펜스) — 인수인계 · 작업 가이드

> PIXEL FIGHT 외전 랜덤 디펜스. **알파** (메뉴 미노출 · noindex). 이름: **PIXEL GLITCH DEFENSE (픽셀 글리치 디펜스)**
> 주소: `/games/defense/` · 처음 만든 날: 2026-10-13 · 도트 2.5D 화면 · 그림 · 소리 입힘: 2026-10-13
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

관리자 계정이면 게임 화면 오른쪽 위 **DEV** 버튼(관리자에게만 보임): 봇 자동 플레이 · ×5/×10/×20 · 골드/행운석 (쓰면 그 판은 랭킹 안 올라감).

**Firebase 없이 화면 확인 (회원 여러 명 · 멀티)**: `server/scripts/dev-fake.ts` + web 을 `POKER_E2E=1` 로 띄우고 주소에 `?fake=<uid>:<별명>`.
```bash
cd server && MONGODB_URI=mongodb://127.0.0.1:27027/ ADMIN_EMAILS=admin@example.com npx tsx scripts/dev-fake.ts
cd web && POKER_E2E=1 npx next dev            # → /games/defense/?fake=admin:관리자 (admin@example.com 이라 관리자)
```
브라우저 창 두 개에 `?fake=alice:alice` · `?fake=bob:bob` 이면 멀티 둘이서 확인 가능.

## 3. 파일 지도

| 위치 | 하는 일 |
| --- | --- |
| `web/src/lib/defense/balance.ts` | **밸런스 수치 전부** (웨이브 · 체력 곡선 · 경제 · 확률 · 보상). 바꾸면 `BALANCE_VER` 올리기 |
| `web/src/lib/defense/units.ts` | 유닛 41종 (세력 · 등급 · 피해 · 스킬) + 조합식 `RECIPES` + 상성표 `SIZE_MULT` |
| `web/src/lib/defense/enemies.ts` | 글리치 몬스터 8종 · 웨이브별 종류 순서 · 보스 6명(기술) |
| `web/src/lib/defense/meta.ts` | 패치(항법) 4종 · 미션 11종 정의 |
| `web/src/lib/defense/sim.ts` | **결정론 시뮬** — 상태 · 명령(`apply`) · 한 tick 진행(`step`) · 보스 기술 · 미션 판정 |
| `web/src/lib/defense/replay.ts` | 명령 기록 다시 돌리기 · 기록 검사 · 점수 · 멀티 턴 상수 |
| `web/src/lib/defense/progress.ts` | **판 밖 성장 정의** — 로드아웃 · `modsOf` · 연구 · 유물 · 오염 단계 · 레벨 비용 · 판 보상 · 상자 · 미션 · 시즌 패스 · GP 값 · 테마 · 한국 시간 주/시즌 |
| `web/src/lib/defense/bot.ts` | 밸런스용 봇 전략 (`BOTS`) |
| `web/src/lib/defense/rng.ts` | 시드 난수 (mulberry32) |
| `web/src/lib/defense/assets.ts` | **그림 · 소리 연결표** (유닛 41 · 적 8 · 보스 6 · 효과음 23 · 배경음 5) — 에셋 바꾸면 여기 |
| `web/src/components/Defense/DefenseApp.tsx` | 메뉴 · 솔로 시작 · 멀티 로비/방 · 랭킹 목록 |
| `web/src/components/Defense/GameView.tsx` | 게임 화면 (위 바 · 필드 · 아래 정보 · 오른쪽 패널 · 창들 · 결과) |
| `web/src/components/Defense/Hub.tsx` | 정비소 (출전 준비 · 유닛 강화 · 연구 · 유물 · 상자 · 미션 · 시즌 패스 · GP 상점) |
| `web/src/components/Defense/controller.ts` | 화면 쪽 진행: 솔로(즉시 실행 + 기록) / 멀티(서버 턴 받아 락스텝) |
| `web/src/components/Defense/render.ts` | 캔버스 필드 그리기 — **2.5D** (돌길 + 높은 블록 · 발 위치 순서로 겹침) · 등급 오라/외곽선/보석 · 효과 |
| `web/src/components/Defense/audio.ts` | 소리: 효과음(Web Audio, 종류별 간격 제한) · 배경음(웨이브/보스에 맞춰 바뀜) · 음량 저장 |
| `web/src/components/Defense/Stage.tsx` | 1024×576 무대 · 화면 맞춤 · 폰 가로 전용 · 전체화면 |
| `web/src/components/Defense/Codex.tsx` · `ui.tsx` | 도감 · 공용 도트 UI (버튼 · 창 · 세력 문장 · 도트 아이콘 · 막대 · 소리 설정) |
| `web/src/realtime/defense.ts` | 서버 통신 (rpc · 구독) |
| `web/src/app/games/defense/` | 페이지 (GameHeader + 랭킹) · layout(메타, noindex) |
| `web/src/css/defense.css` | **도트 UI 규칙** (`px-btn` · `px-box` · `px-inset` · `px-win` · `px-bar`) · 커서 · 글꼴 · 키프레임 |
| `web/public/defense/` | `units/` · `enemies/` · `bosses/` 그림(webp) · `sfx/` · `bgm/` (mp3) · `fonts/` 갈무리(OFL) · `ui/` 커서 |
| `web/scripts/defense-art/` | 그림 시트 자르기 (`slice.py` 칸 나누기 · `cc.py` 겹친 줄은 덩어리 기준 · `icons.py` 아이콘 격자 → 정사각 가운데) |
| `server/src/games/defense.ts` | 랭킹(시드 발급 · 기록 검증 · 순위) + 멀티 방(턴 릴레이) |
| `server/src/games/defenseMeta.ts` | 판 밖 성장 저장 · 지급 (`defense_profile`, 보상 · 미션 · 패스 · 상자 · GP · 주간 순위 GP) |
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

**새 유닛 · 새 콘텐츠를 만들 때는 `ASSETS.md` 맨 위 「만들 때 체크리스트」를 끝까지** (그림 · 공격 그림 · 타격 모양 · 소리 · 조합 재료 · 판매 · 봇 · 가이드 · 패치노트).

**에셋 입히기** — `assets.ts` 의 `UNIT_ART / ENEMY_ART / BOSS_ART / FIELD_ART / SFX / BGM` 에 한 줄씩. 파일은 `web/public/defense/…`. 규격 · 만든 방법은 `ASSETS.md`.
연결표에 없는 것은 자동으로 자리표시 그림(세력별 도트 인형)이라 일부만 넣어도 됨. 그림이 보는 방향이 왼쪽이면 `face: -1`.

## 6. 구조 설명

### 랭킹 (회원만)
1. 판 시작: `defense.start { mode }` → 서버가 시드 · run id · **로드아웃** 발급 (`defense_runs` 에 `mode · lo · board` 같이 저장)
   - `season`: 무작위 시드 + 내 영구 성장 (`defenseMeta.loadoutOf` — 장착한 연구 · 유물 · 유닛 레벨 · 오염 단계)
   - (주간 도전 `weekly` 는 v1.1 에서 없앰 — `mode` · `board` 는 `season` 만 받음. 메뉴 그 자리는 상점)
2. 판 중: 클라이언트는 명령을 `[tick, 0, 명령]` 으로 기록 (`controller.log`)
3. 판 끝: `defense.finish { run, log }` → 서버 작업 스레드가 **같은 로드아웃으로** 처음부터 다시 돌려 결과 계산 → 점수 저장 (`defense_rank`, `_id = 순위표키:uid`, 최고 기록만) → 보상 (`defenseMeta.onRun`)
   - 순위표 키(`ver` 필드): 시즌 `beta2:s1` (밸런스 버전 · 시즌). 옛 주간 `w0` · 알파 `a2` 기록은 그대로 남음 (안 보임)
   - 같은 run 두 번 X, 4시간 지난 run X, 버전 다르면 X
   - 걸린 실제 시간 ≥ 게임 시간 / 최대 배속(3) − 5초 (속도핵 막기)
4. 점수: 시즌 = `seasonScore` (멀티 순위는 `scoreOf`) (오염 단계 × 2e7 + 클리어 7e7 − tick / 웨이브 × 1e6 + 처치 — 단계 하나 ≈ 20웨이브)

### 판 밖 성장 (베타, `lib/defense/progress.ts` 정의 · `server/src/games/defenseMeta.ts` 저장)
- **로드아웃** `Loadout { lv, res, relics, glitch }` → `modsOf()` 가 `Mods` 로 바꿔 `newBoard` 때 `b.mods` 에 한 번 붙음. 시뮬은 `b.mods` 만 읽음 (결정론 그대로). 멀티는 `defense.begin` 때 각자 로드아웃을 정해 `start` · 방 스냅샷으로 모두에게 보냄
- **재화**: 픽셀 조각(판 보상 · 미션 → 연구 · 유닛 레벨 · 상자), 유닛 카드(판에서 그 유닛을 얻으면 · 상자 → 유닛 레벨), 글리치 코어(클리어 · 50웨이브 · 주간 미션 · 상점 → 유물 상자 · 유물 강화 · 세력 칸 · 초월 소환). 보상 계산 `runReward` (오염 단계 배수, 멀티 2명 이상 ×1.2)
- **오염 단계 0~10** (`GLITCH`): 적 체력 · 속도 · 보스 시간 ↔ 보상 배수 · 시즌 점수. 그 단계에서 40웨이브(`GLITCH_UNLOCK_WAVE`) 넘기면 다음 단계 열림
- **프로필** `defense_profile` (회원당 한 문서): 회원별 잠금(KeyedMutex) 안에서 읽고 → 고치고 → 통째 저장. 날 · 주 · 시즌이 바뀌면 `roll` 이 미션 · 패스를 새로
- **미션** 하루 3 · 주 3 (`dailyOf` · `weeklyOf` 날짜로 모두 같음), 숫자는 검증 결과(`VerifyOut.stats` 얻은 유닛 · 닫은 균열)에서 `questValues`
- **시즌 4주 · 패스 30단계** (무료 · 프리미엄 `PASS_PREMIUM_GP` 5000 GP). 테마 아이템은 사이트 인벤토리 `inv.defense` 에
- **GP 연결** (`server/src/points.ts` 의 `spend` · `grant`, 원장 reason `defense`, ref `store:` · `sell:` · `pack:` · `pass…` · `quest:`): 상점(재화샵 · GP 교환 · 패키지 — v1.1 표 참고) · 패스 프리미엄. GP 를 주는 쪽(`storeSell`)은 프로필을 먼저 저장하고 지급
- rpc: `defense.profile · unit.up/upAll/down · res.buy/level · relic.buy/level · box.buy/open · bench.buy · fslot.buy · trans · store.buy · store.sell · pack.buy · load · theme · quest.claim · pass.claim · pass.buy` — 실패하면 프로필은 그대로(저장 전에 throw)
- 화면: `components/Defense/Hub.tsx` — 정비소(6탭)와 상점(`mode="shop"`, 4탭)이 같은 틀. 메뉴의 시즌 도전 · 상점 · 정비소, 판 끝 보상 줄(`FinishNote`), 블록 테마는 `render.ts setTheme`
- 업적 추가: `defense.glitch`(클리어한 오염 단계+1) · `defense.maxlv` · `defense.relics` (`server/src/achievements.ts`)
- **보관함** `BENCH = 6` (`sim.ts`): 칸 번호 `CELLS..SLOTS-1`, 공격 · 오라 없음, 합성 · 조합식 · 판매 가능, 필드가 차면 소환이 여기로. 화면은 필드 아래 줄 (`render.ts BENCH_H`)

### 멀티 (락스텝, 회원만, 최대 4명)
- 서버는 시뮬을 돌리지 않음. 100ms(=3 tick)마다 그 사이 모인 명령을 `turn { n, c }` 로 뿌림
- 클라이언트는 턴 n 을 받아야 tick 3n ~ 3n+2 를 돌릴 수 있음 → 모두 같은 화면. 뒤처지면 한 프레임에 여러 tick 으로 따라잡음
- 새로고침 · 재접속: 방 구독 첫 데이터에 지금까지 기록 → `controller.loadLog` 로 빈 턴 채움
- 내 명령은 복사본에 먼저 해 보고(바로 오류 안내) 되는 것만 보냄
- 끝: 모두 `defense.over` 를 보내면 서버가 기록을 다시 돌려 순위 → `result`
- 지금은 보드끼리 영향 없음(생존 경쟁, 같은 시드라 운은 같음)

- **새로고침 · 탭 닫음 뒤 돌아가기**: 메뉴 · 로비에 "진행 중인 멀티 판으로 돌아가기" (`defense.mine` → `defense.join` 이 자리를 그대로 돌려줌). 판 중 연결이 끊기면 `gone` 시각만 적어 두고, 다른 사람이 다 끝났는데 60초(`GONE_MS`) 안에 안 돌아오면 순위를 냄 (그 보드는 명령 없이 끝까지 돈 결과)
- **어긋남 감시**: 각자 `HASH_TICKS`(150 tick = 5초)마다 `hashGame` 을 `defense.hash` 로 보냄 → 같은 tick 값이 다르면 서버 로그 `[defense] 멀티 어긋남 …` + 방에 `desync` → 화면 오른쪽 위 "동기화 어긋남 N" (관리자 방 목록에도 `desync` 횟수). 따라잡는 중엔 안 보냄

**"남 돕기" 넣는 법 (다음 단계)**: 명령에 다른 보드를 가리키는 종류를 추가(예: `{ t: "gift", to, c }`) → `isCmd` · `apply` 에서 `g.boards[to]` 를 바꾸면 끝.
같은 기록 · 같은 시뮬이라 서버 · 동기화 구조는 그대로. 웨이브는 보드마다 따로 흐르므로, 협동 모드를 만들 땐 웨이브 시계를 `Game` 으로 올리는 것도 고려.

### 화면
- 무대 1024×576 고정 배치를 화면에 맞춰 통째로 확대/축소 (PC = 폰). 폰은 가로 전용 (ANIME POKER 와 같은 방식)
- 필드는 캔버스, 나머지 UI 는 DOM. HUD 는 100ms 마다 다시 그림
- 조작: 칸 누르기 = 정보, 끌기 = 자리 바꾸기(같은 유닛이면 모음). 단축키 Q 소환 · W 합성 · E 판매 · 1 2 3 강화 · 4 확률 · R 조합식 · Space 일시정지 · F 배속 · Esc
- **글자 또렷하게** (PC 에서 글자 깨짐 고친 것): 갈무리11 은 **12px** 에서만 또렷 (9~11px 은 획이 빠지고 13px 이상은 흐림) → 작은 글자는 `text-[12px]` 아래로 쓰지 말 것. 무대 배율은 `Stage.tsx snapScale` 이 (배율 × 화면 배율)을 정수에 맞추고(최대 22% 작게), 무대 위치도 정수 px 로 밂(`frac`). 페이지 폭은 무대 1024 + 여백이 들어가게 `max-w-[1076px]` (`app/games/defense/page.tsx`) — 전엔 0.95배로 줄어 글자가 깨졌음. 화면 위 「전체화면 플레이 권장」 띠도 `Stage.tsx`
- **도트 화면 규칙** (AI 웹사이트 느낌 안 나게): 둥근 모서리 · 흐림 · 부드러운 그라데이션 금지 → `px-*` 클래스 (2px 계단 테두리 · 아래 턱 · 누르면 내려감). 움직임은 `steps()`. 글꼴 갈무리. 이모지 대신 `ui.tsx` 의 `Icon`(8×8 도트) · `FactionIcon`(세력 문장)
- **세력 구분**: 블록 윗면 색 · 버튼 색 · 문장(기사단 방패 / 기계공방 톱니 / 마도회 별) · 칩. **등급 구분**: 블록 테두리 · 그림 외곽선(레어부터) · 발밑 오라(레어 링 → 레전드 빛 기둥 · 반짝이 → 신화 깜빡임) · 칸 왼쪽 위 보석 글자(N R E L M H)
- **마우스**: 도트 커서(`public/defense/ui/cursor*.png`, 손 · 집기 — 원본은 2배 그림, `*-1x.png` 는 반으로 줄인 것. css 에서 `image-set` 으로 보통 화면 1x · 레티나 2x), 버튼은 올리면 1칸 떠오르고 테두리가 밝아짐 + 작은 소리, 메뉴 버튼은 ▶ 표시
- **소리**: 첫 누르기에서 잠금 풀림(Stage). 효과음 종류별 최소 간격 · 동시 14개 제한(배속에서도 안 시끄럽게). 메뉴 · 로비 = `menu`, 1~29웨이브 `wave-early`, 30~ `wave-late`, 보스 `boss`, 60 카이 `boss-final`, 끝나면 배경음을 줄이고 `clear`/`gameover`. 음량은 스피커 버튼(이 기기에 저장)

## 7. 베타 상태 · 다음 할 일

### v0.3 (밸런스 b2) 에서 바뀐 구조
- 명령 `quit`(포기) — 그 웨이브에서 진 것으로 `finish(…, "quit")`. 랭킹 · 보상은 거기까지
- 판매: 모든 유닛 (`sellOf`: `B.sell` · `B.sellStones` 등급별, 유닛별 `UnitDef.sell` 덮어쓰기 — 길들인 글리치 60G+1). 화면은 레전드부터 두 번 눌러야
- 도박 `B.gamble.E/L.from` 웨이브부터 · 균열 버튼의 여유/적정/위험은 화면 어림 (`GameView riftRisk`, 최근 10초 DPS)
- 신화 3종 `k_aegis · m_inferno · a_plague` (안 쓰이던 에픽 · 레어를 재료로) — 그림 ChatGPT, `web/scripts/defense-art/slice.py`
- 단일 코어: 신화 · 히든 **한 종류만**(`coreKind`), 레전드 이하 ×3.6 · 신화 ×2.5 / 도박사: 고르면 행운석 +3 · +10%p · 보스마다 +1
- 오염 단계 0~30 (`GLITCH` 11~30 은 코드로 만듦, `armor` · `boss` 배수 추가) · 10단계부터는 클리어해야 다음이 열림 (`glitchUnlocks`)
- 성장: 등급별 레벨 조각 값 `lvCost` · 내리기 `defense.unit.down`(전부 환불) · 오늘 첫 판 조각 ×2 · 도감 수집 `collectReward`(profile.seen) · 오염 첫 클리어 `glitchFirstClear`
- GP: `GP_SHOP` 유물 확정 상자(1500, 주 3) · 고른 유닛 카드 10장(600, 주 5) — `defense.gp.chest` · `defense.gp.cards`
- 화면: 이어하기(`DefenseApp` localStorage `pgd-resume:<uid>` 2초마다 → `Controller.restore` 로 기록을 다시 돌려 따라잡음, 3.5시간) · 포기하기 · DPS 창(필드 오른쪽 위) · (v1.2.1 에서 클릭 이동 삭제 — 끌어서만) · 재화 말풍선(`ui.tsx Tip`, `Hub CUR_INFO`) · 도트 스크롤바 · 마우스 크기(소리 창, `data-cur` + `cursor-3x/4x/6x.png`)
- 효과: 공격 모양 유닛별 `render.ts HIT_KIND/drawShot` · 공격 동작 세력별 `attackPose` · 소환 `Fx spawn`(빛기둥 + 고리) · 효과음 `spawn`(레어 · 에픽 소환) · `reward` · `chest-open`

### v1.8 BETA — 보물방
- 확률: `progress.ts TREASURE { cap 500, exp 1.7 }` · `treasureChance(쌓인 웨이브, 오염)` = (w/500)^1.7 (오염 0 은 0). 쌓인 웨이브 = 프로필 `twaves` (오염 1+ 시즌 판, 검증된 판의 도달 웨이브 합, 500 에서 멈춤)
  - 몬테카를로: 판당 25~55웨이브면 중앙값 ≈ 240 (짧게 끊는 사람 195 · 길게 버티는 사람 260), 10~90% ≈ 125~360웨이브
  - 뽑기는 서버 `defense.start` → `meta.rollTreasure` (randomInt) — 뜨면 `twaves = 0` · `lo.treasure` = 11~59 중 보스 웨이브 뺀 무작위(`TREASURE_WAVES`). 로드아웃에 들어가서 기록 검증도 같은 값. 판을 버리면 그 보물방은 날아감(다시 시작으로 웨이브 고르기 X). 멀티는 없음
- 판 안 (`sim.ts startTreasure / endTreasure`, `B.treasure`): 그 웨이브 시작 직전 phase `treasure` — 일반 적은 `b.stash` 로 치워 두고 보물 골렘(`e.tre`, kind golem) 하나, 30초. 체력 = hpOf(55) × bossHp × 오염 보스 배수 (웨이브와 상관없음 → 늦게 뜰수록 많이 깎음). 매초 골드 3 + 웨이브 × 0.34. 끝나면 적을 돌려놓고 그 웨이브 시작. 다음 웨이브 · 균열 막힘
  - `b.treasure {wave, dmg, max, killed, gold}` → 검증 stats → `onRun` 이 `treasureReward(오염, …)` (조각 600 × 깎은 비율 × 오염 보상 배수 · 코어 8 × 비율 × (1 + 오염/10) · 처치 카드 상자 1) → `reward.treasure`
  - defense-sim `--treasure W` 로 깎은 비율 확인: 균형 봇 W15 ≈ 10% · W35 ≈ 50~60% · W55 ≈ 90~100% (오염 1 mid ~ 오염 20 max 비슷)
- 화면: 시즌 도전 버튼 위 「보물방 n%」 · 판 시작 「보물방 당첨!」 · 위 줄 「보물방 W37」 → 진행 중 TREASURE + 깎은 % · 남은 초 · 받은 골드 · 판 끝 보상 줄. 골렘 그림은 지금 데드픽셀 골렘 + 금빛 (그림 오면 `ENEMY_ART.treasure`)
- econ: `--treasure 1`(기본)로 보물방 포함

### v1.7 BETA — 보스 2페이즈 6명 · 단계마다 2명
- 기술은 하나로 합침: `{ kind: "tele", shape, every, warn, sec, name, snd }` · 모양 `row · col · cell · two · area(2×2) · plus(십자)` → `sim.ts teleCells` (세기 합이 가장 큰 곳, 같으면 앞)
  - 릴리 col 8s/2s/2.5s · 소영 two 7/2/3 · 제나 row 7/2/3 · 이그나 area 8/2/3 · 이반 cell 8/2.5/6 · 카이 plus 7/1.8/3 (every/warn/기절)
- `PHASE_PAIRS` (`enemies.ts`): 오염 15~30 단계마다 2페이즈 보스 둘 — **고정표** (판마다 무작위면 쉬운 조합 나올 때까지 다시 시작하니까). 웨이브 합이 작은 조합부터 (15: 10·20 … 29 · 30: 50·60). `phaseOn(glitch, wave)` · `phaseText(glitch)`
  - 화면: 정비소 오염 단계 아래 빨간 줄 · 메뉴 ▶ 설명 · 보스 등장 띠에 「2페이즈 있음 — …」
- 효과음 `boss-phase · tele-warn · tele-{wave,whip,bolt,fire,grab,wind}` — **임시 합성음** (`web/scripts/defense-sfx-synth.py`, numpy · scipy · ffmpeg). 일레븐랩스로 바꾸려면 같은 이름으로 덮어쓰기 (프롬프트: 프로젝트 `claude/defense-boss-phase-asset-request.md`)

### v1.6 BETA (밸런스 beta5) — 보스 2페이즈 (오염 15+)
- `BossDef.phase { at, skills, line }` + `BOSS_PHASE_GLITCH = 15` (`enemies.ts`). 보스 체력 ≤ at(0.5) 이면 `e.ph = 1` · `Ev phase`, 2페이즈 기술 쿨은 `e.sk2`
- 새 기술 (예고형 — 배치로 받아치게): `bolt`(가장 센 가로줄) · `grab`(가장 센 칸). 노리는 곳은 `strongRow / strongCell` (칸 세기 = dmg × aps × 수 × (등급+1), 같으면 앞) — 난수 안 씀
  - `b.tele { kind, cells, t, sec }`: t tick 뒤 그 칸에 **그때 있는** 유닛 기절. 예고 중 swap 으로 옮기면 피함. 보스가 죽으면 지움. 한 번에 예고 하나
  - 제나 W30: bolt 7초마다 · 예고 2초 · 기절 3초 / 이반 W50: grab 8초마다 · 예고 2.5초 · 6초
  - 화면: `render.ts` 빨간 칸 깜빡임 + 기술 이름 · 남은 초, `Ev tele`(warn/hit) → 효과음 · 「피했어요!」/「N칸 기절」, 2페이즈 시작 외침
  - 봇: 예고 중 표시된 칸의 가장 센 유닛을 표시 밖 빈 칸 · 더 약한 칸으로 swap (`bot.ts dodge`)
- defense-sim (성장 max · 오염 20 · 전략별 12판) 2페이즈 있음/없음: 평균 웨이브 0~3 낮아짐 (균형 41.6 → 38.7, 이자 48.2 → 45.4, 순혈 53.8 → 53.0), 30보스 사망은 1판으로 같음 → 봇이 피하면 크게 어렵진 않음. econ 은 다시 안 돌림 (15단계 이후 조금 느려질 것)
- 효과음 `boss-phase · tele-warn · tele-bolt · tele-grab` (`assets.ts SFX`) — 파일 없으면 무음. 요청서: 프로젝트 `claude/defense-boss-phase-asset-request.md`
- 나머지 보스(릴리 · 소영 · 이그나 · 카이) 2페이즈는 주인이 해 보고 정함

### v1.5 BETA (밸런스 beta5 그대로) — 다음 웨이브 부르기 · 단계별 최고 기록
- 명령 `{ t: "next" }` (`sim.ts nextBlock · nextBonus`): 준비 시간 · 적이 다 나온 일반 웨이브 · 보스 뒤 쉬는 시간에 다음 웨이브로. 일반 웨이브면 남은 1초마다 `B.nextGold`(1) 골드. 남은 적은 그대로 (겹치면 위험). 보스 웨이브 중엔 안 됨
  - 랭킹 점수(클리어 = 1e9 − tick)라 당기면 기록도 좋아짐. 멀티는 보드마다 따로 (웨이브 시계가 보드별)
  - 화면: 필드 왼쪽 위 「▶▶ 다음 웨이브 +nG」(N 키) · 「자동」(localStorage `pgd-autonext`, 필드가 비면 부름 · 보스 웨이브 앞은 안 부름 — 클라이언트가 명령을 보내는 것이라 기록 · 검증 그대로)
  - 봇: 할 거 다 하고 필드가 비면 부름 (보스 앞 제외). econ 판당 시간 8.1분 → 7.9분 (−2%) — 봇은 늘 한계에서 싸워서 필드가 잘 안 빔. 사람이 성장이 남을 때 효과가 큼
- 프로필 `gbest` (오염 단계 → 최고 웨이브, 클리어 = 61): `onRun` 이 갱신하고 `reward.gbest {glitch, prev, now}` 로 돌려줌 → 판 끝 `FinishNote` 에 「W47 → W52 갱신!」 / 「최고 W52 · 이번 W47 (5웨이브 차이)」. 보스에게 지면 결과 창에 보스 체력 % 남음
- 처음 계획한 「빠른 시작(W15부터 + 골드 묶음)」은 안 함 — 건너뛴 웨이브의 처치 골드 · 미션 · 균열 · 10웨이브 치트 카드까지 맞춰 줘야 해서 밸런스가 흔들림. 다음 웨이브 부르기로 같은 효과(초반 빈 시간 없애기)를 플레이어 선택으로

### v1.4 BETA (밸런스 beta5) — 순혈 70% · 재조정
- 순혈 기준 `TUNE.pureFrom 0.4 → 0.7` + `pureBase 0.5`: `pureT(r)` = 70% 밑 0(꺼짐) · 70% 에서 0.5 · 100% 에서 1 (비례). `b.pureR` = 가장 많은 세력 비율(화면 표시용)
  - 유물 「순수 혈통」도 같은 기준 (`b.pure > 0` 이면 켜짐, 예전엔 한 세력뿐일 때). 치트 `c_mono` 도 `b.pure` 그대로
  - 화면: 순혈인데 꺼져 있으면 조합 · 미션 · 도감 버튼 위 빨간 글씨 (`GameView` 오른쪽 패널 아래)
  - 봇 `순혈`: 다른 세력은 에픽 이하 늘 · 레전드는 꺼져 있을 때 보관함으로, 자리 없으면 팖 (재료도 안 남김). 예전 로직은 70%를 못 맞춰 늘 55% 근처 → 순혈 혼자 90시간
  - econ: 주력 세력 봇은 순수 혈통을 안 낌 (순혈 운영만) — 섞어 쓰는 봇이 켜지지도 않는 유물을 끼던 것
- 밸런스 beta5: 심연 `DEEP_PARAMS.hpPerLv 0.04 → 0.085` · `pureDmg 2.8 → 2.4` · 이자 `interestWave 1.6 · interestPct 0.05 · interestMax 16` · `gamblerP 0.2` · 연구 `m_tune` 13 · `a_echo` 18
- econ 4시드(7 · 11 · 23 · 31) 평균(봇 ×2 배속, 오염 30 클리어까지): 마도회 55.8h · 이자 55.0 · 균형 54.5 · 도박사 49.7 · 순혈 47.2 · 기사단 46.9 · 기계공방 42.0 · 이자째기 36.1 → 최대/최소 1.55
  - **시드 차가 매우 큼**: 같은 설정 · 같은 봇이 판마다 20~95시간 (오염 30 클리어가 "충분히 센 뒤 운 좋은 한 판"이라 기다리는 시간이 들쭉날쭉). 3시드 평균은 설정을 거의 안 바꿔도 ±40% 흔들림 → 비교는 4시드 이상으로
  - 이자째기만 40h 밑. 심연을 더 올려도(0.095) 째기는 37.8h 그대로고 마도회만 77.6h 로 늘어나 간격만 벌어짐 → 째기를 늦추려면 째기 쪽(이자 · 골드 모으기) 자체를 손봐야 함
  - 한 판 3~6분 (2코어면 24판에 1시간 넘게). 실험 인자: `--deep a,b,c,d,e,f` · `--tune k=v,…`

### v1.3 BETA (밸런스 beta4) — 순혈 프로토콜 (단일 코어 대신)
- 시작 치트 `pure`: `rebuild` 가 필드 유닛 수로 세력 비율을 셈 (히든은 전체에만 셈, 보관함은 안 셈) → `b.mono`(가장 많은 세력) · `b.pure = pureT(비율)` (TUNE.pureFrom 0.4 이하 0, 100% 면 1)
  - 그 세력 피해 × `1 + (pureDmg 2.8 − 1) × b.pure` (`hit`), 그 세력 강화 비용 × `1 − (1 − pureUp 0.7) × b.pure` (`upCost`)
  - 치트 `c_mono`(단일 세력 코드)도 같은 `b.pure` 로 `b.team` 에 비례. 유물 「순수 혈통」은 예전처럼 한 세력뿐일 때만
  - 단일 코어(`coreBlocked` · `TUNE.core*`) 삭제. 봇 `순혈`(기계공방 · pure): 필드의 다른 세력 에픽 이하를 보관함으로 빼고, 자리가 없으면 팖
  - 밸런스 beta4: 이자 `TUNE.interestWave 1.35 · interestPct 0.08 · interestMax 20` · 도박사 `gamblerP 0.15` · 끈기 `GRIT_PER 0.06`(최대 +90%) · `LV_COST` 카드 ×1.25 (5·10·15·25·38·50·75·100·150·200 = 668장) · 연구 `a_echo` 15 · `k_tactic` 30
  - econ 3시드 평균(봇 ×2 배속, 오염 30 60보스까지): 균형 28.5h · 이자째기 30.7 · 도박사 32.4 · 기계공방 37.6 · 마도회 38.7 · 순혈 39.1 · 기사단 41.7 · 이자 42.2 → 최대/최소 1.48 (≤1.6). 사람(배속 섞어 ~×1.5) 추정 40~55h — 시드 차가 커서 더 느리게 하려면 카드 · 조각을 고르게 늘릴 것
  - 처음엔 「한 세력만 두면 켜짐 + 소환 편향」으로 만들었다가 주인 의견으로 비율 방식으로 (뽑기가 막히고, 판매 연구 · 세력 연구 몰빵이 강제되던 것)

### v1.2.1 BETA (밸런스 그대로 beta3) — 튜토리얼 · 상점 정리
- **튜토리얼** `components/Defense/Tutorial.tsx`: 판 안 안내 카드 9장 (`STEPS` — 조건 `when(b)` 이 맞으면 순서대로 하나씩, 판은 안 멈춤). 본 것은 이 기기 `localStorage pgd-tut {done, off}`, `resetTutorial()` 은 메뉴 왼쪽 아래 「튜토리얼」 · 일시정지 창
- 유물 코어로 바로 사기 삭제 (rpc `defense.relic.buy` 없음) — 유물은 상자에서만. `RELIC_CORE_PRICE` 는 강화 코어 계산에만
- 재화샵 `GP_STORE` 주간 제한 없음 (`perWeek` 빠짐, GP 교환 · 주간 패키지는 그대로 주 한도)
- 시즌 패스 칸에 「카드 상자 · 유물 상자」 이름
- 자리 옮기기는 끌어서만 (클릭 두 번 이동 · 「이동」 버튼 · M 키 삭제)
- 패키지 `give.trans` 는 바로 돌리지 않고 **초월 상자** `boxes.trans` 로 (rpc `defense.box.open {kind: "trans"}` = 초월 소환 1번, 사기는 없음 — 코어 소환은 `defense.trans`)
- 한/영: 단축키는 `e.code` 로 읽음 (`GameView keyOf`)
- 겹친 유물: `openRelic` 이 `relicShardsToMax(id, lv) <= 가진 조각` 이면 조각 대신 `RELIC_DUP_CORES[희귀도]` 코어 (got.cores) — Lv.5 뒤 쓸모없는 조각이 쌓이지 않게

### v1.2 BETA (밸런스 beta3) — 치트 코드(증강) · 시작 치트 · 끈기 · 일일 패키지
- **치트 코드** (`lib/defense/cheats.ts`, 다른 게임의 증강): 보스 10 · 20 · 30 · 40 · 50 을 잡으면 `offerCheat` 가 `b.cheat = { kind: "cheat", offer[3], rr[3], t }` → **고를 때까지 그 보드는 멈춤** (`step` 이 건너뜀). 명령 `{t:"cheat", i}` 고르기 · `{t:"reroll", i}` 그 카드 다시 뽑기 (카드마다 `mods.cheatReroll`, 기본 1). 고르는 중엔 다른 명령은 거절(포기만 됨)
  - 솔로: `controller.tickOnce` 가 `b.cheat` 이면 시계를 멈춤 (게임 시간 tick 이 안 늘어남 → 랭킹 시간 검증 그대로). 멀티: 보드만 멈추고 `CHEAT_MULTI_SEC`(20초) 지나면 첫 카드 자동 (`ev cheat auto`)
  - 뽑기는 보드의 따로 된 난수 `b.crng` (`mixSeed(seed, 77)`) — 소환 운과 섞이지 않음. 같은 시드 멀티는 모두 같은 카드가 나옴
  - 등급 4 (기본 · 고급 · 비밀 · 금지, `cheatOdds(몇 번째, luck)` — 뒤 보스일수록 높은 등급) · 종류 4 (유닛 · 골드 · 피해 · 버프) · 39종, 한 판에 같은 것 한 번. 효과는 `cheatFxOf(고른 id)` → `b.cx` (피해 · 세력 · 보스 · 레전드 이하/신화 이상 · 한 세력/세 세력 · 공속 · 치명 · 적 속도 · 방어 깎기 · 골드 · 이자 · 할인 · 보스 시간 · 패배 기준 적 수 · 복제 · 도박), 바로 받는 것은 `now`(골드 · 행운석 · 무료 소환 · 골라 뽑기권 · 강화 레벨)
  - 보정: 치트 보스를 하나 지날 때마다 모든 적 체력 +`TUNE.cheatHp`(0.15) — `cheatHpOf(웨이브)`, 고른 치트와 상관없이 웨이브로만
  - 화면: `GameView CheatPicker`(필드 위 3장 · 다시 뽑기 버튼) · 고른 코드는 위쪽 HUD 「필드의 적」 오른쪽 칸에 아이콘으로 (맨 앞은 시작 치트) · 봇은 `bot.ts cheatScore`
- **시작 치트 = 패치**: `newBoard` 가 `b.cheat = { kind: "patch", offer: 패치 4개 }` 로 시작 → 고를 때까지 준비 시간도 멈춤. 예전 「패치 고르기」 버튼 · `PATCH_DEADLINE` 자동 연합 없음 (`patch` 명령은 시작 창이 떠 있을 때만). 단일 코어 · 이자 수치는 `TUNE` (meta.ts 설명도 TUNE 에서 만듦)
- **치트 연구** (`CHEAT_RES`, 로드아웃 `cheat`, 프로필 `cheatRes` · `load.cheat`): 리롤 회로(`x_reroll` 다시 뽑기 +1) · 확률 증폭기(`x_luck` 비밀 ×1.5 · 금지 ×2) — 각 코어 120 + 조각 12,000, rpc `defense.cheatres.buy {id}`, 출전 준비 1칸 · 상점 「상자 · 소환」 탭
- **끈기** (`GRIT_PER 0.05` · `GRIT_MAX 10`, 로드아웃 `grit` → `Mods.gritDmg`): 가장 높은 열린 단계(아직 못 깬)에서 연달아 진 판 수 — 서버 `onRun` 이 `p.grit {g, n}` 에 셈, 단계를 넘기면 0, `gritOf` 로 시작 때 붙임. 메뉴 시즌 버튼 · 판 HUD 에 「끈기 +%」
- **세력 연구 3번째** (`k_rally` 기사단 공속 · `m_bounty` 기계공방 보스 피해 · `a_echo` 마도회 공속) — 한 세력 원툴이 세력 칸 3개를 다 쓸 수 있게. `Mods.facAspd` (예전 `mechAspd` 대신) · `mechBoss`
- **일일 패키지** `p_daily` 500GP 300% (`perDay`, 프로필 `shopDay {d, n}`)
- **밸런스 손잡이 `TUNE`** (balance.ts — 객체라 시뮬이 `--tune k=v,…` 로 바꿔 봄): cheatHp · coreLow/High/Slow · interestPct/Max. 시뮬 도구 `--grit n` · `--cheathp`. tsx 에서 모듈이 두 벌이라 두 벌 다 고침 (createRequire)
- 경제 · 밸런스 결과 (`defense-econ.ts`, 봇 · 배속 2 · 하루 8판, 시드 7 · 9 평균 — 오염 30 클리어까지):
  이자째기 33.8h · 균형 37.9h · 도박사 42.3h · 마도회 44.2h · 단일 코어 45.1h · 기사단 48.1h · 기계공방 48.7h · 이자 51.1h → **가장 느린 길 ÷ 가장 빠른 길 = 1.51** (목표 1.6 이하).
  오염 10 첫 클리어 2~6h · 20 은 13~30h · 30 은 34~51h, 한 단계에서 가장 오래 막힌 시간 3~8h (끈기 최대를 +50% → +75% 로 올려 12h 막힘을 없앰). 판 하나 게임 시간 10~18분(예전과 같음)
  - 거쳐 온 조정: 치트만 넣으면 late/10 평균 웨이브 46.9 → 53.7 → `cheatHp 0.15` 로 47.9 · 원툴은 세력 연구가 2개뿐이라 3번째 추가 · 단일 코어 ×3.6/2.5 → ×7/4.5 (늦게 필드가 차서 지던 것) · 도박사 +10 → +15%p · 이자 웨이브 골드 +20% / 최대 70 → 40 (모아 두는 길만 너무 빨랐음) · 무지개 연합 12 → 9% · 삼색 동맹 25 → 20% · 심연 +2% → +4% · 레벨업 카드 ×1.25. `cheatHp 0.2` 는 원툴만 더 느려져(비율 2.0) 되돌림
  - 봇 `소환만`(강화 · 조합을 거의 안 하는 시험용)은 비교에서 뺌. 봇은 초월을 안 씀 → 사람은 판 수가 덜 들지만 배속을 섞어 써서 40~80시간 어림

### v1.1 BETA (밸런스 beta2) — 상점 · GP 경제 · 심연 재조정
- **주간 도전 없앰** (`weekly` 모드 · 순위표 · 순위 GP `WEEKLY_GP` · `weeklyRelics` · `paidWeek` 전부). 메뉴 그 자리 = **상점** 화면 (`Hub mode="shop"`: 패키지 · 상자 · 소환(+칸 해금) · 재화샵 · GP 교환). 정비소 상점 탭 없음
- **프로필**: `coreBuys` · `gpBuys` · `paidWeek` 대신 `shop {w, n: id→이번 주 산 수}` · `packs` (한 번만 패키지) · `pity` (초월 천장)
- **초월 소환** `transRoll(pity, r)` (progress.ts, 서버 · 경제 시뮬 같은 함수): 코어 40 · `rate 0.15` · `pity 10` (마지막 초월 뒤 9번 꽝이면 10번째 확정 — 실제 확률 ≈ 18.6%). 꽝 = `TRANS_MISS` 조각 600 (50%) · 코어 8 (30%) · 카드 상자 2 (20%)
- **GP 값 기준** `GP_VALUE` (= 재화샵 값, 100%): 조각 2GP · 코어 250 · 카드 상자 600 · 유물 상자 3,000 · 초월 소환 10,000. `goodsGp(묶음)` · `packPct(패키지)`
- **재화샵** `GP_STORE` (주 한도): 조각 500 = 1,000GP (5) · 코어 4 = 1,000GP (5) · 카드 상자 600GP (5) · 유물 상자 3,000GP (2)
- **GP 교환** `GP_SELL` (재화샵 값의 절반, 주 한도): 조각 1,000 → 1,000GP (3) · 코어 4 → 500GP (2) — 한 주 최대 4,000GP (출석 1,400/주의 약 3배) → 다른 게임으로 새는 GP 상한
- **패키지** `GP_PACKS` (GP 전용 · 300~800%, 테스트가 범위 검사): 신입 1,000GP 1회 520% · 주간 보급 1,500GP 주1 553% · 유물 탐사 2,000GP 주1 550% · 초월 계약 3,000GP 주1 667% (소환 2) · 픽셀 숲 3,000GP 1회 300%+테마 · 심연 개척 4,000GP(오염 10 클리어) 800% · 심연 정복 6,000GP(오염 20 클리어) 750%. 한 주에 다 사면 6,500GP — 업적 GP 로는 다 못 사서 고르게 됨
- **업적 GP** (`points.ts`, 디펜스 한 번짜리 합계 16,800 → 44,300, + 반복형 판 5번 · 처치 5,000마리마다 50GP ≈ 판당 20GP): 오염 15/20/25/30 클리어 2,000/3,000/4,000/6,000 · 150/400판 1,000/2,500 · 30/100 클리어 2,000/4,000 · 처치 5만/20만 1,000/2,000. 테마 `defense.theme.*` 는 사이트 `SHOP` 에서 뺌
- **심연 곡선** `DEEP_PARAMS` → `deepGlitch(P)` (규칙 글도 값에서 만듦): 단계마다 체력 +2%(10단계 2.6 기준, 30단계 3.64) · 방어 ×1.1(11~)/×1.2(20~) · 보스 ×1.05(15~)/×1.1(25~) · 속도 ×1.08(20~) · 보스 시간 -18(25~) · 보상 배수 +0.1/단계 (30단계 ×6). 옛 값(+9% · ×1.3/1.6 · ×1.25/1.5)은 다 키운 봇도 30단계 0%였음
- **유닛 레벨 카드 ×1.6** (`LV_COST` 3·6·10·16·24·32·48·64·96·128 = 427장) — 성장 속도는 카드(판 수)가 정함
- **시뮬 도구**: `defense-sim.ts --deep hp,armor11,armor20,boss15,boss25,spd20` (심연 곡선 바꿔 보기) · **`defense-econ.ts`** (봇 한 명이 0부터 판을 계속 — 실제 보상 함수 · 미션 · 패스 무료 · 업적 GP · 패키지로 성장, 30단계 클리어까지 시간). `--deep · --rslope · --cardmult · --lvmult` 로 실험. 주의: tsx 에서 `sim.ts` 가 `progress.ts` 를 CJS 로 따로 불러 **모듈이 두 벌** → 값을 바꿀 땐 `createRequire` 로 두 벌 다 고침
- 결과 (봇 · 배속 2 · 하루 8판, 초월 안 씀): 오염 30 클리어까지 이자째기 36h(241판) · 균형 49h/53h(시드 2개, 347/408판) · 도박사 72h(465판) · 기계공방 90h(683판) — 바꾸기 전 25~31h. 운(시드) 차이가 큼. 다 키운 성장 봇 30단계 클리어 0~20%. 사람은 배치 · 초월이 나아 판은 덜 들지만 배속을 섞어 써서 **40~80시간** 어림. 실제 기록이 쌓이면 `LV_COST` 카드 · `DEEP_PARAMS` 로 조정

### v1.0 BETA (밸런스 beta1) 에서 바뀐 구조 — 데이터 초기화 후 시작
- **판 7×4** (`sim.ts COLS/ROWS`, 길 한 바퀴 26칸, `pathPos` 일반식) · **보관함 오른쪽 세로 줄** (`render.ts BENCH_W = CELL`, 캔버스 `CW = FW + BENCH_W`). 칸 72px
- **보관함 잠금**: `BENCH_MAX 6` 중 `b.mods.bench`(로드아웃 `bench`, 처음 `BENCH_BASE 3`)만 씀 — `usable(b, i)`, `hasEmpty` · `give` · `swap` 이 확인. 정비소 `defense.bench.buy` (조각 `BENCH_COST`)
- **연구칸**: 공용 `RES_SLOTS 4` 는 group general 만, 세력 칸 `fslots`(0~3, `defense.fslot.buy` 코어 `FRES_COST`)는 세력 연구만 — `cleanLoadout` · `setLoad` 둘 다 검사
- **초월 등급 6** (`TRANS = 6`, `TRANS_IDS`): 조합식은 `b.mods.trans` 에 있어야 열림 (`recipeOpen`). 상점 `defense.trans` (코어, v1.1 부터 15% · 천장 10 — `transRoll`) — 처음이면 `p.trans` 에 넣고, 겹치면 카드
- **조합식 @ 재료**: `"@4"` 아무 신화 · `"@6"` 아무 초월 (`needMatch` · `needName`) — `recipePlan` 이 정해진 재료 먼저, @ 는 남은 것에서. 히든 노아 = @6 + @4 + @4
- **히든 강화** `b.up.hidden`: 히든 피해는 안 오르고 `hiddenFx`(Lv 당 8%)가 삭제/정화 비율 · 방어 깎기 · 보스 배수에 붙음. 단축키 4 히든 · 5 확률
- **균열 S** (`RIFT_TIERS`, 30웨이브부터) · 새 유닛 능력 `execute`(처형) · `pierce`(보스 보호막 무시)
- **강화 레벨 버프**: `LV_BUFF 0.03` — 오라(공속 · 둔화 · 방어 깎기) · proc 확률 · 처형선에 `lvBuff`
- **유물 보유 효과**: 로드아웃 `own`(가진 유물 전부 + 레벨) → `relicPassive` → `Mods.relicDmg`. 유물 강화는 **유물 조각**(`p.shards`, 상자에서 겹치면 +1) + 코어 (`relicUpCost` → {shards, cores})
- **상자 개편** (`BOX`): 카드 상자(조각 · `boxes.card`) · 유물 상자(코어 · `boxes.relic`) · 초월 소환 — rpc `defense.box.buy/open {kind}` · `trans`. 옛 `chest` · `gp.chest` · `gp.relic` · `gp.cards` · `cores.buy` 없음
- **관리자 초기화**: 관리자 → 랭킹 탭 아래 「픽셀 운빨 디펜스 데이터 초기화」 (`POST /api/admin/defense/reset`, 확인 문구 `디펜스 초기화`) — profile · rank · runs · users.stats.defense 삭제, GP 그대로
- 그림: 새 10종 + 공격 그림 (ChatGPT 같은 대화에서 「same style」로 새 캐릭터 → 공격 시트), 상점 아이콘 `items/cardbox · relicbox · trans`
- 봇 시뮬 (8판): 성장 없음 클리어 0~13% · 평균 44~53웨이브 / 다 모은 성장 오염 10 = 13~75% / 오염 25 = 0% (20~41웨이브)

### v0.3.2 에서 바뀐 구조 (밸런스 b2 그대로 — 1레벨이 예전 수치라 예전 기록 다시 돌리기가 같음)
- **연구 · 유물 레벨 1~5** (`RES_MAX_LV` · `RELIC_MAX_LV`): 연구 정의가 `res(id, 이름, "설명 {v}", 레벨→수치, …)` 로 바뀜 (`RES[id].val(lv)` · `resDesc`), 유물은 `RELIC_VAL` 표 · `relicDesc`. `modsOf` 가 레벨을 읽음. `Loadout.resLv · relicLv` 는 **2 이상만** 적음 (예전 기록 모양 그대로)
  - 값: 연구 조각 `resUpCost = cost × 지금 레벨` · 유물 코어 `relicUpCost = (8·15·30) × 지금 레벨`. 내리면 전부 돌려받기 — rpc `defense.res.level` · `defense.relic.level { id, dir: 1 | -1 }`. 주간 도전은 레벨 없음
  - `Mods.firstHarvest` 는 이제 웨이브 수(0 = 없음), `alchemy` → `alchemyGold · alchemyStones`
  - 성장 봇: `--meta max` 는 연구 · 유물 5레벨, late 3. 다 모은 성장 기준 오염 10 = 0~33% · 20 = 17~48웨이브 (전엔 0~5% · 23~39)
- **유닛 일괄 강화** `planUpAll` (progress.ts, 서버 · 화면이 같은 함수): 낮은 레벨부터 고르게 → rpc `defense.unit.upAll { id? }` (id 있으면 그 유닛만 최대한)
- **보스 확정 뽑기권**: `b.tickets` 는 배열이라 이월됨. `pick` 은 아무 등급 뽑기권이나 골라 씀 (`tickets.indexOf(grade)`), 화면 `PickModal` 은 등급별 탭 + 남은 수
- **말풍선** `ui.tsx Tip`: 눌러도 열리고 바깥을 누르거나 Esc 로 닫힘, `align` (가장자리면 right/left). 감싸는 줄의 z-index 가 아래 칸보다 낮으면 가려짐 → 정비소 머리 `z-30`
- **효과음 배속**: `audio.ts setSfxSpeed` — 전투음(`COMBAT`)은 간격 × 배속 · 따로 6개까지 · 배속이면 꼬리를 짧게 끊음, 나머지 소리는 자리가 없으면 가장 오래된 전투음을 끊고 울림

- **공격 그림** `units/<id>-atk.webp` (160×160, 서 있기와 같은 발 위치): `assets.ts ATK` 에 id 를 넣으면 `SpriteSpec.atk` → `render.ts srcAt` 가 공격 뒤 240ms 동안 바꿔 그림 (등급 외곽선도 같은 그림으로). 만드는 법: ChatGPT 에 서 있기 시트(4×3) 를 참고로 올려 같은 칸에 공격 자세 → 체커 무늬 배경이면 `unchecker.py` → `slice.py` → `atk_fit.py`(서 있기 몸 키 · 다리 위치에 맞춤, 효과 빛은 빼고 잼). 44종 전부 (2026-10-13). 새 유닛도 서 있기 + 공격 두 장이 기본

### 콘텐츠 소모 속도 (설계 어림)
- 연구 12개 전부 ≈ 조각 10,900 → 판당 300~600 이면 20~40판
- 유닛 하나 Lv.10 = 카드 427장(v1.1) · 조각 7,630 × 등급 배수 (노말 ×0.5 ~ 초월 ×3). 카드는 그 유닛을 얻을 때만 (판당 1~2장) → 주력 유닛 하나 만렙 ≈ 250~400판, 전부는 사실상 끝없음 (카드 상자로 조금 당김)
- 유물 12개: 상자 35% · 코어 · GP 상자 → 2~4주. 유물 5레벨 = 코어 일반 80 · 희귀 150 · 전설 300 (전부 ≈ 2,300 코어) → 오래 가는 코어 소모처
- 연구 5레벨 = 처음 값 × 10 더 (12개 전부 ≈ 조각 109,000) → 장착할 4개 위주로 올림
- 오염 단계: 0~9 는 40웨이브로 빨리 열림 (알파 테스터가 하루에 9까지), 10부터 클리어 필요 + 심연 → 봇 기준 다 모은 성장으로도 20단계는 25~40웨이브. 끝 목표
- 매일: 일일 미션 3 + 첫 판 ×2 / 매주: 주간 미션 · 상점 주 한도(재화샵 · GP 교환 · 주간 패키지) 초기화 / 4주: 시즌 패스


- [x] 보관함 6칸 · 조합식 재료 정리 (신화에 노말 재료 X)
- [x] 로드아웃 엔진 · 서버 검증 · 멀티 로드아웃
- [x] 성장 서버 (프로필 · 보상 · 미션 · 시즌 패스 · 상자 · GP 교환 · 주간 도전 · 순위 GP) + 테스트
- [x] 정비소 화면 · 메뉴 · 랭킹 탭(시즌/주간) · 판 끝 보상 · 블록 테마
- [x] 밸런스 b1 + 성장 봇 시뮬 (`defense-sim.ts --meta mid|late|max --glitch N`)
- [x] 유물 12 · 재화 3 · 상자(닫힘/열림) 그림 — ChatGPT 시트 → `web/scripts/defense-art/icons.py` 로 잘라 128px webp (`public/defense/relics/` · `items/`)
- [x] 효과음 `reward`(미션 · 패스 받기) · `chest-open` (ElevenLabs 효과음, 1초). **`legend.mp3` 가 거의 무음(-80dB)이던 것 발견 → 새로 만들어 바꿈**. 새 소리는 기존 소리와 비슷한 크기로 줄여 넣음 (최대 -17 ~ -21 dB)
- [ ] 판 안에서 장착한 유물 · 오염 단계 표시 (지금은 메뉴 · 정비소에서만 보임)
- [ ] 시즌이 끝날 때 시즌 순위 보상 (지금은 주간만 GP)
- [ ] 실제 기록이 쌓이면 재화 수급 · 패스 경험치 조정 (지금 값은 봇 기준 추정: 판당 조각 150~400 · 카드 15~30)

## (알파) 상태 · 다음 할 일

- [x] 엔진 · 봇 시뮬 · 랭킹 검증 · 멀티 락스텝
- [x] 에셋 — 유닛 41 · 적 8 · 보스 6 (ChatGPT 이미지) · 효과음 23 (ElevenLabs) · 배경음 5 (주인 제작) · 글꼴 · 커서
- [x] 도트 2.5D 화면 개편 · 세력/등급 구분 · 호버 · 커서 · 이름 PIXEL GLITCH DEFENSE
- [x] 밸런스 1차 (a2, 9번)
- [x] 효과음 · 배경음 연결 (`audio.ts`)
- [x] 멀티 어긋남 감시 · 새로고침 뒤 돌아가기 · 끊긴 사람 기다리다 순위
- [x] 메뉴 노출 · 사이트맵 · noindex 해제 · 이름 PIXEL LUCKY DEFENSE
- [x] 게임 가이드 `data/gameGuides.tsx` `DEFENSE_GUIDE` (페이지 GameHeader 「가이드」) — 규칙 · 수치가 바뀌면 같이 고치기
- [x] 패치노트 `components/Defense/PatchNotes.tsx` (메뉴 왼쪽 아래) — **패치마다 `PATCHES` 맨 앞에 추가**
- [x] 전체화면 버튼 PC 포함 모든 화면 (`ui.tsx` `FsButton`)
- [ ] 멀티 "남 돕기" · 협동 보스 · 관전 — **주인과 상의 후** (설계는 6번)
- [ ] 유닛 공격 동작 그림 (지금은 한 장 그림 + 코드로 튀어나감 · 눌림). 시트로 받으면 `attack` 줄만 채우면 됨
- [ ] 필드 배경 그림 (`FIELD_ART`) — 지금은 코드로 그린 돌길 · 블록. 그림을 쓰려면 칸 경계가 `CELL`(76) 격자와 맞아야 함
- [ ] 라이브 이미지(Grok) — 필요하면 주인에게 요청 (메뉴 · 보스 등장 연출 후보)
- [ ] 배포 때 방 이어받기(live.ts) — 지금 멀티 방은 서버 재시작하면 사라짐
- [ ] 실제 판 기록이 쌓이면 밸런스 2차 (60보스 도달률 · 전략별 차이)

## 8. 테스트 메모
- 2026-10-13: 서버 · 웹 타입체크 통과. 봇 시뮬 결정론 확인(전략 8종). 멀티 락스텝을 가짜 서버로 돌려 두 클라이언트 + 중간 입장 클라이언트 해시 일치 확인.
- `server/test/defense.test.ts` 는 작성만 (윈도우에서 `npm test -- defense` 로 돌려 볼 것).
- 2026-10-13 (2차):
  - `npm test -- defense` 9개 통과 (어긋남 감시 · 돌아가기 검사 추가). `defense-sim.ts -n 40` 결정론 확인
  - 서버 Docker 빌드가 `web/src/lib/defense` 를 못 찾던 문제 → `server/Dockerfile` 에 복사 줄 추가
  - 실제 화면(dev-fake + 헤드리스 크롬)으로: 메뉴 → 혼자 하기 → 소환 · 칸 고르기 · 강화 · DEV 봇 ×10 (28웨이브까지) · 판 끝 결과창 → **랭킹 1위 등록** 확인
  - 멀티(alice · bob): 방 만들기 → 준비 → 시작 → 서로 명령 · 상대 보드 표시 확인. **고친 것**: 새로고침하면 로비에 진행 중인 방이 안 보여 돌아갈 길이 없었음 → "진행 중인 판으로 돌아가기" 추가, 끊긴 사람을 영원히 기다려 순위가 안 나오던 것 → 60초 뒤 순위
  - `dev-fake.ts`: 가짜 회원을 두 명 이상 만들면 `nickKey` 중복으로 서버가 죽던 것 고침 (멀티 확인용)
  - 폰 가로 · 세로 안내 확인

## 9. 밸런스 기록

### a2 (2026-10-13) — 1차: 보스 벽 완화 · 중후반 필드 압박
바꾼 것
- **보스 우선 공격**: 사거리 안에 보스가 있으면 먼저 침 (`sim.ts target`). 전에는 "가장 많이 간 적" 기준이라 남은 졸개가 보스를 가려 10 · 20보스가 벽이었음
- **보스 크기 상성 하한** `B.bossSizeFloor = 0.8`: 기사단(중형 0.7 · 대형 0.45)도 보스는 0.8 이상으로 침 → 기사단 위주 플레이 보강
- **적 체력 곡선 2단**: 20웨이브까지 ×1.068/웨이브, 그 뒤 ×1.155 (`B.hp.mult2 · from2`) → 중후반엔 필드 100마리로 지는 판이 생김
- **웨이브 적 수**: 12 / 16 / 20 / 26(21~40) / 32(41~) (`B.waveCount · waveCountTo`)
- **보스 체력** `B.bossHp` 17 → 5.5 (체력 곡선이 가팔라져서), 이그나 체력 1 → 0.55 · 물리 저항 0.5 → 0.35 · 보호막 8초 → 10초, 이반 체력 1 → 0.6 · 소환 8초 4마리(×2) → 9초 3마리(×1.5)
- **도박사 패치**: 실패 시 행운석 돌려받기는 레전드 도박만 (에픽은 1개짜리라 돌려받으면 공짜로 무한 도박이 됐음)

봇 시뮬 전후 (`npx tsx scripts/defense-sim.ts`, a1 = 20판 · a2 = 40판)

| 전략 | a1 평균 웨이브 | a1 사망(필드/보스) | a2 평균 웨이브 | a2 사망(필드/보스) |
| --- | --- | --- | --- | --- |
| 균형 | 38.5 (클리어 5%) | 0/19 | 46.2 | 27/13 |
| 기사단 | 29.5 | 0/20 | 42.3 | 19/21 |
| 기계공방 | 34.5 | 0/20 | 45.9 | 26/14 |
| 마도회 | 30.0 | 0/20 | 43.1 | 16/24 |
| 이자 | 29.5 | 0/20 | 43.8 | 22/18 |
| 도박사 | 54.5 (클리어 10%) | 0/18 | 45.6 | 18/22 |
| 단일코어 | 31.5 | 0/20 | 38.9 | 20/20 |
| 소환만 | 17.5 | 0/20 | 28.8 | 33/7 |

- 죽는 곳: a1 은 10 · 20보스(합 79/160) → a2 는 21~30 필드 · 40 · 50보스 · 41~50 필드로 퍼짐 (10 · 20보스 사망 0)
- 전략 간 격차(소환만 제외): a1 29.5~54.5 → a2 38.9~46.2
- 봇 클리어 0% — 사람은 배치 · 균열 · 조합 타이밍이 봇보다 나아서 이 정도가 알맞다고 봄. 실제 판 기록이 쌓이면 60보스(카이) 도달률을 보고 다시 조정

### b1 (2026-10-13) — 베타: 보관함 · 성장 붙이기
바꾼 것
- 보관함 6칸 (봇도 보관함을 씀: `bot.ts benchMove`), 조합식 재료: 용기사 `k_spear → k_axe`, 시간의 군주 `a_frost → a_wind`, 길들인 글리치 노말 6기 → 3기
- 적 체력 곡선 3단: 20~ ×1.15, 50~ ×1.06 (`B.hp.mult3 · from3`), 이반 체력 0.6 → 0.5, 카이 1.3 → 0.35
- 이자 패치 10% (최대 70), 단일 코어 ×1.35

봇 시뮬 (`--no-verify`, 성장 없음 30판): 균형 10% · 기사단 7% · 기계공방 10% · 마도회 13% · 이자 3% · 도박사 3% · 단일코어 0% · 소환만 0% (클리어율) → **여러 길에서 5% 이상**

성장을 든 봇 (클리어율, 30판 / 20판)

| 전략 | mid · 오염0 | late · 오염0 | max · 오염0 | mid · 오염3 | max · 오염10 (평균 웨이브) |
| --- | --- | --- | --- | --- | --- |
| 균형 | 93% | 90% | 90% | 35% | 0% (49.1) |
| 기사단 | 53% | 80% | 77% | 5% | 0% (44.9) |
| 기계공방 | 87% | 97% | 90% | 20% | 0% (45.7) |
| 마도회 | 73% | 83% | 93% | 15% | 0% (41.2) |
| 이자 | 33% | 57% | 77% | 5% | 0% (43.9) |
| 도박사 | 37% | 70% | 73% | 0% | 0% (47.5) |
| 단일코어 | 0% | 0% | 0% | 0% | 0% (36.1) |
| 소환만 | 7% | 7% | 17% | 0% | 0% (28.4) |

- mid = 유닛 Lv.2~3 · 연구 2 · 경제 유물 (몇 주 한 사람), max = 전부 Lv.10 · 연구 4 · 전설 유물
- 성장하면 오염 0 은 쉬워지고 → 오염 단계를 올리는 구조. 다 모아도 오염 10 은 봇 0% (사람의 끝 목표)
- 단일 코어는 성장해도 0% — 다음 밸런스에서 볼 것

### b2 (2026-10-13) — v0.3: 신화 3종 · 판매 · 프로토콜
바꾼 것: 신화 3종 추가 · 모든 유닛 판매(레전드부터 행운석) · 도박 E 5W / L 10W부터 · 적 체력 50~ ×1.07 · 시간술사 둔화 반경 2.6 → 1.6(35%) · 길들인 글리치 피해 40 → 110 · 단일 코어 개편 · 도박사 강화 · 오염 30단계

봇 시뮬 (`defense-sim.ts -n 40`, 결정론 확인, 성장 없음): 균형 18% · 기사단 10% · 기계공방 10% · 마도회 5% · 이자 0% · **이자째기 18%** · 도박사 3%(→ +3 행운석 뒤 3%, 평균 58웨이브) · 단일코어 3% · 소환만 0%
- 이자째기(`keep: 700`, 이자 상한 70 = 골드 700 이 필요 — 필드가 위험하면 씀)가 균형과 같은 18% → "끝까지 째는" 플레이가 이자 프로토콜의 정답. 그냥 쓰는 이자는 0%
- 단일 코어 · 도박사는 봇이 잘 못 씀 (단일 코어는 사람이 신화 한 종류를 정해 재료를 모아야 함, 봇은 처음 되는 조합식으로 정해 버림) — 실제 기록이 쌓이면 다시 볼 것
- 성장 봇: mid · 오염 3 = 0~30% (이자째기 30%), max · 오염 10 = 0~5% (평균 43~53웨이브), max · 오염 20 = 0% (23~39웨이브)

