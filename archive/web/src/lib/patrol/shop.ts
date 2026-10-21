/*
 * 픽셀 순찰대 GP 상점 — 재화 직구(제한 없음 · 효율 제일 나쁨)와 꾸러미(처음 한 번 · 매일 · 매주).
 *  기준 환율 (1배): 보석 100 = 600GP · 코인 1,000 = 500GP · 설계도 20 = 500GP · 무기 상자 1 = 1,200GP
 *  매일은 한국 시간 0시, 매주는 월요일 0시에 다시 (디펜스 · 마블과 같은 규칙)
 * 브라우저 · 서버 공용 — "@/" import 금지.
 */
import type { WeaponId } from "../survivor/data";
import type { GGrade } from "./gear";

export interface ShopGive {
  gems?: number;
  coins?: number;
  bp?: number;
  /** 무기 상자 티켓 (보석 대신 한 번 뽑기) */
  wt?: number;
  /** 이 무기를 바로 (이미 있으면 조각 +1) */
  weapon?: WeaponId;
  /** 이 등급 장비 하나 (칸은 무작위) */
  gear?: GGrade;
  /** 오늘 빠른 순찰 +N번 */
  quick?: number;
}
export interface ShopItem {
  id: string;
  kind: "cur" | "pack";
  name: string;
  desc: string;
  gp: number;
  give: ShopGive;
  once?: boolean;
  perDay?: number;
  perWeek?: number;
  /** 기준 환율로 따진 효율 (표시용) */
  eff?: number;
}

export const SHOP: ShopItem[] = [
  {
    id: "p_start",
    kind: "pack",
    name: "첫 순찰 꾸러미",
    desc: "한 번만 — 새 무기 금화 샷건과 시작 재화",
    gp: 1000,
    once: true,
    give: { weapon: "coins", gems: 500, wt: 3, coins: 3000, bp: 40, gear: 2 },
    eff: 10,
  },
  {
    id: "p_daily",
    kind: "pack",
    name: "일일 순찰 꾸러미",
    desc: "매일 한 번 — 보석 · 코인 · 빠른 순찰 +1",
    gp: 300,
    perDay: 1,
    give: { gems: 80, coins: 600, quick: 1 },
    eff: 2.5,
  },
  {
    id: "p_week",
    kind: "pack",
    name: "주간 보급 꾸러미",
    desc: "매주 한 번 — 보석 · 무기 상자 · 코인 · 설계도",
    gp: 1500,
    perWeek: 1,
    give: { gems: 300, wt: 2, coins: 2000, bp: 40 },
    eff: 4,
  },
  { id: "c_gems", kind: "cur", name: "보석 100", desc: "고급 상자 · 무기 상자에", gp: 600, give: { gems: 100 } },
  { id: "c_coins", kind: "cur", name: "코인 1,000", desc: "강화 · 일반 상자에", gp: 500, give: { coins: 1000 } },
  { id: "c_bp", kind: "cur", name: "설계도 20", desc: "강화 재료", gp: 500, give: { bp: 20 } },
];
export const shopItem = (id: string) => SHOP.find((x) => x.id === id);

/** 한국 시간 */
const KST = 9 * 3600_000;
const DAY = 86_400_000;
/** 주 기준일: 2026-10-12(월) 0시 KST */
const EPOCH = Date.UTC(2026, 9, 12) - KST;
export const shopDay = (t: number) => new Date(t + KST).toISOString().slice(0, 10);
export const shopWeek = (t: number) => Math.floor((t - EPOCH) / (7 * DAY));

/** 받는 것 한 줄 */
export function giveText(g: ShopGive, weaponName: (w: WeaponId) => string, gradeName: (g: GGrade) => string): string[] {
  const out: string[] = [];
  if (g.weapon) out.push(`새 무기 ${weaponName(g.weapon)}`);
  if (g.gems) out.push(`보석 ${g.gems.toLocaleString()}`);
  if (g.wt) out.push(`무기 상자 ${g.wt}`);
  if (g.coins) out.push(`코인 ${g.coins.toLocaleString()}`);
  if (g.bp) out.push(`설계도 ${g.bp}`);
  if (g.gear !== undefined) out.push(`${gradeName(g.gear)} 장비 1`);
  if (g.quick) out.push(`빠른 순찰 +${g.quick}`);
  return out;
}
