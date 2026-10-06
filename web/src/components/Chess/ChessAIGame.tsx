"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { chessSoundInfo, useMoveSound } from "@/hooks/useMoveSound";
import { Chess } from "chess.js";
import ChessBoard, { Piece } from "./ChessBoard";
import { CHESS_BOTS, type ChessBot } from "./chessBots";
import { useStockfish } from "./useStockfish";
import { replay, uciToMove, type Color } from "@/firestore/chessGame";
import { SpeechBubble, useBotTalk } from "@/lib/botTalk";
import { scrollToGameTop } from "@/components/GameHeader";
import { chessScore, clockLabel } from "@/lib/aiScore";
import {
  NEW_CLOCK,
  RankSubmit,
  RankedToggle,
  useTurnClock,
  type TurnClock,
} from "@/components/AIRank";

const SAVE_KEY = "chess:ai";
const COLOR_KO = { w: "백", b: "흑" } as const;
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const START: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };

const btn =
  "cursor-pointer rounded-full border border-white/15 px-3 py-1.5 font-mono text-xs whitespace-nowrap text-white/75 transition-colors hover:border-[#6C63FF]/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-30";
const primaryBtn =
  "cursor-pointer rounded-full bg-[#6C63FF] px-4 py-1.5 font-mono text-xs whitespace-nowrap text-white transition-colors hover:bg-[#5b52f0] disabled:cursor-not-allowed disabled:opacity-40";

interface Saved {
  me: Color;
  rating: number;
  moves: string[];
  resigned: boolean;
  ranked?: boolean;
  clock?: TurnClock;
  submitted?: boolean;
}

/** 각 색이 잡은 상대 기물 + 점수 */
function captured(game: Chess) {
  const left: Record<Color, Record<string, number>> = { w: {}, b: {} };
  game
    .board()
    .flat()
    .forEach((p) => {
      if (p && p.type !== "k") left[p.color][p.type] = (left[p.color][p.type] ?? 0) + 1;
    });
  const list: Record<Color, string[]> = { w: [], b: [] };
  const points: Record<Color, number> = { w: 0, b: 0 };
  for (const t of ["q", "r", "b", "n", "p"])
    for (const c of ["w", "b"] as Color[]) {
      const opp: Color = c === "w" ? "b" : "w";
      const n = Math.max(0, START[t] - (left[opp][t] ?? 0));
      for (let i = 0; i < n; i++) list[c].push(t);
      points[c] += n * VALUE[t];
    }
  return { list, points };
}

function endText(game: Chess, me: Color): { head: string; why: string } | null {
  if (game.isCheckmate()) {
    const winner: Color = game.turn() === "w" ? "b" : "w";
    return { head: winner === me ? "승리!" : "패배", why: "체크메이트" };
  }
  if (game.isStalemate()) return { head: "무승부", why: "스테일메이트" };
  if (game.isInsufficientMaterial()) return { head: "무승부", why: "기물 부족" };
  if (game.isThreefoldRepetition()) return { head: "무승부", why: "3회 동형반복" };
  if (game.isDrawByFiftyMoves()) return { head: "무승부", why: "50수 규칙" };
  return null;
}

function Bar({
  label,
  sub,
  color,
  caps,
  diff,
  active,
}: {
  label: React.ReactNode;
  sub?: string;
  color: Color;
  caps: string[];
  diff: number;
  active: boolean;
}) {
  const opp: Color = color === "w" ? "b" : "w";
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${active ? "bg-emerald-400" : "bg-white/20"}`}
          />
          <span className="truncate font-['Nanum_Gothic',sans-serif] text-sm text-white/90">
            {label}
          </span>
          {sub && <span className="shrink-0 font-mono text-[11px] text-white/40">{sub}</span>}
          <span className="shrink-0 font-mono text-[10px] text-white/35">{COLOR_KO[color]}</span>
        </div>
        <div className="flex min-h-[18px] items-center gap-1 pl-4">
          <span className="flex items-center">
            {caps.map((t, i) => (
              <Piece key={i} type={t} color={opp} className="-mr-0.5 text-[15px]" />
            ))}
          </span>
          {diff > 0 && (
            <span className="rounded bg-[#6C63FF]/25 px-1.5 font-mono text-[11px] text-[#B7B2FF]">
              +{diff}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ChessAIGame() {
  const [me, setMe] = useState<Color | "r">("w");
  const [rating, setRating] = useState(1200);
  const [moves, setMoves] = useState<string[] | null>(null);
  const [myColor, setMyColor] = useState<Color>("w");
  const [resigned, setResigned] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const [ranked, setRanked] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // 힌트: 몇 번째 수에서 받은 건지 같이 들고, 판이 바뀌면 자동으로 안 보임
  const [hint, setHint] = useState<{ at: number; mv: string | null } | null>(null);
  const [hints, setHints] = useState(0);
  const { bestMove, newGame } = useStockfish();
  const loaded = useRef(false);

  const bot: ChessBot = CHESS_BOTS.find((b) => b.rating === rating) ?? CHESS_BOTS[2];
  const game = useMemo(() => replay(moves ?? []), [moves]);
  useMoveSound(
    moves ? moves.length : -1,
    chessSoundInfo(game.fen(), moves?.at(-1), myColor),
    "chess"
  );
  const end = moves ? endText(game, myColor) : null;
  const over = !!end || resigned;
  const aiColor: Color = myColor === "w" ? "b" : "w";
  const myTurn = !!moves && !over && game.turn() === myColor;
  const { clock, setClock, seconds } = useTurnClock(myTurn && !thinking);
  // 이어하기 (저장 effect보다 먼저 와야 함)
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null") as Saved | null;
      if (v && Array.isArray(v.moves)) {
        replay(v.moves); // 깨진 기록이면 throw → 무시
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 대국 복원 (마운트 1회)
        setMyColor(v.me);
        setRating(v.rating);
        setMoves(v.moves);
        setResigned(!!v.resigned);
        setRanked(!!v.ranked);
        setSubmitted(!!v.submitted);
        if (v.clock) setClock(v.clock);
      }
    } catch {}
    loaded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 1회
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      if (moves)
        localStorage.setItem(
          SAVE_KEY,
          JSON.stringify({
            me: myColor,
            rating,
            moves,
            resigned,
            ranked,
            clock,
            submitted,
          } satisfies Saved)
        );
      else localStorage.removeItem(SAVE_KEY);
    } catch {}
  }, [moves, myColor, rating, resigned, ranked, submitted, clock]);

  // AI 차례
  const len = moves?.length ?? -1;
  useEffect(() => {
    if (!moves || over || game.turn() !== aiColor) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- AI 계산 표시
    setThinking(true);
    const started = performance.now();
    (async () => {
      let mv: string | null = null;
      const legal = game.moves({ verbose: true });
      if (Math.random() < bot.random && legal.length) {
        const m = legal[Math.floor(Math.random() * legal.length)];
        mv = m.from + m.to + (m.promotion ?? "");
      } else mv = await bestMove(game.fen(), bot);
      if (!mv && legal.length) {
        const m = legal[0];
        mv = m.from + m.to + (m.promotion ?? "");
      }
      const wait = Math.max(0, 450 - (performance.now() - started));
      setTimeout(() => {
        if (!alive) return;
        setThinking(false);
        if (mv) setMoves((cur) => (cur && cur.length === len ? [...cur, mv!] : cur));
      }, wait);
    })();
    return () => {
      alive = false;
      setThinking(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [len, over, aiColor, rating]);

  const history = useMemo(() => game.history(), [game]);

  // ── 대사 ──
  const { speech, say } = useBotTalk(bot.lines);
  const seenLen = useRef(len);
  useEffect(() => {
    const prev = seenLen.current;
    seenLen.current = len;
    if (len !== prev + 1 || len <= 0) return; // 한 수 진행됐을 때만 (복원·무르기 제외)
    const last = game.history({ verbose: true }).at(-1);
    if (!last) return;
    const byUser = last.color === myColor;
    const check = /[+#]/.test(last.san);
    if (byUser) {
      if (last.captured && VALUE[last.captured] >= 5) say("userBigCapture");
      else if (last.captured) say("userCapture");
      else if (check) say("userCheck");
      else say("move");
    } else if (check) say("aiCheck");
    else if (last.captured) say("aiCapture");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [len]);
  const endSaid = useRef(false);
  useEffect(() => {
    if (!over) {
      endSaid.current = false;
      return;
    }
    if (endSaid.current) return;
    endSaid.current = true;
    if (resigned || end?.head === "패배") say("aiWin", 15000);
    else if (end?.head === "승리!") say("aiLose", 15000);
    else say("draw", 15000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [over]);

  /** 끝난 뒤 같은 상대로 바로 한 판 더 (색은 처음 고른 대로, 랜덤이면 다시 뽑음) */
  const restart = () => {
    setMyColor(me === "r" ? (Math.random() < 0.5 ? "w" : "b") : me);
    setResigned(false);
    setSubmitted(false);
    setClock(NEW_CLOCK);
    setHint(null);
    setHints(0);
    newGame();
    setMoves([]);
    say("greet");
  };

  if (!moves) {
    const start = () => {
      const c: Color = me === "r" ? (Math.random() < 0.5 ? "w" : "b") : me;
      setMyColor(c);
      setResigned(false);
      setSubmitted(false);
      setClock(NEW_CLOCK);
      setHint(null);
      setHints(0);
      setTimeout(scrollToGameTop, 50);
      newGame();
      setMoves([]);
      say("greet");
    };
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-white/10 bg-[#1C1E24] p-4 sm:p-5">
        <div className="mb-3 font-mono text-xs text-white/40">
          상대 고르기 (레이팅은 대략적인 체감 기준)
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CHESS_BOTS.map((b) => (
            <button
              key={b.rating}
              type="button"
              onClick={() => setRating(b.rating)}
              className={`flex cursor-pointer flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                rating === b.rating
                  ? "border-[#6C63FF]/70 bg-[#6C63FF]/15"
                  : "border-white/10 bg-white/[0.03] hover:border-white/25"
              }`}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-xl">{b.emoji}</span>
                <span className="font-mono text-sm font-bold text-[#B7B2FF]">{b.rating}</span>
              </span>
              <span className="font-['Nanum_Gothic',sans-serif] text-sm text-white">{b.name}</span>
              <span className="font-['Nanum_Gothic',sans-serif] text-[11px] text-white/40">
                {b.desc}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-4 mb-1.5 font-mono text-xs text-white/40">내 색</div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["w", "♔ 백 (선공)"],
              ["b", "♚ 흑 (후공)"],
              ["r", "랜덤"],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setMe(v)}
              className={`cursor-pointer rounded-full px-3 py-1 font-mono text-xs transition-colors ${
                me === v ? "bg-[#6C63FF] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="mt-4">
          <RankedToggle on={ranked} onChange={setRanked} />
        </div>
        <button type="button" onClick={start} className={`${primaryBtn} mt-4 w-full py-2 text-sm`}>
          {bot.emoji} {bot.name}({bot.rating})와 {ranked ? "랭킹전" : "대국"} 시작
        </button>
      </div>
    );
  }

  const caps = captured(game);
  const undo = () => {
    setMoves((m) => {
      if (!m) return m;
      // 내 차례로 돌아가게 (AI 수 + 내 수)
      const turnAt = (n: number): Color => (n % 2 === 0 ? "w" : "b");
      let n = m.length - 1;
      while (n > 0 && turnAt(n) !== myColor) n -= 1;
      return turnAt(n) === myColor && n >= 0 ? m.slice(0, n) : m;
    });
    setResigned(false);
    say("undo");
  };

  let status: React.ReactNode;
  if (resigned) status = <span className="text-white">기권 · {bot.name} 승리</span>;
  else if (end)
    status = (
      <>
        <span className={end.head === "승리!" ? "text-[#8B84FF]" : "text-white"}>{end.head}</span>
        <span className="text-white/50"> · {end.why}</span>
      </>
    );
  else if (thinking) status = <span className="text-white/60">{bot.name}이(가) 생각하는 중…</span>;
  else
    status = (
      <>
        {myTurn ? "내 차례" : `${COLOR_KO[game.turn()]} 차례`}
        {game.inCheck() && <span className="ml-2 text-red-400">체크!</span>}
      </>
    );

  const myMoves = myColor === "w" ? Math.ceil(moves.length / 2) : Math.floor(moves.length / 2);
  const lead = caps.points[myColor] - caps.points[aiColor];
  const won = !resigned && end?.head === "승리!";

  const pairs: [string, string | undefined][] = [];
  for (let i = 0; i < history.length; i += 2) pairs.push([history[i], history[i + 1]]);

  return (
    <div className="flex flex-col items-center gap-5 lg:flex-row lg:items-start lg:justify-center">
      <div className="w-full max-w-[max(300px,min(560px,calc(100dvh-420px)))]">
        <div className="relative">
          <Bar
            label={`${bot.emoji} ${bot.name}`}
            sub={String(bot.rating)}
            color={aiColor}
            caps={caps.list[aiColor]}
            diff={caps.points[aiColor] - caps.points[myColor]}
            active={!over && game.turn() === aiColor}
          />
          <SpeechBubble speech={speech} />
        </div>
        <ChessBoard
          fen={game.fen()}
          orientation={myColor}
          canMove={myTurn && !thinking}
          lastMove={moves.at(-1)}
          hint={!ranked && hint?.at === moves.length ? hint.mv : null}
          onMove={(uci) => {
            try {
              new Chess(game.fen()).move(uciToMove(uci));
              setMoves((m) => (m ? [...m, uci] : m));
            } catch {}
          }}
        />
        <Bar
          label="나"
          color={myColor}
          caps={caps.list[myColor]}
          diff={caps.points[myColor] - caps.points[aiColor]}
          active={!over && game.turn() === myColor}
        />
      </div>
      <div className="flex w-full max-w-[560px] flex-col gap-3 lg:w-72">
        <div className="rounded-xl border border-white/10 bg-[#1C1E24] px-4 py-3 font-['Nanum_Gothic',sans-serif] text-sm text-white/80">
          {status}
          {ranked && (
            <div className="mt-1 font-mono text-[11px] text-[#FDE047]/80">
              🏆 랭킹전 · ⏱ {clockLabel(seconds)} · {myMoves}수
            </div>
          )}
        </div>
        {ranked && won && (
          <RankSubmit
            coll="chess_ai_rankings"
            result={chessScore(
              CHESS_BOTS.findIndex((b) => b.rating === rating) + 1,
              lead,
              myMoves,
              seconds
            )}
            entry={{ opp: String(rating), moves: myMoves, seconds, lead: Math.max(0, lead) }}
            done={submitted}
            onSaved={() => setSubmitted(true)}
          />
        )}
        <div className="flex flex-wrap gap-1.5">
          {!ranked && (
            <button
              type="button"
              disabled={thinking || moves.length === 0}
              onClick={undo}
              className={btn}
            >
              ↶ 무르기
            </button>
          )}
          {!ranked && !over && (
            <button
              type="button"
              disabled={!myTurn || thinking || hint?.at === moves.length}
              onClick={async () => {
                const at = moves.length;
                setHint({ at, mv: null });
                const mv = await bestMove(game.fen(), null);
                setHint((h) => (h?.at === at ? { at, mv } : h));
                if (mv) setHints((n) => n + 1);
              }}
              className={btn}
              title="엔진이 추천하는 수를 판에 표시"
            >
              {hint?.at === moves.length && !hint.mv
                ? "💡 생각 중…"
                : `💡 힌트${hints ? ` ${hints}` : ""}`}
            </button>
          )}
          {!over &&
            (confirmResign ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmResign(false);
                    setResigned(true);
                  }}
                  className="cursor-pointer rounded-full bg-red-500/85 px-3 py-1.5 font-mono text-xs text-white hover:bg-red-500"
                >
                  네, 기권할게요
                </button>
                <button type="button" onClick={() => setConfirmResign(false)} className={btn}>
                  계속 둘래요
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmResign(true)} className={btn}>
                ⚑ 기권
              </button>
            ))}
          {over && (
            <button type="button" onClick={restart} className={primaryBtn}>
              ↻ 다시 하기
            </button>
          )}
          <button type="button" onClick={() => setMoves(null)} className={btn}>
            상대 바꾸기
          </button>
        </div>
        <div className="thin-scroll max-h-44 overflow-y-auto rounded-xl border border-white/10 bg-[#1C1E24] p-2 lg:max-h-72">
          {pairs.length === 0 ? (
            <p className="py-3 text-center font-mono text-xs text-white/30">
              아직 둔 수가 없습니다
            </p>
          ) : (
            <div className="grid grid-cols-[2.2rem_1fr_1fr] gap-y-0.5 font-mono text-xs">
              {pairs.map(([w, b], i) => (
                <div key={i} className="contents">
                  <span className="px-1 text-white/30">{i + 1}.</span>
                  <span className="px-1 text-white/80">{w}</span>
                  <span className="px-1 text-white/80">{b ?? ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="px-1 font-['Nanum_Gothic',sans-serif] text-[11px] leading-relaxed text-white/30">
          AI는 Stockfish(GPL) 엔진을 브라우저에서 돌려요. 대국은 이 브라우저에 저장돼서 나갔다 와도
          이어서 둘 수 있어요.
        </p>
      </div>
    </div>
  );
}
