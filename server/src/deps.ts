import type { Auth } from "./auth";
import type { Config } from "./config";
import type { Database } from "./db";
import type { Gateway } from "./realtime/gateway";
import type { WebNotifier } from "./webNotify";

/** 라우트·게임 모듈이 공통으로 받는 것들 */
export interface Deps {
  cfg: Config;
  db: Database;
  auth: Auth;
  gateway: Gateway;
  /** 프론트(Next 서버)에 알릴 것 */
  web: WebNotifier;
}
