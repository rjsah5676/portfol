"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { serverNow } from "@/lib/api/socket";
import { CHAR, GRADE_COLOR, ITEM, SKILL_TARGET, artOf, faceOf, power } from "@/lib/marble/data";
import {
  CARDS,
  LANDMARK,
  LEVEL_NAME,
  TOWN_EVENTS,
  assetsOf,
  baseToll,
  investedOf,
  canSkill,
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
import { sfx } from "./audio";
import Board, { iso, slotXY as slotPos, spriteOf, type TokenView } from "./Board";
import { Btn, Cur, DiceFace, GradeTag, Icon, PCOLOR, PNAME_BG, fmt } from "./pixel";
import { RoomTools } from "./Room";
import type { TokenAnim } from "./Token";

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
  const [face, setFace] = useState<(1 | -1)[]>(() => g0.players.map(() => 1));
  const [hop, setHop] = useState<number[]>(() => g0.players.map(() => 0));
  const [cash, setCash] = useState<number[]>(() => g0.players.map((p) => p.cash));
  const [dice, setDice] = useState<{ d: [number, number]; roll: number; p: number } | null>(null);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [card, setCard] = useState<{ id: keyof typeof CARDS; p: number } | null>(null);
  const [flash, setFlash] = useState<Record<number, string>>({});
  const [log, setLog] = useState<string[]>([]);
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
        setDice({ d: e.d, roll: ++fid, p: e.p });
        sfx("dice");
        await wait(700);
        say(`${P(e.p)} 주사위 ${e.d[0]}+${e.d[1]}${e.dbl ? " 더블!" : ""}${e.how === "pick" ? " (골라 굴림)" : e.how === "reroll" ? " (다시 굴림)" : ""}`);
        if (e.dbl) float(slotXY(posRef.current[e.p]).x, slotXY(posRef.current[e.p]).y - 40, "더블!", "#e0558c");
        await wait(400);
        return;
      }
      case "move": {
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
        setBanner({ id: ++fid, title: e.name, sub: `${P(e.p)} · ${c?.title ?? ""}`, color: c?.color ?? "#ffc94a", art: c ? artOf(c) : undefined, ms: 1200 });
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
    } else if (pr.k === "turn" && pr.warp) {
      pick = map.tiles.map((_, s) => g.order[s]).filter((t) => map.tiles[t].kind !== "warp");
      onPick = (t) => void send({ t: "warp", to: g.order.indexOf(t) });
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

  const tokens: TokenView[] = view.players.map((p, i) => ({
    pi: i,
    slot: pos[i],
    sprite: spriteOf(p.lo.char.id),
    anim: anim[i],
    face: face[i],
    hop: hop[i],
    dim: !p.alive,
  }));

  const n = view.players.length;
  /** 화면 자리: 나는 늘 왼쪽 아래 (모두의마블처럼), 1:1 상대는 오른쪽 위 */
  const viewIdx = (pi: number) => (myPi >= 0 ? (pi - myPi + n) % n : pi);
  const dim = mine && pr && (pr.k === "buy" || pr.k === "acq");

  return (
    <div className="mb-sky absolute inset-0 overflow-hidden" style={{ backgroundImage: `url(/marble/bg/${view.map}.webp)`, backgroundSize: "cover", backgroundPosition: "center", imageRendering: "pixelated" }}>
      <Board g={view} tokens={tokens} pick={pick} onPick={onPick} onInfo={(t) => setInfo(t)} flash={flash} />

      {/* 위 가운데: 맵 · 바퀴 · 마을 소식 · 최근 일 */}
      <div className="absolute top-[8px] left-1/2 z-[400] flex -translate-x-1/2 flex-col items-center gap-1">
        <div className="mb-wood flex items-center gap-3 px-4 py-1" style={{ "--bar": map.id === "orgel" ? "#ff7fb0" : map.id === "cross" ? "#ff9a3d" : "#5b6cff" } as CSSProperties}>
          <b className="mb-title mb-out text-[16px] text-white">{map.name}</b>
          <span className="mb-out text-[15px] font-bold text-white">
            {Math.min(g.round, g.rounds)} / {g.rounds} 바퀴
          </span>
        </div>
        {g.town && (
          <div className="mb-chip text-[12px]" style={{ "--c": "#bff7e8" } as CSSProperties} title={TOWN_EVENTS[g.town.id].desc}>
            <Icon n="note" size={11} /> 마을 소식 <b>{TOWN_EVENTS[g.town.id].name}</b> · {g.town.id === "festa" ? `${map.groups[g.town.group]?.name} 통행료 2배` : TOWN_EVENTS[g.town.id].desc}
          </div>
        )}
        {map.id === "orgel" && map.every && (
          <div className="mb-chip text-[12px]" style={{ "--c": "#ffe1ef" } as CSSProperties}>
            <Icon n="clock" size={11} /> 태엽 회전까지 {map.every - ((g.round - 1) % map.every)}바퀴
          </div>
        )}
      </div>
      <div className="absolute top-[150px] left-[10px] z-[430]">
        <RoomTools room={live} me={me} onLeave={onLeave} inGame vertical />
      </div>

      {/* 가운데: 주사위 · 차례 */}
      <CenterDice g={g} dice={dice} nameOf={nameOf} log={log} at={map.id === "cross" ? { x: iso(6.5, 1.5).x, y: iso(6.5, 1.5).y - 80 } : { x: iso(4, 4).x, y: iso(4, 4).y - 168 }} />

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
          onPick={() => {
            if (mode?.k !== "skillFoe") return;
            if (mode.n) setMode({ k: "pullN", foe: i });
            else void send({ t: "skill", target: i });
          }}
        />
      ))}

      {/* 고르기 창 (사고 · 인수는 보드를 어둡게) */}
      {dim && <div className="absolute inset-0 z-[450] bg-[rgba(35,42,77,0.35)]" />}
      {live.phase === "play" && (
        <div
          className="absolute z-[460] flex -translate-x-1/2 justify-center"
          style={dim ? { left: 512, top: 150, width: 440 } : map.id === "cross" ? { left: iso(1.5, 6.5).x, top: iso(1.5, 6.5).y - 70, width: 320 } : { left: 512, top: 262, width: 440 }}
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
            compact={map.id === "cross"}
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
function cornerRect(corner: number) {
  const w = 248;
  const h = 118;
  const left = corner === 0 || corner === 2;
  const topSide = corner === 1 || corner === 2;
  return { x: left ? 10 : 1024 - 10 - w, y: topSide ? 10 : 576 - 10 - h, w, h };
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
    <div className={`absolute z-[420] ${shake ? "mb-shake" : ""} ${pickable ? "mb-blink cursor-pointer" : ""}`} style={{ left: r.x, top: r.y, width: r.w }} onClick={pickable ? onPick : undefined}>
      <div className={`mb-box relative overflow-visible ${turn ? "mb-turn" : ""}`} style={{ "--c": PCOLOR[i], "--bg": "#ffffff", opacity: p.alive ? 1 : 0.55 } as CSSProperties}>
        {/* 이름 띠 */}
        <div className="flex h-[26px] items-center gap-1.5 pr-2 pl-[86px]" style={{ background: PCOLOR[i], boxShadow: "inset 0 -3px 0 rgba(0,0,0,0.18), inset 0 3px 0 rgba(255,255,255,0.3)" }}>
          {seat?.bot ? <Icon n="bot" size={13} /> : me ? <Icon n="crown" size={13} /> : null}
          <b className="mb-out-s min-w-0 flex-1 truncate text-[14px] text-white">{p.name}</b>
          {seat?.auto && <span className="mb-chip text-[10px]">자동</span>}
          {seat?.away && <span className="mb-chip text-[10px]">끊김</span>}
          {!p.alive && <span className="mb-chip text-[10px]">파산</span>}
        </div>
        {/* 얼굴 (띠 위로 튀어나오게) */}
        <div className="absolute top-[-10px] left-[8px] h-[72px] w-[72px] overflow-hidden bg-white" style={{ boxShadow: `0 0 0 3px #232a4d, inset 0 0 0 4px ${c ? GRADE_COLOR[c.grade] : "#ccc"}` }}>
          {c && <img src={faceOf(c)} alt="" className="h-full w-full object-cover" />}
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

/* ───────────── 가운데 주사위 ───────────── */

function CenterDice({ g, dice, nameOf, log, at }: { g: GameWire; dice: { d: [number, number]; roll: number; p: number } | null; nameOf(pi: number): string; log: string[]; at: { x: number; y: number } }) {
  const turnP = g.prompt?.p ?? -1;
  return (
    <div className="pointer-events-none absolute z-[300] flex flex-col items-center gap-1.5" style={{ left: at.x, top: at.y, transform: "translateX(-50%)" }}>
      <div className="flex gap-3">
        {dice ? (
          <>
            <div key={`a${dice.roll}`} className="mb-dice-roll">
              <DiceFace v={dice.d[0]} size={58} />
            </div>
            <div key={`b${dice.roll}`} className="mb-dice-roll" style={{ animationDelay: "70ms" }}>
              <DiceFace v={dice.d[1]} size={58} />
            </div>
          </>
        ) : (
          <div className="flex gap-3 opacity-50">
            <DiceFace v={5} size={58} />
            <DiceFace v={2} size={58} />
          </div>
        )}
      </div>
      {dice && <b className="mb-out text-[20px] text-white">{dice.d[0] + dice.d[1]}{dice.d[0] === dice.d[1] ? " 더블!" : ""}</b>}
      {turnP >= 0 && (
        <div className="mb-chip text-[13px]" style={{ "--c": "#ffffff" } as CSSProperties}>
          <span className="inline-block h-[10px] w-[10px]" style={{ background: PCOLOR[turnP], boxShadow: "0 0 0 2px #232a4d" }} /> <b>{nameOf(turnP)}</b> 차례
        </div>
      )}
      {log.length > 0 && <div className="mb-out-s max-w-[300px] truncate text-center text-[12px] text-white">{log[log.length - 1]}</div>}
    </div>
  );
}

/* ───────────── 칸 정보 ───────────── */

function TileInfo({ g, tile, onClose }: { g: GameWire; tile: number; onClose(): void }) {
  const m = MAPS[g.map];
  const d = m.tiles[tile];
  const t = g.tiles[tile];
  const gg = g as unknown as Game;
  const c = slotPos(m, g.order.indexOf(tile));
  const lines: string[] = [];
  if (d.kind === "city" || d.kind === "spot") {
    lines.push(d.kind === "spot" ? "명소 — 가진 명소 수만큼 통행료 2배씩, 4곳이면 승리" : `${m.groups[d.group!].name} (${m.tiles.filter((x) => x.group === d.group).length}칸)`);
    lines.push(`땅값 ${fmt(d.price ?? 0)}`);
    if (t.owner >= 0) {
      lines.push(`주인 ${g.players[t.owner].name} · ${LEVEL_NAME[t.lv]}`);
      lines.push(`통행료 ${fmt(tollOf(gg, tile))}${t.lv < LANDMARK && d.kind === "city" ? ` · 인수 ${fmt(investedOf(d.price ?? 0, t.lv))}` : ""}`);
    } else if (d.kind === "city") lines.push(`통행료 땅 ${fmt(baseToll(d.price!, 0))} → 랜드마크 ${fmt(baseToll(d.price!, LANDMARK))}`);
  } else {
    const DESC: Record<string, string> = {
      start: "지나가거나 서면 월급",
      start2: "지나가면 월급의 70%",
      box: "카드 한 장 (좋은 일 · 나쁜 일)",
      jail: "더블이 나오거나 두 번 쉬어야 나감 · 100 내면 바로",
      fest: "내 땅 하나에 축제 (통행료 2배)",
      warp: "다음 차례에 원하는 칸으로",
      tax: "건물 값의 10%",
      bonus: "서면 +200",
    };
    lines.push(DESC[d.kind] ?? "");
  }
  return (
    <div className="absolute inset-0 z-[480]" onClick={onClose}>
      <div className="mb-box mb-pop absolute w-[230px] px-3 py-2 text-[12px] leading-[17px]" style={{ left: Math.min(1024 - 240, Math.max(10, c.x - 115)), top: c.y > 300 ? c.y - 150 : c.y + 34 }}>
        <b className="mb-title text-[15px]">{d.name}</b>
        {lines.map((l, k) => (
          <div key={k}>{l}</div>
        ))}
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
  busy,
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
    <div className="mb-box flex w-full flex-col items-center gap-2 px-3 py-2.5 text-center" style={{ maxWidth: compact ? 300 : 390 }}>
      {title && <b className="mb-title text-[15px]">{title}</b>}
      {children}
      {mine && left > 0 && (
        <div className="mb-bar w-full" title={`${Math.ceil(left / 1000)}초`}>
          <i style={{ width: `${Math.min(100, (left / 15000) * 100)}%`, "--c": left < 4000 ? "#ff6b6b" : "#4fd1b5" } as CSSProperties} />
        </div>
      )}
    </div>
  );
  if (auto && !busy)
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
  const skillBtn = skillOk && (
    <Btn tone="violet" className="h-[36px] px-3 text-[13px] font-bold" disabled={sending} onClick={skill} title={c?.active.desc(power(c.grade, me.lo.char.lv))}>
      <Icon n="star" size={12} /> {c?.active.name}
    </Btn>
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
              <Btn className="h-[40px] px-3 text-[13px]" disabled={sending || me.cash < 100} onClick={() => void send({ t: "pay" })}>
                <Cur k="coin" n={100} size={12} /> 내고 나가기
              </Btn>
            </div>
          </>,
          "도트 수리소"
        );
      return box(
        <>
          <Btn tone="gold" className="h-[50px] w-full text-[20px] font-bold" disabled={sending} onClick={() => void send({ t: "roll" })} silent>
            <DiceFace v={6} size={26} /> 주사위 굴리기
          </Btn>
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
      return box(
        <>
          <span className="text-[12px]">반짝이는 칸 쪽으로 가요</span>
          <div className="flex gap-2">
            {pr.opts.map((o) => (
              <Btn key={o} tone={o === 1 ? "sky" : "pink"} className="h-[38px] px-3 text-[14px] font-bold" disabled={sending} onClick={() => void send({ t: "fork", to: o })}>
                {o === 1 ? "왼쪽 마을" : "오른쪽 마을"}
              </Btn>
            ))}
          </div>
        </>,
        "어느 길로?"
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
        <Icon n="coin" size={12} /> 황금 주사위 ({uses})
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

function BannerView({ b }: { b: Banner }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[200px] z-[60] overflow-hidden">
      <div className="mb-banner flex h-[110px] items-center justify-center gap-4" style={{ "--d": `${b.ms}ms`, background: b.color, boxShadow: "0 -4px 0 0 #232a4d, 0 4px 0 0 #232a4d" } as CSSProperties}>
        {b.art && <img src={b.art} alt="" className="h-[150px] -translate-y-[10px] object-contain" />}
        <div>
          <div className="mb-title mb-out text-[34px] text-white">{b.title}</div>
          {b.sub && <div className="mb-out text-[15px] text-white">{b.sub}</div>}
        </div>
      </div>
    </div>
  );
}

function CardPop({ id, name }: { id: keyof typeof CARDS; name: string }) {
  const c = CARDS[id];
  return (
    <div className="pointer-events-none absolute inset-0 z-[55] flex items-center justify-center">
      <div className="mb-pop mb-box flex w-[220px] flex-col items-center gap-2 px-4 py-4 text-center" style={{ "--bg": c.good >= 0 ? "#fff3c9" : "#ffe1e1" } as CSSProperties}>
        <Icon n="box" size={40} />
        <span className="text-[12px] text-[var(--mute)]">{name} · 럭키 박스</span>
        <b className="mb-title text-[22px]">{c.name}</b>
        <span className="text-[13px]">{c.desc}</span>
      </div>
    </div>
  );
}

function Result({ room, me, onLeave }: { room: RoomWire; me: string; onLeave(): void }) {
  const g = room.game!;
  const mine = room.result!.find((r) => room.seats[r.seat]?.uid === me);
  useEffect(() => {
    sfx(mine?.place === 1 ? "win" : "lose");
  }, [mine?.place]);
  const HOW: Record<string, string> = { bankrupt: "파산승", triple: "트리플 독점", line: "라인 독점", spot: "명소 독점", rounds: "바퀴 끝 · 자산 1등" };
  return (
    <div className="absolute inset-0 z-[70] flex items-center justify-center bg-[rgba(35,42,77,0.45)]">
      <div className="mb-box mb-pop w-[460px] px-5 py-4">
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
              <div key={r.seat} className="mb-inset flex items-center gap-2 px-2 py-1.5" style={{ "--bg": PNAME_BG[pi] } as CSSProperties}>
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
