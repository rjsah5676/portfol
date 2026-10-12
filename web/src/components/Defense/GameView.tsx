"use client";

import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { B, BOSS_EVERY, CAP, LAST_WAVE, TPS, sec } from "@/lib/defense/balance";
import { BOSSES } from "@/lib/defense/enemies";
import { MISSIONS, PATCHES, PATCH_DEADLINE } from "@/lib/defense/meta";
import { botByName, botTurn, BOTS } from "@/lib/defense/bot";
import { BOSS_ART, preloadArt } from "@/lib/defense/assets";
import {
  STACK,
  canRecipe,
  counts,
  hasEmpty,
  luckCost,
  summonCost,
  upCost,
  type Board,
  type Cmd,
  type Ev,
  type Fx,
} from "@/lib/defense/sim";
import {
  FACTIONS,
  FACTION_COLOR,
  FACTION_NAME,
  GRADE_COLOR,
  GRADE_NAME,
  RECIPES,
  SIZE_MULT,
  UNIT,
  poolOf,
  type Grade,
} from "@/lib/defense/units";
import type { Controller } from "./controller";
import { FH, FW, cellAt, draw, newView, pushFx } from "./render";
import {
  Bar,
  Btn,
  FactionChip,
  FactionIcon,
  GradeChip,
  Icon,
  Modal,
  SoundButton,
  FsButton,
  TITLE,
  UnitIcon,
  fmtNum,
  fmtTime,
  unitStats,
} from "./ui";
import { bgmFor, jingle, playBgm, preloadSfx, sfx, sfxVar } from "./audio";
import Codex, { foundHidden, markFound } from "./Codex";

/*
 * 게임 화면 (무대 1024×576 기준 배치)
 *  위: 웨이브 · 남은 적 · 골드 · 행운석 · 배속 · 일시정지
 *  왼쪽: 필드(캔버스) — 칸을 누르면 정보, 끌어서 자리 바꾸기 (같은 유닛이면 한 칸으로 모음)
 *  아래: 고른 유닛 정보 · 합성 · 판매 / 안 골랐으면 DPS 측정
 *  오른쪽: 소환 · 강화 · 도박 · 균열 · 조합식 · 미션
 * 단축키(PC): Q 소환 · W 합성 · E 판매 · 1 2 3 세력 강화 · 4 확률 강화 · R 조합식 · Space 일시정지 · F 배속 · Esc 선택 해제
 */

const FIELD = { x: 12, y: 56 };

export interface GameViewProps {
  ctrl: Controller;
  /** 멀티: 보드 순서대로 이름 */
  names?: string[];
  admin?: boolean;
  /** 판이 끝났을 때 (랭킹 등록 등) — 결과 창에 보일 글 */
  finish?: () => Promise<ReactNode>;
  onExit(): void;
  onRetry?(): void;
}

type Toast = { id: number; text: ReactNode; tone?: "bad" | "good" | "gold" };
type ModalKind = "patch" | "pick" | "recipe" | "mission" | "codex" | "pause" | "dev" | null;

export default function GameView({ ctrl, names, admin, finish, onExit, onRetry }: GameViewProps) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef(newView());
  const [sel, setSel] = useState(-1);
  const [modal, setModal] = useState<ModalKind>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [shout, setShout] = useState<{
    id: number;
    title: string;
    sub?: string;
    color: string;
  } | null>(null);
  const [bossLine, setBossLine] = useState<{ id: number; boss: number } | null>(null);
  const [over, setOver] = useState<{ note: ReactNode | null } | null>(null);
  const [bot, setBot] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const b: Board = ctrl.board;
  const multi = ctrl.mode.kind === "multi";

  const toast = (text: ReactNode, tone?: Toast["tone"]) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2200);
  };
  const run = (cmd: Cmd) => {
    const err = ctrl.issue(cmd);
    if (err) {
      toast(err, "bad");
      sfx("deny");
    } else if (cmd.t === "up" || cmd.t === "luck") sfx("upgrade");
    else if (cmd.t === "sell") sfx("sell");
    else if (cmd.t === "rift") sfx("rift");
    else if (cmd.t === "swap" || cmd.t === "patch") sfx("ui-click", 1, 0.9);
    force();
    return !err;
  };

  // ── 알림 처리 ──
  const onEv = (e: Ev) => {
    switch (e.t) {
      case "unit": {
        const d = UNIT[e.def];
        if (d.grade >= 5) markFound(d.id);
        if (d.grade >= 4 || e.how === "recipe") sfx("myth");
        else if (d.grade >= 3) sfx("legend");
        else if (e.how === "gamble") sfx("gamble-ok");
        else if (e.how === "merge") sfx("merge");
        else sfx("summon", 1, 0.96 + d.grade * 0.06);
        if (d.grade >= 2)
          setShout({
            id: Math.random(),
            title: `${GRADE_NAME[d.grade]}!`,
            sub: d.name,
            color: GRADE_COLOR[d.grade],
          });
        break;
      }
      case "gambleFail":
        sfx("gamble-fail");
        toast(`도박 실패…${e.refund ? " (행운석 1개 돌려받음)" : ""}`, "bad");
        break;
      case "boss":
        sfx("boss");
        setBossLine({ id: Math.random(), boss: e.boss });
        break;
      case "bossDown":
        sfx("boss-down");
        setShout({
          id: Math.random(),
          title: "보스 처치!",
          sub: `+${e.gold}G · 행운석 +${e.stones}${e.ticket !== null ? ` · ${GRADE_NAME[e.ticket]} 골라 뽑기` : ""}`,
          color: "#7ef3ff",
        });
        break;
      case "wave":
        if (e.wave % BOSS_EVERY !== 0) {
          toast(`WAVE ${e.wave}`);
          sfx("wave");
        }
        break;
      case "mission": {
        const m = MISSIONS.find((x) => x.id === e.id)!;
        sfx("mission");
        toast(
          <>
            미션 달성 · {m.name}{" "}
            <b className="text-[#ffd84a]">
              {[m.gold && `+${m.gold}G`, m.stones && `💎+${m.stones}`].filter(Boolean).join(" ")}
            </b>
          </>,
          "gold"
        );
        break;
      }
      case "rift":
        sfx(e.ok ? "mission" : "deny");
        toast(
          e.ok
            ? `균열을 닫았어요! 💎+${[0, B.rift.C.stones, B.rift.B.stones, B.rift.A.stones][e.tier]}`
            : "균열이 사라졌어요",
          e.ok ? "good" : "bad"
        );
        break;
      case "patch":
        if (e.auto) toast("패치를 안 골라서 연합 프로토콜이 적용됐어요");
        break;
      case "over":
        jingle(e.win ? "clear" : "gameover");
        break;
    }
  };

  // ── 게임 루프 ──
  useEffect(() => {
    preloadArt();
    preloadSfx();
    let raf = 0,
      last = performance.now(),
      lastHud = 0,
      ended = false;
    const cv = canvasRef.current!;
    const ctx = cv.getContext("2d")!;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = now - last;
      last = now;
      ctrl.frame(dt);
      const v = viewRef.current;
      v.now = now;
      if (ctrl.fx.length) {
        pushFx(v, ctrl.fx);
        fxSound(ctrl.fx);
        ctrl.fx.length = 0;
      }
      if (ctrl.ev.length) {
        const evs = ctrl.ev.splice(0);
        for (const e of evs) onEv(e);
      }
      // 캔버스 크기: 화면에 보이는 크기 × 기기 배율
      const rect = cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(rect.width * dpr),
        H = Math.round(rect.height * dpr);
      if (cv.width !== W || cv.height !== H) {
        cv.width = W;
        cv.height = H;
      }
      ctx.setTransform(W / FW, 0, 0, H / FH, 0, 0);
      draw(ctx, ctrl.board, v, { range: true });
      if (now - lastHud > 100) {
        lastHud = now;
        const bb = ctrl.board;
        if (!bb.result)
          playBgm(bb.phase === "prep" ? "wave-early" : bgmFor(bb.phase, bb.wave, LAST_WAVE));
        force();
      }
      if (ctrl.board.result && !ended) {
        ended = true;
        setOver({ note: null });
        if (finish)
          void finish().then(
            (note) => setOver({ note }),
            (e: Error) => setOver({ note: <span className="text-[#ff9aa8]">{e.message}</span> })
          );
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 판마다 한 번
  }, [ctrl]);

  // 개발자: 봇 자동 플레이
  useEffect(() => {
    if (!bot) {
      ctrl.setAuto(null);
      return;
    }
    const cfg = botByName(bot);
    ctrl.setAuto((g) => {
      for (const c of botTurn(g, ctrl.seat, cfg)) ctrl.log.push([g.tick, ctrl.seat, c]);
    });
    return () => ctrl.setAuto(null);
  }, [bot, ctrl]);

  // ── 필드 입력 (누르기 = 고르기 · 끌기 = 자리 바꾸기) ──
  const press = useRef<{ from: number; x: number; y: number; moved: boolean } | null>(null);
  const toField = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * FW) / r.width, y: ((e.clientY - r.top) * FH) / r.height };
  };
  const onDown = (e: React.PointerEvent) => {
    const p = toField(e);
    const c = cellAt(p.x, p.y);
    press.current = { from: c, x: p.x, y: p.y, moved: false };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const p = toField(e);
    const v = viewRef.current;
    v.hover = cellAt(p.x, p.y);
    const s = press.current;
    if (!s || s.from < 0 || !b.cells[s.from].def) return;
    if (!s.moved && Math.hypot(p.x - s.x, p.y - s.y) > 10) s.moved = true;
    if (s.moved) {
      if (!v.drag) {
        setDragging(true);
        sfx("ui-click", 0.7, 1.3);
      }
      v.drag = { from: s.from, x: p.x, y: p.y };
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const s = press.current;
    press.current = null;
    const v = viewRef.current;
    v.drag = null;
    setDragging(false);
    if (!s) return;
    const p = toField(e);
    const to = cellAt(p.x, p.y);
    if (s.moved) {
      if (to >= 0 && to !== s.from && run({ t: "swap", a: s.from, b: to })) {
        setSel(to);
        v.sel = to;
      }
      return;
    }
    const next = s.from >= 0 && b.cells[s.from].def && sel !== s.from ? s.from : -1;
    if (next >= 0) sfx("ui-click", 0.9, 1.15);
    setSel(next);
    v.sel = next;
  };
  useEffect(() => {
    viewRef.current.sel = sel;
  }, [sel]);
  // 고른 칸이 비면 선택 해제
  const selCell = sel >= 0 ? b.cells[sel] : null;
  const selDef = selCell?.def ? UNIT[selCell.def] : null;

  const cycleSpeed = () => {
    ctrl.cycleSpeed();
    force();
  };

  // ── 단축키 ──
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === "q") run({ t: "summon" });
      else if (k === "w" && sel >= 0) run({ t: "merge", c: sel });
      else if (k === "e" && sel >= 0) run({ t: "sell", c: sel });
      else if (k === "1" || k === "2" || k === "3") run({ t: "up", k: FACTIONS[Number(k) - 1] });
      else if (k === "4") run({ t: "luck" });
      else if (k === "r") setModal((m) => (m === "recipe" ? null : "recipe"));
      else if (k === " " && !multi) {
        e.preventDefault();
        ctrl.togglePause();
        force();
      } else if (k === "f" && !multi) cycleSpeed();
      else if (k === "escape") {
        setSel(-1);
        setModal(null);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  // ── 값 ──
  const waveLen =
    b.phase === "boss" ? sec(B.bossSec) : b.phase === "prep" ? sec(B.prepSec) : sec(B.waveSec);
  const waveP =
    b.phase === "boss"
      ? b.bossT / waveLen
      : b.phase === "prep"
        ? -b.wt / waveLen
        : 1 - b.wt / waveLen;
  const boss = b.enemies.find((e) => e.boss >= 0);
  const nEnemy = b.enemies.length;
  const recipesReady = RECIPES.filter((r) => canRecipe(b, r.id)).length;
  const patch = PATCHES.find((p) => p.id === b.patch);
  const sCost = summonCost(b);
  const odds = B.odds[b.luck];
  const time = ctrl.game.tick / TPS;

  return (
    <div className="px-stars absolute inset-0 overflow-hidden text-[var(--text)]">
      {/* ── 위: 상태 줄 ── */}
      <div className="absolute top-[8px] left-[12px] flex h-[38px] w-[1000px] items-center gap-3">
        <div
          className="px-box flex h-full w-[178px] shrink-0 flex-col justify-center px-2.5"
          style={{ "--b": b.phase === "boss" ? "#ff4d6d" : "#3d3468" } as React.CSSProperties}
        >
          <div className="flex items-baseline gap-1.5 leading-none">
            <span
              className={`${TITLE} px-shadow text-[17px] ${b.phase === "boss" ? "dfn-pulse text-[var(--red)]" : "text-white"}`}
            >
              {b.phase === "prep"
                ? "READY"
                : b.phase === "boss"
                  ? `BOSS ${b.wave}`
                  : `WAVE ${b.wave}`}
            </span>
            <span className="text-[11px] text-[var(--dim)]">/{LAST_WAVE}</span>
            <span className="ml-auto text-[11px] text-[var(--mute)]">{fmtTime(time)}</span>
          </div>
          <Bar
            className="mt-1.5"
            h={5}
            value={waveP}
            color={b.phase === "boss" ? "#ff4d6d" : "#5ff2ff"}
          />
        </div>
        <div className="px-box flex h-full w-[170px] shrink-0 flex-col justify-center px-2.5">
          <div className="flex items-center justify-between text-[11px] leading-none">
            <span className="text-[var(--mute)]">
              <Icon n="skull" size={10} /> 필드의 적
            </span>
            <b
              className={`text-[14px] ${nEnemy >= CAP * 0.8 ? "dfn-blink text-[var(--red)]" : nEnemy >= CAP * 0.6 ? "text-[#ffb347]" : "text-white"}`}
            >
              {nEnemy}
              <span className="text-[11px] text-[var(--dim)]">/{CAP}</span>
            </b>
          </div>
          <Bar
            className="mt-1.5"
            h={5}
            value={nEnemy / CAP}
            color={nEnemy >= CAP * 0.8 ? "#ff4d6d" : nEnemy >= CAP * 0.6 ? "#ffb347" : "#6dff8f"}
          />
        </div>
        {boss && (
          <div
            className="px-box flex h-full w-[240px] shrink-0 flex-col justify-center px-2.5"
            style={{ "--b": BOSSES[boss.boss].color } as React.CSSProperties}
          >
            <div className="flex items-baseline justify-between text-[11px] leading-none">
              <b className="text-[13px]" style={{ color: BOSSES[boss.boss].color }}>
                {BOSSES[boss.boss].name}
              </b>
              <span className="text-[var(--mute)]">
                {Math.max(0, Math.round((boss.hp / boss.max) * 100))}% · {fmtTime(b.bossT / TPS)}
              </span>
            </div>
            <Bar className="mt-1.5" h={6} value={Math.max(0, boss.hp) / boss.max} color="#ff4d6d" />
            {boss.shield > 0 && (
              <div
                className="mt-[3px] h-[2px] bg-[#7fd3ff]"
                style={{ width: `${Math.min(100, (boss.shield / boss.max) * 400)}%` }}
              />
            )}
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="px-inset flex h-[30px] items-center gap-1.5 px-2.5 text-[15px] font-bold whitespace-nowrap text-[var(--gold)]">
            <Icon n="coin" size={16} /> {b.gold}
          </span>
          <span className="px-inset flex h-[30px] items-center gap-1.5 px-2.5 text-[15px] font-bold whitespace-nowrap text-[var(--cyan)]">
            <Icon n="gem" size={16} /> {b.stones}
          </span>
          {!multi && (
            <Btn
              onClick={cycleSpeed}
              className="h-[30px] w-[44px] text-[13px] font-bold"
              title="배속 (F)"
            >
              ×{ctrl.speed}
            </Btn>
          )}
          {!multi && (
            <Btn
              onClick={() => (ctrl.setPaused(true), setModal("pause"))}
              className="h-[30px] w-[34px] text-[12px]"
              title="일시정지 (Space)"
            >
              ▮▮
            </Btn>
          )}
          {multi && (
            <Btn
              onClick={() => setModal("pause")}
              className="h-[30px] w-[34px] text-[14px]"
              title="메뉴"
            >
              ≡
            </Btn>
          )}
          <SoundButton />
          <FsButton h={30} />
          {admin && (
            <Btn
              tone="cyan"
              onClick={() => setModal("dev")}
              className="h-[30px] px-2 text-[11px] font-bold"
              title="관리자 전용"
            >
              DEV
            </Btn>
          )}
        </div>
      </div>

      {/* ── 필드 ── */}
      <div
        className="px-box absolute"
        style={
          {
            left: FIELD.x,
            top: FIELD.y,
            width: FW,
            height: FH,
            "--b": "#0a0816",
            "--f": "#0e0b1e",
          } as React.CSSProperties
        }
      >
        <canvas
          ref={canvasRef}
          className={`h-full w-full touch-none ${dragging ? "px-grab" : "px-hand"}`}
          style={{ imageRendering: "pixelated" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => (
            (press.current = null),
            (viewRef.current.drag = null),
            setDragging(false)
          )}
          onPointerLeave={() => (viewRef.current.hover = -1)}
        />
        <div className="dfn-scan pointer-events-none absolute inset-0 opacity-40" />
        {b.phase === "prep" && (
          <div className="pointer-events-none absolute inset-x-0 top-[36%] text-center">
            <p className={`${TITLE} px-shadow dfn-float text-[28px] text-white`}>
              글리치가 몰려와요!
            </p>
            <p className="px-shadow mt-2 text-[14px] text-[var(--text)]">
              오른쪽 <b className="text-[var(--pink)]">소환</b>으로 수호자를 불러 막아 주세요 ·{" "}
              <b className="text-[var(--gold)]">{Math.ceil(-b.wt / TPS)}</b>초
            </p>
          </div>
        )}
        {ctrl.paused && !modal && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#05040c]/60">
            <Btn
              tone="main"
              arrow
              className="px-8 py-3 text-[20px] font-bold"
              onClick={() => (ctrl.setPaused(false), force())}
            >
              ▶ 계속
            </Btn>
          </div>
        )}
        {multi && ctrl.desync > 0 && (
          <div
            className="pointer-events-none absolute top-2 right-2 bg-[#5c1426] px-2 py-0.5 text-[11px] text-[#ffd0da]"
            title="보드끼리 상태가 달라졌어요 (서버에 기록됨)"
          >
            동기화 어긋남 {ctrl.desync}
          </div>
        )}
        {multi && ctrl.behind > 12 && (
          <div className="px-shadow absolute inset-x-0 bottom-3 text-center text-[13px]">
            따라잡는 중…
          </div>
        )}
        {/* 알림 */}
        <div className="pointer-events-none absolute inset-x-0 top-[58px] flex flex-col items-center gap-1.5">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="dfn-toast px-box px-3 py-1 text-[13px] font-bold"
              style={
                {
                  "--f":
                    t.tone === "bad"
                      ? "#5c1426"
                      : t.tone === "gold"
                        ? "#3a2a05"
                        : t.tone === "good"
                          ? "#0e4a3a"
                          : "#1c1834",
                  "--b":
                    t.tone === "bad"
                      ? "#ff4d6d"
                      : t.tone === "gold"
                        ? "#ffd23f"
                        : t.tone === "good"
                          ? "#6dff8f"
                          : "#5b4f96",
                  color: t.tone === "gold" ? "#ffe9a0" : "#fff",
                } as React.CSSProperties
              }
            >
              {t.text}
            </div>
          ))}
        </div>
        {shout && <Shout key={shout.id} {...shout} onDone={() => setShout(null)} />}
        {bossLine && (
          <BossIntro key={bossLine.id} boss={bossLine.boss} onDone={() => setBossLine(null)} />
        )}
      </div>

      {/* ── 아래: 고른 유닛 ── */}
      <div
        className="px-box absolute flex gap-3 p-3"
        style={
          {
            left: 12,
            top: 448,
            width: FW,
            height: 118,
            "--b": selDef ? FACTION_COLOR[selDef.faction] : "#3d3468",
          } as React.CSSProperties
        }
      >
        <div className="min-w-0 flex-1">
          {selDef && selCell ? (
            <div className="flex h-full gap-3">
              <UnitIcon id={selDef.id} size={64} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <b className="text-[16px]">{selDef.name}</b>
                  <GradeChip g={selDef.grade} />
                  <FactionChip f={selDef.faction} />
                  <span className="text-[12px] text-[var(--mute)]">×{selCell.units.length}</span>
                </div>
                <p className="mt-1 text-[12px] text-[var(--mute)]">{unitStats(selDef)}</p>
                <p className="mt-0.5 text-[13px]">{selDef.desc}</p>
                <p className="mt-0.5 text-[11px] text-[var(--dim)]">
                  {selDef.dtype === "phys"
                    ? `상성 소형 ${SIZE_MULT[selDef.faction][0] * 100}% · 중형 ${SIZE_MULT[selDef.faction][1] * 100}% · 대형 ${SIZE_MULT[selDef.faction][2] * 100}%`
                    : "마법: 크기 · 방어력 무시"}
                  {" · "}이번 판 피해 {fmtNum(b.dealt[selDef.id] ?? 0)}
                  {usedIn(selDef.id) && <> · 재료: {usedIn(selDef.id)}</>}
                </p>
              </div>
              <div className="flex w-[124px] flex-col gap-2">
                <Btn
                  tone={selCell.units.length >= STACK && selDef.grade < 3 ? "gold" : "ghost"}
                  disabled={selCell.units.length < STACK || selDef.grade >= 3}
                  onClick={() => run({ t: "merge", c: sel })}
                  className={`h-[50px] text-[14px] font-bold ${selCell.units.length >= STACK && selDef.grade < 3 ? "dfn-pulse" : ""}`}
                  hot="W"
                  silent
                >
                  {selDef.grade >= 3 ? "조합식으로" : `합성 ${selCell.units.length}/${STACK}`}
                  {selDef.grade < 3 && (
                    <span className="block text-[10px] font-normal opacity-80">
                      → {GRADE_NAME[selDef.grade + 1]} 무작위
                    </span>
                  )}
                </Btn>
                <Btn
                  tone="danger"
                  disabled={selDef.grade > 2}
                  onClick={() => run({ t: "sell", c: sel })}
                  className="h-[36px] text-[13px]"
                  hot="E"
                  silent
                >
                  {selDef.grade > 2 ? "판매 불가" : `판매 +${B.sell[selDef.grade]}G`}
                </Btn>
              </div>
            </div>
          ) : (
            <DpsMeter b={b} />
          )}
        </div>
        {multi && names && (
          <div className="flex w-[140px] shrink-0 flex-col gap-1 border-l-2 border-[var(--line)] pl-3">
            <p className="text-[11px] text-[var(--dim)]">다른 플레이어</p>
            {ctrl.game.boards.map((o, i) =>
              i === ctrl.seat ? null : (
                <div
                  key={i}
                  className={`text-[12px] leading-tight ${o.result ? "text-[var(--dim)]" : ""}`}
                >
                  <b className="block truncate">{names[i]}</b>
                  {o.result
                    ? o.result.win
                      ? "클리어"
                      : `탈락 · W${o.result.wave}`
                    : `W${o.wave} · 적 ${o.enemies.length}/${CAP}`}
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* ── 오른쪽: 조작 ── */}
      <div
        className="absolute flex flex-col gap-[10px]"
        style={{ left: 636, top: 56, width: 376, height: 510 }}
      >
        <div className="flex h-[34px] gap-2">
          {b.tickets.length > 0 ? (
            <Btn
              tone="gold"
              onClick={() => setModal("pick")}
              className="dfn-pulse flex-1 text-[13px] font-bold"
            >
              <Icon n="ticket" size={14} /> {GRADE_NAME[b.tickets[0]]} 골라 뽑기
              {b.tickets.length > 1 ? ` ×${b.tickets.length}` : ""}
            </Btn>
          ) : null}
          {!b.patch && b.wave < PATCH_DEADLINE ? (
            <Btn
              tone="cyan"
              onClick={() => setModal("patch")}
              className="dfn-pulse flex-1 text-[13px] font-bold"
            >
              <Icon n="gear" size={14} /> 패치 고르기{" "}
              <span className="font-normal opacity-75">({PATCH_DEADLINE}웨이브 전)</span>
            </Btn>
          ) : (
            !b.tickets.length && (
              <div
                className="px-inset flex flex-1 items-center gap-1.5 px-3 text-[12px]"
                title={patch?.desc}
              >
                <Icon n="gear" size={13} />
                <b>{patch?.name ?? "패치 없음"}</b>
                <span className="truncate text-[var(--dim)]">{patch?.desc}</span>
              </div>
            )
          )}
        </div>

        <Btn
          tone="main"
          onClick={() => run({ t: "summon" })}
          disabled={!hasEmpty(b) || (b.free <= 0 && b.gold < sCost)}
          className="h-[70px]"
          hot="Q"
          silent
        >
          <span className={`${TITLE} px-shadow block text-[24px] leading-none`}>
            소환{b.free > 0 ? ` · 무료 ${b.free}` : ""}
          </span>
          <span className="mt-1.5 flex items-center justify-center gap-1 text-[12px]">
            {b.free > 0 ? (
              "무료"
            ) : (
              <>
                <Icon n="coin" size={12} />
                {sCost}
              </>
            )}
            <span className="opacity-60">|</span>
            {odds.map((p, i) =>
              p > 0 ? (
                <span
                  key={i}
                  style={{ color: i >= 2 ? GRADE_COLOR[i] : undefined }}
                  className={i >= 2 ? "font-bold drop-shadow-[1px_1px_0_#000]" : "opacity-90"}
                >
                  {GRADE_NAME[i]} {p}%
                </span>
              ) : null
            )}
            {!hasEmpty(b) && <span className="text-[#ffd6f4]">· 빈 칸 없음</span>}
          </span>
        </Btn>

        <section className="px-box px-2.5 pt-1.5 pb-2.5">
          <div className="mb-1.5 flex items-center text-[11px] text-[var(--mute)]">
            세력 강화 <span className="ml-1 text-[var(--dim)]">피해 +{B.up.perLv * 100}%/Lv</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {FACTIONS.map((f, i) => {
              const c = upCost(b, f);
              return (
                <Btn
                  key={f}
                  tone={f}
                  onClick={() => run({ t: "up", k: f })}
                  disabled={b.gold < c || b.up[f] >= B.up.max}
                  className="h-[52px] text-left"
                  hot={String(i + 1)}
                  silent
                >
                  <span className="flex items-center gap-1.5 px-2 text-[13px] font-bold">
                    <FactionIcon f={f} size={14} color="#fff" />
                    {FACTION_NAME[f]}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 px-2 text-[11px]">
                    <b className="text-white">Lv{b.up[f]}</b>
                    <span className="opacity-70">+{Math.round(b.up[f] * B.up.perLv * 100)}%</span>
                    <span className="ml-auto flex items-center gap-0.5 font-bold text-[var(--gold)]">
                      <Icon n="coin" size={10} />
                      {c}
                    </span>
                  </span>
                </Btn>
              );
            })}
          </div>
          <Btn
            onClick={() => run({ t: "luck" })}
            disabled={!Number.isFinite(luckCost(b)) || b.gold < luckCost(b)}
            className="mt-2 h-[32px] w-full text-[12px]"
            hot="4"
            silent
          >
            <Icon n="clover" size={13} /> 소환 확률 Lv{b.luck}
            {Number.isFinite(luckCost(b)) ? (
              <>
                {" "}
                → 에픽 {B.odds[b.luck + 1][2]}% · 레전드 {B.odds[b.luck + 1][3]}% ·{" "}
                <b className="text-[var(--gold)]">
                  <Icon n="coin" size={11} /> {luckCost(b)}
                </b>
              </>
            ) : (
              " (최대)"
            )}
          </Btn>
        </section>

        <section className="px-box px-2.5 pt-1.5 pb-2.5">
          <div className="mb-1.5 flex items-center text-[11px] text-[var(--mute)]">
            <Icon n="dice" size={11} className="mr-1" /> 행운석 도박
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(["E", "L"] as const).map((g) => {
              const gm = B.gamble[g];
              const p = Math.round((gm.p + (b.patch === "gambler" ? 0.08 : 0)) * 100);
              return (
                <Btn
                  key={g}
                  onClick={() => run({ t: "gamble", g })}
                  disabled={b.stones < gm.cost || !hasEmpty(b)}
                  className="h-[36px] text-[12px]"
                  silent
                >
                  <b
                    style={{ color: GRADE_COLOR[g === "E" ? 2 : 3] }}
                    className="drop-shadow-[1px_1px_0_#000]"
                  >
                    {g === "E" ? "에픽" : "레전드"}
                  </b>{" "}
                  <Icon n="gem" size={11} />
                  {gm.cost} · {p}%
                </Btn>
              );
            })}
          </div>
          <div className="mt-2 mb-1.5 flex items-center text-[11px] text-[var(--mute)]">
            <Icon n="rift" size={11} className="mr-1" /> 글리치 균열
            <span className="ml-1 text-[var(--dim)]">미니 보스 · {B.rift.sec}초 안에</span>
            {b.riftCd > 0 && (
              <span className="ml-auto text-[var(--pink)]">{Math.ceil(b.riftCd / TPS)}s</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["C", "B", "A"] as const).map((t) => (
              <Btn
                key={t}
                onClick={() => run({ t: "rift", tier: t })}
                disabled={b.riftCd > 0 || b.wave < B.rift.from || b.enemies.some((e) => e.rift > 0)}
                className="h-[36px] text-[11px]"
                silent
              >
                <b className="text-[var(--pink)]">{t}급</b> <Icon n="gem" size={10} />
                {B.rift[t].stones} +{B.rift[t].gold}
              </Btn>
            ))}
          </div>
        </section>

        <div className="mt-auto grid grid-cols-3 gap-2">
          <Btn
            tone={recipesReady ? "gold" : "ghost"}
            onClick={() => setModal("recipe")}
            className={`h-[40px] text-[13px] font-bold ${recipesReady ? "dfn-pulse" : ""}`}
            hot="R"
          >
            <Icon n="flask" size={13} /> 조합식{recipesReady ? ` ${recipesReady}` : ""}
          </Btn>
          <Btn onClick={() => setModal("mission")} className="h-[40px] text-[13px]">
            <Icon n="star" size={13} /> 미션 {b.missions.length}/{MISSIONS.length}
          </Btn>
          <Btn onClick={() => setModal("codex")} className="h-[40px] text-[13px]">
            <Icon n="book" size={13} /> 도감
          </Btn>
        </div>
      </div>

      {/* ── 창 ── */}
      {modal === "patch" && (
        <Modal title="패치 고르기" onClose={() => setModal(null)} accent="#5ff2ff">
          <p className="mb-3 text-[12px] text-[var(--mute)]">
            한 번 고르면 못 바꿔요 · {PATCH_DEADLINE}웨이브까지 안 고르면 연합 프로토콜
          </p>
          <div className="grid grid-cols-2 gap-3">
            {PATCHES.map((p) => (
              <Btn
                key={p.id}
                tone="cyan"
                onClick={() => run({ t: "patch", id: p.id }) && setModal(null)}
                className="p-3 text-left"
                silent
              >
                <b className="px-shadow block text-[16px]">{p.name}</b>
                <span className="mt-1 block text-[12px] leading-snug opacity-85">{p.desc}</span>
              </Btn>
            ))}
          </div>
        </Modal>
      )}
      {modal === "pick" && b.tickets.length > 0 && (
        <Modal
          title={`${GRADE_NAME[b.tickets[0]]} 골라 뽑기`}
          onClose={() => setModal(null)}
          wide
          accent={GRADE_COLOR[b.tickets[0]]}
        >
          <div className="grid grid-cols-3 gap-4">
            {FACTIONS.map((f) => (
              <div
                key={f}
                className="px-inset p-2"
                style={{ "--b": FACTION_COLOR[f] + "66" } as React.CSSProperties}
              >
                <p
                  className="mb-2 flex items-center gap-1.5 text-[14px] font-bold"
                  style={{ color: FACTION_COLOR[f] }}
                >
                  <FactionIcon f={f} size={14} /> {FACTION_NAME[f]}
                </p>
                <div className="flex flex-col gap-2">
                  {poolOf(f, b.tickets[0] as Grade).map((u) => (
                    <Btn
                      key={u.id}
                      tone={f}
                      onClick={() =>
                        run({ t: "pick", id: u.id }) &&
                        setModal(b.tickets.length > 0 ? "pick" : null)
                      }
                      className="flex items-center gap-2 p-2 text-left"
                      silent
                    >
                      <UnitIcon id={u.id} size={40} />
                      <span className="min-w-0">
                        <b className="block text-[13px]">{u.name}</b>
                        <span className="block text-[11px] leading-tight opacity-80">{u.desc}</span>
                      </span>
                    </Btn>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {modal === "recipe" && <RecipeModal b={b} run={run} onClose={() => setModal(null)} />}
      {modal === "mission" && (
        <Modal title="미션" onClose={() => setModal(null)} accent="#ffd23f">
          <div className="flex flex-col gap-2">
            {MISSIONS.map((m) => {
              const done = b.missions.includes(m.id);
              return (
                <div
                  key={m.id}
                  className="px-inset flex items-center gap-3 px-3 py-2"
                  style={
                    {
                      "--b": done ? "#6dff8f88" : "#3d3468",
                      "--f": done ? "#0e3a2a" : "rgba(0,0,0,0.3)",
                    } as React.CSSProperties
                  }
                >
                  <span
                    className="flex h-5 w-5 items-center justify-center text-[13px]"
                    style={{ background: done ? "#6dff8f" : "#2a2350", color: "#0a0816" }}
                  >
                    {done ? "✔" : ""}
                  </span>
                  <span className="flex-1">
                    <b className="text-[14px]">{m.name}</b>{" "}
                    <span className="text-[12px] text-[var(--mute)]">{m.desc}</span>
                  </span>
                  <span className="flex items-center gap-1 text-[12px] text-[var(--gold)]">
                    {m.gold ? (
                      <>
                        <Icon n="coin" size={11} />+{m.gold}
                      </>
                    ) : null}
                    {m.stones ? (
                      <>
                        <Icon n="gem" size={11} />+{m.stones}
                      </>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </Modal>
      )}
      {modal === "codex" && (
        <Modal title="도감" onClose={() => setModal(null)} wide accent="#c08cff">
          <Codex have={counts(b)} />
        </Modal>
      )}
      {modal === "pause" && (
        <Modal
          title={multi ? "메뉴" : "일시정지"}
          onClose={() => (setModal(null), ctrl.setPaused(false))}
        >
          <div className="flex flex-col gap-3">
            <Btn
              tone="main"
              arrow
              className="h-[46px] text-[16px] font-bold"
              onClick={() => (setModal(null), ctrl.setPaused(false), force())}
            >
              {multi ? "돌아가기" : "▶ 계속하기"}
            </Btn>
            <Btn tone="danger" arrow className="h-[40px] text-[14px]" onClick={onExit}>
              {multi ? "방에서 나가기 (내 보드는 그대로 진행돼요)" : "그만하기 (기록 안 남음)"}
            </Btn>
            <div className="px-inset mt-1 p-3 text-[12px] leading-relaxed text-[var(--mute)]">
              <p className="mb-1 font-bold text-[var(--text)]">단축키</p>
              <p>
                <K>Q</K> 소환 <K>W</K> 합성 <K>E</K> 판매 <K>1</K>
                <K>2</K>
                <K>3</K> 세력 강화 <K>4</K> 확률 강화 <K>R</K> 조합식 <K>Space</K> 일시정지 <K>F</K>{" "}
                배속 <K>Esc</K> 선택 해제
              </p>
              <p className="mt-1">
                칸을 끌어서 자리를 바꿔요. 같은 유닛 칸에 놓으면 한 칸으로 모여요(3기까지).
              </p>
            </div>
          </div>
        </Modal>
      )}
      {modal === "dev" && admin && (
        <Modal title="개발자 도구 · 관리자 전용" onClose={() => setModal(null)} accent="#5ff2ff">
          <div className="flex flex-col gap-3 text-[13px]">
            <p className="text-[12px] text-[var(--gold)]">이 판은 랭킹에 안 올라가요</p>
            <div>
              <p className="mb-2 text-[var(--mute)]">봇 자동 플레이</p>
              <div className="flex flex-wrap gap-2">
                <Btn
                  tone={!bot ? "cyan" : "ghost"}
                  className="px-3 py-1.5"
                  onClick={() => setBot(null)}
                >
                  끔
                </Btn>
                {BOTS.map((x) => (
                  <Btn
                    key={x.name}
                    tone={bot === x.name ? "cyan" : "ghost"}
                    className="px-3 py-1.5"
                    onClick={() => setBot(x.name)}
                  >
                    {x.name}
                  </Btn>
                ))}
              </div>
            </div>
            {!multi && (
              <div className="flex flex-wrap gap-2">
                {[5, 10, 20].map((s) => (
                  <Btn
                    key={s}
                    className="px-3 py-1.5"
                    onClick={() => (ctrl.dev((c) => (c.speed = s)), force())}
                  >
                    ×{s}
                  </Btn>
                ))}
                <Btn
                  className="px-3 py-1.5"
                  onClick={() => (ctrl.dev((c) => (c.board.gold += 1000)), force())}
                >
                  <Icon n="coin" size={12} /> +1000
                </Btn>
                <Btn
                  className="px-3 py-1.5"
                  onClick={() => (ctrl.dev((c) => (c.board.stones += 10)), force())}
                >
                  <Icon n="gem" size={12} /> +10
                </Btn>
              </div>
            )}
            <p className="text-[11px] text-[var(--dim)]">
              대량 시뮬은 서버 폴더에서: npx tsx scripts/defense-sim.ts -n 50 --curve
            </p>
          </div>
        </Modal>
      )}
      {over && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#05040c]/80">
          <div className="px-win w-[540px] p-7 text-center">
            <p
              className={`${TITLE} dfn-title text-[46px] leading-none ${b.result?.win ? "" : "!text-[var(--red)]"}`}
            >
              {b.result?.win ? "CLEAR!" : "GAME OVER"}
            </p>
            <p className="mt-3 text-[14px] text-[var(--mute)]">
              {b.result?.win
                ? `${LAST_WAVE}웨이브 돌파 · ${fmtTime(time)}`
                : b.result?.reason === "boss"
                  ? `${b.wave}웨이브 보스를 제한 시간 안에 못 잡았어요`
                  : `${b.wave}웨이브 · 필드의 적이 ${CAP}마리가 됐어요`}
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-[12px]">
              <Stat label="웨이브" value={`${b.result?.wave ?? b.wave}`} />
              <Stat label="처치" value={`${b.kills}`} />
              <Stat label="시간" value={fmtTime(time)} />
            </div>
            <div className="mt-4 min-h-[24px] text-[14px]">
              {over.note ?? <span className="dfn-blink text-[var(--dim)]">기록 확인 중…</span>}
            </div>
            <div className="mt-5 flex justify-center gap-3">
              {onRetry && (
                <Btn
                  tone="main"
                  arrow
                  className="px-6 py-2.5 text-[15px] font-bold"
                  onClick={onRetry}
                >
                  다시 하기
                </Btn>
              )}
              <Btn arrow className="px-6 py-2.5 text-[15px]" onClick={onExit}>
                {multi ? "결과 보기" : "메뉴로"}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function K({ children }: { children: ReactNode }) {
  return <span className="px-key mx-[2px] inline-block !text-[11px] !text-white">{children}</span>;
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-inset px-2 py-2">
      <p className="text-[var(--dim)]">{label}</p>
      <p className="mt-1 text-[18px] font-bold text-white">{value}</p>
    </div>
  );
}

/** 전투 효과음 (타격 · 궁극기 · 처치) — 종류마다 간격 제한은 audio.ts 가 함 */
function fxSound(list: Fx[]) {
  let hits = 0;
  for (const f of list) {
    if (f.k === "shot" && hits < 3) {
      const fac = UNIT[f.def].faction;
      sfxVar(
        fac === "knight" ? "hit-phys" : fac === "mech" ? "hit-mech" : "hit-magic",
        f.crit ? 1 : 0.8
      );
      hits++;
    } else if (f.k === "ult") sfx("ult");
    else if (f.k === "die" && !f.boss) sfxVar("die", 0.8);
  }
}

function usedIn(id: string) {
  return RECIPES.filter((r) => !r.hidden && r.needs.includes(id))
    .map((r) => UNIT[r.id].name)
    .join(", ");
}

function DpsMeter({ b }: { b: Board }) {
  const rows = Object.entries(b.dealt).sort((x, y) => y[1] - x[1]);
  const total = rows.reduce((a, [, v]) => a + v, 0);
  if (!rows.length)
    return (
      <div className="flex h-full flex-col justify-center gap-1.5 text-[13px] text-[var(--mute)]">
        <p>
          <b className="text-[var(--text)]">칸을 누르면</b> 유닛 정보 ·{" "}
          <b className="text-[var(--text)]">끌면</b> 자리 바꾸기 (같은 유닛 3기 → 합성)
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
          {FACTIONS.map((f) => (
            <span key={f} className="flex items-center gap-1">
              <FactionIcon f={f} size={12} />
              <b style={{ color: FACTION_COLOR[f] }}>{FACTION_NAME[f]}</b>
              <span className="text-[var(--dim)]">
                {f === "knight"
                  ? "작은 적에 강함"
                  : f === "mech"
                    ? "큰 적에 강함"
                    : "크기 · 방어 무시"}
              </span>
            </span>
          ))}
        </p>
      </div>
    );
  return (
    <div className="h-full">
      <p className="mb-1.5 text-[11px] text-[var(--dim)]">이번 판 피해 비중</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {rows.slice(0, 8).map(([id, v]) => (
          <div key={id} className="flex items-center gap-1.5 text-[11px]">
            <FactionIcon f={UNIT[id].faction} size={10} />
            <span className="w-[80px] truncate" style={{ color: GRADE_COLOR[UNIT[id].grade] }}>
              {UNIT[id].name}
            </span>
            <Bar
              className="flex-1"
              h={6}
              value={v / total}
              color={FACTION_COLOR[UNIT[id].faction]}
            />
            <span className="w-[30px] text-right text-[var(--mute)]">
              {((v / total) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecipeModal({ b, run, onClose }: { b: Board; run: (c: Cmd) => boolean; onClose(): void }) {
  const have = counts(b);
  return (
    <Modal title="조합식 — 신화 · 히든" onClose={onClose} wide accent="#ffd23f">
      <div className="flex flex-col gap-2.5">
        {RECIPES.map((r) => {
          const known = !r.hidden || foundHidden(r.id);
          const ok = canRecipe(b, r.id);
          const d = UNIT[r.id];
          const need: Record<string, number> = {};
          for (const n of r.needs) need[n] = (need[n] ?? 0) + 1;
          return (
            <div
              key={r.id}
              className="px-inset flex items-center gap-3 p-2.5"
              style={
                {
                  "--b": ok
                    ? "#ffd23f"
                    : d.faction === "hidden"
                      ? "#4cffb055"
                      : FACTION_COLOR[d.faction] + "55",
                  "--f": ok ? "#2e2405" : "rgba(0,0,0,0.3)",
                } as React.CSSProperties
              }
            >
              {known ? (
                <UnitIcon id={r.id} size={48} />
              ) : (
                <span
                  className={`${TITLE} flex h-12 w-12 items-center justify-center bg-[#2a2350] text-[22px] text-[var(--dim)]`}
                >
                  ?
                </span>
              )}
              <div className="w-[200px]">
                <b className="text-[14px]">{known ? d.name : "???"}</b> <GradeChip g={d.grade} />
                <p className="mt-0.5 text-[11px] leading-tight text-[var(--mute)]">
                  {known ? d.desc : "숨겨진 조합식 — 어떤 유닛들이 모이면…?"}
                </p>
              </div>
              <div className="flex flex-1 flex-wrap items-center gap-1.5">
                {Object.entries(need).map(([id, n]) =>
                  known ? (
                    <span
                      key={id}
                      className="flex items-center gap-1 bg-[#0a0816]/60 px-1.5 py-1 text-[11px]"
                    >
                      <UnitIcon id={id} size={22} dim={(have[id] ?? 0) < n} />
                      <span style={{ color: (have[id] ?? 0) >= n ? "#6dff8f" : "#ff9ab0" }}>
                        {UNIT[id].name} {have[id] ?? 0}/{n}
                      </span>
                    </span>
                  ) : (
                    <span
                      key={id}
                      className="bg-[#0a0816]/60 px-2 py-1 text-[11px] text-[var(--dim)]"
                    >
                      {GRADE_NAME[UNIT[id].grade]} ?
                    </span>
                  )
                )}
              </div>
              <Btn
                tone={ok ? "gold" : "ghost"}
                disabled={!ok}
                className={`h-[42px] w-[78px] text-[14px] font-bold ${ok ? "dfn-pulse" : ""}`}
                onClick={() => run({ t: "recipe", id: r.id }) && onClose()}
                silent
              >
                만들기
              </Btn>
            </div>
          );
        })}
      </div>
      {b.patch === "core" && (
        <p className="mt-2 text-[12px] text-[var(--cyan)]">
          단일 코어: 신화 · 히든은 1개만 만들 수 있어요.
        </p>
      )}
    </Modal>
  );
}

function Shout({
  title,
  sub,
  color,
  onDone,
}: {
  title: string;
  sub?: string;
  color: string;
  onDone(): void;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, 1600);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="dfn-shout pointer-events-none absolute inset-x-0 top-[32%] text-center">
      <p className={`${TITLE} px-shadow text-[44px] leading-none`} style={{ color }}>
        {title}
      </p>
      {sub && <p className="px-shadow mt-2 text-[18px] font-bold text-white">{sub}</p>}
    </div>
  );
}

function BossIntro({ boss, onDone }: { boss: number; onDone(): void }) {
  const d = BOSSES[boss];
  useEffect(() => {
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="dfn-boss pointer-events-none absolute inset-x-0 top-[24%] flex items-center justify-center gap-4 bg-[#05040c]/85 py-4 shadow-[0_-4px_0_0_#ff4d6d,0_4px_0_0_#ff4d6d]">
      {BOSS_ART[d.fighter] ? (
        <img
          src={BOSS_ART[d.fighter].src}
          alt=""
          className="dfn-glitch h-[110px] w-[110px] object-contain"
        />
      ) : (
        <img
          src={`/fight/art/${d.fighter}-face.webp`}
          alt=""
          className="dfn-glitch h-[84px] w-[84px] object-cover"
          style={{ boxShadow: `0 0 0 3px ${d.color}, 0 0 0 5px #0a0816` }}
        />
      )}
      <div>
        <p className="dfn-blink text-[12px] font-bold tracking-[0.3em] text-[var(--red)]">
          ⚠ WARNING · BOSS
        </p>
        <p className={`${TITLE} px-shadow text-[32px] leading-tight`} style={{ color: d.color }}>
          {d.name}
        </p>
        <p className="text-[13px] text-[var(--text)]">“{d.line}”</p>
      </div>
    </div>
  );
}
