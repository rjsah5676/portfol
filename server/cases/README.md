# 예/아니오 추리 — 사건 제작 · 검수

사건은 사람이 고르고, 기계는 초안과 검수를 맡는다. (AI 가 만든 사건을 그대로 올린 서비스들은 전부 "억지 진상"으로 망했음)

```
생성 (Claude, brief.md 기준)  →  cases/candidates/<id>.json
   ↓
정적 검수  npx tsx scripts/mystery-review.ts --file=cases/candidates/<id>.json --lint-only
   ↓
LLM 검수   npx tsx scripts/mystery-review.ts --file=cases/candidates/<id>.json [--play=cases/plays/<id>.txt] [--repeat=2]
           → cases/reviews/<id>.md  (통과/반려 + 항목별)
   ↓
사람 확인  문제 · 진상 · 리포트 읽고 OK  →  src/games/mystery/cases.ts 에 추가 (version 1)
```

- 검수 키: `.env` 의 `GROQ_API_KEY_REVIEW` (플레이 키와 **다른 계정**). 없으면 플레이 키를 쓰고 리포트에 `(!)` 표시.
- 사건 하나 검수 ≈ 40~80 콜. 무료 한도(모델당 분당 ~4문)라 질문 사이 6초 쉼 → 10분 안팎.
- `cases/plays/<id>.txt`: 자동 플레이용 질문 목록 (줄마다 하나, `#` 주석). 사건을 안 본 사람/Claude 가 "이 문제만 보고" 30문쯤 써 두면 실제 플레이 흐름을 본다 — 10문 안에 끝나면 너무 쉬움, 30문에도 핵심 도장 0 이면 너무 어려움.
- 등록된 사건은 `npx tsx scripts/mystery-review.ts` (전부) 또는 `… boxes window` 로 다시 돌릴 수 있음. 사건을 고치면 `version` 올리기 (판정 캐시 키).

폴더: `candidates/` 후보 JSON · `plays/` 자동 플레이 질문 · `reviews/` 리포트(생성물, 커밋 안 함).
