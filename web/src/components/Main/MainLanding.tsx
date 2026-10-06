"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { STACK_COLORS } from "@/components/About/AboutLanding";
import SiteLinks, { type SiteLink } from "@/components/SiteLinks";
import { NAV_GROUPS } from "@/data/navMenu";

// 메인: About(풀스크린 히어로)과 다르게 한 화면에 들어오는 벤토 그리드

const STACK = [
  "Java",
  "Spring Boot",
  "MyBatis",
  "MariaDB",
  "TypeScript",
  "Next.js",
  "React",
  "Node.js",
  "Firebase",
];

// 상단 nav 메뉴(NAV_GROUPS)에서 그대로 가져옴 — 메뉴가 늘거나 바뀌어도 따로 안 고쳐도 되게
const SHORT_DESC: Record<string, string> = {
  project: "프로젝트 · 공부 · 회고",
  games: "직접 만든 브라우저 게임",
  tools: "일상 도구",
  devtools: "개발 편의 도구",
};
const LINKS = NAV_GROUPS.map((g) => ({
  href: `${g.href}/`,
  label: g.title,
  desc: SHORT_DESC[g.key] ?? g.desc,
}));

const GREETING = "hello, world";

/** 마우스 위치를 --x/--y로 넘겨서 테두리 빛이 따라오게 (about.css의 .ab-spot) */
const trackSpot = (e: React.PointerEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--x", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--y", `${e.clientY - r.top}px`);
};

function Tile({
  children,
  i,
  className = "",
}: {
  children: ReactNode;
  i: number;
  className?: string;
}) {
  return (
    <div
      onPointerMove={trackSpot}
      className={`mn-tile ab-spot overflow-hidden rounded-3xl border border-white/10 bg-[#1A1B20] ${className}`}
      style={{ "--i": i } as CSSProperties}
    >
      {children}
    </div>
  );
}

function Typed({ text }: { text: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (n >= text.length) return;
    const id = setTimeout(() => setN((v) => v + 1), n === 0 ? 500 : 70);
    return () => clearTimeout(id);
  }, [n, text]);
  return (
    <span>
      {text.slice(0, n)}
      <span className="ab-caret" />
    </span>
  );
}

export default function MainLanding({ photo, sites }: { photo: string; sites: SiteLink[] }) {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-10 pb-24 sm:px-6 sm:pt-14">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        {/* 소개 */}
        <Tile i={0} className="col-span-2 flex flex-col justify-between p-6 sm:p-8 md:row-span-2">
          <div>
            <div className="font-mono text-sm text-[#8B84FF]">
              <span className="text-white/30">$ echo </span>
              <Typed text={GREETING} />
            </div>
            <h1 className="mt-6 font-mono text-4xl font-bold text-white sm:text-5xl">이건모</h1>
            <p className="mt-2 font-mono text-sm text-white/40">Lee Gunmo · Fullstack Developer</p>
            <p className="mt-6 max-w-sm font-['Nanum_Gothic',sans-serif] leading-relaxed break-keep text-white/65">
              화면부터 서버, 데이터베이스까지 이어서 만듭니다. 문제는 원인까지 따라가서 고치고, 배운
              것은 기록으로 남깁니다.
            </p>
          </div>
          <Link
            href="/about/"
            className="group mt-8 inline-flex w-fit items-center gap-2 rounded-full bg-white px-5 py-2.5 font-mono text-sm text-[#121212] transition-transform hover:-translate-y-0.5"
          >
            더 알아보기
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </Link>
        </Tile>

        {/* 사진 */}
        <Tile i={1} className="relative col-span-2 aspect-[586/532] md:row-span-2 md:aspect-auto">
          <img
            src={photo}
            alt="이건모 프로필 사진"
            className="mn-kenburns absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          <div className="absolute right-4 bottom-4 left-4 flex items-end justify-between gap-3">
            <span className="font-mono text-xs text-white/80">Seize the day.</span>
            <span className="rounded-full bg-black/40 px-2.5 py-1 font-mono text-[10px] text-white/70 backdrop-blur">
              Seongnam, KR
            </span>
          </div>
        </Tile>

        {/* 기술 */}
        <Tile i={2} className="col-span-2 p-5 sm:p-6">
          <div className="mb-3 font-mono text-xs text-white/35">stack</div>
          <div className="flex flex-wrap gap-1.5">
            {STACK.map((t) => {
              const [bg, border, color] = STACK_COLORS[t];
              return (
                <span
                  key={t}
                  className="rounded-full border px-2.5 py-1 font-mono text-[11px]"
                  style={{ backgroundColor: bg, borderColor: border, color }}
                >
                  {t}
                </span>
              );
            })}
          </div>
        </Tile>

        {/* 지금 */}
        <Tile i={3} className="p-5 sm:p-6">
          <div className="mb-3 flex items-center gap-1.5 font-mono text-xs text-white/35">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            now
          </div>
          <div className="font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed break-keep text-white/85">
            커머스 플랫폼 풀스택 개발
          </div>
        </Tile>

        {/* 학력 */}
        <Tile i={4} className="p-5 sm:p-6">
          <div className="mb-3 font-mono text-xs text-white/35">edu</div>
          <div className="font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed break-keep text-white/85">
            아주대학교 소프트웨어학과
          </div>
        </Tile>

        {/* 바로가기 */}
        {LINKS.map((l, i) => (
          <Tile key={l.href} i={5 + i} className="group">
            <Link href={l.href} className="flex h-full flex-col justify-between gap-6 p-5 sm:p-6">
              <span className="font-mono text-lg font-medium text-white">{l.label}</span>
              <span className="flex items-end justify-between gap-2">
                <span className="font-['Nanum_Gothic',sans-serif] text-xs break-keep text-white/45">
                  {l.desc}
                </span>
                <span className="font-mono text-white/30 transition-all duration-300 group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-[#A9A3FF]">
                  ↗
                </span>
              </span>
            </Link>
          </Tile>
        ))}

        {/* 외부 링크 */}
        <Tile
          i={5 + LINKS.length}
          className="col-span-2 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6 md:col-span-4"
        >
          <span className="font-mono text-xs text-white/35">elsewhere</span>
          <SiteLinks sites={sites} />
        </Tile>
      </div>
    </div>
  );
}
