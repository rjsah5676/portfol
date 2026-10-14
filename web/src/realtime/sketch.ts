import {
  onConnection,
  rpc,
  serverNow as socketServerNow,
  subscribe,
  watchServerTime,
} from "@/lib/api/socket";
import { WrongPasswordError } from "@/lib/roomLock";
import { normalizeAnswer } from "@/lib/sketch/words";
import type { Challenge, GameMode } from "@/lib/sketch/modes";

export { WrongPasswordError };

/*
 * DOODLE PARTY — 백엔드 서버와 소켓으로 통신 (server/src/games/sketch.ts)
 *
 * 서버가 방 상태를 들고 권한 검사와 상태 변경을 맡음. 진행은 예전처럼 클라이언트가 나눠서 요청함
 *  - 그리는 사람: 제시어 선택, 정답 판정, 힌트, 시간 종료
 *  - 리더(방장, 방장이 없으면 가장 먼저 들어와 있는 사람 → 방장을 이어받음):
 *    게임 시작, 다음 차례, 그리는 사람이 나갔을 때 정리, 강퇴
 * 상태 변경 요청은 서버가 turnId·단계를 확인하고 처리해서 여러 명이 동시에 보내도 한 번만 반영됨.
 *
 * 구독하는 것
 *  - 로비 목록 / 방 전체 상태(설정·접속자·점수·진행 상태·강퇴 목록·나온 정답)
 *  - 이번 차례 그림 조각, 채팅 (참가자만)
 *  - 정답 시도, 이번 제시어 (그리는 사람만 — 답이 채팅에 노출되지 않게)
 * 끊기면(탭 닫기·네트워크) 서버가 자리에서 자동으로 빼고, 다시 연결되면 watchConnection 이 자리를 복구함.
 */

export type TurnMode = "winner" | "order";
export type Phase =
  | "waiting"
  | "choosing"
  | "drawing"
  | "reveal"
  | "ended"
  | "f-draw"
  | "f-vote"
  | "f-guess"
  | "f-result"
  | "l-draw"
  | "l-write"
  | "l-pick"
  | "l-show"
  | "r-write"
  | "r-draw"
  | "r-desc"
  | "r-album";

export interface SketchMeta {
  name: string;
  hostUid: string;
  max: number;
  turnMode: TurnMode;
  drawTime: number;
  rounds: number;
  hints: boolean;
  locked: boolean;
  createdAt: number;
  mode: GameMode;
  challenge: boolean;
  topics: string[];
  custom: string[];
  customOnly: boolean;
}

export interface SketchPlayer {
  nick: string;
  joinedAt: number;
}

export interface SketchScore {
  nick: string;
  score: number;
}

export interface SketchState {
  phase: Phase;
  turnId: string;
  turnNo: number;
  drawer: string;
  drawerNick: string;
  endsAt: number;
  /** 글자 수·힌트 (예: "○○○", "포○○", "포ㅋㄹㅇ") */
  hint: string;
  /** reveal 단계에서 공개되는 정답 ("" = 건너뜀) */
  reveal: string;
  /** 이번 차례 정답자 → 얻은 점수 */
  correct: Record<string, number>;
  /** 이번 차례 첫 정답자 (정답자 다음 차례 모드) */
  firstCorrect: string;
  /** 지금까지 그린 횟수 — 각자 rounds번 그리면 게임 끝 (중간에 들어온 사람도 자기 몫을 그림) */
  drawn: Record<string, number>;
  /** 이번 제시어 난이도 (0 쉬움 · 1 보통 · 2 어려움) */
  level: number;
  /** 단계 번호 (다른 모드의 제출 · 시간 끝 알림에 같이 보냄) */
  step: number;
  /** 이번 차례 깜짝 챌린지 */
  challenge: Challenge;
  /** 따봉: 그림 키 → 누른 사람 */
  likes: Record<string, string[]>;
  /** 건너뛰기 투표한 사람 */
  skip: string[];
  /** 다른 모드 진행 상태 */
  m: ModeState | null;
}

export interface FakeState {
  kind: "fake";
  game: number;
  games: number;
  topic: string;
  order: string[];
  at: number;
  colors: Record<string, string>;
  voted: string[];
  votes?: Record<string, string>;
  faker?: string;
  word?: string;
  caught?: boolean;
  guess?: string;
  win?: "fake" | "artists" | "gone";
}
export interface LieOption {
  id: string;
  text: string;
}
export interface LieShow extends LieOption {
  truth: boolean;
  authors: string[];
  pickers: string[];
}
export interface LieState {
  kind: "lie";
  players: string[];
  order: string[];
  idx: number;
  artist: string;
  done: string[];
  options?: LieOption[];
  show?: LieShow[];
  prompt?: string;
}
export interface RelayState {
  kind: "relay";
  order: string[];
  steps: number;
  step: number;
  done: string[];
  album?: { chain: number; page: number };
}
export type ModeState = FakeState | LieState | RelayState;

/** 나만 아는 것 (모드마다) */
export interface FakeSecret {
  topic: string;
  faker?: boolean;
  word?: string | null;
  watching?: boolean;
}
export interface LieSecret {
  prompt: string | null;
  lie: string | null;
  pick: string | null;
  /** 내가 쓴 보기 id */
  mine: string[];
}
export interface RelaySecret {
  task: "write" | "draw" | "desc";
  chain: number;
  prev: { text: string | null; sheet: string | null } | null;
  done: boolean;
}
export interface RelayEntry {
  by: string;
  text?: string;
  sheet?: string;
}

export interface SketchRoom {
  id: string;
  meta: SketchMeta;
  players: Record<string, SketchPlayer>;
  scores: Record<string, SketchScore>;
  state: SketchState;
  kicked: Record<string, string>;
  used: Record<string, true>;
}

export interface LobbyRoom {
  id: string;
  name: string;
  locked: boolean;
  max: number;
  count: number;
  phase: Phase;
  turnMode: TurnMode;
  mode?: GameMode;
  createdAt: number;
}

export interface Stroke {
  /** 획 묶음 id (되돌리기 단위) */
  g: string;
  /** 펜: 색, 굵기, 점들 "x,y x,y" (0~800, 0~600) / 채우기: t = "f", x, y */
  c: string;
  w?: number;
  p?: string;
  t?: "f";
  /** 이 획의 마지막 조각 */
  e?: 1;
  x?: number;
  y?: number;
}

export interface ChatMsg {
  id: string;
  uid: string;
  nick: string;
  text: string;
  /** msg: 일반, system: 안내, correct: 정답 알림, close: 거의 맞힘 (친 사람에게만 옴), secret: 정답을 아는 사람끼리 */
  kind: "msg" | "system" | "correct" | "close" | "secret";
  ts: number;
  /** close: 거의 맞힌 그 채팅의 id */
  of?: string;
}

export interface Guess {
  id: string;
  uid: string;
  nick: string;
  text: string;
  turnId: string;
}

export const CHOOSE_MS = 15_000;
export const REVEAL_MS = 5_000;
export const CANVAS_W = 800;
export const CANVAS_H = 600;

// ───────────── 서버 시각 ─────────────

/** 서버 시계 보정 시작 (소켓 연결이 서버와 시각을 주고받아 맞춤) */
export function watchServerOffset() {
  watchServerTime();
}
export const serverNow = () => socketServerNow();

// ───────────── 정규화 ─────────────

const EMPTY_STATE: SketchState = {
  phase: "waiting",
  turnId: "",
  turnNo: 0,
  drawer: "",
  drawerNick: "",
  endsAt: 0,
  hint: "",
  reveal: "",
  correct: {},
  firstCorrect: "",
  drawn: {},
  level: 0,
  step: 0,
  challenge: "",
  likes: {},
  skip: [],
  m: null,
};
const DEFAULT_META = {
  mode: "classic" as GameMode,
  challenge: true,
  topics: [],
  custom: [],
  customOnly: false,
};

function normalizeRoom(id: string, v: Record<string, unknown> | null): SketchRoom | null {
  if (!v || !v.meta) return null;
  return {
    id,
    meta: { ...DEFAULT_META, ...(v.meta as SketchMeta) },
    players: (v.players as Record<string, SketchPlayer>) ?? {},
    scores: (v.scores as Record<string, SketchScore>) ?? {},
    state: { ...EMPTY_STATE, ...((v.state as Partial<SketchState>) ?? {}) },
    kicked: (v.kicked as Record<string, string>) ?? {},
    used: (v.used as Record<string, true>) ?? {},
  };
}

/** 접속 중인 사람을 들어온 순서대로 */
export function orderedPlayers(room: SketchRoom): (SketchPlayer & { uid: string })[] {
  return Object.entries(room.players)
    .map(([uid, p]) => ({ uid, ...p }))
    .sort((a, b) => a.joinedAt - b.joinedAt || a.uid.localeCompare(b.uid));
}

/** 리더 = 방장. 방장이 나가 있으면 가장 먼저 들어와 있는 사람 (그 사람이 방장을 이어받음) */
export const leaderOf = (room: SketchRoom) =>
  room.players[room.meta.hostUid] ? room.meta.hostUid : (orderedPlayers(room)[0]?.uid ?? "");

/** 방장이 나갔으면 리더가 방장 자리를 이어받음 (서버가 자리 변동 때 이미 처리하지만 화면 쪽 호출은 그대로 둠) */
export async function claimHost(roomId: string, _uid: string) {
  await rpc("sketch.claimHost", { id: roomId }).catch(() => {});
}

/** 방장: 강퇴 — 자리·점수를 지우고 다시 못 들어오게 표시 (안내 메시지는 서버가 올림) */
export async function kickPlayer(room: SketchRoom, target: string) {
  await rpc("sketch.kick", { id: room.id, target });
}

// ───────────── 로비 ─────────────

export function subscribeLobby(cb: (rooms: LobbyRoom[]) => void) {
  const apply = (list: LobbyRoom[]) =>
    cb([...(list ?? [])].sort((a, b) => b.createdAt - a.createdAt));
  return subscribe<LobbyRoom[]>("sketch.lobby", null, {
    onSnapshot: apply,
    onEvent: (type, data) => {
      if (type === "list") apply(data as LobbyRoom[]);
    },
  });
}

export interface CreateOptions {
  name: string;
  max: number;
  turnMode: TurnMode;
  drawTime: number;
  rounds: number;
  hints: boolean;
  password: string;
  mode?: GameMode;
  challenge?: boolean;
  topics?: string[];
  custom?: string[];
  customOnly?: boolean;
}

/** 방 만들기 → 방 id. 비밀번호는 서버가 방 id와 섞어 해시로만 보관 */
export async function createRoom(_uid: string, nick: string, o: CreateOptions): Promise<string> {
  return rpc<string>("sketch.createRoom", {
    nick,
    name: o.name,
    max: o.max,
    turnMode: o.turnMode,
    drawTime: o.drawTime,
    rounds: o.rounds,
    hints: o.hints,
    password: o.password,
    mode: o.mode ?? "classic",
    challenge: o.challenge ?? true,
    topics: o.topics ?? [],
    custom: o.custom ?? [],
    customOnly: o.customOnly ?? false,
  });
}

// ───────────── 입장·퇴장 ─────────────

export async function hasAccess(roomId: string, _uid: string): Promise<boolean> {
  try {
    return await rpc<boolean>("sketch.hasAccess", { id: roomId });
  } catch {
    return false;
  }
}

/** 비번방이면 비밀번호나 초대키로 접근 권한을 먼저 얻음 (틀리면 서버에서 거부됨) */
export async function unlockRoom(
  roomId: string,
  _uid: string,
  cred: { password?: string; invite?: string }
) {
  try {
    await rpc("sketch.unlockRoom", {
      id: roomId,
      ...(cred.invite !== undefined ? { invite: cred.invite } : { password: cred.password ?? "" }),
    });
  } catch {
    throw new WrongPasswordError();
  }
}

/** 지금 들어가 있는 방 (끊겼다 다시 연결되면 자리 복구용) */
let joinedRoom: string | null = null;
let myJoinedAt = 0;

export async function joinRoom(roomId: string, _uid: string, nick: string, rejoin = false) {
  // 잠깐 끊겼다 재연결이면 원래 입장 순서 유지
  if (!rejoin || !myJoinedAt) myJoinedAt = serverNow();
  // 서버가 자리에 넣고, 이 연결이 끊기면(탭 닫기·네트워크) 자동으로 빼줌. 점수 자리는 새로고침해도 유지
  await rpc("sketch.join", { id: roomId, nick, joinedAt: myJoinedAt, rejoin });
  joinedRoom = roomId;
}

export async function leaveRoom(roomId: string, _uid: string, nick?: string) {
  // "나갔어요" 안내는 서버가 올림
  await rpc("sketch.leave", { id: roomId, ...(nick ? { nick } : {}) });
  joinedRoom = null;
}

/** 접속 끊겼다가 다시 연결됐을 때 자리 복구 */
export function watchConnection(roomId: string, uid: string, nick: string) {
  return onConnection((connected) => {
    if (connected && joinedRoom) joinRoom(roomId, uid, nick, true).catch(() => {});
  });
}

export function subscribeRoom(roomId: string, cb: (room: SketchRoom | null) => void) {
  const apply = (v: Record<string, unknown> | null) => cb(normalizeRoom(roomId, v));
  return subscribe<Record<string, unknown> | null>(
    "sketch.room",
    { id: roomId },
    {
      onSnapshot: apply,
      onEvent: (type, data) => {
        if (type === "room") apply(data as Record<string, unknown> | null);
      },
      onError: () => cb(null),
    }
  );
}

export async function getInvite(roomId: string): Promise<string | null> {
  try {
    return (await rpc<string | null>("sketch.getInvite", { id: roomId })) ?? null;
  } catch {
    return null;
  }
}

/** 로비 요약(인원·단계)은 이제 서버가 알아서 최신으로 유지함 — 화면 쪽 호출을 그대로 두려고 남겨둠 */
export async function syncLobby(_room: SketchRoom) {}

/** 아무도 없는 방 정리 (로비에서 누구든) — 접속자가 있으면 서버가 지우지 않음 */
export async function cleanupEmptyRoom(roomId: string) {
  await rpc("sketch.cleanupEmptyRoom", { id: roomId }).catch(() => {});
}

// ───────────── 진행 ─────────────

/** 남은 차례 수 (지금 그리는 차례 제외) */
export function remainingTurns(room: SketchRoom): number {
  return orderedPlayers(room).reduce(
    (n, p) => n + Math.max(0, room.meta.rounds - (room.state.drawn?.[p.uid] ?? 0)),
    0
  );
}

/** 리더: 게임 시작 (점수 초기화) */
export async function startGame(room: SketchRoom) {
  await rpc("sketch.startGame", { id: room.id });
}

export interface TurnWords {
  turnId: string;
  choices?: string[];
  levels?: number[];
  word?: string;
}

/** 그리는 사람: 제시어 후보 저장 (본인만 읽을 수 있음) */
export async function setChoices(
  roomId: string,
  turnId: string,
  choices: { word: string; level: number }[]
) {
  await rpc("sketch.setChoices", { id: roomId, turnId, choices });
}

export function subscribeWords(roomId: string, cb: (w: TurnWords | null) => void) {
  return subscribe<TurnWords | null>(
    "sketch.words",
    { id: roomId },
    {
      onSnapshot: (w) => cb(w ?? null),
      onEvent: (type, data) => {
        if (type === "value") cb((data as TurnWords | null) ?? null);
      },
      onError: () => cb(null),
    }
  );
}

/** 그리는 사람: 제시어 선택 → 그리기 시작 */
export async function chooseWord(room: SketchRoom, word: string, hint: string, level: number) {
  await rpc("sketch.chooseWord", { id: room.id, turnId: room.state.turnId, word, hint, level });
}

export async function setHint(roomId: string, turnId: string, hint: string) {
  await rpc("sketch.setHint", { id: roomId, turnId, hint });
}

/** 첫 정답자 추가 점수 */
export const FIRST_BONUS = 30;

/**
 * 그리는 사람: 정답 처리. 점수는 서버가 남은 시간으로 계산함
 * - 맞힌 사람: 빨리 맞힐수록 20~100점 × 제시어 난이도 배율, 첫 정답자는 +30
 * - 그린 사람: 누가 맞힐 때마다 그 사람 점수(첫 정답 보너스 빼고)의 절반 — 잘 그려서 빨리 맞히게 할수록 이득
 */
export async function markCorrect(room: SketchRoom, guess: Guess) {
  await rpc("sketch.markCorrect", {
    id: room.id,
    guess: { uid: guess.uid, nick: guess.nick, turnId: guess.turnId },
  });
}

/** 그리는 사람(정답 공개) 또는 리더(그리는 사람이 없을 때): 차례 종료 */
export async function endTurn(roomId: string, turnId: string, reveal: string) {
  await rpc("sketch.endTurn", { id: roomId, turnId, reveal });
}

/** 이 방에서 이미 나온 정답 목록(used)의 키 */
export const usedKey = (word: string) => normalizeAnswer(word).replace(/[.#$[\]/]/g, "_");

/** 리더: 다음 차례 또는 게임 종료 (누가 그릴지는 서버가 입장 순서·정답자 기준으로 정함) */
export async function nextTurn(room: SketchRoom) {
  await rpc("sketch.nextTurn", { id: room.id, turnId: room.state.turnId });
}

/** 리더: 대기실로 */
export async function backToWaiting(roomId: string) {
  await rpc("sketch.backToWaiting", { id: roomId });
}

// ───────────── 그림 ─────────────

export async function addStroke(roomId: string, turnId: string, s: Stroke) {
  await rpc("sketch.addStroke", { id: roomId, turn: turnId, s });
}

export function subscribeStrokes(
  roomId: string,
  turnId: string,
  onAdd: (key: string, s: Stroke) => void,
  onRemove: (key: string) => void
) {
  /** 화면에 이미 넘긴 조각 — 다시 연결돼 목록을 새로 받아도 같은 조각을 두 번 넘기지 않게 */
  const known = new Set<string>();
  const add = (key: string, s: Stroke) => {
    if (known.has(key)) return;
    known.add(key);
    onAdd(key, s);
  };
  const remove = (key: string) => {
    if (known.delete(key)) onRemove(key);
  };
  return subscribe<[string, Stroke][]>(
    "sketch.strokes",
    { id: roomId, turn: turnId },
    {
      onSnapshot: (list) => {
        const now = new Set((list ?? []).map(([k]) => k));
        for (const k of [...known]) if (!now.has(k)) remove(k);
        for (const [k, s] of list ?? []) add(k, s);
      },
      onEvent: (type, data) => {
        if (type === "add") add(...(data as [string, Stroke]));
        else if (type === "remove") (data as string[]).forEach(remove);
        else if (type === "clear") [...known].forEach(remove);
      },
    }
  );
}

export async function removeStrokes(roomId: string, turnId: string, keys: string[]) {
  if (!keys.length) return;
  await rpc("sketch.removeStrokes", { id: roomId, turn: turnId, keys });
}

export async function clearStrokes(roomId: string, turnId: string) {
  await rpc("sketch.clearStrokes", { id: roomId, turn: turnId });
}

// ───────────── 채팅·정답 ─────────────

export const CHAT_MAX = 60;

export async function sendChat(roomId: string, _uid: string, nick: string, text: string) {
  await rpc("sketch.sendChat", { id: roomId, nick, text: text.slice(0, CHAT_MAX) });
}

export async function systemChat(roomId: string, text: string) {
  await rpc("sketch.systemChat", { id: roomId, text }).catch(() => {});
}

export function subscribeChat(roomId: string, cb: (list: ChatMsg[]) => void) {
  const list: ChatMsg[] = [];
  const seen = new Set<string>();
  /** 새 메시지만 뒤에 붙임 (최근 80개 유지) */
  const push = (m: ChatMsg) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    list.push(m);
    if (list.length > 80) seen.delete(list.shift()!.id);
    return true;
  };
  return subscribe<ChatMsg[]>(
    "sketch.chat",
    { id: roomId },
    {
      onSnapshot: (msgs) => {
        let added = false;
        for (const m of msgs ?? []) added = push(m) || added;
        if (added) cb([...list]);
      },
      onEvent: (type, data) => {
        if (type === "add" && push(data as ChatMsg)) cb([...list]);
      },
    }
  );
}

/** 그리는 중 정답 시도 — 그리는 사람만 받아서 판정 */
export async function sendGuess(roomId: string, g: Omit<Guess, "id">) {
  await rpc("sketch.sendGuess", {
    id: roomId,
    nick: g.nick,
    text: g.text.slice(0, CHAT_MAX),
    turnId: g.turnId,
  });
}

export function subscribeGuesses(roomId: string, cb: (g: Guess) => void) {
  /** 이미 넘긴 시도 — 다시 연결돼 목록을 새로 받아도 두 번 판정하지 않게 */
  const seen = new Set<string>();
  const deliver = (g: Guess) => {
    if (seen.has(g.id)) return;
    seen.add(g.id);
    cb(g);
  };
  return subscribe<Guess[]>(
    "sketch.guesses",
    { id: roomId },
    {
      onSnapshot: (list) => (list ?? []).forEach(deliver),
      onEvent: (type, data) => {
        if (type === "add") deliver(data as Guess);
      },
    }
  );
}

export async function removeGuess(roomId: string, id: string) {
  await rpc("sketch.removeGuess", { id: roomId, guessId: id }).catch(() => {});
}

/** 오답은 그리는 사람이 대신 채팅에 올려줌. close = 거의 맞힘 → 친 사람에게만 "거의 다 왔어요" 알림 */
export async function relayGuess(roomId: string, g: Guess, close = false) {
  await rpc("sketch.relayGuess", {
    id: roomId,
    guess: { uid: g.uid, nick: g.nick, text: g.text },
    ...(close ? { close: true } : {}),
  });
}

// ───────────── 따봉 · 건너뛰기 ─────────────

/** 따봉 (한 그림에 한 번) — 키: 그림 맞히기는 turnId, 거짓말은 "l:<그린 사람>", 릴레이는 "r:<줄>:<칸>" */
export async function likeDrawing(roomId: string, key: string) {
  await rpc("sketch.like", { id: roomId, key }).catch(() => {});
}
export async function voteSkip(roomId: string, turnId: string) {
  await rpc("sketch.voteSkip", { id: roomId, turnId }).catch(() => {});
}

// ───────────── 다른 모드 ─────────────

/** 리더: 시간이 다 됐을 때 (force = 앨범 넘기기) */
export async function tick(roomId: string, step: number, force = false) {
  await rpc("sketch.tick", { id: roomId, step, ...(force ? { force } : {}) }).catch(() => {});
}
export async function submitSheet(roomId: string, step: number, strokes: Stroke[]) {
  await rpc("sketch.submitSheet", { id: roomId, step, strokes });
}
/** 글 내기 — 거짓말에서 진짜 제목과 같으면 에러(TOO_CLOSE) */
export async function submitText(roomId: string, step: number, text: string) {
  await rpc("sketch.submitText", { id: roomId, step, text });
}
export async function pickOption(roomId: string, step: number, option: string) {
  await rpc("sketch.pick", { id: roomId, step, option });
}
export async function voteFake(roomId: string, step: number, target: string) {
  await rpc("sketch.vote", { id: roomId, step, target });
}

/** 나만 아는 것 (모드마다 모양이 다름) */
export function subscribeSecret<T>(roomId: string, cb: (v: T | null) => void) {
  return subscribe<T | null>(
    "sketch.secret",
    { id: roomId },
    {
      onSnapshot: (v) => cb(v ?? null),
      onEvent: (type, data) => {
        if (type === "value") cb((data as T | null) ?? null);
      },
      onError: () => cb(null),
    }
  );
}
/** 따로 그린 그림 한 장 */
export function subscribeSheet(roomId: string, key: string, cb: (v: Stroke[] | null) => void) {
  return subscribe<Stroke[] | null>(
    "sketch.sheet",
    { id: roomId, key },
    { onSnapshot: (v) => cb(v ?? null), onError: () => cb(null) }
  );
}
/** 릴레이 앨범 */
export function subscribeAlbum(roomId: string, cb: (v: RelayEntry[][] | null) => void) {
  return subscribe<RelayEntry[][] | null>(
    "sketch.album",
    { id: roomId },
    { onSnapshot: (v) => cb(v ?? null), onError: () => cb(null) }
  );
}
