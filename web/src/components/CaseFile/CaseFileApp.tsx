"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type TouchEvent,
} from "react";
import { createPortal } from "react-dom";
import GameHeader from "@/components/GameHeader";
import { CASEFILE_GUIDE } from "@/data/gameGuides";
import {
  CAT,
  CAUSE,
  caseNo,
  clueText,
  dailySeed,
  dayLabel,
  hhmm,
  josa,
  kstDay,
  PENALTY,
  ro,
  scoreOf,
  slotLabel,
  stmtText,
  TIER_IDS,
  TIERS,
  type Case,
  type TierId,
} from "@/lib/casefile/engine";
import { makeCase } from "@/lib/casefile/makeCase";
import {
  getPlay,
  liveStreak,
  loadStore,
  markSolved,
  onStoreChange,
  setPlay,
  type Play,
  type Store,
  type Truth,
} from "@/lib/casefile/progress";

/*
 * 오늘의 사건 파일 — 화면
 *   첫 화면(오늘의 사건 4단계 · 연습) → 풀기(수사 보드 + 문서 탭) → 제출 → 해결
 *  - 동선표(사람 × 시간대 + 물건)가 답안지: 칸을 눌러 정하고, 우클릭 · 길게 누르기로 지움
 *  - 다 채워서 제출 → 틀리면 기록 +2분 (어느 칸인지는 안 알려 줌 — 찍기 막기)
 *  - 오늘의 사건은 판 상태를 저장해서 이어 풀기, 창을 닫아 둔 시간도 셈
 */

type Mode = "daily" | "practice";
interface Run {
  mode: Mode;
  tier: TierId;
  /** 오늘의 사건이면 날짜 */
  day: string | null;
  seed: number;
}
type Tab = "case" | "clues" | "submit";
type Sheet =
  | { kind: "cell"; t: number; p: number }
  | { kind: "room"; t: number; r: number }
  | { kind: "item"; p: number };

const fmt = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const PC = (p: number) => ({ "--pc": `var(--p${p})` }) as CSSProperties;
const caseTitle = (r: Run) =>
  r.day ? `오늘의 사건 #${String(caseNo(r.day)).padStart(3, "0")}` : "연습 사건";

function useStore(on: boolean): Store | null {
  const [s, setS] = useState<Store | null>(null);
  useEffect(() => {
    if (!on) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage 는 화면이 뜬 뒤에만 읽을 수 있음
    setS(loadStore());
    return onStoreChange(() => setS(loadStore()));
  }, [on]);
  return s;
}

export default function CaseFileApp() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 화면이 뜬 뒤에만 오늘 날짜 · 기록을 읽음
    setMounted(true);
  }, []);
  const store = useStore(mounted);
  const [today, setToday] = useState(() => kstDay());
  const [run, setRun] = useState<Run | null>(null);
  const [kase, setKase] = useState<Case | null>(null);
  const [err, setErr] = useState(false);
  const [practiceTier, setPracticeTier] = useState<TierId>("normal");
  const stageRef = useRef<HTMLDivElement>(null);

  // 자정이 지나면 오늘의 사건이 바뀜 (첫 화면에 있을 때)
  useEffect(() => {
    const id = setInterval(() => {
      const d = kstDay();
      if (d !== today && !run) setToday(d);
    }, 30_000);
    return () => clearInterval(id);
  }, [today, run]);

  // 오늘의 사건 4개를 뒤에서 미리 만들어 둠
  useEffect(() => {
    if (!mounted) return;
    let chain = Promise.resolve();
    for (const t of TIER_IDS)
      chain = chain.then(() =>
        makeCase(dailySeed(today, t), t).then(
          () => {},
          () => {}
        )
      );
  }, [mounted, today]);

  const start = (r: Run) => {
    setRun(r);
    setKase(null);
    setErr(false);
    makeCase(r.seed, r.tier).then(setKase, () => setErr(true));
  };
  const home = () => {
    setRun(null);
    setKase(null);
    document
      .querySelector("[data-game-header]")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // 사건이 열리면 풀기 화면이 사이트 메뉴 바로 아래를 꽉 채우게
  useEffect(() => {
    if (kase)
      stageRef.current
        ?.querySelector(".cf-play")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [kase]);

  let body: ReactNode;
  if (!mounted || !store)
    body = (
      <div className="cf-loading">
        <div>
          <b>사건 파일을 펼치는 중…</b>
        </div>
      </div>
    );
  else if (run && !kase)
    body = (
      <div className="cf-loading">
        <div>
          <b>{err ? "사건 파일을 만들지 못했어요" : "현장을 정리하는 중…"}</b>
          {err ? (
            <button
              type="button"
              className="cf-pill"
              style={{ marginTop: 10 }}
              onClick={() => start(run)}
            >
              다시 시도
            </button>
          ) : (
            <span>{run.tier === "hell" ? "지옥 난이도는 1초쯤 걸려요" : "잠깐만요"}</span>
          )}
        </div>
      </div>
    );
  else if (run && kase)
    body = <Board key={`${run.seed}:${run.tier}`} C={kase} run={run} onHome={home} />;
  else
    body = (
      <Home
        store={store}
        today={today}
        practiceTier={practiceTier}
        setPracticeTier={setPracticeTier}
        onDaily={(t) => start({ mode: "daily", tier: t, day: today, seed: dailySeed(today, t) })}
        onPractice={() =>
          start({
            mode: "practice",
            tier: practiceTier,
            day: null,
            seed: (Math.random() * 2 ** 32) >>> 0,
          })
        }
      />
    );

  const wide = !!(run && kase);
  return (
    <>
      <GameHeader
        icon="🗂️"
        title="오늘의 사건 파일"
        en="Daily Case File"
        accent="#D0675B"
        desc="동선표와 증거 문서로 범인 · 흉기를 밝히는 하루 한 판 추리 퍼즐"
        tags={["데일리 퍼즐", "논리 추리", "알리바이", "살인 사건"]}
        className={`mx-auto w-full ${wide ? "max-w-[1000px]" : "max-w-[640px]"}`}
        guide={CASEFILE_GUIDE}
      />
      <div
        ref={stageRef}
        className={`cf mx-auto mt-3 w-full ${wide ? "max-w-[1000px]" : "max-w-[640px]"}`}
      >
        {body}
      </div>
    </>
  );
}

// ───────────────────────── 첫 화면 ─────────────────────────

function Home({
  store,
  today,
  practiceTier,
  setPracticeTier,
  onDaily,
  onPractice,
}: {
  store: Store;
  today: string;
  practiceTier: TierId;
  setPracticeTier: (t: TierId) => void;
  onDaily: (t: TierId) => void;
  onPractice: () => void;
}) {
  const plays = store.days[today] ?? {};
  const done = TIER_IDS.filter((t) => plays[t]?.done).length;
  return (
    <div className="cf-home">
      <div className="no">
        오늘의 사건 #{String(caseNo(today)).padStart(3, "0")} · {dayLabel(today)}
      </div>
      <h2>오늘의 사건 파일</h2>
      <p className="lede">
        매일 새로 열리는 살인 사건. 시간대별 동선과 증거 문서만으로 범인과 흉기를 밝혀내세요. 같은
        날 같은 난이도는 모두 같은 사건이에요.
      </p>
      <div className="cf-chips">
        <span className="cf-chip">🔥 연속 {liveStreak(store)}일</span>
        <span className="cf-chip">
          오늘 {done}/{TIER_IDS.length} 해결
        </span>
        <span className="cf-chip">총 {store.solved}건</span>
      </div>
      <div className="cf-tiers">
        {TIER_IDS.map((t) => {
          const T = TIERS[t];
          const p = plays[t];
          return (
            <button key={t} type="button" className="cf-tier" onClick={() => onDaily(t)}>
              <span>
                <b>{T.label}</b>
                <small>
                  용의자 {T.n}명 · 시간대 {T.T}개
                </small>
              </span>
              {p?.done ? (
                <span className="st done">해결 {fmt(p.score ?? 0)}</span>
              ) : p ? (
                <span className="st go">수사 중</span>
              ) : (
                <span className="st">수사 시작 →</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="cf-box">
        <b>연습 사건 (기록 없음 · 무제한)</b>
        <div className="cf-row">
          {TIER_IDS.map((t) => (
            <button
              key={t}
              type="button"
              className="cf-pill"
              aria-pressed={t === practiceTier}
              onClick={() => setPracticeTier(t)}
            >
              {TIERS[t].label}
            </button>
          ))}
          <button
            type="button"
            className="cf-pill"
            style={{ marginLeft: "auto" }}
            onClick={onPractice}
          >
            새 사건 열기
          </button>
        </div>
      </div>
      <div className="cf-how">
        <b>푸는 법</b>
        <ol>
          <li>
            동선표 칸을 눌러 그 시간대에 있던 방과 물건을 정해요. 우클릭(폰은 길게 누르기)하면
            지워져요.
          </li>
          <li>시간대가 바뀔 땐 제자리이거나 문으로 이어진 방으로만 움직여요.</li>
          <li>범인만 거짓말을 해요. 사망 추정 시각에 현장에 있던 사람이 범인이에요.</li>
          <li>동선표를 다 채워서 제출해요. 틀리면 기록에 2분이 붙어요. 처음이면 쉬움부터!</li>
        </ol>
      </div>
    </div>
  );
}

// ───────────────────────── 풀기 ─────────────────────────

function freshPlay(C: Case): Play {
  return {
    cell: [...Array(C.T)].map(() => Array(C.n).fill(-1)),
    it: Array(C.n).fill(-1),
    truth: Array(C.n).fill("?"),
    seen: [],
    wrong: 0,
    ms: 0,
    done: false,
  };
}

function Board({ C, run, onHome }: { C: Case; run: Run; onHome: () => void }) {
  const daily = run.mode === "daily" && !!run.day;
  const [boot] = useState(() => {
    const s = daily ? getPlay(run.day!, run.tier) : undefined;
    const ok = s && s.cell.length === C.T && s.cell[0]?.length === C.n && s.it.length === C.n;
    const play = ok ? s : freshPlay(C);
    // 오늘의 사건은 창을 닫아 둔 시간도 셈 (캡처해 두고 닫았다가 풀기 막기)
    const ms0 = play.ms + (daily && !play.done && play.at ? Math.max(0, Date.now() - play.at) : 0);
    return { play, ms0 };
  });
  const [S, setS] = useState<Play>(boot.play);
  const msRef = useRef(boot.ms0);
  const [sec, setSec] = useState(Math.floor(boot.ms0 / 1000));
  const [slot, setSlot] = useState(C.T - 1);
  const [tab, setTab] = useState<Tab>("case");
  const [plan, setPlan] = useState(true);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [shake, setShake] = useState(0);
  const [verdict, setVerdict] = useState("");
  const [copied, setCopied] = useState(false);
  const doneRef = useRef(S.done);

  // 폰은 도면을 접어 둠 (동선표 + 문서가 한 화면에 들어오게 — 이동 가능 여부는 고르기 창에도 나옴). 아주 긴 화면만 펼침
  // 풀기 화면에선 사이트 빠른 메뉴 단추를 숨김 (문서 탭을 가려서)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 창 크기는 화면이 뜬 뒤에 앎
    if (window.innerWidth < 900 && window.innerHeight < 860) setPlan(false);
    document.documentElement.classList.add("cf-playing");
    return () => document.documentElement.classList.remove("cf-playing");
  }, []);

  // ───── 저장 ─────
  const save = useCallback(
    (p: Play) => {
      if (daily) setPlay(run.day!, run.tier, { ...p, ms: msRef.current, at: Date.now() });
    },
    [daily, run]
  );
  const sRef = useRef(S);
  useEffect(() => {
    sRef.current = S;
    doneRef.current = S.done;
    save(S);
  }, [S, save]);
  useEffect(() => {
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const dt = Math.max(0, now - last);
      last = now;
      if (doneRef.current) return;
      msRef.current += dt;
      setSec(Math.floor(msRef.current / 1000));
    }, 250);
    const flush = () => save(sRef.current);
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [save]);

  const up = (fn: (d: Play) => void) =>
    setS((prev) => {
      const d: Play = {
        ...prev,
        cell: prev.cell.map((a) => a.slice()),
        it: prev.it.slice(),
        truth: prev.truth.slice(),
        seen: prev.seen.slice(),
      };
      fn(d);
      return d;
    });

  // ───── 도우미 ─────
  const roomName = (r: number) => C.rooms[r].name;
  const ini = (p: number) => C.people[p].name.slice(0, 1);
  const canMove = (a: number, b: number) => C.adj[a].includes(b);
  const badCell = (t: number, p: number): string => {
    const r = S.cell[t][p];
    if (r < 0) return "";
    if (t > 0 && S.cell[t - 1][p] >= 0 && !canMove(S.cell[t - 1][p], r))
      return `${roomName(S.cell[t - 1][p])}에서 못 옴`;
    if (t < C.T - 1 && S.cell[t + 1][p] >= 0 && !canMove(r, S.cell[t + 1][p]))
      return `${ro(roomName(S.cell[t + 1][p]))} 못 감`;
    return "";
  };
  const setCell = (t: number, p: number, r: number) =>
    up((d) => {
      if (d.cell[t][p] === r) {
        d.cell[t][p] = -1;
        return;
      }
      for (let q = 0; q < C.n; q++) if (d.cell[t][q] === r) d.cell[t][q] = -1;
      d.cell[t][p] = r;
    });
  const setItem = (p: number, i: number) =>
    up((d) => {
      if (d.it[p] === i) {
        d.it[p] = -1;
        return;
      }
      for (let q = 0; q < C.n; q++) if (d.it[q] === i) d.it[q] = -1;
      d.it[p] = i;
    });
  const clearCell = (t: number, p: number) =>
    S.cell[t][p] >= 0 && up((d) => void (d.cell[t][p] = -1));
  const clearItem = (p: number) => S.it[p] >= 0 && up((d) => void (d.it[p] = -1));

  // 우클릭 · 길게 누르기 = 지우기 (길게 누른 뒤엔 눌림으로 치지 않음)
  const lp = useRef<{ tm: number | null; fired: boolean }>({ tm: null, fired: false });
  const clearProps = (fn: () => void) => ({
    onContextMenu: (e: { preventDefault: () => void }) => {
      e.preventDefault();
      if (!S.done) fn();
    },
    onTouchStart: () => {
      lp.current.fired = false;
      lp.current.tm = window.setTimeout(() => {
        lp.current.fired = true;
        if (!S.done) fn();
        navigator.vibrate?.(15);
      }, 550);
    },
    onTouchEnd: (e: TouchEvent) => {
      if (lp.current.tm) clearTimeout(lp.current.tm);
      if (lp.current.fired) e.preventDefault();
    },
    onTouchMove: () => {
      if (lp.current.tm) clearTimeout(lp.current.tm);
    },
  });
  const openSheet = (s: Sheet) => {
    if (lp.current.fired || S.done) return;
    setSheet(s);
  };

  // ───── 제출 ─────
  const total = C.T * C.n + C.n;
  const filled = S.cell.flat().filter((x) => x >= 0).length + S.it.filter((x) => x >= 0).length;
  let anyBad = false;
  for (let t = 0; t < C.T; t++) for (let p = 0; p < C.n; p++) if (badCell(t, p)) anyBad = true;
  const shown = S.done ? (S.score ?? 0) : sec + S.wrong * PENALTY;
  const submit = () => {
    const ok =
      C.pos.every((a, t) => a.every((r, p) => S.cell[t][p] === r)) &&
      C.item.every((i, p) => S.it[p] === i);
    if (ok) {
      const score = scoreOf(msRef.current / 1000, S.wrong);
      doneRef.current = true;
      up((d) => {
        d.done = true;
        d.score = score;
      });
      if (daily) markSolved(run.tier, score);
      setVerdict("");
    } else {
      up((d) => void d.wrong++);
      setVerdict(`맞지 않는 칸이 있어요. +2분 (오답 ${S.wrong + 1}번)`);
      setShake((k) => k + 1);
    }
  };
  const share = async () => {
    const text = [
      `🗂️ 오늘의 사건 파일 ${run.day ? `#${caseNo(run.day)}` : "연습"} · ${TIERS[run.tier].label}`,
      `⏱ ${fmt(S.score ?? 0)} · 오답 ${S.wrong}번${S.wrong === 0 ? " · 한 번에 해결" : ""}`,
      "https://gunmo.my/games/casefile/",
    ].join("\n");
    try {
      if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent))
        await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  // ───── 보드 ─────
  const T = TIERS[run.tier];
  const t = slot;
  const roomCells = C.rooms.map((rm, ri) => {
    const p = S.cell[t].indexOf(ri);
    const bad = p >= 0 && badCell(t, p);
    const scene = t === C.T - 1 && ri === C.crimeRoom;
    return (
      <button
        key={rm.id}
        type="button"
        className={`cf-room${rm.open ? " open" : ""}${scene ? " scene" : ""}${bad ? " bad" : ""}`}
        style={{ gridColumn: `${rm.x + 1} / span ${rm.w}`, gridRow: `${rm.y + 1} / span ${rm.h}` }}
        aria-label={`${slotLabel(C, t)} ${rm.name}`}
        onClick={() => openSheet({ kind: "room", t, r: ri })}
        {...clearProps(() => p >= 0 && clearCell(t, p))}
      >
        <span className="rn">
          {rm.name}
          {scene && " · 현장"}
        </span>
        {p >= 0 && (
          <span className="cf-occ" style={PC(p)}>
            <span className="cf-dot">{ini(p)}</span>
            <span className="full">{C.people[p].name}</span>
          </span>
        )}
      </button>
    );
  });
  const walls: ReactNode[] = [];
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 3; x++)
      if (!C.rooms.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h))
        walls.push(
          <span
            key={`w${x}${y}`}
            className="cf-wall"
            style={{ gridColumn: x + 1, gridRow: y + 1 }}
          />
        );
  const doors: ReactNode[] = [];
  C.rooms.forEach((a, i) =>
    C.rooms.forEach((b, j) => {
      if (j <= i || !C.adj[i].includes(j)) return;
      if (a.x + a.w === b.x || b.x + b.w === a.x) {
        const x = a.x + a.w === b.x ? b.x : a.x;
        const y0 = Math.max(a.y, b.y),
          y1 = Math.min(a.y + a.h, b.y + b.h);
        doors.push(
          <span
            key={`d${i}${j}`}
            className="cf-door v"
            style={{ left: `${(x / 3) * 100}%`, top: `${((y0 + y1) / 4) * 100}%` }}
          />
        );
      } else {
        const y = a.y + a.h === b.y ? b.y : a.y;
        const x0 = Math.max(a.x, b.x),
          x1 = Math.min(a.x + a.w, b.x + b.w);
        doors.push(
          <span
            key={`d${i}${j}`}
            className="cf-door h"
            style={{ top: `${(y / 2) * 100}%`, left: `${((x0 + x1) / 6) * 100}%` }}
          />
        );
      }
    })
  );

  const board = (
    <div className="cf-board gut">
      <div className="cf-slots">
        {C.slots.map((s, i) => (
          <button
            key={i}
            type="button"
            className={`cf-slot${i === C.T - 1 ? " murder" : ""}`}
            aria-pressed={slot === i}
            onClick={() => setSlot(i)}
          >
            {hhmm(s[0])}
            <small>{i === C.T - 1 ? "사망 추정" : i === 0 ? "사건 전" : "이동"}</small>
          </button>
        ))}
      </div>
      <div className="cf-bar">
        <span className="hint">누르면 정하기 · 우클릭(길게 누르기)이면 지우기</span>
        <button type="button" className="cf-tog" onClick={() => setPlan((v) => !v)}>
          {plan ? "도면 접기" : "도면 보기"}
        </button>
      </div>
      {plan && (
        <div className="cf-plan">
          {roomCells}
          {walls}
          {doors}
        </div>
      )}
      <table className="cf-grid">
        <thead>
          <tr>
            <th>용의자</th>
            {C.slots.map((s, i) => (
              <th key={i} className={i === slot ? "on" : ""}>
                {hhmm(s[0])}
              </th>
            ))}
            <th>물건</th>
          </tr>
        </thead>
        <tbody>
          {C.people.map((pp, p) => (
            <tr key={p}>
              <td>
                <div className="cf-who" style={PC(p)}>
                  <span className="cf-dot">{ini(p)}</span>
                  <span style={{ minWidth: 0 }}>
                    <b>{pp.name}</b>
                    <small>
                      {pp.h} · {pp.hand[0]}
                    </small>
                  </span>
                </div>
              </td>
              {C.slots.map((_, s) => {
                const r = S.cell[s][p];
                const bad = badCell(s, p);
                return (
                  <td key={s}>
                    <button
                      type="button"
                      className={`cf-cell${r >= 0 ? " set" : ""}${s === slot ? " on" : ""}${bad ? " bad" : ""}`}
                      style={PC(p)}
                      aria-label={`${pp.name} ${hhmm(C.slots[s][0])}`}
                      title={bad || undefined}
                      onClick={() => {
                        setSlot(s);
                        openSheet({ kind: "cell", t: s, p });
                      }}
                      {...clearProps(() => clearCell(s, p))}
                    >
                      {r >= 0 ? roomName(r) : <span className="q">?</span>}
                    </button>
                  </td>
                );
              })}
              <td>
                <button
                  type="button"
                  className={`cf-cell it${S.it[p] >= 0 ? " set" : ""}`}
                  style={PC(p)}
                  aria-label={`${pp.name}의 물건`}
                  onClick={() => openSheet({ kind: "item", p })}
                  {...clearProps(() => clearItem(p))}
                >
                  {S.it[p] >= 0 ? C.items[S.it[p]].name : <span className="q">?</span>}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // ───── 문서 탭 ─────
  const V = C.victim;
  const last = C.T - 1;
  const catName = CAT[C.cause];
  const paneCase = (
    <>
      <p className="lede">
        {C.setting.weather}, {V.title.includes(C.setting.name) ? "" : `${C.setting.name}의 `}
        {V.title} {V.name}({V.age}){josa(V.name, "이", "가").slice(V.name.length)}{" "}
        {roomName(C.crimeRoom)}에서 숨진 채 발견됐다. 그날 {C.setting.name}엔 {C.n}명이 있었다.
      </p>
      <div className="cf-doc">
        <div className="k">검시 보고서</div>
        <dl>
          <dt>사망 추정</dt>
          <dd>{slotLabel(C, last)}</dd>
          <dt>장소</dt>
          <dd>{roomName(C.crimeRoom)}</dd>
          <dt>사인</dt>
          <dd>{CAUSE[C.cause]}</dd>
        </dl>
        <p className="so">
          → {slotLabel(C, last)}에 {roomName(C.crimeRoom)}에 있던 사람이 범인이고, <b>{catName}</b>
          {josa(catName, "을", "를").slice(catName.length)} 지니고 있다.
        </p>
      </div>
      <h3>수사 규칙</h3>
      <ul className="cf-rules">
        <li>
          시간대마다 <b>방 하나에 한 명</b>씩 있었다.
        </li>
        <li>
          시간대가 바뀔 땐 <b>제자리</b>이거나 <b>문으로 바로 이어진 방</b>으로만 옮긴다.
        </li>
        <li>한 사람이 물건 하나씩, 그날 밤 내내 지니고 있었다.</li>
        <li>
          <b>범인만 거짓말</b>을 한다. 나머지 진술은 모두 참이다.
        </li>
      </ul>
      <h3>용의자</h3>
      <div className="cf-tblw">
        <table className="cf-tbl">
          <thead>
            <tr>
              <th>이름</th>
              <th>관계</th>
              <th>성별</th>
              <th>키</th>
              <th>손</th>
            </tr>
          </thead>
          <tbody>
            {C.people.map((p, i) => (
              <tr key={i}>
                <td>
                  <span className="cf-dot sm" style={PC(i)}>
                    {ini(i)}
                  </span>{" "}
                  {p.name}
                </td>
                <td>{p.role}</td>
                <td>{p.sex === "f" ? "여" : "남"}</td>
                <td className="mono">{p.h}cm</td>
                <td>{p.hand}잡이</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>물건</h3>
      <div className="cf-tblw">
        <table className="cf-tbl">
          <thead>
            <tr>
              <th>물건</th>
              <th>종류</th>
              <th>재질</th>
              <th>무게</th>
            </tr>
          </thead>
          <tbody>
            {C.items.map((it) => (
              <tr key={it.name}>
                <td>{it.name}</td>
                <td>
                  <span className={`cf-tag${it.cat === C.cause ? " cause" : ""}`}>
                    {CAT[it.cat]}
                  </span>
                </td>
                <td>{it.mat}</td>
                <td>{it.wt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  const paneClues = (
    <>
      <h3>
        증거 <span className="hint mono">{C.clues.length}</span>
      </h3>
      <p className="hint">모두 사실이에요. 다 쓴 단서는 「확인」을 눌러 지워 두세요.</p>
      {C.clues.map((c, i) => {
        const [tx, src] = clueText(C, c);
        const d = S.seen.includes(i);
        return (
          <div key={i} className={`cf-clue${d ? " done" : ""}`}>
            <span className="n">{i + 1}</span>
            <div className="tx">
              {tx}
              <small>{src}</small>
            </div>
            <button
              type="button"
              className="cf-chk"
              onClick={() =>
                up((s) => void (s.seen = d ? s.seen.filter((x) => x !== i) : [...s.seen, i]))
              }
            >
              {d ? "✓ 확인" : "확인"}
            </button>
          </div>
        );
      })}
      <h3>
        진술 <span className="hint mono">{C.n}</span>
      </h3>
      <p className="hint">범인만 거짓말을 해요. 버튼으로 참 · 거짓을 메모해 두세요.</p>
      {C.stmts.map((s) => {
        const p = s.by;
        const v = S.truth[p];
        return (
          <div key={p} className="cf-stmt" style={PC(p)}>
            <span className="cf-dot">{ini(p)}</span>
            <div>
              <div className="wn">
                {C.people[p].name} <span>{C.people[p].role}</span>
              </div>
              <q>{stmtText(C, s)}</q>
              <button
                type="button"
                className="cf-truth"
                data-v={v}
                onClick={() =>
                  up((d) => {
                    const o: Truth[] = ["?", "참", "거짓"];
                    d.truth[p] = o[(o.indexOf(d.truth[p]) + 1) % 3];
                  })
                }
              >
                {v === "?" ? "판단 전" : v}
              </button>
            </div>
          </div>
        );
      })}
    </>
  );

  const cul = S.cell[last].indexOf(C.crimeRoom);
  const wi = cul >= 0 ? S.it[cul] : -1;
  const paneSubmit = S.done ? (
    <div className="cf-solved">
      <span className="cf-stamp">사건 해결</span>
      <p style={{ margin: "2px 0 6px" }}>
        <b>
          {C.people[C.culprit].name} · {C.items[C.item[C.culprit]].name} · {roomName(C.crimeRoom)}
        </b>
      </p>
      <p className="hint" style={{ margin: 0 }}>
        기록 <b className="mono">{fmt(S.score ?? 0)}</b> = 걸린 시간 + 오답 {S.wrong}번 × 2분
        {S.wrong === 0 && " · 한 번에 해결"}
      </p>
      <button type="button" className="cf-go sub" onClick={share}>
        {copied ? "복사했어요!" : "결과 공유하기 (정답은 안 보여요)"}
      </button>
      <button type="button" className="cf-go sub" style={{ marginTop: 6 }} onClick={onHome}>
        사건 목록으로
      </button>
    </div>
  ) : (
    <div key={shake} className={shake ? "cf-shake" : ""}>
      <h3>수사 보고서 제출</h3>
      <p className="hint">
        동선표를 모두 채워서 내요. 틀리면 기록에 2분이 붙고, 어느 칸이 틀렸는지는 알려 주지 않아요.
      </p>
      <div className="cf-doc plain">
        <div className="k">내 동선표로 보면</div>
        <dl>
          <dt>범인</dt>
          <dd>
            {cul >= 0 ? (
              <>
                {C.people[cul].name}{" "}
                <span className="hint">
                  ({hhmm(C.slots[last][0])} {roomName(C.crimeRoom)})
                </span>
              </>
            ) : (
              <span className="hint">
                {hhmm(C.slots[last][0])} {roomName(C.crimeRoom)} 칸이 비었어요
              </span>
            )}
          </dd>
          <dt>흉기</dt>
          <dd>{wi >= 0 ? C.items[wi].name : <span className="hint">?</span>}</dd>
        </dl>
        {wi >= 0 && C.items[wi].cat !== C.cause && (
          <p className="so bad">
            사인은 {catName}인데 이 물건은 {CAT[C.items[wi].cat]}예요.
          </p>
        )}
        {anyBad && <p className="so bad">이동 규칙을 어긴 칸이 있어요 (동선표의 빨간 칸).</p>}
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        채운 칸{" "}
        <b className="mono">
          {filled} / {total}
        </b>
      </p>
      <button type="button" className="cf-go" disabled={filled < total || anyBad} onClick={submit}>
        {filled < total ? `${total - filled}칸 더 채워야 해요` : "제출하기"}
      </button>
      <div className="cf-verdict" aria-live="polite">
        {verdict || (S.wrong ? `오답 ${S.wrong}번 (+${S.wrong * 2}분)` : "")}
      </div>
    </div>
  );

  const tabs: [Tab, string, number | null][] = [
    ["case", "사건", null],
    ["clues", "단서 · 진술", C.clues.length + C.n],
    ["submit", S.done ? "해결" : "제출", null],
  ];

  return (
    <div className="cf-play">
      <div className="cf-top gut">
        <button type="button" className="back" aria-label="사건 목록" onClick={onHome}>
          ←
        </button>
        <div className="ttl">
          <b>
            {caseTitle(run)} · {C.setting.name}
          </b>
          <span>
            {T.label} · {C.n}명 · 시간대 {C.T}
          </span>
        </div>
        <span className="cf-timer" title="걸린 시간 + 오답 × 2분">
          {fmt(shown)}
        </span>
      </div>
      <div className="cf-main">
        {board}
        <div className="cf-panel">
          <div className="cf-tabs gut" role="tablist">
            {tabs.map(([k, l, n]) => (
              <button
                key={k}
                type="button"
                role="tab"
                className="cf-tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
              >
                {l}
                {n !== null && <span className="n">{n}</span>}
              </button>
            ))}
          </div>
          <div className="cf-pane gut">
            {tab === "case" ? paneCase : tab === "clues" ? paneClues : paneSubmit}
          </div>
        </div>
      </div>
      {sheet && (
        <PickSheet
          C={C}
          S={S}
          sheet={sheet}
          close={() => setSheet(null)}
          setCell={setCell}
          setItem={setItem}
          clearCell={clearCell}
          clearItem={clearItem}
          canMove={canMove}
        />
      )}
    </div>
  );
}

// ───────────────────────── 고르기 창 ─────────────────────────
// 줄을 누르면 정하고 닫힘. 이미 고른 줄을 다시 누르거나 「비우기」면 지움

function PickSheet({
  C,
  S,
  sheet,
  close,
  setCell,
  setItem,
  clearCell,
  clearItem,
  canMove,
}: {
  C: Case;
  S: Play;
  sheet: Sheet;
  close: () => void;
  setCell: (t: number, p: number, r: number) => void;
  setItem: (p: number, i: number) => void;
  clearCell: (t: number, p: number) => void;
  clearItem: (p: number) => void;
  canMove: (a: number, b: number) => boolean;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [close]);

  const roomName = (r: number) => C.rooms[r].name;
  const ini = (p: number) => C.people[p].name.slice(0, 1);
  const moveNote = (t: number, p: number, r: number) => (
    <>
      {t > 0 && S.cell[t - 1][p] >= 0 && (
        <small className={canMove(S.cell[t - 1][p], r) ? "" : "no"}>
          {hhmm(C.slots[t - 1][0])} {roomName(S.cell[t - 1][p])}에서{" "}
          {canMove(S.cell[t - 1][p], r) ? "올 수 있음" : "못 옴"}
        </small>
      )}
      {t < C.T - 1 && S.cell[t + 1][p] >= 0 && (
        <small className={canMove(r, S.cell[t + 1][p]) ? "" : "no"}>
          {hhmm(C.slots[t + 1][0])} {ro(roomName(S.cell[t + 1][p]))}{" "}
          {canMove(r, S.cell[t + 1][p]) ? "갈 수 있음" : "못 감"}
        </small>
      )}
    </>
  );
  const pickRow = (
    key: number,
    on: boolean,
    body: ReactNode,
    onPick: () => void,
    pc?: CSSProperties
  ) => (
    <button
      key={key}
      type="button"
      className="cf-srow"
      aria-pressed={on}
      style={pc}
      onClick={() => {
        onPick();
        close();
      }}
    >
      {body}
      <span className="mark">{on ? "✓" : ""}</span>
    </button>
  );

  let title = "";
  let sub = "";
  let rows: ReactNode[] = [];
  let clear: (() => void) | null = null;
  if (sheet.kind === "cell") {
    const { t, p } = sheet;
    title = `${C.people[p].name} · ${slotLabel(C, t)}`;
    sub = "이 시간대에 있던 방을 골라요.";
    rows = C.rooms.map((rm, r) => {
      const q = S.cell[t].indexOf(r);
      return pickRow(
        r,
        S.cell[t][p] === r,
        <div>
          <b>{rm.name}</b>
          {q >= 0 && q !== p && <small>지금 {C.people[q].name}</small>}
          {moveNote(t, p, r)}
        </div>,
        () => setCell(t, p, r),
        PC(p)
      );
    });
    if (S.cell[t][p] >= 0) clear = () => clearCell(t, p);
  } else if (sheet.kind === "room") {
    const { t, r } = sheet;
    title = `${roomName(r)} · ${slotLabel(C, t)}`;
    sub = "이 방에 있던 사람을 골라요.";
    rows = C.people.map((pp, p) => {
      const cur = S.cell[t][p];
      return pickRow(
        p,
        cur === r,
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="cf-dot">{ini(p)}</span>
          <div>
            <b>{pp.name}</b>
            {cur >= 0 && cur !== r && <small>지금 {roomName(cur)}</small>}
            {moveNote(t, p, r)}
          </div>
        </div>,
        () => setCell(t, p, r),
        PC(p)
      );
    });
    const occ = S.cell[t].indexOf(r);
    if (occ >= 0) clear = () => clearCell(t, occ);
  } else {
    const { p } = sheet;
    title = `${C.people[p].name}의 물건`;
    sub = "그날 밤 내내 지니고 있던 물건이에요.";
    rows = C.items.map((it, i) => {
      const q = S.it.indexOf(i);
      return pickRow(
        i,
        S.it[p] === i,
        <div>
          <b>{it.name}</b>
          <small>
            {CAT[it.cat]} · {it.mat} · {it.wt}
            {q >= 0 && q !== p && ` · 지금 ${C.people[q].name}`}
          </small>
        </div>,
        () => setItem(p, i),
        PC(p)
      );
    });
    if (S.it[p] >= 0) clear = () => clearItem(p);
  }

  return createPortal(
    <div className="cf-portal cf-sheet-bg" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="cf-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h4>{title}</h4>
        <p>{sub}</p>
        {rows}
        <div className="cf-sbtns">
          {clear && (
            <button
              type="button"
              onClick={() => {
                clear!();
                close();
              }}
            >
              비우기
            </button>
          )}
          <button type="button" onClick={close}>
            닫기
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
