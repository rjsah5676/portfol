# 픽셀 글리치 디펜스 화면

작업 전에 `web/docs/defense/HANDOFF.md` 를 먼저 읽을 것. 엔진 규칙은 `web/src/lib/defense/CLAUDE.md`.

- 무대는 1024×576 고정 배치(`Stage.tsx`) — 새 UI 도 이 좌표로 놓기 (폰 가로 · PC 같은 배치)
- 시뮬 상태는 읽기만, 바꾸는 건 늘 `ctrl.issue(명령)` (솔로 기록 · 멀티 전송이 여기서 갈림)
- 그림은 `lib/defense/assets.ts` 연결표 → `render.ts` 가 있으면 그림, 없으면 자리표시
- 도트 UI: 둥근 모서리 · 흐림 · 부드러운 그라데이션 · 이모지 쓰지 말 것 → `css/defense.css` 의 `px-btn` · `px-box` · `px-inset` · `px-win` · `px-bar`, 아이콘은 `ui.tsx` 의 `Icon` · `FactionIcon`, 버튼은 `Btn` (올리면 소리 · 누르면 소리, 결과 소리가 따로 있으면 `silent`)
- 세력은 색 + 문장, 등급은 테두리 · 외곽선 · 오라 · 보석 글자로 늘 구분되게 (HANDOFF 6번 "화면")
- 소리는 `audio.ts` 의 `sfx(이름)` · `playBgm(이름)` (파일 목록은 `lib/defense/assets.ts`)
