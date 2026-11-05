import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import { CRAFT_MODELS, createCraft, kstDay, STARTERS, type Craft } from "../games/craft/craft";
import seed from "../games/craft/seed.json";
import { importCraftSeed, mongoCraftStore, type CraftSeed } from "../games/craft/store";
import { availableModels, createLlm } from "../games/mystery/llm";
import { h, requireAdmin, userOf } from "./util";

/*
 * 오늘의 조합 (/games/craft, 프로토)
 *   GET  /api/craft/today                         { enabled, day, starters, target, par, stats }
 *   POST /api/craft/combine { a, b }              { result: { name, emoji, firstBy }, newRecipe, newElement }
 *   POST /api/craft/hint    { day, have, level }  { name, emoji, from? } — level 1 = 다음 원소 이름, 2 = 재료까지
 *   POST /api/craft/done    { day, crafts, hints, clientId } 오늘 목표 달성 기록 → stats
 *   GET  /api/craft/stats   (관리자) 원소 · 조합 수
 * 조합 결과는 영구 저장 (같은 두 재료 = 늘 같은 결과). LLM 은 처음 나온 조합에서만.
 */

const Name = z.string().min(1).max(20);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function craftRouter({ cfg, db, auth, users }: Deps, injected?: Craft): Router {
  const keys = { gemini: cfg.geminiApiKey, groq: cfg.groqApiKey };
  const craft = injected ?? createCraft({ store: mongoCraftStore(db), llm: createLlm(keys), models: availableModels(keys, CRAFT_MODELS) });
  const results = db.col<{ day: string; uid: string | null; crafts: number; hints: number; at: Date }>("craft_results");

  // 미리 채운 조합 넣기가 끝난 뒤에 오늘 목표를 고르게 (뜨자마자 들어온 요청이 반쪽 DB 로 고르지 않게)
  const ready = injected
    ? Promise.resolve()
    : importCraftSeed(db, seed as unknown as CraftSeed)
        .then((n) => void ((n.elements || n.recipes) && console.log(`[craft] 미리 채운 원소 ${n.elements} · 조합 ${n.recipes} 넣음`)))
        .catch((e) => console.warn("[craft] seed", e));

  // 오늘 클리어 수 · 평균 타수 (30초 캐시)
  const statCache = new Map<string, { at: number; v: { solved: number; avg: number | null } }>();
  const stats = async (day: string) => {
    const c = statCache.get(day);
    if (c && Date.now() - c.at < 30_000) return c.v;
    const [agg] = await results.aggregate<{ n: number; avg: number }>([{ $match: { day } }, { $group: { _id: null, n: { $sum: 1 }, avg: { $avg: "$crafts" } } }]).toArray();
    const v = { solved: agg?.n ?? 0, avg: agg ? Math.round(agg.avg * 10) / 10 : null };
    statCache.set(day, { at: Date.now(), v });
    return v;
  };

  const r = Router();
  r.get(
    "/today",
    h(async () => {
      await ready;
      const day = kstDay(Date.now());
      const d = await craft.daily(day);
      const t = d ? await craft.elementOf(d.target) : null;
      return {
        enabled: craft.enabled,
        day,
        starters: STARTERS,
        target: t ? { name: t.name, emoji: t.emoji } : null,
        par: d?.par ?? null,
        stats: await stats(day),
      };
    })
  );
  r.post(
    "/combine",
    h(async (req) => {
      const { a, b } = z.object({ a: Name, b: Name }).parse(req.body);
      const u = await userOf(auth, req);
      const nick = u ? await users.nickOf(u) : null;
      const out = await craft.combine(a, b, req.ip ?? "?", nick);
      return { ...out, result: { name: out.result.name, emoji: out.result.emoji, firstBy: out.result.firstBy } };
    })
  );
  r.post(
    "/hint",
    h(async (req) => {
      const { day, have, level } = z
        .object({ day: Day, have: z.array(Name).max(3000), level: z.union([z.literal(1), z.literal(2)]) })
        .parse(req.body);
      return { hint: await craft.hint(day, have, level) };
    })
  );
  r.post(
    "/done",
    h(async (req) => {
      const { day, crafts, hints, clientId } = z
        .object({ day: Day, crafts: z.number().int().min(1).max(5000), hints: z.number().int().min(0).max(50), clientId: z.string().min(8).max(64) })
        .parse(req.body);
      if (day !== kstDay(Date.now())) return { stats: await stats(day) };
      const u = await userOf(auth, req);
      // 한 사람(기기)당 그날 첫 기록만
      await results.insertOne({ _id: `${day}:${u?.uid ?? clientId}`, day, uid: u?.uid ?? null, crafts, hints, at: new Date() }).catch(() => {});
      statCache.delete(day);
      return { stats: await stats(day) };
    })
  );
  r.get(
    "/stats",
    h(async (req) => {
      await requireAdmin(auth, req);
      const [elements, recipes] = await Promise.all([db.col("craft_elements").countDocuments(), db.col("craft_recipes").countDocuments()]);
      return { elements, recipes, today: await craft.daily() };
    })
  );
  return r;
}
