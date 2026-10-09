"use client";

import { useEffect, useRef, useState } from "react";
import { watchServerNotice } from "@/lib/api/socket";

/*
 * 배포로 서버가 다시 켜질 때 게임 화면 위에 잠깐 띄우는 안내 띠.
 *   공지를 받음      → "서버 업데이트 중" (진행 중인 판이 끝나면 잠깐 끊김)
 *   그 뒤 끊김        → "다시 켜는 중"
 *   다시 연결됨       → "다시 연결됐어요" 잠깐 보이고 사라짐
 * 공지 없이 끊긴 경우(네트워크 등)는 각 게임 화면이 알아서 보여 주므로 여기서는 띄우지 않음.
 */

type View = "restart" | "down" | "back" | null;

const TEXT: Record<Exclude<View, null>, { title: string; body: string }> = {
  restart: { title: "서버 업데이트 중", body: "진행 중인 판이 끝나면 잠깐 끊겼다가 다시 연결돼요. 방과 자리는 그대로예요." },
  down: { title: "서버를 다시 켜는 중", body: "곧 자동으로 다시 연결돼요." },
  back: { title: "다시 연결됐어요", body: "하던 방에서 이어서 하면 돼요." },
};

export default function ServerNotice() {
  const [view, setView] = useState<View>(null);
  const restarting = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const off = watchServerNotice(({ notice, connected }) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = null;
      if (notice) restarting.current = true;
      if (restarting.current && connected === false) {
        setView("down");
      } else if (notice) {
        setView("restart");
      } else if (restarting.current && connected) {
        restarting.current = false;
        setView("back");
        hideTimer.current = setTimeout(() => setView(null), 3000);
      } else if (!restarting.current) {
        setView(null);
      }
    });
    return () => {
      off();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  if (!view) return null;
  const { title, body } = TEXT[view];
  const busy = view !== "back";
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[4.25rem] z-[70] flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className={`flex max-w-md items-start gap-3 rounded-2xl border bg-[#17181D]/95 px-4 py-3 shadow-[0_18px_40px_-14px_rgba(0,0,0,0.85)] backdrop-blur-md ${
          busy ? "border-[#FBBF24]/35" : "border-[#2DD4BF]/40"
        }`}
      >
        <span
          aria-hidden="true"
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${busy ? "animate-pulse bg-[#FBBF24]" : "bg-[#2DD4BF]"}`}
        />
        <span className="font-['Nanum_Gothic',sans-serif] text-sm leading-snug">
          <span className="block font-bold text-white">{title}</span>
          <span className="mt-0.5 block text-white/60">{body}</span>
        </span>
      </div>
    </div>
  );
}
