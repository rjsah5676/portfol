# 격투게임 그림 만들기 (AI 이미지 → 게임)

엔진(판정·롤백·발판·AI)은 그대로 두고, 그림만 AI 이미지로 뽑아서 넣는다.
지금 들어간 것: 캐릭터 카이·이그나·소영·릴리·제나 (캐릭터별 시트 → `scripts/import-fight-atlas.py`, 칸 좌표는 `scripts/fight-sprites.json`), 맵 운해 학당·노을 옥상 (`public/fight/bg/temple.webp`, `rooftop.webp`).

### 지금 쓰는 방법 (아틀라스)

1. 시트 배경이 체크무늬로 '그려진' 그림이면 먼저 `python3 scripts/dechecker.py 원본.png 원본-a.png` 로 진짜 투명하게.
2. `scripts/fight-sprites.json` 에 캐릭터마다 `sheet`, `body`(몸 키 px), 동작별 `f`(칸 [x0,y0,x1,y1] 목록)·`fps`·`loop`.
   동작 이름: idle walk jump dash L1~L4 H1 H2 J K S X hit block down win (+ glide, pillar). 탄 그림은 `fx`.
   선택 화면 전신·얼굴은 `_art`.
3. `python3 scripts/import-fight-atlas.py <원본 폴더> [id ...]` → `public/fight/<id>.webp/json`, `fx/`, `art/`.
   칸에 걸쳐 잘린 이펙트는 덩어리 단위로 살려 주고, 발 기준점은 몸(가장 큰 덩어리) 맨 아래로 자동.

아래는 예전 격자 시트 방식 (여전히 읽힘).
그림 속 발판 좌표는 `src/lib/fight/maps.ts` 에 직접 맞춰 적음.

## 캐릭터 시트

### 규칙 (이걸 지켜야 자동으로 잘림)
- 단색 배경 한 가지 색 (그라데이션·격자·글자 없음)
- 모든 프레임 **오른쪽을 봄**
- **딱 12줄**, 한 줄 = 동작 하나, 왼쪽→오른쪽 순서
- 프레임끼리, 줄끼리 서로 안 닿게 (이펙트도 다음 줄에 안 닿게)
- 캐릭터 크기 모든 프레임 같게 (키 100~150px 정도면 충분)
- 워터마크(별)는 오른쪽 아래 — 캐릭터랑 안 겹치면 자동으로 지움 (`--wm`)

| 줄 | 동작 | 프레임 |
|---|---|---|
| 1 | 서 있기 (숨쉬기) | 4~6 |
| 2 | 걷기 | 6~8 |
| 3 | 점프 (웅크림·상승·꼭대기·낙하) | 4 |
| 4 | 약공격 (주먹/짧은 베기) | 4~5 |
| 5 | 강공격 (무기 크게 휘두르기) | 5~6 |
| 6 | 공중 공격 | 2~3 |
| 7 | 필살기 — 능력 탄 쏘는 동작 (탄은 손앞에 작게) | 5 |
| 8 | 초필살기 (큰 이펙트) | 6~8 |
| 9 | 맞음 | 3 |
| 10 | 가드 | 1 |
| 11 | 다운 (쓰러져서 바닥에 누움) | 4~6 |
| 12 | 승리 포즈 | 4~6 |

### 프롬프트 (영어가 잘 먹힘, [ ] 부분만 바꾸기)

```
Pixel art sprite sheet for a 2D platform fighting game, high quality anime style,
original character: [CHARACTER].
Flat solid background color #46415A, no gradient, no grid, no text, no labels.
The character faces RIGHT in every frame. Same character size in every frame.
Exactly 12 horizontal rows, one animation per row, frames evenly spaced left to right,
at least 24px empty gap between frames and between rows, nothing overlaps.
Row 1: idle breathing (5 frames)
Row 2: walk cycle (6 frames)
Row 3: jump - crouch, rise, apex, fall (4 frames)
Row 4: quick light attack (5 frames)
Row 5: heavy attack swinging [WEAPON] (5 frames)
Row 6: jumping attack in mid-air (3 frames)
Row 7: casting [ABILITY] projectile from the hand (5 frames)
Row 8: super special move with big [ABILITY] effect (8 frames)
Row 9: getting hit (3 frames)
Row 10: guard pose (1 frame)
Row 11: knocked down, falling to lying on the ground (5 frames)
Row 12: victory pose (5 frames)
```

### 기술 구성 (모든 캐릭터 공통 키)
- J 약 · K 발차기 · L 아이덴티티(캐릭터마다 다름, 재사용 대기 있음) · I 필살기(게이지 MAX)
- 카이: 아이덴티티 질풍권(돌진, 공중이면 내리꽂는 발차기) / 필살기 천풍난무(회오리 돌진 6연타)
- 소영: 아이덴티티 지도편달(긴 채찍으로 끌어당김) / 필살기 보충수업(앞뒤 6연타)
- 릴리: 아이덴티티 비눗방울(느린 함정 탄) / 필살기 장마 파도(5연타 파도), 공중에서 점프 누르면 천천히 떨어짐
- 이그나: 아이덴티티 화염구(원거리 탄, 공중이면 비스듬히 내리꽂음) / 필살기 업화주(상대 발밑 불기둥 4연타)

### 넣기
```
python3 scripts/import-fight-sheet.py 받은그림.png haru
python3 scripts/import-fight-sheet.py 받은그림.png ren --wm 840,930,905,1000
```
→ `public/fight/<id>.webp/.json` 생성. 줄이 12개로 안 잡히면 에러 — 붙은 줄은 `--split y`로 자름.
배치가 다른 시트는 `PRESETS`에 줄·프레임을 직접 적음 (미오가 그 예).

## 맵 배경

### 규칙
- 16:9 한 장 (1920×1080 정도)
- 발판 배치 가이드 그림(`scripts/fight-map-guides.py`로 생성)을 참고 이미지로 같이 넣기
  - 베이지 막대 = 떠 있는 발판(밑에서 뚫고 올라감), 갈색 덩어리 = 바닥
  - 빨간 상자 = 캐릭터 키 (크기 감 잡기용, 그리지 말 것)

### 프롬프트
```
2D side-view platform fighting game stage background, 16:9, high quality anime
background art, painterly, detailed, atmospheric lighting.
Scene: [SCENE].
Use the attached layout image: beige bars are floating platforms and brown blocks are
solid ground. Paint them as [PLATFORM OBJECTS] at exactly the same positions and sizes.
Do not add other platforms. No characters, no text, no UI.
```
- **운동장** — `school sports ground at sunset, cherry blossom trees, school building and clock tower` / `metal bleachers and banner trusses`
- **체육관** — `school gymnasium interior, afternoon light through high windows, red stage curtain` / `wooden stage, steel catwalks, basketball backboards`
- **옥상** — `school rooftop at night in a futuristic academy city, neon skyline, full moon, a gap between two buildings` / `rooftop floors, water tank, AC unit, neon signboards`
- **공중 교정** — `pieces of a school campus floating in a bright sky above a sea of clouds after an ability explosion` / `floating rock islands with broken courtyard tiles and grass`

### 넣기
```
python3 scripts/import-fight-bg.py 받은그림.png roof
```
→ `public/fight/bg/roof.webp`. `src/lib/fight/maps.ts` 해당 맵에 `bg`, `bgPlats: true` 넣고
발판 좌표를 그림에 맞춰 조금씩 옮김.

### 밸런스 원칙
- 맞히기 쉬운 기술(긴 리치·탄)은 한 대가 약하고, 센 기술은 느리거나 빈틈이 큼
- 조작이 어려운 캐릭터(★★★)일수록 잘 쓰면 보상이 큼
- 작고 피하기 쉬운 캐릭터는 체력이 낮음
- 승률은 AI끼리 여러 판 돌려서 확인 (같은 난이도끼리 리그전)

### 밸런스 시뮬레이션
```
npx tsx scripts/fight-balance.ts 8 5            # 8판씩, AI 고수 — 승률표·기술별 피해 비중
npx tsx scripts/fight-balance.ts 8 3            # AI 중급 (낮은 숙련도에서의 승률)
npx tsx scripts/fight-balance.ts 6 5 --restrict # 소영이 발차기·채찍 없이 싸우면 승률이 얼마나 떨어지나 (사거리의 가치)
```
목표: 두 단계 모두에서 40~60% 안. 조작이 어려운 캐릭터(★★★)는 고수에서 높고 중급에서 낮아도 됨.
참고: 메타게임 자동 밸런싱(승률표를 목표와 비교해 수치 조정), 제한 플레이(기술을 막고 승률 차로 가치 측정).
