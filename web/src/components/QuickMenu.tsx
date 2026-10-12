"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "@/components/Modal/Modal";
import { openSiteSearch } from "@/components/SiteSearch";

// 플로팅 버튼 아이콘 (색은 CSS의 color를 따라감)
const svg = (body: string, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

const ICONS = {
  // 펼치면 CSS로 X 모양으로 바뀜 (floatstyle.css #list.open)
  list: svg(
    '<line class="line-top" x1="5" y1="7" x2="19" y2="7"/>' +
      '<line class="line-mid" x1="5" y1="12" x2="19" y2="12"/>' +
      '<line class="line-bottom" x1="5" y1="17" x2="19" y2="17"/>'
  ),
  up: svg('<path d="M12 19V5"/><path d="m5.5 11.5 6.5-6.5 6.5 6.5"/>'),
  search: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>'),
  mail: svg('<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>'),
};

export default function QuickMenu() {
  const initialized = useRef(false);
  const [mailOpen, setMailOpen] = useState(false);

  useEffect(() => {
    // React 19 StrictMode(dev)는 effect를 두 번 실행하는데, jQuery로 만든 버튼들이
    // 중복 생성되면 안 되니 한 번만 초기화되게 막음.
    if (initialized.current) return;
    initialized.current = true;

    const cleanupFns: (() => void)[] = [];

    (async () => {
      // jquery/jquery-ui-dist/animejs는 window를 직접 참조하기 때문에
      // 정적 export 빌드(Node 환경)에서 로드되면 안 됨 -> 브라우저에서만, 여기서만 로드.
      const [{ default: Menu }, { default: Item }] = await Promise.all([
        import("@/lib/quickMenu/Menu"),
        import("@/lib/quickMenu/Item"),
      ]);

      const menu = new Menu("#myMenu");
      menu.add(new Item("list", "", ""));
      menu.add(new Item("search", "", "", "검색"));
      menu.add(new Item("mail", "", "", "우편함"));
      menu.add(new Item("up", "", "", "맨 위로"));

      const upButton = document.getElementById("up")!;
      const searchButton = document.getElementById("search")!;
      const mailButton = document.getElementById("mail")!;

      const labels: Record<keyof typeof ICONS, string> = {
        list: "메뉴",
        up: "맨 위로",
        search: "사이트 검색",
        mail: "우편함",
      };
      (Object.keys(ICONS) as (keyof typeof ICONS)[]).forEach((id) => {
        const el = document.getElementById(id)!;
        el.innerHTML = ICONS[id];
        el.setAttribute("aria-label", labels[id]);
      });

      const onUp = () => window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      const onSearch = () => openSiteSearch();
      const onMail = () => setMailOpen(true);

      upButton.addEventListener("click", onUp);
      searchButton.addEventListener("click", onSearch);
      mailButton.addEventListener("click", onMail);

      cleanupFns.push(() => {
        upButton.removeEventListener("click", onUp);
        searchButton.removeEventListener("click", onSearch);
        mailButton.removeEventListener("click", onMail);
      });
    })();

    return () => cleanupFns.forEach((fn) => fn());
  }, []);

  return (
    <div
      data-quickmenu
      className="quick-menu-fab fixed top-[85%] right-[5%] z-[99999] m-auto h-[52px] w-[52px] text-white sm:h-[70px] sm:w-[70px]"
    >
      <div id="myMenu"></div>
      {/* 우편함: 아직 기능 없음 — 빈 우편함만 보여 줌 */}
      <Modal open={mailOpen} onClose={() => setMailOpen(false)} title="우편함" size="sm" closeButton>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="text-4xl" aria-hidden="true">
            📭
          </span>
          <p className="text-sm text-white/60">받은 우편이 없습니다</p>
        </div>
      </Modal>
    </div>
  );
}
