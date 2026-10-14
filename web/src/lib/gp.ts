"use client";

import { useSyncExternalStore } from "react";

/**
 * GP — 이 사이트의 가상 재화 (유료 모델용).
 * 아직 본 서버와 연결 전이라 이 브라우저에만 저장하고, 처음 온 사람에게 GP_START 를 줌.
 * 서버에 붙일 때는 이 파일의 읽기 · 쓰기만 바꾸면 됨 (쓰는 곳은 getGp · spendGp · useGp 만 씀)
 */
// v2: 임시로 모든 유저 GP_START 로 다시 지급 (v1 은 처음 10000 — 쓴 양과 상관없이 v2 로 새로 시작)
const KEY = "gunmo-gp-v2";
/** 처음 지급하는 GP (임시 — 본 서버에 붙이기 전까지) */
export const GP_START = 1_000_000;

const listeners = new Set<() => void>();

/** 지금 가진 GP (저장된 값이 없거나 읽을 수 없으면 처음 지급량) */
export function getGp(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return GP_START;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : GP_START;
  } catch {
    return GP_START;
  }
}

function setGp(n: number) {
  try {
    localStorage.setItem(KEY, String(Math.max(0, Math.floor(n))));
  } catch {}
  listeners.forEach((f) => f());
}

/** GP 쓰기 — 모자라면 아무것도 안 하고 false */
export function spendGp(amount: number): boolean {
  const have = getGp();
  if (!(amount > 0) || have < amount) return false;
  setGp(have - amount);
  return true;
}

function subscribe(f: () => void) {
  listeners.add(f);
  // 다른 탭에서 쓴 것도 반영
  const onStorage = (e: StorageEvent) => e.key === KEY && f();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(f);
    window.removeEventListener("storage", onStorage);
  };
}

/** 가진 GP (바뀌면 다시 그림) */
export function useGp(): number {
  return useSyncExternalStore(subscribe, getGp, () => GP_START);
}
