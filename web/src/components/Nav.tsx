"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS, type NavGroup } from "@/data/navMenu";
import { SearchIcon, openSiteSearch } from "@/components/SiteSearch";

/**
 * 상단 메뉴. 대제목은 목록 페이지 링크, PC는 마우스를 올리면(터치 기기는 ▾를 누르면) 메뉴 바 아래로 넓은 패널이 열리고
 * 하위 메뉴가 아이콘·설명 카드 격자로 나옴 → 항목이 늘어도 세로로 길게 늘어지지 않음.
 * 빠른 이동은 오른쪽 검색(Ctrl/⌘ K)으로.
 */

const trim = (p: string) => p.replace(/\/+$/, "") || "/";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M2.5 4.5L6 8L9.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Panel({ group, path, onClose }: { group: NavGroup; path: string; onClose: () => void }) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3 px-3 py-3 sm:flex-row sm:gap-6 sm:px-6 sm:py-5">
      <div className="hidden w-48 shrink-0 flex-col sm:flex">
        <div className="font-mono text-lg font-bold text-white">{group.title}</div>
        <p className="mt-1 font-['Nanum_Gothic',sans-serif] text-xs leading-relaxed break-keep text-white/45">
          {group.desc}
        </p>
        <Link
          href={`${group.href}/`}
          onClick={onClose}
          className="mt-auto pt-4 font-mono text-xs text-[#8B84FF] hover:text-white"
        >
          전체 보기 →
        </Link>
      </div>
      <ul className="grid flex-1 grid-cols-2 gap-1.5 sm:gap-2 lg:grid-cols-3">
        {group.items.map((it) => {
          const on = path === trim(it.href);
          return (
            <li key={it.href}>
              <Link
                href={`${it.href}/`}
                onClick={onClose}
                className={`flex h-full items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-colors sm:px-3 sm:py-2.5 ${
                  on
                    ? "border-[#6C63FF]/50 bg-[#6C63FF]/15"
                    : "border-white/5 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]"
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 font-mono text-sm sm:h-9 sm:w-9 sm:text-base">
                  {it.icon}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block truncate font-['Nanum_Gothic',sans-serif] text-[13px] sm:text-sm ${on ? "text-white" : "text-white/85"}`}
                  >
                    {it.label}
                  </span>
                  <span className="hidden truncate font-['Nanum_Gothic',sans-serif] text-[11px] text-white/40 sm:block">
                    {it.desc}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <Link
        href={`${group.href}/`}
        onClick={onClose}
        className="self-end font-mono text-xs text-[#8B84FF] sm:hidden"
      >
        {group.title} 전체 보기 →
      </Link>
    </div>
  );
}

export default function Nav() {
  const path = trim(usePathname());
  const [open, setOpen] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const group = NAV_GROUPS.find((g) => g.key === open) ?? null;

  // 페이지가 바뀌면 닫기
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 경로 변경 시 패널 닫기
    setOpen(null);
  }, [path]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // PC: 마우스를 올리면 살짝 늦게 열고, 메뉴 영역을 벗어나면 닫음 (터치 기기는 탭으로만)
  const hoverable = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const clearHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };

  return (
    <nav
      ref={navRef}
      className="sticky top-14 z-30 border-b border-white/10 bg-[#121212]"
      onMouseLeave={() => {
        if (!hoverable()) return;
        clearHover();
        hoverTimer.current = setTimeout(() => setOpen(null), 180);
      }}
    >
      <div className="mx-auto flex max-w-4xl items-center justify-center px-1 sm:px-6">
        <div className="flex flex-1 items-center justify-center">
          {NAV_GROUPS.map((g) => {
            const active = path === trim(g.href) || g.items.some((i) => path === trim(i.href));
            const isOpen = open === g.key;
            return (
              <div
                key={g.key}
                className="flex items-center"
                onMouseEnter={() => {
                  if (!hoverable()) return;
                  clearHover();
                  hoverTimer.current = setTimeout(() => setOpen(g.key), open ? 0 : 120);
                }}
              >
                {/* 이름은 목록 페이지로, 화살표(터치 기기)·마우스 올리기(PC)로 패널 */}
                <Link
                  href={`${g.href}/`}
                  onClick={() => setOpen(null)}
                  className={`py-3 pl-2 font-mono text-[13px] whitespace-nowrap transition-colors min-[400px]:pl-2.5 sm:pl-3.5 sm:text-sm ${
                    isOpen || active ? "text-[#8B84FF]" : "text-white/60 hover:text-white"
                  }`}
                >
                  {g.label}
                </Link>
                <button
                  type="button"
                  aria-label={`${g.label} 하위 메뉴`}
                  aria-expanded={isOpen}
                  onClick={() => {
                    // PC는 마우스 올리기로 열리니 클릭은 무시 (터치 기기에서만 토글)
                    if (hoverable()) return;
                    setOpen((o) => (o === g.key ? null : g.key));
                  }}
                  className={`cursor-pointer py-3 pr-2 pl-1 transition-colors min-[400px]:pr-2.5 sm:pr-3.5 [@media(hover:hover)_and_(pointer:fine)]:cursor-default ${
                    isOpen ? "text-[#8B84FF]" : "text-white/35"
                  }`}
                >
                  <Chevron open={isOpen} />
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(null);
            openSiteSearch();
          }}
          aria-label="검색 (Ctrl+K)"
          title="검색 (Ctrl+K)"
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full p-2 text-white/50 transition-colors hover:text-white sm:border sm:border-white/10 sm:px-3 sm:py-1.5"
        >
          <SearchIcon className="h-4 w-4" />
          <kbd className="hidden font-mono text-[11px] text-white/35 md:inline">Ctrl K</kbd>
        </button>
      </div>
      {group && (
        <div
          className="absolute inset-x-0 top-full max-h-[calc(100svh-120px)] overflow-y-auto border-b border-white/10 bg-[#16171C]/95 shadow-2xl backdrop-blur-md"
          onMouseEnter={clearHover}
        >
          <Panel group={group} path={path} onClose={() => setOpen(null)} />
        </div>
      )}
    </nav>
  );
}
