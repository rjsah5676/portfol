/*
 * PIXEL RESET — 픽셀 생존기 (PIXEL FIGHT 외전 로그라이크) — 서버 · 화면이 같이 쓰는 기록 규칙
 * 판은 public/rogue/index.html (iframe) 이 돌리고, 끝나면 이 모양의 기록을 넘김 → server/src/games/rogue.ts
 */

/** 4챕터 × 2층 */
export const ROGUE_FLOORS = 8;

export interface RogueReport {
  /** 도달한 층 (1~8) */
  floor: number;
  /** 이번 판 목표 층 (열린 챕터 × 2) */
  endFloor: number;
  /** 목표 층 보스까지 잡음 */
  win: boolean;
  /** 판 시간 (멈춘 시간 빼고) */
  sec: number;
  kills: number;
  /** 잡은 보스 (중간 · 챕터) */
  bosses: number;
  /** 패시브 아이템 수 */
  items: number;
  /** 액티브 + 패시브 이름 (얻은 순서) */
  build: string[];
  /** 숨겨진 방을 찾았나 */
  secret: boolean;
  /** 한 대도 안 맞고 잡은 보스 수 */
  noHit: number;
  /** 치트 콘솔 거래 수 */
  cheats: number;
  /** 도감에 열린 아이템 종류 (판 밖 누적) */
  codex: number;
  /** 이번 판에 잡은 가장 깊은 챕터 보스 (0~4) */
  ch: number;
  seed: number;
}

/** 층 표시 (3층 → "2-1") */
export const floorLabel = (n: number) => `${Math.ceil(n / 2)}-${((n - 1) % 2) + 1}`;

/** 랭킹 점수: 깊이 → 클리어 → (클리어면 빠를수록 · 아니면 처치 많을수록) */
export function rogueScore(r: Pick<RogueReport, "floor" | "win" | "sec" | "kills">): number {
  return (
    r.floor * 10_000_000 +
    (r.win ? 5_000_000 : 0) +
    (r.win ? Math.max(0, 36_000 - r.sec) * 100 : Math.min(r.kills, 4_999_999))
  );
}

/** 스피드런 업적: 4층 이상 목표를 15분 안에 */
export const SPEED_SEC = 900;

/** 말이 되는 기록인가 (wall = 서버가 판 시작부터 잰 초) */
export function plausible(r: RogueReport, wall: number): boolean {
  if (r.endFloor % 2 || r.endFloor < 2 || r.endFloor > ROGUE_FLOORS) return false;
  if (r.floor < 1 || r.floor > r.endFloor) return false;
  if (r.win && r.floor !== r.endFloor) return false;
  // 층마다 보스를 잡아야 다음 층으로 감
  if (r.bosses < r.floor - 1 || r.bosses > r.floor) return false;
  if (r.win && r.bosses !== r.floor) return false;
  if (r.ch > Math.floor(r.bosses / 2) || r.ch > Math.floor(r.floor / 2)) return false;
  if (r.noHit > r.bosses || r.cheats > r.floor * 2) return false;
  if (r.sec > wall + 15) return false;
  if (r.sec < (r.floor - 1) * 20) return false;
  if (r.kills > 40 + r.sec * 8) return false;
  return true;
}
