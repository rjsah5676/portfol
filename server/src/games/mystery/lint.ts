import { bonusRubric, requiredRubric, type MysteryCase } from "./cases";

/*
 * 예/아니오 추리 — 사건 정적 검수 (LLM 안 씀). 생성기가 낸 후보 · 기존 사건 전부에 돌림.
 * error = 등록 불가, warn = 사람이 보고 판단.
 */

export interface LintIssue {
  level: "error" | "warn";
  code: string;
  message: string;
}

const KO_WORD = /[가-힣]{2,}/g;
/** 흔한 기능어 — 문제 문장 ↔ 진상 겹침 계산에서 뺌 */
const STOP = new Set(["그리고", "하지만", "그런데", "사건의", "전말은", "왜일까", "그동안", "그날", "다음", "사람", "자신", "때문", "그것", "이것", "경우"]);

/** 아주 거친 어간 추출: 조사 · 흔한 활용 어미를 떼고 앞 2글자만 비교 (명사 · 동사 어간 겹침용) */
const stem = (w: string) =>
  w
    .replace(/(에서는|으로는|에게는|한테는|까지는|부터는|으로|에서|에게|한테|까지|부터|이라|라고|처럼|보다|마다|조차|밖에|은|는|이|가|을|를|의|에|과|와|도|만|로)$/, "")
    .replace(/(했었다|였었다|했다|였다|었다|았다|있었다|없었다|더니|면서|지만|으니|니까|는데|은데|던|었|았|겠|습니다|니다|세요|어요|아요|지요|네요|구나|는지|은지|던지|게|고|며|서|자|어|아|다)$/, "");
const words = (s: string) =>
  new Set(
    (s.match(KO_WORD) ?? [])
      .map(stem)
      .filter((w) => w.length >= 2 && !STOP.has(w))
      .map((w) => w.slice(0, 2))
  );

export function lintCase(c: MysteryCase, others: MysteryCase[] = []): LintIssue[] {
  const out: LintIssue[] = [];
  const err = (code: string, message: string) => out.push({ level: "error", code, message });
  const warn = (code: string, message: string) => out.push({ level: "warn", code, message });

  // id · 중복
  if (!/^[a-z0-9-]{3,40}$/.test(c.id)) err("id", `id 는 소문자·숫자·하이픈 3~40자: ${c.id}`);
  const ids = [...c.facts, ...c.falseBeliefs, ...c.rubric, ...c.clues].map((x) => x.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) err("dup-id", `id 중복: ${[...new Set(dup)].join(", ")}`);
  if (others.some((o) => o.id === c.id)) err("dup-case", `이미 있는 사건 id: ${c.id}`);

  // 개수 범위 (레퍼런스 실측: 정답 2~8 · 보너스 2~4 · 함정 2+ · 사실 12+ · 단서 2~3)
  const req = requiredRubric(c);
  const bon = bonusRubric(c);
  if (req.length < 2 || req.length > 8) err("rubric-count", `정답 항목은 2~8개 (지금 ${req.length})`);
  if (bon.length < 1) warn("bonus-count", `보너스 항목이 없음 — 디테일은 보너스로 빼는 게 좋음`);
  if (bon.length > 4) warn("bonus-count", `보너스가 ${bon.length}개 — 4개 넘으면 제출문이 길어짐`);
  if (c.falseBeliefs.length < 2) err("beliefs", `흔한 오답 가설이 2개 미만 — 함정 없는 사건은 밋밋함`);
  if (c.facts.length < 12) warn("facts", `사실 목록이 ${c.facts.length}개 — 12개 미만이면 판정이 흔들리기 쉬움 (부정형 · 시점별 사실 추가)`);
  if (!c.facts.some((f) => f.key)) err("facts-key", `핵심(key) 사실이 하나도 없음`);
  const keyCount = c.facts.filter((f) => f.key).length;
  if (keyCount > Math.max(6, req.length * 2)) warn("facts-key", `핵심 사실이 ${keyCount}개 — 너무 많으면 큰 도장이 흔해짐`);
  if (c.clues.length < 2 || c.clues.length > 3) warn("clues", `단서는 2~3개 권장 (지금 ${c.clues.length})`);
  for (const cl of c.clues) if (cl.unlockAt >= c.questionLimit) err("clue-unlock", `단서 ${cl.id} 공개 시점(${cl.unlockAt})이 질문 한도(${c.questionLimit}) 이상`);
  const unlocks = c.clues.map((cl) => cl.unlockAt);
  if (unlocks.some((u, i) => i > 0 && u <= unlocks[i - 1])) err("clue-order", `단서 공개 시점이 오름차순이 아님`);
  if (c.questionLimit < 15 || c.questionLimit > 60) warn("limit", `질문 한도 ${c.questionLimit} — 15~60 권장`);

  // 부정형 · 초자연 금지 사실
  if (!c.facts.some((f) => /초자연|귀신|유령/.test(f.statement))) warn("facts-supernatural", `"초자연적 요소 없음" 사실이 없음 — 괴담형 질문이 UNKNOWN 으로 새기 쉬움`);
  if (!c.facts.some((f) => /등장인물|뿐이다|없다|않았다|아니다/.test(f.statement))) warn("facts-negative", `부정형 사실("~는 없다", "등장인물은 ~뿐")이 없음`);

  // 문제 문장의 단어가 진상·사실에 설명되나 (단어 겹침)
  const pw = words(c.prompt);
  const tw = new Set([...words(c.truth), ...c.facts.flatMap((f) => [...words(f.statement)])]);
  const orphan = [...pw].filter((w) => !tw.has(w));
  if (orphan.length > Math.ceil(pw.size * 0.6)) warn("prompt-truth", `문제 문장의 단어 중 진상·사실에 안 나오는 것이 많음: ${orphan.slice(0, 8).join(", ")} — 문제의 이상한 점마다 진상에 이유가 있어야 함`);

  // 루브릭 요구사항이 진상과 겹치나
  for (const r of c.rubric) {
    const rw = words(r.requirement);
    const hit = [...rw].filter((w) => tw.has(w)).length;
    if (rw.size >= 3 && hit / rw.size < 0.3) warn("rubric-truth", `항목 ${r.id}(${r.label}) 요구사항이 진상·사실과 거의 안 겹침 — 채점 기준이 진상 밖일 수 있음`);
    if (/[A-Za-z]/.test(r.label) && !/CCTV|PB/.test(r.label)) warn("label", `항목 ${r.id} 라벨에 영문 — 화면용 이름은 한국어로`);
    if (r.label.length > 14) warn("label", `항목 ${r.id} 라벨이 김(${r.label.length}자) — 유형 이름만`);
  }

  // 오답 가설이 진상과 모순인지 (가설 문장의 단어가 사실 목록의 부정형과 맞물리는지는 LLM 검수에서)
  for (const b of c.falseBeliefs) if (b.statement.length < 8) warn("belief", `가설 ${b.id} 가 너무 짧음`);

  // 기대 판정
  const ask = c.expected?.ask ?? [];
  if (ask.length < 12) warn("expected", `기대 판정이 ${ask.length}개 — 12개 이상 권장 (함정 가설마다 1개 · 핵심 사실마다 1개 · 반려/무관/복합 각 1개)`);
  if (!ask.some((a) => a.example)) warn("expected-example", `판정 예시(example)가 없음 — 헷갈리는 질문 2개를 표시`);
  if (!ask.some((a) => a.ok.includes("INVALID"))) warn("expected-cover", `INVALID(반려) 기대 판정이 없음`);
  if (!ask.some((a) => a.ok.includes("SPLIT"))) warn("expected-cover", `SPLIT(복합) 기대 판정이 없음`);
  if (!ask.some((a) => /(아니|않)(야|죠|나요|에요|지|ㄴ가요|가요|니|어|음|냐)\?$/.test(a.q))) warn("expected-cover", `부정 의문문 기대 판정이 없음`);
  const grade = c.expected?.grade ?? [];
  if (grade.length < 2) warn("expected-grade", `채점 테스트가 ${grade.length}개 — 정답 전부 · 부분 · 오답 3개 권장`);

  // 다른 사건과 문제 문장 겹침
  for (const o of others) {
    if (o.id === c.id) continue;
    const ow = words(o.prompt);
    const inter = [...pw].filter((w) => ow.has(w)).length;
    if (pw.size && inter / pw.size > 0.5) warn("similar", `문제 문장이 사건 "${o.id}"와 많이 겹침 (${Math.round((inter / pw.size) * 100)}%)`);
  }

  // 길이
  if (c.prompt.length > 160) warn("prompt-length", `문제 문장이 ${c.prompt.length}자 — 160자 넘으면 모바일 카드에서 김`);
  if (c.truth.length < 200) warn("truth-length", `진상이 ${c.truth.length}자 — 너무 짧으면 판정 근거가 부족함`);

  return out;
}

export const lintAll = (cases: MysteryCase[]) => cases.map((c) => ({ id: c.id, issues: lintCase(c, cases.filter((o) => o !== c)) }));
