"use client";

import { useEffect, useState } from "react";
import type { Song } from "@/lib/rhythm/music";
import { DIFFICULTIES } from "@/lib/rhythm/chart";
import { sfx, tick } from "@/lib/rhythm/sfx";
import { coverOf } from "./SongCarousel";
import { RankEmblem, type Result } from "./Stage";
import { SubmitRanking } from "./RankingBoard";

const DISP = "font-['Arial_Black','Segoe_UI_Black',Impact,sans-serif] font-black italic";
const KR = "font-['Nanum_Gothic',sans-serif]";
const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;

/** 결과 연출 시간표(초) */
const T = { banner: 0.15, count: 0.5, countLen: 1.1, rank: 1.75, record: 2.3 };

export default function ResultScreen({
  result,
  song,
  onRetry,
  onSelect,
  starting,
}: {
  result: Result & { newBest: boolean };
  song: Song;
  onRetry: () => void;
  onSelect: () => void;
  starting: boolean;
}) {
  const d = DIFFICULTIES.find((x) => x.key === result.diff)!;
  const banner = result.failed
    ? "failed"
    : result.ap
      ? "allperfect"
      : result.fc
        ? "fullcombo"
        : "clear";
  const [el, setEl] = useState(0);

  // 시간에 따라 점수가 올라가고, 랭크가 쾅 — 효과음도 같은 시간표로
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    let lastTick = 0;
    const fired = new Set<string>();
    const once = (k: string, at: number, now: number, f: () => void) => {
      if (now >= at && !fired.has(k)) {
        fired.add(k);
        f();
      }
    };
    const loop = () => {
      const now = (performance.now() - t0) / 1000;
      setEl(now);
      if (!result.failed)
        once("banner", T.banner, now, () =>
          sfx(
            banner === "allperfect" ? "allperfect" : banner === "fullcombo" ? "fullcombo" : "clear",
            0.8
          )
        );
      if (now > T.count && now < T.count + T.countLen && now - lastTick > 0.06) {
        lastTick = now;
        tick(0.15);
      }
      once("rank", T.rank, now, () => sfx("rank-reveal", 0.8));
      if (result.newBest) once("record", T.record, now, () => sfx("new-record", 0.8));
      if (now < 3) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [result, banner]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea")) return;
      if (e.code === "Enter" || e.code === "KeyR") {
        e.preventDefault();
        if (e.repeat) return;
        sfx("ui-select", 0.8);
        onRetry();
      } else if (e.code === "Escape") {
        e.preventDefault();
        sfx("ui-back", 0.7);
        onSelect();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRetry, onSelect]);

  const cp = Math.max(0, Math.min(1, (el - T.count) / T.countLen));
  const ease = 1 - Math.pow(1 - cp, 3);
  const score = Math.round(result.score * ease);
  const acc = result.acc * ease;
  const total = Math.max(
    1,
    result.counts.perfect + result.counts.great + result.counts.good + result.counts.miss
  );
  const cover = coverOf(song);
  const rows = [
    ["PERFECT", result.counts.perfect, "#7DF9FF"],
    ["GREAT", result.counts.great, "#4ADE80"],
    ["GOOD", result.counts.good, "#FBBF24"],
    ["MISS", result.counts.miss, "#F87171"],
  ] as const;

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#06041a]">
      <img
        src={result.failed ? "/rhythm/play-pink.webp" : "/rhythm/play-blue.webp"}
        alt=""
        className="absolute inset-0 h-full w-full object-cover opacity-55"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(6,4,26,0.9),rgba(6,4,26,0.55)_50%,rgba(6,4,26,0.9))]" />

      {/* 위: 배너 */}
      <img
        src={`/rhythm/banner-${banner}.webp`}
        alt={banner}
        className="absolute top-[1.4cqw] left-1/2 w-[36cqw] -translate-x-1/2 drop-shadow-[0_0_2cqw_rgba(0,0,0,0.6)] [animation:bd-slam_500ms_cubic-bezier(.2,.9,.3,1.1)_backwards]"
        style={{ animationDelay: `${T.banner}s` }}
      />

      {/* 왼쪽: 곡 + 랭크 */}
      <div className="absolute top-[16cqw] left-[3cqw] flex w-[30cqw] flex-col items-center">
        <div className="flex w-full items-center gap-[1.2cqw] rounded-[0.9cqw] border border-white/10 bg-black/45 p-[0.9cqw]">
          <div className="h-[5.4cqw] w-[5.4cqw] shrink-0 overflow-hidden rounded-[0.6cqw] border border-white/20 bg-[#0e3a4a]">
            {cover ? (
              <img src={cover} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[2.4cqw]">🎵</div>
            )}
          </div>
          <div className="min-w-0">
            <div className={`${KR} truncate text-[1.6cqw] font-extrabold text-white`}>
              {song.artist ? `${song.artist} - ${song.title}` : song.title}
            </div>
            <div className={`${KR} text-[1.15cqw] font-bold`} style={{ color: d.color }}>
              {d.label}
            </div>
          </div>
        </div>
        <div className="relative mt-[1cqw] h-[22cqw] w-[22cqw]">
          {el >= T.rank && (
            <>
              <div className="absolute inset-[10%] rounded-full bg-white/20 blur-[3cqw] [animation:modal-fade_400ms_ease-out]" />
              <RankEmblem
                rank={result.rank}
                className="relative h-full w-full [animation:bd-slam_450ms_cubic-bezier(.2,.9,.3,1.1)]"
              />
            </>
          )}
        </div>
        {result.newBest && el >= T.record && (
          <div
            className={`${DISP} -mt-[1cqw] -skew-x-6 rounded-[0.4cqw] bg-[linear-gradient(90deg,#f59e0b,#ec4899)] px-[1.4cqw] py-[0.3cqw] text-[1.5cqw] tracking-[0.15em] text-white shadow-[0_0_1.6cqw_#ec4899] [animation:bd-slam_400ms_ease-out]`}
          >
            NEW RECORD!
          </div>
        )}
      </div>

      {/* 가운데: 점수 */}
      <div className="absolute top-[16cqw] left-[35cqw] flex w-[30cqw] flex-col gap-[0.9cqw] [animation:bd-slide-up_400ms_300ms_ease-out_backwards]">
        <div className="rounded-[0.9cqw] border border-white/10 bg-black/45 px-[1.6cqw] py-[1cqw]">
          <div className="font-mono text-[1cqw] tracking-[0.25em] text-white/45">SCORE</div>
          <div className={`${DISP} text-[4.2cqw] leading-tight text-white tabular-nums`}>
            {String(score)
              .padStart(7, "0")
              .replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
          </div>
          <div className="mt-[0.3cqw] flex justify-between font-mono text-[1.3cqw] text-white/80">
            <span>
              <span className="text-white/40">ACC </span>
              {acc.toFixed(2)}%
            </span>
            <span>
              <span className="text-white/40">MAX COMBO </span>
              {Math.round(result.maxCombo * ease)}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-[0.5cqw]">
          {rows.map(([label, n, c]) => (
            <div
              key={label}
              className="relative overflow-hidden rounded-[0.6cqw] border border-white/10 bg-black/45 px-[1.2cqw] py-[0.5cqw]"
            >
              <div
                className="absolute inset-y-0 left-0 opacity-25 transition-[width] duration-700"
                style={{ width: `${(n / total) * 100 * ease}%`, background: c }}
              />
              <div className="relative flex justify-between font-mono text-[1.25cqw] font-bold">
                <span style={{ color: c }}>{label}</span>
                <span className="text-white tabular-nums">{Math.round(n * ease)}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-[1.2cqw] font-mono text-[1.05cqw]">
          <span className="text-[#60A5FA]">FAST {result.fast}</span>
          <span className="text-[#FB923C]">SLOW {result.slow}</span>
          {result.avgMs !== null && (
            <span className="text-white/50">
              평균 {signed(result.avgMs)}ms{" "}
              {result.avgMs > 0 ? "늦음" : result.avgMs < 0 ? "빠름" : ""}
            </span>
          )}
        </div>
      </div>

      {/* 오른쪽: 랭킹 등록 */}
      <div className="absolute top-[16cqw] right-[3cqw] bottom-[6.4cqw] w-[30cqw] rounded-[0.9cqw] [animation:bd-slide-left_400ms_500ms_ease-out_backwards]">
        {song.custom ? (
          <Note>
            직접 넣은 곡은 랭킹에 올라가지 않아요.
            <br />
            최고 기록은 이 브라우저에만 저장돼요.
          </Note>
        ) : result.failed ? (
          <Note>끝까지 살아남아야 랭킹에 올릴 수 있어요.</Note>
        ) : (
          <SubmitRanking
            result={result}
            label={`${song.artist ? `${song.artist} - ` : ""}${song.title} ${d.label}`}
            game
          />
        )}
      </div>

      {/* 아래 */}
      <div className="absolute inset-x-0 bottom-0 flex h-[5cqw] items-center justify-end gap-[1cqw] border-t border-white/10 bg-black/55 px-[2.4cqw]">
        <button
          type="button"
          onClick={() => {
            sfx("ui-back", 0.7);
            onSelect();
          }}
          className="cursor-pointer rounded-[0.6cqw] border border-white/20 bg-white/5 px-[2cqw] py-[0.6cqw] font-['Nanum_Gothic',sans-serif] text-[1.3cqw] font-bold text-white/80 hover:border-white/50 hover:text-white"
        >
          곡 선택 (Esc)
        </button>
        <button
          type="button"
          disabled={starting}
          onClick={() => {
            sfx("ui-select", 0.8);
            onRetry();
          }}
          className={`${DISP} -skew-x-12 cursor-pointer rounded-[0.6cqw] bg-[linear-gradient(90deg,#db2777,#7c3aed)] px-[2.6cqw] py-[0.55cqw] text-[1.6cqw] tracking-[0.1em] text-white shadow-[0_0_1.4cqw_rgba(236,72,153,0.6)] transition-transform hover:scale-105 disabled:opacity-50`}
        >
          <span className="inline-block skew-x-12">RETRY (R)</span>
        </button>
      </div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center rounded-[0.9cqw] border border-white/10 bg-black/45 p-[2cqw] text-center font-['Nanum_Gothic',sans-serif] text-[1.2cqw] leading-relaxed text-white/55">
      {children}
    </div>
  );
}
