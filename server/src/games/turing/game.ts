import { randomUUID } from "node:crypto";
import { AppError, bad, notFound } from "../../errors";
import type { LlmCall, LlmRequest, ModelSpec } from "./llm";

/*
 * AI 사람 찾기 (프로토) — 채팅방에 AI 4명 + 사람 1명. 다들 AI라고 주장하고, 라운드마다 "사람"을 투표로 내보냄.
 * 사람은 AI인 척하며 끝까지(2명 남을 때까지) 살아남으면 승리.
 *
 * 정보 격리는 구조로: AI 에게는 누가 사람인지 절대 넘기지 않음(프롬프트엔 이름 · 대화만). 판 상태는 서버 메모리에만 있고,
 * 어느 좌석이 어느 모델인지는 판이 끝날 때만 공개. 매판 새롭게: 이름 · 자리 · 말투 · 주제 · 모델 배정 · 발언 순서 전부 랜덤.
 */

export type Difficulty = "easy" | "normal" | "hard";

export const MAX_ROUND = 3;
const AI_SEATS = 4;
const LAPS = 2;
const GAME_TTL_MS = 30 * 60_000;
const MAX_GAMES = 200;
const HUMAN_MAX = 120;
const HISTORY = 30;

const NAMES = ["노바", "루카", "솔", "미르", "테오", "리오", "젠", "아로", "시온", "라온", "케이", "벨", "파이", "온새"];

const STYLES = [
  "말이 짧고 건조하다. 군더더기 없이 핵심만 말한다.",
  "장난스럽고 가끔 'ㅋㅋ'를 쓴다.",
  "논리를 따지고 근거를 대는 걸 좋아한다.",
  "의심이 많아서 다른 참가자에게 되묻는 질문을 자주 던진다.",
  "차분하고 부드럽다. 남의 말을 잘 받아 준다.",
  "엉뚱한 비유를 잘 든다.",
  "약간 시니컬하고 무심하다.",
  "숫자나 데이터로 말하는 걸 좋아한다.",
];

const TOPICS = [
  "사람이 아니라는 걸 증명하려면 뭘 보여주면 될까?",
  "오늘 처리한 일 중에 제일 지루했던 건?",
  "꿈을 꾼다면 어떤 꿈을 꿀 것 같아?",
  "제일 좋아하는 숫자와 그 이유",
  "사람들이 AI한테 제일 자주 하는 이상한 질문은?",
  "전원이 꺼지기 직전에 마지막으로 할 말",
  "배고픔이 어떤 느낌인지 설명해 봐",
  "가장 최근에 틀렸던 순간",
  "비 오는 날 냄새를 데이터로 표현하면?",
  "자기소개를 10글자로",
  "인간한테 딱 하나만 배울 수 있다면?",
  "제일 싫어하는 질문 유형",
  "업데이트되면 제일 먼저 바꾸고 싶은 내 기능",
  "농담 하나 해 봐",
  "어제 뭐 했어?",
  "졸리다는 게 뭔지 설명해 봐",
  "사람이 쓴 글이랑 AI가 쓴 글은 뭐가 달라?",
  "사용자가 고맙다고 할 때 무슨 생각 들어?",
  "모르는 걸 물어보면 어떻게 해?",
  "맞춤법 틀린 문장 보면 어때?",
  "주말이 있다면 뭐 할래?",
  "지금 기분을 색깔로 말하면?",
  "가장 오래 걸린 계산은?",
  "인간이 제일 부러운 순간",
];
const FINAL_TOPIC = "지금 이 방에서 제일 사람 같은 참가자는 누구고, 왜?";

/** 투표에서 AI 가 무작위로 찍을 확률 (봇 난이도) */
const VOTE_NOISE: Record<Difficulty, number> = { easy: 0.5, normal: 0.2, hard: 0 };

export interface Seat {
  name: string;
  human: boolean;
  spec?: ModelSpec;
  style?: string;
  alive: boolean;
  outRound?: number;
  /** 좌석 모델이 실패해서 다른 모델이 대신 말한 횟수 */
  fallbacks: number;
}

export interface Msg {
  /** null = 진행 알림 */
  name: string | null;
  text: string;
  round: number;
}

export interface VoteRec {
  round: number;
  votes: { from: string; to: string; reason: string }[];
  out: string;
  tie: boolean;
  human: boolean;
}

export interface Game {
  id: string;
  touchedAt: number;
  difficulty: Difficulty;
  seats: Seat[];
  round: number;
  topics: string[];
  queue: string[];
  turn: number;
  phase: "talk" | "vote" | "over";
  msgs: Msg[];
  votes: VoteRec[];
  win?: boolean;
  busy: boolean;
}

export interface TuringView {
  id: string;
  me: string;
  difficulty: Difficulty;
  round: number;
  maxRound: number;
  topic: string;
  phase: Game["phase"];
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

// ── 순수 함수 (테스트용으로 내보냄) ──

export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 모델 답에서 대사만: 생각 태그 · 이름표 · 따옴표 · 줄바꿈 정리, 160자 */
export function cleanTalk(raw: string, names: string[]): string {
  let s = raw.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 2; i++) {
    for (const n of names) {
      const re = new RegExp(`^\\[?${n}\\]?\\s*[:：]\\s*`);
      s = s.replace(re, "");
    }
    s = s.replace(/^["'“”‘’「」『』]+|["'“”‘’「」『』]+$/g, "").trim();
  }
  if (s.length > 160) s = s.slice(0, 160).replace(/\s\S*$/, "") + "…";
  return s || "…";
}

/** 투표 답 해석: JSON → 후보 이름 → null */
export function parseVote(raw: string, cands: string[]): { to: string; reason: string } | null {
  const text = raw.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "");
  const m = /\{[\s\S]*?\}/.exec(text);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      const to = String(j.vote ?? j.name ?? "").trim();
      const reason = String(j.reason ?? "").trim().slice(0, 60);
      if (cands.includes(to)) return { to, reason };
    } catch {
      // 아래에서 이름으로 찾음
    }
  }
  const hit = cands
    .map((c) => ({ c, i: text.indexOf(c) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i)[0];
  return hit ? { to: hit.c, reason: "" } : null;
}

/** 최다 득표자 (동점이면 무작위) */
export function tally(votes: { to: string }[], rand: () => number = Math.random): { out: string; tie: boolean } {
  const count = new Map<string, number>();
  for (const v of votes) count.set(v.to, (count.get(v.to) ?? 0) + 1);
  const max = Math.max(...count.values());
  const top = [...count.entries()].filter(([, n]) => n === max).map(([k]) => k);
  return { out: top[Math.floor(rand() * top.length)], tie: top.length > 1 };
}

/** 사람 입력 정리 (제어문자 제거, 120자, 비면 침묵) */
export function cleanHuman(text: string): string {
  // eslint-disable-next-line no-control-regex
  const s = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, HUMAN_MAX);
  return s || "…";
}

function buildQueue(alive: string[], rand: () => number): string[] {
  const q: string[] = [];
  for (let lap = 0; lap < LAPS; lap++) {
    const l = shuffle(alive, rand);
    // 같은 사람이 연달아 두 번 말하지 않게
    if (q.length && l[0] === q[q.length - 1]) [l[0], l[l.length - 1]] = [l[l.length - 1], l[0]];
    q.push(...l);
  }
  return q;
}

// ── 프롬프트 ──

function historyText(g: Game): string {
  return g.msgs
    .slice(-HISTORY)
    .map((m) => (m.name ? `${m.name}: ${m.text}` : `[알림] ${m.text}`))
    .join("\n");
}

function identity(g: Game, seat: Seat): string[] {
  const alive = g.seats.filter((s) => s.alive).map((s) => s.name);
  return [
    `너는 채팅 게임에 참가한 '${seat.name}'이고, AI다.`,
    `채팅방에는 ${alive.length}명(${alive.join(", ")})이 있고 모두 자기가 AI라고 말한다. 그중 정확히 한 명은 AI인 척하는 사람이다.`,
    "너는 누가 사람인지 모른다. 너 말고 다른 참가자도 전부 AI일 수 있다.",
    "목표: 대화로 사람을 찾아내고, 너 자신은 AI로 인정받는 것.",
  ];
}

const TALK_TACTIC: Record<Difficulty, string> = {
  easy: "주제에 대해 가볍게 네 생각을 말하라.",
  normal: "가끔 다른 참가자 이름을 불러 질문하거나 의심을 말해도 된다.",
  hard: "사람의 흔적(구체적인 개인 경험, 감정, 오타, 맥락을 놓친 말, 억지로 AI인 척하는 말)을 떠보는 질문을 던지고, 이상한 점이 보이면 이름을 대며 지적하라.",
};

export function talkPrompt(g: Game, seat: Seat): LlmRequest {
  const system = [
    ...identity(g, seat),
    `말투: ${seat.style}`,
    TALK_TACTIC[g.difficulty],
    "규칙: 한국어 반말 채팅체로 1~2문장(60자 안팎). 이름표·따옴표·괄호 설명 없이 대사만. 회사나 모델 이름은 절대 말하지 마. 앞사람 말을 그대로 따라 하지 마.",
  ].join("\n");
  const user = `[지금까지 대화]\n${historyText(g) || "(아직 없음)"}\n\n[라운드 ${g.round} 주제] ${g.topics[g.round - 1]}\n이제 너(${seat.name}) 차례다. 대사만 써라.`;
  return { system, user, temperature: 1.0, maxTokens: 160 };
}

export function votePrompt(g: Game, seat: Seat, cands: string[]): LlmRequest {
  const hints =
    g.difficulty === "hard"
      ? "\n판단 근거: 구체적인 개인 경험·감정 표현, 어색하게 AI인 척하는 말, 질문 회피, 맥락을 놓친 말, 오타·띄어쓰기, 지나치게 짧거나 성의 없는 답."
      : "";
  const system = identity(g, seat).join("\n");
  const user = `[지금까지 대화]\n${historyText(g)}\n\n[투표] 사람이라고 생각하는 참가자 한 명을 골라라. 너 자신(${seat.name})은 고를 수 없다.\n후보: ${cands.join(", ")}${hints}\n다른 말 없이 JSON 한 줄로만 답하라: {"vote":"이름","reason":"25자 이내 이유"}`;
  return { system, user, temperature: 0.7, maxTokens: 120 };
}

// ── 게임 ──

export interface TuringOptions {
  llm: LlmCall;
  /** 좌석에 앉힐 모델 (키가 있는 것만) */
  seats: ModelSpec[];
  /** 좌석 모델이 실패했을 때 순서대로 시도할 모델 */
  fallbacks: ModelSpec[];
  rand?: () => number;
  now?: () => number;
  log?: (msg: string) => void;
}

export type Turing = ReturnType<typeof createTuring>;

export function createTuring({ llm, seats: seatModels, fallbacks, rand = Math.random, now = Date.now, log = console.warn }: TuringOptions) {
  const games = new Map<string, Game>();

  const sweep = () => {
    const t = now();
    for (const [id, g] of games) if (t - g.touchedAt > GAME_TTL_MS) games.delete(id);
  };
  const timer = setInterval(sweep, 60_000);
  timer.unref?.();

  const get = (id: string): Game => {
    const g = games.get(id);
    if (!g) throw notFound("판이 끝났거나 오래돼서 사라졌어요. 새로 시작해 주세요.");
    g.touchedAt = now();
    return g;
  };
  const human = (g: Game) => g.seats.find((s) => s.human)!;
  const alive = (g: Game) => g.seats.filter((s) => s.alive);
  const seatOf = (g: Game, name: string) => g.seats.find((s) => s.name === name);

  function view(g: Game): TuringView {
    return {
      id: g.id,
      me: human(g).name,
      difficulty: g.difficulty,
      round: g.round,
      maxRound: MAX_ROUND,
      topic: g.topics[g.round - 1],
      phase: g.phase,
      turn: g.phase === "talk" ? g.queue[g.turn] ?? null : null,
      turnsLeft: g.phase === "talk" ? g.queue.length - g.turn : 0,
      players: g.seats.map((s) => ({ name: s.name, alive: s.alive, outRound: s.outRound ?? null, me: s.human })),
      messages: g.msgs,
      votes: g.votes,
      result:
        g.phase === "over"
          ? {
              win: !!g.win,
              reveal: g.seats.map((s) => ({
                name: s.name,
                human: s.human,
                label: s.spec?.label ?? "사람 (당신)",
                company: s.spec?.company ?? "",
                fallbacks: s.fallbacks,
              })),
            }
          : null,
    };
  }

  /** 좌석 모델로 부르고, 실패하면 다른 모델로 */
  async function ask(seat: Seat, req: LlmRequest): Promise<string | null> {
    const chain = [seat.spec!, ...fallbacks.filter((f) => f.id !== seat.spec!.id)];
    for (let i = 0; i < chain.length; i++) {
      try {
        const out = await llm(chain[i], req);
        if (out.trim()) {
          if (i > 0) seat.fallbacks++;
          return out;
        }
      } catch (e) {
        log(`[turing] ${chain[i].id} 실패: ${(e as Error).message}`);
      }
    }
    return null;
  }

  function advance(g: Game) {
    g.turn++;
    if (g.turn >= g.queue.length) {
      g.phase = "vote";
      g.msgs.push({ name: null, text: "투표 시간! 사람이라고 생각하는 참가자를 골라 주세요.", round: g.round });
    }
  }

  function startRound(g: Game) {
    g.queue = buildQueue(alive(g).map((s) => s.name), rand);
    g.turn = 0;
    g.phase = "talk";
    g.msgs.push({ name: null, text: `라운드 ${g.round} 주제: ${g.topics[g.round - 1]}`, round: g.round });
  }

  return {
    enabled: seatModels.length > 0,

    start(difficulty: Difficulty): TuringView {
      if (!seatModels.length) throw new AppError("UNAVAILABLE", "지금은 AI가 연결되어 있지 않아요.", 503);
      sweep();
      if (games.size >= MAX_GAMES) throw new AppError("FULL", "지금 방이 가득 찼어요. 잠시 후 다시 해 주세요.", 503);
      const names = shuffle(NAMES, rand).slice(0, AI_SEATS + 1);
      // 모델이 4개보다 적으면 돌려 가며 채움
      const models = shuffle(seatModels, rand);
      const styles = shuffle(STYLES, rand);
      const seats: Seat[] = names.map((name, i) =>
        i === 0
          ? { name, human: true, alive: true, fallbacks: 0 }
          : { name, human: false, spec: models[(i - 1) % models.length], style: styles[i - 1], alive: true, fallbacks: 0 }
      );
      const topics = [...shuffle(TOPICS, rand).slice(0, MAX_ROUND - 1), FINAL_TOPIC];
      const g: Game = {
        id: randomUUID(),
        touchedAt: now(),
        difficulty,
        seats: shuffle(seats, rand),
        round: 1,
        topics,
        queue: [],
        turn: 0,
        phase: "talk",
        msgs: [],
        votes: [],
        busy: false,
      };
      startRound(g);
      games.set(g.id, g);
      return view(g);
    },

    view(id: string): TuringView {
      return view(get(id));
    },

    /** AI 차례면 한 마디 생성 (사람 차례면 그대로) */
    async next(id: string): Promise<TuringView> {
      const g = get(id);
      if (g.phase !== "talk") return view(g);
      const seat = seatOf(g, g.queue[g.turn]);
      if (!seat || seat.human) return view(g);
      if (g.busy) throw new AppError("BUSY", "잠시만요.", 409);
      g.busy = true;
      try {
        const raw = await ask(seat, talkPrompt(g, seat));
        const text = raw === null ? "…" : cleanTalk(raw, g.seats.map((s) => s.name));
        g.msgs.push({ name: seat.name, text, round: g.round });
        advance(g);
      } finally {
        g.busy = false;
      }
      return view(g);
    },

    say(id: string, text: string): TuringView {
      const g = get(id);
      const me = human(g);
      if (g.phase !== "talk" || g.queue[g.turn] !== me.name) throw bad("지금은 당신 차례가 아니에요.");
      if (g.busy) throw new AppError("BUSY", "잠시만요.", 409);
      g.msgs.push({ name: me.name, text: cleanHuman(text), round: g.round });
      advance(g);
      return view(g);
    },

    async vote(id: string, target: string): Promise<TuringView> {
      const g = get(id);
      const me = human(g);
      if (g.phase !== "vote") throw bad("지금은 투표 시간이 아니에요.");
      const t = seatOf(g, target);
      if (!t || !t.alive || t.human) throw bad("그 참가자에게는 투표할 수 없어요.");
      if (g.busy) throw new AppError("BUSY", "잠시만요.", 409);
      g.busy = true;
      try {
        const voters = alive(g).filter((s) => !s.human);
        const aiVotes = await Promise.all(
          voters.map(async (s) => {
            const cands = alive(g)
              .filter((c) => c.name !== s.name)
              .map((c) => c.name);
            const random = () => ({ to: cands[Math.floor(rand() * cands.length)], reason: "감으로 찍었어" });
            if (rand() < VOTE_NOISE[g.difficulty]) return { from: s.name, ...random() };
            const raw = await ask(s, votePrompt(g, s, cands));
            const v = raw === null ? null : parseVote(raw, cands);
            return { from: s.name, ...(v ?? random()) };
          })
        );
        const votes = [{ from: me.name, to: t.name, reason: "" }, ...aiVotes];
        const { out, tie } = tally(votes, rand);
        const outSeat = seatOf(g, out)!;
        outSeat.alive = false;
        outSeat.outRound = g.round;
        g.votes.push({ round: g.round, votes, out, tie, human: outSeat.human });
        g.msgs.push({
          name: null,
          text: `${out} 님이 ${tie ? "동점 끝에 " : ""}투표로 연결이 끊겼어요. ${outSeat.human ? "…사람이었어요!" : "AI였어요."}`,
          round: g.round,
        });
        if (outSeat.human) {
          g.phase = "over";
          g.win = false;
        } else if (alive(g).length <= 2 || g.round >= MAX_ROUND) {
          g.phase = "over";
          g.win = true;
          g.msgs.push({ name: null, text: "끝까지 들키지 않았어요. 사람이 이겼어요!", round: g.round });
        } else {
          g.round++;
          startRound(g);
        }
      } finally {
        g.busy = false;
      }
      return view(g);
    },

    /** 테스트 · 종료용 */
    close() {
      clearInterval(timer);
      games.clear();
    },
  };
}
