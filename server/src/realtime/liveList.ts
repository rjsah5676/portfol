import { stamp } from "../stamp";
import type { Gateway } from "./gateway";

export interface ListSnapshot<T> {
  /** 조회를 시작한 순서 — 클수록 최신 */
  s: number;
  list: T[];
}

/**
 * "DB 조회 결과 전체"를 구독자에게 밀어주는 목록 (방명록, 문의함, 방 로비).
 * Firestore onSnapshot(query)처럼 바뀔 때마다 목록 전체를 다시 보냄.
 */
export function liveList<T>(gateway: Gateway, key: string, query: () => Promise<T[]>, debounceMs = 0) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const load = async (): Promise<ListSnapshot<T>> => {
    const s = stamp();
    return { s, list: await query() };
  };
  const send = async () => {
    // 듣는 사람이 없으면 조회하지 않음
    if (!gateway.subscribers(key).length) return;
    try {
      gateway.emit(key, "list", await load());
    } catch (e) {
      console.error(`[liveList] ${key}`, e);
    }
  };
  return {
    key,
    load,
    /** 내용이 바뀌었으니 구독자에게 다시 보냄 */
    publish() {
      if (!debounceMs) return void send();
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void send();
      }, debounceMs);
    },
  };
}
