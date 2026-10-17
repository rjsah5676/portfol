/*
 * 픽셀 타운 서바이버 그림 — 캐릭터는 다이스 타운 도트 시트를 작게 줄여 쓰고,
 * 몹 · 아이템은 에셋이 오기 전까지 코드로 찍은 도트(자동 외곽선)로 그림.
 * 에셋이 생기면 ENEMY_IMG 등에 파일 경로만 채우면 그쪽을 씀.
 */
import { STAGES, STAGE_IDS, type EnemyKind, type PickupKind, type StageDef, type StageId, type ThingKind } from "@/lib/survivor/data";

export type Cv = HTMLCanvasElement;

function cv(w: number, h: number): Cv {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/* ───────────── 도트 찍기 도구 ───────────── */

type Grid = (string | null)[][];
const OUT = "#170f2e";

function grid(w: number, h: number): Grid {
  return Array.from({ length: h }, () => Array<string | null>(w).fill(null));
}
function put(g: Grid, x: number, y: number, c: string | null) {
  x = Math.round(x);
  y = Math.round(y);
  if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = c;
}
function ell(g: Grid, cx: number, cy: number, rx: number, ry: number, c: string, onlyBelow?: number) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1 && (onlyBelow === undefined || y <= onlyBelow)) put(g, x, y, c);
    }
}
function rect(g: Grid, x: number, y: number, w: number, h: number, c: string) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(g, x + i, y + j, c);
}
/** 바깥쪽 1px 외곽선 */
function outline(g: Grid, c = OUT) {
  const h = g.length;
  const w = g[0].length;
  const add: [number, number][] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (g[y][x]) continue;
      if ((x > 0 && g[y][x - 1]) || (x < w - 1 && g[y][x + 1]) || (y > 0 && g[y - 1][x]) || (y < h - 1 && g[y + 1][x])) add.push([x, y]);
    }
  for (const [x, y] of add) g[y][x] = c;
}
function toCanvas(g: Grid, tint?: string): Cv {
  const c = cv(g[0].length, g.length);
  const x = c.getContext("2d")!;
  for (let j = 0; j < g.length; j++)
    for (let i = 0; i < g[0].length; i++) {
      const col = g[j][i];
      if (!col) continue;
      x.fillStyle = tint ?? col;
      x.fillRect(i, j, 1, 1);
    }
  return c;
}

/* ───────────── 몹 ───────────── */

export interface MobArt {
  /** 걷기 2칸 (오른쪽 보기) */
  f: Cv[];
  /** 맞았을 때 하얀 그림 */
  w: Cv[];
  /** 발 위치 (그림 아래 가운데에서 위로) */
  foot: number;
}

function mob(draw: (g: Grid, k: number) => void, w: number, h: number): MobArt {
  const f: Cv[] = [];
  const wt: Cv[] = [];
  for (let k = 0; k < 2; k++) {
    const g = grid(w + 2, h + 2);
    draw(g, k);
    outline(g);
    f.push(toCanvas(g));
    wt.push(toCanvas(g, "#ffffff"));
  }
  return { f, w: wt, foot: 1 };
}

const eyes = (g: Grid, x: number, y: number, gap: number, c = "#ff3d6e") => {
  put(g, x, y, c);
  put(g, x + gap, y, c);
};

const DRAW: Record<EnemyKind, () => MobArt> = {
  bat: () =>
    mob(
      (g, k) => {
        // 날개 위아래
        const wy = k ? 7 : 3;
        for (let i = 0; i < 6; i++) {
          rect(g, 1 + i, wy + Math.abs(i - 2) * (k ? -0.6 : 0.6), 1, 3, "#4a2a7a");
          rect(g, 15 - i, wy + Math.abs(i - 2) * (k ? -0.6 : 0.6), 1, 3, "#4a2a7a");
        }
        ell(g, 8.5, 6.5, 3.6, 3.4, "#7c4fc4");
        put(g, 6, 2, "#7c4fc4");
        put(g, 11, 2, "#7c4fc4");
        eyes(g, 7, 6, 3);
        put(g, 8, 8, "#ffffff");
      },
      16,
      11
    ),
  slime: () =>
    mob(
      (g, k) => {
        const sq = k ? 1 : 0;
        ell(g, 8, 9 + sq * 0.5, 7 + sq * 0.6, 6 - sq, "#4fd8a0");
        ell(g, 8, 11, 6, 3, "#2fb07c");
        put(g, 5, 6 + sq, "#c8ffe8");
        put(g, 6, 5 + sq, "#c8ffe8");
        eyes(g, 6, 9, 4, "#16302a");
      },
      16,
      15
    ),
  ghost: () =>
    mob(
      (g, k) => {
        ell(g, 7.5, 7, 6, 6.2, "#dcd6ff");
        rect(g, 2, 7, 12, 6, "#dcd6ff");
        for (let i = 0; i < 12; i += 3) rect(g, 2 + i + (k ? 1 : 0), 13, 2, 1, "#dcd6ff");
        rect(g, 5, 6, 2, 3, "#2b2350");
        rect(g, 9, 6, 2, 3, "#2b2350");
        rect(g, 7, 10, 2, 1, "#8f7fe0");
      },
      15,
      15
    ),
  skull: () =>
    mob(
      (g, k) => {
        ell(g, 7.5, 5.5, 5.5, 5, "#f2ecdc");
        rect(g, 4, 9, 8, 2, "#f2ecdc");
        rect(g, 5, 4, 2, 3, "#2a1f40");
        rect(g, 9, 4, 2, 3, "#2a1f40");
        put(g, 5, 5, "#ff3d6e");
        put(g, 10, 5, "#ff3d6e");
        rect(g, 6, 9, 1, 1, "#2a1f40");
        rect(g, 8, 9, 1, 1, "#2a1f40");
        rect(g, 5, 12, 6, 3, "#c9c0a8");
        rect(g, k ? 5 : 6, 15, 2, 2, "#c9c0a8");
        rect(g, k ? 9 : 8, 15, 2, 2, "#c9c0a8");
      },
      15,
      17
    ),
  mush: () =>
    mob(
      (g, k) => {
        ell(g, 8.5, 6, 8, 5.5, "#e2405e", 7);
        put(g, 5, 3, "#fff");
        rect(g, 10, 2, 2, 2, "#fff");
        put(g, 13, 5, "#fff");
        rect(g, 5, 8, 7, 6, "#f6e2c0");
        eyes(g, 6, 10, 4, "#2a1f40");
        rect(g, k ? 5 : 6, 14, 2, 2, "#d9c09a");
        rect(g, k ? 10 : 9, 14, 2, 2, "#d9c09a");
      },
      17,
      16
    ),
  golem: () =>
    mob(
      (g, k) => {
        rect(g, 5, 2, 12, 9, "#7d8aa6");
        rect(g, 3, 10, 16, 9, "#6a7690");
        rect(g, 7, 5, 2, 2, "#5ff6ff");
        rect(g, 13, 5, 2, 2, "#5ff6ff");
        rect(g, k ? 0 : 1, 11, 3, 7, "#58627a");
        rect(g, k ? 20 : 19, 11, 3, 7, "#58627a");
        rect(g, 5, 19, 4, 3, "#58627a");
        rect(g, 13, 19, 4, 3, "#58627a");
        rect(g, 8, 13, 6, 1, "#4b5470");
        put(g, 6, 3, "#a8b4cc");
        put(g, 7, 3, "#a8b4cc");
      },
      23,
      22
    ),
  boss_jelly: () =>
    mob(
      (g, k) => {
        const sq = k ? 1.5 : 0;
        ell(g, 20, 22 + sq * 0.4, 18 + sq, 14 - sq, "#ff6fb5");
        ell(g, 20, 28, 15, 6, "#d94e94");
        ell(g, 12, 16 + sq, 3, 2, "#ffd6ec");
        rect(g, 14, 20, 3, 4, "#3a1030");
        rect(g, 24, 20, 3, 4, "#3a1030");
        rect(g, 18, 27, 5, 1, "#3a1030");
        // 왕관
        const cy = 6 + sq;
        rect(g, 13, cy + 3, 15, 4, "#ffd23a");
        for (const x of [13, 19, 25]) rect(g, x, cy, 3, 3, "#ffd23a");
        put(g, 20, cy + 4, "#ff3d6e");
        put(g, 15, cy + 4, "#5fd0ff");
        put(g, 25, cy + 4, "#5fd0ff");
      },
      40,
      36
    ),
  boss_clock: () =>
    mob(
      (g, k) => {
        // 시계탑 몸통
        rect(g, 8, 10, 24, 30, "#4a3368");
        rect(g, 6, 6, 28, 5, "#2d1f48");
        rect(g, 12, 1, 16, 6, "#2d1f48");
        rect(g, 18, 0, 4, 2, "#ffd23a");
        // 시계 얼굴
        ell(g, 20, 20, 8, 8, "#fff6d8");
        ell(g, 20, 20, 6.5, 6.5, "#fff9e8");
        rect(g, 20, 14, 1, 7, "#2a1f40");
        rect(g, 20, 20, 5, 1, "#2a1f40");
        put(g, 20, 20, "#ff3d6e");
        // 빛나는 눈
        rect(g, 11, 31, 4, 2, "#c58bff");
        rect(g, 25, 31, 4, 2, "#c58bff");
        // 팔 · 다리
        rect(g, k ? 2 : 3, 22, 5, 10, "#3a2858");
        rect(g, k ? 33 : 32, 22, 5, 10, "#3a2858");
        rect(g, 11, 40, 6, 5, "#3a2858");
        rect(g, 23, 40, 6, 5, "#3a2858");
      },
      40,
      46
    ),
  // 시계탑 광장 (파일 그림이 없을 때 대신)
  mouse: () =>
    mob(
      (g, k) => {
        ell(g, 7, 6, 6, 3.5, "#a7b0c8");
        ell(g, 12, 5, 3, 2.6, "#c8d0e4");
        put(g, 13, 4, "#ff3d6e");
        rect(g, 4, 1, 3, 2, "#ffd23a");
        rect(g, 5, 0, 1, 1, "#ffd23a");
        rect(g, k ? 3 : 4, 9, 2, 1, "#6b7390");
        rect(g, k ? 9 : 8, 9, 2, 1, "#6b7390");
      },
      15,
      10
    ),
  tin: () =>
    mob(
      (g, k) => {
        rect(g, 5, 0, 6, 4, "#2a2a4a");
        rect(g, 5, 4, 6, 4, "#f2d0a8");
        put(g, 6, 5, "#2a1f40");
        put(g, 9, 5, "#2a1f40");
        rect(g, 4, 8, 8, 6, "#d94a4a");
        rect(g, 4, 11, 8, 1, "#ffd23a");
        rect(g, 12, 4, 1, 10, "#c8c8d8");
        rect(g, k ? 4 : 5, 14, 3, 3, "#3a3a5a");
        rect(g, k ? 9 : 8, 14, 3, 3, "#3a3a5a");
      },
      14,
      17
    ),
  cuckoo: () =>
    mob(
      (g, k) => {
        ell(g, 7, 7, 5, 4.5, "#9a6a3a");
        ell(g, 10, 4, 3, 3, "#b98450");
        rect(g, 13, 4, 2, 1, "#ffb03a");
        put(g, 11, 3, "#2a1f40");
        rect(g, 1, k ? 3 : 7, 5, 2, "#6a4628");
        rect(g, 3, 11, 1, 3, "#c8c8d8");
      },
      15,
      14
    ),
  gear: () =>
    mob(
      (g, k) => {
        ell(g, 9, 9, 8, 8, "#b58a3a");
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + (k ? 0.39 : 0);
          rect(g, 8 + Math.round(Math.cos(a) * 8), 8 + Math.round(Math.sin(a) * 8), 2, 2, "#8a6420");
        }
        ell(g, 9, 9, 3, 3, "#5a3e14");
        rect(g, 6, 7, 2, 2, "#ff3d6e");
        rect(g, 11, 7, 2, 2, "#ff3d6e");
      },
      19,
      19
    ),
  hourglass: () =>
    mob(
      (g, k) => {
        rect(g, 3, 0, 18, 3, "#7a5530");
        rect(g, 3, 21, 18, 3, "#7a5530");
        for (let y = 3; y < 21; y++) {
          const half = Math.round(Math.abs(y - 12) * 0.7) + 1;
          rect(g, 12 - half, y, half * 2, 1, "#cfe6ff");
          if (y > 12 + (k ? 0 : 1)) rect(g, 12 - half + 1, y, Math.max(0, half * 2 - 2), 1, "#ffd27a");
        }
        rect(g, 0, 8, 3, 8, "#7a5530");
        rect(g, 21, 8, 3, 8, "#7a5530");
        put(g, 9, 6, "#ff3d6e");
        put(g, 14, 6, "#ff3d6e");
      },
      24,
      24
    ),
  boss_cuckoo: () =>
    mob(
      (g, k) => {
        rect(g, 4, 10, 32, 26, "#6a4628");
        rect(g, 2, 6, 36, 5, "#4a2e18");
        rect(g, 10, 14, 20, 16, "#2a1a10");
        ell(g, 20, 21 - (k ? 2 : 0), 8, 7, "#c48a50");
        ell(g, 24, 18 - (k ? 2 : 0), 4, 4, "#e0a868");
        rect(g, 28, 18 - (k ? 2 : 0), 5, 2, "#ffb03a");
        put(g, 25, 17 - (k ? 2 : 0), "#ff3d6e");
        rect(g, 14, 3, 12, 4, "#ffd23a");
        rect(g, 8, 36, 4, 4, "#4a2e18");
        rect(g, 28, 36, 4, 4, "#4a2e18");
      },
      40,
      40
    ),
  boss_tower: () =>
    mob(
      (g, k) => {
        ell(g, 22, 22, 20, 20, "#7a5530");
        ell(g, 22, 22, 17, 17, "#fff6d8");
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          put(g, 22 + Math.round(Math.cos(a) * 15), 22 + Math.round(Math.sin(a) * 15), "#2a1f40");
        }
        rect(g, 22, 8, 1, 14, "#2a1f40");
        rect(g, 22, 22, k ? 10 : 8, 1, "#2a1f40");
        rect(g, 13, 17, 4, 2, "#ff3d6e");
        rect(g, 27, 17, 4, 2, "#ff3d6e");
        rect(g, 18, 0, 8, 3, "#ffd23a");
      },
      44,
      44
    ),
};

/* ───────────── 줍는 것 · 가로등 ───────────── */

function small(draw: (g: Grid) => void, w: number, h: number): Cv {
  const g = grid(w + 2, h + 2);
  draw(g);
  outline(g);
  return toCanvas(g);
}

function gemArt(c: string, light: string): Cv {
  return small(
    (g) => {
      for (let y = 0; y < 7; y++) {
        const half = y < 3 ? y : 6 - y;
        rect(g, 3 - half, y + 1, half * 2 + 1, 1, c);
      }
      put(g, 2, 3, light);
      put(g, 3, 2, light);
    },
    6,
    8
  );
}

export interface Art {
  mobs: Record<EnemyKind, MobArt>;
  gems: Cv[];
  pick: Record<PickupKind, Cv>;
  lamp: Cv;
  umbrella: Cv;
  parcel: Cv;
  shuriken: Cv;
  boomerang: Cv;
  tiles: Cv;
  /** 맵마다 바닥 (public/survivor/<ground>.png) */
  stageTiles: Partial<Record<StageId, Cv>>;
  /** 맵 장식 (파일 받으면 채워짐) */
  deco: Record<string, Cv>;
  /** 맵 오브젝트 (성소 · 상인 …) */
  things: Record<ThingKind, Cv>;
  /** 진화 무기 투사체 (파일 있을 때만 — public/survivor/item/p_<이름>.png) */
  proj: Partial<Record<ProjName, Cv>>;
}
export type ProjName = "gale" | "cyclone" | "barrage" | "rainbow" | "rose" | "spark";
const PROJ: ProjName[] = ["gale", "cyclone", "barrage", "rainbow", "rose", "spark"];

/* ───────────── 맵 장식 (밟고 지나가는 그림, 부딪히지 않음) ───────────── */

/** 모든 맵 장식 이름 (파일 받기용) */
const DECO_KEYS = [...new Set(STAGE_IDS.flatMap((id) => STAGES[id].deco.map((d) => d.k)))];
/** 장식 목록별 가중치 합 (챕터는 맵과 다른 장식을 씀) */
const decoSum = new WeakMap<StageDef["deco"], number>();
const sumOf = (list: StageDef["deco"]) => {
  let v = decoSum.get(list);
  if (v === undefined) decoSum.set(list, (v = list.reduce((a, d) => a + d.w, 0)));
  return v;
};
export const DECO_CELL = 150;
/** 칸 (cx, cy) 의 장식 (없으면 null) — 위치가 늘 같게 해시로 · 맵마다 장식이 다름 */
export function decoAt(list: StageDef["deco"], cx: number, cy: number): { k: string; x: number; y: number; light?: boolean } | null {
  if (Math.abs(cx) <= 1 && Math.abs(cy) <= 1) return null;
  const h = hash(cx * 7 + 3, cy * 13 + 5);
  if (h > 0.42) return null;
  let x = hash(cx + 101, cy - 37) * sumOf(list);
  let d = list[0];
  for (const e of list) {
    x -= e.w;
    if (x <= 0) {
      d = e;
      break;
    }
  }
  return { k: d.k, x: cx * DECO_CELL + 20 + hash(cx - 7, cy + 77) * (DECO_CELL - 40), y: cy * DECO_CELL + 20 + hash(cx + 55, cy + 3) * (DECO_CELL - 40), light: d.light };
}

/** 맵 바닥 — 파일이 없으면 골목 바닥을 그 맵 색으로 물들여서 */
const tintCache = new Map<string, Cv>();
export function tilesFor(stage: StageId): Cv {
  const a = getArt();
  const own = a.stageTiles[stage];
  if (own) return own;
  const st = STAGES[stage];
  if (!st.tint) return a.tiles;
  const key = `${stage}:${a.tiles.width}`;
  let c = tintCache.get(key);
  if (!c) {
    c = cv(a.tiles.width, a.tiles.height);
    const x = c.getContext("2d")!;
    x.drawImage(a.tiles, 0, 0);
    x.globalCompositeOperation = "color";
    x.globalAlpha = 0.45;
    x.fillStyle = st.tint;
    x.fillRect(0, 0, c.width, c.height);
    tintCache.set(key, c);
  }
  return c;
}

/* ───────────── 파일 에셋 (있으면 코드 도트 대신) ───────────── */

/** public/survivor/mob/<kind>.png — 걷기 2칸 가로 띠 (칸 너비 = 그림 너비 / 2) */
export const MOB_FILE: Partial<Record<EnemyKind, string>> = Object.fromEntries((["bat", "slime", "ghost", "skull", "mush", "golem", "boss_jelly", "boss_clock", "mouse", "tin", "cuckoo", "gear", "hourglass", "boss_cuckoo", "boss_tower"] as const).map((k) => [k, `/survivor/mob/${k}.png`]));
/** public/survivor/item/<name>.png */
export const ITEM_FILE: Record<string, string> = Object.fromEntries(["gem0", "gem1", "gem2", "gem3", "coin", "bag", "meat", "magnet", "bomb", "chest", "lamp", "parcel", "umbrella", "shuriken", "boomerang"].map((k) => [k, `/survivor/item/${k}.png`]));

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
}
function whiteOf(c: Cv): Cv {
  const w = cv(c.width, c.height);
  const x = w.getContext("2d")!;
  x.drawImage(c, 0, 0);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, w.width, w.height);
  return w;
}
function cut(im: HTMLImageElement, sx: number, sw: number): Cv {
  const c = cv(sw, im.height);
  c.getContext("2d")!.drawImage(im, sx, 0, sw, im.height, 0, 0, sw, im.height);
  return c;
}
let fileLoad: Promise<void> | null = null;
/** 파일 에셋 미리 받기 (받는 대로 코드 도트를 갈아 끼움) */
export function loadFiles(): Promise<void> {
  if (fileLoad) return fileLoad;
  const a = getArt();
  const jobs: Promise<void>[] = [];
  for (const k of Object.keys(MOB_FILE) as EnemyKind[])
    jobs.push(
      loadImg(MOB_FILE[k]!).then((im) => {
        if (!im) return;
        const fw = Math.floor(im.width / 2);
        const f = [cut(im, 0, fw), cut(im, fw, fw)];
        a.mobs[k] = { f, w: f.map(whiteOf), foot: 1 };
      })
    );
  for (const [name, src] of Object.entries(ITEM_FILE))
    jobs.push(
      loadImg(src).then((im) => {
        if (!im) return;
        const c = cut(im, 0, im.width);
        if (name.startsWith("gem")) a.gems[Number(name.slice(3))] = c;
        else if (name in a.pick) a.pick[name as PickupKind] = c;
        else (a as unknown as Record<string, Cv>)[name] = c;
      })
    );
  for (const k of PROJ)
    jobs.push(
      loadImg(`/survivor/item/p_${k}.png`).then((im) => {
        if (im) a.proj[k] = cut(im, 0, im.width);
      })
    );
  for (const k of Object.keys(a.things) as ThingKind[])
    if (k !== "lamp" && k !== "spout")
      jobs.push(
      loadImg(`/survivor/thing/${k}.png`).then((im) => {
        if (im) a.things[k] = cut(im, 0, im.width);
      })
    );
  for (const k of DECO_KEYS)
    jobs.push(
      loadImg(`/survivor/deco/${k}.png`).then((im) => {
        if (im) a.deco[k] = cut(im, 0, im.width);
      })
    );
  for (const id of STAGE_IDS)
    jobs.push(
      loadImg(`/survivor/${STAGES[id].ground}.png`).then((im) => {
        if (!im) return;
        a.stageTiles[id] = cut(im, 0, im.width);
        if (id === "town") a.tiles = a.stageTiles[id]!;
      })
    );
  fileLoad = Promise.all(jobs).then(() => {});
  return fileLoad;
}

/* ───────────── 럭키 출격: 디펜스 유닛 그림 (public/defense/units/<id>.webp, 160×160 · 발 아래 4%) ───────────── */

const unitCache = new Map<string, Cv | null>();
/** 화면 높이 h(px) 로 줄인 유닛 그림 (처음 부르면 받기 시작하고 null) */
export function unitArt(id: string, h: number): Cv | null {
  const key = `${id}@${h}`;
  if (unitCache.has(key)) return unitCache.get(key)!;
  unitCache.set(key, null);
  void loadImg(`/defense/units/${id}.webp`).then((im) => {
    if (!im) return;
    // 두 번에 나눠 줄여서 덜 뭉개지게
    const mid = cv(h * 2, h * 2);
    const mx = mid.getContext("2d")!;
    mx.imageSmoothingQuality = "high";
    mx.drawImage(im, 0, 0, h * 2, h * 2);
    const c = cv(h, h);
    const x = c.getContext("2d")!;
    x.imageSmoothingQuality = "high";
    x.drawImage(mid, 0, 0, h, h);
    unitCache.set(key, c);
  });
  return null;
}

let art: Art | null = null;
export function getArt(): Art {
  if (art) return art;
  const mobs = {} as Record<EnemyKind, MobArt>;
  for (const k of Object.keys(DRAW) as EnemyKind[]) mobs[k] = DRAW[k]();
  const pick: Record<PickupKind, Cv> = {
    coin: small(
      (g) => {
        ell(g, 3.5, 3.5, 3.5, 3.5, "#ffd23a");
        rect(g, 3, 2, 1, 3, "#c98a00");
        put(g, 2, 1, "#fff3b0");
      },
      7,
      7
    ),
    bag: small(
      (g) => {
        ell(g, 5, 7, 5, 4.5, "#c98a3a");
        rect(g, 3, 1, 4, 3, "#a86d24");
        rect(g, 4, 6, 2, 3, "#ffd23a");
      },
      10,
      12
    ),
    meat: small(
      (g) => {
        ell(g, 4, 4, 4, 3.5, "#c8553d");
        put(g, 3, 2, "#ff9a7a");
        rect(g, 7, 6, 3, 2, "#f6ecd8");
        rect(g, 9, 5, 2, 2, "#f6ecd8");
        rect(g, 9, 8, 2, 2, "#f6ecd8");
      },
      11,
      10
    ),
    magnet: small(
      (g) => {
        rect(g, 1, 1, 3, 7, "#ff4d6d");
        rect(g, 7, 1, 3, 7, "#ff4d6d");
        rect(g, 1, 7, 9, 3, "#ff4d6d");
        rect(g, 1, 1, 3, 2, "#e6ecff");
        rect(g, 7, 1, 3, 2, "#e6ecff");
      },
      11,
      11
    ),
    bomb: small(
      (g) => {
        ell(g, 5, 6, 4.5, 4.5, "#2e2a44");
        put(g, 3, 4, "#7a7598");
        rect(g, 5, 0, 1, 2, "#c9a46a");
        put(g, 6, 0, "#ffd23a");
      },
      10,
      11
    ),
    chest: small(
      (g) => {
        rect(g, 0, 3, 14, 9, "#b0642a");
        rect(g, 0, 0, 14, 4, "#d08040");
        rect(g, 0, 4, 14, 1, "#ffd23a");
        rect(g, 6, 3, 3, 4, "#ffd23a");
        put(g, 7, 5, "#7a3a10");
        rect(g, 0, 11, 14, 1, "#7a3a10");
      },
      14,
      12
    ),
  };
  const lamp = small(
    (g) => {
      rect(g, 3, 5, 2, 16, "#3c3f5c");
      rect(g, 1, 20, 6, 2, "#3c3f5c");
      rect(g, 1, 1, 6, 5, "#ffe9a0");
      rect(g, 2, 2, 4, 3, "#fff8d8");
      rect(g, 0, 0, 8, 1, "#3c3f5c");
    },
    8,
    22
  );
  const umbrella = small(
    (g) => {
      ell(g, 6, 5, 6, 4.5, "#5fc8ff", 5);
      rect(g, 2, 4, 1, 1, "#ffffff");
      rect(g, 6, 5, 1, 6, "#6a5a80");
      put(g, 5, 10, "#6a5a80");
    },
    13,
    11
  );
  const parcel = small(
    (g) => {
      rect(g, 0, 0, 10, 9, "#e8b36a");
      rect(g, 4, 0, 2, 9, "#fff2a8");
      rect(g, 0, 3, 10, 2, "#fff2a8");
      put(g, 8, 1, "#ffffff");
    },
    10,
    9
  );
  const shuriken = small(
    (g) => {
      rect(g, 3, 0, 1, 7, "#d6def5");
      rect(g, 0, 3, 7, 1, "#d6def5");
      rect(g, 2, 2, 3, 3, "#9aa6c8");
      put(g, 3, 3, "#1a1030");
    },
    7,
    7
  );
  const boomerang = small(
    (g) => {
      rect(g, 0, 0, 3, 9, "#ffb84d");
      rect(g, 0, 6, 9, 3, "#ffb84d");
      put(g, 1, 1, "#fff0c8");
    },
    9,
    9
  );
  art = {
    mobs,
    gems: [gemArt("#4fb8ff", "#d6f0ff"), gemArt("#4fe08a", "#d8ffe8"), gemArt("#ff4d6d", "#ffd6de"), gemArt("#ffd23a", "#fff6c8")],
    pick,
    lamp,
    umbrella,
    parcel,
    shuriken,
    boomerang,
    tiles: makeTiles(),
    stageTiles: {},
    deco: {},
    things: thingArt(),
    proj: {},
  };
  return art;
}

/** 맵 오브젝트 코드 도트 (파일 오기 전) */
function thingArt(): Record<ThingKind, Cv> {
  const pedestal = (g: Grid, top: string, glow: string) => {
    rect(g, 2, 16, 14, 4, "#5a5f80");
    rect(g, 4, 12, 10, 4, "#7a7fa0");
    rect(g, 5, 13, 8, 1, "#9aa0c0");
    for (let y = 0; y < 10; y++) {
      const half = y < 5 ? Math.floor(y / 1.4) : Math.floor((9 - y) / 1.4);
      rect(g, 9 - half, y + 1, half * 2 + 1, 1, top);
    }
    put(g, 8, 3, glow);
    put(g, 8, 4, glow);
  };
  return {
    shrine: small((g) => pedestal(g, "#4ff0c8", "#e8fff8"), 18, 20),
    gshrine: small((g) => pedestal(g, "#ffd23a", "#fff6c8"), 18, 20),
    lamp: small((g) => pedestal(g, "#ffb03a", "#fff2c0"), 18, 20),
    spout: small((g) => pedestal(g, "#7ad7ff", "#e8fbff"), 18, 20),
    statue: small(
      (g) => {
        rect(g, 2, 17, 14, 3, "#7a5a20");
        ell(g, 9, 12, 5, 5, "#ffd23a");
        ell(g, 9, 6, 4, 3.5, "#ffd23a");
        put(g, 6, 2, "#ffd23a");
        put(g, 12, 2, "#ffd23a");
        rect(g, 6, 3, 1, 1, "#ffd23a");
        rect(g, 12, 3, 1, 1, "#ffd23a");
        put(g, 7, 6, "#7a5a20");
        put(g, 11, 6, "#7a5a20");
        rect(g, 13, 9, 3, 1, "#ffd23a");
        rect(g, 15, 7, 1, 3, "#ffd23a");
        put(g, 8, 11, "#fff6c8");
      },
      18,
      20
    ),
    bell: small(
      (g) => {
        rect(g, 1, 0, 16, 2, "#6a4a30");
        rect(g, 2, 2, 2, 18, "#6a4a30");
        rect(g, 14, 2, 2, 18, "#6a4a30");
        ell(g, 9, 9, 4.5, 5, "#e0a030", 7);
        rect(g, 5, 9, 9, 4, "#e0a030");
        rect(g, 4, 13, 11, 1, "#c08020");
        put(g, 9, 14, "#6a4a30");
        put(g, 7, 7, "#fff0b0");
      },
      18,
      20
    ),
    flag: small(
      (g) => {
        rect(g, 3, 0, 2, 22, "#c8c0e0");
        rect(g, 5, 1, 10, 7, "#ff5fa0");
        rect(g, 5, 4, 10, 1, "#ffffff");
        rect(g, 1, 21, 6, 2, "#5a5f80");
      },
      16,
      23
    ),
    box: small(
      (g) => {
        rect(g, 0, 4, 16, 10, "#6a3fa0");
        rect(g, 0, 0, 16, 5, "#8a5fc8");
        rect(g, 0, 5, 16, 1, "#ffd23a");
        rect(g, 6, 4, 4, 5, "#ffd23a");
        put(g, 8, 6, "#3a1f60");
        rect(g, 0, 13, 16, 1, "#3a1f60");
      },
      16,
      14
    ),
    merchant: small(
      (g) => {
        // 망토 쓴 고양이 + 큰 짐가방
        rect(g, 11, 6, 7, 12, "#a86d24");
        rect(g, 12, 7, 5, 1, "#ffd23a");
        ell(g, 7, 14, 5, 6, "#5a4a8a");
        ell(g, 7, 7, 4.5, 4, "#f0d8b0");
        put(g, 4, 3, "#f0d8b0");
        put(g, 10, 3, "#f0d8b0");
        rect(g, 3, 2, 9, 3, "#5a4a8a");
        put(g, 5, 7, "#170f2e");
        put(g, 9, 7, "#170f2e");
        put(g, 7, 9, "#ff8fb8");
        rect(g, 4, 19, 2, 2, "#3a2f60");
        rect(g, 8, 19, 2, 2, "#3a2f60");
      },
      18,
      21
    ),
    fountain: small(
      (g) => {
        ell(g, 9, 15, 9, 4, "#7a7fa0");
        ell(g, 9, 14, 7, 2.5, "#5fc8ff");
        rect(g, 8, 4, 2, 10, "#9aa0c0");
        ell(g, 9, 4, 4, 1.5, "#9aa0c0");
        put(g, 9, 1, "#bfe8ff");
        put(g, 7, 2, "#bfe8ff");
        put(g, 11, 2, "#bfe8ff");
        put(g, 6, 13, "#ffffff");
      },
      18,
      19
    ),
    trial: small(
      (g) => {
        rect(g, 4, 14, 10, 4, "#5a5f80");
        ell(g, 9, 8, 5, 6, "#e0d8ff");
        ell(g, 11, 7, 4, 5, "#5a5f80");
      },
      18,
      18
    ),
  };
}

/* ───────────── 바닥 (밤의 광장) ───────────── */

const TILE = 16;
const CHUNK = 16;
function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** 바닥 한 덩어리 (16 × 16 칸 = 256px, 반복해서 깔림) */
function makeTiles(): Cv {
  const c = cv(TILE * CHUNK, TILE * CHUNK);
  const x = c.getContext("2d")!;
  for (let ty = 0; ty < CHUNK; ty++)
    for (let tx = 0; tx < CHUNK; tx++) {
      const px = tx * TILE;
      const py = ty * TILE;
      const h = hash(tx, ty);
      // 돌바닥
      x.fillStyle = h < 0.5 ? "#2a3150" : "#283049";
      x.fillRect(px, py, TILE, TILE);
      x.fillStyle = "#222844";
      x.fillRect(px, py + TILE - 1, TILE, 1);
      x.fillRect(px + TILE - 1, py, 1, TILE);
      // 벽돌 이음
      x.fillStyle = "#323a5c";
      x.fillRect(px + 1, py + 1, TILE - 3, 1);
      if (h > 0.8) {
        // 풀
        x.fillStyle = "#2f6a5a";
        const gx = px + 3 + Math.floor(hash(tx + 9, ty) * 8);
        const gy = py + 4 + Math.floor(hash(tx, ty + 9) * 8);
        x.fillRect(gx, gy, 1, 3);
        x.fillRect(gx + 2, gy + 1, 1, 2);
        x.fillRect(gx - 2, gy + 1, 1, 2);
      } else if (h > 0.74) {
        // 꽃
        x.fillStyle = ["#ff7fb0", "#ffd23a", "#9fb6ff"][Math.floor(hash(tx, ty + 3) * 3)];
        x.fillRect(px + 7, py + 7, 2, 2);
        x.fillStyle = "#2f6a5a";
        x.fillRect(px + 7, py + 9, 1, 2);
      } else if (h < 0.06) {
        // 금 간 돌
        x.fillStyle = "#1c2238";
        x.fillRect(px + 4, py + 5, 1, 4);
        x.fillRect(px + 5, py + 8, 3, 1);
      }
    }
  return c;
}
export const TILE_CHUNK = TILE * CHUNK;

/* ───────────── 캐릭터 (다이스 타운 도트 시트) ───────────── */

interface Sheet {
  image: string;
  frames: [number, number, number, number, number, number][];
  anims: Record<string, { list?: number[]; fps: number }>;
  facing?: "left" | "right";
}
export interface HeroFrame {
  r: Cv;
  l: Cv;
  /** 발 위치 (세계 px) */
  fx: number;
  fy: number;
  /** 그림 해상도 배율 (그림 px ÷ q = 세계 px) — 고해상도 화면에서 또렷하게 */
  q: number;
}
export interface HeroArt {
  idle: HeroFrame[];
  walk: HeroFrame[];
  /** 필살기 자세 (시트에 있으면 — 픽셀 순찰대) */
  ult?: HeroFrame[];
}

const heroCache = new Map<string, Promise<HeroArt>>();
/** 시트를 키 h(세계 px) × q 로 미리 줄여 둠 (매 프레임 큰 그림을 줄이면 느리고 흐려짐) — 그릴 때 q 로 나눠서 */
export function loadHero(sprite: string, h = 36, q = 1): Promise<HeroArt> {
  const key = `${sprite}:${h}:${q}`;
  let p = heroCache.get(key);
  if (!p) {
    p = fetch(sprite.includes("/") ? `/${sprite}.json` : `/fight/${sprite}.json`)
      .then((r) => r.json() as Promise<Sheet>)
      .then(
        (sh) =>
          new Promise<HeroArt>((res, rej) => {
            const img = new Image();
            img.onload = () => {
              const ref = sh.frames[sh.anims.idle?.list?.[0] ?? 0];
              const s = (h * q) / ref[3];
              const flipSrc = sh.facing === "left";
              const make = (i: number): HeroFrame => {
                const [sx, sy, sw, shh, fx, fy] = sh.frames[i];
                const w = Math.ceil(sw * s);
                const hh = Math.ceil(shh * s);
                const mk = (flip: boolean) => {
                  const c = cv(w, hh);
                  const x = c.getContext("2d")!;
                  x.imageSmoothingEnabled = true;
                  x.imageSmoothingQuality = "high";
                  if (flip) {
                    x.translate(w, 0);
                    x.scale(-1, 1);
                  }
                  x.drawImage(img, sx, sy, sw, shh, 0, 0, w, hh);
                  return c;
                };
                const right = mk(flipSrc);
                const left = mk(!flipSrc);
                return { r: right, l: left, fx: (fx * s) / q, fy: (fy * s) / q, q };
              };
              const list = (k: string) => (sh.anims[k]?.list ?? sh.anims.idle?.list ?? [0]).map(make);
              res({ idle: list("idle"), walk: list("walk"), ...(sh.anims.ult?.list && { ult: sh.anims.ult.list.map(make) }) });
            };
            img.onerror = rej;
            img.src = sh.image;
          })
      );
    p.catch(() => heroCache.delete(key));
    heroCache.set(key, p);
  }
  return p;
}

/* ───────────── 숫자 (3 × 5 도트 글꼴) ───────────── */

const DIG: Record<string, string> = {
  "0": "111101101101111",
  "1": "010110010010111",
  "2": "111001111100111",
  "3": "111001111001111",
  "4": "101101111001001",
  "5": "111100111001111",
  "6": "111100111101111",
  "7": "111001010010010",
  "8": "111101111101111",
  "9": "111101111001111",
  "!": "010010010000010",
};
/** 숫자 글자 그림 (색마다 캐시) */
const digCache = new Map<string, Cv>();
export function digits(s: string, color: string, scale = 1): Cv {
  const key = `${s}|${color}|${scale}`;
  let c = digCache.get(key);
  if (c) return c;
  const w = s.length * 4 - 1;
  const g = grid(w + 2, 7);
  for (let i = 0; i < s.length; i++) {
    const m = DIG[s[i]];
    if (!m) continue;
    for (let j = 0; j < 15; j++) if (m[j] === "1") put(g, 1 + i * 4 + (j % 3), 1 + Math.floor(j / 3), color);
  }
  outline(g);
  c = toCanvas(g);
  if (scale !== 1) {
    const big = cv(c.width * scale, c.height * scale);
    const x = big.getContext("2d")!;
    x.imageSmoothingEnabled = false;
    x.drawImage(c, 0, 0, big.width, big.height);
    c = big;
  }
  if (digCache.size > 600) digCache.clear();
  digCache.set(key, c);
  return c;
}
