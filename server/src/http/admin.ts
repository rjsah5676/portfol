import { Router } from "express";
import { z } from "zod";
import { RANK_COLLECTIONS, ROOM_COLLECTIONS } from "../db";
import type { Deps } from "../deps";
import { bad } from "../errors";
import { h, requireAdmin } from "./util";

/*
 * 관리자 페이지 "데이터" 탭용 범용 조회·수정·삭제.
 * 경로는 기존 Firestore 컬렉션 경로 표기를 그대로 받음 ("score", "rhythm_rankings/{곡_난이도}/scores" …).
 *   GET    /api/admin/docs?path=…
 *   PUT    /api/admin/docs           { path, id, data }   문서 전체 교체
 *   POST   /api/admin/docs/delete    { path, ids }
 *   POST   /api/admin/rooms/delete   { coll, ids }        대국방 + 채팅·접속기록까지
 */

export const FETCH_LIMIT = 500;

const TOP_LEVEL = new Set<string>([
  ...RANK_COLLECTIONS,
  ...ROOM_COLLECTIONS,
  "guest",
  "siteStats",
  "studyPosts",
  "inquiries",
  // 메뉴에서 내린 예전 스케치 퀴즈 데이터
  "sketch_user",
  "sketch_user_room",
  "sketch_user_chat",
]);

/** Firestore식 경로 → Mongo 컬렉션 + 조건 */
function resolve(path: string): { col: string; scope: Record<string, string> } {
  const segs = path.split("/").filter(Boolean);
  if (segs.length === 1 && TOP_LEVEL.has(segs[0])) return { col: segs[0], scope: {} };
  // 리듬게임 랭킹은 곡·난이도별 하위 컬렉션이었음 → 한 컬렉션에 chart 필드로 구분
  if (segs.length === 3 && segs[0] === "rhythm_rankings" && segs[2] === "scores")
    return { col: "rhythm_rankings", scope: { chart: segs[1] } };
  throw bad("관리할 수 없는 경로입니다.");
}

// JSON으로 주고받을 때 날짜는 {"__timestamp": ISO} (관리자 편집기 표기와 같음)
const TS_KEY = "__timestamp";

export function encode(v: unknown): unknown {
  if (v instanceof Date) return { [TS_KEY]: v.toISOString() };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
}

export function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === TS_KEY) {
      const d = new Date(String(o[TS_KEY]));
      if (Number.isNaN(d.getTime())) throw bad(`날짜 형식 오류: ${String(o[TS_KEY])}`);
      return d;
    }
    for (const k of keys) if (k.startsWith("$") || k.includes(".")) throw bad(`쓸 수 없는 필드 이름: ${k}`);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

const ids = z.array(z.string().min(1)).max(2000);

export interface AdminHooks {
  /** 방명록이 바뀜 → 구독자에게 다시 보냄 */
  guestChanged(): void;
  /** 대국방이 지워짐 → 로비·방 구독자에게 알림 */
  roomsDeleted(coll: string, ids: string[]): void;
}

export function adminRouter({ db, auth, web }: Deps, hooks: AdminHooks): Router {
  const r = Router();
  r.use((req, _res, next) => {
    requireAdmin(auth, req).then(() => next(), next);
  });

  r.get(
    "/docs",
    h(async (req) => {
      const { col, scope } = resolve(String(req.query.path ?? ""));
      const docs = await db.col(col).find(scope).limit(FETCH_LIMIT).toArray();
      return docs.map(({ _id, ...data }) => {
        for (const k of Object.keys(scope)) delete data[k];
        return { id: _id, data: encode(data) };
      });
    })
  );

  r.put(
    "/docs",
    h(async (req) => {
      const body = z
        .strictObject({ path: z.string(), id: z.string().min(1), data: z.record(z.string(), z.unknown()) })
        .parse(req.body);
      const { col, scope } = resolve(body.path);
      const data = decode(body.data) as Record<string, unknown>;
      delete data._id;
      await db.col(col).replaceOne({ _id: body.id, ...scope }, { ...data, ...scope }, { upsert: true });
      if (col === "guest") hooks.guestChanged();
      if (col === "studyPosts") void web.postsChanged();
    })
  );

  r.post(
    "/docs/delete",
    h(async (req) => {
      const body = z.strictObject({ path: z.string(), ids }).parse(req.body);
      const { col, scope } = resolve(body.path);
      await db.col(col).deleteMany({ _id: { $in: body.ids }, ...scope });
      if (col === "guest") hooks.guestChanged();
      if (col === "studyPosts") void web.postsChanged();
      if ((ROOM_COLLECTIONS as readonly string[]).includes(col)) hooks.roomsDeleted(col, body.ids);
    })
  );

  r.post(
    "/rooms/delete",
    h(async (req) => {
      const body = z.strictObject({ coll: z.enum(ROOM_COLLECTIONS), ids }).parse(req.body);
      const rooms = body.ids.map((id) => `${body.coll}/${id}`);
      await Promise.all([
        db.col(body.coll).deleteMany({ _id: { $in: body.ids } }),
        db.col("board_chat").deleteMany({ room: { $in: rooms } }),
        db.col("board_presence").deleteMany({ room: { $in: rooms } }),
        db.col("board_private").deleteMany({ _id: { $in: rooms } }),
      ]);
      hooks.roomsDeleted(body.coll, body.ids);
    })
  );

  return r;
}
