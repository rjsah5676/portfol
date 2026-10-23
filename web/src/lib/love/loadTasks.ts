/*
 * 올인 러브 로딩 화면(GameLoader, Stage 가 씀)이 받을 것 — 스탠딩 · 의상 · 배경 · CG · 효과음 · BGM 전부.
 * 음성(1,200줄+ · 약 47MB)은 빼고 게임이 타이틀부터 뒤에서 받음 (LoveApp warmVoices).
 * 새 그림 · 소리는 assets.ts 목록에 넣으면 preloadList 로 저절로 들어옴.
 */
import type { LoadTask } from "@/lib/preload";
import { preloadList } from "./assets";

export function loveTasks(): LoadTask[] {
  const { img, audio } = preloadList();
  return [...img, ...audio];
}
