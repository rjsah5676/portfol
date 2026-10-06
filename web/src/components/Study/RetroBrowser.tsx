"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  parseStudyDate,
  postPath,
  SECTION_META,
  STUDY_CATEGORIES,
  type StudyPostListItem,
} from "@/firestore/studyPosts";

// 프로젝트 회고 목록 — 개인 공부(분류 사이드바 + 카드 목록, 보라)와 구분되게
// 연도별 타임라인 + 분류 필터 칩, 민트 톤
const ACCENT = "#2dd4bf";
const PAGE = 8;

export default function RetroBrowser({ posts }: { posts: StudyPostListItem[] }) {
  const router = useRouter();
  const meta = SECTION_META.retro;
  const categories = STUDY_CATEGORIES.filter((c) => posts.some((p) => p.category === c));
  const [cat, setCat] = useState<string>("all");
  const [q, setQ] = useState("");
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("category");
    if (!fromUrl || !posts.some((p) => p.category === fromUrl)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL 기반 초기값 동기화(마운트 1회)
    setCat(fromUrl);
  }, [posts]);

  const select = (c: string) => {
    setCat(c);
    setLimit(PAGE);
    router.replace(
      c === "all" ? `${meta.path}/` : `${meta.path}/?category=${encodeURIComponent(c)}`,
      {
        scroll: false,
      }
    );
  };

  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visible = (p: StudyPostListItem) =>
    (cat === "all" || p.category === cat) && terms.every((t) => p.searchText.includes(t));

  // 연도별 묶음 (최신순). 크롤러가 모든 링크를 보도록 전부 렌더하고 필터는 hidden으로
  const ordered = useMemo(() => {
    const t = (p: StudyPostListItem) => parseStudyDate(p.date)?.getTime() ?? 0;
    return [...posts].sort((a, b) => (order === "desc" ? t(b) - t(a) : t(a) - t(b)));
  }, [posts, order]);
  const years = useMemo(() => {
    const map = new Map<string, StudyPostListItem[]>();
    for (const p of ordered) {
      const y = String(parseStudyDate(p.date)?.getFullYear() ?? "기타");
      map.set(y, [...(map.get(y) ?? []), p]);
    }
    return [...map.entries()];
  }, [ordered]);
  // 필터에 맞는 글 중 앞에서부터 limit개만 보여줌 (나머지도 HTML엔 남김)
  const matched = ordered.filter(visible);
  const shownIds = new Set(matched.slice(0, limit).map((p) => p.id));
  const shownCount = matched.length;
  const rest = shownCount - shownIds.size;

  const chip = (on: boolean) =>
    `cursor-pointer rounded-full border px-3.5 py-1.5 font-mono text-xs whitespace-nowrap transition-colors ${
      on
        ? "border-[#2dd4bf]/70 bg-[#2dd4bf]/10 text-[#7ff0dd]"
        : "border-white/10 text-white/45 hover:border-white/25 hover:text-white/80"
    }`;

  return (
    <div className="mx-auto max-w-3xl px-6 pt-16 pb-24">
      <div className="font-mono text-xs tracking-[0.2em] uppercase" style={{ color: ACCENT }}>
        retrospective
      </div>
      <h1 className="mt-2 font-mono text-2xl font-bold text-white sm:text-3xl">{meta.label}</h1>
      <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/50">
        프로젝트에서 직접 겪은 문제를 <b className="text-white/70">문제 → 원인 → 해결 → 배운 점</b>{" "}
        순서로 기록합니다.
      </p>

      <div className="mt-8 flex flex-col gap-3">
        <input
          type="text"
          inputMode="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setLimit(PAGE);
          }}
          onKeyDown={(e) => e.key === "Escape" && setQ("")}
          placeholder="회고 검색 (제목·본문)"
          aria-label="프로젝트 회고 검색"
          className="w-full rounded-xl border border-white/10 bg-[#16181c] px-4 py-2.5 font-['Nanum_Gothic',sans-serif] text-sm text-white placeholder:text-white/30 focus:border-[#2dd4bf]/50 focus:outline-none"
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => select("all")} className={chip(cat === "all")}>
            전체 <span className="text-white/30">{posts.length}</span>
          </button>
          {categories.map((c) => (
            <button key={c} type="button" onClick={() => select(c)} className={chip(cat === c)}>
              {c}{" "}
              <span className="text-white/30">{posts.filter((p) => p.category === c).length}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between font-mono text-xs text-white/35">
        <span>{shownCount}편</span>
        <div className="flex rounded-full border border-white/10 p-0.5">
          {(["desc", "asc"] as const).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setOrder(o)}
              className={`cursor-pointer rounded-full px-3 py-1 transition-colors ${
                order === o ? "bg-[#2dd4bf]/15 text-[#7ff0dd]" : "text-white/40 hover:text-white/70"
              }`}
            >
              {o === "desc" ? "최신순" : "오래된순"}
            </button>
          ))}
        </div>
      </div>

      {shownCount === 0 && (
        <p className="mt-12 font-['Nanum_Gothic',sans-serif] text-white/45">
          {posts.length === 0 ? "아직 글이 없습니다." : "조건에 맞는 회고가 없습니다."}
        </p>
      )}

      <div className="mt-8 flex flex-col gap-14">
        {years.map(([year, list]) => {
          const shown = list.filter((p) => shownIds.has(p.id));
          return (
            <section key={year} hidden={shown.length === 0}>
              <h2 className="mb-6 flex items-center gap-3 font-mono text-sm text-white/40">
                <span className="text-2xl font-bold text-white/90">{year}</span>
                <span className="h-px flex-1 bg-white/10" />
                <span>{shown.length}편</span>
              </h2>
              <ol className="relative ml-2 border-l border-white/10">
                {list.map((p) => {
                  const d = parseStudyDate(p.date);
                  const md = d
                    ? `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`
                    : "";
                  return (
                    <li
                      key={p.id}
                      hidden={!shownIds.has(p.id)}
                      className="group relative pb-8 pl-7 last:pb-0"
                    >
                      <span className="absolute top-2 -left-[5px] h-[9px] w-[9px] rounded-full border-2 border-[#121212] bg-white/30 transition-all duration-300 group-hover:scale-150 group-hover:bg-[#2dd4bf]" />
                      <Link href={postPath(p)} className="block">
                        <div className="flex items-center gap-2 font-mono text-xs">
                          <span style={{ color: ACCENT }}>{md}</span>
                          <span className="rounded border border-white/10 px-1.5 py-px text-[10px] text-white/45">
                            {p.category}
                          </span>
                        </div>
                        <h3 className="mt-1.5 font-mono text-[15px] leading-snug font-medium text-white/90 transition-colors group-hover:text-[#7ff0dd] sm:text-base">
                          {p.title}
                        </h3>
                        {p.excerpt && (
                          <p className="mt-1.5 line-clamp-2 font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/45">
                            {p.excerpt}
                          </p>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>

      {rest > 0 && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + PAGE)}
          className="mt-10 w-full cursor-pointer rounded-xl border border-white/10 py-3 font-mono text-sm text-white/60 transition-colors hover:border-[#2dd4bf]/50 hover:text-[#7ff0dd]"
        >
          더보기 <span className="text-white/30">+{Math.min(rest, PAGE)}</span>
        </button>
      )}
    </div>
  );
}
