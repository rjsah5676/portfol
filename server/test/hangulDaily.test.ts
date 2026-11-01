import { describe, expect, it } from "vitest";
import {
  chosungOf,
  composeKeys,
  coreOf,
  dailyNo,
  sameTiles,
  skeletonOf,
  tierOfLen,
  tilesOf,
} from "../../web/src/lib/hangul/daily";
import { DAILY_BANK } from "../src/hangul/dailyBank";
import { answerOf, bankSizes, checkDaily, puzzleOf } from "../src/hangul/daily";

describe("오늘의 자모: 규칙", () => {
  it("자모 조각: 쌍자음 첫소리 한 장 · 겹받침 두 장 · 완성 모음 그대로", () => {
    expect(tilesOf("꿩")).toEqual(["ㄲ", "ㅝ", "ㅇ"]);
    expect(tilesOf("닭 값")).toEqual(["ㄷ", "ㅏ", "ㄹ", "ㄱ", "ㄱ", "ㅏ", "ㅂ", "ㅅ"]);
    expect(tilesOf("있다")).toEqual(["ㅇ", "ㅣ", "ㅆ", "ㄷ", "ㅏ"]);
  });

  it("두벌식 조합: 받침이 모음을 만나면 다음 글자로 · 겹받침 · ㄸ 은 받침이 못 됨", () => {
    const keys = (s: string) => [...s];
    expect(composeKeys(keys("ㄷㅏㄹㄱ"))).toBe("닭");
    expect(composeKeys(keys("ㄷㅏㄹㄱㅣ"))).toBe("달기");
    expect(composeKeys(keys("ㄱㅏㅂㅅㅇㅣ"))).toBe("값이");
    expect(composeKeys(keys("ㅇㅣㅆㄷㅏ"))).toBe("있다");
    expect(composeKeys(keys("ㅇㅣㅆㅓ"))).toBe("이써");
    expect(composeKeys(keys("ㄱㅏㄸㅏ"))).toBe("가따");
    expect(composeKeys(keys("ㄱㅏㄸ"))).toBe("가ㄸ");
    expect(composeKeys(keys("ㅏㄱ"))).toBe("ㅏㄱ");
    expect(composeKeys(["ㄱ", "ㅏ", ".", "ㄴ", "ㅏ"])).toBe("가.나");
  });

  it("문제 은행의 속담은 모두 자모로 다시 조합됨 · 난이도마다 넉넉히", () => {
    for (const s of DAILY_BANK) expect(composeKeys(tilesOf(s))).toBe(coreOf(s));
    expect(new Set(DAILY_BANK).size).toBe(DAILY_BANK.length);
    const n = bankSizes();
    for (const t of [1, 2, 3] as const) expect(n[t]).toBeGreaterThanOrEqual(40);
    expect(Math.max(...DAILY_BANK.map((s) => coreOf(s).length))).toBeLessThanOrEqual(30);
  });

  it("힌트 · 난이도 · 번호", () => {
    expect(skeletonOf("티끌 모아 태산")).toEqual([2, 2, 2]);
    expect(chosungOf("티끌 모아 태산")).toBe("ㅌㄲ ㅁㅇ ㅌㅅ");
    expect([tierOfLen(7), tierOfLen(8), tierOfLen(10), tierOfLen(11)]).toEqual([1, 2, 2, 3]);
    expect(dailyNo("20261101")).toBe(1);
    expect(dailyNo("20261102")).toBe(2);
    expect(sameTiles(tilesOf("모아"), tilesOf("아모"))).toBe(true);
  });

  it("확인: 정답 · 자모가 다름 · 속담 낱말을 순서만 바꾸면 별해가 아님", async () => {
    const a = "발 없는 말이 천 리 간다";
    expect(await checkDaily(a, "발없는말이천리간다.")).toMatchObject({ kind: "정답", answer: a });
    expect(await checkDaily(a, "발없는말이천리간다간")).toMatchObject({ kind: null, why: "tiles" });
    expect(await checkDaily(a, "없는말이발천리간다")).toMatchObject({ kind: null, why: "order" });
  });

  it("오늘 문제: 날짜 · 난이도마다 그 난이도 속담 · 멀리 있는 날은 없음", () => {
    const now = Date.UTC(2026, 10, 1, 3); // 한국 2026-11-01 정오
    for (const t of [1, 2, 3] as const) {
      const a = answerOf(`20261101_${t}`, now)!;
      expect(tierOfLen(coreOf(a).length)).toBe(t);
      expect(puzzleOf(`20261101_${t}`, now)?.no).toBe(1);
    }
    expect(answerOf("20261102_1", now)).not.toBeNull(); // 내일까지 (시계 여유)
    expect(answerOf("20261103_1", now)).toBeNull();
    expect(answerOf("20261030_1", now)).toBeNull();
    expect(answerOf("20261102_1", now)).not.toBe(answerOf("20261101_1", now));
  });
});
