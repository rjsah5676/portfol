import * as THREE from "three";
import { CELL, FURNITURE, doorCells, footprint, furnById, roomOf, type FurnKind, type Placed } from "@/lib/gmtown/house";

/*
 * 집 안 장면 (심즈식) — 마을 장면 안 멀리 떨어진 곳(HOME_AT)에 방 하나를 지음. 마을 해 · 그림자 · 캐릭터 그대로 씀.
 * 벽: 카메라 쪽을 보는 벽은 낮게 잘라서(컷어웨이) 방 안이 보이게. 가구: 코드로 만든 툰 덩어리 + 외곽선.
 * 좌표: 방 왼쪽 위 = (ox, oy) (땅 x, y). 칸 (cx, cy) 의 가운데 = ox + (cx + 0.5) * CELL.
 */

export const HOME_AT = { x: -400, y: -400 };
const WALL_H = 2.6;
const WALL_T = 0.16;
const INK = 0x2b2433;

export interface HouseScene {
  group: THREE.Group;
  /** 방 왼쪽 위 (땅 좌표) · 크기(m) */
  ox: number;
  oy: number;
  wm: number;
  dm: number;
  /** 들어왔을 때 서는 곳 (문 안쪽) */
  enter: { x: number; y: number };
  /** 문에 닿았는지 (나가기) */
  atDoor(x: number, y: number): boolean;
  /** 몸 반지름 r 이 들어갈 수 없는 곳 */
  blocked(x: number, y: number, r: number): boolean;
  /** 땅 좌표 → 칸 */
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
  const R = roomOf(tier);
  const wm = R.w * CELL,
    dm = R.d * CELL;
  const ox = HOME_AT.x - wm / 2,
    oy = HOME_AT.y - dm / 2;
  const group = new THREE.Group();
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
  const solid = (geo: THREE.BufferGeometry, m: THREE.Material, ink = 0.02) => {
    own(geo);
    const g = new THREE.Group();
    const a = new THREE.Mesh(geo, m);
    a.castShadow = true;
    a.receiveShadow = true;
    g.add(a);
    if (ink) {
      geo.computeBoundingBox();
      const s = new THREE.Vector3();
      geo.boundingBox!.getSize(s);
      const k = new THREE.Mesh(geo, inkM);
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

  // ── 바닥: 나무 마루 ──
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
      wm / 2,
      dm / 2
    )
  );
  const floor = new THREE.Mesh(own(new THREE.PlaneGeometry(wm, dm)), toon(0xffffff, { map: floorT }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(HOME_AT.x, 0, HOME_AT.y);
  floor.receiveShadow = true;
  group.add(floor);
  // 바깥 바닥 (방 밖이 허공으로 안 보이게) — 어두운 판
  const under = new THREE.Mesh(own(new THREE.PlaneGeometry(wm + 40, dm + 40)), toon(0x2a2433));
  under.rotation.x = -Math.PI / 2;
  under.position.set(HOME_AT.x, -0.02, HOME_AT.y);
  group.add(under);

  // ── 벽: 파스텔 벽지 + 걸레받이, 뒤벽에 창문, 앞벽 가운데 문 ──
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
  type Wall = { g: THREE.Group; n: THREE.Vector3 };
  const walls: Wall[] = [];
  const wallM = (len: number) => {
    const t = paper.clone();
    own(t);
    t.repeat.set(len / 1.2, WALL_H / 1.2);
    t.needsUpdate = true;
    return toon(0xffffff, { map: t });
  };
  const trim = toon(0xb98a5e);
  const mkWall = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number, gap?: [number, number]) => {
    const g = new THREE.Group();
    const len = Math.hypot(x1 - x0, y1 - y0);
    const along = (a: number, b: number) => {
      const l = b - a;
      if (l <= 0.01) return;
      const cx = x0 + ((x1 - x0) * (a + b)) / 2 / len,
        cy = y0 + ((y1 - y0) * (a + b)) / 2 / len;
      const horiz = Math.abs(y1 - y0) < 1e-6;
      const w = horiz ? l : WALL_T,
        d = horiz ? WALL_T : l;
      g.add(box(w, WALL_H, d, wallM(l), cx, 0, cy, 0.03));
      g.add(box(horiz ? l : WALL_T + 0.03, 0.14, horiz ? WALL_T + 0.03 : l, trim, cx + nx * 0.01, 0, cy + ny * 0.01, 0.0));
    };
    if (gap) {
      along(0, gap[0]);
      along(gap[1], len);
      // 문 위 상인방
      const cx = x0 + ((x1 - x0) * (gap[0] + gap[1])) / 2 / len,
        cy = y0 + ((y1 - y0) * (gap[0] + gap[1])) / 2 / len;
      const top = box(gap[1] - gap[0], 0.5, WALL_T, wallM(gap[1] - gap[0]), cx, WALL_H - 0.5, cy, 0.03);
      g.add(top);
      g.add(box(gap[1] - gap[0] + 0.16, 0.12, WALL_T + 0.06, trim, cx, WALL_H - 0.56, cy, 0.01));
    } else along(0, len);
    group.add(g);
    walls.push({ g, n: new THREE.Vector3(nx, 0, ny) });
    return g;
  };
  const x0 = ox,
    x1 = ox + wm,
    y0 = oy,
    y1 = oy + dm;
  const back = mkWall(x0 - WALL_T / 2, y0 - WALL_T / 2, x1 + WALL_T / 2, y0 - WALL_T / 2, 0, -1);
  mkWall(x0 - WALL_T / 2, y0, x0 - WALL_T / 2, y1, -1, 0);
  mkWall(x1 + WALL_T / 2, y0, x1 + WALL_T / 2, y1, 1, 0);
  const dc = doorCells(tier);
  const front = mkWall(x0 - WALL_T / 2, y1 + WALL_T / 2, x1 + WALL_T / 2, y1 + WALL_T / 2, 0, 1, [
    dc.x0 * CELL + WALL_T / 2,
    (dc.x1 + 1) * CELL + WALL_T / 2,
  ]);
  void front;
  // 뒤벽 창문 (하늘 · 커튼)
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
  const winN = Math.max(1, Math.floor(wm / 3.2));
  for (let i = 0; i < winN; i++) {
    const cx = ox + (wm * (i + 0.5)) / winN;
    const glass = new THREE.Mesh(own(new THREE.PlaneGeometry(1.1, 0.95)), new THREE.MeshBasicMaterial({ map: sky }));
    own(glass.material as THREE.Material);
    glass.position.set(cx, 1.55, y0 + 0.005);
    back.add(glass);
    back.add(box(1.24, 0.08, 0.06, trim, cx, 1.04, y0 + 0.02, 0.01));
    back.add(box(1.24, 0.08, 0.06, trim, cx, 1.98, y0 + 0.02, 0.01));
    back.add(box(0.07, 1.0, 0.06, trim, cx - 0.585, 1.04, y0 + 0.02, 0.01));
    back.add(box(0.07, 1.0, 0.06, trim, cx + 0.585, 1.04, y0 + 0.02, 0.01));
    back.add(box(0.05, 0.95, 0.04, trim, cx, 1.06, y0 + 0.02, 0.0));
    back.add(box(1.4, 0.06, 0.18, trim, cx, 1.0, y0 + 0.09, 0.01));
    const cur = toon(0xf4b7c8);
    back.add(box(0.26, 1.15, 0.05, cur, cx - 0.72, 0.95, y0 + 0.06, 0.015));
    back.add(box(0.26, 1.15, 0.05, cur, cx + 0.72, 0.95, y0 + 0.06, 0.015));
  }
  // 문 바깥 깔개
  const mat = box((dc.x1 - dc.x0 + 1) * CELL, 0.02, 0.5, toon(0x9b6b4a), ox + ((dc.x0 + dc.x1 + 1) / 2) * CELL, 0, y1 - 0.3, 0.0);
  group.add(mat);

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
  };

  const cellX = (cx: number) => ox + cx * CELL;
  const cellY = (cy: number) => oy + cy * CELL;
  const furnG = new THREE.Group();
  group.add(furnG);
  let cur: Placed[] = [];
  let occ = new Uint8Array(R.w * R.d);
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
    for (const c of [...furnG.children]) furnG.remove(c);
    cur = layout.map((p) => ({ ...p }));
    occ = new Uint8Array(R.w * R.d);
    for (const p of cur) {
      const f = furnById(p.i);
      if (!f) continue;
      furnG.add(make({ i: p.i, cx: p.x, cy: p.y, r: p.r }));
      if (f.flat) continue;
      const fp = footprint(f, p.r);
      for (let y = p.y; y < p.y + fp.d; y++) for (let x = p.x; x < p.x + fp.w; x++) if (x >= 0 && y >= 0 && x < R.w && y < R.d) occ[y * R.w + x] = 1;
    }
  };
  setLayout(layout);

  // 꾸미기: 칸 선 · 미리 보기
  const gridLines = new THREE.LineSegments(
    own(
      new THREE.BufferGeometry().setFromPoints(
        [
          ...Array.from({ length: R.w + 1 }, (_, i) => [new THREE.Vector3(cellX(i), 0.012, oy), new THREE.Vector3(cellX(i), 0.012, oy + dm)]),
          ...Array.from({ length: R.d + 1 }, (_, i) => [new THREE.Vector3(ox, 0.012, cellY(i)), new THREE.Vector3(ox + wm, 0.012, cellY(i))]),
        ].flat()
      )
    ),
    own(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }))
  );
  gridLines.visible = false;
  group.add(gridLines);
  const ghostG = new THREE.Group();
  group.add(ghostG);
  const ghostOk = own(new THREE.MeshBasicMaterial({ color: 0x6ff0b0, transparent: true, opacity: 0.35, depthWrite: false }));
  const ghostBad = own(new THREE.MeshBasicMaterial({ color: 0xff6f7f, transparent: true, opacity: 0.4, depthWrite: false }));
  const selBox = new THREE.Mesh(own(new THREE.BoxGeometry(1, 0.03, 1)), own(new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.55, depthWrite: false })));
  selBox.visible = false;
  group.add(selBox);
  let ghostKey = "";

  const dcx0 = cellX(dc.x0),
    dcx1 = cellX(dc.x1 + 1);
  return {
    group,
    ox,
    oy,
    wm,
    dm,
    enter: { x: (dcx0 + dcx1) / 2, y: y1 - 0.7 },
    atDoor: (x, y) => x > dcx0 && x < dcx1 && y > y1 - 0.25,
    blocked(x, y, r) {
      // 방 밖 (문은 바깥으로 0.1m 까지 — 나가기 판정용)
      const inDoor = x - r > dcx0 - 0.02 && x + r < dcx1 + 0.02;
      if (x < ox + r || x > ox + wm - r || y < oy + r) return true;
      if (y > oy + dm - r && !(inDoor && y < oy + dm + 0.1)) return true;
      const c0 = Math.floor((x - r - ox) / CELL),
        c1 = Math.floor((x + r - ox) / CELL),
        r0 = Math.floor((y - r - oy) / CELL),
        r1 = Math.floor((y + r - oy) / CELL);
      for (let cy = r0; cy <= r1; cy++)
        for (let cx = c0; cx <= c1; cx++) {
          if (cx < 0 || cy < 0 || cx >= R.w || cy >= R.d) continue;
          if (!occ[cy * R.w + cx]) continue;
          // 칸과 원이 겹치는지
          const qx = Math.max(cellX(cx), Math.min(x, cellX(cx + 1))),
            qy = Math.max(cellY(cy), Math.min(y, cellY(cy + 1)));
          if ((x - qx) ** 2 + (y - qy) ** 2 < (r * 0.85) ** 2) return true;
        }
      return false;
    },
    cellAt(x, y) {
      const cx = Math.floor((x - ox) / CELL),
        cy = Math.floor((y - oy) / CELL);
      return cx >= 0 && cy >= 0 && cx < R.w && cy < R.d ? { cx, cy } : null;
    },
    setLayout,
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
      ghostG.position.set(g.cx * CELL, 0.01, g.cy * CELL);
      ghostG.visible = true;
    },
    setBuild(on, sel = null) {
      gridLines.visible = on;
      const p = sel != null ? cur[sel] : null;
      if (on && p) {
        const fp = footprint(furnById(p.i)!, p.r);
        selBox.scale.set(fp.w * CELL + 0.08, 1, fp.d * CELL + 0.08);
        selBox.position.set(cellX(p.x) + (fp.w * CELL) / 2, 0.02, cellY(p.y) + (fp.d * CELL) / 2);
        selBox.visible = true;
      } else selBox.visible = false;
    },
    update(eye) {
      // 카메라 쪽(벽 바깥 법선이 카메라 쪽) 벽은 걸레받이 높이로
      const cx = HOME_AT.x,
        cz = HOME_AT.y;
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
