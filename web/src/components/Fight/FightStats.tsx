"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal/Modal";
import { getRankStats, MATCHUP_MIN, tierOf, type RankStats, type StatBuild, type StatSrc } from "@/firestore/fightRating";
import { CHARS } from "@/lib/fight/chars";
import { TIERS } from "@/lib/fight/tiers";

const KR = "font-['Nanum_Gothic',sans-serif]";
const pct = (x: number) => `${Math.round(x * 100)}%`;
const TIER_STYLE = {
  strong: "border-[#4ADE80]/40 bg-[#4ADE80]/12 text-[#86EFAC]",
  weak: "border-[#F87171]/40 bg-[#F87171]/12 text-[#FCA5A5]",
  even: "border-white/15 bg-white/[0.04] text-white/55",
  few: "border-white/10 bg-transparent text-white/35",
} as const;
const TIER_LABEL = { strong: "강세", weak: "약세", even: "보통", few: "표본 적음" } as const;

const day = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
};
const buildLabel = (b: StatBuild, cur: boolean) =>
  b.build === 0 ? `${b.ver} 기록` : `${b.ver || "지금 버전"}${cur ? " (지금)" : ""} · ${day(b.from)}~`;

/** 캐릭터별 승률 + 강세·약세, 상성(누구에게 강하고 약한지), 내 캐릭터별 기록 */
function StatsBody({ st, src }: { st: RankStats; src: StatSrc }) {
  const [pick, setPick] = useState<number | null>(null);
  if (!st.games)
    return (
      <p className={`py-6 text-center ${KR} text-sm text-white/40`}>
        {src === "ai" ? "이 버전 · 등급은 아직 AI 판이 없어요 — 서버가 몇 분마다 한 판씩 쌓고 있어요" : "이 버전 · 등급은 아직 랭크전 경기가 없어요"}
      </p>
    );

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
        {src === "ai" ? "AI끼리" : "랭크전"} {st.games.toLocaleString()}판 기준 · 같은 캐릭터끼리 붙은 판은 빼고 · 강세 55%↑ · 약세 45%↓ (상성은 {MATCHUP_MIN}판 이상 붙었을 때)
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
                  <div key={v.b} className={`grid grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-2 rounded-lg border px-2.5 py-1.5 ${TIER_STYLE[v.tier]}`}>
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

      {/* 내 캐릭터별 기록 (사람 랭크전만) */}
      {src === "human" && mine.length > 0 && (
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

/**
 * 캐릭터 통계 창 (랭킹 창과 따로) — 사람 랭크전 / AI 시뮬레이션(서버가 상시로 AI끼리 랭크전을 돌려 쌓음),
 * 밸런스 버전별 · 등급(실력 구간)별로 볼 수 있음
 */
export default function FightStats({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [src, setSrc] = useState<StatSrc>("human");
  const [build, setBuild] = useState<number | undefined>(undefined);
  const [tier, setTier] = useState(-1);
  const [builds, setBuilds] = useState<StatBuild[]>([]);
  const [st, setSt] = useState<RankStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setSt(null);
    setFailed(false);
    getRankStats(src, build, tier)
      .then((r) => {
        if (!alive) return;
        setBuilds(r.builds);
        if (build === undefined && r.build !== null) setBuild(r.build);
        setSt(r);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [open, src, build, tier]);

  const cur = builds[0]?.build;
  // AI 시뮬레이션엔 버전 구분 전 기록이 없음
  const list = builds.filter((b) => (src === "ai" ? b.build !== 0 : true));
  const chip = (on: boolean) =>
    `cursor-pointer rounded-full border px-2.5 py-1 ${KR} text-[11px] whitespace-nowrap transition-colors ${
      on ? "border-white/50 bg-white/15 text-white" : "border-white/10 bg-white/[0.03] text-white/55 hover:text-white"
    }`;

  return (
    <Modal open={open} onClose={onClose} size="md" closeButton title={<span>📊 픽셀 격투 캐릭터 통계</span>}>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
        {(
          [
            ["human", "🧑 사람 랭크전"],
            ["ai", "🤖 AI 시뮬레이션"],
          ] as [StatSrc, string][]
        ).map(([s, name]) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setSrc(s);
              if (s === "ai" && build === 0) setBuild(cur);
            }}
            className={`cursor-pointer rounded-lg py-1.5 ${KR} text-sm transition-colors ${
              src === s ? "bg-[#FF8A3D]/90 font-bold text-[#2A0E3A]" : "text-white/60 hover:text-white"
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`${KR} text-[11px] text-white/45`}>밸런스 버전</span>
        <select
          value={build ?? ""}
          onChange={(e) => setBuild(Number(e.target.value))}
          className={`min-w-0 flex-1 cursor-pointer rounded-lg border border-white/15 bg-[#1c1328] px-2 py-1 ${KR} text-xs text-white`}
        >
          {list.map((b) => (
            <option key={b.build} value={b.build}>
              {buildLabel(b, b.build === cur)} · {src === "ai" ? `AI ${b.sim.toLocaleString()}판` : `${b.human.toLocaleString()}판`}
            </option>
          ))}
        </select>
      </div>
      <div className="mb-3 flex flex-wrap gap-1">
        <button type="button" onClick={() => setTier(-1)} className={chip(tier < 0)}>
          전체 등급
        </button>
        {TIERS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTier(i)}
            className={chip(tier === i)}
            style={tier === i ? { borderColor: t.color, color: t.color, background: `${t.color}22` } : { color: `${t.color}cc` }}
          >
            {t.name}
          </button>
        ))}
      </div>
      <p className={`mb-3 px-1 ${KR} text-[11px] leading-relaxed text-white/35`}>
        {src === "ai"
          ? "서버가 쉬지 않고 AI끼리 랭크전을 돌려 쌓은 표본이에요. 등급마다 그 등급 실력의 AI 둘을 캐릭터 보정 없이 붙여요 — 사람 손이 아닌 AI 기준이라 참고용이에요."
          : tier >= 0
            ? "그 등급 사람이 고른 캐릭터 기준 (경기 전 레이팅). 버전 구분 전 기록은 등급 정보가 없어 등급별에선 빠져요."
            : "회원끼리(또는 비슷한 레이팅 봇과) 붙은 랭크전 기록이에요."}
      </p>

      {failed ? (
        <p className="py-3 font-mono text-xs text-white/30">통계를 불러오지 못했어요</p>
      ) : !st ? (
        <p className="py-3 font-mono text-xs text-white/30">불러오는 중…</p>
      ) : (
        <StatsBody key={`${src}:${build}:${tier}`} st={st} src={src} />
      )}
    </Modal>
  );
}
