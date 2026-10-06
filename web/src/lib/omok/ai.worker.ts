/// <reference lib="webworker" />
import { chooseMove, type AIConfig } from "./ai";
import type { Color, Rule } from "./engine";

// 센 단계는 한 수에 1~2초 계산하므로 화면이 멈추지 않게 워커에서
self.onmessage = (
  e: MessageEvent<{ id: number; board: number[]; color: Color; rule: Rule; cfg: AIConfig }>
) => {
  const { id, board, color, rule, cfg } = e.data;
  const mv = chooseMove(Int8Array.from(board), color, rule, cfg);
  (self as unknown as Worker).postMessage({ id, mv });
};
