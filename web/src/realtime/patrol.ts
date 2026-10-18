import { rpc } from "@/lib/api/socket";
import type { Pity } from "@/lib/patrol/economy";
import type { GearItem, Slot } from "@/lib/patrol/gear";
import type { ShopGive } from "@/lib/patrol/shop";
import type { WeaponId } from "@/lib/survivor/data";

/*
 * 픽셀 순찰대 — 백엔드(server/src/games/patrol.ts)와 통신
 *  프로필(재화 · 장비 · 챕터 진행 · 순찰) · 판 시작/끝 · 장비 · 상자 · 순찰 받기
 */

export interface PatrolProfile {
  coins: number;
  gems: number;
  /** 설계도 */
  bp: number;
  items: GearItem[];
  equip: Partial<Record<Slot, string>>;
  /** 깬 가장 높은 챕터 (0 = 아직) */
  best: number;
  /** 깬 가장 높은 스테이지 (전체 번호) */
  bestSt: number;
  stars: Record<string, [boolean, boolean, boolean]>;
  runs: number;
  wins: number;
  /** 오늘 남은 두 배 판 */
  boostLeft: number;
  /** 오늘 남은 빠른 순찰 */
  quickLeft: number;
  /** 오늘 일반 상자 무료 */
  freeBox: boolean;
  /** 순찰 보상을 마지막으로 받은 시각 (서버 ms) */
  patrolAt: number;
  pity: Pity;
  /** 무기: 가진 무기 → 조각 · 덱 6칸 · 무기 상자 천장 진행 · 티켓 */
  wown: Partial<Record<WeaponId, number>>;
  wdeck: WeaponId[];
  wpity: number;
  wt: number;
  /** 별 보상 트랙: 받은 칸 수 · 모은 별 합 */
  starTrack: number;
  starSum: number;
  /** GP 상점 산 횟수: 처음 한 번 · 오늘 · 이번 주 */
  shop: { once: Record<string, number>; day: Record<string, number>; week: Record<string, number> };
  /** 서버 시각 (ms) — 순찰 시간 계산을 서버 기준으로 */
  now: number;
}
export interface PatrolFinish {
  coins: number;
  bp: number;
  gems: number;
  gear: GearItem[];
  /** 첫 클리어로 받은 무기 */
  weapon: WeaponGot | null;
  first: boolean;
  newStars: number;
  boosted: boolean;
  /** 랭킹 순위 (기록이 없으면 null) */
  rank: number | null;
  profile: PatrolProfile;
}

/** 랭킹 한 줄 — 깬 스테이지 → 별 합 → 먼저 도달한 순 */
export interface PatrolRankRow {
  nick: string;
  avatar: string | null;
  st: number;
  stars: number;
  power: number;
  at: number;
}

/** 무기 얻음: 처음이면 isNew · 별이 올랐으면 up · 별이 다 차서 코인으로 바뀌었으면 coin */
export interface WeaponGot {
  id: WeaponId;
  isNew: boolean;
  star: number;
  up?: boolean;
  coin: number;
}

export interface Refund {
  coin: number;
  bp: number;
}

export const patrol = {
  profile: () => rpc<PatrolProfile>("patrol.profile"),
  rank: (limit = 50) => rpc<PatrolRankRow[]>("patrol.rank", { limit }),
  start: (st: number) => rpc<{ run: string }>("patrol.start", { st }),
  finish: (run: string, r: { sec: number; kills: number; lv: number; win: boolean; gold: number; skip?: number; stars: [boolean, boolean, boolean] }) => rpc<PatrolFinish>("patrol.finish", { run, ...r }),
  equip: (uid: string) => rpc<PatrolProfile>("patrol.equip", { uid }),
  unequip: (slot: Slot) => rpc<PatrolProfile>("patrol.unequip", { slot }),
  enhance: (uid: string, n = 1) => rpc<{ done: number; profile: PatrolProfile }>("patrol.enhance", { uid, n }),
  /** back: 재료 장비 강화비 환급 */
  merge: (main: string, fodder: string[]) => rpc<{ item: GearItem; back: Refund; profile: PatrolProfile }>("patrol.merge", { main, fodder }),
  mergeAll: () => rpc<{ made: GearItem[]; back: Refund; profile: PatrolProfile }>("patrol.mergeAll"),
  /** 강화 초기화 (Lv1 · 전액 환급) */
  reset: (uid: string) => rpc<{ back: Refund; profile: PatrolProfile }>("patrol.reset", { uid }),
  box: (kind: "premium" | "premium10" | "normal") => rpc<{ got: GearItem[]; profile: PatrolProfile }>("patrol.box", { kind }),
  deck: (deck: WeaponId[]) => rpc<PatrolProfile>("patrol.deck", { deck }),
  wbox: (n: 1 | 10, ticket = false) => rpc<{ got: WeaponGot[]; profile: PatrolProfile }>("patrol.wbox", { n, ticket }),
  gp: () => rpc<{ gp: number }>("patrol.gp"),
  starClaim: () => rpc<{ got: { n: number; give: ShopGive; weapon: WeaponGot | null; gear: GearItem | null }[]; profile: PatrolProfile }>("patrol.starClaim"),
  shop: (id: string) => rpc<{ id: string; weapon: WeaponGot | null; gear: GearItem | null; gp: number; profile: PatrolProfile }>("patrol.shop", { id }),
  claim: (quick = false) => rpc<{ coin: number; bp: number; profile: PatrolProfile }>("patrol.claim", { quick }),
};
