import { api } from "@/lib/api/http";
import { rpc, serverNow, subscribe, watchServerTime } from "@/lib/api/socket";
import type { ApiError } from "@/lib/api/errors";
import type { GameKind, TierId } from "@/lib/poker/rules";
import type { ChatMsg, HoldemAction, LobbyTable, MyHand, RankRow, SevenAction, TableWire, Wallet } from "@/lib/poker/types";

/*
 * 포커(홀덤 · 7포커) — 백엔드와 소켓으로 통신 (server/src/games/poker)
 *
 * 화면이 서버에 보내는 것은 "무엇을 할지"뿐: 앉기 · 나가기 · 콜 · 레이즈 얼마 · 카드 고르기.
 * 돈과 카드는 전부 서버가 계산하고, 내 패는 나만 받는 구독(poker.me)으로 옴.
 */

export { serverNow };
export const watchClock = () => watchServerTime();

export const subscribeLobby = (cb: (list: LobbyTable[]) => void) =>
  subscribe<LobbyTable[]>("poker.lobby", null, {
    onSnapshot: cb,
    onEvent: (t, d) => t === "list" && cb(d as LobbyTable[]),
  });

export const subscribeWallet = (cb: (w: Wallet | null) => void, onError?: (e: ApiError) => void) =>
  subscribe<Wallet | null>("poker.wallet", null, {
    onSnapshot: cb,
    onEvent: (t, d) => t === "wallet" && cb(d as Wallet),
    onError,
  });

export interface TableHandlers {
  /** 테이블 상태 (null = 테이블이 없어짐) */
  onState(t: TableWire | null): void;
  onChat(list: ChatMsg[], added?: ChatMsg): void;
  onError?(e: ApiError): void;
}

export function subscribeTable(id: string, h: TableHandlers): () => void {
  let chat: ChatMsg[] = [];
  return subscribe<{ table: TableWire; chat: ChatMsg[] } | null>(
    "poker.table",
    { id },
    {
      onSnapshot(d) {
        chat = d?.chat ?? [];
        h.onChat(chat);
        h.onState(d?.table ?? null);
      },
      onEvent(t, d) {
        if (t === "state") h.onState(d as TableWire | null);
        else if (t === "chat") {
          chat = [...chat, d as ChatMsg].slice(-60);
          h.onChat(chat, d as ChatMsg);
        }
      },
      onError: h.onError,
    }
  );
}

/** 내 패. 이 구독이 살아 있는 동안 서버는 내가 "접속 중"이라고 봄 */
export const subscribeMyHand = (id: string, cb: (h: MyHand | null) => void) =>
  subscribe<MyHand | null>(
    "poker.me",
    { id },
    {
      onSnapshot: cb,
      onEvent: (t, d) => t === "hand" && cb(d as MyHand),
    }
  );

export const quickJoin = (game: GameKind, tier: TierId) => rpc<string>("poker.quick", { game, tier });
export const createTable = (o: { game: GameKind; tier: TierId; name: string; bots: number; password: string }) =>
  rpc<string>("poker.create", o);
export const sit = (id: string, password?: string) => rpc<{ seat: number }>("poker.sit", { id, password });
export const leave = (id: string) => rpc("poker.leave", { id });
export const act = (id: string, hand: number, action: HoldemAction | SevenAction) =>
  rpc("poker.act", { id, hand, ...action });
export const setSitOut = (id: string, out: boolean) => rpc("poker.sitout", { id, out });
export const sendChat = (id: string, text: string) => rpc("poker.chat", { id, text });
export const revive = () => rpc<Wallet>("poker.revive");

/** 자금 순위 (한 판이라도 친 회원, 보유금액 순) */
export const getRank = () => api<{ list: RankRow[] }>("/api/poker/rank").then((r) => r.list);
