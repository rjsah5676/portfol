/**
 * 캐릭터 선택: 게임 속 도트 모습 미리 보기 — 서 있기 · 걷기 · 약 연속 · 발차기 · 아이덴티티 · 필살기 · 승리 동작을 돌아가며 보여 줌.
 * 그림은 게임과 같은 스프라이트 시트(lib/fight/sprites).
 */
import { useEffect, useRef } from "react";
import { loadSheet, frameRect, type LoadedSheet } from "@/lib/fight/sprites";

/** 보여 줄 동작 순서 [동작 이름, 반복 횟수 (서 있기 · 걷기는 시간으로)] */
const SEQ: [string, number][] = [
  ["idle", 1.4],
  ["walk", 1],
  ["L1", 1],
  ["L2", 1],
  ["L3", 1],
  ["H1", 1],
  ["idle", 0.8],
  ["S", 1],
  ["idle", 0.8],
  ["X", 1],
  ["win", 1],
];

export default function PixelPreview({ id, flip, className = "" }: { id: string; flip?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let sh: LoadedSheet | null = null;
    let alive = true;
    let raf = 0;
    let ext: { idle: number } | null = null;
    loadSheet(id)
      .then((s) => alive && (sh = s))
      .catch(() => {});
    const t0 = performance.now();
    // 동작마다 길이(초) — 반복하는 동작은 시간, 한 번 하는 동작은 프레임 수 / fps
    const durOf = (s: LoadedSheet, [name, k]: [string, number]) => {
      const a = s.anims[name];
      if (!a) return 0;
      return a.loop || name === "idle" || name === "walk" ? k : Math.max(0.35, a.frames / a.fps);
    };
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = ref.current;
      if (!cv || !sh) return;
      const g = cv.getContext("2d");
      if (!g) return;
      const dpr = window.devicePixelRatio || 1;
      const W = Math.round(cv.clientWidth * dpr),
        H = Math.round(cv.clientHeight * dpr);
      if (cv.width !== W || cv.height !== H) ((cv.width = W), (cv.height = H));
      g.clearRect(0, 0, W, H);
      const seq = SEQ.filter(([n]) => sh!.anims[n]);
      const total = seq.reduce((t, x) => t + durOf(sh!, x), 0);
      if (!total) return;
      let t = ((performance.now() - t0) / 1000) % total;
      let i = 0;
      while (i < seq.length - 1 && t >= durOf(sh, seq[i])) t -= durOf(sh, seq[i++]);
      const a = sh.anims[seq[i][0]];
      const k = Math.min(a.frames - 1, Math.floor(t * a.fps) % a.frames);
      const fr = frameRect(sh, a, k);
      // 배율: 서 있는 키를 칸 높이의 62%로 (캐릭터마다 같은 크기 — 채찍 · 필살기처럼 아주 긴 그림은 칸 밖이 잘림)
      if (!ext) ext = { idle: frameRect(sh, sh.anims[sh.states.idle?.anim ?? "idle"] ?? a, 0).ay };
      const sc = (H * 0.62) / Math.max(1, ext.idle);
      g.imageSmoothingEnabled = !sh.pixel;
      g.imageSmoothingQuality = "high";
      g.save();
      // 앞쪽(공격 나가는 쪽)에 자리를 조금 더
      g.translate(W * (flip ? 0.62 : 0.38), H * 0.96);
      const faceRight = (sh.facing ?? "right") === "right";
      if (faceRight === !!flip) g.scale(-1, 1);
      g.drawImage(sh.img, fr.sx, fr.sy, fr.sw, fr.sh, -fr.ax * sc, -fr.ay * sc, fr.sw * sc, fr.sh * sc);
      g.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [id, flip]);
  return <canvas ref={ref} className={className} />;
}
