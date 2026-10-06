"use client";

import { useEffect, useRef, useState } from "react";
import { analyzeAudio, displayBpm, rescaleTempo, type Analysis } from "@/lib/rhythm/analyze";

/** 사용자가 넣은 곡 (메모리에만 — 새로고침하면 다시 골라야 함) */
export interface CustomTrack {
  key: string;
  name: string;
  buffer: AudioBuffer;
  analysis: Analysis;
  /** 파일에 들어 있던 앨범 사진 (object URL) */
  cover?: string;
}

/** mp3(ID3v2 APIC/PIC)에 든 앨범 사진 꺼내기 — 없거나 못 읽으면 null */
function findCover(ab: ArrayBuffer): Blob | null {
  try {
    const b = new Uint8Array(ab);
    if (b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return null; // "ID3"
    const ver = b[3];
    const syncsafe = (i: number) => (b[i] << 21) | (b[i + 1] << 14) | (b[i + 2] << 7) | b[i + 3];
    const end = Math.min(b.length, 10 + syncsafe(6));
    let p = 10;
    if (b[5] & 0x40)
      p += ver === 4 ? syncsafe(10) : ((b[10] << 24) | (b[11] << 16) | (b[12] << 8) | b[13]) + 4; // 확장 헤더
    const str = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
    while (p + 10 < end) {
      const v2 = ver === 2;
      const id = str(p, v2 ? 3 : 4);
      if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
      const size = v2
        ? (b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5]
        : ver === 4
          ? syncsafe(p + 4)
          : ((b[p + 4] << 24) | (b[p + 5] << 16) | (b[p + 6] << 8) | b[p + 7]) >>> 0;
      const body = p + (v2 ? 6 : 10);
      if (size <= 0 || body + size > b.length) break;
      if (id === "APIC" || id === "PIC") {
        const enc = b[body];
        let i = body + 1;
        let mime = "image/jpeg";
        if (id === "PIC") {
          mime = str(i, 3).toUpperCase() === "PNG" ? "image/png" : "image/jpeg";
          i += 3;
        } else {
          const z = b.indexOf(0, i);
          mime = str(i, z - i) || mime;
          if (!mime.includes("/")) mime = `image/${mime.toLowerCase()}`;
          i = z + 1;
        }
        i += 1; // 그림 종류
        // 설명 글 (UTF-16이면 0x00 0x00으로 끝남)
        if (enc === 1 || enc === 2) {
          while (i + 1 < body + size && !(b[i] === 0 && b[i + 1] === 0)) i += 2;
          i += 2;
        } else {
          while (i < body + size && b[i] !== 0) i++;
          i += 1;
        }
        if (i < body + size) return new Blob([b.slice(i, body + size)], { type: mime });
      }
      p = body + size;
    }
  } catch {}
  return null;
}

const MAX_BYTES = 40 * 1024 * 1024;
const MAX_SEC = 12 * 60;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const hashOf = (s: string) =>
  ([...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0).toString(
    36
  );
const KR = "font-['Nanum_Gothic',sans-serif]";
const mini =
  "cursor-pointer rounded-[0.4cqw] border border-white/15 px-[0.6cqw] py-[0.1cqw] font-mono text-[1cqw] text-white/70 hover:border-[#22D3EE] hover:text-white disabled:cursor-not-allowed disabled:opacity-30";

/** 곡 선택 화면 왼쪽: 내 음악 파일 넣기 → 분석 → 곡 정보 */
export default function CustomMusic({
  track,
  onTrack,
  getCtx,
  pickRef,
}: {
  track: CustomTrack | null;
  onTrack: (t: CustomTrack | null) => void;
  getCtx: () => Promise<AudioContext>;
  /** 밖(재킷 누르기)에서 파일 고르기 창을 열 수 있게 */
  pickRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const [busy, setBusy] = useState<{ ratio: number; label: string } | null>(null);
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pick = () => {
    if (!busy) inputRef.current?.click();
  };
  useEffect(() => {
    if (pickRef) pickRef.current = pick;
  });

  const load = async (file: File) => {
    setErr("");
    if (file.size > MAX_BYTES) return setErr("파일이 너무 커요 (40MB까지).");
    setBusy({ ratio: 0, label: "파일 읽는 중" });
    try {
      const ctx = await getCtx();
      const raw = await file.arrayBuffer();
      const pic = findCover(raw); // 디코딩하면 버퍼가 비워져서 먼저
      const buffer = await ctx.decodeAudioData(raw);
      if (buffer.duration > MAX_SEC) throw new Error("12분이 넘는 곡은 분석할 수 없어요.");
      if (buffer.duration < 15) throw new Error("15초보다 짧은 파일은 분석할 수 없어요.");
      const analysis = await analyzeAudio(buffer, (ratio, label) => setBusy({ ratio, label }));
      if (analysis.onsets.length < 20)
        throw new Error("박자를 찾지 못했어요. 다른 곡으로 해보세요.");
      const key = hashOf(`${file.name}:${file.size}:${buffer.duration.toFixed(2)}`);
      if (track?.cover) URL.revokeObjectURL(track.cover);
      onTrack({
        key,
        name: file.name.replace(/\.[^.]+$/, ""),
        buffer,
        analysis,
        cover: pic ? URL.createObjectURL(pic) : undefined,
      });
    } catch (e) {
      console.error(e);
      setErr(
        e instanceof Error && /분석|박자/.test(e.message)
          ? e.message
          : "이 파일을 읽지 못했어요. mp3·wav·ogg·m4a 파일인지 확인해주세요."
      );
    } finally {
      setBusy(null);
    }
  };
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="audio/*,.mp3,.wav,.ogg,.m4a"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) load(f);
      }}
    />
  );

  if (!track)
    return (
      <div className="flex h-full flex-col gap-[0.6cqw]">
        <div
          role="button"
          tabIndex={0}
          onClick={pick}
          onKeyDown={(e) => e.key === "Enter" && pick()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f && !busy) load(f);
          }}
          className={`flex flex-1 cursor-pointer flex-col items-center justify-center gap-[1cqw] rounded-[1cqw] border-[0.2cqw] border-dashed px-[2cqw] text-center transition-colors ${
            drag
              ? "border-[#22D3EE] bg-[#22D3EE]/10"
              : "border-white/20 bg-black/35 hover:border-white/40"
          }`}
        >
          {busy ? (
            <>
              <p className={`${KR} text-[1.4cqw] text-white/85`}>{busy.label}…</p>
              <div className="h-[0.5cqw] w-[80%] overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-gradient-to-r from-[#22D3EE] to-[#A78BFA] transition-[width]"
                  style={{ width: `${Math.round(busy.ratio * 100)}%` }}
                />
              </div>
            </>
          ) : (
            <>
              <span className="text-[2.4cqw]">🎵</span>
              <p className={`${KR} text-[1.25cqw] leading-snug font-bold break-keep text-white/90`}>
                음악 파일을 끌어다 놓거나
                <br />
                눌러서 고르세요
              </p>
              <p className="font-mono text-[1.05cqw] text-white/40">
                mp3 · wav · ogg · m4a · 12분 이하
              </p>
            </>
          )}
          {input}
        </div>
        {err && <p className="text-center font-mono text-[1.1cqw] text-red-300">{err}</p>}
      </div>
    );

  // 곡이 이미 있는 상태에서 다른 파일을 넣어도 분석하는 동안은 진행 상황을 보여 줌
  if (busy)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-[1cqw] rounded-[1cqw] border-[0.2cqw] border-dashed border-[#22D3EE]/60 bg-black/35 px-[2cqw] text-center">
        <span className="text-[2.4cqw]">🎵</span>
        <p className={`${KR} text-[1.4cqw] text-white/85`}>{busy.label}…</p>
        <div className="h-[0.5cqw] w-[80%] overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-[#22D3EE] to-[#A78BFA] transition-[width]"
            style={{ width: `${Math.round(busy.ratio * 100)}%` }}
          />
        </div>
        {input}
      </div>
    );
  const a = track.analysis;
  return (
    <div className="flex flex-col gap-[0.6cqw]">
      <p
        className={`${KR} line-clamp-2 text-[2cqw] leading-tight font-extrabold break-all text-white`}
      >
        {track.name}
      </p>
      <p className="flex flex-wrap items-center gap-x-[1.2cqw] gap-y-[0.4cqw] font-mono text-[1.2cqw] text-white/55">
        <span>{fmt(a.duration)}</span>
        <span className="flex items-center gap-[0.5cqw]">
          <span className="text-white/85">{displayBpm(a).toFixed(1)} BPM</span>
          <button
            type="button"
            className={mini}
            title="박이 너무 느리게 잡혔으면"
            onClick={() => onTrack({ ...track, analysis: rescaleTempo(a, 2) })}
            disabled={a.bpm * 2 > 260}
          >
            ×2
          </button>
          <button
            type="button"
            className={mini}
            title="박이 너무 빠르게 잡혔으면"
            onClick={() => onTrack({ ...track, analysis: rescaleTempo(a, 0.5) })}
            disabled={a.bpm / 2 < 50}
          >
            ÷2
          </button>
        </span>
        <button type="button" className={mini} onClick={pick}>
          다른 파일
        </button>
        {input}
      </p>
      {err && <p className="font-mono text-[1.1cqw] text-red-300">{err}</p>}
    </div>
  );
}
