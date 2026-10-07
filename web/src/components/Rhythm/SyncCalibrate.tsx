"use client";

import { useEffect, useRef, useState } from "react";
import { audio } from "@/lib/rhythm/sfx";
import { laneColors, makeHitSound, type HitSound, type Skin } from "@/lib/rhythm/fx";
import { SONGS } from "@/lib/rhythm/music";
import { visibleSec } from "./Stage";
import HoldButton from "./HoldButton";

/**
 * 싱크 맞추기 (설정 → 싱크 → 들으면서 맞추기): 게임 화면 전체를 덮는 레이어에
 * New Dimension 하이라이트(8마디)를 실제 NIGHTMARE 채보·실제 레인 크기·내 노트 속도로 돌려 보여 준다.
 * 음악·타격음은 같은 오디오 시계에 예약되고, 노트는 게임과 똑같이 "싱크(ms)"만큼 늦게/일찍 줄에 닿는다 —
 * 타격음과 음악이 겹칠 때까지 +·−를 움직이면 그 값이 그대로 플레이에 쓰인다.
 * (치는 타이밍은 플레이 중 자동 싱크가 따로 맞추므로 여기선 화면·소리만)
 */
const SONG_ID = "newdim";
/** 하이라이트 시작(초) — 마디 경계로 스냅해 8마디를 돎 */
const HILITE = 150.7;
const BARS = 8;
/** 실제 플레이 기어 비율 (Stage GEAR): 레인 4개 폭 = 화면 높이 × 0.449, 판정선 = 높이 × 0.828 */
const LANE_W_R = (189 * 4) / 1683;
const JUDGE_R = 1393 / 1683;

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
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
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
    const nodes: AudioScheduledSourceNode[] = [];
    const stopAll = () => {
      for (const n of nodes) {
        try {
          n.stop();
        } catch {}
      }
      nodes.length = 0;
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

    const song = SONGS.find((s) => s.id === SONG_ID);
    const chart = song?.charts?.nightmare;
    if (!song?.audio || !chart) {
      raf = requestAnimationFrame(() => {
        setFailed(true);
        setLoading(false);
      });
      return () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
      };
    }
    const barSec = (60 / song.bpm) * 4;
    const off = song.beatOffset ?? 0;
    const A = off + Math.round((HILITE - off) / barSec) * barSec;
    const L = barSec * BARS;
    const notes = chart.notes
      .filter((n) => n.t >= A - 0.001 && n.t < A + L - 0.001)
      .map((n) => ({ rel: n.t - A, lane: n.lane }));

    (async () => {
      try {
        const [ctx, res] = await Promise.all([audio(), fetch(song.audio!)]);
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        if (!alive) return;
        setLoading(false);
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
              nodes.push(src);
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
            nodes.push(h);
            if (nodes.length > 200) nodes.splice(0, 100);
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
          // 실제 플레이와 같은 기하: 레인 폭·판정선 위치는 화면 높이 기준
          const fieldW = h * LANE_W_R;
          const x0 = (w - fieldW) / 2;
          const judgeY = h * JUDGE_R;
          const laneW = fieldW / 4;
          const travel = visibleSec(live.current.speed);
          const tGame = ctx.currentTime - epoch - latency - live.current.sync / 1000;
          g.clearRect(0, 0, w, h);
          g.fillStyle = "rgba(6,4,16,0.72)";
          g.fillRect(x0 - laneW * 0.08, 0, fieldW + laneW * 0.16, h);
          g.fillStyle = "rgba(255,255,255,0.05)";
          for (let l = 1; l < 4; l += 2) g.fillRect(x0 + l * laneW, 0, laneW, h);
          g.strokeStyle = "rgba(255,255,255,0.12)";
          g.strokeRect(x0 - laneW * 0.08, -2, fieldW + laneW * 0.16, h + 4);
          g.fillStyle = "#F472B6";
          g.fillRect(x0 - laneW * 0.08, judgeY - h * 0.0035, fieldW + laneW * 0.16, h * 0.007);
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
        if (alive) {
          setFailed(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      stopAll();
    };
    // 타격음 종류·스킨이 바뀔 때만 다시 시작 (싱크·속도는 ref로 바로 반영)
  }, [hitSound, skin]);

  const btn =
    "h-[3cqw] w-[3cqw] shrink-0 cursor-pointer rounded-full border border-white/25 bg-black/40 font-mono text-[1.6cqw] text-white/85 hover:border-[#A78BFA] hover:text-white";
  return (
    <div ref={wrapRef} className="absolute inset-0 z-30 bg-[#05030f]/85">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {(loading || failed) && (
        <div className="absolute inset-0 flex items-center justify-center font-['Nanum_Gothic',sans-serif] text-[1.4cqw] text-white/60">
          {failed ? "음원을 불러오지 못했어요" : "New Dimension 하이라이트 불러오는 중…"}
        </div>
      )}
      {/* 머리말 */}
      <div className="absolute top-[1.2cqw] left-[1.6cqw] font-['Nanum_Gothic',sans-serif] text-[1.2cqw] font-bold text-white/85">
        싱크 맞추기{" "}
        <span className="font-normal text-white/45">
          — New Dimension · NIGHTMARE 하이라이트 · 내 노트 속도
        </span>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="absolute top-[1cqw] right-[1.4cqw] cursor-pointer rounded-[0.6cqw] border border-white/20 bg-black/40 px-[1.2cqw] py-[0.45cqw] font-mono text-[1.1cqw] text-white/80 hover:border-white/50 hover:text-white"
      >
        닫기 (Esc)
      </button>
      {/* 조절: 레인 왼쪽 (레인은 가운데라 안 가림) */}
      <div className="absolute top-1/2 left-[4cqw] flex w-[22cqw] -translate-y-1/2 flex-col items-center gap-[1cqw]">
        <div className="flex items-center gap-[1.2cqw]">
          <HoldButton className={btn} onStep={() => onSync(Math.max(-400, sync - 5))}>
            −
          </HoldButton>
          <span className="w-[9cqw] text-center font-mono text-[2.2cqw] font-bold text-white tabular-nums">
            {sync > 0 ? `+${sync}` : sync}ms
          </span>
          <HoldButton className={btn} onStep={() => onSync(Math.min(400, sync + 5))}>
            +
          </HoldButton>
        </div>
        <p className="rounded-[0.6cqw] bg-black/45 px-[1.2cqw] py-[0.6cqw] font-['Nanum_Gothic',sans-serif] text-[1.1cqw] leading-relaxed text-white/65">
          타격음과 음악이 딱 겹쳐야 해요 — 타격음이 음악보다 <b className="text-white">먼저</b>면{" "}
          <b className="text-white">+</b>, <b className="text-white">늦으면</b>{" "}
          <b className="text-white">−</b> (← →로도 조절). 블루투스 이어폰이면 낀 채로 맞추세요.
        </p>
      </div>
    </div>
  );
}
