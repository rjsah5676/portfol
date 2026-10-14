"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api/http";

/*
 * 사이트 공지 띠 (관리자 → 공지). 모든 페이지 메뉴 바로 아래 한 줄, 닫으면 그 공지는 이 브라우저에서 다시 안 보임.
 * 서버: server/src/http/notice.ts
 */

interface Notice {
  id: string;
  text: string;
  link?: string;
  tone: "info" | "event" | "warn";
  until: number | null;
}

const KEY = "site-notice-closed";
const TONE: Record<
  Notice["tone"],
  { bar: string; dot: string; label: string }
> = {
  info: {
    bar: "border-[#6C63FF]/30 bg-[#6C63FF]/[0.12]",
    dot: "bg-[#8B84FF]",
    label: "알림",
  },
  event: {
    bar: "border-[#FDE68A]/30 bg-[#FDE68A]/[0.09]",
    dot: "bg-[#FDE68A]",
    label: "이벤트",
  },
  warn: {
    bar: "border-red-400/35 bg-red-500/[0.12]",
    dot: "bg-red-400",
    label: "점검",
  },
};

export default function SiteNoticeBar() {
  const path = usePathname();
  const [n, setN] = useState<Notice | null>(null);

  useEffect(() => {
    let live = true;
    api<{ notice: Notice | null }>("/api/notice", { timeoutMs: 5000 })
      .then((r) => {
        if (!live || !r.notice) return;
        let closed = "";
        try {
          closed = localStorage.getItem(KEY) ?? "";
        } catch {}
        if (closed !== r.notice.id) setN(r.notice);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!n || path?.startsWith("/admin")) return null;
  const t = TONE[n.tone] ?? TONE.info;
  const close = () => {
    try {
      localStorage.setItem(KEY, n.id);
    } catch {}
    setN(null);
  };
  const external = n.link?.startsWith("http");

  return (
    <div
      role="status"
      className={`relative z-20 border-b ${t.bar} font-['Nanum_Gothic',sans-serif]`}
    >
      <div className="mx-auto flex max-w-[1200px] items-center gap-3 px-4 py-2 text-[13px] text-white/85">
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-bold text-white/70">
          <i
            className={`inline-block h-1.5 w-1.5 rounded-full ${t.dot}`}
            aria-hidden
          />
          {t.label}
        </span>
        <p className="min-w-0 flex-1 break-keep">
          {n.text}
          {n.link &&
            (external ? (
              <a
                href={n.link}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 whitespace-nowrap underline underline-offset-2 hover:text-white"
              >
                자세히 보기
              </a>
            ) : (
              <Link
                href={n.link}
                className="ml-2 whitespace-nowrap underline underline-offset-2 hover:text-white"
              >
                자세히 보기
              </Link>
            ))}
        </p>
        <button
          type="button"
          onClick={close}
          aria-label="공지 닫기"
          className="-mr-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
