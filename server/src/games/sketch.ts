import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Deps } from "../deps";
import { AppError, bad, forbidden } from "../errors";
import { isClientId, newId, orderedId } from "../ids";
import type { Ctx } from "../realtime/gateway";
import { GUEST_MARK } from "../users";
import type { LiveRoom } from "../http/admin";
import { RESTORED, RESTORE_GRACE_MS, type LiveGame } from "../live";
import {
  CHALLENGE_BONUS,
  CHALLENGE_CHANCE,
  FAKE_COLORS,
  FAKE_LAPS,
  MODE_MS,
  MODE_POINTS,
  MODES,
  MONO_COLOR,
  RELAY_MAX_STEPS,
  type Challenge,
  type GameMode,
} from "../../../web/src/lib/sketch/modes";
import { CUSTOM_LEN, CUSTOM_MAX, TOPICS, pickWord } from "../../../web/src/lib/sketch/words";
import { pickPrompts } from "../../../web/src/lib/sketch/prompts";

/*
 * DOODLE PARTY (실시간 그림 파티게임 — 예전 이름 스케치 퀴즈)
 * 모드: 그림 맞히기(classic) · 가짜 화가(fake) · 그림 속 거짓말(lie) · 그림 릴레이(relay) — web/src/lib/sketch/modes.ts
 *
 * 기존에는 Firebase Realtime Database에 방 상태를 두고 브라우저끼리 진행을 나눠 맡았음.
 * 지금은 서버가 방 상태를 메모리에 들고 권한 검사와 상태 변경을 맡음.
 * 진행 방식 자체는 그대로:
 *  - 그리는 사람: 제시어 후보·선택, 정답 판정, 힌트, 시간 종료
 *  - 리더(방장. 방장이 나가면 가장 먼저 들어와 있는 사람이 이어받음): 게임 시작, 다음 차례, 강퇴
 * 방은 접속자가 없으면 정리되는 휘발성 데이터라 평소엔 DB에 저장하지 않음.
 * 배포로 서버를 다시 띄울 때만 방 전체(그리던 그림까지)를 저장했다가 이어받음 (live.ts).
 *
 * 구독 채널
 *   sketch.lobby                 로비 목록 (로그인 없이도 가능)
 *   sketch.room    { id }        방 전체 상태 (없으면 null)
 *   sketch.strokes { id, turn }  이번 차례 그림 조각 — 참가자만
 *   sketch.chat    { id }        채팅 — 참가자만
 *   sketch.guesses { id }        정답 시도 — 그리는 사람만 (답이 채팅에 노출되지 않게)
 *   sketch.words   { id }        제시어 후보·정답 — 그리는 사람만
 *   sketch.secret  { id }        나만 아는 것 (가짜 화가 제시어 · 내 엉뚱한 제시어 · 릴레이에서 이어받은 것)
 *   sketch.sheet   { id, key }   따로 그린 그림 한 장 (거짓말 · 릴레이) — 볼 수 있을 때만
 *   sketch.album   { id }        릴레이 앨범 (앨범을 넘길 때부터)
 *
 * 그림 맞히기 진행은 그리는 사람 · 리더 화면이 요청하고, 다른 모드는 서버가 단계를 넘김
 * (다 냈으면 바로, 시간이 다 되면 리더 화면이 sketch.tick 으로 알려 줌 — 서버엔 타이머가 없어서 배포 이어받기가 그대로 됨)
 */

export type TurnMode = "winner" | "order";
export type Phase =
  | "waiting"
  | "choosing"
  | "drawing"
  | "reveal"
  | "ended"
  // 가짜 화가: 한 획씩 · 투표 · 가짜의 마지막 기회 · 결과
  | "f-draw"
  | "f-vote"
  | "f-guess"
  | "f-result"
  // 그림 속 거짓말: 다 같이 그리기 · 가짜 제목 쓰기 · 고르기 · 공개
  | "l-draw"
  | "l-write"
  | "l-pick"
  | "l-show"
  // 그림 릴레이: 첫 문장 · 그리기 · 문장으로 · 앨범
  | "r-write"
  | "r-draw"
  | "r-desc"
  | "r-album";

interface Meta {
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
  /** 그림 맞히기: 깜짝 챌린지 */
  challenge: boolean;
  /** 이 주제만 (비었으면 전체) */
  topics: string[];
  /** 우리끼리 제시어 */
  custom: string[];
  customOnly: boolean;
  /** 가짜 화가: 몇 바퀴 그리는지 */
  laps: number;
}
interface Player {
  nick: string;
  joinedAt: number;
}
interface Score {
  nick: string;
  score: number;
}
interface State {
  phase: Phase;
  turnId: string;
  turnNo: number;
  drawer: string;
  drawerNick: string;
  endsAt: number;
  /** 글자 수·힌트 (예: "○○○", "포○○") */
  hint: string;
  /** reveal 단계에서 공개되는 정답 ("" = 건너뜀) */
  reveal: string;
  /** 이번 차례 정답자 → 얻은 점수 */
  correct: Record<string, number>;
  firstCorrect: string;
  /** 지금까지 그린 횟수 — 각자 rounds번 그리면 게임 끝 */
  drawn: Record<string, number>;
  /** 이번 제시어 난이도 (0 쉬움 · 1 보통 · 2 어려움) */
  level: number;
  /** 단계가 바뀔 때마다 1씩 (다른 모드의 제출 · 시간 끝 알림이 지난 단계로 가지 않게) */
  step: number;
  /** 이번 차례 깜짝 챌린지 (그림 맞히기) */
  challenge: Challenge;
  /** 따봉: 그림 키 → 누른 사람들 */
  likes: Record<string, string[]>;
  /** 건너뛰기 투표한 사람 (그림 맞히기) */
  skip: string[];
  /** 다른 모드의 공개 진행 상태 */
  m: ModeState | null;
}

/** 가짜 화가 공개 상태 */
interface FakeState {
  kind: "fake";
  game: number;
  games: number;
  topic: string;
  order: string[];
  /** 지금 몇 번째 획 (0부터) */
  at: number;
  colors: Record<string, string>;
  voted: string[];
  /** 결과 때 공개 */
  votes?: Record<string, string>;
  faker?: string;
  word?: string;
  caught?: boolean;
  guess?: string;
  win?: "fake" | "artists" | "gone";
}
/** 그림 속 거짓말 공개 상태 */
interface LieState {
  kind: "lie";
  /** 이번 판에 끼어 있는 사람 */
  players: string[];
  /** 그린 사람들 (그림 보여 주는 순서) */
  order: string[];
  idx: number;
  artist: string;
  done: string[];
  options?: { id: string; text: string }[];
  show?: { id: string; text: string; truth: boolean; authors: string[]; pickers: string[] }[];
  prompt?: string;
}
/** 그림 릴레이 공개 상태 */
interface RelayState {
  kind: "relay";
  order: string[];
  steps: number;
  step: number;
  done: string[];
  album?: { chain: number; page: number };
}
type ModeState = FakeState | LieState | RelayState;

/** 릴레이 한 칸 */
interface RelayEntry {
  by: string;
  text?: string;
  /** 그림이면 sheets 의 키 */
  sheet?: string;
}
/** 다른 모드의 비밀 상태 (방 상태로 안 나감) */
interface ModeSecret {
  /** 가짜 화가 */
  faker?: string;
  word?: string;
  /** 이번 획의 그림 묶음 (한 획만) */
  strokeG?: string;
  fakeVotes?: Record<string, string>;
  /** 그림 속 거짓말: 사람 → 제시어, 지금 그림의 가짜 제목 · 고른 것 · 보기 작성자 */
  prompts?: Record<string, string>;
  lies?: Record<string, string>;
  picks?: Record<string, string>;
  authors?: Record<string, string[] | "truth">;
  /** 그림 릴레이 */
  chains?: RelayEntry[][];
}
interface ChatMsg {
  id: string;
  uid: string;
  nick: string;
  text: string;
  kind: "msg" | "system" | "correct" | "secret";
  ts: number;
}
/** 거의 맞힌 사람에게만 보내는 안내 (채팅 기록엔 안 남김) */
interface CloseNote extends Omit<ChatMsg, "kind"> {
  kind: "close";
  /** 거의 맞힌 그 채팅의 id */
  of: string;
}
interface Guess {
  id: string;
  uid: string;
  nick: string;
  text: string;
  turnId: string;
  ts: number;
}
interface Words {
  turnId: string;
  choices?: string[];
  levels?: number[];
  word?: string;
}

interface Room {
  id: string;
  meta: Meta;
  players: Record<string, Player>;
  scores: Record<string, Score>;
  state: State;
  kicked: Record<string, string>;
  used: Record<string, true>;
  // ── 여기부터는 방 상태 구독으로 나가지 않는 것 ──
  /** 지금 차례의 그림 조각 (키 순서 = 그린 순서) */
  strokes: Map<string, unknown>;
  strokesTurn: string;
  chat: ChatMsg[];
  guesses: Guess[];
  words: Words | null;
  /** 비밀번호 해시 (잠긴 방만) */
  pw: string | null;
  /** 초대 링크용 키 */
  invite: string;
  /** 비밀번호·초대키를 맞힌 사람 */
  access: Set<string>;
  /** 플레이어 자리의 주인 소켓 — 그 소켓이 끊기면 자리에서 뺌 */
  owners: Map<string, string>;
  /** 게임 중에 들어와 아직 안 그린 사람 (들어온 순서) — 이번 바퀴가 끝난 뒤에 그림 */
  late: string[];
  /** 처음 들어온 시각 (새로고침 · 잠깐 나갔다 와도 입장 순서 그대로, 나간 사람 다음 차례 계산용) */
  seen: Record<string, number>;
  /** 이번 판에 정답이 나왔는지 (정답 없이 건너뛰기만 한 판은 기록 안 함) */
  scored: boolean;
  /** 다른 모드의 비밀 상태 */
  mx: ModeSecret;
  /** 따로 그린 그림들 (키 → 획 목록) */
  sheets: Record<string, Stroke[]>;
  /** 한붓그리기: 첫 획 묶음 */
  oneG: string;
  /** 이번 판 따봉 1등 그림 */
  best: { key: string; n: number; author: string; label: string } | null;
  /** 아무도 없게 된 시각 (정리용) */
  emptySince: number;
}

export const CHOOSE_MS = 15_000;
export const REVEAL_MS = 5_000;
/** 첫 정답자 추가 점수 */
const FIRST_BONUS = 30;
/** 제시어 난이도별 점수 배율 — web/src/lib/sketch/words.ts 의 LEVEL_BONUS 와 같은 값 */
const LEVEL_BONUS = [1, 1.2, 1.5];
/** 정답 비교용 (공백 제거, 소문자) — web/src/lib/sketch/words.ts 의 normalizeAnswer 와 같은 식 */
const normalizeAnswer = (s: string) => s.replace(/\s+/g, "").toLowerCase();
/** 안내 문장에 넣는 이름: 비회원 표시(◦)는 뺌 — 문장은 화면에서 그대로 글자로 나가므로 */
const plain = (nick: string) => nick.replaceAll(GUEST_MARK, "");

const CHAT_KEEP = 200;
const CHAT_SNAPSHOT = 80;
const MAX_ROOMS = 500;
const MAX_STROKES = 20_000;
const MAX_GUESSES = 300;

const emptyState = (): State => ({
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
});
/** 섞기 */
function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}
const CHALLENGE_KINDS: Exclude<Challenge, "">[] = ["oneline", "blind", "mono"];

const hashPassword = (roomId: string, pw: string) => createHash("sha256").update(`${roomId}:${pw}`).digest("hex");
const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** 접속 중인 사람을 들어온 순서대로 */
function orderedPlayers(room: Room): (Player & { uid: string })[] {
  return Object.entries(room.players)
    .map(([uid, p]) => ({ uid, ...p }))
    .sort((a, b) => a.joinedAt - b.joinedAt || a.uid.localeCompare(b.uid));
}
/** 리더 = 방장. 방장이 나가 있으면 가장 먼저 들어와 있는 사람 */
const leaderOf = (room: Room) =>
  room.players[room.meta.hostUid] ? room.meta.hostUid : (orderedPlayers(room)[0]?.uid ?? "");

/** 다음에 그릴 사람 ("" = 모두 다 그림 → 게임 끝) */
function nextDrawer(room: Room): string {
  const { drawer: current, firstCorrect, drawn } = room.state;
  const all = orderedPlayers(room).map((p) => p.uid);
  let pending = all.filter((u) => (drawn[u] ?? 0) < room.meta.rounds);
  if (pending.length === 0) return "";
  // 게임 중에 들어온 사람은 원래 있던 사람들이 이번 바퀴를 다 그린 뒤에 (들어온 순서대로)
  const late = room.late.filter((u) => pending.includes(u));
  if (late.length) {
    const early = pending.filter((u) => !late.includes(u));
    const lap = Math.max(0, ...all.filter((u) => !late.includes(u)).map((u) => drawn[u] ?? 0));
    const behind = early.filter((u) => (drawn[u] ?? 0) < lap);
    if (!behind.length) return late[0];
    pending = behind;
  }
  if (room.meta.turnMode === "winner" && firstCorrect && pending.includes(firstCorrect)) return firstCorrect;
  // 입장 순서로 지금 사람 다음부터 돌면서 아직 덜 그린 사람 (지금 사람이 나갔으면 그 사람이 있던 자리 다음부터)
  const at = room.seen[current];
  const start = all.includes(current) ? all.indexOf(current) : at === undefined ? -1 : orderedPlayers(room).filter((p) => p.joinedAt <= at).length - 1;
  for (let k = 1; k <= all.length; k++) {
    const u = all[(start + k + all.length) % all.length];
    if (pending.includes(u)) return u;
  }
  return pending[0];
}

const roomId = z.string().min(1).max(40);
const idOnly = z.object({ id: roomId });
const nickSchema = z.string().min(1).max(10);
type Stroke = z.infer<typeof strokeSchema>;
const strokeSchema = z.strictObject({
  g: z.string().max(24),
  c: z.string().max(24),
  w: z.number().optional(),
  p: z.string().max(20_000).optional(),
  t: z.literal("f").optional(),
  e: z.literal(1).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

export interface SketchOptions {
  /** 이만큼 비어 있던 방은 정리 */
  emptyRoomTtlMs?: number;
  /** 정리 주기 */
  sweepIntervalMs?: number;
}

export function registerSketch({ gateway, users }: Deps, opts: SketchOptions = {}) {
  const rooms = new Map<string, Room>();
  // 끊겨서 빈 방은 새로고침·재접속으로 돌아올 시간만 남겨 두고 정리 (예전 30분 → 3분)
  const emptyRoomTtl = opts.emptyRoomTtlMs ?? 3 * 60_000;

  const LOBBY = "sketch:lobby";
  const roomKey = (id: string) => `sketch:room:${id}`;
  const strokesKey = (id: string, turn: string) => `sketch:strokes:${id}:${turn}`;
  const chatKey = (id: string) => `sketch:chat:${id}`;
  const guessesKey = (id: string) => `sketch:guesses:${id}`;
  const wordsKey = (id: string) => `sketch:words:${id}`;
  const secretKey = (id: string, uid: string) => `sketch:secret:${id}:${uid}`;
  const sheetKey = (id: string, key: string) => `sketch:sheet:${id}:${key}`;
  const albumKey = (id: string) => `sketch:album:${id}`;

  // ───────────── 내보내기 ─────────────

  const roomWire = (r: Room) => ({
    id: r.id,
    meta: r.meta,
    players: r.players,
    scores: r.scores,
    state: r.state,
    kicked: r.kicked,
    used: r.used,
  });
  const lobbyWire = () =>
    [...rooms.values()]
      .map((r) => ({
        id: r.id,
        name: r.meta.name,
        locked: r.meta.locked,
        max: r.meta.max,
        count: Object.keys(r.players).length,
        phase: r.state.phase,
        turnMode: r.meta.turnMode,
        mode: r.meta.mode,
        createdAt: r.meta.createdAt,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);

  let lobbyDirty = false;
  /** 방 상태가 바뀜 → 방 구독자와 (요약이 달라졌을 수 있으니) 로비에 알림 */
  function changed(room: Room) {
    gateway.emit(roomKey(room.id), "room", roomWire(room));
    // 한 요청 안에서 여러 번 바뀌어도 로비는 한 번만
    if (lobbyDirty) return;
    lobbyDirty = true;
    queueMicrotask(() => {
      lobbyDirty = false;
      gateway.emit(LOBBY, "list", lobbyWire());
    });
  }

  function pushChat(room: Room, msg: Omit<ChatMsg, "id" | "ts"> & { id?: string }) {
    const full: ChatMsg = { ...msg, id: msg.id ?? orderedId(), ts: Date.now() };
    room.chat.push(full);
    if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
    gateway.emit(chatKey(room.id), "add", full);
  }
  /** 방에 등록된 그 사람의 이름 (없으면 fallback) */
  const nameIn = (room: Room, uid: string, fallback: string) =>
    room.players[uid]?.nick ?? room.scores[uid]?.nick ?? fallback;
  const systemChat = (room: Room, text: string) => pushChat(room, { uid: "", nick: "", text, kind: "system" });

  function setWords(room: Room, words: Words | null) {
    room.words = words;
    gateway.emit(wordsKey(room.id), "value", words);
  }
  function clearGuesses(room: Room) {
    room.guesses = [];
  }
  /** 그림 전체 지우기 (보고 있는 사람들 화면에서도 지워짐) */
  function clearStrokes(room: Room) {
    if (room.strokes.size) gateway.emit(strokesKey(room.id, room.strokesTurn), "clear");
    room.strokes = new Map();
  }

  /** 그리는 사람이 바뀌면 이전 사람의 제시어·정답 시도 구독을 끊음 */
  function drawerChanged(room: Room) {
    const still = (ctx: Ctx) => ctx.user?.uid !== room.state.drawer;
    gateway.revoke(wordsKey(room.id), still);
    gateway.revoke(guessesKey(room.id), still);
  }

  function removeRoom(room: Room) {
    rooms.delete(room.id);
    gateway.emit(roomKey(room.id), "room", null);
    gateway.emit(LOBBY, "list", lobbyWire());
    for (const key of [chatKey(room.id), guessesKey(room.id), wordsKey(room.id), strokesKey(room.id, room.strokesTurn), albumKey(room.id)])
      gateway.revoke(key);
    for (const uid of Object.keys(room.seen)) gateway.revoke(secretKey(room.id, uid));
  }

  /** 자리에서 빼기 (나가기·끊김·강퇴 공통). 방장이었으면 남은 사람 중 리더가 이어받음 */
  function removePlayer(room: Room, uid: string) {
    if (!room.players[uid]) return;
    delete room.players[uid];
    room.owners.delete(uid);
    const leader = leaderOf(room);
    if (leader && leader !== room.meta.hostUid) room.meta.hostUid = leader;
    if (!Object.keys(room.players).length) room.emptySince = Date.now();
    changed(room);
    // 다른 모드: 빠진 사람을 기다리느라 멈추지 않게 (나머지가 다 냈으면 바로 다음 · 그리던 사람이면 다음 획)
    if (room.state.m && Object.keys(room.players).length) {
      if (room.state.phase === "f-draw" && room.state.drawer === uid) fakeNextStroke(room);
      else if (room.state.phase === "f-guess" && room.mx.faker === uid) fakeFinish(room, { caught: true, guessed: false, gone: true });
      else maybeAdvance(room);
    }
  }

  // ───────────── 권한 ─────────────

  const getRoom = (id: string): Room => {
    const room = rooms.get(id);
    if (!room) throw new AppError("NO_ROOM", "방이 없습니다.", 404);
    return room;
  };
  /** 방에 들어와 있는 사람만 */
  function asPlayer(ctx: Ctx, id: string) {
    const room = getRoom(id);
    const uid = ctx.uid;
    if (!room.players[uid]) throw forbidden();
    return { room, uid };
  }
  function asDrawer(ctx: Ctx, id: string) {
    const { room, uid } = asPlayer(ctx, id);
    if (room.state.drawer !== uid) throw forbidden();
    return { room, uid };
  }
  function asLeader(ctx: Ctx, id: string) {
    const { room, uid } = asPlayer(ctx, id);
    if (leaderOf(room) !== uid) throw forbidden();
    return { room, uid };
  }
  /**
   * 채팅·그림을 볼 수 있는 사람: 지금 참가자, 또는 잠깐 끊겼다 돌아오는 중인 참가자(점수 자리가 남아 있음).
   * 재연결 때는 구독 복구가 재입장보다 먼저 오기 때문에 점수 자리로도 인정함. 강퇴된 사람은 제외.
   */
  function asViewer(ctx: Ctx, id: string) {
    const room = getRoom(id);
    const uid = ctx.uid;
    if (room.kicked[uid] !== undefined || (!room.players[uid] && !room.scores[uid])) throw forbidden();
    return room;
  }

  // 비밀번호 대입 방지: 한 사람이 한 방에 1분에 10번까지
  const unlockTries = new Map<string, { at: number; n: number }>();
  function countUnlockTry(key: string) {
    const now = Date.now();
    const t = unlockTries.get(key);
    if (!t || now - t.at > 60_000) unlockTries.set(key, { at: now, n: 1 });
    else if (++t.n > 10) throw new AppError("RATE_LIMITED", "잠시 후 다시 시도해주세요.", 429);
    if (unlockTries.size > 5000) unlockTries.clear();
  }

  // ───────────── 구독 채널 ─────────────

  gateway.channel("sketch.lobby", { key: () => LOBBY, snapshot: () => lobbyWire() });

  gateway.channel("sketch.room", {
    key(ctx, p) {
      void ctx.uid; // 로그인한 사람만
      return roomKey(idOnly.parse(p).id);
    },
    snapshot(ctx, _key, p) {
      const room = rooms.get(idOnly.parse(p).id);
      if (!room) return null;
      // 서버가 다시 켜진 뒤 처음 들어온 연결 → 그 사람 자리의 주인으로 (이 연결이 끊기면 자리를 비움)
      const uid = ctx.user?.uid;
      if (uid && room.owners.get(uid) === RESTORED) room.owners.set(uid, ctx.socket.id);
      return roomWire(room);
    },
  });

  const strokesParams = z.object({ id: roomId, turn: z.string().min(1).max(40) });
  gateway.channel("sketch.strokes", {
    key(ctx, p) {
      const { id, turn } = strokesParams.parse(p);
      asViewer(ctx, id);
      return strokesKey(id, turn);
    },
    snapshot(_ctx, _key, p) {
      const { id, turn } = strokesParams.parse(p);
      const room = rooms.get(id);
      return room && room.strokesTurn === turn ? [...room.strokes.entries()] : [];
    },
  });

  gateway.channel("sketch.chat", {
    key(ctx, p) {
      const { id } = idOnly.parse(p);
      asViewer(ctx, id);
      return chatKey(id);
    },
    snapshot: (_ctx, _key, p) => (rooms.get(idOnly.parse(p).id)?.chat ?? []).slice(-CHAT_SNAPSHOT),
  });

  gateway.channel("sketch.guesses", {
    key(ctx, p) {
      const { id } = idOnly.parse(p);
      if (getRoom(id).state.drawer !== ctx.uid) throw forbidden();
      return guessesKey(id);
    },
    snapshot: (_ctx, _key, p) => rooms.get(idOnly.parse(p).id)?.guesses ?? [],
  });

  gateway.channel("sketch.words", {
    key(ctx, p) {
      const { id } = idOnly.parse(p);
      if (getRoom(id).state.drawer !== ctx.uid) throw forbidden();
      return wordsKey(id);
    },
    snapshot: (_ctx, _key, p) => rooms.get(idOnly.parse(p).id)?.words ?? null,
  });

  gateway.channel("sketch.secret", {
    key(ctx, p) {
      const { id } = idOnly.parse(p);
      asViewer(ctx, id);
      return secretKey(id, ctx.uid);
    },
    snapshot: (ctx, _key, p) => {
      const room = rooms.get(idOnly.parse(p).id);
      return room ? secretOf(room, ctx.uid) : null;
    },
  });

  const sheetParams = z.object({ id: roomId, key: z.string().min(1).max(40) });
  gateway.channel("sketch.sheet", {
    key(ctx, p) {
      const { id, key } = sheetParams.parse(p);
      const room = asViewer(ctx, id);
      if (!canSeeSheet(room, ctx.uid, key)) throw forbidden();
      return sheetKey(id, key);
    },
    snapshot: (_ctx, _key, p) => {
      const { id, key } = sheetParams.parse(p);
      return rooms.get(id)?.sheets[key] ?? null;
    },
  });

  gateway.channel("sketch.album", {
    key(ctx, p) {
      const { id } = idOnly.parse(p);
      const room = asViewer(ctx, id);
      if (!albumOpen(room)) throw forbidden();
      return albumKey(id);
    },
    snapshot: (_ctx, _key, p) => {
      const room = rooms.get(idOnly.parse(p).id);
      return room && albumOpen(room) ? (room.mx.chains ?? []) : null;
    },
  });

  // ───────────── 방 만들기 · 입장 · 퇴장 ─────────────

  const createSchema = z.object({
    nick: nickSchema,
    name: z.string().max(60),
    max: z.number().int(),
    turnMode: z.enum(["winner", "order"]),
    drawTime: z.number().int().min(30).max(300),
    rounds: z.number().int().min(1).max(10),
    hints: z.boolean(),
    password: z.string().max(100),
    mode: z.enum(["classic", "fake", "lie", "relay"]).default("classic"),
    challenge: z.boolean().default(true),
    topics: z.array(z.string().max(20)).max(20).default([]),
    custom: z.array(z.string().max(40)).max(200).default([]),
    customOnly: z.boolean().default(false),
    laps: z.number().int().min(1).max(8).default(FAKE_LAPS),
  });
  gateway.rpc("sketch.createRoom", (ctx, raw) => {
    const uid = ctx.uid;
    const o = createSchema.parse(raw);
    if (rooms.size >= MAX_ROOMS) throw bad("방이 너무 많아요. 잠시 후 다시 시도해주세요.");
    const id = newId();
    const password = o.password.trim();
    const locked = password !== "";
    const now = Date.now();
    const room: Room = {
      id,
      meta: {
        name: o.name.trim().slice(0, 20) || `${ctx.nick ?? o.nick}의 방`,
        hostUid: uid,
        max: Math.min(8, Math.max(2, o.max)),
        turnMode: o.turnMode,
        drawTime: o.drawTime,
        rounds: o.rounds,
        hints: o.hints,
        locked,
        createdAt: now,
        mode: o.mode,
        challenge: o.challenge,
        topics: o.topics.filter((t) => TOPICS.includes(t)),
        custom: [...new Set(o.custom.map((w) => w.replace(/\s+/g, " ").trim().slice(0, CUSTOM_LEN)).filter(Boolean))].slice(0, CUSTOM_MAX),
        customOnly: o.customOnly && o.custom.length > 0,
        laps: o.laps,
      },
      players: {},
      scores: {},
      state: emptyState(),
      kicked: {},
      used: {},
      strokes: new Map(),
      strokesTurn: "",
      chat: [],
      guesses: [],
      words: null,
      pw: locked ? hashPassword(id, password) : null,
      invite: newId(24),
      access: new Set(locked ? [uid] : []),
      owners: new Map(),
      late: [],
      seen: {},
      scored: false,
      mx: {},
      sheets: {},
      oneG: "",
      best: null,
      emptySince: now,
    };
    rooms.set(id, room);
    changed(room);
    return id;
  });

  gateway.rpc("sketch.hasAccess", (ctx, raw) => {
    const room = rooms.get(idOnly.parse(raw).id);
    return !!room?.access.has(ctx.uid);
  });

  /** 비번방이면 비밀번호나 초대키로 접근 권한을 먼저 얻음 */
  const unlockSchema = z.object({ id: roomId, password: z.string().max(100).optional(), invite: z.string().max(100).optional() });
  gateway.rpc("sketch.unlockRoom", (ctx, raw) => {
    const { id, password, invite } = unlockSchema.parse(raw);
    const uid = ctx.uid;
    const room = getRoom(id);
    if (!room.meta.locked) return null;
    countUnlockTry(`${id}/${uid}`);
    const ok =
      invite !== undefined
        ? safeEqual(invite, room.invite)
        : !!room.pw && safeEqual(hashPassword(id, password ?? ""), room.pw);
    if (!ok) throw new AppError("WRONG_PASSWORD", "비밀번호가 맞지 않습니다.", 403);
    room.access.add(uid);
    return null;
  });

  /** 초대 링크에 넣을 키 — 방 참가자만 */
  gateway.rpc("sketch.getInvite", (ctx, raw) => {
    const room = rooms.get(idOnly.parse(raw).id);
    return room && room.players[ctx.uid] ? room.invite : null;
  });

  const joinSchema = z.object({ id: roomId, nick: nickSchema, joinedAt: z.number().finite().optional(), rejoin: z.boolean().default(false) });
  gateway.rpc("sketch.join", (ctx, raw) => {
    const { id, nick: typed, joinedAt, rejoin } = joinSchema.parse(raw);
    const uid = ctx.uid;
    // 이름은 서버가 정함: 회원이면 별명, 아니면 적은 이름에 비회원 표시
    const nick = ctx.name(typed);
    const room = getRoom(id);
    if (room.kicked[uid] !== undefined) throw forbidden("방장이 이 방에서 내보냈어요.");
    if (room.meta.locked && room.meta.hostUid !== uid && !room.access.has(uid)) throw forbidden("비밀번호가 필요한 방입니다.");
    // 정원: 새로 들어오는 사람만 막음 (잠깐 끊겼다 돌아오는 사람은 통과)
    if (!room.players[uid] && !rejoin && Object.keys(room.players).length >= room.meta.max)
      throw new AppError("ROOM_FULL", "방이 가득 찼어요.", 409);
    // 입장 시각은 클라이언트가 보냄(잠깐 끊겼다 재연결이면 원래 값 → 입장 순서 유지). 미래·방 생성 전 값은 바로잡음
    const now = Date.now();
    // 이 방에 왔던 사람이면 처음 들어온 시각 그대로 (새로고침해도 순서가 안 바뀜)
    const first = room.seen[uid] ?? Math.max(room.meta.createdAt, Math.min(now, joinedAt ?? now));
    room.seen[uid] = first;
    room.players[uid] = { nick, joinedAt: first };
    // 게임 중에 처음 들어온 사람은 이번 바퀴 맨 뒤로 (이번 판에 있던 사람이 다시 들어온 건 아님)
    const playing = room.state.phase !== "waiting" && room.state.phase !== "ended";
    if (room.meta.mode === "classic" && playing && !room.scores[uid] && room.state.drawn[uid] === undefined && !room.late.includes(uid)) room.late.push(uid);
    room.owners.set(uid, ctx.socket.id);
    // 점수 자리 (새로고침으로 다시 들어온 경우 기존 점수 유지)
    const cur = room.scores[uid];
    room.scores[uid] = cur ? { ...cur, nick } : { nick, score: 0 };
    // 방장이 방에 없으면(만든 직후, 혼자 있다 새로고침) 지금 리더가 방장
    const leader = leaderOf(room);
    if (leader && leader !== room.meta.hostUid) room.meta.hostUid = leader;
    changed(room);
    return { joinedAt: room.players[uid].joinedAt };
  });

  const leaveSchema = z.object({ id: roomId, nick: z.string().max(10).optional() });
  gateway.rpc("sketch.leave", (ctx, raw) => {
    const { id, nick } = leaveSchema.parse(raw);
    const uid = ctx.uid;
    const room = rooms.get(id);
    if (!room || !room.players[uid]) return null;
    if (nick) systemChat(room, `${plain(room.players[uid].nick)}님이 나갔어요.`);
    removePlayer(room, uid);
    // 마지막 사람이 직접 나갔으면 곧바로 정리 (빠른 시작으로 만들고 나간 방이 로비에 남던 것). 같은 화면에서 바로 다시 들어오는 경우만 잠깐 기다림
    if (!Object.keys(room.players).length)
      setTimeout(() => {
        if (rooms.get(id) === room && !Object.keys(room.players).length) removeRoom(room);
      }, 5_000).unref();
    return null;
  });

  // 소켓이 끊기면 그 소켓으로 들어와 있던 자리를 비움
  gateway.onDisconnect((ctx) => {
    const uid = ctx.user?.uid;
    if (!uid) return;
    for (const room of rooms.values()) if (room.owners.get(uid) === ctx.socket.id) removePlayer(room, uid);
  });

  /** 방장이 나갔으면 리더가 방장 자리를 이어받음 (서버가 자리 변동 때 이미 처리하므로 보통은 할 일이 없음) */
  gateway.rpc("sketch.claimHost", (ctx, raw) => {
    const room = rooms.get(idOnly.parse(raw).id);
    const uid = ctx.uid;
    if (!room || !room.players[uid] || room.players[room.meta.hostUid]) return null;
    if (leaderOf(room) !== uid) return null;
    room.meta.hostUid = uid;
    changed(room);
    return null;
  });

  /** 방장: 강퇴 — 자리·점수를 지우고 다시 못 들어오게 표시 */
  gateway.rpc("sketch.kick", (ctx, raw) => {
    const { id, target } = z.object({ id: roomId, target: z.string().min(1).max(128) }).parse(raw);
    const { room, uid } = asPlayer(ctx, id);
    if (room.meta.hostUid !== uid || target === uid) throw forbidden();
    const nick = (room.players[target]?.nick ?? room.scores[target]?.nick ?? "?").slice(0, 10);
    room.kicked[target] = nick;
    delete room.scores[target];
    if (room.players[target]) removePlayer(room, target);
    else changed(room);
    const kickedUser = (c: Ctx) => c.user?.uid === target;
    gateway.revoke(chatKey(id), kickedUser);
    gateway.revoke(strokesKey(id, room.strokesTurn), kickedUser);
    systemChat(room, `${plain(nick)}님을 내보냈어요.`);
    return null;
  });

  /** 아무도 없는 방 정리 (로비 화면이 요청) */
  gateway.rpc("sketch.cleanupEmptyRoom", (ctx, raw) => {
    void ctx.uid;
    const room = rooms.get(idOnly.parse(raw).id);
    if (room && !Object.keys(room.players).length) removeRoom(room);
    return null;
  });

  // ───────────── 진행 ─────────────

  function newTurn(room: Room, drawer: string, turnNo: number): Partial<State> {
    return {
      phase: "choosing",
      turnId: orderedId(),
      turnNo,
      drawer,
      drawerNick: room.players[drawer]?.nick ?? "",
      endsAt: Date.now() + CHOOSE_MS,
      hint: "",
      reveal: "",
      correct: {},
      firstCorrect: "",
      level: 0,
    };
  }
  /** 새 차례로 넘어가며 이전 차례의 그림·제시어·정답 시도를 비움 */
  /** 판이 끝까지 갔을 때 기록 (업적 · 일일 미션): 끝까지 남은 사람은 「한 판」, 3명 이상 판의 1등은 「1등」 */
  function recordGame(room: Room) {
    if (!room.scored) return;
    const here = Object.keys(room.players).filter((u) => room.scores[u]);
    const top = Math.max(0, ...Object.values(room.scores).map((s) => Number(s.score) || 0));
    const many = Object.keys(room.scores).length >= 3;
    for (const u of here) {
      const win = many && top > 0 && (Number(room.scores[u].score) || 0) === top;
      users.bump(u, { "stats.sketch.done": 1, ...(win && { "stats.sketch.wins": 1 }) });
    }
  }

  function beginTurn(room: Room, patch: Partial<State>) {
    // 차례가 바뀌면 화면은 새 turnId 로 다시 구독하므로 이전 그림은 알림 없이 버림
    room.strokes = new Map();
    room.oneG = "";
    // 깜짝 챌린지: 첫 차례는 빼고 가끔
    const challenge: Challenge =
      room.meta.mode === "classic" && room.meta.challenge && (patch.turnNo ?? 0) > 1 && Math.random() < CHALLENGE_CHANCE
        ? CHALLENGE_KINDS[Math.floor(Math.random() * CHALLENGE_KINDS.length)]
        : "";
    room.state = { ...room.state, skip: [], challenge, step: room.state.step + 1, ...patch };
    room.strokesTurn = room.state.turnId;
    clearGuesses(room);
    setWords(room, null);
    drawerChanged(room);
  }

  /** 리더: 게임 시작 (점수 초기화) */
  gateway.rpc("sketch.startGame", (ctx, raw) => {
    const { room } = asLeader(ctx, idOnly.parse(raw).id);
    const list = orderedPlayers(room);
    if (list.length < MODES[room.meta.mode].min) return null;
    room.scores = {};
    for (const p of list) {
      room.scores[p.uid] = { nick: p.nick, score: 0 };
      users.bump(p.uid, { "stats.sketch.games": 1 });
    }
    room.state = { ...emptyState(), step: room.state.step + 1 };
    room.late = [];
    room.scored = false;
    room.mx = {};
    room.sheets = {};
    room.best = null;
    if (room.meta.mode !== "classic") {
      startMode(room, list.map((p) => p.uid));
      return null;
    }
    const first = list[0].uid;
    beginTurn(room, { ...newTurn(room, first, 1), drawn: { [first]: 1 } });
    changed(room);
    systemChat(room, `게임 시작! 한 사람당 ${room.meta.rounds}번씩 그려요. 중간에 들어와도 같이 할 수 있어요.`);
    return null;
  });

  /** 그리는 사람: 제시어 후보 저장 (본인만 읽을 수 있음) */
  const choicesSchema = z.object({
    id: roomId,
    turnId: z.string().max(40),
    choices: z.array(z.object({ word: z.string().min(1).max(40), level: z.number().int().min(0).max(2) })).max(6),
  });
  gateway.rpc("sketch.setChoices", (ctx, raw) => {
    const { id, turnId, choices } = choicesSchema.parse(raw);
    const { room } = asDrawer(ctx, id);
    if (room.state.turnId !== turnId) return null;
    setWords(room, { turnId, choices: choices.map((c) => c.word), levels: choices.map((c) => c.level) });
    return null;
  });

  /** 그리는 사람: 제시어 선택 → 그리기 시작 */
  const chooseSchema = z.object({
    id: roomId,
    turnId: z.string().max(40),
    word: z.string().min(1).max(40),
    hint: z.string().max(60),
    level: z.number().int().min(0).max(2),
  });
  gateway.rpc("sketch.chooseWord", (ctx, raw) => {
    const { id, turnId, word, hint, level } = chooseSchema.parse(raw);
    const { room } = asDrawer(ctx, id);
    setWords(room, { ...(room.words ?? { turnId }), word });
    const cur = room.state;
    if (cur.turnId !== turnId || cur.phase !== "choosing") return null;
    room.state = { ...cur, phase: "drawing", endsAt: Date.now() + room.meta.drawTime * 1000, hint, level };
    changed(room);
    return null;
  });

  gateway.rpc("sketch.setHint", (ctx, raw) => {
    const { id, turnId, hint } = z.object({ id: roomId, turnId: z.string().max(40), hint: z.string().max(60) }).parse(raw);
    const { room } = asDrawer(ctx, id);
    const cur = room.state;
    if (cur.turnId !== turnId || cur.phase !== "drawing" || cur.hint === hint) return null;
    room.state = { ...cur, hint };
    changed(room);
    return null;
  });

  /**
   * 그리는 사람: 정답 처리.
   * - 맞힌 사람: 빨리 맞힐수록 20~100점 × 제시어 난이도 배율, 첫 정답자는 +30
   * - 그린 사람: 누가 맞힐 때마다 그 사람 점수(첫 정답 보너스 빼고)의 절반
   */
  const correctSchema = z.object({
    id: roomId,
    guess: z.object({ uid: z.string().min(1).max(128), nick: z.string().max(12), turnId: z.string().max(40) }),
  });
  gateway.rpc("sketch.markCorrect", (ctx, raw) => {
    const { id, guess: sent } = correctSchema.parse(raw);
    const { room, uid: drawer } = asDrawer(ctx, id);
    // 맞힌 사람의 이름은 방에 등록된 것을 씀
    const guess = { ...sent, nick: nameIn(room, sent.uid, sent.nick) };
    const cur = room.state;
    if (cur.turnId !== guess.turnId || cur.phase !== "drawing") return null;
    if (cur.correct[guess.uid] !== undefined || guess.uid === drawer) return null;
    // 이 방 사람이 아니면 무시
    if (!room.players[guess.uid] && !room.scores[guess.uid]) return null;
    const left = Math.max(0, cur.endsAt - Date.now());
    const bonus = (LEVEL_BONUS[cur.level] ?? 1) * (cur.challenge ? CHALLENGE_BONUS : 1);
    const base = Math.round((20 + (80 * left) / (room.meta.drawTime * 1000)) * bonus);
    const drawerPts = Math.round(base / 2);
    const first = !cur.firstCorrect;
    const pts = base + (first ? FIRST_BONUS : 0);
    room.state = { ...cur, correct: { ...cur.correct, [guess.uid]: pts }, firstCorrect: cur.firstCorrect || guess.uid };
    const add = (uid: string, nick: string, n: number) => {
      const s = room.scores[uid];
      room.scores[uid] = { nick: s?.nick ?? nick, score: (Number(s?.score) || 0) + n };
    };
    add(guess.uid, guess.nick, pts);
    add(drawer, cur.drawerNick, drawerPts);
    // 회원이면 전적에 반영 (비회원 uid 는 무시됨)
    users.bump(guess.uid, { "stats.sketch.correct": 1, "stats.sketch.points": pts, ...(first && { "stats.sketch.first": 1 }) });
    // 그린 사람: 점수 + 이 차례 첫 정답이면 「내 그림이 맞혀진 차례」 1
    users.bump(drawer, { "stats.sketch.points": drawerPts, ...(first && { "stats.sketch.drew": 1 }) });
    room.scored = true;
    changed(room);
    pushChat(room, {
      uid: guess.uid,
      nick: guess.nick,
      text: `${plain(guess.nick)}님이 ${first ? "제일 먼저 " : ""}정답을 맞혔어요! (+${pts}${first ? " 🥇" : ""}) · 그린 사람 +${drawerPts}`,
      kind: "correct",
    });
    return null;
  });

  /** 그리는 사람(정답 공개) 또는 리더(그리는 사람이 없거나 응답이 없을 때): 차례 종료 */
  gateway.rpc("sketch.endTurn", (ctx, raw) => {
    const { id, turnId, reveal } = z.object({ id: roomId, turnId: z.string().max(40), reveal: z.string().max(40) }).parse(raw);
    const { room, uid } = asPlayer(ctx, id);
    const isDrawer = room.state.drawer === uid;
    if (!isDrawer && leaderOf(room) !== uid) throw forbidden();
    const cur = room.state;
    if (cur.turnId !== turnId || (cur.phase !== "drawing" && cur.phase !== "choosing")) return null;
    // 정답은 그리는 사람이 끝낼 때만 공개 (리더가 대신 끝내면 건너뜀). 서버가 아는 제시어와 다르면 서버 것을 씀
    const chosen = room.words?.turnId === turnId ? room.words.word : undefined;
    const shown = isDrawer && reveal ? (chosen ?? reveal) : "";
    room.state = { ...cur, phase: "reveal", reveal: shown, endsAt: Date.now() + REVEAL_MS };
    // 이 방에서 다시 안 나오게 기록 (공개된 뒤에 기록해야 미리 답이 새지 않음)
    if (shown) room.used[normalizeAnswer(shown).replace(/[.#$[\]/]/g, "_")] = true;
    changed(room);
    systemChat(room, shown ? `정답은 「${shown}」` : "이번 차례는 건너뛰었어요.");
    return null;
  });

  /** 리더: 다음 차례 또는 게임 종료 */
  gateway.rpc("sketch.nextTurn", (ctx, raw) => {
    const { id, turnId } = z.object({ id: roomId, turnId: z.string().max(40) }).parse(raw);
    const { room } = asLeader(ctx, id);
    const cur = room.state;
    if (room.meta.mode !== "classic" || cur.turnId !== turnId || cur.phase !== "reveal") return null;
    const drawer = orderedPlayers(room).length < 2 ? "" : nextDrawer(room);
    if (!drawer) {
      endGame(room);
      return null;
    }
    room.late = room.late.filter((u) => u !== drawer);
    beginTurn(room, {
      ...newTurn(room, drawer, cur.turnNo + 1),
      drawn: { ...cur.drawn, [drawer]: (cur.drawn[drawer] ?? 0) + 1 },
    });
    changed(room);
    return null;
  });

  /** 리더: 대기실로 */
  gateway.rpc("sketch.backToWaiting", (ctx, raw) => {
    const { room } = asLeader(ctx, idOnly.parse(raw).id);
    clearStrokes(room);
    room.strokesTurn = "";
    room.state = { ...emptyState(), step: room.state.step + 1 };
    room.mx = {};
    room.sheets = {};
    room.best = null;
    drawerChanged(room);
    changed(room);
    pushSecrets(room);
    return null;
  });

  // ───────────── 그림 ─────────────

  /** 지금 차례의 그리는 사람만 */
  function asDrawerOfTurn(ctx: Ctx, id: string, turn: string) {
    const { room } = asDrawer(ctx, id);
    if (room.state.turnId !== turn || room.strokesTurn !== turn) throw forbidden();
    return room;
  }

  const addStrokeSchema = z.object({ id: roomId, turn: z.string().max(40), key: z.unknown().optional(), s: strokeSchema });
  gateway.rpc("sketch.addStroke", (ctx, raw) => {
    const { id, turn, key, s } = addStrokeSchema.parse(raw);
    const room = asDrawerOfTurn(ctx, id, turn);
    if (room.strokes.size >= MAX_STROKES) throw bad("그림이 너무 많아요.");
    const st = room.state;
    if (st.phase === "f-draw") {
      // 가짜 화가: 내 색으로 딱 한 획 (채우기 · 지우개 없음)
      const m = st.m as FakeState;
      if (s.t === "f") throw forbidden();
      if (room.mx.strokeG && room.mx.strokeG !== s.g) throw forbidden();
      room.mx.strokeG = s.g;
      s.c = m.colors[ctx.uid] ?? s.c;
    } else if (st.phase === "drawing") {
      if (st.challenge === "mono" && s.c.toUpperCase() !== MONO_COLOR.toUpperCase() && s.c.toLowerCase() !== "#ffffff") throw forbidden();
      if (st.challenge === "oneline" && s.t !== "f") {
        if (room.oneG && room.oneG !== s.g) throw forbidden();
        room.oneG = s.g;
      }
    } else throw forbidden();
    const k = isClientId(key) && !room.strokes.has(key) ? key : orderedId();
    room.strokes.set(k, s);
    gateway.emit(strokesKey(id, turn), "add", [k, s]);
    // 가짜 화가: 손을 떼면 다음 사람
    if (st.phase === "f-draw" && s.e) fakeNextStroke(room);
    return k;
  });

  gateway.rpc("sketch.removeStrokes", (ctx, raw) => {
    const { id, turn, keys } = z.object({ id: roomId, turn: z.string().max(40), keys: z.array(z.string().max(40)).max(5000) }).parse(raw);
    const room = asDrawerOfTurn(ctx, id, turn);
    if (room.state.phase !== "drawing") throw forbidden();
    const removed = keys.filter((k) => room.strokes.delete(k));
    if (removed.length) gateway.emit(strokesKey(id, turn), "remove", removed);
    // 한붓그리기: 그 획을 되돌렸으면 다시 그릴 수 있게
    if (room.oneG && ![...room.strokes.values()].some((x) => (x as Stroke).g === room.oneG)) room.oneG = "";
    return null;
  });

  gateway.rpc("sketch.clearStrokes", (ctx, raw) => {
    const { id, turn } = z.object({ id: roomId, turn: z.string().max(40) }).parse(raw);
    const room = asDrawerOfTurn(ctx, id, turn);
    if (room.state.phase !== "drawing") throw forbidden();
    clearStrokes(room);
    room.oneG = "";
    return null;
  });

  // ───────────── 채팅 · 정답 시도 ─────────────

  const chatSchema = z.object({ id: roomId, nick: z.string().max(10), text: z.string().min(1).max(100), cid: z.unknown().optional() });
  gateway.rpc("sketch.sendChat", (ctx, raw) => {
    const { id, nick, text, cid } = chatSchema.parse(raw);
    const { room, uid } = asPlayer(ctx, id);
    const st = room.state;
    const name = nameIn(room, uid, ctx.name(nick));
    // 그리는 중에 그린 사람 · 맞힌 사람이 치는 말은 정답을 아는 사람끼리만 (답이 새지 않게)
    if (st.phase === "drawing" && (st.drawer === uid || st.correct[uid] !== undefined)) {
      const msg: ChatMsg = { id: isClientId(cid) ? cid : orderedId(), uid, nick: name, text, kind: "secret", ts: Date.now() };
      const know = new Set([st.drawer, ...Object.keys(st.correct)]);
      const key = chatKey(id);
      for (const so of gateway.subscribers(key)) if (know.has(gateway.ctx(so).user?.uid ?? "")) gateway.emitTo(so, key, "add", msg);
      return null;
    }
    // 가짜 화가: 그리는 동안엔 채팅으로 제시어를 말하지 않게 (투표 · 결과 때만)
    if (st.phase === "f-draw") throw bad("한 획씩 그리는 동안엔 채팅을 쉬어요. 투표 때 이야기해요!");
    pushChat(room, { id: isClientId(cid) ? cid : undefined, uid, nick: name, text, kind: "msg" });
    return null;
  });

  /** 안내 메시지 (입장 알림 등 화면에서 직접 올리는 것) — 참가자만 */
  gateway.rpc("sketch.systemChat", (ctx, raw) => {
    const { id, text } = z.object({ id: roomId, text: z.string().min(1).max(100) }).parse(raw);
    const { room } = asPlayer(ctx, id);
    systemChat(room, text);
    return null;
  });

  /** 그리는 중 정답 시도 — 그리는 사람만 받아서 판정 */
  const guessSchema = z.object({ id: roomId, nick: z.string().max(10), text: z.string().min(1).max(100), turnId: z.string().max(40) });
  gateway.rpc("sketch.sendGuess", (ctx, raw) => {
    const { id, nick, text, turnId } = guessSchema.parse(raw);
    const { room, uid } = asPlayer(ctx, id);
    if (room.guesses.length >= MAX_GUESSES) room.guesses.shift();
    const g: Guess = { id: orderedId(), uid, nick: nameIn(room, uid, ctx.name(nick)), text, turnId, ts: Date.now() };
    room.guesses.push(g);
    gateway.emit(guessesKey(id), "add", g);
    return null;
  });

  gateway.rpc("sketch.removeGuess", (ctx, raw) => {
    const { id, guessId } = z.object({ id: roomId, guessId: z.string().max(40) }).parse(raw);
    const { room } = asDrawer(ctx, id);
    room.guesses = room.guesses.filter((g) => g.id !== guessId);
    return null;
  });

  /** 오답은 그리는 사람이 대신 채팅에 올려줌 */
  const relaySchema = z.object({ id: roomId, guess: z.object({ uid: z.string().max(128), nick: z.string().max(12), text: z.string().min(1).max(100) }), close: z.boolean().optional() });
  gateway.rpc("sketch.relayGuess", (ctx, raw) => {
    const { id, guess, close } = relaySchema.parse(raw);
    const { room } = asDrawer(ctx, id);
    const msgId = orderedId();
    pushChat(room, { id: msgId, uid: guess.uid, nick: nameIn(room, guess.uid, guess.nick), text: guess.text, kind: "msg" });
    // 거의 맞힌 답(그리는 사람 화면이 판정): 친 사람에게만 "거의 다 왔어요" — 다른 사람에겐 힌트가 되니까 안 보냄
    if (close) {
      const key = chatKey(id);
      const note: CloseNote = { id: orderedId(), uid: "", nick: "", text: `「${guess.text.slice(0, 20)}」 거의 다 왔어요! 조금만 바꿔 보세요`, kind: "close", of: msgId, ts: Date.now() };
      for (const s of gateway.subscribers(key)) if (gateway.ctx(s).user?.uid === guess.uid) gateway.emitTo(s, key, "add", note);
    }
    return null;
  });

  // ───────────── 따봉 · 건너뛰기 투표 (그림 맞히기) ─────────────

  /** 따봉 받은 그림의 주인 · 이름표 (없으면 누를 수 없음) */
  function likeTarget(room: Room, key: string): { author: string; label: string } | null {
    const st = room.state;
    const m = st.m;
    if (room.meta.mode === "classic") {
      if (key !== st.turnId || (st.phase !== "drawing" && st.phase !== "reveal")) return null;
      return { author: st.drawer, label: st.phase === "reveal" ? st.reveal : "" };
    }
    if (m?.kind === "lie" && key.startsWith("l:") && (st.phase === "l-write" || st.phase === "l-pick" || st.phase === "l-show")) {
      const author = key.slice(2);
      if (!m.order.slice(0, m.idx + 1).includes(author)) return null;
      return { author, label: st.phase === "l-show" ? (m.prompt ?? "") : "" };
    }
    if (m?.kind === "relay" && (st.phase === "r-album" || st.phase === "ended") && key.startsWith("r:")) {
      const [, c, k] = key.split(":").map(Number);
      const e = room.mx.chains?.[c]?.[k];
      if (!e?.sheet) return null;
      return { author: e.by, label: room.mx.chains?.[c]?.[k - 1]?.text ?? "" };
    }
    if (m?.kind === "fake" && st.phase === "f-result" && key === st.turnId) return { author: "", label: m.word ?? "" };
    return null;
  }

  gateway.rpc("sketch.like", (ctx, raw) => {
    const { id, key } = z.object({ id: roomId, key: z.string().min(1).max(40) }).parse(raw);
    const { room, uid } = asPlayer(ctx, id);
    const t = likeTarget(room, key);
    if (!t || t.author === uid) return null;
    const list = room.state.likes[key] ?? [];
    if (list.includes(uid)) return null;
    room.state = { ...room.state, likes: { ...room.state.likes, [key]: [...list, uid] } };
    const n = list.length + 1;
    if (t.author) users.bump(t.author, { "stats.sketch.likes": 1 });
    if (!room.best || n > room.best.n) room.best = { key, n, author: t.author, label: t.label };
    changed(room);
    return null;
  });

  /** 그림 맞히기: 건너뛰기 투표 — 그리는 사람 빼고 과반이면 건너뜀 (정답은 공개, 점수 없음) */
  gateway.rpc("sketch.voteSkip", (ctx, raw) => {
    const { id, turnId } = z.object({ id: roomId, turnId: z.string().max(40) }).parse(raw);
    const { room, uid } = asPlayer(ctx, id);
    const st = room.state;
    if (st.turnId !== turnId || st.phase !== "drawing" || st.drawer === uid || st.skip.includes(uid)) return null;
    const skip = [...st.skip, uid];
    const voters = Object.keys(room.players).filter((u) => u !== st.drawer);
    if (skip.length * 2 > voters.length) {
      const word = room.words?.turnId === turnId ? (room.words.word ?? "") : "";
      room.state = { ...st, skip, phase: "reveal", reveal: word, endsAt: Date.now() + REVEAL_MS };
      if (word) room.used[normalizeAnswer(word).replace(/[.#$[\]/]/g, "_")] = true;
      changed(room);
      systemChat(room, `투표로 건너뛰었어요.${word ? ` 정답은 「${word}」` : ""}`);
      return null;
    }
    room.state = { ...st, skip };
    changed(room);
    return null;
  });

  // ───────────── 다른 모드 ─────────────

  /** 방 참가자 중 이 모드 판에 끼어 있는 사람 (지금 방에 있는 사람만) */
  const inGame = (room: Room, order: string[]) => order.filter((u) => room.players[u]);
  const nickOf = (room: Room, uid: string) => plain(nameIn(room, uid, "?"));
  function addScore(room: Room, uid: string, n: number) {
    if (!n) return;
    const sc = room.scores[uid];
    room.scores[uid] = { nick: sc?.nick ?? nameIn(room, uid, "?"), score: (Number(sc?.score) || 0) + n };
    users.bump(uid, { "stats.sketch.points": n });
  }
  /** 단계 넘기기 공통: 새 단계 번호 · 끝나는 시각 */
  function setPhase(room: Room, phase: Phase, ms: number, patch: Partial<State> = {}) {
    room.state = { ...room.state, ...patch, phase, step: room.state.step + 1, endsAt: ms ? Date.now() + ms : 0 };
  }

  /** 나만 아는 것 */
  function secretOf(room: Room, uid: string): unknown {
    const st = room.state;
    const m = st.m;
    if (!m) return null;
    if (m.kind === "fake") {
      if (!m.order.includes(uid)) return { topic: m.topic, watching: true };
      const faker = room.mx.faker === uid;
      return { topic: m.topic, faker, word: faker ? null : (room.mx.word ?? null) };
    }
    if (m.kind === "lie") {
      return {
        prompt: room.mx.prompts?.[uid] ?? null,
        lie: room.mx.lies?.[uid] ?? null,
        pick: room.mx.picks?.[uid] ?? null,
        mine: Object.entries(room.mx.authors ?? {})
          .filter(([, a]) => a !== "truth" && a.includes(uid))
          .map(([oid]) => oid),
      };
    }
    if (m.kind === "relay") {
      const i = m.order.indexOf(uid);
      if (i < 0 || st.phase === "r-album" || st.phase === "ended") return null;
      const n = m.order.length;
      const c = (i - m.step + n * 8) % n;
      const prev = m.step > 0 ? (room.mx.chains?.[c]?.[m.step - 1] ?? null) : null;
      const mine = room.mx.chains?.[c]?.[m.step] ?? null;
      return {
        task: m.step === 0 ? "write" : m.step % 2 ? "draw" : "desc",
        chain: c,
        prev: prev ? { text: prev.text ?? null, sheet: prev.sheet ?? null } : null,
        done: !!mine,
      };
    }
    return null;
  }
  function pushSecrets(room: Room) {
    for (const uid of new Set([...Object.keys(room.players), ...Object.keys(room.scores)]))
      gateway.emit(secretKey(room.id, uid), "value", secretOf(room, uid));
  }

  /** 따로 그린 그림을 볼 수 있는지 */
  function canSeeSheet(room: Room, uid: string, key: string): boolean {
    const st = room.state;
    const m = st.m;
    if (m?.kind === "lie" && key.startsWith("l:")) {
      const who = key.slice(2);
      if (who === uid || st.phase === "ended") return true;
      return st.phase !== "l-draw" && m.order.slice(0, m.idx + 1).includes(who);
    }
    if (m?.kind === "relay" && key.startsWith("r:")) {
      if (albumOpen(room)) return true;
      const [, c, k] = key.split(":").map(Number);
      const e = room.mx.chains?.[c]?.[k];
      if (e?.by === uid) return true;
      // 다음 단계에서 이 그림을 이어받은 사람
      const n = m.order.length;
      return k === m.step - 1 && m.order[(c + m.step) % n] === uid;
    }
    return false;
  }
  const albumOpen = (room: Room) =>
    room.state.m?.kind === "relay" && (room.state.phase === "r-album" || room.state.phase === "ended");

  /** 판 끝 (모든 모드 공통) */
  function endGame(room: Room) {
    setPhase(room, "ended", 0);
    room.state = { ...room.state, drawer: "", m: room.state.m };
    recordGame(room);
    clearGuesses(room);
    setWords(room, null);
    changed(room);
    pushSecrets(room);
    const best = room.best;
    systemChat(room, "게임 끝! 최종 결과를 확인하세요.");
    if (best && best.n >= 2 && best.author)
      systemChat(room, `👍 베스트 그림: ${nickOf(room, best.author)}님${best.label ? `의 「${best.label}」` : ""} (따봉 ${best.n}개)`);
  }

  /** 모드 시작 */
  function startMode(room: Room, order: string[]) {
    const mode = room.meta.mode;
    room.strokes = new Map();
    room.strokesTurn = "";
    if (mode === "fake") startFake(room, order, 1);
    else if (mode === "lie") startLie(room, order);
    else if (mode === "relay") startRelay(room, order);
    systemChat(room, `${MODES[mode].emoji} ${MODES[mode].name} 시작!`);
  }

  // ── 가짜 화가 ──

  function startFake(room: Room, order: string[], game: number) {
    const players = order.filter((u) => room.players[u]);
    const { topic, word } = pickWord(new Set(Object.keys(room.used)), {
      topics: room.meta.topics,
      custom: room.meta.custom,
      customOnly: room.meta.customOnly,
    });
    // 그리는 순서는 판마다 무작위로 섞음
    const turnOrder = shuffle(players);
    const colors = Object.fromEntries(players.map((u, i) => [u, FAKE_COLORS[i % FAKE_COLORS.length]]));
    room.mx = { faker: players[Math.floor(Math.random() * players.length)], word, fakeVotes: {} };
    const turnId = orderedId();
    room.strokes = new Map();
    room.strokesTurn = turnId;
    const m: FakeState = { kind: "fake", game, games: room.meta.rounds, topic, order: turnOrder, at: 0, colors, voted: [] };
    setPhase(room, "f-draw", MODE_MS.fakeStroke, { turnId, turnNo: game, drawer: turnOrder[0], drawerNick: nameIn(room, turnOrder[0], ""), m, reveal: "" });
    drawerChanged(room);
    changed(room);
    pushSecrets(room);
  }
  function fakeNextStroke(room: Room) {
    const m = room.state.m as FakeState;
    room.mx.strokeG = undefined;
    // 지금 방에 있는 사람 차례로 (나간 사람은 건너뜀)
    let at = m.at + 1;
    const total = m.order.length * (room.meta.laps || FAKE_LAPS);
    while (at < total && !room.players[m.order[at % m.order.length]]) at++;
    if (at >= total || inGame(room, m.order).length < 2) {
      setPhase(room, "f-vote", MODE_MS.fakeVote, { drawer: "", drawerNick: "", m: { ...m, at } });
      changed(room);
      systemChat(room, "🗳️ 다 그렸어요! 가짜 화가는 누구일까요? 투표해 주세요");
      return;
    }
    const u = m.order[at % m.order.length];
    setPhase(room, "f-draw", MODE_MS.fakeStroke, { drawer: u, drawerNick: nameIn(room, u, ""), m: { ...m, at } });
    drawerChanged(room);
    changed(room);
  }
  function fakeTally(room: Room) {
    const m = room.state.m as FakeState;
    const votes = room.mx.fakeVotes ?? {};
    const count: Record<string, number> = {};
    for (const t of Object.values(votes)) count[t] = (count[t] ?? 0) + 1;
    const top = Math.max(0, ...Object.values(count));
    const tops = Object.keys(count).filter((u) => count[u] === top);
    const faker = room.mx.faker ?? "";
    const caught = top > 0 && tops.length === 1 && tops[0] === faker;
    if (!room.players[faker]) return fakeFinish(room, { caught, guessed: false, gone: true });
    if (caught) {
      setPhase(room, "f-guess", MODE_MS.fakeGuess, { m: { ...m, votes, caught: true } });
      changed(room);
      systemChat(room, `🎯 ${nickOf(room, faker)}님이 들켰어요! 마지막 기회 — 제시어를 맞히면 가짜 승리`);
      return;
    }
    fakeFinish(room, { caught: false, guessed: false });
  }
  function fakeFinish(room: Room, r: { caught: boolean; guessed: boolean; guess?: string; gone?: boolean }) {
    const m = room.state.m as FakeState;
    const faker = room.mx.faker ?? "";
    const word = room.mx.word ?? "";
    const votes = room.mx.fakeVotes ?? {};
    const fakeWins = !r.gone && (!r.caught || r.guessed);
    if (!r.gone) {
      if (fakeWins) {
        addScore(room, faker, MODE_POINTS.fakeWin);
        users.bump(faker, { "stats.sketch.fakeWin": 1 });
      } else for (const u of m.order) if (u !== faker && room.scores[u]) addScore(room, u, MODE_POINTS.artistWin);
      for (const [u, t] of Object.entries(votes))
        if (t === faker && u !== faker) {
          addScore(room, u, MODE_POINTS.fakeVoteRight);
          users.bump(u, { "stats.sketch.fakeFound": 1 });
        }
      room.scored = true;
    }
    room.used[normalizeAnswer(word).replace(/[.#$[\]/]/g, "_")] = true;
    setPhase(room, "f-result", MODE_MS.fakeResult, {
      reveal: word,
      m: { ...m, votes, faker, word, caught: r.caught, guess: r.guess, win: r.gone ? "gone" : fakeWins ? "fake" : "artists" },
    });
    changed(room);
    pushSecrets(room);
    systemChat(
      room,
      r.gone
        ? `가짜 화가가 나가 버렸어요… 제시어는 「${word}」`
        : fakeWins
          ? `🕵️ 가짜 화가 ${nickOf(room, faker)}님 승리! 제시어는 「${word}」`
          : `🎨 화가들 승리! 가짜는 ${nickOf(room, faker)}님, 제시어는 「${word}」`
    );
  }

  // ── 그림 속 거짓말 ──

  function startLie(room: Room, order: string[]) {
    const prompts = pickPrompts(order.length);
    room.mx = { prompts: Object.fromEntries(order.map((u, i) => [u, prompts[i]])) };
    room.sheets = {};
    const m: LieState = { kind: "lie", players: order, order, idx: -1, artist: "", done: [] };
    setPhase(room, "l-draw", Math.max(60, room.meta.drawTime) * 1000, { m, drawer: "", turnId: orderedId() });
    changed(room);
    pushSecrets(room);
  }
  function lieNext(room: Room) {
    const m = room.state.m as LieState;
    // 그림을 낸 사람만, 처음 넘어갈 때 순서를 섞음
    const order = m.idx < 0 ? shuffle(m.order.filter((u) => room.sheets[`l:${u}`]?.length)) : m.order;
    const idx = m.idx + 1;
    if (idx >= order.length) return endGame(room);
    const artist = order[idx];
    room.mx = { ...room.mx, lies: {}, picks: {}, authors: {} };
    setPhase(room, "l-write", MODE_MS.lieWrite, { m: { kind: "lie", players: m.players, order, idx, artist, done: [] }, turnId: orderedId() });
    changed(room);
    pushSecrets(room);
  }
  function liePick(room: Room) {
    const m = room.state.m as LieState;
    const truth = room.mx.prompts?.[m.artist] ?? "";
    const authors: Record<string, string[] | "truth"> = {};
    const byText = new Map<string, string>();
    const options: { id: string; text: string }[] = [];
    const add = (text: string, author: string | null) => {
      const k = normalizeAnswer(text);
      const have = byText.get(k);
      if (have) {
        const a = authors[have];
        if (author && a !== "truth") a.push(author);
        return;
      }
      const oid = `o${options.length}`;
      byText.set(k, oid);
      authors[oid] = author === null ? "truth" : author ? [author] : [];
      options.push({ id: oid, text });
    };
    add(truth, null);
    for (const [u, t] of Object.entries(room.mx.lies ?? {})) add(t, u);
    // 보기가 너무 적으면 서버가 만든 가짜를 섞음 (아무도 안 썼을 때)
    for (const t of pickPrompts(6)) if (options.length < 3) add(t, "");
    // 보기 id 를 섞어서 순서로 진짜를 알 수 없게
    const mixed = shuffle(options);
    const ids = new Map(mixed.map((o, i) => [o.id, `p${i}`]));
    room.mx.authors = Object.fromEntries(Object.entries(authors).map(([k, v]) => [ids.get(k)!, v]));
    room.mx.picks = {};
    setPhase(room, "l-pick", MODE_MS.liePick, { m: { ...m, done: [], options: mixed.map((o) => ({ id: ids.get(o.id)!, text: o.text })) } });
    changed(room);
    pushSecrets(room);
  }
  function lieShow(room: Room) {
    const m = room.state.m as LieState;
    const authors = room.mx.authors ?? {};
    const picks = room.mx.picks ?? {};
    const show = (m.options ?? []).map((o) => {
      const a = authors[o.id];
      const pickers = Object.keys(picks).filter((u) => picks[u] === o.id);
      return { id: o.id, text: o.text, truth: a === "truth", authors: a === "truth" ? [] : a, pickers };
    });
    for (const o of show)
      for (const u of o.pickers) {
        if (o.truth) {
          addScore(room, u, MODE_POINTS.lieTruth);
          addScore(room, m.artist, MODE_POINTS.lieArtistPer);
        } else
          for (const a of o.authors) {
            addScore(room, a, MODE_POINTS.lieFooledPer);
            users.bump(a, { "stats.sketch.fooled": 1 });
          }
      }
    room.scored = true;
    const prompt = room.mx.prompts?.[m.artist] ?? "";
    setPhase(room, "l-show", MODE_MS.lieShow, { m: { ...m, show, prompt } });
    changed(room);
    pushSecrets(room);
  }

  // ── 그림 릴레이 ──

  function startRelay(room: Room, order: string[]) {
    const n = order.length;
    const steps = Math.min(n, RELAY_MAX_STEPS);
    room.mx = { chains: Array.from({ length: n }, () => []) };
    room.sheets = {};
    const m: RelayState = { kind: "relay", order, steps, step: 0, done: [] };
    setPhase(room, "r-write", MODE_MS.relayWrite, { m, drawer: "", turnId: orderedId() });
    changed(room);
    pushSecrets(room);
  }
  function relayAdvance(room: Room) {
    const m = room.state.m as RelayState;
    const n = m.order.length;
    const chains = room.mx.chains ?? [];
    // 못 낸 칸 채우기
    m.order.forEach((u, i) => {
      const c = (i - m.step + n * 8) % n;
      if (chains[c][m.step]) return;
      if (m.step % 2) {
        const key = `r:${c}:${m.step}`;
        room.sheets[key] = [];
        chains[c][m.step] = { by: u, sheet: key };
      } else chains[c][m.step] = { by: u, text: "(시간 안에 못 썼어요 🙈)" };
    });
    const step = m.step + 1;
    if (step >= m.steps) {
      room.scored = true;
      for (const u of m.order) if (room.players[u]) users.bump(u, { "stats.sketch.relay": 1 });
      setPhase(room, "r-album", MODE_MS.relayPage, { m: { ...m, step, done: [], album: { chain: 0, page: 0 } } });
      changed(room);
      pushSecrets(room);
      systemChat(room, "📖 앨범을 같이 넘겨 봐요!");
      return;
    }
    const phase: Phase = step % 2 ? "r-draw" : "r-desc";
    setPhase(room, phase, step % 2 ? room.meta.drawTime * 1000 : MODE_MS.relayDesc, { m: { ...m, step, done: [] }, turnId: orderedId() });
    changed(room);
    pushSecrets(room);
  }
  function relayPage(room: Room) {
    const m = room.state.m as RelayState;
    const a = m.album ?? { chain: 0, page: 0 };
    let { chain, page } = a;
    page++;
    if (page >= m.steps) {
      chain++;
      page = 0;
    }
    if (chain >= m.order.length) return endGame(room);
    setPhase(room, "r-album", page >= m.steps - 1 ? MODE_MS.relayLast : MODE_MS.relayPage, { m: { ...m, album: { chain, page } } });
    changed(room);
  }

  /** 지금 단계에 낼 사람들이 다 냈으면 다음으로 */
  function maybeAdvance(room: Room) {
    const st = room.state;
    const m = st.m;
    if (!m) return;
    const present = (list: string[]) => list.filter((u) => room.players[u]);
    if (m.kind === "lie") {
      const need = st.phase === "l-draw" ? present(m.players) : present(m.players).filter((u) => u !== m.artist);
      if (!need.every((u) => m.done.includes(u))) return;
      if (st.phase === "l-draw") lieNext(room);
      else if (st.phase === "l-write") liePick(room);
      else if (st.phase === "l-pick") lieShow(room);
    } else if (m.kind === "relay") {
      if (st.phase === "r-album") return;
      if (present(m.order).every((u) => m.done.includes(u))) relayAdvance(room);
    } else if (m.kind === "fake" && st.phase === "f-vote") {
      if (present(m.order).every((u) => m.voted.includes(u))) fakeTally(room);
    }
  }

  /** 리더: 시간이 다 됐을 때 (또는 앨범 넘기기) */
  gateway.rpc("sketch.tick", (ctx, raw) => {
    const { id, step, force } = z.object({ id: roomId, step: z.number().int(), force: z.boolean().optional() }).parse(raw);
    const { room } = asLeader(ctx, id);
    const st = room.state;
    if (st.step !== step || !st.m) return null;
    // 앨범은 리더가 먼저 넘길 수 있음, 나머지는 시간이 지나야
    const early = force && st.phase === "r-album";
    if (!early && Date.now() < st.endsAt - 500) return null;
    switch (st.phase) {
      case "f-draw":
        fakeNextStroke(room);
        break;
      case "f-vote":
        fakeTally(room);
        break;
      case "f-guess":
        fakeFinish(room, { caught: true, guessed: false });
        break;
      case "f-result": {
        const m = st.m as FakeState;
        if (m.game >= m.games || inGame(room, m.order).length < MODES.fake.min) endGame(room);
        else startFake(room, Object.keys(room.scores).filter((u) => room.players[u]).sort((a, b) => (room.seen[a] ?? 0) - (room.seen[b] ?? 0)), m.game + 1);
        break;
      }
      case "l-draw":
        lieNext(room);
        break;
      case "l-write":
        liePick(room);
        break;
      case "l-pick":
        lieShow(room);
        break;
      case "l-show":
        lieNext(room);
        break;
      case "r-write":
      case "r-draw":
      case "r-desc":
        relayAdvance(room);
        break;
      case "r-album":
        relayPage(room);
        break;
    }
    return null;
  });

  const sheetSchema = z.array(strokeSchema).max(4000);
  /** 따로 그린 그림 내기 (거짓말 · 릴레이) */
  gateway.rpc("sketch.submitSheet", (ctx, raw) => {
    const { id, step, strokes } = z.object({ id: roomId, step: z.number().int(), strokes: sheetSchema }).parse(raw);
    const { room, uid } = asPlayer(ctx, id);
    const st = room.state;
    const m = st.m;
    if (st.step !== step || !m) return null;
    if (JSON.stringify(strokes).length > 600_000) throw bad("그림이 너무 커요.");
    if (st.phase === "l-draw" && m.kind === "lie") {
      if (!m.players.includes(uid) || m.done.includes(uid)) return null;
      room.sheets[`l:${uid}`] = strokes;
      room.state = { ...st, m: { ...m, done: [...m.done, uid] } };
    } else if (st.phase === "r-draw" && m.kind === "relay") {
      const i = m.order.indexOf(uid);
      if (i < 0 || m.done.includes(uid)) return null;
      const n = m.order.length;
      const c = (i - m.step + n * 8) % n;
      const key = `r:${c}:${m.step}`;
      room.sheets[key] = strokes;
      room.mx.chains![c][m.step] = { by: uid, sheet: key };
      room.state = { ...st, m: { ...m, done: [...m.done, uid] } };
    } else return null;
    changed(room);
    pushSecrets(room);
    maybeAdvance(room);
    return null;
  });

  /** 글 내기: 거짓말 가짜 제목 · 가짜 화가의 마지막 기회 · 릴레이 문장 */
  gateway.rpc("sketch.submitText", (ctx, raw) => {
    const { id, step, text: rawText } = z.object({ id: roomId, step: z.number().int(), text: z.string().min(1).max(80) }).parse(raw);
    const { room, uid } = asPlayer(ctx, id);
    const st = room.state;
    const m = st.m;
    const text = rawText.replace(/\s+/g, " ").trim();
    if (st.step !== step || !m || !text) return null;
    if (st.phase === "l-write" && m.kind === "lie") {
      if (uid === m.artist || !m.players.includes(uid) || m.done.includes(uid)) return null;
      const truth = room.mx.prompts?.[m.artist] ?? "";
      if (normalizeAnswer(text) === normalizeAnswer(truth))
        throw new AppError("TOO_CLOSE", "앗, 그게 진짜 제목이에요! 들키지 않게 다른 걸로 써 보세요 🤫", 409);
      room.mx.lies = { ...room.mx.lies, [uid]: text.slice(0, 30) };
      room.state = { ...st, m: { ...m, done: [...m.done, uid] } };
    } else if (st.phase === "f-guess" && m.kind === "fake") {
      if (uid !== room.mx.faker) return null;
      const ok = normalizeAnswer(text) === normalizeAnswer(room.mx.word ?? "");
      fakeFinish(room, { caught: true, guessed: ok, guess: text.slice(0, 20) });
      return null;
    } else if ((st.phase === "r-write" || st.phase === "r-desc") && m.kind === "relay") {
      const i = m.order.indexOf(uid);
      if (i < 0 || m.done.includes(uid)) return null;
      const n = m.order.length;
      const c = (i - m.step + n * 8) % n;
      room.mx.chains![c][m.step] = { by: uid, text: text.slice(0, 60) };
      room.state = { ...st, m: { ...m, done: [...m.done, uid] } };
    } else return null;
    changed(room);
    pushSecrets(room);
    maybeAdvance(room);
    return null;
  });

  /** 거짓말: 진짜라고 생각하는 제목 고르기 */
  gateway.rpc("sketch.pick", (ctx, raw) => {
    const { id, step, option } = z.object({ id: roomId, step: z.number().int(), option: z.string().max(8) }).parse(raw);
    const { room, uid } = asPlayer(ctx, id);
    const st = room.state;
    const m = st.m;
    if (st.step !== step || st.phase !== "l-pick" || m?.kind !== "lie") return null;
    if (uid === m.artist || !m.players.includes(uid) || m.done.includes(uid)) return null;
    const a = room.mx.authors?.[option];
    if (!a) return null;
    if (a !== "truth" && a.includes(uid)) throw bad("내가 쓴 건 고를 수 없어요.");
    room.mx.picks = { ...room.mx.picks, [uid]: option };
    room.state = { ...st, m: { ...m, done: [...m.done, uid] } };
    changed(room);
    pushSecrets(room);
    maybeAdvance(room);
    return null;
  });

  /** 가짜 화가: 투표 */
  gateway.rpc("sketch.vote", (ctx, raw) => {
    const { id, step, target } = z.object({ id: roomId, step: z.number().int(), target: z.string().max(128) }).parse(raw);
    const { room, uid } = asPlayer(ctx, id);
    const st = room.state;
    const m = st.m;
    if (st.step !== step || st.phase !== "f-vote" || m?.kind !== "fake") return null;
    if (!m.order.includes(uid) || !m.order.includes(target) || target === uid || m.voted.includes(uid)) return null;
    room.mx.fakeVotes = { ...room.mx.fakeVotes, [uid]: target };
    room.state = { ...st, m: { ...m, voted: [...m.voted, uid] } };
    changed(room);
    maybeAdvance(room);
    return null;
  });

  // ───────────── 오래 비어 있는 방 정리 ─────────────

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const room of [...rooms.values()])
      if (!Object.keys(room.players).length && now - room.emptySince >= emptyRoomTtl) removeRoom(room);
  }, opts.sweepIntervalMs ?? 30_000);
  sweep.unref();

  // ───────────── 배포 때 이어받기 (live.ts) ─────────────

  // 진행은 브라우저가 나눠 맡고 서버엔 타이머가 없어서, 그리던 중이어도 그대로 저장했다가 이어 감
  const live: LiveGame = {
    busy: () => false,
    drain() {},
    snapshot: () =>
      [...rooms.values()].map((r) => ({
        id: r.id,
        meta: r.meta,
        players: r.players,
        scores: r.scores,
        state: r.state,
        kicked: r.kicked,
        used: r.used,
        strokes: [...r.strokes.entries()],
        strokesTurn: r.strokesTurn,
        chat: r.chat,
        guesses: r.guesses,
        words: r.words,
        pw: r.pw,
        invite: r.invite,
        access: [...r.access],
        late: r.late,
        seen: r.seen,
        scored: r.scored,
        mx: r.mx,
        sheets: r.sheets,
        oneG: r.oneG,
        best: r.best,
        emptySince: r.emptySince,
      })),
    restore(data, downMs) {
      for (const r of data as (Omit<Room, "strokes" | "access" | "owners"> & { strokes: [string, unknown][]; access: string[] })[]) {
        // 차례 시간은 내려가 있던 만큼 미룸 (그 사이 아무도 그리거나 맞힐 수 없었으니)
        const st0: State = { ...emptyState(), ...r.state };
        const state = st0.endsAt ? { ...st0, endsAt: st0.endsAt + downMs } : st0;
        rooms.set(r.id, {
          ...r,
          state,
          strokes: new Map(r.strokes),
          access: new Set(r.access),
          owners: new Map(Object.keys(r.players).map((uid) => [uid, RESTORED])),
          // 예전 저장본에는 없던 것
          late: r.late ?? [],
          seen: r.seen ?? Object.fromEntries(Object.entries(r.players).map(([uid, p]) => [uid, p.joinedAt])),
          scored: r.scored ?? true,
          mx: r.mx ?? {},
          sheets: r.sheets ?? {},
          oneG: r.oneG ?? "",
          best: r.best ?? null,
          meta: Object.assign({ mode: "classic" as GameMode, challenge: true, topics: [], custom: [], customOnly: false, laps: FAKE_LAPS }, r.meta),
        });
      }
      // 시간 안에 안 돌아온 사람은 나간 것으로
      setTimeout(() => {
        for (const room of [...rooms.values()])
          for (const [uid, owner] of [...room.owners]) if (owner === RESTORED) removePlayer(room, uid);
      }, RESTORE_GRACE_MS).unref();
    },
  };

  return {
    live,
    close() {
      clearInterval(sweep);
    },
    /** (관리자) 지금 열려 있는 방 */
    adminList(): LiveRoom[] {
      return [...rooms.values()].map((r) => ({
        id: r.id,
        name: r.meta.name,
        status: r.state.phase,
        players: Object.values(r.players).map((p) => p.nick),
        createdAt: r.meta.createdAt,
      }));
    },
    /** (관리자) 방 닫기 — 안에 있던 사람들은 로비로 나가짐 */
    adminClose(id: string): boolean {
      const room = rooms.get(id);
      if (room) removeRoom(room);
      return !!room;
    },
  };
}
