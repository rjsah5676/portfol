import * as THREE from "three";
import {
  CELL,
  FLOOR_H,
  FURNITURE,
  HOME_AT,
  LV_STAIR,
  enterAt,
  footprint,
  furnById,
  houseGeo,
  levelH,
  nextLevel,
  stairT,
  type FurnKind,
  type HouseGeo,
  type Placed,
} from "@/lib/gmtown/house";

/*
 * 집 안 장면 (심즈식) — 마을 장면 안 멀리 떨어진 곳(HOME_AT)에 방을 지음. 마을 해 · 그림자 · 캐릭터 그대로 씀.
 * 벽: 카메라 쪽을 보는 벽은 낮게 잘라서(컷어웨이) 방 안이 보이게. 가구: 코드로 만든 툰 덩어리 + 외곽선.
 * 좌표: 칸 (0, 0) 의 왼쪽 위 = (ox, oy) (땅 x, y). 칸 (cx, cy) 의 가운데 = ox + (cx + 0.5) * CELL.
 * 2층 집: 왼쪽 벽 계단으로 오르내림 (lib/gmtown/house.ts nextLevel). 1층에 있으면 2층은 통째로 숨김 (심즈처럼).
 * 정원 주택: 집 앞 마당 (잔디 · 돌길 · 울타리 · 대문) — 나가기는 대문에서.
 */

export { HOME_AT };
const WALL_H = 2.6;
const WALL_T = 0.16;
const INK = 0x2b2433;

export interface HouseScene {
  group: THREE.Group;
  geo: HouseGeo;
  /** 집 가운데 (마당 포함) · 크기(m) — 카메라용 */
  wm: number;
  dm: number;
  /** 뒤 배경 색 */
  bg: number;
  /** 들어왔을 때 서는 곳 */
  enter: { x: number; y: number };
  /** 나가는 곳(문 · 대문)에 닿았는지 */
  atDoor(x: number, y: number): boolean;
  /** 몸 반지름 r 이 (지금 층에서) 들어갈 수 없는 곳 */
  blocked(x: number, y: number, r: number): boolean;
  /** 움직인 뒤 (계단 오르내림 · 2층 보이기) */
  moved(x: number, y: number): void;
  /** 지금 층 (0 · 1 · 2 = 계단 위) · 발 높이 */
  level(): number;
  heightAt(x: number, y: number): number;
  /** 보이는 층 (꾸미기 · 누르기 바닥) */
  viewFloor(): number;
  /** 꾸미기에서 볼 층을 고름 (null = 내가 있는 층) */
  setView(f: number | null): void;
  /** 땅 좌표 → 칸 (보이는 층) */
  cellAt(x: number, y: number): { cx: number; cy: number } | null;
  setLayout(layout: Placed[]): void;
  /** 꾸미기: 놓을 가구 미리 보기 (null 이면 숨김) · 놓을 수 있는지 색 */
  setGhost(g: { i: FurnKind; cx: number; cy: number; r: number; ok: boolean } | null): void;
  /** 꾸미기 모드: 바닥 칸 선 · 고른 가구 테두리 */
  setBuild(on: boolean, sel?: number | null): void;
  /** 카메라 쪽 벽 낮추기 (매 프레임) */
  update(eye: THREE.Vector3): void;
  dispose(): void;
}

function grad(): THREE.DataTexture {
  const d = new Uint8Array([150, 150, 150, 255, 205, 205, 205, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(d, 3, 1);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, rx = 1, ry = 1) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 4;
  return t;
}

export function buildHouse(tier: number, layout: Placed[]): HouseScene {
  const geo = houseGeo(tier);
  const { ox, oy, wm, dm, w: GW, d: GD, gd: GGD, stair: S, yard } = geo;
  const ym = geo.gd * CELL;
  const group = new THREE.Group();
  /** 1층 · 2층 */
  const L0 = new THREE.Group(),
    L1 = new THREE.Group();
  group.add(L0, L1);
  L1.visible = false;
  const disp: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T) => (disp.push(x), x);
  const G = own(grad());
  const mats = new Map<string, THREE.MeshToonMaterial>();
  const toon = (c: THREE.ColorRepresentation, o: THREE.MeshToonMaterialParameters = {}) => {
    const k = String(c) + (o.map ? o.map.uuid : "") + (o.emissive ?? "");
    let m = mats.get(k);
    if (!m) mats.set(k, (m = own(new THREE.MeshToonMaterial({ color: c, gradientMap: G, ...o }))));
    return m;
  };
  const inkM = own(new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }));
  /** 덩어리 + 외곽선 (뒤집은 껍데기를 살짝 키움) */
  const solid = (g0: THREE.BufferGeometry, m: THREE.Material, ink = 0.02) => {
    own(g0);
    const g = new THREE.Group();
    const a = new THREE.Mesh(g0, m);
    a.castShadow = true;
    a.receiveShadow = true;
    g.add(a);
    if (ink) {
      g0.computeBoundingBox();
      const s = new THREE.Vector3();
      g0.boundingBox!.getSize(s);
      const k = new THREE.Mesh(g0, inkM);
      k.scale.set(1 + ink / Math.max(0.05, s.x), 1 + ink / Math.max(0.05, s.y), 1 + ink / Math.max(0.05, s.z));
      g.add(k);
    }
    return g;
  };
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ink = 0.025) => {
    const o = solid(new THREE.BoxGeometry(w, h, d), m, ink);
    o.position.set(x, y + h / 2, z);
    return o;
  };
  const cyl = (rt: number, rb: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 16, ink = 0.02) => {
    const o = solid(new THREE.CylinderGeometry(rt, rb, h, seg), m, ink);
    o.position.set(x, y + h / 2, z);
    return o;
  };
  const ball = (r: number, m: THREE.Material, x: number, y: number, z: number, ink = 0.02) => {
    const o = solid(new THREE.SphereGeometry(r, 14, 10), m, ink);
    o.position.set(x, y, z);
    return o;
  };
  const plane = (w: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const p = new THREE.Mesh(own(new THREE.PlaneGeometry(w, d)), m);
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, y, z);
    p.receiveShadow = true;
    return p;
  };

  // ── 바닥: 나무 마루 (1층 · 2층) ──
  const floorT = own(
    canvasTex(
      256,
      256,
      (g) => {
        const cols = ["#d9a873", "#cf9d68", "#e0b27e", "#d3a26c"];
        for (let i = 0; i < 8; i++) {
          g.fillStyle = cols[i % 4];
          g.fillRect(0, i * 32, 256, 32);
          g.fillStyle = "rgba(120,70,30,0.35)";
          g.fillRect(0, i * 32, 256, 2);
          const off = (i % 2) * 128 + 40;
          g.fillRect(off, i * 32, 2, 32);
          g.fillRect((off + 128) % 256, i * 32, 2, 32);
        }
      },
      1,
      1
    )
  );
  /** 마루 판 하나 (텍스처 반복은 크기에 맞춰) */
  const floorM = (w: number, d: number) => {
    const t = own(floorT.clone());
    t.repeat.set(w / 2, d / 2);
    t.needsUpdate = true;
    return toon(0xffffff, { map: t });
  };
  L0.add(plane(wm, dm, floorM(wm, dm), ox + wm / 2, 0, oy + dm / 2));

  // 바깥 (방 밖이 허공으로 안 보이게) — 원룸 · 투룸 · 2층 집은 어두운 판, 정원 주택은 넓은 잔디
  const grassT = own(
    canvasTex(
      128,
      128,
      (g) => {
        g.fillStyle = "#8fcf6a";
        g.fillRect(0, 0, 128, 128);
        for (let i = 0; i < 260; i++) {
          g.fillStyle = i % 3 ? "rgba(70,140,60,0.35)" : "rgba(200,240,150,0.45)";
          g.fillRect((i * 53) % 128, (i * 97) % 128, 2, 4);
        }
      },
      1,
      1
    )
  );
  const grassM = (w: number, d: number) => {
    const t = own(grassT.clone());
    t.repeat.set(w / 1.6, d / 1.6);
    t.needsUpdate = true;
    return toon(0xffffff, { map: t });
  };
  if (yard) group.add(plane(wm + 60, ym + 60, toon(0x6fae55), HOME_AT.x, -0.03, HOME_AT.y));
  else group.add(plane(wm + 40, ym + 40, toon(0x2a2433), HOME_AT.x, -0.02, HOME_AT.y));

  // ── 벽: 파스텔 벽지 + 걸레받이 ──
  const paper = own(
    canvasTex(
      128,
      128,
      (g) => {
        g.fillStyle = "#f7e9e0";
        g.fillRect(0, 0, 128, 128);
        g.fillStyle = "#f1d9cf";
        for (let x = 0; x < 128; x += 32) g.fillRect(x, 0, 12, 128);
        g.fillStyle = "rgba(255,255,255,0.6)";
        for (let y = 16; y < 128; y += 32) for (let x = 22; x < 128; x += 32) g.fillRect(x, y, 3, 3);
      },
      1,
      1
    )
  );
  const paper2 = own(
    canvasTex(
      128,
      128,
      (g) => {
        g.fillStyle = "#e6f0ea";
        g.fillRect(0, 0, 128, 128);
        g.fillStyle = "#d5e6dc";
        for (let y = 0; y < 128; y += 32) g.fillRect(0, y, 128, 10);
        g.fillStyle = "rgba(255,255,255,0.7)";
        for (let y = 20; y < 128; y += 32) for (let x = 8; x < 128; x += 24) g.fillRect(x, y, 4, 4);
      },
      1,
      1
    )
  );
  type Wall = { g: THREE.Group; n: THREE.Vector3; lv: number };
  const walls: Wall[] = [];
  const wallM = (len: number, tex: THREE.Texture) => {
    const t = own(tex.clone());
    t.repeat.set(len / 1.2, WALL_H / 1.2);
    t.needsUpdate = true;
    return toon(0xffffff, { map: t });
  };
  const trim = toon(0xb98a5e);
  const siding = toon(0xfff4e2);
  /** 벽 하나 (x0,y0 → x1,y1, 바깥 법선 nx,ny, 문 틈 gap = 따라가는 거리 [a, b]) — base: 바닥 높이 */
  const mkWall = (
    parent: THREE.Group,
    lv: number,
    base: number,
    tex: THREE.Texture,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    nx: number,
    ny: number,
    gap?: [number, number],
    outside = false
  ) => {
    const g = new THREE.Group();
    g.position.y = base;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const horiz = Math.abs(y1 - y0) < 1e-6;
    const at = (a: number) => ({ x: x0 + ((x1 - x0) * a) / len, y: y0 + ((y1 - y0) * a) / len });
    const along = (a: number, b: number) => {
      const l = b - a;
      if (l <= 0.01) return;
      const c = at((a + b) / 2);
      const w = horiz ? l : WALL_T,
        d = horiz ? WALL_T : l;
      g.add(box(w, WALL_H, d, wallM(l, tex), c.x, 0, c.y, 0.03));
      g.add(box(horiz ? l : WALL_T + 0.03, 0.14, horiz ? WALL_T + 0.03 : l, trim, c.x - nx * 0.01, 0, c.y - ny * 0.01, 0.0));
      // 바깥에서 보이는 벽(마당 쪽): 바깥 면에 판자 외벽
      if (outside) g.add(box(horiz ? l : 0.03, WALL_H, horiz ? 0.03 : l, siding, c.x + nx * (WALL_T / 2 + 0.015), 0, c.y + ny * (WALL_T / 2 + 0.015), 0.0));
    };
    if (gap) {
      along(0, gap[0]);
      along(gap[1], len);
      const c = at((gap[0] + gap[1]) / 2);
      g.add(box(gap[1] - gap[0], 0.5, WALL_T, wallM(gap[1] - gap[0], tex), c.x, WALL_H - 0.5, c.y, 0.03));
      g.add(box(gap[1] - gap[0] + 0.16, 0.12, WALL_T + 0.06, trim, c.x, WALL_H - 0.56, c.y, 0.01));
      for (const s of [gap[0], gap[1]]) {
        const p = at(s);
        g.add(box(0.1, WALL_H - 0.5, WALL_T + 0.06, trim, p.x, 0, p.y, 0.01));
      }
    } else along(0, len);
    parent.add(g);
    walls.push({ g, n: new THREE.Vector3(nx, 0, ny), lv });
    return g;
  };
  const x0 = ox,
    x1 = ox + wm,
    y0 = oy,
    y1 = oy + dm;
  const sky = own(
    canvasTex(64, 64, (g) => {
      const gr = g.createLinearGradient(0, 0, 0, 64);
      gr.addColorStop(0, "#8fd0ff");
      gr.addColorStop(1, "#e4f6ff");
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.beginPath();
      g.arc(20, 40, 8, 0, Math.PI * 2);
      g.arc(30, 36, 10, 0, Math.PI * 2);
      g.arc(42, 41, 7, 0, Math.PI * 2);
      g.fill();
    })
  );
  const skyM = own(new THREE.MeshBasicMaterial({ map: sky }));
  /** 뒤벽 창문 (하늘 · 커튼) */
  const windows = (back: THREE.Group, cur: number) => {
    const winN = Math.max(1, Math.floor(wm / 3.2));
    for (let i = 0; i < winN; i++) {
      const cx = ox + (wm * (i + 0.5)) / winN;
      const glass = new THREE.Mesh(own(new THREE.PlaneGeometry(1.1, 0.95)), skyM);
      glass.position.set(cx, 1.55, y0 + 0.005);
      back.add(glass);
      back.add(box(1.24, 0.08, 0.06, trim, cx, 1.04, y0 + 0.02, 0.01));
      back.add(box(1.24, 0.08, 0.06, trim, cx, 1.98, y0 + 0.02, 0.01));
      back.add(box(0.07, 1.0, 0.06, trim, cx - 0.585, 1.04, y0 + 0.02, 0.01));
      back.add(box(0.07, 1.0, 0.06, trim, cx + 0.585, 1.04, y0 + 0.02, 0.01));
      back.add(box(0.05, 0.95, 0.04, trim, cx, 1.06, y0 + 0.02, 0.0));
      back.add(box(1.4, 0.06, 0.18, trim, cx, 1.0, y0 + 0.09, 0.01));
      const c = toon(cur);
      back.add(box(0.26, 1.15, 0.05, c, cx - 0.72, 0.95, y0 + 0.06, 0.015));
      back.add(box(0.26, 1.15, 0.05, c, cx + 0.72, 0.95, y0 + 0.06, 0.015));
    }
  };
  const dcx0 = ox + geo.door.x0 * CELL,
    dcx1 = ox + (geo.door.x1 + 1) * CELL;
  // 1층 벽
  windows(mkWall(L0, 0, 0, paper, x0 - WALL_T / 2, y0 - WALL_T / 2, x1 + WALL_T / 2, y0 - WALL_T / 2, 0, -1), 0xf4b7c8);
  mkWall(L0, 0, 0, paper, x0 - WALL_T / 2, y0, x0 - WALL_T / 2, y1, -1, 0);
  mkWall(L0, 0, 0, paper, x1 + WALL_T / 2, y0, x1 + WALL_T / 2, y1, 1, 0);
  mkWall(L0, 0, 0, paper, x0 - WALL_T / 2, y1 + WALL_T / 2, x1 + WALL_T / 2, y1 + WALL_T / 2, 0, 1, [dcx0 - x0 + WALL_T / 2, dcx1 - x0 + WALL_T / 2], !!yard);
  // 문 깔개
  L0.add(box(dcx1 - dcx0, 0.02, 0.5, toon(0x9b6b4a), (dcx0 + dcx1) / 2, 0, y1 - 0.3, 0.0));

  // ── 마당 (정원 주택) ──
  if (yard) {
    const yy0 = y1,
      yy1 = oy + ym;
    L0.add(plane(wm, yy1 - yy0, grassM(wm, yy1 - yy0), ox + wm / 2, 0.002, (yy0 + yy1) / 2));
    // 문 → 대문 돌길
    const stoneM = toon(0xd9d2c4);
    for (let y = yy0 + 0.35; y < yy1 - 0.1; y += 0.55) {
      L0.add(cyl(0.26, 0.27, 0.03, stoneM, (dcx0 + dcx1) / 2 - 0.16, 0, y, 10, 0.012));
      L0.add(cyl(0.22, 0.23, 0.03, stoneM, (dcx0 + dcx1) / 2 + 0.2, 0, y + 0.25, 10, 0.012));
    }
    // 하얀 울타리 (양옆 · 앞, 앞 가운데 대문)
    const fenceM = toon(0xfffaf0);
    const fence = (ax: number, ay: number, bx: number, by: number) => {
      const len = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.round(len / 0.32));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        L0.add(box(0.08, 0.72, 0.05, fenceM, ax + (bx - ax) * t, 0, ay + (by - ay) * t, 0.012));
      }
      const h = Math.abs(by - ay) < 1e-6;
      for (const y of [0.22, 0.52]) L0.add(box(h ? len : 0.04, 0.06, h ? 0.04 : len, fenceM, (ax + bx) / 2, y, (ay + by) / 2, 0.01));
    };
    fence(x0 - 0.05, yy0 + 0.1, x0 - 0.05, yy1);
    fence(x1 + 0.05, yy0 + 0.1, x1 + 0.05, yy1);
    fence(x0 - 0.05, yy1, dcx0 - 0.05, yy1);
    fence(dcx1 + 0.05, yy1, x1 + 0.05, yy1);
    // 대문 기둥 · 우편함
    for (const x of [dcx0 - 0.08, dcx1 + 0.08]) {
      L0.add(box(0.16, 0.95, 0.16, fenceM, x, 0, yy1, 0.015));
      L0.add(ball(0.08, toon(0xe8c25a), x, 1.0, yy1, 0.01));
    }
    L0.add(box(0.05, 0.9, 0.05, toon(0x8f5e36), dcx1 + 0.45, 0, yy1 - 0.15, 0.01));
    L0.add(box(0.32, 0.24, 0.22, toon(0xe86a6a), dcx1 + 0.45, 0.9, yy1 - 0.15, 0.015));
    // 울타리 밖 덤불
    for (let i = 0; i < 9; i++) {
      const x = x0 - 1.2 - (i % 2) * 0.5,
        y = yy0 + ((yy1 - yy0) * i) / 8;
      L0.add(ball(0.45 + (i % 3) * 0.12, toon(0x4f9a46), x, 0.3, y, 0.02));
      L0.add(ball(0.42 + ((i + 1) % 3) * 0.12, toon(0x5aa84d), x1 + 1.2 + (i % 2) * 0.5, 0.3, y + 0.3, 0.02));
    }
  }

  // ── 2층 · 계단 ──
  const SLAB = FLOOR_H - WALL_H;
  if (S) {
    const sx0 = ox + S.x0 * CELL,
      sx1 = ox + S.x1 * CELL,
      sy0 = oy + S.y0 * CELL,
      sy1 = oy + S.y1 * CELL;
    // 계단 (14 단, 앞 → 뒤로 올라감)
    const N = 14,
      run = (sy1 - sy0) / N,
      rise = FLOOR_H / N;
    const stepM = toon(0xc58b55),
      sideM = toon(0xf3e3c8);
    for (let i = 0; i < N; i++) {
      const ya = sy1 - (i + 1) * run;
      L0.add(box(sx1 - sx0 - 0.02, rise * (i + 1), run + 0.01, i % 2 ? stepM : toon(0xcf9560), (sx0 + sx1) / 2, 0, ya + run / 2, 0.012));
    }
    // 오른쪽 옆판 · 난간 (기울어진 손잡이)
    for (let i = 1; i < N; i += 3) {
      const y = sy1 - (i + 0.5) * run;
      L0.add(box(0.05, 0.9, 0.05, toon(0x8f5e36), sx1 - 0.06, rise * (i + 1), y, 0.01));
    }
    const rail = box(0.07, 0.06, Math.hypot(sy1 - sy0, FLOOR_H) + 0.1, toon(0x8f5e36), 0, 0, 0, 0.012);
    rail.position.set(sx1 - 0.06, 0.9 + FLOOR_H / 2 + 0.05, (sy0 + sy1) / 2);
    rail.rotation.x = Math.atan2(FLOOR_H, sy1 - sy0);
    L0.add(rail);
    void sideM;
    // 2층 바닥판 (계단 구멍만 빼고) — 판 위가 FLOOR_H
    const slab = (ax: number, ay: number, bx: number, by: number) => {
      if (bx - ax < 0.01 || by - ay < 0.01) return;
      L1.add(box(bx - ax, SLAB, by - ay, toon(0xe9d9c2), (ax + bx) / 2, WALL_H, (ay + by) / 2, 0.0));
      L1.add(plane(bx - ax, by - ay, floorM(bx - ax, by - ay), (ax + bx) / 2, FLOOR_H + 0.002, (ay + by) / 2));
    };
    slab(x0, y0, x1, sy0);
    slab(x0, sy1, x1, y1);
    slab(sx1, sy0, x1, sy1);
    // 구멍 둘레 난간 (오른쪽 · 앞) — 위쪽 끝(뒤)은 드나드는 곳이라 열림
    const railM = toon(0x8f5e36),
      openTo = sy0 + 2 * CELL;
    for (let y = openTo; y <= sy1 + 0.01; y += 0.4) L1.add(box(0.05, 0.9, 0.05, railM, sx1 + 0.03, FLOOR_H, y, 0.01));
    L1.add(box(0.07, 0.06, sy1 - openTo, railM, sx1 + 0.03, FLOOR_H + 0.9, (openTo + sy1) / 2, 0.012));
    for (let x = sx0 + 0.1; x <= sx1 + 0.01; x += 0.4) L1.add(box(0.05, 0.9, 0.05, railM, x, FLOOR_H, sy1 + 0.03, 0.01));
    L1.add(box(sx1 - sx0, 0.06, 0.07, railM, (sx0 + sx1) / 2, FLOOR_H + 0.9, sy1 + 0.03, 0.012));
    // 2층 벽 (문 없음 · 연두 벽지)
    windows(mkWall(L1, 1, FLOOR_H, paper2, x0 - WALL_T / 2, y0 - WALL_T / 2, x1 + WALL_T / 2, y0 - WALL_T / 2, 0, -1), 0xa9d8f0);
    mkWall(L1, 1, FLOOR_H, paper2, x0 - WALL_T / 2, y0, x0 - WALL_T / 2, y1, -1, 0);
    mkWall(L1, 1, FLOOR_H, paper2, x1 + WALL_T / 2, y0, x1 + WALL_T / 2, y1, 1, 0);
    mkWall(L1, 1, FLOOR_H, paper2, x0 - WALL_T / 2, y1 + WALL_T / 2, x1 + WALL_T / 2, y1 + WALL_T / 2, 0, 1, undefined, !!yard);
  }

  // ── 가구 ──
  const F = {
    wood: toon(0xc58b55),
    woodD: toon(0x8f5e36),
    white: toon(0xfbf8f2),
    cream: toon(0xf3e3c8),
    pink: toon(0xf6a9bf),
    mint: toon(0x8fd8c0),
    blue: toon(0x8bb8ee),
    navy: toon(0x3d4d7a),
    purple: toon(0xb79ce8),
    green: toon(0x6cbf5a),
    greenD: toon(0x3f8f44),
    terra: toon(0xc8714a),
    black: toon(0x2a2a33),
    gold: toon(0xe8c25a),
    coral: toon(0xff8f7a),
    coralD: toon(0xf26f6f, { side: THREE.DoubleSide }),
    soil: toon(0x6b4a33),
    stone: toon(0xd9d6cf),
    water: toon(0x7fc8f0, { emissive: 0x1a4a6a }),
    screen: toon(0x334a7a, { emissive: 0x1f3a6a }),
    lampS: toon(0xfff1c2, { emissive: 0x8a6a20 }),
  };
  const rugT = own(
    canvasTex(128, 96, (g) => {
      g.fillStyle = "#f5c2a6";
      g.fillRect(0, 0, 128, 96);
      g.strokeStyle = "#fff4e6";
      g.lineWidth = 6;
      g.strokeRect(8, 8, 112, 80);
      g.fillStyle = "#e88f8f";
      for (let i = 0; i < 5; i++) {
        g.beginPath();
        g.arc(24 + i * 20, 48, 6, 0, Math.PI * 2);
        g.fill();
      }
    })
  );
  const builders: Record<FurnKind, (w: number, d: number) => THREE.Group> = {
    bed: (w, d) => {
      const g = new THREE.Group();
      g.add(box(w - 0.06, 0.28, d - 0.06, F.wood, 0, 0.0, 0));
      g.add(box(w - 0.14, 0.16, d - 0.2, F.white, 0, 0.28, 0.05));
      g.add(box(w - 0.1, 0.12, d * 0.62, F.pink, 0, 0.36, d * 0.17));
      g.add(box(w * 0.62, 0.12, 0.34, F.white, 0, 0.44, -d / 2 + 0.32));
      g.add(box(w - 0.02, 0.9, 0.1, F.woodD, 0, 0, -d / 2 + 0.05));
      return g;
    },
    desk: (w, d) => {
      const g = new THREE.Group();
      g.add(box(w - 0.08, 0.06, d - 0.1, F.wood, 0, 0.7, 0));
      for (const sx of [-1, 1]) g.add(box(0.06, 0.7, d - 0.16, F.woodD, sx * (w / 2 - 0.1), 0, 0, 0.015));
      g.add(box(0.42, 0.34, d - 0.16, F.wood, w / 2 - 0.32, 0.36, 0, 0.015));
      g.add(box(0.5, 0.03, 0.34, F.black, -0.15, 0.76, -0.05, 0.01));
      const lid = box(0.5, 0.32, 0.03, F.black, -0.15, 0.76, -0.22, 0.01);
      lid.rotation.x = -0.2;
      g.add(lid);
      g.add(box(0.2, 0.06, 0.28, F.blue, 0.4, 0.76, 0.0, 0.01));
      return g;
    },
    chair: (w, d) => {
      const g = new THREE.Group();
      g.add(box(w - 0.08, 0.06, d - 0.08, F.mint, 0, 0.42, 0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.04, 0.42, 0.04, F.woodD, sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08), 0.0));
      g.add(box(w - 0.08, 0.46, 0.05, F.mint, 0, 0.48, -d / 2 + 0.06, 0.015));
      return g;
    },
    sofa: (w, d) => {
      const g = new THREE.Group();
      g.add(box(w - 0.06, 0.38, d - 0.06, F.blue, 0, 0, 0));
      g.add(box(w - 0.06, 0.5, 0.24, F.blue, 0, 0.38, -d / 2 + 0.15));
      for (const sx of [-1, 1]) g.add(box(0.2, 0.26, d - 0.1, F.blue, sx * (w / 2 - 0.12), 0.38, 0));
      for (const sx of [-1, 1]) g.add(box(w / 2 - 0.3, 0.1, d - 0.42, F.cream, sx * (w / 4 - 0.05), 0.38, 0.06, 0.015));
      return g;
    },
    table: (w) => {
      const g = new THREE.Group();
      g.add(cyl(w / 2 - 0.08, w / 2 - 0.08, 0.06, F.wood, 0, 0.66, 0, 24));
      g.add(cyl(0.05, 0.05, 0.66, F.woodD, 0, 0, 0, 8, 0.0));
      g.add(cyl(0.25, 0.28, 0.04, F.woodD, 0, 0, 0, 16, 0.01));
      g.add(cyl(0.08, 0.06, 0.12, F.white, 0.12, 0.72, 0.05, 12, 0.01));
      return g;
    },
    lamp: () => {
      const g = new THREE.Group();
      g.add(cyl(0.14, 0.16, 0.04, F.woodD, 0, 0, 0, 14, 0.01));
      g.add(cyl(0.02, 0.02, 1.25, F.gold, 0, 0.04, 0, 6, 0.0));
      g.add(cyl(0.13, 0.22, 0.26, F.lampS, 0, 1.22, 0, 16, 0.015));
      return g;
    },
    plant: () => {
      const g = new THREE.Group();
      g.add(cyl(0.16, 0.12, 0.3, F.terra, 0, 0, 0, 14));
      g.add(ball(0.17, F.green, 0, 0.5, 0));
      g.add(ball(0.12, F.greenD, 0.1, 0.62, 0.04));
      g.add(ball(0.11, F.green, -0.09, 0.66, -0.03));
      return g;
    },
    shelf: (w, d) => {
      const g = new THREE.Group();
      const H = 1.7;
      g.add(box(w - 0.06, H, d - 0.08, F.wood, 0, 0, 0));
      const books = [F.pink, F.blue, F.mint, F.purple, F.gold, F.navy];
      for (let s = 0; s < 4; s++) {
        const y = 0.12 + s * 0.4;
        g.add(box(w - 0.16, 0.03, 0.02, F.woodD, 0, y + 0.3, d / 2 - 0.05, 0.0));
        let x = -w / 2 + 0.14;
        let k = s;
        while (x < w / 2 - 0.22) {
          const bw = 0.07 + ((k * 37) % 5) * 0.015;
          g.add(box(bw, 0.26 + ((k * 13) % 3) * 0.02, 0.05, books[k % books.length], x + bw / 2, y, d / 2 - 0.06, 0.006));
          x += bw + 0.012;
          k++;
        }
      }
      return g;
    },
    rug: (w, d) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(own(new THREE.BoxGeometry(w - 0.06, 0.02, d - 0.06)), toon(0xffffff, { map: rugT }));
      m.position.y = 0.01;
      m.receiveShadow = true;
      g.add(m);
      return g;
    },
    tv: (w, d) => {
      const g = new THREE.Group();
      g.add(box(w - 0.06, 0.45, d - 0.08, F.white, 0, 0, 0));
      g.add(box(w * 0.32, 0.02, 0.02, F.woodD, -w * 0.2, 0.22, d / 2 - 0.03, 0.0));
      g.add(box(w * 0.32, 0.02, 0.02, F.woodD, w * 0.2, 0.22, d / 2 - 0.03, 0.0));
      g.add(box(w * 0.72, 0.62, 0.06, F.black, 0, 0.5, -0.05, 0.015));
      g.add(box(w * 0.66, 0.54, 0.01, F.screen, 0, 0.54, -0.015, 0.0));
      return g;
    },
    wardrobe: (w, d) => {
      const g = new THREE.Group();
      g.add(box(w - 0.06, 1.85, d - 0.08, F.cream, 0, 0, 0));
      g.add(box(0.015, 1.7, 0.01, F.woodD, 0, 0.08, d / 2 - 0.035, 0.0));
      for (const sx of [-1, 1]) g.add(ball(0.03, F.gold, sx * 0.08, 0.95, d / 2 - 0.02, 0.0));
      g.add(box(w - 0.02, 0.06, d - 0.04, F.wood, 0, 1.85, 0, 0.01));
      return g;
    },
    fridge: (w, d) => {
      const g = new THREE.Group();
      g.add(box(w - 0.2, 1.75, d - 0.3, F.white, 0, 0, -0.06));
      g.add(box(w - 0.22, 0.015, 0.01, F.black, 0, 1.1, d / 2 - 0.205, 0.0));
      g.add(box(0.04, 0.35, 0.04, F.navy, -w / 2 + 0.22, 1.25, d / 2 - 0.19, 0.0));
      g.add(box(0.04, 0.45, 0.04, F.navy, -w / 2 + 0.22, 0.45, d / 2 - 0.19, 0.0));
      g.add(ball(0.05, F.pink, 0.15, 1.45, d / 2 - 0.2, 0.0));
      return g;
    },
    cushion: () => {
      const g = new THREE.Group();
      const c = cyl(0.2, 0.22, 0.09, F.purple, 0, 0, 0, 16, 0.015);
      g.add(c);
      return g;
    },
    piano: (w, d) => {
      const g = new THREE.Group();
      g.add(box(w - 0.1, 1.25, 0.42, F.black, 0, 0, -d / 2 + 0.3));
      g.add(box(w - 0.1, 0.1, 0.36, F.black, 0, 0.68, -d / 2 + 0.66));
      g.add(box(w - 0.22, 0.03, 0.16, F.white, 0, 0.78, -d / 2 + 0.62, 0.0));
      for (let i = 0; i < 14; i++) g.add(box(0.035, 0.02, 0.08, F.black, -w / 2 + 0.22 + i * ((w - 0.4) / 14), 0.81, -d / 2 + 0.58, 0.0));
      g.add(box(0.5, 0.04, 0.34, F.black, 0, 0.42, d / 2 - 0.25, 0.01));
      return g;
    },
    tree: (w) => {
      const g = new THREE.Group();
      g.add(cyl(0.11, 0.15, 1.1, F.woodD, 0, 0, 0, 10));
      g.add(ball(w * 0.42, F.green, 0, 1.45, 0));
      g.add(ball(w * 0.3, F.greenD, w * 0.2, 1.75, 0.08));
      g.add(ball(w * 0.28, F.green, -w * 0.18, 1.8, -0.06));
      g.add(ball(0.05, F.pink, w * 0.3, 1.5, w * 0.25, 0.0));
      g.add(ball(0.05, F.pink, -w * 0.25, 1.62, w * 0.22, 0.0));
      return g;
    },
    flowers: (w, d) => {
      const g = new THREE.Group();
      g.add(box(w - 0.06, 0.16, d - 0.06, F.woodD, 0, 0, 0));
      g.add(box(w - 0.16, 0.04, d - 0.16, F.soil, 0, 0.16, 0, 0.0));
      const cols = [F.pink, F.gold, F.white, F.purple, F.coral];
      for (let i = 0; i < 9; i++) {
        const x = -w / 2 + 0.16 + ((w - 0.32) * i) / 8,
          z = (i % 2 ? 0.07 : -0.07) * (d / 0.5);
        g.add(cyl(0.012, 0.012, 0.2, F.greenD, x, 0.18, z, 5, 0.0));
        g.add(ball(0.055, cols[i % cols.length], x, 0.42, z, 0.01));
      }
      return g;
    },
    bench: (w, d) => {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) g.add(box(w - 0.1, 0.04, 0.1, F.wood, 0, 0.42, -0.12 + i * 0.12, 0.012));
      for (let i = 0; i < 2; i++) {
        const b = box(w - 0.1, 0.04, 0.09, F.wood, 0, 0.62 + i * 0.16, -d / 2 + 0.1, 0.012);
        b.rotation.x = -0.15;
        g.add(b);
      }
      for (const sx of [-1, 1]) {
        g.add(box(0.06, 0.42, 0.34, F.black, sx * (w / 2 - 0.12), 0, 0, 0.01));
        g.add(box(0.06, 0.5, 0.05, F.black, sx * (w / 2 - 0.12), 0.42, -d / 2 + 0.08, 0.0));
      }
      return g;
    },
    parasol: (w) => {
      const g = new THREE.Group();
      g.add(cyl(0.42, 0.42, 0.05, F.white, 0, 0.68, 0, 20));
      g.add(cyl(0.05, 0.05, 0.68, F.white, 0, 0, 0, 8, 0.0));
      g.add(cyl(0.22, 0.25, 0.04, F.white, 0, 0, 0, 14, 0.01));
      g.add(cyl(0.025, 0.025, 2.1, F.woodD, 0, 0.7, 0, 6, 0.0));
      const top = solid(new THREE.ConeGeometry(w * 0.48, 0.45, 8, 1, true), F.coralD, 0.02);
      top.position.set(0, 2.55, 0);
      g.add(top);
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        const c = box(0.36, 0.05, 0.36, F.mint, Math.sin(a) * 0.68, 0.42, Math.cos(a) * 0.68, 0.015);
        g.add(c);
        g.add(box(0.36, 0.42, 0.04, F.mint, Math.sin(a) * 0.86, 0.42, Math.cos(a) * 0.86, 0.01).rotateY(a));
        for (const s of [-1, 1]) g.add(box(0.03, 0.42, 0.03, F.white, Math.sin(a) * 0.68 + Math.cos(a) * s * 0.15, 0, Math.cos(a) * 0.68 - Math.sin(a) * s * 0.15, 0.0));
      }
      return g;
    },
    fountain: (w) => {
      const g = new THREE.Group();
      g.add(cyl(w * 0.47, w * 0.5, 0.36, F.stone, 0, 0, 0, 22));
      g.add(cyl(w * 0.4, w * 0.4, 0.02, F.water, 0, 0.32, 0, 22, 0.0));
      g.add(cyl(0.12, 0.16, 0.6, F.stone, 0, 0.3, 0, 12));
      g.add(cyl(0.42, 0.3, 0.12, F.stone, 0, 0.88, 0, 16));
      g.add(cyl(0.34, 0.34, 0.02, F.water, 0, 0.97, 0, 16, 0.0));
      g.add(ball(0.1, F.water, 0, 1.12, 0, 0.0));
      g.add(cyl(0.03, 0.06, 0.25, F.water, 0, 0.98, 0, 8, 0.0));
      return g;
    },
    hedge: (w, d) => {
      const g = new THREE.Group();
      g.add(box(w - 0.08, 0.7, d - 0.1, F.greenD, 0, 0, 0, 0.03));
      for (let i = 0; i < 3; i++) g.add(ball(0.17, F.green, -w / 2 + 0.22 + i * ((w - 0.44) / 2), 0.72, 0, 0.015));
      return g;
    },
  };

  const cellX = (cx: number) => ox + cx * CELL;
  const cellY = (cy: number) => oy + cy * CELL;
  const furnG = [new THREE.Group(), new THREE.Group()];
  L0.add(furnG[0]);
  L1.add(furnG[1]);
  const rowsOf = (f: number) => (f ? GD : GGD);
  let cur: Placed[] = [];
  const occ = [new Uint8Array(GW * GGD), new Uint8Array(GW * GD)];
  /** 계단 칸 막기: 1층은 아래 두 줄만 열림, 2층은 위 두 줄만 열림 (나머지는 난간) */
  const stairOcc = () => {
    if (!S) return;
    for (let y = S.y0; y < S.y1; y++)
      for (let x = S.x0; x < S.x1; x++) {
        if (y < S.y1 - 2) occ[0][y * GW + x] = 1;
        if (y >= S.y0 + 2) occ[1][y * GW + x] = 1;
      }
  };
  /** 놓인 가구 하나 그리기 (그룹 가운데 = 차지한 칸 가운데) */
  const make = (p: { i: FurnKind; cx: number; cy: number; r: number }) => {
    const f = furnById(p.i)!;
    const g = builders[p.i](f.w * CELL, f.d * CELL);
    const fp = footprint(f, p.r);
    const wrap = new THREE.Group();
    g.rotation.y = -p.r * (Math.PI / 2);
    wrap.add(g);
    wrap.position.set(cellX(p.cx) + (fp.w * CELL) / 2, 0, cellY(p.cy) + (fp.d * CELL) / 2);
    return wrap;
  };
  const setLayout = (layout: Placed[]) => {
    for (const g of furnG) for (const c of [...g.children]) g.remove(c);
    cur = layout.map((p) => ({ ...p }));
    occ[0].fill(0);
    occ[1].fill(0);
    stairOcc();
    for (const p of cur) {
      const f = furnById(p.i);
      const fl = p.f ?? 0;
      if (!f || (fl && !S)) continue;
      const m = make({ i: p.i, cx: p.x, cy: p.y, r: p.r });
      m.position.y = fl * FLOOR_H;
      furnG[fl].add(m);
      if (f.flat) continue;
      const fp = footprint(f, p.r);
      for (let y = p.y; y < p.y + fp.d; y++)
        for (let x = p.x; x < p.x + fp.w; x++) if (x >= 0 && y >= 0 && x < GW && y < rowsOf(fl)) occ[fl][y * GW + x] = 1;
    }
  };
  setLayout(layout);

  // 꾸미기: 칸 선 (층마다) · 미리 보기
  const gridOf = (f: number) => {
    const rows = rowsOf(f),
      h = f * FLOOR_H + 0.012;
    const l = new THREE.LineSegments(
      own(
        new THREE.BufferGeometry().setFromPoints(
          [
            ...Array.from({ length: GW + 1 }, (_, i) => [new THREE.Vector3(cellX(i), h, oy), new THREE.Vector3(cellX(i), h, cellY(rows))]),
            ...Array.from({ length: rows + 1 }, (_, i) => [new THREE.Vector3(ox, h, cellY(i)), new THREE.Vector3(ox + wm, h, cellY(i))]),
          ].flat()
        )
      ),
      own(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }))
    );
    l.visible = false;
    group.add(l);
    return l;
  };
  const grids = S ? [gridOf(0), gridOf(1)] : [gridOf(0)];
  const ghostG = new THREE.Group();
  group.add(ghostG);
  const ghostOk = own(new THREE.MeshBasicMaterial({ color: 0x6ff0b0, transparent: true, opacity: 0.35, depthWrite: false }));
  const ghostBad = own(new THREE.MeshBasicMaterial({ color: 0xff6f7f, transparent: true, opacity: 0.4, depthWrite: false }));
  const selBox = new THREE.Mesh(own(new THREE.BoxGeometry(1, 0.03, 1)), own(new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.55, depthWrite: false })));
  selBox.visible = false;
  group.add(selBox);
  let ghostKey = "";
  let building = false;
  let selNo: number | null = null;

  // ── 층 · 부딪힘 ──
  let lv = 0;
  let myX = 0,
    myY = 0;
  let viewSet: number | null = null;
  const view = () => (viewSet ?? (lv === 1 || (lv === LV_STAIR && levelH(geo, lv, myX, myY) > FLOOR_H * 0.5) ? 1 : 0));
  const showLevels = () => {
    const v = S ? view() : 0;
    L1.visible = v === 1;
    for (let i = 0; i < grids.length; i++) grids[i].visible = building && i === v;
  };
  const yEnd = oy + ym;
  /** 층 f 바닥에서 부딪힘 (방 · 벽 · 가구 · 계단 칸) */
  const blockedOn = (f: number, x: number, y: number, r: number) => {
    if (x < ox + r || x > ox + wm - r || y < oy + r) return true;
    if (f === 0) {
      const inDoor = x - r > dcx0 - 0.02 && x + r < dcx1 + 0.02;
      // 나가는 곳 (마당이면 대문, 아니면 문)은 바깥으로 0.1m 까지
      if (y > yEnd - r && !(inDoor && y < yEnd + 0.1)) return true;
      // 마당 있는 집: 집 앞벽 (문 틈만)
      if (yard && Math.abs(y - y1) < r + WALL_T / 2 && !inDoor) return true;
    } else if (y > y1 - r) return true;
    const rows = rowsOf(f);
    const c0 = Math.floor((x - r - ox) / CELL),
      c1 = Math.floor((x + r - ox) / CELL),
      r0 = Math.floor((y - r - oy) / CELL),
      r1 = Math.floor((y + r - oy) / CELL);
    for (let cy = r0; cy <= r1; cy++)
      for (let cx = c0; cx <= c1; cx++) {
        if (cx < 0 || cy < 0 || cx >= GW || cy >= rows) continue;
        if (!occ[f][cy * GW + cx]) continue;
        const qx = Math.max(cellX(cx), Math.min(x, cellX(cx + 1))),
          qy = Math.max(cellY(cy), Math.min(y, cellY(cy + 1)));
        if ((x - qx) ** 2 + (y - qy) ** 2 < (r * 0.85) ** 2) return true;
      }
    return false;
  };
  const sx1 = S ? ox + S.x1 * CELL : 0,
    sy0 = S ? oy + S.y0 * CELL : 0,
    sy1 = S ? oy + S.y1 * CELL : 0;
  const blocked = (x: number, y: number, r: number) => {
    if (!S) return blockedOn(0, x, y, r);
    const t = stairT(geo, x, y);
    if (lv === 0) return t !== null ? t >= 0.3 || x < ox + r : blockedOn(0, x, y, r);
    if (lv === 1) return t !== null ? t <= 0.7 || x < ox + r : blockedOn(1, x, y, r);
    // 계단 위
    if (t !== null) return x < ox + r || (t > 0.3 && t < 0.7 && x + r * 0.8 > sx1);
    if (y > sy1) return blockedOn(0, x, y, r);
    if (y < sy0) return blockedOn(1, x, y, r);
    const tt = (sy1 - y) / (sy1 - sy0);
    return tt < 0.3 ? blockedOn(0, x, y, r) : tt > 0.7 ? blockedOn(1, x, y, r) : true;
  };

  const ent = enterAt(tier);
  return {
    group,
    geo,
    wm,
    dm: ym,
    bg: yard ? 0x9fd6f5 : 0x1e1a28,
    enter: ent,
    atDoor: (x, y) => lv === 0 && x > dcx0 && x < dcx1 && y > yEnd - 0.25,
    blocked,
    moved(x, y) {
      myX = x;
      myY = y;
      if (S) lv = nextLevel(geo, lv, x, y);
      showLevels();
    },
    level: () => lv,
    heightAt: (x, y) => (S ? levelH(geo, lv, x, y) : 0),
    viewFloor: () => (S ? view() : 0),
    setView(f) {
      viewSet = f;
      showLevels();
    },
    cellAt(x, y) {
      const f = S ? view() : 0;
      const cx = Math.floor((x - ox) / CELL),
        cy = Math.floor((y - oy) / CELL);
      return cx >= 0 && cy >= 0 && cx < GW && cy < rowsOf(f) ? { cx, cy } : null;
    },
    setLayout(l) {
      setLayout(l);
      this.setBuild(building, selNo);
    },
    setGhost(g) {
      if (!g) {
        ghostG.visible = false;
        return;
      }
      const key = `${g.i}:${g.r}:${g.ok}`;
      if (key !== ghostKey) {
        ghostKey = key;
        for (const c of [...ghostG.children]) ghostG.remove(c);
        const m = make({ i: g.i, cx: 0, cy: 0, r: g.r });
        m.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.material = g.ok ? ghostOk : ghostBad;
            o.castShadow = false;
          }
        });
        ghostG.add(m);
      }
      ghostG.position.set(g.cx * CELL, (S ? view() : 0) * FLOOR_H + 0.01, g.cy * CELL);
      ghostG.visible = true;
    },
    setBuild(on, sel = null) {
      building = on;
      selNo = sel;
      showLevels();
      const p = sel != null ? cur[sel] : null;
      if (on && p) {
        const fp = footprint(furnById(p.i)!, p.r);
        selBox.scale.set(fp.w * CELL + 0.08, 1, fp.d * CELL + 0.08);
        selBox.position.set(cellX(p.x) + (fp.w * CELL) / 2, (p.f ?? 0) * FLOOR_H + 0.02, cellY(p.y) + (fp.d * CELL) / 2);
        selBox.visible = true;
      } else selBox.visible = false;
    },
    update(eye) {
      // 카메라 쪽(벽 바깥 법선이 카메라 쪽) 벽은 걸레받이 높이로
      const cx = ox + wm / 2,
        cz = oy + dm / 2;
      for (const w of walls) {
        const d = (eye.x - cx) * w.n.x + (eye.z - cz) * w.n.z;
        const want = d > 0.5 ? 0.08 : 1;
        const s = w.g.scale.y + (want - w.g.scale.y) * 0.25;
        w.g.scale.y = Math.abs(s - want) < 0.01 ? want : s;
      }
    },
    dispose() {
      group.removeFromParent();
      for (const d of disp) d.dispose();
      for (const m of mats.values()) m.dispose();
    },
  };
}

export const FURN_LIST = FURNITURE;
