import { describe, expect, it } from "vitest";
import { madeOf, bestFive, parseCards } from "../../web/src/lib/poker/cards";
import { playStats, type HandDoc } from "../src/games/poker/mystats";

const hd = (
  game: "holdem" | "seven",
  at: number,
  mySeat: number,
  delta: number,
  players: [number, number, boolean][],
  actions: string[],
): HandDoc => ({
  at,
  game,
  who: players.map(([seat]) => ({
    seat,
    uid: seat === mySeat ? "me" : null,
    delta: seat === mySeat ? delta : -delta,
  })),
  hand: {
    players: players.map(([seat, start, folded]) => ({ seat, start, folded })),
    actions,
  },
});

describe("마이페이지 통계", () => {
  it("홀덤: 행동 분류(벳/레이즈/올인) · VPIP · PFR · 3벳 · 쇼다운 · 누적 증감", () => {
    const docs = [
      // 1판: 내가(0) 프리플랍 레이즈 → 상대 콜, 플랍 내가 먼저 벳(=bet), 상대 폴드
      hd(
        "holdem",
        1,
        0,
        30,
        [
          [0, 1000, false],
          [1, 1000, true],
        ],
        [
          "0 0 sb 10",
          "0 1 bb 20",
          "0 0 raise 50",
          "0 1 call 40",
          "1 0 raise 60",
          "1 1 fold 0",
        ],
      ),
      // 2판: 상대 오픈 → 내가 3벳 → 상대 콜, 리버 체크 체크 → 쇼다운 패배
      hd(
        "holdem",
        2,
        0,
        -150,
        [
          [0, 1000, false],
          [1, 1000, false],
        ],
        [
          "0 1 sb 10",
          "0 0 bb 20",
          "0 1 raise 50",
          "0 0 raise 130",
          "0 1 call 90",
          "1 0 check 0",
          "1 1 check 0",
        ],
      ),
      // 3판: 상대 오픈 → 내가 폴드 (3벳 기회는 있었음)
      hd(
        "holdem",
        3,
        0,
        -10,
        [
          [0, 1000, true],
          [1, 1000, false],
        ],
        ["0 0 sb 10", "0 1 bb 20", "0 1 raise 60", "0 0 fold 0"],
      ),
      // 4판: 올인 콜
      hd(
        "holdem",
        4,
        0,
        500,
        [
          [0, 500, false],
          [1, 1000, false],
        ],
        ["0 0 sb 10", "0 1 bb 20", "0 1 raise 500", "0 0 call 490"],
      ),
    ];
    const s = playStats(docs, "me").holdem;
    expect(s.hands).toBe(4);
    expect(s.wins).toBe(2);
    expect(s.acts).toEqual({ raise: 2, bet: 1, check: 1, fold: 1, allin: 1 });
    expect(s.vpip).toBe(3);
    expect(s.pfr).toBe(2);
    expect(s.threeBetChance).toBe(3);
    expect(s.threeBet).toBe(1);
    expect(s.folds).toBe(1);
    expect(s.showdowns).toBe(2);
    expect(s.sdWins).toBe(1);
    expect(s.trend).toEqual([30, -120, -130, 370]);
    expect(s.best).toBe(500);
    expect(s.worst).toBe(-150);
  });
  it("7포커: 하프 · 다이 집계, 시간순 정렬", () => {
    const docs = [
      hd(
        "seven",
        20,
        2,
        -40,
        [
          [1, 1000, false],
          [2, 1000, true],
        ],
        [
          "3 1 ante 10",
          "3 2 ante 10",
          "4 1 bbing 10",
          "4 2 call 10",
          "5 1 half 40",
          "5 2 die 0",
        ],
      ),
      hd(
        "seven",
        10,
        2,
        90,
        [
          [1, 1000, true],
          [2, 1000, false],
        ],
        [
          "3 1 ante 10",
          "3 2 ante 10",
          "4 2 half 20",
          "4 1 call 20",
          "5 2 half 40",
          "5 1 die 0",
        ],
      ),
    ];
    const s = playStats(docs, "me").seven;
    expect(s.acts).toEqual({ half: 2, call: 1, die: 1 });
    expect(s.folds).toBe(1);
    expect(s.trend).toEqual([90, 50]);
    expect(playStats(docs, "me").holdem.hands).toBe(0);
  });
  it("쇼다운 강조: 족보를 이루는 카드만", () => {
    expect(madeOf(bestFive(parseCards("3h Tc Jd Td 2c Ad 3d")))).toHaveLength(
      4,
    );
    expect(madeOf(parseCards("2h 5c 9d Jd Ks"))).toHaveLength(1);
    expect(madeOf(parseCards("5h 4c 3d 2d As"))).toHaveLength(5);
  });
});
