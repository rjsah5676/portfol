"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Faded from "@/components/Faded";
import AvatarForm from "@/components/Account/AvatarForm";
import NickForm from "@/components/Account/NickForm";
import { useAuth } from "@/lib/AuthContext";
import { pointsOf } from "@/lib/aiScore";
import { rankDateLabel, toDate } from "@/lib/rankDate";
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
  fight_ai_rankings: { name: "픽셀 격투 AI", href: "/games/fight", value: (r) => aiValue(r) },
};
const aiValue = (r: MyRecord) =>
  `${Math.floor((r.score ?? 0) / 1_000_000)}단계 · ${pointsOf(r.score ?? 0).toLocaleString()}점`;

const ONLINE: [string, string, string][] = [
  ["chess", "체스", "/games/chess"],
  ["janggi", "장기", "/games/janggi"],
  ["omok", "오목", "/games/omok"],
];
const DIFF_LABEL: Record<string, string> = {
  easy: "쉬움",
  normal: "보통",
  hard: "어려움",
  expert: "매우 어려움",
  nightmare: "나이트메어",
};

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
  /** 비트대시 곡 제목 (곡 데이터가 커서 기록이 있을 때만 불러옴) */
  const [songs, setSongs] = useState<Record<string, string>>({});

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
      (m) => alive && setSongs(Object.fromEntries(m.SONGS.map((s) => [s.id, s.title])))
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
                        <span className="font-mono text-xs text-white/30">아직 둔 판이 없어요</span>
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
                          {songs[id] ?? id}
                          <span className="ml-2 text-[11px] text-white/35">
                            {DIFF_LABEL[diff] ?? diff}
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
              )}
            </section>
          </>
        )}
      </div>
    </Faded>
  );
}
