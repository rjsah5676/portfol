"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
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

/** 아이템: 아이콘만, 올리면 아이콘 · 이름 · 설명 */
export function ItemBadge({ slot, item, size = 36, up = false }: { slot: "dice" | "buddy"; item: { id: string; lv: number } | null; size?: number; up?: boolean }) {
  const it = item ? ITEM[item.id] : null;
  if (!it || !item)
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-white/25 text-[10px] text-white/50" style={{ width: size, height: size }}>
        {slot === "dice" ? "주사위" : "동행"}
      </div>
    );
  return (
    <div className="group relative" tabIndex={0}>
      <div className="relative">
        <ItemIcon id={it.id} size={size} />
        {item.lv > 0 && <span className="absolute -right-1 -bottom-1 rounded bg-[#232a4d] px-1 text-[9px] leading-[13px] font-bold text-[#ffe08a]">+{item.lv}</span>}
      </div>
      <div className={`pointer-events-none absolute left-1/2 z-[90] hidden w-[220px] -translate-x-1/2 group-hover:block group-focus:block ${up ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]"}`}>
        <div className="mbx-panel flex gap-2 p-2.5 text-left">
          <ItemIcon id={it.id} size={44} />
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <XGrade g={it.grade} />
              <b className="truncate text-[13px] text-white">{it.name}</b>
              <span className="text-[11px] text-[#ffe08a]">+{item.lv}</span>
            </div>
            <p className="mt-1 text-[11px] leading-[15px] text-white/80">{it.desc(power(it.grade, item.lv))}</p>
          </div>
        </div>
      </div>
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

/** 살아 숨쉬는 도트: 풀밭 위에서 캐릭터들이 걷다 서다 */
export function LivingPixels({ sprites, className = "", style }: { sprites: string[]; className?: string; style?: CSSProperties }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), 1600);
    return () => clearInterval(id);
  }, []);
  return (
    <div className={`overflow-hidden rounded-2xl border border-white/15 ${className.includes("absolute") ? "" : "relative"} ${className}`} style={{ background: "linear-gradient(#8fd6ff 0 58%, #7cd36b 58% 100%)", imageRendering: "pixelated", ...style }}>
      <div className="mbx-cloud absolute top-[12%] left-[8%] h-[14px] w-[46px] rounded-full bg-white/90" />
      <div className="mbx-cloud absolute top-[22%] left-[60%] h-[12px] w-[38px] rounded-full bg-white/80" style={{ animationDelay: "-6s" }} />
      <div className="absolute inset-x-0 bottom-[30%] h-[4px] bg-[#5fae55]" />
      {sprites.map((s, i) => {
        // 8박자: 오른쪽으로 3걸음 · 쉼 · 왼쪽으로 3걸음 · 쉼 (사람마다 박자 다르게)
        const ph = (t + i * 3) % 8;
        const off = ph <= 3 ? Math.min(ph, 3) : 3 - Math.min(ph - 4, 3);
        const walking = ph !== 3 && ph !== 7;
        const face: 1 | -1 = ph < 4 ? 1 : -1;
        const x = 6 + ((i * 24) % 66) + off * 5;
        return (
          <div key={s + i} className="absolute bottom-[10%] transition-[left] duration-[1600ms] ease-linear" style={{ left: `${x}%`, zIndex: 2 + i }}>
            <Token sprite={s} h={i === 0 ? 70 : 54} face={face} anim={walking ? "walk" : i === 0 ? "win" : "idle"} />
          </div>
        );
      })}
    </div>
  );
}
