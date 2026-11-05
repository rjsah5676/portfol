/*
 * 오늘의 조합 — Mongo 저장소.
 *   craft_recipes  _id = "a+b"(정렬)  { a, b, result, model, at }
 *   craft_elements _id = 이름          { emoji, firstBy, firstAt }
 *   craft_daily    _id = YYYY-MM-DD   { target, par, path }
 * 서버가 뜰 때 seed.json (미리 채운 조합) 중 없는 것만 넣음.
 */
import type { Database } from "../../db";
import type { CraftStore, Daily, Element, Recipe } from "./craft";

interface RecipeDoc {
  a: string;
  b: string;
  result: string;
  model: string;
  at: Date;
}
interface ElementDoc {
  emoji: string;
  firstBy: string | null;
  firstAt: Date;
}
interface DailyDoc {
  target: string;
  par: number;
  path: [string, string, string][];
  at: Date;
}

export interface CraftSeed {
  elements: Record<string, string>;
  recipes: [string, string, string][];
}

const isDup = (e: unknown) => (e as { code?: number })?.code === 11000;

export function mongoCraftStore(db: Database): CraftStore {
  const recipes = db.col<RecipeDoc>("craft_recipes");
  const elements = db.col<ElementDoc>("craft_elements");
  const dailies = db.col<DailyDoc>("craft_daily");
  const toRecipe = (d: RecipeDoc & { _id: string }): Recipe => ({ key: d._id, a: d.a, b: d.b, result: d.result, model: d.model, at: d.at.getTime() });
  const toElement = (d: ElementDoc & { _id: string }): Element => ({ name: d._id, emoji: d.emoji, firstBy: d.firstBy, firstAt: d.firstAt.getTime() });
  return {
    async recipe(key) {
      const d = await recipes.findOne({ _id: key });
      return d ? toRecipe(d) : null;
    },
    async putRecipe(r) {
      try {
        await recipes.insertOne({ _id: r.key, a: r.a, b: r.b, result: r.result, model: r.model, at: new Date(r.at) });
        return r;
      } catch (e) {
        if (!isDup(e)) throw e;
        return toRecipe((await recipes.findOne({ _id: r.key }))!);
      }
    },
    async element(name) {
      const d = await elements.findOne({ _id: name });
      return d ? toElement(d) : null;
    },
    async putElement(e) {
      try {
        await elements.insertOne({ _id: e.name, emoji: e.emoji, firstBy: e.firstBy, firstAt: new Date(e.firstAt) });
        return true;
      } catch (err) {
        if (!isDup(err)) throw err;
        return false;
      }
    },
    async allRecipes() {
      const list = await recipes.find({}, { projection: { a: 1, b: 1, result: 1 } }).toArray();
      return list.map((d) => ({ key: d._id, a: d.a, b: d.b, result: d.result, model: "", at: 0 }));
    },
    async daily(day) {
      const d = await dailies.findOne({ _id: day });
      return d ? { day, target: d.target, par: d.par, path: d.path } : null;
    },
    async putDaily(d: Daily) {
      try {
        await dailies.insertOne({ _id: d.day, target: d.target, par: d.par, path: d.path, at: new Date() });
        return d;
      } catch (e) {
        if (!isDup(e)) throw e;
        const cur = (await dailies.findOne({ _id: d.day }))!;
        return { day: d.day, target: cur.target, par: cur.par, path: cur.path };
      }
    },
    async recentTargets(n) {
      const list = await dailies.find({}, { projection: { target: 1 } }).sort({ _id: -1 }).limit(n).toArray();
      return list.map((d) => d.target);
    },
  };
}

/** 미리 채운 조합 넣기 (이미 있는 건 그대로) */
export async function importCraftSeed(db: Database, seed: CraftSeed) {
  const els = Object.entries(seed.elements).map(([name, emoji]) => ({ _id: name, emoji, firstBy: null, firstAt: new Date(0) }));
  const rs = seed.recipes.map(([a, b, result]) => {
    const [x, y] = [a, b].sort();
    return { _id: `${x}+${y}`, a: x, b: y, result, model: "seed", at: new Date(0) };
  });
  const ins = async (col: string, docs: { _id: string }[]) => {
    if (!docs.length) return 0;
    try {
      const r = await db.col(col).insertMany(docs, { ordered: false });
      return r.insertedCount;
    } catch (e) {
      // 중복은 건너뜀 (이미 들어간 것)
      return (e as { result?: { insertedCount?: number } })?.result?.insertedCount ?? 0;
    }
  };
  const [ne, nr] = [await ins("craft_elements", els), await ins("craft_recipes", rs)];
  return { elements: ne, recipes: nr };
}
