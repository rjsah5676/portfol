import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import CraftApp from "@/components/Craft/CraftApp";
import { pageMeta } from "@/lib/seo";
import "@/css/craft.css";

/* 오늘의 조합 — 프로토 (이름 미정, 검색 · sitemap 에는 아직 안 보임) */
export const metadata = pageMeta({
  title: "오늘의 조합",
  description: "물 · 불 · 바람 · 흙에서 시작해 재료 두 개씩 합쳐 오늘의 목표를 만드는 AI 조합 퍼즐. 처음 만든 원소엔 내 이름이 남아요.",
  path: "/games/craft/",
  noindex: true,
});

export default function Page() {
  return (
    <>
      <div className="mx-auto max-w-[1040px] px-3 pt-6 sm:px-6">
        <GameHeader
          icon="⚗️"
          title="오늘의 조합"
          en="DAILY CRAFT"
          accent="#E9B949"
          desc="재료 두 개를 합치면 AI 연금술사가 결과를 정해요. 물 · 불 · 바람 · 흙에서 시작해 오늘의 목표를 최소 타수로 만드세요."
          tags={["데일리", "조합", "최초 발견"]}
          badge="BETA"
        />
      </div>
      <Faded>
        <div className="px-3 pt-3 pb-12 sm:px-6">
          <CraftApp />
        </div>
      </Faded>
    </>
  );
}
