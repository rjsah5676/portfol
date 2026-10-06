"use client";

import Link from "next/link";
import logoMark from "@/img/logo-mark.svg";
import AccountMenu from "@/components/Account/AccountMenu";

export default function Top() {
  return (
    <div className="fixed top-0 z-50 w-full border-b border-white/5 bg-[#121212]/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-mono text-sm font-medium tracking-tight text-white/90 transition-colors hover:text-[#8B84FF]"
        >
          <img src={logoMark.src} alt="" className="h-6 w-6 rounded-md" />
          <span className="hidden sm:inline">gunmo.my</span>
        </Link>
        <AccountMenu />
      </div>
    </div>
  );
}
