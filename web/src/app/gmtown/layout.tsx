import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

// 예전 주소 (/games/animetown 으로 넘김)
export const metadata = pageMeta({
  title: "ANIME TOWN - 웹 3D 실험용 놀이터",
  description: "3D 애니 캐릭터로 돌아다니는 웹 마을.",
  path: "/gmtown/",
  noindex: true,
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
