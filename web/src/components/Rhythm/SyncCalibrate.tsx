"use client";

import { useEffect, useRef, useState } from "react";
import { audio } from "@/lib/rhythm/sfx";
import { laneColors, makeHitSound, type HitSound, type Skin } from "@/lib/rhythm/fx";
import { SONGS } from "@/lib/rhythm/music";
import { visibleSec } from "./Stage";

/**
 * 싱크 맞추기 (설정 → 싱크): FREEDOM DiVE 하이라이트(8마디)를 실제 HARD 채보로 돌려 보여 주는 작은 플레이 화면.
 * 음악·타격음은 같은 오디오 시계에 예약되고, 노트는 게임과 똑같이 "싱크(ms)"만큼 늦게/일찍 줄에 닿으며
 * 떨어지는 속도도 설정의 노트 속도 그대로 — 노트가 줄에 닿는 순간과 음악이 같아질 때까지 +·−를 움직이면
 * 그 값이 그대로 플레이에 쓰인다. (치는 타이밍은 플레이 중 자동 싱크가 따로 맞추므로 여기선 화면·소리만)
 */
const SONG_ID = "freedomdive";
/** 하이라이트 구간(초) — 마디 경계로 맞춰 8마디를 돎 */
const HILITE = 54.3;
const BARS = 8;

export default function SyncCalibrate({
  sync,
  hitSound,
  speed,
  skin,
}: {
  sync: number;
  hitSound: HitSound;
  speed: number;
  skin: Skin;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const live = useRef({ sync, speed });
  useEffect(() => {
    live.current = { sync, speed };
  }, [sync, speed]);

  useEffect(() => {
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

    const song = SONGS.find((s) => s.id === SONG_ID);
    const chart = song?.charts?.hard;
    if (!song?.audio || !chart) {
      // 내장곡이 빠진 빌드 (있을 수 없지만) — 다음 프레임에 안내로
      raf = requestAnimationFrame(() => {
        setFailed(true);
        setLoading(false);
      });
      return () => cancelAnimationFrame(raf);
    }
    const beatSec = 60 / song.bpm;
    const barSec = beatSec * 4;
    const off = song.beatOffset ?? 0;
    // 마디 경계로 스냅한 루프 구간
    const A = off + Math.round((HILITE - off) / barSec) * barSec;
    const L = barSec * BARS;
    // 구간 안 노트 (상대 시각, 롱노트는 머리만)
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
        let musicNext = 0; // 다음에 예약할 루프 번호
        let hitLoop = 0; // 타격음 예약 커서 (루프 번호 · 노트 번호)
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
          // 타격음: 노트의 화면 도착 시각(싱크 적용)에 — 음악과 같은 시계라 출력 지연도 같음
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
            if (nodes.length > 160) nodes.splice(0, 80);
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
          const judgeY = h * 0.82;
          const travel = visibleSec(live.current.speed);
          // 게임과 같은 식: 지금 들리는 음악 시각에서 싱크만큼 뺀 게 채보 시각
          const tGame = ctx.currentTime - epoch - latency - live.current.sync / 1000;
          g.clearRect(0, 0, w, h);
          g.fillStyle = "rgba(10,8,24,0.9)";
          g.fillRect(0, 0, w, h);
          const laneW = w / 4;
          g.fillStyle = "rgba(255,255,255,0.06)";
          for (let l = 1; l < 4; l += 2) g.fillRect(l * laneW, 0, laneW, h);
          // 판정선
          g.fillStyle = "#F472B6";
          g.fillRect(0, judgeY - 2, w, 4);
          // 보이는 범위의 노트 (루프 경계 넘어 다음 바퀴 것까지)
          const noteH = Math.max(10, h * 0.055);
          for (const n of notes) {
            for (const k of [-1, 0, 1]) {
              const dt = n.rel + (Math.floor(tGame / L) + k) * L - tGame;
              if (dt < -0.25 || dt > travel) continue;
              const y = judgeY - (dt / travel) * judgeY;
              const close = Math.abs(dt) < 0.04;
              g.fillStyle = colors[n.lane];
              g.globalAlpha = close ? 1 : 0.88;
              g.beginPath();
              g.roundRect(n.lane * laneW + laneW * 0.08, y - noteH / 2, laneW * 0.84, noteH, 6);
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
      stopAll();
    };
    // 타격음 종류·스킨이 바뀔 때만 다시 시작 (싱크·속도는 ref로 바로 반영)
  }, [hitSound, skin]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={560}
        height={430}
        className="h-[26cqw] w-full rounded-[0.8cqw] border border-white/10"
      />
      {(loading || failed) && (
        <div className="absolute inset-0 flex items-center justify-center font-['Nanum_Gothic',sans-serif] text-[1.2cqw] text-white/50">
          {failed ? "음원을 불러오지 못했어요" : "FREEDOM DiVE 하이라이트 불러오는 중…"}
        </div>
      )}
    </div>
  );
}
