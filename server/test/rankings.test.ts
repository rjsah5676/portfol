import { readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chessScore, janggiScore, omokScore } from "../../web/src/lib/aiScore";
import { kstDay } from "../../web/src/lib/suspect/engine";
import { dailySeed as cfSeed, generate as cfGenerate } from "../../web/src/lib/casefile/engine";
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
      : board.startsWith("casefile:")
        ? `/api/rankings/casefile/${board.slice(9)}`
        : board.startsWith("pixelmerge:")
          ? `/api/rankings/pixelmerge/${board.slice(11)}`
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
  const row = { name: "탐정", time: 100, miss: 1, hint: 1, score: 280 };

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
    expect(await status("d2", today, { ...row, score: 100 })).toBe(400); // 시간+실수120+힌트60 과 다름
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

  it("회원이 처음 올리면 난이도별 GP (어려움 500) · 사건마다 한 번 · 랭킹을 지우고 다시 올려도 또 안 줌", async () => {
    const hard = `suspect:${kstDay()}_hard`;
    const token = await s.token("gp1", { email: "gp1@example.com" });
    expect((await s.http("/api/me/nick", { method: "PUT", token, body: { nick: "탐정gp" } })).status).toBe(200);
    const before = Number((await s.db.col("users").findOne({ _id: "gp1" }))?.points ?? 0);
    // 회원(이메일 로그인)으로 올리기 — play() 는 익명 토큰이라 따로
    const memberPlay = async () =>
      s.http(pathOf(hard), { method: "POST", token, body: { ...row, ticket: await ticket("gp1", hard, 600) } });
    const first = await memberPlay();
    expect(first.body).toMatchObject({ gp: 500 });
    expect((await memberPlay()).body.gp).toBeUndefined(); // 이미 올림 (kept)
    const admin = await s.adminToken();
    const del = await s.http("/api/admin/suspect/rankings/reset", {
      method: "POST",
      token: admin,
      body: { confirm: "데일리 랭킹 초기화", day: kstDay() },
    });
    expect(del.body.deleted).toBeGreaterThan(0);
    const again = await memberPlay();
    expect(again.status).toBe(200);
    expect(again.body.gp).toBeUndefined(); // 원장에 있어서 또 안 줌
    expect(Number((await s.db.col("users").findOne({ _id: "gp1" }))?.points ?? 0)).toBe(before + 500);
    // 비회원은 GP 없이 등록만
    expect((await play("gp2", `suspect:${kstDay()}_easy`, row)).body.gp).toBeUndefined();
  });

  it("사건 요약(푼 사람 · 완벽 · 중간 기록 · 내 순위) · 누적 랭킹(해결 수 · 1위 횟수)", async () => {
    const big = (d: number) => `suspect:${kstDay(Date.now(), d)}_big`;
    const fast = { name: "빠름", time: 60, miss: 0, hint: 0, score: 60 };
    const slow = { name: "느림", time: 100, miss: 1, hint: 0, score: 220 };
    expect(await status("h1", big(0), fast)).toBe(200);
    expect(await status("h2", big(0), slow)).toBe(200);
    expect(await status("h1", big(-1), slow)).toBe(200);
    expect(await status("h3", big(-1), fast)).toBe(200);
    expect(await status("h1", big(1), slow)).toBe(200);

    const sum = (await s.http(`${pathOf(big(0))}/summary`, { token: await s.token("h2") })).body;
    expect(sum).toMatchObject({ total: 2, perfect: 1, median: 60, avgMiss: 0.5, me: { pos: 2, score: 220 } });
    expect((await s.http(`${pathOf(big(0))}/summary`)).body.me).toBeNull(); // 로그인 안 하면 내 기록 없음
    expect((await s.http(`/api/rankings/suspect/${kstDay()}_easy/summary`)).body.total).toBeGreaterThanOrEqual(0);
    expect((await s.http("/api/rankings/suspect/today_big/summary")).status).toBe(400);

    const hall = (await s.http("/api/rankings/suspect-hall?tier=big", { token: await s.token("h3") })).body;
    expect(hall).toMatchObject({ players: 3, cases: 3, solves: 5, me: { pos: 2, solved: 1, wins: 1 } });
    expect(hall.rows.map((r: { name: string; solved: number; wins: number }) => [r.name, r.solved, r.wins])).toEqual([
      ["느림", 3, 2], // h1: 마지막 이름 · 3건 중 오늘 · 내일 1위
      ["빠름", 1, 1],
      ["느림", 1, 0],
    ]);
    expect(hall.rows[1].me).toBe(true);
    expect(hall.rows[0].uid).toBeUndefined(); // 누구 기록인지는 안 내보냄
    const wins = (await s.http("/api/rankings/suspect-hall?tier=big&sort=wins")).body;
    expect(wins.rows.map((r: { wins: number }) => r.wins)).toEqual([2, 1, 0]);
    expect(wins.me).toBeNull();
    // 새 기록이 올라오면 캐시를 비워서 바로 반영
    expect(await status("h4", big(0), slow)).toBe(200);
    expect((await s.http("/api/rankings/suspect-hall?tier=big")).body.players).toBe(4);
  });

  it("관리자 데일리 초기화 · 랭킹 초기화는 확인 문구가 맞아야 · 관리자만", async () => {
    const admin = await s.adminToken();
    expect((await s.http("/api/suspect/reset")).body).toMatchObject({ at: expect.any(Number) });
    const bad = await s.http("/api/admin/suspect/reset", { method: "POST", token: admin, body: { confirm: "x" } });
    expect(bad.status).toBe(400);
    const notAdmin = await s.http("/api/admin/suspect/reset", {
      method: "POST",
      token: await s.token("d9"),
      body: { confirm: "데일리 초기화" },
    });
    expect(notAdmin.status).toBe(403);
    const ok = await s.http("/api/admin/suspect/reset", { method: "POST", token: admin, body: { confirm: "데일리 초기화" } });
    expect(ok.body.at).toBeGreaterThan(0);
    expect((await s.http("/api/suspect/reset")).body.at).toBe(ok.body.at);
    const all = await s.http("/api/admin/suspect/rankings/reset", {
      method: "POST",
      token: admin,
      body: { confirm: "데일리 랭킹 초기화", day: "all" },
    });
    expect(all.status).toBe(200);
    expect((await s.http("/api/admin/suspect/stats", { token: admin })).body).toEqual({ today: 0, total: 0 });
    // 랭킹 초기화는 그 날짜 판 진행 초기화도 같이 남김 (브라우저가 따라 지움) — 최근 것부터
    const day = await s.http("/api/admin/suspect/rankings/reset", {
      method: "POST",
      token: admin,
      body: { confirm: "데일리 랭킹 초기화", day: kstDay() },
    });
    const r = (await s.http("/api/suspect/reset")).body;
    expect(r.at).toBe(day.body.at);
    expect(r.resets.slice(0, 3).map((x: { day: string }) => x.day)).toEqual([kstDay(), "all", "all"]);
  });
});

describe("랭킹: 오늘의 사건 파일", () => {
  const c = `${kstDay()}_easy`;
  const board = `casefile:${c}`;
  const C = cfGenerate(cfSeed(kstDay(), "easy"), "easy");
  const answer = { cell: C.pos, it: C.item };
  const row = { name: "형사", time: 100, wrong: 1, score: 220 };

  it("동선표가 정답이어야 등록 · 정답은 랭킹에 안 남음 · 첫 기록만", async () => {
    // 틀린 동선표 (물건 둘을 바꿈)
    const it2 = C.item.slice();
    [it2[0], it2[1]] = [it2[1], it2[0]];
    expect(await status("cf1", board, { ...row, cell: C.pos, it: it2 })).toBe(400);
    expect(await status("cf1", board, row)).toBe(400); // 동선표 없음
    expect(await status("cf1", board, { ...row, ...answer })).toBe(200);
    expect(await status("cf1", board, { ...row, time: 50, wrong: 0, score: 50, ...answer })).toBe(200);
    const { body } = await s.http(pathOf(board));
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject(row);
    expect(body[0].cell).toBeUndefined();
    expect(body[0].it).toBeUndefined();
  });

  it("점수 계산 · 시간이 안 맞으면 거절 · 지난 사건은 거절", async () => {
    expect(await status("cf2", board, { ...row, score: 100, ...answer })).toBe(400);
    expect(await status("cf2", board, { ...row, ...answer }, 20)).toBe(400);
    expect(await status("cf2", "casefile:20200101_easy", { ...row, ...answer })).toBe(400);
  });

  it("요약 · 내 순위, 회원은 처음 풀면 GP (쉬움 200) 한 번만", async () => {
    expect(await status("cf3", board, { ...row, time: 300, score: 420, ...answer })).toBe(200);
    const sum = (await s.http(`${pathOf(board)}/summary`, { token: await s.token("cf3") })).body;
    expect(sum).toMatchObject({ total: 2, clean: 0, avgWrong: 1, me: { pos: 2, score: 420, wrong: 1 } });

    const token = await s.token("cfgp", { email: "cfgp@example.com" });
    expect((await s.http("/api/me/nick", { method: "PUT", token, body: { nick: "형사gp" } })).status).toBe(200);
    const memberPlay = async () =>
      s.http(pathOf(board), { method: "POST", token, body: { ...row, ...answer, ticket: await ticket("cfgp", board, 600) } });
    expect((await memberPlay()).body).toMatchObject({ gp: 200 });
    expect((await memberPlay()).body.gp).toBeUndefined();
  });
});

describe("랭킹: 픽셀 머지", () => {
  const day = `pixelmerge:${kstDay()}`;
  const row = { name: "머지", score: 1500, drops: 60, maxTier: 7, time: 120 };

  it("가장 높은 점수만 · 말이 안 되는 점수 · 지난 날 거절", async () => {
    expect(await status("pm1", day, row)).toBe(200);
    expect(await status("pm1", day, { ...row, score: 900 })).toBe(200); // 더 낮으면 그대로
    expect(await status("pm1", day, { ...row, score: 2100, drops: 80, time: 160 })).toBe(200);
    const { body } = await s.http(pathOf(day));
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ score: 2100, drops: 80 });
    expect(await status("pm2", day, { ...row, score: 60 * 80 + 301 })).toBe(400); // 공 하나에 80점 넘게
    expect(await status("pm2", day, { ...row, drops: 400 })).toBe(400); // 120초에 공 400개
    expect(await status("pm2", day, row, 30)).toBe(400); // 120초 판을 30초 만에
    expect(await status("pm2", "pixelmerge:20200101", row)).toBe(400);
    expect(await status("pm2", "pixelmerge:endless", row)).toBe(200);
  });

  it("요약 · 내 순위, 회원은 오늘의 판을 그날 처음 올리면 GP 300 (무한 모드는 없음)", async () => {
    expect(await status("pm3", day, { ...row, score: 700, maxTier: 10 })).toBe(200);
    const sum = (await s.http(`${pathOf(day)}/summary`, { token: await s.token("pm3") })).body;
    expect(sum).toMatchObject({ total: 2, trophy: 1, me: { pos: 2, score: 700, maxTier: 10 } });

    const token = await s.token("pmgp", { email: "pmgp@example.com" });
    expect((await s.http("/api/me/nick", { method: "PUT", token, body: { nick: "머지gp" } })).status).toBe(200);
    const play = async (b: string) =>
      s.http(pathOf(b), { method: "POST", token, body: { ...row, ticket: await ticket("pmgp", b, 600) } });
    expect((await play("pixelmerge:endless")).body.gp).toBeUndefined();
    expect((await play(day)).body).toMatchObject({ gp: 300 });
    expect((await play(day)).body.gp).toBeUndefined();
  });
});
