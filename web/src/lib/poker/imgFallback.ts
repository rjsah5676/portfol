import { skinOf } from "./rules";

/*
 * 포커 그림을 못 받아왔을 때 (모바일 데이터 끊김 등) 깨진 그림 아이콘 대신:
 * 1) 잠깐 뒤 한 번 더 받기  2) 스킨이면 원래 캐릭터 그림  3) 같은 캐릭터의 기본 그림(앉은 대기 · 전신 · 기본 표정)
 * 4) 그래도 없으면 그 자리만 숨김.
 * 페이지 전체 img 의 error 를 한곳에서 받음 (img 마다 onError 안 달아도 됨).
 */
const CHAR_RE = /\/poker\/char\/([^/]+)\/([^/?#]+)/;

function nextSrc(src: string): string | null {
  const m = src.match(CHAR_RE);
  if (!m) return null;
  const [, dir, file] = m;
  const base = src.slice(0, src.indexOf("/poker/char/")) + "/poker/char/";
  const sk = skinOf(dir);
  // 스킨 그림 → 원래 캐릭터의 같은 그림
  if (sk) return `${base}${sk.char}/${file}`;
  // 같은 캐릭터의 기본 그림
  if (/^seat-front-(?!idle\.webp)/.test(file)) return `${base}${dir}/seat-front-idle.webp`;
  if (/^(idle|touch-\d)\.webp$/.test(file)) return `${base}${dir}/full.webp`;
  if (/^face-(?!idle\.webp)/.test(file)) return `${base}${dir}/face-idle.webp`;
  if (/^(hero-win|pose-idle|cutin)\.webp$/.test(file)) return `${base}${dir}/full.webp`;
  return null;
}

function onImgError(e: Event) {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const src = img.currentSrc || img.src;
  if (!src.includes("/poker/")) return;
  const d = img.dataset;
  // 1) 한 번 더 (잠깐 끊긴 것일 수 있음)
  if (!d.pkRetry) {
    d.pkRetry = "1";
    setTimeout(() => {
      const u = new URL(src, location.href);
      u.searchParams.set("r", String(Date.now() % 100000));
      img.src = u.toString();
    }, 700);
    return;
  }
  // 2) · 3) 대신할 그림 (주소에서 재시도 표시는 떼고)
  const clean = src.replace(/[?&]r=\d+/, "");
  const fb = nextSrc(clean);
  const tried = (d.pkTried ?? "").split("|");
  if (fb && !tried.includes(fb)) {
    d.pkTried = [...tried, fb].filter(Boolean).join("|");
    img.src = fb;
    return;
  }
  // 4) 숨김 — 깨진 그림 아이콘이 안 보이게
  d.pkHidden = "1";
  img.style.visibility = "hidden";
}

/** 받아지면 표시 · 기록 초기화 (같은 img 에 나중에 다른 그림이 들어올 때를 위해) */
function onImgLoad(e: Event) {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const d = img.dataset;
  if (!d.pkRetry && !d.pkHidden) return;
  if (d.pkHidden) img.style.visibility = "";
  delete d.pkRetry;
  delete d.pkTried;
  delete d.pkHidden;
}

let installed = false;
export function installImgFallback() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", onImgError, true);
  window.addEventListener("load", onImgLoad, true);
}
