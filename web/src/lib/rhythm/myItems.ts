/**
 * BEAT DASH 에서 산 물건 (inv.rhythm — 지금은 테마 스킨 ref) — 서버에서 받아 두고 화면들이 같이 씀.
 * 비회원 · 아직 못 받았으면 빈 목록 (무료 스킨만).
 */
import { useEffect, useSyncExternalStore } from "react";
import { getInventory } from "@/lib/api/points";
import { SKINS, type Skin } from "./fx";

let cur: string[] = [];
const subs = new Set<() => void>();
const set = (v: string[]) => {
  cur = v;
  subs.forEach((f) => f());
};

/** 서버에서 다시 받기 (산 뒤 · 로그인 바뀐 뒤) */
export async function reloadRhythmItems() {
  set(await getInventory("rhythm").catch(() => []));
}

/** 이 스킨을 쓸 수 있는지 (무료이거나 산 것) */
export function canWear(skin: Skin, owned: string[] = cur): boolean {
  const shop = SKINS.find((s) => s.key === skin)?.shop;
  return !shop || owned.includes(shop);
}

/** 산 물건 목록 — key(보통 닉네임)가 바뀌면 다시 받음 */
export function useRhythmItems(key?: unknown): string[] {
  const v = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => cur,
    () => cur
  );
  useEffect(() => {
    void reloadRhythmItems();
  }, [key]);
  return v;
}
