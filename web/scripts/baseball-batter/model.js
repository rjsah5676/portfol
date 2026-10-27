/**
 * 2.5등신 타자 3D 모델 (three.js) — 자세(poses.js)를 받아 관절을 IK 로 맞추고 여러 패스로 그림.
 * 패스: id(재질 번호 색) · shade(흰색 툰 명암) · spec(하이라이트) · col(고정색 재질의 실제 색)
 */
import * as THREE from "three";
THREE.ColorManagement.enabled = false;

export const MAT = {
  team: 1, helm: 2, skin: 3, pants: 4, dark: 5, bat: 6,
  // 고정색 (층 0)
  outline: 10, shoe: 11, sole: 12, hair: 13, glove: 14, lace: 15, eye: 16,
};
const FIXED_COL = { [MAT.outline]: 0x1c1726, [MAT.shoe]: 0x23212e, [MAT.sole]: 0xf2f0ea, [MAT.hair]: 0x2a2018, [MAT.glove]: 0xf4f4f6, [MAT.lace]: 0xdedce8, [MAT.eye]: 0x1c1726 };
const idColor = (id) => new THREE.Color(`rgb(${id * 10},0,0)`);

const UP = new THREE.Vector3(0, 1, 0);
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const yaw = (deg) => new THREE.Vector3(Math.cos((deg * Math.PI) / 180), 0, Math.sin((deg * Math.PI) / 180));

/* ───────── 재질 (패스마다 갈아 끼움) ───────── */
const grad = (() => {
  const d = new Uint8Array([90, 90, 90, 255, 160, 160, 160, 255, 212, 212, 212, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(d, 4, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
const mats = new Map();
function matFor(id, pass, shiny) {
  const key = `${id}|${pass}|${shiny}`;
  if (mats.has(key)) return mats.get(key);
  let m;
  if (pass === "id") m = new THREE.MeshBasicMaterial({ color: idColor(id) });
  else if (pass === "shade") m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: grad });
  else if (pass === "spec") m = new THREE.MeshPhongMaterial({ color: 0x000000, specular: shiny ? 0xffffff : 0x000000, shininess: shiny ? 28 : 1, emissive: 0x000000 });
  else m = id >= 10 ? new THREE.MeshToonMaterial({ color: FIXED_COL[id], gradientMap: grad }) : new THREE.MeshBasicMaterial({ color: 0x000000 });
  mats.set(key, m);
  return m;
}

/* 외곽선: 법선 방향으로 부풀린 뒷면 */
const outlineMat = (pass) => {
  const k = `ol|${pass}`;
  if (mats.has(k)) return mats.get(k);
  const color = pass === "id" ? idColor(MAT.outline) : pass === "col" ? new THREE.Color(FIXED_COL[MAT.outline]) : new THREE.Color(0, 0, 0);
  const m = new THREE.ShaderMaterial({
    uniforms: { c: { value: color }, w: { value: 0.016 } },
    vertexShader: "uniform float w; void main(){ vec3 p = position + normal * w; gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }",
    fragmentShader: "uniform vec3 c; void main(){ gl_FragColor = vec4(c,1.0); }",
    side: THREE.BackSide,
  });
  mats.set(k, m);
  return m;
};

/* ───────── 부품 ───────── */
export class Batter {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.parts = [];
  }
  /** 부품 하나: geo 는 원점 기준, 매 프레임 setTransform */
  part(geo, id, { shiny = false, outline = true } = {}) {
    geo = geo ?? new THREE.BufferGeometry();
    const mesh = new THREE.Mesh(geo, matFor(id, "shade"));
    mesh.userData = { id, shiny };
    this.root.add(mesh);
    let ol = null;
    if (outline) {
      ol = new THREE.Mesh(geo, outlineMat("shade"));
      ol.userData = { outline: true };
      this.root.add(ol);
    }
    const p = { mesh, ol };
    this.parts.push(p);
    return p;
  }
  setPass(pass) {
    for (const { mesh, ol } of this.parts) {
      mesh.material = matFor(mesh.userData.id, pass, mesh.userData.shiny);
      if (ol) ol.material = outlineMat(pass);
    }
  }
}

/** 두 점 사이 캡슐 (반지름 r0 → r1) */
function capsuleBetween(p, a, b, r0, r1 = r0) {
  const len = a.distanceTo(b);
  const key = `${len.toFixed(3)}|${r0}|${r1}`;
  if (p._key !== key) {
    const g = taperCapsule(len, r0, r1);
    p.mesh.geometry = g;
    if (p.ol) p.ol.geometry = g;
    p._key = key;
  }
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  for (const m of [p.mesh, p.ol]) {
    if (!m) continue;
    m.position.copy(a);
    m.quaternion.copy(q);
    m.scale.set(1, 1, 1);
  }
}
function taperCapsule(len, r0, r1) {
  // y 0 → len, 아래 반구 r0 · 위 반구 r1
  const pts = [];
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const t = -Math.PI / 2 + (i / N) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(t) * r0, Math.sin(t) * r0));
  }
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(t) * r1, len + Math.sin(t) * r1));
  }
  const g = new THREE.LatheGeometry(pts, 20);
  g.computeVertexNormals();
  return g;
}
function place(p, pos, quat, scale = [1, 1, 1]) {
  for (const m of [p.mesh, p.ol]) {
    if (!m) continue;
    m.position.copy(pos);
    m.quaternion.copy(quat);
    m.scale.set(scale[0], scale[1], scale[2]);
  }
}
/** 기준 축(x=오른쪽 · y=위 · z=앞) → 쿼터니언 */
function basis(fwd, up) {
  const z = fwd.clone().normalize();
  const x = new THREE.Vector3().crossVectors(up, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** 두 마디 IK */
function ik(a, t, l1, l2, pole) {
  const d = t.clone().sub(a);
  let L = d.length();
  const dn = d.clone().normalize();
  const over = Math.max(0, L - (l1 + l2 - 1e-3));
  L = Math.min(L, l1 + l2 - 1e-3);
  const x = (l1 * l1 - l2 * l2 + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(l1 * l1 - x * x, 0));
  const p = pole.clone().sub(dn.clone().multiplyScalar(pole.dot(dn)));
  if (p.lengthSq() < 1e-6) p.copy(new THREE.Vector3().crossVectors(dn, UP));
  p.normalize();
  return { mid: a.clone().add(dn.clone().multiplyScalar(x)).add(p.multiplyScalar(h)), end: a.clone().add(dn.multiplyScalar(L)), over };
}

/* ───────── 모델 만들기 ───────── */
export function buildBatter(scene) {
  const B = new Batter(scene);
  const S = (r, w = 24, h = 16) => new THREE.SphereGeometry(r, w, h);
  B.p = {
    // 몸통
    jersey: B.part(new THREE.SphereGeometry(1, 28, 20), MAT.team),
    hips: B.part(new THREE.SphereGeometry(1, 24, 16), MAT.pants),
    belt: B.part(new THREE.TorusGeometry(1, 0.11, 10, 28), MAT.dark, { outline: false }),
    neck: B.part(new THREE.CylinderGeometry(0.075, 0.085, 0.16, 14), MAT.skin),
    // 머리
    face: B.part(S(0.33), MAT.skin),
    earR: B.part(S(0.075, 12, 8), MAT.skin),
    hair: B.part(S(0.3), MAT.hair, { outline: false }),
    helm: B.part(new THREE.SphereGeometry(0.405, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.62), MAT.helm, { shiny: true }),
    brim: B.part(new THREE.CylinderGeometry(0.28, 0.28, 0.035, 28, 1, false, -Math.PI / 2, Math.PI), MAT.helm, { shiny: true }),
    flap: B.part(S(0.155, 16, 12), MAT.helm, { shiny: true }),
    // 팔
    upL: B.part(null, MAT.dark), upR: B.part(null, MAT.dark),
    loL: B.part(null, MAT.dark), loR: B.part(null, MAT.dark),
    slL: B.part(null, MAT.team), slR: B.part(null, MAT.team),
    elL: B.part(S(0.07, 12, 8), MAT.dark, { outline: false }), elR: B.part(S(0.07, 12, 8), MAT.dark, { outline: false }),
    hL: B.part(new THREE.BoxGeometry(0.15, 0.13, 0.13, 3, 3, 3), MAT.pants), hR: B.part(new THREE.BoxGeometry(0.15, 0.13, 0.13, 3, 3, 3), MAT.pants),
    // 다리
    thL: B.part(null, MAT.pants), thR: B.part(null, MAT.pants),
    shL: B.part(null, MAT.pants), shR: B.part(null, MAT.pants),
    knL: B.part(S(0.125, 14, 10), MAT.pants, { outline: false }), knR: B.part(S(0.125, 14, 10), MAT.pants, { outline: false }),
    sockL: B.part(null, MAT.team), sockR: B.part(null, MAT.team),
    shoeL: B.part(new THREE.SphereGeometry(1, 20, 12), MAT.shoe, { shiny: true }), shoeR: B.part(new THREE.SphereGeometry(1, 20, 12), MAT.shoe, { shiny: true }),
    soleL: B.part(new THREE.SphereGeometry(1, 20, 10), MAT.sole, { outline: false }), soleR: B.part(new THREE.SphereGeometry(1, 20, 10), MAT.sole, { outline: false }),
    // 배트
    bat: B.part(batGeo(), MAT.bat, { shiny: true }),
  };
  // 둥근 상자 느낌 (장갑)
  for (const k of ["hL", "hR"]) {
    const g = B.p[k].mesh.geometry;
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = v.clone().normalize();
      v.lerp(n.multiplyScalar(0.085), 0.55);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
  }
  return B;
}
function batGeo() {
  // 노브 → 손잡이 → 배럴 → 끝 (길이 1.12)
  const prof = [
    [0, 0], [0.05, 0.0], [0.052, 0.02], [0.034, 0.045], [0.026, 0.07], [0.027, 0.3], [0.031, 0.45], [0.045, 0.62], [0.058, 0.8], [0.064, 0.95], [0.064, 1.07], [0.055, 1.105], [0.03, 1.12], [0, 1.122],
  ];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 22);
  g.computeVertexNormals();
  return g;
}

/* ───────── 자세 적용 ───────── */
export function applyPose(B, k) {
  const p = B.p;
  const P = v3(k.P);
  const F = yaw(k.hy);
  const Lh = new THREE.Vector3(-F.z, 0, F.x);
  const Fs = yaw(k.sy);
  const Ls = new THREE.Vector3(-Fs.z, 0, Fs.x);
  const lean = ((k.lean ?? 18) * Math.PI) / 180;
  const tilt = ((k.tilt ?? 0) * Math.PI) / 180;
  const U = UP.clone().multiplyScalar(Math.cos(lean)).add(Fs.clone().multiplyScalar(Math.sin(lean))).add(Ls.clone().multiplyScalar(-Math.sin(tilt))).normalize();
  const report = { warn: [] };

  // 골반 · 몸통
  place(p.hips, P.clone().add(U.clone().multiplyScalar(0.04)), basis(F, UP), [0.27, 0.21, 0.22]);
  const chest = P.clone().add(U.clone().multiplyScalar(0.26));
  place(p.jersey, chest, basis(Fs, U), [0.3, 0.28, 0.24]);
  place(p.belt, P.clone().add(U.clone().multiplyScalar(0.11)), basis(UP.clone(), F).multiply(new THREE.Quaternion()), [0.235, 0.235, 0.6]);
  {
    // 벨트: 허리 둘레 (고리 면이 수평)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), U);
    place(p.belt, P.clone().add(U.clone().multiplyScalar(0.12)), q, [0.258, 0.225, 0.5]);
  }
  const shC = P.clone().add(U.clone().multiplyScalar(0.44));
  const shL = shC.clone().add(Ls.clone().multiplyScalar(0.18));
  const shR = shC.clone().add(Ls.clone().multiplyScalar(-0.18));
  const neck = shC.clone().add(U.clone().multiplyScalar(0.06));
  place(p.neck, neck.clone().add(U.clone().multiplyScalar(0.03)), new THREE.Quaternion().setFromUnitVectors(UP, U));

  // 머리: 몸통보다 곧게 · 투수 쪽을 봄
  const hU = UP.clone().multiplyScalar(0.75).add(U.clone().multiplyScalar(0.25)).normalize();
  const H = neck.clone().add(hU.clone().multiplyScalar(0.44));
  const hF = yaw(k.head ?? 80).multiplyScalar(Math.cos(0.18)).add(UP.clone().multiplyScalar(-Math.sin(0.18))).normalize();
  const hq = basis(hF, hU);
  const hL = new THREE.Vector3(-hF.z, 0, hF.x).normalize();
  place(p.face, H.clone().add(hF.clone().multiplyScalar(0.04)).add(hU.clone().multiplyScalar(-0.05)), hq);
  place(p.hair, H.clone().add(hF.clone().multiplyScalar(-0.1)).add(hU.clone().multiplyScalar(-0.12)), hq);
  place(p.earR, H.clone().add(hL.clone().multiplyScalar(-0.33)).add(hU.clone().multiplyScalar(-0.07)), hq);
  // 헬멧: 위쪽 구 (앞이 살짝 들린 모양) · 챙 · 투수 쪽 귀덮개
  {
    const q = hq.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.32));
    place(p.helm, H.clone().add(hU.clone().multiplyScalar(0.03)), q);
    place(p.brim, H.clone().add(hF.clone().multiplyScalar(0.27)).add(hU.clone().multiplyScalar(0.06)), hq.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.12)), [1, 1, 0.95]);
    place(p.flap, H.clone().add(hL.clone().multiplyScalar(0.31)).add(hU.clone().multiplyScalar(-0.1)).add(hF.clone().multiplyScalar(0.02)), hq, [0.75, 1, 1]);
  }

  // 배트 · 손 (머리 · 몸 안 뚫게 밀어냄)
  let D = v3(k.D).normalize();
  let hand = v3(k.hand);
  const helmR = 0.41;
  const segDist = (d, C, t0, t1) => {
    const a = hand.clone().add(d.clone().multiplyScalar(t0));
    const ab = d.clone().multiplyScalar(t1 - t0);
    const t = Math.max(0, Math.min(1, C.clone().sub(a).dot(ab) / ab.lengthSq()));
    return a.add(ab.multiplyScalar(t)).distanceTo(C);
  };
  // 머리(헬멧 구)와 배트 전체 · 몸통과 배럴 쪽만
  const clear = (d) => Math.min(segDist(d, H, -0.06, 1.12) - helmR - 0.05, segDist(d, chest, 0.45, 1.12) - 0.3);
  report.clear0 = clear(D);
  // 손 자체가 머리 안이면 바깥으로
  const hd = hand.distanceTo(H) - (helmR + 0.02);
  if (hd < 0) {
    hand.add(hand.clone().sub(H).normalize().multiplyScalar(-hd));
    report.warn.push("hand-in-head");
  }
  if (clear(D) < 0) {
    // 머리에서 멀어지는 쪽으로 조금씩 돌림
    let best = D.clone(), bestC = clear(D);
    for (let i = 1; i <= 40 && bestC < 0; i++) {
      for (const ax of [new THREE.Vector3().crossVectors(D, H.clone().sub(hand)).normalize(), UP, Ls]) {
        for (const s of [1, -1]) {
          const d2 = D.clone().applyAxisAngle(ax, s * i * 0.025).normalize();
          const c = clear(d2);
          if (c > bestC) {
            bestC = c;
            best = d2;
          }
        }
      }
    }
    report.warn.push(`bat-fixed ${(Math.acos(Math.min(1, best.dot(D))) * 57.3).toFixed(0)}°`);
    D = best;
  }
  report.clear = clear(D);
  const grip = k.grip ?? 0.11;
  const hb = hand.clone();
  const ht = hand.clone().add(D.clone().multiplyScalar(grip));
  const knob = hand.clone().add(D.clone().multiplyScalar(-0.07));
  place(p.bat, knob, new THREE.Quaternion().setFromUnitVectors(UP, D));
  // 팔
  const arm = (sh, hnd, pole, up, lo, el, hp, side, sl) => {
    const r = ik(sh, hnd, 0.3, 0.29, v3(pole));
    if (r.over > 0.02) report.warn.push(`${side}-reach +${r.over.toFixed(2)}`);
    const mid = sh.clone().lerp(r.mid, 0.62);
    capsuleBetween(up, sh, r.mid, 0.075, 0.068);
    capsuleBetween(sl, sh, sh.clone().lerp(r.mid, 0.55), 0.105, 0.095);
    capsuleBetween(lo, r.mid, r.end, 0.066, 0.058);
    place(el, r.mid, new THREE.Quaternion());
    void mid;
    // 장갑: 배트를 감싸는 방향
    place(hp, r.end.clone().add(D.clone().multiplyScalar(0.0)), basis(D, r.end.clone().sub(r.mid).normalize()));
  };
  arm(shL, hb, k.poleL, p.upL, p.loL, p.elL, p.hL, "L", p.slL);
  arm(shR, ht, k.poleR, p.upR, p.loR, p.elR, p.hR, "R", p.slR);

  // 다리 · 발
  const leg = (side, f, th, sh, kn, sock, shoe, sole) => {
    const sgn = side === "L" ? 1 : -1;
    const hip = P.clone().add(Lh.clone().multiplyScalar(0.12 * sgn)).add(U.clone().multiplyScalar(-0.02));
    const fd = yaw(f.yaw);
    const heel = (f.heel * Math.PI) / 180;
    // 앞꿈치 b 를 축으로 뒤꿈치를 듦
    const ball = v3(f.b);
    const footDir = fd.clone().multiplyScalar(Math.cos(heel)).add(UP.clone().multiplyScalar(-Math.sin(heel))).normalize(); // 뒤꿈치 → 앞꿈치
    const heelPt = ball.clone().add(footDir.clone().multiplyScalar(-0.2)).add(UP.clone().multiplyScalar(0.06));
    const ankle = heelPt.clone().add(UP.clone().multiplyScalar(0.07)).add(footDir.clone().multiplyScalar(0.04));
    // 무릎은 발끝 방향 + 골반 방향 사이로 (꺾여 보이지 않게)
    const pole = fd.clone().multiplyScalar(0.7).add(F.clone().multiplyScalar(0.3)).add(UP.clone().multiplyScalar(0.15));
    if (f.knee) pole.copy(v3(f.knee));
    const r = ik(hip, ankle, 0.36, 0.33, pole);
    if (r.over > 0.02) report.warn.push(`leg${side}-reach +${r.over.toFixed(2)}`);
    capsuleBetween(th, hip, r.mid, 0.17, 0.145);
    const cuff = r.mid.clone().lerp(r.end, 0.62);
    capsuleBetween(sh, r.mid, cuff, 0.14, 0.13);
    place(kn, r.mid, new THREE.Quaternion());
    capsuleBetween(sock, cuff, r.end, 0.095, 0.085);
    // 신발: 납작한 타원체 (뒤꿈치 → 앞꿈치)
    const sq = basis(footDir, UP.clone().multiplyScalar(Math.cos(heel)).add(fd.clone().multiplyScalar(Math.sin(heel))).normalize());
    const mid = heelPt.clone().lerp(ball, 0.55).add(UP.clone().multiplyScalar(0.02));
    place(shoe, mid, sq, [0.1, 0.085, 0.2]);
    place(sole, mid.clone().add(UP.clone().multiplyScalar(-0.035).applyQuaternion(new THREE.Quaternion())), sq, [0.105, 0.04, 0.205]);
  };
  leg("L", k.fL, p.thL, p.shL, p.knL, p.sockL, p.shoeL, p.soleL);
  leg("R", k.fR, p.thR, p.shR, p.knR, p.sockR, p.shoeR, p.soleR);

  // 등번호 자리 · 배트 끝 (게임에서 씀)
  report.num = chest.clone().add(Fs.clone().multiplyScalar(-0.24)).add(U.clone().multiplyScalar(0.02));
  report.back = Fs.clone().multiplyScalar(-1);
  report.backU = U.clone();
  report.tip = hand.clone().add(D.clone().multiplyScalar(1.05));
  report.H = H;
  report.dbg = { H: H.toArray().map((x) => +x.toFixed(2)), shL: shL.toArray().map((x) => +x.toFixed(2)), shR: shR.toArray().map((x) => +x.toFixed(2)), hand: hand.toArray().map((x) => +x.toFixed(2)) };
  return report;
}

/** 키프레임 섞기 (배트 방향은 구면 보간) */
export function mix(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const L = (x, y) => x + (y - x) * t;
  const LV = (x, y) => x.map((v, i) => L(v, y[i]));
  const out = {};
  for (const k of Object.keys(a)) {
    const x = a[k], y = b[k];
    if (y === undefined) out[k] = x;
    else if (typeof x === "number") out[k] = L(x, y);
    else if (Array.isArray(x)) out[k] = LV(x, y);
    else if (x && typeof x === "object") out[k] = { b: LV(x.b, y.b), yaw: L(x.yaw, y.yaw), heel: L(x.heel, y.heel) };
    else out[k] = t < 0.5 ? x : y;
  }
  // 배트 방향: 구면 보간
  const da = v3(a.D).normalize(), db = v3(b.D).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(da, db);
  const qi = new THREE.Quaternion().slerp(q, t);
  const d = da.clone().applyQuaternion(qi);
  out.D = [d.x, d.y, d.z];
  return out;
}
