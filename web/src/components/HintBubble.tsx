"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/**
 * 처음 보는 UI 옆에 잠깐 뜨는 안내 말풍선 (PC·모바일 공통).
 *
 * - 마운트 후 delay 뒤에 나타나서 duration 동안 보였다가 사라짐 (누르면 바로 닫힘)
 * - storageKey 기준으로 브라우저(localStorage)마다 따로 기억함
 *   · markHintSeen(storageKey) 이후로는 다시 안 뜸 (그 기능을 직접 써봤을 때 호출)
 *   · maxShows를 주면 그 횟수만큼 보여준 뒤로는 안 뜸
 * - 터치 기기(pointer: coarse)와 마우스 기기에서 문구를 다르게: children(기본) / mobile
 * - device로 특정 기기에서만 띄울 수 있음
 * - active가 true가 된 뒤부터 타이머 시작 (스크롤로 화면에 들어왔을 때 등)
 * - 위치는 className으로 잡고(absolute/fixed), tail은 말풍선 꼬리가 향하는 쪽
 */
export function markHintSeen(storageKey: string) {
  try {
    localStorage.setItem(storageKey, "1");
  } catch {
    // 시크릿 모드 등 저장 불가 — 무시
  }
}

type Tail = "left" | "top" | "bottom" | "none";

// 한 화면에 말풍선이 여러 개 겹쳐 뜨지 않게, 한 번에 하나만 (먼저 뜬 쪽 우선)
let activeHint: string | null = null;

const HIDE: Record<Tail, string> = {
  left: "-translate-x-2",
  top: "translate-y-2",
  bottom: "-translate-y-2",
  none: "translate-y-1",
};

export default function HintBubble({
  storageKey,
  children,
  mobile,
  device = "all",
  tail = "left",
  maxShows = Infinity,
  delay = 900,
  duration = 4500,
  className = "",
  hidden = false,
  active = true,
}: {
  storageKey: string;
  children: ReactNode;
  /** 터치 기기에서 대신 보여줄 문구 */
  mobile?: ReactNode;
  device?: "all" | "pc" | "mobile";
  tail?: Tail;
  maxShows?: number;
  delay?: number;
  duration?: number;
  className?: string;
  /** 부모 쪽 사정으로 지금 숨겨야 할 때 (예: 메뉴가 열림) */
  hidden?: boolean;
  /** false인 동안은 타이머를 시작하지 않음 (예: 화면에 들어왔을 때 띄우기) */
  active?: boolean;
}) {
  const [show, setShow] = useState(false);
  const [touch, setTouch] = useState(false);

  useEffect(() => {
    if (!active) return;
    let coarse = false;
    let seen = false;
    let count = 0;
    try {
      coarse = window.matchMedia("(pointer: coarse)").matches;
      seen = localStorage.getItem(storageKey) === "1";
      count = Number(localStorage.getItem(`${storageKey}:n`) ?? 0);
    } catch {
      seen = false;
    }
    if (seen || count >= maxShows) return;
    if ((device === "pc" && coarse) || (device === "mobile" && !coarse)) return;

    let mine = false;
    const t1 = setTimeout(() => {
      // 다른 안내가 떠 있으면 이번엔 건너뜀 (횟수도 안 셈 → 다음 방문에 뜸)
      if (activeHint && activeHint !== storageKey) return;
      activeHint = storageKey;
      mine = true;
      setTouch(coarse);
      setShow(true);
      try {
        localStorage.setItem(`${storageKey}:n`, String(count + 1));
      } catch {
        // 무시
      }
    }, delay);
    const release = () => {
      if (mine && activeHint === storageKey) activeHint = null;
      mine = false;
    };
    const t2 = setTimeout(() => {
      setShow(false);
      release();
    }, delay + duration);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      release();
    };
  }, [storageKey, device, maxShows, delay, duration, active]);

  const visible = show && !hidden;
  // 안 보일 땐 DOM에서 빼서(사라지는 애니메이션 뒤) 폭 0 — 숨은 말풍선이 화면 밖으로 삐져나와
  // 모바일 뷰포트가 늘어나는 걸 막음
  const [inDom, setInDom] = useState(false);
  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 보이는 동안만 DOM에
      setInDom(true);
      return;
    }
    const t = setTimeout(() => setInDom(false), 520);
    return () => clearTimeout(t);
  }, [visible]);
  // 바깥 상자는 폭 0으로 두고(화면 밖으로 삐져나와 가로 스크롤·모바일 뷰포트 늘어남 방지),
  // 가운데 정렬(-translate-x-1/2)은 안쪽 상자에서 함
  const centered = className.includes("-translate-x-1/2");
  const base = centered ? "translateX(-50%)" : "";

  // 화면 가장자리 근처에 뜨면 화면 밖으로 나가지 않게 안쪽으로 밀어줌 (꼬리는 원래 자리를 가리키게 반대로 이동)
  // 화면보다 넓으면 줄바꿈 허용
  const shiftRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ shift: number; width: number | null }>({
    shift: 0,
    width: null,
  });
  useLayoutEffect(() => {
    if (!visible) return;
    const wrap = shiftRef.current;
    const el = bubbleRef.current;
    if (!wrap || !el) return;
    const measure = () => {
      // 모바일에서 뭔가 삐져나와 레이아웃 뷰포트가 늘어났어도 실제 화면 폭 기준으로
      const vw = Math.min(
        document.documentElement.clientWidth,
        window.visualViewport?.width ?? Infinity
      );
      const M = 8;
      const prev = { t: wrap.style.transform, w: el.style.width, ws: el.style.whiteSpace };
      wrap.style.transform = base || "none";
      el.style.width = "";
      el.style.whiteSpace = "";
      let r = el.getBoundingClientRect();
      let width: number | null = null;
      if (r.width > vw - M * 2) {
        width = vw - M * 2;
        el.style.width = `${width}px`;
        el.style.whiteSpace = "normal";
        r = el.getBoundingClientRect();
      }
      const shift = Math.round(r.left < M ? M - r.left : r.right > vw - M ? vw - M - r.right : 0);
      wrap.style.transform = prev.t;
      el.style.width = prev.w;
      el.style.whiteSpace = prev.ws;
      setFit((f) => (f.shift === shift && f.width === width ? f : { shift, width }));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [visible, touch, inDom, base]);

  return (
    <div className={`pointer-events-none z-20 w-0 ${className}`} aria-live="polite">
      {inDom && (
        <div
          ref={shiftRef}
          className="w-max"
          style={{ transform: `${base} translateX(${fit.shift}px)`.trim() || undefined }}
        >
          <div
            ref={bubbleRef}
            role="status"
            data-tail={tail}
            style={
              {
                width: fit.width ?? undefined,
                whiteSpace: fit.width ? "normal" : undefined,
                "--hint-shift": `${-fit.shift}px`,
              } as CSSProperties
            }
            onClick={() => setShow(false)}
            className={`hint-bubble relative rounded-xl border border-[#6C63FF]/40 bg-[#1C1E24] px-3 py-2 font-['Nanum_Gothic',sans-serif] text-xs whitespace-nowrap text-white/85 shadow-[0_8px_30px_-6px_rgba(108,99,255,0.5)] transition-all duration-500 ${
              visible
                ? "pointer-events-auto translate-x-0 translate-y-0 cursor-pointer opacity-100"
                : `opacity-0 ${HIDE[tail]}`
            }`}
          >
            {touch && mobile ? mobile : children}
          </div>
        </div>
      )}
    </div>
  );
}
