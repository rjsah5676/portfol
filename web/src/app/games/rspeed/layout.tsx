import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import { InitialData } from "@/lib/api/InitialData";
import { preload } from "@/lib/api/preload";
import { REACTION_SCORES_PATH, type ReactionScoreRow } from "@/firestore/reactionGame";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "반응속도 테스트",
  description: "버튼이 파란색으로 바뀌는 순간 클릭! 5회 평균으로 측정하는 반응속도 테스트와 랭킹.",
  path: "/games/rspeed/",
});

// 랭킹을 서버에서 미리 읽어 첫 화면(HTML)에 넣음. 1분마다 다시 만듦
export const revalidate = 60;

export default async function Layout({ children }: { children: ReactNode }) {
  const rankings = await preload<ReactionScoreRow[]>(`${REACTION_SCORES_PATH}?limit=10`, 60);
  return <InitialData value={{ rankings }}>{children}</InitialData>;
}
