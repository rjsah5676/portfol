"use client";

import { Fragment, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { B, BOSS_EVERY, CAP, LAST_WAVE, TPS, TUNE, hpOf, sec } from "@/lib/defense/balance";
import { BOSSES, phaseOn, phaseSkillName } from "@/lib/defense/enemies";
import { MISSIONS, PATCHES } from "@/lib/defense/meta";
import { CHEAT, CHEAT_CAT_NAME, CHEAT_MULTI_SEC, CHEAT_TIER_COLOR, CHEAT_TIER_NAME } from "@/lib/defense/cheats";
import { botByName, botTurn, BOTS } from "@/lib/defense/bot";
import { BOSS_ART, preloadArt } from "@/lib/defense/assets";
import {
  CELLS,
  STACK,
  canRecipe,
  recipeOpen,
  counts,
  hasEmpty,
  luckCost,
  nextBlock,
  nextBonus,
  sellOf,
  bossSecOf,
  capOf,
  summonCost,
  upCost,
  type Board,
  type Cmd,
  type Ev,
  type Fx,
  RIFT_TIERS,
  type RiftTier,
} from "@/lib/defense/sim";
import {
  FACTIONS,
  FACTION_COLOR,
  FACTION_NAME,
  GRADE_COLOR,
  GRADE_NAME,
  RECIPES,
  needMatch,
  needName,
  SIZE_MULT,
  UNIT,
  poolOf,
  type Faction,
  type Grade,
} from "@/lib/defense/units";
import type { Controller } from "./controller";
import { RelicIcon } from "./Hub";
import { RELIC, RES, relicDesc, resDesc, treasureReward } from "@/lib/defense/progress";
import { BENCH_W, CW, FH2, cellAt, draw, newView, pushFx } from "./render";
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
import { bgmFor, jingle, playBgm, preloadSfx, setSfxSpeed, sfx, sfxVar } from "./audio";
import Codex, { foundHidden, markFound } from "./Codex";
import { TutorialCard, resetTutorial } from "./Tutorial";

/*
 * 게임 화면 (무대 1024×576 기준 배치)
 *  위: 웨이브 · 남은 적 · 골드 · 행운석 · 배속 · 일시정지
 *  왼쪽: 필드(캔버스) — 칸을 누르면 정보, 끌어서 자리 바꾸기 (같은 유닛이면 한 칸으로 모음)
 *  아래: 고른 유닛 정보 · 합성 · 판매 / 안 골랐으면 DPS 측정
 *  오른쪽: 소환 · 강화 · 도박 · 균열 · 조합식 · 미션
 * 단축키(PC): Q 소환 · W 합성 · E 판매 · 1 2 3 세력 강화 · 4 히든 강화 · 5 확률 강화 · R 조합식 · Space 일시정지 · F 배속 · Esc 선택 해제
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
  /** 레전드 이상 판매는 두 번 눌러야 (실수로 팔지 않게) — 한 번 누른 칸 */
  const [sellArm, setSellArm] = useState(-1);
  const [quitArm, setQuitArm] = useState(false);
  const sellSel = () => {
    if (sel < 0) return;
    const d = b.cells[sel].def ? UNIT[b.cells[sel].def!] : null;
    if (!d) return;
    if (d.grade >= 3 && sellArm !== sel) {
      setSellArm(sel);
      toast("한 번 더 누르면 판매해요", "gold");
      return;
    }
    setSellArm(-1);
    run({ t: "sell", c: sel });
  };
  /** 최근 DPS (균열 위험도 · DPS 창) — 1초마다 넣은 피해 합을 10개까지 */
  const dpsRef = useRef<{ t: number; v: number }[]>([]);
  const [dpsNow, setDpsNow] = useState(0);
  const [showDps, setShowDps] = useState(() => {
    try {
      return localStorage.getItem("pgd-dps") === "1";
    } catch {
      return false;
    }
  });
  const [dragging, setDragging] = useState(false);
  const b: Board = ctrl.board;
  const multi = ctrl.mode.kind === "multi";
  // 다음 웨이브 자동 부르기 (이 기기에 저장) — 필드가 비면 부름, 보스 웨이브 앞은 직접
  const [autoNext, setAutoNext] = useState(() => {
    try {
      return localStorage.getItem("pgd-autonext") === "1";
    } catch {
      return false;
    }
  });
  const autoSent = useRef(-1);
  // 이번 판 보물방 당첨이면 시작할 때 한 번 알림
  useEffect(() => {
    if (ctrl.board.mods.treasure > 0 && ctrl.board.wave === 0)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 판 시작 알림 한 번
      setShout({
        id: Math.random(),
        title: "보물방 당첨!",
        sub: `이번 판 ${ctrl.board.mods.treasure}웨이브 직전에 보물방이 열려요`,
        color: "#ffd23f",
      });
  }, [ctrl]);
  useEffect(() => {
    if (!autoNext || b.result || b.cheat || ctrl.paused || b.phase !== "wave") return;
    if (b.enemies.length > 0 || (b.wave + 1) % BOSS_EVERY === 0 || nextBlock(b) || autoSent.current === b.wave) return;
    autoSent.current = b.wave;
    if (!ctrl.issue({ t: "next" })) sfx("ui-click", 0.6, 1.3);
  });

  const toast = (text: ReactNode, tone?: Toast["tone"]) => {
    const id = Math.random();
    // 같은 글자 알림은 하나만 (골드가 모자라요 연타 등) — 있던 것을 지우고 새로 띄워 시간만 늘림
    setToasts((t) => [...t.filter((x) => typeof text !== "string" || x.text !== text).slice(-3), { id, text, tone }]);
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
        else if (d.grade >= 1) sfx("spawn", 1, 0.94 + d.grade * 0.08);
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
      case "tele":
        if (e.hit === null) sfx("tele-warn");
        else {
          sfx(`tele-${e.snd}`);
          if (e.hit > 0) toast(`${e.name} — ${e.hit}칸 기절`, "bad");
          else toast("피했어요!");
        }
        break;
      case "treasure":
        if (e.stage === "start") {
          sfx("boss");
          setShout({
            id: Math.random(),
            title: "보물방!",
            sub: `${B.treasure.sec}초 동안 보물 골렘을 최대한 깎아요 — 깎은 만큼 픽셀 조각 · 글리치 코어 (일반 적은 잠시 멈춰요)`,
            color: "#ffd23f",
          });
        } else {
          sfx("reward");
          setShout({
            id: Math.random(),
            title: e.killed ? "보물 골렘 처치!" : `${Math.round((e.ratio ?? 0) * 100)}% 깎음`,
            sub: "보물방 끝 · 깎은 만큼 판이 끝나면 재화로 받아요",
            color: "#ffd23f",
          });
        }
        break;
      case "phase": {
        const bd = BOSSES[e.boss];
        sfx("boss");
        sfx("boss-phase");
        setShout({
          id: Math.random(),
          title: "2페이즈!",
          sub: `${bd.name} — ${bd.phase?.line ?? ""} · 빨간 칸의 유닛을 끌어서 옮기면 피해요`,
          color: bd.color,
        });
        break;
      }
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
            ? `균열을 닫았어요! 💎+${B.rift[RIFT_TIERS[e.tier - 1]].stones}`
            : "균열이 사라졌어요",
          e.ok ? "good" : "bad"
        );
        break;
      case "patch":
        toast(<>시작 치트 · <b className="text-[#ffd23f]">{PATCHES.find((p) => p.id === e.id)?.name}</b>{e.auto ? " (시간이 지나 자동)" : ""}</>, "gold");
        break;
      case "cheatOffer":
        sfx("reward");
        break;
      case "cheat": {
        const c = CHEAT[e.id];
        if (c) toast(<>치트 코드 · <b style={{ color: CHEAT_TIER_COLOR[c.tier] }}>{c.name}</b>{e.auto ? " (시간이 지나 자동)" : ""}</>, "gold");
        break;
      }
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
        setSfxSpeed(ctrl.speed);
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
      ctx.setTransform(W / CW, 0, 0, H / FH2, 0, 0);
      draw(ctx, ctrl.board, v, { range: true });
      if (now - lastHud > 100) {
        lastHud = now;
        const bb = ctrl.board;
        // 최근 DPS: 게임 시간 1초마다 넣은 피해 합 (배속 · 일시정지와 무관하게 tick 기준)
        const sec0 = Math.floor(ctrl.game.tick / TPS);
        const q = dpsRef.current;
        if (!q.length || q[q.length - 1].t !== sec0) {
          q.push({ t: sec0, v: Object.values(bb.dealt).reduce((a, x) => a + x, 0) });
          if (q.length > 11) q.shift();
          setDpsNow(recentDps(q));
        }
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
    return { x: ((e.clientX - r.left) * CW) / r.width, y: ((e.clientY - r.top) * FH2) / r.height };
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
    // 자리 옮기기는 끌어서만 (클릭은 고르기 · 풀기)
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
      // 한/영 상태와 상관없이 (한글 입력이면 key 가 ㅂ · Process 로 옴) — 물리 키(code)로 읽음
      const k = keyOf(e);
      if (k === "q") run({ t: "summon" });
      else if (k === "w" && sel >= 0) run({ t: "merge", c: sel });
      else if (k === "e" && sel >= 0) sellSel();
      else if (k === "1" || k === "2" || k === "3") run({ t: "up", k: FACTIONS[Number(k) - 1] });
      else if (k === "4") run({ t: "up", k: "hidden" });
      else if (k === "5") run({ t: "luck" });
      else if (k === "r") setModal((m) => (m === "recipe" ? null : "recipe"));
      else if (k === "n") run({ t: "next" });
      else if (k === " " && !multi) {
        e.preventDefault();
        ctrl.togglePause();
        force();
      } else if (k === "f" && !multi) cycleSpeed();
      else if (k === "escape") {
        // Esc: 열린 창 닫기 → 고른 칸 풀기 → 일시정지 메뉴 (전체화면에서도 — Stage 가 Esc 를 잠가 둠)
        if (modal) {
          if (modal === "pause") ctrl.setPaused(false);
          setModal(null);
        } else if (sel >= 0) {
          setSel(-1);
        } else if (!b.result) {
          ctrl.setPaused(true);
          setModal("pause");
        }
        force();
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  // ── 값 ──
  const waveLen =
    b.phase === "boss" ? sec(bossSecOf(b)) : b.phase === "prep" ? sec(B.prepSec) : sec(B.waveSec);
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
                  : b.phase === "treasure"
                    ? "TREASURE"
                    : `WAVE ${b.wave}`}
            </span>
            <span className="text-[12px] text-[var(--dim)]">/{LAST_WAVE}</span>
            <span className="ml-auto text-[12px] text-[var(--mute)]">{fmtTime(time)}</span>
          </div>
          <Bar
            className="mt-1.5"
            h={5}
            value={waveP}
            color={b.phase === "boss" ? "#ff4d6d" : "#5ff2ff"}
          />
        </div>
        <div className="px-box flex h-full w-[170px] shrink-0 flex-col justify-center px-2.5">
          <div className="flex items-center justify-between text-[12px] leading-none">
            <span className="text-[var(--mute)]">
              <Icon n="skull" size={10} /> 필드의 적
            </span>
            <b
              className={`text-[14px] ${nEnemy >= capOf(b) * 0.8 ? "dfn-blink text-[var(--red)]" : nEnemy >= capOf(b) * 0.6 ? "text-[#ffb347]" : "text-white"}`}
            >
              {nEnemy}
              <span className="text-[12px] text-[var(--dim)]">/{capOf(b)}</span>
            </b>
          </div>
          <Bar
            className="mt-1.5"
            h={5}
            value={nEnemy / capOf(b)}
            color={nEnemy >= capOf(b) * 0.8 ? "#ff4d6d" : nEnemy >= capOf(b) * 0.6 ? "#ffb347" : "#6dff8f"}
          />
        </div>
        {(b.patch || b.cheats.length > 0 || b.mods.grit > 0) && (
          <div className="px-inset flex h-full min-w-0 shrink items-center gap-1 overflow-hidden px-1.5">
            {patch && (
              <span
                className={`flex h-6 items-center justify-center gap-1 bg-[#0a0816] ${patch.id === "pure" ? "px-1.5" : "w-6"}`}
                style={{
                  boxShadow: `inset 0 0 0 2px ${patch.id === "pure" && b.pure <= 0 ? "#5a5276" : "#ffd23f"}`,
                }}
                title={`시작 치트 · ${patch.name}\n${patch.desc}${
                  patch.id === "pure"
                    ? b.mono && b.pure > 0
                      ? `\n지금 ${FACTION_NAME[b.mono]} 피해 +${Math.round((TUNE.pureDmg - 1) * b.pure * 100)}% · 강화 비용 -${Math.round((1 - TUNE.pureUp) * b.pure * 100)}%`
                      : `\n지금 꺼짐 — 가장 많은 세력이 ${Math.round(TUNE.pureFrom * 100)}% 이상이어야 해요 (지금 ${Math.round(b.pureR * 100)}%)`
                    : ""
                }`}
              >
                {patch.id === "pure" ? (
                  <>
                    {b.mono && <FactionIcon f={b.mono} size={12} />}
                    <b className={`text-[12px] ${b.pure > 0 ? "text-[var(--gold)]" : "text-[var(--dim)]"}`}>
                      +{Math.round((TUNE.pureDmg - 1) * b.pure * 100)}%
                    </b>
                  </>
                ) : (
                  <Icon n="gear" size={13} />
                )}
              </span>
            )}
            {b.mods.grit > 0 && (
              <b
                className="px-1 text-[12px] text-[var(--gold)]"
                title={`끈기 — 이 단계에서 ${b.mods.grit}판 연달아 져서 모든 피해 +${Math.round((b.mods.gritDmg - 1) * 100)}% (깨면 0)`}
              >
                끈기+{Math.round((b.mods.gritDmg - 1) * 100)}%
              </b>
            )}
            {b.cheats.map((id) => {
              const c = CHEAT[id];
              return (
                <span
                  key={id}
                  className="flex h-6 w-6 items-center justify-center bg-[#0a0816]"
                  style={{ boxShadow: `inset 0 0 0 2px ${CHEAT_TIER_COLOR[c.tier]}` }}
                  title={`치트 코드 · ${CHEAT_TIER_NAME[c.tier]} · ${c.name}\n${c.desc}`}
                >
                  <Icon n={CHEAT_CAT_ICON[c.cat]} size={13} />
                </span>
              );
            })}
          </div>
        )}
        {(b.mods.relics.length > 0 || b.mods.glitch.lv > 0) && (
          <div
            className="px-inset flex h-full min-w-0 shrink items-center gap-1 overflow-hidden px-1.5"
            title={[
              b.mods.glitch.lv ? `오염 ${b.mods.glitch.lv}단계 — 적 체력 ×${b.mods.glitch.hp} · 속도 ×${b.mods.glitch.spd}` : "",
              ...b.mods.relics.map((id) => `${RELIC[id]?.name} Lv.${b.mods.relicLv?.[id] ?? 1}: ${relicDesc(id, b.mods.relicLv?.[id] ?? 1)}`),
              ...b.mods.res.map((id) => `연구 ${RES[id]?.name} Lv.${b.mods.resLv?.[id] ?? 1}: ${resDesc(id, b.mods.resLv?.[id] ?? 1)}`),
            ]
              .filter(Boolean)
              .join("\n")}
          >
            {b.mods.glitch.lv > 0 && (
              <b className="dfn-glitch px-1 text-[12px] text-[var(--pink)]">G{b.mods.glitch.lv}</b>
            )}
            {b.mods.relics.map((id) => (
              <RelicIcon key={id} id={id} size={24} />
            ))}
          </div>
        )}
        {b.troom && (
          <TreasurePanel b={b} />
        )}
        {!b.troom && b.mods.treasure > 0 && !b.treasure && !b.result && (
          <span
            className="px-inset flex h-full shrink-0 items-center gap-1 px-2 text-[12px] font-bold whitespace-nowrap text-[var(--gold)]"
            title={`이번 판 보물방 — ${b.mods.treasure}웨이브 직전에 열려요 (그때 덱이 셀수록 많이 깎고 보상도 커요)`}
          >
            <Icon n="coin" size={12} /> 보물방 W{b.mods.treasure}
          </span>
        )}
        {boss && (
          <div
            className="px-box flex h-full min-w-[150px] max-w-[240px] flex-1 flex-col justify-center px-2.5"
            style={{ "--b": BOSSES[boss.boss].color } as React.CSSProperties}
          >
            <div className="flex items-baseline justify-between text-[12px] leading-none">
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
              className="h-[30px] px-2 text-[12px] font-bold"
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
            width: CW,
            height: FH2,
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
        {/* 딜량 창 (오른쪽 위, 켜고 끄기 — 전체화면에서도 보이게 필드 위에 작게) */}
        <div className="absolute top-1.5 z-10" style={{ right: BENCH_W + 6 }}>
          <button
            type="button"
            onClick={() => {
              const v = !showDps;
              setShowDps(v);
              try {
                localStorage.setItem("pgd-dps", v ? "1" : "0");
              } catch {}
            }}
            className={`px-btn h-6 px-1.5 text-[12px] ${showDps ? "" : "opacity-70"}`}
            style={{ "--c": showDps ? "#137f93" : "#2a2350" } as React.CSSProperties}
            title="딜량 창 켜고 끄기"
          >
            DPS
          </button>
        </div>
        {showDps && <DpsOverlay b={b} dps={dpsNow} />}
        {/* 다음 웨이브 부르기 (왼쪽 위) — 적이 다 나온 뒤 · 남은 시간만큼 골드 */}
        {!b.result && !b.cheat && b.phase !== "boss" && (
          <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-1">
            {!nextBlock(b) && (
              <Btn
                tone={b.phase === "prep" ? "main" : "cyan"}
                className="h-7 px-2 text-[12px] font-bold"
                onClick={() => run({ t: "next" })}
                title="다음 웨이브 부르기 (N) — 남은 적은 그대로 남아요"
              >
                {b.phase === "prep" ? "▶ 바로 시작" : "▶▶ 다음 웨이브"}
                {nextBonus(b) > 0 && (
                  <span className="ml-1 text-[var(--gold)]">
                    <Icon n="coin" size={10} />+{nextBonus(b)}
                  </span>
                )}
              </Btn>
            )}
            <button
              type="button"
              onClick={() => {
                const v = !autoNext;
                setAutoNext(v);
                try {
                  localStorage.setItem("pgd-autonext", v ? "1" : "0");
                } catch {}
              }}
              className={`px-btn h-6 px-1.5 text-[11px] ${autoNext ? "" : "opacity-70"}`}
              style={{ "--c": autoNext ? "#137f93" : "#2a2350" } as React.CSSProperties}
              title="자동: 필드가 비면 다음 웨이브를 바로 불러요 (보스 웨이브 앞은 직접)"
            >
              자동 {autoNext ? "ON" : "OFF"}
            </button>
          </div>
        )}
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
        {b.cheat && !b.result && <CheatPicker b={b} multi={multi} run={run} />}
        <TutorialCard b={b} />
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
            className="pointer-events-none absolute top-2 right-14 bg-[#5c1426] px-2 py-0.5 text-[12px] text-[#ffd0da]"
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
          <BossIntro
            key={bossLine.id}
            boss={bossLine.boss}
            phase={phaseOn(b.mods.glitch.lv, BOSSES[bossLine.boss].wave)}
            onDone={() => setBossLine(null)}
          />
        )}
      </div>

      {/* ── 아래: 고른 유닛 (한 줄) ── */}
      <div
        className="px-box absolute flex items-center gap-2.5 px-2.5"
        style={
          {
            left: 12,
            top: FIELD.y + FH2 + 6,
            width: CW,
            height: 576 - 10 - (FIELD.y + FH2 + 6),
            "--b": selDef ? FACTION_COLOR[selDef.faction] : "#3d3468",
          } as React.CSSProperties
        }
      >
        {selDef && selCell ? (
          <>
            <UnitIcon id={selDef.id} size={38} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="flex items-center gap-1.5">
                <b className="truncate text-[14px]">{selDef.name}</b>
                <GradeChip g={selDef.grade} />
                <FactionChip f={selDef.faction} />
                <span className="text-[12px] text-[var(--mute)]">
                  ×{selCell.units.length}
                  {sel >= CELLS && " · 보관함"}
                </span>
              </div>
              <p className="mt-1 truncate text-[12px] text-[var(--mute)]" title={selDef.desc}>
                {unitStats(selDef)} · {selDef.desc}
                {usedIn(selDef.id) && <> · 재료: {usedIn(selDef.id)}</>}
              </p>
            </div>
            <Btn
              tone={selCell.units.length >= STACK && selDef.grade < 3 ? "gold" : "ghost"}
              disabled={selCell.units.length < STACK || selDef.grade >= 3}
              onClick={() => run({ t: "merge", c: sel })}
              className={`h-[36px] w-[96px] text-[12px] font-bold ${selCell.units.length >= STACK && selDef.grade < 3 ? "dfn-pulse" : ""}`}
              hot="W"
              silent
            >
              {selDef.grade >= 3 ? "조합식으로" : `합성 ${selCell.units.length}/${STACK}`}
            </Btn>
            <Btn
              tone="danger"
              onClick={sellSel}
              className={`h-[36px] w-[96px] text-[12px] ${sellArm === sel ? "dfn-pulse" : ""}`}
              hot="E"
              silent
              title="레전드 이상은 두 번 눌러야 팔려요"
            >
              {(() => {
                const sp = sellOf(b, selDef);
                return sellArm === sel ? "한 번 더!" : `판매 +${sp.gold}${sp.stones ? ` ◆${sp.stones}` : ""}`;
              })()}
            </Btn>
          </>
        ) : (
          <DpsMeter b={b} />
        )}
        {multi && names && (
          <div className="flex shrink-0 flex-col gap-0.5 border-l-2 border-[var(--line)] pl-2.5 text-[12px] leading-tight">
            {ctrl.game.boards.map((o, i) =>
              i === ctrl.seat ? null : (
                <span key={i} className={o.result ? "text-[var(--dim)]" : ""}>
                  <b>{names[i]}</b>{" "}
                  {o.result ? (o.result.win ? "클리어" : `탈락 W${o.result.wave}`) : `W${o.wave} · ${o.enemies.length}/${capOf(o)}`}
                </span>
              )
            )}
          </div>
        )}
      </div>

      {/* ── 오른쪽: 조작 ── */}
      <div
        className="absolute flex flex-col gap-[10px]"
        style={{ left: FIELD.x + CW + 10, top: 56, width: 1012 - (FIELD.x + CW + 10), height: 510 }}
      >
        <div className="flex h-[30px] gap-1.5">
          {b.tickets.length > 0 && (
            <Btn tone="gold" onClick={() => setModal("pick")} className="dfn-pulse flex-1 text-[12px] font-bold" title="보스 확정 뽑기권">
              <Icon n="ticket" size={13} /> 뽑기권 {b.tickets.length}
            </Btn>
          )}
          <div className="px-inset flex min-w-0 flex-1 items-center gap-1 px-2 text-[12px] text-[var(--mute)]" title="보스(10 · 20 · 30 · 40 · 50)를 잡으면 치트 코드 3장 중 하나">
            <Icon n="flask" size={12} />
            {(() => {
              const next = [10, 20, 30, 40, 50].find((w) => w > b.wave || (w === b.wave && b.phase === "boss"));
              return next ? <>다음 치트 코드 · <b className="text-[var(--text)]">{next}W 보스</b></> : <>치트 코드 {b.cheats.length}개</>;
            })()}
          </div>
        </div>

        <Btn
          tone="main"
          onClick={() => run({ t: "summon" })}
          disabled={!hasEmpty(b) || (b.free <= 0 && b.gold < sCost)}
          className="h-[56px]"
          hot="Q"
          silent
        >
          <span className="flex items-center justify-center gap-2 leading-none">
            <span className={`${TITLE} px-shadow text-[18px]`}>소환{b.free > 0 ? ` · 무료 ${b.free}` : ""}</span>
            <span className="opacity-60">|</span>
            <b className="flex items-center gap-0.5 text-[13px]">
              {b.free > 0 ? "무료" : (
                <>
                  <Icon n="coin" size={12} />
                  {sCost}
                </>
              )}
            </b>
            {!hasEmpty(b) && <span className="text-[12px] text-[#ffd6f4]">꽉 참</span>}
          </span>
          <span className="mt-1 flex items-center justify-center gap-1.5 text-[12px]">
            {odds.map((p, i) =>
              p > 0 ? (
                <span key={i} style={{ color: i >= 1 ? GRADE_COLOR[i] : undefined }} className={i >= 1 ? "font-bold drop-shadow-[1px_1px_0_#000]" : "opacity-90"}>
                  {"NREL"[i]} {p}%
                </span>
              ) : null
            )}
          </span>
        </Btn>

        <section className="px-box px-2 pt-1 pb-2">
          <div className="mb-1 flex items-center text-[12px] text-[var(--mute)]">
            강화 <span className="ml-1 text-[var(--dim)]">피해 +{B.up.perLv * 100}%/Lv · 히든은 고유 효과</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {UP_KEYS.map((f, i) => {
              const c = upCost(b, f);
              return (
                <Btn
                  key={f}
                  tone={f === "hidden" ? "cyan" : f}
                  onClick={() => run({ t: "up", k: f })}
                  disabled={b.gold < c || b.up[f] >= B.up.max}
                  className="h-[40px] text-left"
                  hot={String(i + 1)}
                  silent
                >
                  <span className="flex items-center gap-1 px-1.5 text-[12px] font-bold">
                    <FactionIcon f={f} size={12} color="#fff" />
                    {FACTION_NAME[f]}
                    <span className="ml-auto pr-3 font-normal">Lv{b.up[f]}</span>
                  </span>
                  <span className="flex items-center gap-0.5 px-1.5 text-[12px]">
                    <b className="text-[var(--gold)]">
                      <Icon n="coin" size={10} />
                      {c}
                    </b>
                    <span className="ml-auto opacity-80">{f === "hidden" ? `효과 +${Math.round(b.up[f] * B.up.hiddenFx * 100)}%` : `+${Math.round(b.up[f] * B.up.perLv * 100)}%`}</span>
                  </span>
                </Btn>
              );
            })}
          </div>
          <Btn
            onClick={() => run({ t: "luck" })}
            disabled={!Number.isFinite(luckCost(b)) || b.gold < luckCost(b)}
            className="mt-1.5 h-[40px] w-full text-[12px]"
            hot="5"
            silent
          >
            <span className="flex items-center justify-center gap-1">
              <Icon n="clover" size={12} /> 소환 확률 Lv{b.luck}
              {Number.isFinite(luckCost(b)) ? (
                <b className="ml-1 text-[var(--gold)]">
                  <Icon n="coin" size={10} /> {luckCost(b)}
                </b>
              ) : (
                " MAX"
              )}
            </span>
            {Number.isFinite(luckCost(b)) && (
              <span className="block opacity-80">
                → <span style={{ color: GRADE_COLOR[2] }}>E {B.odds[b.luck + 1][2]}%</span> · <span style={{ color: GRADE_COLOR[3] }}>L {B.odds[b.luck + 1][3]}%</span>
              </span>
            )}
          </Btn>
        </section>

        <section className="px-box px-2 pt-1 pb-2">
          <div className="mb-1 flex items-center text-[12px] text-[var(--mute)]">
            <Icon n="dice" size={11} className="mr-1" /> 행운석 도박
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {(["E", "L"] as const).map((g) => {
              const gm = B.gamble[g];
              const p = Math.round((gm.p + (b.patch === "gambler" ? 0.1 : 0) + b.mods.gamble) * 100);
              const locked = b.wave < gm.from;
              return (
                <Btn
                  key={g}
                  onClick={() => run({ t: "gamble", g })}
                  disabled={locked || b.stones < gm.cost || !hasEmpty(b)}
                  className="relative h-[32px] text-[12px]"
                  silent
                  title={locked ? `${gm.from}웨이브부터` : ""}
                >
                  <b style={{ color: GRADE_COLOR[g === "E" ? 2 : 3] }} className="drop-shadow-[1px_1px_0_#000]">
                    {g === "E" ? "에픽" : "레전드"}
                  </b>{" "}
                  <Icon n="gem" size={10} />
                  {gm.cost} · {p}%{locked && <Badge>{gm.from}W+</Badge>}
                </Btn>
              );
            })}
          </div>
          <div className="mt-1.5 mb-1 flex items-center text-[12px] text-[var(--mute)]">
            <Icon n="rift" size={11} className="mr-1" /> 균열
            <span className="ml-1 text-[var(--dim)]">{B.rift.sec}초 안에</span>
            {b.riftCd > 0 && <span className="ml-auto text-[var(--pink)]">{Math.ceil(b.riftCd / TPS)}s</span>}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {RIFT_TIERS.map((t) => {
              const risk = riftRisk(b, t, dpsNow);
              const lockW = t === "S" ? B.rift.S.from : B.rift.from;
              const locked = b.wave < lockW;
              return (
                <Btn
                  key={t}
                  onClick={() => run({ t: "rift", tier: t })}
                  disabled={locked || b.riftCd > 0 || b.enemies.some((e) => e.rift > 0)}
                  className="relative h-[32px] text-[12px]"
                  silent
                  title={risk ? `지금 화력으로 ${B.rift.sec}초 안에 잡기: ${risk.label} (최근 DPS 기준 어림)` : ""}
                >
                  <b className={t === "S" ? "text-[var(--gold)]" : "text-[var(--pink)]"}>{t}</b> <Icon n="gem" size={10} />
                  {B.rift[t].stones} +{B.rift[t].gold}
                  {locked ? (
                    <Badge>{lockW}W+</Badge>
                  ) : (
                    risk && (
                      <span className="absolute -top-2 right-0.5 px-1 text-[10px] leading-[13px] font-bold text-[#0a0816] shadow-[0_0_0_1px_#0a0816]" style={{ background: risk.color }}>
                        {risk.label}
                      </span>
                    )
                  )}
                </Btn>
              );
            })}
          </div>
        </section>

        {b.patch === "pure" && b.pure <= 0 && (
          <p
            className="mt-auto mb-1.5 text-center text-[12px] leading-tight font-bold text-[#ff4f6a] drop-shadow-[1px_1px_0_#000]"
            title="보관함은 비율에 안 세요 — 다른 세력은 보관함으로 옮기면 비율이 올라가요"
          >
            순혈 프로토콜이 꺼졌어요
            <span className="block text-[11px] font-normal text-[#ff8a9b]">
              {b.mono ? `${FACTION_NAME[b.mono]} ${Math.round(b.pureR * 100)}%` : "필드에 유닛 없음"} · 한 세력{" "}
              {Math.round(TUNE.pureFrom * 100)}% 이상이면 켜져요
            </span>
          </p>
        )}
        <div className={`${b.patch === "pure" && b.pure <= 0 ? "" : "mt-auto"} grid grid-cols-3 gap-1.5`}>
          <Btn
            tone={recipesReady ? "gold" : "ghost"}
            onClick={() => setModal("recipe")}
            className={`h-[34px] text-[12px] font-bold ${recipesReady ? "dfn-pulse" : ""}`}
            hot="R"
          >
            <Icon n="flask" size={12} /> 조합{recipesReady ? ` ${recipesReady}` : ""}
          </Btn>
          <Btn onClick={() => setModal("mission")} className="h-[34px] text-[12px]">
            <Icon n="star" size={12} /> 미션 {b.missions.length}/{MISSIONS.length}
          </Btn>
          <Btn onClick={() => setModal("codex")} className="h-[34px] text-[12px]">
            <Icon n="book" size={12} /> 도감
          </Btn>
        </div>
      </div>

      {/* ── 창 ── */}
      {modal === "pick" && b.tickets.length > 0 && (
        <PickModal b={b} run={run} onClose={() => setModal(null)} />
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
            {!b.result && (
              <Btn
                tone="gold"
                arrow
                className="h-[40px] text-[14px] font-bold"
                onClick={() => {
                  if (!quitArm) return setQuitArm(true);
                  setQuitArm(false);
                  setModal(null);
                  ctrl.setPaused(false);
                  run({ t: "quit" });
                }}
              >
                {quitArm ? "정말 포기할까요? (한 번 더 누르기)" : `포기하기 — ${b.wave}웨이브에서 끝내고 기록 · 보상 받기`}
              </Btn>
            )}
            <Btn className="h-[34px] text-[13px]" onClick={() => (resetTutorial(), setModal(null), ctrl.setPaused(false), force())}>
              튜토리얼 다시 보기 (처음부터)
            </Btn>
            <Btn tone="danger" arrow className="h-[40px] text-[14px]" onClick={onExit}>
              {multi ? "방에서 나가기 (내 보드는 그대로 진행돼요)" : "나가기 (기록 · 보상 없음, 나중에 이어하기)"}
            </Btn>
            <div className="px-inset mt-1 p-3 text-[12px] leading-relaxed text-[var(--mute)]">
              <p className="mb-1 font-bold text-[var(--text)]">단축키</p>
              <p>
                <K>Q</K> 소환 <K>W</K> 합성 <K>E</K> 판매 <K>1</K>
                <K>2</K>
                <K>3</K> 세력 강화 <K>4</K> 히든 강화 <K>5</K> 확률 강화 <K>R</K> 조합식 <K>Space</K> 일시정지 <K>F</K>{" "}
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
            <p className="text-[12px] text-[var(--dim)]">
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
                  ? `${b.wave}웨이브 보스를 제한 시간 안에 못 잡았어요${boss ? ` · 보스 체력 ${Math.max(1, Math.ceil((boss.hp / boss.max) * 100))}% 남음` : ""}`
                  : `${b.wave}웨이브 · 필드의 적이 ${capOf(b)}마리가 됐어요`}
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

const UP_KEYS = ["knight", "mech", "arcane", "hidden"] as const;
/** 버튼 오른쪽 위 작은 표시 (5W+ 같은 잠김 · 기한) */
function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="absolute -top-2 right-0.5 bg-[#2a2350] px-1 text-[10px] leading-[13px] font-bold text-[var(--mute)] shadow-[0_0_0_1px_#0a0816]">
      {children}
    </span>
  );
}

function K({ children }: { children: ReactNode }) {
  return <span className="px-key mx-[2px] inline-block !text-[12px] !text-white">{children}</span>;
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
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 text-[12px] leading-tight text-[var(--mute)]">
        <p className="truncate">
          <b className="text-[var(--text)]">칸을 누르면</b> 정보 · <b className="text-[var(--text)]">끌면</b> 자리 바꾸기 (보관함 칸도) · 같은 유닛 3기 → 합성
        </p>
        <p className="flex items-center gap-x-3">
          {FACTIONS.map((f) => (
            <span key={f} className="flex items-center gap-1">
              <FactionIcon f={f} size={10} />
              <b style={{ color: FACTION_COLOR[f] }}>{FACTION_NAME[f]}</b>
              <span className="text-[var(--dim)]">
                {f === "knight" ? "작은 적" : f === "mech" ? "큰 적" : "크기 · 방어 무시"}
              </span>
            </span>
          ))}
        </p>
      </div>
    );
  return (
    <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-1">
      {rows.slice(0, 4).map(([id, v]) => (
        <div key={id} className="flex items-center gap-1.5 text-[12px]">
          <FactionIcon f={UNIT[id].faction} size={9} />
          <span className="w-[74px] truncate" style={{ color: GRADE_COLOR[UNIT[id].grade] }}>
            {UNIT[id].name}
          </span>
          <Bar className="flex-1" h={5} value={v / total} color={FACTION_COLOR[UNIT[id].faction]} />
          <span className="w-[28px] text-right text-[var(--mute)]">{((v / total) * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

function RecipeModal({ b, run, onClose }: { b: Board; run: (c: Cmd) => boolean; onClose(): void }) {
  const have = counts(b);
  // 세력별로 모아 보기 (탭) — 만들 수 있는 것이 있는 세력은 탭에 점
  const [tab, setTab] = useState<"all" | Faction>(() => {
    try {
      return (localStorage.getItem("pgd-recipe-tab") as "all" | Faction) || "all";
    } catch {
      return "all";
    }
  });
  const pickTab = (t: "all" | Faction) => {
    setTab(t);
    try {
      localStorage.setItem("pgd-recipe-tab", t);
    } catch {}
  };
  const ORDER: Faction[] = ["knight", "mech", "arcane", "hidden"];
  // 재료가 얼마나 모였나 (0~1) — 만들 수 있는 것 → 많이 모인 것 순으로 위에
  const haveOf = (n: string) => (n[0] === "@" ? Object.entries(have).reduce((a, [id, k]) => a + (needMatch(n, id) ? k : 0), 0) : (have[n] ?? 0));
  const progress = (r: (typeof RECIPES)[number]) => {
    const need: Record<string, number> = {};
    for (const n of r.needs) need[n] = (need[n] ?? 0) + 1;
    const e = Object.entries(need);
    return e.reduce((a, [n, k]) => a + Math.min(1, haveOf(n) / k), 0) / e.length;
  };
  const okNow = (id: string) => canRecipe(b, id);
  const base = [...RECIPES].filter((r) => tab === "all" || UNIT[r.id].faction === tab);
  // 지금 만들 수 있는 것은 어느 탭에서든 맨 위에 (다른 세력 것이어도)
  const readyList = RECIPES.filter((r) => okNow(r.id)).sort((x, y) => UNIT[y.id].grade - UNIT[x.id].grade);
  const list = [
    ...readyList,
    ...base
      .filter((r) => !okNow(r.id))
      .sort(
        (x, y) =>
          (tab === "all" ? ORDER.indexOf(UNIT[x.id].faction) - ORDER.indexOf(UNIT[y.id].faction) : 0) || progress(y) - progress(x)
      ),
  ];
  const ready = (f: Faction) => RECIPES.some((r) => UNIT[r.id].faction === f && canRecipe(b, r.id));
  return (
    <Modal title="조합식 — 신화 · 초월 · 히든" onClose={onClose} wide accent="#ffd23f">
      <div className="mb-2.5 flex gap-1.5">
        {(["all", ...ORDER] as const).map((t) => (
          <Btn
            key={t}
            tone={tab === t ? (t === "all" ? "main" : t === "hidden" ? "cyan" : t) : "ghost"}
            className="relative h-8 px-3 text-[12px] font-bold"
            onClick={() => pickTab(t)}
          >
            {t !== "all" && <FactionIcon f={t} size={11} className="mr-1" />}
            {t === "all" ? "전체" : FACTION_NAME[t]}
            {t !== "all" && ready(t) && <i className="dfn-blink absolute top-0.5 right-0.5 block h-2 w-2 bg-[var(--gold)]" />}
          </Btn>
        ))}
      </div>
      <div className="flex flex-col gap-2.5">
        {list.map((r, i) => {
          const isReady = i < readyList.length;
          const head = isReady ? (
            i === 0 ? (
              <p key="h-ready" className="flex items-center gap-1 text-[13px] font-bold text-[var(--gold)]">
                <Icon n="star" size={12} /> 지금 만들 수 있어요
              </p>
            ) : null
          ) : (tab === "all" || i === readyList.length) &&
            (i === readyList.length || UNIT[list[i - 1].id].faction !== UNIT[r.id].faction) ? (
              <p
                key={`h-${r.id}`}
                className="mt-1 flex items-center gap-1 text-[13px] font-bold"
                style={{ color: FACTION_COLOR[UNIT[r.id].faction] }}
              >
                <FactionIcon f={UNIT[r.id].faction} size={12} /> {FACTION_NAME[UNIT[r.id].faction]}
              </p>
            ) : null;
          const known = !r.hidden || foundHidden(r.id);
          const ok = isReady;
          const open = recipeOpen(b, r.id);
          const d = UNIT[r.id];
          const need: Record<string, number> = {};
          for (const n of r.needs) need[n] = (need[n] ?? 0) + 1;
          return (
            <Fragment key={r.id}>
            {head}
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
                {(have[r.id] ?? 0) > 0 && (
                  <span className="ml-1 bg-[#1f5a35] px-1 py-px text-[11px] font-bold text-[#6dff8f]" title="필드 · 보관함에 이미 있어요">
                    보유 중{have[r.id] > 1 ? ` ×${have[r.id]}` : ""}
                  </span>
                )}
                <p className="mt-0.5 text-[12px] leading-tight text-[var(--mute)]">
                  {known ? d.desc : "숨겨진 조합식 — 어떤 유닛들이 모이면…?"}
                </p>
                {!open && <p className="mt-0.5 text-[12px] text-[#fff6d6]">정비소 「초월 소환」으로 해금해야 만들 수 있어요</p>}
              </div>
              <div className="flex flex-1 flex-wrap items-center gap-1.5">
                {Object.entries(need).map(([id, n]) =>
                  known ? (
                    <span
                      key={id}
                      className="flex items-center gap-1 bg-[#0a0816]/60 px-1.5 py-1 text-[12px]"
                    >
                      {id[0] === "@" ? <Icon n="star" size={18} /> : <UnitIcon id={id} size={22} dim={haveOf(id) < n} />}
                      <span style={{ color: haveOf(id) >= n ? "#6dff8f" : "#ff9ab0" }}>
                        {needName(id)} {Math.min(haveOf(id), 99)}/{n}
                      </span>
                    </span>
                  ) : (
                    <span
                      key={id}
                      className="bg-[#0a0816]/60 px-2 py-1 text-[12px] text-[var(--dim)]"
                    >
                      {id[0] === "@" ? GRADE_NAME[Number(id.slice(1))] : GRADE_NAME[UNIT[id].grade]} ?
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
            </Fragment>
          );
        })}
      </div>
      {b.patch === "pure" && (
        <p className="mt-2 text-[12px] text-[var(--cyan)]">
          순혈 프로토콜: 보관함은 비율에 안 세요 — 다른 세력 재료는 보관함에 모아 두면 효과가 덜 줄어요.
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

function BossIntro({ boss, phase, onDone }: { boss: number; phase: boolean; onDone(): void }) {
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
        {phase && d.phase && (
          <p className="mt-1 text-[12px] font-bold text-[var(--red)]">
            2페이즈 있음 — 체력 {Math.round(d.phase.at * 100)}% 밑에서 「{phaseSkillName(d)}」
          </p>
        )}
      </div>
    </div>
  );
}

/** 보물방 진행 (위쪽 줄): 남은 시간 · 깎은 비율 · 받은 골드 */
function TreasurePanel({ b }: { b: Board }) {
  const r = b.troom!;
  const e = b.enemies.find((x) => x.tre);
  const ratio = r.killed || !e ? 1 : Math.max(0, Math.min(1, (r.max - Math.max(0, e.hp)) / r.max));
  // 지금까지 깎은 만큼 판 끝에 받을 재화 (서버와 같은 계산)
  const rw = treasureReward(b.mods.glitch.lv, { dmg: ratio * r.max, max: r.max, killed: r.killed });
  return (
    <div className="px-box flex h-full min-w-[150px] max-w-[240px] flex-1 flex-col justify-center px-2.5" style={{ "--b": "#ffd23f" } as React.CSSProperties}>
      <div className="flex items-baseline justify-between text-[12px] leading-none">
        <b className="text-[13px] whitespace-nowrap text-[var(--gold)]">보물방</b>
        <span className="whitespace-nowrap text-[var(--mute)]">
          {Math.round(ratio * 100)}% · {Math.ceil(r.t / TPS)}s · 조각 +{rw.pieces ?? 0}
          {!!rw.cores && ` · 코어 +${rw.cores}`}
        </span>
      </div>
      <Bar className="mt-1.5" h={6} value={1 - ratio} color="#ffd23f" />
    </div>
  );
}

/** 필드 위 작은 딜량 창 (위쪽 길 위에 — 유닛 칸을 가리지 않게): 최근 DPS + 유닛별 비중 3개 */
function DpsOverlay({ b, dps }: { b: Board; dps: number }) {
  const rows = Object.entries(b.dealt).sort((x, y) => y[1] - x[1]);
  const total = rows.reduce((a, [, v]) => a + v, 0) || 1;
  return (
    <div className="pointer-events-none absolute top-1 right-[110px] z-10 w-[184px] bg-[#0a0816]/80 px-1.5 py-0.5 shadow-[0_0_0_2px_#2a2350]">
      <p className="flex justify-between text-[12px] leading-[15px]">
        <span className="text-[var(--mute)]">최근 DPS</span>
        <b className="text-[var(--cyan)]">{fmtNum(dps)}</b>
      </p>
      {rows.slice(0, 3).map(([id, v]) => (
        <div key={id} className="flex items-center gap-1 text-[12px] leading-[15px]">
          <FactionIcon f={UNIT[id].faction} size={9} />
          <span className="w-[72px] truncate" style={{ color: GRADE_COLOR[UNIT[id].grade] }}>
            {UNIT[id].name}
          </span>
          <Bar className="flex-1" h={4} value={v / total} color={FACTION_COLOR[UNIT[id].faction]} />
          <span className="w-[26px] text-right text-[var(--mute)]">{Math.round((v / total) * 100)}%</span>
        </div>
      ))}
      {!rows.length && <p className="text-[12px] text-[var(--dim)]">아직 피해 기록 없음</p>}
    </div>
  );
}

/** 최근 10초 평균 DPS */
function recentDps(q: { t: number; v: number }[]) {
  if (q.length < 3) return 0;
  const a = q[0],
    z = q[q.length - 1];
  return z.t > a.t ? (z.v - a.v) / (z.t - a.t) : 0;
}

/** 균열 위험도 어림: 균열 적 체력 ÷ 제한 시간 vs 최근 DPS (보스 · 졸개도 같이 치니 넉넉히 1.6배로 봄) */
function riftRisk(b: Board, t: RiftTier, dps: number) {
  if (!dps) return null;
  const hp = hpOf(Math.max(1, b.wave)) * B.rift[t].hp * b.mods.glitch.hp;
  const need = (hp / B.rift.sec) * 1.6;
  const r = dps / need;
  return r >= 2 ? { label: "여유", color: "#6dff8f" } : r >= 1 ? { label: "적정", color: "#ffd23f" } : { label: "위험", color: "#ff4d6d" };
}

/**
 * 골라 뽑기 (보스 보상): 뽑기권은 쓰지 않으면 다음 웨이브로 그대로 넘어가 쌓임(이월).
 * 등급마다 탭 — 몇 장 남았는지 보이고, 아무 등급 것부터 써도 됨
 */
function PickModal({ b, run, onClose }: { b: Board; run: (c: Cmd) => boolean; onClose(): void }) {
  const grades = [...new Set(b.tickets)].sort((x, y) => y - x);
  const [g0, setG] = useState(grades[0]);
  const g = grades.includes(g0) ? g0 : grades[0];
  const n = (x: number) => b.tickets.filter((t) => t === x).length;
  return (
    <Modal title="골라 뽑기" onClose={onClose} wide accent={GRADE_COLOR[g]}>
      <div className="mb-3 flex items-center gap-1.5">
        {grades.map((x) => (
          <Btn
            key={x}
            tone={x === g ? "gold" : "ghost"}
            className="h-8 px-3 text-[13px] font-bold"
            onClick={() => setG(x)}
          >
            <span style={{ color: x === g ? undefined : GRADE_COLOR[x] }}>{GRADE_NAME[x]}</span> ×{n(x)}
          </Btn>
        ))}
        <span className="ml-2 text-[12px] text-[var(--mute)]">
          보스를 잡을 때 받은 뽑기권 — 안 쓰면 그대로 남아 다음에 써도 돼요 (지금 {b.tickets.length}장)
        </span>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {FACTIONS.map((f) => (
          <div key={f} className="px-inset p-2" style={{ "--b": FACTION_COLOR[f] + "66" } as React.CSSProperties}>
            <p className="mb-2 flex items-center gap-1.5 text-[14px] font-bold" style={{ color: FACTION_COLOR[f] }}>
              <FactionIcon f={f} size={14} /> {FACTION_NAME[f]}
            </p>
            <div className="flex flex-col gap-2">
              {poolOf(f, g as Grade).map((u) => (
                <Btn
                  key={u.id}
                  tone={f}
                  onClick={() => {
                    if (run({ t: "pick", id: u.id }) && b.tickets.length === 0) onClose();
                  }}
                  className="flex items-center gap-2 p-2 text-left"
                  silent
                >
                  <UnitIcon id={u.id} size={40} />
                  <span className="min-w-0">
                    <b className="block text-[13px]">{u.name}</b>
                    <span className="block text-[12px] leading-tight opacity-80">{u.desc}</span>
                  </span>
                </Btn>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

const CHEAT_CAT_ICON = { unit: "star", gold: "coin", dmg: "up", buff: "flask" } as const;

/** 눌린 물리 키 → 단축키 글자 (한글 자판 · IME 상태와 상관없이) */
function keyOf(e: KeyboardEvent): string {
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) return c.slice(3).toLowerCase();
  if (/^(Digit|Numpad)[0-9]$/.test(c)) return c.slice(-1);
  if (c === "Space") return " ";
  if (c === "Escape") return "escape";
  return (e.key ?? "").toLowerCase();
}

/** 치트 코드 고르기 — 보스를 잡으면 필드 위에 3장 (고를 때까지 멈춤) */
function CheatPicker({ b, multi, run }: { b: Board; multi: boolean; run: (c: Cmd) => boolean }) {
  const o = b.cheat!;
  if (o.kind === "patch") return <PatchPicker b={b} multi={multi} run={run} />;
  const left = multi ? Math.max(0, Math.ceil(CHEAT_MULTI_SEC - o.t / TPS)) : null;
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#05040c]/75 px-6">
      <div className="text-center">
        <p className={`${TITLE} px-shadow dfn-pop text-[26px] text-white`}>치트 코드</p>
        <p className="px-shadow text-[13px] text-[var(--mute)]">
          하나를 골라 이 판 끝까지 · 카드마다 다시 뽑기 {o.rr.length ? `${Math.max(...o.rr)}번` : ""} · {multi ? `${left}초 뒤 첫 카드로` : "고르는 동안 게임이 멈춰요"}
        </p>
      </div>
      <div className="flex w-full max-w-[640px] gap-3">
        {o.offer.map((id, i) => {
          const c = CHEAT[id];
          const col = CHEAT_TIER_COLOR[c.tier];
          return (
            <div key={i} className="flex flex-1 flex-col gap-1.5">
              <button
                type="button"
                className="px-box dfn-pop flex min-h-[170px] flex-col items-center gap-1.5 p-3 text-center transition-transform hover:-translate-y-1"
                style={{ "--b": col } as React.CSSProperties}
                onClick={() => {
                  if (run({ t: "cheat", i })) sfx("myth");
                }}
              >
                <span className="text-[12px] font-bold" style={{ color: col }}>
                  {CHEAT_TIER_NAME[c.tier]} · {CHEAT_CAT_NAME[c.cat]}
                </span>
                <b className="px-shadow text-[17px] leading-tight text-white">{c.name}</b>
                <span className="text-[13px] leading-snug text-[var(--text)]">{c.desc}</span>
              </button>
              <Btn className="h-8 text-[12px]" disabled={o.rr[i] <= 0} onClick={() => run({ t: "reroll", i })}>
                다시 뽑기 ({o.rr[i]})
              </Btn>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 시작 치트 (패치) — 판을 시작할 때 4개 중 하나, 고를 때까지 멈춤 */
function PatchPicker({ b, multi, run }: { b: Board; multi: boolean; run: (c: Cmd) => boolean }) {
  const o = b.cheat!;
  const left = multi ? Math.max(0, Math.ceil(CHEAT_MULTI_SEC - o.t / TPS)) : null;
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#05040c]/75 px-6">
      <div className="text-center">
        <p className={`${TITLE} px-shadow dfn-pop text-[26px] text-white`}>시작 치트 코드</p>
        <p className="px-shadow text-[13px] text-[var(--mute)]">
          이 판의 운영 방식을 하나 골라요 (못 바꿔요) · {multi ? `${left}초 뒤 연합 프로토콜로` : "고르는 동안 게임이 멈춰요"}
        </p>
      </div>
      <div className="grid w-full max-w-[680px] grid-cols-2 gap-3">
        {o.offer.map((id, i) => {
          const p = PATCHES.find((x) => x.id === id)!;
          return (
            <button
              key={id}
              type="button"
              className="px-box dfn-pop flex min-h-[110px] flex-col items-center gap-1.5 p-3 text-center transition-transform hover:-translate-y-1"
              style={{ "--b": "#ffd23f" } as React.CSSProperties}
              onClick={() => {
                if (run({ t: "cheat", i })) sfx("ui-click", 1, 0.9);
              }}
            >
              <span className="text-[12px] font-bold text-[#ffd23f]">시작 · 운영</span>
              <b className="px-shadow text-[17px] leading-tight text-white">{p.name}</b>
              <span className="text-[12px] leading-snug text-[var(--text)]">{p.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
