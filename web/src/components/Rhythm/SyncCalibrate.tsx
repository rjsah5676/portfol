"use client";

import { useEffect, useRef } from "react";
import { audio } from "@/lib/rhythm/sfx";
import { makeHitSound, type HitSound } from "@/lib/rhythm/fx";

/**
 * 싱크 맞추기 (설정 → 싱크): 120 BPM 박자 소리에 맞춰 노트가 떨어지는 작은 레인.
 * 박자 소리는 음악과 같은 오디오 시계에 예약되고, 노트는 게임과 똑같이 "싱크(ms)"만큼 늦게/일찍 줄에 닿는다 —
 * 노트가 줄에 닿는 순간과 소리가 같아질 때까지 +·−를 움직이면 그 값이 그대로 플레이에 쓰인다.
 * (판정 타이밍은 플레이 중 자동 싱크가 따로 맞추므로, 여기선 화면·소리만 맞추면 됨)
 */
export default function SyncCalibrate({ sync, hitSound }: { sync: number; hitSound: HitSound }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const syncRef = useRef(sync);
  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const g = canvas.getContext("2d")!;
    let raf = 0;
    let alive = true;
    const beat = 60 / 120; // 120 BPM
    const nodes: AudioScheduledSourceNode[] = [];
    let cleanupAudio = () => {};

    audio().then((ctx) => {
      if (!alive) return;
      const start = ctx.currentTime + 0.3;
      const hitBuf = makeHitSound(ctx, hitSound);
      let next = 0; // 다음에 예약할 박 번호
      // 박자 소리: 1초 앞까지 미리 예약 (4박마다 높은 소리)
      const schedule = () => {
        while (start + next * beat < ctx.currentTime + 1) {
          const at = start + next * beat;
          if (at > ctx.currentTime - 0.05) {
            const o = ctx.createOscillator();
            const gn = ctx.createGain();
            o.type = "square";
            o.frequency.value = next % 4 === 0 ? 1320 : 880;
            gn.gain.setValueAtTime(0.0001, at);
            gn.gain.exponentialRampToValueAtTime(next % 4 === 0 ? 0.3 : 0.2, at + 0.004);
            gn.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
            o.connect(gn).connect(ctx.destination);
            o.start(at);
            o.stop(at + 0.08);
            nodes.push(o);
            // 타격음도 같은 시각에 — 박자 소리와 타격음이 "딱" 겹치는 느낌 그대로
            const h = ctx.createBufferSource();
            h.buffer = hitBuf;
            const hg = ctx.createGain();
            hg.gain.value = 0.5;
            h.connect(hg).connect(ctx.destination);
            h.start(at);
            nodes.push(h);
          }
          next++;
          if (nodes.length > 40) nodes.splice(0, 20);
        }
      };
      const latency =
        ((ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0) +
        (ctx.baseLatency ?? 0);
      const frame = () => {
        if (!alive) return;
        schedule();
        const w = canvas.width;
        const h = canvas.height;
        const judgeY = h * 0.78;
        const visible = beat * 2; // 두 박 거리를 화면 높이로
        // 게임과 같은 식: 노트 t는 "들리는 시각 t + 싱크"에 줄에 닿음
        const heard = ctx.currentTime - start - latency - syncRef.current / 1000;
        g.clearRect(0, 0, w, h);
        g.fillStyle = "rgba(255,255,255,0.08)";
        g.fillRect(0, 0, w, h);
        // 판정선
        g.fillStyle = "#F472B6";
        g.fillRect(0, judgeY - 2, w, 4);
        // 박마다 노트 하나 (가운데 레인 하나)
        const noteW = Math.min(120, w * 0.4);
        const first = Math.floor((heard - beat) / beat);
        for (let b = first; b < first + 8; b++) {
          if (b < 0) continue;
          const y = judgeY - ((b * beat - heard) / visible) * judgeY;
          if (y < -20 || y > h + 20) continue;
          const close = Math.abs(b * beat - heard) < 0.05;
          g.fillStyle = close ? "#FDE68A" : "#60A5FA";
          g.beginPath();
          g.roundRect((w - noteW) / 2, y - 7, noteW, 14, 7);
          g.fill();
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      cleanupAudio = () => {
        for (const n of nodes) {
          try {
            n.stop();
          } catch {}
        }
      };
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      cleanupAudio();
    };
    // 타격음 종류가 바뀔 때만 다시 시작 (sync는 ref로 바로 반영)
  }, [hitSound]);

  return (
    <canvas
      ref={canvasRef}
      width={420}
      height={240}
      className="h-[14cqw] w-full rounded-[0.8cqw] border border-white/10"
    />
  );
}
