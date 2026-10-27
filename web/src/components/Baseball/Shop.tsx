"use client";

/* 상점 (알파: 전부 개발 예정 — 살 수 있는 것 없음) */
import { ACCENT, Btn, font } from "./ui";

const ITEMS: { name: string; desc: string; price: string; color: string; icon: string }[] = [
  { name: "일반 카드팩", desc: "선수 카드 3장 · C ~ A 등급", price: "1,000 코인", color: "#9aa3b8", icon: "C·B·A" },
  { name: "고급 카드팩", desc: "B 등급 이상 1장 확정", price: "5,000 코인", color: "#b46bff", icon: "B+" },
  { name: "레전드 카드팩", desc: "S 등급 이상이 나올 수도", price: "준비 중", color: "#ffcf3a", icon: "S" },
  { name: "코인 묶음", desc: "코인 10,000 · 출석 · 미션 보상으로도", price: "준비 중", color: "#ffd23f", icon: "₩" },
  { name: "구단 유니폼", desc: "홈 · 원정 유니폼 색 바꾸기", price: "3,000 코인", color: "#4fb3ff", icon: "UNI" },
  { name: "응원가 · 치어리더", desc: "새 응원가와 치어리더 카드", price: "준비 중", color: "#ff8ad1", icon: "♪" },
];

export default function Shop({ coin, onBack }: { coin: number; onBack: () => void }) {
  return (
    <div className="flex h-full flex-col gap-3 px-8 py-5">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span className={`${font.title} text-[28px]`} style={{ color: ACCENT }}>
            상점
          </span>
          <span className="text-[12.5px] text-white/55">알파 테스트 중엔 살 수 있는 게 없어요 — 코인은 계속 모여요</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-[14px] font-bold text-[#ffd23f]">코인 {coin.toLocaleString()}</span>
          <Btn className="px-4 py-1.5 text-sm" color="#8b93b8" onClick={onBack}>
            ← 뒤로
          </Btn>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-3 grid-rows-2 gap-3">
        {ITEMS.map((it) => (
          <div key={it.name} className="relative flex flex-col overflow-hidden rounded-xl border-2 p-3" style={{ borderColor: `${it.color}55`, background: `linear-gradient(180deg, ${it.color}22, rgba(11,14,28,0.9))` }}>
            <div className="flex h-[92px] items-center justify-center rounded-lg" style={{ background: `repeating-linear-gradient(45deg, ${it.color}18 0 10px, transparent 10px 20px)` }}>
              <span className={`${font.title} text-[34px] opacity-60`} style={{ color: it.color, textShadow: "0 3px 0 #000" }}>
                {it.icon}
              </span>
            </div>
            <div className={`${font.title} mt-2 text-[18px] leading-tight`}>{it.name}</div>
            <div className="text-[12px] text-white/60">{it.desc}</div>
            <div className="mt-auto flex items-center justify-between pt-2">
              <span className="font-mono text-[12.5px] text-white/45 line-through decoration-white/30">{it.price}</span>
              <Btn disabled className="px-3 py-1 text-[12px]" color={it.color}>
                개발 예정
              </Btn>
            </div>
            <span className="absolute top-2 right-2 rotate-[8deg] rounded bg-[#ff7a7a] px-1.5 py-0.5 text-[10px] font-bold text-white shadow">개발 예정</span>
          </div>
        ))}
      </div>
    </div>
  );
}
