import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";

// page.tsx가 "use client"라 metadata를 export할 수 없어서 layout에서 지정
export const metadata = pageMeta({
  title: "JSON Formatter",
  description: "JSON 정렬(pretty print)·압축(minify)·키 정렬·유효성 검사. 오류 위치(줄·칸) 표시.",
  path: "/devtools/json/",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
