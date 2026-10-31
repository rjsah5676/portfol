/*
 * 니들이 한글을 알아? 그림 (GPT, public/hangul/img/*.webp) — 로딩 화면에서 전부 받은 뒤 시작.
 *   훈장님: 기본 · 감탄(명문) · 끄덕(말 됨) · 갸우뚱(억지) · 버럭(외계어 · 판 끝)
 *   먹물 괴물: 졸병 3종 + 왕먹물 (캔버스에 그림 — draw.ts)
 *   배경: 서당 책상 · 시작 화면 그림
 */

export const IMG = {
  hunjang: "/hangul/img/hunjang.webp",
  hunjangWow: "/hangul/img/hunjang-wow.webp",
  hunjangNod: "/hangul/img/hunjang-nod.webp",
  hunjangHmm: "/hangul/img/hunjang-hmm.webp",
  hunjangAngry: "/hangul/img/hunjang-angry.webp",
} as const;
export type ImgName = keyof typeof IMG;

/** 캔버스에 그릴 먹물 괴물 (졸병 3종 · 왕먹물). 없으면 draw.ts 가 예전처럼 동그라미로 */
export const INK = [
  "/hangul/img/ink-1.webp",
  "/hangul/img/ink-2.webp",
  "/hangul/img/ink-3.webp",
] as const;
export const INK_BOSS = "/hangul/img/ink-boss.webp";

const cache = new Map<string, HTMLImageElement>();
/** 받아 둔 그림 (다 받기 전이거나 없으면 null) */
export function img(src: string): HTMLImageElement | null {
  const im = cache.get(src);
  return im && im.complete && im.naturalWidth > 0 ? im : null;
}

let started: Promise<void> | null = null;
export function preloadImages(onEach?: (done: number, total: number) => void): Promise<void> {
  const all = [...Object.values(IMG), ...INK, INK_BOSS];
  let done = 0;
  onEach?.(0, all.length);
  // 두 번째 부름(개발 모드 effect 두 번 등): 이미 받는 중이면 끝날 때 한 번에 알림
  if (started) return started.then(() => onEach?.(all.length, all.length));
  started = Promise.all(
    all.map(
      (src) =>
        new Promise<void>((ok) => {
          const im = new Image();
          im.decoding = "async";
          im.onload = im.onerror = () => {
            done++;
            onEach?.(done, all.length);
            ok();
          };
          im.src = src;
          cache.set(src, im);
        })
    )
  ).then(() => undefined);
  return started;
}
