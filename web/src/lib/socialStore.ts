"use client";

import { useSyncExternalStore } from "react";
import { rpc, subscribe } from "@/lib/api/socket";
import type { DmMsg, FriendEntry, Presence, SocialSnapshot } from "@/lib/social";
import { DM_PAGE } from "@/lib/social";

/*
 * 친구 · 메신저 상태 (사이트 전체에 하나). 회원으로 로그인하면 SocialRoot 가 start() → "social" 구독.
 *
 * 화면에서 쓰기
 *   const s = useSocial()            친구 목록 · 안 읽은 수 · 대화 · 열린 창
 *   social.request(nick) / accept(uid) / remove(uid)
 *   social.send(uid, text) / openConvo(uid) / loadMore(uid)
 *   openUserCard(nick) · openChat(uid?) · openReport(nick)   어디서든 (게임 화면 포함) 부르면 SocialRoot 가 창을 띄움
 * 다른 게임에서 친구 연동할 때도 이 파일만 가져다 쓰면 됨 (예: 친구 접속 표시 = friendOf(uid)?.online)
 */

export interface Convo {
  msgs: DmMsg[];
  /** 더 오래된 메시지가 남았는지 */
  more: boolean;
  loading: boolean;
  loaded: boolean;
}

export interface SocialState {
  /** off = 회원이 아님(로그아웃) · loading = 구독 중 · ready · error = 구독 실패 */
  status: "off" | "loading" | "ready" | "error";
  me: string | null;
  friends: FriendEntry[];
  /** 안 읽은 메시지 합 + 받은 친구 요청 수 (플로팅 버튼 숫자) */
  badge: number;
  unread: number;
  incoming: number;
  convos: Record<string, Convo>;
  ui: {
    /** 정보보기 창 (별명) */
    card: string | null;
    /** 메신저 창 · 열린 대화 상대 */
    chat: { open: boolean; with: string | null };
    /** 신고 창 (별명) */
    report: string | null;
  };
  /** 새 메시지 알림 (창이 닫혀 있을 때) · 친구 요청이 오거나 내 요청이 수락됐을 때 (kind) */
  toast: {
    uid: string;
    nick: string;
    text: string;
    at: number;
    kind?: "dm" | "req" | "ok";
  } | null;
}

const EMPTY: SocialState = {
  status: "off",
  me: null,
  friends: [],
  badge: 0,
  unread: 0,
  incoming: 0,
  convos: {},
  ui: { card: null, chat: { open: false, with: null }, report: null },
  toast: null,
};

const NEW_CONVO: Convo = {
  msgs: [],
  more: false,
  loading: false,
  loaded: false,
};

let state: SocialState = EMPTY;
const listeners = new Set<() => void>();
let unsub: (() => void) | null = null;

const sortFriends = (list: FriendEntry[]) =>
  [...list].sort(
    (a, b) =>
      // 받은 요청 → 접속 중 → 최근 대화 → 이름
      Number(b.status === "in") - Number(a.status === "in") ||
      Number(b.online) - Number(a.online) ||
      (b.last?.at ?? 0) - (a.last?.at ?? 0) ||
      a.nick.localeCompare(b.nick, "ko")
  );

function set(patch: Partial<SocialState> | ((s: SocialState) => Partial<SocialState>)) {
  const p = typeof patch === "function" ? patch(state) : patch;
  const next = { ...state, ...p };
  if (p.friends) {
    next.friends = sortFriends(p.friends);
    next.unread = next.friends.reduce((n, f) => n + (f.status === "friends" ? f.unread : 0), 0);
    next.incoming = next.friends.filter((f) => f.status === "in").length;
    next.badge = next.unread + next.incoming;
  }
  state = next;
  listeners.forEach((f) => f());
}

const upsert = (list: FriendEntry[], e: FriendEntry) => {
  const i = list.findIndex((f) => f.uid === e.uid);
  if (i < 0) return [...list, e];
  const copy = [...list];
  copy[i] = e;
  return copy;
};
const patchFriend = (uid: string, p: Partial<FriendEntry>) =>
  set((s) => ({
    friends: s.friends.map((f) => (f.uid === uid ? { ...f, ...p } : f)),
  }));
const patchConvo = (uid: string, p: Partial<Convo>) =>
  set((s) => ({
    convos: { ...s.convos, [uid]: { ...(s.convos[uid] ?? NEW_CONVO), ...p } },
  }));

/** 지금 보고 있는 대화 (창이 열려 있고 탭이 보이는 중) */
const viewing = (uid: string) =>
  state.ui.chat.open &&
  state.ui.chat.with === uid &&
  typeof document !== "undefined" &&
  document.visibilityState === "visible";

function onDm(d: { uid: string; msg: DmMsg; unread: number }) {
  const c = state.convos[d.uid];
  if (c?.loaded && !c.msgs.some((m) => m.id === d.msg.id))
    patchConvo(d.uid, { msgs: [...c.msgs, d.msg] });
  const mine = d.msg.from === state.me;
  const f = state.friends.find((x) => x.uid === d.uid);
  patchFriend(d.uid, {
    last: { at: d.msg.at, mine, text: d.msg.text.slice(0, 80) },
    unread: mine ? 0 : d.unread,
  });
  if (!mine) {
    if (viewing(d.uid)) void social.markRead(d.uid);
    else if (!state.ui.chat.open)
      set({
        toast: {
          uid: d.uid,
          nick: f?.nick ?? "친구",
          text: d.msg.text,
          at: Date.now(),
        },
      });
  }
}

export const social = {
  /** 회원으로 로그인했을 때 (SocialRoot) */
  start() {
    if (unsub) return;
    set({ ...EMPTY, ui: state.ui, status: "loading" });
    unsub = subscribe<SocialSnapshot>("social", null, {
      onSnapshot(d) {
        // 다시 연결되면 또 옴 — 대화 기록은 다음에 열 때 새로 받음
        set({ status: "ready", me: d.uid, friends: d.friends, convos: {} });
        const w = state.ui.chat.with;
        if (state.ui.chat.open && w) void social.openConvo(w);
      },
      onEvent(t, d) {
        if (t === "friend") {
          const e = d as FriendEntry;
          const prev = state.friends.find((f) => f.uid === e.uid)?.status;
          set((s) => ({ friends: upsert(s.friends, e) }));
          // 받은 요청 · 내 요청 수락은 알림으로 (내가 수락한 건 prev === "in" 이라 안 뜸)
          const at = Date.now();
          if (e.status === "in" && prev !== "in")
            set({ toast: { uid: e.uid, nick: e.nick, text: "친구 요청을 보냈어요", at, kind: "req" } });
          else if (e.status === "friends" && prev === "out")
            set({ toast: { uid: e.uid, nick: e.nick, text: "친구 요청을 수락했어요", at, kind: "ok" } });
        } else if (t === "unfriend") {
          const uid = (d as { uid: string }).uid;
          set((s) => ({
            friends: s.friends.filter((f) => f.uid !== uid),
            ui: s.ui.chat.with === uid ? { ...s.ui, chat: { ...s.ui.chat, with: null } } : s.ui,
          }));
        } else if (t === "presence") {
          const p = d as Presence;
          patchFriend(p.uid, {
            online: p.online,
            where: p.where,
            seen: p.seen,
          });
        } else if (t === "dm") onDm(d as { uid: string; msg: DmMsg; unread: number });
        else if (t === "read") {
          const r = d as { uid: string; at: number; by: string };
          if (r.by === state.me) patchFriend(r.uid, { unread: 0 });
          else patchFriend(r.uid, { readAt: r.at });
        }
      },
      onError() {
        unsub = null;
        set({ status: "error" });
      },
    });
  },
  stop() {
    unsub?.();
    unsub = null;
    set({ ...EMPTY });
  },

  /** 별명으로 친구 요청 → "friends"(상대가 먼저 요청해 둔 경우) | "out" */
  request: (nick: string) => rpc<{ status: "friends" | "out" }>("social.request", { nick }),
  accept: (uid: string) => rpc("social.accept", { uid }),
  /** 친구 끊기 · 거절 · 요청 취소 */
  remove: (uid: string) => rpc("social.remove", { uid }),

  async send(uid: string, text: string) {
    const msg = await rpc<DmMsg>("dm.send", { uid, text });
    onDm({ uid, msg, unread: 0 });
    return msg;
  },
  /** 대화 열기: 처음이면 최근 메시지를 받고, 읽음 표시 */
  async openConvo(uid: string) {
    const c = state.convos[uid];
    if (!c?.loaded && !c?.loading) {
      patchConvo(uid, { loading: true });
      try {
        const r = await rpc<{ msgs: DmMsg[]; more: boolean }>("dm.history", {
          uid,
        });
        patchConvo(uid, {
          msgs: r.msgs,
          more: r.more,
          loading: false,
          loaded: true,
        });
      } catch (e) {
        patchConvo(uid, { loading: false });
        throw e;
      }
    }
    await social.markRead(uid);
  },
  async loadMore(uid: string) {
    const c = state.convos[uid];
    if (!c?.loaded || c.loading || !c.more) return;
    patchConvo(uid, { loading: true });
    try {
      const r = await rpc<{ msgs: DmMsg[]; more: boolean }>("dm.history", {
        uid,
        before: c.msgs[0]?.at ?? Date.now(),
      });
      const cur = state.convos[uid]?.msgs ?? [];
      const seen = new Set(cur.map((m) => m.id));
      patchConvo(uid, {
        msgs: [...r.msgs.filter((m) => !seen.has(m.id)), ...cur],
        more: r.more && r.msgs.length === DM_PAGE,
        loading: false,
      });
    } catch {
      patchConvo(uid, { loading: false });
    }
  },
  async markRead(uid: string) {
    const f = state.friends.find((x) => x.uid === uid);
    if (!f || f.status !== "friends") return;
    if (f.unread) patchFriend(uid, { unread: 0 });
    await rpc("dm.read", { uid }).catch(() => {});
  },
  /** 페이지를 옮길 때 (SocialRoot) */
  where: (where: string | null) => rpc("social.where", { where }).catch(() => {}),

  setUi(p: Partial<SocialState["ui"]>) {
    set((s) => ({ ui: { ...s.ui, ...p } }));
  },
  clearToast() {
    set({ toast: null });
  },
  get: () => state,
};

/** 정보보기 창 */
export const openUserCard = (nick: string) => social.setUi({ card: nick });
/** 메신저 창 (uid 를 주면 그 친구와의 대화) */
export const openChat = (uid: string | null = null) => {
  social.setUi({ chat: { open: true, with: uid } });
  social.clearToast();
  if (uid && state.status === "ready") void social.openConvo(uid).catch(() => {});
};
export const closeChat = () => social.setUi({ chat: { open: false, with: state.ui.chat.with } });
/** 신고 창 */
export const openReport = (nick: string) => social.setUi({ report: nick, card: null });

const sub = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
export function useSocial(): SocialState {
  return useSyncExternalStore(
    sub,
    () => state,
    () => EMPTY
  );
}
/** 그 사람과의 친구 줄 (없으면 undefined) — 게임 화면에서 접속 표시 · 친구 표시용 */
export function useFriend(uid: string | null | undefined): FriendEntry | undefined {
  const s = useSocial();
  return uid ? s.friends.find((f) => f.uid === uid) : undefined;
}
export const friendByNick = (nick: string) =>
  state.friends.find((f) => f.nick.toLowerCase() === nick.toLowerCase());
