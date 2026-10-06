"use client";

import { useEffect, useRef, useState } from "react";
import { rand, randInt } from "@/lib/random";
import "@/css/tools.css";

interface Item {
  name: string;
  /** 칸 크기·당첨 확률 비율 (1 이상 정수) */
  weight: number;
}

const MIN = 2;
const MAX = 30;
const MAX_WEIGHT = 1_000_000;
const SPIN_MS = 5200;
const STORAGE_KEY = "tools_roulette_v2";
const DEFAULT_ITEMS: Item[] = [1, 2, 3, 4].map((i) => ({ name: `참가자 ${i}`, weight: 1 }));

// 칸 색 (밝은 색은 글자를 어둡게)
const SLICE = [
  { bg: "#6C63FF", fg: "#fff" },
  { bg: "#F4E6A6", fg: "#2b2833" },
  { bg: "#2EC4B6", fg: "#0f2b28" },
  { bg: "#F3CCD9", fg: "#2b2833" },
  { bg: "#EF476F", fg: "#fff" },
  { bg: "#C8DDF3", fg: "#2b2833" },
  { bg: "#F4A261", fg: "#2b2833" },
  { bg: "#C3E7D3", fg: "#2b2833" },
];

const btn =
  "cursor-pointer rounded-full border border-white/15 px-4 py-2 font-mono text-xs whitespace-nowrap text-white/75 transition-colors hover:border-[#6C63FF]/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-30";
const primaryBtn =
  "cursor-pointer rounded-full bg-[#6C63FF] px-6 py-2.5 font-mono text-sm whitespace-nowrap text-white transition-colors hover:bg-[#5b52f0] disabled:cursor-not-allowed disabled:opacity-40";

// 숫자 입력칸의 위아래 화살표(스피너) 숨김
const noSpin =
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

const R = 96; // viewBox 200 기준 반지름
const polar = (deg: number, r: number) => {
  // 0도 = 12시 방향, 시계방향
  const rad = ((deg - 90) * Math.PI) / 180;
  return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)] as const;
};

function slicePath(a0: number, a1: number) {
  if (a1 - a0 >= 359.999) return `M100 ${100 - R} A${R} ${R} 0 1 1 99.99 ${100 - R} Z`;
  const [x1, y1] = polar(a0, R);
  const [x2, y2] = polar(a1, R);
  return `M100 100 L${x1} ${y1} A${R} ${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x2} ${y2} Z`;
}

const short = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s);
const clampWeight = (v: number) => Math.min(MAX_WEIGHT, Math.max(1, Math.round(v) || 1));

// 칸 색: 이웃·첫칸과 같은 색이 붙지 않게
const colorOf = (i: number, n: number) => {
  const k = i % SLICE.length;
  return i === n - 1 && k === 0 && n > 1 ? SLICE[3] : SLICE[k];
};

/** "이름", "이름:300", "이름*300" 형식을 쉼표·줄바꿈으로 여러 개 */
function parseItems(text: string, defaultWeight: number): Item[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^(.*?)\s*[:*]\s*(\d+)$/.exec(s);
      return m && m[1]
        ? { name: m[1].trim(), weight: clampWeight(Number(m[2])) }
        : { name: s, weight: defaultWeight };
    });
}

const pct = (w: number, total: number) => {
  const p = (w / total) * 100;
  return p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p.toFixed(2);
};

export default function Roulette() {
  const [items, setItems] = useState<Item[]>(DEFAULT_ITEMS);
  const [text, setText] = useState("");
  const [newWeight, setNewWeight] = useState("1");
  // 가중치 입력 중인 값 (지우고 새로 칠 때 바로 1로 바뀌지 않게, 입력칸 벗어날 때 확정)
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<number | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const pendingWinner = useRef<number | null>(null);

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (Array.isArray(saved) && saved.length >= MIN)
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 항목 복원(마운트 1회)
        setItems(
          saved
            .slice(0, MAX)
            .map((it: Item) => ({ name: String(it.name), weight: clampWeight(Number(it.weight)) }))
        );
    } catch {}
    // 저장된 값을 불러온 뒤부터 저장 (개발 모드에서 effect가 두 번 돌 때 기본값이 덮어쓰는 것 방지)
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {}
  }, [hydrated, items]);

  const n = items.length;
  const total = items.reduce((s, it) => s + it.weight, 0);
  // 각 칸의 시작·끝 각도 (가중치 비율)
  const bounds: [number, number][] = [];
  items.reduce((acc, it) => {
    const next = acc + (it.weight / total) * 360;
    bounds.push([acc, next]);
    return next;
  }, 0);
  const canSpin = n >= MIN && !spinning;
  const equal = items.every((it) => it.weight === items[0].weight);

  const add = () => {
    const list = parseItems(text, clampWeight(Number(newWeight)));
    if (!list.length) return;
    setItems((prev) => [...prev, ...list].slice(0, MAX));
    setText("");
    setWinner(null);
  };
  const remove = (i: number) => {
    setDrafts({});
    setItems((prev) => prev.filter((_, k) => k !== i));
    setWinner(null);
  };
  const setWeight = (i: number, w: number) => {
    setItems((prev) => prev.map((it, k) => (k === i ? { ...it, weight: clampWeight(w) } : it)));
    setWinner(null);
  };

  const spin = () => {
    if (!canSpin) return;
    // 가중치 비율대로 당첨을 먼저 뽑고, 그 칸 안의 임의 지점이 12시에 오도록 회전량 계산
    let r = randInt(total);
    let w = 0;
    while (r >= items[w].weight) r -= items[w++].weight;
    const [a0, a1] = bounds[w];
    const target = a0 + (a1 - a0) * (0.15 + rand() * 0.7); // 칸 경계에 걸리지 않게 가운데 70% 안
    const current = ((rotation % 360) + 360) % 360;
    const delta = (((360 - target - current) % 360) + 360) % 360;
    pendingWinner.current = w;
    setWinner(null);
    setSpinning(true);
    setRotation(rotation + 360 * 7 + delta);
  };

  const onSpinEnd = (e: React.TransitionEvent<SVGSVGElement>) => {
    // 칸들의 opacity 전환(당첨 강조 해제) 이벤트도 여기까지 올라오므로 휠 자체 회전 끝만 처리.
    // (안 거르면 두 번째 판부터 0.3초 만에 "멈춤" 처리돼 회전이 확 빨라 보였음)
    if (e.target !== e.currentTarget || e.propertyName !== "transform") return;
    if (!spinning) return;
    setSpinning(false);
    const w = pendingWinner.current;
    if (w === null) return;
    setWinner(w);
    setHistory((h) => [items[w].name, ...h].slice(0, 10));
  };

  const maxChars = n <= 6 ? 8 : n <= 12 ? 7 : 6;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      {/* 룰렛 */}
      <div className="flex flex-col items-center">
        <div className="relative w-full max-w-[440px]">
          {/* 12시 방향 바늘 */}
          <div className="absolute top-[-6px] left-1/2 z-10 -translate-x-1/2 drop-shadow-[0_2px_3px_rgba(0,0,0,.6)]">
            <svg width="30" height="34" viewBox="0 0 30 34" aria-hidden>
              <path d="M15 34 L2 6 Q0 0 7 0 L23 0 Q30 0 28 6 Z" fill="#fff" />
            </svg>
          </div>

          <div className="aspect-square w-full rounded-full p-2 shadow-[0_20px_50px_-15px_rgba(0,0,0,.8)] [background:radial-gradient(circle,#2a2d36,#1C1E24)]">
            <svg
              viewBox="0 0 200 200"
              className="h-full w-full"
              style={{
                transform: `rotate(${rotation}deg)`,
                transition: spinning
                  ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.72, 0.08, 1)`
                  : "none",
              }}
              onTransitionEnd={onSpinEnd}
              aria-label="룰렛"
            >
              {items.map((item, i) => {
                const c = colorOf(i, n);
                const [a0, a1] = bounds[i];
                const size = a1 - a0;
                const mid = (a0 + a1) / 2;
                const [tx, ty] = polar(mid, R * 0.6);
                const hit = winner === i;
                // 칸이 좁을수록 글자를 작게, 너무 좁으면 생략 (목록에서 확인 가능)
                const fontSize = Math.min(10, Math.max(4.5, size * 0.28));
                return (
                  <g key={i}>
                    <path
                      d={slicePath(a0, a1)}
                      fill={c.bg}
                      stroke="#15171c"
                      strokeWidth={n > 1 ? 0.8 : 0}
                      opacity={winner === null || hit ? 1 : 0.35}
                      style={{ transition: "opacity .3s" }}
                    />
                    {size >= 7 && (
                      <text
                        x={tx}
                        y={ty}
                        fill={c.fg}
                        fontSize={fontSize}
                        fontWeight={700}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        transform={`rotate(${mid} ${tx} ${ty})`}
                        style={{ fontFamily: "'Nanum Gothic', sans-serif" }}
                      >
                        {short(item.name, maxChars)}
                      </text>
                    )}
                  </g>
                );
              })}
              <circle
                cx="100"
                cy="100"
                r={R}
                fill="none"
                stroke="rgba(255,255,255,.12)"
                strokeWidth={1.5}
              />
            </svg>
          </div>

          {/* 가운데 돌리기 버튼 */}
          <button
            type="button"
            onClick={spin}
            disabled={!canSpin}
            className="absolute top-1/2 left-1/2 flex h-[22%] w-[22%] -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-4 border-[#1C1E24] bg-white font-mono text-xs font-bold text-[#2b2833] shadow-lg transition-transform hover:scale-105 disabled:cursor-not-allowed sm:text-sm"
          >
            {spinning ? "…" : "START"}
          </button>
        </div>

        <div className="mt-6 flex min-h-[72px] flex-col items-center justify-center text-center">
          {winner !== null ? (
            <div className="roulette-pop">
              <div className="font-mono text-xs text-[#8B84FF]">당첨</div>
              <div className="mt-1 font-['Nanum_Gothic',sans-serif] text-3xl font-bold break-all text-white">
                {items[winner].name}
              </div>
            </div>
          ) : (
            <p className="font-['Nanum_Gothic',sans-serif] text-sm text-white/40">
              {spinning
                ? "두구두구…"
                : n < MIN
                  ? "항목을 2개 이상 넣어주세요"
                  : "START를 눌러 돌려보세요"}
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button type="button" className={primaryBtn} onClick={spin} disabled={!canSpin}>
            {winner !== null ? "다시 돌리기" : "돌리기"}
          </button>
          {winner !== null && (
            <button
              type="button"
              className={btn}
              onClick={() => remove(winner)}
              disabled={spinning || n <= MIN}
            >
              당첨 항목 빼고 다시
            </button>
          )}
        </div>
      </div>

      {/* 항목 편집 */}
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-white/10 bg-[#1C1E24] p-4">
          <div className="mb-3 flex items-center justify-between font-mono text-xs text-white/45">
            <span>
              항목 {n}/{MAX}
            </span>
            <span className="flex gap-3">
              {!equal && (
                <button
                  type="button"
                  disabled={spinning}
                  onClick={() => {
                    setItems((prev) => prev.map((it) => ({ ...it, weight: 1 })));
                    setWinner(null);
                  }}
                  className="cursor-pointer text-white/35 hover:text-white disabled:opacity-30"
                >
                  가중치 균등
                </button>
              )}
              <button
                type="button"
                disabled={spinning}
                onClick={() => {
                  setItems(DEFAULT_ITEMS);
                  setWinner(null);
                }}
                className="cursor-pointer text-white/35 hover:text-white disabled:opacity-30"
              >
                초기화
              </button>
            </span>
          </div>

          <div className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && add()}
              disabled={spinning || n >= MAX}
              placeholder="이름 (쉼표로 여러 개)"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#15171c] px-3 py-2 font-['Nanum_Gothic',sans-serif] text-sm text-white placeholder:text-white/25 focus:border-[#6C63FF]/60 focus:outline-none"
            />
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_WEIGHT}
              value={newWeight}
              onChange={(e) => setNewWeight(e.target.value)}
              onBlur={() => setNewWeight(String(clampWeight(Number(newWeight))))}
              disabled={spinning}
              aria-label="추가할 항목의 가중치"
              title="가중치"
              className={`w-20 rounded-lg border border-white/10 bg-[#15171c] px-2 py-2 text-center font-mono text-sm text-white focus:border-[#6C63FF]/60 focus:outline-none ${noSpin}`}
            />
            <button
              type="button"
              className={btn}
              onClick={add}
              disabled={spinning || !text.trim() || n >= MAX}
            >
              추가
            </button>
          </div>
          <p className="mt-1.5 font-mono text-[10px] text-white/30">
            오른쪽 숫자가 가중치 · &quot;이름:300&quot;처럼 한 번에 넣어도 돼요
          </p>

          <ul className="mt-3 flex flex-col gap-1">
            {items.map((item, i) => (
              <li
                key={`${item.name}-${i}`}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${winner === i ? "bg-white/10" : ""}`}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-sm"
                  style={{ background: colorOf(i, n).bg }}
                />
                <span className="min-w-0 flex-1 truncate font-['Nanum_Gothic',sans-serif] text-sm text-white/85">
                  {item.name}
                </span>
                <span className="w-12 shrink-0 text-right font-mono text-[11px] text-white/35">
                  {pct(item.weight, total)}%
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_WEIGHT}
                  value={drafts[i] ?? item.weight}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDrafts((d) => ({ ...d, [i]: v }));
                    if (Number(v) >= 1) setWeight(i, Number(v));
                  }}
                  onBlur={() =>
                    setDrafts((d) => {
                      const rest = { ...d };
                      delete rest[i];
                      return rest;
                    })
                  }
                  disabled={spinning}
                  aria-label={`${item.name} 가중치`}
                  className={`w-20 shrink-0 rounded-md border border-white/10 bg-[#15171c] px-2 py-1 text-center font-mono text-xs text-white focus:border-[#6C63FF]/60 focus:outline-none ${noSpin}`}
                />
                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={spinning}
                  aria-label={`${item.name} 삭제`}
                  className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-xs text-white/40 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>

        {history.length > 0 && (
          <div className="rounded-xl border border-white/10 bg-[#1C1E24] p-4">
            <div className="mb-2 font-mono text-xs text-white/45">최근 결과</div>
            <ol className="flex flex-col gap-1 font-['Nanum_Gothic',sans-serif] text-sm">
              {history.map((h, k) => (
                <li key={k} className="flex gap-2 text-white/70">
                  <span className="w-5 font-mono text-xs text-white/30">{k + 1}</span>
                  <span className="truncate">{h}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
