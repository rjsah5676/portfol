"use client";

import { useState, type ReactNode } from "react";

/* 방탈출 확대 장면에서 쓰는 조각들: 종이 문서 · 다이얼 자물쇠 · 키패드 */

export function Paper({ children, tone = "white", tilt = 0 }: { children: ReactNode; tone?: "white" | "yellow" | "kraft"; tilt?: number }) {
  const bg = tone === "yellow" ? "#f3e7b0" : tone === "kraft" ? "#e3d3b0" : "#efe9dc";
  return (
    <div
      className="mx-auto max-w-[460px] rounded-[3px] px-4 py-3 text-[14px] leading-relaxed text-[#2a2620] shadow-[0_6px_18px_rgba(0,0,0,.45)]"
      style={{ background: bg, transform: tilt ? `rotate(${tilt}deg)` : undefined, fontFamily: "'Gowun Batang', serif" }}
    >
      {children}
    </div>
  );
}

/** 숫자 다이얼 자물쇠 (위아래로 돌림) */
export function DialLock({ length, onTry, note }: { length: number; onTry: (code: string) => boolean; note?: ReactNode }) {
  const [d, setD] = useState<number[]>(Array(length).fill(0));
  const [bad, setBad] = useState(false);
  const turn = (i: number, k: number) => {
    setBad(false);
    setD((v) => v.map((x, j) => (j === i ? (x + k + 10) % 10 : x)));
  };
  return (
    <div className="flex flex-col items-center gap-3">
      {note}
      <div className={`flex gap-1.5 rounded-xl bg-[#c9a227] p-2.5 shadow-inner ${bad ? "esc-shake" : ""}`}>
        {d.map((x, i) => (
          <div key={i} className="flex flex-col items-center">
            <button onClick={() => turn(i, 1)} className="h-7 w-11 rounded-t-md bg-[#2b2a30] text-[#ddd] active:bg-[#444]" aria-label="올리기">
              ▲
            </button>
            <div className="grid h-12 w-11 place-items-center bg-[#f1ede2] font-mono text-[26px] font-bold text-[#222]">{x}</div>
            <button onClick={() => turn(i, -1)} className="h-7 w-11 rounded-b-md bg-[#2b2a30] text-[#ddd] active:bg-[#444]" aria-label="내리기">
              ▼
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => {
          if (!onTry(d.join(""))) setBad(true);
        }}
        className="rounded-lg bg-[#e9c46a] px-5 py-2 font-bold text-[#1d1a12]"
      >
        당겨 보기
      </button>
      {bad && <p className="text-[13px] text-[#ff9b8f]">덜컥. 안 열린다.</p>}
    </div>
  );
}

/** 숫자 키패드 (worn = UV 로 비추면 빛나는 닳은 숫자) */
export function Keypad({ length, onTry, worn }: { length: number; onTry: (code: string) => boolean; worn?: string[] }) {
  const [v, setV] = useState("");
  const [bad, setBad] = useState(false);
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
  const press = (k: string) => {
    setBad(false);
    if (k === "*") return setV("");
    if (k === "#") {
      if (v.length === length && !onTry(v)) {
        setBad(true);
        setV("");
      }
      return;
    }
    setV((x) => (x.length < length ? x + k : x));
  };
  return (
    <div className={`mx-auto w-[220px] rounded-2xl bg-[#25272d] p-3 shadow-[0_6px_18px_rgba(0,0,0,.5)] ${bad ? "esc-shake" : ""}`}>
      <div className="mb-2 h-10 rounded-md bg-[#0f1a14] px-3 text-right font-mono text-[24px] leading-10 tracking-[8px] text-[#7dffb0]">
        {v.padEnd(length, "·")}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {keys.map((k) => {
          const glow = worn?.includes(k);
          return (
            <button
              key={k}
              onClick={() => press(k)}
              className="h-12 rounded-md bg-[#3a3d45] font-mono text-[20px] font-bold text-[#cfd3da] active:bg-[#555]"
              style={glow ? { boxShadow: "0 0 10px 2px #b78bff, inset 0 0 8px #b78bff", color: "#e8d9ff" } : undefined}
            >
              {k}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[11px] text-[#8b8f98]">* 지우기 · # 확인</p>
      {bad && <p className="mt-1 text-center text-[13px] text-[#ff9b8f]">삐— 틀렸다.</p>}
    </div>
  );
}
