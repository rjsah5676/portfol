"use client";

import { useEffect, useRef, useState } from "react";
import { audio } from "@/lib/rhythm/sfx";
import { laneColors, SKIN_THEME, type Skin } from "@/lib/rhythm/fx";
import { gearRatios, visibleSec } from "./Stage";
import HoldButton from "./HoldButton";

/**
 * 싱크 맞추기 (설정 → 싱크 → 들으면서 맞추기): 게임 화면 전체를 덮는 레이어에
 * 메트로놈(120 BPM, 똑 딱 딱 딱)에 맞춰 박마다 노트 하나가 실제 레인 크기·내 노트 속도로 떨어진다.
 * osu 오프셋 마법사 방식: 노트가 판정선에 닿는 "화면"과 똑딱 "소리"를 맞춘다. 노트는 게임과 똑같이
 * "싱크(ms)"만큼 늦게/일찍 줄에 닿으니, 닿는 순간 똑딱이 들릴 때까지 +·−를 움직이면 그 값이 그대로 플레이에 쓰인다.
 * 타격음은 내지 않음 — 메트로놈과 같은 출력 지연을 타서 소리끼리 비교하면 싱크 0에서 늘 맞게 들림.
 * (치는 타이밍은 자동 싱크가 따로 맞춤)
 */
/** 메트로놈 템포: 120 BPM (박 0.5초) — 박이 또렷하고 블루투스 지연(150~250ms)도 박 절반 안이라 헷갈리지 않음 */
const BEAT = 0.5;

export default function SyncCalibrate({
  sync,
  onSync,
  onClose,
  speed,
  skin,
}: {
  sync: number;
  onSync: (v: number) => void;
  onClose: () => void;
  speed: number;
  skin: Skin;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "on" | "failed">("loading");
  const loading = state === "loading";
  const failed = state === "failed";
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
    // 예약해 둔 메트로놈 마디들 — 닫을 때 전부 멈춤 (끝난 건 앞에서 버림)
    const musicNodes: AudioBufferSourceNode[] = [];
    const stopAll = () => {
      for (const n of musicNodes) {
        try {
          n.stop();
        } catch {}
      }
      musicNodes.length = 0;
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

    (async () => {
      try {
        const ctx = await audio();
        if (!alive) return;
        setState("on");
        // 메트로놈 한 마디(4박) 버퍼: 똑(높은 소리) 딱 딱 딱 — 소리 시작이 박에 딱 맞게 어택 없이 바로
        const L = BEAT * 4;
        const sr = ctx.sampleRate;
        const buf = ctx.createBuffer(1, Math.ceil(L * sr), sr);
        const d = buf.getChannelData(0);
        for (let b = 0; b < 4; b++) {
          const f = b === 0 ? 1760 : 1175;
          const amp = b === 0 ? 0.55 : 0.4;
          const i0 = Math.round(b * BEAT * sr);
          const n = Math.round(0.05 * sr);
          for (let i = 0; i < n; i++) {
            const t = i / sr;
            d[i0 + i] += amp * Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 90);
          }
        }
        // 박마다 노트 하나, 레인은 계단(0→1→2→3)
        const notes = [0, 1, 2, 3].map((b) => ({ rel: b * BEAT, lane: b }));

        const musicGain = ctx.createGain();
        musicGain.gain.value = 0.7;
        musicGain.connect(ctx.destination);
        const epoch = ctx.currentTime + 0.35;
        let musicNext = 0;
        const schedule = () => {
          const horizon = ctx.currentTime + 1;
          while (epoch + musicNext * L < horizon) {
            const at = epoch + musicNext * L;
            if (at > ctx.currentTime - 0.05) {
              const src = ctx.createBufferSource();
              src.buffer = buf;
              src.connect(musicGain);
              src.start(Math.max(at, ctx.currentTime), Math.max(0, ctx.currentTime - at), L);
              musicNodes.push(src);
              if (musicNodes.length > 16) musicNodes.splice(0, 8);
            }
            musicNext++;
          }
        };
        const latency =
          ((ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0) +
          (ctx.baseLatency ?? 0);
        const colors = laneColors(skin, "#A78BFA");
        // 실제 플레이 레인 틀 비율 (레인 4개 폭 · 판정선 위치 ÷ 화면 높이)
        const { laneW: LANE_W_R, judge: JUDGE_R } = gearRatios(SKIN_THEME[skin]);
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
          // 노트가 판정선에 닿은 직후 0.1초 동안 판정선이 번쩍 — 이 순간에 똑딱이 들려야 함
          const since = (((tGame % BEAT) + BEAT) % BEAT) / 0.1;
          const flash = since < 1 ? 1 - since : 0;
          g.fillStyle = "#F472B6";
          g.fillRect(x0 - laneW * 0.1, judgeY - h * 0.0035, fieldW + laneW * 0.2, h * 0.007);
          if (flash > 0) {
            g.globalAlpha = flash;
            g.fillStyle = "#FFFFFF";
            const fh = h * (0.007 + 0.012 * flash);
            g.fillRect(x0 - laneW * 0.1, judgeY - fh / 2, fieldW + laneW * 0.2, fh);
            g.globalAlpha = 1;
          }
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
        if (alive) setState("failed");
      }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      stopAll();
    };
    // 스킨이 바뀌면 다시 시작 (싱크·속도는 ref로 바로 반영)
  }, [skin]);

  const KR = "";
  const btn =
    "h-[3.2cqw] w-[3.2cqw] shrink-0 cursor-pointer rounded-full border border-white/25 bg-white/[0.06] font-mono text-[1.7cqw] text-white/85 transition-colors hover:border-[#A78BFA] hover:bg-[#A78BFA]/15 hover:text-white";
  return (
    <div ref={wrapRef} className="absolute inset-0 z-30 bg-[#070512]/97">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {(loading || failed) && (
        <div
          className={`${KR} absolute inset-0 flex items-center justify-center text-[1.4cqw] text-white/60`}
        >
          {failed ? "소리를 켜지 못했어요" : "준비 중…"}
        </div>
      )}
      {/* 머리말 띠 */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between border-b border-white/10 bg-[#0b0820]/85 px-[1.8cqw] py-[0.9cqw]">
        <div className="flex items-baseline gap-[1cqw]">
          <span className="pru-t text-[1.7cqw] font-bold tracking-[0.06em] text-white ">
            SYNC CHECK
          </span>
          <span className={`${KR} text-[1.1cqw] text-white/55`}>
            메트로놈 120 BPM · 박마다 노트 · 내 노트 속도
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
      <div className="absolute top-1/2 left-[3cqw] w-[23cqw] -translate-y-1/2 pru-box [--f:rgba(12,7,24,0.8)] p-[1.4cqw]">
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
          노트가 판정선에 닿는 순간 똑딱이 들려야 해요. 노트가 소리보다{" "}
          <b className="text-white/85">먼저</b> 닿으면 <b className="text-white/85">+</b>,{" "}
          <b className="text-white/85">늦게</b> 닿으면 <b className="text-white/85">−</b>
          <span className="text-white/35"> (← → 키로도 5ms씩)</span>. 블루투스 이어폰이면 낀 채로
          맞추세요.
        </p>
      </div>
    </div>
  );
}
