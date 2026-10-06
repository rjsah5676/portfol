"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NAV_GROUPS } from "@/data/navMenu";
import { chosung } from "@/lib/food";
import { lockScroll } from "@/lib/scrollLock";

/**
 * 사이트 빠른 이동 (Ctrl/⌘ + K, 또는 '/').
 * 메뉴가 늘어나도 이름 일부·초성(ㄹㄷ → 리듬게임)·설명으로 바로 찾아 들어가게.
 */

interface Entry {
  href: string;
  label: string;
  desc: string;
  icon: string;
  group: string;
  keywords?: string;
}

const EXTRA: Entry[] = [
  { href: "/", label: "홈", desc: "메인", icon: "🏠", group: "site" },
  { href: "/about", label: "About", desc: "소개·걸어온 길", icon: "👋", group: "site" },
  { href: "/archive", label: "아카이브", desc: "작업 기록 타임라인", icon: "🗓️", group: "site" },
  { href: "/guest", label: "방명록", desc: "한마디 남기기", icon: "📮", group: "site" },
];

const ENTRIES: Entry[] = [
  ...NAV_GROUPS.flatMap((g) => [
    { href: g.href, label: `${g.title} 전체`, desc: g.desc, icon: "▦", group: g.label },
    ...g.items.map((i) => ({ ...i, group: g.label })),
  ]),
  ...EXTRA,
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

function score(e: Entry, q: string) {
  const label = norm(e.label);
  if (label.startsWith(q)) return 3;
  if (label.includes(q)) return 2;
  if (/^[ㄱ-ㅎ]+$/.test(q) && chosung(label).includes(q)) return 2;
  if (norm(`${e.desc} ${e.group} ${e.keywords ?? ""} ${e.href}`).includes(q)) return 1;
  return 0;
}

export function openSiteSearch() {
  window.dispatchEvent(new Event("site-search:open"));
}

export default function SiteSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t?.closest?.("input, textarea, [contenteditable='true']");
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("site-search:open", onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("site-search:open", onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 열 때마다 검색어 초기화
    setQ("");
    setSel(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    const unlock = lockScroll();
    return () => {
      cancelAnimationFrame(id);
      unlock();
    };
  }, [open]);

  // 뒤로가기로 닫기 (모바일): 열 때 같은 주소로 기록을 하나 쌓고, popstate가 오면 닫음.
  // 다른 방법으로 닫으면 쌓아 둔 기록을 history.back()으로 치움. 결과로 이동할 땐 그 기록을 replace로 덮어씀.
  const pushedRef = useRef(false);
  const navigatingRef = useRef(false);
  useEffect(() => {
    if (!open) return;
    let closedByPop = false;
    const onPop = () => {
      closedByPop = true;
      pushedRef.current = false;
      setOpen(false);
    };
    // StrictMode(dev)에서 바로 언마운트·재마운트될 때 꼬이지 않게 한 틱 미룸
    const timer = setTimeout(() => {
      window.history.pushState({ ...window.history.state, __search: true }, "");
      pushedRef.current = true;
      window.addEventListener("popstate", onPop);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("popstate", onPop);
      if (pushedRef.current && !closedByPop && !navigatingRef.current) window.history.back();
      pushedRef.current = false;
      navigatingRef.current = false;
    };
  }, [open]);

  const results = useMemo(() => {
    const k = norm(q);
    if (!k) return ENTRIES.filter((e) => e.group !== "site" && !e.label.endsWith(" 전체"));
    return ENTRIES.map((e) => ({ e, s: score(e, k) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.e);
  }, [q]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  const go = (e: Entry | undefined) => {
    if (!e) return;
    const href = e.href.endsWith("/") ? e.href : `${e.href}/`;
    // 열 때 쌓은 기록 자리를 새 페이지로 바꿔서, 새 페이지에서 뒤로가기 한 번이면 원래 페이지로
    if (pushedRef.current) {
      navigatingRef.current = true;
      router.replace(href);
    } else router.push(href);
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-3 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="사이트 검색"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[#1C1E24] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-white/10 px-4">
          <SearchIcon className="h-4 w-4 shrink-0 text-white/40" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(results.length - 1, s + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(results[sel]);
              } else if (e.key === "Escape") setOpen(false);
            }}
            placeholder="게임·도구·페이지 검색 (초성도 돼요)"
            className="h-12 w-full bg-transparent font-['Nanum_Gothic',sans-serif] text-[15px] text-white placeholder:text-white/30 focus:outline-none"
          />
          <kbd className="hidden rounded border border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-white/40 sm:block">
            Esc
          </kbd>
        </div>
        <ul ref={listRef} className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center font-mono text-sm text-white/35">결과가 없어요</li>
          )}
          {results.map((e, i) => (
            <li key={e.href + e.label} data-i={i}>
              <button
                type="button"
                onMouseMove={() => setSel(i)}
                onClick={() => go(e)}
                className={`flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left ${
                  i === sel ? "bg-[#6C63FF]/20" : ""
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 font-mono text-sm">
                  {e.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-['Nanum_Gothic',sans-serif] text-sm text-white">
                    {e.label}
                  </span>
                  <span className="block truncate font-['Nanum_Gothic',sans-serif] text-xs text-white/40">
                    {e.desc}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[10px] text-white/30">{e.group}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}
