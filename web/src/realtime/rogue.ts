import { rpc } from "@/lib/api/socket";
import type { RogueReport } from "@/lib/rogue/rules";

/*
 * PIXEL RESET (픽셀 생존기) — 백엔드(server/src/games/rogue.ts)와 통신. 판 시작 · 끝(랭킹 · 업적 통계) · 랭킹
 */

export interface RogueRankRow {
  nick: string;
  avatar: string | null;
  floor: number;
  endFloor: number;
  win: boolean;
  sec: number;
  kills: number;
  /** 액티브 + 패시브 이름 (얻은 순서) */
  build: string[];
  at: number;
}
export interface RogueFinishOut {
  best: boolean;
  rank: number;
  /** 이번 판으로 새로 채운 업적 이름 */
  ach: string[];
}

export const rogue = {
  start: () => rpc<{ run: string }>("rogue.start"),
  finish: (run: string, rep: RogueReport) => rpc<RogueFinishOut>("rogue.finish", { run, rep }),
  rank: (limit = 50) => rpc<RogueRankRow[]>("rogue.rank", { limit }),
};
