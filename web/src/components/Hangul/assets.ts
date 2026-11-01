/*
 * 니들이 한글을 알아? 그림 (GPT, public/hangul/img/*.webp) — 로딩 화면에서 전부 받은 뒤 시작.
 *   훈장님: 기본 · 감탄(명문 · 정답) · 끄덕(말 됨 · 별해) · 갸우뚱(억지 · 포기) · 버럭(틀림)
 */

export const IMG = {
  hunjang: "/hangul/img/hunjang.webp",
  hunjangWow: "/hangul/img/hunjang-wow.webp",
  hunjangNod: "/hangul/img/hunjang-nod.webp",
  hunjangHmm: "/hangul/img/hunjang-hmm.webp",
  hunjangAngry: "/hangul/img/hunjang-angry.webp",
} as const;
export type ImgName = keyof typeof IMG;

let started: Promise<void> | null = null;
export function preloadImages(onEach?: (done: number, total: number) => void): Promise<void> {
  const all = Object.values(IMG);
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
        })
    )
  ).then(() => undefined);
  return started;
}
