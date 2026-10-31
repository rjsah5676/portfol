import { readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chessScore, janggiScore, omokScore } from "../../web/src/lib/aiScore";
import { kstDay } from "../../web/src/lib/suspect/engine";
import { RHYTHM_CHARTS, RHYTHM_SONG_IDS } from "../src/http/rhythmCharts";
import { startTestServer, type TestServer } from "./helpers";

let s: TestServer;
beforeAll(async () => {
  s = await startTestServer();
});
afterAll(() => s.close());

const pathOf = (board: string) =>
  board.startsWith("rhythm:")
    ? `/api/rankings/rhythm/${board.slice(7)}`
    : board.startsWith("suspect:")
      ? `/api/rankings/suspect/${board.slice(8)}`
      : `/api/rankings/${board}`;

/** 티켓을 받고, 받은 시각을 ago초 전으로 돌려 놓음 (게임을 그만큼 한 것처럼) */
async function ticket(uid: string, board: string, ago = 0): Promise<string> {
  const res = await s.http("/api/rankings/tickets", {
    method: "POST",
    token: await s.token(uid),
    body: { board },
  });
  expect(res.status).toBe(200);
  if (ago)
    await s.db
      .col("rank_tickets")
      .updateOne(
        { _id: res.body.ticket },
        { $set: { createdAt: new Date(Date.now() - ago * 1000) } },
      );
  return res.body.ticket;
}

/** 게임을 ago초 한 뒤 기록을 등록 */
async function play(uid: string, board: string, body: object, ago = 600) {
  const t = await ticket(uid, board, ago);
  return s.http(pathOf(board), {
    method: "POST",
    token: await s.token(uid),
    body: { ...body, ticket: t },
  });
}
const status = (uid: string, board: string, body: object, ago?: number) =>
  play(uid, board, body, ago).then((r) => r.status);

describe("랭킹: 조회·형식", () => {
  it("멜론게임: 점수 높은 순, 누구 기록인지(uid)는 내보내지 않음", async () => {
    for (const [uid, score] of [
      ["m1", 10],
      ["m2", 200],
      ["m3", 50],
    ] as const)
      expect(await status(uid, "score", { name: uid, score })).toBe(200);
    const { body } = await s.http("/api/rankings/score?limit=2");
    expect(body.map((r: any) => r.score)).toEqual([200, 50]);
    expect(typeof body[0].createdAt).toBe("number");
    expect(body[0].uid).toBeUndefined();
    expect(body[0].ticket).toBeUndefined();
  });

  it("지뢰찾기·반응속도는 낮은 값이 위", async () => {
    for (const [uid, time] of [
      ["t1", 30],
      ["t2", 12.5],
      ["t3", 99],
    ] as const)
      expect(
        await status(uid, "minesweeper_rankings", { name: uid, time }),
      ).toBe(200);
    expect(
      (await s.http("/api/rankings/minesweeper_rankings")).body.map(
        (r: any) => r.time,
      ),
    ).toEqual([12.5, 30, 99]);
  });

  it("규칙 밖의 값은 거절 (범위·형식·여분 필드)", async () => {
    expect(await status("v", "score", { name: "a", score: 253 })).toBe(400);
    expect(await status("v", "score", { name: "a", score: 1.5 })).toBe(400);
    expect(await status("v", "score", { name: "", score: 1 })).toBe(400);
    // 이름은 10자까지 (랭킹 종류와 상관없이)
    expect(
      await status("v", "score", { name: "가".repeat(11), score: 1 }),
    ).toBe(400);
    expect(
      await status("v", "minesweeper_rankings", {
        name: "a".repeat(11),
        time: 30,
      }),
    ).toBe(400);
    expect(
      await status("v10", "reaction", { name: "가".repeat(10), score: 300 }),
    ).toBe(200);
    expect(await status("v", "score", { name: "a", score: 1, extra: 1 })).toBe(
      400,
    );
    expect(await status("v", "reaction", { name: "a", score: 79 })).toBe(400);
    expect(
      await status("v", "minesweeper_rankings", { name: "a", time: 9 }),
    ).toBe(400);
    const token = await s.token("v");
    expect(
      (
        await s.http("/api/rankings/nope", {
          method: "POST",
          token,
          body: { name: "a", score: 1 },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await s.http("/api/rankings/tickets", {
          method: "POST",
          token,
          body: { board: "nope" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await s.http("/api/rankings/tickets", {
          method: "POST",
          token,
          body: { board: "rhythm:weird" },
        })
      ).status,
    ).toBe(400);
  });
});

describe("랭킹: 가짜 기록 막기", () => {
  it("로그인과 티켓이 있어야 함", async () => {
    const body = { name: "a", time: 50 };
    expect(
      (
        await s.http("/api/rankings/minesweeper_rankings", {
          method: "POST",
          body,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await s.http("/api/rankings/tickets", {
          method: "POST",
          body: { board: "score" },
        })
      ).status,
    ).toBe(401);
    const token = await s.token("g1");
    // 티켓 없이 / 아무 값이나
    expect(
      (
        await s.http("/api/rankings/minesweeper_rankings", {
          method: "POST",
          token,
          body,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await s.http("/api/rankings/minesweeper_rankings", {
          method: "POST",
          token,
          body: { ...body, ticket: "x".repeat(40) },
        })
      ).status,
    ).toBe(400);
    expect(
      (await s.http("/api/rankings/minesweeper_rankings")).body.some(
        (r: any) => r.name === "a",
      ),
    ).toBe(false);
  });

  it("티켓은 한 번만, 받은 사람만, 그 랭킹에만 쓸 수 있음", async () => {
    const body = { name: "once", time: 60 };
    const post = async (uid: string, board: string, t: string) =>
      (
        await s.http(pathOf(board), {
          method: "POST",
          token: await s.token(uid),
          body: { ...body, ticket: t },
        })
      ).status;

    const t1 = await ticket("o1", "minesweeper_rankings", 100);
    expect(await post("o1", "minesweeper_rankings", t1)).toBe(200);
    expect(await post("o1", "minesweeper_rankings", t1)).toBe(400); // 다시 쓰기

    const t2 = await ticket("o2", "minesweeper_rankings", 100);
    expect(await post("o3", "minesweeper_rankings", t2)).toBe(400); // 남의 티켓

    const t3 = await ticket("o4", "reaction", 100);
    expect(await post("o4", "minesweeper_rankings", t3)).toBe(400); // 다른 게임 티켓

    const t4 = await ticket("o5", "minesweeper_rankings", 8 * 24 * 3600);
    expect(await post("o5", "minesweeper_rankings", t4)).toBe(400); // 너무 오래된 티켓
  });

  it("그 기록이 나올 만큼 시간이 지나지 않았으면 거절", async () => {
    // 지뢰찾기 42초 기록인데 시작한 지 10초
    expect(
      await status("f1", "minesweeper_rankings", { name: "f", time: 42 }, 10),
    ).toBe(400);
    expect(
      await status("f1", "minesweeper_rankings", { name: "f", time: 42 }, 40),
    ).toBe(200); // 통신 지연 허용(3초) 안
    // 멜론게임은 한 판이 약 2분
    expect(await status("f2", "score", { name: "f", score: 100 }, 30)).toBe(
      400,
    );
    expect(await status("f2", "score", { name: "f", score: 100 }, 118)).toBe(
      200,
    );
    // 반응속도: 5번 × (기다림 1.5초 이상 + 반응 시간)
    expect(await status("f3", "reaction", { name: "f", score: 200 }, 4)).toBe(
      400,
    );
    expect(await status("f3", "reaction", { name: "f", score: 200 }, 9)).toBe(
      200,
    );
    // 100ms 보다 빠른 평균은 게임에서 나올 수 없음
    expect(await status("f4", "reaction", { name: "f", score: 90 }, 60)).toBe(
      400,
    );
    // 받자마자 등록
    expect(
      await status("f5", "minesweeper_rankings", { name: "f", time: 30 }, 0),
    ).toBe(400);
  });

  it("한 사람은 가장 좋은 기록 하나만", async () => {
    const mine = async () =>
      (await s.http("/api/rankings/score?limit=100")).body.filter((r: any) =>
        r.name.startsWith("best"),
      );
    const first = await play("b1", "score", { name: "best-a", score: 120 });
    expect(first.body.id).toBeTruthy();
    // 더 낮은 점수 → 그대로 (이름도 안 바뀜)
    const worse = await play("b1", "score", { name: "best-b", score: 80 });
    expect(worse.body).toEqual({ id: first.body.id, kept: true });
    expect(await mine()).toMatchObject([
      { id: first.body.id, name: "best-a", score: 120 },
    ]);
    // 더 높은 점수 → 같은 줄이 바뀜
    const better = await play("b1", "score", { name: "best-c", score: 150 });
    expect(better.body).toEqual({ id: first.body.id });
    expect(await mine()).toMatchObject([
      { id: first.body.id, name: "best-c", score: 150 },
    ]);
    // 다른 사람은 따로
    await play("b2", "score", { name: "best-d", score: 10 });
    expect(await mine()).toHaveLength(2);

    // 낮을수록 좋은 랭킹
    const r1 = await play("b3", "reaction", { name: "best", score: 300 });
    expect(
      (await play("b3", "reaction", { name: "best", score: 350 })).body.kept,
    ).toBe(true);
    expect(
      (await play("b3", "reaction", { name: "best", score: 250 })).body,
    ).toEqual({ id: r1.body.id });
    expect(
      (await s.http("/api/rankings/reaction")).body.filter(
        (r: any) => r.name === "best",
      ),
    ).toMatchObject([{ score: 250 }]);

    // 동시에 여러 번 보내도 한 줄
    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        play("b4", "score", { name: "best-race", score: n }),
      ),
    );
    const race = (await mine()).filter((r: any) => r.name === "best-race");
    expect(race).toMatchObject([{ score: 4 }]);
  });

  it("티켓은 한 사람이 1분에 60개까지", async () => {
    const token = await s.token("many");
    const res = await Promise.all(
      Array.from({ length: 62 }, () =>
        s.http("/api/rankings/tickets", {
          method: "POST",
          token,
          body: { board: "score" },
        }),
      ),
    );
    // 동시에 보내면 몇 개는 더 통과할 수 있어서, 이어서 하나 더
    expect(res.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(
      60,
    );
    expect(
      (
        await s.http("/api/rankings/tickets", {
          method: "POST",
          token,
          body: { board: "score" },
        })
      ).status,
    ).toBe(429);
  });
});

describe("랭킹: AI 대국", () => {
  const base = { name: "a", moves: 30, seconds: 100, lead: 5 };

  it("점수는 같은 공식으로 다시 계산해서 맞아야 함", async () => {
    const chess = chessScore(3, 5, 30, 100).score;
    expect(
      await status("a1", "chess_ai_rankings", {
        ...base,
        score: chess,
        opp: "1200",
      }),
    ).toBe(200);
    expect(
      await status("a2", "chess_ai_rankings", {
        ...base,
        score: chess + 1,
        opp: "1200",
      }),
    ).toBe(400);
    expect(
      await status("a2", "chess_ai_rankings", {
        ...base,
        score: chess,
        opp: "800",
      }),
    ).toBe(400); // 단계와 상대가 다름
    expect(
      await status("a2", "chess_ai_rankings", {
        ...base,
        score: 500,
        opp: "400",
      }),
    ).toBe(400);
    // 수·시간을 줄여 적으면 점수도 그에 맞아야 함
    expect(
      await status("a2", "chess_ai_rankings", {
        ...base,
        moves: 2,
        seconds: 0,
        score: chess,
        opp: "1200",
      }),
    ).toBe(400);

    // 장기: 외통승 / 판정승 둘 다 인정
    for (const [uid, mate] of [
      ["a3", true],
      ["a4", false],
    ] as const)
      expect(
        await status(uid, "janggi_ai_rankings", {
          ...base,
          score: janggiScore(12, 5, 30, 100, mate).score,
          opp: "yisunsin",
        }),
      ).toBe(200);
    expect(
      await status("a5", "janggi_ai_rankings", {
        ...base,
        score: 12_000_001,
        opp: "yisunsin",
      }),
    ).toBe(400);

    // 오목: 흑 / 백 둘 다 인정
    for (const [uid, white] of [
      ["a6", true],
      ["a7", false],
    ] as const)
      expect(
        await status(uid, "omok_ai_rankings", {
          ...base,
          lead: 0,
          score: omokScore(8, 30, 100, white).score,
          opp: "alpha",
        }),
      ).toBe(200);
    expect(
      await status("a8", "omok_ai_rankings", {
        ...base,
        score: omokScore(8, 30, 100, true).score,
        opp: "toString",
      }),
    ).toBe(400);

    // 격투 AI 랭킹은 없앰 (랭크전으로)
    expect((await s.http("/api/rankings/fight_ai_rankings")).status).toBe(404);
  });

  it("내가 쓴 시간보다 대국이 짧을 수는 없음", async () => {
    const body = {
      ...base,
      seconds: 300,
      score: chessScore(1, 5, 30, 300).score,
      opp: "400",
    };
    expect(await status("at1", "chess_ai_rankings", body, 100)).toBe(400);
    expect(await status("at1", "chess_ai_rankings", body, 400)).toBe(200);
  });
});

describe("랭킹: 리듬게임", () => {
  const info = RHYTHM_CHARTS.get("anima_hard")!;
  const row = {
    name: "a",
    score: 981_200,
    acc: 98.12,
    maxCombo: 300,
    fc: false,
    ap: false,
  };

  it("곡·난이도별로 따로", async () => {
    expect(await status("r1", "rhythm:anima_hard", row)).toBe(200);
    expect(
      await status("r1", "rhythm:anima_easy", { ...row, maxCombo: 50 }),
    ).toBe(200);
    const { body } = await s.http("/api/rankings/rhythm/anima_hard");
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject(row);
    expect(body[0].chart).toBeUndefined();
    expect((await s.http("/api/rankings/rhythm/anima_easy")).body).toHaveLength(
      1,
    );
    const token = await s.token("r1");
    expect(
      (
        await s.http("/api/rankings/rhythm/anima_weird", {
          method: "POST",
          token,
          body: row,
        })
      ).status,
    ).toBe(400);
  });

  it("채보와 맞지 않는 기록은 거절", async () => {
    const post = (uid: string, body: object, ago?: number) =>
      status(uid, "rhythm:anima_hard", { ...row, ...body }, ago);
    expect(await post("r2", {}, 60)).toBe(400); // 곡이 끝나기 전
    expect(await post("r2", { maxCombo: info.maxCombo + 1 })).toBe(400); // 채보로 낼 수 없는 콤보
    expect(await post("r2", { score: 1_000_000 })).toBe(400); // 점수와 정확도가 안 맞음
    expect(await post("r2", { fc: true })).toBe(400); // 풀콤보인데 콤보가 모자람
    expect(await post("r2", { ap: true, maxCombo: info.maxCombo })).toBe(400); // 올퍼펙트인데 풀콤보가 아님
    expect(
      await post("r2", {
        score: 1_000_000,
        acc: 100,
        maxCombo: info.maxCombo,
        fc: true,
        ap: true,
      }),
    ).toBe(200);
    // 서버에 채보가 없는 곡(연습곡)은 형식만 봄
    expect(
      await status(
        "r3",
        "rhythm:practice_easy",
        { ...row, score: 5, acc: 1 },
        1,
      ),
    ).toBe(200);
  });

  it("서버가 아는 채보 목록이 프론트의 채보 파일과 같음", () => {
    const files = readdirSync(
      new URL("../../web/src/data/rhythm", import.meta.url),
    )
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
    expect([...RHYTHM_SONG_IDS].sort()).toEqual(files.sort());
  });
});

describe("랭킹: 오늘의 용의자", () => {
  const today = `suspect:${kstDay()}_normal`;
  const row = { name: "탐정", time: 100, miss: 1, hint: 1, score: 190 };

  it("날짜·난이도별로 따로, 사건마다 첫 기록만", async () => {
    expect(await status("d1", today, row)).toBe(200);
    // 다시 풀어 더 좋은 기록이 나와도 첫 기록이 남음 (답을 아니까)
    expect(
      await status("d1", today, {
        ...row,
        time: 50,
        miss: 0,
        hint: 0,
        score: 50,
      }),
    ).toBe(200);
    const { body } = await s.http(pathOf(today));
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject(row);
    expect(
      (await s.http(`/api/rankings/suspect/${kstDay()}_hard`)).body,
    ).toHaveLength(0);
  });

  it("점수 계산 · 날짜 · 시간이 안 맞으면 거절", async () => {
    expect(await status("d2", today, { ...row, score: 100 })).toBe(400); // 시간+실수30+힌트60 과 다름
    expect(await status("d2", "suspect:20200101_normal", row)).toBe(400); // 지난 사건
    expect(await status("d2", today, row, 20)).toBe(400); // 100초 기록인데 20초만 지남
    const token = await s.token("d2");
    expect(
      (
        await s.http("/api/rankings/suspect/today_normal", {
          method: "POST",
          token,
          body: row,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await s.http(`/api/rankings/suspect/${kstDay()}_intro`, {
          method: "POST",
          token,
          body: row,
        })
      ).status,
    ).toBe(400);
  });
});

describe("랭킹: 니들이 한글을 알아?", () => {
  const B = "hangul_rankings";
  // 대표글이 없는 판(best "")은 판정기 없이 확인됨
  const row = { name: "글쟁이", score: 300, wave: 3, best: "", bestPts: 0 };

  it("한 사람이 판마다 여러 개 올릴 수 있음 (더 낮은 점수도 남음) · 최신순", async () => {
    expect(await status("h1", B, row)).toBe(200);
    expect(await status("h1", B, { ...row, score: 200, wave: 2 })).toBe(200);
    expect(await status("h1", B, { ...row, score: 500, wave: 5 })).toBe(200);
    const top = (await s.http(`/api/rankings/${B}`)).body;
    expect(top.map((r: { score: number }) => r.score)).toEqual([500, 300, 200]);
    const recent = (await s.http(`/api/rankings/${B}?sort=new`)).body;
    expect(recent[0].score).toBe(500);
    expect(recent.at(-1).score).toBe(300);
  });

  it("시크릿: 보낸 이름 대신 「익명」, 회원 표시 없음", async () => {
    expect(await status("h2", B, { ...row, name: "진짜이름", secret: true })).toBe(200);
    const mine = (await s.http(`/api/rankings/${B}?sort=new`)).body[0];
    expect(mine).toMatchObject({ name: "익명", secret: true, avatar: null });
    expect(mine.member).toBeUndefined();
    expect(mine.uid).toBeUndefined();
  });

  it("시크릿은 허용한 랭킹에서만 (다른 랭킹은 secret 필드로 거절)", async () => {
    expect(await status("h3", "score", { name: "멜론", score: 10, secret: true }, 600)).toBe(200);
    const melon = (await s.http("/api/rankings/score")).body.find((r: { name: string }) => r.name === "멜론");
    expect(melon?.secret).toBeUndefined();
  });
});

describe("랭킹: 니들이 한글을 알아? 👍 웃겨요", () => {
  const B = "hangul_rankings";
  const row = { name: "웃음", score: 100, wave: 1, best: "", bestPts: 0 };
  const like = async (uid: string, id: string, on = true) =>
    s.http(`/api/rankings/${B}/${id}/like`, { method: "POST", token: await s.token(uid), body: { on } });

  it("한 사람 한 번 · 취소 · 내 문장은 못 누름 · 웃긴순은 👍 받은 것만", async () => {
    expect(await status("k1", B, { ...row, score: 111 })).toBe(200);
    expect(await status("k2", B, { ...row, score: 222 })).toBe(200);
    const all = (await s.http(`/api/rankings/${B}?sort=new&limit=100`)).body;
    const a = all.find((r: { score: number }) => r.score === 111).id;
    const b = all.find((r: { score: number }) => r.score === 222).id;

    expect((await like("k1", a)).status).toBe(400); // 내 문장
    expect((await like("k2", a)).body.likes).toBe(1);
    expect((await like("k2", a)).body.likes).toBe(1); // 두 번 눌러도 1
    expect((await like("k3", a)).body.likes).toBe(2);
    expect((await like("k3", b)).body.likes).toBe(1);
    expect((await like("k3", a, false)).body.likes).toBe(1); // 취소
    expect((await like("k3", a, false)).body.likes).toBe(1); // 없는 걸 또 취소해도 그대로
    expect((await like("k2", "nope")).status).toBe(404);

    const fun = (await s.http(`/api/rankings/${B}?sort=fun`)).body;
    expect(fun.map((r: { id: string }) => r.id)).toEqual([b, a]); // 1개씩이면 점수 높은 순
    const mine = (await s.http(`/api/rankings/${B}/liked?ids=${a},${b}`, { token: await s.token("k2") })).body;
    expect(mine).toEqual([a]);
  });
});

describe("니들이 한글을 알아? 사전 신고", () => {
  it("같은 말은 한 줄로, 같은 사람은 한 번만 셈", async () => {
    // 판정 모델이 없는 테스트 환경에서도 신고는 받음 (형태소 칸만 비어 있음)
    for (let k = 0; k < 2; k++)
      expect((await s.http("/api/hangul/report", { method: "POST", body: { text: "애미없다" } })).status).toBe(200);
    expect((await s.http("/api/hangul/report", { method: "POST", body: { text: "abc" } })).status).toBe(400);
    const d = await s.db.col("hangul_reports").findOne({ _id: "애미없다" });
    expect(d).toMatchObject({ text: "애미없다", count: 1 });
  });
});
