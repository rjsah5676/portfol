/**
 * 픽셀 글리치 디펜스 기록 검증 작업 스레드 (defense.ts 가 띄움).
 * 받은 명령 기록을 처음부터 다시 돌려 결과를 직접 계산 — 메인 스레드(모든 게임 · 소켓)를 막지 않게 따로.
 * (개발 서버(tsx)에선 작업 스레드 대신 메인에서 verifyRun 을 그대로 부름 — 조금씩 끊어서 돌리는 건 같음)
 */
import { parentPort } from "node:worker_threads";
import { replayer, type LogEntry } from "../../../web/src/lib/defense/replay";
import type { Result } from "../../../web/src/lib/defense/sim";
import { UNIT } from "../../../web/src/lib/defense/units";

export interface VerifyJob {
  id: number;
  seed: number;
  players: number;
  log: LogEntry[];
}
export interface VerifyOut {
  id: number;
  /** 보드마다 결과 (끝나지 않은 보드는 null) */
  results: (Result | null)[];
  /** 보드마다 가장 높은 등급 유닛 3개 (순위표에 보여 줌) */
  tops: string[][];
  ticks: number;
  cpu: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function verifyRun(job: VerifyJob): Promise<VerifyOut> {
  const r = replayer(job.seed, job.players, job.log);
  let cpu = 0;
  for (;;) {
    const t = performance.now();
    const done = r.run(3000);
    cpu += performance.now() - t;
    if (done) break;
    await sleep(1);
  }
  const g = r.game;
  return {
    id: job.id,
    results: g.boards.map((b) => b.result),
    tops: g.boards.map((b) =>
      [...new Set(b.cells.filter((c) => c.def).map((c) => c.def!))]
        .sort((a, c) => UNIT[c].grade - UNIT[a].grade || UNIT[c].dmg - UNIT[a].dmg)
        .slice(0, 3)
    ),
    ticks: g.tick,
    cpu: Math.round(cpu),
  };
}

parentPort?.on("message", (job: VerifyJob) => {
  verifyRun(job).then(
    (r) => parentPort!.postMessage(r),
    (e) => parentPort!.postMessage({ id: job.id, error: String(e?.stack ?? e) })
  );
});
