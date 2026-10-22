"use client";

import RankAvatar from "@/components/RankAvatar";
import type { FriendEntry } from "@/lib/social";

/* 친구 · 메신저 화면 조각 */

export const KR = "font-['Nanum_Gothic',sans-serif]";

/** "방금" · "5분 전" · "3시간 전" · "어제" · "10월 3일" */
export function ago(t: number | null, now = Date.now()): string {
  if (!t) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 2 * 86400) return "어제";
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}일 전`;
  return new Date(t).toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
  });
}

/** 접속 표시 한 줄: "접속 중 · ANIME POKER" / "3시간 전 접속" */
export function presenceLine(f: Pick<FriendEntry, "online" | "where" | "seen">): string {
  if (f.online) return f.where ? `${f.where} 하는 중` : "접속 중";
  return f.seen ? `${ago(f.seen)} 접속` : "오프라인";
}

/** 사진 + 오른쪽 아래 접속 점 */
export function FriendAvatar({
  f,
  size = "sm",
  dot = true,
}: {
  f: Pick<FriendEntry, "pic" | "nick" | "online">;
  size?: "sm" | "lg";
  dot?: boolean;
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <RankAvatar avatar={f.pic} name={f.nick} size={size} />
      {dot && (
        <span
          aria-hidden="true"
          className={`absolute -right-0.5 -bottom-0.5 rounded-full border-2 border-[#1C1E24] ${size === "lg" ? "h-3.5 w-3.5" : "h-3 w-3"} ${
            f.online ? "bg-[#34D399]" : "bg-[#5b5f6b]"
          }`}
        />
      )}
    </span>
  );
}

export function Badge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="min-w-[1.25rem] rounded-full bg-[#F43F5E] px-1.5 text-center font-mono text-[10px] leading-5 font-bold text-white tabular-nums">
      {n > 99 ? "99+" : n}
    </span>
  );
}

export const btn = {
  primary:
    "cursor-pointer rounded-lg bg-[#6C63FF] px-3 py-1.5 text-xs font-bold whitespace-nowrap text-white transition-colors hover:bg-[#5b52f0] disabled:cursor-default disabled:opacity-40",
  ghost:
    "cursor-pointer rounded-lg border border-white/15 px-3 py-1.5 text-xs whitespace-nowrap text-white/75 transition-colors hover:border-white/35 hover:text-white disabled:cursor-default disabled:opacity-40",
  danger:
    "cursor-pointer rounded-lg border border-white/10 px-3 py-1.5 text-xs whitespace-nowrap text-white/50 transition-colors hover:border-red-400/50 hover:text-red-300 disabled:cursor-default disabled:opacity-40",
};
