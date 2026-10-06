import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import { InitialData } from "@/lib/api/InitialData";
import { preload } from "@/lib/api/preload";
import { MELON_SCORES_PATH, type MelonScoreRow } from "@/firestore/melonGame";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "멜론 게임",
  description:
    "드래그해서 합이 10 또는 20이 되도록 멜론을 없애는 2분 타임어택 퍼즐 게임. 랭킹 등록 지원.",
  path: "/games/melongame/",
});

// 랭킹을 서버에서 미리 읽어 첫 화면(HTML)에 넣음. 1분마다 다시 만듦
export const revalidate = 60;

export default async function Layout({ children }: { children: ReactNode }) {
  const rankings = await preload<MelonScoreRow[]>(`${MELON_SCORES_PATH}?limit=10`, 60);
  return <InitialData value={{ rankings }}>{children}</InitialData>;
}
