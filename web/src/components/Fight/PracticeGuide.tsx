/**
 * 연습 모드 오른쪽 기술 가이드 — 지금 고른 캐릭터의 콤보 · 알아 둘 점을 게임 화면 오른쪽에 펼쳐 둠 (접을 수 있음, 펼침 상태 기억).
 * 내용은 guideData.ts (메인 화면 「기술 가이드」와 같은 내용).
 */
import { useState } from "react";
import { CHARS } from "@/lib/fight/chars";
import { BASIC_COMBOS, CHAR_GUIDE, type Combo } from "./guideData";
import { keyText } from "./KeyCap";

const KR = "font-['Nanum_Gothic',sans-serif]";
const KEY = "fight:pracGuide";

function Row({ c }: { c: Combo }) {
  const steps = c.keys.split("→").map((s) => s.trim());
  return (
    <div className="rounded-[0.5cqw] bg-white/[0.06] px-[0.8cqw] py-[0.55cqw]">
      <div className="mb-[0.3cqw] text-[1.05cqw] font-extrabold text-[#FFE9A8]">{c.name}</div>
      <div className="flex flex-wrap items-center gap-[0.35cqw]">
        {steps.map((s, i) => (
          <span key={i} className="flex items-center gap-[0.35cqw]">
            {i > 0 && <span className="text-[0.9cqw] text-[#F2C35B]/70">▸</span>}
            <span className="rounded-[0.3cqw] bg-black/40 px-[0.5cqw] py-[0.15cqw] text-[1cqw] font-bold whitespace-nowrap text-white">
              {keyText(s)}
            </span>
          </span>
        ))}
      </div>
      {c.note && <p className="mt-[0.35cqw] text-[0.9cqw] leading-snug break-keep text-white/55">{keyText(c.note)}</p>}
    </div>
  );
}

export default function PracticeGuide({ ch }: { ch: number }) {
  const c = CHARS[ch];
  const g = c ? CHAR_GUIDE[c.id] : undefined;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [tab, setTab] = useState<"char" | "basic">("char");
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(KEY, o ? "0" : "1");
      } catch {
        /* 저장 안 돼도 그만 */
      }
      return !o;
    });
  };
  if (!c || !g) return null;
  if (!open)
    return (
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
        className={`${KR} absolute top-[12.5cqw] right-[1.2cqw] z-10 cursor-pointer rounded-full border border-[#F2C35B]/50 bg-black/65 px-[1.1cqw] py-[0.35cqw] text-[1.05cqw] font-bold text-[#FFE9A8] hover:bg-black/80`}
      >
        📖 기술 가이드
      </button>
    );
  return (
    <div
      className={`${KR} absolute top-[12.5cqw] right-[1.2cqw] bottom-[9.5cqw] z-10 flex w-[25cqw] flex-col overflow-hidden rounded-[0.8cqw] border border-[#F2C35B]/40 bg-[#140A22]/80 backdrop-blur-[2px]`}
    >
      <div className="flex items-center gap-[0.5cqw] border-b border-white/10 px-[0.8cqw] py-[0.5cqw]">
        <img src={`/fight/art/${c.id}-face.webp`} alt="" className="h-[2cqw] w-[2.3cqw] rounded-[0.3cqw] object-cover [image-rendering:pixelated]" style={{ boxShadow: `0 0 0 1px ${c.color}` }} />
        {(
          [
            ["char", c.name],
            ["basic", "기본"],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
        onMouseDown={(e) => e.preventDefault()}
            onClick={() => setTab(t)}
            className={`cursor-pointer rounded-full px-[0.8cqw] py-[0.15cqw] text-[1cqw] font-bold ${tab === t ? "bg-[#F2C35B] text-[#2A0E3A]" : "text-white/65 hover:text-white"}`}
          >
            {label}
          </button>
        ))}
        <button type="button"
        onMouseDown={(e) => e.preventDefault()} onClick={toggle} className="ml-auto cursor-pointer rounded-full bg-white/10 px-[0.7cqw] py-[0.1cqw] text-[0.95cqw] text-white/70 hover:bg-white/20">
          접기 ✕
        </button>
      </div>
      <div className="gold-scroll flex min-h-0 flex-1 flex-col gap-[0.5cqw] overflow-y-auto px-[0.8cqw] py-[0.7cqw]">
        {tab === "char" ? (
          <>
            {g.combos.map((x) => (
              <Row key={x.name} c={x} />
            ))}
            <div className="mt-[0.3cqw] text-[1cqw] font-extrabold text-[#F2C35B]">알아 둘 점</div>
            {g.points.map((p) => (
              <p key={p} className="text-[0.92cqw] leading-snug break-keep text-white/65">
                · {keyText(p)}
              </p>
            ))}
          </>
        ) : (
          BASIC_COMBOS.map((x) => <Row key={x.name} c={x} />)
        )}
      </div>
    </div>
  );
}
