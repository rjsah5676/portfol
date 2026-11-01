import { rpc, serverNow, subscribe, watchServerTime } from "@/lib/api/socket";
import type { ApiError } from "@/lib/api/errors";
import type { Wallet } from "@/lib/poker/types";
import type { BotLevel, BotStyle } from "@/lib/stock/bots";
import type {
  BGameWire,
  BLobbyRow,
  BRecords,
  BResult,
  BRoomWire,
  EstateView,
  HubStatus,
  SoloHistoryRow,
  SoloReview,
  SoloView,
  StockMe,
  StockRankRow,
} from "@/lib/stock/types";

/*
 * 주식 마을 — 서버(server/src/games/stock)와 소켓 통신.
 * 화면은 "무엇을 할지"(사기 · 팔기 · 다음 봉 · 몇 주)만 보내고, 돈 · 차트 · 체결은 서버가 계산.
 */

export { serverNow };
export const watchClock = () => watchServerTime();

export const getMe = () => rpc<StockMe>("stock.me");
export const getHub = () => rpc<HubStatus>("stock.hub");
export const getRank = (kind: "assets" | "week") => rpc<StockRankRow[]>("stock.rank", { kind });

/** 지갑이 바뀌면 (포커 · 주식 어디서든) — 포커 지갑 채널을 같이 씀 */
export const subscribeWallet = (cb: (w: Wallet | null) => void, onError?: (e: ApiError) => void) =>
  subscribe<Wallet | null>("poker.wallet", null, {
    onSnapshot: cb,
    onEvent: (t, d) => t === "wallet" && cb(d as Wallet),
    onError,
  });

// ───────────── 솔로 ─────────────

export const soloState = (have = 0) => rpc<SoloView | null>("stock.solo.state", { have });
export const soloStart = () => rpc<SoloView>("stock.solo.start");
export const soloTrade = (o: { side: "buy" | "sell"; qty?: number; pct?: number; have: number }) => rpc<SoloView>("stock.solo.trade", o);
export const soloNext = (n: number, have: number) => rpc<SoloView>("stock.solo.next", { n, have });
export const soloQuit = (have: number) => rpc<SoloView | null>("stock.solo.quit", { have });
export const soloHistory = () => rpc<SoloHistoryRow[]>("stock.solo.history");
export const soloReview = (id: string) => rpc<SoloReview>("stock.solo.review", { id });

// ───────────── 부동산 ─────────────

export const getEstate = () => rpc<EstateView>("stock.estate");
export const buyUnit = (type: string) => rpc<EstateView>("stock.estate.buy", { type });
export const sellUnit = (id: string) => rpc<EstateView>("stock.estate.sell", { id });
export const bidLot = (lot: string, amount: number) => rpc<EstateView>("stock.estate.bid", { lot, amount });

// ───────────── 대전 ─────────────

export const subscribeLobby = (cb: (list: BLobbyRow[]) => void) =>
  subscribe<BLobbyRow[]>("stock.lobby", null, {
    onSnapshot: cb,
    onEvent: (t, d) => t === "list" && cb(d as BLobbyRow[]),
  });

export interface RoomHandlers {
  onRoom(r: BRoomWire | null): void;
  onGame(g: BGameWire | null): void;
  onResult(r: BResult): void;
  onChat(m: BRoomWire["chat"][number]): void;
  onKicked(uid: string): void;
  onError?(e: ApiError): void;
}
export function subscribeRoom(id: string, h: RoomHandlers): () => void {
  return subscribe<{ room: BRoomWire; game: BGameWire | null } | null>(
    "stock.room",
    { id },
    {
      onSnapshot(d) {
        h.onRoom(d?.room ?? null);
        h.onGame(d?.game ?? null);
      },
      onEvent(t, d) {
        if (t === "room") h.onRoom(d as BRoomWire | null);
        else if (t === "game") h.onGame(d as BGameWire);
        else if (t === "result") h.onResult(d as BResult);
        else if (t === "chat") h.onChat(d as BRoomWire["chat"][number]);
        else if (t === "kicked") h.onKicked((d as { uid: string }).uid);
      },
      onError: h.onError,
    }
  );
}

export const createRoom = (o: { title?: string; max?: number; pub?: boolean; password?: string; bots?: number; level?: number }) =>
  rpc<{ id: string; seat: number }>("stock.room.create", o);
export const joinRoom = (id: string, password?: string) => rpc<{ id: string; seat: number }>("stock.room.join", { id, password });
export const quickRoom = () => rpc<{ id: string; seat: number; made: boolean }>("stock.room.quick");
export const leaveRoom = (id: string) => rpc("stock.room.leave", { id });
export const kickSeat = (id: string, seat: number) => rpc("stock.room.kick", { id, seat });
export const addBot = (id: string, style: BotStyle | "random", level: BotLevel) => rpc("stock.room.addBot", { id, style, level });
export const setBot = (id: string, seat: number, o: { style?: BotStyle | "random"; level?: BotLevel }) => rpc("stock.room.setBot", { id, seat, ...o });
export const roomSettings = (id: string, o: { title?: string; max?: number; pub?: boolean; password?: string }) => rpc("stock.room.settings", { id, ...o });
export const startRoom = (id: string) => rpc("stock.room.start", { id });
export const order = (id: string, stock: number, side: "buy" | "sell", qty: number) =>
  rpc<{ ok: boolean; qty?: number; amount?: number; price?: number; cash?: number; hold?: number }>("stock.room.order", { id, stock, side, qty });
export const sellAll = (id: string) => rpc<{ ok: boolean; amount: number; cash: number }>("stock.room.sellAll", { id });
export const roomChat = (id: string, text: string) => rpc("stock.room.chat", { id, text });
export const battleRecords = () => rpc<BRecords>("stock.battle.records");
export const battleGame = (id: string) => rpc<BResult>("stock.battle.game", { id });
