import type { CharId, GameId, LookId } from "./assets";

/** 봇 성격 (원카드 기준) — aggro: 공격 카드 바로 던짐 / saver: 아꼈다가 위험할 때 / normal: 중간 */
export type BotStyle = "aggro" | "saver" | "normal";

export interface CharDef {
  id: CharId;
  name: string;
  /** 임시 그림 색 (그림 들어오기 전) */
  hair: string;
  body: string;
  looks: Record<LookId, { name: string; hair?: string; body?: string; /** 뽑기 화면 이름표 아래 한 줄 */ tag?: string; quote?: string; tags?: string[]; desc?: string }>;
  /** 캐릭터 선택 화면 소개 */
  quote: string;
  tags: string[];
  desc: string;
  lines: { atk: string[]; hit: string[]; caught: string[]; win: string[]; town: string[] };
}

// 시범 캐릭터 2명 · 코스튬 1벌씩 (이름 · 설정은 초안 확정 때 바뀔 수 있음)
export const CHARS: Record<CharId, CharDef> = {
  haru: {
    id: "haru",
    name: "하루",
    hair: "#c9d3f2",
    body: "#3b4a8c",
    quote: "「언제나, 당신과 함께하고 싶어요…♡」",
    tags: ["다정함", "밝음", "조금 수줍음"],
    desc: "모두와 함께하는 시간이 무엇보다 소중한, 따뜻하고 다정한 소녀예요.",
    looks: { base: { name: "기본 의상" }, cos1: { name: "마법소녀 하루", quote: "「조금 더… 특별한 나, 보러 와 주세요…♡」", tags: ["사랑스러움", "몽환적", "수줍음"], desc: "두근거리는 마음을 담아, 작은 마법으로 행복을 전하고 싶어요.", tag: "별빛이 비추는, 모두의 마음에", hair: "#e9edf8", body: "#5b6fd0" } },
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
    quote: "「이번 판도 루루가 이길 거야~!」",
    tags: ["장난꾸러기", "자신만만", "에너지"],
    desc: "지는 건 질색! 장난스럽지만 누구보다 게임에 진심인 소녀예요.",
    looks: { base: { name: "기본 의상" }, cos1: { name: "할로윈 파티 루루", quote: "「오늘 밤의 주인공은 루루야~♡」", tags: ["소악마", "요염함", "장난기"], desc: "트릭 오어 트릿? 과자 대신 승리를 가져갈게!", tag: "오늘 밤의 주인공은 루루야~", hair: "#ffd0e1", body: "#3a1530" } },
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
 *  천장: 코스튬 없이 100회째에 고른 픽업 코스튬 확정. 코스튬이 나오면 천장 0 으로. 코스튬은 등급 없음.
 *  이미 가진 코스튬은 다시 안 나옴 (풀에서 빠짐). 전부 모으면 이 배너는 닫힘.
 */
export const GACHA = {
  banner: "별빛에 물든 밤",
  cost1: 300,
  cost10: 2700,
  rate: 0.03,
  pity: 100,
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
  /** 끝까지 한 판 수 (레벨) */
  games?: number;
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

// ---- 뽑기 한 번 (서버 · 게스트 화면이 같이 씀) ----
export type Pull = { kind: "cos"; char: CharId; look: LookId } | { kind: "lucky" };
export interface Wallet {
  coins: number;
  owned: string[];
  pity: number;
}
export const ownKey = (c: CharId, l: LookId) => `${c}:${l}`;
/**
 * 픽업 feat 를 n 번 뽑음 (코인을 빼고 결과를 지갑에 반영). 못 뽑으면 이유 문구.
 * 고른 픽업 코스튬 하나만 나오고, 이미 가졌으면 뽑을 수 없음.
 */
export function rollGacha(w: Wallet, feat: number, n: 1 | 10, rng: () => number = Math.random): Pull[] | string {
  const p = GACHA.pool[feat];
  if (!p) return "없는 픽업이에요";
  const cost = n === 1 ? GACHA.cost1 : GACHA.cost10;
  if (w.owned.includes(ownKey(p.char, p.look))) return "이미 가진 코스튬이에요 · 다른 픽업을 골라 주세요";
  if (w.coins < cost) return "코인이 부족해요 · 게임하고 모아 와요!";
  w.coins -= cost;
  const out: Pull[] = [];
  for (let k = 0; k < n; k++) {
    if (w.owned.includes(ownKey(p.char, p.look))) {
      w.coins += GACHA.lucky;
      out.push({ kind: "lucky" });
      continue;
    }
    w.pity++;
    if (w.pity >= GACHA.pity || rng() < GACHA.rate) {
      w.pity = 0;
      w.owned.push(ownKey(p.char, p.look));
      out.push({ kind: "cos", char: p.char, look: p.look });
    } else {
      w.coins += GACHA.lucky;
      out.push({ kind: "lucky" });
    }
  }
  return out;
}
