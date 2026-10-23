# 픽셀 글리치 디펜스 (PIXEL GLITCH DEFENSE) 엔진

작업 전에 `web/docs/defense/HANDOFF.md` 를 먼저 읽을 것 (구조 · 규칙 · 다음 할 일 전부 거기).

핵심 규칙만:
- 이 폴더의 시뮬은 **결정론** — `Math.random` · `Date` · `Math.pow/sin/exp` 금지, 난수는 `rnd(b.rng)` 만. 서버 랭킹 검증 · 멀티 락스텝이 여기에 기댐
- 실패한 명령은 상태를 하나도 안 바꿔야 함 (`apply` 는 검사 → 변경)
- 밸런스 수치를 바꾸면 `balance.ts` 의 `BALANCE_VER` 올리기 (시즌 순위표가 새로 시작 — 주인과 상의)
- 시뮬 규칙(코드)을 바꾸면 `balance.ts` 의 `SIM_REV` 올리기 — 판 검증 열쇠(`simrev.ts` SIM_KEY). 수치 표는 해시가 알아서 잡지만 코드 규칙은 못 잡음. 안 올리면 판 도중 배포 때 옛 판이 새 규칙으로 돌아 엉뚱한 결과가 됨
- 바꾼 뒤 확인: `cd server && npx tsx scripts/defense-sim.ts -n 10` (결정론 검사 포함) · `npm test -- defense`
- 서버(`server/src/games/defense.ts`)도 이 폴더 코드를 그대로 import 함 — 브라우저 전용 API 쓰지 말 것 (`assets.ts` 의 불러오기 함수만 예외, 시뮬에서 안 씀)
