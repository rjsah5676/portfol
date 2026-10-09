"use client";

/**
 * 마이페이지 · 픽셀 격투 한눈에: 등급 문장 · 레이팅 · 순위 · 다음 등급까지 · 승패, 캐릭터별 기록, 최근 랭크전.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { CHARS } from "@/lib/fight/chars";
import { rankTierOf, TIERS } from "@/lib/fight/tiers";
import { getFightMe, type FightMe } from "@/firestore/fightRating";
import { rankDateLabel } from "@/lib/rankDate";
import { TierEmblem } from "./TierBadge";

const KR = "font-['Nanum_Gothic',sans-serif]";
const face = (i: number) => (CHARS[i] ? `/fight/art/${CHARS[i].id}-face.webp` : "");
const pct = (w: number, g: number) => (g ? `${Math.round((w / g) * 100)}%` : "-");

export default function FightProfile({ card, label, matches }: { card: string; label: string; matches: number }) {
  const [d, setD] = useState<FightMe | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    getFightMe()
      .then(setD)
      .catch(() => setFailed(true));
  }, []);

  const head = (
    <div className={`${label} flex items-center justify-between`}>
      <Link href="/games/fight" className="transition-colors hover:text-white">
        픽셀 격투
      </Link>
      <span className="text-white/30">온라인 {matches.toLocaleString()}경기</span>
    </div>
  );
  if (failed)
    return (
      <section className={card}>
        {head}
        <p className={`${KR} text-sm text-white/40`}>격투 기록을 불러오지 못했어요</p>
      </section>
    );
  if (!d)
    return (
      <section className={card}>
        {head}
        <p className="font-mono text-sm text-white/30">불러오는 중…</p>
      </section>
    );

  const me = d.me;
  const info = rankTierOf(me?.r ?? 1000, me?.n ?? 0);
  const games = me ? me.w + me.l + me.d : 0;
  const chars = [...d.chars].filter((c) => c.w + c.l + c.d > 0).sort((a, b) => b.w + b.l + b.d - (a.w + a.l + a.d));
  const col = info.placing ? "#9AA3B2" : info.tier.color;

  return (
    <section className={card}>
      {head}
      {!me ? (
        <p className={`${KR} text-sm leading-relaxed text-white/45`}>
          아직 랭크전 기록이 없어요. 격투 → 온라인 → <b className="text-white/70">⚔ 랭크전 매칭</b>으로 첫 판을 해 보세요 (처음 10판은
          배치).
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {/* 등급 · 레이팅 · 순위 */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <div className="flex items-center gap-3">
              <TierEmblem info={info} size={64} />
              <div className="flex flex-col">
                <span className={`${KR} text-lg font-extrabold`} style={{ color: col }}>
                  {info.placing ? "배치 중" : info.label}
                </span>
                <span className="font-mono text-3xl leading-none font-bold text-white tabular-nums">{me.r}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <Mini name="순위" value={`${me.rank}위 / ${me.of}명`} />
              <Mini name="최고" value={`${me.peak}`} />
              <Mini name="전적" value={`${me.w}승 ${me.l}패${me.d ? ` ${me.d}무` : ""}`} />
              <Mini name="승률" value={pct(me.w + me.d / 2, games)} />
            </div>
          </div>

          {/* 다음 등급까지 (배치 중이면 배치 진행) */}
          <div>
            <div className={`${KR} mb-1.5 flex justify-between text-[11px] text-white/45`}>
              {info.placing ? (
                <>
                  <span>배치 {me.n} / 10판</span>
                  <span>끝나면 등급이 정해져요</span>
                </>
              ) : info.next !== null ? (
                <>
                  <span>
                    다음 <b style={{ color: col }}>{info.nextLabel}</b>
                  </span>
                  <span className="font-mono tabular-nums">{info.next - me.r}점 남음</span>
                </>
              ) : (
                <span>최고 등급</span>
              )}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/8">
              <div
                className="h-full rounded-full"
                style={{ width: `${(info.placing ? me.n / 10 : info.progress) * 100}%`, background: col }}
              />
            </div>
            {/* 등급 사다리 */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {TIERS.map((t) => (
                <span
                  key={t.id}
                  className={`${KR} rounded-full border px-2 py-0.5 text-[10px] ${
                    !info.placing && t.id === info.tier.id ? "font-bold" : "opacity-45"
                  }`}
                  style={{ borderColor: `${t.color}66`, color: t.color }}
                  title={`${t.min}점부터`}
                >
                  {t.name} {t.min}
                </span>
              ))}
            </div>
          </div>

          {/* 캐릭터별 */}
          {chars.length > 0 && (
            <div>
              <div className="mb-2 font-mono text-[11px] text-white/40">캐릭터별</div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {chars.map((c) => {
                  const g = c.w + c.l + c.d;
                  const ch = CHARS[c.c];
                  return (
                    <div key={c.c} className="flex items-center gap-2.5 rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-1.5">
                      <img src={face(c.c)} alt="" className="h-7 w-8 rounded object-cover [image-rendering:pixelated]" />
                      <b className={`${KR} w-12 shrink-0 text-xs`} style={{ color: ch?.color }}>
                        {ch?.name ?? "?"}
                      </b>
                      <span className="flex-1">
                        <span className="block h-1.5 overflow-hidden rounded-full bg-white/10">
                          <span className="block h-full rounded-full" style={{ width: pct(c.w + c.d / 2, g), background: ch?.color }} />
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-xs whitespace-nowrap text-white/75 tabular-nums">
                        {c.w}승 {c.l}패 <span className="text-white/40">{pct(c.w + c.d / 2, g)}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 최근 경기 */}
          {d.recent.length > 0 && (
            <div>
              <div className="mb-2 font-mono text-[11px] text-white/40">최근 랭크전</div>
              <ul className="flex flex-col gap-1">
                {d.recent.map((g, i) => (
                  <li key={i} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-white/[0.03]">
                    <span
                      className={`w-7 shrink-0 rounded text-center font-mono text-[11px] font-bold ${
                        g.res === "w" ? "bg-[#4ADE80]/15 text-[#86EFAC]" : g.res === "l" ? "bg-[#F87171]/15 text-[#FCA5A5]" : "bg-white/10 text-white/60"
                      }`}
                    >
                      {g.res === "w" ? "승" : g.res === "l" ? "패" : "무"}
                    </span>
                    <img src={face(g.ch)} alt="" className="h-6 w-7 rounded object-cover [image-rendering:pixelated]" />
                    <span className="font-mono text-[10px] text-white/30">vs</span>
                    <img src={face(g.oppCh)} alt="" className="h-6 w-7 scale-x-[-1] rounded object-cover [image-rendering:pixelated]" />
                    <span className={`${KR} min-w-0 flex-1 truncate text-xs text-white/75`}>{g.opp}</span>
                    {g.bot && <span className={`${KR} shrink-0 rounded-full bg-white/8 px-1.5 text-[10px] text-white/45`}>AI</span>}
                    <span className="w-14 shrink-0 text-right font-mono text-[11px] text-white/30 tabular-nums">
                      {rankDateLabel(new Date(g.at))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Mini({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-base font-bold text-white tabular-nums">{value}</span>
      <span className={`${KR} text-[11px] text-white/40`}>{name}</span>
    </div>
  );
}
