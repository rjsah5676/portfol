"use client";

import { useState } from "react";
import InquiryModal from "@/components/InquiryModal";

// 푸터의 문의하기 → 문의 보내기 창
export default function InquiryButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer text-white/60 transition-colors hover:text-[#8B84FF]"
      >
        문의하기
      </button>
      <InquiryModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
