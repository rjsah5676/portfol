import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REVIVE, START_MONEY, TIERS, kstDay } from "../../web/src/lib/poker/rules";
import type { HoldemView, MyHand, SevenView, TableWire, Wallet } from "../../web/src/lib/poker/types";
import { RpcError, sleep, startTestServer, type TestClient, type TestServer, type TestSub } from "./helpers";

/*
 * 포커 테이블 통합 테스트: 회원 전용 · 자금(1억 지급, 회생, 입장컷) · 판 진행과 정산 · 내 패가 남에게 안 새는지.
 * 봇의 생각 시간과 카드 까는 뜸은 테스트 서버에서 거의 0 (helpers.ts).
 */

let srv: TestServer;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(async () => {
  await srv.close();
});

let n = 0;
/** 가입한 회원의 소켓 */
async function member(nick?: string): Promise<{ uid: string; nick: string; token: string; c: TestClient }> {
  const uid = `pk${++n}_${Math.random().toString(36).slice(2, 8)}`;
  const email = `${uid}@example.com`;
  const name = nick ?? `포커${n}`;
  const token = await srv.token(uid, { email });
  const r = await srv.http("/api/me/nick", { method: "PUT", token, body: { nick: name } });
  expect(r.status).toBe(200);
  return { uid, nick: name, token, c: await srv.client(uid, { email }) };
}

const users = () => srv.db.col("users");
const moneyOf = async (uid: string) => ((await users().findOne({ _id: uid })) as { money?: number } | null)?.money;
const setMoney = (uid: string, money: number, extra: Record<string, unknown> = {}) => users().updateOne({ _id: uid }, { $set: { money, ...extra } });
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof RpcError ? e.code : `THROWN:${String(e)}`;
  }
};

interface Player {
  table: TestSub<{ table: TableWire } | null>;
  me: TestSub<MyHand | null>;
  /** 마지막으로 받은 테이블 상태 */
  state(): TableWire | null;
  myCards(): MyHand | null;
  stop(): void;
}

/**
 * 테이블에 앉아서 자동으로 침. policy 가 그 차례의 행동을 정함 (기본: 체크, 싸면 콜, 비싸면 죽음).
 * 받은 상태는 전부 seen 에 쌓임.
 */
async function play(
  who: { uid: string; c: TestClient },
  id: string,
  policy: (t: TableWire, seat: number) => Record<string, unknown> | null = () => null,
  seen: TableWire[] = []
): Promise<Player> {
  const table = await who.c.sub<{ table: TableWire } | null>("poker.table", { id });
  const me = await who.c.sub<MyHand | null>("poker.me", { id });
  let cur: TableWire | null = table.data?.table ?? null;
  let mine: MyHand | null = me.data;
  let stopped = false;
  let acted = "";
  const react = () => {
    if (stopped || !cur?.hand) return;
    const t = cur;
    const seat = t.seats.find((s) => s?.uid === who.uid)?.seat;
    if (seat === undefined) return;
    const h = t.hand!;
    let input: Record<string, unknown> | null = null;
    let mark = "";
    if (h.game === "seven" && h.phase === "choice") {
      if (h.players[seat] && !h.players[seat].chosen && !h.players[seat].folded) {
        mark = `${t.handNo}:choice`;
        input = policy(t, seat) ?? { a: "choose", discard: 0, open: 1 };
      }
    } else if (h.toAct === seat && !h.result) {
      mark = `${t.handNo}:${t.seq}`;
      // 기본: 체크, 싸면 콜, 비싸면(내 칩의 3% 초과) 죽음 — 봇의 올인을 다 받아 주다 파산하지 않게
      const lg = h.legal!;
      const cheap = lg.toCall <= (t.seats[seat]?.stack ?? 0) * 0.03;
      input = policy(t, seat) ?? { a: lg.canCheck ? "check" : cheap ? "call" : h.game === "seven" ? "die" : "fold" };
    }
    if (!input || mark === acted) return;
    acted = mark;
    who.c.rpc("poker.act", { id, hand: t.handNo, ...input }).catch(() => {});
  };
  const onEv = ({ k, t, d }: { k: string; t: string; d: any }) => {
    if (k === table.key && t === "state") {
      cur = d;
      if (d) seen.push(d);
      react();
    } else if (k === me.key && t === "hand") mine = d;
  };
  who.c.socket.on("ev", onEv);
  react();
  return {
    table,
    me,
    state: () => cur,
    myCards: () => mine,
    stop() {
      stopped = true;
      who.c.socket.off("ev", onEv);
    },
  };
}

async function until(cond: () => boolean | Promise<boolean>, what: string, timeoutMs = 15_000) {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`기다리다 시간 초과: ${what}`);
    await sleep(15);
  }
}

describe("회원 전용 · 자금", () => {
  it("가입하면 1억, 익명·별명 없는 계정은 이용 불가", async () => {
    const a = await member();
    expect(await moneyOf(a.uid)).toBe(START_MONEY);
    const w = await a.c.rpc<Wallet>("poker.wallet");
    expect(w).toMatchObject({ money: START_MONEY, reviveUsed: 0, table: null });

    const anon = await srv.client("anon-poker");
    expect(await code(anon.rpc("poker.quick", { game: "holdem", tier: 1 }))).toBe("MEMBERS_ONLY");
    expect(await code(anon.rpc("poker.wallet"))).toBe("MEMBERS_ONLY");
    // 로그인은 했지만 별명을 안 정한 계정
    const noNick = await srv.client("nonick-poker", { email: "nonick@example.com" });
    expect(await code(noNick.rpc("poker.create", { game: "holdem", tier: 1 }))).toBe("MEMBERS_ONLY");
    await expect(noNick.sub("poker.table", { id: "x" })).rejects.toMatchObject({ code: "MEMBERS_ONLY" });
    const out = await srv.client();
    expect(await code(out.rpc("poker.wallet"))).toBe("UNAUTHENTICATED");
  });

  it("예전에 가입해 money 가 없는 회원도 1억으로 시작", async () => {
    await users().insertOne({ _id: "old-member", nick: "옛회원", nickKey: "옛회원", email: "old@example.com", createdAt: new Date(), updatedAt: new Date() } as never);
    const c = await srv.client("old-member", { email: "old@example.com" });
    expect((await c.rpc<Wallet>("poker.wallet")).money).toBe(START_MONEY);
  });

  it("입장컷: 보유금액이 모자라면 못 앉음", async () => {
    const a = await member();
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 3, bots: 2 });
    await a.c.sub("poker.me", { id });
    const err = await a.c.rpc("poker.sit", { id }).catch((e) => e as RpcError);
    expect(err).toMatchObject({ code: "NEED_MONEY", data: { min: TIERS[2].min, money: START_MONEY } });
    expect((await a.c.rpc<Wallet>("poker.wallet")).table).toBeNull();
    await setMoney(a.uid, TIERS[2].min);
    expect(await a.c.rpc("poker.sit", { id })).toMatchObject({ seat: expect.any(Number) });
  });

  it("회생: 500만 미만일 때만, 하루 10번, 날짜가 바뀌면 다시", async () => {
    const a = await member();
    expect(await code(a.c.rpc("poker.revive"))).toBe("NOT_BROKE");
    await setMoney(a.uid, REVIVE.under - 10_000);
    const w = await a.c.rpc<Wallet>("poker.revive");
    expect(w).toMatchObject({ money: REVIVE.under - 10_000 + REVIVE.amount, reviveUsed: 1 });
    expect(await code(a.c.rpc("poker.revive"))).toBe("NOT_BROKE");

    // 동시에 여러 번 눌러도 한 번만
    await setMoney(a.uid, 0);
    const res = await Promise.all([1, 2, 3, 4, 5].map(() => code(a.c.rpc("poker.revive"))));
    expect(res.filter((x) => x === "OK")).toHaveLength(1);
    expect(await moneyOf(a.uid)).toBe(REVIVE.amount);

    // 오늘 10번을 다 씀
    await setMoney(a.uid, 0, { revive: { day: kstDay(Date.now()), n: REVIVE.perDay } });
    expect(await code(a.c.rpc("poker.revive"))).toBe("REVIVE_LIMIT");
    expect(await moneyOf(a.uid)).toBe(0);
    // 어제 기록이면 다시 받을 수 있음
    await setMoney(a.uid, 0, { revive: { day: kstDay(Date.now() - 86_400_000), n: REVIVE.perDay } });
    expect(await a.c.rpc<Wallet>("poker.revive")).toMatchObject({ money: REVIVE.amount, reviveUsed: 1 });
  });
});

describe("홀덤 테이블", () => {
  it("봇과 여러 판: 돈은 판이 끝날 때 증감만 반영되고 기록과 맞음, 남의 패는 안 보임", async () => {
    const a = await member();
    const b = await member();
    const id = await a.c.rpc<string>("poker.quick", { game: "holdem", tier: 2 });
    const seenA: TableWire[] = [];
    const pa = await play(a, id, undefined, seenA);
    const sa = await a.c.rpc<{ seat: number }>("poker.sit", { id });
    // 같은 단계로 바로 입장하면 사람이 있는 그 테이블로
    expect(await b.c.rpc("poker.quick", { game: "holdem", tier: 2 })).toBe(id);
    const pb = await play(b, id, (t, seat) => {
      // b 는 가끔 최소 레이즈
      const lg = (t.hand as HoldemView).legal!;
      return lg.canRaise && t.handNo % 2 === 0 && (t.hand as HoldemView).street === 0 ? { a: "raise", amt: lg.minTo } : null;
    });
    await b.c.rpc("poker.sit", { id });
    expect((await a.c.rpc<Wallet>("poker.wallet")).table).toBe(id);

    await until(() => (pa.state()?.handNo ?? 0) >= 6 && !!pa.state()?.hand?.result, "6판 진행", 40_000);
    pa.stop();
    pb.stop();
    await a.c.rpc("poker.leave", { id });
    await b.c.rpc("poker.leave", { id });
    // 판 도중에 나갔으면 그 판이 정산될 때까지 기다림
    await until(async () => (await a.c.rpc<Wallet>("poker.wallet")).table === null && (await b.c.rpc<Wallet>("poker.wallet")).table === null, "자리 비움");
    await sleep(200);

    // DB 의 돈 = 1억 + 핸드 기록의 증감 합
    const hands = (await srv.db.col("poker_hands").find({ table: id }).toArray()) as unknown as { no: number; who: { uid: string | null; delta: number }[] }[];
    expect(hands.length).toBeGreaterThanOrEqual(6);
    for (const who of [a, b]) {
      const sum = hands.reduce((s, h) => s + (h.who.find((w) => w.uid === who.uid)?.delta ?? 0), 0);
      expect(await moneyOf(who.uid)).toBe(START_MONEY + sum);
      const doc = (await users().findOne({ _id: who.uid })) as any;
      expect(doc.stats.poker.hands).toBe(hands.filter((h) => h.who.some((w) => w.uid === who.uid)).length);
      expect(doc.stats.poker.holdem.hands).toBe(doc.stats.poker.hands);
    }
    // 한 판의 증감 합은 0 (봇 포함)
    for (const h of hands) expect(h.who.reduce((s, w) => s + w.delta, 0)).toBe(0);

    // 공개 상태에는 쇼다운 전까지 누구의 패도 없음. 내 패는 나만 받는 구독으로만 옴
    expect(pa.myCards()?.cards).toHaveLength(2);
    expect(pa.myCards()?.seat).toBe(sa.seat);
    for (const t of seenA) {
      const h = t.hand as HoldemView | null;
      if (!h || h.result) continue;
      const anyAllIn = Object.values(h.players).some((p) => p.allIn);
      if (!anyAllIn) for (const p of Object.values(h.players)) expect(p.cards).toBeNull();
      expect(JSON.stringify(t)).not.toContain('"deck"');
    }
  }, 60_000);

  it("규칙 밖의 요청은 거절: 남의 차례 · 지난 판 · 가진 칩보다 큰 레이즈 · 다른 테이블 동시 착석", async () => {
    const a = await member();
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: 3 });
    let tried = false;
    const results: string[] = [];
    const pa = await play(a, id, (t, seat) => {
      // 거절 확인이 끝날 때까지는 내 차례를 그대로 둠
      if (tried) return results.length >= 7 ? null : { a: "noop" };
      tried = true;
      const h = t.hand as HoldemView;
      // 내 차례에 말도 안 되는 금액들을 먼저 보내 봄
      void (async () => {
        results.push(await code(a.c.rpc("poker.act", { id, hand: t.handNo, a: "raise", amt: h.legal!.maxTo + 10_000 })));
        results.push(await code(a.c.rpc("poker.act", { id, hand: t.handNo, a: "raise", amt: -5 })));
        results.push(await code(a.c.rpc("poker.act", { id, hand: t.handNo, a: "raise", amt: 1e30 })));
        results.push(await code(a.c.rpc("poker.act", { id, hand: t.handNo - 1, a: "fold" })));
        results.push(await code(a.c.rpc("poker.act", { id, hand: t.handNo, a: "win" })));
        results.push(await code(a.c.rpc("poker.act", { id, hand: t.handNo, a: "fold" })));
        results.push(await code(a.c.rpc("poker.act", { id, hand: t.handNo, a: "fold" })));
      })();
      void seat;
      return { a: "noop" };
    });
    await a.c.rpc("poker.sit", { id });
    await until(() => results.length === 7, "거절 확인");
    expect(results.slice(0, 5)).toEqual(["BAD_REQUEST", "BAD_REQUEST", "BAD_REQUEST", "STALE", "BAD_REQUEST"]);
    expect(results[5]).toBe("OK");
    expect(["NOT_YOUR_TURN", "FORBIDDEN", "STALE"]).toContain(results[6]);

    // 다른 테이블에 또 앉을 수 없음
    const other = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: 2 });
    expect(await code(a.c.rpc("poker.sit", { id: other }))).toBe("ALREADY_SEATED");
    // 앉지 않은 사람은 행동할 수 없고, 남의 패 구독은 자기 것만 나옴(없음)
    const x = await member();
    const t = pa.state()!;
    expect(await code(x.c.rpc("poker.act", { id, hand: t.handNo, a: "fold" }))).toBe("FORBIDDEN");
    expect((await x.c.sub("poker.me", { id })).data).toBeNull();
    pa.stop();
    await a.c.rpc("poker.leave", { id });
  }, 30_000);

  it("판 도중에 나가면 그 판은 죽은 것으로 정산되고, 정산 전에는 다른 테이블에 못 앉음", async () => {
    const a = await member();
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 2, bots: 3 });
    let left = false;
    const pa = await play(a, id, (t) => {
      const h = t.hand as HoldemView;
      // 한 번 콜해서 돈을 넣은 뒤, 다음 차례에 나감
      if (!left && h.legal!.toCall === 0 && h.street > 0) {
        left = true;
        void a.c.rpc("poker.leave", { id });
        return { a: "noop" };
      }
      return null;
    });
    await a.c.rpc("poker.sit", { id });
    await until(() => left, "나가기", 30_000);
    await until(async () => (await a.c.rpc<Wallet>("poker.wallet")).table === null, "정산 뒤 자리 비움");
    await sleep(150);
    const hands = (await srv.db.col("poker_hands").find({ table: id }).toArray()) as unknown as { who: { uid: string | null; delta: number }[] }[];
    const sum = hands.reduce((s, h) => s + (h.who.find((w) => w.uid === a.uid)?.delta ?? 0), 0);
    expect(await moneyOf(a.uid)).toBe(START_MONEY + sum);
    pa.stop();
  }, 40_000);

  it("입장컷 밑으로 떨어지면 판이 끝난 뒤 자리에서 내려옴", async () => {
    const a = await member();
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 2, bots: 3 });
    const seen: TableWire[] = [];
    const pa = await play(a, id, () => ({ a: "fold" }), seen);
    await a.c.rpc("poker.sit", { id });
    await until(() => (pa.state()?.handNo ?? 0) >= 1, "첫 판");
    // 판 사이에 돈이 입장컷 아래로 (관리자가 고쳤다고 치고)
    await setMoney(a.uid, TIERS[1].min - 10_000);
    await until(() => seen.some((t) => t.ev.some((e) => e.t === "leave" && e.why === "cut")), "입장컷 미달로 내려옴", 30_000);
    expect((await a.c.rpc<Wallet>("poker.wallet")).table).toBeNull();
    pa.stop();
  }, 40_000);

  it("시간 초과: 체크할 수 있으면 체크, 아니면 폴드. 두 번 이어지면 자리 비움", async () => {
    const quick = await startTestServer({ poker: { actMs: 120, speed: 0.004, sweepIntervalMs: 100 } });
    try {
      const uid = "slow-member";
      const token = await quick.token(uid, { email: "slow@example.com" });
      await quick.http("/api/me/nick", { method: "PUT", token, body: { nick: "느림보" } });
      const c = await quick.client(uid, { email: "slow@example.com" });
      const id = await c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: 3 });
      const sub = await c.sub<{ table: TableWire }>("poker.table", { id });
      await c.sub("poker.me", { id });
      await c.rpc("poker.sit", { id });
      const ev = await sub.wait((e) => e.t === "state" && e.d?.seats.some((s: any) => s?.uid === uid && s.status === "out"), 20_000);
      expect(ev.d.seats.find((s: any) => s?.uid === uid).status).toBe("out");
      // 돌아오면(이제부터는 제때 침) 다음 판부터 다시 참가
      const back = await play({ uid, c }, id);
      await c.rpc("poker.sitout", { id, out: false });
      await until(() => back.state()?.seats.find((s) => s?.uid === uid)?.status === "in" && (back.state()?.handNo ?? 0) > ev.d.handNo, "다시 참가", 20_000);
      back.stop();
    } finally {
      await quick.close();
    }
  }, 60_000);
});

describe("7포커 테이블", () => {
  it("카드 고르기 → 4~7구 베팅 → 쇼다운, 정산이 기록과 맞음", async () => {
    const a = await member();
    const id = await a.c.rpc<string>("poker.quick", { game: "seven", tier: 1 });
    const seen: TableWire[] = [];
    const mine: MyHand[] = [];
    const pa = await play(
      a,
      id,
      (t) => {
        const h = t.hand as SevenView;
        if (h.phase === "choice") return { a: "choose", discard: 3, open: 0 };
        // 걸 수 있으면 삥, 아니면 콜/체크
        if (h.legal!.bets.bbing && t.handNo % 2 === 1) return { a: "bbing" };
        return null;
      },
      seen
    );
    a.c.socket.on("ev", ({ k, t, d }: any) => k === pa.me.key && t === "hand" && mine.push(d));
    await a.c.rpc("poker.sit", { id });
    await until(() => seen.filter((t) => t.hand?.result?.showdown).length >= 2 && (pa.state()?.handNo ?? 0) >= 4, "쇼다운 두 번 이상", 60_000);
    pa.stop();
    await a.c.rpc("poker.leave", { id });
    await until(async () => (await a.c.rpc<Wallet>("poker.wallet")).table === null, "자리 비움");
    await sleep(200);

    const hands = (await srv.db.col("poker_hands").find({ table: id }).toArray()) as unknown as { who: { uid: string | null; delta: number }[] }[];
    for (const h of hands) expect(h.who.reduce((s, w) => s + w.delta, 0)).toBe(0);
    const sum = hands.reduce((s, h) => s + (h.who.find((w) => w.uid === a.uid)?.delta ?? 0), 0);
    expect(await moneyOf(a.uid)).toBe(START_MONEY + sum);
    expect(((await users().findOne({ _id: a.uid })) as any).stats.poker.seven.hands).toBeGreaterThanOrEqual(4);

    // 내 카드: 고르기 전 4장 → 고른 뒤 3장(엎은 2장 표시) → 구마다 한 장씩
    expect(mine.some((m) => m.cards.length === 4 && !m.down)).toBe(true);
    expect(mine.some((m) => m.cards.length === 3 && m.down?.length === 2)).toBe(true);
    expect(mine.some((m) => m.cards.length === 7 && m.down?.length === 3)).toBe(true);
    // 공개 상태: 쇼다운 전에는 편 카드만, 구가 올라갈수록 한 장씩
    const mid = seen.find((t) => t.hand && !t.hand.result && (t.hand as SevenView).round === 6 && (t.hand as SevenView).phase === "bet");
    expect(mid).toBeTruthy();
    for (const p of Object.values((mid!.hand as SevenView).players)) {
      if (p.folded) continue;
      expect(p.up).toHaveLength(4);
      expect(p.down).toBe(2);
      expect(p.cards).toBeNull();
    }
    const end = seen.find((t) => t.hand?.result?.showdown)!;
    const winner = Number(Object.keys(end.hand!.result!.won)[0]);
    expect((end.hand as SevenView).players[winner].cards).toHaveLength(7);
    expect(end.hand!.result!.names[winner]).toBeTruthy();
  }, 90_000);
});

describe("순위 · 관리", () => {
  it("자금 순위는 한 판이라도 친 회원만, 보유금액 순", async () => {
    const fresh = await member("판안친사람");
    const r = await srv.http("/api/poker/rank");
    expect(r.status).toBe(200);
    const list = r.body.list as { nick: string; money: number; hands: number }[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((x) => x.nick === fresh.nick)).toBe(false);
    for (const x of list) expect(x.hands).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < list.length; i++) expect(list[i - 1].money).toBeGreaterThanOrEqual(list[i].money);
  });

  it("관리자: 열려 있는 테이블 목록과 닫기 (진행 중이던 판은 무효, 돈 그대로)", async () => {
    const a = await member();
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: 3, name: "닫힐방" });
    const pa = await play(a, id);
    await a.c.rpc("poker.sit", { id });
    await until(() => !!pa.state()?.hand && !pa.state()!.hand!.result, "판 진행 중");
    const before = await moneyOf(a.uid);
    const token = await srv.adminToken();
    const live = await srv.http("/api/admin/live", { token });
    expect(live.body.poker.some((r: any) => r.id === id && r.name.includes("닫힐방"))).toBe(true);
    const closed = await srv.http("/api/admin/live/close", { method: "POST", token, body: { game: "poker", id } });
    expect(closed.body.closed).toBe(true);
    await until(() => pa.state() === null, "테이블 닫힘");
    expect((await a.c.rpc<Wallet>("poker.wallet")).table).toBeNull();
    // 닫히기 전에 끝난 판만 반영됨 → 닫힌 뒤에는 더 안 바뀜
    await sleep(150);
    const after = await moneyOf(a.uid);
    await sleep(300);
    expect(await moneyOf(a.uid)).toBe(after);
    expect(typeof before).toBe("number");
    pa.stop();
  }, 30_000);
});
