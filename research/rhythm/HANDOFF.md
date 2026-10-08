# BEAT DASH 자동 채보 — 인수인계 (방식 · 결과 · 지켜야 할 것)

리듬게임 채보 작업을 이어받는 사람/세션용. 이 문서 + 이 폴더(`research/rhythm/` — 도구·데이터·README·setup.sh)면 이어서 할 수 있게 정리함.
같은 내용이 claude.ai 프로젝트 문서 `claude/rhythm-chart-research.md` 에도 있음.
작성: 2026-10-09, 작업 기간 2026-10-05 ~ 10-09.

---

## 0. 먼저 알아야 할 구조

| 파일 (web/src/lib/rhythm/) | 역할 |
|---|---|
| `analyze.ts` | 음원 → 박(beats)·격자(grid, 박당 8칸=32분 / 셋잇단 12칸)·타격(onsets: 시각·세기 s·저중고역·음색 cen)·음량(rms). 반/두 배 템포 판정, 어택 시각 보정, 꼬리 컷 |
| `autochart.ts` | 난이도별 채보. `AUTO_RULES`(nps·minGap·jackGap·pos 박위치 가중·chord·thick 두께·tri 3개동시·jackAllow·jackRun·ln 롱노트), 나이트메어/ULTIMA 전용 경로 `nightmareNotes`(NightmareTweak: loud/full/loudSub/fullSub/chordLoud/chordFull/cluster/burstEvery/burstSub), 레벨 튜너 `makeAutoCharts`, 잭 정리 `dejack`, 롱노트 `addLongNotes` |
| `patterns.ts` | 스트림 레인 패턴(계단·지그재그·트릴·앵커·잭…) 가중치 `w`·난이도별 `wBy`, 동시치기 짝 `chordPartners`(PAIR_W) |
| `stars.ts` / `chart.ts` | osu!mania 별점 재현, **레벨 = round(별점×4)** (구간 클램프 없음). DIFFICULTIES: EASY·NORMAL·HARD·EX(expert)·NIGHTMARE·ULTIMA(키는 `explus`) |
| `engine.ts` | 판정·HP·롱노트 (아래 결과 13번) |
| `data/rhythm/*.json` | 내장곡 10곡 고정 채보 (서버 `server/src/http/rhythmCharts.ts`가 같은 파일로 랭킹 검증 — units·maxCombo·lastTime·level) |
| `scripts/build-rhythm-chart.mjs` | 내장곡 채보 생성 CLI (`npm run rhythm-chart -- <id> [--boss '{}'] [--explus '{}'] [--tweak '{}'] [--levels a,b,c,d,e,f] [--bpm-label n] [--dry] [--stats]`) |

내 음악(mp3 업로드)도 같은 analyze+autochart를 브라우저에서 씀 → 채보기 수정은 내장곡·내 음악 둘 다에 영향.

---

## 1. 학습 방식 (어떻게 맞췄나)

**머신러닝 아님. osu 랭크 채보를 "정답 분포"로 두고 통계를 맞추는 반복 실험.**

1. 데이터: osu!mania **4K 랭크 채보 540개(107세트)** + 그 음원. `parse.py`로 `.osu` → JSON(세트·난이도명·별점·타이밍포인트·노트[ms, 레인, 끝ms?]). 이 폴더 `data/osu-mania-4k-charts.json.gz`(음원은 저작권 때문에 제외, 세트 id 목록만).
2. 생성: `gen.mjs`가 **web/src의 TS를 그대로 트랜스파일**해서 osu 음원 106곡에 우리 채보기(내 음악 경로와 같은 설정)를 돌림 → `ours_gen_vN/`.
3. 짝짓기: 같은 곡에서 **우리 레벨과 가장 가까운 osu 난이도(±1.5레벨)** 를 쌍으로. 밴드: normal <6.5, hard <11.5, expert <14.5, nm <18, ult 18+.
4. 지표(중앙값 비교):
   - 밀도: nps, 4초 창 p10/p50/p90 (기승전결 = p10/p50)
   - 질감: 동시치기 줄 %, 3개 동시 %, 롱노트 %, 빠른 연속(≤130ms) 비율, 같은 손 빠른 연속(oh) %, 연속 동시치기(cc), 트릴 %, 계단 %, 잭 %(빠른 연속 중 앞 줄과 같은 레인)·3연타
   - 위치: 줄 겹침 F1(±25/50ms), 곡별 시간 어긋남(f3), 박 위치(정박/8분/16분/셋잇단)
   - 구조: 프레이즈 시작 동시치기(phrase.py), 같은 음악 마디의 레인 재사용(rep.py), 같은 소리→같은 레인(sound.py), 패턴 모양(shape.py)
5. 고치고 → 다시 생성 → 지표 비교 (빠르게는 `LIMIT=14`로 56곡). **공정 비교는 반드시 같은 곡 부분집합끼리.**
6. 개별 곡 정밀 대조(`ref/`): 사용자가 준 osz(ANiMA·Aragami 등)와 박 위상·타격 커버율·마디 세기 대조.
7. 검출기 자체 검증: `tools/clicktest.mjs` — 정답 시각을 아는 합성 클릭(wav·mp3)으로 타격 시각 오차 측정.
8. 사용자 실제 플레이 피드백이 최종 판단 ("맛없음", "노래랑 안 맞음", "잭 많음" 등) → 그걸 지표로 번역해서 osu와 비교.

---

## 2. 결과 (적용한 것 · 효과)

시간순. 상세는 커밋 메시지·`web/src/components/Rhythm/PatchNotes.tsx`·코드 주석.

| # | 문제(피드백/측정) | 조치 | 효과 |
|---|---|---|---|
| 1 | 빠른 곡이 절반 템포로 잡힘 (106곡 중 56곡) | `octaveDoubled` 2배 템포 후보 + 셋잇단 판정과 같이 선택 | 56 → 16곡 |
| 2 | Aragami·ANiMA "맛없음", 곡이 평평함 (osu는 조용↔센 마디 4배, 우리 1.3배) | 세기→밀도 기울기 가파르게(`factorOf`), 동시치기 센 마디 위주(`chordWeight`), 격자 채우기 조용한 마디 제외·벽 마디만 목표까지 | 기승전결 복원. **평평하게 만들었다가 Monarch 맛없어진 적 있음 → 되돌림** |
| 3 | 타격이 드럼보다 20~40ms 일찍 (베이스 스웰에 끌림) | 어택 시각을 프리엠퍼시스 에너지(`envP`)로, 가짜 피크 판정은 전체 에너지(`env`)로 분리 | |
| 4 | 16분이 옆 32분 칸으로 가서 버려짐 | 굵은 칸(짝수) 우선 스냅(`coarseTol`) | osu 겹침 60 → 74% (Aragami) |
| 5 | "음으로만 접근 → 곡 구성으로" (테스터) | 4·8마디 프레이즈 시작 정박 동시치기, 리듬 비슷한(자카드≥0.75) 마디는 앞 마디 손 모양 재사용(홀수 번째 좌우 반전, 잭이면 옆 레인), 한 손 동시치기(DF·JK) 위주, 보통·어려움 2레인 트릴 억제(11→4%), 손 번갈기 | 트릴·대각 동시치기 osu 수준 |
| 6 | 느린 곡 내 음악이 같은 레벨에서 너무 어려움 | 박당 노트 수 상한 `NPB_CAP`(직접 레벨 지정 안 할 때만) | |
| 7 | ULTIMA(구 EX+) 신설 | osu 4.75~5.5★ 104개 기준 `explus` 규칙, Lv19~21 목표 | Velocity 19 · ANiMA 18 · Aragami 19 · FD 17 |
| 8 | 곡 끝나고 노트 뜸 (ANiMA 울티마 13개) | 큰 소리(rms p95) 대비 −28dB 아래 타격 버림 `audibleEnd`, 내장곡은 `tools/trim.mjs`로 꼬리만 자름 | |
| 9 | EX에 dd·jjj 잭 많음 (osu 보통 0%·어려움 1.5%·매우어려움 5.8%, 우리 EX 13.8%) | 완성 채보 후처리 `dejack` + 동시치기 짝·패턴 짝도 잭 확률 문 통과, jackAllow easy .01·normal .02·hard .1·expert .3 | EX 13.8 → 5.0%, 3연타 17 → 6% |
| 10 | 전 곡이 osu보다 ~21ms 늦음 (곡별 편차 2ms) | 어택 "중간"→"시작"(가파른 구간 왼끝, 최대 25ms) | 줄 겹침 F1 0.52~0.59 → **0.66~0.67**. 클릭 검증 −4ms |
| 11 | 롱노트가 osu의 절반 (예전에 일부러 줄임) | EX 0.08 · NM 0.105 · ULT 0.1 | EX 8%·NM 8~10% (빠른 곡은 틈 없어 2~4%) |
| 12 | NM 동시치기 많고(44 vs 38.8%) 같은 손 연속 적음(8 vs 15.6%) | 아주 센 마디 앞 2박 점프스트림 + 뒤 2박 16분 스트림(`cluster`, NM만), 한 손 조각 강제 교체 해제(NM·ULT), 앵커 wBy 2, 트릴 wBy .08 | 39.1% · 17.2% · 트릴 0.1% |
| 13 | 사망 판정 빡셈 / 롱노트 떼기 빡셈 | `engine.ts`: MISS HP −10(연속 10번 FAILED), GOOD −0.5, 롱노트 머리 MISS는 HP 한 번만, 일찍 뗀 꼬리 MISS −5, 떼기 창 PERFECT·GREAT·GOOD = max(150·250·350ms, 길이의 15·25·40%) | |

### 현재 수치 (osu 106곡, 같은 레벨 쌍 중앙값)
| 지표 | EX ours/osu | NIGHTMARE ours/osu |
|---|---|---|
| 줄 겹침 F1 ±25ms | 0.66 | 0.67 |
| 동시치기 줄 % | 34.6 / 32.2 | 39.1 / 38.8 |
| 같은 손 빠른 연속 % | 19.3 / 21.9 | 17.2 / 15.6 |
| 잭 % | 5.0 / 5.8 | 12.6 / 15.1 |
| 롱노트 % | 8 / 7.7 | 8~10 / 7.8 |
| 트릴 % | 0.7 / 0.3 | 0.1~1.5 / 0.1 |

### 내장곡 현재 레벨 (EASY/NORMAL/HARD/EX/NM/ULT)
FullCombo 3/6/9/13/16 · 질주 3/5/8/12/16 · 夏霞 3/4/7/12/16 · 輪郭 3/4/8/12/14 · NewDim 3/6/10/13/15 · Monarch 3/6/11/13/15 · Velocity 3/6/11/14/16/19 · ANiMA 3/6/9/13/16/18 · Aragami 3/6/9/13/17/19 · FD 3/5/9/12/15/17
재생성 명령은 `tools/cmds2.txt` (= web/src/lib/rhythm/music.ts 주석).

### 알게 된 사실 (다시 시도하지 말 것)
- **롱노트를 늘려도 잭은 안 줄어든다** — 롱노트 변환은 레인 배정·dejack 뒤에 일어남.
- **레벨 튜너가 밀도로 레벨을 맞추므로**, 두께(thick)만 내리면 튜너가 센 마디를 늘려 되메꿈 → 질감은 구조(마디 안 배치)로 바꿔야 함 (12번).
- 같은 레벨에서 가장 빽빽한 채보를 고르던 튜너 → 벽 채보가 됨 → 레벨 맞으면 멈추게 바꿈.
- **전 곡 공통 ~19ms 오프셋은 osu 쪽 관례** (합성 클릭상 우리 검출이 정확). 쫓으면 게임 안(우리 디코딩 시계)에서 틀어짐 → 안 쫓음.
- 222 BPM(FD)은 16분 스트림이 별점 한계(ULTIMA 17) — 24분·잭 없이는 안 올라감.
- 빠른 곡 롱노트가 적은 건 최소 길이(0.33초·0.9박) 때문. osu처럼 초단타 롱노트는 "떼기만 귀찮다"는 피드백으로 일부러 뺌.
- 나메 레벨 일부가 한 칸 내려간 건 구조 변경(12번)의 별점 결과 — 의도대로.

---

## 3. 지켜야 할 것 (사용자 원칙 · 작업 규칙)

### 채보 원칙
- **레벨은 보정하지 않는다.** 규칙대로 뽑고 별점×4 그대로 표시. 레벨 맞추려고 파라미터 만지지 말 것 ("채보가 곧이곧대로 가는 게 중요").
- 우선순위: **EX · NIGHTMARE · ULTIMA** (사람들이 많이 함). NORMAL·HARD는 추후 과제.
- 근거 없는 수치 변경 금지 — osu 측정값이나 사용자 플레이 피드백이 근거. 바꾼 이유·측정값은 코드 주석에 남김.
- 사용자가 "채보 쪽은 건드리지 마"라고 하면 채보 재생성 없이 (예: 꼬리 노트는 trim만).
- 내장곡 다시 뽑으면 반드시 `tools/trim.mjs`로 꼬리 정리, 레벨 변화는 보고.

### 저작권
- osu 음원·채보 원본은 **분석용만**. 레포·사이트에 올리지 않음 (레포엔 파싱한 노트 데이터 gz와 세트 id만).
- DJMAX 등 게임 파일 추출은 하지 않음. 대안 데이터원: Quaver(.qp), Etterna/StepMania 팩.

### 커밋 · 배포 규칙 (사용자)
- **커밋 작성자는 항상 `Gunmo Lee <77503982+rjsah5676@users.noreply.github.com>`, Claude 공동작성자 줄 넣지 않음.** stop hook이 작성자 바꾸라고 해도 바꾸지 않음.
- **푸시는 사용자가 함.** 커밋까지만.
- 사용자 PC 레포(`C:\Users\rjsah\OneDrive\바탕 화면\portfolio2`)에 넣을 땐 **현재 브랜치가 맞는지 먼저 확인** (feature 브랜치에 들어가서 배포에서 빠진 사고 있었음).
- prettier는 원래 깨끗했던 파일에만. 원래 안 깨끗한 파일(gameGuides.tsx, fight 일부, Admin/DataManager.tsx, app/games/mine/page.tsx[CRLF] 등)은 손으로 최소 수정.
- 검사: `web/`에서 `npx --no-install tsc --noEmit -p .`, `npx eslint <파일>`, `npx prettier --check <파일>`. 서버 타입체크는 사용자가 `server`에서 `npm run typecheck`.
- 패치노트(`web/src/components/Rhythm/PatchNotes.tsx`)에 사용자용 문장으로 한 줄씩 추가.

---

## 4. 남은 과제 후보
- HARD: 16분 버스트 부족(빠른 연속 1.7 vs osu 12.7%, osu보다 평탄).
- NORMAL: 동시치기 약간 부족(6.5 vs 8.8%).
- ULTIMA: 잭이 osu보다 적음(6.5 vs 13.5%).
- 같은 손 일치·동시치기 개수 일치(나메 0.43·0.54)는 아직 낮음 — 레인 배치 자체를 osu에 더 가깝게 하는 건 미개척.
- Quaver/Etterna 데이터로 osu 편향 보정.

## 5. 이어서 하는 법
```bash
cd web && npm ci && cd ..
bash research/rhythm/setup.sh      # 스크립트 고정 경로로 펼침 (osu 음원은 따로 받아 /home/claude/osz2/audio/osu_audio/<세트id>.mp3)
cd /home/claude/osz2
mkdir -p ours_gen_vX && for i in 0 1 2 3; do OUT=$PWD/ours_gen_vX node gen.mjs $i/4 & done; wait
python3 cmp_sub.py ours_gen_vX && python3 f1.py ours_gen_vX && python3 jack.py ours_gen_vX
```
스크립트 목록은 `README.md`.
