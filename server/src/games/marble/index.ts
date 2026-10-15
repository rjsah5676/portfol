import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Deps } from "../../deps";
import { AppError, bad, forbidden, notFound } from "../../errors";
import { newId } from "../../ids";
import type { Ctx } from "../../realtime/gateway";
import { pictureOf } from "../../users";
import { uniqueNickname } from "../poker/nicknames";
import { createMarbleMeta } from "./meta";
import { CHARS, ITEMS, charOn, type Grade, type Loadout } from "../../../../web/src/lib/marble/data";
import { ActError, act, newGame, standings, timeoutAction, type Action, type Ev, type Game } from "../../../../web/src/lib/marble/engine";
import { botAction, type BotStyle } from "../../../../web/src/lib/marble/bot";
import { MAP_IDS, type MapId } from "../../../../web/src/lib/marble/maps";
import type { LadderWire, LobbyRoom, RoomWire, SeatWire } from "../../../../web/src/lib/marble/wire";
import { LADDER_ROWS, makeRungs, trace } from "../../../../web/src/lib/marble/ladder";

/*
 * DICE TOWN 온라인 — 방(서버 메모리) · AI 입장 · 판 진행(서버가 엔진을 돌림) · 보상.
 *
 *  로비 marble:lobby            방 목록
 *  방   marble:room:<id>        방 상태 전체 (판 상태 · 이번에 생긴 일 ev · 마감 시각)
 *  판은 모두 공개 정보라 그대로 보냄 — 단 난수 상태(rng)는 빼고 (다음 주사위가 보이지 않게)
 *
 * 방 설정은 ANIME POKER 와 같음: 「바로 입장 허용」(quick) · 「AI 입장 허용」(bots, 바로 입장 허용일 때만).
 * AI 는 사람이 앉아 있는 대기 방을 돌며 들어가고, 로비가 비어 보이지 않게 AI 가 연 대기 방도 몇 개 유지.
 * 판 도중 나가면 그 자리는 AI 가 이어서 하고(자동 진행) 진 것으로 침.
 */

/** 프롬프트별 사람 제한 시간 */
/** 사다리: 고르는 시간 · 결과 보여 주는 시간 */
const LADDER_PICK_MS = 6_000;
const LADDER_SHOW_MS = 2_600;
/** 판 시작 직후 내 순번 보여 주는 시간 */
const INTRO_MS = 1_900;
const LIMIT: Record<string, number> = { turn: 15_000, post: 10_000, fork: 8_000, buy: 12_000, acq: 10_000, fest: 10_000 };
/** 제한 시간을 연달아 넘기면 자동 진행 */
const AUTO_AFTER_TIMEOUTS = 2;
/** 판 도중 끊긴 채 이만큼 지나면 자동 진행 */
const AWAY_AUTO_MS = 30_000;
const MAX_ROOMS = 120;
const CHAT_KEEP = 40;
const RESULT_MS = 12_000;
const EMPTY_TTL_MS = 20_000;

interface Seat {
  uid: string | null;
  name: string;
  lo: Loadout;
  ready: boolean;
  /** AI (null = 사람) */
  bot: BotStyle | null;
  /** 사람 자리인데 AI 가 대신 하는 중 */
  auto: boolean;
  /** 판 도중 나감 (보상 없음) */
  left: boolean;
  /** 끊긴 시각 (0 = 접속 중) */
  away: number;
  timeouts: number;
  /** 회원 사진 */
  avatar: string | null;
}

interface Room {
  id: string;
  name: string;
  /** 방장 uid ("" = AI 가 연 방) */
  owner: string;
  map: MapId;
  max: number;
  quick: boolean;
  bots: boolean;
  pw: string | null;
  phase: "wait" | "play" | "end";
  seats: (Seat | null)[];
  game: Game | null;
  /** 판 플레이어 번호 → 자리 번호 */
  order: number[];
  /** 연출이 끝나는 시각 · AI 가 둘 시각 · 사람 마감 */
  busyUntil: number;
  actAt: number;
  deadline: number;
  seq: number;
  /** 이번 상태로 오기까지 생긴 일 (보낸 뒤 비움) */
  ev: Ev[];
  result: { seat: number; name: string; place: number; stars?: number; first?: boolean; bot: boolean }[] | null;
  /** 모두 준비 → 시작 시각 */
  startAt: number;
  createdAt: number;
  emptySince: number;
  botNext: number;
  /** AI 가 연 방: 사람이 안 오면 이때 닫음 */
  botRoomUntil: number;
  chat: { name: string; text: string; at: number; bot?: boolean }[];
  /** 방장이 내보낸 사람 (이 방엔 다시 못 들어옴) */
  kicked: Set<string>;
  /** 시작 전 사다리 (phase 는 play, game 은 아직 없음) */
  ladder: (LadderWire & { seats: number[]; botAt: number[] }) | null;
}

const hashPw = (id: string, pw: string) => createHash("sha256").update(`${id}:${pw}`).digest("hex");
const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const rnd = (n: number) => randomInt(0, Math.max(1, n));
const rand01 = () => randomInt(0, 1 << 30) / (1 << 30);

/** 연출 시간 어림 (화면의 애니메이션 길이와 맞춤 — components/Marble/anim.ts) */
export function animMs(evs: Ev[]): number {
  let t = 0;
  for (const e of evs) {
    switch (e.t) {
      case "roll":
        t += e.power !== undefined ? 1500 : 1100;
        break;
      case "move":
        t += e.rail ? 1300 : e.warp ? 700 : 250 + 210 * e.path.length;
        break;
      case "pay":
        t += 650;
        break;
      case "buy":
      case "acq":
        t += 800;
        break;
      case "card":
        t += 1700;
        break;
      case "skill":
        t += 1200;
        break;
      case "town":
      case "rotate":
        t += 1900;
        break;
      case "mono":
      case "bankrupt":
        t += 1400;
        break;
      case "jail":
      case "fest":
      case "frozen":
      case "block":
      case "rewind":
      case "loan":
        t += 800;
        break;
      case "nope":
        t += 600;
        break;
      case "salary":
      case "sell":
      case "adjust":
      case "free":
      case "repay":
        t += 300;
        break;
    }
  }
  return Math.min(12_000, t);
}

/** AI 장비: 사람들과 비슷한 수준 (대부분 R · SR, 가끔 SSR) */
function botLoadout(): Loadout {
  const r = rand01();
  const grade: Grade = r < 0.55 ? "R" : r < 0.88 ? "SR" : "SSR";
  const pool = charOn().filter((c) => c.grade === grade);
  const c = pool[rnd(pool.length)] ?? CHARS[0];
  const ig = (): Exclude<Grade, "UR"> => {
    const x = rand01();
    return x < 0.6 ? "R" : x < 0.93 ? "SR" : "SSR";
  };
  const item = (slot: "dice" | "buddy") => {
    if (rand01() < 0.2) return null;
    const g = ig();
    const list = ITEMS.filter((i) => i.slot === slot && i.grade === g);
    return { id: list[rnd(list.length)].id, lv: rnd(4) };
  };
  return { char: { id: c.id, lv: rnd(4) }, dice: item("dice"), buddy: item("buddy") };
}

const BOT_LINES = {
  hello: ["안녕하세요~", "한 판 해요!", "잘 부탁해요", "ㅎㅇ", "주사위 운 좀 주세요"],
  lm: ["랜드마크 완성!", "여기 지나가면 각오해요", "후후"],
  ouch: ["으악", "아파요...", "통행료 너무해", "ㅠㅠ"],
  win: ["gg", "재밌었어요!", "한 판 더?"],
  lose: ["gg ㅠ", "다음엔 안 져요", "잘하시네요"],
};
const pickLine = (k: keyof typeof BOT_LINES) => BOT_LINES[k][rnd(BOT_LINES[k].length)];

export interface MarbleOptions {
  /** 시간 배수 (연출 · 제한 시간 · AI 생각 · 입장) — 테스트는 아주 작게 */
  speed?: number;
  /** 로비에 AI 가 연 방 유지 (기본 켜짐) */
  lobbyBots?: boolean;
  tickMs?: number;
}

export function registerMarble({ gateway, db, points, users }: Deps, opts: MarbleOptions = {}) {
  const sp = opts.speed ?? 1;
  const ms = (x: number) => Math.round(x * sp);
  const meta = createMarbleMeta(db, points);
  const rooms = new Map<string, Room>();
  const LOBBY = "marble:lobby";
  const roomKey = (id: string) => `marble:room:${id}`;

  const member = (ctx: Ctx) => {
    void ctx.uid;
    if (!ctx.nick) throw new AppError("MEMBER_ONLY", "회원만 할 수 있어요 (별명을 정해 주세요).", 403);
    return ctx.nick;
  };
  const roomOf = (id: unknown) => {
    const r = rooms.get(String(id));
    if (!r) throw notFound("없는 방이에요.");
    return r;
  };
  const seatIdx = (r: Room, uid: string) => r.seats.findIndex((s) => s?.uid === uid);
  const humans = (r: Room) => r.seats.filter((s): s is Seat => !!s && !s.bot);
  const present = (r: Room) => humans(r).filter((s) => !s.left);
  const freeSeats = (r: Room) => r.seats.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);

  /* ───────────── 내보내기 ───────────── */

  const seatWire = (s: Seat): SeatWire => ({
    uid: s.uid ?? "",
    name: s.name,
    bot: !!s.bot,
    ready: s.ready,
    auto: s.auto,
    away: !!s.away,
    avatar: s.avatar,
    lo: s.lo,
  });
  const gameWire = (g: Game | null): RoomWire["game"] => {
    if (!g) return null;
    const { rng: _rng, ...rest } = g;
    void _rng;
    return { ...rest, ev: [] };
  };
  const wire = (r: Room): RoomWire => ({
    kicked: [...r.kicked],
    ladder: r.ladder ? { cols: r.ladder.cols, rows: r.ladder.rows, rungs: r.ladder.rungs, picks: r.ladder.picks, deadline: r.ladder.deadline, revealUntil: r.ladder.revealUntil } : null,
    id: r.id,
    name: r.name,
    owner: r.owner,
    map: r.map,
    max: r.max,
    quick: r.quick,
    bots: r.bots,
    locked: !!r.pw,
    phase: r.phase,
    seats: r.seats.map((s) => (s ? seatWire(s) : null)),
    order: r.order,
    game: gameWire(r.game),
    ev: r.ev,
    busyUntil: r.busyUntil,
    deadline: r.deadline,
    startAt: r.startAt,
    seq: r.seq,
    result: r.result,
    chat: r.chat,
    now: Date.now(),
  });
  const lobbyWire = (): LobbyRoom[] =>
    [...rooms.values()]
      .map((r) => ({
        id: r.id,
        name: r.name,
        map: r.map,
        max: r.max,
        players: r.seats.filter(Boolean).length,
        humans: present(r).length,
        phase: r.phase,
        locked: !!r.pw,
        quick: r.quick,
        bots: r.bots,
        createdAt: r.createdAt,
      }))
      .sort((a, b) => Number(a.phase !== "wait") - Number(b.phase !== "wait") || b.humans - a.humans || b.createdAt - a.createdAt);

  let lobbyDirty = false;
  function lobbyChanged() {
    if (lobbyDirty) return;
    lobbyDirty = true;
    queueMicrotask(() => {
      lobbyDirty = false;
      gateway.emit(LOBBY, "list", lobbyWire());
    });
  }
  function push(r: Room) {
    r.seq++;
    gateway.emit(roomKey(r.id), "room", wire(r));
    r.ev = [];
    lobbyChanged();
  }

  /* ───────────── 방 ───────────── */

  function createRoom(o: { name: string; map: MapId; max: number; quick: boolean; bots: boolean; pw: string; owner: string }): Room {
    if (rooms.size >= MAX_ROOMS) throw new AppError("FULL", "방이 너무 많아요. 잠시 후에 만들어 주세요.", 429);
    const id = newId(10);
    const r: Room = {
      id,
      name: o.name,
      owner: o.owner,
      map: o.map,
      max: o.max,
      quick: o.quick,
      bots: o.bots && o.quick,
      pw: o.pw ? hashPw(id, o.pw) : null,
      phase: "wait",
      seats: Array.from({ length: o.max }, () => null),
      game: null,
      order: [],
      busyUntil: 0,
      actAt: 0,
      deadline: 0,
      seq: 0,
      ev: [],
      result: null,
      startAt: 0,
      createdAt: Date.now(),
      emptySince: Date.now(),
      botNext: 0,
      botRoomUntil: 0,
      chat: [],
      kicked: new Set(),
      ladder: null,
    };
    rooms.set(id, r);
    lobbyChanged();
    return r;
  }

  function closeRoom(r: Room) {
    rooms.delete(r.id);
    gateway.revoke(roomKey(r.id));
    lobbyChanged();
  }

  async function seatHuman(r: Room, ctx: Ctx, nick: string): Promise<number> {
    const lo = await meta.loadoutOf(ctx.uid);
    if (!lo) throw new AppError("NO_CHAR", "캐릭터가 없어요. 먼저 뽑기에서 캐릭터를 뽑아 주세요.", 409);
    const free = freeSeats(r);
    if (!free.length) {
      // AI 가 앉아 있으면 하나 비켜 줌 (대기 중일 때만)
      const b = r.phase === "wait" ? r.seats.findIndex((s) => s?.bot) : -1;
      if (b < 0) throw forbidden("방이 꽉 찼어요.");
      r.seats[b] = null;
      free.push(b);
    }
    const i = free[0];
    const doc = (await db.col("users").findOne({ _id: ctx.uid } as never, { projection: { "avatar.at": 1, photo: 1 } })) as { avatar?: { at?: number }; photo?: string | null } | null;
    r.seats[i] = { uid: ctx.uid, name: nick, lo, ready: false, bot: null, auto: false, left: false, away: 0, timeouts: 0, avatar: pictureOf(ctx.uid, doc) };
    if (!r.owner || !present(r).some((s) => s.uid === r.owner)) r.owner = ctx.uid;
    r.emptySince = 0;
    planBot(r, true);
    return i;
  }

  function addBot(r: Room): boolean {
    const free = freeSeats(r);
    if (!free.length) return false;
    const name = uniqueNickname(r.seats.map((s) => s?.name ?? ""));
    const i = free[rnd(free.length)];
    r.seats[i] = { uid: null, name, lo: botLoadout(), ready: true, bot: { greed: rand01() * 0.8 - 0.3 }, auto: false, left: false, away: 0, timeouts: 0, avatar: null };
    if (present(r).length && rand01() < 0.6) say(r, name, pickLine("hello"), true);
    return true;
  }

  /** 사람이 있는 대기 방에 AI 가 들어올 때를 잡음 */
  function planBot(r: Room, first = false) {
    if (!r.bots || r.phase !== "wait" || r.botNext || !freeSeats(r).length || !present(r).length) return;
    r.botNext = Date.now() + ms(first ? 2_000 + rnd(4_000) : 5_000 + rnd(15_000));
  }

  function leaveSeat(r: Room, uid: string) {
    const i = seatIdx(r, uid);
    if (i < 0) return;
    const s = r.seats[i]!;
    if (r.phase === "play") {
      s.left = true;
      s.auto = true;
    } else r.seats[i] = null;
    if (r.owner === uid) r.owner = present(r)[0]?.uid ?? "";
    if (!present(r).length) {
      r.emptySince = Date.now();
      // 사람이 다 나가면 판 중이어도 닫음 (AI 끼리 계속 둘 이유가 없음)
      if (r.phase === "play" || !r.botRoomUntil) return closeRoom(r);
      r.botRoomUntil = Math.max(r.botRoomUntil, Date.now() + 60_000);
    }
    r.startAt = 0;
    push(r);
  }

  function say(r: Room, name: string, text: string, bot = false) {
    r.chat.push({ name, text, at: Date.now(), ...(bot && { bot: true }) });
    if (r.chat.length > CHAT_KEEP) r.chat.splice(0, r.chat.length - CHAT_KEEP);
  }

  /* ───────────── 판 ───────────── */

  function maybeStart(r: Room) {
    if (r.phase !== "wait") return;
    const n = r.seats.filter(Boolean).length;
    const ok = n >= 2 && present(r).length > 0 && present(r).every((s) => s.ready);
    if (!ok) {
      if (r.startAt) {
        r.startAt = 0;
        push(r);
      }
      return;
    }
    if (!r.startAt) {
      r.startAt = Date.now() + ms(3_000);
      push(r);
    }
  }

  /** 모두 준비 → 사다리부터 (차례 정하기). 판은 사다리가 끝나야 만들어짐 */
  function beginLadder(r: Room) {
    r.startAt = 0;
    const seats = r.seats.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    const n = seats.length;
    const now = Date.now();
    r.phase = "play";
    r.game = null;
    r.result = null;
    r.ladder = {
      cols: n,
      rows: LADDER_ROWS,
      rungs: makeRungs(n, rnd),
      picks: Array.from({ length: n }, () => -1),
      deadline: now + ms(LADDER_PICK_MS),
      revealUntil: 0,
      seats,
      // AI · 자동 진행은 조금 뜸 들이다 고름
      botAt: seats.map(() => now + ms(300 + rnd(900))),
    };
    push(r);
    lobbyChanged();
  }

  function ladderPick(r: Room, seat: number, col: number) {
    const L = r.ladder!;
    if (L.revealUntil || L.picks.includes(seat) || L.picks[col] !== -1) return;
    L.picks[col] = seat;
    if (L.picks.every((x) => x >= 0)) {
      L.revealUntil = Date.now() + ms(LADDER_SHOW_MS);
      L.deadline = 0;
    }
    push(r);
  }

  function ladderTick(r: Room, now: number) {
    const L = r.ladder!;
    if (L.revealUntil) {
      if (now < L.revealUntil) return;
      // 아래 칸 번호 = 차례
      const order: number[] = [];
      L.picks.forEach((seat, col) => (order[trace(L.cols, L.rows, L.rungs, col).end] = seat));
      r.ladder = null;
      startGame(r, order);
      return;
    }
    const pickFor = (seat: number) => {
      const free = L.picks.map((x, c) => (x < 0 ? c : -1)).filter((c) => c >= 0);
      if (free.length) ladderPick(r, seat, free[rnd(free.length)]);
    };
    L.seats.forEach((si, k) => {
      const s = r.seats[si];
      if (L.picks.includes(si)) return;
      if (!s || s.bot || s.auto || s.left) {
        if (now >= L.botAt[k]) pickFor(si);
      } else if (now >= L.deadline) pickFor(si);
    });
  }

  function startGame(r: Room, order?: number[]) {
    r.startAt = 0;
    r.order = order?.length ? order : r.seats.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    const seed = randomInt(0, 2 ** 31);
    r.game = newGame({
      ...(order?.length && { first: 0 }),
      map: r.map,
      seed,
      players: r.order.map((si) => {
        const s = r.seats[si]!;
        return { id: s.uid ?? `bot:${si}`, name: s.name, bot: !!s.bot, lo: s.lo };
      }),
    });
    r.phase = "play";
    r.result = null;
    for (const s of r.seats) if (s) s.timeouts = 0;
    r.ev = [...r.game.ev];
    // 시작하자마자 화면이 내 순번을 보여 주는 동안 기다림
    afterStep(r, ms(INTRO_MS));
  }

  /** 행동 뒤: 연출 시간 · 다음 마감 · 끝났으면 정산 */
  function afterStep(r: Room, extra = 0) {
    const g = r.game!;
    const now = Date.now();
    r.busyUntil = now + extra + ms(animMs(r.ev));
    if (g.over) {
      r.deadline = 0;
      push(r);
      void finish(r);
      return;
    }
    const pr = g.prompt!;
    const s = r.seats[r.order[pr.p]]!;
    if (s.bot || s.auto) {
      r.actAt = r.busyUntil + ms(500 + rnd(800));
      r.deadline = 0;
    } else {
      r.actAt = 0;
      r.deadline = r.busyUntil + ms(LIMIT[pr.k] ?? 12_000);
    }
    // AI 한마디
    for (const e of r.ev) {
      if (e.t === "buy" && e.lv === 4) {
        const bs = r.seats[r.order[e.p]];
        if (bs?.bot && rand01() < 0.5) say(r, bs.name, pickLine("lm"), true);
      }
      if (e.t === "pay" && e.amt >= 800 && e.from >= 0) {
        const bs = r.seats[r.order[e.from]];
        if (bs?.bot && rand01() < 0.4) say(r, bs.name, pickLine("ouch"), true);
      }
    }
    push(r);
  }

  function doAct(r: Room, pi: number, a: Action) {
    const g = r.game!;
    act(g, pi, a);
    r.ev = [...g.ev];
    afterStep(r);
  }

  async function finish(r: Room) {
    const g = r.game!;
    const st = standings(g);
    const n = g.players.length;
    const res: NonNullable<Room["result"]> = [];
    for (let place = 1; place <= st.length; place++) {
      const pi = st[place - 1];
      const si = r.order[pi];
      const s = r.seats[si];
      const row: NonNullable<Room["result"]>[number] = { seat: si, name: g.players[pi].name, place, bot: !s || !!s.bot };
      if (s && !s.bot && s.uid && !s.left) {
        const won = place === 1;
        const mono = won && ["triple", "line", "spot"].includes(g.over!.how);
        try {
          const rw = await meta.onMatch(s.uid, { place, n, how: g.over!.how, lm: g.players[pi].stat.lm, mono });
          row.stars = rw.stars;
          row.first = rw.first;
        } catch (e) {
          console.warn("[marble] 보상 실패", e);
        }
      }
      if (s?.bot && rand01() < 0.5) say(r, s.name, pickLine(place === 1 ? "win" : "lose"), true);
      res.push(row);
    }
    if (!rooms.has(r.id)) return;
    r.phase = "end";
    r.result = res;
    r.busyUntil = Math.max(r.busyUntil, Date.now());
    push(r);
    setTimeout(() => backToWait(r), Math.max(0, r.busyUntil - Date.now()) + ms(RESULT_MS)).unref?.();
  }

  function backToWait(r: Room) {
    if (!rooms.has(r.id) || r.phase !== "end") return;
    r.phase = "wait";
    r.game = null;
    r.ladder = null;
    r.order = [];
    r.ev = [];
    // 나간 사람 · 자동 진행 자리 정리, AI 는 반쯤 남음
    r.seats = r.seats.map((s) => {
      if (!s) return null;
      if (!s.bot && (s.left || s.away)) return null;
      if (s.bot && rand01() < 0.5) return null;
      return { ...s, ready: !!s.bot, auto: false, timeouts: 0 };
    });
    if (!present(r).length) return closeRoom(r);
    if (!present(r).some((s) => s.uid === r.owner)) r.owner = present(r)[0].uid!;
    r.botNext = 0;
    planBot(r);
    push(r);
  }

  /* ───────────── 시계 ───────────── */

  const tick = setInterval(() => {
    const now = Date.now();
    for (const r of [...rooms.values()]) {
      try {
        if (r.phase === "wait") {
          if (r.startAt && now >= r.startAt) {
            beginLadder(r);
            continue;
          }
          if (r.botNext && now >= r.botNext) {
            r.botNext = 0;
            if (r.bots && present(r).length && addBot(r)) {
              push(r);
              maybeStart(r);
            }
            planBot(r);
          }
          // 빈 방 정리 (AI 가 연 방은 수명까지)
          if (!present(r).length) {
            if (r.botRoomUntil) {
              if (now >= r.botRoomUntil && !gateway.subscribers(roomKey(r.id)).length) closeRoom(r);
            } else if (now - r.emptySince >= EMPTY_TTL_MS) closeRoom(r);
          }
          continue;
        }
        if (r.phase === "play" && r.ladder) {
          ladderTick(r, now);
          continue;
        }
        if (r.phase !== "play" || !r.game || r.game.over || !r.game.prompt) continue;
        const pi = r.game.prompt.p;
        const s = r.seats[r.order[pi]];
        if (!s) continue;
        // 끊긴 채 오래면 자동 진행
        if (!s.bot && s.away && !s.auto && now - s.away >= ms(AWAY_AUTO_MS)) s.auto = true;
        if (s.bot || s.auto) {
          if (!r.actAt) r.actAt = Math.max(r.busyUntil, now) + ms(400);
          if (now >= r.actAt) doAct(r, pi, botAction(r.game, s.bot ?? undefined));
        } else if (r.deadline && now >= r.deadline) {
          s.timeouts++;
          if (s.timeouts >= AUTO_AFTER_TIMEOUTS) s.auto = true;
          doAct(r, pi, timeoutAction(r.game));
        }
      } catch (e) {
        console.error(`[marble] 방 ${r.id} 진행 오류`, e);
        closeRoom(r);
      }
    }
  }, opts.tickMs ?? 200);
  tick.unref();

  /** 로비가 비어 보이지 않게: AI 가 연 대기 방을 몇 개 유지 */
  const lobbyTimer = setInterval(() => {
    if (opts.lobbyBots === false) return;
    const open = [...rooms.values()].filter((r) => r.phase === "wait" && r.bots && !r.pw && freeSeats(r).length > 0);
    for (let n = open.length; n < 3 && rooms.size < MAX_ROOMS - 10; n++) {
      const map = MAP_IDS[rnd(MAP_IDS.length)];
      const max = [2, 2, 3, 4][rnd(4)];
      const host = uniqueNickname([]);
      const r = createRoom({ name: `${host}의 마블`, map, max, quick: true, bots: true, pw: "", owner: "" });
      r.botRoomUntil = Date.now() + (5 + rnd(8)) * 60_000;
      addBot(r);
      r.seats.find(Boolean)!.name = host;
      if (max > 2 && rand01() < 0.4) addBot(r);
      lobbyChanged();
    }
  }, 4000);
  lobbyTimer.unref();

  /* ───────────── 구독 ───────────── */

  gateway.channel("marble.lobby", { key: () => LOBBY, snapshot: () => lobbyWire() });
  gateway.channel("marble.room", {
    key: (ctx, params) => {
      void ctx.uid;
      return roomKey(roomOf((params as { id?: unknown })?.id).id);
    },
    snapshot: (_ctx, _key, params) => {
      const r = roomOf((params as { id?: unknown }).id);
      return { ...wire(r), ev: [] };
    },
  });

  /* ───────────── 방 rpc ───────────── */

  const mapSchema = z.enum(["town", "cross", "orgel"]);
  const roomOpts = z.object({
    name: z.string().max(20).optional(),
    map: mapSchema.default("town"),
    max: z.number().int().min(2).max(4).default(2),
    quick: z.boolean().default(true),
    bots: z.boolean().default(true),
    pw: z.string().max(20).default(""),
  });

  /** 다른 대기 방에 앉아 있으면 거기서 나옴 (한 사람은 한 방) */
  function leaveOthers(uid: string, except?: string) {
    for (const r of [...rooms.values()]) if (r.id !== except && r.phase !== "play" && seatIdx(r, uid) >= 0) leaveSeat(r, uid);
  }
  function playingRoom(uid: string): Room | null {
    for (const r of rooms.values()) {
      const i = seatIdx(r, uid);
      if (i >= 0 && r.phase === "play" && !r.seats[i]!.left) return r;
    }
    return null;
  }

  gateway.rpc("marble.create", async (ctx, raw) => {
    const nick = member(ctx);
    const o = roomOpts.parse(raw ?? {});
    if (playingRoom(ctx.uid)) throw forbidden("진행 중인 판이 있어요.");
    leaveOthers(ctx.uid);
    const r = createRoom({ name: o.name?.trim() || `${nick}의 마블`, map: o.map, max: o.max, quick: o.quick, bots: o.bots, pw: o.pw, owner: ctx.uid });
    try {
      await seatHuman(r, ctx, nick);
    } catch (e) {
      closeRoom(r);
      throw e;
    }
    push(r);
    return { id: r.id };
  });

  /** 바로 입장: 사람이 기다리는 공개 방 → AI 가 연 방 → 없으면 새 방(AI 가 곧 들어옴). 들어가면 바로 준비 */
  gateway.rpc("marble.quick", async (ctx, raw) => {
    const nick = member(ctx);
    const { map, max } = z.object({ map: mapSchema.optional(), max: z.number().int().min(2).max(4).optional() }).parse(raw ?? {});
    const cur = playingRoom(ctx.uid);
    if (cur) return { id: cur.id };
    leaveOthers(ctx.uid);
    const fits = (r: Room) => r.phase === "wait" && r.quick && !r.pw && freeSeats(r).length > 0 && !r.kicked.has(ctx.uid) && (!map || r.map === map) && (!max || r.max === max);
    // 열린 방 중 아무 데나 (사람이 있는 방을 먼저, 그 안에서 무작위) — 없으면 인원 2~4 무작위로 새 방
    const cands = [...rooms.values()].filter(fits);
    const withPeople = cands.filter((x) => present(x).length > 0);
    const pool = withPeople.length ? withPeople : cands;
    let r = pool.length ? pool[randomInt(pool.length)] : undefined;
    if (!r) r = createRoom({ name: `${nick}의 마블`, map: map ?? MAP_IDS[randomInt(MAP_IDS.length)], max: max ?? 2 + randomInt(3), quick: true, bots: true, pw: "", owner: ctx.uid });
    const i = await seatHuman(r, ctx, nick);
    r.seats[i]!.ready = true;
    push(r);
    maybeStart(r);
    return { id: r.id };
  });

  gateway.rpc("marble.join", async (ctx, raw) => {
    const nick = member(ctx);
    const { id, pw } = z.object({ id: z.string().max(40), pw: z.string().max(20).optional() }).parse(raw);
    const r = roomOf(id);
    const i = seatIdx(r, ctx.uid);
    if (i >= 0) {
      // 다시 들어옴 (새로고침 · 끊김) → 자리 그대로, 자동 진행은 내가 다시
      const s = r.seats[i]!;
      if (!s.left) {
        s.away = 0;
        s.auto = false;
        s.timeouts = 0;
        push(r);
        return { id: r.id };
      }
      if (r.phase === "play") throw forbidden("나간 판에는 다시 들어갈 수 없어요.");
    }
    if (r.kicked.has(ctx.uid)) throw forbidden("강퇴된 방이에요.");
    if (r.phase !== "wait") throw forbidden("이미 시작한 방이에요. 끝나면 들어갈 수 있어요.");
    if (r.pw && !(pw && safeEq(r.pw, hashPw(r.id, pw)))) throw new AppError("BAD_PASSWORD", "비밀번호가 맞지 않아요.", 403);
    if (playingRoom(ctx.uid)) throw forbidden("진행 중인 판이 있어요.");
    leaveOthers(ctx.uid, r.id);
    await seatHuman(r, ctx, nick);
    push(r);
    maybeStart(r);
    return { id: r.id };
  });

  gateway.rpc("marble.leave", (ctx, raw) => {
    const r = rooms.get(String((raw as { id?: unknown })?.id));
    if (r) leaveSeat(r, ctx.uid);
    return null;
  });

  gateway.rpc("marble.ready", (ctx, raw) => {
    const { id, ready } = z.object({ id: z.string(), ready: z.boolean() }).parse(raw);
    const r = roomOf(id);
    const i = seatIdx(r, ctx.uid);
    if (i < 0 || r.phase !== "wait") throw bad();
    r.seats[i]!.ready = ready;
    push(r);
    maybeStart(r);
    return null;
  });

  /** 방장: 맵 · 인원 · 바로 입장 · AI 입장 · AI 빼기 */
  gateway.rpc("marble.opts", (ctx, raw) => {
    const o = z
      .object({
        id: z.string(),
        map: mapSchema.optional(),
        max: z.number().int().min(2).max(4).optional(),
        quick: z.boolean().optional(),
        bots: z.boolean().optional(),
        kickBot: z.number().int().min(0).max(3).optional(),
        kick: z.number().int().min(0).max(3).optional(),
        addBot: z.boolean().optional(),
      })
      .parse(raw);
    const r = roomOf(o.id);
    if (r.owner !== ctx.uid) throw forbidden("방장만 바꿀 수 있어요.");
    if (r.phase !== "wait") throw forbidden("판이 끝나면 바꿀 수 있어요.");
    if (o.map) r.map = o.map;
    if (o.max && o.max !== r.max) {
      const taken = r.seats.filter(Boolean) as Seat[];
      if (taken.length > o.max) {
        // 줄이면 AI 부터 뺌
        while (taken.length > o.max) {
          const b = taken.findIndex((s) => s.bot);
          if (b < 0) throw bad("앉은 사람이 더 많아요.");
          taken.splice(b, 1);
        }
      }
      r.seats = [...taken, ...Array.from({ length: o.max - taken.length }, () => null)];
      r.max = o.max;
    }
    if (o.quick !== undefined) r.quick = o.quick;
    if (o.bots !== undefined) r.bots = o.bots;
    r.bots = r.bots && r.quick;
    if (!r.bots) r.seats = r.seats.map((s) => (s?.bot ? null : s));
    if (o.kickBot !== undefined && r.seats[o.kickBot]?.bot) r.seats[o.kickBot] = null;
    if (o.kick !== undefined) {
      // 강퇴: AI 든 사람이든 (나 빼고)
      const ks = r.seats[o.kick];
      if (ks && ks.uid !== ctx.uid) {
        if (!ks.bot && ks.uid) {
          r.kicked.add(ks.uid);
          say(r, "알림", `${ks.name} 님이 강퇴됐어요.`, true);
        }
        r.seats[o.kick] = null;
      }
    }
    if (o.addBot && r.bots) addBot(r);
    r.botNext = 0;
    planBot(r);
    push(r);
    maybeStart(r);
    return null;
  });

  gateway.rpc("marble.act", (ctx, raw) => {
    const { id, a, seq } = z
      .object({
        id: z.string(),
        seq: z.number().int().optional(),
        a: z
          .object({
            t: z.enum(["roll", "pay", "warp", "pick", "skill", "keep", "reroll", "adjust", "fork", "rail", "buy", "acq", "fest", "start", "loan"]),
            to: z.number().int().optional(),
            n: z.number().int().optional(),
            target: z.number().int().optional(),
            d: z.literal(1).optional(),
            lv: z.number().int().optional(),
            pick: z.array(z.number().int().min(0).max(4)).max(5).optional(),
            yes: z.boolean().optional(),
            tile: z.number().int().optional(),
            power: z.number().min(0).max(1).optional(),
          })
          .strict(),
      })
      .parse(raw);
    void seq;
    const r = roomOf(id);
    if (r.phase !== "play" || !r.game?.prompt) throw bad("지금은 둘 수 없어요.");
    const pi = r.order.indexOf(seatIdx(r, ctx.uid));
    if (pi < 0 || r.game.prompt.p !== pi) throw bad("내 차례가 아니에요.");
    const s = r.seats[r.order[pi]]!;
    s.timeouts = 0;
    s.auto = false;
    try {
      doAct(r, pi, a as Action);
    } catch (e) {
      if (e instanceof ActError) throw bad(e.message);
      throw e;
    }
    return { seq: r.seq };
  });

  /** 사다리 위 칸 고르기 */
  gateway.rpc("marble.ladder", (ctx, raw) => {
    const { id, col } = z.object({ id: z.string(), col: z.number().int().min(0).max(7) }).parse(raw);
    const r = roomOf(id);
    const L = r.ladder;
    if (r.phase !== "play" || !L || L.revealUntil) throw bad("지금은 고를 수 없어요.");
    const i = seatIdx(r, ctx.uid);
    if (i < 0 || !L.seats.includes(i)) throw bad();
    if (col >= L.cols || L.picks[col] !== -1) throw bad("이미 누가 골랐어요.");
    ladderPick(r, i, col);
    return null;
  });

    /** 자동 진행 끄기 · 켜기 (내가 다시 할게요) */
  gateway.rpc("marble.auto", (ctx, raw) => {
    const { id, on } = z.object({ id: z.string(), on: z.boolean() }).parse(raw);
    const r = roomOf(id);
    const i = seatIdx(r, ctx.uid);
    if (i < 0) throw bad();
    r.seats[i]!.auto = on;
    r.seats[i]!.timeouts = 0;
    if (!on && r.game?.prompt && r.order[r.game.prompt.p] === i) {
      r.actAt = 0;
      r.deadline = Math.max(r.busyUntil, Date.now()) + ms(LIMIT[r.game.prompt.k] ?? 12_000);
    }
    push(r);
    return null;
  });

  gateway.rpc("marble.chat", (ctx, raw) => {
    const nick = member(ctx);
    const { id, text } = z.object({ id: z.string(), text: z.string().min(1).max(60) }).parse(raw);
    const r = roomOf(id);
    if (seatIdx(r, ctx.uid) < 0) throw forbidden("방에 앉아 있어야 해요.");
    say(r, nick, text.trim());
    push(r);
    return null;
  });

  gateway.rpc("marble.mine", (ctx) => {
    member(ctx);
    const r = playingRoom(ctx.uid);
    return r ? { id: r.id, name: r.name } : null;
  });

  gateway.onDisconnect((ctx) => {
    const uid = ctx.user?.uid;
    if (!uid) return;
    for (const r of [...rooms.values()]) {
      const i = seatIdx(r, uid);
      if (i < 0) continue;
      if (r.phase === "play") {
        r.seats[i]!.away = Date.now();
        push(r);
      } else leaveSeat(r, uid);
    }
  });

  /* ───────────── 성장 rpc ───────────── */

  gateway.rpc("marble.profile", (ctx) => {
    member(ctx);
    return meta.profile(ctx.uid);
  });
  gateway.rpc("marble.pull", (ctx, raw) => {
    member(ctx);
    return meta.pull(ctx.uid, raw);
  });
  gateway.rpc("marble.charUp", (ctx, raw) => {
    member(ctx);
    return meta.charUp(ctx.uid, raw);
  });
  gateway.rpc("marble.itemUp", (ctx, raw) => {
    member(ctx);
    return meta.itemUp(ctx.uid, raw);
  });
  gateway.rpc("marble.equip", (ctx, raw) => {
    member(ctx);
    if (playingRoom(ctx.uid)) throw forbidden("판이 끝나면 바꿀 수 있어요.");
    return meta.equip(ctx.uid, raw).then(async (w) => {
      // 대기 방에 앉아 있으면 그 자리 장비도 바로
      const lo = await meta.loadoutOf(ctx.uid);
      for (const r of rooms.values()) {
        const i = seatIdx(r, ctx.uid);
        if (i >= 0 && r.phase === "wait" && lo) {
          r.seats[i]!.lo = lo;
          push(r);
        }
      }
      return w;
    });
  });
  gateway.rpc("marble.buy", (ctx, raw) => {
    member(ctx);
    return meta.buy(ctx.uid, raw, !!ctx.user?.admin);
  });

  /** 승수 순위 */
  gateway.rpc("marble.rank", async () => {
    const docs = (await db
      .col("users")
      .find({ "stats.marble.games": { $gt: 0 } } as never, { projection: { nick: 1, "stats.marble": 1, "avatar.at": 1, photo: 1 } })
      .sort({ "stats.marble.wins": -1, "stats.marble.games": 1 } as never)
      .limit(50)
      .toArray()) as unknown as { _id: string; nick?: string; stats?: { marble?: { games?: number; wins?: number } }; avatar?: { at?: number }; photo?: string | null }[];
    return docs
      .filter((d) => d.nick)
      .map((d) => ({ nick: d.nick!, avatar: pictureOf(String(d._id), d), wins: d.stats?.marble?.wins ?? 0, games: d.stats?.marble?.games ?? 0 }));
  });

  void users;

  return {
    meta,
    adminList: () =>
      [...rooms.values()].map((r) => ({
        id: r.id,
        name: r.name,
        status: r.phase === "play" ? "play" : r.phase === "wait" ? "waiting" : "ended",
        players: r.seats.filter((s): s is Seat => !!s).map((s) => (s.bot ? `AI ${s.name}` : s.name)),
        createdAt: r.createdAt,
      })),
    adminClose(id: string): boolean {
      const r = rooms.get(id);
      if (r) closeRoom(r);
      return !!r;
    },
    close() {
      clearInterval(tick);
      clearInterval(lobbyTimer);
      rooms.clear();
    },
  };
}
