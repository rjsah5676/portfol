"use client";

import { useState } from "react";
import { API_URL } from "@/lib/api/config";
import type { Profile } from "@/lib/AuthContext";

const SIZE = {
  sm: "h-7 w-7 text-xs",
  lg: "h-11 w-11 text-lg",
  xl: "h-20 w-20 text-3xl",
} as const;

/**
 * 프로필 동그라미: 직접 올린 사진 → 로그인 계정(Google)의 사진 → 별명 첫 글자 순으로.
 * (관리자가 붙여 준 꾸밈이 있으면 첫 글자 대신 그걸 보여 줌)
 */
export default function Avatar({
  profile,
  photo,
  size,
}: {
  profile: Profile;
  /** 로그인 계정의 사진 주소 */
  photo: string | null;
  size: keyof typeof SIZE;
}) {
  const [broken, setBroken] = useState("");
  const src = profile.avatar ? `${API_URL}${profile.avatar}` : photo;
  if (src && broken !== src)
    return (
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(src)}
        className={`shrink-0 rounded-full bg-white/10 object-cover ${SIZE[size]}`}
      />
    );
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#6C63FF,#2DD4BF)] font-['Nanum_Gothic',sans-serif] font-bold text-white ${SIZE[size]}`}
    >
      {profile.badge ?? [...profile.nick][0]}
    </span>
  );
}
