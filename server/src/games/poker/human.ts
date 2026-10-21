import type { Brain } from "./personas";

/*
 * 봇을 사람처럼 — 행동 · 시간 · 크기 · 말로 패가 읽히지 않게 (홀덤 · 7포커 같이 씀).
 *
 * 예전엔 센 패일수록 오래 고민하고 크게 걸고, 약한 패는 빨리 죽고 작게 걸어서 몇 판만 보면 패가 보였음.
 * 사람도 큰 결정은 오래 고민하지만, 그건 "판이 얼마나 큰가" 때문이지 "패가 센가" 때문이 아님.
 */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface ThinkCtx {
  /** 받을 돈이 있음 */
  facing: boolean;
  /** 판이나 내 칩에 비해 큰 결정 (팟의 절반쯤 · 칩의 큰 몫) */
  big: boolean;
  /** 칩 전부가 걸리는 결정 (올인 · 올인 받기) */
  huge: boolean;
  /** 프리플랍 · 7포커 4구처럼 이른 단계 */
  early: boolean;
}

/** 생각하는 시간: 패 세기 · 고른 행동과 상관없이 상황으로만 정함. 가끔 바로 누르고, 큰 결정은 가끔 오래 끎 */
export function humanThink(b: Brain, c: ThinkCtx): number {
  const r = b.rand;
  const [lo, hi] = c.huge ? [2400, 6200] : c.big ? [1700, 4600] : c.facing ? [1000, 3000] : c.early ? [700, 2100] : [900, 2700];
  // 짧은 쪽이 잦고 가끔 길게 (사람의 반응 시간처럼 오른쪽으로 꼬리가 긴 분포)
  let t = lo + (hi - lo) * Math.pow(r(), 1.5);
  // 바로 누름 (센 패 · 약한 패 상관없이)
  if (r() < 0.08) t = 420 + r() * 520;
  // 큰 결정에서 한참 고민 (블러프든 너츠든)
  else if ((c.big || c.huge) && r() < 0.15) t *= 1.35 + r() * 0.4;
  return Math.round(t * b.persona.pace);
}

/** 벳 크기(팟 대비) 메뉴에서 하나 — 밸류든 블러프든 같은 메뉴를 써서 크기로 패가 안 읽히게 */
function fromMenu(r: () => number, menu: [number, number][]): number {
  const sum = menu.reduce((a, [, w]) => a + w, 0);
  let x = r() * sum;
  for (const [f, w] of menu) {
    x -= w;
    if (x <= 0) return f;
  }
  return menu[menu.length - 1][0];
}

/**
 * 홀덤 플랍 이후 벳 크기 (팟 대비).
 * polar = 리버에서 "아주 세거나 아무것도 없을 때" 쓰는 큰 크기 — 너츠와 블러프가 같은 크기를 써서 큰 벳을 봐도 어느 쪽인지 모름.
 * 그 밖에는 보드가 젖었는지만 보고 고름 (패 세기는 안 봄).
 */
export function betFrac(b: Brain, street: number, wet: number, polar: boolean): number {
  const r = b.rand;
  let f: number;
  if (street >= 3)
    f = polar
      ? fromMenu(r, [
          [0.75, 0.3],
          [1.0, 0.4],
          [1.4, 0.3],
        ])
      : fromMenu(r, [
          [0.4, 0.45],
          [0.6, 0.55],
        ]);
  else if (street === 2)
    f = fromMenu(r, [
      [0.5, 0.25],
      [0.66, 0.45],
      [0.8, 0.3],
    ]);
  else if (wet > 0.45)
    f = fromMenu(r, [
      [0.5, 0.3],
      [0.66, 0.45],
      [0.8, 0.25],
    ]);
  else
    f = fromMenu(r, [
      [0.33, 0.5],
      [0.5, 0.3],
      [0.75, 0.2],
    ]);
  return clamp(f + (r() - 0.5) * 0.08, 0.25, 1.6);
}

/**
 * 말(대사)로 패가 읽히지 않게: "뻥이지? 콜" 같은 대사가 약한 콜에서만 나오면 그게 곧 패 정보.
 * 같은 상황의 대사끼리 섞어 줌 (센 콜에도 블러프 잡는 척, 약한 벳에도 "진짜다" 하는 척).
 */
export function mixCue<C extends string>(b: Brain, cue: C | undefined, kind: "call" | "raise" | "fold", big: boolean): C | undefined {
  const r = b.rand;
  if (!cue || cue === ("allin" as C)) return cue;
  if (kind === "call" && big) return (r() < 0.4 ? "heroCall" : "call") as C;
  if (kind === "raise") return (r() < (big ? 0.6 : 0.3) ? "bigRaise" : "raise") as C;
  if (kind === "fold" && big) return (r() < 0.5 ? "bigFold" : "fold") as C;
  return cue;
}
