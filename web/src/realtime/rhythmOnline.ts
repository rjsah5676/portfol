import { rpc, serverNow, subscribe } from "@/lib/api/socket";
import { API_URL } from "@/lib/api/config";
import type { Chart, Difficulty } from "@/lib/rhythm/chart";

/*
 * 리듬게임 온라인 — 백엔드(server/src/games/rhythmOnline.ts)와 통신
 *
 *  방 목록 · 방 상태 구독, 방 만들기·입장·나가기, 곡·난이도·준비·시작,
 *  플레이 중 진행(0.5초마다 점수 한 줄)과 끝난 결과 보내기,
 *  내 음악 파일(음원 + 채보)을 HTTP 로 올리고 받기.
 */

export type OnlinePhase = "lobby" | "loading" | "playing" | "result";

export interface OnlinePlayer {
  nick: string;
  joinedAt: number;
  ready: boolean;
  diff: Difficulty;
}

export interface OnlineSong {
  kind: "builtin" | "custom";
  id: string;
  title: string;
  duration: number;
  diffs: Difficulty[];
  ready: boolean;
  info?: { bpm: number; bpmLabel: number; beatOffset: number; color: string };
  bytes?: number;
  /** 내 음악: 난이도별 레벨 */
  levels?: Partial<Record<Difficulty, number>>;
}

export interface OnlineResult {
  nick: string;
  diff: Difficulty;
  score: number;
  acc: number;
  rank: string;
  maxCombo: number;
  failed: boolean;
  fc: boolean;
  ap: boolean;
  counts: { perfect: number; great: number; good: number; miss: number };
}

export interface OnlineRound {
  no: number;
  roster: string[];
  loaded: string[];
  startAt: number;
  results: Record<string, OnlineResult>;
}

export interface OnlineRoom {
  id: string;
  meta: { name: string; hostUid: string; max: number; createdAt: number };
  players: Record<string, OnlinePlayer>;
  phase: OnlinePhase;
  song: OnlineSong | null;
  round: OnlineRound | null;
}

export interface OnlineLobbyRoom {
  id: string;
  name: string;
  max: number;
  count: number;
  phase: OnlinePhase;
  song: string;
  createdAt: number;
}

export interface OnlineChatMsg {
  id: string;
  uid: string;
  nick: string;
  text: string;
  ts: number;
}

/**
 * 대기실 채팅 — 방 구독(watchRoom)으로 같이 받아서 여기 모아 둠.
 * 방 화면이 useSyncExternalStore 로 읽음 (방 상태와 따로 렌더되게)
 */
let chatRoom = "";
let chatMsgs: OnlineChatMsg[] = [];
const chatSubs = new Set<() => void>();
const EMPTY_CHAT: OnlineChatMsg[] = [];
const chatSet = (room: string, msgs: OnlineChatMsg[]) => {
  chatRoom = room;
  chatMsgs = msgs.slice(-50);
  chatSubs.forEach((f) => f());
};
export const roomChat = {
  subscribe(f: () => void) {
    chatSubs.add(f);
    return () => void chatSubs.delete(f);
  },
  get: () => chatMsgs,
  empty: (): OnlineChatMsg[] => EMPTY_CHAT,
};
export const sendChat = (id: string, text: string) => rpc("rhythm.chat", { id, text });

/** 플레이 중 한 사람의 진행: [점수, 콤보, 정확도, HP, 죽음 1/0, 끝 1/0, PERFECT, GREAT, GOOD, MISS 수] */
export type LiveRow = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export function watchLobby(cb: (rooms: OnlineLobbyRoom[]) => void): () => void {
  return subscribe<OnlineLobbyRoom[]>("rhythm.lobby", null, {
    onSnapshot: cb,
    onEvent: (t, d) => t === "list" && cb(d as OnlineLobbyRoom[]),
  });
}

/** 방 상태 + 플레이 중 점수판. 방이 없어지면 room=null */
export function watchRoom(
  id: string,
  h: { room(r: OnlineRoom | null): void; live(round: number, rows: Record<string, LiveRow>): void }
): () => void {
  if (chatRoom !== id) chatSet(id, []);
  return subscribe<
    (OnlineRoom & { live: Record<string, LiveRow> | null; chat?: OnlineChatMsg[] }) | null
  >(
    "rhythm.room",
    { id },
    {
      onSnapshot: (d) => {
        if (!d) return h.room(null);
        const { live, chat, ...room } = d;
        if (chat) chatSet(id, chat);
        h.room(room);
        if (live && room.round) h.live(room.round.no, live);
      },
      onEvent: (t, d) => {
        if (t === "room") h.room(d as OnlineRoom | null);
        else if (t === "chat") {
          const m = d as OnlineChatMsg;
          if (!chatMsgs.some((x) => x.id === m.id)) chatSet(id, [...chatMsgs, m]);
        } else if (t === "live") {
          const { round, rows } = d as { round: number; rows: Record<string, LiveRow> };
          h.live(round, rows);
        }
      },
      onError: () => h.room(null),
    }
  );
}

export const createRoom = (nick: string, name: string, max: number) =>
  rpc<string>("rhythm.create", { nick, name, max });
export const joinRoom = (id: string, nick: string, rejoin = false) =>
  rpc<{ joinedAt: number }>("rhythm.join", { id, nick, rejoin });
export const leaveRoom = (id: string) => rpc("rhythm.leave", { id });
export const setSong = (id: string, song: string, diff: Difficulty, title: string) =>
  rpc("rhythm.setSong", { id, song, diff, title });
export const setDiff = (id: string, diff: Difficulty) => rpc("rhythm.diff", { id, diff });
export const setReady = (id: string, ready: boolean) => rpc("rhythm.ready", { id, ready });
export const startGame = (id: string) => rpc("rhythm.start", { id });
export const markLoaded = (id: string, round: number) => rpc("rhythm.loaded", { id, round });
export const backToRoom = (id: string) => rpc("rhythm.back", { id });
/** 진행 보내기 — 응답을 기다리지 않음 (실패해도 다음 것이 덮음) */
export const sendProgress = (id: string, round: number, r: LiveRow) => {
  rpc("rhythm.prog", { id, round, r }).catch(() => {});
};
export const sendDone = (id: string, round: number, res: Omit<OnlineResult, "nick" | "diff">) =>
  rpc("rhythm.done", { id, round, ...res });
export { serverNow };

// ───────────── 내 음악 파일 ─────────────

const base = (id: string, ver: string, part: "audio" | "chart") =>
  `${API_URL.replace(/\/$/, "")}/api/rhythm-online/${encodeURIComponent(id)}/${ver}/${part}`;

/** 채보를 주고받는 모양: { 난이도: { level, units, notes: [[t, lane, end?]] } } */
export type WireCharts = Partial<
  Record<Difficulty, { level: number; units: number; notes: number[][] }>
>;

export function chartsToWire(charts: Partial<Record<Difficulty, Chart>>): WireCharts {
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const out: WireCharts = {};
  for (const [d, c] of Object.entries(charts) as [Difficulty, Chart][]) {
    if (!c) continue;
    out[d] = {
      level: c.level,
      units: c.units,
      notes: c.notes.map((n) => (n.end ? [r3(n.t), n.lane, r3(n.end)] : [r3(n.t), n.lane])),
    };
  }
  return out;
}
export function wireToCharts(w: WireCharts): Partial<Record<Difficulty, Chart>> {
  const out: Partial<Record<Difficulty, Chart>> = {};
  for (const [d, c] of Object.entries(w) as [Difficulty, NonNullable<WireCharts[Difficulty]>][]) {
    out[d] = {
      level: c.level,
      units: c.units,
      notes: c.notes.map(([t, lane, end]) => (end ? { t, lane, end } : { t, lane })),
    } as Chart;
  }
  return out;
}

/** 방장: 내 음악을 고르고 음원·채보를 올림. onProgress(0~1) — 음원 올리는 진행 */
export async function uploadCustom(
  id: string,
  meta: {
    title: string;
    diff: Difficulty;
    duration: number;
    info: { bpm: number; bpmLabel: number; beatOffset: number; color: string };
  },
  audio: Blob,
  charts: WireCharts,
  onProgress?: (r: number) => void,
  /** 서버가 정한 곡 버전 (올리기 전에 바로 알려 줌 — 방장은 그 곡을 내 파일로 침) */
  onVer?: (ver: string) => void
): Promise<void> {
  const { ver, key } = await rpc<{ ver: string; key: string }>("rhythm.setCustom", {
    id,
    ...meta,
    bytes: audio.size,
    audioType: audio.type || "application/octet-stream",
  });
  onVer?.(ver);
  const post = (part: "audio" | "chart", body: Blob) =>
    new Promise<void>((resolve, reject) => {
      // 진행률을 보려고 XHR (fetch 는 올리는 진행을 못 봄)
      const x = new XMLHttpRequest();
      x.open("POST", `${base(id, ver, part)}?k=${key}`);
      x.setRequestHeader("Content-Type", "application/octet-stream");
      if (part === "audio" && onProgress)
        x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      x.onload = () =>
        x.status < 300 ? resolve() : reject(new Error(`업로드 실패 (${x.status})`));
      x.onerror = () => reject(new Error("업로드 실패"));
      x.send(body);
    });
  await post("chart", new Blob([JSON.stringify(charts)]));
  await post("audio", audio);
  onProgress?.(1);
}

/** 참가자: 내 음악 음원·채보 받기 */
export async function downloadCustom(
  id: string,
  onProgress?: (r: number) => void
): Promise<{ audio: ArrayBuffer; charts: Partial<Record<Difficulty, Chart>> }> {
  const k = await rpc<{ ver: string; key: string } | null>("rhythm.fileKey", { id });
  if (!k) throw new Error("곡 파일이 아직 없어요.");
  const chartRes = await fetch(`${base(id, k.ver, "chart")}?k=${k.key}`);
  if (!chartRes.ok) throw new Error("채보를 받지 못했어요.");
  const charts = wireToCharts((await chartRes.json()) as WireCharts);
  const res = await fetch(`${base(id, k.ver, "audio")}?k=${k.key}`);
  if (!res.ok || !res.body) throw new Error("음원을 받지 못했어요.");
  const total = Number(res.headers.get("Content-Length")) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (total) onProgress?.(got / total);
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.length;
  }
  return { audio: buf.buffer, charts };
}

/**
 * 영상 파일(뮤비)을 넣은 내 음악: 영상 통째로는 너무 커서 소리만 WAV 로 (스테레오 24kHz 16bit — 4분에 약 23MB).
 * 디코딩해 둔 AudioBuffer 를 다시 샘플링해서 만듦 (실시간보다 훨씬 빠름)
 */
export async function audioToWav(buffer: AudioBuffer, rate = 24000): Promise<Blob> {
  // 서버 한도(60MB) 안으로: 긴 곡(약 9분 넘게)은 모노로
  const ch =
    buffer.duration * rate * 4 > 50 * 1024 * 1024 ? 1 : Math.min(2, buffer.numberOfChannels);
  const len = Math.ceil(buffer.duration * rate);
  const off = new OfflineAudioContext(ch, len, rate);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  data.setUint32(4, 36 + len * ch * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, rate, true);
  data.setUint32(28, rate * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  str(36, "data");
  data.setUint32(40, len * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, c) => out.getChannelData(c));
  let p = 44;
  for (let i = 0; i < len; i++)
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(p, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      p += 2;
    }
  return new Blob([data.buffer], { type: "audio/wav" });
}
