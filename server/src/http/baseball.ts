import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import { AppError, forbidden, unauthenticated } from "../errors";
import { h, ms, userOf } from "./util";

/*
 * 픽셀 프로야구 클라우드 세이브 (로그인 계정마다 하나): 브라우저 localStorage 의 야구 저장(pxb:…)을 통째로.
 * 2026-10-31 게임을 메뉴에서 내림 → 관리자 · 테스터만 (관리자 「내린 게임」 탭에서 들어가 해 보기만).
 *   GET /api/baseball/save                → { save: { rev, at, data } | null }
 *   PUT /api/baseball/save { data, prev } → { rev, at }  (prev = 마지막으로 받은 rev, 처음이면 0)
 *     다른 기기가 그 사이 올렸으면 409 SAVE_CONFLICT { rev, at } → 브라우저가 다시 받아서 고르게 함
 * 컬렉션 baseball_saves { _id: uid, rev, at, data: { [키]: 문자열 } }
 *
 * 밸런스 분석용 플레이 기록(POST /api/baseball/log · 관리자 summary/logs/export)은 같이 뺌.
 * 예전 기록은 컬렉션 baseball_logs 에 그대로 있음 (지우지 않음).
 */

const saveSchema = z.strictObject({
  data: z.record(z.string().regex(/^pxb:[a-z0-9:_-]{1,40}$/), z.string()).refine((d) => Object.keys(d).length <= 24),
  prev: z.number().int().min(0),
});
/** 세이브 하나 크기 (글자 수) */
const MAX_SAVE = 1_000_000;
export interface BaseballSave {
  _id: string;
  rev: number;
  at: Date;
  data: Record<string, string>;
}

export function baseballRouter({ auth, db }: Deps): Router {
  const saves = db.col<Omit<BaseballSave, "_id">>("baseball_saves");
  const member = async (req: Parameters<typeof userOf>[1]) => {
    const u = await userOf(auth, req);
    if (!u || u.anonymous) throw unauthenticated();
    if (!u.admin && !u.tester) throw forbidden("내린 게임이에요.");
    return u;
  };
  const conflict = (cur: { rev: number; at: Date } | null) =>
    new AppError("SAVE_CONFLICT", "다른 기기에서 먼저 저장했어요.", 409, { rev: cur?.rev ?? 0, at: cur ? ms(cur.at) : null });

  const pub = Router();
  pub.get(
    "/save",
    h(async (req) => {
      const u = await member(req);
      const d = await saves.findOne({ _id: u.uid });
      return { save: d ? { rev: d.rev, at: ms(d.at), data: d.data } : null };
    })
  );
  pub.put(
    "/save",
    h(async (req) => {
      const u = await member(req);
      const input = saveSchema.parse(req.body);
      if (Object.values(input.data).reduce((a, v) => a + v.length, 0) > MAX_SAVE) throw new AppError("SAVE_TOO_BIG", "저장 데이터가 너무 커요.", 413);
      const at = new Date();
      if (input.prev === 0) {
        try {
          await saves.insertOne({ _id: u.uid, rev: 1, at, data: input.data });
        } catch (e) {
          if ((e as { code?: number }).code !== 11000) throw e;
          throw conflict(await saves.findOne({ _id: u.uid }));
        }
        return { rev: 1, at: at.getTime() };
      }
      const r = await saves.findOneAndUpdate({ _id: u.uid, rev: input.prev }, { $set: { data: input.data, at }, $inc: { rev: 1 } }, { returnDocument: "after" });
      if (!r) throw conflict(await saves.findOne({ _id: u.uid }));
      return { rev: r.rev, at: at.getTime() };
    })
  );
  return pub;
}
