"use client";

import { generate, type Case, type TierId } from "./engine";

/*
 * 사건 만들기 — 워커에서 (지옥은 1초 가까이 걸려서 화면이 멈추지 않게). 같은 시드 · 난이도는 한 번만 만들고 기억.
 * 워커를 못 쓰는 환경이면 화면 쪽에서 만듦. (lib/suspect/makePuzzle.ts 와 같은 방식)
 */

const cache = new Map<string, Promise<Case>>();
let worker: Worker | null | undefined;
let seq = 0;
const waiting = new Map<number, { ok: (c: Case) => void; fail: (e: unknown) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("./gen.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; kase?: Case; error?: string }>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.kase) w.ok(e.data.kase);
      else w.fail(new Error(e.data.error));
    };
    worker.onerror = () => {
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
  new Promise<Case>((ok, fail) =>
    setTimeout(() => {
      try {
        ok(generate(seed, tier));
      } catch (e) {
        fail(e);
      }
    }, 30)
  );

export function makeCase(seed: number, tier: TierId): Promise<Case> {
  const key = `${seed}:${tier}`;
  let p = cache.get(key);
  if (!p) {
    const w = getWorker();
    p = w
      ? new Promise<Case>((ok, fail) => {
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
