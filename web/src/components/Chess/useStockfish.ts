"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ChessBot } from "./chessBots";

const ENGINE_URL = "/stockfish/stockfish-19-lite-single.js";

/**
 * Stockfish 워커 하나를 띄워 두고 "이 국면에서 둘 수"를 묻는 함수 반환.
 * 엔진 파일(약 1.8MB)은 AI 대국을 처음 열 때 한 번만 받음.
 */
export function useStockfish() {
  const worker = useRef<Worker | null>(null);
  const ready = useRef<Promise<void> | null>(null);
  const pending = useRef<((mv: string | null) => void) | null>(null);

  useEffect(() => {
    let w: Worker;
    try {
      w = new Worker(ENGINE_URL);
    } catch {
      return;
    }
    worker.current = w;
    let resolveReady: () => void = () => {};
    ready.current = new Promise((r) => (resolveReady = r));
    w.onmessage = (e: MessageEvent<string>) => {
      const line = String(e.data);
      if (line === "readyok") resolveReady();
      else if (line.startsWith("bestmove")) {
        const mv = line.split(" ")[1];
        const cb = pending.current;
        pending.current = null;
        cb?.(mv && mv !== "(none)" ? mv : null);
      }
    };
    w.postMessage("uci");
    w.postMessage("isready");
    return () => {
      w.terminate();
      worker.current = null;
      pending.current?.(null);
      pending.current = null;
    };
  }, []);

  /** 새 대국 시작 시 (엔진 내부 기록 초기화) */
  const newGame = useCallback(() => {
    worker.current?.postMessage("ucinewgame");
  }, []);

  /** bot = null이면 전력(힌트용) */
  const bestMove = useCallback(
    async (fen: string, bot: ChessBot | null): Promise<string | null> => {
      const w = worker.current;
      if (!w || !ready.current) return null;
      await ready.current;
      if (pending.current) {
        w.postMessage("stop");
        pending.current(null);
      }
      if (!bot) {
        w.postMessage("setoption name UCI_LimitStrength value false");
        w.postMessage("setoption name Skill Level value 20");
      } else if (bot.elo) {
        w.postMessage("setoption name Skill Level value 20");
        w.postMessage("setoption name UCI_LimitStrength value true");
        w.postMessage(`setoption name UCI_Elo value ${bot.elo}`);
      } else {
        w.postMessage("setoption name UCI_LimitStrength value false");
        w.postMessage("setoption name Skill Level value 0");
      }
      w.postMessage(`position fen ${fen}`);
      return new Promise((res) => {
        pending.current = res;
        w.postMessage(
          !bot
            ? "go movetime 900"
            : bot.depth
              ? `go depth ${bot.depth}`
              : `go movetime ${bot.movetime ?? 500}`
        );
      });
    },
    []
  );

  return { bestMove, newGame };
}
