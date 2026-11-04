"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { RankSpec } from "@/components/GameHeader";
import RankList from "@/components/RankList";
import { dayLabel, dayNo, FIRST_DAY, shiftDay, TIERS } from "@/lib/pixelmerge/engine";
import {
  getMergeRanking,
  getMergeSummary,
  type PixelmergeRanking,
  type PixelmergeSummary,
} from "@/firestore/pixelmergeRankings";

/*
 * 픽셀 머지 랭킹 창 — 「오늘의 판」(날짜 ‹ ›) · 「무한 모드」(전체)
 *  요약: 한 사람 · 중간 점수 · 트로피 달성 + 내 순위 (CaseFileRank 와 같은 틀)
 */

export type RankTab = "daily" | "endless";
const fmt = (n: number) => n.toLocaleString("ko-KR");
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const hhmm = (d: Date | null) =>
  d ? `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}` : "";

function useLoad<T>(key: string | null, load: (k: string) => Promise<T>, tick: number) {
  const [got, setGot] = useState<Record<string, T | null>>({});
  useEffect(() => {
    if (!key) return;
    let off = false;
    load(key).then(
      (v) => !off && setGot((o) => ({ ...o, [key]: v })),
      () => !off && setGot((o) => ({ ...o, [key]: o[key] ?? null }))
    );
    return () => {
      off = true;
    };
  }, [key, load, tick]);
  return key ? got[key] : undefined;
}
const loadRows = (b: string) => getMergeRanking(b, 50);
const loadSummary = (b: string) => getMergeSummary(b);

const pill = (on: boolean) =>
  `cursor-pointer rounded-full border px-3 py-1 text-xs whitespace-nowrap ${
    on
      ? "border-[#ffcf4a] bg-[#ffcf4a]/15 font-bold text-white"
      : "border-white/10 text-white/55 hover:text-white"
  }`;
const arrow =
  "flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/10 text-white/70 hover:text-white disabled:cursor-default disabled:opacity-25";

export function usePixelMergeRank(ready: boolean, today: string) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<RankTab>("daily");
  const [date, setDate] = useState(today);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const day = date > today ? today : date;
  const b = tab === "daily" ? day : "endless";
  const rows = useLoad<PixelmergeRanking[]>(ready ? b : null, loadRows, tick);
  const sum = useLoad<PixelmergeSummary>(open ? b : null, loadSummary, tick);
  const list = rows ?? [];

  const openRank = (t: RankTab, d?: string) => {
    setTab(t);
    setDate(d ?? today);
    reload();
    setOpen(true);
  };

  const spec: RankSpec = {
    top: list
      .slice(0, 3)
      .map((r) => ({ name: r.name, member: r.member, avatar: r.avatar, value: fmt(r.score) })),
    sub: tab === "daily" ? `오늘의 판 · ${dayLabel(day)}` : "무한 모드 · 전체",
    open,
    onOpenChange: (o) => {
      if (o) reload();
      setOpen(o);
    },
    head: () => (
      <div className="mb-3 flex flex-col gap-2.5 font-['Nanum_Gothic',sans-serif]">
        <div className="flex flex-wrap justify-center gap-1.5">
          <button type="button" className={pill(tab === "daily")} onClick={() => setTab("daily")}>
            오늘의 판
          </button>
          <button
            type="button"
            className={pill(tab === "endless")}
            onClick={() => setTab("endless")}
          >
            무한 모드
          </button>
        </div>
        {tab === "daily" && (
          <div className="flex items-center justify-center gap-1.5">
            <button
              type="button"
              className={arrow}
              aria-label="하루 전"
              disabled={day <= FIRST_DAY}
              onClick={() => setDate(shiftDay(day, -1))}
            >
              ‹
            </button>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1 text-[13px] text-white">
              <b>{dayLabel(day)}</b> <span className="text-white/45">#{dayNo(day)}</span>
            </span>
            <button
              type="button"
              className={arrow}
              aria-label="하루 뒤"
              disabled={day >= today}
              onClick={() => setDate(shiftDay(day, 1))}
            >
              ›
            </button>
            <button
              type="button"
              className={`${pill(day === today)} ${day === today ? "invisible" : ""}`}
              onClick={() => setDate(today)}
            >
              오늘
            </button>
          </div>
        )}
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1.5 text-center">
          {(
            [
              ["한 사람", sum ? `${sum.total}명` : "–", ""],
              ["중간 점수", sum?.median != null ? fmt(sum.median) : "–", ""],
              [
                "황금 건모",
                sum ? `${sum.trophy}명` : "–",
                sum?.total ? `${pct(sum.trophy, sum.total)}%` : "",
              ],
            ] as [string, string, string][]
          ).map(([k, v, s]) => (
            <div key={k} className="min-w-0 px-0.5">
              <div className="truncate text-[10.5px] text-white/45">{k}</div>
              <div className="font-mono text-[15px] leading-tight font-bold text-white tabular-nums">
                {v}
              </div>
              {s ? <div className="truncate text-[10px] text-[#ffcf4a]/80">{s}</div> : null}
            </div>
          ))}
        </div>
        {sum?.me ? (
          <MeBar>
            내 기록 <b className="text-white">{sum.me.pos}위</b>
            <span className="text-white/45"> / {sum.total}명</span>
            {sum.total >= 3 && (
              <span className="text-[#ffcf4a]">
                {" "}
                · 상위 {Math.max(1, pct(sum.me.pos, sum.total))}%
              </span>
            )}
            <span className="text-white/60">
              {" "}
              · {fmt(sum.me.score)}점 · {TIERS[sum.me.maxTier]?.name}
            </span>
          </MeBar>
        ) : (
          sum && (
            <MeBar dim>
              {tab === "endless"
                ? "아직 무한 모드 기록이 없어요"
                : day === today
                  ? "아직 오늘의 판 기록이 없어요 · 오늘 안에 하면 올라가요"
                  : "이날은 내 기록이 없어요"}
            </MeBar>
          )
        )}
        <p className="m-0 text-center text-[11px] text-white/40">
          {tab === "daily"
            ? "같은 날엔 모두 같은 순서로 공이 나와요 · 하루 중 가장 높은 점수만"
            : "공 순서는 매판 랜덤 · 가장 높은 점수만"}
        </p>
      </div>
    ),
    render: () => (
      <RankList
        rows={list.map((r) => ({
          name: r.name,
          member: r.member,
          avatar: r.avatar,
          value: fmt(r.score),
          sub: `최고 ${TIERS[r.maxTier]?.name ?? "?"} · 공 ${r.drops}개`,
          when:
            tab === "daily"
              ? hhmm(r.createdAt)
              : r.createdAt
                ? `${r.createdAt.getMonth() + 1}/${r.createdAt.getDate()}`
                : "",
        }))}
        highlight={sum?.me ? list.findIndex((r) => r.id === sum.me!.id) : undefined}
        skip={3}
        empty={rows ? "아직 기록이 없어요. 첫 번째로 올려 보세요!" : "불러오는 중…"}
      />
    ),
  };
  return { spec, openRank, reload };
}

function MeBar({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return (
    <div
      className={`rounded-lg border px-3 py-1.5 text-center text-[12.5px] break-keep ${
        dim
          ? "border-dashed border-white/10 text-white/40"
          : "border-[#ffcf4a]/40 bg-[#ffcf4a]/10 text-white/80"
      }`}
    >
      {children}
    </div>
  );
}
