import os from "node:os";
import path from "node:path";

/** 환경변수 → 설정. 값이 없으면 로컬 개발에 맞는 기본값. */
export interface Config {
  env: "development" | "production" | "test";
  port: number;
  /** 비어 있으면 개발 모드에서 내장 MongoDB(mongodb-memory-server)를 띄움 */
  mongoUri: string;
  /** 내장 MongoDB 의 데이터 폴더. 기본은 사용자 홈 아래 (레포가 OneDrive 같은 동기화 폴더에 있어도 DB 파일이 동기화에 걸리지 않게) */
  mongoDataDir: string;
  mongoDb: string;
  /** 허용할 프론트 주소. "*" = 전부 허용 */
  corsOrigins: string[] | "*";
  firebaseProjectId: string;
  /** Firebase ID 토큰 서명 검증용 공개키(JWKS) 주소 */
  authJwksUrl: string;
  adminEmails: string[];
  /** 테스터: /admin 에서 「내린 게임」만 들어가 해 볼 수 있는 계정 (관리자 기능은 없음) */
  testerEmails: string[];
  /** 관리자 계정이 처음 로그인할 때 자동으로 붙는 별명 (다른 사람은 못 씀) */
  adminNick: string;
  /** 프록시(Caddy·nginx 등) 뒤에 둘 때 X-Forwarded-For를 믿을 단계 수 */
  trustProxy: number;
  /** 글이 바뀌면 프론트(Next 서버)에 캐시를 비우라고 알릴 주소 (예: http://web:3000/internal/revalidate/). 비우면 알리지 않음 */
  webRevalidateUrl: string;
  /** 그 요청에 실어 보내는 공유 비밀값 (프론트의 REVALIDATE_SECRET 과 같아야 함) */
  revalidateSecret: string;
  /** 유입 분석에서 IP로 국가·지역 찾기 (geoip-lite, 메모리 약 100MB). 기본은 켬, 테스트에서는 끔 */
  trafficGeo: boolean;
  /** 유입 분석에서 클라우드(AWS·GCP·Azure 등) IP 표시 — 업체 공개 대역을 하루 한 번 받아 옴. 기본은 켬, 테스트에서는 끔 */
  trafficCloud: boolean;
  /** 배포로 내려갈 때 진행 중인 판(포커 한 판·격투 한 경기)이 끝나길 기다리는 최대 시간 (ms, 운영 기본 60초 · 개발 2초). docker 의 stop_grace_period 보다 짧게 */
  drainMs: number;
}

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** server/.env 가 있으면 읽음. 셸·Docker 에서 이미 지정한 환경변수는 그대로 둠 */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // .env 없음 → 기본값으로
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode =
    env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" ? "test" : "development";
  const origins = list(env.CORS_ORIGINS);
  return {
    env: mode,
    // PORT=0 이면 빈 포트를 아무거나 씀 (테스트용)
    port: env.PORT?.trim() && Number.isInteger(Number(env.PORT)) ? Number(env.PORT) : 4000,
    mongoUri: env.MONGODB_URI?.trim() ?? "",
    mongoDataDir: env.MONGO_DATA_DIR?.trim() || path.join(os.homedir(), ".portfolio-dev", "mongo"),
    mongoDb: env.MONGODB_DB?.trim() || "portfolio",
    // 운영에서는 반드시 지정. 개발에서는 비워두면 전부 허용(로컬 포트가 바뀌어도 되게)
    corsOrigins: origins.includes("*") ? "*" : origins.length ? origins : mode === "production" ? [] : "*",
    firebaseProjectId: env.FIREBASE_PROJECT_ID?.trim() || "gunmo-portfolio",
    authJwksUrl:
      env.AUTH_JWKS_URL?.trim() ||
      "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
    adminEmails: list(env.ADMIN_EMAILS).length ? list(env.ADMIN_EMAILS) : ["rjsah5676@gmail.com", "cksqls9706@gmail.com"],
    testerEmails: list(env.TESTER_EMAILS).length ? list(env.TESTER_EMAILS) : ["njontest@gunmo.my"],
    adminNick: env.ADMIN_NICK?.trim() || "이건모",
    trustProxy: Number(env.TRUST_PROXY) || 0,
    webRevalidateUrl: env.WEB_REVALIDATE_URL?.trim() ?? "",
    revalidateSecret: env.REVALIDATE_SECRET?.trim() ?? "",
    trafficGeo: env.TRAFFIC_GEO?.trim() ? env.TRAFFIC_GEO.trim() !== "0" : mode !== "test",
    trafficCloud: env.TRAFFIC_CLOUD?.trim() ? env.TRAFFIC_CLOUD.trim() !== "0" : mode !== "test",
    drainMs: env.DRAIN_MS?.trim() && Number.isFinite(Number(env.DRAIN_MS)) ? Math.max(0, Number(env.DRAIN_MS)) : mode === "production" ? 60_000 : 2_000,
  };
}
