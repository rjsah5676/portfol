"use client";

import { useEffect, useMemo, useState } from "react";
import {
  caseKey,
  caseNo,
  PENALTY,
  rng,
  scoreOf,
  TIERS,
  type Puzzle,
  type TierId,
} from "@/lib/suspect/engine";
import { getPlay, loadStore, saveStore, setPlay } from "@/lib/suspect/progress";
import { playSfx } from "@/lib/suspect/sound";
import { getCaseRanking, submitCase } from "@/firestore/suspectRankings";
import { useAutoRank } from "@/lib/useAutoRank";
import { RANK_NAME_MAX } from "@/lib/api/rankRun";
import type { BoardMode, FinishInfo } from "./CaseBoard";

/** 3:12.4 */
export const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, "0")}`;
};

/** 공유 글에 붙는 주소 (메신저에서 바로 눌리게 https 까지) */
const SITE = "https://gunmo.my/games/suspect/";

function shareHead(tier: TierId, day: string | null) {
  return day
    ? `🕵️ 오늘의 용의자 #${caseNo(day)} · ${TIERS[tier].label}`
    : `🕵️ 오늘의 용의자 · 연습 ${TIERS[tier].label}`;
}
const shareStats = (r: FinishInfo) => `⏱ ${fmtTime(r.time)} · 실수 ${r.miss} · 힌트 ${r.hint}`;

function shareText(p: Puzzle, tier: TierId, day: string | null, r: FinishInfo) {
  // 정답이 드러나지 않게: 실수한 사람만 노란 칸, 나머지는 초록 칸
  const rows: string[] = [];
  for (let y = 0; y < p.rows; y++) {
    let line = "";
    for (let c = 0; c < p.cols; c++) line += r.missed.includes(y * p.cols + c) ? "🟨" : "🟩";
    rows.push(line);
  }
  const perfect = r.miss === 0 && r.hint === 0 ? " · 완벽 해결" : "";
  return `${shareHead(tier, day)}${perfect}\n${shareStats(r)}\n${rows.join("\n")}\n${SITE}`;
}

/** 공유 미리보기 카드 (복사되는 글과 같은 내용을 보기 좋게) */
function SharePreview({
  p,
  tier,
  day,
  r,
}: {
  p: Puzzle;
  tier: TierId;
  day: string | null;
  r: FinishInfo;
}) {
  const perfect = r.miss === 0 && r.hint === 0;
  return (
    <div className="sp-share">
      <div className="sp-share-head">{shareHead(tier, day)}</div>
      <div className="sp-share-stats">
        {shareStats(r)}
        {perfect && <span className="sp-share-badge">완벽 해결</span>}
      </div>
      <div
        className="sp-share-grid"
        style={{ gridTemplateColumns: `repeat(${p.cols}, 1fr)` }}
        aria-hidden
      >
        {p.truth.map((_, i) => (
          <i key={i} className={r.missed.includes(i) ? "miss" : ""} />
        ))}
      </div>
      <div className="sp-share-link">{SITE.replace(/^https:\/\/|\/$/g, "")}</div>
    </div>
  );
}

function Confetti() {
  const bits = useMemo(() => {
    const r = rng(42);
    const colors = ["#ff6b6b", "#ffc93c", "#4ea8de", "#1fa37a", "#9b5de5"];
    return Array.from({ length: 34 }, (_, i) => ({
      left: `${r() * 100}%`,
      bg: colors[i % colors.length],
      dx: `${(r() - 0.5) * 120}px`,
      dy: `${320 + r() * 260}px`,
      rot: `${(r() - 0.5) * 900}deg`,
      dur: `${1.6 + r() * 1.4}s`,
      delay: `${r() * 0.4}s`,
    }));
  }, []);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {bits.map((b, i) => (
        <span
          key={i}
          className="sp-confetti"
          style={
            {
              left: b.left,
              background: b.bg,
              animationDuration: b.dur,
              animationDelay: b.delay,
              "--dx": b.dx,
              "--dy": b.dy,
              "--rot": b.rot,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

type Send = "idle" | "sending" | "done" | "error" | "kept";

export default function Result({
  puzzle,
  mode,
  tier,
  day,
  result,
  onHome,
  onAgain,
  onRank,
  onReview,
}: {
  puzzle: Puzzle;
  mode: BoardMode;
  tier: TierId;
  /** 오늘의 사건이면 날짜 (연습 · 입문은 null) */
  day: string | null;
  result: FinishInfo;
  onHome: () => void;
  /** 연습: 새 사건 · 입문: 오늘의 사건으로 */
  onAgain: () => void;
  onRank: (tier: TierId, day: string) => void;
  /** 다 푼 판 다시 보기 */
  onReview: () => void;
}) {
  const daily = mode === "daily" && !!day;
  const score = scoreOf(result.time, result.miss, result.hint);
  const perfect = result.miss === 0 && result.hint === 0;
  const ck = day ? caseKey(day, tier) : "";
  // 처음 화면을 열 때 이미 올린 기록인지 (오늘의 사건은 첫 풀이만 랭킹에)
  const [already] = useState(() => (daily ? !!getPlay(day, tier)?.submitted : false));
  const [send, setSend] = useState<Send>(already ? "kept" : "idle");
  const [err, setErr] = useState("");
  const [name, setName] = useState(() => loadStore().name ?? "");
  const [rank, setRank] = useState<{ pos: number; total: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const markSubmitted = () => {
    if (!day) return;
    const p = getPlay(day, tier);
    if (p) setPlay(day, tier, { ...p, submitted: true, score });
  };

  const submit = async (nick: string) => {
    setSend("sending");
    setErr("");
    try {
      await submitCase(ck, {
        name: nick,
        time: result.time,
        miss: result.miss,
        hint: result.hint,
        score,
      });
      markSubmitted();
      setSend("done");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "기록을 올리지 못했어요.");
      setSend("error");
      throw e;
    }
  };

  const auto = useAutoRank(daily && !already, (nick) => submit(nick));

  // 순위 (올린 뒤 · 이미 올렸으면 바로)
  useEffect(() => {
    if (!daily || (send !== "done" && send !== "kept")) return;
    let off = false;
    getCaseRanking(ck, 200)
      .then((rows) => {
        if (off) return;
        const mine = getPlay(day, tier)?.score ?? score;
        setRank({
          pos: rows.filter((r) => r.score < mine).length + 1,
          total: Math.max(rows.length, 1),
        });
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [daily, send, ck, day, tier, score]);

  const text = shareText(puzzle, tier, daily ? day : null, result);
  const copy = async () => {
    playSfx("sfx-tap");
    try {
      if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent))
        await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  const guestSend = () => {
    const n = name.trim().slice(0, RANK_NAME_MAX);
    if (!n) return;
    saveStore((s) => {
      s.name = n;
    });
    void submit(n).catch(() => {});
  };

  return (
    <div className="relative flex flex-col items-center gap-4 pt-2 text-center">
      <Confetti />
      <div className={`sp-big-stamp ${perfect ? "perfect" : ""}`}>
        {perfect ? "완벽 해결!" : "사건 해결!"}
      </div>
      <p className="sp-hand m-0 text-[21px] leading-tight">
        {daily
          ? `사건 #${caseNo(day)} · ${TIERS[tier].label}`
          : mode === "tutorial"
            ? "입문 사건 완료"
            : `연습 사건 · ${TIERS[tier].label}`}
        <br />
        <span className="text-[16px] text-[var(--ink2)]">
          범인 {puzzle.crimCount}명을 모두 찾아냈어요
        </span>
      </p>

      <div className="sp-card w-full max-w-[400px] px-4 py-3">
        <div className="grid grid-cols-3 gap-2">
          {[
            ["걸린 시간", fmtTime(result.time)],
            ["실수", `${result.miss}번`],
            ["힌트", `${result.hint}번`],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="text-[12px] text-[var(--ink2)]">{k}</div>
              <div className="sp-num text-[24px] leading-tight">{v}</div>
            </div>
          ))}
        </div>
        {daily && (
          <>
            <div className="mt-2 border-t-2 border-dashed border-[var(--line)] pt-2">
              <span className="text-[12px] text-[var(--ink2)]">랭킹 기록 (작을수록 좋아요)</span>
              <div className="sp-num text-[34px] leading-none">{fmtTime(score)}</div>
              <div className="text-[11.5px] text-[var(--ink3)]">
                시간 + 실수×{PENALTY.miss}초 + 힌트×{PENALTY.hint}초
              </div>
            </div>
            <div className="mt-2 text-[14px]">
              {send === "kept" ? (
                <span>이미 랭킹에 올린 사건이에요. 랭킹엔 첫 풀이만 남아요.</span>
              ) : send === "sending" || auto.state === "sending" ? (
                <span>기록 올리는 중…</span>
              ) : send === "done" ? (
                <span className="font-bold text-[var(--inno)]">랭킹에 올렸어요!</span>
              ) : send === "error" ? (
                <span className="text-[var(--crim)]">{err}</span>
              ) : null}
              {rank && (
                <div className="sp-hand mt-1 text-[22px]">
                  오늘 {TIERS[tier].label} {rank.pos}위{" "}
                  <span className="text-[16px] text-[var(--ink2)]">/ {rank.total}명</span>
                </div>
              )}
            </div>
            {!auto.member && (send === "idle" || send === "error") && (
              <div className="mt-2 flex gap-2">
                <input
                  className="sp-input"
                  value={name}
                  maxLength={RANK_NAME_MAX}
                  placeholder="랭킹에 남길 이름"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && guestSend()}
                />
                <button
                  type="button"
                  className="sp-btn sp-btn-sun shrink-0"
                  onClick={guestSend}
                  disabled={!name.trim()}
                >
                  올리기
                </button>
              </div>
            )}
          </>
        )}
        {mode === "practice" && (
          <p className="mt-2 mb-0 text-[12.5px] text-[var(--ink2)]">
            연습 사건은 랭킹에 올라가지 않아요.
          </p>
        )}
      </div>

      {mode !== "tutorial" && (
        <div className="w-full max-w-[400px]">
          <SharePreview p={puzzle} tier={tier} day={daily ? day : null} r={result} />
          <button type="button" className="sp-btn mt-2 w-full" onClick={copy}>
            {copied ? "복사했어요!" : "결과 공유하기 (정답은 안 보여요)"}
          </button>
        </div>
      )}

      <div className="flex w-full max-w-[400px] flex-wrap justify-center gap-2">
        {mode === "tutorial" ? (
          <button type="button" className="sp-btn sp-btn-crim w-full" onClick={onAgain}>
            오늘의 사건 풀러 가기
          </button>
        ) : mode === "practice" ? (
          <button type="button" className="sp-btn sp-btn-crim flex-1" onClick={onAgain}>
            새 연습 사건
          </button>
        ) : (
          day && (
            <button
              type="button"
              className="sp-btn sp-btn-sun flex-1"
              onClick={() => onRank(tier, day)}
            >
              🏆 랭킹
            </button>
          )
        )}
        <button type="button" className="sp-btn sp-btn-ghost flex-1" onClick={onReview}>
          판 다시 보기
        </button>
        <button type="button" className="sp-btn flex-1" onClick={onHome}>
          {daily ? "다른 난이도" : "처음으로"}
        </button>
      </div>
    </div>
  );
}
