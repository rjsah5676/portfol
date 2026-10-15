import type { ReactNode } from "react";
import { rankDateLabel } from "@/lib/rankDate";
import Nick from "./Nick";
import RankAvatar from "./RankAvatar";

export interface RankRow {
  name: string;
  /** 회원의 기록인지 (아니면 이름 앞에 GUEST 표시) */
  member?: boolean;
  /** 회원이 올린 프로필 사진 주소 (없으면 null·생략 — 비회원은 익명 실루엣) */
  avatar?: string | null;
  /** 표시할 기록 (예: "123ms", "45.2s") */
  value: string;
  /** 이름 아래 작은 설명 (예: "vs 1600 · 32수") */
  sub?: ReactNode;
  date?: Date | null;
}

/**
 * 랭킹 목록 공통 (순위 · 이름 · 기록 · 달성일 열 정렬).
 * 예전 기록은 날짜가 없어서 칸만 비워 둠.
 */
export default function RankList({
  rows,
  highlight,
  empty = "아직 기록이 없어요",
  skip = 0,
}: {
  rows: RankRow[];
  highlight?: number;
  empty?: string;
  /** 위쪽 몇 등은 빼고 (시상대로 따로 보여 줄 때). 순위 번호는 그대로 */
  skip?: number;
}) {
  if (!rows.length)
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
        <span className="text-3xl opacity-60" aria-hidden>
          🏆
        </span>
        <p className="font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed break-keep text-white/55">{empty}</p>
      </div>
    );
  if (rows.length <= skip) return null;
  return (
    <ol className="flex flex-col">
      {rows.map((r, i) =>
        i < skip ? null : (
          <li
            key={i}
            className={`grid grid-cols-[1.5rem_1.75rem_minmax(0,1fr)_auto_3.75rem] items-center gap-2 rounded-md px-1.5 py-1 font-mono text-[13px] ${
              i === highlight ? "bg-[#6C63FF]/20" : ""
            }`}
          >
            <span
              className={`text-right tabular-nums ${i === 0 ? "text-[#FDE047]" : i < 3 ? "text-white/80" : "text-white/35"}`}
            >
              {i + 1}
            </span>
            <RankAvatar avatar={r.avatar} name={r.name} guest={!r.member} size="sm" />
            <span className="min-w-0 text-left font-['Nanum_Gothic',sans-serif]">
              <Nick name={r.name} guest={!r.member} className="block truncate text-white/85" />
              {r.sub && <span className="block truncate text-[10px] text-white/35">{r.sub}</span>}
            </span>
            <span className="text-right text-white tabular-nums">{r.value}</span>
            <span className="text-right text-[11px] text-white/30 tabular-nums">
              {rankDateLabel(r.date)}
            </span>
          </li>
        )
      )}
    </ol>
  );
}
