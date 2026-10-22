import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import { InitialData } from "@/lib/api/InitialData";
import { preload } from "@/lib/api/preload";
import { MELON_SCORES_PATH, type MelonScoreRow } from "@/firestore/melonGame";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "멜론 게임 - 합이 10 되게 묶어 없애는 숫자 퍼즐",
  description:
    "사과 게임처럼 드래그로 숫자를 묶어 합이 10 또는 20이 되면 사라지는 2분 타임어택 퍼즐. 설치 없이 브라우저 · 모바일에서 바로, 점수 랭킹 등록.",
  path: "/games/melongame/",
});

// 랭킹을 서버에서 미리 읽어 첫 화면(HTML)에 넣음. 1분마다 다시 만듦
export const revalidate = 60;

export default async function Layout({ children }: { children: ReactNode }) {
  const rankings = await preload<MelonScoreRow[]>(`${MELON_SCORES_PATH}?limit=10`, 60);
  return <InitialData value={{ rankings }}>{children}</InitialData>;
}
