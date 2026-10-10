"use client";

import { sfx } from "@/lib/rhythm/sfx";

const KR = "font-['Nanum_Gothic',sans-serif]";
const cls = `${KR} cursor-pointer rounded-[0.6cqw] border border-white/15 bg-white/5 px-[1cqw] py-[0.4cqw] text-[1.05cqw] text-white/75 transition-colors hover:border-white/40 hover:text-white`;

/** 온라인 화면 머리말 오른쪽: 설정 · 전체화면 켜기/끄기 */
export default function TopButtons({
  fs,
  onToggleFs,
  onSettings,
}: {
  fs: boolean;
  onToggleFs: () => void;
  onSettings: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className={cls}
        onClick={() => {
          sfx("ui-open", 0.6);
          onSettings();
        }}
      >
        ⚙ 설정
      </button>
      <button type="button" className={cls} onClick={onToggleFs}>
        {fs ? "✕ 창모드" : "⛶ 전체화면"}
      </button>
    </>
  );
}
