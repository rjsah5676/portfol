import fs from "node:fs";
import path from "node:path";
import { decodeFoods, type Food, type FoodFile } from "./food";

// 빌드 시점(서버)에서만 사용: public/data/foods.json 을 읽어 음식별 정적 페이지를 만든다
let cache: { foods: Food[]; byId: Map<string, Food>; builtAt: string } | null = null;

export function loadFoods() {
  if (cache) return cache;
  const file = path.join(process.cwd(), "public", "data", "foods.json");
  const data: FoodFile = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : { source: "", builtAt: "", fields: [], items: [] };
  const foods = decodeFoods(data);
  cache = { foods, byId: new Map(foods.map((f) => [f.id, f])), builtAt: data.builtAt };
  return cache;
}

/** 같은 분류에서 이름이 비슷한 음식 몇 개 (내부 링크용) */
export function relatedFoods(f: Food, n = 12): Food[] {
  const { foods } = loadFoods();
  const head = f.name.split(/[\s,(]/)[0];
  const same = foods.filter((x) => x.page && x.id !== f.id && x.cat === f.cat && x.kind === f.kind);
  const similar = same.filter((x) => x.name.includes(head));
  const rest = same.filter((x) => !x.name.includes(head));
  return [...similar, ...rest].slice(0, n);
}
