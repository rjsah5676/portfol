/**
 * 온라인 보드게임(체스·장기·오목) 한 페이지에서 쓰는 게임 정보 모음.
 * 방 시스템은 세 게임이 같은 boardRooms 를 쓰고(서버 board.*), 여기서는 게임마다 다른 이름·좌석·설정만 정리함.
 */
import * as chess from "@/firestore/chessGame";
import * as janggi from "@/firestore/janggiGame";
import * as omok from "@/firestore/omokGame";
import { RULE_LABEL } from "@/lib/omok/engine";
import { SETUPS } from "@/lib/janggi/engine";
import type { BoardRoom } from "@/firestore/boardRooms";

export type GameKey = "chess" | "janggi" | "omok";
export const GAME_KEYS: GameKey[] = ["chess", "janggi", "omok"];
export const isGameKey = (v: unknown): v is GameKey => v === "chess" || v === "janggi" || v === "omok";

export interface GameMeta {
  key: GameKey;
  name: string;
  en: string;
  /** 카드·배지에 쓰는 큰 글자 */
  glyph: string;
  accent: string;
  /** 카드 한 줄 설명 */
  blurb: string;
  /** 좌석 이름 [w, b] (w가 선수) */
  seats: [string, string];
  /** 좌석 표시 기호 [w, b] */
  seatMark: [string, string];
  seatColor: [string, string];
  /** AI 랭킹 컬렉션 */
  rankColl: "chess_ai_rankings" | "janggi_ai_rankings" | "omok_ai_rankings";
}

export const GAMES: Record<GameKey, GameMeta> = {
  chess: {
    key: "chess",
    name: "체스",
    en: "Chess",
    glyph: "♞",
    accent: "#8B84FF",
    blurb: "제한 시간·선후공, AI 레이팅 400~2400",
    seats: ["백", "흑"],
    seatMark: ["♔", "♚"],
    seatColor: ["rgba(255,255,255,0.8)", "rgba(255,255,255,0.55)"],
    rankColl: "chess_ai_rankings",
  },
  janggi: {
    key: "janggi",
    name: "장기",
    en: "Janggi",
    glyph: "將",
    accent: "#F08A8F",
    blurb: "상차림 선택, 위인 AI와 한 판",
    seats: ["초", "한"],
    seatMark: ["楚", "漢"],
    seatColor: ["#7FA8F0", "#F08A8F"],
    rankColl: "janggi_ai_rankings",
  },
  omok: {
    key: "omok",
    name: "오목",
    en: "Omok",
    glyph: "●",
    accent: "#E9C88A",
    blurb: "렌주·일반·자유룰, 15·19줄",
    seats: ["흑", "백"],
    seatMark: ["●", "○"],
    seatColor: ["rgba(255,255,255,0.8)", "rgba(255,255,255,0.55)"],
    rankColl: "omok_ai_rankings",
  },
};

/** 게임별 방 API (세 모듈 모두 boardRooms 의 같은 함수들을 게임에 묶어서 내보냄) */
export const API = { chess, janggi, omok } as const;

export type AnyRoom = BoardRoom<string>;

export const timeLabel = (r: Pick<AnyRoom, "timeMin" | "incSec">) =>
  r.timeMin === 0 ? "무제한" : `${r.timeMin}분${r.incSec ? ` + ${r.incSec}초` : ""}`;

/** 방 목록에 시간 옆에 붙는 게임별 설정 요약 */
export function variantLabel(g: GameKey, variant: string): string {
  if (g === "omok") return `${RULE_LABEL[omok.parseRule(variant)]} · ${omok.parseBoardN(variant)}줄`;
  if (g === "janggi") {
    const [w, b] = variant.split("/");
    const name = (v: string) => SETUPS.find((s) => s.v === v)?.label ?? "마상상마";
    return w && b && w !== b ? `${name(w)}/${name(b)}` : name(w || "heeh");
  }
  return "";
}

/** 초대 링크·주소 */
export const boardPath = (g: GameKey | null, extra?: Record<string, string | undefined>) => {
  const q = new URLSearchParams();
  if (g) q.set("g", g);
  for (const [k, v] of Object.entries(extra ?? {})) if (v) q.set(k, v);
  const s = q.toString();
  return `/games/board/${s ? `?${s}` : ""}`;
};
