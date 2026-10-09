import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import type { Deps } from "../deps";
import { toWireError } from "../errors";
import { adminRouter, type AdminHooks } from "./admin";
import { meRouter } from "./me";
import { rankingsRouter } from "./rankings";
import { siteRouter } from "./site";
import { studyPostsRouter } from "./studyPosts";
import { trackRouter } from "./track";

export interface AppHooks extends Omit<AdminHooks, "guestChanged"> {
  /** 포커 자금 순위 */
  pokerRank(): Promise<unknown>;
  /** 포커 구매 순위 */
  pokerBuyRank(): Promise<unknown>;
}

export function createApp(deps: Deps, { pokerRank, pokerBuyRank, ...hooks }: AppHooks) {
  const { cfg } = deps;
  const app = express();
  app.disable("x-powered-by");
  if (cfg.trustProxy) app.set("trust proxy", cfg.trustProxy);

  app.use(cors({ origin: cfg.corsOrigins === "*" ? true : cfg.corsOrigins, maxAge: 600 }));
  // 글 본문(HTML)이 길 수 있어서 넉넉하게
  app.use(express.json({ limit: "4mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, time: Date.now() });
  });

  // 도배 방지: 쓰기 요청은 IP당 분당 60회 (테스트에서는 끔)
  // 랭킹 티켓은 게임을 시작할 때마다 받으므로 따로 넉넉하게 (사람별 제한은 rankings.ts)
  if (cfg.env !== "test") {
    const limiter = (limit: number, skip: (req: express.Request) => boolean) =>
      rateLimit({
        windowMs: 60_000,
        limit,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        skip,
        message: { error: { code: "RATE_LIMITED", message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." } },
      });
    const TICKETS = "/rankings/tickets";
    // 유입 기록은 페이지를 옮길 때마다 오므로 다른 쓰기 요청과 따로 셈
    const TRACK = "/track";
    app.use(
      "/api",
      limiter(60, (req) => req.method === "GET" || req.method === "OPTIONS" || req.path === TICKETS || req.path === TRACK)
    );
    app.use(
      "/api",
      limiter(120, (req) => req.path !== TRACK || req.method === "OPTIONS")
    );
    app.use(
      "/api",
      limiter(300, (req) => req.path !== TICKETS || req.method === "OPTIONS")
    );
  }

  // 회원이 올린 프로필 사진 (주소에 올린 시각이 붙어 있어서 오래 캐시해도 됨)
  app.get("/api/avatars/:uid", (req, res, next) => {
    deps.users
      .avatarOf(String(req.params.uid))
      .then((a) => {
        if (!a) return void res.status(404).json({ error: { code: "NOT_FOUND", message: "찾을 수 없습니다." } });
        res.set({
          "Content-Type": a.type,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": req.query.v ? "public, max-age=31536000, immutable" : "public, max-age=300",
        });
        res.end(a.data);
      })
      .catch(next);
  });

  // 꾸밈이 붙은 회원들 (별명 → 꾸밈). 랭킹·방명록·게임에서 이름 옆에 보여 줌
  app.get("/api/badges", (_req, res, next) => {
    deps.users
      .badges()
      .then((b) => res.set("Cache-Control", "public, max-age=30").json(b))
      .catch(next);
  });

  // 포커 자금 순위: 한 판이라도 친 회원을 보유금액 순으로 (누구나 볼 수 있음)
  app.get("/api/poker/rank", (_req, res, next) => {
    pokerRank()
      .then((list) => res.set("Cache-Control", "public, max-age=15").json({ list }))
      .catch(next);
  });

  // 포커 구매 순위: 스킨 · 캐릭터에 쓴 칩 순 (누구나 볼 수 있음)
  app.get("/api/poker/rank-buy", (_req, res, next) => {
    pokerBuyRank()
      .then((list) => res.set("Cache-Control", "public, max-age=15").json({ list }))
      .catch(next);
  });

  const site = siteRouter(deps);
  app.use("/api", trackRouter(deps));
  app.use("/api/rankings", rankingsRouter(deps));
  app.use("/api/me", meRouter(deps));
  app.use("/api/study-posts", studyPostsRouter(deps));
  app.use("/api/admin", adminRouter(deps, { guestChanged: site.publishGuest, ...hooks }));
  app.use("/api", site.router);

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "찾을 수 없습니다." } });
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    // express.json()이 던지는 본문 파싱 오류
    const parse = (err as { type?: string })?.type;
    if (parse === "entity.parse.failed" || parse === "entity.too.large") {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "잘못된 요청입니다." } });
      return;
    }
    const w = toWireError(err);
    if (w.code === "INTERNAL") console.error("[http]", err);
    res.status(w.status).json({ error: { code: w.code, message: w.message, data: w.data } });
  };
  app.use(onError);

  return app;
}
