# 예/아니오 추리 — 사건 제작 · 검수

사건은 사람이 고르고, 기계는 초안과 검수를 맡는다. (AI 가 만든 사건을 그대로 올린 서비스들은 전부 "억지 진상"으로 망했음)
사건은 코드가 아니라 **파일**이다 — 서버가 뜰 때 이 폴더를 읽는다. 데일리가 아니라 계속 쌓는 구조라 사건 추가에 코드 수정이 없다.

```
생성 (Claude, brief.md 기준)  →  cases/candidates/<id>.json          ← 이 순간부터 개발 모드 · 관리자 로그인 목록에 "후보"로 뜸
   ↓
정적 검수  npx tsx scripts/mystery-review.ts <id> --lint-only
   ↓
LLM 검수   npx tsx scripts/mystery-review.ts <id> [--play=cases/plays/<id>.txt] [--repeat=2]
           → cases/reviews/<id>.md  (통과/반려 + 항목별)
   ↓
사람 확인  문제 · 진상 · 리포트 읽고, 사이트에서 직접 풀어 보고 OK
   ↓
등록       git mv cases/candidates/<id>.json cases/live/<id>.json  → 커밋 · 배포 → 모두에게
```

- `live/` 등록 사건(모두에게) · `candidates/` 후보(운영에선 관리자 목록에만, 로컬 개발 모드면 다 보임. id 만 알면 플레이는 됨) · `plays/` 자동 플레이 질문 · `reviews/` 리포트(생성물, 커밋 안 함)
- 파일 이름 = `id` (`window.json` ↔ `"id": "window"`). 다르면 서버가 안 뜸.
- 검수 키: `.env` 의 `GROQ_API_KEY_REVIEW` (플레이 키와 **다른 계정**). 없으면 플레이 키를 쓰고 리포트에 `(!)` 표시.
- 사건 하나 검수 ≈ 45 콜. 무료 한도(모델당 분당 ~4문)라 질문 사이 6초 쉼 → 5~6분. 전 모델이 429 로 쉬면 30초 쉬고 재시도, 그래도 안 되면 "미판정"으로 따로 셈(반려 아님, 나중에 다시).
- `cases/plays/<id>.txt`: 자동 플레이용 질문 목록 (줄마다 하나, `#` 주석). 사건을 안 본 사람/Claude 가 "이 문제만 보고" 30문쯤 써 두면 실제 플레이 흐름을 본다 — 10문 안에 끝나면 너무 쉬움, 30문에도 핵심 도장 0 이면 너무 어려움.
- 전부 다시: `npx tsx scripts/mystery-review.ts` (live 전부) · `--candidates` (후보 전부). 사건을 고치면 `version` 올리기 (판정 캐시 키).
- 배포: Dockerfile 이 `cases/live` · `cases/candidates` 를 이미지에 넣음. 폴더 위치를 바꾸면 `MYSTERY_CASES_DIR`.
