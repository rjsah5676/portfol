/*
 * 화면 확인용 개발 서버: 진짜 Firebase 없이, 이 서버가 직접 서명한 가짜 토큰으로 로그인.
 *   MONGODB_URI=mongodb://127.0.0.1:27027/ npx tsx scripts/dev-fake.ts
 * GET /__dev/token?uid=a&nick=철수  → 그 uid 의 토큰 (별명도 같이 만들어 줌). web 쪽은 POKER_E2E=1 로 띄우면 이걸 씀.
 * 운영에서는 절대 쓰지 않음 (서명키가 메모리에 새로 생김).
 */
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { createAuth } from "../src/auth";
import { loadConfig } from "../src/config";
import { connectDatabase } from "../src/db";
import { createAppServer } from "../src/server";

const PROJECT = "dev-fake";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "dev", alg: "RS256", use: "sig" };
const cfg = loadConfig({
  ...process.env,
  NODE_ENV: "development",
  PORT: process.env.PORT ?? "4000",
  MONGODB_URI: process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27027/",
  MONGODB_DB: process.env.MONGODB_DB ?? "pokerdev",
  FIREBASE_PROJECT_ID: PROJECT,
  CORS_ORIGINS: "*",
});
const db = await connectDatabase(cfg);
const server = await createAppServer(cfg, {
  db,
  auth: createAuth(cfg, createLocalJWKSet({ keys: [jwk] })),
  poker: process.env.POKER_FAST ? { speed: 0.3 } : {},
});
const token = (uid: string) =>
  new SignJWT({ email: `${uid}@example.com`, firebase: { sign_in_provider: "google.com" } })
    .setProtectedHeader({ alg: "RS256", kid: "dev" })
    .setIssuer(`https://securetoken.google.com/${PROJECT}`)
    .setAudience(PROJECT)
    .setSubject(uid)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(privateKey);
const listeners = server.http.listeners("request") as ((req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void)[];
server.http.removeAllListeners("request");
server.http.on("request", (req, res) => {
  if (!req.url?.startsWith("/__dev/token")) {
    for (const l of listeners) l(req, res);
    return;
  }
  const q = new URL(req.url, "http://x").searchParams;
  const uid = q.get("uid") || "dev-a";
  const nick = q.get("nick") || "";
  void (async () => {
    if (nick) await db.col("users").updateOne({ _id: uid } as never, { $set: { nick, email: `${uid}@example.com`, createdAt: new Date() } }, { upsert: true });
    res.setHeader("content-type", "application/json");
    res.setHeader("access-control-allow-origin", "*");
    res.end(JSON.stringify({ uid, token: await token(uid) }));
  })();
});
const port = await server.listen();
console.log(`[dev-fake] http://127.0.0.1:${port}  (token: /__dev/token?uid=a&nick=철수)`);
