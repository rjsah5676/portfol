import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import EscapeApp from "@/components/Escape/EscapeApp";
import { pageMeta } from "@/lib/seo";
import "@/css/escape.css";

/* 방탈출 — 프로토 (이름 미정, 검색 · sitemap 에는 아직 안 보임) */
export const metadata = pageMeta({
  title: "방탈출 · 반지하 B02호",
  description: "잠긴 반지하 방에서 단서를 맞대어 보며 탈출하고, 사라진 세입자에게 무슨 일이 있었는지 밝혀내는 픽셀 추리 방탈출.",
  path: "/games/escape/",
  noindex: true,
});

export default function Page() {
  return (
    <>
      <div className="mx-auto max-w-[960px] px-3 pt-6 sm:px-6">
        <GameHeader
          icon="🔐"
          title="방탈출"
          en="ESCAPE · CASE B02"
          accent="#E9C46A"
          desc="잠긴 방에서 기록들을 맞대어 보며 탈출하고, 이 방에서 무슨 일이 있었는지 밝혀내세요."
          tags={["방탈출", "추리", "픽셀"]}
          badge="BETA"
        />
      </div>
      <Faded>
        <div className="px-3 pt-3 pb-12 sm:px-6">
          <EscapeApp />
        </div>
      </Faded>
    </>
  );
}
