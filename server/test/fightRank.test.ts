import { describe, expect, it } from "vitest";
import { BOT_MAX, RATING_PLACEMENT, dominance, estimateRatings, nextStreak, rankDelta } from "../src/games/fightRating";
import { botBuild, replayBot } from "../src/games/fightBot";
import { CHARS } from "../../web/src/lib/fight/chars";
import { newMatch, step } from "../../web/src/lib/fight/sim";
import { AI_LEVELS, BOT_MAX as WEB_BOT_MAX, FightAI, aiForRating, aiLevelFor } from "../../web/src/lib/fight/ai";

describe("랭크전 레이팅", () => {
  it("배치가 끝난 뒤 같은 점수끼리는 ±12", () => {
    expect(rankDelta(1500, RATING_PLACEMENT, 1500, 1)).toBe(12);
    expect(rankDelta(1500, RATING_PLACEMENT, 1500, 0)).toBe(-12);
  });
  it("배치 중 압도하면 더 오름 (2:0 · 체력 가득 = 1.8배, 3연승부터 1.2배 더)", () => {
    const plain = rankDelta(1000, 0, 1000, 1);
    expect(plain).toBe(20);
    expect(rankDelta(1000, 0, 1000, 1, { m: { rounds: 2, hp: 1 } })).toBe(36);
    expect(rankDelta(1000, 0, 1000, 1, { m: { rounds: 2, hp: 1 }, streak: 2 })).toBe(43);
    expect(rankDelta(1000, 0, 1000, 1, { m: { rounds: 1, hp: 0.1 } })).toBeLessThan(30);
    // 배치가 끝나면 압도 보정 없음 (연승 보정만 — 5연승째 ×1.2)
    expect(rankDelta(1000, RATING_PLACEMENT, 1000, 1, { m: { rounds: 2, hp: 1 }, streak: 0 })).toBe(12);
    expect(rankDelta(1000, RATING_PLACEMENT, 1000, 1, { m: { rounds: 2, hp: 1 }, streak: 5 })).toBe(14);
    expect(dominance(null)).toBe(0);
  });
  it("봇 상한 위에서는 봇을 이겨도 1~2점, 지면 크게", () => {
    expect(BOT_MAX).toBe(WEB_BOT_MAX);
    expect(rankDelta(2700, 50, 2600, 1, { bot: true })).toBe(2);
    expect(rankDelta(2900, 50, 2600, 1, { bot: true })).toBe(1);
    expect(rankDelta(2900, 50, 2600, 0, { bot: true })).toBeLessThanOrEqual(-20);
    // 사람끼리는 보통 Elo
    expect(rankDelta(2900, 50, 2900, 1)).toBe(12);
  });
});

describe("연승·연패 보정", () => {
  it("배치 뒤 3연승째 ×1.1 · 5연승째 ×1.2, 3연패째 ×1.1 · 5연패째 ×1.2", () => {
    const n = RATING_PLACEMENT;
    expect(rankDelta(1500, n, 1500, 1, { streak: 1 })).toBe(12);
    expect(rankDelta(1500, n, 1500, 1, { streak: 2 })).toBe(13);
    expect(rankDelta(1500, n, 1500, 1, { streak: 4 })).toBe(14);
    expect(rankDelta(1500, n, 1500, 0, { streak: -1 })).toBe(-12);
    expect(rankDelta(1500, n, 1500, 0, { streak: -2 })).toBe(-13);
    expect(rankDelta(1500, n, 1500, 0, { streak: -4 })).toBe(-14);
    // 연승 중에 지면 보정 없음
    expect(rankDelta(1500, n, 1500, 0, { streak: 5 })).toBe(-12);
    expect(nextStreak(3, "w")).toBe(4);
    expect(nextStreak(3, "l")).toBe(-1);
    expect(nextStreak(-2, "l")).toBe(-3);
    expect(nextStreak(-2, "w")).toBe(1);
    expect(nextStreak(undefined, "d")).toBe(0);
  });
});

describe("예전 판 추정 레이팅", () => {
  it("시간순으로 다시 계산하고, 마지막은 지금 점수 쪽으로 맞춤 · 봇 자리는 사람과 같게", () => {
    const g = (a: string, b: string, out: 0 | 1 | 2, bot = false) => ({ uids: [a, b] as [string, string], out, ...(bot ? { bot } : {}) });
    const games = [g("a", "b", 0), g("a", "b", 0), g("a", "bot:x", 1, true), g("b", "a", 1)];
    const raw = estimateRatings(games, new Map());
    expect(raw[0]).toEqual([1000, 1000]);
    expect(raw[1][0]).toBeGreaterThan(1000);
    expect(raw[1][1]).toBeLessThan(1000);
    expect(raw[2][1]).toBe(raw[2][0]);
    expect(raw[3][1]).toBe(raw[2][0] + rankDelta(raw[2][0], 2, raw[2][0], 0, { streak: 2, bot: true }));
    // a 의 지금 점수가 2000 이면 뒤 판일수록 그쪽으로 끌어올림 (첫 판은 1000 그대로)
    const fit = estimateRatings(games, new Map([["a", 2000]]));
    expect(fit[0][0]).toBe(1000);
    expect(fit[3][1]).toBeGreaterThan(1500);
    expect(fit[3][0]).toBe(raw[3][0]);
  });
});

describe("레이팅별 AI", () => {
  it("기준선: 지존 2000 · 초급 200, 그 사이는 섞임", () => {
    expect(aiForRating(2000).react).toBe(AI_LEVELS[6].react);
    expect(aiForRating(200).block).toBeCloseTo(AI_LEVELS[1].block);
    const mid = aiForRating(1800);
    expect(mid.lookP).toBeCloseTo(0.5);
    expect(aiLevelFor(6).name).toBe("지존");
    expect(aiForRating(2600).name).toBe("초월");
    expect(aiForRating(9999).name).toBe("초월");
  });
});

describe("봇전 다시 돌리기", () => {
  it("같은 입력이면 서버에서도 같은 결과", async () => {
    expect(botBuild()).toContain(":");
    const chars: [number, number] = [0, CHARS.length - 1];
    const s = newMatch(chars, 1);
    const human = new FightAI(AI_LEVELS[4], 7);
    const bot = new FightAI(aiForRating(1400, CHARS[chars[1]].id), 1234);
    const inputs: number[] = [];
    while (s.phase !== "over" && inputs.length < 30000) {
      const a = human.next(s, 0);
      inputs.push(a);
      step(s, [a, bot.next(s, 1)]);
    }
    const r = await replayBot({ chars, map: 1, seed: 1234, botR: 1400, inputs });
    expect(r.done).toBe(true);
    expect(r.winner).toBe(s.winner);
    // 끝까지 안 온 기록은 done=false
    const cut = await replayBot({ chars, map: 1, seed: 1234, botR: 1400, inputs: inputs.slice(0, 600) });
    expect(cut.done).toBe(false);
  }, 60_000);
});
