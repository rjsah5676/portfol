/*
 * 마우스 커서 고르기 (설정 → 커서). 32×32 매끈한 SVG 를 cursor: url() 로. 처음엔 다이스 화살표.
 * 고른 값은 이 브라우저(localStorage)에만. html[data-mbcur] 일 때 .mb 안에서만 적용 (css/marble.css).
 */

const INK = "#262b52";
/** 매끈한 SVG 커서 (32×32, hot = 클릭 지점) */
const ART: Record<string, { name: string; svg: string; hot: [number, number]; /** 누를 수 있는 곳 위 */ pt?: { svg: string; hot: [number, number] } }> = {
  arrow: {
    name: "다이스 화살표",
    hot: [3, 2],
    svg: `<path d='M4 3 L4 25 L10 19.5 L14 28 L18.5 26 L14.6 17.6 L22.5 17.2 Z' fill='#ffd84d' stroke='${INK}' stroke-width='2.2' stroke-linejoin='round'/><path d='M7 8 L7 18' stroke='#fff7c2' stroke-width='2' stroke-linecap='round'/>`,
  },
  dice: {
    name: "주사위",
    hot: [3, 2],
    svg: `<path d='M3 2 L3 15 L6.5 11.8 L9 17 L11.5 16 L9.2 11 L13.8 10.7 Z' fill='#fff' stroke='${INK}' stroke-width='1.8' stroke-linejoin='round'/><rect x='13' y='13' width='16' height='16' rx='4' fill='#fff' stroke='${INK}' stroke-width='2'/><circle cx='17.5' cy='17.5' r='1.7' fill='#ff5f8f'/><circle cx='21' cy='21' r='1.7' fill='${INK}'/><circle cx='24.5' cy='24.5' r='1.7' fill='${INK}'/>`,
    pt: { hot: [9, 2], svg: `<path d='M7 2.5a2 2 0 014 0V11l1.2-.3a2 2 0 012.4 1.2l.1.5 1-.2a2 2 0 012.2 1.5V15a2 2 0 011.6 1.9V19c0 3.4-2.6 6-6 6h-2a5.2 5.2 0 01-4-1.9L2.6 17.5a2 2 0 012.9-2.7L7 16.2z' fill='#fff' stroke='${INK}' stroke-width='1.8' stroke-linejoin='round'/><rect x='17' y='17' width='13' height='13' rx='3.4' fill='#fff' stroke='${INK}' stroke-width='1.8' transform='rotate(12 23.5 23.5)'/><circle cx='21' cy='21' r='1.5' fill='#ff5f8f'/><circle cx='26' cy='26' r='1.5' fill='#ff5f8f'/>` },
  },
  paw: {
    name: "고양이 발",
    hot: [16, 16],
    svg: `<ellipse cx='16' cy='20' rx='7.5' ry='6.5' fill='#fff' stroke='${INK}' stroke-width='2'/><ellipse cx='16' cy='20.5' rx='3.6' ry='3' fill='#ff9ad5'/><circle cx='8' cy='12' r='3.4' fill='#fff' stroke='${INK}' stroke-width='2'/><circle cx='13' cy='7.5' r='3.4' fill='#fff' stroke='${INK}' stroke-width='2'/><circle cx='19' cy='7.5' r='3.4' fill='#fff' stroke='${INK}' stroke-width='2'/><circle cx='24' cy='12' r='3.4' fill='#fff' stroke='${INK}' stroke-width='2'/>`,
    // 누를 곳 위: 꾹 누르는 분홍 발바닥
    pt: { hot: [16, 16], svg: `<g transform='rotate(-14 16 18)'><ellipse cx='16' cy='20' rx='8' ry='7' fill='#ff9ad5' stroke='${INK}' stroke-width='2'/><ellipse cx='16' cy='20.5' rx='4' ry='3.3' fill='#fff' opacity='0.85'/><circle cx='7.6' cy='11.5' r='3.6' fill='#ff9ad5' stroke='${INK}' stroke-width='2'/><circle cx='12.8' cy='6.8' r='3.6' fill='#ff9ad5' stroke='${INK}' stroke-width='2'/><circle cx='19.2' cy='6.8' r='3.6' fill='#ff9ad5' stroke='${INK}' stroke-width='2'/><circle cx='24.4' cy='11.5' r='3.6' fill='#ff9ad5' stroke='${INK}' stroke-width='2'/></g>` },
  },
  wand: {
    name: "별 지팡이",
    hot: [6, 6],
    svg: `<path d='M12 12 L28 28' stroke='${INK}' stroke-width='5' stroke-linecap='round'/><path d='M12 12 L28 28' stroke='#c48bff' stroke-width='2.4' stroke-linecap='round'/><path d='M7 1.5 L8.8 5.2 L12.9 5.7 L9.9 8.5 L10.7 12.5 L7 10.5 L3.3 12.5 L4.1 8.5 L1.1 5.7 L5.2 5.2 Z' fill='#ffd84d' stroke='${INK}' stroke-width='1.6' stroke-linejoin='round'/>`,
    // 누를 곳 위: 별이 커지고 반짝
    pt: { hot: [8, 8], svg: `<path d='M14 14 L29 29' stroke='${INK}' stroke-width='5' stroke-linecap='round'/><path d='M14 14 L29 29' stroke='#c48bff' stroke-width='2.4' stroke-linecap='round'/><path d='M8.5 0.8 L10.9 5.6 L16.2 6.3 L12.3 10 L13.3 15.2 L8.5 12.7 L3.7 15.2 L4.7 10 L0.8 6.3 L6.1 5.6 Z' fill='#ffe98a' stroke='${INK}' stroke-width='1.6' stroke-linejoin='round'/><path d='M20 3 L21 5.5 L23.5 6.5 L21 7.5 L20 10 L19 7.5 L16.5 6.5 L19 5.5 Z' fill='#fff' stroke='${INK}' stroke-width='1'/><circle cx='18' cy='15' r='1.3' fill='#ff9ad5'/>` },
  },
};

/** "system" = 브라우저 기본 커서 */
export const CURSOR_IDS = [...Object.keys(ART), "system"] as const;
export const cursorName = (id: string) => (id === "system" ? "기본" : (ART[id]?.name ?? "기본"));

/** 누를 수 있는 곳 위: 금빛 가리키는 손 (모든 커서 공통) */
const POINT = `<path d='M11 3.5a2.2 2.2 0 014.4 0V13l1.3-.4a2.2 2.2 0 012.7 1.3l.2.6 1.2-.2a2.2 2.2 0 012.5 1.7l.1.6a2.2 2.2 0 011.9 2.1V22c0 4-3 7-7 7h-2.5a6 6 0 01-4.6-2.2L5.6 20.4a2.2 2.2 0 013.2-3l2.2 2.1z' fill='#ffd84d' stroke='${INK}' stroke-width='2' stroke-linejoin='round'/><path d='M13.2 5v9' stroke='#fff7c2' stroke-width='1.6' stroke-linecap='round'/>`;
const POINT_URL = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>${POINT}</svg>`)}") 13 3`;

const urlOf = (svg: string, hot: [number, number]) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>${svg}</svg>`)}") ${hot[0]} ${hot[1]}`;
function svgOf(id: string): string {
  const a = ART[id];
  return urlOf(a.svg, a.hot);
}
/** 커서마다 누를 곳 위 모양 (없으면 금빛 손) */
const pointOf = (id: string) => (ART[id]?.pt ? urlOf(ART[id].pt!.svg, ART[id].pt!.hot) : POINT_URL);

const KEY = "mb-cursor";
export function getCursor(): string {
  try {
    // 처음엔 다이스 화살표 (예전 "" = 기본 커서는 그대로 존중)
    const v = localStorage.getItem(KEY);
    return v === null ? "arrow" : v === "" ? "system" : v;
  } catch {
    return "arrow";
  }
}
export function applyCursor(id = getCursor()) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (!id || !ART[id]) {
    el.removeAttribute("data-mbcur");
    el.style.removeProperty("--mb-cur");
    return;
  }
  el.setAttribute("data-mbcur", id);
  el.style.setProperty("--mb-cur", svgOf(id));
  el.style.setProperty("--mb-cur-pt", pointOf(id));
}
export function setCursor(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* 저장소를 못 써도 이번엔 적용 */
  }
  applyCursor(id);
}
/** 미리보기용 그림 주소 */
export const cursorPreview = (id: string) => (ART[id] ? svgOf(id).replace(/\) \d+ \d+$/, ")").slice(4, -1).replace(/^"|"$/g, "") : "");
/** 누를 곳 위 모양 미리보기 */
export const cursorPointPreview = (id: string) => (ART[id] ? pointOf(id).replace(/\) \d+ \d+$/, ")").slice(4, -1).replace(/^"|"$/g, "") : "");
