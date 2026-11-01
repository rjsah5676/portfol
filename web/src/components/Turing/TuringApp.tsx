"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/http";
import { ApiError } from "@/lib/api/errors";

/*
 * AI 사람 찾기 (프로토) — 서버(/api/turing)가 판을 들고 있고, 화면은 그 상태를 그리기만 함.
 * AI 차례면 /next 를 불러 한 마디씩 받아 오고, 내 차례면 입력창 + 제한 시간, 투표 때는 후보 버튼.
 */

type Difficulty = "easy" | "normal" | "hard";

interface Msg {
  name: string | null;
  text: string;
  round: number;
}
interface VoteRec {
  round: number;
  votes: { from: string; to: string; reason: string }[];
  out: string;
  tie: boolean;
  human: boolean;
}
interface View {
  id: string;
  me: string;
  difficulty: Difficulty;
  round: number;
  maxRound: number;
  topic: string;
  phase: "talk" | "vote" | "over";
  turn: string | null;
  turnsLeft: number;
  players: { name: string; alive: boolean; outRound: number | null; me: boolean }[];
  messages: Msg[];
  votes: VoteRec[];
  result: null | {
    win: boolean;
    reveal: { name: string; human: boolean; label: string; company: string; fallbacks: number }[];
  };
}

const LEVELS: { key: Difficulty; label: string; desc: string; seconds: number }[] = [
  { key: "easy", label: "초급", desc: "AI들이 대충 듣고 반은 감으로 찍어요", seconds: 60 },
  { key: "normal", label: "중급", desc: "AI들이 서로 떠보고 대부분 근거로 투표해요", seconds: 45 },
  { key: "hard", label: "고급", desc: "AI들이 사람의 흔적을 집요하게 캐물어요", seconds: 30 },
];

/** 이름마다 고정 색 (판마다 이름이 바뀌어도 같은 이름은 같은 색) */
const PALETTE = ["#7AA2F7", "#F7768E", "#9ECE6A", "#E0AF68", "#BB9AF7", "#2AC3DE", "#FF9E64", "#73DACA"];
const colorOf = (name: string) => PALETTE[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** AI 답은 거의 즉시 오지만, 채팅처럼 보이게 글자 수만큼 "입력 중"을 보여 줌 */
const typingMs = (text: string) => Math.min(2600, 700 + text.length * 35);

const font = "font-['Nanum_Gothic',sans-serif]";

export default function TuringApp() {
  const [level, setLevel] = useState<Difficulty>("normal");
  const [view, setView] = useState<View | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [voting, setVoting] = useState(false);
  const [shownVote, setShownVote] = useState(0);
  const [draft, setDraft] = useState("");
  const [left, setLeft] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const v = await api<View>("/api/turing/start", { method: "POST", body: { difficulty: level } });
      setShownVote(0);
      setDraft("");
      setView(v);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "시작하지 못했어요.");
    } finally {
      setStarting(false);
    }
  };

  // 새 투표 결과가 생기면 결과 카드를 띄움 (닫을 때까지 진행 멈춤)
  const pendingVote = view && view.votes.length > shownVote ? view.votes[view.votes.length - 1] : null;

  // AI 차례: 한 마디씩 받아 옴
  const step = useCallback(async (v: View) => {
    if (busy.current) return;
    busy.current = true;
    setTyping(v.turn);
    try {
      const t0 = Date.now();
      let next: View | null = null;
      for (let i = 0; i < 6 && !next; i++) {
        try {
          next = await api<View>("/api/turing/next", { method: "POST", body: { id: v.id }, timeoutMs: 60_000 });
        } catch (e) {
          if (e instanceof ApiError && e.code === "BUSY") await sleep(600);
          else throw e;
        }
      }
      if (!next) throw new Error("응답이 없어요.");
      const last = next.messages[next.messages.length - 1];
      const wait = typingMs(last?.text ?? "") - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
      setView(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "AI 응답을 받지 못했어요.");
    } finally {
      setTyping(null);
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (!view || error || pendingVote) return;
    if (view.phase === "talk" && view.turn && view.turn !== view.me) void step(view);
  }, [view, error, pendingVote, step]);

  // 내 차례 제한 시간
  const myTurn = !!view && view.phase === "talk" && view.turn === view.me && !pendingVote;
  const seconds = LEVELS.find((l) => l.key === view?.difficulty)?.seconds ?? 45;
  useEffect(() => {
    if (!myTurn) return;
    setLeft(seconds);
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [myTurn, seconds, view?.messages.length]);

  const say = useCallback(
    async (text: string) => {
      if (!view || busy.current) return;
      busy.current = true;
      try {
        const v = await api<View>("/api/turing/say", { method: "POST", body: { id: view.id, text } });
        setDraft("");
        setView(v);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "보내지 못했어요.");
      } finally {
        busy.current = false;
      }
    },
    [view]
  );

  useEffect(() => {
    if (myTurn && left === 0) void say(draft);
    // 시간이 다 됐을 때 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const vote = async (target: string) => {
    if (!view || voting) return;
    setVoting(true);
    try {
      const v = await api<View>("/api/turing/vote", { method: "POST", body: { id: view.id, target }, timeoutMs: 90_000 });
      setView(v);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "투표하지 못했어요.");
    } finally {
      setVoting(false);
    }
  };

  // 새 메시지 · 입력 중 표시가 생기면 맨 아래로
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view?.messages.length, typing]);

  // ── 시작 화면 ──
  if (!view) {
    return (
      <div className={`${font} mx-auto w-full max-w-[640px] text-white`}>
        <div className="rounded-2xl border border-white/10 bg-[#16181D] p-6 sm:p-8">
          <div className="font-mono text-xs tracking-[0.2em] text-[#9ECE6A]">PROTOTYPE · WHO&apos;S HUMAN</div>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl">누가 사람이야?</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/70">
            채팅방에 다섯 명이 모였어요. 모두 자기가 AI라고 말하지만, 딱 한 명은 사람이에요. 그 사람이 바로 당신.
            진짜 AI 넷 사이에서 AI인 척 대화하고, 라운드마다 열리는 투표에서 끝까지 들키지 마세요.
          </p>
          <ul className="mt-4 space-y-1 text-sm text-white/60">
            <li>· 라운드마다 주제가 나오고, 한 사람씩 돌아가며 두 번 말해요.</li>
            <li>· 대화가 끝나면 다 같이 "사람 같은 참가자"에게 투표해요. 가장 많이 뽑힌 사람은 퇴장.</li>
            <li>· 세 번의 투표를 버티면 승리. AI들의 정체는 판이 끝나면 공개돼요.</li>
          </ul>

          <div className="mt-6 grid grid-cols-3 gap-2">
            {LEVELS.map((l) => (
              <button
                key={l.key}
                onClick={() => setLevel(l.key)}
                className={`rounded-xl border px-3 py-3 text-left transition ${
                  level === l.key ? "border-[#9ECE6A] bg-[#9ECE6A]/10" : "border-white/10 hover:border-white/30"
                }`}
              >
                <div className="text-base font-bold">{l.label}</div>
                <div className="mt-1 text-[11px] leading-snug text-white/55">{l.desc}</div>
                <div className="mt-1 font-mono text-[11px] text-white/40">내 차례 {l.seconds}초</div>
              </button>
            ))}
          </div>

          <button
            onClick={start}
            disabled={starting}
            className="mt-6 w-full rounded-xl bg-[#9ECE6A] py-3.5 text-base font-black text-[#111] transition hover:brightness-110 disabled:opacity-50"
          >
            {starting ? "방 만드는 중…" : "채팅방 입장"}
          </button>
          {error && <p className="mt-3 text-sm text-[#F7768E]">{error}</p>}

          <p className="mt-5 text-[11px] leading-relaxed text-white/40">
            대화 내용은 실제 AI(구글 Gemini, OpenAI GPT-OSS, 알리바바 Qwen)에게 전달돼요. 이름 · 연락처 같은 개인정보는
            적지 마세요. 무료 AI를 쓰는 프로토타입이라 가끔 답이 느리거나 다른 AI가 대신 답할 수 있어요.
          </p>
        </div>
      </div>
    );
  }

  const meColor = colorOf(view.me);
  const lastVote = view.votes[view.votes.length - 1];

  return (
    <div className={`${font} mx-auto w-full max-w-[760px] text-white`}>
      {/* 상단: 라운드 · 주제 */}
      <div className="rounded-t-2xl border border-white/10 bg-[#16181D] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="font-mono text-xs tracking-widest text-white/50">
            ROUND {view.round}/{view.maxRound} ·{" "}
            {view.phase === "talk" ? `남은 발언 ${view.turnsLeft}` : view.phase === "vote" ? "투표" : "종료"}
          </div>
          <div className="text-xs text-white/50">
            나는 <b style={{ color: meColor }}>{view.me}</b>
          </div>
        </div>
        <div className="mt-1 text-[15px] font-bold leading-snug">{view.topic}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {view.players.map((p) => (
            <span
              key={p.name}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${p.alive ? "border-white/15" : "border-white/5 line-through opacity-40"}`}
              style={{ color: colorOf(p.name) }}
            >
              {p.name}
              {p.me && <span className="ml-1 text-white/60">(나)</span>}
            </span>
          ))}
        </div>
      </div>

      {/* 대화 */}
      <div
        ref={logRef}
        className="h-[min(56vh,520px)] space-y-2 overflow-y-auto border-x border-white/10 bg-[#0F1013] px-3 py-3"
      >
        {view.messages.map((m, i) =>
          m.name === null ? (
            <div key={i} className="py-1 text-center text-xs text-white/45">
              {m.text}
            </div>
          ) : (
            <div key={i} className={`flex ${m.name === view.me ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[82%]">
                <div className={`mb-0.5 text-[11px] ${m.name === view.me ? "text-right" : ""}`} style={{ color: colorOf(m.name) }}>
                  {m.name}
                </div>
                <div
                  className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    m.name === view.me ? "rounded-tr-sm bg-[#2A3A24]" : "rounded-tl-sm bg-[#1E2027]"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            </div>
          )
        )}
        {typing && (
          <div className="text-xs text-white/45">
            <span style={{ color: colorOf(typing) }}>{typing}</span> 입력 중
            <span className="inline-block animate-pulse">…</span>
          </div>
        )}
      </div>

      {/* 하단: 입력 · 투표 · 결과 */}
      <div className="rounded-b-2xl border border-white/10 bg-[#16181D] p-3">
        {error && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-[#F7768E]/10 px-3 py-2 text-sm text-[#F7768E]">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="shrink-0 rounded-md border border-[#F7768E]/40 px-2 py-0.5 text-xs">
              다시 시도
            </button>
          </div>
        )}

        {pendingVote ? (
          <VoteResult
            rec={pendingVote}
            me={view.me}
            onClose={() => setShownVote(view.votes.length)}
            last={view.phase === "over"}
          />
        ) : view.phase === "talk" ? (
          myTurn ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void say(draft);
              }}
              className="flex gap-2"
            >
              <input
                autoFocus
                value={draft}
                maxLength={120}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="AI인 척 한 마디…"
                className="min-w-0 flex-1 rounded-xl border border-white/15 bg-[#0F1013] px-3 py-2.5 text-sm outline-none focus:border-[#9ECE6A]"
              />
              <span className={`self-center font-mono text-sm ${left <= 10 ? "text-[#F7768E]" : "text-white/50"}`}>{left}s</span>
              <button className="rounded-xl bg-[#9ECE6A] px-4 text-sm font-bold text-[#111]">보내기</button>
            </form>
          ) : (
            <div className="py-2 text-center text-sm text-white/45">다른 참가자가 말하는 중이에요</div>
          )
        ) : view.phase === "vote" ? (
          <div>
            <div className="mb-2 text-sm text-white/70">사람 같은 참가자에게 투표하세요. (나도 AI인 척 투표해야 해요)</div>
            <div className="flex flex-wrap gap-2">
              {view.players
                .filter((p) => p.alive && !p.me)
                .map((p) => (
                  <button
                    key={p.name}
                    disabled={voting}
                    onClick={() => vote(p.name)}
                    className="rounded-xl border border-white/15 px-4 py-2 text-sm font-bold transition hover:border-white/50 disabled:opacity-40"
                    style={{ color: colorOf(p.name) }}
                  >
                    {p.name}
                  </button>
                ))}
            </div>
            {voting && <div className="mt-2 text-xs text-white/45">AI들이 투표하는 중…</div>}
          </div>
        ) : (
          view.result && <Reveal view={view} lastVote={lastVote} onAgain={() => setView(null)} />
        )}
      </div>
    </div>
  );
}

function VoteResult({ rec, me, onClose, last }: { rec: VoteRec; me: string; onClose: () => void; last: boolean }) {
  return (
    <div>
      <div className="mb-2 text-sm font-bold">
        라운드 {rec.round} 투표 결과 — <span style={{ color: colorOf(rec.out) }}>{rec.out}</span> 퇴장
        {rec.tie && <span className="text-white/50"> (동점)</span>}
        {rec.human ? <span className="text-[#F7768E]"> · 들켰어요!</span> : <span className="text-white/50"> · AI였어요</span>}
      </div>
      <ul className="space-y-1 text-[13px]">
        {rec.votes.map((v) => (
          <li key={v.from} className="flex gap-1.5">
            <span style={{ color: colorOf(v.from) }}>{v.from}</span>
            <span className="text-white/40">→</span>
            <span style={{ color: colorOf(v.to) }}>{v.to}</span>
            {v.to === me && <span className="text-[#F7768E]">(나)</span>}
            {v.reason && <span className="text-white/50">: {v.reason}</span>}
          </li>
        ))}
      </ul>
      <button onClick={onClose} className="mt-3 w-full rounded-xl bg-white/10 py-2.5 text-sm font-bold hover:bg-white/15">
        {last ? "결과 보기" : "다음 라운드"}
      </button>
    </div>
  );
}

function Reveal({ view, lastVote, onAgain }: { view: View; lastVote?: VoteRec; onAgain: () => void }) {
  const r = view.result!;
  return (
    <div>
      <div className={`text-xl font-black ${r.win ? "text-[#9ECE6A]" : "text-[#F7768E]"}`}>
        {r.win ? "끝까지 살아남았어요!" : `라운드 ${lastVote?.round ?? view.round}에서 들켰어요`}
      </div>
      <div className="mt-1 text-sm text-white/55">이 방에 있던 AI들의 정체</div>
      <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {r.reveal.map((p) => (
          <li key={p.name} className="rounded-xl border border-white/10 bg-[#0F1013] px-3 py-2 text-sm">
            <b style={{ color: colorOf(p.name) }}>{p.name}</b>
            <span className="text-white/40"> — </span>
            {p.human ? (
              <span className="text-white/80">사람 (당신)</span>
            ) : (
              <span className="text-white/80">
                {p.label} <span className="text-white/45">· {p.company}</span>
                {p.fallbacks > 0 && <span className="text-white/35"> · {p.fallbacks}번은 다른 AI가 대신 답함</span>}
              </span>
            )}
          </li>
        ))}
      </ul>
      <button onClick={onAgain} className="mt-4 w-full rounded-xl bg-[#9ECE6A] py-3 text-base font-black text-[#111] hover:brightness-110">
        한 판 더
      </button>
    </div>
  );
}
