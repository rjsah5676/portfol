/**
 * 픽셀 글리치 디펜스 그림 · 소리 연결표 — 에셋을 받으면 여기에 한 줄 넣으면 바로 입혀짐 (없으면 도트 자리표시 그림).
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
  /** 시트 한 줄의 프레임 수 (아이콘 그릴 때 배경 크기 계산용, 기본 idle.frames) */
  cols?: number;
  /** 그림이 보는 방향 (1 = 오른쪽 · -1 = 왼쪽). 화면이 적 쪽으로 뒤집어 그림 */
  face?: 1 | -1;
  /** 공격 순간 그림 (같은 크기 · 같은 발 위치, 한 장) — 공격하면 잠깐 바꿔 그림 */
  atk?: string;
}

/** 공격 그림이 있는 유닛 (units/<id>-atk.webp, 같은 160×160 · 같은 발 위치) — 새로 받으면 여기에 id 추가 */
const ATK = new Set<string>([
  // 2026-10-13 ChatGPT 공격 그림 1차 (기사단 12) — web/scripts/defense-art/unchecker.py → slice.py → atk_fit.py
  "k_squire", "k_shield", "k_spear", "k_twin", "k_knight", "k_axe", "k_paladin", "k_blade", "k_hunter", "k_commander", "k_gale", "k_saint",
]);

/** 한 장짜리 유닛 그림 (160×160, 발은 아래 4%) — ChatGPT 이미지로 만든 도트풍 SD (2026-10-13) */
const U = (id: string, face: 1 | -1 = 1): SpriteSpec => ({
  src: `/defense/units/${id}.webp`,
  ...(ATK.has(id) ? { atk: `/defense/units/${id}-atk.webp` } : {}),
  w: 160,
  h: 160,
  anchor: [0.5, 0.96],
  idle: { row: 0, frames: 1, fps: 1 },
  face,
});

/** 유닛 id → 그림. 없는 유닛은 세력별 도트 인형으로 그림 */
export const UNIT_ART: Record<string, SpriteSpec> = {
  k_aegis: U("k_aegis"),
  m_inferno: U("m_inferno"),
  a_archmage: U("a_archmage"),
  a_bolt: U("a_bolt"),
  a_chrono: U("a_chrono"),
  a_frost: U("a_frost"),
  a_lord: U("a_lord"),
  a_plague: U("a_plague"),
  a_novice: U("a_novice"),
  a_pyro: U("a_pyro"),
  a_sage: U("a_sage"),
  a_seal: U("a_seal"),
  a_star: U("a_star"),
  a_venom: U("a_venom"),
  a_void: U("a_void"),
  a_wind: U("a_wind"),
  k_axe: U("k_axe"),
  k_blade: U("k_blade"),
  k_commander: U("k_commander"),
  k_dragoon: U("k_dragoon"),
  k_gale: U("k_gale"),
  k_hunter: U("k_hunter"),
  k_knight: U("k_knight", -1),
  k_paladin: U("k_paladin"),
  k_saint: U("k_saint"),
  k_shield: U("k_shield"),
  k_spear: U("k_spear"),
  k_squire: U("k_squire", -1),
  k_twin: U("k_twin"),
  m_arsenal: U("m_arsenal"),
  m_bolt: U("m_bolt"),
  m_coil: U("m_coil"),
  m_drone: U("m_drone"),
  m_flame: U("m_flame"),
  m_missile: U("m_missile"),
  m_mortar: U("m_mortar"),
  m_omega: U("m_omega", -1),
  m_orbit: U("m_orbit"),
  m_rail: U("m_rail"),
  m_scrap: U("m_scrap"),
  m_titan: U("m_titan"),
  m_turret: U("m_turret"),
  h_glitchpet: U("h_glitchpet"),
  h_debugger: U("h_debugger"),
};
/** 적 그림 (128×128 한 장, 발은 아래 4%) — 걸음은 화면이 통통 튀게 */
const E = (id: string, face: 1 | -1 = 1): SpriteSpec => ({
  src: `/defense/enemies/${id}.webp`,
  w: 128,
  h: 128,
  anchor: [0.5, 0.96],
  idle: { row: 0, frames: 1, fps: 1 },
  face,
});
/** 적 종류 id → 그림 */
export const ENEMY_ART: Record<string, SpriteSpec> = {
  slime: E("slime"),
  bat: E("bat"),
  bug: E("bug"),
  block: E("block"),
  skull: E("skull", -1),
  ghost: E("ghost"),
  golem: E("golem"),
  worm: E("worm"),
};
/** 보스 그림 (192×192 한 장) — 글리치에 오염된 PIXEL FIGHT 파이터 */
const BS = (id: string): SpriteSpec => ({
  src: `/defense/bosses/${id}.webp`,
  w: 192,
  h: 192,
  anchor: [0.5, 0.96],
  idle: { row: 0, frames: 1, fps: 1 },
});
/** 보스 파이터 id → 그림 (없으면 PIXEL FIGHT 얼굴) */
export const BOSS_ART: Record<string, SpriteSpec> = {
  lily: BS("lily"),
  soyoung: BS("soyoung"),
  zena: BS("zena"),
  igna: BS("igna"),
  ivan: BS("ivan"),
  kai: BS("kai"),
};
/**
 * 유물 그림 (public/defense/relics/<유물 id>.webp, 정사각 한 장). 없으면 도트 아이콘.
 * 재화 · 상자 그림 (public/defense/items/<이름>.webp): piece · core · card · chest · chest-open
 * 만든 곳: ChatGPT 이미지 (2026-10-13) — 시트를 web/scripts/defense-art/icons.py 로 잘라 128px
 */
export const RELIC_ART: Record<string, string> = Object.fromEntries(
  ["gold_gear", "first_harvest", "lucky_clover", "rift_compass", "gambler_coin", "hourglass", "alchemy", "vaccine", "pure_blood", "rainbow", "twin_star", "war_banner"].map((id) => [id, `/defense/relics/${id}.webp`])
);
export const ITEM_ART: Record<string, string> = Object.fromEntries(
  ["piece", "core", "card", "chest", "chest-open"].map((id) => [id, `/defense/items/${id}.webp`])
);

/** 필드 배경 (없으면 코드로 그린 격자) */
export const FIELD_ART: string | null = null;

/**
 * 효과음 — public/defense/sfx/<이름>.mp3 (없거나 못 불러오면 그 소리만 무음).
 * 재생은 components/Defense/audio.ts. 크기는 파일에서 미리 맞춰 둠(시끄럽지 않게), vol 은 같은 종류 안에서 미세 조정.
 * 만든 곳: ElevenLabs 효과음 (2026-10-13)
 */
export const SFX: Record<string, { src: string; vol?: number }> = {
  summon: { src: "/defense/sfx/summon.mp3" },
  merge: { src: "/defense/sfx/merge.mp3" },
  legend: { src: "/defense/sfx/legend.mp3" },
  myth: { src: "/defense/sfx/myth.mp3" },
  "gamble-ok": { src: "/defense/sfx/gamble-ok.mp3" },
  "gamble-fail": { src: "/defense/sfx/gamble-fail.mp3" },
  boss: { src: "/defense/sfx/boss.mp3" },
  "boss-down": { src: "/defense/sfx/boss-down.mp3" },
  wave: { src: "/defense/sfx/wave.mp3", vol: 0.7 },
  "hit-phys": { src: "/defense/sfx/hit-phys.mp3", vol: 0.55 },
  "hit-mech": { src: "/defense/sfx/hit-mech.mp3", vol: 0.55 },
  "hit-magic": { src: "/defense/sfx/hit-magic.mp3", vol: 0.55 },
  ult: { src: "/defense/sfx/ult.mp3", vol: 0.8 },
  die: { src: "/defense/sfx/die.mp3", vol: 0.5 },
  rift: { src: "/defense/sfx/rift.mp3" },
  mission: { src: "/defense/sfx/mission.mp3" },
  upgrade: { src: "/defense/sfx/upgrade.mp3" },
  sell: { src: "/defense/sfx/sell.mp3" },
  deny: { src: "/defense/sfx/deny.mp3" },
  "ui-click": { src: "/defense/sfx/ui-click.mp3" },
  "ui-hover": { src: "/defense/sfx/ui-hover.mp3", vol: 0.8 },
  clear: { src: "/defense/sfx/clear.mp3" },
  // 베타 (정비소): 미션 · 패스 보상 받기, 상자 열기
  reward: { src: "/defense/sfx/reward.mp3" },
  "chest-open": { src: "/defense/sfx/chest-open.mp3" },
  // v0.3: 레어 · 에픽이 소환될 때 (노말은 summon)
  spawn: { src: "/defense/sfx/spawn.mp3" },
  gameover: { src: "/defense/sfx/gameover.mp3" },
};

/**
 * 배경음 — public/defense/bgm/<이름>.mp3 (반복 재생, 크기 -20 LUFS 로 맞춰 둠). 없으면 무음.
 *  menu: 메뉴 · 로비 · 방 / wave-early: 1~29웨이브 / wave-late: 30~59웨이브 / boss: 10~50 보스 / boss-final: 60 카이
 */
export const BGM: Record<string, string> = {
  menu: "/defense/bgm/menu.mp3",
  "wave-early": "/defense/bgm/wave-early.mp3",
  "wave-late": "/defense/bgm/wave-late.mp3",
  boss: "/defense/bgm/boss.mp3",
  "boss-final": "/defense/bgm/boss-final.mp3",
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
  ]) {
    img(s.src);
    if (s.atk) img(s.atk);
  }
  if (FIELD_ART) img(FIELD_ART);
}
