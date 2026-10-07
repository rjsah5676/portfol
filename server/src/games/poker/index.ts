import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Deps } from "../../deps";
import { AppError, bad, forbidden } from "../../errors";
import type { LiveRoom } from "../../http/admin";
import { newId, orderedId } from "../../ids";
import type { Ctx } from "../../realtime/gateway";
import { avatarPath, type UserDoc } from "../../users";
import {
  ACT_AWAY_MS,
  ACT_MS,
  BOT_IDS,
  BOT_INFO,
  CHOICE_MS,
  DEFAULT_BOTS,
  GAMES,
  SITOUT_KICK_MS,
  TIERS,
  TIMEOUTS_TO_SITOUT,
  UNIT,
  fmtWon,
  tierOf,
  type BotId,
  type GameKind,
  type Tier,
} from "../../../../web/src/lib/poker/rules";
import type { ChatMsg, HoldemView, LobbyTable, MyHand, PokerEvent, SeatWire, SevenView, TableWire, Wallet } from "../../../../web/src/lib/poker/types";
import { holdem } from "./holdem/round";
import { coolDown, line, newBrain, type Brain } from "./personas";
import { RoundError, type GameDef, type Round } from "./round";
import { seven } from "./seven/round";
import { createWallet, type SettleEntry } from "./wallet";

/*
 * 포커 테이블 (홀덤 · 7포커 공용). 회원만 이용.
 *
 * 테이블은 서버 메모리에 있고(스케치·격투 방처럼), 돈만 DB 에 있음.
 *  - 앉으면 가진 돈 전부가 칩. 판이 끝날 때마다 증감이 DB 에 반영되고, 다음 판을 시작할 때 DB 의 금액으로 다시 맞춤
 *  - 한 사람은 한 테이블에만 앉을 수 있음 (같은 돈을 두 곳에 걸 수 없게)
 *  - 판 도중에 나가면 그 판은 죽은 것으로 치고, 판이 정산된 뒤에 자리가 비워짐
 *
 * 구독 채널
 *   poker.lobby           테이블 목록
 *   poker.table { id }    공개 상태 (회원만)
 *   poker.me    { id }    내 패 — 구독 키에 uid 가 들어가서 본인 소켓에만 감. 이 구독이 "접속 중" 표시이기도 함
 *   poker.wallet          내 돈
 */

const GAME_DEFS: Record<GameKind, GameDef> = { holdem, seven };

interface Seat {
  seat: number;
  /** 사람이면 uid */
  uid: string | null;
  /** 봇이면 그 머리 */
  brain: Brain | null;
  name: string;
  avatar: string | null;
  stack: number;
  status: "in" | "wait" | "out";
  away: boolean;
  awayAt: number;
  /** 연속 시간 초과 횟수 */
  timeouts: number;
  /** 시간 초과가 이어져 자동으로 자리 비움이 됨 (직접 행동하면 풀림) */
  autoOut: boolean;
  outAt: number;
  /** 판이 끝나면 자리를 비움 */
  leaving: boolean;
}

interface Table {
  id: string;
  name: string;
  game: GameKind;
  def: GameDef;
  tier: Tier;
  locked: boolean;
  pw: string | null;
  ownerUid: string;
  access: Set<string>;
  createdAt: number;
  seats: (Seat | null)[];
  botTarget: number;
  /** 봇이 돌아올 시각들 */
  botReturns: number[];
  handNo: number;
  round: Round | null;
  /** 이번 판에 참가한 자리 (판 도중에 자리 객체가 바뀌지 않게 잡아 둠) */
  inRound: Map<number, Seat>;
  mem: Record<string, unknown>;
  /** 판이 끝난 뒤 다음 판 전까지 보여 줄 마지막 상태 */
  lastView: HoldemView | SevenView | null;
  deadline: number;
  nextAt: number | null;
  /** 진행(카드 깔기 · 다음 판) 타이머 */
  timer: ReturnType<typeof setTimeout> | null;
  /** 자리별 타이머 (사람 제한 시간 · 봇 생각 시간) */
  actTimers: Map<number, ReturnType<typeof setTimeout>>;
  /** 타이머가 걸린 "기다림"의 표식 — 같은 기다림에 타이머를 두 번 걸지 않게 */
  waitMark: string;
  seq: number;
  ev: PokerEvent[];
  chat: ChatMsg[];
  /** 정산이 DB 에 반영되는 중 (다음 판은 이게 끝난 뒤에 시작) */
  settling: Promise<void>;
  starting: boolean;
  closed: boolean;
  emptySince: number;
}

export interface PokerOptions {
  /** 진행 속도 배수 (테스트는 0 = 기다림 없이) */
  speed?: number;
  /** 사람의 제한 시간 (기본: 규칙의 ACT_MS · CHOICE_MS · ACT_AWAY_MS) */
  actMs?: number;
  choiceMs?: number;
  awayMs?: number;
  /** 정리 주기 */
  sweepIntervalMs?: number;
  now?: () => number;
}

const hashPw = (id: string, pw: string) => createHash("sha256").update(`${id}:${pw}`).digest("hex");
const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const MAX_TABLES = 200;
const CHAT_KEEP = 40;
/** 접속이 끊긴 채 이만큼 지나면 자리에서 내려옴 */
const AWAY_KICK_MS = 45_000;
/** 사람이 없는 테이블은 이만큼 뒤에 정리 */
const EMPTY_TTL_MS = 20_000;

export function registerPoker({ gateway, db, users }: Deps, opts: PokerOptions = {}) {
  const now = opts.now ?? Date.now;
  const speed = opts.speed ?? 1;
  const ms = (t: number) => Math.round(t * speed);
  const actMs = opts.actMs ?? ACT_MS;
  const choiceMs = opts.choiceMs ?? CHOICE_MS;
  const awayMs = opts.awayMs ?? ACT_AWAY_MS;
  const wallet = createWallet(db, now);
  void wallet.ensure().catch((e) => console.warn("[poker] 시작 자금 채우기 실패", e));

  const tables = new Map<string, Table>();
  /** uid → 앉아 있는 테이블 */
  const seatOf = new Map<string, string>();
  /**
   * uid → 아직 DB 에 쓰이는 중인 정산. 판을 잃고 나간 직후 다른 테이블에 앉으면 "잃기 전 금액"을 읽게 되므로,
   * 앉을 때와 판을 시작할 때 이게 끝나기를 기다림.
   */
  const settlingOf = new Map<string, Promise<void>>();
  const settled = (uids: string[]) => Promise.all(uids.map((u) => settlingOf.get(u)));

  const LOBBY = "poker:lobby";
  const tableKey = (id: string) => `poker:table:${id}`;
  const meKey = (id: string, uid: string) => `poker:me:${id}:${uid}`;
  const walletKey = (uid: string) => `poker:wallet:${uid}`;

  // ───────────── 내보내기 ─────────────

  const seatWire = (t: Table, s: Seat): SeatWire => ({
    seat: s.seat,
    uid: s.uid ?? "",
    bot: s.brain?.id ?? null,
    name: s.name,
    avatar: s.avatar,
    stack: t.round && t.inRound.get(s.seat) === s ? t.round.stack(s.seat) : s.stack,
    status: s.status,
    away: s.away,
  });

  const wire = (t: Table, ev: PokerEvent[] = []): TableWire => ({
    id: t.id,
    name: t.name,
    game: t.game,
    tier: t.tier.id,
    locked: t.locked,
    seats: t.seats.map((s) => (s ? seatWire(t, s) : null)),
    handNo: t.handNo,
    hand: t.round ? t.round.view(t.deadline) : t.lastView,
    nextAt: t.nextAt,
    ev,
    seq: t.seq,
  });

  const lobbyWire = (): LobbyTable[] =>
    [...tables.values()]
      .map((t) => ({
        id: t.id,
        name: t.name,
        game: t.game,
        tier: t.tier.id,
        locked: t.locked,
        humans: t.seats.filter((s) => s?.uid).length,
        bots: t.seats.filter((s) => s?.brain).length,
        max: t.seats.length,
        createdAt: t.createdAt,
      }))
      .sort((a, b) => b.humans - a.humans || b.createdAt - a.createdAt);

  let lobbyDirty = false;
  function lobbyChanged() {
    if (lobbyDirty) return;
    lobbyDirty = true;
    queueMicrotask(() => {
      lobbyDirty = false;
      gateway.emit(LOBBY, "list", lobbyWire());
    });
  }

  /** 상태가 바뀜 → 테이블을 보는 모두에게 */
  function emit(t: Table, ...ev: PokerEvent[]) {
    if (t.closed) return;
    t.ev.push(...ev);
    t.seq++;
    gateway.emit(tableKey(t.id), "state", wire(t, t.ev));
    t.ev = [];
  }

  const walletWire = (uid: string, w: { money: number; reviveUsed: number }): Wallet => ({ ...w, table: seatOf.get(uid) ?? null });
  wallet.onChange((uid, w) => gateway.emit(walletKey(uid), "wallet", walletWire(uid, w)));
  /** 앉은 테이블이 바뀌었을 때 내 지갑 화면도 갱신 */
  const pushWallet = (uid: string) =>
    void wallet
      .get(uid)
      .then((w) => w && gateway.emit(walletKey(uid), "wallet", walletWire(uid, w)))
      .catch(() => {});

  function sendHand(t: Table, s: Seat) {
    if (!s.uid || !t.round) return;
    const secret = t.round.secret(s.seat);
    if (secret) gateway.emit(meKey(t.id, s.uid), "hand", { handNo: t.handNo, seat: s.seat, ...secret } satisfies MyHand);
  }

  // ───────────── 자리 ─────────────

  const humans = (t: Table) => t.seats.filter((s): s is Seat => !!s?.uid);
  const bots = (t: Table) => t.seats.filter((s): s is Seat => !!s?.brain);
  const freeSeats = (t: Table) => t.seats.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
  const findSeat = (t: Table, uid: string) => t.seats.find((s) => s?.uid === uid) ?? null;
  const inLiveRound = (t: Table, s: Seat) => !!t.round && t.inRound.get(s.seat) === s;

  function removeSeat(t: Table, s: Seat, why: (PokerEvent & { t: "leave" })["why"]) {
    if (t.seats[s.seat] !== s) return;
    t.seats[s.seat] = null;
    if (s.uid) {
      seatOf.delete(s.uid);
      pushWallet(s.uid);
    }
    t.ev.push({ t: "leave", seat: s.seat, name: s.name, why });
    if (!humans(t).length) t.emptySince = now();
    lobbyChanged();
  }

  function addBot(t: Table): boolean {
    const free = freeSeats(t);
    // 사람이 앉을 자리 하나는 늘 남겨 둠
    if (free.length <= 1) return false;
    const taken = new Set(bots(t).map((b) => b.brain!.id));
    const pool = BOT_IDS.filter((id) => !taken.has(id));
    if (!pool.length) return false;
    const id: BotId = pool[randomInt(pool.length)];
    const seat = free[randomInt(free.length)];
    t.seats[seat] = {
      seat,
      uid: null,
      brain: newBrain(id, t.tier.id),
      name: BOT_INFO[id].name,
      avatar: null,
      stack: t.tier.botMoney,
      status: "wait",
      away: false,
      awayAt: 0,
      timeouts: 0,
      autoOut: false,
      outAt: 0,
      leaving: false,
    };
    t.ev.push({ t: "sit", seat, name: BOT_INFO[id].name });
    return true;
  }

  /** 판 사이에 봇을 정리: 파산·수금한 봇은 나가고, 자리가 꽉 찼으면 하나 비켜 주고, 돌아올 때가 된 봇은 앉힘 */
  function tendBots(t: Table) {
    const leaveLater = (s: Seat, why: "bust" | "cashout" | "leave") => {
      const text = line(s.brain!, why === "bust" ? "bust" : "cashout", true);
      if (text && why !== "leave") t.ev.push({ t: "say", seat: s.seat, text });
      removeSeat(t, s, why);
      t.botReturns.push(now() + ms(12_000 + randomInt(14_000)));
    };
    for (const s of bots(t)) {
      if (s.stack < t.def.minStack(t.tier)) leaveLater(s, "bust");
      else if (s.stack >= t.tier.botMoney * 3) leaveLater(s, "cashout");
    }
    // 사람이 앉을 자리가 없으면 봇 하나가 일어남 (칩이 가장 적은 봇)
    if (!freeSeats(t).length) {
      const b = bots(t).sort((a, c) => a.stack - c.stack)[0];
      if (b) leaveLater(b, "leave");
    }
    const due = t.botReturns.filter((at) => at <= now()).length;
    t.botReturns = t.botReturns.filter((at) => at > now());
    for (let i = 0; i < due; i++) if (bots(t).length < t.botTarget && !addBot(t)) t.botReturns.push(now() + ms(10_000));
  }

  // ───────────── 진행 ─────────────

  function clearTimers(t: Table) {
    if (t.timer) clearTimeout(t.timer);
    t.timer = null;
    for (const h of t.actTimers.values()) clearTimeout(h);
    t.actTimers.clear();
    t.waitMark = "";
  }

  function later(t: Table, delay: number, fn: () => void) {
    if (t.timer) clearTimeout(t.timer);
    t.timer = setTimeout(() => {
      t.timer = null;
      if (!t.closed) safely(t, fn);
    }, delay);
  }

  /** 진행 중 오류가 나도 서버가 죽지 않게: 그 판을 없던 일로 하고 테이블을 대기 상태로 */
  function safely(t: Table, fn: () => void) {
    try {
      fn();
    } catch (e) {
      console.error(`[poker] 테이블 ${t.id} 진행 오류 — 판을 무효로 함`, e);
      abortRound(t);
    }
  }

  function abortRound(t: Table) {
    clearTimers(t);
    t.round = null;
    t.inRound.clear();
    t.lastView = null;
    for (const s of t.seats) if (s?.leaving) removeSeat(t, s, "leave");
    emit(t);
    scheduleNext(t, 3000);
  }

  /** 사람이 한 명이라도 이 판에 살아 있는지 (없으면 봇끼리 빨리 끝냄) */
  const humanAlive = (t: Table) => [...t.inRound.values()].some((s) => s.uid && !s.leaving && t.round!.alive(s.seat));

  /** 판을 한 걸음 진행: 기다릴 사람이 있으면 타이머를 걸고, 없으면 다음 카드로 */
  function pump(t: Table) {
    const round = t.round;
    if (!round || t.closed) return;
    if (round.done()) return settle(t);

    const waiting = round.waiting();
    if (!waiting.length) {
      for (const h of t.actTimers.values()) clearTimeout(h);
      t.actTimers.clear();
      t.waitMark = "";
      const { ev, pause } = round.step();
      // 엎은 카드를 받았을 수 있으니(7포커) 내 패를 다시 보냄
      for (const s of t.inRound.values()) sendHand(t, s);
      emit(t, ...ev);
      return later(t, humanAlive(t) ? ms(pause) : ms(Math.min(pause, 250)), () => pump(t));
    }

    // 같은 기다림이면 타이머는 그대로 둠 (7포커의 카드 고르기처럼 여럿이 동시에 기다릴 때 한 명이 끝내도 나머지 시간은 유지)
    const mark = `${t.handNo}:${round.waitKind()}:${waiting.join(",")}`;
    const fresh = !t.waitMark.startsWith(`${t.handNo}:${round.waitKind()}:`) || round.waitKind() === "act";
    if (fresh) {
      for (const h of t.actTimers.values()) clearTimeout(h);
      t.actTimers.clear();
    }
    if (mark === t.waitMark && !fresh) return;
    t.waitMark = mark;

    const limit = round.waitKind() === "choice" ? choiceMs : actMs;
    if (fresh) t.deadline = now() + limit;
    for (const seatNo of waiting) {
      if (t.actTimers.has(seatNo)) continue;
      const s = t.inRound.get(seatNo)!;
      if (s.brain) {
        const move = round.botMove(seatNo, s.brain);
        const think = humanAlive(t) ? ms(move.thinkMs) : ms(120);
        t.actTimers.set(
          seatNo,
          setTimeout(() => {
            t.actTimers.delete(seatNo);
            if (t.closed || t.round !== round) return;
            safely(t, () => {
              let ev: PokerEvent[];
              try {
                ev = round.act(seatNo, move.input);
              } catch (e) {
                if (!(e instanceof RoundError)) throw e;
                console.warn(`[poker] 봇 행동이 규칙에 안 맞음 (${s.name})`, e.message);
                ev = round.timeout(seatNo);
              }
              const text = move.cue && humanAlive(t) ? line(s.brain!, move.cue) : undefined;
              emit(t, ...ev, ...(text ? [{ t: "say", seat: seatNo, text } as PokerEvent] : []));
              pump(t);
            });
          }, think)
        );
        continue;
      }
      // 자리를 뜬 사람은 바로 죽음, 끊긴 사람은 짧게 기다림
      const wait = s.leaving ? 0 : s.away ? Math.min(awayMs, Math.max(0, t.deadline - now())) : Math.max(0, t.deadline - now());
      if (s.away && !s.leaving && fresh && waiting.length === 1) t.deadline = now() + wait;
      t.actTimers.set(
        seatNo,
        setTimeout(() => {
          t.actTimers.delete(seatNo);
          if (t.closed || t.round !== round) return;
          safely(t, () => {
            const ev = round.timeout(seatNo, s.leaving);
            if (!s.leaving && ++s.timeouts >= TIMEOUTS_TO_SITOUT && s.status !== "out") {
              s.autoOut = true;
              s.status = "out";
              s.outAt = now();
            }
            emit(t, ...ev);
            pump(t);
          });
        }, wait)
      );
    }
    emit(t);
  }

  /** 판이 끝남: 칩을 자리에 돌려놓고, 사람 몫의 증감을 DB 에 반영 */
  function settle(t: Table) {
    const round = t.round!;
    clearTimers(t);
    const deltas = round.deltas();
    const won = round.won();
    const base = t.def.base(t.tier);
    const entries: SettleEntry[] = [];
    const says: PokerEvent[] = [];
    const quiet = !humans(t).length;
    const keyOf = (seat: number) => {
      const s = t.inRound.get(seat);
      return s ? (s.uid ?? `bot:${s.brain!.id}`) : undefined;
    };
    const bluffers = round
      .bluffers()
      .map(keyOf)
      .filter((k): k is string => !!k);

    for (const [seatNo, s] of t.inRound) {
      s.stack = round.stack(seatNo);
      const delta = deltas[seatNo] ?? 0;
      if (s.uid) {
        entries.push({ uid: s.uid, delta, game: t.game, won: (won[seatNo] ?? 0) > 0, wonAmount: won[seatNo] ?? 0 });
      } else if (s.brain) {
        coolDown(s.brain, Math.max(0, -delta / base));
        for (const k of bluffers) if (k !== `bot:${s.brain.id}`) s.brain.grudge.set(k, Math.min(2, (s.brain.grudge.get(k) ?? 0) + 0.6));
        const cue = round.cueFor(seatNo);
        const text = cue && !quiet ? line(s.brain, cue, cue === "bigWin" || cue === "badBeat") : undefined;
        if (text && says.length < 2) says.push({ t: "say", seat: seatNo, text });
      }
    }
    t.def.learn?.(round, t.mem, keyOf);

    const audit = {
      _id: newId(),
      at: new Date(now()),
      table: t.id,
      game: t.game,
      tier: t.tier.id,
      no: t.handNo,
      who: [...t.inRound.values()].map((s) => ({ seat: s.seat, uid: s.uid, bot: s.brain?.id ?? null, name: s.name, delta: deltas[s.seat] ?? 0 })),
      hand: round.audit(),
    };
    const showdown = !!round.view(0).result?.showdown;
    t.lastView = round.view(0);
    t.round = null;
    t.inRound.clear();

    // 돈 반영 (다음 판은 이게 끝난 뒤에 시작)
    const writing = wallet
      .settle(entries)
      .catch((e) => console.error(`[poker] 정산 저장 실패 (테이블 ${t.id}, ${t.handNo}번째 판)`, e, entries));
    t.settling = writing;
    for (const e of entries) {
      settlingOf.set(e.uid, writing);
      void writing.then(() => settlingOf.get(e.uid) === writing && settlingOf.delete(e.uid));
    }
    db.col("poker_hands")
      .insertOne(audit as never)
      .catch((e) => console.warn("[poker] 핸드 기록 실패", e));

    for (const s of t.seats) if (s?.leaving) removeSeat(t, s, "leave");
    emit(t, ...says);
    scheduleNext(t, showdown ? 5200 : 2400);
  }

  function scheduleNext(t: Table, delay: number) {
    if (t.closed) return;
    const fast = !humans(t).length;
    t.nextAt = now() + ms(fast ? 300 : delay);
    later(t, ms(fast ? 300 : delay), () => void tryStart(t));
  }

  /** 다음 판 시작 (조건이 안 되면 대기) */
  async function tryStart(t: Table) {
    if (t.closed || t.round || t.starting) return;
    t.starting = true;
    try {
      await t.settling;
      if (t.closed || t.round) return;
      t.nextAt = null;

      // 자리 정리: 끊긴 지 오래된 사람 · 자리 비움이 길어진 사람
      for (const s of humans(t)) {
        if (s.away && now() - s.awayAt >= ms(AWAY_KICK_MS)) removeSeat(t, s, "idle");
        else if (s.status === "out" && now() - s.outAt >= ms(SITOUT_KICK_MS)) removeSeat(t, s, "idle");
      }
      tendBots(t);

      // 사람은 DB 의 금액으로 칩을 다시 맞춤 (회생 등 반영). 입장컷 밑이면 내려옴
      const hs = humans(t);
      await settled(hs.map((s) => s.uid!));
      const money = await wallet.moneyOf(hs.map((s) => s.uid!));
      if (t.closed || t.round) return;
      for (const s of hs) {
        if (t.seats[s.seat] !== s) continue;
        const m = money.get(s.uid!) ?? 0;
        s.stack = Math.floor(m / UNIT) * UNIT;
        if (m < t.tier.min) removeSeat(t, s, s.stack < t.def.minStack(t.tier) ? "bust" : "cut");
      }

      // 금액을 읽는 사이에 앉은 사람은 이번 판에 넣지 않음 (다음 판을 시작할 때 금액을 다시 읽고 참가)
      const ready = t.seats.filter(
        (s): s is Seat => !!s && s.status !== "out" && !(s.uid && s.away) && (!s.uid || hs.includes(s)) && s.stack >= t.def.minStack(t.tier)
      );
      if (ready.length < 2 || !ready.some((s) => s.uid)) {
        for (const s of t.seats) if (s && s.status === "in") s.status = "wait";
        t.lastView = null;
        emit(t);
        return;
      }

      for (const s of ready) s.status = "in";
      for (const s of t.seats) if (s && !ready.includes(s) && s.status === "in") s.status = "wait";
      t.handNo++;
      t.lastView = null;
      t.inRound = new Map(ready.map((s) => [s.seat, s]));
      const { round, ev, pause } = t.def.start({
        tier: t.tier,
        handNo: t.handNo,
        seats: ready.map((s) => ({ seat: s.seat, stack: s.stack, key: s.uid ?? `bot:${s.brain!.id}`, human: !!s.uid })),
        mem: t.mem,
        randInt: (n) => randomInt(n),
      });
      t.round = round;
      for (const s of ready) sendHand(t, s);
      emit(t, ...ev);
      later(t, ms(pause), () => pump(t));
    } catch (e) {
      console.error(`[poker] 테이블 ${t.id} 판 시작 오류`, e);
      t.round = null;
      t.inRound.clear();
      scheduleNext(t, 3000);
    } finally {
      t.starting = false;
    }
  }

  /** 대기 중인 테이블이면 곧 시작을 시도 */
  function nudge(t: Table, delay = 1200) {
    if (t.round || t.starting || t.timer || t.closed) return;
    scheduleNext(t, delay);
  }

  function closeTable(t: Table) {
    if (t.closed) return;
    t.closed = true;
    clearTimers(t);
    // 진행 중이던 판은 없던 일 (DB 의 돈은 판이 끝날 때만 바뀌므로 그대로)
    t.round = null;
    tables.delete(t.id);
    for (const s of humans(t)) {
      seatOf.delete(s.uid!);
      pushWallet(s.uid!);
      gateway.revoke(meKey(t.id, s.uid!));
    }
    gateway.emit(tableKey(t.id), "state", null);
    gateway.revoke(tableKey(t.id));
    lobbyChanged();
  }

  // ───────────── 권한 ─────────────

  /** 회원(별명을 정한 사람)만 */
  function member(ctx: Ctx): { uid: string; nick: string } {
    const uid = ctx.uid;
    if (!ctx.nick) throw new AppError("MEMBERS_ONLY", "회원만 이용할 수 있어요. 로그인하고 별명을 정해주세요.", 403);
    return { uid, nick: ctx.nick };
  }
  const getTable = (id: string): Table => {
    const t = tables.get(id);
    if (!t) throw new AppError("NO_TABLE", "테이블이 없어요.", 404);
    return t;
  };

  const tableId = z.string().regex(/^[A-Za-z0-9]{1,40}$/);
  const idOnly = z.object({ id: tableId });
  const gameSchema = z.enum(["holdem", "seven"]);
  const tierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

  // ───────────── 구독 채널 ─────────────

  gateway.channel("poker.lobby", { key: () => LOBBY, snapshot: () => lobbyWire() });

  gateway.channel("poker.table", {
    key(ctx, p) {
      member(ctx);
      return tableKey(idOnly.parse(p).id);
    },
    snapshot(_ctx, _key, p) {
      const t = tables.get(idOnly.parse(p).id);
      return t ? { table: wire(t), chat: t.chat } : null;
    },
  });

  gateway.channel("poker.me", {
    key(ctx, p) {
      return meKey(idOnly.parse(p).id, member(ctx).uid);
    },
    snapshot(ctx, _key, p) {
      const t = tables.get(idOnly.parse(p).id);
      const s = t && findSeat(t, ctx.uid);
      if (!t || !s) return null;
      // 다시 접속함
      if (s.away) {
        s.away = false;
        emit(t);
        nudge(t);
      }
      const secret = inLiveRound(t, s) ? t.round!.secret(s.seat) : null;
      return secret ? ({ handNo: t.handNo, seat: s.seat, ...secret } satisfies MyHand) : null;
    },
    closed(ctx, key) {
      // 이 사람의 다른 탭이 아직 보고 있으면 접속 중
      if (gateway.subscribers(key).length) return;
      const [, , id, ...rest] = key.split(":");
      const uid = rest.join(":");
      const t = tables.get(id);
      const s = t && findSeat(t, uid);
      if (!t || !s || s.away) return;
      void ctx;
      s.away = true;
      s.awayAt = now();
      emit(t);
    },
  });

  gateway.channel("poker.wallet", {
    key: (ctx) => walletKey(member(ctx).uid),
    async snapshot(ctx) {
      const w = await wallet.get(ctx.uid);
      return w ? walletWire(ctx.uid, w) : null;
    },
  });

  // ───────────── 요청 ─────────────

  function createTable(o: { game: GameKind; tier: Tier; name: string; bots: number; password: string; ownerUid: string }): Table {
    // 한 사람이 빈 테이블을 쌓아 둘 수 없게: 새로 만들면 그 사람이 만든, 아무도 안 앉은 테이블은 닫음
    for (const old of [...tables.values()]) if (old.ownerUid === o.ownerUid && !humans(old).length && !old.round) closeTable(old);
    if (tables.size >= MAX_TABLES) throw bad("테이블이 너무 많아요. 잠시 후 다시 시도해주세요.");
    const id = newId(12);
    const password = o.password.trim();
    const size = GAMES[o.game].seats;
    const t: Table = {
      id,
      name: o.name,
      game: o.game,
      def: GAME_DEFS[o.game],
      tier: o.tier,
      locked: password !== "",
      pw: password ? hashPw(id, password) : null,
      ownerUid: o.ownerUid,
      access: new Set([o.ownerUid]),
      createdAt: now(),
      seats: Array.from({ length: size }, () => null),
      botTarget: Math.max(0, Math.min(BOT_IDS.length, size - 2, o.bots)),
      botReturns: [],
      handNo: 0,
      round: null,
      inRound: new Map(),
      mem: {},
      lastView: null,
      deadline: 0,
      nextAt: null,
      timer: null,
      actTimers: new Map(),
      waitMark: "",
      seq: 0,
      ev: [],
      chat: [],
      settling: Promise.resolve(),
      starting: false,
      closed: false,
      emptySince: now(),
    };
    tables.set(id, t);
    for (let i = 0; i < t.botTarget; i++) addBot(t);
    t.ev = [];
    lobbyChanged();
    return t;
  }

  const createSchema = z.object({
    game: gameSchema,
    tier: tierSchema,
    name: z.string().max(40).default(""),
    bots: z.number().int().min(0).max(4).default(DEFAULT_BOTS),
    password: z.string().max(40).default(""),
  });
  gateway.rpc("poker.create", (ctx, raw) => {
    const { uid, nick } = member(ctx);
    const o = createSchema.parse(raw);
    const t = createTable({ ...o, tier: tierOf(o.tier), name: o.name.trim().slice(0, 20) || `${nick}의 테이블`, ownerUid: uid });
    return t.id;
  });

  /** 바로 입장: 같은 게임·단계의 공개 테이블 중 사람이 있는 곳, 없으면 봇과 함께 새 테이블 */
  gateway.rpc("poker.quick", (ctx, raw) => {
    const { uid } = member(ctx);
    const o = z.object({ game: gameSchema, tier: tierSchema }).parse(raw);
    const mine = seatOf.get(uid);
    if (mine && tables.has(mine)) return mine;
    // 접속해 있는 사람이 있는 테이블을 먼저 (끊긴 사람만 남은 테이블로는 안 보냄)
    const online = (t: Table) => humans(t).filter((s) => !s.away).length;
    const open = [...tables.values()]
      .filter((t) => t.game === o.game && t.tier.id === o.tier && !t.locked && freeSeats(t).length > 0)
      .sort((a, b) => online(b) - online(a))[0];
    if (open && online(open)) return open.id;
    // 방금 내가 열어 두고 아직 안 앉은 같은 종류의 테이블이 있으면 그걸 다시 씀 (여러 번 눌러도 하나만)
    const own = [...tables.values()].find((t) => t.ownerUid === uid && t.game === o.game && t.tier.id === o.tier && !t.locked && !humans(t).length && !t.round);
    if (own) return own.id;
    const tier = tierOf(o.tier);
    const n = [...tables.values()].filter((t) => t.game === o.game && t.tier.id === o.tier).length + 1;
    return createTable({ game: o.game, tier, name: `${tier.name} ${n}번`, bots: DEFAULT_BOTS, password: "", ownerUid: uid }).id;
  });

  // 비밀번호 대입 방지
  const tries = new Map<string, { at: number; n: number }>();
  function countTry(key: string) {
    const t = tries.get(key);
    if (!t || now() - t.at > 60_000) tries.set(key, { at: now(), n: 1 });
    else if (++t.n > 10) throw new AppError("RATE_LIMITED", "잠시 후 다시 시도해주세요.", 429);
    if (tries.size > 5000) tries.clear();
  }

  /** 자리에 앉기. 가진 돈 전부가 칩이 되고, 다음 판부터 참가 */
  gateway.rpc("poker.sit", async (ctx, raw) => {
    const { uid, nick } = member(ctx);
    const { id, password } = z.object({ id: tableId, password: z.string().max(40).optional() }).parse(raw);
    const t = getTable(id);
    const cur = findSeat(t, uid);
    if (cur) {
      // 나가려던 걸 취소하고 다시 앉음
      cur.leaving = false;
      // 접속 여부는 내 패 구독이 있는지로만 판단 (구독 없이 앉기만 다시 불러 "접속 중"이 될 수 없게)
      cur.away = gateway.subscribers(meKey(id, uid)).length === 0;
      if (cur.away) cur.awayAt = now();
      if (cur.status === "out") cur.status = "wait";
      emit(t);
      nudge(t);
      return { seat: cur.seat };
    }
    const other = seatOf.get(uid);
    if (other === id) throw new AppError("BUSY", "자리에 앉는 중이에요.", 409);
    if (other && tables.has(other)) throw new AppError("ALREADY_SEATED", "다른 테이블에 앉아 있어요. 그 판이 끝나야 옮길 수 있어요.", 409, { table: other });
    if (t.locked && !t.access.has(uid)) {
      countTry(`${id}/${uid}`);
      if (!t.pw || !safeEqual(hashPw(id, password ?? ""), t.pw)) throw new AppError("WRONG_PASSWORD", "비밀번호가 맞지 않아요.", 403);
      t.access.add(uid);
    }
    // 여기서부터는 중간에 끼어들 수 없게 자리를 먼저 잡고(예약) 돈을 확인
    const free = freeSeats(t);
    if (!free.length) throw new AppError("TABLE_FULL", "자리가 없어요.", 409);
    seatOf.set(uid, id);
    let doc: (Pick<UserDoc, "avatar"> & { money?: number }) | null;
    try {
      // 방금 다른 테이블에서 끝난 판의 정산이 반영된 뒤의 금액으로
      await settlingOf.get(uid);
      const w = await wallet.get(uid);
      doc = (await db.col<UserDoc>("users").findOne({ _id: uid }, { projection: { "avatar.at": 1 } })) as typeof doc;
      if (!w) throw new AppError("MEMBERS_ONLY", "회원만 이용할 수 있어요.", 403);
      if (w.money < t.tier.min) throw new AppError("NEED_MONEY", `이 테이블(${t.tier.name})에는 보유금액 ${fmtWon(t.tier.min)} 원부터 앉을 수 있어요.`, 409, { min: t.tier.min, money: w.money });
      if (t.closed || tables.get(id) !== t) throw new AppError("NO_TABLE", "테이블이 없어요.", 404);
      const still = freeSeats(t);
      if (!still.length) throw new AppError("TABLE_FULL", "자리가 없어요.", 409);
      const seat = still[randomInt(still.length)];
      t.seats[seat] = {
        seat,
        uid,
        brain: null,
        name: nick,
        avatar: doc?.avatar ? avatarPath(uid, doc.avatar.at) : null,
        stack: Math.floor(w.money / UNIT) * UNIT,
        status: "wait",
        away: gateway.subscribers(meKey(id, uid)).length === 0,
        awayAt: now(),
        timeouts: 0,
        autoOut: false,
        outAt: 0,
        leaving: false,
      };
      users.bump(uid, { "stats.poker.games": 1 });
      lobbyChanged();
      pushWallet(uid);
      emit(t, { t: "sit", seat, name: nick });
      nudge(t);
      return { seat };
    } catch (e) {
      if (!findSeat(t, uid)) seatOf.delete(uid);
      throw e;
    }
  });

  /** 자리에서 일어남. 판 도중이면 그 판은 죽은 것으로 치고, 정산된 뒤에 자리가 비워짐 */
  function leave(t: Table, s: Seat) {
    if (inLiveRound(t, s)) {
      s.leaving = true;
      const round = t.round!;
      // 내 차례를 기다리는 중이면 바로 죽음
      if (round.waiting().includes(s.seat)) {
        const h = t.actTimers.get(s.seat);
        if (h) clearTimeout(h);
        t.actTimers.delete(s.seat);
        safely(t, () => {
          const ev = round.timeout(s.seat, true);
          t.waitMark = "";
          emit(t, ...ev);
          pump(t);
        });
      } else emit(t);
      return;
    }
    removeSeat(t, s, "leave");
    emit(t);
  }

  gateway.rpc("poker.leave", (ctx, raw) => {
    const t = tables.get(idOnly.parse(raw).id);
    const s = t && findSeat(t, ctx.uid);
    if (t && s) leave(t, s);
    return null;
  });

  /** 행동 (콜 · 레이즈 · 카드 고르기 …). 금액·차례는 전부 서버가 규칙대로 검사 */
  gateway.rpc("poker.act", (ctx, raw) => {
    const { uid } = member(ctx);
    const o = z.looseObject({ id: tableId, hand: z.number().int() }).parse(raw);
    const t = getTable(o.id);
    const s = findSeat(t, uid);
    const round = t.round;
    if (!s || !round || !inLiveRound(t, s) || s.leaving) throw forbidden("이 판에 참가하고 있지 않아요.");
    if (o.hand !== t.handNo) throw new AppError("STALE", "이미 지나간 판이에요.", 409);
    if (!round.waiting().includes(s.seat)) throw new AppError("NOT_YOUR_TURN", "지금은 차례가 아니에요.", 409);
    let ev: PokerEvent[];
    try {
      ev = round.act(s.seat, raw);
    } catch (e) {
      if (e instanceof RoundError) throw bad(e.message);
      throw e;
    }
    s.timeouts = 0;
    if (s.autoOut && s.status === "out") s.status = "in";
    s.autoOut = false;
    const h = t.actTimers.get(s.seat);
    if (h) clearTimeout(h);
    t.actTimers.delete(s.seat);
    // 사람이 올인하면 봇 하나가 한마디
    const says: PokerEvent[] = [];
    if (ev.some((x) => x.t === "act" && x.a === "allin")) {
      const live = [...t.inRound.values()].filter((b) => b.brain && round.alive(b.seat));
      const b = live[randomInt(Math.max(1, live.length))];
      const text = b && line(b.brain!, "humanAllin");
      if (text) says.push({ t: "say", seat: b.seat, text });
    }
    safely(t, () => {
      sendHand(t, s);
      emit(t, ...ev, ...says);
      pump(t);
    });
    return null;
  });

  /** 자리 비움 켜기/끄기 (켜면 다음 판부터 카드를 안 받음) */
  gateway.rpc("poker.sitout", (ctx, raw) => {
    const { id, out } = z.object({ id: tableId, out: z.boolean() }).parse(raw);
    const t = getTable(id);
    const s = findSeat(t, ctx.uid);
    if (!s) throw forbidden();
    s.autoOut = false;
    if (out && s.status !== "out") {
      s.status = "out";
      s.outAt = now();
    } else if (!out && s.status === "out") {
      s.status = "wait";
      s.timeouts = 0;
    }
    emit(t);
    if (!out) nudge(t);
    return null;
  });

  const chatAt = new Map<string, number>();
  gateway.rpc("poker.chat", (ctx, raw) => {
    const { uid, nick } = member(ctx);
    const { id, text } = z.object({ id: tableId, text: z.string().min(1).max(80) }).parse(raw);
    const t = getTable(id);
    if (now() - (chatAt.get(uid) ?? 0) < 700) throw new AppError("RATE_LIMITED", "조금 천천히 보내주세요.", 429);
    chatAt.set(uid, now());
    if (chatAt.size > 5000) chatAt.clear();
    const msg: ChatMsg = { id: orderedId(), uid, name: nick, text: text.trim().slice(0, 80), ts: now() };
    if (!msg.text) return null;
    t.chat.push(msg);
    if (t.chat.length > CHAT_KEEP) t.chat.splice(0, t.chat.length - CHAT_KEEP);
    gateway.emit(tableKey(id), "chat", msg);
    return null;
  });

  gateway.rpc("poker.wallet", async (ctx) => {
    const { uid } = member(ctx);
    const w = await wallet.get(uid);
    return w ? walletWire(uid, w) : null;
  });

  gateway.rpc("poker.revive", async (ctx) => {
    const { uid } = member(ctx);
    const w = await wallet.revive(uid);
    // 앉아 있는 테이블이 쉬고 있으면 바로 다음 판을 시도
    const t = tables.get(seatOf.get(uid) ?? "");
    if (t) nudge(t, 600);
    return walletWire(uid, w);
  });

  // 별명이 바뀌면 앉아 있는 자리의 이름도
  users.onRename((uid, nick) => {
    const t = tables.get(seatOf.get(uid) ?? "");
    const s = t && findSeat(t, uid);
    if (!t || !s) return;
    if (nick) {
      s.name = nick;
      emit(t);
    } else leave(t, s);
  });

  // ───────────── 정리 ─────────────

  const sweep = setInterval(() => {
    for (const t of [...tables.values()]) {
      if (!humans(t).length) {
        // 사람이 없고 보는 사람도 없으면 닫음 (판 도중이면 끝나길 기다림 — 방금 나간 사람의 정산이 남아 있을 수 있음)
        if (!t.round && now() - t.emptySince >= EMPTY_TTL_MS && !gateway.subscribers(tableKey(t.id)).length) closeTable(t);
        else if (!t.round && now() - t.emptySince >= 10 * 60_000) closeTable(t);
        continue;
      }
      // 쉬고 있는 테이블: 끊긴 사람 정리 · 봇 복귀 · 시작 조건이 됐는지 다시 확인
      if (!t.round && !t.starting && !t.timer) void tryStart(t);
    }
  }, opts.sweepIntervalMs ?? 5000);
  sweep.unref();

  return {
    wallet,
    close() {
      clearInterval(sweep);
      for (const t of [...tables.values()]) {
        t.closed = true;
        clearTimers(t);
      }
      tables.clear();
      seatOf.clear();
    },
    adminList(): LiveRoom[] {
      return [...tables.values()].map((t) => ({
        id: t.id,
        name: `${GAMES[t.game].name} · ${t.tier.name} · ${t.name}`,
        status: t.round ? "play" : "wait",
        players: t.seats.filter((s): s is Seat => !!s).map((s) => (s.brain ? `${s.name}(봇)` : s.name)),
        createdAt: t.createdAt,
      }));
    },
    /** (관리자) 테이블 닫기 — 진행 중이던 판은 무효 */
    adminClose(id: string): boolean {
      const t = tables.get(id);
      if (t) closeTable(t);
      return !!t;
    },
    /** 테스트용 */
    _tables: tables,
    _tiers: TIERS,
  };
}
