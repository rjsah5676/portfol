import {
  get,
  limitToLast,
  onChildAdded,
  onChildRemoved,
  onDisconnect,
  onValue,
  push,
  query,
  ref,
  remove,
  runTransaction,
  set,
  update,
  type DatabaseReference,
} from "firebase/database";
import { rtdb } from "@/firebase";
import { hashPassword, randomKey, WrongPasswordError } from "@/lib/roomLock";
import { LEVEL_BONUS, normalizeAnswer } from "@/lib/sketch/words";

export { WrongPasswordError };

/*
 * 스케치 퀴즈 — Firebase Realtime Database
 *
 *  sketch/lobby/{room}            로비 목록용 요약 (가벼움)
 *  sketch/rooms/{room}/meta       방 설정
 *  sketch/rooms/{room}/players    지금 접속 중인 사람 (끊기면 onDisconnect로 자동 삭제)
 *  sketch/rooms/{room}/scores     점수 (새로고침해도 유지)
 *  sketch/rooms/{room}/state      진행 상태 (phase, 그리는 사람, 마감 시각 …)
 *  sketch/rooms/{room}/kicked     강퇴된 사람 (uid → 닉네임) — 규칙에서 재입장 막음
 *  sketch/rooms/{room}/used       이 방에서 이미 나온 정답 (중복 출제 방지)
 *  sketch/strokes/{room}/{turn}   그림 조각 (그리는 동안 계속 추가)
 *  sketch/chat/{room}             채팅
 *  sketch/guesses/{room}          정답 시도 — 그리는 사람만 읽음 (답이 채팅에 노출되지 않게)
 *  sketch/words/{room}            이번 제시어 — 그리는 사람만 읽음
 *  sketch/locks/{room}            비밀번호 해시·초대키 — 아무도 못 읽음 (규칙에서만 비교)
 *  sketch/invites/{room}          초대키 — 방 참가자만 읽음 (초대 링크 만들기용)
 *  sketch/access/{room}/{uid}     비번/초대키를 맞힌 사람 표시
 *
 * 서버가 없어서 진행은 클라이언트가 나눠서 맡음
 *  - 그리는 사람: 제시어 선택, 정답 판정, 힌트, 시간 종료
 *  - 리더(방장, 방장이 없으면 가장 먼저 들어와 있는 사람 → 방장을 이어받음):
 *    게임 시작, 다음 차례, 그리는 사람이 나갔을 때 정리, 강퇴
 * 상태 변경은 turnId를 확인하는 트랜잭션이라 여러 명이 동시에 호출해도 한 번만 반영됨.
 */

export type TurnMode = "winner" | "order";
export type Phase = "waiting" | "choosing" | "drawing" | "reveal" | "ended";

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
  /** msg: 일반, system: 안내, correct: 정답 알림 */
  kind: "msg" | "system" | "correct";
  ts: number;
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

const r = (path: string) => ref(rtdb(), `sketch/${path}`);

// ───────────── 서버 시각 ─────────────

let serverOffset = 0;
let offsetSubscribed = false;
export function watchServerOffset() {
  if (offsetSubscribed) return;
  offsetSubscribed = true;
  onValue(ref(rtdb(), ".info/serverTimeOffset"), (s) => {
    serverOffset = Number(s.val() ?? 0);
  });
}
export const serverNow = () => Date.now() + serverOffset;

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
};

function normalizeRoom(id: string, v: Record<string, unknown> | null): SketchRoom | null {
  if (!v || !v.meta) return null;
  return {
    id,
    meta: v.meta as SketchMeta,
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

/** 리더 = 방장. 방장이 나가 있으면 가장 먼저 들어와 있는 사람 (그 사람이 claimHost로 이어받음) */
export const leaderOf = (room: SketchRoom) =>
  room.players[room.meta.hostUid] ? room.meta.hostUid : (orderedPlayers(room)[0]?.uid ?? "");

/** 방장이 나갔으면 리더가 방장 자리를 이어받음 (규칙: 기존 방장이 방에 없을 때만) */
export async function claimHost(roomId: string, uid: string) {
  await set(r(`rooms/${roomId}/meta/hostUid`), uid).catch(() => {});
}

/** 방장: 강퇴 — 자리·점수를 지우고 다시 못 들어오게 표시 */
export async function kickPlayer(room: SketchRoom, target: string) {
  const nick = room.players[target]?.nick ?? room.scores[target]?.nick ?? "?";
  await update(r(`rooms/${room.id}`), {
    [`kicked/${target}`]: nick,
    [`players/${target}`]: null,
    [`scores/${target}`]: null,
  });
  await systemChat(room.id, `${nick}님을 내보냈어요.`);
}

// ───────────── 로비 ─────────────

export function subscribeLobby(cb: (rooms: LobbyRoom[]) => void) {
  return onValue(r("lobby"), (s) => {
    const v = (s.val() ?? {}) as Record<string, Omit<LobbyRoom, "id">>;
    cb(
      Object.entries(v)
        .map(([id, x]) => ({ id, ...x }))
        .sort((a, b) => b.createdAt - a.createdAt)
    );
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
}

export async function createRoom(uid: string, nick: string, o: CreateOptions): Promise<string> {
  const id = push(r("lobby")).key!;
  const now = serverNow();
  const locked = o.password.trim() !== "";
  const invite = randomKey();
  const meta: SketchMeta = {
    name: o.name.trim().slice(0, 20) || `${nick}의 방`,
    hostUid: uid,
    max: Math.min(8, Math.max(2, o.max)),
    turnMode: o.turnMode,
    drawTime: o.drawTime,
    rounds: o.rounds,
    hints: o.hints,
    locked,
    createdAt: now,
  };
  const updates: Record<string, unknown> = {
    [`rooms/${id}/meta`]: meta,
    [`rooms/${id}/state`]: { phase: "waiting" },
    [`lobby/${id}`]: {
      name: meta.name,
      locked,
      max: meta.max,
      count: 0,
      phase: "waiting",
      turnMode: meta.turnMode,
      createdAt: now,
    },
    [`invites/${id}`]: invite,
  };
  if (locked) {
    const pw = await hashPassword(id, o.password.trim());
    updates[`locks/${id}`] = { pw, invite };
    updates[`access/${id}/${uid}`] = pw;
  }
  await update(r(""), updates);
  return id;
}

// ───────────── 입장·퇴장 ─────────────

export async function hasAccess(roomId: string, uid: string): Promise<boolean> {
  try {
    return (await get(r(`access/${roomId}/${uid}`))).exists();
  } catch {
    return false;
  }
}

/** 비번방이면 비밀번호나 초대키로 접근 권한을 먼저 얻음 (틀리면 규칙에서 거부됨) */
export async function unlockRoom(
  roomId: string,
  uid: string,
  cred: { password?: string; invite?: string }
) {
  const value = cred.invite ?? (await hashPassword(roomId, cred.password ?? ""));
  try {
    await set(r(`access/${roomId}/${uid}`), value);
  } catch {
    throw new WrongPasswordError();
  }
}

let presenceRef: DatabaseReference | null = null;
let myJoinedAt = 0;

export async function joinRoom(roomId: string, uid: string, nick: string, rejoin = false) {
  const playerRef = r(`rooms/${roomId}/players/${uid}`);
  // 끊기면(탭 닫기·네트워크) 자동으로 빠지게 먼저 예약
  await onDisconnect(playerRef).remove();
  // 잠깐 끊겼다 재연결이면 원래 입장 순서 유지
  if (!rejoin || !myJoinedAt) myJoinedAt = serverNow();
  await set(playerRef, { nick, joinedAt: myJoinedAt });
  presenceRef = playerRef;
  // 점수 자리 (새로고침으로 다시 들어온 경우 기존 점수 유지)
  await runTransaction(r(`rooms/${roomId}/scores/${uid}`), (cur) =>
    cur ? { ...cur, nick } : { nick, score: 0 }
  );
}

export async function leaveRoom(roomId: string, uid: string, nick?: string) {
  const playerRef = r(`rooms/${roomId}/players/${uid}`);
  if (nick) await systemChat(roomId, `${nick}님이 나갔어요.`);
  await onDisconnect(playerRef).cancel();
  await remove(playerRef);
  presenceRef = null;
}

/** 접속 끊겼다가 다시 연결됐을 때 자리 복구 */
export function watchConnection(roomId: string, uid: string, nick: string) {
  return onValue(ref(rtdb(), ".info/connected"), (s) => {
    if (s.val() === true && presenceRef) joinRoom(roomId, uid, nick, true).catch(() => {});
  });
}

export function subscribeRoom(roomId: string, cb: (room: SketchRoom | null) => void) {
  return onValue(
    r(`rooms/${roomId}`),
    (s) => cb(normalizeRoom(roomId, s.val())),
    () => cb(null)
  );
}

export async function getInvite(roomId: string): Promise<string | null> {
  try {
    return ((await get(r(`invites/${roomId}`))).val() as string) ?? null;
  } catch {
    return null;
  }
}

/** 리더가 로비 요약을 최신으로 유지 */
export async function syncLobby(room: SketchRoom) {
  await update(r(`lobby/${room.id}`), {
    count: Object.keys(room.players).length,
    phase: room.state.phase,
    name: room.meta.name,
  }).catch(() => {});
}

/** 아무도 없는 방 정리 (로비에서 누구든) */
export async function cleanupEmptyRoom(roomId: string) {
  const players = await get(r(`rooms/${roomId}/players`)).catch(() => null);
  if (players?.exists()) return;
  await update(r(""), {
    [`rooms/${roomId}`]: null,
    [`lobby/${roomId}`]: null,
    [`strokes/${roomId}`]: null,
    [`chat/${roomId}`]: null,
    [`guesses/${roomId}`]: null,
    [`words/${roomId}`]: null,
    [`locks/${roomId}`]: null,
    [`invites/${roomId}`]: null,
    [`access/${roomId}`]: null,
  }).catch(() => {});
}

// ───────────── 진행 ─────────────

const stateRef = (roomId: string) => r(`rooms/${roomId}/state`);

/** 아직 자기 몫(rounds번)을 다 안 그린, 지금 있는 사람들 */
function pendingDrawers(room: SketchRoom, drawn: Record<string, number>) {
  return orderedPlayers(room)
    .map((p) => p.uid)
    .filter((u) => (drawn[u] ?? 0) < room.meta.rounds);
}

/** 남은 차례 수 (지금 그리는 차례 제외) */
export function remainingTurns(room: SketchRoom): number {
  return orderedPlayers(room).reduce(
    (n, p) => n + Math.max(0, room.meta.rounds - (room.state.drawn?.[p.uid] ?? 0)),
    0
  );
}

/** 다음에 그릴 사람 ("" = 모두 다 그림 → 게임 끝) */
function nextDrawer(
  room: SketchRoom,
  current: string,
  firstCorrect: string,
  drawn: Record<string, number>
): string {
  const pending = pendingDrawers(room, drawn);
  if (pending.length === 0) return "";
  if (room.meta.turnMode === "winner" && firstCorrect && pending.includes(firstCorrect))
    return firstCorrect;
  // 입장 순서로 지금 사람 다음부터 돌면서 아직 덜 그린 사람
  const all = orderedPlayers(room).map((p) => p.uid);
  const start = all.indexOf(current);
  for (let k = 1; k <= all.length; k++) {
    const u = all[(start + k + all.length) % all.length];
    if (pending.includes(u)) return u;
  }
  return pending[0];
}

function turnPatch(room: SketchRoom, drawer: string, turnNo: number) {
  const turnId = push(r(`strokes/${room.id}`)).key!;
  return {
    phase: "choosing" as Phase,
    turnId,
    turnNo,
    drawer,
    drawerNick: room.players[drawer]?.nick ?? "",
    endsAt: serverNow() + CHOOSE_MS,
    hint: "",
    reveal: "",
    correct: {},
    firstCorrect: "",
    level: 0,
  };
}

/** 리더: 게임 시작 (점수 초기화) */
export async function startGame(room: SketchRoom) {
  const list = orderedPlayers(room);
  if (list.length < 2) return;
  const scores: Record<string, SketchScore> = {};
  for (const p of list) scores[p.uid] = { nick: p.nick, score: 0 };
  const first = list[0].uid;
  const patch = turnPatch(room, first, 1);
  await update(r(""), {
    [`rooms/${room.id}/scores`]: scores,
    [`rooms/${room.id}/state`]: {
      ...patch,
      drawn: { [first]: 1 },
    },
    [`strokes/${room.id}`]: null,
    [`words/${room.id}`]: null,
    [`guesses/${room.id}`]: null,
  });
  await systemChat(
    room.id,
    `게임 시작! 한 사람당 ${room.meta.rounds}번씩 그려요. 중간에 들어와도 같이 할 수 있어요.`
  );
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
  await set(r(`words/${roomId}`), {
    turnId,
    choices: choices.map((c) => c.word),
    levels: choices.map((c) => c.level),
  });
}

export function subscribeWords(roomId: string, cb: (w: TurnWords | null) => void) {
  return onValue(
    r(`words/${roomId}`),
    (s) => cb(s.val()),
    () => cb(null)
  );
}

/** 그리는 사람: 제시어 선택 → 그리기 시작 */
export async function chooseWord(room: SketchRoom, word: string, hint: string, level: number) {
  const { id, state } = room;
  await update(r(`words/${id}`), { word });
  await runTransaction(stateRef(id), (cur: SketchState | null) => {
    if (!cur || cur.turnId !== state.turnId || cur.phase !== "choosing") return;
    return {
      ...cur,
      phase: "drawing",
      endsAt: serverNow() + room.meta.drawTime * 1000,
      hint,
      level,
    };
  });
}

export async function setHint(roomId: string, turnId: string, hint: string) {
  await runTransaction(stateRef(roomId), (cur: SketchState | null) => {
    if (!cur || cur.turnId !== turnId || cur.phase !== "drawing" || cur.hint === hint) return;
    return { ...cur, hint };
  });
}

/** 첫 정답자 추가 점수 */
export const FIRST_BONUS = 30;

/**
 * 그리는 사람: 정답 처리.
 * - 맞힌 사람: 빨리 맞힐수록 20~100점 × 제시어 난이도 배율, 첫 정답자는 +30
 * - 그린 사람: 누가 맞힐 때마다 그 사람 점수(첫 정답 보너스 빼고)의 절반 — 잘 그려서 빨리 맞히게 할수록 이득
 */
export async function markCorrect(room: SketchRoom, guess: Guess) {
  const { id, state, meta } = room;
  const left = Math.max(0, state.endsAt - serverNow());
  const bonus = LEVEL_BONUS[state.level as 0 | 1 | 2] ?? 1;
  const base = Math.round((20 + (80 * left) / (meta.drawTime * 1000)) * bonus);
  const drawerPts = Math.round(base / 2);
  let applied = false;
  let pts = base;
  let first = false;
  await runTransaction(stateRef(id), (cur: SketchState | null) => {
    if (!cur || cur.turnId !== guess.turnId || cur.phase !== "drawing") return;
    if (cur.correct?.[guess.uid] !== undefined) return;
    applied = true;
    first = !cur.firstCorrect;
    pts = base + (first ? FIRST_BONUS : 0);
    return {
      ...cur,
      correct: { ...(cur.correct ?? {}), [guess.uid]: pts },
      firstCorrect: cur.firstCorrect || guess.uid,
    };
  });
  if (!applied) return;
  await Promise.all([
    runTransaction(r(`rooms/${id}/scores/${guess.uid}/score`), (v) => (Number(v) || 0) + pts),
    runTransaction(
      r(`rooms/${id}/scores/${state.drawer}/score`),
      (v) => (Number(v) || 0) + drawerPts
    ),
    push(r(`chat/${id}`), {
      uid: guess.uid,
      nick: guess.nick,
      text: `${guess.nick}님이 ${first ? "제일 먼저 " : ""}정답을 맞혔어요! (+${pts}${first ? " 🥇" : ""}) · 그린 사람 +${drawerPts}`,
      kind: "correct",
      ts: serverNow(),
    }),
  ]);
}

/** 그리는 사람(정답 공개) 또는 리더(그리는 사람이 없을 때): 차례 종료 */
export async function endTurn(roomId: string, turnId: string, reveal: string) {
  let ended = false;
  await runTransaction(stateRef(roomId), (cur: SketchState | null) => {
    if (!cur || cur.turnId !== turnId || (cur.phase !== "drawing" && cur.phase !== "choosing"))
      return;
    ended = true;
    return { ...cur, phase: "reveal", reveal, endsAt: serverNow() + REVEAL_MS };
  });
  if (!ended) return;
  // 이 방에서 다시 안 나오게 기록 (공개된 뒤에 기록해야 미리 답이 새지 않음)
  if (reveal) await set(r(`rooms/${roomId}/used/${usedKey(reveal)}`), true).catch(() => {});
  await systemChat(roomId, reveal ? `정답은 「${reveal}」` : "이번 차례는 건너뛰었어요.");
}

/** used 노드 키 (RTDB 키에 못 쓰는 . # $ [ ] / 제거) */
export const usedKey = (word: string) => normalizeAnswer(word).replace(/[.#$[\]/]/g, "_");

/** 리더: 다음 차례 또는 게임 종료 */
export async function nextTurn(room: SketchRoom) {
  const { id, state } = room;
  const drawer =
    orderedPlayers(room).length < 2
      ? ""
      : nextDrawer(room, state.drawer, state.firstCorrect, state.drawn ?? {});
  const done = !drawer;
  const patch = done ? null : turnPatch(room, drawer, state.turnNo + 1);
  let ok = false;
  await runTransaction(stateRef(id), (cur: SketchState | null) => {
    if (!cur || cur.turnId !== state.turnId || cur.phase !== "reveal") return;
    ok = true;
    if (!patch) return { ...cur, phase: "ended", endsAt: 0 };
    return {
      ...cur,
      ...patch,
      drawn: { ...(cur.drawn ?? {}), [drawer]: (cur.drawn?.[drawer] ?? 0) + 1 },
    };
  });
  if (!ok) return;
  await update(r(""), { [`guesses/${id}`]: null, [`words/${id}`]: null });
  if (done) await systemChat(id, "게임 끝! 최종 순위를 확인하세요.");
}

/** 리더: 대기실로 */
export async function backToWaiting(roomId: string) {
  await update(r(""), {
    [`rooms/${roomId}/state`]: { phase: "waiting" },
    [`strokes/${roomId}`]: null,
  });
}

// ───────────── 그림 ─────────────

export async function addStroke(roomId: string, turnId: string, s: Stroke) {
  await push(r(`strokes/${roomId}/${turnId}`), s);
}

export function subscribeStrokes(
  roomId: string,
  turnId: string,
  onAdd: (key: string, s: Stroke) => void,
  onRemove: (key: string) => void
) {
  const q = r(`strokes/${roomId}/${turnId}`);
  const a = onChildAdded(q, (s) => onAdd(s.key!, s.val()));
  const b = onChildRemoved(q, (s) => onRemove(s.key!));
  return () => {
    a();
    b();
  };
}

export async function removeStrokes(roomId: string, turnId: string, keys: string[]) {
  if (!keys.length) return;
  await update(r(`strokes/${roomId}/${turnId}`), Object.fromEntries(keys.map((k) => [k, null])));
}

export async function clearStrokes(roomId: string, turnId: string) {
  await remove(r(`strokes/${roomId}/${turnId}`));
}

// ───────────── 채팅·정답 ─────────────

export const CHAT_MAX = 60;

export async function sendChat(roomId: string, uid: string, nick: string, text: string) {
  await push(r(`chat/${roomId}`), {
    uid,
    nick,
    text: text.slice(0, CHAT_MAX),
    kind: "msg",
    ts: serverNow(),
  });
}

export async function systemChat(roomId: string, text: string) {
  await push(r(`chat/${roomId}`), {
    uid: "",
    nick: "",
    text,
    kind: "system",
    ts: serverNow(),
  }).catch(() => {});
}

export function subscribeChat(roomId: string, cb: (list: ChatMsg[]) => void) {
  const list: ChatMsg[] = [];
  return onChildAdded(query(r(`chat/${roomId}`), limitToLast(80)), (s) => {
    list.push({ id: s.key!, ...(s.val() as Omit<ChatMsg, "id">) });
    if (list.length > 80) list.shift();
    cb([...list]);
  });
}

/** 그리는 중 정답 시도 — 그리는 사람만 읽어서 판정 */
export async function sendGuess(roomId: string, g: Omit<Guess, "id">) {
  await push(r(`guesses/${roomId}`), { ...g, text: g.text.slice(0, CHAT_MAX), ts: serverNow() });
}

export function subscribeGuesses(roomId: string, cb: (g: Guess) => void) {
  return onChildAdded(
    r(`guesses/${roomId}`),
    (s) => cb({ id: s.key!, ...(s.val() as Omit<Guess, "id">) }),
    () => {}
  );
}

export async function removeGuess(roomId: string, id: string) {
  await remove(r(`guesses/${roomId}/${id}`)).catch(() => {});
}

/** 오답은 그리는 사람이 대신 채팅에 올려줌 */
export async function relayGuess(roomId: string, g: Guess) {
  await push(r(`chat/${roomId}`), {
    uid: g.uid,
    nick: g.nick,
    text: g.text,
    kind: "msg",
    ts: serverNow(),
  });
}
