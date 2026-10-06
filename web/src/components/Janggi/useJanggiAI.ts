"use client";

import { useCallback, useEffect, useRef } from "react";
import { chooseMove, type AIConfig, type Level } from "@/lib/janggi/ai";
import type { Color } from "@/lib/janggi/engine";

/** AI 수 계산 (워커가 안 되는 환경이면 메인 스레드에서) */
export function useJanggiAI() {
  const worker = useRef<Worker | null>(null);
  const waiting = useRef(new Map<number, (mv: string | null) => void>());
  const seq = useRef(0);

  useEffect(() => {
    try {
      const w = new Worker(new URL("../../lib/janggi/ai.worker.ts", import.meta.url));
      w.onmessage = (e: MessageEvent<{ id: number; mv: string | null }>) => {
        waiting.current.get(e.data.id)?.(e.data.mv);
        waiting.current.delete(e.data.id);
      };
      worker.current = w;
    } catch {
      worker.current = null;
    }
    const pending = waiting.current;
    return () => {
      worker.current?.terminate();
      worker.current = null;
      pending.clear();
    };
  }, []);

  return useCallback(
    (
      board: Int8Array,
      color: Color,
      level: Level | AIConfig,
      banned: string[] = []
    ): Promise<string | null> => {
      const w = worker.current;
      if (!w)
        return new Promise((res) =>
          setTimeout(() => res(chooseMove(board, color, level, banned)), 30)
        );
      const id = ++seq.current;
      return new Promise((res) => {
        waiting.current.set(id, res);
        w.postMessage({ id, board: Array.from(board), color, level, banned });
      });
    },
    []
  );
}
