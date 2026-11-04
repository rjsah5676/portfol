"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import GameHeader from "@/components/GameHeader";
import { Icon } from "@/components/Sketch/Art";
import { SUSPECT_GUIDE } from "@/data/gameGuides";
import { prepareRuns } from "@/lib/api/rankRun";
import {
  caseKey,
  caseNo,
  dailySeed,
  dayLabel,
  DAILY_GP,
  ALL_FACES,
  kstDay,
  RANKED_TIERS,
  scoreOf,
  TIERS,
  type Puzzle,
  type TierId,
} from "@/lib/suspect/engine";
import { makePuzzle } from "@/lib/suspect/makePuzzle";
import {
  applySuspectReset,
  getPlay,
  liveStreak,
  loadStore,
  markSolved,
  onStoreChange,
  saveStore,
  setPlay,
  type PlayState,
  type Store,
} from "@/lib/suspect/progress";
import {
  getSound,
  onSoundChange,
  playBgm,
  playSfx,
  preloadSounds,
  setSound,
} from "@/lib/suspect/sound";
import { beginCase } from "@/firestore/suspectRankings";
import CaseBoard, { type BoardMode, type FinishInfo } from "./CaseBoard";
import Result, { fmtTime } from "./Result";
import { useSuspectRank } from "./SuspectRank";

/*
 * 오늘의 용의자 — 화면 흐름
 *   로딩(얼굴 · 소리 · 글꼴) → 첫 화면(오늘의 사건 4단계 · 입문 · 연습) → 풀기 → 결과(랭킹 · 공유)
 *  - 처음 온 사람: 첫 화면 맨 위에 "입문 사건(2분)" 추천, 오늘의 사건 카드에도 "처음이면 입문부터" 안내
 *  - 오늘의 사건은 날짜 · 난이도마다 누구나 같은 판. 판 상태를 저장해서 이어 풀기, 랭킹은 첫 풀이만
 */

interface Run {
  mode: BoardMode;
  tier: TierId;
  /** 오늘의 사건이면 날짜 */
  day: string | null;
  seed: number;
}
type Phase = "play" | "result" | "review";

const DOTS: Record<TierId, number> = {
  intro: 0,
  easy: 1,
  normal: 2,
  hard: 3,
  hell: 4,
  big: 3,
  bighell: 4,
};
const TIER_COLOR: Record<TierId, string> = {
  intro: "var(--sky)",
  easy: "var(--inno)",
  normal: "var(--sky)",
  hard: "var(--grape)",
  hell: "var(--crim)",
  // 놋쇠색(--brass)은 종이 위 글자로 흐려서 더 진하게
  big: "#8a5f1f",
  bighell: "var(--crim)",
};
/** 5칸 넘는 판(대형 사건)은 무대를 넓혀서 카드가 4칸 판과 같은 폭이 되게 */
const isWide = (t: TierId) => TIERS[t].cols >= 5;

function useStore(ready: boolean): Store | null {
  const [s, setS] = useState<Store | null>(null);
  useEffect(() => {
    if (!ready) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage 는 화면이 뜬 뒤에만 읽을 수 있음
    setS({ ...loadStore() });
    return onStoreChange(() => setS({ ...loadStore() }));
  }, [ready]);
  return s;
}

function SoundBtn() {
  const [s, setS] = useState(() => ({ mute: false }));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 소리 설정은 화면이 뜬 뒤에 읽음
    setS({ ...getSound() });
    return onSoundChange(() => setS({ ...getSound() }));
  }, []);
  return (
    <button
      type="button"
      className="sp-btn sp-btn-sm sp-btn-ghost"
      title={s.mute ? "소리 켜기" : "소리 끄기"}
      aria-label={s.mute ? "소리 켜기" : "소리 끄기"}
      onClick={() => {
        setSound({ mute: !getSound().mute });
        playSfx("sfx-tap");
      }}
    >
      <Icon name={s.mute ? "mute" : "sound"} size={18} />
    </button>
  );
}

// ───────────────────────── 로딩 ─────────────────────────

const FACES = ALL_FACES;
/** 로딩 화면에서 미리 받는 그림 (얼굴 10장 + 책상 나무결) */
const IMAGES = [...ALL_FACES, "/suspect/desk.webp"];

function useAssets() {
  const [pct, setPct] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let off = false;
    let img = 0;
    let snd = 0;
    let sndTotal = 7;
    const total = () => IMAGES.length + sndTotal + 1;
    let font = 0;
    const bump = () => !off && setPct(Math.round(((img + snd + font) / total()) * 100));
    const faces = IMAGES.map(
      (src) =>
        new Promise<void>((ok) => {
          const im = new Image();
          im.onload = im.onerror = () => {
            img++;
            bump();
            ok();
          };
          im.src = src;
        })
    );
    const sounds = preloadSounds((d, t) => {
      snd = d;
      sndTotal = t;
      bump();
    });
    const fonts = Promise.race([
      document.fonts?.load('700 20px "Gowun Batang"').catch(() => {}) ?? Promise.resolve(),
      new Promise((ok) => setTimeout(ok, 2500)),
    ]).then(() => {
      font = 1;
      bump();
    });
    void Promise.all([...faces, sounds, fonts]).then(() => {
      if (off) return;
      setPct(100);
      setTimeout(() => !off && setReady(true), 200);
    });
    return () => {
      off = true;
    };
  }, []);
  return { pct, ready };
}

function Loading({ pct }: { pct: number }) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 text-center">
      <div className="flex">
        {FACES.map((f, i) => (
          <img
            key={f}
            src={f}
            alt=""
            className="sp-face -ml-2 first:ml-0"
            style={{ rotate: `${i % 2 ? 6 : -6}deg` }}
          />
        ))}
      </div>
      <p className="sp-hand m-0 text-[22px]">사건 파일을 펼치는 중…</p>
      <div className="sp-loadbar w-[240px]">
        <i style={{ width: `${pct}%` }} />
      </div>
      <span className="sp-num text-[18px] text-[var(--ink2)]">{pct}%</span>
    </div>
  );
}

// ───────────────────────── 본체 ─────────────────────────

export default function SuspectApp() {
  const { pct, ready } = useAssets();
  const store = useStore(ready);
  const [today, setToday] = useState(() => kstDay());
  const [run, setRun] = useState<Run | null>(null);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [genErr, setGenErr] = useState(false);
  const [phase, setPhase] = useState<Phase>("play");
  const [result, setResult] = useState<FinishInfo | null>(null);
  const [saved, setSaved] = useState<PlayState | undefined>();

  // 랭킹 창 (날짜별 · 누적 — SuspectRank.tsx)
  const { spec: rankSpec, openRank } = useSuspectRank(ready, today, store);

  useEffect(prepareRuns, []);

  // 관리자 초기화(데일리 · 랭킹) 따라가기: 첫 화면에 있을 때 · 탭으로 돌아올 때마다 확인 (http/suspect.ts).
  // 푸는 중엔 안 함 — 지운 판을 보드가 바로 다시 저장해 버려서
  useEffect(() => {
    if (!ready || run) return;
    const go = () => void applySuspectReset().catch(() => {});
    go();
    const vis = () => !document.hidden && go();
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, [ready, run]);

  // 자정이 지나면 오늘의 사건이 바뀜 (첫 화면에 있을 때)
  useEffect(() => {
    const id = setInterval(() => {
      const d = kstDay();
      if (d !== today && !run) setToday(d);
    }, 30_000);
    return () => clearInterval(id);
  }, [today, run]);

  // 오늘의 사건 4개를 뒤에서 미리 만들어 둠 (지옥도 고르는 순간 바로 열리게)
  useEffect(() => {
    if (!ready) return;
    let chain = Promise.resolve();
    for (const t of RANKED_TIERS)
      chain = chain.then(() =>
        makePuzzle(dailySeed(today, t), t).then(
          () => {},
          () => {}
        )
      );
  }, [ready, today]);

  // 풀기 화면에서만 배경음악
  useEffect(() => {
    playBgm(!!run && phase !== "result");
    return () => playBgm(false);
  }, [run, phase]);

  const start = (r: Run) => {
    playSfx("sfx-flip");
    setRun(r);
    setPuzzle(null);
    setGenErr(false);
    setResult(null);
    const s = r.day ? getPlay(r.day, r.tier) : undefined;
    setSaved(s);
    if (s?.done) {
      setResult({
        time: Math.round(s.ms / 100) / 10,
        miss: s.miss,
        hint: s.hint,
        missed: s.missed,
      });
      setPhase("result");
    } else setPhase("play");
    makePuzzle(r.seed, r.tier).then(
      (p) => setPuzzle(p),
      () => setGenErr(true)
    );
    // 다 푼 사건은 결과 화면이 머리말 바로 아래 → 머리말로. 풀 사건은 판이 그려지면 판으로 (아래 effect)
    if (s?.done)
      document
        .querySelector("[data-game-header]")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // 판이 그려지면 위쪽 막대부터 보드 맨 아랫줄까지 한 화면에 들어오게 판으로 스크롤 (머리말은 위로 넘김)
  useEffect(() => {
    if (phase !== "play" || !puzzle) return;
    document.querySelector("[data-sp-play]")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [phase, puzzle]);

  const startDaily = (tier: TierId) =>
    start({ mode: "daily", tier, day: today, seed: dailySeed(today, tier) });
  const startTutorial = () =>
    start({ mode: "tutorial", tier: "intro", day: null, seed: dailySeed(today, "intro") });
  const startPractice = (tier: TierId) =>
    start({ mode: "practice", tier, day: null, seed: (Math.random() * 2 ** 32) >>> 0 });

  const home = () => {
    playSfx("sfx-tap");
    setRun(null);
    setPuzzle(null);
    setResult(null);
  };

  // 오늘의 사건을 처음 열면 서버에 시작 시각을 알림 (랭킹 티켓). 이어 풀기면 이미 받은 티켓을 씀
  useEffect(() => {
    if (!run?.day || run.mode !== "daily" || !puzzle || saved) return;
    beginCase(caseKey(run.day, run.tier));
  }, [run, puzzle, saved]);

  const onSave = useCallback(
    (p: PlayState) => {
      if (!run?.day) return;
      const prev = getPlay(run.day, run.tier);
      setPlay(run.day, run.tier, { ...p, submitted: prev?.submitted, score: prev?.score });
    },
    [run]
  );

  const onFinish = useCallback(
    (r: FinishInfo) => {
      if (!run) return;
      if (run.day && run.mode === "daily")
        markSolved(run.day, run.tier, scoreOf(r.time, r.miss, r.hint));
      if (run.mode === "tutorial")
        saveStore((s) => {
          s.tutorial = true;
        });
      setResult(r);
      setPhase("result");
      document
        .querySelector("[data-game-header]")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [run]
  );

  // ───── 화면 ─────
  let body: ReactNode;
  if (!ready || !store) body = <Loading pct={pct} />;
  else if (run) {
    const label =
      run.mode === "daily"
        ? `#${caseNo(run.day!)} ${TIERS[run.tier].label}`
        : run.mode === "tutorial"
          ? "입문"
          : `연습 · ${TIERS[run.tier].label}`;
    const head = (
      <>
        <button
          type="button"
          className="sp-btn sp-btn-sm sp-btn-ghost"
          onClick={home}
          aria-label="처음으로"
        >
          ←
        </button>
        <span className="sp-chip" style={{ borderLeftColor: TIER_COLOR[run.tier] }}>
          {label}
        </span>
        <SoundBtn />
      </>
    );
    if (!puzzle)
      body = (
        <div className="flex min-h-[380px] flex-col items-center justify-center gap-3 text-center">
          {genErr ? (
            <>
              <p className="sp-hand m-0 text-[20px]">사건 파일을 만들지 못했어요</p>
              <button type="button" className="sp-btn" onClick={() => start(run)}>
                다시 시도
              </button>
            </>
          ) : (
            <>
              <p className="sp-hand m-0 text-[22px]">용의자를 불러 모으는 중…</p>
              <p className="m-0 text-[13px] text-[var(--ink2)]">
                {run.tier === "hell" || run.tier === "bighell"
                  ? "지옥 난이도는 조건이 까다로워서 몇 초 걸릴 수 있어요"
                  : run.tier === "big"
                    ? "용의자 30명을 한자리에 모으는 중"
                    : "잠깐만요"}
              </p>
            </>
          )}
        </div>
      );
    else if (phase === "result" && result)
      body = (
        <Result
          key={`${run.seed}:${run.tier}`}
          puzzle={puzzle}
          mode={run.mode}
          tier={run.tier}
          day={run.day}
          result={result}
          onHome={home}
          onAgain={() => (run.mode === "tutorial" ? startDaily("easy") : startPractice(run.tier))}
          onRank={openRank}
          onReview={() => {
            playSfx("sfx-tap");
            setPhase("review");
          }}
        />
      );
    else if (phase === "review" && result)
      body = (
        <div className="flex flex-col gap-3">
          <CaseBoard
            key={`review:${run.seed}`}
            puzzle={puzzle}
            mode={run.mode}
            review
            saved={{
              x: [],
              memo: [],
              miss: result.miss,
              hint: result.hint,
              missed: result.missed,
              ms: result.time * 1000,
              done: true,
            }}
            onFinish={() => {}}
            head={head}
          />
          <button type="button" className="sp-btn" onClick={() => setPhase("result")}>
            결과로 돌아가기
          </button>
        </div>
      );
    else
      body = (
        <CaseBoard
          key={`${run.seed}:${run.tier}`}
          puzzle={puzzle}
          mode={run.mode}
          saved={saved}
          onSave={run.mode === "daily" ? onSave : undefined}
          onFinish={onFinish}
          head={head}
        />
      );
  } else
    body = (
      <Home
        store={store}
        today={today}
        onDaily={startDaily}
        onTutorial={startTutorial}
        onPractice={startPractice}
        onRank={openRank}
      />
    );

  // 대형 사건을 푸는 · 다시 보는 중이면 무대 · 머리말을 넓게 (결과 화면은 그대로)
  const wide = !!run && isWide(run.tier) && !!puzzle && phase !== "result";
  return (
    <>
      <GameHeader
        icon="px:suspect"
        title="오늘의 용의자"
        en="Daily Deduction Puzzle"
        accent="#C9A15B"
        desc="단서만으로 범인을 가려내는 하루 한 판 추리 퍼즐"
        tags={["데일리 퍼즐", "논리 추리", "4단계 + 대형 사건", "날마다 랭킹"]}
        className={`w-full ${wide ? "max-w-[680px]" : "max-w-[560px]"}`}
        guide={SUSPECT_GUIDE}
        rank={rankSpec}
      />
      <div className={`sp sp-stage mx-auto mt-3 w-full ${wide ? "max-w-[680px] is-wide" : "max-w-[560px]"}`}>
        <div className={`sp-inner${wide ? " is-wide" : ""}`}>{body}</div>
      </div>
    </>
  );
}

// ───────────────────────── 첫 화면 ─────────────────────────

function Home({
  store,
  today,
  onDaily,
  onTutorial,
  onPractice,
  onRank,
}: {
  store: Store;
  today: string;
  onDaily: (t: TierId) => void;
  onTutorial: () => void;
  onPractice: (t: TierId) => void;
  onRank: (t: TierId) => void;
}) {
  const [practiceTier, setPracticeTier] = useState<TierId>("easy");
  const streak = liveStreak(store);
  const plays = store.days[today] ?? {};
  const first = !store.tutorial && store.solved === 0;
  const doneToday = RANKED_TIERS.filter((t) => plays[t]?.done).length;

  return (
    <div className="flex flex-col gap-4">
      {/* 오늘의 사건 머리 */}
      <div className="sp-card relative px-4 pt-4 pb-3 text-center">
        <span
          className="sp-tape"
          style={{ left: "50%", top: -10, translate: "-50% 0", rotate: "-3deg" }}
        />
        <div className="text-[13px] text-[var(--ink2)]">{dayLabel(today)} 사건 파일</div>
        <h2 className="sp-hand m-0 text-[29px] leading-tight">오늘의 사건 #{caseNo(today)}</h2>
        <p className="m-0 text-[13.5px] break-keep text-[var(--ink2)]">
          누가 범인이고 누가 무고할까? 밝혀진 사람의 단서만 믿고 한 명씩 가려내세요.
        </p>
        <div className="mt-2 flex justify-center gap-2">
          <span className="sp-chip">🔥 연속 {streak}일</span>
          <span className="sp-chip">
            오늘 {doneToday}/{RANKED_TIERS.length} 해결
          </span>
          <span className="sp-chip">총 {store.solved}건</span>
        </div>
      </div>

      {/* 처음 온 사람 */}
      {first && (
        <button
          type="button"
          className="sp-card sp-note relative cursor-pointer px-4 py-3 text-left"
          onClick={onTutorial}
        >
          <span className="sp-tape yellow" style={{ right: 18, top: -9, rotate: "6deg" }} />
          <b className="sp-hand block text-[20px]">처음이세요? 입문 사건부터 (2분)</b>
          <span className="block text-[13.5px] break-keep text-[var(--ink2)]">
            12명짜리 작은 사건에서 단서 읽는 법을 하나씩 짚어 드려요. 벌점도 랭킹도 없어요.
          </span>
          <span className="sp-btn sp-btn-crim sp-btn-sm mt-2">입문 사건 시작 →</span>
        </button>
      )}

      {/* 규칙 세 줄 */}
      <div className="sp-soft px-4 py-3 text-[13.5px] leading-relaxed break-keep">
        <b className="sp-hand text-[16px]">규칙은 세 가지뿐</b>
        <ol className="m-0 mt-1 list-decimal pl-5">
          <li>
            모든 사람은 <b className="text-[var(--crim)]">범인</b> 아니면{" "}
            <b className="text-[var(--inno)]">무고</b>.
          </li>
          <li>
            정체가 밝혀진 사람은 단서를 하나 말해요. <b>단서는 늘 참</b> (범인도 거짓말 안 해요).
          </li>
          <li>
            단서로 <b>확실해진 사람만</b> 지목. 찍으면 실수예요 — 끝까지 논리만으로 풀려요.
          </li>
        </ol>
      </div>

      {/* 오늘의 사건 4단계 */}
      <div>
        <div className="mb-2 flex items-end justify-between">
          <b className="sp-hand text-[19px]">오늘의 사건 · 난이도</b>
          <button
            type="button"
            className="sp-btn sp-btn-sm sp-btn-ghost"
            onClick={() => onRank("normal")}
          >
            🏆 랭킹
          </button>
        </div>
        <div className="sp-tiers">
          {RANKED_TIERS.map((t) => {
            const T = TIERS[t];
            const p = plays[t];
            const n = T.cols * T.rows;
            return (
              <button
                key={t}
                type="button"
                className={`sp-card sp-tier cursor-pointer${isWide(t) ? " is-big" : ""}${t === "bighell" ? " is-hell" : ""}`}
                style={{ borderTopColor: TIER_COLOR[t] }}
                onClick={() => onDaily(t)}
              >
                <span className="sp-dots">{"●".repeat(DOTS[t]) + "○".repeat(4 - DOTS[t])}</span>
                <h3 style={{ color: TIER_COLOR[t] }}>
                  {isWide(t) ? `${T.label} 사건` : T.label}
                  {isWide(t) && (
                    <span className="sp-size">
                      {T.cols}×{T.rows}
                    </span>
                  )}
                </h3>
                <p>{T.desc.includes("명") ? T.desc : `${n}명 · ${T.desc}`}</p>
                {DAILY_GP[t] && <span className="sp-gp">회원 +{DAILY_GP[t]!.toLocaleString("ko-KR")} GP</span>}
                <span className="st">
                  {p?.done
                    ? `기록 ${fmtTime(p.score ?? scoreOf(p.ms / 1000, p.miss, p.hint))}`
                    : p
                      ? `이어서 풀기 · ${Math.floor(p.ms / 60000)}분째`
                      : first && t === "easy"
                        ? "입문 다음은 여기!"
                        : "도전하기 →"}
                </span>
                {p?.done && (
                  <span className="sp-solved">
                    {p.miss === 0 && p.hint === 0 ? "완벽" : "해결"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-2 mb-0 text-center text-[12px] break-keep text-[var(--ink2)]">
          같은 날 같은 난이도는 모두에게 같은 사건 · 자정(한국 시간)에 새 사건 · 랭킹엔 첫 풀이만 · 회원은 처음
          올릴 때 GP
        </p>
      </div>

      {/* 연습 · 입문 */}
      <div className="sp-soft flex flex-col gap-2 px-4 py-3">
        <b className="sp-hand text-[17px]">연습 사건 (랭킹 없음 · 무제한)</b>
        <span className="text-[12.5px] text-[var(--ink2)]">
          근거 없이 지목해도 벌점 없이 알려 줘요. 감 잡기에 좋아요.
        </span>
        <div className="flex flex-wrap gap-1.5">
          {RANKED_TIERS.map((t) => (
            <button
              key={t}
              type="button"
              className={`sp-btn sp-btn-sm ${practiceTier === t ? "on" : "sp-btn-ghost"}`}
              onClick={() => {
                playSfx("sfx-tap");
                setPracticeTier(t);
              }}
            >
              {TIERS[t].label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="sp-btn sp-btn-inno flex-1"
            onClick={() => onPractice(practiceTier)}
          >
            새 연습 사건
          </button>
          {!first && (
            <button type="button" className="sp-btn sp-btn-ghost" onClick={onTutorial}>
              입문 다시
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
