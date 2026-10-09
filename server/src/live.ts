import type { Database } from "./db";

/*
 * 배포(서버 재시작) 때 메모리에만 있는 방(스케치 · 격투 · 포커)을 이어 주기.
 *
 *  1) 내려가라는 신호(SIGTERM)를 받으면 drain(): 모두에게 "곧 다시 시작" 공지 + 새 판·새 경기 시작을 막고,
 *     진행 중인 판(포커 한 판, 격투 한 경기)이 끝나길 최대 DRAIN_MS 만큼 기다림
 *  2) 상태를 DB(live_state)에 저장하고 내려감
 *  3) 새 서버가 뜨면 저장해 둔 방을 다시 만듦. 브라우저는 알아서 다시 연결·구독하고,
 *     방 구독이 들어오면 그 사람이 자리 주인으로 돌아옴 (RESTORE_GRACE_MS 안에 안 돌아온 사람은 나간 것으로 처리)
 */

export interface LiveGame {
  /** 끝나기를 기다릴 만한 진행 중인 것이 있나 (포커 판, 격투 경기) */
  busy(): boolean;
  /** 새로 시작하는 것을 막음 (내려가기 전) */
  drain(): void;
  /** 진행 중인 DB 쓰기(정산 등)가 끝나길 기다림 */
  flush?(): Promise<void>;
  /** JSON 으로 저장할 수 있는 상태 */
  snapshot(): unknown;
  /** 저장해 둔 상태로 방을 다시 만듦. downMs = 내려가 있던 시간 (남은 시간 계산을 미룸) */
  restore(data: unknown, downMs: number): void;
}

/** 다시 켜진 서버가 저장된 방을 이어받는 기준: 이보다 오래된 저장은 버림 */
const MAX_AGE_MS = 15 * 60_000;
/** 다시 켜진 뒤 이 시간 안에 돌아오지 않은 사람은 자리에서 뺌 */
export const RESTORE_GRACE_MS = 90_000;
/** 다시 켜진 서버에서 아직 아무 연결도 주인으로 돌아오지 않은 자리 (owners 에 넣는 표시) */
export const RESTORED = "~restored";
/** 한 게임의 저장 크기 상한 (Mongo 문서 16MB 아래로) */
const MAX_BYTES = 12 * 1024 * 1024;

interface LiveDoc {
  _id: string;
  at: Date;
  json: string;
}

export async function saveLive(db: Database, games: Record<string, LiveGame>): Promise<void> {
  const col = db.col<LiveDoc>("live_state");
  const at = new Date();
  for (const [name, g] of Object.entries(games)) {
    try {
      const json = JSON.stringify(g.snapshot());
      if (json.length > MAX_BYTES) {
        console.warn(`[live] ${name} 상태가 너무 커서 저장하지 않음 (${json.length} bytes)`);
        continue;
      }
      await col.replaceOne({ _id: name }, { at, json }, { upsert: true });
    } catch (e) {
      console.error(`[live] ${name} 저장 실패`, e);
    }
  }
}

/** 저장된 상태를 읽어 각 게임에 넘기고 지움. 이어받은 방 수를 돌려줌 */
export async function restoreLive(db: Database, games: Record<string, LiveGame>): Promise<string[]> {
  const col = db.col<LiveDoc>("live_state");
  const docs = await col.find({}).toArray();
  if (!docs.length) return [];
  await col.deleteMany({});
  const now = Date.now();
  const done: string[] = [];
  for (const d of docs) {
    const g = games[d._id];
    const down = now - new Date(d.at).getTime();
    if (!g || down > MAX_AGE_MS || down < 0) continue;
    try {
      g.restore(JSON.parse(d.json), down);
      done.push(d._id);
    } catch (e) {
      console.error(`[live] ${d._id} 복구 실패 — 새로 시작`, e);
    }
  }
  return done;
}

/** 진행 중인 것이 끝나거나 maxMs 가 지날 때까지 기다림 */
export async function waitIdle(games: LiveGame[], maxMs: number, stepMs = 250): Promise<boolean> {
  const until = Date.now() + maxMs;
  while (games.some((g) => g.busy())) {
    if (Date.now() >= until) return false;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return true;
}
