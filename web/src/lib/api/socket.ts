import { onIdTokenChanged } from "firebase/auth";
import { io, type Socket } from "socket.io-client";
import { auth } from "@/firebase";
import { API_URL } from "./config";
import { ApiError, toApiError, type WireError } from "./errors";

/*
 * 백엔드와의 실시간 연결 (socket.io) — 페이지 전체가 연결 하나를 같이 씀.
 *
 *   rpc(이름, 인자)                 요청 → 응답 (방 만들기, 수 두기 …)
 *   subscribe(채널, 인자, 핸들러)    구독: 첫 데이터(onSnapshot) + 이후 이벤트(onEvent). 끊겼다 붙으면 자동으로 다시 구독
 *   serverNow()                     서버 시계 기준 현재 시각
 *   onConnection(cb)                연결 상태 알림
 *   watchServerNotice(cb)           서버 공지 (배포로 곧 다시 시작 등) + 연결 상태 — 연결을 새로 만들지는 않음
 *
 * 로그인(Firebase Auth) 상태는 여기서 서버에 알려줌: 요청·구독은 항상 "지금 로그인한 사용자"로 인증이 끝난 뒤에 나감.
 */

type AckRes<T> = { ok: true; d: T } | { ok: false; e: WireError };

/** 서버 응답을 기다리는 최대 시간 */
const TIMEOUT_MS = 12_000;

let socket: Socket | null = null;
/** 지금 연결에서 서버가 알고 있는 내 uid */
let authedUid: string | null = null;
/** 그때 익명 계정이었는지 (익명 → Google 로그인으로 바뀌면 uid 는 같아도 서버에 다시 알려야 함) */
let authedAnon = false;
/** 연결이 바뀔 때마다 +1 (옛 연결의 응답을 구분) */
let connId = 0;
/** 요청 순서를 지키기 위한 줄 */
let chain: Promise<unknown> = Promise.resolve();
/** 연결 + 로그인 전달까지 끝난 상태 */
let online = false;
const connListeners = new Set<(connected: boolean) => void>();

/** 서버 공지: 배포로 곧 다시 시작함 (until = 늦어도 이때쯤 내려감) */
export type ServerNotice = { t: "restart"; until: number } | null;
let notice: ServerNotice = null;
const noticeListeners = new Set<() => void>();
const noticeChanged = () => noticeListeners.forEach((f) => f());

const network = () =>
  new ApiError("NETWORK", `서버에 연결할 수 없습니다. (${API_URL || "같은 주소"})`);

function setOnline(v: boolean) {
  if (online === v) return;
  online = v;
  connListeners.forEach((f) => f(v));
}

function sock(): Socket {
  if (socket) return socket;
  const opts = { transports: ["websocket", "polling"] };
  // API_URL 이 "" 이면 지금 사이트와 같은 주소로 연결
  const s = API_URL ? io(API_URL, opts) : io(opts);
  socket = s;

  s.on("connect", () => {
    authedUid = null;
    // 새로 붙은 서버(다시 켜진 서버)는 공지가 없음 — 아직 내려가는 중인 서버면 곧 다시 보내 줌
    if (notice) ((notice = null), noticeChanged());
    void syncTime();
    sync()
      .then(() => {
        resubscribe();
        setOnline(true);
      })
      .catch(() => {});
  });
  s.on("disconnect", () => {
    connId++;
    authedUid = null;
    byKey.clear();
    early.clear();
    entries.forEach((e) => (e.key = null));
    setOnline(false);
  });
  s.on("ev", (msg: { k: string; t: string; d: unknown }) => onEv(msg));
  s.on("srv", (n: ServerNotice) => {
    notice = n && n.t === "restart" ? n : null;
    noticeChanged();
  });

  // 로그인·로그아웃·토큰 갱신 → 서버에 다시 알림
  onIdTokenChanged(auth, () => {
    sync().catch(() => {});
  });
  // 오래 켜둔 탭의 시계 어긋남 보정
  setInterval(() => void syncTime(), 10 * 60_000);
  return s;
}

function waitConnect(s: Socket): Promise<void> {
  if (s.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(() => {
      s.off("connect", done);
      reject(network());
    }, TIMEOUT_MS);
    s.once("connect", done);
  });
}

async function emitAck<T>(event: string, ...args: unknown[]): Promise<AckRes<T>> {
  try {
    return (await sock()
      .timeout(TIMEOUT_MS)
      .emitWithAck(event, ...args)) as AckRes<T>;
  } catch {
    throw network();
  }
}

/** 연결돼 있고, 서버가 지금 로그인한 사용자를 알고 있는 상태로 맞춤 */
function sync(): Promise<void> {
  const run = async () => {
    const s = sock();
    await auth.authStateReady();
    // 다른 사용자로 바뀌었으면(로그아웃·관리자 로그인 등) 연결을 새로 맺음 — 이전 사용자의 구독·자리가 섞이지 않게
    if (authedUid !== null && (auth.currentUser?.uid ?? null) !== authedUid) {
      s.disconnect();
      s.connect();
    }
    await waitConnect(s);
    const user = auth.currentUser;
    if (user && (authedUid !== user.uid || authedAnon !== user.isAnonymous)) {
      const res = await emitAck<{ uid: string }>("auth", await user.getIdToken());
      if (!res.ok) throw toApiError(res.e);
      authedUid = user.uid;
      authedAnon = user.isAnonymous;
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

// ───────────── 요청 ─────────────

/** 서버에 요청하고 응답을 받음. 서버가 거절하면 ApiError(code, message) */
export async function rpc<T = null>(method: string, args?: unknown): Promise<T> {
  await sync();
  const res = await emitAck<T>("rpc", { m: method, a: args });
  if (!res.ok) throw toApiError(res.e);
  return res.d;
}

// ───────────── 구독 ─────────────

export interface SubHandlers<S = unknown> {
  /** 첫 데이터 (다시 연결되면 또 불림) */
  onSnapshot(data: S): void;
  /** 이후 이벤트 */
  onEvent?(type: string, data: unknown): void;
  /** 서버가 구독을 거절했거나 끊음 (권한 없음 등) — 이후로는 아무것도 오지 않음 */
  onError?(e: ApiError): void;
}

interface Entry {
  ch: string;
  params: unknown;
  h: SubHandlers<unknown>;
  /** 서버가 정해준 구독 키 (응답 전에는 null) */
  key: string | null;
  /** 어느 연결에서 구독을 걸었는지 */
  conn: number;
  closed: boolean;
}

const entries = new Set<Entry>();
const byKey = new Map<string, Set<Entry>>();
/** 구독 응답을 기다리는 동안 먼저 도착한 이벤트 (응답을 받은 뒤 이어서 전달) */
const early = new Map<string, { t: string; d: unknown }[]>();
let pendingSubs = 0;

function onEv({ k, t, d }: { k: string; t: string; d: unknown }) {
  if (pendingSubs > 0 && t !== "closed") {
    const q = early.get(k);
    if (q) q.push({ t, d });
    else early.set(k, [{ t, d }]);
  }
  const set = byKey.get(k);
  if (!set) return;
  for (const e of [...set]) {
    if (e.closed) continue;
    if (t === "closed") {
      set.delete(e);
      e.closed = true;
      entries.delete(e);
      e.h.onError?.(new ApiError("CLOSED", "구독이 종료되었습니다."));
    } else e.h.onEvent?.(t, d);
  }
}

async function open(e: Entry) {
  try {
    await sync();
  } catch {
    return; // 연결되면 resubscribe()가 다시 시도
  }
  if (e.closed) return;
  const conn = connId;
  e.conn = conn;
  e.key = null;
  pendingSubs++;
  let res: AckRes<{ k: string; d: unknown }>;
  try {
    res = await emitAck("sub", { ch: e.ch, p: e.params });
  } catch {
    // 응답이 없으면 이 연결에서는 포기하고 다음 연결 때 다시 구독
    if (e.conn === conn) e.conn = -1;
    return;
  } finally {
    pendingSubs--;
  }
  if (conn !== connId) return; // 그 사이 연결이 바뀜 → 새 연결에서 다시 구독됨
  if (!res.ok) {
    if (!e.closed) {
      e.closed = true;
      entries.delete(e);
      e.h.onError?.(toApiError(res.e));
    }
    if (!pendingSubs) early.clear();
    return;
  }
  const { k, d } = res.d;
  if (e.closed) {
    socket?.emit("unsub", { k });
  } else {
    e.key = k;
    let set = byKey.get(k);
    if (!set) byKey.set(k, (set = new Set()));
    set.add(e);
    e.h.onSnapshot(d);
    for (const ev of early.get(k) ?? []) if (!e.closed) e.h.onEvent?.(ev.t, ev.d);
  }
  if (!pendingSubs) early.clear();
}

function resubscribe() {
  for (const e of entries) if (!e.closed && e.conn !== connId) void open(e);
}

/**
 * 채널 구독. 돌려준 함수를 부르면 구독 해제.
 * 서버에 못 닿는 동안에는 오류 없이 기다렸다가, 연결되면 구독이 시작됨.
 */
export function subscribe<S = unknown>(
  channel: string,
  params: unknown,
  handlers: SubHandlers<S>
): () => void {
  const e: Entry = {
    ch: channel,
    params,
    h: handlers as SubHandlers<unknown>,
    key: null,
    conn: -1,
    closed: false,
  };
  entries.add(e);
  void open(e);
  return () => {
    if (e.closed) return;
    e.closed = true;
    entries.delete(e);
    if (e.key) {
      byKey.get(e.key)?.delete(e);
      if (socket?.connected && e.conn === connId) socket.emit("unsub", { k: e.key });
    }
  };
}

// ───────────── 연결 상태 · 서버 시각 ─────────────

/** 연결 상태 알림 (등록하자마자 현재 상태로 한 번 불림) */
export function onConnection(cb: (connected: boolean) => void): () => void {
  sock();
  connListeners.add(cb);
  cb(online);
  return () => connListeners.delete(cb);
}

/**
 * 서버 공지와 연결 상태를 지켜봄 (상단 안내 띠용). 실시간 연결을 쓰는 화면(게임)에서만 의미가 있어서
 * 연결을 새로 만들지 않음 — 아직 연결이 없으면 connected 는 null.
 */
export function watchServerNotice(cb: (s: { notice: ServerNotice; connected: boolean | null }) => void): () => void {
  const fire = () => cb({ notice, connected: socket ? online : null });
  noticeListeners.add(fire);
  connListeners.add(fire);
  fire();
  return () => {
    noticeListeners.delete(fire);
    connListeners.delete(fire);
  };
}

let timeOffset = 0;

/** 서버 시계와의 차이를 잼 (왕복 시간이 가장 짧았던 측정값 사용) */
async function syncTime() {
  const s = socket;
  if (!s) return;
  let best = Infinity;
  for (let i = 0; i < 3 && s.connected; i++) {
    try {
      const t0 = Date.now();
      const srv = (await s.timeout(5000).emitWithAck("time")) as number;
      const t1 = Date.now();
      const rtt = t1 - t0;
      if (typeof srv === "number" && rtt < best) {
        best = rtt;
        timeOffset = srv + rtt / 2 - t1;
      }
    } catch {
      return;
    }
  }
}

/** 서버 시계 기준 현재 시각 (ms). 내 컴퓨터 시계가 틀어져 있어도 대국 시계 등이 맞게 */
export const serverNow = () => Date.now() + timeOffset;

/** 외부에서 잰 서버 시각으로 보정 (기존 코드 호환용) */
export function setServerTime(serverMs: number) {
  timeOffset = serverMs - Date.now();
}

/** 서버 시계 보정을 시작 (연결을 미리 맺어 둠) */
export function watchServerTime() {
  sock();
}
