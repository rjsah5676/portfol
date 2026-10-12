/**
 * 튜토리얼 화면 — 게임 화면 위에 지금 단계 설명 · 진행 · 성공 표시, 설명 단계는 가운데 카드.
 * 진행 로직은 lib/fight/tutorial.ts (Tutorial), 판 위 연습 상대 · 성공 판정도 거기서.
 */
import type { ReactNode } from "react";
import { TUT_STEPS } from "@/lib/fight/tutorial";
import { KeyCap } from "./KeyCap";

const KR = "font-['Nanum_Gothic',sans-serif]";
const TITLE = "font-['Black_Han_Sans',sans-serif]";

export interface TutView {
  i: number;
  n: number;
  clear: boolean;
}

/** 묶음 순서 (위 진행 표시) */
const CHAPTERS = ["이동", "공격", "공중", "방어", "필살기", "실전"];

/** 글 속 키 이름을 키 모양으로: 단독 대문자 한 글자(J K L I W A S D N) · Space · Esc · Enter */
const KEY_RE = /(?<![A-Za-z.])(Space|Esc|Enter|[JKLIWASDN])(?![A-Za-z.])/g;
export function tutText(text: string): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(KEY_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    out.push(<KeyCap key={i} k={m[1]} />);
    last = i + m[1].length;
  }
  if (last === 0) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function TutorialOverlay({
  view,
  onNext,
  onSkip,
  onAi,
  onMenu,
}: {
  view: TutView;
  onNext: () => void;
  onSkip: () => void;
  onAi: () => void;
  onMenu: () => void;
}) {
  const st = TUT_STEPS[view.i];
  if (!st) return null;
  const need = st.need ?? 1;
  const chIdx = CHAPTERS.indexOf(st.ch);
  const last = view.i === TUT_STEPS.length - 1;
  // 묶음 안에서 몇 번째 단계인지
  const inCh = TUT_STEPS.filter((x) => x.ch === st.ch && !x.info);
  const pos = inCh.indexOf(st) + 1;

  if (st.info) {
    return (
      <div className={`absolute inset-0 z-20 flex items-center justify-center bg-black/55 ${KR}`}>
        <div className="w-[52cqw] rounded-[1.2cqw] border border-[#F2C35B]/50 bg-[linear-gradient(180deg,#221A33_0%,#120E1C_100%)] px-[3cqw] py-[2.4cqw] shadow-[0_0_4cqw_-1cqw_rgba(242,195,91,0.45)] [animation:modal-pop_220ms_ease-out]">
          <div className="mb-[0.4cqw] text-[1.1cqw] font-bold tracking-[0.2em] text-[#F2C35B]/80">
            {last ? "COMPLETE" : st.ch === "시작" ? "TUTORIAL" : "TIP"}
          </div>
          <h2 className={`${TITLE} mb-[1.2cqw] text-[3cqw] leading-none text-white`}>{st.title}</h2>
          <div className="flex flex-col gap-[0.8cqw]">
            {st.text.map((t, k) => (
              <p key={k} className="text-[1.45cqw] leading-relaxed break-keep text-white/80">
                {tutText(t)}
              </p>
            ))}
          </div>
          <div className="mt-[2cqw] flex justify-end gap-[1cqw]">
            {last ? (
              <>
                <button
                  type="button"
                  onClick={onMenu}
                  className="cursor-pointer rounded-full border border-white/25 px-[2.2cqw] py-[0.8cqw] text-[1.4cqw] font-bold text-white/80 hover:bg-white/10"
                >
                  메뉴로
                </button>
                <button
                  type="button"
                  onClick={onAi}
                  className="cursor-pointer rounded-full bg-[#FF8A3D] px-[2.4cqw] py-[0.8cqw] text-[1.4cqw] font-extrabold text-white hover:brightness-110"
                >
                  AI 대전 하러 가기 <KeyCap k="J" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onNext}
                className="cursor-pointer rounded-full bg-[#6C63FF] px-[2.4cqw] py-[0.8cqw] text-[1.4cqw] font-extrabold text-white hover:brightness-110"
              >
                계속 <KeyCap k="J" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* 위: 묶음 진행 + 지금 단계 설명 */}
      <div className={`pointer-events-none absolute top-[9.6cqw] left-1/2 z-10 flex w-[56cqw] -translate-x-1/2 flex-col items-center ${KR}`}>
        <div className="mb-[0.6cqw] flex items-center gap-[0.4cqw]">
          {CHAPTERS.map((c, k) => (
            <span
              key={c}
              className={`rounded-full px-[0.9cqw] py-[0.15cqw] text-[1cqw] font-bold ${
                k === chIdx ? "bg-[#F2C35B] text-black" : k < chIdx ? "bg-white/25 text-white/80" : "bg-black/50 text-white/35"
              }`}
            >
              {k < chIdx ? "✓ " : ""}
              {c}
            </span>
          ))}
        </div>
        <div
          key={view.i}
          className={`w-full rounded-[1cqw] border px-[1.8cqw] py-[1cqw] backdrop-blur-[2px] transition-colors [animation:modal-pop_200ms_ease-out] ${
            view.clear ? "border-[#4ADE80]/70 bg-[#0B2A18]/85" : "border-white/15 bg-black/65"
          }`}
        >
          <div className="mb-[0.4cqw] flex items-baseline gap-[0.8cqw]">
            <span className="text-[1.05cqw] font-bold text-[#F2C35B]/80">
              {st.ch} {pos}/{inCh.length}
            </span>
            <span className={`${TITLE} text-[2cqw] leading-none text-white`}>{st.title}</span>
            {need > 1 && (
              <span className="ml-auto flex items-center gap-[0.35cqw]">
                {Array.from({ length: need }, (_, k) => (
                  <span
                    key={k}
                    className={`h-[1cqw] w-[1cqw] rounded-full border border-white/40 ${k < view.n ? "bg-[#4ADE80]" : "bg-transparent"}`}
                  />
                ))}
              </span>
            )}
          </div>
          {st.text.map((t, k) => (
            <p key={k} className="text-[1.3cqw] leading-snug break-keep text-white/80">
              {tutText(t)}
            </p>
          ))}
        </div>
      </div>
      {/* 성공 */}
      {view.clear && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span
            className={`${TITLE} text-[6cqw] text-[#4ADE80] [animation:modal-pop_250ms_ease-out] [text-shadow:0_0.3cqw_0_#0B2A18,0_0_2cqw_rgba(74,222,128,0.6)]`}
          >
            CLEAR!
          </span>
        </div>
      )}
      {/* 건너뛰기 */}
      <button
        type="button"
        onClick={onSkip}
        className={`absolute top-[9.6cqw] right-[1.6cqw] z-10 cursor-pointer rounded-full bg-black/55 px-[1.2cqw] py-[0.35cqw] text-[1.1cqw] font-bold text-white/70 hover:bg-black/75 hover:text-white ${KR}`}
      >
        건너뛰기 <KeyCap k="N" />
      </button>
    </>
  );
}
