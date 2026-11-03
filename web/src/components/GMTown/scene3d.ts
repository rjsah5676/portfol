import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  ARCH,
  BENCHES,
  BOARD,
  BRIDGES,
  BRIDGE_H,
  BUILDINGS,
  FLOWERS,
  FOUNTAIN,
  LAKE,
  LAMPS,
  PATHS,
  PLAZA,
  RIVER,
  TREES,
  WORLD,
  YARDS,
  archPosts,
  doorFront,
  doorW,
  faceRot,
  frontLen,
  heightAt,
  isLot,
  riverX,
  terrainH,
  type Building,
} from "@/lib/gmtown/world";

/*
 * GMTOWN 3D 장면 — 땅 · 길 · 건물 · 나무 · 장식 (사람은 엔진이 따로).
 * 툰 재질(3단 명암) + 검은 외곽선(뒤집은 껍데기) — 기존 증권거래소 덧칠 그림과 같은 느낌.
 * 건물은 게임마다 화풍대로: 픽셀(저해상도 벽돌 · 도트 간판) · 애니(차양 · 전구 간판) · 누아르 · 우리 집.
 * 증권거래소만 3D 모델 + 그 카메라로 찍은 덧칠 그림을 모델 표면에 투사 (나머지도 같은 길로 바꿈).
 * 좌표: 땅 (x, y) → 3D (x, 높이, y). 땅은 높이 지형 한 장 + 길 · 광장 · 부지를 칠한 그림(splat)으로 잔디 · 돌 · 흙 · 모래를 섞음.
 */

export const TOWN_FILES = {
  stockGlb: "/gmtown/bld/stock.glb",
  stockPaint: "/gmtown/bld/stock_paint.webp",
  stockJson: "/gmtown/bld/stock.json",
  tex: (n: "grass" | "paving" | "dirt" | "plaza" | "sand" | "rail") => `/gmtown/tex/${n}.webp`,
};
/** 미리 받을 파일 (건물을 다시 지을 때 그 건물 파일을 더함) */
export const townFiles = () => [
  TOWN_FILES.tex("grass"),
  TOWN_FILES.tex("plaza"),
  TOWN_FILES.tex("paving"),
  TOWN_FILES.tex("dirt"),
  TOWN_FILES.tex("sand"),
  TOWN_FILES.tex("rail"),
];

export interface BuildingView {
  b: Building;
  group: THREE.Group;
  /** 비칠 때 바꾸는 재질들 (이 건물 것만) */
  mats: THREE.Material[];
  fade: number;
  /** 누르기 판정 상자 */
  pick: THREE.Mesh;
}

export interface TownScene {
  scene: THREE.Scene;
  /** 지형 (그림자 받기 · 누르기는 엔진이 heightAt 으로) */
  ground: THREE.Mesh;
  sun: THREE.DirectionalLight;
  buildings: BuildingView[];
  /** 문 앞 표시 고리 */
  doorRing: THREE.Mesh;
  /** 가는 곳 표시 */
  goalRing: THREE.Mesh;
  tick(t: number): void;
  /** 카메라 ↔ 보는 점 사이 나무를 성기게 (매 프레임) */
  setView(eye: THREE.Vector3, focus: THREE.Vector3): void;
  dispose(): void;
}

const INK = 0x2b2433;
const TILE = { grass: 7, paving: 3.2, dirt: 5, plaza: 3, sand: 6, rail: 2.5 } as const;

function gradientMap(): THREE.DataTexture {
  const d = new Uint8Array([150, 150, 150, 255, 205, 205, 205, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(d, 3, 1);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

function canvasTex(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  pixel = false
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (pixel) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
  } else t.anisotropy = 8;
  return t;
}

// ───────────── 간판 · 벽 그림 ─────────────

function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}
/** 픽셀 간판: 아주 작게 그려 최근접 확대 (도트가 보이게) */
function pixelSign(text: string, bg: string, fg: string, glow: string) {
  return canvasTex(
    text.length * 8 + 14,
    22,
    (g, W, H) => {
      g.fillStyle = "#120c1e";
      g.fillRect(0, 0, W, H);
      g.fillStyle = bg;
      g.fillRect(1, 1, W - 2, H - 2);
      g.fillStyle = glow;
      g.fillRect(2, 2, W - 4, 1);
      g.fillRect(2, H - 3, W - 4, 1);
      g.font = '700 12px "Galmuri11", monospace';
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "#120c1e";
      g.fillText(text, W / 2 + 1, H / 2 + 2);
      g.fillStyle = fg;
      g.fillText(text, W / 2, H / 2 + 1);
      for (let x = 4; x < W - 3; x += 4) {
        g.fillStyle = (x / 4) % 2 ? glow : "#fff7d6";
        g.fillRect(x, 0, 1, 1);
        g.fillRect(x, H - 1, 1, 1);
      }
    },
    true
  );
}
/** 애니 간판: 둥근 판 + 전구 + 굵은 글씨 */
function animeSign(text: string, bg: string, fg: string, ring: string) {
  return canvasTex(512, 128, (g, W, H) => {
    g.fillStyle = ring;
    rrect(g, 4, 4, W - 8, H - 8, 54);
    g.fill();
    g.fillStyle = bg;
    rrect(g, 14, 14, W - 28, H - 28, 44);
    g.fill();
    for (let i = 0; i < 18; i++) {
      g.fillStyle = i % 2 ? "#fff4c2" : "#ffd36b";
      for (const y of [10, H - 10]) {
        g.beginPath();
        g.arc(30 + (i * (W - 60)) / 17, y, 4.5, 0, 7);
        g.fill();
      }
    }
    g.font = '400 60px "Black Han Sans", sans-serif';
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 10;
    g.strokeStyle = "#2b2433";
    g.strokeText(text, W / 2, H / 2 + 4);
    g.fillStyle = fg;
    g.fillText(text, W / 2, H / 2 + 4);
  });
}
function noirSign(text: string) {
  return canvasTex(512, 110, (g, W, H) => {
    g.fillStyle = "#14100e";
    g.fillRect(0, 0, W, H);
    g.strokeStyle = "#f2c14e";
    g.lineWidth = 6;
    g.strokeRect(8, 8, W - 16, H - 16);
    g.font = '800 52px "Nanum Gothic", sans-serif';
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = "#f2c14e";
    g.shadowBlur = 18;
    g.fillStyle = "#ffe3a1";
    g.fillText(text, W / 2, H / 2 + 3);
  });
}
function woodSign(text: string, sub?: string) {
  return canvasTex(360, sub ? 150 : 120, (g, W, H) => {
    g.fillStyle = "#8a5a3b";
    rrect(g, 4, 4, W - 8, H - 8, 20);
    g.fill();
    g.fillStyle = "#f6e7c8";
    rrect(g, 14, 14, W - 28, H - 28, 14);
    g.fill();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#6b3a22";
    let fs = 54;
    g.font = `400 ${fs}px "Black Han Sans", sans-serif`;
    while (fs > 26 && g.measureText(text).width > W - 44) g.font = `400 ${(fs -= 2)}px "Black Han Sans", sans-serif`;
    g.fillText(text, W / 2, sub ? H / 2 - 12 : H / 2 + 4);
    if (sub) {
      g.font = '700 22px "Nanum Gothic", sans-serif';
      g.fillStyle = "#8a5a3b";
      g.fillText(sub, W / 2, H / 2 + 32);
    }
  });
}
/** 픽셀 벽돌 (32px → 최근접) */
function brick(base: string, dark: string, light: string) {
  return canvasTex(
    32,
    32,
    (g) => {
      g.fillStyle = base;
      g.fillRect(0, 0, 32, 32);
      for (let y = 0; y < 32; y += 4) {
        g.fillStyle = dark;
        g.fillRect(0, y, 32, 1);
        const o = (y / 4) % 2 ? 4 : 0;
        for (let x = o; x < 32; x += 8) g.fillRect(x, y, 1, 4);
        g.fillStyle = light;
        for (let x = o + 1; x < 32; x += 8) g.fillRect(x, y + 1, 3, 1);
      }
    },
    true
  );
}
function noirBrick() {
  return canvasTex(64, 64, (g) => {
    g.fillStyle = "#3a312c";
    g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 64; y += 8) {
      g.fillStyle = "#2a221e";
      g.fillRect(0, y, 64, 2);
      for (let x = (y / 8) % 2 ? 0 : 16; x < 64; x += 32) g.fillRect(x, y, 2, 8);
    }
  });
}
const stripes = (a: string, b: string) =>
  canvasTex(256, 64, (g, W, H) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? b : a;
      g.fillRect((i * W) / 8, 0, W / 8, H);
    }
    g.fillStyle = "rgba(0,0,0,.15)";
    g.fillRect(0, H - 8, W, 8);
  });
function tickerTex() {
  const items: [string, string, number][] = [
    ["애니메지수", "2,847.32", 1.25],
    ["차트코인", "4.12", 5.73],
    ["턴제건설", "9,870", -1.12],
    ["대전엔터", "31,200", 0.96],
    ["캔들화학", "18,950", -0.84],
    ["리듬전자", "72,400", 2.1],
  ];
  const t = canvasTex(2048, 160, (g, W, H) => {
    g.fillStyle = "#0b1030";
    g.fillRect(0, 0, W, H);
    g.textBaseline = "middle";
    const fs = Math.round(H * 0.42),
      y = H / 2 + 2;
    let x = 24;
    while (x < W) {
      for (const [n, p, c] of items) {
        if (x > W) break;
        const up = c >= 0;
        g.font = `800 ${fs}px "Nanum Gothic", sans-serif`;
        g.fillStyle = "#e8ecff";
        g.fillText(n, x, y);
        x += g.measureText(n).width + 16;
        g.fillStyle = "#ffd84a";
        g.fillText(p, x, y);
        x += g.measureText(p).width + 14;
        g.fillStyle = up ? "#ff4d5e" : "#3d9bff";
        const s = (up ? "▲" : "▼") + Math.abs(c).toFixed(2) + "%";
        g.fillText(s, x, y);
        x += g.measureText(s).width + 44;
      }
    }
    g.fillStyle = "rgba(0,0,0,0.22)";
    for (let yy = 0; yy < H; yy += 6) g.fillRect(0, yy, W, 2);
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ───────────── 만들기 ─────────────

export async function buildTown(): Promise<TownScene> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x6fae5a);
  const grad = gradientMap();
  const disposables: { dispose(): void }[] = [grad];
  const own = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const treeView = { uEye: { value: new THREE.Vector3(0, 1e4, 0) }, uFocus: { value: new THREE.Vector3(0, 1e4, 0) } };
  const shared = new Map<string, THREE.MeshToonMaterial>();
  const toon = (c: THREE.ColorRepresentation, o: THREE.MeshToonMaterialParameters = {}) => {
    const k = String(c) + JSON.stringify(o, (_k, v) => (v instanceof THREE.Texture ? v.uuid : v));
    let m = shared.get(k);
    if (!m)
      shared.set(k, (m = own(new THREE.MeshToonMaterial({ color: c, gradientMap: grad, ...o }))));
    return m;
  };
  const inkShared = own(new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }));
  /** 증권거래소 전광판 (흐르게) */
  let ticker: THREE.Texture | null = null;

  // 빛
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb88a, 1.45));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.9);
  sun.castShadow = true;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // 땅 그림
  const tl = new THREE.TextureLoader();
  const load = async (n: "grass" | "paving" | "dirt" | "plaza" | "sand" | "rail") => {
    const t = own(await tl.loadAsync(TOWN_FILES.tex(n)));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  const [gTex, pTex, dTex, plTex, sTex, rTex] = await Promise.all([
    load("grass"),
    load("paving"),
    load("dirt"),
    load("plaza"),
    load("sand"),
    load("rail"),
  ]);
  // ── 지형: 높이 그대로 한 장 (마을 밖 산까지) ──
  const ground = buildGround();
  scene.add(ground);
  function buildGround(): THREE.Mesh {
    const X0 = -70,
      Y0 = -70,
      X1 = WORLD.w + 70,
      Y1 = WORLD.h + 70,
      step = 1.25;
    const nx = Math.round((X1 - X0) / step) + 1,
      ny = Math.round((Y1 - Y0) / step) + 1;
    const g = own(new THREE.PlaneGeometry(X1 - X0, Y1 - Y0, nx - 1, ny - 1));
    g.rotateX(-Math.PI / 2);
    g.translate((X0 + X1) / 2, 0, (Y0 + Y1) / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, terrainH(pos.getX(i), pos.getZ(i)));
    g.computeVertexNormals();
    // 칠하기 그림: R = 돌(큰길 · 광장) · G = 흙(흙길 · 부지 · 마당 · 철길) · B = 모래(강가 · 호숫가)
    const PX = 8;
    const cv = document.createElement("canvas");
    cv.width = WORLD.w * PX;
    cv.height = WORLD.h * PX;
    const c = cv.getContext("2d")!;
    c.fillStyle = "#000";
    c.fillRect(0, 0, cv.width, cv.height);
    c.scale(PX, PX);
    c.globalCompositeOperation = "lighter";
    c.lineCap = c.lineJoin = "round";
    const stroke = (pts: [number, number][], w: number, col: string) => {
      c.strokeStyle = col;
      c.lineWidth = w;
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.stroke();
    };
    // 강가 · 호숫가 모래
    c.filter = "blur(6px)";
    const rv: [number, number][] = [];
    for (let y = -4; y <= WORLD.h + 4; y += 2) rv.push([riverX(y), y]);
    stroke(rv, RIVER.bank * 2 + 1, "#0000ff");
    c.fillStyle = "#0000ff";
    c.beginPath();
    c.ellipse(LAKE.x, LAKE.y, LAKE.rx * 1.35, LAKE.ry * 1.35, 0, 0, Math.PI * 2);
    c.fill();
    c.filter = "none";
    // 흙: 부지 · 마당 · 흙길 · 철길 (살짝 흐리게 — 경계에서 섞일 폭)
    c.filter = "blur(3px)";
    c.fillStyle = "#00ff00";
    for (const b of BUILDINGS) c.fillRect(b.x, b.y, b.w, b.d);
    c.fillStyle = "#008000";
    for (const q of YARDS) c.fillRect(q.x, q.y, q.w, q.d);
    for (const pth of PATHS) if (pth.kind === "dirt") stroke(pth.pts, pth.w, "#00ff00");
    // 철길 둑은 흙으로 조금 넓게 (자갈 바깥 어깨)
    for (const pth of PATHS) if (pth.kind === "rail") stroke(pth.pts, pth.w + 1.6, "#00ff00");
    // 돌: 큰길 · 광장 (흙 위를 덮게 흙 값을 지움) — 살짝 흐리게 해서 경계에서 섞일 폭을 남김
    c.globalCompositeOperation = "source-over";
    c.filter = "blur(3px)";
    const stoneCol = "#ff0000";
    for (const pth of PATHS) if (pth.kind === "stone") stroke(pth.pts, pth.w, stoneCol);
    c.fillStyle = stoneCol;
    c.beginPath();
    c.arc(PLAZA.x, PLAZA.y, PLAZA.r, 0, Math.PI * 2);
    c.fill();
    c.filter = "none";
    // 철길 자갈은 따로 한 장 (R 만 씀)
    const RPX = 4;
    const cr = document.createElement("canvas");
    cr.width = WORLD.w * RPX;
    cr.height = WORLD.h * RPX;
    const r = cr.getContext("2d")!;
    r.fillStyle = "#000";
    r.fillRect(0, 0, cr.width, cr.height);
    r.scale(RPX, RPX);
    r.lineCap = r.lineJoin = "round";
    r.filter = "blur(1.5px)";
    r.strokeStyle = "#ff0000";
    for (const pth of PATHS)
      if (pth.kind === "rail") {
        r.lineWidth = pth.w;
        r.beginPath();
        pth.pts.forEach(([x, y], i) => (i ? r.lineTo(x, y) : r.moveTo(x, y)));
        r.stroke();
      }
    const railSplat = own(new THREE.CanvasTexture(cr));
    railSplat.colorSpace = THREE.NoColorSpace;
    railSplat.flipY = false;
    railSplat.wrapS = railSplat.wrapT = THREE.ClampToEdgeWrapping;
    const splat = own(new THREE.CanvasTexture(cv));
    splat.colorSpace = THREE.NoColorSpace;
    splat.flipY = false;
    splat.wrapS = splat.wrapT = THREE.ClampToEdgeWrapping;
    splat.anisotropy = 4;
    const mat = own(new THREE.MeshToonMaterial({ map: gTex, gradientMap: grad }));
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, {
        tStone: { value: pTex },
        tPlaza: { value: plTex },
        uPlaza: { value: new THREE.Vector4(PLAZA.x, PLAZA.y, PLAZA.r, TILE.plaza) },
        tDirt: { value: dTex },
        tSand: { value: sTex },
        tRail: { value: rTex },
        tRailSplat: { value: railSplat },
        uRailTile: { value: TILE.rail },
        uSandTile: { value: TILE.sand },
        tSplat: { value: splat },
        uWorld: { value: new THREE.Vector2(WORLD.w, WORLD.h) },
        uTile: { value: new THREE.Vector3(TILE.grass, TILE.paving, TILE.dirt) },
      });
      sh.vertexShader = sh.vertexShader
        .replace("void main() {", "varying vec3 vWP;\nvarying float vUp;\nvoid main() {")
        .replace(
          "#include <worldpos_vertex>",
          "#include <worldpos_vertex>\nvWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvUp = normalize( mat3( modelMatrix ) * objectNormal ).y;"
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "void main() {",
          `uniform sampler2D tStone;
uniform sampler2D tDirt;
uniform sampler2D tSand;
uniform sampler2D tRail;
uniform sampler2D tRailSplat;
uniform float uRailTile;
uniform float uSandTile;
uniform sampler2D tSplat;
uniform sampler2D tPlaza;
uniform vec4 uPlaza;
uniform vec2 uWorld;
uniform vec3 uTile;
varying vec3 vWP;
varying float vUp;
// 경계를 울퉁불퉁하게 섞는 값 잡음 (0..1)
float gHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float gNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( gHash( i ), gHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( gHash( i + vec2( 0.0, 1.0 ) ), gHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float gFbm( vec2 p ) { return gNoise( p ) * 0.6 + gNoise( p * 2.7 + 13.1 ) * 0.3 + gNoise( p * 7.3 + 41.7 ) * 0.1; }
// w: 칠하기 값, h: 그 텍스처의 밝기(돌 위는 높고 틈은 낮음), n: 잡음 → 돌 · 자갈은 남고 틈부터 풀이 파고듦
float gBlend( float w, float h, float n, float soft ) {
  return smoothstep( 0.5 - soft, 0.5 + soft, w + ( h - 0.5 ) * 0.35 + ( n - 0.5 ) * 0.45 );
}
void main() {`
        )
        .replace(
          "#include <map_fragment>",
          `vec2 wuv = vWP.xz;
vec4 cG = texture2D( map, wuv / uTile.x );
vec4 cS = texture2D( tStone, wuv / uTile.y );
vec4 cD = texture2D( tDirt, wuv / uTile.z );
vec3 cSand = texture2D( tSand, wuv / uSandTile ).rgb;
vec2 suv = wuv / uWorld;
vec3 sp = ( suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0 ) ? vec3( 0.0 ) : texture2D( tSplat, suv ).rgb;
float rp = ( suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0 ) ? 0.0 : texture2D( tRailSplat, suv ).r;
vec3 cR = texture2D( tRail, wuv / uRailTile ).rgb;
float nA = gFbm( wuv * 0.9 ), nB = gFbm( wuv * 1.7 + 7.0 );
// 광장은 벽돌 (헤링본), 나머지 돌길은 보도블록
vec3 cP = texture2D( tPlaza, wuv / uPlaza.w ).rgb;
float inPlaza = 1.0 - smoothstep( uPlaza.z - 0.05, uPlaza.z + 0.05, distance( wuv, uPlaza.xy ) );
// 풀 아닌 땅(돌 · 흙 · 모래)끼리 먼저 섞고, 그다음 풀과 한 번만 섞음 → 두 땅 사이에 풀 실금이 안 생김
float sum = sp.r + sp.g + sp.b + 1e-4;
float lumD = dot( cD.rgb, vec3( 0.33 ) );
float lumS = smoothstep( 0.45, 0.75, dot( cS.rgb, vec3( 0.33 ) ) );
float wDS = gBlend( sp.g / ( sp.g + sp.b + 1e-4 ), mix( 0.5, lumD, 0.6 ), nB, 0.15 );
vec3 base = mix( cSand, cD.rgb, wDS );
float rS = sp.r / sum;
float wS = mix( gBlend( rS, lumS, nB, 0.08 ), smoothstep( 0.3, 0.6, rS ), inPlaza );
vec3 ground = mix( base, mix( cS.rgb, cP, inPlaza ), wS );
// 풀과의 경계: 돌은 끝까지 남고 줄눈부터 풀이 들어옴, 흙은 자갈 무늬 따라 엇갈림, 모래는 넓고 둥글게
float h = mix( mix( 0.5, lumD, 0.8 * wDS ), lumS, wS );
float T = clamp( sum, 0.0, 1.0 );
float wN = gBlend( T, h, mix( nA, nB, 0.5 ), mix( 0.1, 0.22, sp.b / sum ) );
wN = max( wN, inPlaza * smoothstep( 0.3, 0.6, sp.r ) );
// 길 둘레 풀은 살짝 밟혀 누렇게
float worn = smoothstep( 0.0, 0.5, T ) * ( 1.0 - wN );
vec3 gCol = mix( cG.rgb, cG.rgb * vec3( 0.9, 0.86, 0.6 ) + vec3( 0.05, 0.04, 0.0 ), worn * 0.55 );
vec3 col = mix( gCol, ground, wN );
// 철길 자갈 (흙 둑 위)
float wR = gBlend( rp, dot( cR, vec3( 0.33 ) ), nA, 0.1 );
col = mix( col, cR, wR );
// 가파른 산비탈은 바위색, 물에 잠기는 곳은 어둡게
col = mix( col, vec3( 0.55, 0.52, 0.46 ), smoothstep( 0.78, 0.6, vUp ) );
col *= mix( 0.72, 1.0, smoothstep( -1.4, -0.4, vWP.y ) );
diffuseColor.rgb *= col;`
        );
    };
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }

  // ── 광장 테두리 ──
  {
    const ring = new THREE.Mesh(
      own(new THREE.RingGeometry(PLAZA.r - 0.06, PLAZA.r + 0.07, 128)),
      own(new THREE.MeshBasicMaterial({ color: INK }))
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(PLAZA.x, 0.035, PLAZA.y);
    scene.add(ring);
    const r2 = new THREE.Mesh(
      own(new THREE.RingGeometry(PLAZA.r - 2.6, PLAZA.r - 2.2, 128)),
      toon(0xd9c9a8)
    );
    r2.rotation.x = -Math.PI / 2;
    r2.position.set(PLAZA.x, 0.034, PLAZA.y);
    r2.receiveShadow = true;
    scene.add(r2);
    const r3 = new THREE.Mesh(own(new THREE.RingGeometry(6.2, 6.6, 96)), toon(0xd9c9a8));
    r3.rotation.x = -Math.PI / 2;
    r3.position.set(PLAZA.x, 0.034, PLAZA.y);
    r3.receiveShadow = true;
    scene.add(r3);
  }

  // 외곽선 붙여 넣기 (뒤집은 껍데기)
  const withInk = (
    parent: THREE.Object3D,
    m: THREE.Mesh,
    ink: number,
    inkMat: THREE.Material = inkShared
  ) => {
    parent.add(m);
    if (!ink) return m;
    const g = m.geometry;
    g.computeBoundingBox();
    const s = new THREE.Vector3();
    g.boundingBox!.getSize(s);
    const k = new THREE.Mesh(g, inkMat);
    k.position.copy(m.position);
    k.rotation.copy(m.rotation);
    k.scale.set(
      ((s.x + ink) / (s.x || 1)) * m.scale.x,
      ((s.y + ink) / (s.y || 1)) * m.scale.y,
      ((s.z + ink) / (s.z || 1)) * m.scale.z
    );
    parent.add(k);
    return m;
  };

  // ── 강 · 다리 ──
  {
    const pts: number[] = [],
      idx: number[] = [];
    let n = 0;
    for (let y = -70; y <= WORLD.h + 70; y += 2) {
      const x = riverX(y);
      pts.push(x - RIVER.half - 1.5, -0.95, y, x + RIVER.half + 1.5, -0.95, y);
      if (n) idx.push(n * 2 - 2, n * 2, n * 2 - 1, n * 2 - 1, n * 2, n * 2 + 1);
      n++;
    }
    const wg = own(new THREE.BufferGeometry());
    wg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    wg.setIndex(idx);
    wg.computeVertexNormals();
    const water = new THREE.Mesh(
      wg,
      own(new THREE.MeshToonMaterial({ color: 0x5cb6e0, gradientMap: grad, transparent: true, opacity: 0.9 }))
    );
    water.receiveShadow = true;
    scene.add(water);
    const wood = toon(0xc98f5a),
      dark = toon(0x7a5230);
    for (const br of BRIDGES) {
      const cx = riverX(br.y),
        L = (RIVER.bank + 1.5) * 2;
      const deck = new THREE.Mesh(own(new THREE.BoxGeometry(L, 0.5, br.w)), wood);
      deck.position.set(cx, BRIDGE_H - 0.25, br.y);
      deck.castShadow = deck.receiveShadow = true;
      withInk(scene, deck, 0.1);
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(own(new THREE.BoxGeometry(L, 0.12, 0.14)), dark);
        rail.position.set(cx, BRIDGE_H + 0.9, br.y + side * (br.w / 2 - 0.1));
        withInk(scene, rail, 0.05);
        for (let k = 0; k <= 8; k++) {
          const post = new THREE.Mesh(own(new THREE.BoxGeometry(0.16, 0.95, 0.16)), dark);
          post.position.set(cx - L / 2 + (k * L) / 8, BRIDGE_H + 0.45, br.y + side * (br.w / 2 - 0.1));
          post.castShadow = true;
          withInk(scene, post, 0.05);
        }
      }
      // 다리 기둥
      for (const dx of [-RIVER.half + 1, 0, RIVER.half - 1]) {
        const pier = new THREE.Mesh(own(new THREE.BoxGeometry(0.8, 2.4, br.w - 0.6)), toon(0xb9ab92));
        pier.position.set(cx + dx, BRIDGE_H - 1.6, br.y);
        scene.add(pier);
      }
    }
  }

  // ── 분수 ──
  const spray: THREE.Mesh[] = [];
  {
    const stone = toon(0xeadfcb);
    const at = (m: THREE.Mesh, y: number, ink = 0) => {
      m.position.set(FOUNTAIN.x, y, FOUNTAIN.y);
      m.castShadow = m.receiveShadow = true;
      return withInk(scene, m, ink);
    };
    at(new THREE.Mesh(own(new THREE.CylinderGeometry(3.3, 3.5, 0.32, 48)), stone), 0.16, 0.1);
    const water = toon(0x58b8e8);
    const w = new THREE.Mesh(own(new THREE.CircleGeometry(3.05, 48)), water);
    w.rotation.x = -Math.PI / 2;
    w.position.set(FOUNTAIN.x, 0.34, FOUNTAIN.y);
    scene.add(w);
    const rim = new THREE.Mesh(own(new THREE.TorusGeometry(3.15, 0.22, 10, 64)), stone);
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(FOUNTAIN.x, 0.42, FOUNTAIN.y);
    rim.castShadow = true;
    scene.add(rim);
    const rk = new THREE.Mesh(own(new THREE.TorusGeometry(3.15, 0.27, 10, 64)), inkShared);
    rk.rotation.x = -Math.PI / 2;
    rk.position.copy(rim.position);
    scene.add(rk);
    at(new THREE.Mesh(own(new THREE.CylinderGeometry(0.35, 0.55, 1.5, 20)), stone), 1.0, 0.08);
    at(new THREE.Mesh(own(new THREE.CylinderGeometry(1.1, 0.5, 0.32, 24)), stone), 1.8, 0.08);
    const w2 = new THREE.Mesh(own(new THREE.CircleGeometry(0.95, 24)), toon(0x7fd0f2));
    w2.rotation.x = -Math.PI / 2;
    w2.position.set(FOUNTAIN.x, 1.97, FOUNTAIN.y);
    scene.add(w2);
    const spm = own(
      new THREE.MeshBasicMaterial({ color: 0xd8f3ff, transparent: true, opacity: 0.85 })
    );
    const sp = new THREE.Mesh(own(new THREE.ConeGeometry(0.22, 0.9, 12)), spm);
    sp.position.set(FOUNTAIN.x, 2.4, FOUNTAIN.y);
    scene.add(sp);
    spray.push(sp);
    const dropG = own(new THREE.SphereGeometry(0.13, 8, 6));
    const dropM = own(new THREE.MeshBasicMaterial({ color: 0xe6f7ff }));
    for (let i = 0; i < 8; i++) {
      const j = new THREE.Mesh(dropG, dropM);
      j.userData.a = (i / 8) * Math.PI * 2;
      scene.add(j);
      spray.push(j);
    }
  }

  // ── 호수 (땅에 파인 곳에 물) ──
  {
    const water = new THREE.Mesh(own(new THREE.CircleGeometry(1, 64)), toon(0x5cb6e0));
    water.scale.set(LAKE.rx + 1.2, LAKE.ry + 1.2, 1);
    water.rotation.x = -Math.PI / 2;
    water.position.set(LAKE.x, -0.55, LAKE.y);
    water.receiveShadow = true;
    scene.add(water);
    // 연잎
    const pad = toon(0x4f9a46);
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(own(new THREE.CircleGeometry(0.45, 12, 0.3, Math.PI * 1.8)), pad);
      m.rotation.x = -Math.PI / 2;
      m.position.set(LAKE.x + 2 + ((i * 29) % 5), -0.53, LAKE.y - 2 + ((i * 17) % 4));
      scene.add(m);
    }
  }

  // ── 나무 (24m 덩어리마다 종류별로 한 묶음 — 화면 밖 덩어리는 안 그림) ──
  {
    const part = (g: THREE.BufferGeometry, color: number, sx = 1) => {
      const ng = g.index ? g.toNonIndexed() : g;
      if (ng !== g) g.dispose();
      const c = new THREE.Color(color);
      const n = ng.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
      ng.setAttribute("color", new THREE.BufferAttribute(col, 3));
      ng.deleteAttribute("uv");
      if (sx !== 1) ng.scale(sx, sx, sx);
      return ng;
    };
    const trunk = () =>
      part(new THREE.CylinderGeometry(0.18, 0.26, 1.4, 7).translate(0, 0.7, 0), 0x8a5a3b);
    const kinds: Record<"round" | "pine" | "blossom", THREE.BufferGeometry> = {
      round: mergeGeometries([
        trunk(),
        part(new THREE.IcosahedronGeometry(1.35, 1).translate(0, 2.4, 0), 0x4c9a3f),
        part(new THREE.IcosahedronGeometry(0.95, 1).translate(0, 3.25, 0), 0x63b44c),
      ])!,
      pine: mergeGeometries([
        trunk(),
        part(new THREE.ConeGeometry(1.5, 2.6, 8).translate(0, 2.3, 0), 0x2f7a45, 1.1),
        part(new THREE.ConeGeometry(1.1, 2.0, 8).translate(0, 3.5, 0), 0x3a8f52, 1.1),
      ])!,
      blossom: mergeGeometries([
        trunk(),
        part(new THREE.IcosahedronGeometry(1.35, 1).translate(0, 2.4, 0), 0xf2a7c3),
        part(new THREE.IcosahedronGeometry(0.95, 1).translate(0, 3.25, 0), 0xf7c2d6),
      ])!,
    };
    for (const g of Object.values(kinds)) own(g);
    const treeM = own(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: grad }));
    // 카메라와 캐릭터 사이(또는 카메라 바로 앞) 나무는 점무늬로 성기게 → 가려도 캐릭터가 보임
    treeM.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, treeView);
      sh.vertexShader = sh.vertexShader
        .replace(
          "void main() {",
          `uniform vec3 uEye;
uniform vec3 uFocus;
varying float vFade;
void main() {`
        )
        .replace(
          "#include <project_vertex>",
          `#include <project_vertex>
{
  vec4 o4 = modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
  vec2 o = o4.xz, e = uEye.xz, fo = uFocus.xz, d = fo - e;
  float L2 = max( dot( d, d ), 1e-4 );
  float t = dot( o - e, d ) / L2;
  vec2 q = e + d * clamp( t, 0.0, 1.0 );
  float r = 1.7 * length( instanceMatrix[ 0 ].xyz ) + 0.5;
  float side = 1.0 - smoothstep( r, r + 1.2, distance( o, q ) );
  float between = smoothstep( -0.05, 0.08, t ) * ( 1.0 - smoothstep( 0.92, 1.02, t ) );
  float nearCam = 1.0 - smoothstep( 2.5, 4.5, distance( o, e ) );
  vFade = max( side * between, nearCam );
}`
        );
      sh.fragmentShader = sh.fragmentShader
        .replace("void main() {", "varying float vFade;\nvoid main() {")
        .replace(
          "#include <clipping_planes_fragment>",
          `#include <clipping_planes_fragment>
if ( vFade > 0.01 ) {
  vec2 b1 = floor( gl_FragCoord.xy ), b2 = floor( b1 * 0.5 );
  float th = fract( dot( b2, vec2( 0.5, b2.y * 0.75 ) ) ) * 0.25 + fract( dot( b1, vec2( 0.5, b1.y * 0.75 ) ) ) + 0.03;
  if ( vFade * 0.82 > th ) discard;
}`
        );
    };
    const C = 24;
    const buckets = new Map<string, typeof TREES>();
    for (const t of TREES) {
      const k = `${t.kind}:${Math.floor(t.x / C)}:${Math.floor(t.y / C)}`;
      let l = buckets.get(k);
      if (!l) buckets.set(k, (l = []));
      l.push(t);
    }
    const o = new THREE.Object3D();
    for (const [k, list] of buckets) {
      const kind = k.split(":")[0] as keyof typeof kinds;
      const im = new THREE.InstancedMesh(kinds[kind], treeM, list.length);
      list.forEach((t, i) => {
        o.position.set(t.x, heightAt(t.x, t.y) - 0.08, t.y);
        o.rotation.set(0, (t.x * 7 + t.y * 3) % 6.28, 0);
        o.scale.setScalar(t.s);
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
      });
      im.castShadow = im.receiveShadow = true;
      im.computeBoundingSphere();
      scene.add(im);
    }
  }

  // ── 가로등 · 벤치 · 꽃 ──
  {
    const o = new THREE.Object3D();
    const inst = (
      g: THREE.BufferGeometry,
      m: THREE.Material,
      list: { x: number; y: number }[],
      y: number,
      shadow = true
    ) => {
      const im = new THREE.InstancedMesh(own(g), m, list.length);
      list.forEach((p, i) => {
        o.position.set(p.x, y + heightAt(p.x, p.y), p.y);
        o.rotation.set(0, 0, 0);
        o.scale.setScalar(1);
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
      });
      im.castShadow = shadow;
      im.computeBoundingSphere();
      scene.add(im);
    };
    inst(new THREE.CylinderGeometry(0.07, 0.1, 3.4, 8), toon(0x3b4256), LAMPS, 1.7);
    inst(
      new THREE.BoxGeometry(0.42, 0.36, 0.42),
      toon(0xffe7a8, { emissive: 0x6b5a20 }),
      LAMPS,
      3.5
    );
    inst(new THREE.BoxGeometry(0.5, 0.44, 0.5), inkShared, LAMPS, 3.5, false);

    for (const bn of BENCHES) {
      const g = new THREE.Group();
      const wood = toon(0xb07a4a);
      const s = new THREE.Mesh(own(new THREE.BoxGeometry(1.8, 0.12, 0.55)), wood);
      s.position.y = 0.5;
      const bk = new THREE.Mesh(own(new THREE.BoxGeometry(1.8, 0.5, 0.1)), wood);
      bk.position.set(0, 0.85, -0.25);
      for (const m of [s, bk]) {
        m.castShadow = true;
        g.add(m);
      }
      for (const lx of [-0.75, 0.75]) {
        const l = new THREE.Mesh(own(new THREE.BoxGeometry(0.08, 0.5, 0.5)), toon(0x3b4256));
        l.position.set(lx, 0.25, 0);
        g.add(l);
      }
      g.position.set(bn.x, heightAt(bn.x, bn.y), bn.y);
      // 로컬 +z(앉는 쪽 앞) 가 a 방향을 보게
      g.rotation.y = Math.PI / 2 - bn.a;
      scene.add(g);
    }

    const cols: Record<string, number[]> = {
      pink: [0xff6b8a, 0xffffff],
      yellow: [0xffd34d, 0xffffff],
      white: [0xffffff, 0xffd34d],
      purple: [0xb48cff, 0xff6b8a],
    };
    const byCol = new Map<number, { x: number; y: number }[]>();
    FLOWERS.forEach((f, fi) => {
      const n = Math.round(f.r * f.r * 9);
      for (let i = 0; i < n; i++) {
        const a = ((i * 137.5 + fi * 11) * Math.PI) / 180,
          rr = Math.sqrt((i + 0.5) / n) * f.r;
        const c = cols[f.hue][i % 5 === 0 ? 1 : 0];
        let l = byCol.get(c);
        if (!l) byCol.set(c, (l = []));
        l.push({ x: f.x + Math.cos(a) * rr, y: f.y + Math.sin(a) * rr * 0.8 });
      }
    });
    const fg = new THREE.IcosahedronGeometry(0.15, 0);
    for (const [c, list] of byCol) inst(fg.clone(), toon(c), list, 0.17, false);
    fg.dispose();
    // 꽃밭 잎사귀 바닥
    const leaf = toon(0x4f9a46);
    for (const f of FLOWERS) {
      const m = new THREE.Mesh(own(new THREE.CircleGeometry(1, 20)), leaf);
      m.scale.set(f.r + 0.3, (f.r + 0.3) * 0.8, 1);
      m.rotation.x = -Math.PI / 2;
      m.position.set(f.x, heightAt(f.x, f.y) + 0.012, f.y);
      m.receiveShadow = true;
      scene.add(m);
    }
  }

  // ── 아치 · 안내판 ──
  {
    const g = new THREE.Group();
    const stone = toon(0xf3e6cf),
      gold = toon(0xf2c14e);
    for (const p of archPosts()) {
      const ah = heightAt(p.x, p.y);
      const m = new THREE.Mesh(own(new THREE.BoxGeometry(0.8, ARCH.h, 0.8)), stone);
      m.position.set(p.x, ah + ARCH.h / 2, p.y);
      m.castShadow = true;
      withInk(scene, m, 0.1);
      const cap = new THREE.Mesh(own(new THREE.BoxGeometry(1.05, 0.3, 1.05)), gold);
      cap.position.set(p.x, ah + ARCH.h + 0.15, p.y);
      withInk(scene, cap, 0.08);
    }
    const beam = new THREE.Mesh(own(new THREE.BoxGeometry(ARCH.w + 1.4, 1.1, 0.5)), toon(0x1b2a66));
    beam.position.y = ARCH.h - 0.25;
    beam.castShadow = true;
    withInk(g, beam, 0.1);
    const sign = canvasTex(640, 110, (c, W, H) => {
      c.fillStyle = "#1b2a66";
      c.fillRect(0, 0, W, H);
      c.font = '400 78px "Black Han Sans", sans-serif';
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.lineWidth = 10;
      c.strokeStyle = "#0b1030";
      c.strokeText("GMTOWN", W / 2, H / 2 + 4);
      const gr = c.createLinearGradient(0, 10, 0, H - 10);
      gr.addColorStop(0, "#fff1b8");
      gr.addColorStop(1, "#f2b33e");
      c.fillStyle = gr;
      c.fillText("GMTOWN", W / 2, H / 2 + 4);
    });
    own(sign);
    const sp = new THREE.Mesh(
      own(new THREE.PlaneGeometry(ARCH.w, 1.0)),
      own(new THREE.MeshBasicMaterial({ map: sign }))
    );
    sp.position.set(0, ARCH.h - 0.25, 0.26);
    g.add(sp);
    g.position.set(ARCH.x, heightAt(ARCH.x, ARCH.y), ARCH.y);
    scene.add(g);

    // 안내판
    const bd = new THREE.Group();
    const post = new THREE.Mesh(own(new THREE.BoxGeometry(0.14, 1.5, 0.14)), toon(0x8a5a3b));
    post.position.y = 0.75;
    bd.add(post);
    const tex = own(woodSign("마을 안내", "눌러서 보기"));
    const board = new THREE.Mesh(own(new THREE.BoxGeometry(1.6, 0.67, 0.08)), toon(0x8a5a3b));
    board.position.y = 1.55;
    board.castShadow = true;
    withInk(bd, board, 0.06);
    const face = new THREE.Mesh(
      own(new THREE.PlaneGeometry(1.5, 0.62)),
      own(new THREE.MeshBasicMaterial({ map: tex }))
    );
    face.position.set(0, 1.55, 0.045);
    bd.add(face);
    bd.position.set(BOARD.x, heightAt(BOARD.x, BOARD.y), BOARD.y);
    bd.rotation.y = 0.3;
    scene.add(bd);
  }

  // ── 건물 ──
  const views: BuildingView[] = [];
  const pickMat = own(new THREE.MeshBasicMaterial({ visible: false }));
  for (const b of BUILDINGS) {
    const v = b.model === "stock" ? await stockBuilding(b) : codeBuilding(b);
    const ph = Math.max(2.2, b.h);
    const pick = new THREE.Mesh(own(new THREE.BoxGeometry(b.w, ph, b.d)), pickMat);
    pick.position.set(b.x + b.w / 2, heightAt(b.x + b.w / 2, b.y + b.d / 2) + ph / 2, b.y + b.d / 2);
    pick.updateMatrixWorld();
    views.push({ b, group: v.group, mats: v.mats, fade: 0, pick });
    scene.add(v.group);
  }

  /** 코드 뼈대 건물 (앞면 = 로컬 +z, 앞면 길이 = 로컬 x) */
  function codeBuilding(b: Building): { group: THREE.Group; mats: THREE.Material[] } {
    const G = new THREE.Group();
    const mats: THREE.Material[] = [];
    const W = frontLen(b),
      D = b.face === "y" || b.face === "-y" ? b.d : b.w,
      h = b.h;
    const mine = <T extends THREE.Material>(m: T) => (mats.push(own(m)), m);
    const mt = (c: THREE.ColorRepresentation, o: THREE.MeshToonMaterialParameters = {}) =>
      mine(new THREE.MeshToonMaterial({ color: c, gradientMap: grad, ...o }));
    const ink = mine(new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }));
    const box = (
      bw: number,
      bh: number,
      bd: number,
      m: THREE.Material,
      x: number,
      y: number,
      z: number,
      k = 0.14
    ) => {
      const mesh = new THREE.Mesh(own(new THREE.BoxGeometry(bw, bh, bd)), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      return withInk(G, mesh, k, ink);
    };
    const plane = (qw: number, qh: number, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(own(new THREE.PlaneGeometry(qw, qh)), m);
      mesh.position.set(x, y, z);
      G.add(mesh);
      return mesh;
    };
    // 옆면 창문은 카메라에 보이는 쪽 (face y → 로컬 +x = 동쪽 · face x → 로컬 −x = 남쪽)
    const side = b.face === "y" ? 1 : -1;

    if (isLot(b)) {
      // 빈 터: 낮은 울타리 + 팻말 + 고깔
      const wood = mt(0xc9a06a);
      const posts: [number, number][] = [];
      for (let x = -W / 2; x <= W / 2 + 0.01; x += W / 5) posts.push([x, -D / 2]);
      for (let z = -D / 2 + D / 4; z <= D / 2 + 0.01; z += D / 4)
        for (const x of [-W / 2, W / 2]) posts.push([x, z]);
      for (const [x, z] of posts) box(0.14, 0.8, 0.14, wood, x, 0.4, z, 0.05);
      box(W, 0.1, 0.06, wood, 0, 0.62, -D / 2, 0.04);
      for (const x of [-W / 2, W / 2]) box(0.06, 0.1, D, wood, x, 0.62, 0, 0.04);
      // 팻말: 앞면 가운데에서 1.2m 안 (lotSign 과 같은 자리)
      const local = { x: 0, z: D / 2 - 1.2 };
      for (const dx of [-0.9, 0.9])
        box(0.12, 1.3, 0.12, mt(0x8a5a3b), local.x + dx, 0.65, local.z, 0.04);
      const tex = own(woodSign(b.sign, b.sub));
      box(2.5, 1.08, 0.08, mt(0x8a5a3b), local.x, 1.6, local.z, 0.06);
      plane(
        2.4,
        1.0,
        mine(new THREE.MeshBasicMaterial({ map: tex })),
        local.x,
        1.6,
        local.z + 0.045
      );
      const cone = mt(0xff7a2f);
      for (const [x, z] of [
        [-W / 2 + 1.5, D / 2 - 1.4],
        [W / 2 - 1.6, D / 2 - 1.2],
        [W / 2 - 2.6, -D / 2 + 1.8],
      ]) {
        const c = new THREE.Mesh(own(new THREE.ConeGeometry(0.28, 0.7, 12)), cone);
        c.position.set(x, 0.35, z);
        c.castShadow = true;
        withInk(G, c, 0.05, ink);
        const st = new THREE.Mesh(
          own(new THREE.CylinderGeometry(0.2, 0.23, 0.12, 12)),
          mt(0xffffff)
        );
        st.position.set(x, 0.42, z);
        G.add(st);
      }
      // 흙더미
      const dirt = new THREE.Mesh(own(new THREE.SphereGeometry(1.1, 12, 8)), mt(0xb99569));
      dirt.scale.set(1, 0.45, 0.8);
      dirt.position.set(-W / 4, 0, -D / 6);
      dirt.castShadow = true;
      G.add(dirt);
    } else {
      const wallTex =
        b.style === "pixel"
          ? own(brick(b.wall, shade(b.wall, -0.32), shade(b.wall, 0.16)))
          : b.style === "noir"
            ? own(noirBrick())
            : null;
      if (wallTex) {
        wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
        wallTex.repeat.set(W / 2.2, h / 2.2);
      }
      const trim = shade(b.style === "home" ? "#D8C19A" : b.top, 0);
      const wall = wallTex ? mt(0xffffff, { map: wallTex }) : mt(b.wall);
      box(W, h, D, wall, 0, h / 2, 0);
      box(W + 0.3, 0.35, D + 0.3, mt(trim), 0, h, 0, 0.1);
      // 문
      const dw = doorW(b) + 0.4,
        dh = 2.4;
      box(dw + 0.5, dh + 0.4, 0.3, mt(trim), 0, (dh + 0.4) / 2, D / 2 + 0.05, 0.08);
      box(dw, dh, 0.3, mt(shade(b.wall, -0.55)), 0, dh / 2, D / 2 + 0.12, 0);
      plane(
        0.06,
        dh * 0.9,
        mine(new THREE.MeshBasicMaterial({ color: 0x1a1424 })),
        0,
        dh / 2,
        D / 2 + 0.28
      );
      // 창문
      const winC =
        b.style === "pixel"
          ? shade(b.accent, 0.45)
          : b.style === "home"
            ? "#CFEAFF"
            : b.style === "noir"
              ? "#FFD98A"
              : "#FFF0E0";
      const win = mt(winC, { emissive: new THREE.Color(winC).multiplyScalar(0.25) });
      const tr = mt(trim);
      const cols = Math.max(1, Math.floor((W / 2 - dw / 2 - 0.8) / 2.1));
      for (let i = 0; i < cols; i++)
        for (const s of [-1, 1]) {
          const x = s * (dw / 2 + 1.2 + i * 2.1);
          box(1.3, 1.4, 0.12, tr, x, 1.6, D / 2 + 0.04, 0.06);
          box(1.05, 1.15, 0.14, win, x, 1.6, D / 2 + 0.06, 0);
          if (h > 5.2) {
            box(1.3, 1.3, 0.12, tr, x, h - 1.7, D / 2 + 0.04, 0.06);
            box(1.05, 1.05, 0.14, win, x, h - 1.7, D / 2 + 0.06, 0);
          }
        }
      for (let i = 0; i < Math.floor(D / 2.4); i++) {
        const z = -D / 2 + 1.6 + i * 2.4;
        box(0.12, 1.3, 1.1, win, side * (W / 2 + 0.04), h > 5.2 ? h - 1.7 : 1.8, z, 0.06);
        if (h > 5.2) box(0.12, 1.3, 1.1, win, side * (W / 2 + 0.04), 1.7, z, 0.06);
      }
      // 간판
      const tex =
        b.style === "pixel"
          ? pixelSign(b.sign.toUpperCase(), shade(b.top, -0.2), shade(b.accent, 0.25), b.accent)
          : b.style === "anime"
            ? animeSign(
                b.sign,
                b.id === "love" ? "#FF5C8A" : "#5A1529",
                b.id === "love" ? "#FFFFFF" : "#FFE08A",
                b.id === "love" ? "#FFD1E0" : "#FFD36B"
              )
            : b.style === "noir"
              ? noirSign(b.sign)
              : woodSign(b.sign);
      own(tex);
      const img = tex.image as HTMLCanvasElement;
      const sw = Math.min(
          W * 0.8,
          b.style === "home" ? 3.4 : b.style === "anime" ? W * 0.74 : W * 0.72
        ),
        sh = (sw * img.height) / img.width;
      const sy = Math.max(dh + 0.5 + sh / 2, Math.min(h - 0.6 - sh / 2, h * 0.62));
      box(sw + 0.18, sh + 0.18, 0.16, mt(0x2b2433), 0, sy, D / 2 + 0.1, 0);
      plane(
        sw,
        sh,
        mine(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })),
        0,
        sy,
        D / 2 + 0.19
      );
      // 지붕
      const pr = mt(b.top);
      const parapet = (hh: number) => {
        box(W, hh, 0.3, pr, 0, h + hh / 2 + 0.15, D / 2 - 0.15, 0.08);
        box(W, hh, 0.3, pr, 0, h + hh / 2 + 0.15, -D / 2 + 0.15, 0.08);
        box(0.3, hh, D, pr, W / 2 - 0.15, h + hh / 2 + 0.15, 0, 0.08);
        box(0.3, hh, D, pr, -W / 2 + 0.15, h + hh / 2 + 0.15, 0, 0.08);
      };
      if (b.roof === "flat" || b.roof === "castle") {
        parapet(0.5);
        if (b.roof === "flat") {
          box(1.2, 0.7, 0.9, mt(0xd7dbe3), -W * 0.22, h + 0.5, -D * 0.1, 0.08);
          box(0.9, 0.6, 0.9, mt(0xd7dbe3), W * 0.25, h + 0.45, -D * 0.18, 0.08);
        }
      }
      if (b.roof === "castle") {
        for (let x = -W / 2 + 0.4; x <= W / 2 - 0.3; x += 1.0)
          box(0.55, 0.6, 0.5, wall, x, h + 0.95, D / 2 - 0.25, 0.06);
        const tw = new THREE.Mesh(own(new THREE.CylinderGeometry(1.3, 1.4, h + 3, 12)), wall);
        tw.position.set(-W / 2 + 1.1, (h + 3) / 2, -D / 2 + 1.2);
        tw.castShadow = true;
        withInk(G, tw, 0.16, ink);
        const cn = new THREE.Mesh(own(new THREE.ConeGeometry(1.75, 2.4, 12)), mt(0x4a8f3f));
        cn.position.set(-W / 2 + 1.1, h + 4.2, -D / 2 + 1.2);
        cn.castShadow = true;
        withInk(G, cn, 0.12, ink);
        const fl = plane(
          0.9,
          0.55,
          mine(new THREE.MeshBasicMaterial({ color: b.accent, side: THREE.DoubleSide })),
          -W / 2 + 1.55,
          h + 6.0,
          -D / 2 + 1.2
        );
        fl.userData.flag = true;
      }
      if (b.roof === "awning") {
        const aw = new THREE.Mesh(
          own(new THREE.BoxGeometry(W + 0.4, 0.18, 1.7)),
          mt(0xffffff, { map: own(stripes(b.accent, "#fff6ea")) })
        );
        aw.position.set(0, dh + 0.75, D / 2 + 0.8);
        aw.rotation.x = 0.35;
        aw.castShadow = true;
        G.add(aw);
        parapet(0.6);
        const bush = mt(0x5aa04a);
        for (let i = 0; i < 5; i++) {
          const p = new THREE.Mesh(own(new THREE.SphereGeometry(0.42, 10, 8)), bush);
          p.position.set(-W / 2 + 1 + (i * (W - 2)) / 4, h + 0.7, D / 2 - 0.6);
          p.castShadow = true;
          G.add(p);
        }
      }
      if (b.roof === "gable") {
        const s2 = new THREE.Shape();
        s2.moveTo(-W / 2 - 0.5, 0);
        s2.lineTo(0, 2.6);
        s2.lineTo(W / 2 + 0.5, 0);
        s2.lineTo(-W / 2 - 0.5, 0);
        const rg = own(new THREE.ExtrudeGeometry(s2, { depth: D + 0.8, bevelEnabled: false }));
        rg.translate(0, 0, -(D + 0.8) / 2);
        const rf = new THREE.Mesh(rg, mt(b.top));
        rf.position.y = h + 0.2;
        rf.castShadow = true;
        G.add(rf);
        const rk = new THREE.Mesh(rg, ink);
        rk.position.copy(rf.position);
        rk.scale.set(1.02, 1.04, 1.02);
        G.add(rk);
        box(0.8, 1.8, 0.8, mt(0x9a5a3a), W * 0.25, h + 1.9, -D * 0.15, 0.08);
        // 앞마당 화분
        for (const x of [-dw / 2 - 0.7, dw / 2 + 0.7]) {
          const pot = new THREE.Mesh(
            own(new THREE.CylinderGeometry(0.3, 0.24, 0.45, 12)),
            mt(0xc0603a)
          );
          pot.position.set(x, 0.22, D / 2 + 0.55);
          pot.castShadow = true;
          G.add(pot);
          const pl = new THREE.Mesh(own(new THREE.IcosahedronGeometry(0.34, 0)), mt(0x5aa04a));
          pl.position.set(x, 0.62, D / 2 + 0.55);
          G.add(pl);
        }
      }
    }
    G.position.set(b.x + b.w / 2, heightAt(b.x + b.w / 2, b.y + b.d / 2), b.y + b.d / 2);
    G.rotation.y = faceRot(b);
    return { group: G, mats };
  }

  /** 증권거래소: 3D 모델 + 덧칠 그림 투사 + 전광판 · 간판 (글씨는 코드) */
  async function stockBuilding(
    b: Building
  ): Promise<{ group: THREE.Group; mats: THREE.Material[] }> {
    const [gl, paint, meta] = await Promise.all([
      new GLTFLoader().loadAsync(TOWN_FILES.stockGlb),
      tl.loadAsync(TOWN_FILES.stockPaint),
      fetch(TOWN_FILES.stockJson).then((r) => r.json() as Promise<StockMeta>),
    ]);
    own(paint);
    paint.colorSpace = THREE.SRGBColorSpace;
    paint.anisotropy = 8;
    const G = new THREE.Group();
    const model = gl.scene;
    G.add(model);
    G.position.set(b.x + b.w / 2, 0, b.y + b.d / 2);
    G.updateMatrixWorld(true);
    // 덧칠 그림을 찍은 직교 카메라 (모델 공간) → 지금 놓인 자리 기준으로
    const r = meta.ref;
    const rc = new THREE.OrthographicCamera(r.left, r.right, r.top, r.bottom, 0.1, 500);
    rc.position.fromArray(r.camPos);
    rc.lookAt(new THREE.Vector3().fromArray(r.center));
    rc.updateMatrixWorld();
    rc.updateProjectionMatrix();
    const P = new THREE.Matrix4()
      .multiplyMatrices(rc.projectionMatrix, rc.matrixWorldInverse)
      .multiply(G.matrixWorld.clone().invert());
    const mat = own(
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: paint },
          P: { value: P },
          inflate: { value: 0.06 },
          alpha: { value: 1 },
        },
        vertexShader:
          "uniform mat4 P; uniform float inflate; varying vec4 vp;\nvoid main(){ vec3 p = position + normal * inflate; vec4 w = modelMatrix * vec4(p, 1.0); vp = P * w; gl_Position = projectionMatrix * viewMatrix * w; }",
        fragmentShader:
          "uniform sampler2D map; uniform float alpha; varying vec4 vp;\nvoid main(){ vec2 uv = vp.xy / vp.w * 0.5 + 0.5; vec4 c = texture2D(map, uv); if (c.a < 0.5) discard; gl_FragColor = vec4(c.rgb, alpha);\n#include <colorspace_fragment>\n}",
      })
    );
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        own(m.geometry);
        m.material = mat;
        m.castShadow = true;
      }
    });
    const mats: THREE.Material[] = [mat];
    const panel = (q: number[][], tex: THREE.Texture) => {
      const geo = own(new THREE.BufferGeometry());
      geo.setAttribute("position", new THREE.Float32BufferAttribute(q.flat(), 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
      geo.setIndex([0, 3, 1, 1, 3, 2]);
      const m = own(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      mats.push(m);
      model.add(new THREE.Mesh(geo, m));
    };
    const L = (a: number[], b2: number[]) => Math.hypot(a[0] - b2[0], a[1] - b2[1], a[2] - b2[2]);
    ticker = own(tickerTex());
    ticker.repeat.set(
      L(meta.band[0], meta.band[1]) / L(meta.band[0], meta.band[3]) / (2048 / 160),
      1
    );
    panel(meta.band, ticker);
    panel(
      meta.sign,
      own(
        canvasTex(
          Math.round((160 * L(meta.sign[0], meta.sign[1])) / L(meta.sign[0], meta.sign[3])),
          160,
          (g, W, H) => {
            g.fillStyle = "#1b2a66";
            g.fillRect(0, 0, W, H);
            g.textAlign = "center";
            g.textBaseline = "middle";
            const fs = Math.round(H * 0.74);
            g.font = `400 ${fs}px "Black Han Sans", sans-serif`;
            g.lineWidth = fs * 0.16;
            g.strokeStyle = "#0b1030";
            g.strokeText(b.sign, W / 2, H / 2 + 4);
            g.fillStyle = "#ffe08a";
            g.fillText(b.sign, W / 2, H / 2 + 4);
          }
        )
      )
    );
    return { group: G, mats };
  }

  // 문 앞 고리 · 가는 곳 고리
  const doorRing = new THREE.Mesh(
    own(new THREE.RingGeometry(0.75, 0.95, 40)),
    own(
      new THREE.MeshBasicMaterial({
        color: 0xfff1b8,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      })
    )
  );
  doorRing.rotation.x = -Math.PI / 2;
  doorRing.visible = false;
  doorRing.renderOrder = 2;
  scene.add(doorRing);
  const goalRing = new THREE.Mesh(
    own(new THREE.RingGeometry(0.26, 0.36, 32)),
    own(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      })
    )
  );
  goalRing.rotation.x = -Math.PI / 2;
  goalRing.visible = false;
  goalRing.renderOrder = 2;
  scene.add(goalRing);

  const flags: THREE.Object3D[] = [];
  scene.traverse((o) => o.userData.flag && flags.push(o));

  return {
    scene,
    ground,
    sun,
    buildings: views,
    doorRing,
    goalRing,
    setView(eye: THREE.Vector3, focus: THREE.Vector3) {
      treeView.uEye.value.copy(eye);
      treeView.uFocus.value.copy(focus);
    },
    tick(t: number) {
      if (ticker) ticker.offset.x = (t * 0.035) % 1;
      // 분수: 물줄기 출렁 · 물방울 둥글게
      const [cone, ...drops] = spray;
      if (cone) cone.scale.y = 1 + Math.sin(t * 6) * 0.12;
      drops.forEach((d) => {
        const a = (d.userData.a as number) + t * 0.6;
        const u = (t * 0.9 + (d.userData.a as number)) % 1;
        d.position.set(
          FOUNTAIN.x + Math.cos(a) * (0.6 + u * 1.6),
          2.6 - u * u * 2.2,
          FOUNTAIN.y + Math.sin(a) * (0.6 + u * 1.6)
        );
      });
      for (const f of flags) f.rotation.y = Math.sin(t * 3 + f.position.x) * 0.35;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      scene.clear();
    },
  };
}

interface StockMeta {
  ref: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    camPos: number[];
    center: number[];
  };
  band: number[][];
  sign: number[][];
}

/** 색 밝게(+) · 어둡게(−) */
function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  if (k >= 0) c.lerp(new THREE.Color(0xffffff), k);
  else c.multiplyScalar(1 + k);
  return `#${c.getHexString()}`;
}

/** 문 앞 표시 자리 */
export const doorRingAt = (b: Building) => doorFront(b);
