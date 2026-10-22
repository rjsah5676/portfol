import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Deps } from "../deps";
import { AppError, bad, forbidden } from "../errors";
import type { LiveRoom } from "../http/admin";
import { RESTORED, RESTORE_GRACE_MS, type LiveGame } from "../live";
import type { Ctx } from "../realtime/gateway";
import { GUEST_MARK } from "../users";
import { BOT_POOL, CHARS, COIN_PACKS, GACHA, REWARD, ownKey, rollGacha, type Pull, type Wallet } from "../../../web/src/lib/town/data";
import type { CharId, LookId } from "../../../web/src/lib/town/assets";
import {
  BOT_LEVELS,
  BOT_ONE,
  MODES,
  botChoice,
  drawCards,
  newGame,
  oneExpire,
  play,
  pressOne,
  view,
  type BotLevel,
  type BotStyle,
  type GameMode,
  type OCEvent,
  type OCState,
} from "../../../web/src/lib/town/onecard";

/*
 * TABLE TOWN (테이블 타운) — 실시간 원카드 방
 *
 * 방은 메모리에만 두고(배포 때만 live.ts 로 저장 · 이어받기), 판 진행 · 봇 · 차례 시계는 전부 서버가 맡음.
 * 회원은 코인 · 코스튬 · 천장을 DB(town_profiles)에, 게스트(익명 로그인)는 자기 기기에 둠 —
 * 게스트에게는 판이 끝날 때 받을 코인만 알려 주고 화면이 기기에 더함.
 *
 * 구독 채널
 *   town.lobby { game }   방 목록 (로그인 없이도)
 *   town.room  { id }     방 상태 + (자리에 앉은 사람에겐) 내 손패가 든 판 상태 · 사건
 * 요청 (rpc)
 *   town.me · town.setLook · town.gacha                        회원 내 정보 · 장착 · 뽑기
 *   town.create · town.join · town.quick · town.leave           방 만들기 · 들어가기 · 빠른 입장 · 나가기
 *   town.kick · town.addBot · town.settings · town.approve      방장
 *   town.start · town.play · town.draw · town.one               진행
 *   town.chat · town.emote · town.look                          채팅 · 감정표현 · 내 모습 바꾸기
 */

const GAMES = ["onecard"] as const;
type GameId = (typeof GAMES)[number];

const MAX_ROOMS = 300;
const CHAT_KEEP = 40;
const EMPTY_TTL = 60_000;
const BOT_DELAY: [number, number] = [850, 1450];
/** 자리 주인이 없는(끊긴) 사람 차례는 빨리 넘김 */
const AWAY_MS = 2_500;
/** 사건 연출이 화면에서 끝날 시간 (봇이 너무 빨리 이어서 두지 않게) */
const EV_MS: Partial<Record<OCEvent["t"], number>> = { play: 420, draw: 260, shuffle: 300, skip: 300, reverse: 300, caught: 400, bust: 900, one: 200 };

interface BotDef {
  char: CharId;
  look: LookId;
  nick: string;
  style: BotStyle;
}
interface Seat {
  /** 사람 자리면 uid, 봇이면 null */
  uid: string | null;
  bot: BotDef | null;
  nick: string;
  char: CharId;
  look: LookId;
  member: boolean;
}
interface ChatMsg {
  seat: number;
  nick: string;
  text: string;
  ts: number;
  sys?: boolean;
}
interface Result {
  order: number[]; // 자리 번호, 1등부터
  out: number[];
  left: number[]; // 자리별 남은 장 수
  gain: number[]; // 자리별 받은 코인
  at: number;
}
interface Room {
  id: string;
  game: GameId;
  title: string;
  hostUid: string;
  max: number;
  mode: GameMode;
  pub: boolean;
  pw: string | null;
  autoJoin: boolean;
  botFill: boolean;
  level: BotLevel;
  seats: (Seat | null)[];
  kicked: Record<string, string>;
  /** 바로 입장이 꺼진 방: 방장 허락을 기다리는 사람 */
  knock: Record<string, { nick: string; char: CharId; look: LookId; member: boolean; at: number }>;
  access: string[];
  phase: "wait" | "play";
  st: OCState | null;
  /** 판 자리(0..n-1) → 방 자리 번호 */
  map: number[];
  result: Result | null;
  chat: ChatMsg[];
  createdAt: number;
  emptySince: number;
  // ── 저장하지 않는 것 ──
  owners: Map<string, string>;
  timer: ReturnType<typeof setTimeout> | null;
  oneTimers: ReturnType<typeof setTimeout>[];
  busyUntil: number;
}

const roomKey = (id: string) => `town:room:${id}`;
const lobbyKey = (g: GameId) => `town:lobby:${g}`;
const hashPw = (id: string, pw: string) => createHash("sha256").update(`town:${id}:${pw}`).digest("hex");
const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const plain = (nick: string) => nick.replaceAll(GUEST_MARK, "");
/** 서버가 내려갈 때 타이머가 붙잡지 않게 (브라우저 시험 화면에서도 돌게 있으면만) */
const unref = <T,>(t: T): T => ((t as { unref?: () => void }).unref?.(), t);

const CHAR_IDS = Object.keys(CHARS) as CharId[];
const charSchema = z.enum(CHAR_IDS as [CharId, ...CharId[]]);
const lookSchema = z.string().min(1).max(20) as unknown as z.ZodType<LookId>;
const idOnly = z.object({ id: z.string().regex(/^\d{4}$/) });
const nickSchema = z.string().max(20).default("");
const looksOf = (c: CharId) => Object.keys(CHARS[c].looks) as LookId[];

// ───────────── 회원 프로필 (코인 · 코스튬) ─────────────

interface ProfileDoc extends Wallet {
  _id: string;
  char: CharId;
  look: LookId;
  games: number;
  updatedAt: Date;
}
const START_COINS = 1000;

export interface TownOptions {
  /** 테스트에서 빨리 돌리기: 봇 생각 시간 · 끊긴 사람 자동 진행 · 연출 대기 배율 */
  botDelay?: [number, number];
  awayMs?: number;
  evScale?: number;
  sweepMs?: number;
}

export function registerTown({ db, gateway, users, points }: Deps, opts: TownOptions = {}) {
  const botDelay = opts.botDelay ?? BOT_DELAY;
  const awayMs = opts.awayMs ?? AWAY_MS;
  const evScale = opts.evScale ?? 1;
  const profiles = db.col<Omit<ProfileDoc, "_id">>("town_profiles");
  const rooms = new Map<string, Room>();
  let draining = false;

  async function loadProfile(uid: string): Promise<ProfileDoc> {
    const d = (await profiles.findOne({ _id: uid })) as ProfileDoc | null;
    if (d) return d;
    const fresh: ProfileDoc = { _id: uid, coins: START_COINS, owned: [], pity: 0, char: "haru", look: "base", games: 0, updatedAt: new Date() };
    // _id 는 거르기 조건에 이미 있어서 $setOnInsert 에 넣으면 안 됨 (null 로 바뀌어 "불변 필드 변경" 오류)
    const { _id, ...init } = fresh;
    await profiles.updateOne({ _id }, { $setOnInsert: init }, { upsert: true });
    return fresh;
  }
  const profileWire = (p: ProfileDoc) => ({ coins: p.coins, owned: p.owned, pity: p.pity, char: p.char, look: p.look, games: p.games });
  /** 회원만 (게스트는 기기에 저장) */
  const asMember = (ctx: Ctx) => {
    const uid = ctx.uid;
    if (!ctx.nick || ctx.user?.anonymous) throw forbidden("회원만 쓸 수 있어요.");
    return uid;
  };

  // 회원 한 사람의 프로필 바꾸기는 한 번에 하나씩 (뽑기 연타 · 판 정산이 겹쳐도 코인이 안 틀어지게)
  const locks = new Map<string, Promise<unknown>>();
  function withProfile<T>(uid: string, fn: (p: ProfileDoc) => T | Promise<T>): Promise<T> {
    const prev = locks.get(uid) ?? Promise.resolve();
    const run = prev.then(async () => {
      const p = await loadProfile(uid);
      const out = await fn(p);
      p.updatedAt = new Date();
      const { _id, ...rest } = p;
      await profiles.replaceOne({ _id }, rest, { upsert: true });
      return out;
    });
    const tail = run.catch(() => {});
    locks.set(uid, tail);
    void tail.then(() => {
      if (locks.get(uid) === tail) locks.delete(uid);
    });
    return run;
  }

  gateway.rpc("town.me", async (ctx) => {
    const uid = ctx.uid;
    if (!ctx.nick || ctx.user?.anonymous) return null;
    return profileWire(await loadProfile(uid));
  });

  gateway.rpc("town.setLook", async (ctx, raw) => {
    const uid = asMember(ctx);
    const { char, look } = z.object({ char: charSchema, look: lookSchema }).parse(raw);
    if (!looksOf(char).includes(look)) throw bad();
    return withProfile(uid, (p) => {
      if (look !== "base" && !p.owned.includes(ownKey(char, look))) throw forbidden("아직 없는 코스튬이에요.");
      p.char = char;
      p.look = look;
      return profileWire(p);
    });
  });

  gateway.rpc("town.gacha", async (ctx, raw) => {
    const uid = asMember(ctx);
    const { feat, n } = z.object({ feat: z.number().int().min(0).max(GACHA.pool.length - 1), n: z.union([z.literal(1), z.literal(10)]) }).parse(raw);
    return withProfile(uid, (p) => {
      const res = rollGacha(p, feat, n);
      if (typeof res === "string") throw new AppError("GACHA", res, 409);
      return { pulls: res as Pull[], me: profileWire(p) };
    });
  });

  /** 코인 상점: GP(사이트 포인트)로 코인 사기 — 회원만. GP 를 먼저 빼고, 코인 넣기가 실패하면 GP 를 돌려줌 */
  gateway.rpc("town.buyCoins", async (ctx, raw) => {
    const uid = asMember(ctx);
    const { pack } = z.object({ pack: z.enum(COIN_PACKS.map((p) => p.id) as [string, ...string[]]) }).parse(raw);
    const p = COIN_PACKS.find((x) => x.id === pack)!;
    const left = await points.spend(uid, p.gp, "town-coins", p.id);
    try {
      const me = await withProfile(uid, (pr) => {
        pr.coins += p.coins;
        return profileWire(pr);
      });
      return { points: left, me };
    } catch (e) {
      await points.grant(uid, p.gp, "town-coins-refund", p.id).catch(() => {});
      throw e;
    }
  });

  // ───────────── 마을 채팅 (마을에 있는 모두) ─────────────
  const SQUARE = "town:square";
  const square: { nick: string; char: CharId; look: LookId; text: string; ts: number; uid: string }[] = [];
  gateway.channel("town.square", { key: () => SQUARE, snapshot: () => square.slice(-30) });
  gateway.rpc("town.say", async (ctx, raw) => {
    const o = joinBody.extend({ text: z.string().min(1).max(60) }).parse(raw);
    const now = Date.now();
    if (now - (chatRate.get(`sq:${ctx.uid}`) ?? 0) < 1200) throw new AppError("RATE_LIMITED", "조금 천천히 보내 주세요.", 429);
    chatRate.set(`sq:${ctx.uid}`, now);
    const text = o.text.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim();
    if (!text) return null;
    const me = await whoAmI(ctx, o);
    const m = { nick: me.nick, char: me.char, look: me.look, text, ts: now, uid: ctx.uid };
    square.push(m);
    if (square.length > 60) square.splice(0, square.length - 60);
    gateway.emit(SQUARE, "say", m);
    return null;
  });

  /** 관리자: 내 코인 · 천장 · 보유 코스튬 바꾸기 (시험용) */
  gateway.rpc("town.adminSet", async (ctx, raw) => {
    ctx.requireAdmin();
    const uid = ctx.uid;
    const o = z
      .object({ coins: z.number().int().min(0).max(1e9), pity: z.number().int().min(0).max(GACHA.pity), owned: z.array(z.string().max(40)).max(50) })
      .parse(raw);
    const valid = new Set(CHAR_IDS.flatMap((c) => looksOf(c).filter((l) => l !== "base").map((l) => ownKey(c, l))));
    return withProfile(uid, (p) => {
      p.coins = o.coins;
      p.pity = o.pity;
      p.owned = [...new Set(o.owned.filter((k) => valid.has(k)))];
      if (p.look !== "base" && !p.owned.includes(ownKey(p.char, p.look))) p.look = "base";
      return profileWire(p);
    });
  });

  // ───────────── 방 → 화면 ─────────────

  const humans = (r: Room) => r.seats.filter((s): s is Seat => !!s && !!s.uid);
  const seatOf = (r: Room, uid: string) => r.seats.findIndex((s) => s?.uid === uid);

  function roomWire(r: Room) {
    return {
      id: r.id,
      game: r.game,
      title: r.title,
      hostUid: r.hostUid,
      max: r.max,
      mode: r.mode,
      pub: r.pub,
      locked: !!r.pw,
      autoJoin: r.autoJoin,
      botFill: r.botFill,
      level: r.level,
      phase: r.phase,
      seats: r.seats.map((s) =>
        s ? { uid: s.uid, bot: !!s.bot, nick: s.nick, char: s.char, look: s.look, member: s.member, away: !!s.uid && !r.owners.get(s.uid) } : null
      ),
      knock: Object.entries(r.knock).map(([uid, k]) => ({ uid, nick: k.nick, char: k.char, look: k.look })),
      result: r.result,
      chat: r.chat.slice(-20),
    };
  }
  function lobbyItem(r: Room) {
    const host = r.seats.find((s) => s?.uid === r.hostUid);
    return {
      id: r.id,
      title: r.title,
      host: host ? { nick: host.nick, char: host.char, look: host.look } : null,
      count: r.seats.filter(Boolean).length,
      humans: humans(r).length,
      max: r.max,
      mode: r.mode,
      locked: !!r.pw,
      autoJoin: r.autoJoin,
      level: r.level,
      phase: r.phase,
      createdAt: r.createdAt,
    };
  }
  const lobbyWire = (g: GameId) =>
    [...rooms.values()]
      .filter((r) => r.game === g && r.pub && humans(r).length > 0)
      .map(lobbyItem)
      .sort((a, b) => (a.phase === b.phase ? b.createdAt - a.createdAt : a.phase === "wait" ? -1 : 1))
      .slice(0, 60);

  let lobbyDirty = new Set<GameId>();
  function changed(r: Room) {
    gateway.emit(roomKey(r.id), "room", roomWire(r));
    if (!lobbyDirty.size) queueMicrotask(flushLobby);
    lobbyDirty.add(r.game);
  }
  function flushLobby() {
    const gs = lobbyDirty;
    lobbyDirty = new Set();
    for (const g of gs) gateway.emit(lobbyKey(g), "list", lobbyWire(g));
  }

  /** 판 상태를 사람마다 (자기 손패만) 보냄 */
  function sendGame(r: Room, ev: OCEvent[] = []) {
    const st = r.st;
    if (!st) return;
    const key = roomKey(r.id);
    for (const sock of gateway.subscribers(key)) {
      const uid = gateway.userOf(sock)?.uid;
      const seat = uid ? seatOf(r, uid) : -1;
      const pi = seat >= 0 ? r.map.indexOf(seat) : -1;
      gateway.emitTo(sock, key, "game", { v: view(st, pi), map: r.map, ev });
    }
  }

  function pushChat(r: Room, seat: number, nick: string, text: string, sys = false) {
    const m: ChatMsg = { seat, nick, text, ts: Date.now(), ...(sys && { sys: true }) };
    r.chat.push(m);
    if (r.chat.length > CHAT_KEEP) r.chat.splice(0, r.chat.length - CHAT_KEEP);
    gateway.emit(roomKey(r.id), "chat", m);
  }
  const sys = (r: Room, text: string) => pushChat(r, -1, "", text, true);

  // ───────────── 방 관리 ─────────────

  function newRoomNo(): string {
    for (let k = 0; k < 50; k++) {
      const id = String(randomInt(1000, 10000));
      if (!rooms.has(id)) return id;
    }
    throw bad("방이 너무 많아요. 잠시 후 다시 시도해주세요.");
  }
  function pickBot(r: Room): BotDef {
    const used = new Set(r.seats.filter(Boolean).map((s) => `${s!.char}:${s!.look}:${s!.nick}`));
    const taken = new Set(r.seats.filter(Boolean).map((s) => s!.nick));
    const free = BOT_POOL.filter((b) => !taken.has(b.nick) && !used.has(`${b.char}:${b.look}:${b.nick}`));
    const b = free.length ? free[randomInt(free.length)] : BOT_POOL[randomInt(BOT_POOL.length)];
    return { char: b.char, look: b.look, nick: free.length ? b.nick : `${b.nick}${randomInt(2, 10)}`, style: b.style };
  }
  const botSeat = (b: BotDef): Seat => ({ uid: null, bot: b, nick: b.nick, char: b.char, look: b.look, member: false });

  function removeRoom(r: Room) {
    clearTimers(r);
    rooms.delete(r.id);
    gateway.emit(roomKey(r.id), "room", null);
    if (!lobbyDirty.size) queueMicrotask(flushLobby);
    lobbyDirty.add(r.game);
  }

  /** 방장이 없어졌으면 가장 먼저 앉은 사람이 이어받음 */
  function fixHost(r: Room) {
    if (r.seats.some((s) => s?.uid === r.hostUid)) return;
    const h = humans(r)[0];
    if (h?.uid) {
      r.hostUid = h.uid;
      sys(r, `${plain(h.nick)}님이 방장이 됐어요.`);
    }
  }

  /** 자리 비우기 (나가기 · 끊김 · 강퇴). 판 중이면 자리는 남기고 자동으로 둠 */
  function vacate(r: Room, uid: string, _why: "leave" | "drop" | "kick") {
    delete r.knock[uid];
    const i = seatOf(r, uid);
    if (i < 0) return changed(r);
    r.owners.delete(uid);
    // 판 중이면 판은 이어 감 (그 자리는 자동으로 둠) — 판이 끝나면 비움
    if (r.phase === "play" && r.map.includes(i)) schedule(r);
    else r.seats[i] = null;
    fixHost(r);
    if (!humans(r).some((s) => r.owners.has(s.uid!))) r.emptySince = Date.now();
    changed(r);
  }

  function seatFree(r: Room) {
    return r.seats.findIndex((s) => !s);
  }
  function sit(r: Room, uid: string, p: { nick: string; char: CharId; look: LookId; member: boolean }, sock: string): number {
    let i = seatOf(r, uid);
    if (i < 0) {
      i = seatFree(r);
      // 봇 자리를 사람에게 (대기 중일 때만)
      if (i < 0 && r.phase === "wait") i = r.seats.findIndex((s) => !!s?.bot);
      if (i < 0) throw new AppError("ROOM_FULL", "방이 가득 찼어요.", 409);
      r.seats[i] = { uid, bot: null, ...p };
    } else {
      const s = r.seats[i]!;
      // 판 중엔 모습은 그대로 (그림이 바뀌면 헷갈림)
      r.seats[i] = r.phase === "play" ? { ...s, nick: p.nick } : { ...s, ...p };
    }
    r.owners.set(uid, sock);
    delete r.knock[uid];
    return i;
  }

  const joinBody = z.object({
    nick: nickSchema,
    char: charSchema,
    look: lookSchema,
  });
  type JoinBody = z.infer<typeof joinBody>;
  /** 들어갈 때의 내 이름 · 모습 (회원은 서버에 저장된 모습만, 게스트는 기기에서 보낸 것) */
  async function whoAmI(ctx: Ctx, b: JoinBody) {
    const member = !!ctx.nick && !ctx.user?.anonymous;
    if (member) {
      const p = await loadProfile(ctx.uid);
      return { nick: ctx.nick!, char: p.char, look: p.look, member };
    }
    const typed = b.nick.trim();
    if (!/^[가-힣a-zA-Z0-9_]{2,10}$/.test(typed)) throw bad("닉네임은 한글 · 영문 · 숫자 2~10자예요.");
    if (RESERVED.some((w) => typed.toLowerCase().includes(w))) throw bad("쓸 수 없는 닉네임이에요.");
    // 게스트는 코스튬을 기기에 둬서 서버가 확인할 수 없음 — 기본 · 코스튬 모두 그림만 바뀌는 것이라 그대로 믿음
    const look = looksOf(b.char).includes(b.look) ? b.look : "base";
    return { nick: ctx.name(typed), char: b.char, look, member };
  }

  const createSchema = joinBody.extend({
    game: z.enum(GAMES).default("onecard"),
    title: z.string().max(40).default(""),
    max: z.number().int().min(2).max(4).default(4),
    mode: z.enum(["normal", "fast"]).default("normal"),
    pub: z.boolean().default(true),
    password: z.string().max(8).default(""),
    autoJoin: z.boolean().default(true),
    botFill: z.boolean().default(true),
    level: z.number().int().min(0).max(2).default(1),
  });
  type CreateOpts = z.infer<typeof createSchema>;

  async function createRoom(ctx: Ctx, o: CreateOpts): Promise<Room> {
    const uid = ctx.uid;
    if (draining) throw new AppError("RESTARTING", "서버를 곧 다시 시작해요. 잠시 후 방을 만들어 주세요.", 503);
    if (rooms.size >= MAX_ROOMS) throw bad("방이 너무 많아요. 잠시 후 다시 시도해주세요.");
    const me = await whoAmI(ctx, o);
    // 이미 다른 방에 앉아 있으면 거기서 나옴
    for (const r of rooms.values()) if (seatOf(r, uid) >= 0) vacate(r, uid, "leave");
    const pw = o.password.trim();
    if (pw && !/^\d{4}$/.test(pw)) throw bad("비밀번호는 숫자 4자리예요.");
    const id = newRoomNo();
    const now = Date.now();
    const r: Room = {
      id,
      game: o.game,
      title: o.title.replace(/\s+/g, " ").trim().slice(0, 20) || `${plain(me.nick)}의 방`,
      hostUid: uid,
      max: o.max,
      mode: o.mode,
      pub: o.pub,
      pw: pw ? hashPw(id, pw) : null,
      autoJoin: o.autoJoin,
      botFill: o.botFill,
      level: o.level as BotLevel,
      seats: Array(o.max).fill(null),
      kicked: {},
      knock: {},
      access: [],
      phase: "wait",
      st: null,
      map: [],
      result: null,
      chat: [],
      createdAt: now,
      emptySince: now,
      owners: new Map(),
      timer: null,
      oneTimers: [],
      busyUntil: 0,
    };
    rooms.set(id, r);
    sit(r, uid, me, ctx.socket.id);
    // 봇 채우기가 켜져 있으면 처음부터 한 명 앉혀 둠 (혼자 들어와도 바로 시작 가능)
    if (o.botFill && r.max > 1) r.seats[1] = botSeat(pickBot(r));
    sys(r, `${plain(me.nick)}님이 방을 만들었어요.`);
    changed(r);
    return r;
  }

  gateway.rpc("town.create", async (ctx, raw) => {
    const r = await createRoom(ctx, createSchema.parse(raw));
    return { id: r.id, seat: seatOf(r, ctx.uid) };
  });

  const joinSchema = joinBody.extend({ id: z.string().regex(/^\d{4}$/), password: z.string().max(8).optional() });
  const tries = new Map<string, { at: number; n: number }>();
  gateway.rpc("town.join", async (ctx, raw) => {
    const o = joinSchema.parse(raw);
    const uid = ctx.uid;
    const r = rooms.get(o.id);
    if (!r) throw new AppError("NO_ROOM", "없어진 방이에요.", 404);
    if (r.kicked[uid] !== undefined) throw forbidden("방장이 이 방에서 내보냈어요.");
    const already = seatOf(r, uid) >= 0;
    if (!already && r.pw && r.hostUid !== uid && !r.access.includes(uid)) {
      const k = `${o.id}/${uid}`,
        now = Date.now(),
        t = tries.get(k);
      if (!t || now - t.at > 60_000) tries.set(k, { at: now, n: 1 });
      else if (++t.n > 8) throw new AppError("RATE_LIMITED", "잠시 후 다시 시도해주세요.", 429);
      if (tries.size > 5000) tries.clear();
      if (!o.password) throw new AppError("NEED_PASSWORD", "비밀번호가 필요한 방이에요.", 403);
      if (!safeEqual(hashPw(r.id, o.password), r.pw)) throw new AppError("WRONG_PASSWORD", "비밀번호가 맞지 않아요.", 403);
      r.access.push(uid);
    }
    const me = await whoAmI(ctx, o);
    if (!already) {
      if (r.phase === "play") throw new AppError("PLAYING", "지금 게임 중인 방이에요. 끝나면 들어갈 수 있어요.", 409);
      // 바로 입장이 꺼져 있으면 방장 허락을 기다림
      if (!r.autoJoin && r.hostUid !== uid) {
        r.knock[uid] = { ...me, at: Date.now() };
        changed(r);
        return { id: r.id, seat: -1, knock: true };
      }
      for (const other of rooms.values()) if (other !== r && seatOf(other, uid) >= 0) vacate(other, uid, "leave");
    }
    const seat = sit(r, uid, me, ctx.socket.id);
    if (!already) sys(r, `${plain(me.nick)}님이 들어왔어요.`);
    changed(r);
    if (r.st) sendGame(r);
    return { id: r.id, seat };
  });

  /** 빠른 입장: 빈 자리 있는 공개 방 → 없으면 새 방 */
  gateway.rpc("town.quick", async (ctx, raw) => {
    const o = joinBody.extend({ game: z.enum(GAMES).default("onecard") }).parse(raw);
    const uid = ctx.uid;
    const cand = [...rooms.values()]
      .filter((r) => r.game === o.game && r.pub && !r.pw && r.autoJoin && r.phase === "wait" && r.kicked[uid] === undefined && humans(r).length > 0)
      .filter((r) => r.seats.some((s) => !s || !!s.bot) && seatOf(r, uid) < 0)
      .sort((a, b) => humans(b).length - humans(a).length);
    const me = await whoAmI(ctx, o);
    const r = cand[0];
    if (r) {
      for (const other of rooms.values()) if (other !== r && seatOf(other, uid) >= 0) vacate(other, uid, "leave");
      const seat = sit(r, uid, me, ctx.socket.id);
      sys(r, `${plain(me.nick)}님이 들어왔어요.`);
      changed(r);
      return { id: r.id, seat, made: false };
    }
    const nr = await createRoom(ctx, createSchema.parse({ ...o, game: o.game }));
    return { id: nr.id, seat: seatOf(nr, uid), made: true };
  });

  gateway.rpc("town.leave", (ctx, raw) => {
    const r = rooms.get(idOnly.parse(raw).id);
    if (!r) return null;
    const uid = ctx.uid;
    const i = seatOf(r, uid);
    if (i >= 0) sys(r, `${plain(r.seats[i]!.nick)}님이 나갔어요.`);
    vacate(r, uid, "leave");
    if (!humans(r).length) removeRoom(r);
    return null;
  });

  gateway.onDisconnect((ctx) => {
    const uid = ctx.user?.uid;
    if (!uid) return;
    for (const r of [...rooms.values()]) {
      if (r.knock[uid]) {
        delete r.knock[uid];
        changed(r);
      }
      if (r.owners.get(uid) !== ctx.socket.id) continue;
      if (r.phase === "play" && r.map.includes(seatOf(r, uid))) {
        // 판 중에 끊김: 자리는 지키고 자동으로 둠 (돌아오면 이어서)
        r.owners.delete(uid);
        changed(r);
        schedule(r);
      } else vacate(r, uid, "drop");
    }
  });

  // ───────────── 방장 ─────────────

  function asHost(ctx: Ctx, id: string) {
    const r = rooms.get(id);
    if (!r) throw new AppError("NO_ROOM", "없어진 방이에요.", 404);
    if (r.hostUid !== ctx.uid) throw forbidden("방장만 할 수 있어요.");
    return r;
  }

  gateway.rpc("town.kick", (ctx, raw) => {
    const { id, seat } = z.object({ id: z.string(), seat: z.number().int().min(0).max(3) }).parse(raw);
    const r = asHost(ctx, id);
    if (r.phase === "play") throw bad("게임 중에는 내보낼 수 없어요.");
    const s = r.seats[seat];
    if (!s || s.uid === r.hostUid) return null;
    if (s.uid) {
      r.kicked[s.uid] = s.nick;
      gateway.emit(roomKey(r.id), "kicked", { uid: s.uid });
      sys(r, `${plain(s.nick)}님을 내보냈어요.`);
      vacate(r, s.uid, "kick");
    } else {
      r.seats[seat] = null;
      changed(r);
    }
    return null;
  });

  gateway.rpc("town.addBot", (ctx, raw) => {
    const r = asHost(ctx, idOnly.parse(raw).id);
    if (r.phase === "play") return null;
    const i = seatFree(r);
    if (i < 0) throw bad("자리가 다 찼어요.");
    r.seats[i] = botSeat(pickBot(r));
    changed(r);
    return null;
  });

  gateway.rpc("town.settings", (ctx, raw) => {
    const o = z
      .object({
        id: z.string(),
        title: z.string().max(40).optional(),
        max: z.number().int().min(2).max(4).optional(),
        mode: z.enum(["normal", "fast"]).optional(),
        pub: z.boolean().optional(),
        password: z.string().max(8).optional(),
        autoJoin: z.boolean().optional(),
        botFill: z.boolean().optional(),
        level: z.number().int().min(0).max(2).optional(),
      })
      .parse(raw);
    const r = asHost(ctx, o.id);
    if (r.phase === "play") throw bad("게임이 끝난 뒤에 바꿀 수 있어요.");
    if (o.title !== undefined) r.title = o.title.replace(/\s+/g, " ").trim().slice(0, 20) || r.title;
    if (o.mode) r.mode = o.mode;
    if (o.pub !== undefined) r.pub = o.pub;
    if (o.password !== undefined) {
      const pw = o.password.trim();
      if (pw && !/^\d{4}$/.test(pw)) throw bad("비밀번호는 숫자 4자리예요.");
      r.pw = pw ? hashPw(r.id, pw) : null;
      r.access = [];
    }
    if (o.autoJoin !== undefined) r.autoJoin = o.autoJoin;
    if (o.botFill !== undefined) r.botFill = o.botFill;
    if (o.level !== undefined) r.level = o.level as BotLevel;
    if (o.max !== undefined && o.max !== r.max) {
      // 줄일 땐 뒤쪽 봇 자리부터 비움 (사람이 앉은 자리는 못 없앰)
      const seats = [...r.seats];
      while (seats.length > o.max) {
        const k = seats.map((s, i) => (!s || s.bot ? i : -1)).filter((i) => i >= 0).pop();
        if (k === undefined) throw bad("사람이 앉은 자리는 없앨 수 없어요.");
        seats.splice(k, 1);
      }
      while (seats.length < o.max) seats.push(null);
      r.seats = seats;
      r.max = o.max;
    }
    changed(r);
    return null;
  });

  gateway.rpc("town.approve", (ctx, raw) => {
    const { id, uid, ok } = z.object({ id: z.string(), uid: z.string().max(128), ok: z.boolean() }).parse(raw);
    const r = asHost(ctx, id);
    const k = r.knock[uid];
    if (!k) return null;
    delete r.knock[uid];
    if (!ok || r.phase === "play") {
      gateway.emit(roomKey(r.id), "denied", { uid });
      return changed(r);
    }
    const sock = gateway.subscribers(roomKey(r.id)).find((s) => gateway.userOf(s)?.uid === uid);
    if (!sock) return changed(r);
    try {
      sit(r, uid, k, sock.id);
      sys(r, `${plain(k.nick)}님이 들어왔어요.`);
    } catch (e) {
      gateway.emit(roomKey(r.id), "denied", { uid });
      if (!(e instanceof AppError)) throw e;
    }
    changed(r);
    return null;
  });

  // ───────────── 진행 ─────────────

  function clearTimers(r: Room) {
    if (r.timer) clearTimeout(r.timer);
    r.timer = null;
    r.oneTimers.forEach(clearTimeout);
    r.oneTimers = [];
  }

  gateway.rpc("town.start", (ctx, raw) => {
    const r = asHost(ctx, idOnly.parse(raw).id);
    if (r.phase === "play") return null;
    if (draining) throw new AppError("RESTARTING", "서버를 곧 다시 시작해요. 잠시 후 시작해 주세요.", 503);
    if (r.botFill) for (let i = 0; i < r.max; i++) if (!r.seats[i]) r.seats[i] = botSeat(pickBot(r));
    const map = r.seats.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    if (map.length < 2) throw bad("2명 이상이어야 시작할 수 있어요. 봇을 앉혀 보세요.");
    r.map = map;
    r.st = newGame(map.length, Math.random, Date.now(), MODES[r.mode]);
    r.phase = "play";
    r.result = null;
    r.busyUntil = Date.now() + 1200 * evScale; // 나눠 주는 연출
    for (const s of humans(r)) users.bump(s.uid!, { "stats.town.games": 1 });
    changed(r);
    sendGame(r, []);
    schedule(r);
    return null;
  });

  const evDelay = (ev: OCEvent[]) => evScale * ev.reduce((a, e) => a + (EV_MS[e.t] ?? 120) * (e.t === "draw" ? Math.min(e.n, 5) : 1), 0);

  /** 사건을 적용한 뒤: 화면에 보내고 다음 할 일을 잡음 */
  function after(r: Room, ev: OCEvent[] | null) {
    if (!ev || !r.st) return;
    r.busyUntil = Date.now() + evDelay(ev);
    sendGame(r, ev);
    if (r.st.over) return void finishGame(r);
    if (ev.some((e) => e.t === "one")) armOne(r);
    schedule(r);
  }

  /** 다음 차례 준비: 봇 · 자리 비운 사람이면 자동으로, 사람이면 시간 초과 때 자동 받기 */
  function schedule(r: Room) {
    if (r.timer) clearTimeout(r.timer);
    r.timer = null;
    const st = r.st;
    if (!st || st.over || r.phase !== "play") return;
    const seat = r.seats[r.map[st.turn]];
    const seq = st.seq;
    const wait = Math.max(0, r.busyUntil - Date.now());
    const away = !!seat?.uid && !r.owners.get(seat.uid);
    if (!seat || seat.bot || away) {
      const ms = wait + (seat?.bot ? rnd(...botDelay) : awayMs);
      r.timer = setTimeout(() => {
        if (r.st !== st || st.seq !== seq || st.over) return;
        const lv: BotLevel = seat?.bot ? r.level : 1;
        const ch = botChoice(st, st.turn, seat?.bot?.style ?? "normal", Math.random, lv);
        after(r, ch ? play(st, st.turn, ch.id, ch.suit) : drawCards(st, st.turn));
      }, ms);
      return;
    }
    // 사람: 시계는 화면 연출이 끝난 뒤부터
    st.deadline = Date.now() + wait + st.turnMs;
    r.timer = setTimeout(() => {
      if (r.st !== st || st.seq !== seq || st.over) return;
      after(r, drawCards(st, st.turn, Math.random, Date.now(), true));
    }, st.deadline - Date.now() + 300);
  }

  /** 원카드 창: 봇은 스스로 외치거나 남을 잡고, 시간이 지나면 +1장 */
  function armOne(r: Room) {
    const st = r.st!;
    const o = st.one;
    if (!o) return;
    r.oneTimers.forEach(clearTimeout);
    r.oneTimers = [];
    const owner = r.seats[r.map[o.pi]];
    const lvOf = (s: Seat | null | undefined): BotLevel => (s?.bot ? r.level : 1);
    if (owner?.bot) {
      const cfg = BOT_ONE[lvOf(owner)];
      if (Math.random() > cfg.miss)
        r.oneTimers.push(setTimeout(() => st.one === o && after(r, pressOne(st, o.pi)), rnd(cfg.react[0] * 0.6, cfg.react[1] * 0.8)));
    }
    // 잡기: 다른 봇들 (외치기 전에 먼저 누르면)
    r.map.forEach((seatIdx, pi) => {
      const s = r.seats[seatIdx];
      if (pi === o.pi || !s?.bot || st.out[pi]) return;
      const cfg = BOT_ONE[lvOf(s)];
      if (Math.random() < cfg.catch) r.oneTimers.push(setTimeout(() => st.one === o && !o.called && after(r, pressOne(st, pi)), rnd(cfg.react[0], cfg.react[1])));
    });
    r.oneTimers.push(setTimeout(() => st.one === o && after(r, oneExpire(st)), o.until - Date.now()));
  }

  function finishGame(r: Room) {
    const st = r.st!;
    clearTimers(r);
    const n = r.map.length;
    const gain = Array(r.max).fill(0);
    const left = Array(r.max).fill(0);
    st.order.forEach((pi, rank) => {
      const seat = r.map[pi];
      left[seat] = st.hands[pi].length;
      // 인원이 적은 판은 아래 등수 보상부터 뺌 (2인: 1등 · 4등 몫)
      const table = n === 2 ? [REWARD[0], REWARD[3]] : n === 3 ? [REWARD[0], REWARD[1], REWARD[3]] : [...REWARD];
      gain[seat] = st.out[pi] ? 0 : table[rank];
    });
    r.result = { order: st.order.map((pi) => r.map[pi]), out: r.map.filter((_, pi) => st.out[pi]), left, gain, at: Date.now() };
    r.phase = "wait";
    // 회원 코인 · 판 수
    for (const [seat, s] of r.seats.entries()) {
      if (!s?.uid || !r.map.includes(seat)) continue;
      if (s.member)
        void withProfile(s.uid, (p) => {
          p.coins += gain[seat];
          p.games++;
        }).catch((e) => console.error("[town] 정산 실패", e));
      if (r.result.order[0] === seat && n >= 3) users.bump(s.uid, { "stats.town.wins": 1 });
    }
    // 판 중에 나간 사람 자리 정리
    for (const [i, s] of r.seats.entries()) if (s?.uid && !r.owners.get(s.uid)) r.seats[i] = null;
    fixHost(r);
    r.st = null;
    r.map = [];
    changed(r);
    if (!humans(r).length) removeRoom(r);
  }

  const actSchema = z.object({ id: z.string(), seq: z.number().int() });
  function asPlayer(ctx: Ctx, id: string) {
    const r = rooms.get(id);
    if (!r || !r.st || r.phase !== "play") throw new AppError("NOT_PLAYING", "진행 중인 판이 없어요.", 409);
    const seat = seatOf(r, ctx.uid);
    const pi = r.map.indexOf(seat);
    if (pi < 0) throw forbidden();
    // 돌아온 연결이면 자리 주인으로
    if (r.owners.get(ctx.uid) !== ctx.socket.id) r.owners.set(ctx.uid, ctx.socket.id);
    return { r, st: r.st, pi };
  }

  gateway.rpc("town.play", (ctx, raw) => {
    const o = actSchema.extend({ card: z.number().int(), suit: z.number().int().min(0).max(3).optional() }).parse(raw);
    const { r, st, pi } = asPlayer(ctx, o.id);
    if (st.seq !== o.seq || st.turn !== pi) return { ok: false };
    const ev = play(st, pi, o.card, o.suit);
    if (!ev) return { ok: false };
    after(r, ev);
    return { ok: true };
  });

  gateway.rpc("town.draw", (ctx, raw) => {
    const o = actSchema.parse(raw);
    const { r, st, pi } = asPlayer(ctx, o.id);
    if (st.seq !== o.seq || st.turn !== pi) return { ok: false };
    after(r, drawCards(st, pi));
    return { ok: true };
  });

  gateway.rpc("town.one", (ctx, raw) => {
    const { r, st, pi } = asPlayer(ctx, idOnly.parse(raw).id);
    const ev = pressOne(st, pi);
    if (!ev) return { ok: false };
    after(r, ev);
    return { ok: true };
  });

  // ───────────── 채팅 · 감정표현 · 모습 ─────────────

  const chatRate = new Map<string, number>();
  gateway.rpc("town.chat", (ctx, raw) => {
    const { id, text } = z.object({ id: z.string(), text: z.string().min(1).max(60) }).parse(raw);
    const r = rooms.get(id);
    if (!r) return null;
    const i = seatOf(r, ctx.uid);
    if (i < 0) throw forbidden();
    const now = Date.now();
    if (now - (chatRate.get(ctx.uid) ?? 0) < 600) throw new AppError("RATE_LIMITED", "조금 천천히 보내 주세요.", 429);
    chatRate.set(ctx.uid, now);
    if (chatRate.size > 5000) chatRate.clear();
    const clean = text.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim();
    if (!clean) return null;
    pushChat(r, i, r.seats[i]!.nick, clean);
    // 봇이 가끔 대꾸 (대기 중에만)
    const bots = r.seats.map((s, k) => (s?.bot ? k : -1)).filter((k) => k >= 0);
    if (r.phase === "wait" && bots.length && Math.random() < 0.5) {
      const k = bots[randomInt(bots.length)];
      const b = r.seats[k]!;
      const lines = CHARS[b.char].lines.town;
      unref(setTimeout(() => rooms.get(id) === r && r.seats[k] === b && pushChat(r, k, b.nick, lines[randomInt(lines.length)]), rnd(700, 1500)));
    }
    return null;
  });

  const EMOTES = ["좋아요!", "헉…!", "ㅋㅋㅋ", "화이팅!", "미안~", "고마워!"];
  gateway.rpc("town.emote", (ctx, raw) => {
    const { id, e } = z.object({ id: z.string(), e: z.number().int().min(0).max(EMOTES.length - 1) }).parse(raw);
    const r = rooms.get(id);
    if (!r) return null;
    const i = seatOf(r, ctx.uid);
    if (i < 0) throw forbidden();
    const now = Date.now();
    if (now - (chatRate.get(`e:${ctx.uid}`) ?? 0) < 900) return null;
    chatRate.set(`e:${ctx.uid}`, now);
    gateway.emit(roomKey(r.id), "emote", { seat: i, text: EMOTES[e] });
    return null;
  });

  /** 대기 중에 내 모습 바꾸기 (캐릭터 · 스킨 화면에서 바꾼 뒤) */
  gateway.rpc("town.look", async (ctx, raw) => {
    const o = joinBody.extend({ id: z.string() }).parse(raw);
    const r = rooms.get(o.id);
    if (!r || r.phase === "play") return null;
    const i = seatOf(r, ctx.uid);
    if (i < 0) return null;
    const me = await whoAmI(ctx, o);
    r.seats[i] = { ...r.seats[i]!, ...me };
    changed(r);
    return null;
  });

  // ───────────── 구독 ─────────────

  gateway.channel("town.lobby", {
    key: (_ctx, p) => lobbyKey(z.object({ game: z.enum(GAMES).default("onecard") }).parse(p ?? {}).game),
    snapshot: (_ctx, _k, p) => lobbyWire(z.object({ game: z.enum(GAMES).default("onecard") }).parse(p ?? {}).game),
  });

  gateway.channel("town.room", {
    key(ctx, p) {
      void ctx.uid;
      return roomKey(idOnly.parse(p).id);
    },
    snapshot(ctx, _k, p) {
      const r = rooms.get(idOnly.parse(p).id);
      if (!r) return null;
      const uid = ctx.user?.uid;
      // 끊겼다 돌아온 연결 / 배포 뒤 처음 붙은 연결 → 그 자리의 주인으로
      if (uid && seatOf(r, uid) >= 0 && (r.owners.get(uid) === RESTORED || !r.owners.get(uid))) {
        r.owners.set(uid, ctx.socket.id);
        queueMicrotask(() => changed(r));
      }
      const seat = uid ? seatOf(r, uid) : -1;
      const pi = r.st && seat >= 0 ? r.map.indexOf(seat) : -1;
      return { room: roomWire(r), game: r.st ? { v: view(r.st, pi), map: r.map, ev: [] } : null };
    },
  });

  // 빈 방 정리
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const r of [...rooms.values()]) {
      const live = humans(r).some((s) => r.owners.get(s.uid!));
      if (!live && now - r.emptySince > EMPTY_TTL) removeRoom(r);
    }
  }, opts.sweepMs ?? 20_000);
  unref(sweep);

  // ───────────── 배포 때 이어받기 ─────────────

  const live: LiveGame = {
    busy: () => [...rooms.values()].some((r) => r.phase === "play" && humans(r).some((s) => r.owners.get(s.uid!))),
    drain() {
      draining = true;
    },
    snapshot: () =>
      [...rooms.values()].map((r) => {
        const { owners: _o, timer: _t, oneTimers: _ot, busyUntil: _b, ...rest } = r;
        return rest;
      }),
    restore(data, downMs) {
      for (const d of data as Omit<Room, "owners" | "timer" | "oneTimers" | "busyUntil">[]) {
        const r: Room = { ...d, owners: new Map(), timer: null, oneTimers: [], busyUntil: 0 };
        for (const s of humans(r)) r.owners.set(s.uid!, RESTORED);
        if (r.st) {
          r.st.deadline += downMs;
          if (r.st.one) r.st.one.until += downMs;
        }
        rooms.set(r.id, r);
        if (r.st) {
          if (r.st.one) armOne(r);
          schedule(r);
        }
      }
      setTimeout(() => {
        for (const r of [...rooms.values()])
          for (const [uid, o] of [...r.owners]) if (o === RESTORED) (r.owners.delete(uid), r.phase === "play" ? schedule(r) : vacate(r, uid, "drop"));
      }, RESTORE_GRACE_MS).unref();
    },
  };

  return {
    live,
    close() {
      clearInterval(sweep);
      for (const r of rooms.values()) clearTimers(r);
    },
    adminList(): LiveRoom[] {
      return [...rooms.values()].map((r) => ({
        id: r.id,
        name: r.title,
        status: r.phase === "play" ? "play" : "waiting",
        players: r.seats.filter(Boolean).map((s) => (s!.bot ? `${s!.nick}(봇)` : s!.nick)),
        createdAt: r.createdAt,
      }));
    },
    adminClose(id: string): boolean {
      const r = rooms.get(id);
      if (r) removeRoom(r);
      return !!r;
    },
    /** 테스트용: 방 상태 들여다보기 */
    _rooms: rooms,
  };
}

/** 게스트 닉네임에 쓸 수 없는 말 (운영자 사칭 · 기본 욕설 일부) */
const RESERVED = ["admin", "관리자", "운영자", "운영진", "system", "시스템", "건모", "gunmo", "씨발", "시발", "병신", "좆", "개새", "새끼", "fuck", "shit"];
export { BOT_LEVELS };
