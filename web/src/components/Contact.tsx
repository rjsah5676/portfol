"use client";

import { openContactModal, useDraggableContactModal } from "../hooks/useDraggableContactModal";
import contactImg from "@/img/contact_img.png";

export default function Contact() {
  useDraggableContactModal();
  return (
    <div
      id="contact-container"
      className="fixed -z-10 w-[calc(100vw-2.5rem)] max-w-[420px] rounded-2xl border border-white/10 bg-[#1C1E24]/95 p-6 opacity-0 shadow-2xl backdrop-blur-md transition-opacity duration-500 select-none hover:cursor-grab sm:p-8"
    >
      <div id="contact-box" className="flex flex-col items-center gap-4 text-center">
        <div
          className="h-20 w-20 rounded-full bg-cover bg-center ring-2 ring-[#6C63FF]/40"
          style={{ backgroundImage: `url(${contactImg.src})` }}
        ></div>
        <div className="font-mono text-lg font-medium text-white">Gunmo Lee</div>
        <ul
          data-no-drag
          className="flex cursor-text flex-col gap-2 font-mono text-sm text-white/60 select-text"
        >
          <li>010-6385-4676</li>
          <li>rjsah5676@gmail.com</li>
        </ul>
        <button
          id="exit-button"
          type="button"
          className="mt-2 cursor-pointer font-mono text-xs text-white/40 transition-colors hover:text-white"
          onClick={() => openContactModal(0)}
        >
          close
        </button>
      </div>
    </div>
  );
}
