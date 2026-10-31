"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Board,
  explain,
  forcedAll,
  forcedOf,
  JOB_FACE,
  josa,
  PENALTY,
  singleClueSteps,
  type Puzzle,
  type Verdict,
} from "@/lib/suspect/engine";
import type { PlayState } from "@/lib/suspect/progress";
import { playSfx } from "@/lib/suspect/sound";

/*
 * 사건 하나 풀기 화면.
 *  - 모르는 사람을 누르면 아래 창에서 범인 / 무고 지목 (또는 연필 메모)
 *  - 오늘의 사건(daily)은 "근거 없이 지목"도 실수로 침 → 아무나 찔러 보며 확정 가능한 사람을 찾는 꼼수 막기
 *    (입문 · 연습은 근거 부족이면 벌점 없이 안내만)
 *  - 힌트 2단계: ① 확정에 쓸 단서를 가리킴 ② 대상과 이유까지 (누를 때마다 힌트 +1)
 *  - 튜토리얼: 처음 3수는 솔버가 고른 한 수를 이유와 함께 짚어 줌
 *  - 탭을 내려 두면 시간이 멈추고 보드를 가림 (기록은 실제로 본 시간)
 */

export type BoardMode = "daily" | "practice" | "tutorial";

export interface FinishInfo {
  time: number;
  miss: number;
  hint: number;
  missed: number[];
}

type Tone = "normal" | "mark" | "bad";
interface Info {
  body: ReactNode;
  tone: Tone;
}

const GUIDED_STEPS = 3;
const faceOf = (job: keyof typeof JOB_FACE) => `/suspect/faces/${JOB_FACE[job]}.webp`;

export default function CaseBoard({
  puzzle,
  mode,
  saved,
  onSave,
  onFinish,
  head,
  review = false,
}: {
  puzzle: Puzzle;
  mode: BoardMode;
  /** 다 푼 판 다시 보기 (정답이 다 보이고 단서만 눌러 봄) */
  review?: boolean;
  saved?: PlayState;
  onSave?: (p: PlayState) => void;
  onFinish: (r: FinishInfo) => void;
  /** 맨 위 막대 왼쪽 (뒤로 · 사건 이름) */
  head: ReactNode;
}) {
  const b = useMemo(() => new Board(puzzle.cols, puzzle.rows), [puzzle]);
  const P = puzzle.people;
  const N = b.N;
  const strict = mode === "daily";

  const [x, setX] = useState<number[]>(() => {
    if (review) return [...puzzle.truth];
    if (saved?.x?.length === N) return saved.x;
    const a = new Array<number>(N).fill(-1);
    a[puzzle.start] = 0;
    return a;
  });
  const [memo, setMemo] = useState<number[]>(() =>
    saved?.memo?.length === N ? saved.memo : new Array<number>(N).fill(0)
  );
  const [miss, setMiss] = useState(saved?.miss ?? 0);
  const [hint, setHint] = useState(saved?.hint ?? 0);
  const [missed, setMissed] = useState<number[]>(saved?.missed ?? []);
  const msRef = useRef(saved?.ms ?? 0);
  const [shownSec, setShownSec] = useState(Math.floor((saved?.ms ?? 0) / 1000));
  const [paused, setPaused] = useState(false);
  const [sel, setSel] = useState(-1);
  const [focus, setFocus] = useState(-1);
  const [target, setTarget] = useState(-1);
  const [hintState, setHintState] = useState<{
    speaker: number;
    i: number;
    v: Verdict;
    stage: 1 | 2;
  } | null>(null);
  const [memoMode, setMemoMode] = useState(false);
  const [info, setInfo] = useState<Info | null>(null);
  const [fresh, setFresh] = useState(-1);
  const [shake, setShake] = useState<{ i: number; k: number } | null>(null);
  const [guided, setGuided] = useState(mode === "tutorial" && !saved && !review ? 0 : GUIDED_STEPS);
  const doneRef = useRef(review);

  const revealed = useMemo(() => b.all.filter((i) => x[i] >= 0), [b, x]);
  const cons = useMemo(() => revealed.map((i) => puzzle.clues[i]), [revealed, puzzle]);
  const known = revealed.length;

  // ───── 저장 (오늘의 사건: 새로고침 · 다른 화면 갔다 와도 이어서) ─────
  const save = useCallback(
    () => onSave?.({ x, memo, miss, hint, missed, ms: msRef.current, done: doneRef.current }),
    [onSave, x, memo, miss, hint, missed]
  );
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
    save();
  }, [save]);
  useEffect(() => () => saveRef.current(), []);

  // ───── 시간: 화면을 보고 있을 때만 흐름 ─────
  useEffect(() => {
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      if (paused || doneRef.current || document.hidden) return;
      msRef.current += Math.min(dt, 1000);
      setShownSec(Math.floor(msRef.current / 1000));
    }, 250);
    const vis = () => {
      if (document.hidden && !doneRef.current) setPaused(true);
      saveRef.current();
    };
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("pagehide", vis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("pagehide", vis);
    };
  }, [paused]);

  // ───── 튜토리얼: 지금 짚어 줄 한 수 ─────
  const guideStep = useMemo(() => {
    if (mode !== "tutorial" || guided >= GUIDED_STEPS) return null;
    const steps = singleClueSteps(
      x,
      revealed.map((s) => ({ speaker: s, clue: puzzle.clues[s] }))
    );
    return steps[0] ?? null;
  }, [mode, guided, x, revealed, puzzle]);

  useEffect(() => {
    if (!guideStep) return;
    const sp = P[guideStep.speaker].name;
    const who = P[guideStep.i].name;
    /* eslint-disable react-hooks/set-state-in-effect -- 튜토리얼 단계가 바뀔 때마다 안내를 새로 띄움 */
    setFocus(guideStep.speaker);
    setTarget(guideStep.i);
    setInfo({
      tone: "mark",
      body: (
        <>
          <b className="sp-hand text-[19px]">
            {guided === 0 ? "카드 읽는 법 · " : `추리 ${guided + 1} · `}
          </b>
          {guided === 0 && (
            <>
              초록 도장이 찍힌 <b>{sp}</b>
              {josa(sp, "은", "는")} 무고로 밝혀진 사람이에요. 밝혀진 사람 카드에는 단서가 적혀
              있고, 노랗게 표시된 카드가 그 단서가 가리키는 사람들이에요.{" "}
            </>
          )}
          <span className="who">“{puzzle.clues[guideStep.speaker].text}”</span>
          {explain(P, x, puzzle.clues[guideStep.speaker], guideStep.i, guideStep.v)}
          <small>
            → 반짝이는 <b>{who}</b>
            {josa(who, "을", "를")} 눌러서 <b>{guideStep.v ? "범인이다" : "무고하다"}</b>를 골라
            보세요.
          </small>
        </>
      ),
    });
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [guideStep, guided, P, x, puzzle]);

  // ───── 끝 ─────
  const finishRef = useRef(onFinish);
  useEffect(() => {
    finishRef.current = onFinish;
  });
  useEffect(() => {
    if (known < N || doneRef.current) return;
    doneRef.current = true;
    const time = Math.round(msRef.current / 100) / 10;
    const r = { time, miss, hint, missed };
    saveRef.current();
    setTimeout(() => {
      playSfx("jingle-clear");
      finishRef.current(r);
    }, 650);
  }, [known, N, miss, hint, missed]);

  // 지목 창이 열려 있으면 사이트 빠른 메뉴 버튼을 숨김 (폰에서 "무고하다" 버튼을 가림)
  const picking = sel >= 0;
  useEffect(() => {
    document.documentElement.classList.toggle("sp-picking", picking);
    return () => document.documentElement.classList.remove("sp-picking");
  }, [picking]);

  const shakeSeq = useRef(0);
  const bump = (i: number) => setShake({ i, k: ++shakeSeq.current });

  const defaultInfo: Info = review
    ? {
        tone: "normal",
        body: (
          <>
            모든 정체가 밝혀진 판이에요. 카드를 누르면 그 사람의 단서를 다시 볼 수 있어요.
            <small>파란 테두리는 내가 실수했던 사람이에요.</small>
          </>
        ),
      }
    : {
        tone: "normal",
        body: (
          <>
            밝혀진 사람 카드를 누르면 <b>단서</b>가 여기 뜨고, 가리키는 사람이 노랗게 보여요.
            <small>
              모르는 사람을 눌러 지목 · 확실한 사람만!
              {strict && ` 근거 없이 지목해도 실수(+${PENALTY.miss}초)`}
            </small>
          </>
        ),
      };

  function clueInfo(s: number, extra: string): Info {
    const p = P[s];
    return {
      tone: "normal",
      body: (
        <>
          <span className="who">
            {b.code(s)} {p.name} · {p.job}
          </span>
          “{puzzle.clues[s].text}”<small>{extra}</small>
        </>
      ),
    };
  }

  function tapCell(i: number) {
    if (paused || (doneRef.current && !review)) return;
    if (x[i] >= 0) {
      playSfx("sfx-tap", 0.7);
      setSel(-1);
      if (guideStep) return;
      if (focus === i) {
        setFocus(-1);
        setInfo(null);
      } else {
        setFocus(i);
        setInfo(clueInfo(i, `${x[i] ? "범인" : "무고"} · 노란 카드가 이 단서가 가리키는 사람들`));
      }
      return;
    }
    if (guideStep && i !== guideStep.i) {
      bump(i);
      return;
    }
    playSfx("sfx-tap");
    if (memoMode) {
      setMemo((m) => m.map((v, k) => (k === i ? (v + 1) % 3 : v)));
      return;
    }
    setSel(i === sel ? -1 : i);
  }

  function setMemoOf(i: number, v: number) {
    playSfx("sfx-tap");
    setMemo((m) => m.map((o, k) => (k === i ? v : o)));
    setSel(-1);
  }

  function accuse(v: Verdict) {
    const i = sel;
    if (i < 0 || x[i] >= 0) return;
    const f = forcedOf(x, cons, i);
    const name = P[i].name;
    if (f !== v) {
      playSfx("sfx-wrong");
      bump(i);
      if (mode === "tutorial" && guideStep) {
        setInfo((o) => o && { ...o, tone: "bad" });
        return;
      }
      if (f === -1 && !strict) {
        setInfo({
          tone: "bad",
          body: (
            <>
              아직 {name}
              {josa(name, "을", "를")} 확정할 근거가 없어요.
              <small>다른 단서부터 살펴보세요. (연습이라 벌점은 없어요)</small>
            </>
          ),
        });
        setSel(-1);
        return;
      }
      setMiss((m) => m + 1);
      setMissed((a) => (a.includes(i) ? a : [...a, i]));
      setSel(-1);
      setInfo({
        tone: "bad",
        body:
          f === -1 ? (
            <>
              {name}
              {josa(name, "은", "는")} 아직 확정할 근거가 없어요. 실수 +1
              <small>
                찍기는 실수로 쳐요 (+{PENALTY.miss}초). 정답 여부는 알려 주지 않아요 — 단서로
                확실해질 때 지목하세요.
              </small>
            </>
          ) : (
            <>
              틀렸어요. 실수 +1
              <small>{strict ? `+${PENALTY.miss}초. ` : ""}단서를 다시 맞춰 보세요.</small>
            </>
          ),
      });
      return;
    }
    // 맞음
    playSfx("sfx-stamp");
    setTimeout(() => playSfx("sfx-flip", 0.7), 240);
    const nx = x.map((o, k) => (k === i ? v : o));
    setX(nx);
    setMemo((m) => m.map((o, k) => (k === i ? 0 : o)));
    setFresh(i);
    setSel(-1);
    setTarget(-1);
    setHintState(null);
    if (mode === "tutorial" && guided < GUIDED_STEPS) {
      const g = guided + 1;
      setGuided(g);
      if (g >= GUIDED_STEPS) {
        setFocus(i);
        setInfo({
          tone: "mark",
          body: (
            <>
              <b className="sp-hand text-[19px]">잘했어요! 이제 혼자 풀어 보세요.</b> 방금 밝혀진{" "}
              {name}의 카드에도 새 단서가 생겼어요.
              <small>
                막히면 위의 힌트 버튼. 헷갈리는 사람은 “연필 메모”로 범인? · 무고? 표시를 해 둘 수
                있어요.
              </small>
            </>
          ),
        });
      }
      return;
    }
    if (nx.every((o) => o >= 0)) {
      setFocus(-1);
      setInfo({
        tone: "mark",
        body: <b className="sp-hand text-[22px]">모든 용의자의 정체가 밝혀졌어요!</b>,
      });
      return;
    }
    // 방금 밝혀진 사람의 단서를 바로 보여 줌
    setFocus(i);
    setInfo(clueInfo(i, `${v ? "범인" : "무고"}으로 밝혀짐 · 새 단서가 생겼어요`));
  }

  function askHint() {
    if (paused || doneRef.current || guideStep) return;
    playSfx("sfx-hint");
    setSel(-1);
    setHint((h) => h + 1);
    if (hintState && hintState.stage === 1 && x[hintState.i] < 0) {
      setHintState({ ...hintState, stage: 2 });
      setTarget(hintState.i);
      setFocus(hintState.speaker);
      setInfo({
        tone: "mark",
        body: (
          <>
            <span className="who">“{puzzle.clues[hintState.speaker].text}”</span>
            {explain(P, x, puzzle.clues[hintState.speaker], hintState.i, hintState.v)}
            <small>반짝이는 사람을 지목해 보세요.</small>
          </>
        ),
      });
      return;
    }
    const steps = singleClueSteps(
      x,
      revealed.map((s) => ({ speaker: s, clue: puzzle.clues[s] }))
    );
    if (steps.length) {
      const st = steps[Math.floor(Math.random() * steps.length)];
      setHintState({ ...st, stage: 1 });
      setFocus(st.speaker);
      setTarget(-1);
      const sp = P[st.speaker].name;
      setInfo({
        tone: "mark",
        body: (
          <>
            <b>{sp}</b>의 단서를 다시 보세요. 이 단서 하나만으로 정체가 확정되는 사람이 있어요.
            <span className="who">“{puzzle.clues[st.speaker].text}”</span>
            <small>힌트를 한 번 더 누르면 누구인지와 이유까지 알려 줘요.</small>
          </>
        ),
      });
      return;
    }
    // 단서 하나로는 안 되고 여러 단서를 엮어야 하는 순간
    const f = forcedAll(x, cons);
    if (!f.length) return;
    const t = f[Math.floor(Math.random() * f.length)];
    setHintState({ speaker: -1, i: t.i, v: t.v, stage: 2 });
    setTarget(t.i);
    setFocus(-1);
    const who = P[t.i].name;
    setInfo({
      tone: "mark",
      body: (
        <>
          지금은 단서 여러 개를 함께 봐야 해요. 반짝이는 <b>{who}</b>
          {josa(who, "은", "는")} 확정할 수 있어요.
          <small>
            {who}
            {josa(who, "을", "를")} 가리키는 단서들을 눌러 보면서, {who}
            {josa(who, "이", "가")} 범인일 때와 무고일 때 중 말이 안 되는 쪽을 찾아보세요.
          </small>
        </>
      ),
    });
  }

  const hl = focus >= 0 ? puzzle.clues[focus].S : [];
  const shown = info ?? defaultInfo;
  const mm = `${Math.floor(shownSec / 60)}:${String(shownSec % 60).padStart(2, "0")}`;
  const cols = { gridTemplateColumns: `repeat(${b.cols}, minmax(0, 1fr))` };
  const left = N - known;

  return (
    <div className="flex flex-col gap-2.5">
      {/* 맨 위 막대 */}
      <div className="sp-bar justify-between">
        <div className="flex min-w-0 items-center gap-2">{head}</div>
        <div className="sp-stat">
          <span>
            시간<b>{mm}</b>
          </span>
          <span>
            실수<b>{miss}</b>
          </span>
          <span>
            힌트<b>{hint}</b>
          </span>
        </div>
      </div>
      {!review && (
        <div className="sp-bar">
          <button
            type="button"
            className="sp-btn sp-btn-sm sp-btn-sun"
            onClick={askHint}
            disabled={!!guideStep || left === 0}
            title={strict ? `힌트 (누를 때마다 +${PENALTY.hint}초)` : "힌트"}
          >
            힌트{strict && <span className="text-[13px] opacity-70"> +{PENALTY.hint}초</span>}
          </button>
          <button
            type="button"
            className={`sp-btn sp-btn-sm ${memoMode ? "on" : ""}`}
            onClick={() => {
              playSfx("sfx-tap");
              setMemoMode((v) => !v);
              setSel(-1);
            }}
            aria-pressed={memoMode}
            disabled={!!guideStep}
          >
            ✎ 연필 메모 {memoMode ? "켜짐" : "꺼짐"}
          </button>
          <span className="sp-chip ml-auto">남은 {left}명</span>
          <button
            type="button"
            className="sp-btn sp-btn-sm sp-btn-ghost"
            onClick={() => {
              playSfx("sfx-tap");
              setPaused(true);
              saveRef.current();
            }}
            disabled={left === 0}
            aria-label="잠깐 멈춤"
          >
            ❚❚
          </button>
        </div>
      )}

      {/* 안내판 — 보드 위에 둠 (폰에서 아래쪽 단서가 안 보이던 문제) */}
      <div
        className={`sp-soft sp-info ${shown.tone === "mark" ? "mark" : shown.tone === "bad" ? "bad" : ""}`}
        aria-live="polite"
      >
        {shown.body}
        {memoMode && !guideStep && (
          <small>
            연필 메모 켜짐 · 모르는 사람을 누를 때마다 범인? → 무고? → 지움. 기록엔 영향 없어요.
          </small>
        )}
      </div>

      {/* 보드 */}
      <div className="relative">
        <div
          className="sp-boardwrap"
          style={paused ? { filter: "blur(9px)", pointerEvents: "none" } : undefined}
        >
          <div className="sp-collab" style={cols}>
            {Array.from({ length: b.cols }, (_, c) => (
              <span key={c}>{b.colName(c)}</span>
            ))}
          </div>
          <div className="sp-rowlab" style={{ gridTemplateRows: `repeat(${b.rows}, 1fr)` }}>
            {Array.from({ length: b.rows }, (_, r) => (
              <span key={r}>{r + 1}</span>
            ))}
          </div>
          <div className="sp-board" style={cols}>
            {b.all.map((i) => {
              const p = P[i];
              const v = x[i];
              const cls = [
                "sp-cell",
                v === 1 ? "crim known" : v === 0 ? "inno known" : "",
                v < 0 && memo[i] ? `memo${memo[i]}` : "",
                i === sel ? "sel" : "",
                hl.includes(i) ? "hl" : "",
                i === focus ? "spk" : "",
                i === target ? "target" : "",
                i === fresh ? "new" : "",
                shake?.i === i ? "shake" : "",
                v >= 0 && !review && puzzle.clues[i].S.every((j) => x[j] >= 0) ? "used" : "",
                review && missed.includes(i) ? "sel" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  type="button"
                  key={shake?.i === i ? `${i}-${shake.k}` : i}
                  className={cls}
                  onClick={() => tapCell(i)}
                  aria-label={`${b.code(i)} ${p.name} ${p.job} ${v === 1 ? "범인" : v === 0 ? "무고" : "미확인"}`}
                >
                  {v >= 0 ? (
                    <>
                      <span className="sp-stamp">{v ? "범인" : "무고"}</span>
                      <span className="sp-head">
                        <img className="sp-face" src={faceOf(p.job)} alt="" draggable={false} />
                        <span className="sp-name">{p.name}</span>
                      </span>
                      <span className="sp-cs">{puzzle.clues[i].short[0]}</span>
                      <span className="sp-cv">{puzzle.clues[i].short[1]}</span>
                    </>
                  ) : (
                    <>
                      {memo[i] > 0 && (
                        <span className={`sp-memo m${memo[i]}`}>
                          {memo[i] === 1 ? "범인?" : "무고?"}
                        </span>
                      )}
                      <img className="sp-face" src={faceOf(p.job)} alt="" draggable={false} />
                      <span className="sp-name">{p.name}</span>
                      <span className="sp-job">{p.job}</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        {paused && (
          <button
            type="button"
            className="sp-pause"
            onClick={() => {
              playSfx("sfx-tap");
              setPaused(false);
            }}
          >
            <span className="sp-card block px-6 py-4 text-center">
              <span className="sp-hand block text-[30px]">잠깐 멈춤</span>
              <span className="block text-[13px] text-[var(--ink2)]">
                누르면 이어서 · 멈춘 동안 시간은 안 흘러요
              </span>
            </span>
          </button>
        )}
      </div>

      {/* 지목 창 — 화면 아래에 붙어 있음 */}
      {sel >= 0 && x[sel] < 0 && (
        <div className="sp-card sp-pick sticky bottom-2 z-20">
          <div className="flex items-center gap-2.5">
            <img className="sp-face" src={faceOf(P[sel].job)} alt="" />
            <div className="min-w-0 flex-1 leading-tight">
              <b className="sp-hand text-[23px]">{P[sel].name}</b>{" "}
              <span className="text-[13px] text-[var(--ink2)]">
                {b.code(sel)} · {P[sel].job}
              </span>
              <br />
              <span className="text-[12.5px] text-[var(--ink2)]">
                {strict
                  ? "확실할 때만! 근거 없이 고르면 실수예요."
                  : "단서로 확실해졌다면 골라 보세요."}
              </span>
            </div>
            <button
              type="button"
              className="sp-btn sp-btn-sm sp-btn-ghost"
              onClick={() => setSel(-1)}
            >
              닫기
            </button>
          </div>
          <div className="row">
            <button type="button" className="sp-btn sp-btn-crim" onClick={() => accuse(1)}>
              범인이다
            </button>
            <button type="button" className="sp-btn sp-btn-inno" onClick={() => accuse(0)}>
              무고하다
            </button>
          </div>
          {!guideStep && (
            <div className="row3">
              <button
                type="button"
                className="sp-btn sp-btn-sm sp-btn-ghost"
                onClick={() => setMemoOf(sel, 1)}
              >
                ✎ 범인?
              </button>
              <button
                type="button"
                className="sp-btn sp-btn-sm sp-btn-ghost"
                onClick={() => setMemoOf(sel, 2)}
              >
                ✎ 무고?
              </button>
              <button
                type="button"
                className="sp-btn sp-btn-sm sp-btn-ghost"
                onClick={() => setMemoOf(sel, 0)}
              >
                ✎ 지우기
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
