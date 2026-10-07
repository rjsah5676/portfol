import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createAuth, type Auth } from "./auth";
import type { Config } from "./config";
import { connectDatabase, type Database } from "./db";
import type { Deps } from "./deps";
import { registerBoardGames } from "./games/board";
import { registerFight } from "./games/fight";
import { registerPoker, type PokerOptions } from "./games/poker";
import { registerSketch } from "./games/sketch";
import { createApp } from "./http/app";
import { Gateway } from "./realtime/gateway";
import { createTraffic } from "./traffic";
import { createUsers } from "./users";
import { createWebNotifier, type WebNotifier } from "./webNotify";

export interface AppServer {
  http: HttpServer;
  deps: Deps;
  /** 실제로 열린 포트 (PORT=0이면 빈 포트) */
  listen(): Promise<number>;
  close(): Promise<void>;
}

/** HTTP API + 실시간 게이트웨이를 한 포트에 올림. 테스트에서는 auth·db를 바꿔 끼울 수 있음 */
export async function createAppServer(
  cfg: Config,
  overrides: { auth?: Auth; db?: Database; web?: WebNotifier; poker?: PokerOptions } = {}
): Promise<AppServer> {
  const db = overrides.db ?? (await connectDatabase(cfg));
  const auth = overrides.auth ?? createAuth(cfg);
  const http = createHttpServer();
  const gateway = new Gateway(http, cfg, auth);
  const users = createUsers(db, cfg);
  gateway.nickOf = (user) => users.nickOf(user);
  users.onRename((uid, nick) => gateway.setNick(uid, nick));
  const traffic = createTraffic(db, { geo: cfg.trafficGeo, cloud: cfg.trafficCloud });
  const deps: Deps = { cfg, db, auth, gateway, users, traffic, web: overrides.web ?? createWebNotifier(cfg) };

  const board = registerBoardGames(deps);
  const sketch = registerSketch(deps);
  const fight = registerFight(deps);
  const poker = registerPoker(deps, overrides.poker);
  const live = { sketch, fight, poker };
  http.on(
    "request",
    createApp(deps, {
      roomsDeleted: board.roomsDeleted,
      liveRooms: () => ({ sketch: sketch.adminList(), fight: fight.adminList(), poker: poker.adminList() }),
      pokerRank: () => poker.wallet.rank(),
      closeLiveRoom: (game, id) => live[game].adminClose(id),
    })
  );

  // 유입 분석: 오래된 원본 IP 지우기 · 어제 집계 (시작 1분 뒤, 이후 매시간)
  const maintain = () => void traffic.maintain().catch((e) => console.warn("[traffic]", e));
  const timers =
    cfg.env === "test" ? [] : [setTimeout(maintain, 60_000), setInterval(maintain, 3600_000)].map((t) => (t.unref(), t));

  return {
    http,
    deps,
    listen: () =>
      new Promise((resolve, reject) => {
        http.once("error", reject);
        http.listen(cfg.port, () => resolve((http.address() as AddressInfo).port));
      }),
    async close() {
      for (const t of timers) clearTimeout(t);
      sketch.close();
      fight.close();
      poker.close();
      await gateway.close();
      await new Promise<void>((res) => http.close(() => res()));
      if (!overrides.db) await db.close();
    },
  };
}
