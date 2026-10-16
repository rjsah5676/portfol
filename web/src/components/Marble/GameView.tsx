"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { serverNow } from "@/lib/api/socket";
import { CHAR, ITEM, SKILL_TARGET, artOf, faceOf, power } from "@/lib/marble/data";
import {
  CARDS,
  LANDMARK,
  RULE,
  LEVEL_NAME,
  TOWN_EVENTS,
  assetsOf,
  baseToll,
  bitsOf,
  builtOf,
  groupOwned,
  investedT,
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
import Board, { Glyph, Piece, type Trail, iso, slotXY as slotPos, spriteOf, type TokenView } from "./Board";
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
  /** 스킬 효과 한 줄 · 대상 */
  desc?: string;
  target?: string;
}

/** 한 번 터지고 사라지는 이펙트 (무대 좌표) */
interface Fx {
  id: number;
  k: "boom" | "ring" | "flame" | "coin" | "zzz";
  x: number;
  y: number;
  dx?: number;
  dy?: number;
  delay?: number;
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
  const [fxs, setFxs] = useState<Fx[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [card, setCard] = useState<{ id: keyof typeof CARDS; p: number } | null>(null);
  const [flash, setFlash] = useState<Record<number, string>>({});
  // 이동 경로 숫자 · 도착 칸 숫자 (보드에 그림)
  const [trail, setTrail] = useState<Trail | null>(null);
  // 못 하고 넘어갈 때 이유 (내 것만 가운데 작은 창)
  const [nope, setNope] = useState<{ id: number; why: string; need?: number; cash: number } | null>(null);
  const lastRoll = useRef<{ p: number; sum: number; dbl: boolean } | null>(null);
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
  const diceAt = { x: iso(4, 4).x, y: iso(4, 4).y + 52 };
  const cardXY = (pi: number) => {
    const n = view.players.length;
    const c = cornerRect(myPi >= 0 ? (pi - myPi + n) % n : pi);
    return { x: c.x + 150, y: c.y + 30 };
  };
  const float = (x: number, y: number, text: string, color = "#232a4d") => {
    // 화면 가장자리에서 글자가 잘리지 않게 (글자 폭 어림)
    const half = Math.min(300, text.length * 9 + 10);
    const f = { id: ++fid, x: Math.max(half, Math.min(1024 - half, x)), y: Math.max(20, y), text, color };
    setFloaters((a) => [...a.slice(-14), f]);
    setTimeout(() => setFloaters((a) => a.filter((o) => o.id !== f.id)), 1200);
  };
  const say = (s: string) => setLog((l) => [...l.slice(-5), s]);
  const spawn = (k: Fx["k"], x: number, y: number, extra: Partial<Fx> = {}, ms = 1300) => {
    const f: Fx = { id: ++fid, k, x, y, ...extra };
    setFxs((a) => [...a.slice(-24), f]);
    setTimeout(() => setFxs((a) => a.filter((o) => o.id !== f.id)), ms + (extra.delay ?? 0));
  };
  /** 카드 → 카드 금화 몇 개 날리기 */
  const coinsFly = (from: number, to: number, n = 4) => {
    const a = cardXY(from);
    const b = cardXY(to);
    for (let k = 0; k < n; k++) spawn("coin", a.x - 60 + k * 8, a.y + 10, { dx: b.x - a.x + 60 - k * 8, dy: b.y - a.y, delay: k * 70 }, 900);
  };
  const tileXY = (cur: GameWire, tile: number) => {
    const c = slotPos(map, slotOfTile(cur, tile));
    return { x: c.x, y: c.y };
  };

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
        lastRoll.current = { p: e.p, sum: e.d[0] + e.d[1], dbl: !!e.dbl };
        if (e.twin) float(diceAt.x, diceAt.y + 70, "쌍둥이 주사위! 더블로 맞춰짐", "#b05cff");
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
        if (e.pull) {
          // 끌려감: 경로 숫자 없이, 맞은 자세로 빠르게 미끄러짐
          const a0 = slotXY(posRef.current[e.p]);
          float(a0.x, a0.y - 44, "끌려가요!", "#e0558c");
          sfx("pull");
          setAnim((a) => a.map((x, i) => (i === e.p ? "hit" : x)));
          for (const s of e.path) {
            setPosOf(e.p, s);
            await wait(110);
          }
          setAnim((a) => a.map((x, i) => (i === e.p ? "idle" : x)));
          const b0 = slotXY(e.path[e.path.length - 1]);
          spawn("ring", b0.x, b0.y + 26);
          await wait(250);
          return;
        }
        // 경로 숫자 1 · 2 · 3 … + 도착 칸 위 굴린 눈 (굴린 바로 뒤 이동일 때만 더블 표시) · 폴짝/묵직한 주사위로 더 간 칸은 +
        const lr = lastRoll.current;
        lastRoll.current = null;
        const tid = ++fid;
        const plus = e.bonus ?? 0;
        const base = e.path.length - plus;
        setTrail({ id: tid, slots: e.path, at: 0, color: PCOLOR[e.p], n: base, plus, dbl: !!lr && lr.p === e.p && lr.dbl && lr.sum === base });
        setAnim((a) => a.map((x, i) => (i === e.p ? "walk" : x)));
        await wait(260);
        for (const [k, s] of e.path.entries()) {
          const from = map.tiles[posRef.current[e.p]];
          const to = map.tiles[s];
          const dx = to.x - from.x;
          if (dx) setFace((f) => f.map((x, i) => (i === e.p ? (dx > 0 ? 1 : -1) : x)));
          setPosOf(e.p, s);
          setTrail((t) => (t && t.id === tid ? { ...t, at: k + 1 } : t));
          if (plus && k === base) {
            const q = slotXY(s);
            float(q.x, q.y - 44, `${e.bonusWhy ?? "폴짝"}! +${plus}칸`, "#2fa36a");
            sfx("hop");
            setAnim((a) => a.map((x, i) => (i === e.p ? "win" : x)));
          }
          setHop((h) => h.map((x, i) => (i === e.p ? x + 1 : x)));
          sfx("step");
          await wait(210);
        }
        setAnim((a) => a.map((x, i) => (i === e.p ? "idle" : x)));
        // 도착 숫자는 잠깐 더 남겼다가 치움 (흐름은 안 막음)
        setTimeout(() => setTrail((t) => (t && t.id === tid ? null : t)), 900);
        await wait(130);
        return;
      }
      case "nope": {
        if (e.p === myPi) {
          const id = ++fid;
          setNope({ id, why: e.why, need: e.need, cash: cur.players[e.p]?.cash ?? 0 });
          sfx("deny");
          setTimeout(() => setNope((n) => (n && n.id === id ? null : n)), 2000);
        } else {
          const xy = slotXY(posRef.current[e.p]);
          float(xy.x, xy.y - 40, e.why, "#6b7280");
        }
        await wait(600);
        return;
      }
      case "salary": {
        setCash((c) => c.map((x, i) => (i === e.p ? x + e.amt : x)));
        const c = cardXY(e.p);
        float(c.x, c.y, e.why ? `${e.why} +${fmt(e.amt)}` : `+${fmt(e.amt)}`, "#2f8a3a");
        sfx(e.pot ? "coins" : "coin");
        if (e.pot) {
          // 황금 다리 잭팟: 크게
          setBanner({ id: ++fid, title: `잭팟! +${fmt(e.amt)}`, sub: `${P(e.p)} · 황금 다리에 쌓인 세금 · 벌금을 몽땅`, color: "#ffb21e", ms: 1700 });
          const q = slotXY(posRef.current[e.p]);
          for (let k = 0; k < 8; k++) spawn("coin", q.x, q.y, { dx: c.x - q.x + (k - 4) * 6, dy: c.y - q.y, delay: k * 60 }, 900);
          await wait(1500);
        }
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
        if (e.to >= 0) {
          coinsFly(e.from, e.to, e.amt >= 300 ? 5 : 3);
          sfx("coins");
        }
        if (e.tile !== undefined) {
          const q = slotXY(slotOfTile(cur, e.tile));
          float(q.x, q.y - 30, `${e.why} ${fmt(e.amt)}${e.shock ? " ⚡감전" : ""}`, "#d43a3a");
          // 깎였으면: 무엇이 얼마를 깎았는지 (방패 · 할인 · 쿠폰)
          if (e.orig && e.by?.length) {
            const skillCut = e.by.find((x) => x !== "통행료 할인" && x !== "반값 쿠폰");
            if (skillCut) {
              spawn("ring", q.x, q.y + 26);
              sfx("shield");
            }
            float(q.x, q.y - 58, `${skillCut ? `${skillCut}! ` : `${e.by.join(" · ")} `}${fmt(e.orig)} → ${fmt(e.amt)}`, "#2f8fc4");
            if (skillCut) patchPlayer(e.from, { shield: 0 });
          }
        }
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
        patchTile(e.tile, { owner: e.p, lv: e.lv, ...(e.b !== undefined && { b: e.b }) });
        setCash((c) => c.map((x, i) => (i === e.p ? x - e.cost : x)));
        flashTile(e.tile, PCOLOR[e.p]);
        const xy = slotXY(slotOfTile(cur, e.tile));
        const nm = LEVEL_NAME[e.top ?? e.lv];
        float(xy.x, xy.y - 30, e.lv >= LANDMARK ? "랜드마크!" : e.cost === 0 ? `${nm} (무료)` : nm, PCOLOR[e.p]);
        sfx(e.lv >= LANDMARK ? "landmark" : "build");
        say(`${P(e.p)} ${MAPS[cur.map].tiles[e.tile].name} ${nm}${e.cost ? ` (${fmt(e.cost)})` : ""}`);
        await wait(800);
        return;
      }
      case "acq": {
        patchTile(e.tile, { owner: e.p });
        setCash((c) => c.map((x, i) => (i === e.p ? x - e.cost : i === e.from ? x + e.cost : x)));
        flashTile(e.tile, PCOLOR[e.p]);
        const xy = slotXY(slotOfTile(cur, e.tile));
        float(xy.x, xy.y - 30, "인수!", PCOLOR[e.p]);
        spawn("ring", xy.x, xy.y + 56);
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
        patchTile(e.tile, { owner: -1, lv: 0, b: 0 });
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
        {
          const q = slotXY(posRef.current[e.p]);
          spawn("zzz", q.x + 10, q.y - 30);
          sfx("sleep");
          float(q.x, q.y - 50, "쿨쿨… 이번 차례는 쉬어요", "#5b6bd6");
          await wait(1100);
          patchPlayer(e.p, { frozen: 0 });
        }
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
        patchPlayer(e.p, { encore: false });
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
        const tg = SKILL_TARGET[e.kind];
        const target =
          e.target === undefined ? (e.n !== undefined && tg === "num" ? `${e.n}` : undefined) : tg === "foe" ? P(e.target) : MAPS[cur.map].tiles[e.target]?.name;
        setBanner({
          id: ++fid,
          title: e.name,
          sub: `${P(e.p)} · ${c?.title ?? ""}`,
          color: c?.color ?? "#ffc94a",
          art: c ? artOf(c) : undefined,
          ms: 1500,
          grade: c?.grade,
          desc: c ? c.active.desc(power(c.grade, pl.lo.char.lv)) : undefined,
          target: target && (tg === "num" ? (e.kind === "dash" ? `${target}칸 이동` : e.kind === "bunny" ? `+${target}칸` : `눈 ${target}`) : `→ ${target}`),
        });
        say(`${P(e.p)} 스킬 「${e.name}」${target ? ` → ${target}` : ""}`);
        await wait(1300);
        // 스킬마다 판 위에 남는 흔적
        if (e.tiles) {
          for (const t of e.tiles) {
            flashTile(t, "#ff9a3d");
            const q = tileXY(cur, t);
            spawn("flame", q.x, q.y);
            patchTile(t, { boostLeft: cur.tiles[t].boostLeft, boost: cur.tiles[t].boost });
          }
          sfx("fest");
        }
        if (e.kind === "freeze" && e.target !== undefined) {
          patchPlayer(e.target, { frozen: 1 });
          const q = slotXY(posRef.current[e.target]);
          spawn("zzz", q.x + 10, q.y - 30);
          sfx("sleep");
          float(q.x, q.y - 50, "쿨쿨… 다음 차례 쉬어요", "#5b6bd6");
          await wait(500);
        }
        if (e.kind === "shield") {
          patchPlayer(e.p, { shield: cur.players[e.p].shield || 0.5 });
          sfx("shield");
        }
        if (e.kind === "hop") sfx("hop");
        if (e.kind === "sale") patchPlayer(e.p, { sale: cur.players[e.p].sale || 0.5 });
        if (e.kind === "encore") patchPlayer(e.p, { encore: true });
        if (e.kind === "hop") patchPlayer(e.p, { hop: true });
        if (e.kind === "debug" && e.target !== undefined) {
          const q = tileXY(cur, e.target);
          patchTile(e.target, { lv: cur.tiles[e.target].lv, b: cur.tiles[e.target].b });
          flashTile(e.target, "#ff4b3d");
          spawn("boom", q.x, q.y - 18);
          sfx("boom");
          float(q.x, q.y - 50, `쾅! ${e.lost !== undefined ? LEVEL_NAME[e.lost] : "건물"} 부서짐`, "#d43a3a");
          await wait(500);
        }
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
        setBanner({ id: ++fid, title: "독점!", sub: `${P(e.p)} · ${MAPS[cur.map].groups[e.group]?.name} 통행료 2배`, color: PCOLOR[e.p], ms: 2300 });
        await wait(2200);
        return;
      case "threat":
        sfx("mono");
        setBanner({
          id: ++fid,
          title: e.kind === "spot" ? "명소 독점 위기!" : e.kind === "triple" ? "트리플 독점 위기!" : "라인 독점 위기!",
          sub:
            e.kind === "spot"
              ? `${P(e.p)} · 명소 ${e.have}/${e.need} — 남은 명소 하나만 사면 승리`
              : e.kind === "triple"
                ? `${P(e.p)} · 동네 ${e.have}/${e.need} 독점 — 하나만 더 하면 승리`
                : `${P(e.p)} · 한 줄 ${e.have}/${e.need}칸 — 한 칸만 더 가지면 승리`,
          color: "#ffb21e",
          ms: 1700,
        });
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
  const patchPlayer = (pi: number, patch: Partial<GameWire["players"][number]>) =>
    setView((v) => ({ ...v, players: v.players.map((p, i) => (i === pi ? { ...p, ...patch } : p)) }));
  const patchTile = (tile: number, patch: { owner?: number; lv?: number; b?: number; boost?: number; boostLeft?: number }) =>
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

  // 내 차례 굴리기 전: 2~12칸 앞이 어디인지 칸에 숫자로
  let reach: Record<number, number> | null = null;
  if (mine && pr && pr.k === "turn" && !pr.jail && !pr.warp && !mode && !trail && myPi >= 0) {
    reach = {};
    for (let n = 2; n <= 12; n++) {
      const s = slotAhead(gg as unknown as GameWire, pos[myPi], n);
      if (reach[s] === undefined) reach[s] = n;
    }
  }

  // 시간 막대
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(id);
  }, []);
  const left = live.deadline ? Math.max(0, live.deadline - serverNow()) : 0;

  // 남이 독점 찬스 칸에서 고민 중이면 머리 위에 크게 (한 번만)
  const chanceKey = pr && pr.k === "buy" && !mine ? `${pr.p}-${pr.tile}-${g.steps}` : "";
  const lastChance = useRef("");
  useEffect(() => {
    if (!chanceKey || chanceKey === lastChance.current || !pr || pr.k !== "buy") return;
    lastChance.current = chanceKey;
    const c = chanceOf(gg, pr.p, pr.tile);
    if (!c) return;
    const q = slotXY(posRef.current[pr.p]);
    float(q.x, q.y - 74, `독점 찬스! ${c}`, "#ff6a2b");
    sfx("news");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 프롬프트가 바뀔 때만
  }, [chanceKey]);
  const tokens: TokenView[] = view.players.flatMap((p, i) => (hide[i] ? [] : [{
    pi: i,
    slot: pos[i],
    sprite: spriteOf(p.lo.char.id),
    anim: anim[i],
    face: face[i],
    hop: hop[i],
    dim: !p.alive,
    say: pr && !mine && pr.p === i ? thinking(pr) : undefined,
    sleep: p.frozen > 0,
    shield: p.shield > 0,
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
      <Board g={view} tokens={tokens} pick={pick} onPick={onPick} onInfo={(t) => setInfo(t)} flash={flash} trail={trail} reach={reach} />
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
            판돈 <CurIcon k="coin" size={14} /> {fmt(cash.reduce((t, c, i) => t + (view.players[i]?.alive ? Math.max(0, c) : 0), 0))}
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
          secs={(live.game?.prompt?.p ?? -1) === i && !busy && left > 0 ? Math.ceil(left / 1000) : 0}
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

      {fxs.map((f) => (
        <FxView key={f.id} f={f} />
      ))}

      {banner && <BannerView key={banner.id} b={banner} />}
      {card && <CardPop id={card.id} name={nameOf(card.p)} />}
      {nope && <NopeToast key={nope.id} why={nope.why} need={nope.need} cash={nope.cash} />}
      {intro && <OrderIntro pi={myPi} n={g0.players.length} />}
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
  secs,
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
  /** 이 사람 차례 남은 초 (사람만, 0 = 안 보임) */
  secs: number;
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
  // 동네별로 가진 칸 수 (색 점)
  const m = MAPS[g.map];
  const spotAll = m.tiles.filter((d) => d.kind === "spot").length;
  const spotN = m.tiles.filter((d, ti) => d.kind === "spot" && g.tiles[ti].owner === i).length;
  const groups = m.groups.map((gr, gi) => ({ color: gr.color, n: m.tiles.filter((d, ti) => d.group === gi && g.tiles[ti].owner === i).length })).filter((x) => x.n > 0);
  const dice = p.lo.dice ? ITEM[p.lo.dice.id] : null;
  const buddy = p.lo.buddy ? ITEM[p.lo.buddy.id] : null;
  const r = cornerRect(corner);
  const uses = p.uses.adjust + p.uses.pick + p.uses.reroll + p.uses.rewind;
  return (
    <div className={`absolute z-[420] cursor-pointer ${shake ? "mb-shake" : ""} ${pickable ? "mb-blink" : ""}`} style={r.y > 288 ? { left: r.x, bottom: 10, width: r.w } : { left: r.x, top: r.y, width: r.w }} onClick={pickable ? onPick : onInfo} title={pickable ? undefined : "눌러서 장착 · 효과 보기"}>
      {/* 모두의마블처럼 카드 옆 빈자리에 쌓인 금화 */}
      <div className={`pointer-events-none absolute ${r.x < 512 ? "left-[calc(100%+8px)]" : "right-[calc(100%+8px)]"} ${r.y < 288 ? "top-[22px]" : "bottom-[10px]"}`}>
        <CoinStack cash={cash} />
      </div>
      <div className={`mb-box relative overflow-visible ${turn ? "mb-turn" : ""}`} style={{ "--c": PCOLOR[i], "--bg": "#ffffff", opacity: p.alive ? 1 : 0.55 } as CSSProperties}>
        {/* 이름 띠 */}
        <div className="flex h-[26px] items-center gap-1.5 rounded-t-[14px] pr-2 pl-[86px]" style={{ background: PCOLOR[i], boxShadow: "inset 0 -3px 0 rgba(0,0,0,0.18), inset 0 3px 0 rgba(255,255,255,0.3)" }}>
          {seat?.bot ? <Icon n="bot" size={13} /> : me ? <Icon n="crown" size={13} /> : null}
          <span className="rounded-[4px] bg-white px-[4px] text-[10px] leading-[14px] font-black" style={{ color: PCOLOR[i] }}>
            {i + 1}P
          </span>
          <b className="mb-out-s min-w-0 flex-1 truncate text-[14px] text-white">{p.name}</b>
          {seat?.auto && <span className="mb-chip text-[10px]">자동</span>}
          {seat?.away && <span className="mb-chip text-[10px]">끊김</span>}
          {!p.alive && <span className="mb-chip text-[10px]">파산</span>}
          {secs > 0 && (
            <span className={`rounded-full px-1.5 text-[11px] leading-[16px] font-black ${secs <= 5 ? "bg-[#ff3d6e] text-white" : "bg-white/90 text-[#232a4d]"}`}>{secs}초</span>
          )}
        </div>
        {/* 얼굴 (띠 위로 튀어나오게) */}
        <div className="absolute top-[-10px] left-[8px] h-[72px] w-[72px] overflow-hidden rounded-[12px] bg-white" style={{ boxShadow: "0 0 0 3px #232a4d" }}>
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
            <Cur k="coin" n={Math.max(0, cash)} size={18} />
          </div>
          <div className="flex items-center gap-1 text-[11px] leading-[14px] whitespace-nowrap text-[var(--mute)]">
            자산 <b className="text-[var(--ink2)]">{fmt(Math.max(0, assets + p.debt))}</b>
            {p.debt > 0 ? <b className="text-[#e0384b]">· 빚 {fmt(p.debt)}</b> : <span>· 땅 {tiles}</span>}
          </div>
          <div className="mt-[2px] flex h-[13px] items-center gap-1 text-[10px] leading-none whitespace-nowrap text-[var(--mute)]">
            {p.debt > 0 && <span>땅 {tiles}</span>}
            {spotN > 0 && (
              <span className="flex h-[12px] items-center rounded-[3px] px-[3px] text-[9px] leading-none font-black text-[#5a3a00]" style={{ background: spotN === spotAll - 1 ? "#ff6a2b" : "#ffb21e", color: spotN === spotAll - 1 ? "#fff" : "#5a3a00", boxShadow: "0 0 0 1px rgba(35,42,77,0.5)" }} title={`명소 ${spotN}/${spotAll} — 전부 가지면 승리`}>
                ★{spotN}/{spotAll}
              </span>
            )}
            {groups.length > 0 && (
              <span className="flex items-center gap-[2px]" title="동네별 가진 칸">
                {groups.slice(0, 6).map((x, k) => (
                  <span key={k} className="flex h-[12px] min-w-[12px] items-center justify-center rounded-[3px] px-[2px] text-[9px] leading-none font-black text-white" style={{ background: x.color, boxShadow: "0 0 0 1px rgba(35,42,77,0.5)" }}>
                    {x.n}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1 px-2 pt-1.5 pb-2 text-[11px]">
          <span className="mb-chip" title={c ? `${c.active.name} — ${c.active.desc(power(c.grade, p.lo.char.lv))}` : ""} style={{ "--c": p.cd === 0 ? "#ffe24a" : "#e3e8f7" } as CSSProperties}>
            <Icon n="star" size={10} />
            {c?.active.name}
            {p.cd > 0 && <span className="text-[var(--mute)]">{p.cd}턴</span>}
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
          {p.frozen > 0 && <span className="mb-chip" style={{ "--c": "#dfe3ff" } as CSSProperties}><b style={{ color: "#5b6bd6" }}>Zz</b>쿨쿨 1턴</span>}
          {p.shield > 0 && <span className="mb-chip" style={{ "--c": "#cdefff" } as CSSProperties}><Icon n="shield" size={10} />방패 −{Math.round(p.shield * 100)}%</span>}
          {p.encore && <span className="mb-chip" style={{ "--c": "#ffe1ef" } as CSSProperties}>앙코르 대기</span>}
          {p.hop && <span className="mb-chip" style={{ "--c": "#d8f7e4" } as CSSProperties}>폴짝 준비</span>}
          {p.keep.half > 0 && <span className="mb-chip">반값</span>}
          {p.keep.free > 0 && <span className="mb-chip">무료공사</span>}
          {(p.keep.acq > 0 || p.sale > 0) && <span className="mb-chip">인수할인{p.sale > 0 ? ` −${Math.round(p.sale * 100)}%` : ""}</span>}
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
    jail: `더블이 나오거나 두 번 쉬어야 나가요. ${RULE.jailPay}코인 내면 바로 나가요.`,
    fest: "내 땅 하나를 골라 축제 (통행료 2배)",
    warp: "다음 차례에 원하는 칸으로 순간이동",
    tax: "땅 · 건물 값의 10% 를 세금으로",
    bonus: `서면 +${RULE.bonus}코인 + 잭팟 (세금 · 벌금 · 수리비로 은행에 낸 돈이 여기 쌓여요)`,
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
                  {d.kind === "spot" && " · 가진 명소 수만큼 통행료 2배씩, 전부 가지면 명소 독점 승리 · 인수나 스킬로 뺏기지 않아요"}
                </div>
              )}
              {rows.length > 1 && (
                <div className="overflow-hidden rounded-xl ring-1 ring-white/10">
                  <div className="grid grid-cols-[1.1fr_0.9fr_1.3fr_0.5fr] bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white/65">
                    <span>건물</span>
                    <span className="text-right">값</span>
                    <span className="text-right">다 지으면 통행료</span>
                    <span className="text-right">지음</span>
                  </div>
                  {rows.map((lv) => {
                    const has = owner && (lv === 0 || (lv === LANDMARK ? t.lv >= LANDMARK : builtOf(t).includes(lv)));
                    return (
                      <div key={lv} className="grid grid-cols-[1.1fr_0.9fr_1.3fr_0.5fr] px-3 py-1.5" style={has ? { background: `${PCOLOR[t.owner]}33`, fontWeight: 800 } : undefined}>
                        <span>{LEVEL_NAME[lv]}</span>
                        <span className="text-right text-white/80">{fmt(Math.round((d.price ?? 0) * RULE.cost[lv]))}</span>
                        <span className="text-right text-[#ffe08a]">{fmt(baseToll(d.price ?? 0, lv))}</span>
                        <span className="text-right font-bold text-[#7dffb0]">{has ? "✓" : ""}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {owner && d.kind === "city" && t.lv < LANDMARK && (
                <div className="text-[12px] text-white/65">
                  인수하려면 <b className="text-white">{fmt(investedT(d.price ?? 0, t))}</b> · 랜드마크가 되면 인수 불가
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
      className="mbx-skill relative flex h-[54px] items-center gap-2 rounded-full pr-4 pl-1 text-left text-white transition hover:scale-105 disabled:opacity-50"
      style={{ background: "linear-gradient(135deg, #b46bff, #ff5fa2)", boxShadow: "0 0 0 2px #fff, 0 4px 0 #6a2a9a, 0 0 22px 4px rgba(255,95,162,0.65)" }}
    >
      <img src={faceOf(c)} alt="" className="h-[42px] w-[42px] rounded-full object-cover" style={{ boxShadow: "0 0 0 2px #fff" }} />
      <span className="flex flex-col leading-[15px]">
        <span className="mbx-skilltag mb-[2px] self-start rounded-full bg-[#2a1250] px-[7px] text-[11px] leading-[16px] font-black tracking-[0.08em] text-[#ffe08a]" style={{ boxShadow: "0 0 0 1.5px #ffe08a" }}>
          ★ 스킬 준비됨!
        </span>
        <b className="text-[16px] leading-[18px]" style={{ textShadow: "0 1px 2px rgba(60,10,80,0.6)" }}>
          {c.active.name} <span className="text-[11px] font-bold text-white/85">· 눌러서 쓰기</span>
        </b>
      </span>
    </button>
  );
  /** 굴리기 옆 큰 스킬 버튼 (ROLL 과 나란히) */
  const skillOrb = c ? (
    skillOk ? (
      <button
        type="button"
        disabled={sending}
        onClick={() => {
          sfx("click");
          skill();
        }}
        title={c.active.desc(power(c.grade, me.lo.char.lv))}
        className="mbx-skill group relative flex h-[112px] w-[112px] cursor-pointer flex-col items-center justify-center rounded-full transition hover:scale-105 disabled:opacity-50"
        style={{ background: "conic-gradient(from 0deg, #ff5fa2, #b46bff, #5fb8ff, #ffe08a, #ff5fa2)", boxShadow: "0 0 0 3px #fff, 0 6px 0 #6a2a9a, 0 0 30px 8px rgba(255,95,162,0.7)" }}
      >
        <img src={faceOf(c)} alt="" className="h-[98px] w-[98px] rounded-full object-cover" style={{ boxShadow: "inset 0 0 0 2px #fff" }} />
        <span className="mbx-skilltag absolute -top-[10px] rounded-full px-[8px] text-[12px] leading-[18px] font-black tracking-[0.12em]" style={{ boxShadow: "0 0 0 2px #ffe08a, 0 2px 6px rgba(0,0,0,0.4)" }}>
          SKILL
        </span>
        <span className="absolute -bottom-[12px] max-w-[130px] truncate rounded-full bg-gradient-to-r from-[#b46bff] to-[#ff5fa2] px-[10px] text-[13px] leading-[22px] font-black whitespace-nowrap text-white" style={{ boxShadow: "0 0 0 2px #fff, 0 2px 6px rgba(0,0,0,0.4)" }}>
          {c.active.name}
        </span>
      </button>
    ) : g.round <= 1 && pr.k === "turn" && !pr.jail && !pr.warp ? (
      <span className="relative flex h-[96px] w-[96px] flex-col items-center justify-center rounded-full bg-black/35 ring-2 ring-white/30">
        <img src={faceOf(c)} alt="" className="h-[84px] w-[84px] rounded-full object-cover opacity-50 grayscale" />
        <span className="absolute -bottom-[10px] rounded-full bg-[#2a2550] px-[8px] text-[11px] leading-[20px] font-bold whitespace-nowrap text-white/85 ring-1 ring-white/30">스킬은 2바퀴부터</span>
      </span>
    ) : null
  ) : null;
  const skillBox =
    skillBtn ||
    (g.round <= 1 && pr.k === "turn" && !pr.jail && !pr.warp && c ? (
      <span className="flex h-[30px] items-center gap-1.5 rounded-full bg-white/10 px-3 text-[12px] font-bold text-white/70 ring-1 ring-white/15">
        <img src={faceOf(c)} alt="" className="h-[22px] w-[22px] rounded-full object-cover opacity-60 grayscale" />
        스킬은 2바퀴부터 쓸 수 있어요
      </span>
    ) : null);

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
          <div className="relative">
            <PowerRoll disabled={sending} chance={controlChance(me)} onThrow={(power) => void send(power === undefined ? { t: "roll" } : { t: "roll", power })} />
            {skillOrb && <div className="absolute top-[80px] left-[calc(50%+96px)] -translate-y-1/2">{skillOrb}</div>}
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
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
            {skillBox}
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
          {chanceOf(gg, myPi, pr.tile) && (
            <span className="mbx-hot rounded-full bg-[#ff6a2b] px-3 text-[13px] leading-[24px] font-black text-white">독점 찬스! {chanceOf(gg, myPi, pr.tile)}</span>
          )}
          <BuyPick key={`${pr.tile}-${pr.from}`} g={gg} pr={pr} cash={me.cash} mapId={m.id} pi={myPi} sending={sending} send={send} />
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
          {(me.sale > 0 || me.keep.acq > 0) && (
            <span className="rounded-full bg-[#2fc37a]/20 px-2.5 text-[12px] leading-[20px] font-bold text-[#7dffb0] ring-1 ring-[#2fc37a]/50">
              {[me.sale > 0 && `${CHAR[me.lo.char.id]?.active.name ?? "스킬"} −${Math.round(me.sale * 100)}%`, me.keep.acq > 0 && "부동산 세일 −30%"].filter(Boolean).join(" · ")} 적용됨
            </span>
          )}
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
      return box(<SellPick key={`${pr.tile}-${g.steps}`} g={gg} pr={pr} cash={me.cash} sending={sending} send={send} />, "통행료가 모자라요!");
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
    <div className="pointer-events-none absolute inset-0 z-[630]" style={{ "--d": `${b.ms}ms` } as CSSProperties}>
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
        {(b.desc || b.target) && (
          <div className="mt-2 flex flex-col items-end gap-1.5">
            {b.target && <span className="rounded-full bg-[#ffd23a] px-3 text-[18px] leading-[30px] font-black text-[#3a2500] shadow-[0_3px_0_#232a4d]">{b.target}</span>}
            {b.desc && <span className="max-w-[460px] rounded-lg [word-break:keep-all] [text-wrap:balance] bg-[rgba(20,14,60,0.82)] px-3 py-1 text-[14px] leading-[20px] font-bold text-white ring-1 ring-white/20">{b.desc}</span>}
          </div>
        )}
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
  const HOW: Record<string, string> = { bankrupt: "모두 파산시킴", triple: "트리플 독점", line: "라인 독점", spot: "명소 독점", rounds: "바퀴 끝 · 자산 1등" };
  const winner = g.over ? g.players[g.over.winner] : null;
  const myPi = mine ? room.order.indexOf(mine.seat) : -1;
  const st = myPi >= 0 ? g.players[myPi].stat : null;
  return (
    <div className="absolute inset-0 z-[700] flex items-center justify-center bg-[rgba(35,42,77,0.45)]">
      <div className="mbx-modal mb-pop w-[460px] px-5 py-4">
        <div className="text-center">
          <div className="mb-title mb-out text-[34px] text-white" style={{ color: mine?.place === 1 ? "#ffc94a" : "#fff" }}>
            {mine ? (mine.place === 1 ? "승리!" : `${mine.place}등`) : "판 끝"}
          </div>
          {g.over && winner && (
            <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-0.5 text-[13px] text-white ring-1 ring-white/15">
              <b style={{ color: PCOLOR[g.over.winner] }}>{winner.name}</b> 승리 · {HOW[g.over.how]}
            </div>
          )}
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
                <span className="text-[12px] whitespace-nowrap">
                  {p.alive ? `자산 ${fmt(Math.max(0, assetsOf(g as unknown as Game, pi) + p.debt))}` : "파산"}
                  {p.alive && p.debt > 0 && <span className="text-[#ff9aa5]"> · 빚 {fmt(p.debt)}</span>}
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
            {[
              ["받은 돈", fmt(st.got)],
              ["낸 돈", fmt(st.paid)],
              ["지은 건물", st.built],
              ["인수", st.acq],
              ["스킬", st.skill],
            ].map(([k, v]) => (
              <div key={k as string} className="mb-inset rounded-lg px-1 py-1.5">
                <div className="text-[10px] text-[var(--mute)]">{k}</div>
                <b className="text-[14px]">{v}</b>
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

/** 짓기 고르기: 살 수 있는 건 처음부터 다 골라 둠 · 눌러서 빼고 넣기 · 땅을 빼면 전부 빠짐 */
function BuyPick({ g, pr, cash, mapId, pi, sending, send }: { g: Game; pr: Extract<Prompt, { k: "buy" }>; cash: number; mapId: string; pi: number; sending: boolean; send(a: Action): Promise<unknown> }) {
  const owned = pr.from >= 0;
  const costOf = (k: number) => pr.costs[pr.items.indexOf(k)];
  const [sel, setSel] = useState<number[]>(() => {
    const out: number[] = [];
    let left = cash;
    for (const k of pr.items) {
      const c = costOf(k);
      if (!owned && k !== 0 && !out.includes(0)) break;
      if (c <= left) {
        out.push(k);
        left -= c;
      } else if (!owned && k === 0) break;
    }
    return out;
  });
  const total = sel.reduce((a, k) => a + costOf(k), 0);
  // 고른 대로 지으면 통행료 (독점 · 축제 · 마을 소식까지 지금 판 그대로 셈)
  const tollNow = owned ? tollOf(g, pr.tile) : 0;
  const tollAfter = useMemo(() => {
    if (!sel.length) return 0;
    const t = g.tiles[pr.tile];
    let b = owned ? bitsOf(t) : 0;
    for (const k of sel) if (k >= 1 && k <= 3) b |= 1 << (k - 1);
    const lv = sel.includes(LANDMARK) ? LANDMARK : (b & 1) + ((b >> 1) & 1) + ((b >> 2) & 1);
    const tiles = g.tiles.map((x, i) => (i === pr.tile ? { ...x, owner: pi, lv, b: lv >= LANDMARK ? 7 : b } : x));
    return tollOf({ ...g, tiles } as Game, pr.tile);
  }, [g, pr.tile, sel, owned, pi]);
  const over = total > cash;
  const toggle = (k: number) => {
    sfx("click");
    setSel((cur) => {
      if (cur.includes(k)) return k === 0 ? [] : cur.filter((x) => x !== k);
      const next = [...cur, k];
      if (!owned && !next.includes(0)) next.push(0);
      return next.sort((a, b) => a - b);
    });
  };
  return (
    <>
      <div className="flex flex-wrap justify-center gap-1.5">
        {pr.items.map((k) => {
          const on = sel.includes(k);
          const cost = costOf(k);
          return (
            <button
              key={k}
              type="button"
              disabled={sending}
              onClick={() => toggle(k)}
              className="relative flex h-[90px] w-[74px] cursor-pointer flex-col items-center justify-end rounded-xl pb-1.5 transition hover:-translate-y-0.5"
              style={{
                background: on ? (k >= LANDMARK ? "linear-gradient(180deg,#ffb3d6,#ff6fae)" : "linear-gradient(180deg,#ffe48a,#ffbf35)") : "rgba(255,255,255,0.08)",
                boxShadow: on ? "0 3px 0 #b9741a, 0 0 0 2px #fff" : "inset 0 0 0 1.5px rgba(255,255,255,0.25)",
                color: on ? "#3a2500" : "rgba(255,255,255,0.6)",
              }}
            >
              <span className={`absolute top-1 right-1 flex h-[17px] w-[17px] items-center justify-center rounded-full text-[11px] font-black ${on ? "bg-[#2fc37a] text-white" : "bg-black/30 text-transparent ring-1 ring-white/30"}`}>✓</span>
              <span className="flex h-[40px] items-end justify-center" style={on ? undefined : { filter: "grayscale(0.85)", opacity: 0.5 }}>
                {k <= 0 ? <Glyph n="flag" size={30} color={PCOLOR[pi]} /> : k >= LANDMARK ? <img src={`/marble/lm/${mapId}-${pr.tile}.webp`} alt="" className="h-[40px] max-w-none" /> : <Piece n={k - 1} owner={pi} h={38} />}
              </span>
              <b className="text-[13px] leading-[16px]">{LEVEL_NAME[k]}</b>
              <span className="text-[12px] leading-[14px] font-bold">{cost === 0 ? "무료" : fmt(cost)}</span>
            </button>
          );
        })}
      </div>
      <div className="flex w-full items-center justify-center gap-2">
        <span className="flex items-baseline gap-1.5 rounded-full bg-black/30 px-3 py-1 ring-1 ring-white/15">
          <span className="text-[11px] text-white/60">합계</span>
          <b className={`text-[20px] leading-none ${over ? "text-[#ff7b8a]" : "text-[#ffe08a]"}`}>{fmt(total)}</b>
          <span className="text-[11px] text-white/50">/ 가진 돈 {fmt(cash)}</span>
        </span>
      </div>
      {sel.length > 0 && (
        <div className="flex items-center justify-center gap-1.5 text-[12px] text-white/75">
          <span>지으면 통행료</span>
          {owned && (
            <>
              <span className="text-white/55 line-through decoration-white/40">{fmt(tollNow)}</span>
              <span className="text-white/55">→</span>
            </>
          )}
          <b className="text-[15px] text-[#7dffb0]">{fmt(tollAfter)}코인</b>
        </div>
      )}
      <div className="flex gap-2">
        <Btn tone="gold" className="h-[36px] min-w-[120px] px-4 text-[14px] font-black" disabled={sending || over || !sel.length} onClick={() => void send({ t: "buy", lv: Math.max(...sel), pick: sel })}>
          {over ? "돈이 모자라요" : owned ? "짓기" : "사기"}
        </Btn>
        <Btn className="h-[36px] px-3 text-[13px]" disabled={sending} onClick={() => void send({ t: "buy", lv: -1 })}>
          {owned ? "안 지어요" : "안 사요"}
        </Btn>
      </div>
    </>
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
          <b className="text-[88px] leading-[96px]" style={{ color: PCOLOR[pi] }}>{pi + 1}</b>
          <b className="text-[40px]">번째</b>
        </div>
        <span className="mt-1 rounded-full px-4 text-[16px] leading-[30px] font-black text-white" style={{ background: PCOLOR[pi], boxShadow: "0 0 0 2.5px #fff, 0 4px 0 rgba(0,0,0,0.3)" }}>
          {pi + 1}P · {n}명 중
        </span>
      </div>
    </div>
  );
}

/** 남의 차례: 그 사람 말 위에 뭘 하는 중인지 */
function thinking(pr: Prompt): string {
  switch (pr.k) {
    case "turn":
      return pr.warp ? "워프할 곳 고르는 중…" : pr.jail ? "수리소 탈출 고민 중…" : "주사위 굴리는 중…";
    case "post":
      return "어떻게 갈지 고민 중…";
    case "fork":
      return "갈 길 고르는 중…";
    case "rail":
      return "열차 탈지 고민 중…";
    case "buy":
      return pr.from < 0 ? "땅 구매 중…" : "건물 짓는 중…";
    case "acq":
      return "인수할지 고민 중…";
    case "fest":
      return "축제 열 곳 고르는 중…";
    case "start":
      return "지을 땅 고르는 중…";
    case "loan":
      return "대출 고민 중…";
    default:
      return "생각 중…";
  }
}

/** 못 하고 넘어감: 화면 가운데 위쪽 작은 창 (흐름은 안 막고 2초 뒤 사라짐) */
function NopeToast({ why, need, cash }: { why: string; need?: number; cash: number }) {
  const title = why.includes("인수") ? "인수 불가" : why.includes("축제") ? "축제 불가" : "건설 불가";
  return (
    <div className="pointer-events-none absolute top-[118px] left-1/2 z-[615] -translate-x-1/2">
      <div className="mbx-pop mbx-modal flex min-w-[260px] flex-col items-center px-5 py-3 text-center">
        <b className="mb-title flex items-center gap-1.5 text-[15px]">
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#ff6b6b] text-[12px] font-black text-white">!</span>
          {title}
        </b>
        <span className="mt-1 text-[13px] text-white">{why}</span>
        {need !== undefined && (
          <span className="mt-0.5 text-[12px] text-white/65">
            필요 <b className="text-[#ff9aa5]">{fmt(need)}</b> · 가진 돈 {fmt(cash)}
          </span>
        )}
      </div>
    </div>
  );
}


/** 한 번 터지는 이펙트 (쾅 · 고리 · 불꽃 · 금화 · 쿨쿨) */
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
  if (f.k === "flame")
    return (
      <svg className="mbx-fx-flame pointer-events-none absolute z-[505]" style={base} width="44" height="56" viewBox="0 0 44 56" aria-hidden>
        <path d="M22 2c4 10 16 16 16 30a16 16 0 01-32 0c0-8 5-12 8-17 1 5 3 8 6 9-1-9 0-16 2-22z" fill="#ff6a2b" stroke="#fff" strokeWidth="2" />
        <path d="M22 26c3 5 8 8 8 15a8 8 0 01-16 0c0-4 3-7 4-9 1 3 2 4 3 4 0-4 0-7 1-10z" fill="#ffd23a" />
      </svg>
    );
  // boom: 쾅 (별 모양 폭발)
  return (
    <svg className="mbx-fx-boom pointer-events-none absolute z-[505]" style={base} width="110" height="110" viewBox="-55 -55 110 110" aria-hidden>
      <path d="M0-50 L12-18 L46-24 L22 2 L44 30 L10 22 L0 52 L-10 22 L-44 30 L-22 2 L-46-24 L-12-18 Z" fill="#ffd23a" stroke="#ff4b3d" strokeWidth="4" strokeLinejoin="round" />
      <circle r="14" fill="#fff" />
    </svg>
  );
}

/** 이 칸을 사면 독점 · 승리가 되는지 (구매창 · 남의 차례 알림) */
function chanceOf(g: Game, pi: number, tile: number): string | null {
  const m = MAPS[g.map];
  const d = m.tiles[tile];
  const mine = (t: number) => t === tile || g.tiles[t].owner === pi;
  if (d.kind === "spot") {
    const spots = m.tiles.map((x, i) => (x.kind === "spot" ? i : -1)).filter((i) => i >= 0);
    return spots.length > 1 && spots.every(mine) ? "사면 명소 독점 승리!" : null;
  }
  if (d.kind !== "city") return null;
  const slot = g.order.indexOf(tile);
  for (const line of m.lines) {
    const tiles = line.map((s) => (m.id === "orgel" ? g.order[s] : s)).filter((t) => m.tiles[t].kind === "city" || m.tiles[t].kind === "spot");
    if (line.includes(m.id === "orgel" ? slot : tile) && tiles.length > 2 && tiles.every(mine)) return "사면 라인 독점 승리!";
  }
  if (d.group === undefined) return null;
  const grp = m.tiles.map((x, i) => (x.group === d.group ? i : -1)).filter((i) => i >= 0);
  if (!grp.every(mine)) return null;
  const others = m.groups.filter((_, gi) => gi !== d.group && groupOwned(g, gi) === pi).length;
  return others + 1 >= RULE.triple ? "사면 트리플 독점 승리!" : "사면 동네 독점 · 통행료 2배";
}


/** 통행료 모자람: 팔 땅을 직접 고르기 · 대출 · 파산 */
function SellPick({ g, pr, cash, sending, send }: { g: Game; pr: Extract<Prompt, { k: "loan" }>; cash: number; sending: boolean; send(a: Action): Promise<unknown> }) {
  const m = MAPS[g.map];
  const lands = pr.lands ?? [];
  const [sel, setSel] = useState<number[]>([]);
  const got = lands.filter((l) => sel.includes(l.tile)).reduce((a, l) => a + l.got, 0);
  const total = lands.reduce((a, l) => a + l.got, 0);
  const short = Math.max(0, pr.amt - cash - got);
  const canLoan = pr.canLoan !== false;
  const toggle = (t: number) => {
    sfx("click");
    setSel((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  };
  return (
    <>
      <div className="text-[12px] leading-[17px]">
        통행료 <b>{fmt(pr.amt)}</b> · 가진 돈 {fmt(cash)} · <b className="text-[#ff8a9a]">{fmt(pr.amt - cash)} 모자라요</b>
      </div>
      {lands.length > 0 && (
        <>
          <div className="text-[11px] text-white/60">팔 땅을 골라요 (넣은 돈의 절반을 받아요)</div>
          <div className="flex max-h-[118px] w-full flex-wrap justify-center gap-1 overflow-y-auto">
            {lands.map((l) => {
              const d = m.tiles[l.tile];
              const t = g.tiles[l.tile];
              const on = sel.includes(l.tile);
              const band = d.kind === "spot" ? "#ffb21e" : d.group !== undefined ? m.groups[d.group].color : "#8d9bb3";
              return (
                <button
                  key={l.tile}
                  type="button"
                  onClick={() => toggle(l.tile)}
                  className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-bold transition"
                  style={{ background: on ? "#ffe08a" : "rgba(255,255,255,0.08)", color: on ? "#3a2500" : "#fff", boxShadow: on ? "0 0 0 2px #fff" : "inset 0 0 0 1px rgba(255,255,255,0.2)" }}
                >
                  <span className="h-[9px] w-[9px] rounded-sm" style={{ background: band }} />
                  {d.name}
                  {t.lv > 0 && <span className="opacity-70">· {LEVEL_NAME[t.lv]}</span>}
                  <span style={{ color: on ? "#2f8a3a" : "#7dffb0" }}>+{fmt(l.got)}</span>
                </button>
              );
            })}
          </div>
          <div className="text-[12px]">
            고른 땅 <b className="text-[#7dffb0]">+{fmt(got)}</b> · {short > 0 ? <b className="text-[#ff8a9a]">아직 {fmt(short)} 모자라요</b> : <b className="text-[#7dffb0]">낼 수 있어요</b>}
          </div>
        </>
      )}
      <div className="flex flex-wrap justify-center gap-1.5">
        {lands.length > 0 && (
          <Btn tone="gold" className="h-[38px] px-3 text-[13px] font-bold" disabled={sending || !sel.length} onClick={() => void send({ t: "loan", yes: false, sell: sel })}>
            {short > 0 ? "고른 땅 팔고 나머지는 자동" : "고른 땅 팔고 내기"}
          </Btn>
        )}
        {canLoan && (
          <Btn tone="sky" className="h-[38px] px-3 text-[13px] font-bold" disabled={sending} onClick={() => void send({ t: "loan", yes: true, sell: sel })} title={`모자란 만큼 빌리고 ${Math.round(RULE.loanRate * 100)}% 를 월급의 절반씩 갚아요 (판마다 1번)`}>
            {sel.length ? "고른 땅 팔고 나머지 대출" : `대출 받기 (갚을 돈 ${fmt(pr.debt)})`}
          </Btn>
        )}
        <Btn className="h-[38px] px-3 text-[12px]" disabled={sending} onClick={() => void send({ t: "loan", yes: false })}>
          {total + cash >= pr.amt ? "싼 땅부터 자동으로 팔기" : "파산하기"}
        </Btn>
      </div>
    </>
  );
}
