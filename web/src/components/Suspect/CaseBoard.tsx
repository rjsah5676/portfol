"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Board,
  explain,
  forcedAll,
  forcedOf,
  faceOf,
  josa,
  PENALTY,
  singleClueSteps,
  type Person,
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
  /** 쪽지에 클립으로 같이 꽂는 초상 (단서를 말한 사람) */
  pic?: string;
}

const GUIDED_STEPS = 3;

/** 글 폭을 글자 크기(em) 단위로 어림 — 한글은 거의 정사각, 공백 · 영숫자 · 문장부호는 좁음 */
const textEm = (t: string) =>
  [...t].reduce(
    (s, ch) =>
      s + (/\s/.test(ch) ? 0.3 : /[가-힣]/.test(ch) ? 0.96 : /[\w]/.test(ch) ? 0.58 : 0.45),
    0
  );

/** 한 줄로 고정되는 글 — 칸 너비에 맞춰 글씨가 작아짐 (줄바꿈으로 쪽지 높이가 들쑥날쑥하지 않게) */
function Fit({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`fit ${className}`} style={{ "--n": textEm(text) } as CSSProperties}>
      {text}
    </span>
  );
}
const Quote = ({ text }: { text: string }) => <Fit className="q" text={`“${text}”`} />;

/** 안내판 기본 꼴: 머리말 · 본문 한 줄 · 보조 한 줄 (늘 같은 높이) */
function Lines({
  head,
  main,
  sub,
  quote,
}: {
  head: ReactNode;
  main: string;
  sub?: string;
  quote?: boolean;
}) {
  return (
    <>
      <span className="who">{head}</span>
      {quote ? <Quote text={main} /> : <Fit className="q" text={main} />}
      <Fit className="sub" text={sub || " "} />
    </>
  );
}

/** 직업 색 — 초상 배경색과 맞춤 (카드 윗선 · 직업 딱지) */
const JOB_COLOR: Record<Person["job"], string> = {
  경찰: "#3d5878",
  요리사: "#a35f2a",
  의사: "#2f6b66",
  교사: "#6b3f62",
  화가: "#9a4a5c",
};

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
    const who = P[guideStep.i].name;
    /* eslint-disable react-hooks/set-state-in-effect -- 튜토리얼 단계가 바뀔 때마다 안내를 새로 띄움 */
    setFocus(guideStep.speaker);
    setTarget(guideStep.i);
    setInfo({
      tone: "mark",
      pic: faceOf(P[guideStep.speaker]),
      body: (
        <>
          <span className="who">
            추리 {guided + 1}/{GUIDED_STEPS} · 반짝이는 {who}
            {josa(who, "을", "를")} {guideStep.v ? "범인" : "무고"}
            {guideStep.v ? "으로" : "로"} 지목해 보세요
          </span>
          <Quote text={puzzle.clues[guideStep.speaker].text} />
          <span className="why">
            {guided === 0 && "주황 테두리 카드들이 이 단서가 가리키는 사람이에요. "}
            {explain(P, x, puzzle.clues[guideStep.speaker], guideStep.i, guideStep.v)}
          </span>
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
          <Lines
            head="다 푼 사건 파일"
            main="카드를 누르면 그 사람의 단서를 다시 볼 수 있어요"
            sub="남색 테두리 = 내가 실수했던 사람"
          />
        ),
      }
    : {
        tone: "normal",
        body: (
          <Lines
            head="사건 파일"
            main="밝혀진 사람 카드를 누르면 단서가 여기 떠요"
            sub={
              strict
                ? `확실한 사람만 지목 · 근거 없이 찍으면 실수 +${PENALTY.miss}초`
                : "모르는 사람을 눌러 지목 · 확실한 사람만"
            }
          />
        ),
      };

  function clueInfo(s: number, extra: string): Info {
    const p = P[s];
    return {
      tone: "normal",
      pic: faceOf(p),
      body: (
        <>
          <span className="who">
            {b.code(s)} {p.name} · {p.job}
          </span>
          <Quote text={puzzle.clues[s].text} />
          <Fit className="sub" text={extra} />
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
        setInfo(clueInfo(i, `${x[i] ? "범인" : "무고"} · 주황 테두리 카드가 이 단서가 가리키는 사람들`));
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
          pic: faceOf(P[i]),
          body: (
            <Lines
              head="근거 부족"
              main={`아직 ${name}${josa(name, "을", "를")} 확정할 근거가 없어요`}
              sub="다른 단서부터 살펴보세요 · 연습이라 벌점 없음"
            />
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
        pic: faceOf(P[i]),
        body:
          f === -1 ? (
            <Lines
              head="실수 +1 · 근거 부족"
              main={`${name}${josa(name, "은", "는")} 아직 확정할 근거가 없어요`}
              sub={`찍기는 실수(+${PENALTY.miss}초) · 정답 여부는 알려 주지 않아요`}
            />
          ) : (
            <Lines
              head="실수 +1"
              main="틀렸어요. 단서를 다시 맞춰 보세요"
              sub={strict ? `기록에 +${PENALTY.miss}초` : "연습이라 기록엔 영향 없어요"}
            />
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
          pic: faceOf(P[i]),
          body: (
            <Lines
              head="잘했어요! 이제 혼자 풀어 보세요"
              main={`방금 밝혀진 ${name}의 카드에도 새 단서가 생겼어요`}
              sub="막히면 힌트 · 헷갈리면 연필 메모로 범인? 무고? 표시"
            />
          ),
        });
      }
      return;
    }
    if (nx.every((o) => o >= 0)) {
      setFocus(-1);
      setInfo({
        tone: "mark",
        body: (
          <Lines
            head="사건 종결"
            main="모든 용의자의 정체가 밝혀졌어요!"
            sub="보고서를 정리하는 중…"
          />
        ),
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
        pic: faceOf(P[hintState.speaker]),
        body: (
          <>
            <Quote text={puzzle.clues[hintState.speaker].text} />
            <span className="why">
              {explain(P, x, puzzle.clues[hintState.speaker], hintState.i, hintState.v)}
            </span>
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
        pic: faceOf(P[st.speaker]),
        body: (
          <Lines
            head={`힌트 · ${sp}의 단서를 다시 보세요`}
            main={puzzle.clues[st.speaker].text}
            quote
            sub="이 단서 하나로 확정되는 사람이 있어요 · 한 번 더 누르면 이유까지"
          />
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
      pic: faceOf(P[t.i]),
      body: (
        <Lines
          head="힌트 · 단서 여러 개를 엮어야 해요"
          main={`반짝이는 ${who}${josa(who, "은", "는")} 지금 확정할 수 있어요`}
          sub={`${who}${josa(who, "을", "를")} 가리키는 단서들을 겹쳐서 모순을 찾아보세요`}
        />
      ),
    });
  }

  const hl = focus >= 0 ? puzzle.clues[focus].S : [];
  const shown = info ?? defaultInfo;
  const mm = `${Math.floor(shownSec / 60)}:${String(shownSec % 60).padStart(2, "0")}`;
  const cols = { gridTemplateColumns: `repeat(${b.cols}, minmax(0, 1fr))` };
  const left = N - known;

  return (
    <div className="sp-play flex flex-col gap-2.5" data-sp-play>
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
        {shown.pic ? (
          <img className="sp-info-pic" src={shown.pic} alt="" draggable={false} />
        ) : (
          <span className="sp-info-pic empty" aria-hidden>
            ?
          </span>
        )}
        <div className="sp-info-body">{shown.body}</div>
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
          <div className={`sp-board${hl.length ? " has-hl" : ""}`} style={cols}>
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
                  style={{ "--job": JOB_COLOR[p.job] } as CSSProperties}
                  onClick={() => tapCell(i)}
                  aria-label={`${b.code(i)} ${p.name} ${p.job} ${v === 1 ? "범인" : v === 0 ? "무고" : "미확인"}`}
                >
                  {v >= 0 ? (
                    <>
                      <span className="sp-stamp">{v ? "범인" : "무고"}</span>
                      <span className="sp-head">
                        <img className="sp-face" src={faceOf(p)} alt="" draggable={false} />
                        {/* 이름 아래 직업 (밝혀진 뒤에도 직업 단서를 볼 수 있게) */}
                        <span className="sp-nj">
                          <span className="sp-name">{p.name}</span>
                          <span className="sp-job">{p.job}</span>
                        </span>
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
                      <img className="sp-face" src={faceOf(p)} alt="" draggable={false} />
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
              <span className="sp-hand block text-[26px]">잠깐 멈춤</span>
              <span className="block text-[13px] text-[var(--ink2)]">
                누르면 이어서 · 멈춘 동안 시간은 안 흘러요
              </span>
            </span>
          </button>
        )}
      </div>

      {/*
        지목 창 — 떠 있음 (fixed): 넓은 화면은 보드 오른쪽 옆, 그 밖엔 화면 아래.
        문서 흐름에 끼우면 열고 닫을 때마다 페이지 길이가 바뀌어 스크롤이 튐.
        대신 보드 아래에 늘 같은 높이의 빈 자리를 둬서, 맨 아랫줄도 창 위로 올려 볼 수 있게
      */}
      <div className="sp-pick-room" aria-hidden />
      {sel >= 0 && x[sel] < 0 && (
        <div className="sp-card sp-pick sp-pick-float">
          <div className="flex items-center gap-2.5">
            <img className="sp-face" src={faceOf(P[sel])} alt="" />
            <div className="min-w-0 flex-1 leading-tight">
              <b className="sp-hand text-[20px]">{P[sel].name}</b>{" "}
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
