import { CHARS, CHAR_TALL, IDLE_MS, WALK_MS, sheetOf } from "@/lib/gmtown/chars";
import type { ChatWire, MoveWire, PlayerWire, TownSnap } from "@/lib/gmtown/types";
import {
  ARCH,
  BENCHES,
  BOARD,
  BOUNDS,
  BUILDINGS,
  FLOWERS,
  FOUNTAIN,
  LAMPS,
  PLAZA,
  RADIUS,
  ROADS,
  SPEED,
  TREES,
  WORLD,
  Y_SCALE,
  Z_SCALE,
  blocked,
  dir8,
  doorAt,
  doorFront,
  type Building,
} from "@/lib/gmtown/world";
import {
  SKY,
  drawArch,
  drawBench,
  drawBoard,
  drawBuildingFx,
  drawFlowers,
  drawFountain,
  drawLamp,
  drawTree,
  paintGround,
  renderBuilding,
  rr,
  type BuildingArt,
} from "./draw";

/*
 * GMTOWN 엔진 — 캔버스 하나에 마을을 그리고, 내 캐릭터를 움직이고, 다른 사람을 부드럽게 보여 줌.
 * React(GMTownApp)는 HUD(채널 · 채팅 · 건물 카드)만 맡고 여기 훅으로 주고받음.
 *
 * 그리기: 땅은 8×8칸 조각을 미리 그려 두고(화면 배율이 바뀌면 다시), 건물은 한 채씩 미리 그린 그림 + 움직이는 장식,
 *   나머지(나무 · 가로등 · 분수 · 사람)는 매 장면 — 전부 「땅에 닿는 y」 순서로 그려서 뒤에 있는 건 가려짐.
 * 움직이기: 키보드(WASD · 방향키) · 누른 곳으로 걸어가기(0.5칸 격자 A* → 직선으로 펴기) · 폰은 왼쪽에 손가락 조이스틱.
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
}

interface Sample {
  t: number;
  x: number;
  y: number;
  d: number;
  m: 0 | 1;
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
}

const CHUNK = 8;
const GRID = 0.5;
const INTERP_MS = 120;

export class TownEngine {
  private ctx: CanvasRenderingContext2D;
  private cw = 0;
  private ch = 0;
  private dpr = 1;
  private T = 56;
  private cam = { x: 30, y: 38 };
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
  private near: Building | "board" | null = null;
  private hover: Building | null = null;
  private sent = { x: 0, y: 0, d: -1, m: -1 as number, at: 0 };
  private typing = false;

  private chunks = new Map<string, HTMLCanvasElement>();
  /** 건물별 비침 정도 (0~1, 부드럽게 바뀜) */
  private fades = new Map<string, number>();
  private arts = new Map<string, BuildingArt>();
  private artT = 0;
  private sheets = new Map<string, HTMLImageElement>();
  private icons = new Map<string, HTMLImageElement>();
  private walk: Uint8Array;
  private gw = Math.ceil(WORLD.w / GRID);
  private gh = Math.ceil(WORLD.h / GRID);
  private ro: ResizeObserver;

  constructor(
    private canvas: HTMLCanvasElement,
    private hooks: EngineHooks
  ) {
    this.ctx = canvas.getContext("2d")!;
    // 걸을 수 있는 격자 (길 찾기)
    this.walk = new Uint8Array(this.gw * this.gh);
    for (let gy = 0; gy < this.gh; gy++) for (let gx = 0; gx < this.gw; gx++) this.walk[gy * this.gw + gx] = blocked((gx + 0.5) * GRID, (gy + 0.5) * GRID, RADIUS + 0.06) ? 0 : 1;
    // 그림
    for (const [c, def] of Object.entries(CHARS))
      for (const d of Object.values(def.dirs))
        for (const sh of [d.walk, d.idle]) {
          const img = new Image();
          img.src = `${def.base}/${sh.file}`;
          this.sheets.set(`${c}/${sh.file}`, img);
        }
    for (const b of BUILDINGS)
      if (b.icon.startsWith("px:")) {
        const img = new Image();
        img.src = `/icons/games/${b.icon.slice(3)}.webp`;
        img.onload = () => this.arts.delete(b.id);
        this.icons.set(b.id, img);
      }
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
  }

  // ───────────── 서버에서 온 것 ─────────────

  reset(s: TownSnap) {
    this.others.clear();
    const mine = s.players.find((p) => p.id === s.me);
    for (const p of s.players) if (p.id !== s.me) this.others.set(p.id, this.avatarOf(p));
    // 다시 연결된 경우 화면의 내 위치를 그대로 씀 (서버가 새로 정한 곳으로 순간이동하지 않게)
    const keep = this.me ? { x: this.me.x, y: this.me.y } : null;
    this.me = mine ? this.avatarOf(mine) : null;
    if (this.me) {
      this.me.id = s.me;
      if (keep && !blocked(keep.x, keep.y)) {
        this.me.x = keep.x;
        this.me.y = keep.y;
        this.sent.at = 0;
        this.sent.m = -1;
      } else this.cam = { x: this.me.x, y: this.me.y - 1 };
    }
  }
  join(p: PlayerWire) {
    if (p.id === this.me?.id) return;
    this.others.set(p.id, this.avatarOf(p));
  }
  leave(id: string) {
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
    return this.me ? { x: Math.round(this.me.x * 100) / 100, y: Math.round(this.me.y * 100) / 100 } : null;
  }
  /** 지금 서 있는 문 앞 */
  nearNow() {
    return this.near;
  }
  /** 사람 수 (나 포함) */
  count() {
    return this.others.size + (this.me ? 1 : 0);
  }

  private avatarOf(p: PlayerWire): Avatar {
    return { id: p.id, name: p.name, guest: p.guest, c: p.c, x: p.x, y: p.y, d: p.d, moving: !!p.m, phase: Math.random() * 1000, samples: [{ t: performance.now(), x: p.x, y: p.y, d: p.d, m: p.m }], bubble: null };
  }

  // ───────────── 화면 크기 ─────────────

  private resize() {
    const host = this.canvas.parentElement ?? this.canvas;
    const cw = Math.max(1, host.clientWidth),
      ch = Math.max(1, host.clientHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cw = cw;
    this.ch = ch;
    this.dpr = dpr;
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;
    // 보이는 칸 수: 넓은 화면 26칸 · 중간 20칸 · 좁은 화면 14칸, 세로로 최소 12칸은 보이게
    const across = cw >= 1000 ? 26 : cw >= 700 ? 20 : 14;
    let T = Math.max(30, Math.min(60, cw / across));
    T = Math.min(T, ch / (12 * Y_SCALE));
    T = Math.round(T);
    if (T !== this.T) {
      this.T = T;
      this.chunks.clear();
      this.arts.clear();
    }
  }

  // ───────────── 좌표 ─────────────

  private sx = (x: number) => (x - this.cam.x) * this.T + this.cw / 2;
  private sy = (y: number) => (y - this.cam.y) * this.T * Y_SCALE + this.ch / 2;
  private wx = (sx: number) => (sx - this.cw / 2) / this.T + this.cam.x;
  private wy = (sy: number) => (sy - this.ch / 2) / (this.T * Y_SCALE) + this.cam.y;

  // ───────────── 입력 ─────────────

  private onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || this.typing) return;
    const k = e.key.toLowerCase();
    const map: Record<string, string> = { w: "u", arrowup: "u", s: "d", arrowdown: "d", a: "l", arrowleft: "l", d: "r", arrowright: "r" };
    const m = map[k];
    if (m) {
      e.preventDefault();
      if (e.type === "keydown") {
        this.keys.add(m);
        this.path = [];
        this.goal = null;
      } else this.keys.delete(m);
      return;
    }
    if (e.type === "keydown" && (k === "e" || k === " ")) {
      e.preventDefault();
      this.hooks.onInteract();
    }
  };
  private onBlur = () => this.keys.clear();

  private buildingAt(px: number, py: number): Building | null {
    // 앞쪽(아래) 건물이 위에 그려지므로 아래부터
    const list = [...BUILDINGS].sort((a, b) => b.y + b.d - (a.y + a.d));
    for (const b of list) {
      const art = this.art(b);
      const ax = this.sx(b.x),
        ay = this.sy(b.y + b.d);
      if (px >= ax + art.box.x && px <= ax + art.box.x + art.box.w && py >= ay + art.box.y && py <= ay) return b;
    }
    return null;
  }

  private onDown = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    const px = e.clientX - r.left,
      py = e.clientY - r.top;
    // 터치: 왼쪽 40% 는 조이스틱
    if (e.pointerType === "touch" && px < this.cw * 0.4 && !this.joy) {
      this.joy = { id: e.pointerId, ox: px, oy: py, x: px, y: py };
      this.path = [];
      this.goal = null;
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const b = this.buildingAt(px, py);
    if (b) return this.walkTo(doorFront(b).x, doorFront(b).y, b);
    const x = this.wx(px),
      y = this.wy(py);
    if (Math.hypot(x - BOARD.x, y - BOARD.y) < 0.9 || (Math.abs(px - this.sx(BOARD.x)) < this.T * 0.7 && py < this.sy(BOARD.y) && py > this.sy(BOARD.y) - this.T * 1.9))
      return this.walkTo(BOARD.x, BOARD.y + 0.75, "board");
    this.walkTo(x, y, null);
  };
  private onMove = (e: PointerEvent) => {
    if (this.joy && e.pointerId === this.joy.id) {
      const r = this.canvas.getBoundingClientRect();
      this.joy.x = e.clientX - r.left;
      this.joy.y = e.clientY - r.top;
      return;
    }
    if (e.pointerType !== "mouse") return;
    const r = this.canvas.getBoundingClientRect();
    this.hover = this.buildingAt(e.clientX - r.left, e.clientY - r.top);
    this.canvas.style.cursor = this.hover ? "pointer" : "default";
  };
  private onUp = (e: PointerEvent) => {
    if (this.joy && e.pointerId === this.joy.id) this.joy = null;
  };
  private onLeave = () => {
    this.hover = null;
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

  // ───────────── 길 찾기 (A* · 0.5칸 격자) ─────────────

  private cell(x: number, y: number) {
    return [Math.max(0, Math.min(this.gw - 1, Math.floor(x / GRID))), Math.max(0, Math.min(this.gh - 1, Math.floor(y / GRID)))] as const;
  }
  private open(gx: number, gy: number) {
    return gx >= 0 && gy >= 0 && gx < this.gw && gy < this.gh && this.walk[gy * this.gw + gx] === 1;
  }
  /** 막힌 칸이면 가장 가까운 열린 칸 */
  private nearestOpen(gx: number, gy: number): [number, number] | null {
    if (this.open(gx, gy)) return [gx, gy];
    for (let r = 1; r < 12; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) if ((Math.abs(dx) === r || Math.abs(dy) === r) && this.open(gx + dx, gy + dy)) return [gx + dx, gy + dy];
    return null;
  }
  private clear(ax: number, ay: number, bx: number, by: number) {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.15);
    for (let i = 1; i <= n; i++) if (blocked(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, RADIUS + 0.02)) return false;
    return true;
  }
  private findPath(fx: number, fy: number, tx: number, ty: number): { x: number; y: number }[] {
    const [sgx, sgy] = this.cell(fx, fy);
    const end = this.nearestOpen(...this.cell(tx, ty));
    if (!end) return [];
    const exact = this.open(...this.cell(tx, ty)) && !blocked(tx, ty);
    const goal = exact ? { x: tx, y: ty } : { x: (end[0] + 0.5) * GRID, y: (end[1] + 0.5) * GRID };
    if (this.clear(fx, fy, goal.x, goal.y)) return Math.hypot(goal.x - fx, goal.y - fy) < 0.05 ? [] : [goal];
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
    while (heap.length && steps++ < 20000) {
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
    for (let i = ei; i !== -1 && i !== si; i = from[i]) pts.push({ x: ((i % W) + 0.5) * GRID, y: (((i / W) | 0) + 0.5) * GRID });
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
    this.render(now);
    this.raf = requestAnimationFrame(this.frame);
  };

  /** 입력 · 길 따라가기 · 부딪힘을 짧은 시간 h 만큼 (한 장면을 여러 번 나눠서) */
  private step(me: Avatar, h: number): { moving: boolean; speed: number } {
    let vx = 0,
      vy = 0;
    if (this.keys.has("l")) vx -= 1;
    if (this.keys.has("r")) vx += 1;
    if (this.keys.has("u")) vy -= 1;
    if (this.keys.has("d")) vy += 1;
    let speed = SPEED;
    if (this.joy) {
      const dx = this.joy.x - this.joy.ox,
        dy = this.joy.y - this.joy.oy;
      const len = Math.hypot(dx, dy);
      if (len > 8) {
        vx = dx / len;
        vy = dy / len / Y_SCALE;
        speed = SPEED * Math.min(1, len / 46);
      }
    }
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
      // 보내기 (0.1초마다, 바뀐 게 있을 때만)
      const m = moving ? 1 : 0;
      if (now - this.sent.at >= 100 && (Math.hypot(me.x - this.sent.x, me.y - this.sent.y) > 0.01 || me.d !== this.sent.d || m !== this.sent.m)) {
        this.sent = { x: me.x, y: me.y, d: me.d, m, at: now };
        this.hooks.send(Math.round(me.x * 100) / 100, Math.round(me.y * 100) / 100, me.d, m);
      }
      // 문 앞
      const b = doorAt(me.x, me.y);
      const nb: Building | "board" | null = b ?? (Math.hypot(me.x - BOARD.x, me.y - BOARD.y) < 1.2 ? "board" : null);
      if (nb !== this.near) {
        this.near = nb;
        this.hooks.onNear(nb);
      }
      // 카메라: 부드럽게 따라감 (마을 밖은 안 보이게)
      // 문 앞에 서면 그 건물 쪽으로 조금 올려 봄 (낮은 화면에서도 간판이 보이게)
      const lean = this.near && this.near !== "board" ? Math.min(3.5, this.near.h * 0.55) : 0;
      const tx = me.x,
        ty = me.y - 0.8 - lean;
      const k = Math.min(1, dt * 7);
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += (ty - this.cam.y) * k;
    }
    const halfW = this.cw / 2 / this.T,
      halfH = this.ch / 2 / (this.T * Y_SCALE);
    this.cam.x = Math.max(halfW + 0.5, Math.min(WORLD.w - halfW - 0.5, this.cam.x));
    this.cam.y = Math.max(halfH - 2, Math.min(WORLD.h + 0.5 - halfH, this.cam.y));
    if (halfW * 2 > WORLD.w - 1) this.cam.x = WORLD.w / 2;

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
      a.d = d;
      a.phase += dt * 1000;
    }
  }

  // ───────────── 그리기 ─────────────

  private art(b: Building): BuildingArt {
    let a = this.arts.get(b.id);
    if (!a || this.artT !== this.T) {
      if (this.artT !== this.T) this.arts.clear();
      this.artT = this.T;
      const icon = this.icons.get(b.id);
      a = renderBuilding(b, this.T, this.dpr, icon && icon.complete && icon.naturalWidth ? icon : null);
      this.arts.set(b.id, a);
    }
    return a;
  }

  private chunk(cx: number, cy: number): HTMLCanvasElement {
    const key = `${cx},${cy}`;
    let c = this.chunks.get(key);
    if (c) {
      this.chunks.delete(key);
      this.chunks.set(key, c);
      return c;
    }
    c = document.createElement("canvas");
    const T = this.T,
      dpr = this.dpr;
    c.width = Math.ceil(CHUNK * T * dpr) + 1;
    c.height = Math.ceil(CHUNK * T * Y_SCALE * dpr) + 1;
    const g = c.getContext("2d")!;
    g.scale(dpr * T, dpr * T * Y_SCALE);
    g.translate(-cx * CHUNK, -cy * CHUNK);
    paintGround(g, cx * CHUNK, cy * CHUNK, CHUNK);
    this.chunks.set(key, c);
    // 오래 안 쓴 조각부터 지움 (폰 메모리). 한 화면에 걸치는 조각 수의 두 배 이상은 두어야
    // 「새 조각 → 아직 안 그린 보이는 조각을 지움 → 다시 그림」이 장면마다 되풀이되지 않음
    const need = (Math.ceil(this.cw / (CHUNK * T)) + 1) * (Math.ceil(this.ch / (CHUNK * T * Y_SCALE)) + 1);
    while (this.chunks.size > Math.max(48, need * 2)) this.chunks.delete(this.chunks.keys().next().value as string);
    return c;
  }

  private render(now: number) {
    const ctx = this.ctx,
      T = this.T,
      t = (now - this.t0) / 1000;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = SKY;
    ctx.fillRect(0, 0, this.cw, this.ch);

    // 땅 조각 (화면에 걸친 것만 — 여유 줄을 두면 조각 수가 늘어 캐시가 넘침)
    const x0 = Math.floor(this.wx(0) / CHUNK),
      x1 = Math.floor(this.wx(this.cw) / CHUNK);
    const y0 = Math.floor(this.wy(0) / CHUNK),
      y1 = Math.floor(this.wy(this.ch) / CHUNK);
    const cwPx = CHUNK * T,
      chPx = CHUNK * T * Y_SCALE;
    for (let cy = Math.max(-1, y0); cy <= Math.min(Math.ceil(WORLD.h / CHUNK), y1); cy++)
      for (let cx = Math.max(-1, x0); cx <= Math.min(Math.ceil(WORLD.w / CHUNK), x1); cx++) {
        const c = this.chunk(cx, cy);
        const px = Math.floor(this.sx(cx * CHUNK)),
          py = Math.floor(this.sy(cy * CHUNK));
        ctx.drawImage(c, px, py, Math.ceil(cwPx) + 1, Math.ceil(chPx) + 1);
      }

    // 그릴 것들을 땅에 닿는 y 순서로
    type D = { y: number; f: () => void };
    const list: D[] = [];
    const vis = (x: number, y: number, pad: number) => {
      const px = this.sx(x),
        py = this.sy(y);
      return px > -pad * T && px < this.cw + pad * T && py > -T && py < this.ch + pad * T * 1.5;
    };
    const people = [...this.others.values(), ...(this.me ? [this.me] : [])];
    /** 이 사람이 이 건물 뒤에 있어서 가려지는지 */
    const hides = (b: Building, a: Avatar) => {
      if (a.y >= b.y + b.d || a.y < b.y - 9) return false;
      const art = this.art(b);
      const ax = this.sx(b.x),
        ay = this.sy(b.y + b.d);
      const px = this.sx(a.x),
        py = this.sy(a.y);
      return px > ax + art.box.x - T * 0.3 && px < ax + art.box.x + art.box.w + T * 0.3 && py > ay + art.box.y && py - CHAR_TALL * T < ay;
    };
    const ghosts: Avatar[] = [];
    for (const b of BUILDINGS) {
      if (!vis(b.x + b.w / 2, b.y + b.d, b.w / 2 + 2)) continue;
      const fade = !!this.me && hides(b, this.me);
      for (const a of people) if (a !== this.me && hides(b, a) && !ghosts.includes(a)) ghosts.push(a);
      list.push({
        y: b.y + b.d,
        f: () => {
          const a = this.art(b);
          const ax = this.sx(b.x),
            ay = this.sy(b.y + b.d);
          // 내가 뒤에 있으면 건물을 반쯤 비치게 (내 캐릭터가 안 보이는 일이 없게)
          const k = this.fades.get(b.id) ?? 0;
          const nk = k + ((fade ? 1 : 0) - k) * 0.18;
          this.fades.set(b.id, nk);
          ctx.globalAlpha = 1 - nk * 0.55;
          ctx.drawImage(a.canvas, ax - a.ox, ay - a.oy, a.canvas.width / this.dpr, a.canvas.height / this.dpr);
          ctx.globalAlpha = 1;
          drawBuildingFx(ctx, b, ax, ay, T, t);
          if (this.hover === b || (this.near === b && this.near !== null)) {
            ctx.save();
            // 문 둘레만 은은하게 (건물 전체 테두리는 너무 무거움)
            const dw = (b.w >= 12 ? 2.4 : 1.6) * T;
            const dh = Math.min(b.h * Z_SCALE * T * 0.42, 2.1 * Z_SCALE * T);
            ctx.strokeStyle = "rgba(255,244,200,0.85)";
            ctx.lineWidth = 2;
            ctx.shadowColor = b.accent;
            ctx.shadowBlur = 16;
            const yo = b.style === "neon" ? T * 0.5 : 0;
            rr(ctx, ax + (b.w * T) / 2 - dw / 2 - 4, ay - dh - yo - 4, dw + 8, dh + 8, 8);
            ctx.stroke();
            ctx.restore();
          }
        },
      });
    }
    for (const tr of TREES) if (vis(tr.x, tr.y, 2)) list.push({ y: tr.y, f: () => drawTree(ctx, tr, this.sx(tr.x), this.sy(tr.y), T, t) });
    for (const l of LAMPS) if (vis(l.x, l.y, 1)) list.push({ y: l.y, f: () => drawLamp(ctx, this.sx(l.x), this.sy(l.y), T) });
    for (const bn of BENCHES) if (vis(bn.x, bn.y, 1)) list.push({ y: bn.y + 0.25, f: () => drawBench(ctx, this.sx(bn.x), this.sy(bn.y + 0.25), T) });
    for (const f of FLOWERS) if (vis(f.x, f.y, f.w)) list.push({ y: f.y + f.d, f: () => drawFlowers(ctx, f, this.sx(f.x), this.sy(f.y + f.d), T) });
    if (vis(FOUNTAIN.x, FOUNTAIN.y, 4)) list.push({ y: FOUNTAIN.y, f: () => drawFountain(ctx, this.sx(FOUNTAIN.x), this.sy(FOUNTAIN.y), T, t) });
    if (vis((ARCH.x0 + ARCH.x1) / 2, ARCH.y, 6)) list.push({ y: ARCH.y, f: () => drawArch(ctx, this.sx(ARCH.x0), this.sx(ARCH.x1), this.sy(ARCH.y), T) });
    if (vis(BOARD.x, BOARD.y, 1)) list.push({ y: BOARD.y, f: () => drawBoard(ctx, this.sx(BOARD.x), this.sy(BOARD.y), T) });
    for (const a of people) if (vis(a.x, a.y, 1)) list.push({ y: a.y, f: () => this.drawAvatar(a) });
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.f();
    // 건물 뒤에 가려진 다른 사람: 반투명으로 한 번 더 (어디 있는지는 보이게)
    if (ghosts.length) {
      ctx.globalAlpha = 0.38;
      for (const a of ghosts) this.drawAvatar(a, true);
      ctx.globalAlpha = 1;
    }


    // 이름표 · 말풍선 (늘 맨 위)
    for (const a of people) if (vis(a.x, a.y, 2)) this.drawTag(a, now);

    // 가고 있는 곳 표시
    if (this.me && this.path.length) {
      const g = this.path[this.path.length - 1];
      const px = this.sx(g.x),
        py = this.sy(g.y);
      const pulse = 1 + Math.sin(t * 8) * 0.12;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(px, py, T * 0.3 * pulse, T * 0.3 * Y_SCALE * pulse, 0, 0, Math.PI * 2);
      ctx.stroke();
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
    const vg = ctx.createRadialGradient(this.cw / 2, this.ch / 2, Math.min(this.cw, this.ch) * 0.45, this.cw / 2, this.ch / 2, Math.max(this.cw, this.ch) * 0.78);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(10,14,30,0.28)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, this.cw, this.ch);
  }

  private drawAvatar(a: Avatar, ghost = false) {
    const ctx = this.ctx,
      T = this.T;
    const def = CHARS[a.c];
    const { dir, flip } = sheetOf(a.d);
    const ds = def.dirs[dir];
    const sh = a.moving ? ds.walk : ds.idle;
    const img = this.sheets.get(`${a.c}/${sh.file}`);
    const px = this.sx(a.x),
      py = this.sy(a.y);
    // 그림자
    if (!ghost) {
      ctx.fillStyle = "rgba(20,30,40,0.28)";
      ctx.beginPath();
      ctx.ellipse(px, py, T * 0.32, T * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!img || !img.complete || !img.naturalWidth) return;
    const fi = a.moving ? (ds.start + Math.floor(a.phase / WALK_MS)) % sh.n : Math.floor(a.phase / IDLE_MS) % sh.n;
    const k = (CHAR_TALL * T) / def.tall;
    ctx.save();
    ctx.translate(px, py);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(img, fi * sh.w, 0, sh.w, sh.h, -sh.ax * k, -sh.ay * k, sh.w * k, sh.h * k);
    ctx.restore();
  }

  private drawTag(a: Avatar, now: number) {
    const ctx = this.ctx,
      T = this.T;
    const px = this.sx(a.x),
      py = this.sy(a.y);
    const top = py - CHAR_TALL * T - 4;
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

  // ───────────── 작은 지도 ─────────────

  drawMinimap(m: CanvasRenderingContext2D, w: number, h: number) {
    const x0 = BOUNDS.x0 - 1,
      y0 = BOUNDS.y0 - 7,
      x1 = BOUNDS.x1 + 1,
      y1 = BOUNDS.y1 + 1;
    const k = Math.min(w / (x1 - x0), h / (y1 - y0));
    const ox = (w - (x1 - x0) * k) / 2,
      oy = (h - (y1 - y0) * k) / 2;
    const X = (x: number) => ox + (x - x0) * k,
      Y = (y: number) => oy + (y - y0) * k;
    m.clearRect(0, 0, w, h);
    m.fillStyle = "#5f9e5a";
    m.fillRect(X(x0), Y(y0), (x1 - x0) * k, (y1 - y0) * k);
    m.fillStyle = "#e7d8bf";
    for (const r of ROADS) m.fillRect(X(r[0]), Y(r[1]), (r[2] - r[0]) * k, (r[3] - r[1]) * k);
    m.beginPath();
    m.arc(X(PLAZA.x), Y(PLAZA.y), PLAZA.r * k, 0, Math.PI * 2);
    m.fill();
    m.fillStyle = "#5fc3e8";
    m.beginPath();
    m.arc(X(FOUNTAIN.x), Y(FOUNTAIN.y), FOUNTAIN.r * k, 0, Math.PI * 2);
    m.fill();
    for (const b of BUILDINGS) {
      m.fillStyle = b.accent;
      m.globalAlpha = this.near === b ? 1 : 0.85;
      m.fillRect(X(b.x), Y(b.y), b.w * k, b.d * k);
      m.globalAlpha = 1;
      m.strokeStyle = "rgba(20,16,40,0.8)";
      m.lineWidth = 1;
      m.strokeRect(X(b.x), Y(b.y), b.w * k, b.d * k);
    }
    // 보이는 범위
    m.strokeStyle = "rgba(255,255,255,0.75)";
    m.lineWidth = 1;
    m.strokeRect(X(this.wx(0)), Y(this.wy(0)), (this.cw / this.T) * k, (this.ch / (this.T * Y_SCALE)) * k);
    m.fillStyle = "#ffffff";
    for (const a of this.others.values()) {
      m.beginPath();
      m.arc(X(a.x), Y(a.y), 2.2, 0, Math.PI * 2);
      m.fill();
    }
    if (this.me) {
      m.fillStyle = "#FFD36B";
      m.strokeStyle = "#3a2a00";
      m.beginPath();
      m.arc(X(this.me.x), Y(this.me.y), 3.4, 0, Math.PI * 2);
      m.fill();
      m.stroke();
    }
  }
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
