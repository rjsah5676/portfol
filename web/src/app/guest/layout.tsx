import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import { InitialData } from "@/lib/api/InitialData";
import { preload } from "@/lib/api/preload";
import type { GuestEntry } from "@/firestore/guestbook";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "방명록",
  description:
    "Gunmo's Dev Life 방명록. 로그인 없이 메모지 한 장에 한마디 남길 수 있어요. 사이트 후기, 게임 피드백, 응원 모두 환영합니다.",
  path: "/guest/",
});

// 요청 때마다 서버에서 메모 목록을 읽어 첫 화면(HTML)에 넣음 (못 읽으면 브라우저가 평소처럼 읽어옴)
export const dynamic = "force-dynamic";

export default async function Layout({ children }: { children: ReactNode }) {
  const entries = await preload<GuestEntry[]>("/api/guest", 0);
  return <InitialData value={{ entries }}>{children}</InitialData>;
}
