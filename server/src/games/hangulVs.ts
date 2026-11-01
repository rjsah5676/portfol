import { z } from "zod";
import { hangulLen, isLine } from "../../../web/src/lib/hangul/judge";
import { linkMorphs } from "../../../web/src/lib/hangul/link";
import {
  blobsOf,
  COUNTER_K,
  counterTarget,
  EMOTES,
  flightMs,
  SENTENCE_GAP,
  timeWinner,
  VS_COUNTDOWN,
  VS_SEC,
  type VsAttack,
  type VsMode,
  type VsMsg,
  type VsPlayer,
  type VsRoom,
} from "../../../web/src/lib/hangul/versus";
import type { Deps } from "../deps";
import { AppError, bad, forbidden } from "../errors";
import { newId, orderedId } from "../ids";
import { judge, JudgeOffError } from "../hangul/kiwi";

/*
 * 니들이 한글을 알아? — 대전 모드 「말싸움」 (1:1, 방은 서버 메모리)
 * 규칙은 web/src/lib/hangul/versus.ts. 판정 · 공격력 · 받아치기는 전부 여기서 정함 (클라는 보여 주기만).
 *
 * 구독  hgvs.room { id }   → VsRoom (바뀔 때마다 "room", 이모트는 "emote")
 * 요청  hgvs.create { name }            → 방 id (만든 사람이 첫 자리)
 *       hgvs.join { id, name }          두 번째 자리 (끊겼다 돌아온 사람은 자기 자리)
 *       hgvs.bot { id, level }          방장: 빈 자리에 훈장님 AI (1~3)
 *       hgvs.start { id }               방장: 둘 다 있으면 시작 (3초 카운트다운 뒤 3분)
 *       hgvs.sentence { id, text, mode } 문장 → 막기(guard) / 보내기(send). 받아치기는 서버가 알아서
 *       hgvs.load { id, load }          내 판 먹물 양 (1초쯤마다) — 100 이면 KO
 *       hgvs.vote { id, msg }           판 끝: 상대 문장 중 「오늘의 한 마디」
 *       hgvs.emote { id, e }            이모트 (채팅 없음)
 *       hgvs.again { id }               방장: 같은 사람끼리 한 판 더 (대기실로)
 *       hgvs.leave { id }
 */

interface Room extends VsRoom {
  /** uid → 자리를 잡은 소켓 id (그 소켓이 끊기면 자리 비움 표시) */
  owners: Map<string, string>;
  lastSentence: Map<string, number>;
  lastEmote: Map<string, number>;
  timers: NodeJS.Timeout[];
  touchedAt: number;
}

const MAX_ROOMS = 300;
const LOG_MAX = 200;
/** 판 중에 나간 사람을 기다리는 시간 — 지나면 진 걸로 */
const LEFT_GRACE = 20_000;
/** 끝난 방 · 아무도 없는 대기방 정리 */
const IDLE_TTL = 10 * 60_000;
/** 같은 문장 재탕은 힘 ×0.3 */
const RERUN_K = 0.3;

const BOT_NAME = ["", "훈장님 (쉬움)", "훈장님 (보통)", "훈장님 (어려움)"];
const BOT_UID = (level: number) => `bot:hunjang:${level}`;
/**
 * 훈장님이 문장을 내는 간격(ms) · 힘 배수 · 받아치기를 노리는 확률 · 먹물을 줄이는 속도(초당).
 * 사람은 문장 하나에 20~30초쯤 걸리고 훈장님 대사는 길고 매끈해서(명문 500~900점) 힘을 깎아 맞춤
 */
const BOT = [
  null,
  { every: 18_000, k: 0.25, counter: 0.25, clean: 0.35 },
  { every: 13_000, k: 0.35, counter: 0.5, clean: 0.5 },
  { every: 9_000, k: 0.45, counter: 0.8, clean: 0.7 },
] as const;
/** 훈장님 대사 (판정기로 읽어서 문장인 것만 씀) */
const BOT_LINES = [
  "숙제는 하고 노는 것이냐.",
  "먹물이나 먹거라.",
  "네 글씨가 개발새발이구나.",
  "회초리 맛 좀 볼 테냐.",
  "공부 좀 해라.",
  "어디서 말대꾸냐.",
  "네 이놈 거기 서라.",
  "한글도 모르는 놈.",
  "받침이나 제대로 써라.",
  "맞춤법이 엉망이구나.",
  "글은 엉덩이로 쓰는 것이다.",
  "오늘 저녁은 굶어라.",
  "서당 개도 너보다 낫다.",
  "어허 고얀 놈.",
  "벼루나 닦아라.",
  "너는 낙제다.",
  "천자문부터 다시 외워라.",
  "붓을 거꾸로 들었구나.",
  "졸지 말고 써라.",
  "훈장님 말씀 잘 들어라.",
];
const hasBatchim = (w: string) => {
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 !== 0;
};
/** 받아치기용 틀 — 상대 문장의 뜻 있는 말(명사)을 그대로 다시 씀 */
const BOT_COUNTERS = [
  (n: string) => `${n}${hasBatchim(n) ? "은" : "는"} 너나 해라.`,
  (n: string) => `${n} 좋아하네.`,
  (n: string) => `네가 ${n}${hasBatchim(n) ? "이" : ""}다.`,
  (n: string) => `${n}${hasBatchim(n) ? "이" : "가"} 뭐 어쨌다는 것이냐.`,
  (n: string) => `${n}${hasBatchim(n) ? "은" : "는"} 네 얘기구나.`,
];

const idOnly = z.object({ id: z.string().min(1).max(40) });
const nameSchema = z.string().max(10);

const judgeOff = (e: unknown) => {
  if (e instanceof JudgeOffError) throw new AppError("JUDGE_OFF", "판정 서버가 아직 준비되지 않았어요.", 503);
  throw e;
};

export function registerHangulVs({ gateway }: Deps) {
  const rooms = new Map<string, Room>();
  const roomKey = (id: string) => `hgvs:room:${id}`;

  const wire = (r: Room): VsRoom => ({
    id: r.id,
    host: r.host,
    phase: r.phase,
    seed: r.seed,
    startAt: r.startAt,
    endAt: r.endAt,
    players: r.players,
    attacks: r.attacks.filter((a) => a.status === "flying" || Date.now() - a.arriveAt < 15_000),
    log: r.log,
    winner: r.winner,
    reason: r.reason,
  });
  const changed = (r: Room) => {
    r.touchedAt = Date.now();
    gateway.emit(roomKey(r.id), "room", wire(r));
  };
  const getRoom = (id: string) => {
    const r = rooms.get(id);
    if (!r) throw new AppError("NO_ROOM", "방이 없어요. 끝났거나 주소가 틀렸어요.", 404);
    return r;
  };
  const seatOf = (r: Room, uid: string) => r.players.find((p) => p.uid === uid);
  const otherOf = (r: Room, uid: string) => r.players.find((p) => p.uid !== uid);
  const clearTimers = (r: Room) => {
    for (const t of r.timers) clearTimeout(t);
    r.timers = [];
  };
  const later = (r: Room, ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      r.timers = r.timers.filter((x) => x !== t);
      if (rooms.get(r.id) === r) fn();
    }, ms);
    t.unref?.();
    r.timers.push(t);
  };
  const removeRoom = (r: Room) => {
    clearTimers(r);
    rooms.delete(r.id);
    gateway.emit(roomKey(r.id), "room", null);
  };

  // 오래된 방 정리
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const r of rooms.values()) {
      const idle = now - r.touchedAt > IDLE_TTL;
      const empty = !r.players.some((p) => p.here && !p.bot);
      if ((r.phase !== "play" && idle) || (empty && now - r.touchedAt > 3 * 60_000)) removeRoom(r);
    }
  }, 60_000);
  sweep.unref?.();

  // ───────── 판 끝 ─────────
  function end(r: Room, winner: string | null, reason: VsRoom["reason"]) {
    if (r.phase !== "play") return;
    clearTimers(r);
    r.phase = "ended";
    r.winner = winner;
    r.reason = reason;
    for (const a of r.attacks) if (a.status === "flying") a.status = "offset";
    changed(r);
  }

  // ───────── 공격 도착 (훈장님 판에만 서버가 직접 반영 — 사람 판은 각자 브라우저가 도착 시각에 먹물을 넣음) ─────────
  function scheduleLanding(r: Room, a: VsAttack) {
    later(r, Math.max(0, a.arriveAt - Date.now()) + 50, () => {
      if (a.status !== "flying") return;
      a.status = "landed";
      const target = seatOf(r, a.to);
      if (target?.bot) {
        target.load = Math.min(100, target.load + a.blobs + (a.heavy ? 2 : 0));
        if (target.load >= 100) return end(r, a.from, "ko");
      }
      changed(r);
    });
  }

  function pushLog(r: Room, m: Omit<VsMsg, "id" | "at" | "votes">): VsMsg {
    const msg: VsMsg = { ...m, id: orderedId(), at: Date.now(), votes: [] };
    r.log.push(msg);
    if (r.log.length > LOG_MAX) r.log.splice(0, r.log.length - LOG_MAX);
    return msg;
  }

  /** 문장 하나 처리 (사람 · 훈장님 공통). 판정은 이미 끝난 것 */
  function play(
    r: Room,
    uid: string,
    j: { text: string; spaced: string; grade: string; morphs: VsAttack["morphs"]; points: number },
    mode: VsMode
  ): VsMsg {
    const now = Date.now();
    const me = seatOf(r, uid)!;
    const opp = otherOf(r, uid)!;
    const rerun = r.log.some((m) => m.uid === uid && m.text === j.text);
    const power = Math.round(j.points * (rerun ? RERUN_K : 1));
    me.points += power;
    const target = counterTarget(r, uid, j.morphs, now, linkMorphs);

    if (mode === "send") {
      let p = power;
      let rally = 0;
      if (target) {
        target.status = "reflected";
        p = Math.round((target.power + power) * COUNTER_K);
        rally = target.rally + 1;
      }
      const a: VsAttack = {
        id: orderedId(),
        from: uid,
        to: opp.uid,
        text: j.text,
        spaced: j.spaced,
        grade: j.grade,
        morphs: j.morphs,
        power: p,
        blobs: blobsOf(p),
        heavy: j.grade === "명문" || rally >= 2,
        at: now,
        arriveAt: now + flightMs(j.text, j.grade),
        rally,
        status: "flying",
      };
      r.attacks.push(a);
      if (r.attacks.length > 120) r.attacks.splice(0, r.attacks.length - 120);
      scheduleLanding(r, a);
      return pushLog(r, {
        uid,
        text: j.text,
        spaced: j.spaced,
        grade: j.grade,
        points: power,
        kind: target ? "counter" : "send",
        re: target?.id,
        attack: a.id,
      });
    }

    // 막기: 받아칠 수 있으면 완벽 방어, 아니면 문장 힘만큼 먼저 오는 공격부터 상쇄
    if (target) target.status = "blocked";
    else {
      let left = blobsOf(power);
      const incoming = r.attacks
        .filter((a) => a.to === uid && a.status === "flying" && a.arriveAt > now)
        .sort((a, b) => a.arriveAt - b.arriveAt);
      for (const a of incoming) {
        if (left <= 0) break;
        const take = Math.min(left, a.blobs);
        a.blobs -= take;
        left -= take;
        if (a.blobs <= 0) a.status = "offset";
      }
    }
    if (me.bot) me.load = Math.max(0, me.load - blobsOf(power) * 1.5);
    return pushLog(r, {
      uid,
      text: j.text,
      spaced: j.spaced,
      grade: j.grade,
      points: power,
      kind: target ? "block" : "guard",
      re: target?.id,
    });
  }

  // ───────── 훈장님 AI ─────────
  const botCache = new Map<string, Awaited<ReturnType<typeof judge>> | null>();
  async function botJudge(text: string) {
    const core = text.replace(/[^가-힣,.?!]/g, "");
    if (botCache.has(core)) return botCache.get(core)!;
    const j = await judge(core).catch(() => null);
    const ok = j && j.sentence ? j : null;
    botCache.set(core, ok);
    return ok;
  }
  const gradeOfJ = (j: { rude?: boolean; nat: number }) =>
    j.rude ? "막말" : j.nat >= -5.2 ? "명문" : j.nat >= -6.6 ? "말 됨" : "억지";

  function botLoop(r: Room, bot: VsPlayer) {
    const cfg = BOT[bot.bot ?? 2]!;
    // 먹물 흉내: 초마다 조금씩 정리
    const tick = () => {
      if (r.phase !== "play") return;
      if (Date.now() >= r.startAt) {
        bot.load = Math.max(0, bot.load - cfg.clean + 0.25);
      }
      later(r, 1_000, tick);
    };
    later(r, VS_COUNTDOWN + 1_000, tick);

    const speak = async () => {
      if (r.phase !== "play") return;
      const now = Date.now();
      const opp = otherOf(r, bot.uid)!;
      const incoming = r.attacks
        .filter((a) => a.to === bot.uid && a.status === "flying" && a.arriveAt > now + 800)
        .sort((a, b) => a.arriveAt - b.arriveAt);
      let text: string | null = null;
      // 받아치기: 날아오는 문장의 명사를 다시 써서
      if (incoming.length && Math.random() < cfg.counter) {
        const nouns = incoming[0].morphs.filter((m) => m.k && /^NN[GP]/.test(m.t) && hangulLen(m.f) >= 1).map((m) => m.f);
        for (const n of nouns.sort(() => Math.random() - 0.5)) {
          for (const tpl of [...BOT_COUNTERS].sort(() => Math.random() - 0.5)) {
            const t = tpl(n);
            const j = await botJudge(t);
            if (j && linkMorphs(incoming[0].morphs, j.morphs).level > 0) {
              text = t;
              break;
            }
          }
          if (text) break;
        }
      }
      // 평소 대사: 이번 판에 안 한 말부터 (재탕은 힘이 깎임)
      const said = new Set(r.log.filter((m) => m.uid === bot.uid).map((m) => m.text));
      const fresh = BOT_LINES.filter((t) => !said.has(t.replace(/[^가-힣,.?!]/g, "")));
      const pool = fresh.length ? fresh : BOT_LINES;
      for (let k = 0; !text && k < 6; k++) {
        const t = pool[Math.floor(Math.random() * pool.length)];
        if (await botJudge(t)) text = t;
      }
      if (text && r.phase === "play") {
        const j = (await botJudge(text))!;
        const mode: VsMode = bot.load > 45 && !incoming.length ? "guard" : incoming.length && Math.random() < 0.35 ? "guard" : "send";
        play(
          r,
          bot.uid,
          { text: j.text, spaced: j.spaced, grade: gradeOfJ(j), morphs: j.morphs, points: Math.round(j.points * cfg.k) },
          mode
        );
        changed(r);
      }
      if (opp && r.phase === "play") later(r, cfg.every * (0.7 + Math.random() * 0.6), () => void speak().catch(() => {}));
    };
    later(r, VS_COUNTDOWN + cfg.every * 0.6, () => void speak().catch(() => {}));
  }

  // ───────── 구독 ─────────
  gateway.channel("hgvs.room", {
    key(ctx, p) {
      void ctx.uid;
      return roomKey(idOnly.parse(p).id);
    },
    snapshot(ctx, _key, p) {
      const r = rooms.get(idOnly.parse(p).id);
      if (!r) return null;
      const me = ctx.user ? seatOf(r, ctx.user.uid) : undefined;
      if (me && !me.bot && !me.here) {
        me.here = true;
        r.owners.set(me.uid, ctx.socket.id);
        changed(r);
      }
      return wire(r);
    },
  });

  // ───────── 요청 ─────────
  gateway.rpc("hgvs.create", (ctx, raw) => {
    const { name } = z.object({ name: nameSchema }).parse(raw);
    const uid = ctx.uid;
    if (rooms.size >= MAX_ROOMS) throw bad("방이 너무 많아요. 잠시 후 다시 해 주세요.");
    const now = Date.now();
    const r: Room = {
      id: newId(16),
      host: uid,
      phase: "waiting",
      seed: 0,
      startAt: 0,
      endAt: 0,
      players: [{ uid, name: ctx.name(name || "이름없음"), load: 0, points: 0, here: true }],
      attacks: [],
      log: [],
      winner: null,
      reason: "",
      owners: new Map([[uid, ctx.socket.id]]),
      lastSentence: new Map(),
      lastEmote: new Map(),
      timers: [],
      touchedAt: now,
    };
    rooms.set(r.id, r);
    return r.id;
  });

  gateway.rpc("hgvs.join", (ctx, raw) => {
    const { id, name } = idOnly.extend({ name: nameSchema }).parse(raw);
    const uid = ctx.uid;
    const r = getRoom(id);
    const seat = seatOf(r, uid);
    if (seat) {
      seat.here = true;
      r.owners.set(uid, ctx.socket.id);
    } else {
      if (r.phase !== "waiting") throw new AppError("ROOM_BUSY", "이미 시작한 판이에요.", 409);
      // 훈장님이 앉아 있으면 초대받은 사람에게 자리를 비켜 줌
      if (r.players.length >= 2) r.players = r.players.filter((p) => !p.bot);
      if (r.players.length >= 2) throw new AppError("ROOM_FULL", "자리가 다 찼어요.", 409);
      r.players.push({ uid, name: ctx.name(name || "이름없음"), load: 0, points: 0, here: true });
      r.owners.set(uid, ctx.socket.id);
    }
    changed(r);
    return null;
  });

  gateway.rpc("hgvs.bot", (ctx, raw) => {
    const { id, level } = idOnly.extend({ level: z.number().int().min(1).max(3) }).parse(raw);
    const r = getRoom(id);
    if (r.host !== ctx.uid) throw forbidden("방장만 할 수 있어요.");
    if (r.phase !== "waiting") throw bad("대기 중일 때만 돼요.");
    // 이미 있는 훈장님은 난이도만 바꿈, 사람이 앉아 있으면 안 됨
    const other = otherOf(r, ctx.uid);
    if (other && !other.bot) throw bad("이미 상대가 있어요.");
    r.players = r.players.filter((p) => !p.bot);
    r.players.push({ uid: BOT_UID(level), name: BOT_NAME[level], bot: level, load: 0, points: 0, here: true });
    changed(r);
    return null;
  });

  gateway.rpc("hgvs.start", (ctx, raw) => {
    const r = getRoom(idOnly.parse(raw).id);
    if (r.host !== ctx.uid) throw forbidden("방장만 시작할 수 있어요.");
    if (r.phase !== "waiting") throw bad("이미 시작했어요.");
    if (r.players.length < 2) throw bad("상대가 아직 없어요.");
    if (r.players.some((p) => !p.here)) throw bad("상대가 아직 들어오지 않았어요.");
    const now = Date.now();
    r.phase = "play";
    r.seed = Math.floor(Math.random() * 2 ** 31);
    r.startAt = now + VS_COUNTDOWN;
    r.endAt = r.startAt + VS_SEC * 1000;
    r.attacks = [];
    r.log = [];
    r.winner = null;
    r.reason = "";
    for (const p of r.players) ((p.load = 0), (p.points = 0));
    r.lastSentence.clear();
    later(r, r.endAt - now, () => end(r, timeWinner(r.players), "time"));
    for (const p of r.players) if (p.bot) botLoop(r, p);
    changed(r);
    return null;
  });

  const sentenceSchema = idOnly.extend({ text: z.string().min(1).max(60), mode: z.enum(["guard", "send"]) });
  gateway.rpc("hgvs.sentence", async (ctx, raw) => {
    const { id, text, mode } = sentenceSchema.parse(raw);
    const uid = ctx.uid;
    const r = getRoom(id);
    const me = seatOf(r, uid);
    if (!me || me.bot) throw forbidden();
    const now = Date.now();
    if (r.phase !== "play" || now < r.startAt) throw bad("판이 진행 중이 아니에요.");
    if (now - (r.lastSentence.get(uid) ?? 0) < SENTENCE_GAP) throw new AppError("RATE_LIMITED", "조금 천천히!", 429);
    if (!isLine(text)) throw bad();
    const j = await judge(text).catch(judgeOff);
    if (!j.sentence) throw bad("문장이 아니에요.");
    if (r.phase !== "play") throw bad("판이 끝났어요.");
    // 간격은 받아들인 문장만 셈 (판정 중에 같은 사람이 또 보낸 건 여기서 걸림)
    if (Date.now() - (r.lastSentence.get(uid) ?? 0) < SENTENCE_GAP) throw new AppError("RATE_LIMITED", "조금 천천히!", 429);
    r.lastSentence.set(uid, Date.now());
    const grade = j.rude ? "막말" : j.nat >= -5.2 ? "명문" : j.nat >= -6.6 ? "말 됨" : "억지";
    const msg = play(r, uid, { text, spaced: j.spaced, grade, morphs: j.morphs, points: j.points }, mode);
    changed(r);
    return msg;
  });

  gateway.rpc("hgvs.load", (ctx, raw) => {
    const { id, load } = idOnly.extend({ load: z.number().finite().min(0).max(1000) }).parse(raw);
    const r = rooms.get(id);
    const me = r && seatOf(r, ctx.uid);
    if (!r || !me || me.bot || r.phase !== "play") return null;
    const v = Math.round(load);
    if (v === me.load) return null;
    me.load = Math.min(100, v);
    if (me.load >= 100) end(r, otherOf(r, ctx.uid)?.uid ?? null, "ko");
    else changed(r);
    return null;
  });

  gateway.rpc("hgvs.vote", (ctx, raw) => {
    const { id, msg } = idOnly.extend({ msg: z.string().min(1).max(40) }).parse(raw);
    const r = getRoom(id);
    const uid = ctx.uid;
    if (r.phase !== "ended") throw bad("판이 끝난 뒤에 고를 수 있어요.");
    if (!seatOf(r, uid)) throw forbidden();
    const m = r.log.find((x) => x.id === msg);
    if (!m) throw bad();
    if (m.uid === uid) throw bad("내 문장에는 못 줘요.");
    for (const x of r.log) x.votes = x.votes.filter((v) => v !== uid);
    m.votes.push(uid);
    changed(r);
    return null;
  });

  gateway.rpc("hgvs.emote", (ctx, raw) => {
    const { id, e } = idOnly.extend({ e: z.enum(EMOTES) }).parse(raw);
    const r = getRoom(id);
    const uid = ctx.uid;
    if (!seatOf(r, uid)) throw forbidden();
    const now = Date.now();
    if (now - (r.lastEmote.get(uid) ?? 0) < 1_500) return null;
    r.lastEmote.set(uid, now);
    gateway.emit(roomKey(id), "emote", { uid, e });
    return null;
  });

  gateway.rpc("hgvs.again", (ctx, raw) => {
    const r = getRoom(idOnly.parse(raw).id);
    if (r.host !== ctx.uid) throw forbidden("방장만 할 수 있어요.");
    if (r.phase !== "ended") throw bad();
    clearTimers(r);
    r.phase = "waiting";
    r.attacks = [];
    r.winner = null;
    r.reason = "";
    for (const p of r.players) ((p.load = 0), (p.points = 0));
    changed(r);
    return null;
  });

  function leave(r: Room, uid: string) {
    const me = seatOf(r, uid);
    if (!me) return;
    me.here = false;
    r.owners.delete(uid);
    if (r.phase === "waiting") {
      r.players = r.players.filter((p) => p.uid !== uid);
      // 방장이 나가면 남은 사람이 방장, 사람이 없으면 정리
      const human = r.players.find((p) => !p.bot);
      if (!human) return removeRoom(r);
      if (r.host === uid) r.host = human.uid;
    } else if (r.phase === "play") {
      const opp = otherOf(r, uid);
      if (opp?.bot) end(r, opp.uid, "left");
      else
        later(r, LEFT_GRACE, () => {
          if (r.phase === "play" && !me.here) end(r, opp?.uid ?? null, "left");
        });
    }
    changed(r);
  }

  gateway.rpc("hgvs.leave", (ctx, raw) => {
    const r = rooms.get(idOnly.parse(raw).id);
    if (r) leave(r, ctx.uid);
    return null;
  });

  gateway.onDisconnect((ctx) => {
    const uid = ctx.user?.uid;
    if (!uid) return;
    for (const r of rooms.values()) if (r.owners.get(uid) === ctx.socket.id) leave(r, uid);
  });

  return {
    stats: () => ({
      rooms: rooms.size,
      playing: [...rooms.values()].filter((r) => r.phase === "play").length,
    }),
    /** 테스트용 */
    _rooms: rooms,
  };
}
