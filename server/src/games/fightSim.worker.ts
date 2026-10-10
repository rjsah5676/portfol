/**
 * AI 시뮬레이션 통계용 작업 스레드 (games/fightSim.ts 가 띄움).
 * 메인 스레드(모든 게임 · 소켓)와 따로 돌아서 메인을 멈추지 않고, 이 안에서도 4ms 계산 → 8ms 쉼으로
 * 한 코어의 1/3 이하만 씀. 받은 판 하나를 끝까지 돌려 결과만 돌려줌 (DB는 메인이 씀).
 * (개발 서버(tsx)에선 작업 스레드 대신 메인에서 runSim 을 그대로 부름 — 쉬엄쉬엄 도는 건 같음)
 */
import { parentPort } from "node:worker_threads";
import { BUILD_ID, newMatch, step } from "../../../web/src/lib/fight/sim";
import { FightAI, aiForRating } from "../../../web/src/lib/fight/ai";

export interface SimJob {
  /** 등급 번호 (tiers.ts TIERS) */
  tier: number;
  /** 두 AI의 실력 (레이팅, 캐릭터 보정 없이) */
  R: number;
  a: number;
  b: number;
  map: number;
  seed: number;
}
export interface SimResult extends SimJob {
  build: number;
  /** 0 = a 승 · 1 = b 승 · 2 = 무승부 */
  out: 0 | 1 | 2;
  frames: number;
  /** 실제로 계산에 쓴 시간 (ms) */
  cpu: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runSim(job: SimJob): Promise<SimResult> {
  const s = newMatch([job.a, job.b], job.map);
  const lv = aiForRating(job.R);
  const ai = [new FightAI(lv, job.seed), new FightAI(lv, (job.seed * 31 + 7) >>> 0)];
  let k = 0,
    cpu = 0,
    t = performance.now();
  while (s.phase !== "over" && k < 30000) {
    step(s, [ai[0].next(s, 0), ai[1].next(s, 1)]);
    k++;
    const now = performance.now();
    if (now - t > 4) {
      cpu += now - t;
      await sleep(8);
      t = performance.now();
    }
  }
  cpu += performance.now() - t;
  const w = s.winner;
  return { ...job, build: BUILD_ID, out: w === 0 || w === 1 ? w : 2, frames: k, cpu: Math.round(cpu) };
}

parentPort?.on("message", (job: SimJob) => {
  runSim(job).then(
    (r) => parentPort!.postMessage(r),
    (e) => parentPort!.postMessage({ error: String(e?.stack ?? e) })
  );
});
