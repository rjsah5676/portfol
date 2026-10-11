import { api } from "@/lib/api/http";
import { rpc, serverNow, subscribe, watchServerTime } from "@/lib/api/socket";
import type { ApiError } from "@/lib/api/errors";
import type { CharId, Emote, GameKind, SkinId, TierId } from "@/lib/poker/rules";
import type {
  ChatMsg,
  DevOpts,
  HoldemAction,
  LobbyTable,
  MailItem,
  MyHand,
  MyPage,
  BuyRankRow,
  RankRow,
  SevenAction,
  TableWire,
  Wallet,
} from "@/lib/poker/types";

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

export const quickJoin = (game: GameKind, tier: TierId) =>
  rpc<string>("poker.quick", { game, tier });
export const createTable = (o: {
  game: GameKind;
  tier: TierId;
  name: string;
  /** 바로 입장 허용 */
  quick: boolean;
  /** 봇 참가 가능 (바로 입장 허용일 때만) */
  bots: boolean;
  password: string;
}) => rpc<string>("poker.create", o);
/** 방 설정 (바로 입장 허용 · 봇 참가 가능): 값을 안 주면 읽기만. 바꾸는 건 방장만 */
export const roomOpts = (id: string, set?: { quick?: boolean; bots?: boolean }) =>
  rpc<{ owner: boolean; quick: boolean; bots: boolean }>("poker.roomOpts", { id, ...set });
/** 관리자 테스트 방 열기 (돌려준 id 로 sit) */
export const devCreate = (o: { game: GameKind; tier: TierId; bots: CharId[] } & Partial<DevOpts>) =>
  rpc<string>("poker.devCreate", o);
/** 테스트 방 바꾸기 */
export const devSet = (
  id: string,
  o: Partial<DevOpts> & { refill?: boolean; addBot?: CharId; removeSeat?: number; next?: boolean }
) => rpc<DevOpts>("poker.devSet", { id, ...o });
/** 우편함 (최근 것부터) */
export const getMail = () => rpc<MailItem[]>("poker.mail");
/** 우편 받기 (id 없으면 전부) */
export const claimMail = (id?: string) => rpc<{ got: number; wallet: Wallet | null }>("poker.mailClaim", { id });
export const sit = (id: string, password?: string) =>
  rpc<{ seat: number }>("poker.sit", { id, password });
export const leave = (id: string) => rpc("poker.leave", { id });
export const act = (id: string, hand: number, action: HoldemAction | SevenAction) =>
  rpc("poker.act", { id, hand, ...action });
export const setSitOut = (id: string, out: boolean) => rpc("poker.sitout", { id, out });
/** 나가기 예약 켜기/끄기. 판에 안 끼어 있으면 바로 나가고 left = true */
export const setExit = (id: string, on: boolean) =>
  rpc<{ left: boolean }>("poker.exit", { id, on });
/** 강퇴 투표 (3표면 강퇴). 이 방에서 3판 이상 쳐야 할 수 있음 */
export const kickVote = (id: string, seat: number) =>
  rpc<{ votes: number; need: number; kicked: boolean }>("poker.kick", { id, seat });
/** 마이페이지 */
export const getMyPage = () => rpc<MyPage | null>("poker.me");
export const sendChat = (id: string, text: string) => rpc("poker.chat", { id, text });
export const sendEmote = (id: string, emote: Emote) => rpc("poker.emote", { id, emote });
/** 내 캐릭터 고르기 (지갑 구독으로 바뀐 값이 옴) */
export const setChar = (char: CharId) => rpc("poker.char", { char });
export const revive = () => rpc<Wallet>("poker.revive");
/** 상점: 스킨 사기 (사면 바로 입음) · 옷장: 입기 / 벗기 */
export const buySkin = (skin: SkinId) => rpc<Wallet>("poker.buy", { skin });
/** 상점: 사야 쓰는 캐릭터 사기 (사면 바로 그 캐릭터로) */
export const buyChar = (char: CharId) => rpc<Wallet>("poker.buyChar", { char });
export const wearSkin = (char: CharId, skin: SkinId | null) => rpc<Wallet>("poker.wear", { char, skin });

/** 자금 순위 (한 판이라도 친 회원, 보유금액 순) */
export const getRank = () => api<{ list: RankRow[] }>("/api/poker/rank").then((r) => r.list);
/** 구매 순위 (스킨 · 캐릭터에 쓴 칩 순) */
export const getBuyRank = () => api<{ list: BuyRankRow[] }>("/api/poker/rank-buy").then((r) => r.list);
