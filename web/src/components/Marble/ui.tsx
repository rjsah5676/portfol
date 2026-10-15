"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CHAR, ITEM, artOf, power, type Grade } from "@/lib/marble/data";
import { sfx } from "./audio";
import { ItemIcon } from "./Gacha";
import Token from "./Token";

/*
 * 판 밖 화면(메뉴 · 대기실)용 매끈한 UI 조각 — 판 안은 도트 그대로.
 * 감싸는 곳에 className="mbx" (글꼴 · 이미지 부드럽게, css/marble.css).
 */

export function XPanel({ children, className = "", style, title, right }: { children: ReactNode; className?: string; style?: CSSProperties; title?: ReactNode; right?: ReactNode }) {
  return (
    <div className={`mbx-panel flex flex-col overflow-hidden ${className}`} style={style}>
      {title && (
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
          <b className="text-[13px] tracking-wide text-[#ffe08a]">{title}</b>
          <span className="ml-auto">{right}</span>
        </div>
      )}
      {children}
    </div>
  );
}

const TONE: Record<string, string> = {
  gold: "bg-gradient-to-b from-[#ffe27a] to-[#f5a524] text-[#3a2500] shadow-[0_4px_0_#b86e00,0_8px_18px_rgba(255,170,40,0.35)] hover:brightness-105",
  pink: "bg-gradient-to-b from-[#ff9ccf] to-[#ff5f9e] text-white shadow-[0_4px_0_#c2306c,0_8px_18px_rgba(255,95,158,0.35)] hover:brightness-105",
  mint: "bg-gradient-to-b from-[#7ff0d2] to-[#2fc3a0] text-[#06382c] shadow-[0_4px_0_#16876d] hover:brightness-105",
  sky: "bg-gradient-to-b from-[#8fd0ff] to-[#4f8fff] text-white shadow-[0_4px_0_#2c5fc2] hover:brightness-105",
  glass: "border border-white/15 bg-white/10 text-white hover:bg-white/20",
  dark: "border border-white/10 bg-black/30 text-white/90 hover:bg-black/40",
};

export function XBtn({ tone = "glass", className = "", children, onClick, silent, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof TONE; silent?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      onClick={(e) => {
        if (!silent) sfx("click");
        onClick?.(e);
      }}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl font-bold transition active:translate-y-[2px] disabled:pointer-events-none disabled:opacity-45 ${TONE[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

export function XChip({ children, color = "#ffffff22", text = "#fff", className = "" }: { children: ReactNode; color?: string; text?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11px] font-bold ${className}`} style={{ background: color, color: text }}>
      {children}
    </span>
  );
}

const GRADE_BADGE: Record<Grade, string> = {
  R: "linear-gradient(135deg,#9fb3c8,#6f86a3)",
  SR: "linear-gradient(135deg,#c9a2ff,#7b4fff)",
  SSR: "linear-gradient(135deg,#ffe58a,#ff9f2e)",
  UR: "linear-gradient(135deg,#ff9ad5,#ffe27a,#8ff0d0,#8fb4ff)",
};
export function XGrade({ g, className = "" }: { g: Grade; className?: string }) {
  return (
    <span className={`inline-block rounded-md px-1.5 text-[11px] leading-[17px] font-black text-white ${className}`} style={{ background: GRADE_BADGE[g], textShadow: "0 1px 0 rgba(0,0,0,0.35)" }}>
      {g}
    </span>
  );
}

/** 등급 배경: 높을수록 화려 (SSR 금빛 햇살 · UR 무지개가 돎) */
export function GradeBackdrop({ g, color }: { g: Grade; color?: string }) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* 등급 배경 그림 (R 하늘 · SR 보라 마법진 · SSR 금빛 햇살 · UR 무지개 오로라) */}
      <img src={`/marble/art/bg-${g}.webp`} alt="" className="absolute inset-0 h-full w-full object-cover" />
      {g === "R" && color && <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 50% 40%, ${color}33, transparent 70%)` }} />}
      {(g === "SSR" || g === "UR") && <div className={`mbx-rays mbx-rays-${g}`} style={{ opacity: 0.35 }} />}
      {g !== "R" &&
        Array.from({ length: g === "UR" ? 10 : g === "SSR" ? 6 : 3 }, (_, i) => (
          <span key={i} className="mbx-spark" style={{ left: `${(i * 37 + 9) % 94}%`, top: `${(i * 29 + 6) % 80}%`, animationDelay: `${(i % 5) * 0.35}s` }} />
        ))}
    </div>
  );
}

/** 아이템: 아이콘만, 올리면 아이콘 · 이름 · 설명 (말풍선은 무대 맨 위 층에 그려서 패널에 안 잘림) */
export function ItemBadge({ slot, item, size = 36, up = false }: { slot: "dice" | "buddy"; item: { id: string; lv: number } | null; size?: number; up?: boolean }) {
  const it = item ? ITEM[item.id] : null;
  const [tip, setTip] = useState<{ x: number; y: number; root: HTMLElement; up: boolean } | null>(null);
  if (!it || !item)
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-white/25 text-[10px] text-white/50" style={{ width: size, height: size }}>
        {slot === "dice" ? "주사위" : "동행"}
      </div>
    );
  const show = (el: HTMLElement) => {
    // 무대(.mb, 1024×576 을 늘리거나 줄여 그림) 기준 좌표로
    const root = el.closest(".mb") as HTMLElement | null;
    if (!root) return;
    const rr = root.getBoundingClientRect();
    const k = rr.width / root.offsetWidth || 1;
    const r = el.getBoundingClientRect();
    const cx = (r.left + r.width / 2 - rr.left) / k;
    const top = (r.top - rr.top) / k;
    const bottom = (r.bottom - rr.top) / k;
    const goUp = up || bottom + 110 > root.offsetHeight;
    setTip({ x: Math.max(8, Math.min(root.offsetWidth - 238, cx - 115)), y: goUp ? top - 8 : bottom + 8, root, up: goUp });
  };
  return (
    <div className="relative" tabIndex={0} onMouseEnter={(e) => show(e.currentTarget)} onMouseLeave={() => setTip(null)} onFocus={(e) => show(e.currentTarget)} onBlur={() => setTip(null)}>
      <ItemIcon id={it.id} size={size} />
      {item.lv > 0 && <span className="absolute -right-1 -bottom-1 rounded bg-[#232a4d] px-1 text-[9px] leading-[13px] font-bold text-[#ffe08a]">+{item.lv}</span>}
      {tip &&
        createPortal(
          <div className="mbx pointer-events-none absolute z-[999] w-[230px]" style={{ left: tip.x, top: tip.y, transform: tip.up ? "translateY(-100%)" : undefined }}>
            <div className="flex gap-2.5 rounded-xl border border-white/15 bg-[#1b1650]/95 p-2.5 text-left shadow-[0_10px_28px_rgba(0,0,0,0.45)] backdrop-blur">
              <ItemIcon id={it.id} size={44} />
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <XGrade g={it.grade} />
                  <b className="truncate text-[13px] text-white">{it.name}</b>
                  <span className="text-[11px] text-[#ffe08a]">+{item.lv}</span>
                </div>
                <p className="mt-1 text-[11.5px] leading-[16px] text-white/85">{it.desc(power(it.grade, item.lv))}</p>
              </div>
            </div>
          </div>,
          tip.root
        )}
    </div>
  );
}

/** 큰 캐릭터 그림 (잘리지 않게 contain) + 등급 배경 */
export function CharHero({ id, className = "", children }: { id: string; className?: string; children?: ReactNode }) {
  const c = CHAR[id];
  if (!c) return null;
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <GradeBackdrop g={c.grade} color={c.color} />
      {(c.grade === "SSR" || c.grade === "UR") && <div className="mbx-aura absolute bottom-[8%] left-1/2 h-[18%] w-[70%] -translate-x-1/2" />}
      <img src={artOf(c)} alt={c.title} className="mbx-breathe absolute max-w-none" style={{ left: "4%", top: "3%", width: "92%", height: "94%", objectFit: "contain", objectPosition: "center bottom" }} />
      {children}
    </div>
  );
}

/** 살아 숨쉬는 도트: 풀밭 위에서 캐릭터들이 제각각 걷다 쉬다 (위치는 매 프레임 이어서 움직이고, 발걸음은 걷는 속도에 맞춰 천천히) */
type Walker = { x: number; dir: 1 | -1; speed: number; until: number; mode: "walk" | "rest" | "cheer" };
const WALK_FPS = 5;
export function LivingPixels({ sprites, className = "", style, bg }: { sprites: string[]; className?: string; style?: CSSProperties; /** 도트 배경 그림 (맵 고르면 바뀜) */ bg?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<(Walker & { bob: number })[]>([]);
  const ws = useRef<Walker[]>([]);
  useEffect(() => {
    const w = box.current?.clientWidth ?? 300;
    const now = performance.now();
    ws.current = sprites.map((_, i) => ({
      x: 20 + ((i * 97) % Math.max(40, w - 80)),
      dir: i % 2 ? -1 : 1,
      // 한 걸음(두 칸) 에 몸이 움직이는 거리가 맞도록: 대략 초당 14~20px
      speed: 14 + ((i * 7) % 7),
      until: now + 1500 + i * 700,
      mode: i % 3 === 2 ? "rest" : "walk",
    }));
    let raf = 0;
    let last = now;
    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const width = box.current?.clientWidth ?? 300;
      for (const k of ws.current) {
        if (k.mode === "walk") {
          k.x += k.dir * k.speed * dt;
          if (k.x < 10) (k.x = 10), (k.dir = 1);
          if (k.x > width - 50) (k.x = width - 50), (k.dir = -1);
        }
        if (t > k.until) {
          // 걷기 → 쉬기(가끔 기뻐하기) → 걷기 (방향은 가끔 바꿈)
          if (k.mode === "walk") {
            k.mode = Math.random() < 0.25 ? "cheer" : "rest";
            k.until = t + 1200 + Math.random() * 1800;
          } else {
            k.mode = "walk";
            if (Math.random() < 0.5) k.dir = (k.dir * -1) as 1 | -1;
            k.until = t + 2500 + Math.random() * 3500;
          }
        }
      }
      // 걸을 때 발걸음에 맞춰 살짝 통통 (한 걸음 = 1/WALK_FPS 초)
      const bob = -Math.abs(Math.sin((t / 1000) * Math.PI * WALK_FPS)) * 2;
      setView(ws.current.map((k) => ({ ...k, bob: k.mode === "walk" ? bob : 0 })));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // 부모가 다시 그려질 때마다 새 배열이 와도 같은 얼굴들이면 걷던 자리 그대로
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprites.join("|")]);
  return (
    <div ref={box} className={`overflow-hidden rounded-2xl border border-white/15 ${className.includes("absolute") ? "" : "relative"} ${className}`} style={{ background: "#8fd6ff", imageRendering: "pixelated", ...style }}>
      {/* 도트 배경: 고른 맵 풍경 (바뀔 때 살짝 겹쳐 바뀜) */}
      {bg && <img key={bg} src={bg} alt="" className="mbx-fade absolute inset-0 h-[78%] w-full object-cover object-bottom" style={{ imageRendering: "pixelated" }} />}
      {!bg && (
        <>
          <div className="mbx-cloud absolute top-[12%] left-[8%] h-[14px] w-[46px] rounded-full bg-white/90" />
          <div className="mbx-cloud absolute top-[22%] left-[60%] h-[12px] w-[38px] rounded-full bg-white/80" style={{ animationDelay: "-6s" }} />
        </>
      )}
      {/* 도트 풀밭 길: 위 가장자리 톱니 · 아래 흙길 */}
      <div className="absolute inset-x-0 bottom-0 h-[26%]" style={{ background: "linear-gradient(#6fcf5a 0 30%, #5bb64b 30% 55%, #d9b073 55% 100%)" }} />
      <div className="absolute inset-x-0 bottom-[26%] h-[4px]" style={{ background: "repeating-linear-gradient(90deg, #6fcf5a 0 6px, transparent 6px 10px)" }} />
      <div className="absolute inset-x-0 bottom-[11%] h-[2px]" style={{ background: "repeating-linear-gradient(90deg, #c2955a 0 8px, transparent 8px 18px)" }} />
      {sprites.map((s, i) => {
        const k = view[i];
        if (!k) return null;
        // 뒤에 있는 사람(위쪽 줄)이 먼저 그려지게 줄을 두 개로
        const row = i % 2;
        return (
          <div key={s + i} className="absolute" style={{ left: k.x, bottom: `${7 + row * 5}%`, transform: `translateY(${k.bob}px)`, zIndex: 10 - row * 5 + i }}>
            <Token sprite={s} h={52} maxW={60} face={k.dir} anim={k.mode === "walk" ? "walk" : k.mode === "cheer" ? "win" : "idle"} fps={k.mode === "walk" ? WALK_FPS : undefined} />
          </div>
        );
      })}
    </div>
  );
}
