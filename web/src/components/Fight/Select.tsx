"use client";

/**
 * 격투게임 시작 전 화면: 모드 선택(AI는 난이도까지) → 캐릭터 선택 → 맵 선택 → VS.
 * 키보드: 1P A·D 고르기 · J/Space 결정 · Esc 취소, 2P ←→ · Enter 결정 · . 취소 (마우스·터치도 됨)
 * AI 대전이면 1P가 자기 캐릭터를 고른 뒤 상대(CPU) 캐릭터도 고름. 지금 고르는 쪽은 빛나는 테두리로 표시.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CHARS, type CharDef } from "@/lib/fight/chars";
import { MAPS } from "@/lib/fight/maps";
import { AI_LEVELS } from "@/lib/fight/ai";
import { loadSheet } from "@/lib/fight/sprites";
import { sfxUi } from "@/lib/fight/sfx";
import { KeyCap, keyText } from "./KeyCap";
import PatchNotes, { LATEST } from "./PatchNotes";
import { SettingsModal } from "./Settings";
import TechGuide from "./TechGuide";
import PixelPreview from "./PixelPreview";
import { TUT_CHAR, TUT_FOE, TUT_MAP } from "@/lib/fight/tutorial";
import { AURA_MASK, artUrl, auraUrl, look } from "@/lib/fight/skins";
import { useMySkins, wornSkin } from "@/lib/fight/mySkins";
import { useNick } from "@/lib/AuthContext";
import SkinShop, { type ShopTab } from "./SkinShop";

export type Mode = "tutorial" | "ai" | "online" | "practice";
export interface Setup {
  mode: Mode;
  c1: number;
  c2: number;
  level: number;
  /** MAPS 인덱스, -1 = 랜덤 */
  map: number;
  /** 랜덤 맵을 고를 때 섞기 연출로 뽑힌 맵 (이번 판 시작에만 씀, 저장 안 함) */
  rolled?: number;
}

/** 메인 화면의 모드 칸 (← → 로 고르는 순서) */
const MODE_TILES: readonly (readonly [Mode, string, string])[] = [
  ["tutorial", "튜토리얼", "카이로 기본 배우기"],
  ["ai", "AI 대전", "CPU와 1:1"],
  ["online", "온라인 대전", "방 만들고 1:1 · 랭크전"],
  ["practice", "연습 모드", "허수아비로 콤보 연습"],
];
const MODES = MODE_TILES.map(([m]) => m);

const face = (c: CharDef) => `/fight/art/${c.id}-face.webp`;
const art = (c: CharDef) => `/fight/art/${c.id}.webp`;
/** 선택 화면 전신 그림 배율 (그림마다 인물이 차지하는 크기가 달라서 — 발 위치는 그대로) */
const ART_SCALE: Record<string, number> = { soyoung: 0.86, "soyoung-bunny": 0.96 };
/** 스킨 전신 그림이 기본보다 폭이 좁아 한쪽으로 쏠릴 때 안쪽으로 미는 양 (cqw) */
const ART_DX: Record<string, number> = { "soyoung-bunny": 3.4 };
const PX = "[image-rendering:pixelated]";
/** 캐릭터 고르기 칸: 한 줄에 몇 칸 (↑↓ 은 이만큼 건너뜀) */
const FACE_COLS = 4;
const KR = "font-['Nanum_Gothic',sans-serif]";
const MENU_BG = "/fight/bg/title.webp";

/** 기술 아이콘 (public/fight/icon/<id>-S|X.webp) — 아직 없으면 안 보임 */
function SkillIcon({ c, k, small }: { c: CharDef; k: "S" | "X" | "A"; small?: boolean }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <img
      src={`/fight/icon/${c.id}-${k}.webp`}
      alt=""
      onError={() => setOk(false)}
      className={`${small ? "h-[1.7cqw] w-[1.7cqw]" : "h-[2.6cqw] w-[2.6cqw]"} shrink-0 rounded-[0.35cqw] border border-white/30 bg-black/40 object-cover ${PX}`}
    />
  );
}

/** 오른쪽(2P) 패널에서도 좌우 반전 없이 아이콘 왼쪽 · 글자 왼쪽 정렬 (반전하면 읽기 힘듦) */
function SkillRow({ c, k }: { c: CharDef; k: "S" | "X" }) {
  const isId = k === "S";
  return (
    <div className={`${KR} mt-[0.3cqw] flex w-full items-start gap-[0.6cqw] text-left`}>
      <SkillIcon key={c.id} c={c} k={k} />
      <div className={`flex min-w-0 flex-1 flex-col gap-[0.2cqw] items-start`}>
        <span
          className={`rounded-[0.3cqw] px-[0.5cqw] text-[1.05cqw] font-bold text-black ${isId ? "bg-[#FDE047]/90" : "bg-[#22D3EE]/90"}`}
        >
          {isId ? "아이덴티티" : "필살기"} <KeyCap k={isId ? "L" : "I"} /> {isId ? c.idName : c.ultName}
        </span>
        <span className="text-[1cqw] leading-snug break-keep text-white/80 [overflow-wrap:anywhere]">{keyText(isId ? c.idDesc : c.ultDesc)}</span>
        {isId && (
          <span className={`flex w-full min-w-0 items-start gap-[0.4cqw]`}>
            {c.airLabel && <SkillIcon key={`${c.id}-A`} c={c} k="A" small />}
            <span className="min-w-0 text-[0.9cqw] leading-snug break-keep text-white/55 [overflow-wrap:anywhere]">
              <b className="text-[#FDE047]/80">{keyText(c.airLabel ?? "점프 중 L")}</b> {keyText(c.airDesc)}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

const STAT_AXES: [keyof CharDef["stats"], string][] = [
  ["atk", "공격력"],
  ["reach", "리치"],
  ["move", "기동력"],
  ["control", "제어력"],
  ["combo", "콤보"],
  ["hp", "체력"],
];

/** 육각형 능력치 (1~5) — 캐릭터 색으로 채움 */
function StatRadar({ c }: { c: CharDef }) {
  const R = 27;
  const pt = (i: number, v: number) => {
    const ang = -Math.PI / 2 + (i * Math.PI * 2) / STAT_AXES.length;
    return [50 + Math.cos(ang) * R * v, 50 + Math.sin(ang) * R * v] as const;
  };
  const poly = (f: (i: number) => number) => STAT_AXES.map((_, i) => pt(i, f(i)).join(",")).join(" ");
  return (
    // 옆 글자(콤보·체력·리치·기동력)가 그림 밖으로 잘리지 않게 좌우를 넉넉히
    <svg viewBox="-26 4 152 92" className="h-[7.4cqw] w-[12.2cqw] min-w-0 shrink overflow-visible" aria-label="능력치">
      {[1, 0.8, 0.6, 0.4, 0.2].map((k) => (
        <polygon
          key={k}
          points={poly(() => k)}
          fill={k === 1 ? "rgba(0,0,0,0.35)" : "none"}
          stroke="rgba(255,255,255,0.18)"
          strokeWidth={0.6}
        />
      ))}
      {STAT_AXES.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={50} y1={50} x2={x} y2={y} stroke="rgba(255,255,255,0.12)" strokeWidth={0.6} />;
      })}
      <polygon
        key={c.id}
        points={poly((i) => c.stats[STAT_AXES[i][0]] / 5)}
        fill={c.color}
        fillOpacity={0.45}
        stroke={c.color}
        strokeWidth={1.1}
        strokeLinejoin="round"
        style={{ transformOrigin: "50px 50px", animation: "modal-pop 250ms ease-out" }}
      />
      {STAT_AXES.map(([k, label], i) => {
        // 위·아래 글자는 꼭짓점에서 조금 떨어뜨리고, 옆 글자는 꼭짓점 바깥쪽으로 붙여서 선과 안 겹치게
        const side = i === 1 || i === 2 ? 1 : i === 4 || i === 5 ? -1 : 0;
        const [x, y] = pt(i, side ? 1.1 : 1.3);
        return (
          <text
            key={k}
            x={x + side * 2}
            y={y}
            textAnchor={side > 0 ? "start" : side < 0 ? "end" : "middle"}
            dominantBaseline="middle"
            fontSize={8.5}
            fontWeight={800}
            fill="rgba(255,255,255,0.75)"
            style={{ fontFamily: "'Nanum Gothic', sans-serif" }}
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}

function CharInfo({ c, right }: { c: CharDef; right?: boolean }) {
  return (
    <div className={`flex w-full min-w-0 flex-col gap-[0.5cqw] ${right ? "items-end text-right" : ""}`}>
      <div className={`flex w-full items-center justify-between gap-[0.6cqw] ${right ? "flex-row-reverse" : ""}`}>
        <div className={`flex min-w-0 flex-col gap-[0.5cqw] ${right ? "items-end" : ""}`}>
      <div className="font-mono text-[1.1cqw] tracking-[0.25em] text-white/45">{c.tagline}</div>
      <div className={`${KR} flex items-center gap-[0.6cqw] text-[1.15cqw] whitespace-nowrap text-white/60 ${right ? "flex-row-reverse" : ""}`}>
        <span>{c.title}</span>
        <span className="text-[#FDE047]" title="조작 난이도">
          {"★".repeat(c.difficulty)}
          <span className="text-white/20">{"★".repeat(3 - c.difficulty)}</span>
        </span>
      </div>
      <div
        className={`${KR} text-[2.8cqw] leading-none font-extrabold drop-shadow-[0_0.3cqw_0_#000]`}
        style={{ color: c.color }}
      >
        {c.name}
      </div>
        </div>
        <StatRadar c={c} />
      </div>
      <div
        key={c.id}
        className={`${KR} relative my-[0.2cqw] rounded-[0.8cqw] border border-white/25 bg-black/55 pl-[0.9cqw] pr-[1.2cqw] py-[0.4cqw] text-[1.1cqw] whitespace-nowrap text-left leading-snug text-white italic [animation:modal-fade_300ms_ease-out]`}
      >
        “{c.quote}”
      </div>
      {/* 기술: 아이콘 + 이름 배지 한 줄, 설명은 그 아래 (점프 중 L이 다르면 한 줄 더) */}
      <SkillRow c={c} k="S" />
      <SkillRow c={c} k="X" />
    </div>
  );
}

export default function Select({
  setup,
  setSetup,
  onStart,
  onOnline,
  onPreview,
  entry = "mode",
  onBack,
  settings,
}: {
  setup: Setup;
  setSetup: (f: (s: Setup) => Setup) => void;
  onStart: () => void;
  /** 온라인 대전 → 로비 */
  onOnline?: () => void;
  /** 맵 선택에서 커서가 가리키는 맵 (배경음악 미리 듣기, -1·null = 끔) */
  onPreview: (map: number | null) => void;
  /** 처음 보여 줄 화면 (판이 끝나고 "캐릭터 선택"을 누르면 char) */
  entry?: "mode" | "char";
  /** 맨 처음 화면에서 뒤로(Esc) — 더 갈 곳이 없으니 전체화면 끄기 등 */
  onBack?: () => void;
  /** 메인 화면 ⚙ 설정 창 내용 */
  settings?: ReactNode;
}) {
  const [opts, setOpts] = useState(false);
  const [stage, setStage] = useState<"mode" | "char" | "map" | "vs">(entry);
  const [notes, setNotes] = useState(false);
  const [guide, setGuide] = useState(false);
  /** 상점 · 보관함 창 */
  const [shop, setShop] = useState<ShopTab | null>(null);
  // 내 스킨 (착용한 스킨은 1P 쪽 그림 · 도트에 보임)
  useMySkins(useNick());
  const [lock, setLock] = useState<[boolean, boolean]>([false, false]);
  const [mapCur, setMapCur] = useState(setup.map);
  /** 캐릭터 칸 커서가 '랜덤'에 있나 (쪽마다) */
  const [rnd, setRnd] = useState<[boolean, boolean]>([false, false]);
  /** 랜덤 섞는 중 (캐릭터: 쪽 번호, 맵: "map") — 그동안 입력 막음 */
  const [shuf, setShuf] = useState<0 | 1 | "map" | null>(null);
  /** 맵 섞는 동안 보여 줄 맵 (배경음악은 안 바꿈) */
  const [mapFlash, setMapFlash] = useState<number | null>(null);
  const stRef = useRef({ stage, lock, setup, mapCur, rnd, shuf });
  useEffect(() => {
    stRef.current = { stage, lock, setup, mapCur, rnd, shuf };
  });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  /** 슬롯머신처럼 점점 느려지며 칸을 넘기다 마지막에 멈춤 */
  const spin = (count: number, show: (k: number, last: boolean) => void, done: () => void) => {
    let t = 0;
    for (let k = 0; k < count; k++) {
      // 처음엔 빠르게, 끝으로 갈수록 느려짐 (전체 약 1.8초)
      const q = k / Math.max(1, count - 1);
      t += Math.round(50 + 230 * q * q * q);
      const kk = k;
      timers.current.push(
        setTimeout(() => {
          sfxUi("shuffle");
          show(kk, kk === count - 1);
        }, t)
      );
    }
    // 멈춘 뒤 뽑힌 걸 잠깐 보여 주고 결정
    timers.current.push(setTimeout(done, t + 950));
  };

  // 맵 선택 중엔 커서가 있는 맵의 음악, 그 밖의 화면에선 끔
  useEffect(() => {
    onPreview(stage === "map" || stage === "vs" ? mapCur : null);
  }, [stage, mapCur, onPreview]);

  // VS 화면 잠깐 보여 주고 시작 (그동안 캐릭터 시트·맵 그림을 미리 불러 둠)
  useEffect(() => {
    if (stage !== "vs") return;
    const { setup: st } = stRef.current;
    loadSheet(CHARS[st.c1].id).catch(() => {});
    loadSheet(CHARS[st.c2].id).catch(() => {});
    const mi = st.map >= 0 ? st.map : st.rolled;
    if (mi !== undefined && MAPS[mi]?.bg) new Image().src = MAPS[mi].bg!;
    const t = setTimeout(onStart, 1500);
    return () => clearTimeout(t);
  }, [stage, onStart]);

  // 연습 모드: 1P만 고르면 허수아비는 건모로 (lockSide)
  const prac = setup.mode === "practice";
  const ai = setup.mode === "ai" || prac;
  const foe = prac ? "허수아비" : "CPU";
  // 연습 모드 허수아비는 늘 건모 — 고르는 동안에도 건모로 보여 줌 (예전엔 지난번 상대가 보였다가 판에선 건모가 나옴)
  const pracFoe = CHARS.findIndex((c) => c.id === "gunmo");
  const c2i = prac && pracFoe >= 0 ? pracFoe : setup.c2;
  const n = CHARS.length;
  /** 지금 커서를 움직이는 쪽 (AI 대전: 1P가 끝나면 CPU 쪽) */
  const pickSide = (l: [boolean, boolean]) => (ai ? (l[0] ? 1 : 0) : -1);

  /** 칸 순서: 랜덤(-1), 0..n-1 */
  // 아래 얼굴 줄: 넘칠 때 좌우로 넘김 — 화살표 보일지, 고르는 칸이 보이게
  const stripRef = useRef<HTMLDivElement>(null);
  const [stripAt, setStripAt] = useState<[boolean, boolean]>([false, false]);
  const onStripScroll = () => {
    const el = stripRef.current;
    if (!el) return;
    const at: [boolean, boolean] = [el.scrollLeft > 2, el.scrollLeft + el.clientWidth < el.scrollWidth - 2];
    setStripAt((p) => (p[0] === at[0] && p[1] === at[1] ? p : at));
  };
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    onStripScroll();
    const sd = lock[0] ? 1 : 0;
    const cur = rnd[sd] ? -1 : sd === 0 ? setup.c1 : setup.c2;
    const b = cur < 0 ? (el.firstElementChild as HTMLElement | null) : el.querySelector<HTMLElement>(`[data-ci="${cur}"]`);
    if (!b) return;
    const l = b.offsetLeft - el.offsetLeft,
      r = l + b.offsetWidth;
    if (l < el.scrollLeft) el.scrollTo({ left: l, behavior: "smooth" });
    else if (r > el.scrollLeft + el.clientWidth) el.scrollTo({ left: r - el.clientWidth, behavior: "smooth" });
  });

  const setCursor = (side: 0 | 1, pos: number) => {
    sfxUi("move");
    setRnd((r) => (side === 0 ? [pos < 0, r[1]] : [r[0], pos < 0]));
    if (pos >= 0) setSetup((s) => (side === 0 ? { ...s, c1: pos } : { ...s, c2: pos }));
  };
  const move = (side: 0 | 1, d: number) => {
    const { rnd, setup } = stRef.current;
    const cur = rnd[side] ? -1 : side === 0 ? setup.c1 : setup.c2;
    setCursor(side, ((cur + 1 + d + n + 1) % (n + 1)) - 1);
  };
  const lockSide = (side: 0 | 1) => {
    sfxUi("ok");
    const l: [boolean, boolean] = [...stRef.current.lock];
    l[side] = true;
    // 연습 모드: 허수아비는 고르지 않고 건모로
    if (prac && side === 0 && !l[1]) {
      l[1] = true;
      setRnd((r) => [r[0], false]);
      setSetup((s) => ({ ...s, c2: pracFoe >= 0 ? pracFoe : s.c2 }));
    }
    setLock(l);
    if (l[0] && l[1]) setStage("map");
  };
  const confirm = (side: 0 | 1) => {
    const { rnd, shuf } = stRef.current;
    if (shuf !== null) return;
    if (!rnd[side]) return lockSide(side);
    // 랜덤: 얼굴 칸을 돌다가 하나에 멈춤
    const pick = Math.floor(Math.random() * n);
    const start = Math.floor(Math.random() * n);
    const count = 14 + ((pick - start - 14 + n * 4) % n) + 1;
    setShuf(side);
    setRnd((r) => (side === 0 ? [false, r[1]] : [r[0], false]));
    spin(
      count,
      (k) => setSetup((s) => (side === 0 ? { ...s, c1: (start + k) % n } : { ...s, c2: (start + k) % n })),
      () => {
        setShuf(null);
        lockSide(side);
      }
    );
  };
  /** 맵 결정 (랜덤이면 섞기 연출 뒤 VS) */
  const confirmMap = (cur: number) => {
    if (stRef.current.shuf !== null) return;
    if (cur >= 0) {
      sfxUi("ok");
      setSetup((s) => ({ ...s, map: cur, rolled: undefined }));
      setStage("vs");
      return;
    }
    const m = MAPS.length;
    const pick = Math.floor(Math.random() * m);
    const count = 10 + ((pick - 10 + m * 6) % m) + 1;
    setShuf("map");
    spin(
      count,
      (k) => setMapFlash(k % m),
      () => {
        setShuf(null);
        setMapFlash(null);
        setSetup((s) => ({ ...s, map: -1, rolled: pick }));
        setMapCur(pick);
        setStage("vs");
      }
    );
  };
  const cancel = (side: 0 | 1) => {
    sfxUi("back");
    const l: [boolean, boolean] = [...stRef.current.lock];
    if (l[side]) l[side] = false;
    else if (side === 1 && ai) l[0] = false;
    else if (side === 0 && !l[1]) {
      // 아무것도 안 고른 상태에서 취소 → 모드 선택으로
      setStage("mode");
      return;
    }
    setLock(l);
  };
  const backToChars = () => {
    // 맵 선택에서 뒤로: 1P부터 다시 고름
    setLock([false, false]);
    setStage("char");
  };
  const toChars = () => {
    sfxUi("ok");
    if (stRef.current.setup.mode === "online") {
      onOnline?.();
      return;
    }
    if (stRef.current.setup.mode === "tutorial") {
      // 튜토리얼: 캐릭터 · 맵 고르기 없이 카이 vs 연습 상대, 노을 옥상
      setSetup((s) => ({ ...s, c1: TUT_CHAR, c2: TUT_FOE, map: TUT_MAP, rolled: undefined }));
      setStage("vs");
      return;
    }
    setLock([false, false]);
    setStage("char");
  };
  const mapOptions = [-1, ...MAPS.map((_, i) => i)];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const { stage, lock, mapCur, shuf } = stRef.current;
      if (shuf !== null) {
        e.preventDefault();
        return;
      }
      const k = e.code;
      const p1 = { l: k === "KeyA", r: k === "KeyD", u: k === "KeyW", d: k === "KeyS", ok: k === "KeyJ" || k === "Space", no: k === "Escape" };
      const p2 = {
        l: k === "ArrowLeft",
        r: k === "ArrowRight",
        u: k === "ArrowUp",
        d: k === "ArrowDown",
        ok: k === "Enter" || k === "NumpadEnter" || k === "Comma",
        no: k === "Period" || k === "Backspace",
      };
      const any = p1.l || p1.r || p1.ok || p1.no || p2.l || p2.r || p2.ok || p2.no;
      // 캐릭터 칸은 두 줄 — 위아래(W·S, ↑↓)로 한 줄씩
      const vert = p1.u || p1.d || p2.u || p2.d;
      if (!any && !(vert && stage === "char")) return;
      e.preventDefault();
      if (stage === "mode") {
        // ← → (A · D) 로 모드 고르기, Enter(J · Space) 로 시작
        const d = p1.l || p2.l ? -1 : p1.r || p2.r ? 1 : 0;
        if (d) {
          sfxUi("move");
          setSetup((s) => ({ ...s, mode: MODES[(MODES.indexOf(s.mode) + d + MODES.length) % MODES.length] }));
        } else if (p1.ok || p2.ok) toChars();
        else if (p1.no) onBack?.();
        return;
      }
      if (stage === "char") {
        if (ai) {
          // AI 대전: 어느 키든 지금 고르는 쪽을 움직임
          const side = (lock[0] ? 1 : 0) as 0 | 1;
          if (p1.l || p2.l) move(side, -1);
          if (p1.r || p2.r) move(side, 1);
          if (p1.u || p2.u) move(side, -FACE_COLS);
          if (p1.d || p2.d) move(side, FACE_COLS);
          if (p1.ok || p2.ok) confirm(side);
          if (p1.no || p2.no) cancel(side);
        } else {
          if (!lock[0] && p1.l) move(0, -1);
          if (!lock[0] && p1.r) move(0, 1);
          if (!lock[0] && p1.u) move(0, -FACE_COLS);
          if (!lock[0] && p1.d) move(0, FACE_COLS);
          if (p1.ok) confirm(0);
          if (p1.no) cancel(0);
          if (!lock[1] && p2.l) move(1, -1);
          if (!lock[1] && p2.r) move(1, 1);
          if (!lock[1] && p2.u) move(1, -FACE_COLS);
          if (!lock[1] && p2.d) move(1, FACE_COLS);
          if (p2.ok) confirm(1);
          if (p2.no) cancel(1);
        }
      } else if (stage === "map") {
        const i = mapOptions.indexOf(mapCur);
        if (p1.l || p2.l || p1.r || p2.r) sfxUi("move");
        if (p1.l || p2.l) setMapCur(mapOptions[(i - 1 + mapOptions.length) % mapOptions.length]);
        if (p1.r || p2.r) setMapCur(mapOptions[(i + 1) % mapOptions.length]);
        if (p1.ok || p2.ok) confirmMap(mapCur);
        if (p1.no || p2.no) {
          sfxUi("back");
          backToChars();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 최신 값은 stRef로
  }, [ai]);

  /** 그림 이름: 1P 는 착용 스킨, 상대는 기본 */
  const lookOf = (sd: number) => (sd === 0 ? look(setup.c1, wornSkin(setup.c1)) : CHARS[c2i].id);
  const c1 = CHARS[setup.c1],
    c2 = CHARS[c2i];
  const side = pickSide(lock);
  const mapShownIdx = mapFlash ?? mapCur;
  const mapShown = mapShownIdx >= 0 ? MAPS[mapShownIdx] : null;
  const thumb = (i: number) => (i >= 0 ? MAPS[i].bg?.replace(".webp", "-thumb.webp") : undefined);

  return (
    <div
      className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-[#0B0D14] select-none [container-type:inline-size]"
    >
      {/* 메인 배경 (맵 선택에선 고른 맵 그림) */}
      <img
        src={stage === "map" && mapShown ? mapShown.bg : MENU_BG}
        alt=""
        className={`absolute inset-0 h-full w-full object-cover ${PX} ${stage === "mode" ? "opacity-90" : "opacity-45"} ${stage === "map" ? "blur-[3px]" : ""}`}
      />
      <div
        className={`absolute inset-0 ${stage === "mode" ? "bg-[linear-gradient(to_top,rgba(10,4,20,0.92)_0%,rgba(10,4,20,0.55)_30%,transparent_55%),linear-gradient(to_bottom,rgba(20,6,40,0.55),transparent_28%)]" : "bg-[radial-gradient(ellipse_at_center,transparent_25%,#0B0D14_90%)]"}`}
      />

      {stage === "mode" && (
        <>
          {/* 타이틀: 노을 하늘 위쪽 (해 위) — 노을색 그라데이션 글자 + 짙은 보라 테두리 + 빛 */}
          <div className="pointer-events-none absolute inset-x-0 top-[7%] flex flex-col items-center [animation:modal-fade_500ms_ease-out]">
            <div className="relative">
              <div
                aria-hidden
                className="absolute inset-0 font-mono text-[7.4cqw] leading-none font-black tracking-[0.1em] text-[#FF7A3D] italic opacity-70 blur-[1.6cqw]"
              >
                PIXEL FIGHT
              </div>
              <div className="relative bg-gradient-to-b from-[#FFF6C8] via-[#FFB347] to-[#FF4F8B] bg-clip-text font-mono text-[7.4cqw] leading-none font-black tracking-[0.1em] text-transparent italic [-webkit-text-stroke:0.22cqw_#2A0E3A] [filter:drop-shadow(0_0.45cqw_0_#1A0726)_drop-shadow(0_0_1.2cqw_rgba(255,120,80,0.45))]">
                PIXEL FIGHT
              </div>
            </div>
            <div className="mt-[1.2cqw] flex items-center gap-[1.2cqw]">
              <span className="h-[0.15cqw] w-[8cqw] bg-gradient-to-r from-transparent to-[#FFD27A]" />
              <span className="font-mono text-[1.25cqw] font-bold tracking-[0.5em] text-[#FFE3B0] [text-shadow:0_0.15cqw_0_#1A0726]">
                1 VS 1 · PLATFORM FIGHTER
              </span>
              <span className="h-[0.15cqw] w-[8cqw] bg-gradient-to-l from-transparent to-[#FFD27A]" />
            </div>
          </div>

          {/* 오른쪽 위: 패치노트 */}
          <button
            type="button"
            onClick={() => {
              sfxUi("ok");
              setNotes(true);
            }}
            className={`${KR} absolute top-[2.2cqw] right-[2cqw] flex cursor-pointer items-center gap-[0.6cqw] rounded-full border-[0.15cqw] border-[#F2C35B]/70 bg-[#140A24]/75 px-[1.3cqw] py-[0.45cqw] text-[1.2cqw] font-bold text-[#FFE9A8] backdrop-blur-[3px] transition-colors hover:bg-[#2B1840]/90`}
          >
            📜 패치노트
            <span className="font-mono text-[1cqw] font-normal text-white/55">
              {LATEST.ver} · {LATEST.date.slice(5)}
            </span>
          </button>
          {notes && <PatchNotes onClose={() => setNotes(false)} />}

          {/* 왼쪽 위: 설정 · 기술 가이드 */}
          <div className="absolute top-[2.2cqw] left-[2cqw] flex gap-[0.8cqw]">
            {settings && (
              <button
                type="button"
                onClick={() => {
                  sfxUi("ok");
                  setOpts(true);
                }}
                className={`${KR} flex cursor-pointer items-center gap-[0.6cqw] rounded-full border-[0.15cqw] border-[#F2C35B]/70 bg-[#140A24]/75 px-[1.3cqw] py-[0.45cqw] text-[1.2cqw] font-bold text-[#FFE9A8] backdrop-blur-[3px] transition-colors hover:bg-[#2B1840]/90`}
              >
                ⚙ 설정
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                sfxUi("ok");
                setGuide(true);
              }}
              className={`${KR} flex cursor-pointer items-center gap-[0.6cqw] rounded-full border-[0.15cqw] border-[#F2C35B]/70 bg-[#140A24]/75 px-[1.3cqw] py-[0.45cqw] text-[1.2cqw] font-bold text-[#FFE9A8] backdrop-blur-[3px] transition-colors hover:bg-[#2B1840]/90`}
            >
              📖 기술 가이드
            </button>
            {(["shop", "inv"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  sfxUi("ok");
                  setShop(t);
                }}
                className={`${KR} flex cursor-pointer items-center gap-[0.6cqw] rounded-full border-[0.15cqw] border-[#F2C35B]/70 bg-[#140A24]/75 px-[1.3cqw] py-[0.45cqw] text-[1.2cqw] font-bold text-[#FFE9A8] backdrop-blur-[3px] transition-colors hover:bg-[#2B1840]/90`}
              >
                {t === "shop" ? "🛒 상점" : "🎒 보관함"}
                {t === "shop" && <span className="rounded-full bg-[#E8344E] px-[0.5cqw] font-mono text-[0.8cqw] text-white">NEW</span>}
              </button>
            ))}
          </div>
          {guide && <TechGuide onClose={() => setGuide(false)} />}
          {shop && <SkinShop initial={shop} onClose={() => setShop(null)} />}
          {opts && settings && <SettingsModal onClose={() => setOpts(false)}>{settings}</SettingsModal>}

          {/* 아래 돌바닥 위: 모드 · 난이도 · 시작 */}
          <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-[1.5cqw] pb-[2.2cqw]">
            <div className="flex gap-[1.4cqw]">
              {MODE_TILES.map(([m, label, sub]) => {
                const on = setup.mode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      sfxUi("move");
                      setSetup((s) => ({ ...s, mode: m }));
                    }}
                    className={`${KR} relative flex w-[17cqw] cursor-pointer flex-col items-center gap-[0.3cqw] rounded-[0.8cqw] border-[0.2cqw] px-[1cqw] py-[1cqw] backdrop-blur-[3px] transition-all ${
                      on
                        ? "-translate-y-[0.3cqw] border-[#FFC86B] bg-[linear-gradient(to_bottom,rgba(255,170,90,0.28),rgba(120,40,110,0.35))] shadow-[0_0_2.2cqw_rgba(255,160,80,0.45),inset_0_0_1cqw_rgba(255,220,150,0.25)]"
                        : "border-white/15 bg-[#140A24]/65 hover:border-[#FFC86B]/60 hover:bg-[#1E0F33]/75"
                    }`}
                  >
                    {on && (
                      <span className="absolute -top-[0.9cqw] left-1/2 -translate-x-1/2 font-mono text-[1cqw] text-[#FFC86B]">▼</span>
                    )}
                    <span className={`text-[2.1cqw] font-extrabold ${on ? "text-white" : "text-white/80"} [text-shadow:0_0.2cqw_0_#1A0726]`}>
                      {label}
                    </span>
                    <span className={`text-[1.1cqw] ${on ? "text-[#FFE3B0]" : "text-white/45"}`}>{sub}</span>
                  </button>
                );
              })}
            </div>
            <div className={`flex min-h-[3cqw] items-center gap-[0.5cqw] ${ai && !prac ? "" : "invisible"}`}>
              <span className={`${KR} mr-[0.4cqw] text-[1.2cqw] text-[#FFE3B0]/70`}>난이도</span>
              {AI_LEVELS.map((l, i) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    sfxUi("move");
                    setSetup((s) => ({ ...s, level: i }));
                  }}
                  className={`${KR} cursor-pointer rounded-full border px-[1.1cqw] py-[0.35cqw] text-[1.2cqw] transition-colors ${
                    l.look
                      ? setup.level === i
                        ? "border-[#FF4D6D] bg-[#FF4D6D] font-bold text-white shadow-[0_0_1.2cqw_rgba(255,77,109,0.6)]"
                        : "border-[#FF4D6D]/40 bg-[#2A0A1A]/70 font-bold text-[#FF8FA3] hover:border-[#FF4D6D] hover:text-white"
                      : setup.level === i
                        ? "border-[#FFC86B] bg-[#FFC86B] font-bold text-[#2A0E3A]"
                        : "border-white/10 bg-[#140A24]/65 text-white/65 hover:border-[#FFC86B]/50 hover:text-white"
                  }`}
                >
                  {l.name}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={toChars}
              className={`${KR} cursor-pointer rounded-full border-[0.2cqw] border-[#FFE3B0]/70 bg-gradient-to-b from-[#FF8A4C] to-[#E0306A] px-[4.4cqw] py-[0.8cqw] text-[1.9cqw] font-extrabold tracking-[0.15em] text-white shadow-[0_0.4cqw_0_#5A1240,0_0_2cqw_rgba(255,110,90,0.45)] [text-shadow:0_0.15cqw_0_#5A1240] transition-transform hover:scale-105 active:translate-y-[0.2cqw]`}
            >
              시작하기
            </button>
            <div className={`${KR} -mt-[0.5cqw] text-[1.05cqw] text-[#FFE3B0]/55 [@media(pointer:coarse)]:hidden`}>
              ← → 모드 고르기 · Enter 시작
            </div>
          </div>
        </>
      )}

      {stage === "char" && (
        <>
          <div className="absolute inset-x-0 top-[2.5cqw] flex flex-col items-center gap-[0.8cqw]">
            <div className="font-mono text-[2.6cqw] font-black tracking-[0.35em] text-white italic drop-shadow-[0_0.3cqw_0_#000]">
              CHARACTER SELECT
            </div>
            <div className={`${KR} text-[1.2cqw] text-white/55`}>
              {prac ? "연습 모드 · 허수아비는 건모" : ai ? `AI 대전 · CPU ${AI_LEVELS[setup.level].name}` : "튜토리얼"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setStage("mode")}
            className={`${KR} absolute top-[2.4cqw] left-[2cqw] cursor-pointer rounded-full bg-black/50 px-[1.4cqw] py-[0.5cqw] text-[1.2cqw] text-white/70 hover:bg-white/20`}
          >
            ◀ 모드 선택
          </button>

          {/* 양쪽 전신 그림 */}
          {([0, 1] as const).map((sd) => {
            const c = sd === 0 ? c1 : c2;
            const col = sd === 0 ? "#3B82F6" : "#F43F5E";
            // 지금 고르는 쪽: AI 대전은 차례인 한쪽, 2인 대전은 아직 안 고른 쪽 모두
            const active = !lock[sd] && (ai ? side === sd : true);
            return (
              <div key={sd} className="contents">
                {/* 착용 스킨 오라 (전신 그림 뒤) */}
                {!rnd[sd] && auraUrl(lookOf(sd)) && (
                  <img
                    key={`aura-${lookOf(sd)}`}
                    src={auraUrl(lookOf(sd))!}
                    alt=""
                    style={AURA_MASK}
                    className={`pointer-events-none absolute top-[8%] ${sd === 0 ? "left-[-1cqw]" : "right-[-1cqw]"} z-0 h-[84%] w-[30cqw] object-contain object-bottom mix-blend-screen transition-opacity duration-300 [animation:sel-aura_3.2s_ease-in-out_infinite_alternate] ${
                      active || lock[sd] ? "" : "opacity-40"
                    }`}
                  />
                )}
                <style>{`@keyframes sel-aura{from{filter:brightness(.85)}to{filter:brightness(1.15)}}`}</style>
                {/* 전신 그림: 폭이 넓은 그림이어도 설명 글씨 칸을 밀지 않게 따로 띄움 (뒤에 깔림) */}
                {rnd[sd] ? (
                  <div
                    className={`absolute top-[16%] ${sd === 0 ? "left-[6cqw]" : "right-[6cqw]"} z-0 flex h-[70%] w-[16cqw] items-center justify-center font-mono text-[14cqw] font-black text-white/70 [animation:modal-fade_250ms_ease-out]`}
                    style={{ textShadow: `0 0 2cqw ${col}` }}
                  >
                    ?
                  </div>
                ) : (
                <img
                  key={lookOf(sd)}
                  src={sd === 0 ? artUrl(setup.c1, wornSkin(setup.c1)) : art(c)}
                  alt={c.name}
                  className={`absolute top-[13%] ${sd === 0 ? "left-[1cqw] object-left-bottom" : "right-[1cqw] object-right-bottom"} z-0 h-[76%] w-[26cqw] object-contain ${lookOf(sd) === c.id ? PX : ""} transition-[filter,opacity] duration-300 [animation:modal-fade_250ms_ease-out] ${sd === 1 ? "scale-x-[-1]" : ""} ${
                    active || lock[sd] ? "" : "opacity-45 brightness-50"
                  }`}
                  style={{
                    ...(ART_SCALE[lookOf(sd)] ? { height: `${76 * ART_SCALE[lookOf(sd)]}%`, top: `${89 - 76 * ART_SCALE[lookOf(sd)]}%` } : {}),
                    ...(ART_DX[lookOf(sd)] ? { [sd === 0 ? "marginLeft" : "marginRight"]: `${ART_DX[lookOf(sd)]}cqw` } : {}),
                    filter: active
                      ? `drop-shadow(0 0 0.25cqw ${col}) drop-shadow(0 0 1.4cqw ${col})`
                      : lock[sd]
                        ? "drop-shadow(0 0 0.2cqw #fff)"
                        : undefined,
                  }}
                />
                )}
                <div
                  className={`gold-scroll absolute top-[8.8cqw] z-10 max-h-[32.4cqw] overflow-y-auto ${sd === 0 ? "left-[26cqw]" : "right-[26cqw] flex flex-col items-end text-right"} w-[23.4cqw] rounded-[1cqw] bg-black/45 px-[1cqw] py-[0.8cqw] backdrop-blur-[2px]`}
                >
                  <div className={`mb-[0.6cqw] flex items-center gap-[0.6cqw] ${sd === 1 ? "flex-row-reverse" : ""}`}>
                    <span
                      className="rounded-[0.3cqw] px-[0.7cqw] font-mono text-[1.3cqw] font-black text-white"
                      style={{ background: col }}
                    >
                      {sd === 0 ? "1P" : ai ? foe : "2P"}
                    </span>
                    {lock[sd] ? (
                      <span className="font-mono text-[1.4cqw] font-black text-[#FDE047] italic">READY!</span>
                    ) : active ? (
                      <span className={`${KR} animate-pulse text-[1.3cqw] font-bold`} style={{ color: col }}>
                        {ai && sd === 1 ? "▼ 상대 고르는 중" : "▼ 선택 중"}
                      </span>
                    ) : (
                      <span className={`${KR} text-[1.2cqw] text-white/35`}>대기</span>
                    )}
                  </div>
                  {rnd[sd] ? (
                    <div className={`${KR} flex flex-col gap-[0.5cqw] ${sd === 1 ? "items-end" : ""}`}>
                      <div className="font-mono text-[1.1cqw] tracking-[0.25em] text-white/45">RANDOM</div>
                      <div className="text-[3.6cqw] leading-none font-extrabold text-white">랜덤</div>
                      <div className="text-[1.2cqw] text-white/60">결정하면 섞어서 한 명을 뽑아요</div>
                    </div>
                  ) : (
                    <CharInfo c={c} right={sd === 1} />
                  )}
                </div>
                {/* 게임 속 도트 모습 (동작을 돌아가며) — 전신 그림 발치 */}
                {!rnd[sd] && (
                  <div
                    className={`absolute bottom-[1cqw] ${sd === 0 ? "left-[1cqw]" : "right-[1cqw]"} z-10 flex flex-col items-center rounded-[0.8cqw] border border-white/15 bg-black/55 px-[0.4cqw] pt-[0.3cqw] backdrop-blur-[2px]`}
                  >
                    <span className={`${KR} text-[0.9cqw] text-white/50`}>게임 속 모습</span>
                    <PixelPreview
                      key={sd === 0 ? look(setup.c1, wornSkin(setup.c1)) : c.id}
                      id={sd === 0 ? look(setup.c1, wornSkin(setup.c1)) : c.id}
                      flip={sd === 1}
                      className="h-[10cqw] w-[9cqw]"
                    />
                  </div>
                )}
              </div>
            );
          })}

          {/* 가운데 아래 얼굴 칸 */}
          <div className="absolute bottom-[1cqw] left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-[0.6cqw] rounded-[1cqw] bg-black/50 px-[1.2cqw] pb-[0.7cqw] backdrop-blur-[2px]">
            {/* 랜덤 + 캐릭터를 FACE_COLS 칸씩 여러 줄로 (←→ 한 칸 · ↑↓ 한 줄). 줄이 넘쳐 옆으로 넘길 일은 없어 ◀ ▶ 는 안 보임 */}
            <div className="relative flex items-center">
              <button
                type="button"
                aria-label="왼쪽"
                onClick={() => stripRef.current?.scrollBy({ left: -stripRef.current.clientWidth / 2, behavior: "smooth" })}
                className={`absolute -left-[1.1cqw] top-[3.9cqw] z-10 cursor-pointer font-mono text-[1.4cqw] text-white/70 hover:text-white ${stripAt[0] ? "" : "invisible"}`}
              >
                ◀
              </button>
              <div
                ref={stripRef}
                onScroll={onStripScroll}
                className="grid grid-cols-4 gap-x-[0.8cqw] gap-y-[1.7cqw] pt-[1.6cqw]"
              >
              {(() => {
                const r1 = rnd[0] && !lock[0],
                  r2 = rnd[1] && !lock[1];
                return (
                  <button
                    type="button"
                    onClick={() => {
                      const sd = (lock[0] ? 1 : 0) as 0 | 1;
                      if (lock[sd] || shuf !== null) return;
                      if (rnd[sd]) confirm(sd);
                      else setCursor(sd, -1);
                    }}
                    className="relative cursor-pointer"
                  >
                    <span
                      className={`flex h-[4.4cqw] w-[5.6cqw] items-center justify-center rounded-[0.5cqw] border-[0.3cqw] bg-black/60 font-mono text-[2.8cqw] font-black text-white/80 ${
                        r1 && r2 ? "border-[#A78BFA]" : r1 ? "border-[#3B82F6]" : r2 ? "border-[#F43F5E]" : "border-white/20"
                      } ${r1 || r2 ? "animate-pulse" : ""}`}
                    >
                      ?
                    </span>
                    <span className={`${KR} pointer-events-none absolute inset-x-[0.3cqw] bottom-[0.3cqw] rounded-b-[0.3cqw] bg-black/65 text-center text-[0.95cqw] leading-[1.4] text-white/85`}>랜덤</span>
                  </button>
                );
              })()}
              {CHARS.map((c, i) => {
                const on1 = setup.c1 === i && !rnd[0],
                  on2 = c2i === i && !rnd[1];
                const act1 = !lock[0] && (ai ? side === 0 : true);
                const act2 = !lock[1] && (ai ? side === 1 : true);
                const glow = (on1 && act1) || (on2 && act2);
                return (
                  <button
                    key={c.id}
                    data-ci={i}
                    type="button"
                    onClick={() => {
                      // 아직 안 고른 쪽부터 (AI 대전은 1P → CPU). 한 번 누르면 커서, 같은 칸을 한 번 더 누르면 결정
                      const sd = (lock[0] ? 1 : 0) as 0 | 1;
                      if (lock[sd] || shuf !== null) return;
                      const cur = rnd[sd] ? -1 : sd === 0 ? setup.c1 : setup.c2;
                      if (cur === i) confirm(sd);
                      else setCursor(sd, i);
                    }}
                    className="relative cursor-pointer"
                  >
                                        <img
                      src={face(c)}
                      alt={c.name}
                      className={`h-[4.4cqw] w-[5.6cqw] rounded-[0.5cqw] border-[0.3cqw] object-cover ${PX} ${glow ? "animate-pulse" : ""} ${
                        on1 && on2
                          ? "border-[#A78BFA]"
                          : on1
                            ? "border-[#3B82F6]"
                            : on2
                              ? "border-[#F43F5E]"
                              : "border-white/20 grayscale-[60%]"
                      }`}
                    />
                    <span className="absolute -top-[1.6cqw] left-0 flex gap-[0.3cqw] font-mono text-[1.1cqw] font-black whitespace-nowrap">
                      {on1 && <span className="rounded-[0.2cqw] bg-[#3B82F6] px-[0.4cqw] text-white">1P</span>}
                      {on2 && (
                        <span className="rounded-[0.2cqw] bg-[#F43F5E] px-[0.4cqw] text-white">{ai ? foe : "2P"}</span>
                      )}
                    </span>
                    <span className={`${KR} pointer-events-none absolute inset-x-[0.3cqw] bottom-[0.3cqw] rounded-b-[0.3cqw] bg-black/65 text-center text-[0.95cqw] leading-[1.4] text-white/85`}>{c.name}</span>
                  </button>
                );
              })}
              </div>
              <button
                type="button"
                aria-label="오른쪽"
                onClick={() => stripRef.current?.scrollBy({ left: stripRef.current.clientWidth / 2, behavior: "smooth" })}
                className={`absolute -right-[1.1cqw] top-[3.9cqw] z-10 cursor-pointer font-mono text-[1.4cqw] text-white/70 hover:text-white ${stripAt[1] ? "" : "invisible"}`}
              >
                ▶
              </button>
            </div>
          </div>
        </>
      )}

      {stage === "map" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-[1.6cqw]">
          <div className="font-mono text-[2.6cqw] font-black tracking-[0.35em] text-white italic drop-shadow-[0_0.3cqw_0_#000]">
            STAGE SELECT
          </div>
          <div className="relative w-[52cqw] overflow-hidden rounded-[0.8cqw] border-[0.3cqw] border-white/70 shadow-[0_0_3cqw_rgba(0,0,0,0.8)]">
            {mapShown ? (
               
              <img src={mapShown.bg} alt={mapShown.name} className="aspect-video w-full object-cover" />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center bg-black/60 font-mono text-[6cqw] text-white/70">
                ?
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-[1.4cqw] pt-[3cqw] pb-[1cqw]">
              <div className={`${KR} text-[2.6cqw] font-extrabold text-white`}>
                {mapShown ? mapShown.name : "랜덤"}
                {shuf === "map" && <span className="ml-[1cqw] text-[1.6cqw] text-[#FDE047]">섞는 중…</span>}
              </div>
              <div className={`${KR} text-[1.3cqw] text-white/70`}>{mapShown ? mapShown.desc : "매 판 무작위"}</div>
            </div>
          </div>
          <div className="flex gap-[1cqw]">
            {mapOptions.map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  if (shuf !== null) return;
                  if (mapCur === i) confirmMap(i);
                  else setMapCur(i);
                }}
                className={`relative h-[6.8cqw] w-[12cqw] cursor-pointer overflow-hidden rounded-[0.5cqw] border-[0.25cqw] transition-transform ${
                  mapFlash === i ? "scale-110 border-[#FDE047]" : mapCur === i && mapFlash === null ? "border-[#FDE047]" : "border-white/20"
                }`}
              >
                {thumb(i) ? (
                   
                  <img src={thumb(i)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-black/60 font-mono text-[2.4cqw] text-white/70">
                    ?
                  </span>
                )}
                <span className={`${KR} absolute inset-x-0 bottom-0 bg-black/60 text-[1.1cqw] text-white`}>
                  {i >= 0 ? MAPS[i].name : "랜덤"}
                </span>
              </button>
            ))}
          </div>
          <div className="flex gap-[1cqw]">
            <button
              type="button"
              onClick={backToChars}
              className={`${KR} cursor-pointer rounded-full bg-white/10 px-[2cqw] py-[0.6cqw] text-[1.4cqw] text-white/70 hover:bg-white/20`}
            >
              ◀ 캐릭터 다시
            </button>
            <button
              type="button"
              onClick={() => confirmMap(mapCur)}
              className={`${KR} cursor-pointer rounded-full bg-[#6C63FF] px-[2.4cqw] py-[0.6cqw] text-[1.4cqw] font-bold text-white hover:bg-[#5b52f0]`}
            >
              결정 ▶
            </button>
          </div>
        </div>
      )}

      {stage === "vs" && (
        <div className="absolute inset-0 flex items-center justify-center gap-[4cqw] bg-black/40">
          {([c1, c2] as const).map((c, i) => (
            <div key={i} className={`flex flex-col items-center gap-[1cqw] ${i === 0 ? "order-1" : "order-3"}`}>
                            <img
                src={face(c)}
                alt={c.name}
                className={`h-[18cqw] w-[22.5cqw] rounded-[0.8cqw] border-[0.4cqw] object-cover ${PX} [animation:modal-fade_300ms_ease-out]`}
                style={{ borderColor: c.color, transform: i === 1 ? "scaleX(-1)" : undefined }}
              />
              <div className={`${KR} text-[3.4cqw] font-extrabold`} style={{ color: c.color }}>
                {c.name}
              </div>
            </div>
          ))}
          <div className="order-2 font-mono text-[9cqw] font-black text-[#FDE047] italic drop-shadow-[0_0.5cqw_0_#000]">
            VS
          </div>
        </div>
      )}
    </div>
  );
}
