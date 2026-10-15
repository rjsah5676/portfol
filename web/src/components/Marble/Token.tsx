"use client";

import { useEffect, useState } from "react";

/*
 * 말(토큰) — 픽셀파이트 도트 시트(public/fight/<id>.json · .webp)의 서기 · 걷기 · 승리 · 피격 동작을 그대로 씀.
 * 시트 형식은 lib/fight/sprites.ts (프레임마다 [x, y, w, h, 발x, 발y]). 발 위치를 바닥 가운데에 맞춰 그림.
 */

interface Sheet {
  image: string;
  frames: [number, number, number, number, number, number][];
  anims: Record<string, { list?: number[]; fps: number; loop: boolean }>;
  facing?: "left" | "right";
  w: number;
  h: number;
}

const cache = new Map<string, Promise<Sheet>>();
function loadSheet(id: string): Promise<Sheet> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(`/fight/${id}.json`)
      .then((r) => r.json() as Promise<Omit<Sheet, "w" | "h">>)
      .then(
        (meta) =>
          new Promise<Sheet>((res, rej) => {
            const img = new Image();
            img.onload = () => res({ ...meta, w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = rej;
            img.src = meta.image;
          })
      );
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

export type TokenAnim = "idle" | "walk" | "win" | "hit" | "ko";

/** h = 그림 높이(px) 기준. face = 1 오른쪽 · -1 왼쪽 */
export default function Token({ sprite, anim = "idle", h = 48, face = 1, className = "", shadow = true, maxW }: { sprite: string; anim?: TokenAnim; h?: number; face?: 1 | -1; className?: string; shadow?: boolean; maxW?: number }) {
  const [sh, setSh] = useState<Sheet | null>(null);
  const [k, setK] = useState(0);
  useEffect(() => {
    let alive = true;
    loadSheet(sprite).then(
      (s) => alive && setSh(s),
      () => {}
    );
    return () => {
      alive = false;
    };
  }, [sprite]);
  const a = sh?.anims[anim] ?? sh?.anims.idle;
  const n = a?.list?.length ?? 1;
  useEffect(() => {
    if (!a) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 동작이 바뀌면 첫 칸부터
    setK(0);
    const fps = anim === "walk" ? 12 : Math.max(2, a.fps);
    const id = setInterval(() => setK((x) => (a.loop || x < n - 1 ? (x + 1) % n : x)), 1000 / fps);
    return () => clearInterval(id);
  }, [a, n, anim]);
  if (!sh || !a?.list) return <div className={className} style={{ width: h * 0.7, height: h }} />;
  const f = sh.frames[a.list[k % n]];
  // 서기 동작의 첫 칸 키를 기준으로 크기를 맞춤 (동작마다 크기가 들쭉날쭉하지 않게)
  const ref = sh.frames[sh.anims.idle?.list?.[0] ?? 0];
  let s = h / ref[3];
  if (maxW) {
    // 동작 칸 중 발 기준으로 가장 멀리 뻗는 쪽이 maxW 안에 들어오게
    const reach = Math.max(...a.list.map((i) => Math.max(sh.frames[i][4], sh.frames[i][2] - sh.frames[i][4])));
    s = Math.min(s, maxW / (2 * reach));
  }
  const flip = (sh.facing === "left" ? -1 : 1) * face < 0;
  const w = f[2] * s;
  return (
    <div className={`relative ${className}`} style={{ width: ref[2] * s, height: ref[3] * s }}>
      {shadow && <div className="absolute bottom-[-3px] left-1/2 h-[6px] w-[70%] -translate-x-1/2 bg-[rgba(35,42,77,0.28)]" />}
      <div
        className="absolute bottom-0"
        style={{
          left: `calc(50% - ${(flip ? f[2] - f[4] : f[4]) * s}px)`,
          width: w,
          height: f[3] * s,
          backgroundImage: `url(${sh.image})`,
          backgroundSize: `${sh.w * s}px ${sh.h * s}px`,
          backgroundPosition: `${-f[0] * s}px ${-f[1] * s}px`,
          transform: flip ? "scaleX(-1)" : undefined,
          imageRendering: "auto",
        }}
      />
    </div>
  );
}
