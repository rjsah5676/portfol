/// <reference lib="webworker" />
import { generate, type TierId } from "./engine";

// 지옥 난이도는 조건에 맞는 퍼즐을 찾느라 1~5초 걸릴 수 있어서 화면이 멈추지 않게 워커에서 만듦
self.onmessage = (e: MessageEvent<{ id: number; seed: number; tier: TierId }>) => {
  const { id, seed, tier } = e.data;
  try {
    (self as unknown as Worker).postMessage({ id, puzzle: generate(seed, tier) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
