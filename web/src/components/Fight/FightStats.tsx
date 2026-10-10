"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal/Modal";
import { getRankStats, MATCHUP_MIN, type RankStats, type StatBuild, type StatSrc } from "@/firestore/fightRating";
import { CHARS } from "@/lib/fight/chars";
import { TIERS } from "@/lib/fight/tiers";

const KR = "font-['Nanum_Gothic',sans-serif]";
const pct = (x: number) => `${Math.round(x * 100)}%`;
/** 캐릭터 강세·약세로 보는 최소 판 수 */
const CHAR_MIN = 10;

/** 승률 색: 55%↑ 초록 · 45%↓ 빨강 · 그 사이 흰색 (표본 적으면 흐리게) */
const rateColor = (rate: number, enough: boolean) =>
  !enough ? "text-white/45" : rate >= 0.55 ? "text-[#4ADE80]" : rate <= 0.45 ? "text-[#F87171]" : "text-white";
const verdict = (rate: number, g: number, min: number) =>
  g < min ? null : rate >= 0.55 ? { t: "강세", c: "border-[#4ADE80]/50 bg-[#4ADE80]/15 text-[#86EFAC]" } : rate <= 0.45 ? { t: "약세", c: "border-[#F87171]/50 bg-[#F87171]/15 text-[#FCA5A5]" } : { t: "보통", c: "border-white/20 bg-white/[0.06] text-white/70" };

const day = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}.${d.getDate()}`;
};
const buildLabel = (b: StatBuild, cur: boolean) => (b.build === 0 ? "버전 구분 전 (10.10까지)" : `${b.ver || "지금 버전"}${cur ? " · 지금" : ""} (${day(b.from)}~)`);

const Face = ({ i, size }: { i: number; size: number }) => {
  const c = CHARS[i];
  return (
    <img
      src={`/fight/art/${c?.id}-face.webp`}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-md object-cover [image-rendering:pixelated]"
      style={{ width: size, height: size, boxShadow: `0 0 0 2px ${c?.color ?? "#fff"}88` }}
    />
  );
};

/** 50% 눈금이 있는 승률 막대 */
const Bar = ({ rate, color, h = 6 }: { rate: number; color: string; h?: number }) => (
  <span className="relative block w-full overflow-hidden rounded-full bg-white/12" style={{ height: h }}>
    <span className="block h-full rounded-full" style={{ width: pct(rate), background: color }} />
    <span className="absolute top-0 left-1/2 h-full w-px bg-white/45" aria-hidden />
  </span>
);

/** 한 캐릭터의 상대별 승률 (펼침) */
function Matchups({ me, st }: { me: number; st: RankStats }) {
  const list = CHARS.map((o, b) => {
    const v = st.vs.find((x) => x.a === me && x.b === b);
    return { o, b, g: v?.g ?? 0, w: v?.w ?? 0, rate: v && v.g ? v.w / v.g : 0 };
  })
    .filter((x) => x.b !== me)
    .sort((p, q) => (q.g ? q.rate : -1) - (p.g ? p.rate : -1) || q.g - p.g);
  return (
    <div className="mt-1 mb-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
      <div className={`mb-2 flex items-baseline justify-between ${KR} text-xs text-white/70`}>
        <span>
          <b style={{ color: CHARS[me].color }}>{CHARS[me].name}</b> 기준 상대별 승률
        </span>
        <span className="text-[10px] text-white/40">위가 유리 · 아래가 불리 ({MATCHUP_MIN}판↑부터 판정)</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {list.map((x) => {
          const enough = x.g >= MATCHUP_MIN;
          const v = verdict(x.rate, x.g, MATCHUP_MIN);
          const wins = Math.round(x.w);
          return (
            <li key={x.b} className="grid grid-cols-[1.75rem_4.5rem_minmax(0,1fr)_3rem_3.2rem] items-center gap-2">
              <Face i={x.b} size={28} />
              <span className={`${KR} truncate text-[13px] font-bold text-white`}>vs {x.o.name}</span>
              {x.g ? (
                <span className="flex min-w-0 flex-col gap-0.5">
                  <Bar rate={x.rate} color={x.o.color} h={5} />
                  <span className="font-mono text-[10px] text-white/50">
                    {wins}승 {x.g - wins}패 · {x.g}판
                  </span>
                </span>
              ) : (
                <span className={`${KR} text-[11px] text-white/35`}>아직 붙은 적 없음</span>
              )}
              <span className={`text-right font-mono text-sm font-bold tabular-nums ${rateColor(x.rate, enough)}`}>{x.g ? pct(x.rate) : "-"}</span>
              <span className={`rounded-full border px-1 py-0.5 text-center ${KR} text-[10px] ${v ? v.c : "border-transparent text-white/30"}`}>
                {v ? v.t : x.g ? "표본 적음" : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 캐릭터별 승률 (누르면 상성 펼침) + 내 기록 */
function StatsBody({ st, src }: { st: RankStats; src: StatSrc }) {
  const [pick, setPick] = useState<number | null>(null);
  if (!st.games)
    return (
      <p className={`py-8 text-center ${KR} text-sm leading-relaxed text-white/55`}>
        {src === "ai" ? (
          <>
            이 버전 · 등급은 아직 AI 판이 없어요
            <br />
            <span className="text-xs text-white/40">서버가 몇 분마다 한 판씩 쌓고 있어요</span>
          </>
        ) : (
          "이 버전 · 등급엔 아직 랭크전 기록이 없어요"
        )}
      </p>
    );

  const rows = CHARS.map((c, i) => {
    const x = st.chars.find((y) => y.c === i) ?? { c: i, w: 0, l: 0, d: 0 };
    const g = x.w + x.l + x.d;
    return { c, i, g, w: x.w, l: x.l, d: x.d, rate: g ? (x.w + x.d / 2) / g : 0 };
  }).sort((a, b) => (b.g ? b.rate : -1) - (a.g ? a.rate : -1));
  const mine = (st.mine ?? []).filter((m) => m.w + m.l + m.d > 0).sort((a, b) => b.w + b.l + b.d - (a.w + a.l + a.d));

  return (
    <div className="flex flex-col gap-4">
      <div className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1 ${KR} text-xs text-white/60`}>
        <span>
          <b className="text-white">{st.games.toLocaleString()}판</b> 기준 · 같은 캐릭터끼리 판은 빼고
        </span>
        <span className="text-[11px] text-white/45">
          <span className="text-[#4ADE80]">55%↑ 강세</span> · <span className="text-[#F87171]">45%↓ 약세</span> · {CHAR_MIN}판↑부터
        </span>
      </div>
      <ol className="flex flex-col gap-1">
        {rows.map((r, k) => {
          const enough = r.g >= CHAR_MIN;
          const v = verdict(r.rate, r.g, CHAR_MIN);
          const on = pick === r.i;
          return (
            <li key={r.i}>
              <button
                type="button"
                onClick={() => setPick(on ? null : r.i)}
                aria-expanded={on}
                className={`grid w-full cursor-pointer grid-cols-[1.1rem_2.5rem_4.6rem_minmax(0,1fr)_3.2rem_3.2rem_0.8rem] items-center gap-2 rounded-xl border px-2 py-1.5 text-left transition-colors ${
                  on ? "border-white/25 bg-white/[0.09]" : "border-transparent hover:border-white/10 hover:bg-white/[0.05]"
                }`}
              >
                <span className="text-center font-mono text-xs text-white/40">{r.g ? k + 1 : ""}</span>
                <Face i={r.i} size={40} />
                <span className={`${KR} truncate text-[15px] font-extrabold text-white`}>
                  <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: r.c.color }} aria-hidden />
                  {r.c.name}
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <Bar rate={r.rate} color={r.c.color} />
                  <span className="truncate font-mono text-[11px] text-white/55">
                    {r.g ? `${r.w}승 ${r.l}패${r.d ? ` ${r.d}무` : ""} · ${r.g}판` : "기록 없음"}
                  </span>
                </span>
                <span className={`text-right font-mono text-base font-bold tabular-nums ${rateColor(r.rate, enough)}`}>{r.g ? pct(r.rate) : "-"}</span>
                <span className={`rounded-full border px-1 py-0.5 text-center ${KR} text-[10px] ${v ? v.c : "border-transparent text-white/35"}`}>
                  {v ? v.t : r.g ? "표본 적음" : ""}
                </span>
                <span className={`text-[10px] text-white/40 transition-transform ${on ? "rotate-180" : ""}`} aria-hidden>
                  ▾
                </span>
              </button>
              {on && <Matchups me={r.i} st={st} />}
            </li>
          );
        })}
      </ol>
      {pick === null && <p className={`-mt-2 text-center ${KR} text-[11px] text-white/40`}>캐릭터를 누르면 상대별 상성이 펼쳐져요</p>}

      {src === "human" && mine.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className={`mb-2 ${KR} text-xs text-white/70`}>내 기록 (이 버전 · 등급)</div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {mine.map((m) => {
              const g = m.w + m.l + m.d;
              const rate = (m.w + m.d / 2) / g;
              return (
                <div key={m.c} className="flex min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5">
                  <Face i={m.c} size={26} />
                  <b className={`${KR} min-w-0 flex-1 truncate text-[13px] text-white`}>{CHARS[m.c]?.name ?? "?"}</b>
                  <span className="font-mono text-xs whitespace-nowrap text-white/70 tabular-nums">
                    {m.w}승 {m.l}패{m.d ? ` ${m.d}무` : ""}
                  </span>
                  <span className={`w-10 text-right font-mono text-sm font-bold tabular-nums ${rateColor(rate, g >= 5)}`}>{pct(rate)}</span>
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
 * 캐릭터 통계 창 (랭킹 창과 따로) — 랭크전 / AI 시뮬레이션(서버가 상시로 AI끼리 랭크전을 돌려 쌓음),
 * 밸런스 버전별 · 등급(실력 구간)별로 볼 수 있음
 */
export default function FightStats({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [src, setSrc] = useState<StatSrc>("human");
  // undefined = 지금 버전
  const [build, setBuild] = useState<number | undefined>(undefined);
  const [tier, setTier] = useState(-1);
  const [builds, setBuilds] = useState<StatBuild[]>([]);
  const [shown, setShown] = useState<number | null>(null);
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
        setShown(r.build);
        setSt(r);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [open, src, build, tier]);

  const cur = builds.find((b) => b.build !== 0)?.build;
  // AI 시뮬레이션엔 버전 구분 전 기록이 없음
  const list = builds.filter((b) => (src === "ai" ? b.build !== 0 : true));

  return (
    <Modal open={open} onClose={onClose} size="md" closeButton title={<span>📊 픽셀 격투 캐릭터 통계</span>}>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
        {(
          [
            ["human", "⚔ 랭크전"],
            ["ai", "🤖 AI 시뮬레이션"],
          ] as [StatSrc, string][]
        ).map(([s, name]) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setSrc(s);
              if (s === "ai" && build === 0) setBuild(undefined);
            }}
            className={`cursor-pointer rounded-lg py-2 ${KR} text-sm transition-colors ${
              src === s ? "bg-[#FF8A3D] font-bold text-[#2A0E3A]" : "text-white/70 hover:text-white"
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      <label className="mb-2 flex items-center gap-2">
        <span className={`${KR} shrink-0 text-xs text-white/60`}>밸런스 버전</span>
        <select
          value={build ?? shown ?? ""}
          onChange={(e) => {
            const b = Number(e.target.value);
            setBuild(b === cur ? undefined : b);
          }}
          className={`min-w-0 flex-1 cursor-pointer rounded-lg border border-white/20 bg-[#1c1328] px-2 py-1.5 ${KR} text-[13px] text-white`}
        >
          {list.map((b) => (
            <option key={b.build} value={b.build}>
              {buildLabel(b, b.build === cur)} — {src === "ai" ? `AI ${b.sim.toLocaleString()}판` : `${b.human.toLocaleString()}판`}
            </option>
          ))}
        </select>
      </label>

      <div className="mb-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="등급">
        <button
          type="button"
          role="radio"
          aria-checked={tier < 0}
          onClick={() => setTier(-1)}
          className={`cursor-pointer rounded-full border px-3 py-1 ${KR} text-xs font-bold transition-colors ${
            tier < 0 ? "border-white bg-white text-[#1a1225]" : "border-white/20 bg-white/[0.04] text-white/80 hover:border-white/40"
          }`}
        >
          전체 등급
        </button>
        {TIERS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={tier === i}
            onClick={() => setTier(i)}
            className={`flex cursor-pointer items-center gap-1 rounded-full border py-0.5 pr-2.5 pl-1 ${KR} text-xs font-bold transition-colors ${
              tier === i ? "text-[#1a1225]" : "bg-white/[0.04] text-white/85 hover:bg-white/[0.08]"
            }`}
            style={tier === i ? { background: t.color, borderColor: t.color } : { borderColor: `${t.color}66` }}
          >
            <img src={`/fight/tier/${t.id}.webp`} alt="" width={20} height={20} className="h-5 w-5 object-contain" />
            {t.name}
          </button>
        ))}
      </div>
      <p className={`mb-3 px-1 ${KR} text-[11px] leading-relaxed text-white/50`}>
        {src === "ai"
          ? "서버가 쉬지 않고 AI끼리 랭크전을 돌려 쌓은 표본 — 등급마다 그 실력의 AI 둘을 캐릭터 보정 없이 붙여요. AI 기준이라 참고용이에요."
          : tier >= 0
            ? `${TIERS[tier].name} 플레이어가 고른 캐릭터 기준 (그 판 전 레이팅). 10.10까지 기록은 레이팅을 다시 계산한 추정치예요.`
            : "랭크전(회원끼리 · 비슷한 레이팅 봇과) 기록이에요."}
      </p>

      {failed ? (
        <p className={`py-3 ${KR} text-xs text-white/50`}>통계를 불러오지 못했어요</p>
      ) : !st ? (
        <p className={`py-3 ${KR} text-xs text-white/50`}>불러오는 중…</p>
      ) : (
        <StatsBody key={`${src}:${shown}:${tier}`} st={st} src={src} />
      )}
    </Modal>
  );
}
