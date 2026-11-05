import { describe, expect, it } from "vitest";
import { computeCosts, createCraft, memoryStore, parseCraft, pathTo, pickDaily, type Recipe } from "../src/games/craft/craft";
import type { LlmCall, ModelSpec } from "../src/games/mystery/llm";

const M = (id: string): ModelSpec => ({ id, provider: "groq", model: id });
const R = (a: string, b: string, result: string): Recipe => ({ key: [a, b].sort().join("+"), a, b, result, model: "t", at: 0 });

describe("오늘의 조합", () => {
  it("결과 파싱: 이름 형식 · 금지어 · 이모지 하나", () => {
    expect(parseCraft({ result: " 수 증기 ", emoji: "💨💨" })).toEqual({ name: "수증기", emoji: "💨" });
    expect(parseCraft({ result: "구름", emoji: "a" })).toEqual({ name: "구름", emoji: "✨" });
    expect(parseCraft({ result: "아주아주긴이름입니다요", emoji: "🌊" })).toBeNull();
    expect(parseCraft({ result: "씨발놈", emoji: "🌊" })).toBeNull();
    expect(parseCraft({ result: "물!", emoji: "🌊" })).toBeNull();
  });

  it("최소 조합 수 · 경로: 공유하는 재료는 한 번만 셈", () => {
    const rs = [R("물", "불", "수증기"), R("수증기", "바람", "구름"), R("구름", "물", "비"), R("비", "구름", "폭풍"), R("물", "흙", "진흙")];
    const { need, via } = computeCosts(rs);
    expect(need.get("수증기")!.size).toBe(1);
    expect(need.get("비")!.size).toBe(3);
    // 폭풍 = 수증기 · 구름 · 비 · 폭풍 (구름을 두 번 세지 않음)
    expect(need.get("폭풍")!.size).toBe(4);
    expect(pathTo("폭풍", via).map((s) => s[2])).toEqual(["수증기", "구름", "비", "폭풍"]);
  });

  it("데일리 목표: 같은 날엔 늘 같은 것, 최근 목표는 피함", () => {
    const rs = [R("물", "불", "수증기"), R("수증기", "바람", "구름"), R("구름", "물", "비"), R("비", "구름", "폭풍"), R("폭풍", "흙", "모래폭풍")];
    const a = pickDaily("2026-11-05", rs, [], [3, 5])!;
    expect(pickDaily("2026-11-05", rs, [], [3, 5])).toEqual(a);
    expect(["비", "폭풍", "모래폭풍"]).toContain(a.target);
    expect(a.par).toBe(a.path.length);
    const b = pickDaily("2026-11-05", rs, [a.target], [3, 5])!;
    expect(b.target).not.toBe(a.target);
  });

  it("조합: 처음만 LLM, 다음부턴 저장된 결과 · 없는 재료는 거절 · 최초 발견", async () => {
    let calls = 0;
    const llm: LlmCall = async (spec) => {
      calls++;
      if (spec.id === "dead") throw new Error("down");
      return '{"result":"수증기","emoji":"💨"}';
    };
    const store = memoryStore();
    const c = createCraft({ store, llm, models: [M("dead"), M("ok")] });
    const first = await c.combine("물", "불", "ip1", "건모");
    expect(first).toMatchObject({ newRecipe: true, newElement: true, result: { name: "수증기", firstBy: "건모" } });
    const again = await c.combine("불", "물", "ip2", "다른사람");
    expect(again).toMatchObject({ newRecipe: false, newElement: false, result: { name: "수증기", firstBy: "건모" } });
    expect(calls).toBe(2); // dead 한 번 + ok 한 번, 두 번째 조합은 저장된 결과
    await expect(c.combine("물", "아무말", "ip1", null)).rejects.toThrow();
    // 만든 원소는 재료로 쓸 수 있음
    await expect(c.combine("수증기", "바람", "ip1", null)).resolves.toBeTruthy();
  });

  it("새 조합은 사람당 분당 제한", async () => {
    let n = 0;
    const llm: LlmCall = async () => `{"result":"결과${n++}","emoji":"✨"}`;
    const c = createCraft({ store: memoryStore(), llm, models: [M("ok")], perMinute: 2 });
    await c.combine("물", "불", "ip", null);
    await c.combine("물", "흙", "ip", null);
    await expect(c.combine("물", "바람", "ip", null)).rejects.toMatchObject({ status: 429 });
    // 저장된 조합은 제한과 상관없음
    await expect(c.combine("불", "물", "ip", null)).resolves.toBeTruthy();
  });

  it("힌트: 가진 재료 기준 다음 원소", async () => {
    const store = memoryStore({
      elements: { 수증기: "💨", 구름: "☁️", 비: "🌧️", 폭풍: "⛈️" },
      recipes: [["물", "불", "수증기"], ["수증기", "바람", "구름"], ["구름", "물", "비"], ["비", "구름", "폭풍"]],
    });
    const c = createCraft({ store, llm: async () => "", models: [] });
    const d = (await c.daily("2026-11-05"))!;
    expect(d.target).toBeTruthy();
    const h = await c.hint("2026-11-05", ["수증기"], 2);
    expect(h).toMatchObject({ name: d.path.find((s) => s[2] !== "수증기")![2] });
    expect(h!.from).toHaveLength(2);
  });
});
