"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/*
 * 사이트 머리 (로고 아래 큰 글자). 메인에서만 크게 · h1 로 두고,
 * 다른 화면에서는 낮게 줄여서 (모바일에서 첫 화면이 머리로 다 차지 않게) 그 화면의 제목이 h1 이 되게 함.
 */
export default function Header() {
  const path = usePathname() ?? "/";
  const home = path.replace(/\/+$/, "") === "";
  if (home)
    return (
      <div
        id="site-header"
        className="flex flex-col items-center gap-4 bg-[#121212] px-6 pt-36 pb-20 text-center"
      >
        <span className="font-mono text-sm text-[#8B84FF]">{"// fullstack developer"}</span>
        <h1 className="font-mono text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
          Gunmo&apos;s Dev Life
        </h1>
      </div>
    );
  return (
    <div
      id="site-header"
      className="flex flex-col items-center gap-2 bg-[#121212] px-6 pt-24 pb-8 text-center sm:gap-3 sm:pt-28 sm:pb-12"
    >
      <span className="font-mono text-xs text-[#8B84FF] sm:text-sm">{"// fullstack developer"}</span>
      <Link
        href="/"
        className="font-mono text-2xl font-bold tracking-tight text-white transition-colors hover:text-[#C4C0FF] sm:text-4xl"
      >
        Gunmo&apos;s Dev Life
      </Link>
    </div>
  );
}
