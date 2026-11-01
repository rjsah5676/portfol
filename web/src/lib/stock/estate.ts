/*
 * 부동산 (마을의 돈 쓸 곳). 서버 · 화면 공용 숫자.
 *  - 가격 고정 · 되팔면 RESALE(50%)만 돌려받음 → 절반이 사라짐 (돈 소모처)
 *  - 집이 있으면 하루 첫 접속 때 출석 보너스: 가진 집값 합 × DAILY (0.2%) → 되팔기 손해 50% 를 메우려면 250일
 *  - 사는 이유: ① 꼴아박기 보험 (집으로 바꾼 돈은 주식으로 못 날림) ② 과시 (명패 · 이름표 · 순위 · 집 구경) ③ 출석 보너스
 *  - 아파트형(apt): 호수 분양, 끝없이. 단독형(house): 마을에 실제로 서 있는 한정 집, 선착순 고정가 (경매 없음)
 * 회생 판정 · 총자산에는 집을 "되팔 때 받을 값"으로 합침.
 */

const MAN = 10_000;
const EOK = 100_000_000;

export type HomeKind = "apt" | "house";
export interface HomeType {
  id: string;
  name: string;
  kind: HomeKind;
  price: number;
  /** 아파트형: 층 범위 (호수 뽑을 때) · 단독형: 없음 */
  floors?: [number, number];
  /** 단독형: 마을의 자리 (village.ts LOTS 의 이름) — 자리 수 = 한정 수량 */
  lots?: string[];
  blurb: string;
  /** 집 안 화면 배경 (아트가 들어오면 그림으로) */
  tone: string;
}

/** 10단계 (GTA 식 — 싼 것부터) */
export const HOME_TYPES: HomeType[] = [
  { id: "gosiwon", name: "고시원", kind: "apt", price: 1_000 * MAN, floors: [1, 1], blurb: "창문은 없지만 내 방", tone: "#2b2a33" },
  { id: "studio", name: "원룸", kind: "apt", price: 5_000 * MAN, floors: [2, 6], blurb: "첫 내 집. 작아도 내 거", tone: "#2f3542" },
  { id: "officetel", name: "오피스텔", kind: "apt", price: 2 * EOK, floors: [7, 12], blurb: "거래소까지 걸어서 3분", tone: "#2a3a4f" },
  { id: "p24", name: "24평 아파트", kind: "apt", price: 5 * EOK, floors: [10, 19], blurb: "방 둘, 거실 하나", tone: "#33415a" },
  { id: "p34", name: "34평 아파트", kind: "apt", price: 15 * EOK, floors: [10, 24], blurb: "국민 평형", tone: "#3a4a63" },
  { id: "p50", name: "50평 아파트", kind: "apt", price: 40 * EOK, floors: [20, 29], blurb: "한강 뷰 (마을에 강은 없음)", tone: "#3d4f6d" },
  { id: "duplex", name: "복층 펜트하우스", kind: "apt", price: 100 * EOK, floors: [30, 34], blurb: "2층짜리 꼭대기", tone: "#4a4466" },
  { id: "tower", name: "타워 펜트하우스", kind: "apt", price: 300 * EOK, floors: [35, 35], blurb: "최고층 · 입구 명패에 이름이 걸림", tone: "#5a4a6e" },
  {
    id: "mansion",
    name: "단독 저택",
    kind: "house",
    price: 1_000 * EOK,
    lots: ["blossom1", "blossom2", "plaza", "lake1", "lake2", "clock", "light", "hanok", "front"],
    blurb: "마을 큰길에 진짜로 서 있는 집 · 9채 한정",
    tone: "#5c4a3a",
  },
  { id: "hill", name: "언덕 위 대저택", kind: "house", price: 5_000 * EOK, lots: ["hill"], blurb: "마을 전체가 내려다보임 · 단 1채", tone: "#6a4f3a" },
];
export const homeType = (id: string) => HOME_TYPES.find((u) => u.id === id);
/** 단독형 자리 이름 → 집 종류 */
export const lotHome = (lot: string) => HOME_TYPES.find((t) => t.lots?.includes(lot));
/** 자리마다 이름 (마을 지도 · 이름표) */
export const LOT_NAMES: Record<string, string> = {
  hill: "언덕 위 대저택",
  blossom1: "벚꽃길 1호",
  blossom2: "벚꽃길 2호",
  plaza: "분수 광장 앞",
  lake1: "호숫가 1호",
  lake2: "호숫가 2호",
  clock: "시계탑 옆",
  light: "등대 아래",
  hanok: "골목 끝 한옥",
  front: "거래소 맞은편",
};

/** 되팔 때 받는 비율 */
export const RESALE = 0.5;
/** 출석 보너스: 하루 한 번, 가진 집값 합의 이 비율 */
export const DAILY = 0.002;
/** 한 사람이 가질 수 있는 집 수 */
export const MAX_UNITS = 20;
export const resaleOf = (price: number) => Math.floor(price * RESALE);
export const dailyOf = (price: number) => Math.floor(price * DAILY);
/** 집 등급 (높을수록 좋은 집) */
export const homeRank = (id: string) => HOME_TYPES.findIndex((t) => t.id === id);
