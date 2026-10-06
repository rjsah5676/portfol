import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "개인공부 일괄 등록",
  path: "/study/import/",
  noindex: true,
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
