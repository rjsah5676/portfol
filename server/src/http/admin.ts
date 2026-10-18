import { Router } from "express";
import { z } from "zod";
import { RANK_COLLECTIONS, ROOM_COLLECTIONS } from "../db";
import type { Deps } from "../deps";
import { bad } from "../errors";
import { clearBpCache } from "./rankings";
import { h, ms, requireAdmin } from "./util";

/*
 * 관리자 페이지용 (전부 관리자 토큰 필요).
 *
 * 한눈에 보기
 *   GET    /api/admin/overview                      방문자·회원·문의·글·랭킹·방·서버 상태 + 최근 활동
 * 유입 분석
 *   GET    /api/admin/traffic?from=YYYY-MM-DD&to=YYYY-MM-DD   기간 집계 + 최근 유입 100건 (원본 IP 포함)
 *                                         &human=1 이면 클라우드(AWS·GCP 등) IP 유입을 뺌
 * 회원
 *   GET    /api/admin/users?q=&limit=&skip=&sort=   목록 (별명·이메일로 찾기 · 정렬 new|visit|points|visits · banned 는 정지된 회원만)
 *   PATCH  /api/admin/users/:uid   { nick?, badge?, money?, points? } 별명 · 꾸밈 · 포커 칩 · 포인트 바꾸기 (칩은 테이블 밖일 때 바로, 앉아 있으면 다음 판부터. 포인트는 원장에 '운영자 조정'으로 남음)
 *   GET    /api/admin/users/:uid/points  포인트 최근 내역
 *   DELETE /api/admin/users/:uid/avatar             올린 프로필 사진 지우기
 *   DELETE /api/admin/users/:uid?records=1          회원 지우기 (records=1 이면 랭킹·방명록도)
 * 열려 있는 방 (서버 메모리: DOODLE PARTY · 격투 · 포커 · 리듬 · 디펜스 멀티)
 *   GET    /api/admin/live
 *   POST   /api/admin/live/close   { game, id }
 *   GET    /api/admin/poker/settings          · PUT { botBoost }
 * 디펜스 플레이 기록 (밸런스 분석용, 90일)
 *   GET    /api/admin/defense/plays?from=ms&after=커서&limit=500   오래된 것부터 (next 커서로 이어 받기)
 * 픽셀 리셋 스토리 플레이 기록 (밸런스 분석용, 90일 · 회원/손님 모두)
 *   GET    /api/admin/rogue/plays?from=ms&after=커서&limit=500     오래된 것부터 (next 커서로 이어 받기)
 * 데이터 (범용 조회·수정·삭제) — 경로는 기존 Firestore 컬렉션 경로 표기를 그대로 받음
 *   ("score", "rhythm_rankings/{곡_난이도}/scores" …)
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
  "rank_tickets",
  "traffic_hits",
  "traffic_daily",
  // 격투 랭크전 · 디펜스 랭킹 · 디펜스 성장 · 우편 · 사이트 설정(공지)
  "fight_rank_ratings",
  // 격투 경기 기록 (보기 전용 — 입력 데이터는 목록에서 뺌)
  "fight_replays",
  "defense_rank",
  "defense_profile",
  "defense_plays",
  "rogue_plays",
  "mail",
  "site_config",
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

/** 서버 메모리에만 있는 방 (DOODLE PARTY · 격투 · 포커) */
export interface LiveRoom {
  id: string;
  name: string;
  status: string;
  players: string[];
  createdAt: number;
}
export type LiveGame = "sketch" | "fight" | "poker" | "rhythm" | "defense" | "marble";

export interface AdminHooks {
  /** 방명록이 바뀜 → 구독자에게 다시 보냄 */
  guestChanged(): void;
  /** 대국방이 지워짐 → 로비·방 구독자에게 알림 */
  roomsDeleted(coll: string, ids: string[]): void;
  /** 지금 열려 있는 스케치 · 격투 방 · 포커 테이블 */
  liveRooms(): Record<LiveGame, LiveRoom[]>;
  /** 방 닫기 (없는 방이면 false) */
  closeLiveRoom(game: LiveGame, id: string): boolean;
  /** 포커 설정 (봇 늘리기 켜고 끄기) */
  pokerSettings?(): { botBoost: boolean };
  setPokerSettings?(p: { botBoost?: boolean }): Promise<{ botBoost: boolean }>;
}

/** 한국 시간 기준 날짜 (방문자 수의 일별 키와 같은 형식) */
const kstDate = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
const DAY = 86_400_000;
const startedAt = Date.now();

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
/** 유입 분석에서 한 번에 볼 수 있는 기간 */
export const TRAFFIC_MAX_DAYS = 366;

export function adminRouter({ db, auth, web, users, points, gateway, cfg, traffic }: Deps, hooks: AdminHooks): Router {
  const r = Router();
  r.use((req, _res, next) => {
    requireAdmin(auth, req).then(() => next(), next);
  });

  // ───────────── 디펜스 플레이 기록 ─────────────

  r.get(
    "/defense/plays",
    h(async (req) => {
      const q = z
        .object({
          from: z.coerce.number().int().min(0).optional(),
          after: z.string().max(120).optional(),
          limit: z.coerce.number().int().min(1).max(FETCH_LIMIT).optional(),
        })
        .parse(req.query);
      // 커서 = "시각ms_id" (같은 시각이 여럿이어도 안 빠지게 id 까지)
      let filter: Record<string, unknown> = q.from ? { at: { $gte: new Date(q.from) } } : {};
      if (q.after) {
        const i = q.after.indexOf("_");
        const t = new Date(Number(q.after.slice(0, i)));
        const id = q.after.slice(i + 1);
        if (i < 1 || isNaN(t.getTime())) throw bad("커서가 잘못됐어요.");
        filter = { $or: [{ at: { $gt: t } }, { at: t, _id: { $gt: id } }] };
      }
      const limit = q.limit ?? FETCH_LIMIT;
      const docs = await db.col<{ _id: string; at: Date; end?: Date }>("defense_plays").find(filter).sort({ at: 1, _id: 1 }).limit(limit).toArray();
      const last = docs[docs.length - 1];
      return {
        list: docs.map((d) => ({ ...d, at: ms(d.at), end: ms(d.end) })),
        next: docs.length === limit && last ? `${last.at.getTime()}_${last._id}` : null,
      };
    })
  );

  // ───────────── 픽셀 리셋 스토리 플레이 기록 ─────────────

  r.get(
    "/rogue/plays",
    h(async (req) => {
      const q = z
        .object({
          from: z.coerce.number().int().min(0).optional(),
          after: z.string().max(120).optional(),
          limit: z.coerce.number().int().min(1).max(FETCH_LIMIT).optional(),
        })
        .parse(req.query);
      // 커서 = "받은시각ms_id"
      let filter: Record<string, unknown> = q.from ? { recvAt: { $gte: new Date(q.from) } } : {};
      if (q.after) {
        const i = q.after.indexOf("_");
        const t = new Date(Number(q.after.slice(0, i)));
        const id = q.after.slice(i + 1);
        if (i < 1 || isNaN(t.getTime())) throw bad("커서가 잘못됐어요.");
        filter = { $or: [{ recvAt: { $gt: t } }, { recvAt: t, _id: { $gt: id } }] };
      }
      const limit = q.limit ?? FETCH_LIMIT;
      const docs = await db.col<{ _id: string; recvAt: Date }>("rogue_plays").find(filter).sort({ recvAt: 1, _id: 1 }).limit(limit).toArray();
      const last = docs[docs.length - 1];
      return {
        list: docs.map((d) => ({ ...d, recvAt: ms(d.recvAt) })),
        next: docs.length === limit && last ? `${last.recvAt.getTime()}_${last._id}` : null,
      };
    })
  );

  // ───────────── 격투 경기 기록 (AI 학습용 — 입력 포함 전부) ─────────────

  r.get(
    "/fight/replays",
    h(async (req) => {
      const q = z.object({ after: z.string().max(120).optional() }).parse(req.query);
      // 커서 = "시각ms_id"
      let filter: Record<string, unknown> = {};
      if (q.after) {
        const i = q.after.indexOf("_");
        const t = new Date(Number(q.after.slice(0, i)));
        const id = q.after.slice(i + 1);
        if (i < 1 || isNaN(t.getTime())) throw bad("커서가 잘못됐어요.");
        filter = { $or: [{ at: { $gt: t } }, { at: t, _id: { $gt: id } }] };
      }
      const limit = 200;
      const docs = await db.col<{ _id: string; at: Date }>("fight_replays").find(filter).sort({ at: 1, _id: 1 }).limit(limit).toArray();
      const last = docs[docs.length - 1];
      return {
        list: docs.map((d) => ({ ...d, at: ms(d.at) })),
        next: docs.length === limit && last ? `${last.at.getTime()}_${last._id}` : null,
      };
    })
  );

  // ───────────── 한눈에 보기 ─────────────

  r.get(
    "/overview",
    h(async () => {
      const now = Date.now();
      const days = Array.from({ length: 14 }, (_, i) => kstDate(now - (13 - i) * DAY));
      const stats = db.col<{ count: number }>("siteStats");
      const count = (c: string, filter: Record<string, unknown> = {}) => db.col(c).countDocuments(filter);
      const latest = (c: string, n: number, sort: Record<string, 1 | -1> = { createdAt: -1 }) =>
        db.col(c).find({}).sort(sort).limit(n).toArray();

      const [total, daily, members, inqTotal, inqUnread, posts, guestTotal, rankCounts, rhythmCount, newRanks, roomCounts, lastGuest, lastInq, lastRanks, trafficToday] =
        await Promise.all([
          stats.findOne({ _id: "total" }),
          stats.find({ _id: { $in: days.map((d) => `daily_${d}`) } }).toArray(),
          users.adminRecent(5),
          count("inquiries"),
          count("inquiries", { read: false }),
          db.col("studyPosts").find({}, { projection: { section: 1 } }).toArray(),
          count("guest"),
          Promise.all(RANK_COLLECTIONS.map(async (c) => [c, await count(c)] as const)),
          count("rhythm_rankings"),
          Promise.all(["fight_rank_ratings", "defense_rank"].map(async (c) => [c, await count(c)] as const)),
          Promise.all(
            ROOM_COLLECTIONS.map(async (c) => [c, { total: await count(c), playing: await count(c, { status: "playing" }), waiting: await count(c, { status: "waiting" }) }] as const)
          ),
          latest("guest", 4, { id: -1 }),
          latest("inquiries", 4),
          Promise.all([...RANK_COLLECTIONS, "rhythm_rankings"].map(async (c) => (await latest(c, 3)).map((d) => ({ ...d, board: c })))),
          traffic.today(),
        ]);

      const byDay = new Map(daily.map((d) => [String(d._id).slice(6), d.count ?? 0]));
      const live = hooks.liveRooms();
      const liveOf = (rooms: LiveRoom[]) => ({ rooms: rooms.length, players: rooms.reduce((a, x) => a + x.players.length, 0) });

      // 최근 활동: 가입 · 방명록 · 문의 · 랭킹 등록을 시간순으로 섞음
      type Act = { kind: "member" | "guest" | "inquiry" | "rank"; at: number; who: string; text: string };
      const acts: Act[] = [
        ...members.recent.map((m) => ({ kind: "member" as const, at: m.createdAt, who: m.nick, text: "가입" })),
        ...lastGuest.map((g) => ({ kind: "guest" as const, at: Number(g.id) || 0, who: String(g.name ?? ""), text: String(g.contents ?? "") })),
        ...lastInq.map((q) => ({ kind: "inquiry" as const, at: ms(q.createdAt) ?? 0, who: String(q.name ?? ""), text: String(q.message ?? "").slice(0, 80) })),
        ...lastRanks.flat().map((x) => {
          const d = x as Record<string, unknown>;
          return { kind: "rank" as const, at: ms(d.createdAt) ?? 0, who: String(d.name ?? ""), text: d.board === "rhythm_rankings" ? `rhythm:${String(d.chart ?? "")}` : String(d.board) };
        }),
      ]
        .filter((a) => a.at > 0)
        .sort((a, b) => b.at - a.at)
        .slice(0, 14);

      const mem = process.memoryUsage();
      return {
        visitors: {
          total: total?.count ?? 0,
          today: byDay.get(days[13]) ?? 0,
          daily: days.map((date) => ({ date, count: byDay.get(date) ?? 0 })),
        },
        traffic: trafficToday,
        members: { total: members.total, recent: members.recent },
        inquiries: { total: inqTotal, unread: inqUnread },
        posts: { total: posts.length, retro: posts.filter((p) => p.section === "retro").length },
        guest: { total: guestTotal },
        rankings: { ...Object.fromEntries(rankCounts), rhythm_rankings: rhythmCount, ...Object.fromEntries(newRanks) },
        rooms: Object.fromEntries(roomCounts),
        live: { sketch: liveOf(live.sketch), fight: liveOf(live.fight), poker: liveOf(live.poker), rhythm: liveOf(live.rhythm), defense: liveOf(live.defense) },
        server: {
          env: cfg.env,
          startedAt,
          connections: gateway.connections(),
          node: process.version,
          memoryMb: Math.round(mem.rss / 1048576),
        },
        activity: acts,
      };
    })
  );

  // ───────────── 디펜스 초기화 (베타 승급 등) ─────────────
  // 디펜스 프로필 · 랭킹 · 판 기록 · 회원 디펜스 통계를 모두 지움. GP 잔액 · 원장 · 블록 테마(GP 로 산 것)는 그대로.
  r.get(
    "/defense/stats",
    h(async () => {
      const [profiles, ranks, runs] = await Promise.all(
        ["defense_profile", "defense_rank", "defense_runs"].map((c) => db.col(c).countDocuments({}))
      );
      return { profiles, ranks, runs };
    })
  );
  r.post(
    "/defense/reset",
    h(async (req) => {
      z.object({ confirm: z.literal("디펜스 초기화") }).parse(req.body);
      const out: Record<string, number> = {};
      for (const c of ["defense_profile", "defense_rank", "defense_runs"]) out[c] = (await db.col(c).deleteMany({})).deletedCount ?? 0;
      out.users = (await db.col("users").updateMany({ "stats.defense": { $exists: true } } as never, { $unset: { "stats.defense": "" } } as never)).modifiedCount;
      console.warn("[admin] 디펜스 데이터 초기화", JSON.stringify(out));
      return out;
    })
  );

  // ───────────── 다이스 타운 초기화 (베타 승급 등) ─────────────
  // 마블 프로필(별사탕 · 부품 · 캐릭터 · 아이템 · 패스) · 회원 마블 통계를 지움. GP 잔액 · 원장은 그대로.
  r.get(
    "/marble/stats",
    h(async () => {
      const profiles = await db.col("marble_profile").countDocuments({});
      const players = await db.col("users").countDocuments({ "stats.marble": { $exists: true } } as never);
      return { profiles, players };
    })
  );
  r.post(
    "/marble/reset",
    h(async (req) => {
      z.object({ confirm: z.literal("마블 초기화") }).parse(req.body);
      const out: Record<string, number> = {};
      out.marble_profile = (await db.col("marble_profile").deleteMany({})).deletedCount ?? 0;
      out.users = (await db.col("users").updateMany({ "stats.marble": { $exists: true } } as never, { $unset: { "stats.marble": "" } } as never)).modifiedCount;
      console.warn("[admin] 마블 데이터 초기화", JSON.stringify(out));
      return out;
    })
  );

  // ───────────── 픽셀 순찰대 초기화 (재화 설계 바꿀 때) ─────────────
  // 순찰대 프로필(장비 · 무기 · 재화 · 별 · 상점 구매 기록) · 판 기록 · 랭킹 · 회원 순찰대 통계를 지움. GP 잔액 · 원장 · 받은 업적은 그대로.
  r.get(
    "/patrol/stats",
    h(async () => {
      const [profiles, runs, ranks] = await Promise.all(["patrol_profile", "patrol_runs", "patrol_rank"].map((c) => db.col(c).countDocuments({})));
      const players = await db.col("users").countDocuments({ "stats.patrol": { $exists: true } } as never);
      return { profiles, runs, ranks, players };
    })
  );
  r.post(
    "/patrol/reset",
    h(async (req) => {
      z.object({ confirm: z.literal("순찰대 초기화") }).parse(req.body);
      const out: Record<string, number> = {};
      for (const c of ["patrol_profile", "patrol_runs", "patrol_rank"]) out[c] = (await db.col(c).deleteMany({})).deletedCount ?? 0;
      out.users = (await db.col("users").updateMany({ "stats.patrol": { $exists: true } } as never, { $unset: { "stats.patrol": "" } } as never)).modifiedCount;
      console.warn("[admin] 순찰대 데이터 초기화", JSON.stringify(out));
      return out;
    })
  );

  // ───────────── 유입 분석 ─────────────

  r.get(
    "/traffic",
    h(async (req) => {
      const q = z
        .object({ from: z.string().regex(DATE_KEY), to: z.string().regex(DATE_KEY), human: z.enum(["0", "1"]).optional() })
        .parse(req.query);
      const span = (Date.parse(q.to) - Date.parse(q.from)) / DAY + 1;
      if (!(span >= 1)) throw bad("시작일이 끝일보다 늦습니다.");
      if (span > TRAFFIC_MAX_DAYS) throw bad(`최대 ${TRAFFIC_MAX_DAYS}일까지 볼 수 있습니다.`);
      return traffic.range(q.from, q.to, { human: q.human === "1" });
    })
  );

  // ───────────── 회원 ─────────────

  r.get(
    "/users",
    h(async (req) => {
      const q = z
        .object({
          q: z.string().max(100).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
          skip: z.coerce.number().int().min(0).optional(),
          sort: z.enum(["new", "visit", "points", "visits", "banned"]).optional(),
        })
        .parse(req.query);
      return users.adminList(q);
    })
  );
  r.patch(
    "/users/:uid",
    h(async (req) => {
      const { points: pts, ...patch } = z
        .strictObject({
          nick: z.string().max(40).optional(),
          badge: z.string().max(40).nullable().optional(),
          money: z.number().int().min(0).max(1e15).optional(),
          points: z.number().int().min(0).max(1e9).optional(),
        })
        .parse(req.body);
      if (pts !== undefined) await points.adminSet(String(req.params.uid), pts);
      const user = await users.adminUpdate(String(req.params.uid), patch);
      // 별명이 바뀌면 방명록의 이름도 같이 바뀜
      if (patch.nick !== undefined) hooks.guestChanged();
      return user;
    })
  );
  r.get(
    "/users/:uid/points",
    h(async (req) => ({ log: await points.log(String(req.params.uid), 50) }))
  );
  r.delete(
    "/users/:uid/avatar",
    h(async (req) => {
      await users.adminClearAvatar(String(req.params.uid));
    })
  );
  r.delete(
    "/users/:uid",
    h(async (req) => {
      const res = await users.adminRemove(String(req.params.uid), req.query.records === "1");
      // 방명록의 이름 표시가 바뀌었을 수 있음
      hooks.guestChanged();
      return res;
    })
  );

  // ───────────── 열려 있는 방 (스케치 · 격투) ─────────────

  r.get(
    "/live",
    h(() => hooks.liveRooms())
  );
  r.post(
    "/live/close",
    h(async (req) => {
      const body = z.strictObject({ game: z.enum(["sketch", "fight", "poker", "rhythm", "defense", "marble"]), id: z.string().min(1).max(80) }).parse(req.body);
      return { closed: hooks.closeLiveRoom(body.game, body.id) };
    })
  );

  // ───────────── 포커 설정 ─────────────

  r.get(
    "/poker/settings",
    h(() => hooks.pokerSettings?.() ?? { botBoost: true })
  );
  r.put(
    "/poker/settings",
    h(async (req) => {
      const body = z.strictObject({ botBoost: z.boolean() }).parse(req.body);
      return (await hooks.setPokerSettings?.(body)) ?? body;
    })
  );

  // ───────────── 데이터 (범용) ─────────────

  r.get(
    "/docs",
    h(async (req) => {
      const { col, scope } = resolve(String(req.query.path ?? ""));
      // 격투 경기 기록: 최신순, 무거운 입력 데이터(inputs · chunks)는 빼고 개수만
      const docs =
        col === "fight_replays"
          ? (await db.col(col).find(scope, { projection: { inputs: 0, chunks: 0 } }).sort({ at: -1 }).limit(FETCH_LIMIT).toArray())
          : await db.col(col).find(scope).limit(FETCH_LIMIT).toArray();
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
      if (col === "rhythm_rankings") clearBpCache(); // BP 랭킹 30초 캐시를 바로 비움
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
      if (col === "rhythm_rankings") clearBpCache();
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
