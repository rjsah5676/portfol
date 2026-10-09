"use client";

import { useEffect, useState } from "react";
import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import FightGame from "@/components/Fight/FightGame";
import { FIGHT_GUIDE } from "@/data/gameGuides";
import {
  getFightRatings,
  getRankStats,
  ratingSub,
  MATCHUP_MIN,
  tierOf,
  type FightRatingRow,
  type RankStats,
} from "@/firestore/fightRating";
import RankList from "@/components/RankList";
import { CHARS } from "@/lib/fight/chars";
import { rankTierOf } from "@/lib/fight/tiers";

const KR = "font-['Nanum_Gothic',sans-serif]";

/** 랭크전 레이팅 순위 (버튼의 1~3위 · 모달) */
function useFightRatings(n: number, tick: number) {
  const [rows, setRows] = useState<FightRatingRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    getFightRatings(n)
      .then((r) => alive && (setRows(r), setFailed(false)))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [n, tick]);
  return { rows, failed };
}

const ratingRows = (rows: FightRatingRow[]) =>
  rows.map((r) => ({
    name: r.name,
    member: true,
    avatar: r.avatar,
    value: r.r.toLocaleString(),
    // 등급 · 전적 (배치 중이면 ratingSub 가 "배치 n/10" 을 붙임)
    sub: `${r.n >= 10 ? `${rankTierOf(r.r, r.n).label} · ` : ""}${ratingSub(r)}`,
    date: r.at,
  }));

type Tab = "rating" | "stats";

function Tabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: [Tab, string][] = [
    ["rating", "🏆 레이팅"],
    ["stats", "📊 캐릭터 통계"],
  ];
  return (
    <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
      {tabs.map(([t, name]) => (
        <button
          key={t}
          type="button"
          onClick={() => setTab(t)}
          className={`cursor-pointer rounded-lg py-1.5 ${KR} text-sm transition-colors ${
            tab === t ? "bg-[#FF8A3D]/90 font-bold text-[#2A0E3A]" : "text-white/60 hover:text-white"
          }`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const TIER_STYLE = {
  strong: "border-[#4ADE80]/40 bg-[#4ADE80]/12 text-[#86EFAC]",
  weak: "border-[#F87171]/40 bg-[#F87171]/12 text-[#FCA5A5]",
  even: "border-white/15 bg-white/[0.04] text-white/55",
  few: "border-white/10 bg-transparent text-white/35",
} as const;
const TIER_LABEL = { strong: "강세", weak: "약세", even: "보통", few: "표본 적음" } as const;

/** 랭크전 캐릭터 통계: 캐릭터별 승률 + 강세·약세, 상성(누구에게 강하고 약한지), 내 캐릭터별 기록 */
function StatsView() {
  const [st, setSt] = useState<RankStats | null>(null);
  const [failed, setFailed] = useState(false);
  const [pick, setPick] = useState<number | null>(null);
  useEffect(() => {
    getRankStats()
      .then(setSt)
      .catch(() => setFailed(true));
  }, []);
  if (failed) return <p className="py-3 font-mono text-xs text-white/30">통계를 불러오지 못했어요</p>;
  if (!st) return <p className="py-3 font-mono text-xs text-white/30">불러오는 중…</p>;
  if (!st.games)
    return <p className={`py-6 text-center ${KR} text-sm text-white/40`}>아직 랭크전 경기가 없어요 — 온라인 → ⚔ 랭크전으로 첫 판을 해 보세요</p>;

  const rows = CHARS.map((c, i) => {
    const x = st.chars.find((y) => y.c === i) ?? { c: i, w: 0, l: 0, d: 0 };
    const g = x.w + x.l + x.d;
    const rate = g ? (x.w + x.d / 2) / g : 0;
    const vs = st.vs
      .filter((v) => v.a === i)
      .map((v) => ({ b: v.b, rate: v.w / v.g, g: v.g, tier: tierOf(v.w / v.g, v.g) }))
      .sort((p, q) => q.rate - p.rate);
    return { c, i, g, w: x.w, l: x.l, d: x.d, rate, tier: tierOf(rate, g), vs };
  }).sort((a, b) => (b.g ? b.rate : -1) - (a.g ? a.rate : -1));
  const mine = (st.mine ?? []).filter((m) => m.w + m.l + m.d > 0).sort((a, b) => b.w + b.l + b.d - (a.w + a.l + a.d));
  const sel = rows.find((r) => r.i === pick) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <p className={`px-1 ${KR} text-[11px] text-white/40`}>
        랭크전 {st.games.toLocaleString()}판 기준 · 같은 캐릭터끼리 붙은 판은 빼고 · 강세 55%↑ · 약세 45%↓ (상성은 {MATCHUP_MIN}판 이상 붙었을 때)
      </p>
      <ol className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.i}>
            <button
              type="button"
              onClick={() => setPick(pick === r.i ? null : r.i)}
              className={`grid w-full cursor-pointer grid-cols-[2.5rem_4.2rem_minmax(0,1fr)_3.2rem_3.6rem] items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors ${
                pick === r.i ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
              }`}
            >
              <img src={`/fight/art/${r.c.id}-face.webp`} alt="" className="h-9 w-10 rounded-md object-cover [image-rendering:pixelated]" style={{ boxShadow: `0 0 0 2px ${r.c.color}66` }} />
              <span className={`${KR} truncate text-sm font-bold`} style={{ color: r.c.color }}>
                {r.c.name}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <span className="block h-full rounded-full" style={{ width: pct(r.rate), background: r.c.color }} />
                </span>
                <span className="truncate font-mono text-[10px] text-white/35">
                  {r.g ? `${r.w}승 ${r.l}패${r.d ? ` ${r.d}무` : ""} · ${r.g}판` : "기록 없음"}
                </span>
              </span>
              <span className="text-right font-mono text-sm text-white tabular-nums">{r.g ? pct(r.rate) : "-"}</span>
              <span className={`rounded-full border px-1.5 py-0.5 text-center ${KR} text-[10px] ${TIER_STYLE[r.g ? (r.g < 10 ? "few" : r.tier) : "few"]}`}>
                {r.g ? (r.g < 10 ? "표본 적음" : TIER_LABEL[r.tier]) : "-"}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {/* 상성: 고른 캐릭터가 누구에게 강하고 약한지 */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div className={`mb-2 ${KR} text-xs text-white/50`}>
          {sel ? (
            <>
              <b style={{ color: sel.c.color }}>{sel.c.name}</b>의 상성 — 상대별 승률
            </>
          ) : (
            "캐릭터를 누르면 상대별 상성이 나와요"
          )}
        </div>
        {sel &&
          (sel.vs.length ? (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {sel.vs.map((v) => {
                const o = CHARS[v.b];
                return (
                  <div
                    key={v.b}
                    className={`grid grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-2 rounded-lg border px-2.5 py-1.5 ${TIER_STYLE[v.tier]}`}
                  >
                    <span className={`${KR} truncate text-xs`}>
                      vs <b style={{ color: o?.color }}>{o?.name ?? "?"}</b>
                    </span>
                    <span className="font-mono text-sm font-bold tabular-nums">{pct(v.rate)}</span>
                    <span className={`${KR} text-right text-[10px] whitespace-nowrap opacity-70`}>
                      {TIER_LABEL[v.tier]} · {v.g}판
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={`${KR} text-xs text-white/35`}>아직 다른 캐릭터와 붙은 기록이 없어요</p>
          ))}
      </div>

      {/* 내 캐릭터별 기록 */}
      {mine.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <div className={`mb-2 ${KR} text-xs text-white/50`}>내 랭크전 캐릭터별 기록</div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {mine.map((m) => {
              const c = CHARS[m.c];
              const g = m.w + m.l + m.d;
              return (
                <div key={m.c} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-white/10 px-2.5 py-1.5">
                  <b className={`${KR} text-xs`} style={{ color: c?.color }}>
                    {c?.name ?? "?"}
                  </b>
                  <span className="font-mono text-xs whitespace-nowrap text-white/75 tabular-nums">
                    {m.w}승 {m.l}패 <span className="text-white/40">{pct((m.w + m.d / 2) / g)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function FightPage() {
  const [tab, setTab] = useState<Tab>("rating");
  const [open, setOpen] = useState(false);
  // 모달을 열 때마다 새로
  const [tick, setTick] = useState(0);
  const top = useFightRatings(3, tick);
  const all = useFightRatings(20, tick);
  return (
    <Faded>
      <div className="mx-auto max-w-5xl px-3 pt-6 pb-24 sm:px-6">
        <GameHeader
          icon="🥊"
          title="픽셀 격투"
          en="Pixel Fighter"
          accent="#FF8A3D"
          desc="도트 캐릭터 6명의 1:1 플랫폼 대전 — AI, 한 키보드 2인, 온라인 · 랭크전"
          guide={FIGHT_GUIDE}
          rank={{
            sub: "랭크전",
            open,
            onOpenChange: (o) => {
              setOpen(o);
              if (o) setTick((n) => n + 1);
            },
            top: ratingRows(top.rows ?? []),
            podium: tab === "rating" ? ratingRows(all.rows ?? []) : [],
            head: () => <Tabs tab={tab} setTab={setTab} />,
            render: () =>
              tab === "stats" ? (
                <StatsView />
              ) : all.failed ? (
                <p className="py-3 font-mono text-xs text-white/30">랭킹을 불러오지 못했어요</p>
              ) : !all.rows ? (
                <p className="py-3 font-mono text-xs text-white/30">불러오는 중…</p>
              ) : (
                <RankList rows={ratingRows(all.rows)} skip={3} empty="아직 랭크전 기록이 없어요 — 온라인 → ⚔ 랭크전으로 첫 판을 해 보세요" />
              ),
          }}
        />
        <FightGame />
      </div>
    </Faded>
  );
}
