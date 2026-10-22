import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REVIVE, SKINS, START_MONEY, TIERS, kstDay } from "../../web/src/lib/poker/rules";
import type { ChatMsg, LobbyTable, HoldemLegal, HoldemView, MyHand, SevenLegal, SevenView, TableWire, Wallet } from "../../web/src/lib/poker/types";
import { RpcError, sleep, startTestServer, type TestClient, type TestServer, type TestSub } from "./helpers";

/*
 * 포커 테이블 통합 테스트: 회원 전용 · 자금(1억 지급, 회생, 입장컷) · 판 진행과 정산 · 내 패가 남에게 안 새는지.
 * 봇의 생각 시간과 카드 까는 뜸은 테스트 서버에서 거의 0 (helpers.ts).
 * 유저봇은 테이블을 만들 때가 아니라 사람이 앉은 뒤에 하나씩 들어옴 (bots: true 인 방). 사람이 하나뿐이어도 봇이 오면 판이 시작됨.
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

/** 기본 행동: 홀덤은 체크 · 싸면 콜 · 비싸면 폴드. 7포커는 체크가 없으니 받을 돈이 없으면 삥, 싸면 콜, 비싸면 다이 */
function cheapAction(t: TableWire, seat: number): Record<string, unknown> {
  const h = t.hand!;
  const stack = t.seats[seat]?.stack ?? 0;
  // 봇의 올인을 다 받아 주다 파산하지 않게: 내 칩의 3% 까지만 콜
  const cheap = h.legal!.toCall <= stack * 0.03;
  if (h.game === "seven") {
    const lg = h.legal as SevenLegal;
    if (lg.toCall > 0) return { a: cheap ? "call" : "die" };
    return { a: lg.bets.bbing !== undefined ? "bbing" : "die" };
  }
  const lg = h.legal as HoldemLegal;
  return { a: lg.canCheck ? "check" : cheap ? "call" : "fold" };
}

/**
 * 테이블에 앉아서 자동으로 침. policy 가 그 차례의 행동을 정함 (기본: cheapAction).
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
      input = policy(t, seat) ?? cheapAction(t, seat);
    }
    if (!input || mark === acted) return;
    acted = mark;
    if (input.a === "__wait") return; // (테스트: 차례가 와도 가만히 있음)
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
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 3, bots: true });
    await a.c.sub("poker.me", { id });
    const err = await a.c.rpc("poker.sit", { id }).catch((e) => e as RpcError);
    expect(err).toMatchObject({ code: "NEED_MONEY", data: { min: TIERS[2].min, money: START_MONEY } });
    expect((await a.c.rpc<Wallet>("poker.wallet")).table).toBeNull();
    await setMoney(a.uid, TIERS[2].min);
    expect(await a.c.rpc("poker.sit", { id })).toMatchObject({ seat: expect.any(Number) });
  });

  it("방 9단계: 판돈 · 입장컷이 계속 올라가고, 타짜 황금판도 입장컷만 채우면 앉음, 없는 단계는 거절", async () => {
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIERS[i].ante).toBeGreaterThan(TIERS[i - 1].ante);
      expect(TIERS[i].min).toBeGreaterThan(TIERS[i - 1].min);
    }
    const a = await member();
    const err = await a.c.rpc("poker.create", { game: "seven", tier: 10, bots: true }).catch((e) => e as RpcError);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    const id = await a.c.rpc<string>("poker.create", { game: "seven", tier: 9, bots: true });
    await a.c.sub("poker.me", { id });
    expect(await a.c.rpc("poker.sit", { id }).catch((e) => (e as RpcError).code)).toBe("NEED_MONEY");
    await setMoney(a.uid, TIERS[8].min);
    expect(await a.c.rpc("poker.sit", { id })).toMatchObject({ seat: expect.any(Number) });
  });

  it("상점 · 옷장: 스킨은 포인트가 모자라면 못 사고, 사면 포인트가 빠지고(칩은 그대로) 바로 입음, 앉은 자리 그림도 바뀜, 두 번은 못 삼", async () => {
    const a = await member();
    const sk = SKINS[0];
    expect(await a.c.rpc("poker.buy", { skin: sk.id }).catch((e) => (e as RpcError).code)).toBe("NEED_POINTS");
    await a.c.rpc("poker.char", { char: sk.char });
    await setMoney(a.uid, 5 * 10 ** 8, { points: sk.price + 500 });
    // 앉아 있으면 못 삼 (봇 없는 방 — 판이 시작되지 않게)
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: false });
    await a.c.sub("poker.me", { id });
    await a.c.rpc("poker.sit", { id });
    expect(await a.c.rpc("poker.buy", { skin: sk.id }).catch((e) => (e as RpcError).code)).toBe("SEATED");
    await a.c.rpc("poker.leave", { id });
    await until(async () => (await a.c.rpc<Wallet>("poker.wallet")).table === null, "자리에서 일어남");
    const w = await a.c.rpc<Wallet>("poker.buy", { skin: sk.id });
    expect(w.skins).toEqual([sk.id]);
    expect(w.wear[sk.char]).toBe(sk.id);
    expect(w.money).toBe(5 * 10 ** 8);
    expect(w.points).toBe(500);
    expect(await a.c.rpc("poker.buy", { skin: sk.id }).catch((e) => (e as RpcError).code)).toBe("OWNED");
    // 앉으면 자리 그림 열쇠가 스킨
    const sub = await a.c.sub<{ table: TableWire }>("poker.table", { id });
    await a.c.rpc("poker.sit", { id });
    const seatOf = () => (([...sub.events].reverse().find((e) => e.t === "state")?.d ?? sub.data?.table) as TableWire | undefined)?.seats.find((x) => x?.uid === a.uid);
    await until(() => !!seatOf(), "앉음");
    await until(() => seatOf()?.look === sk.id, "스킨 그림");
    // 벗으면 기본, 남의 캐릭터 스킨은 못 입음
    const w2 = await a.c.rpc<Wallet>("poker.wear", { char: sk.char, skin: null });
    expect(w2.wear[sk.char]).toBeUndefined();
    await until(() => seatOf()?.look === sk.char, "기본 그림");
    expect(await a.c.rpc("poker.wear", { char: "jinwoo", skin: sk.id }).catch((e) => (e as RpcError).code)).toBe("BAD_REQUEST");
  });

  it("기본 칩 자동 지급: 칩이 바닥난 채로 접속하면 지갑에 받은 금액 · 남은 횟수가 같이 옴", async () => {
    const auto = await startTestServer({ poker: { autoRevive: true } });
    try {
      const uid = "broke-member";
      const token = await auto.token(uid, { email: "broke@example.com" });
      await auto.http("/api/me/nick", { method: "PUT", token, body: { nick: "빈털터리" } });
      const c = await auto.client(uid, { email: "broke@example.com" });
      expect((await c.rpc<Wallet>("poker.wallet")).money).toBe(START_MONEY);
      await auto.db.col("users").updateOne({ _id: uid }, { $set: { money: 0 } });
      const sub = await c.sub<Wallet>("poker.wallet", null);
      const w = sub.data;
      expect(w).toMatchObject({ money: REVIVE.amount, reviveUsed: 1, revived: { amount: REVIVE.amount, left: REVIVE.perDay - 1 } });
      // 칩이 있으면 안 줌
      const sub2 = await c.sub<Wallet>("poker.wallet", null);
      expect(sub2.data.revived).toBeUndefined();
    } finally {
      await auto.close();
    }
  }, 30_000);

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

    // 유저봇은 사람이 앉은 뒤에 들어옴 (uid 가 "" 인 자리). 바로 입장 테이블은 봇이 들어올 수 있는 방
    expect(pa.state()?.bots).toBe(true);
    await until(() => !!pa.state()?.seats.some((s) => s?.uid === ""), "봇 입장", 20_000);
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
    // 한 판의 증감 합은 0 (봇 · 앤티 포함)
    for (const h of hands) expect(h.who.reduce((s, w) => s + w.delta, 0)).toBe(0);
    // 봇도 판에 참가함
    expect(hands.some((h) => h.who.some((w) => w.uid === null))).toBe(true);
    // 홀덤도 앤티를 냄: 판이 시작될 때 참가자 전원의 ante 기록
    const starts = seenA.filter((t) => t.ev.some((e) => e.t === "hand"));
    expect(starts.length).toBeGreaterThan(0);
    for (const t of starts) {
      const inHand = Object.keys(t.hand!.players).map(Number).sort((x, y) => x - y);
      const antes = t.ev.filter((e) => e.t === "post" && e.kind === "ante");
      expect(antes.map((e) => (e as { seat: number }).seat).sort((x, y) => x - y)).toEqual(inHand);
      for (const e of antes) expect((e as { amt: number }).amt).toBe(TIERS[1].ante);
    }

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
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: true });
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
    const other = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: true });
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
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 2, bots: true });
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
    // 다이하면 자리는 바로 비지만, 그 판은 남은 사람들이 끝내야 정산됨 (판 기록 저장 · 지갑 반영이 따로 끝남)
    // → 판 기록의 내 손익 합과 지갑이 맞을 때까지 기다림 (끝내 안 맞으면 실패)
    const handSum = async () => {
      const hands = (await srv.db.col("poker_hands").find({ table: id }).toArray()) as unknown as { who: { uid: string | null; delta: number }[] }[];
      return hands.reduce((s, h) => s + (h.who.find((w) => w.uid === a.uid)?.delta ?? 0), 0);
    };
    await until(async () => (await moneyOf(a.uid)) === START_MONEY + (await handSum()), "지갑 = 시작 칩 + 판 기록 손익", 20_000);
    expect(await moneyOf(a.uid)).toBe(START_MONEY + (await handSum()));
    pa.stop();
  }, 40_000);

  it("입장컷 밑으로 떨어지면 판이 끝난 뒤 자리에서 내려옴", async () => {
    const a = await member();
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 2, bots: true });
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

  it("시간 초과: 체크할 수 있으면 체크, 아니면 폴드. 두 번 이어지면 나가기 예약 → 판 끝나면 일어남", async () => {
    const quick = await startTestServer({ poker: { actMs: 120, speed: 0.004, sweepIntervalMs: 100 } });
    try {
      const uid = "slow-member";
      const token = await quick.token(uid, { email: "slow@example.com" });
      await quick.http("/api/me/nick", { method: "PUT", token, body: { nick: "느림보" } });
      const c = await quick.client(uid, { email: "slow@example.com" });
      const id = await c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: true });
      const sub = await c.sub<{ table: TableWire }>("poker.table", { id });
      await c.sub("poker.me", { id });
      await c.rpc("poker.sit", { id });
      const ev = await sub.wait((e) => e.t === "state" && e.d?.seats.some((s: any) => s?.uid === uid && s.exit), 20_000);
      expect(ev.d.seats.find((s: any) => s?.uid === uid).exit).toBe(true);
      await sub.wait((e) => e.t === "state" && e.d?.ev?.some((x: any) => x.t === "leave" && x.why === "idle"), 20_000);
      expect((await c.rpc<Wallet>("poker.wallet")).table).toBeNull();
    } finally {
      await quick.close();
    }
  }, 60_000);

  it("판 도중에 나가면 죽은 걸로 치고 바로 자리가 비어 다른 방에 앉을 수 있고, 잃은 돈은 판이 끝날 때 반영", async () => {
    const a = await member();
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: true });
    const seen: TableWire[] = [];
    // 내 차례가 오면 아무것도 안 함 (판 도중에 나가려고)
    const pa = await play(a, id, () => ({ a: "__wait" }), seen);
    await a.c.rpc("poker.sit", { id });
    await until(() => !!pa.state()?.hand && pa.state()!.hand!.toAct === pa.state()!.seats.find((x) => x?.uid === a.uid)?.seat, "내 차례", 40_000);
    const handNo = pa.state()!.handNo;
    await a.c.rpc("poker.leave", { id });
    // 바로 자리가 비고 (판은 아직 그 번호 그대로 진행 중) 다른 방에 앉을 수 있음
    expect((await a.c.rpc<Wallet>("poker.wallet")).table).toBeNull();
    await until(() => !pa.state()!.seats.some((x) => x?.uid === a.uid), "자리 비움");
    expect(pa.state()!.handNo).toBe(handNo);
    const id2 = await a.c.rpc<string>("poker.create", { game: "seven", tier: 1, bots: true });
    await a.c.sub("poker.me", { id: id2 });
    expect(await a.c.rpc("poker.sit", { id: id2 })).toMatchObject({ seat: expect.any(Number) });
    // 앞 판이 끝나면 그 판의 증감(앤티 · 블라인드 잃음)이 기록에 남음
    await until(async () => (await srv.db.col("poker_hands").countDocuments({ table: id, no: handNo, "who.uid": a.uid })) === 1, "앞 판 기록", 40_000);
    pa.stop();
  }, 60_000);

  it("나가기 예약: 판 중이면 끝까지 치고 나감, 대기 중이면 바로 나감, 다시 누르면 취소", async () => {
    const a = await member();
    const id = await a.c.rpc<string>("poker.quick", { game: "holdem", tier: 1 });
    await a.c.rpc("poker.sit", { id });
    // 아직 판에 안 끼었으면 바로 나감
    const r = await a.c.rpc<{ left: boolean }>("poker.exit", { id, on: true });
    expect(r.left).toBe(true);
    expect((await a.c.rpc<Wallet>("poker.wallet")).table).toBeNull();
  }, 30_000);
});

describe("강퇴 투표", () => {
  it("3판 이상 친 사람만 투표, 봇들이 따라 투표해 3표면 강퇴되고 한동안 못 앉음, 10판 지나면 표가 사라짐", async () => {
    const a = await member();
    const b = await member();
    // (바로 입장은 다른 테스트의 방에 들어갈 수 있어 자리가 모자랄 수 있음 → 새 방)
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: true });
    const seenA: TableWire[] = [];
    const pa = await play(a, id, undefined, seenA);
    await a.c.rpc("poker.sit", { id });
    const pb = await play(b, id);
    await b.c.rpc("poker.sit", { id });
    const seatOf = (uid: string) => pa.state()!.seats.find((s) => s?.uid === uid)!.seat;
    // 아직 한 판도 안 쳤으면 투표 불가
    expect(await code(a.c.rpc("poker.kick", { id, seat: seatOf(b.uid) }))).toBe("TOO_EARLY");
    await until(() => !!pa.state()?.seats.some((s) => s?.uid === ""), "봇 입장", 20_000);
    await until(() => (pa.state()?.seats.find((s) => s?.uid === a.uid)?.hands ?? 0) >= 3, "a 가 3판", 40_000);
    // 자기 자신 · 중복 투표 불가
    expect(await code(a.c.rpc("poker.kick", { id, seat: seatOf(a.uid) }))).toBe("BAD_REQUEST");
    const bSeat = seatOf(b.uid);
    const r = await a.c.rpc<{ votes: number; need: number; kicked: boolean }>("poker.kick", { id, seat: bSeat });
    expect(r.votes).toBe(1);
    expect(r.need).toBe(3);
    expect(await code(a.c.rpc("poker.kick", { id, seat: bSeat }))).toBe("ALREADY_VOTED");
    // 표 수가 자리 정보에 실림
    await until(() => (pa.state()?.seats[bSeat]?.votes ?? 0) >= 1, "표 수 표시");
    // 봇들(3판 이상 친)이 따라 투표 → 3표가 되면 강퇴 (판 중이면 그 판이 끝난 뒤)
    await until(() => !pa.state()?.seats.some((s) => s?.uid === b.uid), "b 강퇴", 40_000);
    expect((await b.c.rpc<Wallet>("poker.wallet")).table).toBeNull();
    // 강퇴로 나간 것 (입장컷·파산이 아니라)
    const lastEv = seenA.flatMap((t) => t.ev).find((e) => e.t === "leave" && e.seat === bSeat) as { why: string } | undefined;
    expect(lastEv?.why).toBe("vote");
    // 강퇴된 방에는 한동안 못 앉음
    expect(await code(b.c.rpc("poker.sit", { id }))).toBe("BANNED");
    pa.stop();
    pb.stop();
    await a.c.rpc("poker.leave", { id });
  }, 90_000);
});

describe("봇이 연 방", () => {
  it("로비에 게임별로 들어갈 수 있는 방이 유지되고, 봇이 앉아 있다", async () => {
    const quick = await startTestServer({ poker: { speed: 0.004, sweepIntervalMs: 100, lobbyBots: true } });
    try {
      const uid = `lobby-watcher-${Math.random().toString(36).slice(2, 8)}`;
      await quick.http("/api/me/nick", { method: "PUT", token: await quick.token(uid, { email: `${uid}@example.com` }), body: { nick: `지기${Math.random().toString(36).slice(2, 6)}` } });
      const c = await quick.client(uid, { email: `${uid}@example.com` });
      const sub = await c.sub<LobbyTable[]>("poker.lobby", null);
      const latest = () => [...sub.events].reverse().find((e) => e.t === "list")?.d ?? sub.data ?? [];
      await until(() => {
        const list = latest() as LobbyTable[];
        // (1억으로 앉을 수 있는 방 — 동네판 · 하우스만)
        const ok = (g: string) => list.some((t) => t.game === g && t.bots && !t.locked && t.players > 0 && t.players < t.max && t.tier <= 2);
        return ok("holdem") && ok("seven");
      }, "봇이 연 방이 로비에 보임", 15_000);
      // 바로 입장을 누르면 그 종목 · 단계의 봇 방으로 들어감 (새 방을 만들지 않음 — 같은 단계에 봇 방이 여럿이면 그중 하나)
      const room = (latest() as LobbyTable[]).find((t) => t.bots && t.players > 0 && t.players < t.max && t.tier <= 2)!;
      const picked = await c.rpc<string>("poker.quick", { game: room.game, tier: room.tier });
      expect((latest() as LobbyTable[]).some((t) => t.id === picked && t.bots && t.game === room.game && t.tier === room.tier)).toBe(true);
      Object.assign(room, { id: picked });
      await c.sub("poker.me", { id: room.id });
      await c.rpc("poker.sit", { id: room.id });
      const w = await c.rpc<Wallet>("poker.wallet");
      expect(w.table).toBe(room.id);
    } finally {
      await quick.close();
    }
  }, 30_000);
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
        // 홀수 판에는 받을 돈이 있어도 가끔 하프로 올림, 나머지는 기본(삥 · 콜 · 다이)
        if (h.legal!.bets.half !== undefined && t.handNo % 2 === 1 && h.round === 5) return { a: "half" };
        return null;
      },
      seen
    );
    a.c.socket.on("ev", ({ k, t, d }: any) => k === pa.me.key && t === "hand" && mine.push(d));
    await a.c.rpc("poker.sit", { id });
    await until(() => seen.filter((t) => t.hand?.result?.showdown).length >= 2 && (pa.state()?.handNo ?? 0) >= 4, "쇼다운 두 번 이상", 60_000);
    pa.stop();
    const lastNo = pa.state()!.handNo;
    await a.c.rpc("poker.leave", { id });
    await until(async () => (await a.c.rpc<Wallet>("poker.wallet")).table === null, "자리 비움");
    // 판 도중에 나가면 자리는 바로 비지만 그 판의 정산은 판이 끝날 때 — 기록이 남을 때까지
    await until(async () => (await srv.db.col("poker_hands").countDocuments({ table: id, no: lastNo })) === 1, "마지막 판 기록", 40_000);
    await sleep(300);

    const hands = (await srv.db.col("poker_hands").find({ table: id }).toArray()) as unknown as { who: { uid: string | null; delta: number }[] }[];
    for (const h of hands) expect(h.who.reduce((s, w) => s + w.delta, 0)).toBe(0);
    const sum = hands.reduce((s, h) => s + (h.who.find((w) => w.uid === a.uid)?.delta ?? 0), 0);
    expect(await moneyOf(a.uid)).toBe(START_MONEY + sum);
    const myHands = hands.filter((h) => h.who.some((w) => w.uid === a.uid)).length;
    expect(myHands).toBeGreaterThanOrEqual(3);
    expect(((await users().findOne({ _id: a.uid })) as any).stats.poker.seven.hands).toBe(myHands);

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
    // 체크는 없음: 차례인 사람의 legal 에 canCheck 가 없고, 받을 돈이 없으면 삥이 열려 있음
    const turns = seen.filter((t) => t.hand && (t.hand as SevenView).phase === "bet" && t.hand.legal);
    expect(turns.length).toBeGreaterThan(0);
    for (const t of turns) {
      const lg = t.hand!.legal as SevenLegal;
      expect(lg).not.toHaveProperty("canCheck");
      if (lg.toCall === 0 && Object.keys(lg.bets).length) expect(lg.bets.bbing).toBe(TIERS[0].ante);
    }
    expect(seen.some((t) => t.ev.some((e) => e.t === "act" && e.a === "check"))).toBe(false);
  }, 90_000);

  it("체크를 보내면 거절, 시간이 다 되면 죽음", async () => {
    const quick = await startTestServer({ poker: { actMs: 150, speed: 0.004, sweepIntervalMs: 100 } });
    try {
      const uid = "seven-slow";
      const token = await quick.token(uid, { email: "seven-slow@example.com" });
      await quick.http("/api/me/nick", { method: "PUT", token, body: { nick: "칠포느림" } });
      const c = await quick.client(uid, { email: "seven-slow@example.com" });
      const id = await c.rpc<string>("poker.create", { game: "seven", tier: 1, bots: true });
      const seen: TableWire[] = [];
      let checks = 0;
      let checkResult = "";
      const pa = await play(
        { uid, c },
        id,
        (t, seat) => {
          const h = t.hand as SevenView;
          if (h.phase === "choice") return null;
          // 받을 돈이 없는 내 차례: 체크를 보내 보고(거절돼야 함) 그대로 둠 → 시간 초과로 죽음
          if (h.legal!.toCall === 0 && checks++ === 0) {
            void code(c.rpc("poker.act", { id, hand: t.handNo, a: "check" })).then((r) => (checkResult = r));
            return { a: "noop" };
          }
          void seat;
          return null;
        },
        seen
      );
      await c.rpc("poker.sit", { id });
      await until(() => checkResult !== "", "체크 시도", 30_000);
      expect(checkResult).toBe("BAD_REQUEST");
      // 시간 초과 → 다이 (체크가 없으므로)
      await until(() => seen.some((t) => t.ev.some((e) => e.t === "act" && e.a === "die" && t.seats[e.seat]?.uid === uid)), "시간 초과로 죽음", 20_000);
      pa.stop();
    } finally {
      await quick.close();
    }
  }, 60_000);

  it("캐릭터 고르기 · 이모티콘: 지갑과 자리에 반영되고, 이모티콘은 채팅에도 남음", async () => {
    const a = await member();
    expect((await a.c.rpc<Wallet>("poker.wallet")).char).toBe("jinwoo");
    await a.c.rpc("poker.char", { char: "amy" });
    expect((await a.c.rpc<Wallet>("poker.wallet")).char).toBe("amy");
    expect(await code(a.c.rpc("poker.char", { char: "gunmo" }))).toBe("BAD_REQUEST");

    const id = await a.c.rpc<string>("poker.create", { game: "seven", tier: 1, bots: false });
    const sub = await a.c.sub<{ table: TableWire; chat: ChatMsg[] }>("poker.table", { id });
    // 앉기 전에는 이모티콘 불가
    expect(await code(a.c.rpc("poker.emote", { id, emote: "hi" }))).toBe("FORBIDDEN");
    await a.c.rpc("poker.sit", { id });
    const sat = await sub.wait((e) => e.t === "state" && e.d?.seats.some((s: any) => s?.uid === a.uid));
    expect(sat.d.seats.find((s: any) => s?.uid === a.uid).char).toBe("amy");
    // 게임방 안에서는 캐릭터를 못 바꿈 (스킨만) — 지갑 · 자리 그대로
    expect(await code(a.c.rpc("poker.char", { char: "taeyang" }))).toBe("SEATED");
    expect((await a.c.rpc<Wallet>("poker.wallet")).char).toBe("amy");

    expect(await code(a.c.rpc("poker.emote", { id, emote: "nope" }))).toBe("BAD_REQUEST");
    expect(await code(a.c.rpc("poker.emote", { id, emote: "lol" }))).toBe("OK");
    // 1.2초에 한 번
    expect(await code(a.c.rpc("poker.emote", { id, emote: "cry" }))).toBe("RATE_LIMITED");
    const chat = await sub.wait((e) => e.t === "chat" && e.d.emote === "lol");
    expect(chat.d).toMatchObject({ uid: a.uid, name: a.nick, char: "amy", text: "", emote: "lol" });
    const ev = await sub.wait((e) => e.t === "state" && e.d?.ev.some((x: any) => x.t === "emote" && x.emote === "lol"));
    expect(ev.d.ev.find((x: any) => x.t === "emote")).toMatchObject({ seat: sat.d.seats.findIndex((s: any) => s?.uid === a.uid), emote: "lol" });
    await a.c.rpc("poker.leave", { id });
  }, 30_000);
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
    const id = await a.c.rpc<string>("poker.create", { game: "holdem", tier: 1, bots: true, name: "닫힐방" });
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
