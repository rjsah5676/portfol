"use client";

/* 구단 화면 공용 조각 — 엠블럼 · 선수 카드 · 등급 표 (그림 없이 CSS) */
import type { CSSProperties, ReactNode } from "react";
import type { ClubDef } from "@/lib/baseball/data";
import { BUFF_NAME, GRADE_COLOR, buffOf, gradeOf, ovrOf, veloN, type Card, type Grade } from "@/lib/baseball/club";
import { font } from "./ui";

const CLIP: Record<ClubDef["shape"], string | undefined> = {
  circle: undefined,
  square: undefined,
  shield: "polygon(50% 0, 100% 13%, 100% 56%, 50% 100%, 0 56%, 0 13%)",
  diamond: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)",
  hex: "polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)",
};

/** 구단 엠블럼: 도형 + 이니셜 */
export function Emblem({ def, size = 44 }: { def: Pick<ClubDef, "shape" | "mono" | "color" | "dark">; size?: number }) {
  const clip = CLIP[def.shape];
  const radius = def.shape === "circle" ? "50%" : def.shape === "square" ? "24%" : undefined;
  const shape: CSSProperties = { clipPath: clip, borderRadius: radius };
  const pad = Math.max(2, Math.round(size * 0.07));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="absolute inset-0" style={{ ...shape, background: "#f4f1e8" }} />
      <div
        className="absolute flex items-center justify-center"
        style={{ ...shape, inset: pad, background: `linear-gradient(160deg, ${def.color} 0%, ${def.color} 45%, ${def.dark} 100%)` }}
      >
        <span
          className={`${font.title} leading-none text-white`}
          style={{ fontSize: Math.round(size * (def.shape === "diamond" ? 0.27 : 0.34)), textShadow: `0 2px 0 ${def.dark}`, letterSpacing: -0.5, marginTop: def.shape === "shield" ? -size * 0.06 : 0 }}
        >
          {def.mono}
        </span>
      </div>
    </div>
  );
}

/** 등급 딱지 */
export function GradeChip({ g, className = "" }: { g: Grade; className?: string }) {
  const ss = g === "SS";
  return (
    <span
      className={`${font.title} inline-flex items-center justify-center rounded-md px-1.5 leading-none text-[#111] ${className}`}
      style={{ background: ss ? "linear-gradient(90deg,#ff4d8d,#ffcf3a,#4fe0ff)" : GRADE_COLOR[g], minWidth: 22, height: 18, fontSize: 12 }}
    >
      {g}
    </span>
  );
}

const HAND = (r: "R" | "L") => (r === "R" ? "우" : "좌");

/** 카드 실루엣 (그림 대신) */
function Silhouette({ card, color }: { card: Card; color: string }) {
  const cheer = card.kind === "cheer";
  const coach = card.kind === "coach";
  return (
    <svg viewBox="0 0 60 44" className="h-full w-full" aria-hidden>
      {/* 몸 */}
      <path d="M12 44 C12 31 20 26 30 26 C40 26 48 31 48 44 Z" fill={color} opacity={0.9} />
      {/* 머리 */}
      <circle cx="30" cy="16" r="9" fill={color} />
      {card.kind === "bat" && <path d="M47 6 L53 4 L41 34 L39 33 Z" fill="#e8d2a6" opacity={0.85} />}
      {card.kind === "pit" && <circle cx="48" cy="24" r="4.2" fill="#f4f1e8" stroke="#d24" strokeWidth={0.8} />}
      {/* 모자 챙 */}
      {!cheer && <path d={coach ? "M20 13 Q30 3 40 13 L44 14 L20 14 Z" : "M21 12 Q30 3 39 12 L45 14 L21 13 Z"} fill="rgba(0,0,0,0.35)" />}
      {cheer && (
        <>
          <path d="M37 10 Q46 12 44 26" stroke={color} strokeWidth={4} fill="none" strokeLinecap="round" />
          <circle cx="9" cy="30" r="6" fill="#ff8ad1" opacity={0.85} />
          <circle cx="51" cy="30" r="6" fill="#ff8ad1" opacity={0.85} />
        </>
      )}
    </svg>
  );
}

function Bar({ label, v, shown, max = 1000, color }: { label: string; v: number; shown?: ReactNode; max?: number; color: string }) {
  return (
    <div className="flex items-center gap-1 text-[9.5px] leading-none">
      <span className="w-[22px] shrink-0 text-white/55">{label}</span>
      <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.min(100, (v / max) * 100))}%`, background: color }} />
      </div>
      <span className="w-[26px] shrink-0 text-right font-mono text-white/80">{shown ?? Math.round(v)}</span>
    </div>
  );
}

/** 카드 한 장 줄 정보 */
export function cardSub(c: Card) {
  if (c.kind === "bat") return `${c.pos} · ${HAND(c.bats)}타`;
  if (c.kind === "pit") return `${c.role} · ${HAND(c.throws)}투 · ${c.velo}km`;
  return c.title;
}

/** 선수 카드 (등급 테두리 · 종합 · 실루엣 · 능력치 막대) */
export function CardView({
  card,
  tag,
  selected,
  dim,
  teamColor,
  onClick,
  draggable,
}: {
  card: Card;
  /** 배치 표시 (3번 · 선발2 · 후보) */
  tag?: string;
  selected?: boolean;
  dim?: boolean;
  teamColor: string;
  onClick?: () => void;
  draggable?: boolean;
}) {
  const staff = card.kind === "coach" || card.kind === "cheer";
  const ovr = ovrOf(card);
  const g = staff ? card.grade : gradeOf(ovr);
  const gc = GRADE_COLOR[g];
  const ss = g === "SS";
  const hof = card.kind === "bat" && card.hof;
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/pxb-card", card.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onClick}
      className="relative w-full cursor-pointer rounded-[11px] p-[3px] text-left transition-transform active:translate-y-[1px]"
      style={{
        background: ss ? "linear-gradient(135deg,#ff4d8d,#ffcf3a,#4fe0ff,#b46bff)" : gc,
        boxShadow: selected ? `0 0 0 3px #fff, 0 0 18px ${gc}` : g === "S" || ss ? `0 0 12px ${gc}88` : "0 3px 0 rgba(0,0,0,0.45)",
        opacity: dim ? 0.45 : 1,
      }}
    >
      <div className="flex h-[166px] flex-col overflow-hidden rounded-[8px] bg-[#131830]">
        {/* 위: 등급 · 종합 */}
        <div className="flex items-center justify-between px-1.5 pt-1">
          <GradeChip g={g} />
          {/* 코치 · 치어리더는 등급만 (점수 없음) */}
          {!staff && (
            <span className={`${font.title} text-[20px] leading-none`} style={{ color: gc, textShadow: "0 2px 0 #000" }}>
              {ovr}
            </span>
          )}
        </div>
        {/* 실루엣 */}
        <div className="relative mx-1.5 mt-1 h-[48px] overflow-hidden rounded-md" style={{ background: `linear-gradient(180deg, ${teamColor}40, ${teamColor}10)` }}>
          <Silhouette card={card} color={card.kind === "cheer" ? "#ffb3df" : card.kind === "coach" ? "#c9d1e6" : teamColor} />
          {(card.kind === "bat" || card.kind === "pit") && <span className="absolute top-0.5 left-1 font-mono text-[10px] font-bold text-white/85">#{card.num}</span>}
          {hof && <span className="absolute right-0.5 bottom-0.5 rounded bg-[#ffcf3a] px-1 text-[9px] font-bold text-[#111]">명예의 전당</span>}
          {tag && <span className={`absolute top-0.5 right-0.5 rounded bg-black/70 px-1 text-[9.5px] font-bold ${tag === "대기" ? "text-white/55" : "text-[#7dff9a]"}`}>{tag}</span>}
        </div>
        {/* 이름 */}
        <div className="truncate px-1.5 pt-1 text-[13px] leading-tight font-extrabold text-white">{card.name}</div>
        <div className="truncate px-1.5 text-[10px] leading-tight text-white/55">{cardSub(card)}</div>
        {/* 능력치 */}
        <div className="mt-auto flex flex-col gap-[3px] px-1.5 pb-1.5">
          {card.kind === "bat" && (
            <>
              <Bar label="맞히" v={card.hit} color="#7ad7ff" />
              <Bar label="파워" v={card.power} color="#ff7a5c" />
              <Bar label="주루" v={card.run} color="#7dff9a" />
              <Bar label="수비" v={card.def} color="#ffd23f" />
            </>
          )}
          {card.kind === "pit" && (
            <>
              <Bar label="구속" v={veloN(card.velo)} shown={card.velo} color="#ff7a5c" />
              <Bar label="제구" v={card.control} color="#7ad7ff" />
              <Bar label="변화" v={card.brk} color="#b46bff" />
              <Bar label="체력" v={card.stamina} color="#7dff9a" />
            </>
          )}
          {(card.kind === "coach" || card.kind === "cheer") && (
            <div className="rounded-md bg-white/[0.06] px-1.5 py-1 text-[10.5px] leading-snug text-white/85">
              {card.kind === "coach" ? "코치 효과" : "응원 효과"}
              {card.kind === "coach" ? (
                <>
                  <span className="block font-bold text-[#7dff9a]">{card.buff.map((b) => `${BUFF_NAME[b]} +${buffOf(card)}`).join(" · ")}</span>
                  <span className="text-[9.5px] text-white/45">{card.buff.some((b) => b === "control" || b === "brk") ? "투수 전원" : "타자 전원"}</span>
                </>
              ) : (
                <span className="block text-white/50">준비 중</span>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
