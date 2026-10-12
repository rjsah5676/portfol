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
| `web/src/lib/defense/bot.ts` | 밸런스용 봇 전략 (`BOTS`) |
| `web/src/lib/defense/rng.ts` | 시드 난수 (mulberry32) |
| `web/src/lib/defense/assets.ts` | **그림 · 소리 연결표** (유닛 41 · 적 8 · 보스 6 · 효과음 23 · 배경음 5) — 에셋 바꾸면 여기 |
| `web/src/components/Defense/DefenseApp.tsx` | 메뉴 · 솔로 시작 · 멀티 로비/방 · 랭킹 목록 |
| `web/src/components/Defense/GameView.tsx` | 게임 화면 (위 바 · 필드 · 아래 정보 · 오른쪽 패널 · 창들 · 결과) |
| `web/src/components/Defense/controller.ts` | 화면 쪽 진행: 솔로(즉시 실행 + 기록) / 멀티(서버 턴 받아 락스텝) |
| `web/src/components/Defense/render.ts` | 캔버스 필드 그리기 — **2.5D** (돌길 + 높은 블록 · 발 위치 순서로 겹침) · 등급 오라/외곽선/보석 · 효과 |
| `web/src/components/Defense/audio.ts` | 소리: 효과음(Web Audio, 종류별 간격 제한) · 배경음(웨이브/보스에 맞춰 바뀜) · 음량 저장 |
| `web/src/components/Defense/Stage.tsx` | 1024×576 무대 · 화면 맞춤 · 폰 가로 전용 · 전체화면 |
| `web/src/components/Defense/Codex.tsx` · `ui.tsx` | 도감 · 공용 도트 UI (버튼 · 창 · 세력 문장 · 도트 아이콘 · 막대 · 소리 설정) |
| `web/src/realtime/defense.ts` | 서버 통신 (rpc · 구독) |
| `web/src/app/games/defense/` | 페이지 (GameHeader + 랭킹) · layout(메타, noindex) |
| `web/src/css/defense.css` | **도트 UI 규칙** (`px-btn` · `px-box` · `px-inset` · `px-win` · `px-bar`) · 커서 · 글꼴 · 키프레임 |
| `web/public/defense/` | `units/` · `enemies/` · `bosses/` 그림(webp) · `sfx/` · `bgm/` (mp3) · `fonts/` 갈무리(OFL) · `ui/` 커서 |
| `web/scripts/defense-art/` | 그림 시트 자르기 (`slice.py` 칸 나누기 · `cc.py` 겹친 줄은 덩어리 기준) |
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

**에셋 입히기** — `assets.ts` 의 `UNIT_ART / ENEMY_ART / BOSS_ART / FIELD_ART / SFX / BGM` 에 한 줄씩. 파일은 `web/public/defense/…`. 규격 · 만든 방법은 `ASSETS.md`.
연결표에 없는 것은 자동으로 자리표시 그림(세력별 도트 인형)이라 일부만 넣어도 됨. 그림이 보는 방향이 왼쪽이면 `face: -1`.

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

- **새로고침 · 탭 닫음 뒤 돌아가기**: 메뉴 · 로비에 "진행 중인 멀티 판으로 돌아가기" (`defense.mine` → `defense.join` 이 자리를 그대로 돌려줌). 판 중 연결이 끊기면 `gone` 시각만 적어 두고, 다른 사람이 다 끝났는데 60초(`GONE_MS`) 안에 안 돌아오면 순위를 냄 (그 보드는 명령 없이 끝까지 돈 결과)
- **어긋남 감시**: 각자 `HASH_TICKS`(150 tick = 5초)마다 `hashGame` 을 `defense.hash` 로 보냄 → 같은 tick 값이 다르면 서버 로그 `[defense] 멀티 어긋남 …` + 방에 `desync` → 화면 오른쪽 위 "동기화 어긋남 N" (관리자 방 목록에도 `desync` 횟수). 따라잡는 중엔 안 보냄

**"남 돕기" 넣는 법 (다음 단계)**: 명령에 다른 보드를 가리키는 종류를 추가(예: `{ t: "gift", to, c }`) → `isCmd` · `apply` 에서 `g.boards[to]` 를 바꾸면 끝.
같은 기록 · 같은 시뮬이라 서버 · 동기화 구조는 그대로. 웨이브는 보드마다 따로 흐르므로, 협동 모드를 만들 땐 웨이브 시계를 `Game` 으로 올리는 것도 고려.

### 화면
- 무대 1024×576 고정 배치를 화면에 맞춰 통째로 확대/축소 (PC = 폰). 폰은 가로 전용 (ANIME POKER 와 같은 방식)
- 필드는 캔버스, 나머지 UI 는 DOM. HUD 는 100ms 마다 다시 그림
- 조작: 칸 누르기 = 정보, 끌기 = 자리 바꾸기(같은 유닛이면 모음). 단축키 Q 소환 · W 합성 · E 판매 · 1 2 3 강화 · 4 확률 · R 조합식 · Space 일시정지 · F 배속 · Esc
- **도트 화면 규칙** (AI 웹사이트 느낌 안 나게): 둥근 모서리 · 흐림 · 부드러운 그라데이션 금지 → `px-*` 클래스 (2px 계단 테두리 · 아래 턱 · 누르면 내려감). 움직임은 `steps()`. 글꼴 갈무리. 이모지 대신 `ui.tsx` 의 `Icon`(8×8 도트) · `FactionIcon`(세력 문장)
- **세력 구분**: 블록 윗면 색 · 버튼 색 · 문장(기사단 방패 / 기계공방 톱니 / 마도회 별) · 칩. **등급 구분**: 블록 테두리 · 그림 외곽선(레어부터) · 발밑 오라(레어 링 → 레전드 빛 기둥 · 반짝이 → 신화 깜빡임) · 칸 왼쪽 위 보석 글자(N R E L M H)
- **마우스**: 도트 커서(`public/defense/ui/cursor*.png`, 손 · 집기 — 원본은 2배 그림, `*-1x.png` 는 반으로 줄인 것. css 에서 `image-set` 으로 보통 화면 1x · 레티나 2x), 버튼은 올리면 1칸 떠오르고 테두리가 밝아짐 + 작은 소리, 메뉴 버튼은 ▶ 표시
- **소리**: 첫 누르기에서 잠금 풀림(Stage). 효과음 종류별 최소 간격 · 동시 14개 제한(배속에서도 안 시끄럽게). 메뉴 · 로비 = `menu`, 1~29웨이브 `wave-early`, 30~ `wave-late`, 보스 `boss`, 60 카이 `boss-final`, 끝나면 배경음을 줄이고 `clear`/`gameover`. 음량은 스피커 버튼(이 기기에 저장)

## 7. 알파 상태 · 다음 할 일

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
