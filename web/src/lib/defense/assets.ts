/**
 * 글리치 디펜스 그림 · 소리 연결표 — 에셋을 받으면 여기에 한 줄 넣으면 바로 입혀짐 (없으면 도트 자리표시 그림).
 *
 * 파일 위치 (public/defense/…):
 *   유닛      units/<유닛 id>.webp       예) units/k_squire.webp
 *   적        enemies/<종류 id>.webp     예) enemies/slime.webp
 *   보스      bosses/<파이터 id>.webp    (없으면 PIXEL FIGHT 얼굴 그림 /fight/art/<id>-face.webp 에 글리치 효과)
 *   필드 배경  field.webp (1024×576 기준 필드 영역 608×380 에 맞춰 늘림)
 *
 * 그림 한 장 = 가로로 프레임을 이어 붙인 띠(스프라이트 시트). 프레임 하나 크기 · 수 · 속도를 SpriteSpec 으로.
 *   - 한 장짜리 그림이면 frames: 1
 *   - 유닛은 idle(서 있기) 줄 하나만 있어도 되고, attack 줄이 있으면 공격할 때 그 줄을 한 번 재생
 *   - 도트 그림이면 pixel: true (확대할 때 안 뭉개짐)
 *   - 발 위치(anchor)는 프레임 안 비율 (0.5, 0.9 = 가로 가운데 · 아래에서 10%)
 * 크기: 유닛 칸 하나 76px · 적 지름 소형 30 · 중형 38 · 대형 48 · 보스 64 (화면 기준, 그림은 2배로 그려 주면 선명)
 *
 * 에셋 요청서: web/docs/defense/ASSETS.md (필요한 목록 · 규격)
 */

export interface SpriteRow {
  /** 시트 안 줄 번호 (위에서부터 0) */
  row: number;
  frames: number;
  fps: number;
}
export interface SpriteSpec {
  src: string;
  /** 프레임 하나 크기 (그림 px) */
  w: number;
  h: number;
  anchor?: [number, number];
  pixel?: boolean;
  idle: SpriteRow;
  attack?: SpriteRow;
  /** 화면에 그릴 크기 배수 (기본 1) */
  scale?: number;
}

/** 유닛 id → 그림. 에셋을 받으면 여기에 추가 */
export const UNIT_ART: Record<string, SpriteSpec> = {
  // 예) k_squire: { src: "/defense/units/k_squire.webp", w: 64, h: 64, pixel: true, idle: { row: 0, frames: 4, fps: 6 }, attack: { row: 1, frames: 4, fps: 12 } },
};
/** 적 종류 id → 그림 */
export const ENEMY_ART: Record<string, SpriteSpec> = {};
/** 보스 파이터 id → 그림 (없으면 PIXEL FIGHT 얼굴) */
export const BOSS_ART: Record<string, SpriteSpec> = {};
/** 필드 배경 (없으면 코드로 그린 격자) */
export const FIELD_ART: string | null = null;

/** 소리 (없으면 무음) — public/defense/sfx/<이름>.mp3 */
export const SFX: Record<string, string> = {
  // summon: "/defense/sfx/summon.mp3",
};

/* ───────── 불러오기 (브라우저 전용) ───────── */

const cache = new Map<string, HTMLImageElement | null>();
/** 그림을 불러 둠. 다 불러오기 전이나 실패하면 null → 자리표시 그림 */
export function img(src: string): HTMLImageElement | null {
  const c = cache.get(src);
  if (c !== undefined) return c && c.complete && c.naturalWidth ? c : null;
  if (typeof Image === "undefined") return null;
  const el = new Image();
  el.decoding = "async";
  el.src = src;
  el.onerror = () => cache.set(src, null);
  cache.set(src, el);
  return null;
}

export const bossFace = (fighter: string) =>
  BOSS_ART[fighter]?.src ?? `/fight/art/${fighter}-face.webp`;

/** 게임 시작 전 미리 불러오기 */
export function preloadArt() {
  for (const s of [
    ...Object.values(UNIT_ART),
    ...Object.values(ENEMY_ART),
    ...Object.values(BOSS_ART),
  ])
    img(s.src);
  if (FIELD_ART) img(FIELD_ART);
}
