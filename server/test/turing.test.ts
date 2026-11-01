import { afterEach, describe, expect, it } from "vitest";
import { cleanTalk, createTuring, parseVote, tally, type Turing, type TuringView } from "../src/games/turing/game";
import type { LlmCall, ModelSpec } from "../src/games/turing/llm";

const M = (id: string, provider: "gemini" | "groq" = "groq"): ModelSpec => ({ id, label: id, company: "X", provider, model: id });

describe("AI 사람 찾기 — 정리 · 해석", () => {
  it("대사에서 생각 태그 · 이름표 · 따옴표를 뗀다", () => {
    expect(cleanTalk("<think>음...</think>\n노바: \"난 계산이 빨라\"", ["노바"])).toBe("난 계산이 빨라");
    expect(cleanTalk("<think>끝나지 않은 생각", ["노바"])).toBe("…");
    expect(cleanTalk("가".repeat(300), []).length).toBeLessThanOrEqual(161);
  });

  it("투표 JSON · 이름만 있는 답 · 엉뚱한 답", () => {
    expect(parseVote('{"vote":"솔","reason":"말투가 사람 같음"}', ["솔", "미르"])).toEqual({ to: "솔", reason: "말투가 사람 같음" });
    expect(parseVote("음 아무래도 미르 같아", ["솔", "미르"])).toEqual({ to: "미르", reason: "" });
    expect(parseVote('{"vote":"없는사람"}', ["솔", "미르"])).toBeNull();
  });

  it("최다 득표 · 동점", () => {
    expect(tally([{ to: "a" }, { to: "a" }, { to: "b" }])).toEqual({ out: "a", tie: false });
    const t = tally([{ to: "a" }, { to: "b" }], () => 0.99);
    expect(t).toEqual({ out: "b", tie: true });
  });
});

describe("AI 사람 찾기 — 판 진행 (가짜 AI)", () => {
  let game: Turing | null = null;
  afterEach(() => game?.close());

  // 가짜 AI: 말은 고정, 투표는 후보 중 첫 번째
  const fake: LlmCall = async (_spec, req) => {
    if (req.user.includes("[투표]")) {
      const cands = /후보: (.+)/.exec(req.user)![1].split(", ");
      return JSON.stringify({ vote: cands[0], reason: "그냥" });
    }
    return "난 0.1초면 계산 끝나";
  };

  async function playTalk(t: Turing, v: TuringView): Promise<TuringView> {
    while (v.phase === "talk") {
      v = v.turn === v.me ? t.say(v.id, "나도 AI야 진짜로") : await t.next(v.id);
    }
    return v;
  }

  it("AI 정체는 판이 끝날 때만 공개되고, 끝까지 가면 승패가 난다", async () => {
    game = createTuring({ llm: fake, seats: [M("a"), M("b")], fallbacks: [], log: () => {} });
    let v = game.start("normal");
    expect(v.players).toHaveLength(5);
    expect(v.players.filter((p) => p.me)).toHaveLength(1);
    expect(v.result).toBeNull();
    expect(JSON.stringify(v)).not.toContain('"label"');

    let rounds = 0;
    while (v.phase !== "over" && rounds < 5) {
      v = await playTalk(game, v);
      expect(v.phase).toBe("vote");
      const target = v.players.find((p) => p.alive && !p.me)!.name;
      v = await game.vote(v.id, target);
      rounds++;
    }
    expect(v.phase).toBe("over");
    expect(v.result!.reveal.filter((r) => r.human)).toHaveLength(1);
    expect(v.result!.reveal.filter((r) => !r.human).every((r) => r.label === "a" || r.label === "b")).toBe(true);
  });

  it("남의 차례에 말하거나 투표 시간이 아닐 때 투표하면 막힌다", async () => {
    game = createTuring({ llm: fake, seats: [M("a")], fallbacks: [], log: () => {} });
    let v = game.start("easy");
    while (v.turn === v.me) v = game.say(v.id, "안녕");
    expect(() => game!.say(v.id, "끼어들기")).toThrow();
    await expect(game.vote(v.id, v.players.find((p) => !p.me)!.name)).rejects.toThrow();
  });

  it("좌석 모델이 실패하면 다른 모델이 대신 말한다", async () => {
    const flaky: LlmCall = async (spec, req) => {
      if (spec.id === "bad") throw new Error("429");
      return fake(spec, req);
    };
    game = createTuring({ llm: flaky, seats: [M("bad")], fallbacks: [M("good")], log: () => {} });
    let v = game.start("hard");
    v = await playTalk(game, v);
    const said = v.messages.filter((m) => m.name && m.name !== v.me);
    expect(said.every((m) => m.text === "난 0.1초면 계산 끝나")).toBe(true);
  });
});
