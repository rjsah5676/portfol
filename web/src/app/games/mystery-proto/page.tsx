import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import MysteryProtoApp from "@/components/MysteryProto/MysteryProtoApp";
import { pageMeta } from "@/lib/seo";
import "@/css/mystery.css";

/* 예/아니오 추리 — 사람들과 테스트 중 (검색 · 메뉴 · sitemap 에는 아직 안 보임) */
export const metadata = pageMeta({
  title: "예/아니오 추리",
  description: "사건 하나, 예/아니오로 답할 수 있는 질문만으로 진상을 맞히는 추리 게임.",
  path: "/games/mystery-proto/",
  noindex: true,
});

export default function Page() {
  return (
    <>
      <div className="mx-auto max-w-5xl px-3 pt-6 sm:px-6">
        <GameHeader
          icon="🕵️"
          title="예/아니오 추리"
          en="YES / NO CASE FILES"
          accent="#D9B25F"
          desc="사건 하나. 예/아니오로 답할 수 있는 질문만 던져서 진상을 좁히고, 전말을 적어 제출하세요."
          tags={["추리", "수평사고", "판정은 AI 탐정"]}
          badge="BETA"
        />
      </div>
      <Faded>
        <div className="px-2 pt-3 pb-10 sm:px-6">
          <MysteryProtoApp />
        </div>
      </Faded>
    </>
  );
}
