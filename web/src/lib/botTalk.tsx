"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * AI 상대 대사 (체스·장기 공통).
 * 수가 오갈 때 상황(잡음·장군/체크·끝남 등)에 맞는 대사를 골라 말풍선으로 잠깐 보여줌.
 */
export type TalkEvent =
  | "greet"
  | "move" // 평범한 내 수 (가끔만)
  | "userCapture"
  | "userBigCapture"
  | "userCheck"
  | "aiCapture"
  | "aiCheck"
  | "undo"
  | "aiWin"
  | "aiLose"
  | "draw";

export type Lines = Partial<Record<TalkEvent, string[]>>;

const pick = (a: string[] | undefined) =>
  a?.length ? a[Math.floor(Math.random() * a.length)] : null;

/** 평범한 수에는 가끔만 말함 */
const MOVE_CHANCE = 0.35;

export function useBotTalk(lines: Lines) {
  const [speech, setSpeech] = useState<{ text: string; n: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const n = useRef(0);
  const linesRef = useRef(lines);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const say = useCallback((ev: TalkEvent, hold = 8000) => {
    if (ev === "move" && Math.random() > MOVE_CHANCE) return;
    const text = pick(linesRef.current[ev]);
    if (!text) return;
    if (timer.current) clearTimeout(timer.current);
    setSpeech({ text, n: ++n.current });
    timer.current = setTimeout(() => setSpeech(null), hold);
  }, []);

  return { speech, say };
}

/**
 * 상대 이름 아래에 뜨는 말풍선.
 * 판 위에 겹쳐 띄워서(높이 0인 자리) 말풍선이 생기고 사라져도 판이 밀리지 않게, 클릭은 통과.
 */
/**
 * AI 말풍선 (판을 가리지 않게). 넓은 화면은 이름 줄 오른쪽 빈자리에 겹쳐 띄우고,
 * 좁은 화면은 이름 줄 아래 높이 고정 한 줄에 둔다. 꼬리는 왼쪽(이름 쪽).
 */
export function SpeechBubble({ speech }: { speech: { text: string; n: number } | null }) {
  return (
    // 좁은 화면: 이름 줄 아래 한 줄(높이 고정 → 판이 안 밀림), 넓은 화면: 이름 줄 오른쪽 빈자리에 겹쳐서
    <div className="pointer-events-none z-20 flex h-10 items-start justify-end sm:absolute sm:inset-y-0 sm:right-0 sm:h-auto sm:w-[58%] sm:items-center">
      {speech && (
        <div
          key={speech.n}
          className="bot-speech line-clamp-2 w-fit max-w-full rounded-2xl rounded-tl-sm border border-white/15 bg-[#24262E] sm:rounded-tl-2xl sm:rounded-bl-sm px-3 py-1.5 font-['Nanum_Gothic',sans-serif] text-[12.5px] leading-snug break-keep text-white/90 shadow-xl"
        >
          {speech.text}
        </div>
      )}
    </div>
  );
}
