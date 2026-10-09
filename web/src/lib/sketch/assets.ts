/*
 * 스케치 퀴즈 그림 에셋 (web/public/sketch/img/*.webp)
 *  요청서: 프로젝트 문서 claude/sketch-asset-request.md
 *  파일을 넣으면 READY 에 이름을 추가 → 그 자리의 SVG·CSS 대체 그림이 진짜 그림으로 바뀜.
 *  (없는 그림을 불러서 404 가 나지 않게 목록으로 관리)
 */

export type ArtName =
  | "logo"
  | "key-h"
  | "key-v"
  | `mascot-${MascotPose}`
  | `avatar-${number}`
  | `stamp-${StampName}`
  | `medal-${1 | 2 | 3}`;

export type MascotPose = "idle" | "wave" | "think" | "draw" | "cheer" | "sad" | "wow" | "sleep";
export type StampName =
  "correct" | "timeup" | "myturn" | "great" | "close" | "winner" | "skip" | "ready";

/** 들어온 그림 이름 (예: "logo", "mascot-idle", "avatar-0") */
const READY = new Set<string>([]);

export const hasArt = (name: ArtName) => READY.has(name);
export const artUrl = (name: ArtName) => `/sketch/img/${name}.webp`;

/** 아바타 수 (avatars 시트 4×2) */
export const AVATARS = 8;

/** uid → 아바타 번호 (모든 사람 화면에서 같은 사람은 같은 얼굴) */
export function avatarOf(uid: string): number {
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % AVATARS;
}

/** 아바타마다 대표 색 (이름표 · 테두리) */
export const AVATAR_COLOR = [
  "#FF9F43", // 고양이
  "#C8A27A", // 강아지
  "#F78FB3", // 토끼
  "#A47148", // 곰
  "#6BCB77", // 개구리
  "#FFC93C", // 병아리
  "#FF8FA3", // 돼지
  "#FF7A3D", // 여우
];
export const AVATAR_NAME = ["고양이", "강아지", "토끼", "곰", "개구리", "병아리", "돼지", "여우"];
