import { createHash } from "node:crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { isLine, LINE_RE } from "../../../web/src/lib/hangul/judge";
import type { Deps } from "../deps";
import { AppError, bad } from "../errors";
import { judge, JudgeOffError, judgeReady, suggest } from "../hangul/kiwi";
import { h } from "./util";

const OFF_MSG = "판정 서버가 아직 준비되지 않았어요.";
/** 판정기가 꺼져 있으면(모델 없음 · 판정 서비스 다운) 503 JUDGE_OFF */
const orOff = <T>(p: Promise<T>) =>
  p.catch((e) => {
    if (e instanceof JudgeOffError) {
      console.warn(`[hangul] ${e.message}`);
      throw new AppError("JUDGE_OFF", OFF_MSG, 503);
    }
    throw e;
  });

/*
 * 니들이 한글을 알아? 판정
 *   GET  /api/hangul/judge?t=글자들   → Judge (web/src/lib/hangul/judge.ts)
 *   GET  /api/hangul/suggest?line=&u= → 뭐 되지?
 *   POST /api/hangul/report { text }  "이거 말 되는데?" — 판정기 사전에 없는 말 신고 (관리자 데이터 화면 · 한글 사전 신고)
 * 글자를 문장 줄에 넣고 뺄 때마다 부르므로 GET 으로 (쓰기 요청 제한과 따로, IP당 분당 600회).
 * 같은 글자 줄은 결과가 늘 같아서 브라우저가 잠깐(10분) 캐시해도 됨 (점수 공식을 바꾸면 그만큼 늦게 반영).
 */
export function hangulRouter(db?: Deps["db"]): Router {
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
      if (!isLine(t)) throw bad();
      if (!judgeReady()) throw new AppError("JUDGE_OFF", OFF_MSG, 503);
      const j = await orOff(judge(t));
      res.set("Cache-Control", "public, max-age=600");
      return j;
    }),
  );
  // 뭐 되지? (line = 지금 문장칸, u = 가진 글자 · 낱말들을 쉼표로, 최대 18개)
  r.get(
    "/suggest",
    h(async (req) => {
      const line = String(req.query.line ?? "");
      const units = String(req.query.u ?? "").split(",").filter(Boolean);
      if ((line && !isLine(line)) || !units.length || units.length > 18 || !units.every((u) => LINE_RE.test(u))) throw bad();
      if (!judgeReady()) throw new AppError("JUDGE_OFF", OFF_MSG, 503);
      return orOff(suggest(line, units));
    }),
  );
  // 사전에 없는 말 신고: 같은 말은 한 줄로 모아 몇 명이 신고했는지 셈 (IP는 해시 앞부분만, 같은 사람이 여러 번 눌러도 1)
  if (db)
    r.post(
      "/report",
      rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false }),
      h(async (req) => {
        const text = String((req.body as { text?: unknown } | undefined)?.text ?? "");
        if (!isLine(text)) throw bad();
        const who = createHash("sha256").update(String(req.ip)).digest("hex").slice(0, 12);
        // 판정기가 꺼져 있어도 신고는 받음 (형태소 칸만 비움)
        const morphs = judgeReady()
          ? await judge(text)
              .then((j) => j.morphs.map((m) => `${m.f}/${m.t}${m.k ? "" : "?"}`).join(" "))
              .catch(() => "")
          : "";
        const col = db.col("hangul_reports");
        await col.updateOne(
          { _id: text },
          { $set: { text, morphs, lastAt: new Date() }, $addToSet: { by: who } },
          { upsert: true },
        );
        // count = 신고한 사람 수 (by 는 너무 길어지지 않게 50명까지만 기억)
        await col.updateOne({ _id: text }, [
          { $set: { by: { $slice: ["$by", -50] }, count: { $size: "$by" } } },
        ]);
        return { ok: true };
      }),
    );
  return r;
}
