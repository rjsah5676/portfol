"use client";

import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { B, BOSS_EVERY, CAP, LAST_WAVE, TPS, sec } from "@/lib/defense/balance";
import { BOSSES } from "@/lib/defense/enemies";
import { MISSIONS, PATCHES, PATCH_DEADLINE } from "@/lib/defense/meta";
import { botByName, botTurn, BOTS } from "@/lib/defense/bot";
import { preloadArt } from "@/lib/defense/assets";
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
import { useStage } from "./Stage";
import {
  Btn,
  FactionChip,
  GradeChip,
  Modal,
  TITLE,
  UnitIcon,
  fmtNum,
  fmtTime,
  unitStats,
} from "./ui";
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
  const stage = useStage();
  const b: Board = ctrl.board;
  const multi = ctrl.mode.kind === "multi";

  const toast = (text: ReactNode, tone?: Toast["tone"]) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2200);
  };
  const run = (cmd: Cmd) => {
    const err = ctrl.issue(cmd);
    if (err) toast(err, "bad");
    force();
    return !err;
  };

  // ── 알림 처리 ──
  const onEv = (e: Ev) => {
    switch (e.t) {
      case "unit": {
        const d = UNIT[e.def];
        if (d.grade >= 5) markFound(d.id);
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
        toast(`도박 실패…${e.refund ? " (행운석 1개 돌려받음)" : ""}`, "bad");
        break;
      case "boss":
        setBossLine({ id: Math.random(), boss: e.boss });
        break;
      case "bossDown":
        setShout({
          id: Math.random(),
          title: "보스 처치!",
          sub: `+${e.gold}G · 행운석 +${e.stones}${e.ticket !== null ? ` · ${GRADE_NAME[e.ticket]} 골라 뽑기` : ""}`,
          color: "#7ef3ff",
        });
        break;
      case "wave":
        if (e.wave % BOSS_EVERY !== 0) toast(`WAVE ${e.wave}`);
        break;
      case "mission": {
        const m = MISSIONS.find((x) => x.id === e.id)!;
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
        break;
    }
  };

  // ── 게임 루프 ──
  useEffect(() => {
    preloadArt();
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
    if (s.moved) v.drag = { from: s.from, x: p.x, y: p.y };
  };
  const onUp = (e: React.PointerEvent) => {
    const s = press.current;
    press.current = null;
    const v = viewRef.current;
    v.drag = null;
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
    <div className="absolute inset-0 overflow-hidden bg-[#070a14] text-white">
      {/* ── 위 ── */}
      <div className="absolute top-0 left-0 flex h-[48px] w-full items-center gap-3 px-3">
        <div className="w-[170px] shrink-0">
          <div className="flex items-baseline gap-2">
            <span
              className={`${TITLE} text-[22px] leading-none ${b.phase === "boss" ? "text-[#ff5a6e]" : "text-white"}`}
            >
              {b.phase === "prep"
                ? "준비"
                : b.phase === "boss"
                  ? `BOSS ${b.wave}`
                  : `WAVE ${b.wave}`}
            </span>
            <span className="text-[13px] text-white/40">/ {LAST_WAVE}</span>
            <span className="ml-auto font-mono text-[13px] text-white/50">{fmtTime(time)}</span>
          </div>
          <div className="mt-1 h-[5px] overflow-hidden rounded bg-white/10">
            <div
              className={`h-full ${b.phase === "boss" ? "bg-[#ff5a6e]" : "bg-[#7ef3ff]"}`}
              style={{ width: `${Math.max(0, Math.min(1, waveP)) * 100}%` }}
            />
          </div>
        </div>
        <div className="w-[180px] shrink-0">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="text-white/60">필드의 적</span>
            <b
              className={`${TITLE} text-[18px] ${nEnemy >= CAP * 0.8 ? "text-[#ff5a6e]" : nEnemy >= CAP * 0.6 ? "text-[#ffb347]" : "text-white"}`}
            >
              {nEnemy} <span className="text-[13px] text-white/40">/ {CAP}</span>
            </b>
          </div>
          <div className="mt-1 h-[5px] overflow-hidden rounded bg-white/10">
            <div
              className="h-full"
              style={{
                width: `${Math.min(100, (nEnemy / CAP) * 100)}%`,
                background:
                  nEnemy >= CAP * 0.8 ? "#ff5a6e" : nEnemy >= CAP * 0.6 ? "#ffb347" : "#7dff8a",
              }}
            />
          </div>
        </div>
        {boss && (
          <div className="w-[250px] shrink-0">
            <div className="flex items-baseline justify-between text-[13px]">
              <b className={`${TITLE} text-[16px]`} style={{ color: BOSSES[boss.boss].color }}>
                {BOSSES[boss.boss].name}
              </b>
              <span className="font-mono text-white/70">
                {Math.max(0, Math.round((boss.hp / boss.max) * 100))}% · {fmtTime(b.bossT / TPS)}
              </span>
            </div>
            <div className="mt-1 h-[8px] overflow-hidden rounded border border-white/20 bg-black/60">
              <div
                className="h-full bg-[linear-gradient(90deg,#ff3d6e,#ff9a3d)]"
                style={{ width: `${(Math.max(0, boss.hp) / boss.max) * 100}%` }}
              />
            </div>
            {boss.shield > 0 && (
              <div
                className="mt-0.5 h-[3px] rounded bg-[#7fd3ff]"
                style={{ width: `${Math.min(100, (boss.shield / boss.max) * 400)}%` }}
              />
            )}
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <span
            className={`${TITLE} rounded-lg bg-[#ffd84a]/12 px-2.5 py-1 text-[18px] whitespace-nowrap text-[#ffd84a]`}
          >
            💰 {b.gold}
          </span>
          <span
            className={`${TITLE} rounded-lg bg-[#7ef3ff]/12 px-2.5 py-1 text-[18px] whitespace-nowrap text-[#7ef3ff]`}
          >
            💎 {b.stones}
          </span>
          {!multi && (
            <Btn
              onClick={cycleSpeed}
              className="h-[34px] w-[48px] font-mono text-[14px] font-bold"
              title="배속 (F)"
            >
              ×{ctrl.speed}
            </Btn>
          )}
          {!multi && (
            <Btn
              onClick={() => (ctrl.setPaused(true), setModal("pause"))}
              className="h-[34px] w-[38px] text-[15px]"
              title="일시정지 (Space)"
            >
              ❚❚
            </Btn>
          )}
          {multi && (
            <Btn
              onClick={() => setModal("pause")}
              className="h-[34px] w-[38px] text-[16px]"
              title="메뉴"
            >
              ≡
            </Btn>
          )}
          {(stage.canFs || stage.fs) && (
            <Btn
              onClick={stage.toggleFs}
              className="h-[34px] w-[38px] text-[15px]"
              title="전체화면"
            >
              ⛶
            </Btn>
          )}
          {admin && (
            <Btn
              tone="cyan"
              onClick={() => setModal("dev")}
              className="h-[34px] px-2 text-[12px] font-bold"
            >
              DEV
            </Btn>
          )}
        </div>
      </div>

      {/* ── 필드 ── */}
      <div className="absolute" style={{ left: FIELD.x, top: FIELD.y, width: FW, height: FH }}>
        <canvas
          ref={canvasRef}
          className="h-full w-full touch-none rounded-xl"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => ((press.current = null), (viewRef.current.drag = null))}
          onPointerLeave={() => (viewRef.current.hover = -1)}
        />
        {b.phase === "prep" && (
          <div className="pointer-events-none absolute inset-x-0 top-[38%] text-center">
            <p className={`${TITLE} text-[30px] text-white drop-shadow-[0_2px_8px_#000]`}>
              글리치가 몰려와요
            </p>
            <p className="mt-1 text-[15px] text-white/75 drop-shadow-[0_1px_4px_#000]">
              오른쪽 「소환」으로 수호자를 불러 막아 주세요 · {Math.ceil(-b.wt / TPS)}초
            </p>
          </div>
        )}
        {ctrl.paused && !modal && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50">
            <Btn
              tone="main"
              className="px-8 py-3 text-[20px] font-bold"
              onClick={() => (ctrl.setPaused(false), force())}
            >
              ▶ 계속
            </Btn>
          </div>
        )}
        {multi && ctrl.behind > 12 && (
          <div className="absolute inset-x-0 bottom-3 text-center text-[13px] text-white/70">
            따라잡는 중…
          </div>
        )}
        {/* 알림 */}
        <div className="pointer-events-none absolute inset-x-0 top-[64px] flex flex-col items-center gap-1">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`dfn-toast rounded-lg px-3 py-1 text-[14px] font-bold shadow ${t.tone === "bad" ? "bg-[#ff5a6e]/85" : t.tone === "gold" ? "bg-[#3a2c05]/90 text-[#ffe28a]" : t.tone === "good" ? "bg-[#0e6b54]/90" : "bg-black/70"}`}
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
        className="absolute flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
        style={{ left: 12, top: 444, width: FW, height: 124 }}
      >
        <div className="min-w-0 flex-1">
          {selDef && selCell ? (
            <div className="flex h-full gap-3">
              <UnitIcon id={selDef.id} size={64} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <b className={`${TITLE} text-[19px]`}>{selDef.name}</b>
                  <GradeChip g={selDef.grade} />
                  <FactionChip f={selDef.faction} />
                  <span className="text-[13px] text-white/50">×{selCell.units.length}</span>
                </div>
                <p className="mt-0.5 text-[13px] text-white/60">{unitStats(selDef)}</p>
                <p className="mt-0.5 text-[14px] text-white/85">{selDef.desc}</p>
                <p className="mt-0.5 text-[12px] text-white/45">
                  {selDef.dtype === "phys"
                    ? `상성 소형 ${SIZE_MULT[selDef.faction][0] * 100}% · 중형 ${SIZE_MULT[selDef.faction][1] * 100}% · 대형 ${SIZE_MULT[selDef.faction][2] * 100}% (방어력 영향)`
                    : "마법: 크기 · 방어력 무시 (마법 저항에 막힘)"}
                  {" · "}이번 판 피해 {fmtNum(b.dealt[selDef.id] ?? 0)}
                  {usedIn(selDef.id) && <> · 재료: {usedIn(selDef.id)}</>}
                </p>
              </div>
              <div className="flex w-[130px] flex-col gap-1.5">
                <Btn
                  tone={selCell.units.length >= STACK && selDef.grade < 3 ? "gold" : "ghost"}
                  disabled={selCell.units.length < STACK || selDef.grade >= 3}
                  onClick={() => run({ t: "merge", c: sel })}
                  className="h-[52px] text-[15px] font-bold"
                  hot="W"
                >
                  {selDef.grade >= 3 ? "조합식으로" : `합성 ${selCell.units.length}/${STACK}`}
                  {selDef.grade < 3 && (
                    <span className="block text-[11px] font-normal opacity-70">
                      → {GRADE_NAME[selDef.grade + 1]} 무작위
                    </span>
                  )}
                </Btn>
                <Btn
                  tone="danger"
                  disabled={selDef.grade > 2}
                  onClick={() => run({ t: "sell", c: sel })}
                  className="h-[40px] text-[14px]"
                  hot="E"
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
          <div className="flex w-[140px] shrink-0 flex-col gap-1 border-l border-white/10 pl-3">
            <p className="text-[11px] text-white/45">다른 플레이어</p>
            {ctrl.game.boards.map((o, i) =>
              i === ctrl.seat ? null : (
                <div
                  key={i}
                  className={`text-[12px] leading-tight ${o.result ? "text-white/35" : "text-white/85"}`}
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

      {/* ── 오른쪽 ── */}
      <div
        className="absolute flex flex-col gap-2"
        style={{ left: 632, top: 56, width: 380, height: 512 }}
      >
        <div className="flex h-[36px] gap-2">
          {b.tickets.length > 0 ? (
            <Btn
              tone="gold"
              onClick={() => setModal("pick")}
              className="dfn-pulse flex-1 text-[15px] font-bold"
            >
              🎟 {GRADE_NAME[b.tickets[0]]} 골라 뽑기
              {b.tickets.length > 1 ? ` ×${b.tickets.length}` : ""}
            </Btn>
          ) : null}
          {!b.patch && b.wave < PATCH_DEADLINE ? (
            <Btn
              tone="cyan"
              onClick={() => setModal("patch")}
              className="dfn-pulse flex-1 text-[14px] font-bold"
            >
              ⚙ 패치 고르기{" "}
              <span className="font-normal opacity-70">({PATCH_DEADLINE}웨이브 전까지)</span>
            </Btn>
          ) : (
            !b.tickets.length && (
              <div
                className="flex flex-1 items-center rounded-lg border border-white/8 bg-white/[0.03] px-3 text-[13px] text-white/60"
                title={patch?.desc}
              >
                ⚙ <b className="ml-1 text-white/85">{patch?.name ?? "패치 없음"}</b>
                <span className="ml-2 truncate text-white/40">{patch?.desc}</span>
              </div>
            )
          )}
        </div>

        <Btn
          tone="main"
          onClick={() => run({ t: "summon" })}
          disabled={!hasEmpty(b) || (b.free <= 0 && b.gold < sCost)}
          className="h-[72px]"
          hot="Q"
        >
          <span className={`${TITLE} block text-[26px] leading-none`}>
            소환{b.free > 0 ? ` (무료 ${b.free})` : ""}
          </span>
          <span className="mt-1 block text-[13px] opacity-85">
            {b.free > 0 ? "무료" : `${sCost}G`} ·{" "}
            {odds
              .map((p, i) => (p > 0 ? `${GRADE_NAME[i]} ${p}%` : null))
              .filter(Boolean)
              .join(" · ")}
            {!hasEmpty(b) && " · 빈 칸 없음"}
          </span>
        </Btn>

        <div>
          <div className="mb-1 text-[12px] text-white/45">
            세력 강화 (피해 +{B.up.perLv * 100}% / Lv)
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {FACTIONS.map((f, i) => {
              const c = upCost(b, f);
              return (
                <Btn
                  key={f}
                  onClick={() => run({ t: "up", k: f })}
                  disabled={b.gold < c || b.up[f] >= B.up.max}
                  className="h-[58px] text-left"
                  hot={String(i + 1)}
                >
                  <span
                    className="block px-2 text-[14px] font-bold"
                    style={{ color: FACTION_COLOR[f] }}
                  >
                    {FACTION_NAME[f]} <span className="text-white/70">Lv{b.up[f]}</span>
                  </span>
                  <span className="block px-2 text-[12px] text-white/55">
                    +{Math.round(b.up[f] * B.up.perLv * 100)}% ·{" "}
                    <b className="text-[#ffd84a]">{c}G</b>
                  </span>
                </Btn>
              );
            })}
          </div>
          <Btn
            onClick={() => run({ t: "luck" })}
            disabled={!Number.isFinite(luckCost(b)) || b.gold < luckCost(b)}
            className="mt-1.5 h-[38px] w-full text-[13px]"
            hot="4"
          >
            🍀 소환 확률 Lv{b.luck}
            {Number.isFinite(luckCost(b)) ? (
              <>
                {" "}
                → 에픽 {B.odds[b.luck + 1][2]}% · 레전드 {B.odds[b.luck + 1][3]}% ·{" "}
                <b className="text-[#ffd84a]">{luckCost(b)}G</b>
              </>
            ) : (
              " (최대)"
            )}
          </Btn>
        </div>

        <div>
          <div className="mb-1 text-[12px] text-white/45">행운석 도박</div>
          <div className="grid grid-cols-2 gap-1.5">
            {(["E", "L"] as const).map((g) => {
              const gm = B.gamble[g];
              const p = Math.round((gm.p + (b.patch === "gambler" ? 0.08 : 0)) * 100);
              return (
                <Btn
                  key={g}
                  onClick={() => run({ t: "gamble", g })}
                  disabled={b.stones < gm.cost || !hasEmpty(b)}
                  className="h-[46px] text-[14px]"
                >
                  <b style={{ color: GRADE_COLOR[g === "E" ? 2 : 3] }}>
                    {g === "E" ? "에픽" : "레전드"}
                  </b>{" "}
                  💎{gm.cost} · {p}%
                </Btn>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-1 flex text-[12px] text-white/45">
            글리치 균열 (미니 보스 · {B.rift.sec}초 안에 잡으면 보상)
            {b.riftCd > 0 && (
              <span className="ml-auto font-mono text-[#ff5cd6]">{Math.ceil(b.riftCd / TPS)}s</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {(["C", "B", "A"] as const).map((t) => (
              <Btn
                key={t}
                onClick={() => run({ t: "rift", tier: t })}
                disabled={b.riftCd > 0 || b.wave < B.rift.from || b.enemies.some((e) => e.rift > 0)}
                className="h-[46px] text-[13px]"
              >
                <b className="text-[#ff5cd6]">{t}급</b> 💎{B.rift[t].stones} +{B.rift[t].gold}G
              </Btn>
            ))}
          </div>
        </div>

        <div className="mt-auto grid grid-cols-3 gap-1.5">
          <Btn
            tone={recipesReady ? "gold" : "ghost"}
            onClick={() => setModal("recipe")}
            className="h-[44px] text-[14px] font-bold"
            hot="R"
          >
            ⚗ 조합식{recipesReady ? ` (${recipesReady})` : ""}
          </Btn>
          <Btn onClick={() => setModal("mission")} className="h-[44px] text-[14px]">
            ★ 미션 {b.missions.length}/{MISSIONS.length}
          </Btn>
          <Btn onClick={() => setModal("codex")} className="h-[44px] text-[14px]">
            📖 도감
          </Btn>
        </div>
      </div>

      {/* ── 창 ── */}
      {modal === "patch" && (
        <Modal title="패치 고르기 — 한 번 고르면 못 바꿔요" onClose={() => setModal(null)}>
          <div className="grid grid-cols-2 gap-2">
            {PATCHES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => run({ t: "patch", id: p.id }) && setModal(null)}
                className="rounded-xl border border-white/12 bg-white/[0.04] p-3 text-left hover:border-[#7ef3ff]/60 hover:bg-[#7ef3ff]/10"
              >
                <b className={`${TITLE} text-[18px] text-[#7ef3ff]`}>{p.name}</b>
                <p className="mt-1 text-[14px] text-white/75">{p.desc}</p>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[13px] text-white/45">
            {PATCH_DEADLINE}웨이브가 될 때까지 안 고르면 연합 프로토콜이 적용돼요.
          </p>
        </Modal>
      )}
      {modal === "pick" && b.tickets.length > 0 && (
        <Modal
          title={`${GRADE_NAME[b.tickets[0]]} 골라 뽑기 — 원하는 유닛 하나`}
          onClose={() => setModal(null)}
          wide
        >
          <div className="grid grid-cols-3 gap-3">
            {FACTIONS.map((f) => (
              <div key={f}>
                <p className="mb-1 text-[14px] font-bold" style={{ color: FACTION_COLOR[f] }}>
                  {FACTION_NAME[f]}
                </p>
                <div className="flex flex-col gap-1.5">
                  {poolOf(f, b.tickets[0] as Grade).map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() =>
                        run({ t: "pick", id: u.id }) &&
                        setModal(b.tickets.length > 0 ? "pick" : null)
                      }
                      className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-2 text-left hover:border-white/40"
                    >
                      <UnitIcon id={u.id} size={38} />
                      <span className="min-w-0">
                        <b className="block text-[14px]">{u.name}</b>
                        <span className="block text-[12px] leading-tight text-white/55">
                          {u.desc}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {modal === "recipe" && <RecipeModal b={b} run={run} onClose={() => setModal(null)} />}
      {modal === "mission" && (
        <Modal title="미션" onClose={() => setModal(null)}>
          <div className="flex flex-col gap-1.5">
            {MISSIONS.map((m) => {
              const done = b.missions.includes(m.id);
              return (
                <div
                  key={m.id}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${done ? "border-[#7dff8a]/30 bg-[#7dff8a]/8" : "border-white/10 bg-white/[0.03]"}`}
                >
                  <span className="text-[18px]">{done ? "✅" : "⬜"}</span>
                  <span className="flex-1">
                    <b className="text-[15px]">{m.name}</b>{" "}
                    <span className="text-[13px] text-white/55">{m.desc}</span>
                  </span>
                  <span className="text-[13px] text-[#ffd84a]">
                    {[m.gold && `+${m.gold}G`, m.stones && `💎+${m.stones}`]
                      .filter(Boolean)
                      .join(" ")}
                  </span>
                </div>
              );
            })}
          </div>
        </Modal>
      )}
      {modal === "codex" && (
        <Modal title="도감" onClose={() => setModal(null)} wide>
          <Codex have={counts(b)} />
        </Modal>
      )}
      {modal === "pause" && (
        <Modal
          title={multi ? "메뉴" : "일시정지"}
          onClose={() => (setModal(null), ctrl.setPaused(false))}
        >
          <div className="flex flex-col gap-2">
            <Btn
              tone="main"
              className="h-[48px] text-[17px] font-bold"
              onClick={() => (setModal(null), ctrl.setPaused(false), force())}
            >
              {multi ? "돌아가기" : "▶ 계속하기"}
            </Btn>
            <Btn tone="danger" className="h-[44px] text-[15px]" onClick={onExit}>
              {multi ? "방에서 나가기 (내 보드는 그대로 진행돼요)" : "그만하기 (기록 안 남음)"}
            </Btn>
            <p className="mt-2 text-[13px] leading-relaxed text-white/50">
              단축키: Q 소환 · W 합성 · E 판매 · 1 2 3 세력 강화 · 4 확률 강화 · R 조합식 · Space
              일시정지 · F 배속 · Esc 선택 해제
              <br />
              칸을 끌어서 자리를 바꿔요. 같은 유닛 칸에 놓으면 한 칸으로 모여요(3기까지).
            </p>
          </div>
        </Modal>
      )}
      {modal === "dev" && admin && (
        <Modal title="개발자 도구 (이 판은 랭킹에 안 올라감)" onClose={() => setModal(null)}>
          <div className="flex flex-col gap-3 text-[14px]">
            <div>
              <p className="mb-1 text-white/60">봇 자동 플레이</p>
              <div className="flex flex-wrap gap-1.5">
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
              <div className="flex flex-wrap gap-1.5">
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
                  +1000G
                </Btn>
                <Btn
                  className="px-3 py-1.5"
                  onClick={() => (ctrl.dev((c) => (c.board.stones += 10)), force())}
                >
                  +10💎
                </Btn>
              </div>
            )}
            <p className="text-[12px] text-white/40">
              대량 시뮬은 서버 폴더에서: npx tsx scripts/defense-sim.ts -n 50 --curve
            </p>
          </div>
        </Modal>
      )}
      {over && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-[520px] rounded-2xl border border-white/12 bg-[#0d1122] p-6 text-center">
            <p
              className={`${TITLE} text-[40px] ${b.result?.win ? "text-[#7ef3ff]" : "text-[#ff5a6e]"}`}
            >
              {b.result?.win ? "CLEAR!" : "방어 실패"}
            </p>
            <p className="mt-1 text-[15px] text-white/70">
              {b.result?.win
                ? `${LAST_WAVE}웨이브 돌파 · ${fmtTime(time)}`
                : b.result?.reason === "boss"
                  ? `${b.wave}웨이브 보스를 제한 시간 안에 못 잡았어요`
                  : `${b.wave}웨이브 · 필드의 적이 ${CAP}마리가 됐어요`}
              {" · "}처치 {b.kills}
            </p>
            <div className="mt-3 min-h-[24px] text-[15px]">
              {over.note ?? <span className="text-white/45">기록 확인 중…</span>}
            </div>
            <div className="mt-4 flex justify-center gap-2">
              {onRetry && (
                <Btn tone="main" className="px-6 py-2.5 text-[16px] font-bold" onClick={onRetry}>
                  다시 하기
                </Btn>
              )}
              <Btn className="px-6 py-2.5 text-[16px]" onClick={onExit}>
                {multi ? "결과 보기" : "메뉴로"}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
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
      <div className="flex h-full flex-col justify-center text-[14px] text-white/55">
        <p>칸을 누르면 유닛 정보 · 끌어서 자리를 바꿔요 (같은 유닛 3기가 모이면 합성)</p>
        <p className="mt-1 text-white/40">
          기사단은 작은 적 · 기계공방은 큰 적에 강하고, 마도회는 크기 · 방어력을 무시해요.
        </p>
      </div>
    );
  return (
    <div className="h-full">
      <p className="mb-1 text-[12px] text-white/45">이번 판 피해 비중</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {rows.slice(0, 8).map(([id, v]) => (
          <div key={id} className="flex items-center gap-2 text-[12px]">
            <span className="w-[86px] truncate" style={{ color: GRADE_COLOR[UNIT[id].grade] }}>
              {UNIT[id].name}
            </span>
            <span className="h-[6px] flex-1 overflow-hidden rounded bg-white/8">
              <span
                className="block h-full"
                style={{
                  width: `${(v / total) * 100}%`,
                  background: FACTION_COLOR[UNIT[id].faction],
                }}
              />
            </span>
            <span className="w-[34px] text-right font-mono text-white/60">
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
    <Modal title="조합식 — 신화 · 히든" onClose={onClose} wide>
      <div className="flex flex-col gap-2">
        {RECIPES.map((r) => {
          const known = !r.hidden || foundHidden(r.id);
          const ok = canRecipe(b, r.id);
          const d = UNIT[r.id];
          const need: Record<string, number> = {};
          for (const n of r.needs) need[n] = (need[n] ?? 0) + 1;
          return (
            <div
              key={r.id}
              className={`flex items-center gap-3 rounded-xl border p-2.5 ${ok ? "border-[#ffd84a]/50 bg-[#ffd84a]/8" : "border-white/10 bg-white/[0.03]"}`}
            >
              {known ? (
                <UnitIcon id={r.id} size={48} />
              ) : (
                <span
                  className={`${TITLE} flex h-12 w-12 items-center justify-center rounded-md bg-white/10 text-[22px] text-white/40`}
                >
                  ?
                </span>
              )}
              <div className="w-[190px]">
                <b className="text-[15px]">{known ? d.name : "???"}</b> <GradeChip g={d.grade} />
                <p className="text-[12px] leading-tight text-white/55">
                  {known ? d.desc : "숨겨진 조합식 — 어떤 유닛들이 모이면…?"}
                </p>
              </div>
              <div className="flex flex-1 flex-wrap items-center gap-1.5">
                {Object.entries(need).map(([id, n]) =>
                  known ? (
                    <span
                      key={id}
                      className="flex items-center gap-1 rounded-md bg-black/30 px-1.5 py-1 text-[12px]"
                    >
                      <UnitIcon id={id} size={24} dim={(have[id] ?? 0) < n} />
                      <span style={{ color: (have[id] ?? 0) >= n ? "#7dff8a" : "#ff9aa8" }}>
                        {UNIT[id].name} {have[id] ?? 0}/{n}
                      </span>
                    </span>
                  ) : (
                    <span
                      key={id}
                      className="rounded-md bg-black/30 px-2 py-1 text-[12px] text-white/35"
                    >
                      {GRADE_NAME[UNIT[id].grade]} ?
                    </span>
                  )
                )}
              </div>
              <Btn
                tone={ok ? "gold" : "ghost"}
                disabled={!ok}
                className="h-[44px] w-[80px] text-[15px] font-bold"
                onClick={() => run({ t: "recipe", id: r.id }) && onClose()}
              >
                만들기
              </Btn>
            </div>
          );
        })}
      </div>
      {b.patch === "core" && (
        <p className="mt-2 text-[13px] text-[#7ef3ff]">
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
    <div className="dfn-shout pointer-events-none absolute inset-x-0 top-[34%] text-center">
      <p
        className={`${TITLE} text-[46px] leading-none drop-shadow-[0_3px_10px_#000]`}
        style={{ color }}
      >
        {title}
      </p>
      {sub && (
        <p className="mt-1 text-[20px] font-bold text-white drop-shadow-[0_2px_6px_#000]">{sub}</p>
      )}
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
    <div className="dfn-boss pointer-events-none absolute inset-x-0 top-[26%] flex items-center justify-center gap-4 bg-[linear-gradient(90deg,transparent,rgba(0,0,0,0.8),transparent)] py-4">
      <img
        src={`/fight/art/${d.fighter}-face.webp`}
        alt=""
        className="dfn-glitch h-[84px] w-[84px] rounded-full border-2 object-cover"
        style={{ borderColor: d.color }}
      />
      <div>
        <p className="text-[13px] font-bold tracking-widest text-[#ff5a6e]">WARNING · BOSS</p>
        <p className={`${TITLE} text-[34px] leading-tight`} style={{ color: d.color }}>
          {d.name}
        </p>
        <p className="text-[14px] text-white/80">“{d.line}”</p>
      </div>
    </div>
  );
}
