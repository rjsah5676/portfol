"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/AuthContext";

/*
 * 관리자 · 테스터만 보는 페이지 (메뉴에서 내린 게임 — /admin 「내린 게임」 탭에서 들어감).
 * 화면만 막는 게 아니라 서버도 그 게임의 요청 · 구독을 관리자에게만 받음 (gateway.adminOnly).
 */
export default function AdminGate({ children }: { children: ReactNode }) {
  const { loading, admin, tester } = useAuth();
  if (loading) return <p className="pt-24 pb-40 text-center font-mono text-sm text-white/40">확인 중…</p>;
  if (!admin && !tester)
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-4 px-6 pt-24 pb-40 text-center font-['Nanum_Gothic',sans-serif]">
        <p className="text-sm leading-relaxed break-keep text-white/60">지금은 열려 있지 않은 게임이에요.</p>
        <Link href="/games/" className="rounded-full border border-white/15 px-4 py-1.5 text-xs text-white/75 hover:text-white">
          다른 게임 보러 가기
        </Link>
      </div>
    );
  return <>{children}</>;
}
