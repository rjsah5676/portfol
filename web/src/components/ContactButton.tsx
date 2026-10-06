"use client";

import { openContactModal } from "@/hooks/useDraggableContactModal";

// 푸터의 contact → 명함(Contact) 모달 열기
export default function ContactButton() {
  return (
    <button
      type="button"
      onClick={() => openContactModal(1)}
      className="cursor-pointer text-white/60 transition-colors hover:text-[#8B84FF]"
    >
      contact
    </button>
  );
}
