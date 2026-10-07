import { mkdirSync } from "node:fs";
import path from "node:path";
import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import type { Config } from "./config";

/** 모든 문서는 문자열 _id (기존 Firestore 문서 id를 그대로 옮겨오기 위해) */
export type Doc<T = Document> = T & { _id: string };

export interface Database {
  client: MongoClient;
  db: Db;
  col<T extends Document = Document>(name: string): Collection<Doc<T>>;
  close(): Promise<void>;
}

/** 점수 하나로 줄 세우는 랭킹 컬렉션 (이름은 기존 Firestore 컬렉션 그대로) */
export const RANK_COLLECTIONS = [
  "score",
  "minesweeper_rankings",
  "reaction",
  "chess_ai_rankings",
  "janggi_ai_rankings",
  "omok_ai_rankings",
  "fight_ai_rankings",
] as const;
export const ROOM_COLLECTIONS = ["chess_rooms", "janggi_rooms", "omok_rooms"] as const;

/**
 * DB 연결. MONGODB_URI가 없고 개발 모드면 내장 MongoDB를 띄움
 * (첫 실행 때 mongod 바이너리를 내려받고, 데이터는 cfg.mongoDataDir 에 남음).
 */
export async function connectDatabase(cfg: Config): Promise<Database> {
  let uri = cfg.mongoUri;
  let stopEmbedded: (() => Promise<unknown>) | null = null;

  if (!uri) {
    if (cfg.env === "production") throw new Error("MONGODB_URI가 필요합니다.");
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    const dbPath = path.resolve(cfg.mongoDataDir);
    mkdirSync(dbPath, { recursive: true });
    const embedded = await MongoMemoryServer.create({
      instance: { dbPath, storageEngine: "wiredTiger" },
    });
    uri = embedded.getUri();
    // doCleanup:false → 종료해도 데이터 폴더는 지우지 않음
    stopEmbedded = () => embedded.stop({ doCleanup: false });
    console.log(`[db] 내장 MongoDB 사용 (${dbPath})`);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const db = client.db(cfg.mongoDb);
  const database: Database = {
    client,
    db,
    col: (name) => db.collection(name),
    async close() {
      await client.close().catch(() => {});
      await stopEmbedded?.().catch(() => {});
    },
  };
  await ensureIndexes(database);
  await migrate(database);
  return database;
}

async function ensureIndexes({ db }: Database) {
  const tasks: Promise<unknown>[] = [];
  const idx = (
    col: string,
    keys: Record<string, 1 | -1>,
    options: { expireAfterSeconds?: number; unique?: boolean } = {}
  ) =>
    // 인덱스는 성능용이라 실패해도 서버는 뜨게 함
    tasks.push(
      db
        .collection(col)
        .createIndex(keys, options)
        .catch((e) => console.warn(`[db] index ${col}`, e))
    );

  idx("score", { score: -1 });
  idx("minesweeper_rankings", { time: 1 });
  idx("reaction", { score: 1 });
  for (const c of ["chess_ai_rankings", "janggi_ai_rankings", "omok_ai_rankings", "fight_ai_rankings"])
    idx(c, { score: -1 });
  idx("rhythm_rankings", { chart: 1, score: -1 });
  // 격투 AI: 내 캐릭터마다 기록 하나 (캐릭터별 순위)
  idx("fight_ai_rankings", { ch: 1, score: -1 });
  idx("fight_ai_rankings", { uid: 1, ch: 1 });
  // 한 사람당 기록 하나: 등록할 때 그 사람의 기존 기록을 찾음
  for (const c of RANK_COLLECTIONS) idx(c, { uid: 1 });
  idx("rhythm_rankings", { chart: 1, uid: 1 });
  // 랭킹 티켓: 사람별 최근 발급 수 확인, 8일 지나면 자동 삭제(유효 기간 7일)
  idx("rank_tickets", { uid: 1, createdAt: -1 });
  idx("rank_tickets", { createdAt: 1 }, { expireAfterSeconds: 8 * 24 * 60 * 60 });
  idx("guest", { id: -1 });
  idx("guest", { uid: 1 });
  // 별명은 대소문자 구분 없이 하나뿐
  idx("users", { nickKey: 1 }, { unique: true });
  idx("inquiries", { createdAt: -1 });
  for (const c of ROOM_COLLECTIONS) {
    idx(c, { updatedAt: -1 });
    idx(c, { whiteUid: 1 });
    idx(c, { blackUid: 1 });
  }
  idx("board_chat", { room: 1, createdAt: -1 });
  idx("board_presence", { room: 1 });
  // 유입 분석: 날짜별 집계 · 최근 유입 · 세션별 페이지 수, 180일 지나면 자동 삭제
  idx("traffic_hits", { day: 1, entry: 1, at: -1 });
  idx("traffic_hits", { sid: 1 });
  idx("traffic_hits", { at: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });
  await Promise.all(tasks);
}

/** 예전 형식 데이터 고치기 (몇 번 돌아도 같음) */
async function migrate({ db }: Database) {
  // 격투 AI 기록에 내 캐릭터(ch) 채우기: opp "3:kai>igna" → "kai", 캐릭터 없는 예전 기록 "3" → ""
  await db
    .collection("fight_ai_rankings")
    .updateMany({ ch: { $exists: false } }, [
      {
        $set: {
          ch: {
            $ifNull: [
              { $arrayElemAt: [{ $split: [{ $ifNull: [{ $arrayElemAt: [{ $split: ["$opp", ":"] }, 1] }, ""] }, ">"] }, 0] },
              "",
            ],
          },
        },
      },
    ])
    .catch((e) => console.warn("[db] migrate fight_ai_rankings.ch", e));
}
