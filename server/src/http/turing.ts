import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { Deps } from "../deps";
import { createTuring, type Turing } from "../games/turing/game";
import { availableModels, createLlm, FALLBACK_MODELS, SEAT_MODELS } from "../games/turing/llm";
import { h } from "./util";

/*
 * AI 사람 찾기 (/games/turing, 프로토)
 *   GET  /api/turing/status                 { enabled }  (키가 하나도 없으면 false)
 *   POST /api/turing/start  { difficulty }  → 판 화면 (easy · normal · hard = 초급 · 중급 · 고급)
 *   POST /api/turing/next   { id }          → AI 차례면 한 마디 생성
 *   POST /api/turing/say    { id, text }    → 내 차례에 한 마디
 *   POST /api/turing/vote   { id, target }  → 투표 (AI 투표까지 모아서 한 명 퇴장)
 * 판은 서버 메모리에만 (30분 동안 손대지 않으면 사라짐). 로그인 없이 누구나.
 */

const Id = z.string().min(8).max(64);

export function turingRouter({ cfg }: Deps, turing?: Turing): Router {
  const keys = { gemini: cfg.geminiApiKey, groq: cfg.groqApiKey };
  const game =
    turing ??
    createTuring({
      llm: createLlm(keys),
      seats: availableModels(keys, SEAT_MODELS),
      fallbacks: availableModels(keys, FALLBACK_MODELS),
    });

  const r = Router();
  // 무료 한도를 아끼려고 새 판은 IP당 10분에 15판까지 (테스트에서는 끔)
  const startLimit =
    cfg.env === "test"
      ? []
      : [
          rateLimit({
            windowMs: 10 * 60_000,
            limit: 15,
            standardHeaders: "draft-8",
            legacyHeaders: false,
            message: { error: { code: "RATE_LIMITED", message: "판을 너무 자주 열었어요. 잠시 후 다시 해 주세요." } },
          }),
        ];

  r.get("/status", h(() => ({ enabled: game.enabled })));
  r.post(
    "/start",
    ...startLimit,
    h((req) => {
      const { difficulty } = z.object({ difficulty: z.enum(["easy", "normal", "hard"]) }).parse(req.body);
      return game.start(difficulty);
    })
  );
  r.post(
    "/next",
    h((req) => game.next(z.object({ id: Id }).parse(req.body).id))
  );
  r.post(
    "/say",
    h((req) => {
      const { id, text } = z.object({ id: Id, text: z.string().max(400) }).parse(req.body);
      return game.say(id, text);
    })
  );
  r.post(
    "/vote",
    h((req) => {
      const { id, target } = z.object({ id: Id, target: z.string().min(1).max(20) }).parse(req.body);
      return game.vote(id, target);
    })
  );
  return r;
}
