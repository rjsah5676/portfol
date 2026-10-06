"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import tm1 from "@/img/melongame/tm1.png";
import tm2 from "@/img/melongame/tm2.png";
import tm3 from "@/img/melongame/tm3.png";
import tm4 from "@/img/melongame/tm4.png";
import tm5 from "@/img/melongame/tm5.png";
import tm6 from "@/img/melongame/tm6.png";
import tm7 from "@/img/melongame/tm7.png";
import tm8 from "@/img/melongame/tm8.png";
import tm9 from "@/img/melongame/tm9.png";
import tmT from "@/img/melongame/tm_t.png";
import tmMain from "@/img/melongame/mainMelon.png";
import bbyongSound from "@/sounds/melongame/bbyong.mp3";
import bgmSound from "@/sounds/melongame/bgm.mp3";
import endSound from "@/sounds/melongame/endbgm.mp3";
import "@/css/Page/melon.css";
import GameHeader from "@/components/GameHeader";
import { MELON_GUIDE } from "@/data/gameGuides";
import { lockScroll } from "@/lib/scrollLock";
import { rankDateLabel } from "@/lib/rankDate";
import { getTopMelonScores, addMelonScore, type MelonScore } from "@/firestore/melonGame";
import {
  CELL,
  COLS,
  ROWS,
  TICK_MS,
  TIME_START,
  TIME_STEP,
  TOTAL_SEC,
  cellsIn,
  createBoard,
  isClear,
  rangeOf,
  type Board,
} from "@/lib/melon/logic";

const MELON_SRC = [tm1, tm2, tm3, tm4, tm5, tm6, tm7, tm8, tm9].map((m) => m.src);

/** 판 바깥 여백(논리 좌표) */
const PAD = 20;
const W = COLS * CELL + PAD * 2;
const H = ROWS * CELL + PAD * 2;
const GRAVITY = 2600; // px/s²

type Phase = "menu" | "play" | "over";

/**
 * 판(점수판 포함)이 한 화면에 들어오게 하는 최대 폭.
 * 일반: 고정 헤더+메뉴·머리말·점수판 높이를 빼고 / 크게 보기: 점수판만 빼고
 */
function boardMax(rot: boolean, big: boolean) {
  const aspect = rot ? H / W : W / H;
  const reserve = big ? 86 : rot ? 250 : 350;
  return `max(${big ? 0 : 300}px, min(100%, calc((100svh - ${reserve}px) * ${aspect})))`;
}

interface Faller {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  v: number;
  age: number;
}
interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  r: number;
}
interface Floater {
  x: number;
  y: number;
  text: string;
  age: number;
}
const VOL_KEY = "melon:volume";
interface Volume {
  bgm: number;
  sfx: number;
}
const DEFAULT_VOL: Volume = { bgm: 0.7, sfx: 0.5 };

function loadVolume(): Volume {
  try {
    const v = JSON.parse(localStorage.getItem(VOL_KEY) ?? "null");
    if (v && typeof v.bgm === "number" && typeof v.sfx === "number") return v;
  } catch {}
  return DEFAULT_VOL;
}

export default function MelonGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /**
   * 세로로 긴 좁은 화면(폰 세로)에서는 판을 90° 돌려 12×21로 보여줌 → 칸이 약 1.7배 커짐.
   * 화면에 그리는 위치만 바뀌고, 드래그 좌표는 원래 판 좌표로 되돌려서 판정하므로 규칙·점수는 그대로.
   */
  const [rot, setRot] = useState(false);
  const rotRef = useRef(false);
  /** 판 칸(c, r) → 화면 좌표 (돌린 화면이면 가로·세로를 바꿈) */
  const cellXY = (c: number, r: number): [number, number] =>
    rotRef.current ? [PAD + r * CELL, PAD + c * CELL] : [PAD + c * CELL, PAD + r * CELL];
  /** 화면 좌표 → 원래 판 기준 좌표 (판정은 항상 이 좌표로) */
  const toBoard = (x: number, y: number): [number, number] =>
    rotRef.current ? [y - PAD, x - PAD] : [x - PAD, y - PAD];
  /** 크게 보기: 사이트 헤더·메뉴를 가리고 판을 화면 가득 (가능하면 전체화면 + 세로 고정 → 판을 돌린 세로 모양으로 길게) */
  const [big, setBig] = useState(false);
  const [rankOpen, setRankOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("menu");
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TIME_START);
  const [ready, setReady] = useState(false);
  const [vol, setVol] = useState<Volume>(DEFAULT_VOL);
  const [volOpen, setVolOpen] = useState(false);
  const [ranks, setRanks] = useState<MelonScore[] | null>(null);
  const [name, setName] = useState("");
  const [submitState, setSubmitState] = useState<"idle" | "sending" | "done" | "error">("idle");

  // 게임 루프에서 쓰는 값은 ref로 (렌더와 무관하게 최신값)
  const phaseRef = useRef<Phase>("menu");
  const boardRef = useRef<Board>([]);
  const timeRef = useRef(TIME_START);
  const scoreRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layerDirty = useRef(true);
  const drag = useRef<{
    id: number;
    ax: number;
    ay: number;
    bx: number;
    by: number;
    moved: boolean;
  } | null>(null);
  const fx = useRef({
    fallers: [] as Faller[],
    drops: [] as Drop[],
    floaters: [] as Floater[],
  });
  const imgs = useRef<HTMLImageElement[]>([]);
  const ring = useRef<HTMLImageElement | null>(null);
  const audio = useRef<{
    bbyong: HTMLAudioElement;
    bgm: HTMLAudioElement;
    end: HTMLAudioElement;
  } | null>(null);

  const loadRanks = useCallback(() => {
    getTopMelonScores(10)
      .then(setRanks)
      .catch(() => setRanks([]));
  }, []);

  // ── 이미지·소리 준비 ──
  useEffect(() => {
    let left = MELON_SRC.length + 1;
    const done = () => {
      layerDirty.current = true; // 다 불러오기 전에 그린 판이 비어 보이지 않게
      left -= 1;
      if (left === 0) setReady(true);
    };
    imgs.current = MELON_SRC.map((src) => {
      const im = new Image();
      im.onload = done;
      im.onerror = done;
      im.src = src;
      return im;
    });
    const r = new Image();
    r.onload = done;
    r.onerror = done;
    r.src = tmT.src;
    ring.current = r;

    const bgm = new Audio(bgmSound);
    bgm.loop = true;
    audio.current = { bbyong: new Audio(bbyongSound), bgm, end: new Audio(endSound) };
    const v = loadVolume();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 볼륨은 마운트 후에만 읽을 수 있음
    setVol(v);

    boardRef.current = createBoard(); // 메뉴 뒤에 깔리는 장식용 판
    layerDirty.current = true;
    loadRanks();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const a = audio.current;
      if (a)
        [a.bgm, a.end].forEach((el) => {
          el.pause();
          el.currentTime = 0;
        });
    };
  }, [loadRanks]);

  // 볼륨 반영·저장
  useEffect(() => {
    const a = audio.current;
    if (a) {
      a.bgm.volume = vol.bgm;
      a.end.volume = vol.bgm;
      a.bbyong.volume = vol.sfx;
    }
    try {
      localStorage.setItem(VOL_KEY, JSON.stringify(vol));
    } catch {}
  }, [vol]);

  // 화면 방향 감지
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait) and (max-width: 700px)");
    const on = () => {
      rotRef.current = mq.matches;
      setRot(mq.matches);
      layerDirty.current = true;
      drag.current = null;
    };
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // 크게 보기 켜고 끄기
  useEffect(() => {
    if (!big) return;
    const el = wrapRef.current;
    const unlock = lockScroll();
    document.body.classList.add("game-full");
    const orient = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    };
    // 전체화면·세로 고정은 되는 브라우저(안드로이드 크롬 등)에서만, 안 되면 화면 덮기만
    el?.requestFullscreen?.()
      .then(() => orient.lock?.("portrait"))
      .catch(() => {});
    const onFs = () => {
      if (!document.fullscreenElement) setBig(false);
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      unlock();
      document.body.classList.remove("game-full");
      try {
        orient.unlock?.();
      } catch {}
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [big]);

  // ── 그리기 루프 ──
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const layer = document.createElement("canvas");
    const lctx = layer.getContext("2d")!;
    let dpr = 0;
    let cw = 0;
    let ch = 0;
    let raf = 0;
    let last = performance.now();

    const fitDpr = () => {
      const d = Math.min(2, window.devicePixelRatio || 1);
      const [w, h] = rotRef.current ? [H, W] : [W, H];
      if (d === dpr && w === cw && h === ch) return;
      dpr = d;
      cw = w;
      ch = h;
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      layer.width = cw * dpr;
      layer.height = ch * dpr;
      layerDirty.current = true;
    };

    /** 판(배경 + 남은 멜론)은 바뀔 때만 다시 그려 둠 */
    const drawLayer = () => {
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lctx.clearRect(0, 0, cw, ch);
      const bg = lctx.createLinearGradient(0, 0, 0, ch);
      bg.addColorStop(0, "#F4FBEC");
      bg.addColorStop(1, "#E7F6DA");
      lctx.fillStyle = bg;
      lctx.fillRect(0, 0, cw, ch);
      // 빈 칸 자리 표시
      lctx.fillStyle = "rgba(124,196,90,0.13)";
      for (let c = 0; c < COLS; c++)
        for (let r = 0; r < ROWS; r++) {
          const [x, y] = cellXY(c, r);
          lctx.beginPath();
          lctx.arc(x + CELL / 2, y + CELL / 2, CELL * 0.36, 0, Math.PI * 2);
          lctx.fill();
        }
      const b = boardRef.current;
      for (let c = 0; c < b.length; c++)
        for (let r = 0; r < ROWS; r++) {
          const v = b[c][r];
          const im = imgs.current[v - 1];
          if (v && im?.complete) lctx.drawImage(im, ...cellXY(c, r), CELL, CELL);
        }
      layerDirty.current = false;
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      fitDpr();
      if (layerDirty.current) drawLayer();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(layer, 0, 0, cw, ch);

      // 드래그 선택
      const d = drag.current;
      if (d && d.moved && phaseRef.current === "play") {
        const g = rangeOf(...toBoard(d.ax, d.ay), ...toBoard(d.bx, d.by));
        for (const { c, r } of cellsIn(boardRef.current, g))
          if (ring.current) ctx.drawImage(ring.current, ...cellXY(c, r), CELL, CELL);
        const x = Math.min(d.ax, d.bx);
        const y = Math.min(d.ay, d.by);
        const w = Math.abs(d.bx - d.ax);
        const h = Math.abs(d.by - d.ay);
        ctx.fillStyle = "rgba(255,209,102,0.28)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = "#FFB23F";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
      }

      const F = fx.current;
      // 터진 과즙 방울
      F.drops = F.drops.filter((p) => (p.age += dt) < p.life);
      for (const p of F.drops) {
        p.vy += GRAVITY * 0.5 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = 1 - p.age / p.life;
        ctx.fillStyle = p.r > 3 ? "#FF9EB5" : "#8EDB6A";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // 톡 튀어 오르며 커졌다가 돌면서 떨어지는 멜론
      F.fallers = F.fallers.filter((m) => m.y < ch + CELL * 2);
      for (const m of F.fallers) {
        m.age += dt;
        const pop = m.age < 0.09;
        if (!pop) {
          m.vy += GRAVITY * dt;
          m.x += m.vx * dt;
          m.y += m.vy * dt;
          m.rot += m.vr * dt;
        }
        const s = pop ? 1 + (m.age / 0.09) * 0.28 : Math.max(0.6, 1.28 - (m.age - 0.09) * 0.9);
        const im = imgs.current[m.v - 1];
        if (!im) continue;
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(m.rot);
        ctx.globalAlpha = Math.max(0, Math.min(1, 1.4 - m.age));
        ctx.drawImage(im, (-CELL / 2) * s, (-CELL / 2) * s, CELL * s, CELL * s);
        ctx.restore();
      }

      // +점수
      F.floaters = F.floaters.filter((f) => (f.age += dt) < 0.9);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const f of F.floaters) {
        const k = f.age / 0.9;
        ctx.globalAlpha = 1 - k * k;
        ctx.font = `${Math.round(30 + (1 - k) * 6)}px Jua, sans-serif`;
        ctx.lineWidth = 6;
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#FFFFFF";
        ctx.strokeText(f.text, f.x, f.y - k * 46);
        ctx.fillStyle = "#FF8FA3";
        ctx.fillText(f.text, f.x, f.y - k * 46);
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── 진행 ──
  const stopTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const finish = () => {
    stopTimer();
    phaseRef.current = "over";
    setPhase("over");
    drag.current = null;
    const a = audio.current;
    if (a) {
      a.bgm.pause();
      a.bgm.currentTime = 0;
      a.end.currentTime = 0;
      a.end.play().catch(() => {});
    }
  };

  // 예전과 같게: 시작하자마자 한 번 줄고, 이후 100ms마다 0.11씩 → 0 밑이면 끝
  const tick = () => {
    timeRef.current -= TIME_STEP;
    setTimeLeft(timeRef.current);
    if (timeRef.current < 0) return finish();
    timerRef.current = setTimeout(tick, TICK_MS);
  };

  const start = () => {
    if (!ready) return;
    stopTimer();
    boardRef.current = createBoard();
    layerDirty.current = true;
    fx.current = { fallers: [], drops: [], floaters: [] };
    scoreRef.current = 0;
    setScore(0);
    timeRef.current = TIME_START;
    setName("");
    setSubmitState("idle");
    phaseRef.current = "play";
    setPhase("play");
    const a = audio.current;
    if (a) {
      a.end.pause();
      a.bgm.currentTime = 0;
      a.bgm.play().catch(() => {});
    }
    // 세로로 돌린 판은 길어서, 머리말은 위로 넘기고 점수판부터 보이게
    (rotRef.current ? hudRef.current : topRef.current)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    tick();
  };

  const quit = () => {
    stopTimer();
    drag.current = null;
    phaseRef.current = "menu";
    setPhase("menu");
    const a = audio.current;
    if (a)
      [a.bgm, a.end].forEach((el) => {
        el.pause();
        el.currentTime = 0;
      });
  };

  // ── 입력 ──
  const toLogical = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const [w, h] = rotRef.current ? [H, W] : [W, H];
    return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (phaseRef.current !== "play") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toLogical(e);
    drag.current = { id: e.pointerId, ax: p.x, ay: p.y, bx: p.x, by: p.y, moved: false };
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const p = toLogical(e);
    d.bx = p.x;
    d.by = p.y;
    d.moved = true;
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    // 움직이지 않고 뗀 클릭은 아무 일도 없음 (예전에도 결과가 바뀌지 않음)
    if (!d.moved || phaseRef.current !== "play") return;
    const g = rangeOf(...toBoard(d.ax, d.ay), ...toBoard(d.bx, d.by));
    const cells = cellsIn(boardRef.current, g);
    const sum = cells.reduce((s, c) => s + c.v, 0);
    if (!isClear(sum)) return;
    const F = fx.current;
    let cx = 0;
    let cy = 0;
    for (const { c, r, v } of cells) {
      boardRef.current[c][r] = 0;
      const [x0, y0] = cellXY(c, r);
      const x = x0 + CELL / 2;
      const y = y0 + CELL / 2;
      cx += x;
      cy += y;
      F.fallers.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 260,
        vy: -(420 + Math.random() * 320),
        rot: 0,
        vr: (Math.random() - 0.5) * 9,
        v,
        age: 0,
      });
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 120 + Math.random() * 220;
        F.drops.push({
          x,
          y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 80,
          age: 0,
          life: 0.35 + Math.random() * 0.3,
          r: 1.5 + Math.random() * 2.5,
        });
      }
    }
    F.floaters.push({
      x: cx / cells.length,
      y: cy / cells.length,
      text: `+${cells.length}`,
      age: 0,
    });
    layerDirty.current = true;
    scoreRef.current += cells.length;
    setScore(scoreRef.current);
    const a = audio.current;
    if (a) {
      a.bbyong.currentTime = 0;
      a.bbyong.play().catch(() => {});
    }
  };
  const onCancel = () => {
    drag.current = null;
  };

  // ── 랭킹 ──
  const tenth = ranks && ranks.length >= 10 ? ranks[9].score : 0;
  const qualifies = phase === "over" && ranks !== null && score > tenth;
  const submit = async () => {
    const n = name.trim();
    if (n.length < 1 || n.length > 9 || submitState === "sending") return;
    setSubmitState("sending");
    try {
      await addMelonScore(n, score);
      setSubmitState("done");
      loadRanks();
    } catch {
      setSubmitState("error");
    }
  };

  const secLeft = Math.max(0, (timeLeft / TIME_STEP) * (TICK_MS / 1000));
  const ratio = Math.max(0, Math.min(1, timeLeft / TIME_START));
  const low = phase === "play" && secLeft <= 10;

  // 귀여운 파스텔 톤: 크림 바탕 + 민트 판 + 통통한 버튼(아래 그림자)
  const jua = "font-['Jua',sans-serif]";
  const chunky =
    "cursor-pointer rounded-full px-5 py-1.5 text-base sm:px-7 sm:py-2.5 sm:text-xl transition-transform active:translate-y-[3px] disabled:cursor-default disabled:opacity-50";
  const greenBtn = `${chunky} ${jua} bg-[#7ED957] text-white shadow-[0_4px_0_#4FA834] hover:brightness-105 active:shadow-[0_1px_0_#4FA834]`;
  const plainBtn = `${chunky} ${jua} bg-white text-[#6B8F4E] shadow-[0_4px_0_#CFE3BF] active:shadow-[0_1px_0_#CFE3BF]`;
  const card = "rounded-[22px] border-[3px] border-[#D6EEC4] bg-[#FFFDF4]";

  return (
    <div className="mx-auto max-w-[920px] px-4 pt-6 pb-24">
      {/* 고정 헤더+메뉴(약 100px) 아래로 맞춰 스크롤, 판이 한 화면에 다 들어오게 폭 제한 */}
      <div
        ref={topRef}
        className="mx-auto scroll-mt-[108px]"
        style={{ maxWidth: boardMax(rot, false) }}
      >
        <GameHeader
          icon="🍈"
          title="멜론 게임"
          en="Melon"
          accent="#7ED957"
          desc="합이 10·20이 되게 묶어 터뜨리는 2분 타임어택"
          guide={MELON_GUIDE}
          rank={{
            top: ranks?.slice(0, 3).map((r) => ({ name: r.name, value: `${r.score}점` })),
            open: rankOpen,
            onOpenChange: setRankOpen,
            render: () =>
              ranks === null ? (
                <p className="text-sm text-white/35">불러오는 중…</p>
              ) : ranks.length === 0 ? (
                <p className="text-sm text-white/35">아직 기록이 없어요</p>
              ) : (
                <ol className={`flex flex-col gap-1 ${jua}`}>
                  {ranks.map((r, i) =>
                    i < 3 ? null : (
                      <li
                        key={i}
                        className="flex items-center gap-3 rounded-xl px-2 py-1 text-base"
                      >
                        <span className="w-7 text-center">
                          {i < 3 ? (
                            ["🥇", "🥈", "🥉"][i]
                          ) : (
                            <span className="text-white/35">{i + 1}</span>
                          )}
                        </span>
                        <span className="flex-1 truncate text-white/85">{r.name}</span>
                        <span className="w-14 text-right text-[#B6F36A] tabular-nums">
                          {r.score}점
                        </span>
                        <span className="w-[3.75rem] text-right text-xs text-white/30 tabular-nums">
                          {rankDateLabel(r.createdAt)}
                        </span>
                      </li>
                    )
                  )}
                </ol>
              ),
          }}
        />
      </div>
      <div
        ref={wrapRef}
        className={
          big
            ? "fixed inset-0 z-[80] flex flex-col items-center justify-center overflow-hidden bg-[#0E1A14] p-2"
            : "mx-auto"
        }
        style={big ? undefined : { maxWidth: boardMax(rot, false) }}
      >
        <div className="w-full" style={big ? { maxWidth: boardMax(rot, true) } : undefined}>
          {/* 점수·시간·볼륨 */}
          <div
            ref={hudRef}
            className={`${card} relative mb-2 flex scroll-mt-[108px] items-center gap-2 px-3 py-2 sm:mb-3 sm:gap-3 sm:px-4 sm:py-2.5 ${jua}`}
          >
            <span className="hidden text-2xl sm:inline">🍈</span>
            <div className="flex items-baseline gap-1.5">
              <span key={score} className="melon-bump text-3xl text-[#5BB53C]">
                {score}
              </span>
              <span className="text-sm text-[#A3B98F]">점</span>
            </div>
            <div className="h-4 flex-1 overflow-hidden rounded-full bg-[#EAF4E0] p-[3px]">
              <div
                className={`h-full rounded-full transition-[width,background-color] duration-100 ease-linear ${
                  low ? "bg-[#FF8FA3]" : ratio < 0.35 ? "bg-[#FFD166]" : "bg-[#8EDB6A]"
                }`}
                style={{ width: `${(phase === "menu" ? 1 : ratio) * 100}%` }}
              />
            </div>
            <span
              className={`min-w-12 text-right text-lg whitespace-nowrap tabular-nums ${low ? "melon-shake text-[#FF6B8A]" : "text-[#6B8F4E]"}`}
            >
              {phase === "menu" ? Math.round(TOTAL_SEC) : Math.ceil(secLeft)}초
            </span>
            {phase === "play" && (
              <button
                type="button"
                onClick={quit}
                className="cursor-pointer rounded-full bg-[#F1F7EA] px-3 py-1 text-sm whitespace-nowrap text-[#8AA374] hover:text-[#5B7F3E]"
              >
                그만
              </button>
            )}
            <button
              type="button"
              onClick={() => setBig((b) => !b)}
              aria-label={big ? "크게 보기 끄기" : "크게 보기"}
              title={big ? "작게" : "크게 보기"}
              className={`cursor-pointer rounded-full bg-[#F1F7EA] px-2.5 py-1 text-sm whitespace-nowrap text-[#6B8F4E] ${big ? "" : "pointer-coarse:inline-block hidden"}`}
            >
              {big ? "✕" : "⛶ 크게"}
            </button>
            <button
              type="button"
              onClick={() => setVolOpen((v) => !v)}
              aria-label="볼륨"
              aria-expanded={volOpen}
              className="cursor-pointer rounded-full bg-[#F1F7EA] px-2.5 py-1 text-base"
            >
              {vol.bgm === 0 && vol.sfx === 0 ? "🔇" : "🔊"}
            </button>
            {volOpen && (
              <div className={`${card} absolute top-full right-0 z-30 mt-2 w-56 p-4 shadow-xl`}>
                {(
                  [
                    ["bgm", "🎵 배경음악"],
                    ["sfx", "💥 효과음"],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="mb-3 block last:mb-0">
                    <span className="mb-1 flex justify-between text-sm text-[#6B8F4E]">
                      {label}
                      <span>{Math.round(vol[k] * 100)}</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={vol[k]}
                      onChange={(e) => setVol((v) => ({ ...v, [k]: Number(e.target.value) }))}
                      className="w-full accent-[#7ED957]"
                    />
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* 판 */}
          <div className="relative overflow-hidden rounded-[28px] border-4 border-[#9BDB7A] shadow-[0_6px_0_#7CC45A]">
            <canvas
              ref={canvasRef}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onCancel}
              onContextMenu={(e) => e.preventDefault()}
              className="block w-full touch-none select-none"
              style={{ aspectRatio: rot ? `${H} / ${W}` : `${W} / ${H}` }}
            />

            {phase === "menu" && (
              <div
                className={`absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[#FFFDF4]/80 p-3 sm:gap-3 sm:p-4 text-center ${jua}`}
              >
                <img
                  src={tmMain.src}
                  alt=""
                  draggable={false}
                  className="melon-float h-[22%] w-auto drop-shadow-[0_8px_0_rgba(124,196,90,0.35)]"
                />
                <h1 className="melon-title text-3xl text-[#5BB53C] sm:text-7xl">멜론 게임</h1>
                <p className="hidden text-[#8AA374] sm:block">
                  숫자 합이 <b className="text-[#FF8FA3]">10</b> 또는{" "}
                  <b className="text-[#FF8FA3]">20</b>이 되게 드래그!
                </p>
                <button
                  type="button"
                  onClick={start}
                  disabled={!ready}
                  className={`${greenBtn} mt-1 sm:px-10`}
                >
                  {ready ? "시작하기" : "불러오는 중…"}
                </button>
              </div>
            )}

            {phase === "over" && (
              <div
                className={`absolute inset-0 flex flex-col items-center justify-center gap-1 overflow-y-auto bg-[#FFFDF4]/85 p-3 sm:gap-2.5 sm:p-4 text-center ${jua}`}
              >
                <div className="text-base text-[#FF8FA3] sm:text-xl">끝났어요!</div>
                <div className="melon-pop text-5xl text-[#5BB53C] sm:text-8xl">
                  {score}
                  <span className="ml-1 text-2xl text-[#A3B98F]">점</span>
                </div>
                {qualifies && submitState !== "done" && (
                  <form
                    className="flex flex-col items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submit();
                    }}
                  >
                    <p className="text-sm text-[#6B8F4E] sm:text-base">
                      🎉 10위 안에 들었어요! 이름을 남겨주세요
                    </p>
                    <div className="flex gap-2">
                      <input
                        value={name}
                        maxLength={9}
                        autoFocus
                        onChange={(e) => setName(e.target.value)}
                        placeholder="1~9글자"
                        className="w-32 rounded-full border-[3px] border-[#D6EEC4] bg-white px-3 py-1 text-center text-base sm:w-36 sm:py-1.5 sm:text-lg text-[#4A7A33] placeholder:text-[#C2D6B2] focus:border-[#9BDB7A] focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={!name.trim() || submitState === "sending"}
                        className={`${greenBtn} sm:px-5 sm:py-1.5 sm:text-lg`}
                      >
                        {submitState === "sending" ? "등록 중" : "등록"}
                      </button>
                    </div>
                    {submitState === "error" && (
                      <p className="text-sm text-[#FF6B8A]">등록에 실패했어요. 다시 눌러주세요.</p>
                    )}
                  </form>
                )}
                {submitState === "done" && (
                  <p className="text-base text-[#5BB53C]">랭킹에 등록했어요!</p>
                )}
                <div className="mt-1 flex gap-2 sm:mt-2 sm:gap-2.5">
                  <button type="button" onClick={start} className={greenBtn}>
                    다시하기
                  </button>
                  <button type="button" onClick={() => setRankOpen(true)} className={plainBtn}>
                    🏆 랭킹
                  </button>
                  <button type="button" onClick={quit} className={plainBtn}>
                    처음으로
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
