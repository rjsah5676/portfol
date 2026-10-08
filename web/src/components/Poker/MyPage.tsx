"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api/config";
import { asset } from "@/lib/poker/assets";
import { CHARS, GAMES, REVIVE, TIERS, fmtShort } from "@/lib/poker/rules";
import type { MyPage as MyPageData, Wallet } from "@/lib/poker/types";
import { getMyPage } from "@/realtime/poker";
import { Money, Profile } from "./parts";

/** 마이페이지: 프로필 · 칩 · 순위 · 전적 · 최근 판 */
export default function MyPage({
  wallet,
  onChar,
  onRank,
  onClose,
  compact,
}: {
  wallet: Wallet;
  onChar: () => void;
  onRank: () => void;
  onClose: () => void;
  /** 폰 세로 */
  compact: boolean;
}) {
  const [me, setMe] = useState<MyPageData | null | undefined>(undefined);
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
  return (
    <div className="flex flex-col" style={{ maxHeight: "inherit" }}>
      {/* 머리: 캐릭터 색 배경 + 프로필 */}
      <div
        className="relative isolate overflow-hidden px-[0.9em] pt-[0.9em] pb-[0.7em]"
        style={{ background: `linear-gradient(135deg, ${info.color}66, rgba(0,0,0,0.2) 70%)` }}
      >
        {}
        <img
          src={asset.full(wallet.char)}
          alt=""
          draggable={false}
          className="pointer-events-none absolute -right-[4%] -bottom-[55%] -z-10 h-[220%] w-auto opacity-30"
          style={{
            maskImage: "linear-gradient(180deg,#000 40%,transparent 70%)",
            WebkitMaskImage: "linear-gradient(180deg,#000 40%,transparent 70%)",
          }}
        />
        <div className="flex items-center gap-[0.7em]">
          {me?.avatar ? (
            <img
              src={`${API_URL}${me.avatar}`}
              alt=""
              className="h-[3.6em] w-[3.6em] shrink-0 rounded-full object-cover ring-2 ring-[var(--pk-brass)]"
            />
          ) : (
            <Profile
              char={wallet.char}
              size={58}
              className="shrink-0 ring-2 ring-[var(--pk-brass)]"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-[0.4em]">
              <span className="truncate text-[1.2em] font-extrabold">{me?.nick ?? "…"}</span>
              <span className="shrink-0 text-[0.78em] font-bold" style={{ color: info.color }}>
                {info.name}
              </span>
            </div>
            <div className="mt-[0.1em] flex items-center gap-[0.3em]">
              {}
              <img src={asset.chip("gold", "top")} alt="" className="h-[1em] w-[1em]" />
              <Money won={wallet.money} className="text-[1.25em] text-[#ffd84a]" />
            </div>
            {me?.since && (
              <div className="text-[0.68em] text-white/45">
                {new Date(me.since).toLocaleDateString("ko-KR", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}{" "}
                가입
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onRank}
            className="flex shrink-0 flex-col items-center rounded-[8px] border border-[rgba(255,201,60,0.45)] bg-black/45 px-[0.7em] py-[0.25em] leading-tight"
          >
            <span className="text-[0.7em] text-white/55">자금 순위</span>
            <span className="text-[1.15em] font-extrabold text-[#ffd84a]">
              {me === undefined ? "…" : me?.rank ? `${me.rank}위` : "–"}
            </span>
          </button>
        </div>
      </div>

      <div className="pk-scroll min-h-0 flex-1 overflow-y-auto p-[0.9em]">
        {/* 전적 */}
        <div className={`grid gap-[0.4em] ${compact ? "grid-cols-2" : "grid-cols-4"}`}>
          <Stat label="친 판" value={me ? `${hands.toLocaleString()}판` : "…"} />
          <Stat
            label="이긴 판"
            value={me ? `${wins.toLocaleString()}판` : "…"}
            sub={me ? rate(wins, hands) : undefined}
          />
          <Stat label="테이블 입장" value={me ? `${me.games.toLocaleString()}번` : "…"} />
          <Stat
            label="한 판 최고"
            value={me ? (me.best > 0 ? `+${fmtShort(me.best)}` : "–") : "…"}
            gold
          />
        </div>
        <div className="mt-[0.4em] grid grid-cols-2 gap-[0.4em]">
          {(["holdem", "seven"] as const).map((g) => {
            const st = me?.[g];
            return (
              <div
                key={g}
                className="flex items-center justify-between rounded-[8px] bg-white/[0.06] px-[0.7em] py-[0.45em]"
              >
                <span className="text-[0.82em] font-bold">{GAMES[g].name}</span>
                <span className="pk-num text-[0.9em] text-white/80">
                  {st ? (
                    <>
                      {st.wins}승 {st.hands - st.wins}패{" "}
                      <span className="text-[0.85em] text-white/50">
                        ({rate(st.wins, st.hands)})
                      </span>
                    </>
                  ) : (
                    "…"
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {/* 기본 칩 */}
        <div
          className={`mt-[0.4em] flex rounded-[8px] bg-white/[0.06] px-[0.7em] py-[0.45em] text-[0.8em] ${compact ? "flex-col gap-[0.15em]" : "items-center justify-between gap-[0.6em]"}`}
        >
          <span className="text-white/70">
            칩이 바닥나면 기본 칩 {fmtShort(REVIVE.amount)} 자동 지급
            <span className="text-white/40"> (보유 {fmtShort(REVIVE.under)} 미만일 때)</span>
          </span>
          <span className="pk-num shrink-0 text-white/80">
            오늘 {REVIVE.perDay - wallet.reviveUsed}/{REVIVE.perDay}번 남음
          </span>
        </div>

        {/* 최근 판 */}
        <div className="mt-[0.7em] mb-[0.3em] flex items-baseline justify-between">
          <span className="pk-frame-title">최근 판</span>
          <span className="text-[0.68em] text-white/40">최신순 · 내 증감</span>
        </div>
        {me === undefined ? (
          <p className="py-[1em] text-center text-[0.8em] text-white/40">불러오는 중…</p>
        ) : !me?.recent.length ? (
          <p className="py-[1em] text-center text-[0.8em] text-white/40">
            아직 친 판이 없어요. 한 판 치고 와요!
          </p>
        ) : (
          <ul className="grid gap-[0.25em]">
            {me.recent.map((r, i) => (
              <li
                key={i}
                className="flex items-center gap-[0.5em] rounded-[6px] bg-white/[0.04] px-[0.6em] py-[0.35em] text-[0.8em]"
              >
                <span className="w-[3.6em] shrink-0 font-bold">{GAMES[r.game].name}</span>
                <span className="shrink-0 text-white/50">{TIERS[r.tier - 1]?.name}</span>
                <span className="min-w-0 flex-1 truncate text-white/40">
                  {r.rivals + 1}인 · {ago(r.at)}
                </span>
                <Money
                  won={r.delta}
                  sign
                  className={`shrink-0 text-[1.05em] ${r.delta > 0 ? "text-[#5ff0b5]" : r.delta < 0 ? "text-[#ff8a97]" : "text-white/60"}`}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-[0.4em] border-t border-white/10 p-[0.7em]">
        <button
          type="button"
          onClick={onChar}
          className="pk-btn pk-btn-ghost flex-1 py-[0.5em] text-[0.85em]"
        >
          캐릭터 변경
        </button>
        <button
          type="button"
          onClick={onClose}
          className="pk-btn pk-btn-gold flex-1 py-[0.5em] text-[0.85em]"
        >
          닫기
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  gold,
}: {
  label: string;
  value: string;
  sub?: string;
  gold?: boolean;
}) {
  return (
    <div className="rounded-[8px] bg-white/[0.06] px-[0.5em] py-[0.45em] text-center">
      <div className="text-[0.7em] text-white/50">{label}</div>
      <div
        className={`pk-num text-[1.05em] leading-tight ${gold ? "text-[#ffd84a]" : "text-white"}`}
      >
        {value}
        {sub && <span className="ml-[0.3em] text-[0.7em] text-white/50">{sub}</span>}
      </div>
    </div>
  );
}

function ago(at: number): string {
  const d = Date.now() - at;
  if (d < 60_000) return "방금";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}분 전`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}시간 전`;
  return `${Math.floor(d / 86_400_000)}일 전`;
}
