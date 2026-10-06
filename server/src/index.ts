import { loadConfig, loadDotEnv } from "./config";
import { createAppServer } from "./server";

loadDotEnv();
const cfg = loadConfig();
const server = await createAppServer(cfg);
const port = await server.listen();
console.log(`[server] http://localhost:${port} (${cfg.env})`);
if (cfg.env === "production" && cfg.corsOrigins !== "*" && !cfg.corsOrigins.length)
  console.warn("[server] CORS_ORIGINS가 비어 있어 브라우저에서 호출할 수 없습니다. 프론트 주소를 지정하세요.");

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.log(`[server] ${signal} → 종료 중`);
  // 정리가 오래 걸려도 10초 뒤에는 끝냄
  setTimeout(() => process.exit(1), 10_000).unref();
  await server.close().catch((e) => console.error(e));
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
