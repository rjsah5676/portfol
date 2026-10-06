import {
  get,
  limitToLast,
  onChildAdded,
  onDisconnect,
  onValue,
  push,
  query,
  ref,
  remove,
  set,
  update,
} from "firebase/database";
import { rtdb } from "@/firebase";

/*
 * 픽셀 격투 온라인 대전 — Firebase Realtime Database (대기실·신호) + WebRTC (경기 입력)
 *
 *  fight/lobby/{room}              로비 목록 요약
 *  fight/rooms/{room}/meta         방 이름·방장
 *  fight/rooms/{room}/seats/{0|1}  자리 주인 uid (규칙에서 빈자리만 차지 → 최대 2명)
 *  fight/rooms/{room}/players/{uid} 닉네임·자리·고른 캐릭터·준비 (끊기면 onDisconnect로 자동 삭제)
 *  fight/rooms/{room}/state        대기(wait) / 경기(play: 매치 id·캐릭터·맵·입력 지연)
 *  fight/rooms/{room}/chat         대기실 채팅
 *  fight/sig/{room}/{pair}         WebRTC 연결 정보 교환 (offer/answer)
 *  fight/relay/{room}/{seat}       P2P가 안 될 때 입력 중계 (느리지만 됨)
 *  fight/watch/{room}/{match}/{seat}/{n}  관전용 입력 기록 (각자 자기 확정 입력을 0.5초치씩)
 *  fight/rooms/{room}/watchers/{uid}      관전 중인 사람 (끊기면 자동 삭제)
 *
 * 경기 중 입력은 P2P 데이터 채널(순서·재전송 없음, 아직 확인 안 된 입력을 매번 같이 보냄)로 주고받고,
 * 롤백 넷코드(lib/fight/rollback.ts)가 늦게 온 입력을 되감아서 맞춤.
 */

const r = (path: string) => ref(rtdb(), `fight/${path}`);

let serverOffset = 0;
let offsetOn = false;
export function watchServerOffset() {
  if (offsetOn) return;
  offsetOn = true;
  onValue(ref(rtdb(), ".info/serverTimeOffset"), (s) => {
    serverOffset = Number(s.val() ?? 0);
  });
}
export const serverNow = () => Date.now() + serverOffset;

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
  return onValue(r("lobby"), (s) => {
    const v = (s.val() ?? {}) as Record<string, Omit<LobbyRoom, "id">>;
    cb(
      Object.entries(v)
        .map(([id, x]) => ({ id, ...x }))
        .sort((a, b) => a.count - b.count || b.createdAt - a.createdAt)
    );
  });
}

export async function createRoom(uid: string, nick: string, name: string): Promise<string> {
  const id = push(r("lobby")).key!;
  const now = serverNow();
  const nm = name.trim().slice(0, 20) || `${nick}의 방`;
  await update(r(""), {
    [`rooms/${id}/meta`]: { name: nm, hostUid: uid, createdAt: now },
    [`rooms/${id}/state`]: EMPTY_STATE,
    [`lobby/${id}`]: { name: nm, host: nick, count: 0, playing: false, createdAt: now },
  });
  return id;
}

/** 아무도 없는 방 정리 */
export async function cleanupEmptyRoom(roomId: string) {
  const players = await get(r(`rooms/${roomId}/players`)).catch(() => null);
  if (!players || players.exists()) return;
  await update(r(""), {
    [`rooms/${roomId}`]: null,
    [`lobby/${roomId}`]: null,
    [`sig/${roomId}`]: null,
    [`relay/${roomId}`]: null,
    [`watch/${roomId}`]: null,
  }).catch(() => {});
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
    const snap = await get(r(`rooms/${this.id}`));
    const room = normalize(this.id, snap.val());
    if (!room) throw new Error("no room");
    // 끊겼다 다시 온 경우 원래 자리
    const order: (0 | 1)[] =
      room.seats[1] === this.uid ? [1, 0] : room.seats[0] === this.uid ? [0, 1] : room.seats[0] ? [1, 0] : [0, 1];
    let ok = false;
    let tried = false;
    let lastErr: unknown = null;
    for (const seat of order) {
      const owner = room.seats[seat];
      if (owner && owner !== this.uid && room.players[owner]) continue;
      tried = true;
      try {
        await this.takeSeat(seat, !!owner && owner !== this.uid);
        ok = true;
        break;
      } catch (e) {
        // 다른 사람이 먼저 앉았을 수도 → 다음 자리
        lastErr = e;
        console.error("[fight] 자리 잡기 실패", e);
      }
    }
    if (!ok) {
      if (!tried) throw new RoomFullError();
      throw lastErr ?? new Error("join failed");
    }
    this.unsubs.push(
      onValue(
        r(`rooms/${this.id}`),
        (s) => this.onRoom(normalize(this.id, s.val())),
        () => this.onRoom(null)
      ),
      onChildAdded(query(r(`rooms/${this.id}/chat`), limitToLast(40)), (s) => {
        const v = s.val() as Omit<ChatMsg, "id">;
        this.chat = [...this.chat.slice(-39), { id: s.key!, ...v }];
        this.emit();
      }),
      // 잠깐 끊겼다 다시 연결되면 자리 복구
      onValue(ref(rtdb(), ".info/connected"), (s) => {
        if (s.val() === true && this.joinedAt && !this.closed && !this.me) this.takeSeat(this.seat, false).catch(() => {});
      })
    );
  }

  private async takeSeat(seat: 0 | 1, clearStale: boolean) {
    if (clearStale) await remove(r(`rooms/${this.id}/seats/${seat}`));
    if (!this.joinedAt) this.joinedAt = serverNow();
    await update(r(`rooms/${this.id}`), {
      [`seats/${seat}`]: this.uid,
      [`players/${this.uid}`]: { nick: this.nick, seat, ch: this.ch, ready: false, joinedAt: this.joinedAt },
    });
    this.seat = seat;
    // 끊기면 자리·플레이어 자동 삭제 — 자리를 차지한 뒤에 예약해야 규칙(내 자리만 지울 수 있음)을 통과함
    await onDisconnect(r(`rooms/${this.id}`)).update({ [`seats/${seat}`]: null, [`players/${this.uid}`]: null });
  }

  private onRoom(room: OnlineRoom | null) {
    if (this.closed) return;
    const prev = this.room;
    this.room = room;
    if (!room) {
      this.lost = "방이 없어졌어요";
      this.emit();
      return;
    }
    // 방장이 나갔으면 남은 사람이 이어받음
    if (!room.players[room.hostUid] && room.players[this.uid]) {
      set(r(`rooms/${this.id}/meta/hostUid`), this.uid).catch(() => {});
    }
    // 로비 요약 갱신 (인원·경기 중)
    const count = Object.keys(room.players).length;
    const playing = room.state.phase === "play";
    if (room.players[this.uid] && (!prev || Object.keys(prev.players).length !== count || (prev.state.phase === "play") !== playing)) {
      update(r(`lobby/${this.id}`), { count, playing, name: room.name }).catch(() => {});
    }
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
    await update(r(`rooms/${this.id}/players/${this.uid}`), { ch }).catch(() => {});
  }
  async setReady(ready: boolean) {
    await update(r(`rooms/${this.id}/players/${this.uid}`), { ready }).catch(() => {});
  }
  async setPick(pick: number) {
    await update(r(`rooms/${this.id}/state`), { pick }).catch(() => {});
  }
  async sendChat(text: string) {
    const t = text.trim().slice(0, 100);
    if (!t) return;
    await push(r(`rooms/${this.id}/chat`), { uid: this.uid, nick: this.nick, text: t, ts: serverNow() }).catch(() => {});
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
    const match = push(r(`rooms/${this.id}/chat`)).key!; // 고유 id만 씀
    // 지난 경기 관전 기록 정리
    await remove(r(`watch/${this.id}`)).catch(() => {});
    await update(r(`rooms/${this.id}/state`), { phase: "play", match, chars, map, delay, maxRb });
  }
  /** 경기가 끝나면 대기실 상태로 */
  async endMatch(match: string) {
    if (this.room?.state.match !== match || this.room.state.phase !== "play") return;
    await update(r(`rooms/${this.id}/state`), { phase: "wait" }).catch(() => {});
  }

  async leave() {
    if (this.closed) return;
    this.closed = true;
    this.unsubs.forEach((f) => f());
    this.unsubs = [];
    this.net?.close();
    this.net = null;
    try {
      await onDisconnect(r(`rooms/${this.id}`)).cancel();
      await update(r(`rooms/${this.id}`), { [`seats/${this.seat}`]: null, [`players/${this.uid}`]: null });
    } catch {}
    await cleanupEmptyRoom(this.id);
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
      onValue(r(`relay/${room}/${1 - seat}`), (s) => {
        const v = s.val() as string | null;
        if (v) this.recv(v);
      })
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

  private sig(path?: string) {
    return r(`sig/${this.room}/${this.pair}${path ? `/${path}` : ""}`);
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
      await set(this.sig(), { offer: { n: this.nonce, sdp: pc.localDescription!.sdp } });
      this.unsubs.push(
        onValue(this.sig("answer"), (s) => {
          const v = s.val() as { n: string; sdp: string } | null;
          if (!v || v.n !== this.nonce || pc.remoteDescription) return;
          pc.setRemoteDescription({ type: "answer", sdp: v.sdp }).catch(() => this.toRelay());
        })
      );
    } else {
      this.unsubs.push(
        onValue(this.sig("offer"), async (s) => {
          const v = s.val() as { n: string; sdp: string } | null;
          if (!v || v.n === this.nonce || this.closed) return;
          this.nonce = v.n;
          const pc = this.newPc();
          pc.addEventListener("datachannel", (e) => this.bindDc(e.channel));
          try {
            await pc.setRemoteDescription({ type: "offer", sdp: v.sdp });
            await pc.setLocalDescription(await pc.createAnswer());
            await this.waitIce(pc);
            if (this.closed || this.nonce !== v.n) return;
            await set(this.sig("answer"), { n: v.n, sdp: pc.localDescription!.sdp });
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
    set(r(`relay/${this.room}/${this.seat}`), raw).catch(() => {});
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
    const v = { f: this.from, i: enc(this.buf) };
    set(r(`watch/${this.room}/${this.match}/${this.seat}/${this.n}`), v).catch(() => {});
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
      this.unsubs.push(
        onChildAdded(r(`watch/${room}/${match}/${seat}`), (s) => {
          const v = s.val() as { f?: number; i?: string } | null;
          if (!v || typeof v.f !== "number") return;
          const xs = dec(v.i ?? "");
          const m = this.logs[seat];
          xs.forEach((x, k) => m.set(v.f! + k, x));
          while (m.has(this.seq[seat] + 1)) this.seq[seat]++;
        })
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
    const me = r(`rooms/${id}/watchers/${uid}`);
    set(me, { nick: nick.slice(0, 10), at: serverNow() })
      .then(() => onDisconnect(me).remove())
      .catch(() => {});
    this.unsubs.push(
      onValue(
        r(`rooms/${id}`),
        (s) => {
          if (this.closed) return;
          this.room = normalize(id, s.val());
          if (!this.room || Object.keys(this.room.players).length === 0) this.lost = "방이 없어졌어요";
          this.emit();
        },
        () => {
          this.lost = "방을 볼 수 없어요";
          this.emit();
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
    const me = r(`rooms/${this.id}/watchers/${this.uid}`);
    onDisconnect(me).cancel().catch(() => {});
    remove(me).catch(() => {});
  }
}
