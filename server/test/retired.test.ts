import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_EMAIL, RpcError, startTestServer, type TestServer } from "./helpers";

/* 메뉴에서 내린 게임 5개: 서버가 요청 · 구독을 관리자에게만 받음 (gateway.adminOnly) */

let srv: TestServer;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(async () => {
  await srv.close();
});

const code = (p: Promise<unknown>) => p.then(() => "OK", (e: RpcError) => e.code);

describe("내린 게임", () => {
  it("비로그인 · 일반 회원은 막히고 관리자는 됨", async () => {
    const anon = await srv.client();
    const user = await srv.client("retired-user", { email: "retired@example.com" });
    const admin = await srv.client("admin-uid", { email: ADMIN_EMAIL });
    for (const m of ["rogue.rank", "survivor.rank", "patrol.rank", "marble.rank"]) {
      expect(await code(anon.rpc(m, {}))).toBe("UNAUTHENTICATED");
      expect(await code(user.rpc(m, {}))).toBe("FORBIDDEN");
      expect(await code(admin.rpc(m, {}))).not.toMatch(/FORBIDDEN|UNAUTHENTICATED/);
    }
    expect(await code(user.sub("town.lobby"))).toBe("FORBIDDEN");
    expect(await code(user.sub("marble.lobby"))).toBe("FORBIDDEN");
    expect(await code(admin.sub("marble.lobby"))).toBe("OK");
    // 다른 게임은 그대로
    expect(await code(user.rpc("defense.nope", {}))).toBe("BAD_REQUEST");
  });
});
