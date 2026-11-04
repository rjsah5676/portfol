/**
 * 빈 터에 새로 들어선 건물 여섯 (초안 그림 → 코드 모델)
 * 올인 러브 카페 · 용의자 탐정사무소 · 디펜스 성 · 우리 집 · 언덕 위 학교 · 마을 역
 * 앞면 = 로컬 +z · 앞면 길이 = 로컬 x · 바닥 = y 0 (scene3d 건물과 같은 약속)
 */
import * as THREE from "three";
import { drawWithFonts } from "./canvasFont";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type Building, faceRot, frontLen, heightAt } from "@/lib/gmtown/world";

const INK = 0x2b2433;
/** 역 이름판 (마을 이름 바뀌면 여기만) */
export const STATION_NAME = "ANIME TOWN 역";

type Own = <T extends { dispose(): void }>(x: T) => T;
export interface LotCtx {
  grad: THREE.Texture;
  own: Own;
  withInk: (p: THREE.Object3D, m: THREE.Mesh, k: number, inkMat?: THREE.Material) => THREE.Mesh;
  anims: ((t: number) => void)[];
}
type Out = { group: THREE.Group; mats: THREE.Material[] };
type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

function tex(w: number, h: number, draw: Draw, rx = 1, ry = 1): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  let t: THREE.CanvasTexture | null = null;
  drawWithFonts(c, draw, () => {
    if (t) t.needsUpdate = true;
  });
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (rx !== 1 || ry !== 1) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
  }
  return t;
}

// ───────────── 그림 (벽 · 지붕 · 창) ─────────────

/** 가로 판자 벽 */
const sidingTex = (base: string, line: string, rx: number, ry: number) =>
  tex(
    64,
    64,
    (g, w, h) => {
      g.fillStyle = base;
      g.fillRect(0, 0, w, h);
      g.fillStyle = line;
      for (let y = 0; y < h; y += 16) g.fillRect(0, y + 13, w, 3);
    },
    rx,
    ry
  );
/** 벽돌 */
const brickTex = (mortar: string, cols: string[], rx: number, ry: number) =>
  tex(
    64,
    32,
    (g, w, h) => {
      g.fillStyle = mortar;
      g.fillRect(0, 0, w, h);
      for (let r = 0; r < 4; r++)
        for (let c = -1; c < 4; c++) {
          g.fillStyle = cols[(r * 3 + c + 9) % cols.length];
          g.fillRect(c * 16 + (r % 2 ? 8 : 0) + 1, r * 8 + 1, 14, 6);
        }
    },
    rx,
    ry
  );
/** 큰 돌 (성벽 · 받침) */
const stoneTex = (mortar: string, cols: string[], rx: number, ry: number) =>
  tex(
    128,
    64,
    (g, w, h) => {
      g.fillStyle = mortar;
      g.fillRect(0, 0, w, h);
      for (let r = 0; r < 2; r++)
        for (let c = -1; c < 3; c++) {
          const x = c * 48 + (r % 2 ? 24 : 0);
          g.fillStyle = cols[(r + c + 4) % cols.length];
          g.beginPath();
          g.roundRect(x + 2, r * 32 + 2, 44, 28, 5);
          g.fill();
          g.fillStyle = "rgba(255,255,255,0.18)";
          g.fillRect(x + 6, r * 32 + 5, 30, 3);
        }
    },
    rx,
    ry
  );
/** 기와 (반달 비늘) */
const tileTex = (a: string, b: string, line: string, rx: number, ry: number) =>
  tex(
    64,
    64,
    (g, w, h) => {
      g.fillStyle = a;
      g.fillRect(0, 0, w, h);
      for (let r = 0; r < 4; r++)
        for (let c = -1; c < 5; c++) {
          const x = c * 16 + (r % 2 ? 8 : 0),
            y = r * 16;
          g.fillStyle = (r + c) % 3 ? a : b;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + 16, y);
          g.lineTo(x + 16, y + 8);
          g.arc(x + 8, y + 8, 8, 0, Math.PI);
          g.closePath();
          g.fill();
          g.strokeStyle = line;
          g.lineWidth = 1.5;
          g.stroke();
        }
    },
    rx,
    ry
  );
const stripeTex = (a: string, b: string, n = 8) =>
  tex(128, 32, (g, w, h) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? b : a;
      g.fillRect((i * w) / n, 0, w / n + 1, h);
    }
  });
const scallopTex = (a: string, b: string, n = 8) =>
  tex(128, 24, (g, w) => {
    g.clearRect(0, 0, w, 24);
    const s = w / n;
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? b : a;
      g.fillRect(i * s, 0, s + 0.5, 10);
      g.beginPath();
      g.arc(i * s + s / 2, 10, s / 2, 0, Math.PI);
      g.fill();
    }
  });

interface WinOpt {
  frame?: string;
  /** 바깥 테 굵기 (px) */
  fw?: number;
  glass?: [string, string];
  curtain?: string | null;
  cols?: number;
  rows?: number;
  arch?: boolean;
  blinds?: boolean;
  /** 안에 비치는 것 */
  extra?: Draw;
}
/** 불 켜진 창 (따뜻한 빛 · 커튼 · 창살) */
function winTex(o: WinOpt = {}, w = 96, h = 120) {
  const { frame = "#ffffff", fw = 9, glass = ["#ffe6a8", "#f0a54e"], curtain = "#fff6ea", cols = 2, rows = 2, arch = false, blinds = false, extra } = o;
  return tex(w, h, (g) => {
    g.clearRect(0, 0, w, h);
    g.save();
    g.beginPath();
    if (arch) {
      g.moveTo(0, h);
      g.lineTo(0, w / 2);
      g.arc(w / 2, w / 2, w / 2, Math.PI, 0);
      g.lineTo(w, h);
      g.closePath();
    } else g.rect(0, 0, w, h);
    g.clip();
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, glass[0]);
    gr.addColorStop(1, glass[1]);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    extra?.(g, w, h);
    if (blinds) {
      g.fillStyle = "rgba(60,44,30,0.78)";
      for (let y = 0; y < h * 0.62; y += 7) g.fillRect(0, y, w, 4.5);
    }
    if (curtain) {
      g.fillStyle = curtain;
      for (const sx of [0, 1]) {
        const x0 = sx ? w : 0,
          dx = sx ? -1 : 1;
        g.beginPath();
        g.moveTo(x0, 0);
        g.lineTo(x0 + dx * w * 0.3, 0);
        g.quadraticCurveTo(x0 + dx * w * 0.1, h * 0.45, x0 + dx * w * 0.22, h);
        g.lineTo(x0, h);
        g.fill();
      }
    }
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(w * 0.18, h * 0.12, 5, h * 0.3);
    g.fillStyle = frame;
    for (let i = 1; i < cols; i++) g.fillRect((i * w) / cols - 2.5, 0, 5, h);
    for (let i = 1; i < rows; i++) g.fillRect(0, (i * h) / rows - 2.5, w, 5);
    g.restore();
    g.strokeStyle = frame;
    g.lineWidth = fw * 2;
    g.beginPath();
    if (arch) {
      g.moveTo(0, h);
      g.lineTo(0, w / 2);
      g.arc(w / 2, w / 2, w / 2, Math.PI, 0);
      g.lineTo(w, h);
      g.closePath();
    } else g.rect(0, 0, w, h);
    g.stroke();
    g.strokeStyle = "rgba(43,36,51,0.55)";
    g.lineWidth = 2;
    g.stroke();
  });
}
/** 동그란 시계 (눈금만 · 바늘은 따로 돌림) */
const clockTex = (rim: string) =>
  tex(128, 128, (g, w) => {
    g.clearRect(0, 0, w, w);
    g.fillStyle = rim;
    g.beginPath();
    g.arc(64, 64, 63, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fffaf0";
    g.beginPath();
    g.arc(64, 64, 52, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#2b2433";
    for (let i = 0; i < 12; i++) {
      g.save();
      g.translate(64, 64);
      g.rotate((i * Math.PI) / 6);
      g.fillRect(-2.5, -48, 5, i % 3 ? 7 : 12);
      g.restore();
    }
  });
const textTex = (text: string, o: { w?: number; h?: number; bg?: string | null; fg: string; font: string; border?: string; r?: number }) => {
  const { w = 320, h = 64, bg = null, fg, font, border, r = 10 } = o;
  return tex(w, h, (g) => {
    g.clearRect(0, 0, w, h);
    if (bg) {
      g.fillStyle = bg;
      g.beginPath();
      g.roundRect(2, 2, w - 4, h - 4, r);
      g.fill();
    }
    if (border) {
      g.strokeStyle = border;
      g.lineWidth = 4;
      g.beginPath();
      g.roundRect(6, 6, w - 12, h - 12, Math.max(2, r - 4));
      g.stroke();
    }
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = font;
    g.fillStyle = fg;
    g.fillText(text, w / 2, h / 2 + 2);
  });
};
const heartPath = (g: CanvasRenderingContext2D, cx: number, cy: number, r: number) => {
  g.beginPath();
  g.moveTo(cx, cy + r * 0.95);
  g.bezierCurveTo(cx - r * 1.45, cy - r * 0.05, cx - r * 0.65, cy - r * 1.15, cx, cy - r * 0.35);
  g.bezierCurveTo(cx + r * 0.65, cy - r * 1.15, cx + r * 1.45, cy - r * 0.05, cx, cy + r * 0.95);
  g.closePath();
};

// ───────────── 공통 도구 ─────────────

function kit(ctx: LotCtx, b: Building) {
  const { grad, own, withInk, anims } = ctx;
  const G = new THREE.Group();
  const mats: THREE.Material[] = [];
  const mine = <T extends THREE.Material>(m: T) => (mats.push(own(m)), m);
  const mt = (c: THREE.ColorRepresentation, o: THREE.MeshToonMaterialParameters = {}) =>
    mine(new THREE.MeshToonMaterial({ color: c, gradientMap: grad, ...o }));
  const ink = mine(new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }));
  const glow = (c: THREE.ColorRepresentation) => mine(new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
  /** 그림 입힌 툰 재질 */
  const tm = (t: THREE.Texture, o: THREE.MeshToonMaterialParameters = {}) =>
    mine(new THREE.MeshToonMaterial({ map: own(t), gradientMap: grad, ...o }));
  /** 오려 붙이는 그림 (창 · 간판 — 빛 받지 않음) */
  const cut = (t: THREE.Texture, lit = false) =>
    lit
      ? mine(new THREE.MeshToonMaterial({ map: own(t), gradientMap: grad, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }))
      : mine(new THREE.MeshBasicMaterial({ map: own(t), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false }));
  const W = frontLen(b),
    D = b.face === "y" || b.face === "-y" ? b.d : b.w,
    zf = D / 2;
  const put = (mesh: THREE.Mesh, x: number, y: number, z: number, k: number, p: THREE.Object3D) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    return withInk(p, mesh, k, ink);
  };
  /** 상자 (y = 바닥) */
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, k = 0.05, p: THREE.Object3D = G) =>
    put(new THREE.Mesh(own(new THREE.BoxGeometry(w, h, d)), m), x, y + h / 2, z, k, p);
  /** 기운 상자 (가운데 기준 · rx 먼저) */
  const tilt = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx: number, rz = 0, k = 0.04, p: THREE.Object3D = G) => {
    const mesh = new THREE.Mesh(own(new THREE.BoxGeometry(w, h, d)), m);
    mesh.rotation.set(rx, 0, rz);
    return put(mesh, x, y, z, k, p);
  };
  const cyl = (rt: number, rb: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 14, k = 0.04, p: THREE.Object3D = G) =>
    put(new THREE.Mesh(own(new THREE.CylinderGeometry(rt, rb, h, seg)), m), x, y + h / 2, z, k, p);
  const cone = (r: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 14, k = 0.04, p: THREE.Object3D = G) =>
    put(new THREE.Mesh(own(new THREE.ConeGeometry(r, h, seg)), m), x, y + h / 2, z, k, p);
  /** 공 (가운데 기준) */
  const ball = (r: number, m: THREE.Material, x: number, y: number, z: number, k = 0.03, p: THREE.Object3D = G, detail = 1) =>
    put(new THREE.Mesh(own(new THREE.IcosahedronGeometry(r, detail)), m), x, y, z, k, p);
  const plane = (w: number, h: number, m: THREE.Material, x: number, y: number, z: number, ry = 0, p: THREE.Object3D = G) => {
    const q = new THREE.Mesh(own(new THREE.PlaneGeometry(w, h)), m);
    q.position.set(x, y, z);
    q.rotation.y = ry;
    p.add(q);
    return q;
  };
  /** 세모 기둥 (박공 벽): 밑변 span (x) · 높이 rise · 길이 len (z) — y = 바닥 */
  const prism = (span: number, rise: number, len: number, m: THREE.Material, x: number, y: number, z: number, k = 0.05, p: THREE.Object3D = G, alongX = false) => {
    const s = new THREE.Shape();
    s.moveTo(-span / 2, -rise / 2);
    s.lineTo(span / 2, -rise / 2);
    s.lineTo(0, rise / 2);
    s.closePath();
    const g = own(new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false }));
    g.translate(0, 0, -len / 2);
    if (alongX) g.rotateY(Math.PI / 2);
    return put(new THREE.Mesh(g, m), x, y + rise / 2, z, k, p);
  };
  /**
   * 박공 지붕 두 판: 용마루가 x 방향 (alongZ 면 z 방향) · span = 비탈 두 개 합친 폭 · len = 용마루 길이
   * y = 처마 높이 (벽 꼭대기)
   */
  const roof = (span: number, len: number, rise: number, m: THREE.Material, x: number, y: number, z: number, o: { over?: number; thick?: number; alongZ?: boolean; cap?: THREE.Material; p?: THREE.Object3D } = {}) => {
    const { over = 0.45, thick = 0.28, alongZ = false, cap, p = G } = o;
    const R = new THREE.Group();
    R.position.set(x, y, z);
    if (alongZ) R.rotation.y = Math.PI / 2;
    p.add(R);
    const half = span / 2,
      a = Math.atan2(rise, half),
      L = (half + over) / Math.cos(a);
    for (const s of [1, -1]) {
      const dz = Math.cos(a) * s,
        dy = -Math.sin(a);
      const nz = Math.sin(a) * s,
        ny = Math.cos(a);
      tilt(len + over * 2, thick, L, m, 0, rise + dy * (L / 2) + ny * (thick / 2), dz * (L / 2) + nz * (thick / 2), a * s, 0, 0.05, R);
    }
    const ridge = new THREE.Mesh(own(new THREE.CylinderGeometry(0.16, 0.16, len + over * 2 + 0.1, 8)), cap ?? m);
    ridge.rotation.z = Math.PI / 2;
    put(ridge, 0, rise + thick * 0.8, 0, 0.04, R);
    return R;
  };
  /** 붙이기: side 0 앞 · 1 오른쪽(+x) · 2 뒤 · 3 왼쪽 — 면 위 (u 가로, y) */
  const onSide = (side: number, u: number, y: number, out: number, w = W, d = D, cx = 0, cz = 0) => {
    const pos: [number, number, number][] = [
      [cx + u, y, cz + d / 2 + out],
      [cx + w / 2 + out, y, cz - u],
      [cx - u, y, cz - d / 2 - out],
      [cx - w / 2 - out, y, cz + u],
    ];
    return { p: pos[side], ry: [0, Math.PI / 2, Math.PI, -Math.PI / 2][side] };
  };
  /** 창 하나 (그림 + 아래 턱 + 위 인방) — 옆면은 가로 · 깊이를 바꿔 (외곽선 껍데기가 회전을 안 따라감) */
  const win = (side: number, u: number, y: number, w: number, h: number, m: THREE.Material, trim: THREE.Material | null, body: { w?: number; d?: number; cx?: number; cz?: number } = {}) => {
    const bw = body.w ?? W,
      bd = body.d ?? D,
      cx = body.cx ?? 0,
      cz = body.cz ?? 0;
    const { p, ry } = onSide(side, u, y, 0.03, bw, bd, cx, cz);
    plane(w, h, m, p[0], p[1], p[2], ry);
    if (!trim) return;
    const sw = (a: number, c: number) => (side % 2 ? [c, a] : [a, c]);
    const o = onSide(side, u, y - h / 2 - 0.12, 0.08, bw, bd, cx, cz);
    const [s1, s2] = sw(w + 0.3, 0.24);
    box(s1, 0.13, s2, trim, o.p[0], o.p[1], o.p[2], 0.03);
    const t = onSide(side, u, y + h / 2 + 0.02, 0.06, bw, bd, cx, cz);
    const [l1, l2] = sw(w + 0.2, 0.16);
    box(l1, 0.15, l2, trim, t.p[0], t.p[1], t.p[2], 0.03);
  };
  /** 꽃 덤불 (초록 공 몇 개 + 꽃점) */
  const bush = (x: number, y: number, z: number, s: number, leaf: THREE.Material, flower?: THREE.Material, p: THREE.Object3D = G) => {
    ball(0.45 * s, leaf, x, y + 0.3 * s, z, 0.03, p);
    ball(0.32 * s, leaf, x - 0.32 * s, y + 0.2 * s, z + 0.1 * s, 0.03, p);
    ball(0.32 * s, leaf, x + 0.34 * s, y + 0.22 * s, z - 0.05 * s, 0.03, p);
    if (flower)
      for (const [dx, dy, dz] of [
        [-0.2, 0.62, 0.25],
        [0.25, 0.55, 0.3],
        [0.05, 0.72, -0.05],
        [-0.45, 0.35, 0.2],
        [0.5, 0.4, 0.12],
      ])
        ball(0.11 * s, flower, x + dx * s, y + dy * s, z + dz * s, 0, p, 0);
  };
  /** 화분 */
  const pot = (x: number, z: number, s: number, potM: THREE.Material, leaf: THREE.Material, flower?: THREE.Material, y = 0) => {
    cyl(0.3 * s, 0.23 * s, 0.5 * s, potM, x, y, z, 12, 0.04);
    bush(x, y + 0.42 * s, z, s * 0.8, leaf, flower);
  };
  /** 자전거 (앞이 +x) */
  const bike = (x: number, z: number, ry: number, frameM: THREE.Material, basket: boolean, extra?: THREE.Material) => {
    const B = new THREE.Group();
    B.position.set(x, 0, z);
    B.rotation.y = ry;
    G.add(B);
    const tire = mt(0x2b2433),
      metal = mt(0xc9ccd4);
    for (const sx of [-0.52, 0.52]) {
      const wh = new THREE.Mesh(own(new THREE.TorusGeometry(0.33, 0.045, 6, 18)), tire);
      put(wh, sx, 0.36, 0, 0.02, B);
      cyl(0.03, 0.03, 0.06, metal, sx, 0.33, 0, 6, 0, B);
    }
    const bar = (x0: number, y0: number, x1: number, y1: number, m = frameM) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const c = new THREE.Mesh(own(new THREE.CylinderGeometry(0.035, 0.035, len, 6)), m);
      c.rotation.z = Math.atan2(x0 - x1, y1 - y0);
      put(c, (x0 + x1) / 2, (y0 + y1) / 2, 0, 0.02, B);
    };
    bar(-0.52, 0.36, -0.08, 0.36);
    bar(-0.08, 0.36, -0.18, 0.78);
    bar(-0.52, 0.36, -0.18, 0.72);
    bar(-0.18, 0.72, 0.4, 0.74);
    bar(-0.08, 0.36, 0.4, 0.74);
    bar(0.52, 0.36, 0.4, 0.92);
    box(0.24, 0.06, 0.12, mt(0x4a2e1c), -0.18, 0.8, 0, 0.02, B);
    box(0.06, 0.04, 0.5, metal, 0.42, 0.92, 0, 0.02, B);
    if (basket) {
      box(0.34, 0.24, 0.36, mt(0xb98a52), 0.62, 0.78, 0, 0.02, B);
      if (extra) for (const dz of [-0.08, 0.1]) ball(0.1, extra, 0.6, 1.05, dz, 0, B, 0);
    }
    return B;
  };
  /** 떨어지는 꽃잎 (빙글 돌며 아래로, 다 떨어지면 다시 위로) */
  const petals = (n: number, color: number, x0: number, x1: number, z0: number, z1: number, top: number) => {
    const m = mine(new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    const g = own(new THREE.CircleGeometry(0.09, 5));
    g.scale(1, 0.6, 1);
    const ps = Array.from({ length: n }, (_, i) => {
      const q = new THREE.Mesh(g, m);
      G.add(q);
      return { q, x: x0 + Math.random() * (x1 - x0), z: z0 + Math.random() * (z1 - z0), ph: i / n, sp: 0.55 + Math.random() * 0.4 };
    });
    anims.push((t) => {
      for (const p of ps) {
        const f = (t * 0.06 * p.sp + p.ph) % 1;
        p.q.position.set(p.x + Math.sin(t * 0.9 + p.ph * 9) * 0.6, top * (1 - f), p.z + Math.cos(t * 0.7 + p.ph * 7) * 0.4);
        p.q.rotation.set(t * 1.3 + p.ph * 5, t * 0.8 + p.ph, 0);
      }
    });
  };
  /** 시계 (판 + 돌아가는 바늘) — 앞(+z)을 봄 */
  const clock = (r: number, rim: string, x: number, y: number, z: number, p: THREE.Object3D = G) => {
    plane(r * 2, r * 2, cut(clockTex(rim)), x, y, z, 0, p);
    const handM = mine(new THREE.MeshBasicMaterial({ color: INK }));
    const mk = (len: number, wd: number, dz: number) => {
      const g = own(new THREE.PlaneGeometry(wd, len));
      g.translate(0, len / 2 - wd / 2, 0);
      const m = new THREE.Mesh(g, handM);
      m.position.set(x, y, z + dz);
      p.add(m);
      return m;
    };
    const hh = mk(r * 0.48, r * 0.1, 0.01),
      mm = mk(r * 0.72, r * 0.07, 0.02);
    hh.userData.dyn = mm.userData.dyn = true;
    ball(r * 0.08, handM, x, y, z + 0.03, 0, p, 0);
    anims.push(() => {
      const d = new Date(),
        m = d.getMinutes() + d.getSeconds() / 60,
        h = (d.getHours() % 12) + m / 60;
      mm.rotation.z = -(m / 60) * Math.PI * 2;
      hh.rotation.z = -(h / 12) * Math.PI * 2;
    });
  };
  /** 깃발 (장대 끝) — 바람에 펄럭 */
  const flag = (x: number, y: number, z: number, h: number, poleM: THREE.Material, cloth: THREE.Material, fw = 1.0, fh = 0.6) => {
    cyl(0.05, 0.05, h, poleM, x, y, z, 6, 0.02);
    ball(0.1, mt(0xe6c25a), x, y + h + 0.05, z, 0.02);
    const F = new THREE.Group();
    F.position.set(x, y + h - fh / 2 - 0.05, z);
    G.add(F);
    const g = own(new THREE.PlaneGeometry(fw, fh, 6, 1));
    g.translate(fw / 2, 0, 0);
    const pos = g.attributes.position as THREE.BufferAttribute,
      base = Float32Array.from(pos.array as Float32Array);
    const f = new THREE.Mesh(g, cloth);
    F.add(f);
    anims.push((t) => {
      for (let i = 0; i < pos.count; i++) {
        const px = base[i * 3];
        pos.setZ(i, Math.sin(px * 3.2 - t * 4.2) * 0.12 * (px / fw));
      }
      pos.needsUpdate = true;
    });
    return F;
  };
  /** 공사장 때처럼 바닥 아래까지 받침 (비탈 언덕에서 안 뜨게) */
  const footing = (m: THREE.Material, w = W, d = D, depth = 2.2) => box(w, depth, d, m, 0, -depth + 0.02, 0, 0);
  const done = (): Out => {
    G.position.set(b.x + b.w / 2, heightAt(b.x + b.w / 2, b.y + b.d / 2), b.y + b.d / 2);
    G.rotation.y = faceRot(b);
    return { group: G, mats };
  };
  return { G, mats, mine, mt, ink, glow, tm, cut, W, D, zf, put, box, tilt, cyl, cone, ball, plane, prism, roof, onSide, win, bush, pot, bike, petals, clock, flag, footing, done, own, anims };
}

// ───────────── 올인 러브: 꽃 넝쿨 코너 카페 ─────────────

export function codeLove(ctx: LotCtx, b: Building): Out {
  const K = kit(ctx, b);
  const { mt, glow, tm, cut, W, D, zf, box, tilt, cyl, ball, plane, prism, roof, win, bush, pot, bike, petals, own, anims } = K;
  const cream = tm(sidingTex("#f7ead8", "#ead6bd", W / 2, 2.2)),
    creamSide = tm(sidingTex("#f7ead8", "#ead6bd", D / 2, 2.2)),
    coral = mt(0xe0806c),
    coralDark = mt(0xb85a4a),
    brown = mt(0x7a4a35),
    leaf = mt(0x6fae5a),
    leafDark = mt(0x4f8f45),
    pink = mt(0xf7a8c4),
    white = mt(0xfffaf2);
  const F1 = 3.6,
    TOP = 7.0;
  // 몸통 (앞뒤는 W 판자, 옆은 D 판자 그림이 늘어지지 않게 두 겹)
  box(W, TOP, D, creamSide, 0, 0, 0, 0.06);
  box(W + 0.02, TOP, D - 0.4, cream, 0, 0, 0, 0);
  box(W + 0.14, 1.0, D + 0.14, coral, 0, 0, 0, 0.05);
  box(W + 0.24, 0.12, D + 0.24, coralDark, 0, 1.0, 0, 0.03);
  box(W + 0.3, 0.3, D + 0.3, coralDark, 0, F1, 0, 0.05);
  box(W + 0.4, 0.25, D + 0.4, brown, 0, TOP - 0.1, 0, 0.05);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.3, TOP, 0.3, brown, sx * (W / 2), 0, sz * zf, 0.04);
  // 창들
  const shopWin = cut(
    winTex(
      {
        frame: "#7a4a35",
        cols: 3,
        rows: 1,
        curtain: "#fff1ec",
        glass: ["#ffe3b0", "#f5a45a"],
        extra: (g, w, h) => {
          // 안쪽 작은 탁자 · 꽃병 · 케이크 진열장
          g.fillStyle = "#c98a5a";
          g.fillRect(w * 0.18, h * 0.66, w * 0.3, 6);
          g.fillRect(w * 0.31, h * 0.66, 5, h * 0.3);
          g.fillStyle = "#ff8fb0";
          g.beginPath();
          g.arc(w * 0.33, h * 0.6, 7, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = "#fff6ea";
          g.fillRect(w * 0.6, h * 0.55, w * 0.3, h * 0.3);
          g.fillStyle = "#f2b6c8";
          for (let i = 0; i < 3; i++) g.fillRect(w * 0.63 + i * 13, h * 0.6, 9, 9);
        },
      },
      160,
      110
    )
  );
  const warm = cut(winTex({ frame: "#7a4a35", cols: 2, rows: 3, curtain: "#fff1ec" }));
  const arched = cut(winTex({ frame: "#7a4a35", cols: 2, rows: 3, curtain: "#fff1ec", arch: true }, 96, 130));
  // 1층 앞: 큰 진열창 둘 (문 양옆)
  win(0, -3.25, 2.15, 3.2, 2.1, shopWin, brown);
  win(0, 3.25, 2.15, 3.0, 2.0, shopWin, brown);
  // 2층 앞: 아치 창 (왼쪽) · 발코니 창 (오른쪽)
  win(0, -2.7, F1 + 1.75, 1.9, 2.4, arched, brown);
  plane(1.5, 2.3, warm, 2.65, F1 + 1.55, zf + 0.03);
  // 옆 · 뒤 창
  for (const side of [1, 3])
    for (const u of [-4.2, 0, 4.2]) {
      win(side, u, 2.1, 1.6, 1.8, warm, brown);
      win(side, u, F1 + 1.7, 1.4, 1.7, side === 1 && u === 0 ? arched : warm, brown);
    }
  for (const u of [-3, 3]) {
    win(2, u, 2.1, 1.6, 1.8, warm, brown);
    win(2, u, F1 + 1.7, 1.4, 1.7, warm, brown);
  }
  // 문: 빨간 나무문 + 작은 격자창 + 돌계단 · 위에 작은 지붕
  const doorT = tex(96, 160, (g, w, h) => {
    g.fillStyle = "#c2554a";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#a8433a";
    g.fillRect(10, h * 0.62, w - 20, h * 0.3);
    const gr = g.createLinearGradient(0, 10, 0, h * 0.55);
    gr.addColorStop(0, "#ffe6a8");
    gr.addColorStop(1, "#f0a54e");
    g.fillStyle = gr;
    g.beginPath();
    g.roundRect(14, 12, w - 28, h * 0.44, [30, 30, 4, 4]);
    g.fill();
    g.fillStyle = "#7a4a35";
    g.fillRect(w / 2 - 2, 12, 4, h * 0.44);
    g.fillRect(14, h * 0.28, w - 28, 4);
    g.fillStyle = "#e6c25a";
    g.beginPath();
    g.arc(w - 18, h * 0.6, 5, 0, Math.PI * 2);
    g.fill();
  });
  box(1.9, 2.75, 0.22, brown, 0, 0, zf + 0.02, 0.04);
  plane(1.45, 2.45, cut(doorT, true), 0, 1.25, zf + 0.15);
  box(2.4, 0.18, 0.9, mt(0xd8cbb8), 0, 0, zf + 0.5, 0.03);
  tilt(2.2, 0.12, 0.75, mt(0xd8665a), 0, 2.9, zf + 0.36, 0.5, 0, 0.04);
  // 이름판 (문 위)
  plane(2.0, 0.45, cut(textTex("올인 러브", { w: 320, h: 72, bg: "#fff6ea", fg: "#d0566a", border: "#e0806c", font: '400 40px "Black Han Sans", sans-serif', r: 26 }), true), 0, F1 - 0.3, zf + 0.06);
  // 줄무늬 차양 둘 (진열창 위) + 물결 끝단 + 전구 줄
  const awT = stripeTex("#f08c7a", "#fff1e4", 10),
    scT = scallopTex("#f08c7a", "#fff1e4", 10);
  const bulbM = glow(0xffe08a);
  for (const sx of [-1, 1]) {
    const aw = new THREE.Group();
    aw.position.set(sx * 3.25, 3.42, zf + 0.12);
    K.G.add(aw);
    const cloth = new THREE.Mesh(own(new THREE.PlaneGeometry(3.5, 1.35)), cut(awT, true));
    cloth.rotation.x = -Math.PI / 2 + 0.6;
    cloth.position.set(0, -0.3, 0.56);
    aw.add(cloth);
    const sc = new THREE.Mesh(own(new THREE.PlaneGeometry(3.5, 0.36)), cut(scT, true));
    sc.position.set(0, -0.77, 1.1);
    aw.add(sc);
    // 전구 줄 (끝단 아래로 늘어짐)
    for (let i = 0; i <= 8; i++) {
      const u = -1.65 + (i * 3.3) / 8;
      ball(0.06, bulbM, sx * 3.25 + u, 2.45 - Math.sin((i / 8) * Math.PI) * 0.18, zf + 1.24, 0, K.G, 0);
    }
  }
  // 진열창 아래 꽃상자
  for (const sx of [-1, 1]) {
    box(3.0, 0.4, 0.45, brown, sx * 3.25, 0.62, zf + 0.25, 0.03);
    for (let i = 0; i < 5; i++) bush(sx * 3.25 - 1.2 + i * 0.6, 0.9, zf + 0.28, 0.55, leaf, pink);
  }
  // 2층 발코니 (오른쪽): 바닥판 · 난간 · 꽃 · 넝쿨 · 등 둘
  const bx = 2.65;
  box(3.6, 0.22, 1.25, brown, bx, F1 + 0.02, zf + 0.6, 0.04);
  box(3.6, 0.1, 0.1, brown, bx, F1 + 1.05, zf + 1.17, 0.03);
  for (const sx of [-1, 1]) box(0.1, 0.1, 1.2, brown, bx + sx * 1.75, F1 + 1.05, zf + 0.6, 0.03);
  for (let i = 0; i <= 12; i++) box(0.06, 0.85, 0.06, brown, bx - 1.75 + (i * 3.5) / 12, F1 + 0.22, zf + 1.17, 0.015);
  for (let i = 0; i < 6; i++) bush(bx - 1.5 + i * 0.6, F1 + 1.05, zf + 1.15, 0.5, leafDark, pink);
  for (const dx of [-1.3, -0.2, 0.9]) for (let k = 0; k < 3; k++) ball(0.16, leafDark, bx + dx, F1 + 0.55 - k * 0.32, zf + 1.24, 0.02);
  const lanternM = glow(0xffd58a),
    iron = mt(0x3a2e2a);
  for (const sx of [-1, 1]) {
    box(0.08, 0.08, 0.3, iron, bx + sx * 1.0, F1 + 2.3, zf + 0.15, 0.02);
    box(0.3, 0.42, 0.3, iron, bx + sx * 1.0, F1 + 1.95, zf + 0.32, 0.02);
    box(0.22, 0.32, 0.32, lanternM, bx + sx * 1.0, F1 + 2.0, zf + 0.32, 0);
  }
  // 왼쪽 앞 모서리를 타고 오르는 꽃 넝쿨
  for (let k = 0; k < 9; k++) {
    const y = 1.2 + k * 0.62,
      x = -W / 2 + 0.15 + Math.sin(k * 1.7) * 0.25;
    ball(0.3, k % 2 ? leaf : leafDark, x, y, zf + 0.15, 0.025);
    if (k % 2 === 0) ball(0.1, pink, x + 0.18, y + 0.15, zf + 0.42, 0, K.G, 0);
  }
  for (let k = 0; k < 5; k++) ball(0.28, leaf, -W / 2 + 0.6 + k * 0.7, TOP - 0.25 - (k % 2) * 0.2, zf + 0.2, 0.025);
  // 지붕: 앞을 보는 박공 (산호 기와) + 박공벽 + 둥근 다락창 + 굴뚝
  const RISE = 3.1;
  prism(W, RISE, D, creamSide, 0, TOP + 0.15, 0, 0.05);
  roof(W, D, RISE, tm(tileTex("#d8665a", "#c95a4f", "#9a3e36", 5, 4)), 0, TOP + 0.15, 0, { alongZ: true, over: 0.55, cap: coralDark });
  plane(1.3, 1.3, cut(tex(96, 96, (g, w) => {
    g.clearRect(0, 0, w, w);
    g.fillStyle = "#7a4a35";
    g.beginPath();
    g.arc(48, 48, 47, 0, Math.PI * 2);
    g.fill();
    const gr = g.createRadialGradient(48, 52, 4, 48, 48, 40);
    gr.addColorStop(0, "#fff0c4");
    gr.addColorStop(1, "#f0a54e");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(48, 48, 38, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#7a4a35";
    g.fillRect(45, 10, 6, 76);
    g.fillRect(10, 45, 76, 6);
  })), 0, TOP + 1.25, zf + 0.04);
  box(0.95, 3.0, 0.95, tm(brickTex("#e8d8c0", ["#e9e0d0", "#f3ecdf", "#ddd2bf"], 1, 2)), W / 2 - 2.1, TOP + 0.9, -2.6, 0.05);
  box(1.1, 0.2, 1.1, coralDark, W / 2 - 2.1, TOP + 3.85, -2.6, 0.03);
  // 하트 네온 (오른쪽 모서리 쇠 받침 · 콩닥콩닥)
  const heartT = tex(128, 120, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#fff6ea";
    g.beginPath();
    g.roundRect(4, 4, w - 8, h - 8, 26);
    g.fill();
    g.strokeStyle = "#7a4a35";
    g.lineWidth = 6;
    g.stroke();
    g.fillStyle = "#ff7fa2";
    heartPath(g, w / 2, h / 2 - 2, 38);
    g.fill();
    g.strokeStyle = "#ffffff";
    g.lineWidth = 6;
    heartPath(g, w / 2, h / 2 - 2, 26);
    g.stroke();
  });
  const arm = new THREE.Group();
  arm.position.set(W / 2 + 0.05, F1 + 0.55, zf - 0.6);
  K.G.add(arm);
  box(1.4, 0.07, 0.07, iron, 0.7, 0, 0, 0.02, arm);
  const curl = new THREE.Mesh(own(new THREE.TorusGeometry(0.22, 0.03, 4, 12, Math.PI * 1.5)), iron);
  curl.position.set(0.36, -0.22, 0);
  arm.add(curl);
  const hs = new THREE.Group();
  hs.position.set(0.95, -0.72, 0);
  arm.add(hs);
  const heart = plane(1.15, 1.08, cut(heartT), 0, 0, 0, 0, hs);
  const heartBack = plane(1.15, 1.08, cut(heartT), 0, 0, -0.01, Math.PI, hs);
  for (const dx of [-0.35, 0.35]) cyl(0.012, 0.012, 0.2, iron, dx, 0.52, 0, 4, 0, hs);
  anims.push((t) => {
    const s = 1 + Math.max(0, Math.sin(t * 5.2)) ** 8 * 0.08;
    heart.scale.setScalar(s);
    heartBack.scale.setScalar(s);
    hs.rotation.z = Math.sin(t * 1.2) * 0.04;
  });
  // 칠판 입간판 (빈 칠판 + 낙서 하트)
  const chalkT = tex(96, 128, (g, w, h) => {
    g.fillStyle = "#8a5a3b";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#2f3b36";
    g.fillRect(8, 8, w - 16, h - 16);
    g.strokeStyle = "rgba(255,255,255,0.75)";
    g.lineWidth = 3;
    heartPath(g, w / 2, 40, 14);
    g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.4)";
    for (const y of [70, 84, 98]) {
      g.beginPath();
      g.moveTo(20, y);
      g.lineTo(w - 20 - (y % 3) * 6, y);
      g.stroke();
    }
  });
  const chalk = cut(chalkT, true);
  const cb = new THREE.Group();
  cb.position.set(1.85, 0, zf + 1.1);
  cb.rotation.y = -0.35;
  K.G.add(cb);
  for (const s of [1, -1]) {
    const pnl = new THREE.Mesh(own(new THREE.PlaneGeometry(0.62, 0.95)), chalk);
    pnl.position.set(0, 0.47, s * 0.13);
    pnl.rotation.x = s * -0.25;
    cb.add(pnl);
  }
  // 자전거 (꽃바구니) · 화분
  bike(-4.0, zf + 0.95, 0.05, coral, true, pink);
  const potM = mt(0xd9825a);
  pot(-W / 2 + 0.55, zf + 0.55, 1.3, potM, leaf);
  pot(W / 2 - 0.5, zf + 0.6, 1.1, potM, leaf, pink);
  pot(-1.35, zf + 0.6, 0.85, potM, leaf, mt(0xffffff));
  // 뒤뜰 의자 둘
  for (const sx of [-1.4, 1.4]) {
    cyl(0.36, 0.36, 0.06, white, sx, 0.72, -zf - 0.9, 14, 0.02);
    cyl(0.04, 0.04, 0.72, iron, sx, 0, -zf - 0.9, 6, 0.01);
  }
  petals(14, 0xffb7cf, -W / 2 - 1, W / 2 + 1, zf - 2, zf + 2.4, 9);
  return K.done();
}

// ───────────── 오늘의 용의자: 뒷골목 탐정사무소 ─────────────

export function codeSuspect(ctx: LotCtx, b: Building): Out {
  const K = kit(ctx, b);
  const { mt, glow, tm, cut, W, D, zf, box, cyl, cone, ball, plane, win, own, anims } = K;
  const brick = tm(brickTex("#3a2a2a", ["#6e3428", "#7d3b2e", "#5e2c23", "#733a2c"], W / 1.4, 11 / 0.9)),
    brickSide = tm(brickTex("#3a2a2a", ["#6e3428", "#7d3b2e", "#5e2c23", "#733a2c"], D / 1.4, 11 / 0.9)),
    char = mt(0x2f2f36),
    charL = mt(0x40404a),
    stone = mt(0x8a8580),
    green = mt(0x2e5a45),
    rust = mt(0x7a3e2a),
    ivy = mt(0x4f7d45),
    metal = mt(0x6a6f78),
    wood = mt(0x8a6240);
  const F1 = 3.3,
    F2 = 3.0,
    F3 = 2.8,
    TOP = F1 + F2 + F3;
  box(W, TOP, D, brickSide, 0, 0, 0, 0.06);
  box(W + 0.02, TOP, D - 0.4, brick, 0, 0, 0, 0);
  // 1층 숯빛 나무 가게 앞 · 돌 띠 · 처마 돌림띠
  box(W + 0.12, F1, 0.3, char, 0, 0, zf + 0.0, 0.05);
  box(W + 0.3, 0.5, 0.5, charL, 0, F1 - 0.55, zf + 0.1, 0.04);
  for (const x of [-W / 2 + 0.2, -0.95, 0.95, W / 2 - 0.2]) box(0.3, F1 - 0.55, 0.42, charL, x, 0, zf + 0.12, 0.03);
  box(W + 0.24, 0.22, D + 0.24, stone, 0, F1, 0, 0.04);
  box(W + 0.24, 0.18, D + 0.24, stone, 0, F1 + F2, 0, 0.03);
  box(W + 0.4, 0.3, D + 0.4, stone, 0, TOP - 0.05, 0, 0.05);
  // 가게 이름판
  plane(5.6, 0.46, cut(textTex("오늘의 용의자", { w: 420, h: 48, bg: null, fg: "#e6c27a", font: '800 32px "Nanum Gothic", sans-serif' })), 0, F1 - 0.3, zf + 0.37);
  // 왼쪽 큰 창: 젖빛 유리 + 돋보기 그림자 · 서류장
  const officeT = winTex(
    {
      frame: "#2f2f36",
      cols: 2,
      rows: 1,
      curtain: null,
      glass: ["#ffd98a", "#c9822f"],
      extra: (g, w, h) => {
        g.fillStyle = "rgba(60,40,24,0.55)";
        g.fillRect(w * 0.06, h * 0.42, w * 0.2, h * 0.58);
        g.fillRect(w * 0.78, h * 0.36, w * 0.16, h * 0.64);
        g.fillStyle = "rgba(255,248,225,0.45)";
        g.fillRect(0, h * 0.45, w, h * 0.18);
        g.strokeStyle = "#3a2618";
        g.lineWidth = 9;
        g.beginPath();
        g.arc(w * 0.45, h * 0.44, h * 0.2, 0, Math.PI * 2);
        g.stroke();
        g.lineWidth = 12;
        g.beginPath();
        g.moveTo(w * 0.45 + h * 0.15, h * 0.58);
        g.lineTo(w * 0.45 + h * 0.34, h * 0.82);
        g.stroke();
      },
    },
    150,
    110
  );
  plane(2.3, 1.75, cut(officeT), -2.35, 1.75, zf + 0.17);
  box(2.6, 0.12, 0.35, stone, -2.35, 0.78, zf + 0.42, 0.03);
  // 짧은 줄무늬 차양 (진회색)
  const aw = new THREE.Mesh(own(new THREE.PlaneGeometry(2.7, 1.0)), cut(stripeTex("#3b3d45", "#6b6e78", 8), true));
  aw.rotation.x = -Math.PI / 2 + 0.7;
  aw.position.set(-2.35, F1 - 0.85, zf + 0.75);
  K.G.add(aw);
  // 문 (무거운 초록 문 · 작은 창 · 황동 손잡이) + 돌계단 둘 + 녹색 갓 전등
  const doorT = tex(80, 160, (g, w, h) => {
    g.fillStyle = "#2e5a45";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#214234";
    g.lineWidth = 5;
    g.strokeRect(10, h * 0.42, w - 20, h * 0.22);
    g.strokeRect(10, h * 0.7, w - 20, h * 0.24);
    g.fillStyle = "#ffd98a";
    g.fillRect(14, 12, w - 28, h * 0.26);
    g.fillStyle = "#214234";
    g.fillRect(w / 2 - 2, 12, 4, h * 0.26);
    g.fillStyle = "#e6c27a";
    g.beginPath();
    g.arc(w - 15, h * 0.58, 5, 0, Math.PI * 2);
    g.fill();
    g.fillRect(w / 2 - 12, h * 0.36, 24, 6);
  });
  plane(1.3, 2.45, cut(doorT, true), 0, 1.5, zf + 0.17);
  box(1.75, 0.2, 0.5, stone, 0, 0.0, zf + 0.42, 0.03);
  box(1.55, 0.2, 0.35, stone, 0, 0.2, zf + 0.35, 0.03);
  box(0.06, 0.06, 0.5, char, 0, F1 - 0.95, zf + 0.45, 0.02);
  cone(0.34, 0.26, green, 0, F1 - 1.3, zf + 0.68, 12, 0.03);
  ball(0.13, glow(0xffe0a0), 0, F1 - 1.32, zf + 0.68, 0, K.G, 1);
  // 오른쪽 벽보 셋 (글씨 없이)
  const paper = (c: string) => cut(tex(48, 64, (g, w, h) => {
    g.fillStyle = c;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(43,36,51,0.5)";
    g.fillRect(8, 10, w - 16, 12);
    for (let y = 30; y < h - 8; y += 8) g.fillRect(8, y, w - 16 - (y % 16), 3);
  }), true);
  plane(0.55, 0.72, paper("#efe6cf"), 1.65, 1.8, zf + 0.33);
  plane(0.5, 0.66, paper("#e6d3a8"), 2.4, 2.0, zf + 0.33);
  plane(0.45, 0.6, paper("#f2ece0"), 2.0, 1.15, zf + 0.33);
  // 2층: 넓은 창 (블라인드 반쯤 · 불빛 샘) + 창턱 고양이 + 넝쿨
  const blindsT = winTex({ frame: "#3a3036", cols: 3, rows: 1, curtain: null, blinds: true, glass: ["#ffd98a", "#d08a3a"] }, 160, 96);
  win(0, -0.4, F1 + 1.45, 3.7, 1.9, cut(blindsT), stone);
  const catT = tex(64, 64, (g) => {
    g.clearRect(0, 0, 64, 64);
    g.fillStyle = "#1f1b22";
    g.beginPath();
    g.ellipse(30, 46, 14, 16, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(30, 26, 10, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(21, 22);
    g.lineTo(23, 9);
    g.lineTo(29, 18);
    g.moveTo(31, 18);
    g.lineTo(37, 9);
    g.lineTo(39, 22);
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = "#1f1b22";
    g.beginPath();
    g.moveTo(42, 56);
    g.quadraticCurveTo(58, 54, 54, 36);
    g.stroke();
    g.fillStyle = "#ffd34d";
    g.fillRect(25, 25, 3, 3);
    g.fillRect(33, 25, 3, 3);
  });
  const cat = plane(0.62, 0.62, cut(catT), -1.3, F1 + 0.78, zf + 0.12);
  anims.push((t) => (cat.rotation.z = Math.sin(t * 0.8) * 0.03));
  win(0, 2.85, F1 + 1.45, 1.1, 1.6, cut(winTex({ frame: "#3a3036", cols: 1, rows: 2, curtain: "#d8c8a8" })), stone);
  for (let k = 0; k < 7; k++) ball(0.26, ivy, -W / 2 + 0.35 + (k % 3) * 0.32, F1 + 0.4 + k * 0.42, zf + 0.12, 0.025);
  // 3층 창 둘 · 옆 · 뒤 창
  const nightT = cut(winTex({ frame: "#3a3036", cols: 2, rows: 2, curtain: "#d8c8a8", glass: ["#ffe0a0", "#c98a3a"] }));
  const darkT = cut(winTex({ frame: "#3a3036", cols: 2, rows: 2, curtain: null, glass: ["#56607a", "#2b3246"] }));
  for (const u of [-1.8, 1.8]) win(0, u, F1 + F2 + 1.4, 1.2, 1.6, u < 0 ? nightT : darkT, stone);
  for (const side of [1, 3])
    for (const u of [-2.2, 2.2]) {
      win(side, u, F1 + 1.45, 1.1, 1.5, u > 0 ? nightT : darkT, stone);
      win(side, u, F1 + F2 + 1.4, 1.1, 1.5, darkT, stone);
    }
  for (const u of [-1.8, 1.8]) win(2, u, F1 + 1.45, 1.1, 1.5, darkT, stone);
  // 맨사드 지붕 (검은 슬레이트) + 지붕창 둘 + 굴뚝
  const slate = tm(tex(64, 64, (g, w, h) => {
    g.fillStyle = "#2a2c33";
    g.fillRect(0, 0, w, h);
    for (let r = 0; r < 4; r++)
      for (let c = -1; c < 5; c++) {
        g.fillStyle = (r + c) % 2 ? "#34363f" : "#2e3038";
        g.fillRect(c * 16 + (r % 2 ? 8 : 0) + 1, r * 16 + 1, 14, 14);
      }
  }, 4, 2), { side: THREE.DoubleSide });
  const RH = 2.2;
  const roofG = own(new THREE.CylinderGeometry(Math.SQRT1_2 * 0.7, Math.SQRT1_2, RH, 4, 1, true));
  roofG.rotateY(Math.PI / 4);
  const rf = new THREE.Mesh(roofG, slate);
  rf.scale.set(W + 0.4, 1, D + 0.4);
  rf.position.y = TOP + 0.25 + RH / 2;
  rf.castShadow = true;
  K.G.add(rf);
  const rInk = new THREE.Mesh(roofG, K.ink);
  rInk.scale.set(W + 0.52, 1.02, D + 0.52);
  rInk.position.copy(rf.position);
  K.G.add(rInk);
  const topY = TOP + 0.25 + RH;
  box((W + 0.4) * 0.7, 0.16, (D + 0.4) * 0.7, char, 0, topY - 0.04, 0, 0.04);
  const slopeZ = (y: number) => zf + 0.2 - ((y - (TOP + 0.25)) / RH) * ((D + 0.4) * 0.15);
  for (const sx of [-1, 1]) {
    const y0 = TOP + 0.45,
      z = slopeZ(y0 + 0.7) - 0.1;
    box(1.25, 1.3, 0.9, char, sx * 1.7, y0, z - 0.3, 0.04);
    plane(0.85, 0.9, sx < 0 ? nightT : darkT, sx * 1.7, y0 + 0.65, z + 0.16);
    const cap = new THREE.Mesh(own(new THREE.ConeGeometry(0.9, 0.7, 4)), mt(0x2a2c33));
    cap.rotation.y = Math.PI / 4;
    cap.scale.set(1, 1, 0.75);
    K.put(cap, sx * 1.7, y0 + 1.65, z - 0.3, 0.04, K.G);
  }
  box(0.85, 2.2, 0.85, brick, -W / 2 + 1.2, topY - 0.9, -D / 2 + 1.4, 0.05);
  box(1.0, 0.16, 1.0, stone, -W / 2 + 1.2, topY + 1.3, -D / 2 + 1.4, 0.03);
  // 비상계단 (왼쪽 벽): 층마다 발판 · 난간 · 사다리
  for (const y of [F1 + 0.05, F1 + F2 + 0.05]) {
    box(1.0, 0.08, 2.6, rust, -W / 2 - 0.5, y, 0.2, 0.03);
    box(0.06, 0.06, 2.6, rust, -W / 2 - 0.98, y + 0.9, 0.2, 0.02);
    for (let i = 0; i <= 5; i++) box(0.05, 0.9, 0.05, rust, -W / 2 - 0.98, y, -1.1 + i * 0.52, 0.012);
    for (const z of [-1.1, 1.5]) box(1.0, 0.06, 0.06, rust, -W / 2 - 0.5, y + 0.9, z, 0.012);
  }
  for (const dz of [-0.25, 0.25]) box(0.05, F1 - 0.6, 0.05, rust, -W / 2 - 0.75, 0.6, 1.2 + dz, 0.012);
  for (let i = 0; i < 7; i++) box(0.04, 0.04, 0.5, rust, -W / 2 - 0.75, 0.9 + i * 0.4, 1.2, 0);
  // 빗물 홈통 (오른쪽 앞 모서리)
  cyl(0.08, 0.08, TOP + 0.1, metal, W / 2 + 0.05, 0.2, zf - 0.15, 8, 0.02);
  box(0.3, 0.12, 0.2, metal, W / 2 + 0.05, 0.08, zf + 0.0, 0.02);
  // 골목 소품: 나무 상자 · 쓰레기통 · 가로등
  box(0.75, 0.6, 0.7, wood, -W / 2 + 0.6, 0, zf + 0.7, 0.03);
  box(0.65, 0.55, 0.6, wood, -W / 2 + 0.65, 0.6, zf + 0.65, 0.03);
  box(0.6, 0.5, 0.55, mt(0x7a5638), -W / 2 + 1.35, 0, zf + 0.85, 0.03);
  cyl(0.3, 0.27, 0.75, metal, W / 2 - 0.5, 0, zf + 0.55, 12, 0.03);
  cyl(0.33, 0.33, 0.08, mt(0x575c66), W / 2 - 0.5, 0.75, zf + 0.55, 12, 0.02);
  const lampX = W / 2 - 0.35,
    lampZ = zf + 1.25;
  cyl(0.07, 0.1, 3.4, char, lampX, 0, lampZ, 8, 0.02);
  box(0.36, 0.5, 0.36, char, lampX, 3.4, lampZ, 0.03);
  box(0.26, 0.36, 0.38, glow(0xffd98a), lampX, 3.47, lampZ, 0);
  cone(0.3, 0.3, char, lampX, 3.9, lampZ, 4, 0.03);
  return K.done();
}

// ───────────── PIXEL LUCKY DEFENSE: 언덕 위 장난감 성 ─────────────

export function codeDefense(ctx: LotCtx, b: Building): Out {
  const K = kit(ctx, b);
  const { mt, glow, tm, cut, W, D, zf, box, tilt, cyl, cone, ball, plane, flag, footing, own, anims } = K;
  const sc = ["#d9c7a6", "#cfbb98", "#e2d2b4", "#c8b28c"];
  const stoneF = tm(stoneTex("#a89478", sc, 12 / 1.6, 5 / 0.8)),
    stoneS = tm(stoneTex("#a89478", sc, 3, 5 / 0.8)),
    stoneT = tm(stoneTex("#a89478", sc, 4, 8 / 0.8)),
    stoneDark = mt(0xb3a080),
    blue = mt(0x3f6fd0),
    blueDark = mt(0x2f55a8),
    gold = mt(0xe6c25a),
    wood = mt(0x9a6a3e),
    woodDark = mt(0x6b4429),
    iron = mt(0x3a3a42),
    grassDark = mt(0x5ea84a);
  footing(mt(0xa89478), W - 1, D - 1, 2.4);
  const zW = zf - 3.4; // 앞 성벽 가운데 (앞면 = zW + 0.8)
  // 성 둘레 덤불
  for (const [x, z, r] of [
    [-W / 2 + 0.9, zW + 0.6, 0.8],
    [W / 2 - 0.9, zW + 0.4, 0.85],
    [-W / 2 + 1.0, -zf + 3.2, 0.9],
    [W / 2 - 1.0, -zf + 3.0, 0.9],
  ])
    K.bush(x, 0, z, r * 1.6, grassDark);
  const WH = 5.0;
  // 안쪽을 채운 성 마당 (위가 성벽 길)
  box(14, WH - 0.4, D - 5.2, stoneDark, 0, 0, zW - (D - 5.2) / 2 + 0.6, 0.05);
  // 앞 성벽 · 옆 · 뒤 성벽
  box(12.4, WH, 1.6, stoneF, 0, 0, zW, 0.06);
  for (const sx of [-1, 1]) box(1.5, WH - 0.4, D - 4.6, stoneS, sx * 7.3, 0, zW - (D - 4.6) / 2 + 0.6, 0.06);
  box(15, WH - 0.4, 1.5, stoneF, 0, 0, -zf + 1.3, 0.06);
  // 톱니 성가퀴 (앞 · 뒤 · 옆)
  for (let x = -5.7; x <= 5.71; x += 1.27) box(0.72, 0.7, 0.55, stoneT, x, WH, zW + 0.5, 0.04);
  for (let x = -6.2; x <= 6.21; x += 1.55) box(0.72, 0.6, 0.5, stoneT, x, WH - 0.4, -zf + 1.75, 0.04);
  for (const sx of [-1, 1]) for (let z = zW - 1.6; z > -zf + 2.2; z -= 1.5) box(0.5, 0.6, 0.72, stoneT, sx * 7.85, WH - 0.4, z, 0.04);
  // 성문: 아치 돌테 · 쇠창살 · 안쪽 불빛
  const gateT = tex(128, 160, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const arch = (r: number) => {
      g.beginPath();
      g.moveTo(w / 2 - r, h);
      g.lineTo(w / 2 - r, w / 2);
      g.arc(w / 2, w / 2, r, Math.PI, 0);
      g.lineTo(w / 2 + r, h);
      g.closePath();
    };
    g.fillStyle = "#b8a482";
    arch(64);
    g.fill();
    g.strokeStyle = "#8a7558";
    g.lineWidth = 3;
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI + (i / 8) * Math.PI;
      g.beginPath();
      g.moveTo(w / 2 + Math.cos(a) * 48, w / 2 + Math.sin(a) * 48);
      g.lineTo(w / 2 + Math.cos(a) * 64, w / 2 + Math.sin(a) * 64);
      g.stroke();
    }
    const gr = g.createLinearGradient(0, 30, 0, h);
    gr.addColorStop(0, "#5a3a22");
    gr.addColorStop(1, "#ffb84a");
    g.fillStyle = gr;
    arch(48);
    g.fill();
    g.fillStyle = "#2b2433";
    for (let x = w / 2 - 44; x < w / 2 + 48; x += 14) g.fillRect(x, 8, 5, h);
    for (let y = 40; y < h; y += 22) g.fillRect(w / 2 - 48, y, 96, 5);
  });
  plane(3.4, 4.25, cut(gateT, true), 0, 2.12, zW + 0.82);
  // 도개교 (나무 판 · 쇠사슬 둘)
  const bridgeZ0 = zW + 0.8,
    bridgeL = zf - bridgeZ0 + 0.2;
  const planks = tm(tex(64, 64, (g, w, h) => {
    g.fillStyle = "#a8743e";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#7a5228";
    for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 3, h);
    g.fillStyle = "#3a3a42";
    g.fillRect(0, 8, w, 4);
    g.fillRect(0, h - 12, w, 4);
  }, 2, 1));
  tilt(3.0, 0.22, bridgeL, planks, 0, 0.32, bridgeZ0 + bridgeL / 2, 0.1, 0, 0.04);
  for (const sx of [-1, 1]) {
    const x0 = sx * 1.35,
      y0 = 3.9,
      z0 = zW + 0.82,
      x1 = sx * 1.35,
      y1 = 0.3,
      z1 = bridgeZ0 + bridgeL - 0.2;
    const len = Math.hypot(y1 - y0, z1 - z0);
    const ch = new THREE.Mesh(own(new THREE.CylinderGeometry(0.05, 0.05, len, 6)), iron);
    ch.rotation.x = Math.atan2(z1 - z0, y0 - y1);
    K.put(ch, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0.02, K.G);
  }
  // 큰 방패 (성문 위)
  const shieldT = tex(96, 112, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const sh = (i: number) => {
      g.beginPath();
      g.moveTo(i, i);
      g.lineTo(w - i, i);
      g.lineTo(w - i, h * 0.48);
      g.quadraticCurveTo(w - i, h * 0.82, w / 2, h - i);
      g.quadraticCurveTo(i, h * 0.82, i, h * 0.48);
      g.closePath();
    };
    g.fillStyle = "#e6c25a";
    sh(2);
    g.fill();
    g.fillStyle = "#3f6fd0";
    sh(10);
    g.fill();
    g.fillStyle = "#e6c25a";
    g.beginPath();
    g.moveTo(w / 2, 26);
    g.lineTo(w / 2 + 18, h * 0.46);
    g.lineTo(w / 2, h * 0.72);
    g.lineTo(w / 2 - 18, h * 0.46);
    g.closePath();
    g.fill();
  });
  const shieldM = cut(shieldT, true);
  plane(1.45, 1.7, shieldM, 0, WH - 0.55, zW + 0.84);
  // 깃발 휘장 둘 (앞 성벽)
  const bannerT = tex(64, 160, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#3f6fd0";
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w, 0);
    g.lineTo(w, h);
    g.lineTo(w / 2, h - 18);
    g.lineTo(0, h);
    g.closePath();
    g.fill();
    g.fillStyle = "#e6c25a";
    g.fillRect(0, 0, w, 10);
    g.fillRect(6, 14, 5, h - 34);
    g.fillRect(w - 11, 14, 5, h - 34);
    g.beginPath();
    g.moveTo(w / 2, 46);
    g.lineTo(w / 2 + 14, 66);
    g.lineTo(w / 2, 86);
    g.lineTo(w / 2 - 14, 66);
    g.closePath();
    g.fill();
  });
  const bannerM = cut(bannerT, true);
  for (const sx of [-1, 1]) {
    box(1.3, 0.1, 0.1, gold, sx * 3.7, WH - 0.45, zW + 0.86, 0.02);
    plane(1.1, 2.75, bannerM, sx * 3.7, WH - 1.85, zW + 0.84);
  }
  // 횃불 둘 (성문 양옆 · 불꽃 일렁)
  const flameM = glow(0xffa33a),
    flameIn = glow(0xffe07a);
  const flames: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    box(0.12, 0.12, 0.45, iron, sx * 2.35, 2.55, zW + 1.0, 0.02);
    cyl(0.16, 0.1, 0.34, woodDark, sx * 2.35, 2.55, zW + 1.25, 8, 0.02);
    const f = new THREE.Group();
    f.position.set(sx * 2.35, 2.9, zW + 1.25);
    K.G.add(f);
    cone(0.2, 0.55, flameM, 0, 0, 0, 8, 0.02, f);
    cone(0.11, 0.34, flameIn, 0, 0.02, 0.04, 8, 0, f);
    flames.push(f);
  }
  anims.push((t) => flames.forEach((f, i) => f.scale.set(1, 0.85 + Math.abs(Math.sin(t * 9 + i * 2)) * 0.3, 1)));
  // 탑: 앞 둘 (크게) · 가운데 뒤 본성 · 뒤 둘 (작게) — 파란 고깔 · 노란 창 · 깃발
  const winGlow = cut(winTex({ frame: "#8a7558", cols: 1, rows: 2, curtain: null, arch: true, glass: ["#ffe08a", "#f0a040"] }, 64, 96));
  const flagM = K.mine(new THREE.MeshToonMaterial({ color: 0x3f6fd0, gradientMap: ctx.grad, side: THREE.DoubleSide }));
  const tower = (x: number, z: number, r: number, h: number, wins: number[], fl = true) => {
    const tg = own(new THREE.CylinderGeometry(r, r * 1.04, h, 20));
    const t = new THREE.Mesh(tg, tm(stoneTex("#a89478", sc, (r * 6.28) / 1.6, h / 0.8)));
    K.put(t, x, h / 2, z, 0.08, K.G);
    cyl(r + 0.25, r + 0.25, 0.4, stoneDark, x, h - 0.1, z, 20, 0.05);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const m = box(0.55, 0.55, 0.45, stoneT, x + Math.sin(a) * (r + 0.05), h + 0.3, z + Math.cos(a) * (r + 0.05), 0);
      m.rotation.y = a;
    }
    cone(r + 0.55, r * 1.45, blue, x, h + 0.55, z, 20, 0.06);
    cyl(r + 0.58, r + 0.58, 0.14, blueDark, x, h + 0.5, z, 20, 0.03);
    for (const y of wins) plane(0.55, 0.85, winGlow, x, y, z + r + 0.02);
    if (fl) flag(x, h + 0.55 + r * 1.45 - 0.05, z, 1.6, gold, flagM, 1.15, 0.6);
  };
  tower(-7.4, zW, 2.15, 8.0, [3.2, 6.0]);
  tower(7.4, zW, 2.15, 8.0, [3.2, 6.0]);
  tower(0, -zf + 3.6, 2.6, 10.5, [WH + 1.3, WH + 3.8]);
  tower(-7.0, -zf + 1.7, 1.5, 6.4, [], false);
  tower(7.0, -zf + 1.7, 1.5, 6.4, [], false);
  // 방패 (탑 둘)
  for (const sx of [-1, 1]) {
    const s = plane(0.95, 1.1, shieldM, sx * 7.4, 4.6, zW + 2.17);
    s.rotation.y = 0;
  }
  // 투석기 (성벽 위 왼쪽) — 팔이 천천히 까딱
  const cat = new THREE.Group();
  cat.position.set(-3.4, WH - 0.4, zW - 1.4);
  K.G.add(cat);
  for (const sx of [-0.5, 0.5]) {
    box(0.18, 0.18, 1.8, wood, sx, 0, 0, 0.03, cat);
    box(0.16, 1.1, 0.16, wood, sx, 0.15, -0.2, 0.03, cat);
  }
  for (const z of [-0.75, 0.75]) box(1.1, 0.16, 0.16, wood, 0, 0.05, z, 0.03, cat);
  for (const sx of [-0.62, 0.62]) for (const z of [-0.7, 0.7]) {
    const wh = new THREE.Mesh(own(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 10)), woodDark);
    wh.rotation.z = Math.PI / 2;
    K.put(wh, sx, 0.12, z, 0.02, cat);
  }
  const armG = new THREE.Group();
  armG.position.set(0, 1.2, -0.2);
  cat.add(armG);
  tilt(0.16, 0.16, 2.0, woodDark, 0, 0.55, 0.0, -1.05, 0, 0.03, armG);
  cyl(0.22, 0.16, 0.18, woodDark, 0, 1.35, -0.48, 10, 0.02, armG);
  ball(0.17, iron, 0, 1.55, -0.48, 0.02, armG);
  anims.push((t) => (armG.rotation.x = Math.sin(t * 0.9) * 0.08));
  // 포탄 더미
  for (const [x, y, z] of [
    [-1.6, 0.2, 0],
    [-1.25, 0.2, 0],
    [-1.42, 0.2, 0.3],
    [-1.42, 0.47, 0.12],
  ])
    ball(0.19, iron, -3.4 + x + 0.2, WH - 0.4 + y, zW - 1.0 + z, 0.02);
  // 석궁 포탑 (성벽 위 오른쪽)
  const bow = new THREE.Group();
  bow.position.set(3.4, WH - 0.4, zW - 1.2);
  K.G.add(bow);
  cyl(0.35, 0.45, 0.6, woodDark, 0, 0, 0, 10, 0.03, bow);
  box(0.3, 0.2, 1.7, wood, 0, 0.6, 0.15, 0.03, bow);
  const arc = new THREE.Mesh(own(new THREE.TorusGeometry(0.85, 0.06, 6, 16, Math.PI * 0.9)), woodDark);
  arc.rotation.set(Math.PI / 2, 0, Math.PI * 0.05 + Math.PI);
  K.put(arc, 0, 0.72, 0.75, 0.02, bow);
  box(0.06, 0.06, 1.6, mt(0xd9d4c8), 0, 0.78, 0.35, 0.01, bow);
  cone(0.08, 0.22, iron, 0, 0.78, 1.25, 6, 0, bow).rotation.x = Math.PI / 2;
  anims.push((t) => (bow.rotation.y = Math.sin(t * 0.5) * 0.35));
  // 앞마당: 과녁 허수아비 · 뾰족 울타리 · 통 · 상자 · 방패 · 창걸이
  const dx = 6.0,
    dz = zf - 1.1;
  cyl(0.07, 0.07, 1.6, woodDark, dx, 0.2, dz, 6, 0.02);
  box(1.2, 0.12, 0.12, woodDark, dx, 1.4, dz, 0.02);
  cyl(0.32, 0.36, 0.8, mt(0xd9b86a), dx, 0.75, dz, 10, 0.03);
  ball(0.26, mt(0xd9b86a), dx, 1.85, dz, 0.03);
  plane(0.62, 0.62, cut(tex(64, 64, (g) => {
    g.clearRect(0, 0, 64, 64);
    for (const [r, c] of [
      [31, "#ffffff"],
      [24, "#e0483a"],
      [17, "#ffffff"],
      [10, "#e0483a"],
    ] as [number, string][]) {
      g.fillStyle = c;
      g.beginPath();
      g.arc(32, 32, r, 0, Math.PI * 2);
      g.fill();
    }
  }), true), dx, 1.15, dz + 0.37);
  for (let i = 0; i < 6; i++) {
    const x = -7.6 + i * 0.42;
    cone(0.12, 0.9 + (i % 2) * 0.25, wood, x, 0.2, zf - 0.7, 6, 0.02);
  }
  box(2.6, 0.12, 0.08, woodDark, -6.55, 0.6, zf - 0.7, 0.02);
  cyl(0.38, 0.38, 0.85, wood, -4.7, 0.2, zW + 1.5, 12, 0.03);
  box(0.7, 0.7, 0.7, woodDark, -4.0, 0.2, zW + 1.9, 0.03);
  const smallShield = plane(0.65, 0.75, shieldM, -4.6, 0.65, zW + 2.0);
  smallShield.rotation.x = -0.25;
  for (let i = 0; i < 3; i++) {
    cyl(0.03, 0.03, 1.9, woodDark, 7.6 + i * 0.3, 0.2, zW + 2.0, 6, 0.01);
    cone(0.07, 0.24, iron, 7.6 + i * 0.3, 2.1, zW + 2.0, 6, 0.01);
  }
  box(1.2, 0.1, 0.1, woodDark, 7.9, 1.3, zW + 2.0, 0.01);
  return K.done();
}

// ───────────── 우리 집: 하늘색 지붕 2층 집 + 앞마당 ─────────────

export function codeHome(ctx: LotCtx, b: Building): Out {
  const K = kit(ctx, b);
  const { mt, glow, tm, cut, W, D, zf, box, tilt, cyl, ball, plane, prism, roof, win, bush, own, anims } = K;
  const HW = 10,
    HD = 7,
    HZ = -2.4; // 집 가운데 z (앞면 = HZ + HD/2 = 1.1)
  const HF = HZ + HD / 2;
  // 북쪽(그늘)을 보는 집이라 흰 벽이 칙칙하지 않게 살짝 밝힘
  const lift = { emissive: new THREE.Color(0x3a3833) };
  const sidingF = tm(sidingTex("#f6f3ec", "#dcd5c6", HW / 1.5, 2.8), lift),
    sidingS = tm(sidingTex("#f6f3ec", "#dcd5c6", HD / 1.5, 2.8), lift),
    white = mt(0xffffff),
    sky = tm(tileTex("#6fa8e8", "#629ad9", "#3f6fb0", 4, 3)),
    skyDark = mt(0x4f86c8),
    stone = tm(stoneTex("#9a9488", ["#bdb6a8", "#c9c2b4", "#b0a99a"], 4, 1)),
    leaf = mt(0x6fbf5a),
    leafDark = mt(0x55a04a),
    pinkF = mt(0xf7a8c4),
    whiteF = mt(0xfffaf2),
    wood = mt(0xa8794a),
    shutter = mt(0x5fa07a);
  // 디딤돌
  const stepM = mt(0xd8d2c4);
  for (let i = 0; i < 5; i++) {
    const z = zf - 0.6 - i * 0.95,
      x = Math.sin(i * 0.9) * 0.35 - (i > 2 ? (i - 2) * 0.45 : 0);
    cyl(0.42, 0.42, 0.08, stepM, x, 0.06, z, 10, 0.02);
  }
  // ── 집 ── (계약해야 섬 — 그 전엔 같은 자리에 「분양 중」 터, setHomeBuilt)
  const n0 = K.G.children.length;
  const F1 = 3.0,
    TOP = 5.8;
  box(HW + 0.2, 0.55, HD + 0.2, stone, 0, 0, HZ, 0.05);
  box(HW, TOP - 0.55, HD, sidingS, 0, 0.55, HZ, 0.06);
  box(HW + 0.02, TOP - 0.55, HD - 0.4, sidingF, 0, 0.55, HZ, 0);
  box(HW + 0.24, 0.2, HD + 0.24, white, 0, F1, HZ, 0.04);
  box(HW + 0.3, 0.22, HD + 0.3, white, 0, TOP - 0.15, HZ, 0.04);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.24, TOP - 0.55, 0.24, white, sx * (HW / 2), 0.55, HZ + sz * (HD / 2), 0.03);
  const body = { w: HW, d: HD, cz: HZ };
  const warm = cut(winTex({ frame: "#ffffff", cols: 2, rows: 2, curtain: "#fff6ea" }));
  const wide = cut(winTex({ frame: "#ffffff", cols: 3, rows: 2, curtain: "#fff6ea" }, 144, 104));
  // 1층: 큰 창 (오른쪽) · 문 (현관 안쪽)
  win(0, 2.6, 1.85, 2.6, 1.7, wide, white, body);
  const doorT = tex(80, 150, (g, w, h) => {
    g.fillStyle = "#8fd3b6";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#6fb89a";
    g.lineWidth = 5;
    g.strokeRect(12, h * 0.55, w - 24, h * 0.36);
    const gr = g.createLinearGradient(0, 12, 0, h * 0.45);
    gr.addColorStop(0, "#ffe6a8");
    gr.addColorStop(1, "#f0a54e");
    g.fillStyle = gr;
    g.fillRect(14, 14, w - 28, h * 0.34);
    g.fillStyle = "#ffffff";
    g.fillRect(w / 2 - 2, 14, 4, h * 0.34);
    g.fillRect(14, 14 + h * 0.17 - 2, w - 28, 4);
    g.fillStyle = "#e6c25a";
    g.beginPath();
    g.arc(w - 14, h * 0.55, 5, 0, Math.PI * 2);
    g.fill();
  });
  box(1.45, 2.45, 0.18, white, -1.5, 0.55, HF + 0.02, 0.03);
  plane(1.1, 2.2, cut(doorT, true), -1.5, 0.55 + 1.1, HF + 0.12);
  const lampM = glow(0xffd58a),
    iron = mt(0x3a3440);
  for (const sx of [-1, 1]) {
    box(0.26, 0.38, 0.26, iron, -1.5 + sx * 1.0, 2.05, HF + 0.2, 0.02);
    box(0.18, 0.28, 0.28, lampM, -1.5 + sx * 1.0, 2.1, HF + 0.2, 0);
  }
  // 현관 (왼쪽): 나무 바닥 · 흰 기둥 · 하늘색 덮개 지붕 · 그네 의자 · 계단
  const PX0 = -HW / 2 + 0.1,
    PX1 = -0.5,
    PZ = HF + 1.0;
  const pw = PX1 - PX0,
    pcx = (PX0 + PX1) / 2;
  box(pw, 0.4, 2.0, wood, pcx, 0.1, PZ, 0.04);
  box(1.4, 0.2, 0.6, wood, -1.5, 0.05, PZ + 1.2, 0.03);
  for (const x of [PX0 + 0.15, PX1 - 0.15]) box(0.2, 2.6, 0.2, white, x, 0.5, PZ + 0.85, 0.03);
  box(pw, 0.12, 0.1, white, pcx, 1.25, PZ + 0.85, 0.02);
  for (let i = 0; i < 9; i++) {
    const x = PX0 + 0.35 + i * 0.32;
    if (x > -2.3) break;
    box(0.06, 0.75, 0.06, white, x, 0.5, PZ + 0.85, 0.012);
  }
  tilt(pw + 0.4, 0.16, 2.4, sky, pcx, 3.25, PZ + 0.1, 0.32, 0, 0.04);
  // 그네 의자 (현관 왼쪽 · 살랑)
  const sw = new THREE.Group();
  sw.position.set(PX0 + 1.4, 2.95, PZ + 0.1);
  K.G.add(sw);
  for (const dx of [-0.7, 0.7]) cyl(0.015, 0.015, 1.6, iron, dx, -1.6, 0, 4, 0, sw);
  box(1.6, 0.1, 0.55, wood, 0, -1.75, 0, 0.02, sw);
  box(1.6, 0.55, 0.08, wood, 0, -1.7, -0.25, 0.02, sw);
  const cushion = tm(tex(32, 32, (g) => {
    g.fillStyle = "#cfe8ff";
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = "#7fb2e8";
    for (let i = 0; i < 32; i += 8) {
      g.fillRect(i, 0, 4, 32);
      g.fillRect(0, i, 32, 4);
    }
  }));
  box(0.45, 0.4, 0.14, cushion, -0.4, -1.65, -0.13, 0.02, sw);
  box(0.42, 0.36, 0.14, mt(0xfff6ea), 0.35, -1.65, -0.13, 0.02, sw);
  anims.push((t) => (sw.rotation.x = Math.sin(t * 1.1) * 0.06));
  // 2층: 왼쪽 앞 박공 (둥근 다락창 · 초록 덧문 창 · 꽃상자) · 오른쪽 발코니
  const shut = (x: number, y: number, h: number) => {
    for (const sx of [-1, 1]) box(0.36, h, 0.08, shutter, x + sx * 0.98, y - h / 2, HF + 0.06, 0.02);
  };
  win(0, -2.6, F1 + 1.4, 1.5, 1.4, warm, white, body);
  shut(-2.6, F1 + 1.4, 1.45);
  box(1.7, 0.32, 0.38, mt(0xd9825a), -2.6, F1 + 0.42, HF + 0.22, 0.02);
  for (let i = 0; i < 4; i++) bush(-3.25 + i * 0.44, F1 + 0.7, HF + 0.24, 0.42, leaf, i % 2 ? pinkF : whiteF);
  win(0, 2.6, F1 + 1.35, 1.3, 1.9, warm, white, body);
  box(2.6, 0.16, 1.0, white, 2.6, F1 + 0.1, HF + 0.5, 0.03);
  box(2.6, 0.1, 0.1, white, 2.6, F1 + 1.05, HF + 0.95, 0.02);
  for (const sx of [-1, 1]) box(0.1, 0.1, 0.9, white, 2.6 + sx * 1.25, F1 + 1.05, HF + 0.5, 0.02);
  for (let i = 0; i <= 5; i++) {
    const x = 1.4 + i * 0.48;
    box(0.08, 0.85, 0.08, white, x, F1 + 0.25, HF + 0.95, 0.012);
  }
  // X 무늬 난간 (발코니)
  for (const sx of [-1, 1]) tilt(1.1, 0.07, 0.07, white, 2.6 + sx * 0.6, F1 + 0.65, HF + 0.95, 0, sx * 0.62, 0.012);
  for (let i = 0; i < 4; i++) ball(0.2, leaf, 1.6 + i * 0.65, F1 + 1.12, HF + 0.95, 0.02);
  // 옆 · 뒤 창
  for (const side of [1, 3]) {
    win(side, -1.6, 1.85, 1.2, 1.4, warm, white, body);
    win(side, 1.6, F1 + 1.4, 1.2, 1.4, warm, white, body);
  }
  for (const u of [-2.6, 2.6]) win(2, u, F1 + 1.4, 1.2, 1.4, warm, white, body);
  // 지붕: 큰 박공 (용마루 가로) + 앞 작은 박공 (왼쪽) + 둥근 다락창 + 돌 굴뚝
  prism(HD, 2.5, HW, sidingS, 0, TOP, HZ, 0.05, K.G, true);
  roof(HD, HW, 2.5, sky, 0, TOP, HZ, { over: 0.5, cap: skyDark });
  const gx = -2.6,
    gs = 4.0,
    gl = 4.3;
  box(gs, 1.0, 0.6, sidingF, gx, TOP - 0.8, HF - 0.3, 0);
  prism(gs, 2.0, gl, sidingF, gx, TOP + 0.05, HF - gl / 2 + 0.1, 0.05);
  roof(gs, gl, 2.0, sky, gx, TOP + 0.05, HF - gl / 2 + 0.1, { alongZ: true, over: 0.4, cap: skyDark });
  plane(0.95, 0.95, cut(tex(96, 96, (g, w) => {
    g.clearRect(0, 0, w, w);
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(48, 48, 47, 0, Math.PI * 2);
    g.fill();
    const gr = g.createRadialGradient(48, 52, 4, 48, 48, 38);
    gr.addColorStop(0, "#fff0c4");
    gr.addColorStop(1, "#f0a54e");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(48, 48, 37, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffffff";
    g.fillRect(45, 10, 6, 76);
    g.fillRect(10, 45, 76, 6);
  })), gx, TOP + 0.75, HF + 0.13);
  box(1.0, 3.3, 1.0, stone, 3.4, TOP + 0.3, HZ - 1.4, 0.05);
  box(1.15, 0.2, 1.15, mt(0xb4634a), 3.4, TOP + 3.55, HZ - 1.4, 0.03);
  const houseG = new THREE.Group();
  houseG.name = "homeHouse";
  houseG.userData.bakeRoot = true;
  for (const c of K.G.children.slice(n0)) houseG.add(c);
  K.G.add(houseG);
  houseG.visible = false;
  // 분양 중 터: 기초 돌판 · 말뚝과 줄 · 안내판 · 벽돌 더미
  const lotG = new THREE.Group();
  lotG.name = "homeLot";
  lotG.userData.bakeRoot = true;
  K.G.add(lotG);
  box(HW + 0.2, 0.3, HD + 0.2, stone, 0, 0, HZ, 0.05, lotG);
  box(HW - 0.6, 0.04, HD - 0.6, mt(0xd8c9a8), 0, 0.3, HZ, 0.0, lotG);
  const tape = mt(0xffc93c);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    box(0.12, 1.0, 0.12, wood, sx * (HW / 2 + 0.4), 0, HZ + sz * (HD / 2 + 0.4), 0.02, lotG);
    box(0.16, 0.12, 0.16, mt(0xe0483a), sx * (HW / 2 + 0.4), 1.0, HZ + sz * (HD / 2 + 0.4), 0.01, lotG);
  }
  box(HW + 0.8, 0.06, 0.04, tape, 0, 0.8, HZ + HD / 2 + 0.4, 0.0, lotG);
  box(HW + 0.8, 0.06, 0.04, tape, 0, 0.8, HZ - HD / 2 - 0.4, 0.0, lotG);
  box(0.04, 0.06, HD + 0.8, tape, -HW / 2 - 0.4, 0.8, HZ, 0.0, lotG);
  box(0.04, 0.06, HD + 0.8, tape, HW / 2 + 0.4, 0.8, HZ, 0.0, lotG);
  const brick = mt(0xc8714a);
  for (let i = 0; i < 9; i++) box(0.5, 0.22, 0.26, brick, 2.6 + (i % 3) * 0.54, 0.3 + Math.floor(i / 3) * 0.23, HZ + 1.2, 0.015, lotG);
  for (let i = 0; i < 4; i++) box(2.4, 0.12, 0.22, wood, -2.6, 0.3 + i * 0.13, HZ + 0.6 + (i % 2) * 0.05, 0.012, lotG);
  const board = new THREE.Group();
  board.position.set(0, 0.3, HZ + HD / 2 - 0.6);
  lotG.add(board);
  for (const dx of [-0.9, 0.9]) box(0.12, 2.0, 0.12, wood, dx, 0, 0, 0.02, board);
  box(2.4, 1.3, 0.1, white, 0, 1.0, 0, 0.03, board);
  plane(2.2, 1.1, cut(tex(320, 160, (g, w, h) => {
    g.fillStyle = "#fffaf0";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#3fae86";
    g.fillRect(0, 0, w, 54);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#ffffff";
    g.font = '400 40px "Black Han Sans", sans-serif';
    g.fillText("분양 중", w / 2, 29);
    g.fillStyle = "#4a3a2a";
    g.font = '800 24px "Nanum Gothic", sans-serif';
    g.fillText("내 집을 갖고 싶다면", w / 2, 88);
    g.fillText("부동산 민트에게!", w / 2, 124);
  }), true), 0, 1.65, 0.06, 0, board);
  // ── 흰 울타리 (뾰족 말뚝 · 한 덩어리로 합쳐 그리기) ──
  const posts: THREE.BufferGeometry[] = [],
    inks: THREE.BufferGeometry[] = [];
  const picket = (x: number, z: number, along: "x" | "z") => {
    const pw2 = along === "x" ? 0.14 : 0.06,
      pd2 = along === "x" ? 0.06 : 0.14;
    const g = new THREE.BoxGeometry(pw2, 0.95, pd2);
    g.translate(x, 0.48, z);
    posts.push(g);
    const t = new THREE.ConeGeometry(0.1, 0.18, 4);
    t.rotateY(Math.PI / 4);
    t.translate(x, 1.04, z);
    posts.push(t);
    const k = new THREE.BoxGeometry(pw2 + 0.05, 1.0, pd2 + 0.05);
    k.translate(x, 0.48, z);
    inks.push(k);
  };
  const GATE = 1.15;
  for (let x = -W / 2 + 0.1; x <= W / 2 - 0.05; x += 0.34) {
    if (Math.abs(x) > GATE) picket(x, zf - 0.1, "x");
    picket(x, -zf + 0.1, "x");
  }
  for (let z = -zf + 0.1; z <= zf - 0.05; z += 0.34) {
    picket(-W / 2 + 0.1, z, "z");
    picket(W / 2 - 0.1, z, "z");
  }
  for (const y of [0.35, 0.75]) {
    for (const [x0, x1] of [
      [-W / 2 + 0.1, -GATE],
      [GATE, W / 2 - 0.1],
    ]) {
      const g = new THREE.BoxGeometry(x1 - x0, 0.08, 0.05);
      g.translate((x0 + x1) / 2, y, zf - 0.16);
      posts.push(g);
    }
    const bk = new THREE.BoxGeometry(W - 0.2, 0.08, 0.05);
    bk.translate(0, y, -zf + 0.16);
    posts.push(bk);
    for (const sx of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.05, 0.08, D - 0.2);
      g.translate(sx * (W / 2 - 0.16), y, 0);
      posts.push(g);
    }
  }
  const fenceG = own(mergeGeometries(posts.map((g) => g.toNonIndexed()))!);
  posts.forEach((g) => g.dispose());
  const fence = new THREE.Mesh(fenceG, white);
  fence.castShadow = true;
  K.G.add(fence);
  const fenceInk = new THREE.Mesh(own(mergeGeometries(inks)!), K.ink);
  inks.forEach((g) => g.dispose());
  K.G.add(fenceInk);
  // 대문 (열린 두 짝 · 기둥 위 등)
  for (const sx of [-1, 1]) {
    box(0.26, 1.35, 0.26, white, sx * GATE, 0, zf - 0.1, 0.03);
    box(0.3, 0.3, 0.3, iron, sx * GATE, 1.35, zf - 0.1, 0.02);
    box(0.2, 0.22, 0.32, lampM, sx * GATE, 1.38, zf - 0.1, 0);
    const lf = new THREE.Group();
    lf.position.set(sx * (GATE - 0.12), 0, zf - 0.1);
    lf.rotation.y = sx * 1.15;
    K.G.add(lf);
    for (let i = 0; i < 3; i++) box(0.12, 0.95, 0.05, white, -sx * (0.18 + i * 0.3), 0.08, 0, 0.012, lf);
    box(0.95, 0.08, 0.05, white, -sx * 0.48, 0.38, 0, 0.012, lf);
    box(0.95, 0.08, 0.05, white, -sx * 0.48, 0.78, 0, 0.012, lf);
  }
  // 빨간 우체통 · 빈 팻말
  cyl(0.05, 0.05, 1.0, wood, 2.0, 0, zf - 0.55, 6, 0.02);
  box(0.36, 0.34, 0.55, mt(0xe0483a), 2.0, 1.0, zf - 0.55, 0.03);
  box(0.04, 0.28, 0.06, mt(0xffd34d), 2.2, 1.2, zf - 0.7, 0.01);
  for (const dx of [-0.75, 0.75]) box(0.12, 2.1, 0.12, wood, -3.3 + dx, 0, zf - 0.6, 0.02);
  box(1.9, 0.08, 0.1, wood, -3.3, 2.08, zf - 0.6, 0.02);
  const sign = new THREE.Group();
  sign.position.set(-3.3, 2.05, zf - 0.6);
  K.G.add(sign);
  const signOn = plane(1.4, 0.7, cut(textTex("우리 집", { w: 200, h: 100, bg: "#e9d3a8", fg: "#6b4429", border: "#a8794a", font: '400 50px "Black Han Sans", sans-serif', r: 12 }), true), 0, -0.5, 0.04, 0, sign);
  signOn.name = "homeSignOn";
  signOn.visible = false;
  const signOff = plane(1.4, 0.7, cut(textTex("분양 중", { w: 200, h: 100, bg: "#d8f0e4", fg: "#2f7a5e", border: "#3fae86", font: '400 50px "Black Han Sans", sans-serif', r: 12 }), true), 0, -0.5, 0.04, 0, sign);
  signOff.name = "homeSignOff";
  anims.push((t) => (sign.rotation.x = Math.sin(t * 1.4) * 0.05));
  // 개집 (빨간 지붕) · 밥그릇
  const DX = 5.6,
    DZ = 2.3;
  box(1.3, 1.0, 1.1, mt(0xf3e3c4), DX, 0.1, DZ, 0.04);
  prism(1.3, 0.55, 1.1, mt(0xf3e3c4), DX, 1.1, DZ, 0.0, K.G, true);
  roof(1.1, 1.3, 0.55, mt(0xe0584a), DX, 1.1, DZ, { over: 0.12, thick: 0.12, alongZ: true });
  plane(0.55, 0.65, cut(tex(48, 64, (g) => {
    g.clearRect(0, 0, 48, 64);
    g.fillStyle = "#3a2a22";
    g.beginPath();
    g.moveTo(0, 64);
    g.lineTo(0, 24);
    g.arc(24, 24, 24, Math.PI, 0);
    g.lineTo(48, 64);
    g.fill();
  })), DX - 0.66, 0.5, DZ, -Math.PI / 2);
  cyl(0.18, 0.14, 0.1, mt(0x6fa8e8), DX - 1.2, 0.1, DZ + 0.4, 10, 0.02);
  // 텃밭 상자 (토마토 · 상추)
  box(2.4, 0.4, 1.1, wood, 6.2, 0.1, -4.7, 0.03);
  box(2.3, 0.05, 1.0, mt(0x6b4a33), 6.2, 0.5, -4.7, 0);
  for (let i = 0; i < 3; i++) {
    const x = 5.4 + i * 0.8;
    cyl(0.02, 0.02, 0.9, wood, x, 0.5, -4.9, 4, 0.01);
    ball(0.26, leafDark, x, 0.95, -4.9, 0.02);
    for (const [ddx, ddy] of [
      [-0.12, 0.85],
      [0.14, 1.05],
      [0.04, 0.7],
    ])
      ball(0.08, mt(0xe0483a), x + ddx, ddy, -4.72, 0.01, K.G, 0);
    ball(0.2, mt(0x9fd86a), x + 0.4, 0.62, -4.45, 0.02);
  }
  // 빨랫줄 · 수건 (펄럭)
  for (const z of [-0.8, -5.0]) cyl(0.05, 0.05, 2.0, wood, 8.2, 0.1, z, 6, 0.02);
  const line = new THREE.Mesh(own(new THREE.CylinderGeometry(0.012, 0.012, 4.2, 4)), iron);
  line.rotation.x = Math.PI / 2;
  line.position.set(8.2, 1.95, -2.9);
  K.G.add(line);
  const towel = new THREE.Group();
  towel.position.set(8.2, 1.95, -2.5);
  K.G.add(towel);
  plane(0.9, 0.62, cut(tex(64, 48, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 64, 48);
    g.fillStyle = "#7fb2e8";
    g.fillRect(0, 34, 64, 6);
    g.fillRect(0, 8, 64, 3);
  }), true), 0, -0.33, 0, Math.PI / 2, towel);
  plane(0.5, 0.5, cut(tex(32, 32, (g) => {
    g.fillStyle = "#f7a8c4";
    g.fillRect(0, 0, 32, 32);
  }), true), 0, -0.27, -1.1, Math.PI / 2, towel);
  anims.push((t) => (towel.rotation.z = Math.sin(t * 1.7) * 0.12));
  // 울타리 안 덤불 · 꽃
  for (const [x, z, s, f] of [
    [-W / 2 + 0.8, zf - 0.8, 1.1, pinkF],
    [-W / 2 + 2.0, zf - 0.75, 0.9, whiteF],
    [W / 2 - 0.9, zf - 0.85, 1.1, whiteF],
    [W / 2 - 2.2, zf - 0.8, 0.9, pinkF],
    [-W / 2 + 0.9, HZ - 1.0, 1.3, null],
    [-W / 2 + 0.9, HZ + 2.0, 1.0, pinkF],
    [PX1 + 0.6, HF + 0.5, 0.8, pinkF],
    [4.6, HF + 0.6, 0.9, whiteF],
    [-W / 2 + 0.9, -zf + 0.9, 1.4, null],
  ] as [number, number, number, THREE.Material | null][])
    bush(x, 0.1, z, s, leaf, f ?? undefined);
  return K.done();
}

/** 우리 집 건물: 계약했으면 집, 아니면 분양 중 터 (사람마다 다르게 보임) */
export function setHomeBuilt(group: THREE.Object3D, on: boolean) {
  for (const [n, v] of [
    ["homeHouse", on],
    ["homeSignOn", on],
    ["homeLot", !on],
    ["homeSignOff", !on],
  ] as [string, boolean][]) {
    const o = group.getObjectByName(n);
    if (o) o.visible = v;
  }
}

// ───────────── 언덕 위 학교: 시계탑 · 벚꽃 ─────────────

export function codeSchool(ctx: LotCtx, b: Building): Out {
  const K = kit(ctx, b);
  const { mt, glow, tm, cut, W, D, zf, box, tilt, cyl, ball, plane, prism, roof, bush, bike, petals, clock, flag, footing, own } = K;
  const cream = mt(0xf4e8d0),
    terra = mt(0xc8644a),
    terraDark = mt(0xa84e3a),
    grey = mt(0xd9d6cf),
    green = mt(0x4e8a6a),
    pinkA = mt(0xf6b6cf),
    pinkB = mt(0xfbd0de),
    bark = mt(0x7a5238),
    leaf = mt(0x6fbf5a),
    pave = tm(stoneTex("#b8b0a2", ["#ddd6c8", "#e6e0d4", "#d2cbbd"], 8, 3));
  footing(mt(0xb0a898), W - 0.4, D - 0.4, 2.0);
  box(W, 0.12, D, pave, 0, 0, 0, 0);
  const BD = 8.4,
    BZ = -zf + BD / 2 + 0.4; // 본관 가운데 z
  const BF = BZ + BD / 2; // 본관 앞면
  const FL = 3.1,
    TOP = FL * 3;
  // 창 줄 그림 (교실 창 여러 칸)
  const rowT = (n: number) =>
    tex(64 * n, 64, (g, w) => {
      g.clearRect(0, 0, w, 64);
      for (let i = 0; i < n; i++) {
        const x = i * 64;
        g.fillStyle = "#f4e8d0";
        g.fillRect(x, 0, 64, 64);
        const gr = g.createLinearGradient(0, 8, 0, 56);
        gr.addColorStop(0, "#d8ecff");
        gr.addColorStop(1, "#9cc4e8");
        g.fillStyle = gr;
        g.fillRect(x + 6, 8, 52, 46);
        g.fillStyle = "#fff6ea";
        g.fillRect(x + 6, 8, 12, 46);
        g.fillRect(x + 46, 8, 12, 46);
        g.fillStyle = "rgba(255,255,255,0.5)";
        g.fillRect(x + 22, 12, 4, 20);
        g.fillStyle = "#c9c4ba";
        g.fillRect(x + 31, 8, 3, 46);
        g.fillRect(x + 6, 30, 52, 3);
        g.strokeStyle = "#8a8680";
        g.lineWidth = 2;
        g.strokeRect(x + 6, 8, 52, 46);
        g.fillStyle = "#c8644a";
        g.fillRect(x + 4, 54, 56, 5);
      }
    });
  const wing = (sx: number) => {
    const ww = 9.0,
      cx = sx * (2.6 + ww / 2);
    box(ww, TOP, BD, cream, cx, 0, BZ, 0.07);
    for (let f = 1; f <= 3; f++) box(ww + 0.2, 0.22, BD + 0.2, terra, cx, f * FL - 0.22, BZ, 0.04);
    box(ww + 0.3, 0.5, BD + 0.3, terraDark, cx, TOP - 0.1, BZ, 0.05);
    const rm = cut(rowT(5));
    for (let f = 0; f < 3; f++) {
      plane(ww - 0.6, 1.75, rm, cx, f * FL + 1.55, BF + 0.03);
      plane(ww - 0.6, 1.75, rm, cx, f * FL + 1.55, BZ - BD / 2 - 0.03, Math.PI);
    }
    const sm = cut(rowT(3));
    for (let f = 0; f < 3; f++) plane(BD - 1.6, 1.75, sm, cx + sx * (ww / 2 + 0.03), f * FL + 1.55, BZ, (sx * Math.PI) / 2);
    // 옥상 초록 펜스 · 실외기
    const fz = BF - 0.35;
    box(ww - 0.4, 0.06, 0.06, green, cx, TOP + 1.1, fz, 0.02);
    for (let i = 0; i <= 10; i++) box(0.06, 0.75, 0.06, green, cx - (ww - 0.4) / 2 + (i * (ww - 0.4)) / 10, TOP + 0.4, fz, 0.012);
    box(1.1, 0.75, 0.75, grey, cx + sx * 2.2, TOP + 0.4, BZ - 1.5, 0.04);
    box(1.1, 0.75, 0.75, grey, cx + sx * 0.6, TOP + 0.4, BZ - 1.7, 0.04);
  };
  wing(-1);
  wing(1);
  // 물탱크 (왼쪽 옥상) · 계단실 (오른쪽)
  cyl(0.9, 0.9, 1.4, mt(0x8fb6d8), -9.0, TOP + 0.4, BZ - 1.0, 14, 0.04);
  box(2.0, 2.0, 1.8, cream, 9.0, TOP + 0.4, BZ - 0.8, 0.05);
  box(2.2, 0.2, 2.0, terraDark, 9.0, TOP + 2.4, BZ - 0.8, 0.03);
  // ── 가운데 시계탑 ──
  const TW = 5.2,
    TD = BD + 1.0,
    TZ = BZ + 0.5,
    TH = TOP + 3.4;
  box(TW, TH, TD, cream, 0, 0, TZ, 0.07);
  box(TW + 0.3, 0.4, TD + 0.3, terraDark, 0, TH - 0.1, TZ, 0.05);
  for (const f of [1, 2, 3]) box(TW + 0.2, 0.22, TD + 0.2, terra, 0, f * FL - 0.22, TZ, 0.04);
  prism(TW + 0.2, 2.0, TD, cream, 0, TH + 0.25, TZ, 0.05);
  roof(TW + 0.2, TD, 2.0, tm(tileTex("#d0644e", "#c2593f", "#8a3a2a", 3, 4)), 0, TH + 0.25, TZ, { alongZ: true, over: 0.45, cap: terraDark });
  const TF = TZ + TD / 2;
  clock(1.25, "#c8644a", 0, TOP + 1.65, TF + 0.04);
  // 교기: 남색 바탕 · 금색 테 · 펼친 책 + 별 (학교 표시)
  flag(0, TH + 2.35, TZ, 2.2, grey, K.mine(new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: ctx.grad, side: THREE.DoubleSide, map: own(tex(64, 40, (g) => {
    g.fillStyle = "#2f4f9e";
    g.fillRect(0, 0, 64, 40);
    g.strokeStyle = "#f2c14e";
    g.lineWidth = 2.5;
    g.strokeRect(2.5, 2.5, 59, 35);
    // 펼친 책
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.moveTo(32, 30);
    g.quadraticCurveTo(24, 25, 16, 27);
    g.lineTo(16, 17);
    g.quadraticCurveTo(24, 15, 32, 20);
    g.quadraticCurveTo(40, 15, 48, 17);
    g.lineTo(48, 27);
    g.quadraticCurveTo(40, 25, 32, 30);
    g.fill();
    g.strokeStyle = "#2f4f9e";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(32, 20);
    g.lineTo(32, 30);
    g.stroke();
    // 별
    g.fillStyle = "#f2c14e";
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5,
        r = i % 2 ? 2.2 : 5;
      g.lineTo(32 + Math.cos(a) * r, 11 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  })) })), 1.3, 0.8);
  // 탑 2 · 3층 긴 창
  const tall = cut(winTex({ frame: "#ffffff", cols: 2, rows: 3, curtain: "#fff6ea", glass: ["#d8ecff", "#9cc4e8"] }, 96, 140));
  for (const f of [1, 2]) plane(2.2, 2.0, tall, 0, f * FL + 1.45, TF + 0.03);
  // 현관: 유리 쌍문 (신발장 보임) · 테라코타 차양 · 기둥 · 계단
  const doorT = tex(160, 128, (g, w, h) => {
    g.fillStyle = "#8a8680";
    g.fillRect(0, 0, w, h);
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, "#ffefc8");
    gr.addColorStop(1, "#f2c58a");
    g.fillStyle = gr;
    g.fillRect(6, 6, w - 12, h - 6);
    g.fillStyle = "#b98a5a";
    for (let x = 14; x < w - 14; x += 22) for (let y = 30; y < h - 10; y += 18) g.fillRect(x, y, 18, 14);
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(6, 6, w - 12, 18);
    g.fillStyle = "#8a8680";
    g.fillRect(w / 2 - 3, 0, 6, h);
    g.fillRect(w / 4 - 2, 0, 4, h);
    g.fillRect((3 * w) / 4 - 2, 0, 4, h);
  });
  plane(3.4, 2.6, cut(doorT, true), 0, 1.3 + 0.12, TF + 0.03);
  box(6.0, 0.25, 2.6, terra, 0, 3.0, TF + 1.25, 0.05);
  for (const sx of [-1, 1]) box(0.25, 3.0, 0.25, grey, sx * 2.6, 0, TF + 2.35, 0.03);
  for (let i = 0; i < 3; i++) box(6.4 - i * 0.4, 0.14, 2.6 - i * 0.7, grey, 0, 0.12 + i * 0.14, TF + 1.4 - i * 0.35, 0.03);
  // 벚꽃 나무 둘 (+ 떨어지는 꽃잎)
  for (const sx of [-1, 1]) {
    const x = sx * 10.0,
      z = BF + 3.4;
    cyl(0.28, 0.4, 2.6, bark, x, 0.1, z, 8, 0.04);
    tilt(0.18, 1.4, 0.18, bark, x + sx * 0.4, 2.6, z, 0, -sx * 0.7, 0.03);
    for (const [dx, dy, dz, r, m] of [
      [0, 3.6, 0, 1.7, pinkA],
      [-1.2, 3.1, 0.3, 1.2, pinkB],
      [1.25, 3.2, -0.2, 1.25, pinkA],
      [0.3, 4.4, -0.3, 1.2, pinkB],
      [-0.4, 3.3, 1.0, 1.0, pinkA],
      [0.7, 3.0, 1.0, 0.9, pinkB],
    ] as [number, number, number, number, THREE.Material][])
      ball(r, m, x + dx, dy, z + dz, 0.05);
  }
  petals(18, 0xffc2d6, -W / 2, W / 2, BF, zf + 1.5, 5.5);
  // 화단 (본관 앞 · 낮은 벽돌 턱)
  const brickM = tm(brickTex("#c8b8a0", ["#c8644a", "#b85a42", "#d0705a"], 4, 0.6));
  for (const sx of [-1, 1]) {
    const cx = sx * 7.1;
    box(7.6, 0.45, 1.1, brickM, cx, 0.1, BF + 0.75, 0.03);
    for (let i = 0; i < 7; i++) bush(cx - 3.2 + i * 1.05, 0.5, BF + 0.75, 0.6, leaf, i % 2 ? pinkA : mt(0xfff6ea));
  }
  // 자전거 거치대 · 자전거 둘 · 벤치 · 가로등
  const steel = mt(0xc9ccd4);
  for (let i = 0; i < 3; i++) {
    const tor = new THREE.Mesh(own(new THREE.TorusGeometry(0.4, 0.04, 6, 12, Math.PI)), steel);
    K.put(tor, 5.6 + i * 0.8, 0.1, zf - 1.6, 0.02, K.G);
  }
  bike(5.7, zf - 1.3, Math.PI / 2 + 0.1, mt(0x4f86c8), false);
  bike(6.6, zf - 1.3, Math.PI / 2 - 0.08, mt(0xe0806c), true, pinkA);
  const wood = mt(0xa8794a),
    iron = mt(0x3a3440);
  box(2.0, 0.1, 0.5, wood, -6.0, 0.55, zf - 1.4, 0.02);
  box(2.0, 0.45, 0.08, wood, -6.0, 0.7, zf - 1.62, 0.02);
  for (const dx of [-0.85, 0.85]) box(0.08, 0.55, 0.45, iron, -6.0 + dx, 0.1, zf - 1.4, 0.015);
  for (const sx of [-1, 1]) {
    cyl(0.07, 0.09, 3.2, iron, sx * 3.9, 0.1, zf - 0.8, 8, 0.02);
    ball(0.26, glow(0xfff0c0), sx * 3.9, 3.5, zf - 0.8, 0.02);
  }
  return K.done();
}

// ───────────── 마을 역: 시골 간이역 · 긴 승강장 지붕 ─────────────

export function codeStation(ctx: LotCtx, b: Building): Out {
  const K = kit(ctx, b);
  const { mt, glow, tm, cut, W, zf, box, tilt, cyl, ball, plane, prism, roof, win, bush, pot, clock, own, anims } = K;
  const ironG = mt(0x3f6b4e),
    ironGD = mt(0x2f5240),
    wood = mt(0xa8794a),
    woodDark = mt(0x6b4429),
    red = tm(tileTex("#b8583e", "#a94f38", "#7a3424", 8, 2)),
    redDark = mt(0x8a3e2a),
    cream = mt(0xf4e6cc),
    leaf = mt(0x6fbf5a),
    pinkF = mt(0xf7a8c4),
    yellow = mt(0xf2c94c),
    stone = tm(stoneTex("#8f877a", ["#bfb6a6", "#c9c0b0", "#b3aa99"], W / 1.6, 1));
  // 반목조 벽 (크림 + 갈색 기둥 · 가새)
  const timberT = (rx: number) =>
    tex(
      128,
      128,
      (g, w, h) => {
        g.fillStyle = "#f4e6cc";
        g.fillRect(0, 0, w, h);
        g.fillStyle = "#7a4a35";
        g.fillRect(0, 0, 10, h);
        g.fillRect(0, 0, w, 10);
        g.fillRect(0, h - 10, w, 10);
        g.fillRect(0, h * 0.5 - 5, w, 10);
        g.lineWidth = 8;
        g.strokeStyle = "#7a4a35";
        g.beginPath();
        g.moveTo(10, h * 0.5);
        g.lineTo(w * 0.5, 10);
        g.stroke();
      },
      rx,
      1
    );
  // 승강장 (철길 쪽 = 뒤 −z): 돌 받침 · 노란 줄 · 흰 가장자리
  const PZ0 = -zf,
    PZ1 = 1.4,
    PH = 0.5;
  box(W, PH, PZ1 - PZ0, stone, 0, 0, (PZ0 + PZ1) / 2, 0.05);
  box(W, 0.02, 0.28, yellow, 0, PH, PZ0 + 0.55, 0);
  box(W + 0.05, 0.06, 0.3, mt(0xf2efe6), 0, PH - 0.03, PZ0 + 0.15, 0.02);
  // 마을 쪽 바닥 (앞 −) 보도블록
  box(W, 0.08, zf - PZ1, tm(stoneTex("#b8b0a2", ["#ddd6c8", "#e6e0d4", "#d2cbbd"], W / 2.5, 1.5)), 0, 0, (zf + PZ1) / 2, 0);
  // ── 역사 (가운데) ──
  const HW = 12,
    HD = 6.4,
    HZ = 0.9,
    HF = HZ + HD / 2,
    WH = 3.9;
  const timber = tm(timberT(HW / 3.2)),
    timberS = tm(timberT(HD / 3.2));
  box(HW + 0.3, 0.6, HD + 0.3, stone, 0, 0, HZ, 0.05);
  box(HW, WH - 0.6, HD, timberS, 0, 0.6, HZ, 0.06);
  box(HW + 0.02, WH - 0.6, HD - 0.4, timber, 0, 0.6, HZ, 0);
  box(HW + 0.3, 0.2, HD + 0.3, woodDark, 0, WH - 0.1, HZ, 0.04);
  const body = { w: HW, d: HD, cz: HZ };
  const warm = cut(winTex({ frame: "#3f6b4e", cols: 2, rows: 3, curtain: "#fff6ea" }));
  // 문: 초록 쌍문 + 채광창 · 계단
  const doorT = tex(128, 160, (g, w, h) => {
    g.fillStyle = "#3f6b4e";
    g.fillRect(0, 0, w, h);
    for (const x0 of [8, w / 2 + 4]) {
      const ww = w / 2 - 12;
      const gr = g.createLinearGradient(0, 10, 0, h * 0.6);
      gr.addColorStop(0, "#ffe6a8");
      gr.addColorStop(1, "#f0a54e");
      g.fillStyle = gr;
      g.fillRect(x0 + 6, 12, ww - 12, h * 0.48);
      g.strokeStyle = "#2f5240";
      g.lineWidth = 4;
      g.strokeRect(x0 + 6, h * 0.68, ww - 12, h * 0.24);
    }
    g.fillStyle = "#e6c25a";
    g.fillRect(w / 2 - 10, h * 0.56, 4, 18);
    g.fillRect(w / 2 + 6, h * 0.56, 4, 18);
  });
  box(2.6, 3.0, 0.2, woodDark, 0, 0.55, HF + 0.02, 0.04);
  plane(2.1, 2.6, cut(doorT, true), 0, 0.55 + 1.3, HF + 0.13);
  for (let i = 0; i < 2; i++) box(3.2 - i * 0.4, 0.2, 0.6, mt(0xb8b0a2), 0, 0.15 + i * 0.2, HF + 0.6 - i * 0.25, 0.03);
  // 매표 창 (왼쪽 · 줄무늬 차양 · 선반) · 오른쪽 창
  const ticketT = winTex({
    frame: "#3f6b4e",
    cols: 1,
    rows: 1,
    curtain: null,
    extra: (g, w, h) => {
      g.fillStyle = "#c98a5a";
      g.fillRect(0, h * 0.7, w, h * 0.3);
      g.fillStyle = "#fff6ea";
      g.beginPath();
      g.arc(w / 2, h * 0.32, 12, 0, Math.PI * 2);
      g.fill();
    },
  }, 96, 96);
  win(0, -3.6, 2.0, 1.7, 1.5, cut(ticketT), woodDark, body);
  box(2.0, 0.08, 0.45, wood, -3.6, 1.2, HF + 0.22, 0.02);
  const awT = cut(stripeTex("#3f6b4e", "#f4efe2", 8), true);
  const aw = new THREE.Mesh(own(new THREE.PlaneGeometry(2.2, 0.9)), awT);
  aw.rotation.x = -Math.PI / 2 + 0.7;
  aw.position.set(-3.6, 3.15, HF + 0.38);
  K.G.add(aw);
  win(0, 3.6, 2.0, 1.6, 1.9, warm, woodDark, body);
  for (const side of [1, 3]) for (const u of [-1.6, 1.6]) win(side, u, 2.1, 1.2, 1.6, warm, woodDark, body);
  for (const u of [-3.6, 0, 3.6]) win(2, u, 2.1, 1.4, 1.7, warm, woodDark, body);
  // 지붕: 긴 박공 + 앞 가운데 작은 박공 (시계) + 굴뚝
  prism(HD, 2.3, HW, timberS, 0, WH + 0.05, HZ, 0.05, K.G, true);
  roof(HD, HW, 2.3, red, 0, WH + 0.05, HZ, { over: 0.55, cap: redDark });
  const gs = 4.4,
    gl = 3.2;
  prism(gs, 2.0, gl, cream, 0, WH + 0.05, HF - gl / 2 + 0.25, 0.05);
  roof(gs, gl, 2.0, red, 0, WH + 0.05, HF - gl / 2 + 0.25, { alongZ: true, over: 0.4, cap: redDark });
  clock(0.62, "#3f6b4e", 0, WH + 0.85, HF + 0.28);
  box(0.9, 2.4, 0.9, tm(brickTex("#c8b8a0", ["#a5553f", "#b4634a", "#9a4c38"], 1, 2)), -3.8, WH + 0.8, HZ - 1.2, 0.05);
  box(1.05, 0.18, 1.05, cream, -3.8, WH + 3.2, HZ - 1.2, 0.03);
  // ── 승강장 지붕 (양옆 날개 · 철기둥 · 꽃바구니 · 둥근 등) ──
  const CH = 3.5;
  const wingRoof = (sx: number) => {
    const x0 = sx * (HW / 2 - 0.2),
      x1 = sx * (W / 2 - 0.3);
    const cx = (x0 + x1) / 2,
      len = Math.abs(x1 - x0);
    const cz0 = PZ0 + 0.4,
      cz1 = PZ1 + 0.2,
      cd = cz1 - cz0,
      ccz = (cz0 + cz1) / 2;
    tilt(len, 0.22, cd + 0.6, red, cx, PH + CH + 0.25, ccz, 0.07, 0, 0.05);
    box(len, 0.32, 0.12, ironG, cx, PH + CH - 0.18, cz1 + 0.32, 0.03);
    // 물결 나무 끝단
    plane(len, 0.3, cut(scallopTex("#f4e6cc", "#e8d6b6", Math.round(len / 0.6))), cx, PH + CH - 0.32, cz1 + 0.4);
    const n = Math.round(len / 3.4);
    for (let i = 0; i <= n; i++) {
      const x = sx * (Math.abs(x0) + 0.6 + (i * (len - 1.0)) / n);
      for (const z of [cz1, cz0 + 0.6]) {
        cyl(0.08, 0.1, CH, ironG, x, PH, z, 8, 0.02);
        cyl(0.16, 0.16, 0.12, ironGD, x, PH, z, 8, 0.02);
        tilt(0.06, 0.9, 0.06, ironG, x + sx * 0.3, PH + CH - 0.45, z, 0, sx * -0.75, 0.01);
        tilt(0.06, 0.9, 0.06, ironG, x - sx * 0.3, PH + CH - 0.45, z, 0, sx * 0.75, 0.01);
      }
      if (i < n) {
        const mx = x + sx * ((len - 1.0) / n / 2);
        // 꽃바구니 (앞줄) · 등 (가운데)
        cyl(0.01, 0.01, 0.5, ironGD, mx, PH + CH - 0.5, cz1 + 0.05, 4, 0);
        const bk = new THREE.Mesh(own(new THREE.SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)), woodDark);
        K.put(bk, mx, PH + CH - 0.55, cz1 + 0.05, 0.02, K.G);
        bush(mx, PH + CH - 0.75, cz1 + 0.05, 0.5, leaf, pinkF);
        cyl(0.01, 0.01, 0.4, ironGD, mx, PH + CH - 0.4, ccz, 4, 0);
        ball(0.2, glow(0xfff0c0), mx, PH + CH - 0.55, ccz, 0.02);
      }
    }
  };
  wingRoof(-1);
  wingRoof(1);
  // 역사 뒤 (철길 쪽) 처마
  tilt(HW + 0.6, 0.2, 2.6, red, 0, PH + CH + 0.1, HZ - HD / 2 - 1.1, -0.12, 0, 0.04);
  for (const x of [-HW / 2 + 0.5, -2, 2, HW / 2 - 0.5]) cyl(0.08, 0.1, CH - 0.1, ironG, x, PH, HZ - HD / 2 - 2.2, 8, 0.02);
  // 벤치 셋 · 자판기 · 짐수레 · 신호등 · 역 이름판
  const bench = (x: number, z: number, ry: number) => {
    const g = new THREE.Group();
    g.position.set(x, PH, z);
    g.rotation.y = ry;
    K.G.add(g);
    box(1.8, 0.1, 0.5, wood, 0, 0.45, 0, 0.02, g);
    box(1.8, 0.4, 0.08, wood, 0, 0.62, -0.24, 0.02, g);
    for (const dx of [-0.75, 0.75]) box(0.08, 0.45, 0.45, ironGD, dx, 0, 0, 0.015, g);
  };
  bench(-9.5, -0.6, 0);
  bench(-12.8, -0.6, 0);
  bench(10.2, -0.6, 0);
  const vend = tm(tex(64, 128, (g, w, h) => {
    g.fillStyle = "#e0483a";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#fff6ea";
    g.fillRect(6, 8, w - 12, h * 0.5);
    const cols = ["#4f86c8", "#f2c94c", "#6fbf5a", "#e0806c"];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      g.fillStyle = cols[(r + c) % 4];
      g.fillRect(10 + c * 12, 14 + r * 20, 8, 14);
    }
    g.fillStyle = "#2b2433";
    g.fillRect(10, h * 0.78, w - 20, 10);
    g.fillStyle = "#ffffff";
    g.fillRect(w - 18, h * 0.62, 8, 12);
  }));
  box(1.0, 1.9, 0.75, vend, -W / 2 + 1.3, PH, -0.9, 0.04);
  // 짐수레 (가방 셋)
  const cart = new THREE.Group();
  cart.position.set(7.2, PH, -2.4);
  cart.rotation.y = 0.25;
  K.G.add(cart);
  box(1.6, 0.1, 0.9, woodDark, 0, 0.35, 0, 0.02, cart);
  for (const dx of [-0.6, 0.6]) {
    const wh = new THREE.Mesh(own(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 10)), mt(0x2b2433));
    wh.rotation.x = Math.PI / 2;
    K.put(wh, dx, 0.2, 0.46, 0.02, cart);
  }
  box(0.06, 0.9, 0.06, ironGD, -0.8, 0.45, 0, 0.01, cart);
  box(0.75, 0.5, 0.35, mt(0x8a4a3a), -0.3, 0.45, -0.15, 0.03, cart);
  box(0.6, 0.45, 0.4, mt(0x4f86c8), 0.35, 0.45, 0.15, 0.03, cart);
  box(0.5, 0.35, 0.3, mt(0xe6c25a), 0.0, 0.95, 0.0, 0.03, cart);
  // 신호등 (오른쪽 끝 · 철길 쪽) — 빨강 / 초록 번갈아
  const sgX = W / 2 - 0.6,
    sgZ = PZ0 + 0.5;
  cyl(0.08, 0.1, 3.2, mt(0x3a3440), sgX, 0, sgZ, 8, 0.02);
  box(0.42, 0.95, 0.32, mt(0x2b2433), sgX, 2.8, sgZ, 0.03);
  const redL = glow(0xff4a3a),
    grnL = glow(0x4aff8a),
    offL = mt(0x3a3440);
  const lr = ball(0.13, redL, sgX, 3.47, sgZ + 0.17, 0, K.G, 1),
    lg = ball(0.13, offL, sgX, 3.1, sgZ + 0.17, 0, K.G, 1);
  anims.push((t) => {
    const on = Math.floor(t / 6) % 2 === 0;
    lr.material = on ? redL : offL;
    lg.material = on ? offL : grnL;
  });
  // 역 이름판 (앞 왼쪽 · 기둥 둘)
  const nb = { x: -9.6, z: PZ1 + 1.6 };
  for (const dx of [-1.1, 1.1]) cyl(0.06, 0.06, 2.0, ironG, nb.x + dx, 0, nb.z, 6, 0.02);
  box(2.6, 0.75, 0.1, ironG, nb.x, 1.45, nb.z, 0.03);
  plane(2.45, 0.62, cut(tex(320, 80, (g, w, h) => {
    g.fillStyle = "#fbfaf4";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#3f6b4e";
    g.fillRect(0, h - 14, w, 14);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = '400 42px "Black Han Sans", sans-serif';
    g.fillStyle = "#2b2433";
    g.fillText(STATION_NAME, w / 2, h / 2 - 6);
  })), nb.x, 1.82, nb.z + 0.06);
  // 마을 쪽 화단 · 화분 · 가로등
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const x = sx * (8.2 + i * 2.9);
      if (sx < 0 && i === 1) continue;
      box(2.0, 0.45, 0.9, tm(brickTex("#c8b8a0", ["#a5553f", "#b4634a", "#9a4c38"], 1.6, 0.6)), x, 0.05, zf - 0.9, 0.03);
      for (let k = 0; k < 3; k++) bush(x - 0.6 + k * 0.6, 0.45, zf - 0.9, 0.55, leaf, k % 2 ? pinkF : mt(0xfff6ea));
    }
    cyl(0.07, 0.09, 3.0, ironG, sx * 6.9, 0, zf - 0.6, 8, 0.02);
    ball(0.25, glow(0xfff0c0), sx * 6.9, 3.25, zf - 0.6, 0.02);
    pot(sx * 1.9, HF + 0.75, 1.1, mt(0xd9825a), leaf, pinkF, 0.05);
  }
  return K.done();
}
