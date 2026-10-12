/**
 * 연습 모드 프레임 데이터 판 (왼쪽, 접기 가능 · 펼침 상태 기억) — 철권 연습 모드처럼
 * 지금 기술: 발생 · 지속 · 회복 · 결과 · 이득 / 최근 기술 5개 / 콤보 / 허수아비 가드 설정.
 * 재는 건 lib/fight/framedata.ts (FrameMeter).
 */
import { useState } from "react";
import type { FrameView, MoveRec, Outcome } from "@/lib/fight/framedata";

const KR = "font-['Nanum_Gothic',sans-serif]";
const MONO = "font-['JetBrains_Mono',monospace]";
const KEY = "fight:frameData";

export type DummyGuard = "none" | "all" | "after";
export const GUARD_LABEL: Record<DummyGuard, string> = { none: "안 막음", all: "전부 막음", after: "첫 타 뒤 막음" };

const OUT: Record<Outcome, [string, string]> = {
  hit: ["히트", "#4ADE80"],
  counter: ["카운터", "#FB923C"],
  block: ["가드", "#60A5FA"],
  just: ["저스트", "#67E8F9"],
  whiff: ["헛침", "#9CA3AF"],
  throw: ["잡기", "#C084FC"],
};

const advColor = (n: number) => (n > 0 ? "#4ADE80" : n < 0 ? "#F87171" : "#E5E7EB");
const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** 이득 칸 글자 */
function advText(m: MoveRec): [string, string] {
  if (m.note === "combo") return ["이어짐", "#FDE047"];
  if (m.note === "chain") return ["연속", "#93C5FD"];
  if (m.note === "down") return ["다운", "#FDE047"];
  if (m.outcome === "whiff" || !m.outcome) return ["—", "#6B7280"];
  if (m.adv === null) return [m.note === "launch" ? "띄움" : "…", "#FDE047"];
  return [`${sign(m.adv)}F${m.note === "launch" ? " 띄움" : ""}`, advColor(m.adv)];
}

function Cell({ k, v, unit = "F" }: { k: string; v: number | string; unit?: string }) {
  return (
    <div className="flex flex-col items-center rounded-[0.35cqw] bg-white/[0.06] px-[0.4cqw] py-[0.3cqw]">
      <span className="text-[0.8cqw] text-white/45">{k}</span>
      <span className={`${MONO} text-[1.3cqw] font-bold text-white`}>
        {v}
        {typeof v === "number" && <span className="text-[0.8cqw] text-white/40">{unit}</span>}
      </span>
    </div>
  );
}

export default function FrameData({
  view,
  guard,
  onGuard,
}: {
  view: FrameView;
  guard: DummyGuard;
  onGuard: (g: DummyGuard) => void;
}) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== "0";
    } catch {
      return true;
    }
  });
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(KEY, o ? "0" : "1");
      } catch {}
      return !o;
    });
  const m = view.last;
  const [at, ac] = m ? advText(m) : ["—", "#6B7280"];
  const live = view.combo.hits > 0 ? view.combo : view.lastCombo;
  return (
    <div className={`absolute top-[11cqw] left-[1.6cqw] z-10 w-[22cqw] ${KR}`}>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full cursor-pointer items-center justify-between rounded-t-[0.6cqw] bg-black/70 px-[0.9cqw] py-[0.35cqw] text-[1cqw] font-bold text-[#FFC86B] hover:bg-black/80"
      >
        <span>
          프레임 데이터 <span className="font-normal text-white/40">(1·2·3 허수아비 가드)</span>
        </span>
        <span className="text-white/60">{open ? "▾" : "▸"}</span>
      </button>
      {!open ? (
        <div className="rounded-b-[0.6cqw] bg-black/55 px-[0.9cqw] py-[0.35cqw] text-[1cqw] text-white/75">
          {m ? (
            <>
              {m.name} · 발생 <b className={MONO}>{m.startup}F</b> ·{" "}
              <b className={MONO} style={{ color: ac }}>
                {at}
              </b>
            </>
          ) : (
            "기술을 써 보세요"
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-[0.6cqw] rounded-b-[0.6cqw] bg-black/62 px-[0.9cqw] pt-[0.5cqw] pb-[0.7cqw] backdrop-blur-[2px]">
          {/* 지금 기술 */}
          {m ? (
            <div>
              <div className="mb-[0.35cqw] flex items-center gap-[0.5cqw]">
                <span className="min-w-0 flex-1 truncate text-[1.3cqw] font-extrabold text-white">{m.name}</span>
                {m.outcome && (
                  <span
                    className="rounded-[0.3cqw] px-[0.45cqw] text-[0.9cqw] font-bold text-black"
                    style={{ background: OUT[m.outcome][1] }}
                  >
                    {OUT[m.outcome][0]}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-4 gap-[0.35cqw]">
                <Cell k="발생" v={m.startup} />
                <Cell k="지속" v={m.active} />
                <Cell k="회복" v={m.recovery} />
                <Cell k="피해" v={m.dmg || "—"} />
              </div>
              <div className="mt-[0.4cqw] flex items-baseline justify-between rounded-[0.35cqw] bg-white/[0.06] px-[0.7cqw] py-[0.3cqw]">
                <span className="text-[0.9cqw] text-white/55">프레임 이득</span>
                <span className={`${MONO} text-[1.6cqw] font-extrabold`} style={{ color: ac }}>
                  {at}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-[1cqw] text-white/50">기술을 쓰면 발생 · 이득이 나와요</p>
          )}
          {/* 최근 기술 */}
          {view.history.length > 1 && (
            <div className="border-t border-white/10 pt-[0.4cqw]">
              <div className="mb-[0.2cqw] grid grid-cols-[1fr_2.8cqw_3.4cqw_4.4cqw] text-[0.8cqw] text-white/35">
                <span>최근</span>
                <span className="text-right">발생</span>
                <span className="text-right">결과</span>
                <span className="text-right">이득</span>
              </div>
              {view.history.slice(1, 6).map((h, i) => {
                const [t, c] = advText(h);
                return (
                  <div key={i} className="grid grid-cols-[1fr_2.8cqw_3.4cqw_4.4cqw] text-[0.95cqw] leading-[1.6] text-white/70">
                    <span className="truncate">{h.name}</span>
                    <span className={`${MONO} text-right`}>{h.startup}</span>
                    <span className="text-right" style={{ color: h.outcome ? OUT[h.outcome][1] : undefined }}>
                      {h.outcome ? OUT[h.outcome][0] : "…"}
                    </span>
                    <span className={`${MONO} text-right`} style={{ color: c }}>
                      {t}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {/* 콤보 */}
          <div className="grid grid-cols-3 gap-[0.35cqw] border-t border-white/10 pt-[0.5cqw]">
            <Cell k={view.combo.hits > 0 ? "콤보" : "마지막 콤보"} v={live.hits} unit="히트" />
            <Cell k="콤보 피해" v={live.dmg} unit="" />
            <Cell k="최고 피해" v={view.best} unit="" />
          </div>
          {/* 허수아비 가드 */}
          <div className="flex items-center gap-[0.35cqw] border-t border-white/10 pt-[0.5cqw]">
            <span className="shrink-0 text-[0.85cqw] text-white/45">허수아비</span>
            {(Object.keys(GUARD_LABEL) as DummyGuard[]).map((g, i) => (
              <button
                key={g}
                type="button"
                onClick={() => onGuard(g)}
                className={`flex-1 cursor-pointer rounded-full px-[0.3cqw] py-[0.2cqw] text-[0.85cqw] font-bold whitespace-nowrap ${
                  guard === g ? "bg-[#FFC86B] text-black" : "bg-white/10 text-white/65 hover:bg-white/20"
                }`}
              >
                {i + 1} {GUARD_LABEL[g]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
