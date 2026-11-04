"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { RankSpec } from "@/components/GameHeader";
import RankList from "@/components/RankList";
import { dayLabel, FIRST_DAY, kstDay, shiftDay, weekdayOf } from "@/lib/melon/logic";
import {
  getMelonRanking,
  getMelonSummary,
  type MelonScore,
  type MelonSummary,
} from "@/firestore/melonGame";

/*
 * 멜론게임 랭킹 창 (오늘의 용의자와 같은 틀)
 *  - 데일리: 날짜(‹ › · 달력)를 골라 그날 순위 + 요약(한 사람 · 중간 · 평균) + 내 순위. 머리말 버튼 1~3위는 오늘 데일리
 *  - 통합: 날짜 상관없이 사람마다 역대 최고 점수
 * 기록은 한 번 올리면 둘 다 반영 (server: BOARDS.score.daily)
 */

type View = "day" | "all";

/** key 가 바뀌거나 tick 이 오르면 다시 받음. 실패하면 null (빈 목록으로 보여 줌) */
function useLoad<T>(
  key: string | null,
  load: (k: string) => Promise<T>,
  tick: number,
  init: Record<string, T | null> = {}
) {
  const [got, setGot] = useState<Record<string, T | null>>(init);
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

const loadRows = (b: string) => getMelonRanking(b, 50);
const loadSummary = (b: string) => getMelonSummary(b);

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const hhmm = (d: Date | null) =>
  d ? `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}` : "";
const fullDay = (d: string) => `${dayLabel(d)} (${weekdayOf(d)})`;
const pts = (n: number) => `${n}점`;

const GREEN = "#7ED957";
const pill = (on: boolean) =>
  `cursor-pointer rounded-full border px-3 py-1 text-xs whitespace-nowrap ${
    on
      ? "border-[#7ED957] bg-[#7ED957]/15 font-bold text-white"
      : "border-white/10 text-white/55 hover:text-white"
  }`;
const arrow =
  "flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/10 text-white/70 hover:text-white disabled:cursor-default disabled:opacity-25";

/** init = 서버가 미리 읽어 둔 그날 데일리 (games/melongame/layout.tsx) */
export function useMelonRank(init?: { day: string; rows: MelonScore[] } | null) {
  const [today, setToday] = useState(() => init?.day ?? kstDay());
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("day");
  const [date, setDate] = useState(today);
  const [tick, setTick] = useState(0);
  /** 다시 받기 (자정이 지났으면 오늘도 바꿈) */
  const reload = useCallback(() => {
    setToday(kstDay());
    setTick((t) => t + 1);
  }, []);

  // 자정이 지나 오늘이 바뀌면 보던 날짜가 미래가 되지 않게
  const day = date > today ? today : date;
  const b = view === "day" ? day : "all";
  // 오늘 데일리는 머리말 버튼(1~3위) · 「10위 안」 판단에도 쓰여서 늘 받음. 나머지는 창을 열었을 때만
  const todayRows = useLoad<MelonScore[]>(
    today,
    loadRows,
    tick,
    init ? { [init.day]: init.rows } : undefined
  );
  const otherRows = useLoad<MelonScore[]>(open && b !== today ? b : null, loadRows, tick);
  const rows = b === today ? todayRows : otherRows;
  const sum = useLoad<MelonSummary>(open ? b : null, loadSummary, tick);
  const list = rows ?? [];

  const openRank = (v: View = "day") => {
    setView(v);
    setDate(kstDay());
    reload();
    setOpen(true);
  };

  const top = (xs: MelonScore[]) =>
    xs
      .slice(0, 3)
      .map((r) => ({ name: r.name, member: r.member, avatar: r.avatar, value: pts(r.score) }));

  const spec: RankSpec = {
    top: todayRows ? top(todayRows) : null,
    podium: top(list),
    sub: view === "day" ? `데일리 · ${fullDay(day)}` : "통합 · 역대 최고 점수",
    open,
    onOpenChange: (o) => {
      if (o) reload();
      setOpen(o);
    },
    head: () => (
      <div className="mb-3 flex flex-col gap-2.5 font-['Nanum_Gothic',sans-serif]">
        <div
          role="tablist"
          className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1 text-sm"
        >
          {(
            [
              ["day", "📅 데일리"],
              ["all", "🏛️ 통합"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={view === k}
              onClick={() => setView(k)}
              className={`cursor-pointer rounded-lg py-1.5 transition-colors ${
                view === k
                  ? "bg-white/12 font-bold text-white"
                  : "text-white/50 hover:text-white/80"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === "day" && <DayPicker day={day} today={today} onPick={setDate} />}

        <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1.5 text-center">
          {(
            [
              [view === "day" ? "한 사람" : "참여한 사람", sum ? `${sum.total}명` : "–"],
              ["중간 점수", sum?.median != null ? pts(sum.median) : "–"],
              ["평균 점수", sum?.avg != null ? pts(sum.avg) : "–"],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="min-w-0 px-0.5">
              <div className="truncate text-[10.5px] text-white/45">{k}</div>
              <div className="font-mono text-[15px] leading-tight font-bold text-white tabular-nums">
                {v}
              </div>
            </div>
          ))}
        </div>

        {sum?.me ? (
          <MeBar>
            내 기록 <b className="text-white">{sum.me.pos}위</b>
            <span className="text-white/45"> / {sum.total}명</span>
            {sum.total >= 3 && (
              <span style={{ color: GREEN }}>
                {" "}
                · 상위 {Math.max(1, pct(sum.me.pos, sum.total))}%
              </span>
            )}
            <span className="text-white/60"> · {pts(sum.me.score)}</span>
          </MeBar>
        ) : (
          sum && (
            <MeBar dim>
              {view === "all"
                ? "아직 내 기록이 없어요 · 한 판 하면 올라가요"
                : day === today
                  ? "아직 오늘 기록이 없어요 · 오늘 안에 하면 올라가요"
                  : "이날은 내 기록이 없어요"}
            </MeBar>
          )
        )}
        <p className="m-0 text-center text-[11px] text-white/40">
          {view === "day"
            ? "날짜(한국 시간)마다 하루 중 가장 높은 점수만 · 오른쪽은 기록한 시각"
            : "사람마다 역대 가장 높은 점수만 · 오른쪽은 기록한 날"}
        </p>
      </div>
    ),
    render: () => (
      <RankList
        menu={false}
        rows={list.map((r) => ({
          name: r.name,
          member: r.member,
          avatar: r.avatar,
          value: pts(r.score),
          ...(view === "day" ? { when: hhmm(r.createdAt) } : { date: r.createdAt }),
        }))}
        highlight={sum?.me ? list.findIndex((r) => r.id === sum.me!.id) : undefined}
        skip={3}
        empty={
          rows
            ? view === "day" && day === today
              ? "아직 오늘 기록이 없어요. 첫 번째로 올려 보세요!"
              : "기록이 없어요."
            : "불러오는 중…"
        }
      />
    ),
  };

  return { spec, openRank, reload, todayRows };
}

function MeBar({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return (
    <div
      className={`rounded-lg border px-3 py-1.5 text-center text-[12.5px] break-keep ${
        dim
          ? "border-dashed border-white/10 text-white/40"
          : "border-[#7ED957]/40 bg-[#7ED957]/10 text-white/80"
      }`}
    >
      {children}
    </div>
  );
}

// ───────────────────────── 날짜 고르기 ─────────────────────────

/** ‹ 11월 4일 (수) › — 가운데를 누르면 달력 */
function DayPicker({
  day,
  today,
  onPick,
}: {
  day: string;
  today: string;
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
          disabled={day <= FIRST_DAY}
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
          <span
            className={`text-[10px] text-white/40 transition-transform ${cal ? "rotate-180" : ""}`}
          >
            ▼
          </span>
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
  onPick,
}: {
  /** "YYYYMM" */
  month: string;
  setMonth: (m: string) => void;
  day: string;
  today: string;
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
          disabled={prev < FIRST_DAY.slice(0, 6)}
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
          <span
            key={w}
            className={`py-0.5 text-[10px] ${i === 0 ? "text-[#F87171]/60" : "text-white/35"}`}
          >
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={`_${i}`} />;
          const off = d < FIRST_DAY || d > today;
          const on = d === day;
          return (
            <button
              key={d}
              type="button"
              disabled={off}
              onClick={() => onPick(d)}
              className={`flex aspect-square cursor-pointer items-center justify-center rounded-md font-mono text-[12px] tabular-nums disabled:cursor-default ${
                on
                  ? "bg-[#7ED957] font-bold text-black"
                  : off
                    ? "text-white/15"
                    : `text-white/80 hover:bg-white/10 ${d === today ? "ring-1 ring-[#7ED957]/70" : ""}`
              }`}
            >
              {+d.slice(6)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
