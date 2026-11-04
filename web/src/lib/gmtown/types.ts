/*
 * GMTOWN — 서버 ↔ 화면 데이터 모양 (서버도 이 파일을 그대로 import).
 *
 * 구독 gmtown.ch { ch: 채널 번호 | null(자동) } → 키 gmtown:ch:N
 *   첫 데이터 TownSnap · 이벤트 join(PlayerWire) · leave(id) · mv(MoveWire[]) · chat(ChatWire) · snap({x, y} — 나에게만, 위치 바로잡기)
 * 요청 gmtown.move { x, y, d, m } · gmtown.chat { text } · gmtown.channels · gmtown.warp { to } · gmtown.char { c }
 *      gmtown.house → HouseWire · gmtown.house.buy { tier } → HouseWire (중개인 NPC 에게 집 계약)
 */

export type CharId = "amy" | "mio" | "sera";
/** 마을에 서 있는 NPC 모델 (사람이 고르는 캐릭터 아님) */
export type NpcModel = "agent";
/** 3D 모델 종류 (사람 캐릭터 + NPC) */
export type ModelId = CharId | NpcModel;

/** 내 집 계약 상태 */
export interface HouseWire {
  /** 0 = 아직 없음, 1~ = HOUSE_TIERS 단계 */
  tier: number;
  /** 지금 GP (게스트는 null — 회원만 계약) */
  gp: number | null;
}

export interface PlayerWire {
  /** 이 마을에서만 쓰는 짧은 id (uid 아님) */
  id: string;
  name: string;
  /** 로그인 안 한 사람 */
  guest: boolean;
  c: CharId;
  x: number;
  y: number;
  /** 바라보는 방향 0~7 (0 = 위, 시계 방향) */
  d: number;
  /** 0 서 있음 · 1 걷는 중 · 2 뛰는 중 */
  m: 0 | 1 | 2;
}

/** [id, x, y, 방향, 0 서 있음 · 1 걷기 · 2 뛰기] — 0.1초마다 바뀐 사람만 */
export type MoveWire = [id: string, x: number, y: number, d: number, m: 0 | 1 | 2];

export interface ChatWire {
  id: string;
  name: string;
  text: string;
  at: number;
}

export interface TownSnap {
  ch: number;
  /** 내 id */
  me: string;
  cap: number;
  players: PlayerWire[];
  chat: ChatWire[];
}

export interface ChannelList {
  cap: number;
  list: { ch: number; n: number }[];
}
