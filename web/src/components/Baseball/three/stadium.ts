/**
 * 3D 구장: 바닥(물리 바닥 재질 surfaceAt 과 같은 모양) · 선 · 베이스 · 마운드 · 담장 · 광고 · 관중석 · 전광판 · 도시 띠 · 조명탑 · 하늘 · 낮/밤.
 * 좌표: 게임 (x 1루쪽, y 중견수쪽, h 위) → three (X = x, Y = h, Z = -y)
 */
import * as THREE from "three";
import { BASES, FENCE_H, fenceDist, surfaceAt } from "@/lib/baseball/play";

export const V = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);

export function buildStadium(scene: THREE.Scene, tex: (n: string, opt?: { repeat?: boolean; mirrorU?: boolean; srgb?: boolean }) => THREE.Texture, texUrl: (n: string) => string, hemi: THREE.HemisphereLight, sun: THREE.DirectionalLight) {
  // 하늘: 안쪽에서 보는 큰 구 (등장방형 그림, 좌우 이음매는 거울 반복으로 숨김)
  const skyTex = { day: tex("sky_day", { mirrorU: true }), night: tex("sky_night", { mirrorU: true }) };
  for (const t of Object.values(skyTex)) t.repeat.set(2, 1);
  const skyMat = new THREE.MeshBasicMaterial({ map: skyTex.day, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 48, 24), skyMat);
  sky.renderOrder = -1;
  scene.add(sky);
  let adsTex: THREE.Texture | null = null;
  // ───────── 구장 (바닥 그림은 물리 바닥 재질 surfaceAt 과 같은 모양) ─────────
  const GX0 = -140, GX1 = 140, GY0 = -40, GY1 = 240; // 바닥 그림 범위 (m)
  function groundTexture() {
    const S = 2048;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d")!;
    const img = g.createImageData(S, S);
    // 잔디 · 흙 그림의 평균색 (세부 무늬 = 그림 / 평균 을 곱하니 전체 색은 이 값이 됨)
    const G0 = [103, 177, 51], D0 = [221, 136, 70];
    const mul = (c: number[], k: number) => c.map((v) => Math.round(v * k));
    const grassA = mul(G0, 0.86), grassB = mul(G0, 0.78), foulG = mul(G0, 0.74), dirt = mul(D0, 0.92), track = mul(D0, 0.8);
    for (let j = 0; j < S; j++) {
      const y = GY0 + ((S - j) / S) * (GY1 - GY0);
      for (let i = 0; i < S; i++) {
        const x = GX0 + (i / S) * (GX1 - GX0);
        const r = Math.hypot(x, y);
        const phi = (Math.atan2(x, y) * 180) / Math.PI;
        const fd = fenceDist(phi);
        let col = grassA;
        const fair = Math.abs(phi) <= 45 && y > 0;
        if (!fair) col = foulG;
        else col = Math.floor(r / 9) % 2 ? grassA : grassB; // 동심원 잔디 줄무늬
        if (Math.abs(phi) <= 62 && r > fd - 5 && r < fd + 2) col = track;
        const s = surfaceAt(x, y);
        if (s === 0 && r < 30) col = dirt;
        const k = (j * S + i) * 4;
        img.data[k] = col[0];
        img.data[k + 1] = col[1];
        img.data[k + 2] = col[2];
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }
  const groundMat = new THREE.MeshLambertMaterial({ map: groundTexture() });
  {
    // 세부 무늬: 월드 좌표로 반복 (잔디 4m · 흙 3m 한 장), 바닥 색이 흙(빨강 > 초록)이면 흙 무늬
    const dG = tex("grass", { repeat: true }), dD = tex("dirt", { repeat: true });
    groundMat.onBeforeCompile = (sh) => {
      sh.uniforms.dG = { value: dG };
      sh.uniforms.dD = { value: dD };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vW;").replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xz;",
      );
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vW; uniform sampler2D dG; uniform sampler2D dD;")
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          { vec3 g = texture2D(dG, vW / 4.0).rgb / vec3(0.404, 0.694, 0.2);
            vec3 d = texture2D(dD, vW / 3.0).rgb / vec3(0.868, 0.534, 0.275);
            float isDirt = step(diffuseColor.g, diffuseColor.r);
            diffuseColor.rgb *= mix(mix(vec3(1.0), g, 0.8), mix(vec3(1.0), d, 0.9), isDirt); }`,
        );
    };
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GX1 - GX0, GY1 - GY0), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((GX0 + GX1) / 2, 0, -(GY0 + GY1) / 2);
  scene.add(ground);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshLambertMaterial({ color: 0x3b7a3f }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.05;
  scene.add(outer);
  // 흰 선 (바닥 그림에 그리면 흐려져서 얇은 띠로)
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf4f4f0 });
  function strip(x0: number, y0: number, x1: number, y1: number, w = 0.1) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -Math.atan2(x1 - x0, y1 - y0);
    m.position.copy(V((x0 + x1) / 2, (y0 + y1) / 2, 0.015));
    scene.add(m);
  }
  for (const s of [1, -1]) strip(0, 0, (s * fenceDist(45)) / Math.SQRT2, fenceDist(45) / Math.SQRT2, 0.12);
  // 타석 상자 (홈 양옆 1.2 × 1.8m)
  for (const s of [1, -1]) {
    const xi = s * 0.45, xo = s * 1.65, yb = -0.9, yf = 0.9;
    strip(xi, yb, xi, yf, 0.08); strip(xo, yb, xo, yf, 0.08); strip(xi, yb, xo, yb, 0.08); strip(xi, yf, xo, yf, 0.08);
  }
  // 베이스 · 홈 · 마운드
  for (const [x, y] of BASES.slice(1, 4)) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.4), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    b.position.copy(V(x, y, 0.04));
    b.rotation.y = Math.PI / 4;
    scene.add(b);
  }
  {
    const sh = new THREE.Shape([new THREE.Vector2(-0.22, 0), new THREE.Vector2(0.22, 0), new THREE.Vector2(0.22, 0.22), new THREE.Vector2(0, 0.43), new THREE.Vector2(-0.22, 0.22)]);
    const hp = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    hp.rotation.x = -Math.PI / 2;
    hp.position.set(0, 0.02, 0.43);
    scene.add(hp);
    const mound = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 0.25, 32), new THREE.MeshLambertMaterial({ color: 0xc08a58 }));
    mound.position.copy(V(0, 18.4, 0.12));
    scene.add(mound);
  }
  // 담장 (곡면 벽) · 노란 띠 · 폴
  {
    const pts: THREE.Vector3[] = [];
    for (let a = -62; a <= 62; a += 1) {
      const r = Math.abs(a) <= 45 ? fenceDist(a) : fenceDist(45) + 2;
      pts.push(V(Math.sin((a * Math.PI) / 180) * r, Math.cos((a * Math.PI) / 180) * r));
    }
    const pos: number[] = [];
    const idx: number[] = [];
    pts.forEach((p, i) => {
      pos.push(p.x, 0, p.z, p.x, FENCE_H, p.z);
      if (i) idx.push(i * 2 - 2, i * 2 - 1, i * 2, i * 2 - 1, i * 2 + 1, i * 2);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x1d3a52, side: THREE.DoubleSide })));
    const top = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map((p) => p.clone().setY(FENCE_H + 0.02))), new THREE.LineBasicMaterial({ color: 0xffd23f }));
    scene.add(top);
    for (const s of [1, -1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 22, 8), new THREE.MeshLambertMaterial({ color: 0xffd23f }));
      pole.position.copy(V((s * fenceDist(45)) / Math.SQRT2, fenceDist(45) / Math.SQRT2, 11));
      scene.add(pole);
    }
    // 담장 광고판 (8장을 차례로 · 한 장 약 17m)
    addAds(pts, 0.35, 2.75, -0.03);
  }
  /** 광고 띠: 선(현장 쪽에서 보이게)을 따라 배너를 차례로 붙임. 배너 그림은 8장을 세로로 쌓은 한 장 */
  function addAds(line: THREE.Vector3[], h0: number, h1: number, inset: number) {
    const len = [0];
    for (let i = 1; i < line.length; i++) len.push(len[i - 1] + line[i].distanceTo(line[i - 1]));
    const total = len[len.length - 1];
    const bw = (h1 - h0) * (512 / 72);
    const n = Math.max(1, Math.round(total / bw));
    const at = (d: number) => {
      let i = 1;
      while (i < len.length - 1 && len[i] < d) i++;
      const k = (d - len[i - 1]) / (len[i] - len[i - 1] || 1);
      const p = line[i - 1].clone().lerp(line[i], k);
      // 안쪽(홈 쪽)으로 살짝 띄움
      const toHome = new THREE.Vector3(-p.x, 0, -p.z).normalize();
      return p.addScaledVector(toHome, -inset);
    };
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let b = 0; b < n; b++) {
      const ad = b % 8;
      const v0 = 1 - (ad + 1) / 8 + 0.004, v1 = 1 - ad / 8 - 0.004;
      const base = pos.length / 3;
      const SEG = 8;
      for (let j = 0; j <= SEG; j++) {
        const d = ((b + j / SEG) / n) * total;
        const p = at(d);
        pos.push(p.x, h0, p.z, p.x, h1, p.z);
        uv.push(j / SEG, v0, j / SEG, v1);
        if (j) idx.push(base + j * 2 - 2, base + j * 2, base + j * 2 - 1, base + j * 2 - 1, base + j * 2, base + j * 2 + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    adsTex ??= tex("ads");
    scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: adsTex, side: THREE.DoubleSide })));
  }
  /**
   * 관중석: 수비 가능 구역(play.ts FOUL_GROUND 와 같은 모양) 바로 바깥을 빙 둘러 계단식 경사면.
   * 관중 그림 한 장 = 한 층(앞 벽 + 사람 3줄). 세로로 4층 반복, 1루 쪽(+x)은 빨강 · 3루 쪽은 파랑
   */
  {
    const ring: [number, number, number][] = []; // x, y, 앞 높이
    for (let a = -62; a <= 62; a += 1) {
      const r = fenceDist(a) + 3;
      ring.push([Math.sin((a * Math.PI) / 180) * r, Math.cos((a * Math.PI) / 180) * r, FENCE_H - 0.6]);
    }
    // 파울 지역 쪽: 오른쪽 폴(+62°) → 1루 옆 → 홈 뒤 → 3루 옆 → 왼쪽 폴 (낮은 벽 바로 뒤). 앞 높이 1.1m
    const r62 = fenceDist(62) + 3;
    const pR: [number, number] = [Math.sin((62 * Math.PI) / 180) * r62, Math.cos((62 * Math.PI) / 180) * r62];
    const pathFoul: [number, number][] = [pR, [61.5, -5.5], [12.6, -17.6], [-12.6, -17.6], [-61.5, -5.5], [-pR[0], pR[1]]];
    // 한 바퀴: -62° 에서 외야를 지나 +62°, 이어서 파울 쪽 (2m 간격)
    const P: [number, number, number][] = [...ring];
    for (let i = 0; i < pathFoul.length - 1; i++) {
      const [x0, y0] = pathFoul[i], [x1, y1] = pathFoul[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
      for (let j = 1; j <= n; j++) P.push([x0 + ((x1 - x0) * j) / n, y0 + ((y1 - y0) * j) / n, 1.1]);
    }
    // 바깥 방향 = 진행 방향의 오른쪽/왼쪽 중 경기장 가운데(0, 50)에서 먼 쪽
    const OUT = 12, UP = 11, TIERS = 3, TILE = (Math.hypot(OUT, UP) / TIERS) * (2048 / 588);
    const mats = { red: new THREE.MeshLambertMaterial({ map: tex("crowd_red", { mirrorU: true }) }), blue: new THREE.MeshLambertMaterial({ map: tex("crowd_blue", { mirrorU: true }) }) };
    for (const m of Object.values(mats)) { m.map!.wrapT = THREE.RepeatWrapping; m.side = THREE.DoubleSide; }
    const build = (pts: [number, number, number][], mat: THREE.Material) => {
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      let u = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x, y, h] = pts[i];
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let nx = b[1] - a[1], ny = -(b[0] - a[0]);
        const l = Math.hypot(nx, ny) || 1;
        nx /= l; ny /= l;
        if ((x + nx - 0) ** 2 + (y + ny - 50) ** 2 < (x - 0) ** 2 + (y - 50) ** 2) { nx = -nx; ny = -ny; }
        if (i) u += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]) / TILE;
        const f = V(x, y, h), bk = V(x + nx * OUT, y + ny * OUT, h + UP);
        pos.push(f.x, f.y, f.z, bk.x, bk.y, bk.z);
        uv.push(u, 0, u, TIERS);
        if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      scene.add(new THREE.Mesh(g, mat));
    };
    // 가운데(x = 0)에서 둘로 나눔: 외야 쪽 가운데 · 홈 뒤 가운데
    const iMidOut = P.findIndex((q) => q[0] >= 0);
    let iMidHome = P.length - 1;
    for (let i = P.length - 1; i > iMidOut; i--) if (P[i][0] >= 0) { iMidHome = i; break; }
    build(P.slice(0, iMidOut + 1), mats.blue); // 3루 쪽 외야 (-62° → 가운데)
    build(P.slice(iMidOut, iMidHome + 2), mats.red); // 가운데 → 1루 쪽 외야 → 1루 옆 → 홈 뒤 가운데
    build([...P.slice(iMidHome + 1), P[0]], mats.blue); // 홈 뒤 → 3루 옆 → 왼쪽 폴
    // 파울 지역 낮은 벽 + 광고
    const wallPts = P.slice(ring.length - 1).map(([x, y]) => V(x, y));
    const wpos: number[] = [], widx: number[] = [];
    wallPts.forEach((p, i) => { wpos.push(p.x, 0, p.z, p.x, 1.2, p.z); if (i) { const k = i * 2; widx.push(k - 2, k - 1, k, k - 1, k + 1, k); } });
    const wg = new THREE.BufferGeometry();
    wg.setAttribute("position", new THREE.Float32BufferAttribute(wpos, 3));
    wg.setIndex(widx);
    wg.computeVertexNormals();
    scene.add(new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ color: 0x1d3a52, side: THREE.DoubleSide })));
    addAds(wallPts, 0.12, 1.08, -0.03);
  }
  // 전광판: 가운데 관중석 뒤, 홈을 바라봄
  const scoreCanvas = document.createElement("canvas");
  {
    const r = fenceDist(0) + 3 + 15 + 3;
    const W = 34, H = W * (448 / 1024);
    scoreCanvas.width = 1024; scoreCanvas.height = 448;
    const img = new Image();
    const st = new THREE.CanvasTexture(scoreCanvas);
    st.colorSpace = THREE.SRGBColorSpace;
    img.onload = () => {
      const g = scoreCanvas.getContext("2d")!;
      g.drawImage(img, 0, 0, 1024, 448);
      // 큰 화면 · 이닝 점수
      g.fillStyle = "#ffd23f"; g.font = "bold 74px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("PLAY BALL!", 512, 150);
      g.font = "bold 26px sans-serif"; g.fillStyle = "#f4f4f0";
      g.fillText("원정", 96, 344); g.fillText("홈", 96, 396);
      g.fillStyle = "#ffef9a";
      for (let i = 0; i < 9; i++) { const x = 255 + i * 56.5; g.fillText(i < 3 ? "0" : "", x, 344); g.fillText(i < 2 ? "0" : "", x, 396); }
      st.needsUpdate = true;
    };
    img.src = texUrl("scoreboard");
    const board = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: st, fog: false }));
    board.position.copy(V(0, r, 13 + H / 2));
    board.lookAt(0, 6, 0);
    scene.add(board);
    // 다리
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 13, 1.2), new THREE.MeshLambertMaterial({ color: 0x2a3550 }));
      leg.position.copy(V(s * W * 0.35, r + 0.6, 6.5));
      scene.add(leg);
    }
  }
  // 도시 띠: 멀리 둥글게 (투명 그림, 안개 없이)
  {
    const R = 330, H = 62;
    const ct = tex("city", { mirrorU: true });
    ct.repeat.set((2 * Math.PI * R) / (H * (2048 / 312)), 1);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 96, 1, true), new THREE.MeshBasicMaterial({ map: ct, transparent: true, alphaTest: 0.5, side: THREE.BackSide, fog: false, depthWrite: false }));
    band.position.y = H / 2 - 4;
    band.renderOrder = -0.5;
    scene.add(band);
  }
  // 조명탑 (관중석 뒤)
  const lamps: THREE.MeshBasicMaterial[] = [];
  for (const a of [-50, -22, 22, 50]) {
    const r = fenceDist(a) + 26;
    const p = V(Math.sin((a * Math.PI) / 180) * r, Math.cos((a * Math.PI) / 180) * r);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 44, 8), new THREE.MeshLambertMaterial({ color: 0x8b8f99 }));
    pole.position.copy(p).setY(22);
    scene.add(pole);
    const lm = new THREE.MeshBasicMaterial({ color: 0xd8dde6 });
    lamps.push(lm);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 1), lm);
    lamp.position.copy(p).setY(45);
    lamp.lookAt(0, 20, 0);
    scene.add(lamp);
  }
  /** 낮 · 밤 */
  function setNight(night: boolean) {
    skyMat.map = night ? skyTex.night : skyTex.day;
    skyMat.needsUpdate = true;
    (scene.fog as THREE.Fog).color.set(night ? 0x2a2a52 : 0xbfe3f7);
    (scene.background as THREE.Color).set(night ? 0x14163a : 0x87b5e0);
    hemi.color.set(night ? 0xc8d4ff : 0xdfeeff);
    hemi.groundColor.set(night ? 0x2a3a2a : 0x4a6b3a);
    hemi.intensity = night ? 0.75 : 1.1;
    // 밤: 조명탑 빛이 위에서 내리쬠
    sun.color.set(night ? 0xf2f6ff : 0xffffff);
    sun.intensity = night ? 1.5 : 1.6;
    sun.position.set(night ? 0 : -60, night ? 140 : 120, night ? -40 : 40);
    for (const l of lamps) l.color.set(night ? 0xfffbe6 : 0xd8dde6);
  }
  return { setNight };
}
