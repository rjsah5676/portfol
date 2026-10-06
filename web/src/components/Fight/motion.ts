/**
 * 격투 캐릭터 움직임 연출 (그리기 전용) — 그림 프레임은 적어도 동작이 매끄럽게 보이게.
 *
 * 시트 그림은 동작마다 한두 장뿐이라, 발을 기준으로 살짝 늘이고·찌그러뜨리고·기울이고·밀어서
 * 숨쉬기 / 걸을 때 출렁임 / 뛸 때 늘어남·착지 찌그러짐 / 공격 전 움츠림 → 칠 때 앞으로 / 맞을 때 젖혀짐 /
 * 돌아설 때 빠른 뒤집기 / 그림이 바뀔 때 잔상(스미어) / 대시·돌진 잔상을 만든다.
 * 시뮬레이션 상태는 읽기만 함 (판정·결과에는 영향 없음).
 */
import { CHARS } from "@/lib/fight/chars";
import { finishRec, isAir, type Fighter, type State } from "@/lib/fight/sim";
import type { FrameRect } from "@/lib/fight/sprites";

/** 발 기준 변형: 밀기(px)·기울기(rad)·가로세로 배율·보이는 방향(-1~1, 돌아서는 중엔 사이 값) */
export interface Pose {
  dx: number;
  dy: number;
  rot: number;
  sx: number;
  sy: number;
  faceVis: number;
}

export interface Ghost {
  x: number;
  y: number;
  rect: FrameRect;
  pose: Pose;
  a: number;
}

const easeOut = (k: number) => 1 - (1 - k) * (1 - k);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 돌아서는 데 걸리는 프레임 (짧게 — 방향키 우선이라 굼떠 보이면 안 됨) */
const TURN_STEP = 0.67;
const LAND_T = 7;
const TAKEOFF_T = 6;
const RECOIL_T = 10;
const SMEAR_T = 3;

export class Motion {
  private lastF = -1;
  faceVis = 1;
  private prevAir = false;
  private land = 0;
  private takeoff = 0;
  private recoil = 0;
  private prevKey = "";
  private prevRect: FrameRect | null = null;
  smear = 0;
  smearRect: FrameRect | null = null;
  ghosts: Ghost[] = [];
  /** 상태가 바뀐 직후 잠깐 보여 줄 그림 (착지·대시 멈춤·급강하 착지) — 시트에 그 동작이 있을 때만 */
  after: { name: string; t: number; dur: number } | null = null;
  /** 그림 효과 생성 요청 (render 가 꺼내 씀) */
  spawn: { name: string; dx: number; dy: number }[] = [];
  private prevSt = "";
  private prevAirS = false;
  pose: Pose = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, faceVis: 1 };

  /** 그릴 때마다 호출. 시뮬 프레임이 넘어간 만큼만 상태를 진행 */
  update(f: Fighter, s: State, key: string, rect: FrameRect, x: number, y: number) {
    if (this.lastF < 0 || s.f < this.lastF || s.f - this.lastF > 30) {
      // 처음 / 새 라운드 / 오래 멈췄다 옴
      this.faceVis = f.face;
      this.prevAir = isAir(s, f);
      this.land = this.takeoff = this.recoil = this.smear = 0;
      this.ghosts = [];
      this.prevKey = key;
      this.prevRect = rect;
      this.lastF = s.f;
    }
    const steps = Math.min(4, s.f - this.lastF);
    for (let n = 0; n < steps; n++) this.tick(f, s, key, rect, x, y);
    this.lastF = s.f;
    this.pose = this.compute(f, s);
  }

  private tick(f: Fighter, s: State, key: string, rect: FrameRect, x: number, y: number) {
    // 돌아서기
    if (this.faceVis !== f.face) {
      this.faceVis =
        f.face > 0 ? Math.min(1, this.faceVis + TURN_STEP) : Math.max(-1, this.faceVis - TURN_STEP);
    }
    const air = isAir(s, f);
    if (this.prevAir && !air) this.land = LAND_T;
    // 잠깐 그림
    if (this.after) {
      this.after.t++;
      if (this.after.t >= this.after.dur || (f.st !== "idle" && f.st !== "walk")) this.after = null;
    }
    if (!air && (f.st === "idle" || f.st === "walk")) {
      if (this.prevAirS) {
        this.after = { name: "SairLand", t: 0, dur: 20 };
        this.spawn.push({ name: "dust", dx: 0, dy: 0 });
      } else if (this.prevAir && this.prevSt === "jump") {
        this.after = { name: "land", t: 0, dur: 7 };
        this.spawn.push({ name: "dust", dx: 0, dy: 0 });
      } else if (this.prevSt === "dash" && f.st === "idle") this.after = { name: "dashEnd", t: 0, dur: 7 };
    }
    // 필살기 마지막 타: 앞쪽에 큰 충격파
    if (f.st === "atk" && f.mv === "X") {
      const xm = CHARS[f.ch].moves.X;
      if (xm.multi && f.t === xm.startup + xm.active - 2) this.spawn.push({ name: "burst", dx: 46, dy: 0 });
    }
    this.prevSt = f.st;
    this.prevAirS = f.st === "atk" && f.mv === "S" && air;
    if (!this.prevAir && air && f.vh > 0) this.takeoff = TAKEOFF_T;
    this.prevAir = air;
    if (this.land > 0) this.land--;
    if (this.takeoff > 0) this.takeoff--;
    if (f.st === "hit" && f.t <= 1) this.recoil = RECOIL_T;
    else if (this.recoil > 0) this.recoil--;
    // 그림이 바뀌면 직전 그림을 잠깐 겹쳐 그림 (움직임 번짐) — 반복 동작(서기·걷기)은 원래 이어지는 그림이라 제외
    if (key !== this.prevKey) {
      const loopSt = f.st === "idle" || f.st === "walk";
      if (!loopSt && this.prevRect) {
        this.smearRect = this.prevRect;
        this.smear = SMEAR_T;
      }
      this.prevKey = key;
      this.prevRect = rect;
    } else if (this.smear > 0) this.smear--;
    // 잔상: 대시·돌진·연타 돌진 중
    const m = f.st === "atk" && f.mv ? CHARS[f.ch].moves[f.mv] : null;
    const fast =
      f.st === "dash" ||
      (f.st === "jump" && f.dashT > 0) ||
      (!!m && (!!m.rush || !!m.lunge) && f.t >= m.startup && f.t < m.startup + m.active + 4);
    for (const g of this.ghosts) g.a -= 0.08;
    this.ghosts = this.ghosts.filter((g) => g.a > 0.02);
    if (fast && s.f % 2 === 0) {
      this.ghosts.push({ x, y, rect, pose: { ...this.pose }, a: 0.42 });
      if (this.ghosts.length > 5) this.ghosts.shift();
    }
  }

  private compute(f: Fighter, s: State): Pose {
    const c = CHARS[f.ch];
    const face = f.face;
    let dx = 0,
      dy = 0,
      rot = 0,
      sx = 1,
      sy = 1;
    switch (f.st) {
      case "idle": {
        // 숨쉬기
        const b = Math.sin((s.f + f.ch * 13) * 0.075);
        sy = 1 + 0.014 * b;
        sx = 1 - 0.008 * b;
        break;
      }
      case "walk": {
        const ph = f.t * 0.22;
        dy = -Math.abs(Math.sin(ph)) * 1.3;
        rot = Math.sign(f.vx || face) * 0.035;
        break;
      }
      case "dash":
        rot = face * 0.1;
        sx = 1.05;
        sy = 0.96;
        break;
      case "jump": {
        if (f.dashT > 0) {
          rot = face * 0.1;
          sx = 1.04;
          sy = 0.97;
        } else {
          const v = clamp(f.vh / 2650, -0.6, 1);
          sy = 1 + v * 0.07;
          sx = 1 - v * 0.045;
          rot = clamp(f.vx / Math.max(1, c.jumpVx), -1, 1) * 0.07;
        }
        break;
      }
      case "atk": {
        const m = c.moves[f.mv as keyof typeof c.moves];
        if (!m) break;
        const st = Math.max(1, m.startup);
        const act = m.active;
        const total = m.startup + m.active + m.recovery + finishRec(f);
        const big = f.mv === "H" || f.mv === "K" || f.mv === "S" || f.mv === "X" ? 1.35 : 1;
        if (f.t < m.startup) {
          // 움츠림 (뒤로 살짝 + 몸을 낮춤)
          const k = easeOut(f.t / st);
          dx = -face * 2.2 * k * big;
          rot = -face * 0.05 * k * big;
          sy = 1 - 0.03 * k;
          sx = 1 + 0.02 * k;
        } else if (f.t < m.startup + act) {
          // 침: 앞으로 뻗음
          dx = face * 2.8 * big;
          rot = face * 0.06 * big;
          sx = 1 + 0.06 * big;
          sy = 1 - 0.025 * big;
        } else {
          // 돌아옴
          const rec = Math.max(1, total - m.startup - act);
          const k = 1 - easeOut(clamp((f.t - m.startup - act) / rec, 0, 1));
          dx = face * 2.8 * big * k;
          rot = face * 0.06 * big * k;
          sx = 1 + 0.06 * big * k;
          sy = 1 - 0.025 * big * k;
        }
        break;
      }
      case "hit": {
        const k = this.recoil / RECOIL_T;
        const air = isAir(s, f);
        dx = (s.f % 2 ? 1 : -1) * 1.4 * k - face * 2 * k;
        rot = -face * ((air ? 0.22 : 0.12) * Math.max(k, air ? 0.5 : 0));
        sx = 1 - 0.04 * k;
        sy = 1 + 0.03 * k;
        break;
      }
      case "block": {
        const k = f.stun > 0 ? Math.min(1, f.stun / 8) : 0;
        dx = -face * 1.4 * k;
        rot = -face * 0.035 * k;
        sy = 1 - 0.035 * k;
        sx = 1 + 0.025 * k;
        break;
      }
      case "win":
        // 처음엔 통통 튀고, 그 뒤로는 천천히 들썩임
        dy = f.t < 90 ? -Math.abs(Math.sin(f.t * 0.12)) * 2 * (1 - f.t / 90) : -Math.abs(Math.sin(f.t * 0.05)) * 0.8;
        sy = 1 + 0.012 * Math.sin(f.t * 0.07);
        break;
      default:
        break;
    }
    if (this.land > 0) {
      const k = this.land / LAND_T;
      sy *= 1 - 0.16 * k;
      sx *= 1 + 0.12 * k;
    }
    if (this.takeoff > 0) {
      const k = this.takeoff / TAKEOFF_T;
      sy *= 1 + 0.1 * k;
      sx *= 1 - 0.07 * k;
    }
    return { dx, dy, rot, sx, sy, faceVis: this.faceVis };
  }
}
