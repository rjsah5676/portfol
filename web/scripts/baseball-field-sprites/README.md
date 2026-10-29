# 수비 화면 픽셀 스프라이트 굽기

3D 모델(Meshy 리깅 + 믹사모 모션, glb — 레포 밖 작업 폴더)을 2D 수비 화면 각도(위에서 25°)로 렌더해서 픽셀 시트로.

1. `render.ts` → esbuild 로 묶어 `index.html` 과 같이 정적 서버에 (모델: `../f3d/models/{fielder,fielder_mx,batter,batter_mx,glove}.glb`)
2. `node bake.js fielder bk_fd` · `node bake.js batter bk_bt` — 동작 × 8방향 × 프레임, 본그림 + 팀색 마스크 (팀색 자리는 회색으로 구움)
3. `python3 pack.py bk_fd fd` · `python3 pack.py bk_bt bt` — 5px 칸 → 1픽셀 (가운데값), 32색, 1px 외곽선, 마스크 시트, json(칸 · 발 자리 · 동작별 장 수 · 핵심 장)
4. `packout/field_*` → `public/baseball/sprites/`

게임: `src/components/Baseball/fieldSprites.ts` (팀색 칠하기 · 동작 짜기 · 그리기)
