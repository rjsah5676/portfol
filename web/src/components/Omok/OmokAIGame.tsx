"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { omokSoundInfo, useMoveSound } from "@/hooks/useMoveSound";
import OmokBoard from "./OmokBoard";
import { boardMaxWidth } from "./boardSize";
import { END_REASON, SIDE_KO, SideBar } from "./OmokParts";
import { useOmokAI } from "./useOmokAI";
import {
  BOARD_NS,
  Omok,
  RULES,
  RULE_LABEL,
  otherStone,
  parseSq,
  stoneOf,
  threatAt,
  isBoardN,
  type BoardN,
  type Color,
  type Rule,
} from "@/lib/omok/engine";
import { DEFAULT_OMOK_BOT, OMOK_BOTS, type OmokBot } from "./omokBots";
import { SpeechBubble, useBotTalk } from "@/lib/botTalk";
import { scrollToGameTop } from "@/components/GameHeader";
import { clockLabel, omokScore } from "@/lib/aiScore";
import {
  NEW_CLOCK,
  RankSubmit,
  RankedToggle,
  useTurnClock,
  type TurnClock,
} from "@/components/AIRank";

const SAVE_KEY = "omok:ai";
/** 힌트는 가장 센 단계로 */
const HINT_AI = { depth: 6, ms: 1800, noise: 0, blunder: 0, vcf: true, guard: true };

interface Settings {
  me: Color;
  bot: string;
  rule: Rule;
  /** 판 줄 수 (15·19) */
  n?: BoardN;
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

export function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={disabled ? "opacity-50" : ""}>
      <div className="mb-1.5 font-mono text-xs text-white/40">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.v)}
            className={`cursor-pointer rounded-full px-3 py-1 font-['Nanum_Gothic',sans-serif] text-xs transition-colors disabled:cursor-not-allowed ${
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

/** 기보: "흑 h8" 목록 */
export function OmokNotation({ moves }: { moves: string[] }) {
  return (
    <div className="thin-scroll max-h-44 overflow-y-auto rounded-xl border border-white/10 bg-[#1C1E24] p-2 lg:max-h-72">
      {moves.length === 0 ? (
        <p className="py-3 text-center font-mono text-xs text-white/30">아직 둔 수가 없습니다</p>
      ) : (
        <ol className="grid grid-cols-[2rem_1fr_2rem_1fr] gap-y-0.5 font-['Nanum_Gothic',sans-serif] text-xs">
          {moves.map((m, i) => (
            <li key={i} className="contents">
              <span className="px-1 font-mono text-white/30">{i + 1}.</span>
              <span className={`px-1 font-mono ${i % 2 === 0 ? "text-white/85" : "text-white/55"}`}>
                {SIDE_KO[i % 2 === 0 ? "w" : "b"]} {m.toUpperCase()}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function OmokAIGame({ numbers }: { numbers: boolean }) {
  const [settings, setSettings] = useState<Settings>({
    me: "w",
    bot: DEFAULT_OMOK_BOT,
    rule: "renju",
  });
  const [moves, setMoves] = useState<string[] | null>(null); // null = 설정 화면
  const [resigned, setResigned] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const [ranked, setRanked] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [hint, setHint] = useState<{ at: number; mv: string | null } | null>(null);
  const [hints, setHints] = useState(0);
  const [warn, setWarn] = useState("");
  const ask = useOmokAI();
  const loaded = useRef(false);

  // 랭킹전은 렌주룰로만
  const rule: Rule = ranked ? "renju" : settings.rule;
  // 랭킹전은 15줄로만
  const n: BoardN = ranked ? 15 : (settings.n ?? 15);
  const game = useMemo(() => Omok.replay(moves ?? [], rule, n), [moves, rule, n]);
  const fen = game.fen();
  useMoveSound(
    moves ? moves.length : -1,
    omokSoundInfo(fen, moves?.at(-1), settings.me),
    "chess"
  );
  const end = moves ? game.end() : null;
  const over = !!end || resigned;
  const ai: Color = settings.me === "w" ? "b" : "w";
  const bot: OmokBot = OMOK_BOTS.find((b) => b.id === settings.bot) ?? OMOK_BOTS[4];
  const { speech, say } = useBotTalk(bot.lines);
  const myTurn = !!moves && !over && game.turn() === settings.me;
  const { clock, setClock, seconds } = useTurnClock(myTurn && !thinking);

  // 이어하기 (저장 effect보다 먼저 와야 함)
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null") as Saved | null;
      if (v?.s && Array.isArray(v.moves)) {
        if (!OMOK_BOTS.some((b) => b.id === v.s.bot)) v.s.bot = DEFAULT_OMOK_BOT;
        if (!isBoardN(Number(v.s.n))) v.s.n = 15;
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
    ask(game.bd, ai, rule, bot.ai).then((mv) => {
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
    if (!moves || movesLen !== prev + 1 || movesLen <= 0 || game.end()) return;
    const i = parseSq(moves[movesLen - 1]);
    const byUser = (movesLen % 2 === 1 ? "w" : "b") === settings.me;
    const t = threatAt(game.bd, i, rule);
    if (byUser) {
      // 내 돌 자리에 AI가 뒀다면 위협이 됐을까 → 막은 것
      const bd = Int8Array.from(game.bd);
      bd[i] = otherStone(stoneOf(settings.me));
      const blocked = threatAt(bd, i, rule);
      if (t) say("userCheck");
      else if (blocked) say("userCapture");
      else say("move");
    } else if (t) say("aiCheck");
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
    if (end?.result === "1/2-1/2") return say("draw", 15000);
    const aiWon = resigned || (!!end && (end.result === "1-0" ? "w" : "b") === ai);
    say(aiWon ? "aiWin" : "aiLose", 15000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [over]);

  /** 끝난 뒤 같은 상대·설정으로 바로 한 판 더 */
  const restart = () => {
    setResigned(false);
    setSubmitted(false);
    setClock(NEW_CLOCK);
    setHint(null);
    setHints(0);
    setWarn("");
    setMoves([]);
    say("greet");
  };

  if (!moves) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-white/10 bg-[#1C1E24] p-5">
        <div className="mb-4 font-mono text-xs text-white/40">AI와 두기</div>
        <div className="flex flex-col gap-4">
          <Seg
            label="내 돌"
            value={settings.me}
            onChange={(me) => setSettings((s) => ({ ...s, me }))}
            options={[
              { v: "w", label: "흑 (선수)" },
              { v: "b", label: "백 (후수)" },
            ]}
          />
          <div>
            <div className="mb-1.5 font-mono text-xs text-white/40">
              상대 (급수는 대략적인 체감 기준)
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {OMOK_BOTS.map((b) => (
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
          <RankedToggle
            on={ranked}
            onChange={setRanked}
            desc="렌주룰 · 무르기·힌트 불가 · 이기면 상대 실력, 적은 수, 짧은 시간으로 점수를 매겨요"
          />
          <div>
            <Seg
              label="규칙"
              value={rule}
              disabled={ranked}
              onChange={(r) => setSettings((s) => ({ ...s, rule: r }))}
              options={RULES.map((r) => ({ v: r.v, label: r.label }))}
            />
            <p className="mt-1.5 font-['Nanum_Gothic',sans-serif] text-[11px] text-white/40">
              {ranked ? "랭킹전은 렌주룰로만 둬요 · " : ""}
              {RULES.find((r) => r.v === rule)?.desc}
            </p>
          </div>
          <div>
            <Seg
              label="판"
              value={String(n) as "15" | "19"}
              disabled={ranked}
              onChange={(v) => setSettings((s) => ({ ...s, n: Number(v) as BoardN }))}
              options={BOARD_NS.map((b) => ({ v: String(b.v) as "15" | "19", label: b.label }))}
            />
            <p className="mt-1.5 font-['Nanum_Gothic',sans-serif] text-[11px] text-white/40">
              {ranked ? "랭킹전은 15줄로만 둬요 · " : ""}
              {n === 19 ? "19×19 — 둘 자리가 넓어서 길게 둬요" : "15×15 — 오목 기본 판"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setResigned(false);
              setSubmitted(false);
              setClock(NEW_CLOCK);
              setHint(null);
              setHints(0);
              setWarn("");
              if (ranked) setSettings((s) => ({ ...s, rule: "renju", n: 15 }));
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

  const bottom = settings.me;
  const top = ai;
  const undo = () => {
    // 내 차례로 돌아가도록 (AI 수 + 내 수)
    setMoves((m) => {
      if (!m) return m;
      let n = m.length - 1;
      const turnAt = (len: number): Color => (len % 2 === 0 ? "w" : "b");
      while (n > 0 && turnAt(n) !== settings.me) n -= 1;
      return turnAt(n) === settings.me ? m.slice(0, Math.max(0, n)) : m;
    });
    setResigned(false);
    setWarn("");
    say("undo");
  };

  const myMoves = settings.me === "w" ? Math.ceil(moves.length / 2) : Math.floor(moves.length / 2);
  const won = !resigned && !!end && end.result === (settings.me === "w" ? "1-0" : "0-1");
  const forbidCount = myTurn ? game.forbiddenPoints().length : 0;

  let status: React.ReactNode;
  if (resigned) status = <span className="text-white">기권 · {bot.name} 승리</span>;
  else if (end) {
    status =
      end.result === "1/2-1/2" ? (
        <span className="text-white">무승부 · {END_REASON[end.reason]}</span>
      ) : (
        <>
          <span className={won ? "text-[#8B84FF]" : "text-white"}>{won ? "승리!" : "패배"}</span>
          <span className="text-white/50"> · {END_REASON[end.reason]}</span>
        </>
      );
  } else if (thinking)
    status = <span className="text-white/60">{bot.name}이(가) 생각하는 중…</span>;
  else
    status = (
      <>
        {myTurn ? "내 차례" : `${SIDE_KO[game.turn()]} 차례`}
        {myTurn && rule === "renju" && moves.length === 0 && (
          <span className="mt-1 block text-[11px] text-amber-200/70">
            렌주룰: 첫 수는 천원(가운데)에 둬요
          </span>
        )}
        {forbidCount > 0 && (
          <span className="mt-1 block text-[11px] text-red-300/80">
            ✕ 표시는 금수 자리라 둘 수 없어요
          </span>
        )}
      </>
    );

  return (
    <div className="flex flex-col items-center gap-5 lg:flex-row lg:items-start lg:justify-center">
      <div className="w-full" style={{ maxWidth: boardMaxWidth(n, 300) }}>
        <div className="relative">
          <SideBar
            color={top}
            name={`${bot.emoji} ${bot.name} · ${bot.rank}`}
            active={!over && game.turn() === top}
          />
          <SpeechBubble speech={speech} />
        </div>
        <OmokBoard
          fen={fen}
          canMove={myTurn && !thinking}
          lastMove={moves.at(-1)}
          onMove={(mv) => {
            const why = game.illegal(parseSq(mv));
            if (why) return setWarn(why);
            setWarn("");
            setMoves((m) => (m ? [...m, mv] : m));
          }}
          winLine={game.winLine}
          hint={!ranked && hint?.at === moves.length ? hint.mv : null}
          numbers={numbers ? moves : null}
        />
        <SideBar color={bottom} name="나" active={!over && game.turn() === bottom} />
      </div>

      <div className="flex w-full max-w-[560px] flex-col gap-3 lg:w-72">
        <div className="rounded-xl border border-white/10 bg-[#1C1E24] px-4 py-3 font-['Nanum_Gothic',sans-serif] text-sm text-white/80">
          {status}
          <div className="mt-1 font-mono text-[11px] text-white/35">
            {RULE_LABEL[rule]} · {n}줄
          </div>
          {ranked && (
            <div className="mt-1 font-mono text-[11px] text-[#FDE047]/80">
              🏆 랭킹전 · ⏱ {clockLabel(seconds)} · {myMoves}수
            </div>
          )}
        </div>
        {warn && (
          <div
            className="rounded-lg bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300"
            onClick={() => setWarn("")}
          >
            {warn}
          </div>
        )}
        {ranked && won && end && (
          <RankSubmit
            coll="omok_ai_rankings"
            result={omokScore(OMOK_BOTS.indexOf(bot) + 1, myMoves, seconds, settings.me === "b")}
            entry={{ opp: bot.id, moves: myMoves, seconds, lead: 0 }}
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
                const mv = await ask(game.bd, settings.me, rule, HINT_AI);
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
        <OmokNotation moves={moves} />
        <p className="px-1 font-['Nanum_Gothic',sans-serif] text-[11px] leading-relaxed text-white/30">
          대국은 이 브라우저에 저장돼서 나갔다 와도 이어서 둘 수 있어요. 휴대폰에서는 한 번 눌러
          자리를 고르고, 같은 자리를 한 번 더 누르면 돌이 놓여요.
        </p>
      </div>
    </div>
  );
}
