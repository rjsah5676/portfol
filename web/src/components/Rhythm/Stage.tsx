"use client";

import { useEffect, useRef, useState } from "react";
import type { Song } from "@/lib/rhythm/music";
import type { Chart, Difficulty } from "@/lib/rhythm/chart";
import { Engine, HP_MAX, rankOf, type Judge } from "@/lib/rhythm/engine";
import { AUTO_SYNC, AutoSyncTracker, splitSync, type AutoSyncState } from "@/lib/rhythm/autosync";
import { DIFFICULTIES } from "@/lib/rhythm/chart";
import { coverOf } from "./SongCarousel";
import HoldButton from "./HoldButton";
import {
  drawHead,
  drawHoldBody,
  laneColors,
  makeHitSound,
  type HitSound,
  type Skin,
} from "@/lib/rhythm/fx";
import { sfx, sfxBuffer } from "@/lib/rhythm/sfx";

export const KEY_CODES = ["KeyD", "KeyF", "KeyJ", "KeyK"];

export type Cover = "none" | "fade" | "sudden";
export const COVERS_OPT: { key: Cover; label: string; desc: string }[] = [
  { key: "none", label: "없음", desc: "" },
  { key: "fade", label: "페이드", desc: "판정선 가까이에서 노트가 사라져요 — 박자감으로 치기" },
  { key: "sudden", label: "서든", desc: "위쪽 30%가 가려져 노트를 미리 읽을 수 없어요" },
];
export const KEY_LABELS = ["D", "F", "J", "K"];

export interface Result {
  songId: string;
  diff: Difficulty;
  score: number;
  acc: number;
  rank: string;
  counts: Record<Judge, number>;
  maxCombo: number;
  fc: boolean;
  ap: boolean;
  /** 판정 창 안에서 빠르게/늦게 친 횟수 (±FAST_SLOW_MS 넘는 것만) */
  fast: number;
  slow: number;
  /** 친 노트들의 타이밍 중앙값(ms, +면 늦게 침). 싱크 자동 보정용 */
  avgMs: number | null;
  /** 타이밍이 한쪽으로 고르게 쏠려 있는지 (들쭉날쭉이 아니라 늘 비슷하게 늦거나 빠름) */
  steady: boolean;
  /** HP가 바닥나서 중간에 끝남 */
  failed: boolean;
}

/**
 * 친 타이밍(초) 목록 → 중앙값(ms)과 "고르게 쏠렸는지".
 * 20개 이상 쳤고, 중앙값 주변으로 절반 이상이 ±25ms 안에 모여 있으면(MAD ≤ 25ms)
 * 실수로 흔들린 게 아니라 기기·손 버릇으로 늘 그만큼 어긋난 것으로 봄.
 */
/** 랭크 글자색 (결과 화면과 같은 색) */
export const rankColorOf = (rank: string) =>
  rank.startsWith("S")
    ? "#FDE047"
    : rank === "A"
      ? "#4ADE80"
      : rank === "B"
        ? "#60A5FA"
        : "#F87171";

/** 플레이 화면 논리 해상도: 이 크기로 그리고 프레임(16:9)에 맞춰 통째로 늘림 → 창모드·전체화면이 똑같이 보임 */
export const LW = 1280;
export const LH = 720;

/** 레인 틀(gear.webp) 원본 좌표: 레인 시작·폭, 판정선, 아래 패드 */
const GEAR = {
  w: 1075,
  h: 1683,
  /** 레인: 틀 안쪽을 꽉 채움 (기둥 안쪽 158 ~ 914) */
  lane0: 158,
  laneW: 189,
  judge: 1393,
  padTop: 1452,
  padBot: 1640,
  /** 패드 안쪽 화면(원근감 있게 바깥으로 벌어짐): [위 왼쪽, 위 오른쪽, 아래 오른쪽, 아래 왼쪽] */
  pads: [
    [178, 1462, 330, 1462, 306, 1606, 140, 1606],
    [368, 1462, 518, 1462, 516, 1606, 352, 1606],
    [556, 1462, 708, 1462, 724, 1606, 562, 1606],
    [752, 1462, 902, 1462, 940, 1606, 776, 1606],
  ],
  /** 키 글자 자리 (패드 안쪽 가운데) */
  padCx: [232, 437, 638, 842],
  padCy: 1530,
};

/** 레인 위치 (화면 왼쪽·가운데·오른쪽) */
export type FieldPos = "left" | "center" | "right";
export const FIELD_POS: { key: FieldPos; label: string }[] = [
  { key: "left", label: "왼쪽" },
  { key: "center", label: "가운데" },
  { key: "right", label: "오른쪽" },
];

const loadImg = (src: string, onload: () => void) => {
  const im = new Image();
  im.onload = onload;
  im.src = src;
  return im;
};
const ready = (im: HTMLImageElement | null) => !!im && im.complete && im.naturalWidth > 0;

/** 플레이 화면에서 뒤로가기를 잡으려고 쌓는 히스토리 표시 */
export const PLAY_HISTORY_KEY = "__rhythmPlay";

const SCROLL_KEYS = new Set(["Space", "PageUp", "PageDown", "Home", "End"]);

function timingOf(diffs: number[]): { avgMs: number | null; steady: boolean } {
  if (diffs.length < 10) return { avgMs: null, steady: false };
  const ms = diffs.map((d) => d * 1000).sort((a, b) => a - b);
  const med = ms[Math.floor(ms.length / 2)];
  const dev = ms.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = dev[Math.floor(dev.length / 2)];
  return { avgMs: Math.round(med), steady: ms.length >= 20 && mad <= 25 };
}

/** 이보다 크게 어긋나면 FAST/SLOW 표시 (퍼펙트 안이어도) */
const FAST_SLOW_MS = 20;
/** 플레이 중 R을 이만큼 누르고 있으면 처음부터 */
const R_HOLD_MS = 700;

const JUDGE_STYLE: Record<Judge, { text: string; color: string }> = {
  perfect: { text: "PERFECT", color: "#7DF9FF" },
  great: { text: "GREAT", color: "#4ADE80" },
  good: { text: "GOOD", color: "#FBBF24" },
  miss: { text: "MISS", color: "#F87171" },
};

/** 스크롤 속도 1.0 → 노트가 2.4초 동안 내려옴 */
export const visibleSec = (speed: number) => 2.4 / speed;

/** 플레이 중에도 바꿀 수 있는 설정 */
export interface LiveSettings {
  speed: number;
  music: number;
  hit: number;
}

interface Props {
  song: Song;
  diff: Difficulty;
  chart: Chart;
  buffer: AudioBuffer;
  ctx: AudioContext;
  speed: number;
  /** 수동 싱크(ms, 설정에서 사용자가 맞춘 값): 노트 화면+판정을 같이 옮김. +면 노트가 늦게 옴 */
  sync: number;
  /** 자동 싱크가 들고 있는 값(사용자에겐 안 보임) — 판 끝·일시정지 때 onAutoSync로 돌려줌 */
  auto: AutoSyncState;
  onAutoSync: (next: AutoSyncState) => void;
  /** 타격음 볼륨 0~1 (0이면 끔) */
  hitVolume: number;
  hitSound: HitSound;
  skin: Skin;
  /** 노트 가림: fade = 판정선 가까이에서 흐려짐, sudden = 아래쪽에 와서야 보임 */
  cover: Cover;
  /** 음악 볼륨 0~1 */
  musicVolume: number;
  /** 플레이 중(일시정지 화면·속도 단축키)에 바꾼 설정을 부모에 저장 */
  onSettings: (patch: Partial<LiveSettings>) => void;
  onFinish: (result: Result) => void;
  onQuit: () => void;
  onRestart: () => void;
  /** 레인 위치 */
  field: FieldPos;
  /** 전체화면 여부·토글 (게임 전체 프레임이 전체화면이 됨) */
  fs: boolean;
  onToggleFs: () => void;
  /** 휴대폰 세로: 레인만 세로 화면 가득 (위에 점수 띠) */
  portrait?: boolean;
}

export default function Stage({
  song,
  diff,
  chart,
  buffer,
  ctx,
  speed,
  sync,
  auto,
  onAutoSync,
  hitVolume,
  hitSound,
  skin,
  cover: coverMode,
  musicVolume,
  onSettings,
  onFinish,
  onQuit,
  onRestart,
  field,
  fs,
  onToggleFs,
  portrait = false,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [paused, setPaused] = useState(false);
  // 일시정지 화면의 지금까지 점수·정확도·랭크
  const [pauseStats, setPauseStats] = useState<{
    score: number;
    acc: number;
    combo: number;
    /** 판정 받은 노트 수 (0이면 정확도·랭크를 아직 안 보여 줌) */
    judged: number;
  }>({
    score: 0,
    acc: 0,
    combo: 0,
    judged: 0,
  });
  // 일시정지·재개를 effect 밖(버튼)에서도 부르기 위해
  const ctrl = useRef<{
    pause: () => void;
    resume: () => void;
    apply: (p: Partial<LiveSettings>) => void;
  }>({
    pause: () => {},
    resume: () => {},
    apply: () => {},
  });
  // 일시정지 화면에서 보여줄 현재 설정값
  const [liveUi, setLiveUi] = useState<LiveSettings>({
    speed,
    music: musicVolume,
    hit: hitVolume,
  });
  const change = (p: Partial<LiveSettings>) => {
    setLiveUi((v) => ({ ...v, ...p }));
    ctrl.current.apply(p);
    onSettings(p);
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    // desynchronized는 쓰지 않음: 모바일(특히 안드로이드)에서 화면이 찢어지고 깜빡임
    const g = canvas.getContext("2d", { alpha: false })!;
    const beatSec = 60 / song.bpm;
    // 롱노트 누르는 동안 8분음표마다 콤보가 오름
    const engine = new Engine(chart, beatSec / 2);
    // 연습곡은 HP가 바닥나도 끝까지 (처음 몇 탭은 싱크가 잡힐 때까지 누구나 — press에서 갱신)
    engine.noFail = true;
    // 플레이 중에 바뀔 수 있는 값들 (일시정지 화면·속도 단축키)
    const live: LiveSettings = { speed, music: musicVolume, hit: hitVolume };
    // 싱크: 음악 싱크 = 수동 + 자동(소리 지연 몫), 타격 싱크 = 자동(손 지연 몫). 자동은 치는 동안 움직임
    const outputLatency = (ctx as AudioContext & { outputLatency?: number }).outputLatency;
    let autoOffset = auto.offset;
    const tracker = new AutoSyncTracker(auto.judge);
    const offsetSec = () => (sync + autoOffset) / 1000;
    const judgeSec = () => tracker.judge / 1000;
    /** 자동 싱크 값을 부모에 돌려줌 (일시정지·끝·나갈 때만 — 치는 동안 저장하면 끊김) */
    let reported: AutoSyncState | null = null;
    const reportAuto = () => {
      const next = splitSync(
        tracker.judge,
        autoOffset,
        outputLatency === undefined ? AUTO_SYNC.handCapNoLatency : AUTO_SYNC.handCap
      );
      if (reported && reported.judge === next.judge && reported.offset === next.offset) return;
      reported = next;
      onAutoSync(next);
    };
    let vis = visibleSec(speed);
    // READY → 3 → 2 → 1 → GO! 가 끝난 뒤에 노트가 내려오기 시작
    const cd = countdownPhases();
    const cdEnd = cd[cd.length - 2].from + cd[cd.length - 2].dur; // "1"이 끝나는 시점
    const leadIn = cdEnd + vis + 0.25;
    const lanePointer = new Map<number, number>();

    // ── 화면 배치 ──
    // 가로: 논리 좌표 1280×720. 휴대폰 세로: 폭 720에 화면 비율대로 세로 — 레인 틀이 폭을 꽉 채우고 아래에 붙음
    // gx: 레인 왼쪽, W: 레인 4개 폭, judgeY: 판정선, laneTop: 노트가 나타나는 위쪽 끝
    const CW = portrait ? 720 : LW;
    const CH = portrait
      ? Math.round(
          Math.min(
            1700,
            Math.max(
              1280, // 가로로 들고 시작해도 곧 세로로 돌아가므로 긴 변/짧은 변 비율로
              (720 * Math.max(window.innerHeight, window.innerWidth)) /
                Math.max(1, Math.min(window.innerHeight, window.innerWidth))
            )
          )
        )
      : LH;
    const GS = portrait ? CW / GEAR.w : LH / GEAR.h;
    const gearW = GEAR.w * GS;
    const gearH = GEAR.h * GS;
    const gearX = portrait
      ? 0
      : Math.round(field === "left" ? 64 : field === "right" ? LW - 64 - gearW : (LW - gearW) / 2);
    const gearY = portrait ? CH - gearH : 0;
    const gx = gearX + GEAR.lane0 * GS;
    const W = GEAR.laneW * GS * 4;
    const H = CH;
    const judgeY = gearY + GEAR.judge * GS;
    /** 세로 화면 위쪽 점수 띠 높이 (그 아래부터 노트가 내려옴) */
    const HUD_H = 170;
    const laneTop = portrait ? HUD_H : 0;
    /** 레인 위~판정선 사이 비율 위치 */
    const midY = (r: number) => laneTop + (judgeY - laneTop) * r;
    /** 레인 틀 그림 좌표 → 화면 좌표 */
    const gpx = (x: number) => gearX + x * GS;
    const gy = (y: number) => gearY + y * GS;
    // 정보판: 레인이 가운데면 양옆, 한쪽이면 반대쪽에 위아래로
    const side = field === "left" ? "right" : field === "right" ? "left" : null;
    const sideX = side === "right" ? gearX + gearW + 56 : 56;
    const sideW = side === "right" ? LW - sideX - 56 : gearX - 112;
    const infoBox = side
      ? { x: sideX, y: 56, w: sideW, h: 210 }
      : { x: 40, y: 56, w: gearX - 80, h: 250 };
    const scoreBox = side
      ? { x: sideX, y: 290, w: sideW, h: 300 }
      : { x: gearX + gearW + 40, y: 56, w: LW - gearX - gearW - 80, h: 330 };
    // 곡 정보판: 넓으면 커버 옆에 글자, 좁으면(레인 가운데) 커버 아래에 제목
    const infoWide = infoBox.w >= 520;
    const coverSize = infoWide ? infoBox.h - 40 : 120;
    // HP 게이지: 기어 바깥 기둥 옆 (정보판 쪽)
    const hpX = field === "right" ? gearX - 4 : gearX + gearW - 6;

    let k = 1; // 캔버스 픽셀 / 논리 좌표
    /** 그리기 품질 단계 (프레임이 떨어지면 내려감, measureFrame) */
    let quality = 3;
    const rebuild = () => {
      buildStatic();
      buildGear();
      buildGlow();
    };
    const bgImg = loadImg(
      // 곡 색이 따뜻하면 분홍 무대, 아니면 파란 무대
      warm(song.color) ? "/rhythm/play-pink.webp" : "/rhythm/play-blue.webp",
      () => buildStatic()
    );
    const gearImg = loadImg("/rhythm/gear.webp", () => buildGear());
    const coverImg = loadImg(coverOf(song), () => buildStatic());
    const hitImg = loadImg("/rhythm/hit.webp", () => {});
    const ringImg = loadImg("/rhythm/ring.webp", () => {});
    setCountdownRing(ringImg);
    const failImg = loadImg("/rhythm/banner-failed.webp", () => {});
    const judgeImg: Record<Judge, HTMLImageElement> = {
      perfect: loadImg("/rhythm/judge-perfect.webp", () => {}),
      great: loadImg("/rhythm/judge-great.webp", () => {}),
      good: loadImg("/rhythm/judge-good.webp", () => {}),
      miss: loadImg("/rhythm/judge-miss.webp", () => {}),
    };
    const layer = (w: number, h: number) => {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * k));
      c.height = Math.max(1, Math.round(h * k));
      const b = c.getContext("2d")!;
      b.scale(k, k);
      return { c, b };
    };
    /** 안 바뀌는 바닥: 무대 배경 + 레인 뒤 어두운 판 + 정보판 유리 */
    let staticLayer: HTMLCanvasElement | null = null;
    const buildStatic = () => {
      const { c, b } = layer(CW, CH);
      if (ready(bgImg)) {
        const sc = Math.max(CW / bgImg.naturalWidth, CH / bgImg.naturalHeight);
        const iw = bgImg.naturalWidth * sc;
        const ih = bgImg.naturalHeight * sc;
        b.drawImage(bgImg, (CW - iw) / 2, (CH - ih) / 2, iw, ih);
      } else {
        b.fillStyle = "#070814";
        b.fillRect(0, 0, CW, CH);
      }
      b.fillStyle = "rgba(4,5,14,0.35)";
      b.fillRect(0, 0, CW, CH);
      // 레인 뒤 판: 노트가 무대 조명에 묻히지 않게
      const lane = b.createLinearGradient(0, laneTop, 0, judgeY);
      lane.addColorStop(0, "rgba(3,4,12,0.55)");
      lane.addColorStop(0.25, "rgba(3,4,12,0.82)");
      lane.addColorStop(1, "rgba(3,4,12,0.9)");
      b.fillStyle = lane;
      b.fillRect(gx - 6, laneTop, W + 12, judgeY + 4 - laneTop);
      b.fillStyle = "rgba(255,255,255,0.07)";
      for (let l = 1; l < 4; l++) b.fillRect(gx + (l * W) / 4 - 0.5, laneTop, 1, judgeY - laneTop);
      if (portrait) {
        // 세로: 틀 위로 길게 나온 레인 양옆에 네온 줄 (틀 기둥이 이어지는 느낌)
        for (const [x, col] of [
          [gx - 8, "#F472B6"],
          [gx + W + 5, "#38BDF8"],
        ] as const) {
          const rail = b.createLinearGradient(0, laneTop, 0, gearY + 60);
          rail.addColorStop(0, `${col}00`);
          rail.addColorStop(0.3, `${col}cc`);
          rail.addColorStop(1, `${col}cc`);
          b.fillStyle = rail;
          b.fillRect(x, laneTop, 3, gearY + 60 - laneTop);
        }
        glass(b, 12, 12, CW - 24, HUD_H - 24, song.color);
      } else
        for (const box of [infoBox, scoreBox]) glass(b, box.x, box.y, box.w, box.h, song.color);
      // 곡 커버 (정보판 왼쪽, 세로 화면은 위 띠 왼쪽)
      const cs = portrait ? HUD_H - 56 : coverSize;
      const cx = portrait ? 28 : infoBox.x + 20;
      const cy = portrait ? 28 : infoBox.y + 20;
      if (ready(coverImg)) {
        b.save();
        b.beginPath();
        b.roundRect(cx, cy, cs, cs, 10);
        b.clip();
        const sc = Math.max(cs / coverImg.naturalWidth, cs / coverImg.naturalHeight);
        b.drawImage(
          coverImg,
          cx + (cs - coverImg.naturalWidth * sc) / 2,
          cy + (cs - coverImg.naturalHeight * sc) / 2,
          coverImg.naturalWidth * sc,
          coverImg.naturalHeight * sc
        );
        b.restore();
      } else {
        b.fillStyle = `${song.color}33`;
        b.beginPath();
        b.roundRect(cx, cy, cs, cs, 10);
        b.fill();
      }
      b.strokeStyle = "rgba(255,255,255,0.25)";
      b.lineWidth = 1.5;
      b.beginPath();
      b.roundRect(cx, cy, cs, cs, 10);
      b.stroke();
      staticLayer = c;
    };
    /** 레인 틀 (노트 위에 덮음) — 큰 그림을 매 프레임 줄여 그리지 않게 미리 줄여 둠 */
    let gearLayer: HTMLCanvasElement | null = null;
    const buildGear = () => {
      if (!ready(gearImg)) return;
      const { c, b } = layer(gearW, gearH);
      b.imageSmoothingQuality = "high";
      b.drawImage(gearImg, 0, 0, gearW, gearH);
      gearLayer = c;
    };
    // 박자 번쩍임용 빛 (한 번 그려두고 투명도만 바꿔서 씀)
    let beatGlow: HTMLCanvasElement | null = null;
    const buildGlow = () => {
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = 180;
      const b = c.getContext("2d")!;
      b.scale(c.width / CW, c.height / CH);
      const mx = gx + W / 2;
      const gr = b.createRadialGradient(mx, CH * 0.55, W * 0.4, mx, CH * 0.55, CW * 0.55);
      gr.addColorStop(0, `${song.color}50`);
      gr.addColorStop(1, `${song.color}00`);
      b.fillStyle = gr;
      b.fillRect(0, 0, CW, CH);
      beatGlow = c;
    };
    // 캔버스 크기: 프레임 폭 × 화면 배율 (너무 크면 무거워서 1920px까지 — 고해상도 전체화면에서 프레임 떨어짐)
    let pxW = 0;
    const resize = (force = false) => {
      // 세로 화면은 비율을 지키며 화면 안에 꽉 (남는 곳은 검은 띠)
      const cssW = portrait
        ? Math.min(wrap.clientWidth, (wrap.clientHeight * CW) / CH)
        : wrap.clientWidth;
      if (!cssW) return;
      if (portrait) {
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${(cssW * CH) / CW}px`;
      }
      // 프레임이 계속 떨어지는 기기는 해상도도 한 단계 낮춤 (1920 → 1280px)
      const dpr = Math.min(window.devicePixelRatio || 1, 2, (quality === 0 ? 1280 : 1920) / cssW);
      const nW = Math.round(cssW * dpr);
      if (nW === pxW && !force) return;
      pxW = nW;
      canvas.width = nW;
      canvas.height = Math.round((nW * CH) / CW);
      k = nW / CW;
      g.setTransform(k, 0, 0, k, 0, 0);
      rebuild();
    };
    resize();
    const ro = new ResizeObserver(() => resize());
    ro.observe(wrap);
    // 오디오 시작
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const musicGain = ctx.createGain();
    musicGain.gain.value = live.music;
    src.connect(musicGain).connect(ctx.destination);
    const startAt = ctx.currentTime + leadIn;
    src.start(startAt);
    let stopped = false;

    // 카운트다운 효과음 (화면 표시 시점에 들리도록 싱크값만큼 밀어서 예약)
    const base = startAt - leadIn + offsetSec();
    const beeps: AudioScheduledSourceNode[] = [];
    for (const ph of cd) {
      if (!ph.beep) continue;
      const at = Math.max(ctx.currentTime, base + ph.from);
      // 효과음 파일이 있으면 그걸로, 없으면 삑 소리 합성
      const name = ph.label === "GO!" ? "go" : "countdown";
      if (sfxBuffer(name)) {
        const sNode = sfx(name, 0.9, at);
        if (sNode) beeps.push(sNode);
        continue;
      }
      const o = ctx.createOscillator();
      const gn = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = ph.beep;
      gn.gain.setValueAtTime(0.0001, at);
      gn.gain.exponentialRampToValueAtTime(0.35, at + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.0001, at + (ph.label === "GO!" ? 0.45 : 0.18));
      o.connect(gn).connect(ctx.destination);
      o.start(at);
      o.stop(at + 0.5);
      beeps.push(o);
    }

    const now = () =>
      ctx.currentTime - startAt - (outputLatency ?? 0) - (ctx.baseLatency ?? 0) - offsetSec();

    // 화면 효과용 상태
    let lastJudge: { judge: Judge; at: number; diff?: number; tick?: boolean } | null = null;
    let shownScore = 0;
    let speedToastAt = -10;
    let fast = 0;
    let slow = 0;
    const diffs: number[] = [];
    // 자동 싱크: 레인별 노트 시각(정렬) + 입력마다 같은 레인 가장 가까운 노트와의 차이(초, 타격 싱크 적용 후)
    const laneNotes: number[][] = [[], [], [], []];
    for (const n of chart.notes) laneNotes[n.lane].push(n.t);
    for (const l of laneNotes) l.sort((a, b) => a - b);
    const lanePtr = [0, 0, 0, 0];
    const laneMatched = [-1, -1, -1, -1];
    /**
     * 같은 레인에서 가장 가까운 노트와의 차이. 다음 두 경우는 표본으로 안 씀:
     *  - 앞뒤 노트 간격의 절반을 넘게 어긋남 → 엉뚱한 노트에 붙은 것(빠른 연타에서 늦게 치면 '빠름'으로 읽힘)
     *  - 같은 노트에 두 번째 입력(헛누름·연타)
     */
    const nearestDiff = (lane: number, t: number): number | null => {
      const arr = laneNotes[lane];
      let i = lanePtr[lane];
      while (i < arr.length && arr[i] < t - AUTO_SYNC.near) i++;
      lanePtr[lane] = i;
      let best: number | null = null;
      let bi = -1;
      for (let k = i; k < arr.length && arr[k] <= t + AUTO_SYNC.near; k++) {
        const d = t - arr[k];
        if (best === null || Math.abs(d) < Math.abs(best)) {
          best = d;
          bi = k;
        }
      }
      if (best === null || bi === laneMatched[lane]) return null;
      const room = Math.min(
        bi > 0 ? arr[bi] - arr[bi - 1] : Infinity,
        bi + 1 < arr.length ? arr[bi + 1] - arr[bi] : Infinity
      );
      if (Math.abs(best) > room / 2 - 0.02) return null;
      laneMatched[lane] = bi;
      return best;
    };
    const autoSyncTap = (d: number) => {
      const step = tracker.push(d);
      if (step === 0) return;
      // 지금까지 모은 기록도 새 싱크 기준으로 (결과 화면 평균이 남은 쏠림만 보이게)
      for (let i = 0; i < diffs.length; i++) diffs[i] -= step / 1000;
    };
    const hitBuf = makeHitSound(ctx, hitSound);
    const hitGain = ctx.createGain();
    hitGain.gain.value = live.hit * 0.9;
    hitGain.connect(ctx.destination);
    // 타격 효과: 판정선에서 터지는 빛·링·불꽃
    const bursts: { lane: number; at: number; judge: Judge; big: boolean }[] = [];
    const sparks: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      at: number;
      life: number;
      size: number;
      color: string;
    }[] = [];
    let lastSparkAt = -1;
    let comboAt = -1;
    let drawFrom = 0;
    const colors = laneColors(skin, song.color);
    const laneColor = (l: number) => colors[l];
    const spawnSparks = (
      lane: number,
      at: number,
      n: number,
      color: string,
      speed: number,
      laneW: number,
      judgeY: number
    ) => {
      const cx = lane * laneW + laneW / 2;
      if (quality <= 1) n = Math.ceil(n / 2);
      for (let k = 0; k < n; k++) {
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
        const v = speed * (0.45 + Math.random() * 0.75);
        sparks.push({
          x: cx + (Math.random() - 0.5) * laneW * 0.5,
          y: judgeY,
          vx: Math.cos(ang) * v,
          vy: Math.sin(ang) * v,
          at,
          life: 0.28 + Math.random() * 0.25,
          size: 1.5 + Math.random() * 2.5,
          color: Math.random() < 0.35 ? "#FFFFFF" : color,
        });
      }
      if (sparks.length > 400) sparks.splice(0, sparks.length - 400);
    };
    /** 친 노트가 조각나서 흩어짐 → 노트가 "없어졌다"는 게 확실히 보이게 */
    const spawnShards = (
      lane: number,
      at: number,
      color: string,
      laneW: number,
      judgeY: number
    ) => {
      const x0 = lane * laneW + 4;
      const w = laneW - 8;
      for (let k = 0; k < 7; k++) {
        const fx = (k + 0.5) / 7;
        const ang = -Math.PI / 2 + (fx - 0.5) * 2.2 + (Math.random() - 0.5) * 0.4;
        const v = 240 + Math.random() * 220;
        sparks.push({
          x: x0 + w * fx,
          y: judgeY,
          vx: Math.cos(ang) * v,
          vy: Math.sin(ang) * v,
          at,
          life: 0.22 + Math.random() * 0.12,
          size: 4 + Math.random() * 4,
          color,
        });
      }
    };
    const songEnd = song.duration - 2.5;

    const barSec = beatSec * 4;
    // 마디 첫 박: 첫 비트(beatOffset)부터 4박 중 노트가 가장 많이 떨어지는 자리 (곡 첫 비트가 늘 마디 첫 박은 아님)
    const barStart = (() => {
      const off = song.beatOffset ?? 0;
      const score = [0, 0, 0, 0];
      for (const n of chart.notes) {
        const b = (n.t - off) / beatSec;
        const k = Math.round(b);
        if (Math.abs(b - k) < 0.08) score[((k % 4) + 4) % 4]++;
      }
      let best = 0;
      for (let p = 1; p < 4; p++) if (score[p] > score[best] * 1.1) best = p;
      return off + best * beatSec;
    })();
    const diffInfo = DIFFICULTIES.find((d) => d.key === diff)!;
    const secName = (t: number) => {
      const bar = Math.floor((t - (song.beatOffset ?? 0)) / barSec);
      let name = "";
      for (const [b0, n] of song.sections) if (bar >= b0) name = n;
      return name;
    };

    const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";
    // 좌표가 늘 같은 그라데이션은 한 번만 만들어 둠 (매 프레임 만들면 GC·CPU 낭비)
    const gradCache = new Map<string, CanvasGradient>();
    const cachedGrad = (key: string, make: () => CanvasGradient) => {
      let gr = gradCache.get(key);
      if (!gr) {
        gr = make();
        gradCache.set(key, gr);
      }
      return gr;
    };
    // 제목 말줄임도 폭이 같으면 다시 재지 않음
    const titleCache = new Map<string, string>();
    const titleFit = (font: string, max: number) => {
      const key = `${font}|${max}`;
      let v = titleCache.get(key);
      if (v === undefined) {
        g.font = font;
        v = ellipsis(g, song.title, max);
        titleCache.set(key, v);
      }
      return v;
    };
    /** 지금까지 판정 받은 노트 수 — 0이면 정확도는 100%가 아니라 아직 없음 */
    const judgedCount = () =>
      engine.counts.perfect + engine.counts.great + engine.counts.good + engine.counts.miss;
    /** R을 누르기 시작한 시각 (꾹 누르면 다시 시작) */
    let rHoldAt: number | null = null;
    const disp = "'Arial Black', 'Segoe UI Black', Impact, ui-sans-serif, sans-serif";
    // 콤보 효과: 50콤보마다 링, 큰 콤보가 끊기면 흔들림
    let ringAt = -10;
    let breakAt = -10;
    let breakFrom = 0;

    /** 휴대폰 세로: 위쪽 띠에 곡·점수·정확도·HP·진행 */
    const drawHudPortrait = (t: number) => {
      const x0 = 28 + (HUD_H - 56) + 18;
      const right = CW - 30;
      const judged =
        engine.counts.perfect + engine.counts.great + engine.counts.good + engine.counts.miss;
      g.textBaseline = "top";
      g.textAlign = "left";
      g.fillStyle = "#fff";
      g.font = `800 24px ${KR_FONT}`;
      g.fillText(titleFit(g.font, right - x0 - 210), x0, 30);
      g.fillStyle = diffInfo.color;
      g.font = `800 17px ${KR_FONT}`;
      g.fillText(
        `${diffInfo.label}  Lv.${chart.level}${song.artist ? `  ·  ${song.artist}` : ""}`,
        x0,
        64
      );
      // 점수 (오른쪽)
      g.textAlign = "right";
      g.fillStyle = "#fff";
      g.font = `italic 900 38px ${disp}`;
      g.fillText(fmtScore(Math.round(shownScore)), right, 26);
      const rk = judged ? rankOf(engine.accuracy) : "-";
      g.font = `italic 900 20px ${disp}`;
      g.fillStyle = judged ? "#fff" : "rgba(255,255,255,0.35)";
      g.fillText(judged ? `${engine.accuracy.toFixed(2)}%` : "--.--%", right, 72);
      const accW = g.measureText(judged ? `${engine.accuracy.toFixed(2)}%` : "--.--%").width;
      g.fillStyle = judged ? rankColorOf(rk) : "rgba(255,255,255,0.3)";
      g.fillText(rk, right - accW - 14, 72);
      // HP (가로)
      const hpr = engine.hp / HP_MAX;
      const hc = hpr > 0.6 ? "#4ADE80" : hpr > 0.3 ? "#FBBF24" : "#F43F5E";
      g.fillStyle = "rgba(255,255,255,0.12)";
      roundRectFill(g, x0, 104, right - x0, 10, 5);
      g.fillStyle = hc;
      roundRectFill(g, x0, 104, Math.max(10, (right - x0) * hpr), 10, 5);
      g.fillStyle = "rgba(255,255,255,0.55)";
      g.font = `900 11px ${mono}`;
      g.textAlign = "left";
      g.fillText("HP", x0, 120);
      // 진행 (얇게)
      const prog = Math.max(0, Math.min(1, t / songEnd));
      g.fillStyle = "rgba(255,255,255,0.12)";
      g.fillRect(x0, 138, right - x0, 4);
      g.fillStyle = song.color;
      g.fillRect(x0, 138, (right - x0) * prog, 4);
    };

    /** 바닥(배경·레인 판·정보판) + 박자 빛 + 정보판 글자 */
    const drawBackdrop = (t: number, pulse: number) => {
      if (staticLayer) g.drawImage(staticLayer, 0, 0, CW, CH);
      else {
        g.fillStyle = "#070814";
        g.fillRect(0, 0, CW, CH);
      }
      if (beatGlow && pulse > 0.02 && quality >= 3) {
        g.globalAlpha = pulse * 0.3; // 박자 번쩍임은 은은하게 (눈 아프지 않게)
        g.drawImage(beatGlow, 0, 0, CW, CH);
        g.globalAlpha = 1;
      }
      if (portrait) return drawHudPortrait(t);

      // ── 곡 정보 ──
      const ib = infoBox;
      const tx = ib.x + 20 + coverSize + 18; // 커버 오른쪽
      const tw = ib.x + ib.w - 20 - tx;
      const sec = t > 0 ? secName(t) : "";
      g.textAlign = "left";
      g.textBaseline = "top";
      g.fillStyle = "rgba(255,255,255,0.5)";
      g.font = `700 12px ${mono}`;
      g.fillText("NOW PLAYING", tx, ib.y + 24);
      // 제목: 넓으면 커버 옆, 좁으면 커버 아래 한 줄 전체
      const titleX = infoWide ? tx : ib.x + 20;
      const titleW = infoWide ? tw : ib.w - 40;
      const titleY = infoWide ? ib.y + 44 : ib.y + 20 + coverSize + 14;
      // 제목: 한글·긴 파일 이름도 자연스럽게 — 나눔고딕, 넘치면 말줄임 (글자를 눌러 찌그러뜨리지 않음)
      g.fillStyle = "#fff";
      g.font = `800 ${infoWide ? 28 : 22}px ${KR_FONT}`;
      g.fillText(titleFit(g.font, titleW), titleX, titleY);
      const y0 = infoWide ? ib.y + 86 : ib.y + 46;
      g.fillStyle = diffInfo.color;
      g.font = `800 15px ${KR_FONT}`;
      g.fillText(diffInfo.label, tx, y0, tw);
      g.fillStyle = "#fff";
      g.font = `900 22px ${disp}`;
      g.fillText(`Lv.${chart.level}`, tx, y0 + 20, tw);
      g.fillStyle = "rgba(255,255,255,0.55)";
      g.font = `700 12px ${mono}`;
      g.fillText(
        `${song.artist ? `${song.artist} · ` : ""}${Math.round(song.bpmLabel ?? song.bpm)} BPM · x${live.speed.toFixed(1)}`,
        tx,
        y0 + 50,
        tw
      );
      if (sec) {
        g.fillStyle = song.color;
        g.font = `800 12px ${mono}`;
        g.fillText(
          `▶ ${sec.toUpperCase()}`,
          infoWide ? tx : ib.x + 20,
          infoWide ? y0 + 70 : titleY + 34,
          infoWide ? tw : ib.w - 40
        );
      }
      // 진행 바
      const px0 = infoWide ? tx : ib.x + 20;
      const pw = infoWide ? tw : ib.w - 40;
      const py = ib.y + ib.h - 22;
      const prog = Math.max(0, Math.min(1, t / songEnd));
      g.fillStyle = "rgba(255,255,255,0.12)";
      g.beginPath();
      g.roundRect(px0, py, pw, 6, 3);
      g.fill();
      g.fillStyle = song.color;
      g.beginPath();
      g.roundRect(px0, py, Math.max(6, pw * prog), 6, 3);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.45)";
      g.font = `600 11px ${mono}`;
      g.textAlign = "right";
      g.fillText(`${fmtTime(Math.max(0, t))} / ${fmtTime(songEnd + 2.5)}`, px0 + pw, py - 16);

      // ── 점수판: 글꼴을 모두 굵은 기울임(disp)으로 맞춤 ──
      const sb = scoreBox;
      const sx = sb.x + 24;
      const sw = sb.w - 48;
      const judged = judgedCount();
      const spaced = (px: number) => {
        (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px}px`;
      };
      g.textAlign = "left";
      g.fillStyle = "rgba(255,255,255,0.5)";
      g.font = `italic 900 12px ${disp}`;
      spaced(3);
      g.fillText("SCORE", sx, sb.y + 22);
      spaced(0);
      g.fillStyle = "#fff";
      g.font = `italic 900 ${Math.min(46, Math.max(30, sw / 7))}px ${disp}`;
      g.fillText(fmtScore(Math.round(shownScore)), sx, sb.y + 40, sw);
      const acc = engine.accuracy;
      const rk = judged ? rankOf(acc) : "-";
      // 랭크 · 정확도 · 최대 콤보 한 줄 (같은 높이·같은 글꼴)
      const ly = sb.y + 100;
      g.fillStyle = judged ? rankColorOf(rk) : "rgba(255,255,255,0.3)";
      g.font = `italic 900 24px ${disp}`;
      g.fillText(rk, sx, ly);
      g.fillStyle = judged ? "#fff" : "rgba(255,255,255,0.35)";
      g.font = `italic 900 20px ${disp}`;
      g.fillText(judged ? `${acc.toFixed(2)}%` : "--.--%", sx + 50, ly + 3);
      g.textAlign = "right";
      g.fillStyle = "#fff";
      g.font = `italic 900 20px ${disp}`;
      const mc = String(engine.maxCombo);
      g.fillText(mc, sx + sw, ly + 3);
      const mcW = g.measureText(mc).width;
      g.fillStyle = "rgba(255,255,255,0.5)";
      g.font = `italic 900 11px ${disp}`;
      spaced(1.5);
      g.fillText("MAX COMBO", sx + sw - mcW - 10, ly + 10);
      spaced(0);
      g.textAlign = "left";
      const rows: [string, number, string][] = [
        ["PERFECT", engine.counts.perfect, JUDGE_STYLE.perfect.color],
        ["GREAT", engine.counts.great, JUDGE_STYLE.great.color],
        ["GOOD", engine.counts.good, JUDGE_STYLE.good.color],
        ["MISS", engine.counts.miss, JUDGE_STYLE.miss.color],
      ];
      const rowTop = sb.y + 140;
      const rowH = Math.min(40, (sb.y + sb.h - 14 - rowTop) / 4);
      rows.forEach(([label, n, c], i) => {
        const y = rowTop + i * rowH;
        g.fillStyle = "rgba(255,255,255,0.05)";
        g.beginPath();
        g.roundRect(sx, y, sw, rowH - 6, 6);
        g.fill();
        g.fillStyle = c;
        g.fillRect(sx, y, 4, rowH - 6);
        // 점수·랭크와 같은 굵은 기울임 글꼴로 (따로 놀지 않게)
        g.font = `italic 900 15px ${disp}`;
        g.textBaseline = "middle";
        g.fillText(label, sx + 16, y + (rowH - 6) / 2 + 1);
        g.fillStyle = "#fff";
        g.textAlign = "right";
        g.font = `italic 900 19px ${disp}`;
        g.fillText(String(n), sx + sw - 14, y + (rowH - 6) / 2 + 1);
        g.textAlign = "left";
        g.textBaseline = "top";
      });
    };

    const draw = (t: number) => {
      const laneW = W / 4;
      // 박자 위상 (0: 박자 순간) → 판정선·배경이 박자에 맞춰 번쩍
      const bt = t - (song.beatOffset ?? 0);
      const beatPh = bt > 0 ? (((bt % beatSec) + beatSec) % beatSec) / beatSec : 1;
      const pulse = t > 0 ? Math.exp(-beatPh * 5) : 0;
      shownScore += (engine.score - shownScore) * 0.18;
      drawBackdrop(t, pulse);
      g.save();
      g.translate(gx, 0);
      for (let l = 0; l < 4; l++) {
        if (engine.pressed[l]) {
          g.fillStyle = cachedGrad(`lane${l}`, () => {
            const grad = g.createLinearGradient(0, judgeY, 0, judgeY - H * 0.5);
            grad.addColorStop(0, `${laneColor(l)}55`);
            grad.addColorStop(1, `${laneColor(l)}00`);
            return grad;
          });
          g.fillRect(l * laneW, judgeY - H * 0.5, laneW, H * 0.5);
        }
      }

      // 노트 (판정선 아래로 내려간 건 틀에 가려지게 잘라냄)
      g.save();
      g.beginPath();
      g.rect(-4, laneTop, W + 8, judgeY + 6 - laneTop);
      g.clip();
      const yOf = (time: number) => judgeY - ((time - t) / vis) * (judgeY - laneTop);
      // 마디선(osu처럼): 마디 첫 박마다 가로줄이 노트와 같이 내려와서 박자 읽기 쉽게
      g.fillStyle = "rgba(255,255,255,0.38)";
      for (let kk = Math.ceil((t - barStart) / barSec); barStart + kk * barSec < t + vis; kk++) {
        const bt0 = barStart + kk * barSec;
        if (bt0 < 0) continue;
        const y = yOf(bt0);
        if (y < judgeY) g.fillRect(0, y - 1, W, 2);
      }
      // 가림 옵션: y(0=위, judgeY=판정선) 위치에 따른 투명도
      const coverAlpha = (y: number) => {
        if (coverMode === "none") return 1;
        const r = (y - laneTop) / (judgeY - laneTop); // 0 위 → 1 판정선
        if (coverMode === "fade") return r < 0.55 ? 1 : Math.max(0, 1 - (r - 0.55) / 0.3);
        // 서든: 위쪽 30%만 가리고 아래 70%는 보임 (반응 시간은 남기면서 미리 읽기만 막음)
        return r < 0.3 ? 0 : Math.min(1, (r - 0.3) / 0.1);
      };
      while (drawFrom < engine.notes.length && engine.notes[drawFrom].t < t - 4) drawFrom++;
      for (let i = drawFrom; i < engine.notes.length; i++) {
        const n = engine.notes[i];
        if (n.t > t + vis + 0.1) break;
        const x = n.lane * laneW;
        const c = laneColor(n.lane);
        if (n.end) {
          if (n.tail === "perfect") continue;
          // 머리는 쳤는데 일찍 뗀 롱노트: 남은 몸통은 바로 없앰 (회색으로 계속 내려오면 남아 있는 느낌)
          if (n.head && n.head !== "miss" && n.tail === "miss") continue;
          const dead = n.head === "miss" || n.tail === "miss";
          const yHead = n.holding ? judgeY : yOf(n.t);
          const yTail = Math.max(-20, yOf(n.end));
          if (yTail > judgeY + 6) continue;
          const bc = dead ? "#555555" : c;
          const ca = n.holding ? 1 : coverAlpha(yHead);
          if (ca <= 0 && coverAlpha(yTail) <= 0) continue;
          g.globalAlpha = n.holding ? 1 : Math.max(ca, coverAlpha(yTail) * 0.6);
          drawHoldBody(g, skin, x, yHead, yTail, laneW, bc, dead ? 0.25 : n.holding ? 0.85 : 0.6);
          g.globalAlpha = (dead ? 0.35 : 1) * ca;
          if (g.globalAlpha > 0) drawHead(g, skin, x, yHead, laneW, dead ? "#666666" : c);
          g.globalAlpha = 1;
        } else {
          if (n.head && n.head !== "miss") continue;
          const y = yOf(n.t);
          if (y > judgeY + 30) continue;
          const ca = n.head === "miss" ? 0.3 : coverAlpha(y);
          if (ca <= 0) continue;
          g.globalAlpha = ca;
          drawHead(g, skin, x, y, laneW, c);
          g.globalAlpha = 1;
        }
      }
      g.restore();
      g.restore(); // translate(gx)

      // 레인 틀 (기둥·패드)
      if (gearLayer) g.drawImage(gearLayer, gearX, gearY, gearW, gearH);
      // 판정선: 틀의 네온 줄 위에 박자마다 번쩍
      g.save();
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.25 + 0.3 * pulse;
      g.fillStyle = cachedGrad("judge", () => {
        const jl = g.createLinearGradient(0, judgeY - 10, 0, judgeY + 10);
        jl.addColorStop(0, "rgba(255,255,255,0)");
        jl.addColorStop(0.5, "rgba(255,255,255,0.9)");
        jl.addColorStop(1, "rgba(255,255,255,0)");
        return jl;
      });
      g.fillRect(gx, judgeY - 10, W, 20);
      g.restore();
      // 패드: 누르면 빛남 + 키 글자
      for (let l = 0; l < 4; l++) {
        const q = GEAR.pads[l];
        const on = engine.pressed[l];
        if (on) {
          g.save();
          g.globalCompositeOperation = "lighter";
          g.fillStyle = cachedGrad(`pad${l}`, () => {
            const pg = g.createLinearGradient(0, gy(q[1]), 0, gy(q[5]));
            pg.addColorStop(0, `${laneColor(l)}30`);
            pg.addColorStop(1, `${laneColor(l)}90`);
            return pg;
          });
          g.beginPath();
          g.moveTo(gpx(q[0]), gy(q[1]));
          g.lineTo(gpx(q[2]), gy(q[3]));
          g.lineTo(gpx(q[4]), gy(q[5]));
          g.lineTo(gpx(q[6]), gy(q[7]));
          g.closePath();
          g.fill();
          g.restore();
        }
        // 글자도 패드 기울기만큼 기울여서
        const slant = ((q[6] - q[0] + (q[4] - q[2])) / 2 / (q[5] - q[1])) * 1;
        g.save();
        g.translate(gpx(GEAR.padCx[l]), gy(GEAR.padCy));
        g.transform(1, 0, slant, 1, 0, 0);
        g.fillStyle = on ? "#fff" : "rgba(255,255,255,0.5)";
        g.font = `900 22px ${disp}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(KEY_LABELS[l], 0, 0);
        g.restore();
      }

      g.save();
      g.translate(gx, 0);
      // 롱노트 누르는 중: 판정선에서 불꽃이 계속 튐
      if (t - lastSparkAt > 0.035) {
        lastSparkAt = t;
        for (let l = 0; l < 4; l++)
          if (engine.holding[l]) spawnSparks(l, t, 2, laneColor(l), 260, laneW, judgeY);
      }

      g.save();
      g.globalCompositeOperation = "lighter";
      // 타격 효과: 레인 빛기둥 + 터지는 빛 (hit.webp 6프레임)
      for (let kk = bursts.length - 1; kk >= 0; kk--) {
        const f = bursts[kk];
        const age = t - f.at;
        if (age > 0.4 || age < -0.5) {
          bursts.splice(kk, 1);
          continue;
        }
        const p = Math.max(0, age) / 0.4;
        const col = f.judge === "perfect" ? laneColor(f.lane) : JUDGE_STYLE[f.judge].color;
        const cx = f.lane * laneW + laneW / 2;
        const fade = 1 - p;
        const beamH = H * (f.big ? 0.55 : 0.4) * (0.6 + 0.4 * Math.min(1, p * 4));
        const beam = g.createLinearGradient(0, judgeY, 0, judgeY - beamH);
        beam.addColorStop(0, `${col}${hex2(0.65 * fade * fade)}`);
        beam.addColorStop(1, `${col}00`);
        g.fillStyle = beam;
        const bw = laneW * (0.9 - 0.3 * p);
        g.fillRect(cx - bw / 2, judgeY - beamH, bw, beamH);
        if (ready(hitImg) && age >= 0) {
          const fr = Math.min(5, Math.floor(age / 0.05));
          if (age < 0.3) {
            const cell = hitImg.naturalHeight;
            const sz = laneW * (f.big ? 2.8 : 2.1);
            g.drawImage(hitImg, fr * cell, 0, cell, cell, cx - sz / 2, judgeY - sz / 2, sz, sz);
          }
        }
      }
      // 불꽃
      for (let kk = sparks.length - 1; kk >= 0; kk--) {
        const sp = sparks[kk];
        const age = t - sp.at;
        if (age > sp.life || age < -0.5) {
          sparks.splice(kk, 1);
          continue;
        }
        const a = Math.max(0, age);
        const px = sp.x + sp.vx * a;
        const py = sp.y + sp.vy * a + 900 * a * a;
        g.globalAlpha = 1 - a / sp.life;
        g.fillStyle = sp.color;
        g.fillRect(px - sp.size / 2, py - sp.size / 2, sp.size, sp.size);
      }
      g.globalAlpha = 1;
      g.restore();
      g.restore(); // translate(gx)

      // HP 게이지: 기어 기둥 바깥 (세로 화면은 위 띠에 가로로)
      if (!portrait) {
        const hpr = engine.hp / HP_MAX;
        const top = 70;
        const bh = judgeY - 20 - top;
        const low = hpr < 0.3;
        const blink = low ? 0.55 + 0.45 * Math.sin(performance.now() / 90) : 1;
        g.fillStyle = "rgba(0,0,0,0.6)";
        g.beginPath();
        g.roundRect(hpX - 2, top - 2, 14, bh + 4, 7);
        g.fill();
        const hc = hpr > 0.6 ? "#4ADE80" : hpr > 0.3 ? "#FBBF24" : "#F43F5E";
        g.globalAlpha = blink;
        g.fillStyle = hc;
        if (quality >= 2) {
          g.shadowColor = hc;
          g.shadowBlur = 10;
        }
        g.beginPath();
        g.roundRect(hpX, top + bh * (1 - hpr), 10, Math.max(0.1, bh * hpr), 5);
        g.fill();
        g.shadowBlur = 0;
        g.globalAlpha = 1;
        g.fillStyle = "rgba(255,255,255,0.7)";
        g.font = `900 11px ${mono}`;
        g.textAlign = "center";
        g.textBaseline = "bottom";
        g.fillText("HP", hpX + 5, top - 6);
      }

      g.save();
      g.translate(gx, 0);
      // 판정 글자 (그림): 판정선 조금 위 — 콤보는 위쪽에 따로 (디맥 배치)
      const jy = judgeY - 150;
      if (lastJudge && t - lastJudge.at < 0.6) {
        const age = Math.max(0, t - lastJudge.at);
        const pop = Math.min(1, age / 0.14);
        const miss = lastJudge.judge === "miss";
        // 크게 튀어나왔다가 제자리로(오버슈트), 위로 살짝 떠오르며 사라짐. 미스는 흔들림
        const sc = miss ? 1.1 - 0.1 * pop : 1.3 - 0.3 * easeOutBack(pop);
        const shake = miss ? Math.sin(age * 90) * 7 * (1 - pop) : 0;
        const yy = jy - (miss ? -age * 18 : pop * 6);
        const im = judgeImg[lastJudge.judge];
        g.save();
        // 노트를 가리지 않게 살짝 비침
        g.globalAlpha = 0.55 * (age < 0.42 ? 1 : Math.max(0, 1 - (age - 0.42) / 0.18));
        g.translate(W / 2 + shake, yy);
        g.scale(sc, sc);
        if (ready(im)) {
          const iw = 180;
          const ih = (iw * im.naturalHeight) / im.naturalWidth;
          g.drawImage(im, -iw / 2, -ih / 2, iw, ih);
        } else {
          const s = JUDGE_STYLE[lastJudge.judge];
          g.font = `900 38px ${disp}`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillStyle = s.color;
          g.fillText(s.text, 0, 0);
        }
        g.restore();
      }
      // 콤보: 레인 위쪽에 COMBO 글자 + 은색 큰 숫자 (오를 때마다 살짝 튐)
      const cyC = portrait ? midY(0.2) : H * 0.2;
      const ringAge = t - ringAt;
      if (ready(ringImg) && ringAge >= 0 && ringAge < 0.5) {
        const fr = Math.min(3, Math.floor(ringAge / 0.125));
        const cell = ringImg.naturalHeight;
        const sz = 220 + ringAge * 240;
        g.save();
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = 1 - ringAge / 0.5;
        g.drawImage(ringImg, fr * cell, 0, cell, cell, W / 2 - sz / 2, cyC - sz / 2, sz, sz);
        g.restore();
      }
      const comboFont = "Impact, 'Arial Narrow', 'Arial Black', sans-serif";
      if (engine.combo >= 2) {
        const bump = Math.max(0, 1 - (t - comboAt) / 0.1);
        const gold = Math.max(0, 1 - ringAge / 0.6); // 50콤보마다 잠깐 금빛
        const cc = engine.combo;
        const size = 72;
        const txt = String(cc);
        g.save();
        g.globalAlpha = 0.65; // 노트가 비쳐 보이게
        g.translate(W / 2, cyC);
        g.scale(1 + 0.1 * bump, 1 + 0.1 * bump);
        g.textAlign = "center";
        g.textBaseline = "middle";
        // COMBO 글자도 숫자와 같은 글꼴·은색
        g.font = `20px ${comboFont}`;
        (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "6px";
        g.lineWidth = 4;
        g.lineJoin = "round";
        g.strokeStyle = "rgba(10,10,20,0.75)";
        g.strokeText("COMBO", 3, -size / 2 - 8);
        g.fillStyle = cachedGrad("comboLabel", () => {
          const lg = g.createLinearGradient(0, -size / 2 - 18, 0, -size / 2 + 2);
          lg.addColorStop(0, "#FFFFFF");
          lg.addColorStop(1, "#94A3B8");
          return lg;
        });
        g.fillText("COMBO", 3, -size / 2 - 8);
        (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0px";
        g.font = `${size}px ${comboFont}`;
        g.lineJoin = "round";
        g.lineWidth = 5;
        g.strokeStyle = "rgba(10,10,20,0.75)";
        g.strokeText(txt, 0, 4);
        g.fillStyle = cachedGrad(gold > 0 ? "comboGold" : "comboSilver", () => {
          const gr = g.createLinearGradient(0, -size / 2, 0, size / 2);
          gr.addColorStop(0, "#FFFFFF");
          gr.addColorStop(0.45, gold > 0 ? "#FDE68A" : "#E2E8F0");
          gr.addColorStop(0.5, gold > 0 ? "#D97706" : "#94A3B8");
          gr.addColorStop(1, gold > 0 ? "#FEF3C7" : "#CBD5E1");
          return gr;
        });
        g.fillText(txt, 0, 4);
        g.restore();
      } else if (t - breakAt < 0.6 && breakFrom >= 20) {
        // 콤보 끊김: 숫자가 붉게 흔들리며 떨어짐
        const a = t - breakAt;
        g.globalAlpha = 0.9 * (1 - a / 0.6);
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = `72px ${comboFont}`;
        g.fillStyle = "#F87171";
        g.fillText(
          String(breakFrom),
          W / 2 + Math.sin(a * 80) * 6 * (1 - a / 0.6),
          cyC + 4 + a * 50
        );
        g.globalAlpha = 1;
      }
      // 속도 바꿨을 때 잠깐 표시
      const sAge = performance.now() / 1000 - speedToastAt;
      if (sAge < 1) {
        g.globalAlpha = sAge < 0.7 ? 1 : (1 - sAge) / 0.3;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = "rgba(0,0,0,0.6)";
        roundRectFill(g, W / 2 - 80, midY(0.48) - 20, 160, 40, 20);
        g.fillStyle = "#fff";
        g.font = `800 17px ${mono}`;
        g.fillText(`SPEED x${live.speed.toFixed(1)}`, W / 2, midY(0.48));
        g.globalAlpha = 1;
      }
      drawCountdown(g, cd, t + leadIn, W, laneTop, judgeY);
      // R 꾹: 다시 시작 — 카운트다운처럼 비스듬한 띠에 게이지가 차오름
      if (rHoldAt !== null) {
        const pr = Math.min(1, (performance.now() - rHoldAt) / R_HOLD_MS);
        const bw = W - 24;
        const bh = 50;
        const cy = midY(0.567);
        g.save();
        g.translate(W / 2, cy);
        g.transform(1, -0.08, 0, 1, 0, 0);
        // 바탕
        g.fillStyle = "rgba(10,6,26,0.85)";
        g.fillRect(-bw / 2, -bh / 2, bw, bh);
        // 차오르는 게이지
        const fill = g.createLinearGradient(-bw / 2, 0, bw / 2, 0);
        fill.addColorStop(0, "#DB2777");
        fill.addColorStop(1, "#7C3AED");
        g.fillStyle = fill;
        g.shadowColor = "#EC4899";
        g.shadowBlur = 16;
        g.fillRect(-bw / 2, -bh / 2, bw * pr, bh);
        g.shadowBlur = 0;
        // 위아래 흰 줄
        g.fillStyle = "rgba(255,255,255,0.8)";
        g.fillRect(-bw / 2, -bh / 2, bw, 2);
        g.fillRect(-bw / 2, bh / 2 - 2, bw, 2);
        // 키캡 R
        const kx = -bw / 2 + 14;
        g.fillStyle = "rgba(255,255,255,0.95)";
        roundRectFill(g, kx, -15, 30, 30, 6);
        g.fillStyle = "#1a1030";
        g.font = `italic 900 18px ${disp}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("R", kx + 15, 1);
        // 글자
        g.fillStyle = "#fff";
        g.font = `italic 900 19px ${disp}`;
        (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "4px";
        g.fillText("RESTART", 18, 1);
        (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0px";
        g.restore();
      }
      g.restore();
    };

    let raf = 0;
    let running = true;
    let finished = false;
    const finish = (failed = false) => {
      if (finished) return;
      finished = true;
      running = false;
      const acc = engine.accuracy;
      onFinish({
        failed,
        songId: song.id,
        diff,
        score: engine.score,
        acc,
        rank: failed ? "F" : rankOf(acc),
        counts: { ...engine.counts },
        maxCombo: engine.maxCombo,
        fc: engine.fullCombo,
        ap: engine.allPerfect,
        fast,
        slow,
        ...timingOf(diffs),
      });
      reportAuto();
    };
    // 화면용 부드러운 시계: 오디오 시계(currentTime)는 오디오 버퍼 단위(수~십 ms)로 뚝뚝 끊겨 올라서
    // 그대로 쓰면 노트가 프레임마다 들쭉날쭉 움직여 잔상·분신처럼 보인다.
    // 그래서 performance.now()로 매끄럽게 흘리고, 오디오 시계와의 차이만 천천히 따라가게 한다.
    // 따라가는 정도는 프레임 수가 아니라 흐른 시간 기준(60Hz·120Hz·144Hz 같은 체감)
    let clockBase: number | null = null;
    let prevPerf = 0;
    const smoothNow = (perfMs: number) => {
      const audioT = now();
      const perfT = perfMs / 1000;
      const dt = prevPerf ? perfT - prevPerf : 1 / 60;
      prevPerf = perfT;
      if (clockBase === null || Math.abs(perfT + clockBase - audioT) > 0.03)
        clockBase = audioT - perfT; // 처음·일시정지 재개 등 크게 어긋나면 바로 맞춤
      else clockBase += (audioT - perfT - clockBase) * (1 - Math.exp(-dt / 0.3));
      return perfT + clockBase;
    };
    let prevCombo = 0;
    // 프레임 시간 측정 → 무거우면 효과를 한 단계씩 내림 (quality: 3 전부 · 2 박자 빛 끔 · 1 불꽃 절반·그림자 끔 · 0 해상도도 낮춤)
    const frameDt: number[] = [];
    let baseDt = 0;
    let lastFrameAt = 0;
    let qualityHold = 0;
    const measureFrame = (ts: number) => {
      if (lastFrameAt) {
        const dt = ts - lastFrameAt;
        if (dt < 200) frameDt.push(dt);
      }
      lastFrameAt = ts;
      if (frameDt.length < 90) return;
      const sorted = [...frameDt].sort((a, b) => a - b);
      // 주사율: 처음 90프레임 중 빠른 쪽 10% 지점 (60Hz ≈ 16.7, 120Hz ≈ 8.3)
      if (!baseDt) baseDt = Math.max(4, Math.min(20, sorted[Math.floor(sorted.length * 0.1)]));
      const p90 = sorted[Math.floor(sorted.length * 0.9)];
      frameDt.length = 0;
      qualityHold++;
      if (p90 > baseDt * 1.35 && quality > 0) {
        quality--;
        qualityHold = 0;
        if (quality === 0) resize(true);
      } else if (p90 < baseDt * 1.08 && quality < 3 && qualityHold >= 4) {
        // 4번(약 6초) 연속 가벼우면 한 단계 되돌림
        quality++;
        qualityHold = 0;
        if (quality === 1) resize(true);
      }
    };
    const frame = (ts: number) => {
      if (!running) return;
      if (rHoldAt !== null && performance.now() - rHoldAt >= R_HOLD_MS) {
        rHoldAt = null;
        running = false;
        onRestart();
        return;
      }
      measureFrame(ts);
      const t = smoothNow(ts);
      // 싱크가 잡히기 전(처음 몇 탭·곡 초반)엔 HP가 바닥나도 안 끝남 — 지연이 큰 기기는 첫 보정 전에 다 MISS라 죽어 버려서
      engine.noFail = !!song.practice || (tracker.grace && t < AUTO_SYNC.graceSec);
      engine.update(t - judgeSec()); // 지나간 노트 미스 처리도 타격 싱크 기준
      for (const e of engine.events) {
        lastJudge = e;
        if (e.tick) {
          // 롱노트 콤보 틱: 작은 불꽃만
          spawnSparks(e.lane, e.at, 4, laneColor(e.lane), 300, W / 4, judgeY);
          comboAt = e.at;
          continue;
        }
        if (e.diff !== undefined && e.judge !== "miss") diffs.push(e.diff);
        if (e.diff !== undefined && e.judge !== "miss" && Math.abs(e.diff * 1000) > FAST_SLOW_MS) {
          if (e.diff < 0) fast++;
          else slow++;
        }
        if (e.judge !== "miss") {
          const big = e.judge === "perfect";
          bursts.push({ lane: e.lane, at: e.at, judge: e.judge, big });
          const laneW = W / 4;
          spawnSparks(
            e.lane,
            e.at,
            big ? 14 : e.judge === "great" ? 8 : 4,
            big ? laneColor(e.lane) : JUDGE_STYLE[e.judge].color,
            big ? 520 : 380,
            laneW,
            judgeY
          );
          // 노트가 깨져 흩어지는 조각
          spawnShards(e.lane, e.at, laneColor(e.lane), laneW, judgeY);
          comboAt = e.at;
        }
      }
      engine.events.length = 0;
      // 50콤보마다 링 + 효과음, 20콤보 넘게 이어지다 끊기면 깨지는 소리
      const cc = engine.combo;
      if (cc > prevCombo && Math.floor(cc / 50) > Math.floor(prevCombo / 50)) {
        ringAt = t;
        sfx("combo-milestone", 0.55);
      } else if (cc < prevCombo && prevCombo >= 20) {
        breakAt = t;
        breakFrom = prevCombo;
        sfx("combo-break", 0.6);
      }
      prevCombo = cc;
      if (engine.dead) return fail(t);
      draw(t);
      if (engine.done && t > Math.max(engine.lastTime + 1.2, songEnd)) return finish();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // HP 바닥: 화면 멈추고 음악이 테이프 멈추듯 느려지며 꺼짐 → FAILED → 결과
    let failing = false;
    const fail = (tFail: number) => {
      if (failing) return;
      failing = true;
      running = false;
      const a = ctx.currentTime;
      try {
        src.playbackRate.setValueAtTime(1, a);
        src.playbackRate.linearRampToValueAtTime(0.05, a + 1.1);
        musicGain.gain.setValueAtTime(musicGain.gain.value, a);
        musicGain.gain.linearRampToValueAtTime(0, a + 1.2);
      } catch {}
      sfx("fail", 0.8);
      const t0 = performance.now();
      const tick = () => {
        if (!failing) return;
        const el = (performance.now() - t0) / 1000;
        draw(tFail);
        drawFailed(g, el, failImg, CW, CH);
        if (el >= 2.6) {
          failing = false;
          finish(true);
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    /**
     * 입력 이벤트가 실제로 발생한 시각(event.timeStamp)을 곡 시간으로.
     * 핸들러가 늦게 돌아도(프레임 사이 대기, GC 등) 누른 순간 기준으로 판정하려고.
     * 시계 대응은 화면 시계(smoothNow)와 같은 clockBase를 씀. 값이 이상하면 지금 시각으로.
     */
    const eventTime = (stamp: number) => {
      if (clockBase === null) return now();
      // 비교는 같은(부드러운) 시계끼리 — 오디오 시계(currentTime)는 버퍼 단위로 뚝뚝 올라서
      // 방금 들어온 입력이 '미래'로 보여 지금 시각으로 떨어지곤 했음(버퍼가 큰 모바일·블루투스에서 5~20ms 일찍 판정)
      const pn = performance.now();
      const st = Number.isFinite(stamp) && stamp <= pn + 1 && pn - stamp < 200 ? stamp : pn;
      return st / 1000 + clockBase;
    };
    const press = (lane: number, stamp = NaN) => {
      if (!running) return;
      if (live.hit > 0) {
        const src = ctx.createBufferSource();
        src.buffer = hitBuf;
        src.connect(hitGain);
        src.start();
      }
      const t = eventTime(stamp);
      const tj = t - judgeSec();
      engine.press(lane, tj);
      const d = nearestDiff(lane, tj);
      if (d !== null) autoSyncTap(d);
    };
    const release = (lane: number, stamp = NaN) => {
      if (!running) return;
      engine.release(lane, eventTime(stamp) - judgeSec());
    };

    // 재개 카운트다운 (멈춘 화면 위에 3·2·1, 끝나면 음악 재개)
    let resuming = false;
    const RESUME_PHASES: Phase[] = [
      { label: "3", from: 0, dur: 1, color: "#60A5FA", size: 110 },
      { label: "2", from: 1, dur: 1, color: "#FBBF24", size: 110 },
      { label: "1", from: 2, dur: 1, color: "#F43F5E", size: 110 },
    ];

    // 재개 시도 번호: 카운트다운 도중·오디오 재개 대기 중에 다시 멈추면 이전 시도는 무시되게
    let resumeSeq = 0;
    const pause = () => {
      if (resuming) {
        // 카운트다운 중(또는 오디오 재개 대기 중)에 다시 Esc → 일시정지로 돌아감
        resuming = false;
        resumeSeq++;
        cancelAnimationFrame(raf);
        setPauseStats({
          score: engine.score,
          acc: engine.accuracy,
          combo: engine.maxCombo,
          judged: judgedCount(),
        });
        setPaused(true);
        return;
      }
      if (!running || finished || failing) return;
      running = false;
      cancelAnimationFrame(raf);
      // 누르던 키는 뗀 걸로 (롱노트 중이면 끊김)
      const t = now() - judgeSec();
      for (let l = 0; l < 4; l++) if (engine.pressed[l]) engine.release(l, t);
      ctx.suspend();
      reportAuto();
      setPauseStats({
        score: engine.score,
        acc: engine.accuracy,
        combo: engine.maxCombo,
        judged: judgedCount(),
      });
      setPaused(true);
    };
    const resume = () => {
      if (running || finished || resuming || failing) return;
      setPaused(false);
      resuming = true;
      const seq = ++resumeSeq;
      const frozen = now(); // 오디오가 멈춰 있어서 시간도 그대로
      lastJudge = null; // 카운트다운 숫자와 겹치지 않게
      // 시작 카운트다운(READY·3·2·1·GO) 도중에 멈췄으면 그 카운트다운이 이어지니 3·2·1을 또 띄우지 않음
      const startCdEnd = cd[cd.length - 1].from + cd[cd.length - 1].dur;
      const wait = frozen + leadIn < startCdEnd ? 0 : 3;
      const t0 = performance.now();
      const tick = () => {
        if (!resuming || seq !== resumeSeq) return;
        const el = (performance.now() - t0) / 1000;
        draw(frozen);
        if (wait > 0) {
          g.save();
          g.translate(gx, 0);
          drawCountdown(g, RESUME_PHASES, el, W, laneTop, judgeY);
          g.restore();
        }
        if (el >= wait) {
          // resuming은 오디오가 실제로 다시 돌 때까지 유지 (그 사이 Esc가 재개를 또 부르지 않게)
          ctx.resume().then(() => {
            if (seq !== resumeSeq || !resuming) {
              ctx.suspend(); // 기다리는 사이 다시 멈춤
              return;
            }
            resuming = false;
            running = true;
            lastFrameAt = 0;
            raf = requestAnimationFrame(frame);
          });
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    /** 설정 바로 반영 (일시정지 화면·속도 단축키) */
    const apply = (p: Partial<LiveSettings>) => {
      Object.assign(live, p);
      if (p.speed !== undefined) vis = visibleSec(live.speed);
      if (p.music !== undefined) musicGain.gain.value = live.music;
      if (p.hit !== undefined) hitGain.gain.value = live.hit * 0.9;
    };
    ctrl.current = { pause, resume, apply };

    const onKeyDown = (e: KeyboardEvent) => {
      // 플레이 중엔 스페이스·PageDown 등으로 페이지가 스크롤되지 않게 (일시정지 중엔 버튼·슬라이더 조작용으로 둠)
      if ((running || resuming) && SCROLL_KEYS.has(e.code)) {
        e.preventDefault();
        return;
      }
      // R: 플레이 중엔 꾹 누르면 다시 시작, 일시정지 중엔 바로 다시 시작
      if (e.code === "KeyR") {
        e.preventDefault();
        if (e.repeat) return;
        if (running) rHoldAt = performance.now();
        else if (!resuming && !finished && !failing) onRestart();
        return;
      }
      if (e.code === "Escape") {
        e.preventDefault();
        if (e.repeat) return; // 꾹 누르고 있으면 멈춤·재개가 연달아 일어나던 문제
        if (running || resuming) pause();
        else resume();
        return;
      }
      // 플레이 중 속도 조절: ↑ ↓ (0.1씩)
      if ((e.code === "ArrowUp" || e.code === "ArrowDown") && running) {
        e.preventDefault();
        const sp =
          Math.round(
            Math.max(1, Math.min(8, live.speed + (e.code === "ArrowUp" ? 0.1 : -0.1))) * 10
          ) / 10;
        apply({ speed: sp });
        onSettings({ speed: sp });
        setLiveUi((v) => ({ ...v, speed: sp }));
        speedToastAt = performance.now() / 1000;
        return;
      }
      const lane = KEY_CODES.indexOf(e.code);
      if (lane < 0) return;
      e.preventDefault();
      if (!e.repeat) press(lane, e.timeStamp);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "KeyR") rHoldAt = null;
      const lane = KEY_CODES.indexOf(e.code);
      if (lane >= 0) release(lane, e.timeStamp);
    };
    const laneAt = (clientX: number) => {
      const r = canvas.getBoundingClientRect();
      const x = ((clientX - r.left) / r.width) * CW - gx; // 레인 기준 위치
      return Math.max(0, Math.min(3, Math.floor((x / W) * 4)));
    };
    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      const lane = laneAt(e.clientX);
      lanePointer.set(e.pointerId, lane);
      press(lane, e.timeStamp);
    };
    const onPointerUp = (e: PointerEvent) => {
      const lane = lanePointer.get(e.pointerId);
      if (lane === undefined) return;
      lanePointer.delete(e.pointerId);
      // 같은 레인을 다른 손가락이 아직 누르고 있으면 유지
      if (![...lanePointer.values()].includes(lane)) release(lane, e.timeStamp);
    };
    const onVisibility = () => {
      if (document.hidden) pause();
    };
    // 창이 포커스를 잃으면(alt-tab 등) keyup을 못 받아 눌린 채로 남음 → 전부 뗀 걸로
    const onBlur = () => {
      const t = now() - judgeSec();
      for (let l = 0; l < 4; l++) if (engine.pressed[l]) engine.release(l, t);
      rHoldAt = null;
    };
    // 전체화면이 풀리면(안드로이드 뒤로가기는 먼저 전체화면을 끔) 일시정지
    const onFullscreen = () => {
      if (!document.fullscreenElement && (running || resuming)) pause();
    };
    // 모바일 뒤로가기: 플레이 중이면 일시정지(기록을 다시 쌓아 다음 뒤로가기도 잡음), 일시정지 중이면 곡 선택으로.
    // 처음 기록은 부모(RhythmGame)가 플레이 화면에 들어올 때 쌓음
    const onPop = () => {
      if (finished || failing) return;
      if (running || resuming) {
        pause();
        window.history.pushState({ ...window.history.state, [PLAY_HISTORY_KEY]: true }, "");
      } else onQuit();
    };
    const noMenu = (e: Event) => e.preventDefault();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("contextmenu", noMenu);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("popstate", onPop);
    document.addEventListener("fullscreenchange", onFullscreen);

    return () => {
      reportAuto();
      running = false;
      resuming = false;
      failing = false;
      cancelAnimationFrame(raf);
      for (const o of beeps) {
        try {
          o.stop();
        } catch {}
      }
      if (!stopped) {
        stopped = true;
        try {
          src.stop();
        } catch {}
        src.disconnect();
      }
      if (ctx.state === "suspended") ctx.resume();
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("contextmenu", noMenu);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
    // 한 판 동안 설정은 고정 (재시작은 부모가 key를 바꿔 새로 마운트)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pbtn =
    "cursor-pointer rounded-[0.8cqw] border border-white/20 bg-[#1d1838] px-[1.6cqw] py-[0.7cqw] font-mono text-[1.3cqw] whitespace-nowrap text-white/85 transition-colors hover:border-[#A78BFA] hover:bg-[#A78BFA]/15 hover:text-white";
  const rk = rankOf(pauseStats.acc);

  return (
    <div
      ref={wrapRef}
      className={`absolute inset-0 overflow-hidden ${portrait ? "flex items-center justify-center bg-black" : ""}`}
    >
      <canvas
        ref={canvasRef}
        className={`touch-none select-none ${portrait ? "block" : "absolute inset-0 h-full w-full"}`}
      />
      {/* 세로 화면은 프레임 폭이 좁아서 버튼·일시정지 창을 크게 (zoom) */}
      <div
        className={`absolute z-10 flex gap-[0.6cqw] ${portrait ? "top-[1.2cqw] left-[1.2cqw]" : "top-[1.2cqw] right-[1.2cqw]"}`}
        style={portrait ? { zoom: 2.6 } : undefined}
      >
        <button
          type="button"
          onClick={() => ctrl.current.pause()}
          className="cursor-pointer rounded-[0.6cqw] bg-black/55 px-[0.9cqw] py-[0.35cqw] font-mono text-[1.1cqw] text-white/70 hover:bg-white/20 hover:text-white"
        >
          {portrait ? "II" : "II 일시정지 (Esc)"}
        </button>
        <button
          type="button"
          onClick={onToggleFs}
          title={fs ? "전체화면 끄기" : "전체화면"}
          className="cursor-pointer rounded-[0.6cqw] bg-black/55 px-[0.9cqw] py-[0.35cqw] font-mono text-[1.1cqw] text-white/70 hover:bg-white/20 hover:text-white"
        >
          {fs ? "✕" : "⛶"}
        </button>
      </div>
      {paused && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#05030f]/92 backdrop-blur-[4px] [animation:modal-fade_200ms_ease-out]">
          <div
            className={`flex flex-col items-center gap-[1cqw] ${portrait ? "w-[36cqw]" : "w-[52cqw]"}`}
            style={portrait ? { zoom: 2.6 } : undefined}
          >
            <p className="font-['Arial_Black',sans-serif] text-[3.4cqw] font-black tracking-[0.2em] text-white italic drop-shadow-[0_0_1.2cqw_#A78BFA]">
              PAUSE
            </p>
            <div className="flex w-full items-center gap-[1.6cqw] rounded-[1cqw] border border-white/15 bg-[#17132f] px-[1.6cqw] py-[0.9cqw] font-mono">
              {pauseStats.judged > 0 ? (
                <RankEmblem rank={rk} className="h-[5.6cqw] w-[5.6cqw]" />
              ) : (
                <span className="flex h-[5.6cqw] w-[5.6cqw] items-center justify-center rounded-full border-[0.2cqw] border-dashed border-white/20 font-['Arial_Black',sans-serif] text-[2cqw] text-white/30 italic">
                  ?
                </span>
              )}
              <div className="flex min-w-0 flex-col text-[1.1cqw] text-white/55">
                <span className="text-[2.2cqw] font-black text-white tabular-nums">
                  {pauseStats.score.toLocaleString("en-US")}
                </span>
                <span>
                  정확도 {pauseStats.judged > 0 ? `${pauseStats.acc.toFixed(2)}%` : "—"} · 최대 콤보{" "}
                  {pauseStats.combo}
                </span>
              </div>
            </div>
            <div className="w-full rounded-[1cqw] border border-white/15 bg-[#17132f] px-[1.4cqw] py-[0.8cqw]">
              <PauseRow
                label="노트 속도"
                value={`x${liveUi.speed.toFixed(1)}`}
                onMinus={() => change({ speed: clamp(round1(liveUi.speed - 0.1), 1, 8) })}
                onPlus={() => change({ speed: clamp(round1(liveUi.speed + 0.1), 1, 8) })}
              />
              <PauseSlider
                label="음악 볼륨"
                value={liveUi.music}
                onChange={(v) => change({ music: v })}
              />
              <PauseSlider
                label="타격음 볼륨"
                value={liveUi.hit}
                onChange={(v) => change({ hit: v })}
              />
            </div>
            <div
              className={`mt-[0.4cqw] flex justify-center gap-[0.8cqw] ${portrait ? "flex-wrap" : ""}`}
            >
              <button
                type="button"
                className={`${pbtn} border-[#A78BFA]/60 bg-[#A78BFA]/20`}
                onClick={() => ctrl.current.resume()}
              >
                계속하기 (Esc)
              </button>
              <button type="button" className={pbtn} onClick={onRestart}>
                처음부터 (R)
              </button>
              <button type="button" className={pbtn} onClick={onToggleFs}>
                {fs ? "전체화면 끄기" : "⛶ 전체화면"}
              </button>
              <button type="button" className={pbtn} onClick={onQuit}>
                곡 선택으로
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 랭크 엠블럼 그림 (S+ S A B C F) */
export const rankImg = (rank: string) =>
  `/rhythm/rank-${rank === "S+" ? "splus" : rank === "D" ? "f" : rank.toLowerCase()}.webp`;
export function RankEmblem({ rank, className = "" }: { rank: string; className?: string }) {
  return (
    <img
      src={rankImg(rank)}
      alt={rank}
      draggable={false}
      className={`object-contain ${className}`}
    />
  );
}

const KR_FONT = "'Nanum Gothic', 'Malgun Gothic', sans-serif";
/** 폭을 넘으면 끝을 …로 */
function ellipsis(g: CanvasRenderingContext2D, text: string, max: number) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** 곡 색이 붉은·분홍 계열인지 (플레이 배경 고르기) */
function warm(hex: string) {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return false;
  let h =
    max === r
      ? ((g - b) / (max - min)) % 6
      : max === g
        ? (b - r) / (max - min) + 2
        : (r - g) / (max - min) + 4;
  h = (h * 60 + 360) % 360;
  return h >= 270 || h < 50;
}

/** 정보판 유리 판 */
function glass(
  b: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  accent: string
) {
  b.save();
  b.fillStyle = "rgba(6,7,20,0.62)";
  b.beginPath();
  b.roundRect(x, y, w, h, 16);
  b.fill();
  const edge = b.createLinearGradient(x, y, x + w, y + h);
  edge.addColorStop(0, `${accent}aa`);
  edge.addColorStop(0.5, "rgba(255,255,255,0.12)");
  edge.addColorStop(1, `${accent}55`);
  b.strokeStyle = edge;
  b.lineWidth = 1.5;
  b.stroke();
  b.fillStyle = accent;
  b.fillRect(x + 20, y, 60, 3);
  b.restore();
}

const fmtTime = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** 0~1 투명도 → "#rrggbb" 뒤에 붙일 두 자리 16진수 */
const hex2 = (a: number) =>
  Math.round(Math.max(0, Math.min(1, a)) * 255)
    .toString(16)
    .padStart(2, "0");

// ───────────────────────── 카운트다운 ─────────────────────────

interface Phase {
  label: string;
  from: number;
  dur: number;
  color: string;
  size: number;
  beep?: number;
}

function countdownPhases(): Phase[] {
  const list: Omit<Phase, "from">[] = [
    { label: "READY", dur: 1.2, color: "#FFFFFF", size: 54 },
    { label: "3", dur: 0.7, color: "#60A5FA", size: 120, beep: 660 },
    { label: "2", dur: 0.7, color: "#FBBF24", size: 120, beep: 660 },
    { label: "1", dur: 0.7, color: "#F43F5E", size: 120, beep: 660 },
    { label: "GO!", dur: 0.6, color: "#F472B6", size: 96, beep: 1320 },
  ];
  let from = 0;
  return list.map((p) => {
    const out = { ...p, from };
    from += p.dur;
    return out;
  });
}

const easeOutBack = (x: number) => {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/** 카운트다운 글꼴 (판정·콤보 그림과 어울리게 굵은 기울임) */
const CD_FONT = "'Arial Black', 'Segoe UI Black', Impact, sans-serif";
let cdRing: HTMLImageElement | null = null;
/** 카운트다운 숫자 뒤에 터지는 링 그림 (ring.webp) */
const setCountdownRing = (im: HTMLImageElement) => {
  cdRing = im;
};

/** s: 시작 후 흐른 시간(초) — 비스듬한 띠 위에 숫자가 쾅, 뒤로 금빛 링 */
function drawCountdown(
  g: CanvasRenderingContext2D,
  phases: Phase[],
  s: number,
  W: number,
  top: number,
  judgeY: number
) {
  const ph = phases.find((p) => s >= p.from && s < p.from + p.dur);
  if (!ph) return;
  const p = (s - ph.from) / ph.dur;
  const cx = W / 2;
  const cy = top + (judgeY - top) * 0.48;
  const go = ph.label === "GO!";
  const ready = ph.label === "READY";
  const fadeOut = p > 0.8 ? Math.max(0, 1 - (p - 0.8) / 0.2) : 1;

  g.save();
  // 숫자 동안은 레인을 살짝 어둡게
  if (!go) {
    // 판정선 위까지만 (아래 패드는 레인보다 넓어서 덮으면 가장자리가 어둡게 잘려 보임)
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.fillRect(0, top, W, judgeY - top);
  }
  // 비스듬한 띠: 왼쪽에서 쓱 들어옴
  const inP = Math.min(1, p / 0.18);
  const bandH = ready ? 74 : go ? 120 : 104;
  g.globalAlpha = fadeOut * 0.92;
  g.save();
  g.translate(cx, cy);
  g.transform(1, -0.12, 0, 1, 0, 0);
  const bw = (W + 80) * easeOutBack(inP);
  const band = g.createLinearGradient(-bw / 2, 0, bw / 2, 0);
  band.addColorStop(0, "rgba(219,39,119,0)");
  band.addColorStop(0.15, "rgba(219,39,119,0.85)");
  band.addColorStop(0.85, "rgba(124,58,237,0.85)");
  band.addColorStop(1, "rgba(124,58,237,0)");
  g.fillStyle = band;
  g.fillRect(-bw / 2, -bandH / 2, bw, bandH);
  g.fillStyle = "rgba(255,255,255,0.75)";
  g.fillRect(-bw / 2, -bandH / 2, bw, 2);
  g.fillRect(-bw / 2, bandH / 2 - 2, bw, 2);
  g.restore();

  // 숫자·GO!는 금빛 링이 뒤에서 터짐
  if (!ready && cdRing && cdRing.complete && cdRing.naturalWidth) {
    const cell = cdRing.naturalHeight;
    const fr = Math.min(3, Math.floor(p * 4));
    const sz = (go ? 300 : 210) * (0.8 + p * 0.5);
    g.save();
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = (1 - p) * 0.9;
    g.drawImage(cdRing, fr * cell, 0, cell, cell, cx - sz / 2, cy - sz / 2, sz, sz);
    g.restore();
  }

  // 글자: 크게 튀어나왔다가 제자리로(오버슈트), 흰→색 그라데이션 + 진한 테두리
  const pop = Math.min(1, p / 0.22);
  const scale = ready ? 1 : 2 - 1 * easeOutBack(pop);
  const slide = ready ? (1 - easeOutBack(Math.min(1, p / 0.3))) * -W * 0.6 : 0;
  g.globalAlpha = fadeOut * Math.min(1, p / 0.06);
  g.translate(cx + slide, cy);
  g.transform(1, -0.12, 0, 1, 0, 0);
  g.scale(scale, scale);
  const size = ready ? 46 : go ? 92 : 104;
  g.font = `italic 900 ${size}px ${CD_FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  if (ready) (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "8px";
  g.lineJoin = "round";
  g.lineWidth = ready ? 6 : 10;
  g.strokeStyle = "rgba(20,6,40,0.9)";
  g.strokeText(ph.label, 0, 4);
  const gr = g.createLinearGradient(0, -size / 2, 0, size / 2);
  gr.addColorStop(0, "#FFFFFF");
  gr.addColorStop(0.5, ready ? "#F5D0FE" : ph.color);
  gr.addColorStop(1, ready ? "#E9D5FF" : ph.color);
  g.fillStyle = gr;
  g.shadowColor = ready ? "#F472B6" : ph.color;
  g.shadowBlur = 18;
  g.fillText(ph.label, 0, 4);
  g.shadowBlur = 0;
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0px";
  g.restore();
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const fmtScore = (n: number) =>
  String(n)
    .padStart(7, "0")
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function roundRectFill(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

const stepBtn =
  "h-[2.2cqw] w-[2.2cqw] shrink-0 cursor-pointer rounded-full border border-white/15 font-mono text-[1.2cqw] text-white/70 hover:border-[#A78BFA] hover:text-white disabled:opacity-30";

/** 일시정지 화면: − 값 + (꾹 누르면 연속) */
function PauseRow({
  label,
  value,
  onMinus,
  onPlus,
  disabled = false,
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-[0.8cqw] py-[0.3cqw]">
      <span className="w-[8cqw] shrink-0 font-mono text-[1.1cqw] text-white/55">{label}</span>
      <HoldButton className={stepBtn} onStep={onMinus} disabled={disabled}>
        −
      </HoldButton>
      <span
        className={`flex-1 text-center font-mono text-[1.3cqw] ${disabled ? "text-white/50" : "text-white"}`}
      >
        {value}
      </span>
      <HoldButton className={stepBtn} onStep={onPlus} disabled={disabled}>
        +
      </HoldButton>
    </div>
  );
}

function PauseSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-[0.8cqw] py-[0.3cqw]">
      <span className="w-[8cqw] shrink-0 font-mono text-[1.1cqw] text-white/55">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-[#6C63FF]"
      />
      <span className="w-[3.4cqw] text-right font-mono text-[1.1cqw] text-white">
        {value === 0 ? "끔" : Math.round(value * 100)}
      </span>
    </div>
  );
}

/** HP가 바닥났을 때: 화면이 붉게 어두워지고 FAILED 배너가 쾅 */
function drawFailed(
  g: CanvasRenderingContext2D,
  el: number,
  img: HTMLImageElement,
  LW: number,
  LH: number
) {
  g.save();
  g.globalAlpha = Math.min(1, el / 0.5) * 0.7;
  g.fillStyle = "#12020a";
  g.fillRect(0, 0, LW, LH);
  if (el < 0.25) {
    g.globalAlpha = (1 - el / 0.25) * 0.5;
    g.fillStyle = "#F43F5E";
    g.fillRect(0, 0, LW, LH);
  }
  const p = Math.min(1, Math.max(0, (el - 0.35) / 0.25));
  if (p > 0) {
    const sc = 2.2 - 1.2 * easeOutBack(p);
    const shake = el < 0.9 ? Math.sin(el * 70) * 8 * (1 - (el - 0.35) / 0.55) : 0;
    g.globalAlpha = Math.min(1, p * 1.5);
    g.translate(LW / 2 + shake, LH * 0.42);
    g.scale(sc, sc);
    if (ready(img)) {
      const w = 620;
      const h = (w * img.naturalHeight) / img.naturalWidth;
      g.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
      g.font = "900 64px ui-monospace, monospace";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "#F43F5E";
      g.fillText("FAILED", 0, 0);
    }
    g.globalAlpha = Math.min(1, Math.max(0, (el - 0.8) / 0.3));
    // 다른 HUD 글자처럼 굵은 기울임 + 자간, 붉은 빛
    const ls = g as CanvasRenderingContext2D & { letterSpacing?: string };
    g.font = `italic 900 26px ${CD_FONT}`;
    ls.letterSpacing = "6px";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = "rgba(244,63,94,0.9)";
    g.shadowBlur = 14;
    g.lineWidth = 4;
    g.strokeStyle = "rgba(60,4,20,0.9)";
    g.strokeText("HP DEPLETED", 0, 150);
    g.fillStyle = "#FFE4EA";
    g.fillText("HP DEPLETED", 0, 150);
    ls.letterSpacing = "0px";
  }
  g.restore();
}
