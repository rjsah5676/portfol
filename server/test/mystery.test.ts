import { describe, expect, it } from "vitest";
import { caseById, CASES } from "../src/games/mystery/cases";
import { createMystery, finalVerdict, normalizeQuestion, parseGrade, parseJudge } from "../src/games/mystery/game";
import { lintAll, lintCase } from "../src/games/mystery/lint";
import { extractJson, type LlmCall, type ModelSpec } from "../src/games/mystery/llm";

const M = (id: string): ModelSpec => ({ id, provider: "groq", model: id });
const boxes = caseById("boxes")!;

describe("예/아니오 추리 — 사건 데이터", () => {
  it("등록된 사건은 정적 검수 오류가 없다", () => {
    for (const { id, issues } of lintAll(CASES)) {
      expect(issues.filter((i) => i.level === "error"), id).toEqual([]);
    }
  });

  it("정적 검수가 망가진 사건을 잡는다", () => {
    const broken = {
      ...boxes,
      id: "Bad Id",
      rubric: [boxes.rubric[0]],
      falseBeliefs: [],
      facts: boxes.facts.map((f) => ({ ...f, key: false })),
      clues: [{ id: "c1", unlockAt: 99, body: "x" }, { id: "c1", unlockAt: 5, body: "y" }],
    };
    const codes = lintCase(broken, CASES).filter((i) => i.level === "error").map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["id", "dup-id", "rubric-count", "beliefs", "facts-key", "clue-unlock", "clue-order"]));
  });
});

describe("예/아니오 추리 — 해석", () => {
  it("정규화: 어미 · 문장부호는 지우고 부정어는 남긴다", () => {
    expect(normalizeQuestion("상자가 여러 개였나요?")).toBe(normalizeQuestion("상자가 여러 개였나"));
    expect(normalizeQuestion("범인이 아니야?")).not.toBe(normalizeQuestion("범인이야?"));
    expect(normalizeQuestion("안 찾아갔어?")).toContain("안");
  });

  it("JSON 꺼내기 · 판정 파싱 · KEY 올리기", () => {
    expect(extractJson('<think>음</think>```json\n{"verdict":"YES"}\n```')).toEqual({ verdict: "YES" });
    expect(extractJson("모르겠다")).toBeNull();
    const yes = parseJudge(boxes, { verdict: "YES", facts: ["f01", "없는id"], beliefs: [] })!;
    expect(yes.facts).toEqual(["f01"]);
    expect(finalVerdict(boxes, yes)).toBe("KEY_YES");
    expect(finalVerdict(boxes, parseJudge(boxes, { verdict: "YES", facts: ["f04"] })!)).toBe("YES");
    expect(finalVerdict(boxes, parseJudge(boxes, { verdict: "NO", beliefs: ["b01"] })!)).toBe("KEY_NO");
    expect(parseJudge(boxes, { verdict: "MAYBE" })).toBeNull();
  });

  it("채점 파싱: 빠진 항목은 missing", () => {
    const g = parseGrade(boxes, { items: [{ id: "r01", status: "passed" }, { id: "r02", status: "이상함" }] })!;
    expect(g.map((x) => x.status)).toEqual(["passed", "missing", "missing", "missing"]);
  });
});

describe("예/아니오 추리 — 판 진행 (가짜 AI)", () => {
  // 가짜 판정: 질문에 따라 고정 답. 채점: '전부'가 들어가면 모두 통과
  const calls: string[] = [];
  const fake: LlmCall = async (spec, req) => {
    calls.push(spec.id);
    if (spec.id === "broken") throw new Error("down");
    if (req.user.includes("<answer>")) {
      const all = req.user.includes("전부");
      return JSON.stringify({ items: boxes.rubric.map((r, i) => ({ id: r.id, status: all || i === 0 ? "passed" : "missing" })) });
    }
    const q = req.user.split("<question>")[1] ?? "";
    if (q.includes("왜")) return '{"verdict":"INVALID"}';
    if (q.includes("그리고")) return '{"verdict":"SPLIT"}';
    return '{"verdict":"YES","facts":["f01"],"beliefs":[]}';
  };
  const make = () => createMystery({ llm: fake, judgeModels: [M("broken"), M("judge")], gradeModels: [M("grade")] });

  it("판정 · 차감 · 캐시 · 단서", async () => {
    const g = make();
    const v0 = g.start("boxes");
    expect(v0.truth).toBeNull();
    expect(JSON.stringify(v0)).not.toContain(boxes.truth.slice(0, 20));

    const a = await g.ask(v0.id, "상자 밑에 뭔가 있었나요?");
    expect(a.verdict).toBe("KEY_YES");
    expect(a.view.used).toBe(1);
    expect(calls.slice(-2)).toEqual(["broken", "judge"]);

    const before = calls.length;
    const b = await g.ask(v0.id, "상자 밑에 뭔가 있었나");
    expect(b.verdict).toBe("YES"); // 같은 핵심 사실은 두 번째부터 도장 없음
    expect(calls.length).toBe(before); // 캐시

    expect((await g.ask(v0.id, "왜 신고했어?")).view.used).toBe(2); // INVALID 는 차감 안 함
    expect((await g.ask(v0.id, "할머니고 그리고 범인이 있어?")).verdict).toBe("SPLIT");

    let v = b.view;
    for (let i = 0; v.used < boxes.clues[0].unlockAt; i++) v = (await g.ask(v0.id, `질문 ${i}번 상자`)).view;
    expect(v.clues.map((c) => c.id)).toEqual(["c1"]);
    expect(v.nextClueAt).toBe(boxes.clues[1].unlockAt);
  });

  it("제출: 미인정 유형만 · 같은 가설 경고 · 클리어하면 진상", async () => {
    const g = make();
    const { id } = g.start("boxes");
    // 가짜 채점은 r01 만 passed → 정답 3개 중 1, 보너스(r02) 0
    const s1 = await g.submit(id, "경비원이 상자가 쌓인 걸 봤다");
    expect(s1.submissions[0]).toMatchObject({ passed: 1, total: 3, bonus: [], bonusTotal: 1, same: false });
    expect(s1.submissions[0].failed.map((f) => f.label)).toEqual(boxes.rubric.filter((r) => !r.bonus && r.id !== "r01").map((r) => r.label));
    expect(JSON.stringify(s1)).not.toContain(boxes.rubric[1].requirement);
    expect(s1.case).toMatchObject({ rubricCount: 3, bonusCount: 1 });
    const s2 = await g.submit(id, "경비원이 상자가 쌓인 걸 봤다니까");
    expect(s2.submissions[1].same).toBe(true);
    const s3 = await g.submit(id, "전부 알아냈다: 상자가 쌓였고 할머니가 쓰러짐");
    expect(s3.status).toBe("solved");
    expect(s3.truth).toBe(boxes.truth);
    expect(s3.submissions[2].bonus).toEqual([boxes.rubric[1].label]);
    await expect(g.ask(id, "또 물어봐도 돼?")).rejects.toThrow();
  });

  it("보너스만 못 맞혀도 해결, 정답 항목 하나 빠지면 미해결", async () => {
    const onlyReq: LlmCall = async () =>
      JSON.stringify({ items: boxes.rubric.map((r) => ({ id: r.id, status: r.bonus ? "missing" : "passed" })) });
    const g = createMystery({ llm: onlyReq, judgeModels: [M("j")], gradeModels: [M("g")] });
    const { id } = g.start("boxes");
    const v = await g.submit(id, "정답 항목만 다 쓴 답안입니다");
    expect(v.status).toBe("solved");
    expect(v.submissions[0]).toMatchObject({ passed: 3, total: 3, bonus: [] });
  });

  it("포기하면 진상 · 단서 전부, 모델이 전부 죽으면 503 이고 차감 없음", async () => {
    const g = make();
    const { id } = g.start("window");
    expect(g.giveUp(id).truth).toBe(caseById("window")!.truth);
    const dead = createMystery({ llm: fake, judgeModels: [M("broken")], gradeModels: [M("broken")] });
    const p = dead.start("boxes");
    await expect(dead.ask(p.id, "상자가 무거웠어?")).rejects.toMatchObject({ status: 503 });
    expect(dead.view(p.id).used).toBe(0);
  });
});
