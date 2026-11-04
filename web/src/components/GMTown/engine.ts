import { CURSOR } from "./cursors";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneRig } from "three/examples/jsm/utils/SkeletonUtils.js";
import { CHARS, CHAR_TALL, IDLE_MS, WALK_MS, sheetOf, type Sheet } from "@/lib/gmtown/chars";
import type { CharId, ChatWire, ModelId, MoveWire, PlayerWire, TownSnap } from "@/lib/gmtown/types";
import {
  BOARD,
  NPCS,
  type Npc,
  type NpcId,
  BOUNDS,
  BUILDINGS,
  FOUNTAIN,
  LAKE,
  PATHS,
  PLAZA,
  RADIUS,
  RUN_SPEED,
  SPEED,
  WORLD,
  YAW,
  blocked,
  dir8,
  doorAt,
  doorFront,
  fromScreen,
  BRIDGES,
  heightAt,
  isLot,
  riverX,
  RIVER,
  toCam,
  type Building,
} from "@/lib/gmtown/world";
import { buildTown, type TownScene } from "./scene3d";
import { HOME_AT, buildHouse, type HouseScene } from "./houseScene";
import type { Placed } from "@/lib/gmtown/house";

/*
 * GMTOWN 엔진 — three.js 쿼터뷰 장면 위에 사람들을 세우고, 내 캐릭터를 움직이고, 다른 사람을 부드럽게 보여 줌.
 * React(GMTownApp)는 HUD(채널 · 채팅 · 건물 카드)만 맡고 여기 훅으로 주고받음.
 *
 * 카메라: 원근 3인칭 (시야 45°, 기본 7.5m 거리 · 위 26°), 처음엔 남동 45° 에서. 내 캐릭터를 따라감.
 *   당기면 낮고 가까이(5m), 밀면 높고 멀리(17m · 52°) — 높이는 끌어서 따로 더하고 뺄 수 있음.
 *   마우스: 왼쪽 끌기 = 시점 돌리기(좌우) · 높이(위아래) · 오른쪽 누르기 = 그곳으로 걷기 · 휠 = 당기기/밀기.
 *   폰: 누르기 = 걷기 · 두 손가락 = 당기기 + 돌리기 + 위아래로 밀면 높이.
 *   「지도」는 마을 전체.
 * 사람: 3D 모델이 있는 캐릭터는 리깅된 3D 로 (걷기 · 숨쉬기 동작, 가는 쪽을 보며 돌아섬, 툰 2단 명암 + 화면 두께가 같은 외곽선).
 *   모델이 없거나 못 받았으면 스프라이트를 카메라를 보는 세로 판에.
 *   가려진 사람은 반투명으로 한 번 더 (어디 있는지는 보이게), 내가 건물 뒤에 들어가면 그 건물을 비치게.
 * 이름표 · 말풍선 · 조이스틱은 위에 겹친 2D 캔버스.
 * 움직이기: 키보드(WASD · 방향키 = 카메라 기준 앞뒤좌우, Shift = 뛰기) · 오른쪽으로 누른 곳으로 걸어가기(0.5m 격자 A* → 직선으로 펴기,
 *   멀면 뛰어감) · 폰은 왼쪽 손가락 조이스틱 (끝까지 밀면 뛰기).
 *   보내는 방향 d 는 땅 기준 8방향 (0 = 북(-y), 시계 방향) — 사람마다 카메라가 달라서.
 *   부딪히면 벽을 따라 미끄러짐. 0.1초마다 바뀐 위치를 서버로.
 * 다른 사람: 받은 위치를 0.12초 늦게 보여 주며 사이를 이어 그림 (끊김 없이).
 */

export interface EngineHooks {
  /** 문 앞에 서거나 벗어남 (board = 안내판) */
  onNear(b: Building | "board" | NpcId | null): void;
  /** 건물을 눌러서 걸어가 문 앞에 닿음 → 카드 열기 */
  onArrive(b: Building | "board" | NpcId): void;
  /** E · 스페이스 */
  onInteract(): void;
  /** 내 위치 보내기 */
  send(x: number, y: number, d: number, m: 0 | 1 | 2): void;
  /** 마을 전체 지도를 켜고 끔 (엔진이 스스로 끌 때도) */
  onOverview(on: boolean): void;
  /** M · 작은 지도: 전체 지도 창 열고 닫기 */
  onMap?(): void;
  /** 집 안: 문에 닿음 / 떨어짐 (나가기) */
  onHouseDoor?(at: boolean): void;
  /** 집 안 꾸미기: 마우스가 가리키는 칸 · 누른 칸 */
  onHouseHover?(cell: { cx: number; cy: number } | null): void;
  onHouseClick?(cell: { cx: number; cy: number }): void;
  /** 3D 를 못 여는 기기 · 파일을 못 받음 */
  onError(msg: string): void;
}

interface Sample {
  t: number;
  x: number;
  y: number;
  d: number;
  m: 0 | 1 | 2;
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
  run: THREE.AnimationAction | null;
  /** 지금 틀고 있는 동작 */
  cur: THREE.AnimationAction | null;
  /** 가려졌을 때만 보이는 반투명 몸 */
  ghosts: THREE.Object3D[];
  /** 앞머리 위로 덧그리는 눈 (깊이 안 봄 → 건물에 가려지면 끔) */
  overs: THREE.Object3D[];
  shadow: THREE.Mesh;
  tails: Tail[];
}

/** 트윈테일 한 줄기: 뼈 5개(4마디 + 끝점), 흔들리는 점(세계 좌표)과 한 프레임 전 점 */
interface Tail {
  bones: THREE.Object3D[];
  /** 머리 기준 쉬는 자세 (매 프레임 여기서 다시 시작 — 동작에 꼬리 뼈가 없어도 쌓이지 않게) */
  rest: THREE.Quaternion[];
  sim: THREE.Vector3[];
  prev: THREE.Vector3[];
  /** 지난 프레임 뿌리 위치 · 뿌리 평균 속도 (출렁임만 골라내려고) */
  root0: THREE.Vector3;
  vel: THREE.Vector3;
  ready: boolean;
  /** 흔들림 성질 (트윈테일 · 긴 뒷머리 가닥) */
  k: TailK;
  /** 바람 흔들림 위상 (줄기마다 다르게) */
  ph: number;
  /** 마디 길이 (쉬는 자세) — 바람 · 끌림으로 목표점을 옮겨도 길이는 그대로 */
  len: number[];
}

interface Avatar {
  id: string;
  name: string;
  guest: boolean;
  c: ModelId;
  /** 마을 NPC (서버에 없는, 제자리에 서 있는 사람) */
  npc?: Npc;
  /** 자기 집 안에 들어가 있음 (마을에선 안 보임) */
  away?: boolean;
  x: number;
  y: number;
  d: number;
  moving: boolean;
  running: boolean;
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
const DEG = Math.PI / 180;
/** 원근 카메라: 세로 시야각 (세로로 긴 화면은 조금 넓게) · 기본 거리(m) · 기본 높이각 · 보는 점 높이(가슴) */
const FOV = 45;
const FOV_TALL = 55;
const CAM_DIST = 7.5;
const PITCH0 = 26 * DEG;
const LOOK_H = 0.9;
/** 당기기 · 밀기 (기본 거리의 배수: 5m ~ 17m) */
const ZOOM_MIN = 5 / CAM_DIST;
const ZOOM_MAX = 17 / CAM_DIST;
/** 지도(마을 전체): 거리 · 높이각 */
const OV_DIST = 235;
const OV_PITCH = 60 * DEG;
/** 왼쪽 끌기 1px 에 돌아가는 각도 · 끌어서 정하는 높이 범위 (줌에 따른 높이는 따로 더함) */
const ROT_PER_PX = 0.0085;
/** 폰 조이스틱 반지름 (px) */
const JOY_R = 58;
/** 음수면 땅에 붙은 카메라가 캐릭터를 올려다봄 */
const PITCH_MIN = -30 * DEG;
const PITCH_MAX = 72 * DEG;
const SUN_OFF = new THREE.Vector3(-34, 52, 30);
const FAR_AWAY = new THREE.Vector3(0, 1e4, -1e4);
/** 동그란 그림자 알파 (가운데 1 → 끝 0) */
function blobTex(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "#fff");
  gr.addColorStop(0.55, "#bbb");
  gr.addColorStop(1, "#000");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
/** 하늘 (위 · 지평선) — 지평선 색이 안개 색 */
const SKY_TOP = new THREE.Color(0x7cc4f5);
const SKY_HORIZON = new THREE.Color(0xd9efff);
/** 3D 캐릭터: 키 1 짜리 모델 → 실제 키 */
const RIG_SCALE = CHAR_TALL;
/** 툰 명암: 빛 방향 (화면 기준 — 보는 사람 왼쪽 위 앞에서, 얼굴이 늘 밝게) · 그늘 밝기 · 외곽선 두께(화면 px) · 색 */
const TOON_LIGHT = new THREE.Vector3(-0.45, 0.55, 0.7).normalize();
const TOON_SHADE = 0.8;
const INK_PX = 0.75;
const INK_COLOR = 0x3a2a3e;
/** 눈 조각: 얼굴 위에 살짝 띄움 · 앞머리 위로 한 번 더 그릴 때 카메라 쪽으로 당기는 거리 (모델 키 1 기준, 앞머리~눈 틈 0.07) */
const EYE_LIFT = 0.0015 * RIG_SCALE;
const EYE_OVER = 0.12 * RIG_SCALE;
/** 트윈테일 흔들림: 원래 자세로 당기는 힘 · 흔들림 남는 정도(60fps 한 프레임 기준) · 처짐 · 원래 자세에서 최대 벌어짐 */
const TAIL_PULL = 0.08;
const TAIL_DAMP = 0.9;
const TAIL_G = 2.0;
const TAIL_MAX = (30 * Math.PI) / 180;
/** 머리의 출렁임(걸음마다 위아래 · 좌우 흔들림)을 꼬리가 이만큼 크게 느낌 — 꾸준히 가는 속도는 빼고 */
const TAIL_BOUNCE = 3;
/**
 * noFwd: 몸 앞쪽(원래 자세보다 앞)으로 못 감 (뒷머리 — 몸 뚫기 막음) · noBack: 뒤로(얼굴 쪽) 못 감 (앞머리)
 * wind: 서 있을 때도 살랑이는 폭 (줄기 길이 비율, 끝으로 갈수록 큼) · drag: 걸을 때 뒤로 끌리는 정도 (속도 1 당 줄기 길이 비율)
 */
type TailK = { pull: number; damp: number; g: number; max: number; bounce: number; noFwd: boolean; noBack?: boolean; wind?: number; drag?: number };
const TWIN_K: TailK = { pull: TAIL_PULL, damp: TAIL_DAMP, g: TAIL_G, max: TAIL_MAX, bounce: TAIL_BOUNCE, noFwd: false, wind: 0.025 };
/** 긴 뒷머리 가닥: 덩어리라 덜 휘고 빨리 돌아옴 · 뒤로는 걸음에 끌려 날림 · 앞(몸 쪽)으로는 못 넘어감 */
const BACK_K: TailK = { pull: 0.16, damp: 0.86, g: 1.2, max: (22 * Math.PI) / 180, bounce: 1.8, noFwd: true, wind: 0.035, drag: 0.05 };
/** 얼굴 옆 짧은 옆머리 (구레나룻): 살짝만 */
const SIDE_K: TailK = { pull: 0.16, damp: 0.86, g: 1.6, max: (14 * Math.PI) / 180, bounce: 1.6, noFwd: false, wind: 0.06 };
/** 앞머리: 아주 살짝, 얼굴 쪽으론 못 들어감 */
const BANG_K: TailK = { pull: 0.22, damp: 0.82, g: 0.4, max: (7 * Math.PI) / 180, bounce: 1.4, noFwd: false, noBack: true, wind: 0.05 };
const TAIL_NAMES: [string, TailK][] = [
  ...["SideA", "SideB"].map((n) => [n, SIDE_K] as [string, TailK]),
  ...["TailA", "TailB", "TailC", "TailD"].map((n) => [n, TWIN_K] as [string, TailK]),
  ..."ABCDEFGH".split("").map((c) => ["Back" + c, BACK_K] as [string, TailK]),
  ..."ABCDE".split("").map((c) => ["Bang" + c, BANG_K] as [string, TailK]),
];

type RigMats = {
  toon: THREE.Material;
  ink: THREE.Material;
  ghost: THREE.Material;
  /** 몸 텍스처가 여럿일 때 (베이스 몸 + 입힌 옷 · 머리): 원래 그림 → 툰 · 반투명 */
  byMap: Map<THREE.Texture | null, { toon: THREE.Material; ghost: THREE.Material }>;
  eyeBase?: THREE.Material;
  eyeOver?: THREE.Material;
};

/** GLB 안의 눈 조각 (bake 에서 "eyes" 로 만든 것) */
function isEyes(o: THREE.Object3D) {
  return o.name.startsWith("eyes") || (o.parent?.name.startsWith("eyes") ?? false);
}

/** 뛰기로 바뀌는 거리 (누른 곳까지 길 길이, m) */
const RUN_FAR = 5;
/** 걷기 · 뛰기 동작이 발이 안 미끄러지는 속도 (동작 1배속일 때 m/초) */
const WALK_ANIM_V = 2.8 / 1.15;
const RUN_ANIM_V = 5.6;

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

/** 하늘 공: 위는 파랑, 지평선 아래로는 안개 색 (카메라를 따라다님) */
function skyDome() {
  const g = new THREE.SphereGeometry(240, 32, 16);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 240;
    c.copy(SKY_HORIZON).lerp(SKY_TOP, Math.pow(Math.max(0, y), 0.55));
    c.toArray(col, i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })
  );
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

interface RigModel {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

export class TownEngine {
  private ctx: CanvasRenderingContext2D;
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.3, 400);
  private town: TownScene | null = null;
  private cw = 0;
  private ch = 0;
  private dpr = 1;
  private phone = false;
  /** 카메라가 보는 땅 위 점 */
  private cam = { x: 54, y: 52 };
  /** 카메라 거리 (지금 · 이 화면의 기본) · 보는 점에서 화면 폭에 들어가는 m (그림자 범위 등에 씀) */
  private dist = CAM_DIST;
  private baseDist = CAM_DIST;
  private vw = 13;
  private zoom = 1;
  /** 지도로 넘어가는 정도 (0 ~ 1, 부드럽게) */
  private ovK = 0;
  /** 보는 점의 땅 높이 (부드럽게 따라감) */
  private camH = 0;
  private camHSet = false;
  /** 카메라가 있는 쪽 (땅 위, 라디안 — +y 쪽이 0, 처음 남동 45°) */
  private camYaw = YAW;
  /** 끌어서 정한 높이 각 (처음 26°, 실제 높이는 여기에 줌에 따른 각을 더함) */
  private camPitch = PITCH0;
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
  private goal: Building | "board" | NpcId | null = null;
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
  private near: Building | "board" | NpcId | null = null;
  private hover: Building | null = null;
  private sent = { x: 0, y: 0, d: -1, m: -1 as number, at: 0 };
  private typing = false;
  private walkRate = 1.15;
  private shift = false;
  /** 누른 곳이 멀어서 뛰어가는 중 */
  private runPath = false;

  private sheets = new Map<string, THREE.Texture>();
  private models = new Map<string, RigModel>();
  /** 3D 캐릭터 공용 재질 (툰 · 외곽선 · 가려졌을 때) — 캐릭터 종류마다 하나 */
  private rigMats = new Map<string, RigMats>();
  private toonU = { uLight: { value: new THREE.Vector3() }, uShade: { value: TOON_SHADE } };
  /** 외곽선: 깊이 1m 에서의 두께(m) — 화면 px × (그 깊이에서 1px 의 크기) */
  private inkU = { uInk: { value: 0.001 } };
  private sky: THREE.Mesh | null = null;
  private sheetGeo = new Map<string, THREE.BufferGeometry>();
  /** 발밑 접지 그림자 (해 그림자는 몸이 따로 드리움) — 가운데 진하고 가장자리로 흐려짐 */
  private shadowGeo = new THREE.CircleGeometry(0.36, 24);
  private shadowMat = new THREE.MeshBasicMaterial({
    color: 0x14202a,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    alphaMap: blobTex(),
    // 발밑 동그란 그림자는 안 씀 (해 그림자만)
    visible: false,
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
      // 스텐실: 캐릭터 몸이 그려진 픽셀 표시 → 눈 덧그림은 그 위에만 (앞머리 위로 눈 · 원신식)
      stencil: true,
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
    // 3D 캐릭터: 마을에 그 캐릭터가 처음 나올 때 받음 (에이미는 바로) — 못 받으면 판으로
    this.needModel("amy");
    buildTown().then(
      (s) => {
        if (this.dead) return s.dispose();
        this.town = s;
        const size = this.phone ? 1024 : 2048;
        s.sun.shadow.mapSize.set(size, size);
        // 이제 지평선이 보이니 하늘 공 + 먼 곳은 안개로 (먼 나무도 덜 그림)
        s.scene.fog = new THREE.Fog(SKY_HORIZON, 40, 140);
        this.sky = skyDome();
        s.scene.add(this.sky);
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
    for (const m of this.rigMats.values()) {
      const { byMap, ...rest } = m;
      for (const x of Object.values(rest)) x?.dispose();
      for (const v of byMap.values()) {
        v.toon.dispose();
        v.ghost.dispose();
      }
    }
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
    this.shadowMat.alphaMap?.dispose();
    this.shadowMat.dispose();
    if (this.sky) {
      this.sky.geometry.dispose();
      (this.sky.material as THREE.Material).dispose();
    }
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
  /** 누가 캐릭터를 바꿈 (나 포함) → 그 사람 모델을 새로 */
  setChar(id: string, c: CharId) {
    const a = id === this.me?.id ? this.me : this.others.get(id);
    if (!a || a.c === c) return;
    this.dropView(a);
    a.c = c;
    this.needModel(c);
  }
  /** 내 캐릭터 */
  myChar(): CharId | null {
    return (this.me?.c as CharId | undefined) ?? null;
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
      const l = a.samples[a.samples.length - 1];
      // 순간이동 (멀리 한 번에) → 지나가는 길을 그리지 않고 바로 그 자리로
      if (l && Math.hypot(x - l.x, y - l.y) > 6) a.samples.length = 0;
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
    const far = Math.hypot(x - this.me.x, y - this.me.y) > 6;
    this.me.x = x;
    this.me.y = y;
    this.path = [];
    // 순간이동: 카메라도 바로 (마을을 가로질러 미끄러지지 않게)
    if (far) {
      this.cam = { x, y };
      this.camHSet = false;
      this.goal = null;
    }
  }
  /** 지도 창 · 원형 지도가 그릴 것: 나 (보는 쪽) · 다른 사람 · 시점 방향 */
  mapState() {
    const me = this.me ? { x: this.me.x, y: this.me.y, face: this.me.face ?? 0 } : null;
    const others = [...this.others.values()].map((a) => ({ x: a.x, y: a.y }));
    return { me, others, yaw: this.camYaw };
  }
  /** 지도에서 고른 건물 앞까지 걸어감 */
  walkToBuilding(b: Building) {
    if (this.overview) this.setOverview(false);
    this.walkTo(doorFront(b).x, doorFront(b).y, b);
  }
  /** 걸어서 가는 중인지 (지도 창에서 보여 줌) */
  walking() {
    return this.path.length > 0;
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

  /** 이 캐릭터 3D 모델을 아직 안 받았으면 받기 시작 (다 받으면 판으로 서 있던 사람들을 3D 로) */
  private needModel(c: string) {
    const def = CHARS[c as keyof typeof CHARS];
    if (!def?.model || this.modelLoading.has(c)) return;
    this.modelLoading.add(c);
    this.gltf.loadAsync(def.model).then(
      (g) => {
        if (this.dead) return;
        this.models.set(c, { scene: g.scene, clips: g.animations });
        this.rigMats.set(c, this.makeRigMats(g.scene, def.eyeBand));
        for (const a of [...this.others.values(), ...this.npcs, ...(this.me ? [this.me] : [])]) if (a.c === c) this.dropView(a);
      },
      (err) => console.error("[gmtown] 3D 캐릭터", c, err)
    );
  }
  private modelLoading = new Set<string>();
  private gltf = new GLTFLoader();
  /** 마을 NPC (중개인 등) — 채널과 상관없이 늘 서 있음 */
  private npcs: Avatar[] = NPCS.map((n) => ({
    ...this.avatarOf({ id: "npc:" + n.id, name: n.name, guest: false, c: n.id, x: n.x, y: n.y, d: 4, m: 0 } as unknown as PlayerWire),
    c: n.id,
    npc: n,
    faceTo: n.face,
    face: n.face,
  }));

  private avatarOf(p: PlayerWire): Avatar {
    this.needModel(p.c);
    return {
      id: p.id,
      name: p.name,
      guest: p.guest,
      c: p.c,
      x: p.x,
      y: p.y,
      d: p.d,
      moving: !!p.m,
      running: p.m === 2,
      phase: Math.random() * 1000,
      samples: [{ t: performance.now(), x: p.x, y: p.y, d: p.d, m: p.m }],
      bubble: null,
      away: !!p.home,
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
    // 세로로 긴 화면(폰)은 시야를 조금 넓히고, 그래도 좌우가 11m 는 보이게 조금 물러섬 (최대 1.7배)
    const aspect = cw / ch;
    const fov = aspect < 1 ? FOV_TALL : FOV;
    this.camera.fov = fov;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const halfW = Math.tan((fov * DEG) / 2) * aspect;
    this.baseDist = CAM_DIST * Math.max(1, Math.min(1.7, 11 / (2 * CAM_DIST * halfW)));
  }

  /** 화면 px → 땅 위 점 */
  private ground(px: number, py: number): { x: number; y: number } | null {
    this.ray.setFromCamera(
      new THREE.Vector2((px / this.cw) * 2 - 1, -(py / this.ch) * 2 + 1),
      this.camera
    );
    const o = this.ray.ray.origin,
      d = this.ray.ray.direction;
    if (this.house) {
      if (d.y >= -1e-4) return null;
      const t = -o.y / d.y;
      return { x: o.x + d.x * t, y: o.z + d.z * t };
    }
    // 땅까지 걸어가며 찾기 (0.6m 씩 → 넘으면 반으로 나눠 좁힘). 지평선 위를 누르면 없음
    const above = (t: number) => o.y + d.y * t - this.hAt(o.x + d.x * t, o.z + d.z * t);
    let a = 0,
      b = -1;
    for (let t = 0.6; t < 500; t += 0.6)
      if (above(t) <= 0) {
        b = t;
        break;
      } else a = t;
    if (b < 0) return null;
    for (let i = 0; i < 12; i++) {
      const m = (a + b) / 2;
      if (above(m) > 0) a = m;
      else b = m;
    }
    return { x: o.x + d.x * b, y: o.z + d.z * b };
  }
  /** 땅 위 점 (높이 h) → 화면 px */
  private screen(x: number, y: number, h = 0): { x: number; y: number } {
    const v = new THREE.Vector3(x, this.hAt(x, y) + h, y).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.cw, y: ((1 - v.y) / 2) * this.ch };
  }

  // ───────────── 입력 ─────────────

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Shift") this.shift = e.type === "keydown";
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
    } else if (k === "m") {
      if (this.hooks.onMap) this.hooks.onMap();
      else this.setOverview(!this.overview);
    }
    else if (k === "=" || k === "+") this.zoomBy(1 / 1.2);
    else if (k === "-" || k === "_") this.zoomBy(1.2);
  };
  private onBlur = () => {
    this.keys.clear();
    this.shift = false;
  };

  private pickTarget(px: number, py: number, skip: Building | null = null): Building | "board" | NpcId | null {
    if (!this.town) return null;
    this.ray.setFromCamera(
      new THREE.Vector2((px / this.cw) * 2 - 1, -(py / this.ch) * 2 + 1),
      this.camera
    );
    let best: { d: number; b: Building } | null = null;
    for (const v of this.town.buildings) {
      if (v.b === skip) continue;
      const hit = this.ray.intersectObject(v.pick, false)[0];
      if (hit && (!best || hit.distance < best.d)) best = { d: hit.distance, b: v.b };
    }
    if (best) return best.b;
    for (const n of NPCS) {
      const a = this.screen(n.x, n.y, 0.2),
        b = this.screen(n.x, n.y, CHAR_TALL);
      const h = Math.abs(a.y - b.y);
      if (Math.abs(px - a.x) < h * 0.35 && py < a.y && py > b.y - h * 0.1) return n.id;
    }
    const s = this.screen(BOARD.x, BOARD.y, 1.4);
    const s2 = this.screen(BOARD.x, BOARD.y, 2.4);
    const ppm = Math.max(8, Math.abs(s.y - s2.y));
    if (Math.abs(px - s.x) < ppm * 0.9 && Math.abs(py - s.y) < ppm * 0.9) return "board";
    return null;
  }

  private tap(px: number, py: number) {
    if (this.house) {
      const g = this.ground(px, py);
      if (!g) return;
      if (this.build) {
        const c = this.house.cellAt(g.x, g.y);
        if (c) this.hooks.onHouseClick?.(c);
        return;
      }
      return this.walkTo(g.x, g.y, null);
    }
    // 내가 건물 뒤에 가려져 있으면 그 건물은 안 누름 (반투명 몸 근처를 눌러도 건물로 걸어가 버리지 않게)
    const occ = this.me ? this.blocker(this.me.x, this.me.y) : null;
    const t = this.pickTarget(px, py, occ?.b ?? null);
    if (this.overview) this.setOverview(false);
    if (t === "board") return this.walkTo(BOARD.x + 0.6, BOARD.y + 0.6, "board");
    if (typeof t === "string") {
      // NPC 앞 (보는 쪽으로 1.2m)
      const n = NPCS.find((q) => q.id === t)!;
      return this.walkTo(n.x + Math.sin(n.face) * 1.2, n.y + Math.cos(n.face) * 1.2, t);
    }
    if (t) return this.walkTo(doorFront(t).x, doorFront(t).y, t);
    const g = this.ground(px, py);
    if (g) this.walkTo(g.x, g.y, null);
  }

  private onDown = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    const px = e.clientX - r.left,
      py = e.clientY - r.top;
    if (e.pointerType === "touch") {
      // 왼쪽 아래 고정 조이스틱 (그 둘레를 누르면 — 손가락이 조금 빗나가도)
      const j = this.joyAt();
      if (!this.joy && !this.overview && Math.hypot(px - j.x, py - j.y) < JOY_R * 1.7) {
        this.joy = { id: e.pointerId, ox: j.x, oy: j.y, x: px, y: py };
        this.path = [];
        this.goal = null;
      } else {
        this.touches.set(e.pointerId, { x: px, y: py, sx: px, sy: py });
        if (this.touches.size === 2) {
          const [a, b] = [...this.touches.values()];
          this.drag = null;
          this.pinch = {
            d: Math.hypot(a.x - b.x, a.y - b.y),
            zoom: this.zoom,
            ang: Math.atan2(b.y - a.y, b.x - a.x),
            yaw: this.camYaw,
            my: (a.y + b.y) / 2,
            pitch: this.camPitch,
          };
        } else if (this.touches.size === 1)
          // 한 손가락으로 끌면 시점 돌리기 (땅 누르기 이동은 없음)
          this.drag = { x: px, y: py, yaw: this.camYaw, pitch: this.camPitch };
      }
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    // 왼쪽 = 시점 돌리기 (끌기), 오른쪽 = 그곳으로 걷기 · 건물로 가기
    if (e.button === 0 && this.house && this.build) {
      this.drag = { x: px, y: py, yaw: this.camYaw, pitch: this.camPitch };
      this.buildClick = { x: px, y: py };
      this.canvas.setPointerCapture(e.pointerId);
    } else if (e.button === 0 && !this.overview) {
      this.drag = { x: px, y: py, yaw: this.camYaw, pitch: this.camPitch };
      this.canvas.setPointerCapture(e.pointerId);
    } else if (e.button === 2 || (e.button === 0 && this.overview)) this.tap(px, py);
  };
  private onMenu = (e: MouseEvent) => e.preventDefault();
  private buildClick: { x: number; y: number } | null = null;
  /** 폰 조이스틱 가운데 (왼쪽 아래 — 노치 · 둥근 모서리 피해서) */
  private joyAt() {
    return { x: Math.max(JOY_R + 22, this.cw * 0.09 + JOY_R * 0.6), y: this.ch - JOY_R - 26 };
  }
  /** 지도 창이 열려 있음 (조이스틱 숨김 · 입력 멈춤) */
  private mapOpen = false;

  // ───────────── 집 안 (심즈식) ─────────────
  private house: HouseScene | null = null;
  /** 집에 들어갈 때 숨긴 마을 것들 · 되돌릴 시점 */
  private hiddenTown: THREE.Object3D[] = [];
  private townLook: { fog: THREE.Fog | null; bg: THREE.Color | THREE.Texture | null; yaw: number; pitch: number; zoom: number } | null = null;
  private houseDist = 9;
  private build = false;
  private houseDoor = false;
  private hoverCell = "";
  /** 서 있는 높이 (집 안은 바닥 0) */
  private hAt(x: number, y: number) {
    return this.house ? 0 : heightAt(x, y);
  }
  /** 부딪힘 (집 안은 방 · 가구) */
  private bl(x: number, y: number) {
    return this.house ? this.house.blocked(x, y, RADIUS) : blocked(x, y);
  }
  inHouse() {
    return !!this.house;
  }
  /** 내 집으로 들어감: 마을은 숨기고 멀리 떨어진 곳에 방을 지어서 그리로 */
  enterHouse(tier: number, layout: Placed[]) {
    const town = this.town,
      me = this.me;
    if (!town || !me) return;
    if (this.house) this.dropHouse();
    const h = buildHouse(tier, layout);
    this.hiddenTown = [];
    const keep = new Set<THREE.Object3D>([town.sun, town.sun.target]);
    if (me.rig) keep.add(me.rig.root);
    for (const o of town.scene.children) {
      if (keep.has(o) || (o as THREE.Light).isLight) continue;
      if (o.visible) {
        o.visible = false;
        this.hiddenTown.push(o);
      }
    }
    town.scene.add(h.group);
    this.house = h;
    this.townLook = {
      fog: town.scene.fog as THREE.Fog | null,
      bg: town.scene.background as THREE.Color | null,
      yaw: this.camYaw,
      pitch: this.camPitch,
      zoom: this.zoom,
    };
    town.scene.fog = null;
    town.scene.background = new THREE.Color(0x1e1a28);
    this.houseDist = Math.max(h.wm, h.dm) * 0.9 + 3.5;
    this.camPitch = 46 * DEG;
    this.camYaw = 35 * DEG;
    this.zoom = 1;
    me.x = h.enter.x;
    me.y = h.enter.y;
    me.faceTo = me.face = Math.PI;
    this.path = [];
    this.goal = null;
    this.keys.clear();
    this.cam = { x: HOME_AT.x, y: HOME_AT.y };
    this.camHSet = false;
    this.houseDoor = false;
    this.build = false;
    if (this.near) {
      this.near = null;
      this.hooks.onNear(null);
    }
  }
  /** 집에서 나옴: 마을 그대로 되돌리고 (x, y) 에 섬 */
  exitHouse(x: number, y: number) {
    const me = this.me;
    this.dropHouse();
    if (me) {
      me.x = x;
      me.y = y;
      me.faceTo = me.face = 0;
      this.cam = { x, y };
      this.camHSet = false;
      this.sent.at = 0;
      this.sent.m = -1;
    }
  }
  private dropHouse() {
    const town = this.town,
      h = this.house;
    if (!h) return;
    h.dispose();
    this.house = null;
    for (const o of this.hiddenTown) o.visible = true;
    this.hiddenTown = [];
    if (town && this.townLook) {
      town.scene.fog = this.townLook.fog;
      town.scene.background = this.townLook.bg;
      this.camYaw = this.townLook.yaw;
      this.camPitch = this.townLook.pitch;
      this.zoom = this.townLook.zoom;
    }
    this.townLook = null;
    this.build = false;
    this.path = [];
  }
  houseLayout(layout: Placed[]) {
    this.house?.setLayout(layout);
  }
  /** 꾸미기 모드 (칸 선 · 누르면 onHouseClick) — sel: 고른 가구 번호 */
  setBuild(on: boolean, sel: number | null = null) {
    this.build = on;
    this.house?.setBuild(on, sel);
    if (on) this.path = [];
    if (!on) this.house?.setGhost(null);
  }
  setGhost(g: Parameters<HouseScene["setGhost"]>[0]) {
    this.house?.setGhost(g);
  }
  /** 다른 사람이 자기 집에 들어감 / 나옴 */
  setAway(id: string, on: boolean) {
    const a = this.others.get(id);
    if (!a) return;
    a.away = on;
    if (on) this.dropView(a);
  }
  setMapOpen(on: boolean) {
    this.mapOpen = on;
    if (on) {
      this.keys.clear();
      this.joy = null;
    }
  }
  /** 높이각은 끌어서만 바뀜 (줌은 거리만) */
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
      if (this.drag && !this.pinch && this.touches.size === 1 && !this.overview) {
        this.camYaw = this.drag.yaw - (px - this.drag.x) * ROT_PER_PX * 1.2;
        this.camPitch = this.clampPitch(this.drag.pitch + (py - this.drag.y) * ROT_PER_PX * 0.8);
        return;
      }
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
      if (Math.hypot(px - this.drag.x, py - this.drag.y) > 3) this.canvas.style.cursor = CURSOR.turn;
      this.camYaw = this.drag.yaw - (px - this.drag.x) * ROT_PER_PX;
      this.camPitch = this.clampPitch(this.drag.pitch + (py - this.drag.y) * ROT_PER_PX * 0.7);
      return;
    }
    if (this.house) {
      if (this.build) {
        const g = this.ground(px, py);
        const c = g ? this.house.cellAt(g.x, g.y) : null;
        const k = c ? `${c.cx},${c.cy}` : "";
        if (k !== this.hoverCell) {
          this.hoverCell = k;
          this.hooks.onHouseHover?.(c);
        }
      }
      this.canvas.style.cursor = CURSOR.normal;
      return;
    }
    const p = this.pickTarget(px, py);
    this.hover = p && typeof p !== "string" ? p : null;
    this.canvas.style.cursor = p ? CURSOR.point : CURSOR.normal;
  };
  private onUp = (e: PointerEvent) => {
    if (this.buildClick && e.pointerType === "mouse") {
      const r = this.canvas.getBoundingClientRect();
      const px = e.clientX - r.left,
        py = e.clientY - r.top;
      if (Math.hypot(px - this.buildClick.x, py - this.buildClick.y) < 5) this.tap(px, py);
      this.buildClick = null;
    }
    if (this.drag && e.pointerType === "mouse") {
      this.drag = null;
      this.canvas.style.cursor = CURSOR.normal;
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
    if (!this.touches.size) this.drag = null;
    // 손가락 하나로 짧게 누르면: 건물 · 안내판만 그리로 (땅 누르기 이동은 없음 — 조이스틱으로)
    if (
      !wasPinch &&
      !this.touches.size &&
      e.type === "pointerup" &&
      Math.hypot(t.x - t.sx, t.y - t.sy) < 12
    ) {
      const b = this.house ? true : this.pickTarget(t.x, t.y);
      if (b) this.tap(t.x, t.y);
    }
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
  walkTo(x: number, y: number, goal: Building | "board" | NpcId | null) {
    if (!this.me) return;
    if (this.house) {
      this.path = [{ x, y }];
      this.goal = null;
      this.runPath = false;
      return;
    }
    const p = this.findPath(this.me.x, this.me.y, x, y);
    this.path = p;
    this.goal = goal;
    this.stuck = 0;
    let len = 0,
      px = this.me.x,
      py = this.me.y;
    for (const q of p) {
      len += Math.hypot(q.x - px, q.y - py);
      px = q.x;
      py = q.y;
    }
    this.runPath = len > RUN_FAR;
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
  private step(me: Avatar, h: number): { moving: boolean; speed: number; running: boolean } {
    // 키 · 조이스틱은 화면 방향 → 땅 방향으로 (위 = 카메라가 보는 앞)
    let sx = 0,
      sy = 0;
    if (this.keys.has("l")) sx -= 1;
    if (this.keys.has("r")) sx += 1;
    if (this.keys.has("u")) sy -= 1;
    if (this.keys.has("d")) sy += 1;
    let running = this.shift && !!(sx || sy);
    let speed = running ? RUN_SPEED : SPEED;
    if (this.joy) {
      const dx = this.joy.x - this.joy.ox,
        dy = this.joy.y - this.joy.oy;
      const len = Math.hypot(dx, dy);
      if (len > 8) {
        sx = dx / len;
        sy = dy / len;
        // 끝까지 밀면 뛰기
        running = len >= JOY_R * 0.85;
        speed = running ? RUN_SPEED : SPEED * Math.min(1, len / (JOY_R * 0.75));
      }
    }
    let vx = 0,
      vy = 0;
    if (sx || sy) [vx, vy] = fromScreen(sx, sy, this.camYaw, Math.PI / 2);
    if (!vx && !vy && this.path.length) {
      running = this.runPath || this.shift;
      speed = running ? RUN_SPEED : SPEED;
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
        if (dist < speed * h) speed = dist / h;
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
      if (!this.bl(nx, ny)) {
        me.x = nx;
        me.y = ny;
      } else if (!this.bl(nx, me.y)) me.x = nx;
      else if (!this.bl(me.x, ny)) me.y = ny;
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
    if (!this.path.length) this.runPath = false;
    return { moving, speed, running: moving && running };
  }

  private update(dt: number, now: number) {
    const me = this.me;
    if (me) {
      const n = Math.max(1, Math.ceil(dt / 0.04));
      let moving = false,
        running = false,
        speed = SPEED;
      for (let i = 0; i < n; i++) ({ moving, speed, running } = this.step(me, dt / n));
      if (moving !== me.moving) {
        me.moving = moving;
        me.phase = 0;
      }
      me.running = running;
      me.phase += dt * 1000 * (moving ? Math.max(0.55, speed / SPEED) : 1);
      this.walkRate = running
        ? speed / RUN_ANIM_V
        : moving
          ? Math.max(0.55 * SPEED, speed) / WALK_ANIM_V
          : 1.15;
      // 보내기 (0.1초마다, 바뀐 게 있을 때만)
      const m = moving ? (running ? 2 : 1) : 0;
      if (
        !this.house &&
        now - this.sent.at >= 100 &&
        (Math.hypot(me.x - this.sent.x, me.y - this.sent.y) > 0.01 ||
          me.d !== this.sent.d ||
          m !== this.sent.m)
      ) {
        this.sent = { x: me.x, y: me.y, d: me.d, m, at: now };
        this.hooks.send(Math.round(me.x * 100) / 100, Math.round(me.y * 100) / 100, me.d, m);
      }
      // 집 안: 문에 닿으면 나가기
      if (this.house) {
        const at = this.house.atDoor(me.x, me.y);
        if (at !== this.houseDoor) {
          this.houseDoor = at;
          this.hooks.onHouseDoor?.(at);
        }
      }
      // 문 앞
      const b = this.house ? null : doorAt(me.x, me.y);
      const npc = this.house ? undefined : NPCS.find((n) => Math.hypot(me.x - n.x, me.y - n.y) < n.talk);
      const nb: Building | "board" | NpcId | null =
        npc?.id ?? b ?? (!this.house && Math.hypot(me.x - BOARD.x, me.y - BOARD.y) < 1.5 ? "board" : null);
      if (nb !== this.near) {
        this.near = nb;
        this.hooks.onNear(nb);
      }
    }
    // 카메라: 지도면 마을 가운데, 아니면 나를 따라감 (문 앞이면 건물 쪽(화면 위)으로 조금)
    let tx = this.cam.x,
      ty = this.cam.y;
    if (this.house) {
      // 집 안: 방 가운데를 보되 나를 반쯤 따라감
      tx = HOME_AT.x + ((me?.x ?? HOME_AT.x) - HOME_AT.x) * 0.45;
      ty = HOME_AT.y + ((me?.y ?? HOME_AT.y) - HOME_AT.y) * 0.45;
    } else if (this.overview) {
      tx = (BOUNDS.x0 + BOUNDS.x1) / 2;
      ty = (BOUNDS.y0 + BOUNDS.y1) / 2;
    } else if (me) {
      const lean =
        this.near && typeof this.near !== "string" && !isLot(this.near)
          ? Math.min(2.6, this.near.h * 0.4)
          : 0;
      tx = Math.max(BOUNDS.x0 + 3, Math.min(BOUNDS.x1 - 3, me.x - lean * Math.sin(this.camYaw)));
      ty = Math.max(BOUNDS.y0 + 3, Math.min(BOUNDS.y1 - 3, me.y - lean * Math.cos(this.camYaw)));
    }
    const k = Math.min(1, dt * (this.overview ? 4 : 7));
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
    const want = this.house ? this.houseDist * this.zoom : this.overview ? OV_DIST : this.baseDist * this.zoom;
    this.dist += (want - this.dist) * Math.min(1, dt * 6);
    this.ovK += ((this.overview ? 1 : 0) - this.ovK) * Math.min(1, dt * 5);

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
      const moving = m >= 1 && now - s[s.length - 1].t < 400;
      if (moving !== a.moving) {
        a.moving = moving;
        a.phase = 0;
      }
      a.running = moving && m === 2;
      a.x = x;
      a.y = y;
      if (d !== a.d || a.faceTo === undefined) a.faceTo = faceOfDir(d);
      a.d = d;
      a.phase += dt * 1000;
    }
  }

  // ───────────── 사람 그리기 ─────────────

  /** 시트 하나의 판 (발이 원점) */
  private geoOf(def: (typeof CHARS)[keyof typeof CHARS], sh: Sheet) {
    const key = `${def.base}/${sh.file}`;
    let g = this.sheetGeo.get(key);
    if (!g) {
      const hs = (CHAR_TALL * sh.h) / def.tall,
        ws = (hs * sh.w) / sh.h;
      const hp = hs;
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
  private makeRigMats(scene: THREE.Object3D, eyeBand?: [number, number]) {
    let eyeMap: THREE.Texture | null = null;
    const maps: (THREE.Texture | null)[] = [];
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const t = (o.material as THREE.MeshStandardMaterial).map ?? null;
      if (isEyes(o)) eyeMap ??= t;
      else if (!maps.includes(t)) maps.push(t);
    });
    const etex = eyeMap as THREE.Texture | null;
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    for (const t of maps) if (t) t.anisotropy = aniso;
    if (etex) etex.anisotropy = aniso;
    const byMap: RigMats["byMap"] = new Map();
    for (const t of maps) {
      byMap.set(t, { toon: this.toonMat(t), ghost: this.ghostMat(t) });
    }
    const first = byMap.get(maps[0] ?? null) ?? { toon: this.toonMat(null), ghost: this.ghostMat(null) };
    const toon = first.toon;
    const ink = new THREE.MeshBasicMaterial({ color: INK_COLOR, side: THREE.BackSide });
    ink.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.inkU);
      sh.vertexShader = sh.vertexShader
        .replace("void main() {", "uniform float uInk;\nvarying float vInkZ;\nvoid main() {")
        .replace(
          "#include <project_vertex>",
          // 법선 방향(3D)으로, 그 깊이에서 화면 uInk px 만큼 + 카메라 반대쪽으로 15cm 더 (화면 위치는 그대로, 깊이만)
          // → 턱 밑 · 팔 안쪽처럼 몸 앞에 겹친 곳엔 선이 안 생기고 바깥 윤곽에만
          // → 옷 · 머리 겹 사이가 얇은 곳에서 안쪽 겹의 껍데기가 바깥 겹을 뚫고 검은 점으로 보이지 않게
          `#include <project_vertex>
float inkW = uInk * max( -mvPosition.z, 0.05 );
#ifdef FLIP_SIDED
vec3 inkN = -normalize( transformedNormal );
#else
vec3 inkN = normalize( transformedNormal );
#endif
vec3 inkP = mvPosition.xyz + inkN * inkW;
inkP += normalize( mvPosition.xyz ) * ( inkW * 2.0 + 0.15 );
gl_Position = projectionMatrix * vec4( inkP, 1.0 );
vInkZ = inkN.z;`
        );
      // 껍데기 중 정반대(뒤쪽)를 보는 면은 버림: 외곽선은 옆을 보는 면에서만 생김.
      // 뒤쪽 면은 몸 · 옷의 작은 틈이나 얇은 겹을 지나 앞으로 비쳐서 검은 점 · 머리끝 찌꺼기가 됐음
      sh.fragmentShader = sh.fragmentShader.replace(
        "void main() {",
        "varying float vInkZ;\nvoid main() {\nif ( vInkZ < -0.5 ) discard;"
      );
    };
    const ghost = first.ghost;
    const mats: RigMats = { toon, ink, ghost, byMap };
    if (etex) {
      mats.eyeBase = this.eyeMat(etex, false);
      mats.eyeOver = this.eyeMat(etex, true, eyeBand);
    }
    return mats;
  }

  /** 툰: 빛 방향으로 2단 (얼굴 살은 그늘 없음) — 양면: Tripo 메시에 뒤집힌 면이 섞여 있어서 한 면만 그리면 그 자리로 외곽선 껍데기가 비쳐 검은 점이 됨 */
  private toonMat(tex: THREE.Texture | null) {
    const toon = new THREE.MeshToonMaterial({
      map: tex,
      side: THREE.DoubleSide,
      // 보이는 캐릭터 몸 픽셀에 1 을 씀 (눈 덧그림이 그 위에만 그려지게 — 앞 건물 · 땅 · 하늘엔 안 비침)
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
    });
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
    return toon;
  }
  private ghostMat(tex: THREE.Texture | null) {
    return new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.34, depthTest: false, depthWrite: false });
  }

  /**
   * 눈 조각 재질 — 그림은 멀리서도 또렷하게 (밉맵 한 단계 덜 흐리게).
   * over: 카메라 쪽으로 당겨서 앞머리 위로 한 번 더. 속눈썹(아주 어두운 곳) · 눈동자(푸른 곳)만, 정면에서만 (흰자까지 올리면 번져 보임) (뒤·옆에선 안 비침)
   */
  private eyeMat(map: THREE.Texture, over: boolean, band: [number, number] = [0.44, 0.64]) {
    const m = new THREE.MeshToonMaterial({
      map,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      alphaTest: over ? 0 : 0.01,
      // 덧그림: 깊이는 안 보고 제자리에 · 캐릭터 몸(앞머리 · 얼굴) 픽셀 위에만 — 당긴 거리로 앞머리를 이기던 방식은 가닥 따라 눈이 조각났음
      ...(over
        ? {
            depthTest: false,
            stencilWrite: true,
            stencilWriteMask: 0,
            stencilRef: 1,
            stencilFunc: THREE.EqualStencilFunc,
          }
        : {}),
    });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.toonU, {
        uBias: { value: over ? EYE_OVER : EYE_LIFT },
      });
      sh.vertexShader = sh.vertexShader
        .replace("void main() {", "uniform float uBias;\nvarying float vFace;\nvoid main() {")
        .replace(
          "#include <project_vertex>",
          // vFace: 머리 앞쪽(모델 +z, 머리 뼈 따라 돎)이 카메라를 얼마나 똑바로 보는지 — 면마다가 아니라 머리 하나로 (위에서 볼 때 윗눈꺼풀 면만 켜져 조각나던 것)
          `#include <project_vertex>
gl_Position = projectionMatrix * vec4( mvPosition.xyz * ( 1.0 - uBias / max( length( mvPosition.xyz ), 1e-3 ) ), 1.0 );
vec3 eyeFw = vec3( 0.0, 0.0, 1.0 );
#ifdef USE_SKINNING
eyeFw = ( skinMatrix * vec4( eyeFw, 0.0 ) ).xyz;
#endif
vFace = dot( normalize( normalMatrix * eyeFw ), normalize( -mvPosition.xyz ) );`
        );
      sh.fragmentShader = sh.fragmentShader
        .replace("void main() {", "uniform vec3 uLight;\nuniform float uShade;\nvarying float vFace;\nvoid main() {")
        .replace(
          "#include <map_fragment>",
          `vec4 sampledDiffuseColor = texture2D( map, vMapUv, -0.8 );
diffuseColor *= sampledDiffuseColor;` +
            (!over
              ? `
diffuseColor.a *= smoothstep( 0.05, 0.3, normalize( vNormal ).z );`
              : "") +
            (over
              ? `
float eLum = dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
float eWhite = smoothstep( 0.72, 0.82, eLum ) * smoothstep( -0.04, 0.01, sampledDiffuseColor.b - sampledDiffuseColor.r );
diffuseColor.a *= 0.95 * max( max( 1.0 - smoothstep( 0.03, 0.08, eLum ), eWhite ), max( smoothstep( 0.1, 0.22, sampledDiffuseColor.b - sampledDiffuseColor.r ), smoothstep( 0.3, 0.42, sampledDiffuseColor.r - sampledDiffuseColor.g ) ) )
  * smoothstep( 0.8, 0.93, vFace )
  // 눈 줄만 (기본은 눈썹 · 코 · 입은 앞머리 위로 안 올림 — 위에서 보면 눈썹이 속눈썹처럼 하나 더 보였음). 캐릭터마다 eyeBand
  * smoothstep( ${(band[0] - 0.02).toFixed(3)}, ${(band[0] + 0.02).toFixed(3)}, vMapUv.y ) * ( 1.0 - smoothstep( ${(band[1] - 0.02).toFixed(3)}, ${(band[1] + 0.02).toFixed(3)}, vMapUv.y ) );`
              : "")
        )
        .replace(
          "#include <opaque_fragment>",
          `outgoingLight = diffuseColor.rgb;
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
    const overs: THREE.Object3D[] = [];
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
        overs.push(o);
        o.position.copy(m.position);
        o.quaternion.copy(m.quaternion);
        o.scale.copy(m.scale);
        m.parent!.add(o);
        continue;
      }
      const mm = mats.byMap.get((m.material as THREE.MeshStandardMaterial).map ?? null) ?? mats;
      m.material = mm.toon;
      m.frustumCulled = false;
      m.castShadow = true;
      m.renderOrder = 3;
      for (const [mat, order] of [
        [mats.ink, 3],
        [mm.ghost, 10],
      ] as const) {
        const c = new THREE.SkinnedMesh(m.geometry, mat);
        c.bind(m.skeleton, m.bindMatrix);
        c.frustumCulled = false;
        c.renderOrder = order;
        c.position.copy(m.position);
        c.quaternion.copy(m.quaternion);
        c.scale.copy(m.scale);
        m.parent!.add(c);
        if (mat === mm.ghost) {
          c.visible = false;
          ghosts.push(c);
        }
      }
    }
    const mixer = new THREE.AnimationMixer(root);
    const clip = (n: string) => model.clips.find((c) => c.name.startsWith(n));
    const walk = clip("walk") ? mixer.clipAction(clip("walk")!) : null;
    const idle = clip("idle") ? mixer.clipAction(clip("idle")!) : null;
    const run = clip("run") ? mixer.clipAction(clip("run")!) : null;
    // 사람마다 숨쉬기 박자를 조금씩 다르게
    if (idle) {
      idle.play();
      idle.time = Math.random() * idle.getClip().duration;
    }
    for (const x of [walk, run]) {
      x?.play();
      x?.setEffectiveWeight(0);
    }
    const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.y = 0.62;
    shadow.renderOrder = 1;
    town.scene.add(root, shadow);
    a.face = a.faceTo ?? faceOfDir(a.d);
    const tails: Tail[] = [];
    for (const [nm, k] of TAIL_NAMES) {
      const bones = [0, 1, 2, 3, 4].map((i) => root.getObjectByName(nm + i));
      if (bones.every(Boolean))
        tails.push({
          bones: bones as THREE.Object3D[],
          rest: bones.map((b) => b!.quaternion.clone()),
          sim: bones.map(() => new THREE.Vector3()),
          prev: bones.map(() => new THREE.Vector3()),
          root0: new THREE.Vector3(),
          vel: new THREE.Vector3(),
          ready: false,
          k,
          ph: Math.random() * 100,
          len: [0, 0, 0, 0, 0],
        });
    }
    a.rig = { root, mixer, walk, idle, run, cur: idle, ghosts, overs, shadow, tails };
    return a.rig;
  }

  private placeRig(a: Avatar, r: RigView, dt: number) {
    // 숨쉬기 ↔ 걷기 ↔ 뛰기 (0.18초 섞기), 가는 속도에 맞춰 발 박자
    const want = a.moving ? (a.running && r.run ? r.run : r.walk) : r.idle;
    if (want && want !== r.cur) {
      want.reset().setEffectiveWeight(1).play();
      if (r.cur) r.cur.crossFadeTo(want, 0.18, false);
      r.cur = want;
    }
    if (r.walk) r.walk.timeScale = a === this.me && !a.running ? this.walkRate : SPEED / WALK_ANIM_V;
    if (r.run) r.run.timeScale = a === this.me && a.running ? this.walkRate : RUN_SPEED / RUN_ANIM_V;
    r.mixer.update(dt);
    // 돌아서기 (짧은 쪽으로, 0.1초쯤)
    const to = a.faceTo ?? a.face ?? 0;
    let f = a.face ?? to;
    let df = ((to - f + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    f += df * Math.min(1, dt * 14);
    a.face = f;
    const gh = this.hAt(a.x, a.y);
    r.root.position.set(a.x, gh + 0.02, a.y);
    r.root.rotation.y = f;
    r.shadow.position.set(a.x, gh + 0.015, a.y);
    if (r.tails.length && dt > 0) {
      r.root.updateMatrixWorld(true);
      this.fwd.set(Math.sin(f), 0, Math.cos(f));
      for (const t of r.tails) this.swingTail(t, dt);
    }
    // 건물에 가려지면 반투명 몸을 위에
    const hidden = !this.overview && !!this.blocker(a.x, a.y);
    for (const g of r.ghosts) g.visible = hidden;
    for (const o of r.overs) o.visible = !hidden;
  }

  /** 카메라에서 이 사람(가슴 · 머리)까지 사이를 막는 건물 */
  private blocker(x: number, y: number) {
    const town = this.town;
    if (!town) return null;
    const o = this.camera.position;
    for (const h of [0.9, 1.6]) {
      const d = this.bv.set(x - o.x, this.hAt(x, y) + h - o.y, y - o.z);
      const far = d.length() - 0.3;
      if (far <= 0) continue;
      this.ray.set(o, d.normalize());
      this.ray.far = far;
      for (const v of town.buildings) if (this.ray.intersectObject(v.pick, false).length) return v;
    }
    return null;
  }
  private bv = new THREE.Vector3();
  /** 지금 흔드는 사람이 보는 쪽 (세계) */
  private fwd = new THREE.Vector3();

  private tv = [0, 1, 2, 3, 4].map(() => new THREE.Vector3());
  private tq = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
  private tw = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  /**
   * 트윈테일 스프링: 동작이 정한 자세(A)를 따라가되 관성으로 늦게 · 출렁이게.
   * 점을 움직이고(관성 + 처짐 + 원래 자세로 당김) 마디 길이를 지킨 뒤, 뼈를 그 점 쪽으로 돌림
   */
  private swingTail(t: Tail, dt: number) {
    const B = t.bones,
      A = this.tv,
      S = t.sim,
      P = t.prev;
    for (let k = 0; k < 5; k++) B[k].quaternion.copy(t.rest[k]);
    B[0].updateMatrixWorld(true);
    for (let k = 0; k < 5; k++) A[k].setFromMatrixPosition(B[k].matrixWorld);
    for (let k = 1; k < 5; k++) t.len[k] = A[k].distanceTo(A[k - 1]);
    if (!t.ready || S[0].distanceToSquared(A[0]) > 4) {
      for (let k = 0; k < 5; k++) {
        S[k].copy(A[k]);
        P[k].copy(A[k]);
      }
      t.root0.copy(A[0]);
      t.vel.set(0, 0, 0);
      t.ready = true;
      return;
    }
    const h = Math.min(dt, 1 / 30),
      n = h * 60;
    const K = t.k;
    const damp = Math.pow(K.damp, n),
      pull = 1 - Math.pow(1 - K.pull, n);
    const [vel, dir, adir] = this.tw;
    // 바람 · 끌림: 목표점(A)을 옆 · 뒤로 살짝 옮김 (끝으로 갈수록 크게) — 앞머리는 앞쪽으로만, 뒷머리는 뒤로만
    if (K.wind || K.drag) {
      t.ph += h;
      const L = t.len[1] + t.len[2] + t.len[3] + t.len[4];
      const fx = this.fwd.x,
        fz = this.fwd.z;
      const sp = Math.min(Math.hypot(t.vel.x, t.vel.z), 6);
      const sw = (K.wind ?? 0) * L * (0.55 * Math.sin(t.ph * 1.3) + 0.3 * Math.sin(t.ph * 2.9 + 1.7));
      const fb = (K.wind ?? 0) * L * 0.35 * (0.5 + 0.5 * Math.sin(t.ph * 1.7 + 0.6));
      const dr = (K.drag ?? 0) * L * sp;
      for (let k = 1; k < 5; k++) {
        const q = k / 4;
        // 옆 = (fz, -fx)
        A[k].x += (fz * sw + (K.noBack ? fx * fb : K.noFwd ? -fx * (fb + dr) : 0)) * q;
        A[k].z += (-fx * sw + (K.noBack ? fz * fb : K.noFwd ? -fz * (fb + dr) : 0)) * q;
      }
    }
    // 뿌리 출렁임 = 이번 이동 - 평균 속도만큼 이동 → 꼬리를 그 반대로 더 밀어 크게 출렁이게
    vel.subVectors(A[0], t.root0);
    t.vel.lerp(dir.copy(vel).divideScalar(h), 1 - Math.pow(0.9, n));
    vel.addScaledVector(t.vel, -h).multiplyScalar(K.bounce - 1);
    for (let k = 1; k < 5; k++) S[k].sub(vel);
    t.root0.copy(A[0]);
    S[0].copy(A[0]);
    P[0].copy(A[0]);
    for (let k = 1; k < 5; k++) {
      vel.subVectors(S[k], P[k]).multiplyScalar(damp);
      P[k].copy(S[k]);
      S[k].add(vel);
      S[k].y -= K.g * h * h;
      S[k].lerp(A[k], pull);
      if (K.noFwd) {
        const c = dir.subVectors(S[k], A[k]).dot(this.fwd);
        if (c > 0) S[k].addScaledVector(this.fwd, -c);
      }
      if (K.noBack) {
        const c = dir.subVectors(S[k], A[k]).dot(this.fwd);
        if (c < 0) S[k].addScaledVector(this.fwd, -c);
      }
      // 마디 길이 그대로, 원래 방향에서 너무 벌어지지 않게
      const len = t.len[k];
      dir.subVectors(S[k], S[k - 1]).normalize();
      adir.subVectors(A[k], A[k - 1]).normalize();
      const ang = dir.angleTo(adir);
      if (ang > K.max) dir.lerp(adir, 1 - K.max / ang).normalize();
      S[k].copy(S[k - 1]).addScaledVector(dir, len);
    }
    const [qd, qw, qp] = this.tq;
    for (let k = 0; k < 4; k++) {
      const b = B[k],
        sc = this.tw[3];
      // 방금 갱신된 세계 행렬에서 바로 (조상을 다시 계산하지 않게)
      b.matrixWorld.decompose(vel, qw, sc);
      dir.setFromMatrixPosition(B[k + 1].matrixWorld).sub(vel).normalize();
      adir.subVectors(S[k + 1], vel).normalize();
      qd.setFromUnitVectors(dir, adir);
      b.parent!.matrixWorld.decompose(sc, qp, sc);
      b.quaternion.copy(qp.invert().multiply(qd.multiply(qw)));
      b.updateMatrixWorld(true);
    }
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
      m.position.set(a.x, this.hAt(a.x, a.y) + 0.05, a.y);
      m.scale.x = flip ? -1 : 1;
    }
    v.shadow.position.set(a.x, this.hAt(a.x, a.y) + 0.06, a.y);
  }

  private render(now: number, dt: number) {
    const town = this.town;
    const t = (now - this.t0) / 1000;
    // 카메라
    const cam = this.camera;
    const k = this.ovK;
    const near = this.house ? Math.max(28 * DEG, Math.min(72 * DEG, this.camPitch)) : this.clampPitch(this.camPitch);
    const pitch = near + (OV_PITCH - near) * k;
    // 보는 점: 서 있는 땅 높이 + 가슴 (언덕을 오르면 같이 올라감, 부드럽게)
    const gh = this.hAt(this.cam.x, this.cam.y);
    this.camH += (gh - this.camH) * Math.min(1, dt * 8);
    if (!this.camHSet) {
      this.camH = gh;
      this.camHSet = true;
    }
    const target = new THREE.Vector3(this.cam.x, (this.camH + LOOK_H) * (1 - k), this.cam.y);
    const cp = Math.cos(pitch);
    this.camDir.set(cp * Math.sin(this.camYaw), Math.sin(pitch), cp * Math.cos(this.camYaw));
    // 올려다보기(음수 각도): 카메라는 땅 높이 그대로 뒤에 두고, 보는 방향만 위로 꺾음
    const up = Math.min(0, pitch);
    const flatDir = new THREE.Vector3(Math.sin(this.camYaw), Math.max(0, Math.sin(pitch)), Math.cos(this.camYaw));
    if (up < 0) cam.position.copy(target).addScaledVector(flatDir.setY(0).normalize(), this.dist * Math.cos(up));
    else cam.position.copy(target).addScaledVector(this.camDir, this.dist);
    // 카메라가 언덕 속으로 들어가지 않게
    const floor = this.hAt(cam.position.x, cam.position.z) + (up < 0 ? 0.45 : 0.8);
    if (up < 0) cam.position.y = Math.max(floor, target.y - 0.3);
    if (cam.position.y < floor) cam.position.y = floor;
    cam.far = this.dist + 300;
    cam.updateProjectionMatrix();
    if (up < 0) {
      // 캐릭터가 화면 아래쪽에 오게, 위로 |각도| 만큼 올려다봄
      // 화면 밖으로 캐릭터가 안 나가게 실제 꺾는 각도는 절반쯤 (−30° → 위로 약 16°)
      const lu = up * 0.55;
      const look = cam.position.clone().addScaledVector(
        new THREE.Vector3(-Math.sin(this.camYaw) * Math.cos(lu), -Math.sin(lu), -Math.cos(this.camYaw) * Math.cos(lu)),
        this.dist
      );
      cam.lookAt(look);
    } else cam.lookAt(target);
    this.house?.update(cam.position);
    // 카메라와 보는 점 사이 나무는 성기게 (지도 볼 땐 끔)
    if (this.house) town?.setView(FAR_AWAY, FAR_AWAY);
    else if (k < 0.5) town?.setView(cam.position, target);
    else town?.setView(FAR_AWAY, FAR_AWAY);
    cam.updateMatrixWorld();
    this.vw = 2 * this.dist * Math.tan((cam.fov * DEG) / 2) * cam.aspect;

    if (town) {
      // 그림자는 보이는 곳만 (화면 폭이 크게 바뀔 때만 다시)
      const sun = town.sun;
      // 그림자: 보는 쪽(앞)으로 조금 밀어서, 원근으로 넓게 보이는 만큼
      const half = Math.min(90, Math.max(24, this.dist * 2.6 + 8));
      const fwd = Math.min(half * 0.5, this.dist * 1.2) * (1 - k);
      const sc = target.clone();
      sc.x -= Math.sin(this.camYaw) * fwd;
      sc.z -= Math.cos(this.camYaw) * fwd;
      sun.position.copy(sc).add(SUN_OFF);
      sun.target.position.copy(sc);
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
      // 하늘은 카메라를 따라다님, 안개는 카메라 거리만큼 밀어서
      if (this.sky) this.sky.position.copy(cam.position);
      const fog = town.scene.fog as THREE.Fog | null;
      if (fog) {
        fog.near = this.dist + 34 + k * 80;
        fog.far = this.dist + 130 + k * 120;
      }
      // 3D 캐릭터: 빛 방향은 카메라 기준으로, 외곽선은 화면에서 INK_PX 두께 (밀면 얇게, 당기면 조금만 두껍게)
      this.toonU.uLight.value.copy(TOON_LIGHT);
      const inkPx = INK_PX * Math.max(0.35, Math.min(1.15, this.baseDist / this.dist));
      this.inkU.uInk.value = (inkPx * 2 * Math.tan((cam.fov * DEG) / 2)) / Math.max(1, this.ch);
      // 사람
      for (const a of this.others.values()) if (!a.away && !this.house) this.placeAvatar(a, dt);
      for (const a of this.house ? [] : this.npcs) {
        const n = a.npc!,
          me = this.me;
        a.faceTo = me && Math.hypot(me.x - n.x, me.y - n.y) < n.talk * 2.2 ? Math.atan2(me.x - n.x, me.y - n.y) : n.face;
        this.placeAvatar(a, dt);
      }
      if (this.me) this.placeAvatar(this.me, dt);
      // 내가 건물 뒤면 그 건물을 비치게
      const meBlock = this.me ? this.blocker(this.me.x, this.me.y) : null;
      for (const v of town.buildings) {
        const hide = !!this.me && !this.overview && meBlock === v;
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
      const ring = this.near && typeof this.near !== "string" ? this.near : this.hover;
      town.doorRing.visible = !!ring;
      if (ring) {
        const f = doorFront(ring);
        town.doorRing.position.set(f.x, this.hAt(f.x, f.y) + 0.05, f.y);
        town.doorRing.scale.setScalar(1 + Math.sin(t * 5) * 0.08);
        (town.doorRing.material as THREE.MeshBasicMaterial).color.set(ring.accent);
      }
      // 가는 곳
      const g = this.me && this.path.length ? this.path[this.path.length - 1] : null;
      town.goalRing.visible = !!g;
      if (g) {
        town.goalRing.position.set(g.x, this.hAt(g.x, g.y) + 0.05, g.y);
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
    const o = this.camera.position;
    const far = (a: Avatar) => Math.hypot(a.x - o.x, a.y - o.z);
    const people = this.house
      ? this.me
        ? [this.me]
        : []
      : [...[...this.others.values()].filter((a) => !a.away), ...this.npcs, ...(this.me ? [this.me] : [])];
    // 가까운 사람 이름표가 위에 오게 (먼 사람부터 그림)
    people.sort((a, b) => far(b) - far(a));
    // 이름표 높이: 3D 는 머리 위 리본까지
    const headH = CHAR_TALL + (this.models.size ? 0.28 : 0.05);
    const fwdX = -Math.sin(this.camYaw),
      fwdY = -Math.cos(this.camYaw);
    for (const a of people) {
      if (this.overview && a !== this.me) continue;
      // 카메라 뒤
      if ((a.x - o.x) * fwdX + (a.y - o.z) * fwdY < 0.3) continue;
      const s = this.screen(a.x, a.y, headH);
      if (s.x < -80 || s.x > this.cw + 80 || s.y < -40 || s.y > this.ch + 120) continue;
      const sz = Math.max(0.72, Math.min(1, (this.baseDist * 1.3) / Math.max(1, far(a))));
      ctx.save();
      ctx.translate(s.x, s.y - 4);
      ctx.scale(sz, sz);
      this.drawTag(a, 0, 0, now);
      ctx.restore();
    }

    // 조이스틱 (폰: 왼쪽 아래에 늘 보임 · 누르면 손잡이가 따라감)
    if (this.phone && !this.overview && !this.mapOpen) {
      const j = this.joyAt();
      const ox = j.x,
        oy = j.y;
      let kx = ox,
        ky = oy;
      if (this.joy) {
        const dx = this.joy.x - ox,
          dy = this.joy.y - oy;
        const len = Math.min(JOY_R - 6, Math.hypot(dx, dy));
        const a = Math.atan2(dy, dx);
        kx = ox + Math.cos(a) * len;
        ky = oy + Math.sin(a) * len;
      }
      const on = !!this.joy;
      const g = ctx.createRadialGradient(ox, oy, JOY_R * 0.3, ox, oy, JOY_R);
      g.addColorStop(0, on ? "rgba(20,18,30,0.42)" : "rgba(20,18,30,0.28)");
      g.addColorStop(1, on ? "rgba(20,18,30,0.55)" : "rgba(20,18,30,0.38)");
      ctx.fillStyle = g;
      ctx.strokeStyle = on ? "rgba(242,193,78,0.85)" : "rgba(242,193,78,0.45)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ox, oy, JOY_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // 방향 눈금
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        ctx.save();
        ctx.translate(ox + Math.cos(a) * (JOY_R - 9), oy + Math.sin(a) * (JOY_R - 9));
        ctx.rotate(a + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, -4);
        ctx.lineTo(4, 2);
        ctx.lineTo(-4, 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      const kg = ctx.createLinearGradient(kx, ky - 22, kx, ky + 22);
      kg.addColorStop(0, "rgba(255,240,200,0.95)");
      kg.addColorStop(1, "rgba(200,160,80,0.9)");
      ctx.fillStyle = kg;
      ctx.strokeStyle = "rgba(60,40,10,0.6)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(kx, ky, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
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
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // NPC: 하는 일(작게, 금색) + 이름(민트색) · 말 걸 수 있으면 말풍선 표시
    if (a.npc) {
      ctx.font = `700 10.5px "Nanum Gothic", sans-serif`;
      const t1 = `<${a.npc.title}>`;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillText(t1, px + 1, top - 15);
      ctx.fillStyle = "#F2D27A";
      ctx.fillText(t1, px, top - 16);
      ctx.font = `800 13px "Nanum Gothic", sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(10,30,20,0.8)";
      ctx.strokeText(a.name, px, top);
      ctx.fillStyle = "#9BF0C8";
      ctx.fillText(a.name, px, top);
      if (this.near === a.npc.id) {
        ctx.font = `16px sans-serif`;
        ctx.fillText("💬", px, top - 34 + Math.sin(now / 260) * 2);
      }
      return;
    }
    ctx.font = `700 12px "Nanum Gothic", sans-serif`;
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

  // ───────────── 작은 지도 (보는 쪽이 위 — 시점을 돌리면 같이 돎) ─────────────

  drawMinimap(m: CanvasRenderingContext2D, w: number, h: number) {
    // 땅 (x, y) → 지도: 카메라가 보는 쪽이 위로 오게 돌리기만 (위에서 내려다본 모양)
    const SP = 1;
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
    m.strokeStyle = "#5fc3e8";
    m.lineWidth = RIVER.half * 2;
    m.beginPath();
    for (let y = BOUNDS.y0; y <= BOUNDS.y1; y += 4) (y === BOUNDS.y0 ? m.moveTo : m.lineTo).call(m, riverX(y), y);
    m.stroke();
    m.fillStyle = "#c98f5a";
    for (const br of BRIDGES) m.fillRect(riverX(br.y) - RIVER.bank - 1.5, br.y - br.w / 2, (RIVER.bank + 1.5) * 2, br.w);
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
