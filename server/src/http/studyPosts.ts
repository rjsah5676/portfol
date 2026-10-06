import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import { notFound } from "../errors";
import { newId } from "../ids";
import { h, requireAdmin } from "./util";

/*
 * 개인 공부 · 프로젝트 회고 글 (읽기는 공개, 쓰기는 관리자)
 *   GET /api/study-posts          전체 (본문 포함 — 프론트 빌드 때 정적 페이지를 만들려고 읽음)
 *   GET /api/study-posts/:id
 *   POST · PUT /:id · PATCH /:id (작성일·구분만) · DELETE /:id
 * 글이 바뀌면 프론트(Next 서버)에 알려서 캐시를 바로 비우게 함 (webNotify).
 */

const section = z.enum(["study", "retro"]);
const postSchema = z.strictObject({
  title: z.string(),
  content: z.string(),
  category: z.string(),
  date: z.string(),
  section: section.default("study"),
});
const metaSchema = z.strictObject({ date: z.string(), section });

const toPost = ({ _id, ...rest }: Record<string, unknown>) => ({ id: _id, ...rest });

export function studyPostsRouter({ db, auth, web }: Deps): Router {
  const r = Router();
  const posts = db.col("studyPosts");

  r.get(
    "/",
    h(async () => (await posts.find({}).toArray()).map(toPost))
  );
  r.get(
    "/:id",
    h(async (req) => {
      const doc = await posts.findOne({ _id: String(req.params.id) });
      if (!doc) throw notFound();
      return toPost(doc);
    })
  );
  r.post(
    "/",
    h(async (req) => {
      await requireAdmin(auth, req);
      const data = postSchema.parse(req.body);
      const _id = newId();
      await posts.insertOne({ _id, ...data });
      void web.postsChanged();
      return { id: _id };
    })
  );
  r.put(
    "/:id",
    h(async (req) => {
      await requireAdmin(auth, req);
      const data = postSchema.parse(req.body);
      const res = await posts.updateOne({ _id: String(req.params.id) }, { $set: data });
      if (!res.matchedCount) throw notFound();
      void web.postsChanged();
    })
  );
  r.patch(
    "/:id",
    h(async (req) => {
      await requireAdmin(auth, req);
      const data = metaSchema.parse(req.body);
      const res = await posts.updateOne({ _id: String(req.params.id) }, { $set: data });
      if (!res.matchedCount) throw notFound();
      void web.postsChanged();
    })
  );
  r.delete(
    "/:id",
    h(async (req) => {
      await requireAdmin(auth, req);
      await posts.deleteOne({ _id: String(req.params.id) });
      void web.postsChanged();
    })
  );

  return r;
}
