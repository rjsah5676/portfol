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
  console.log(`[server] ${signal} → 진행 중인 판을 마무리하고 방을 저장한 뒤 종료 (최대 ${Math.round(cfg.drainMs / 1000)}초)`);
  // 마무리가 오래 걸려도 정해진 시간 + 15초 뒤에는 끝냄 (docker 의 stop_grace_period 는 이보다 길게)
  setTimeout(() => process.exit(1), cfg.drainMs + 15_000).unref();
  await server.shutdown().catch((e) => console.error(e));
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
