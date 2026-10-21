/*
 * TABLE TOWN 그림 목록 — 그림이 들어오면 여기 주소만 채우면 화면에 바로 입혀짐.
 * null 이면 코드로 그린 임시 모양(회색 박스)으로 보임.
 * 모든 그림은 게임 열기 전에 로딩 화면에서 다 받음 (진행률 막대).
 */

export type CharId = "haru" | "ruru";
export type LookId = "base" | "cos1";
export type Face = "idle" | "happy" | "sad" | "smug" | "panic" | "win";
export type GameId = "joker" | "onecard" | "yut" | "chess" | "janggi" | "omok" | "mahjong" | "soon";

const B = "/town";

export const ART: {
  logo: string | null;
  sky: string | null;
  room: string | null;
  cardBack: string | null;
  joker: string | null;
  bld: Partial<Record<GameId, string>>;
  props: { lamp: string | null; planter: string | null };
  icon: Partial<Record<UiIcon, string>>;
  /** 풀버전 일러 뒤에 붙이는 배경 — 기본 모습은 전부 이것 하나 (밋밋하게) */
  fullBg: string | null;
  /**
   * 캐릭터 · 모습별
   *  full = 풀버전 일러 (배경 없이 캐릭터만, 뒤에 fullBg 또는 bg 를 붙여 보여 줌)
   *  bg   = 이 모습 전용 배경 (코스튬용, 없으면 fullBg)
   *  sd   = 마을 · 대기실 작은 몸, face = 얼굴 동그라미, bust = 표정별 상반신
   */
  char: Partial<Record<CharId, Partial<Record<LookId, CharArt>>>>;
} = {
  logo: null,
  sky: null,
  room: null,
  cardBack: null,
  joker: null,
  bld: {},
  props: { lamp: null, planter: null },
  icon: {},
  fullBg: null,
  char: {},
};

export interface CharArt {
  full?: string;
  bg?: string;
  sd?: string;
  face?: string;
  bust?: Partial<Record<Face, string>>;
}

export type UiIcon =
  | "coin"
  | "shop"
  | "char"
  | "mission"
  | "mail"
  | "settings"
  | "chat"
  | "list"
  | "emote"
  | "sort";

/** 로딩 화면에서 받을 주소 전부 */
export function allArt(): string[] {
  const out: string[] = [];
  const push = (u: string | null | undefined) => u && out.push(u);
  push(ART.logo);
  push(ART.sky);
  push(ART.room);
  push(ART.cardBack);
  push(ART.joker);
  Object.values(ART.bld).forEach(push);
  push(ART.props.lamp);
  push(ART.props.planter);
  push(ART.fullBg);
  Object.values(ART.icon).forEach(push);
  for (const c of Object.values(ART.char))
    for (const l of Object.values(c ?? {})) {
      push(l?.full);
      push(l?.bg);
      push(l?.sd);
      push(l?.face);
      Object.values(l?.bust ?? {}).forEach(push);
    }
  return out;
}

export const artUrl = (p: string) => `${B}/${p}`;
