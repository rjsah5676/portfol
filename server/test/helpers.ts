import { randomBytes } from "node:crypto";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { io, type Socket } from "socket.io-client";
import { inject } from "vitest";
import { createAuth } from "../src/auth";
import { loadConfig } from "../src/config";
import { connectDatabase, type Database } from "../src/db";
import type { PokerOptions } from "../src/games/poker";
import { createAppServer } from "../src/server";

/*
 * 테스트 도우미: 서버를 빈 포트·빈 DB로 띄우고, 가짜 Firebase 토큰(테스트용 키로 서명)으로 접속하는 클라이언트를 만듦.
 * 서버의 토큰 검증 코드는 실제와 같고 공개키만 테스트용으로 바꿔 끼움.
 */

const PROJECT = "test-project";
export const ADMIN_EMAIL = "admin@example.com";

type Ack<T> = { ok: true; d: T } | { ok: false; e: { code: string; message: string; data?: unknown } };

export class RpcError extends Error {
  constructor(
    public code: string,
    message: string,
    public data?: unknown
  ) {
    super(message);
  }
}

export interface TestSub<S = any> {
  key: string;
  /** 구독 응답으로 받은 첫 데이터 */
  data: S;
  /** 이후 받은 이벤트 (받은 순서) */
  events: { t: string; d: any }[];
  /** 조건에 맞는 이벤트가 올 때까지 기다림 (이미 와 있으면 바로) */
  wait(pred?: (ev: { t: string; d: any }) => boolean, timeoutMs?: number): Promise<{ t: string; d: any }>;
  close(): void;
}

export interface TestClient {
  socket: Socket;
  uid: string | null;
  rpc<T = any>(method: string, args?: unknown): Promise<T>;
  sub<S = any>(channel: string, params?: unknown): Promise<TestSub<S>>;
  close(): void;
}

export interface TestServer {
  url: string;
  db: Database;
  /** 가짜 Firebase ID 토큰 */
  token(uid: string, claims?: { email?: string; anonymous?: boolean }): Promise<string>;
  adminToken(): Promise<string>;
  /** uid로 로그인한 소켓 클라이언트 (uid 없으면 비로그인) */
  client(uid?: string, claims?: { email?: string }): Promise<TestClient>;
  /** REST 호출 */
  http(path: string, init?: { method?: string; body?: unknown; token?: string }): Promise<{ status: number; body: any }>;
  close(): Promise<void>;
}

export async function startTestServer(over: { poker?: PokerOptions } = {}): Promise<TestServer> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test", alg: "RS256", use: "sig" };
  const cfg = loadConfig({
    NODE_ENV: "test",
    PORT: "0",
    MONGODB_URI: inject("mongoUri"),
    MONGODB_DB: `test_${randomBytes(6).toString("hex")}`,
    FIREBASE_PROJECT_ID: PROJECT,
    ADMIN_EMAILS: ADMIN_EMAIL,
  });
  const db = await connectDatabase(cfg);
  const server = await createAppServer(cfg, {
    db,
    auth: createAuth(cfg, createLocalJWKSet({ keys: [jwk] })),
    // 포커: 카드 까는 뜸 · 봇 생각 시간을 거의 없앰 (사람의 제한 시간은 넉넉히)
    poker: { speed: 0.004, actMs: 4000, choiceMs: 4000, sweepIntervalMs: 150, ...over.poker },
  });
  const port = await server.listen();
  const url = `http://127.0.0.1:${port}`;
  const clients = new Set<TestClient>();

  const token: TestServer["token"] = (uid, claims = {}) =>
    new SignJWT({
      ...(claims.email ? { email: claims.email } : {}),
      firebase: { sign_in_provider: claims.email ? "password" : "anonymous" },
    })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(`https://securetoken.google.com/${PROJECT}`)
      .setAudience(PROJECT)
      .setSubject(uid)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

  async function client(uid?: string, claims?: { email?: string }): Promise<TestClient> {
    const socket = io(url, { transports: ["websocket"], forceNew: true });
    await new Promise<void>((res, rej) => {
      socket.once("connect", () => res());
      socket.once("connect_error", rej);
    });
    const subs = new Map<string, TestSub[]>();
    socket.on("ev", ({ k, t, d }: { k: string; t: string; d: any }) => {
      for (const s of subs.get(k) ?? []) {
        s.events.push({ t, d });
        (s as any)._wake();
      }
    });
    const ack = async <T>(event: string, ...args: unknown[]): Promise<T> => {
      const res = (await socket.timeout(8000).emitWithAck(event, ...args)) as Ack<T>;
      if (!res.ok) throw new RpcError(res.e.code, res.e.message, res.e.data);
      return res.d;
    };
    if (uid) await ack("auth", await token(uid, claims));
    const c: TestClient = {
      socket,
      uid: uid ?? null,
      rpc: (m, a) => ack("rpc", { m, a }),
      async sub(ch, p) {
        // 응답 전에 도착한 이벤트도 놓치지 않게 먼저 받아 둠
        const early: { k: string; t: string; d: any }[] = [];
        const catchEarly = (m: { k: string; t: string; d: any }) => early.push(m);
        socket.on("ev", catchEarly);
        let res: { k: string; d: any };
        try {
          res = await ack<{ k: string; d: any }>("sub", { ch, p });
        } finally {
          socket.off("ev", catchEarly);
        }
        let seen = 0;
        const waiters = new Set<() => void>();
        const sub: TestSub = {
          key: res.k,
          data: res.d,
          events: early.filter((m) => m.k === res.k).map(({ t, d }) => ({ t, d })),
          wait(pred = () => true, timeoutMs = 5000) {
            return new Promise((resolve, reject) => {
              const check = () => {
                while (seen < sub.events.length) {
                  const ev = sub.events[seen++];
                  if (pred(ev)) {
                    clearTimeout(timer);
                    waiters.delete(check);
                    resolve(ev);
                    return;
                  }
                }
              };
              const timer = setTimeout(() => {
                waiters.delete(check);
                reject(new Error(`이벤트를 기다리다 시간 초과 (${ch})`));
              }, timeoutMs);
              waiters.add(check);
              check();
            });
          },
          close() {
            const list = subs.get(res.k) ?? [];
            subs.set(
              res.k,
              list.filter((s) => s !== sub)
            );
            socket.emit("unsub", { k: res.k });
          },
        };
        (sub as any)._wake = () => waiters.forEach((w) => w());
        subs.set(res.k, [...(subs.get(res.k) ?? []), sub]);
        return sub;
      },
      close() {
        clients.delete(c);
        socket.disconnect();
      },
    };
    clients.add(c);
    return c;
  }

  return {
    url,
    db,
    token,
    adminToken: () => token("admin-uid", { email: ADMIN_EMAIL }),
    client,
    async http(path, { method = "GET", body, token: tk } = {}) {
      const res = await fetch(url + path, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(tk ? { authorization: `Bearer ${tk}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    async close() {
      for (const c of [...clients]) c.close();
      await server.close();
      await db.db.dropDatabase().catch(() => {});
      await db.close();
    },
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
