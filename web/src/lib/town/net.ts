/*
 * TABLE TOWN ↔ 서버 연결 (화면 엔진이 쓰는 얇은 껍데기).
 * 엔진은 이 모양(TownNet)만 알고, 실제 연결은 TownApp 이 넣어 줌 — 시험용 화면에선 가짜를 넣을 수 있게.
 */

export interface SubHandlers<S = unknown> {
  onSnapshot(data: S): void;
  onEvent?(type: string, data: unknown): void;
  onError?(e: { code: string; message: string }): void;
}

export interface TownNet {
  rpc<T = unknown>(method: string, args?: unknown): Promise<T>;
  subscribe<S = unknown>(channel: string, params: unknown, h: SubHandlers<S>): () => void;
  /** 지금 연결의 내 uid (로그인 전이면 null) */
  uid(): string | null;
  /** 게스트로 시작: 익명 로그인 (이미 로그인돼 있으면 그대로) */
  ensureGuest(): Promise<string>;
  /** 서버 시계 기준 지금 시각 */
  now(): number;
  /** 연결 상태 알림 (등록하자마자 한 번) */
  onConnection(cb: (ok: boolean) => void): () => void;
}

/** 사이트 로그인 상태 (TownApp 이 바뀔 때마다 알려 줌) */
export interface TownHost {
  admin: boolean;
  /** 별명을 정한 회원이면 별명 */
  member: string | null;
  /** 로그인 상태 확인 중 */
  loading: boolean;
  login(): void;
  net: TownNet | null;
  /** 엔진이 채움: 로그인 상태가 바뀌면 TownApp 이 부름 */
  changed?: () => void;
}

/** 서버에서 오는 오류의 화면용 문구 */
export const errText = (e: unknown) => {
  const m = (e as { message?: string })?.message;
  return m && m.length < 80 ? m : "잠시 후 다시 시도해 주세요.";
};
export const errCode = (e: unknown) => (e as { code?: string })?.code ?? "";
