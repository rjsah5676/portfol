import { z } from "zod";
import type { Deps } from "../deps";
import { AppError, bad } from "../errors";
import { newId } from "../ids";
import { CHANNEL_CAP, CHAT_MAX, MAX_CHANNELS, RADIUS, RUN_SPEED, SPAWN, blocked } from "../../../web/src/lib/gmtown/world";
import type { ChannelList, CharId, ChatWire, MoveWire, PlayerWire, TownSnap } from "../../../web/src/lib/gmtown/types";

/*
 * GMTOWN — 사이트 마을 광장. 채널(최대 40명)마다 서로 보이고 · 걷고 · 말함.
 *
 * 상태는 전부 메모리 (위치 · 채팅은 남길 필요 없음). 게스트(익명 로그인)도 들어옴 — 이름은 「◦손님1234」.
 * 위치는 화면이 정하고 서버는 검사만 함:
 *   - 걸을 수 있는 거리 예산(초당 속도 × 1.4, 최대 2.5칸)을 넘게 움직이면 예산만큼만 → 그 사람에게 snap 으로 바로잡기
 *   - 건물 · 분수 · 나무 안이면 그대로 둠 (world.ts 의 blocked — 화면과 같은 판정, 반지름만 조금 너그럽게)
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

export function registerGmtown({ gateway }: Deps, opts: GmtownOptions = {}) {
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
  const wire = (p: P): PlayerWire => ({ id: p.id, name: p.name, guest: p.guest, c: p.c, x: r2(p.x), y: r2(p.y), d: p.d, m: p.m });

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
        p = { id: newId(8), sock, uid, name: ctx.name(`손님${guestNo(uid)}`, 10), guest, c: args.c ?? "amy", x: at.x, y: at.y, d: 0, m: 0, ch: n, bank: BANK_MAX, at: now(), chatAt: 0 };
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

  const MoveArgs = z.object({ x: z.number().finite(), y: z.number().finite(), d: z.number().int().min(0).max(7), m: z.union([z.literal(0), z.literal(1), z.literal(2)]) });

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
    if (blocked(x, y, RADIUS * 0.6)) {
      x = p.x;
      y = p.y;
      snap = true;
    }
    p.bank = Math.max(0, p.bank - Math.hypot(x - p.x, y - p.y));
    p.x = x;
    p.y = y;
    p.d = a.d;
    p.m = a.m;
    chans.get(p.ch)?.dirty.add(p.sock);
    if (snap) gateway.emitTo(ctx.socket, keyOf(p.ch), "snap", { x: r2(x), y: r2(y) });
    return null;
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
        if (p) out.push([p.id, r2(p.x), r2(p.y), p.d, p.m]);
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
