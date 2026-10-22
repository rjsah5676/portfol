"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/AuthContext";
import { whereOf } from "@/lib/social";
import { openChat, social, useSocial } from "@/lib/socialStore";
import Messenger from "./Messenger";
import ReportModal from "./ReportModal";
import UserCardModal from "./UserCardModal";
import { KR } from "./parts";

/*
 * 친구 · 메신저 뿌리 (layout 에 하나): 회원이면 실시간 구독을 켜서 접속 중으로 보이게 하고,
 * 페이지를 옮기면 「있는 곳」을 알리고, 정보보기 · 신고 · 채팅 창과 새 메시지 · 친구 요청 알림을 띄움.
 */
export default function SocialRoot() {
  const { profile } = useAuth();
  const nick = profile?.nick ?? null;
  const s = useSocial();
  const path = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!nick) return;
    social.start();
    return () => social.stop();
  }, [nick]);

  const where = whereOf(path ?? "/");
  const ready = s.status === "ready";
  useEffect(() => {
    if (ready) void social.where(where);
  }, [ready, where]);

  // 새 메시지 알림은 5초 뒤 사라짐
  const toastAt = s.toast?.at;
  useEffect(() => {
    if (!toastAt) return;
    const t = setTimeout(() => social.clearToast(), 5000);
    return () => clearTimeout(t);
  }, [toastAt]);

  return (
    <>
      <UserCardModal />
      <ReportModal />
      <Messenger />
      {s.toast && (
        <button
          type="button"
          onClick={() => {
            const t = s.toast!;
            if (t.kind === "req") {
              social.clearToast();
              router.push("/me/?tab=friends");
            } else openChat(t.uid);
          }}
          className={`${KR} fixed right-4 bottom-[calc(15%+5rem)] z-[99998] flex max-w-[min(20rem,calc(100vw-2rem))] cursor-pointer items-start gap-2 rounded-xl border border-white/12 bg-[#23252d]/95 px-3 py-2.5 text-left shadow-[0_12px_32px_rgba(0,0,0,0.45)] backdrop-blur sm:right-[5%]`}
        >
          <span aria-hidden className="pt-0.5">
            {s.toast.kind === "req" ? "👋" : s.toast.kind === "ok" ? "🤝" : "💬"}
          </span>
          <span className="min-w-0">
            <b className="block truncate text-xs text-white">{s.toast.nick}</b>
            <span className="line-clamp-2 text-xs break-all text-white/70">{s.toast.text}</span>
          </span>
        </button>
      )}
    </>
  );
}
