"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * 칸에 들어가는 만큼만 보여 주고 나머지는 다음 페이지로 — 스크롤바가 절대 생기지 않게.
 * 보이지 않는 「재는 용」 복사본에 항목을 전부 깔아 두고, 칸 아래로 넘친 첫 항목 앞까지를 한 페이지 개수로 정함
 * (칸 크기 · 글꼴이 바뀌면 다시 잼). 페이지 버튼은 부모가 그림 — onPages 로 페이지 수를 알려 줌.
 */
export default function FitPages({
  items,
  page,
  onPages,
  className,
}: {
  items: ReactNode[];
  page: number;
  onPages: (n: number) => void;
  /** 항목들을 담는 격자의 클래스 */
  className: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [per, setPer] = useState(items.length);
  const [tick, setTick] = useState(0);
  const hist = useRef<number[]>([]);

  // 칸 크기가 바뀌거나 (화면 회전 · 전체화면 · 글자 크게) 웹 글꼴이 들어오면 다시 잼
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTick((n) => n + 1));
    ro.observe(el);
    let alive = true;
    document.fonts?.ready.then(() => alive && setTick((n) => n + 1));
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, []);

  // 재는 용 복사본으로 한 페이지 개수 — 레이아웃 크기(offset)라 창이 뜨는 애니메이션(scale) 중에도 정확
  useLayoutEffect(() => {
    const el = box.current;
    const g = probe.current;
    if (!el || !g) return;
    const limit = el.clientHeight + 0.5;
    let fit = 0;
    for (const c of Array.from(g.children) as HTMLElement[]) {
      if (c.offsetTop + c.offsetHeight <= limit) fit++;
      else break;
    }
    let n = Math.max(1, fit);
    // 안전장치: 값이 A→B→A 로 왔다 갔다 하면 작은 쪽으로 멈춤 (칸 크기가 페이지 버튼에 따라 바뀌는 경우)
    const h = hist.current;
    if (h.length >= 2 && h[h.length - 2] === n && h[h.length - 1] !== n)
      n = Math.min(n, h[h.length - 1]);
    h.push(n);
    if (h.length > 6) h.shift();
    // 잰 값이 바뀌었을 때만 (그리기 전에)
    if (n !== per) setPer(n);
  }, [items, tick, per]);

  const count = items.length;
  const pages = Math.max(1, Math.ceil(count / per));
  useEffect(() => onPages(pages), [pages, onPages]);
  const p = Math.min(page, pages - 1);
  return (
    <div ref={box} data-fit="list" className="relative min-h-0 flex-1 overflow-hidden">
      <div className={className}>{items.slice(p * per, p * per + per)}</div>
      {/* 재는 용 복사본: 틀은 칸 크기로 잘라 두고(넘쳐도 칸이 커지지 않게), 안의 격자는 높이를 정하지 않음 —
          격자 높이를 칸에 맞추면 줄이 늘어나(stretch) 칸이 작을수록 더 많이 들어가는 것처럼 재져서 무한 반복이 났음 */}
      <div
        aria-hidden
        inert
        className="pointer-events-none invisible absolute inset-0 overflow-hidden"
      >
        <div ref={probe} className={className}>
          {items}
        </div>
      </div>
    </div>
  );
}

/** ◀ 1/2 ▶ */
export function Pager({
  page,
  pages,
  onPage,
  small = false,
}: {
  page: number;
  pages: number;
  onPage: (p: number) => void;
  /** 작게 (게임 아래 패널 — 카드가 한 줄 더 들어가게) */
  small?: boolean;
}) {
  if (pages <= 1) return null;
  const btn = `flex ${small ? "h-5 w-6 text-[10px]" : "h-7 w-7"} items-center justify-center rounded-md border border-white/20 text-white/90 transition-colors enabled:hover:border-emerald-300/70`;
  return (
    <div className="flex shrink-0 items-center gap-1 font-mono">
      <button
        type="button"
        className={btn}
        onClick={() => onPage((page - 1 + pages) % pages)}
        aria-label="이전 페이지"
      >
        ◀
      </button>
      <span
        className={`${small ? "vt-xs min-w-7" : "vt-sm min-w-9"} text-center text-white/90 tabular-nums`}
      >
        {page + 1}/{pages}
      </span>
      <button
        type="button"
        className={btn}
        onClick={() => onPage((page + 1) % pages)}
        aria-label="다음 페이지"
      >
        ▶
      </button>
    </div>
  );
}

/** 창 안 목록: 칸에 들어가는 만큼씩 보여 주고 아래에 ◀ 1/2 ▶ (높이가 정해진 칸 안에서 써야 함) */
export function PagedList({ items, className }: { items: ReactNode[]; className: string }) {
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const onPages = useCallback((n: number) => setPages(n), []);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <FitPages items={items} page={page} onPages={onPages} className={className} />
      {pages > 1 && (
        <div className="flex shrink-0 justify-center">
          <Pager page={Math.min(page, pages - 1)} pages={pages} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
