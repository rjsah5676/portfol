"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { claimDaily, getDaily } from "@/lib/api/points";
import {
  POINT,
  dailyMission,
  dailyOf,
  fmtPoint,
  type AchGame,
  type DailyMission,
  type DailyState,
} from "@/lib/points";
import PointInfo from "./PointInfo";

/*
 * 일일 미션 (게임 머리말의 [미션 · 업적] 버튼 → 모달의 「일일 미션」 탭). 한국 시간 자정에 새로.
 * 오늘 한 만큼은 서버가 셈 (lib/points.ts 의 DAILY_MISSIONS) — 하나씩 받거나 「모두 받기」.
 */

type Row = { m: DailyMission; s: DailyState };
const ready = (r: Row) => !r.s.got && r.s.value >= r.m.goal;

/** 한국 시간 자정까지 남은 시간 "3시간 12분" */
function untilReset(now = Date.now()) {
  const kst = now + 9 * 3600_000;
  const left = 86_400_000 - (kst % 86_400_000);
  const h = Math.floor(left / 3600_000);
  const m = Math.floor((left % 3600_000) / 60_000);
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

/** 받을 수 있는 일일 미션 수 (버튼 점 표시) — 로그인했을 때만, key 가 바뀌면 다시 셈 */
export function useDailyReady(game: AchGame | undefined, key: unknown) {
  const { profile } = useAuth();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!game || !profile) return;
    let live = true;
    getDaily(game)
      .then((r) => {
        if (!live) return;
        setN(r.list.filter((s) => !s.got && s.value >= (dailyMission(s.id)?.goal ?? Infinity)).length);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [game, profile, key]);
  return game && profile ? n : 0;
}

export function DailyMissionList({ game, accent = "#8B84FF" }: { game: AchGame; accent?: string }) {
  const { profile, login, setPoints, points } = useAuth();
  const [list, setList] = useState<DailyState[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const load = useCallback(() => {
    getDaily(game)
      .then((r) => {
        setList(r.list);
        if (r.points !== null) setPoints(r.points);
        setErr(false);
      })
      .catch(() => setErr(true));
  }, [game, setPoints]);
  useEffect(() => {
    load();
  }, [load, profile?.nick]);

  const rows: Row[] = (list ?? dailyOf(game).map((m) => ({ id: m.id, value: 0, got: false })))
    .map((s) => ({ m: dailyMission(s.id)!, s }))
    .filter((r) => r.m);
  const can = rows.filter(ready);
  const sum = can.reduce((t, r) => t + r.m.reward, 0);
  const got = rows.filter((r) => r.s.got).length;

  async function claim(id?: string) {
    setBusy(id ?? "all");
    setMsg(null);
    try {
      const r = await claimDaily(game, id);
      setPoints(r.points);
      setMsg(`+${fmtPoint(r.reward)} 받았어요${r.ids.length > 1 ? ` (미션 ${r.ids.length}개)` : ""}`);
      load();
    } catch (e) {
      setMsg((e as Error).message || "받지 못했어요. 잠시 뒤에 다시 해 주세요.");
      load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="font-['Nanum_Gothic',sans-serif]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
        {profile ? (
          <span className="flex items-center gap-1.5 text-sm text-white/70">
            내 {POINT.name}
            <b className="font-mono text-base text-[#FDE68A] tabular-nums">{fmtPoint(points ?? 0)}</b>
            <PointInfo align="left" />
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-sm break-keep text-white/60">
            로그인하면 매일 미션으로 {POINT.name}를 받을 수 있어요 <PointInfo align="left" />
          </span>
        )}
        <span className="font-mono text-xs whitespace-nowrap text-white/45">
          {got}/{rows.length} 완료 · {untilReset()} 뒤 새로
        </span>
      </div>
      {!profile ? (
        <button
          type="button"
          onClick={() => void login()}
          className="mb-3 w-full cursor-pointer rounded-lg border border-white/15 bg-white/[0.06] py-2 text-sm text-white hover:border-white/35"
        >
          Google로 로그인
        </button>
      ) : (
        <button
          type="button"
          disabled={!can.length || busy !== null}
          onClick={() => void claim()}
          className="mb-3 w-full cursor-pointer rounded-lg bg-[#FDE047] py-2 text-sm font-bold text-black hover:brightness-110 disabled:cursor-default disabled:bg-white/10 disabled:text-white/35"
        >
          {busy === "all" ? "받는 중…" : can.length ? `모두 받기 · ${can.length}개 +${fmtPoint(sum)}` : "모두 받기"}
        </button>
      )}
      {msg && <p className="mb-2 rounded-lg bg-[#FDE047]/10 px-3 py-1.5 text-center text-xs text-[#FDE68A]">{msg}</p>}
      {err && <p className="mb-2 text-center text-xs text-red-300">미션을 불러오지 못했어요.</p>}
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const { m, s } = row;
          const ok = ready(row);
          const now = Math.min(s.value, m.goal);
          return (
            <li
              key={m.id}
              className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border px-2.5 py-2 ${
                s.got
                  ? "border-white/5 bg-white/[0.02] opacity-60"
                  : ok
                    ? "border-[#FDE047]/35 bg-[#FDE047]/[0.06]"
                    : "border-white/8 bg-white/[0.03]"
              }`}
            >
              <span className="text-center text-xl" aria-hidden>
                {s.got ? "✅" : ok ? "🎁" : "📅"}
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <b className="text-sm break-keep text-white">{m.title}</b>
                  <span className="font-mono text-[11px] whitespace-nowrap text-[#FDE68A]/80">+{fmtPoint(m.reward)}</span>
                </span>
                {!s.got && (
                  <span className="mt-1 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${(now / m.goal) * 100}%`, background: ok ? "#FDE047" : accent }}
                      />
                    </span>
                    <span className="font-mono text-[10px] whitespace-nowrap text-white/45 tabular-nums">
                      {now.toLocaleString("ko-KR")}/{m.goal.toLocaleString("ko-KR")}
                    </span>
                  </span>
                )}
              </span>
              <span className="justify-self-end">
                {s.got ? (
                  <span className="text-[11px] whitespace-nowrap text-white/40">받음</span>
                ) : ok && profile ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void claim(m.id)}
                    className="cursor-pointer rounded-lg bg-[#FDE047] px-3 py-1.5 text-xs font-bold whitespace-nowrap text-black hover:brightness-110 disabled:opacity-50"
                  >
                    {busy === m.id ? "받는 중…" : "받기"}
                  </button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed break-keep text-white/35">
        미션은 매일 한국 시간 자정에 새로 시작해요. 오늘 사이트에 처음 들어온 뒤로 한 만큼 세고, 보상은 그날 안에 받아야 해요.
      </p>
    </div>
  );
}
