"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { RankSpec } from "@/components/GameHeader";
import RankList from "@/components/RankList";
import {
  caseKey,
  caseNo,
  dayLabel,
  FIRST_CASE_DAY,
  TIER_IDS,
  TIERS,
  type TierId,
} from "@/lib/casefile/engine";
import {
  getCaseRanking,
  getCaseSummary,
  type CasefileRanking,
  type CasefileSummary,
} from "@/firestore/casefileRankings";

/*
 * 오늘의 사건 파일 랭킹 창 — 난이도 · 날짜(‹ ›)로 사건 하나를 골라 순위 + 요약(푼 사람 · 한 번에 해결 · 중간 기록 · 평균 오답) + 내 순위
 * (오늘의 용의자 SuspectRank 와 같은 틀, 누적 · 달력은 아직 없음)
 */

export const fmtRec = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const shiftDay = (day: string, n: number) => {
  const d = new Date(
    Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8)) + n * 864e5
  );
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
};
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
const loadRows = (c: string) => getCaseRanking(c, 50);
const loadSummary = (c: string) => getCaseSummary(c);

const pill = (on: boolean) =>
  `cursor-pointer rounded-full border px-3 py-1 text-xs whitespace-nowrap ${
    on
      ? "border-[#D0675B] bg-[#D0675B]/15 font-bold text-white"
      : "border-white/10 text-white/55 hover:text-white"
  }`;
const arrow =
  "flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/10 text-white/70 hover:text-white disabled:cursor-default disabled:opacity-25";

export function useCaseFileRank(ready: boolean, today: string) {
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState<TierId>("normal");
  const [date, setDate] = useState(today);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const day = date > today ? today : date;
  const c = caseKey(day, tier);
  const rows = useLoad<CasefileRanking[]>(ready ? c : null, loadRows, tick);
  const sum = useLoad<CasefileSummary>(open ? c : null, loadSummary, tick);
  const list = rows ?? [];

  const openRank = (t: TierId, d?: string) => {
    setTier(t);
    setDate(d ?? today);
    reload();
    setOpen(true);
  };

  const spec: RankSpec = {
    top: list
      .slice(0, 3)
      .map((r) => ({ name: r.name, member: r.member, avatar: r.avatar, value: fmtRec(r.score) })),
    sub: `${dayLabel(day)} · #${caseNo(day)} · ${TIERS[tier].label}`,
    open,
    onOpenChange: (o) => {
      if (o) reload();
      setOpen(o);
    },
    head: () => (
      <div className="mb-3 flex flex-col gap-2.5 font-['Nanum_Gothic',sans-serif]">
        <div className="flex flex-wrap justify-center gap-1.5">
          {TIER_IDS.map((t) => (
            <button key={t} type="button" className={pill(t === tier)} onClick={() => setTier(t)}>
              {TIERS[t].label}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-center gap-1.5">
          <button
            type="button"
            className={arrow}
            aria-label="하루 전"
            disabled={day <= FIRST_CASE_DAY}
            onClick={() => setDate(shiftDay(day, -1))}
          >
            ‹
          </button>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1 text-[13px] text-white">
            <b>{dayLabel(day)}</b> <span className="text-white/45">사건 #{caseNo(day)}</span>
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
        <div className="grid grid-cols-4 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1.5 text-center">
          {(
            [
              ["푼 형사", sum ? `${sum.total}명` : "–", ""],
              [
                "한 번에 해결",
                sum ? `${sum.clean}명` : "–",
                sum?.total ? `${pct(sum.clean, sum.total)}%` : "",
              ],
              ["중간 기록", sum?.median != null ? fmtRec(sum.median) : "–", ""],
              ["평균 오답", sum?.avgWrong != null ? `${sum.avgWrong}번` : "–", ""],
            ] as [string, string, string][]
          ).map(([k, v, s]) => (
            <div key={k} className="min-w-0 px-0.5">
              <div className="truncate text-[10.5px] text-white/45">{k}</div>
              <div className="font-mono text-[15px] leading-tight font-bold text-white tabular-nums">
                {v}
              </div>
              {s ? <div className="truncate text-[10px] text-[#F0A79E]/80">{s}</div> : null}
            </div>
          ))}
        </div>
        {sum?.me ? (
          <MeBar>
            내 기록 <b className="text-white">{sum.me.pos}위</b>
            <span className="text-white/45"> / {sum.total}명</span>
            {sum.total >= 3 && (
              <span className="text-[#F0A79E]">
                {" "}
                · 상위 {Math.max(1, pct(sum.me.pos, sum.total))}%
              </span>
            )}
            <span className="text-white/60">
              {" "}
              · {fmtRec(sum.me.score)}
              {sum.me.wrong ? ` (오답 ${sum.me.wrong})` : " (한 번에)"}
            </span>
          </MeBar>
        ) : (
          sum && (
            <MeBar dim>
              {day === today
                ? "아직 이 사건 기록이 없어요 · 오늘 안에 풀면 올라가요"
                : "이 사건엔 내 기록이 없어요"}
            </MeBar>
          )
        )}
        <p className="m-0 text-center text-[11px] text-white/40">
          기록 = 시간 + 오답×2분 · 사건마다 첫 풀이만 · 오른쪽은 푼 시각
        </p>
      </div>
    ),
    render: () => (
      <RankList
        rows={list.map((r) => ({
          name: r.name,
          member: r.member,
          avatar: r.avatar,
          value: fmtRec(r.score),
          sub: r.wrong
            ? `${fmtRec(r.time)} + 오답 ${r.wrong}번`
            : `${fmtRec(r.time)} · 한 번에 해결`,
          when: hhmm(r.createdAt),
        }))}
        highlight={sum?.me ? list.findIndex((r) => r.id === sum.me!.id) : undefined}
        skip={3}
        empty={
          rows
            ? day === today
              ? "아직 이 사건을 푼 사람이 없어요. 첫 번째 형사가 되어 보세요!"
              : "이 사건은 푼 사람이 없어요."
            : "불러오는 중…"
        }
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
          : "border-[#D0675B]/40 bg-[#D0675B]/10 text-white/80"
      }`}
    >
      {children}
    </div>
  );
}
