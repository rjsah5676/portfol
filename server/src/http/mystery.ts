import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { Deps } from "../deps";
import { orderedId } from "../ids";
import { createMystery, type Mystery } from "../games/mystery/game";
import { availableModels, createLlm, GRADE_MODELS, JUDGE_MODELS } from "../games/mystery/llm";
import { h, ms, requireAdmin } from "./util";

/*
 * 예/아니오 추리 (/games/mystery-proto, 프로토 — 게임성 확인용)
 *   GET  /api/mystery-proto/status                 { enabled }
 *   GET  /api/mystery-proto/cases                  공개 필드만
 *   POST /api/mystery-proto/start   { caseId }     → 판 화면
 *   GET  /api/mystery-proto/play/:id               → 판 화면 (새로고침 복구)
 *   POST /api/mystery-proto/ask     { id, question } → { verdict, view }
 *   POST /api/mystery-proto/submit  { id, answer }   → view
 *   POST /api/mystery-proto/give-up { id }           → view (진상 공개)
 *   POST /api/mystery-proto/flag    { id, index, note? } 🚩 판정 이의 → mystery_proto_flags 에 저장 + 그 질문 캐시 지움
 *   GET  /api/mystery-proto/flags   (관리자) 최근 이의 200개
 * 판은 서버 메모리(3시간). 판정 · 채점은 전부 mystery_proto_log 에 남김 (오판 리뷰용).
 */

const Id = z.string().min(8).max(64);

const limit = (windowMs: number, n: number, message: string) =>
  rateLimit({ windowMs, limit: n, standardHeaders: "draft-8", legacyHeaders: false, message: { error: { code: "RATE_LIMITED", message } } });

export function mysteryProtoRouter({ cfg, db, auth }: Deps, injected?: Mystery): Router {
  const keys = { gemini: cfg.geminiApiKey, groq: cfg.groqApiKey };
  const logs = db.col("mystery_proto_log");
  const flags = db.col("mystery_proto_flags");
  const game =
    injected ??
    createMystery({
      llm: createLlm(keys),
      judgeModels: availableModels(keys, JUDGE_MODELS),
      gradeModels: availableModels(keys, GRADE_MODELS),
      log: (doc) => void logs.insertOne({ _id: orderedId(), ...doc }).catch(() => {}),
    });

  // 레이트 리밋은 운영에서만 (로컬에서 판정 정확도 스크립트가 연달아 물어볼 수 있게)
  const test = cfg.env !== "production";
  const askLimit = test ? [] : [limit(60_000, 20, "질문이 너무 빨라요. 잠시 후 다시 물어봐 주세요.")];
  const submitLimit = test ? [] : [limit(60_000, 6, "제출이 너무 잦아요. 잠시 후 다시 해 주세요.")];
  const startLimit = test ? [] : [limit(10 * 60_000, 30, "판을 너무 자주 열었어요. 잠시 후 다시 해 주세요.")];

  const r = Router();
  r.get("/status", h(() => ({ enabled: game.enabled })));
  r.get("/cases", h(() => ({ enabled: game.enabled, cases: game.cases() })));
  r.post(
    "/start",
    ...startLimit,
    h((req) => game.start(z.object({ caseId: z.string().min(1).max(40) }).parse(req.body).caseId))
  );
  r.get("/play/:id", h((req) => game.view(Id.parse(req.params.id))));
  r.post(
    "/ask",
    ...askLimit,
    h((req) => {
      const { id, question, noCache } = z
        .object({ id: Id, question: z.string().min(1).max(120), noCache: z.boolean().optional() })
        .parse(req.body);
      // 캐시 끄기는 판정 정확도 스크립트용 — 운영에서는 무시
      return game.ask(id, question, { noCache: !!noCache && cfg.env !== "production" });
    })
  );
  r.post(
    "/submit",
    ...submitLimit,
    h((req) => {
      const { id, answer } = z.object({ id: Id, answer: z.string().min(1).max(1500) }).parse(req.body);
      return game.submit(id, answer);
    })
  );
  r.post("/give-up", h((req) => game.giveUp(z.object({ id: Id }).parse(req.body).id)));
  r.post(
    "/flag",
    ...askLimit,
    h(async (req) => {
      const { id, index, note } = z
        .object({ id: Id, index: z.number().int().min(0).max(200), note: z.string().max(200).optional() })
        .parse(req.body);
      const d = game.questionDetail(id, index);
      await flags.updateOne(
        { _id: `${d.playId}:${index}` },
        { $set: { ...d, index, note: note?.trim() || null, at: new Date() } },
        { upsert: true }
      );
      game.uncache(d.caseId, d.caseVersion, d.text);
      return { ok: true };
    })
  );
  r.get(
    "/flags",
    h(async (req) => {
      await requireAdmin(auth, req);
      const list = await flags.find({}).sort({ at: -1 }).limit(200).toArray();
      return { flags: list.map(({ _id, at, ...rest }) => ({ id: _id, at: ms(at), ...rest })) };
    })
  );
  return r;
}
