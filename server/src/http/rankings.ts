import { Router, type Request } from "express";
import { z } from "zod";
import {
  chessScore,
  fightScore,
  janggiScore,
  omokScore,
} from "../../../web/src/lib/aiScore";
import { TOTAL_SEC as MELON_SEC } from "../../../web/src/lib/melon/logic";
import type { Deps } from "../deps";
import { AppError, bad, notFound, unauthenticated } from "../errors";
import { newId } from "../ids";
import { KeyedMutex } from "../mutex";
import { RHYTHM_CHARTS } from "./rhythmCharts";
import { bpOf, BP_TOP_SONGS } from "./bp";
import { h, ms, userOf } from "./util";

/*
 * 게임 랭킹. 컬렉션 이름과 값의 범위는 기존 firestore.rules 그대로.
 *   GET  /api/rankings/:board?limit=10
 *   GET  /api/rankings/rhythm/:chart?limit=10      (chart = 곡id_난이도)
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
  // opp = "AI단계" 또는 "AI단계:내캐릭터>상대캐릭터" (예: "3:kai>igna")
  fight_ai_rankings: {
    sort: { score: -1 },
    schema: aiRank(7_000_000).refine(
      (d) =>
        /^[1-6](:[a-z]+>[a-z]+)?$/.test(d.opp) &&
        Math.floor(d.score / 1_000_000) === Number(d.opp[0]),
    ),
    minSec: aiSec,
    // lead = 남은 체력(%)
    check: (d) => fightScore(tierOf(d), d.lead, d.seconds).score === d.score,
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

export function rankingsRouter({ db, auth, users }: Deps): Router {
  const r = Router();
  const tickets = db.col<Ticket>("rank_tickets");
  // 같은 사람의 등록이 겹쳐도 "기존 기록 확인 → 저장"이 섞이지 않게
  const mutex = new KeyedMutex();

  const boardOf = (key: string): Board | null => {
    if (key.startsWith("rhythm:"))
      return CHART_RE.test(key.slice(7)) ? rhythmBoard(key.slice(7)) : null;
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
            : null;
    if (why) {
      console.warn(
        `[rank] 거절(${why}) ${key} uid=${user.uid} ${Math.round(elapsed)}s ${JSON.stringify(data)}`,
      );
      throw rejected();
    }

    const [field, dir] = Object.entries(board.sort)[0];
    return mutex.run(`${col}:${scope.chart ?? ""}:${user.uid}`, async () => {
      const mine = await db.col(col).findOne({ ...scope, uid: user.uid });
      if (!mine) {
        const _id = newId();
        await db
          .col(col)
          .insertOne({
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

  // 회원 BP 랭킹: 회원의 내장곡 기록 전부를 모아 곡마다 가장 높은 BP 하나씩, 상위 20곡 합. 30초 캐시
  let bpCache: { at: number; rows: Record<string, unknown>[] } | null = null;
  r.get(
    "/rhythm-bp",
    h(async (req) => {
      if (!bpCache || Date.now() - bpCache.at > 30_000) {
        const docs = await db
          .col("rhythm_rankings")
          .find({ member: true })
          .project({ uid: 1, chart: 1, score: 1, name: 1, createdAt: 1 })
          .toArray();
        const byUid = new Map<
          string,
          {
            name: string;
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
              (u = { name: String(d.name ?? ""), at, songs: new Map() }),
            );
          if (at >= u.at) ((u.at = at), (u.name = String(d.name ?? u.name))); // 별명은 가장 최근 기록 기준
          const cur = u.songs.get(song);
          if (!cur || bp > cur.bp)
            u.songs.set(song, { bp, chart, score: Number(d.score) || 0 });
        }
        const rows = [...byUid.entries()]
          .map(([uid, u]) => {
            const top = [...u.songs.values()]
              .sort((a, b) => b.bp - a.bp)
              .slice(0, BP_TOP_SONGS);
            return {
              id: uid,
              name: u.name,
              bp: top.reduce((s, x) => s + x.bp, 0),
              songs: u.songs.size,
              best: top[0] ?? null,
            };
          })
          .filter((x) => x.bp > 0)
          .sort((a, b) => b.bp - a.bp);
        bpCache = { at: Date.now(), rows };
      }
      return bpCache.rows
        .slice(0, limitOf(req.query.limit))
        .map((x, i) => ({ ...x, rank: i + 1 }));
    }),
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
      return docs.map(row);
    }),
  );

  r.post(
    "/rhythm/:chart",
    h((req) => {
      const chart = String(req.params.chart);
      if (!CHART_RE.test(chart)) throw bad();
      bpCache = null;
      return submit(req, `rhythm:${chart}`, "rhythm_rankings", { chart });
    }),
  );

  r.get(
    "/:board",
    h(async (req) => {
      const board = BOARDS[String(req.params.board)];
      if (!board) throw notFound();
      const docs = await db
        .col(String(req.params.board))
        .find({})
        .sort(board.sort)
        .limit(limitOf(req.query.limit))
        .toArray();
      return docs.map(row);
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
