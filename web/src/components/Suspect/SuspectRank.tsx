"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { RankSpec } from "@/components/GameHeader";
import RankList from "@/components/RankList";
import {
  caseKey,
  caseNo,
  dayLabel,
  FIRST_CASE_DAY,
  RANKED_TIERS,
  shiftDay,
  TIER_SINCE,
  TIERS,
  weekdayOf,
  type TierId,
} from "@/lib/suspect/engine";
import type { Store } from "@/lib/suspect/progress";
import {
  getCaseRanking,
  getCaseSummary,
  getSuspectHall,
  type CaseSummary,
  type Hall,
  type HallSort,
  type SuspectRanking,
} from "@/firestore/suspectRankings";
import { fmtTime } from "./Result";

/*
 * 오늘의 용의자 랭킹 창
 *  - 날짜별: 난이도 · 날짜(‹ › · 달력)로 사건 하나를 골라 그 사건 순위 + 요약(푼 사람 · 완벽 · 중간 기록 · 평균 실수) + 내 순위
 *  - 누적: 날짜 상관없이 푼 사건 수 · 1위 횟수 순위 (난이도별 · 전체)
 */

type View = "day" | "hall";
type HallTier = TierId | "all";

/** key 가 바뀌거나 tick 이 오르면 다시 받음. 실패하면 null (빈 목록으로 보여 줌) */
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
const loadHall = (k: string) => {
  const [tier, sort] = k.split(":");
  return getSuspectHall(tier, sort as HallSort);
};

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const hhmm = (d: Date | null) =>
  d ? `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}` : "";
const fullDay = (d: string) => `${dayLabel(d)} (${weekdayOf(d)})`;
/** 오늘까지 열린 사건 수 (난이도마다 처음 연 날부터 — 대형 지옥은 늦게 생김) */
const openedCases = (today: string, tiers: TierId[]) =>
  tiers.reduce((n, t) => n + caseNo(today) - caseNo(TIER_SINCE[t] ?? FIRST_CASE_DAY) + 1, 0);

const pill = (on: boolean) =>
  `cursor-pointer rounded-full border px-3 py-1 text-xs whitespace-nowrap ${
    on
      ? "border-[#C9A15B] bg-[#C9A15B]/15 font-bold text-white"
      : "border-white/10 text-white/55 hover:text-white"
  }`;
const arrow =
  "flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/10 text-white/70 hover:text-white disabled:cursor-default disabled:opacity-25";

export function useSuspectRank(ready: boolean, today: string, store: Store | null) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("day");
  const [tier, setTier] = useState<TierId>("normal");
  const [date, setDate] = useState(today);
  const [hallTier, setHallTier] = useState<HallTier>("all");
  const [hallSort, setHallSort] = useState<HallSort>("solved");
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  // 자정이 지나 오늘이 바뀌면 보던 날짜가 미래가 되지 않게
  const day = date > today ? today : date;
  const c = caseKey(day, tier);
  // 순위 목록은 머리말 버튼(1~3위)에도 쓰여서 늘 받음. 요약 · 누적은 창을 열었을 때만
  const rows = useLoad<SuspectRanking[]>(ready ? c : null, loadRows, tick);
  const sum = useLoad<CaseSummary>(open && view === "day" ? c : null, loadSummary, tick);
  const hall = useLoad<Hall>(open && view === "hall" ? `${hallTier}:${hallSort}` : null, loadHall, tick);

  const openRank = (t: TierId, d?: string) => {
    setView("day");
    setTier(t);
    setDate(d ?? today);
    reload();
    setOpen(true);
  };

  const list = rows ?? [];
  const top = (xs: { name: string; member?: boolean; avatar?: string | null }[], val: (i: number) => string) =>
    xs.slice(0, 3).map((r, i) => ({ name: r.name, member: r.member, avatar: r.avatar, value: val(i) }));
  const hallValue = (r: Hall["rows"][number]) => (hallSort === "wins" ? `${r.wins}회` : `${r.solved}건`);

  const spec: RankSpec = {
    top: top(list, (i) => fmtTime(list[i].score)),
    podium:
      view === "hall"
        ? hall
          ? top(hall.rows, (i) => hallValue(hall.rows[i]))
          : []
        : undefined,
    sub:
      view === "day"
        ? `${fullDay(day)} · #${caseNo(day)} · ${TIERS[tier].label}`
        : `누적 · ${hallTier === "all" ? "전체 난이도" : TIERS[hallTier].label}`,
    open,
    onOpenChange: (o) => {
      if (o) reload();
      setOpen(o);
    },
    head: () => (
      <div className="mb-3 flex flex-col gap-2.5 font-['Nanum_Gothic',sans-serif]">
        <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1 text-sm">
          {(
            [
              ["day", "📅 날짜별"],
              ["hall", "🏛️ 누적 순위"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={view === k}
              onClick={() => setView(k)}
              className={`cursor-pointer rounded-lg py-1.5 transition-colors ${
                view === k ? "bg-white/12 font-bold text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap justify-center gap-1.5">
          {view === "hall" && (
            <button type="button" className={pill(hallTier === "all")} onClick={() => setHallTier("all")}>
              전체
            </button>
          )}
          {RANKED_TIERS.map((t) => (
            <button
              key={t}
              type="button"
              className={pill(view === "day" ? t === tier : t === hallTier)}
              onClick={() => (view === "day" ? setTier(t) : setHallTier(t))}
            >
              {TIERS[t].label}
            </button>
          ))}
        </div>

        {view === "day" ? (
          <>
            <DayPicker day={day} today={today} tier={tier} store={store} onPick={setDate} />
            <Stats
              cells={[
                ["푼 탐정", sum ? `${sum.total}명` : "–"],
                ["완벽 해결", sum ? `${sum.perfect}명` : "–", sum?.total ? `${pct(sum.perfect, sum.total)}%` : ""],
                ["중간 기록", sum?.median != null ? fmtTime(sum.median) : "–"],
                ["평균 실수", sum?.avgMiss != null ? `${sum.avgMiss}번` : "–"],
              ]}
            />
            {sum?.me ? (
              <MeBar>
                내 기록 <b className="text-white">{sum.me.pos}위</b>
                <span className="text-white/45"> / {sum.total}명</span>
                {sum.total >= 3 && (
                  <span className="text-[#FDE68A]"> · 상위 {Math.max(1, pct(sum.me.pos, sum.total))}%</span>
                )}
                <span className="text-white/60">
                  {" "}
                  · {fmtTime(sum.me.score)}
                  {sum.me.miss ? ` (실수 ${sum.me.miss})` : " (완벽)"}
                </span>
              </MeBar>
            ) : (
              sum && (
                <MeBar dim>
                  {day === today ? "아직 이 사건 기록이 없어요 · 오늘 안에 풀면 올라가요" : "이 사건엔 내 기록이 없어요"}
                </MeBar>
              )
            )}
            <p className="m-0 text-center text-[11px] text-white/40">
              기록 = 시간 + 실수×2분 · 사건마다 첫 풀이만 · 오른쪽은 푼 시각
            </p>
          </>
        ) : (
          <>
            <div className="flex justify-center gap-1.5">
              {(
                [
                  ["solved", "푼 사건 수"],
                  ["wins", "1위 횟수"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" className={pill(hallSort === k)} onClick={() => setHallSort(k)}>
                  {label}
                </button>
              ))}
            </div>
            <Stats
              cells={[
                ["참여 탐정", hall ? `${hall.players}명` : "–"],
                [
                  "풀린 사건",
                  hall ? `${hall.cases}건` : "–",
                  `열린 ${openedCases(today, hallTier === "all" ? RANKED_TIERS : [hallTier])}건 중`,
                ],
                ["총 풀이", hall ? `${hall.solves}번` : "–"],
              ]}
            />
            {hall?.me ? (
              <MeBar>
                내 순위 <b className="text-white">{hall.me.pos}위</b>
                <span className="text-white/45"> / {hall.players}명</span>
                <span className="text-white/60">
                  {" "}
                  · 해결 {hall.me.solved}건 · 1위 {hall.me.wins}번 · 완벽 {hall.me.perfect}번
                </span>
              </MeBar>
            ) : (
              hall && <MeBar dim>아직 내 기록이 없어요 · 오늘의 사건을 풀면 여기 올라가요</MeBar>
            )}
            <p className="m-0 text-center text-[11px] text-white/40">
              1위는 사건별 최고 기록 (오늘 사건은 바뀔 수 있음) · 오른쪽은 최근 푼 날
            </p>
          </>
        )}
      </div>
    ),
    render: () =>
      view === "day" ? (
        <RankList
          rows={list.map((r) => ({
            name: r.name,
            member: r.member,
            avatar: r.avatar,
            value: fmtTime(r.score),
            sub: r.miss
              ? `${fmtTime(r.time)} + 실수 ${r.miss}번${r.hint ? ` · 힌트 ${r.hint}` : ""}`
              : `${fmtTime(r.time)} · 완벽${r.hint ? ` · 힌트 ${r.hint}` : ""}`,
            when: hhmm(r.createdAt),
          }))}
          highlight={sum?.me ? list.findIndex((r) => r.id === sum.me!.id) : undefined}
          skip={3}
          empty={
            rows
              ? day === today
                ? "아직 이 사건을 푼 사람이 없어요. 첫 번째 탐정이 되어 보세요!"
                : "이 사건은 푼 사람이 없어요."
              : "불러오는 중…"
          }
        />
      ) : (
        <RankList
          rows={(hall?.rows ?? []).map((r) => ({
            name: r.name,
            member: r.member,
            avatar: r.avatar,
            value: hallValue(r),
            sub:
              hallSort === "wins"
                ? `해결 ${r.solved}건 · 완벽 ${r.perfect}번`
                : `1위 ${r.wins}번 · 완벽 ${r.perfect}번`,
            date: r.last,
          }))}
          highlight={hall ? hall.rows.findIndex((r) => r.me) : undefined}
          skip={3}
          empty={hall ? "아직 기록이 없어요." : "불러오는 중…"}
        />
      ),
  };

  return { spec, openRank };
}

function Stats({ cells }: { cells: [string, string, string?][] }) {
  return (
    <div
      className="grid gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1.5 text-center"
      style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
    >
      {cells.map(([k, v, s]) => (
        <div key={k} className="min-w-0 px-0.5">
          <div className="truncate text-[10.5px] text-white/45">{k}</div>
          <div className="font-mono text-[15px] leading-tight font-bold text-white tabular-nums">{v}</div>
          {s ? <div className="truncate text-[10px] text-[#FDE68A]/70">{s}</div> : null}
        </div>
      ))}
    </div>
  );
}

function MeBar({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return (
    <div
      className={`rounded-lg border px-3 py-1.5 text-center text-[12.5px] break-keep ${
        dim ? "border-dashed border-white/10 text-white/40" : "border-[#C9A15B]/40 bg-[#C9A15B]/10 text-white/80"
      }`}
    >
      {children}
    </div>
  );
}

// ───────────────────────── 날짜 고르기 ─────────────────────────

/** ‹ 11월 3일 (화) · #4 › — 가운데를 누르면 달력. 내가 푼 사건(이 난이도)은 점 */
function DayPicker({
  day,
  today,
  tier,
  store,
  onPick,
}: {
  day: string;
  today: string;
  tier: TierId;
  store: Store | null;
  onPick: (d: string) => void;
}) {
  const [cal, setCal] = useState(false);
  const [month, setMonth] = useState(day.slice(0, 6));
  const pick = (d: string) => {
    onPick(d);
    setMonth(d.slice(0, 6));
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-center gap-1.5">
        <button
          type="button"
          className={arrow}
          aria-label="하루 전"
          disabled={day <= FIRST_CASE_DAY}
          onClick={() => pick(shiftDay(day, -1))}
        >
          ‹
        </button>
        <button
          type="button"
          aria-expanded={cal}
          onClick={() => {
            setMonth(day.slice(0, 6));
            setCal((o) => !o);
          }}
          className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1 text-[13px] text-white hover:border-white/25"
        >
          <span className="font-bold">{fullDay(day)}</span>
          <span className="text-white/45">사건 #{caseNo(day)}</span>
          <span className={`text-[10px] text-white/40 transition-transform ${cal ? "rotate-180" : ""}`}>▼</span>
        </button>
        <button
          type="button"
          className={arrow}
          aria-label="하루 뒤"
          disabled={day >= today}
          onClick={() => pick(shiftDay(day, 1))}
        >
          ›
        </button>
        <button
          type="button"
          className={`${pill(day === today)} ${day === today ? "invisible" : ""}`}
          onClick={() => {
            pick(today);
            setCal(false);
          }}
        >
          오늘
        </button>
      </div>
      {cal && (
        <Calendar
          month={month}
          setMonth={setMonth}
          day={day}
          today={today}
          solved={(d) => !!store?.days[d]?.[tier]?.done}
          onPick={(d) => {
            pick(d);
            setCal(false);
          }}
        />
      )}
    </div>
  );
}

function Calendar({
  month,
  setMonth,
  day,
  today,
  solved,
  onPick,
}: {
  /** "YYYYMM" */
  month: string;
  setMonth: (m: string) => void;
  day: string;
  today: string;
  solved: (d: string) => boolean;
  onPick: (d: string) => void;
}) {
  const y = +month.slice(0, 4);
  const m = +month.slice(4, 6);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ym = (yy: number, mm: number) => `${yy}${String(mm).padStart(2, "0")}`;
  const prev = m === 1 ? ym(y - 1, 12) : ym(y, m - 1);
  const next = m === 12 ? ym(y + 1, 1) : ym(y, m + 1);
  const cells: (string | null)[] = [
    ...Array<null>(first).fill(null),
    ...Array.from({ length: days }, (_, i) => `${month}${String(i + 1).padStart(2, "0")}`),
  ];
  return (
    <div className="mx-auto w-full max-w-[300px] rounded-xl border border-white/10 bg-[#17171c] p-2 shadow-lg">
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          className={arrow}
          aria-label="이전 달"
          disabled={prev < FIRST_CASE_DAY.slice(0, 6)}
          onClick={() => setMonth(prev)}
        >
          ‹
        </button>
        <b className="text-[13px] text-white">
          {y}년 {m}월
        </b>
        <button
          type="button"
          className={arrow}
          aria-label="다음 달"
          disabled={next > today.slice(0, 6)}
          onClick={() => setMonth(next)}
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {[..."일월화수목금토"].map((w, i) => (
          <span key={w} className={`py-0.5 text-[10px] ${i === 0 ? "text-[#F87171]/60" : "text-white/35"}`}>
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={`_${i}`} />;
          const off = d < FIRST_CASE_DAY || d > today;
          const on = d === day;
          return (
            <button
              key={d}
              type="button"
              disabled={off}
              onClick={() => onPick(d)}
              className={`relative flex aspect-square cursor-pointer items-center justify-center rounded-md font-mono text-[12px] tabular-nums disabled:cursor-default ${
                on
                  ? "bg-[#C9A15B] font-bold text-black"
                  : off
                    ? "text-white/15"
                    : `text-white/80 hover:bg-white/10 ${d === today ? "ring-1 ring-[#C9A15B]/70" : ""}`
              }`}
            >
              {+d.slice(6)}
              {!off && solved(d) && (
                <i
                  className={`absolute bottom-[3px] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${on ? "bg-black/70" : "bg-[#FDE68A]"}`}
                />
              )}
            </button>
          );
        })}
      </div>
      <p className="m-0 mt-1 text-center text-[10px] text-white/35">
        <i className="mr-1 inline-block h-1 w-1 rounded-full bg-[#FDE68A] align-middle" />이 난이도를 내가 푼 날
      </p>
    </div>
  );
}
