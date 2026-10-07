"use client";

import { useEffect, useRef, useState } from "react";
import { audio } from "@/lib/rhythm/sfx";
import { laneColors, makeHitSound, type HitSound, type Skin } from "@/lib/rhythm/fx";
import { SONGS, type Song } from "@/lib/rhythm/music";
import { DIFFICULTIES, type Difficulty } from "@/lib/rhythm/chart";
import { visibleSec } from "./Stage";
import HoldButton from "./HoldButton";

/**
 * 싱크 맞추기 (설정 → 싱크 → 들으면서 맞추기): 게임 화면 전체를 덮는 레이어에
 * 고른 내장곡의 하이라이트(가장 시끄러운 8마디, 소리로 찾음)를 실제 채보(나이트메어, 없으면 EX)·
 * 실제 레인 크기·내 노트 속도로 돌려 보여 준다. 음악·타격음은 같은 오디오 시계에 예약되고,
 * 노트는 게임과 똑같이 "싱크(ms)"만큼 늦게/일찍 줄에 닿는다 — 타격음과 음악이 겹칠 때까지
 * +·−를 움직이면 그 값이 그대로 플레이에 쓰인다. (치는 타이밍은 자동 싱크가 따로 맞춤)
 */
const BARS = 8;
/** 실제 플레이 기어 비율 (Stage GEAR): 레인 4개 폭 = 화면 높이 × 0.449, 판정선 = 높이 × 0.828 */
const LANE_W_R = (189 * 4) / 1683;
const JUDGE_R = 1393 / 1683;

const diffOf = (s: Song): Difficulty | null =>
  s.charts?.nightmare ? "nightmare" : s.charts?.expert ? "expert" : s.charts?.hard ? "hard" : null;

export default function SyncCalibrate({
  sync,
  onSync,
  onClose,
  hitSound,
  speed,
  skin,
}: {
  sync: number;
  onSync: (v: number) => void;
  onClose: () => void;
  hitSound: HitSound;
  speed: number;
  skin: Skin;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const songs = SONGS.filter((s) => s.audio && diffOf(s));
  const [songId, setSongId] = useState("newdim");
  /** 불러오기 끝난 곡 id (songId와 다르면 로딩 중) / 실패한 곡 id */
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const loading = loadedId !== songId && failedId !== songId;
  const failed = failedId === songId;
  const live = useRef({ sync, speed });
  useEffect(() => {
    live.current = { sync, speed };
  }, [sync, speed]);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const g = canvas.getContext("2d")!;
    let raf = 0;
    let alive = true;
    // 음악 조각은 길어서(≈12초) 끝까지 참조를 들고 있다가 닫을 때 전부 멈춤 — 타격음만 오래된 걸 버림
    const musicNodes: AudioBufferSourceNode[] = [];
    const hitNodes: AudioBufferSourceNode[] = [];
    const stopAll = () => {
      for (const n of [...musicNodes, ...hitNodes]) {
        try {
          n.stop();
        } catch {}
      }
      musicNodes.length = 0;
      hitNodes.length = 0;
    };
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const song = songs.find((s) => s.id === songId);
    const diff = song ? diffOf(song) : null;
    const chart = diff ? song!.charts![diff] : undefined;
    if (!song?.audio || !chart) {
      raf = requestAnimationFrame(() => setFailedId(songId));
      return () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
      };
    }
    (async () => {
      try {
        const [ctx, res] = await Promise.all([audio(), fetch(song.audio!)]);
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        if (!alive) return;
        setLoadedId(songId);
        // 하이라이트: 마디 단위 음량이 가장 큰 8마디 — 분석기 없이 PCM 한 바퀴로
        const barSec = (60 / song.bpm) * 4;
        const off = song.beatOffset ?? 0;
        const pcm = buf.getChannelData(0);
        const sr = buf.sampleRate;
        const nBars = Math.floor((buf.duration - off) / barSec);
        const barE: number[] = [];
        for (let b = 0; b < nBars; b++) {
          const i0 = Math.floor((off + b * barSec) * sr);
          const i1 = Math.min(pcm.length, Math.floor((off + (b + 1) * barSec) * sr));
          let e = 0;
          for (let i = i0; i < i1; i += 8) e += pcm[i] * pcm[i];
          barE.push(e / Math.max(1, (i1 - i0) / 8));
        }
        let bestBar = 0;
        let bestE = -1;
        for (let b = 0; b + BARS <= nBars; b++) {
          let e = 0;
          for (let k = 0; k < BARS; k++) e += barE[b + k];
          if (e > bestE) {
            bestE = e;
            bestBar = b;
          }
        }
        const A = off + bestBar * barSec;
        const L = barSec * BARS;
        const notes = chart.notes
          .filter((n) => n.t >= A - 0.001 && n.t < A + L - 0.001)
          .map((n) => ({ rel: n.t - A, lane: n.lane }));

        const hitBuf = makeHitSound(ctx, hitSound);
        const musicGain = ctx.createGain();
        musicGain.gain.value = 0.7;
        musicGain.connect(ctx.destination);
        const hitGain = ctx.createGain();
        hitGain.gain.value = 0.55;
        hitGain.connect(ctx.destination);
        const epoch = ctx.currentTime + 0.35;
        let musicNext = 0;
        let hitLoop = 0;
        let hitIdx = 0;
        const schedule = () => {
          const horizon = ctx.currentTime + 1;
          while (epoch + musicNext * L < horizon) {
            const at = epoch + musicNext * L;
            if (at > ctx.currentTime - 0.05) {
              const src = ctx.createBufferSource();
              src.buffer = buf;
              src.connect(musicGain);
              src.start(Math.max(at, ctx.currentTime), A + Math.max(0, ctx.currentTime - at), L);
              musicNodes.push(src);
            }
            musicNext++;
          }
          // 타격음: 노트가 판정선에 닿는 시각(싱크 적용) — 음악과 같은 시계라 출력 지연도 같음
          while (hitLoop < musicNext) {
            if (hitIdx >= notes.length) {
              hitLoop++;
              hitIdx = 0;
              continue;
            }
            const at = epoch + hitLoop * L + notes[hitIdx].rel + live.current.sync / 1000;
            if (at > horizon) break;
            hitIdx++;
            if (at < ctx.currentTime - 0.02) continue;
            const h = ctx.createBufferSource();
            h.buffer = hitBuf;
            h.connect(hitGain);
            h.start(Math.max(at, ctx.currentTime));
            hitNodes.push(h);
            if (hitNodes.length > 128) hitNodes.splice(0, 64);
          }
        };
        const latency =
          ((ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0) +
          (ctx.baseLatency ?? 0);
        const colors = laneColors(skin, song.color);
        const frame = () => {
          if (!alive) return;
          schedule();
          const w = canvas.width;
          const h = canvas.height;
          const fieldW = h * LANE_W_R;
          const x0 = (w - fieldW) / 2;
          const judgeY = h * JUDGE_R;
          const laneW = fieldW / 4;
          const travel = visibleSec(live.current.speed);
          const tGame = ctx.currentTime - epoch - latency - live.current.sync / 1000;
          g.clearRect(0, 0, w, h);
          g.fillStyle = "rgba(4,3,12,0.88)";
          g.fillRect(x0 - laneW * 0.1, 0, fieldW + laneW * 0.2, h);
          g.fillStyle = "rgba(255,255,255,0.045)";
          for (let l = 1; l < 4; l += 2) g.fillRect(x0 + l * laneW, 0, laneW, h);
          g.strokeStyle = "rgba(167,139,250,0.35)";
          g.lineWidth = Math.max(1, h * 0.002);
          g.strokeRect(x0 - laneW * 0.1, -4, fieldW + laneW * 0.2, h + 8);
          g.fillStyle = "#F472B6";
          g.fillRect(x0 - laneW * 0.1, judgeY - h * 0.0035, fieldW + laneW * 0.2, h * 0.007);
          const noteH = Math.max(10, h * 0.032);
          for (const n of notes) {
            for (const k of [-1, 0, 1]) {
              const dt = n.rel + (Math.floor(tGame / L) + k) * L - tGame;
              if (dt < -0.3 || dt > travel) continue;
              const y = judgeY - (dt / travel) * judgeY;
              g.fillStyle = colors[n.lane];
              g.globalAlpha = Math.abs(dt) < 0.04 ? 1 : 0.9;
              g.beginPath();
              g.roundRect(
                x0 + n.lane * laneW + laneW * 0.06,
                y - noteH / 2,
                laneW * 0.88,
                noteH,
                6
              );
              g.fill();
              g.globalAlpha = 1;
            }
          }
          raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
      } catch {
        if (alive) setFailedId(songId);
      }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      stopAll();
    };
    // 곡·타격음·스킨이 바뀌면 다시 시작 (싱크·속도는 ref로 바로 반영)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId, hitSound, skin]);

  const song = songs.find((s) => s.id === songId);
  const diff = song ? diffOf(song) : null;
  const diffInfo = DIFFICULTIES.find((d) => d.key === diff);
  const KR = "font-['Nanum_Gothic',sans-serif]";
  const btn =
    "h-[3.2cqw] w-[3.2cqw] shrink-0 cursor-pointer rounded-full border border-white/25 bg-white/[0.06] font-mono text-[1.7cqw] text-white/85 transition-colors hover:border-[#A78BFA] hover:bg-[#A78BFA]/15 hover:text-white";
  return (
    <div ref={wrapRef} className="absolute inset-0 z-30 bg-[#070512]/97">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {(loading || failed) && (
        <div
          className={`${KR} absolute inset-0 flex items-center justify-center text-[1.4cqw] text-white/60`}
        >
          {failed ? "음원을 불러오지 못했어요" : "하이라이트 찾는 중…"}
        </div>
      )}
      {/* 머리말 띠 */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between border-b border-white/10 bg-[#0b0820]/85 px-[1.8cqw] py-[0.9cqw]">
        <div className="flex items-baseline gap-[1cqw]">
          <span className="font-['Arial_Black','Segoe_UI_Black',sans-serif] text-[1.7cqw] font-black tracking-[0.06em] text-white italic">
            SYNC CHECK
          </span>
          <span className={`${KR} text-[1.1cqw] text-white/55`}>
            {song?.title}
            {diffInfo && (
              <b className="ml-[0.6cqw]" style={{ color: diffInfo.color }}>
                {diffInfo.label}
              </b>
            )}{" "}
            하이라이트 · 내 노트 속도
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`${KR} cursor-pointer rounded-[0.6cqw] border border-[#F472B6]/60 bg-[#F472B6]/15 px-[1.4cqw] py-[0.5cqw] text-[1.15cqw] font-bold text-white transition-colors hover:bg-[#F472B6]/30`}
        >
          ✕ 닫기 (Esc)
        </button>
      </div>
      {/* 왼쪽: 싱크 조절 카드 */}
      <div className="absolute top-1/2 left-[3cqw] w-[23cqw] -translate-y-1/2 rounded-[1cqw] border border-white/10 bg-[#0b0820]/85 p-[1.4cqw]">
        <div className={`${KR} mb-[0.6cqw] text-[1cqw] font-bold tracking-wide text-[#A78BFA]`}>
          싱크
        </div>
        <div className="flex items-center justify-between">
          <HoldButton className={btn} onStep={() => onSync(Math.max(-400, sync - 5))}>
            −
          </HoldButton>
          <span className="font-mono text-[2.4cqw] font-bold text-white tabular-nums">
            {sync > 0 ? `+${sync}` : sync}
            <span className="ml-[0.2cqw] text-[1.1cqw] font-normal text-white/45">ms</span>
          </span>
          <HoldButton className={btn} onStep={() => onSync(Math.min(400, sync + 5))}>
            +
          </HoldButton>
        </div>
        <p className={`${KR} mt-[0.9cqw] text-[1cqw] leading-relaxed text-white/55`}>
          타격음과 음악이 딱 겹쳐야 해요. 타격음이 <b className="text-white/85">먼저</b>면{" "}
          <b className="text-white/85">+</b>, <b className="text-white/85">늦으면</b>{" "}
          <b className="text-white/85">−</b>
          <span className="text-white/35"> (← → 키로도 5ms씩)</span>. 블루투스 이어폰이면 낀 채로
          맞추세요.
        </p>
      </div>
      {/* 오른쪽: 곡 고르기 */}
      <div className="absolute top-1/2 right-[3cqw] w-[20cqw] -translate-y-1/2 rounded-[1cqw] border border-white/10 bg-[#0b0820]/85 p-[1.4cqw]">
        <div className={`${KR} mb-[0.7cqw] text-[1cqw] font-bold tracking-wide text-[#A78BFA]`}>
          곡 (가장 시끄러운 8마디)
        </div>
        <div className="flex flex-col gap-[0.35cqw]">
          {songs.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSongId(s.id)}
              className={`${KR} cursor-pointer truncate rounded-[0.5cqw] border px-[0.9cqw] py-[0.35cqw] text-left text-[1.05cqw] transition-colors ${
                s.id === songId
                  ? "border-[#A78BFA] bg-[#A78BFA]/20 font-bold text-white"
                  : "border-transparent text-white/55 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              {s.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
