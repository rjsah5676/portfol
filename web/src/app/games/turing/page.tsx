import Faded from "@/components/Faded";
import TuringApp from "@/components/Turing/TuringApp";
import { pageMeta } from "@/lib/seo";

/* AI 사람 찾기 (프로토) — 출시 전까지 검색 · 메뉴에 안 내보냄. 출시 때 noindex 지우고 sitemap.ts · navMenu.ts 에 추가 */
export const metadata = pageMeta({
  title: "누가 사람이야? - AI 사이에 숨은 사람 찾기 채팅 게임",
  description:
    "진짜 AI 넷과 사람 하나가 모인 채팅방. 모두 자기가 AI라고 말하는 가운데, 당신은 AI인 척 대화하며 라운드마다 열리는 투표에서 끝까지 들키지 않아야 합니다. 판이 끝나면 AI들의 정체가 공개돼요.",
  path: "/games/turing/",
  keywords: ["AI 게임", "튜링 테스트 게임", "AI 채팅 게임", "사람 찾기 게임", "역튜링 테스트"],
  noindex: true,
});

export default function Page() {
  return (
    <div className="px-3 pt-6 pb-16 sm:px-6">
      <Faded>
        <TuringApp />
      </Faded>
    </div>
  );
}
