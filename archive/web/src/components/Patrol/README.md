# PIXEL PATROL (픽셀 순찰대) — 넘겨받는 사람용 정리

**상태: 게임 목록에서 내림 (2026-10-18, v0.2.3 ALPHA).** 코드 · 에셋 · 서버는 그대로 남아 있고, `/games/patrol/` 주소로 직접 들어가면 지금도 돌아감.
메뉴 · 사이트맵 · 아카이브 · OG 미리보기 · 업적/일일 미션 목록에서만 뺐음.

뱀서라이크(서바이버 엔진) 위에 모바일 RPG식 성장(장비 뽑기 · 합성 · 강화 · 스테이지)을 얹은 게임. 내린 이유와 다음 방향은 맨 아래 「왜 내렸나」.

---

## 다시 열려면
1. `web/src/data/navMenu.ts` — `/games/patrol` 메뉴 칸 (이미지 `@/img/menu/patrol.jpg`, 아이콘 `px:patrol`, featured)
2. `web/src/app/sitemap.ts` — `{ path: "/games/patrol/", priority: 0.5, changeFrequency: "weekly" }`
3. `web/src/lib/og/shots.ts` — `SHOT_KEYS` 에 `"games/patrol"` (그림 `web/assets/og/shots/games__patrol.jpg` 는 남아 있음)
4. `web/src/lib/points.ts` — `// a("patrol" …` · `// r("patrol" …` · `// dm("patrol" …` 주석 풀기 (업적 · 반복 업적 · 일일 미션)
5. (선택) `web/src/data/archive.ts` 에 소개 글
6. 재화 설계를 바꿀 거면 먼저 어드민 → 랭킹 탭 → 「픽셀 순찰대 데이터 초기화」 (확인 문구 `순찰대 초기화`)

## 파일
| 곳 | 내용 |
|---|---|
| `web/src/app/games/patrol/` | 페이지 · 레이아웃 |
| `web/src/components/Patrol/` | `PatrolApp.tsx` (처음 · 로비 · 결과 화면, 대원 고르기), `Gear.tsx` 장비, `Boxes.tsx` 장비/무기 상자, `Weapons.tsx` 무기 덱, `Shop.tsx` GP 상점, `StarTrack.tsx` 별 보상, `PatchNotes.tsx`, `ui.tsx` |
| `web/src/lib/patrol/` | 브라우저 · 서버 공용 (`@/` import 금지). `chapters.ts` 챕터 6 × 스테이지 5 · 판 종류 · 난이도 RAMP · 추천 전투력 · 대원 해금, `economy.ts` 보상 · 상자 확률 · 순찰(방치) · 별 보상 · 기록 확인(plausible), `gear.ts` 장비, `weapons.ts` 무기 덱 · 별 · 무기 상자, `shop.ts` GP 상점 |
| `web/src/realtime/patrol.ts` | 서버 RPC 호출 · 프로필 타입 |
| `web/src/lib/survivor/` · `web/src/components/Survivor/` | **판 엔진은 서바이버와 공용** (`sim.ts` 결정적 60 TPS · `data.ts` 몹/무기/기믹 · `Game.tsx` 화면 · `render.ts` · `art.ts` · `audio.ts`). 순찰대 전용 분기는 `r.ch` (챕터가 있으면 순찰대 판) |
| `web/src/data/gameGuides.tsx` | `PATROL_GUIDE` (게임 안 도움말) |
| `server/src/games/patrol.ts` | RPC (`patrol.profile/start/finish/...`), DB `patrol_profile` · `patrol_runs` · `patrol_rank`, 회원 `users.stats.patrol`. `server/src/server.ts` 에서 `registerPatrol` 로 계속 켜져 있음 |
| `server/src/achievements.ts` | `game === "patrol"` 업적 숫자 계산 (목록만 주석 처리) |
| `server/src/http/admin.ts` · `web/src/components/Admin/PatrolReset.tsx` | 데이터 초기화 |
| `server/scripts/patrol-sim.ts` | 봇 시뮬: `npx tsx scripts/patrol-sim.ts <판 수> <스테이지 번호> <start\|mid\|strong\|"atk,hp">` · 환경변수 `HERO` · `DECK` · `WSTAR` · `WD=1`(무기별 피해) |

## 에셋
- `web/public/patrol/` — `hero/` 대원 시트 (반디 · 설희, 파이트 시트 형식 webp+json), `cutin/` 필살기 컷인, `fx/` 빛 · 타격 그림, `gear/` 장비 아이콘, `ui/` 상자, `title.webp`
- `web/public/survivor/` (서바이버와 같이 씀) — `mob/` 몹 · 보스 2칸 스트립, `deco/` 소품, `stage/` 로비 배너, `icon/` 무기 · 능력치 아이콘, `sfx/` 효과음 (ElevenLabs), `bgm/pt_*.mp3` 순찰대 곡 (사용자 제공), `ground_dock.png` · `ground_isle.png`
- 그림은 ChatGPT 이미지 (초록 배경 #00FF00 → 키잉). 대원 시트는 「Create Character Lineup」 대화에 이어서 뽑음. 반디 · 설희 · 루비 · 볼트 라인업 디자인이 있음 (루비 · 볼트는 아직 게임에 없음)

## 들어 있는 것 (v0.2.3)
- 구역 2개 · 챕터 6 · 스테이지 30 (X-1 기본 · X-2 기믹 두 배 · X-3 특수 목표 · X-4 포위 · X-5 챕터 보스). 기믹: 가로등 · 분수 · 자정의 종 · 밀물 · 안개 · 등대 빛
- 대원: 반디 (랜턴 빛살 · 필살기 등대), 설희 (서리 세검 · 필살기 눈보라, 6-5 클리어로 합류 — 서버 저장 없이 bestSt ≥ 30, 고른 대원은 localStorage `ptp-hero`)
- 판 밖: 장비 6칸 · 5등급 (상자 · 합성 · 강화), 무기 덱 6칸 · 새 무기 4종 · 무기 별 ★1~5 · 진화, 무기 상자, GP 상점 (꾸러미), 별 보상 ★5~90, 순찰(방치 보상), 랭킹
- 판 2분 뒤 「보스로 ▶」(B) 건너뛰기 — 건너뛴 시간은 `finish.skip` 으로 보내 시간 보상 · 기록 확인에서 뺌

## 왜 내렸나 (사용자 피드백 · 진단)
- "재미를 못 찾겠다 · 전반적으로 루즈 · 초반이 너무 쉬움." 그나마 재밌던 건 **보물 도깨비 쫓기**와 **진화**
- 5분 보스 판에서 모든 게 풀각성됨: 경험치 곡선이 서바이버(8~10분 판) 기준이라 순찰대 짧은 판에선 Lv35+ (봇 5분 Lv 35~38) → 고를 게 없어짐
- 판 밖 시스템(재화 4종 · 뽑기 · 상점)이 판 안 재미보다 먼저 커짐. 코인이 남아돎 (강화 병목이 설계도라서)
- 결정됐던 방향 (손대기 전에 내림): BM(장비 뽑기 · 무기 상자 · GP 꾸러미) 걷어내고 **뱀서식 영구 강화 + 업적 해금**으로, 판 안은 **쫓는 목표(도깨비류)를 판의 중심으로 · 진화를 드물고 크게**
- 시험해 보다 커밋 안 한 것: 경험치 Lv15 이후 가파르게 (`needXp` × (1 + (lv−15)×0.12~0.2)) · 순찰대 무기/능력치 칸 5칸 · 모든 판에 도깨비 2~3번 (잡으면 큰 상자) · 1~2장 난이도 올림. 봇으로는 5분 Lv 35 → 30, 1-1 시작 장비 여전히 100%

## 설계 문서 (claude.ai 프로젝트 「포트폴리오」)
`2026-10-18-patrol-roadmap.md` · `2026-10-18-patrol-weapon-deck-shop.md` · `2026-10-18-patrol-zone2-harbor-design.md` · `2026-10-17-patrol-ch1-3-design.md` · `2026-10-18-patrol-handover.md`
