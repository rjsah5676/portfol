"use client";

import { useEffect, useState } from "react";
import RegexBuilder from "@/components/Tools/RegexBuilder";
import RegexTool from "@/components/Tools/RegexTool";
import RegexValidate, { type ValidateIncoming } from "@/components/Tools/RegexValidate";

const TABS = [
  { key: "test", label: "검증 테스트", desc: "입력값이 통과하는지, 어느 글자가 걸리는지" },
  { key: "build", label: "정규식 만들기", desc: "조건을 고르면 정규식과 코드로" },
  { key: "find", label: "찾기·치환", desc: "긴 텍스트에서 매칭·그룹·치환" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const isTab = (s: string): s is Tab => TABS.some((t) => t.key === s);

export default function RegexStudio() {
  const [tab, setTab] = useState<Tab>("test");
  const [incoming, setIncoming] = useState<ValidateIncoming | null>(null);

  // 주소 #build 같은 해시로 탭 기억 (공유·뒤로가기)
  useEffect(() => {
    const sync = () => {
      const h = location.hash.slice(1);
      if (isTab(h)) setTab(h);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", `#${t}`);
  };

  return (
    <div>
      <div
        role="tablist"
        className="mb-6 grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-[#15171c] p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => go(t.key)}
            className={`cursor-pointer rounded-xl px-2 py-2.5 text-center transition-colors sm:px-4 ${
              tab === t.key
                ? "bg-[#6C63FF] text-white"
                : "text-white/55 hover:bg-white/5 hover:text-white/85"
            }`}
          >
            <div className="font-['Nanum_Gothic',sans-serif] text-sm font-bold">{t.label}</div>
            <div
              className={`mt-0.5 hidden font-['Nanum_Gothic',sans-serif] text-[11px] sm:block ${
                tab === t.key ? "text-white/75" : "text-white/30"
              }`}
            >
              {t.desc}
            </div>
          </button>
        ))}
      </div>

      {/* 탭을 오가도 입력값이 남도록 숨기기만 함 */}
      <div hidden={tab !== "test"}>
        <RegexValidate incoming={incoming} />
      </div>
      <div hidden={tab !== "build"}>
        <RegexBuilder
          onTest={(pattern, samples) => {
            setIncoming({ pattern, samples, nonce: Date.now() });
            go("test");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      </div>
      <div hidden={tab !== "find"}>
        <RegexTool />
      </div>
    </div>
  );
}
