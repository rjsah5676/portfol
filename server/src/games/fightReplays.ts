import type { Database } from "../db";
import { newId } from "../ids";

/**
 * 격투 경기 기록 (AI를 사람처럼 만드는 데이터) — 컬렉션 fight_replays.
 * 시뮬은 같은 입력이면 같은 결과라서 위치 · 체력 대신 입력만 저장 → 같은 빌드로 다시 돌리면 프레임 그대로 복원.
 *  - pvp / rank : 두 선수 확정 입력 (관전용으로 이미 올라오던 조각 그대로: { f 시작 프레임, i 36진수 쉼표 목록 })
 *  - rankbot    : 랭크전 봇전 — 사람(0번 자리) 입력 [값, 연속 프레임 수]..., 봇은 seed · botR 로 다시 나옴
 *  - ai         : CPU 대전 — 사람(0번) 입력 [값, 연속 프레임 수]..., 봇은 seed · level 로 다시 나옴 (이기든 지든)
 * rs 는 저장할 때 읽은 랭크전 레이팅 (레이팅 없는 사람은 null) — 구간별로 나눠 쓰려고.
 */
export type ReplayMode = "pvp" | "rank" | "rankbot" | "ai";
export type Rle = [number, number][];
export interface ReplayChunk {
  f: number;
  i: string;
}
export interface FightReplay {
  _id: string;
  at: Date;
  mode: ReplayMode;
  /** 게임 데이터(+AI) 지문 — 같은 지문 코드로 돌려야 같은 경기가 나옴 */
  build: string;
  uids: [string | null, string | null];
  /** 비회원 자리 */
  guest?: [boolean, boolean];
  rs: [number | null, number | null];
  chars: [number, number];
  map: number;
  /** 0 = 1P 승, 1 = 2P 승, 2 = 무승부, null = 확인 못 함 */
  out: 0 | 1 | 2 | null;
  seed?: number;
  botR?: number;
  level?: number;
  /** 온라인: 입력 지연 프레임 */
  delay?: number;
  inputs?: [Rle | null, Rle | null];
  chunks?: [ReplayChunk[], ReplayChunk[]];
  frames?: number;
}

export function createFightReplays(db: Database) {
  const col = db.col<FightReplay>("fight_replays");
  const ratings = db.col<{ uid: string; r: number }>("fight_rank_ratings");
  const ratingOf = async (uid: string | null) => (uid ? ((await ratings.findOne({ uid }, { projection: { r: 1 } }))?.r ?? null) : null);
  return {
    /** 실패해도 경기 진행엔 영향 없음 (기록만 빠짐) */
    async save(doc: Omit<FightReplay, "_id" | "at" | "rs">) {
      try {
        const rs = (await Promise.all(doc.uids.map(ratingOf))) as [number | null, number | null];
        await col.insertOne({ _id: newId(), at: new Date(), rs, ...doc });
      } catch (e) {
        console.warn("[fight] 경기 기록 저장 실패", e);
      }
    },
  };
}
