/*
 * 올인 러브 — 대본 묶음. 1주차는 script-w1.ts (v3 개편: 생활 루프 · 밝은 일상 톤 · 대사 스타일 가이드)
 * 개편안: 프로젝트 claude/2026-10-23-love-v3-design.md
 */
import { W1 } from "./script-w1";
import { W2S } from "./script-w2s";
import { W3S } from "./script-w3s";
import { W4S } from "./script-w4s";
import { VA } from "./script-va";
import { VA4 } from "./script-va4";
import { VY } from "./script-vy";
import { VY4 } from "./script-vy4";
import { VG } from "./script-vg";
import { VE } from "./script-ve";
import type { Scenes } from "./types";

export const START = "d1";

export const SCENES: Scenes = { ...W1, ...W2S, ...W3S, ...W4S, ...VA, ...VA4, ...VY, ...VY4, ...VG, ...VE };
