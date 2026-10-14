/**
 * 격투게임 캔버스 그리기 — 월드(VIEW_W×VIEW_H)를 화면 해상도에 맞게 키워서 부드럽게 (플랫폼 대전: x·높이).
 * 시뮬레이션 상태를 읽기만 하고 바꾸지 않음. 불꽃·흔들림 같은 연출은 여기서만 가짐.
 */
import { CHARS, SUB } from "@/lib/fight/chars";
import { MAPS } from "@/lib/fight/maps";
import {
  VIEW_H,
  VIEW_W,
  isAir as isAirF,
  platBelow,
  projRect,
  screenY,
  type Ev,
  type Fighter,
  type Proj,
  type State,
} from "@/lib/fight/sim";
import { frameRect, pickFrame, type FrameRect, type LoadedSheet } from "@/lib/fight/sprites";
import { Motion, type Pose } from "./motion";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  kind: "spark" | "ring" | "dust" | "text" | "flame" | "bolt" | "shard" | "streak" | "vstreak";
  text?: string;
}

/** 캐릭터별 능력 (탄·타격 이펙트 모양) */
const ELEMENT: Record<string, "fire" | "bolt" | "ice" | "wind" | "whip" | "water"> = {
  zena: "bolt",
  kai: "wind",
  igna: "fire",
  soyoung: "whip",
  lily: "water",
  gunmo: "ice",
  ivan: "fire",
};

/** 건모 Alt+F4 블루스크린 길이 (프레임) */
const BSOD_T = 40;

/** 탄 그림 (public/fight/fx/<이름>.webp, 오른쪽을 보는 그림) — 처음 쓸 때 불러옴 */
const fxCache = new Map<string, HTMLImageElement | null>();
/** 불러오기가 끝난 그림 (실패 포함) — 시작 전에 다 받아 두려고 */
const fxDone = new Set<string>();
function fxImg(name: string): HTMLImageElement | null {
  if (!fxCache.has(name)) {
    fxCache.set(name, null);
    const im = new Image();
    im.onload = () => {
      fxCache.set(name, im);
      fxDone.add(name);
    };
    im.onerror = () => fxDone.add(name);
    im.src = `/fight/fx/${name}.webp`;
  }
  return fxCache.get(name) ?? null;
}
/** v2 에셋의 움직이는 탄 그림 (fx/<캐릭터>-<이름>-0..n): 캐릭터·기술 → [이름, 장 수, 판정 높이 대비 배율, 판정 중심 가로 위치] */
const PROJ_ANIM: Record<string, Partial<Record<"S" | "X", [string, number, number, number]>>> = {
  igna: { S: ["igna-fireball", 4, 2.6, 0.8] },
  "igna-fw": { S: ["igna-fw-fireball", 4, 2.6, 0.8] },
  lily: { S: ["lily-bubble", 4, 1.3, 0.72], X: ["lily-wave", 4, 1.55, 0.5] },
  zena: { S: ["zena-spear", 4, 3.2, 0.75] },
};
/** v2 에셋의 소환(불기둥 등) 그림: 캐릭터 → [이름, 장 수] — 바닥 기준, 판정 높이에 맞춤 */
const PILLAR_ANIM: Record<string, [string, number]> = { igna: ["igna-pillar", 4], "igna-fw": ["igna-fw-pillar", 4], zena: ["zena-bolt", 4] };
/** 캐릭터·기술별 탄 그림: [그림, 판정 크기 대비 그림 높이 배율, 판정 중심이 그림 가로 어디쯤(0~1)] */
const PROJ_ART: Record<string, Partial<Record<"S" | "X", [string, number, number]>>> = {
  igna: { S: ["igna-fireball", 1.7, 0.78] },
  "igna-fw": { S: ["igna-fw-fireball-0", 1.7, 0.78] },
};

/**
 * v2 에셋 그림 효과 (public/fight/fx/<캐릭터>-<이름>-<n>.webp): 이름 → [장 수, 월드 크기 배율, 빛(더하기 합성)인가]
 * 원본 대비 0.48로 저장되고 캐릭터 시트 scale(≈2.15)의 0.8배 → 월드 px = 그림 px / (scale × 0.8)
 */
const FX_SETS: Record<string, Record<string, [number, number, boolean]>> = {
  kai: { spark: [4, 0.75, true], guard: [2, 0.6, true], dust: [4, 0.5, false], rush: [4, 0.7, true], burst: [4, 1.3, true] },
  igna: { spark: [4, 0.7, true], guard: [2, 0.6, true], dust: [4, 0.5, false] },
  // 스킨 (lib/fight/skins.ts): 없는 효과는 캐릭터 기본 그림으로
  "igna-fw": { spark: [4, 0.7, true], guard: [2, 0.6, true] },
  soyoung: { spark: [4, 0.6, true], guard: [2, 0.6, true], dust: [4, 0.5, false], burst: [4, 1.0, true] },
  lily: { spark: [4, 0.6, true], guard: [2, 0.6, true], dust: [4, 0.5, false] },
  // 제나: flash(일섬 빛줄기)·mark(낙인)·strike(낙뢰)는 drawZap 이, flash 는 공중 L 뇌격돌 꼬리로도 씀
  zena: { spark: [4, 0.6, true], guard: [2, 0.6, true], dust: [4, 0.5, false], flash: [1, 1, true], mark: [1, 1, true], strike: [1, 1, true] },
  // 건모: box(Ctrl+A 선택 박스)·win(Alt+Tab 창)·err(금요일 배포 블록)·pause(⏸)·confuse(💫 로딩 원)는 따로 그림
  gunmo: {
    spark: [4, 0.6, true],
    guard: [2, 0.6, true],
    dust: [2, 0.5, false],
    box: [4, 1, true],
    win: [4, 1, true],
    err: [4, 1, true],
    pause: [2, 1, true],
    confuse: [2, 1, true],
    // Alt+F4: crash(깨지는 창)·ring(충격파)는 강제 종료 맞은 자리, glitch(파란 픽셀 조각)는 (응답 없음) 동안
    crash: [1, 1.1, true],
    glitch: [1, 0.7, true],
    ring: [1, 1.2, true],
  },
  // 학창시절 건모: box · win 은 반투명 칠판(x 방정식), crash 는 깨지는 칠판, glitch 는 분필가루 — 나머지는 건모 기본
  "gunmo-school": { box: [4, 1, false], win: [4, 1, false], crash: [1, 1.1, false], glitch: [1, 0.7, true], ring: [1, 1.2, true] },
  // 이반: aura(철곰권 기 모으기)·wave(철곰권 충격파)·burst(붉은 폭풍)·crack(곰 포옹 내리꽂기 균열)는 따로 띄움
  ivan: {
    spark: [4, 0.7, true],
    guard: [2, 0.6, true],
    dust: [2, 0.5, false],
    aura: [4, 0.95, true],
    wave: [4, 0.9, true],
    burst: [4, 1.35, true],
    crack: [4, 0.95, false],
  },
};
/** 캐릭터 하나가 쓰는 그림 효과 파일 이름 전부 */
/** 바닥에 남는 장판 그림 (fx/<이름>-0..3 반복, -in-0..1 나타나기, -out-0..1 꺼지기) — 이그나 업화주 불 장판 */
const FLOOR_FX: Record<string, string> = { igna: "igna-floor", "igna-fw": "igna-fw-floor" };
const floorNames = (b: string) => [0, 1, 2, 3].map((k) => `${b}-${k}`).concat([`${b}-in-0`, `${b}-in-1`, `${b}-out-0`, `${b}-out-1`]);

function fxNames(id: string): string[] {
  const out: string[] = [];
  if (FLOOR_FX[id]) out.push(...floorNames(FLOOR_FX[id]));
  for (const [nm, d] of Object.entries(FX_SETS[id] ?? {})) for (let k = 0; k < d[0]; k++) out.push(`${id}-${nm}-${k}`);
  for (const a of Object.values(PROJ_ANIM[id] ?? {})) if (a) for (let k = 0; k < a[1]; k++) out.push(`${a[0]}-${k}`);
  const pa = PILLAR_ANIM[id];
  if (pa) for (let k = 0; k < pa[1]; k++) out.push(`${pa[0]}-${k}`);
  for (const a of Object.values(PROJ_ART[id] ?? {})) if (a) out.push(a[0]);
  return out;
}

interface FxAnim {
  key: string;
  n: number;
  x: number;
  y: number;
  t: number;
  dur: number;
  flip: boolean;
  k: number;
  glow: boolean;
  /** 아래 가운데 기준 (먼지 등 바닥 것) */
  ground: boolean;
  /** 그릴 크기(px)를 정해 둘 때 (없으면 그림 크기 × k) */
  size?: [number, number];
  /** 이 프레임부터 재생 (앞 프레임 건너뜀) */
  from?: number;
  /** 진하기 배율 */
  alpha?: number;
}

function glowAt(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  g.save();
  g.globalCompositeOperation = "lighter";
  const l = g.createRadialGradient(x, y, 0, x, y, r);
  l.addColorStop(0, color);
  l.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = l;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();
}

/** 캔버스 최대 폭(px) — 이보다 크게 그리면 고해상도 전체화면에서 프레임이 떨어짐 */
const MAX_CANVAS_W = 1600;

export class FightRenderer {
  private g: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement | null = null;
  private bgKey = "";
  private tmp: HTMLCanvasElement | null = null;
  private parts: Particle[] = [];
  private shake = 0;
  /** 캐릭터별 움직임 연출 상태 (숨쉬기·착지·잔상 등) */
  private motion: [Motion, Motion] = [new Motion(), new Motion()];
  private fx: FxAnim[] = [];

  /** 그림 효과 하나 띄우기 (그 캐릭터에 그 효과 그림이 있을 때만) — 성공하면 true */
  private spawnFx(
    who: Fighter,
    name: string,
    x: number,
    y: number,
    face: number,
    dur = 16,
    ground = false,
    opt: { size?: [number, number]; from?: number; alpha?: number } = {}
  ) {
    const own = this.lookOf(who);
    const id = FX_SETS[own]?.[name] ? own : CHARS[who.ch].id;
    const d = FX_SETS[id]?.[name];
    if (!d) return false;
    this.fx.push({ key: `${id}-${name}`, n: d[0], x, y, t: 0, dur, flip: face < 0, k: d[1], glow: d[2], ground, ...opt });
    return true;
  }

  private drawFx() {
    const g = this.g;
    for (const e of this.fx) {
      const f0 = e.from ?? 0;
      const k = Math.min(e.n - 1, f0 + Math.floor((e.t / e.dur) * (e.n - f0)));
      const im = fxImg(`${e.key}-${k}`);
      if (!im) continue;
      const w = e.size ? e.size[0] : (im.width / 1.72) * e.k,
        h = e.size ? e.size[1] : (im.height / 1.72) * e.k;
      g.save();
      if (e.glow) g.globalCompositeOperation = "lighter";
      g.globalAlpha = Math.min(1, 1.6 * (1 - e.t / e.dur) + 0.2) * (e.alpha ?? 1);
      g.translate(e.x, e.y);
      if (e.flip) g.scale(-1, 1);
      g.drawImage(im, -w / 2, e.ground ? -h : -h / 2, w, h);
      g.restore();
    }
  }
  private flash = 0;
  /** 건모 Alt+F4: 화면 전체 블루스크린 남은 프레임 */
  private bsod = 0;
  /** 학창시절 건모 스킨: 블루스크린 대신 칠판 화면 */
  private bsodSchool = false;
  /** 일섬 빛줄기 · 낙인 번개 (그림용) */
  private lines: { x0: number; x1: number; y: number; life: number; max: number }[] = [];
  private bolts: { x: number; y: number; life: number; max: number }[] = [];
  private flashColor = "#fff";
  sheets: (LoadedSheet | null)[] = [null, null];
  /** 스킨: 자리마다 그림 이름 (lib/fight/skins look — 캐릭터 id 또는 스킨 id, "" = 기본) */
  looks: [string, string] = ["", ""];
  /** 지금 그리는 판 (스킨을 자리로 찾으려고) */
  private cur: State | null = null;
  /** 그 선수의 그림 이름 (스킨이면 스킨 id) */
  private lookOf(f: Fighter): string {
    const i = this.cur && this.cur.p[1] === f ? 1 : 0;
    return this.looks[i] || CHARS[f.ch].id;
  }

  constructor(private canvas: HTMLCanvasElement) {
    this.g = canvas.getContext("2d")!;
  }

  /** 캔버스 크기를 보이는 크기 × 화면 배율로 */
  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    // 고해상도 화면 전체화면이면 3800px 넘게 커져서 프레임이 무너짐 → 1600px까지만 (도트 그림이라 더 키워도 차이 없음)
    const w = Math.max(VIEW_W, Math.min(MAX_CANVAS_W, Math.round(r.width * dpr)));
    const h = Math.round((w * VIEW_H) / VIEW_W);
    if (this.canvas.width !== w) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.bgKey = "";
    }
  }

  /** 시작 전에 그림이 다 준비됐나 (캐릭터 시트 둘 + 맵 배경 + 두 캐릭터의 탄·기둥·효과 그림) —
   *  덜 됐으면 대신 그린 임시 그림(네모 등)이 잠깐 보이지 않게 */
  ready(s: State) {
    this.cur = s;
    const map = MAPS[s.map] ?? MAPS[0];
    if (!this.sheets[0] || !this.sheets[1] || (map.bg && !this.bgImage(map.id, map.bg))) return false;
    if (this.fxReady) return true;
    let all = true;
    for (const f of s.p) {
      for (const n of [...fxNames(CHARS[f.ch].id), ...(this.lookOf(f) !== CHARS[f.ch].id ? fxNames(this.lookOf(f)) : [])]) {
        fxImg(n);
        if (!fxDone.has(n)) all = false;
      }
    }
    this.fxReady = all;
    return all;
  }
  private fxReady = false;
  /** 준비 중 화면 (검은 바탕) */
  drawLoading() {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#07080C";
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** 맵 배경 그림 (MapDef.bg) — 없으면 코드로 그린 배경 */
  private bgImg = new Map<string, HTMLImageElement | null>();
  private bgImage(id: string, src?: string) {
    if (!src) return null;
    if (!this.bgImg.has(id)) {
      this.bgImg.set(id, null);
      const im = new Image();
      im.onload = () => {
        this.bgImg.set(id, im);
        this.bgKey = "";
      };
      im.src = src;
    }
    return this.bgImg.get(id) ?? null;
  }

  private stage(s: State, k: number) {
    const map = MAPS[s.map] ?? MAPS[0];
    const img = this.bgImage(map.id, map.bg);
    const key = `${s.map}:${this.canvas.width}:${img ? 1 : 0}`;
    if (this.bg && this.bgKey === key) return this.bg;
    const c = this.bg ?? document.createElement("canvas");
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext("2d")!;
    g.setTransform(k, 0, 0, k, 0, 0);
    if (img) {
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, VIEW_W, VIEW_H);
    } else {
      // 그림이 아직 없을 때 (불러오는 중): 어두운 판
      g.fillStyle = "#1A1C26";
      g.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    if (!map.bgPlats || !img) {
      // 발판 위치만 표시 (그림에 발판이 없을 때)
      g.fillStyle = "rgba(230,210,150,0.85)";
      for (const p of map.plats) g.fillRect(p.x0, VIEW_H - p.y, p.x1 - p.x0, p.solid ? 6 : 4);
    }
    this.bg = c;
    this.bgKey = key;
    return c;
  }

  /** 시뮬레이션 이벤트 → 연출 */
  events(evs: Ev[], s: State) {
    this.cur = s;
    for (const e of evs) {
      const x = e.x / SUB,
        y = screenY(e.h);
      if (e.k === "hit" || e.k === "throw") {
        const a = s.p[e.p];
        this.spawnFx(a, "spark", x, y, a.face, 12);
        if (e.k === "hit" && CHARS[a.ch].id === "ivan") {
          // 철곰권: 맞힌 자리에서 앞으로 퍼지는 충격파 / 붉은 폭풍: 큰 폭발
          if (e.m === "S" && !a.aerial && !isAirF(s, a)) this.spawnFx(a, "wave", x + a.face * 18, y, a.face, 16);
          else if (e.m === "X") {
            this.spawnFx(a, "burst", x + a.face * 22, y, a.face, 28);
            this.flash = 3;
            this.flashColor = "#FFD0D0";
          }
        }
      } else if (e.k === "block" || e.k === "just") {
        const d = s.p[1 - e.p];
        this.spawnFx(d, "guard", d.x / SUB + d.face * 12, y, d.face, 12);
      } else if (e.k === "dash") {
        const a = s.p[e.p];
        if (e.v === 0) this.spawnFx(a, "dust", a.x / SUB - a.face * 22, screenY(a.h), a.face, 18, true);
      } else if (e.k === "swap") {
        // 건모 Alt+Tab: 맞히는 순간 공격 동작이 끝나 붙어 있던 창이 사라지므로 따로 띄움
        //  - 지금 두 사람을 감싸는 창 하나 (히트스톱 동안 꽉 참 → 깜빡 → 사라짐) = "창이 바뀜"
        //  - 건모가 떠난 자리(e.x·e.h)에 흐린 창 하나 + 거기서 지금 자리로 날아가는 파란 조각
        const a = s.p[e.p],
          d = s.p[1 - e.p];
        const ax = a.x / SUB,
          dx = d.x / SUB;
        const cy = screenY(Math.max(a.h, d.h) + 32 * SUB);
        this.spawnFx(a, "win", (ax + dx) / 2, cy, a.face, 34, false, {
          size: [Math.abs(ax - dx) + 84, 96],
          from: 1,
          alpha: 0.85,
        });
        const ox = e.x / SUB,
          oy = screenY(e.h + 32 * SUB);
        if (Math.abs(ox - ax) > 24 || Math.abs(oy - cy) > 24) {
          this.spawnFx(a, "win", ox, oy, a.face, 20, false, { size: [62, 76], from: 2, alpha: 0.5 });
          for (let i = 0; i < 12; i++) {
            const u = i / 11;
            this.parts.push({
              x: ox + (ax - ox) * u, y: oy + (cy - oy) * u + (Math.random() - 0.5) * 24,
              vx: Math.sign(ax - ox) * (0.6 + Math.random()), vy: -0.2 - Math.random() * 0.3,
              life: 16, max: 16, color: i % 2 ? "#9BD0FF" : "#3B9CFF", size: 1.5, kind: "shard",
            });
          }
        }
      }
      if (e.k === "hit") {
        const power = e.m === "X" ? 2 : e.m === "H" || e.m === "S" ? 1 : 0;
        const ch = CHARS[s.p[e.p].ch];
        const el = ELEMENT[ch.id] ?? "fire";
        for (let i = 0; i < 10 + power * 6; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 1 + Math.random() * (2 + power * 1.5);
          this.parts.push({
            x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 16 + power * 4, max: 16 + power * 4,
            color: i % 3 ? "#FFF6D6" : ch.color, size: 1 + power * 0.5,
            kind: el === "fire" ? "flame" : el === "bolt" ? "bolt" : el === "wind" || el === "whip" ? "spark" : "shard",
          });
        }
        this.parts.push({ x, y, vx: 0, vy: 0, life: 10, max: 10, color: "#fff", size: 7 + power * 4, kind: "ring" });
        this.shake = Math.max(this.shake, 2 + power * 3);
        this.parts.push({
          x: x + (Math.random() - 0.5) * 22, y: y - 14 - Math.random() * 10, vx: 0, vy: -0.5, life: 30, max: 30,
          color: "#FFE08A", size: 1, kind: "text", text: String(e.v),
        });
      } else if (e.k === "just" || e.k === "counter" || e.k === "tech") {
        // 저스트 가드 / 카운터 / 잡기 풀기 글자
        const txt = e.k === "just" ? "JUST!" : e.k === "counter" ? "COUNTER!" : "TECH";
        const col = e.k === "just" ? "#9BE7FF" : e.k === "counter" ? "#FFB347" : "#C8FF9B";
        this.parts.push({ x, y: y - 10, vx: 0, vy: -0.5, life: 34, max: 34, color: col, size: 1.3, kind: "text", text: txt });
        this.parts.push({ x, y, vx: 0, vy: 0, life: 12, max: 12, color: col, size: 13, kind: "ring" });
        if (e.k === "counter") this.shake = Math.max(this.shake, 3);
      } else if (e.k === "charged") {
        // 철곰권 기를 끝까지 모음
        const a = s.p[e.p];
        this.parts.push({ x, y: y - 22, vx: 0, vy: -0.5, life: 30, max: 30, color: "#FF4D4D", size: 1.3, kind: "text", text: "MAX!" });
        this.parts.push({ x, y, vx: 0, vy: 0, life: 14, max: 14, color: "#FF6B6B", size: 22, kind: "ring" });
        this.spawnFx(a, "aura", a.x / SUB, screenY(a.h + 34 * SUB), a.face, 12, false, { from: 3 });
        this.shake = Math.max(this.shake, 2);
      } else if (e.k === "crush") {
        // 다 모은 철곰권이 가드를 부숨
        const a = s.p[e.p];
        this.parts.push({ x, y: y - 14, vx: 0, vy: -0.6, life: 38, max: 38, color: "#FF3B3B", size: 1.5, kind: "text", text: "GUARD CRUSH!" });
        this.parts.push({ x, y, vx: 0, vy: 0, life: 16, max: 16, color: "#FFC2C2", size: 26, kind: "ring" });
        for (let i = 0; i < 12; i++)
          this.parts.push({
            x, y, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6, life: 18, max: 18,
            color: i % 2 ? "#CFEFFF" : "#FF6B6B", size: 1.5, kind: "shard",
          });
        this.spawnFx(a, "wave", x + a.face * 18, y, a.face, 18);
        this.flash = 4;
        this.flashColor = "#fff";
        this.shake = Math.max(this.shake, 7);
      } else if (e.k === "shock") {
        this.parts.push({ x, y: y - 6, vx: 0, vy: -0.6, life: 34, max: 34, color: "#FFE45C", size: 1.25, kind: "text", text: "SHOCK!" });
        for (let i = 0; i < 8; i++)
          this.parts.push({
            x, y: y - 20, vx: (Math.random() - 0.5) * 5, vy: (Math.random() - 0.5) * 5, life: 14, max: 14,
            color: "#FFF27A", size: 1, kind: "bolt",
          });
      } else if (e.k === "zapMark") {
        // 일섬 낙인: 보라·흰 번개 고리
        this.parts.push({ x, y: y - 6, vx: 0, vy: -0.5, life: 40, max: 40, color: "#E9D8FF", size: 1.25, kind: "text", text: "MARKED" });
        this.parts.push({ x, y: y + 30, vx: 0, vy: 0, life: 18, max: 18, color: "#C9A7FF", size: 22, kind: "ring" });
      } else if (e.k === "zapLine") {
        // 일섬이 지나간 자리: 화면을 가르는 빛줄기 (잠깐 남았다 사라짐)
        this.lines.push({ x0: e.x / SUB, x1: e.v / SUB, y, life: 22, max: 22 });
        this.flash = Math.max(this.flash, 3);
        this.flashColor = "#FFF6C8";
        this.shake = Math.max(this.shake, 4);
      } else if (e.k === "zapBurst") {
        // 낙인이 터짐: 하늘에서 번개가 내리꽂힘
        this.bolts.push({ x, y: y + 40, life: 16, max: 16 });
        this.parts.push({ x, y: y - 30, vx: 0, vy: -0.6, life: 40, max: 40, color: "#FFF27A", size: 1.6, kind: "text", text: `⚡ ${e.v}` });
        this.parts.push({ x, y, vx: 0, vy: 0, life: 20, max: 20, color: "#FFF6A8", size: 34, kind: "ring" });
        for (let i = 0; i < 16; i++)
          this.parts.push({
            x, y, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8, life: 16, max: 16,
            color: i % 2 ? "#FFFFFF" : "#FFE45C", size: 1.2, kind: "bolt",
          });
        this.flash = 6;
        this.flashColor = "#FFF6C8";
        this.shake = Math.max(this.shake, 10);
      } else if (e.k === "bsod") {
        // Alt+F4 강제 종료: 화면 전체 블루스크린 + 맞은 자리에 깨진 창 조각
        this.bsod = BSOD_T;
        this.shake = Math.max(this.shake, 8);
        const ga = s.p[e.p];
        this.bsodSchool = this.looks[e.p] === "gunmo-school";
        this.spawnFx(ga, "crash", x, y - 4, ga.face, 30);
        this.spawnFx(ga, "ring", x, y - 4, ga.face, 22);
        this.spawnFx(ga, "glitch", x - ga.face * 6, y - 8, ga.face, 40);
        this.parts.push({ x, y: y - 14, vx: 0, vy: -0.5, life: 60, max: 60, color: "#9CC8FF", size: 1.5, kind: "text", text: this.bsodSchool ? "강제 하교!" : "FORCE QUIT!" });
        this.parts.push({ x, y, vx: 0, vy: 0, life: 18, max: 18, color: "#5AA0FF", size: 30, kind: "ring" });
        for (let i = 0; i < 14; i++)
          this.parts.push({
            x, y: y - 10, vx: (Math.random() - 0.5) * 7, vy: -1 - Math.random() * 4, life: 22, max: 22,
            color: i % 3 ? "#1E6FE0" : "#FFFFFF", size: 1.6, kind: "spark",
          });
      } else if (e.k === "burn") {
        this.parts.push({ x, y: y - 6, vx: 0, vy: -0.6, life: 34, max: 34, color: "#FF8A3D", size: 1.25, kind: "text", text: e.v > 1 ? `BURN ×${e.v}` : "BURN!" });
        for (let i = 0; i < 10; i++)
          this.parts.push({
            x: x + (Math.random() - 0.5) * 20, y: y - 10, vx: (Math.random() - 0.5) * 2, vy: -1 - Math.random() * 2, life: 18, max: 18,
            color: Math.random() < 0.5 ? "#FFB347" : "#FF5A1F", size: 1.3, kind: "spark",
          });
      } else if (e.k === "trap" || e.k === "pop") {
        const pop = e.k === "pop";
        if (!pop)
          this.parts.push({ x, y: y - 18, vx: 0, vy: -0.5, life: 32, max: 32, color: "#9BE7FF", size: 1.2, kind: "text", text: "BUBBLE!" });
        for (let i = 0; i < (pop ? 12 : 6); i++) {
          const a = (i / (pop ? 12 : 6)) * Math.PI * 2;
          this.parts.push({
            x: x + Math.cos(a) * 14, y: y + Math.sin(a) * 14, vx: Math.cos(a) * (pop ? 2.2 : 0.8), vy: Math.sin(a) * (pop ? 2.2 : 0.8),
            life: 14, max: 14, color: "#CFF3FF", size: 1.1, kind: "spark",
          });
        }
      } else if (e.k === "launch") {
        this.parts.push({ x, y: y - 30, vx: 0, vy: -0.6, life: 30, max: 30, color: "#FFE08A", size: 1.2, kind: "text", text: "LAUNCH!" });
        this.parts.push({ x, y, vx: 0, vy: 0, life: 14, max: 14, color: "#FFE08A", size: 14, kind: "ring" });
        this.shake = Math.max(this.shake, 3);
      } else if (e.k === "throw" && e.m === "S") {
        // 이반 곰 포옹: 공중에서 붙잡음
        const a = s.p[e.p];
        this.parts.push({ x, y: y - 14, vx: 0, vy: -0.5, life: 32, max: 32, color: "#FF6B6B", size: 1.5, kind: "text", text: "GRAB!" });
        this.parts.push({ x, y, vx: 0, vy: 0, life: 14, max: 14, color: "#FF8A8A", size: 22, kind: "ring" });
        this.parts.push({ x, y, vx: 0, vy: 0, life: 20, max: 20, color: "#FF4D4D", size: 34, kind: "ring" });
        this.spawnFx(a, "spark", x, y, a.face, 12);
        for (let i = 0; i < 12; i++) {
          const an = (i / 12) * Math.PI * 2;
          this.parts.push({
            x, y, vx: Math.cos(an) * 2.8, vy: Math.sin(an) * 2.8, life: 14, max: 14,
            color: i % 2 ? "#FFD0C0" : "#FF4D4D", size: 1.3, kind: "spark",
          });
        }
        this.shake = Math.max(this.shake, 5);
      } else if (e.k === "throw") {
        // 잡기 성공: 보라색 고리 + 글자 (타격과 다른 색으로 한눈에)
        this.parts.push({ x, y, vx: 0, vy: 0, life: 14, max: 14, color: "#E9D5FF", size: 20, kind: "ring" });
        this.parts.push({ x, y, vx: 0, vy: 0, life: 20, max: 20, color: "#A855F7", size: 32, kind: "ring" });
        this.parts.push({ x, y: y - 16, vx: 0, vy: -0.5, life: 30, max: 30, color: "#D8B4FE", size: 1.55, kind: "text", text: "GRAB!" });
        this.shake = Math.max(this.shake, 4);
      } else if (e.k === "block") {
        this.parts.push({ x, y, vx: 0, vy: 0, life: 12, max: 12, color: "#8FD3FF", size: 11, kind: "ring" });
        for (let i = 0; i < 6; i++)
          this.parts.push({
            x, y, vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 2, life: 10, max: 10,
            color: "#CFEFFF", size: 1, kind: "spark",
          });
      } else if (e.k === "slam" && e.v === 0) {
        // 마무리 내려찍기 맞힘
        this.parts.push({ x, y: y - 16, vx: 0, vy: -0.5, life: 36, max: 36, color: "#FF6B5C", size: 1.5, kind: "text", text: "SLAM!" });
        this.parts.push({ x, y, vx: 0, vy: 0, life: 14, max: 14, color: "#FFD0C8", size: 20, kind: "ring" });
        this.flash = 4;
        this.flashColor = "#fff";
        this.shake = Math.max(this.shake, 6);
      } else if (e.k === "immune") {
        // 상태 이상 면역 (풀린 지 2초 안 / 이미 걸린 채): 피해만 들어감
        this.parts.push({ x, y, vx: 0, vy: -0.45, life: 34, max: 34, color: "#C4B5FD", size: 1.2, kind: "text", text: "IMMUNE" });
        this.parts.push({ x, y: y + 30, vx: 0, vy: 0, life: 10, max: 10, color: "#DDD6FE", size: 14, kind: "ring" });
      } else if (e.k === "stun") {
        // 이반 곰 포옹으로 내리꽂혀 기절: 머리 위 글자 + 도는 별
        this.parts.push({ x, y, vx: 0, vy: -0.4, life: 40, max: 40, color: "#FFE45C", size: 1.3, kind: "text", text: "STUN!" });
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          this.parts.push({
            x: x + Math.cos(a) * 12, y: y + 8 + Math.sin(a) * 4, vx: -Math.sin(a) * 0.8, vy: Math.cos(a) * 0.3,
            life: 30, max: 30, color: "#FFF27A", size: 1.2, kind: "spark",
          });
        }
      } else if (e.k === "slam") {
        // 바닥에 처박힘: 크게 퍼지는 충격파 + 흙먼지 (이반 곰 포옹이면 바닥 균열도)
        const sl = s.p[1 - e.p];
        if (CHARS[sl.ch].id === "ivan" && sl.st === "atk" && sl.mv === "S") {
          // 곰 포옹 내리꽂기: 균열 + 붉은 고리 (10.12 조금만 크게)
          this.spawnFx(sl, "crack", x, y + 6, sl.face, 30, true, { size: [160, 54] });
          this.flash = 3;
          this.flashColor = "#FFD0D0";
          this.shake = Math.max(this.shake, 8);
          this.parts.push({ x, y: y - 4, vx: 0, vy: 0, life: 20, max: 20, color: "#FF6B5A", size: 40, kind: "ring" });
        }
        for (let i = 0; i < 24; i++) {
          const d = i % 2 ? 1 : -1;
          this.parts.push({
            x, y: y - 2 - Math.random() * 8, vx: d * (2.5 + Math.random() * 4.5), vy: -Math.random() * 0.8,
            life: 22, max: 22, color: i % 3 ? "rgba(240,230,210,0.95)" : "#FFB36B", size: 1.8, kind: "streak",
          });
        }
        for (let i = 0; i < 10; i++)
          this.parts.push({
            x: x + (Math.random() - 0.5) * 30, y: y - 2, vx: (Math.random() - 0.5) * 3, vy: -1.5 - Math.random() * 2.5,
            life: 20, max: 20, color: "#C9B79A", size: 1.5, kind: "shard",
          });
        this.parts.push({ x, y: y - 4, vx: 0, vy: 0, life: 16, max: 16, color: "#FFE2C2", size: 30, kind: "ring" });
        this.shake = Math.max(this.shake, 10);
      } else if (e.k === "clash" && e.v === 1) {
        // 착지 충격파: 옆으로 퍼지는 바람
        for (let i = 0; i < 14; i++) {
          const d = i % 2 ? 1 : -1;
          this.parts.push({
            x, y: y - 2 - Math.random() * 6, vx: d * (2 + Math.random() * 3), vy: -Math.random() * 0.6,
            life: 16, max: 16, color: "rgba(230,240,255,0.9)", size: 1.4, kind: "streak",
          });
        }
        this.parts.push({ x, y: y - 4, vx: 0, vy: 0, life: 12, max: 12, color: "#DDEBFF", size: 18, kind: "ring" });
        this.shake = Math.max(this.shake, 5);
      } else if (e.k === "clash") {
        this.parts.push({ x, y, vx: 0, vy: 0, life: 14, max: 14, color: "#fff", size: 15, kind: "ring" });
        this.shake = Math.max(this.shake, 3);
      } else if (e.k === "super") {
        this.flash = 10;
        this.flashColor = CHARS[s.p[e.p].ch].color;
      } else if (e.k === "ko") {
        this.flash = 9;
        this.flashColor = "#fff";
        this.shake = 8;
      } else if (e.k === "dash") {
        // 대시 바람 자국
        const f = s.p[e.p];
        for (let i = 0; i < 6; i++)
          this.parts.push({
            x: x - f.face * (4 + i * 5), y: y - 8 - Math.random() * 40, vx: -f.face * (1.5 + Math.random()), vy: 0,
            life: 12, max: 12, color: "rgba(255,255,255,0.85)", size: 1.2, kind: "streak",
          });
      } else if (e.k === "jump" || e.k === "land") {
        for (let i = 0; i < 4; i++)
          this.parts.push({
            x: x + (Math.random() - 0.5) * 10, y, vx: (Math.random() - 0.5) * 1.2, vy: -0.3,
            life: 14, max: 14, color: "rgba(230,220,210,0.8)", size: 1.5, kind: "dust",
          });
      }
    }
  }

  /** 연출 한 프레임 진행 (시뮬레이션이 진행됐을 때만) */
  tick(s: State) {
    this.cur = s;
    if (this.flash > 0) this.flash--;
    if (this.bsod > 0) this.bsod--;
    if (s.stop > 0 || s.freeze > 0) {
      this.shake *= 0.85;
      return;
    }
    for (const p of this.parts) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.kind === "spark" || p.kind === "shard" || p.kind === "bolt") {
        p.vx *= 0.88;
        p.vy = p.vy * 0.88 + 0.08;
      } else if (p.kind === "flame") {
        p.vx *= 0.9;
        p.vy = p.vy * 0.9 - 0.06;
      }
      p.life--;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const e of this.fx) e.t++;
    this.fx = this.fx.filter((e) => e.t < e.dur);
    this.shake *= 0.8;
  }

  /** 이름표: 머리 위 1P(파랑)·2P/CPU(빨강) 표시 — 둘이 겹쳐도 내 캐릭터를 알 수 있게 */
  tags: [string, string] = ["1P", "2P"];
  /** 차지 게이지(이반 철곰권)를 보여 줄 자리 — 직접 조작하는 사람에게만 (상대 · 관전자에겐 안 보임) */
  gauge: [boolean, boolean] = [false, false];
  private tagF = 0;
  private drawTag(f: Fighter, i: number) {
    if (f.st === "ko" || f.h / SUB > VIEW_H) return;
    const g = this.g;
    const sh = this.sheets[i];
    const top = sh ? (frameRect(sh, sh.anims[sh.states.idle.anim], 0).ay / (sh.scale ?? 1)) * 0.95 : 62;
    const x = f.x / SUB,
      y = screenY(f.h) - Math.min(top, 74) - 10;
    const col = i === 0 ? "#3B82F6" : "#F43F5E";
    const label = this.tags[i];
    g.save();
    g.font = "bold 9px ui-monospace, monospace";
    const tw = g.measureText(label).width + 6;
    g.globalAlpha = 0.92;
    g.fillStyle = col;
    g.fillRect(x - tw / 2, y - 11, tw, 10);
    g.beginPath();
    g.moveTo(x - 4, y - 1);
    g.lineTo(x + 4, y - 1);
    g.lineTo(x, y + 4);
    g.fill();
    g.fillStyle = "#fff";
    g.textAlign = "center";
    g.fillText(label, x, y - 3);
    // 차지 게이지: 이름표 오른쪽 세로 막대 (다 모으면 번쩍)
    const cm = CHARS[f.ch].moves.S.charge;
    if (this.gauge[i] && cm && f.st === "atk" && f.mv === "S" && !f.aerial && f.chg > 0 && f.t <= cm.at + 1) {
      const k = Math.min(1, f.chg / cm.max);
      const full = k >= 1;
      const gx = x + tw / 2 + 3,
        gh = 22,
        gy = y + 4 - gh;
      g.globalAlpha = 1;
      g.fillStyle = "rgba(0,0,0,0.6)";
      g.fillRect(gx - 1, gy - 1, 6, gh + 2);
      g.fillStyle = full ? (Math.floor(this.tagF / 3) % 2 ? "#FFFFFF" : "#FFD34D") : k > 0.66 ? "#FF6B3D" : "#FF4D4D";
      g.fillRect(gx, gy + gh * (1 - k), 4, gh * k);
      // 1/3 · 2/3 눈금
      g.fillStyle = "rgba(255,255,255,0.45)";
      g.fillRect(gx, gy + gh / 3, 4, 0.8);
      g.fillRect(gx, gy + (gh * 2) / 3, 4, 0.8);
      if (full) {
        g.fillStyle = "#FFD34D";
        g.font = "bold 8px ui-monospace, monospace";
        g.textAlign = "left";
        g.fillText("MAX", gx + 7, gy + 7);
        g.textAlign = "center";
      }
      g.font = "bold 9px ui-monospace, monospace";
    }
    if (f.shock > 0) {
      // 감전 표시 (남은 시간만큼 줄어드는 노란 막대)
      g.globalAlpha = 1;
      g.fillStyle = "#FFE45C";
      g.font = "bold 8px ui-monospace, monospace";
      g.fillText("⚡감전", x, y - 14);
      g.fillRect(x - 12, y - 12, Math.min(24, (24 * f.shock) / 180), 1.5);
    }
    if (f.burn > 0) {
      // 화상 표시 (감전 표시가 있으면 그 위)
      const by = y - (f.shock > 0 ? 24 : 14);
      g.globalAlpha = 1;
      g.fillStyle = "#FF8A3D";
      g.font = "bold 8px ui-monospace, monospace";
      g.fillText(f.burnN > 1 ? `🔥화상×${f.burnN}` : "🔥화상", x, by);
      g.fillRect(x - 12, by + 2, Math.min(24, (24 * f.burn) / 300), 1.5);
    }
    if (f.zap > 0) {
      // 일섬 낙인: 터질 때까지 줄어드는 보라 막대 (위쪽에)
      const zy = y - 14 - (f.shock > 0 ? 10 : 0) - (f.burn > 0 ? 10 : 0);
      g.globalAlpha = 0.75 + 0.25 * Math.sin(this.tagF * 0.6);
      g.fillStyle = "#D8B4FE";
      g.font = "bold 8px ui-monospace, monospace";
      g.fillText("⚡낙인", x, zy);
      g.fillRect(x - 12, zy + 2, Math.min(24, (24 * f.zap) / 120), 1.5);
      g.globalAlpha = 1;
    }
    g.restore();
  }

  /** 필살기 게이지가 꽉 차면 몸 주위에 빛 */
  private drawMaxAura(f: Fighter, s: State) {
    if (f.meter < 100 || f.st === "ko" || f.h / SUB > VIEW_H) return;
    const g = this.g;
    const x = f.x / SUB,
      y = screenY(f.h);
    const c = CHARS[f.ch].color;
    const p = 0.55 + 0.45 * Math.sin(s.f * 0.18);
    glowAt(g, x, y - 32, 46 + p * 10, c === "#E6ECF5" ? "rgba(140,200,255,0.32)" : "rgba(255,110,40,0.32)");
    g.save();
    g.globalCompositeOperation = "lighter";
    for (let k = 0; k < 3; k++) {
      const a = s.f * 0.09 + k * 2.1;
      g.fillStyle = `rgba(255,255,255,${0.5 * p})`;
      g.fillRect(x + Math.cos(a) * 18 - 1, y - 8 - ((s.f * 1.3 + k * 23) % 64), 2, 2);
    }
    g.restore();
  }

  /** 카이 필살기 동안 몸을 감싸고 도는 회오리 */
  private drawWindAura(f: Fighter, s: State) {
    if (f.st !== "atk" || f.mv !== "X" || CHARS[f.ch].id !== "kai") return;
    const m = CHARS[f.ch].moves.X;
    if (f.t < m.startup - 2 || f.t > m.startup + m.active + 4) return;
    const g = this.g;
    const x = f.x / SUB,
      y = screenY(f.h);
    const spin = s.f * 0.45;
    g.save();
    g.globalCompositeOperation = "lighter";
    for (let k = 0; k < 5; k++) {
      const yy = y - 8 - k * 15;
      const rx = 30 + k * 3,
        ry = 7 + k;
      g.strokeStyle = `rgba(220,235,255,${0.55 - k * 0.07})`;
      g.lineWidth = 2.2;
      g.beginPath();
      g.ellipse(x, yy, rx, ry, 0, spin + k, spin + k + Math.PI * 1.3);
      g.stroke();
      g.strokeStyle = "rgba(160,190,230,0.35)";
      g.lineWidth = 1.2;
      g.beginPath();
      g.ellipse(x, yy, rx * 0.8, ry * 0.8, 0, -spin + k * 2, -spin + k * 2 + Math.PI);
      g.stroke();
    }
    g.restore();
  }

  private drawFighter(f: Fighter, i: number, s: State) {
    const g = this.g;
    const sh = this.sheets[i];
    const map = MAPS[s.map] ?? MAPS[0];
    const x = f.x / SUB;
    const below = platBelow(map, f.x, f.h);
    const y = screenY(f.h);
    if (below) {
      // 그림자 (아래 발판 위에)
      const lift = Math.max(0, (f.h - below.y * SUB) / SUB);
      if (lift < 260) {
        g.fillStyle = `rgba(0,0,0,${0.35 - Math.min(0.25, lift / 900)})`;
        g.beginPath();
        g.ellipse(x, screenY(below.y * SUB), Math.max(5, 13 - lift / 25), 2.6, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    if (f.h / SUB > VIEW_H) {
      // 화면 위에서 내려오는 중: 위치 표시
      g.fillStyle = CHARS[f.ch].color;
      g.beginPath();
      g.moveTo(x, 14);
      g.lineTo(x - 7, 4);
      g.lineTo(x + 7, 4);
      g.fill();
      return;
    }
    if (!sh) {
      g.fillStyle = CHARS[f.ch].color;
      g.fillRect(x - 8, y - 60, 16, 60);
      return;
    }
    let { anim, frame } = pickFrame(sh, f, s);
    // 착지·대시 멈춤·급강하 착지 그림 (상태가 막 바뀐 직후 잠깐)
    const mo0 = this.motion[i];
    if (mo0.after && sh.anims[mo0.after.name]) {
      const a = sh.anims[mo0.after.name];
      anim = a;
      frame = Math.min(a.frames - 1, Math.floor((mo0.after.t * a.frames) / mo0.after.dur));
    }
    const fr = frameRect(sh, anim, frame);
    const sc = sh.scale ?? 1;
    const flashHit = (f.st === "hit" && f.t < 2) || (s.stop > 0 && f.st === "hit");
    let src: CanvasImageSource = sh.img;
    let ssx = fr.sx,
      ssy = fr.sy;
    if (flashHit) {
      if (!this.tmp) this.tmp = document.createElement("canvas");
      const t = this.tmp;
      t.width = fr.sw;
      t.height = fr.sh;
      const tg = t.getContext("2d")!;
      tg.clearRect(0, 0, fr.sw, fr.sh);
      tg.drawImage(sh.img, fr.sx, fr.sy, fr.sw, fr.sh, 0, 0, fr.sw, fr.sh);
      tg.globalCompositeOperation = "source-atop";
      tg.fillStyle = "rgba(255,255,255,0.7)";
      tg.fillRect(0, 0, fr.sw, fr.sh);
      tg.globalCompositeOperation = "source-over";
      src = t;
      ssx = 0;
      ssy = 0;
    }
    // 감전 중: 몸 주위로 번개가 튐
    if (f.shock > 0 && s.f % 5 === 0) {
      const hh = (fr.sh / sc) * 0.9;
      for (let k = 0; k < 2; k++)
        this.parts.push({
          x: x + (Math.random() - 0.5) * 24, y: y - Math.random() * hh, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3,
          life: 8, max: 8, color: Math.random() < 0.5 ? "#FFFFFF" : "#FFE45C", size: 1, kind: "bolt",
        });
    }
    // 화상 중: 몸에서 불씨가 피어오름
    if (f.burn > 0 && s.f % 4 === 0) {
      const hh = (fr.sh / sc) * 0.8;
      this.parts.push({
        x: x + (Math.random() - 0.5) * 18, y: y - Math.random() * hh, vx: (Math.random() - 0.5) * 0.6, vy: -0.8 - Math.random(),
        life: 14, max: 14, color: Math.random() < 0.5 ? "#FFB347" : "#FF5A1F", size: 1.2, kind: "spark",
      });
    }
    // 잡기: 손을 뻗는 동안 손끝에 보라색 손아귀 — 원이 오므라들며 잡는 순간까지 (10.13: 모션만으론 잡기인지 알아보기 힘들어서)
    // (10.13 조금 더 눈에 띄게: 원 두 겹 · 굵게 · 손에 보라 빛 · 모이는 불티)
    if (f.st === "atk" && f.mv === "T" && !f.hit && f.t <= (f.lg ? 14 : 8)) {
      const k = Math.min(1, f.t / (f.lg ? 14 : 8));
      const hx = x + f.face * (26 + k * 10),
        hy = y - 44;
      g.save();
      g.globalCompositeOperation = "lighter";
      const glow = g.createRadialGradient(hx, hy, 0, hx, hy, 26);
      glow.addColorStop(0, `rgba(216,180,254,${0.45 + 0.35 * k})`);
      glow.addColorStop(1, "rgba(168,85,247,0)");
      g.fillStyle = glow;
      g.beginPath();
      g.arc(hx, hy, 26, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = `rgba(216,180,254,${0.7 + 0.3 * k})`;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(hx, hy, 24 - k * 13, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = `rgba(168,85,247,${0.5 + 0.4 * k})`;
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(hx, hy, 32 - k * 14, 0, Math.PI * 2);
      g.stroke();
      // 손톱 세 줄이 가운데로 모임
      g.strokeStyle = "rgba(245,235,255,0.95)";
      g.lineWidth = 2.2;
      for (let n = -1; n <= 1; n++) {
        const an = (f.face > 0 ? Math.PI : 0) + n * 0.55;
        const r0 = 30 - k * 14;
        g.beginPath();
        g.moveTo(hx + Math.cos(an) * r0, hy + Math.sin(an) * r0);
        g.lineTo(hx + Math.cos(an) * (r0 - 9), hy + Math.sin(an) * (r0 - 9));
        g.stroke();
      }
      g.restore();
      if (s.f % 2 === 0) {
        const an = Math.random() * Math.PI * 2;
        this.parts.push({
          x: hx + Math.cos(an) * 26, y: hy + Math.sin(an) * 26, vx: -Math.cos(an) * 2.2, vy: -Math.sin(an) * 2.2,
          life: 8, max: 8, color: Math.random() < 0.5 ? "#F5EBFF" : "#C084FC", size: 1.2, kind: "spark",
        });
      }
    }
    // 움직임 연출 (발 기준 늘이기·기울이기·밀기, 잔상)
    const mo = this.motion[i];
    mo.update(f, s, `${anim.list?.[frame] ?? anim.row * 100 + frame}`, fr, x, y);
    for (const sp of mo.spawn.splice(0))
      this.spawnFx(f, sp.name, x + sp.dx * f.face, y + sp.dy, f.face, sp.name === "burst" ? 26 : 18, true);
    // 돌진 아이덴티티: 주먹 앞에 바람 덩어리
    const cm = f.st === "atk" && f.mv ? CHARS[f.ch].moves[f.mv as keyof typeof CHARS[number]["moves"]] : null;
    if (cm && f.mv === "S" && cm.rush && !isAirF(s, f) && f.t >= cm.startup - 2 && f.t < cm.startup + cm.active + 2) {
      const d = FX_SETS[CHARS[f.ch].id]?.rush;
      const im = d && fxImg(`${CHARS[f.ch].id}-rush-${Math.min(3, Math.floor((f.t - cm.startup + 2) / 3))}`);
      if (im && d) {
        const w = (im.width / 1.72) * d[1],
          h = (im.height / 1.72) * d[1];
        g.save();
        g.globalCompositeOperation = "lighter";
        g.translate(x + f.face * 30, y - 30);
        if (f.face < 0) g.scale(-1, 1);
        g.drawImage(im, -w * 0.55, -h / 2, w, h);
        g.restore();
      }
    }
    // 제나 공중 L 뇌격돌: 몸 뒤로 번개 꼬리 + 창끝·몸 둘레에 찌릿 (돌진하는 동안)
    if (CHARS[f.ch].id === "zena" && f.st === "atk" && f.mv === "S" && f.aerial && cm?.air) {
      const am = { ...cm, ...cm.air };
      const t0 = f.t - am.startup;
      if (t0 >= -3 && t0 < am.active + 4) {
        const on = t0 >= 0 && t0 < am.active;
        const im = fxImg("zena-flash-0");
        if (im && t0 >= 0) {
          const fade = on ? 1 : Math.max(0, 1 - (t0 - am.active) / 4);
          const w = 120 * (on ? Math.min(1, (t0 + 2) / 4) : 1),
            h = 30;
          g.save();
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = (0.55 + 0.25 * Math.random()) * fade;
          g.translate(x + f.face * 6, y - 40);
          if (f.face < 0) g.scale(-1, 1);
          g.drawImage(im, -w, -h / 2, w, h);
          g.restore();
        }
        if (s.f % 2 === 0)
          for (let k = 0; k < (on ? 3 : 1); k++) {
            const tip = Math.random() < 0.5;
            this.parts.push({
              x: x + f.face * (tip ? 40 + Math.random() * 20 : (Math.random() - 0.5) * 36), y: y - 40 + (Math.random() - 0.5) * (tip ? 16 : 40),
              vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3, life: 8, max: 8,
              color: Math.random() < 0.4 ? "#FFFFFF" : "#FFE45C", size: 0.9 + Math.random() * 0.5, kind: "bolt",
            });
          }
      }
    }
    // 이반 곰 포옹: 덮칠 때 손끝에 붉은 휘두름, 안고 떨어질 때 붉은 기 + 위로 속도선
    if (CHARS[f.ch].id === "ivan" && f.st === "atk" && f.mv === "S" && f.aerial && cm?.air?.hug) {
      const am = cm.air;
      if (f.hug) {
        const im = fxImg(`ivan-aura-${2 + (Math.floor(s.f / 3) % 2)}`);
        if (im) {
          const w = (im.width / 1.72) * 1.2,
            h = (im.height / 1.72) * 1.2;
          g.save();
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = 0.8;
          g.translate(x + f.face * 10, y - 34);
          if (f.face < 0) g.scale(-1, 1);
          g.drawImage(im, -w / 2, -h / 2, w, h);
          g.restore();
        }
        for (let k = 0; k < 3; k++)
          this.parts.push({
            x: x + f.face * 10 + (Math.random() - 0.5) * 60, y: y - 65 - Math.random() * 35, vx: 0, vy: -1.8, life: 8, max: 8,
            color: Math.random() < 0.5 ? "rgba(255,255,255,0.8)" : "#FF6B6B", size: 1 + Math.random(), kind: "vstreak",
          });
      } else if (isAirF(s, f) && f.t < (am.startup ?? 0)) {
        // 덮치기 직전: 손에 붉은 기가 모임 (곰 포옹 예고)
        const hx = x + f.face * 26,
          hy = y - 44;
        const an = Math.random() * Math.PI * 2;
        this.parts.push({
          x: hx + Math.cos(an) * 26, y: hy + Math.sin(an) * 20, vx: -Math.cos(an) * 2.4, vy: -Math.sin(an) * 2,
          life: 9, max: 9, color: Math.random() < 0.5 ? "#FFD0C0" : "#FF4D4D", size: 1.3, kind: "spark",
        });
        if (f.t === 1) this.parts.push({ x: hx, y: hy, vx: 0, vy: 0, life: 12, max: 12, color: "#FF6B5A", size: 20, kind: "ring" });
      } else if (isAirF(s, f) && f.t === am.startup) {
        this.spawnFx(f, "wave", x + f.face * 40, y - 40, f.face, 14, false, { size: [120, 78], from: 1, alpha: 1 });
        this.parts.push({ x: x + f.face * 44, y: y - 40, vx: 0, vy: 0, life: 12, max: 12, color: "#FF4D4D", size: 30, kind: "ring" });
        for (let k = 0; k < 12; k++)
          this.parts.push({
            x: x + f.face * 30, y: y - 40 + (Math.random() - 0.5) * 30, vx: f.face * (2 + Math.random() * 2), vy: (Math.random() - 0.5) * 0.6,
            life: 10, max: 10, color: k % 2 ? "#FFD0C0" : "#FF4D4D", size: 1.4, kind: "streak",
          });
      }
    }
    // 이반 철곰권 기 모으기: 몸 둘레로 붉은 기가 소용돌이 (모을수록 커지고, 다 모으면 번쩍임)
    if (CHARS[f.ch].id === "ivan" && cm?.charge && f.mv === "S" && !f.aerial && f.chg > 0 && f.t <= cm.charge.at + 1) {
      const full = f.chg >= cm.charge.max;
      const k = full ? 2 + (Math.floor(s.f / 3) % 2) : Math.min(2, Math.floor((f.chg * 3) / cm.charge.max));
      const im = fxImg(`ivan-aura-${k}`);
      if (im) {
        const z = 0.75 + (0.35 * Math.min(f.chg, cm.charge.max)) / cm.charge.max;
        const w = (im.width / 1.72) * 0.95 * z,
          h = (im.height / 1.72) * 0.95 * z;
        g.save();
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = 0.65 + 0.35 * Math.sin(s.f * 0.5) ** 2;
        g.translate(x, y - 36);
        if (f.face < 0) g.scale(-1, 1);
        g.drawImage(im, -w / 2, -h / 2, w, h);
        g.restore();
      }
      if (s.f % 3 === 0)
        this.parts.push({
          x: x + (Math.random() - 0.5) * 40, y: y - Math.random() * 10, vx: (Math.random() - 0.5) * 0.6, vy: -1 - Math.random() * 1.5,
          life: 14, max: 14, color: Math.random() < 0.5 ? "#FF4D4D" : "#FFD0C0", size: 1.2, kind: "spark",
        });
    }
    g.save();
    // 다시 내려온 직후 무적: 깜빡이지 않고 살짝만 투명하게
    const baseA = f.inv > 0 ? 0.75 : 1;
    g.imageSmoothingEnabled = !sh.pixel;
    g.imageSmoothingQuality = "high";
    if (sh.layDown && (f.st === "down" || f.st === "rise" || (f.st === "ko" && !isAirF(s, f)))) {
      // 쓰러짐 그림이 없으면 눕혀서 (일어날 땐 다시 세움)
      const flip = sh.facing === "left" ? f.face > 0 : f.face < 0;
      const k = f.st === "rise" ? 1 - f.t / 14 : Math.min(1, f.t / 6);
      g.translate(x, y);
      g.rotate((flip ? 1 : -1) * (Math.PI / 2) * k);
      g.translate(-x, -y);
    }
    const mirror = sh.facing === "left" ? -1 : 1;
    // 대시·돌진 잔상 (오래된 것부터, 점점 옅게)
    for (const gh of mo.ghosts) {
      g.globalAlpha = baseA * gh.a;
      this.blit(sh.img, gh.rect.sx, gh.rect.sy, gh.rect, sc, gh.x, gh.y, gh.pose, mirror);
    }
    // 그림이 바뀐 직후: 직전 그림을 옅게 겹침 (움직임 번짐)
    if (mo.smear > 0 && mo.smearRect) {
      g.globalAlpha = baseA * 0.28 * (mo.smear / 3);
      this.blit(sh.img, mo.smearRect.sx, mo.smearRect.sy, mo.smearRect, sc, x, y, mo.pose, mirror);
    }
    g.globalAlpha = baseA;
    this.blit(src, ssx, ssy, fr, sc, x, y, mo.pose, mirror);
    g.restore();
    if (f.trapT > 0) {
      // 비눗방울에 갇힘: 몸을 감싸는 투명한 방울 (살짝 출렁)
      const hh = Math.min(70, (frameRect(sh, sh.anims[sh.states.idle.anim], 0).ay / sc) * 0.95);
      const cy = y - hh / 2,
        rr = hh * 0.62 + Math.sin(s.f * 0.15) * 1.5;
      g.save();
      const grd = g.createRadialGradient(x - rr * 0.3, cy - rr * 0.35, rr * 0.1, x, cy, rr);
      grd.addColorStop(0, "rgba(255,255,255,0.35)");
      grd.addColorStop(0.6, "rgba(150,220,255,0.12)");
      grd.addColorStop(0.92, "rgba(120,200,255,0.35)");
      grd.addColorStop(1, "rgba(200,240,255,0.7)");
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(x, cy, rr, rr * 1.05, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(220,245,255,0.8)";
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = "rgba(255,255,255,0.85)";
      g.beginPath();
      g.ellipse(x - rr * 0.38, cy - rr * 0.45, rr * 0.16, rr * 0.08, -0.6, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    if (CHARS[f.ch].id === "gunmo" && f.st === "atk" && f.mv === "S" && cm) {
      // Ctrl+A 선택 박스 / Alt+Tab 창: 판정 크기에 맞춰 펼침 (준비 끝 ~ 판정 끝 + 잠깐)
      const lt = f.t - cm.startup + 2;
      const dur = cm.active + 8;
      if (lt >= 0 && lt < dur) {
        const name = f.aerial ? "win" : "box";
        const k = lt < 2 ? 0 : lt < cm.active + 2 ? 1 + (lt % 2) : 3;
        // 스킨(학창시절 칠판)은 빛이 아니라 반투명 판이라 그냥 겹쳐 그림
        const lk = this.lookOf(f);
        const board = lk !== "gunmo" && !!FX_SETS[lk]?.[name];
        const im = fxImg(`${board ? lk : "gunmo"}-${name}-${k}`);
        if (im) {
          const b = cm.box;
          const w = b.w * 1.08,
            h = b.h * 1.08;
          g.save();
          if (!board) g.globalCompositeOperation = "lighter";
          g.globalAlpha = (lt >= cm.active + 2 ? 0.6 : 0.9) * (board ? 0.82 : 1);
          g.translate(x + f.face * (b.x + b.w / 2), y - (b.y - b.h / 2));
          if (f.face < 0) g.scale(-1, 1);
          g.drawImage(im, -w / 2, -h / 2, w, h);
          g.restore();
        }
      }
    }
    // Alt+F4로 멈춘 상대: 몸에 파란 글리치 줄 + 머리 위 (응답 없음)
    if (f.frz > 0 && f.st === "hit") {
      const hh = (fr.sh / sc) * 0.9;
      g.save();
      g.globalAlpha = 0.55;
      for (let k = 0; k < 4; k++) {
        const gy = y - ((s.f * 3 + k * 23) % Math.max(1, Math.round(hh)));
        g.fillStyle = k % 2 ? "#2B7BFF" : "#9CC8FF";
        g.fillRect(x - 18 + ((s.f * 7 + k * 13) % 9) - 4, gy, 36, 2);
      }
      g.globalAlpha = 1;
      g.font = "bold 9px 'Nanum Gothic', sans-serif";
      g.textAlign = "center";
      g.lineWidth = 2;
      g.strokeStyle = "rgba(0,0,0,0.85)";
      g.strokeText("(응답 없음)", x, y - 100);
      g.fillStyle = "#CFE3FF";
      g.fillText("(응답 없음)", x, y - 100);
      g.restore();
    }
    if (f.mark && f.st === "hit") {
      // 머리 위: ⏸ 일시정지 / 💫 혼란 로딩 원
      const im = fxImg(f.mark === 1 ? `gunmo-pause-${Math.floor(s.f / 10) % 2}` : `gunmo-confuse-${Math.floor(s.f / 6) % 2}`);
      if (im) {
        const hgt = 22;
        const wid = (hgt * im.width) / im.height;
        g.save();
        g.globalCompositeOperation = "lighter";
        g.drawImage(im, x - wid / 2, y - 84 - hgt / 2 + Math.sin(s.f * 0.2) * 1.5, wid, hgt);
        g.restore();
      }
    }
  }

  /** 한 프레임 그리기: 발(x, y)을 기준으로 연출 변형을 걸어서 */
  private blit(
    src: CanvasImageSource,
    ssx: number,
    ssy: number,
    fr: FrameRect,
    sc: number,
    x: number,
    y: number,
    p: Pose,
    mirror: number
  ) {
    const g = this.g;
    // 돌아서는 중간에도 너무 얇아지지 않게
    const fv = Math.sign(p.faceVis || 1) * Math.max(0.22, Math.abs(p.faceVis));
    g.save();
    g.translate(x + p.dx, y + p.dy);
    if (p.rot) g.rotate(p.rot);
    g.scale(fv * mirror * p.sx, p.sy);
    g.drawImage(src, ssx, ssy, fr.sw, fr.sh, -fr.ax / sc, -fr.ay / sc, fr.sw / sc, fr.sh / sc);
    g.restore();
  }

  /** 필살기 불기둥: 솟기 전엔 바닥에 경고 불씨, 솟으면 시트의 불기둥 그림을 크게 */
  /** 이그나 업화주가 남긴 불 장판: fx/igna-floor-* 그림 (못 불러왔으면 잔불 띠 + 일렁이는 불꽃 혀를 직접 그림) */
  private drawFloorFire(p: Proj, s: State) {
    const g = this.g;
    const fl = CHARS[s.p[p.o].ch].moves.X.summon!.floor!;
    const x = p.x / SUB;
    const y = screenY(p.h);
    const w = fl.w;
    // 나타날 때·꺼질 때 서서히
    const a = Math.min(1, p.t / 6, p.life / 20);
    const fb = FLOOR_FX[this.lookOf(s.p[p.o])] ?? FLOOR_FX[CHARS[s.p[p.o].ch].id];
    if (fb) {
      // 그림: 처음 8프레임 나타나기 → 일렁임 반복(6프레임마다) → 마지막 12프레임 꺼지기
      const name =
        p.t < 8 ? `${fb}-in-${p.t < 4 ? 0 : 1}` : p.life < 12 ? `${fb}-out-${p.life >= 6 ? 0 : 1}` : `${fb}-${Math.floor(p.t / 6) % 4}`;
      const im = fxImg(name);
      if (im) {
        // 그림 속 장판 띠가 가로 3.5%~97% · 바닥선이 위에서 94.8% → 띠가 판정 너비보다 조금 넓게, 바닥선을 발판에
        const dw = (w * 1.12) / 0.935;
        const dh = (dw * im.height) / im.width;
        g.save();
        g.globalAlpha = Math.min(1, p.t / 3, p.life / 6);
        g.drawImage(im, x - dw / 2, y - dh * 0.948 + 2, dw, dh);
        g.restore();
        return;
      }
    }
    g.save();
    g.globalCompositeOperation = "lighter";
    // 바닥 잔불 띠
    const gr = g.createRadialGradient(x, y, 2, x, y, w / 2);
    gr.addColorStop(0, `rgba(255,170,60,${0.55 * a})`);
    gr.addColorStop(0.6, `rgba(255,80,20,${0.35 * a})`);
    gr.addColorStop(1, "rgba(255,40,0,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(x, y, w / 2, 7, 0, 0, Math.PI * 2);
    g.fill();
    // 불꽃 혀: 자리마다 다른 위상으로 일렁임 (결정적인 값만 써서 다시 그려도 같음)
    const n = 9;
    for (let k = 0; k < n; k++) {
      const fx = x - w / 2 + (w * (k + 0.5)) / n;
      const ph = s.f * 0.35 + k * 1.7;
      const h = (10 + 9 * Math.abs(Math.sin(ph)) + 5 * Math.sin(ph * 2.3 + k)) * a;
      const fw = 5 + 2 * Math.sin(ph * 1.3);
      const lg = g.createLinearGradient(fx, y, fx, y - h);
      lg.addColorStop(0, `rgba(255,120,30,${0.85 * a})`);
      lg.addColorStop(0.5, `rgba(255,190,70,${0.6 * a})`);
      lg.addColorStop(1, "rgba(255,240,180,0)");
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(fx - fw, y);
      g.quadraticCurveTo(fx - fw * 0.6, y - h * 0.55, fx + Math.sin(ph) * 2, y - h);
      g.quadraticCurveTo(fx + fw * 0.6, y - h * 0.55, fx + fw, y);
      g.closePath();
      g.fill();
    }
    // 튀는 불티
    for (let k = 0; k < 4; k++) {
      const life = (s.f + k * 11) % 26;
      const sx = x + (((k * 37 + Math.floor((s.f + k * 11) / 26) * 53) % w) - w / 2);
      g.fillStyle = `rgba(255,210,120,${(1 - life / 26) * a})`;
      g.fillRect(sx, y - 4 - life * 1.3, 2, 2);
    }
    g.restore();
  }

  private drawPillar(p: Proj, s: State) {
    const g = this.g;
    const sm = CHARS[s.p[p.o].ch].moves.X.summon!;
    const x = p.x / SUB;
    const y = screenY(p.h);
    if (CHARS[s.p[p.o].ch].id === "gunmo") {
      this.drawDeploy(p, sm, x, y);
      return;
    }
    if (p.t < sm.delay) {
      const k = p.t / sm.delay;
      g.save();
      g.globalCompositeOperation = "lighter";
      g.fillStyle = `rgba(255,${120 + Math.round(80 * k)},40,${0.25 + 0.5 * k * (0.7 + 0.3 * Math.sin(p.t))})`;
      g.beginPath();
      g.ellipse(x, y, (sm.w / 2) * (0.5 + k * 0.6), 4 + 3 * k, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
      return;
    }
    const sh = this.sheets[p.o];
    const a = sh?.anims.pillar;
    const fade = Math.min(1, (sm.delay + sm.life - p.t) / 8);
    const pa = PILLAR_ANIM[this.lookOf(s.p[p.o])] ?? PILLAR_ANIM[CHARS[s.p[p.o].ch].id];
    // 솟음 → 최대(반복) → 사그라짐
    const life = p.t - sm.delay;
    const pk = !pa ? 0 : life < 4 ? 0 : life < 8 ? 1 : sm.delay + sm.life - p.t < 8 ? pa[1] - 1 : 1 + (Math.floor(life / 4) % 2);
    const pim = pa ? fxImg(`${pa[0]}-${Math.min(pa[1] - 1, pk)}`) : null;
    g.save();
    g.globalAlpha = fade;
    if (pim) {
      const k = (sm.h * 1.1) / pim.height;
      g.globalCompositeOperation = "lighter";
      g.drawImage(pim, x - (pim.width * k) / 2, y - pim.height * k + 4, pim.width * k, pim.height * k);
    } else if (sh && a) {
      const k0 = Math.floor(((p.t - sm.delay) * a.fps) / 60) % a.frames;
      const fr = frameRect(sh, a, k0);
      // 기둥 높이에 맞춰 크게
      const k = sm.h / (fr.sh * 0.9);
      g.imageSmoothingEnabled = !sh.pixel;
      g.drawImage(sh.img, fr.sx, fr.sy, fr.sw, fr.sh, x - fr.ax * k, y - fr.ay * k, fr.sw * k, fr.sh * k);
    }
    g.restore();
    glowAt(g, x, y - sm.h / 2, sm.h * 0.6, "rgba(255,120,40,0.25)");
  }

  /** 건모 필살기 「금요일 배포」: 넓은 범위에 에러 블록이 타마다 하나씩 떨어져 깨짐 */
  private drawDeploy(p: Proj, sm: { w: number; h: number; delay: number; life: number; every: number }, x: number, y: number) {
    const g = this.g;
    g.save();
    g.globalCompositeOperation = "lighter";
    if (p.t < sm.delay) {
      // 떨어지기 전: 바닥에 붉은 경고 띠
      const k = p.t / sm.delay;
      g.fillStyle = `rgba(255,70,80,${0.15 + 0.35 * k * (0.7 + 0.3 * Math.sin(p.t * 0.8))})`;
      g.fillRect(x - sm.w / 2, y - 3, sm.w, 4);
      g.restore();
      return;
    }
    const at = p.t - sm.delay;
    const OFF = [-0.3, 0.28, -0.05, 0.38, -0.22];
    for (let j = 0; j * sm.every < sm.life; j++) {
      const lt = at - j * sm.every + 6; // 맞는 타 6프레임 전부터 떨어지기 시작
      if (lt < 0 || lt >= 22) continue;
      const bx = x + OFF[j % OFF.length] * sm.w;
      const k = lt < 6 ? 0 : lt < 10 ? 1 : lt < 15 ? 2 : 3;
      const im = fxImg(`gunmo-err-${k}`);
      if (!im) continue;
      const wid = sm.w * 0.62;
      const hgt = (wid * im.height) / im.width;
      const fall = lt < 6 ? (1 - lt / 6) * sm.h * 0.8 : 0;
      g.globalAlpha = lt >= 15 ? Math.max(0, 1 - (lt - 15) / 7) : 1;
      g.drawImage(im, bx - wid / 2, y - hgt - fall + 4, wid, hgt);
    }
    g.restore();
  }

  private drawProj(s: State) {
    const g = this.g;
    for (const p of s.proj) {
      if (p.k === 2) {
        this.drawFloorFire(p, s);
        continue;
      }
      if (p.k === 1) {
        this.drawPillar(p, s);
        continue;
      }
      const ch = CHARS[s.p[p.o].ch];
      const el = ELEMENT[ch.id] ?? "fire";
      const r = projRect(p, s);
      const cx = (r.l + r.r) / 2 / SUB;
      const cy = screenY(p.h);
      const w = (r.r - r.l) / SUB;
      const dir = Math.sign(p.vx);
      const t = s.f;
      // 내리꽂는 탄은 날아가는 방향으로 기울임
      g.save();
      g.translate(cx, cy);
      g.rotate(Math.atan2(-p.vh, Math.abs(p.vx)) * dir);
      g.translate(-cx, -cy);
      const lk = this.lookOf(s.p[p.o]);
      const anim = (PROJ_ANIM[lk] ?? PROJ_ANIM[ch.id])?.[p.mv ? "X" : "S"];
      const aimg = anim ? fxImg(`${anim[0]}-${Math.floor(t / 4) % anim[1]}`) : null;
      const art = (PROJ_ART[lk] ?? PROJ_ART[ch.id])?.[p.mv ? "X" : "S"];
      const img = art ? fxImg(art[0]) : null;
      if (anim && aimg) {
        const hgt = ((r.hi - r.lo) / SUB) * anim[2];
        const wid = (hgt * aimg.width) / aimg.height;
        g.save();
        g.translate(cx, cy);
        g.scale(dir || 1, 1);
        g.globalCompositeOperation = "lighter";
        g.drawImage(aimg, -wid * anim[3], -hgt / 2, wid, hgt);
        g.restore();
      } else if (art && img) {
        // 그림 탄: 판정 높이에 맞춰 크기, 날아가는 쪽으로 뒤집음 (물방울은 살짝 출렁)
        const hgt = ((r.hi - r.lo) / SUB) * art[1];
        const wid = (hgt * img.width) / img.height;
        const bob = ch.id === "lily" && !p.mv ? Math.sin(t * 0.08) * 3 : 0;
        g.save();
        g.translate(cx, cy + bob);
        g.scale(dir || 1, 1);
        g.imageSmoothingEnabled = true;
        g.drawImage(img, -wid * art[2], -hgt / 2, wid, hgt);
        g.restore();
        const glowCol = el === "fire" ? "rgba(255,120,40,0.3)" : el === "bolt" ? "rgba(255,230,90,0.3)" : "rgba(90,190,255,0.22)";
        glowAt(g, cx, cy, w * 1.2, glowCol);
      } else if (el === "fire") {
        for (let k = 4; k >= 0; k--) {
          g.globalAlpha = 0.25 + (4 - k) * 0.15;
          g.fillStyle = k > 2 ? "#FF5A1F" : k > 0 ? "#FF9A3A" : "#FFE27A";
          g.beginPath();
          g.ellipse(cx - dir * k * 3.2, cy + Math.sin(t * 0.6 + k) * 0.8, w / 2 + 1 - k * 0.4, w / 2.4 - k * 0.3, 0, 0, Math.PI * 2);
          g.fill();
        }
      } else if (el === "bolt") {
        const grd = g.createRadialGradient(cx, cy, 0, cx, cy, w / 1.4);
        grd.addColorStop(0, "#FFFFFF");
        grd.addColorStop(0.4, "#FFF27A");
        grd.addColorStop(1, "rgba(255,228,92,0)");
        g.fillStyle = grd;
        g.beginPath();
        g.arc(cx, cy, w / 1.4, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = "#FFF6B0";
        g.lineWidth = 0.7;
        for (let k = 0; k < 4; k++) {
          const a = t * 0.9 + k * 1.6;
          g.beginPath();
          g.moveTo(cx, cy);
          g.lineTo(cx + Math.cos(a) * w * 0.5, cy + Math.sin(a) * w * 0.4);
          g.lineTo(cx + Math.cos(a + 0.4) * w * 0.85, cy + Math.sin(a + 0.4) * w * 0.7);
          g.stroke();
        }
        // 공 (야구공)
        g.fillStyle = "#FFFFFF";
        g.beginPath();
        g.arc(cx, cy, w / 4, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = "#E8344E";
        g.lineWidth = 0.4;
        g.beginPath();
        g.arc(cx - w / 8, cy, w / 6, -1, 1);
        g.stroke();
      } else if (el === "water" && p.mv === 1) {
        // 장마 파도: 바닥을 휩쓰는 큰 물결
        const hgt = (r.hi - r.lo) / SUB;
        g.save();
        g.translate(cx, cy + hgt / 2);
        g.scale(dir, 1);
        for (let k = 0; k < 3; k++) {
          g.globalAlpha = 0.35 + k * 0.2;
          g.fillStyle = k === 2 ? "#E8F8FF" : k === 1 ? "#7FD3FF" : "#2E8FE0";
          g.beginPath();
          g.moveTo(-w / 2 - k * 4, 0);
          g.quadraticCurveTo(-w / 4, -hgt * (0.6 - k * 0.12), w / 3 - k * 6, -hgt + k * 10 + Math.sin(t * 0.4) * 2);
          g.quadraticCurveTo(w / 2, -hgt * 0.4, w / 2 - k * 8, 0);
          g.closePath();
          g.fill();
        }
        g.restore();
        glowAt(g, cx, cy, w, "rgba(90,190,255,0.25)");
      } else if (el === "water") {
        // 비눗방울: 둥실 떠가는 투명한 방울
        const rr = w / 2 + Math.sin(t * 0.15) * 1.2;
        const by = cy + Math.sin(t * 0.08) * 3;
        const grd = g.createRadialGradient(cx - rr * 0.3, by - rr * 0.3, rr * 0.1, cx, by, rr);
        grd.addColorStop(0, "rgba(255,255,255,0.85)");
        grd.addColorStop(0.35, "rgba(170,225,255,0.35)");
        grd.addColorStop(0.9, "rgba(90,180,255,0.45)");
        grd.addColorStop(1, "rgba(220,245,255,0.9)");
        g.fillStyle = grd;
        g.beginPath();
        g.arc(cx, by, rr, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = "rgba(255,255,255,0.8)";
        g.lineWidth = 1;
        g.beginPath();
        g.arc(cx, by, rr, 3.6, 4.6);
        g.stroke();
      } else if (el === "wind") {
        // 초승달 바람 칼날
        g.save();
        g.translate(cx, cy);
        g.scale(dir, 1);
        const r = w / 2;
        for (let k = 3; k >= 0; k--) {
          g.globalAlpha = 0.18 + (3 - k) * 0.22;
          g.fillStyle = k ? "#BFD3EA" : "#FFFFFF";
          g.beginPath();
          g.arc(-k * 4 - r * 0.6, 0, r, -1.25, 1.25);
          g.arc(-k * 4 - r * 0.95, 0, r * 0.82, 1.1, -1.1, true);
          g.fill();
        }
        g.restore();
      } else {
        g.save();
        g.translate(cx, cy);
        g.rotate(dir > 0 ? 0 : Math.PI);
        g.globalAlpha = 0.35;
        g.fillStyle = "#BFF3FF";
        g.beginPath();
        g.moveTo(-w, 0);
        g.lineTo(0, -w / 3);
        g.lineTo(0, w / 3);
        g.fill();
        g.globalAlpha = 1;
        g.fillStyle = "#E9FCFF";
        g.strokeStyle = "#3EB6E8";
        g.lineWidth = 0.6;
        g.beginPath();
        g.moveTo(w / 2, 0);
        g.lineTo(0, -w / 3.2);
        g.lineTo(-w / 2.2, 0);
        g.lineTo(0, w / 3.2);
        g.closePath();
        g.fill();
        g.stroke();
        g.restore();
      }
      g.restore();
      g.globalAlpha = 1;
    }
  }

  /** 건모 Alt+F4: 화면 전체가 잠깐 블루스크린 (처음엔 꽉 차게, 뒤로 갈수록 줄무늬로 깨지며 걷힘) */
  private drawBsod() {
    const g = this.g;
    const W = this.canvas.width,
      H = this.canvas.height;
    const t = BSOD_T - this.bsod; // 지난 프레임
    const hold = 16;
    const a = t < hold ? 0.92 : Math.max(0, 0.92 * (1 - (t - hold) / (BSOD_T - hold)));
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    const sc = this.bsodSchool;
    const C0 = sc ? "#1F4A38" : "#1452B8",
      C1 = sc ? "#2B5C46" : "#2A6BD6";
    if (t < hold) {
      g.globalAlpha = a;
      g.fillStyle = C0;
      g.fillRect(0, 0, W, H);
      if (sc) {
        // 칠판 나무 테두리 + 분필 받침
        g.fillStyle = "#6B4A2B";
        g.fillRect(0, 0, W, H * 0.03);
        g.fillRect(0, H * 0.94, W, H * 0.06);
        g.fillStyle = "#EDE9DA";
        g.fillRect(W * 0.72, H * 0.925, W * 0.05, H * 0.015);
      }
    } else {
      // 걷히는 동안: 가로 줄무늬로 깨져 사라짐
      const rows = 18;
      for (let r = 0; r < rows; r++) {
        if ((r * 7 + t * 3) % 5 === 0) continue;
        g.globalAlpha = a * (0.6 + 0.4 * ((r * 13) % 7) / 7);
        g.fillStyle = r % 3 ? C0 : C1;
        const off = ((r * 37 + t * 11) % 40) - 20;
        g.fillRect(off * (W / 400), (r * H) / rows, W, H / rows + 1);
      }
    }
    g.globalAlpha = Math.min(1, a * 1.1);
    g.fillStyle = sc ? "#EDE9DA" : "#FFFFFF";
    g.textAlign = "left";
    g.textBaseline = "top";
    const u = W / 100;
    if (sc) {
      g.font = `bold ${Math.round(u * 7)}px 'Nanum Gothic', sans-serif`;
      g.fillText("x = ?", u * 10, H * 0.17);
      g.font = `bold ${Math.round(u * 2.4)}px 'Nanum Gothic', sans-serif`;
      g.fillText("종이 울렸습니다. 상대를 강제로 하교시켰습니다.", u * 10, H * 0.2 + u * 11);
      g.font = `${Math.round(u * 1.8)}px 'Nanum Gothic', sans-serif`;
      g.fillText(`${Math.min(100, t * 7)}% 하교 중`, u * 10, H * 0.2 + u * 15);
      g.font = `${Math.round(u * 1.2)}px monospace`;
      g.globalAlpha *= 0.7;
      g.fillText("중지 코드: 4교시_종료_급식_ㄱㄱ", u * 10, H * 0.2 + u * 19);
      g.restore();
      return;
    }
    g.font = `${Math.round(u * 9)}px 'Nanum Gothic', sans-serif`;
    g.fillText(":(", u * 10, H * 0.2);
    g.font = `bold ${Math.round(u * 2.4)}px 'Nanum Gothic', sans-serif`;
    g.fillText("상대 프로그램이 응답하지 않아 강제로 종료했습니다.", u * 10, H * 0.2 + u * 11);
    g.font = `${Math.round(u * 1.8)}px 'Nanum Gothic', sans-serif`;
    g.fillText(`${Math.min(100, t * 7)}% 완료`, u * 10, H * 0.2 + u * 15);
    g.font = `${Math.round(u * 1.2)}px monospace`;
    g.globalAlpha *= 0.7;
    g.fillText("중지 코드: ALT_F4_FORCE_QUIT", u * 10, H * 0.2 + u * 19);
    g.restore();
  }

  /** 제나 일섬: 지나간 빛줄기, 낙인 몸 둘레 고리, 낙인이 터지는 번개 */
  private drawZap(s: State) {
    const g = this.g;
    g.save();
    g.globalCompositeOperation = "lighter";
    const flash = fxImg("zena-flash-0"),
      strike = fxImg("zena-strike-0"),
      mark = fxImg("zena-mark-0");
    for (const l of this.lines) {
      const a = l.life / l.max;
      if (flash) {
        // 그림은 오른쪽(x1 쪽)이 끝 — 일섬이 간 방향으로 뒤집음
        const dir = l.x1 >= l.x0 ? 1 : -1;
        const len = Math.abs(l.x1 - l.x0) + 40;
        g.save();
        g.globalAlpha = Math.min(1, a * 1.3);
        g.translate(l.x0 - dir * 20, l.y);
        g.scale(dir, 1);
        g.drawImage(flash, 0, -(26 + 16 * a) / 2, len, 26 + 16 * a);
        g.restore();
      }
      const th = 2 + 10 * a;
      const grad = g.createLinearGradient(l.x0, 0, l.x1, 0);
      grad.addColorStop(0, "rgba(255,240,150,0)");
      grad.addColorStop(0.15, `rgba(255,245,180,${0.9 * a})`);
      grad.addColorStop(1, `rgba(255,255,255,${a})`);
      g.fillStyle = grad;
      g.fillRect(Math.min(l.x0, l.x1), l.y - th / 2, Math.abs(l.x1 - l.x0), th);
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.fillRect(Math.min(l.x0, l.x1), l.y - th / 6, Math.abs(l.x1 - l.x0), th / 3);
    }
    for (const b of this.bolts) {
      const a = b.life / b.max;
      if (strike) {
        // 낙뢰 그림: 바닥(b.y) 기준, 위로 화면 끝까지 늘림
        const w = 110,
          h = Math.max(140, b.y + 10);
        g.save();
        g.globalAlpha = Math.min(1, a * 1.5);
        g.drawImage(strike, b.x - w / 2, b.y - h, w, h);
        g.restore();
      }
      g.strokeStyle = `rgba(255,250,200,${a})`;
      g.lineWidth = 2 + 4 * a;
      g.beginPath();
      let px = b.x,
        py = -10;
      g.moveTo(px, py);
      while (py < b.y) {
        py = Math.min(b.y, py + 22 + Math.random() * 18);
        px = b.x + (Math.random() - 0.5) * (py < b.y ? 26 : 0);
        g.lineTo(px, py);
      }
      g.stroke();
    }
    // 낙인 찍힌 상대: 몸 둘레에 도는 보라 번개
    for (const f of s.p) {
      if (f.zap <= 0) continue;
      const x = f.x / SUB,
        y = screenY(f.h) - 32;
      if (mark) {
        // 낙인 문양: 몸 위에서 천천히 돌며 깜빡, 터질 때가 가까울수록 커지고 진해짐
        const near = 1 - f.zap / 120;
        const z = 38 + 10 * near + 3 * Math.sin(s.f * 0.5);
        g.save();
        g.globalAlpha = 0.45 + 0.4 * near + 0.15 * Math.sin(s.f * 0.7);
        g.translate(x, y);
        g.rotate(s.f * 0.05);
        g.drawImage(mark, -z / 2, -z / 2, z, z);
        g.restore();
      }
      const r = 22 + 4 * Math.sin(s.f * 0.4);
      g.strokeStyle = `rgba(200,160,255,${0.35 + 0.3 * (1 - f.zap / 120)})`;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let k = 0; k <= 12; k++) {
        const t = (k / 12) * Math.PI * 2 + s.f * 0.15;
        const rr = r + (k % 2 ? 3 : -3);
        g.lineTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr * 1.4);
      }
      g.stroke();
    }
    g.restore();
    for (const l of this.lines) l.life--;
    for (const b of this.bolts) b.life--;
    this.lines = this.lines.filter((l) => l.life > 0);
    this.bolts = this.bolts.filter((b) => b.life > 0);
  }

  draw(s: State) {
    this.cur = s;
    const g = this.g;
    const k = this.canvas.width / VIEW_W;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    const sx = this.shake > 0.5 ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0.5 ? (Math.random() - 0.5) * this.shake * 0.6 : 0;
    g.drawImage(this.stage(s, k), sx * k, sy * k);
    g.setTransform(k, 0, 0, k, sx * k, sy * k);

    if (s.freeze > 0) {
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.fillRect(-10, -10, VIEW_W + 20, VIEW_H + 20);
    }
    // 발판은 배경에 구워 둠 → 캐릭터 (공격 중인 쪽을 앞에)
    const order = s.p[0].st === "atk" && s.p[1].st !== "atk" ? [1, 0] : [0, 1];
    for (const i of order) {
      this.drawMaxAura(s.p[i], s);
      this.drawFighter(s.p[i], i, s);
      this.drawWindAura(s.p[i], s);
    }
    this.tagF = s.f;
    for (let i = 0; i < 2; i++) this.drawTag(s.p[i], i);
    this.drawProj(s);
    this.drawFx();
    this.drawZap(s);

    for (const p of this.parts) {
      const a = p.life / p.max;
      g.globalAlpha = Math.min(1, a * 1.5);
      if (p.kind === "spark" || p.kind === "dust") {
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
        g.fill();
      } else if (p.kind === "vstreak") {
        // 세로 속도선 (곰 포옹으로 안고 떨어질 때)
        g.strokeStyle = p.color;
        g.lineWidth = p.size;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x, p.y - 14 - p.size * 4);
        g.stroke();
      } else if (p.kind === "streak") {
        g.strokeStyle = p.color;
        g.lineWidth = p.size;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 6, p.y);
        g.stroke();
      } else if (p.kind === "flame") {
        g.fillStyle = a > 0.6 ? "#FFE27A" : a > 0.3 ? "#FF9A3A" : "#FF5A1F";
        g.beginPath();
        g.ellipse(p.x, p.y, p.size, p.size * 1.6, 0, 0, Math.PI * 2);
        g.fill();
      } else if (p.kind === "bolt") {
        g.strokeStyle = a > 0.5 ? "#FFFFFF" : "#FFE45C";
        g.lineWidth = 0.6;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 1.5 + 1, p.y - p.vy * 1.5 - 1);
        g.lineTo(p.x - p.vx * 3, p.y - p.vy * 3);
        g.stroke();
      } else if (p.kind === "shard") {
        g.fillStyle = a > 0.5 ? "#FFFFFF" : "#9FE8FF";
        g.beginPath();
        g.moveTo(p.x, p.y - p.size * 1.6);
        g.lineTo(p.x + p.size * 0.7, p.y);
        g.lineTo(p.x, p.y + p.size * 1.6);
        g.lineTo(p.x - p.size * 0.7, p.y);
        g.fill();
      } else if (p.kind === "ring") {
        g.globalAlpha = a;
        g.strokeStyle = p.color;
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(p.x, p.y, p.size * (1.6 - a), 0, Math.PI * 2);
        g.stroke();
      } else if (p.kind === "text" && p.text) {
        g.font = `bold ${Math.round(8 * p.size)}px ui-sans-serif, system-ui, sans-serif`;
        g.textAlign = "center";
        g.lineWidth = 2;
        g.strokeStyle = "rgba(0,0,0,0.8)";
        g.strokeText(p.text, p.x, p.y);
        g.fillStyle = p.color;
        g.fillText(p.text, p.x, p.y);
      }
    }
    g.globalAlpha = 1;

    if (this.bsod > 0) this.drawBsod();
    if (this.flash > 0) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = this.flash / 20;
      g.fillStyle = this.flashColor;
      g.fillRect(0, 0, this.canvas.width, this.canvas.height);
      g.globalAlpha = 1;
    }
  }
}
