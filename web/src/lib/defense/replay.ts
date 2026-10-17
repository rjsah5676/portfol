/**
 * 명령 기록 다시 돌리기 — 랭킹 검증(서버) · 멀티 따라잡기 · 리플레이.
 * 기록 한 줄 = [tick, 보드 번호, 명령]. 그 tick 의 step 전에 적힌 순서대로 실행.
 */
import { BALANCE_VER, B, BOSS_EVERY, LAST_WAVE, TPS } from "./balance";
import { apply, isCmd, newGame, step, type Cmd, type Game } from "./sim";
import type { Loadout } from "./progress";
import { EXP } from "./town";

export type LogEntry = [number, number, Cmd];

/** 한 판이 아무리 길어도 이것보다 길 수 없음 (준비 + 일반 웨이브 + 보스 제한 시간 + 쉬는 시간, 넉넉히) */
export const MAX_TICKS = Math.ceil(
  Math.max(
    B.prepSec + LAST_WAVE * B.waveSec + (LAST_WAVE / BOSS_EVERY) * (B.bossSec + 20 + B.breakSec) + 60,
    // 글리치 원정 2막까지 (층마다 가장 긴 전투 + 정리 시간, 막마다 보스)
    2 * (EXP.floors * (EXP.fightWaves * B.waveSec + EXP.cleanSec) + B.bossSec + 20) + 60
  ) * TPS
);
/** 멀티: 서버가 명령을 모아 뿌리는 간격 · 한 턴의 tick 수 (턴 n 의 명령은 tick n×TICKS_PER_TURN 에 실행) */
export const TURN_MS = 100;
export const TICKS_PER_TURN = (TPS * TURN_MS) / 1000;
/** 클라이언트 최대 배속 (랭킹 검증: 이보다 빨리 끝난 판은 거절) */
export const MAX_SPEED = 3;
/** 멀티 어긋남 감시: 이 tick 마다 각자 hashGame 을 서버로 보내 비교 (5초) */
export const HASH_TICKS = 150;
/** 기록 줄 수 상한 (서버가 받는 크기) */
export const MAX_LOG = 6000;

/** 기록 모양 확인 (tick 이 줄지 않고, 명령이 맞는 모양) */
export function validLog(log: unknown, players: number): log is LogEntry[] {
  if (!Array.isArray(log) || log.length > MAX_LOG) return false;
  let t = 0;
  for (const x of log) {
    if (!Array.isArray(x) || x.length !== 3) return false;
    const [tick, p, cmd] = x;
    if (!Number.isInteger(tick) || tick < t || tick > MAX_TICKS) return false;
    if (!Number.isInteger(p) || p < 0 || p >= players) return false;
    if (!isCmd(cmd)) return false;
    t = tick;
  }
  return true;
}

export interface Replayer {
  game: Game;
  /** ticks 만큼 (또는 끝날 때까지) 진행. 끝났으면 true */
  run(ticks: number): boolean;
}

export function replayer(
  seed: number,
  players: number,
  log: LogEntry[],
  loadouts?: (Loadout | null)[]
): Replayer {
  const g = newGame(seed, players, loadouts);
  let k = 0;
  return {
    game: g,
    run(ticks) {
      for (let n = 0; n < ticks && !g.over && g.tick < MAX_TICKS; n++) {
        while (k < log.length && log[k][0] <= g.tick) {
          apply(g, log[k][1], log[k][2]);
          k++;
        }
        step(g);
      }
      return g.over || g.tick >= MAX_TICKS;
    },
  };
}

/** 끝까지 한 번에 */
export function replay(
  seed: number,
  players: number,
  log: LogEntry[],
  loadouts?: (Loadout | null)[]
): Game {
  const r = replayer(seed, players, log, loadouts);
  r.run(MAX_TICKS);
  return r.game;
}

/** 랭킹 점수: 클리어는 빠를수록, 아니면 웨이브 → 처치 수 (내림차순 한 값으로) */
export function scoreOf(res: { win: boolean; wave: number; tick: number; kills: number }): number {
  return res.win ? 1e9 - res.tick : res.wave * 1e6 + Math.min(999_999, res.kills);
}

export { BALANCE_VER };
