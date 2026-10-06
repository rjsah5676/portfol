"use client";

import { useRef, useState } from "react";
import type { StaticImageData } from "next/image";
import type { Song } from "@/lib/rhythm/music";
import jiljuCover from "@/img/rhythm/jilju.jpg";
import natsuCover from "@/img/rhythm/natsukasumi.jpg";
import rinkakuCover from "@/img/rhythm/rinkaku.jpg";
import newdimCover from "@/img/rhythm/newdim.jpg";
import monarchCover from "@/img/rhythm/monarch.jpg";
import velocityCover from "@/img/rhythm/velocity.jpg";
import fullcomboCover from "@/img/rhythm/fullcombo.jpg";
import animaCover from "@/img/rhythm/anima.jpg";
import freedomdiveCover from "@/img/rhythm/freedomdive.jpg";
import aragamiCover from "@/img/rhythm/aragami.jpg";

export const COVERS: Record<string, StaticImageData> = {
  jilju: jiljuCover,
  natsukasumi: natsuCover,
  rinkaku: rinkakuCover,
  newdim: newdimCover,
  monarch: monarchCover,
  velocity: velocityCover,
  fullcombo: fullcomboCover,
  anima: animaCover,
  freedomdive: freedomdiveCover,
  aragami: aragamiCover,
};

/** 내 음악에 앨범 사진이 없을 때 쓰는 기본 재킷 */
export const CUSTOM_COVER = "/rhythm/custom-cover.webp";
/** 곡 재킷 주소: 곡에 따로 있으면 그것, 내장곡은 COVERS, 없으면 기본 그림 */
export const coverOf = (s: Song) => s.cover ?? COVERS[s.id]?.src ?? CUSTOM_COVER;

const mod = (n: number, m: number) => ((n % m) + m) % m;
/** 대소문자·공백 무시 */
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const fmtTime = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/**
 * < [옆] [가운데] [옆] > 형태로 돌려 고르는 곡 선택.
 * pos는 끝없이 늘어나는 가상 위치라서 한쪽으로 계속 돌려도 카드가 자연스럽게 밀려 들어온다.
 */
export default function SongCarousel({
  songs,
  pos,
  onMove,
}: {
  songs: Song[];
  pos: number;
  onMove: (delta: number) => void;
}) {
  const drag = useRef<{ x: number; id: number } | null>(null);
  const current = songs[mod(pos, songs.length)];
  const [q, setQ] = useState("");
  const matches = q.trim()
    ? songs
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => norm(`${s.title} ${s.artist ?? ""} ${s.desc}`).includes(norm(q)))
    : [];
  /** 검색 결과로 이동: 가까운 쪽으로 돌림 */
  const pick = (i: number) => {
    const n = songs.length;
    let d = mod(i - pos, n);
    if (d > n / 2) d -= n;
    if (d) onMove(d);
    setQ("");
  };

  const arrow =
    "absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-[#1C1E24]/80 font-mono text-lg text-white/70 backdrop-blur transition-colors hover:border-white/40 hover:text-white";

  return (
    <div>
      <div className="relative z-20 mx-auto max-w-xs">
        <input
          type="text"
          inputMode="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches[0]) pick(matches[0].i);
            if (e.key === "Escape") setQ("");
          }}
          placeholder="곡 검색"
          aria-label="곡 검색"
          className="w-full rounded-full border border-white/10 bg-[#1C1E24] px-4 py-2 font-mono text-sm text-white placeholder:text-white/30 focus:border-[#6C63FF]/60 focus:outline-none"
        />
        {q.trim() && (
          <ul className="absolute top-full right-0 left-0 mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-[#1C1E24] shadow-2xl">
            {matches.length === 0 ? (
              <li className="px-4 py-2.5 font-mono text-xs text-white/40">검색 결과가 없어요</li>
            ) : (
              matches.map(({ s, i }) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => pick(i)}
                    className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left hover:bg-white/5"
                  >
                    <img
                      src={coverOf(s)}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded-md object-cover"
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-sm text-white">{s.title}</span>
                      <span className="block truncate font-mono text-[11px] text-white/40">
                        {s.desc}
                      </span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      <div className="-mx-4 overflow-hidden px-4 py-4 select-none sm:mx-0">
        <div
          className="relative mx-auto h-[min(64vw,260px)] max-w-3xl touch-pan-y [perspective:1100px]"
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, id: e.pointerId };
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            if (!d || d.id !== e.pointerId) return;
            const dx = e.clientX - d.x;
            if (Math.abs(dx) > 40) onMove(dx < 0 ? 1 : -1);
          }}
          onPointerCancel={() => (drag.current = null)}
        >
          {[-2, -1, 0, 1, 2].map((k) => {
            const v = pos + k;
            const s = songs[mod(v, songs.length)];
            const a = Math.abs(k);
            const style: React.CSSProperties = {
              transform: `translateX(calc(-50% + ${k * 78}%)) translateZ(${-a * 140}px) rotateY(${-k * 28}deg) scale(${1 - a * 0.08})`,
              opacity: a === 0 ? 1 : a === 1 ? 0.55 : 0,
              filter: a === 0 ? "none" : "brightness(0.45) saturate(0.7)",
              zIndex: 5 - a,
              pointerEvents: a === 2 ? "none" : "auto",
            };
            return (
              <button
                key={v}
                type="button"
                tabIndex={k === 0 ? 0 : -1}
                aria-label={s.title}
                onClick={() => k !== 0 && onMove(k)}
                className={`absolute top-0 left-1/2 aspect-square h-full overflow-hidden rounded-2xl border transition-[transform,opacity,filter] duration-500 ease-out ${
                  k === 0
                    ? "cursor-default border-white/30 shadow-2xl"
                    : "cursor-pointer border-white/10"
                }`}
                style={{
                  ...style,
                  boxShadow: k === 0 ? `0 18px 60px -12px ${s.color}88` : undefined,
                }}
              >
                <img
                  src={coverOf(s)}
                  alt=""
                  draggable={false}
                  className="h-full w-full object-cover"
                />
              </button>
            );
          })}
          <button
            type="button"
            aria-label="이전 곡"
            className={`${arrow} left-0 sm:left-2`}
            onClick={() => onMove(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="다음 곡"
            className={`${arrow} right-0 sm:right-2`}
            onClick={() => onMove(1)}
          >
            ›
          </button>
        </div>
        <div className="mt-4 text-center">
          <div className="font-mono text-xl font-bold text-white">{current.title}</div>
          <div className="mt-1 font-mono text-xs text-white/45">
            {current.desc} · {fmtTime(current.duration - 2.5)}
          </div>
          <div className="mt-2 flex justify-center gap-1.5">
            {songs.map((s, i) => (
              <span
                key={s.id}
                className="h-1.5 w-1.5 rounded-full transition-colors"
                style={{
                  background:
                    i === mod(pos, songs.length) ? current.color : "rgba(255,255,255,0.2)",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
