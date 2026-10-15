import { rpc, subscribe } from "@/lib/api/socket";
import type { Action } from "@/lib/marble/engine";
import type { CharPull, ItemPull } from "@/lib/marble/gacha";
import type { MapId } from "@/lib/marble/maps";
import type { LobbyRoom, ProfileWire, RankRow, RoomWire } from "@/lib/marble/wire";

/*
 * DICE TOWN — 백엔드(server/src/games/marble)와 통신
 *  로비 · 방 구독, 방 만들기 · 바로 입장 · 들어가기 · 준비 · 설정 · 행동 · 채팅
 *  판 밖 성장: 프로필 · 가챠 · 강화 · 장착 · GP 상점 · 순위
 */

export type { LobbyRoom, ProfileWire, RankRow, RoomWire };

export interface RoomOpts {
  name?: string;
  map: MapId;
  max: number;
  quick: boolean;
  bots: boolean;
  pw?: string;
}

export const marble = {
  profile: () => rpc<ProfileWire>("marble.profile"),
  pull: (kind: "char" | "item", n: 1 | 10, ticket = false) =>
    rpc<{ got: (CharPull | ItemPull)[]; profile: ProfileWire }>("marble.pull", { kind, n, ticket }),
  charUp: (id: string) => rpc<ProfileWire>("marble.charUp", { id }),
  itemUp: (id: string) => rpc<ProfileWire>("marble.itemUp", { id }),
  equip: (o: { char?: string; dice?: string | null; buddy?: string | null }) => rpc<ProfileWire>("marble.equip", o),
  buy: (id: string) => rpc<ProfileWire>("marble.buy", { id }),
  rank: () => rpc<RankRow[]>("marble.rank"),

  create: (o: RoomOpts) => rpc<{ id: string }>("marble.create", o),
  quick: (o: { map?: MapId; max?: number } = {}) => rpc<{ id: string }>("marble.quick", o),
  join: (id: string, pw?: string) => rpc<{ id: string }>("marble.join", { id, ...(pw && { pw }) }),
  leave: (id: string) => rpc("marble.leave", { id }),
  ready: (id: string, ready: boolean) => rpc("marble.ready", { id, ready }),
  opts: (id: string, o: { map?: MapId; max?: number; quick?: boolean; bots?: boolean; kick?: number; kickBot?: number; addBot?: boolean }) => rpc("marble.opts", { id, ...o }),
  act: (id: string, a: Action) => rpc<{ seq: number }>("marble.act", { id, a }),
  auto: (id: string, on: boolean) => rpc("marble.auto", { id, on }),
  ladder: (id: string, col: number) => rpc("marble.ladder", { id, col }),
  chat: (id: string, text: string) => rpc("marble.chat", { id, text }),
  mine: () => rpc<{ id: string; name: string } | null>("marble.mine"),
};

export function watchLobby(cb: (rooms: LobbyRoom[]) => void) {
  return subscribe<LobbyRoom[]>("marble.lobby", {}, {
    onSnapshot: cb,
    onEvent: (t, d) => {
      if (t === "list") cb(d as LobbyRoom[]);
    },
  });
}

/** 방 구독 — onRoom 은 첫 데이터(연출 없음)와 바뀔 때마다. onGone: 방이 닫힘 */
export function watchRoom(id: string, onRoom: (r: RoomWire) => void, onGone: () => void) {
  return subscribe<RoomWire>("marble.room", { id }, {
    onSnapshot: onRoom,
    onEvent: (t, d) => {
      if (t === "room") onRoom(d as RoomWire);
    },
    onError: onGone,
  });
}
