/**
 * 내 격투 스킨 (산 것 · 캐릭터마다 착용한 것) — 서버 fight.skins 로 받아 두고 화면들이 같이 씀.
 * 비회원 · 아직 못 받았으면 빈 값 (기본 그림).
 */
import { useEffect, useSyncExternalStore } from "react";
import { getMySkins, wearSkin as rpcWear } from "@/realtime/fight";
import { CHARS } from "./chars";
import { skinOf } from "./skins";

export interface MySkins {
  owned: string[];
  /** 캐릭터 id → 착용한 스킨 id */
  wear: Record<string, string>;
}

let cur: MySkins = { owned: [], wear: {} };
const subs = new Set<() => void>();
const set = (v: MySkins) => {
  cur = v;
  subs.forEach((f) => f());
};

/** 서버에서 다시 받기 (사고 난 뒤 · 로그인 바뀐 뒤) */
export async function reloadMySkins() {
  const r = await getMySkins().catch(() => null);
  set(r ?? { owned: [], wear: {} });
}

/** 착용 (skin = null 이면 기본으로) */
export async function wearMySkin(chId: string, skin: string | null) {
  const r = await rpcWear(chId, skin);
  set(r);
}

/** 지금 착용한 스킨 (CHARS 순서 번호로) — 가진 것만 */
export function wornSkin(ch: number): string | null {
  const id = CHARS[ch]?.id;
  const s = id ? cur.wear[id] : undefined;
  return s && cur.owned.includes(s) && skinOf(s)?.ch === id ? s : null;
}

export function useMySkins(key?: unknown): MySkins {
  const v = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => cur,
    () => cur
  );
  useEffect(() => {
    void reloadMySkins();
  }, [key]);
  return v;
}
