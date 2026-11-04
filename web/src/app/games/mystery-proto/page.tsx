import MysteryProtoApp from "@/components/MysteryProto/MysteryProtoApp";
import { pageMeta } from "@/lib/seo";

/* 예/아니오 추리 (프로토, 게임성 확인용) — 검색 · 메뉴 · sitemap 에 안 내보냄 */
export const metadata = pageMeta({
  title: "예/아니오 추리 (프로토)",
  description: "짧은 사건 하나, 예/아니오로 답할 수 있는 질문만으로 진상을 맞히는 추리 게임 시험판.",
  path: "/games/mystery-proto/",
  noindex: true,
});

export default function Page() {
  return (
    <div className="px-2 pt-3 pb-6 sm:px-6 sm:pt-6">
      <MysteryProtoApp />
    </div>
  );
}
