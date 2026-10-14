/**
 * 격투 스킨 — 캐릭터 그림(전신 · 얼굴 · 컷인 · 도트 시트 · 그림 효과 · 기술 소리)만 바꾸고 기술 · 판정은 그대로.
 * 파일 이름은 캐릭터 id 대신 스킨 id: public/fight/<스킨>.webp/.json · art/<스킨>(-face).webp · cutin/<스킨>.webp
 * · fx/<스킨>-<이름>-<n>.webp · sfx/<스킨>-l|i.mp3 (없는 건 캐릭터 기본 그림 · 소리).
 * 상점에서 GP로 사고(lib/points.ts SHOP · 산 것은 회원 문서 inv.fight) 보관함에서 캐릭터마다 하나씩 착용 (fightWear.<캐릭터 id>).
 */
import { CHARS } from "./chars";

export interface FightSkin {
  id: string;
  /** 어느 캐릭터의 스킨인지 (CHARS 의 id) */
  ch: string;
  name: string;
  /** 영문 부제 (상점 카드) */
  tag: string;
  desc: string;
  /** 상점 카드 강조색 */
  color: string;
}

export const FIGHT_SKINS: FightSkin[] = [
  {
    id: "igna-fw",
    ch: "igna",
    name: "불꽃놀이 이그나",
    tag: "SUMMER FESTIVAL",
    desc: "여름밤 축제의 불꽃놀이를 두른 이그나. 화염구는 폭죽 로켓, 업화주는 하늘로 솟구치는 분수 불꽃, 장판은 타닥타닥 튀는 선향 불꽃으로 바뀌어요.",
    color: "#FF8A3D",
  },
];

export const skinOf = (id?: string | null): FightSkin | null => FIGHT_SKINS.find((s) => s.id === id) ?? null;
export const skinsFor = (chId: string) => FIGHT_SKINS.filter((s) => s.ch === chId);
/** 상점 상품 id */
export const skinItem = (id: string) => `fight.skin.${id}`;

/** 그림 · 소리 파일 이름: 그 캐릭터의 스킨이면 스킨 id, 아니면 캐릭터 id */
export function look(ch: number, skin?: string | null): string {
  const id = CHARS[ch]?.id ?? "";
  const s = skinOf(skin);
  return s && s.ch === id ? s.id : id;
}
export const artUrl = (ch: number, skin?: string | null) => `/fight/art/${look(ch, skin)}.webp`;
export const faceUrl = (ch: number, skin?: string | null) => `/fight/art/${look(ch, skin)}-face.webp`;
export const cutinUrl = (ch: number, skin?: string | null) => `/fight/cutin/${look(ch, skin)}.webp`;
