"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Faded from "@/components/Faded";
import AvatarForm from "@/components/Account/AvatarForm";
import NickForm from "@/components/Account/NickForm";
import { useAuth } from "@/lib/AuthContext";
import { pointsOf } from "@/lib/aiScore";
import { fmtWon } from "@/lib/poker/rules";
import { rankDateLabel, toDate } from "@/lib/rankDate";
import { BP_TOP_SONGS, bpOf } from "@/lib/rhythm/bp";
import { DIFFICULTIES } from "@/lib/rhythm/chart";
import { getMySummary, type MyRecord, type MySummary } from "@/firestore/me";

/*
 * 내 정보: 별명 바꾸기 · 게임별 내 최고 기록과 순위 · 온라인 전적 · 로그아웃.
 * 기록은 회원으로 플레이하면 자동으로 쌓임 (랭킹은 게임이 끝날 때 자동 등록).
 */

const card = "rounded-2xl border border-white/10 bg-[#1C1E24] p-5 sm:p-6";
const label = "mb-3 font-mono text-xs text-[#8B84FF]";

/** 랭킹 게임: 표시 이름 · 주소 · 기록 표기 */
const BOARDS: Record<string, { name: string; href: string; value: (r: MyRecord) => string }> = {
  score: { name: "멜론 게임", href: "/games/melongame", value: (r) => `${r.score}점` },
  minesweeper_rankings: { name: "지뢰찾기", href: "/games/mine", value: (r) => `${r.time}s` },
  reaction: { name: "반응속도", href: "/games/rspeed", value: (r) => `${r.score}ms` },
  chess_ai_rankings: { name: "체스 AI 랭킹전", href: "/games/chess", value: (r) => aiValue(r) },
  janggi_ai_rankings: { name: "장기 AI 랭킹전", href: "/games/janggi", value: (r) => aiValue(r) },
  omok_ai_rankings: { name: "오목 AI 랭킹전", href: "/games/omok", value: (r) => aiValue(r) },
};
const aiValue = (r: MyRecord) =>
  `${Math.floor((r.score ?? 0) / 1_000_000)}단계 · ${pointsOf(r.score ?? 0).toLocaleString()}점`;

const ONLINE: [string, string, string][] = [
  ["chess", "체스", "/games/chess"],
  ["janggi", "장기", "/games/janggi"],
  ["omok", "오목", "/games/omok"],
  ["fight", "격투", "/games/fight"],
];
/** "120판 · 이긴 판 31" */
const pokerLine = (s?: { hands?: number; wins?: number }) =>
  s?.hands ? `${s.hands.toLocaleString()}판 · 이긴 판 ${(s.wins ?? 0).toLocaleString()}` : "-";
const DIFF = Object.fromEntries(DIFFICULTIES.map((d) => [d.key, d]));

/** 비트대시 곡 정보 (제목 · 난이도별 레벨) */
type SongInfo = { title: string; levels: Record<string, number> };
/** BP에 들어가는 곡 한 줄: 곡마다 가장 높은 BP 하나 */
type BpSong = {
  id: string;
  diff: string;
  level: number;
  score: number;
  bp: number;
  fc: boolean;
  ap: boolean;
};

function DiffChip({ diff, level }: { diff: string; level?: number }) {
  const d = DIFF[diff];
  return (
    <span
      className="shrink-0 rounded px-1.5 py-px font-mono text-[10px] font-bold text-[#0b1020]"
      style={{ background: d?.color ?? "#888" }}
    >
      {d?.label ?? diff}
      {level != null && ` ${level}`}
    </span>
  );
}

function Stat({ name, value }: { name: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-lg font-bold text-white tabular-nums">{value}</span>
      <span className="font-['Nanum_Gothic',sans-serif] text-[11px] text-white/40">{name}</span>
    </div>
  );
}

export default function MyPage() {
  const { loading, account, profile, admin, login, logout } = useAuth();
  const [data, setData] = useState<MySummary | null>(null);
  const [failed, setFailed] = useState(false);
  /** 비트대시 곡 제목·레벨 (곡 데이터가 커서 기록이 있을 때만 불러옴) */
  const [songs, setSongs] = useState<Record<string, SongInfo>>({});

  const nick = profile?.nick;
  useEffect(() => {
    if (!nick) return;
    let alive = true;
    getMySummary()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [nick]);

  const hasRhythm = !!data?.rhythm?.length;
  useEffect(() => {
    if (!hasRhythm) return;
    let alive = true;
    import("@/lib/rhythm/music").then(
      (m) =>
        alive &&
        setSongs(
          Object.fromEntries(
            m.SONGS.map((s) => [
              s.id,
              {
                title: s.title,
                levels: Object.fromEntries(
                  Object.entries(s.charts ?? {}).map(([d, c]) => [d, c?.level ?? 0])
                ),
              },
            ])
          )
        )
    );
    return () => {
      alive = false;
    };
  }, [hasRhythm]);

  if (loading)
    return <p className="pt-24 pb-40 text-center font-mono text-sm text-white/40">확인 중…</p>;

  if (!account)
    return (
      <Faded>
        <div className="mx-auto flex max-w-sm flex-col items-center gap-5 px-6 pt-20 pb-32 text-center">
          <div className="font-mono text-sm text-[#8B84FF]">my page</div>
          <p className="font-['Nanum_Gothic',sans-serif] leading-relaxed text-white/60">
            로그인하면 별명으로 랭킹에 자동 등록되고,
            <br />
            게임 기록이 여기에 쌓여요.
          </p>
          <button
            type="button"
            onClick={() => login().catch(() => {})}
            className="cursor-pointer rounded-full bg-[#6C63FF] px-6 py-2.5 font-mono text-sm text-white transition-colors hover:bg-[#5b52f0]"
          >
            Google 계정으로 로그인
          </button>
        </div>
      </Faded>
    );

  const stats = data?.stats ?? {};
  const records = data?.records ?? [];
  const rhythm = data?.rhythm ?? [];
  const plays = stats.plays ?? {};
  // 곡마다 가장 높은 BP 하나 → 높은 순 (상위 20곡이 합에 들어감). 레벨은 지금 채보 기준이라 서버와 같음
  const bestBySong = new Map<string, BpSong>();
  for (const r of rhythm) {
    if (r.member === false) continue;
    const cut = r.chart.lastIndexOf("_");
    const id = r.chart.slice(0, cut);
    const diff = r.chart.slice(cut + 1);
    const level = songs[id]?.levels[diff];
    if (!level) continue;
    const bp = bpOf(level, r.score);
    const cur = bestBySong.get(id);
    if (!cur || bp > cur.bp)
      bestBySong.set(id, { id, diff, level, score: r.score, bp, fc: r.fc, ap: r.ap });
  }
  const bpSongs = [...bestBySong.values()].sort((a, b) => b.bp - a.bp);
  const bpTop = bpSongs.slice(0, BP_TOP_SONGS);
  const bpSum = bpTop.reduce((s, x) => s + x.bp, 0);
  const bpTotal = data?.bp?.total || bpSum;
  const bpMax = bpTop[0]?.bp ?? 1;

  return (
    <Faded>
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-5 pt-16 pb-24 sm:px-6">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-mono text-sm text-[#8B84FF]">my page</div>
            <h1 className="mt-1 font-['Nanum_Gothic',sans-serif] text-3xl font-bold text-white">
              {profile?.badge && <span className="mr-2">{profile.badge}</span>}
              {profile?.nick ?? "별명을 정해주세요"}
            </h1>
            <p className="mt-1 font-mono text-xs text-white/35">
              {account.email}
              {profile && ` · 방문 ${profile.visits.toLocaleString()}회`}
            </p>
          </div>
          <div className="flex items-center gap-2 font-mono text-xs">
            {admin && (
              <Link
                href="/admin"
                className="rounded-full border border-white/10 px-4 py-1.5 text-white/70 transition-colors hover:text-white"
              >
                admin
              </Link>
            )}
            <button
              type="button"
              onClick={logout}
              className="cursor-pointer rounded-full border border-white/10 px-4 py-1.5 text-white/70 transition-colors hover:text-white"
            >
              로그아웃
            </button>
          </div>
        </div>

        {profile && (
          <section className={card}>
            <div className={label}>프로필 사진</div>
            <AvatarForm />
          </section>
        )}

        <section className={card}>
          <div className={label}>{profile ? "별명 바꾸기" : "별명 정하기"}</div>
          <NickForm key={profile?.nick ?? ""} submitLabel={profile ? "바꾸기" : "시작하기"} />
          {profile && (
            <p className="mt-2 font-['Nanum_Gothic',sans-serif] text-xs text-white/35">
              바꾸면 랭킹·방명록에 남긴 이름도 같이 바뀌어요.
            </p>
          )}
        </section>

        {profile && failed && (
          <p className="py-6 text-center font-mono text-sm text-white/40">
            기록을 불러오지 못했어요. 잠시 후 다시 열어주세요.
          </p>
        )}
        {profile && !failed && !data && (
          <p className="py-6 text-center font-mono text-sm text-white/40">기록 불러오는 중…</p>
        )}

        {profile && data && (
          <>
            <section className={card}>
              <div className={label}>랭킹 기록</div>
              {records.length === 0 ? (
                <p className="font-['Nanum_Gothic',sans-serif] text-sm text-white/40">
                  아직 기록이 없어요. 게임을 끝내면 자동으로 등록돼요.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-white/5">
                  {records.map((r) => {
                    const b = BOARDS[r.board];
                    if (!b) return null;
                    return (
                      <li key={r.board} className="flex items-center gap-3 py-2.5">
                        <span className="w-12 shrink-0 text-center font-mono text-sm font-bold text-[#FDE047] tabular-nums">
                          {r.rank}위
                        </span>
                        <Link
                          href={b.href}
                          className="min-w-0 flex-1 truncate font-['Nanum_Gothic',sans-serif] text-sm text-white/85 transition-colors hover:text-[#8B84FF]"
                        >
                          {b.name}
                          {plays[r.board] ? (
                            <span className="ml-2 text-[11px] text-white/30">
                              {plays[r.board]}판
                            </span>
                          ) : null}
                        </Link>
                        <span className="shrink-0 font-mono text-sm text-white tabular-nums">
                          {b.value(r)}
                        </span>
                        <span className="w-14 shrink-0 text-right font-mono text-[11px] text-white/30 tabular-nums">
                          {rankDateLabel(toDate(r.createdAt))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className={card}>
              <div className={label}>
                <Link href="/games/poker" className="transition-colors hover:text-white">
                  포커
                </Link>
              </div>
              <div className="flex flex-wrap gap-x-8 gap-y-4">
                <Stat name="보유금액 (원)" value={fmtWon(data.money ?? 0)} />
                <Stat name="홀덤" value={pokerLine(stats.poker?.holdem)} />
                <Stat name="7포커" value={pokerLine(stats.poker?.seven)} />
                <Stat name="한 판에 가장 크게 먹은 돈" value={stats.poker?.best ? fmtWon(stats.poker.best) : "-"} />
              </div>
            </section>

            <section className={card}>
              <div className={label}>온라인 전적</div>
              <div className="flex flex-col gap-4">
                {ONLINE.map(([key, name, href]) => {
                  const s = stats.online?.[key] ?? {};
                  const total = (s.w ?? 0) + (s.l ?? 0) + (s.d ?? 0);
                  return (
                    <div key={key} className="flex items-center gap-4">
                      <Link
                        href={href}
                        className="w-14 shrink-0 font-['Nanum_Gothic',sans-serif] text-sm text-white/85 transition-colors hover:text-[#8B84FF]"
                      >
                        {name}
                      </Link>
                      {total === 0 ? (
                        <span className="font-mono text-xs text-white/30">아직 기록이 없어요</span>
                      ) : (
                        <span className="font-mono text-sm text-white/80 tabular-nums">
                          <b className="text-white">{s.w ?? 0}</b>승{" "}
                          <b className="text-white">{s.l ?? 0}</b>패{" "}
                          <b className="text-white">{s.d ?? 0}</b>무
                          <span className="ml-2 text-xs text-white/35">
                            승률 {Math.round(((s.w ?? 0) / total) * 100)}%
                          </span>
                        </span>
                      )}
                      {key === "fight" && data.fightRating && (
                        <span
                          className="ml-auto rounded-full border border-[#FF8A3D]/35 bg-[#FF8A3D]/10 px-2.5 py-0.5 font-mono text-xs text-[#FFC9A3] tabular-nums"
                          title={`랭크전 최고 ${data.fightRating.peak} · ${data.fightRating.n}판`}
                        >
                          랭크 <b className="text-white">{data.fightRating.r}</b>
                          <span className="ml-1.5 text-white/45">
                            {data.fightRating.rank}위 / {data.fightRating.of}명
                          </span>
                        </span>
                      )}
                    </div>
                  );
                })}
                <div className="flex gap-8 border-t border-white/5 pt-4">
                  <Stat name="스케치 퀴즈 게임" value={stats.sketch?.games ?? 0} />
                  <Stat name="스케치 정답" value={stats.sketch?.correct ?? 0} />
                  <Stat
                    name="스케치 누적 점수"
                    value={(stats.sketch?.points ?? 0).toLocaleString()}
                  />
                  <Stat name="격투 온라인 경기" value={stats.fight?.matches ?? 0} />
                </div>
              </div>
            </section>

            <section className={card}>
              <div className={label}>
                BEAT DASH
                {plays.rhythm ? <span className="ml-2 text-white/30">{plays.rhythm}판</span> : null}
              </div>
              {rhythm.length === 0 ? (
                <p className="font-['Nanum_Gothic',sans-serif] text-sm text-white/40">
                  아직 기록이 없어요. 곡을 끝까지 치면 자동으로 등록돼요.
                </p>
              ) : (
                <>
                  {/* BP 요약: 합 · 회원 순위 · 반영 곡 수 */}
                  <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                    <div className="flex flex-col">
                      <span className="font-mono text-3xl font-bold text-[#FACC15] tabular-nums">
                        {bpTotal.toLocaleString()}
                        <span className="ml-1 text-sm text-[#FACC15]/60">BP</span>
                      </span>
                      <span className="font-['Nanum_Gothic',sans-serif] text-[11px] text-white/40">
                        곡별 최고 BP 상위 {BP_TOP_SONGS}곡 합
                      </span>
                    </div>
                    <Stat
                      name="회원 BP 랭킹"
                      value={data.bp?.rank ? `${data.bp.rank}위 / ${data.bp.of}명` : "-"}
                    />
                    <Stat name="반영된 곡" value={`${bpTop.length} / ${BP_TOP_SONGS}`} />
                  </div>

                  {/* 합을 곡별로 쪼갠 막대 (색 = 난이도) + 빈 칸 수 */}
                  {bpTop.length > 0 && (
                    <div className="mt-4 flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-white/5">
                      {bpTop.map((x) => (
                        <span
                          key={x.id}
                          title={`${songs[x.id]?.title ?? x.id} ${x.bp} BP`}
                          className="h-full"
                          style={{ flex: x.bp, background: DIFF[x.diff]?.color ?? "#888" }}
                        />
                      ))}
                    </div>
                  )}
                  {bpTop.length < BP_TOP_SONGS && (
                    <p className="mt-2 font-['Nanum_Gothic',sans-serif] text-[11px] text-white/35">
                      아직 {BP_TOP_SONGS - bpTop.length}곡 자리가 비어 있어요 — 안 친 곡을 끝까지
                      치면 그대로 더해져요.
                    </p>
                  )}

                  {/* 곡별 BP: 곡마다 가장 높은 판 하나 */}
                  <div className="mt-5 mb-1 font-mono text-[11px] text-white/40">곡별 BP</div>
                  <ul className="flex flex-col gap-1.5">
                    {bpSongs.map((x, i) => {
                      const counted = i < BP_TOP_SONGS;
                      return (
                        <li
                          key={x.id}
                          className={`relative flex items-center gap-3 overflow-hidden rounded-lg px-3 py-2 ${counted ? "" : "opacity-40"}`}
                        >
                          {/* 가장 높은 곡 대비 막대 */}
                          <span
                            aria-hidden
                            className="absolute inset-y-0 left-0 rounded-lg"
                            style={{
                              width: `${(x.bp / bpMax) * 100}%`,
                              background: `${DIFF[x.diff]?.color ?? "#888888"}22`,
                            }}
                          />
                          <span className="relative w-5 shrink-0 text-right font-mono text-[11px] text-white/35 tabular-nums">
                            {i + 1}
                          </span>
                          <span className="relative min-w-0 flex-1 truncate font-['Nanum_Gothic',sans-serif] text-sm text-white/85">
                            {songs[x.id]?.title ?? x.id}
                          </span>
                          <span className="relative">
                            <DiffChip diff={x.diff} level={x.level} />
                          </span>
                          {(x.ap || x.fc) && (
                            <span
                              className={`relative shrink-0 font-mono text-[10px] ${x.ap ? "text-[#7DF9FF]" : "text-[#FDE047]"}`}
                            >
                              {x.ap ? "AP" : "FC"}
                            </span>
                          )}
                          <span className="relative hidden w-20 shrink-0 text-right font-mono text-xs text-white/45 tabular-nums sm:inline">
                            {x.score.toLocaleString()}
                          </span>
                          <span className="relative w-14 shrink-0 text-right font-mono text-sm font-bold text-white tabular-nums">
                            {x.bp}
                          </span>
                        </li>
                      );
                    })}
                  </ul>

                  {/* 기록 전체: 곡·난이도마다 곡 랭킹 순위 */}
                  <div className="mt-6 mb-1 font-mono text-[11px] text-white/40">곡 랭킹 기록</div>
                  <ul className="flex flex-col divide-y divide-white/5">
                    {rhythm.map((r) => {
                      const cut = r.chart.lastIndexOf("_");
                      const id = r.chart.slice(0, cut);
                      const diff = r.chart.slice(cut + 1);
                      return (
                        <li key={r.id} className="flex items-center gap-3 py-2.5">
                          <span className="w-12 shrink-0 text-center font-mono text-sm font-bold text-[#FDE047] tabular-nums">
                            {r.rank}위
                          </span>
                          <span className="min-w-0 flex-1 truncate font-['Nanum_Gothic',sans-serif] text-sm text-white/85">
                            {songs[id]?.title ?? id}
                            <span className="ml-2 align-middle">
                              <DiffChip diff={diff} level={songs[id]?.levels[diff]} />
                            </span>
                          </span>
                          {(r.ap || r.fc) && (
                            <span
                              className={`shrink-0 font-mono text-[10px] ${r.ap ? "text-[#7DF9FF]" : "text-[#FDE047]"}`}
                            >
                              {r.ap ? "AP" : "FC"}
                            </span>
                          )}
                          <span className="shrink-0 font-mono text-sm text-white tabular-nums">
                            {r.score.toLocaleString()}
                          </span>
                          <span className="w-14 shrink-0 text-right font-mono text-[11px] text-white/35 tabular-nums">
                            {r.acc.toFixed(2)}%
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </Faded>
  );
}
