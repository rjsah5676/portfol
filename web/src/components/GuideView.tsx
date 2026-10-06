"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { StaticImageData } from "next/image";

/** 가이드 한 장: 큰 그림 + 제목 + 짧은 설명 */
export interface GuideSlide {
  title: string;
  body: ReactNode;
  /** 실제 게임 화면 캡처 */
  image?: StaticImageData;
  /** 그림 대신 직접 그린 도식 */
  visual?: ReactNode;
}

/** 게임 가이드 내용 (src/data/gameGuides.tsx) */
export interface GuideDoc {
  /** 있으면 넘겨 보는 슬라이드로 보여 줌 (규칙 전체는 "한눈에 보기"로) */
  slides?: GuideSlide[];
  /** 한두 문장 소개 */
  lead: ReactNode;
  /** 한눈에 보는 요약 칩 (예: ["⏱ 약 2분", "👤 혼자"]) */
  facts?: string[];
  sections: { icon: string; title: string; items: ReactNode[] }[];
  /** 맨 아래 작은 글씨 (크레딧 등) */
  foot?: ReactNode;
}

/** 키보드 키 표시 */
export function K({ children }: { children: ReactNode }) {
  return (
    <kbd className="mx-0.5 inline-flex min-w-[1.6em] items-center justify-center rounded-md border border-white/20 border-b-[3px] bg-white/[0.06] px-1.5 py-px font-mono text-[11px] leading-tight text-white/90">
      {children}
    </kbd>
  );
}

/** 강조 */
export function B({ children }: { children: ReactNode }) {
  return <b className="font-bold text-white/95">{children}</b>;
}

export default function GuideView({
  doc,
  accent,
  onDone,
}: {
  doc: GuideDoc;
  accent: string;
  /** 마지막 장에서 "시작하기" */
  onDone?: () => void;
}) {
  const [all, setAll] = useState(false);
  if (doc.slides && !all)
    return (
      <Slides slides={doc.slides} accent={accent} onAll={() => setAll(true)} onDone={onDone} />
    );
  return (
    <div className="flex flex-col gap-4 text-[13.5px] leading-relaxed">
      <p className="text-white/75">{doc.lead}</p>
      {doc.facts && (
        <div className="flex flex-wrap gap-1.5">
          {doc.facts.map((f) => (
            <span
              key={f}
              className="rounded-full border px-2.5 py-0.5 text-xs text-white/75"
              style={{ borderColor: `${accent}44`, background: `${accent}12` }}
            >
              {f}
            </span>
          ))}
        </div>
      )}
      {doc.sections.map((s) => (
        <section
          key={s.title}
          className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5"
        >
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-white">
            <span
              className="flex h-6 w-6 items-center justify-center rounded-lg text-sm"
              style={{ background: `${accent}22` }}
              aria-hidden
            >
              {s.icon}
            </span>
            {s.title}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {s.items.map((it, i) => (
              <li key={i} className="flex gap-2 text-white/70">
                <span
                  className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full"
                  style={{ background: accent }}
                  aria-hidden
                />
                <span className="min-w-0">{it}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {doc.foot && <p className="text-[11px] text-white/30">{doc.foot}</p>}
      {doc.slides && (
        <button
          type="button"
          onClick={() => setAll(false)}
          className="cursor-pointer self-start text-xs text-white/45 underline-offset-4 hover:text-white hover:underline"
        >
          ← 그림으로 보기
        </button>
      )}
    </div>
  );
}

function Slides({
  slides,
  accent,
  onAll,
  onDone,
}: {
  slides: GuideSlide[];
  accent: string;
  onAll: () => void;
  onDone?: () => void;
}) {
  const [i, setI] = useState(0);
  const last = slides.length - 1;
  const go = (n: number) => setI(Math.max(0, Math.min(last, n)));
  // ← → 로 넘기기
  useEffect(() => {
    // 캡처 단계에서 먼저 받아 막음 — 뒤에 깔린 게임(리듬게임 곡 넘기기 등)이 같이 반응하지 않게
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.stopPropagation();
      e.preventDefault();
      const d = e.key === "ArrowRight" ? 1 : -1;
      setI((v) => Math.max(0, Math.min(last, v + d)));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [last]);
  // 좌우로 밀어서 넘기기
  const startX = useRef<number | null>(null);
  // 장을 넘기면 가이드 창 스크롤을 맨 위로 (긴 장 아래쪽에서 '다음'을 눌러도 새 장 처음부터 보이게)
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 가이드 창 자체의 스크롤 칸만 (넘치지 않아도 거기서 멈춤 — 더 올라가 페이지까지 올리지 않게)
    for (let el = root.current?.parentElement; el && el !== document.body; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll") {
        el.scrollTop = 0;
        break;
      }
    }
  }, [i]);

  const s = slides[i];
  return (
    <div ref={root} className="flex flex-col gap-3">
      <div
        className="relative flex aspect-[16/10] touch-pan-y items-center justify-center overflow-hidden rounded-xl border border-white/[0.08] bg-[#121317] select-none"
        onPointerDown={(e) => (startX.current = e.clientX)}
        onPointerUp={(e) => {
          if (startX.current === null) return;
          const dx = e.clientX - startX.current;
          startX.current = null;
          if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1));
        }}
      >
        {s.image ? (
          <img
            key={i}
            src={s.image.src}
            width={s.image.width}
            height={s.image.height}
            alt=""
            draggable={false}
            className="guide-slide-in max-h-full max-w-full object-contain"
          />
        ) : (
          <div
            key={i}
            className="guide-slide-in flex h-full w-full items-center justify-center p-4"
          >
            {s.visual}
          </div>
        )}
        <span className="absolute top-2 left-2 rounded-full bg-black/55 px-2 py-0.5 font-mono text-[11px] text-white/80">
          {i + 1} / {slides.length}
        </span>
      </div>
      <div className="min-h-[7.5rem]">
        <h3 className="mb-1.5 text-base font-bold text-white">{s.title}</h3>
        <div className="text-[13.5px] leading-relaxed text-white/70">{s.body}</div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => go(i - 1)}
          disabled={i === 0}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-white/12 text-white/80 hover:border-white/30 disabled:cursor-default disabled:opacity-25"
          aria-label="이전"
        >
          ‹
        </button>
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {slides.map((_, n) => (
            <button
              key={n}
              type="button"
              onClick={() => go(n)}
              aria-label={`${n + 1}번째`}
              className="h-2 cursor-pointer rounded-full transition-all"
              style={{
                width: n === i ? 18 : 8,
                background: n === i ? accent : "rgba(255,255,255,0.2)",
              }}
            />
          ))}
        </div>
        {i < last ? (
          <button
            type="button"
            onClick={() => go(i + 1)}
            className="flex h-9 cursor-pointer items-center gap-1 rounded-full px-4 text-sm font-bold text-[#111]"
            style={{ background: accent }}
          >
            다음 ›
          </button>
        ) : (
          <button
            type="button"
            onClick={onDone}
            className="flex h-9 cursor-pointer items-center rounded-full px-4 text-sm font-bold text-[#111]"
            style={{ background: accent }}
          >
            시작하기
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onAll}
        className="cursor-pointer self-center text-xs text-white/40 underline-offset-4 hover:text-white hover:underline"
      >
        📋 규칙 전체 한눈에 보기
      </button>
    </div>
  );
}
