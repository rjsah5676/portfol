import type { Database } from "../db";
import type { LogEntry } from "../../../web/src/lib/defense/replay";
import type { Result } from "../../../web/src/lib/defense/sim";
import type { Loadout } from "../../../web/src/lib/defense/progress";
import type { VerifyOut } from "./defenseVerify.worker";

/**
 * 디펜스 플레이 기록 (밸런스 · 이탈 분석용) — 컬렉션 defense_plays, 90일 보관.
 * 시뮬이 결정적이라 시드 · 로드아웃 · 명령 기록 · 밸런스 버전만 있으면 같은 판이 그대로 다시 나옴
 * → 웨이브별 상황 · 죽은 자리 · 쓴 유닛은 나중에 서버 스크립트로 다시 돌려서 뽑음. 여기엔 바로 집계할 요약만 더 적음.
 *  - status start    : 시작만 함 (새로고침 · 창 닫기로 끝난 판도 여기 남음)
 *  - status quit     : 판 도중 메뉴로 나감 (tick · wave 는 클라가 보낸 값, 검증 안 함 — 이어하기로 다시 끝낼 수 있음)
 *  - status done     : 끝까지 해서 서버가 다시 돌려 확인함 (res)
 *  - status rejected : 제출했는데 확인 실패 (why) — 어긋남 · 버그 찾기용
 * 멀티는 판이 끝날 때 한 문서 (자리마다 res · uids · lo).
 */
export type PlayMode = "season" | "daily" | "multi";
export type PlayStatus = "start" | "quit" | "done" | "rejected";
export interface PlayRes {
  win: boolean;
  wave: number;
  tick: number;
  kills: number;
  score?: number;
  tops: string[];
  made: Record<string, number>;
  rifts: number;
  treasure?: { wave: number; dmg: number; max: number; killed: boolean } | null;
}
export interface DefensePlay {
  _id: string;
  at: Date;
  end?: Date;
  status: PlayStatus;
  mode: PlayMode;
  ver: string;
  board?: string;
  seed: number;
  uids: string[];
  nicks?: string[];
  lo: (Loadout | null)[];
  log?: LogEntry[];
  res?: (PlayRes | null)[];
  quit?: { tick: number; wave: number };
  why?: string;
  /** 시작부터 제출까지 실제로 걸린 초 (나간 판은 end - at) */
  secs?: number;
}

export const PLAYS_TTL_DAYS = 90;

export function resOf(out: VerifyOut, i: number, score?: number): PlayRes | null {
  const r: Result | null = out.results[i];
  if (!r) return null;
  const s = out.stats[i];
  return {
    win: !!r.win,
    wave: r.wave,
    tick: r.tick,
    kills: r.kills ?? 0,
    ...(score !== undefined && { score }),
    tops: out.tops[i] ?? [],
    made: s?.made ?? {},
    rifts: s?.rifts ?? 0,
    treasure: s?.treasure ?? null,
  };
}

export function createDefensePlays(db: Database) {
  const col = db.col<DefensePlay>("defense_plays");
  void col.createIndex({ at: 1 }, { expireAfterSeconds: PLAYS_TTL_DAYS * 86400 }).catch(() => {});
  void col.createIndex({ mode: 1, status: 1, at: 1 }).catch(() => {});
  // 기록은 실패해도 게임에 영향 없음 (빠지기만)
  const safe = (p: Promise<unknown>) => void p.catch((e) => console.warn("[defense] 플레이 기록 저장 실패", e));
  return {
    col,
    start(doc: Omit<DefensePlay, "status">) {
      safe(col.insertOne({ ...doc, status: "start" }));
    },
    quit(run: string, uid: string, log: LogEntry[], tick: number, wave: number) {
      safe(col.updateOne({ _id: run, uids: uid, status: { $in: ["start", "quit"] } }, { $set: { status: "quit", log, quit: { tick, wave }, end: new Date() } }));
    },
    done(run: string, log: LogEntry[], res: PlayRes | null, secs: number) {
      safe(col.updateOne({ _id: run }, { $set: { status: "done", log, res: [res], end: new Date(), secs }, $unset: { quit: "", why: "" } }));
    },
    rejected(run: string, log: unknown, why: string) {
      safe(col.updateOne({ _id: run, status: { $ne: "done" } }, { $set: { status: "rejected", log: log as LogEntry[], why, end: new Date() } }));
    },
    multi(doc: Omit<DefensePlay, "status" | "mode">) {
      safe(col.insertOne({ ...doc, mode: "multi", status: "done" }));
    },
  };
}
