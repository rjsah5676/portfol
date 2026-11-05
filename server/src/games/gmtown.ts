import { z } from "zod";
import type { Socket } from "socket.io";
import type { Deps } from "../deps";
import { AppError, bad } from "../errors";
import { newId } from "../ids";
import { CHANNEL_CAP, CHAT_MAX, HOUSE_TIERS, MAX_CHANNELS, RADIUS, RUN_SPEED, SPAWN, WARP_GAP_MS, blocked, houseTier, warpById } from "../../../web/src/lib/gmtown/world";
import type { ChannelList, CharId, ChatWire, HouseWire, MoveWire, PlayerWire, TownSnap, WalletWire } from "../../../web/src/lib/gmtown/types";
import { HOME_AT, STARTER, checkLayout, defaultWindows, enterAt, fitLayout, furnById, starterInv, type Placed } from "../../../web/src/lib/gmtown/house";
import { buildingById, doorFront } from "../../../web/src/lib/gmtown/world";
import { START_MONEY } from "../../../web/src/lib/poker/rules";
import { START_CASH } from "../../../web/src/lib/stock/money";

/*
 * GMTOWN — 사이트 마을 광장. 채널(최대 40명)마다 서로 보이고 · 걷고 · 말함.
 *
 * 상태는 전부 메모리 (위치 · 채팅은 남길 필요 없음). 게스트(익명 로그인)도 들어옴 — 이름은 「◦손님1234」.
 * 위치는 화면이 정하고 서버는 검사만 함:
 *   - 걸을 수 있는 거리 예산(초당 속도 × 1.4, 최대 2.5칸)을 넘게 움직이면 예산만큼만 → 그 사람에게 snap 으로 바로잡기
 *   - 건물 · 분수 · 나무 안이면 그대로 둠 (world.ts 의 blocked loose — 화면보다 항상 너그럽게: 반지름 작게 · 비탈 안 봄 · 문 앞 선 바깥까지)
 * 바뀐 위치는 0.1초마다 채널별로 모아서 한 번에 보냄 (mv).
 * 한 연결 = 한 사람 (같은 계정으로 탭 두 개면 두 명으로 보임).
 */

export interface GmtownOptions {
  now?: () => number;
  tickMs?: number;
}

interface P {
  id: string;
  sock: string;
  uid: string;
  name: string;
  guest: boolean;
  c: CharId;
  x: number;
  y: number;
  d: number;
  m: 0 | 1 | 2;
  ch: number;
  /** 이동 예산 (칸) · 마지막 계산 시각 */
  bank: number;
  at: number;
  chatAt: number;
  /** 마지막 순간이동 시각 */
  warpAt: number;
  /** 들어가 있는 집 id (마을에선 안 보임) · 집 안 층 */
  home: string | null;
  f: number;
  /** 이 사람 연결 (나에게만 보내기) */
  so: Socket;
  inviteAt: number;
}

interface Chan {
  players: Map<string, P>;
  chat: ChatWire[];
  dirty: Set<string>;
}

const BANK_MAX = 2.5;
const CHAT_KEEP = 30;
const CHAT_GAP_MS = 700;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** 게스트 이름에 붙일 네 자리 (uid 가 같으면 늘 같음) */
function guestNo(uid: string): number {
  let h = 0;
  for (const ch of uid) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 1000 + (h % 9000);
}

export function registerGmtown({ gateway, db, points }: Deps, opts: GmtownOptions = {}) {
  const now = opts.now ?? Date.now;
  const chans = new Map<number, Chan>();
  /** 연결 id → 사람 */
  const bySock = new Map<string, P>();
  const keyOf = (n: number) => `gmtown:ch:${n}`;
  const chan = (n: number): Chan => {
    let c = chans.get(n);
    if (!c) chans.set(n, (c = { players: new Map(), chat: [], dirty: new Set() }));
    return c;
  };
  const wire = (p: P): PlayerWire => ({ id: p.id, name: p.name, guest: p.guest, c: p.c, x: r2(p.x), y: r2(p.y), d: p.d, m: p.m, ...(p.home ? { home: p.home } : {}) });

  /** 들어갈 채널: 고른 채널(꽉 찼으면 거절) 또는 자리가 있는 가장 낮은 채널 */
  function pick(want: number | null, sock: string): number {
    if (want) {
      const c = chans.get(want);
      if (!c || c.players.size < CHANNEL_CAP || c.players.has(sock)) return want;
      throw new AppError("FULL", `${want}채널이 꽉 찼어요. 다른 채널로 가 주세요.`, 409);
    }
    for (let n = 1; n <= MAX_CHANNELS; n++) {
      const c = chans.get(n);
      if (!c || c.players.size < CHANNEL_CAP) return n;
    }
    throw new AppError("FULL", "마을이 꽉 찼어요. 잠시 후 다시 와 주세요.", 503);
  }

  function spawnAt(): { x: number; y: number } {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.8;
      const x = SPAWN.x + Math.cos(a) * r;
      const y = SPAWN.y + Math.sin(a) * r * 0.6;
      if (!blocked(x, y)) return { x, y };
    }
    return { x: SPAWN.x, y: SPAWN.y };
  }

  function remove(sock: string) {
    const p = bySock.get(sock);
    if (!p) return;
    bySock.delete(sock);
    const c = chans.get(p.ch);
    if (!c) return;
    c.players.delete(sock);
    c.dirty.delete(sock);
    gateway.emit(keyOf(p.ch), "leave", p.id);
    if (!c.players.size) chans.delete(p.ch);
  }

  /** 채널을 옮기거나 다시 연결할 때는 화면의 지금 위치에서 이어감 (막힌 곳이면 들어오는 곳) */
  const JoinArgs = z.object({
    ch: z.number().int().min(1).max(MAX_CHANNELS).nullable().optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    /** 고른 캐릭터 (없으면 에이미) */
    c: z.enum(["amy", "mio", "sera"]).optional(),
  });

  gateway.channel("gmtown.ch", {
    key(ctx, raw) {
      void ctx.uid; // 로그인(게스트 포함)해야 들어옴
      const { ch } = JoinArgs.parse(raw ?? {});
      return keyOf(pick(ch ?? null, ctx.socket.id));
    },
    snapshot(ctx, key, raw): TownSnap {
      const args = JoinArgs.parse(raw ?? {});
      const n = Number(key.slice("gmtown:ch:".length));
      const sock = ctx.socket.id;
      let p = bySock.get(sock);
      if (p && p.ch !== n) {
        remove(sock);
        p = undefined;
      }
      const c = chan(n);
      if (!p) {
        if (c.players.size >= CHANNEL_CAP) throw new AppError("FULL", `${n}채널이 꽉 찼어요.`, 409);
        const uid = ctx.uid;
        const guest = !ctx.nick;
        const at = args.x !== undefined && args.y !== undefined && !blocked(args.x, args.y) ? { x: args.x, y: args.y } : spawnAt();
        p = { id: newId(8), sock, uid, name: ctx.name(`손님${guestNo(uid)}`, 10), guest, c: args.c ?? "amy", x: at.x, y: at.y, d: 0, m: 0, ch: n, bank: BANK_MAX, at: now(), chatAt: 0, warpAt: 0, home: null, f: 0, so: ctx.socket as Socket, inviteAt: 0 };
        c.players.set(sock, p);
        bySock.set(sock, p);
        gateway.emit(keyOf(n), "join", wire(p));
      }
      return { ch: n, me: p.id, cap: CHANNEL_CAP, players: [...c.players.values()].map(wire), chat: c.chat.slice(-CHAT_KEEP) };
    },
    closed(ctx, key) {
      const p = bySock.get(ctx.socket.id);
      if (p && keyOf(p.ch) === key) remove(ctx.socket.id);
    },
  });
  gateway.onDisconnect((ctx) => remove(ctx.socket.id));

  const MoveArgs = z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    d: z.number().int().min(0).max(7),
    m: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    f: z.number().int().min(0).max(2).optional(),
  });

  gateway.rpc("gmtown.move", (ctx, raw) => {
    const p = bySock.get(ctx.socket.id);
    if (!p) return null;
    const a = MoveArgs.parse(raw);
    const t = now();
    p.bank = Math.min(BANK_MAX, p.bank + ((t - p.at) / 1000) * RUN_SPEED * 1.4);
    p.at = t;
    let x = a.x,
      y = a.y,
      snap = false;
    const dist = Math.hypot(x - p.x, y - p.y);
    if (dist > p.bank + 0.05) {
      const k = p.bank / dist;
      x = p.x + (a.x - p.x) * k;
      y = p.y + (a.y - p.y) * k;
      snap = true;
    }
    // 집 안: 집 자리 둘레만 (방 · 가구 부딪힘은 화면이 봄)
    if (p.home ? Math.abs(x - HOME_AT.x) > 16 || Math.abs(y - HOME_AT.y) > 16 : blocked(x, y, RADIUS * 0.6, true)) {
      x = p.x;
      y = p.y;
      snap = true;
    }
    p.bank = Math.max(0, p.bank - Math.hypot(x - p.x, y - p.y));
    p.x = x;
    p.y = y;
    p.d = a.d;
    p.m = a.m;
    p.f = p.home ? (a.f ?? 0) : 0;
    chans.get(p.ch)?.dirty.add(p.sock);
    if (snap) gateway.emitTo(ctx.socket, keyOf(p.ch), "snap", { x: r2(x), y: r2(y) });
    return null;
  });

  // 내 집 (중개인 NPC 에게 GP 로 계약 · 한 단계씩 올림) — 회원만. 집 안은 사람마다 따로라 마을 사람들과는 상관없음
  const houses = db.col<{ tier: number; at: number; inv?: Record<string, number>; layout?: Placed[] }>("gmtown_house");
  const houseOf = async (uid: string) => (await houses.findOne({ _id: uid }))?.tier ?? 0;
  const houseWire = async (uid: string, guest: boolean): Promise<HouseWire> => {
    let h = guest ? null : await houses.findOne({ _id: uid });
    // 창문이 놓는 가구가 되기 전에 계약한 집: 창문 2개를 넣어 주고 벽에 걸어 둠 (한 번만)
    if (h && h.tier >= 1 && h.inv?.window === undefined) {
      const inv = { ...(h.inv ?? {}), window: 2 };
      const layout = fitLayout(h.tier, [...((h.layout ?? []) as Placed[]), ...defaultWindows(h.tier)], inv);
      await houses.updateOne({ _id: uid, "inv.window": { $exists: false } } as never, { $set: { "inv.window": 2, layout } });
      h = { ...h, inv, layout };
    }
    return {
      tier: h?.tier ?? 0,
      gp: guest ? null : ((await points.get(uid))?.points ?? 0),
      inv: h?.inv ?? {},
      layout: h?.layout ?? [],
    };
  };
  gateway.rpc("gmtown.house", async (ctx) => houseWire(ctx.uid, !ctx.nick));
  gateway.rpc("gmtown.house.buy", async (ctx, raw) => {
    if (!ctx.nick) throw new AppError("FORBIDDEN", "집 계약은 회원만 할 수 있어요. 로그인해 주세요.", 403);
    const { tier } = z.object({ tier: z.number().int().min(1).max(HOUSE_TIERS.length) }).parse(raw);
    const h = houseTier(tier)!;
    const old = await houses.findOne({ _id: ctx.uid });
    const cur = old?.tier ?? 0;
    if (tier <= cur) throw new AppError("ALREADY", "이미 계약한 집이에요.", 409);
    if (tier !== cur + 1) throw bad("한 단계씩 올릴 수 있어요.");
    // GP 먼저 (모자라면 여기서 멈춤) → 단계 올림. 그 사이 다른 창에서 먼저 올렸으면 GP 되돌림
    await points.spend(ctx.uid, h.price, "gmtown", `house:${tier}`);
    const r = await houses.updateOne(
      { _id: ctx.uid, tier: cur },
      cur === 0 ? { $set: { tier, at: now(), inv: starterInv(), layout: STARTER } } : { $set: { tier, at: now(), layout: fitLayout(tier, (old?.layout ?? []) as Placed[], old?.inv ?? {}) } },
      { upsert: cur === 0 }
    ).catch(() => null);
    if (!r || (r.modifiedCount === 0 && r.upsertedCount === 0)) {
      await points.grant(ctx.uid, h.price, "gmtown", `house-refund:${tier}`);
      throw new AppError("ALREADY", "이미 계약이 바뀌었어요. 다시 확인해 주세요.", 409);
    }
    return houseWire(ctx.uid, false);
  });
  // 가구 가게 (GP) — 산 가구는 창고(inv)로, 놓는 건 save
  gateway.rpc("gmtown.house.shop", async (ctx, raw) => {
    if (!ctx.nick) throw new AppError("FORBIDDEN", "회원만 살 수 있어요.", 403);
    const { id } = z.object({ id: z.string().max(30) }).parse(raw);
    const f = furnById(id);
    if (!f) throw bad("없는 가구예요.");
    if ((await houseOf(ctx.uid)) < 1) throw bad("먼저 집을 계약해 주세요.");
    await points.spend(ctx.uid, f.price, "gmtown", `furn:${id}`);
    await houses.updateOne({ _id: ctx.uid }, { $inc: { [`inv.${id}`]: 1 } });
    return houseWire(ctx.uid, false);
  });
  const PlacedArgs = z.object({
    layout: z
      .array(
        z.object({ i: z.string().max(30), x: z.number().int(), y: z.number().int(), r: z.number().int().min(0).max(3), f: z.number().int().min(0).max(1).optional() })
      )
      .max(160),
  });
  gateway.rpc("gmtown.house.save", async (ctx, raw) => {
    if (!ctx.nick) throw new AppError("FORBIDDEN", "회원만 꾸밀 수 있어요.", 403);
    const { layout } = PlacedArgs.parse(raw);
    const h = await houses.findOne({ _id: ctx.uid });
    if (!h || h.tier < 1) throw bad("먼저 집을 계약해 주세요.");
    const why = checkLayout(h.tier, layout as Placed[], h.inv ?? {});
    if (why) throw bad(why);
    await houses.updateOne({ _id: ctx.uid }, { $set: { layout: layout as Placed[] } });
    // 같은 집에 놀러 와 있는 사람들에게 바뀐 가구
    const me = bySock.get(ctx.socket.id);
    const room = roomOf(ctx.uid);
    if (me) for (const q of chan(me.ch).players.values()) if (q !== me && q.home === room) gateway.emitTo(q.so, keyOf(q.ch), "hlayout", { room, layout });
    return null;
  });
  // 집에 들어감 · 나옴 (같은 채널 사람들에게 home — 들어가 있는 동안은 마을에서 안 보임)
  const homeDoor = () => {
    const b = buildingById("home");
    return b ? doorFront(b) : SPAWN;
  };
  /** 집 id (주인 uid 는 안 보이게 — 서버가 켜져 있는 동안 같은 값) */
  const rooms = new Map<string, string>();
  const roomOf = (uid: string) => {
    let r = rooms.get(uid);
    if (!r) rooms.set(uid, (r = newId(10)));
    return r;
  };
  /** 집 안으로: 들어가는 자리 · 같은 채널에 home */
  const goIn = (p: P, room: string, tier: number) => {
    const at = enterAt(tier);
    p.x = at.x;
    p.y = at.y;
    p.f = 0;
    p.m = 0;
    p.bank = BANK_MAX;
    p.at = now();
    if (p.home !== room) {
      p.home = room;
      gateway.emit(keyOf(p.ch), "home", { id: p.id, on: true, room });
    }
  };
  gateway.rpc("gmtown.house.enter", async (ctx) => {
    const p = bySock.get(ctx.socket.id);
    if (!p) throw bad("마을에 들어와야 해요.");
    const w = await houseWire(ctx.uid, !ctx.nick);
    if (w.tier < 1) throw bad("아직 계약한 집이 없어요.");
    const room = roomOf(ctx.uid);
    goIn(p, room, w.tier);
    return { ...w, room };
  });
  // 친구 초대 · 놀러 가기 — 초대는 5분 동안 (그 사이엔 몇 번이든 들어감)
  const INVITE_MS = 5 * 60_000;
  /** "초대받은 연결|주인 uid" → 끝나는 시각 */
  const invites = new Map<string, number>();
  gateway.rpc("gmtown.house.invite", async (ctx, raw) => {
    const p = bySock.get(ctx.socket.id);
    if (!p) throw bad("마을에 들어와야 해요.");
    if (!ctx.nick) throw new AppError("FORBIDDEN", "회원만 초대할 수 있어요.", 403);
    const { to } = z.object({ to: z.string().max(20) }).parse(raw);
    const q = [...chan(p.ch).players.values()].find((x) => x.id === to);
    if (!q || q === p) throw bad("같은 채널에 있는 사람만 초대할 수 있어요.");
    if ((await houseOf(ctx.uid)) < 1) throw bad("먼저 집을 계약해 주세요.");
    const t = now();
    if (t - p.inviteAt < 2000) throw new AppError("RATE_LIMITED", "조금 있다가 다시 초대해 주세요.", 429);
    p.inviteAt = t;
    for (const [k, v] of invites) if (v < t) invites.delete(k);
    invites.set(`${q.sock}|${ctx.uid}`, t + INVITE_MS);
    gateway.emitTo(q.so, keyOf(q.ch), "invite", { from: p.id, name: p.name });
    return null;
  });
  gateway.rpc("gmtown.house.visit", async (ctx, raw) => {
    const p = bySock.get(ctx.socket.id);
    if (!p) throw bad("마을에 들어와야 해요.");
    const { from } = z.object({ from: z.string().max(20) }).parse(raw);
    const host = [...chan(p.ch).players.values()].find((x) => x.id === from);
    if (!host) throw bad("초대한 사람이 마을을 떠났어요.");
    const until = invites.get(`${p.sock}|${host.uid}`) ?? 0;
    if (until < now()) throw new AppError("FORBIDDEN", "초대가 끝났어요. 다시 초대받아 주세요.", 403);
    const h = await houseWire(host.uid, false);
    if (h.tier < 1) throw bad("그 집은 아직 없어요.");
    const room = roomOf(host.uid);
    goIn(p, room, h.tier);
    return { ...h, gp: ctx.nick ? ((await points.get(ctx.uid))?.points ?? 0) : null, inv: {}, room, owner: host.name };
  });
  gateway.rpc("gmtown.house.leave", (ctx) => {
    const p = bySock.get(ctx.socket.id);
    if (!p) return null;
    const d = homeDoor();
    p.x = d.x;
    p.y = d.y;
    p.m = 0;
    p.bank = BANK_MAX;
    p.at = now();
    p.f = 0;
    if (p.home) {
      p.home = null;
      gateway.emit(keyOf(p.ch), "home", { id: p.id, on: false, x: r2(d.x), y: r2(d.y) });
    }
    chans.get(p.ch)?.dirty.add(p.sock);
    return { x: r2(d.x), y: r2(d.y) };
  });

  // 화면 위 돈 표시: GP · 포커 칩(금고 포함) · 주식게임 총자산 (각 게임 지갑을 읽기만 함)
  const usersCol = db.col<{ money?: number; poker?: { vault?: number }; stk?: { cash?: number; held?: number; coinHeld?: number } }>("users");
  gateway.rpc("gmtown.wallet", async (ctx): Promise<WalletWire | null> => {
    if (!ctx.nick) return null;
    const d = await usersCol.findOne({ _id: ctx.uid }, { projection: { money: 1, "poker.vault": 1, stk: 1 } });
    const s = d?.stk;
    return {
      gp: (await points.get(ctx.uid))?.points ?? 0,
      chips: (d?.money ?? START_MONEY) + (d?.poker?.vault ?? 0),
      stock: s?.cash === undefined ? START_CASH : s.cash + Math.max(0, s.held ?? 0) + Math.max(0, s.coinHeld ?? 0),
    };
  });

  // 캐릭터 바꾸기 (같은 채널 모두에게 char)
  gateway.rpc("gmtown.char", (ctx, raw) => {
    const p = bySock.get(ctx.socket.id);
    if (!p) throw bad("마을에 들어와야 바꿀 수 있어요.");
    const { c } = z.object({ c: z.enum(["amy", "mio", "sera"]) }).parse(raw);
    if (p.c !== c) {
      p.c = c;
      gateway.emit(keyOf(p.ch), "char", { id: p.id, c });
    }
    return null;
  });

  // 전체 지도에서 고른 곳으로 순간이동 (정해진 자리만 · 몇 초에 한 번)
  gateway.rpc("gmtown.warp", (ctx, raw) => {
    const p = bySock.get(ctx.socket.id);
    if (!p) throw bad("마을에 들어와야 이동할 수 있어요.");
    const { to } = z.object({ to: z.string().max(40) }).parse(raw);
    const w = warpById(to);
    if (!w) throw bad("그곳으로는 갈 수 없어요.");
    const t = now();
    if (t - p.warpAt < WARP_GAP_MS) throw new AppError("RATE_LIMITED", "순간이동은 잠시 후에 다시 쓸 수 있어요.", 429);
    p.warpAt = t;
    p.x = w.x;
    p.y = w.y;
    p.m = 0;
    p.bank = BANK_MAX;
    p.at = t;
    chans.get(p.ch)?.dirty.add(p.sock);
    return { x: r2(w.x), y: r2(w.y) };
  });

  gateway.rpc("gmtown.chat", (ctx, raw) => {
    const p = bySock.get(ctx.socket.id);
    if (!p) throw bad("마을에 들어와야 말할 수 있어요.");
    const { text } = z.object({ text: z.string().max(300) }).parse(raw);
    // 줄바꿈 · 탭도 제어 문자라 빈칸으로 먼저 바꾸고 나머지 제어 문자를 지움
    const clean = text
      .replace(/\s+/g, " ")
      .replace(/[\p{Cc}\p{Cf}]/gu, "")
      .trim()
      .slice(0, CHAT_MAX);
    if (!clean) return null;
    const t = now();
    if (t - p.chatAt < CHAT_GAP_MS) throw new AppError("RATE_LIMITED", "조금 천천히 말해 주세요.", 429);
    p.chatAt = t;
    const c = chan(p.ch);
    const m: ChatWire = { id: p.id, name: p.name, text: clean, at: t };
    c.chat.push(m);
    if (c.chat.length > CHAT_KEEP) c.chat.splice(0, c.chat.length - CHAT_KEEP);
    gateway.emit(keyOf(p.ch), "chat", m);
    return null;
  });

  gateway.rpc("gmtown.channels", (): ChannelList => {
    const list = [...chans.entries()].map(([ch, c]) => ({ ch, n: c.players.size }));
    if (!list.some((r) => r.ch === 1)) list.push({ ch: 1, n: 0 });
    // 사람이 있는 채널 다음에 빈 채널 하나는 늘 고를 수 있게
    const next = [...Array(MAX_CHANNELS)].map((_, i) => i + 1).find((n) => !chans.has(n) && n !== 1);
    if (next) list.push({ ch: next, n: 0 });
    return { cap: CHANNEL_CAP, list: list.sort((a, b) => a.ch - b.ch) };
  });

  const timer = setInterval(() => {
    for (const [n, c] of chans) {
      if (!c.dirty.size) continue;
      const out: MoveWire[] = [];
      for (const sock of c.dirty) {
        const p = c.players.get(sock);
        if (p) out.push(p.home ? [p.id, r2(p.x), r2(p.y), p.d, p.m, p.f] : [p.id, r2(p.x), r2(p.y), p.d, p.m]);
      }
      c.dirty.clear();
      if (out.length) gateway.emit(keyOf(n), "mv", out);
    }
  }, opts.tickMs ?? 100);
  timer.unref?.();

  return {
    close() {
      clearInterval(timer);
      chans.clear();
      bySock.clear();
    },
    /** 관리자 · 테스트: 채널별 인원 */
    stats: () => [...chans.entries()].map(([ch, c]) => ({ ch, n: c.players.size })),
    _chans: chans,
  };
}
