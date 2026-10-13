"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getMyPoints } from "@/lib/api/points";
import {
  ATTEND_POINTS,
  POINT,
  fmtPoint,
  pointReason,
  type PointLogRow,
} from "@/lib/points";
import PointInfo from "./PointInfo";

/** 마이페이지 · 포인트 칸: 잔액 · 오늘 출석 · 모으는 법 · 쓰는 곳 · 최근 내역 */
export default function MyPoints({
  card,
  label,
}: {
  card: string;
  label: string;
}) {
  const { points, setPoints } = useAuth();
  const [data, setData] = useState<{
    attendedToday: boolean;
    log: PointLogRow[];
  } | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    getMyPoints()
      .then((r) => {
        setData(r);
        setPoints(r.points);
      })
      .catch(() => setData({ attendedToday: false, log: [] }));
  }, [setPoints]);

  const log = data?.log ?? [];
  const shown = more ? log : log.slice(0, 5);
  return (
    <section id="points" className={`${card} scroll-mt-28`}>
      <div className={`${label} flex items-center gap-1.5`}>
        {POINT.name} <PointInfo align="left" />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="font-mono text-3xl font-bold text-[#FDE68A] tabular-nums">
          {fmtPoint(points ?? 0)}
        </div>
        {data && (
          <span className="font-['Nanum_Gothic',sans-serif] text-xs text-white/45">
            {data.attendedToday
              ? `오늘 출석 ${fmtPoint(ATTEND_POINTS)} 받음 ✓ · 내일 또 받을 수 있어요`
              : `오늘 출석 ${fmtPoint(ATTEND_POINTS)}는 사이트에 들어오면 들어와요`}
          </span>
        )}
      </div>
      <div className="mt-4 grid gap-2 font-['Nanum_Gothic',sans-serif] text-[13px] break-keep text-white/65 sm:grid-cols-2">
        <div className="rounded-xl bg-white/[0.03] px-3 py-2.5">
          <b className="text-white/85">모으는 법</b>
          <ul className="mt-1 list-disc pl-4 text-xs leading-relaxed text-white/55">
            <li>매일 첫 접속 출석 {fmtPoint(ATTEND_POINTS)}</li>
            <li>게임 업적 달성 (게임 화면 위 🏅 업적)</li>
            <li>ANIME POKER 상점 「환전」에서 칩으로</li>
          </ul>
        </div>
        <div className="rounded-xl bg-white/[0.03] px-3 py-2.5">
          <b className="text-white/85">쓰는 곳</b>
          <ul className="mt-1 list-disc pl-4 text-xs leading-relaxed text-white/55">
            <li>
              <Link
                href="/games/poker"
                className="underline underline-offset-2 hover:text-white"
              >
                ANIME POKER
              </Link>{" "}
              캐릭터 · 스킨, 칩 환전
            </li>
            <li>다른 게임 상점도 차례로 열려요</li>
          </ul>
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-1.5 font-mono text-[11px] text-white/35">
          최근 내역
        </div>
        {!data ? (
          <p className="text-xs text-white/30">불러오는 중…</p>
        ) : !log.length ? (
          <p className="font-['Nanum_Gothic',sans-serif] text-xs text-white/35">
            아직 내역이 없어요.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-white/5 font-['Nanum_Gothic',sans-serif] text-[13px]">
            {shown.map((r, i) => (
              <li key={i} className="flex items-center gap-3 py-1.5">
                <span className="w-[4.5rem] shrink-0 font-mono text-[11px] text-white/30 tabular-nums">
                  {new Date(r.at).toLocaleDateString("ko-KR", {
                    month: "2-digit",
                    day: "2-digit",
                  })}
                </span>
                <span className="min-w-0 flex-1 truncate text-white/70">
                  {pointReason(r)}
                </span>
                <span
                  className={`shrink-0 font-mono tabular-nums ${r.delta >= 0 ? "text-[#FDE68A]" : "text-white/45"}`}
                >
                  {r.delta >= 0 ? "+" : ""}
                  {fmtPoint(r.delta)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {log.length > 5 && (
          <button
            type="button"
            onClick={() => setMore((m) => !m)}
            className="mt-1 cursor-pointer font-mono text-[11px] text-white/40 hover:text-white"
          >
            {more ? "접기" : `더 보기 (${log.length})`}
          </button>
        )}
      </div>
      <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-[11px] leading-relaxed break-keep text-white/35">
        {POINT.name}는 현금으로 사거나 바꿀 수 없고, 다른 회원에게 줄 수 없는
        사이트 전용 재화예요.{" "}
        <Link
          href="/faq/#points"
          className="text-white/55 underline underline-offset-2 hover:text-white"
        >
          자주 묻는 질문
        </Link>
      </p>
    </section>
  );
}
