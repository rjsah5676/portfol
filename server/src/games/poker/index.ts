import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Deps } from "../../deps";
import { AppError, bad, forbidden } from "../../errors";
import type { LiveRoom } from "../../http/admin";
import type { LiveGame } from "../../live";
import { newId, orderedId } from "../../ids";
import type { Ctx } from "../../realtime/gateway";
import { pictureOf, type UserDoc } from "../../users";
import {
  ACT_AWAY_MS,
  ACT_MS,
  BOT_CHAR_IDS,
  CHAR_IDS,
  CHAR_PRICE,
  charOwned,
  CHOICE_MS,
  EMOTES,
  GAMES,
  REVIVE,
  SITOUT_KICK_MS,
  START_MONEY,
  TIERS,
  TIMEOUTS_TO_SITOUT,
  UNIT,
  SKIN_IDS,
  charOf,
  fmtWon,
  lookOf,
  tierOf,
  type CharId,
  type Look,
  type SkinId,
  type GameKind,
  type Tier,
  type TierId,
} from "../../../../web/src/lib/poker/rules";
import type { ChatMsg, HoldemView, LobbyTable, MyHand, MyPage, PokerEvent, SeatWire, SevenView, TableWire, Wallet } from "../../../../web/src/lib/poker/types";
import { holdem } from "./holdem/round";
import { emptyStats, playStats, type HandDoc } from "./mystats";
import { uniqueNickname } from "./nicknames";
import { coolDown, line, newBrain, type Brain } from "./personas";
import { RoundError, type GameDef, type Round } from "./round";
import { seven } from "./seven/round";
import { createWallet, skinsOf, type SettleEntry } from "./wallet";

/*
 * 포커 테이블 (홀덤 · 7포커 공용). 회원만 이용.
 *
 * 테이블은 서버 메모리에 있고(스케치·격투 방처럼), 돈만 DB 에 있음.
 * 배포로 서버를 다시 띄울 때는 진행 중인 판이 끝나길 기다렸다가 사람이 앉은 테이블을 저장해 두고 이어받음 (live.ts).
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
  /** 유저봇이면 그 머리 */
  brain: Brain | null;
  name: string;
  char: CharId;
  /** 그림 열쇠 (사람이 스킨을 입었으면 스킨 id) */
  look: Look;
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
  /** 나가기 예약: 이번 판은 끝까지 치고, 끝나면 나감. idle = 시간 초과가 이어져 자동으로 걸림 (직접 행동하면 풀림) */
  exitAfter: "" | "leave" | "idle" | "vote";
  /** 이 방에 앉을 때의 칩 (딴 돈 = 지금 칩 − 이것) */
  joinStack: number;
  /** 이 방에서 친 판 수 · 이긴 판 수 */
  hands: number;
  wins: number;
  /** 강퇴 투표: 누가(uid 또는 봇 key) → 몇 번째 판에 (KICK_HANDS 판이 지나면 지워짐) */
  kickVotes: Map<string, number>;
  /** 사람이 던진 표가 (아직 유효하게) 있음 → 봇들이 따라 투표 */
  kickByHuman: boolean;
}

/** 강퇴 투표: 3표면 강퇴, 표는 10판 지나면 사라짐, 3판 이상 친 사람만 투표, 강퇴되면 30분 동안 그 방에 못 앉음 */
const KICK_NEED = 3;
const KICK_HANDS = 10;
const KICK_MIN_HANDS = 3;
const KICK_BAN_MS = 30 * 60_000;

interface Table {
  id: string;
  name: string;
  game: GameKind;
  def: GameDef;
  tier: Tier;
  locked: boolean;
  pw: string | null;
  /** 방을 연 사람 ("" = 봇이 연 방) */
  ownerUid: string;
  access: Set<string>;
  createdAt: number;
  seats: (Seat | null)[];
  /** 유저봇이 들어올 수 있는 방 */
  bots: boolean;
  /** 바로 입장으로 모르는 사람이 들어올 수 있는 방 (아니면 친구방: 링크 · 목록으로만) */
  quick: boolean;
  /** 지금 이 방이 "붐비는" 정도 — 봇은 이 수까지 찼다 빠졌다 함 (가끔 다시 뽑음) */
  botTarget: number;
  /** 다음 봇이 들어오는 시각 (0 = 예정 없음) */
  botNext: number;
  /** 사람이 앉아 있기 시작한 시각 (0 = 사람 없음) — 오래 이어지면 봇이 빈자리까지 채움 */
  peopleSince: number;
  /** 지금 앉는 중(돈 확인 중)인 사람 수 */
  joining: number;
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
  /** 투표로 강퇴된 사람 → 다시 앉을 수 있는 시각 */
  banned: Map<string, number>;
  /** 봇이 연 방: 사람이 안 오면 이 시각에 닫고 새 방으로 교체 */
  botRoomUntil: number;
}

export interface PokerOptions {
  /** 진행 속도 배수 (테스트는 0 = 기다림 없이) */
  speed?: number;
  /** 사람의 제한 시간 (기본: 규칙의 ACT_MS · CHOICE_MS · ACT_AWAY_MS) */
  actMs?: number;
  choiceMs?: number;
  awayMs?: number;
  /** 정리 주기 (봇 입장도 이 주기로 확인) */
  sweepIntervalMs?: number;
  now?: () => number;
  /** 칩이 바닥나면 기본 칩 자동 지급 (기본 켜짐. 돈 계산을 맞춰 보는 테스트는 끔) */
  autoRevive?: boolean;
  /** 로비에 봇이 연 방을 유지 (기본 켜짐. 로비 내용을 맞춰 보는 테스트는 끔) */
  lobbyBots?: boolean;
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

  const seatWire = (t: Table, s: Seat): SeatWire => {
    const stack = t.round && t.inRound.get(s.seat) === s ? t.round.stack(s.seat) : s.stack;
    return {
      seat: s.seat,
      uid: s.uid ?? "",
      name: s.name,
      char: s.char,
      look: s.look,
      stack,
      status: s.status,
      away: s.away,
      exit: !!s.exitAfter,
      hands: s.hands,
      wins: s.wins,
      net: stack - s.joinStack,
      votes: liveVotes(t, s),
    };
  };
  /** 아직 유효한(최근 KICK_HANDS 판 안의) 강퇴 표 수 */
  function liveVotes(t: Table, s: Seat): number {
    for (const [k, at] of s.kickVotes) if (t.handNo - at >= KICK_HANDS) s.kickVotes.delete(k);
    if (!s.kickVotes.size) s.kickByHuman = false;
    return s.kickVotes.size;
  }

  const wire = (t: Table, ev: PokerEvent[] = []): TableWire => ({
    id: t.id,
    name: t.name,
    game: t.game,
    tier: t.tier.id,
    locked: t.locked,
    bots: t.bots,
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
        players: t.seats.filter((s) => !!s).length,
        max: t.seats.length,
        bots: t.bots,
        quick: t.quick,
        createdAt: t.createdAt,
      }))
      .sort((a, b) => b.players - a.players || b.createdAt - a.createdAt);

  let lobbyDirty = false;
  function lobbyChanged() {
    if (lobbyDirty) return;
    lobbyDirty = true;
    queueMicrotask(() => {
      lobbyDirty = false;
      gateway.emit(LOBBY, "list", lobbyWire());
    });
  }

  /** 상태가 바뀜 → 테이블을 보는 모두에게. 봇의 한마디는 채팅에도 남김 */
  function emit(t: Table, ...ev: PokerEvent[]) {
    if (t.closed) return;
    t.ev.push(...ev);
    for (const e of t.ev) {
      if (e.t !== "say") continue;
      const s = t.seats[e.seat];
      if (s?.brain) pushChat(t, { id: orderedId(), uid: "", name: s.name, char: s.char, text: e.text, ts: now() });
    }
    t.seq++;
    gateway.emit(tableKey(t.id), "state", wire(t, t.ev));
    t.ev = [];
  }

  const walletWire = (uid: string, w: Omit<Wallet, "table" | "revived">): Wallet => ({ ...w, table: seatOf.get(uid) ?? null });
  wallet.onChange((uid, w) => gateway.emit(walletKey(uid), "wallet", walletWire(uid, w)));
  /** 앉은 테이블이 바뀌었을 때 내 지갑 화면도 갱신 */
  const pushWallet = (uid: string) =>
    void wallet
      .get(uid)
      .then((w) => w && gateway.emit(walletKey(uid), "wallet", walletWire(uid, w)))
      .catch(() => {});

  /**
   * 기본 칩 자동 지급: 테이블에 안 앉아 있고 칩이 가장 낮은 입장컷(REVIVE.under) 아래면 하루 REVIVE.perDay 번까지 REVIVE.amount 를 줌.
   * 받았으면 그 지갑(+ revived 알림 정보)을 돌려주고, 아니면 null.
   */
  async function autoRevive(uid: string): Promise<Wallet | null> {
    if (opts.autoRevive === false || seatOf.has(uid)) return null;
    const cur = await wallet.get(uid);
    if (!cur || cur.money >= REVIVE.under || cur.reviveUsed >= REVIVE.perDay) return null;
    try {
      const w = await wallet.revive(uid);
      const out: Wallet = { ...walletWire(uid, w), revived: { amount: REVIVE.amount, left: REVIVE.perDay - w.reviveUsed } };
      gateway.emit(walletKey(uid), "wallet", out);
      return out;
    } catch {
      return null; // 동시에 다른 곳에서 받았거나 한도
    }
  }

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
  /**
   * 판 도중에 나가는(또는 강퇴된) 사람이 이미 죽어 있으면 판이 끝나길 기다리지 않고 바로 자리를 비움 —
   * 다른 방에 바로 앉을 수 있게. 정산은 t.inRound 에 남은 자리 객체로 판이 끝날 때 그대로 됨 (잃은 돈은 그때 반영).
   */
  function detachIfOut(t: Table, s: Seat) {
    if (!s.uid || !inLiveRound(t, s) || t.seats[s.seat] !== s) return false;
    if (!s.leaving && !(s.exitAfter && s.exitAfter !== "idle")) return false;
    if (t.round!.alive(s.seat)) return false;
    s.leaving = true;
    removeSeat(t, s, exitWhy(s));
    return true;
  }

  /** 예약된 나가기의 이유 → leave 이벤트의 why */
  const exitWhy = (s: Seat): "idle" | "vote" | "leave" => (s.exitAfter === "idle" ? "idle" : s.exitAfter === "vote" ? "vote" : "leave");

  function removeSeat(t: Table, s: Seat, why: (PokerEvent & { t: "leave" })["why"]) {
    if (t.seats[s.seat] !== s) return;
    t.seats[s.seat] = null;
    if (s.uid) {
      const uid = s.uid;
      seatOf.delete(uid);
      pushWallet(uid);
      // 정산이 끝난 뒤 칩이 바닥났으면 기본 칩 지급
      void settled([uid])
        .then(() => autoRevive(uid))
        .catch(() => {});
    }
    t.ev.push({ t: "leave", seat: s.seat, name: s.name, why });
    if (!humans(t).length) {
      t.emptySince = now();
      t.peopleSince = 0;
    }
    lobbyChanged();
  }

  /*
   * 봇 늘리기 (관리자 화면에서 켜고 끔, DB 에 저장 — 기본 켜짐)
   *   켜짐: 테이블마다 봇 적어도 셋 · 빨리 들어옴 · 로비의 봇 방 6개 · 사람이 2분 넘게 치고 있으면 빈자리(사람 자리 하나 빼고)까지 채움
   *   꺼짐: 예전처럼 봇 2명~ · 천천히 · 로비 봇 방 3개 · 정한 수까지만
   */
  let botBoost = true;
  const BOT_FILL_MS = 120_000;
  const settingsCol = db.col<{ _id: string; botBoost?: boolean }>("site_settings");
  void settingsCol
    .findOne({ _id: "poker" })
    .then((d) => {
      if (typeof d?.botBoost === "boolean") botBoost = d.botBoost;
    })
    .catch(() => {});

  const rollBotTarget = (t: Table) => {
    const max = t.seats.length - 1; // 사람 자리 하나는 늘 남김
    t.botTarget = botBoost ? Math.min(max, 3 + randomInt(Math.max(1, max - 2))) : Math.min(max, 2 + randomInt(max - 1));
  };
  /** 지금 들어올 수 있는 봇 수: 봇 늘리기가 켜져 있으면 사람이 친 시간만큼 늘어 2분이면 꽉 */
  const botTargetNow = (t: Table) => {
    const max = t.seats.length - 1;
    if (!botBoost || !t.peopleSince) return t.botTarget;
    const f = Math.min(1, (now() - t.peopleSince) / ms(BOT_FILL_MS));
    return Math.min(max, Math.max(t.botTarget, Math.ceil(t.botTarget + (max - t.botTarget) * f)));
  };
  /** 다음 봇이 들어올 때를 잡음 (first = 사람이 막 앉았을 때는 금방) */
  function planBot(t: Table, first = false) {
    if (!t.bots || t.botNext || bots(t).length >= botTargetNow(t) || freeSeats(t).length <= 1 || !humans(t).length) return;
    const wait = botBoost ? (first ? 1_500 + randomInt(4_000) : 4_000 + randomInt(18_000)) : first ? 2_500 + randomInt(7_000) : 6_000 + randomInt(40_000);
    t.botNext = now() + ms(wait);
  }

  /** 유저봇 한 명이 들어와 앉음 (별명·캐릭터·성격·자금 전부 그때그때 다름) */
  function addBot(t: Table): boolean {
    const free = freeSeats(t);
    if (free.length - t.joining <= 1) return false;
    const seat = free[randomInt(free.length)];
    // 사야 쓰는 캐릭터는 봇이 안 씀
    const char = BOT_CHAR_IDS[randomInt(BOT_CHAR_IDS.length)];
    const name = uniqueNickname(t.seats.map((x) => x?.name ?? ""));
    // 들고 오는 돈: 기준의 0.6~2.2배, 적어도 입장컷의 1.5배
    const money = Math.max(Math.round(t.tier.min * 1.5), Math.round(t.tier.botMoney * (0.6 + randomInt(161) / 100)));
    const brain = newBrain(char, t.tier.id);
    t.seats[seat] = {
      seat,
      uid: null,
      brain,
      name,
      char,
      look: char,
      stack: Math.floor(money / UNIT) * UNIT,
      status: "wait",
      away: false,
      awayAt: 0,
      timeouts: 0,
      autoOut: false,
      outAt: 0,
      leaving: false,
      exitAfter: "",
      joinStack: Math.floor(money / UNIT) * UNIT,
      hands: 0,
      wins: 0,
      kickVotes: new Map(),
      kickByHuman: false,
    };
    t.ev.push({ t: "sit", seat, name });
    const hello = humans(t).length ? line(brain, "sit") : undefined;
    if (hello) t.ev.push({ t: "say", seat, text: hello });
    lobbyChanged();
    return true;
  }

  /** 판 사이에 봇을 정리: 파산·수금·오래 친 봇은 나가고, 자리가 꽉 찼으면 하나 비켜 줌 */
  function tendBots(t: Table) {
    const leaveNow = (s: Seat, why: "bust" | "cashout" | "leave") => {
      const text = humans(t).length ? line(s.brain!, why, why !== "leave") : undefined;
      if (text) t.ev.push({ t: "say", seat: s.seat, text });
      removeSeat(t, s, why);
      rollBotTarget(t);
      planBot(t);
    };
    for (const s of bots(t)) {
      // 방장이 봇 참가를 껐으면 판 사이에 다 나감
      if (!t.bots) leaveNow(s, "leave");
      else if (s.stack < t.def.minStack(t.tier)) leaveNow(s, "bust");
      else if (s.stack >= t.tier.botMoney * 3) leaveNow(s, "cashout");
      else if (s.brain!.hands >= s.brain!.stayHands) leaveNow(s, "leave");
    }
    // 사람이 앉을 자리가 없으면 봇 하나가 일어남 (칩이 가장 적은 봇).
    // 방금 앉은 사람이 있으면 두 판은 같이 쳐 줌 — 들어오자마자 봇이 인사하고 나가면 어색해서
    if (!freeSeats(t).length && humans(t).every((h) => h.hands >= 2)) {
      const b = bots(t).sort((a, c) => a.stack - c.stack)[0];
      if (b) leaveNow(b, "leave");
    }
    planBot(t);
  }

  /** 들어올 때가 된 봇을 앉힘 (판 도중이어도 앉고, 다음 판부터 침). 앉혔으면 true */
  function arriveBots(t: Table): boolean {
    if (!t.bots) return false;
    // 예정이 없으면 다시 잡아 봄 (시간이 지나 들어올 수 있는 수가 늘었을 수 있음)
    if (!t.botNext) {
      planBot(t);
      return false;
    }
    if (t.botNext > now()) return false;
    t.botNext = 0;
    const added = bots(t).length < botTargetNow(t) && humans(t).length > 0 && addBot(t);
    planBot(t);
    return added;
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
    for (const s of t.seats) if (s?.leaving || s?.exitAfter) removeSeat(t, s, exitWhy(s));
    emit(t);
    scheduleNext(t, 3000);
  }

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
      t.deadline = 0; // 카드 돌리는 동안은 아무도 기다리지 않음
      const { ev, pause } = round.step();
      // 엎은 카드를 받았을 수 있으니(7포커) 내 패를 다시 보냄
      for (const s of t.inRound.values()) sendHand(t, s);
      emit(t, ...ev);
      return later(t, ms(pause), () => pump(t));
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
        // 봇은 사람처럼 생각하는 시간을 그대로 씀 (봇끼리 남아도 빨리 돌리지 않음). 최소 1.2초, 제한 시간 0.9초 전까지
        const think = ms(Math.max(1200, Math.min(limit - 900, move.thinkMs * (0.9 + Math.random() * 0.5))));
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
              const text = move.cue && humans(t).length ? line(s.brain!, move.cue) : undefined;
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
            // 시간 초과가 이어지면 나가기 예약 (이번 판 끝나면 자리에서 일어남)
            if (!s.leaving && ++s.timeouts >= TIMEOUTS_TO_SITOUT && !s.exitAfter) s.exitAfter = "idle";
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
      return s ? (s.uid ?? s.brain!.key) : undefined;
    };
    const bluffers = round
      .bluffers()
      .map(keyOf)
      .filter((k): k is string => !!k);

    for (const [seatNo, s] of t.inRound) {
      s.stack = round.stack(seatNo);
      s.hands += 1;
      if ((won[seatNo] ?? 0) > 0) s.wins += 1;
      const delta = deltas[seatNo] ?? 0;
      if (s.uid) {
        entries.push({ uid: s.uid, delta, game: t.game, won: (won[seatNo] ?? 0) > 0, wonAmount: won[seatNo] ?? 0 });
      } else if (s.brain) {
        coolDown(s.brain, Math.max(0, -delta / base));
        for (const k of bluffers) if (k !== s.brain.key) s.brain.grudge.set(k, Math.min(2, (s.brain.grudge.get(k) ?? 0) + 0.6));
        const cue = round.cueFor(seatNo);
        const text = cue && !quiet ? line(s.brain, cue, cue === "bigWin" || cue === "badBeat") : undefined;
        if (text && says.length < 2) says.push({ t: "say", seat: seatNo, text });
      }
    }
    t.def.learn?.(round, t.mem, keyOf);
    // 강퇴 투표가 걸려 있는 자리: 이번 판으로 3판을 채운 봇들도 따라 투표
    for (const s of t.seats) if (s && !s.leaving && liveVotes(t, s) > 0) botsFollowVote(t, s);

    const audit = {
      _id: newId(),
      at: new Date(now()),
      table: t.id,
      game: t.game,
      tier: t.tier.id,
      no: t.handNo,
      who: [...t.inRound.values()].map((s) => ({ seat: s.seat, uid: s.uid, bot: !!s.brain, name: s.name, char: s.char, delta: deltas[s.seat] ?? 0 })),
      hand: round.audit(),
    };
    const resView = round.view(0).result;
    const showdown = !!resView?.showdown;
    // 쇼다운이면 화면에서 패를 한 자리씩 까는 시간(자리당 0.5초) + 승리 연출 3초
    const shown = resView ? Object.keys(resView.names).length : 0;
    const leftEarly = [...t.inRound.values()].filter((x) => x.uid && t.seats[x.seat] !== x).map((x) => x.uid!);
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

    // 판 도중에 먼저 나간 사람: 정산이 끝나면 칩이 바닥났는지 확인
    for (const uid of leftEarly)
      void settled([uid])
        .then(() => autoRevive(uid))
        .catch(() => {});
    // 나가기 예약: 다이한 사람은 바로, 끝까지 간 사람은 승리/패배 연출을 다 보고 다음 판 직전(tryStart)에 나감
    for (const s of t.seats) {
      if (!s) continue;
      const p = t.lastView?.players[s.seat];
      if (s.leaving || (s.exitAfter && (!p || p.folded))) removeSeat(t, s, exitWhy(s));
    }
    emit(t, ...says);
    // (+1.5초: 승리 · 패배 대사를 다 듣고 다음 판으로)
    scheduleNext(t, showdown ? 4500 + 500 * Math.max(2, shown) + 1500 : 3900);
  }

  function scheduleNext(t: Table, delay: number) {
    if (t.closed) return;
    t.nextAt = now() + ms(delay);
    later(t, ms(delay), () => void tryStart(t));
  }

  /** 다음 판 시작 (조건이 안 되면 대기) */
  async function tryStart(t: Table) {
    if (t.closed || t.round || t.starting || draining) return;
    const hold = holdUntil.get(t.id);
    if (hold !== undefined) {
      if (now() < hold && humans(t).some((s) => s.away)) return;
      holdUntil.delete(t.id);
    }
    t.starting = true;
    try {
      await t.settling;
      if (t.closed || t.round) return;
      t.nextAt = null;

      // 자리 정리: 끊긴 지 오래된 사람 · 자리 비움이 길어진 사람
      for (const s of humans(t)) {
        if (s.exitAfter) removeSeat(t, s, exitWhy(s));
        else if (s.away && now() - s.awayAt >= ms(AWAY_KICK_MS)) removeSeat(t, s, "idle");
        else if (s.status === "out" && now() - s.outAt >= ms(SITOUT_KICK_MS)) removeSeat(t, s, "idle");
      }
      tendBots(t);
      arriveBots(t);

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
      // 사람이 한 명도 안 앉아 있으면 판을 돌리지 않음 (앉아만 있으면 — 자리 비움이어도 — 봇끼리는 침)
      if (ready.length < 2 || !humans(t).length) {
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
        seats: ready.map((s) => ({ seat: s.seat, stack: s.stack, key: s.uid ?? s.brain!.key, human: !!s.uid })),
        mem: t.mem,
        randInt: (n) => randomInt(n),
      });
      t.round = round;
      t.deadline = 0; // 지난 판의 마감시각이 첫 상태에 실리지 않게 (화면의 카운트다운이 헛뜨던 원인)
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

  /** 배포로 곧 다시 시작함 → 새 판을 돌리지 않음 */
  let draining = false;
  /** 다시 켜진 직후: 이 시각까지는 자리 비운(아직 다시 접속 안 한) 사람이 있으면 판을 시작하지 않음 — 돌아오는 사람이 판을 놓치지 않게 */
  const holdUntil = new Map<string, number>();

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
  const tierSchema = z
    .number()
    .int()
    .refine((n) => TIERS.some((t) => t.id === n), "없는 단계")
    .transform((n) => n as TierId);

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
      // 접속했을 때 칩이 바닥나 있으면 기본 칩부터 지급
      const got = await autoRevive(ctx.uid).catch(() => null);
      if (got) return got;
      const w = await wallet.get(ctx.uid);
      return w ? walletWire(ctx.uid, w) : null;
    },
  });

  // ───────────── 요청 ─────────────

  function createTable(o: { game: GameKind; tier: Tier; name: string; bots: boolean; quick?: boolean; password: string; ownerUid: string }): Table {
    // 한 사람이 빈 테이블을 쌓아 둘 수 없게: 새로 만들면 그 사람이 만든, 아무도 안 앉은 테이블은 닫음
    if (o.ownerUid) for (const old of [...tables.values()]) if (old.ownerUid === o.ownerUid && !humans(old).length && !old.round) closeTable(old);
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
      quick: o.quick ?? true,
      // 봇은 바로 입장을 허용한 방에만
      bots: o.bots && (o.quick ?? true),
      botTarget: 0,
      peopleSince: 0,
      joining: 0,
      botNext: 0,
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
      banned: new Map(),
      botRoomUntil: 0,
    };
    rollBotTarget(t);
    tables.set(id, t);
    lobbyChanged();
    return t;
  }

  const createSchema = z.object({
    game: gameSchema,
    tier: tierSchema,
    name: z.string().max(40).default(""),
    bots: z.boolean().default(true),
    quick: z.boolean().default(true),
    password: z.string().max(40).default(""),
  });
  gateway.rpc("poker.create", (ctx, raw) => {
    const { uid, nick } = member(ctx);
    const o = createSchema.parse(raw);
    const t = createTable({ ...o, tier: tierOf(o.tier), name: o.name.trim().slice(0, 20) || `${nick}의 테이블`, ownerUid: uid });
    return t.id;
  });

  /**
   * 방 설정: 바로 입장 허용 · 봇 참가 가능 (봇은 바로 입장 허용일 때만).
   * 값 없이 부르면 지금 설정과 내가 방장인지만 돌려줌. 바꾸는 건 방을 연 사람만.
   * 봇 참가를 끄면 판이 안 돌 땐 봇이 바로, 판 도중이면 그 판이 끝나고 나감.
   */
  gateway.rpc("poker.roomOpts", (ctx, raw) => {
    const { uid } = member(ctx);
    const o = z.object({ id: z.string().max(40), quick: z.boolean().optional(), bots: z.boolean().optional() }).parse(raw);
    const t = tables.get(o.id);
    if (!t || t.closed) throw bad("없는 테이블이에요.");
    const owner = !!t.ownerUid && t.ownerUid === uid;
    if (o.quick !== undefined || o.bots !== undefined) {
      if (!owner) throw forbidden("방을 연 사람만 바꿀 수 있어요.");
      const quick = o.quick ?? t.quick;
      const botsOn = quick && (o.bots ?? t.bots);
      const changed = quick !== t.quick || botsOn !== t.bots;
      t.quick = quick;
      t.bots = botsOn;
      if (changed) {
        if (!t.bots) {
          t.botNext = 0;
          if (!t.round) for (const b of bots(t)) removeSeat(t, b, "leave");
        } else {
          rollBotTarget(t);
          planBot(t);
        }
        lobbyChanged();
        emit(t);
      }
    }
    return { owner, quick: t.quick, bots: t.bots };
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
      .filter((t) => t.game === o.game && t.tier.id === o.tier && !t.locked && t.quick && freeSeats(t).length > 0)
      .sort((a, b) => online(b) - online(a))[0];
    if (open && online(open)) return open.id;
    // 사람이 없으면 봇이 열어 둔 방 (봇이 많이 앉은 곳부터)
    const botRoom = [...tables.values()]
      .filter((t) => t.game === o.game && t.tier.id === o.tier && !t.locked && t.quick && t.bots && !t.ownerUid && freeSeats(t).length > 0 && !humans(t).length)
      .sort((a, b) => bots(b).length - bots(a).length)[0];
    if (botRoom) return botRoom.id;
    // 방금 내가 열어 두고 아직 안 앉은 같은 종류의 테이블이 있으면 그걸 다시 씀 (여러 번 눌러도 하나만)
    const own = [...tables.values()].find((t) => t.ownerUid === uid && t.game === o.game && t.tier.id === o.tier && !t.locked && t.quick && !humans(t).length && !t.round);
    if (own) return own.id;
    const tier = tierOf(o.tier);
    const n = [...tables.values()].filter((t) => t.game === o.game && t.tier.id === o.tier).length + 1;
    return createTable({ game: o.game, tier, name: `${tier.name} ${n}번`, bots: true, password: "", ownerUid: uid }).id;
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
      cur.exitAfter = "";
      // 접속 여부는 내 패 구독이 있는지로만 판단 (구독 없이 앉기만 다시 불러 "접속 중"이 될 수 없게)
      cur.away = gateway.subscribers(meKey(id, uid)).length === 0;
      if (cur.away) cur.awayAt = now();
      if (cur.status === "out") cur.status = "wait";
      emit(t);
      nudge(t);
      return { seat: cur.seat };
    }
    const banUntil = t.banned.get(uid) ?? 0;
    if (banUntil > now()) throw new AppError("BANNED", `투표로 강퇴된 방이에요. ${Math.ceil((banUntil - now()) / 60_000)}분 뒤에 다시 앉을 수 있어요.`, 403, { until: banUntil });
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
    // 앉는 중인 사람 몫의 자리는 봇이 못 가져감 (돈 확인을 기다리는 사이 봇이 빈자리를 채우지 않게)
    t.joining++;
    try {
      // 방금 다른 테이블에서 끝난 판의 정산이 반영된 뒤의 금액으로
      await settlingOf.get(uid);
      const w = await wallet.get(uid);
      if (!w) throw new AppError("MEMBERS_ONLY", "회원만 이용할 수 있어요.", 403);
      if (w.money < t.tier.min) throw new AppError("NEED_MONEY", `이 테이블(${t.tier.name})에는 칩 ${fmtWon(t.tier.min)}부터 앉을 수 있어요.`, 409, { min: t.tier.min, money: w.money });
      if (t.closed || tables.get(id) !== t) throw new AppError("NO_TABLE", "테이블이 없어요.", 404);
      const still = freeSeats(t);
      if (!still.length) throw new AppError("TABLE_FULL", "자리가 없어요.", 409);
      const seat = still[randomInt(still.length)];
      if (!humans(t).length) t.peopleSince = now();
      t.seats[seat] = {
        seat,
        uid,
        brain: null,
        name: nick,
        char: w.char,
        look: lookOf(w.char, w.wear),
        stack: Math.floor(w.money / UNIT) * UNIT,
        status: "wait",
        away: gateway.subscribers(meKey(id, uid)).length === 0,
        awayAt: now(),
        timeouts: 0,
        autoOut: false,
        outAt: 0,
        leaving: false,
        exitAfter: "",
        joinStack: Math.floor(w.money / UNIT) * UNIT,
        hands: 0,
        wins: 0,
        kickVotes: new Map(),
        kickByHuman: false,
      };
      users.bump(uid, { "stats.poker.games": 1 });
      lobbyChanged();
      pushWallet(uid);
      emit(t, { t: "sit", seat, name: nick });
      planBot(t, true);
      nudge(t);
      return { seat };
    } catch (e) {
      if (!findSeat(t, uid)) seatOf.delete(uid);
      throw e;
    } finally {
      t.joining--;
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
          detachIfOut(t, s);
          emit(t, ...ev);
          pump(t);
        });
      } else {
        detachIfOut(t, s);
        emit(t);
      }
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

  /** 나가기 예약 켜기/끄기. 판에 안 끼어 있으면(대기 · 폴드 전 판 없음) 바로 나감. 돌려주는 값: 바로 나갔는지 */
  gateway.rpc("poker.exit", (ctx, raw) => {
    const { id, on } = z.object({ id: tableId, on: z.boolean() }).parse(raw);
    const t = getTable(id);
    const s = findSeat(t, ctx.uid);
    if (!s) throw forbidden();
    const playing = inLiveRound(t, s) && !!t.round?.alive(s.seat) && !s.leaving;
    if (on && !playing) {
      leave(t, s);
      return { left: true };
    }
    s.exitAfter = on ? "leave" : "";
    // 이미 죽어 있는 판이면 기다릴 것 없이 바로 나감
    if (on && detachIfOut(t, s)) {
      emit(t);
      return { left: true };
    }
    if (!on) s.timeouts = 0;
    emit(t);
    return { left: false };
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
    if (s.exitAfter === "idle") s.exitAfter = "";
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
      // 나가기 예약을 걸어 두고 죽었으면 바로 나감
      detachIfOut(t, s);
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
    const me = findSeat(t, uid);
    const msg: ChatMsg = { id: orderedId(), uid, name: nick, char: me?.char ?? "jinwoo", look: me?.look, text: text.trim().slice(0, 80), ts: now() };
    if (!msg.text) return null;
    pushChat(t, msg);
    return null;
  });

  function pushChat(t: Table, msg: ChatMsg) {
    t.chat.push(msg);
    if (t.chat.length > CHAT_KEEP) t.chat.splice(0, t.chat.length - CHAT_KEEP);
    gateway.emit(tableKey(t.id), "chat", msg);
  }

  // ───────────── 강퇴 투표 ─────────────

  /** 투표로 강퇴: 판 중이면 죽은 것으로 치고 판이 끝나면 비워짐, 아니면 바로. 사람이면 한동안 그 방에 못 앉음 */
  function kickOut(t: Table, s: Seat) {
    if (s.uid) t.banned.set(s.uid, now() + ms(KICK_BAN_MS));
    if (inLiveRound(t, s)) {
      s.leaving = true;
      s.exitAfter = "vote";
      const round = t.round!;
      if (round.waiting().includes(s.seat)) {
        const h = t.actTimers.get(s.seat);
        if (h) clearTimeout(h);
        t.actTimers.delete(s.seat);
        safely(t, () => {
          const ev = round.timeout(s.seat, true);
          t.waitMark = "";
          detachIfOut(t, s);
          emit(t, ...ev);
          pump(t);
        });
      } else emit(t);
      return;
    }
    removeSeat(t, s, "vote");
    rollBotTarget(t);
    planBot(t);
    emit(t);
  }

  /** 한 표. 돌려주는 값 = 지금까지 표 수 (강퇴됐으면 KICK_NEED 이상). 투표할 수 없으면 오류 */
  function castVote(t: Table, voter: Seat, target: Seat): number {
    const key = voter.uid ?? voter.brain!.key;
    if (voter === target) throw bad("자기 자신에게는 투표할 수 없어요.");
    if (voter.hands < KICK_MIN_HANDS) throw new AppError("TOO_EARLY", `이 방에서 ${KICK_MIN_HANDS}판 이상 치면 투표할 수 있어요.`, 403, { hands: voter.hands, need: KICK_MIN_HANDS });
    liveVotes(t, target);
    if (target.kickVotes.has(key)) throw new AppError("ALREADY_VOTED", "이미 투표했어요.", 409);
    target.kickVotes.set(key, t.handNo);
    if (voter.uid) target.kickByHuman = true;
    const votes = target.kickVotes.size;
    emit(t, { t: "kick", seat: target.seat, by: voter.seat, votes, need: KICK_NEED });
    if (votes >= KICK_NEED) kickOut(t, target);
    return votes;
  }

  /** 사람이 투표하면 봇들도 (3판 이상 친 봇만) 1~4초 뒤에 따라 투표 — 봇만 있는 방에서도 강퇴가 되게. 판이 끝날 때마다 다시 봄(그새 3판을 채운 봇) */
  function botsFollowVote(t: Table, target: Seat) {
    if (!target.kickByHuman || t.seats[target.seat] !== target) return;
    for (const b of bots(t)) {
      if (b === target || b.hands < KICK_MIN_HANDS || target.kickVotes.has(b.brain!.key)) continue;
      setTimeout(() => {
        if (t.closed || t.seats[b.seat] !== b || t.seats[target.seat] !== target || target.leaving) return;
        try {
          castVote(t, b, target);
        } catch {}
      }, ms(1000 + randomInt(3000))).unref?.();
    }
  }

  gateway.rpc("poker.kick", (ctx, raw) => {
    const { uid } = member(ctx);
    const { id, seat } = z.object({ id: tableId, seat: z.number().int().min(0).max(9) }).parse(raw);
    const t = getTable(id);
    const me = findSeat(t, uid);
    if (!me) throw forbidden("자리에 앉아 있어야 해요.");
    const target = t.seats[seat];
    if (!target || target.leaving) throw bad("그 자리에 아무도 없어요.");
    const votes = castVote(t, me, target);
    if (votes < KICK_NEED) botsFollowVote(t, target);
    return { votes, need: KICK_NEED, kicked: votes >= KICK_NEED };
  });

  /** 이모티콘: 채팅에도 남고 자리 위에 잠깐 뜸. 가끔 봇이 따라 함 */
  gateway.rpc("poker.emote", (ctx, raw) => {
    const { uid, nick } = member(ctx);
    const { id, emote } = z.object({ id: tableId, emote: z.enum(EMOTES) }).parse(raw);
    const t = getTable(id);
    const me = findSeat(t, uid);
    if (!me) throw forbidden("자리에 앉아 있어야 해요.");
    if (now() - (chatAt.get(uid) ?? 0) < 1200) throw new AppError("RATE_LIMITED", "조금 천천히 보내주세요.", 429);
    chatAt.set(uid, now());
    pushChat(t, { id: orderedId(), uid, name: nick, char: me.char, look: me.look, text: "", emote, ts: now() });
    emit(t, { t: "emote", seat: me.seat, emote });
    const bs = bots(t);
    if (bs.length && randomInt(100) < 30) {
      const b = bs[randomInt(bs.length)];
      setTimeout(() => {
        if (t.closed || t.seats[b.seat] !== b) return;
        const e = EMOTES[randomInt(EMOTES.length)];
        pushChat(t, { id: orderedId(), uid: "", name: b.name, char: b.char, text: "", emote: e, ts: now() });
        emit(t, { t: "emote", seat: b.seat, emote: e });
      }, ms(1500 + randomInt(3000))).unref?.();
    }
    return null;
  });

  /** 내 캐릭터 고르기 (앉아 있으면 그 자리도 바로 바뀜) */
  gateway.rpc("poker.char", async (ctx, raw) => {
    const { uid } = member(ctx);
    const { char } = z.object({ char: z.enum(CHAR_IDS as [CharId, ...CharId[]]) }).parse(raw);
    if (CHAR_PRICE[char]) {
      const own = await wallet.get(uid);
      if (!own || !charOwned(char, own.chars)) throw new AppError("NOT_OWNED", "아직 없는 캐릭터예요. 상점에서 살 수 있어요.", 409);
    }
    await db.col<UserDoc>("users").updateOne({ _id: uid }, { $set: { "poker.char": char } });
    const t = tables.get(seatOf.get(uid) ?? "");
    const s = t && findSeat(t, uid);
    if (t && s) {
      const w = await wallet.get(uid);
      s.char = char;
      s.look = lookOf(char, w?.wear);
      emit(t);
    }
    pushWallet(uid);
    return null;
  });

  /** 상점: 스킨 사기 (테이블에 앉아 있으면 안 됨 — 앉은 동안의 칩은 판에 들고 있어서). 사면 바로 입음 */
  gateway.rpc("poker.buy", async (ctx, raw) => {
    const { uid } = member(ctx);
    const { skin } = z.object({ skin: z.enum(SKIN_IDS as [SkinId, ...SkinId[]]) }).parse(raw);
    if (seatOf.has(uid)) throw new AppError("SEATED", "테이블에서 일어난 뒤에 살 수 있어요.", 409);
    await settlingOf.get(uid);
    const w = await wallet.buySkin(uid, skin);
    return walletWire(uid, w);
  });

  /** 상점: 캐릭터 사기 (테이블에 앉아 있으면 안 됨). 사면 바로 그 캐릭터로 */
  gateway.rpc("poker.buyChar", async (ctx, raw) => {
    const { uid } = member(ctx);
    const { char } = z.object({ char: z.enum(CHAR_IDS as [CharId, ...CharId[]]) }).parse(raw);
    if (seatOf.has(uid)) throw new AppError("SEATED", "테이블에서 일어난 뒤에 살 수 있어요.", 409);
    await settlingOf.get(uid);
    const w = await wallet.buyChar(uid, char);
    return walletWire(uid, w);
  });

  /** 옷장: 스킨 입기 / 벗기 (앉아 있으면 그 자리 그림도 바로) */
  gateway.rpc("poker.wear", async (ctx, raw) => {
    const { uid } = member(ctx);
    const { char, skin } = z.object({ char: z.enum(CHAR_IDS as [CharId, ...CharId[]]), skin: z.enum(SKIN_IDS as [SkinId, ...SkinId[]]).nullable() }).parse(raw);
    const w = await wallet.wearSkin(uid, char, skin);
    const t = tables.get(seatOf.get(uid) ?? "");
    const s = t && findSeat(t, uid);
    if (t && s) {
      s.look = lookOf(s.char, w.wear);
      emit(t);
    }
    return walletWire(uid, w);
  });

  gateway.rpc("poker.wallet", async (ctx) => {
    const { uid } = member(ctx);
    const w = await wallet.get(uid);
    return w ? walletWire(uid, w) : null;
  });

  /** 마이페이지: 전적 · 순위 · 최근 판 */
  gateway.rpc("poker.me", async (ctx): Promise<MyPage | null> => {
    const { uid } = member(ctx);
    const doc = (await db.col<UserDoc>("users").findOne({ _id: uid }, { projection: { nick: 1, createdAt: 1, money: 1, "stats.poker": 1, "poker.char": 1, "poker.skins": 1, "poker.wear": 1, "avatar.at": 1, photo: 1 } })) as (UserDoc & { poker?: { char?: string; skins?: string[]; wear?: Record<string, string> }; _id: string }) | null;
    if (!doc) return null;
    const money = doc.money ?? START_MONEY;
    const pk = doc.stats?.poker ?? {};
    const hands = pk.hands ?? 0;
    // 순위: 한 판이라도 친 회원 중 나보다 돈이 많은 사람 수 + 1 (아직 안 쳤으면 없음)
    const rank = hands > 0 ? (await db.col("users").countDocuments({ "stats.poker.hands": { $gte: 1 }, money: { $gt: money } })) + 1 : null;
    let recent: MyPage["recent"] = [];
    let stats: MyPage["stats"] = { holdem: emptyStats(), seven: emptyStats() };
    try {
      const docs = await db
        .col("poker_hands")
        .find({ "who.uid": uid }, { projection: { at: 1, game: 1, tier: 1, no: 1, who: 1, "hand.players": 1, "hand.actions": 1 } })
        .sort({ at: -1 })
        .limit(500)
        .toArray();
      stats = playStats(docs as unknown as HandDoc[], uid);
      recent = docs.slice(0, 12).map((d) => {
        const h = d as unknown as { at: Date; game: GameKind; tier: TierId; no: number; who: { uid: string | null; delta: number; name: string }[] };
        const mine = h.who.find((w) => w.uid === uid);
        const rivals = h.who.filter((w) => w.uid !== uid).length;
        return { at: new Date(h.at).getTime(), game: h.game, tier: h.tier, delta: mine?.delta ?? 0, rivals };
      });
    } catch {
      recent = [];
    }
    return {
      nick: doc.nick,
      char: charOf(doc.poker?.char),
      look: lookOf(charOf(doc.poker?.char), skinsOf(doc.poker).wear),
      avatar: pictureOf(uid, doc),
      since: new Date(doc.createdAt).getTime(),
      money,
      rank,
      games: pk.games ?? 0,
      hands,
      best: pk.best ?? 0,
      holdem: { hands: pk.holdem?.hands ?? 0, wins: pk.holdem?.wins ?? 0 },
      seven: { hands: pk.seven?.hands ?? 0, wins: pk.seven?.wins ?? 0 },
      recent,
      stats,
    };
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

  /** 로비가 비어 보이지 않게: 게임별로 들어갈 수 있는 공개 방을 몇 개 유지 (봇이 열고 봇 몇이 앉아서 기다림) */
  const lobbyRoomTarget = () => (botBoost ? 6 : 3);
  /** 봇이 여는 방의 단계 비중 (낮은 판일수록 자주) */
  const BOT_ROOM_WEIGHT = [6, 3, 2, 1.6, 1.2, 1, 0.7, 0.5, 0.4];
  function ensureBotRooms() {
    if (opts.lobbyBots === false || tables.size >= MAX_TABLES - 10) return;
    const pickTier = (from: number, to: number) => {
      const w = BOT_ROOM_WEIGHT.slice(from - 1, to);
      let r = (randomInt(10_000) / 10_000) * w.reduce((a, b) => a + b, 0);
      for (let k = 0; k < w.length; k++) {
        r -= w[k];
        if (r < 0) return from + k;
      }
      return from;
    };
    const open = (t: Table) => t.bots && !t.locked && freeSeats(t).length > 1;
    // 홀덤 · 7포커 똑같이: 게임마다 전체 목표 수, 그중 "일반" 리그(로비 첫 탭, 판돈 1~3단계)에 최소 몇 개
    // (전에는 전체 수만 맞춰서, 운에 따라 한 게임의 일반 탭이 텅 비어 보일 때가 있었음)
    const lowNeed = botBoost ? 3 : 2;
    for (const game of ["holdem", "seven"] as GameKind[]) {
      const rooms = [...tables.values()].filter((t) => t.game === game && open(t));
      let low = rooms.filter((t) => t.tier.id <= 3).length;
      // 동네판(누구나 앉을 수 있는 단계) 방은 늘 하나는 있게 — 새 회원(1억)이 VIP룸만 보고 못 앉는 일이 없게
      let needLow = !rooms.some((t) => t.tier.id === 1);
      for (let n = rooms.length; n < lobbyRoomTarget() || low < lowNeed || needLow; n++) {
        const tierId = needLow ? 1 : low < lowNeed ? pickTier(1, 3) : pickTier(1, BOT_ROOM_WEIGHT.length);
        needLow = false;
        if (tierId <= 3) low++;
        const tier = tierOf(tierId);
        const t = createTable({ game, tier, name: `${uniqueNickname([])}의 테이블`, bots: true, password: "", ownerUid: "" });
        // 5~15분 동안 사람이 안 오면 닫고 다른 방으로 교체 (방 이름이 계속 바뀌어 자연스럽게)
        t.botRoomUntil = now() + ms((5 + randomInt(11)) * 60_000);
        const seatN = botBoost ? 2 + randomInt(3) : 1 + randomInt(3);
        for (let k = 0; k < seatN; k++) addBot(t);
        rollBotTarget(t);
        emit(t);
        if (tables.size >= MAX_TABLES - 10) return;
      }
    }
  }

  const sweep = setInterval(() => {
    for (const t of [...tables.values()]) {
      if (!humans(t).length) {
        if (t.botRoomUntil && t.bots && !t.ownerUid) {
          // 봇이 연 방: 수명이 다하면 닫음 (사람이 들어왔다 나간 방도 다시 수명으로)
          if (!t.round && now() >= t.botRoomUntil && !gateway.subscribers(tableKey(t.id)).length) closeTable(t);
          continue;
        }
        // 사람이 없고 보는 사람도 없으면 닫음 (판 도중이면 끝나길 기다림 — 방금 나간 사람의 정산이 남아 있을 수 있음)
        if (!t.round && now() - t.emptySince >= EMPTY_TTL_MS && !gateway.subscribers(tableKey(t.id)).length) closeTable(t);
        else if (!t.round && now() - t.emptySince >= 10 * 60_000) closeTable(t);
        continue;
      }
      // 들어올 때가 된 유저봇 (판 도중이어도 앉음)
      if (arriveBots(t)) emit(t);
      // 쉬고 있는 테이블: 끊긴 사람 정리 · 시작 조건이 됐는지 다시 확인
      if (!t.round && !t.starting && !t.timer) void tryStart(t);
    }
    ensureBotRooms();
  }, opts.sweepIntervalMs ?? 3000);
  sweep.unref();

  // ───────────── 배포 때 이어받기 (live.ts) ─────────────

  type SavedSeat = Omit<Seat, "brain" | "kickVotes"> & {
    brain: (Omit<Brain, "grudge" | "rand"> & { grudge: [string, number][] }) | null;
    kickVotes: [string, number][];
  };
  const live: LiveGame = {
    // 판 도중에는 카드·베팅이 서버에만 있어서 끝나길 기다림 (최대 DRAIN_MS — 넘으면 그 판은 없던 일, 돈은 판이 끝날 때만 바뀌어서 그대로)
    busy: () => [...tables.values()].some((t) => !!t.round || t.starting),
    drain() {
      draining = true;
    },
    async flush() {
      await Promise.all([...tables.values()].map((t) => t.settling));
      await Promise.all([...settlingOf.values()]);
    },
    // 사람이 앉은 테이블만 (봇만 있는 로비 방은 다시 켜지면 새로 열림)
    snapshot: () =>
      [...tables.values()]
        .filter((t) => !t.closed && humans(t).length)
        .map((t) => ({
          id: t.id,
          name: t.name,
          game: t.game,
          tier: t.tier.id,
          locked: t.locked,
          pw: t.pw,
          ownerUid: t.ownerUid,
          access: [...t.access],
          createdAt: t.createdAt,
          seats: t.seats.map((x): SavedSeat | null =>
            x
              ? {
                  ...x,
                  brain: x.brain ? (({ rand: _r, ...b }) => ({ ...b, grudge: [...b.grudge] }))(x.brain) : null,
                  kickVotes: [...x.kickVotes],
                }
              : null
          ),
          bots: t.bots,
          quick: t.quick,
          botTarget: t.botTarget,
          botNext: t.botNext,
          peopleSince: t.peopleSince,
          handNo: t.handNo,
          // 봇의 상대 기록(models)은 클래스라 버리고 버튼 자리만
          button: (t.mem as { button?: number }).button,
          chat: t.chat,
          emptySince: t.emptySince,
          banned: [...t.banned],
          botRoomUntil: t.botRoomUntil,
        })),
    restore(data, downMs) {
      for (const r of data as {
        id: string;
        name: string;
        game: GameKind;
        tier: TierId;
        locked: boolean;
        pw: string | null;
        ownerUid: string;
        access: string[];
        createdAt: number;
        seats: (SavedSeat | null)[];
        bots: boolean;
        quick: boolean;
        botTarget: number;
        botNext: number;
        peopleSince: number;
        handNo: number;
        button?: number;
        chat: ChatMsg[];
        emptySince: number;
        banned: [string, number][];
        botRoomUntil: number;
      }[]) {
        if (tables.has(r.id) || !GAME_DEFS[r.game]) continue;
        const seats = r.seats.map((x): Seat | null => {
          if (!x) return null;
          // 다시 접속하기 전까지는 자리 비움 (poker.me 를 다시 구독하면 풀림, 오래 안 오면 평소처럼 내려옴)
          const status = x.status === "in" ? "wait" : x.status;
          const brain = x.brain ? { ...x.brain, rand: Math.random, grudge: new Map(x.brain.grudge) } : null;
          return { ...x, brain, kickVotes: new Map(x.kickVotes), status, ...(x.uid ? { away: true, awayAt: now() } : {}) };
        });
        // 이미 다른 테이블에 앉은 것으로 잡힌 사람은 빼고 (한 사람 한 테이블)
        for (const x of seats) if (x?.uid && seatOf.has(x.uid)) seats[x.seat] = null;
        const t: Table = {
          id: r.id,
          name: r.name,
          game: r.game,
          def: GAME_DEFS[r.game],
          tier: tierOf(r.tier),
          locked: r.locked,
          pw: r.pw,
          ownerUid: r.ownerUid,
          access: new Set(r.access),
          createdAt: r.createdAt,
          seats,
          bots: r.bots,
          quick: r.quick,
          botTarget: r.botTarget,
          botNext: r.botNext ? now() + 5_000 : 0,
          peopleSince: r.peopleSince ? r.peopleSince + downMs : 0,
          joining: 0,
          handNo: r.handNo,
          round: null,
          inRound: new Map(),
          mem: r.button === undefined ? {} : { button: r.button },
          lastView: null,
          deadline: 0,
          nextAt: null,
          timer: null,
          actTimers: new Map(),
          waitMark: "",
          seq: 0,
          ev: [],
          chat: r.chat,
          settling: Promise.resolve(),
          starting: false,
          closed: false,
          emptySince: r.emptySince,
          banned: new Map(r.banned),
          botRoomUntil: r.botRoomUntil,
        };
        tables.set(t.id, t);
        for (const x of humans(t)) seatOf.set(x.uid!, t.id);
        // 사람들이 다시 접속할 시간을 줌 (모두 돌아오면 바로 시작)
        holdUntil.set(t.id, now() + 15_000);
      }
      lobbyChanged();
    },
  };

  return {
    wallet,
    live,
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
    /** (관리자) 포커 설정 */
    adminSettings: () => ({ botBoost }),
    async adminSetSettings(p: { botBoost?: boolean }) {
      if (typeof p.botBoost === "boolean") {
        botBoost = p.botBoost;
        await settingsCol.updateOne({ _id: "poker" }, { $set: { botBoost } }, { upsert: true });
        // 켜고 끈 것이 바로 반영되게 봇 수를 다시 뽑음
        for (const t of tables.values()) if (t.bots) rollBotTarget(t);
      }
      return { botBoost };
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
