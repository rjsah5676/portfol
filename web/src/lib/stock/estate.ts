/*
 * 부동산 (마을의 돈 쓸 곳). 서버 · 화면 공용 숫자.
 *  - 임대수익 없음 · 가격 고정 · 되팔면 RESALE(90%)만 돌려받음 → 10% 가 사라짐 (돈 소모처)
 *  - 사는 이유: ① 꼴아박기 보험 (집으로 바꾼 돈은 주식으로 못 날림) ② 과시 (명패 · 이름표 · 순위)
 *  - 아파트: 1동, 호실은 끝없이 (인스턴스). 명당 단독주택: 한정 수량 · 시즌(한 달)마다 경매로 다시 나감 (경매 대금은 사라짐)
 * 회생 판정 · 총자산에는 집을 "되팔 때 받을 값"으로 합침.
 */

const EOK = 100_000_000;

export interface UnitType {
  id: "studio" | "p30" | "p60" | "ph";
  name: string;
  price: number;
  /** 층 범위 (호수 뽑을 때) */
  floors: [number, number];
  blurb: string;
}
export const UNIT_TYPES: UnitType[] = [
  { id: "studio", name: "원룸", price: 1 * EOK, floors: [2, 9], blurb: "첫 내 집. 작아도 내 거" },
  { id: "p30", name: "30평", price: 10 * EOK, floors: [10, 19], blurb: "가족이 살아도 넉넉" },
  { id: "p60", name: "60평", price: 50 * EOK, floors: [20, 29], blurb: "한강 뷰 (마을에 강은 없음)" },
  { id: "ph", name: "펜트하우스", price: 200 * EOK, floors: [30, 30], blurb: "꼭대기 층 · 입구 명패에 이름이 걸림" },
];
export const unitType = (id: string) => UNIT_TYPES.find((u) => u.id === id);
/** 되팔 때 받는 비율 */
export const RESALE = 0.9;
/** 한 사람이 가질 수 있는 호실 수 */
export const MAX_UNITS = 20;
export const resaleOf = (price: number) => Math.floor(price * RESALE);

export interface Landmark {
  id: string;
  name: string;
  /** 최소 입찰가 */
  min: number;
  /** 마을 지도에서의 자리 (village.ts 의 lot 이름) */
  lot: string;
}
/** 명당 단독주택 (한정) */
export const LANDMARKS: Landmark[] = [
  { id: "lm1", name: "언덕 위 하얀 집", min: 30 * EOK, lot: "hill" },
  { id: "lm2", name: "벚꽃길 2층 주택", min: 20 * EOK, lot: "blossom1" },
  { id: "lm3", name: "벚꽃길 다락방 집", min: 20 * EOK, lot: "blossom2" },
  { id: "lm4", name: "분수 광장 앞 저택", min: 50 * EOK, lot: "plaza" },
  { id: "lm5", name: "호숫가 통나무집", min: 15 * EOK, lot: "lake1" },
  { id: "lm6", name: "호숫가 유리 별장", min: 40 * EOK, lot: "lake2" },
  { id: "lm7", name: "시계탑 옆 붉은 벽돌집", min: 25 * EOK, lot: "clock" },
  { id: "lm8", name: "등대 아래 바다 집", min: 35 * EOK, lot: "light" },
  { id: "lm9", name: "골목 끝 한옥", min: 10 * EOK, lot: "hanok" },
  { id: "lm10", name: "거래소 맞은편 펜션", min: 10 * EOK, lot: "front" },
];
export const landmarkOf = (id: string) => LANDMARKS.find((l) => l.id === id);
/** 다음 입찰은 지금 최고가보다 이만큼(비율) 이상 */
export const BID_STEP = 0.05;
export const minNextBid = (lm: Landmark, top: number | null) => (top ? Math.ceil((top * (1 + BID_STEP)) / 1e6) * 1e6 : lm.min);

/** 시즌 = 한국 시간 달 ("2026-11") */
export const seasonOf = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(0, 7);
export function nextSeason(s: string): string {
  const [y, m] = s.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
/** 시즌이 끝나는 시각 (다음 달 1일 0시 KST) */
export function seasonEnd(s: string): number {
  const [y, m] = nextSeason(s).split("-").map(Number);
  return Date.UTC(y, m - 1, 1) - 9 * 3600_000;
}
