/*
 * 친구 · 메신저 · 정보보기 · 신고 (server/src/social.ts). 서버도 이 파일의 타입 · 상수를 그대로 가져다 씀.
 *
 * 실시간은 구독 채널 "social" 하나 (회원만): 첫 데이터 = 내 친구 목록, 이후 이벤트
 *   friend   FriendEntry            친구 · 요청이 생기거나 바뀜 (별명 · 사진이 바뀌어도)
 *   unfriend { uid }                친구 · 요청이 없어짐 (삭제 · 거절 · 취소)
 *   presence Presence               친구가 들어옴 · 나감 · 있는 곳이 바뀜
 *   dm       { uid, msg, unread }   메시지 (uid = 대화 상대, 내가 보낸 것도 옴 — 다른 탭 맞추기)
 *   read     { uid, at, by }        읽음 (by = 읽은 사람: 나면 내 다른 탭, 상대면 「읽음」 표시)
 * 다른 게임에서 쓸 때: 화면은 lib/socialStore 의 useSocial · openUserCard · openChat, 서버는 deps.social.
 */

/** 친구 최대 수 (받은 요청 · 보낸 요청 포함) */
export const FRIEND_MAX = 200;
/** 아직 수락 안 된 보낸 요청 최대 수 */
export const FRIEND_PENDING_MAX = 30;
/** 메시지 한 개 최대 글자 */
export const DM_MAX_LEN = 500;
/** 대화 한 번에 불러오는 메시지 수 */
export const DM_PAGE = 50;
/** 있는 곳 표시 최대 글자 */
export const WHERE_MAX = 24;

/** friends = 친구, in = 나한테 온 요청, out = 내가 보낸 요청 */
export type FriendStatus = "friends" | "in" | "out";

export interface FriendEntry {
  uid: string;
  nick: string;
  badge: string | null;
  /** 프로필 사진 주소 (없으면 null) */
  pic: string | null;
  status: FriendStatus;
  /** 요청한 때 (친구면 친구가 된 때) */
  at: number;
  /** 접속 중 · 있는 곳 · 마지막 접속 — 친구일 때만 채워짐 */
  online: boolean;
  where: string | null;
  seen: number | null;
  /** 안 읽은 메시지 수 */
  unread: number;
  /** 마지막 메시지 (목록 미리보기) */
  last: { at: number; mine: boolean; text: string } | null;
  /** 상대가 내 메시지를 어디까지 읽었는지 (ms) */
  readAt: number;
}

export interface Presence {
  uid: string;
  online: boolean;
  where: string | null;
  seen: number | null;
}

export interface DmMsg {
  id: string;
  from: string;
  text: string;
  at: number;
}

export interface SocialSnapshot {
  uid: string;
  friends: FriendEntry[];
}

/** 정보보기 카드 — 공개해도 되는 것만 (이메일 · GP · 방문 기록 같은 건 없음) */
export interface UserCard {
  uid: string;
  nick: string;
  badge: string | null;
  pic: string | null;
  /** 가입한 때 */
  since: number;
  /** 지금까지 한 게임 수 */
  plays: number;
  /** 받은 업적 수 */
  achs: number;
  friends: number;
  poker: { money: number; hands: number; wins: number } | null;
  fight: {
    matches: number;
    rating: {
      r: number;
      rank: number;
      of: number;
      w: number;
      l: number;
    } | null;
  } | null;
  rhythm: { bp: number; rank: number; of: number } | null;
  defense: { runs: number; wins: number; wave: number } | null;
  sketch: { games: number; wins: number; correct: number } | null;
  /** 온라인 대국 전적 (체스 · 장기 · 오목) */
  online: { game: string; w: number; l: number; d: number }[];
  /** 보는 사람과의 사이 (로그인 안 했으면 null) */
  rel: "self" | FriendStatus | null;
  /** 친구(또는 나)일 때만 */
  presence: Presence | null;
}

/** 신고 사유 */
export const REPORT_REASONS = [
  "욕설 · 비하",
  "도배 · 광고",
  "부적절한 별명 · 사진",
  "게임 부정행위",
  "사칭",
  "기타",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_TEXT_MAX = 500;

export interface ReportRow {
  id: string;
  at: number;
  from: { uid: string; nick: string };
  target: { uid: string; nick: string };
  reason: ReportReason;
  text: string;
  /** 신고한 화면 주소 */
  where: string;
  /** 두 사람 사이 최근 메시지 (있으면, 오래된 것부터) */
  dms: { from: string; text: string; at: number }[];
  status: "open" | "done";
  note: string;
  doneAt: number | null;
}

/** 페이지 주소 → 친구에게 보일 「있는 곳」 (없으면 null = 그냥 접속 중) */
export function whereOf(path: string): string | null {
  const p = path.replace(/\/+$/, "") || "/";
  const games: [string, string][] = [
    ["/games/poker", "ANIME POKER"],
    ["/games/fight", "PIXEL FIGHT"],
    ["/games/defense", "PIXEL LUCKY DEFENSE"],
    ["/games/rhythm", "PIXEL Rhythm Up"],
    ["/games/sketch", "DOODLE PARTY"],
    ["/games/town", "TABLE TOWN"],
    ["/games/board", "보드게임"],
    ["/games/melongame", "멜론 게임"],
    ["/games/mine", "지뢰찾기"],
    ["/games/rspeed", "반응속도"],
  ];
  for (const [pre, label] of games) if (p === pre || p.startsWith(pre + "/")) return label;
  if (p.startsWith("/games")) return "게임 둘러보는 중";
  return null;
}
