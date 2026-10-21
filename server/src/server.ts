import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createAuth, type Auth } from "./auth";
import type { Config } from "./config";
import { connectDatabase, type Database } from "./db";
import type { Deps } from "./deps";
import { registerBoardGames } from "./games/board";
import { registerDefense } from "./games/defense";
import { registerFight } from "./games/fight";
import { registerPoker, type PokerOptions } from "./games/poker";
import { registerRhythmOnline } from "./games/rhythmOnline";
import { registerSketch } from "./games/sketch";
import { registerTown, type TownOptions } from "./games/town";
import { createApp } from "./http/app";
import { restoreLive, saveLive, waitIdle, type LiveGame } from "./live";
import { Gateway } from "./realtime/gateway";
import { createTraffic } from "./traffic";
import { createPoints } from "./points";
import { createUsers } from "./users";
import { createWebNotifier, type WebNotifier } from "./webNotify";

export interface AppServer {
  http: HttpServer;
  deps: Deps;
  /** 실제로 열린 포트 (PORT=0이면 빈 포트) */
  listen(): Promise<number>;
  close(): Promise<void>;
  /**
   * 배포로 내려가기: 접속한 모두에게 공지 → 새 판을 막고 진행 중인 판이 끝나길 (최대 drainMs) 기다림 →
   * 메모리의 방을 DB 에 저장 → close. 다음에 뜨는 서버가 저장한 방을 이어받음 (live.ts)
   */
  shutdown(drainMs?: number): Promise<void>;
}

/** HTTP API + 실시간 게이트웨이를 한 포트에 올림. 테스트에서는 auth·db를 바꿔 끼울 수 있음 */
export async function createAppServer(
  cfg: Config,
  overrides: { auth?: Auth; db?: Database; web?: WebNotifier; poker?: PokerOptions; town?: TownOptions } = {}
): Promise<AppServer> {
  const db = overrides.db ?? (await connectDatabase(cfg));
  const auth = overrides.auth ?? createAuth(cfg);
  const http = createHttpServer();
  const gateway = new Gateway(http, cfg, auth);
  const users = createUsers(db, cfg);
  gateway.nickOf = (user) => users.nickOf(user);
  users.onRename((uid, nick) => gateway.setNick(uid, nick));
  const traffic = createTraffic(db, { geo: cfg.trafficGeo, cloud: cfg.trafficCloud });
  const points = createPoints(db);
  const deps: Deps = { cfg, db, auth, gateway, users, points, traffic, web: overrides.web ?? createWebNotifier(cfg) };

  const board = registerBoardGames(deps);
  const sketch = registerSketch(deps);
  const fight = registerFight(deps);
  const poker = registerPoker(deps, overrides.poker);
  const rhythm = registerRhythmOnline(deps);
  const defense = registerDefense(deps);
  const town = registerTown(deps, overrides.town);
  const live = { sketch, fight, poker, rhythm };
  const liveGames: Record<string, LiveGame> = { sketch: sketch.live, fight: fight.live, poker: poker.live, rhythm: rhythm.live, town: town.live };
  // 배포 직전에 저장해 둔 방이 있으면 이어받음
  const restored = await restoreLive(db, liveGames).catch((e) => {
    console.error("[live] 이어받기 실패", e);
    return [];
  });
  if (restored.length) console.log(`[live] 이전 서버의 방을 이어받음: ${restored.join(", ")}`);
  http.on(
    "request",
    createApp(deps, {
      roomsDeleted: board.roomsDeleted,
      liveRooms: () => ({
        sketch: sketch.adminList(),
        fight: fight.adminList(),
        poker: poker.adminList(),
        rhythm: rhythm.adminList(),
        defense: defense.adminList().map((r) => ({
          id: r.id,
          name: r.name,
          status: r.phase === "playing" ? "play" : r.phase === "lobby" ? "waiting" : "ended",
          players: r.players,
          createdAt: r.createdAt,
        })),
      }),
      rhythmFiles: rhythm.router,
      pokerRank: () => poker.wallet.rank(),
      pokerBuyRank: () => poker.wallet.buyRank(),
      closeLiveRoom: (game, id) => (game === "defense" ? defense : live[game]).adminClose(id),
      pokerSettings: () => poker.adminSettings(),
      setPokerSettings: (p) => poker.adminSetSettings(p),
    })
  );

  // 유입 분석: 오래된 원본 IP 지우기 · 어제 집계 (시작 1분 뒤, 이후 매시간)
  const maintain = () => void traffic.maintain().catch((e) => console.warn("[traffic]", e));
  const timers =
    cfg.env === "test" ? [] : [setTimeout(maintain, 60_000), setInterval(maintain, 3600_000)].map((t) => (t.unref(), t));

  async function close() {
    for (const t of timers) clearTimeout(t);
    sketch.close();
    fight.close();
    poker.close();
    rhythm.close();
    defense.close();
    town.close();
    await gateway.close();
    await new Promise<void>((res) => http.close(() => res()));
    if (!overrides.db) await db.close();
  }

  return {
    http,
    deps,
    listen: () =>
      new Promise((resolve, reject) => {
        http.once("error", reject);
        http.listen(cfg.port, () => resolve((http.address() as AddressInfo).port));
      }),
    close,
    async shutdown(drainMs = cfg.drainMs) {
      const games = Object.values(liveGames);
      gateway.announce({ t: "restart", until: Date.now() + drainMs });
      for (const g of games) g.drain();
      const idle = await waitIdle(games, drainMs);
      if (!idle) console.warn("[live] 기다리는 시간이 지나 진행 중인 판을 두고 내려감");
      await Promise.all(games.map((g) => g.flush?.())).catch((e) => console.error("[live] 정산 기다리기 실패", e));
      // 여기부터는 상태가 바뀌지 않게 (요청 거절 · 끊겨도 자리 유지) → 저장
      gateway.freeze();
      await saveLive(db, liveGames);
      await close();
    },
  };
}
