import {
  BOUNDS,
  BRIDGES,
  BUILDINGS,
  FOUNTAIN,
  LAKE,
  PARK,
  PATHS,
  PLAZA,
  RIVER,
  TREES,
  WORLD,
  isLot,
  riverX,
  terrainH,
} from "@/lib/gmtown/world";

/*
 * 마을 그림 지도 (위가 북쪽) — 전체 지도 창 · 작은 원형 지도가 같이 씀.
 * 땅 · 언덕 음영 · 강 · 길 · 건물 · 나무를 한 번만 그려 두고(PPM px / m), 그 위에 사람 점만 매번 그림.
 */

/** 그림 지도 해상도 (1m 당 px) */
export const PPM = 4;
let base: HTMLCanvasElement | null = null;

const mix = (a: number[], b: number[], k: number) => a.map((v, i) => Math.round(v + (b[i] - v) * k));

/** 땅 · 언덕 · 강 · 길 · 건물 그린 지도 (처음 한 번 만들고 계속 씀) */
export function townBase(): HTMLCanvasElement {
  if (base) return base;
  const W = WORLD.w * PPM,
    H = WORLD.h * PPM;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  // 땅: 높이로 밝기 + 북서쪽 빛 음영 (2m 칸)
  const S = 1;
  const img = g.createImageData(WORLD.w / S, WORLD.h / S);
  const grass = [122, 186, 102],
    hill = [168, 204, 120],
    mount = [126, 150, 112],
    deep = [92, 150, 86];
  for (let j = 0; j < WORLD.h / S; j++)
    for (let i = 0; i < WORLD.w / S; i++) {
      const x = (i + 0.5) * S,
        y = (j + 0.5) * S;
      const h = terrainH(x, y);
      const gx = terrainH(x + 1, y) - terrainH(x - 1, y),
        gy = terrainH(x, y + 1) - terrainH(x, y - 1);
      const lit = Math.max(-1, Math.min(1, (-gx - gy) * 0.35));
      const out = x < BOUNDS.x0 || y < BOUNDS.y0 || x > BOUNDS.x1 || y > BOUNDS.y1;
      let col = mix(grass, hill, Math.max(0, Math.min(1, h / 12)));
      if (out) col = mix(col, mount, 0.6);
      if (h < -0.3) col = deep;
      col = col.map((v) => Math.max(0, Math.min(255, v * (1 + lit * 0.22))));
      const o = (j * (WORLD.w / S) + i) * 4;
      img.data[o] = col[0];
      img.data[o + 1] = col[1];
      img.data[o + 2] = col[2];
      img.data[o + 3] = 255;
    }
  const t = document.createElement("canvas");
  t.width = img.width;
  t.height = img.height;
  t.getContext("2d")!.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(t, 0, 0, W, H);
  g.save();
  g.scale(PPM, PPM);
  g.lineCap = g.lineJoin = "round";
  // 강 · 호수
  const water = (w: number, col: string) => {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.beginPath();
    for (let y = -4; y <= WORLD.h + 4; y += 2) (y === -4 ? g.moveTo : g.lineTo).call(g, riverX(y), y);
    g.stroke();
  };
  water(RIVER.half * 2 + 3, "#cfe9c9");
  water(RIVER.half * 2, "#58b6e0");
  water(RIVER.half * 0.9, "#7fcbec");
  g.fillStyle = "#58b6e0";
  g.beginPath();
  g.ellipse(LAKE.x, LAKE.y, LAKE.rx, LAKE.ry, 0, 0, Math.PI * 2);
  g.fill();
  // 공원 · 광장
  g.fillStyle = "#9fd27e";
  g.beginPath();
  g.arc(PARK.x, PARK.y, PARK.r, 0, Math.PI * 2);
  g.fill();
  // 길 (테두리 → 안쪽)
  const kindCol = { stone: ["#b9a88c", "#efe2c8"], dirt: ["#a9865e", "#d9b98a"], rail: ["#5b4a3e", "#8a7563"] };
  for (const pass of [0, 1])
    for (const p of PATHS) {
      g.strokeStyle = kindCol[p.kind][pass];
      g.lineWidth = p.w + (pass ? 0 : 0.9);
      g.beginPath();
      p.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
  // 계단길 가로줄
  g.strokeStyle = "rgba(120,90,60,0.55)";
  g.lineWidth = 0.25;
  for (const p of PATHS) {
    if (!p.stairs) continue;
    for (let i = 0; i < p.pts.length - 1; i++) {
      const [ax, ay] = p.pts[i],
        [bx, by] = p.pts[i + 1];
      const L = Math.hypot(bx - ax, by - ay),
        nx = -(by - ay) / L,
        ny = (bx - ax) / L;
      for (let s = 0.6; s < L; s += 0.9) {
        const x = ax + ((bx - ax) * s) / L,
          y = ay + ((by - ay) * s) / L;
        g.beginPath();
        g.moveTo(x - (nx * p.w) / 2, y - (ny * p.w) / 2);
        g.lineTo(x + (nx * p.w) / 2, y + (ny * p.w) / 2);
        g.stroke();
      }
    }
  }
  g.fillStyle = "#efe2c8";
  g.strokeStyle = "#b9a88c";
  g.lineWidth = 0.8;
  g.beginPath();
  g.arc(PLAZA.x, PLAZA.y, PLAZA.r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.strokeStyle = "rgba(185,168,140,0.7)";
  g.lineWidth = 0.35;
  for (const r of [PLAZA.r * 0.7, PLAZA.r * 0.45]) {
    g.beginPath();
    g.arc(PLAZA.x, PLAZA.y, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = "#7fcbec";
  g.strokeStyle = "#ffffff";
  g.lineWidth = 0.5;
  g.beginPath();
  g.arc(FOUNTAIN.x, FOUNTAIN.y, FOUNTAIN.r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  // 다리
  for (const br of BRIDGES) {
    g.fillStyle = br.rail ? "#6d5a4b" : "#c98f5a";
    g.fillRect(riverX(br.y) - RIVER.bank - 1, br.y - br.w / 2, (RIVER.bank + 1) * 2, br.w);
    g.strokeStyle = "rgba(60,40,20,0.6)";
    g.lineWidth = 0.3;
    g.strokeRect(riverX(br.y) - RIVER.bank - 1, br.y - br.w / 2, (RIVER.bank + 1) * 2, br.w);
  }
  // 나무
  for (const tr of TREES) {
    const r = 0.9 + tr.s * 0.7;
    g.fillStyle = "rgba(30,60,30,0.28)";
    g.beginPath();
    g.arc(tr.x + 0.35, tr.y + 0.45, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = tr.kind === "blossom" ? "#f2a7c3" : tr.kind === "pine" ? "#3f8a52" : "#5aa457";
    g.beginPath();
    g.arc(tr.x, tr.y, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.22)";
    g.beginPath();
    g.arc(tr.x - r * 0.3, tr.y - r * 0.3, r * 0.45, 0, Math.PI * 2);
    g.fill();
  }
  // 건물: 그림자 → 벽 색 → 지붕 색 → 테두리
  for (const b of BUILDINGS) {
    if (isLot(b)) {
      g.setLineDash([0.8, 0.6]);
      g.strokeStyle = "rgba(120,90,40,0.7)";
      g.lineWidth = 0.35;
      g.strokeRect(b.x, b.y, b.w, b.d);
      g.setLineDash([]);
      continue;
    }
    g.fillStyle = "rgba(20,20,40,0.28)";
    g.fillRect(b.x + 0.8, b.y + 1, b.w, b.d);
    g.fillStyle = b.wall;
    g.fillRect(b.x, b.y, b.w, b.d);
    g.fillStyle = b.top;
    g.fillRect(b.x + 0.6, b.y + 0.6, b.w - 1.2, b.d - 1.2);
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.fillRect(b.x + 0.6, b.y + 0.6, b.w - 1.2, (b.d - 1.2) * 0.35);
    g.strokeStyle = "rgba(25,18,40,0.85)";
    g.lineWidth = 0.4;
    g.strokeRect(b.x, b.y, b.w, b.d);
  }
  g.restore();
  base = c;
  return c;
}

export type MapDot = { x: number; y: number };

/**
 * 원형 작은 지도: 나를 가운데, 시점이 보는 쪽이 위 (yaw 만큼 돌림), 반지름 R(m) 만큼.
 * face: 내가 보는 방향 (땅 위 라디안, +y 가 0) · yaw: 카메라가 있는 쪽
 */
export function drawMiniRound(
  m: CanvasRenderingContext2D,
  size: number,
  me: { x: number; y: number; face: number } | null,
  others: MapDot[],
  yaw: number,
  R = 34
) {
  const bc = townBase();
  const r = size / 2;
  m.clearRect(0, 0, size, size);
  m.save();
  m.beginPath();
  m.arc(r, r, r - 1, 0, Math.PI * 2);
  m.clip();
  m.fillStyle = "#7d9a72";
  m.fillRect(0, 0, size, size);
  const cx = me?.x ?? PLAZA.x,
    cy = me?.y ?? PLAZA.y;
  const k = r / R; // px / m
  // 카메라가 있는 쪽이 아래 → 보는 쪽이 위
  m.translate(r, r);
  m.rotate(yaw);
  m.scale(k, k);
  m.translate(-cx, -cy);
  m.imageSmoothingEnabled = true;
  m.drawImage(bc, 0, 0, WORLD.w, WORLD.h);
  // 다른 사람
  m.fillStyle = "#ffffff";
  m.strokeStyle = "rgba(0,0,0,0.5)";
  m.lineWidth = 0.35;
  for (const o of others) {
    if (Math.abs(o.x - cx) > R * 1.5 || Math.abs(o.y - cy) > R * 1.5) continue;
    m.beginPath();
    m.arc(o.x, o.y, 0.9, 0, Math.PI * 2);
    m.fill();
    m.stroke();
  }
  m.restore();
  // 나: 가운데 화살표 (보는 쪽)
  if (me) {
    m.save();
    m.translate(r, r);
    m.rotate(Math.PI + yaw - me.face);
    // 시야 부채꼴
    const fan = m.createRadialGradient(0, 0, 2, 0, 0, r * 0.55);
    fan.addColorStop(0, "rgba(255,226,140,0.55)");
    fan.addColorStop(1, "rgba(255,226,140,0)");
    m.fillStyle = fan;
    m.beginPath();
    m.moveTo(0, 0);
    m.arc(0, 0, r * 0.55, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
    m.closePath();
    m.fill();
    m.fillStyle = "#FFD36B";
    m.strokeStyle = "#3a2a00";
    m.lineWidth = 1.4;
    m.beginPath();
    m.moveTo(0, -7);
    m.lineTo(5, 5);
    m.lineTo(0, 2.5);
    m.lineTo(-5, 5);
    m.closePath();
    m.fill();
    m.stroke();
    m.restore();
  }
  // 북쪽 표시 (테두리 위)
  const na = yaw; // 북(-y) 방향이 화면에서 가리키는 각
  const nx = r + Math.sin(na) * (r - 9),
    ny = r - Math.cos(na) * (r - 9);
  m.fillStyle = "rgba(20,16,30,0.75)";
  m.beginPath();
  m.arc(nx, ny, 7, 0, Math.PI * 2);
  m.fill();
  m.fillStyle = "#FFD36B";
  m.font = "700 9px 'Nanum Gothic', sans-serif";
  m.textAlign = "center";
  m.textBaseline = "middle";
  m.fillText("N", nx, ny + 0.5);
}

/** 전체 지도 (위가 북쪽): (x, y) m → 캔버스 px 로 맞춰 그림. 돌려주는 값은 좌표 바꾸는 함수 */
export function drawFullMap(
  m: CanvasRenderingContext2D,
  w: number,
  h: number,
  view: { x0: number; y0: number; x1: number; y1: number },
  me: { x: number; y: number; face: number } | null,
  others: MapDot[]
) {
  const bc = townBase();
  const k = Math.min(w / (view.x1 - view.x0), h / (view.y1 - view.y0));
  const ox = (w - (view.x1 - view.x0) * k) / 2 - view.x0 * k,
    oy = (h - (view.y1 - view.y0) * k) / 2 - view.y0 * k;
  m.clearRect(0, 0, w, h);
  m.fillStyle = "#6f8f68";
  m.fillRect(0, 0, w, h);
  m.imageSmoothingEnabled = true;
  m.drawImage(bc, ox, oy, WORLD.w * k, WORLD.h * k);
  m.fillStyle = "#ffffff";
  m.strokeStyle = "rgba(0,0,0,0.55)";
  m.lineWidth = 1;
  for (const o of others) {
    m.beginPath();
    m.arc(ox + o.x * k, oy + o.y * k, 3, 0, Math.PI * 2);
    m.fill();
    m.stroke();
  }
  if (me) {
    const x = ox + me.x * k,
      y = oy + me.y * k;
    m.save();
    m.translate(x, y);
    // face: +y(남)이 0, 시계 반대로 늘어남 (sin, cos) → 화면 각
    m.rotate(-me.face + Math.PI);
    const fan = m.createRadialGradient(0, 0, 3, 0, 0, 42);
    fan.addColorStop(0, "rgba(255,226,140,0.6)");
    fan.addColorStop(1, "rgba(255,226,140,0)");
    m.fillStyle = fan;
    m.beginPath();
    m.moveTo(0, 0);
    m.arc(0, 0, 42, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
    m.closePath();
    m.fill();
    m.fillStyle = "#FFD36B";
    m.strokeStyle = "#3a2a00";
    m.lineWidth = 1.6;
    m.beginPath();
    m.moveTo(0, -9);
    m.lineTo(6.5, 6.5);
    m.lineTo(0, 3);
    m.lineTo(-6.5, 6.5);
    m.closePath();
    m.fill();
    m.stroke();
    m.restore();
  }
  return { k, ox, oy };
}
