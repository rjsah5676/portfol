import { rpc, serverNow, subscribe } from "@/lib/api/socket";

/*
 * 픽셀 머지 친구 대전 — 백엔드(server/src/games/pixelmergeBattle.ts)와 통신
 *  방 만들기(초대 링크) · 입장 · 모드 · 시작, 플레이 중 내 병 스냅샷(0.12초마다) · 방해 공 · 탈락
 */

export type BattleMode = "normal" | "junk";
export type BattlePhase = "lobby" | "playing" | "result";

export interface BattlePlace {
  nick: string;
  place: number;
  score: number;
  maxTier: number;
  sent: number;
}
export interface BattleRound {
  no: number;
  seed: number;
  startAt: number;
  roster: string[];
  places: Record<string, BattlePlace>;
}
export interface BattleRoom {
  id: string;
  hostUid: string;
  mode: BattleMode;
  max: number;
  players: Record<string, { nick: string; joinedAt: number }>;
  phase: BattlePhase;
  round: BattleRound | null;
}
export interface Junk {
  round: number;
  to: string;
  from: string;
  n: number;
}

/** 방 상태 · 공 위치 · 방해 공. 방이 없어지면 room(null) */
export function watchBattle(
  id: string,
  h: {
    room(r: BattleRoom | null): void;
    live(round: number, snaps: Record<string, number[]>): void;
    junk(j: Junk): void;
  }
): () => void {
  return subscribe<(BattleRoom & { snaps: Record<string, number[]> | null }) | null>(
    "pmb.room",
    { id },
    {
      onSnapshot: (d) => {
        if (!d) return h.room(null);
        const { snaps, ...room } = d;
        h.room(room);
        if (snaps && room.round) h.live(room.round.no, snaps);
      },
      onEvent: (t, d) => {
        if (t === "room") h.room(d as BattleRoom | null);
        else if (t === "live") {
          const { round, snaps } = d as { round: number; snaps: Record<string, number[]> };
          h.live(round, snaps);
        } else if (t === "junk") h.junk(d as Junk);
      },
      onError: () => h.room(null),
    }
  );
}

export const createBattle = (mode: BattleMode) => rpc<string>("pmb.create", { mode });
export const joinBattle = (id: string, nick: string, rejoin = false) =>
  rpc("pmb.join", { id, nick, rejoin });
export const leaveBattle = (id: string) => rpc("pmb.leave", { id });
export const setBattleMode = (id: string, mode: BattleMode) => rpc("pmb.mode", { id, mode });
export const startBattle = (id: string) => rpc("pmb.start", { id });
export const backToBattleRoom = (id: string) => rpc("pmb.back", { id });
/** 응답을 기다리지 않음 (실패해도 다음 것이 덮음) */
export const sendSnap = (id: string, round: number, s: number[]) => {
  rpc("pmb.snap", { id, round, s }).catch(() => {});
};
export const sendAttack = (id: string, round: number, n: number) =>
  rpc<{ to: string } | null>("pmb.attack", { id, round, n }).catch(() => null);
export const sendDead = (id: string, round: number, score: number, maxTier: number) =>
  rpc("pmb.dead", { id, round, score, maxTier }).catch(() => {});
export { serverNow };
