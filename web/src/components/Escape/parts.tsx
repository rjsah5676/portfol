"use client";

import { useEffect, useRef, useState } from "react";
import type { Line, Room, State } from "./types";

/* 방탈출 엔진 조각: 대사 창 · 사건 노트 · 로딩 · 방 카드 */

const BATANG = { fontFamily: "'Gowun Batang', serif" } as const;

/** 그림 주소 꼬리 붙이기: /a/S.webp + "-red" → /a/S-red.webp */
export const vsrc = (src: string, v: string) => (v ? src.replace(/(\.\w+)$/, `${v}$1`) : src);

/** 글자를 하나씩 찍는 한 줄. api.finish() 로 바로 끝까지 */
function Typer({ text, api }: { text: string; api: { current: { done: boolean; finish: () => void } } }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => (x >= text.length ? x : x + 1)), 28);
    return () => clearInterval(t);
  }, [text]);
  useEffect(() => {
    api.current = { done: n >= text.length, finish: () => setN(text.length) };
  }, [n, text, api]);
  return (
    <>
      {text.slice(0, n)}
      <span className="opacity-0">{text.slice(n)}</span>
    </>
  );
}

/**
 * 옛날 2D 게임식 대사 창: 이름표 + 글자 하나씩. 누르면 다 찍히고, 한 번 더 누르면 다음 줄.
 * queue 가 비면 마지막 줄을 흐리게 남겨 둠.
 */
export function DialogueBox({
  queue,
  last,
  log,
  onNext,
  onSkip,
  placeholder,
}: {
  queue: Line[];
  last: Line | null;
  log: Line[];
  onNext: () => void;
  onSkip: () => void;
  placeholder: string;
}) {
  const api = useRef({ done: true, finish: () => {} });
  const [showLog, setShowLog] = useState(false);
  const head = queue[0];
  const line = head ?? last;
  const click = () => {
    if (!head) return;
    if (!api.current.done) api.current.finish();
    else onNext();
  };
  return (
    <div className="relative mt-2">
      {line?.who && (
        <span className="absolute -top-3 left-3 z-10 rounded-md border border-[#6b2a24] bg-[#2a1312] px-2.5 py-0.5 text-[13px] font-bold text-[#f3c7b8]">
          {line.who}
        </span>
      )}
      <button
        onClick={click}
        className={`block min-h-[64px] w-full rounded-xl border-2 px-4 pt-3.5 pb-2.5 text-left text-[15px] leading-snug ${
          head ? "border-[#5a3a33] bg-[#16110f]" : "border-[#2a2626] bg-[#151316] text-[#bdb5aa]"
        }`}
        style={BATANG}
        aria-label="다음 대사"
      >
        {line ? head ? <Typer key={queue.length + head.text} text={head.text} api={api} /> : line.text : <span className="text-[#77716a]">{placeholder}</span>}
        {head && <span className="esc-blink float-right mt-1 text-[12px] text-[#c98b7c]">▼{queue.length > 1 ? ` ${queue.length - 1}` : ""}</span>}
      </button>
      <div className="mt-1 flex justify-end gap-2 text-[12px] text-[#8f8676]">
        {queue.length > 1 && (
          <button onClick={onSkip} className="rounded px-1.5 hover:text-[#e9e4d8]">
            ⏭ 넘기기
          </button>
        )}
        {log.length > 0 && (
          <button onClick={() => setShowLog((v) => !v)} className="rounded px-1.5 hover:text-[#e9e4d8]">
            📜 지난 대사 {showLog ? "닫기" : ""}
          </button>
        )}
      </div>
      {showLog && (
        <div className="mt-1 max-h-[220px] overflow-y-auto rounded-xl bg-[#121014] p-3 text-[14px] leading-relaxed" style={BATANG}>
          {log.slice(-40).map((l, i) => (
            <p key={i} className="py-0.5">
              {l.who && <b className="mr-1.5 text-[#f3c7b8]">{l.who}</b>}
              <span className={l.who ? "" : "text-[#a9a29a]"}>{l.text}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** 사건 노트: 질문 아래로 퍼즐 풀며 모은 사실 */
export function Notebook({ room, s }: { room: Room; s: State }) {
  const nb = room.notebook!;
  const got = nb.facts.filter((f) => f.got(s));
  return (
    <div className="rounded-xl border border-[#3a302a] bg-[#1a1614] p-3 text-[14px]" style={BATANG}>
      <p className="mb-2 flex items-center text-[13px] font-bold text-[#e3b7a6]">
        📒 사건 노트
        <span className="ml-auto font-mono text-[12px] text-[#a9a29a]">
          사실 {got.length}/{nb.facts.length}
        </span>
      </p>
      {nb.questions.map((q, qi) => {
        const fs = nb.facts.filter((f) => f.q === q.id);
        return (
          <div key={q.id} className="mb-3 last:mb-0">
            <p className="font-bold text-[#f0e6d6]">
              Q{qi + 1}. {q.q}
            </p>
            <ul className="mt-1 space-y-1 pl-1">
              {fs.map((f) =>
                f.got(s) ? (
                  <li key={f.id} className="leading-snug text-[#d8cfc2]">
                    · {f.text}
                  </li>
                ) : (
                  <li key={f.id} className="text-[#5f5852]">
                    · ………
                  </li>
                )
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** 그림을 다 받은 뒤 시작 (진행률 바) */
export function useAssets(list: string[] | undefined) {
  const [done, setDone] = useState(0);
  useEffect(() => {
    if (!list?.length) return;
    let alive = true;
    for (const src of list) {
      const im = new Image();
      im.onload = im.onerror = () => alive && setDone((d) => d + 1);
      im.src = src;
    }
    return () => {
      alive = false;
    };
  }, [list]);
  const total = list?.length ?? 0;
  return { ready: done >= total, pct: total ? Math.round((done / total) * 100) : 100 };
}

export function Loading({ pct, title }: { pct: number; title: string }) {
  return (
    <div className="mx-auto max-w-[520px] py-16 text-center text-[#e9e4d8]">
      <p className="text-[15px]">「{title}」 준비 중…</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#2a2626]">
        <div className="h-full bg-[#c0392b] transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 font-mono text-[12px] text-[#8f8676]">{pct}%</p>
    </div>
  );
}

const stars = (n: number, max = 5) => "★".repeat(n) + "☆".repeat(max - n);

/** 시작 전 스펙 카드 (예상 시간 · 난도 · 공포도) */
export function SpecCard({ room }: { room: Room }) {
  const c = room.card;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl border border-[#3a302a] bg-[#1a1614] px-4 py-2.5 text-[13px] text-[#d8cfc2]">
      <span>⏱ 예상 {c.time}</span>
      <span>🧩 난도 <b className="text-[#e9c46a]">{stars(c.level)}</b></span>
      <span>👁 공포도 <b className="text-[#e07a6a]">{stars(c.fear)}</b></span>
      {c.note && <span className="text-[#a9a29a]">{c.note}</span>}
      <span className="text-[#a9a29a]">힌트 3단계 무료</span>
    </div>
  );
}
