"use client";

import { useEffect, useRef, useState } from "react";
import { recordVisit, getVisitorStats, type VisitorStats } from "@/firestore/siteStats";

const TZ = "Asia/Seoul";
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

// KST 기준 날짜 부품 (방문자 일자 키/달력/시계 모두 한국 시간 기준)
function kstParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hh: get("hour"),
    mm: get("minute"),
    ss: get("second"),
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

const cardClass = "flex flex-col rounded-xl border border-white/10 bg-[#1C1E24] p-4";
const labelClass = "mb-3 font-mono text-xs text-[#8B84FF]";

function VisitorCard() {
  const [stats, setStats] = useState<VisitorStats | null>(null);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // StrictMode(dev) 이중 실행 방지
    if (started.current) return;
    started.current = true;

    const { dateKey } = kstParts(new Date());
    // 같은 브라우저는 하루 1회만 카운트
    const flagKey = `gm-visited-${dateKey}`;
    let alreadyCounted = false;
    try {
      alreadyCounted = localStorage.getItem(flagKey) === "1";
      if (!alreadyCounted) localStorage.setItem(flagKey, "1");
    } catch {
      // 스토리지 막힌 환경이면 그냥 매번 카운트 시도
    }

    (async () => {
      try {
        if (!alreadyCounted) await recordVisit(dateKey).catch(() => undefined);
        setStats(await getVisitorStats(dateKey));
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  const fmt = (n?: number) =>
    n === undefined ? (failed ? "-" : "···") : n.toLocaleString("ko-KR");

  return (
    <div className={cardClass}>
      <div className={labelClass}>visitors</div>
      <div className="flex flex-1 items-center justify-around gap-4">
        <div className="text-center">
          <div className="font-mono text-2xl font-bold text-white">{fmt(stats?.today)}</div>
          <div className="mt-1 font-mono text-[11px] tracking-wider text-white/40">TODAY</div>
        </div>
        <div className="h-10 w-px bg-white/10" />
        <div className="text-center">
          <div className="font-mono text-2xl font-bold text-white/80">{fmt(stats?.total)}</div>
          <div className="mt-1 font-mono text-[11px] tracking-wider text-white/40">TOTAL</div>
        </div>
      </div>
    </div>
  );
}

function ClockCard({ now }: { now: Date | null }) {
  const p = now ? kstParts(now) : null;
  // KST 정오 기준으로 요일 계산 (자정 경계 오차 방지)
  const weekday = p ? WEEK[new Date(`${p.dateKey}T12:00:00+09:00`).getUTCDay()] : "";

  return (
    <div className={cardClass}>
      <div className={labelClass}>now · KST</div>
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="font-mono text-3xl font-bold tracking-tight text-white tabular-nums">
          {p ? `${p.hh}:${p.mm}` : "--:--"}
          <span className="text-lg text-white/40">{p ? `:${p.ss}` : ":--"}</span>
        </div>
        <div className="mt-1 font-mono text-xs text-white/40">
          {p
            ? `${p.year}.${String(p.month).padStart(2, "0")}.${String(p.day).padStart(2, "0")} (${weekday})`
            : "\u00a0"}
        </div>
      </div>
    </div>
  );
}

function CalendarCard({ now }: { now: Date | null }) {
  const p = now ? kstParts(now) : null;

  let cells: (number | null)[] = [];
  if (p) {
    // 해당 월 1일의 요일(KST 정오 기준으로 계산해서 경계 오차 방지)
    const firstDow = new Date(
      `${p.year}-${String(p.month).padStart(2, "0")}-01T12:00:00+09:00`
    ).getUTCDay();
    const daysInMonth = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
    cells = [
      ...Array(firstDow).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
  }

  return (
    <div className={cardClass}>
      <div className="mb-3 flex items-baseline justify-between">
        <span className="font-mono text-xs text-[#8B84FF]">calendar</span>
        <span className="font-mono text-xs text-white/50">
          {p ? `${p.year}.${String(p.month).padStart(2, "0")}` : ""}
        </span>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center font-mono text-[11px]">
        {WEEK.map((w, i) => (
          <div
            key={w}
            className={i === 0 ? "text-red-400/60" : i === 6 ? "text-sky-400/60" : "text-white/30"}
          >
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          const isToday = d !== null && d === p?.day;
          const dow = i % 7;
          return (
            <div key={i} className="flex items-center justify-center">
              {d !== null && (
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full ${
                    isToday
                      ? "bg-[#6C63FF] font-bold text-white"
                      : dow === 0
                        ? "text-red-400/70"
                        : dow === 6
                          ? "text-sky-400/70"
                          : "text-white/60"
                  }`}
                >
                  {d}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function FooterWidgets() {
  // 정적 빌드 시점의 시간이 박히지 않게 마운트 후에만 시간 세팅
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 정적 빌드 시각이 박히지 않게 마운트 후 세팅
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-3 px-6 sm:grid-cols-3">
      <VisitorCard />
      <CalendarCard now={now} />
      <ClockCard now={now} />
    </div>
  );
}
