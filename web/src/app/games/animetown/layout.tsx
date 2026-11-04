import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import "@/css/gmtown.css";

// page.tsx 가 "use client" 라 metadata 는 여기서
export const metadata = pageMeta({
  title: "ANIME TOWN - 웹 3D 실험용 놀이터",
  description:
    "3D 애니 캐릭터로 돌아다니는 웹 마을. gunmo.my 의 게임 건물들을 걸어 다니며 들어가고, 같은 채널 사람들과 만나 이야기해요. 설치 없이 PC · 모바일(가로)에서.",
  path: "/games/animetown/",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
