"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { serverNow } from "@/lib/api/socket";
import { CHAR, ITEM, SKILL_TARGET, SKILL_TIME, artOf, faceOf, power } from "@/lib/marble/data";
import {
  CARDS,
  EVENTS,
  HANDS,
  RULE,
  bestMove,
  cardBlock,
  handOf,
  moveSums,
  pathOf,
  pickFor,
  skillBlock,
  standings,
  starPrice,
  type Action,
  type CardId,
  type Ev,
  type Game,
  type HandId,
  type Prompt,
} from "@/lib/marble/engine";
import { MAPS } from "@/lib/marble/maps";
import type { GameWire, RoomWire } from "@/lib/marble/wire";
import { marble } from "@/realtime/marble";
import { playBgm, sfx, stopBgm } from "./audio";
import { ItemIcon } from "./Gacha";
import { CharHero, XGrade } from "./ui";
import Board, { Glyph, KIND, type GlyphName, type Trail, slotXY as slotPos, spriteOf, type TokenView } from "./Board";
import { Btn, Cur, GradeTag, Icon, PCOLOR, fmt } from "./pixel";
import { GuideDot, useMapGuide } from "./MapGuide";
import { RoomTools } from "./Room";
import { type TokenAnim } from "./Token";

/*
 * 판 화면 (v2 야추 × 보드) — 서버가 보낸 방 상태(RoomWire)의 ev 를 하나씩 연출하고
 * (주사위 · 족보 · 이동 · 코인 · 별 · 아이템 · 스킬 · 대결 · 소식), 연출이 다 끝나면 지금 상태로 맞춘 뒤
 * 내 차례면 판 가운데 주사위 접시에서 고르게 함.
 * 연출 길이는 서버 animMs(server/src/games/marble) 와 같게 — 서버는 그만큼 기다렸다가 AI 를 두게 하고 사람 시간을 셈.
 */

interface Floater {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  big?: boolean;
}
interface Banner {
  id: number;
  title: string;
  sub?: string;
  color: string;
  art?: string;
  ms: number;
  /** 스킬 컷인이면 등급 (높을수록 화려) */
  grade?: "R" | "SR" | "SSR" | "UR";
  /** 스킬 효과 한 줄 · 대상 */
  desc?: string;
  target?: string;
}
/** 한 번 터지고 사라지는 이펙트 (무대 좌표) */
interface Fx {
  id: number;
  k: "boom" | "ring" | "coin" | "zzz" | "star";
  x: number;
  y: number;
  dx?: number;
  dy?: number;
  delay?: number;
}
/** 판 가운데 주사위 접시 (그 차례 사람의 주사위) */
interface TrayView {
  p: number;
  dice: number[];
  held: boolean[];
  /** 주사위마다 굴린 번호 (바뀌면 다시 굴러 떨어짐) */
  ids: number[];
}
type Pop =
  | { k: "hand"; id: number; p: number; hand: HandId; x2?: boolean }
  | { k: "card"; id: number; p: number; card: CardId }
  | { k: "event"; id: number; p: number; ev: keyof typeof EVENTS; alt?: keyof typeof EVENTS }
  | { k: "vs"; id: number; e: Extract<Ev, { t: "vs" }> };

let fid = 0;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 프롬프트별 제한 시간 (서버 LIMIT 과 같게 — 시간 막대 비율만) */
const LIMIT: Record<string, number> = { turn: 15_000, dice: 25_000, foe: 9_000, warp: 10_000, more: 8_000 };
const TRAY = { x: 512, y: 290 };

function trayOf(g: GameWire): TrayView {
  const t = g.turn;
  const p = g.prompt?.p ?? g.cur;
  if (!t || !t.rolled) return { p, dice: [], held: [], ids: [] };
  return { p, dice: [...t.dice], held: [...t.held], ids: t.dice.map(() => 0) };
}

/** 이동 고르기 후보 */
interface MoveOpt {
  steps: number;
  pick?: number[];
  n?: number;
  jump?: boolean;
  path: number[];
  dest: number;
  /** 지나가며 별을 살 수 있음 */
  star: boolean;
}
function moveOptions(g: Game, pi: number, slide: number): MoveOpt[] {
  const t = g.turn;
  if (!t || !t.rolled || t.dice.some((d) => d < 1)) return [];
  const p = g.players[pi];
  const h = handOf(t.dice);
  const coins = p.coins + HANDS[h].coins * (t.dbl ? 2 : 1);
  const price = starPrice(g, pi);
  if (h === "large") {
    return [{ steps: (g.star - p.pos + 32) % 32, jump: true, path: [g.star], dest: g.star, star: coins >= price }];
  }
  const k = t.tri ? 3 : 2;
  const sums = h === "small" ? Array.from({ length: 12 }, (_, i) => i + 1) : moveSums(t.dice, k);
  return sums.map((s) => {
    const steps = Math.max(1, s + t.boost + slide);
    const path = pathOf(g, p.pos, steps);
    const passStart = path.some((x) => x === 0);
    return {
      steps,
      ...(h === "small" ? { n: s } : { pick: pickFor(t.dice, k, s)! }),
      path,
      dest: path[path.length - 1],
      star: path.includes(g.star) && coins + (passStart ? RULE.start : 0) >= price,
    };
  });
}

export default function GameView({ room, me, onLeave }: { room: RoomWire; me: string; onLeave(): void }) {
  const g0 = room.game!;
  const map = MAPS[g0.map];
  /* ── 화면에 보이는 상태 (연출 동안 엔진보다 늦게 따라감) ── */
  const [view, setView] = useState<GameWire>(g0);
  const [pos, setPos] = useState<number[]>(() => g0.players.map((p) => p.pos));
  const [anim, setAnim] = useState<TokenAnim[]>(() => g0.players.map(() => "idle"));
  const [face, setFace] = useState<(1 | -1)[]>(() => g0.players.map(() => 1));
  const [hop, setHop] = useState<number[]>(() => g0.players.map(() => 0));
  const [coins, setCoins] = useState<number[]>(() => g0.players.map((p) => p.coins));
  const [stars, setStars] = useState<number[]>(() => g0.players.map((p) => p.stars));
  const [starAt, setStarAt] = useState(g0.star);
  const [tray, setTray] = useState<TrayView>(() => trayOf(g0));
  /** 내 차례: 잠근 주사위 (누르는 즉시 바뀌게 화면에서 들고 있음) */
  const [held, setHeld] = useState<boolean[]>(() => g0.turn?.held ?? []);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [fxs, setFxs] = useState<Fx[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const [yacht, setYacht] = useState<{ id: number; p: number; x2?: boolean } | null>(null);
  const [flyStar, setFlyStar] = useState<{ id: number; a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const [flash, setFlash] = useState<Record<number, string>>({});
  const [trail, setTrail] = useState<Trail | null>(null);
  const [nope, setNope] = useState<{ id: number; why: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState<number | null>(null);
  /** 받은 방 상태 (연출 대기열) */
  const queue = useRef<RoomWire[]>([]);
  const running = useRef(false);
  const lastSeq = useRef(room.seq);
  const [live, setLive] = useState<RoomWire>(room);

  const order = room.order;
  const myPi = useMemo(() => order.findIndex((si) => room.seats[si]?.uid === me), [order, room.seats, me]);
  // 사다리 뒤 막 시작한 판: 내 순번을 가운데에 잠깐
  const [intro, setIntro] = useState(() => (room.game?.steps ?? 1) === 0 && myPi >= 0);
  useEffect(() => {
    if (!intro) return;
    const id = setTimeout(() => setIntro(false), 1800);
    return () => clearTimeout(id);
  }, [intro]);

  /* ── 좌표 (무대 기준) ── */
  const slotXY = (slot: number) => {
    const c = slotPos(map, slot);
    return { x: c.x, y: c.y - 30 };
  };
  const n = view.players.length;
  /** 화면 자리: 나는 늘 왼쪽 아래, 1:1 상대는 오른쪽 위 */
  const viewIdx = (pi: number) => (myPi >= 0 ? (pi - myPi + n) % n : pi);
  const cardXY = (pi: number) => {
    const c = cornerRect(viewIdx(pi), n);
    return { x: c.x + 150, y: c.y + 40 };
  };
  const float = (x: number, y: number, text: string, color = "#232a4d", big = false) => {
    // 화면 가장자리에서 글자가 잘리지 않게 (글자 폭 어림)
    const half = Math.min(300, text.length * (big ? 12 : 9) + 10);
    const f = { id: ++fid, x: Math.max(half, Math.min(1024 - half, x)), y: Math.max(20, y), text, color, big };
    setFloaters((a) => [...a.slice(-14), f]);
    setTimeout(() => setFloaters((a) => a.filter((o) => o.id !== f.id)), 1300);
  };
  const spawn = (k: Fx["k"], x: number, y: number, extra: Partial<Fx> = {}, ms = 1300) => {
    const f: Fx = { id: ++fid, k, x, y, ...extra };
    setFxs((a) => [...a.slice(-24), f]);
    setTimeout(() => setFxs((a) => a.filter((o) => o.id !== f.id)), ms + (extra.delay ?? 0));
  };
  /** 한 곳 → 카드로 금화 몇 개 */
  const coinsFly = (a: { x: number; y: number }, b: { x: number; y: number }, k = 4) => {
    for (let j = 0; j < k; j++) spawn("coin", a.x - 12 + j * 8, a.y, { dx: b.x - a.x + 12 - j * 8, dy: b.y - a.y, delay: j * 70 }, 900);
  };
  const flashTile = (slot: number, c: string) => {
    setFlash((f) => ({ ...f, [slot]: c }));
    setTimeout(() => setFlash((f) => Object.fromEntries(Object.entries(f).filter(([k]) => Number(k) !== slot))), 900);
  };

  const posRef = useRef(pos);
  useEffect(() => {
    posRef.current = pos;
  }, [pos]);
  const setPosOf = (pi: number, s: number) => {
    posRef.current = posRef.current.map((x, i) => (i === pi ? s : x));
    setPos(posRef.current);
  };
  const patchPlayer = (pi: number, patch: Partial<GameWire["players"][number]>) =>
    setView((v) => ({ ...v, players: v.players.map((p, i) => (i === pi ? { ...p, ...patch } : p)) }));
  const addCoins = (pi: number, d: number) => setCoins((c) => c.map((x, i) => (i === pi ? Math.max(0, x + d) : x)));
  const setAnimOf = (pi: number, a: TokenAnim) => setAnim((x) => x.map((v, i) => (i === pi ? a : v)));
  const starXY = (slot: number) => {
    const c = slotPos(map, slot);
    return { x: c.x, y: c.y - 70 };
  };

  /* ── 연출 하나 ── */
  const COIN_LABEL: Record<string, string> = {
    start: "출발",
    blue: "",
    red: "",
    empty: "별 자리",
    hand: "족보",
    card: "아이템",
    steal: "뺏기",
    thief: "코인 도둑",
    vs: "대결",
    fest: "축제",
    jackpot: "잭팟!",
    event: "소식",
    trap: "함정",
    circus: "관람료",
    pass: "배달비",
    shield: "방패",
    catchup: "막판 위로금",
  };
  const walkTo = async (pi: number, path: number[], color: string, speed = 200) => {
    const tid = ++fid;
    setTrail({ id: tid, slots: path, at: 0, color, n: path.length });
    setAnimOf(pi, "walk");
    await wait(220);
    for (const [k, s] of path.entries()) {
      const from = map.tiles[posRef.current[pi]];
      const to = map.tiles[s];
      const dx = to.x - from.x;
      if (dx) setFace((f) => f.map((x, i) => (i === pi ? (dx > 0 ? 1 : -1) : x)));
      setPosOf(pi, s);
      setTrail((t) => (t && t.id === tid ? { ...t, at: k + 1 } : t));
      setHop((h) => h.map((x, i) => (i === pi ? x + 1 : x)));
      sfx("step");
      await wait(speed);
    }
    setAnimOf(pi, "idle");
    setTimeout(() => setTrail((t) => (t && t.id === tid ? null : t)), 800);
  };

  const playEv = async (e: Ev, cur: GameWire) => {
    const P = (pi: number) => cur.players[pi]?.name ?? "?";
    switch (e.t) {
      case "turn":
        setTray({ p: e.p, dice: [], held: [], ids: [] });
        if (e.p === myPi && !e.again) float(TRAY.x, TRAY.y - 30, "내 차례!", PCOLOR[e.p], true);
        if (e.again) {
          setBanner({ id: ++fid, title: "앙코르!", sub: `${P(e.p)} · 한 번 더`, color: "#ff7fb0", ms: 1100 });
          sfx("skill");
          await wait(1100);
        } else {
          if (e.p === myPi) sfx("turn");
          await wait(350);
        }
        return;
      case "round":
        if (e.frenzy) {
          sfx("mono");
          setBanner({ id: ++fid, title: `막판 ${RULE.frenzyRounds}바퀴!`, sub: "파랑 · 빨강 칸 두 배 · 꼴찌에게 위로금", color: "#ff6a2b", ms: 2400 });
          setView((v) => ({ ...v, frenzy: true, round: e.round }));
          await wait(2400);
        } else if (e.round > 1) {
          setView((v) => ({ ...v, round: e.round }));
          setBanner({ id: ++fid, title: `${e.round} / ${cur.rounds} 바퀴`, color: "#5b6cff", ms: 900 });
          await wait(900);
        }
        return;
      case "frenzy":
        for (const i of e.last) {
          const c = cardXY(i);
          float(c.x, c.y - 20, "꼴찌 위로금!", "#ff6a2b");
        }
        await wait(1300);
        return;
      case "roll": {
        setTray((t) => {
          const ids = e.dice.map((_, i) => (e.held[i] ? (t.ids[i] ?? 0) : ++fid));
          return { p: e.p, dice: [...e.dice], held: [...e.held], ids };
        });
        if (e.p === myPi) setHeld([...e.held]);
        sfx("dice");
        await wait(e.re ? 820 : 1080);
        if (e.lucky !== undefined) float(TRAY.x, TRAY.y - 70, "짝이 맞춰졌어요!", "#b05cff");
        await wait(e.re ? 180 : 220);
        return;
      }
      case "hold":
        setTray((t) => ({ ...t, held: [...e.held] }));
        return;
      case "die": {
        setTray((t) => ({ ...t, dice: t.dice.map((v, i) => (i === e.i ? e.to : v)), ids: t.ids.map((v, i) => (i === e.i ? ++fid : v)) }));
        sfx("card");
        float(TRAY.x - 120 + e.i * 60, TRAY.y - 60, `${e.from} → ${e.to}`, "#ff7a2e");
        await wait(550);
        return;
      }
      case "hand": {
        if (e.hand === "yacht") {
          setYacht({ id: ++fid, p: e.p, x2: e.x2 });
          sfx("mono");
          await wait(2800);
          setYacht(null);
          return;
        }
        const ms = e.hand === "four" || e.hand === "large" ? 1500 : e.hand === "triple" || e.hand === "small" || e.hand === "full" ? 1100 : 250;
        if (ms >= 1100) {
          setPop({ k: "hand", id: ++fid, p: e.p, hand: e.hand, x2: e.x2 });
          sfx(ms >= 1100 ? "fest" : "coin");
        }
        await wait(ms);
        setPop((x) => (x?.k === "hand" ? null : x));
        return;
      }
      case "move": {
        if (e.why === "warp" || e.why === "jump" || e.why === "swap") {
          setAnimOf(e.p, "win");
          sfx("warp");
          const a = slotXY(posRef.current[e.p]);
          spawn("ring", a.x, a.y + 26);
          await wait(320);
          setPosOf(e.p, e.path[e.path.length - 1]);
          const b = slotXY(e.path[e.path.length - 1]);
          spawn("ring", b.x, b.y + 26);
          if (e.why === "jump") float(b.x, b.y - 50, "별로 순간이동!", "#ff9f1a");
          await wait(430);
          setAnimOf(e.p, "idle");
          return;
        }
        if (e.why === "pull") {
          // 끌려감: 경로 숫자 없이, 맞은 자세로 빠르게 미끄러짐
          const a0 = slotXY(posRef.current[e.p]);
          float(a0.x, a0.y - 44, "끌려가요!", "#e0558c");
          sfx("pull");
          setAnimOf(e.p, "hit");
          for (const s of e.path) {
            setPosOf(e.p, s);
            await wait(110);
          }
          setAnimOf(e.p, "idle");
          const b0 = slotXY(e.path[e.path.length - 1]);
          spawn("ring", b0.x, b0.y + 26);
          await wait(250);
          return;
        }
        if (e.why === "hop") {
          const q = slotXY(posRef.current[e.p]);
          float(q.x, q.y - 44, "폴짝!", "#2fa36a");
          sfx("hop");
        }
        if (e.why === "gust") {
          const q = slotXY(posRef.current[e.p]);
          float(q.x, q.y - 44, `돌풍! +${e.path.length}칸`, "#2fa3c4");
        }
        await walkTo(e.p, e.path, PCOLOR[e.p], 190);
        await wait(60);
        return;
      }
      case "coin": {
        addCoins(e.p, e.amt);
        if (e.pot !== undefined) setView((v) => ({ ...v, pot: e.pot! }));
        const c = cardXY(e.p);
        const label = COIN_LABEL[e.why] ?? "";
        float(c.x, c.y - 10, `${label ? `${label} ` : ""}${e.amt > 0 ? "+" : "−"}${Math.abs(e.amt)}`, e.amt > 0 ? "#2f8a3a" : "#d43a3a");
        const onTile = ["blue", "red", "empty", "fest", "jackpot", "trap", "event", "pass"].includes(e.why);
        if (onTile && e.from === undefined) {
          const q = slotXY(posRef.current[e.p]);
          flashTile(posRef.current[e.p], e.amt > 0 ? "#ffd23a" : "#ff5a6e");
          if (e.amt > 0) coinsFly(q, c, Math.min(6, 2 + Math.floor(e.amt / 3)));
          else coinsFly(c, q, 3);
          if (e.why === "jackpot") {
            setBanner({ id: ++fid, title: `잭팟! +${e.amt}`, sub: `${P(e.p)} · 쌓인 코인을 몽땅`, color: "#ffb21e", ms: 1400 });
            for (let k = 0; k < 8; k++) spawn("coin", q.x, q.y, { dx: c.x - q.x + (k - 4) * 6, dy: c.y - q.y, delay: k * 60 }, 900);
          }
        }
        if (e.from !== undefined && e.amt > 0) coinsFly(cardXY(e.from), c, 4);
        if (e.amt < 0) {
          setShake(e.p);
          setTimeout(() => setShake((s) => (s === e.p ? null : s)), 450);
        }
        sfx(e.amt > 0 ? (e.amt >= 6 ? "coins" : "coin") : "pay");
        await wait(e.why === "jackpot" ? 1400 : 260);
        return;
      }
      case "star": {
        const c = cardXY(e.p);
        if (e.why === "buy" || e.why === "vip") {
          addCoins(e.p, -e.price);
          const a = starXY(e.at);
          setStarAt(-1);
          setFlyStar({ id: ++fid, a, b: c });
          sfx("landmark");
          setBanner({ id: ++fid, title: "별 획득!", sub: `${P(e.p)} · ${e.price}코인${e.why === "vip" ? " · VIP 쇼핑" : ""}`, color: "#ffb21e", ms: 1700 });
          await wait(1100);
          setStars((s) => s.map((x, i) => (i === e.p ? x + 1 : x)));
          spawn("star", c.x - 60, c.y);
          await wait(800);
          setFlyStar(null);
          return;
        }
        if (e.why === "yacht") {
          setFlyStar({ id: ++fid, a: { x: TRAY.x, y: TRAY.y - 40 }, b: c });
          await wait(550);
          setStars((s) => s.map((x, i) => (i === e.p ? x + 1 : x)));
          spawn("star", c.x - 60, c.y);
          setFlyStar(null);
          return;
        }
        // 보너스 별
        setFlyStar({ id: ++fid, a: { x: 512, y: 240 }, b: c });
        sfx("coins");
        await wait(650);
        setStars((s) => s.map((x, i) => (i === e.p ? x + 1 : x)));
        spawn("star", c.x - 60, c.y);
        await wait(250);
        setFlyStar(null);
        return;
      }
      case "starMove": {
        const a = starXY(e.from);
        const b = starXY(e.to);
        setStarAt(-1);
        setFlyStar({ id: ++fid, a, b });
        sfx("warp");
        float(b.x, b.y - 30, "별이 이사 왔어요!", "#ff9f1a");
        await wait(1000);
        setFlyStar(null);
        setStarAt(e.to);
        setView((v) => ({ ...v, star: e.to }));
        await wait(100);
        return;
      }
      case "card": {
        if (e.use) {
          patchPlayer(e.p, { cards: removeOne(cur.players[e.p] ? viewCards(e.p) : [], e.id) });
          const c = cardXY(e.p);
          float(c.x, c.y - 30, `${CARDS[e.id].name}!`, "#7a4bd6");
          sfx("card");
          await wait(900);
          return;
        }
        patchPlayer(e.p, { cards: [...viewCards(e.p), e.id].slice(0, RULE.maxCards) });
        setPop({ k: "card", id: ++fid, p: e.p, card: e.id });
        sfx("card");
        await wait(850);
        setPop((x) => (x?.k === "card" ? null : x));
        return;
      }
      case "skill": {
        const pl = cur.players[e.p];
        const c = CHAR[pl.lo.char.id];
        sfx("skill");
        setBanner({
          id: ++fid,
          title: c?.active.name ?? "스킬",
          sub: `${P(e.p)} · ${c?.title ?? ""}`,
          color: c?.color ?? "#ffc94a",
          art: c ? artOf(c) : undefined,
          ms: 1500,
          grade: c?.grade,
          desc: c ? c.active.desc(power(c.grade, pl.lo.char.lv)) : undefined,
          target: e.target !== undefined ? `→ ${P(e.target)}` : undefined,
        });
        await wait(1300);
        if (e.kind === "shield") {
          patchPlayer(e.p, { shield: Math.max(1, pl.shield) });
          sfx("shield");
        }
        return;
      }
      case "vs":
        setPop({ k: "vs", id: ++fid, e });
        sfx("dice");
        await wait(1300);
        sfx(e.win >= 0 ? "acquire" : "deny");
        await wait(1400);
        setPop((x) => (x?.k === "vs" ? null : x));
        return;
      case "fest":
        sfx("fest");
        setBanner({ id: ++fid, title: `축제! 주사위 ${e.d}`, sub: `${P(e.p)} · 코인 +${e.amt}`, color: "#b07bff", ms: 1500 });
        await wait(1500);
        return;
      case "event":
        sfx("news");
        setPop({ k: "event", id: ++fid, p: e.p, ev: e.id, alt: e.alt });
        await wait(1800);
        setPop((x) => (x?.k === "event" ? null : x));
        return;
      case "trap": {
        setView((v) => ({ ...v, traps: v.traps.map((x, i) => (i === e.at ? e.p : x)) }));
        const q = slotXY(e.at);
        float(q.x, q.y - 40, "함정 설치!", "#5a6b7a");
        sfx("build");
        await wait(700);
        return;
      }
      case "debuff": {
        const q = slotXY(posRef.current[e.p]);
        // 걸림(다음 차례에) · 차례 시작에 효과가 나옴(이번 차례 — 머리 위 상태는 지움)
        const now = e.kind !== "trap" && e.by === undefined;
        if (e.kind === "seal") {
          patchPlayer(e.p, { seal: now ? 0 : 1 });
          float(q.x, q.y - 50, now ? "주사위 하나 압수당했어요!" : "주사위 하나 압수!", "#d8402f");
          sfx("boom");
        } else {
          patchPlayer(e.p, { sleep: !now });
          spawn("zzz", q.x + 10, q.y - 30);
          sfx(e.kind === "trap" ? "jail" : "sleep");
          float(q.x, q.y - 50, now ? "쿨쿨… 이번 차례 다시 굴리기 0번" : e.kind === "trap" ? "함정! 다음 차례 다시 굴리기 0번" : "쿨쿨… 다음 차례 다시 굴리기 0번", "#5b6bd6");
        }
        await wait(700);
        return;
      }
      case "block": {
        const q = slotXY(posRef.current[e.p]);
        spawn("ring", q.x, q.y + 26);
        sfx("shield");
        float(q.x, q.y - 50, e.why === "guard" ? "경비견이 막았어요!" : e.why === "immune" ? "면역!" : "방패로 막았어요!", "#2f5fc4");
        if (e.why === "shield") patchPlayer(e.p, { shield: Math.max(0, (cur.players[e.p]?.shield ?? 1) - 1) });
        await wait(700);
        return;
      }
      case "swap": {
        sfx("warp");
        const pa = posRef.current[e.a];
        const pb = posRef.current[e.b];
        setAnimOf(e.a, "win");
        setAnimOf(e.b, "win");
        await wait(300);
        setPosOf(e.a, pb);
        setPosOf(e.b, pa);
        float(slotXY(pb).x, slotXY(pb).y - 50, "자리 바꾸기!", "#6f7bff");
        await wait(400);
        setAnimOf(e.a, "idle");
        setAnimOf(e.b, "idle");
        return;
      }
      case "bonus": {
        const T: Record<string, [string, string]> = { coin: ["코인왕", "판 동안 코인을 가장 많이 번 사람"], hand: ["족보왕", "족보 점수가 가장 높은 사람"], unlucky: ["불운왕", "코인을 가장 많이 잃은 사람 (위로의 별)"] };
        setTray((t) => ({ ...t, dice: [], held: [], ids: [] }));
        sfx("news");
        setBanner({ id: ++fid, title: `보너스 별 · ${T[e.kind][0]}`, sub: `${e.ps.map(P).join(" · ")} — ${T[e.kind][1]} (${e.val})`, color: "#ff9f1a", ms: 2300 });
        await wait(1700);
        return;
      }
      case "nope": {
        if (e.p === myPi) {
          const id = ++fid;
          setNope({ id, why: e.why });
          sfx("deny");
          setTimeout(() => setNope((x) => (x && x.id === id ? null : x)), 1800);
        } else {
          const xy = slotXY(posRef.current[e.p]);
          float(xy.x, xy.y - 40, e.why, "#6b7280");
        }
        await wait(450);
        return;
      }
    }
  };
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const viewCards = (pi: number) => viewRef.current.players[pi]?.cards ?? [];

  const [who, setWho] = useState<number | null>(null);
  const guide = useMapGuide();

  /* ── 대기열 돌리기 ── */
  const syncTo = (gw: GameWire) => {
    setView(gw);
    setPos(gw.players.map((p) => p.pos));
    setCoins(gw.players.map((p) => p.coins));
    setStars(gw.players.map((p) => p.stars));
    setStarAt(gw.star);
    setAnim(gw.players.map(() => "idle"));
    setTray((t) => {
      const nt = trayOf(gw);
      if (nt.p === t.p && nt.dice.length === t.dice.length && nt.dice.every((d, i) => d === t.dice[i])) return { ...nt, ids: t.ids };
      return nt;
    });
  };
  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    while (queue.current.length) {
      const w = queue.current.shift()!;
      // 많이 밀렸으면 (탭을 내려 뒀다 옴) 연출 없이 맞춤
      const skip = queue.current.length >= 3;
      if (!skip && w.game) for (const e of w.ev) await playEv(e, w.game);
      if (w.game) syncTo(w.game);
      setLive(w);
    }
    running.current = false;
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (room.seq <= lastSeq.current) {
      setLive(room);
      return;
    }
    lastSeq.current = room.seq;
    // 잠그기만 바뀐 상태는 연출 없이 바로 (내 화면이 깜빡이지 않게)
    const light = room.ev.length > 0 && room.ev.every((e) => e.t === "hold");
    if ((!room.ev.length || light) && !running.current && !queue.current.length) {
      setLive(room);
      if (room.game) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버에서 새 방 상태가 오면 화면 상태를 맞춤
        setView(room.game);
        const t = room.game.turn;
        if (light && t) setTray((x) => ({ ...x, held: [...t.held] }));
      }
      return;
    }
    queue.current.push(room);
    void pump();
  }, [room, pump]);

  /* ── 내 차례 ── */
  const g = live.game ?? view;
  const gg = g as unknown as Game;
  const pr: Prompt | null = !busy && live.phase === "play" ? g.prompt : null;
  const mine = !!pr && pr.p === myPi;
  const mySeat = myPi >= 0 ? room.seats[order[myPi]] : null;
  const [mode, setMode] = useState<Mode>(null);
  const [sending, setSending] = useState(false);
  const [info, setInfo] = useState<number | null>(null);
  const [slide, setSlide] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버에서 새 상태가 오면 고르던 것 정리
  useEffect(() => setMode(null), [live.seq]);
  // 새 굴림 · 주사위가 바뀌면 이동 추천을 다시
  const diceKey = g.turn ? `${g.cur}:${g.turn.dice.join("")}:${g.turn.tri}:${g.turn.boost}:${g.turn.dbl}:${slide}` : "";
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 주사위가 바뀌면 추천 이동으로
    setSel(null);
  }, [diceKey]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 새 차례면 미끄럼 · 잠금 초기화
    setSlide(0);
    if (g.turn) setHeld([...g.turn.held]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.cur, g.round, g.turn?.rolled, g.turn?.again]);

  const send = async (a: Action) => {
    if (sending) return;
    setSending(true);
    setMode(null);
    try {
      await marble.act(room.id, a);
    } catch (e) {
      sfx("deny");
      const id = ++fid;
      setNope({ id, why: (e as Error).message });
      setTimeout(() => setNope((x) => (x && x.id === id ? null : x)), 1800);
    } finally {
      setSending(false);
    }
  };
  /** 잠그기는 기다리지 않고 바로 (보는 사람에게 알려 주기만) */
  const toggleHold = (i: number) => {
    if (!mine || !pr || pr.k !== "dice") return;
    sfx("click");
    const next = (held.length ? held : g.turn!.dice.map(() => false)).map((v, k) => (k === i ? !v : v));
    setHeld(next);
    setTray((t) => ({ ...t, held: next }));
    void marble.act(room.id, { t: "hold", pick: next.flatMap((v, k) => (v ? [k] : [])) }).catch(() => {});
  };

  const opts = useMemo(() => (mine && pr?.k === "dice" ? moveOptions(gg, myPi, slide) : []), [mine, pr?.k, gg, myPi, slide]);
  const best = useMemo(() => {
    if (!mine || pr?.k !== "dice" || !opts.length) return null;
    try {
      const b = bestMove(gg, myPi);
      return opts.find((o) => o.steps === b.steps + slide) ?? opts[0];
    } catch {
      return opts[0];
    }
  }, [mine, pr?.k, opts, gg, myPi, slide]);
  const chosen = opts.find((o) => o.steps === sel) ?? best;

  const onSkill = () => {
    if (!mine || skillBlock(gg, myPi)) return;
    const k = g.players[myPi].skill.kind;
    const tg = SKILL_TARGET[k];
    sfx("click");
    if (tg === "none") return void send({ t: "skill" });
    if (tg === "foe") {
      const foes = g.players.map((_, i) => i).filter((i) => i !== myPi);
      return foes.length === 1 ? void send({ t: "skill", target: foes[0] }) : setMode({ k: "foe", for: "skill" });
    }
    if (tg === "pull") return setMode({ k: "pull" });
    setMode({ k: "die", for: tg === "die" ? "six" : tg, picks: [], vals: [] });
  };
  const onCard = (id: CardId) => {
    if (!mine || cardBlock(gg, myPi, id)) return;
    sfx("click");
    const c = CARDS[id];
    if (c.target === "foe") {
      const foes = g.players.map((_, i) => i).filter((i) => i !== myPi);
      return foes.length === 1 ? void send({ t: "card", id, target: foes[0] }) : setMode({ k: "foe", for: id });
    }
    if (c.target === "die") return setMode({ k: "die", for: "gold", picks: [], vals: [] });
    if (c.target === "star") return setMode({ k: "star" });
    void send({ t: "card", id });
  };
  /** 주사위 고르기 모드에서 주사위를 누름 */
  const onDiePick = (i: number) => {
    if (mode?.k !== "die") return;
    sfx("click");
    const m = mode;
    const t = g.turn!;
    if (m.for === "six") return void send({ t: "skill", die: i });
    if (m.for === "copy") {
      if (!m.picks.length) return setMode({ ...m, picks: [i] });
      if (i === m.picks[0]) return;
      const rest = m.picks.slice(1);
      const has = rest.includes(i);
      const next = has ? rest.filter((x) => x !== i) : [...rest, i].slice(-g.players[myPi].skill.mag);
      return setMode({ ...m, picks: [m.picks[0], ...next] });
    }
    // gold · gear · nudge · magic: 주사위 고르면 눈 고르기
    if (m.picks.length === m.vals.length) {
      if (m.picks.includes(i)) return;
      setMode({ ...m, picks: [...m.picks, i] });
    }
    void t;
  };
  const onFace = (v: number) => {
    if (mode?.k !== "die") return;
    const m = mode;
    const i = m.picks[m.picks.length - 1];
    sfx("click");
    if (m.for === "gold") return void send({ t: "card", id: "gold", die: i, n: v });
    if (m.for === "gear") return void send({ t: "gear", die: i, n: v });
    if (m.for === "nudge") return void send({ t: "skill", die: i, n: v - g.turn!.dice[i] });
    if (m.for === "magic") {
      const vals = [...m.vals, v];
      if (vals.length < 2) return setMode({ ...m, vals });
      return void send({ t: "skill", pick: m.picks, vals });
    }
  };

  /* 보드에서 고를 칸 */
  let pick: number[] | null = null;
  let onPick: ((slot: number) => void) | undefined;
  if (mine && pr) {
    if (mode?.k === "star") {
      pick = g.stars.filter((s) => s !== g.star);
      onPick = (s) => void send({ t: "card", id: "starmove", tile: s });
    } else if (pr.k === "warp") {
      pick = map.tiles.map((_, s) => s).filter((s) => s !== g.players[myPi].pos && s !== g.star && map.tiles[s].kind !== "warp");
      onPick = (s) => void send({ t: "warp", tile: s });
    }
  }
  // 이동 고르기: 갈 수 있는 칸 숫자 + 고른 길 미리 보기
  let reach: Record<number, { n: number; on: boolean }> | null = null;
  let preview: Trail | null = null;
  if (mine && pr?.k === "dice" && !mode && opts.length && !trail) {
    reach = {};
    for (const o of opts) if (!reach[o.dest] || o === chosen) reach[o.dest] = { n: o.steps, on: o === chosen };
    if (chosen) preview = { id: -1, slots: chosen.path, at: 0, color: PCOLOR[myPi], n: chosen.steps, preview: true };
  }
  if (mine && pr?.k === "more" && !trail) {
    reach = {};
    for (let k = 1; k <= pr.max; k++) reach[(g.players[myPi].pos + k) % 32] = { n: k, on: false };
  }
  const onReach = (slot: number) => {
    if (pr?.k === "more") {
      const k = (slot - g.players[myPi].pos + 32) % 32;
      if (k >= 1 && k <= pr.max) void send({ t: "more", n: k });
      return;
    }
    const o = opts.find((x) => x.dest === slot);
    if (o) {
      sfx("click");
      setSel(o.steps);
    }
  };

  // 시간 막대
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(id);
  }, []);
  const left = live.deadline ? Math.max(0, live.deadline - serverNow()) : 0;

  const tokens: TokenView[] = view.players.map((p, i) => ({
    pi: i,
    slot: pos[i],
    sprite: spriteOf(p.lo.char.id),
    anim: anim[i],
    face: face[i],
    hop: hop[i],
    say: pr && !mine && pr.p === i ? thinking(pr) : undefined,
    sleep: p.sleep,
    shield: p.shield > 0 || p.cards.includes("shield"),
  }));
  const rank = standingsOf(view, stars, coins);
  const dim = mine && pr && (pr.k === "foe" || mode?.k === "foe" || mode?.k === "pull");

  return (
    <div className="mb-sky absolute inset-0 overflow-hidden" style={{ background: "radial-gradient(circle at 50% 45%, #bfe9ff 0%, #7cc4f2 55%, #4c8fd6 100%)" }}>
      {/* 바깥 배경: 맵 그림을 크게 흐리게 + 가장자리 어둡게 */}
      <img src={`/marble/bg/center-${view.map}.webp`} alt="" className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-[10px]" />
      <div className="pointer-events-none absolute inset-0" style={{ background: view.frenzy ? "radial-gradient(ellipse at 50% 50%, rgba(255,120,40,0.08) 35%, rgba(120,20,0,0.55) 100%)" : "radial-gradient(ellipse at 50% 50%, rgba(10,8,30,0.05) 35%, rgba(10,8,30,0.6) 100%)" }} />
      <Board g={view} tokens={tokens} star={starAt} pick={pick} onPick={onPick} onInfo={(s) => setInfo(s)} flash={flash} trail={trail ?? preview} reach={reach} onReach={onReach} frenzy={view.frenzy} />

      {/* 위 가운데: 바퀴 · 막판 · 별 값 */}
      <div className="absolute top-[6px] left-1/2 z-[400] flex -translate-x-1/2 items-center gap-1.5">
        <div className="mb-wood flex items-center gap-2.5 px-3.5 py-1" style={{ "--bar": view.frenzy ? "#ff6a2b" : "#5b6cff" } as CSSProperties}>
          <b className="mb-title mb-out text-[15px] text-white whitespace-nowrap">
            {Math.min(view.round, view.rounds)}
            <span className="text-white/70"> / {view.rounds} 바퀴</span>
          </b>
          {view.frenzy && <span className="mbx-hot rounded-full bg-[#ff6a2b] px-2 text-[12px] leading-[18px] font-black whitespace-nowrap text-white">막판 2배!</span>}
          <span className="flex items-center gap-1 rounded-full bg-black/25 px-2 text-[12px] leading-[20px] font-bold whitespace-nowrap text-[#ffe08a]">
            <Glyph n="star" size={13} color="#ffd23a" /> {RULE.starPrice}코인
          </span>
          <GuideDot onOpen={() => guide.show(map.id)} className="!h-[20px] !w-[20px] !text-[12px]" />
        </div>
      </div>
      <div className="absolute top-[150px] left-[10px] z-[430]">
        <RoomTools room={live} me={me} onLeave={onLeave} inGame vertical />
      </div>

      {/* 플레이어 (네 귀퉁이) */}
      {view.players.map((p, i) => (
        <PlayerCard
          key={i}
          i={i}
          g={view}
          coins={coins[i]}
          stars={stars[i]}
          rank={rank.indexOf(i) + 1}
          me={i === myPi}
          turn={(live.game?.prompt?.p ?? -1) === i && live.phase === "play"}
          secs={(live.game?.prompt?.p ?? -1) === i && !busy && left > 0 ? Math.ceil(left / 1000) : 0}
          seat={room.seats[order[i]]}
          shake={shake === i}
          corner={viewIdx(i)}
          n={n}
          onInfo={() => setWho(i)}
        />
      ))}

      {/* 판 가운데: 주사위 접시 · 굴리기 · 이동 고르기 */}
      {live.phase === "play" && (
        <DiceTray
          g={g}
          tray={tray}
          pr={pr}
          mine={mine}
          myPi={myPi}
          held={held}
          busy={busy}
          sending={sending}
          left={left}
          mode={mode}
          opts={opts}
          chosen={chosen}
          slide={slide}
          auto={!!mySeat?.auto}
          onManual={() => void marble.auto(room.id, false)}
          onRoll={(power) => void send(power === undefined ? { t: "roll" } : { t: "roll", power })}
          onHold={toggleHold}
          onReroll={() => {
            sfx("click");
            void send({ t: "reroll", pick: held.flatMap((v, k) => (v ? [k] : [])) });
          }}
          onMove={() => {
            if (!chosen) return;
            sfx("click");
            void send(chosen.n !== undefined ? { t: "move", n: chosen.n, ...(slide && { d: slide }) } : { t: "move", pick: chosen.pick ?? [], ...(slide && !chosen.jump && { d: slide }) });
          }}
          onSel={(d) => {
            if (!opts.length || !chosen) return;
            const k = opts.indexOf(chosen);
            sfx("click");
            setSel(opts[(k + d + opts.length) % opts.length].steps);
          }}
          onSlide={(d) => {
            sfx("click");
            setSlide((s) => (s === d ? 0 : d));
          }}
          onSkill={onSkill}
          onDiePick={onDiePick}
          onFace={onFace}
          onCopy={() => mode?.k === "die" && mode.picks.length > 1 && void send({ t: "skill", die: mode.picks[0], pick: mode.picks.slice(1) })}
          onCancel={() => setMode(null)}
          onMore={(k) => void send({ t: "more", n: k })}
          hidden={!!yacht}
        />
      )}
      {/* 내 아이템 (내 카드 위) */}
      {myPi >= 0 && live.phase === "play" && !mySeat?.auto && (
        <ItemDock g={g} myPi={myPi} mine={mine} pr={pr} sending={sending} onCard={onCard} onGear={() => setMode({ k: "die", for: "gear", picks: [], vals: [] })} />
      )}
      {/* 별 이사 · 별 고르기 · 워프 안내 */}
      {mine && pr && (mode?.k === "star" || pr.k === "warp") && (
        <div className="pointer-events-none absolute top-[44px] left-1/2 z-[470] -translate-x-1/2">
          <div className="mbx-pop flex items-center gap-2 rounded-full bg-[#1b1650]/90 px-4 py-1.5 text-[13px] font-bold whitespace-nowrap text-white shadow-[0_6px_18px_rgba(0,0,0,0.4)] ring-2 ring-[#ffd23a]">
            {pr.k === "warp" ? "워프할 칸을 판에서 눌러요 (별 칸 빼고)" : "별을 옮길 별 자리를 판에서 눌러요"}
            {mode?.k === "star" && (
              <button type="button" className="pointer-events-auto rounded-full bg-white/15 px-2 text-[12px] hover:bg-white/25" onClick={() => setMode(null)}>
                취소
              </button>
            )}
          </div>
        </div>
      )}

      {/* 상대 고르기 (풀하우스 · VS · 스킬 · 아이템) — 가운데 창, 뒤 어둡게 */}
      {dim && <div className="absolute inset-0 z-[450] bg-[rgba(20,16,50,0.5)]" />}
      {mine && pr && (pr.k === "foe" || mode?.k === "foe" || mode?.k === "pull") && (
        <FoePick
          g={g}
          coins={coins}
          stars={stars}
          title={pr.k === "foe" ? (pr.why === "steal" ? "풀하우스! 누구에게서 뺏을까요?" : "VS 대결! 누구랑 할까요?") : mode?.k === "pull" ? `${CHAR[g.players[myPi].lo.char.id]?.active.name ?? "끌어오기"} — 누구를?` : mode?.k === "foe" && mode.for !== "skill" ? `${CARDS[mode.for].name} — 누구에게?` : `${CHAR[g.players[myPi].lo.char.id]?.active.name ?? "스킬"} — 누구에게?`}
          opts={pr.k === "foe" ? pr.opts : g.players.map((_, i) => i).filter((i) => i !== myPi)}
          pull={mode?.k === "pull" ? g.players[myPi].skill.mag : 0}
          onPick={(q, k) => {
            if (pr.k === "foe") return void send({ t: "target", target: q });
            if (mode?.k === "pull") return void send({ t: "skill", target: q, n: k });
            if (mode?.k === "foe") return void send(mode.for === "skill" ? { t: "skill", target: q } : { t: "card", id: mode.for, target: q });
          }}
          onCancel={pr.k === "foe" ? undefined : () => setMode(null)}
          sending={sending}
          left={pr.k === "foe" ? left : 0}
        />
      )}

      {guide.node}
      {who !== null && view.players[who] && <PlayerInfo g={view} i={who} onClose={() => setWho(null)} />}
      {info !== null && <TileInfo g={view} slot={info} star={starAt} onClose={() => setInfo(null)} />}

      {/* 떠오르는 글자 */}
      {floaters.map((f) => (
        <div
          key={f.id}
          className="mb-float pointer-events-none absolute z-[500] font-bold whitespace-nowrap text-white"
          style={{ left: f.x, top: f.y, fontSize: f.big ? 24 : 17, textShadow: `2px 0 0 ${f.color}, -2px 0 0 ${f.color}, 0 2px 0 ${f.color}, 0 -2px 0 ${f.color}, 2px 2px 0 ${f.color}, -2px -2px 0 ${f.color}, 2px -2px 0 ${f.color}, -2px 2px 0 ${f.color}, 0 4px 0 #232a4d` }}
        >
          {f.text}
        </div>
      ))}
      {fxs.map((f) => (
        <FxView key={f.id} f={f} />
      ))}
      {flyStar && <FlyStar key={flyStar.id} a={flyStar.a} b={flyStar.b} />}

      {banner && <BannerView key={banner.id} b={banner} />}
      {pop?.k === "hand" && <HandPop key={pop.id} hand={pop.hand} x2={pop.x2} color={PCOLOR[pop.p]} />}
      {pop?.k === "card" && <ItemPop key={pop.id} id={pop.card} name={view.players[pop.p]?.name ?? ""} />}
      {pop?.k === "event" && <EventPop key={pop.id} id={pop.ev} alt={pop.alt} name={view.players[pop.p]?.name ?? ""} />}
      {pop?.k === "vs" && <VsPop key={pop.id} e={pop.e} g={view} />}
      {yacht && <YachtCutin key={yacht.id} name={view.players[yacht.p]?.name ?? ""} char={view.players[yacht.p]?.lo.char.id ?? "kai"} x2={yacht.x2} />}
      {nope && <NopeToast key={nope.id} why={nope.why} />}
      {intro && <OrderIntro pi={myPi} n={g0.players.length} />}
      {live.phase === "end" && live.result && !busy && <Result room={live} me={me} onLeave={onLeave} />}
    </div>
  );
}

type Mode =
  | null
  | { k: "foe"; for: "skill" | CardId }
  | { k: "pull" }
  | { k: "die"; for: "six" | "gold" | "gear" | "nudge" | "magic" | "copy"; picks: number[]; vals: number[] }
  | { k: "star" };

const removeOne = <T,>(a: T[], x: T) => {
  const i = a.indexOf(x);
  return i < 0 ? a : [...a.slice(0, i), ...a.slice(i + 1)];
};

/** 순위 (보이는 별 · 코인 기준) */
function standingsOf(g: GameWire, stars: number[], coins: number[]): number[] {
  return standings({ ...(g as unknown as Game), players: g.players.map((p, i) => ({ ...p, stars: stars[i] ?? p.stars, coins: coins[i] ?? p.coins })) });
}

/* ───────────── 배경 · 위치 ───────────── */

/** 귀퉁이 0 왼쪽 아래(나) · 1 오른쪽 위 · 2 왼쪽 위 · 3 오른쪽 아래 (2인이면 0 · 1) */
function cornerRect(corner: number, n: number) {
  const w = 228;
  const h = 104;
  // 3 · 4인: 0 왼쪽 아래 · 1 왼쪽 위 · 2 오른쪽 위 · 3 오른쪽 아래 (시계 방향) / 2인: 왼쪽 아래 · 오른쪽 위
  const at = n <= 2 ? [0, 2][corner] : corner;
  const left = at === 0 || at === 1;
  const topSide = at === 1 || at === 2;
  return { x: left ? 8 : 1024 - 8 - w, y: topSide ? 18 : 576 - 10 - h, w, h };
}

/* ───────────── 플레이어 카드 ───────────── */

function PlayerCard({
  i,
  g,
  coins,
  stars,
  rank,
  me,
  turn,
  secs,
  seat,
  shake,
  corner,
  n,
  onInfo,
}: {
  i: number;
  g: GameWire;
  coins: number;
  stars: number;
  rank: number;
  me: boolean;
  turn: boolean;
  /** 이 사람 차례 남은 초 (사람만, 0 = 안 보임) */
  secs: number;
  seat: RoomWire["seats"][number];
  shake: boolean;
  corner: number;
  n: number;
  onInfo(): void;
}) {
  const p = g.players[i];
  const c = CHAR[p.lo.char.id];
  const r = cornerRect(corner, n);
  const ready = p.cd === 0 && g.round > 1;
  const MEDAL = ["#ffc93a", "#cfd6e6", "#e0a46a", "#9aa3b8"];
  return (
    <div className={`absolute z-[420] cursor-pointer ${shake ? "mb-shake" : ""}`} style={r.y > 288 ? { left: r.x, bottom: 10, width: r.w } : { left: r.x, top: r.y, width: r.w }} onClick={onInfo} title="눌러서 캐릭터 · 장착 효과 보기">
      <div className={`mb-box relative overflow-visible ${turn ? "mb-turn" : ""}`} style={{ "--c": PCOLOR[i], "--bg": "#ffffff" } as CSSProperties}>
        {/* 이름 띠 */}
        <div className="flex h-[26px] items-center gap-1.5 rounded-t-[14px] pr-2 pl-[84px]" style={{ background: PCOLOR[i], boxShadow: "inset 0 -3px 0 rgba(0,0,0,0.18), inset 0 3px 0 rgba(255,255,255,0.3)" }}>
          {seat?.bot ? <Icon n="bot" size={13} /> : me ? <Icon n="crown" size={13} /> : null}
          <b className="mb-out-s min-w-0 flex-1 truncate text-[14px] text-white">{p.name}</b>
          {seat?.auto && <span className="mb-chip text-[10px]">자동</span>}
          {seat?.away && <span className="mb-chip text-[10px]">끊김</span>}
          {secs > 0 && <span className={`rounded-full px-1.5 text-[11px] leading-[16px] font-black ${secs <= 5 ? "bg-[#ff3d6e] text-white" : "bg-white/90 text-[#232a4d]"}`}>{secs}초</span>}
        </div>
        {/* 얼굴 (띠 위로 튀어나오게) + 순위 메달 */}
        <div className="absolute top-[-10px] left-[8px] h-[68px] w-[68px] overflow-hidden rounded-[12px] bg-white" style={{ boxShadow: "0 0 0 3px #232a4d" }}>
          {c && (
            <>
              <img src={`/marble/art/bg-${c.grade}.webp`} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <img src={faceOf(c)} alt="" className="relative h-full w-full object-cover object-top" />
            </>
          )}
          {c && <GradeTag g={c.grade} className="absolute bottom-[3px] left-[3px] scale-90" />}
        </div>
        <span className="absolute top-[-14px] left-[-6px] flex h-[26px] w-[26px] items-center justify-center rounded-full text-[13px] font-black text-[#3a2500]" style={{ background: MEDAL[rank - 1] ?? MEDAL[3], boxShadow: "0 0 0 2px #fff, 0 0 0 3.5px #232a4d, 0 2px 4px rgba(0,0,0,0.35)" }} title={`지금 ${rank}등`}>
          {rank}
        </span>
        <div className="flex items-center gap-2.5 pt-[4px] pr-2 pl-[84px]">
          <span className="flex items-center gap-1 text-[26px] leading-[30px] font-black text-[#232a4d]" title="별">
            <span key={stars} className="mb-pop">
              <Glyph n="star" size={24} color="#ffd23a" />
            </span>
            {stars}
          </span>
          <span className="flex items-center gap-1 text-[18px] leading-[30px] font-bold text-[#5a4a20]" title="코인">
            <Glyph n="coin" size={17} color="#ffd23a" />
            {fmt(coins)}
          </span>
        </div>
        <div className="flex h-[30px] items-center gap-1 px-2 pt-0.5 pb-1.5">
          <span className="mb-chip shrink-0 text-[10.5px]" title={c ? `${c.active.name} — ${c.active.desc(power(c.grade, p.lo.char.lv))}` : ""} style={{ "--c": ready ? "#ffe24a" : "#e3e8f7" } as CSSProperties}>
            <Icon n="star" size={10} />
            {g.round <= 1 ? "2바퀴부터" : ready ? "스킬 준비" : `${p.cd}턴`}
          </span>
          <span className="flex min-w-0 items-center gap-[3px]" title="아이템">
            {Array.from({ length: RULE.maxCards }, (_, k) => {
              const id = p.cards[k];
              return id ? <CardIcon key={k} id={id} size={20} /> : <span key={k} className="h-[20px] w-[20px] rounded-[6px] bg-[#232a4d]/10 ring-1 ring-[#232a4d]/15" />;
            })}
          </span>
          <span className="ml-auto flex items-center gap-[3px]">
            {p.sleep && <StatusDot c="#5b6bd6" t="다음 차례 다시 굴리기 0번" label="Zz" />}
            {p.seal > 0 && <StatusDot c="#d8402f" t="다음 차례 주사위 하나 봉인" label="봉" />}
            {p.shield > 0 && <StatusDot c="#2f8fc4" t={`방패 ${p.shield}`} label="막" />}
          </span>
        </div>
      </div>
    </div>
  );
}
function StatusDot({ c, t, label }: { c: string; t: string; label: string }) {
  return (
    <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-black text-white" style={{ background: c, boxShadow: "0 0 0 1.5px #fff" }} title={t}>
      {label}
    </span>
  );
}

/** 아이템 카드 그림 (작은 정사각) */
const CARD_LOOK: Record<CardId, { g: GlyphName; c: string; bg: string }> = {
  gold: { g: "dice", c: "#ffd23a", bg: "#7a4b00" },
  boost: { g: "boot", c: "#ff7a5c", bg: "#6a2010" },
  reroll: { g: "dice", c: "#9fdcff", bg: "#123a6a" },
  thief: { g: "bag", c: "#b9c2d6", bg: "#2a2550" },
  swap: { g: "portal", c: "#b5a6ff", bg: "#2a1f6a" },
  starmove: { g: "star", c: "#ffd23a", bg: "#5a3a00" },
  trap: { g: "trap", c: "#cfd6e6", bg: "#3a4050" },
  shield: { g: "shield", c: "#7fd7ff", bg: "#0f4a6a" },
};
export function CardIcon({ id, size = 24 }: { id: CardId; size?: number }) {
  const l = CARD_LOOK[id];
  return (
    <span className="flex shrink-0 items-center justify-center rounded-[6px]" style={{ width: size, height: size, background: `linear-gradient(160deg, ${l.bg}cc, ${l.bg})`, boxShadow: "0 0 0 1.5px #fff, 0 0 0 2.5px #232a4d" }} title={`${CARDS[id].name} — ${CARDS[id].desc}`}>
      <Glyph n={l.g} size={Math.round(size * 0.78)} color={l.c} />
    </span>
  );
}

/** 플레이어 정보 창: 캐릭터 · 패시브 · 스킬 · 장착 아이템 효과 */
function PlayerInfo({ g, i, onClose }: { g: GameWire; i: number; onClose(): void }) {
  const p = g.players[i];
  const c = CHAR[p.lo.char.id];
  const cp = c ? power(c.grade, p.lo.char.lv) : 0;
  const items = [p.lo.dice, p.lo.buddy].filter(Boolean) as { id: string; lv: number }[];
  return (
    <div className="mbx absolute inset-0 z-[500] flex items-center justify-center bg-[rgba(10,8,30,0.55)]" onClick={onClose}>
      <div className="mbx-pop flex w-[560px] overflow-hidden rounded-2xl border border-white/15 bg-[#1b1650]/95 text-white shadow-[0_20px_50px_rgba(0,0,0,0.5)]" onClick={(e) => e.stopPropagation()}>
        <div className="relative w-[190px] shrink-0">{c && <CharHero id={c.id} className="h-full min-h-[290px] w-full" />}</div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-4 text-[12.5px] leading-[18px]">
          <div className="flex items-center gap-2">
            <span className="h-[12px] w-[12px] rounded-full" style={{ background: PCOLOR[i] }} />
            <b className="truncate text-[17px]">{p.name}</b>
            <button type="button" onClick={onClose} className="ml-auto flex h-[26px] w-[26px] items-center justify-center rounded-full bg-white/10 hover:bg-white/20" aria-label="닫기">
              ×
            </button>
          </div>
          {c && (
            <>
              <div className="flex items-center gap-1.5">
                <XGrade g={c.grade} />
                <span className="font-bold">{c.title}</span>
                <span className="text-white/55">· 강화 {p.lo.char.lv}</span>
              </div>
              <div className="rounded-xl bg-white/[0.07] px-3 py-2">
                <div className="text-[11.5px] font-bold text-[#ffe08a]">패시브 · {c.passive.name}</div>
                {c.passive.desc(cp)}
              </div>
              <div className="rounded-xl bg-white/[0.07] px-3 py-2">
                <div className="text-[11.5px] font-bold text-[#ffe08a]">
                  스킬 · {c.active.name} <span className="font-normal text-white/50">({g.round <= 1 ? "2바퀴부터" : p.cd > 0 ? `${p.cd}턴 뒤` : "지금 쓸 수 있음"})</span>
                </div>
                {c.active.desc(cp)}
              </div>
            </>
          )}
          {items.length ? (
            items.map((x) => {
              const it = ITEM[x.id];
              return it ? (
                <div key={x.id} className="flex items-center gap-2.5 rounded-xl bg-white/[0.07] px-3 py-2">
                  <ItemIcon id={it.id} size={38} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <XGrade g={it.grade} />
                      <b className="text-[12.5px]">{it.name}</b>
                      <span className="text-[11px] text-[#ffe08a]">+{x.lv}</span>
                    </div>
                    <div className="text-[11.5px] text-white/80">{it.desc(power(it.grade, x.lv))}</div>
                  </div>
                </div>
              ) : null;
            })
          ) : (
            <div className="text-white/50">장착한 아이템 없음</div>
          )}
          {p.cards.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-white/[0.07] px-3 py-2">
              <span className="text-[11.5px] font-bold text-[#ffe08a]">들고 있는 아이템</span>
              {p.cards.map((id, k) => (
                <span key={k} className="flex items-center gap-1 text-[11.5px]">
                  <CardIcon id={id} size={18} />
                  {CARDS[id].name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────── 주사위 ───────────── */

/** 그 눈이 앞으로 오게 하는 회전 — 면: 앞 1 · 뒤 6 · 오른쪽 3 · 왼쪽 4 · 위 2 · 아래 5 */
const FACE_ROT: Record<number, [number, number]> = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 2: [-90, 0], 5: [90, 0] };
/** 주사위 하나 (3D 정육면체): roll 이 바뀌면 위에서 떨어지며 데굴데굴 구르다 그 눈이 앞을 보며 멈춤 */
function Die3D({ v, roll, size = 52, held, pick, dim, onClick, title }: { v: number; roll: number; size?: number; held?: boolean; pick?: boolean; dim?: boolean; onClick?(): void; title?: string }) {
  const [rx, ry] = FACE_ROT[v] ?? [0, 0];
  const half = size / 2;
  const moving = roll > 0;
  const seed = roll % 7;
  const cube = {
    "--rx0": `${rx + 360 * 2 + 40 + seed * 20}deg`,
    "--ry0": `${ry - 360 * 2 + 70 - seed * 15}deg`,
    "--rz0": `${seed % 2 ? 160 : -140}deg`,
    "--rx1": `${rx}deg`,
    "--ry1": `${ry}deg`,
    animationDuration: moving ? "820ms" : "0ms",
    transform: moving ? undefined : `rotateX(${rx}deg) rotateY(${ry}deg)`,
  } as CSSProperties;
  const faces: [number, string][] = [
    [1, `translateZ(${half}px)`],
    [6, `rotateY(180deg) translateZ(${half}px)`],
    [3, `rotateY(90deg) translateZ(${half}px)`],
    [4, `rotateY(-90deg) translateZ(${half}px)`],
    [2, `rotateX(90deg) translateZ(${half}px)`],
    [5, `rotateX(-90deg) translateZ(${half}px)`],
  ];
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick && { type: "button" as const, onClick })}
      title={title}
      className={`relative shrink-0 transition-transform duration-150 ${onClick ? "cursor-pointer hover:-translate-y-1" : ""} ${held ? "-translate-y-[7px]" : ""}`}
      style={{ width: size, height: size + 10, opacity: dim ? 0.45 : 1 }}
    >
      <div className={moving ? "mbx-drop" : undefined} key={roll} style={{ width: size, height: size, "--fy": "-70px", animationDuration: moving ? "820ms" : "0ms" } as CSSProperties}>
        <div className="absolute bottom-[-9px] left-1/2 h-[9px] w-[80%] -translate-x-1/2 rounded-[50%] bg-black/30 blur-[1px]" />
        <div style={{ width: size, height: size, perspective: 600 }}>
          <div style={{ width: size, height: size, transformStyle: "preserve-3d", transform: "rotateX(-14deg) rotateY(14deg)" }}>
            <div className={moving ? "mbx-tumble" : undefined} style={{ ...cube, width: size, height: size, transformStyle: "preserve-3d", position: "relative" }}>
              {faces.map(([k, tf]) => (
                <div key={k} className="absolute inset-0 rounded-[10px]" style={{ transform: tf, background: held ? "linear-gradient(145deg, #fff7d0, #ffd96a)" : "linear-gradient(145deg, #ffffff, #e9ecf7)", boxShadow: held ? "inset 0 0 0 2.5px #f0a020, inset 0 -3px 6px rgba(120,70,0,0.18)" : "inset 0 0 0 1.5px #c9cfe6, inset 0 -3px 6px rgba(38,43,82,0.12)", backfaceVisibility: "hidden" }}>
                  <Pips n={k} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {held && (
        <span className="absolute -top-[9px] -right-[7px] flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#f0a020]" style={{ boxShadow: "0 0 0 2px #fff, 0 2px 4px rgba(0,0,0,0.35)" }}>
          <Glyph n="lock" size={15} color="#fff6c0" />
        </span>
      )}
      {pick && <span className="mbx-pick pointer-events-none absolute inset-x-[-3px] top-[-3px] h-[calc(100%-4px)] rounded-[12px]" />}
    </Tag>
  );
}

/** 주사위 눈 (1 은 빨간 큰 점) */
function Pips({ n }: { n: number }) {
  const P: Record<number, [number, number][]> = {
    1: [[50, 50]],
    2: [
      [28, 28],
      [72, 72],
    ],
    3: [
      [26, 26],
      [50, 50],
      [74, 74],
    ],
    4: [
      [28, 28],
      [72, 28],
      [28, 72],
      [72, 72],
    ],
    5: [
      [26, 26],
      [74, 26],
      [50, 50],
      [26, 74],
      [74, 74],
    ],
    6: [
      [28, 24],
      [72, 24],
      [28, 50],
      [72, 50],
      [28, 76],
      [72, 76],
    ],
  };
  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
      {(P[n] ?? []).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={n === 1 ? 15 : 9.5} fill={n === 1 ? "#ff3d5e" : "#262b52"} />
      ))}
    </svg>
  );
}
/** 작은 2D 주사위 (VS · 버튼 안) */
function MiniDie({ v, size = 30 }: { v: number; size?: number }) {
  return (
    <span className="relative inline-block shrink-0 rounded-[7px]" style={{ width: size, height: size, background: "linear-gradient(145deg, #ffffff, #e9ecf7)", boxShadow: "inset 0 0 0 1.5px #c9cfe6, 0 2px 0 rgba(38,43,82,0.35)" }}>
      <Pips n={v} />
    </span>
  );
}

/* ───────────── 주사위 접시 (판 가운데) ───────────── */

function DiceTray({
  g,
  tray,
  pr,
  mine,
  myPi,
  held,
  busy,
  sending,
  left,
  mode,
  opts,
  chosen,
  slide,
  auto,
  hidden,
  onManual,
  onRoll,
  onHold,
  onReroll,
  onMove,
  onSel,
  onSlide,
  onSkill,
  onDiePick,
  onFace,
  onCopy,
  onCancel,
  onMore,
}: {
  g: GameWire;
  tray: TrayView;
  pr: Prompt | null;
  mine: boolean;
  myPi: number;
  held: boolean[];
  busy: boolean;
  sending: boolean;
  left: number;
  mode: Mode;
  opts: MoveOpt[];
  chosen: MoveOpt | null | undefined;
  slide: number;
  auto: boolean;
  hidden: boolean;
  onManual(): void;
  onRoll(power?: number): void;
  onHold(i: number): void;
  onReroll(): void;
  onMove(): void;
  onSel(d: number): void;
  onSlide(d: number): void;
  onSkill(): void;
  onDiePick(i: number): void;
  onFace(v: number): void;
  onCopy(): void;
  onCancel(): void;
  onMore(k: number): void;
}) {
  const gg = g as unknown as Game;
  const t = g.turn;
  const me = myPi >= 0 ? g.players[myPi] : null;
  const c = me ? CHAR[me.lo.char.id] : null;
  const timeBar = (k: string) =>
    mine && left > 0 ? (
      <div className="mb-bar w-[200px]" title={`${Math.ceil(left / 1000)}초`}>
        <i style={{ width: `${Math.min(100, (left / (LIMIT[k] ?? 15000)) * 100)}%`, "--c": left < 4000 ? "#ff6b6b" : "#4fd1b5" } as CSSProperties} />
      </div>
    ) : null;
  const wrap = (children: ReactNode) => (
    <div className="pointer-events-none absolute z-[460] flex flex-col items-center" style={{ left: TRAY.x, top: TRAY.y, transform: "translate(-50%, -50%)", opacity: hidden ? 0 : 1, transition: "opacity 200ms" }}>
      <div className="pointer-events-auto flex flex-col items-center gap-2">{children}</div>
    </div>
  );
  if (auto && myPi >= 0)
    return wrap(
      <div className="mbx-modal flex flex-col items-center gap-2 px-5 py-3 text-center">
        <b className="mb-title text-[15px]">자동 진행 중</b>
        <span className="text-[12px]">자리를 비운 동안 AI 가 대신 두고 있어요</span>
        <Btn tone="gold" className="h-[34px] px-4 text-[14px] font-bold" onClick={onManual}>
          내가 다시 할게요
        </Btn>
      </div>
    );

  const skillErr = mine && me ? skillBlock(gg, myPi) : "x";
  const skillOk = !skillErr && !sending;
  const kind = me?.skill.kind;
  // 굴리기 전에 쓸 수 있는 스킬만 굴리기 전 버튼에 (주사위를 만지는 건 굴린 뒤)
  const skillOrb = (pre: boolean) =>
    c && me ? (
      skillOk && (!pre || (kind && SKILL_TIME[kind] === "any")) ? (
        <button
          type="button"
          onClick={onSkill}
          title={c.active.desc(power(c.grade, me.lo.char.lv))}
          className="mbx-skill relative flex h-[84px] w-[84px] shrink-0 cursor-pointer flex-col items-center justify-center rounded-full transition hover:scale-105"
          style={{ background: "conic-gradient(from 0deg, #ff5fa2, #b46bff, #5fb8ff, #ffe08a, #ff5fa2)", boxShadow: "0 0 0 3px #fff, 0 5px 0 #6a2a9a, 0 0 26px 6px rgba(255,95,162,0.7)" }}
        >
          <img src={faceOf(c)} alt="" className="h-[72px] w-[72px] rounded-full object-cover" style={{ boxShadow: "inset 0 0 0 2px #fff" }} />
          <span className="mbx-skilltag absolute -top-[9px] rounded-full px-[7px] text-[11px] leading-[17px] font-black tracking-[0.12em]" style={{ boxShadow: "0 0 0 2px #ffe08a, 0 2px 6px rgba(0,0,0,0.4)" }}>
            SKILL
          </span>
          <span className="absolute -bottom-[11px] max-w-[120px] truncate rounded-full bg-gradient-to-r from-[#b46bff] to-[#ff5fa2] px-[8px] text-[12px] leading-[20px] font-black whitespace-nowrap text-white" style={{ boxShadow: "0 0 0 2px #fff, 0 2px 6px rgba(0,0,0,0.4)" }}>
            {c.active.name}
          </span>
        </button>
      ) : (
        <span className="relative flex h-[72px] w-[72px] shrink-0 flex-col items-center justify-center rounded-full bg-black/35 ring-2 ring-white/30" title={skillErr ?? ""}>
          <img src={faceOf(c)} alt="" className="h-[62px] w-[62px] rounded-full object-cover opacity-50 grayscale" />
          <span className="absolute -bottom-[9px] rounded-full bg-[#2a2550] px-[7px] text-[10.5px] leading-[18px] font-bold whitespace-nowrap text-white/85 ring-1 ring-white/30">
            {g.round <= 1 ? "2바퀴부터" : me.cd > 0 ? `${me.cd}턴 뒤` : SKILL_TIME[me.skill.kind] === "dice" && pr?.k === "turn" ? "굴린 뒤에" : "스킬"}
          </span>
        </span>
      )
    ) : null;
  /* 굴리기 전 (내 차례) */
  if (mine && pr?.k === "turn")
    return wrap(
      <>
        <div className="flex items-center gap-5">
          <div className="w-[84px]" />
          <RollButton disabled={sending} onThrow={onRoll} />
          <div className="flex w-[84px] justify-center">{skillOrb(true)}</div>
        </div>
        {t && t.n < 5 && <span className="rounded-full bg-[#d8402f] px-3 text-[12px] leading-[22px] font-bold text-white">주사위 하나 압수! 이번엔 {t.n}개</span>}
        {t && t.rolls === 0 && <span className="rounded-full bg-[#5b6bd6] px-3 text-[12px] leading-[22px] font-bold text-white">쿨쿨… 이번 차례는 다시 굴리기 0번</span>}
        {timeBar("turn")}
      </>
    );
  /* 몇 칸 더 (토토) */
  if (mine && pr?.k === "more")
    return wrap(
      <div className="mbx-modal flex flex-col items-center gap-2 px-4 py-3">
        <b className="mb-title text-[15px]">몇 칸 더 갈까요?</b>
        <div className="flex gap-1.5">
          {Array.from({ length: pr.max + 1 }, (_, k) => {
            const slot = ((me?.pos ?? 0) + k) % 32;
            const kd = MAPS[g.map].tiles[slot].kind;
            return (
              <Btn key={k} tone={k ? "gold" : "paper"} className="h-[46px] min-w-[54px] flex-col !gap-0 px-2 text-[14px] font-black" disabled={sending} onClick={() => onMore(k)}>
                {k ? `+${k}` : "그대로"}
                <span className="flex items-center gap-0.5 text-[10px] font-bold opacity-80">
                  <Glyph n={slot === g.star ? "star" : KIND[kd].glyph} size={11} color={KIND[kd].fill} />
                  {slot === g.star ? "별" : KIND[kd].label}
                </span>
              </Btn>
            );
          })}
        </div>
        {timeBar("more")}
      </div>
    );

  /* 굴린 주사위 */
  if (!t || !tray.dice.length) {
    if (!pr || mine || !g.players[pr.p]) return null;
    // 남의 차례 · 아직 안 굴림
    return wrap(
      <span className="rounded-full bg-[#1b1650]/80 px-4 py-1.5 text-[13px] font-bold text-white ring-1 ring-white/20" style={{ boxShadow: `0 0 0 2px ${PCOLOR[pr.p]}` }}>
        {g.players[pr.p].name} 차례
      </span>
    );
  }
  const dicePhase = mine && pr?.k === "dice";
  const hand = handOf(tray.dice);
  const h = HANDS[hand];
  const dieMode = dicePhase && mode?.k === "die" ? mode : null;
  const myHeld = dicePhase ? held : tray.held;
  const canRe = dicePhase && t && (t.rolls > 0 || (me?.uses.reroll ?? 0) > 0);
  const allHeld = myHeld.length >= tray.dice.length && myHeld.every(Boolean);
  // 주사위 고르기 모드 안내 · 눈 고르기
  let modeBar: ReactNode = null;
  if (dieMode) {
    const needFace = dieMode.picks.length > dieMode.vals.length && dieMode.for !== "six" && dieMode.for !== "copy";
    const label: Record<string, string> = {
      six: "6으로 바꿀 주사위를 눌러요",
      gold: "바꿀 주사위를 눌러요",
      gear: "바꿀 주사위를 눌러요",
      nudge: "±할 주사위를 눌러요",
      magic: dieMode.picks.length ? "두 번째 주사위를 눌러요" : "바꿀 주사위 두 개 중 첫째를 눌러요",
      copy: dieMode.picks.length ? `바꿀 주사위를 눌러요 (${dieMode.picks.length - 1}/${me?.skill.mag ?? 2})` : "복사할 눈의 주사위를 눌러요",
    };
    const faces = dieMode.for === "nudge" && needFace ? nudgeFaces(tray.dice[dieMode.picks[dieMode.picks.length - 1]], me?.skill.mag ?? 1) : [1, 2, 3, 4, 5, 6];
    modeBar = (
      <div className="mbx-pop flex flex-col items-center gap-1.5 rounded-2xl bg-[#1b1650]/92 px-3 py-2 ring-2 ring-[#ffd23a]">
        <span className="text-[12.5px] font-bold text-white">{needFace ? "어떤 눈으로 바꿀까요?" : label[dieMode.for]}</span>
        {needFace && (
          <div className="flex gap-1">
            {faces.map((v) => (
              <button key={v} type="button" className="cursor-pointer rounded-[8px] transition hover:-translate-y-0.5" onClick={() => onFace(v)}>
                <MiniDie v={v} size={32} />
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-1.5">
          {dieMode.for === "copy" && dieMode.picks.length > 1 && (
            <Btn tone="gold" className="h-[28px] px-3 text-[12.5px] font-black" onClick={onCopy}>
              복사!
            </Btn>
          )}
          <Btn className="h-[26px] px-3 text-[12px]" onClick={onCancel}>
            취소
          </Btn>
        </div>
      </div>
    );
  }
  return wrap(
    <>
      {/* 지금 족보 */}
      <div className="flex items-center gap-1.5 rounded-full bg-[#1b1650]/85 py-[3px] pr-3 pl-1.5 text-white ring-1 ring-white/20" style={{ boxShadow: hand !== "none" ? `0 0 0 2px ${HAND_COLOR[hand]}, 0 0 16px 2px ${HAND_COLOR[hand]}88` : undefined }}>
        <span className="rounded-full px-2 text-[13px] leading-[22px] font-black" style={{ background: HAND_COLOR[hand], color: hand === "none" ? "#fff" : "#2a1600" }}>
          {h.name}
        </span>
        <span className="text-[12px] font-bold whitespace-nowrap text-white/90">
          {h.desc}
          {t.dbl && hand !== "none" ? " ×2" : ""}
        </span>
      </div>
      {/* 주사위 (+ 굴린 뒤 쓸 수 있는 스킬은 바로 옆) */}
      <div className="flex items-center gap-3">
      {dicePhase && !dieMode && skillOk && <div className="w-[84px] shrink-0" />}
      <div className="flex items-end gap-2.5 rounded-[20px] bg-[#1b1650]/55 px-3 pt-3 pb-1 ring-1 ring-white/15" style={{ boxShadow: "inset 0 2px 10px rgba(0,0,0,0.35)" }}>
        {tray.dice.map((v, i) => (
          <Die3D
            key={i}
            v={v}
            roll={tray.ids[i] ?? 0}
            held={!!myHeld[i]}
            pick={!!dieMode && !dieMode.picks.includes(i)}
            dim={!!dieMode && dieMode.picks.includes(i) && dieMode.for !== "copy" ? false : undefined}
            onClick={dicePhase && !busy ? () => (dieMode ? onDiePick(i) : canRe ? onHold(i) : undefined) : undefined}
            title={dicePhase ? (dieMode ? "이 주사위" : canRe ? (myHeld[i] ? "잠금 풀기" : "잠그기 (다시 굴릴 때 그대로)") : undefined) : undefined}
          />
        ))}
      </div>
      {dicePhase && !dieMode && skillOk && skillOrb(false)}
      </div>
      {dicePhase && !dieMode && canRe && !myHeld.some(Boolean) && <span className="-mt-1 rounded-full bg-black/40 px-2.5 text-[11px] leading-[18px] font-bold text-white/85">주사위를 누르면 잠겨요 · 잠근 건 다시 굴릴 때 그대로</span>}
      {modeBar}
      {dicePhase && !dieMode && (
        <>
          {/* 이동 고르기 */}
          {chosen && (
            <div className="flex items-center gap-1.5">
              {opts.length > 1 && (
                <button type="button" onClick={() => onSel(-1)} className="flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-full bg-white/90 text-[16px] font-black text-[#232a4d] shadow-[0_2px_0_rgba(0,0,0,0.3)] hover:bg-white" aria-label="이전 이동">
                  ‹
                </button>
              )}
              <div className="flex h-[36px] min-w-[200px] items-center justify-center gap-1.5 rounded-full bg-white px-3 text-[#232a4d] shadow-[0_3px_0_rgba(0,0,0,0.3)]" style={{ boxShadow: `0 0 0 2.5px ${PCOLOR[myPi]}, 0 3px 0 rgba(0,0,0,0.3)` }}>
                {chosen.jump ? (
                  <b className="text-[14px]">별로 순간이동!</b>
                ) : (
                  <>
                    {chosen.pick && chosen.pick.map((k) => <MiniDie key={k} v={tray.dice[k]} size={22} />)}
                    <b className="text-[17px]">{chosen.steps}칸</b>
                  </>
                )}
                <span className="text-[#9aa3b8]">→</span>
                <DestTag g={g} o={chosen} />
              </div>
              {opts.length > 1 && (
                <button type="button" onClick={() => onSel(1)} className="flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-full bg-white/90 text-[16px] font-black text-[#232a4d] shadow-[0_2px_0_rgba(0,0,0,0.3)] hover:bg-white" aria-label="다음 이동">
                  ›
                </button>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            {(t.rolls > 0 || (me?.uses.reroll ?? 0) > 0) && (
              <Btn tone="sky" className="h-[42px] px-4 text-[14px] font-black" disabled={sending || allHeld} onClick={onReroll} title={allHeld ? "다시 굴릴 주사위를 남겨 주세요" : "잠근 주사위는 그대로, 나머지를 다시 굴려요"}>
                <Glyph n="dice" size={18} color="#fff" />
                다시 굴리기
                <span className="rounded-full bg-black/25 px-1.5 text-[12px]">{t.rolls > 0 ? `${t.rolls}` : `판당 ${me?.uses.reroll}`}</span>
              </Btn>
            )}
            {me && me.uses.slide > 0 && !chosen?.jump && (
              <span className="flex items-center gap-0.5 rounded-full bg-white/15 p-[3px] ring-1 ring-white/25" title={`미끄럼 주사위: 한 칸 더 · 덜 (판당 ${me.uses.slide})`}>
                {[-1, 1].map((d) => (
                  <button key={d} type="button" onClick={() => onSlide(d)} className={`h-[30px] cursor-pointer rounded-full px-2 text-[12px] font-black ${slide === d ? "bg-[#7fe0c8] text-[#123]" : "text-white hover:bg-white/15"}`}>
                    {d > 0 ? "+1" : "−1"}
                  </button>
                ))}
              </span>
            )}
            <Btn tone="gold" className="h-[42px] min-w-[110px] px-5 text-[16px] font-black" disabled={sending || !chosen} onClick={onMove}>
              출발!
            </Btn>
          </div>
          {timeBar("dice")}
        </>
      )}
      {!dicePhase && pr && g.players[pr.p] && (
        <span className="rounded-full bg-[#1b1650]/80 px-3 text-[12px] leading-[24px] font-bold text-white/90 ring-1 ring-white/20">
          {g.players[pr.p].name} {thinking(pr)}
        </span>
      )}
    </>
  );
}

const HAND_COLOR: Record<HandId, string> = {
  none: "#6b7280",
  pair: "#9fdcff",
  two: "#7fe0c8",
  triple: "#b5a6ff",
  small: "#8fe08a",
  full: "#ff9ec7",
  large: "#ffb35a",
  four: "#ffd23a",
  yacht: "#ff6a2b",
};

function nudgeFaces(v: number, mag: number): number[] {
  const out: number[] = [];
  for (let d = -mag; d <= mag; d++) if (d && v + d >= 1 && v + d <= 6) out.push(v + d);
  return out;
}

/** 이동 고르기: 도착 칸 이름표 (별 사기 · 칸 종류) */
function DestTag({ g, o }: { g: GameWire; o: MoveOpt }) {
  const d = MAPS[g.map].tiles[o.dest];
  const k = KIND[d.kind];
  if (o.star)
    return (
      <span className="flex items-center gap-1 rounded-full bg-[#ffd23a] px-2 text-[13px] leading-[24px] font-black whitespace-nowrap text-[#4a2600]">
        <Glyph n="star" size={14} color="#fff" /> 별 사기!
      </span>
    );
  const x = g.frenzy ? 2 : 1;
  const val = d.kind === "blue" ? ` +${RULE.blue * x}` : d.kind === "red" ? ` −${RULE.red * x}` : d.kind === "jackpot" ? ` ${g.pot}` : "";
  const trap = g.traps[o.dest] >= 0;
  return (
    <span className="flex items-center gap-1 rounded-full px-2 text-[13px] leading-[24px] font-black whitespace-nowrap text-white" style={{ background: d.kind === "star" ? "#c9a03a" : k.fill }}>
      <Glyph n={k.glyph} size={14} color="#fff" />
      {k.label}
      {val}
      {trap && <Glyph n="trap" size={13} color="#fff" />}
    </span>
  );
}

/** 굴리기 버튼: 꾹 누르면 주사위가 손 안에서 흔들리다 놓으면 던짐 (스페이스바도 됨) */
function RollButton({ disabled, onThrow }: { disabled: boolean; onThrow(power?: number): void }) {
  const [hold, setHold] = useState(false);
  const t0 = useRef(0);
  const start = useCallback(() => {
    if (disabled || hold) return;
    setHold(true);
    sfx("click");
    t0.current = performance.now();
  }, [disabled, hold]);
  const release = useCallback(() => {
    if (!hold) return;
    setHold(false);
    const held = performance.now() - t0.current;
    onThrow(held < 160 ? undefined : Math.min(1, Math.round((held / 1200) * 100) / 100));
  }, [hold, onThrow]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        start();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") release();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [start, release]);
  return (
    <button
      type="button"
      disabled={disabled}
      className={`relative flex h-[118px] w-[118px] shrink-0 cursor-pointer flex-col items-center justify-center rounded-full text-[#3a2500] transition disabled:opacity-50 ${hold ? "mbx-shake-soft scale-95" : "hover:scale-105"}`}
      style={{ background: "radial-gradient(circle at 35% 30%, #fff6c0, #ffd23a 45%, #f59a1e)", boxShadow: "0 6px 0 #b86e00, 0 10px 22px rgba(0,0,0,0.45), inset 0 2px 0 rgba(255,255,255,0.7), 0 0 0 4px #fff" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <span className="flex gap-[3px]">
        {[3, 5, 1].map((v) => (
          <MiniDie key={v} v={v} size={20} />
        ))}
      </span>
      <span className="mt-1 text-[24px] leading-none font-black tracking-wide">{hold ? "놓으면!" : "ROLL"}</span>
      <span className="mt-0.5 text-[10px] font-bold opacity-75">주사위 5개 · 스페이스</span>
    </button>
  );
}

/* ───────────── 내 아이템 (왼쪽 아래 내 카드 위) ───────────── */

function ItemDock({ g, myPi, mine, pr, sending, onCard, onGear }: { g: GameWire; myPi: number; mine: boolean; pr: Prompt | null; sending: boolean; onCard(id: CardId): void; onGear(): void }) {
  const gg = g as unknown as Game;
  const me = g.players[myPi];
  const gold = mine && pr?.k === "dice" && me.uses.gold > 0;
  return (
    <div className="absolute bottom-[122px] left-[8px] z-[425] flex items-end gap-1.5 rounded-2xl bg-[#1b1650]/80 px-2 pt-1 pb-1.5 ring-1 ring-white/20 backdrop-blur-[2px]">
      <span className="mb-[14px] w-[14px] text-[10.5px] leading-[12px] font-black text-white/75 [writing-mode:vertical-rl]">아이템</span>
      {Array.from({ length: RULE.maxCards }, (_, k) => {
        const id = me.cards[k];
        if (!id)
          return (
            <span key={k} className="flex w-[52px] flex-col items-center gap-0.5">
              <span className="h-[44px] w-[44px] rounded-[10px] bg-white/[0.06] ring-1 ring-white/15 ring-inset" />
              <span className="text-[10px] leading-[12px] text-white/30">빈 칸</span>
            </span>
          );
        const why = mine ? cardBlock(gg, myPi, id) : "내 차례에 써요";
        const ok = !why && !sending;
        return (
          <button
            key={k}
            type="button"
            disabled={!ok}
            onClick={() => onCard(id)}
            title={`${CARDS[id].name} — ${CARDS[id].desc}${why ? ` (${why})` : ""}`}
            className={`relative flex w-[52px] cursor-pointer flex-col items-center gap-0.5 transition disabled:cursor-default ${ok ? "hover:-translate-y-1" : ""}`}
          >
            <span className={`rounded-[10px] ${ok ? "mbx-skill" : ""}`} style={{ opacity: ok || !mine ? 1 : 0.5 }}>
              <CardIcon id={id} size={44} />
            </span>
            <span className={`max-w-[56px] truncate text-[10px] leading-[12px] font-bold ${ok ? "text-[#ffe08a]" : "text-white/70"}`}>{CARDS[id].name}</span>
          </button>
        );
      })}
      {gold && (
        <button type="button" disabled={sending} onClick={onGear} title="장착한 황금 주사위: 주사위 하나를 원하는 눈으로" className="flex w-[52px] cursor-pointer flex-col items-center gap-0.5 transition hover:-translate-y-1">
          <span className="mbx-skill rounded-[10px]">
            <ItemIcon id="d_gold" size={44} />
          </span>
          <span className="text-[10px] leading-[12px] font-bold text-[#ffe08a]">황금 눈 {me.uses.gold}</span>
        </button>
      )}
    </div>
  );
}

/* ───────────── 상대 고르기 ───────────── */

function FoePick({
  g,
  coins,
  stars,
  title,
  opts,
  pull,
  onPick,
  onCancel,
  sending,
  left,
}: {
  g: GameWire;
  coins: number[];
  stars: number[];
  title: string;
  opts: number[];
  /** 끌어오기 최대 칸 (0 = 상대만 고름) */
  pull: number;
  onPick(q: number, n?: number): void;
  onCancel?(): void;
  sending: boolean;
  left: number;
}) {
  const [foe, setFoe] = useState<number | null>(null);
  const m = MAPS[g.map];
  return (
    <div className="absolute inset-0 z-[480] flex items-center justify-center">
      <div className="mbx-modal mbx-pop flex w-[420px] flex-col items-center gap-2.5 px-5 py-4">
        <b className="mb-title text-center text-[16px]">{title}</b>
        {pull > 0 && foe !== null ? (
          <>
            <span className="text-[12.5px] text-white/80">{g.players[foe].name} 말을 몇 칸 끌어올까요?</span>
            <div className="flex flex-wrap justify-center gap-1.5">
              {Array.from({ length: pull * 2 + 1 }, (_, k) => k - pull)
                .filter((d) => d !== 0)
                .map((d) => {
                  const slot = (g.players[foe].pos + d + 32) % 32;
                  const kd = m.tiles[slot].kind;
                  const trap = g.traps[slot] >= 0 && g.traps[slot] !== foe;
                  return (
                    <Btn key={d} tone={kd === "red" || kd === "trap" || trap ? "pink" : "paper"} className="h-[48px] min-w-[56px] flex-col !gap-0 px-2 text-[14px] font-black" disabled={sending} onClick={() => onPick(foe, d)}>
                      {d < 0 ? `뒤로 ${-d}` : `앞으로 ${d}`}
                      <span className="flex items-center gap-0.5 text-[10px] font-bold opacity-85">
                        <Glyph n={trap ? "trap" : KIND[kd].glyph} size={11} color={KIND[kd].fill} />
                        {trap ? "함정" : KIND[kd].label}
                      </span>
                    </Btn>
                  );
                })}
            </div>
          </>
        ) : (
          <div className="flex w-full flex-col gap-1.5">
            {opts.map((q) => {
              const p = g.players[q];
              const c = CHAR[p.lo.char.id];
              return (
                <button
                  key={q}
                  type="button"
                  disabled={sending}
                  onClick={() => (pull > 0 ? setFoe(q) : onPick(q))}
                  className="flex cursor-pointer items-center gap-2.5 rounded-xl bg-white/[0.08] px-3 py-2 text-left transition hover:bg-white/[0.16] disabled:opacity-50"
                  style={{ boxShadow: `inset 0 0 0 2px ${PCOLOR[q]}` }}
                >
                  {c && <img src={faceOf(c)} alt="" className="h-[40px] w-[40px] rounded-full object-cover" style={{ boxShadow: `0 0 0 2px ${PCOLOR[q]}` }} />}
                  <b className="min-w-0 flex-1 truncate text-[15px]">{p.name}</b>
                  <span className="flex items-center gap-1 text-[15px] font-black">
                    <Glyph n="star" size={16} color="#ffd23a" />
                    {stars[q]}
                  </span>
                  <span className="flex items-center gap-1 text-[14px] font-bold text-[#ffe08a]">
                    <Glyph n="coin" size={15} color="#ffd23a" />
                    {coins[q]}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {(onCancel || (pull > 0 && foe !== null)) && (
          <Btn className="h-[28px] px-3 text-[12px]" onClick={() => (pull > 0 && foe !== null ? setFoe(null) : onCancel?.())}>
            {pull > 0 && foe !== null ? "다시 고르기" : "취소"}
          </Btn>
        )}
        {left > 0 && (
          <div className="mb-bar w-full">
            <i style={{ width: `${Math.min(100, (left / LIMIT.foe) * 100)}%`, "--c": left < 3000 ? "#ff6b6b" : "#4fd1b5" } as CSSProperties} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────── 칸 정보 ───────────── */

function TileInfo({ g, slot, star, onClose }: { g: GameWire; slot: number; star: number; onClose(): void }) {
  const d = MAPS[g.map].tiles[slot];
  const k = KIND[d.kind];
  const trap = g.traps[slot];
  return (
    <div className="mbx absolute inset-0 z-[650] flex items-center justify-center bg-[rgba(10,8,30,0.55)]" onClick={onClose}>
      <div className="mbx-pop w-[360px] overflow-hidden rounded-2xl border border-white/15 bg-[#1b1650]/95 text-white shadow-[0_20px_50px_rgba(0,0,0,0.5)]" onClick={(e) => e.stopPropagation()}>
        <div className="relative flex items-center gap-3 px-4 pt-3 pb-3" style={{ background: `linear-gradient(135deg, ${k.fill}, ${dark2(k.fill)})` }}>
          <span className="flex h-[48px] w-[48px] items-center justify-center rounded-xl bg-black/20">
            <Glyph n={slot === star ? "star" : k.glyph} size={34} color="#fff" />
          </span>
          <div className="min-w-0">
            <div className="text-[11px] font-black tracking-[0.15em] text-white/85">{k.label}</div>
            <b className="block truncate text-[22px] leading-[28px] font-black" style={{ textShadow: "0 2px 0 rgba(38,43,82,0.4)" }}>
              {d.name}
            </b>
          </div>
          <button type="button" onClick={onClose} className="absolute top-3 right-3 flex h-[28px] w-[28px] items-center justify-center rounded-full bg-black/25 text-[16px] hover:bg-black/40" aria-label="닫기">
            ×
          </button>
        </div>
        <div className="flex flex-col gap-2 p-4 text-[13px] leading-[20px]">
          <p className="text-white/90">{k.desc}</p>
          {slot === star && <p className="rounded-xl bg-[#ffd23a]/15 px-3 py-2 font-bold text-[#ffe08a] ring-1 ring-[#ffd23a]/50">지금 별이 여기 있어요! 지나가기만 해도 {RULE.starPrice}코인에 사요</p>}
          {d.kind === "jackpot" && <p className="font-bold text-[#ffe08a]">지금 잭팟 {g.pot}코인</p>}
          {trap >= 0 && (
            <p className="rounded-xl bg-white/[0.08] px-3 py-2">
              <b style={{ color: PCOLOR[trap] }}>{g.players[trap]?.name}</b> 의 함정 — 다른 사람이 서면 {RULE.trapFee}코인을 내요
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
const dark2 = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(v * 0.72);
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

/* ───────────── 띠 · 컷인 · 카드 ───────────── */

/** 스킬 컷인: 번쩍 → 비스듬한 띠 + 속도선 → 캐릭터가 미끄러져 들어옴 */
function SkillCutin({ b }: { b: Banner }) {
  const g = b.grade ?? "R";
  const rays = g === "SSR" || g === "UR";
  return (
    <div className="pointer-events-none absolute inset-0 z-[630]" style={{ "--d": `${b.ms}ms` } as CSSProperties}>
      <div className="mbx-flash absolute inset-0" />
      <div className="mbx-cut absolute inset-x-[-40px] top-[170px] h-[210px] overflow-hidden" style={{ transform: "skewY(-5deg)", boxShadow: "0 -5px 0 0 #fff, 0 5px 0 0 #fff, 0 -9px 0 0 #232a4d, 0 9px 0 0 #232a4d" }}>
        <img src={`/marble/art/bg-${g}.webp`} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: "center 30%" }} />
        {g === "R" && <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${b.color}88, transparent)` }} />}
        {rays && <div className={`mbx-rays mbx-rays-${g}`} style={{ left: "26%", top: "50%" }} />}
        <div className="mbx-speed absolute inset-0" />
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[rgba(18,13,51,0.55)]" />
      </div>
      {b.art && <img src={b.art} alt="" className="mbx-slide absolute left-[40px] max-w-none object-contain" style={{ top: 96, height: 300, width: 320, filter: "drop-shadow(0 6px 0 rgba(35,42,77,0.5))" }} />}
      <div className="mbx-slide-r absolute top-[222px] right-[70px] max-w-[520px] text-right">
        {g !== "R" && <div className="mb-1 inline-block rounded bg-black/40 px-2 text-[13px] font-black tracking-[0.3em] text-white">{g} SKILL</div>}
        <div className="mb-title text-[46px] leading-[50px] text-white" style={{ WebkitTextStroke: "3px #232a4d", paintOrder: "stroke fill", textShadow: "0 4px 0 #232a4d" }}>
          {b.title}
        </div>
        {b.sub && <div className="mb-out mt-1 text-[16px] text-white">{b.sub}</div>}
        {(b.desc || b.target) && (
          <div className="mt-2 flex flex-col items-end gap-1.5">
            {b.target && <span className="rounded-full bg-[#ffd23a] px-3 text-[18px] leading-[30px] font-black text-[#3a2500] shadow-[0_3px_0_#232a4d]">{b.target}</span>}
            {b.desc && <span className="max-w-[460px] rounded-lg bg-[rgba(20,14,60,0.82)] px-3 py-1 text-[14px] leading-[20px] font-bold [text-wrap:balance] text-white ring-1 ring-white/20 [word-break:keep-all]">{b.desc}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function BannerView({ b }: { b: Banner }) {
  if (b.art) return <SkillCutin b={b} />;
  return (
    <div className="mbx pointer-events-none absolute inset-x-0 top-[96px] z-[620] flex justify-center" style={{ "--d": `${b.ms}ms` } as CSSProperties}>
      <div className="mbx-banner relative flex h-[104px] w-full items-center justify-center overflow-hidden" style={{ background: `linear-gradient(90deg, transparent, ${b.color}e6 18%, ${b.color} 50%, ${b.color}e6 82%, transparent)` }}>
        <div className="mbx-rays mbx-soft absolute" style={{ left: "50%", top: "50%", "--ray": "rgba(255,255,255,0.45)", opacity: 0.5 } as CSSProperties} />
        <div className="mbx-sheen absolute inset-0 opacity-60" />
        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: "linear-gradient(90deg, transparent, #fff, transparent)" }} />
        <div className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: "linear-gradient(90deg, transparent, #fff, transparent)" }} />
        <div className="mbx-banner-text relative text-center">
          <div className="text-[42px] leading-[46px] font-black tracking-tight text-white" style={{ textShadow: `0 3px 0 rgba(38,43,82,0.6), 0 0 22px ${b.color}` }}>
            {b.title}
          </div>
          {b.sub && (
            <div className="mt-0.5 text-[15px] font-bold text-white/95" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.5)" }}>
              {b.sub}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 족보 이름: 주사위 접시 위로 크게 튀어나옴 */
function HandPop({ hand, x2, color }: { hand: HandId; x2?: boolean; color: string }) {
  const h = HANDS[hand];
  const big = hand === "four" || hand === "large" || hand === "full";
  return (
    <div className="pointer-events-none absolute z-[615] flex flex-col items-center" style={{ left: TRAY.x, top: TRAY.y - 96, transform: "translateX(-50%)" }}>
      {big && <div className="mbx-up-rays mbx-soft absolute top-1/2 left-1/2 h-[360px] w-[360px]" style={{ "--ray": `${HAND_COLOR[hand]}cc`, opacity: 0.55 } as CSSProperties} />}
      <div className="mbx-hand relative flex flex-col items-center">
        <span className="text-[44px] leading-[48px] font-black whitespace-nowrap text-white" style={{ WebkitTextStroke: "4px #232a4d", paintOrder: "stroke fill", textShadow: `0 4px 0 #232a4d, 0 0 26px ${HAND_COLOR[hand]}` }}>
          {h.name}!{x2 ? " ×2" : ""}
        </span>
        <span className="mt-1 rounded-full px-3 text-[15px] leading-[28px] font-black whitespace-nowrap text-[#2a1600]" style={{ background: HAND_COLOR[hand], boxShadow: `0 0 0 2.5px #fff, 0 0 0 4px ${color}, 0 3px 0 rgba(0,0,0,0.3)` }}>
          {h.desc}
        </span>
      </div>
    </div>
  );
}

/** 야추: 화면 가득 — 빛살 · 주사위 다섯 · 별 */
function YachtCutin({ name, char, x2 }: { name: string; char: string; x2?: boolean }) {
  const c = CHAR[char];
  return (
    <div className="mbx pointer-events-none absolute inset-0 z-[640] flex items-center justify-center overflow-hidden" style={{ background: "radial-gradient(circle, rgba(255,140,40,0.55), rgba(40,10,60,0.85))" }}>
      <div className="mbx-flash absolute inset-0" />
      <div className="mbx-up-rays mbx-soft absolute top-1/2 left-1/2 h-[1100px] w-[1100px]" style={{ "--ray": "rgba(255,220,110,0.9)", opacity: 0.8 } as CSSProperties} />
      {c && <img src={artOf(c)} alt="" className="mbx-slide absolute bottom-[-20px] left-[30px] h-[360px] max-w-none object-contain opacity-90" style={{ filter: "drop-shadow(0 6px 0 rgba(35,42,77,0.5))" }} />}
      <div className="relative flex flex-col items-center">
        <div className="mbx-up-title text-[120px] leading-[120px] font-black tracking-tight" style={{ color: "#ffe14a", WebkitTextStroke: "6px #3a1d6e", paintOrder: "stroke fill", textShadow: "0 8px 0 #3a1d6e, 0 0 40px rgba(255,200,60,0.9)" }}>
          YACHT!
        </div>
        <div className="mt-2 flex items-center gap-2">
          {[0, 1, 2, 3, 4].map((k) => (
            <span key={k} className="mbx-up-star" style={{ animationDelay: `${300 + k * 90}ms` }}>
              <Glyph n="dice" size={44} color="#fff" />
            </span>
          ))}
        </div>
        <div className="mbx-up-sub mt-3 flex items-center gap-2 rounded-full bg-[#ffd23a] px-5 text-[24px] leading-[44px] font-black text-[#3a2500]" style={{ boxShadow: "0 0 0 4px #fff, 0 6px 0 rgba(0,0,0,0.3)" }}>
          <Glyph n="star" size={28} color="#fff" /> {name} · 별 +{x2 ? 2 : 1}
        </div>
      </div>
    </div>
  );
}

/** 별이 A 에서 B 로 날아감 */
function FlyStar({ a, b }: { a: { x: number; y: number }; b: { x: number; y: number } }) {
  return (
    <div className="mbx-fly-star pointer-events-none absolute z-[560]" style={{ left: a.x, top: a.y, "--dx": `${b.x - a.x}px`, "--dy": `${b.y - a.y}px` } as CSSProperties}>
      <div style={{ filter: "drop-shadow(0 0 14px rgba(255,214,60,0.95))" }}>
        <Glyph n="star" size={52} color="#ffd23a" />
      </div>
    </div>
  );
}

/** 럭키 박스 아이템 카드 */
function ItemPop({ id, name }: { id: CardId; name: string }) {
  const c = CARDS[id];
  return (
    <div className="mbx pointer-events-none absolute inset-0 z-[610] flex items-center justify-center" style={{ background: "radial-gradient(circle, rgba(10,8,30,0.2), rgba(10,8,30,0.5))" }}>
      <div className="mbx-up-rays mbx-soft absolute top-1/2 left-1/2 h-[520px] w-[520px]" style={{ "--ray": "#ffd84dcc", opacity: 0.55 } as CSSProperties} />
      <div className="mbx-card-in relative flex h-[250px] w-[190px] flex-col items-center overflow-hidden rounded-[18px] p-[4px]" style={{ background: "linear-gradient(160deg, #fff6c8, #ffd84d 40%, #ff9f2e)", boxShadow: "0 0 0 2px #262b52, 0 0 36px 6px #ffd84daa, 0 14px 30px rgba(0,0,0,0.5)" }}>
        <div className="relative flex h-full w-full flex-col items-center rounded-[14px] px-3 pt-3 pb-3 text-center" style={{ background: "linear-gradient(180deg, #2a2470, #171245)" }}>
          <span className="text-[10px] font-black tracking-[0.3em] text-[#ffd76a]">ITEM</span>
          <div className="mt-2">
            <CardIcon id={id} size={72} />
          </div>
          <b className="mt-3 text-[20px] leading-[24px] font-black text-white">{c.name}</b>
          <span className="mt-1.5 text-[12.5px] leading-[17px] font-bold text-[#ffe8a0] [word-break:keep-all]">{c.desc}</span>
          <span className="mt-auto text-[11px] text-white/60">{name}</span>
        </div>
      </div>
    </div>
  );
}

/** 마을 소식 카드 */
function EventPop({ id, alt, name }: { id: keyof typeof EVENTS; alt?: keyof typeof EVENTS; name: string }) {
  const e = EVENTS[id];
  const good = e.v > 0;
  const c1 = good ? "#7fe0c8" : e.v < 0 ? "#ff6b8a" : "#9fdcff";
  return (
    <div className="mbx pointer-events-none absolute inset-0 z-[610] flex items-center justify-center" style={{ background: "radial-gradient(circle, rgba(10,8,30,0.25), rgba(10,8,30,0.6))" }}>
      <div className="mbx-up-rays mbx-soft absolute top-1/2 left-1/2 h-[560px] w-[560px]" style={{ "--ray": `${c1}cc`, opacity: 0.55 } as CSSProperties} />
      <div className="mbx-card-in relative flex h-[280px] w-[220px] flex-col items-center overflow-hidden rounded-[18px] p-[4px]" style={{ background: `linear-gradient(160deg, #ffffff, ${c1} 45%, ${dark2(c1)})`, boxShadow: `0 0 0 2px #262b52, 0 0 36px 6px ${c1}aa, 0 14px 30px rgba(0,0,0,0.5)` }}>
        <div className="relative flex h-full w-full flex-col items-center rounded-[14px] px-4 pt-3 pb-4 text-center" style={{ background: "linear-gradient(180deg, #1f4a5a, #12283a)" }}>
          <span className="text-[11px] font-black tracking-[0.3em]" style={{ color: c1 }}>
            마을 소식
          </span>
          <div className="mt-3">
            <Glyph n="ask" size={64} color={c1} />
          </div>
          <b className="mt-2 text-[22px] leading-[26px] font-black text-white">{e.name}</b>
          <span className="mt-2 text-[13px] leading-[18px] font-bold text-white/90 [word-break:keep-all]">{e.desc}</span>
          {alt && <span className="mt-1.5 text-[11px] text-white/55">행운 고양이: 「{EVENTS[alt].name}」 대신 골랐어요</span>}
          <span className="mt-auto text-[12px] text-white/60">{name}</span>
        </div>
      </div>
    </div>
  );
}

/** VS 대결: 두 사람 얼굴 · 주사위 두 개씩 · 승자 */
function VsPop({ e, g }: { e: Extract<Ev, { t: "vs" }>; g: GameWire }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setShow(true), 1100);
    return () => clearTimeout(id);
  }, []);
  const side = (pi: number, d: [number, number]) => {
    const p = g.players[pi];
    const c = CHAR[p?.lo.char.id ?? "kai"];
    const win = show && e.win === pi;
    const lose = show && e.win >= 0 && e.win !== pi;
    return (
      <div className="flex w-[200px] flex-col items-center gap-2" style={{ opacity: lose ? 0.55 : 1, transition: "opacity 300ms" }}>
        <div className="relative">
          {c && <img src={faceOf(c)} alt="" className="h-[96px] w-[96px] rounded-full object-cover" style={{ boxShadow: `0 0 0 4px #fff, 0 0 0 7px ${PCOLOR[pi]}` }} />}
          {win && (
            <span className="mb-pop absolute -top-[22px] left-1/2 -translate-x-1/2">
              <Glyph n="crown" size={36} color="#ffd23a" />
            </span>
          )}
        </div>
        <b className="max-w-[180px] truncate text-[16px] text-white">{p?.name}</b>
        <div className="flex gap-2">
          {show ? (
            d.map((v, k) => <MiniDie key={k} v={v} size={40} />)
          ) : (
            <>
              <span className="mbx-shake-soft">
                <MiniDie v={5} size={40} />
              </span>
              <span className="mbx-shake-soft">
                <MiniDie v={3} size={40} />
              </span>
            </>
          )}
        </div>
        {show && <b className="text-[28px] leading-none text-white" style={{ textShadow: "0 3px 0 #232a4d" }}>{d[0] + d[1]}</b>}
      </div>
    );
  };
  return (
    <div className="mbx pointer-events-none absolute inset-0 z-[610] flex items-center justify-center bg-[rgba(10,8,30,0.6)]">
      <div className="mbx-pop flex items-center gap-4 rounded-3xl bg-[#1b1650]/90 px-6 py-5 ring-2 ring-[#ff9a3d]">
        {side(e.p, e.a)}
        <div className="flex flex-col items-center">
          <span className="text-[44px] font-black text-[#ff9a3d]" style={{ WebkitTextStroke: "3px #232a4d", paintOrder: "stroke fill" }}>
            VS
          </span>
          {show && <span className="text-[13px] font-bold whitespace-nowrap text-white/85">{e.win < 0 ? "무승부!" : `${e.amt}코인!`}</span>}
        </div>
        {side(e.q, e.b)}
      </div>
    </div>
  );
}

/* ───────────── 결과 ───────────── */

function Result({ room, me, onLeave }: { room: RoomWire; me: string; onLeave(): void }) {
  const g = room.game!;
  const mine = room.result!.find((r) => room.seats[r.seat]?.uid === me);
  useEffect(() => {
    if (mine?.place === 1) playBgm("win");
    else {
      stopBgm();
      sfx("lose");
    }
  }, [mine?.place]);
  const myPi = mine ? room.order.indexOf(mine.seat) : -1;
  const st = myPi >= 0 ? g.players[myPi].stat : null;
  return (
    <div className="absolute inset-0 z-[700] flex items-center justify-center bg-[rgba(35,42,77,0.45)]">
      <div className="mbx-modal mb-pop w-[480px] px-5 py-4">
        <div className="text-center">
          <div className="mb-title mb-out text-[34px] text-white" style={{ color: mine?.place === 1 ? "#ffc94a" : "#fff" }}>
            {mine ? (mine.place === 1 ? "승리!" : `${mine.place}등`) : "판 끝"}
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          {room.result!.map((r) => {
            const pi = room.order.indexOf(r.seat);
            const p = g.players[pi];
            return (
              <div key={r.seat} className="mb-inset flex items-center gap-2 px-2 py-1.5" style={{ "--bg": `${PCOLOR[pi]}40` } as CSSProperties}>
                <b className="w-[30px] text-center text-[18px]">{r.place}</b>
                <img src={faceOf(CHAR[p.lo.char.id] ?? CHAR.kai)} alt="" className="h-[34px] w-[34px] rounded-md object-cover" style={{ boxShadow: "0 0 0 2px #232a4d" }} />
                <b className="min-w-0 flex-1 truncate text-[14px]">
                  {r.bot && <Icon n="bot" size={12} />} {r.name}
                </b>
                <span className="flex items-center gap-1 text-[16px] font-black">
                  <Glyph n="star" size={16} color="#ffd23a" />
                  {p.stars}
                </span>
                <span className="flex w-[54px] items-center justify-end gap-1 text-[13px] font-bold text-[#ffe08a]">
                  <Glyph n="coin" size={13} color="#ffd23a" />
                  {p.coins}
                </span>
                {r.stars !== undefined && (
                  <span className="mb-chip text-[12px]" style={{ "--c": "#ffe1ef" } as CSSProperties}>
                    <Cur k="star" n={`+${r.stars}`} size={12} />
                    {r.first && <span className="text-[10px]">첫 승!</span>}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {st && (
          <div className="mt-3 grid grid-cols-5 gap-1 text-center">
            {(
              [
                ["번 코인", st.earned],
                ["산 별", st.bought],
                ["최고 족보", HANDS[st.best].name],
                ["움직인 칸", st.moved],
                ["스킬", st.skill],
              ] as [string, ReactNode][]
            ).map(([k, v]) => (
              <div key={k} className="mb-inset rounded-lg px-1 py-1.5">
                <div className="text-[10px] text-[var(--mute)]">{k}</div>
                <b className="text-[13px] whitespace-nowrap">{v}</b>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-center gap-2">
          <span className="self-center text-[12px] text-[var(--mute)]">잠시 뒤 대기실로 돌아가요</span>
          <Btn className="h-[40px] px-4 text-[14px]" onClick={onLeave}>
            나가기
          </Btn>
        </div>
      </div>
    </div>
  );
}

/** 판 시작: 내 순번 (사다리 결과) */
function OrderIntro({ pi, n }: { pi: number; n: number }) {
  return (
    <div className="mbx pointer-events-none absolute inset-0 z-[640] flex items-center justify-center bg-[rgba(10,8,30,0.66)] backdrop-blur-[2px]">
      <div className="mbx-pop flex flex-col items-center">
        <div className="text-[14px] font-black tracking-[0.3em] text-[#ffe08a]" style={{ textShadow: "0 2px 0 #232a4d" }}>
          내 순서
        </div>
        <div className="flex items-baseline gap-2 text-white" style={{ WebkitTextStroke: "4px #232a4d", paintOrder: "stroke fill", textShadow: "0 5px 0 #232a4d" }}>
          <b className="text-[88px] leading-[96px]" style={{ color: PCOLOR[pi] }}>
            {pi + 1}
          </b>
          <b className="text-[40px]">번째</b>
        </div>
        <span className="mt-1 rounded-full px-4 text-[16px] leading-[30px] font-black text-white" style={{ background: PCOLOR[pi], boxShadow: "0 0 0 2.5px #fff, 0 4px 0 rgba(0,0,0,0.3)" }}>
          {pi + 1}P · {n}명 중
        </span>
      </div>
    </div>
  );
}

/** 남의 차례: 뭘 하는 중인지 */
function thinking(pr: Prompt): string {
  switch (pr.k) {
    case "turn":
      return "주사위 굴리는 중…";
    case "dice":
      return "주사위 고르는 중…";
    case "foe":
      return pr.why === "steal" ? "뺏을 상대 고르는 중…" : "대결 상대 고르는 중…";
    case "warp":
      return "워프할 곳 고르는 중…";
    case "more":
      return "몇 칸 더 갈지 고르는 중…";
  }
}

/** 못 함 · 오류: 화면 가운데 위쪽 작은 창 (흐름은 안 막고 사라짐) */
function NopeToast({ why }: { why: string }) {
  return (
    <div className="pointer-events-none absolute top-[118px] left-1/2 z-[615] -translate-x-1/2">
      <div className="mbx-pop mbx-modal flex min-w-[240px] items-center gap-2 px-5 py-2.5 text-center">
        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#ff6b6b] text-[12px] font-black text-white">!</span>
        <span className="text-[13px] font-bold text-white">{why}</span>
      </div>
    </div>
  );
}

/** 한 번 터지는 이펙트 (쾅 · 고리 · 금화 · 쿨쿨 · 별) */
function FxView({ f }: { f: Fx }) {
  const base = { left: f.x, top: f.y, animationDelay: `${f.delay ?? 0}ms` } as CSSProperties;
  if (f.k === "coin")
    return <span className="mbx-fx-coin pointer-events-none absolute z-[505] block h-[14px] w-[14px] rounded-full" style={{ ...base, "--dx": `${f.dx ?? 0}px`, "--dy": `${f.dy ?? 0}px`, background: "radial-gradient(circle at 35% 30%, #fff6c0, #ffc93a 55%, #d98e0b)", boxShadow: "0 0 0 1.5px #8a5a00" } as CSSProperties} />;
  if (f.k === "ring") return <span className="mbx-fx-ring pointer-events-none absolute z-[505] block h-[60px] w-[60px] rounded-full" style={{ ...base, boxShadow: "0 0 0 4px #fff, 0 0 18px 6px rgba(255,255,255,0.8)" }} />;
  if (f.k === "zzz")
    return (
      <span className="mbx-fx-zzz pointer-events-none absolute z-[505] text-[30px] font-black text-white" style={{ ...base, WebkitTextStroke: "3px #5b6bd6", paintOrder: "stroke fill" }}>
        Zzz
      </span>
    );
  if (f.k === "star")
    return <span className="mbx-fx-ring pointer-events-none absolute z-[505] block h-[70px] w-[70px] rounded-full" style={{ ...base, boxShadow: "0 0 0 5px #ffd23a, 0 0 24px 8px rgba(255,210,60,0.9)" }} />;
  return (
    <svg className="mbx-fx-boom pointer-events-none absolute z-[505]" style={base} width="110" height="110" viewBox="-55 -55 110 110" aria-hidden>
      <path d="M0-50 L12-18 L46-24 L22 2 L44 30 L10 22 L0 52 L-10 22 L-44 30 L-22 2 L-46-24 L-12-18 Z" fill="#ffd23a" stroke="#ff4b3d" strokeWidth="4" strokeLinejoin="round" />
      <circle r="14" fill="#fff" />
    </svg>
  );
}
