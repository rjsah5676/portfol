/**
 * 육성 선수 외형 (헤어 · 얼굴 · 피부 · 배트 · 유니폼 각 3종) — 능력치 영향 없음.
 * 지금은 코드로 그린 임시 파츠. 그림을 받으면 같은 슬롯의 image 붙임으로 갈아 끼움 (뼈 · 애니는 그대로 → 어떤 자세에서도 이음매 유지).
 * 나중 BM 스킨은 여기에 4번째부터 (잠금 표시).
 */
import { BATS, HEAD_SCALE, batShape } from "./figures";
import type { Attachment, RigColors, Skin } from "./rig";

export interface Look {
  hair: number;
  face: number;
  skin: number;
  bat: number;
  uni: number;
}
export const DEFAULT_LOOK: Look = { hair: 0, face: 0, skin: 0, bat: 0, uni: 0 };
export type LookKey = keyof Look;
export const LOOK_KEYS: LookKey[] = ["hair", "face", "skin", "bat", "uni"];
export const LOOK_LABEL: Record<LookKey, string> = { hair: "헤어", face: "얼굴", skin: "피부색", bat: "배트", uni: "유니폼" };

export const SKINS = [
  { name: "밝은", c: "#f6d2b2" },
  { name: "중간", c: "#e2b08a" },
  { name: "구릿빛", c: "#b9825a" },
];
export const HAIRS = ["스포츠머리", "덮수룩 웨이브", "묶은 머리"];
export const FACES = ["또랑또랑", "날카로운 눈", "웃는 눈"];
export const BATCOL = [
  { name: "나무", wood: "#d9a35b", tip: "#4a2a12" },
  { name: "블랙", wood: "#30323d", tip: "#d9a35b" },
  { name: "실버", wood: "#c8ced8", tip: "#20232c" },
];
/** 유니폼: 0 = 팀 기본(홈) · 1 = 원정 회색 · 2 = 얼터 남색 */
export const UNIS = [
  { name: "홈", team: "", dark: "", pants: "#eef0f4" },
  { name: "원정", team: "#9aa1b5", dark: "#2a3150", pants: "#c9cdd8" },
  { name: "얼터", team: "#22305e", dark: "#FF8A3D", pants: "#eef0f4" },
];
export const LOOK_OPTS: Record<LookKey, string[]> = {
  hair: HAIRS,
  face: FACES,
  skin: SKINS.map((s) => s.name),
  bat: BATCOL.map((b) => b.name),
  uni: UNIS.map((u) => u.name),
};

const OUT = "rgba(10,12,22,0.9)";
const HAIR_COLOR = "#1d1a22";
const head = (paint: (ctx: CanvasRenderingContext2D, c: RigColors) => void): Attachment => ({
  kind: "shape",
  paint: (ctx, c) => {
    ctx.scale(HEAD_SCALE, HEAD_SCALE);
    ctx.rotate(Math.PI / 2);
    paint(ctx, c);
  },
});

/** 뒷머리 (타석 · 등 보이는 자세). 머리 중심 (0, -20) 반지름 21 — 세 가지 다 같은 틀 안에서만 바뀜 */
const HAIR_BACK: Attachment[] = [
  head((ctx, c) => {
    ctx.beginPath();
    ctx.arc(0, -20, 21, 0, Math.PI * 2);
    ctx.fillStyle = c.hair;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = OUT;
    ctx.stroke();
    ctx.fillStyle = c.skin;
    ctx.fillRect(-8, -4, 16, 8);
  }),
  head((ctx, c) => {
    // 덮수룩: 아래로 삐친 끝
    ctx.beginPath();
    ctx.arc(0, -20, 21, Math.PI * 0.9, Math.PI * 2.1);
    for (let i = 0; i < 5; i++) {
      const x = 19 - i * 9.5;
      ctx.lineTo(x, -6 + (i % 2) * 5);
    }
    ctx.closePath();
    ctx.fillStyle = c.hair;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = OUT;
    ctx.stroke();
    ctx.fillStyle = c.skin;
    ctx.fillRect(-7, -2, 14, 6);
  }),
  head((ctx, c) => {
    // 묶은 머리: 아래로 꼬리
    ctx.beginPath();
    ctx.arc(0, -20, 21, 0, Math.PI * 2);
    ctx.fillStyle = c.hair;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = OUT;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(2, 4, 6, 12, 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = c.accent === "#f2f2f2" ? "#ff5a5a" : c.accent;
    ctx.fillRect(-4, -6, 9, 4);
  }),
];

/** 앞머리 (정면 · 초상화) — 얼굴 위에 덮음 */
const HAIR_FRONT: Attachment[] = [
  head((ctx, c) => {
    ctx.beginPath();
    ctx.arc(0, -19, 20.5, Math.PI * 1.02, Math.PI * 1.98);
    ctx.quadraticCurveTo(10, -28, 0, -27);
    ctx.quadraticCurveTo(-10, -28, -20, -24);
    ctx.closePath();
    ctx.fillStyle = c.hair;
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = OUT;
    ctx.stroke();
  }),
  head((ctx, c) => {
    ctx.beginPath();
    ctx.arc(0, -19, 21.5, Math.PI * 0.95, Math.PI * 2.05);
    for (let i = 0; i <= 5; i++) ctx.lineTo(20 - i * 8, -27 + (i % 2 ? 5 : 0));
    ctx.closePath();
    ctx.fillStyle = c.hair;
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = OUT;
    ctx.stroke();
  }),
  head((ctx, c) => {
    ctx.beginPath();
    ctx.arc(0, -19, 20.5, Math.PI * 1.02, Math.PI * 1.98);
    ctx.quadraticCurveTo(6, -24, -4, -25);
    ctx.quadraticCurveTo(-12, -24, -20, -24);
    ctx.closePath();
    ctx.fillStyle = c.hair;
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = OUT;
    ctx.stroke();
    // 옆으로 보이는 꽁지
    ctx.beginPath();
    ctx.ellipse(21, -14, 5, 9, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }),
];

/** 얼굴 (정면) — 눈만 바뀜 */
const eye = (ctx: CanvasRenderingContext2D, kind: number) => {
  ctx.fillStyle = "#1a1a24";
  ctx.strokeStyle = "#1a1a24";
  for (const x of [-7, 7]) {
    if (kind === 0) {
      ctx.beginPath();
      ctx.ellipse(x, -16, 2.8, 3.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(x - 0.8, -17.4, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1a1a24";
    } else if (kind === 1) {
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(x - 4, -18 + (x < 0 ? -1 : 1) * 0);
      ctx.lineTo(x + 3, -16.5 - (x < 0 ? 1.5 : -1.5) * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(x, -15, 2, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(x, -14.5, 3.4, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
  }
};
const FACE: Attachment[] = [0, 1, 2].map((k) =>
  head((ctx, c) => {
    ctx.beginPath();
    ctx.arc(0, -18, 19, 0, Math.PI * 2);
    ctx.fillStyle = c.skin;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = OUT;
    ctx.stroke();
    eye(ctx, k);
    ctx.fillStyle = "rgba(255,120,120,0.45)";
    ctx.beginPath();
    ctx.ellipse(-11, -10, 3.5, 2, 0, 0, Math.PI * 2);
    ctx.ellipse(11, -10, 3.5, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // 입
    ctx.strokeStyle = "#5a2a2a";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    if (k === 2) ctx.arc(0, -8, 3.5, 0.15 * Math.PI, 0.85 * Math.PI);
    else if (k === 1) {
      ctx.moveTo(-3, -7);
      ctx.lineTo(3, -7.5);
    } else ctx.arc(0, -8.5, 2.4, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
  })
);

const BAT_ATT = BATCOL.map((b) => batShape(b.wood, b.tip));

const pick = <T,>(a: T[], i: number) => a[Math.max(0, Math.min(a.length - 1, i | 0))];

/** 외형 → 붙임 바꾸기 (base 스킨 위에) */
export function lookSkin(base: Skin, look: Look, opts: { heroBat?: boolean } = {}): Skin {
  return {
    ...base,
    hairBack: pick(HAIR_BACK, look.hair),
    hairFront: pick(HAIR_FRONT, look.hair),
    face: pick(FACE, look.face),
    bat: opts.heroBat ? BATS.hero : pick(BAT_ATT, look.bat),
  };
}
/** 외형 → 색 바꾸기 (피부 · 머리 · 유니폼) */
export function lookColors(c: RigColors, look: Look): RigColors {
  const u = pick(UNIS, look.uni);
  return { ...c, skin: pick(SKINS, look.skin).c, hair: HAIR_COLOR, team: u.team || c.team, dark: u.dark || c.dark, pants: u.pants };
}
/** 유니폼만 (같은 팀 동료들도 같은 유니폼) */
export function uniColors(c: RigColors, look: Look): RigColors {
  const u = pick(UNIS, look.uni);
  return { ...c, team: u.team || c.team, dark: u.dark || c.dark, pants: u.pants };
}
