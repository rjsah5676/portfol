/** 칼로리 계산기 공용: 데이터 형식, 검색, 1일 기준치 */

export interface Food {
  id: string;
  name: string;
  cat: string;
  kind: string;
  /** 브랜드(업체명), 일반 음식이면 "" */
  maker: string;
  /** 1이면 음식별 정적 페이지가 있음 */
  page: number;
  /** 1회 제공량(g/ml), 모르면 null */
  serving: number | null;
  /** 이하 전부 100g(ml)당 */
  kcal: number;
  carb: number | null;
  protein: number | null;
  fat: number | null;
  sugar: number | null;
  fiber: number | null;
  sodium: number | null;
  satfat: number | null;
  chol: number | null;
}

export interface FoodFile {
  source: string;
  builtAt: string;
  fields: string[];
  items: (string | number | null)[][];
}

export function decodeFoods(file: FoodFile): Food[] {
  const f = file.fields;
  return file.items.map(
    (row) => Object.fromEntries(f.map((k, i) => [k, row[i]])) as unknown as Food
  );
}

export const FOOD_DATA_URL = "/data/foods.json";

// ───────────────────────── 영양 계산 ─────────────────────────

/** 식품등의 표시기준 1일 영양성분 기준치 (2,000kcal 기준) */
export const DAILY = {
  kcal: 2000,
  carb: 324,
  protein: 55,
  fat: 54,
  sugar: 100,
  fiber: 25,
  sodium: 2000,
  satfat: 15,
  chol: 300,
} as const;

export type NutrientKey = keyof typeof DAILY;

export const NUTRIENTS: { key: Exclude<NutrientKey, "kcal">; label: string; unit: string }[] = [
  { key: "carb", label: "탄수화물", unit: "g" },
  { key: "sugar", label: "  당류", unit: "g" },
  { key: "fiber", label: "  식이섬유", unit: "g" },
  { key: "protein", label: "단백질", unit: "g" },
  { key: "fat", label: "지방", unit: "g" },
  { key: "satfat", label: "  포화지방", unit: "g" },
  { key: "chol", label: "콜레스테롤", unit: "mg" },
  { key: "sodium", label: "나트륨", unit: "mg" },
];

export type Amounts = { kcal: number } & Record<Exclude<NutrientKey, "kcal">, number | null>;

/** grams만큼 먹었을 때 영양소 */
export function scale(f: Food, grams: number): Amounts {
  const k = grams / 100;
  const s = (v: number | null) => (v === null ? null : v * k);
  return {
    kcal: f.kcal * k,
    carb: s(f.carb),
    protein: s(f.protein),
    fat: s(f.fat),
    sugar: s(f.sugar),
    fiber: s(f.fiber),
    sodium: s(f.sodium),
    satfat: s(f.satfat),
    chol: s(f.chol),
  };
}

export function sumAmounts(list: Amounts[]): Amounts {
  const keys = Object.keys(DAILY) as NutrientKey[];
  const out = Object.fromEntries(
    keys.map((k) => {
      const vals = list.map((a) => a[k]).filter((v): v is number => v !== null);
      return [k, vals.length ? vals.reduce((x, y) => x + y, 0) : null];
    })
  );
  return { ...out, kcal: out.kcal ?? 0 } as Amounts;
}

/** 탄·단·지 칼로리 비율 (탄수화물·단백질 4kcal/g, 지방 9kcal/g) */
export function macroRatio(a: Pick<Amounts, "carb" | "protein" | "fat">) {
  // 하나라도 값이 없으면 비율이 왜곡되니 표시하지 않음 (브랜드 제품 상당수가 탄수화물·지방 미표기)
  if (a.carb === null || a.protein === null || a.fat === null) return null;
  const c = (a.carb ?? 0) * 4;
  const p = (a.protein ?? 0) * 4;
  const f = (a.fat ?? 0) * 9;
  const t = c + p + f;
  if (t <= 0) return null;
  return { carb: c / t, protein: p / t, fat: f / t };
}

export const MACRO_COLORS = { carb: "#60A5FA", protein: "#4ADE80", fat: "#F59E0B" } as const;

/** 탄·단·지 각각이 하루 기준치(DAILY)의 몇 %인지 (0.45 = 45%) */
export function macroDaily(a: Pick<Amounts, "carb" | "protein" | "fat">) {
  if (a.carb === null || a.protein === null || a.fat === null) return null;
  return {
    carb: (a.carb ?? 0) / DAILY.carb,
    protein: (a.protein ?? 0) / DAILY.protein,
    fat: (a.fat ?? 0) / DAILY.fat,
  };
}

/**
 * 다이어트에 맞는 구성인지: 열량 중 단백질이 30% 이상이면서 탄수화물보다 많고, 탄수화물 40% 이하, 지방 45% 이하.
 * (닭볶음: 단 43% · 탄 37% → 해당, 닭갈비: 지방 53% → 아님)
 * 열량이 아주 적거나(물·음료 등) 단백질 자체가 적으면 판단하지 않음.
 */
export function isDietFriendly(a: Amounts): boolean {
  const r = macroRatio(a);
  if (!r || a.kcal < 30 || (a.protein ?? 0) < 5) return false;
  return r.protein >= 0.3 && r.protein > r.carb && r.carb <= 0.4 && r.fat <= 0.45;
}

export const fmt = (v: number | null, digits = 1) =>
  v === null
    ? "-"
    : v >= 100
      ? Math.round(v).toLocaleString("ko-KR")
      : String(Math.round(v * 10 ** digits) / 10 ** digits);

// ───────────────────────── 검색 ─────────────────────────

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
/** "감자튀김" → "ㄱㅈㅌㄱ" */
export function chosung(s: string) {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 0xac00;
    out += c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch;
  }
  return out;
}
const isChosungOnly = (s: string) => /^[ㄱ-ㅎ]+$/.test(s);
const compact = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export interface Indexed {
  food: Food;
  key: string;
  cho: string;
  /** 괄호 앞 핵심 이름 ("감자 (수미, 생것)" → "감자") */
  core: string;
}
export const indexFoods = (foods: Food[]): Indexed[] =>
  foods.map((food) => {
    const key = compact(food.name);
    return { food, key, cho: chosung(key), core: compact(food.name.split(" (")[0]) };
  });

/**
 * 정확히 일치 > 핵심 이름 일치("감자" → "감자 (수미, 생것)") > 앞부분 일치 > 포함.
 * 띄어쓴 여러 단어("스타벅스 라떼")는 모두 들어있는 것만. 같은 등급이면 이름 짧은 순, 브랜드는 뒤로.
 */
export function searchFoods(index: Indexed[], query: string, limit = 30): Food[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const q = words.join("");
  const cho = words.every(isChosungOnly);
  const scored: { f: Food; s: number }[] = [];
  for (const it of index) {
    const hay = cho ? it.cho : it.key;
    let tier: number;
    let pos = hay.indexOf(q);
    if (pos >= 0) tier = hay === q ? 0 : !cho && it.core === q ? 500 : pos === 0 ? 1000 : 2000;
    else if (words.length > 1 && words.every((w) => hay.includes(w))) {
      pos = hay.indexOf(words[0]);
      tier = 3000;
    } else continue;
    const s = tier + pos * 10 + it.key.length + (it.food.maker ? 800 : 0);
    scored.push({ f: it.food, s });
  }
  scored.sort((a, b) => a.s - b.s);
  return scored.slice(0, limit).map((x) => x.f);
}

export const DEFAULT_GRAMS = (f: Food) => f.serving ?? 100;
