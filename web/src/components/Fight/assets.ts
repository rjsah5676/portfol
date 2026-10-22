/**
 * 격투 로딩 화면(GameLoader · usePreload)에 넘길 할 일 목록.
 *   menuTasks  : 처음 들어올 때 — 타이틀 · 캐릭터 선택(전신 · 얼굴 · 기술 아이콘) · 맵 작은 그림 · 등급 문장 · 효과음 · 글꼴
 *   warmTasks  : 메뉴가 뜬 뒤 뒤에서 조용히 — 맵 배경 그림 · 고른 두 캐릭터 시트 (맵 선택 · 도트 미리 보기 · 첫 판이 바로 뜨게)
 *   matchTasks : 판 시작할 때 — 두 선수 시트 · 그림 효과 · 컷인 · 얼굴(스킨) · 맵 배경 (다 받을 때까지 판은 멈춰 있음)
 * 캐릭터 시트 · 스킨은 다 합치면 15MB 넘어서 처음엔 안 받음 (휴대폰). 새 그림 · 소리를 넣으면 여기에도 추가할 것.
 */
import { CHARS } from "@/lib/fight/chars";
import { MAPS } from "@/lib/fight/maps";
import { TIERS } from "@/lib/fight/tiers";
import { loadSheet } from "@/lib/fight/sprites";
import { cutinUrl, faceUrl, look } from "@/lib/fight/skins";
import { fightSfxTasks } from "@/lib/fight/sfx";
import { keyed, type LoadTask } from "@/lib/preload";
import { fxTasks, loadBg } from "./render";

const MENU_BG = "/fight/bg/title.webp";

/** 화면에 쓰는 글꼴 (한글 글꼴은 글자 묶음별로 나뉘어 받아서, 자주 쓰는 글자로 부름) */
const FONTS = [
  '400 16px "Nanum Gothic"',
  '700 16px "Nanum Gothic"',
  '800 16px "Nanum Gothic"',
  '16px "Black Han Sans"',
  '700 16px "JetBrains Mono"',
  '800 16px "JetBrains Mono"',
];
const FONT_TEXT = "PIXEL FIGHT 캐릭터 선택 대전 모드 시작 설정 온라인 연습 튜토리얼 랭크전 상대 고르는 중 대기 랜덤 맵 승리";
const fontsReady = () => {
  try {
    return FONTS.every((f) => document.fonts.check(f, FONT_TEXT));
  } catch {
    return false;
  }
};
const fontsTask = keyed("fight:fonts", () =>
  typeof document === "undefined" || !document.fonts
    ? Promise.resolve()
    : Promise.all(FONTS.map((f) => document.fonts.load(f, FONT_TEXT).catch(() => null)))
);

const thumb = (bg: string) => bg.replace(".webp", "-thumb.webp");

/** 처음 들어올 때 (타이틀 · 모드 · 캐릭터 선택 · 맵 목록 · 온라인 대기실) — 약 2.5MB */
export function menuTasks(): LoadTask[] {
  const t: LoadTask[] = [MENU_BG];
  for (const c of CHARS) {
    t.push(`/fight/art/${c.id}.webp`, `/fight/art/${c.id}-face.webp`, `/fight/icon/${c.id}-S.webp`, `/fight/icon/${c.id}-X.webp`);
    if (c.airLabel) t.push(`/fight/icon/${c.id}-A.webp`);
  }
  for (const m of MAPS) if (m.bg) t.push(thumb(m.bg));
  for (const tr of TIERS) t.push(`/fight/tier/${tr.id}.webp`);
  t.push("/fight/tier/placement.webp");
  t.push(...fightSfxTasks());
  // 다른 페이지에서 이미 받은 글꼴이면 뺌 (다시 들어올 땐 keyed 라 바로 끝남)
  if (typeof document !== "undefined" && !fontsReady()) t.push(fontsTask);
  return t;
}

/** 메뉴가 뜬 뒤 뒤에서 (진행률 없이 · 판이 시작되면 남은 건 건너뜀 — 그래서 keyed 아님: 건너뛴 게 받은 걸로 기억되면 안 됨) — 고른 두 캐릭터 시트(약 2MB, 도트 미리 보기) + 맵 배경 5장 약 1.7MB */
export function warmTasks(c1: number, c2: number, stop: () => boolean): LoadTask[] {
  const t: (() => Promise<unknown>)[] = [];
  for (const c of [c1, c2]) if (CHARS[c]) t.push(() => loadSheet(CHARS[c].id));
  for (const m of MAPS) if (m.bg) t.push(() => loadBg(m.id, m.bg!));
  return t.map((f) => () => (stop() ? Promise.resolve() : f()));
}

/** 판 시작: 두 선수(스킨 포함) 그림 전부 + 맵 배경 */
export function matchTasks(ch: [number, number], map: number | undefined, skins: [string | null, string | null]): LoadTask[] {
  const t: LoadTask[] = [];
  const m = map === undefined ? undefined : MAPS[map];
  if (m?.bg) t.push(keyed(`fight:bg:${m.id}`, () => loadBg(m.id, m.bg!)));
  const ids: string[] = [];
  const imgs: string[] = [];
  ch.forEach((c, i) => {
    const base = CHARS[c]?.id;
    if (!base) return;
    const lk = look(c, skins[i]);
    // 스킨 시트를 못 받으면 게임이 기본 그림으로 바꾸므로 그것도
    t.push(keyed(`fight:sheet:${lk}`, () => loadSheet(lk).catch(() => loadSheet(base))));
    imgs.push(cutinUrl(c, skins[i]), faceUrl(c, skins[i]), `/fight/icon/${base}-S.webp`);
    ids.push(base, lk);
  });
  // 판 그림(시트 · 배경 · 효과)을 먼저 — 온라인 대전은 이것만 기다림 (FightGame)
  t.push(...fxTasks(ids), ...imgs);
  return t;
}
