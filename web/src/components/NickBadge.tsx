"use client";

import { useBadge } from "@/lib/badges";

/** 회원 별명 앞에 붙는 꾸밈 (없으면 아무것도 안 그림) */
export default function NickBadge({ nick }: { nick: string }) {
  const badge = useBadge(nick);
  return badge ? <span className="mr-[0.25em]">{badge}</span> : null;
}
