"use client";

import { useEffect, useState } from "react";
import { avatarUrl } from "@/lib/api/config";
import { asset } from "@/lib/poker/assets";
import {
  CHARS,
  GAMES,
  REVIVE,
  fmtEok,
  fmtShort,
  lookName,
  lookOf,
  tierLabel,
} from "@/lib/poker/rules";
import type { MyPage as MyPageData, Wallet } from "@/lib/poker/types";
import { getMyPage } from "@/realtime/poker";
import MyStats from "./MyStats";
import { Money, Profile } from "./parts";

/** 마이페이지: 프로필 · 칩 · 순위 / 탭 — 전적(기본) · 통계(베팅 성향). 닫기는 시트의 X · 끌어내리기 */
export default function MyPage({
  wallet,
  onChar,
  onRank,
  compact,
}: {
  wallet: Wallet;
  onChar: () => void;
  onRank: () => void;
  /** 폰 세로 */
  compact: boolean;
}) {
  const [me, setMe] = useState<MyPageData | null | undefined>(undefined);
  const [tab, setTab] = useState<"record" | "stats">("record");
  useEffect(() => {
    let alive = true;
    getMyPage()
      .then((m) => alive && setMe(m))
      .catch(() => alive && setMe(null));
    return () => {
      alive = false;
    };
  }, []);
  const info = CHARS[wallet.char];
  const wins = (me?.holdem.wins ?? 0) + (me?.seven.wins ?? 0);
  const hands = me?.hands ?? 0;
  const rate = (w: number, n: number) => (n > 0 ? `${Math.round((w / n) * 100)}%` : "–");
  const recent = me?.recent ?? [];
  const net = recent.reduce((a, r) => a + r.delta, 0);
  const won = recent.filter((r) => r.delta > 0).length;
  // 최근 판을 날짜(오늘 · 어제 · n일 전)로 묶음
  const groups: { day: string; rows: typeof recent }[] = [];
  for (const r of recent) {
    const day = dayLabel(r.at);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.rows.push(r);
    else groups.push({ day, rows: [r] });
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 머리: 캐릭터 색 배경 + 프로필 + 순위 · 캐릭터 변경 (오른쪽 위는 시트의 X 자리라 비워 둠) */}
      <div
        className={`relative isolate shrink-0 overflow-hidden px-[0.9em] pb-[0.8em] ${compact ? "pt-[0.2em]" : "pt-[0.9em]"}`}
        style={{ background: `linear-gradient(135deg, ${info.color}55, rgba(0,0,0,0.25) 75%)` }}
      >
        {}
        <img
          src={asset.full(me?.look ?? wallet.char)}
          alt=""
          draggable={false}
          className="pointer-events-none absolute top-0 right-[6%] -z-10 h-[260%] w-auto opacity-30"
          style={{
            maskImage: "linear-gradient(180deg,#000 35%,transparent 62%)",
            WebkitMaskImage: "linear-gradient(180deg,#000 35%,transparent 62%)",
          }}
        />
        <div className="flex items-center gap-[0.75em] pr-[2.6em]">
          {me?.avatar ? (
            <img
              src={avatarUrl(me.avatar)}
              alt=""
              referrerPolicy="no-referrer"
              className={`${compact ? "h-[3.2em] w-[3.2em]" : "h-[4em] w-[4em]"} shrink-0 rounded-full object-cover ring-2 ring-[var(--pk-brass)]`}
            />
          ) : (
            <Profile
              char={me?.look ?? wallet.char}
              size={compact ? 50 : 64}
              className="shrink-0 ring-2 ring-[var(--pk-brass)]"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[1.25em] leading-tight font-extrabold">
              {me?.nick ?? "…"}
            </div>
            <div className="truncate text-[0.8em] font-bold" style={{ color: info.color }}>
              {lookName(lookOf(wallet.char, wallet.wear))}
            </div>
            <div className="mt-[0.15em] flex items-center gap-[0.3em]">
              {}
              <img src={asset.chip("gold", "top")} alt="" className="h-[1em] w-[1em]" />
              <Money won={wallet.money} className="text-[1.3em] text-[#ffd84a]" />
            </div>
          </div>
        </div>
        <div className="mt-[0.65em] flex items-center gap-[0.4em]">
          <button type="button" onClick={onRank} className="pk-me-chip">
            <span className="text-white/55">자금 순위</span>
            <b className="text-[#ffd84a]">
              {me === undefined ? "…" : me?.rank ? `${me.rank}위` : "–"}
            </b>
            <span className="text-white/40">›</span>
          </button>
          <button type="button" onClick={onChar} className="pk-me-chip pk-me-chip-gold">
            캐릭터 변경
          </button>
          {me?.since && (
            <span className="ml-auto shrink-0 text-[0.68em] text-white/40">
              {new Date(me.since).toLocaleDateString("ko-KR", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}{" "}
              가입
            </span>
          )}
        </div>
      </div>

      {/* 탭: 밑줄 (위 버튼들과 헷갈리지 않게) */}
      <div className="pk-me-tabs shrink-0" role="tablist">
        {(
          [
            ["record", "전적"],
            ["stats", "통계 · 베팅 성향"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        data-sheet-scroll
        className="pk-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-[0.9em]"
      >
        {tab === "stats" ? (
          me ? (
            <MyStats stats={me.stats} two={!compact} />
          ) : (
            <p className="py-[2em] text-center text-[0.8em] text-white/40">
              {me === undefined ? "불러오는 중…" : "통계를 불러오지 못했어요"}
            </p>
          )
        ) : (
          <>
            {/* 요약: 친 판 · 승률 · 한 판 최고 */}
            <div className="pk-me-card grid grid-cols-3 text-center">
              <Big label="친 판" value={me ? hands.toLocaleString() : "…"} unit="판" />
              <Big
                label="승률"
                value={me ? (hands ? String(Math.round((wins / hands) * 100)) : "–") : "…"}
                unit={hands ? "%" : ""}
                sub={me ? `${wins.toLocaleString()}승` : undefined}
              />
              <Big
                label="한 판 최고"
                value={me ? (me.best > 0 ? `+${fmtEok(me.best)}` : "–") : "…"}
                gold
              />
            </div>

            {/* 게임별 */}
            <div className="mt-[0.5em] grid grid-cols-2 gap-[0.5em]">
              {(["holdem", "seven"] as const).map((g) => {
                const st = me?.[g];
                const pct = st && st.hands ? (st.wins / st.hands) * 100 : 0;
                return (
                  <div
                    key={g}
                    className="pk-me-card"
                    style={{ "--g": GAME_COLOR[g] } as React.CSSProperties}
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="pk-me-game">{GAMES[g].name}</span>
                      <span className="pk-num text-[0.85em] text-white/75">
                        {st ? (
                          <>
                            {st.wins}승 {st.hands - st.wins}패
                            <b className="ml-[0.4em] text-white">{rate(st.wins, st.hands)}</b>
                          </>
                        ) : (
                          "…"
                        )}
                      </span>
                    </div>
                    <div className="mt-[0.45em] h-[0.4em] overflow-hidden rounded-full bg-white/[0.08]">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: GAME_COLOR[g] }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 최근 판 */}
            <div className="mt-[0.9em] mb-[0.4em] flex items-baseline justify-between gap-[0.5em]">
              <span className="pk-frame-title">최근 판</span>
              {recent.length > 0 && (
                <span className="pk-num text-[0.75em] text-white/55">
                  {recent.length}판 중 {won}판 이김 ·{" "}
                  <Money
                    won={net}
                    sign
                    className={
                      net > 0 ? "text-[#5ff0b5]" : net < 0 ? "text-[#ff8a97]" : "text-white/60"
                    }
                  />
                </span>
              )}
            </div>
            {me === undefined ? (
              <p className="py-[1em] text-center text-[0.8em] text-white/40">불러오는 중…</p>
            ) : !recent.length ? (
              <p className="py-[1em] text-center text-[0.8em] text-white/40">
                아직 친 판이 없어요. 한 판 치고 와요!
              </p>
            ) : (
              <div className="grid gap-[0.6em]">
                {groups.map((g) => (
                  <section key={g.day}>
                    <div className="mb-[0.25em] text-[0.7em] font-bold text-white/45">{g.day}</div>
                    <ul className="pk-me-list">
                      {g.rows.map((r, i) => (
                        <li key={i} data-res={r.delta > 0 ? "win" : r.delta < 0 ? "lose" : "even"}>
                          <span
                            className="pk-me-badge"
                            style={{ "--g": GAME_COLOR[r.game] } as React.CSSProperties}
                          >
                            {GAMES[r.game].name}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-white/60">
                            {tierLabel(r.tier)} · {r.rivals + 1}인
                          </span>
                          <span className="shrink-0 text-[0.85em] text-white/35">
                            {clock(r.at)}
                          </span>
                          <Money
                            won={r.delta}
                            sign
                            className={`w-[5.2em] shrink-0 text-right text-[1.05em] ${r.delta > 0 ? "text-[#5ff0b5]" : r.delta < 0 ? "text-[#ff8a97]" : "text-white/60"}`}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}

            {/* 기본 칩 안내 */}
            <p className="mt-[0.9em] text-center text-[0.72em] leading-relaxed text-white/40">
              칩이 {fmtShort(REVIVE.under)} 아래로 떨어지면 기본 칩 {fmtShort(REVIVE.amount)} 자동
              지급 · 오늘{" "}
              <b className="text-white/70">
                {REVIVE.perDay - wallet.reviveUsed}/{REVIVE.perDay}번
              </b>{" "}
              남음
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const GAME_COLOR = { holdem: "#3fd1a8", seven: "#b48cff" } as const;

function Big({
  label,
  value,
  unit,
  sub,
  gold,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  gold?: boolean;
}) {
  return (
    <div className="min-w-0 px-[0.3em]">
      <div className="text-[0.72em] text-white/50">{label}</div>
      <div
        className={`pk-num truncate text-[1.45em] leading-tight font-extrabold ${gold ? "text-[#ffd84a]" : "text-white"}`}
      >
        {value}
        {unit && <span className="ml-[0.1em] text-[0.6em] font-bold text-white/60">{unit}</span>}
      </div>
      {sub && <div className="text-[0.7em] text-white/45">{sub}</div>}
    </div>
  );
}

/** 날짜 묶음 이름: 오늘 · 어제 · 10월 8일 */
function dayLabel(at: number): string {
  const d0 = new Date();
  d0.setHours(0, 0, 0, 0);
  if (at >= d0.getTime()) return "오늘";
  if (at >= d0.getTime() - 86_400_000) return "어제";
  const d = new Date(at);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 그 판을 친 시각 (오후 3:07) */
function clock(at: number): string {
  return new Date(at).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
}
