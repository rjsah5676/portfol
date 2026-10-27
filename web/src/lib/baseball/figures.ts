/**
 * 선수 리그 (타석: 등 보이는 타자 · 마운드: 정면 투수) + 애니 + 자리표시 파츠.
 *
 * 파츠(슬롯 → 붙임 이름)
 *   타자: legR · legF(바지) · shoeR · shoeF · armR_up · armR_lo · torso(유니폼 상의 · 등번호) · head(머리카락) · helmet
 *         · armF_up · armF_lo · gloveF · gloveR · bat
 *   투수: legL · legR · shoeL · shoeR · torso · armL(글러브 팔) · glove · head(얼굴) · cap · armT_up · armT_lo · handT
 * 장비를 바꾸면 그 슬롯 붙임만 바꿈 (helmet · bat · gloveF/gloveR · shoe* · cap · glove).
 * 나중에 파츠 그림을 받으면 Skin 의 shape 붙임을 image 붙임으로 바꾸면 끝 — 뼈 · 애니는 그대로.
 */
import type { Anim, Attachment, RigColors, RigDef, Skin } from "./rig";

// ───────────── 타자 (우타자 기준 · 화면 오른쪽 = 홈플레이트 쪽) ─────────────
export const BATTER_RIG: RigDef = {
  id: "batter",
  bones: [
    { id: "root", x: 0, y: 0, rot: 0, len: 0 },
    { id: "spine", parent: "root", x: 0, y: 0, rot: -90, len: 40 },
    { id: "chest", parent: "spine", x: 36, y: 0, rot: 0, len: 6 },
    { id: "head", parent: "chest", x: 8, y: 1, rot: 0, len: 60 },
    // 뒤팔(오른팔 · 카메라 쪽)
    { id: "armR_up", parent: "chest", x: 2, y: -15, rot: -116, len: 24 },
    { id: "armR_lo", parent: "armR_up", x: 24, y: 0, rot: 157, len: 22 },
    // 앞팔(왼팔)
    { id: "armF_up", parent: "chest", x: 0, y: 12, rot: -26, len: 24 },
    { id: "armF_lo", parent: "armF_up", x: 24, y: 0, rot: -92, len: 22 },
    { id: "hands", parent: "armF_lo", x: 22, y: 0, rot: 0, len: 5 },
    { id: "bat", parent: "hands", x: 2, y: 0, rot: 97, len: 100 },
    { id: "legR", parent: "root", x: -11, y: 3, rot: 110, len: 30 },
    { id: "shinR", parent: "legR", x: 30, y: 0, rot: -25, len: 28 },
    { id: "footR", parent: "shinR", x: 28, y: 0, rot: -85, len: 18 },
    { id: "legF", parent: "root", x: 9, y: 3, rot: 72, len: 30 },
    { id: "shinF", parent: "legF", x: 30, y: 0, rot: 22, len: 28 },
    { id: "footF", parent: "shinF", x: 28, y: 0, rot: -94, len: 18 },
  ],
  slots: [
    { id: "legR", bone: "legR", attach: "thigh" },
    { id: "shinR", bone: "shinR", attach: "shin" },
    { id: "footR", bone: "footR", attach: "shoe" },
    { id: "legF", bone: "legF", attach: "thigh" },
    { id: "shinF", bone: "shinF", attach: "shin" },
    { id: "footF", bone: "footF", attach: "shoe" },
    { id: "armF_up", bone: "armF_up", attach: "sleeve" },
    { id: "armF_lo", bone: "armF_lo", attach: "forearm" },
    { id: "torso", bone: "spine", attach: "jerseyBack" },
    { id: "bat", bone: "bat", attach: "bat" },
    { id: "head", bone: "head", attach: "hairBack" },
    { id: "helmet", bone: "head", attach: "helmet" },
    { id: "hands", bone: "hands", attach: "gloves" },
    { id: "armR_up", bone: "armR_up", attach: "sleeve" },
    { id: "armR_lo", bone: "armR_lo", attach: "forearm" },
  ],
};

/** 타자 애니: 대기(배트 까딱) */
export const BAT_IDLE: Anim = {
  dur: 1.6,
  loop: true,
  tracks: {
    armF_up: [{ t: 0, r: 0 }, { t: 0.8, r: 6 }, { t: 1.6, r: 0 }],
    armF_lo: [{ t: 0, r: 0 }, { t: 0.8, r: -4 }, { t: 1.6, r: 0 }],
    armR_up: [{ t: 0, r: 0 }, { t: 0.8, r: 18 }, { t: 1.6, r: 0 }],
    armR_lo: [{ t: 0, r: 0 }, { t: 0.8, r: 0 }, { t: 1.6, r: 0 }],
    bat: [{ t: 0, r: 0 }, { t: 0.8, r: 7 }, { t: 1.6, r: 0 }],
    spine: [{ t: 0, r: 0 }, { t: 0.8, r: -2 }, { t: 1.6, r: 0 }],
    root: [{ t: 0, y: 0 }, { t: 0.8, y: 2 }, { t: 1.6, y: 0 }],
  },
};

/** 다리 들기 (투수가 던지기 시작하면) */
export const BAT_LOAD: Anim = {
  dur: 0.35,
  loop: false,
  tracks: {
    legF: [{ t: 0, r: 0 }, { t: 0.2, r: -28 }, { t: 0.35, r: -10 }],
    shinF: [{ t: 0, r: 0 }, { t: 0.2, r: 40 }, { t: 0.35, r: 10 }],
    root: [{ t: 0, x: 0 }, { t: 0.35, x: -6 }],
    spine: [{ t: 0, r: 0 }, { t: 0.35, r: -6 }],
    armF_up: [{ t: 0, r: 0 }, { t: 0.35, r: -6 }],
    armF_lo: [{ t: 0, r: 0 }, { t: 0.35, r: 5 }],
    armR_up: [{ t: 0, r: 0 }, { t: 0.35, r: -11 }],
    armR_lo: [{ t: 0, r: 0 }, { t: 0.35, r: -2 }],
    bat: [{ t: 0, r: 0 }, { t: 0.35, r: -13 }],
  },
};

/**
 * 스윙 누르고 공 맞기까지 (초). 실제 프로 다운스윙은 0.15초쯤(Blast Motion time to contact)이지만
 * 그대로 두면 공이 6m 넘게 남았을 때(보통 속도 비행의 2/3) 눌러야 PERFECT 라 「보고 나가면」 못 맞힘 → 게임용으로 0.06초 (공 2.6m쯤 남았을 때).
 * 스윙 그림은 batterSprite 가 임팩트 칸이 이 시간에 오게 줄여서 돌림.
 * 아래 BAT_SWING 리그 키(0.07에 맞춤)는 그림이 안 왔을 때만 쓰는 예비라 그대로 둠.
 */
export const SWING_HIT_T = 0.06;
export const BAT_SWING: Anim = {
  dur: 0.55,
  loop: false,
  tracks: {
    root: [{ t: 0, x: -6, e: "fast" }, { t: 0.07, x: 6 }, { t: 0.55, x: 8 }],
    spine: [{ t: 0, r: -6, e: "fast" }, { t: 0.07, r: 6 }, { t: 0.25, r: 14 }, { t: 0.55, r: 12 }],
    legF: [{ t: 0, r: -10, e: "fast" }, { t: 0.07, r: 4 }, { t: 0.55, r: 4 }],
    shinF: [{ t: 0, r: 10 }, { t: 0.07, r: -8 }, { t: 0.55, r: -8 }],
    legR: [{ t: 0, r: 0 }, { t: 0.1, r: -14 }, { t: 0.55, r: -16 }],
    shinR: [{ t: 0, r: 0 }, { t: 0.1, r: 30 }, { t: 0.55, r: 34 }],
    footR: [{ t: 0, r: 0 }, { t: 0.1, r: 40 }, { t: 0.55, r: 46 }],
    armF_up: [{ t: 0, r: -6, e: "lin" }, { t: 0.035, r: -4, e: "lin" }, { t: 0.07, r: -116 }, { t: 0.14, r: -239 }, { t: 0.25, r: -328 }, { t: 0.55, r: -380 }],
    armF_lo: [{ t: 0, r: 5, e: "lin" }, { t: 0.035, r: -26, e: "lin" }, { t: 0.07, r: -77 }, { t: 0.14, r: -66 }, { t: 0.25, r: -4 }, { t: 0.55, r: 67 }],
    armR_up: [{ t: 0, r: -11, e: "lin" }, { t: 0.035, r: -106, e: "lin" }, { t: 0.07, r: -183 }, { t: 0.14, r: -208 }, { t: 0.25, r: -291 }, { t: 0.55, r: -338 }],
    armR_lo: [{ t: 0, r: -2, e: "lin" }, { t: 0.035, r: 17, e: "lin" }, { t: 0.07, r: -49 }, { t: 0.14, r: -52 }, { t: 0.25, r: -25 }, { t: 0.55, r: -37 }],
    bat: [{ t: 0, r: -13, sx: 1, e: "lin" }, { t: 0.035, r: 74, sx: 1, e: "lin" }, { t: 0.07, r: -57, sx: 1 }, { t: 0.14, r: 37, sx: 0.3 }, { t: 0.25, r: 91, sx: -0.75 }, { t: 0.55, r: 90, sx: -0.9 }],
  },
};

/** 번트 자세 */
export const BAT_BUNT: Anim = {
  dur: 0.2,
  loop: false,
  tracks: {
    spine: [{ t: 0, r: 0 }, { t: 0.2, r: 10 }],
    root: [{ t: 0, y: 0 }, { t: 0.2, y: 8 }],
    armF_up: [{ t: 0, r: 0 }, { t: 0.2, r: 120 }],
    armF_lo: [{ t: 0, r: 0 }, { t: 0.2, r: -74 }],
    armR_up: [{ t: 0, r: 0 }, { t: 0.2, r: 154 }],
    armR_lo: [{ t: 0, r: 0 }, { t: 0.2, r: -46 }],
    bat: [{ t: 0, r: 0 }, { t: 0.2, r: 71 }],
  },
};

// ───────────── 투수 (정면) ─────────────
export const PITCHER_RIG: RigDef = {
  id: "pitcher",
  bones: [
    { id: "root", x: 0, y: 0, rot: 0, len: 0 },
    { id: "spine", parent: "root", x: 0, y: 0, rot: -90, len: 36 },
    { id: "chest", parent: "spine", x: 33, y: 0, rot: 0, len: 6 },
    { id: "head", parent: "chest", x: 8, y: 0, rot: 0, len: 56 },
    // 글러브 팔 (화면 왼쪽 = 우투수의 왼팔)
    { id: "armG_up", parent: "chest", x: -2, y: -16, rot: -160, len: 22 },
    { id: "armG_lo", parent: "armG_up", x: 22, y: 0, rot: 20, len: 20 },
    { id: "glove", parent: "armG_lo", x: 20, y: 0, rot: 0, len: 8 },
    // 던지는 팔 (화면 오른쪽)
    { id: "armT_up", parent: "chest", x: -2, y: 16, rot: 160, len: 22 },
    { id: "armT_lo", parent: "armT_up", x: 22, y: 0, rot: -20, len: 20 },
    { id: "handT", parent: "armT_lo", x: 20, y: 0, rot: 0, len: 6 },
    { id: "legG", parent: "root", x: -10, y: 3, rot: 96, len: 28 },
    { id: "shinG", parent: "legG", x: 28, y: 0, rot: -4, len: 26 },
    { id: "footG", parent: "shinG", x: 26, y: 0, rot: 84, len: 14 },
    { id: "legT", parent: "root", x: 10, y: 3, rot: 84, len: 28 },
    { id: "shinT", parent: "legT", x: 28, y: 0, rot: 4, len: 26 },
    { id: "footT", parent: "shinT", x: 26, y: 0, rot: -84, len: 14 },
  ],
  slots: [
    { id: "legG", bone: "legG", attach: "thigh" },
    { id: "shinG", bone: "shinG", attach: "shin" },
    { id: "footG", bone: "footG", attach: "shoe" },
    { id: "legT", bone: "legT", attach: "thigh" },
    { id: "shinT", bone: "shinT", attach: "shin" },
    { id: "footT", bone: "footT", attach: "shoe" },
    { id: "armG_up", bone: "armG_up", attach: "sleeve" },
    { id: "armG_lo", bone: "armG_lo", attach: "forearm" },
    { id: "torso", bone: "spine", attach: "jerseyFront" },
    { id: "glove", bone: "glove", attach: "mitt" },
    { id: "head", bone: "head", attach: "face" },
    { id: "cap", bone: "head", attach: "cap" },
    { id: "armT_up", bone: "armT_up", attach: "sleeve" },
    { id: "armT_lo", bone: "armT_lo", attach: "forearm" },
    { id: "handT", bone: "handT", attach: "hand" },
  ],
};

export const PIT_IDLE: Anim = {
  dur: 2,
  loop: true,
  tracks: {
    root: [{ t: 0, y: 0 }, { t: 1, y: 1.5 }, { t: 2, y: 0 }],
    armG_lo: [{ t: 0, r: 0 }, { t: 1, r: 6 }, { t: 2, r: 0 }],
  },
};

/**
 * 와인드업 시작(첫 움직임) → 공 놓기. 실제 세트 포지션 투구는 레그킥이면 첫 움직임 → 포수 미트(time to plate) 1.4~1.8초,
 * 슬라이드 스텝 1.0초대 — 공이 날아가는 0.4초 남짓을 빼면 놓기까지 약 1.0~1.4초. 보통 레그킥 쪽인 1.1초.
 * 투구 줄(pitcher-throw)은 다리 최고점 0.45 · 디딤발 착지 0.95 · 놓기 1.10 (착지 → 놓기 0.15초 = 팔 코킹 + 가속)
 */
export const PITCH_RELEASE_T = 1.1;
/** 코드 리그 투구 애니(PIT_THROW, 그림 없을 때만)는 0.74초에 놓도록 짜여 있음 — 그릴 땐 시간을 이 비율로 줄여서 씀 */
export const PIT_RIG_RELEASE_T = 0.74;
/** 코드 리그 투구: 0 ~ 0.55 와인드업(다리 들기) · 0.55 ~ 0.8 팔 휘두름 · 0.74 에 공 놓음 */
export const PIT_THROW: Anim = {
  dur: 1.1,
  loop: false,
  tracks: {
    // 두 손 모아 가슴 → 다리 들기 → 내딛으며 팔 휘두르기
    armG_up: [{ t: 0, r: 0 }, { t: 0.3, r: 90 }, { t: 0.55, r: 40 }, { t: 0.74, r: -30 }, { t: 1.1, r: -10 }],
    armG_lo: [{ t: 0, r: 0 }, { t: 0.3, r: 60 }, { t: 0.55, r: 20 }, { t: 0.74, r: 40 }, { t: 1.1, r: 20 }],
    armT_up: [{ t: 0, r: 0 }, { t: 0.3, r: -80 }, { t: 0.55, r: 40, e: "fast" }, { t: 0.66, r: 150, e: "fast" }, { t: 0.74, r: 250 }, { t: 0.9, r: 300 }, { t: 1.1, r: 300 }],
    armT_lo: [{ t: 0, r: 0 }, { t: 0.3, r: -70 }, { t: 0.55, r: -60 }, { t: 0.66, r: -40 }, { t: 0.74, r: 0 }, { t: 1.1, r: 10 }],
    legG: [{ t: 0, r: 0 }, { t: 0.18, r: 0 }, { t: 0.45, r: -78 }, { t: 0.62, r: -40 }, { t: 0.74, r: -14 }, { t: 1.1, r: -10 }],
    shinG: [{ t: 0, r: 0 }, { t: 0.45, r: 70 }, { t: 0.62, r: 30 }, { t: 0.74, r: 8 }, { t: 1.1, r: 6 }],
    legT: [{ t: 0, r: 0 }, { t: 0.55, r: 0 }, { t: 0.74, r: 20 }, { t: 1.1, r: 30 }],
    shinT: [{ t: 0, r: 0 }, { t: 0.74, r: 30 }, { t: 1.1, r: 50 }],
    spine: [{ t: 0, r: 0 }, { t: 0.45, r: 6 }, { t: 0.62, r: -4 }, { t: 0.78, r: -22 }, { t: 1.1, r: -16 }],
    root: [{ t: 0, y: 0, x: 0 }, { t: 0.45, y: -6, x: 2 }, { t: 0.74, y: 10, x: -4 }, { t: 1.1, y: 8, x: -4 }],
  },
};

// ───────────── 자리표시 파츠 (코드 도형) ─────────────
type P = (ctx: CanvasRenderingContext2D, c: RigColors) => void;
const shape = (paint: P): Attachment => ({ kind: "shape", paint: (ctx, c) => paint(ctx, c) });

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
const OUT = "rgba(10,12,22,0.9)";

/** 뼈 길이 방향(+x)으로 뻗은 통(팔 · 다리) — 길이는 뼈를 따라감 (SD 라 굵고 짧게) */
const limb = (w0: number, w1: number, fill: (c: RigColors) => string, stripe?: (c: RigColors) => string): Attachment => ({
  kind: "shape",
  paint: (ctx, c, bone) => {
    const len = bone.len;
    ctx.beginPath();
    ctx.moveTo(-2, -w0 / 2);
    ctx.lineTo(len + 2, -w1 / 2);
    ctx.quadraticCurveTo(len + w1 / 2 + 2, 0, len + 2, w1 / 2);
    ctx.lineTo(-2, w0 / 2);
    ctx.quadraticCurveTo(-w0 / 2 - 2, 0, -2, -w0 / 2);
    ctx.fillStyle = fill(c);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = OUT;
    ctx.stroke();
    if (stripe) {
      ctx.fillStyle = stripe(c);
      ctx.fillRect(len * 0.62, -w1 / 2 + 1, len * 0.22, w1 - 2);
    }
  },
});
/** 머리 파츠는 SD 비율로 크게 (원래 그림 기준 1.55배) */
const HEAD = 1.55;
export const HEAD_SCALE = HEAD;
const headShape = (paint: P): Attachment =>
  shape((ctx, c) => {
    ctx.scale(HEAD, HEAD);
    paint(ctx, c);
  });

/** 뒷목 — 머리선이 둥글게 올라간 모양 (네모 패치처럼 안 보이게) · 양옆만 선 */
export function neckBack(ctx: CanvasRenderingContext2D, c: RigColors, top = -3) {
  ctx.beginPath();
  ctx.moveTo(-8, 2);
  ctx.lineTo(-7, top + 3);
  ctx.quadraticCurveTo(0, top - 4, 7, top + 3);
  ctx.lineTo(8, 2);
  ctx.closePath();
  ctx.fillStyle = c.skin;
  ctx.fill();
  // 머리카락 아래 그늘
  ctx.fillStyle = "rgba(60,30,20,0.18)";
  ctx.fillRect(-8, top + 1, 16, 3);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = OUT;
  ctx.beginPath();
  ctx.moveTo(-8, 2);
  ctx.lineTo(-7, top + 3);
  ctx.moveTo(8, 2);
  ctx.lineTo(7, top + 3);
  ctx.stroke();
}

/** 기본 몸 파츠 (모든 선수 공통) */
export function baseSkin(): Skin {
  return {
    thigh: limb(25, 21, (c) => c.pants),
    shin: limb(20, 17, (c) => c.pants, (c) => c.team),
    shoe: shape((ctx) => {
      rr(ctx, -6, -7, 26, 15, 7);
      ctx.fillStyle = "#1b1d26";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = OUT;
      ctx.stroke();
      ctx.fillStyle = "#f2f2f2";
      ctx.fillRect(-2, 4, 20, 3);
    }),
    sleeve: limb(18, 15, (c) => c.team),
    forearm: limb(14, 12, (c) => c.skin),
    gloves: shape((ctx, c) => {
      ctx.beginPath();
      ctx.ellipse(2, 0, 10, 9, 0, 0, Math.PI * 2);
      ctx.fillStyle = c.accent;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = OUT;
      ctx.stroke();
    }),
    hand: shape((ctx, c) => {
      ctx.beginPath();
      ctx.arc(4, 0, 7, 0, Math.PI * 2);
      ctx.fillStyle = c.skin;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = OUT;
      ctx.stroke();
    }),
    mitt: shape((ctx) => {
      ctx.beginPath();
      ctx.ellipse(4, 0, 14, 12, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#8a4b22";
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = OUT;
      ctx.stroke();
      ctx.strokeStyle = "#c98d5a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-4, -4);
      ctx.lineTo(10, -4);
      ctx.moveTo(-4, 3);
      ctx.lineTo(10, 3);
      ctx.stroke();
    }),
    // 등 (유니폼 · 이름 · 번호) — 뼈가 위로 서 있어서 그리기 전에 돌려 세움
    jerseyBack: shape((ctx, c) => {
      ctx.rotate(Math.PI / 2);
      rr(ctx, -27, -44, 54, 50, 14);
      ctx.fillStyle = c.team;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = OUT;
      ctx.stroke();
      // 허리띠
      ctx.fillStyle = c.dark;
      ctx.fillRect(-25, -4, 50, 7);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      if (c.flip) ctx.scale(-1, 1);
      ctx.font = '800 9px "Nanum Gothic", sans-serif';
      if (c.name) ctx.fillText(c.name, 0, -31);
      ctx.font = '24px "Black Han Sans", sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = c.dark;
      if (c.num) {
        ctx.strokeText(c.num, 0, -8);
        ctx.fillText(c.num, 0, -8);
      }
    }),
    jerseyFront: shape((ctx, c) => {
      ctx.rotate(Math.PI / 2);
      rr(ctx, -25, -40, 50, 46, 12);
      ctx.fillStyle = c.team;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = OUT;
      ctx.stroke();
      ctx.fillStyle = c.dark;
      ctx.fillRect(-23, -4, 46, 6);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      if (c.flip) ctx.scale(-1, 1);
      ctx.font = '13px "Black Han Sans", sans-serif';
      if (c.num) ctx.fillText(c.num, 11, -22);
    }),
    hairBack: headShape((ctx, c) => {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.arc(0, -20, 21, 0, Math.PI * 2);
      ctx.fillStyle = c.hair;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = OUT;
      ctx.stroke();
      // 목
      neckBack(ctx, c);
    }),
    face: headShape((ctx, c) => {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.arc(0, -18, 19, 0, Math.PI * 2);
      ctx.fillStyle = c.skin;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = OUT;
      ctx.stroke();
      ctx.fillStyle = "#1a1a24";
      ctx.beginPath();
      ctx.ellipse(-7, -16, 2.6, 3.6, 0, 0, Math.PI * 2);
      ctx.ellipse(7, -16, 2.6, 3.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,120,120,0.45)";
      ctx.beginPath();
      ctx.ellipse(-11, -10, 3.5, 2, 0, 0, Math.PI * 2);
      ctx.ellipse(11, -10, 3.5, 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }),
    helmet: HELMETS.basic,
    cap: headShape((ctx, c) => {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.arc(0, -22, 20, Math.PI, 0);
      ctx.lineTo(24, -22);
      ctx.lineTo(-20, -22);
      ctx.fillStyle = c.team;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = OUT;
      ctx.stroke();
      ctx.fillStyle = c.dark;
      ctx.fillRect(-20, -24, 44, 4);
    }),
    bat: BATS.wood,
  };
}

// ───────────── 장비 (슬롯 붙임 교체) ─────────────
export const HELMETS: Record<string, Attachment> = {
  basic: headShape((ctx, c) => {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.arc(0, -22, 23, Math.PI * 0.95, Math.PI * 2.05);
    ctx.lineTo(18, -10);
    ctx.lineTo(-22, -12);
    ctx.closePath();
    ctx.fillStyle = c.team;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUT;
    ctx.stroke();
    // 귀덮개 (카메라 쪽)
    ctx.beginPath();
    ctx.arc(-14, -12, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 광택
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(-6, -34, 9, 4, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }),
  /** 마타자: 캐릭터 색 헬멧 + 테두리 빛 */
  hero: headShape((ctx, c) => {
    ctx.rotate(Math.PI / 2);
    ctx.shadowColor = c.accent;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(0, -22, 23, Math.PI * 0.95, Math.PI * 2.05);
    ctx.lineTo(18, -10);
    ctx.lineTo(-22, -12);
    ctx.closePath();
    ctx.fillStyle = c.accent;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUT;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-14, -12, 9, 0, Math.PI * 2);
    ctx.fillStyle = c.team;
    ctx.fill();
    ctx.stroke();
  }),
};

export const batShape = (wood: string, tip: string, glow?: (c: RigColors) => string): Attachment =>
  shape((ctx, c) => {
    ctx.scale(0.84, 1.3);
    if (glow) {
      ctx.shadowColor = glow(c);
      ctx.shadowBlur = 16;
    }
    ctx.beginPath();
    ctx.moveTo(-10, -3);
    ctx.lineTo(70, -5);
    ctx.quadraticCurveTo(122, -9, 124, 0);
    ctx.quadraticCurveTo(122, 9, 70, 5);
    ctx.lineTo(-10, 3);
    ctx.closePath();
    ctx.fillStyle = wood;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = OUT;
    ctx.stroke();
    ctx.fillStyle = tip;
    ctx.fillRect(-12, -4, 6, 8);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(40, -4, 70, 2);
  });

export const BATS: Record<string, Attachment> = {
  wood: batShape("#d9a35b", "#4a2a12"),
  metal: batShape("#c8ced8", "#20232c"),
  hero: batShape("#fff3d6", "#4a2a12", (c) => c.accent),
};

export const SKIN_TONES = ["#f6d2b2", "#eec29e", "#d9a57d", "#f9dcc4"];
export const HAIR = ["#1d1a22", "#3a2a1c", "#6b4a2a", "#222831", "#4a3b6b"];
