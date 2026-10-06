import { ApiError } from "@/lib/api/errors";
import {
  onConnection,
  rpc,
  serverNow as socketServerNow,
  subscribe,
  watchServerTime,
} from "@/lib/api/socket";

/*
 * 픽셀 격투 온라인 대전 — 백엔드 서버 (대기실·신호) + WebRTC (경기 입력)
 *
 * 서버(server/src/games/fight.ts)가 맡는 것
 *  - 로비 목록, 방 이름·방장
 *  - 자리 0|1 (빈자리만 차지 → 최대 2명), 선수별 닉네임·고른 캐릭터·준비 (끊기면 서버가 자동으로 뺌)
 *  - 방 상태: 대기(wait) / 경기(play: 매치 id·캐릭터·맵·입력 지연)
 *  - 대기실 채팅
 *  - WebRTC 연결 정보 교환 (offer/answer)
 *  - P2P가 안 될 때 입력 중계 (느리지만 됨)
 *  - 관전용 입력 기록 (각자 자기 확정 입력을 0.5초치씩), 관전 중인 사람 (끊기면 자동 삭제)
 *
 * 경기 중 입력은 P2P 데이터 채널(순서·재전송 없음, 아직 확인 안 된 입력을 매번 같이 보냄)로 주고받고,
 * 롤백 넷코드(lib/fight/rollback.ts)가 늦게 온 입력을 되감아서 맞춤.
 */

/** 서버 시계 보정 시작 (소켓 연결이 서버와 시각을 주고받아 맞춤) */
export function watchServerOffset() {
  watchServerTime();
}
export const serverNow = () => socketServerNow();

export interface LobbyRoom {
  id: string;
  name: string;
  host: string;
  count: number;
  playing: boolean;
  createdAt: number;
}

export interface OnlinePlayer {
  uid: string;
  nick: string;
  seat: 0 | 1;
  /** 고른 캐릭터 (-1 = 랜덤) */
  ch: number;
  ready: boolean;
  joinedAt: number;
}

export interface RoomState {
  phase: "wait" | "play";
  /** 매치마다 새 id — 다른 판의 입력이 섞이지 않게 */
  match: string;
  chars: [number, number];
  map: number;
  /** 방장이 고른 맵 (-1 = 랜덤) */
  pick: number;
  delay: number;
  maxRb: number;
}

export interface ChatMsg {
  id: string;
  uid: string;
  nick: string;
  text: string;
  ts: number;
}

export interface OnlineRoom {
  id: string;
  name: string;
  hostUid: string;
  seats: [string, string];
  players: Record<string, OnlinePlayer>;
  state: RoomState;
  /** 관전 중인 사람 uid → 닉네임 */
  watchers: Record<string, string>;
}

const EMPTY_STATE: RoomState = { phase: "wait", match: "", chars: [0, 1], map: 0, pick: -1, delay: 2, maxRb: 10 };

// ───────────── 로비 ─────────────

export function subscribeLobby(cb: (rooms: LobbyRoom[]) => void) {
  const apply = (list: LobbyRoom[]) =>
    cb([...(list ?? [])].sort((a, b) => a.count - b.count || b.createdAt - a.createdAt));
  return subscribe<LobbyRoom[]>("fight.lobby", null, {
    onSnapshot: apply,
    onEvent: (type, data) => {
      if (type === "list") apply(data as LobbyRoom[]);
    },
  });
}

/** 방 만들기 → 방 id (이름을 비우면 "닉네임의 방") */
export async function createRoom(_uid: string, nick: string, name: string): Promise<string> {
  return rpc<string>("fight.createRoom", { nick, name });
}

/** 아무도 없는 방 정리 — 선수가 있으면 서버가 지우지 않음 */
export async function cleanupEmptyRoom(roomId: string) {
  await rpc("fight.cleanupEmptyRoom", { id: roomId }).catch(() => {});
}

// ───────────── 입장·퇴장 ─────────────

export class RoomFullError extends Error {
  constructor() {
    super("room full");
  }
}

function normalize(id: string, v: Record<string, unknown> | null): OnlineRoom | null {
  if (!v || !v.meta) return null;
  const meta = v.meta as { name: string; hostUid: string };
  const seats = (v.seats ?? {}) as Record<string, string>;
  const players = (v.players ?? {}) as Record<string, Omit<OnlinePlayer, "uid">>;
  const watchers = (v.watchers ?? {}) as Record<string, { nick?: string }>;
  const st = { ...EMPTY_STATE, ...((v.state as Partial<RoomState>) ?? {}) };
  return {
    id,
    name: meta.name,
    hostUid: meta.hostUid,
    seats: [seats["0"] ?? "", seats["1"] ?? ""],
    players: Object.fromEntries(Object.entries(players).map(([uid, p]) => [uid, { uid, ...p }])),
    state: { ...st, chars: [st.chars?.[0] ?? 0, st.chars?.[1] ?? 1] },
    watchers: Object.fromEntries(Object.entries(watchers).map(([u, w]) => [u, String(w?.nick ?? "")])),
  };
}

/**
 * 방 하나에 들어가 있는 동안의 연결 (대기실 ↔ 경기 화면을 오가도 유지)
 */
export class RoomSession {
  readonly id: string;
  readonly uid: string;
  nick: string;
  seat: 0 | 1 = 0;
  room: OnlineRoom | null = null;
  chat: ChatMsg[] = [];
  net: FightNet | null = null;
  private unsubs: (() => void)[] = [];
  private listeners = new Set<() => void>();
  private ch = 0;
  private joinedAt = 0;
  closed = false;
  /** 방이 없어졌거나 자리를 잃음 */
  lost = "";

  constructor(id: string, uid: string, nick: string) {
    this.id = id;
    this.uid = uid;
    this.nick = nick;
  }

  on(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit() {
    this.listeners.forEach((f) => f());
  }

  get me() {
    return this.room?.players[this.uid] ?? null;
  }
  get foe(): OnlinePlayer | null {
    const u = this.room?.seats[1 - this.seat];
    return (u && this.room?.players[u]) || null;
  }
  get isHost() {
    return this.room?.hostUid === this.uid;
  }

  private joining: Promise<void> | null = null;
  /** 빈자리를 차지하고 입장 (꽉 찼으면 RoomFullError) — 여러 번 불러도 한 번만 */
  join(ch: number) {
    this.joining ??= this.doJoin(ch);
    return this.joining;
  }
  private async doJoin(ch: number) {
    this.ch = ch;
    if (!this.joinedAt) this.joinedAt = serverNow();
    // 자리 고르기는 서버가 한 번에 처리: 끊겼다 다시 온 경우 원래 자리, 아니면 빈자리(주인이 방에 없는 자리 포함)
    // 이 연결이 끊기면 서버가 자리·선수 항목을 자동으로 지움
    try {
      const res = await rpc<{ seat: 0 | 1 }>("fight.join", {
        id: this.id,
        nick: this.nick,
        ch: this.ch,
        joinedAt: this.joinedAt,
      });
      this.seat = res.seat;
    } catch (e) {
      if (e instanceof ApiError && e.code === "ROOM_FULL") throw new RoomFullError();
      if (e instanceof ApiError && e.code === "NO_ROOM") throw new Error("no room");
      console.error("[fight] 자리 잡기 실패", e);
      throw e;
    }
    type Wire = Record<string, unknown> | null;
    /** 화면에 이미 넣은 채팅 — 다시 연결돼 목록을 새로 받아도 두 번 넣지 않게 */
    const seenChat = new Set<string>();
    const addChat = (m: ChatMsg) => {
      if (seenChat.has(m.id)) return false;
      seenChat.add(m.id);
      this.chat = [...this.chat.slice(-39), m];
      return true;
    };
    this.unsubs.push(
      subscribe<Wire>(
        "fight.room",
        { id: this.id },
        {
          onSnapshot: (v) => this.onRoom(normalize(this.id, v)),
          onEvent: (type, data) => {
            if (type === "room") this.onRoom(normalize(this.id, data as Wire));
          },
          onError: () => this.onRoom(null),
        }
      ),
      subscribe<ChatMsg[]>(
        "fight.chat",
        { id: this.id },
        {
          onSnapshot: (list) => {
            let added = false;
            for (const m of list ?? []) added = addChat(m) || added;
            if (added) this.emit();
          },
          onEvent: (type, data) => {
            if (type === "add" && addChat(data as ChatMsg)) this.emit();
          },
        }
      ),
      // 잠깐 끊겼다 다시 연결되면 자리 복구
      onConnection((connected) => {
        if (connected && this.joinedAt && !this.closed && !this.me) this.takeSeat(this.seat).catch(() => {});
      })
    );
  }

  /** 정해진 자리에 (다시) 앉기 — 그 사이 다른 사람이 앉았으면 실패 */
  private async takeSeat(seat: 0 | 1) {
    if (!this.joinedAt) this.joinedAt = serverNow();
    await rpc("fight.takeSeat", {
      id: this.id,
      seat,
      nick: this.nick,
      ch: this.ch,
      joinedAt: this.joinedAt,
    });
    this.seat = seat;
  }

  private onRoom(room: OnlineRoom | null) {
    if (this.closed) return;
    this.room = room;
    if (!room) {
      this.lost = "방이 없어졌어요";
      this.emit();
      return;
    }
    // (방장이 나갔을 때 남은 사람이 이어받는 것과 로비 요약 갱신은 서버가 자리 변동 때 처리함)
    // 상대가 바뀌면 P2P 다시 연결
    const foe = room.seats[1 - this.seat];
    const pair = foe && room.players[foe] ? (this.seat === 0 ? `${this.uid}_${foe}` : `${foe}_${this.uid}`) : "";
    if (pair !== (this.net?.pair ?? "")) {
      this.net?.close();
      this.net = pair ? new FightNet(this.id, pair, this.seat, () => this.emit()) : null;
    }
    this.emit();
  }

  async setChar(ch: number) {
    this.ch = ch;
    await rpc("fight.setChar", { id: this.id, ch }).catch(() => {});
  }
  async setReady(ready: boolean) {
    await rpc("fight.setReady", { id: this.id, ready }).catch(() => {});
  }
  async setPick(pick: number) {
    await rpc("fight.setPick", { id: this.id, pick }).catch(() => {});
  }
  async sendChat(text: string) {
    const t = text.trim().slice(0, 100);
    if (!t) return;
    await rpc("fight.sendChat", { id: this.id, nick: this.nick, text: t }).catch(() => {});
  }

  /** 방장: 둘 다 준비되면 경기 시작 (랜덤 캐릭터·맵은 여기서 정함, 입력 지연은 연결 상태로) */
  async startMatch(nChars: number, nMaps: number) {
    const room = this.room;
    if (!room || !this.isHost) return;
    const ps = [room.players[room.seats[0]], room.players[room.seats[1]]];
    if (!ps[0] || !ps[1]) return;
    const rnd = (n: number) => Math.floor(Math.random() * n);
    const chars: [number, number] = [ps[0].ch < 0 ? rnd(nChars) : ps[0].ch, ps[1].ch < 0 ? rnd(nChars) : ps[1].ch];
    const map = room.state.pick < 0 ? rnd(nMaps) : room.state.pick;
    const p2p = this.net?.p2p ?? false;
    const rtt = this.net?.rtt ?? 150;
    // 왕복 시간의 절반만큼은 입력 지연으로 가리고, 나머지는 되감기로
    const delay = p2p ? Math.min(4, Math.max(2, Math.round(rtt / 2 / 16.7))) : 5;
    const maxRb = p2p ? 12 : 24;
    // 매치 id 발급과 지난 경기 관전 기록 정리는 서버가 함
    await rpc("fight.startMatch", { id: this.id, chars, map, delay, maxRb });
  }
  /** 경기가 끝나면 대기실 상태로 */
  async endMatch(match: string) {
    if (this.room?.state.match !== match || this.room.state.phase !== "play") return;
    await rpc("fight.endMatch", { id: this.id, match }).catch(() => {});
  }

  async leave() {
    if (this.closed) return;
    this.closed = true;
    this.unsubs.forEach((f) => f());
    this.unsubs = [];
    this.net?.close();
    this.net = null;
    // 자리를 비우고, 아무도 안 남았으면 서버가 방을 정리함
    await rpc("fight.leave", { id: this.id }).catch(() => {});
  }
}

// ───────────── P2P (WebRTC) + 중계 ─────────────

const ICE: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:stun.cloudflare.com:3478" },
];
/** P2P 연결을 이만큼 기다려도 안 되면 중계로 */
const P2P_TIMEOUT = 9000;

/** 주고받는 꾸러미 — k: hb(대기실 신호) / in(경기 입력) */
export interface Packet {
  k: "hb" | "in" | "bye";
  /** 보낸 시각 (ms), 상대가 받은 마지막 s를 e로 돌려줌 → 왕복 시간 */
  s?: number;
  e?: number;
  /** e를 받고 나서 보내기까지 기다린 시간 */
  eh?: number;
  /** 매치 id */
  m?: string;
  /** 입력 시작 프레임과 그 뒤 입력들 */
  f?: number;
  i?: number[];
  /** 상대 입력을 끊김 없이 받은 마지막 프레임 (그 뒤부터 보내 주면 됨) */
  a?: number;
  /** 지금 보낸 쪽 진행 프레임 (속도 맞추기) */
  fr?: number;
  /** 보낸 쪽 빌드 지문 (sim.ts BUILD_ID) — 다르면 같은 입력이어도 결과가 달라짐 */
  v?: number;
  /** 확정된 프레임 hf의 상태 해시 hh (서로 같아야 함) */
  hf?: number;
  hh?: number;
}

/** WebRTC 연결 정보 한 조각 (n = 제안 구분용 임시 값) */
interface SigPart {
  n: string;
  sdp: string;
}

export class FightNet {
  readonly pair: string;
  private readonly room: string;
  private readonly seat: 0 | 1;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private unsubs: (() => void)[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private nonce = "";
  private closed = false;
  private onChange: () => void;
  /** P2P 연결됨 */
  p2p = false;
  /** P2P 포기하고 중계 중 */
  relay = false;
  /** 왕복 시간 (ms, 평활) */
  rtt = 0;
  /** 마지막으로 상대 꾸러미를 받은 시각 */
  lastRecv = 0;
  onPacket: ((p: Packet) => void) | null = null;
  private lastS = 0;
  private lastSAt = 0;
  private relayPending: string | null = null;
  private relaySentAt = 0;

  constructor(room: string, pair: string, seat: 0 | 1, onChange: () => void) {
    this.room = room;
    this.pair = pair;
    this.seat = seat;
    this.onChange = onChange;
    if (typeof RTCPeerConnection === "undefined") {
      this.relay = true;
    } else {
      this.startP2P().catch(() => this.toRelay());
      this.timers.push(setTimeout(() => !this.p2p && this.toRelay(), P2P_TIMEOUT));
    }
    // 중계 채널은 처음부터 듣고 있음 (상대가 먼저 중계로 넘어갔을 수도)
    this.unsubs.push(
      subscribe<string | null>(
        "fight.relay",
        { id: room, seat: 1 - seat },
        {
          onSnapshot: (v) => {
            if (v) this.recv(v);
          },
          onEvent: (type, data) => {
            if (type === "value" && data) this.recv(data as string);
          },
        }
      )
    );
    // 대기실에서 0.5초마다 신호 (왕복 시간·연결 확인)
    const hb = setInterval(() => performance.now() - this.lastIn > 300 && this.send({ k: "hb" }), 500);
    this.unsubs.push(() => clearInterval(hb));
    // 중계: 너무 자주 쓰지 않게 50ms마다 마지막 꾸러미만
    const flush = setInterval(() => this.flushRelay(), 50);
    this.unsubs.push(() => clearInterval(flush));
  }

  get status(): "connecting" | "p2p" | "relay" {
    return this.p2p ? "p2p" : this.relay ? "relay" : "connecting";
  }
  /** 상대 신호가 최근에 왔나 */
  get alive() {
    return this.lastRecv > 0 && performance.now() - this.lastRecv < 4000;
  }

  /**
   * 연결 정보(offer 또는 answer) 중 한쪽이 바뀔 때마다 알림 (구독하자마자 현재 값으로 한 번).
   * 같은 값이 다시 와도(다시 연결됐을 때 등) 또 부르지 않음.
   */
  private watchSig(part: "offer" | "answer", cb: (v: SigPart | null) => void) {
    type SigValue = { offer?: SigPart; answer?: SigPart } | null;
    let last: string | undefined;
    const apply = (v: SigValue) => {
      const cur = v?.[part] ?? null;
      const key = JSON.stringify(cur);
      if (key === last) return;
      last = key;
      cb(cur);
    };
    return subscribe<SigValue>(
      "fight.sig",
      { id: this.room, pair: this.pair },
      {
        onSnapshot: apply,
        onEvent: (type, data) => {
          if (type === "value") apply(data as SigValue);
        },
      }
    );
  }

  private async waitIce(pc: RTCPeerConnection) {
    if (pc.iceGatheringState === "complete") return;
    await new Promise<void>((res) => {
      const t = setTimeout(res, 2500);
      pc.addEventListener("icegatheringstatechange", () => {
        if (pc.iceGatheringState === "complete") {
          clearTimeout(t);
          res();
        }
      });
    });
  }

  private newPc() {
    this.pc?.close();
    const pc = new RTCPeerConnection({ iceServers: ICE });
    this.pc = pc;
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed" && this.pc === pc) {
        this.p2p = false;
        this.toRelay();
      }
    });
    return pc;
  }

  private bindDc(dc: RTCDataChannel) {
    this.dc = dc;
    dc.addEventListener("open", () => {
      if (this.closed) return;
      this.p2p = true;
      this.relay = false;
      this.onChange();
    });
    dc.addEventListener("close", () => {
      if (this.dc !== dc || this.closed) return;
      this.p2p = false;
      this.toRelay();
    });
    dc.addEventListener("message", (e) => this.recv(String(e.data)));
  }

  private async startP2P() {
    if (this.seat === 0) {
      // 0번 자리가 연결을 제안
      const pc = this.newPc();
      this.bindDc(pc.createDataChannel("g", { ordered: false, maxRetransmits: 0 }));
      await pc.setLocalDescription(await pc.createOffer());
      await this.waitIce(pc);
      if (this.closed) return;
      this.nonce = Math.random().toString(36).slice(2, 10);
      await rpc("fight.sigOffer", {
        id: this.room,
        pair: this.pair,
        offer: { n: this.nonce, sdp: pc.localDescription!.sdp },
      });
      this.unsubs.push(
        this.watchSig("answer", (v) => {
          if (!v || v.n !== this.nonce || pc.remoteDescription) return;
          pc.setRemoteDescription({ type: "answer", sdp: v.sdp }).catch(() => this.toRelay());
        })
      );
    } else {
      this.unsubs.push(
        this.watchSig("offer", async (v) => {
          if (!v || v.n === this.nonce || this.closed) return;
          this.nonce = v.n;
          const pc = this.newPc();
          pc.addEventListener("datachannel", (e) => this.bindDc(e.channel));
          try {
            await pc.setRemoteDescription({ type: "offer", sdp: v.sdp });
            await pc.setLocalDescription(await pc.createAnswer());
            await this.waitIce(pc);
            if (this.closed || this.nonce !== v.n) return;
            await rpc("fight.sigAnswer", {
              id: this.room,
              pair: this.pair,
              answer: { n: v.n, sdp: pc.localDescription!.sdp },
            });
          } catch {
            this.toRelay();
          }
        })
      );
    }
  }

  private toRelay() {
    if (this.closed || this.p2p || this.relay) return;
    this.relay = true;
    this.onChange();
  }

  private recv(raw: string) {
    let p: Packet;
    try {
      p = JSON.parse(raw) as Packet;
    } catch {
      return;
    }
    const now = performance.now();
    this.lastRecv = now;
    if (p.s !== undefined) {
      this.lastS = p.s;
      this.lastSAt = now;
    }
    if (p.e !== undefined && p.e > 0) {
      const sample = Math.max(1, now - p.e - (p.eh ?? 0));
      if (sample < 5000) this.rtt = this.rtt ? this.rtt * 0.85 + sample * 0.15 : sample;
    }
    if (p.k === "hb") {
      if (!this.hbSeen) {
        this.hbSeen = true;
        this.onChange();
      }
    }
    this.onPacket?.(p);
  }
  private hbSeen = false;

  private lastIn = 0;
  send(p: Packet) {
    if (this.closed) return;
    const now = performance.now();
    if (p.k === "in") this.lastIn = now;
    p.s = Math.round(now);
    if (this.lastS) {
      p.e = this.lastS;
      p.eh = Math.round(now - this.lastSAt);
    }
    const raw = JSON.stringify(p);
    if (this.p2p && this.dc?.readyState === "open") {
      try {
        this.dc.send(raw);
        return;
      } catch {
        /* 아래 중계로 */
      }
    }
    if (this.relay || !this.p2p) this.relayPending = raw;
  }

  private flushRelay() {
    if (!this.relayPending || this.p2p) return;
    // P2P 연결 시도 중엔 1초에 2번만 (신호용), 중계로 넘어가면 1초에 20번
    const gap = this.relay ? 50 : 500;
    const now = performance.now();
    if (now - this.relaySentAt < gap) return;
    this.relaySentAt = now;
    const raw = this.relayPending;
    this.relayPending = null;
    rpc("fight.relay", { id: this.room, v: raw }).catch(() => {});
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.unsubs.forEach((f) => f());
    this.timers.forEach(clearTimeout);
    try {
      this.dc?.close();
      this.pc?.close();
    } catch {}
    this.onPacket = null;
  }
}

// ───────────── 관전 ─────────────

/** 관전 기록 한 묶음의 프레임 수 (0.5초) */
const LOG_CHUNK = 30;
const enc = (xs: number[]) => xs.map((x) => x.toString(36)).join(",");
const dec = (v: string) => (v ? v.split(",").map((x) => parseInt(x, 36) || 0) : []);

/** 선수: 내 확정 입력을 관전용으로 0.5초치씩 올림 (확정 입력은 바뀌지 않아서 관전자는 그대로 다시 돌리면 됨) */
export class InputLog {
  private buf: number[] = [];
  private from: number;
  private n = 0;
  constructor(
    private readonly room: string,
    private readonly match: string,
    private readonly seat: 0 | 1,
    start: number
  ) {
    this.from = start;
  }
  /** 프레임 순서대로 하나씩 */
  add(frame: number, input: number) {
    if (frame !== this.from + this.buf.length) return;
    this.buf.push(input);
    if (this.buf.length >= LOG_CHUNK) this.flush();
  }
  flush() {
    if (!this.buf.length) return;
    // 어느 자리 기록인지는 서버가 보낸 사람의 자리로 정함
    rpc("fight.watchChunk", {
      id: this.room,
      match: this.match,
      n: this.n,
      f: this.from,
      i: enc(this.buf),
    }).catch(() => {});
    this.n++;
    this.from += this.buf.length;
    this.buf = [];
  }
}

/** 관전자: 두 선수의 입력 기록을 받아 프레임마다 [1P, 2P] 입력을 내줌 */
export class WatchFeed {
  /** 앞쪽 지연 프레임(입력 지연) 동안은 빈 입력 */
  private readonly logs: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];
  /** 끊김 없이 받은 마지막 프레임 */
  private seq: [number, number];
  private unsubs: (() => void)[] = [];
  constructor(room: string, match: string, delay: number) {
    for (let f = 0; f < delay; f++) {
      this.logs[0].set(f, 0);
      this.logs[1].set(f, 0);
    }
    this.seq = [delay - 1, delay - 1];
    for (const seat of [0, 1] as const) {
      type Chunk = { f?: number; i?: string } | null;
      const add = (v: Chunk) => {
        if (!v || typeof v.f !== "number") return;
        const xs = dec(v.i ?? "");
        const m = this.logs[seat];
        xs.forEach((x, k) => m.set(v.f! + k, x));
        while (m.has(this.seq[seat] + 1)) this.seq[seat]++;
      };
      this.unsubs.push(
        // 구독하면 지금까지 쌓인 기록부터 받고, 이후 올라오는 조각이 이어서 옴
        subscribe<Chunk[]>(
          "fight.watch",
          { id: room, match, seat },
          {
            onSnapshot: (list) => (list ?? []).forEach(add),
            onEvent: (type, data) => {
              if (type === "add") add(data as Chunk);
            },
          }
        )
      );
    }
  }
  /** 두 선수 입력이 다 있는 마지막 프레임 */
  get ready() {
    return Math.min(this.seq[0], this.seq[1]);
  }
  input(f: number): [number, number] {
    return [this.logs[0].get(f) ?? 0, this.logs[1].get(f) ?? 0];
  }
  /** 다 쓴 프레임 정리 */
  drop(before: number) {
    for (const m of this.logs) for (const k of m.keys()) if (k < before) m.delete(k);
  }
  close() {
    this.unsubs.forEach((f) => f());
    this.unsubs = [];
  }
}

/** 관전자로 방 하나를 지켜봄 (자리는 안 차지함) */
export class WatchSession {
  readonly id: string;
  readonly uid: string;
  readonly nick: string;
  room: OnlineRoom | null = null;
  lost = "";
  closed = false;
  private unsubs: (() => void)[] = [];
  private listeners = new Set<() => void>();

  constructor(id: string, uid: string, nick: string) {
    this.id = id;
    this.uid = uid;
    this.nick = nick;
    // 관전 중 표시 — 이 연결이 끊기면 서버가 자동으로 지움
    rpc("fight.watchJoin", { id, nick: nick.slice(0, 10) }).catch(() => {});
    type Wire = Record<string, unknown> | null;
    const apply = (v: Wire) => {
      if (this.closed) return;
      this.room = normalize(id, v);
      if (!this.room || Object.keys(this.room.players).length === 0) this.lost = "방이 없어졌어요";
      this.emit();
    };
    this.unsubs.push(
      subscribe<Wire>(
        "fight.room",
        { id },
        {
          onSnapshot: apply,
          onEvent: (type, data) => {
            if (type === "room") apply(data as Wire);
          },
          onError: () => {
            this.lost = "방을 볼 수 없어요";
            this.emit();
          },
        }
      )
    );
  }
  on(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit() {
    this.listeners.forEach((f) => f());
  }
  /** 자리 순서대로 선수 [1P, 2P] */
  get players(): [OnlinePlayer | null, OnlinePlayer | null] {
    const rm = this.room;
    const p = (i: 0 | 1) => (rm?.seats[i] && rm.players[rm.seats[i]]) || null;
    return [p(0), p(1)];
  }
  leave() {
    if (this.closed) return;
    this.closed = true;
    this.unsubs.forEach((f) => f());
    this.unsubs = [];
    rpc("fight.watchLeave", { id: this.id }).catch(() => {});
  }
}
