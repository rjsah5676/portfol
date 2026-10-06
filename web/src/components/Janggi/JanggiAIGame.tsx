"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { janggiSoundInfo, useMoveSound } from "@/hooks/useMoveSound";
import JanggiBoard from "./JanggiBoard";
import { END_REASON, SIDE_KO, SideBar } from "./JanggiParts";
import { useJanggiAI } from "./useJanggiAI";
import {
  C,
  Janggi,
  R,
  SETUPS,
  describeMove,
  parseSq,
  type Color,
  type Setup,
} from "@/lib/janggi/engine";
import { DEFAULT_JANGGI_BOT, JANGGI_BOTS, type JanggiBot } from "./janggiBots";
import { SpeechBubble, useBotTalk } from "@/lib/botTalk";
import { scrollToGameTop } from "@/components/GameHeader";
import { clockLabel, janggiScore } from "@/lib/aiScore";
import {
  NEW_CLOCK,
  RankSubmit,
  RankedToggle,
  useTurnClock,
  type TurnClock,
} from "@/components/AIRank";

const SAVE_KEY = "janggi:ai";
/** 힌트는 가장 센 단계로 */
const HINT_AI = { depth: 6, ms: 1500, noise: 0, blunder: 0 };

interface Settings {
  me: Color;
  bot: string;
  mySetup: Setup;
  aiSetup: Setup;
}
interface Saved {
  s: Settings;
  moves: string[];
  resigned: boolean;
  ranked?: boolean;
  clock?: TurnClock;
  submitted?: boolean;
}

const btn =
  "cursor-pointer rounded-full border border-white/15 px-3 py-1.5 font-mono text-xs whitespace-nowrap text-white/75 transition-colors hover:border-[#6C63FF]/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-30";
const primaryBtn =
  "cursor-pointer rounded-full bg-[#6C63FF] px-4 py-1.5 font-mono text-xs whitespace-nowrap text-white transition-colors hover:bg-[#5b52f0] disabled:cursor-not-allowed disabled:opacity-40";

function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-xs text-white/40">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`cursor-pointer rounded-full px-3 py-1 font-['Nanum_Gothic',sans-serif] text-xs transition-colors ${
              value === o.v
                ? "bg-[#6C63FF] text-white"
                : "bg-white/5 text-white/60 hover:bg-white/10"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function JanggiAIGame({ hangul }: { hangul: boolean }) {
  const [settings, setSettings] = useState<Settings>({
    me: "w",
    bot: DEFAULT_JANGGI_BOT,
    mySetup: "heeh",
    aiSetup: "heeh",
  });
  const [moves, setMoves] = useState<string[] | null>(null); // null = 설정 화면
  const [resigned, setResigned] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const [ranked, setRanked] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [hint, setHint] = useState<{ at: number; mv: string | null } | null>(null);
  const [hints, setHints] = useState(0);
  const ask = useJanggiAI();
  const loaded = useRef(false);

  const setup = useMemo(
    () =>
      settings.me === "w"
        ? { w: settings.mySetup, b: settings.aiSetup }
        : { w: settings.aiSetup, b: settings.mySetup },
    [settings]
  );
  const game = useMemo(() => Janggi.replay(moves ?? [], setup), [moves, setup]);
  useMoveSound(
    moves ? moves.length : -1,
    janggiSoundInfo(game.fen(), moves?.at(-1), settings.me),
    "chess"
  );
  const end = moves ? game.end() : null;
  const over = !!end || resigned;
  const ai: Color = settings.me === "w" ? "b" : "w";
  const bot: JanggiBot = JANGGI_BOTS.find((b) => b.id === settings.bot) ?? JANGGI_BOTS[2];
  const { speech, say } = useBotTalk(bot.lines);
  const myTurn = !!moves && !over && game.turn() === settings.me;
  const { clock, setClock, seconds } = useTurnClock(myTurn && !thinking);
  // 이어하기 (저장 effect보다 먼저 와야 함)
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null") as Saved | null;
      if (v?.s && Array.isArray(v.moves)) {
        if (!JANGGI_BOTS.some((b) => b.id === v.s.bot)) v.s.bot = DEFAULT_JANGGI_BOT; // 예전 저장값
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 대국 복원 (마운트 1회)
        setSettings(v.s);
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
  const banned = useMemo(() => game.banned(), [game]);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      if (moves)
        localStorage.setItem(
          SAVE_KEY,
          JSON.stringify({ s: settings, moves, resigned, ranked, clock, submitted } satisfies Saved)
        );
      else localStorage.removeItem(SAVE_KEY);
    } catch {}
  }, [settings, moves, resigned, ranked, clock, submitted]);

  // AI 차례면 계산
  const movesLen = moves?.length ?? -1;
  useEffect(() => {
    if (!moves || over || game.turn() !== ai) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- AI 계산 시작 표시
    setThinking(true);
    const started = performance.now();
    ask(game.bd, ai, bot.ai, banned).then((mv) => {
      // 너무 빨리 두면 정신없어서 최소 0.4초
      const wait = Math.max(0, 400 - (performance.now() - started));
      setTimeout(() => {
        if (!alive) return;
        setThinking(false);
        if (mv) setMoves((m) => (m && m.length === movesLen ? [...m, mv] : m));
      }, wait);
    });
    return () => {
      alive = false;
      setThinking(false);
    };
    // movesLen이 바뀔 때만 (같은 국면에서 중복 계산 안 하게)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movesLen, over, ai, settings.bot]);

  // ── 대사: 한 수 진행될 때마다 상황에 맞게 ──
  const seenLen = useRef(movesLen);
  useEffect(() => {
    const prev = seenLen.current;
    seenLen.current = movesLen;
    if (!moves || movesLen !== prev + 1 || movesLen <= 0) return;
    const mv = moves[movesLen - 1];
    const byUser = (movesLen % 2 === 1 ? "w" : "b") === settings.me;
    const before = Janggi.replay(moves.slice(0, -1), setup);
    const capturedType = mv === "pass" ? 0 : Math.abs(before.bd[parseSq(mv.slice(2, 4))]);
    const check = game.inCheck();
    if (byUser) {
      if (capturedType === R || capturedType === C) say("userBigCapture");
      else if (capturedType) say("userCapture");
      else if (check) say("userCheck");
      else say("move");
    } else if (check) say("aiCheck");
    else if (capturedType) say("aiCapture");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movesLen]);
  const endSaid = useRef(false);
  useEffect(() => {
    if (!over) {
      endSaid.current = false;
      return;
    }
    if (endSaid.current) return;
    endSaid.current = true;
    const aiWon = resigned || (!!end && (end.result === "1-0" ? "w" : "b") === ai);
    say(aiWon ? "aiWin" : "aiLose", 15000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [over]);

  const notation = useMemo(() => {
    const g = new Janggi(setup);
    return (moves ?? []).map((m) => {
      const d = describeMove(g.bd, m);
      g.move(m, true);
      return d;
    });
  }, [moves, setup]);

  /** 끝난 뒤 같은 상대·설정으로 바로 한 판 더 */
  const restart = () => {
    setResigned(false);
    setSubmitted(false);
    setClock(NEW_CLOCK);
    setHint(null);
    setHints(0);
    setMoves([]);
    say("greet");
  };

  if (!moves) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-white/10 bg-[#1C1E24] p-5">
        <div className="mb-4 font-mono text-xs text-white/40">AI와 두기</div>
        <div className="flex flex-col gap-4">
          <Seg
            label="내 진영"
            value={settings.me}
            onChange={(me) => setSettings((s) => ({ ...s, me }))}
            options={[
              { v: "w", label: "초 (선공)" },
              { v: "b", label: "한 (후공 · 덤 1.5)" },
            ]}
          />
          <div>
            <div className="mb-1.5 font-mono text-xs text-white/40">
              상대 (급수는 대략적인 체감 기준)
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {JANGGI_BOTS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSettings((s) => ({ ...s, bot: b.id }))}
                  className={`flex cursor-pointer flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    settings.bot === b.id
                      ? "border-[#6C63FF]/70 bg-[#6C63FF]/15"
                      : "border-white/10 bg-white/[0.03] hover:border-white/25"
                  }`}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="text-xl">{b.emoji}</span>
                    <span className="font-mono text-xs font-bold text-[#B7B2FF]">{b.rank}</span>
                  </span>
                  <span className="font-['Nanum_Gothic',sans-serif] text-sm text-white">
                    {b.name}
                  </span>
                  <span className="font-['Nanum_Gothic',sans-serif] text-[11px] text-white/40">
                    {b.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <RankedToggle on={ranked} onChange={setRanked} />
          <Seg
            label="내 상차림"
            value={settings.mySetup}
            onChange={(mySetup) => setSettings((s) => ({ ...s, mySetup }))}
            options={SETUPS}
          />
          <Seg
            label="AI 상차림"
            value={settings.aiSetup}
            onChange={(aiSetup) => setSettings((s) => ({ ...s, aiSetup }))}
            options={SETUPS}
          />
          <button
            type="button"
            onClick={() => {
              setResigned(false);
              setSubmitted(false);
              setClock(NEW_CLOCK);
              setHint(null);
              setHints(0);
              setTimeout(scrollToGameTop, 50);
              setMoves([]);
              say("greet");
            }}
            className={`${primaryBtn} py-2 text-sm`}
          >
            {bot.emoji} {bot.name}({bot.rank})와 {ranked ? "랭킹전" : "대국"} 시작
          </button>
        </div>
      </div>
    );
  }

  const caps = game.captured();
  const bottom = settings.me;
  const top = ai;
  const undo = () => {
    // 내 차례로 돌아가도록 (AI 수 + 내 수)
    setMoves((m) => {
      if (!m) return m;
      let n = m.length;
      const turnAt = (len: number): Color => (len % 2 === 0 ? "w" : "b");
      n -= 1;
      while (n > 0 && turnAt(n) !== settings.me) n -= 1;
      return turnAt(n) === settings.me ? m.slice(0, Math.max(0, n)) : m;
    });
    setResigned(false);
    say("undo");
  };

  let status: React.ReactNode;
  if (resigned) status = <span className="text-white">기권 · {bot.name} 승리</span>;
  else if (end) {
    const win = (end.result === "1-0" ? "w" : "b") === settings.me;
    status = (
      <>
        <span className={win ? "text-[#8B84FF]" : "text-white"}>{win ? "승리!" : "패배"}</span>
        <span className="text-white/50"> · {END_REASON[end.reason]}</span>
        {end.reason !== "checkmate" && (
          <span className="text-white/40">
            {" "}
            (초 {game.score("w")} : 한 {game.score("b")})
          </span>
        )}
      </>
    );
  } else if (thinking)
    status = <span className="text-white/60">{bot.name}이(가) 생각하는 중…</span>;
  else
    status = (
      <>
        {myTurn ? "내 차례" : `${SIDE_KO[game.turn()]} 차례`}
        {game.inCheck() && <span className="ml-2 font-bold text-red-400">장군!</span>}
        {myTurn && banned.length > 0 && (
          <span className="mt-1 block text-[11px] text-amber-200/70">
            반복수 금지: 같은 국면을 세 번 만드는 수는 둘 수 없어요
          </span>
        )}
      </>
    );

  const myMoves = settings.me === "w" ? Math.ceil(moves.length / 2) : Math.floor(moves.length / 2);
  const lead = Math.round((game.score(settings.me) - game.score(ai)) * 10) / 10;
  const won = !resigned && !!end && (end.result === "1-0" ? "w" : "b") === settings.me;

  return (
    <div className="flex flex-col items-center gap-5 lg:flex-row lg:items-start lg:justify-center">
      <div className="w-full max-w-[max(300px,min(520px,calc((100dvh-420px)*0.9)))]">
        <div className="relative">
          <SideBar
            color={top}
            name={`${bot.emoji} ${bot.name} · ${bot.rank}`}
            captured={caps[bottom]}
            score={game.score(top)}
            active={!over && game.turn() === top}
            hangul={hangul}
          />
          <SpeechBubble speech={speech} />
        </div>
        <JanggiBoard
          fen={game.fen()}
          orientation={bottom}
          canMove={myTurn && !thinking}
          lastMove={moves.at(-1)}
          onMove={(mv) => setMoves((m) => (m ? [...m, mv] : m))}
          hangul={hangul}
          banned={banned}
          hint={!ranked && hint?.at === moves.length ? hint.mv : null}
        />
        <SideBar
          color={bottom}
          name="나"
          captured={caps[top]}
          score={game.score(bottom)}
          active={!over && game.turn() === bottom}
          hangul={hangul}
        />
      </div>

      <div className="flex w-full max-w-[520px] flex-col gap-3 lg:w-72">
        <div className="rounded-xl border border-white/10 bg-[#1C1E24] px-4 py-3 font-['Nanum_Gothic',sans-serif] text-sm text-white/80">
          {status}
          {ranked && (
            <div className="mt-1 font-mono text-[11px] text-[#FDE047]/80">
              🏆 랭킹전 · ⏱ {clockLabel(seconds)} · {myMoves}수
            </div>
          )}
        </div>
        {ranked && won && end && (
          <RankSubmit
            coll="janggi_ai_rankings"
            result={janggiScore(
              JANGGI_BOTS.indexOf(bot) + 1,
              lead,
              myMoves,
              seconds,
              end.reason === "checkmate"
            )}
            entry={{ opp: bot.id, moves: myMoves, seconds, lead: Math.max(0, lead) }}
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
                const mv = await ask(game.bd, settings.me, HINT_AI, banned);
                setHint((h) => (h?.at === at ? { at, mv } : h));
                if (mv) setHints((n) => n + 1);
              }}
              className={btn}
              title="가장 강한 AI가 생각한 수를 판에 표시"
            >
              {hint?.at === moves.length && !hint.mv
                ? "💡 생각 중…"
                : `💡 힌트${hints ? ` ${hints}` : ""}`}
            </button>
          )}
          <button
            type="button"
            disabled={!myTurn || thinking || !game.canPass()}
            onClick={() => setMoves((m) => (m ? [...m, "pass"] : m))}
            className={btn}
            title="장군이 아닐 때 한 수 쉬기"
          >
            한수쉼
          </button>
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
            {over ? "상대·설정 바꾸기" : "설정으로"}
          </button>
        </div>
        <div className="thin-scroll max-h-44 overflow-y-auto rounded-xl border border-white/10 bg-[#1C1E24] p-2 lg:max-h-72">
          {notation.length === 0 ? (
            <p className="py-3 text-center font-mono text-xs text-white/30">
              아직 둔 수가 없습니다
            </p>
          ) : (
            <ol className="grid grid-cols-[2rem_1fr] gap-y-0.5 font-['Nanum_Gothic',sans-serif] text-xs">
              {notation.map((d, i) => (
                <li key={i} className="contents">
                  <span className="px-1 font-mono text-white/30">{i + 1}.</span>
                  <span className="px-1" style={{ color: i % 2 === 0 ? "#7FA8F0" : "#F08A8F" }}>
                    {SIDE_KO[i % 2 === 0 ? "w" : "b"]} {d}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <p className="px-1 font-['Nanum_Gothic',sans-serif] text-[11px] leading-relaxed text-white/30">
          대국은 이 브라우저에 저장돼서 나갔다 와도 이어서 둘 수 있어요. 빅장·양쪽 한수쉼·200수는
          점수(한 덤 1.5)로 판정해요.
        </p>
      </div>
    </div>
  );
}
