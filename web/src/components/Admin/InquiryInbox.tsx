"use client";

import { useState } from "react";
import { useModal } from "@/components/Modal/ModalProvider";
import { deleteInquiry, setInquiryRead, type Inquiry } from "@/firestore/inquiries";

const btn =
  "cursor-pointer rounded-full border border-white/15 px-3 py-1.5 font-mono text-xs whitespace-nowrap text-white/70 transition-colors hover:border-[#6C63FF]/60 hover:text-white";

function fmt(i: Inquiry) {
  const d = i.createdAt?.toDate();
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function replyHref(i: Inquiry) {
  const subject = "[Gunmo's Dev Life] 문의 답변드립니다";
  const quoted = i.message
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  const body = `${i.name}님, 안녕하세요.\n\n\n\n----- ${fmt(i)} 남겨주신 문의 -----\n${quoted}`;
  return `mailto:${i.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function InquiryInbox({ items, loaded }: { items: Inquiry[]; loaded: boolean }) {
  const modal = useModal();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const unread = items.filter((i) => !i.read).length;
  const list = filter === "unread" ? items.filter((i) => !i.read) : items;

  const toggle = (i: Inquiry) => {
    const next = openId === i.id ? null : i.id;
    setOpenId(next);
    // 펼쳐서 본 순간 읽음 처리
    if (next && !i.read) setInquiryRead(i.id, true).catch(console.error);
  };

  const remove = async (i: Inquiry) => {
    const ok = await modal.confirm({
      title: "문의 삭제",
      message: `${i.name}님의 문의를 삭제할까요? 되돌릴 수 없습니다.`,
      confirmText: "삭제",
      cancelText: "취소",
    });
    if (ok) await deleteInquiry(i.id).catch(console.error);
  };

  return (
    <div>
      <div className="mb-4 flex gap-1.5">
        {(
          [
            ["all", `전체 ${items.length}`],
            ["unread", `안 읽음 ${unread}`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`cursor-pointer rounded-full px-3.5 py-1.5 font-mono text-xs transition-colors ${
              filter === k
                ? "bg-[#6C63FF] text-white"
                : "bg-white/5 text-white/60 hover:bg-white/10"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!loaded ? (
        <p className="py-10 text-center font-mono text-sm text-white/30">불러오는 중…</p>
      ) : list.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-[#1C1E24] py-12 text-center font-['Nanum_Gothic',sans-serif] text-sm text-white/35">
          {filter === "unread" ? "안 읽은 문의가 없습니다." : "아직 들어온 문의가 없습니다."}
        </p>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-white/10 bg-[#1C1E24]">
          {list.map((i) => {
            const open = openId === i.id;
            return (
              <li key={i.id} className="border-b border-white/5 last:border-0">
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  className="flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[.03]"
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i.read ? "bg-transparent" : "bg-[#8B84FF]"}`}
                    title={i.read ? "읽음" : "안 읽음"}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span
                        className={`truncate font-['Nanum_Gothic',sans-serif] text-sm ${i.read ? "text-white/60" : "font-bold text-white"}`}
                      >
                        {i.name}
                        <span className="ml-2 font-mono text-xs font-normal text-white/35">
                          {i.email}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-white/30">{fmt(i)}</span>
                    </span>
                    {!open && (
                      <span className="mt-0.5 block truncate font-['Nanum_Gothic',sans-serif] text-xs text-white/40">
                        {i.message}
                      </span>
                    )}
                  </span>
                </button>

                {open && (
                  <div className="px-4 pb-4 pl-9">
                    <p className="rounded-lg bg-black/20 p-4 font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed break-words whitespace-pre-wrap text-white/85">
                      {i.message}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-white/45">
                      <span>✉ {i.email}</span>
                      {i.phone && (
                        <a href={`tel:${i.phone}`} className="hover:text-white">
                          ☎ {i.phone}
                        </a>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <a
                        href={replyHref(i)}
                        className="rounded-full bg-[#6C63FF] px-3.5 py-1.5 font-mono text-xs text-white transition-colors hover:bg-[#5b52f0]"
                      >
                        메일로 답장
                      </a>
                      <button
                        type="button"
                        onClick={() => setInquiryRead(i.id, !i.read).catch(console.error)}
                        className={btn}
                      >
                        {i.read ? "안 읽음으로" : "읽음으로"}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(i)}
                        className={`${btn} hover:border-red-400/60 hover:text-red-300`}
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
