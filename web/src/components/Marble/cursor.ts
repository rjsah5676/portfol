/*
 * 마우스 커서 고르기 (설정 → 커서). 16×16 도트를 2배로 그린 SVG 를 cursor: url() 로.
 * 고른 값은 이 브라우저(localStorage)에만. html[data-mbcur] 일 때 .mb 안에서만 적용 (css/marble.css).
 */

const PAL: Record<string, string> = { k: "#232a4d", w: "#ffffff", y: "#ffd84d", o: "#ff9f2e", p: "#ff9ad5", b: "#6f9bff", g: "#b8c4d6", r: "#ff6b6b", m: "#c48bff" };

const ART: Record<string, { name: string; px: string[]; hot: [number, number] }> = {
  arrow: {
    name: "픽셀 화살표",
    hot: [1, 1],
    px: ["k", "kk", "kwk", "kwwk", "kwwwk", "kwwwwk", "kwwwwwk", "kwwwwwwk", "kwwwwwwwk", "kwwwwkkkk", "kwwkwk", "kwk.kwk", "kk..kwk", "k....kwk", ".....kk"],
  },
  dice: {
    name: "주사위",
    hot: [1, 1],
    px: ["kkk", "kwk", "kkwk", "..kwkkkkkkk", "...kwwwwwwk", "...kwkwwkwk", "...kwwwwwwk", "...kwwkwwwk", "...kwwwwwwk", "...kwkwwkwk", "...kwwwwwwk", "...kkkkkkkk"],
  },
  paw: {
    name: "고양이 발",
    hot: [7, 7],
    px: ["..kk....kk", ".kppk..kppk", ".kppk..kppk", "..kk.kk.kk", "kk..kppk..kk", "kppkkppkkppk", "kppkkkkkkppk", ".kkkwwwwkkk", "..kwwwwwwk", ".kwwwppwwwk", ".kwwppppwwk", ".kwwppppwwk", "..kwwwwwwk", "...kkkkkk"],
  },
  wand: {
    name: "별 지팡이",
    hot: [3, 3],
    px: ["...k", "..kyk", "kkkyykkk", "kyyyyyyk", ".kyyyyk", "..kykyk", ".kyk.kyk", ".kk.k.kk", ".....kmk", "......kmk", ".......kmk", "........kmk", ".........kmk", "..........kk"],
  },
};

export const CURSOR_IDS = ["", ...Object.keys(ART)] as const;
export const cursorName = (id: string) => (id ? (ART[id]?.name ?? "기본") : "기본");

function svgOf(id: string): string {
  const a = ART[id];
  const s = 2;
  let rects = "";
  a.px.forEach((row, y) => [...row].forEach((ch, x) => PAL[ch] && (rects += `<rect x='${x * s}' y='${y * s}' width='${s}' height='${s}' fill='${PAL[ch]}'/>`)));
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' shape-rendering='crispEdges'>${rects}</svg>`)}") ${a.hot[0] * s} ${a.hot[1] * s}`;
}

const KEY = "mb-cursor";
export function getCursor(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
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
