import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneRig } from "three/examples/jsm/utils/SkeletonUtils.js";
import { CHARS, CHAR_TALL, IDLE_MS, WALK_MS, sheetOf, type Sheet } from "@/lib/gmtown/chars";
import type { ChatWire, MoveWire, PlayerWire, TownSnap } from "@/lib/gmtown/types";
import {
  BOARD,
  BOUNDS,
  BUILDINGS,
  FOUNTAIN,
  LAKE,
  PATHS,
  PITCH,
  PLAZA,
  RADIUS,
  SPEED,
  WORLD,
  YAW,
  blocked,
  dir8,
  doorAt,
  doorFront,
  fromScreen,
  hiddenBy,
  isLot,
  toCam,
  type Building,
} from "@/lib/gmtown/world";
import { buildTown, type TownScene } from "./scene3d";

/*
 * GMTOWN 엔진 — three.js 쿼터뷰 장면 위에 사람들을 세우고, 내 캐릭터를 움직이고, 다른 사람을 부드럽게 보여 줌.
 * React(GMTownApp)는 HUD(채널 · 채팅 · 건물 카드)만 맡고 여기 훅으로 주고받음.
 *
 * 카메라: 쿼터뷰 (위 35°) 직교, 처음엔 남동 45° 에서. 내 캐릭터를 따라감.
 *   마우스: 왼쪽 끌기 = 시점 돌리기(좌우) · 높이(위아래) · 오른쪽 누르기 = 그곳으로 걷기 · 휠 = 당기기/밀기.
 *   폰: 누르기 = 걷기 · 두 손가락 = 당기기 + 돌리기 + 위아래로 밀면 높이.
 *   「지도」는 마을 전체.
 * 사람: 3D 모델이 있는 캐릭터는 리깅된 3D 로 (걷기 · 숨쉬기 동작, 가는 쪽을 보며 돌아섬, 툰 2단 명암 + 화면 두께가 같은 외곽선).
 *   모델이 없거나 못 받았으면 스프라이트를 카메라를 보는 세로 판에 (35° 로 눌린 만큼 세로로 늘려서 원래 비율).
 *   가려진 사람은 반투명으로 한 번 더 (어디 있는지는 보이게), 내가 건물 뒤에 들어가면 그 건물을 비치게.
 * 이름표 · 말풍선 · 조이스틱은 위에 겹친 2D 캔버스.
 * 움직이기: 키보드(WASD · 방향키 = 화면 방향) · 오른쪽으로 누른 곳으로 걸어가기(0.5m 격자 A* → 직선으로 펴기) · 폰은 왼쪽 손가락 조이스틱.
 *   보내는 방향 d 는 땅 기준 8방향 (0 = 북(-y), 시계 방향) — 사람마다 카메라가 달라서.
 *   부딪히면 벽을 따라 미끄러짐. 0.1초마다 바뀐 위치를 서버로.
 * 다른 사람: 받은 위치를 0.12초 늦게 보여 주며 사이를 이어 그림 (끊김 없이).
 */

export interface EngineHooks {
  /** 문 앞에 서거나 벗어남 (board = 안내판) */
  onNear(b: Building | "board" | null): void;
  /** 건물을 눌러서 걸어가 문 앞에 닿음 → 카드 열기 */
  onArrive(b: Building | "board"): void;
  /** E · 스페이스 */
  onInteract(): void;
  /** 내 위치 보내기 */
  send(x: number, y: number, d: number, m: 0 | 1): void;
  /** 마을 전체 지도를 켜고 끔 (엔진이 스스로 끌 때도) */
  onOverview(on: boolean): void;
  /** 3D 를 못 여는 기기 · 파일을 못 받음 */
  onError(msg: string): void;
}

interface Sample {
  t: number;
  x: number;
  y: number;
  d: number;
  m: 0 | 1;
}

interface AvatarView {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  ghost: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  shadow: THREE.Mesh;
  /** 시트별 이 사람 전용 그림 (같은 그림 파일을 나눠 씀 — 넘기는 칸만 다름) */
  tex: Map<string, THREE.Texture>;
}

/** 3D 캐릭터 한 명 (모델을 뼈까지 복제 — 그림 · 모양 데이터는 나눠 씀) */
interface RigView {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  walk: THREE.AnimationAction | null;
  idle: THREE.AnimationAction | null;
  /** 가려졌을 때만 보이는 반투명 몸 */
  ghosts: THREE.Object3D[];
  shadow: THREE.Mesh;
  moving: boolean;
}

interface Avatar {
  id: string;
  name: string;
  guest: boolean;
  c: PlayerWire["c"];
  x: number;
  y: number;
  d: number;
  moving: boolean;
  /** 애니메이션 시계 (ms) */
  phase: number;
  samples: Sample[];
  bubble: { text: string; until: number; lines: string[] | null } | null;
  view?: AvatarView;
  rig?: RigView;
  /** 3D: 지금 보는 쪽 (라디안, 땅 위 +y 쪽이 0) · 돌아설 쪽 */
  face?: number;
  faceTo?: number;
}

const GRID = 0.5;
const INTERP_MS = 120;
/** 화면에 보이는 캐릭터 키 (px) — 화면 폭에서 보이는 너비(m)를 정함 */
const TARGET_PX_WIDE = 70;
const TARGET_PX_SMALL = 56;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 2.2;
const COS_P = Math.cos(PITCH);
/** 왼쪽 끌기 1px 에 돌아가는 각도 · 카메라 높이 범위 (땅에서 위로) */
const ROT_PER_PX = 0.0085;
const PITCH_MIN = (18 * Math.PI) / 180;
const PITCH_MAX = (72 * Math.PI) / 180;
const SUN_OFF = new THREE.Vector3(-34, 52, 30);
/** 3D 캐릭터: 키 1 짜리 모델을 판과 같은 화면 키로 (세운 키 h 는 화면에서 h·cos35 로 보임) */
const RIG_SCALE = CHAR_TALL / Math.cos(PITCH);
/** 툰 명암: 빛 방향 (화면 기준 — 보는 사람 왼쪽 위 앞에서, 얼굴이 늘 밝게) · 그늘 밝기 · 외곽선 두께(화면 px) · 색 */
const TOON_LIGHT = new THREE.Vector3(-0.45, 0.55, 0.7).normalize();
const TOON_SHADE = 0.8;
const INK_PX = 1.0;
const INK_COLOR = 0x3a2a3e;
/** 눈 조각: 얼굴 위에 살짝 띄움 · 앞머리 위로 한 번 더 그릴 때 당기는 거리 (모델 키 1 기준, 앞머리~눈 틈 0.07) */
const EYE_LIFT = 0.004 * RIG_SCALE;
const EYE_OVER = 0.12 * RIG_SCALE;

type RigMats = {
  toon: THREE.Material;
  ink: THREE.Material;
  ghost: THREE.Material;
  eyeBase?: THREE.Material;
  eyeOver?: THREE.Material;
};

/** GLB 안의 눈 조각 (bake 에서 "eyes" 로 만든 것) */
function isEyes(o: THREE.Object3D) {
  return o.name.startsWith("eyes") || (o.parent?.name.startsWith("eyes") ?? false);
}

/** 땅 기준 8 방향 → 땅 위 방향 벡터 (0 = 북(-y), 시계 방향) */
function dirVec(d: number): [number, number] {
  const a = (d * Math.PI) / 4;
  return [Math.sin(a), -Math.cos(a)];
}
/** 땅 기준 8 방향 → 3D 가 보는 쪽 (라디안) */
function faceOfDir(d: number): number {
  const [x, y] = dirVec(d);
  return Math.atan2(x, y);
}

interface RigModel {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

export class TownEngine {
  private ctx: CanvasRenderingContext2D;
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 900);
  private town: TownScene | null = null;
  private cw = 0;
  private ch = 0;
  private dpr = 1;
  private phone = false;
  /** 카메라가 보는 땅 위 점 */
  private cam = { x: 54, y: 52 };
  /** 화면 폭에 들어가는 m (지금 · 기본) */
  private vw = 34;
  private baseVw = 34;
  private zoom = 1;
  /** 카메라가 있는 쪽 (땅 위, 라디안 — +y 쪽이 0, 처음 남동 45°) */
  private camYaw = YAW;
  /** 카메라 높이 각 (처음 35°) */
  private camPitch = PITCH;
  private camDir = new THREE.Vector3();
  /** 마우스 왼쪽 끌기 (시점 돌리기) · 폰 두 손가락 각도 */
  private drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
  private overview = false;
  private shadowVw = 0;
  private raf = 0;
  private last = 0;
  private t0 = performance.now();
  private dead = false;

  private me: Avatar | null = null;
  private others = new Map<string, Avatar>();
  private keys = new Set<string>();
  private path: { x: number; y: number }[] = [];
  private goal: Building | "board" | null = null;
  private stuck = 0;
  private joy: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  /** 조이스틱이 아닌 손가락 (누르기 · 두 손가락 확대) */
  private touches = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  private pinch: {
    d: number;
    zoom: number;
    ang: number;
    yaw: number;
    my: number;
    pitch: number;
  } | null = null;
  private near: Building | "board" | null = null;
  private hover: Building | null = null;
  private sent = { x: 0, y: 0, d: -1, m: -1 as number, at: 0 };
  private typing = false;
  private walkRate = 1.15;

  private sheets = new Map<string, THREE.Texture>();
  private models = new Map<string, RigModel>();
  /** 3D 캐릭터 공용 재질 (툰 · 외곽선 · 가려졌을 때) — 캐릭터 종류마다 하나 */
  private rigMats = new Map<string, RigMats>();
  private toonU = { uLight: { value: new THREE.Vector3() }, uShade: { value: TOON_SHADE } };
  private inkU = { uInk: { value: 0.004 } };
  private sheetGeo = new Map<string, THREE.BufferGeometry>();
  private shadowGeo = new THREE.CircleGeometry(0.42, 24);
  private shadowMat = new THREE.MeshBasicMaterial({
    color: 0x14202a,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
  });
  private ray = new THREE.Raycaster();
  private walk: Uint8Array;
  private gw = Math.ceil(WORLD.w / GRID);
  private gh = Math.ceil(WORLD.h / GRID);
  private ro: ResizeObserver;

  constructor(
    private canvas: HTMLCanvasElement,
    private ui: HTMLCanvasElement,
    private hooks: EngineHooks
  ) {
    this.ctx = ui.getContext("2d")!;
    this.phone = matchMedia("(pointer: coarse)").matches;
    // 3D 를 못 여는 기기면 여기서 던짐 → 화면이 안내
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // 걸을 수 있는 격자 (길 찾기)
    this.walk = new Uint8Array(this.gw * this.gh);
    for (let gy = 0; gy < this.gh; gy++)
      for (let gx = 0; gx < this.gw; gx++)
        this.walk[gy * this.gw + gx] = blocked((gx + 0.5) * GRID, (gy + 0.5) * GRID, RADIUS + 0.06)
          ? 0
          : 1;
    // 캐릭터 그림
    const tl = new THREE.TextureLoader();
    for (const [c, def] of Object.entries(CHARS))
      for (const d of Object.values(def.dirs))
        for (const sh of [d.walk, d.idle]) {
          const t = tl.load(`${def.base}/${sh.file}`);
          t.colorSpace = THREE.SRGBColorSpace;
          t.magFilter = THREE.LinearFilter;
          t.repeat.set(1 / sh.n, 1);
          this.sheets.set(`${c}/${sh.file}`, t);
        }
    // 3D 캐릭터 (있는 것만, 못 받으면 판으로)
    const gl = new GLTFLoader();
    for (const [c, def] of Object.entries(CHARS))
      if (def.model)
        gl.loadAsync(def.model).then(
          (g) => {
            if (this.dead) return;
            this.models.set(c, { scene: g.scene, clips: g.animations });
            this.rigMats.set(c, this.makeRigMats(g.scene));
            // 판으로 서 있던 사람들을 3D 로
            for (const a of [...this.others.values(), ...(this.me ? [this.me] : [])])
              if (a.c === c) this.dropView(a);
          },
          (err) => console.error("[gmtown] 3D 캐릭터", err)
        );
    buildTown().then(
      (s) => {
        if (this.dead) return s.dispose();
        this.town = s;
        const size = this.phone ? 1024 : 2048;
        s.sun.shadow.mapSize.set(size, size);
      },
      (err) => {
        console.error("[gmtown]", err);
        this.hooks.onError("마을 그림을 받지 못했어요. 새로 고침 해 주세요.");
      }
    );
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
    window.addEventListener("blur", this.onBlur);
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
    canvas.addEventListener("pointerleave", this.onLeave);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.onMenu);
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
    window.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onUp);
    this.canvas.removeEventListener("pointerleave", this.onLeave);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onMenu);
    for (const a of [...this.others.values(), ...(this.me ? [this.me] : [])]) this.dropView(a);
    for (const t of this.sheets.values()) t.dispose();
    for (const g of this.sheetGeo.values()) g.dispose();
    for (const m of this.rigMats.values()) for (const x of Object.values(m)) x?.dispose();
    for (const m of this.models.values())
      m.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          for (const mt of [o.material].flat()) {
            (mt as THREE.MeshStandardMaterial).map?.dispose();
            mt.dispose();
          }
        }
      });
    this.shadowGeo.dispose();
    this.shadowMat.dispose();
    this.town?.dispose();
    this.renderer.dispose();
  }

  // ───────────── 서버에서 온 것 ─────────────

  reset(s: TownSnap) {
    for (const a of this.others.values()) this.dropView(a);
    this.others.clear();
    const mine = s.players.find((p) => p.id === s.me);
    for (const p of s.players) if (p.id !== s.me) this.others.set(p.id, this.avatarOf(p));
    // 다시 연결된 경우 화면의 내 위치를 그대로 씀 (서버가 새로 정한 곳으로 순간이동하지 않게)
    const keep = this.me ? { x: this.me.x, y: this.me.y } : null;
    if (this.me) this.dropView(this.me);
    this.me = mine ? this.avatarOf(mine) : null;
    if (this.me) {
      this.me.id = s.me;
      if (keep && !blocked(keep.x, keep.y)) {
        this.me.x = keep.x;
        this.me.y = keep.y;
        this.sent.at = 0;
        this.sent.m = -1;
      } else this.cam = { x: this.me.x, y: this.me.y };
    }
  }
  join(p: PlayerWire) {
    if (p.id === this.me?.id) return;
    const old = this.others.get(p.id);
    if (old) this.dropView(old);
    this.others.set(p.id, this.avatarOf(p));
  }
  leave(id: string) {
    const a = this.others.get(id);
    if (a) this.dropView(a);
    this.others.delete(id);
  }
  moves(list: MoveWire[]) {
    const t = performance.now();
    for (const [id, x, y, d, m] of list) {
      const a = this.others.get(id);
      if (!a) continue;
      a.samples.push({ t, x, y, d, m });
      if (a.samples.length > 24) a.samples.splice(0, a.samples.length - 24);
    }
  }
  chat(c: ChatWire) {
    const a = c.id === this.me?.id ? this.me : this.others.get(c.id);
    if (!a) return;
    a.bubble = { text: c.text, until: performance.now() + 4200 + c.text.length * 70, lines: null };
  }
  /** 서버가 위치를 바로잡음 */
  snap(x: number, y: number) {
    if (!this.me) return;
    this.me.x = x;
    this.me.y = y;
    this.path = [];
  }
  setTyping(v: boolean) {
    this.typing = v;
    if (v) this.keys.clear();
  }
  /** 내 위치 (채널을 옮길 때 이어서) */
  pos(): { x: number; y: number } | null {
    return this.me
      ? { x: Math.round(this.me.x * 100) / 100, y: Math.round(this.me.y * 100) / 100 }
      : null;
  }
  /** 지금 서 있는 문 앞 */
  nearNow() {
    return this.near;
  }
  /** 사람 수 (나 포함) */
  count() {
    return this.others.size + (this.me ? 1 : 0);
  }
  /** 당기기(f < 1) · 밀기(f > 1) */
  zoomBy(f: number) {
    if (this.overview) return this.setOverview(false);
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom * f));
  }
  setOverview(on: boolean) {
    if (on === this.overview) return;
    this.overview = on;
    this.hooks.onOverview(on);
  }

  private avatarOf(p: PlayerWire): Avatar {
    return {
      id: p.id,
      name: p.name,
      guest: p.guest,
      c: p.c,
      x: p.x,
      y: p.y,
      d: p.d,
      moving: !!p.m,
      phase: Math.random() * 1000,
      samples: [{ t: performance.now(), x: p.x, y: p.y, d: p.d, m: p.m }],
      bubble: null,
    };
  }

  // ───────────── 화면 크기 · 좌표 ─────────────

  private resize() {
    const host = this.canvas.parentElement ?? this.canvas;
    const cw = Math.max(1, host.clientWidth),
      ch = Math.max(1, host.clientHeight);
    const dpr = Math.min(this.phone ? 1.6 : 2, window.devicePixelRatio || 1);
    this.cw = cw;
    this.ch = ch;
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cw, ch, false);
    this.canvas.style.width = this.ui.style.width = `${cw}px`;
    this.canvas.style.height = this.ui.style.height = `${ch}px`;
    this.ui.width = Math.round(cw * dpr);
    this.ui.height = Math.round(ch * dpr);
    // 캐릭터가 넓은 화면 70px · 좁은 화면 56px 쯤으로 보이게, 세로로도 너무 좁지 않게
    const px = cw >= 900 ? TARGET_PX_WIDE : TARGET_PX_SMALL;
    this.baseVw = Math.max(14, Math.min(60, Math.max((cw * CHAR_TALL) / px, (cw / ch) * 9)));
  }

  /** 화면 px → 땅 위 점 */
  private ground(px: number, py: number): { x: number; y: number } | null {
    this.ray.setFromCamera(
      new THREE.Vector2((px / this.cw) * 2 - 1, -(py / this.ch) * 2 + 1),
      this.camera
    );
    const o = this.ray.ray.origin,
      d = this.ray.ray.direction;
    if (Math.abs(d.y) < 1e-6) return null;
    const t = -o.y / d.y;
    return { x: o.x + d.x * t, y: o.z + d.z * t };
  }
  /** 땅 위 점 (높이 h) → 화면 px */
  private screen(x: number, y: number, h = 0): { x: number; y: number } {
    const v = new THREE.Vector3(x, h, y).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.cw, y: ((1 - v.y) / 2) * this.ch };
  }

  // ───────────── 입력 ─────────────

  private onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || this.typing) return;
    const k = e.key.toLowerCase();
    const map: Record<string, string> = {
      w: "u",
      arrowup: "u",
      s: "d",
      arrowdown: "d",
      a: "l",
      arrowleft: "l",
      d: "r",
      arrowright: "r",
    };
    const m = map[k];
    if (m) {
      e.preventDefault();
      if (e.type === "keydown") {
        this.keys.add(m);
        this.path = [];
        this.goal = null;
        if (this.overview) this.setOverview(false);
      } else this.keys.delete(m);
      return;
    }
    if (e.type !== "keydown") return;
    if (k === "e" || k === " ") {
      e.preventDefault();
      this.hooks.onInteract();
    } else if (k === "m") this.setOverview(!this.overview);
    else if (k === "=" || k === "+") this.zoomBy(1 / 1.2);
    else if (k === "-" || k === "_") this.zoomBy(1.2);
  };
  private onBlur = () => this.keys.clear();

  private pickTarget(px: number, py: number): Building | "board" | null {
    if (!this.town) return null;
    this.ray.setFromCamera(
      new THREE.Vector2((px / this.cw) * 2 - 1, -(py / this.ch) * 2 + 1),
      this.camera
    );
    let best: { d: number; b: Building } | null = null;
    for (const v of this.town.buildings) {
      const hit = this.ray.intersectObject(v.pick, false)[0];
      if (hit && (!best || hit.distance < best.d)) best = { d: hit.distance, b: v.b };
    }
    if (best) return best.b;
    const s = this.screen(BOARD.x, BOARD.y, 1.4);
    const ppm = this.cw / this.vw;
    if (Math.abs(px - s.x) < ppm * 0.9 && Math.abs(py - s.y) < ppm * 0.9) return "board";
    return null;
  }

  private tap(px: number, py: number) {
    const t = this.pickTarget(px, py);
    if (this.overview) this.setOverview(false);
    if (t === "board") return this.walkTo(BOARD.x + 0.6, BOARD.y + 0.6, "board");
    if (t) return this.walkTo(doorFront(t).x, doorFront(t).y, t);
    const g = this.ground(px, py);
    if (g) this.walkTo(g.x, g.y, null);
  }

  private onDown = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    const px = e.clientX - r.left,
      py = e.clientY - r.top;
    if (e.pointerType === "touch") {
      // 왼쪽 40% 는 조이스틱 (지도 볼 때는 빼고)
      if (px < this.cw * 0.4 && !this.joy && !this.overview && !this.touches.size) {
        this.joy = { id: e.pointerId, ox: px, oy: py, x: px, y: py };
        this.path = [];
        this.goal = null;
      } else {
        this.touches.set(e.pointerId, { x: px, y: py, sx: px, sy: py });
        if (this.touches.size === 2) {
          const [a, b] = [...this.touches.values()];
          this.pinch = {
            d: Math.hypot(a.x - b.x, a.y - b.y),
            zoom: this.zoom,
            ang: Math.atan2(b.y - a.y, b.x - a.x),
            yaw: this.camYaw,
            my: (a.y + b.y) / 2,
            pitch: this.camPitch,
          };
        }
      }
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    // 왼쪽 = 시점 돌리기 (끌기), 오른쪽 = 그곳으로 걷기 · 건물로 가기
    if (e.button === 0 && !this.overview) {
      this.drag = { x: px, y: py, yaw: this.camYaw, pitch: this.camPitch };
      this.canvas.setPointerCapture(e.pointerId);
    } else if (e.button === 2 || (e.button === 0 && this.overview)) this.tap(px, py);
  };
  private onMenu = (e: MouseEvent) => e.preventDefault();
  private clampPitch(p: number) {
    return Math.max(PITCH_MIN, Math.min(PITCH_MAX, p));
  }
  private onMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    const px = e.clientX - r.left,
      py = e.clientY - r.top;
    if (this.joy && e.pointerId === this.joy.id) {
      this.joy.x = px;
      this.joy.y = py;
      return;
    }
    const t = this.touches.get(e.pointerId);
    if (t) {
      t.x = px;
      t.y = py;
      if (this.pinch && this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.overview && d < this.pinch.d * 0.9) return;
        if (this.overview && d > this.pinch.d * 1.15) this.setOverview(false);
        this.zoom = Math.max(
          ZOOM_MIN,
          Math.min(ZOOM_MAX, (this.pinch.zoom * this.pinch.d) / Math.max(20, d))
        );
        // 두 손가락을 돌리면 시점도 같이
        if (!this.overview) {
          this.camYaw = this.pinch.yaw - (Math.atan2(b.y - a.y, b.x - a.x) - this.pinch.ang);
          // 두 손가락을 같이 위아래로 밀면 높이
          this.camPitch = this.clampPitch(
            this.pinch.pitch + ((a.y + b.y) / 2 - this.pinch.my) * ROT_PER_PX * 0.7
          );
        }
      }
      return;
    }
    if (e.pointerType !== "mouse") return;
    if (this.drag) {
      if (Math.hypot(px - this.drag.x, py - this.drag.y) > 3) this.canvas.style.cursor = "grabbing";
      this.camYaw = this.drag.yaw - (px - this.drag.x) * ROT_PER_PX;
      this.camPitch = this.clampPitch(this.drag.pitch + (py - this.drag.y) * ROT_PER_PX * 0.7);
      return;
    }
    const p = this.pickTarget(px, py);
    this.hover = p && p !== "board" ? p : null;
    this.canvas.style.cursor = p ? "pointer" : "default";
  };
  private onUp = (e: PointerEvent) => {
    if (this.drag && e.pointerType === "mouse") {
      this.drag = null;
      this.canvas.style.cursor = "default";
      return;
    }
    if (this.joy && e.pointerId === this.joy.id) {
      this.joy = null;
      return;
    }
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    this.touches.delete(e.pointerId);
    const wasPinch = !!this.pinch;
    if (this.touches.size < 2) this.pinch = null;
    // 손가락 하나로 짧게 누르면 그곳으로
    if (
      !wasPinch &&
      !this.touches.size &&
      e.type === "pointerup" &&
      Math.hypot(t.x - t.sx, t.y - t.sy) < 12
    )
      this.tap(t.x, t.y);
  };
  private onLeave = () => {
    this.hover = null;
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0 && this.overview) return this.setOverview(false);
    this.zoomBy(Math.pow(1.0015, e.deltaY));
  };

  /** 그곳까지 걸어감 (goal 이 있으면 닿았을 때 onArrive) */
  walkTo(x: number, y: number, goal: Building | "board" | null) {
    if (!this.me) return;
    const p = this.findPath(this.me.x, this.me.y, x, y);
    this.path = p;
    this.goal = goal;
    this.stuck = 0;
    if (!p.length && goal) this.hooks.onArrive(goal);
  }

  // ───────────── 길 찾기 (A* · 0.5m 격자) ─────────────

  private cell(x: number, y: number) {
    return [
      Math.max(0, Math.min(this.gw - 1, Math.floor(x / GRID))),
      Math.max(0, Math.min(this.gh - 1, Math.floor(y / GRID))),
    ] as const;
  }
  private open(gx: number, gy: number) {
    return gx >= 0 && gy >= 0 && gx < this.gw && gy < this.gh && this.walk[gy * this.gw + gx] === 1;
  }
  /** 막힌 칸이면 가장 가까운 열린 칸 */
  private nearestOpen(gx: number, gy: number): [number, number] | null {
    if (this.open(gx, gy)) return [gx, gy];
    for (let r = 1; r < 16; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
          if ((Math.abs(dx) === r || Math.abs(dy) === r) && this.open(gx + dx, gy + dy))
            return [gx + dx, gy + dy];
    return null;
  }
  private clear(ax: number, ay: number, bx: number, by: number) {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.15);
    for (let i = 1; i <= n; i++)
      if (blocked(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, RADIUS + 0.02)) return false;
    return true;
  }
  private findPath(fx: number, fy: number, tx: number, ty: number): { x: number; y: number }[] {
    const [sgx, sgy] = this.cell(fx, fy);
    const end = this.nearestOpen(...this.cell(tx, ty));
    if (!end) return [];
    const exact = this.open(...this.cell(tx, ty)) && !blocked(tx, ty);
    const goal = exact ? { x: tx, y: ty } : { x: (end[0] + 0.5) * GRID, y: (end[1] + 0.5) * GRID };
    if (this.clear(fx, fy, goal.x, goal.y))
      return Math.hypot(goal.x - fx, goal.y - fy) < 0.05 ? [] : [goal];
    const W = this.gw;
    const N = W * this.gh;
    const g = new Float32Array(N).fill(Infinity);
    const from = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap: [number, number][] = [];
    const push = (f: number, i: number) => {
      heap.push([f, i]);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heap[p][0] <= heap[k][0]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const lastEl = heap.pop()!;
      if (heap.length) {
        heap[0] = lastEl;
        let k = 0;
        for (;;) {
          const l = k * 2 + 1,
            r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    const start = this.nearestOpen(sgx, sgy);
    if (!start) return [];
    const si = start[1] * W + start[0],
      ei = end[1] * W + end[0];
    const h = (i: number) => {
      const dx = Math.abs((i % W) - end[0]),
        dy = Math.abs(((i / W) | 0) - end[1]);
      return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
    };
    g[si] = 0;
    push(h(si), si);
    let found = false;
    let steps = 0;
    while (heap.length && steps++ < 60000) {
      const [, i] = pop();
      if (closed[i]) continue;
      closed[i] = 1;
      if (i === ei) {
        found = true;
        break;
      }
      const cx = i % W,
        cy = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx,
            ny = cy + dy;
          if (!this.open(nx, ny)) continue;
          if (dx && dy && (!this.open(cx + dx, cy) || !this.open(cx, cy + dy))) continue;
          const j = ny * W + nx;
          const ng = g[i] + (dx && dy ? 1.414 : 1);
          if (ng < g[j]) {
            g[j] = ng;
            from[j] = i;
            push(ng + h(j), j);
          }
        }
    }
    if (!found) return [];
    const pts: { x: number; y: number }[] = [];
    for (let i = ei; i !== -1 && i !== si; i = from[i])
      pts.push({ x: ((i % W) + 0.5) * GRID, y: (((i / W) | 0) + 0.5) * GRID });
    pts.reverse();
    pts[pts.length - 1] = goal;
    // 직선으로 펴기: 보이는 가장 먼 점으로 바로
    const out: { x: number; y: number }[] = [];
    let cur = { x: fx, y: fy };
    let k = 0;
    while (k < pts.length) {
      let far = k;
      for (let j = pts.length - 1; j > k; j--)
        if (this.clear(cur.x, cur.y, pts[j].x, pts[j].y)) {
          far = j;
          break;
        }
      out.push(pts[far]);
      cur = pts[far];
      k = far + 1;
    }
    return out;
  }

  // ───────────── 한 장면 ─────────────

  private frame = (now: number) => {
    if (this.dead) return;
    // 느린 기기 · 뒤로 간 탭에서도 걷는 속도가 같게: 지난 시간을 다 쓰되 (최대 0.25초) 잘게 나눠 움직임
    const dt = Math.min(0.25, (now - (this.last || now)) / 1000);
    this.last = now;
    this.update(dt, now);
    this.render(now, dt);
    this.raf = requestAnimationFrame(this.frame);
  };

  /** 입력 · 길 따라가기 · 부딪힘을 짧은 시간 h 만큼 (한 장면을 여러 번 나눠서) */
  private step(me: Avatar, h: number): { moving: boolean; speed: number } {
    // 키 · 조이스틱은 화면 방향 → 땅 방향으로
    let sx = 0,
      sy = 0;
    if (this.keys.has("l")) sx -= 1;
    if (this.keys.has("r")) sx += 1;
    if (this.keys.has("u")) sy -= 1;
    if (this.keys.has("d")) sy += 1;
    let speed = SPEED;
    if (this.joy) {
      const dx = this.joy.x - this.joy.ox,
        dy = this.joy.y - this.joy.oy;
      const len = Math.hypot(dx, dy);
      if (len > 8) {
        sx = dx / len;
        sy = dy / len;
        speed = SPEED * Math.min(1, len / 46);
      }
    }
    let vx = 0,
      vy = 0;
    if (sx || sy) [vx, vy] = fromScreen(sx, sy, this.camYaw, this.camPitch);
    if (!vx && !vy && this.path.length) {
      const p = this.path[0];
      const dx = p.x - me.x,
        dy = p.y - me.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.08) {
        this.path.shift();
        if (!this.path.length && this.goal) {
          const g = this.goal;
          this.goal = null;
          this.hooks.onArrive(g);
        }
      } else {
        vx = dx / dist;
        vy = dy / dist;
        if (dist < SPEED * h) speed = dist / h;
      }
    }
    const len = Math.hypot(vx, vy);
    const moving = len > 0;
    if (moving) {
      vx /= len;
      vy /= len;
      const nx = me.x + vx * speed * h,
        ny = me.y + vy * speed * h;
      const ox = me.x,
        oy = me.y;
      if (!blocked(nx, ny)) {
        me.x = nx;
        me.y = ny;
      } else if (!blocked(nx, me.y)) me.x = nx;
      else if (!blocked(me.x, ny)) me.y = ny;
      const moved = Math.hypot(me.x - ox, me.y - oy);
      // 길을 따라가다 막히면 포기
      if (this.path.length && moved < speed * h * 0.2) {
        this.stuck += h;
        if (this.stuck > 0.4) {
          this.path = [];
          this.goal = null;
        }
      } else this.stuck = 0;
      me.d = dir8(vx, vy);
      me.faceTo = Math.atan2(vx, vy);
    }
    return { moving, speed };
  }

  private update(dt: number, now: number) {
    const me = this.me;
    if (me) {
      const n = Math.max(1, Math.ceil(dt / 0.04));
      let moving = false,
        speed = SPEED;
      for (let i = 0; i < n; i++) ({ moving, speed } = this.step(me, dt / n));
      if (moving !== me.moving) {
        me.moving = moving;
        me.phase = 0;
      }
      me.phase += dt * 1000 * (moving ? Math.max(0.55, speed / SPEED) : 1);
      this.walkRate = 1.15 * (moving ? Math.max(0.55, speed / SPEED) : 1);
      // 보내기 (0.1초마다, 바뀐 게 있을 때만)
      const m = moving ? 1 : 0;
      if (
        now - this.sent.at >= 100 &&
        (Math.hypot(me.x - this.sent.x, me.y - this.sent.y) > 0.01 ||
          me.d !== this.sent.d ||
          m !== this.sent.m)
      ) {
        this.sent = { x: me.x, y: me.y, d: me.d, m, at: now };
        this.hooks.send(Math.round(me.x * 100) / 100, Math.round(me.y * 100) / 100, me.d, m);
      }
      // 문 앞
      const b = doorAt(me.x, me.y);
      const nb: Building | "board" | null =
        b ?? (Math.hypot(me.x - BOARD.x, me.y - BOARD.y) < 1.5 ? "board" : null);
      if (nb !== this.near) {
        this.near = nb;
        this.hooks.onNear(nb);
      }
    }
    // 카메라: 지도면 마을 가운데, 아니면 나를 따라감 (문 앞이면 건물 쪽(화면 위)으로 조금)
    let tx = this.cam.x,
      ty = this.cam.y;
    if (this.overview) {
      tx = (BOUNDS.x0 + BOUNDS.x1) / 2;
      ty = (BOUNDS.y0 + BOUNDS.y1) / 2;
    } else if (me) {
      const lean =
        this.near && this.near !== "board" && !isLot(this.near)
          ? Math.min(2.6, this.near.h * 0.4)
          : 0;
      tx = Math.max(BOUNDS.x0 + 3, Math.min(BOUNDS.x1 - 3, me.x - lean * Math.sin(this.camYaw)));
      ty = Math.max(BOUNDS.y0 + 3, Math.min(BOUNDS.y1 - 3, me.y - lean * Math.cos(this.camYaw)));
    }
    const k = Math.min(1, dt * (this.overview ? 4 : 7));
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
    const aspect = this.cw / this.ch;
    const want = this.overview ? Math.max(124, 84 * aspect) : this.baseVw * this.zoom;
    this.vw += (want - this.vw) * Math.min(1, dt * 6);

    // 다른 사람: 0.12초 늦게 이어 그리기
    const rt = now - INTERP_MS;
    for (const a of this.others.values()) {
      const s = a.samples;
      while (s.length > 2 && s[1].t <= rt) s.shift();
      let x = s[0].x,
        y = s[0].y,
        d = s[0].d,
        m = s[0].m;
      if (s.length > 1 && rt > s[0].t) {
        const u = Math.min(1, (rt - s[0].t) / Math.max(1, s[1].t - s[0].t));
        x = s[0].x + (s[1].x - s[0].x) * u;
        y = s[0].y + (s[1].y - s[0].y) * u;
        d = s[1].d;
        m = s[1].m;
        if (u >= 1) {
          x = s[1].x;
          y = s[1].y;
        }
      }
      const moving = m === 1 && now - s[s.length - 1].t < 400;
      if (moving !== a.moving) {
        a.moving = moving;
        a.phase = 0;
      }
      a.x = x;
      a.y = y;
      if (d !== a.d || a.faceTo === undefined) a.faceTo = faceOfDir(d);
      a.d = d;
      a.phase += dt * 1000;
    }
  }

  // ───────────── 사람 그리기 ─────────────

  /** 시트 하나의 판 (발이 원점, 35° 로 눌린 만큼 세로로 늘림) */
  private geoOf(def: (typeof CHARS)[keyof typeof CHARS], sh: Sheet) {
    const key = `${def.base}/${sh.file}`;
    let g = this.sheetGeo.get(key);
    if (!g) {
      const hs = (CHAR_TALL * sh.h) / def.tall,
        ws = (hs * sh.w) / sh.h;
      const hp = hs / COS_P;
      g = new THREE.PlaneGeometry(ws, hp);
      g.translate(ws * (0.5 - sh.ax / sh.w), hp / 2 - ((sh.h - sh.ay) / sh.h) * hp, 0);
      this.sheetGeo.set(key, g);
    }
    return g;
  }

  private viewOf(a: Avatar): AvatarView | null {
    if (a.view) return a.view;
    const town = this.town;
    if (!town) return null;
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    const gmat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.34,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    const ghost = new THREE.Mesh(new THREE.BufferGeometry(), gmat);
    mesh.rotation.y = ghost.rotation.y = this.camYaw;
    mesh.renderOrder = 3;
    ghost.renderOrder = 10;
    const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.y = 0.62;
    shadow.renderOrder = 1;
    town.scene.add(mesh, ghost, shadow);
    a.view = { mesh, ghost, shadow, tex: new Map() };
    return a.view;
  }
  private dropView(a: Avatar) {
    const r = a.rig;
    if (r) {
      r.mixer.stopAllAction();
      r.root.removeFromParent();
      for (const g of r.ghosts) g.removeFromParent();
      r.shadow.removeFromParent();
      a.rig = undefined;
    }
    const v = a.view;
    if (!v) return;
    v.mesh.removeFromParent();
    v.ghost.removeFromParent();
    v.shadow.removeFromParent();
    v.mesh.material.dispose();
    v.ghost.material.dispose();
    for (const t of v.tex.values()) t.dispose();
    a.view = undefined;
  }
  // ───────────── 3D 캐릭터 ─────────────

  /** 툰: 빛 방향으로 2단 (조명 계산 안 씀) · 외곽선: 뒤집은 껍데기를 법선 쪽으로 · 가려졌을 때: 반투명 위에 */
  private makeRigMats(scene: THREE.Object3D) {
    let map: THREE.Texture | null = null,
      eyeMap: THREE.Texture | null = null;
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const t = (o.material as THREE.MeshStandardMaterial).map ?? null;
      if (isEyes(o)) eyeMap ??= t;
      else map ??= t;
    });
    const tex = map as THREE.Texture | null,
      etex = eyeMap as THREE.Texture | null;
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    if (tex) tex.anisotropy = aniso;
    if (etex) etex.anisotropy = aniso;
    const toon = new THREE.MeshToonMaterial({ map: tex });
    toon.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.toonU);
      sh.fragmentShader = sh.fragmentShader
        .replace("void main() {", "uniform vec3 uLight;\nuniform float uShade;\nvoid main() {")
        .replace(
          "#include <opaque_fragment>",
          `outgoingLight = diffuseColor.rgb * ( dot( normalize( normal ), uLight ) > 0.08 ? 1.0 : uShade );
#include <opaque_fragment>`
        );
    };
    const ink = new THREE.MeshBasicMaterial({ color: INK_COLOR, side: THREE.BackSide });
    ink.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.inkU);
      sh.vertexShader = sh.vertexShader
        .replace("void main() {", "uniform float uInk;\nvoid main() {")
        .replace(
          "#include <skinning_vertex>",
          "#include <skinning_vertex>\ntransformed += normalize( objectNormal ) * uInk;"
        );
    };
    const ghost = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.34,
      depthTest: false,
      depthWrite: false,
    });
    const mats: RigMats = { toon, ink, ghost };
    if (etex) {
      mats.eyeBase = this.eyeMat(etex, false);
      mats.eyeOver = this.eyeMat(etex, true);
    }
    return mats;
  }

  /**
   * 눈 조각 재질 — 그림은 멀리서도 또렷하게 (밉맵 한 단계 덜 흐리게).
   * over: 카메라 쪽으로 당겨서 앞머리 위로 한 번 더. 속눈썹(아주 어두운 곳)·흰자·눈동자(푸른 곳)만, 정면에서만 (뒤·옆에선 안 비침)
   */
  private eyeMat(map: THREE.Texture, over: boolean) {
    const m = new THREE.MeshToonMaterial({
      map,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      alphaTest: over ? 0 : 0.01,
    });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.toonU, {
        uBias: { value: over ? EYE_OVER : EYE_LIFT },
      });
      sh.vertexShader = sh.vertexShader
        .replace("void main() {", "uniform float uBias;\nvoid main() {")
        .replace(
          "#include <project_vertex>",
          "#include <project_vertex>\ngl_Position = projectionMatrix * ( mvPosition + vec4( 0.0, 0.0, uBias, 0.0 ) );"
        );
      sh.fragmentShader = sh.fragmentShader
        .replace("void main() {", "uniform vec3 uLight;\nuniform float uShade;\nvoid main() {")
        .replace(
          "#include <map_fragment>",
          `vec4 sampledDiffuseColor = texture2D( map, vMapUv, -0.8 );
diffuseColor *= sampledDiffuseColor;` +
            (over
              ? `
float eLum = dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
diffuseColor.a *= 0.95 * max( 1.0 - smoothstep( 0.03, 0.08, eLum ), smoothstep( -0.06, 0.0, sampledDiffuseColor.b - sampledDiffuseColor.r ) )
  * smoothstep( 0.35, 0.7, normalize( vNormal ).z );`
              : "")
        )
        .replace(
          "#include <opaque_fragment>",
          `outgoingLight = diffuseColor.rgb * ( dot( normalize( normal ), uLight ) > 0.08 ? 1.0 : uShade );
#include <opaque_fragment>`
        );
    };
    return m;
  }

  private rigOf(a: Avatar): RigView | null {
    if (a.rig) return a.rig;
    const town = this.town,
      model = this.models.get(a.c),
      mats = this.rigMats.get(a.c);
    if (!town || !model || !mats) return null;
    if (a.view) this.dropView(a);
    const root = cloneRig(model.scene);
    root.scale.setScalar(RIG_SCALE);
    const ghosts: THREE.Object3D[] = [];
    const skinned: THREE.SkinnedMesh[] = [];
    root.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) skinned.push(o);
      else if (o instanceof THREE.Mesh) o.visible = false; // 리깅 도구가 남긴 공 같은 것
    });
    for (const m of skinned) {
      if (isEyes(m)) {
        if (!mats.eyeBase || !mats.eyeOver) {
          m.visible = false;
          continue;
        }
        m.material = mats.eyeBase;
        m.frustumCulled = false;
        m.renderOrder = 4;
        const o = new THREE.SkinnedMesh(m.geometry, mats.eyeOver);
        o.bind(m.skeleton, m.bindMatrix);
        o.frustumCulled = false;
        o.renderOrder = 6;
        o.position.copy(m.position);
        o.quaternion.copy(m.quaternion);
        o.scale.copy(m.scale);
        m.parent!.add(o);
        continue;
      }
      m.material = mats.toon;
      m.frustumCulled = false;
      m.renderOrder = 3;
      for (const [mat, order] of [
        [mats.ink, 3],
        [mats.ghost, 10],
      ] as const) {
        const c = new THREE.SkinnedMesh(m.geometry, mat);
        c.bind(m.skeleton, m.bindMatrix);
        c.frustumCulled = false;
        c.renderOrder = order;
        c.position.copy(m.position);
        c.quaternion.copy(m.quaternion);
        c.scale.copy(m.scale);
        m.parent!.add(c);
        if (mat === mats.ghost) {
          c.visible = false;
          ghosts.push(c);
        }
      }
    }
    const mixer = new THREE.AnimationMixer(root);
    const clip = (n: string) => model.clips.find((c) => c.name.startsWith(n));
    const walk = clip("walk") ? mixer.clipAction(clip("walk")!) : null;
    const idle = clip("idle") ? mixer.clipAction(clip("idle")!) : null;
    // 사람마다 숨쉬기 박자를 조금씩 다르게
    if (idle) {
      idle.play();
      idle.time = Math.random() * idle.getClip().duration;
    }
    walk?.play();
    walk?.setEffectiveWeight(0);
    const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.y = 0.62;
    shadow.renderOrder = 1;
    town.scene.add(root, shadow);
    a.face = a.faceTo ?? faceOfDir(a.d);
    a.rig = { root, mixer, walk, idle, ghosts, shadow, moving: false };
    return a.rig;
  }

  private placeRig(a: Avatar, r: RigView, dt: number) {
    // 걷기 ↔ 숨쉬기 (0.18초 섞기), 걷는 속도에 맞춰 발 박자
    if (a.moving !== r.moving) {
      r.moving = a.moving;
      const [on, off] = a.moving ? [r.walk, r.idle] : [r.idle, r.walk];
      if (on && off) {
        on.reset().setEffectiveWeight(1).play();
        off.crossFadeTo(on, 0.18, false);
      }
    }
    if (r.walk) r.walk.timeScale = a === this.me ? this.walkRate : 1.15;
    r.mixer.update(dt);
    // 돌아서기 (짧은 쪽으로, 0.1초쯤)
    const to = a.faceTo ?? a.face ?? 0;
    let f = a.face ?? to;
    let df = ((to - f + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    f += df * Math.min(1, dt * 14);
    a.face = f;
    r.root.position.set(a.x, 0.02, a.y);
    r.root.rotation.y = f;
    r.shadow.position.set(a.x, 0.06, a.y);
    // 건물에 가려지면 반투명 몸을 위에
    const hidden =
      !this.overview &&
      this.town!.buildings.some((v) => hiddenBy(v.b, a.x, a.y, 0.9, this.camYaw, this.camPitch));
    for (const g of r.ghosts) g.visible = hidden;
  }

  private placeAvatar(a: Avatar, dt = 0) {
    if (this.models.has(a.c)) {
      const r = this.rigOf(a);
      if (r) return this.placeRig(a, r, dt);
    }
    const v = this.viewOf(a);
    if (!v) return;
    const def = CHARS[a.c];
    // 판: 땅 기준 방향 → 내 화면에서 보이는 방향으로
    const { dir, flip } = sheetOf(dir8(...toCam(...dirVec(a.d), this.camYaw)));
    v.mesh.rotation.y = v.ghost.rotation.y = this.camYaw;
    const ds = def.dirs[dir];
    const sh = a.moving ? ds.walk : ds.idle;
    const key = `${a.c}/${sh.file}`;
    let t = v.tex.get(key);
    if (!t) {
      const base = this.sheets.get(key);
      if (!base) return;
      t = base.clone();
      v.tex.set(key, t);
    }
    const fi = a.moving
      ? (ds.start + Math.floor(a.phase / WALK_MS)) % sh.n
      : Math.floor(a.phase / IDLE_MS) % sh.n;
    t.offset.x = fi / sh.n;
    const geo = this.geoOf(def, sh);
    for (const m of [v.mesh, v.ghost]) {
      if (m.geometry !== geo) m.geometry = geo;
      if (m.material.map !== t) {
        m.material.map = t;
        m.material.needsUpdate = true;
      }
      m.position.set(a.x, 0.05, a.y);
      m.scale.x = flip ? -1 : 1;
    }
    v.shadow.position.set(a.x, 0.06, a.y);
  }

  private render(now: number, dt: number) {
    const town = this.town;
    const t = (now - this.t0) / 1000;
    // 카메라
    const aspect = this.cw / this.ch;
    const cam = this.camera;
    cam.left = -this.vw / 2;
    cam.right = this.vw / 2;
    cam.top = this.vw / 2 / aspect;
    cam.bottom = -this.vw / 2 / aspect;
    cam.updateProjectionMatrix();
    const target = new THREE.Vector3(this.cam.x, 0, this.cam.y);
    const cp = Math.cos(this.camPitch);
    this.camDir.set(cp * Math.sin(this.camYaw), Math.sin(this.camPitch), cp * Math.cos(this.camYaw));
    cam.position.copy(target).addScaledVector(this.camDir, 220);
    cam.lookAt(target);
    cam.updateMatrixWorld();

    if (town) {
      // 그림자는 보이는 곳만 (화면 폭이 크게 바뀔 때만 다시)
      const sun = town.sun;
      sun.position.copy(target).add(SUN_OFF);
      sun.target.position.copy(target);
      const half = Math.min(90, this.vw * 0.75 + 8);
      if (Math.abs(half - this.shadowVw) > 2) {
        this.shadowVw = half;
        Object.assign(sun.shadow.camera, {
          left: -half,
          right: half,
          top: half,
          bottom: -half,
          near: 1,
          far: 260,
        });
        sun.shadow.camera.updateProjectionMatrix();
      }
      // 3D 캐릭터: 빛 방향은 카메라 기준으로, 외곽선은 화면에서 INK_PX 두께가 되게 (모델 안 단위로)
      this.toonU.uLight.value.copy(TOON_LIGHT);
      //   멀리서 볼 때(지도 · 밀기)는 그만큼 얇게, 당기면 조금만 두껍게
      const inkPx = INK_PX * Math.max(0.3, Math.min(1.25, this.baseVw / this.vw));
      this.inkU.uInk.value = (inkPx * this.vw) / Math.max(1, this.cw) / RIG_SCALE;
      // 사람
      for (const a of this.others.values()) this.placeAvatar(a, dt);
      if (this.me) this.placeAvatar(this.me, dt);
      // 내가 건물 뒤면 그 건물을 비치게
      for (const v of town.buildings) {
        const hide =
          !!this.me &&
          !this.overview &&
          hiddenBy(v.b, this.me.x, this.me.y, 0.9, this.camYaw, this.camPitch);
        const nf = v.fade + ((hide ? 1 : 0) - v.fade) * Math.min(1, dt * 10);
        if (Math.abs(nf - v.fade) < 1e-4 && !hide && v.fade === 0) continue;
        v.fade = nf < 0.005 && !hide ? 0 : nf;
        const op = 1 - v.fade * 0.55;
        for (const m of v.mats) {
          m.transparent = v.fade > 0;
          if (m instanceof THREE.ShaderMaterial) m.uniforms.alpha.value = op;
          else m.opacity = op;
        }
      }
      // 문 앞 고리 (서 있거나 마우스를 올린 건물)
      const ring = this.near && this.near !== "board" ? this.near : this.hover;
      town.doorRing.visible = !!ring;
      if (ring) {
        const f = doorFront(ring);
        town.doorRing.position.set(f.x, 0.05, f.y);
        town.doorRing.scale.setScalar(1 + Math.sin(t * 5) * 0.08);
        (town.doorRing.material as THREE.MeshBasicMaterial).color.set(ring.accent);
      }
      // 가는 곳
      const g = this.me && this.path.length ? this.path[this.path.length - 1] : null;
      town.goalRing.visible = !!g;
      if (g) {
        town.goalRing.position.set(g.x, 0.05, g.y);
        town.goalRing.scale.setScalar(1 + Math.sin(t * 8) * 0.12);
      }
      town.tick(t);
      this.renderer.render(town.scene, cam);
    }
    this.drawUi(now);
  }

  // ───────────── 위에 겹친 2D (이름표 · 말풍선 · 조이스틱) ─────────────

  private drawUi(now: number) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);
    if (!this.town) return;
    const people = [...this.others.values(), ...(this.me ? [this.me] : [])];
    // 앞(아래)에 있는 사람 이름표가 위에 오게
    people.sort((a, b) => a.x + a.y - (b.x + b.y));
    // 이름표 높이: 3D 는 머리 위 리본까지 키가 판보다 조금 큼
    const headH = CHAR_TALL / COS_P + (this.models.size ? 0.22 : 0);
    for (const a of people) {
      if (this.overview && a !== this.me) continue;
      const s = this.screen(a.x, a.y, headH);
      if (s.x < -80 || s.x > this.cw + 80 || s.y < -40 || s.y > this.ch + 120) continue;
      this.drawTag(a, s.x, s.y - 4, now);
    }

    // 조이스틱
    if (this.joy) {
      const { ox, oy, x, y } = this.joy;
      const dx = x - ox,
        dy = y - oy;
      const len = Math.min(46, Math.hypot(dx, dy));
      const a = Math.atan2(dy, dx);
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ox, oy, 52, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      ctx.arc(ox + Math.cos(a) * len, oy + Math.sin(a) * len, 22, 0, Math.PI * 2);
      ctx.fill();
    }

    // 가장자리 살짝 어둡게
    const vg = ctx.createRadialGradient(
      this.cw / 2,
      this.ch / 2,
      Math.min(this.cw, this.ch) * 0.45,
      this.cw / 2,
      this.ch / 2,
      Math.max(this.cw, this.ch) * 0.78
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(10,14,30,0.24)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, this.cw, this.ch);
  }

  private drawTag(a: Avatar, px: number, top: number, now: number) {
    const ctx = this.ctx;
    const isMe = a === this.me;
    ctx.font = `700 12px "Nanum Gothic", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(a.name).width + 14;
    ctx.fillStyle = isMe ? "rgba(60,40,0,0.72)" : "rgba(15,18,32,0.62)";
    rr(ctx, px - tw / 2, top - 9, tw, 18, 9);
    ctx.fill();
    ctx.fillStyle = isMe ? "#FFD36B" : a.guest ? "#C9D1E2" : "#FFFFFF";
    ctx.fillText(a.name, px, top);
    // 말풍선
    const b = a.bubble;
    if (b && now < b.until) {
      ctx.font = `700 13px "Nanum Gothic", sans-serif`;
      if (!b.lines) b.lines = wrap(ctx, b.text, 190);
      const lh = 17;
      const bw = Math.max(...b.lines.map((l) => ctx.measureText(l).width)) + 20;
      const bh = b.lines.length * lh + 12;
      const bx = px - bw / 2,
        by = top - 16 - bh;
      const fade = Math.min(1, (b.until - now) / 400);
      ctx.globalAlpha = fade;
      ctx.fillStyle = "#FFFFFF";
      ctx.strokeStyle = "rgba(26,18,42,0.85)";
      ctx.lineWidth = 1.5;
      rr(ctx, bx, by, bw, bh, 10);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px - 6, by + bh - 0.5);
      ctx.lineTo(px, by + bh + 7);
      ctx.lineTo(px + 6, by + bh - 0.5);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(px - 6, by + bh);
      ctx.lineTo(px, by + bh + 7);
      ctx.lineTo(px + 6, by + bh);
      ctx.stroke();
      ctx.fillStyle = "#1d1a2e";
      b.lines.forEach((l, i) => ctx.fillText(l, px, by + 6 + lh / 2 + i * lh));
      ctx.globalAlpha = 1;
    } else if (b) a.bubble = null;
    ctx.textAlign = "left";
  }

  // ───────────── 작은 지도 (화면과 같은 방향 — 시점을 돌리면 같이 돎) ─────────────

  drawMinimap(m: CanvasRenderingContext2D, w: number, h: number) {
    // 땅 (x, y) → 지도: 카메라 쪽으로 돌리고 세로를 sin35 로 눌러서 (화면과 같은 모양)
    const SP = Math.sin(this.camPitch);
    const C = Math.cos(this.camYaw),
      S = Math.sin(this.camYaw);
    const U = (x: number, y: number) => x * C - y * S,
      V = (x: number, y: number) => (x * S + y * C) * SP;
    const corners = [
      [BOUNDS.x0, BOUNDS.y0],
      [BOUNDS.x1, BOUNDS.y0],
      [BOUNDS.x1, BOUNDS.y1],
      [BOUNDS.x0, BOUNDS.y1],
    ];
    const us = corners.map(([x, y]) => U(x, y)),
      vs = corners.map(([x, y]) => V(x, y));
    const u0 = Math.min(...us),
      u1 = Math.max(...us),
      v0 = Math.min(...vs),
      v1 = Math.max(...vs);
    const k = Math.min((w - 6) / (u1 - u0), (h - 6) / (v1 - v0));
    const ox = (w - (u1 - u0) * k) / 2 - u0 * k,
      oy = (h - (v1 - v0) * k) / 2 - v0 * k;
    m.clearRect(0, 0, w, h);
    m.save();
    m.setTransform(
      m
        .getTransform()
        .multiply(
          new DOMMatrix([k * C, k * S * SP, -k * S, k * C * SP, ox, oy])
        )
    );
    m.fillStyle = "#5f9e5a";
    m.fillRect(BOUNDS.x0, BOUNDS.y0, BOUNDS.x1 - BOUNDS.x0, BOUNDS.y1 - BOUNDS.y0);
    m.strokeStyle = "#e7d8bf";
    m.lineCap = m.lineJoin = "round";
    for (const p of PATHS) {
      m.lineWidth = p.w;
      m.beginPath();
      p.pts.forEach(([x, y], i) => (i ? m.lineTo(x, y) : m.moveTo(x, y)));
      m.stroke();
    }
    m.fillStyle = "#e7d8bf";
    m.beginPath();
    m.arc(PLAZA.x, PLAZA.y, PLAZA.r, 0, Math.PI * 2);
    m.fill();
    m.fillStyle = "#5fc3e8";
    m.beginPath();
    m.arc(FOUNTAIN.x, FOUNTAIN.y, FOUNTAIN.r, 0, Math.PI * 2);
    m.fill();
    m.beginPath();
    m.ellipse(LAKE.x, LAKE.y, LAKE.rx, LAKE.ry, 0, 0, Math.PI * 2);
    m.fill();
    for (const b of BUILDINGS) {
      m.fillStyle = isLot(b) ? "rgba(242,193,78,0.35)" : b.accent;
      m.globalAlpha = this.near === b ? 1 : 0.9;
      m.fillRect(b.x, b.y, b.w, b.d);
      m.globalAlpha = 1;
      m.strokeStyle = "rgba(20,16,40,0.8)";
      m.lineWidth = 0.6;
      m.strokeRect(b.x, b.y, b.w, b.d);
    }
    // 보이는 범위 (화면 네 귀퉁이가 닿는 땅)
    const c = [
      [0, 0],
      [this.cw, 0],
      [this.cw, this.ch],
      [0, this.ch],
    ]
      .map(([x, y]) => this.ground(x, y))
      .filter((p): p is { x: number; y: number } => !!p);
    if (c.length === 4 && !this.overview) {
      m.strokeStyle = "rgba(255,255,255,0.8)";
      m.lineWidth = 0.8;
      m.beginPath();
      c.forEach((p, i) => (i ? m.lineTo(p.x, p.y) : m.moveTo(p.x, p.y)));
      m.closePath();
      m.stroke();
    }
    m.restore();
    // 사람 점은 돌리지 않고 (동그랗게)
    const dot = (x: number, y: number, r: number) => {
      m.beginPath();
      m.arc(ox + U(x, y) * k, oy + V(x, y) * k, r, 0, Math.PI * 2);
    };
    m.fillStyle = "#ffffff";
    for (const a of this.others.values()) {
      dot(a.x, a.y, 2.2);
      m.fill();
    }
    if (this.me) {
      m.fillStyle = "#FFD36B";
      m.strokeStyle = "#3a2a00";
      m.lineWidth = 1;
      dot(this.me.x, this.me.y, 3.4);
      m.fill();
      m.stroke();
    }
  }
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** 말풍선 줄바꿈 (글자 단위) */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxW && line) {
      out.push(line);
      line = ch === " " ? "" : ch;
      if (out.length === 3) break;
    } else line += ch;
  }
  if (out.length < 3 && line) out.push(line);
  else if (out.length === 3 && line) out[2] = out[2].slice(0, -1) + "…";
  return out;
}
