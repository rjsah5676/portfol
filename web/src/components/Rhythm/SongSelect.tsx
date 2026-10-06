"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Song } from "@/lib/rhythm/music";
import { DIFFICULTIES, type Chart, type Difficulty } from "@/lib/rhythm/chart";
import { audio, sfx } from "@/lib/rhythm/sfx";
import { COVERS, coverOf, CUSTOM_COVER } from "./SongCarousel";
import CustomMusic, { type CustomTrack } from "./CustomMusic";
import { RankingBoard } from "./RankingBoard";
import { RankEmblem } from "./Stage";
import type { Best } from "./RhythmGame";

const DISP = "font-['Arial_Black','Segoe_UI_Black',Impact,sans-serif] font-black italic";
const KR = "font-['Nanum_Gothic',sans-serif]";
const fmtTime = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const CUSTOM_COLOR = "#22D3EE";

export default function SongSelect({
  songs,
  sel,
  onSel,
  charts,
  diffs,
  diff,
  onDiff,
  best,
  track,
  onTrack,
  customCharts,
  song,
  onStart,
  starting,
  launching,
  canStart,
  err,
  onBack,
  onSettings,
  blocked,
  fs,
  onToggleFs,
}: {
  songs: Song[];
  sel: number;
  onSel: (i: number) => void;
  charts: Record<string, Partial<Record<Difficulty, Chart>>>;
  diffs: typeof DIFFICULTIES;
  diff: Difficulty;
  onDiff: (d: Difficulty) => void;
  best: Record<string, Best>;
  track: CustomTrack | null;
  onTrack: (t: CustomTrack | null) => void;
  customCharts: Record<Difficulty, Chart> | null;
  /** 지금 고른 곡 (내 음악인데 파일이 없으면 null) */
  song: Song | null;
  onStart: () => void;
  starting: boolean;
  launching: boolean;
  canStart: boolean;
  err: string;
  onBack: () => void;
  onSettings: () => void;
  blocked: boolean;
  fs: boolean;
  onToggleFs: () => void;
}) {
  // 내 음악: 재킷을 눌러도 파일 고르기
  const pickRef = useRef<(() => void) | null>(null);
  const custom = sel === songs.length;
  const practice = !custom && !!songs[sel]?.practice;
  const color = custom ? CUSTOM_COLOR : (song?.color ?? CUSTOM_COLOR);
  const chartOf = (d: Difficulty): Chart | null =>
    custom ? (customCharts?.[d] ?? null) : (charts[songs[sel].id][d] ?? null);
  const bestKey = (d: Difficulty) => (song ? `${song.id}:${d}` : "");
  const b = song ? best[bestKey(diff)] : undefined;
  const diffInfo = DIFFICULTIES.find((d) => d.key === diff)!;
  const curChart = chartOf(diff);

  // 곡 검색: 글자가 바뀔 때마다(0.25초 디바운스) 목록 자체를 걸러 냄
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDq(q), 250);
    return () => clearTimeout(id);
  }, [q]);
  const searchRef = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => {
    const norm = (x: string) => x.toLowerCase().replace(/\s+/g, "");
    const k = norm(dq);
    // 내 음악은 목록 밖(오른쪽 맨 위 카드)이라 검색 대상은 곡만
    const all = songs.map((s, i) => ({ i, text: `${s.title} ${s.artist ?? ""} ${s.desc}` }));
    return all.filter((x) => !k || norm(x.text).includes(k)).map((x) => x.i);
  }, [dq, songs]);
  // 걸러진 목록에 지금 곡이 없으면 첫 곡으로 (내 음악을 고른 중이면 그대로)
  useEffect(() => {
    if (!custom && visible.length && !visible.includes(sel)) onSel(visible[0]);
  }, [visible, sel, onSel, custom]);

  const move = (dir: number) => {
    if (!visible.length) return;
    const k = visible.indexOf(sel);
    // 내 음악에서 ↓면 목록 맨 위 곡, ↑면 맨 아래 곡으로
    const j =
      k < 0 ? (dir > 0 ? 0 : visible.length - 1) : (k + dir + visible.length) % visible.length;
    onSel(visible[j]);
    sfx("ui-move", 0.6);
  };
  const pickCustom = () => {
    if (custom) {
      // 이미 내 음악: 파일이 있으면 시작, 없으면 파일 고르기
      if (track && canStart && !starting) onStart();
      else pickRef.current?.();
      return;
    }
    onSel(songs.length);
    sfx("ui-move", 0.6);
  };
  const moveDiff = (dir: number) => {
    const i = diffs.findIndex((d) => d.key === diff);
    const j = Math.max(0, Math.min(diffs.length - 1, i + dir));
    if (j !== i) {
      onDiff(diffs[j].key);
      sfx("ui-move", 0.6);
    }
  };

  useEffect(() => {
    if (blocked || launching) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea")) return;
      if (e.code === "ArrowUp" || e.code === "ArrowDown") {
        e.preventDefault();
        move(e.code === "ArrowUp" ? -1 : 1);
      } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        e.preventDefault();
        moveDiff(e.code === "ArrowLeft" ? -1 : 1);
      } else if (e.code === "Enter") {
        e.preventDefault();
        if (canStart && !starting) onStart();
      } else if (e.code === "Escape") {
        e.preventDefault();
        sfx("ui-back", 0.7);
        onBack();
      } else if (e.code === "KeyS") {
        e.preventDefault();
        onSettings();
      } else if (e.code === "Slash" || e.code === "KeyF") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.code === "KeyM") {
        e.preventDefault();
        if (!custom) pickCustom();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // 고른 곡이 목록 가운데 오게
  const listRef = useRef<HTMLDivElement>(null);
  // (scrollIntoView는 바깥 프레임·페이지까지 같이 스크롤해서 화면이 밀려 올라가므로 목록만 직접 굴림)
  useEffect(() => {
    const box = listRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-i="${sel}"]`);
    if (!box || !el) return;
    box.scrollTo({
      top: el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2,
      behavior: "smooth",
    });
  }, [sel]);

  const cover = custom ? (song?.cover ?? CUSTOM_COVER) : song ? coverOf(song) : undefined;

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#06041a]">
      {/* 배경: 고른 곡 커버를 크게 흐리게 */}
      {cover ? (
        <img
          key={cover}
          src={cover}
          alt=""
          className="absolute inset-0 h-full w-full scale-125 object-cover opacity-45 blur-[2.4cqw] [animation:modal-fade_400ms_ease-out]"
        />
      ) : (
        <img
          src="/rhythm/play-blue.webp"
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-50"
        />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(6,4,26,0.55)_0%,rgba(6,4,26,0.35)_45%,rgba(6,4,26,0.85)_60%)]" />
      <div
        className="absolute -left-[10cqw] top-[10cqw] h-[40cqw] w-[40cqw] rounded-full opacity-30 blur-[6cqw]"
        style={{ background: color }}
      />

      {/* 위 */}
      <div className="absolute inset-x-0 top-0 z-30 flex h-[5.4cqw] items-center justify-between border-b border-white/10 bg-black/35 px-[2.4cqw] backdrop-blur-[2px]">
        <div className="flex items-baseline gap-[1.2cqw]">
          <span className={`${DISP} text-[2.2cqw] tracking-[0.06em] text-white`}>SELECT MUSIC</span>
          <span className={`${KR} text-[1.1cqw] text-white/45`}>곡 선택</span>
        </div>
        <div className="flex items-center gap-[0.6cqw]">
          <TopBtn onClick={onSettings}>
            ⚙ 설정 <K>S</K>
          </TopBtn>
          <TopBtn onClick={onToggleFs}>{fs ? "✕ 창모드" : "⛶ 전체화면"}</TopBtn>
        </div>
      </div>

      {/* 왼쪽: 재킷 + 정보 + 난이도 */}
      <div className="absolute top-[7cqw] bottom-[6.2cqw] left-[2.6cqw] flex w-[44cqw] flex-col gap-[1.1cqw]">
        <div className="flex gap-[1.8cqw]">
          <div
            key={sel}
            className={`relative h-[15cqw] w-[15cqw] shrink-0 overflow-hidden rounded-[1cqw] border-[0.2cqw] [animation:bd-slam_380ms_cubic-bezier(.2,.9,.3,1.1)] ${custom ? "cursor-pointer" : ""}`}
            style={{ borderColor: color, boxShadow: `0 0 2.4cqw ${color}88` }}
            onClick={custom ? () => pickRef.current?.() : undefined}
            title={custom ? "눌러서 음악 파일 고르기" : undefined}
          >
            {cover ? (
              <img src={cover} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-[0.6cqw] bg-[linear-gradient(135deg,#0e3a4a,#1e1b4b)]">
                <span className="text-[6cqw]">🎵</span>
                <span className={`${DISP} text-[1.8cqw] text-white`}>MY MUSIC</span>
              </div>
            )}
            <span className="pointer-events-none absolute inset-y-0 left-0 w-[5cqw] bg-white/15 [animation:bd-sweep_3s_ease-in-out_infinite]" />
          </div>
          <div
            key={`i${sel}`}
            className="flex min-w-0 flex-1 flex-col justify-center [animation:bd-slide-left_300ms_ease-out]"
          >
            {custom ? (
              <div className="flex h-[15cqw] flex-col gap-[0.5cqw]">
                <div className="font-mono text-[1cqw] tracking-[0.25em]" style={{ color }}>
                  MY MUSIC
                </div>
                <div className="min-h-0 flex-1">
                  <CustomMusic track={track} onTrack={onTrack} getCtx={audio} pickRef={pickRef} />
                </div>
              </div>
            ) : (
              song && (
                <>
                  <div className="font-mono text-[1cqw] tracking-[0.25em]" style={{ color }}>
                    No.{String(sel + 1).padStart(2, "0")}
                  </div>
                  <div
                    className={`${KR} mt-[0.3cqw] text-[2.6cqw] leading-tight font-extrabold break-keep text-white drop-shadow-[0_0.2cqw_0_#000]`}
                  >
                    {song.title}
                  </div>
                  {song.artist && (
                    <div className="mt-[0.3cqw] font-mono text-[1.25cqw] font-bold tracking-[0.1em] text-white/85">
                      {song.artist}
                    </div>
                  )}
                  <div
                    className={`${KR} mt-[0.5cqw] line-clamp-2 text-[1.15cqw] leading-snug text-white/60`}
                  >
                    {song.desc}
                  </div>
                  <div className="mt-[0.9cqw] flex gap-[1.2cqw] font-mono text-[1.15cqw] text-white/75">
                    <span>
                      <span className="text-white/40">BPM </span>
                      {Math.round(song.bpmLabel ?? song.bpm)}
                    </span>
                    <span>
                      <span className="text-white/40">TIME </span>
                      {fmtTime(song.duration)}
                    </span>
                  </div>
                </>
              )
            )}
          </div>
        </div>

        {/* 난이도 */}
        <div className="flex gap-[0.6cqw]">
          {DIFFICULTIES.map((d) => {
            const has = diffs.some((x) => x.key === d.key);
            const c = has ? chartOf(d.key) : null;
            const on = d.key === diff;
            const bb = song ? best[bestKey(d.key)] : undefined;
            return (
              <button
                key={d.key}
                type="button"
                disabled={!has || !c}
                onClick={() => {
                  onDiff(d.key);
                  sfx("ui-move", 0.6);
                }}
                className={`relative flex flex-1 cursor-pointer flex-col items-center rounded-[0.7cqw] border py-[0.8cqw] transition-all disabled:cursor-not-allowed disabled:opacity-25 ${
                  on
                    ? "-translate-y-[0.3cqw] bg-black/60"
                    : "border-white/10 bg-black/35 hover:border-white/30"
                }`}
                style={
                  on ? { borderColor: d.color, boxShadow: `0 0 1.4cqw ${d.color}77` } : undefined
                }
              >
                <span
                  className={`${KR} text-[1.05cqw] font-bold whitespace-nowrap`}
                  style={{ color: d.color }}
                >
                  {d.label}
                </span>
                <span
                  className={`${DISP} -translate-x-[0.15cqw] pr-[0.15cqw] text-center text-[2cqw] leading-tight text-white tabular-nums`}
                >
                  {c ? c.level : "-"}
                </span>
                {bb && (
                  <span className="absolute -top-[0.7cqw] -right-[0.5cqw] font-mono text-[0.8cqw] font-bold">
                    {bb.ap ? (
                      <span className="rounded bg-[#7DF9FF] px-[0.3cqw] text-black">AP</span>
                    ) : bb.fc ? (
                      <span className="rounded bg-[#FDE047] px-[0.3cqw] text-black">FC</span>
                    ) : null}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 기록 */}
        <div className="flex h-[4.8cqw] shrink-0 items-center gap-[1.4cqw] rounded-[0.9cqw] border border-white/10 bg-black/45 px-[1.4cqw]">
          {b ? (
            <>
              <RankEmblem rank={b.rank} className="h-[4cqw] w-[4cqw]" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-mono text-[0.95cqw] tracking-[0.2em] text-white/45">
                  BEST SCORE
                </span>
                <span className={`${DISP} text-[2.2cqw] leading-none text-white tabular-nums`}>
                  {b.score.toLocaleString("en-US")}
                </span>
              </div>
              <div className="flex flex-col items-end font-mono text-[1.1cqw] text-white/70">
                <span>{b.acc.toFixed(2)}%</span>
                <span className="font-bold">
                  {b.ap ? (
                    <span className="text-[#7DF9FF]">ALL PERFECT</span>
                  ) : b.fc ? (
                    <span className="text-[#FDE047]">FULL COMBO</span>
                  ) : (
                    <span className="text-white/35">CLEAR</span>
                  )}
                </span>
              </div>
            </>
          ) : (
            <span className={`${KR} text-[1.2cqw] text-white/40`}>
              {curChart
                ? `아직 기록이 없어요 · 노트 ${curChart.notes.length}개`
                : "파일을 넣으면 채보가 만들어져요"}
            </span>
          )}
        </div>
        {/* 랭킹: 내 기록 바로 아래 */}
        <div className="flex min-h-0 flex-1 flex-col rounded-[0.9cqw] border border-white/10 bg-black/45 px-[1.4cqw] py-[0.8cqw]">
          <div className="flex items-baseline justify-between gap-[1cqw]">
            <span className={`${DISP} text-[1.3cqw] tracking-[0.12em] text-white`}>
              {custom ? "HOW IT WORKS" : practice ? "PRACTICE" : "RANKING"}
            </span>
            <span className={`${KR} text-[0.95cqw] text-white/45`}>
              {custom || practice
                ? "랭킹 없음 · 기록은 이 브라우저에만"
                : `${diffInfo.label} TOP 10`}
            </span>
          </div>
          {(custom || practice) && (
            <ul
              className={`${KR} bd-scroll mt-[0.6cqw] flex min-h-0 flex-col gap-[0.4cqw] overflow-y-auto text-[1.15cqw] leading-snug break-keep text-white/75`}
            >
              {(practice
                ? [
                    "계단 → 트릴 → 잭 → 동시치기 → 롱노트 → 섞어서, 구간마다 8마디",
                    "어려울수록 잘게 쪼개고 잭은 길게, 동시치기는 자주",
                    "지금 구간 이름은 진행 바 아래에",
                  ]
                : [
                    "드럼·박자를 분석해서 쉬움~나이트메어 5단계 채보를 바로 만들어요",
                    "파일은 서버로 올라가지 않고 이 브라우저 안에서만 쓰여요",
                    "파일에 앨범 사진이 있으면 재킷으로 보여 줘요",
                  ]
              ).map((t, i) => (
                <li
                  key={t}
                  className="flex shrink-0 items-center gap-[0.8cqw] rounded-[0.5cqw] border border-white/[0.07] bg-white/[0.04] py-[0.25cqw] pr-[0.9cqw] pl-[0.4cqw]"
                >
                  <span
                    className={`${DISP} flex h-[2cqw] w-[2.6cqw] shrink-0 -skew-x-12 items-center justify-center rounded-[0.35cqw] text-[1.05cqw] text-[#0b1020]`}
                    style={{ background: CUSTOM_COLOR }}
                  >
                    <span className="skew-x-12">{String(i + 1).padStart(2, "0")}</span>
                  </span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          )}
          {!custom && !practice && song && (
            <div className="bd-scroll mt-[0.4cqw] min-h-0 flex-1 overflow-y-auto">
              <RankingBoard songId={song.id} diff={diff} label="" game />
            </div>
          )}
        </div>
      </div>

      {/* 오른쪽 맨 위: 내 음악 — 곡 목록과 따로, 눈에 띄게 */}
      <button
        type="button"
        onClick={pickCustom}
        title={custom ? (track ? "시작" : "눌러서 음악 파일 고르기") : "내 음악으로 플레이 (M)"}
        className={`group absolute top-[6.3cqw] right-[2.4cqw] z-10 flex h-[5.4cqw] w-[42.6cqw] cursor-pointer items-center gap-[1.1cqw] overflow-hidden rounded-[0.8cqw] border pr-[1.2cqw] pl-[0.7cqw] text-left transition-all duration-200 hover:scale-[1.015] ${
          custom ? "border-white/70" : ""
        }`}
        style={{
          background: custom
            ? `linear-gradient(90deg, ${CUSTOM_COLOR}e6, #6366F1d0 70%, #8B5CF6c0)`
            : `linear-gradient(90deg, ${CUSTOM_COLOR}45, #6366F135 60%, #0b0820d0)`,
          borderColor: custom ? undefined : `${CUSTOM_COLOR}99`,
          boxShadow: `0 0 ${custom ? 2.4 : 1.3}cqw ${CUSTOM_COLOR}${custom ? "aa" : "55"}`,
        }}
      >
        <span className="pointer-events-none absolute inset-y-0 left-0 w-[5cqw] bg-white/20 [animation:bd-sweep_2.6s_ease-in-out_infinite]" />
        <span className="relative h-[4cqw] w-[4cqw] shrink-0 overflow-hidden rounded-[0.5cqw] border border-white/30 bg-[#0e3a4a]">
          <img src={track?.cover ?? CUSTOM_COVER} alt="" className="h-full w-full object-cover" />
        </span>
        <span className="relative flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline gap-[0.8cqw]">
            <span className={`${DISP} text-[1.6cqw] leading-tight tracking-[0.06em] text-white`}>
              MY MUSIC
            </span>
            <span className={`${KR} text-[1.25cqw] font-extrabold text-white`}>
              내 음악으로 플레이
            </span>
          </span>
          <span className={`${KR} truncate text-[1cqw] text-white/80`}>
            {track
              ? `${track.name} · ${custom ? "Enter로 시작" : "다시 고르면 이어서"}`
              : "mp3를 넣으면 쉬움~나이트메어 채보를 바로 만들어 줘요"}
          </span>
        </span>
        <span className="relative shrink-0">
          <K>M</K>
        </span>
      </button>

      {/* 오른쪽: 곡 검색 + 곡 목록 */}
      <label className="absolute top-[12.3cqw] right-[2.4cqw] z-10 flex w-[42.6cqw] cursor-text items-center gap-[0.9cqw] rounded-[0.7cqw] border border-white/10 bg-black/55 py-[0.45cqw] pr-[1cqw] pl-[0.6cqw] transition-colors focus-within:border-[#A78BFA]/70 focus-within:bg-black/70">
        <span className="flex h-[2.6cqw] w-[2.6cqw] shrink-0 items-center justify-center rounded-[0.45cqw] bg-white/10">
          <svg
            viewBox="0 0 24 24"
            className="h-[1.4cqw] w-[1.4cqw]"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.6}
            strokeLinecap="round"
          >
            <circle cx="10.5" cy="10.5" r="6.5" className="text-white/70" stroke="currentColor" />
            <path d="M15.5 15.5L21 21" className="text-white/70" stroke="currentColor" />
          </svg>
        </span>
        <input
          ref={searchRef}
          type="text"
          inputMode="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              move(e.key === "ArrowUp" ? -1 : 1);
            } else if (e.key === "Enter") {
              e.preventDefault();
              setDq(q);
              searchRef.current?.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setQ("");
              setDq("");
              searchRef.current?.blur();
            }
          }}
          placeholder="곡 이름으로 찾기"
          aria-label="곡 검색"
          className={`${KR} min-w-0 flex-1 bg-transparent text-[1.25cqw] font-bold text-white placeholder:font-normal placeholder:text-white/35 focus:outline-none`}
        />
        {q ? (
          <button
            type="button"
            aria-label="검색 지우기"
            onClick={() => {
              setQ("");
              setDq("");
            }}
            className="shrink-0 cursor-pointer rounded-full px-[0.4cqw] font-mono text-[1.1cqw] text-white/50 hover:text-white"
          >
            ✕
          </button>
        ) : (
          <K>F</K>
        )}
        <span className="shrink-0 font-mono text-[0.95cqw] text-white/40">{visible.length}곡</span>
      </label>
      <div
        ref={listRef}
        className="absolute top-[16.2cqw] right-0 bottom-[5cqw] w-[48cqw] overflow-y-auto py-[7cqw] pr-[2.4cqw] pl-[3cqw] [mask-image:linear-gradient(to_bottom,transparent,#000_2.4cqw,#000_calc(100%-2.4cqw),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {visible.length === 0 && (
          <p className={`${KR} pt-[2cqw] text-center text-[1.3cqw] text-white/45`}>
            검색 결과가 없어요
          </p>
        )}
        {songs.map((s, i) => {
          if (!visible.includes(i)) return null;
          const on = i === sel;
          const c = s.color;
          const lv = charts[s.id][diff]?.level;
          const bb = best[`${s.id}:${diff}`];
          return (
            <button
              key={s.id}
              data-i={i}
              type="button"
              onClick={() => {
                if (on) {
                  if (canStart && !starting) onStart();
                } else {
                  onSel(i);
                  sfx("ui-move", 0.6);
                }
              }}
              className={`relative mb-[0.7cqw] flex w-full cursor-pointer items-center gap-[1.2cqw] overflow-hidden rounded-[0.7cqw] border text-left transition-all duration-200 ${
                on
                  ? "-ml-[2cqw] w-[calc(100%+2cqw)] border-white/60 py-[0.9cqw] pr-[1.4cqw] pl-[1cqw]"
                  : "border-white/10 bg-black/45 py-[0.55cqw] pr-[1.2cqw] pl-[0.8cqw] opacity-80 hover:opacity-100"
              }`}
              style={
                on
                  ? {
                      background: `linear-gradient(90deg, ${c}e0, ${c}55 70%, #0b0820cc)`,
                      boxShadow: `0 0 2cqw ${c}66`,
                    }
                  : undefined
              }
            >
              {/* 재킷 + 오른쪽 아래 모서리에 내 최고 랭크 */}
              <div className="relative shrink-0">
                <div
                  className={`overflow-hidden rounded-[0.5cqw] border border-white/20 bg-[#0e3a4a] ${on ? "h-[5cqw] w-[5cqw]" : "h-[3.6cqw] w-[3.6cqw]"}`}
                >
                  <img src={COVERS[s.id]?.src} alt="" className="h-full w-full object-cover" />
                </div>
                {bb && (
                  <RankEmblem
                    rank={bb.rank}
                    className={`absolute -right-[1.3cqw] -bottom-[0.45cqw] drop-shadow-[0_0.1cqw_0.3cqw_rgba(0,0,0,0.8)] ${on ? "h-[3.6cqw] w-[3.6cqw]" : "h-[2.9cqw] w-[2.9cqw]"}`}
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={`${KR} truncate font-extrabold text-white ${on ? "text-[1.7cqw] drop-shadow-[0_0.15cqw_0_rgba(0,0,0,0.6)]" : "text-[1.35cqw]"}`}
                >
                  {s.title}
                </div>
                <div
                  className={`truncate font-mono text-[0.95cqw] ${on ? "text-white/85" : "text-white/40"}`}
                >
                  {s.desc}
                </div>
              </div>
              <div className="flex w-[4.2cqw] shrink-0 flex-col items-center">
                <span className="font-mono text-[0.8cqw] text-white/60">Lv</span>
                <span className={`${DISP} text-[1.8cqw] leading-none text-white`}>{lv ?? "-"}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* 아래 */}
      <div className="absolute inset-x-0 bottom-0 flex h-[5cqw] items-center justify-between border-t border-white/10 bg-black/55 px-[2.4cqw]">
        <div className="flex items-center gap-[1.4cqw] font-mono text-[1cqw] text-white/50">
          <span>
            <K>↑</K>
            <K>↓</K> 곡
          </span>
          <span>
            <K>←</K>
            <K>→</K> 난이도
          </span>
          <span>
            <K>Enter</K> 시작
          </span>
          <span>
            <K>F</K> 검색
          </span>
          <span>
            <K>M</K> 내 음악
          </span>
          <span>
            <K>Esc</K> 타이틀
          </span>
          {err && <span className="text-red-300">{err}</span>}
        </div>
        <button
          type="button"
          disabled={!canStart || starting}
          onClick={onStart}
          className={`${DISP} relative -skew-x-12 cursor-pointer overflow-hidden rounded-[0.6cqw] px-[3.4cqw] py-[0.7cqw] text-[1.9cqw] tracking-[0.12em] text-white transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40`}
          style={{
            background: `linear-gradient(90deg, ${diffInfo.color}, ${color})`,
            boxShadow: `0 0 1.6cqw ${color}99`,
          }}
        >
          <span className="pointer-events-none absolute inset-y-0 left-0 w-[4cqw] bg-white/30 [animation:bd-sweep_1.8s_ease-in-out_infinite]" />
          <span className="inline-block skew-x-12">{starting ? "LOADING…" : "START"}</span>
        </button>
      </div>

      {/* 시작 연출: 재킷이 들어오고 GET READY */}
      {launching && song && (
        <div className="absolute inset-0 z-50 flex items-center overflow-hidden bg-[#05030f]/90 [animation:bd-launch_1.5s_ease-out]">
          <div
            className="absolute inset-x-0 top-1/2 h-[18cqw] -translate-y-1/2 -skew-y-3"
            style={{ background: `linear-gradient(90deg, transparent, ${color}55, transparent)` }}
          />
          <div className="relative ml-[12cqw] flex items-center gap-[3cqw]">
            <div
              className="h-[22cqw] w-[22cqw] overflow-hidden rounded-[1cqw] border-[0.25cqw] [animation:bd-slam_500ms_cubic-bezier(.2,.9,.3,1.1)]"
              style={{ borderColor: color, boxShadow: `0 0 4cqw ${color}` }}
            >
              {cover ? (
                <img src={cover} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#0e3a4a,#1e1b4b)] text-[8cqw]">
                  🎵
                </div>
              )}
            </div>
            <div className="[animation:bd-slide-left_500ms_150ms_ease-out_backwards]">
              <div className={`${KR} text-[1.4cqw] font-bold`} style={{ color: diffInfo.color }}>
                {diffInfo.label} · Lv.{curChart?.level ?? "-"}
              </div>
              <div
                className={`${KR} mt-[0.4cqw] line-clamp-2 max-w-[44cqw] text-[3cqw] leading-tight font-extrabold break-all text-white`}
              >
                {song.title}
              </div>
              {song.artist && (
                <div className="mt-[0.3cqw] font-mono text-[1.4cqw] font-bold tracking-[0.1em] text-white/80">
                  {song.artist}
                </div>
              )}
              <div
                className={`${DISP} mt-[1.6cqw] text-[3cqw] tracking-[0.3em] text-white [animation:bd-blink_0.6s_ease-in-out_infinite]`}
              >
                GET READY
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function K({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-[0.15cqw] inline-flex min-w-[1.7cqw] items-center justify-center rounded-[0.35cqw] border border-white/25 border-b-[0.2cqw] bg-white/10 px-[0.35cqw] font-mono text-[0.9cqw] leading-tight text-white/85">
      {children}
    </kbd>
  );
}

function TopBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center gap-[0.4cqw] rounded-[0.6cqw] border border-white/15 bg-white/5 px-[1cqw] py-[0.35cqw] font-['Nanum_Gothic',sans-serif] text-[1.1cqw] font-bold text-white/75 transition-colors hover:border-white/40 hover:text-white"
    >
      {children}
    </button>
  );
}
