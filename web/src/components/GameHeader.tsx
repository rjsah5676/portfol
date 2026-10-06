"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Modal from "@/components/Modal/Modal";
import GuideView, { type GuideDoc } from "@/components/GuideView";
import HintBubble, { markHintSeen } from "@/components/HintBubble";

export interface TopEntry {
  name: string;
  /** 표시할 기록 (예: "132점", "45.2s") */
  value: string;
  /** 작은 설명 (예: "vs 이순신(5단)") */
  sub?: ReactNode;
}

export interface RankSpec {
  /** 1~3위: 버튼에서 돌아가며 보여 주고, 모달 맨 위에 시상대로 */
  top?: TopEntry[] | null;
  /** 모달 제목 뒤에 붙는 말 (예: 곡 이름) */
  sub?: string;
  /** 모달 내용 (열릴 때만 그림) */
  render: () => ReactNode;
  /** 밖에서 열고 닫기 (결과 화면의 "랭킹 보기" 등) */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** 게임 머리말이 화면 맨 위에 오게 (대국 시작 등 화면이 바뀔 때) */
export function scrollToGameTop() {
  document
    .querySelector("[data-game-header]")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * 게임 페이지 공통 머리말: 아이콘 · 이름 · 한 줄 설명 + [게임 가이드] [랭킹] 버튼.
 * 처음 들어오면 이 머리말이 화면 맨 위에 오게 스크롤해서, 바로 아래 게임 판이 한눈에 보이게 함.
 */
export default function GameHeader({
  icon,
  title,
  en,
  desc,
  accent = "#8B84FF",
  guide,
  rank,
  scroll = true,
  className = "",
}: {
  icon: string;
  title: string;
  en: string;
  desc: string;
  accent?: string;
  guide?: GuideDoc;
  rank?: RankSpec;
  /** 처음 들어올 때 게임 위치로 스크롤 */
  scroll?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [rankOpenSelf, setRankOpenSelf] = useState(false);
  const rankOpen = rank?.open ?? rankOpenSelf;
  const setRankOpen = (o: boolean) => {
    if (rank?.onOpenChange) rank.onOpenChange(o);
    else setRankOpenSelf(o);
  };

  useEffect(() => {
    if (!scroll) return;
    const id = setTimeout(
      () => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      350
    );
    return () => clearTimeout(id);
  }, [scroll]);

  const pill =
    "flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 font-['Nanum_Gothic',sans-serif] text-[13px] whitespace-nowrap transition-colors";

  return (
    <header
      ref={ref}
      data-game-header
      className={`@container mb-4 scroll-mt-[114px] text-left sm:mb-5 ${className}`}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border text-2xl text-white sm:h-12 sm:w-12"
          style={{
            background: `linear-gradient(145deg, ${accent}33, ${accent}0d)`,
            borderColor: `${accent}55`,
          }}
          aria-hidden
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h1 className="truncate font-['Nanum_Gothic',sans-serif] text-lg font-bold text-white sm:text-xl">
              {title}
            </h1>
            <span
              className="hidden shrink-0 font-mono text-[10px] tracking-[0.2em] uppercase @lg:inline"
              style={{ color: accent }}
            >
              {en}
            </span>
          </div>
          <p className="truncate font-['Nanum_Gothic',sans-serif] text-xs text-white/45 sm:text-[13px]">
            {desc}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {guide && (
            <span className="relative">
              <button
                type="button"
                onClick={() => {
                  setGuideOpen(true);
                  markHintSeen(`hint:guide:${en}`);
                }}
                className={`${pill} border-white/12 bg-white/[0.04] text-white/80 hover:border-white/30 hover:text-white`}
              >
                <span aria-hidden>📖</span>
                <span className="@2xl:hidden">가이드</span>
                <span className="hidden @2xl:inline">게임 가이드</span>
                <span className="hidden text-white/35 @2xl:inline" aria-hidden>
                  ›
                </span>
              </button>
              <HintBubble
                storageKey={`hint:guide:${en}`}
                tail="top"
                delay={700}
                duration={6500}
                maxShows={3}
                className="absolute top-full left-1/2 z-20 mt-2 -translate-x-1/2"
              >
                처음이신가요? 👋 <b className="text-white">게임 가이드</b>에서 하는 방법을 볼 수
                있어요
              </HintBubble>
            </span>
          )}
          {rank && (
            <button
              type="button"
              onClick={() => setRankOpen(true)}
              aria-label="랭킹 보기"
              className={`${pill} border-[#FDE047]/30 bg-[#FDE047]/[0.07] text-[#FDE68A] hover:border-[#FDE047]/60`}
            >
              <span aria-hidden>🏆</span>
              <span className="hidden @sm:inline">랭킹</span>
              {!!rank.top?.length && <TopTicker top={rank.top} />}
            </button>
          )}
        </div>
      </div>
      <div
        className="mt-3 h-px"
        style={{
          background: `linear-gradient(90deg, ${accent}66, rgba(255,255,255,0.08) 40%, transparent)`,
        }}
      />

      {guide && (
        <Modal
          open={guideOpen}
          onClose={() => setGuideOpen(false)}
          size="lg"
          closeButton
          title={
            <span className="flex items-center gap-2">
              <span aria-hidden>{icon}</span> {title} 가이드
            </span>
          }
        >
          <GuideView doc={guide} accent={accent} onDone={() => setGuideOpen(false)} />
        </Modal>
      )}
      {rank && (
        <Modal
          open={rankOpen}
          onClose={() => setRankOpen(false)}
          size="md"
          closeButton
          title={
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span>🏆 {title} 랭킹</span>
              {rank.sub && <span className="text-xs text-white/40">{rank.sub}</span>}
            </span>
          }
        >
          {rankOpen && (
            <>
              {!!rank.top?.length && <Podium top={rank.top} />}
              {rank.render()}
            </>
          )}
        </Modal>
      )}
    </header>
  );
}

const MEDAL = ["🥇", "🥈", "🥉"];

/** 랭킹 버튼 안: 1~3위를 몇 초마다 돌려 가며 (넓을 때만) */
function TopTicker({ top }: { top: TopEntry[] }) {
  const list = top.slice(0, 3);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (list.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % list.length), 2800);
    return () => clearInterval(t);
  }, [list.length]);
  const e = list[i % list.length];
  return (
    <span
      key={i}
      className="rank-tick hidden w-[10.5rem] truncate text-left text-[11px] text-[#FDE68A]/70 @3xl:inline-block"
    >
      {MEDAL[i % list.length]} {e.name} · {e.value}
    </span>
  );
}

/** 랭킹 모달 맨 위 시상대 (2위 · 1위 · 3위) */
function Podium({ top }: { top: TopEntry[] }) {
  const order = [1, 0, 2].filter((n) => top[n]);
  const style = [
    { h: "h-16", ring: "#FDE047", bg: "from-[#FDE047]/25" },
    { h: "h-11", ring: "#D1D5DB", bg: "from-[#D1D5DB]/20" },
    { h: "h-8", ring: "#F59E0B", bg: "from-[#D97706]/20" },
  ];
  return (
    <div className="mb-4 flex items-end justify-center gap-2">
      {order.map((n) => {
        const e = top[n];
        const st = style[n];
        return (
          <div key={n} className="flex w-1/3 max-w-[9.5rem] min-w-0 flex-col items-center">
            <div className={`text-center ${n === 0 ? "rank-crown" : ""}`}>
              <div className={n === 0 ? "text-3xl" : "text-2xl"}>{MEDAL[n]}</div>
              <div className="mt-0.5 max-w-full truncate px-1 text-sm font-bold text-white">
                {e.name}
              </div>
              <div className="font-mono text-xs tabular-nums" style={{ color: st.ring }}>
                {e.value}
              </div>
              {e.sub && (
                <div className="max-w-full truncate px-1 text-[10px] text-white/35">{e.sub}</div>
              )}
            </div>
            <div
              className={`mt-1.5 w-full rounded-t-lg border-x border-t bg-gradient-to-b to-transparent ${st.h} ${st.bg} flex items-start justify-center pt-1 font-mono text-xs font-bold text-white/60`}
              style={{ borderColor: `${st.ring}66` }}
            >
              {n + 1}
            </div>
          </div>
        );
      })}
    </div>
  );
}
