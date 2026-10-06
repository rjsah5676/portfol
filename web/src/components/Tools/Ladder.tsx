"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { rand, randInt, shuffle, splitItems } from "@/lib/random";
import "@/css/tools.css";

type Preset = "one" | "order" | "custom";

const MIN = 2;
const MAX = 10;
const ROW_H = 30;
const STORAGE_KEY = "tools_ladder";
// 참가자별 경로 색
const COLORS = [
  "#8B84FF",
  "#F4A261",
  "#2EC4B6",
  "#EF476F",
  "#FFD166",
  "#06D6A0",
  "#C77DFF",
  "#4CC9F0",
  "#90BE6D",
  "#FF8FAB",
];

const btn =
  "cursor-pointer rounded-full border border-white/15 px-4 py-2 font-mono text-xs whitespace-nowrap text-white/75 transition-colors hover:border-[#6C63FF]/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-30";
const primaryBtn =
  "cursor-pointer rounded-full bg-[#6C63FF] px-5 py-2 font-mono text-sm whitespace-nowrap text-white transition-colors hover:bg-[#5b52f0] disabled:cursor-not-allowed disabled:opacity-40";
const input =
  "w-full min-w-0 rounded-lg border border-white/10 bg-[#15171c] px-3 py-2 font-['Nanum_Gothic',sans-serif] text-sm text-white placeholder:text-white/25 focus:border-[#6C63FF]/60 focus:outline-none";

const defaultNames = (n: number) => Array.from({ length: n }, (_, i) => `참가자 ${i + 1}`);

function presetResults(p: Preset, n: number, prev: string[]): string[] {
  if (p === "one") {
    const win = randInt(n);
    return Array.from({ length: n }, (_, i) => (i === win ? "당첨" : "꽝"));
  }
  if (p === "order") return Array.from({ length: n }, (_, i) => `${i + 1}번`);
  return Array.from({ length: n }, (_, i) => prev[i] ?? "");
}

/**
 * 가로줄 생성. rungs[r][c] = r번째 줄에서 c↔c+1 연결.
 * 같은 줄에서 이웃한 가로줄이 붙지 않게 하고, 모든 이웃 세로줄 사이에 최소 1개는 보장.
 * y는 줄 안에서 살짝 흔들어서 손으로 그린 느낌 (같은 줄 가로줄끼리는 세로줄을 공유하지 않아 순서가 안 꼬임)
 */
function makeRungs(n: number, rows: number) {
  const rungs: (number | null)[][] = Array.from({ length: rows }, () => Array(n - 1).fill(null));
  const put = (r: number, c: number) => (rungs[r][c] = (rand() - 0.5) * 0.55);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < n - 1; c++) {
      if (c > 0 && rungs[r][c - 1] !== null) continue;
      if (rand() < 0.42) put(r, c);
    }
  for (let c = 0; c < n - 1; c++) {
    if (rungs.some((row) => row[c] !== null)) continue;
    const free = rungs
      .map((row, r) => r)
      .filter(
        (r) => (c === 0 || rungs[r][c - 1] === null) && (c === n - 2 || rungs[r][c + 1] === null)
      );
    const r = free.length ? free[randInt(free.length)] : randInt(rows);
    if (c > 0) rungs[r][c - 1] = null;
    if (c < n - 2) rungs[r][c + 1] = null;
    put(r, c);
  }
  return rungs;
}

/** 출발 세로줄 → 도착 세로줄, 지나는 점들 */
function trace(start: number, rungs: (number | null)[][]) {
  let col = start;
  const steps: { row: number; from: number; to: number; jitter: number }[] = [];
  rungs.forEach((row, r) => {
    if (col < row.length && row[col] !== null) {
      steps.push({ row: r, from: col, to: col + 1, jitter: row[col]! });
      col++;
    } else if (col > 0 && row[col - 1] !== null) {
      steps.push({ row: r, from: col, to: col - 1, jitter: row[col - 1]! });
      col--;
    }
  });
  return { end: col, steps };
}

interface Saved {
  names: string[];
  results: string[];
  preset: Preset;
}

export default function Ladder() {
  const [names, setNames] = useState<string[]>(defaultNames(4));
  const [preset, setPreset] = useState<Preset>("one");
  const [results, setResults] = useState<string[]>(() => presetResults("one", 4, []));
  const [bulk, setBulk] = useState("");

  const [phase, setPhase] = useState<"setup" | "play">("setup");
  const [hide, setHide] = useState(true);
  const [rungs, setRungs] = useState<(number | null)[][]>([]);
  // 사다리 아래에 실제로 놓인 결과 (설정 입력값을 섞은 것)
  const [slots, setSlots] = useState<string[]>([]);
  // 타기 시작한 출발 번호(+출발 지연). revealed는 애니메이션이 끝나 결과가 공개된 번호
  const [tracedList, setTracedList] = useState<{ i: number; delay: number }[]>([]);
  const traced = tracedList.map((t) => t.i);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const n = names.length;
  const rows = Math.max(10, n + 6);
  const height = rows * ROW_H + 24;

  // 마지막 설정 복원
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Saved | null;
      if (s && Array.isArray(s.names) && s.names.length >= MIN && s.names.length <= MAX) {
        /* eslint-disable react-hooks/set-state-in-effect -- 저장된 설정 복원(마운트 1회) */
        setNames(s.names);
        setPreset(s.preset);
        setResults(s.preset === "custom" ? s.results : presetResults(s.preset, s.names.length, []));
        /* eslint-enable react-hooks/set-state-in-effect */
      }
    } catch {}
    // 저장된 값을 불러온 뒤부터 저장 (개발 모드에서 effect가 두 번 돌 때 기본값이 덮어쓰는 것 방지)
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ names, results, preset } satisfies Saved));
    } catch {}
  }, [hydrated, names, results, preset]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase]);

  const setCount = (next: number) => {
    const k = Math.min(MAX, Math.max(MIN, next));
    setNames((prev) => Array.from({ length: k }, (_, i) => prev[i] ?? `참가자 ${i + 1}`));
    setResults((prev) => presetResults(preset, k, prev));
  };

  const applyPreset = (p: Preset) => {
    setPreset(p);
    setResults((prev) => presetResults(p, n, p === "custom" ? prev : []));
  };

  const applyBulk = () => {
    const list = splitItems(bulk).slice(0, MAX);
    if (list.length < MIN) return;
    setNames(list);
    setResults((prev) => presetResults(preset, list.length, prev));
    setBulk("");
  };

  /**
   * 사다리는 가까운 칸으로 내려올 확률이 더 높아서, 결과 위치가 고정이면 불공평해짐
   * (예: 순서 정하기에서 왼쪽 사람이 1번을 받을 확률이 높음).
   * 그래서 사다리를 만들 때마다 결과 위치를 섞어서 → 누가 무엇을 받을 확률이 모두 1/n.
   */
  const build = () => {
    setSlots(shuffle(results.map((v) => v.trim() || "꽝")));
    setRungs(makeRungs(n, rows));
    setTracedList([]);
    setRevealed(new Set());
  };

  const start = () => {
    // 이름 빈칸은 기본값으로 채움
    setNames((prev) => prev.map((v, i) => v.trim() || `참가자 ${i + 1}`));
    build();
    setPhase("play");
  };

  const rebuild = build;

  const paths = useMemo(() => {
    if (!width || rungs.length === 0) return [];
    const colW = width / n;
    const x = (c: number) => (c + 0.5) * colW;
    const y = (r: number, j: number) => 12 + (r + 0.5 + j) * ROW_H;
    return names.map((_, i) => {
      const { end, steps } = trace(i, rungs);
      let d = `M ${x(i)} 0`;
      for (const s of steps) {
        d += ` L ${x(s.from)} ${y(s.row, s.jitter)} L ${x(s.to)} ${y(s.row, s.jitter)}`;
      }
      d += ` L ${x(end)} ${height}`;
      return { d, end };
    });
  }, [width, rungs, names, n, height]);

  // 도착 칸은 화면 폭과 무관하게 사다리 구조만으로 계산 (폭이 잠깐 0이 돼도 결과가 사라지지 않게)
  const ends = useMemo(() => names.map((_, i) => trace(i, rungs).end), [names, rungs]);
  const endOf = (i: number) => (rungs.length ? ends[i] : -1);
  // 도착 칸 → 그 칸에 도착한 출발 번호 (공개된 것만)
  const arrivedBy = new Map<number, number>();
  revealed.forEach((i) => arrivedBy.set(endOf(i), i));

  const run = (i: number) => {
    if (traced.includes(i)) return;
    setTracedList((t) => [...t, { i, delay: 0 }]);
  };
  // 전체 보기: 남은 사람들을 순서대로 조금씩 늦게 출발
  const runAll = () => {
    const rest = names.map((_, i) => i).filter((i) => !traced.includes(i));
    setTracedList((t) => [...t, ...rest.map((i, k) => ({ i, delay: k * 0.45 }))]);
  };
  const allDone = revealed.size === n;

  if (phase === "setup") {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-xs text-white/45">인원</span>
          <div className="flex items-center rounded-full border border-white/10 bg-[#1C1E24]">
            <button
              type="button"
              className="cursor-pointer px-3.5 py-1.5 text-white/70 hover:text-white disabled:opacity-30"
              onClick={() => setCount(n - 1)}
              disabled={n <= MIN}
              aria-label="인원 줄이기"
            >
              −
            </button>
            <span className="w-8 text-center font-mono text-sm text-white">{n}</span>
            <button
              type="button"
              className="cursor-pointer px-3.5 py-1.5 text-white/70 hover:text-white disabled:opacity-30"
              onClick={() => setCount(n + 1)}
              disabled={n >= MAX}
              aria-label="인원 늘리기"
            >
              +
            </button>
          </div>
          <span className="font-mono text-[11px] text-white/30">최대 {MAX}명</span>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#1C1E24] p-4">
          <div className="mb-3 font-mono text-xs text-white/45">참가자</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {names.map((v, i) => (
              <input
                key={i}
                value={v}
                maxLength={12}
                onChange={(e) =>
                  setNames((prev) => prev.map((x, k) => (k === i ? e.target.value : x)))
                }
                placeholder={`참가자 ${i + 1}`}
                className={input}
                style={{ borderLeft: `3px solid ${COLORS[i % COLORS.length]}` }}
              />
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyBulk()}
              placeholder="한 번에 입력: 철수, 영희, 민수 (쉼표·줄바꿈)"
              className={input}
            />
            <button
              type="button"
              className={btn}
              onClick={applyBulk}
              disabled={splitItems(bulk).length < MIN}
            >
              적용
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#1C1E24] p-4">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-2 font-mono text-xs text-white/45">결과</span>
            {(
              [
                ["one", "당첨 1명 뽑기"],
                ["order", "순서 정하기"],
                ["custom", "직접 입력"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => applyPreset(k)}
                className={`cursor-pointer rounded-full px-3 py-1.5 font-mono text-xs transition-colors ${
                  preset === k
                    ? "bg-[#6C63FF] text-white"
                    : "bg-white/5 text-white/60 hover:bg-white/10"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {preset === "custom" ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {results.map((v, i) => (
                <input
                  key={i}
                  value={v}
                  maxLength={12}
                  onChange={(e) =>
                    setResults((prev) => prev.map((x, k) => (k === i ? e.target.value : x)))
                  }
                  placeholder="꽝"
                  className={input}
                />
              ))}
            </div>
          ) : (
            <p className="font-['Nanum_Gothic',sans-serif] text-sm text-white/50">
              {preset === "one"
                ? `${n}칸 중 1칸이 "당첨", 나머지는 "꽝"입니다.`
                : `1번부터 ${n}번까지 순서를 정합니다.`}
            </p>
          )}
        </div>

        <label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-white/60">
          <input
            type="checkbox"
            checked={hide}
            onChange={(e) => setHide(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#6C63FF]"
          />
          결과 가리기 (도착할 때까지 ? 로 표시)
        </label>
        <p className="-mt-3 font-['Nanum_Gothic',sans-serif] text-xs text-white/35">
          결과 칸의 위치는 사다리를 만들 때마다 섞여서, 누가 어떤 결과를 받을 확률은 모두 같습니다.
        </p>

        <div>
          <button type="button" className={primaryBtn} onClick={start}>
            사다리 만들기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        <button
          type="button"
          className={primaryBtn}
          onClick={runAll}
          disabled={traced.length === n}
        >
          전체 결과 보기
        </button>
        <button type="button" className={btn} onClick={rebuild}>
          사다리 다시 만들기
        </button>
        <button type="button" className={btn} onClick={() => setPhase("setup")}>
          설정 바꾸기
        </button>
      </div>
      <p className="mb-3 font-['Nanum_Gothic',sans-serif] text-xs text-white/40">
        이름을 누르면 그 사람의 사다리를 탑니다.
      </p>

      <div ref={boxRef} className="w-full select-none">
        {/* 출발 (이름) */}
        <div className="grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {names.map((name, i) => {
            const on = traced.includes(i);
            return (
              <button
                key={i}
                type="button"
                title={name}
                onClick={() => run(i)}
                disabled={on}
                className="mx-0.5 cursor-pointer truncate rounded-md px-1 py-1.5 text-center font-['Nanum_Gothic',sans-serif] text-[11px] transition-colors sm:mx-1 sm:text-sm"
                style={{
                  background: on ? COLORS[i % COLORS.length] : "rgba(255,255,255,.06)",
                  color: on ? "#15131c" : "rgba(255,255,255,.85)",
                  fontWeight: on ? 700 : 400,
                }}
              >
                {name}
              </button>
            );
          })}
        </div>

        {width > 0 && (
          <svg width={width} height={height} className="block" aria-label="사다리">
            {/* 세로줄 */}
            {names.map((_, c) => (
              <line
                key={c}
                x1={(c + 0.5) * (width / n)}
                x2={(c + 0.5) * (width / n)}
                y1={0}
                y2={height}
                stroke="rgba(255,255,255,.28)"
                strokeWidth={3}
                strokeLinecap="round"
              />
            ))}
            {/* 가로줄 */}
            {rungs.map((row, r) =>
              row.map((j, c) =>
                j === null ? null : (
                  <line
                    key={`${r}-${c}`}
                    x1={(c + 0.5) * (width / n)}
                    x2={(c + 1.5) * (width / n)}
                    y1={12 + (r + 0.5 + j) * ROW_H}
                    y2={12 + (r + 0.5 + j) * ROW_H}
                    stroke="rgba(255,255,255,.28)"
                    strokeWidth={3}
                    strokeLinecap="round"
                  />
                )
              )
            )}
            {/* 탄 경로 */}
            {tracedList.map(({ i, delay }) => {
              return (
                <path
                  key={i}
                  d={paths[i]?.d}
                  pathLength={1}
                  fill="none"
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="ladder-draw"
                  style={{ animationDelay: `${delay}s` }}
                  onAnimationEnd={() => setRevealed((s) => new Set(s).add(i))}
                />
              );
            })}
          </svg>
        )}

        {/* 도착 (결과) */}
        <div className="grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {slots.map((r, c) => {
            const who = arrivedBy.get(c);
            const shown = !hide || who !== undefined;
            const win = r === "당첨";
            return (
              <div
                key={c}
                title={shown ? r : undefined}
                className={`mx-0.5 truncate rounded-md px-1 py-1.5 text-center font-['Nanum_Gothic',sans-serif] text-[11px] sm:mx-1 sm:text-sm ${
                  who !== undefined ? "ladder-pop" : ""
                }`}
                style={{
                  background:
                    who !== undefined
                      ? COLORS[who % COLORS.length]
                      : shown
                        ? "rgba(255,255,255,.08)"
                        : "rgba(255,255,255,.04)",
                  color:
                    who !== undefined
                      ? "#15131c"
                      : shown
                        ? "rgba(255,255,255,.8)"
                        : "rgba(255,255,255,.3)",
                  fontWeight: who !== undefined || (shown && win) ? 700 : 400,
                }}
              >
                {shown ? r : "?"}
              </div>
            );
          })}
        </div>
      </div>

      {revealed.size > 0 && (
        <div className="mt-6 rounded-xl border border-white/10 bg-[#1C1E24] p-4">
          <div className="mb-3 font-mono text-xs text-white/45">
            결과 {allDone ? "" : `(${revealed.size}/${n})`}
          </div>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {names.map((name, i) =>
              revealed.has(i) ? (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-lg bg-black/20 px-3 py-2 font-['Nanum_Gothic',sans-serif] text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: COLORS[i % COLORS.length] }}
                    />
                    <span className="truncate text-white/85">{name}</span>
                  </span>
                  <span
                    className={
                      slots[endOf(i)] === "당첨" ? "font-bold text-[#FFD166]" : "text-white/60"
                    }
                  >
                    {slots[endOf(i)]}
                  </span>
                </li>
              ) : null
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
