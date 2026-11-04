import type * as MatterNS from "matter-js";
import {
  COMBO_MS,
  DROP_COOLDOWN,
  DROP_TIERS,
  H,
  LAST,
  LINE_Y,
  OVER_MS,
  pts,
  TIERS,
  TOP_Y,
  TROPHY_BONUS,
  W,
  WALL,
  type SkillId,
} from "./engine";

/*
 * 픽셀 머지 — 판 하나 (물리 matter-js · 캔버스 그리기). 화면(React)과는 콜백으로만 이야기함.
 *  - 같은 단계 공 둘이 닿으면 가운데에 다음 단계 공, 그 단계 캐릭터 기술이 터짐
 *  - 1.1초 안에 이어 합치면 연쇄 (점수 +25%씩)
 *  - 선 위에 2초 머문 공이 있으면 끝
 */

type Matter = typeof MatterNS;
type Body = MatterNS.Body & {
  tier: number;
  born: number;
  over: number;
  dying?: boolean;
  frozenUntil?: number;
};

export type Sfx = "drop" | "merge" | "combo" | SkillId | "over";

export interface Result {
  score: number;
  drops: number;
  maxTier: number;
  /** 걸린 시간 (초, 0.1 단위) */
  time: number;
  trophies: number;
}
export interface GameHooks {
  onScore?: (score: number) => void;
  onNext?: (cur: number, next: number) => void;
  onTier?: (t: number) => void;
  onOver?: (r: Result) => void;
  sfx?: (name: Sfx, rate?: number) => void;
}

interface Fx {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  col: string;
  s: number;
  kind?: "ring" | "streak" | "wave";
  r0?: number;
  grav?: number;
}
interface Txt {
  x: number;
  y: number;
  s: string;
  col: string;
  size: number;
  life: number;
}

export class MergeGame {
  private M: Matter;
  private engine: MatterNS.Engine;
  private balls = new Set<Body>();
  private queue: [Body, Body][] = [];
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private raf = 0;
  private acc = 0;
  private last = 0;
  private startedAt = performance.now();
  private fx: Fx[] = [];
  private texts: Txt[] = [];
  private bolts: { a: { x: number; y: number }; b: { x: number; y: number }; life: number }[] = [];
  private shake = 0;
  private slowUntil = 0;
  private danger = 0;
  /** 선 위에 공이 있던 시간 (ms) — 잠깐 내려가도 바로 0이 되지 않고 천천히 줄어듦 */
  private overMs = 0;
  private combo = 0;
  private lastMerge = 0;
  private lastSkill: SkillId | null = null;
  private canDrop = true;
  private dropTimer = 0;
  aimX = W / 2;
  cur: number;
  next: number;
  score = 0;
  drops = 0;
  maxTier = 0;
  trophies = 0;
  dead = false;
  paused = false;

  constructor(
    M: Matter,
    private canvas: HTMLCanvasElement,
    private rng: () => number,
    private imgs: (HTMLImageElement | null)[],
    private hooks: GameHooks
  ) {
    this.M = M;
    this.ctx = canvas.getContext("2d")!;
    this.engine = M.Engine.create({ gravity: { x: 0, y: 1.15, scale: 0.001 } });
    this.engine.positionIterations = 8;
    this.engine.velocityIterations = 6;
    const wall = { isStatic: true, friction: 0.3, restitution: 0.1, label: "wall" };
    M.Composite.add(this.engine.world, [
      M.Bodies.rectangle(W / 2, H + 30 - WALL, W + 200, 60, wall),
      M.Bodies.rectangle(-30 + WALL, H / 2 - 200, 60, H + 400, wall),
      M.Bodies.rectangle(W + 30 - WALL, H / 2 - 200, 60, H + 400, wall),
    ]);
    const collide = (e: MatterNS.IEventCollision<MatterNS.Engine>) => {
      for (const p of e.pairs) {
        const a = p.bodyA as Body,
          b = p.bodyB as Body;
        if (a.label === "ball" && b.label === "ball" && a.tier === b.tier && !a.dying && !b.dying) {
          a.dying = b.dying = true;
          this.queue.push([a, b]);
        }
      }
    };
    M.Events.on(this.engine, "collisionStart", collide);
    M.Events.on(this.engine, "collisionActive", collide);
    this.cur = this.pick();
    this.next = this.pick();
    this.hooks.onNext?.(this.cur, this.next);
    this.fit();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private pick() {
    return Math.floor(this.rng() * DROP_TIERS);
  }

  /** 캔버스 크기가 바뀌면 */
  fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || W;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(w * (H / W) * dpr);
    this.scale = this.canvas.width / W;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.dropTimer);
    this.M.Engine.clear(this.engine);
  }

  private clampX(t: number) {
    return Math.max(WALL + TIERS[t].r + 1, Math.min(W - WALL - TIERS[t].r - 1, this.aimX));
  }

  drop() {
    if (!this.canDrop || this.dead || this.paused) return;
    this.makeBall(this.clampX(this.cur), TOP_Y, this.cur);
    this.hooks.sfx?.("drop");
    this.drops++;
    this.canDrop = false;
    this.cur = this.next;
    this.next = this.pick();
    this.hooks.onNext?.(this.cur, this.next);
    this.dropTimer = window.setTimeout(() => (this.canDrop = true), DROP_COOLDOWN);
  }

  private makeBall(x: number, y: number, t: number) {
    const M = this.M;
    const b = M.Bodies.circle(x, y, TIERS[t].r, {
      restitution: 0.12,
      friction: 0.35,
      frictionStatic: 0.5,
      frictionAir: 0.004,
      density: 0.0012,
      label: "ball",
    }) as Body;
    b.tier = t;
    b.born = performance.now();
    b.over = 0;
    M.Composite.add(this.engine.world, b);
    this.balls.add(b);
    if (t > this.maxTier) {
      this.maxTier = t;
      this.hooks.onTier?.(t);
    }
    return b;
  }
  private remove(b: Body) {
    this.balls.delete(b);
    this.M.Composite.remove(this.engine.world, b);
  }

  private merges() {
    while (this.queue.length) {
      const [a, b] = this.queue.shift()!;
      if (!this.balls.has(a) || !this.balls.has(b)) continue;
      const t = a.tier;
      const x = (a.position.x + b.position.x) / 2,
        y = (a.position.y + b.position.y) / 2;
      const vx = (a.velocity.x + b.velocity.x) / 2,
        vy = (a.velocity.y + b.velocity.y) / 2;
      this.remove(a);
      this.remove(b);
      const now = performance.now();
      this.combo = now - this.lastMerge < COMBO_MS ? this.combo + 1 : 1;
      this.lastMerge = now;
      const mult = 1 + 0.25 * (this.combo - 1);
      this.burst(x, y, TIERS[t].col, 10 + t * 2);
      if (t === LAST) {
        const gain = Math.round((pts(t) + TROPHY_BONUS) * mult);
        this.score += gain;
        this.trophies++;
        this.pop(x, y, `+${gain}`, "#ffcf4a", 26);
        this.pop(W / 2, H * 0.34, "우승 트로피!", "#ffcf4a", 32);
        this.hooks.sfx?.("trophy");
        this.confetti(x, y);
      } else {
        const nt = t + 1,
          gain = Math.round(pts(nt) * mult);
        this.score += gain;
        const nb = this.makeBall(x, y, nt);
        this.M.Body.setVelocity(nb, { x: vx * 0.5, y: Math.min(vy, 0) * 0.5 });
        this.pop(x, y - TIERS[nt].r * 0.4, `+${gain}`, "#ffffff", 16 + nt);
        if (this.combo >= 2) {
          this.pop(x, y - TIERS[nt].r - 14, `연쇄 ×${this.combo}`, "#ffcf4a", 18);
          this.hooks.sfx?.("combo", 1 + Math.min(0.5, (this.combo - 2) * 0.08));
        }
        // 큰 공일수록 낮은 소리
        this.hooks.sfx?.("merge", 1.35 - nt * 0.06);
        this.skill(nb, nt);
      }
      this.hooks.onScore?.(this.score);
    }
  }

  // ───── 캐릭터 기술 ─────
  private near(c: Body, R: number) {
    return [...this.balls].filter(
      (b) =>
        b !== c &&
        Math.hypot(b.position.x - c.position.x, b.position.y - c.position.y) < R + TIERS[b.tier].r
    );
  }
  private push(b: Body, dx: number, dy: number) {
    if (!b.isStatic) this.M.Body.setVelocity(b, { x: b.velocity.x + dx, y: b.velocity.y + dy });
  }
  private skill(b: Body, t: number) {
    const T = TIERS[t];
    if (!T.skill) return;
    const p = b.position;
    let kind: SkillId = T.skill;
    if (kind === "encore") {
      // 앙코르: 직전에 터진 기술을 이 자리에서 한 번 더 (없으면 화염구)
      this.pop(p.x, p.y + T.r + 6, "앙코르!", "#ffb3d1", 16);
      this.fx.push({
        x: p.x,
        y: p.y,
        vx: 0,
        vy: 0,
        r0: T.r,
        life: 16,
        col: "#ffb3d1",
        s: 0,
        kind: "wave",
      });
      this.hooks.sfx?.("encore");
      kind = this.lastSkill && this.lastSkill !== "trophy" ? this.lastSkill : "fire";
    } else {
      this.pop(p.x, p.y + T.r + 6, T.sk!, "#ffcf4a", 15);
      this.lastSkill = kind;
      if (kind !== "trophy") this.hooks.sfx?.(kind);
    }
    switch (kind) {
      case "bubble":
        this.push(b, 0, -2.2);
        for (let i = 0; i < 8; i++)
          this.fx.push({
            x: p.x + (Math.random() - 0.5) * T.r * 2,
            y: p.y,
            vx: 0,
            vy: -1 - Math.random() * 2,
            life: 50,
            col: "#bfe9ff",
            s: 4 + Math.random() * 5,
            kind: "ring",
          });
        break;
      case "fire":
        for (const o of this.near(b, 110)) {
          const dx = o.position.x - p.x,
            dy = o.position.y - p.y,
            d = Math.hypot(dx, dy) || 1;
          this.push(o, (dx / d) * 3, (dy / d) * 3 - 0.6);
        }
        this.burst(p.x, p.y, "#ff7a2a", 26);
        this.burst(p.x, p.y, "#ffd34a", 14);
        break;
      case "wind":
        for (const o of this.near(b, 150))
          this.push(o, Math.sign(o.position.x - p.x || 1) * 3.6, -0.6);
        for (let i = 0; i < 14; i++)
          this.fx.push({
            x: p.x,
            y: p.y + (Math.random() - 0.5) * T.r,
            vx: (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 4),
            vy: 0,
            life: 22,
            col: "#e6f2ff",
            s: 3,
            kind: "streak",
          });
        break;
      case "zap": {
        // 가장 가까운 같은 단계 공을 번개로 끌어당김 → 연쇄 유도
        let best: Body | null = null,
          bd = 280;
        for (const o of this.balls)
          if (o !== b && o.tier === b.tier) {
            const d = Math.hypot(o.position.x - p.x, o.position.y - p.y);
            if (d < bd) {
              bd = d;
              best = o;
            }
          }
        if (best) {
          const dx = p.x - best.position.x,
            dy = p.y - best.position.y,
            d = Math.hypot(dx, dy) || 1;
          this.push(best, (dx / d) * 7, (dy / d) * 7);
          this.bolts.push({ a: { ...p }, b: { ...best.position }, life: 18 });
        } else this.bolts.push({ a: { x: p.x, y: 0 }, b: { ...p }, life: 14 });
        break;
      }
      case "whip":
        for (const o of this.near(b, 170)) {
          const dx = p.x - o.position.x,
            dy = p.y - o.position.y,
            d = Math.hypot(dx, dy) || 1;
          this.push(o, (dx / d) * 3.4, (dy / d) * 3.4);
        }
        this.fx.push({
          x: p.x,
          y: p.y,
          vx: 0,
          vy: 0,
          r0: T.r,
          life: 16,
          col: "#e86fa8",
          s: 0,
          kind: "wave",
        });
        break;
      case "quake":
        for (const o of this.balls) this.push(o, (Math.random() - 0.5) * 2, -2 - Math.random() * 2);
        this.shake = 16;
        break;
      case "pause":
        this.engine.timing.timeScale = 0.3;
        this.slowUntil = performance.now() + 2200;
        break;
    }
  }

  private burst(x: number, y: number, col: string, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28,
        s = 1.5 + Math.random() * 4;
      this.fx.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 1,
        life: 26 + Math.random() * 14,
        col,
        s: 3 + Math.random() * 3,
      });
    }
  }
  private confetti(x: number, y: number) {
    const cols = ["#ffcf4a", "#ff4d6d", "#7fd3ff", "#b48cff", "#7dffb0"];
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * 6.28,
        s = 2 + Math.random() * 7;
      this.fx.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 3,
        life: 60 + Math.random() * 30,
        col: cols[i % 5],
        s: 4,
        grav: 0.12,
      });
    }
  }
  private pop(x: number, y: number, s: string, col: string, size: number) {
    this.texts.push({ x, y, s, col, size, life: 50 });
  }

  private end() {
    this.dead = true;
    this.hooks.sfx?.("over");
    this.hooks.onOver?.({
      score: this.score,
      drops: this.drops,
      maxTier: this.maxTier,
      time: Math.max(0.1, Math.round((performance.now() - this.startedAt) / 100) / 10),
      trophies: this.trophies,
    });
  }

  private loop = (now: number) => {
    const dt = Math.min(50, now - this.last);
    this.last = now;
    if (!this.dead && !this.paused) {
      this.acc += dt;
      while (this.acc >= 1000 / 60) {
        this.M.Engine.update(this.engine, 1000 / 60);
        this.merges();
        this.acc -= 1000 / 60;
      }
      if (this.slowUntil && now > this.slowUntil) {
        this.engine.timing.timeScale = 1;
        this.slowUntil = 0;
      }
      // 넘침: 떨어진 지 1.2초 넘은 공 하나라도 선 위에 있으면 시간이 쌓이고, 다 내려가면 천천히 줄어듦
      // (공이 튀어서 잠깐 내려갔다 올라오기를 반복해도 끝나게)
      let above = false,
        near = false;
      for (const b of this.balls) {
        const top = b.position.y - TIERS[b.tier].r;
        const old = now - b.born > 1200;
        b.over = old && top < LINE_Y ? b.over + dt : 0;
        if (b.over > 0) above = true;
        if (old && top < LINE_Y + 50) near = true;
      }
      this.overMs = above ? this.overMs + dt : Math.max(0, this.overMs - dt * 0.5);
      this.danger = near || this.overMs > 0 ? this.danger + dt : 0;
      if (this.overMs > OVER_MS) this.end();
    }
    this.render(now);
    this.raf = requestAnimationFrame(this.loop);
  };

  // ───── 그리기 ─────
  drawBall(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    t: number,
    ang = 0,
    alpha = 1
  ) {
    const im = this.imgs[t];
    c.save();
    c.globalAlpha = alpha;
    c.translate(x, y);
    c.rotate(ang);
    if (im && im.complete && im.naturalWidth)
      c.drawImage(im, -r * 1.02, -r * 1.02, r * 2.04, r * 2.04);
    else {
      c.fillStyle = TIERS[t].col;
      c.beginPath();
      c.arc(0, 0, r, 0, 7);
      c.fill();
      c.lineWidth = Math.max(2, r * 0.08);
      c.strokeStyle = "#141020";
      c.stroke();
    }
    c.restore();
  }

  private render(now: number) {
    const c = this.ctx;
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    let sx = 0,
      sy = 0;
    if (this.shake > 0) {
      sx = (Math.random() - 0.5) * this.shake;
      sy = (Math.random() - 0.5) * this.shake;
      this.shake *= 0.85;
      if (this.shake < 0.5) this.shake = 0;
    }
    c.translate(sx, sy);
    // 병
    c.fillStyle = "#120f1c";
    c.fillRect(-20, -20, W + 40, H + 40);
    c.fillStyle = "#221d36";
    c.fillRect(WALL, 0, W - WALL * 2, H - WALL);
    c.fillStyle = "rgba(255,255,255,.03)";
    for (let gx = WALL; gx < W - WALL; gx += 20)
      for (let gy = 0; gy < H - WALL; gy += 20)
        if (((gx + gy) / 20) % 2 === 0) c.fillRect(gx, gy, 20, 20);
    c.fillStyle = "#3a3358";
    c.fillRect(0, 0, WALL, H);
    c.fillRect(W - WALL, 0, WALL, H);
    c.fillRect(0, H - WALL, W, WALL);
    c.fillStyle = "#4b4370";
    c.fillRect(WALL - 4, 0, 4, H - WALL);
    c.fillRect(W - WALL, 0, 4, H - WALL);
    c.fillRect(WALL - 4, H - WALL, W - WALL * 2 + 8, 4);
    // 넘침 선
    const blink = this.danger > 0 ? (Math.floor(now / 160) % 2 ? 0.95 : 0.35) : 0.25;
    c.fillStyle = this.danger > 0 ? `rgba(255,77,109,${blink})` : `rgba(155,147,184,${blink})`;
    for (let x = WALL; x < W - WALL; x += 16) c.fillRect(x, LINE_Y - 1, 9, 3);
    // 겨냥선 + 들고 있는 공
    if (!this.dead) {
      const x = this.clampX(this.cur);
      c.fillStyle = "rgba(255,255,255,.12)";
      for (let y = TOP_Y + TIERS[this.cur].r; y < H - WALL; y += 14) c.fillRect(x - 1, y, 2, 7);
      this.drawBall(c, x, TOP_Y, TIERS[this.cur].r, this.cur, 0, this.canDrop ? 1 : 0.45);
    }
    for (const b of this.balls) {
      this.drawBall(c, b.position.x, b.position.y, TIERS[b.tier].r, b.tier, b.angle);
      if (b.over > 0) {
        c.strokeStyle = `rgba(255,77,109,${0.4 + 0.4 * Math.sin(now / 80)})`;
        c.lineWidth = 3;
        c.beginPath();
        c.arc(b.position.x, b.position.y, TIERS[b.tier].r + 3, 0, 7);
        c.stroke();
      }
    }
    // 번개
    this.bolts = this.bolts.filter((z) => z.life-- > 0);
    for (const z of this.bolts) {
      c.strokeStyle = `rgba(255,236,120,${z.life / 18})`;
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(z.a.x, z.a.y);
      for (let i = 1; i < 8; i++) {
        const k = i / 8;
        c.lineTo(
          z.a.x + (z.b.x - z.a.x) * k + (Math.random() - 0.5) * 22,
          z.a.y + (z.b.y - z.a.y) * k + (Math.random() - 0.5) * 22
        );
      }
      c.lineTo(z.b.x, z.b.y);
      c.stroke();
    }
    // 입자
    this.fx = this.fx.filter((p) => p.life-- > 0);
    for (const p of this.fx) {
      if (p.kind === "wave") {
        c.strokeStyle = p.col;
        c.globalAlpha = p.life / 16;
        c.lineWidth = 4;
        c.beginPath();
        c.arc(p.x, p.y, (p.r0 ?? 0) + (16 - p.life) * 8, 0, 7);
        c.stroke();
        c.globalAlpha = 1;
        continue;
      }
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.grav ?? (p.kind === "ring" ? -0.02 : 0.15);
      if (p.kind === "streak") p.vx *= 0.92;
      c.globalAlpha = Math.min(1, p.life / 20);
      c.fillStyle = p.col;
      if (p.kind === "ring") {
        c.strokeStyle = p.col;
        c.lineWidth = 2;
        c.beginPath();
        c.arc(p.x, p.y, p.s, 0, 7);
        c.stroke();
      } else if (p.kind === "streak") c.fillRect(p.x, p.y, 12, 2);
      else c.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
      c.globalAlpha = 1;
    }
    // 글자
    this.texts = this.texts.filter((t) => t.life-- > 0);
    c.textAlign = "center";
    for (const t of this.texts) {
      t.y -= 0.6;
      c.globalAlpha = Math.min(1, t.life / 20);
      c.font = `${t.size}px "Galmuri11", "Do Hyeon", sans-serif`;
      c.lineWidth = 4;
      c.strokeStyle = "#0d0b14";
      c.strokeText(t.s, t.x, t.y);
      c.fillStyle = t.col;
      c.fillText(t.s, t.x, t.y);
      c.globalAlpha = 1;
    }
    if (this.slowUntil) {
      c.fillStyle = "rgba(107,91,214,.12)";
      c.fillRect(WALL, 0, W - WALL * 2, H - WALL);
      c.fillStyle = "#b8adff";
      c.font = '16px "Galmuri11", monospace';
      c.fillText("|| PAUSE?", W / 2, 96);
    }
  }
}
