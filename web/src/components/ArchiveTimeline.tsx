"use client";

import { useState } from "react";
import ArchiveBox, { TAG_STYLE } from "@/components/ArchiveBox";
import { ARCHIVE_TAGS, type ArchiveEntry, type ArchiveTag } from "@/data/archive";

type Filter = "전체" | ArchiveTag;
type Order = "desc" | "asc";

const PAGE_SIZE = 8;

export default function ArchiveTimeline({ entries }: { entries: ArchiveEntry[] }) {
  const [filter, setFilter] = useState<Filter>("전체");
  const [order, setOrder] = useState<Order>("desc");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const changeFilter = (f: Filter) => {
    setFilter(f);
    setLimit(PAGE_SIZE);
  };
  const changeOrder = (o: Order) => {
    setOrder(o);
    setLimit(PAGE_SIZE);
  };

  // entries는 최신순으로 들어옴
  const ordered = order === "desc" ? entries : [...entries].reverse();
  const matched = ordered.filter((e) => filter === "전체" || e.tag === filter);
  const shown = new Set(matched.slice(0, limit));
  const remaining = matched.length - shown.size;

  const count = (f: Filter) =>
    f === "전체" ? entries.length : entries.filter((e) => e.tag === f).length;

  // 연도별 그룹 (정렬 순서 유지)
  const years: { year: string; list: ArchiveEntry[] }[] = [];
  for (const e of ordered) {
    const year = e.sort.slice(0, 4);
    const last = years[years.length - 1];
    if (last?.year === year) last.list.push(e);
    else years.push({ year, list: [e] });
  }

  const chip = (active: boolean) =>
    `flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs transition-colors ${
      active
        ? "border-[#6C63FF] bg-[#6C63FF]/10 text-white"
        : "border-white/10 text-white/50 hover:text-white"
    }`;

  return (
    <>
      <div className="mb-12 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="분류">
          {(["전체", ...ARCHIVE_TAGS] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => changeFilter(f)}
              className={chip(filter === f)}
            >
              {f !== "전체" && <span className={`h-1.5 w-1.5 rounded-full ${TAG_STYLE[f].dot}`} />}
              {f}
              <span className="text-white/30">{count(f)}</span>
            </button>
          ))}
        </div>

        <div
          className="ml-auto flex flex-shrink-0 overflow-hidden rounded-full border border-white/10 font-mono text-xs"
          aria-label="정렬"
        >
          {(
            [
              ["desc", "최신순"],
              ["asc", "오래된순"],
            ] as [Order, string][]
          ).map(([o, label]) => (
            <button
              key={o}
              type="button"
              aria-pressed={order === o}
              onClick={() => changeOrder(o)}
              className={`cursor-pointer px-3 py-1 transition-colors ${
                order === o ? "bg-[#6C63FF]/15 text-white" : "text-white/40 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 필터/더보기는 hidden으로만 처리 -> 정적 HTML에는 전체 기록이 그대로 남음(SEO) */}
      <div className="flex flex-col gap-10">
        {years.map(({ year, list }) => (
          <section key={year} hidden={!list.some((e) => shown.has(e))}>
            <h2 className="mb-6 font-mono text-2xl font-bold text-white/20">{year}</h2>
            <div className="relative ml-1 border-l border-white/10">
              {list.map((entry) => (
                <div key={entry.sort} hidden={!shown.has(entry)}>
                  <ArchiveBox entry={entry} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {(remaining > 0 || limit > PAGE_SIZE) && (
        <div className="mt-4 flex justify-center gap-2">
          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setLimit((l) => l + PAGE_SIZE)}
              className="cursor-pointer rounded-full border border-white/10 px-5 py-2 font-mono text-xs text-white/60 transition-colors hover:border-[#6C63FF]/50 hover:text-white"
            >
              더보기{" "}
              <span className="text-white/30">
                ({shown.size}/{matched.length})
              </span>
            </button>
          )}
          {limit > PAGE_SIZE && (
            <button
              type="button"
              onClick={() => setLimit(PAGE_SIZE)}
              className="cursor-pointer rounded-full px-4 py-2 font-mono text-xs text-white/35 transition-colors hover:text-white"
            >
              접기
            </button>
          )}
        </div>
      )}
    </>
  );
}
