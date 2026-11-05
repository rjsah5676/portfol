import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import EscapeApp from "@/components/Escape/EscapeApp";
import { pageMeta } from "@/lib/seo";
import "@/css/escape.css";

/* 방탈출 — 프로토 (이름 미정, 검색 · sitemap 에는 아직 안 보임) */
export const metadata = pageMeta({
  title: "방탈출 · 추리 방탈출 게임",
  description: "잠긴 방에서 기록과 단서를 맞대어 보며 탈출하고, 그 방에서 무슨 일이 있었는지 보고서로 밝혀내는 추리 방탈출. 숨진 사진사의 암실, 실종된 세입자의 반지하 방.",
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
          en="ESCAPE ROOM"
          accent="#E9C46A"
          desc="잠긴 방에서 기록들을 맞대어 보며 탈출하고, 이 방에서 무슨 일이 있었는지 밝혀내세요."
          tags={["방탈출", "추리", "스토리"]}
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
