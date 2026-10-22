"use client";

import { signInAnonymously } from "firebase/auth";
import { auth } from "@/firebase";
import { onConnection, rpc, serverNow, subscribe } from "@/lib/api/socket";
import type { TownNet } from "@/lib/town/net";

/** TABLE TOWN 이 쓰는 실제 서버 연결 (사이트 공용 socket.io 연결 위에) */
export const townNet: TownNet = {
  rpc: (m, a) => rpc(m, a),
  subscribe: (ch, p, h) => subscribe(ch, p, { onSnapshot: h.onSnapshot, onEvent: h.onEvent, onError: (e) => h.onError?.({ code: e.code, message: e.message }) }),
  uid: () => auth.currentUser?.uid ?? null,
  async ensureGuest() {
    await auth.authStateReady();
    if (auth.currentUser) return auth.currentUser.uid;
    const c = await signInAnonymously(auth);
    return c.user.uid;
  },
  now: () => serverNow(),
  onConnection: (cb) => onConnection(cb),
};
