/**
 * 경기 화면 3D (three.js): 타석 화면 · 수비 화면을 그림. 규칙 · 시간은 전부 Match 가 정하고, 여기는 그 상태를 받아 그대로 보여 주기만 함.
 *   타석: 2D 타석 카메라(view.ts CAM)와 같은 구도 — 홈 뒤 낮은 시점, 우타자는 화면 왼쪽에 크게. 타자 몸은 모션 캡처(믹사모) 스윙을
 *         Match 의 레그킥 · 스트라이드 · 스윙 시계에 맞춰 시간을 직접 정해 재생 (버튼 → 맞는 순간 SWING_HIT_T)
 *   수비: play.ts 시뮬 프레임(60장/초)을 그대로 — 수비수 · 주자 · 심판 · 공, 공을 뒤에서 따라가는 카메라
 * 공 · 존 · 컨택존 같은 표시는 2D 캔버스가 이 카메라로 투영해서(project) 위에 그림.
 * 좌표: 게임 (x 1루쪽, y 중견수쪽, h 위) → three (X = x, Y = h, Z = -y)
 */
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { BASES, HOME_POS, type FieldOut, type Frame } from "@/lib/baseball/play";
import { PITCH_RELEASE_T, SWING_HIT_T } from "@/lib/baseball/figures";
import { KICK_DOWN_T, KICK_STEP_T, LIFT_AT, LIFT_TOTAL, RETURN_T, strideProg } from "@/lib/baseball/batterSprite";
import { buildStadium, V } from "./stadium";

/** 디자인 화면 (Stage 1024 × 576) */
const DW = 1024, DH = 576;

/** 타석 화면에 넘겨 받는 것 (Match 가 매 프레임) */
export interface BatView3D {
  lefty: boolean;
  pitLefty: boolean;
  /** 타자 동작: 대기 · 레그킥(load 시계) · 스윙(버튼 뒤 시간, sp = 누를 때 스트라이드 진행도) · 번트 */
  bat: { anim: "idle" | "load" | "swing" | "bunt"; t: number; sp: number; strideAt: number };
  /** 타석 들어서기 연출 진행도 0 ~ 1 (null = 아님) */
  walk: number | null;
  /** 투구 동작 시계 (공 놓기 = PITCH_RELEASE_T) */
  pit: { throwing: boolean; t: number };
  /** 컨택존을 옮긴 만큼 타자도 (게임 m: x 옆 · z 투수 쪽) */
  shift: { x: number; z: number };
  /** 1 · 2 · 3루 주자 */
  runners: [boolean, boolean, boolean];
  /** 팀 색 (수비 · 공격) */
  colors: { field: string; bat: string };
  night: boolean;
}
export interface FieldView3D {
  out: FieldOut;
  t: number;
  colors: { field: string; bat: string };
  /** 홈런더비: 수비 없이 공만 */
  ballOnly: boolean;
  night: boolean;
}

export interface World3D {
  canvas: HTMLCanvasElement;
  setSize(cssW: number, cssH: number, pixelRatio: number): void;
  batting(v: BatView3D, dt: number): void;
  field(v: FieldView3D, dt: number): void;
  render(): void;
  /** 타석 화면: 게임 좌표(x 옆, y 높이, z 홈에서 투수 쪽) → 디자인 화면 px · s = 그 거리에서 1m 가 몇 px */
  project(x: number, y: number, z: number): { x: number; y: number; s: number };
  /** 수비 화면: 월드 좌표(x, y 경기장, h 높이) → 디자인 화면 px */
  projectField(x: number, y: number, h: number): { x: number; y: number; s: number };
  /** 타석 화면: 홈플레이트 면(z 0)의 화면 px → 게임 (x 옆, y 높이) */
  unprojectPlate(sx: number, sy: number): { x: number; y: number };
  /** 투수 손 (공 놓는 순간 자리) 화면 위치 */
  pitcherHand(): { x: number; y: number };
  dispose(): void;
}

// ───────── 타석 화면 상수 ─────────
/** 타자 자리 (우타 -x · 좌타 +x) */
const BAT_X = 1.05;
/**
 * 타석 카메라: 2D 타석 화면(view.ts CAM)과 같은 구도 — 세로 화각 45.4°, 투수판 땅이 화면 59% 높이,
 * 타자는 화면 폭 23%(좌타는 77%)에 발끝 93% ~ 머리 10% 로 크게. (타자 키 1.75m 에 맞춰 높이 0.83m · 홈 뒤 2.59m · 2° 올려 봄으로 풂)
 */
const BATCAM = { pos: new THREE.Vector3(0, 0.83, 2.59), look: new THREE.Vector3(0, 0.83 + 10 * Math.tan((2.04 * Math.PI) / 180), 2.59 - 10), fov: 45.4 };
/**
 * 공 · 존 높이: 게임 높이(2.5등신 2D 기준 — 존 0.47 ~ 0.9m) → 3D 타자(1.75m) 몸에 맞춘 높이. 존 아래 끝 = 무릎(0.5m), 위 끝 = 가슴(1.12m).
 * 땅(0)은 그대로 땅
 */
const ballH = (y: number) => (y < 0.47 ? y * (0.5 / 0.47) : 0.5 + (y - 0.47) * 1.44);
const gameH = (h: number) => (h < 0.5 ? h * (0.47 / 0.5) : 0.47 + (h - 0.5) / 1.44);
/** 타석 화면 수비 자리 (match.ts FIELDER_SPOT 과 같음) · 루상 주자 리드 자리 */
const FIELDER_SPOT: [number, number][] = [[0, 18.4], [0, -1.6], [18.5, 28.5], [10.5, 40.5], [-16, 24.5], [-8, 42], [-29, 76], [2.5, 95], [33.5, 82]];
const RUNNER_SPOT: [number, number][] = [[16.9, 21.9], [-2.9, 35.9], [-18.6, 17]];
/** 믹사모 Baseball Strike: 다리 들기 · 스윙 · 팔로스루까지 한 동작 */
const MXSW = "mx_strike";
/** 번트 자세 (mx_bunt 에서 방망이를 앞으로 내민 순간) */
const BUNT_T = 0.95;

const smooth = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// ───────── 재질 ─────────
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
/** 유니폼 파랑 자리 → 팀 색. sRGB 그대로 HSL 계산, 경계는 부드럽게 섞어서 얼룩 · 점이 안 생기게 */
function teamTexture(src: THREE.Texture, hex: number) {
  const img = src.image as HTMLImageElement | ImageBitmap;
  const cv = document.createElement("canvas");
  cv.width = img.width;
  cv.height = img.height;
  const g = cv.getContext("2d")!;
  g.drawImage(img as CanvasImageSource, 0, 0);
  const d = g.getImageData(0, 0, cv.width, cv.height);
  const [th, ts, tl] = rgb2hsl(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
  for (let i = 0; i < d.data.length; i += 4) {
    const r = d.data[i] / 255, gg = d.data[i + 1] / 255, b = d.data[i + 2] / 255;
    const [h, s2, l] = rgb2hsl(r, gg, b);
    const w = smooth(190, 205, h) * (1 - smooth(245, 260, h)) * smooth(0.18, 0.4, s2) * smooth(0.04, 0.12, l) * (1 - smooth(0.88, 0.97, l));
    if (w <= 0) continue;
    const [nr, ng, nb] = hsl2rgb(th, Math.min(1, ts * Math.min(1.2, s2 / 0.85)), Math.min(1, tl * (l / 0.5)));
    d.data[i] = (r + (nr - r) * w) * 255;
    d.data[i + 1] = (gg + (ng - gg) * w) * 255;
    d.data[i + 2] = (b + (nb - b) * w) * 255;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.flipY = src.flipY;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
/** 테두리 빛: 몸 가장자리(법선이 옆을 볼수록)를 살짝 밝혀 배경에서 떠 보이게 */
function rimify<T extends THREE.Material>(m: T, k = 0.32): T {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <opaque_fragment>",
      `{ float fr = 1.0 - max(dot(normal, normalize(vViewPosition)), 0.0);
         outgoingLight += vec3(1.0, 0.96, 0.88) * ${k.toFixed(2)} * smoothstep(0.55, 0.95, fr) * (0.55 + 0.45 * max(normal.y, 0.0)); }
       #include <opaque_fragment>`,
    );
  };
  return m;
}

// ───────── 모션 ─────────
/** 글로 만든 모션(AI)은 프레임마다 미세하게 떨림 → 앞뒤 프레임 평균으로 부드럽게 */
function smoothClip(c: THREE.AnimationClip, w = 3) {
  for (const tr of c.tracks) {
    const v = tr.values, n = tr.times.length;
    if (n < 5) continue;
    const st = v.length / n;
    const src = Float32Array.from(v);
    for (let i = 0; i < n; i++) {
      const acc = new Float64Array(st);
      let tot = 0;
      for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) {
        const wt = w + 1 - Math.abs(j - i);
        let sign = 1;
        if (st === 4) { let d = 0; for (let k = 0; k < 4; k++) d += src[j * 4 + k] * src[i * 4 + k]; if (d < 0) sign = -1; }
        for (let k = 0; k < st; k++) acc[k] += src[j * st + k] * wt * sign;
        tot += wt;
      }
      let len = 0;
      for (let k = 0; k < st; k++) { acc[k] /= tot; len += acc[k] * acc[k]; }
      if (st === 4) { len = Math.sqrt(len) || 1; for (let k = 0; k < 4; k++) acc[k] /= len; }
      for (let k = 0; k < st; k++) v[i * st + k] = acc[k];
    }
  }
}
/** 엉덩이 앞뒤 · 좌우 이동은 제자리로 (위치는 시뮬이 정함) — 타격 모션(mx_)만 몸 이동 그대로 */
function clipsOf(anims: THREE.AnimationClip[]) {
  const m = new Map<string, THREE.AnimationClip>();
  for (const c of anims) {
    for (const tr of c.tracks) {
      if (/Hips\.position$/.test(tr.name) && !c.name.startsWith("mx_")) {
        const v = tr.values;
        const x0 = v[0], z0 = v[2];
        for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
      }
    }
    if (c.name.startsWith("_")) smoothClip(c);
    m.set(c.name, c);
  }
  return m;
}
function bone(root: THREE.Object3D, n: string) {
  let b: THREE.Bone | null = null;
  root.traverse((o) => { if ((o as THREE.Bone).isBone && o.name.replace(":", "") === "mixamorig" + n) b = o as THREE.Bone; });
  return b as THREE.Bone | null;
}
function heightScale(o: THREE.Object3D, h: number) {
  const bb = new THREE.Box3();
  o.updateMatrixWorld(true);
  o.traverse((x) => { const m = x as THREE.SkinnedMesh; if (m.isSkinnedMesh) { m.computeBoundingBox(); bb.union(m.boundingBox!.clone().applyMatrix4(m.matrixWorld)); } });
  return h / (bb.max.y - bb.min.y);
}

interface Player {
  skip?: number; culled?: boolean;
  parts: THREE.Object3D[]; outlines: THREE.Object3D[];
  clips: Map<string, THREE.AnimationClip>;
  lod: { hi: THREE.Object3D[]; lo: THREE.Object3D[]; useLo: boolean };
  root: THREE.Object3D; mixer: THREE.AnimationMixer; cur: string; act: THREE.AnimationAction | null;
  hand: THREE.Bone | null; pocket: THREE.Object3D | null; rhand: THREE.Bone;
  /** 몸 재질 (팀 색 바꿀 때) */
  mats: { hi: THREE.MeshToonMaterial; lo: THREE.MeshToonMaterial | null };
}
interface BatRig {
  p: Player; g: THREE.Group; L: THREE.Bone; R: THREE.Bone; Lm: THREE.Bone; Rm: THREE.Bone; q: THREE.Quaternion;
  grip: { L: [THREE.Vector3, THREE.Vector3]; R: [THREE.Vector3, THREE.Vector3] };
  signs: Map<string, Int8Array>;
}

export async function createWorld3D(base = "/baseball/3d"): Promise<World3D> {
  // ───────── 렌더러 · 장면 ─────────
  const renderer = new THREE.WebGLRenderer({ antialias: (window.devicePixelRatio || 1) <= 1, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b5e0);
  scene.fog = new THREE.Fog(0xbfe3f7, 220, 520);
  const camera = new THREE.PerspectiveCamera(BATCAM.fov, DW / DH, 0.3, 900);
  const hemi = new THREE.HemisphereLight(0xdfeeff, 0x4a6b3a, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-60, 120, 40);
  scene.add(sun);
  const texLoader = new THREE.TextureLoader();
  const texUrl = (n: string) => `${base}/tex/${n}.webp`;
  const tex = (n: string, opt: { repeat?: boolean; mirrorU?: boolean; srgb?: boolean } = {}) => {
    const t = texLoader.load(texUrl(n));
    if (opt.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
    if (opt.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (opt.mirrorU) t.wrapS = THREE.MirroredRepeatWrapping;
    t.anisotropy = 4;
    return t;
  };
  const stadium = buildStadium(scene, tex, texUrl, hemi, sun);
  let night = false;

  // ───────── 모델 ─────────
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const load = (n: string) => loader.loadAsync(`${base}/models/${n}.glb`);
  const [btG, btLoG, btMxG, fdG, fdLoG, fdMxG, umpG, gg, capG, mittG, cmaskG, chestG, dugoutG, batG] = (await Promise.all(
    ["batter", "batter_lo", "batter_mx", "fielder", "fielder_lo", "fielder_mx", "umpire", "glove", "cap", "mitt", "cmask", "chest", "dugout", "bat"].map(load),
  )) as GLTF[];

  const grad = (() => {
    const t = new THREE.DataTexture(new Uint8Array([110, 185, 255]), 3, 1, THREE.RedFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  })();
  /** 외곽선: 뒷면만 그리는 검은 껍데기를 법선 방향으로 부풀림 (화면 기준 두께, 멀면 가늘어지다 없어짐) */
  const outlineMat = new THREE.ShaderMaterial({
    uniforms: { uW: { value: 0.0021 }, uC: { value: new THREE.Color(0x1d1712) } },
    side: THREE.BackSide,
    vertexShader: `
      #include <common>
      #include <skinning_pars_vertex>
      uniform float uW;
      void main() {
        #include <beginnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
        vec3 n = normalize(normalMatrix * objectNormal);
        float d = -mv.z;
        mv.xyz += n * min(uW * d, 0.014) * clamp((50.0 - d) / 25.0, 0.0, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uC; void main() { gl_FragColor = vec4(uC, 1.0); }`,
  });
  const propMap = (g: GLTF) => {
    let map: THREE.Texture | null = null;
    g.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) map = (m.material as THREE.MeshStandardMaterial).map; });
    return map as unknown as THREE.Texture;
  };
  const flatMat = (hex: number) => rimify(new THREE.MeshToonMaterial({ color: hex, gradientMap: grad, side: THREE.DoubleSide }));
  /** 소품: 정점 색으로 구운 것은 정점 색, 아니면 텍스처 */
  const propMat = (g: GLTF) => {
    let vc = false;
    g.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { if (m.geometry.getAttribute("color")) vc = true; if (!m.geometry.getAttribute("normal")) m.geometry.computeVertexNormals(); } });
    return rimify(new THREE.MeshToonMaterial(vc ? { vertexColors: true, gradientMap: grad, side: THREE.DoubleSide } : { map: propMap(g), gradientMap: grad, side: THREE.DoubleSide }));
  };
  const mittMat = propMat(mittG), cmaskMat = propMat(cmaskG), chestMat = propMat(chestG);
  const gloveMat = rimify(new THREE.MeshToonMaterial({ map: propMap(gg), gradientMap: grad }));
  const umpMat = rimify(new THREE.MeshToonMaterial({ map: propMap(umpG), gradientMap: grad }));
  const umpCapMat = flatMat(0x1c2236);
  /** 팀 색 몸 재질 (색마다 한 번만 만듦) */
  const bodyCache = new Map<string, THREE.MeshToonMaterial>();
  const teamBody = (g: GLTF, key: string, hex: number) => {
    const k = key + hex;
    let m = bodyCache.get(k);
    if (!m) {
      m = rimify(new THREE.MeshToonMaterial({ map: teamTexture(propMap(g), hex), gradientMap: grad }));
      bodyCache.set(k, m);
    }
    return m;
  };
  propMap(btG).anisotropy = 8;
  propMap(fdG).anisotropy = 8;

  // 덕아웃: 1 · 3루 쪽 파울 지역 끝, 절반쯤 땅에 묻고 경기장 쪽을 봄
  {
    const dg = dugoutG.scene;
    const dm = propMat(dugoutG);
    dg.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.material = dm; });
    const b = new THREE.Box3().setFromObject(dg);
    const k = 13 / (b.max.x - b.min.x);
    for (const sx of [1, -1]) {
      const d = dg.clone();
      d.scale.setScalar(k);
      const c = b.getCenter(new THREE.Vector3());
      const g = new THREE.Group();
      d.position.set(-c.x * k, -b.min.y * k - 1.1, -c.z * k);
      g.add(d);
      const [x, y] = [sx * 36, -11.5];
      g.position.copy(V(x, y));
      g.rotation.y = Math.atan2(0 - x, -(30 - y));
      scene.add(g);
    }
  }

  // 모션 목록
  const btClips = clipsOf(btG.animations);
  {
    const ai = [...btClips.keys()].filter((k) => k.startsWith("_"));
    const AIN: Record<string, string> = { _01a18726: "slide_head", _01a1872d: "hr_trot" };
    for (const id of ai) { const n = AIN[id.slice(0, 9)]; if (n) btClips.set(n, btClips.get(id)!); }
    for (const [k, c] of clipsOf(btMxG.animations)) btClips.set(k, c);
    // 믹사모 모션이 있으면 그걸 우선
    const MXA: Record<string, string> = { Running: "m_run", RunFast: "m_sprint", hr_trot: "m_jog", slide_light: "m_slide", slide_head: "m_dive", Idle_02: "m_idle", Idle_03: "m_idle", Cheer_with_Both_Hands: "m_cheer" };
    for (const [k, v] of Object.entries(MXA)) if (btClips.has(v)) btClips.set(k, btClips.get(v)!);
  }
  const B_NAMES = ["catch_squat", "catch_toss", "catch_throw2b", "inf_throw", "dive_left", "slide_head", "first_stretch", "pitch_set", "catch_receive", "dive_right", "hr_trot"];
  const fdClips = clipsOf(fdMxG.animations);
  for (const n of B_NAMES) if (fdClips.has("_" + n)) fdClips.set(n, fdClips.get("_" + n)!);
  {
    const MXA: Record<string, string> = { Running: "m_run", RunFast: "m_sprint", Idle_02: "m_idle", Cheer_with_Both_Hands: "m_cheer" };
    for (const [k, v] of Object.entries(MXA)) if (fdClips.has(v)) fdClips.set(k, fdClips.get(v)!);
  }
  const umpClips = clipsOf(umpG.animations);
  // 심판 모션: 직접 만든 4개는 아이디 순 = 스트라이크 · 세이프 · 아웃 · 앉아 대기
  const umpAI = [...umpClips.keys()].filter((k) => k.startsWith("_")).sort();
  const UCLIP = { strike: umpAI[0], safe: umpAI[1], out: umpAI[2], crouch: umpAI[3], idle: "Idle_02" };
  const fdKeys = [...fdClips.keys()];
  const CLIP = {
    run: "Running", sprint: "RunFast", idle: "Idle_02",
    ready: fdKeys.find((k) => k.startsWith("_01a18653")) ?? "Idle_02",
    fly: fdKeys.find((k) => k.startsWith("_01a1868f")) ?? "Leap_Right_and_Catch",
    throw: fdClips.has("inf_throw") ? "inf_throw" : "Grip_and_Throw_Down",
    pick: "Male_Run_Forward_Pick_Up_Left",
    cthrow: fdClips.has("catch_throw2b") ? "catch_throw2b" : "Grip_and_Throw_Down",
    squat: fdClips.has("catch_squat") ? "catch_squat" : "Idle_02",
    diveL: "dive_left", diveR: "dive_right", stretch: "first_stretch",
    pitch: fdClips.has("baseball_pitching") ? "baseball_pitching" : "Idle_02",
  };
  const PLAYER_H = 1.75;
  const btScale = heightScale(btG.scene, PLAYER_H);
  const fdScale = heightScale(fdG.scene, PLAYER_H);
  const umpScale = heightScale(umpG.scene, PLAYER_H * 1.04);

  // ───────── 선수 만들기 ─────────
  const HS = 0.3; // 글러브 낀 손은 작게 (글러브 속으로 숨김)
  function addOutline(root: THREE.Object3D) {
    const ms: THREE.Mesh[] = [];
    root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !m.userData.outline) ms.push(m); });
    for (const m of ms) {
      const o = m.clone() as THREE.Mesh;
      o.material = outlineMat;
      o.userData.outline = true;
      o.frustumCulled = false;
      m.parent!.add(o);
    }
  }
  /** 머리에 모자 · 마스크 씌우기 (머리 뼈에 붙은 정점으로 머리 크기를 재서 맞춤) */
  function fitHat(root: THREE.Object3D, prop: THREE.Object3D, mat: THREE.Material, kind: "cap" | "mask") {
    root.updateMatrixWorld(true);
    const head = bone(root, "Head")!;
    let sk: THREE.SkinnedMesh | null = null;
    root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) sk = o as THREE.SkinnedMesh; });
    const skin = sk as unknown as THREE.SkinnedMesh;
    skin.skeleton.update();
    const hi = skin.skeleton.bones.indexOf(head);
    const si = skin.geometry.getAttribute("skinIndex") as THREE.BufferAttribute, sw = skin.geometry.getAttribute("skinWeight") as THREE.BufferAttribute;
    const hb = new THREE.Box3();
    const v = new THREE.Vector3();
    const hv: THREE.Vector3[] = [];
    for (let i = 0; i < si.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === hi) w += sw.getComponent(i, k);
      if (w < 0.6) continue;
      skin.getVertexPosition(i, v);
      hb.expandByPoint(v.applyMatrix4(skin.matrixWorld));
      hv.push(v.clone());
    }
    const hs = hb.getSize(new THREE.Vector3());
    const p = prop.clone();
    p.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.material = mat; });
    p.updateMatrixWorld(true);
    const pts: THREE.Vector3[] = [];
    p.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.getAttribute("position");
      for (let i = 0; i < pos.count; i += 3) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
    });
    const pb = new THREE.Box3().setFromPoints(pts);
    const H = pb.max.y - pb.min.y;
    const top = pts.filter((q) => q.y > pb.max.y - H * 0.35);
    const cx = top.reduce((a, q) => a + q.x, 0) / top.length, cz = top.reduce((a, q) => a + q.z, 0) / top.length;
    let far = 0, dir = new THREE.Vector2(0, 1);
    for (const q of pts) if (q.y < pb.min.y + H * 0.45) { const d = Math.hypot(q.x - cx, q.z - cz); if (d > far) { far = d; dir = new THREE.Vector2(q.x - cx, q.z - cz).normalize(); } }
    if (kind === "mask") dir = new THREE.Vector2(0, 1);
    const yaw = -Math.atan2(dir.x, dir.y);
    const inner = new THREE.Group();
    p.position.set(-cx, 0, -cz);
    const spin = new THREE.Group();
    spin.add(p);
    spin.rotation.y = yaw;
    inner.add(spin);
    inner.updateMatrixWorld(true);
    const rot = (q: THREE.Vector3) => q.clone().sub(new THREE.Vector3(cx, 0, cz)).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const skull = hv.filter((q) => q.y > hb.max.y - hs.y * 0.4);
    const sb = new THREE.Box3().setFromPoints(skull.length ? skull : [hb.min, hb.max]);
    const sW = sb.max.x - sb.min.x, sD = sb.max.z - sb.min.z, sc = sb.getCenter(new THREE.Vector3());
    const rp = pts.map(rot);
    const ob = new THREE.Box3();
    for (const q of rp) if (q.y < pb.min.y + H * 0.3) ob.expandByPoint(q);
    const full = new THREE.Box3().setFromPoints(rp);
    const depth = hs.y * (kind === "mask" ? 0.95 : 0.27);
    const fitW = kind === "mask" ? hs.x * 1.14 : sW * 1.1;
    const k = Math.max(fitW / (ob.max.x - ob.min.x), depth / (H * 0.94));
    inner.scale.setScalar(k);
    if (kind === "mask") inner.scale.z = Math.min(k, (hs.z * 1.35) / (full.max.z - full.min.z));
    const holder = new THREE.Group();
    holder.add(inner);
    const y0 = hb.max.y - pb.max.y * k + H * k * 0.06;
    const z0 = kind === "mask" ? hb.min.z - 0.01 - full.min.z * inner.scale.z : sc.z + sD * 0.02;
    holder.position.set(sc.x, y0, z0);
    holder.updateMatrixWorld(true);
    const local = head.matrixWorld.clone().invert().multiply(holder.matrixWorld);
    const out = new THREE.Group();
    local.decompose(out.position, out.quaternion, out.scale);
    inner.parent = null;
    out.add(inner);
    head.add(out);
  }
  /** 포수 가슴 보호대: 어깨 폭에 맞춰 몸통(Spine2) 앞에 붙임 */
  function fitChest(root: THREE.Object3D, prop: THREE.Object3D, mat: THREE.Material) {
    root.updateMatrixWorld(true);
    const sp = bone(root, "Spine2")!;
    const wp = (n: string) => bone(root, n)!.getWorldPosition(new THREE.Vector3());
    const lA = wp("LeftArm"), rA = wp("RightArm"), hips = wp("Hips");
    let sk: THREE.SkinnedMesh | null = null;
    root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !sk) sk = o as THREE.SkinnedMesh; });
    const skin = sk as unknown as THREE.SkinnedMesh;
    skin.skeleton.update();
    const ids = ["Spine1", "Spine2"].map((n) => skin.skeleton.bones.indexOf(bone(root, n)!));
    const si = skin.geometry.getAttribute("skinIndex") as THREE.BufferAttribute, sw = skin.geometry.getAttribute("skinWeight") as THREE.BufferAttribute;
    const tb = new THREE.Box3(), v = new THREE.Vector3();
    for (let i = 0; i < si.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (ids.includes(si.getComponent(i, k))) w += sw.getComponent(i, k);
      if (w < 0.5) continue;
      skin.getVertexPosition(i, v);
      tb.expandByPoint(v.applyMatrix4(skin.matrixWorld));
    }
    const p = prop.clone();
    p.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.material = mat; });
    const pb = new THREE.Box3().setFromObject(p);
    const width = lA.distanceTo(rA) * 1.05;
    const k = width / (pb.max.x - pb.min.x);
    p.scale.setScalar(k);
    const top = Math.max(lA.y, rA.y) + width * 0.08;
    const height = (pb.max.y - pb.min.y) * k;
    const holder = new THREE.Group();
    holder.add(p);
    p.position.set(-((pb.min.x + pb.max.x) / 2) * k, -pb.max.y * k, -pb.min.z * k);
    holder.position.set((lA.x + rA.x) / 2, Math.max(top, hips.y + height * 0.9), tb.max.z + 0.03 - (pb.max.z - pb.min.z) * k);
    holder.updateMatrixWorld(true);
    const local = sp.matrixWorld.clone().invert().multiply(holder.matrixWorld);
    const out = new THREE.Group();
    local.decompose(out.position, out.quaternion, out.scale);
    holder.parent = null;
    p.parent = null;
    out.add(p);
    sp.add(out);
  }
  /** 왼손에 글러브 · 미트: 손가락 방향 · 손바닥 방향으로 주머니가 손바닥 쪽에 오게 */
  function fitGlove(root: THREE.Object3D, mitt: boolean) {
    root.updateMatrixWorld(true);
    const hand = bone(root, "LeftHand")!;
    const wp = (b: THREE.Object3D) => b.getWorldPosition(new THREE.Vector3());
    const m1 = bone(root, "LeftHandMiddle1"), t1 = bone(root, "LeftHandThumb1");
    const pW = wp(hand), pTip = wp(bone(root, "LeftHandMiddle4")!);
    const pM = m1 ? wp(m1) : pTip;
    // 손가락 뼈 없는 뼈대: T자에서 엄지는 앞(+Z) 쪽
    const pT = t1 ? wp(t1) : pW.clone().add(new THREE.Vector3(0, 0, 1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())));
    const fing = pM.clone().sub(pW).normalize();
    const th = pT.clone().sub(pW);
    th.sub(fing.clone().multiplyScalar(th.dot(fing))).normalize();
    const palm = new THREE.Vector3().crossVectors(fing, th).normalize();
    const gx = new THREE.Vector3().crossVectors(fing, palm).normalize();
    const handLen = pTip.distanceTo(pW);
    const gl = (mitt ? mittG : gg).scene.clone();
    gl.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.material = mitt ? mittMat : gloveMat; });
    const gb = new THREE.Box3().setFromObject(gl);
    const s = (handLen * (mitt ? 1.5 : 1.6)) / (gb.max.y - gb.min.y);
    gl.scale.setScalar(s);
    gl.position.set(-((gb.min.x + gb.max.x) / 2) * s, -gb.min.y * s - 0.12 * handLen, -((gb.min.z + gb.max.z) / 2) * s);
    const holder = new THREE.Group();
    holder.add(gl);
    const pocket = new THREE.Object3D();
    pocket.position.set(0, ((gb.max.y - gb.min.y) / 2) * s - 0.12 * handLen, 0);
    holder.add(pocket);
    const worldM = new THREE.Matrix4().makeTranslation(pW.x, pW.y, pW.z).multiply(new THREE.Matrix4().makeBasis(gx.clone().negate(), fing, palm.clone().negate()));
    const local = hand.matrixWorld.clone().invert().multiply(worldM);
    local.decompose(holder.position, holder.quaternion, holder.scale);
    hand.add(holder);
    hand.scale.setScalar(HS);
    holder.position.divideScalar(HS);
    holder.scale.divideScalar(HS);
    return { hand, pocket };
  }
  function makePlayer(src: GLTF, mat: THREE.MeshToonMaterial, clipMap: Map<string, THREE.AnimationClip>, scale: number, opt: { glove?: boolean; mitt?: boolean; chest?: boolean; cap?: THREE.Material; mask?: boolean; lo?: GLTF; loMat?: THREE.MeshToonMaterial } = {}): Player {
    const root = SkeletonUtils.clone(src.scene);
    root.scale.setScalar(scale);
    root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = mat; m.frustumCulled = false; } });
    scene.add(root);
    const mixer = new THREE.AnimationMixer(root);
    if (opt.cap) fitHat(root, capG.scene, opt.cap, "cap");
    if (opt.mask) fitHat(root, cmaskG.scene, cmaskMat, "mask");
    if (opt.chest) fitChest(root, chestG.scene, chestMat);
    let hand: THREE.Bone | null = null, pocket: THREE.Object3D | null = null;
    if (opt.glove) ({ hand, pocket } = fitGlove(root, !!opt.mitt));
    // 멀리용 가벼운 몸: 뼈 순서는 같고 묶음 자세가 조금 달라 그 몸의 역행렬을 씀
    if (opt.lo) {
      let lsk: THREE.SkinnedMesh | null = null;
      opt.lo.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) lsk = o as THREE.SkinnedMesh; });
      const ls = lsk as unknown as THREE.SkinnedMesh;
      root.traverse((o) => {
        const hm = o as THREE.SkinnedMesh;
        if (!hm.isSkinnedMesh || hm.userData.lod) return;
        hm.userData.lod = "hi";
        const lm = new THREE.SkinnedMesh(ls.geometry, opt.loMat ?? mat);
        lm.position.copy(ls.position); lm.quaternion.copy(ls.quaternion); lm.scale.copy(ls.scale);
        lm.bind(new THREE.Skeleton(hm.skeleton.bones, ls.skeleton.boneInverses.map((m) => m.clone())), ls.bindMatrix.clone());
        lm.frustumCulled = false;
        lm.userData.lod = "lo";
        lm.visible = false;
        hm.parent!.add(lm);
      });
    }
    addOutline(root);
    const lod = { hi: [] as THREE.Object3D[], lo: [] as THREE.Object3D[], useLo: false };
    root.traverse((o) => { if (o.userData.lod === "hi") lod.hi.push(o); else if (o.userData.lod === "lo") lod.lo.push(o); });
    const parts: THREE.Object3D[] = [], outlines: THREE.Object3D[] = [];
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o.userData.outline ? outlines : parts).push(o); });
    const p: Player = { parts, outlines, clips: clipMap, lod, root, mixer, cur: "", act: null, hand, pocket, rhand: bone(root, "RightHand")!, mats: { hi: mat, lo: opt.loMat ?? null } };
    return p;
  }
  function play(p: Player, name: string, opt: { once?: boolean; fade?: number; speed?: number; from?: number } = {}) {
    const clip = p.clips.get(name);
    if (!clip) return;
    if (p.cur === name && !opt.once) {
      if (p.act && opt.speed) p.act.timeScale = opt.speed;
      return;
    }
    const a = p.mixer.clipAction(clip);
    a.reset();
    a.setLoop(opt.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = !!opt.once;
    a.timeScale = opt.speed ?? 1;
    if (opt.from) a.time = opt.from;
    a.play();
    if (p.act && p.act !== a) p.act.crossFadeTo(a, opt.fade ?? 0.18, false);
    p.act = a;
    p.cur = name;
  }
  /** 팀 색 입히기 (바뀔 때만) */
  function setTeam(p: Player, src: GLTF, lo: GLTF, key: string, color: string) {
    const hex = new THREE.Color(color).getHex();
    const hi = teamBody(src, key, hex), lm = teamBody(lo, key + "lo", hex);
    if (p.mats.hi === hi) return;
    p.mats.hi = hi;
    p.mats.lo = lm;
    p.root.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh || m.userData.outline) return; if (m.userData.lod === "hi") m.material = hi; else if (m.userData.lod === "lo") m.material = lm; });
  }

  const defFd = teamBody(fdG, "fd", 0xd62828), defFdLo = teamBody(fdLoG, "fdlo", 0xd62828);
  const defBt = teamBody(btG, "bt", 0x1e5bff), defBtLo = teamBody(btLoG, "btlo", 0x1e5bff);
  const makeFielder = (catcher = false) => {
    const p = makePlayer(fdG, defFd, fdClips, fdScale, { glove: true, mitt: catcher, chest: catcher, mask: catcher, lo: fdLoG, loMat: defFdLo });
    play(p, catcher ? CLIP.squat : CLIP.ready, { fade: 0 });
    return p;
  };
  const makeBatter = () => {
    const p = makePlayer(btG, defBt, btClips, btScale, { lo: btLoG, loMat: defBtLo });
    play(p, "mx_idle", { fade: 0 });
    return p;
  };
  const fielders = HOME_POS.map((_, i) => makeFielder(i === 1));
  const runnerPool: Player[] = [0, 1, 2, 3].map(() => makeBatter());
  const batterP = makeBatter();
  const UMP_POS: [number, number][] = [[0, -3.4], [23.5, 15.5], [-7, 45], [-23.5, 15.5]];
  const umps = UMP_POS.map(([x, y]) => {
    const p = makePlayer(umpG, umpMat as THREE.MeshToonMaterial, umpClips, umpScale, { cap: umpCapMat });
    p.root.position.copy(V(x, y));
    p.root.rotation.y = Math.atan2(0 - x, -(30 - y));
    play(p, UCLIP.idle, { fade: 0 });
    return p;
  });
  function umpCall(x: number, y: number, kind: "out" | "safe") {
    let bi = 0, bd = 1e9;
    UMP_POS.forEach(([ux, uy], i) => { const d = Math.hypot(ux - x, uy - y); if (d < bd) { bd = d; bi = i; } });
    const u = umps[bi];
    u.root.rotation.y = Math.atan2(x - UMP_POS[bi][0], -(y - UMP_POS[bi][1]));
    play(u, kind === "out" ? UCLIP.out : UCLIP.safe, { once: true, fade: 0.1 });
  }

  // ───────── 동작 안 핵심 순간 (모델이 바뀌어도 자동) ─────────
  function keyTime(p: Player, clipName: string, boneName: string, score: (v: THREE.Vector3, prev: THREE.Vector3, s: number) => number) {
    const clip = p.clips.get(clipName);
    if (!clip) return { k: 0, dur: 1 };
    const b = bone(p.root, boneName)!;
    const m = new THREE.AnimationMixer(p.root);
    m.clipAction(clip).play();
    let best = -1e9, bt = 0;
    const inv = new THREE.Matrix4();
    let prev = new THREE.Vector3();
    for (let s = 0; s <= clip.duration; s += 1 / 60) {
      m.setTime(s);
      p.root.updateMatrixWorld(true);
      inv.copy(p.root.matrixWorld).invert();
      const v = b.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
      const sc = s === 0 ? -1e9 : score(v, prev, s);
      prev = v;
      if (sc > best) { best = sc; bt = s; }
    }
    m.stopAllAction();
    m.uncacheRoot(p.root);
    return { k: bt, dur: clip.duration };
  }
  const F0 = fielders[0];
  const dur = (n: string) => fdClips.get(n)?.duration ?? 1;
  const KEY = {
    fly: keyTime(F0, CLIP.fly, "LeftHand", (v) => v.y),
    throw: keyTime(F0, CLIP.throw, "RightHand", (v, p, s) => (s < dur(CLIP.throw) * 0.2 ? -1e9 : v.distanceTo(p))),
    cthrow: keyTime(F0, CLIP.cthrow, "RightHand", (v, p, s) => (s < dur(CLIP.cthrow) * 0.2 ? -1e9 : v.distanceTo(p))),
    pick: keyTime(F0, CLIP.pick, "LeftHand", (v) => -v.y),
    diveL: keyTime(F0, CLIP.diveL, "LeftHand", (v) => Math.hypot(v.x, v.z)),
    diveR: keyTime(F0, CLIP.diveR, "LeftHand", (v) => Math.hypot(v.x, v.z)),
    stretch: keyTime(F0, CLIP.stretch, "LeftHand", (v) => v.z),
    // 투구: 공 놓는 순간 = 오른손이 가장 빠를 때
    rel: keyTime(F0, CLIP.pitch, "RightHand", (v, p, s) => (s < dur(CLIP.pitch) * 0.15 ? -1e9 : v.distanceTo(p))),
  };
  const MOVE = {
    fly: { clip: CLIP.fly, speed: 1.3, lead: 0.5 },
    throw: { clip: CLIP.throw, speed: 1.5, lead: 0.45 },
    pick: { clip: CLIP.pick, speed: 1.4, lead: 0.4 },
    cthrow: { clip: CLIP.cthrow, speed: 1.3, lead: 0.4 },
    diveL: { clip: CLIP.diveL, speed: 1.2, lead: 0.45 },
    diveR: { clip: CLIP.diveR, speed: 1.2, lead: 0.45 },
    stretch: { clip: CLIP.stretch, speed: 1.3, lead: 0.4 },
  };
  type MoveKey = keyof typeof MOVE;
  const THROW_KEY: Record<string, number> = { [CLIP.throw]: KEY.throw.k, [CLIP.cthrow]: KEY.cthrow.k };
  fielders.forEach((f, i) => play(f, i === 1 ? CLIP.squat : CLIP.ready, { fade: 0 }));

  // ───────── 방망이 (타자 두 손 · 모션 캡처) ─────────
  const bats: BatRig[] = [];
  function attachBat(p: Player) {
    const root = p.root;
    const bt = batG.scene.clone();
    const mat = flatMat(0xc89a5c);
    bt.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.material = mat; });
    bt.updateMatrixWorld(true);
    const pts: THREE.Vector3[] = [];
    bt.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; const a = m.geometry.getAttribute("position"); for (let i = 0; i < a.count; i += 2) pts.push(new THREE.Vector3().fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld)); });
    const bb = new THREE.Box3().setFromPoints(pts), sz = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
    const ax = (sz.x > sz.y && sz.x > sz.z ? "x" : sz.y > sz.z ? "y" : "z") as "x" | "y" | "z";
    const len = sz[ax];
    const rad = (sign: number) => { let r = 0, n = 0; for (const q of pts) if ((q[ax] - c[ax]) * sign > len * 0.25) { const d = q.clone().sub(c); d[ax] = 0; r += d.length(); n++; } return r / Math.max(1, n); };
    const barrelSign = rad(1) > rad(-1) ? 1 : -1;
    const k = 0.84 / len;
    // 손잡이 끝 = 원점, 배럴 = +Y
    const from = new THREE.Vector3(); from[ax] = barrelSign;
    const inner = new THREE.Group();
    bt.position.copy(c).multiplyScalar(-1);
    inner.add(bt);
    inner.quaternion.setFromUnitVectors(from, new THREE.Vector3(0, 1, 0));
    inner.scale.setScalar(k);
    inner.position.set(0, (len * k) / 2, 0);
    const g = new THREE.Group();
    g.add(inner);
    addOutline(g);
    scene.add(g);
    // 쥐는 방향: T자(묶음 자세)에서 손바닥은 아래(-Y), 방망이가 지나는 손바닥 가로축은 앞뒤(Z). 각 손 뼈 기준으로 저장
    let sk: THREE.SkinnedMesh | null = null;
    root.traverse((o) => { if (!sk && (o as THREE.SkinnedMesh).isSkinnedMesh) sk = o as THREE.SkinnedMesh; });
    const skm = sk as unknown as THREE.SkinnedMesh;
    const gripOf = (bn: THREE.Bone): [THREE.Vector3, THREE.Vector3] => {
      const i = skm.skeleton.bones.indexOf(bn);
      const q = new THREE.Quaternion().setFromRotationMatrix(skm.bindMatrix.clone().multiply(skm.skeleton.boneInverses[i].clone().invert())).invert();
      return [new THREE.Vector3(0, 0, 1).applyQuaternion(q), new THREE.Vector3(0, -1, 0).applyQuaternion(q)];
    };
    const b: BatRig = {
      p, g, q: new THREE.Quaternion(), signs: new Map(),
      grip: { L: gripOf(bone(root, "LeftHand")!), R: gripOf(bone(root, "RightHand")!) },
      L: bone(root, "LeftHand")!, R: bone(root, "RightHand")!,
      Lm: (bone(root, "LeftHandMiddle1") ?? bone(root, "LeftHandMiddle4"))!, Rm: (bone(root, "RightHandMiddle1") ?? bone(root, "RightHandMiddle4"))!,
    };
    bats.push(b);
    return b;
  }
  /** 방망이 축: 두 손바닥을 가로질러 지나감 (손가락 방향과 직각, 손바닥 면 안). 두 손 축의 평균 · 왼손 아래 · 오른손 위. 좌타(거울)도 맞게 행렬로 돌림 */
  function mxBatPose(b: BatRig, sign = 0) {
    const fist = (h: THREE.Bone, m: THREE.Bone, palmN: THREE.Vector3) => h.getWorldPosition(new THREE.Vector3()).lerp(m.getWorldPosition(new THREE.Vector3()), 0.5).addScaledVector(palmN, 0.025);
    const nL = b.grip.L[1].clone().transformDirection(b.L.matrixWorld), nR = b.grip.R[1].clone().transformDirection(b.R.matrixWorld);
    const fl = fist(b.L, b.Lm, nL), fr = fist(b.R, b.Rm, nR);
    const stack = fr.clone().sub(fl);
    const aL = b.grip.L[0].clone().transformDirection(b.L.matrixWorld), aR = b.grip.R[0].clone().transformDirection(b.R.matrixWorld);
    // 부호: 미리 구한 부호표(모션 시간별) 또는 직전 방향과 이어지게
    const ref = new THREE.Vector3(0, 1, 0).applyQuaternion(b.q);
    const raw = aR.dot(ref) < 0 ? -1 : 1;
    if ((sign || raw) < 0) aR.negate();
    if (aL.dot(aR) < 0) aL.negate();
    const dir = aL.add(aR);
    if (dir.lengthSq() < 1e-6) dir.copy(stack);
    dir.normalize();
    const mid = fl.clone().add(fr).multiplyScalar(0.5);
    const off = stack.length() / 2 + 0.07;
    return { dir, knob: mid.clone().addScaledVector(dir, -off), raw, mid, off };
  }
  /** 방망이 방향 부호표: 모션 시간 1/60초마다 직전과 이어지는 부호 (프레임이 끊겨도 방망이가 안 뒤집히게) */
  function signTable(b: BatRig, clipName: string) {
    const p = b.p, clip = p.clips.get(clipName)!;
    const m = new THREE.AnimationMixer(p.root);
    m.clipAction(clip).play();
    const n = Math.ceil(clip.duration * 60) + 1, tbl = new Int8Array(n);
    b.q.identity();
    for (let i = 0; i < n; i++) {
      m.setTime(i / 60);
      p.root.updateMatrixWorld(true);
      const bp = mxBatPose(b);
      tbl[i] = bp.raw;
      b.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bp.dir);
    }
    m.stopAllAction();
    m.uncacheRoot(p.root);
    b.q.identity();
    return tbl;
  }
  const batRig = attachBat(batterP);
  for (const n of ["mx_idle", MXSW, "mx_bunt", "mx_ondeck", "mx_stepin"]) if (btClips.has(n)) batRig.signs.set(n, signTable(batRig, n));

  /** 스윙 핵심 시각: 레그킥 최고점(왼발 가장 높음) · 장전(방망이 끝이 머리 뒤로 가장 멀리) · 맞는 순간(방망이가 홈플레이트 쪽으로 수평) · 마무리(손이 가장 높음) */
  const SW = (() => {
    const p = batterP, b = batRig;
    p.root.position.set(-BAT_X, 0, 0);
    p.root.rotation.y = Math.PI + 0.15;
    const clip = p.clips.get(MXSW)!;
    const m = new THREE.AnimationMixer(p.root);
    m.clipAction(clip).play();
    const lfoot = bone(p.root, "LeftFoot")!, rhand = bone(p.root, "RightHand")!;
    const plate = new THREE.Vector3(BAT_X, 0, 0).normalize();
    const dt = 1 / 60, rows: { t: number; sc: number; v: number; back: number; foot: number; hand: number }[] = [];
    let prev: THREE.Vector3 | null = null;
    b.q.identity();
    for (let t = 0; t <= Math.min(clip.duration, 2.2); t += dt) {
      m.setTime(t);
      p.root.updateMatrixWorld(true);
      const bp = mxBatPose(b);
      b.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bp.dir);
      const tip = bp.knob.clone().addScaledVector(bp.dir, 0.84);
      rows.push({ t, sc: bp.dir.dot(plate) - Math.abs(bp.dir.y), v: prev ? tip.distanceTo(prev) / dt : 0, back: tip.clone().sub(p.root.position).dot(plate), foot: lfoot.getWorldPosition(new THREE.Vector3()).y, hand: rhand.getWorldPosition(new THREE.Vector3()).y });
      prev = tip;
    }
    m.stopAllAction();
    m.uncacheRoot(p.root);
    b.q.identity();
    let vi = 0;
    rows.forEach((r, i) => { if (r.t > 0.5 && r.t < 1.6 && r.v > rows[vi].v) vi = i; });
    let ci = vi;
    rows.forEach((r, i) => { if (r.t >= rows[vi].t - 0.15 && r.t <= rows[vi].t + 0.05 && r.sc > rows[ci].sc) ci = i; });
    let li = ci;
    rows.forEach((r, i) => { if (r.t >= rows[ci].t - 0.5 && r.t < rows[ci].t && r.back < rows[li].back) li = i; });
    let ki = 0;
    rows.forEach((r, i) => { if (r.t < rows[li].t && r.foot > rows[ki].foot) ki = i; });
    let hi = ci;
    rows.forEach((r, i) => { if (r.t > rows[ci].t && r.t < rows[ci].t + 0.6 && r.hand > rows[hi].hand) hi = i; });
    return { kick: rows[ki].t, load: rows[li].t, swing: rows[ci].t, hold: rows[hi].t };
  })();

  /**
   * 팔로스루 방망이 방향. u = 맞는 순간(0) → 마무리(1). 위에서 보면 맞는 순간 방향(홈플레이트 쪽)에서 투수 쪽으로 한 방향으로 돌고,
   * 앞어깨를 지나며 위로 말려 올라가 머리 위에서 끝 (2D 마무리와 같은 자세). 손 축은 맞은 뒤 손목이 한 바퀴 더 돌아 그대로 못 씀
   */
  const FOLLOW_SPIN = Math.PI * 0.9;
  const FOLLOW_ELEV: [number, number][] = [[0, -0.08], [0.45, 0.05], [0.75, 0.6], [0.9, 1.05]];
  function mxFollow(u0: number, root: THREE.Object3D, mirror: number) {
    const u = Math.max(0, Math.min(1, u0));
    const th = FOLLOW_SPIN * (1 - (1 - u) ** 2);
    const x = th / Math.PI;
    const K = FOLLOW_ELEV;
    let i = 0;
    while (i < K.length - 2 && K[i + 1][0] < x) i++;
    const p0 = K[Math.max(0, i - 1)][1], p1 = K[i][1], p2 = K[i + 1][1], p3 = K[Math.min(K.length - 1, i + 2)][1];
    const f = Math.max(0, Math.min(1, (x - K[i][0]) / (K[i + 1][0] - K[i][0])));
    const el = 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
    const P = new THREE.Vector3(-root.position.x, 0, -root.position.z).normalize();
    const az = Math.atan2(P.x, P.z) + th * mirror;
    return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  }

  // ───────── 타자 동작 (Match 시계 → 모션 시간을 직접 정함) ─────────
  /** 두 층: 스윙 모션(시간 직접 지정) ↔ 대기 모션(반복). 무게를 부드럽게 옮김 */
  const swAct = batterP.mixer.clipAction(btClips.get(MXSW)!);
  const buntAct = batterP.mixer.clipAction(btClips.get("mx_bunt") ?? btClips.get(MXSW)!);
  const idleAct = batterP.mixer.clipAction(btClips.get("mx_idle")!);
  const introActs = { ondeck: batterP.mixer.clipAction(btClips.get("mx_ondeck") ?? btClips.get("mx_idle")!), stepin: batterP.mixer.clipAction(btClips.get("mx_stepin") ?? btClips.get("mx_idle")!) };
  for (const a of [swAct, buntAct, idleAct, introActs.ondeck, introActs.stepin]) { a.play(); a.setEffectiveWeight(0); a.timeScale = 0; }
  idleAct.timeScale = 1;
  batterP.mixer.stopAllAction();
  for (const a of [swAct, buntAct, idleAct, introActs.ondeck, introActs.stepin]) { a.enabled = true; a.play(); a.setEffectiveWeight(0); a.timeScale = 0; }
  idleAct.timeScale = 1;
  const drv = { w: 0, ct: 0, layer: "sw" as "sw" | "bunt", lastAnim: "idle", lastT: 0, sw0: 0, swC: -1, returning: false, follow: null as THREE.Quaternion | null };
  /** 타석 들어서기 연출: 끝 자세가 대기 자세 자리에 오게 미리 옮겨 둘 거리 */
  const introOff = (() => {
    const p = batterP;
    p.root.position.set(-BAT_X, 0, 0);
    p.root.rotation.y = Math.PI + 0.15;
    const hp = bone(p.root, "Hips")!;
    const at = (n: string, t: number) => { const c = p.clips.get(n); if (!c) return new THREE.Vector3(); const m = new THREE.AnimationMixer(p.root); m.clipAction(c).play(); m.setTime(Math.min(t, c.duration - 0.01)); p.root.updateMatrixWorld(true); const v = hp.getWorldPosition(new THREE.Vector3()); m.stopAllAction(); m.uncacheRoot(p.root); return v; };
    return at("mx_idle", 0).sub(at("mx_stepin", 99)).setY(0);
  })();

  /** 스윙 모션 시간 (버튼 뒤 t초, sp = 누를 때 스트라이드 진행도): 맞는 순간이 정확히 SWING_HIT_T 뒤, 그 뒤엔 스윙 속도에서 원래 속도로 0.12초 동안 줄임 */
  function swingTime(t: number, sp: number) {
    const ct0 = SW.kick + Math.max(0, Math.min(1, sp)) * (SW.load - SW.kick);
    if (t < SWING_HIT_T) return ct0 + (SW.swing - ct0) * (t / SWING_HIT_T);
    const tau = t - SWING_HIT_T;
    const B = (SW.swing - ct0) / SWING_HIT_T;
    const k = Math.min(tau, 0.12);
    return SW.swing + tau + ((B - 1) * 0.12 * (1 - (1 - k / 0.12) ** 3)) / 3;
  }
  /** 지금 목표: 스윙 층을 쓸지 · 그 모션 시간 · 대기로 돌아오는 속도 */
  function batTarget(b: BatView3D["bat"]): { on: boolean; ct: number; layer: "sw" | "bunt"; back: number } {
    const t = b.t;
    if (b.anim === "bunt") return { on: true, ct: BUNT_T, layer: "bunt", back: 0.2 };
    if (b.anim === "swing") {
      const ct = swingTime(t, b.sp);
      // 마무리(손이 가장 높은 때)까지 가면 멈추지 않고 대기 자세로 이어서 돌아옴
      if (ct >= SW.hold) return { on: false, ct: SW.hold, layer: "sw", back: 0.4 };
      return { on: true, ct, layer: "sw", back: 0.4 };
    }
    if (b.anim === "load") {
      if (t < LIFT_AT) return { on: false, ct: 0, layer: "sw", back: 0.2 };
      if (t < KICK_STEP_T) {
        if (t < b.strideAt) return { on: true, ct: SW.kick * ease((t - LIFT_AT) / LIFT_TOTAL), layer: "sw", back: 0.2 };
        return { on: true, ct: SW.kick + (SW.load - SW.kick) * strideProg(t, b.strideAt), layer: "sw", back: 0.2 };
      }
      // 안 치고 보냄: 착지했으면 대기 자세로 겹쳐 돌아옴, 다리 든 채면 다리 내리기
      if (b.strideAt < KICK_STEP_T) return { on: false, ct: SW.load, layer: "sw", back: RETURN_T };
      const q = (t - KICK_STEP_T) / KICK_DOWN_T;
      return q >= 1 ? { on: false, ct: 0, layer: "sw", back: 0.15 } : { on: true, ct: SW.kick * (1 - ease(q)), layer: "sw", back: 0.15 };
    }
    return { on: false, ct: drv.ct, layer: drv.layer, back: 0.3 };
  }

  // ───────── 공 · 그림자 · 궤적 (수비 화면) ─────────
  function ballTexture() {
    const W = 256, H = 128;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d")!;
    g.fillStyle = "#f6f3ea";
    g.fillRect(0, 0, W, H);
    const pt = (u: number) => {
      const b = 0.25, k = 2 * Math.sqrt(b * (1 - b));
      const x = (1 - b) * Math.cos(u) + b * Math.cos(3 * u), y = (1 - b) * Math.sin(u) - b * Math.sin(3 * u), z = k * Math.sin(2 * u);
      const n = Math.hypot(x, y, z);
      const lon = Math.atan2(y / n, x / n), lat = Math.asin(z / n);
      return [(lon / (2 * Math.PI) + 0.5) * W, (0.5 - lat / Math.PI) * H] as const;
    };
    g.strokeStyle = "#c8202a";
    g.lineWidth = 2.2;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 160; i++) {
        const u0 = (i / 160) * Math.PI * 2, u1 = ((i + 0.5) / 160) * Math.PI * 2;
        const [x0, y0] = pt(u0), [x1, y1] = pt(u1);
        if (Math.abs(x1 - x0) > W / 2) continue;
        const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l, ny = dx / l;
        g.beginPath();
        g.moveTo(x0 + nx * 3 * side, y0 + ny * 3 * side);
        g.lineTo(x0 + nx * 0.6 * side + dx * 0.6, y0 + ny * 0.6 * side + dy * 0.6);
        g.stroke();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), new THREE.MeshLambertMaterial({ map: ballTexture(), emissive: 0x555555 }));
  const ballPrev = new THREE.Vector3();
  scene.add(ball);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);
  const trailGeo = new THREE.BufferGeometry();
  const trailPts = new Float32Array(3 * 40);
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPts, 3));
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
  scene.add(trail);

  // ───────── 수비 재생 (시뮬 프레임) ─────────
  interface Cue { at: number; kt: number; fi: number; mv: MoveKey }
  const fp = { out: null as FieldOut | null, cues: [] as Cue[], cueIdx: 0, fx: [] as { t: number; f: () => void }[], fxIdx: 0, catchAt: [] as { t: number; fi: number }[], lastT: 0 };
  function buildCues(P: FieldOut) {
    const out: Cue[] = [];
    const add = (t: number, fi: number, mv: MoveKey) => {
      const m = MOVE[mv];
      const from = Math.max(0, KEY[mv].k - m.lead * m.speed);
      out.push({ at: t - (KEY[mv].k - from) / m.speed, kt: t, fi, mv });
    };
    const F = P.frames;
    const at = (tt: number) => F[Math.min(F.length - 1, Math.max(0, Math.round(tt * 60)))];
    for (const e of P.events) {
      if (e.kind === "catch" && P.fielder >= 0) add(e.t, P.fielder, "fly");
      if (e.kind === "dive" && P.fielder >= 0) {
        const fi = P.fielder, f0 = at(e.t - 0.35), f1 = at(e.t);
        const vx = f1.fx[fi * 2] - f0.fx[fi * 2], vy = f1.fx[fi * 2 + 1] - f0.fx[fi * 2 + 1];
        const bx = f1.bx - f1.fx[fi * 2], by = f1.by - f1.fx[fi * 2 + 1];
        add(e.t, fi, bx * -vy + by * vx > 0 ? "diveL" : "diveR");
      }
      if (e.kind === "throw") {
        const f = at(e.t);
        let bi = 0, bd = 1e9;
        for (let i = 0; i < 9; i++) { const d = Math.hypot(f.fx[i * 2] - e.x, f.fx[i * 2 + 1] - e.y); if (d < bd) { bd = d; bi = i; } }
        add(e.t, bi, bi === 1 ? "cthrow" : "throw");
      }
    }
    for (let i = 1; i < F.length; i++) {
      const h = F[i].hold;
      if (h >= 0 && F[i - 1].hold < 0 && F[i].bh < 1.5 && !P.events.some((e) => (e.kind === "catch" || e.kind === "dive") && Math.abs(e.t - F[i].t) < 0.2)) add(F[i].t, h, "pick");
      if (h === 2 && F[i - 1].hold < 0 && F[i].bh >= 1.5 && Math.hypot(F[i].fx[4] - BASES[1][0], F[i].fx[5] - BASES[1][1]) < 2.5) add(F[i].t, 2, "stretch");
    }
    out.sort((a, b) => a.kt - b.kt);
    const lastKt = new Map<number, number>();
    for (const c of out) {
      const pk = lastKt.get(c.fi);
      if (pk !== undefined && c.at < pk + 0.12) c.at = Math.min(c.kt - 0.05, pk + 0.12);
      lastKt.set(c.fi, c.kt);
    }
    return out.sort((a, b) => a.at - b.at);
  }
  /** 심판 손짓: 시뮬 결과에서 시각을 미리 뽑아둠 (소리는 Match 가) */
  function buildFx(P: FieldOut) {
    const q: { t: number; f: () => void }[] = [];
    const F = P.frames;
    for (const e of P.events) if (e.kind === "out") q.push({ t: e.t + 0.15, f: () => umpCall(e.x, e.y, "out") });
    for (let i = 1; i < F.length; i++) {
      F[i].rs.forEach((r, j) => {
        const pr = F[i - 1].rs[j];
        if (!pr || pr.st !== 0 || r.st !== 1) return;
        const nearBase = BASES.slice(1, 4).some(([bx, by]) => Math.hypot(r.x - bx, r.y - by) < 1.6);
        if (nearBase && Math.hypot(F[i].bx - r.x, F[i].by - r.y) < 9) q.push({ t: F[i].t, f: () => umpCall(r.x, r.y, "safe") });
      });
    }
    return q.sort((a, b) => a.t - b.t);
  }
  function startPlay(out: FieldOut) {
    fp.out = out;
    fp.cues = buildCues(out);
    fp.cueIdx = 0;
    fp.fx = buildFx(out);
    fp.fxIdx = 0;
    fp.lastT = 0;
    fp.catchAt = [];
    for (let i = 1; i < out.frames.length; i++) { const a = out.frames[i - 1], b = out.frames[i]; if (b.hold >= 0 && a.hold < 0) fp.catchAt.push({ t: b.t, fi: b.hold }); }
    umps.forEach((u, i) => { play(u, i === 0 ? UCLIP.crouch : UCLIP.idle, { fade: 0 }); u.root.rotation.y = Math.atan2(0 - UMP_POS[i][0], -(30 - UMP_POS[i][1])); });
    fielders.forEach((f, i) => play(f, i === 1 ? CLIP.squat : CLIP.ready, { fade: 0 }));
    for (let k = 0; k < trailPts.length; k++) trailPts[k] = 0;
    camPos.set(0, 6, 9);
    camLook.set(0, 1, -10);
    camFov = 45;
  }
  /** 시뮬 프레임 사이를 이어서 매끈하게 (위치 보간, 속도는 앞뒤 프레임 차이) */
  function sample(F: Frame[], tt: number) {
    const u = Math.max(0, tt * 60);
    const i = Math.min(F.length - 1, Math.floor(u));
    const j = Math.min(F.length - 1, i + 1);
    const k = Math.min(1, u - i);
    const A = F[i], B = F[j];
    const fx = new Float32Array(18);
    for (let q = 0; q < 18; q++) fx[q] = lerp(A.fx[q], B.fx[q], k);
    const vi0 = F[Math.max(0, i - 3)], vi1 = F[Math.min(F.length - 1, i + 3)];
    const span = (Math.min(F.length - 1, i + 3) - Math.max(0, i - 3)) / 60 || 1;
    const vel = Array.from({ length: 9 }, (_, q) => [(vi1.fx[q * 2] - vi0.fx[q * 2]) / span, (vi1.fx[q * 2 + 1] - vi0.fx[q * 2 + 1]) / span]);
    const rs = A.rs.map((r, q) => {
      const rb = B.rs[q] ?? r;
      const r0 = vi0.rs[q] ?? r, r1 = vi1.rs[q] ?? r;
      return { ...r, x: lerp(r.x, rb.x, k), y: lerp(r.y, rb.y, k), vx: (r1.x - r0.x) / span, vy: (r1.y - r0.y) / span };
    });
    const jump = Math.hypot(B.bx - A.bx, B.by - A.by) > 3;
    return { hold: A.hold, bx: jump ? A.bx : lerp(A.bx, B.bx, k), by: jump ? A.by : lerp(A.by, B.by, k), bh: jump ? A.bh : lerp(A.bh, B.bh, k), fx, vel, rs };
  }
  function turn(o: THREE.Object3D, target: number, dt: number, rate = 12) {
    let d = target - o.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    o.rotation.y += d * (1 - Math.exp(-dt * rate));
  }
  const tmpV = new THREE.Vector3();
  const camPos = new THREE.Vector3(0, 6, 9);
  const camLook = new THREE.Vector3(0, 1, -10);
  let camFov = 45;
  /** 공 · 카메라: 들고 있는 공은 글러브 · 던지는 손 안에, 카메라는 공을 뒤에서 따라감 */
  function placeBallCam(S: ReturnType<typeof sample>, t: number, dt: number) {
    let bp = V(S.bx, S.by, Math.max(0.11, S.bh));
    let inGlove = false;
    if (S.hold >= 0) {
      const p = fielders[S.hold];
      p.root.updateMatrixWorld(true);
      const tk = THROW_KEY[p.cur];
      const inThrow = tk !== undefined && !!p.act && p.act.isRunning() && p.act.time < tk;
      if (inThrow) bp = p.rhand.getWorldPosition(tmpV).clone();
      else if (p.pocket) bp = p.pocket.getWorldPosition(tmpV).clone();
      inGlove = !inThrow;
    } else {
      const nx = fp.catchAt.find((c) => c.t >= t - 0.001 && c.t - t < 0.12);
      if (nx) {
        const q = fielders[nx.fi];
        if (q.pocket) { q.root.updateMatrixWorld(true); const gp = q.pocket.getWorldPosition(tmpV).clone(); bp.lerp(gp, 1 - (nx.t - t) / 0.12); }
      }
      const mv = bp.clone().sub(ballPrev);
      const d = mv.length();
      if (d > 1e-4 && d < 5) { const ax = new THREE.Vector3(mv.z, 0, -mv.x); ball.rotateOnWorldAxis(ax.lengthSq() > 1e-8 ? ax.normalize() : new THREE.Vector3(1, 0, 0), Math.min(1.2, d * 3.5)); }
    }
    ballPrev.copy(bp);
    ball.position.copy(bp);
    ball.visible = !inGlove;
    shadow.visible = true;
    shadow.position.set(bp.x, 0.02, bp.z);
    shadow.scale.setScalar(1 + bp.y * 0.03);
    for (let k = trailPts.length / 3 - 1; k > 0; k--) for (let a = 0; a < 3; a++) trailPts[k * 3 + a] = trailPts[(k - 1) * 3 + a];
    trailPts[0] = bp.x; trailPts[1] = bp.y; trailPts[2] = bp.z;
    trailGeo.attributes.position.needsUpdate = true;
    trail.visible = S.hold < 0;
    const h = bp.y;
    const dir = new THREE.Vector3(bp.x, 0, bp.z).normalize();
    if (!isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(0, 0, -1);
    const back = 10 + Math.min(24, h * 0.65);
    const want = new THREE.Vector3(bp.x - dir.x * back + dir.z * 4, 5 + Math.min(12, h * 0.3), bp.z - dir.z * back - dir.x * 4);
    camPos.lerp(want, 1 - Math.exp(-dt * 2.4));
    camLook.lerp(new THREE.Vector3(bp.x, Math.min(h, 40) * 0.45 + 0.6, bp.z), 1 - Math.exp(-dt * 4));
    camFov += (45 + Math.min(17, h * 0.6) - camFov) * (1 - Math.exp(-dt * 2.4));
  }

  // ───────── 화면 밖 선수 생략 · 먼 선수 가벼운 몸 ─────────
  const frustum = new THREE.Frustum();
  const projM = new THREE.Matrix4();
  const sph = new THREE.Sphere(new THREE.Vector3(), 1.6);
  const LOD_FAR = 24;
  function cullPlayers(list: Player[]) {
    for (const p of list) {
      if (!p.root.visible) continue;
      sph.center.copy(p.root.position).setY(0.9);
      const inView = frustum.intersectsSphere(sph);
      p.culled = !inView;
      for (const o of p.parts) if (!o.userData.lod) o.visible = inView;
      const far = p.root.position.distanceTo(camera.position) > 45;
      for (const o of p.outlines) o.visible = inView && !far;
      // 가벼운 몸
      const lo = p.root.position.distanceTo(camera.position) > (p.lod.useLo ? LOD_FAR - 2 : LOD_FAR);
      p.lod.useLo = lo;
      for (const o of p.lod.hi) o.visible = inView && !lo;
      for (const o of p.lod.lo) o.visible = inView && lo;
    }
  }
  const allPlayers = [...fielders, ...runnerPool, ...umps, batterP];
  function updatePlayers(dt: number, list: Player[]) {
    camera.updateMatrixWorld();
    projM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projM);
    cullPlayers(list);
    for (const p of list) {
      p.skip = (p.skip ?? 0) + dt;
      if (p.culled || !p.root.visible) continue;
      p.mixer.update(p.skip);
      p.skip = 0;
      if (p.hand) p.hand.scale.setScalar(HS);
    }
  }
  function setCam(pos: THREE.Vector3, look: THREE.Vector3, fov: number) {
    camera.position.copy(pos);
    camera.lookAt(look);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
  }

  // ───────── 타석 화면 ─────────
  let mode: "bat" | "field" | "" = "";
  const pitHand = new THREE.Vector3();
  let relKey = "";
  function batting(v: BatView3D, dt: number) {
    if (mode !== "bat") {
      mode = "bat";
      fp.out = null;
      ball.visible = false; shadow.visible = false; trail.visible = false;
      for (const u of umps) u.root.visible = false;
      runnerPool.forEach((r) => (r.root.visible = false));
      fielders.forEach((f, i) => {
        const [x, y] = FIELDER_SPOT[i];
        f.root.position.copy(V(x, y));
        f.root.rotation.y = Math.atan2(0 - x, -(0 - y));
        f.root.visible = i !== 1;
        play(f, CLIP.ready, { fade: 0 });
      });
    }
    if (v.night !== night) { night = v.night; stadium.setNight(night); }
    // 팀 색
    for (const f of fielders) setTeam(f, fdG, fdLoG, "fd", v.colors.field);
    setTeam(batterP, btG, btLoG, "bt", v.colors.bat);
    for (const r of runnerPool) setTeam(r, btG, btLoG, "bt", v.colors.bat);
    // 루상 주자: 리드 자리에서 투수 쪽을 봄
    runnerPool.forEach((r, i) => {
      const on = i < 3 && v.runners[i];
      r.root.visible = on;
      if (!on) return;
      const [x, y] = RUNNER_SPOT[i];
      r.root.position.copy(V(x, y));
      r.root.rotation.y = Math.atan2(0 - x, -(18.4 - y));
      play(r, "Idle_02");
    });
    // 투수: 세트 자세(투구 모션 첫 장)로 서 있다가, 던질 땐 공 놓는 순간을 Match 시계(PITCH_RELEASE_T)에 맞춰 재생
    const P = fielders[0];
    P.root.scale.x = Math.abs(P.root.scale.x) * (v.pitLefty ? -1 : 1);
    play(P, CLIP.pitch, { fade: 0.1 });
    if (P.act) {
      P.act.timeScale = 0;
      P.act.time = v.pit.throwing ? Math.max(0, Math.min(P.act.getClip().duration - 0.01, KEY.rel.k - (PITCH_RELEASE_T - v.pit.t))) : 0;
    }
    // 타자
    const B = batterP;
    const mir = v.lefty ? -1 : 1;
    B.root.visible = true;
    B.root.scale.x = Math.abs(B.root.scale.x) * mir;
    B.root.rotation.y = Math.PI + 0.15 * mir;
    const home = new THREE.Vector3(-BAT_X * mir + v.shift.x, 0, -v.shift.z);
    if (v.walk !== null) {
      // 타석 들어서기: 컷 1 얼굴 클로즈업 · 연습 스윙 → 컷 2 투수 쪽에서 타석 들어서기
      const w = v.walk;
      const SPLIT = 0.42;
      for (const a of [swAct, buntAct, idleAct]) a.setEffectiveWeight(0);
      introActs.ondeck.setEffectiveWeight(w < SPLIT ? 1 : 0);
      introActs.stepin.setEffectiveWeight(w < SPLIT ? 0 : 1);
      introActs.ondeck.time = (w / SPLIT) * introActs.ondeck.getClip().duration * 0.999;
      introActs.stepin.time = ((w - SPLIT) / (1 - SPLIT)) * introActs.stepin.getClip().duration * 0.999;
      B.root.position.copy(home).add(w < SPLIT ? new THREE.Vector3() : introOff.clone().multiply(new THREE.Vector3(mir, 1, 1)));
      drv.w = 0;
      B.mixer.update(0);
      B.root.updateMatrixWorld(true);
      if (w < SPLIT) {
        const hd = bone(B.root, "Head")!, hf = B.root.getObjectByName("headfront");
        const H = hd.getWorldPosition(new THREE.Vector3());
        const f = hf ? hf.getWorldPosition(new THREE.Vector3()).sub(H).setY(0).normalize() : new THREE.Vector3(1, 0, 0);
        const side = new THREE.Vector3(-f.z, 0, f.x);
        setCam(H.clone().addScaledVector(f, 1.15).addScaledVector(side, 0.35).add(new THREE.Vector3(0, -0.05, 0)), H.clone().add(new THREE.Vector3(0, -0.12, 0)), 40);
      } else setCam(new THREE.Vector3(0.9 * mir, 1.2, -3.7), new THREE.Vector3(-0.6 * mir, 0.85, 0.3), 40);
      fielders[1].root.visible = true;
      umps[0].root.visible = true;
      fielders[1].root.position.copy(V(0, -1.6));
      fielders[1].root.rotation.y = 0;
      play(fielders[1], CLIP.squat);
      umps[0].root.position.copy(V(0, -3.4));
      updateBat(v, true);
      updatePlayers(dt, allPlayers);
      return;
    }
    fielders[1].root.visible = false;
    umps[0].root.visible = false;
    B.root.position.copy(home);
    introActs.ondeck.setEffectiveWeight(0);
    introActs.stepin.setEffectiveWeight(0);
    const tg = batTarget(v.bat);
    // 새 스윙이 시작되면 처음부터 (대기로 돌아가던 중이어도)
    if (v.bat.anim !== drv.lastAnim || v.bat.t < drv.lastT - 1e-3) drv.returning = false;
    drv.lastAnim = v.bat.anim;
    drv.lastT = v.bat.t;
    if (tg.on) {
      drv.ct = tg.ct;
      drv.layer = tg.layer;
      drv.w = Math.min(1, drv.w + dt / 0.1);
    } else {
      drv.ct = tg.ct;
      drv.w = Math.max(0, drv.w - dt / Math.max(0.05, tg.back));
    }
    const act = drv.layer === "bunt" ? buntAct : swAct;
    (drv.layer === "bunt" ? swAct : buntAct).setEffectiveWeight(0);
    act.time = Math.max(0, Math.min(act.getClip().duration - 0.001, drv.ct));
    act.setEffectiveWeight(drv.w);
    idleAct.setEffectiveWeight(1 - drv.w);
    setCam(BATCAM.pos.clone().setX(0), BATCAM.look, BATCAM.fov);
    updatePlayers(dt, allPlayers);
    updateBat(v, false);
    // 투수 손: 공 놓는 순간 자세의 오른손 (좌투는 거울) — 투수 바뀌면 다시 잼
    if (relKey !== (v.pitLefty ? "L" : "R") && P.act) {
      const keep = P.act.time;
      P.act.time = KEY.rel.k;
      P.mixer.update(0);
      P.root.updateMatrixWorld(true);
      P.rhand.getWorldPosition(pitHand);
      P.act.time = keep;
      P.mixer.update(0);
      relKey = v.pitLefty ? "L" : "R";
    }
  }
  /** 방망이: 손 축(부호표로 안 뒤집히게) + 맞은 뒤엔 팔로스루 궤적, 대기로 돌아오는 동안 둘을 섞음 */
  function updateBat(v: BatView3D, intro: boolean) {
    const b = batRig, B = batterP;
    B.root.updateMatrixWorld(true);
    b.g.visible = true;
    let sg = 0;
    if (intro) {
      const n = (v.walk ?? 0) < 0.42 ? "mx_ondeck" : "mx_stepin";
      const a = n === "mx_ondeck" ? introActs.ondeck : introActs.stepin;
      const t = b.signs.get(n);
      if (t) sg = t[Math.max(0, Math.min(t.length - 1, Math.round(a.time * 60)))];
    } else if (drv.w > 0.99 || drv.w < 0.01) {
      const n = drv.w > 0.99 ? (drv.layer === "bunt" ? "mx_bunt" : MXSW) : "mx_idle";
      const a = drv.w > 0.99 ? (drv.layer === "bunt" ? buntAct : swAct) : idleAct;
      const t = b.signs.get(n);
      if (t) sg = t[Math.max(0, Math.min(t.length - 1, Math.round((a.time % a.getClip().duration) * 60)))];
    }
    const bp = mxBatPose(b, sg);
    if (!intro && drv.layer === "sw" && drv.ct > SW.swing) {
      const d = mxFollow((drv.ct - SW.swing) / Math.max(0.05, SW.hold - SW.swing), B.root, v.lefty ? -1 : 1);
      const w = smooth(SW.swing, SW.swing + 0.04, drv.ct) * drv.w;
      const qa = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), bp.dir);
      const qb = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      bp.dir.set(0, 1, 0).applyQuaternion(qa.slerp(qb, w));
      bp.knob.copy(bp.mid).addScaledVector(bp.dir, -bp.off);
    }
    b.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bp.dir);
    b.g.quaternion.copy(b.q);
    b.g.position.copy(bp.knob);
  }

  // ───────── 수비 화면 ─────────
  function field(v: FieldView3D, dt: number) {
    if (v.night !== night) { night = v.night; stadium.setNight(night); }
    if (mode !== "field" || fp.out !== v.out) {
      mode = "field";
      startPlay(v.out);
      batterP.root.visible = false;
      batRig.g.visible = false;
      fielders.forEach((f) => { f.root.visible = !v.ballOnly; f.root.scale.x = Math.abs(f.root.scale.x); });
      umps.forEach((u) => (u.root.visible = !v.ballOnly));
      for (const f of fielders) setTeam(f, fdG, fdLoG, "fd", v.colors.field);
      for (const r of runnerPool) setTeam(r, btG, btLoG, "bt", v.colors.bat);
    }
    const out = v.out, F = out.frames;
    if (!F.length) return;
    const t = v.t;
    const fdt = Math.max(0, t - fp.lastT);
    fp.lastT = t;
    while (fp.fxIdx < fp.fx.length && fp.fx[fp.fxIdx].t <= t) fp.fx[fp.fxIdx++].f();
    if (t > 0.5 && umps[0].cur === UCLIP.crouch) play(umps[0], UCLIP.idle, { fade: 0.4 });
    for (const u of umps) if (!(u.act && u.act.loop === THREE.LoopOnce && u.act.isRunning()) && u.cur !== UCLIP.idle && u.cur !== UCLIP.crouch) play(u, UCLIP.idle, { fade: 0.3 });
    while (fp.cueIdx < fp.cues.length && fp.cues[fp.cueIdx].at <= t) {
      const c = fp.cues[fp.cueIdx++];
      const m = MOVE[c.mv];
      const from = Math.max(0, KEY[c.mv].k - (c.kt - t) * m.speed);
      if (!v.ballOnly) play(fielders[c.fi], m.clip, { once: true, from, speed: m.speed, fade: 0.08 });
    }
    const S = sample(F, t);
    const busy = (p: Player) => !!(p.act && p.act.loop === THREE.LoopOnce && p.act.isRunning());
    fielders.forEach((p, i) => {
      const x = S.fx[i * 2], y = S.fx[i * 2 + 1];
      const [vx, vy] = S.vel[i];
      const sp = Math.hypot(vx, vy);
      p.root.position.copy(V(x, y));
      if (sp > 0.8) {
        turn(p.root, Math.atan2(vx, -vy), dt);
        if (!busy(p)) play(p, sp > 7 ? CLIP.sprint : CLIP.run, { speed: Math.max(0.7, sp / 6.5) });
      } else {
        turn(p.root, Math.atan2(S.bx - x, -(S.by - y)), dt, 6);
        if (!busy(p)) play(p, i === 1 && t < 0.6 ? CLIP.squat : t < 0.4 || S.hold < 0 ? CLIP.ready : CLIP.idle);
      }
    });
    runnerPool.forEach((p, i) => {
      const r = S.rs[i];
      if (!r || r.st === 2 || v.ballOnly) { p.root.visible = false; return; }
      p.root.visible = true;
      p.root.scale.x = Math.abs(p.root.scale.x);
      p.root.position.copy(V(r.x, r.y));
      const sp = Math.hypot(r.vx, r.vy);
      if (sp > 0.5) { turn(p.root, Math.atan2(r.vx, -r.vy), dt, 14); play(p, CLIP.sprint, { speed: Math.max(0.8, sp / 8) }); }
      else play(p, "Idle_02");
    });
    // 모션은 경기 시계만큼 (배속 · 멈춤도 그대로)
    updatePlayers(fdt, allPlayers);
    placeBallCam(S, t, dt);
    setCam(camPos, camLook, camFov);
  }

  // ───────── 투영 (2D 표시용) ─────────
  const pv = new THREE.Vector3();
  function toScreen(w: THREE.Vector3) {
    pv.copy(w).applyMatrix4(camera.matrixWorldInverse);
    const depth = Math.max(0.05, -pv.z);
    pv.copy(w).project(camera);
    const s = DH / 2 / Math.tan((camera.fov * Math.PI) / 360) / depth;
    return { x: ((pv.x + 1) / 2) * DW, y: ((1 - pv.y) / 2) * DH, s };
  }

  return {
    canvas: renderer.domElement,
    setSize(cssW, cssH, pr) {
      renderer.setPixelRatio(pr);
      renderer.setSize(cssW, cssH, false);
      camera.aspect = cssW / cssH;
      camera.updateProjectionMatrix();
    },
    batting,
    field,
    render() {
      renderer.render(scene, camera);
    },
    // 카메라(홈 뒤 2.59m)보다 뒤는 투영이 뒤집혀서 바로 앞까지만
    project: (x, y, z) => toScreen(new THREE.Vector3(x, ballH(y), -Math.max(z, -2.2))),
    unprojectPlate(sx, sy) {
      const r = new THREE.Raycaster();
      r.setFromCamera(new THREE.Vector2((sx / DW) * 2 - 1, 1 - (sy / DH) * 2), camera);
      const o = r.ray.origin, d = r.ray.direction;
      const k = Math.abs(d.z) > 1e-6 ? -o.z / d.z : 0;
      return { x: o.x + d.x * k, y: gameH(o.y + d.y * k) };
    },
    projectField: (x, y, h) => toScreen(V(x, y, h)),
    pitcherHand: () => { const s = toScreen(pitHand); return { x: s.x, y: s.y }; },
    dispose() {
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
