import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { Auth, AuthUser } from "../auth";
import type { Config } from "../config";
import { AppError, bad, forbidden, toWireError, unauthenticated } from "../errors";
import { displayName } from "../users";

/*
 * 실시간 게이트웨이 (socket.io)
 *
 * 클라이언트 → 서버
 *   auth  (token | null, ack)        로그인 상태가 바뀌면 다시 보냄
 *   rpc   ({ m, a }, ack)            요청-응답 (방 만들기, 수 두기 …)
 *   sub   ({ ch, p }, ack)           구독 시작 → ack로 구독 키와 첫 데이터
 *   unsub ({ k })                    구독 끝
 *   time  (ack)                      서버 시각 (시계 보정용)
 * 서버 → 클라이언트
 *   ev    ({ k, t, d })              구독 키 k에 대한 이벤트
 *   srv   ({ t, ... } | null)        서버 공지 — 지금은 배포로 곧 다시 시작한다는 알림 { t: "restart", until }
 *
 * 한 소켓의 요청은 도착한 순서대로 하나씩 처리함 (auth → sub → rpc 순서가 뒤바뀌지 않게).
 */

type MaybePromise<T> = T | Promise<T>;

export interface Ctx {
  socket: Socket;
  user: AuthUser | null;
  /** 로그인한 사용자의 uid (로그인 전이면 UNAUTHENTICATED 오류) */
  readonly uid: string;
  /** 회원의 별명 (비회원이면 null) */
  readonly nick: string | null;
  /** 화면에 보일 내 이름: 회원이면 별명, 아니면 입력한 이름에 비회원 표시를 붙인 것 */
  name(typed: string, max?: number): string;
  requireAdmin(): void;
}

export type RpcHandler = (ctx: Ctx, args: unknown) => unknown;

export interface Channel {
  /** 구독해도 되는지 확인하고 구독 키(방 이름)를 돌려줌. 안 되면 throw */
  key(ctx: Ctx, params: unknown): MaybePromise<string>;
  /** 키에 들어간 뒤 호출 — 첫 데이터 (이 사이에 온 이벤트를 놓치지 않게 순서를 이렇게 둠) */
  snapshot(ctx: Ctx, key: string, params: unknown): MaybePromise<unknown>;
  /** 이 소켓이 그 키 구독을 모두 끝냈을 때 */
  closed?(ctx: Ctx, key: string): void;
}

interface SocketData {
  user: AuthUser | null;
  nick: string | null;
  /** 구독 키 → { 채널 이름, 같은 키를 몇 번 구독했는지 } */
  subs: Map<string, { ch: string; n: number }>;
  chain: Promise<unknown>;
  /** 도배 방지: 최근 1초 요청 수 */
  rate: { at: number; n: number };
}

type Ack = (res: { ok: true; d: unknown } | { ok: false; e: { code: string; message: string; data?: unknown } }) => void;

const MAX_MSGS_PER_SEC = 400;

export class Gateway {
  readonly io: Server;
  private rpcs = new Map<string, RpcHandler>();
  private channels = new Map<string, Channel>();
  private disconnectHooks: ((ctx: Ctx) => MaybePromise<void>)[] = [];
  /** 지금 걸려 있는 서버 공지 (새로 붙는 연결에도 바로 보냄) */
  private notice: { t: string; [k: string]: unknown } | null = null;
  /**
   * 내려가기 직전: 상태를 저장한 뒤라 더는 아무것도 바꾸지 않음 — 요청은 거절하고,
   * 연결이 끊겨도 자리를 비우지 않음 (다시 켜진 서버가 저장한 방을 그대로 이어받음)
   */
  private frozen = false;
  /** 로그인한 사용자의 별명을 찾는 방법 (server.ts 에서 연결) */
  nickOf: (user: AuthUser) => Promise<string | null> = async () => null;
  /** 이용 정지된 uid 면 안내 문구 (rpc 를 막음 — 구독해서 보기는 됨) */
  blocked: (uid: string) => string | null = () => null;
  /** 관리자만 쓸 수 있는 요청 · 구독 이름 앞머리 ("marble" → "marble.*") */
  private adminPrefixes: string[] = [];

  constructor(http: HttpServer, cfg: Config, private auth: Auth) {
    this.io = new Server(http, {
      cors: { origin: cfg.corsOrigins === "*" ? true : cfg.corsOrigins },
      maxHttpBufferSize: 256 * 1024,
      // 끊긴 걸 빨리 알아채야 자리 정리가 늦지 않음 (기본 25s/20s → 최대 45초, 여기선 최대 25초)
      pingInterval: 15_000,
      pingTimeout: 10_000,
    });

    this.io.use(async (socket, next) => {
      const data = socket.data as SocketData;
      data.user = null;
      data.nick = null;
      data.subs = new Map();
      data.chain = Promise.resolve();
      data.rate = { at: 0, n: 0 };
      const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      if (typeof token === "string" && token) {
        // 토큰이 만료됐어도 연결 자체는 받음 (로그인 안 한 상태로) — 곧 auth로 다시 보냄
        data.user = await this.auth.verify(token).catch(() => null);
      }
      next();
    });

    this.io.on("connection", (socket) => this.bind(socket));
  }

  /** 요청-응답 핸들러 등록 */
  rpc(name: string, handler: RpcHandler) {
    if (this.rpcs.has(name)) throw new Error(`rpc 중복: ${name}`);
    this.rpcs.set(name, handler);
  }

  /** 구독 채널 등록 */
  channel(name: string, def: Channel) {
    if (this.channels.has(name)) throw new Error(`channel 중복: ${name}`);
    this.channels.set(name, def);
  }

  /** 이 이름들로 시작하는 rpc · 구독은 관리자만 (메뉴에서 내린 게임을 관리자만 해 볼 수 있게) */
  adminOnly(prefixes: string[]) {
    this.adminPrefixes.push(...prefixes.map((p) => `${p}.`));
  }

  private needsAdmin(name: string) {
    return this.adminPrefixes.some((p) => name.startsWith(p));
  }

  /** 소켓이 끊겼을 때 (자리 정리 등) */
  onDisconnect(fn: (ctx: Ctx) => MaybePromise<void>) {
    this.disconnectHooks.push(fn);
  }

  /** 구독 키를 듣고 있는 모두에게 */
  emit(key: string, type: string, data?: unknown) {
    this.io.to(key).emit("ev", { k: key, t: type, d: data });
  }

  /** 한 소켓에게만 (그 소켓이 키를 구독 중일 때만) */
  emitTo(socket: Socket, key: string, type: string, data?: unknown) {
    if ((socket.data as SocketData).subs.has(key)) socket.emit("ev", { k: key, t: type, d: data });
  }

  /** 이 키를 구독 중인 소켓들 */
  subscribers(key: string): Socket[] {
    const ids = this.io.sockets.adapter.rooms.get(key);
    if (!ids) return [];
    const out: Socket[] = [];
    for (const id of ids) {
      const s = this.io.sockets.sockets.get(id);
      if (s) out.push(s);
    }
    return out;
  }

  /** 권한이 없어진 구독을 서버 쪽에서 끊음 (클라이언트에는 "closed" 이벤트) */
  revoke(key: string, shouldRevoke: (ctx: Ctx) => boolean = () => true) {
    for (const socket of this.subscribers(key)) {
      const ctx = this.ctx(socket);
      if (!shouldRevoke(ctx)) continue;
      socket.emit("ev", { k: key, t: "closed" });
      this.drop(socket, key, true);
    }
  }

  /** 서버 공지를 모두에게 (null = 내림) */
  announce(notice: { t: string; [k: string]: unknown } | null) {
    this.notice = notice;
    this.io.emit("srv", notice);
  }

  /** 상태 저장 직전에 호출: 이후로는 요청을 받지 않고 끊김도 처리하지 않음 */
  freeze() {
    this.frozen = true;
  }

  /** 지금 붙어 있는 연결 수 (관리자 화면) */
  connections(): number {
    return this.io.sockets.sockets.size;
  }

  /** 별명이 생기거나 바뀜(null = 회원이 아니게 됨) → 그 사람의 접속 중인 연결에 반영 */
  setNick(uid: string, nick: string | null) {
    for (const socket of this.io.sockets.sockets.values()) {
      const data = socket.data as SocketData;
      if (data.user?.uid === uid) data.nick = nick;
    }
  }

  userOf(socket: Socket): AuthUser | null {
    return (socket.data as SocketData).user;
  }

  ctx(socket: Socket): Ctx {
    const data = socket.data as SocketData;
    return {
      socket,
      get user() {
        return data.user;
      },
      get uid() {
        if (!data.user) throw unauthenticated();
        return data.user.uid;
      },
      get nick() {
        return data.nick;
      },
      name(typed, max) {
        return displayName(data.nick, typed, max);
      },
      requireAdmin() {
        if (!data.user) throw unauthenticated();
        if (!data.user.admin) throw forbidden();
      },
    };
  }

  private drop(socket: Socket, key: string, all = false) {
    const data = socket.data as SocketData;
    const sub = data.subs.get(key);
    if (!sub) return;
    if (!all && --sub.n > 0) return;
    data.subs.delete(key);
    socket.leave(key);
    if (this.frozen) return;
    try {
      this.channels.get(sub.ch)?.closed?.(this.ctx(socket), key);
    } catch (e) {
      console.error("[gateway] closed 훅 오류", e);
    }
  }

  private bind(socket: Socket) {
    const data = socket.data as SocketData;
    const ctx = this.ctx(socket);

    /** 순서대로 하나씩 실행하고 결과를 ack로 */
    const serve = (ack: unknown, work: () => MaybePromise<unknown>) => {
      const reply: Ack = typeof ack === "function" ? (ack as Ack) : () => {};
      const now = Date.now();
      if (now - data.rate.at >= 1000) data.rate = { at: now, n: 0 };
      if (++data.rate.n > MAX_MSGS_PER_SEC) {
        socket.disconnect(true);
        return;
      }
      data.chain = data.chain
        .then(() => {
          if (this.frozen) throw new AppError("RESTARTING", "서버를 다시 시작하는 중이에요. 잠시 후 다시 시도해주세요.", 503);
          return work();
        })
        .then(
          (d) => reply({ ok: true, d: d ?? null }),
          (e) => {
            const w = toWireError(e);
            if (w.code === "INTERNAL") console.error("[gateway]", e);
            reply({ ok: false, e: { code: w.code, message: w.message, data: w.data } });
          }
        )
        // reply 자체가 던져도 다음 요청 처리는 이어지게
        .catch(() => {});
    };

    if (this.notice) socket.emit("srv", this.notice);

    socket.on("time", (ack: unknown) => {
      if (typeof ack === "function") (ack as (t: number) => void)(Date.now());
    });

    socket.on("auth", (token: unknown, ack: unknown) =>
      serve(ack, async () => {
        if (token === null || token === undefined || token === "") {
          if (data.user) throw new AppError("REAUTH", "다시 연결해야 합니다.", 409);
          return { uid: null };
        }
        if (typeof token !== "string") throw bad();
        let user: AuthUser;
        try {
          user = await this.auth.verify(token);
        } catch {
          throw unauthenticated();
        }
        // 다른 사람으로 바뀌는 건 새 연결로만 (이전 사용자의 구독·자리가 섞이지 않게)
        if (data.user && data.user.uid !== user.uid) throw new AppError("REAUTH", "다시 연결해야 합니다.", 409);
        data.user = user;
        data.nick = await this.nickOf(user).catch(() => null);
        return { uid: user.uid };
      })
    );

    socket.on("rpc", (msg: unknown, ack: unknown) =>
      serve(ack, () => {
        const { m, a } = (msg ?? {}) as { m?: unknown; a?: unknown };
        const handler = typeof m === "string" ? this.rpcs.get(m) : undefined;
        if (!handler) throw bad("알 수 없는 요청입니다.");
        if (this.needsAdmin(m as string)) ctx.requireAdmin();
        const why = data.user ? this.blocked(data.user.uid) : null;
        if (why) throw new AppError("BANNED", why, 403);
        return handler(ctx, a);
      })
    );

    socket.on("sub", (msg: unknown, ack: unknown) =>
      serve(ack, async () => {
        const { ch, p } = (msg ?? {}) as { ch?: unknown; p?: unknown };
        const def = typeof ch === "string" ? this.channels.get(ch) : undefined;
        if (!def || typeof ch !== "string") throw bad("알 수 없는 구독입니다.");
        if (this.needsAdmin(ch)) ctx.requireAdmin();
        const key = await def.key(ctx, p);
        const cur = data.subs.get(key);
        if (cur) cur.n++;
        else {
          data.subs.set(key, { ch, n: 1 });
          await socket.join(key);
        }
        try {
          return { k: key, d: await def.snapshot(ctx, key, p) };
        } catch (e) {
          this.drop(socket, key);
          throw e;
        }
      })
    );

    socket.on("unsub", (msg: unknown, ack: unknown) =>
      serve(ack, () => {
        const k = (msg as { k?: unknown } | null)?.k;
        if (typeof k === "string") this.drop(socket, k);
      })
    );

    socket.on("disconnect", () => {
      if (this.frozen) return;
      data.chain = data.chain
        .then(async () => {
          for (const key of [...data.subs.keys()]) this.drop(socket, key, true);
          for (const hook of this.disconnectHooks) {
            try {
              await hook(ctx);
            } catch (e) {
              console.error("[gateway] disconnect 훅 오류", e);
            }
          }
        })
        .catch(() => {});
    });
  }

  async close() {
    await this.io.close();
  }
}
