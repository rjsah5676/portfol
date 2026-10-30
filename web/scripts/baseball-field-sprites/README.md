# 수비 화면 픽셀 스프라이트 굽기

3D 모델(Meshy 리깅 + 믹사모 모션, glb — 레포 밖 작업 폴더)을 2D 수비 화면 각도(위에서 25°)로 렌더해서 픽셀 시트로.

1. `render.ts` → esbuild 로 묶어 `index.html` 과 같이 정적 서버에 (모델: `../f3d/models/{fielder,fielder_mx,batter,batter_mx,glove}.glb`)
2. `node bake.js fielder bk_fd` · `node bake.js batter bk_bt` — 동작 × 8방향 × 프레임, 본그림 + 팀색 마스크 (팀색 자리는 회색으로 구움)
3. `python3 pack.py bk_fd fd` · `python3 pack.py bk_bt bt` — F px 칸 → 1픽셀 (가운데값), K색, 1px 외곽선, 마스크 시트, json(칸 · 발 자리 · 동작별 장 수 · 핵심 장)
   - 환경변수: `F` 칸 크기(기본 3) · `K` 색 수(기본 48) · `ENH` 채도/대비/안쪽 테두리(기본 1) · `OUT` 출력 폴더 · `SPLIT=1` 동작마다 따로 파일(고해상도용)
   - json `f` = 256 굽기 기준 시트 1px 크기. 게임은 `u = sc·f/5`
4. 고해상도(LOD): 100K 모델 → `node optimize.mjs raw.glb f3d/models/batter100.glb 2048`, `BLUR=3 node bake.js batter100 bk_bt100 512`
   - 보통: `F=6 python3 pack.py bk_bt100 bt` (f 3)
   - 확대용: `F=3 K=64 SPLIT=1 python3 pack.py bk_bt100 bt_hd` (f 1.5, 동작별 파일 — 확대될 때만 받음)
   - 게임은 보통 시트 1px 이 실제 화면 1.6px 넘으면 `_hd` 로 바꿈 (`fieldSprites.ts HD_AT`)
5. GPT 픽셀화 (주자 · 지금 쓰는 그림): 렌더 프레임을 동작 · 방향별 격자 시트(4×2 · 4×1 · 3×2, 흰 배경)로 묶어 GPT 에 「기준 그림(통과한 달리기 시트) + 새 시트」로 넣음
   - 프롬프트 요지: 기준 그림 화풍 그대로 · 포즈는 새 시트 칸마다 · 상의만 핀스트라이프, 바지 흰색 + 옆줄 하나 · 팀색 자리는 마젠타만 · 얼굴 작게 · 배경 #00FF00
   - 필요한 건 방향 d0~d4 다섯 (d5 · d6 · d7 = d3 · d2 · d1 좌우 반전)
   - `python3 gpt2frames.py gptok bk_bt100 bk_gpt` — 칸마다 렌더 실루엣에 맞춰 크기 · 위치 정렬, 마젠타 · 빨강 → 회색 명암 + 팀색 마스크, 피부색 맞춤, 반전 방향 채움
   - `ENH=0 OUTL=0 F=6 K=48 python3 pack.py bk_gpt bt` · `ENH=0 OUTL=0 F=3 K=64 SPLIT=1 python3 pack.py bk_gpt bt_hd` (외곽선은 GPT 그림에 이미 있음)
6. `packout/field_*` → `public/baseball/sprites/`

게임: `src/components/Baseball/fieldSprites.ts` (팀색 칠하기 · 동작 짜기 · 그리기)
