"use client";

/**
 * 게임 안 BP 랭킹 창 — 타이틀의 RANKING 메뉴 (사이트 공통 랭킹 모달 대신 게임 화면 안에, 전체화면에서도 그대로).
 * 데이터는 RhythmGame 이 불러 둔 회원 BP 랭킹(getBpTop). 게임 머리말의 랭킹 버튼은 사이트 공통 창 그대로.
 */
import { useEffect, useRef } from "react";
import RankAvatar from "@/components/RankAvatar";
import type { BpRanking } from "@/firestore/rhythmRankings";
import { sfx } from "@/lib/rhythm/sfx";
import { bpChartLabel } from "./RankingBoard";

const DISP = "pru-t";
const KR = "";
const MEDAL = ["#F5C842", "#D6DCE6", "#E3955A"];

export default function RhythmRankModal({
  rows,
  me,
  onClose,
}: {
  /** null 이면 불러오는 중 */
  rows: BpRanking[] | null;
  /** 내 닉네임 (내 줄 강조) */
  me?: string;
  onClose: () => void;
}) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    sfx("ui-open", 0.7);
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.code === "Escape" || e.code === "Backspace") {
        e.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center pru-dither bg-[#0c0718]/60 [animation:modal-fade_180ms_steps(5)]"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative flex h-[46cqw] w-[62cqw] flex-col overflow-hidden pru-win [--wf:#150e29f5] [animation:modal-pop_220ms_steps(5)]">
        <div className="absolute top-0 left-[2cqw] h-[0.3cqw] w-[8cqw] bg-[#F5C842]" />
        <div className="flex items-end justify-between gap-[2cqw] px-[2.4cqw] pt-[1.8cqw]">
          <div>
            <div className={`${DISP} text-[2.6cqw] leading-none tracking-[0.08em] text-white`}>
              RANKING
            </div>
            <div className={`${KR} mt-[0.6cqw] text-[1.1cqw] text-white/55`}>
              BP — 곡마다 가장 좋은 판 하나, 상위 20곡 합 · 회원만
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="pru-btn cursor-pointer px-[1cqw] py-[0.3cqw] text-[1.05cqw] text-white"
          >
            닫기 (Esc)
          </button>
        </div>

        <div className="bd-scroll mx-[2.4cqw] mt-[1.4cqw] mb-[2cqw] min-h-0 flex-1 overflow-y-auto pr-[0.6cqw]">
          {rows === null ? (
            <p className={`${KR} py-[2cqw] text-center text-[1.2cqw] text-white/40`}>
              불러오는 중…
            </p>
          ) : rows.length === 0 ? (
            <p className={`${KR} py-[2cqw] text-center text-[1.2cqw] text-white/55`}>
              아직 BP 기록이 없어요. 회원으로 곡을 끝까지 치면 쌓여요.
            </p>
          ) : (
            <ol className="flex flex-col gap-[0.4cqw]">
              {rows.map((r, i) => {
                const mine = !!me && r.member && r.name === me;
                return (
                  <li
                    key={r.id}
                    className={`grid grid-cols-[3cqw_2.6cqw_minmax(0,1fr)_auto] items-center gap-[1cqw] rounded-[0.5cqw] border px-[1cqw] py-[0.5cqw] ${
                      mine
                        ? "border-[#F5C842]/70 bg-[#F5C842]/12"
                        : i < 3
                          ? "border-white/[0.12] bg-white/[0.06]"
                          : "border-white/[0.06] bg-white/[0.03]"
                    }`}
                  >
                    <span
                      className={`${DISP} text-right text-[1.6cqw] leading-none tabular-nums`}
                      style={{ color: MEDAL[i] ?? "rgba(255,255,255,0.45)" }}
                    >
                      {i + 1}
                    </span>
                    <span className="flex h-[2.6cqw] w-[2.6cqw] items-center justify-center overflow-hidden">
                      <RankAvatar avatar={r.avatar} name={r.name} guest={!r.member} size="sm" />
                    </span>
                    <span className="min-w-0">
                      <span className={`${KR} block truncate text-[1.3cqw] font-bold text-white`}>
                        {r.name}
                        {mine && <span className="ml-[0.6cqw] text-[1cqw] text-[#F5C842]">나</span>}
                      </span>
                      <span className={`${KR} block truncate text-[0.95cqw] text-white/45`}>
                        {r.songs}곡
                        {r.best ? ` · 최고 ${bpChartLabel(r.best.chart)} ${r.best.bp}` : ""}
                      </span>
                    </span>
                    <span className={`${DISP} text-right text-[1.6cqw] text-white tabular-nums`}>
                      {r.bp.toLocaleString("en-US")}
                      <span className="ml-[0.4cqw] text-[1cqw] text-white/50">BP</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
