// 수비 스프라이트 굽기: fielder 모델을 2D 수비 화면 각도(위에서 ~25°)로, 8방향 × 동작 프레임 렌더 → PNG dataURL
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

/** 칸 크기 (px) — window.CELL 로 바꿀 수 있음 (고해상도 굽기 512) */
const CELL = (window as unknown as { CELL?: number }).CELL ?? 256;
const VIEW_H = 2.2; // 칸 세로 = 2.2m
const smooth = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
function teamTexture(src: THREE.Texture, hex: number, maskOut?: { t?: THREE.Texture }) {
  const img = src.image as HTMLImageElement;
  const cv = document.createElement("canvas");
  cv.width = img.width; cv.height = img.height;
  const g = cv.getContext("2d")!;
  // 작은 픽셀 그림에선 줄무늬 같은 가는 무늬가 점 잡음이 돼서 미리 뭉갬
  const BLUR = (window as unknown as { BLUR?: number }).BLUR ?? 0;
  if (BLUR) g.filter = `blur(${BLUR}px)`;
  g.drawImage(img, 0, 0);
  g.filter = "none";
  const d = g.getImageData(0, 0, cv.width, cv.height);
  const [th, ts, tl] = rgb2hsl(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
  const mk = new Uint8ClampedArray(d.data.length);
  for (let i = 0; i < d.data.length; i += 4) {
    mk[i + 3] = 255;
    const r = d.data[i] / 255, gg = d.data[i + 1] / 255, b = d.data[i + 2] / 255;
    const [h, s2, l] = rgb2hsl(r, gg, b);
    const w = smooth(190, 205, h) * (1 - smooth(245, 260, h)) * smooth(0.18, 0.4, s2) * smooth(0.04, 0.12, l) * (1 - smooth(0.88, 0.97, l));
    if (w <= 0) continue;
    mk[i] = mk[i + 1] = mk[i + 2] = Math.round(w * 255);
    const [nr, ng, nb] = hsl2rgb(th, Math.min(1, ts * Math.min(1.2, s2 / 0.85)), Math.min(1, tl * (l / 0.5)));
    d.data[i] = (r + (nr - r) * w) * 255; d.data[i + 1] = (gg + (ng - gg) * w) * 255; d.data[i + 2] = (b + (nb - b) * w) * 255;
  }
  // CEL: 텍스처 무늬 · 구운 명암 다 지우고 재질별 한 색으로 → 명암은 빛 단계만 (만화식 깔끔한 덩어리)
  if ((window as unknown as { CEL?: number }).CEL) {
    for (let i = 0; i < d.data.length; i += 4) {
      const r = d.data[i] / 255, gg = d.data[i + 1] / 255, b = d.data[i + 2] / 255;
      const [h, s2, l] = rgb2hsl(r, gg, b);
      let c: number[];
      if (mk[i] > 110) c = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
      else if (l < 0.2) c = [40, 40, 48];
      else if (s2 > 0.38 && (h < 14 || h > 330) && l > 0.22) c = [214, 40, 56];
      else if (s2 > 0.18 && h >= 14 && h < 48 && l > 0.32) c = [242, 190, 150];
      else if (l < 0.55 && s2 < 0.2) c = [120, 122, 134];
      else c = [240, 241, 247];
      d.data[i] = c[0]; d.data[i + 1] = c[1]; d.data[i + 2] = c[2];
    }
  }
  g.putImageData(d, 0, 0);
  if (maskOut) {
    const mc = document.createElement("canvas");
    mc.width = cv.width; mc.height = cv.height;
    mc.getContext("2d")!.putImageData(new ImageData(mk, cv.width, cv.height), 0, 0);
    const mt = new THREE.CanvasTexture(mc);
    mt.flipY = src.flipY;
    mt.colorSpace = THREE.SRGBColorSpace;
    maskOut.t = mt;
  }
  const t = new THREE.CanvasTexture(cv);
  t.flipY = src.flipY;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const bone = (root: THREE.Object3D, n: string) => {
  let b: THREE.Bone | null = null;
  root.traverse((o) => { if ((o as THREE.Bone).isBone && o.name.replace(":", "") === "mixamorig" + n) b = o as THREE.Bone; });
  return b as THREE.Bone | null;
};
const mapOf = (g: GLTF) => { let m: THREE.Texture | null = null; g.scene.traverse((o) => { const x = o as THREE.Mesh; if (x.isMesh) m = (x.material as THREE.MeshStandardMaterial).map; }); return m as unknown as THREE.Texture; };

async function main() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const MODEL = (window as unknown as { MODEL?: string }).MODEL ?? "fielder";
  const GLOVE = MODEL === "fielder";
  const [fd, fdMx, gl] = await Promise.all([MODEL, MODEL + "_mx", "glove"].map((n) => loader.loadAsync(`../f3d/models/${n}.glb`)));
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(CELL, CELL);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const CEL = (window as unknown as { CEL?: number }).CEL;
  scene.add(CEL ? new THREE.AmbientLight(0xffffff, 1.15) : new THREE.HemisphereLight(0xffffff, 0x6a7a5a, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, CEL ? 1.9 : 1.7);
  sun.position.set(-40, 80, 50);
  scene.add(sun);
  const grad = CEL
    ? new THREE.DataTexture(new Uint8Array([40, 120, 200, 255]), 4, 1, THREE.RedFormat)
    : new THREE.DataTexture(new Uint8Array([120, 200, 255]), 3, 1, THREE.RedFormat);
  grad.minFilter = grad.magFilter = THREE.NearestFilter;
  grad.needsUpdate = true;
  const TEAM = (window as unknown as { TEAM?: number }).TEAM ?? 0x8a8a8a;
  const mo: { t?: THREE.Texture } = {};
  const body = new THREE.MeshToonMaterial({ map: teamTexture(mapOf(fd), TEAM, mo), gradientMap: grad });
  const glove = new THREE.MeshToonMaterial({ map: mapOf(gl), gradientMap: grad });
  const maskBody = new THREE.MeshBasicMaterial({ map: mo.t! });
  const maskBlack = new THREE.MeshBasicMaterial({ color: 0x000000 });

  const root = SkeletonUtils.clone(fd.scene);
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = body; m.frustumCulled = false; } });
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3();
  root.traverse((x) => { const m = x as THREE.SkinnedMesh; if (m.isSkinnedMesh) { m.computeBoundingBox(); bb.union(m.boundingBox!.clone().applyMatrix4(m.matrixWorld)); } });
  root.scale.setScalar(1.75 / (bb.max.y - bb.min.y));
  scene.add(root);
  // 글러브 (왼손, 손가락 뼈 없으면 엄지 = 앞)
  const gloveMeshes: THREE.Mesh[] = [];
  const bodyMeshes: THREE.Mesh[] = [];
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) bodyMeshes.push(m); });
  if (GLOVE) {
    root.updateMatrixWorld(true);
    const hand = bone(root, "LeftHand")!;
    const wp = (b: THREE.Object3D) => b.getWorldPosition(new THREE.Vector3());
    const pW = wp(hand), pTip = wp(bone(root, "LeftHandMiddle4")!);
    const pT = pW.clone().add(new THREE.Vector3(0, 0, 1));
    const fing = pTip.clone().sub(pW).normalize();
    const th = pT.clone().sub(pW); th.sub(fing.clone().multiplyScalar(th.dot(fing))).normalize();
    const palm = new THREE.Vector3().crossVectors(fing, th).normalize();
    const gx = new THREE.Vector3().crossVectors(fing, palm).normalize();
    const handLen = pTip.distanceTo(pW);
    const g = gl.scene.clone();
    g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = glove; gloveMeshes.push(m); } });
    const gb = new THREE.Box3().setFromObject(g);
    const s = (handLen * 1.6) / (gb.max.y - gb.min.y);
    g.scale.setScalar(s);
    g.position.set(-((gb.min.x + gb.max.x) / 2) * s, -gb.min.y * s - 0.12 * handLen, -((gb.min.z + gb.max.z) / 2) * s);
    const holder = new THREE.Group();
    holder.add(g);
    const worldM = new THREE.Matrix4().makeTranslation(pW.x, pW.y, pW.z).multiply(new THREE.Matrix4().makeBasis(gx.clone().negate(), fing, palm.clone().negate()));
    hand.matrixWorld.clone().invert().multiply(worldM).decompose(holder.position, holder.quaternion, holder.scale);
    hand.add(holder);
    hand.scale.setScalar(0.3);
    holder.position.divideScalar(0.3);
    holder.scale.divideScalar(0.3);
  }
  const clips = new Map(fdMx.animations.map((c) => [c.name, c]));
  for (const c of clips.values()) for (const tr of c.tracks) if (/Hips\.position$/.test(tr.name)) { const v = tr.values; const x0 = v[0], z0 = v[2]; for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; } }
  const mixer = new THREE.AnimationMixer(root);

  const elev = ((window as unknown as { ELEV?: number }).ELEV ?? 25) * (Math.PI / 180);
  const cam = new THREE.OrthographicCamera(-VIEW_H / 2, VIEW_H / 2, VIEW_H / 2, -VIEW_H / 2, 0.1, 100);
  const C = new THREE.Vector3(0, 0.85, 0);
  cam.position.copy(C).add(new THREE.Vector3(0, Math.sin(elev), Math.cos(elev)).multiplyScalar(20));
  cam.lookAt(C);
  cam.updateMatrixWorld();
  const foot = new THREE.Vector3(0, 0, 0).project(cam);
  const anchor = [((foot.x + 1) / 2) * CELL, ((1 - foot.y) / 2) * CELL];

  type Job = { clip: string; n: number; t0?: number; t1?: number };
  const W = window as unknown as { bake: (jobs: Job[], dirs: number) => Record<string, { base: string[][]; mask: string[][] }>; keyTime: (clip: string, boneName: string, mode: string) => number[]; ready: boolean; anchor: number[]; clipNames: string[]; durs: Record<string, number> };
  W.durs = Object.fromEntries([...clips.values()].map((c) => [c.name, c.duration]));
  const findClip = (n: string) => clips.get(n) ?? [...clips.values()].find((c) => c.name.startsWith(n))!;
  /** 동작 안 핵심 순간: mode = high(손 가장 높음) · low(가장 낮음) · fast(손 가장 빠름, 앞 20% 빼고) · far(몸에서 가장 멂) · front(가장 앞) */
  W.keyTime = (clipName, boneName, mode) => {
    const clip = findClip(clipName);
    mixer.stopAllAction();
    mixer.clipAction(clip).play();
    const b = bone(root, boneName)!;
    let best = -1e9, bt = 0;
    let prev: THREE.Vector3 | null = null;
    root.rotation.y = 0;
    for (let s2 = 0; s2 <= clip.duration; s2 += 1 / 60) {
      mixer.setTime(s2);
      root.updateMatrixWorld(true);
      const v = b.getWorldPosition(new THREE.Vector3()).applyMatrix4(root.matrixWorld.clone().invert());
      let sc = -1e9;
      if (mode === "high") sc = v.y;
      else if (mode === "low") sc = -v.y;
      else if (mode === "fast") sc = prev && s2 > clip.duration * 0.2 ? v.distanceTo(prev) : -1e9;
      else if (mode === "far") sc = Math.hypot(v.x, v.z);
      else if (mode === "front") sc = v.z;
      prev = v;
      if (sc > best) { best = sc; bt = s2; }
    }
    return [bt, clip.duration];
  };
  W.anchor = anchor;
  W.clipNames = [...clips.keys()];
  W.bake = (jobs, dirs) => {
    const out: Record<string, { base: string[][]; mask: string[][] }> = {};
    for (const j of jobs) {
      const clip = findClip(j.clip);
      mixer.stopAllAction();
      const a = mixer.clipAction(clip);
      a.play();
      const t0 = j.t0 ?? 0, t1 = j.t1 ?? clip.duration;
      const rows: string[][] = [], mrows: string[][] = [];
      for (let d = 0; d < dirs; d++) {
        // d = 0: 화면 아래(카메라 쪽)를 봄, 시계 반대로 (화면 기준 오른쪽 = d 가 dirs/4)
        root.rotation.y = (d / dirs) * Math.PI * 2;
        const row: string[] = [], mrow: string[] = [];
        for (let i = 0; i < j.n; i++) {
          mixer.setTime(Math.min(clip.duration - 1e-3, t0 + ((t1 - t0) * i) / j.n));
          root.updateMatrixWorld(true);
          for (const m of bodyMeshes) m.material = body;
          for (const m of gloveMeshes) m.material = glove;
          renderer.render(scene, cam);
          row.push(renderer.domElement.toDataURL("image/png"));
          for (const m of bodyMeshes) m.material = maskBody;
          for (const m of gloveMeshes) m.material = maskBlack;
          renderer.render(scene, cam);
          mrow.push(renderer.domElement.toDataURL("image/png"));
        }
        rows.push(row);
        mrows.push(mrow);
      }
      out[j.clip] = { base: rows, mask: mrows };
    }
    return out;
  };
  W.ready = true;
}
main();
