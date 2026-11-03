/// <reference lib="webworker" />
import { generate, type TierId } from "./engine";

// 지옥 난이도는 1초 가까이 걸릴 수 있어서 화면이 멈추지 않게 워커에서 만듦
self.onmessage = (e: MessageEvent<{ id: number; seed: number; tier: TierId }>) => {
  const { id, seed, tier } = e.data;
  try {
    (self as unknown as Worker).postMessage({ id, kase: generate(seed, tier) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
