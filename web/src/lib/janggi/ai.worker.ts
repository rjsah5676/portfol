/// <reference lib="webworker" />
import { chooseMove, type AIConfig, type Level } from "./ai";
import type { Color } from "./engine";

// 어려움 난이도는 한 수에 1~2초 계산하므로 화면이 멈추지 않게 워커에서
self.onmessage = (
  e: MessageEvent<{
    id: number;
    board: number[];
    color: Color;
    level: Level | AIConfig;
    banned?: string[];
  }>
) => {
  const { id, board, color, level, banned } = e.data;
  const mv = chooseMove(Int8Array.from(board), color, level, banned);
  (self as unknown as Worker).postMessage({ id, mv });
};
