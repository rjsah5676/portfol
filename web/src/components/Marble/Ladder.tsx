"use client";

import { useEffect, useMemo, useState } from "react";
import { CHAR, faceOf } from "@/lib/marble/data";
import { trace } from "@/lib/marble/ladder";
import type { RoomWire } from "@/lib/marble/wire";
import { marble } from "@/realtime/marble";
import { sfx } from "./audio";
import { PCOLOR } from "./pixel";

/*
 * 시작 전 사다리 타기 — 사람 수만큼 위 칸이 뜨고, 하나씩 골라 내려가면 아래 칸 번호가 차례 (1P · 2P …).
 */

const W = 560;
const H = 250;
const DRAW_MS = 2400;

export default function Ladder({ room, me }: { room: RoomWire; me: string }) {
  const L = room.ladder!;
  const [skew] = useState(() => room.now - Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [drawn, setDrawn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);
  const revealing = L.revealUntil > 0;
  useEffect(() => {
    if (!revealing) return;
    sfx("card");
    // 다음 그림에서 선을 그리기 시작 (처음엔 0 길이)
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setDrawn(true)));
    const done = setTimeout(() => sfx("buy"), DRAW_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
  }, [revealing]);

  const n = L.cols;
  const gap = n > 1 ? W / n : W;
  const xOf = (c: number) => gap / 2 + c * gap;
  const yOf = (r: number) => (r < 0 ? 0 : r >= L.rows ? H : ((r + 1) * H) / (L.rows + 1));
  const paths = useMemo(
    () =>
      Array.from({ length: n }, (_, c) => {
        const t = trace(n, L.rows, L.rungs, c);
        const pts = t.path.map(([cc, r]) => [gap / 2 + cc * gap, r < 0 ? 0 : r >= L.rows ? H : ((r + 1) * H) / (L.rows + 1)] as const);
        let len = 0;
        for (let i = 1; i < pts.length; i++) len += Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
        return { end: t.end, d: pts.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" "), len };
      }),
    [n, L.rows, L.rungs, gap]
  );
  const mySeat = room.seats.findIndex((s) => s?.uid === me);
  const mine = L.picks.indexOf(mySeat);
  const left = Math.max(0, Math.ceil((L.deadline - (now + skew)) / 1000));
  const showResult = revealing && drawn && now + skew >= L.revealUntil - 4200 + DRAW_MS;
  const seatOf = (col: number) => (L.picks[col] >= 0 ? room.seats[L.picks[col]] : null);
  const face = (si: number) => {
    const c = room.seats[si] ? CHAR[room.seats[si]!.lo.char.id] : null;
    return c ? faceOf(c) : null;
  };

  const pick = (col: number) => {
    if (busy || revealing || mine >= 0 || L.picks[col] >= 0 || mySeat < 0) return;
    sfx("click");
    setBusy(true);
    void marble
      .ladder(room.id, col)
      .catch(() => sfx("deny"))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mbx absolute inset-0 z-[700] flex items-center justify-center bg-[rgba(10,8,30,0.62)] backdrop-blur-[3px]">
      <div className="mbx-modal mbx-pop flex w-[680px] flex-col items-center px-6 pt-5 pb-6">
        <div className="text-[11px] font-black tracking-[0.25em] text-[#ffe08a]">ORDER</div>
        <b className="text-[22px]">사다리로 차례 정하기</b>
        <p className="mt-0.5 text-[12.5px] text-white/65">
          {revealing ? "두구두구… 내려가 볼까요!" : mine >= 0 ? "다른 사람이 고르는 중이에요" : "위 칸 하나를 골라요 — 도착한 번호가 내 차례예요"}
          {!revealing && <b className="ml-2 text-[#ffe08a]">{left}초</b>}
        </p>

        {/* 위 칸 */}
        <div className="relative mt-4" style={{ width: W }}>
          <div className="flex">
            {Array.from({ length: n }, (_, c) => {
              const s = seatOf(c);
              const f = L.picks[c] >= 0 ? face(L.picks[c]) : null;
              const me1 = L.picks[c] === mySeat;
              const free = !s && !revealing && mine < 0;
              return (
                <div key={c} className="flex justify-center" style={{ width: gap }}>
                  <button
                    type="button"
                    disabled={!free}
                    onClick={() => pick(c)}
                    className={`relative flex h-[62px] w-[62px] items-center justify-center overflow-hidden rounded-2xl transition ${free ? "cursor-pointer hover:-translate-y-1 hover:scale-105" : ""}`}
                    style={{
                      background: s ? "#fff" : free ? "linear-gradient(180deg,#ffe48a,#ffb92e)" : "rgba(255,255,255,0.1)",
                      boxShadow: me1 ? "0 0 0 3px #ffe08a, 0 0 18px 4px rgba(255,224,138,0.6)" : s ? "0 0 0 2px rgba(255,255,255,0.7)" : free ? "0 4px 0 #b9741a, 0 0 0 2px #fff" : "inset 0 0 0 1.5px rgba(255,255,255,0.2)",
                    }}
                  >
                    {f ? <img src={f} alt="" className="mb-pop h-full w-full object-cover" /> : <b className={`text-[26px] ${free ? "text-[#5a3200]" : "text-white/40"}`}>?</b>}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex">
            {Array.from({ length: n }, (_, c) => {
              const s = seatOf(c);
              return (
                <div key={c} className="truncate px-1 text-center text-[11.5px] font-bold" style={{ width: gap, color: L.picks[c] === mySeat ? "#ffe08a" : "rgba(255,255,255,0.75)" }}>
                  {s ? (L.picks[c] === mySeat ? "나" : s.name) : " "}
                </div>
              );
            })}
          </div>

          {/* 사다리 */}
          <svg width={W} height={H} className="mt-1 block overflow-visible">
            {Array.from({ length: n }, (_, c) => (
              <line key={c} x1={xOf(c)} y1={0} x2={xOf(c)} y2={H} stroke="rgba(255,255,255,0.35)" strokeWidth={5} strokeLinecap="round" />
            ))}
            {/* 가로대는 공개 때 나타남 (고르는 동안엔 안 보여서 고르는 재미) */}
            {L.rungs.map(([r, c], i) => (
              <line key={i} x1={xOf(c)} y1={yOf(r)} x2={xOf(c + 1)} y2={yOf(r)} stroke="rgba(255,255,255,0.35)" strokeWidth={5} strokeLinecap="round" style={{ opacity: revealing ? 1 : 0, transition: "opacity 300ms" }} />
            ))}
            {!revealing && <rect x={0} y={H * 0.12} width={W} height={H * 0.76} rx={14} fill="rgba(30,24,90,0.85)" />}
            {!revealing && (
              <text x={W / 2} y={H / 2 + 6} textAnchor="middle" fontSize={18} fontWeight={900} fill="rgba(255,255,255,0.5)">
                ? ? ?
              </text>
            )}
            {revealing &&
              paths.map((p, c) => (
                <path
                  key={c}
                  d={p.d}
                  fill="none"
                  stroke={PCOLOR[p.end] ?? "#fff"}
                  strokeWidth={7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ strokeDasharray: p.len, strokeDashoffset: drawn ? 0 : p.len, transition: `stroke-dashoffset ${DRAW_MS}ms linear`, filter: `drop-shadow(0 0 4px ${PCOLOR[p.end]})` }}
                />
              ))}
          </svg>

          {/* 아래 칸: 차례 번호 */}
          <div className="mt-2 flex">
            {Array.from({ length: n }, (_, k) => {
              const col = paths.findIndex((p) => p.end === k);
              const si = col >= 0 ? L.picks[col] : -1;
              const f = showResult && si >= 0 ? face(si) : null;
              return (
                <div key={k} className="flex flex-col items-center gap-1" style={{ width: gap }}>
                  <span className="flex h-[38px] min-w-[54px] items-center justify-center gap-1 rounded-full px-2 text-[15px] font-black text-white" style={{ background: PCOLOR[k], boxShadow: `0 3px 0 rgba(0,0,0,0.3), 0 0 0 2px #fff${showResult && si === mySeat ? ", 0 0 16px 4px #ffe08a" : ""}` }}>
                    {f && <img src={f} alt="" className="mb-pop h-[28px] w-[28px] rounded-full object-cover" style={{ boxShadow: "0 0 0 2px #fff" }} />}
                    {k + 1}P
                  </span>
                  <span className="h-[14px] text-[11px] font-bold text-white/75">{showResult && si >= 0 ? (si === mySeat ? "나!" : room.seats[si]?.name) : `${k + 1}번째`}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
