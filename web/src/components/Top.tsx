"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import logoMark from "@/img/logo-mark.svg";

export default function Top() {
  const pathname = usePathname();

  // trailingSlash: true라 "/archive/"로 들어오므로 끝 슬래시 제거 후 비교
  const path = pathname.replace(/\/+$/, "") || "/";
  const isAbout = path === "/about";
  const isArchive = path === "/archive";
  const isGuest = path === "/guest";

  const linkClass = (active: boolean) =>
    `transition-colors ${active ? "text-[#8B84FF]" : "text-white/60 hover:text-white"}`;

  return (
    <div className="fixed top-0 z-50 w-full border-b border-white/5 bg-[#121212]/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-mono text-sm font-medium tracking-tight text-white/90 transition-colors hover:text-[#8B84FF]"
        >
          <img src={logoMark.src} alt="" className="h-6 w-6 rounded-md" />
          <span className="hidden sm:inline">gunmo.dev</span>
        </Link>
        <div className="flex items-center gap-3 font-mono text-xs sm:gap-6 sm:text-sm">
          <Link href="/about" className={linkClass(isAbout)}>
            about
          </Link>
          <Link href="/archive" className={linkClass(isArchive)}>
            archive
          </Link>
          {/* 방명록: 텍스트 대신 메모 아이콘 */}
          <Link
            href="/guest"
            aria-label="방명록 (guest box)"
            title="방명록"
            className={`flex items-center ${linkClass(isGuest)}`}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-[18px] w-[18px]"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {/* 모서리가 접힌 메모지 + 글줄 */}
              <path d="M5 4h14v10l-6 6H5z" />
              <path d="M13 20v-6h6" />
              <path d="M8.5 8.5h7M8.5 11.5h4" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}
