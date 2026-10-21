import type { CharId, GameId, LookId } from "./assets";

/** 봇 성격 (원카드 기준) — aggro: 공격 카드 바로 던짐 / saver: 아꼈다가 위험할 때 / normal: 중간 */
export type BotStyle = "aggro" | "saver" | "normal";

export interface CharDef {
  id: CharId;
  name: string;
  /** 임시 그림 색 (그림 들어오기 전) */
  hair: string;
  body: string;
  looks: Record<LookId, { name: string; hair?: string; body?: string }>;
  lines: { atk: string[]; hit: string[]; caught: string[]; win: string[]; town: string[] };
}

// 시범 캐릭터 2명 · 코스튬 1벌씩 (이름 · 설정은 초안 확정 때 바뀔 수 있음)
export const CHARS: Record<CharId, CharDef> = {
  haru: {
    id: "haru",
    name: "하루",
    hair: "#c9d3f2",
    body: "#3b4a8c",
    looks: { base: { name: "기본" }, cos1: { name: "마법소녀 하루", hair: "#e9edf8", body: "#5b6fd0" } },
    lines: {
      atk: ["간다!", "받아~", "미안, 이건 써야겠어"],
      hit: ["으앗…", "너무해!"],
      caught: ["앗, 들켰다"],
      win: ["내가 1등!", "오늘 운 좋다~"],
      town: ["원카드 한 판 할래?", "오늘 날씨 좋다~", "심심한데 같이 놀자!"],
    },
  },
  ruru: {
    id: "ruru",
    name: "루루",
    hair: "#f6a3c2",
    body: "#c2416b",
    looks: { base: { name: "기본" }, cos1: { name: "할로윈 파티 루루", hair: "#ffd0e1", body: "#3a1530" } },
    lines: {
      atk: ["받아라~!", "공격이다!", "헤헤 미안~"],
      hit: ["힝… 또야?!", "이건 반칙이야!"],
      caught: ["어라? 깜빡했다!"],
      win: ["루루 승리~!", "역시 나지!"],
      town: ["한 판 하실래요? ㅎㅎ", "카드 치러 가자!", "오늘도 이길 거야!"],
    },
  },
};

export const CHAR_IDS = Object.keys(CHARS) as CharId[];

export interface GameDef {
  id: GameId;
  name: string;
  ic: string;
  color: string;
  open: boolean;
}

export const GAMES: GameDef[] = [
  { id: "joker", name: "조커뽑기", ic: "🃏", color: "#8a4fd0", open: false },
  { id: "onecard", name: "원카드", ic: "♠", color: "#e0446a", open: true },
  { id: "yut", name: "윷놀이", ic: "🪵", color: "#a8742f", open: false },
  { id: "chess", name: "체스", ic: "♞", color: "#3b4a6b", open: false },
  { id: "janggi", name: "장기", ic: "將", color: "#2f7a4b", open: false },
  { id: "omok", name: "오목", ic: "⚫", color: "#5a5f78", open: false },
  { id: "mahjong", name: "마작", ic: "🀄", color: "#c0392b", open: false },
  { id: "soon", name: "공사 중", ic: "🚧", color: "#c9a227", open: false },
];

/** 봇 자리: 캐릭터가 2명뿐이라 모습 · 닉네임을 바꿔 씀 */
export interface BotSeat {
  char: CharId;
  look: LookId;
  nick: string;
  style: BotStyle;
  /** 원카드 안 외칠 확률 */
  miss: number;
}
export const BOT_POOL: BotSeat[] = [
  { char: "ruru", look: "base", nick: "루루", style: "aggro", miss: 0.12 },
  { char: "haru", look: "base", nick: "하루", style: "saver", miss: 0.26 },
  { char: "ruru", look: "cos1", nick: "파티루루", style: "normal", miss: 0.18 },
  { char: "haru", look: "cos1", nick: "마법하루", style: "aggro", miss: 0.2 },
];

/** 순위별 보상 코인 (재화는 코스튬 뽑기에만 씀) */
export const REWARD = [300, 150, 80, 40] as const;

/*
 * 코스튬 뽑기 — 재화(코인)를 쓰는 곳은 여기 하나뿐.
 *  1회 300 · 10회 2,700. 코스튬 확률 3% (한 벌당 1.5%), 나머지는 「꽝 · 코인 +50」.
 *  천장: 코스튬 없이 60회 → 61회째가 아니라 60회째에 아직 없는 코스튬 확정. 코스튬이 나오면 천장 0 으로.
 *  이미 가진 코스튬이 또 나오면 코인 1,500 으로 바꿔 줌. (모든 코스튬을 가졌으면 천장 대신 1,500)
 */
export const GACHA = {
  banner: "별빛에 물든 밤",
  cost1: 300,
  cost10: 2700,
  rate: 0.03,
  pity: 60,
  lucky: 50,
  dupRefund: 1500,
  pool: [
    { char: "haru" as CharId, look: "cos1" as LookId },
    { char: "ruru" as CharId, look: "cos1" as LookId },
  ],
};

// ---- 내 정보 (지금은 이 기기에만 저장) ----
export interface Profile {
  nick: string;
  char: CharId;
  look: LookId;
  coins: number;
  owned: string[]; // "haru:cos1"
  pity: number;
}
const KEY = "tabletown-profile-v1";
export function loadProfile(): Profile {
  const def: Profile = { nick: "나", char: "haru", look: "base", coins: 1000, owned: [], pity: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...def, ...(JSON.parse(raw) as Partial<Profile>) };
  } catch {}
  return def;
}
export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}
