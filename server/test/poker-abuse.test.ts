import { Collection } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { REVIVE, START_MONEY, TIERS, type GameKind } from "../../web/src/lib/poker/rules";
import type { HoldemLegal, HoldemView, LobbyTable, MyHand, SevenLegal, SevenView, TableWire, Wallet } from "../../web/src/lib/poker/types";
import { RpcError, sleep, startTestServer, type TestClient, type TestServer, type TestSub } from "./helpers";

/*
 * 포커 모듈 악용·혼란 테스트 (독립 검토용).
 *
 *  - 처음엔 실패하던(실제 결함을 보여 주던) 테스트들은 결함을 고친 뒤 회귀 테스트로 남겨 둠. "[한계]" 는 알고도 미룬 것(건너뜀)
 *  - 나머지는 설계상 지켜져야 하는 것들이 실제로 지켜지는지 확인하는 회귀 테스트 (통과)
 *
 * 테스트 DB 가 FerretDB 일 때의 주의: 같은 문서를 동시에 고치면 한쪽이 사라지고, 조건부 수정도 원자적이지 않음
 * (진짜 MongoDB 는 둘 다 원자적). 그래서 "동시에 눌러도 한 번만" 같은 확인은 FerretDB 에서는 건너뜀.
 *
 * 유저봇(bots: true 인 방)은 사람이 앉은 뒤에 하나씩 들어오고 수가 들쭉날쭉함. 봇이 끼어들면 안 되는 테스트는 bots: false 로 만듦.
 */

let srv: TestServer;

/** 서버가 찍은 오류·경고 (진행 오류, 정산 실패 등이 조용히 삼켜지지 않았는지 확인) */
const logs: string[] = [];
const pokerErrors = (from = 0) => logs.slice(from).filter((l) => /\[poker\]|\[gateway\]/.test(l) && !/시작 자금 채우기/.test(l));

/**
 * 정산 쓰기(users.bulkWrite)를 일부러 늦춤 — DB 가 느릴 때(원격 DB · 부하)의 순서 문제를 확실히 재현하려는 것.
 * 서버 코드는 그대로이고 드라이버의 응답만 늦어짐.
 */
let slowSettleMs = 0;
const origBulkWrite = Collection.prototype.bulkWrite;

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logs.push(a.map((x) => (x instanceof Error ? (x.stack ?? x.message) : typeof x === "string" ? x : JSON.stringify(x))).join(" ")));
  vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => void logs.push(a.map((x) => (x instanceof Error ? x.message : typeof x === "string" ? x : JSON.stringify(x))).join(" ")));
  (Collection.prototype as any).bulkWrite = async function (this: Collection, ...args: unknown[]) {
    if (slowSettleMs > 0 && this.collectionName === "users") await sleep(slowSettleMs);
    return (origBulkWrite as any).apply(this, args);
  };
  srv = await startTestServer();
});
afterAll(async () => {
  (Collection.prototype as any).bulkWrite = origBulkWrite;
  await srv.close();
});

// ───────────── 도우미 ─────────────

interface Member {
  uid: string;
  nick: string;
  email: string;
  token: string;
  c: TestClient;
}

let n = 0;
/** 가입한 회원의 소켓 */
async function member(s: TestServer = srv): Promise<Member> {
  const uid = `ab${++n}_${Math.random().toString(36).slice(2, 8)}`;
  const email = `${uid}@example.com`;
  const nick = `어뷰${n}`;
  const token = await s.token(uid, { email });
  const r = await s.http("/api/me/nick", { method: "PUT", token, body: { nick } });
  expect(r.status).toBe(200);
  return { uid, nick, email, token, c: await s.client(uid, { email }) };
}
/** 같은 회원의 다른 탭 */
const tab = (m: Member, s: TestServer = srv) => s.client(m.uid, { email: m.email });

const users = (s: TestServer = srv) => s.db.col("users");
/** 테스트 DB 가 FerretDB(몽고 호환 서버)인지 — 동시 요청의 원자성이 진짜 MongoDB 와 다름 */
async function isFerretDb(): Promise<boolean> {
  const info = (await srv.db.db.admin().command({ buildInfo: 1 })) as { ferretdb?: unknown; buildEnvironment?: Record<string, unknown> };
  return !!info.ferretdb || "go.version" in (info.buildEnvironment ?? {});
}
const moneyOf = async (uid: string, s: TestServer = srv) => ((await users(s).findOne({ _id: uid })) as { money?: number } | null)?.money;
const setMoney = (uid: string, money: number, s: TestServer = srv) => users(s).updateOne({ _id: uid }, { $set: { money } });
const walletOf = (m: Member) => m.c.rpc<Wallet>("poker.wallet");
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof RpcError ? e.code : `THROWN:${String(e)}`;
  }
};

async function until(cond: () => boolean | Promise<boolean>, what: string, timeoutMs = 15_000) {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`기다리다 시간 초과: ${what}`);
    await sleep(15);
  }
}

/** 재현 가능한 난수 */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

type Policy = (t: TableWire, seat: number) => Record<string, unknown> | null;

interface Player {
  table: TestSub<{ table: TableWire } | null>;
  me: TestSub<MyHand | null>;
  state(): TableWire | null;
  hands: MyHand[];
  stop(): void;
}

/** 기본 행동: 홀덤은 체크 · 싸면 콜 · 비싸면 폴드. 7포커는 체크가 없으니 받을 돈이 없으면 삥, 싸면 콜, 비싸면 다이 */
function cheapAction(t: TableWire, seat: number): Record<string, unknown> {
  const h = t.hand!;
  const cheap = h.legal!.toCall <= (t.seats[seat]?.stack ?? 0) * 0.03;
  if (h.game === "seven") {
    const lg = h.legal as SevenLegal;
    if (lg.toCall > 0) return { a: cheap ? "call" : "die" };
    return { a: lg.bets.bbing !== undefined ? "bbing" : "die" };
  }
  const lg = h.legal as HoldemLegal;
  return { a: lg.canCheck ? "check" : cheap ? "call" : "fold" };
}
/** 7포커에서 받을 돈이 없을 때의 가장 싼 행동 (체크가 없음) */
const bbingOrDie = (h: SevenView) => ({ a: h.legal!.bets.bbing !== undefined ? "bbing" : "die" });

/** 테이블을 보면서 자동으로 침 (poker.test.ts 의 play 와 같은 방식). 기본: cheapAction */
async function play(who: { uid: string; c: TestClient }, id: string, policy: Policy = () => null, seen: TableWire[] = []): Promise<Player> {
  const table = await who.c.sub<{ table: TableWire } | null>("poker.table", { id });
  const me = await who.c.sub<MyHand | null>("poker.me", { id });
  let cur: TableWire | null = table.data?.table ?? null;
  const hands: MyHand[] = me.data ? [me.data] : [];
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
      if (mark === acted) return;
      input = policy(t, seat) ?? cheapAction(t, seat);
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
    } else if (k === me.key && t === "hand") hands.push(d);
  };
  who.c.socket.on("ev", onEv);
  react();
  return {
    table,
    me,
    state: () => cur,
    hands,
    stop() {
      stopped = true;
      who.c.socket.off("ev", onEv);
    },
  };
}

interface Audit {
  no: number;
  who: { seat: number; uid: string | null; delta: number }[];
  hand: { board?: number[]; players: { seat: number; cards: number[]; dealt?: number[]; up?: boolean[]; folded: boolean; start: number; end: number }[] };
}
const auditsOf = async (id: string, s: TestServer = srv) => (await s.db.col("poker_hands").find({ table: id }).toArray()) as unknown as Audit[];
const deltaSum = (hands: Audit[], uid: string) => hands.reduce((sum, h) => sum + (h.who.find((w) => w.uid === uid)?.delta ?? 0), 0);

/** 그 판을 시작할 때 들고 있던 칩 (판의 첫 상태에서: 남은 칩 + 이미 낸 돈) */
function startStack(states: TableWire[], uid: string, handNo: number): number | undefined {
  const t = states.find((x) => x.handNo === handNo && x.hand && x.ev.some((e) => e.t === "hand"));
  const seat = t?.seats.find((s) => s?.uid === uid);
  const p = seat && t!.hand!.players[seat.seat];
  return seat && p ? seat.stack + p.invested : undefined;
}

/** 모두 자리에서 일어나고, 정산이 DB 에 반영될 때까지 기다림 */
async function leaveAll(id: string, ms: Member[]) {
  for (const m of ms) await m.c.rpc("poker.leave", { id }).catch(() => {});
  await until(async () => (await Promise.all(ms.map(walletOf))).every((w) => w?.table !== id), "자리 비움", 20_000);
  await sleep(250 + slowSettleMs * 2);
}

// ───────────── 1. 회원 전용 ─────────────

describe("회원 전용", () => {
  it("익명·별명 없는 계정·비로그인은 로비 목록 말고는 아무것도 못 함", async () => {
    const a = await member();
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: true });
    const pa = await play(a, id);
    await a.c.rpc("poker.sit", { id });
    await until(() => (pa.state()?.handNo ?? 0) >= 1, "첫 판");
    const hand = pa.state()!.handNo;

    const anon = await srv.client("anon-abuse");
    const noNick = await srv.client("nonick-abuse", { email: "nonick-abuse@example.com" });
    const out = await srv.client();
    const calls: [string, unknown][] = [
      ["poker.create", { game: "holdem", tier: 1 }],
      ["poker.quick", { game: "holdem", tier: 1 }],
      ["poker.sit", { id }],
      ["poker.act", { id, hand, a: "fold" }],
      ["poker.chat", { id, text: "hi" }],
      ["poker.wallet", undefined],
      ["poker.revive", undefined],
      ["poker.sitout", { id, out: true }],
      ["poker.emote", { id, emote: "hi" }],
      ["poker.char", { char: "amy" }],
    ];
    for (const [m, args] of calls) {
      // sitout 은 자리가 있어야 하므로 FORBIDDEN 으로 막힘
      expect([m, await code(anon.rpc(m, args))]).toEqual([m, m === "poker.sitout" ? "FORBIDDEN" : "MEMBERS_ONLY"]);
      expect([m, await code(noNick.rpc(m, args))]).toEqual([m, m === "poker.sitout" ? "FORBIDDEN" : "MEMBERS_ONLY"]);
      expect([m, await code(out.rpc(m, args))]).toEqual([m, "UNAUTHENTICATED"]);
    }
    for (const who of [anon, noNick, out]) {
      for (const ch of ["poker.table", "poker.me", "poker.wallet"]) {
        const err = await who.sub(ch, { id }).catch((e) => e as RpcError);
        expect([ch, (err as RpcError).code]).toEqual([ch, who === out ? "UNAUTHENTICATED" : "MEMBERS_ONLY"]);
      }
      // 로비 목록은 누구나
      const lobby = await who.sub<LobbyTable[]>("poker.lobby");
      expect(lobby.data.some((t) => t.id === id)).toBe(true);
      // 목록에는 자리 수 같은 것만 (패·칩 없음)
      expect(Object.keys(lobby.data[0]).sort()).toEqual(["bots", "createdAt", "game", "id", "locked", "max", "name", "players", "tier"]);
    }
    // 아무 일도 일어나지 않았음
    expect(pa.state()!.seats.filter((s) => s?.uid).map((s) => s!.uid)).toEqual([a.uid]);
    expect(await srv.db.col("users").findOne({ _id: "anon-abuse" })).toBeNull();
    pa.stop();
    await leaveAll(id, [a]);
  }, 30_000);

  it("남의 패·지갑 구독 키는 만들 수 없음 (요청에 uid 를 넣어도 내 것만 나옴)", async () => {
    const a = await member();
    const b = await member();
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: true });
    const pa = await play(a, id);
    await a.c.rpc("poker.sit", { id });

    const got: { k: string; t: string }[] = [];
    b.c.socket.on("ev", (m: { k: string; t: string }) => got.push({ k: m.k, t: m.t }));
    const aKey = pa.me.key;
    const tries = [{ id }, { id, uid: a.uid }, { id: `${id}:${a.uid}` }, { id, key: aKey }, { id: aKey.slice("poker:me:".length) }];
    for (const p of tries) {
      const sub = await b.c.sub<MyHand | null>("poker.me", p).catch(() => null);
      if (!sub) continue;
      expect(sub.key).not.toBe(aKey);
      expect(sub.key.endsWith(`:${b.uid}`)).toBe(true);
      expect(sub.data).toBeNull();
    }
    const w = await b.c.sub<Wallet>("poker.wallet", { uid: a.uid, id: a.uid });
    expect(w.key).toBe(`poker:wallet:${b.uid}`);
    // 구독 키를 직접 대고 끊기·붙기를 시도해도 소용없음
    b.c.socket.emit("unsub", { k: aKey });
    await until(() => pa.hands.length >= 3, "a 가 패를 여러 번 받음", 30_000);
    expect(got.filter((m) => m.t === "hand")).toEqual([]);
    expect(got.some((m) => m.k === aKey)).toBe(false);
    pa.stop();
    await leaveAll(id, [a]);
  }, 40_000);
});

// ───────────── 2. 한 사람 한 자리 ─────────────

describe("한 사람은 한 자리만", () => {
  it("두 탭에서 동시에 앉아도 자리는 하나 (같은 테이블 · 다른 테이블)", async () => {
    const a = await member();
    const a2 = await tab(a);
    const x = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: false });
    // (한 사람이 새 테이블을 만들면 그 사람의 빈 테이블은 닫히므로, 나머지 테이블은 다른 사람이 만듦)
    const host = await member();
    const host2 = await member();
    const y = await host.c.rpc<string>("poker.create", { game: "seven", tier: 1, bots: false });
    const tx = await a.c.sub<{ table: TableWire }>("poker.table", { id: x });
    const ty = await a.c.sub<{ table: TableWire }>("poker.table", { id: y });
    const lastOf = (s: TestSub) => ([...s.events].reverse().find((e) => e.t === "state")?.d ?? s.data.table) as TableWire;
    const seatsOf = () => [lastOf(tx), lastOf(ty)].map((t) => t.seats.filter((s) => s?.uid === a.uid).length);

    for (let round = 0; round < 6; round++) {
      // 같은 테이블에 동시에
      const same = await Promise.all([code(a.c.rpc("poker.sit", { id: x })), code(a2.rpc("poker.sit", { id: x }))]);
      expect(same.filter((r) => r === "OK").length).toBeGreaterThanOrEqual(1);
      for (const r of same) expect(["OK", "BUSY"]).toContain(r);
      await sleep(30);
      expect(seatsOf()).toEqual([1, 0]);
      expect(await code(a2.rpc("poker.sit", { id: y }))).toBe("ALREADY_SEATED");
      await a.c.rpc("poker.leave", { id: x });

      // 서로 다른 테이블에 동시에
      const diff = await Promise.all([code(a.c.rpc("poker.sit", { id: x })), code(a2.rpc("poker.sit", { id: y }))]);
      expect(diff.filter((r) => r === "OK")).toHaveLength(1);
      expect(diff.filter((r) => r !== "OK")).toEqual(["ALREADY_SEATED"]);
      await sleep(30);
      expect(seatsOf().reduce((p, q) => p + q, 0)).toBe(1);
      const w = await walletOf(a);
      expect([x, y]).toContain(w.table);
      await a.c.rpc("poker.leave", { id: w.table });
      await a2.rpc("poker.leave", { id: w.table });
      expect((await walletOf(a)).table).toBeNull();
    }

    // 앉기에 실패(돈 모자람)한 뒤에도 "앉는 중" 예약이 남지 않음
    const vip = await host2.c.rpc<string>("poker.create", { game: "holdem", tier: 3, bots: false });
    expect(await code(a.c.rpc("poker.sit", { id: vip }))).toBe("NEED_MONEY");
    expect(await code(a.c.rpc("poker.sit", { id: x }))).toBe("OK");
    await a.c.rpc("poker.leave", { id: x });
    a2.close();
  }, 30_000);
});

// ───────────── 3. 돈 ─────────────

describe("돈", () => {
  it("회생: 여러 탭에서 동시에 눌러도 한 번만", async (ctx) => {
    // FerretDB 는 "조건이 맞을 때만 고침"(updateOne 의 필터)이 동시 요청에서 원자적이지 않아 이 확인을 할 수 없음 (진짜 MongoDB 에서만)
    if (await isFerretDb()) return ctx.skip();
    const a = await member();
    const tabs = await Promise.all([1, 2, 3, 4, 5, 6].map(() => tab(a)));
    for (let i = 0; i < 3; i++) {
      await setMoney(a.uid, REVIVE.under - 1);
      const res = await Promise.all(tabs.map((c) => code(c.rpc("poker.revive"))));
      expect(res.filter((r) => r === "OK")).toHaveLength(1);
      expect(res.filter((r) => r !== "OK").every((r) => r === "NOT_BROKE")).toBe(true);
      expect(await moneyOf(a.uid)).toBe(REVIVE.under - 1 + REVIVE.amount);
    }
    expect((await walletOf(a)).reviveUsed).toBe(3);
    tabs.forEach((c) => c.close());
  });

  it("판 도중에는 회생을 받을 수 없고(조건 미달), 판 중의 칩은 DB 금액과 무관하게 그대로", async () => {
    const a = await member();
    await setMoney(a.uid, TIERS[0].min);
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: true });
    let tried = null as Promise<string> | null;
    const seen: TableWire[] = [];
    const pa = await play(
      a,
      id,
      () => {
        tried ??= code(a.c.rpc("poker.revive"));
        return null;
      },
      seen
    );
    await a.c.rpc("poker.sit", { id });
    await until(() => !!tried, "판 도중 회생 시도");
    expect(await tried).toBe("NOT_BROKE");
    pa.stop();
    await leaveAll(id, [a]);
    expect(await moneyOf(a.uid)).toBe(TIERS[0].min + deltaSum(await auditsOf(id), a.uid));
  }, 30_000);

  it("money 필드가 없는 예전 회원이 한 판을 쳐도 1억에서 증감만 반영됨", async () => {
    // 서버가 뜬 뒤에 생긴 "money 없는 회원" (가져오기 스크립트 · 서버 시작 때 채우기 실패 등). 지갑은 1억으로 보여 줌
    const uid = `legacy_${Math.random().toString(36).slice(2, 8)}`;
    const email = `${uid}@example.com`;
    await users().insertOne({ _id: uid, nick: "옛날회원", nickKey: "옛날회원", email, createdAt: new Date(), updatedAt: new Date() } as never);
    const c = await srv.client(uid, { email });
    const a: Member = { uid, email, nick: "옛날회원", token: "", c };
    expect((await walletOf(a)).money).toBe(START_MONEY);

    const id = await c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: true });
    const seen: TableWire[] = [];
    const pa = await play(a, id, () => ({ a: "fold" }), seen);
    await c.rpc("poker.sit", { id });
    await until(() => seen.some((t) => t.handNo >= 1 && !!t.hand?.result), "한 판 끝", 20_000);
    // 앉을 때는 1억을 들고 앉았음
    expect(startStack(seen, uid, 1)).toBe(START_MONEY);
    pa.stop();
    await leaveAll(id, [a]);
    const hands = await auditsOf(id);
    expect(hands.length).toBeGreaterThanOrEqual(1);
    // 기대: 1억 + 증감. 실제: $inc 가 없는 필드에 적용돼 "증감"만 남음 (1억이 사라짐)
    expect(await moneyOf(uid)).toBe(START_MONEY + deltaSum(hands, uid));
  }, 40_000);

  /**
   * 정산(DB 쓰기)이 끝나기 전에 자리가 먼저 비워짐 → 그 틈에 다른 테이블에 앉으면 "정산 전 금액"을 칩으로 받음.
   * 그 칩을 잃으면 DB 가 음수가 되고 0 으로 올려 주므로, 없던 돈이 생김 (공모자에게 넘기면 그대로 남음).
   */
  it("판을 잃고 나간 직후(정산 반영 전) 다른 테이블에 앉아도, 잃기 전 금액으로 칩을 받지 못함", async () => {
    const [a, b, c] = [await member(), await member(), await member()];
    const X = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: false });
    const Y = await c.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: false });
    const LOSS = 50_000_000;
    const BIG = 99_000_000;
    const seenX: TableWire[] = [];
    const seenY: TableWire[] = [];
    let sitY: string | undefined;
    let jumped = false;

    slowSettleMs = 300;
    try {
      // Y: c 가 기다리고 있음. c 는 프리플랍에 9,900만까지 올리고, a 는 받은 뒤 다음 차례에 죽음
      const pc = await play(c, Y, (t) => {
        const h = t.hand as HoldemView;
        const lg = h.legal!;
        if (h.street === 0 && lg.canRaise && h.currentBet < BIG) return { a: "raise", amt: Math.min(BIG, lg.maxTo) };
        return { a: lg.toCall > 0 ? "call" : "check" };
      });
      await c.c.rpc("poker.sit", { id: Y });
      const paY = await play(
        a,
        Y,
        (t, seat) => {
          const h = t.hand as HoldemView;
          if (h.legal!.toCall > 0) return { a: "call" };
          return { a: h.players[seat].invested >= BIG ? "fold" : "check" };
        },
        seenY
      );

      // X: b 가 5,000만까지 올리고 a 가 받음. 그다음 a 차례에 a 는 나가면서(=죽음, 5,000만 잃음) 곧바로 Y 에 앉음
      const pb = await play(b, X, (t) => {
        const h = t.hand as HoldemView;
        const lg = h.legal!;
        if (h.street === 0 && lg.canRaise && h.currentBet < LOSS) return { a: "raise", amt: LOSS };
        return { a: lg.toCall > 0 ? "call" : "check" };
      });
      const paX = await play(
        a,
        X,
        (t, seat) => {
          const h = t.hand as HoldemView;
          if (h.legal!.toCall > 0) return { a: "call" };
          if (h.players[seat].invested >= LOSS && !jumped) {
            jumped = true;
            void a.c.rpc("poker.leave", { id: X });
            void code(a.c.rpc("poker.sit", { id: Y })).then((r) => (sitY = r));
            return { a: "noop" };
          }
          return { a: "check" };
        },
        seenX
      );
      await b.c.rpc("poker.sit", { id: X });
      await a.c.rpc("poker.sit", { id: X });

      await until(() => sitY !== undefined, "X 에서 나가고 Y 에 앉기 시도", 20_000);
      if (sitY === "OK") await until(() => seenY.some((t) => t.handNo >= 1 && !!t.hand?.result), "Y 의 첫 판", 20_000);
      for (const p of [pc, paY, pb, paX]) p.stop();
      await leaveAll(X, [a, b]);
      await leaveAll(Y, [a, c]);
    } finally {
      slowSettleMs = 0;
    }
    await sleep(400);

    // a 는 X 에서 5,000만(+ 앤티)을 잃었음
    const lostAtX = -deltaSum(await auditsOf(X), a.uid);
    expect(lostAtX).toBe(LOSS + TIERS[0].ante);
    // Y 에서 판을 시작할 때의 칩은 그때 실제로 가진 돈(1억 − 5,000만)을 넘을 수 없음
    const stackAtY = startStack(seenY, a.uid, 1);
    if (stackAtY !== undefined) expect.soft(stackAtY, "Y 에서 판을 시작할 때 a 의 칩").toBeLessThanOrEqual(START_MONEY - LOSS);
    // 세 사람의 돈은 서로 주고받았을 뿐 → 합은 그대로 3억 (지금은 a 가 0 에서 멈추고 b · c 는 딴 만큼 받아서 돈이 생김)
    const total = (await Promise.all([a, b, c].map((m) => moneyOf(m.uid)))).reduce<number>((s, m) => s + (m ?? 0), 0);
    expect.soft(total, "세 사람 돈의 합").toBe(3 * START_MONEY);
    // 기록(핸드 로그)의 증감과 DB 가 맞음
    expect.soft(await moneyOf(a.uid), "a 의 돈 = 1억 + 기록의 증감").toBe(START_MONEY + deltaSum(await auditsOf(X), a.uid) + deltaSum(await auditsOf(Y), a.uid));
  }, 60_000);

  it("정산 반영이 늦어도, 같은 테이블에 나갔다 다시 앉는 것으로는 정산 전 금액을 칩으로 받지 못함", async () => {
    const [a, b] = [await member(), await member()];
    const X = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: false });
    const LOSS = 50_000_000;
    const seen: TableWire[] = [];
    let resat: string | undefined;
    slowSettleMs = 300;
    try {
      const pb = await play(b, X, (t) => {
        const h = t.hand as HoldemView;
        const lg = h.legal!;
        if (t.handNo === 1 && h.street === 0 && lg.canRaise && h.currentBet < LOSS) return { a: "raise", amt: LOSS };
        return { a: lg.toCall > 0 ? "call" : "check" };
      });
      const pa = await play(
        a,
        X,
        (t, seat) => {
          const h = t.hand as HoldemView;
          if (h.legal!.toCall > 0) return { a: "call" };
          if (t.handNo === 1 && h.players[seat].invested >= LOSS && resat === undefined) {
            resat = "";
            // 죽어서 판을 끝내고(정산 시작), 곧바로 나갔다가 다시 앉음
            void a.c.rpc("poker.act", { id: X, hand: t.handNo, a: "fold" });
            void a.c.rpc("poker.leave", { id: X });
            void code(a.c.rpc("poker.sit", { id: X })).then((r) => (resat = r));
            return { a: "noop" };
          }
          return { a: "check" };
        },
        seen
      );
      await b.c.rpc("poker.sit", { id: X });
      await a.c.rpc("poker.sit", { id: X });
      await until(() => !!resat, "다시 앉기", 20_000);
      expect(resat).toBe("OK");
      await until(() => seen.some((t) => t.handNo >= 2 && t.hand && t.ev.some((e) => e.t === "hand")), "둘째 판 시작", 20_000);
      expect(startStack(seen, a.uid, 1)).toBe(START_MONEY);
      // a 는 올린 5,000만과 앤티를 잃음
      expect(startStack(seen, a.uid, 2)).toBe(START_MONEY - LOSS - TIERS[0].ante);
      expect(startStack(seen, b.uid, 2)).toBe(START_MONEY + LOSS + TIERS[0].ante);
      pa.stop();
      pb.stop();
      await leaveAll(X, [a, b]);
    } finally {
      slowSettleMs = 0;
    }
    await sleep(400);
    const hands = await auditsOf(X);
    for (const m of [a, b]) expect(await moneyOf(m.uid)).toBe(START_MONEY + deltaSum(hands, m.uid));
    expect(((await moneyOf(a.uid)) ?? 0) + ((await moneyOf(b.uid)) ?? 0)).toBe(2 * START_MONEY);
  }, 60_000);

  it("관리자가 판 도중에 테이블을 닫으면 그 판은 무효 — 돈은 끝난 판의 증감만", async () => {
    const [a, b] = [await member(), await member()];
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: false });
    const token = await srv.adminToken();
    let closing = null as Promise<{ status: number; body: any }> | null;
    const policy: Policy = (t, seat) => {
      const h = t.hand as HoldemView;
      const lg = h.legal!;
      // 둘째 판: 둘 다 4,000만씩 넣은 뒤에 닫음
      if (t.handNo === 2 && h.players[seat].invested >= 40_000_000 && !closing) {
        closing = srv.http("/api/admin/live/close", { method: "POST", token, body: { game: "poker", id } });
        return { a: "noop" };
      }
      if (t.handNo === 2 && h.street === 0 && lg.canRaise && h.currentBet < 40_000_000) return { a: "raise", amt: 40_000_000 };
      return { a: lg.toCall > 0 ? "call" : "check" };
    };
    const pa = await play(a, id, policy);
    const pb = await play(b, id, policy);
    await a.c.rpc("poker.sit", { id });
    await b.c.rpc("poker.sit", { id });
    await until(() => !!closing, "둘째 판 도중에 닫기", 30_000);
    expect((await closing)!.body.closed).toBe(true);
    await until(() => pa.state() === null && pb.state() === null, "테이블 닫힘");
    await sleep(300);
    const hands = await auditsOf(id);
    expect(hands.map((h) => h.no)).toEqual([1]);
    for (const m of [a, b]) {
      expect(await moneyOf(m.uid)).toBe(START_MONEY + deltaSum(hands, m.uid));
      expect((await walletOf(m)).table).toBeNull();
      // 닫힌 테이블에는 아무 요청도 안 먹힘
      expect(await code(m.c.rpc("poker.act", { id, hand: 2, a: "fold" }))).toBe("NO_TABLE");
      expect(await code(m.c.rpc("poker.sit", { id }))).toBe("NO_TABLE");
    }
    // 다른 테이블에 바로 앉을 수 있음 (자리에 묶여 있지 않음)
    const other = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: false });
    expect(await code(a.c.rpc("poker.sit", { id: other }))).toBe("OK");
    await a.c.rpc("poker.leave", { id: other });
    pa.stop();
    pb.stop();
  }, 40_000);

  it("판 도중에 회원이 지워져도(관리자) 서버는 멀쩡하고, 그 사람은 죽은 것으로 처리되며 자리가 비워짐", async () => {
    const [a, b] = [await member(), await member()];
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: false });
    const token = await srv.adminToken();
    const from = logs.length;
    let removing = null as Promise<{ status: number; body: any }> | null;
    const seen: TableWire[] = [];
    const policy: Policy = (t, seat) => {
      const h = t.hand as HoldemView;
      const lg = h.legal!;
      if (h.players[seat].invested >= 30_000_000 && !removing) {
        removing = srv.http(`/api/admin/users/${a.uid}`, { method: "DELETE", token });
        return { a: "noop" };
      }
      if (h.street === 0 && lg.canRaise && h.currentBet < 30_000_000) return { a: "raise", amt: 30_000_000 };
      return { a: lg.toCall > 0 ? "call" : "check" };
    };
    const pa = await play(a, id, policy);
    const pb = await play(b, id, policy, seen);
    await a.c.rpc("poker.sit", { id });
    await b.c.rpc("poker.sit", { id });
    await until(() => !!removing, "판 도중에 회원 지우기", 30_000);
    expect((await removing)!.body.removed).toBe(true);
    await until(() => !!pb.state() && !pb.state()!.seats.some((s) => s?.uid === a.uid), "지워진 회원의 자리가 비워짐", 20_000);
    await sleep(300);
    const hands = await auditsOf(id);
    // b 는 a 가 넣은 3,000만(+ 앤티)을 가져감. 지워진 a 의 문서는 다시 생기지 않음
    expect(deltaSum(hands, b.uid)).toBe(30_000_000 + TIERS[0].ante);
    expect(await moneyOf(b.uid)).toBe(START_MONEY + 30_000_000 + TIERS[0].ante);
    expect(await users().findOne({ _id: a.uid })).toBeNull();
    expect(await code(a.c.rpc("poker.wallet"))).toBe("MEMBERS_ONLY");
    expect(await code(a.c.rpc("poker.sit", { id }))).toBe("MEMBERS_ONLY");
    expect(pokerErrors(from)).toEqual([]);
    pa.stop();
    pb.stop();
    await leaveAll(id, [b]);
  }, 40_000);

  it("행동 요청에 남의 자리·uid·금액을 끼워 넣어도 소용없고, 이상한 입력은 전부 깔끔하게 거절", async () => {
    const [a, b] = [await member(), await member()];
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: false });
    const from = logs.length;
    const results: [string, string][] = [];
    let done = false;
    let started = false;
    const policy =
      (me: Member, other: Member): Policy =>
      (t, seat) => {
        if (done) return null;
        if (started) return { a: "noop" };
        started = true;
        const otherSeat = t.seats.find((s) => s?.uid === other.uid)!.seat;
        void (async () => {
          const act = (who: Member, extra: unknown) => code(who.c.rpc("poker.act", extra));
          const mine = (extra: Record<string, unknown>) => ({ id, hand: t.handNo, ...extra });
          // 차례가 아닌 사람이 차례인 사람의 자리·uid 를 대고 행동
          for (const extra of [{ a: "fold", seat }, { a: "fold", uid: me.uid, seat }, { a: "raise", amt: 1_000_000, seat, uid: me.uid, as: me.uid }])
            results.push(["남의 차례", await act(other, mine(extra))]);
          // 차례인 사람이 보내는 이상한 입력들
          const junk: unknown[] = [
            mine({ a: "raise", amt: "abc" }),
            mine({ a: "raise", amt: 1.5 }),
            mine({ a: "raise", amt: null }),
            mine({ a: "raise" }),
            mine({ a: "raise", amt: { $gt: 0 } }),
            mine({ a: "raise", amt: -1_000_000 }),
            mine({ a: "raise", amt: Number.MAX_SAFE_INTEGER }),
            mine({ a: "raise", amt: 1e308 }),
            mine({ a: "raise", amt: 250_001 }),
            mine({ a: "constructor" }),
            mine({ a: "__proto__" }),
            mine({ a: ["fold"] }),
            mine({ a: "choose", discard: 0, open: 1 }),
            mine({ a: "bbing" }),
            mine({ a: "check", money: 9e15, stack: 9e15, delta: 9e15 }),
            { id, hand: String(t.handNo), a: "fold" },
            { id, hand: t.handNo + 0.5, a: "fold" },
            { id, hand: t.handNo + 1, a: "fold" },
            { id: "x".repeat(41), hand: t.handNo, a: "fold" },
            { id: { $ne: "" }, hand: t.handNo, a: "fold" },
            JSON.parse(`{"id":"${id}","hand":${t.handNo},"a":"nope","__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}}}`),
            [],
            null,
            "fold",
            42,
            { id, hand: t.handNo, a: "x".repeat(100_000) },
          ];
          for (const j of junk) results.push(["이상한 입력", await act(me, j)]);
          // 그 뒤에도 정상 행동은 됨
          results.push(["정상", await act(me, mine({ a: "call" }))]);
          void otherSeat;
          done = true;
        })();
        return { a: "noop" };
      };
    const pa = await play(a, id, policy(a, b));
    const pb = await play(b, id, policy(b, a));
    await a.c.rpc("poker.sit", { id });
    await b.c.rpc("poker.sit", { id });
    await until(() => done, "거절 확인", 20_000);
    for (const [kind, r] of results) {
      if (kind === "남의 차례") expect(r).toBe("NOT_YOUR_TURN");
      else if (kind === "이상한 입력") expect(["BAD_REQUEST", "STALE", "NO_TABLE"]).toContain(r);
      else expect(r).toBe("OK");
    }
    expect(({} as { polluted?: number }).polluted).toBeUndefined();

    // 다른 요청들의 입력 검사
    const bad: [string, unknown][] = [
      ["poker.create", { game: "holdem", tier: 10 }],
      ["poker.create", { game: "holdem", tier: "1" }],
      ["poker.create", { game: "blackjack", tier: 1 }],
      // bots 는 "봇이 들어올 수 있는 방인지" (불리언) — 수는 못 정함
      ["poker.create", { game: "holdem", tier: 1, bots: 99 }],
      ["poker.create", { game: "holdem", tier: 1, bots: 1 }],
      ["poker.create", { game: "holdem", tier: 1, bots: -1 }],
      ["poker.create", { game: "holdem", tier: 1, bots: 1.5 }],
      ["poker.create", { game: "holdem", tier: 1, bots: "true" }],
      ["poker.create", { game: "holdem", tier: 1, bots: null }],
      ["poker.emote", { id, emote: "nope" }],
      ["poker.emote", { id, emote: 1 }],
      ["poker.emote", { emote: "hi" }],
      ["poker.char", { char: "gunmo" }],
      ["poker.char", { char: ["amy"] }],
      ["poker.char", {}],
      ["poker.create", { game: "holdem", tier: 1, name: "가".repeat(41) }],
      ["poker.create", { game: "holdem", tier: 1, password: "p".repeat(41) }],
      ["poker.create", null],
      ["poker.quick", { game: "holdem" }],
      ["poker.sit", { id, password: 1234 }],
      ["poker.sit", { id: "" }],
      ["poker.sit", {}],
      ["poker.leave", {}],
      ["poker.leave", { id: 5 }],
      ["poker.sitout", { id, out: "yes" }],
      ["poker.chat", { id, text: "" }],
      ["poker.chat", { id, text: "가".repeat(81) }],
      ["poker.chat", { id, text: { $gt: "" } }],
    ];
    for (const [m, args] of bad) expect([m, JSON.stringify(args)?.slice(0, 60), await code(a.c.rpc(m, args))]).toEqual([m, JSON.stringify(args)?.slice(0, 60), "BAD_REQUEST"]);
    for (const ch of ["poker.table", "poker.me"]) {
      for (const p of [null, {}, { id: 1 }, { id: "x".repeat(41) }]) {
        const err = await a.c.sub(ch, p).catch((e) => e as RpcError);
        expect((err as RpcError).code).toBe("BAD_REQUEST");
      }
    }
    expect(pokerErrors(from)).toEqual([]);
    pa.stop();
    pb.stop();
    await leaveAll(id, [a, b]);
    const hands = await auditsOf(id);
    for (const m of [a, b]) expect(await moneyOf(m.uid)).toBe(START_MONEY + deltaSum(hands, m.uid));
  }, 40_000);
});

// ───────────── 4. 숨은 정보 ─────────────

const HOLDEM_KEYS = ["bb", "bbSeat", "board", "button", "currentBet", "deadline", "game", "legal", "players", "pot", "pots", "result", "sbSeat", "street", "toAct"];
const HOLDEM_PLAYER_KEYS = ["allIn", "bet", "cards", "folded", "invested", "last"];
const SEVEN_KEYS = ["ante", "boss", "currentBet", "deadline", "game", "legal", "phase", "players", "pot", "pots", "result", "round", "toAct"];
const SEVEN_PLAYER_KEYS = ["allIn", "bet", "cards", "chosen", "down", "folded", "invested", "last", "up"];
const TABLE_KEYS = ["bots", "ev", "game", "hand", "handNo", "id", "locked", "name", "nextAt", "seats", "seq", "tier"];
const SEAT_KEYS = ["away", "char", "exit", "hands", "look", "name", "net", "seat", "stack", "status", "uid", "votes", "wins"];

/** 사람 둘 + (들어오고 나가는) 유저봇들이 여러 판을 치는 동안, 앉지 않은 구경꾼이 받은 것 전부를 모음 */
async function watchGame(game: GameKind, policyA: (rnd: () => number) => Policy, policyB: Policy, enough: (seen: TableWire[]) => boolean) {
  const [a, b, o] = [await member(), await member(), await member()];
  const id = await a.c.rpc<string>("poker.create", { game, tier: 1, bots: true });
  const seen: TableWire[] = [];
  const raw: { k: string; t: string; d: any }[] = [];
  const watch = await o.c.sub<{ table: TableWire }>("poker.table", { id });
  const oMe = await o.c.sub<MyHand | null>("poker.me", { id });
  o.c.socket.on("ev", (m: { k: string; t: string; d: any }) => {
    raw.push(m);
    if (m.k === watch.key && m.t === "state" && m.d) seen.push(m.d);
  });
  const rnd = lcg(game === "holdem" ? 11 : 23);
  const pa = await play(a, id, policyA(rnd));
  const pb = await play(b, id, policyB);
  let topUps = 0;
  const keepSeated = async () => {
    for (const m of [a, b]) {
      if ((await walletOf(m)).table) continue;
      if (((await moneyOf(m.uid)) ?? 0) < TIERS[0].min) {
        await users().updateOne({ _id: m.uid }, { $inc: { money: START_MONEY } });
        topUps++;
      }
      await m.c.rpc("poker.sit", { id }).catch(() => {});
    }
  };
  await until(
    async () => {
      await keepSeated();
      return enough(seen);
    },
    `${game} 여러 판`,
    80_000
  );
  pa.stop();
  pb.stop();
  await leaveAll(id, [a, b]);
  return { a, b, o, id, seen, raw, pa, pb, oMe, hands: await auditsOf(id), topUps };
}

describe("숨은 정보", () => {
  it("홀덤: 구경꾼이 받는 상태·이벤트에는 쇼다운(또는 올인으로 베팅이 끝난 뒤) 전까지 누구의 패도 없음", async () => {
    const g = await watchGame(
      "holdem",
      (rnd) => (t) => {
        const lg = (t.hand as HoldemView).legal!;
        const r = rnd();
        if (lg.canRaise && r < 0.12) return { a: "raise", amt: lg.maxTo };
        if (lg.canRaise && r < 0.3) return { a: "raise", amt: lg.minTo };
        return { a: lg.toCall > 0 ? "call" : "check" };
      },
      (t) => ({ a: (t.hand as HoldemView).legal!.toCall > 0 ? "call" : "check" }),
      (seen) => {
        const last = seen[seen.length - 1];
        const runouts = seen.filter((t) => t.hand && !t.hand.result && Object.values((t.hand as HoldemView).players).some((p) => p.cards)).length;
        const showdowns = seen.filter((t) => t.hand?.result?.showdown).length;
        const folds = seen.filter((t) => t.hand?.result && !t.hand.result.showdown).length;
        return (last?.handNo ?? 0) >= 10 && runouts >= 1 && showdowns >= 3 && folds >= 1;
      }
    );
    const byNo = new Map(g.hands.map((h) => [h.no, h]));
    let revealedEarly = 0;
    let botSeen = false;
    for (const t of g.seen) {
      expect(Object.keys(t).sort()).toEqual(TABLE_KEYS);
      // 자리에는 이름 · 캐릭터 · 칩만 (봇인지는 uid 가 "" 인 것으로만 드러남, 성격 같은 건 없음)
      for (const s of t.seats) if (s) expect(Object.keys(s).sort()).toEqual(SEAT_KEYS);
      if (t.seats.some((s) => s?.uid === "")) botSeen = true;
      const h = t.hand as HoldemView | null;
      if (!h) {
        expect(t.ev.some((e) => e.t === "show")).toBe(false);
        continue;
      }
      expect(Object.keys(h).sort()).toEqual(HOLDEM_KEYS);
      const live = Object.values(h.players).filter((p) => !p.folded);
      // 올인으로 베팅이 끝남: 차례인 사람이 없고, 더 걸 수 있는 사람이 하나 이하
      const runout = !h.result && h.toAct === -1 && live.length >= 2 && live.filter((p) => !p.allIn).length <= 1;
      const mayShow = !!h.result?.showdown || runout;
      const au = byNo.get(t.handNo);
      for (const [seat, p] of Object.entries(h.players)) {
        expect(Object.keys(p).sort()).toEqual(HOLDEM_PLAYER_KEYS);
        if (!p.cards) continue;
        expect(mayShow).toBe(true);
        expect(p.folded).toBe(false);
        if (!h.result) revealedEarly++;
        if (au) expect(p.cards).toEqual(au.hand.players.find((x) => x.seat === Number(seat))!.cards);
      }
      for (const e of t.ev) if (e.t === "show") expect(mayShow).toBe(true);
      if (h.result) {
        const shown = Object.entries(h.players).filter(([, p]) => p.cards).map(([s]) => s);
        // 이긴 5장·족보 이름은 패를 깐 사람 것만
        for (const s of [...Object.keys(h.result.best), ...Object.keys(h.result.names)]) expect(shown).toContain(s);
        if (!h.result.showdown) expect(shown).toEqual([]);
      }
    }
    expect(revealedEarly).toBeGreaterThan(0);
    expect(botSeen).toBe(true);

    // 구경꾼의 "내 패" 구독은 비어 있고, 테이블 구독으로는 state · chat 말고는 안 옴 (봇의 한마디는 chat 으로 옴)
    expect(g.oMe.data).toBeNull();
    expect(g.raw.filter((m) => m.t === "hand")).toEqual([]);
    expect([...new Set(g.raw.map((m) => m.t))].every((t) => t === "state" || t === "chat")).toBe(true);
    expect(JSON.stringify(g.raw)).not.toMatch(/persona|brain|skill|"deck"/);
    // 앉은 사람은 자기 패만 받음
    for (const [who, p] of [
      [g.a, g.pa],
      [g.b, g.pb],
    ] as const) {
      expect(p.hands.length).toBeGreaterThan(0);
      for (const m of p.hands) {
        const au = byNo.get(m.handNo);
        if (!au) continue;
        const seat = au.who.find((w) => w.uid === who.uid)!.seat;
        expect(m.seat).toBe(seat);
        expect(m.cards).toEqual(au.hand.players.find((x) => x.seat === seat)!.cards);
      }
    }
    // 돈도 맞음 (중간에 채워 준 돈은 두 사람 합계로 확인)
    for (const h of g.hands) expect(h.who.reduce((s, w) => s + w.delta, 0)).toBe(0);
    const total = ((await moneyOf(g.a.uid)) ?? 0) + ((await moneyOf(g.b.uid)) ?? 0);
    expect(total).toBe(2 * START_MONEY + g.topUps * START_MONEY + deltaSum(g.hands, g.a.uid) + deltaSum(g.hands, g.b.uid));
  }, 120_000);

  it("7포커: 엎은 카드·버린 카드는 쇼다운 전까지(버린 카드와 죽은 사람 패는 끝까지) 어디에도 안 나옴", async () => {
    const g = await watchGame(
      "seven",
      (rnd) => (t) => {
        const h = t.hand as SevenView;
        if (h.phase === "choice") {
          const discard = Math.floor(rnd() * 4);
          return { a: "choose", discard, open: (discard + 1 + Math.floor(rnd() * 3)) % 4 };
        }
        const lg = h.legal!;
        const bets = Object.keys(lg.bets);
        const r = rnd();
        if (bets.length && r < 0.35) return { a: bets[Math.floor(rnd() * bets.length)] };
        if (lg.toCall > 0) return { a: r < 0.93 ? "call" : "die" };
        return bbingOrDie(h);
      },
      (t) => {
        const h = t.hand as SevenView;
        if (h.phase === "choice") return { a: "choose", discard: 2, open: 3 };
        return h.legal!.toCall > 0 ? { a: "call" } : bbingOrDie(h);
      },
      (seen) => {
        const last = seen[seen.length - 1];
        const showdowns = seen.filter((t) => t.hand?.result?.showdown).length;
        const folded = seen.some((t) => t.hand?.result?.showdown && Object.values(t.hand.players).some((p) => p.folded));
        return (last?.handNo ?? 0) >= 8 && showdowns >= 3 && folded;
      }
    );
    const byNo = new Map(g.hands.map((h) => [h.no, h]));
    let checked = 0;
    for (const t of g.seen) {
      expect(Object.keys(t).sort()).toEqual(TABLE_KEYS);
      const h = t.hand as SevenView | null;
      if (!h) continue;
      expect(Object.keys(h).sort()).toEqual(SEVEN_KEYS);
      for (const p of Object.values(h.players)) {
        expect(Object.keys(p).sort()).toEqual(SEVEN_PLAYER_KEYS);
        if (!h.result?.showdown || p.folded) expect(p.cards).toBeNull();
      }
      const au = byNo.get(t.handNo);
      if (!au) continue;
      // 끝까지 숨겨야 하는 카드: 각자의 버린 카드 + 엎은 카드. 쇼다운에서는 남은 사람의 엎은 카드만 공개됨
      const never = new Set<number>();
      const untilShowdown = new Set<number>();
      for (const p of au.hand.players) {
        const upCards = new Set(p.cards.filter((_, i) => p.up![i]));
        for (const c of [...p.dealt!, ...p.cards]) {
          if (upCards.has(c)) continue;
          if (p.folded || !p.cards.includes(c)) never.add(c);
          else untilShowdown.add(c);
        }
      }
      const visible: number[] = [];
      for (const p of Object.values(h.players)) visible.push(...p.up, ...(p.cards ?? []));
      for (const five of Object.values(h.result?.best ?? {})) visible.push(...five);
      for (const e of t.ev) {
        if (e.t === "open") visible.push(e.card);
        else if (e.t === "deal") visible.push(...e.cards.map((x) => x.card).filter((x): x is number => x !== null));
        else if (e.t === "show") visible.push(...e.cards);
      }
      for (const c of visible) {
        expect(never.has(c)).toBe(false);
        if (!h.result?.showdown) expect(untilShowdown.has(c)).toBe(false);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
    expect(g.oMe.data).toBeNull();
    expect(g.raw.filter((m) => m.t === "hand")).toEqual([]);
    // 앉은 사람은 자기 카드만 받음 (받은 4장 → 고른 뒤의 카드)
    for (const [who, p] of [
      [g.a, g.pa],
      [g.b, g.pb],
    ] as const) {
      for (const m of p.hands) {
        const au = byNo.get(m.handNo);
        if (!au) continue;
        const mine = au.hand.players.find((x) => x.seat === au.who.find((w) => w.uid === who.uid)!.seat)!;
        const own = new Set([...mine.dealt!, ...mine.cards]);
        expect(m.seat).toBe(mine.seat);
        for (const c of m.cards) expect(own.has(c)).toBe(true);
      }
    }
    for (const h of g.hands) expect(h.who.reduce((s, w) => s + w.delta, 0)).toBe(0);
    const total = ((await moneyOf(g.a.uid)) ?? 0) + ((await moneyOf(g.b.uid)) ?? 0);
    expect(total).toBe(2 * START_MONEY + g.topUps * START_MONEY + deltaSum(g.hands, g.a.uid) + deltaSum(g.hands, g.b.uid));
  }, 120_000);
});

// ───────────── 5. 멈추지 않음 ─────────────

/**
 * 사람 셋이 아무렇게나 굴어도(시간 초과 · 판 도중 나가기 · 자리 비움 · 접속 끊김 · 다시 앉기) 판은 계속 돌고,
 * 서버 오류가 없고, 끝나면 모두 자리에서 일어날 수 있고, DB 의 돈이 기록과 맞아야 함.
 */
async function chaos(game: GameKind, seed: number, wantHands: number) {
  const s = await startTestServer({ poker: { speed: 0.004, actMs: 250, choiceMs: 250, awayMs: 60, sweepIntervalMs: 100 } });
  try {
    const from = logs.length;
    const rnd = lcg(seed);
    const ms = [await member(s), await member(s), await member(s)];
    const id = await ms[0].c.rpc<string>("poker.create", { game, tier: 1, bots: true });
    const added = new Map<string, number>(ms.map((m) => [m.uid, 0]));
    const players: Player[] = [];
    const seen: TableWire[] = [];
    for (const [i, m] of ms.entries()) {
      const policy: Policy = (t) => {
        const r = rnd();
        if (r < 0.06) return { a: "noop" }; // 가만히 있음 → 시간 초과
        if (r < 0.1) {
          void m.c.rpc("poker.leave", { id }).catch(() => {});
          return { a: "noop" };
        }
        if (r < 0.13) void m.c.rpc("poker.sitout", { id, out: true }).catch(() => {});
        if (t.hand!.game === "holdem") {
          const lg = (t.hand as HoldemView).legal!;
          if (lg.canRaise && r < 0.145) return { a: "raise", amt: lg.maxTo };
          if (lg.canRaise && r < 0.3) return { a: "raise", amt: lg.minTo };
          if (lg.toCall > 0) return { a: r < 0.85 ? "call" : "fold" };
          return { a: "check" };
        }
        const h = t.hand as SevenView;
        if (h.phase === "choice") {
          const discard = Math.floor(rnd() * 4);
          return { a: "choose", discard, open: (discard + 1 + Math.floor(rnd() * 3)) % 4 };
        }
        const bets = Object.keys(h.legal!.bets);
        if (bets.length && r < 0.4) return { a: bets[Math.floor(rnd() * bets.length)] };
        if (h.legal!.toCall > 0) return { a: r < 0.9 ? "call" : "die" };
        return bbingOrDie(h);
      };
      players.push(await play(m, id, policy, i === 0 ? seen : []));
      await m.c.rpc("poker.sit", { id });
    }
    const handNo = () => seen[seen.length - 1]?.handNo ?? 0;
    const walletIn = (m: Member) => m.c.rpc<Wallet>("poker.wallet");
    let lastProgress = Date.now();
    let lastSeq = -1;
    let longestStall = 0;
    const t0 = Date.now();
    while (handNo() < wantHands) {
      if (Date.now() - t0 > 100_000) throw new Error(`${game}: ${wantHands}판을 못 채움 (지금 ${handNo()}판) — 테이블이 멈춘 듯`);
      const seq = seen[seen.length - 1]?.seq ?? -1;
      if (seq !== lastSeq) {
        lastSeq = seq;
        lastProgress = Date.now();
      }
      longestStall = Math.max(longestStall, Date.now() - lastProgress);
      for (const [i, m] of ms.entries()) {
        const r = rnd();
        const seat = seen[seen.length - 1]?.seats.find((x) => x?.uid === m.uid);
        if (!seat) {
          // 자리가 없으면 (나갔거나 · 밀려났거나) 다시 앉음. 돈이 모자라면 채움.
          // 방금 끝난 판의 정산이 DB 에 반영될 시간을 먼저 줌: 테스트 DB(FerretDB)는 같은 문서를 동시에 고치면
          // 한쪽이 사라져서(진짜 MongoDB 는 아님), 정산($inc money)과 앉기($inc stats.poker.games)가 겹치면 안 됨.
          // 정산 직후에 곧바로 앉는 경우는 위의 "정산 반영 전" 테스트들이 따로 확인함
          await sleep(200);
          if (((await moneyOf(m.uid, s)) ?? 0) < TIERS[0].min) {
            await users(s).updateOne({ _id: m.uid }, { $inc: { money: START_MONEY } });
            added.set(m.uid, added.get(m.uid)! + START_MONEY);
          }
          if (r < 0.7) await m.c.rpc("poker.sit", { id }).catch(() => {});
        } else if (seat.status === "out" && r < 0.5) await m.c.rpc("poker.sitout", { id, out: false }).catch(() => {});
        else if (r < 0.04) {
          // 접속이 끊겼다 돌아옴 (내 패 구독을 끊었다 다시 붙임)
          players[i].me.close();
          await sleep(20 + Math.floor(rnd() * 150));
          players[i].me = await m.c.sub<MyHand | null>("poker.me", { id });
        } else if (r < 0.06) await m.c.rpc("poker.sit", { id }).catch(() => {}); // 나가려던 걸 취소
      }
      await sleep(25);
    }
    players.forEach((p) => p.stop());
    // 끝: 모두 일어남 (판 도중이면 그 판이 끝난 뒤) — 자리에 영영 묶이는 사람이 없어야 함
    for (const m of ms) await m.c.rpc("poker.leave", { id });
    await until(async () => (await Promise.all(ms.map(walletIn))).every((w) => w.table === null), `${game}: 모두 자리에서 일어남`, 20_000);
    await sleep(400);
    const hands = await auditsOf(id, s);
    expect.soft(pokerErrors(from), "서버 오류 · 경고").toEqual([]);
    expect.soft(new Set(hands.map((h) => h.no)).size).toBe(hands.length);
    for (const h of hands) expect.soft(h.who.reduce((sum, w) => sum + w.delta, 0)).toBe(0);
    for (const m of ms) expect.soft(await moneyOf(m.uid, s), "DB 의 돈 = 1억 + 채운 돈 + 기록의 증감").toBe(START_MONEY + added.get(m.uid)! + deltaSum(hands, m.uid));
    // 사람이 앉아 있는 동안 아무 일도 없이 멈춘 시간이 길지 않았음 (제한 시간 250ms 기준으로 넉넉히)
    expect.soft(longestStall, "가장 길게 멈춘 시간(ms)").toBeLessThan(5000);
    return { hands: hands.length };
  } finally {
    await s.close();
  }
}

describe("멈추지 않음", () => {
  it("홀덤: 아무렇게나 굴어도 판이 계속 돌고 돈이 기록과 맞음", async () => {
    expect((await chaos("holdem", 7, 30)).hands).toBeGreaterThanOrEqual(25);
  }, 150_000);

  it("7포커: 아무렇게나 굴어도 판이 계속 돌고 돈이 기록과 맞음", async () => {
    expect((await chaos("seven", 99, 25)).hands).toBeGreaterThanOrEqual(20);
  }, 150_000);

  it("7포커: 카드 고르는 중에 사람이 전부 나가도 판은 끝나고 자리가 비워짐", async () => {
    const [a, b] = [await member(), await member()];
    const id = await a.c.rpc<string>("poker.create", { game: "seven", tier: 1, bots: true });
    let left = 0;
    // 봇이 이 판에 끼어 있을 때(사람이 앉은 뒤에 들어오므로 첫 판은 둘만 칠 수 있음) 고르는 중에 둘 다 나감
    const leaveInChoice =
      (m: Member): Policy =>
      (t) => {
        const h = t.hand as SevenView;
        const botIn = t.seats.some((s) => s && s.uid === "" && h.players[s.seat]);
        if (h.phase === "choice" && botIn) {
          left++;
          void m.c.rpc("poker.leave", { id });
          return { a: "noop" };
        }
        return null;
      };
    const pa = await play(a, id, leaveInChoice(a));
    const pb = await play(b, id, leaveInChoice(b));
    await a.c.rpc("poker.sit", { id });
    await b.c.rpc("poker.sit", { id });
    await until(() => left >= 2, "고르는 중에 나가기");
    await until(async () => (await walletOf(a)).table === null && (await walletOf(b)).table === null, "자리 비움", 20_000);
    await sleep(300);
    const hands = await auditsOf(id);
    expect(hands.length).toBeGreaterThanOrEqual(1);
    for (const h of hands) expect(h.who.reduce((s, w) => s + w.delta, 0)).toBe(0);
    // 나간 판(마지막 판): 봇이 끼어 있었고, 두 사람은 앤티만 잃음
    const last = [...hands].sort((x, y) => x.no - y.no)[hands.length - 1];
    expect(last.who.some((w) => w.uid === null)).toBe(true);
    for (const m of [a, b]) {
      expect(await moneyOf(m.uid)).toBe(START_MONEY + deltaSum(hands, m.uid));
      expect(last.who.find((w) => w.uid === m.uid)?.delta).toBe(-TIERS[0].ante);
    }
    pa.stop();
    pb.stop();
  }, 40_000);
});

// ───────────── 6. 자원 남용 ─────────────

describe("자원 남용", () => {
  it("회원 한 명이 테이블을 한도까지 만들어 다른 사람이 못 만들게 할 수 없음", async () => {
    const s = await startTestServer();
    try {
      const [bad, good] = [await member(s), await member(s)];
      const made = await Promise.all(Array.from({ length: 230 }, () => code(bad.c.rpc("poker.create", { game: "holdem", tier: 1, bots: true }))));
      const lobby = (await good.c.sub<LobbyTable[]>("poker.lobby")).data;
      // 새로 만들 때마다 그 사람의 빈 테이블은 닫힘 → 아무리 만들어도 남는 건 하나
      expect(made.every((r) => r === "OK")).toBe(true);
      expect(lobby.length).toBeLessThanOrEqual(2);
      // 다른 회원은 평소처럼 바로 입장 · 만들기가 됨
      expect(await code(good.c.rpc("poker.quick", { game: "holdem", tier: 1 }))).toBe("OK");
      expect(await code(good.c.rpc("poker.create", { game: "seven", tier: 1 }))).toBe("OK");
    } finally {
      await s.close();
    }
  }, 40_000);

  it("바로 입장을 여러 번 눌러도(앉기 전) 빈 테이블이 계속 생기지 않음", async () => {
    const s = await startTestServer();
    try {
      const a = await member(s);
      const ids = new Set<string>();
      for (let i = 0; i < 10; i++) ids.add(await a.c.rpc<string>("poker.quick", { game: "seven", tier: 2 }));
      const lobby = (await a.c.sub<LobbyTable[]>("poker.lobby")).data;
      // 기대: 방금 만든 빈 테이블을 다시 돌려줌. 실제: 누를 때마다 새 테이블
      expect(ids.size).toBe(1);
      expect(lobby.length).toBe(1);
    } finally {
      await s.close();
    }
  }, 20_000);

  it("접속하지 않은 채(내 패 구독 없이) 앉기를 두 번 불러 '접속 중'으로 남을 수 없음 — 끊기면 자리에서 내려와야 함", async () => {
    const [a, w] = [await member(), await member()];
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: false });
    const sub = await w.c.sub<{ table: TableWire }>("poker.table", { id });
    const seat = () => (([...sub.events].reverse().find((e) => e.t === "state")?.d ?? sub.data.table) as TableWire).seats.find((s) => s?.uid === a.uid);
    // 내 패 구독(= 접속 표시) 없이 앉으면 "끊김" 상태로 앉고, 그대로면 45초(테스트 서버에서는 0.18초) 뒤에 내려옴
    await a.c.rpc("poker.sit", { id });
    await until(() => !!seat(), "앉음");
    expect(seat()!.away).toBe(true);
    // 앉기를 한 번 더 부르면 구독이 없어도 "접속 중"이 됨
    await a.c.rpc("poker.sit", { id });
    await sleep(50);
    expect.soft(seat()?.away, "구독이 없는데도 접속 중으로 바뀜").toBe(true);
    a.c.close();
    // 접속이 끊긴 사람은 얼마 뒤 자리에서 내려와야 함 (지금은 영영 남고, 테이블도 닫히지 않음)
    await sleep(1500);
    expect(seat(), "끊긴 사람의 자리").toBeUndefined();
  }, 20_000);

  it("채팅은 회원만 · 0.7초에 한 번 · 80자까지, 잠긴 테이블 비밀번호는 분당 10번까지만 시도", async () => {
    const [a, b] = [await member(), await member()];
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: false, password: "open sesame" });
    const sub = await a.c.sub<{ table: TableWire; chat: unknown[] }>("poker.table", { id });
    expect(sub.data.table.locked).toBe(true);
    // 공개 상태에 비밀번호(해시)가 실려 나가지 않음
    expect(JSON.stringify(sub.data)).not.toMatch(/sesame|"pw"|password/);
    const lobby = (await b.c.sub<LobbyTable[]>("poker.lobby")).data;
    expect(JSON.stringify(lobby)).not.toMatch(/sesame|"pw"|password/);

    const res: string[] = [];
    for (let i = 0; i < 12; i++) res.push(await code(b.c.rpc("poker.sit", { id, password: `guess${i}` })));
    expect(res.slice(0, 10).every((r) => r === "WRONG_PASSWORD")).toBe(true);
    expect(res.slice(10)).toEqual(["RATE_LIMITED", "RATE_LIMITED"]);
    // 다른 탭으로 바꿔도 같은 사람이면 막힘
    const b2 = await tab(b);
    expect(await code(b2.rpc("poker.sit", { id, password: "open sesame" }))).toBe("RATE_LIMITED");
    b2.close();
    // 만든 사람은 비밀번호 없이
    expect(await code(a.c.rpc("poker.sit", { id }))).toBe("OK");

    const sent = await Promise.all([1, 2, 3, 4, 5].map((i) => code(a.c.rpc("poker.chat", { id, text: `도배 ${i}` }))));
    expect(sent.filter((r) => r === "OK")).toHaveLength(1);
    expect(sent.filter((r) => r === "RATE_LIMITED")).toHaveLength(4);
    await sleep(750);
    await a.c.rpc("poker.chat", { id, text: `  ${"가".repeat(76)}  `, cid: "<script>alert(1)</script>" });
    const msg = (await sub.wait((e) => e.t === "chat" && e.d.text.startsWith("가"))).d;
    expect(msg).toMatchObject({ uid: a.uid, name: a.nick, text: "가".repeat(76) });
    expect(msg.id).toMatch(/^[A-Za-z0-9_-]{8,40}$/);
    await a.c.rpc("poker.leave", { id });
  }, 30_000);
});

// ───────────── 7. 규칙의 빈틈 ─────────────

describe("규칙의 빈틈", () => {
  /**
   * 홀덤에는 "빠진 블라인드" 규칙이 없음: 자리 비움(또는 나갔다 다시 앉기)으로 SB·BB 차례만 건너뛰고
   * 버튼 차례에만 들어오면 블라인드를 한 번도 안 내고 칠 수 있음 (좋은 패만 골라 치면 손해 볼 일이 없음).
   */
  // 알려진 한계 (아직 안 막음): 쉬었다 돌아오는 사람에게 블라인드를 물리는 규칙(BB 까지 기다리기 · 데드 블라인드)이 없음.
  // 게임 머니로 치는 캐주얼 테이블이라 뒤로 미뤘고, 넣게 되면 이 테스트를 켬.
  it.skip("[한계] 자리 비움을 껐다 켜며 버튼 차례에만 들어오는 것으로 블라인드를 영영 안 낼 수는 없음", async () => {
    const s = await startTestServer({ poker: { speed: 0.05, sweepIntervalMs: 200 } });
    try {
      const [h, g] = [await member(s), await member(s)];
      const id = await g.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: true });
      const seen: TableWire[] = [];
      let played = 0;
      let posts = 0;
      let wantOut = true;
      const ph = await play(h, id, () => ({ a: "fold" }), seen);
      await h.c.rpc("poker.sit", { id });
      await h.c.rpc("poker.sitout", { id, out: true });
      // 판이 시작될 때마다: 다음 판에 내가 들어가면 버튼인지 계산해서, 버튼일 때만 자리 비움을 끔
      h.c.socket.on("ev", ({ k, t, d }: { k: string; t: string; d: TableWire | null }) => {
        if (k !== ph.table.key || t !== "state" || !d?.hand || !d.ev.some((e) => e.t === "hand")) return;
        const mine = d.seats.find((x) => x?.uid === h.uid);
        if (!mine) return;
        if (d.hand.players[mine.seat]) played++;
        posts += d.ev.filter((e) => e.t === "post" && e.seat === mine.seat).length;
        const inNext = d.seats.filter((x) => x && (x.uid === h.uid || (x.status !== "out" && !x.away))).map((x) => x!.seat).sort((p, q) => p - q);
        const button = (d.hand as HoldemView).button;
        const nextButton = inNext.find((x) => x > button) ?? inNext[0];
        const out = nextButton !== mine.seat;
        if (out !== wantOut) {
          wantOut = out;
          void h.c.rpc("poker.sitout", { id, out }).catch(() => {});
        }
      });
      const pg = await play(g, id);
      await g.c.rpc("poker.sit", { id });
      await until(() => (seen[seen.length - 1]?.handNo ?? 0) >= 16, "16판", 60_000);
      ph.stop();
      pg.stop();
      for (const m of [h, g]) await m.c.rpc("poker.leave", { id });
      await sleep(300);
      // 셋이 치는 테이블에서 여러 판을 쳤다면 블라인드를 낸 적이 있어야 함 (아예 못 들어갔다면 그것도 괜찮음).
      // 실제: 버튼 차례마다 들어가 5판쯤 치고도 블라인드는 0번
      expect(played < 3 || posts > 0, `h 는 ${played}판을 쳤고 블라인드는 ${posts}번 냄`).toBe(true);
    } finally {
      await s.close();
    }
  }, 90_000);
});

// ───────────── 8. 순위 ─────────────

describe("순위", () => {
  it("한 판이라도 친 회원만, 보유금액이 많은 순으로, 최대 50명", async () => {
    const fresh = await member();
    // 앉기만 하고 판은 안 친 사람
    const sat = await member();
    const id = await sat.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: false });
    await sat.c.rpc("poker.sit", { id });
    await sat.c.rpc("poker.leave", { id });
    await sleep(100);
    const r = await srv.http("/api/poker/rank");
    expect(r.status).toBe(200);
    const list = r.body.list as { nick: string; money: number; hands: number; char: string }[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThanOrEqual(50);
    for (const x of list) {
      expect(Object.keys(x).sort()).toEqual(["avatar", "char", "hands", "look", "money", "nick"]);
      expect(x.hands).toBeGreaterThanOrEqual(1);
      expect(typeof x.char).toBe("string");
    }
    for (const who of [fresh, sat]) expect(list.some((x) => x.nick === who.nick)).toBe(false);
    for (let i = 1; i < list.length; i++) expect(list[i - 1].money).toBeGreaterThanOrEqual(list[i].money);
    // DB 와 같음
    for (const x of list.slice(0, 5)) {
      const doc = (await users().findOne({ nick: x.nick })) as any;
      expect(x.money).toBe(doc.money);
      expect(x.hands).toBe(doc.stats.poker.hands);
    }
  });
});
