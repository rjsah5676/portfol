# 글리치 디펜스 화면

작업 전에 `web/docs/defense/HANDOFF.md` 를 먼저 읽을 것. 엔진 규칙은 `web/src/lib/defense/CLAUDE.md`.

- 무대는 1024×576 고정 배치(`Stage.tsx`) — 새 UI 도 이 좌표로 놓기 (폰 가로 · PC 같은 배치)
- 시뮬 상태는 읽기만, 바꾸는 건 늘 `ctrl.issue(명령)` (솔로 기록 · 멀티 전송이 여기서 갈림)
- 그림은 `lib/defense/assets.ts` 연결표 → `render.ts` 가 있으면 그림, 없으면 자리표시
