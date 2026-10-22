"use client";

/*
 * 픽셀 순찰대 — 공용 조각 (장비 아이콘 · 재화 표시 · 모달 틀)
 * 서바이버 도트 UI(.pts) 위에서 그림.
 */
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import SoundSliders from "../Survivor/SoundSliders";
import { useStage } from "../Survivor/Stage";
import { sfx } from "../Survivor/audio";
import { GEAR, GRADE_COLOR, GRADE_NAME, type GearItem, type GearId, type GGrade } from "@/lib/patrol/gear";

/** 장비 칸 그림: 등급 테두리 · 아이콘 · 레벨 */
export function GearIcon({ id, g, lv, size = 56, on, dim, badge, onClick, title }: { id: GearId; g: GGrade; lv?: number; size?: number; on?: boolean; dim?: boolean; badge?: ReactNode; onClick?(): void; title?: string }) {
  const c = GRADE_COLOR[g];
  const body = (
    <>
      <span className="absolute inset-[3px]" style={{ background: `radial-gradient(circle at 50% 40%, ${c}55, ${c}10 70%)` }} />
      <img src={`/patrol/gear/${id}.png`} alt={GEAR[id].name} draggable={false} className="relative" style={{ width: size * 0.8, height: size * 0.8, imageRendering: size >= 64 ? "pixelated" : "auto", filter: dim ? "grayscale(1) brightness(0.5)" : undefined }} />
      {lv !== undefined && <b className="pts-sub absolute right-[3px] bottom-[1px] text-[10px] leading-none">Lv{lv}</b>}
      {g >= 3 && <span className="pts-rune absolute inset-0" style={{ boxShadow: `inset 0 0 ${size / 5}px ${c}` }} />}
      {badge}
    </>
  );
  const style: CSSProperties = { width: size, height: size, background: "#100c2c", boxShadow: `0 0 0 2px ${on ? "#fff" : c}, 0 0 0 4px #07051a` };
  return onClick ? (
    <button type="button" onClick={onClick} title={title ?? `${GRADE_NAME[g]} ${GEAR[id].name}`} className="relative flex shrink-0 cursor-pointer items-center justify-center" style={style}>
      {body}
    </button>
  ) : (
    <span title={title ?? `${GRADE_NAME[g]} ${GEAR[id].name}`} className="relative flex shrink-0 items-center justify-center" style={style}>
      {body}
    </span>
  );
}
export const itemTitle = (it: Pick<GearItem, "id" | "g">) => `${GRADE_NAME[it.g]} ${GEAR[it.id].name}`;

/** 재화: 코인 · 보석 · 설계도 */
export function Coin({ v, size = 12, ink }: { v: number | string; size?: number; /** 글자색 (버튼 안이면 어둡게) */ ink?: string }) {
  return (
    <span className="inline-flex items-center gap-[4px]" style={{ color: ink ?? "#ffd23a" }}>
      <i className="inline-block rounded-full bg-[#ffd23a]" style={{ width: size - 2, height: size - 2, boxShadow: "0 0 0 2px #07051a, inset -2px -2px 0 #d49a12" }} />
      {typeof v === "number" ? v.toLocaleString() : v}
    </span>
  );
}
export function Gem({ v, size = 12, ink }: { v: number | string; size?: number; /** 글자색 (버튼 안이면 어둡게) */ ink?: string }) {
  return (
    <span className="inline-flex items-center gap-[4px]" style={{ color: ink ?? "#7fe8ff" }}>
      <i className="inline-block rotate-45 bg-[#7fe8ff]" style={{ width: size - 4, height: size - 4, boxShadow: "0 0 0 2px #07051a, inset -2px -2px 0 #2fa6d8" }} />
      {typeof v === "number" ? v.toLocaleString() : v}
    </span>
  );
}
export function Bp({ v, size = 12, ink }: { v: number | string; size?: number; /** 글자색 (버튼 안이면 어둡게) */ ink?: string }) {
  return (
    <span className="inline-flex items-center gap-[4px]" style={{ color: ink ?? "#9fb6ff" }}>
      <i className="inline-block bg-[#3d5bd8]" style={{ width: size - 2, height: size - 2, boxShadow: "0 0 0 2px #07051a, inset 0 -3px 0 #9fb6ff" }} />
      {typeof v === "number" ? v.toLocaleString() : v}
    </span>
  );
}

/** 무대 가운데 모달 (어둡게 · 하나만 · ESC 닫기) */
export function Modal({ title, sub, onClose, children, w = 900, h }: { title: string; sub?: ReactNode; onClose(): void; children: ReactNode; w?: number; h?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: "rgba(7,5,26,0.82)" }} onClick={onClose}>
      <div className="pts-win pts-pop flex flex-col px-[18px] py-[14px]" style={{ width: w, height: h }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-[10px]">
          <span className="pts-tag text-[13px]">{title}</span>
          {sub && <span className="text-[12px] text-[#a9a2d6]">{sub}</span>}
          <button type="button" onClick={onClose} className="pts-btn ghost ml-auto h-[28px] w-[28px] text-[14px]">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const btn = (c: string, t = "#07051a") => ({ "--c": c, "--t": t }) as CSSProperties;

/** 오른쪽 위 시스템 버튼: ⚙ 설정 (소리 · 음악 · 전체화면 · 조작) · ⛶ 전체화면 켜기/끄기 */
export function SysButtons({ className = "" }: { className?: string }) {
  const st = useStage();
  const [open, setOpen] = useState(false);
  /** 설정 창은 무대(.pts) 전체를 덮게 그쪽에 붙임 (버튼 줄 안에 그리면 작은 칸에 갇힘) */
  const [host, setHost] = useState<HTMLElement | null>(null);
  const hostRef = useCallback((el: HTMLElement | null) => {
    if (el) setHost(el.closest<HTMLElement>(".pts"));
  }, []);
  const modal = (
    <Modal title="설정" onClose={() => setOpen(false)} w={420}>
      <div className="mt-[14px]">
        <SoundSliders />
      </div>
      {st.canFs && (
        <button type="button" onClick={st.toggleFs} className="pts-btn mt-[14px] h-[36px] text-[13px]" style={btn(st.fs ? "#ff8fb8" : "#4ff0c8")}>
          {st.fs ? "✕ 전체화면 끄기" : "⛶ 전체화면으로"}
        </button>
      )}
      <div className="mt-[14px] flex flex-col gap-[3px] text-[12px] text-[#a9a2d6]">
        <span>이동 WASD · 방향키 / 대시 SPACE · SHIFT / 필살기 E · Q</span>
        <span>레벨업: 숫자 1~4 · 다시 뽑기 R · 건너뛰기 X / 일시정지 ESC</span>
      </div>
    </Modal>
  );
  return (
    <>
      <span ref={hostRef} className={`flex gap-[6px] ${className}`}>
        <button type="button" onClick={() => (sfx("click"), setOpen(true))} className="pts-btn ghost h-[30px] w-[34px] text-[15px]" title="설정">
          ⚙
        </button>
        {st.canFs && (
          <button type="button" onClick={st.toggleFs} className="pts-btn ghost h-[30px] w-[34px] text-[14px]" title={st.fs ? "전체화면 끄기" : "전체화면"}>
            {st.fs ? "✕" : "⛶"}
          </button>
        )}
      </span>
      {open && host && createPortal(modal, host)}
    </>
  );
}
