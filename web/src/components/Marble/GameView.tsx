"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { serverNow } from "@/lib/api/socket";
import { CHAR, ITEM, MATCH_STARS, SKILL_TARGET, artOf, faceOf, power } from "@/lib/marble/data";
import {
  CARDS,
  LANDMARK,
  RULE,
  LEVEL_NAME,
  TOWN_EVENTS,
  assetsOf,
  baseToll,
  investedOf,
  canSkill,
  controlChance,
  powerZone,
  skillRange,
  skillTargets,
  tollOf,
  type Action,
  type Ev,
  type Game,
  type Prompt,
} from "@/lib/marble/engine";
import { MAPS } from "@/lib/marble/maps";
import type { GameWire, RoomWire } from "@/lib/marble/wire";
import { marble } from "@/realtime/marble";
import { playBgm, sfx, stopBgm } from "./audio";
import { ItemIcon } from "./Gacha";
import { CharHero, XGrade } from "./ui";
import Board, { iso, slotXY as slotPos, spriteOf, type TokenView } from "./Board";
import { Btn, Cur, DiceFace, GradeTag, Icon, PCOLOR, fmt, CurIcon } from "./pixel";
import { GuideDot, useMapGuide } from "./MapGuide";
import { RoomTools } from "./Room";
import Token, { type TokenAnim } from "./Token";

/*
 * 판 화면 — 서버가 보낸 방 상태(RoomWire)의 ev 를 하나씩 연출하고(주사위 · 이동 · 돈 · 건설 · 카드 · 스킬 · 소식),
 * 연출이 다 끝나면 지금 상태로 맞춘 뒤 내 차례면 고르기 창을 보여 줌.
 * 연출 길이는 서버 animMs(server/src/games/marble) 와 같게 — 서버는 그만큼 기다렸다가 AI 를 두게 하고 사람 시간을 셈.
 */


interface Floater {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
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
}

let fid = 0;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function GameView({ room, me, onLeave }: { room: RoomWire; me: string; onLeave(): void }) {
  const g0 = room.game!;
  const map = MAPS[g0.map];
  /* ── 화면에 보이는 상태 (연출 동안 엔진보다 늦게 따라감) ── */
  const [view, setView] = useState<GameWire>(g0);
  const [pos, setPos] = useState<number[]>(() => g0.players.map((p) => p.pos));
  const [anim, setAnim] = useState<TokenAnim[]>(() => g0.players.map(() => "idle"));
  const [hide, setHide] = useState<boolean[]>(() => g0.players.map(() => false));
  const [train, setTrain] = useState<{ id: number; pts: { x: number; y: number }[]; pi: number } | null>(null);
  const [face, setFace] = useState<(1 | -1)[]>(() => g0.players.map(() => 1));
  const [hop, setHop] = useState<number[]>(() => g0.players.map(() => 0));
  const [cash, setCash] = useState<number[]>(() => g0.players.map((p) => p.cash));
  const [dice, setDice] = useState<DiceView | null>(null);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [card, setCard] = useState<{ id: keyof typeof CARDS; p: number } | null>(null);
  const [flash, setFlash] = useState<Record<number, string>>({});
  const [, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState<number | null>(null);
  /** 받은 방 상태 (연출 대기열) */
  const queue = useRef<RoomWire[]>([]);
  const running = useRef(false);
  const lastSeq = useRef(room.seq);
  const [live, setLive] = useState<RoomWire>(room);

  const order = room.order;
  const myPi = useMemo(() => order.findIndex((si) => room.seats[si]?.uid === me), [order, room.seats, me]);
  const nameOf = useCallback((pi: number) => view.players[pi]?.name ?? "?", [view.players]);

  /* ── 좌표 (무대 기준) ── */
  const slotXY = (slot: number) => {
    const c = slotPos(map, slot);
    return { x: c.x, y: c.y - 30 };
  };
  const diceAt = { x: iso(4, 4).x, y: iso(4, 4).y + 52 };
  const cardXY = (pi: number) => {
    const n = view.players.length;
    const c = cornerRect(myPi >= 0 ? (pi - myPi + n) % n : pi);
    return { x: c.x + 150, y: c.y + 30 };
  };
  const float = (x: number, y: number, text: string, color = "#232a4d") => {
    const f = { id: ++fid, x, y, text, color };
    setFloaters((a) => [...a.slice(-14), f]);
    setTimeout(() => setFloaters((a) => a.filter((o) => o.id !== f.id)), 1200);
  };
  const say = (s: string) => setLog((l) => [...l.slice(-5), s]);

  /* ── 연출 하나 ── */
  const playEv = async (e: Ev, cur: GameWire) => {
    const P = (pi: number) => cur.players[pi]?.name ?? "?";
    switch (e.t) {
      case "turn":
        if (e.p === myPi) sfx("turn");
        return;
      case "roll": {
        // 힘 조절로 던졌으면 굴린 사람 카드 쪽에서 날아와 굴러감 (세게 던질수록 빠르고 많이 돎)
        const thrown = e.power !== undefined;
        const dur = thrown ? Math.round(950 - (e.power ?? 0) * 300) : 700;
        const from = thrown ? cardXY(e.p) : null;
        setDice({ d: e.d, roll: ++fid, p: e.p, dur, from: from ? { x: from.x - diceAt.x, y: from.y - diceAt.y } : null, spin: thrown ? 2 + Math.round((e.power ?? 0) * 4) : 1 });
        sfx("dice");
        // 굴린 결과는 잠깐만 보여 주고 치움 (다음 ROLL 버튼 · 스킬과 안 겹치게)
        {
          const id = fid;
          setTimeout(() => setDice((d) => (d && d.roll === id ? null : d)), dur + 2600);
        }
        await wait(dur);
        if (e.ctrl) {
          sfx("card");
          float(diceAt.x, diceAt.y + 40, `힘 조절 성공! ${ZONE_NAME[powerZone(e.power ?? 0.5)]}`, "#ff7a2e");
        }
        say(`${P(e.p)} 주사위 ${e.d[0]}+${e.d[1]}${e.dbl ? " 더블!" : ""}${e.how === "pick" ? " (골라 굴림)" : e.how === "reroll" ? " (다시 굴림)" : ""}`);
        if (e.dbl) float(slotXY(posRef.current[e.p]).x, slotXY(posRef.current[e.p]).y - 40, "더블!", "#e0558c");
        await wait(400);
        return;
      }
      case "move": {
        if (e.rail) {
          // 십자 철로: 출발 역 → 중앙역 → 도착 역으로 열차가 달림
          const fromS = posRef.current[e.p];
          const toS = e.path[e.path.length - 1];
          const a = slotPos(map, fromS);
          const b = slotPos(map, toS);
          const c = iso(4, 4);
          sfx("warp");
          setTrain({ id: ++fid, pts: [a, c, b], pi: e.p });
          setAnim((x) => x.map((v, i) => (i === e.p ? "walk" : v)));
          setHide((h) => h.map((v, i) => (i === e.p ? true : v)));
          await wait(1100);
          setPosOf(e.p, toS);
          setHide((h) => h.map((v, i) => (i === e.p ? false : v)));
          setTrain(null);
          setAnim((x) => x.map((v, i) => (i === e.p ? "idle" : v)));
          await wait(150);
          return;
        }
        if (e.warp) {
          setAnim((a) => a.map((x, i) => (i === e.p ? "win" : x)));
          sfx("warp");
          await wait(300);
          setPosOf(e.p, e.path[e.path.length - 1]);
          await wait(400);
          setAnim((a) => a.map((x, i) => (i === e.p ? "idle" : x)));
          return;
        }
        setAnim((a) => a.map((x, i) => (i === e.p ? "walk" : x)));
        await wait(120);
        for (const s of e.path) {
          const from = map.tiles[posRef.current[e.p]];
          const to = map.tiles[s];
          const dx = to.x - from.x;
          if (dx) setFace((f) => f.map((x, i) => (i === e.p ? (dx > 0 ? 1 : -1) : x)));
          setPosOf(e.p, s);
          setHop((h) => h.map((x, i) => (i === e.p ? x + 1 : x)));
          sfx("step");
          await wait(210);
        }
        setAnim((a) => a.map((x, i) => (i === e.p ? "idle" : x)));
        await wait(130);
        return;
      }
      case "salary": {
        setCash((c) => c.map((x, i) => (i === e.p ? x + e.amt : x)));
        const c = cardXY(e.p);
        float(c.x, c.y, `+${fmt(e.amt)}`, "#2f8a3a");
        sfx("coin");
        await wait(300);
        return;
      }
      case "pay": {
        setCash((c) => c.map((x, i) => (i === e.from ? x - e.amt : i === e.to ? x + e.amt : x)));
        const a = cardXY(e.from);
        float(a.x, a.y, `-${fmt(e.amt)}`, "#d43a3a");
        if (e.to >= 0) {
          const b = cardXY(e.to);
          float(b.x, b.y, `+${fmt(e.amt)}`, "#2f8a3a");
        }
        if (e.tile !== undefined) float(slotXY(slotOfTile(cur, e.tile)).x, slotXY(slotOfTile(cur, e.tile)).y - 30, `${e.why} ${fmt(e.amt)}${e.shock ? " ⚡" : ""}`, "#d43a3a");
        setShake(e.from);
        setAnim((x) => x.map((v, i) => (i === e.from && e.amt >= 300 ? "hit" : v)));
        sfx("pay");
        say(`${P(e.from)} → ${e.to >= 0 ? P(e.to) : "은행"} ${fmt(e.amt)} (${e.why}${e.shock ? " · 감전!" : ""})`);
        await wait(650);
        setShake(null);
        setAnim((x) => x.map((v, i) => (i === e.from && v === "hit" ? "idle" : v)));
        return;
      }
      case "buy": {
        patchTile(e.tile, { owner: e.p, lv: e.lv });
        setCash((c) => c.map((x, i) => (i === e.p ? x - e.cost : x)));
        flashTile(e.tile, PCOLOR[e.p]);
        const xy = slotXY(slotOfTile(cur, e.tile));
        float(xy.x, xy.y - 30, e.lv >= LANDMARK ? "랜드마크!" : e.cost === 0 ? `${LEVEL_NAME[e.lv]} (무료)` : LEVEL_NAME[e.lv], PCOLOR[e.p]);
        sfx(e.lv >= LANDMARK ? "landmark" : "build");
        say(`${P(e.p)} ${MAPS[cur.map].tiles[e.tile].name} ${LEVEL_NAME[e.lv]}${e.cost ? ` (${fmt(e.cost)})` : ""}`);
        await wait(800);
        return;
      }
      case "acq": {
        patchTile(e.tile, { owner: e.p });
        setCash((c) => c.map((x, i) => (i === e.p ? x - e.cost : i === e.from ? x + e.cost : x)));
        flashTile(e.tile, PCOLOR[e.p]);
        const xy = slotXY(slotOfTile(cur, e.tile));
        float(xy.x, xy.y - 30, "인수!", PCOLOR[e.p]);
        sfx("acquire");
        say(`${P(e.p)} ← ${P(e.from)} ${MAPS[cur.map].tiles[e.tile].name} 인수 (${fmt(e.cost)})`);
        await wait(800);
        return;
      }
      case "block": {
        const xy = slotXY(slotOfTile(cur, e.tile));
        float(xy.x, xy.y - 30, "경비견이 막았어요!", "#2f5fc4");
        sfx("deny");
        await wait(800);
        return;
      }
      case "sell": {
        patchTile(e.tile, { owner: -1, lv: 0 });
        setCash((c) => c.map((x, i) => (i === e.p ? x + e.got : x)));
        const xy = slotXY(slotOfTile(cur, e.tile));
        float(xy.x, xy.y - 30, `팔림 +${fmt(e.got)}`, "#8c7259");
        await wait(300);
        return;
      }
      case "card":
        setCard({ id: e.card, p: e.p });
        sfx("card");
        say(`${P(e.p)} 럭키 박스 「${CARDS[e.card].name}」`);
        await wait(1700);
        setCard(null);
        return;
      case "jail":
        sfx("jail");
        float(slotXY(posRef.current[e.p]).x, slotXY(posRef.current[e.p]).y - 40, `수리소 ${e.turns}턴`, "#5a6b7a");
        await wait(800);
        return;
      case "free":
        float(slotXY(posRef.current[e.p]).x, slotXY(posRef.current[e.p]).y - 40, e.why === "수리비" ? "수리 끝!" : "탈출!", "#2f8a3a");
        await wait(300);
        return;
      case "fest":
        flashTile(e.tile, "#b58cff");
        sfx("fest");
        say(`${P(e.p)} ${MAPS[cur.map].tiles[e.tile].name}에서 축제!`);
        await wait(800);
        return;
      case "frozen":
        float(slotXY(posRef.current[e.p]).x, slotXY(posRef.current[e.p]).y - 40, "꽁꽁! 쉬어요", "#2f8fc4");
        await wait(800);
        return;
      case "loan": {
        const c = cardXY(e.p);
        sfx("coin");
        float(c.x, c.y, `대출 +${fmt(e.amt)}`, "#2f6fd6");
        say(`${P(e.p)} 은행 대출 ${fmt(e.amt)} (갚을 돈 ${fmt(e.debt)})`);
        await wait(900);
        return;
      }
      case "repay": {
        const c = cardXY(e.p);
        float(c.x, c.y + 18, `빚 상환 -${fmt(e.amt)}${e.left ? "" : " · 완납!"}`, "#5a6b7a");
        await wait(500);
        return;
      }
      case "rewind": {
        const c = cardXY(e.p);
        float(c.x, c.y, `되감기 +${fmt(e.amt)}`, "#7a5cd6");
        await wait(800);
        return;
      }
      case "encore": {
        const c = cardXY(e.p);
        float(c.x, c.y, "앙코르! 한 번 더", "#ff7fb0");
        await wait(700);
        return;
      }
      case "adjust":
        float(slotXY(posRef.current[e.p]).x, slotXY(posRef.current[e.p]).y - 40, e.why, "#c46f00");
        await wait(300);
        return;
      case "skill": {
        const pl = cur.players[e.p];
        const c = CHAR[pl.lo.char.id];
        sfx("skill");
        setBanner({ id: ++fid, title: e.name, sub: `${P(e.p)} · ${c?.title ?? ""}`, color: c?.color ?? "#ffc94a", art: c ? artOf(c) : undefined, ms: 1400, grade: c?.grade });
        say(`${P(e.p)} 스킬 「${e.name}」`);
        if (e.tiles) for (const t of e.tiles) flashTile(t, "#ff9a3d");
        await wait(1200);
        return;
      }
      case "town": {
        const t = TOWN_EVENTS[e.ev];
        sfx("news");
        const grp = e.group !== undefined ? MAPS[cur.map].groups[e.group]?.name : "";
        setBanner({ id: ++fid, title: `마을 소식 · ${t.name}`, sub: e.ev === "festa" ? `${grp} 통행료 2배 (3바퀴)` : `${t.desc} (3바퀴)`, color: "#4fd1b5", ms: 1900 });
        await wait(1900);
        return;
      }
      case "rotate":
        sfx("rotate");
        setBanner({ id: ++fid, title: "태엽이 감겨요!", sub: "정원의 네 변이 한 칸씩 돌아가요", color: "#ff7fa8", ms: 1900 });
        await wait(900);
        setView((v) => ({ ...v, order: e.order }));
        await wait(1000);
        return;
      case "mono":
        sfx("mono");
        setBanner({ id: ++fid, title: "독점!", sub: `${P(e.p)} · ${MAPS[cur.map].groups[e.group]?.name} 통행료 2배`, color: PCOLOR[e.p], ms: 1400 });
        await wait(1400);
        return;
      case "bankrupt":
        sfx("bankrupt");
        setAnim((a) => a.map((x, i) => (i === e.p ? "ko" : x)));
        setBanner({ id: ++fid, title: "파산", sub: P(e.p), color: "#8c7259", ms: 1400 });
        await wait(1400);
        return;
      case "over":
        return;
    }
  };

  const [who, setWho] = useState<number | null>(null);
  const guide = useMapGuide();
  const posRef = useRef(pos);
  useEffect(() => {
    posRef.current = pos;
  }, [pos]);
  const setPosOf = (pi: number, s: number) => {
    posRef.current = posRef.current.map((x, i) => (i === pi ? s : x));
    setPos(posRef.current);
  };
  const patchTile = (tile: number, patch: { owner?: number; lv?: number }) =>
    setView((v) => ({ ...v, tiles: v.tiles.map((t, i) => (i === tile ? { ...t, ...patch } : t)) }));
  const flashTile = (tile: number, c: string) => {
    setFlash((f) => ({ ...f, [tile]: c }));
    setTimeout(() => setFlash((f) => Object.fromEntries(Object.entries(f).filter(([k]) => Number(k) !== tile))), 900);
  };

  /* ── 대기열 돌리기 ── */
  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    while (queue.current.length) {
      const w = queue.current.shift()!;
      // 많이 밀렸으면 (탭을 내려 뒀다 옴) 연출 없이 맞춤
      const skip = queue.current.length >= 3;
      if (!skip && w.game) for (const e of w.ev) await playEv(e, w.game);
      if (w.game) {
        setView(w.game);
        setPos(w.game.players.map((p) => p.pos));
        setCash(w.game.players.map((p) => p.cash));
        setAnim(w.game.players.map((p) => (p.alive ? "idle" : "ko")));
      }
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
    if (!room.ev.length && !running.current && !queue.current.length) {
      setLive(room);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버에서 새 방 상태가 오면 화면 상태를 맞춤
      if (room.game) setView(room.game);
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
  const [mode, setMode] = useState<null | { k: "skillTile"; tiles: number[] } | { k: "skillNum"; range: [number, number] } | { k: "skillFoe"; foes: number[]; n?: boolean } | { k: "pullN"; foe: number } | { k: "pick" }>(null);
  const [sending, setSending] = useState(false);
  const [info, setInfo] = useState<number | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버에서 새 방 상태가 오면 화면 상태를 맞춤
  useEffect(() => setMode(null), [live.seq]);

  const send = async (a: Action) => {
    if (sending) return;
    setSending(true);
    setMode(null);
    try {
      await marble.act(room.id, a);
    } catch (e) {
      sfx("deny");
      say(`⚠ ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  };

  const onSkill = () => {
    if (!mine || !canSkill(gg, myPi)) return;
    const k = g.players[myPi].skill.kind;
    const tg = SKILL_TARGET[k];
    if (tg === "none") return void send({ t: "skill" });
    if (tg === "ownCity" || tg === "foeCity" || tg === "foeLand") return setMode({ k: "skillTile", tiles: skillTargets(gg, myPi) });
    if (tg === "foe") {
      const foes = skillTargets(gg, myPi);
      if (k === "pull") return foes.length === 1 ? setMode({ k: "pullN", foe: foes[0] }) : setMode({ k: "skillFoe", foes, n: true });
      return foes.length === 1 ? void send({ t: "skill", target: foes[0] }) : setMode({ k: "skillFoe", foes });
    }
    const r = skillRange(gg, myPi);
    if (r) setMode({ k: "skillNum", range: r });
  };

  /* 보드에서 고를 칸 */
  let pick: number[] | null = null;
  let onPick: ((t: number) => void) | undefined;
  if (mine && pr) {
    if (mode?.k === "skillTile") {
      pick = mode.tiles;
      onPick = (t) => void send({ t: "skill", target: t });
    } else if (pr.k === "fest") {
      pick = pr.tiles;
      onPick = (t) => void send({ t: "fest", tile: t });
    } else if (pr.k === "start") {
      pick = pr.tiles;
      onPick = (t) => void send({ t: "start", tile: t });
    } else if (pr.k === "turn" && pr.warp) {
      pick = map.tiles.map((_, s) => g.order[s]).filter((t) => map.tiles[t].kind !== "warp");
      onPick = (t) => void send({ t: "warp", to: g.order.indexOf(t) });
    } else if (pr.k === "rail") {
      pick = pr.opts.map((s) => g.order[s]);
      onPick = (t) => void send({ t: "rail", to: g.order.indexOf(t) });
    } else if (pr.k === "fork") {
      pick = pr.opts.map((s) => g.order[s]);
      onPick = (t) => void send({ t: "fork", to: g.order.indexOf(t) });
    }
  }

  // 시간 막대
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(id);
  }, []);
  const left = live.deadline ? Math.max(0, live.deadline - serverNow()) : 0;

  const tokens: TokenView[] = view.players.flatMap((p, i) => (hide[i] ? [] : [{
    pi: i,
    slot: pos[i],
    sprite: spriteOf(p.lo.char.id),
    anim: anim[i],
    face: face[i],
    hop: hop[i],
    dim: !p.alive,
  }]));

  const n = view.players.length;
  /** 화면 자리: 나는 늘 왼쪽 아래 (모두의마블처럼), 1:1 상대는 오른쪽 위 */
  const viewIdx = (pi: number) => (myPi >= 0 ? (pi - myPi + n) % n : pi);
  const dim = mine && pr && (pr.k === "buy" || pr.k === "acq");

  return (
    <div className="mb-sky absolute inset-0 overflow-hidden" style={{ background: BOARD_BG[view.map] }}>
      {/* 바깥 배경: 맵 그림을 크게 흐리게 + 가장자리 어둡게 */}
      <img src={`/marble/bg/center-${view.map}.webp`} alt="" className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-[10px]" />
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 50%, rgba(10,8,30,0.05) 35%, rgba(10,8,30,0.6) 100%)" }} />
      <Board g={view} tokens={tokens} pick={pick} onPick={onPick} onInfo={(t) => setInfo(t)} flash={flash} />
      {train && <TrainRide key={train.id} pts={train.pts} sprite={spriteOf(view.players[train.pi].lo.char.id)} />}

      {/* 위 가운데: 맵 · 바퀴 · 마을 소식 · 최근 일 */}
      <div className="absolute top-[6px] left-1/2 z-[400] flex -translate-x-1/2 flex-col items-center gap-1">
        <div className="mb-wood flex items-center gap-3 px-4 py-1" style={{ "--bar": map.id === "orgel" ? "#ff7fb0" : map.id === "cross" ? "#ff9a3d" : "#5b6cff" } as CSSProperties}>
          <b className="mb-title mb-out text-[16px] text-white">{map.name}</b>
          <GuideDot onOpen={() => guide.show(map.id)} className="!h-[20px] !w-[20px] !text-[12px]" />
        </div>
      </div>
      <div className="absolute top-[150px] left-[10px] z-[430]">
        <RoomTools room={live} me={me} onLeave={onLeave} inGame vertical />
      </div>

      {/* 가운데: 꼭 필요한 것만 — 바퀴 · 누구 차례 · 판돈 */}
      {live.phase !== "end" && (
        <div className="mbx pointer-events-none absolute top-[288px] left-1/2 z-[300] flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full bg-[#140f3a]/80 px-2 py-1 text-[13px] text-white shadow-[0_4px_14px_rgba(0,0,0,0.4)] ring-1 ring-white/20 backdrop-blur">
          <span className="rounded-full bg-white/10 px-2.5 py-[2px] font-black">
            {Math.min(g.round, g.rounds)}
            <span className="font-bold text-white/60"> / {g.rounds} 바퀴</span>
          </span>
          {(g.prompt?.p ?? -1) >= 0 && (
            <span className="flex items-center gap-1 rounded-full px-2.5 py-[2px] font-black" style={{ background: PCOLOR[g.prompt!.p] }}>
              {nameOf(g.prompt!.p)} 차례
            </span>
          )}
          <span className="flex items-center gap-1 rounded-full bg-[#ffd23a]/20 px-2.5 py-[2px] font-black text-[#ffe08a]">
            판돈 <CurIcon k="star" size={14} /> {MATCH_STARS.win}
          </span>
        </div>
      )}
      {/* 마을 소식 · 태엽: 가운데 띠 바로 위 */}
      {live.phase !== "end" && (
        <div className="pointer-events-none absolute top-[262px] left-1/2 z-[300] flex -translate-x-1/2 -translate-y-full flex-col items-center gap-1">
        {g.town && (
          <div className="mb-chip text-[12px] shadow-[0_3px_10px_rgba(0,0,0,0.35)]" style={{ "--c": "#bff7e8" } as CSSProperties} title={TOWN_EVENTS[g.town.id].desc}>
            <Icon n="note" size={11} /> 마을 소식 <b>{TOWN_EVENTS[g.town.id].name}</b> · {g.town.id === "festa" ? `${map.groups[g.town.group]?.name} 통행료 2배` : TOWN_EVENTS[g.town.id].desc}
          </div>
        )}
        {map.id === "orgel" && map.every && (
          <div className="mb-chip text-[12px] shadow-[0_3px_10px_rgba(0,0,0,0.35)]" style={{ "--c": "#ffe1ef" } as CSSProperties}>
            <Icon n="clock" size={11} /> 태엽 회전까지 {map.every - ((g.round - 1) % map.every)}바퀴
          </div>
        )}
        </div>
      )}
      {live.phase !== "end" && <CenterDice dice={dice} at={diceAt} />}


      {/* 플레이어 (네 귀퉁이) */}
      {view.players.map((p, i) => (
        <PlayerCard
          key={i}
          i={i}
          g={view}
          cash={cash[i]}
          me={i === myPi}
          turn={(live.game?.prompt?.p ?? -1) === i && live.phase === "play"}
          seat={room.seats[order[i]]}
          shake={shake === i}
          corner={viewIdx(i)}
          pickable={mode?.k === "skillFoe" && mode.foes.includes(i)}
          onInfo={() => setWho(i)}
          onPick={() => {
            if (mode?.k !== "skillFoe") return;
            if (mode.n) setMode({ k: "pullN", foe: i });
            else void send({ t: "skill", target: i });
          }}
        />
      ))}

      {guide.node}
      {who !== null && view.players[who] && <PlayerInfo g={view} i={who} onClose={() => setWho(null)} />}

      {/* 고르기 창 (사고 · 인수는 보드를 어둡게) */}
      {dim && <div className="absolute inset-0 z-[450] bg-[rgba(35,42,77,0.35)]" />}
      {live.phase === "play" && (
        <div
          className="absolute z-[460] flex -translate-x-1/2 justify-center"
          style={{ left: 512, top: dim ? 150 : 314, width: 440 }}
        >
          <ActionPanel
            g={g}
            pr={pr}
            mine={mine}
            myPi={myPi}
            left={left}
            mode={mode}
            setMode={setMode}
            send={send}
            sending={sending}
            skill={onSkill}
            compact={false}
            busy={busy}
            auto={!!mySeat?.auto}
            onManual={() => void marble.auto(room.id, false)}
          />
        </div>
      )}

      {/* 칸 정보 */}
      {info !== null && <TileInfo g={view} tile={info} onClose={() => setInfo(null)} />}

      {/* 떠오르는 글자 */}
      {floaters.map((f) => (
        <div key={f.id} className="mb-float pointer-events-none absolute z-[500] text-[17px] font-bold whitespace-nowrap text-white" style={{ left: f.x, top: f.y, textShadow: `2px 0 0 ${f.color}, -2px 0 0 ${f.color}, 0 2px 0 ${f.color}, 0 -2px 0 ${f.color}, 2px 2px 0 ${f.color}, -2px -2px 0 ${f.color}, 2px -2px 0 ${f.color}, -2px 2px 0 ${f.color}, 0 4px 0 #232a4d` }}>
          {f.text}
        </div>
      ))}

      {banner && <BannerView key={banner.id} b={banner} />}
      {card && <CardPop id={card.id} name={nameOf(card.p)} />}
      {live.phase === "end" && live.result && !busy && <Result room={live} me={me} onLeave={onLeave} />}
    </div>
  );
}

/* ───────────── 배경 · 위치 ───────────── */

/** 귀퉁이 0 왼쪽 아래(나) · 1 오른쪽 위 · 2 왼쪽 위 · 3 오른쪽 아래 */
/** 탑뷰 판 바깥 바탕 (맵마다 매끈한 그라데이션) */
const BOARD_BG: Record<string, string> = {
  town: "radial-gradient(circle at 50% 45%, #bfe9ff 0%, #7cc4f2 55%, #4c8fd6 100%)",
  cross: "radial-gradient(circle at 50% 45%, #ffe3b0 0%, #f5b36b 55%, #d97a45 100%)",
  orgel: "radial-gradient(circle at 50% 45%, #ffe0f0 0%, #f4a8cf 55%, #c46aa6 100%)",
};

function cornerRect(corner: number) {
  // 네 귀퉁이 (마름모 보드가 비워 둔 자리): 왼쪽 아래(나) · 왼쪽 위 · 오른쪽 위 · 오른쪽 아래
  const w = 236;
  const h = 118;
  const left = corner === 0 || corner === 1;
  const topSide = corner === 1 || corner === 2;
  return { x: left ? 8 : 1024 - 8 - w, y: topSide ? 18 : 576 - 10 - h, w, h };
}
const slotOfTile = (g: GameWire, tile: number) => g.order.indexOf(tile);

/* ───────────── 플레이어 카드 ───────────── */

function PlayerCard({
  i,
  g,
  cash,
  me,
  turn,
  seat,
  shake,
  corner,
  pickable,
  onPick,
  onInfo,
}: {
  i: number;
  g: GameWire;
  cash: number;
  me: boolean;
  turn: boolean;
  seat: RoomWire["seats"][number];
  shake: boolean;
  corner: number;
  pickable: boolean;
  onPick(): void;
  onInfo(): void;
}) {
  const p = g.players[i];
  const c = CHAR[p.lo.char.id];
  const gg = g as unknown as Game;
  const assets = assetsOf(gg, i);
  const tiles = g.tiles.filter((t) => t.owner === i).length;
  const dice = p.lo.dice ? ITEM[p.lo.dice.id] : null;
  const buddy = p.lo.buddy ? ITEM[p.lo.buddy.id] : null;
  const r = cornerRect(corner);
  const uses = p.uses.adjust + p.uses.pick + p.uses.reroll + p.uses.rewind;
  return (
    <div className={`absolute z-[420] ${shake ? "mb-shake" : ""} ${pickable ? "mb-blink cursor-pointer" : ""}`} style={r.y > 288 ? { left: r.x, bottom: 10, width: r.w } : { left: r.x, top: r.y, width: r.w }} onClick={pickable ? onPick : onInfo} title={pickable ? undefined : "눌러서 장착 · 효과 보기"}>
      {/* 모두의마블처럼 카드 옆 빈자리에 쌓인 금화 */}
      <div className={`pointer-events-none absolute ${r.x < 512 ? "left-[calc(100%+8px)]" : "right-[calc(100%+8px)]"} ${r.y < 288 ? "top-[22px]" : "bottom-[10px]"}`}>
        <CoinStack cash={cash} />
      </div>
      <div className={`mb-box relative overflow-visible ${turn ? "mb-turn" : ""}`} style={{ "--c": PCOLOR[i], "--bg": "#ffffff", opacity: p.alive ? 1 : 0.55 } as CSSProperties}>
        {/* 이름 띠 */}
        <div className="flex h-[26px] items-center gap-1.5 pr-2 pl-[86px]" style={{ background: PCOLOR[i], boxShadow: "inset 0 -3px 0 rgba(0,0,0,0.18), inset 0 3px 0 rgba(255,255,255,0.3)" }}>
          {seat?.bot ? <Icon n="bot" size={13} /> : me ? <Icon n="crown" size={13} /> : null}
          <span className="rounded-[4px] bg-white px-[4px] text-[10px] leading-[14px] font-black" style={{ color: PCOLOR[i] }}>
            {i + 1}P
          </span>
          <b className="mb-out-s min-w-0 flex-1 truncate text-[14px] text-white">{p.name}</b>
          {seat?.auto && <span className="mb-chip text-[10px]">자동</span>}
          {seat?.away && <span className="mb-chip text-[10px]">끊김</span>}
          {!p.alive && <span className="mb-chip text-[10px]">파산</span>}
        </div>
        {/* 얼굴 (띠 위로 튀어나오게) */}
        <div className="absolute top-[-10px] left-[8px] h-[72px] w-[72px] overflow-hidden bg-white" style={{ boxShadow: "0 0 0 3px #232a4d" }}>
          {c && (
            <>
              <img src={`/marble/art/bg-${c.grade}.webp`} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <img src={faceOf(c)} alt="" className="relative h-full w-full object-cover object-top" />
            </>
          )}
          {c && <GradeTag g={c.grade} className="absolute bottom-[3px] left-[3px] scale-90" />}
        </div>
        <div className="pt-[3px] pr-2 pb-1 pl-[88px]">
          <div className="text-[24px] leading-[28px] font-bold tracking-[-0.02em]" style={{ color: cash < 300 ? "#e0384b" : "#232a4d" }}>
            <Cur k="coin" n={cash} size={18} />
          </div>
          <div className="text-[11px] leading-[14px] text-[var(--mute)]">
            자산 <b className="text-[var(--ink2)]">{fmt(assets)}</b> · 땅 {tiles}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1 px-2 pt-1.5 pb-2 text-[11px]">
          <span className="mb-chip" title={c ? `${c.active.name} — ${c.active.desc(power(c.grade, p.lo.char.lv))}` : ""} style={{ "--c": p.cd === 0 ? "#ffe24a" : "#e3e8f7" } as CSSProperties}>
            <Icon n="star" size={10} />
            {c?.active.name}
            {p.cd > 0 && <span className="text-[var(--mute)]">{p.cd}</span>}
          </span>
          {dice && (
            <span className="mb-chip !p-0 !pr-1" title={`${dice.name} — ${dice.desc(power(dice.grade, p.lo.dice!.lv))}`}>
              <img src={`/marble/items/${dice.id}.webp`} alt="" className="h-[18px] w-[18px]" />
              {uses > 0 && <b>{uses}</b>}
            </span>
          )}
          {buddy && (
            <span className="mb-chip !p-0" title={`${buddy.name} — ${buddy.desc(power(buddy.grade, p.lo.buddy!.lv))}`}>
              <img src={`/marble/items/${buddy.id}.webp`} alt="" className="h-[18px] w-[18px]" />
            </span>
          )}
          {p.jail > 0 && <span className="mb-chip" style={{ "--c": "#d9e2ea" } as CSSProperties}><Icon n="wrench" size={10} />수리 {p.jail}</span>}
          {p.warp && <span className="mb-chip" style={{ "--c": "#d8d0ff" } as CSSProperties}><Icon n="warp" size={10} />워프</span>}
          {p.frozen > 0 && <span className="mb-chip" style={{ "--c": "#cdefff" } as CSSProperties}><Icon n="ice" size={10} />얼음</span>}
          {p.shield > 0 && <span className="mb-chip" style={{ "--c": "#cdefff" } as CSSProperties}><Icon n="shield" size={10} />방패</span>}
          {p.keep.half > 0 && <span className="mb-chip">반값</span>}
          {p.keep.free > 0 && <span className="mb-chip">무료공사</span>}
          {(p.keep.acq > 0 || p.sale > 0) && <span className="mb-chip">인수할인</span>}
        </div>
      </div>
    </div>
  );
}

/** 모두의마블처럼 프로필 앞에 쌓인 금화 (가진 돈 만큼 더미가 늘고 줄어듦) */
function CoinStack({ cash }: { cash: number }) {
  // 금화 1개 = 100, 더미당 최대 8개, 최대 4더미 (3000 이상이면 꽉)
  const coins = Math.max(0, Math.min(32, Math.round(cash / 100)));
  const piles = Array.from({ length: Math.ceil(coins / 8) }, (_, k) => Math.min(8, coins - k * 8));
  return (
    <div className="flex h-[52px] items-end gap-[3px] pb-[2px]" aria-hidden style={{ filter: "drop-shadow(0 3px 3px rgba(10,8,30,0.45))" }}>
      {piles.map((n, k) => (
        <div key={k} className="relative w-[20px]" style={{ height: 8 + n * 5 }}>
          {Array.from({ length: n }, (_, j) => (
            <span key={j} className="mbx-coin absolute left-0 h-[8px] w-[20px] rounded-[50%]" style={{ bottom: j * 5, background: "linear-gradient(180deg, #fff1a0, #ffc93a 55%, #d98e0b)", boxShadow: "0 0 0 1px #8a5a00, inset 0 -1px 0 rgba(0,0,0,0.25)", animationDelay: `${(k * 6 + j) * 18}ms` }} />
          ))}
        </div>
      ))}
    </div>
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
                  스킬 · {c.active.name} <span className="font-normal text-white/50">({p.cd > 0 ? `${p.cd}턴 뒤` : "지금 쓸 수 있음"})</span>
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
        </div>
      </div>
    </div>
  );
}

/* ───────────── 기차 (크로스 익스프레스) ───────────── */

/** 열차가 pts 를 따라 1초 동안 달림 (말이 타고 있음) */
function TrainRide({ pts, sprite }: { pts: { x: number; y: number }[]; sprite: string }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 1000);
      setT(k);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  // 구간 길이 비례로 위치
  const seg = pts.slice(1).map((b, i) => Math.hypot(b.x - pts[i].x, b.y - pts[i].y));
  const total = seg.reduce((a, b) => a + b, 0);
  const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  let d = ease * total,
    i = 0;
  while (i < seg.length - 1 && d > seg[i]) d -= seg[i++];
  const a = pts[i],
    b = pts[i + 1];
  const k = seg[i] ? d / seg[i] : 0;
  const x = a.x + (b.x - a.x) * k,
    y = a.y + (b.y - a.y) * k;
  const face = b.x >= a.x ? 1 : -1;
  return (
    <div className="pointer-events-none absolute z-[260]" style={{ left: x, top: y, transform: "translate(-50%, -100%)" }}>
      <div className="relative flex flex-col items-center">
        <Token sprite={sprite} h={46} face={face} anim="win" />
        <div className="-mt-[14px] flex items-end gap-[2px]" style={{ transform: face < 0 ? "scaleX(-1)" : undefined }}>
          <div className="h-[20px] w-[34px] bg-[#ff6b6b]" style={{ boxShadow: "0 0 0 2px #232a4d", borderRadius: "4px 10px 2px 2px" }}>
            <div className="mt-[4px] ml-[18px] h-[7px] w-[10px] bg-[#cdeeff]" style={{ boxShadow: "0 0 0 1px #232a4d" }} />
          </div>
          <div className="h-[16px] w-[26px] bg-[#ffd65a]" style={{ boxShadow: "0 0 0 2px #232a4d", borderRadius: 2 }} />
        </div>
        <div className="mt-[1px] text-[11px] font-bold text-white" style={{ textShadow: "0 1px 0 #232a4d" }}>
          칙칙폭폭!
        </div>
      </div>
    </div>
  );
}

/* ───────────── 힘 조절 굴리기 ───────────── */

/**
 * 꾹 누르면 게이지가 왔다 갔다, 놓으면 던짐. 약(낮은 합) · 중 · 강(높은 합) 구간을 노리면
 * chance 확률로 그 구간이 나옴 (기본 10% + 캐릭터 · 아이템). 톡 누르기만 하면 그냥 굴림. 스페이스바도 됨.
 */
function PowerRoll({ disabled, chance, onThrow }: { disabled: boolean; chance: number; onThrow(power?: number): void }) {
  const [v, setV] = useState(0);
  const [hold, setHold] = useState(false);
  const t0 = useRef(0);
  const raf = useRef(0);
  const val = useRef(0);
  const start = useCallback(() => {
    if (disabled || hold) return;
    setHold(true);
    sfx("click");
    t0.current = performance.now();
    const step = () => {
      const t = (performance.now() - t0.current) / 1100;
      const x = t % 2 < 1 ? t % 1 : 1 - (t % 1); // 0→1→0 왕복
      val.current = x;
      setV(x);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [disabled, hold]);
  const release = useCallback(() => {
    if (!hold) return;
    cancelAnimationFrame(raf.current);
    setHold(false);
    const held = performance.now() - t0.current;
    onThrow(held < 160 ? undefined : Math.round(val.current * 100) / 100);
    setV(0);
  }, [hold, onThrow]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
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
  const zone = powerZone(v);
  const R = 64;
  const L = 2 * Math.PI * R;
  // 링: 약(파랑) · 중(초록) · 강(빨강) 세 칸 위에 지금 힘만큼 밝게 채움 (위에서 시계 방향)
  const seg = (from: number, to: number, c: string, o: number) => (
    <circle cx={80} cy={80} r={R} fill="none" stroke={c} strokeOpacity={o} strokeWidth={12} strokeDasharray={`${(to - from) * L - 3} ${L}`} strokeDashoffset={-from * L} transform="rotate(-90 80 80)" />
  );
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-[160px] w-[160px]">
        <svg viewBox="0 0 160 160" className="absolute inset-0" aria-hidden>
          <circle cx={80} cy={80} r={R} fill="rgba(20,16,50,0.55)" stroke="none" />
          {seg(0, 1 / 3, "#6fb7ff", 0.35)}
          {seg(1 / 3, 2 / 3, "#7fe08a", 0.35)}
          {seg(2 / 3, 1, "#ff7a6b", 0.35)}
          {hold && <circle cx={80} cy={80} r={R} fill="none" stroke={zone === "low" ? "#6fb7ff" : zone === "mid" ? "#7fe08a" : "#ff7a6b"} strokeWidth={12} strokeLinecap="round" strokeDasharray={`${v * L} ${L}`} transform="rotate(-90 80 80)" style={{ filter: "drop-shadow(0 0 6px rgba(255,255,255,0.8))" }} />}
        </svg>
        <button
          type="button"
          disabled={disabled}
          className={`absolute top-1/2 left-1/2 flex h-[104px] w-[104px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full text-[#3a2500] transition disabled:opacity-50 ${hold ? "scale-95" : "mbx-ready hover:scale-105"}`}
          style={{ background: "radial-gradient(circle at 35% 30%, #fff6c0, #ffd23a 45%, #f59a1e)", boxShadow: "0 6px 0 #b86e00, 0 10px 22px rgba(0,0,0,0.45), inset 0 2px 0 rgba(255,255,255,0.7)" }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            start();
          }}
          onPointerUp={release}
          onPointerCancel={release}
        >
          <span className="text-[26px] leading-none font-black tracking-wide">{hold ? `${ZONE_NAME[zone]}!` : "ROLL"}</span>
          <span className="mt-1 text-[10px] font-bold opacity-80">{hold ? "놓으면 던져요" : "꾹 눌러 던지기"}</span>
        </button>
      </div>
      <span className="rounded-full bg-black/45 px-3 py-[2px] text-[10.5px] text-white/90">
        <b className="text-[#6fb7ff]">약 2~6</b> · <b className="text-[#7fe08a]">중 6~8</b> · <b className="text-[#ff9a8b]">강 8~12</b> · 노린 구간 {Math.round(chance * 100)}% · 스페이스바
      </span>
    </div>
  );
}

/* ───────────── 가운데 주사위 ───────────── */

interface DiceView {
  d: [number, number];
  roll: number;
  p: number;
  /** 굴러가는 시간 */
  dur: number;
  /** 던진 곳 (가운데 기준 상대 위치) — 없으면 제자리에서 굴림 */
  from: { x: number; y: number } | null;
  /** 몇 바퀴 */
  spin: number;
}
const ZONE_NAME = { low: "약하게", mid: "적당히", high: "세게" } as const;

/** 주사위 하나 (3D 정육면체): 던진 사람 쪽에서 포물선으로 날아와 데굴데굴 구르다 그 눈이 앞을 보며 멈춤 */
const DIE = 48;
/** 그 눈이 윗면으로 오게 하는 회전 (주사위는 윗면 숫자로 셈) — 면: 앞 1 · 뒤 6 · 오른쪽 3 · 왼쪽 4 · 위 2 · 아래 5 */
const FACE_ROT: Record<number, [number, number]> = { 2: [0, 0], 1: [90, 0], 6: [-90, 0], 5: [180, 0], 3: [90, -90], 4: [90, 90] };
function ThrownDie({ v, dv, delay }: { v: number; dv: DiceView; delay: number }) {
  const [rx, ry] = FACE_ROT[v] ?? [0, 0];
  const turns = Math.max(1, dv.spin);
  const style = {
    "--fx": `${(dv.from?.x ?? 0) + (delay ? 34 : -34)}px`,
    "--fy": `${dv.from?.y ?? -40}px`,
    animationDuration: `${dv.dur}ms`,
    animationDelay: `${delay}ms`,
  } as CSSProperties;
  const cube = {
    "--rx0": `${rx + 360 * turns + (delay ? 140 : 60)}deg`,
    "--ry0": `${ry - 360 * turns + (delay ? -80 : 120)}deg`,
    "--rz0": `${delay ? 200 : -160}deg`,
    "--rx1": `${rx}deg`,
    "--ry1": `${ry}deg`,
    animationDuration: `${Math.round(dv.dur * 0.92)}ms`,
    animationDelay: `${delay}ms`,
  } as CSSProperties;
  const half = DIE / 2;
  const faces: [number, string][] = [
    [1, `translateZ(${half}px)`],
    [6, `rotateY(180deg) translateZ(${half}px)`],
    [3, `rotateY(90deg) translateZ(${half}px)`],
    [4, `rotateY(-90deg) translateZ(${half}px)`],
    [2, `rotateX(90deg) translateZ(${half}px)`],
    [5, `rotateX(-90deg) translateZ(${half}px)`],
  ];
  return (
    <div className="mbx-arc relative" style={{ ...style, width: DIE, height: DIE }}>
      <div className="absolute bottom-[-12px] left-1/2 h-[10px] w-[46px] -translate-x-1/2 rounded-[50%] bg-black/30 blur-[1px]" />
      {/* 살짝 위에서 내려다보게 기울인 무대 */}
      <div style={{ width: DIE, height: DIE, perspective: 600 }}>
        <div style={{ width: DIE, height: DIE, transformStyle: "preserve-3d", transform: "rotateX(-40deg) rotateY(28deg)" }}>
          <div className="mbx-tumble relative" style={{ ...cube, width: DIE, height: DIE, transformStyle: "preserve-3d" }}>
            {faces.map(([n, tf]) => (
              <div key={n} className="absolute inset-0 rounded-[9px]" style={{ transform: tf, background: "linear-gradient(145deg, #ffffff, #e9ecf7)", boxShadow: "inset 0 0 0 1.5px #c9cfe6, inset 0 -3px 6px rgba(38,43,82,0.12)", backfaceVisibility: "hidden" }}>
                <Pips n={n} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 주사위 눈 (1 은 빨간 큰 점) */
function Pips({ n }: { n: number }) {
  const P: Record<number, [number, number][]> = {
    1: [[50, 50]],
    2: [[28, 28], [72, 72]],
    3: [[26, 26], [50, 50], [74, 74]],
    4: [[28, 28], [72, 28], [28, 72], [72, 72]],
    5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
    6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
  };
  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
      {P[n].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={n === 1 ? 15 : 9.5} fill={n === 1 ? "#ff3d5e" : "#262b52"} />
      ))}
    </svg>
  );
}

function CenterDice({ dice, at }: { dice: DiceView | null; at: { x: number; y: number } }) {
  return (
    <div className="pointer-events-none absolute z-[300] flex flex-col items-center gap-1.5" style={{ left: at.x, top: at.y, transform: "translateX(-50%)" }}>
      <div className="flex gap-3">
        {dice ? (
          <>
            <ThrownDie key={`a${dice.roll}`} v={dice.d[0]} dv={dice} delay={0} />
            <ThrownDie key={`b${dice.roll}`} v={dice.d[1]} dv={dice} delay={70} />
          </>
        ) : null}
      </div>
      {dice && (
        <div key={`n${dice.roll}`} className="mbx-num relative flex items-center gap-2" style={{ animationDelay: `${dice.dur}ms` }}>
          <b className="text-[54px] leading-[56px] font-black" style={{ background: "linear-gradient(180deg, #fffbe0 10%, #ffd23a 60%, #f59a1e)", WebkitBackgroundClip: "text", color: "transparent", filter: "drop-shadow(0 3px 0 #7a3e00) drop-shadow(0 0 12px rgba(255,200,60,0.8))" }}>
            {dice.d[0] + dice.d[1]}
          </b>
          {dice.d[0] === dice.d[1] && <span className="mbx-ready rotate-[-8deg] rounded-lg bg-[#ff2d6f] px-2 py-0.5 text-[18px] font-black text-white shadow-lg">더블!</span>}
        </div>
      )}
    </div>
  );
}

/* ───────────── 칸 정보 ───────────── */

/** 칸 정보: 화면 가운데 모달 (뒤는 살짝 어둡게, 바깥 누르면 닫힘) */
function TileInfo({ g, tile, onClose }: { g: GameWire; tile: number; onClose(): void }) {
  const m = MAPS[g.map];
  const d = m.tiles[tile];
  const t = g.tiles[tile];
  const gg = g as unknown as Game;
  const ownable = d.kind === "city" || d.kind === "spot";
  const band = d.kind === "spot" ? "#ffb21e" : d.group !== undefined ? m.groups[d.group].color : "#8d9bb3";
  const DESC: Record<string, string> = {
    start: "지나가거나 서면 월급. 딱 서면 내 땅 하나를 골라 바로 지을 수 있어요.",
    start2: "지나가면 월급의 70%",
    box: "카드 한 장 — 좋은 일일 수도, 나쁜 일일 수도!",
    jail: `더블이 나오거나 두 번 쉬어야 나가요. ${RULE.jailPay} 내면 바로 나가요.`,
    fest: "내 땅 하나를 골라 축제 (통행료 2배)",
    warp: "다음 차례에 원하는 칸으로 순간이동",
    tax: "땅 · 건물 값의 10% 를 세금으로",
    bonus: `서면 +${RULE.bonus}`,
    rail: "다른 기차역으로 바로 갈 수 있어요 (그냥 남아도 돼요)",
  };
  const owner = t.owner >= 0 ? g.players[t.owner] : null;
  const rows = d.kind === "city" ? [0, 1, 2, 3, LANDMARK] : d.kind === "spot" ? [0] : [];
  return (
    <div className="mbx absolute inset-0 z-[650] flex items-center justify-center bg-[rgba(10,8,30,0.55)]" onClick={onClose}>
      <div className="mbx-pop w-[400px] overflow-hidden rounded-2xl border border-white/15 bg-[#1b1650]/95 text-white shadow-[0_20px_50px_rgba(0,0,0,0.5)]" onClick={(e) => e.stopPropagation()}>
        <div className="relative px-4 pt-3 pb-3" style={{ background: `linear-gradient(135deg, ${band}, ${band}99)` }}>
          <div className="text-[11px] font-black tracking-[0.15em] text-white/85">{d.kind === "city" ? m.groups[d.group!].name : d.kind === "spot" ? "명소" : "특수 칸"}</div>
          <b className="text-[24px] leading-[30px] font-black" style={{ textShadow: "0 2px 0 rgba(38,43,82,0.4)" }}>
            {d.name}
          </b>
          <button type="button" onClick={onClose} className="absolute top-3 right-3 flex h-[28px] w-[28px] items-center justify-center rounded-full bg-black/25 text-[16px] hover:bg-black/40" aria-label="닫기">
            ×
          </button>
        </div>
        <div className="flex flex-col gap-2.5 p-4 text-[13px]">
          {!ownable && <p className="leading-[20px] text-white/90">{DESC[d.kind] ?? ""}</p>}
          {ownable && (
            <>
              {owner ? (
                <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: `${PCOLOR[t.owner]}33`, boxShadow: `inset 0 0 0 1.5px ${PCOLOR[t.owner]}` }}>
                  <span className="h-[12px] w-[12px] rounded-full" style={{ background: PCOLOR[t.owner] }} />
                  <b>{owner.name}</b>
                  <span className="text-white/70">· {LEVEL_NAME[t.lv]}</span>
                  <span className="ml-auto text-right">
                    <span className="block text-[10px] text-white/60">지금 통행료</span>
                    <b className="text-[18px] text-[#ffe08a]">{fmt(tollOf(gg, tile))}</b>
                  </span>
                </div>
              ) : (
                <div className="rounded-xl bg-white/[0.07] px-3 py-2 text-white/80">
                  빈 땅 · 땅값 <b className="text-white">{fmt(d.price ?? 0)}</b>
                  {d.kind === "spot" && " · 가진 명소 수만큼 통행료 2배씩, 4곳이면 승리"}
                </div>
              )}
              {rows.length > 1 && (
                <div className="overflow-hidden rounded-xl ring-1 ring-white/10">
                  <div className="grid grid-cols-[1fr_1fr_1fr] bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white/65">
                    <span>단계</span>
                    <span className="text-right">넣은 돈</span>
                    <span className="text-right">통행료</span>
                  </div>
                  {rows.map((lv) => {
                    const cur = owner && t.lv === lv;
                    return (
                      <div key={lv} className="grid grid-cols-[1fr_1fr_1fr] px-3 py-1.5" style={cur ? { background: `${PCOLOR[t.owner]}44`, fontWeight: 800 } : undefined}>
                        <span>{LEVEL_NAME[lv]}</span>
                        <span className="text-right text-white/80">{fmt(investedOf(d.price ?? 0, lv))}</span>
                        <span className="text-right font-bold text-[#ffe08a]">{fmt(baseToll(d.price ?? 0, lv))}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {owner && d.kind === "city" && t.lv < LANDMARK && (
                <div className="text-[12px] text-white/65">
                  인수하려면 <b className="text-white">{fmt(investedOf(d.price ?? 0, t.lv))}</b> · 랜드마크가 되면 인수 불가
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────── 고르기 창 ───────────── */

function ActionPanel({
  g,
  pr,
  mine,
  myPi,
  left,
  mode,
  setMode,
  send,
  sending,
  skill,
  compact,
  busy: _busy,
  auto,
  onManual,
}: {
  g: GameWire;
  pr: Prompt | null;
  mine: boolean;
  myPi: number;
  left: number;
  mode: { k: string; range?: [number, number]; foe?: number } | null;
  setMode(m: null): void;
  send(a: Action): Promise<void>;
  sending: boolean;
  skill(): void;
  compact: boolean;
  busy: boolean;
  auto: boolean;
  onManual(): void;
}) {
  const gg = g as unknown as Game;
  const m = MAPS[g.map];
  const box = (children: ReactNode, title?: string) => (
    <div className="mbx-modal flex w-full flex-col items-center gap-2 px-4 py-3 text-center" style={{ maxWidth: compact ? 300 : 390 }}>
      {title && <b className="mb-title text-[15px]">{title}</b>}
      {children}
      {mine && left > 0 && (
        <div className="mb-bar w-full" title={`${Math.ceil(left / 1000)}초`}>
          <i style={{ width: `${Math.min(100, (left / 15000) * 100)}%`, "--c": left < 4000 ? "#ff6b6b" : "#4fd1b5" } as CSSProperties} />
        </div>
      )}
    </div>
  );
  /** 상자 없이 판 위에 바로 (굴리기) */
  const bare = (children: ReactNode) => (
    <div className="flex w-full flex-col items-center gap-2 text-center" style={{ maxWidth: 390 }}>
      {children}
      {mine && left > 0 && (
        <div className="mb-bar w-[160px]" title={`${Math.ceil(left / 1000)}초`}>
          <i style={{ width: `${Math.min(100, (left / 15000) * 100)}%`, "--c": left < 4000 ? "#ff6b6b" : "#4fd1b5" } as CSSProperties} />
        </div>
      )}
    </div>
  );
  if (auto)
    return box(
      <>
        <span className="text-[12px]">자리를 비운 동안 AI 가 대신 두고 있어요</span>
        <Btn tone="gold" className="h-[34px] px-4 text-[14px] font-bold" onClick={onManual}>
          내가 다시 할게요
        </Btn>
      </>,
      "자동 진행 중"
    );
  if (!pr || !mine) return null;
  const me = g.players[myPi];
  const c = CHAR[me.lo.char.id];
  const skillOk = canSkill(gg, myPi);
  const skillBtn = skillOk && c && (
    <button
      type="button"
      disabled={sending}
      onClick={() => {
        sfx("click");
        skill();
      }}
      title={c.active.desc(power(c.grade, me.lo.char.lv))}
      className="mbx-skill relative flex h-[50px] items-center gap-2 rounded-full pr-4 pl-1 text-left text-white transition hover:scale-105 disabled:opacity-50"
      style={{ background: "linear-gradient(135deg, #b46bff, #ff5fa2)", boxShadow: "0 0 0 2px #fff, 0 4px 0 #6a2a9a, 0 0 22px 4px rgba(255,95,162,0.65)" }}
    >
      <img src={faceOf(c)} alt="" className="h-[42px] w-[42px] rounded-full object-cover" style={{ boxShadow: "0 0 0 2px #fff" }} />
      <span className="flex flex-col leading-[15px]">
        <span className="text-[10px] font-black tracking-[0.15em] text-[#ffe08a]">SKILL 준비됨!</span>
        <b className="text-[15px]">{c.active.name}</b>
      </span>
    </button>
  );

  // 스킬 숫자 · 상대 고르기
  if (mode?.k === "skillNum" && mode.range) {
    const [a, b] = mode.range;
    return box(
      <>
        <div className="flex flex-wrap justify-center gap-1.5">
          {Array.from({ length: b - a + 1 }, (_, k) => a + k).map((n) => (
            <Btn key={n} tone="gold" className="h-[32px] min-w-[34px] px-2 text-[14px] font-bold" onClick={() => void send(pr.k === "post" ? { t: "skill", n } : { t: "skill", n })}>
              {me.skill.kind === "fate" ? `${n}·${n}` : n}
            </Btn>
          ))}
        </div>
        <Btn className="h-[26px] px-3 text-[12px]" onClick={() => setMode(null)}>
          취소
        </Btn>
      </>,
      `${c?.active.name} — 몇?`
    );
  }
  if (mode?.k === "pullN" && mode.foe !== undefined) {
    const r = skillRange(gg, myPi) ?? [1, 2];
    return box(
      <>
        <div className="flex gap-1.5">
          {Array.from({ length: r[1] - r[0] + 1 }, (_, k) => r[0] + k).map((n) => (
            <Btn key={n} tone="gold" className="h-[32px] min-w-[44px] px-2 text-[14px] font-bold" onClick={() => void send({ t: "skill", target: mode.foe, n })}>
              {n}칸
            </Btn>
          ))}
        </div>
        <Btn className="h-[26px] px-3 text-[12px]" onClick={() => setMode(null)}>
          취소
        </Btn>
      </>,
      `${g.players[mode.foe].name} 끌어오기`
    );
  }
  if (mode?.k === "skillTile" || mode?.k === "skillFoe")
    return box(
      <>
        <span className="text-[13px]">{mode.k === "skillTile" ? (me.skill.kind === "buyout" ? `살 땅을 눌러요 (인수 비용의 ${Math.round(me.skill.mag * 100)}%)` : "보드에서 반짝이는 칸을 눌러요") : "상대 카드를 눌러요"}</span>
        <Btn className="h-[26px] px-3 text-[12px]" onClick={() => setMode(null)}>
          취소
        </Btn>
      </>,
      c?.active.name
    );

  switch (pr.k) {
    case "turn": {
      if (pr.warp) return box(<span className="text-[13px]">워프할 칸을 보드에서 눌러요 (출발 포털을 넘으면 월급)</span>, "워프 게이트");
      if (pr.jail)
        return box(
          <>
            <span className="text-[12px]">더블이 나오면 바로 나가요 · 남은 {me.jail}번</span>
            <div className="flex gap-2">
              <Btn tone="gold" className="h-[40px] px-4 text-[15px] font-bold" disabled={sending} onClick={() => void send({ t: "roll" })} silent>
                더블 노리기
              </Btn>
              <Btn className="h-[40px] px-3 text-[13px]" disabled={sending || me.cash < RULE.jailPay} onClick={() => void send({ t: "pay" })}>
                <Cur k="coin" n={RULE.jailPay} size={12} /> 내고 나가기
              </Btn>
            </div>
          </>,
          "도트 수리소"
        );
      return bare(
        <>
          <PowerRoll disabled={sending} chance={controlChance(me)} onThrow={(power) => void send(power === undefined ? { t: "roll" } : { t: "roll", power })} />
          <div className="flex flex-wrap justify-center gap-1.5">
            {skillBtn}
            {me.uses.pick > 0 && (
              <PickDice onPick={(n) => void send({ t: "pick", n })} uses={me.uses.pick} />
            )}
          </div>
        </>
      );
    }
    case "post":
      return box(
        <>
          <div className="flex items-center gap-2 text-[14px]">
            <DiceFace v={pr.dice[0]} size={26} />
            <DiceFace v={pr.dice[1]} size={26} />
            <b>{pr.steps}칸</b> → <span className="max-w-[120px] truncate">{m.tiles[g.order[slotAhead(g, me.pos, pr.steps)]]?.name}</span>
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            <Btn tone="gold" className="h-[36px] px-4 text-[15px] font-bold" disabled={sending} onClick={() => void send({ t: "keep" })}>
              이대로 가기
            </Btn>
            {me.uses.reroll > 0 && (
              <Btn tone="sky" className="h-[36px] px-3 text-[13px]" disabled={sending} onClick={() => void send({ t: "reroll" })}>
                다시 굴리기 ({me.uses.reroll})
              </Btn>
            )}
            {me.uses.adjust > 0 && (
              <Btn tone="mint" className="h-[36px] px-3 text-[13px]" disabled={sending} onClick={() => void send({ t: "adjust", d: 1 })}>
                한 칸 더 ({me.uses.adjust})
              </Btn>
            )}
            {skillBtn}
          </div>
        </>,
        "어떻게 할까요?"
      );
    case "fork":
      return box(<span className="text-[13px]">보드에서 반짝이는 칸을 눌러 갈 길을 골라요</span>, "어느 길로?");
    case "rail":
      return box(
        <>
          <span className="text-[13px]">반짝이는 역을 누르면 열차로 바로 가요</span>
          <Btn className="h-[34px] px-4 text-[13px]" disabled={sending} onClick={() => void send({ t: "rail", to: -1 })}>
            그냥 남기
          </Btn>
        </>,
        "기차역"
      );
    case "buy": {
      const d = m.tiles[pr.tile];
      const t = g.tiles[pr.tile];
      const owned = pr.from >= 0;
      return box(
        <>
          <div className="text-[12px]">
            {d.group !== undefined && <span className="mr-1 inline-block h-[10px] w-[10px] align-middle" style={{ background: m.groups[d.group].color, boxShadow: "0 0 0 2px #232a4d" }} />}
            {d.group !== undefined ? m.groups[d.group].name : "명소"} · 지금 {owned ? `${LEVEL_NAME[t.lv]} · 통행료 ${fmt(tollOf(gg, pr.tile))}` : `땅값 ${fmt(d.price ?? 0)}`}
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {pr.costs.map((cost, k) => {
              const lv = pr.from + 1 + k;
              const can = cost <= me.cash;
              return (
                <Btn key={lv} tone={lv >= LANDMARK ? "pink" : "gold"} className="h-[46px] min-w-[70px] flex-col gap-0 px-2 leading-[15px]" disabled={!can || sending} onClick={() => void send({ t: "buy", lv })}>
                  <b className="text-[13px]">{LEVEL_NAME[lv]}</b>
                  <span className="text-[11px]">{fmt(cost)}</span>
                </Btn>
              );
            })}
          </div>
          <Btn className="h-[28px] px-3 text-[12px]" disabled={sending} onClick={() => void send({ t: "buy", lv: -1 })}>
            {owned ? "안 지어요" : "안 사요"}
          </Btn>
        </>,
        d.name
      );
    }
    case "acq": {
      const d = m.tiles[pr.tile];
      const t = g.tiles[pr.tile];
      return box(
        <>
          <span className="text-[12px]">
            {g.players[t.owner]?.name} 의 {LEVEL_NAME[t.lv]} · 통행료 {fmt(tollOf(gg, pr.tile))}
          </span>
          <div className="flex gap-2">
            <Btn tone="pink" className="h-[40px] px-4 text-[15px] font-bold" disabled={sending || pr.cost > me.cash} onClick={() => void send({ t: "acq", yes: true })}>
              인수 <Cur k="coin" n={pr.cost} size={12} />
            </Btn>
            <Btn className="h-[40px] px-3 text-[13px]" disabled={sending} onClick={() => void send({ t: "acq", yes: false })}>
              안 해요
            </Btn>
          </div>
        </>,
        `${d.name} 인수할까요?`
      );
    }
    case "fest":
      return box(<span className="text-[13px]">축제를 열 내 땅을 보드에서 눌러요 (통행료 2배)</span>, "축제 무대");
    case "loan":
      return box(
        <>
          <div className="text-[12px] leading-[17px]">
            통행료 <b>{fmt(pr.amt)}</b> · 가진 돈 {fmt(me.cash)} · <b className="text-[#d6455d]">{fmt(pr.need)} 모자라요</b>
            <br />
            대출하면 {fmt(pr.need)}을 빌리고 <b>{fmt(pr.debt)}</b>을 월급의 절반씩 갚아요 (판마다 1번)
          </div>
          <div className="flex gap-2">
            <Btn tone="gold" className="h-[40px] px-4 text-[15px] font-bold" disabled={sending} onClick={() => void send({ t: "loan", yes: true })}>
              대출 받기
            </Btn>
            <Btn className="h-[40px] px-3 text-[13px]" disabled={sending} onClick={() => void send({ t: "loan", yes: false })}>
              {pr.sell + me.cash >= pr.amt ? "땅 팔아서 내기" : "파산하기"}
            </Btn>
          </div>
        </>,
        "파산 위기! 대출할까요?"
      );
    case "start":
      return box(
        <>
          <span className="text-[13px]">반짝이는 내 땅을 누르면 바로 건물을 올려요</span>
          <Btn className="h-[34px] px-4 text-[13px]" disabled={sending} onClick={() => void send({ t: "start", tile: -1 })}>
            안 지을래요
          </Btn>
        </>,
        "출발 포털 · 건설"
      );
  }
}

function slotAhead(g: GameWire, pos: number, steps: number): number {
  const m = MAPS[g.map];
  let s = pos;
  for (let k = 0; k < steps; k++) s = m.id === "cross" ? m.tiles[s].next[0] : (s + 1) % m.tiles.length;
  return s;
}

function PickDice({ onPick, uses }: { onPick(n: number): void; uses: number }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Btn tone="gold" className="h-[36px] px-3 text-[13px]" onClick={() => setOpen(true)}>
        <CurIcon k="coin" size={12} /> 황금 주사위 ({uses})
      </Btn>
    );
  return (
    <div className="flex flex-wrap justify-center gap-1">
      {Array.from({ length: 11 }, (_, k) => k + 2).map((n) => (
        <Btn key={n} tone="gold" className="h-[28px] min-w-[28px] px-1 text-[13px] font-bold" onClick={() => onPick(n)}>
          {n}
        </Btn>
      ))}
    </div>
  );
}

/* ───────────── 띠 · 카드 · 결과 ───────────── */

/** 스킬 컷인: 번쩍 → 비스듬한 띠 + 속도선 → 캐릭터가 미끄러져 들어옴 (그림은 안 잘리게 띠 밖에서) */
function SkillCutin({ b }: { b: Banner }) {
  const g = b.grade ?? "R";
  const rays = g === "SSR" || g === "UR";
  return (
    <div className="pointer-events-none absolute inset-0 z-[60]" style={{ "--d": `${b.ms}ms` } as CSSProperties}>
      <div className="mbx-flash absolute inset-0" />
      <div className="mbx-cut absolute inset-x-[-40px] top-[170px] h-[210px] overflow-hidden" style={{ transform: "skewY(-5deg)", boxShadow: "0 -5px 0 0 #fff, 0 5px 0 0 #fff, 0 -9px 0 0 #232a4d, 0 9px 0 0 #232a4d" }}>
        <img src={`/marble/art/bg-${g}.webp`} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: "center 30%" }} />
        {g === "R" && <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${b.color}88, transparent)` }} />}
        {rays && <div className={`mbx-rays mbx-rays-${g}`} style={{ left: "26%", top: "50%" }} />}
        <div className="mbx-speed absolute inset-0" />
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[rgba(18,13,51,0.55)]" />
      </div>
      {b.art && (
        <img src={b.art} alt="" className="mbx-slide absolute left-[40px] max-w-none object-contain" style={{ top: 96, height: 300, width: 320, filter: "drop-shadow(0 6px 0 rgba(35,42,77,0.5))" }} />
      )}
      <div className="mbx-slide-r absolute right-[70px] top-[222px] max-w-[520px] text-right">
        {g !== "R" && <div className="mb-1 inline-block rounded bg-black/40 px-2 text-[13px] font-black tracking-[0.3em] text-white">{g} SKILL</div>}
        <div className="mb-title text-[46px] leading-[50px] text-white" style={{ WebkitTextStroke: "3px #232a4d", paintOrder: "stroke fill", textShadow: "0 4px 0 #232a4d" }}>
          {b.title}
        </div>
        {b.sub && <div className="mb-out mt-1 text-[16px] text-white">{b.sub}</div>}
      </div>
    </div>
  );
}

function BannerView({ b }: { b: Banner }) {
  if (b.art) return <SkillCutin b={b} />;
  return (
    <div className="mbx pointer-events-none absolute inset-x-0 top-[190px] z-[620] flex justify-center" style={{ "--d": `${b.ms}ms` } as CSSProperties}>
      <div className="mbx-banner relative flex h-[118px] w-full items-center justify-center overflow-hidden" style={{ background: `linear-gradient(90deg, transparent, ${b.color}e6 18%, ${b.color} 50%, ${b.color}e6 82%, transparent)` }}>
        <div className="mbx-rays mbx-soft absolute" style={{ left: "50%", top: "50%", "--ray": "rgba(255,255,255,0.45)", opacity: 0.5 } as CSSProperties} />
        <div className="mbx-sheen absolute inset-0 opacity-60" />
        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: "linear-gradient(90deg, transparent, #fff, transparent)" }} />
        <div className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: "linear-gradient(90deg, transparent, #fff, transparent)" }} />
        <div className="mbx-banner-text relative text-center">
          <div className="text-[46px] leading-[50px] font-black tracking-tight text-white" style={{ textShadow: `0 3px 0 rgba(38,43,82,0.6), 0 0 22px ${b.color}` }}>
            {b.title}
          </div>
          {b.sub && <div className="mt-0.5 text-[15px] font-bold text-white/95" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.5)" }}>{b.sub}</div>}
        </div>
      </div>
    </div>
  );
}

/** 럭키 박스 카드: 상자에서 카드가 휙 뒤집혀 나옴 (좋은 카드 금빛 · 나쁜 카드 붉은빛) */
function CardPop({ id, name }: { id: keyof typeof CARDS; name: string }) {
  const c = CARDS[id];
  const good = c.good >= 0;
  const c1 = good ? "#ffd84d" : "#ff6b8a";
  const c2 = good ? "#ff9f2e" : "#b03a6a";
  return (
    <div className="mbx pointer-events-none absolute inset-0 z-[610] flex items-center justify-center" style={{ background: "radial-gradient(circle, rgba(10,8,30,0.25), rgba(10,8,30,0.6))" }}>
      <div className="mbx-up-rays mbx-soft absolute h-[620px] w-[620px]" style={{ "--ray": `${c1}cc`, opacity: 0.6 } as CSSProperties} />
      <div className="mbx-card-in relative flex h-[320px] w-[230px] flex-col items-center overflow-hidden rounded-[18px] p-[4px]" style={{ background: `linear-gradient(160deg, #fff6c8, ${c1} 40%, ${c2})`, boxShadow: `0 0 0 2px #262b52, 0 0 36px 6px ${c1}aa, 0 14px 30px rgba(0,0,0,0.5)` }}>
        <div className="relative flex h-full w-full flex-col items-center rounded-[14px] px-4 pt-3 pb-4 text-center" style={{ background: "linear-gradient(180deg, #2a2470, #171245)" }}>
          <div className="absolute inset-[6px] rounded-[10px] border border-[#ffd76a]/50" />
          <span className="text-[11px] font-black tracking-[0.3em] text-[#ffd76a]">LUCKY BOX</span>
          <div className="mt-3 flex h-[96px] w-[96px] items-center justify-center rounded-full" style={{ background: `radial-gradient(circle, ${c1}66, transparent 70%)` }}>
            <Icon n={good ? "box" : "x"} size={64} />
          </div>
          <b className="mt-2 text-[26px] leading-[30px] font-black text-white">{c.name}</b>
          <span className="mt-2 rounded-full px-3 py-1 text-[14px] font-bold" style={{ background: `${c1}33`, color: good ? "#ffe8a0" : "#ffc2cf", boxShadow: `inset 0 0 0 1px ${c1}88` }}>
            {c.desc}
          </span>
          <span className="mt-auto text-[12px] text-white/60">{name} 님이 뽑았어요</span>
        </div>
      </div>
    </div>
  );
}

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
  const HOW: Record<string, string> = { bankrupt: "파산승", triple: "트리플 독점", line: "라인 독점", spot: "명소 독점", rounds: "바퀴 끝 · 자산 1등" };
  return (
    <div className="absolute inset-0 z-[700] flex items-center justify-center bg-[rgba(35,42,77,0.45)]">
      <div className="mbx-modal mb-pop w-[460px] px-5 py-4">
        <div className="text-center">
          <div className="mb-title mb-out text-[34px] text-white" style={{ color: mine?.place === 1 ? "#ffc94a" : "#fff" }}>
            {mine ? (mine.place === 1 ? "승리!" : `${mine.place}등`) : "판 끝"}
          </div>
          <div className="text-[13px] text-[var(--mute)]">{g.over ? HOW[g.over.how] : ""}</div>
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          {room.result!.map((r) => {
            const pi = room.order.indexOf(r.seat);
            const p = g.players[pi];
            return (
              <div key={r.seat} className="mb-inset flex items-center gap-2 px-2 py-1.5" style={{ "--bg": `${PCOLOR[pi]}40` } as CSSProperties}>
                <b className="w-[34px] text-center text-[18px]">{r.place}</b>
                <img src={faceOf(CHAR[p.lo.char.id] ?? CHAR.kai)} alt="" className="h-[34px] w-[34px] object-cover" style={{ boxShadow: "0 0 0 2px #232a4d" }} />
                <b className="min-w-0 flex-1 truncate text-[14px]">
                  {r.bot && <Icon n="bot" size={12} />} {r.name}
                </b>
                <span className="text-[12px]">자산 {fmt(assetsOf(g as unknown as Game, pi))}</span>
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
