import { Router, type Request } from "express";
import { z } from "zod";
import {
  chessScore,
  janggiScore,
  omokScore,
} from "../../../web/src/lib/aiScore";
import { TOTAL_SEC as MELON_SEC } from "../../../web/src/lib/melon/logic";
import type { Captcha } from "../captcha";
import type { Deps } from "../deps";
import { AppError, bad, notFound, unauthenticated } from "../errors";
import { newId } from "../ids";
import { KeyedMutex } from "../mutex";
import { RHYTHM_CHARTS } from "./rhythmCharts";
import { bpOf, BP_TOP_SONGS } from "./bp";
import { pictureOf } from "../users";
import { createFightRating } from "../games/fightRating";
import { BUILD_ID as FIGHT_BUILD } from "../../../web/src/lib/fight/sim";
import { CASE_RE as SUSPECT_CASE_RE, kstDay, scoreOf as suspectScore } from "../../../web/src/lib/suspect/engine";
import { HANGUL_WAVE_PTS, LINE_MAX, LINE_RE } from "../../../web/src/lib/hangul/judge";
import { judge as judgeHangul } from "../hangul/kiwi";
import { h, ms, userOf } from "./util";

/*
 * 게임 랭킹. 컬렉션 이름과 값의 범위는 기존 firestore.rules 그대로.
 *   GET  /api/rankings/:board?limit=10
 *   GET  /api/rankings/rhythm/:chart?limit=10      (chart = 곡id_난이도)
 *   GET  /api/rankings/fight-rating?limit=10      격투 랭크전 레이팅
 *   GET  /api/rankings/fight-rank-stats           격투 랭크전 캐릭터 통계 (로그인했으면 내 캐릭터별 기록도)
 *   GET  /api/rankings/fight-me                   (로그인) 내 랭크전 레이팅·순위 · 캐릭터별 기록 · 최근 경기
 *   GET  /api/rankings/rhythm-bp?limit=10          회원 BP 랭킹 (곡별 최고 BP 상위 20곡 합)
 *   POST /api/rankings/tickets  { board }           게임을 시작할 때: 1회용 티켓 발급 (로그인 필요)
 *   POST /api/rankings/:board   { …기록, ticket }   기록 등록 (로그인 필요)
 *   POST /api/rankings/rhythm/:chart
 *
 * 가짜 기록 막기 (점수는 브라우저에서 계산되므로 완전히 막지는 못함 — 요청만 꾸며서 넣는 것을 막는 수준):
 *   1) 로그인(익명 포함)한 사용자만, 한 사람(uid)은 랭킹마다 가장 좋은 기록 하나만
 *   2) 티켓: 게임을 시작할 때 받고 등록할 때 내야 함. 한 번만 쓸 수 있고,
 *      받은 뒤로 "그 기록이 나오려면 걸리는 시간"만큼 지나지 않았으면 거절
 *   3) 값끼리 맞는지: AI 대국 점수는 같은 공식으로 다시 계산, 리듬게임은 채보(노트 수)와 비교
 *   4) 익명 로그인이면 등록할 때 사람 확인(captcha.ts, 한 번 통과하면 24시간) — Google 로그인은 건너뜀
 */

/** 랭킹에 적는 이름 길이 (회원 별명 최대 길이와 같음). 예전에 더 길게 들어간 기록은 그대로 둠 */
export const RANK_NAME_MAX = 10;
const name = z.string().min(1).max(RANK_NAME_MAX);
const int = z.number().int();

/** 체스·장기·오목·격투 AI 랭킹 공통 (rules의 validAIRank) */
const aiRank = (maxScore: number) =>
  z.strictObject({
    name,
    score: int.gt(1_000_000).max(maxScore),
    opp: z.string().max(20),
    moves: int.min(2).max(1000),
    seconds: int.min(0).max(86400),
    lead: z.number().min(0).max(100),
  });

/** score = 상대 단계 × 1,000,000 + 판 점수 → 단계와 상대(opp)가 맞는지 */
const stageMatches =
  (stages: Record<string, number>) => (d: { score: number; opp: string }) =>
    Math.floor(d.score / 1_000_000) ===
    (Object.hasOwn(stages, d.opp) ? stages[d.opp] : 0);

const CHESS_STAGES = {
  "400": 1,
  "800": 2,
  "1200": 3,
  "1600": 4,
  "2000": 5,
  "2400": 6,
};
const JANGGI_STAGES = {
  jangyeongsil: 1,
  heojun: 2,
  kimjeongho: 3,
  jeongyakyong: 4,
  hwanghui: 5,
  gyebaek: 6,
  kimyusin: 7,
  euljimundeok: 8,
  yeongaesomun: 9,
  gangamchan: 10,
  gwanggaeto: 11,
  yisunsin: 12,
};
const OMOK_STAGES = {
  sprout: 1,
  kid: 2,
  playground: 3,
  grandpa: 4,
  gunmo: 5,
  pcbang: 6,
  master: 7,
  alpha: 8,
};

type Data = Record<string, any>;

interface Board {
  sort: Record<string, 1 | -1>;
  schema: z.ZodType<Record<string, unknown>>;
  /** 이 기록이 나오려면 게임 시작부터 최소 몇 초가 걸리는지 */
  minSec: (d: Data) => number;
  /** 값끼리 맞는지 (틀리면 거절) */
  check?: (d: Data) => boolean;
  /**
   * 한 사람이 여러 기록을 가질 때 나누는 기준 (격투: 내 캐릭터마다 하나).
   * 이 값으로 걸러 보면 그 안의 순위, 안 거르면(전체) 사람마다 가장 좋은 기록 하나씩.
   */
  split?: { field: string; of: (d: Data) => string; valid: (v: string) => boolean };
  /** 첫 기록만 남김 (오늘의 용의자: 다시 풀면 답을 알고 푸는 거라) */
  firstOnly?: boolean;
  /** 서버에서 다시 따져 보는 확인 (오래 걸릴 수 있는 것 — 니들이 한글을 알아?: 대표 문장을 다시 판정) */
  verify?: (d: Data) => Promise<boolean>;
}

/** AI 대국: 상대 단계 */
const tierOf = (d: Data) => Math.floor(d.score / 1_000_000);
/** AI 대국의 seconds = 내 차례에 쓴 시간(체스·장기·오목) 또는 경기 시간(격투) */
const aiSec = (d: Data) => d.seconds;

export const BOARDS: Record<string, Board> = {
  // 멜론게임 (지운 멜론 수, 판 전체 21x12=252개)
  // 한 판은 정해진 시간(약 2분)이 다 지나야 끝남
  score: {
    sort: { score: -1 },
    schema: z.strictObject({ name, score: int.min(0).max(252) }),
    minSec: () => MELON_SEC,
  },
  // 지뢰찾기 (클리어 시간, 초)
  minesweeper_rankings: {
    sort: { time: 1 },
    schema: z.strictObject({ name, time: z.number().min(10).max(86400) }),
    minSec: (d) => d.time,
  },
  // 반응속도 (5회 평균, ms). 한 번마다 1.5초 이상 기다렸다 누르고, 100ms 보다 빠르면 무효
  reaction: {
    sort: { score: 1 },
    schema: z.strictObject({ name, score: z.number().min(80).max(10000) }),
    minSec: (d) => 5 * (1.5 + d.score / 1000),
    check: (d) => d.score >= 100,
  },
  chess_ai_rankings: {
    sort: { score: -1 },
    schema: aiRank(7_000_000).refine(stageMatches(CHESS_STAGES)),
    minSec: aiSec,
    check: (d) =>
      chessScore(tierOf(d), d.lead, d.moves, d.seconds).score === d.score,
  },
  // 외통승인지(판정승이면 감점)는 기록에 없어서 두 경우 모두 맞춰 봄
  janggi_ai_rankings: {
    sort: { score: -1 },
    schema: aiRank(13_000_000).refine(stageMatches(JANGGI_STAGES)),
    minSec: aiSec,
    check: (d) =>
      [true, false].some(
        (mate) =>
          janggiScore(tierOf(d), d.lead, d.moves, d.seconds, mate).score ===
          d.score,
      ),
  },
  // 백으로 이겼는지(가산점)도 기록에 없어서 두 경우 모두 맞춰 봄
  omok_ai_rankings: {
    sort: { score: -1 },
    schema: aiRank(9_000_000).refine(stageMatches(OMOK_STAGES)),
    minSec: aiSec,
    check: (d) =>
      [true, false].some(
        (white) =>
          omokScore(tierOf(d), d.moves, d.seconds, white).score === d.score,
      ),
  },
  // 격투 AI 랭킹(fight_ai_rankings)은 랭크전 도입(10.08)으로 없앰 — 컬렉션은 남겨 둠 (관리자 데이터 화면)
  // 니들이 한글을 알아? (점수 = 완성한 문장 점수 합 + 버틴 웨이브 × 100). 대표글(그 판 최고 점수 문장)은 서버가 다시 판정
  hangul_rankings: {
    sort: { score: -1 },
    schema: z.strictObject({
      name,
      score: int.min(0).max(1_000_000_000),
      wave: int.min(0).max(100_000),
      best: z.string().max(LINE_MAX),
      bestPts: int.min(0).max(1_000_000),
    }),
    // 웨이브 하나는 20초
    minSec: (d) => Math.max(0, d.wave - 1) * 20,
    check: (d) => d.score >= d.wave * HANGUL_WAVE_PTS + d.bestPts && (d.best === "" ? d.bestPts === 0 : LINE_RE.test(d.best)),
    verify: async (d) => {
      if (d.best === "") return true;
      const j = await judgeHangul(d.best);
      return j.sentence && j.points === d.bestPts;
    },
  },
};

const CHART_RE = /^[a-z0-9-]+_(easy|normal|hard|expert|nightmare|explus)$/;
const rhythmSchema = z.strictObject({
  name,
  score: int.min(0).max(1_000_000),
  acc: z.number().min(0).max(100),
  maxCombo: int.min(0).max(5000),
  fc: z.boolean(),
  ap: z.boolean(),
});

/** 리듬게임: 끝까지 친 판만 올라옴. 내장곡은 채보와 비교 (그 밖의 채보는 형식만 봄) */
const rhythmBoard = (chart: string): Board => {
  const info = RHYTHM_CHARTS.get(chart);
  return {
    sort: { score: -1 },
    schema: rhythmSchema,
    minSec: () => info?.lastTime ?? 0,
    check: (d) =>
      !info ||
      (d.maxCombo <= info.maxCombo &&
        // 끝까지 친 판은 점수 = 정확도 × 10,000 (정확도는 소수 둘째 자리까지 와서 약간의 오차 허용)
        Math.abs(d.score - d.acc * 10_000) <= 100 &&
        // 풀콤보면 모든 판정 단위가 콤보로 이어짐
        (!d.fc || d.maxCombo >= info.units) &&
        (!d.ap || d.fc)),
  };
};

/**
 * 오늘의 용의자: 날짜 · 난이도(case = "YYYYMMDD_tier")마다 랭킹. 점수 = 시간 + 실수 30초 + 힌트 60초 (작을수록 좋음).
 * 퍼즐은 날짜 시드로 누구나 같은 판이 나오고, 첫 기록만 남음. 어제 · 오늘 · 내일(시차 여유) 사건만 받음.
 */
const suspectSchema = z.strictObject({
  name,
  time: z.number().min(5).max(86400),
  miss: int.min(0).max(500),
  hint: int.min(0).max(100),
  score: z.number().min(5).max(200_000),
});
const suspectBoard = (c: string): Board => ({
  sort: { score: 1 },
  schema: suspectSchema,
  minSec: (d) => d.time,
  check: (d) => {
    const day = c.slice(0, 8);
    const now = Date.now();
    const recent = day >= kstDay(now, -1) && day <= kstDay(now, 1);
    return recent && Math.abs(d.score - suspectScore(d.time, d.miss, d.hint)) < 0.05;
  },
  firstOnly: true,
});

const limitOf = (v: unknown) =>
  Math.min(100, Math.max(1, Math.floor(Number(v)) || 10));

/** DB 문서 → 응답 한 줄 (id, 필드들, createdAt은 ms). 누구 기록인지(uid)는 내보내지 않음 */
const row = ({
  _id,
  createdAt,
  chart: _chart,
  uid: _uid,
  ...rest
}: Record<string, unknown>) => ({
  id: _id,
  ...rest,
  createdAt: ms(createdAt),
});
/** 회원 uid → 프로필 사진 주소 (직접 올린 사진이 있는 회원만). 랭킹 줄에 사진을 붙이는 데 씀 */
async function avatarsOf(
  db: Deps["db"],
  uids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(uids)];
  if (!ids.length) return out;
  const docs = await db
    .col("users")
    .find({ _id: { $in: ids }, $or: [{ "avatar.at": { $exists: true } }, { photo: { $type: "string" } }] })
    .project({ "avatar.at": 1, photo: 1 })
    .toArray();
  for (const d of docs) {
    const url = pictureOf(String(d._id), d as { avatar?: { at?: number }; photo?: string | null });
    if (url) out.set(String(d._id), url);
  }
  return out;
}
/** 문서들 → 응답 줄 + avatar (회원이 올린 사진이 있으면 그 주소, 아니면 null) */
async function rows(db: Deps["db"], docs: Record<string, unknown>[]) {
  const av = await avatarsOf(
    db,
    docs.filter((d) => d.member).map((d) => String(d.uid)),
  );
  return docs.map((d) => ({
    ...row(d),
    avatar: (d.member && av.get(String(d.uid))) || null,
  }));
}

/** 티켓을 받은 시각과 실제 게임 시작 사이의 오차(통신 지연 등) 허용치(초) */
const SLACK_SEC = 3;
/** 티켓 유효 기간 — AI 대국은 저장했다가 며칠 뒤에 이어 둘 수 있어서 넉넉하게 */
export const TICKET_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 한 사람이 1분에 받을 수 있는 티켓 수 (지뢰찾기처럼 금방 다시 시작하는 게임 기준으로 넉넉하게) */
const TICKETS_PER_MIN = 60;

const rejected = () =>
  new AppError(
    "RANK_REJECTED",
    "기록을 확인할 수 없어 등록하지 못했습니다.",
    400,
  );

interface Ticket {
  uid: string;
  /** 랭킹 이름. 리듬게임은 "rhythm:곡id_난이도" */
  board: string;
  createdAt: Date;
  used: boolean;
}

/** BP 랭킹 한 줄 (uid는 서버 안에서만 — 밖으로 낼 때 뺌) */
export interface BpRow {
  uid: string;
  id: string;
  name: string;
  member: boolean;
  avatar: string | null;
  bp: number;
  songs: number;
  best: { bp: number; chart: string; score: number } | null;
}
// 회원 BP 랭킹: 회원의 내장곡 기록 전부를 모아 곡마다 가장 높은 BP 하나씩, 상위 20곡 합. 30초 캐시 (리듬 기록이 올라오면 비움)
let bpCache: { at: number; rows: BpRow[] } | null = null;
export const clearBpCache = () => {
  bpCache = null;
};
export async function bpBoard(db: Deps["db"]): Promise<BpRow[]> {
  if (bpCache && Date.now() - bpCache.at <= 30_000) return bpCache.rows;
  const docs = await db
    .col("rhythm_rankings")
    .find({ member: true }) // BP는 회원만 (곡별 랭킹은 비회원도 그대로)
    .project({
      uid: 1,
      chart: 1,
      score: 1,
      name: 1,
      member: 1,
      createdAt: 1,
    })
    .toArray();
  const byUid = new Map<
    string,
    {
      name: string;
      member: boolean;
      at: number;
      songs: Map<string, { bp: number; chart: string; score: number }>;
    }
  >();
  for (const d of docs) {
    const chart = String(d.chart);
    const info = RHYTHM_CHARTS.get(chart);
    if (!info) continue; // 연습곡·없어진 채보는 BP 없음
    const bp = bpOf(info.level, Number(d.score) || 0);
    const song = chart.slice(0, chart.lastIndexOf("_"));
    const uid = String(d.uid);
    const at = ms(d.createdAt) ?? 0;
    let u = byUid.get(uid);
    if (!u)
      byUid.set(
        uid,
        (u = {
          name: String(d.name ?? ""),
          member: !!d.member,
          at,
          songs: new Map(),
        }),
      );
    if (at >= u.at)
      ((u.at = at),
        (u.name = String(d.name ?? u.name)),
        (u.member = !!d.member)); // 이름은 가장 최근 기록 기준
    const cur = u.songs.get(song);
    if (!cur || bp > cur.bp)
      u.songs.set(song, { bp, chart, score: Number(d.score) || 0 });
  }
  const av = await avatarsOf(
    db,
    [...byUid.entries()].filter(([, u]) => u.member).map(([uid]) => uid),
  );
  const list = [...byUid.entries()]
    .map(([uid, u]) => {
      const top = [...u.songs.values()]
        .sort((a, b) => b.bp - a.bp)
        .slice(0, BP_TOP_SONGS);
      return {
        uid,
        // uid는 그대로 내보내지 않음 (사진 주소에 들어가는 건 누구나 보는 사진이라 괜찮음)
        id: `bp:${uid.slice(0, 8)}`,
        name: u.name,
        member: u.member,
        avatar: (u.member && av.get(uid)) || null,
        bp: top.reduce((s, x) => s + x.bp, 0),
        songs: u.songs.size,
        best: top[0] ?? null,
      };
    })
    .filter((x) => x.bp > 0)
    .sort((a, b) => b.bp - a.bp);
  bpCache = { at: Date.now(), rows: list };
  return list;
}

export function rankingsRouter({ db, auth, users }: Deps, captcha?: Captcha): Router {
  const r = Router();
  const tickets = db.col<Ticket>("rank_tickets");
  const fightRating = createFightRating(db, users);
  // 같은 사람의 등록이 겹쳐도 "기존 기록 확인 → 저장"이 섞이지 않게
  const mutex = new KeyedMutex();

  const boardOf = (key: string): Board | null => {
    if (key.startsWith("rhythm:"))
      return CHART_RE.test(key.slice(7)) ? rhythmBoard(key.slice(7)) : null;
    if (key.startsWith("suspect:"))
      return SUSPECT_CASE_RE.test(key.slice(8)) ? suspectBoard(key.slice(8)) : null;
    return Object.hasOwn(BOARDS, key) ? BOARDS[key] : null;
  };

  /**
   * 기록 등록 공통: 로그인 → 형식 → 티켓(1회용·경과 시간) → 값 확인 → 그 사람의 최고 기록이면 저장.
   * col = 저장할 컬렉션, scope = 그 안에서 랭킹을 나누는 조건(리듬게임의 chart)
   */
  async function submit(
    req: Request,
    key: string,
    col: string,
    scope: Record<string, string>,
  ) {
    const board = boardOf(key);
    if (!board) throw notFound();
    const user = await userOf(auth, req);
    if (!user) throw unauthenticated();
    // 티켓을 쓰기 전에 (확인하고 다시 보내도 같은 티켓으로 등록되게)
    if (user.anonymous) await captcha?.check(req, { remember: user.uid });
    const { ticket, ...body } = (req.body ?? {}) as Record<string, unknown>;
    // 회원은 별명으로 등록 (보낸 이름은 무시). 비회원은 적은 이름 그대로 — member 표시가 없는 기록이 비회원 기록
    const nick = await users.nickOf(user);
    if (nick) body.name = nick;
    const data = board.schema.parse(body) as Data;
    const owner = nick ? { uid: user.uid, member: true } : { uid: user.uid };

    const now = Date.now();
    const t =
      typeof ticket === "string" && ticket.length <= 64
        ? await tickets.findOneAndUpdate(
            { _id: ticket, uid: user.uid, board: key, used: false },
            { $set: { used: true } },
          )
        : null;
    const elapsed = t ? (now - t.createdAt.getTime()) / 1000 : 0;
    const why = !t
      ? "ticket"
      : now - t.createdAt.getTime() > TICKET_TTL_MS
        ? "expired"
        : elapsed + SLACK_SEC < board.minSec(data)
          ? "too-fast"
          : board.check && !board.check(data)
            ? "mismatch"
            : board.verify && !(await board.verify(data).catch(() => false))
              ? "verify"
              : null;
    if (why) {
      console.warn(
        `[rank] 거절(${why}) ${key} uid=${user.uid} ${Math.round(elapsed)}s ${JSON.stringify(data)}`,
      );
      throw rejected();
    }

    if (board.split) scope = { ...scope, [board.split.field]: board.split.of(data) };
    const [field, dir] = Object.entries(board.sort)[0];
    return mutex.run(`${col}:${JSON.stringify(scope)}:${user.uid}`, async () => {
      const mine = await db.col(col).findOne({ ...scope, uid: user.uid });
      if (mine && board.firstOnly) return { id: mine._id, kept: true };
      if (!mine) {
        const _id = newId();
        await db.col(col).insertOne({
          _id,
          ...scope,
          ...data,
          ...owner,
          createdAt: new Date(),
        });
        return { id: _id };
      }
      // 이미 올린 기록보다 좋을 때만 바꿈 (dir -1 = 클수록 좋음, 1 = 작을수록 좋음)
      const better =
        dir === -1 ? data[field] > mine[field] : data[field] < mine[field];
      if (!better) return { id: mine._id, kept: true };
      await db
        .col(col)
        .replaceOne(
          { _id: mine._id },
          { ...scope, ...data, ...owner, createdAt: new Date() },
        );
      return { id: mine._id };
    });
  }

  r.post(
    "/tickets",
    h(async (req) => {
      const user = await userOf(auth, req);
      if (!user) throw unauthenticated();
      const key = String(
        (req.body as { board?: unknown } | undefined)?.board ?? "",
      );
      if (!boardOf(key)) throw bad();
      const recent = await tickets.countDocuments({
        uid: user.uid,
        createdAt: { $gt: new Date(Date.now() - 60_000) },
      });
      if (recent >= TICKETS_PER_MIN)
        throw new AppError(
          "RATE_LIMITED",
          "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
          429,
        );
      const _id = newId() + newId();
      await tickets.insertOne({
        _id,
        uid: user.uid,
        board: key,
        createdAt: new Date(),
        used: false,
      });
      // 회원이면 그 게임을 몇 판 했는지 세어 둠 (내 정보 페이지용. 리듬게임은 곡 구분 없이)
      if (!user.anonymous)
        users.bump(user.uid, { [`stats.plays.${key.split(":")[0]}`]: 1 });
      return { ticket: _id };
    }),
  );

  r.get(
    "/rhythm-bp",
    h(async (req) =>
      (await bpBoard(db))
        .slice(0, limitOf(req.query.limit))
        .map(({ uid: _uid, ...x }, i) => ({ ...x, rank: i + 1 })),
    ),
  );

  r.get(
    "/rhythm/:chart",
    h(async (req) => {
      const chart = String(req.params.chart);
      if (!CHART_RE.test(chart)) throw bad();
      const docs = await db
        .col("rhythm_rankings")
        .find({ chart })
        .sort({ score: -1 })
        .limit(limitOf(req.query.limit))
        .toArray();
      return rows(db, docs);
    }),
  );

  r.post(
    "/rhythm/:chart",
    h((req) => {
      const chart = String(req.params.chart);
      if (!CHART_RE.test(chart)) throw bad();
      clearBpCache();
      return submit(req, `rhythm:${chart}`, "rhythm_rankings", { chart });
    }),
  );

  // 오늘의 용의자 (case = YYYYMMDD_난이도)
  r.get(
    "/suspect/:case",
    h(async (req) => {
      const c = String(req.params.case);
      if (!SUSPECT_CASE_RE.test(c)) throw bad();
      const docs = await db
        .col("suspect_rankings")
        .find({ case: c })
        .sort({ score: 1, createdAt: 1 })
        .limit(limitOf(req.query.limit))
        .toArray();
      return rows(db, docs);
    }),
  );
  r.post(
    "/suspect/:case",
    h((req) => {
      const c = String(req.params.case);
      if (!SUSPECT_CASE_RE.test(c)) throw bad();
      return submit(req, `suspect:${c}`, "suspect_rankings", { case: c });
    }),
  );

  // 격투 랭크전 레이팅 · 캐릭터 통계 (games/fightRating.ts)
  // src=ai 면 AI 시뮬레이션 통계 · build = 밸런스 버전(없으면 지금 버전, all = 전부) · tier = 등급 번호(없으면 전체)
  r.get(
    "/fight-rank-stats",
    h(async (req) => {
      const user = await userOf(auth, req).catch(() => null);
      const bq = String(req.query.build ?? "");
      const build = bq === "all" ? undefined : bq && /^\d+$/.test(bq) ? Number(bq) : FIGHT_BUILD;
      const tq = Number(req.query.tier);
      const tier = Number.isInteger(tq) && tq >= 0 && tq < 8 ? tq : -1;
      const builds = await fightRating.builds();
      if (req.query.src === "ai") return { ...(await fightRating.simStats(build ?? FIGHT_BUILD, tier)), builds, build: build ?? FIGHT_BUILD };
      return { ...(await fightRating.stats(user?.uid, { build, tier })), builds, build: build ?? null };
    }),
  );
  r.get(
    "/fight-me",
    h(async (req) => {
      const user = await userOf(auth, req).catch(() => null);
      if (!user) return { me: null, chars: [], recent: [] };
      const [me, st, recent] = await Promise.all([fightRating.mine(user.uid), fightRating.stats(user.uid), fightRating.recent(user.uid, 12)]);
      return { me, chars: st.mine ?? [], recent };
    }),
  );
  r.get(
    "/fight-rating",
    h(async (req) => {
      const docs = await fightRating.top(limitOf(req.query.limit));
      // 날짜 칸은 마지막 경기 시각
      return rows(db, docs.map(({ updatedAt, ...d }) => ({ ...d, createdAt: updatedAt })));
    }),
  );

  r.get(
    "/:board",
    h(async (req) => {
      const key = String(req.params.board);
      const board = Object.hasOwn(BOARDS, key) ? BOARDS[key] : null;
      if (!board) throw notFound();
      const limit = limitOf(req.query.limit);
      const sp = board.split;
      if (sp && req.query[sp.field] !== undefined) {
        // 나눈 순위 (예: ?ch=kai)
        const v = String(req.query[sp.field]);
        if (!sp.valid(v)) throw bad();
        const docs = await db.col(key).find({ [sp.field]: v }).sort(board.sort).limit(limit).toArray();
        return rows(db, docs);
      }
      if (sp) {
        // 전체: 사람마다 가장 좋은 기록 하나씩
        const docs = await db
          .col(key)
          .aggregate([
            { $sort: board.sort },
            { $group: { _id: { $ifNull: ["$uid", "$_id"] }, doc: { $first: "$$ROOT" } } },
            { $replaceRoot: { newRoot: "$doc" } },
            { $sort: { ...board.sort, _id: 1 } },
            { $limit: limit },
          ])
          .toArray();
        return rows(db, docs);
      }
      const docs = await db.col(key).find({}).sort(board.sort).limit(limit).toArray();
      return rows(db, docs);
    }),
  );

  r.post(
    "/:board",
    h((req) => {
      const key = String(req.params.board);
      if (!Object.hasOwn(BOARDS, key)) throw notFound();
      return submit(req, key, key, {});
    }),
  );

  return r;
}
