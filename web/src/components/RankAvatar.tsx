"use client";

import { useState } from "react";
import { avatarUrl } from "@/lib/api/config";
import { plainName } from "./Nick";

const SIZE = {
  xs: "h-5 w-5 text-[10px]",
  sm: "h-7 w-7 text-xs",
  lg: "h-11 w-11 text-lg",
  game: "h-[2cqw] w-[2cqw] text-[0.9cqw]",
} as const;

/**
 * 랭킹 줄의 프로필 동그라미: 회원이 올린 사진 → 비회원은 익명 실루엣 → 사진 없는 회원은 별명 첫 글자.
 * (Account/Avatar 는 내 프로필용 — 로그인 계정 사진까지 보지만, 랭킹엔 그 주소가 없음)
 */
export default function RankAvatar({
  avatar,
  name,
  guest,
  size = "sm",
  className = "",
}: {
  /** 서버가 준 사진 주소 (/api/avatars/…), 없으면 null */
  avatar?: string | null;
  name: string;
  guest?: boolean;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const [broken, setBroken] = useState("");
  const src = avatar ? avatarUrl(avatar) : null;
  if (src && broken !== src)
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(src)}
        className={`shrink-0 rounded-full bg-white/10 object-cover ${SIZE[size]} ${className}`}
      />
    );
  if (guest)
    return (
      <span
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center rounded-full bg-white/10 text-white/45 ${SIZE[size]} ${className}`}
      >
        <svg viewBox="0 0 24 24" className="h-[70%] w-[70%]" fill="currentColor">
          <circle cx="12" cy="8.5" r="4" />
          <path d="M4 20c0-4.1 3.6-7 8-7s8 2.9 8 7v1H4v-1z" />
        </svg>
      </span>
    );
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#6C63FF,#2DD4BF)] font-['Nanum_Gothic',sans-serif] font-bold text-white ${SIZE[size]} ${className}`}
    >
      {[...plainName(name)][0] ?? "?"}
    </span>
  );
}
