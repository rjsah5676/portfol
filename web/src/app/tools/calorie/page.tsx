import Link from "next/link";
import Faded from "@/components/Faded";
import CalorieTool from "@/components/Food/CalorieTool";
import { loadFoods } from "@/lib/foodServer";
import { pageMeta } from "@/lib/seo";

export const metadata = {
  ...pageMeta({
    title: "칼로리 계산기 · 음식 영양성분 검색",
    description:
      "감자, 햄버거, 피자처럼 음식 이름만 넣으면 칼로리와 탄수화물·단백질·지방 비율, 당류·나트륨까지 바로 계산. 먹은 양(g)을 바꾸거나 여러 음식을 담아 한 끼 총칼로리도 확인할 수 있습니다. 식약처 식품영양성분 데이터 기준.",
    path: "/tools/calorie/",
  }),
  keywords: [
    "칼로리 계산기",
    "음식 칼로리",
    "칼로리 검색",
    "영양성분",
    "탄단지 비율",
    "식단 칼로리",
    "음식 영양정보",
  ],
};

// 검색 안 해도 들어갈 수 있게 자주 찾는 음식은 링크로도 걸어둠 (내부 링크 → 음식별 페이지 색인)
const POPULAR = [
  "햄버거",
  "피자",
  "라면",
  "김치찌개",
  "된장찌개",
  "비빔밥",
  "김밥",
  "떡볶이",
  "짜장면",
  "짬뽕",
  "돈가스",
  "삼겹살구이",
  "쌀밥",
  "우유",
  "감자 (수미, 삶은것)",
  "고구마 (구운것)",
  "바나나 (생것)",
  "사과 (생것)",
];

export default function CaloriePage() {
  const { foods, builtAt } = loadFoods();
  const popular = POPULAR.map(
    (w) =>
      foods.find((f) => f.page && f.name === w) ?? foods.find((f) => f.page && f.name.startsWith(w))
  ).filter(
    (f, i, a): f is NonNullable<typeof f> => !!f && a.findIndex((x) => x?.id === f.id) === i
  );

  return (
    <Faded>
      <div className="mx-auto max-w-5xl px-4 pt-12 pb-24 sm:px-6">
        <div className="mb-6">
          <div className="font-mono text-sm text-[#8B84FF]">tools</div>
          <h1 className="mt-1 font-mono text-2xl font-bold text-white">칼로리 계산기</h1>
          <p className="mt-2 font-['Nanum_Gothic',sans-serif] text-sm text-white/45">
            음식 {foods.length.toLocaleString("ko-KR")}개의 칼로리와 탄단지 비율. 여러 개 담으면 한
            끼 합계도 나와요.
          </p>
        </div>

        <CalorieTool />

        {popular.length > 0 && (
          <section className="mt-14">
            <h2 className="mb-3 font-mono text-sm font-bold text-white">자주 찾는 음식 칼로리</h2>
            <div className="flex flex-wrap gap-1.5">
              {popular.map((f) => (
                <Link
                  key={f.id}
                  href={`/tools/calorie/${f.id}/`}
                  className="rounded-full border border-white/10 px-3 py-1.5 font-['Nanum_Gothic',sans-serif] text-xs text-white/70 transition-colors hover:border-[#6C63FF]/60 hover:text-white"
                >
                  {f.name} {Math.round(f.kcal)}kcal
                </Link>
              ))}
            </div>
          </section>
        )}

        <p className="mt-10 font-['Nanum_Gothic',sans-serif] text-[11px] leading-relaxed text-white/30">
          출처: 식품의약품안전처 식품영양성분 데이터베이스 (전국통합식품영양성분정보 표준데이터
          {builtAt && `, ${builtAt} 반영`}). 조리법·제품에 따라 실제 값과 차이가 있을 수 있습니다.
        </p>
      </div>
    </Faded>
  );
}
