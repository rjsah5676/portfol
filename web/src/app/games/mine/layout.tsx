import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import { InitialData } from "@/lib/api/InitialData";
import { preload } from "@/lib/api/preload";
import { MINE_RANKINGS_PATH, type MineRankingRow } from "@/firestore/minesweeperRankings";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "지뢰찾기",
  description: "지뢰 99개 고급 난이도 지뢰찾기. 모바일 꾹 누르기 지원, 클리어 기록 랭킹 등록.",
  path: "/games/mine/",
});

// 랭킹을 서버에서 미리 읽어 첫 화면(HTML)에 넣음. 1분마다 다시 만듦
export const revalidate = 60;

export default async function Layout({ children }: { children: ReactNode }) {
  const rankings = await preload<MineRankingRow[]>(`${MINE_RANKINGS_PATH}?limit=10`, 60);
  return <InitialData value={{ rankings }}>{children}</InitialData>;
}
