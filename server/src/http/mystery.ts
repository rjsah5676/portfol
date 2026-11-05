import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { Deps } from "../deps";
import { AppError } from "../errors";
import { orderedId } from "../ids";
import { createMystery, type Mystery } from "../games/mystery/game";
import { availableModels, createLlm, GRADE_MODELS, JUDGE_MODELS } from "../games/mystery/llm";
import { h, ms, requireAdmin, userOf } from "./util";

/*
 * 예/아니오 추리 (/games/mystery-proto, 프로토 — 게임성 확인용)
 *   GET  /api/mystery-proto/status                 { enabled, gated }
 *   POST /api/mystery-proto/gate    { password }   입장 비밀번호 확인 (MYSTERY_GATE). 이후 요청은 x-mystery-gate 헤더로
 *   GET  /api/mystery-proto/cases                  공개 필드만 (+ admin 여부)
 *   POST /api/mystery-proto/start   { caseId }     → 판 화면
 *   GET  /api/mystery-proto/play/:id               → 판 화면 (새로고침 복구)
 *   POST /api/mystery-proto/ask     { id, question } → { verdict, view }
 *   POST /api/mystery-proto/submit  { id, answer }   → view
 *   POST /api/mystery-proto/give-up { id }           → view (진상 공개)
 *   POST /api/mystery-proto/flag    { id, index, note? } 🚩 판정 이의 → mystery_proto_flags 에 저장 + 그 질문 캐시 지움
 *   GET  /api/mystery-proto/flags   (관리자) 최근 이의 200개
 *   GET  /api/mystery-proto/plays   (관리자) 플레이 기록 ?case · ?days · ?limit
 * 판은 서버 메모리(3시간). 판정 · 채점은 전부 mystery_proto_log 에, 판 단위 기록은 mystery_proto_plays 에.
 * 관리자 로그인이면 비밀번호 없이 들어감.
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

  // 플레이 기록: 판마다 한 문서, 질문 · 제출 · 끝날 때마다 통째로 갱신 (관리자가 뽑아서 사건 · 판정 손보는 데)
  const plays = db.col("mystery_proto_plays");
  const record = (id: string, extra: Record<string, unknown> = {}) => {
    try {
      const s = game.snapshot(id);
      void plays.updateOne({ _id: s.playId }, { $set: { ...s, ...extra, updatedAt: new Date() } }, { upsert: true }).catch(() => {});
    } catch {
      // 기록 실패는 무시
    }
  };

  // 입장 가림막: 테스트 기간엔 비밀번호(x-mystery-gate)를 아는 사람과 관리자만. 비밀번호가 비어 있으면 없음
  const gated = async (req: Request) => {
    if (!cfg.mysteryGate) return;
    if (req.header("x-mystery-gate") === cfg.mysteryGate) return;
    if ((await userOf(auth, req))?.admin) return;
    throw new AppError("GATE", "입장 비밀번호가 필요해요.", 403);
  };

  const r = Router();
  r.get("/status", h(() => ({ enabled: game.enabled, gated: !!cfg.mysteryGate })));
  // 비밀번호 확인만 (맞으면 클라이언트가 저장해 두고 매 요청에 보냄)
  r.post(
    "/gate",
    ...(test ? [] : [limit(10 * 60_000, 20, "너무 많이 시도했어요. 잠시 후 다시 해 주세요.")]),
    h(async (req) => {
      const { password } = z.object({ password: z.string().max(64) }).parse(req.body);
      if (cfg.mysteryGate && password !== cfg.mysteryGate) throw new AppError("GATE", "비밀번호가 달라요.", 403);
      return { ok: true };
    })
  );
  // 후보 사건(cases/candidates)은 개발 모드거나 관리자로 로그인했을 때만 목록에
  r.get(
    "/cases",
    h(async (req) => {
      await gated(req);
      const admin = (await userOf(auth, req))?.admin === true;
      return { enabled: game.enabled, admin, cases: game.cases(test || admin) };
    })
  );
  r.post(
    "/start",
    ...startLimit,
    h(async (req) => {
      await gated(req);
      const v = game.start(z.object({ caseId: z.string().min(1).max(40) }).parse(req.body).caseId);
      const u = await userOf(auth, req);
      record(v.id, { uid: u?.uid ?? null, email: u?.email ?? null, ua: String(req.header("user-agent") ?? "").slice(0, 200) });
      return v;
    })
  );
  r.get(
    "/play/:id",
    h(async (req) => {
      await gated(req);
      return game.view(Id.parse(req.params.id));
    })
  );
  r.post(
    "/ask",
    ...askLimit,
    h(async (req) => {
      await gated(req);
      const { id, question, noCache } = z
        .object({ id: Id, question: z.string().min(1).max(120), noCache: z.boolean().optional() })
        .parse(req.body);
      // 캐시 끄기는 판정 정확도 스크립트용 — 운영에서는 무시
      const r = await game.ask(id, question, { noCache: !!noCache && cfg.env !== "production" });
      record(id);
      return r;
    })
  );
  r.post(
    "/submit",
    ...submitLimit,
    h(async (req) => {
      await gated(req);
      const { id, answer } = z.object({ id: Id, answer: z.string().min(1).max(1500) }).parse(req.body);
      const v = await game.submit(id, answer);
      record(id);
      return v;
    })
  );
  r.post(
    "/give-up",
    h(async (req) => {
      await gated(req);
      const v = game.giveUp(z.object({ id: Id }).parse(req.body).id);
      record(v.id);
      return v;
    })
  );
  // (관리자) 플레이 기록 뽑기 — JSON. ?case=<id> · ?days=7 · ?limit=500
  r.get(
    "/plays",
    h(async (req) => {
      await requireAdmin(auth, req);
      const q = z
        .object({ case: z.string().max(40).optional(), days: z.coerce.number().int().min(1).max(365).optional(), limit: z.coerce.number().int().min(1).max(2000).optional() })
        .parse(req.query);
      const filter: Record<string, unknown> = {};
      if (q.case) filter.caseId = q.case;
      if (q.days) filter.startedAt = { $gte: new Date(Date.now() - q.days * 86_400_000) };
      const list = await plays.find(filter).sort({ startedAt: -1 }).limit(q.limit ?? 500).toArray();
      return { count: list.length, plays: list.map(({ _id, ...rest }) => ({ playId: _id, ...rest })) };
    })
  );
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
