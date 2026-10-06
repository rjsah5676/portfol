import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Faded from "@/components/Faded";
import { MacroDonut, NutrientTable } from "@/components/Food/Nutrition";
import { fmt, macroRatio, scale } from "@/lib/food";
import { loadFoods, relatedFoods } from "@/lib/foodServer";
import { pageMeta, SITE_URL } from "@/lib/seo";

type Params = { params: Promise<{ id: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  const { foods } = loadFoods();
  // 정적 export는 빈 배열이면 빌드 에러 → 데이터 없을 땐 404용 자리 하나
  const pages = foods.filter((f) => f.page);
  return pages.length ? pages.map((f) => ({ id: f.id })) : [{ id: "_" }];
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const f = loadFoods().byId.get(id);
  if (!f)
    return pageMeta({ title: "음식을 찾을 수 없음", path: `/tools/calorie/${id}/`, noindex: true });
  const s = f.serving ? scale(f, f.serving) : null;
  const desc = [
    `${f.name} 칼로리는 100g당 ${fmt(f.kcal)}kcal`,
    s ? `, 1인분(${fmt(f.serving)}g) 기준 ${Math.round(s.kcal)}kcal` : "",
    `. 탄수화물 ${fmt(f.carb)}g, 단백질 ${fmt(f.protein)}g, 지방 ${fmt(f.fat)}g`,
    f.sodium !== null ? `, 나트륨 ${fmt(f.sodium)}mg` : "",
    " (100g당). 탄단지 비율과 먹은 양별 칼로리를 계산해보세요.",
  ].join("");
  return {
    ...pageMeta({
      title: `${f.name} 칼로리 · 영양성분`,
      description: desc,
      path: `/tools/calorie/${f.id}/`,
    }),
    keywords: [`${f.name} 칼로리`, `${f.name} 영양성분`, `${f.name} 탄수화물`, `${f.name} 단백질`],
  };
}

export default async function FoodPage({ params }: Params) {
  const { id } = await params;
  const f = loadFoods().byId.get(id);
  if (!f) notFound();

  const per100 = scale(f, 100);
  const serving = f.serving ? scale(f, f.serving) : null;
  const main = serving ?? per100;
  const ratio = macroRatio(per100);
  const related = relatedFoods(f);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "칼로리 계산기",
        item: `${SITE_URL}/tools/calorie/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: `${f.name} 칼로리`,
        item: `${SITE_URL}/tools/calorie/${f.id}/`,
      },
    ],
  };

  return (
    <Faded>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto max-w-3xl px-4 pt-12 pb-24 sm:px-6">
        <Link
          href="/tools/calorie/"
          className="font-mono text-sm text-white/40 transition-colors hover:text-white"
        >
          ← 칼로리 계산기
        </Link>
        <h1 className="mt-4 font-['Nanum_Gothic',sans-serif] text-2xl font-bold text-white sm:text-3xl">
          {f.name} 칼로리
        </h1>
        <p className="mt-1 font-mono text-xs text-white/40">
          {f.kind}
          {f.cat && ` · ${f.cat}`}
        </p>

        <p className="mt-5 font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/70">
          {f.name}은(는) <b className="text-white">100g당 {fmt(f.kcal)}kcal</b>
          {serving && (
            <>
              , 1인분 {fmt(f.serving)}g 기준{" "}
              <b className="text-white">{Math.round(serving.kcal)}kcal</b>
            </>
          )}
          입니다.
          {ratio &&
            ` 열량의 ${Math.round(ratio.carb * 100)}%가 탄수화물, ${Math.round(ratio.protein * 100)}%가 단백질, ${Math.round(ratio.fat * 100)}%가 지방에서 나옵니다.`}
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-[#1C1E24] p-5">
            <p className="mb-3 font-mono text-xs text-white/45">
              {serving ? `1인분 ${fmt(f.serving)}g` : "100g"} 기준
            </p>
            <MacroDonut a={main} size={110} />
          </div>
          <div className="rounded-xl border border-white/10 bg-[#1C1E24] p-5">
            <p className="mb-1 font-mono text-xs text-white/45">
              영양성분 ({serving ? `${fmt(f.serving)}g` : "100g"}) · 1일 기준치 대비
            </p>
            <NutrientTable a={main} />
          </div>
        </div>

        {serving && (
          <div className="mt-4 rounded-xl border border-white/10 bg-[#1C1E24] p-5">
            <p className="mb-1 font-mono text-xs text-white/45">100g 기준</p>
            <NutrientTable a={per100} />
          </div>
        )}

        <Link
          href={`/tools/calorie/?food=${f.id}`}
          className="mt-5 inline-block rounded-full bg-[#6C63FF] px-5 py-2 font-mono text-sm text-white transition-colors hover:bg-[#5b52f0]"
        >
          먹은 양으로 계산하기 →
        </Link>

        {related.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-3 font-mono text-sm font-bold text-white">비슷한 음식 칼로리</h2>
            <div className="flex flex-wrap gap-1.5">
              {related.map((r) => (
                <Link
                  key={r.id}
                  href={`/tools/calorie/${r.id}/`}
                  className="rounded-full border border-white/10 px-3 py-1.5 font-['Nanum_Gothic',sans-serif] text-xs text-white/70 transition-colors hover:border-[#6C63FF]/60 hover:text-white"
                >
                  {r.name} {Math.round(r.kcal)}kcal
                </Link>
              ))}
            </div>
          </section>
        )}

        <p className="mt-10 font-['Nanum_Gothic',sans-serif] text-[11px] leading-relaxed text-white/30">
          출처: 식품의약품안전처 식품영양성분 데이터베이스. 1일 기준치는 식품등의
          표시기준(2,000kcal)을 따르며, 조리법·제품에 따라 실제 값과 차이가 있을 수 있습니다.
        </p>
      </div>
    </Faded>
  );
}
