"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  decodeFoods,
  DEFAULT_GRAMS,
  FOOD_DATA_URL,
  fmt,
  indexFoods,
  scale,
  searchFoods,
  sumAmounts,
  type Food,
  type FoodFile,
} from "@/lib/food";
import { MacroDonut, NutrientTable } from "./Nutrition";

const MEAL_KEY = "calorie_meal";
const QUICK = [
  "감자",
  "햄버거",
  "피자",
  "치킨",
  "김치찌개",
  "라면",
  "비빔밥",
  "닭가슴살",
  "바나나",
  "라떼",
];

const btn =
  "cursor-pointer rounded-full border border-white/15 px-3 py-1.5 font-mono text-xs whitespace-nowrap text-white/70 transition-colors hover:border-[#6C63FF]/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-30";
const card = "rounded-xl border border-white/10 bg-[#1C1E24]";

interface MealItem {
  id: string;
  grams: number;
}

export default function CalorieTool() {
  const [foods, setFoods] = useState<Food[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Food | null>(null);
  const [grams, setGrams] = useState(100);
  const [meal, setMeal] = useState<MealItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(FOOD_DATA_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((f: FoodFile) => alive && setFoods(decodeFoods(f)))
      .catch(() => alive && setLoadErr(true));
    try {
      const saved = JSON.parse(localStorage.getItem(MEAL_KEY) ?? "[]");
      if (Array.isArray(saved))
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 식단 복원(마운트 1회)
        setMeal(saved.filter((m) => m && typeof m.id === "string" && m.grams > 0));
    } catch {}
    // 저장된 값을 불러온 뒤부터 저장 (개발 모드에서 effect가 두 번 돌 때 기본값이 덮어쓰는 것 방지)
    setHydrated(true);
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(MEAL_KEY, JSON.stringify(meal));
    } catch {}
  }, [hydrated, meal]);

  const byId = useMemo(() => new Map((foods ?? []).map((f) => [f.id, f])), [foods]);
  const index = useMemo(() => (foods ? indexFoods(foods) : []), [foods]);
  const results = useMemo(() => searchFoods(index, q, 40), [index, q]);

  // ?food=ID 로 들어오면 바로 선택 (음식별 페이지에서 "계산기로" 눌렀을 때)
  useEffect(() => {
    if (!foods) return;
    const id = new URLSearchParams(window.location.search).get("food");
    const f = id ? byId.get(id) : null;
    if (f) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- URL 파라미터로 초기 선택(데이터 로드 후 1회)
      setSel(f);
      setGrams(DEFAULT_GRAMS(f));
    }
  }, [foods, byId]);

  const pick = (f: Food) => {
    setSel(f);
    setGrams(DEFAULT_GRAMS(f));
  };
  const amounts = sel ? scale(sel, grams) : null;

  const mealRows = meal
    .map((m, i) => ({ ...m, i, food: byId.get(m.id) }))
    .filter((m): m is typeof m & { food: Food } => !!m.food);
  const mealTotal = sumAmounts(mealRows.map((m) => scale(m.food, m.grams)));

  if (loadErr)
    return (
      <p className={`${card} p-6 text-center font-mono text-sm text-red-300/80`}>
        영양성분 데이터를 불러오지 못했습니다.
      </p>
    );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* 검색 */}
      <div className="min-w-0">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={foods ? "음식 이름 (예: 감자, 햄버거, ㄱㅈ)" : "데이터 불러오는 중…"}
          disabled={!foods}
          autoFocus
          className="w-full rounded-full border border-white/10 bg-[#15171c] px-5 py-3 font-['Nanum_Gothic',sans-serif] text-base text-white placeholder:text-white/25 focus:border-[#6C63FF]/50 focus:outline-none"
        />
        {!q && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {QUICK.map((w) => (
              <button
                key={w}
                type="button"
                className={btn}
                disabled={!foods}
                onClick={() => setQ(w)}
              >
                {w}
              </button>
            ))}
          </div>
        )}
        {q && (
          <ul className={`${card} mt-3 max-h-[52vh] divide-y divide-white/5 overflow-y-auto`}>
            {results.length === 0 ? (
              <li className="px-4 py-6 text-center font-mono text-xs text-white/35">
                검색 결과가 없습니다
              </li>
            ) : (
              results.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => pick(f)}
                    className={`flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/5 ${
                      sel?.id === f.id ? "bg-[#6C63FF]/15" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-['Nanum_Gothic',sans-serif] text-sm text-white/90">
                        {f.name}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-white/35">
                        {f.kind}
                        {f.cat && ` · ${f.cat}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-right font-mono text-xs text-white/70">
                      {Math.round(f.kcal)}
                      <span className="text-white/35"> kcal/100g</span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {/* 결과 + 식단 */}
      <div className="flex min-w-0 flex-col gap-4">
        {sel && amounts ? (
          <div className={`${card} p-5`}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-['Nanum_Gothic',sans-serif] text-lg font-bold text-white">
                  {sel.name}
                </h2>
                <p className="font-mono text-[11px] text-white/40">
                  {sel.kind}
                  {sel.cat && ` · ${sel.cat}`} · 100g당 {fmt(sel.kcal)}kcal
                </p>
              </div>
              {!!sel.page && (
                <Link
                  href={`/tools/calorie/${sel.id}/`}
                  className="font-mono text-[11px] text-[#A9A3FF] hover:underline"
                >
                  자세히 →
                </Link>
              )}
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <input
                type="number"
                inputMode="decimal"
                min={1}
                max={5000}
                value={grams}
                onChange={(e) => setGrams(Math.max(0, Math.min(5000, Number(e.target.value) || 0)))}
                className="w-24 rounded-full border border-white/10 bg-[#15171c] px-3 py-1.5 text-center font-mono text-sm text-white focus:border-[#6C63FF]/50 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="mr-1 font-mono text-xs text-white/50">g</span>
              {sel.serving && (
                <button type="button" className={btn} onClick={() => setGrams(sel.serving!)}>
                  {sel.maker ? "1개" : "1인분"} {fmt(sel.serving)}g
                </button>
              )}
              <button type="button" className={btn} onClick={() => setGrams(100)}>
                100g
              </button>
              <button
                type="button"
                className={btn}
                onClick={() => setGrams((g) => Math.round(g * 0.5))}
              >
                ×½
              </button>
              <button
                type="button"
                className={btn}
                onClick={() => setGrams((g) => Math.round(g * 2))}
              >
                ×2
              </button>
            </div>

            <MacroDonut a={amounts} />
            <div className="mt-4">
              <NutrientTable a={amounts} />
            </div>
            <button
              type="button"
              disabled={grams <= 0}
              onClick={() => setMeal((m) => [...m, { id: sel.id, grams }])}
              className="mt-4 w-full cursor-pointer rounded-full bg-[#6C63FF] py-2 font-mono text-sm text-white transition-colors hover:bg-[#5b52f0] disabled:opacity-40"
            >
              + 식단에 담기
            </button>
          </div>
        ) : (
          <div className={`${card} p-8 text-center font-mono text-xs text-white/35`}>
            음식을 검색해서 고르면 칼로리와 영양 비율이 나옵니다
          </div>
        )}

        {mealRows.length > 0 && (
          <div className={`${card} p-5`}>
            <div className="mb-3 flex items-center justify-between">
              <p className="font-mono text-sm font-bold text-white">
                내 식단{" "}
                <span className="text-xs font-normal text-white/40">· {mealRows.length}개</span>
              </p>
              <button type="button" className={btn} onClick={() => setMeal([])}>
                비우기
              </button>
            </div>
            <ul className="mb-4 divide-y divide-white/5">
              {mealRows.map((m) => (
                <li key={m.i} className="flex items-center gap-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => pick(m.food)}
                    className="min-w-0 flex-1 cursor-pointer truncate text-left font-['Nanum_Gothic',sans-serif] text-sm text-white/85 hover:text-white"
                  >
                    {m.food.name}
                  </button>
                  <input
                    type="number"
                    min={1}
                    value={m.grams}
                    onChange={(e) => {
                      const g = Math.max(0, Math.min(5000, Number(e.target.value) || 0));
                      setMeal((list) => list.map((x, j) => (j === m.i ? { ...x, grams: g } : x)));
                    }}
                    className="w-16 rounded-md border border-white/10 bg-[#15171c] px-1.5 py-0.5 text-right font-mono text-xs text-white [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="font-mono text-[10px] text-white/35">g</span>
                  <span className="w-16 text-right font-mono text-xs text-white">
                    {Math.round(scale(m.food, m.grams).kcal)}
                    <span className="text-white/35">kcal</span>
                  </span>
                  <button
                    type="button"
                    aria-label="빼기"
                    onClick={() => setMeal((list) => list.filter((_, j) => j !== m.i))}
                    className="cursor-pointer px-1 font-mono text-sm text-white/35 hover:text-red-300"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            {mealRows.some((m) => m.food.carb === null || m.food.fat === null) && (
              <p className="mb-3 rounded-lg bg-amber-400/10 px-3 py-2 font-['Nanum_Gothic',sans-serif] text-[11px] text-amber-200/80">
                탄수화물·지방 정보가 없는 음식이 있어서 합계와 비율은 값이 있는 것만 더했어요.
              </p>
            )}
            <MacroDonut a={mealTotal} />
            <div className="mt-4">
              <NutrientTable a={mealTotal} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
