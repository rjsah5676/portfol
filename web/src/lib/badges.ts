"use client";

import { useSyncExternalStore } from "react";
import { api } from "@/lib/api/http";

/*
 * 꾸밈(배지): 관리자가 회원에게 붙여 주는 짧은 표시 (이모지 등).
 * 별명 → 꾸밈 표를 서버에서 한 번 받아 두고, 이름을 보여 주는 곳(Nick)이 별명 옆에 붙임.
 * 꾸밈이 붙은 회원은 몇 명뿐이라 표 전체를 받아도 작음. 오래 열어 둔 화면은 1분 지나면 다시 받음.
 */

const STALE_MS = 60_000;
let table: Record<string, string> = {};
let loadedAt = 0;
let loading = false;
const listeners = new Set<() => void>();

/** 표를 다시 받음 (관리자가 꾸밈을 바꾼 직후에도 부름) */
export async function refreshBadges(force = false): Promise<void> {
  if (loading || (!force && Date.now() - loadedAt < STALE_MS)) return;
  loading = true;
  try {
    table = await api<Record<string, string>>(`/api/badges${force ? `?t=${Date.now()}` : ""}`);
    listeners.forEach((f) => f());
  } catch {
    // 못 받으면 꾸밈 없이 보임
  } finally {
    loadedAt = Date.now();
    loading = false;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  refreshBadges();
  return () => {
    listeners.delete(cb);
  };
}

/** 이 별명에 붙은 꾸밈 (없으면 null) */
export function useBadge(nick: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => table[nick] ?? null,
    () => null
  );
}
