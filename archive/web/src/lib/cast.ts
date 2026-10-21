/*
 * 픽셀 타운 캐릭터 명부 — 다이스 타운 · 픽셀 타운 서바이버 (· 픽셀파이트 도트 시트) 가 같이 읽는 단 하나의 목록.
 * 여기엔 "누구인가"만 둠: 이름 · 별칭 · 등급 · 원래 캐릭터 · 도트 시트 · 카드 그림 · 대표색 · 공개 여부.
 * 게임마다 다른 것 (주사위 스킬 · 서바이버 무기 …) 은 각 게임 파일에서 id 로 붙임.
 *
 * 새 캐릭터 = 여기 한 줄 + public/fight/<sprite>.json(+webp) 도트 시트.
 *   그 게임 전용 키트가 아직 없으면 base(원래 캐릭터) 의 키트를 빌려 바로 합류함 (base "orig" 는 키트 필수).
 *   빠진 게 있는지는 `server/scripts/cast-check.ts`.
 * 브라우저 · 서버 공용 — "@/" import 금지.
 */

export type Grade = "R" | "SR" | "SSR" | "UR";
/** 원래 캐릭터 (픽셀파이트 격투가) — orig 는 다이스 타운 오리지널 */
export type CastBase = "kai" | "igna" | "lily" | "ivan" | "soyoung" | "zena" | "gunmo" | "orig";

export interface CastDef {
  id: string;
  name: string;
  /** 별칭 (스킨 · 직업) */
  title: string;
  grade: Grade;
  base: CastBase;
  /** 픽셀파이트 도트 시트 id (public/fight/<sprite>.json) */
  sprite: string;
  /** 카드 그림 (없으면 /fight/art/<sprite>.webp) */
  art?: string;
  color: string;
  /** 그림 승인 전이면 false (뽑기 · 도감에 안 나옴) */
  on: boolean;
}

const ROWS = [
  { id: "kai", name: "카이", title: "바람의 주먹", grade: "R", base: "kai", sprite: "kai", color: "#4a7dff", on: true },
  { id: "igna", name: "이그나", title: "불꽃 술사", grade: "R", base: "igna", sprite: "igna", color: "#ff6a3d", on: true },
  { id: "lily", name: "릴리", title: "우산 꼬마", grade: "R", base: "lily", sprite: "lily", color: "#46c9ff", on: true },
  { id: "ivan", name: "이반", title: "교관", grade: "R", base: "ivan", sprite: "ivan", color: "#8a9bb0", on: true },
  { id: "soyoung", name: "소영", title: "엄한 선생님", grade: "SR", base: "soyoung", sprite: "soyoung", color: "#c05bff", on: true },
  { id: "zena", name: "제나", title: "번개 창술사", grade: "SR", base: "zena", sprite: "zena", color: "#ffd23f", on: true },
  { id: "ivan-marine", name: "이반", title: "오도해병 이반", grade: "SR", base: "ivan", sprite: "ivan-marine", art: "/marble/art/ivan-marine.webp", color: "#d8402f", on: true },
  { id: "igna-student", name: "이그나", title: "학생 이그나", grade: "SR", base: "igna", sprite: "igna-student", art: "/marble/art/igna-student.webp", color: "#3a2f4f", on: true },
  { id: "lily-hood", name: "릴리", title: "빨간망토 릴리", grade: "SR", base: "lily", sprite: "lily-hood", art: "/marble/art/lily-hood.webp", color: "#e2394b", on: true },
  { id: "toto", name: "토토", title: "달토끼 배달부", grade: "SSR", base: "orig", sprite: "toto", art: "/marble/art/toto.webp", color: "#3d4f9a", on: true },
  { id: "mirage", name: "미라쥬", title: "꼬마 마술사", grade: "SSR", base: "orig", sprite: "mirage", art: "/marble/art/mirage.webp", color: "#7b4fd6", on: true },
  { id: "lolo", name: "롤로", title: "서커스 단장", grade: "SSR", base: "orig", sprite: "lolo", art: "/marble/art/lolo.webp", color: "#e0442f", on: true },
  { id: "mongle", name: "몽글", title: "잠꾸러기 양", grade: "SSR", base: "orig", sprite: "mongle", art: "/marble/art/mongle.webp", color: "#8fb4ff", on: true },
  { id: "ur-dice", name: "DICE", title: "주사위 요정", grade: "UR", base: "orig", sprite: "ur-dice", art: "/marble/art/ur-dice.webp", color: "#7fe0c8", on: true },
  { id: "ur-moa", name: "MOA", title: "고양이 재벌", grade: "UR", base: "orig", sprite: "ur-moa", art: "/marble/art/ur-moa.webp", color: "#e8c25a", on: true },
  { id: "ur-forte", name: "FORTE", title: "오르골 소년", grade: "UR", base: "orig", sprite: "ur-forte", art: "/marble/art/ur-forte.webp", color: "#ff9ec7", on: true },
] as const satisfies readonly CastDef[];

export type CastId = (typeof ROWS)[number]["id"];
export const CAST: readonly CastDef[] = ROWS;
export const CAST_IDS = ROWS.map((c) => c.id) as CastId[];
export const CAST_BY = Object.fromEntries(ROWS.map((c) => [c.id, c])) as Record<CastId, CastDef>;
/** 정체성 필드 (게임 정의에 펼쳐 넣기) */
export const cast = (id: CastId): CastDef => ({ ...CAST_BY[id] });
/** 키트 찾기: 자기 것 → 없으면 원래 캐릭터(base) 것 */
export const kitOf = <K>(table: Partial<Record<string, K>>, c: Pick<CastDef, "id" | "base">): K | undefined => table[c.id] ?? (c.base !== "orig" ? table[c.base] : undefined);
