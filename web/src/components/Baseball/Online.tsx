"use client";

/*
 * 온라인 대전 (알파): 실시간 매칭 전 — 내 평점 근처 구단 기록(가상 구단)과 대결.
 * 결과는 이 브라우저에 승패 · 대전 점수로 저장.
 */
import { useState } from "react";
import { clubDefById } from "@/lib/baseball/data";
import { batOvr, findGhosts, gradeOf, nextStarter, pitOvr, teamRating, type Club, type Ghost } from "@/lib/baseball/club";
import { ACCENT, Btn, font } from "./ui";
import { Emblem, GradeChip } from "./clubUi";
import { ClubHeader } from "./Club";
import { sfx } from "./sfx";

const TIER = [
  { name: "해볼 만함", color: "#7dff9a" },
  { name: "막상막하", color: "#ffd23f" },
  { name: "강팀", color: "#ff7a7a" },
] as const;

export default function Online({
  club,
  coin,
  ghosts,
  setGhosts,
  onPlay,
  onBack,
  onManage,
}: {
  club: Club;
  coin: number;
  /** 찾은 상대 (경기 다녀와도 남게 위에서 들고 있음) */
  ghosts: Ghost[] | null;
  setGhosts: (g: Ghost[] | null) => void;
  onPlay: (g: Ghost, innings: number, home: boolean) => void;
  onBack: () => void;
  onManage: () => void;
}) {
  const def = clubDefById(club.teamId);
  const [sel, setSel] = useState<number | null>(null);
  const [innings, setInnings] = useState(3);
  const [home, setHome] = useState(true);
  const [searching, setSearching] = useState(false);
  const r = teamRating(club);
  const rec = club.record;
  const games = rec.w + rec.l + rec.d;
  const sp = nextStarter(club);
  const g = sel !== null ? ghosts?.[sel] : undefined;

  const search = () => {
    setSearching(true);
    setSel(null);
    setGhosts(null);
    window.setTimeout(() => {
      setGhosts(findGhosts(club));
      setSearching(false);
      sfx.ui();
    }, 650);
  };

  return (
    <div className="flex h-full flex-col">
      <ClubHeader club={club} coin={coin} title="온라인 대전" onBack={onBack} />
      <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-[#7ad7ff]/40 bg-[#7ad7ff]/[0.08] px-3 py-1.5 text-[12px] text-white/80">
        <span className="rounded bg-[#7ad7ff] px-1.5 text-[10.5px] font-bold text-[#111]">알파</span>
        실시간 매칭 준비 중 — 지금은 다른 구단 기록과 대결 (상대 구단은 봇이 운영해요)
      </div>

      <div className="flex min-h-0 flex-1 gap-3 px-3 pt-2 pb-3">
        {/* 내 구단 */}
        <div className="flex w-[300px] shrink-0 flex-col gap-2 rounded-xl border border-white/10 bg-black/25 p-3">
          <div className="flex items-center gap-3">
            <Emblem def={def} size={56} />
            <div>
              <div className={`${font.title} text-[20px] leading-tight`}>{def.name}</div>
              <div className="mt-0.5 flex items-center gap-1 text-[12px] text-white/60">
                팀 평점 <GradeChip g={gradeOf(r)} /> <b className="font-mono text-[15px]" style={{ color: ACCENT }}>{r}</b>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-center">
            <Box label="전적" value={`${rec.w}승 ${rec.l}패`} sub={rec.d ? `${rec.d}무` : games ? `승률 ${Math.round((rec.w / games) * 100)}%` : "첫 경기 전"} />
            <Box label="대전 점수" value={String(rec.rating)} sub="처음 1000" color="#ffd23f" />
            <Box label="다음 선발" value={sp?.name ?? "-"} sub={sp ? `${sp.velo}km` : "선발 없음"} color="#7ad7ff" />
          </div>
          <div className="text-[11px] font-bold text-white/50">최근 대전</div>
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {rec.log.length ? (
              rec.log.slice(0, 6).map((l) => (
                <div key={l.at} className="flex items-center gap-2 rounded-md bg-white/[0.04] px-2 py-1 text-[11.5px]">
                  <span className="w-[26px] font-bold" style={{ color: l.win ? "#7dff9a" : l.win === null ? "#fff" : "#ff7a7a" }}>
                    {l.win ? "승" : l.win === null ? "무" : "패"}
                  </span>
                  <span className="min-w-0 flex-1 truncate" style={{ color: l.color }}>
                    vs {l.opp}
                  </span>
                  <span className="font-mono text-white/70">{l.score}</span>
                  <span className={`w-[32px] text-right font-mono ${l.delta >= 0 ? "text-[#7dff9a]" : "text-[#ff7a7a]"}`}>{l.delta >= 0 ? `+${l.delta}` : l.delta}</span>
                </div>
              ))
            ) : (
              <div className="text-[12px] text-white/40">아직 대전 기록이 없어요</div>
            )}
          </div>
          <Btn className="py-1.5 text-[13px]" color="#8b93b8" onClick={onManage}>
            타선 · 투수진 바꾸기 (구단 관리)
          </Btn>
        </div>

        {/* 상대 찾기 */}
        <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-white/10 bg-black/25 p-3">
          <div className="flex items-center justify-between">
            <span className={`${font.title} text-[20px]`} style={{ color: ACCENT }}>
              대전 상대
            </span>
            <Btn className="px-4 py-1.5 text-[13px]" color="#7ad7ff" disabled={searching} onClick={search}>
              {ghosts ? "다른 상대 찾기" : "대전 상대 찾기"}
            </Btn>
          </div>

          {searching ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-white/70">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/15 border-t-[#7ad7ff]" />
              평점 {Math.round(r * 0.9)} ~ {Math.round(r * 1.1)} 구단 찾는 중…
            </div>
          ) : !ghosts ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <div className="text-[14px] text-white/75">내 팀 평점 ±10% 구단 3곳을 찾아요</div>
              <Btn className={`${font.title} px-10 py-3 text-[22px]`} color="#7ad7ff" onClick={search}>
                대전 상대 찾기
              </Btn>
              <div className="text-[11.5px] text-white/45">이기면 대전 점수 +15 ~ +25 · 지면 −10 ~ −20 · 코인도 받아요</div>
            </div>
          ) : (
            <>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {ghosts.map((o, i) => {
                  const on = sel === i;
                  const t = TIER[o.tier];
                  return (
                    <button
                      key={o.def.id + o.owner}
                      type="button"
                      onClick={() => {
                        sfx.ui();
                        setSel(i);
                      }}
                      className="flex cursor-pointer flex-col items-center rounded-xl border-2 p-2.5 text-center transition-transform active:translate-y-[1px]"
                      style={{
                        borderColor: on ? o.def.color : `${o.def.color}44`,
                        background: `linear-gradient(180deg, ${o.def.color}${on ? "38" : "1c"}, ${o.def.dark}bb)`,
                        boxShadow: on ? `0 0 18px ${o.def.color}99` : "0 3px 0 rgba(0,0,0,0.45)",
                      }}
                    >
                      <Emblem def={o.def} size={48} />
                      <div className={`${font.title} mt-1.5 text-[16px] leading-tight`}>{o.def.name}</div>
                      <div className="text-[10.5px] text-white/55">구단주 {o.owner} · AI</div>
                      <div className="mt-1 flex items-center gap-1">
                        <GradeChip g={gradeOf(o.rating)} />
                        <span className="font-mono text-[16px] font-bold">{o.rating}</span>
                      </div>
                      <span className="mt-1 rounded px-1.5 text-[11px] font-bold text-[#111]" style={{ background: t.color }}>
                        {t.name}
                      </span>
                      <div className="mt-1 w-full truncate text-[10.5px] text-white/55">간판 {o.star}</div>
                      <div className="mt-0.5 font-mono text-[11px]">
                        <span className="text-[#7dff9a]">승 +{o.win}</span> <span className="text-white/30">/</span> <span className="text-[#ff7a7a]">패 {o.lose}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              {/* 고른 상대 라인업 미리보기 */}
              {g ? (
                <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-white/55">
                    <span>
                      <b style={{ color: g.def.color }}>{g.def.name}</b> 라인업
                    </span>
                    <span>
                      선발 <b className="text-white/85">{g.team.pitchers[0].name}</b> · {g.team.pitchers[0].velo}km · 종합 {pitOvr(g.team.pitchers[0])}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-x-3 gap-y-0.5">
                    {g.team.batters.map((b, i) => (
                      <div key={b.name} className="flex items-center gap-1.5 text-[11px]">
                        <span className="w-[12px] text-right font-bold" style={{ color: ACCENT }}>
                          {i + 1}
                        </span>
                        <span className="w-[22px] font-mono text-[10px] text-white/50">{b.pos}</span>
                        <span className="min-w-0 flex-1 truncate text-white/85">{b.name}</span>
                        <span className="font-mono text-white/60">{batOvr(b)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-3 text-center text-[12px] text-white/45">상대를 누르면 라인업을 볼 수 있어요</div>
              )}
              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-bold text-white/60">이닝</span>
                  {[3, 6, 9].map((n) => (
                    <Btn key={n} active={innings === n} className="px-3 py-1 text-[13px]" onClick={() => setInnings(n)}>
                      {n}회
                    </Btn>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-bold text-white/60">우리 팀</span>
                  <Btn active={!home} className="px-3 py-1 text-[13px]" onClick={() => setHome(false)}>
                    원정
                  </Btn>
                  <Btn active={home} className="px-3 py-1 text-[13px]" onClick={() => setHome(true)}>
                    홈
                  </Btn>
                </div>
                <Btn className={`${font.title} ml-auto px-8 py-2 text-xl`} disabled={!g} onClick={() => g && onPlay(g, innings, home)}>
                  {g ? `vs ${g.def.short} · PLAY BALL` : "상대를 골라 주세요"}
                </Btn>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Box({ label, value, sub, color = "#fff" }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] px-1 py-1.5">
      <div className="text-[10px] text-white/50">{label}</div>
      <div className="truncate text-[13.5px] font-bold" style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-[9.5px] text-white/40">{sub}</div>}
    </div>
  );
}
