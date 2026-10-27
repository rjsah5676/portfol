/*
 * 올인 러브 — 대본 묶음. 1주차는 script-w1.ts (v3 개편: 생활 루프 · 밝은 일상 톤 · 대사 스타일 가이드)
 * 개편안: 프로젝트 claude/2026-10-23-love-v3-design.md
 */
import { W1 } from "./script-w1";
import { W2 } from "./script-w2";
import { W2S } from "./script-w2s";
import { W3A } from "./script-w3a";
import { W3N } from "./script-w3n";
import { W3Y } from "./script-w3y";
import type { Scenes } from "./types";

export const START = "d1";

export const SCENES: Scenes = { ...W1, ...W2, ...W2S, ...W3A, ...W3Y, ...W3N };
