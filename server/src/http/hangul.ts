import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { LINE_RE } from "../../../web/src/lib/hangul/judge";
import { AppError, bad } from "../errors";
import { judge, judgeReady, suggest } from "../hangul/kiwi";
import { h } from "./util";

/*
 * 니들이 한글을 알아? 판정
 *   GET /api/hangul/judge?t=글자들   → Judge (web/src/lib/hangul/judge.ts)
 * 글자를 문장 줄에 넣고 뺄 때마다 부르므로 GET 으로 (쓰기 요청 제한과 따로, IP당 분당 600회).
 * 같은 글자 줄은 결과가 늘 같아서 브라우저가 잠깐(10분) 캐시해도 됨 (점수 공식을 바꾸면 그만큼 늦게 반영).
 */
export function hangulRouter(): Router {
  const r = Router();
  r.use(
    rateLimit({
      windowMs: 60_000,
      limit: 600,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: { code: "RATE_LIMITED", message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." } },
    }),
  );
  r.get(
    "/judge",
    h(async (req, res) => {
      const t = String(req.query.t ?? "");
      if (!LINE_RE.test(t)) throw bad();
      if (!judgeReady()) throw new AppError("JUDGE_OFF", "판정 서버가 아직 준비되지 않았어요.", 503);
      res.set("Cache-Control", "public, max-age=600");
      return judge(t);
    }),
  );
  // 뭐 되지? (line = 지금 문장칸, u = 가진 글자 · 낱말들을 쉼표로, 최대 18개)
  r.get(
    "/suggest",
    h(async (req) => {
      const line = String(req.query.line ?? "");
      const units = String(req.query.u ?? "").split(",").filter(Boolean);
      if ((line && !LINE_RE.test(line)) || !units.length || units.length > 18 || !units.every((u) => LINE_RE.test(u))) throw bad();
      if (!judgeReady()) throw new AppError("JUDGE_OFF", "판정 서버가 아직 준비되지 않았어요.", 503);
      return suggest(line, units);
    }),
  );
  return r;
}
