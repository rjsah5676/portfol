import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import { bad, notFound } from "../errors";
import { newId } from "../ids";
import { h, ms } from "./util";

/*
 * 게임 랭킹. 컬렉션 이름과 검증 범위는 기존 firestore.rules 그대로.
 *   GET  /api/rankings/:board?limit=10
 *   POST /api/rankings/:board
 *   GET  /api/rankings/rhythm/:chart?limit=10      (chart = 곡id_난이도)
 *   POST /api/rankings/rhythm/:chart
 */

const name = (max: number) => z.string().min(1).max(max);
const int = z.number().int();

/** 체스·장기·오목·격투 AI 랭킹 공통 (rules의 validAIRank) */
const aiRank = (maxScore: number) =>
  z.strictObject({
    name: name(12),
    score: int.gt(1_000_000).max(maxScore),
    opp: z.string().max(20),
    moves: int.min(2).max(1000),
    seconds: int.min(0).max(86400),
    lead: z.number().min(0).max(100),
  });

/** score = 상대 단계 × 1,000,000 + 판 점수 → 단계와 상대(opp)가 맞는지 */
const stageMatches = (stages: Record<string, number>) => (d: { score: number; opp: string }) =>
  Math.floor(d.score / 1_000_000) === (Object.hasOwn(stages, d.opp) ? stages[d.opp] : 0);

const CHESS_STAGES = { "400": 1, "800": 2, "1200": 3, "1600": 4, "2000": 5, "2400": 6 };
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
const OMOK_STAGES = { sprout: 1, kid: 2, playground: 3, grandpa: 4, gunmo: 5, pcbang: 6, master: 7, alpha: 8 };

interface Board {
  sort: Record<string, 1 | -1>;
  schema: z.ZodType<Record<string, unknown>>;
}

export const BOARDS: Record<string, Board> = {
  // 멜론게임 (지운 멜론 수, 판 전체 21x12=252개)
  score: { sort: { score: -1 }, schema: z.strictObject({ name: name(20), score: int.min(0).max(252) }) },
  // 지뢰찾기 (클리어 시간, 초)
  minesweeper_rankings: {
    sort: { time: 1 },
    schema: z.strictObject({ name: name(20), time: z.number().min(10).max(86400) }),
  },
  // 반응속도 (5회 평균, ms)
  reaction: {
    sort: { score: 1 },
    schema: z.strictObject({ name: name(20), score: z.number().min(80).max(10000) }),
  },
  chess_ai_rankings: {
    sort: { score: -1 },
    schema: aiRank(7_000_000).refine(stageMatches(CHESS_STAGES)),
  },
  janggi_ai_rankings: { sort: { score: -1 }, schema: aiRank(13_000_000).refine(stageMatches(JANGGI_STAGES)) },
  omok_ai_rankings: { sort: { score: -1 }, schema: aiRank(9_000_000).refine(stageMatches(OMOK_STAGES)) },
  // opp = "AI단계" 또는 "AI단계:내캐릭터>상대캐릭터" (예: "3:kai>igna")
  fight_ai_rankings: {
    sort: { score: -1 },
    schema: aiRank(7_000_000).refine(
      (d) => /^[1-6](:[a-z]+>[a-z]+)?$/.test(d.opp) && Math.floor(d.score / 1_000_000) === Number(d.opp[0])
    ),
  },
};

const CHART_RE = /^[a-z0-9-]+_(easy|normal|hard|expert|nightmare)$/;
const rhythmSchema = z.strictObject({
  name: name(12),
  score: int.min(0).max(1_000_000),
  acc: z.number().min(0).max(100),
  maxCombo: int.min(0).max(5000),
  fc: z.boolean(),
  ap: z.boolean(),
});

const limitOf = (v: unknown) => Math.min(100, Math.max(1, Math.floor(Number(v)) || 10));

/** DB 문서 → 응답 한 줄 (id, 필드들, createdAt은 ms) */
const row = ({ _id, createdAt, chart: _chart, ...rest }: Record<string, unknown>) => ({
  id: _id,
  ...rest,
  createdAt: ms(createdAt),
});

export function rankingsRouter({ db }: Deps): Router {
  const r = Router();

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
    })
  );

  r.post(
    "/rhythm/:chart",
    h(async (req) => {
      const chart = String(req.params.chart);
      if (!CHART_RE.test(chart)) throw bad();
      const data = rhythmSchema.parse(req.body);
      const _id = newId();
      await db.col("rhythm_rankings").insertOne({ _id, chart, ...data, createdAt: new Date() });
      return { id: _id };
    })
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
    })
  );

  r.post(
    "/:board",
    h(async (req) => {
      const key = String(req.params.board);
      const board = BOARDS[key];
      if (!board) throw notFound();
      const data = board.schema.parse(req.body);
      const _id = newId();
      await db.col(key).insertOne({ _id, ...data, createdAt: new Date() });
      return { id: _id };
    })
  );

  return r;
}
