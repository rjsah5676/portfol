"use client";

import { generate, type Puzzle, type TierId } from "./engine";

/*
 * 퍼즐 만들기 — 워커에서 (지옥은 1~5초 걸려서 화면이 멈추지 않게). 같은 시드 · 난이도는 한 번만 만들고 기억.
 * 워커를 못 쓰는 환경이면 그냥 화면 쪽에서 만듦.
 */

const cache = new Map<string, Promise<Puzzle>>();
let worker: Worker | null | undefined;
let seq = 0;
const waiting = new Map<number, { ok: (p: Puzzle) => void; fail: (e: unknown) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("./gen.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; puzzle?: Puzzle; error?: string }>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.puzzle) w.ok(e.data.puzzle);
      else w.fail(new Error(e.data.error));
    };
    worker.onerror = () => {
      // 워커가 죽으면 남은 일은 화면 쪽에서
      worker = null;
      for (const [, w] of waiting) w.fail(new Error("worker"));
      waiting.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
}

const local = (seed: number, tier: TierId) =>
  new Promise<Puzzle>((ok, fail) =>
    setTimeout(() => {
      try {
        ok(generate(seed, tier));
      } catch (e) {
        fail(e);
      }
    }, 30)
  );

export function makePuzzle(seed: number, tier: TierId): Promise<Puzzle> {
  const key = `${seed}:${tier}`;
  let p = cache.get(key);
  if (!p) {
    const w = getWorker();
    p = w
      ? new Promise<Puzzle>((ok, fail) => {
          const id = ++seq;
          waiting.set(id, { ok, fail });
          w.postMessage({ id, seed, tier });
        }).catch(() => local(seed, tier))
      : local(seed, tier);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}
