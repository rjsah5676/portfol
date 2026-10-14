"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import {
  claimAchievement,
  getAchRank,
  getAchievements,
} from "@/lib/api/points";
import {
  POINT,
  achievementOf,
  achievementsOf,
  claimableTimes,
  fmtPoint,
  type AchGame,
  type AchRankRow,
  type AchState,
  type Achievement,
} from "@/lib/points";
import PointInfo from "./PointInfo";
import RankList from "@/components/RankList";

/*
 * 업적 (게임 머리말의 [업적] 버튼 → 모달 안). 게임마다 같은 모양.
 * 숫자는 서버가 기록으로 계산하고, 받기도 서버가 다시 확인함 (lib/points.ts 의 ACHIEVEMENTS).
 */

const EOK = 100_000_000;
const MAN = 10_000;
/** 칩 같은 큰 숫자: 12억 3,400만 → "12.3억", 3,400만 → "3,400만" */
function fmtChips(n: number) {
  if (n >= EOK)
    return `${(Math.floor((n / EOK) * 10) / 10).toLocaleString("ko-KR")}억`;
  if (n >= MAN) return `${Math.floor(n / MAN).toLocaleString("ko-KR")}만`;
  return n.toLocaleString("ko-KR");
}
const fmtVal = (a: Achievement, v: number) =>
  a.fmt === "chips" ? fmtChips(v) : Math.floor(v).toLocaleString("ko-KR");

type Row = { a: Achievement; s: AchState };

export function AchievementList({
  game,
  accent = "#8B84FF",
}: {
  game: AchGame;
  accent?: string;
}) {
  const { profile, login, setPoints, points } = useAuth();
  const [list, setList] = useState<AchState[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const load = useCallback(() => {
    getAchievements(game)
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

  const rows: Row[] = (
    list ??
    achievementsOf(game).map((a) => ({ id: a.id, value: 0, claimedAt: null }))
  )
    .map((s) => ({ a: achievementOf(s.id)!, s }))
    .filter((r) => r.a);
  const done = (r: Row) => claimableTimes(r.a, r.s) > 0;
  /** 다음 보상까지 얼마나 했는지 (반복형은 이번 칸 안에서) */
  const prog = (r: Row) =>
    r.a.repeat
      ? done(r)
        ? r.a.goal
        : r.s.value - (r.s.times ?? 0) * r.a.goal
      : Math.min(r.s.value, r.a.goal);
  // 받을 수 있는 것 → 반복형 → 진행 중(많이 한 순) → 받은 것
  const order = (r: Row) => (r.s.claimedAt ? 3 : done(r) ? 0 : r.a.repeat ? 1 : 2);
  rows.sort((x, y) => order(x) - order(y) || prog(y) / y.a.goal - prog(x) / x.a.goal);
  const ready = rows.filter(done).length;
  const once = rows.filter((r) => !r.a.repeat);
  const got = once.filter((r) => r.s.claimedAt).length;

  async function claim(id: string) {
    setBusy(id);
    setMsg(null);
    try {
      const r = await claimAchievement(id);
      setPoints(r.points);
      setMsg(`+${fmtPoint(r.reward)} 받았어요`);
      load();
    } catch (e) {
      setMsg(
        (e as Error).message || "받지 못했어요. 잠시 뒤에 다시 해 주세요.",
      );
    } finally {
      setBusy(null);
    }
  }

  /** 받을 수 있는 것 전부 (하나씩 서버에 받기 — 서버가 매번 다시 확인) */
  async function claimAll() {
    setBusy("*");
    setMsg(null);
    let sum = 0;
    let n = 0;
    for (const r of rows.filter(done)) {
      try {
        const res = await claimAchievement(r.a.id);
        setPoints(res.points);
        sum += res.reward;
        n++;
      } catch {
        // 그새 받은 것 등은 건너뜀
      }
    }
    setMsg(
      n
        ? `업적 ${n}개 · +${fmtPoint(sum)} 받았어요`
        : "받지 못했어요. 잠시 뒤에 다시 해 주세요.",
    );
    setBusy(null);
    load();
  }

  return (
    <div className="font-['Nanum_Gothic',sans-serif]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
        {profile ? (
          <span className="flex items-center gap-1.5 text-sm text-white/70">
            내 {POINT.name}
            <b className="font-mono text-base text-[#FDE68A] tabular-nums">
              {fmtPoint(points ?? 0)}
            </b>
            <PointInfo align="left" />
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-sm break-keep text-white/60">
            로그인하면 업적을 모아 {POINT.name}를 받을 수 있어요{" "}
            <PointInfo align="left" />
          </span>
        )}
        <span className="font-mono text-xs whitespace-nowrap text-white/45">
          {got}/{once.length} 달성
          {ready > 0 && (
            <b className="ml-1.5 text-[#FDE68A]">
              · 받을 수 있는 업적 {ready}개
            </b>
          )}
        </span>
        {profile && ready > 1 && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void claimAll()}
            className="w-full cursor-pointer rounded-lg bg-[#FDE047] py-2 text-xs font-bold text-black hover:brightness-110 disabled:opacity-50"
          >
            {busy === "*" ? "받는 중…" : `모두 받기 (${ready}개)`}
          </button>
        )}
      </div>
      {!profile && (
        <button
          type="button"
          onClick={() => void login()}
          className="mb-3 w-full cursor-pointer rounded-lg border border-white/15 bg-white/[0.06] py-2 text-sm text-white hover:border-white/35"
        >
          Google로 로그인
        </button>
      )}
      {msg && (
        <p className="mb-2 rounded-lg bg-[#FDE047]/10 px-3 py-1.5 text-center text-xs text-[#FDE68A]">
          {msg}
        </p>
      )}
      {err && (
        <p className="mb-2 text-center text-xs text-red-300">
          업적을 불러오지 못했어요.
        </p>
      )}
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const { a, s } = row;
          const k = claimableTimes(a, s);
          const ok = k > 0;
          const now = prog(row);
          const pct = Math.min(100, (now / a.goal) * 100);
          return (
            <li
              key={a.id}
              className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border px-2.5 py-2 ${
                s.claimedAt
                  ? "border-white/5 bg-white/[0.02] opacity-60"
                  : ok
                    ? "border-[#FDE047]/35 bg-[#FDE047]/[0.06]"
                    : "border-white/8 bg-white/[0.03]"
              }`}
            >
              <span className="text-center text-xl" aria-hidden>
                {s.claimedAt ? "✅" : ok ? "🎁" : a.repeat ? "🔁" : "🏅"}
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <b className="text-sm break-keep text-white">{a.title}</b>
                  <span className="font-mono text-[11px] whitespace-nowrap text-[#FDE68A]/80">
                    +{fmtPoint(a.reward)}
                  </span>
                  {a.repeat && (
                    <span className="rounded-full border border-[#8B84FF]/40 px-1.5 text-[10px] whitespace-nowrap text-[#B9B4FF]">
                      반복{s.times ? ` · ${s.times}회 받음` : ""}
                    </span>
                  )}
                </span>
                <span className="block text-xs break-keep text-white/50">
                  {a.desc}
                </span>
                {!s.claimedAt && (
                  <span className="mt-1 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          background: ok ? "#FDE047" : accent,
                        }}
                      />
                    </span>
                    <span className="font-mono text-[10px] whitespace-nowrap text-white/45 tabular-nums">
                      {fmtVal(a, now)}/{fmtVal(a, a.goal)}
                    </span>
                  </span>
                )}
              </span>
              <span className="justify-self-end">
                {s.claimedAt ? (
                  <span className="text-[11px] whitespace-nowrap text-white/40">
                    받음
                  </span>
                ) : ok && profile ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void claim(a.id)}
                    className="cursor-pointer rounded-lg bg-[#FDE047] px-3 py-1.5 text-xs font-bold whitespace-nowrap text-black hover:brightness-110 disabled:opacity-50"
                  >
                    {busy === a.id ? "받는 중…" : k > 1 ? `받기 ×${k}` : "받기"}
                  </button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed break-keep text-white/35">
        업적 보상은 직접 「받기」를 눌러야 들어와요. 매일 받는 보상은 「일일 미션」 탭에 있어요. {POINT.name}는 현금으로
        사거나 바꿀 수 없는 사이트 전용 재화예요.{" "}
        <Link
          href="/faq/#points"
          className="text-white/55 underline underline-offset-2 hover:text-white"
        >
          자주 묻는 질문
        </Link>
      </p>
    </div>
  );
}

/** 업적 랭킹 (그 게임 업적으로 받은 포인트 합) — 랭킹 모달의 「업적 랭킹」 탭 */
export function AchievementRank({ game }: { game: AchGame }) {
  const { profile } = useAuth();
  const [rows, setRows] = useState<AchRankRow[] | null>(null);
  useEffect(() => {
    getAchRank(game)
      .then(setRows)
      .catch(() => setRows([]));
  }, [game]);
  if (!rows)
    return (
      <p className="py-6 text-center font-mono text-xs text-white/30">
        불러오는 중…
      </p>
    );
  const me = profile ? rows.findIndex((r) => r.nick === profile.nick) : -1;
  return (
    <div>
      <p className="mb-2 font-['Nanum_Gothic',sans-serif] text-xs break-keep text-white/40">
        이 게임 업적으로 받은 {POINT.name}가 많은 순 (같으면 먼저 모은 사람)
      </p>
      <RankList
        rows={rows.map((r) => ({
          name: r.nick,
          member: true,
          avatar: r.avatar,
          value: fmtPoint(r.points),
          sub: `업적 ${r.count}개`,
          date: r.at ? new Date(r.at) : null,
        }))}
        highlight={me >= 0 ? me : undefined}
        empty="아직 업적을 받은 사람이 없어요"
      />
    </div>
  );
}
