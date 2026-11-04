"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import GameHeader from "@/components/GameHeader";
import { Icon } from "@/components/Sketch/Art";
import { beginMerge, getMergeSummary, submitMerge } from "@/firestore/pixelmergeRankings";
import { prepareRuns, RANK_NAME_MAX } from "@/lib/api/rankRun";
import { useAutoRank } from "@/lib/useAutoRank";
import {
  DAILY_GP,
  dayLabel,
  dayNo,
  daySeed,
  H,
  kstDay,
  mulberry,
  TIERS,
  W,
  type Mode,
} from "@/lib/pixelmerge/engine";
import type { MergeGame, Result } from "@/lib/pixelmerge/game";
import {
  liveStreak,
  loadStore,
  onStoreChange,
  recordPlay,
  saveStore,
  seeTier,
  type Store,
} from "@/lib/pixelmerge/progress";
import {
  getSound,
  onSoundChange,
  playBgm,
  playSfx,
  preloadSounds,
  setSound,
} from "@/lib/pixelmerge/sound";
import { usePixelMergeRank, type RankTab } from "./PixelMergeRank";

/*
 * 픽셀 머지 — 화면
 *  로딩(공 그림 · 소리 다 받고) → 첫 화면(오늘의 판 · 무한 모드) → 판 → 게임 오버(기록 · 랭킹 · 다시)
 *  판 자체(물리 · 그리기)는 lib/pixelmerge/game.ts
 */

const fmt = (n: number) => n.toLocaleString("ko-KR");
const BALL = (k: string) => `/pixelmerge/balls/${k}.webp`;

// ───────────────── 로딩 ─────────────────

function useAssets() {
  const [pct, setPct] = useState(0);
  const [imgs, setImgs] = useState<HTMLImageElement[] | null>(null);
  useEffect(() => {
    let off = false;
    let a = 0,
      s = 0,
      sTotal = 14;
    const bump = () => !off && setPct(Math.round(((a + s) / (TIERS.length + sTotal)) * 100));
    const list = TIERS.map((t) => {
      const im = new Image();
      im.decoding = "async";
      im.src = BALL(t.key);
      return im;
    });
    const pics = Promise.all(
      list.map(
        (im) =>
          new Promise<void>((ok) => {
            const done = () => {
              a++;
              bump();
              ok();
            };
            if (im.complete) done();
            else {
              im.onload = done;
              im.onerror = done;
            }
          })
      )
    );
    const sounds = preloadSounds((d, t) => {
      s = d;
      sTotal = t;
      bump();
    });
    const fonts = Promise.race([
      document.fonts?.load('16px "Galmuri11"').catch(() => {}) ?? Promise.resolve(),
      new Promise((ok) => setTimeout(ok, 2500)),
    ]);
    void Promise.all([pics, sounds, fonts]).then(() => {
      if (off) return;
      setPct(100);
      setTimeout(() => !off && setImgs(list), 120);
    });
    return () => {
      off = true;
    };
  }, []);
  return { pct, imgs };
}

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

function SoundBtn() {
  const [mute, setMute] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 소리 설정은 화면이 뜬 뒤에 읽음
    setMute(getSound().mute);
    return onSoundChange(() => setMute(getSound().mute));
  }, []);
  return (
    <button
      type="button"
      className="pm-btn sq"
      title={mute ? "소리 켜기" : "소리 끄기"}
      aria-label={mute ? "소리 켜기" : "소리 끄기"}
      onClick={() => {
        setSound({ mute: !getSound().mute });
        playSfx("tap");
      }}
    >
      <Icon name={mute ? "mute" : "sound"} size={16} />
    </button>
  );
}

/** 진화표 (아직 안 만들어 본 단계는 ?) */
function Strip({ max, imgs }: { max: number; imgs: HTMLImageElement[] }) {
  return (
    <div className="pm-strip" aria-label="합치는 순서">
      {TIERS.map((t, i) => (
        <div key={t.key} className={i <= max ? "on" : ""}>
          { }
          <img src={imgs[i].src} alt={i <= max ? t.name : "?"} />
          <span>{i <= max ? t.name : "?"}</span>
        </div>
      ))}
    </div>
  );
}

// ───────────────── 앱 ─────────────────

interface Run {
  mode: Mode;
  day: string;
  /** 같은 모드를 다시 할 때 판을 새로 만들게 */
  n: number;
}

export default function PixelMergeApp() {
  const { pct, imgs } = useAssets();
  const ready = !!imgs;
  const store = useStore(ready);
  const [today, setToday] = useState(() => kstDay());
  const [run, setRun] = useState<Run | null>(null);
  const { spec: rankSpec, openRank, reload: reloadRank } = usePixelMergeRank(ready, today);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(prepareRuns, []);
  useEffect(() => {
    playBgm(!!run);
    return () => playBgm(false);
  }, [run]);
  // 자정이 지나면 오늘의 판이 바뀜 (첫 화면에 있을 때)
  useEffect(() => {
    const id = setInterval(() => {
      const d = kstDay();
      if (d !== today && !run) setToday(d);
    }, 30_000);
    return () => clearInterval(id);
  }, [today, run]);
  useEffect(() => {
    if (run) stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [run]);

  const start = (mode: Mode) => {
    playSfx("tap");
    setRun((r) => ({ mode, day: mode === "daily" ? today : "endless", n: (r?.n ?? 0) + 1 }));
  };

  return (
    <>
      <GameHeader
        icon="px:pixelmerge"
        title="픽셀 머지"
        en="PIXEL MERGE"
        accent="#FFCF4A"
        desc="같은 캐릭터끼리 합쳐서 트로피까지 — 오늘의 판 · 무한 모드 랭킹"
        tags={["머지 퍼즐", "물리 퍼즐", "데일리", "픽셀파이트"]}
        className="mx-auto w-full max-w-[520px]"
        rank={rankSpec}
      />
      <div ref={stageRef} className="pm mx-auto mt-3 w-full max-w-[520px]">
        {!imgs || !store ? (
          <div className="pm-loading">
            <b>공을 병에 채우는 중…</b>
            <div className="pm-loadbar">
              <i style={{ width: `${pct}%` }} />
            </div>
            <span>{pct}%</span>
          </div>
        ) : run ? (
          <Play
            key={`${run.mode}:${run.n}`}
            run={run}
            imgs={imgs}
            store={store}
            onHome={() => {
              playSfx("tap");
              setRun(null);
            }}
            onAgain={() => start(run.mode)}
            onRank={(t, d) => openRank(t, d)}
            onRanked={reloadRank}
          />
        ) : (
          <Home
            store={store}
            today={today}
            imgs={imgs}
            onStart={start}
            onRank={(t) => openRank(t)}
          />
        )}
      </div>
    </>
  );
}

// ───────────────── 첫 화면 ─────────────────

function Home({
  store,
  today,
  imgs,
  onStart,
  onRank,
}: {
  store: Store;
  today: string;
  imgs: HTMLImageElement[];
  onStart: (m: Mode) => void;
  onRank: (t: RankTab) => void;
}) {
  const d = store.days[today];
  return (
    <div className="pm-home">
      <div className="pm-hero">
        { }
        {[2, 5, 9, 3, 7].map((t, i) => (
          <img key={t} src={imgs[t].src} alt="" className={`b b${i}`} />
        ))}
        <h2>픽셀 머지</h2>
        <p>같은 캐릭터끼리 닿으면 합쳐져요. 합칠 때마다 그 캐릭터 기술이 터져요.</p>
      </div>
      <div className="pm-chips">
        <span>🔥 연속 {liveStreak(store)}일</span>
        <span>
          최고 단계 <b>{TIERS[store.maxTier].name}</b>
        </span>
      </div>
      <div className="pm-modes">
        <button type="button" className="pm-mode daily" onClick={() => onStart("daily")}>
          <small>
            오늘의 판 #{dayNo(today)} · {dayLabel(today)}
          </small>
          <b>오늘의 판</b>
          <span>모두 같은 순서로 공이 나와요 · 하루 중 최고 점수로 랭킹</span>
          <em>
            {d ? `오늘 최고 ${fmt(d.best)}점 · ${d.plays}판` : `처음 끝내면 회원 +${DAILY_GP} GP`}
          </em>
        </button>
        <button type="button" className="pm-mode endless" onClick={() => onStart("endless")}>
          <small>매판 랜덤</small>
          <b>무한 모드</b>
          <span>공 순서는 매판 달라요 · 전체 랭킹</span>
          <em>{store.endless ? `내 최고 ${fmt(store.endless)}점` : "아직 기록 없음"}</em>
        </button>
      </div>
      <div className="pm-row">
        <button type="button" className="pm-btn" onClick={() => onRank("daily")}>
          🏆 랭킹
        </button>
        <SoundBtn />
      </div>
      <Strip max={store.maxTier} imgs={imgs} />
    </div>
  );
}

// ───────────────── 판 ─────────────────

type Send = "idle" | "sending" | "done" | "error" | "kept";

function Play({
  run,
  imgs,
  store,
  onHome,
  onAgain,
  onRank,
  onRanked,
}: {
  run: Run;
  imgs: HTMLImageElement[];
  store: Store;
  onHome: () => void;
  onAgain: () => void;
  onRank: (t: RankTab, day?: string) => void;
  onRanked: () => void;
}) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<MergeGame | null>(null);
  const [score, setScore] = useState(0);
  const [next, setNext] = useState(0);
  const [over, setOver] = useState<(Result & { best: boolean }) | null>(null);
  const [w, setW] = useState(360);
  const board = run.mode === "daily" ? run.day : "endless";
  const best = run.mode === "daily" ? (store.days[run.day]?.best ?? 0) : store.endless;

  // 병 크기: 화면 높이에 맞춤 (폰에서 위아래로 안 움직이게)
  useEffect(() => {
    const fit = () => {
      const box = boxRef.current;
      if (!box) return;
      const availW = box.parentElement!.clientWidth;
      const availH = window.innerHeight - 116 - 150;
      setW(Math.max(240, Math.min(availW, availH * (W / H))));
    };
    fit();
    window.addEventListener("resize", fit);
    document.documentElement.classList.add("pm-playing");
    return () => {
      window.removeEventListener("resize", fit);
      document.documentElement.classList.remove("pm-playing");
    };
  }, []);
  useEffect(() => {
    gameRef.current?.fit();
  }, [w]);

  // 판 만들기 (matter-js 는 화면에서만 받음)
  useEffect(() => {
    let off = false;
    beginMerge(board);
    void Promise.all([import("matter-js"), import("@/lib/pixelmerge/game")]).then(([M, G]) => {
      if (off || !cvRef.current) return;
      const rng = run.mode === "daily" ? mulberry(daySeed(run.day)) : Math.random;
      gameRef.current = new G.MergeGame(
        (M.default ?? M) as typeof import("matter-js"),
        cvRef.current,
        rng,
        imgs,
        {
          onScore: setScore,
          onNext: (_c, n) => setNext(n),
          onTier: seeTier,
          sfx: (name, rate) => playSfx(name, 1, rate ?? 1),
          onOver: (r) => {
            const isBest = recordPlay(run.mode, run.day, r.score, r.maxTier);
            setOver({ ...r, best: isBest });
          },
        }
      );
    });
    return () => {
      off = true;
      gameRef.current?.destroy();
      gameRef.current = null;
    };
  }, [board, run.mode, run.day, imgs]);

  // 조작: 좌우로 겨누고 떼면 떨어뜨림 · 키보드 ← → 스페이스
  const aim = (e: PointerEvent) => {
    const g = gameRef.current,
      cv = cvRef.current;
    if (!g || !cv) return;
    const r = cv.getBoundingClientRect();
    g.aimX = ((e.clientX - r.left) / r.width) * W;
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const g = gameRef.current;
      if (!g) return;
      if (e.key === "ArrowLeft") g.aimX -= 18;
      else if (e.key === "ArrowRight") g.aimX += 18;
      else if (e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        g.drop();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  return (
    <div className="pm-play">
      <div className="pm-hud" style={{ width: w }}>
        <button type="button" className="pm-btn sq" aria-label="처음으로" onClick={onHome}>
          ←
        </button>
        <div className="sc">
          <small>{run.mode === "daily" ? `오늘의 판 #${dayNo(run.day)}` : "무한 모드"}</small>
          <b>{fmt(score)}</b>
          <small>최고 {fmt(Math.max(best, score))}</small>
        </div>
        <div className="nx">
          <small>다음</small>
          { }
          <img src={imgs[next].src} alt={TIERS[next].name} />
        </div>
        <SoundBtn />
      </div>
      <div ref={boxRef} className="pm-jar" style={{ width: w }}>
        <canvas
          ref={cvRef}
          className="pm-cv"
          style={{ width: w, height: (w * H) / W }}
          onPointerMove={aim}
          onPointerDown={(e) => {
            aim(e);
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          onPointerUp={(e) => {
            aim(e);
            gameRef.current?.drop();
          }}
        />
        {over && (
          <Over
            run={run}
            board={board}
            r={over}
            onAgain={onAgain}
            onHome={onHome}
            onRank={() => onRank(run.mode, run.mode === "daily" ? run.day : undefined)}
            onRanked={onRanked}
          />
        )}
      </div>
      <p className="pm-help">
        좌우로 겨누고 떼면 떨어져요 · 같은 캐릭터끼리 닿으면 합쳐져요 · 점선 위에 2초 머물면 끝
      </p>
    </div>
  );
}

// ───────────────── 게임 오버 ─────────────────

function Over({
  run,
  board,
  r,
  onAgain,
  onHome,
  onRank,
  onRanked,
}: {
  run: Run;
  board: string;
  r: Result & { best: boolean };
  onAgain: () => void;
  onHome: () => void;
  onRank: () => void;
  onRanked: () => void;
}) {
  const [send, setSend] = useState<Send>("idle");
  const [err, setErr] = useState("");
  const [gp, setGp] = useState(0);
  const [name, setName] = useState(() => loadStore().name ?? "");
  const [rank, setRank] = useState<{ pos: number; total: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const can = r.score > 0;

  const submit = useCallback(
    async (nick: string) => {
      setSend("sending");
      setErr("");
      try {
        const res = await submitMerge(board, {
          name: nick,
          score: r.score,
          drops: r.drops,
          maxTier: r.maxTier,
          time: r.time,
        });
        if (res.gp) setGp(res.gp);
        setSend(res.kept ? "kept" : "done");
        onRanked();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "기록을 올리지 못했어요.");
        setSend("error");
        throw e;
      }
    },
    [board, r, onRanked]
  );
  const auto = useAutoRank(can, submit);
  useEffect(() => {
    if (send !== "done" && send !== "kept") return;
    let off = false;
    getMergeSummary(board)
      .then((s) => !off && s.me && setRank({ pos: s.me.pos, total: Math.max(1, s.total) }))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [send, board]);

  const guestSend = () => {
    const n = name.trim().slice(0, RANK_NAME_MAX);
    if (!n) return;
    playSfx("tap");
    saveStore((s) => {
      s.name = n;
    });
    void submit(n).catch(() => {});
  };
  const share = async () => {
    const text = [
      `🟡 픽셀 머지 ${run.mode === "daily" ? `오늘의 판 #${dayNo(run.day)}` : "무한 모드"}`,
      `${fmt(r.score)}점 · 최고 ${TIERS[r.maxTier].name}${r.trophies ? ` · 트로피 ${r.trophies}개` : ""}`,
      "https://gunmo.my/games/pixelmerge/",
    ].join("\n");
    try {
      if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent))
        await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <div className="pm-over">
      <div className="card">
        <h3>게임 오버</h3>
        <p className="why">공이 점선 위에 2초 동안 머물렀어요</p>
        <div className="big">{fmt(r.score)}</div>
        {r.best && <div className="best">최고 기록!</div>}
        <dl>
          <dt>최고 단계</dt>
          <dd>{TIERS[r.maxTier].name}</dd>
          <dt>떨어뜨린 공</dt>
          <dd>{r.drops}개</dd>
          {r.trophies > 0 && (
            <>
              <dt>트로피</dt>
              <dd>{r.trophies}개</dd>
            </>
          )}
        </dl>
        {can && (
          <div className="rk">
            {send === "kept" ? (
              <span>전에 올린 기록이 더 높아서 그대로예요.</span>
            ) : send === "sending" || auto.state === "sending" ? (
              <span>기록 올리는 중…</span>
            ) : send === "done" ? (
              <b>
                랭킹에 올렸어요!
                {gp > 0 && <span className="gp"> +{gp.toLocaleString("ko-KR")} GP</span>}
              </b>
            ) : send === "error" ? (
              <span className="bad">{err}</span>
            ) : !auto.member ? (
              <span>이름을 남기면 랭킹에 올라가요.</span>
            ) : null}
            {rank && (
              <div className="pos">
                {run.mode === "daily" ? "오늘의 판" : "무한 모드"} <b>{rank.pos}위</b>
                <small>
                  {" "}
                  / {rank.total}명
                  {rank.total >= 3 &&
                    ` · 상위 ${Math.max(1, Math.round((rank.pos / rank.total) * 100))}%`}
                </small>
              </div>
            )}
            {!auto.member && (send === "idle" || send === "error") && (
              <div className="nm">
                <input
                  id="pm-name"
                  value={name}
                  maxLength={RANK_NAME_MAX}
                  placeholder="랭킹에 남길 이름"
                  aria-label="랭킹에 남길 이름"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && guestSend()}
                />
                <button type="button" onClick={guestSend} disabled={!name.trim()}>
                  올리기
                </button>
              </div>
            )}
          </div>
        )}
        <div className="acts">
          <button type="button" className="pm-btn go" onClick={onAgain}>
            다시 하기
          </button>
          <button type="button" className="pm-btn" onClick={onRank}>
            🏆 랭킹
          </button>
          <button type="button" className="pm-btn" onClick={share}>
            {copied ? "복사했어요!" : "공유"}
          </button>
          <button type="button" className="pm-btn" onClick={onHome}>
            처음으로
          </button>
        </div>
      </div>
    </div>
  );
}
