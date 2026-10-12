import type { Auth } from "./auth";
import type { Config } from "./config";
import type { Database } from "./db";
import type { Points } from "./points";
import type { Gateway } from "./realtime/gateway";
import type { Traffic } from "./traffic";
import type { Users } from "./users";
import type { WebNotifier } from "./webNotify";

/** 라우트·게임 모듈이 공통으로 받는 것들 */
export interface Deps {
  cfg: Config;
  db: Database;
  auth: Auth;
  gateway: Gateway;
  /** 회원 별명·기록 */
  users: Users;
  /** 포인트 (출석 · 업적 · 상점 · 환전) */
  points: Points;
  /** 유입 분석 기록·집계 */
  traffic: Traffic;
  /** 프론트(Next 서버)에 알릴 것 */
  web: WebNotifier;
}
