/** 우편 (server/src/mail.ts · 플로팅 버튼의 우편함). 서버는 타입만 가져다 씀 */

export interface MailItem {
  id: string;
  title: string;
  body: string;
  /** 받기를 누르면 들어오는 GP (0 이면 알림만) */
  points: number;
  at: number;
  /** 이때까지 받을 수 있음 */
  until: number;
  /** 받은(확인한) 때 · 안 받았으면 null */
  gotAt: number | null;
}

/** 관리자 화면: 보낸 우편 */
export interface MailAdminRow {
  id: string;
  /** "*" = 모든 회원, 아니면 받는 사람 별명 */
  to: "*" | string[];
  title: string;
  body: string;
  points: number;
  at: number;
  until: number;
  /** 받은 사람 수 */
  got: number;
}

/** 우편함 안 받은 수가 바뀌었을 때 (받기 · 새로 불러옴) — 플로팅 버튼 숫자 */
export const MAIL_EVENT = "mail:unread";
