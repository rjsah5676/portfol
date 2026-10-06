"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import InquiryModal from "@/components/InquiryModal";

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
  home: svg('<path d="M4 10.5 12 4l8 6.5"/><path d="M6 9v10.5h4.5V14h3v5.5H18V9"/>'),
  up: svg('<path d="M12 19V5"/><path d="m5.5 11.5 6.5-6.5 6.5 6.5"/>'),
  inquiry: svg(
    '<path d="M12 4C7 4 3 7.4 3 11.6c0 2.3 1.2 4.3 3.1 5.7L5.5 20.5l3.9-2c.8.2 1.7.3 2.6.3 5 0 9-3.4 9-7.6S17 4 12 4Z" fill="currentColor" stroke="none"/>'
  ),
};

export default function QuickMenu() {
  const router = useRouter();
  const initialized = useRef(false);
  const [inquiryOpen, setInquiryOpen] = useState(false);

  // jQuery 이벤트 핸들러가 최신 값을 쓰도록 ref로 전달
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

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
      menu.add(new Item("home", "", "", "홈"));
      menu.add(new Item("up", "", "", "맨 위로"));
      menu.add(new Item("inquiry", "", "", "문의"));

      const homeButton = document.getElementById("home")!;
      const upButton = document.getElementById("up")!;
      const inquiryButton = document.getElementById("inquiry")!;

      const labels: Record<keyof typeof ICONS, string> = {
        list: "메뉴",
        home: "홈으로",
        up: "맨 위로",
        inquiry: "문의하기",
      };
      (Object.keys(ICONS) as (keyof typeof ICONS)[]).forEach((id) => {
        const el = document.getElementById(id)!;
        el.innerHTML = ICONS[id];
        el.setAttribute("aria-label", labels[id]);
      });

      const onHome = () => routerRef.current.push("/");
      const onUp = () => window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      const onInquiry = () => setInquiryOpen(true);

      homeButton.addEventListener("click", onHome);
      upButton.addEventListener("click", onUp);
      inquiryButton.addEventListener("click", onInquiry);

      cleanupFns.push(() => {
        homeButton.removeEventListener("click", onHome);
        upButton.removeEventListener("click", onUp);
        inquiryButton.removeEventListener("click", onInquiry);
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
      <InquiryModal open={inquiryOpen} onClose={() => setInquiryOpen(false)} />
    </div>
  );
}
