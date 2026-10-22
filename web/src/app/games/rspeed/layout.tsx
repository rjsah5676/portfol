import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import { InitialData } from "@/lib/api/InitialData";
import { preload } from "@/lib/api/preload";
import { REACTION_SCORES_PATH, type ReactionScoreRow } from "@/firestore/reactionGame";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "반응속도 테스트 - 클릭 반응속도 측정 · 랭킹",
  description:
    "화면이 파란색으로 바뀌는 순간 클릭! 5번 잰 평균으로 내 반응속도(ms)를 측정하고 랭킹에서 다른 사람과 비교해 보세요. 스페이스바 · 엔터 · 터치 지원.",
  path: "/games/rspeed/",
});

// 랭킹을 서버에서 미리 읽어 첫 화면(HTML)에 넣음. 1분마다 다시 만듦
export const revalidate = 60;

export default async function Layout({ children }: { children: ReactNode }) {
  const rankings = await preload<ReactionScoreRow[]>(`${REACTION_SCORES_PATH}?limit=10`, 60);
  return <InitialData value={{ rankings }}>{children}</InitialData>;
}
