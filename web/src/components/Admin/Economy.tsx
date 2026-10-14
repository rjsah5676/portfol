"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getEconomy,
  getEconomyLog,
  type Economy as EconomyData,
  type EconomyRow,
} from "@/firestore/adminData";
import { POINT, fmtPoint, pointReason } from "@/lib/points";
import { ago } from "./Overview";

/*
 * 관리자 · GP 경제: 지금 풀린 GP 와 기간 동안 어디서 들어오고 어디로 나갔는지, 사이트 전체 원장.
 * 숫자가 갑자기 튀면(지급만 늘거나 한 사람에게 몰림) 원장에서 사유 · 별명으로 좁혀 봄.
 */

const KR = "font-['Nanum_Gothic',sans-serif]";
const panel = "rounded-2xl border border-white/10 bg-[#1C1E24] p-5";
const heading = "mb-4 font-mono text-xs text-[#8B84FF]";
const chip = (on: boolean) =>
  `cursor-pointer rounded-full border px-3 py-1 font-mono text-xs whitespace-nowrap transition-colors ${
    on
      ? "border-[#6C63FF] bg-[#6C63FF]/15 text-white"
      : "border-white/10 text-white/50 hover:border-white/30 hover:text-white/80"
  }`;
const IN = "#FDE68A";
const OUT = "#F472B6";

/** 원장 사유(reason) → 묶음 이름 */
const REASON: Record<string, string> = {
  attend: "출석",
  ach: "업적",
  daily: "일일 미션",
  buy: "상점 구매",
  exchange: "포커 환전",
  admin: "운영자 조정",
  mail: "우편",
  defense: "디펜스",
};
const reasonName = (r: string) => REASON[r] ?? r;
const n = (v: number) => v.toLocaleString("ko-KR");

function Tile({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className={panel}>
      <div className={`text-xs text-white/45 ${KR}`}>{label}</div>
      <div
        className="mt-2 font-mono text-2xl font-bold tabular-nums"
        style={{ color: color ?? "#fff" }}
      >
        {value}
      </div>
      {sub && (
        <div className={`mt-1 text-[11px] text-white/35 ${KR}`}>{sub}</div>
      )}
    </div>
  );
}

export default function Economy() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<EconomyData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getEconomy(days)
      .then((d) => live && (setData(d), setFailed(false)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [days]);

  const sumIn = data?.reasons.reduce((a, r) => a + r.in, 0) ?? 0;
  const sumOut = data?.reasons.reduce((a, r) => a + r.out, 0) ?? 0;
  const dayMax = Math.max(
    1,
    ...(data?.daily ?? []).map((d) => Math.max(d.in, d.out)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {[1, 7, 30, 90].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            className={chip(days === d)}
          >
            {d === 1 ? "오늘" : `${d}일`}
          </button>
        ))}
        {failed && (
          <span className={`text-xs text-red-300 ${KR}`}>
            불러오지 못했어요
          </span>
        )}
        {data?.truncated && (
          <span className={`text-xs text-white/40 ${KR}`}>
            원장이 너무 많아 최근 5만 줄만 셌어요
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile
          label={`풀린 ${POINT.name} (회원 잔액 합)`}
          value={data ? fmtPoint(data.total) : "…"}
          color={IN}
        />
        <Tile
          label={`${POINT.name} 가진 회원`}
          value={data ? `${n(data.withPoints)}명` : "…"}
          sub={data ? `전체 회원 ${n(data.members)}명` : undefined}
        />
        <Tile
          label="기간 동안 들어간 것"
          value={data ? (sumIn ? `+${n(sumIn)}` : "0") : "…"}
          color={IN}
        />
        <Tile
          label="기간 동안 쓴 것"
          value={data ? (sumOut ? `−${n(sumOut)}` : "0") : "…"}
          color={OUT}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* 날짜별 */}
        <section className={panel}>
          <div className={`${heading} flex items-center justify-between`}>
            날짜별 들어감 · 씀
            <span className="flex items-center gap-3 text-white/45">
              <span className="flex items-center gap-1">
                <i
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ background: IN }}
                />{" "}
                들어감
              </span>
              <span className="flex items-center gap-1">
                <i
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ background: OUT }}
                />{" "}
                씀
              </span>
            </span>
          </div>
          <div className="flex h-36 items-end gap-[3px]">
            {(data?.daily ?? []).map((d) => (
              <div
                key={d.date}
                className="flex h-full min-w-0 flex-1 items-end justify-center gap-[1px]"
                title={`${d.date} · +${n(d.in)} / −${n(d.out)}`}
              >
                <span
                  className="w-1/2 max-w-3 rounded-t-sm"
                  style={{
                    height: `${(d.in / dayMax) * 100}%`,
                    background: IN,
                  }}
                />
                <span
                  className="w-1/2 max-w-3 rounded-t-sm"
                  style={{
                    height: `${(d.out / dayMax) * 100}%`,
                    background: OUT,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[10px] text-white/30">
            <span>{data?.daily[0]?.date.slice(5).replace("-", ".")}</span>
            <span>오늘</span>
          </div>
        </section>

        {/* 많이 가진 회원 */}
        <section className={panel}>
          <div className={heading}>많이 가진 회원</div>
          {data && data.top.length === 0 && (
            <p className={`text-sm text-white/35 ${KR}`}>아직 없어요</p>
          )}
          <ol className="flex flex-col">
            {data?.top.map((u, i) => (
              <li key={u.uid} className="flex items-baseline gap-3 py-1.5">
                <span className="w-5 font-mono text-xs text-white/35">
                  {i + 1}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate text-sm text-white/80 ${KR}`}
                >
                  {u.nick}
                </span>
                <span className="font-mono text-sm text-[#FDE68A] tabular-nums">
                  {n(u.points)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {/* 사유별 */}
      <section className={panel}>
        <div className={heading}>어디서 들어오고 어디로 나갔나</div>
        {data && data.reasons.length === 0 ? (
          <p className={`text-sm text-white/35 ${KR}`}>
            이 기간에는 움직임이 없어요
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={`text-left text-[11px] text-white/35 ${KR}`}>
                  <th className="py-1.5 font-normal">사유</th>
                  <th className="py-1.5 text-right font-normal">들어감</th>
                  <th className="py-1.5 text-right font-normal">씀</th>
                  <th className="py-1.5 text-right font-normal">건수</th>
                </tr>
              </thead>
              <tbody>
                {data?.reasons.map((r) => (
                  <tr key={r.reason} className="border-t border-white/[0.06]">
                    <td className={`py-2 text-white/80 ${KR}`}>
                      {reasonName(r.reason)}
                    </td>
                    <td className="py-2 text-right font-mono text-[#FDE68A] tabular-nums">
                      {r.in ? `+${n(r.in)}` : ""}
                    </td>
                    <td className="py-2 text-right font-mono text-[#F472B6] tabular-nums">
                      {r.out ? `−${n(r.out)}` : ""}
                    </td>
                    <td className="py-2 text-right font-mono text-white/50 tabular-nums">
                      {n(r.n)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Ledger reasons={data?.reasons.map((r) => r.reason) ?? []} />
    </div>
  );
}

/** 사이트 전체 원장 (최신순) — 사유 · 별명으로 거르기 */
function Ledger({ reasons }: { reasons: string[] }) {
  const [reason, setReason] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<EconomyRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const load = useCallback(
    async (reset: boolean, skip: number, reason: string, q: string) => {
      const mine = ++seq.current;
      setBusy(true);
      try {
        const r = await getEconomyLog({ reason, q: q.trim(), skip });
        if (mine !== seq.current) return;
        setRows((cur) => (reset ? r.rows : [...(cur ?? []), ...r.rows]));
        setMore(r.more);
      } catch {
        if (mine === seq.current && reset) setRows([]);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    },
    [],
  );
  useEffect(() => {
    const t = setTimeout(() => void load(true, 0, reason, q), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [reason, q, load]);

  return (
    <section className={panel}>
      <div className={heading}>원장 (사이트 전체)</div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="별명 그대로 (또는 uid)"
          className={`min-w-0 flex-1 rounded-full border border-white/10 bg-[#121212] px-4 py-2 text-sm text-white placeholder:text-white/30 focus:border-[#6C63FF]/60 focus:outline-none ${KR}`}
        />
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setReason("")}
          className={chip(reason === "")}
        >
          전체
        </button>
        {[...new Set([...Object.keys(REASON), ...reasons])].map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReason(r)}
            className={chip(reason === r)}
          >
            {reasonName(r)}
          </button>
        ))}
      </div>
      {rows && rows.length === 0 ? (
        <p className={`py-8 text-center text-sm text-white/35 ${KR}`}>
          {busy ? "불러오는 중…" : "내역이 없어요"}
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows?.map((x, i) => (
            <li
              key={`${x.at}-${x.uid}-${i}`}
              className="flex items-center gap-3 border-t border-white/[0.06] py-2 first:border-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`min-w-0 truncate text-sm text-white/85 ${KR}`}
                  >
                    {x.nick}
                  </span>
                  <span
                    className="shrink-0 font-mono text-[11px] text-white/30"
                    title={new Date(x.at).toLocaleString("ko-KR")}
                  >
                    {ago(x.at)}
                  </span>
                </div>
                <div className={`truncate text-xs text-white/45 ${KR}`}>
                  {pointReason(x)}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div
                  className={`font-mono text-sm tabular-nums ${x.delta > 0 ? "text-[#FDE68A]" : "text-[#F472B6]"}`}
                >
                  {x.delta > 0 ? "+" : "−"}
                  {n(Math.abs(x.delta))}
                </div>
                {x.bal !== undefined && (
                  <div className="font-mono text-[11px] text-white/30 tabular-nums">
                    잔액 {n(x.bal)}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {more && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void load(false, rows?.length ?? 0, reason, q)}
          className={`mt-3 w-full cursor-pointer rounded-full border border-white/15 py-2 text-xs text-white/60 hover:border-[#6C63FF]/60 hover:text-white disabled:opacity-40 ${KR}`}
        >
          {busy ? "불러오는 중…" : "더 보기"}
        </button>
      )}
    </section>
  );
}
