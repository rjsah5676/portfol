# 리듬게임(BEAT DASH) 자동 채보 연구 도구

자동 채보기(`web/src/lib/rhythm/` — analyze·autochart·patterns·stars)를 **osu!mania 4K 랭크 채보와 같은 곡·같은 레벨로 대조**해서 숫자를 맞춰 온 도구 모음.
채보기 코드 안 주석의 측정값(잭 비율, 롱노트 비율, 동시치기 두께, 어택 보정 등)이 전부 이 도구로 잰 것.
**먼저 `HANDOFF.md`(인수인계: 방식·결과·지켜야 할 것)를 읽을 것.** 같은 내용이 claude.ai 프로젝트 문서 `claude/rhythm-chart-research.md` 에도 있음.

## 펼치기

```bash
cd web && npm ci && cd ..
bash research/rhythm/setup.sh        # 스크립트가 쓰는 고정 경로로 복사
```

스크립트 안 경로가 `/home/claude/p2`, `/home/claude/osz2`, `/home/claude/ref`, `/tmp/claude-0/s` 로 고정돼 있어서 setup.sh 가 그 자리에 펼친다.

**osu 음원은 레포에 없음**(저작권 — 분석용으로만 쓰고 배포 금지). `data/osu-beatmapset-ids.txt` 의 107개 세트를 osu에서 받아
`/home/claude/osz2/audio/osu_audio/<세트id>.mp3` 로 두면 생성기 대조가 돌아감. 채보 데이터(`charts_new.json`)는 음원 없이도 쓸 수 있음.

## 데이터

| 파일 | 내용 |
|---|---|
| `data/osu-mania-4k-charts.json.gz` | osu!mania 4K 랭크 채보 540개 파싱 결과 (set, ver, stars, tps=[시작ms, 박ms, 박자], notes=[ms, 레인, 끝ms?]) |
| `data/quaver-4k-charts.json.gz` | Quaver 4K 랭크 채보 397개(맵셋 49개, osu와 겹친 곡 빼고) — 같은 형식, stars는 우리 별점 계산기 값 (음원 없음, 맵셋 id는 `data/quaver-mapset-ids.txt`) |
| `data/osu-beatmapset-ids.txt` | 위 채보들의 세트 id (음원 다시 받을 때) |

## 자주 쓰는 흐름

```bash
cd /home/claude/osz2
# 1) 지금 채보기로 osu 106곡 전부 생성 (4분할 병렬, 곡당 5~10초)
mkdir -p ours_gen_vX && for i in 0 1 2 3; do OUT=$PWD/ours_gen_vX node gen.mjs $i/4 & done; wait
#    (LIMIT=14 를 앞에 붙이면 곡을 줄여 빠르게)
# 2) 별점 계산(_stars.json) + 같은 레벨 osu 채보와 지표 비교
python3 cmp_sub.py ours_gen_vX       # nps·p10/p90·동시치기·3개동시·잭·롱노트·빠른연속·한손·연속동시치기
python3 f1.py ours_gen_vX            # 같은 순간을 치는 줄 F1(±25ms), 동시치기 개수 일치, 손 일치
python3 f3.py ours_gen_vX            # 곡별 시간 어긋남(osu−ours) 중앙값·흔들림
python3 jack.py ours_gen_vX          # 잭(같은 레인 빠른 연타) 비율·3연타
```

| 스크립트 | 무엇을 재나 |
|---|---|
| `osu/parse.py` | .osu 원본 → charts_new.json (raw/ 아래 압축 푼 osz 필요) |
| `osu/st.py` | 채보 하나의 특징량 함수 `feat()` (다른 스크립트가 import) |
| `osu/gen.mjs` | 우리 채보기를 osu 음원에 돌려 JSON 저장 (web/src 를 그대로 트랜스파일해서 씀) |
| `osu/cmp_sub.py` `cmp2.py` | 같은 레벨 쌍 지표 비교 |
| `osu/f1.py` `f2.py` `f3.py` | 줄 겹침 F1, ±50ms·선택 상한, 상수 오프셋 |
| `osu/jack.py` `shape.py` `phrase.py` `rep.py` `sound.py` | 잭 / 패턴 모양 / 프레이즈 시작 동시치기 / 같은 음악 마디 반복 / 같은 소리-같은 레인 |
| `osu/octave.py` `tempo_eval.py` | 반·두 배 템포 오검출 |
| `ref/*` | 곡 하나(ANiMA·Aragami 등)를 osu 채보와 정밀 대조 (박 위상, 타격 커버율, 마디 세기) |
| `tools/regen.sh` + `cmds2.txt` | 내장곡 10곡 재생성 (`bash /tmp/claude-0/s/regen.sh <출력폴더>` — 끝나면 원본 data/rhythm 은 되돌려 둠) |
| `tools/trim.mjs` | 곡 끝 페이드아웃 꼬리 노트만 잘라냄 (`node trim.mjs <곡id...> --write`, web/ 에서) |
| `tools/clicktest.mjs` | 정답 시각을 아는 합성 클릭으로 타격 검출 오차 확인 |
| `tools/stars.ts` | 생성 채보 별점 일괄 계산 (cmp_sub.py 가 tsx 로 부름) |

## 마지막 측정 (2026-10-08, osu 106곡 × 같은 레벨 쌍)

| 지표 (중앙값) | EX ours / osu | NIGHTMARE ours / osu |
|---|---|---|
| 같은 순간 치는 줄 F1 ±25ms | 0.66 | 0.67 |
| 줄 중 동시치기 % | 34.6 / 32.2 | 39.1 / 38.8 |
| 같은 손 빠른 연속 % | 19.3 / 21.9 | 17.2 / 15.6 |
| 잭(빠른 연속 중 같은 레인) % | 5.0 / 5.8 | 12.6 / 15.1 |
| 롱노트 % | 8 / 7.7 | 8~10 / 7.8 (빠른 곡은 2~4) |
| 두 레인 트릴 % | 0.7 / 0.3 | 1.5 / 0.1 |

## 2026-10-15 Quaver 비교 도구 (tools/)
- `cache.mjs` — osu 음원 106곡 + 내장곡 14곡 분석 결과를 v8 직렬화로 캐시 (분석은 한 번만, 채보기만 반복 실행)
- `run.mjs OUT shard/n` — 캐시로 현재 src 채보기를 돌려 채보 JSON (내장곡은 music.ts 주석 명령과 같은 설정, `lib.mjs`의 BUILTIN)
- `eval.py OUT` — (난이도 밴드 × 빠르기 160 BPM 기준)별 중앙값을 osu·Quaver와 비교, 둘 다의 범위 밖이면 `*` + 벗어난 정도 점수
- 경로는 작업 때 쓴 /tmp/claude-0/qvs, /home/claude/osz2 기준 — 옮기면 맨 위 경로만 바꾸면 됨
