"use client";

import { useEffect, useRef, useState } from "react";
import type { Song } from "@/lib/rhythm/music";
import { buildPlayLog, type PlayLog } from "@/lib/rhythm/playLog";
import type { Chart, Difficulty } from "@/lib/rhythm/chart";
import { Engine, HP_MAX, rankOf, type Judge } from "@/lib/rhythm/engine";
import {
  AUTO_SYNC,
  AutoSyncTracker,
  decayOffset,
  splitSync,
  type AutoSyncState,
} from "@/lib/rhythm/autosync";
import { DIFFICULTIES } from "@/lib/rhythm/chart";
import { coverOf, CUSTOM_COVER } from "./SongCarousel";
import { gpuInfo } from "@/lib/rhythm/gpu";
import HoldButton from "./HoldButton";
import {
  drawHead,
  drawHoldBody,
  laneColors,
  makeHitSound,
  SKIN_THEME,
  type SkinTheme,
  hitSoundBuffer,
  type HitSound,
  type Skin,
} from "@/lib/rhythm/fx";
import { sfx, sfxBuffer } from "@/lib/rhythm/sfx";
import { fitGain, LEVEL } from "@/lib/soundLevel";

/** 레인 키 기본값 (e.code) — 설정에서 사용자가 바꿀 수 있음 */
export const KEY_CODES = ["KeyD", "KeyF", "KeyJ", "KeyK"];
/** 레인 키로 못 쓰는 키 (Esc 는 일시정지 · 설정 닫기, Tab 은 설정 탭 넘기기) */
export const KEY_RESERVED = new Set(["Escape", "Tab", "MetaLeft", "MetaRight", "ContextMenu"]);
const KEY_NAMES: Record<string, string> = {
  Space: "SPC",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ShiftLeft: "LSH",
  ShiftRight: "RSH",
  ControlLeft: "LCT",
  ControlRight: "RCT",
  AltLeft: "LAL",
  AltRight: "RAL",
  Enter: "ENT",
  Backspace: "BS",
  CapsLock: "CAP",
};
/** e.code → 패드 · 설정에 보이는 글자 (한글 자판이어도 물리 키 기준) */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `N${code.slice(6)}`;
  return KEY_NAMES[code] ?? code.slice(0, 3).toUpperCase();
}
/** 저장된 키 설정이 쓸 만하면 그대로(서로 다른 4개, 막힌 키 없음), 아니면 null */
export function validKeys(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  if (!v.every((k) => typeof k === "string" && k && !KEY_RESERVED.has(k))) return null;
  return new Set(v).size === 4 ? (v as string[]) : null;
}

export type Cover = "none" | "fade" | "sudden";
export const COVERS_OPT: { key: Cover; label: string; desc: string }[] = [
  { key: "none", label: "없음", desc: "" },
  { key: "fade", label: "페이드", desc: "판정선 가까이에서 노트가 사라져요 — 박자감으로 치기" },
  { key: "sudden", label: "서든", desc: "위쪽 30%가 가려져 노트를 미리 읽을 수 없어요" },
];
/** 플레이 배경: 커버(재킷을 흐리게 깔고, 뮤비가 있으면 영상) / 무대(기본 무대 사진) */
export type BgMode = "cover" | "stage";
export const BG_MODES: { key: BgMode; label: string; desc: string }[] = [
  {
    key: "cover",
    label: "커버·뮤비",
    desc: "곡 재킷을 흐리게, 영상 파일을 넣은 곡은 뮤직비디오를 어둡게 깔아요",
  },
  { key: "stage", label: "무대", desc: "기본 무대 그림" },
];
/** 프레임: 60(120Hz 이상 화면에서도 초당 60번만 그림 — 발열·배터리) / 최대(화면 주사율대로) */
export type FpsMode = "60" | "max";
export const FPS_MODES: { key: FpsMode; label: string; desc: string }[] = [
  {
    key: "60",
    label: "60",
    desc: "120Hz 이상 화면에서도 초당 60번만 그려요 — 덜 뜨겁고 배터리가 오래가요 (판정은 그대로)",
  },
  {
    key: "max",
    label: "최대",
    desc: "화면 주사율대로 (120Hz면 초당 120번) — 더 매끄럽지만 더 뜨거워요",
  },
];

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
  /** 분석 모드(자동 연주)로 친 판 — 기록·랭킹에 안 올림 */
  auto?: boolean;
  /** 노트별 판정 · 입력 기록 (관리자 결과 화면에서 내보내기) */
  log?: PlayLog;
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

/** 레인 틀 그림 원본 좌표: 레인 시작·폭, 판정선, 아래 패드 */
type GearGeom = {
  w: number;
  h: number;
  lane0: number;
  innerL: number;
  innerR: number;
  laneW: number;
  judge: number;
  padTop: number;
  padBot: number;
  pads: number[][];
  padCx: number[];
  padCy: number;
};
/** 도트 레인 틀 (px/gear.webp — 기본) : 기둥 안쪽 150 ~ 924 를 4등분, 판정선 = 콘솔 위 네온 줄 */
const GEAR_PX: GearGeom = {
  w: 1075,
  h: 1683,
  lane0: 151,
  innerL: 150,
  innerR: 924,
  laneW: 193,
  judge: 1352,
  padTop: 1413,
  padBot: 1568,
  pads: [
    [148, 1413, 318, 1413, 322, 1566, 102, 1566],
    [345, 1413, 518, 1413, 525, 1566, 323, 1566],
    [553, 1413, 726, 1413, 748, 1566, 548, 1566],
    [760, 1413, 930, 1413, 975, 1566, 755, 1566],
  ],
  padCx: [222, 428, 644, 855],
  padCy: 1490,
};
/** 네온 레인 틀 (gear.webp 계열 — 테마 스킨 제나의 금빛 틀이 이 모양) */
const GEAR_NEON: GearGeom = {
  w: 1075,
  h: 1683,
  /** 레인: 틀 안쪽을 꽉 채움 (기둥 안쪽 158 ~ 914) */
  lane0: 158,
  /** 기둥 안쪽 실제 끝 (왼쪽 기둥은 레인보다 89px 바깥이라 레인 뒤 판을 여기까지 넓힘 — 안 그러면 배경이 비침) */
  innerL: 66,
  innerR: 932,
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
/** 이 테마의 레인 틀 모양 (테마가 자기 틀을 쓰면 네온 틀 모양, 아니면 도트 틀) */
export const gearGeom = (theme?: { gear: string } | null): GearGeom =>
  theme?.gear ? GEAR_NEON : GEAR_PX;
/** 레인 4개 폭 · 판정선 위치 (화면 높이 비율) — 싱크 맞추기 화면이 실제 플레이와 같은 크기로 그리게 */
export const gearRatios = (theme?: { gear: string } | null) => {
  const G = gearGeom(theme);
  return { laneW: (G.laneW * 4) / G.h, judge: G.judge / G.h };
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

/** 온라인 점수판 한 줄 */
export interface OnlineBoardRow {
  uid: string;
  nick: string;
  score: number;
  acc: number;
  dead: boolean;
  done: boolean;
  me: boolean;
  combo: number;
  hp: number;
  /** PERFECT · GREAT · GOOD · MISS 수 */
  counts: [number, number, number, number];
}

/** 온라인 판: 모두 같이 시작하고, 점수만 주고받음 (상대 화면은 안 맞춤) */
export interface OnlineStage {
  /** 모두 같이 음악이 시작하는 서버 시각(ms) */
  startAt: number;
  serverNow: () => number;
  /** 점수판 (ref) — 부모가 rows 를 바꾸고 ver 를 올림. Stage 는 ver 가 바뀌었을 때만 점수판을 다시 그림 */
  board: { current: { ver: number; rows: OnlineBoardRow[] } };
  /** 0.5초마다 내 진행: [점수, 콤보, 정확도, HP, 죽음 1/0, 끝 1/0, PERFECT, GREAT, GOOD, MISS 수] */
  onProgress: (
    row: [number, number, number, number, number, number, number, number, number, number]
  ) => void;
  /** Esc 꾹 → 나가기 */
  onLeave: () => void;
  /** 죽음: 결과를 알리고 화면은 그대로 (다른 사람 미니 화면을 보며 판이 끝나길 기다림) */
  onDead: (result: Result) => void;
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
  /** 분석 모드(관리자): 채보를 올퍼펙으로 자동 연주 — 채보가 곡과 맞는지 타격음과 함께 감상. 기록·랭킹 없음 */
  autoplay?: boolean;
  /** 플레이 배경 (커버·뮤비 / 무대) */
  bg?: BgMode;
  /** 프레임 (60 / 최대) */
  fps?: FpsMode;
  /** 온라인 판 — 일시정지·다시 시작 없음, 시작 시각은 서버가 정함 */
  online?: OnlineStage;
  /** 레인 키 4개 (e.code, 설정에서 바꿈) */
  keys?: string[];
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
  autoplay = false,
  bg = "cover",
  fps = "60",
  online,
  keys = KEY_CODES,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // 커버·뮤비 배경은 캔버스 뒤 HTML 요소로 (재킷은 CSS blur — 캔버스로 흐리면 화질이 깨지고 사파리는 filter가 안 됨).
  // 데스크탑(마우스)·가로 화면에서만 — 캔버스가 투명해져 합성 부담이 조금 늘어서 폰은 무대 그림 그대로. 뮤비는 프레임이 떨어지면 자동으로 끔
  // 내 음악인데 파일에 재킷이 없으면(기본 그림) 무대 그림 그대로
  const hasCover = !song.custom || (!!song.cover && song.cover !== CUSTOM_COVER);
  // 테마 스킨(SKIN_THEME)은 재킷 대신 스킨의 무대 그림 (뮤비가 있는 곡은 뮤비 그대로)
  const theme = SKIN_THEME[skin];
  /** 정보판 테두리 · 진행 막대 · 박자 빛 색 — 테마 스킨은 스킨 색, 아니면 곡 색 */
  const accent = theme?.accent ?? song.color;
  const domBg =
    bg === "cover" &&
    (theme ? !!song.video : hasCover || !!song.video) &&
    !portrait &&
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: fine)").matches;
  const useVideo = domBg && !!song.video;
  const [paused, setPaused] = useState(false);
  /** 온라인: 나가기 버튼을 한 번 누른 상태 */
  const [leaveArm, setLeaveArm] = useState(false);
  /** 온라인: 죽고 나서 다른 사람을 보는 중 */
  const [watching, setWatching] = useState(false);
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
    // 커버·뮤비가 뒤에 깔릴 땐 캔버스를 투명하게 (바닥 그림이 반투명이라 뒤가 비침)
    const g = canvas.getContext("2d", { alpha: domBg })!;
    const video = useVideo ? videoRef.current : null;
    let videoOff = false;
    const beatSec = 60 / song.bpm;
    // 롱노트 누르는 동안 8분음표마다 콤보가 오름
    const engine = new Engine(chart, beatSec / 2);
    // 연습곡은 HP가 바닥나도 끝까지 (처음 몇 탭은 싱크가 잡힐 때까지 누구나 — press에서 갱신)
    engine.noFail = true;
    // 플레이 중에 바뀔 수 있는 값들 (일시정지 화면·속도 단축키)
    const live: LiveSettings = { speed, music: musicVolume, hit: hitVolume };
    // 싱크: 음악 싱크 = 수동 + 자동(소리 지연 몫), 타격 싱크 = 자동(손 지연 몫). 자동은 치는 동안 움직임
    const outputLatency = (ctx as AudioContext & { outputLatency?: number }).outputLatency;
    let autoOffset = decayOffset(auto.offset, outputLatency !== undefined);
    const tracker = new AutoSyncTracker(auto.judge);
    /** 이 판에서 누른 횟수 — 아무것도 안 누르는데 초반 유예로 안 죽는 일이 없게 */
    let presses = 0;
    /** 플레이 데이터 내보내기용 입력 기록: [판정 기준 시각ms, 레인, 1=누름 0=뗌, 타격 싱크ms] */
    const inputLog: number[][] = [];
    const logInput = (tj: number, lane: number, down: 0 | 1) =>
      inputLog.push([Math.round(tj * 1000), lane, down, Math.round(judgeSec() * 1000)]);
    const offsetSec = () => (sync + autoOffset) / 1000;
    // 분석 모드(자동 연주)는 손 지연이 없으니 타격 싱크 0
    const judgeSec = () => (autoplay ? 0 : tracker.judge / 1000);
    /** 자동 싱크 값을 부모에 돌려줌 (일시정지·끝·나갈 때만 — 치는 동안 저장하면 끊김) */
    let reported: AutoSyncState | null = null;
    const reportAuto = () => {
      if (autoplay) return; // 자동 연주엔 입력이 없어 보정할 게 없음
      // 출력 지연을 아는 브라우저는 소리 지연이 이미 빠져 있어서 타격 싱크를 음악 싱크로 넘기지 않음
      // (넘기면 판정 쏠림이 노트 화면까지 밀어 버리고, 다시 안 돌아와서 오래 쌓일수록 어긋남)
      const next =
        outputLatency === undefined
          ? splitSync(tracker.judge, autoOffset, AUTO_SYNC.handCapNoLatency)
          : { judge: tracker.judge, offset: autoOffset };
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
    const GEAR = gearGeom(theme);
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
    /** 온라인 + 레인이 한쪽(가로 화면): 점수판을 줄이고 그 아래에 다른 사람들 미니 화면 (내 레인 크기는 그대로) */
    const minis = !!online && !!side && !portrait;
    const scoreBox = side
      ? { x: sideX, y: 290, w: sideW, h: minis ? 124 : 300 }
      : { x: gearX + gearW + 40, y: 56, w: LW - gearX - gearW - 80, h: 330 };
    // 곡 정보판: 넓으면 커버 옆에 글자, 좁으면(레인 가운데) 커버 아래에 제목
    const infoWide = infoBox.w >= 520;
    const coverSize = infoWide ? infoBox.h - 40 : 120;
    // HP 게이지: 기어 바깥 기둥 옆 (정보판 쪽)
    const hpX = field === "right" ? gearX - 4 : gearX + gearW - 6;

    let k = 1; // 캔버스 픽셀 / 논리 좌표
    /** 그리기 품질 단계 (프레임이 떨어지면 내려감, measureFrame) */
    let quality = 3;
    /** 최근 프레임 통계 (분석 모드 HUD에 표시) */
    let perfInfo: { fps: number; p90: number; work90: number; hz: number } | null = null;
    // 가속이 꺼져 있으면 처음부터 가장 가볍게 (낮은 해상도·효과 최소) — 프레임이 남으면 measureFrame이 다시 올림
    if (gpuInfo().software) quality = 0;
    /** 해상도를 한 번 낮췄으면 그 판 동안은 그대로 — 가벼워졌다고 다시 올리면 무거워져 또 내리고…
     *  그때마다 캔버스 크기를 바꾸고 바닥 그림을 다시 그려서 몇 초마다 툭툭 끊겼음 */
    let lowRes = quality === 0;
    const rebuild = () => {
      buildStatic();
      buildGear();
      buildGlow();
    };
    const bgImg = loadImg(
      // 테마 스킨은 그 무대, 아니면 곡 색이 따뜻하면 분홍 무대 · 아니면 파란 무대
      theme?.stage ??
        (warm(song.color) ? "/rhythm/px/stage-pink.webp" : "/rhythm/px/stage-blue.webp"),
      () => buildStatic()
    );
    const gearImg = loadImg(theme?.gear ?? "/rhythm/px/gear.webp", () => buildGear());
    // 테마 스킨의 무대 위 도트 캐릭터: 정보판 반대쪽이 아닌 바깥 아래 구석에 서서 박자마다 노래(sing 두 장 번갈아),
    // 50콤보 링이 뜨면 잠깐 환호(cheer). 그림 한 장 찍기라 가벼움. 세로 화면 · 온라인 미니 화면이 있으면 안 나옴
    const idolDef = theme?.idol;
    let idol: { img: HTMLImageElement; frames: number[][] } | null = null;
    if (idolDef && !portrait && !(online && side)) {
      const img = loadImg(idolDef.sheet, () => {});
      void fetch(idolDef.meta)
        .then((r) => r.json())
        .then((m: { frames: number[][] }) => {
          if (Array.isArray(m.frames)) idol = { img, frames: m.frames };
        })
        .catch(() => {});
    }
    /** 캐릭터 발 위치(x · y) · 레인 쪽을 보게 좌우 뒤집을지 */
    const idolAt =
      side === "left" ? { x: 110, y: LH - 4, flip: false } : { x: LW - 110, y: LH - 4, flip: true };
    // 테마 캐릭터 일러스트: 카운트다운 동안 정보판 쪽에서 쓱 들어와 윙크(intro), 100콤보마다 환호 컷인(cheer)
    const introImg = theme?.art && !portrait ? loadImg(theme.art.intro, () => {}) : null;
    const cheerImg = theme?.art && !portrait ? loadImg(theme.art.cheer, () => {}) : null;
    let cheerAt = -10;
    /** 일러스트가 서는 쪽: 정보판 쪽 (레인이 가운데면 오른쪽) */
    const artRight = side !== "left";
    const drawCutins = (t: number) => {
      const s = t + leadIn;
      // 곡 시작: READY ~ GO! 동안
      if (introImg && ready(introImg) && s >= 0 && s < cdEnd + 0.7) {
        const h = 640;
        const w = (introImg.naturalWidth / introImg.naturalHeight) * h;
        const inP = Math.min(1, s / 0.45);
        const out = s > cdEnd + 0.2 ? Math.min(1, (s - cdEnd - 0.2) / 0.5) : 0;
        const ease = 1 - Math.pow(1 - inP, 3);
        const slide = (1 - ease) * 260 + out * 120;
        const x = artRight ? LW - w + 30 + slide : -30 - slide;
        g.save();
        g.globalAlpha = Math.min(1, inP * 1.5) * (1 - out);
        g.drawImage(introImg, x, LH - h + 40, w, h);
        g.restore();
      }
      // 100콤보마다: 비스듬한 금빛 띠 + 환호 일러스트가 쓱 들어왔다 사라짐 (1.1초)
      const age = t - cheerAt;
      if (cheerImg && ready(cheerImg) && age >= 0 && age < 1.1) {
        const h = 520;
        const w = (cheerImg.naturalWidth / cheerImg.naturalHeight) * h;
        const inP = Math.min(1, age / 0.22);
        const out = age > 0.8 ? (age - 0.8) / 0.3 : 0;
        const ease = 1 - Math.pow(1 - inP, 3);
        const x = artRight ? LW - w - 10 + (1 - ease) * 300 : 10 - (1 - ease) * 300;
        g.save();
        g.globalAlpha = (1 - out) * 0.9;
        g.translate(artRight ? LW - 330 : 330, LH - 250);
        g.transform(1, -0.12, 0, 1, 0, 0);
        const bw = 700 * ease;
        const band = g.createLinearGradient(-bw / 2, 0, bw / 2, 0);
        band.addColorStop(0, `${accent}00`);
        band.addColorStop(0.3, `${accent}cc`);
        band.addColorStop(0.7, "#F9A8D4cc");
        band.addColorStop(1, "#F9A8D400");
        g.fillStyle = band;
        g.fillRect(-bw / 2, -60, bw, 120);
        g.restore();
        g.save();
        g.globalAlpha = Math.min(1, inP * 1.4) * (1 - out);
        g.drawImage(cheerImg, x, LH - h + 30 + out * 40, w, h);
        g.restore();
      }
    };
    const drawIdol = (t: number) => {
      if (!idol || !idolDef || !ready(idol.img)) return;
      const bt = t - (song.beatOffset ?? 0);
      const beat = Math.floor(Math.max(0, bt) / beatSec);
      const ph = bt > 0 ? (bt % beatSec) / beatSec : 1;
      const cheerAge = t - ringAt;
      const list = cheerAge >= 0 && cheerAge < 0.9 ? idolDef.cheer : idolDef.sing;
      const fi =
        list === idolDef.cheer
          ? list[Math.min(list.length - 1, Math.floor(cheerAge * 6))]
          : list[beat % list.length];
      const f = idol.frames[fi];
      if (!f) return;
      const [sx, sy, sw, sh, ax, ay] = f;
      const sc = idolDef.scale;
      // 박자에 맞춰 살짝 눌렸다 펴짐
      const squash = t > 0 ? 0.035 * Math.exp(-ph * 7) : 0;
      g.save();
      g.imageSmoothingEnabled = false;
      g.translate(idolAt.x, idolAt.y);
      g.scale((idolAt.flip ? -1 : 1) * sc * (1 + squash), sc * (1 - squash));
      g.drawImage(idol.img, sx, sy, sw, sh, -ax, -ay, sw, sh);
      g.restore();
    };
    const coverImg = loadImg(coverOf(song), () => buildStatic());
    const hitImg = loadImg("/rhythm/px/hit.webp", () => {});
    const ringImg = loadImg("/rhythm/px/ring.webp", () => {});
    setCountdownRing(ringImg);
    setCountdownTheme(theme?.countdown ?? null);
    const failImg = loadImg("/rhythm/px/banner-failed.webp", () => {});
    const judgeImg: Record<Judge, HTMLImageElement> = {
      perfect: loadImg("/rhythm/px/judge-perfect.webp", () => {}),
      great: loadImg("/rhythm/px/judge-great.webp", () => {}),
      good: loadImg("/rhythm/px/judge-good.webp", () => {}),
      miss: loadImg("/rhythm/px/judge-miss.webp", () => {}),
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
      if (domBg) {
        // 재킷·영상은 뒤의 HTML 요소가 보여 주고, 여기엔 어두운 막만
        b.fillStyle = useVideo ? "rgba(4,5,14,0.5)" : "rgba(4,5,14,0.36)";
        b.fillRect(0, 0, CW, CH);
      } else {
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
      }
      // 레인 뒤 판: 노트가 무대 조명에 묻히지 않게
      const lane = b.createLinearGradient(0, laneTop, 0, judgeY);
      lane.addColorStop(0, "rgba(3,4,12,0.55)");
      lane.addColorStop(0.25, "rgba(3,4,12,0.82)");
      lane.addColorStop(1, "rgba(3,4,12,0.9)");
      b.fillStyle = lane;
      const panelL = Math.min(gx - 6, gpx(GEAR.innerL));
      const panelR = Math.max(gx + W + 6, gpx(GEAR.innerR));
      b.fillRect(panelL, laneTop, panelR - panelL, judgeY + 4 - laneTop);
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
        glass(b, 12, 12, CW - 24, HUD_H - 24, accent);
      } else for (const box of [infoBox, scoreBox]) glass(b, box.x, box.y, box.w, box.h, accent);
      // 곡 커버 (정보판 왼쪽, 세로 화면은 위 띠 왼쪽)
      const cs = portrait ? HUD_H - 56 : coverSize;
      const cx = portrait ? 28 : infoBox.x + 20;
      const cy = portrait ? 28 : infoBox.y + 20;
      if (ready(coverImg)) {
        b.save();
        b.beginPath();
        b.roundRect(cx, cy, cs, cs, 0);
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
        b.fillStyle = `${accent}33`;
        b.beginPath();
        b.roundRect(cx, cy, cs, cs, 0);
        b.fill();
      }
      b.strokeStyle = "rgba(255,255,255,0.25)";
      b.lineWidth = 1.5;
      b.beginPath();
      b.roundRect(cx, cy, cs, cs, 0);
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
      gr.addColorStop(0, `${accent}50`);
      gr.addColorStop(1, `${accent}00`);
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
      const dpr = Math.min(window.devicePixelRatio || 1, 2, (lowRes ? 1280 : 1920) / cssW);
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
    // 곡마다 크기가 달라서(-7.6 ~ -14.5 LUFS) 재서 같은 크기로 맞춤 (lib/soundLevel.ts)
    const musicFit = fitGain(buffer, LEVEL.rhythm.musicLufs);
    musicGain.gain.value = live.music * musicFit;
    src.connect(musicGain).connect(ctx.destination);
    // 온라인: 서버가 정한 시각에 모두 같이 (카운트다운이 덜 남았으면 그만큼 건너뜀)
    const startAt = online
      ? ctx.currentTime + Math.max(0.3, (online.startAt - online.serverNow()) / 1000)
      : ctx.currentTime + leadIn;
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
      gn.gain.exponentialRampToValueAtTime(0.35 * LEVEL.rhythm.sfx, at + 0.01);
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
    let hitBuf = makeHitSound(ctx, hitSound);
    // 샘플 타격음은 파일을 받아야 해서 — 받는 동안은 1번 소리, 다 되면 바꿈 (설정에서 들어 봤으면 이미 받아져 있음)
    void hitSoundBuffer(ctx, hitSound).then((b) => (hitBuf = b));
    const hitGain = ctx.createGain();
    hitGain.gain.value = live.hit * 0.9 * LEVEL.rhythm.hit;
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

    const mono = "'Galmuri11', 'Nanum Gothic', sans-serif";
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
    // 도트 글꼴 (갈무리 — css/rhythm.css 에서 불러옴)
    const disp = "'Galmuri11', 'Nanum Gothic', sans-serif";
    // 콤보 효과: 50콤보마다 링, 큰 콤보가 끊기면 흔들림
    let ringAt = -10;
    let breakAt = -10;
    let breakFrom = 0;

    /** 휴대폰 세로: 위쪽 띠에 곡·점수·정확도·HP·진행 */
    // 콤보 글자 그림 캐시: "COMBO" 라벨 + 큰 숫자(테두리·은색/금색 광택). 숫자·금빛이 같으면 재사용
    const comboFont = "'Galmuri11', 'Nanum Gothic', sans-serif";
    // (은색·금색 캔버스 두 장을 계속 다시 씀 — 콤보마다 새 캔버스를 만들면 초당 10~15장씩 쌓여
    //  사파리는 장마다 GPU 메모리를 잡았다가 한꺼번에 치우면서 순간 끊김)
    type ComboSlot = {
      c: HTMLCanvasElement;
      b: CanvasRenderingContext2D;
      w: number;
      h: number;
      key: string;
    };
    const comboSlots: (ComboSlot | null)[] = [null, null];
    const comboSprite = (txt: string, gold: boolean) => {
      const key = `${txt}|${k.toFixed(2)}`;
      const si = gold ? 1 : 0;
      let sp = comboSlots[si];
      if (sp && sp.key === key) return sp;
      const size = 72;
      const w = Math.max(180, txt.length * size * 0.8 + 50);
      const h = size + 76;
      if (!sp) {
        const c = document.createElement("canvas");
        sp = { c, b: c.getContext("2d")!, w, h, key };
        comboSlots[si] = sp;
      }
      const { c, b } = sp;
      const pw = Math.ceil(w * k);
      const ph = Math.ceil(h * k);
      if (c.width !== pw || c.height !== ph) {
        c.width = pw;
        c.height = ph;
      } else {
        b.setTransform(1, 0, 0, 1, 0, 0);
        b.clearRect(0, 0, pw, ph);
      }
      sp.w = w;
      sp.h = h;
      sp.key = key;
      b.setTransform(k, 0, 0, k, 0, 0);
      b.translate(w / 2, h / 2 + 16);
      b.textAlign = "center";
      b.textBaseline = "middle";
      // COMBO 글자도 숫자와 같은 글꼴·은색 — 숫자 테두리에 아랫부분이 덮이지 않게 숫자 위로 띄움
      b.font = `700 20px ${comboFont}`;
      (b as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "6px";
      pxOutline(b, "COMBO", 3, -size / 2 - 18, 3);
      const lg = b.createLinearGradient(0, -size / 2 - 28, 0, -size / 2 - 8);
      lg.addColorStop(0, "#FFFFFF");
      lg.addColorStop(1, "#94A3B8");
      b.fillStyle = lg;
      b.fillText("COMBO", 3, -size / 2 - 18);
      (b as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0px";
      b.font = `700 ${size}px ${comboFont}`;
      pxOutline(b, txt, 0, 4, 5);
      const gr = b.createLinearGradient(0, -size / 2, 0, size / 2);
      gr.addColorStop(0, "#FFFFFF");
      gr.addColorStop(0.45, gold ? "#FDE68A" : "#E2E8F0");
      gr.addColorStop(0.5, gold ? "#D97706" : "#94A3B8");
      gr.addColorStop(1, gold ? "#FEF3C7" : "#CBD5E1");
      b.fillStyle = gr;
      b.fillText(txt, 0, 4);
      return sp;
    };
    /** 프레임 통계 한 줄(분석 모드): fps/주사율 · 프레임 간격 p90 · 그리기 시간 p90 · 품질 · 간격 고정 · 캔버스 픽셀 */
    const perfStr = () =>
      perfInfo
        ? `${perfInfo.fps.toFixed(0)}/${perfInfo.hz.toFixed(0)}fps · p90 ${perfInfo.p90.toFixed(0)}ms · js ${perfInfo.work90.toFixed(1)}ms · Q${quality}${pace === 2 ? "·½" : ""} · ${canvas.width}×${canvas.height}`
        : "";
    const drawHudPortrait = (t: number) => {
      const x0 = 28 + (HUD_H - 56) + 18;
      const right = CW - 30;
      const judged =
        engine.counts.perfect + engine.counts.great + engine.counts.good + engine.counts.miss;
      g.textBaseline = "top";
      g.textAlign = "left";
      g.fillStyle = "#fff";
      g.font = `700 24px ${KR_FONT}`;
      g.fillText(titleFit(g.font, right - x0 - 210), x0, 30);
      g.fillStyle = diffInfo.color;
      g.font = `700 17px ${KR_FONT}`;
      g.fillText(
        `${diffInfo.label}  Lv.${chart.level}${song.artist ? `  ·  ${song.artist}` : ""}`,
        x0,
        64
      );
      // 점수 (오른쪽)
      g.textAlign = "right";
      g.fillStyle = "#fff";
      g.font = `700 38px ${disp}`;
      g.fillText(fmtScore(Math.round(shownScore)), right, 26);
      const rk = judged ? rankOf(engine.accuracy) : "-";
      g.font = `700 20px ${disp}`;
      g.fillStyle = judged ? "#fff" : "rgba(255,255,255,0.35)";
      g.fillText(judged ? `${engine.accuracy.toFixed(2)}%` : "--.--%", right, 72);
      const accW = g.measureText(judged ? `${engine.accuracy.toFixed(2)}%` : "--.--%").width;
      g.fillStyle = judged ? rankColorOf(rk) : "rgba(255,255,255,0.3)";
      g.fillText(rk, right - accW - 14, 72);
      // HP (가로)
      const hpr = engine.hp / HP_MAX;
      const hc = hpr > 0.6 ? "#4ADE80" : hpr > 0.3 ? "#FBBF24" : "#F43F5E";
      g.fillStyle = "rgba(255,255,255,0.12)";
      roundRectFill(g, x0, 104, right - x0, 10, 0);
      g.fillStyle = hc;
      roundRectFill(g, x0, 104, Math.max(10, (right - x0) * hpr), 10, 0);
      g.fillStyle = "rgba(255,255,255,0.55)";
      g.font = `700 11px ${mono}`;
      g.textAlign = "left";
      g.fillText("HP", x0, 120);
      // 진행 (얇게)
      const prog = Math.max(0, Math.min(1, t / songEnd));
      g.fillStyle = "rgba(255,255,255,0.12)";
      g.fillRect(x0, 138, right - x0, 4);
      g.fillStyle = accent;
      g.fillRect(x0, 138, (right - x0) * prog, 4);
      if (autoplay && perfInfo) {
        g.fillStyle = "rgba(253,230,138,0.85)";
        g.font = `700 11px ${mono}`;
        g.fillText(perfStr(), x0, 148);
      }
    };

    /** 바닥(배경·레인 판·정보판) + 박자 빛 + 정보판 글자 */
    const drawBackdrop = (t: number, pulse: number) => {
      if (domBg) g.clearRect(0, 0, CW, CH); // 투명 캔버스: 지난 프레임을 지워야 뒤가 비침
      if (staticLayer) g.drawImage(staticLayer, 0, 0, CW, CH);
      else {
        g.fillStyle = "#070814";
        g.fillRect(0, 0, CW, CH);
      }
      if (beatGlow && pulse > 0.02 && quality >= 2) {
        // 박자마다 기어 주변이 살짝 밝아짐 — 밝은 배경 그림 위에서도 보이게 더하기(lighter)로, 눈 아프지 않게 은은하게
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = pulse * 0.35;
        g.drawImage(beatGlow, 0, 0, CW, CH);
        g.globalAlpha = 1;
        g.globalCompositeOperation = "source-over";
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
      g.font = `700 ${infoWide ? 28 : 22}px ${KR_FONT}`;
      g.fillText(titleFit(g.font, titleW), titleX, titleY);
      const y0 = infoWide ? ib.y + 86 : ib.y + 46;
      g.fillStyle = diffInfo.color;
      g.font = `700 15px ${KR_FONT}`;
      g.fillText(diffInfo.label, tx, y0, tw);
      g.fillStyle = "#fff";
      g.font = `700 22px ${disp}`;
      g.fillText(`Lv.${chart.level}`, tx, y0 + 20, tw);
      g.fillStyle = "rgba(255,255,255,0.55)";
      g.font = `700 12px ${mono}`;
      g.fillText(
        `${song.artist ? `${song.artist} · ` : ""}${Math.round(song.bpmLabel ?? song.bpm)} BPM · x${live.speed.toFixed(1)}`,
        tx,
        y0 + 50,
        tw
      );
      if (autoplay) {
        g.fillStyle = "#FDE68A";
        g.font = `700 12px ${KR_FONT}`;
        g.fillText("🔍 분석 모드 · 자동 연주", tx, y0 + 70, tw);
      }
      if (sec) {
        g.fillStyle = accent;
        g.font = `700 12px ${mono}`;
        g.fillText(
          `▶ ${sec.toUpperCase()}`,
          infoWide ? tx : ib.x + 20,
          infoWide ? y0 + (autoplay ? 90 : 70) : titleY + 34,
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
      g.roundRect(px0, py, pw, 6, 0);
      g.fill();
      g.fillStyle = accent;
      g.beginPath();
      g.roundRect(px0, py, Math.max(6, pw * prog), 6, 0);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.45)";
      g.font = `700 11px ${mono}`;
      g.textAlign = "right";
      g.fillText(`${fmtTime(Math.max(0, t))} / ${fmtTime(songEnd + 2.5)}`, px0 + pw, py - 16);
      if (autoplay && perfInfo) {
        // 프레임 통계 (분석 모드): 진행 바 위 왼쪽, 시간 글자와 안 겹치게 폭 제한
        g.fillStyle = "rgba(253,230,138,0.8)";
        g.textAlign = "left";
        g.fillText(perfStr(), px0, py - 16, pw - 90);
      }

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
      g.font = `700 12px ${disp}`;
      spaced(3);
      g.fillText("SCORE", sx, sb.y + 22);
      spaced(0);
      g.fillStyle = "#fff";
      g.font = `700 ${Math.min(46, Math.max(30, sw / 7))}px ${disp}`;
      g.fillText(fmtScore(Math.round(shownScore)), sx, sb.y + 40, sw);
      const acc = engine.accuracy;
      const rk = judged ? rankOf(acc) : "-";
      // 랭크 · 정확도 · 최대 콤보 한 줄 (같은 높이·같은 글꼴)
      const ly = sb.y + 100;
      g.fillStyle = judged ? rankColorOf(rk) : "rgba(255,255,255,0.3)";
      g.font = `700 24px ${disp}`;
      g.fillText(rk, sx, ly);
      g.fillStyle = judged ? "#fff" : "rgba(255,255,255,0.35)";
      g.font = `700 20px ${disp}`;
      g.fillText(judged ? `${acc.toFixed(2)}%` : "--.--%", sx + 50, ly + 3);
      g.textAlign = "right";
      g.fillStyle = "#fff";
      g.font = `700 20px ${disp}`;
      const mc = String(engine.maxCombo);
      g.fillText(mc, sx + sw, ly + 3);
      const mcW = g.measureText(mc).width;
      g.fillStyle = "rgba(255,255,255,0.5)";
      g.font = `700 11px ${disp}`;
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
      // 미니 화면이 있으면 판정 수 줄은 뺌 (내 판정은 레인에서 보임)
      if (!minis)
        rows.forEach(([label, n, c], i) => {
          const y = rowTop + i * rowH;
          g.fillStyle = "rgba(255,255,255,0.05)";
          g.beginPath();
          g.roundRect(sx, y, sw, rowH - 6, 0);
          g.fill();
          g.fillStyle = c;
          g.fillRect(sx, y, 4, rowH - 6);
          // 점수·랭크와 같은 굵은 기울임 글꼴로 (따로 놀지 않게)
          g.font = `700 15px ${disp}`;
          g.textBaseline = "middle";
          g.fillText(label, sx + 16, y + (rowH - 6) / 2 + 1);
          g.fillStyle = "#fff";
          g.textAlign = "right";
          g.font = `700 19px ${disp}`;
          g.fillText(String(n), sx + sw - 14, y + (rowH - 6) / 2 + 1);
          g.textAlign = "left";
          g.textBaseline = "top";
        });
    };

    // ── 온라인 점수판: 부모가 0.5초마다 바꿔 주는 줄을 미리 그려 두고 찍기만 (바뀔 때·내 점수만 0.25초마다 다시) ──
    let boardLayer: HTMLCanvasElement | null = null;
    let boardVer = -1;
    let boardAt = 0;
    let boardK = 0;
    /** 점수판 자리: 레인이 한쪽이면 정보판 아래 띠(2단), 가운데면 왼쪽 정보판 아래 세로 목록. 세로 화면은 내 순위만 */
    const boardBox = portrait
      ? { x: CW - 16 - 220, y: HUD_H + 12, w: 220, h: 34, cols: 1, rowsPer: 1 }
      : side
        ? {
            x: sideX,
            y: scoreBox.y + scoreBox.h + 14,
            w: sideW,
            h: CH - (scoreBox.y + scoreBox.h + 14) - 24,
            cols: 2,
            rowsPer: 4,
          }
        : {
            x: infoBox.x,
            y: infoBox.y + infoBox.h + 24,
            w: infoBox.w,
            h: 300,
            cols: 1,
            rowsPer: 8,
          };
    const drawBoard = () => {
      if (!online) return;
      const now = performance.now();
      const bd = online.board.current;
      if (boardVer === bd.ver && boardK === k && now - boardAt < 250 && boardLayer) {
        g.drawImage(boardLayer, boardBox.x, boardBox.y, boardBox.w, boardBox.h);
        return;
      }
      boardVer = bd.ver;
      boardAt = now;
      boardK = k;
      // 내 줄은 내 화면의 지금 점수로 (서버를 한 바퀴 돈 값보다 빠르게)
      const rows = bd.rows
        .map((r) => (r.me ? { ...r, score: engine.score, acc: engine.accuracy } : r))
        .sort((a, b) => b.score - a.score);
      const { c, b } = layer(boardBox.w, boardBox.h);
      const myRank = rows.findIndex((r) => r.me) + 1;
      if (portrait) {
        b.fillStyle = "rgba(10,8,30,0.7)";
        roundRectFill(b, 0, 0, boardBox.w, boardBox.h, 0);
        b.textBaseline = "middle";
        b.textAlign = "center";
        b.fillStyle = "#fff";
        b.font = `700 17px ${disp}`;
        b.fillText(`RANK ${myRank || "-"} / ${rows.length}`, boardBox.w / 2, boardBox.h / 2 + 1);
      } else {
        glass(b, 0, 0, boardBox.w, boardBox.h, accent);
        const cols = boardBox.cols;
        const colW = (boardBox.w - 24) / cols;
        const rowH = Math.min(26, (boardBox.h - 16) / boardBox.rowsPer);
        const max = cols * boardBox.rowsPer;
        // 자리가 모자라면 내 줄은 꼭 보이게 (마지막 칸을 나로)
        let shown = rows.slice(0, max);
        if (myRank > max) shown = [...rows.slice(0, max - 1), rows[myRank - 1]];
        b.textBaseline = "middle";
        shown.forEach((r, i) => {
          const rank = rows.indexOf(r) + 1;
          const col = Math.floor(i / boardBox.rowsPer);
          const x = 12 + col * colW;
          const y = 8 + (i % boardBox.rowsPer) * rowH + rowH / 2;
          if (r.me) {
            b.fillStyle = `${accent}33`;
            roundRectFill(b, x - 4, y - rowH / 2 + 2, colW - 6, rowH - 4, 0);
          }
          b.globalAlpha = r.dead ? 0.45 : 1;
          b.textAlign = "left";
          b.fillStyle = rank === 1 ? "#FDE68A" : "rgba(255,255,255,0.6)";
          b.font = `700 14px ${disp}`;
          b.fillText(String(rank), x, y + 1);
          b.fillStyle = r.me ? "#fff" : "rgba(255,255,255,0.85)";
          b.font = `700 13px ${KR_FONT}`;
          const nameX = x + 22;
          const scoreW = 92;
          let name = r.nick + (r.dead ? " ✕" : r.done ? " ✓" : "");
          while (name.length > 1 && b.measureText(name).width > colW - 22 - scoreW - 10)
            name = name.slice(0, -1);
          b.fillText(name, nameX, y + 1);
          b.textAlign = "right";
          b.fillStyle = "#fff";
          b.font = `700 14px ${disp}`;
          b.fillText(fmtScore(r.score), x + colW - 12, y + 1);
          b.globalAlpha = 1;
        });
      }
      boardLayer = c;
      g.drawImage(c, boardBox.x, boardBox.y, boardBox.w, boardBox.h);
    };

    // ── 온라인 미니 화면: 다른 사람(최대 7명)의 레인을 작게 ──
    // 모두 같은 채보·같은 난이도라 노트는 내 채보로 그리고, 그 사람의 점수·콤보·HP·판정(0.5초마다 오는 판정 수 변화)만 얹음.
    // 따로 그린 그림을 30fps(무거우면 15fps)로만 다시 그려 찍음 — 내 레인 그리기에 부담이 안 가게
    const miniBox = {
      x: sideX,
      y: scoreBox.y + scoreBox.h + 14,
      w: sideW,
      h: CH - (scoreBox.y + scoreBox.h + 14) - 24,
    };
    /** 미니 레인에 노트가 보이는 시간(초) */
    const MINI_VIS = 1.2;
    const miniNotes = minis ? [...chart.notes].sort((a, b) => a.t - b.t) : [];
    let miniIdx = 0;
    let miniLayer: HTMLCanvasElement | null = null;
    let miniAt = 0;
    let miniK = 0;
    /** 사람별 판정 표시: 지난 판정 수와 마지막으로 바뀐 판정 */
    const miniFlash = new Map<string, { prev: number[]; kind: number; at: number }>();
    const JUDGE_KEYS = ["perfect", "great", "good", "miss"] as const;
    const drawMinis = (t: number) => {
      if (!online) return;
      const now = performance.now();
      if (miniLayer && miniK === k && now - miniAt < (quality <= 1 ? 66 : 33)) {
        g.drawImage(miniLayer, miniBox.x, miniBox.y, miniBox.w, miniBox.h);
        return;
      }
      miniAt = now;
      miniK = k;
      const rows = online.board.current.rows;
      const ranked = rows
        .map((r) => (r.me ? { ...r, score: engine.score } : r))
        .sort((a, b) => b.score - a.score);
      // 자리는 고정 (순위가 바뀔 때마다 미니 화면이 자리를 옮기면 눈이 못 따라감) — 순위는 숫자로
      const others = rows.filter((r) => !r.me).sort((a, b) => (a.uid < b.uid ? -1 : 1));
      const { c, b } = layer(miniBox.w, miniBox.h);
      if (!others.length) {
        miniLayer = c;
        return;
      }
      const H = miniBox.h;
      const gap = 10;
      const mw = Math.min(130, (miniBox.w - gap * (others.length - 1)) / others.length);
      const top = 26;
      const judge = H - 46;
      const span = judge - top;
      // 화면에 보일 노트 (모두 같으니 한 번만 골라 둠)
      while (
        miniIdx < miniNotes.length &&
        (miniNotes[miniIdx].end ?? miniNotes[miniIdx].t) < t - 0.05
      )
        miniIdx++;
      const vis: { l: number; y: number; y2: number | null }[] = [];
      for (let j = Math.max(0, miniIdx - 40); j < miniNotes.length; j++) {
        const n = miniNotes[j];
        if (n.t > t + MINI_VIS) break;
        const end = n.end ?? n.t;
        if (end < t - 0.05) continue;
        const y = judge - ((n.t - t) / MINI_VIS) * span;
        const y2 = n.end ? Math.max(top, judge - ((n.end - t) / MINI_VIS) * span) : null;
        vis.push({ l: n.lane, y: Math.min(judge, y), y2 });
      }
      others.forEach((r, i) => {
        const x = i * (mw + gap);
        const rank = ranked.findIndex((o) => o.uid === r.uid) + 1;
        b.save();
        b.translate(x, 0);
        // 판
        b.fillStyle = "rgba(6,4,20,0.72)";
        roundRectFill(b, 0, 0, mw, H, 0);
        b.strokeStyle = rank === 1 ? "rgba(253,230,138,0.7)" : "rgba(255,255,255,0.14)";
        b.lineWidth = 1.5;
        b.beginPath();
        b.roundRect(0.75, 0.75, mw - 1.5, H - 1.5, 0);
        b.stroke();
        // 이름 · 순위
        b.textBaseline = "middle";
        b.textAlign = "left";
        b.fillStyle = rank === 1 ? "#FDE68A" : "rgba(255,255,255,0.65)";
        b.font = `700 13px ${disp}`;
        b.fillText(String(rank), 7, 13);
        b.fillStyle = "#fff";
        b.font = `700 11px ${KR_FONT}`;
        let name = r.nick;
        while (name.length > 1 && b.measureText(name).width > mw - 26) name = name.slice(0, -1);
        b.fillText(name, 21, 13);
        // 레인
        const lx = 5;
        const lw = (mw - 10) / 4;
        b.fillStyle = "rgba(255,255,255,0.04)";
        for (let l = 1; l < 4; l += 2) b.fillRect(lx + l * lw, top, lw, span);
        for (const v of vis) {
          b.fillStyle = laneColor(v.l);
          if (v.y2 !== null) {
            b.globalAlpha = 0.45;
            b.fillRect(lx + v.l * lw + lw * 0.25, v.y2, lw * 0.5, Math.max(0, v.y - v.y2));
            b.globalAlpha = 1;
          }
          if (v.y < judge) b.fillRect(lx + v.l * lw + 1, v.y - 3, lw - 2, 4);
        }
        b.fillStyle = "rgba(244,114,182,0.9)";
        b.fillRect(lx, judge, mw - 10, 2);
        // 판정: 0.5초마다 오는 판정 수가 늘어난 쪽 (MISS 가 늘었으면 MISS)
        let f = miniFlash.get(r.uid);
        if (!f) miniFlash.set(r.uid, (f = { prev: r.counts, kind: -1, at: 0 }));
        if (r.counts.some((v, j) => v !== f!.prev[j])) {
          const inc = r.counts.map((v, j) => v - f!.prev[j]);
          f.kind = inc[3] > 0 ? 3 : inc[2] > 0 ? 2 : inc[1] > 0 ? 1 : 0;
          f.at = now;
          f.prev = r.counts;
        }
        if (f.kind >= 0 && now - f.at < 450) {
          const st = JUDGE_STYLE[JUDGE_KEYS[f.kind]];
          b.globalAlpha = 1 - (now - f.at) / 450;
          b.textAlign = "center";
          b.fillStyle = st.color;
          b.font = `700 ${mw < 90 ? 10 : 12}px ${disp}`;
          b.fillText(st.text, mw / 2, top + span * 0.62);
          b.globalAlpha = 1;
        }
        if (r.combo >= 10 && !r.dead) {
          b.textAlign = "center";
          b.fillStyle = "rgba(255,255,255,0.35)";
          b.font = `700 ${mw < 90 ? 14 : 18}px ${disp}`;
          b.fillText(String(r.combo), mw / 2, top + span * 0.42);
        }
        // 점수 · HP
        b.textAlign = "center";
        b.fillStyle = "#fff";
        b.font = `700 13px ${disp}`;
        b.fillText(fmtScore(r.score), mw / 2, H - 28);
        b.fillStyle = "rgba(255,255,255,0.12)";
        b.fillRect(6, H - 13, mw - 12, 4);
        b.fillStyle = r.hp > 60 ? "#4ADE80" : r.hp > 30 ? "#FBBF24" : "#F43F5E";
        b.fillRect(6, H - 13, ((mw - 12) * Math.max(0, Math.min(100, r.hp))) / 100, 4);
        if (r.dead || r.done) {
          b.fillStyle = r.dead ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.35)";
          roundRectFill(b, 0, top, mw, span + 2, 0);
          b.fillStyle = r.dead ? "#F43F5E" : "#4ADE80";
          b.font = `700 ${mw < 90 ? 11 : 13}px ${disp}`;
          b.fillText(r.dead ? "FAILED" : "CLEAR", mw / 2, top + span / 2);
        }
        b.restore();
      });
      miniLayer = c;
      g.drawImage(c, miniBox.x, miniBox.y, miniBox.w, miniBox.h);
    };

    const draw = (t: number) => {
      const laneW = W / 4;
      // 마디 위상 (0: 마디 첫 박) → 판정선이 마디마다 한 번 살짝 번쩍
      // (박마다 판정선·배경이 번쩍이던 건 눈에 거슬려서 마디마다로 줄이고 배경 번쩍임은 뺌)
      const bt = t - (song.beatOffset ?? 0);
      const barSec = beatSec * 4;
      const barPh = bt > 0 ? (((bt % barSec) + barSec) % barSec) / beatSec : 4;
      const pulse = t > 0 ? Math.exp(-barPh * 5) : 0;
      shownScore += (engine.score - shownScore) * 0.18;
      drawBackdrop(t, 0);
      if (idol) drawIdol(t);
      // 죽고 나서 보는 중이면 미니 화면은 지금 곡 시각으로 (내 레인만 멈춤)
      if (minis) drawMinis(watchingNow ? now() - judgeSec() : t);
      else drawBoard();
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
        const kl = keyLabel(keys[l]);
        g.fillStyle = on ? "#fff" : "rgba(255,255,255,0.5)";
        g.font = `700 ${kl.length > 1 ? 16 : 22}px ${disp}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(kl, 0, 0);
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
        // 빛기둥 그라데이션은 색마다 한 번만 만들고(높이 H), 높이·밝기는 변환·투명도로
        g.fillStyle = cachedGrad(`beam${col}`, () => {
          const beam = g.createLinearGradient(0, 0, 0, -H);
          beam.addColorStop(0, `${col}a6`);
          beam.addColorStop(1, `${col}00`);
          return beam;
        });
        const bw = laneW * (0.9 - 0.3 * p);
        g.save();
        g.translate(cx, judgeY);
        g.scale(1, beamH / H);
        g.globalAlpha = fade * fade;
        g.fillRect(-bw / 2, -H, bw, H);
        g.restore();
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
        g.roundRect(hpX - 2, top - 2, 14, bh + 4, 0);
        g.fill();
        const hc = hpr > 0.6 ? "#4ADE80" : hpr > 0.3 ? "#FBBF24" : "#F43F5E";
        g.globalAlpha = blink;
        g.fillStyle = hc;
        if (quality >= 2) {
          g.shadowColor = hc;
          g.shadowBlur = 10;
        }
        g.beginPath();
        g.roundRect(hpX, top + bh * (1 - hpr), 10, Math.max(0.1, bh * hpr), 0);
        g.fill();
        g.shadowBlur = 0;
        g.globalAlpha = 1;
        g.fillStyle = "rgba(255,255,255,0.7)";
        g.font = `700 11px ${mono}`;
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
          g.font = `700 38px ${disp}`;
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
      if (engine.combo >= 2) {
        const bump = Math.max(0, 1 - (t - comboAt) / 0.1);
        const gold = Math.max(0, 1 - ringAge / 0.6); // 50콤보마다 잠깐 금빛
        // 테두리 글자(strokeText)는 매 프레임 그리면 무거워서 숫자가 바뀔 때만 그려 둔 그림을 찍음
        const sp = comboSprite(String(engine.combo), gold > 0);
        g.save();
        g.globalAlpha = 0.65; // 노트가 비쳐 보이게
        g.translate(W / 2, cyC);
        g.scale(1 + 0.1 * bump, 1 + 0.1 * bump);
        g.drawImage(sp.c, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
        g.restore();
      } else if (t - breakAt < 0.6 && breakFrom >= 20) {
        // 콤보 끊김: 숫자가 붉게 흔들리며 떨어짐
        const a = t - breakAt;
        g.globalAlpha = 0.9 * (1 - a / 0.6);
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = `700 72px ${comboFont}`;
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
        roundRectFill(g, W / 2 - 80, midY(0.48) - 20, 160, 40, 0);
        g.fillStyle = "#fff";
        g.font = `700 17px ${mono}`;
        g.fillText(`SPEED x${live.speed.toFixed(1)}`, W / 2, midY(0.48));
        g.globalAlpha = 1;
      }
      drawCountdown(g, cd, t + leadIn, W, laneTop, judgeY);
      // 온라인: 다 같이 시작하기 전 (카운트다운 전) 잠깐 비는 동안
      if (online && t + leadIn < 0) {
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = "rgba(0,0,0,0.55)";
        roundRectFill(g, W / 2 - 150, midY(0.45) - 24, 300, 48, 0);
        g.fillStyle = "#fff";
        g.font = `700 17px ${KR_FONT}`;
        g.fillText("다 같이 시작해요…", W / 2, midY(0.45) + 1);
      }
      // R 꾹: 다시 시작 (온라인은 Esc 꾹: 나가기) — 카운트다운처럼 비스듬한 띠에 게이지가 차오름
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
        // 키캡 R (온라인은 ESC)
        const kx = -bw / 2 + 14;
        const kw = online ? 50 : 30;
        g.fillStyle = "rgba(255,255,255,0.95)";
        roundRectFill(g, kx, -15, kw, 30, 0);
        g.fillStyle = "#1a1030";
        g.font = `700 ${online ? 15 : 18}px ${disp}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(online ? "ESC" : "R", kx + kw / 2, 1);
        // 글자
        g.fillStyle = "#fff";
        g.font = `700 19px ${disp}`;
        (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "4px";
        g.fillText(online ? "LEAVE" : "RESTART", 18 + (online ? 10 : 0), 1);
        (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0px";
        g.restore();
      }
      g.restore();
      if (introImg || cheerImg) drawCutins(t);
    };

    let raf = 0;
    let running = true;
    let finished = false;
    // 온라인: 0.5초마다 내 진행 한 줄
    let progAt = 0;
    const sendProg = (dead: boolean) =>
      online?.onProgress([
        engine.score,
        engine.combo,
        Math.round(engine.accuracy * 100) / 100,
        Math.round(engine.hp),
        dead ? 1 : 0,
        0,
        engine.counts.perfect,
        engine.counts.great,
        engine.counts.good,
        engine.counts.miss,
      ]);
    const resultOf = (failed: boolean): Result => {
      const acc = engine.accuracy;
      return {
        auto: autoplay || undefined,
        log: buildPlayLog(
          {
            song: { id: song.id, title: song.title, bpm: song.bpm, custom: !!song.custom },
            diff,
            level: chart.level ?? null,
            sync: {
              manual: sync,
              auto: Math.round(autoOffset),
              judge: Math.round(judgeSec() * 1000),
            },
            speed: live.speed,
            auto: autoplay,
            failed,
            result: {
              score: engine.score,
              acc: Math.round(acc * 100) / 100,
              maxCombo: engine.maxCombo,
              counts: { ...engine.counts },
            },
          },
          engine.notes,
          inputLog
        ),
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
      };
    };
    const finish = (failed = false) => {
      video?.pause();
      if (finished) return;
      finished = true;
      running = false;
      if (autoplay) autoSfxStop();
      onFinish(resultOf(failed));
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
    // 프레임 시간 측정 → 무거우면 효과를 한 단계씩 내림 (quality: 3 전부 · 2 박자 빛은 유지 · 1 박자 빛 끔·불꽃 절반·그림자 끔 · 0 해상도도 낮춤)
    //
    // 프레임 고정(pace): 90·120Hz 화면에서 한 프레임 그리기가 주사 간격(8.3ms)에 아슬아슬하면 8·17·8·17ms로 들쭉날쭉
    // 그려져서 눈이 따라가는 노트가 둘로 보인다(분신). 그럴 땐 한 칸씩 건너뛰어 2배 간격(60fps)으로 고르게 그리는 게
    // 훨씬 매끄럽다 — 60Hz 화면은 30fps가 너무 낮으니 효과를 먼저 내리고, 그래도 안 되면 그때 고정.
    const frameDt: number[] = [];
    const frameWork: number[] = [];
    let baseDt = 0;
    let lastFrameAt = 0;
    let qualityHold = 0;
    /** 그리는 간격(주사 간격의 배수): 1 매 프레임, 2 한 칸 건너 */
    let pace = 1;
    let paceHold = 0;
    let skipDraw = false;
    const measureFrame = (ts: number, workMs: number) => {
      if (lastFrameAt) {
        const dt = ts - lastFrameAt;
        if (dt < 200) frameDt.push(dt);
      }
      lastFrameAt = ts;
      frameWork.push(workMs);
      if (frameDt.length < 90) return;
      const sorted = [...frameDt].sort((a, b) => a - b);
      // 주사율: 처음 90프레임 중 빠른 쪽 10% 지점 (60Hz ≈ 16.7, 120Hz ≈ 8.3)
      if (!baseDt) baseDt = Math.max(4, Math.min(20, sorted[Math.floor(sorted.length * 0.1)]));
      const p90 = sorted[Math.floor(sorted.length * 0.9)];
      const work = [...frameWork].sort((a, b) => a - b);
      const work90 = work[Math.floor(work.length * 0.9)];
      frameDt.length = 0;
      frameWork.length = 0;
      qualityHold++;
      paceHold++;
      perfInfo = {
        fps: 1000 / (sorted[Math.floor(sorted.length / 2)] || 16.7),
        p90,
        work90,
        hz: 1000 / baseDt,
      };
      const highHz = baseDt <= 11; // 90Hz 이상
      // 60 고정: 100Hz 넘는 화면(120·144Hz)은 처음부터 한 칸 건너 그림 (90Hz는 45가 돼서 그대로)
      const cap60 = fps === "60" && baseDt < 10;
      if (cap60 && pace === 1) {
        pace = 2;
        paceHold = 0;
      }
      const want = baseDt * pace;
      if (p90 > want * 1.35) {
        // 떨어짐: 고주사율은 먼저 간격 고정, 60Hz는 효과부터
        if (pace === 1 && (highHz || quality === 0)) {
          pace = 2;
          paceHold = 0;
        } else if (quality > 0) {
          quality--;
          qualityHold = 0;
          if (quality === 0 && !lowRes) {
            lowRes = true;
            resize(true);
          }
          // 뮤비는 품질이 두 단계 내려가면 끔 (합성 부담 — 다시 켜지지 않음)
          if (quality <= 1 && video && !videoOff) {
            videoOff = true;
            video.pause();
            video.style.display = "none";
          }
        }
      } else if (p90 < want * 1.08) {
        // 4번(약 6초) 연속 가벼우면 한 단계 되돌림 — 간격 고정은 그리는 시간이 주사 간격의 절반도 안 돼야 풂
        if (pace === 2 && !cap60 && paceHold >= 4 && work90 < baseDt * 0.45) {
          pace = 1;
          paceHold = 0;
        } else if (quality < 3 && qualityHold >= 4) {
          quality++;
          qualityHold = 0;
        }
      }
    };
    // 뮤비: 오디오 시계에 맞춰 재생 (판정과 무관, 보여주기만). 어긋나면(120ms↑) 자리 맞춤
    const syncVideo = (t: number) => {
      if (!video) return;
      if (t < 0) {
        if (!video.paused) video.pause();
        if (video.readyState >= 1 && Math.abs(video.currentTime) > 0.05) video.currentTime = 0;
        return;
      }
      if (video.readyState < 2) return;
      if (video.paused) video.play().catch(() => {});
      if (Math.abs(video.currentTime - t) > 0.12) video.currentTime = t;
    };
    const frame = (ts: number) => {
      if (!running) return;
      if (rHoldAt !== null && performance.now() - rHoldAt >= R_HOLD_MS) {
        rHoldAt = null;
        running = false;
        if (online) {
          finished = true;
          online.onLeave();
        } else onRestart();
        return;
      }
      const workStart = performance.now();
      const t = smoothNow(ts);
      if (video && !videoOff) syncVideo(t);
      if (autoplay) {
        autoSfxSchedule();
        autoStep(t);
      }
      // 싱크가 잡히기 전(처음 몇 탭·곡 초반)엔 HP가 바닥나도 안 끝남 — 지연이 큰 기기는 첫 보정 전에 다 MISS라 죽어 버려서
      // 단, 거의 안 누르면(MISS가 누른 횟수의 2배 넘게) 유예 없음 — 가만히 있으면 MISS 10번(HP 바닥)에 바로 끝남
      engine.noFail =
        !!song.practice ||
        (tracker.grace && t < AUTO_SYNC.graceSec && presses * 2 >= engine.counts.miss);
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
        if (Math.floor(cc / 100) > Math.floor(prevCombo / 100)) cheerAt = t;
        sfx("combo-milestone", 0.55);
      } else if (cc < prevCombo && prevCombo >= 20) {
        breakAt = t;
        breakFrom = prevCombo;
        sfx("combo-break", 0.6);
      }
      prevCombo = cc;
      if (online && ts - progAt >= 500) {
        progAt = ts;
        sendProg(false);
      }
      if (engine.dead) return fail(t);
      // 간격 고정 중엔 한 칸 건너 그림 (판정·효과 계산은 매 프레임)
      if (pace === 2 && skipDraw) skipDraw = false;
      else {
        draw(t);
        skipDraw = true;
        measureFrame(ts, performance.now() - workStart);
      }
      if (engine.done && t > Math.max(engine.lastTime + 1.2, songEnd)) return finish();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // 온라인에서 죽음: 결과는 알리고, 내 레인은 멈춘 채로 다른 사람 미니 화면만 계속 (판이 끝나면 부모가 결과로)
    let watchingNow = false;
    const watch = (tFail: number) => {
      finished = true;
      running = false;
      watchingNow = true;
      reportAuto();
      online?.onDead(resultOf(true));
      setWatching(true);
      const tick = () => {
        if (!watchingNow) return;
        draw(tFail);
        // 내 레인 위에 FAILED · 기다리는 중
        g.save();
        g.translate(gx, 0);
        g.fillStyle = "rgba(4,3,12,0.62)";
        g.fillRect(0, laneTop, W, judgeY - laneTop);
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = "#F43F5E";
        g.font = `700 40px ${disp}`;
        g.fillText("FAILED", W / 2, midY(0.4));
        g.fillStyle = "rgba(255,255,255,0.8)";
        g.font = `700 16px ${KR_FONT}`;
        g.fillText("다른 사람이 끝나길 기다리는 중", W / 2, midY(0.4) + 40);
        g.fillStyle = "rgba(255,255,255,0.45)";
        g.font = `700 13px ${KR_FONT}`;
        g.fillText("Esc · 로비로 나가기", W / 2, midY(0.4) + 66);
        g.restore();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    // HP 바닥: 화면 멈추고 음악이 테이프 멈추듯 느려지며 꺼짐 → FAILED → 결과
    let failing = false;
    const fail = (tFail: number) => {
      if (failing) return;
      failing = true;
      if (online) sendProg(true);
      running = false;
      video?.pause();
      if (autoplay) autoSfxStop();
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
          if (online) return watch(tFail);
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
    const playHit = () => {
      if (live.hit <= 0) return;
      const src = ctx.createBufferSource();
      src.buffer = hitBuf;
      src.connect(hitGain);
      src.start();
    };
    // ── 분석 모드: 노트 시각에 딱 맞춰 누르고(올퍼펙) 롱노트는 끝까지 ──
    let autoNext = 0;
    const autoOrder = autoplay
      ? engine.notes.map((_, i) => i).sort((a, b) => engine.notes[a].t - engine.notes[b].t)
      : [];
    // 분석 모드 타격음: 프레임에서 바로 틀면 출력 지연(블루투스 ~200ms)만큼 음악보다 늦게 들림 —
    // 음악과 같은 오디오 시계에 미리 예약해서 샘플 단위로 맞춤 (일시정지는 ctx.suspend라 같이 멈췄다 같이 이어짐)
    let autoSfxNext = 0;
    const autoSfx: AudioBufferSourceNode[] = [];
    const autoSfxSchedule = () => {
      const horizon = ctx.currentTime + 0.8;
      while (autoSfxNext < autoOrder.length) {
        const n = engine.notes[autoOrder[autoSfxNext]];
        const at = startAt + n.t + offsetSec();
        if (at > horizon) break;
        autoSfxNext++;
        if (at < ctx.currentTime - 0.05) continue;
        const sNode = ctx.createBufferSource();
        sNode.buffer = hitBuf;
        sNode.connect(hitGain);
        sNode.start(Math.max(at, ctx.currentTime));
        autoSfx.push(sNode);
        if (autoSfx.length > 64) autoSfx.splice(0, 32); // 지난 것들은 버림 (멈출 일 있으면 최근 것만으로 충분)
      }
    };
    const autoSfxStop = () => {
      for (const sNode of autoSfx) {
        try {
          sNode.stop();
        } catch {}
      }
      autoSfx.length = 0;
    };
    /** 단노트는 80ms 뒤에 떼서 패드 불빛이 보이게 */
    const autoRelease = [Infinity, Infinity, Infinity, Infinity];
    const autoStep = (t: number) => {
      const notes = engine.notes;
      while (autoNext < autoOrder.length && notes[autoOrder[autoNext]].t <= t) {
        const n = notes[autoOrder[autoNext++]];
        if (engine.pressed[n.lane]) engine.release(n.lane, n.t - 0.001);
        engine.press(n.lane, n.t);
        autoRelease[n.lane] = n.end ? n.end : n.t + 0.08;
      }
      for (let l = 0; l < 4; l++)
        if (t >= autoRelease[l]) {
          engine.release(l, autoRelease[l]);
          autoRelease[l] = Infinity;
        }
    };
    const press = (lane: number, stamp = NaN) => {
      if (!running || autoplay) return;
      presses++;
      playHit();
      const t = eventTime(stamp);
      const tj = t - judgeSec();
      logInput(tj, lane, 1);
      engine.press(lane, tj);
      const d = nearestDiff(lane, tj);
      if (d !== null) autoSyncTap(d);
    };
    const release = (lane: number, stamp = NaN) => {
      if (!running || autoplay) return;
      const tj = eventTime(stamp) - judgeSec();
      logInput(tj, lane, 0);
      engine.release(lane, tj);
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
      // 온라인은 멈출 수 없음 (다 같이 치는 중) — 나가기는 Esc 꾹
      if (online) return;
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
      video?.pause();
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
      if (p.music !== undefined) musicGain.gain.value = live.music * musicFit;
      if (p.hit !== undefined) hitGain.gain.value = live.hit * 0.9 * LEVEL.rhythm.hit;
    };
    ctrl.current = { pause, resume, apply };

    const onKeyDown = (e: KeyboardEvent) => {
      // 레인 키가 먼저 — 사용자가 스페이스 · R · 화살표 등을 레인 키로 정했으면 그 키는 치기로만 씀
      const lane = keys.indexOf(e.code);
      if (lane >= 0) {
        e.preventDefault();
        if (!e.repeat) press(lane, e.timeStamp);
        return;
      }
      // 플레이 중엔 스페이스·PageDown 등으로 페이지가 스크롤되지 않게 (일시정지 중엔 버튼·슬라이더 조작용으로 둠)
      if ((running || resuming) && SCROLL_KEYS.has(e.code)) {
        e.preventDefault();
        return;
      }
      // R: 플레이 중엔 꾹 누르면 다시 시작, 일시정지 중엔 바로 다시 시작
      if (e.code === "KeyR") {
        e.preventDefault();
        if (e.repeat || online) return;
        if (running) rHoldAt = performance.now();
        else if (!resuming && !finished && !failing) onRestart();
        return;
      }
      if (e.code === "Escape") {
        e.preventDefault();
        if (e.repeat) return; // 꾹 누르고 있으면 멈춤·재개가 연달아 일어나던 문제
        // 온라인: 꾹 누르면 나가기 (실수로 한 번 눌러 나가지 않게). 죽고 나서 보는 중이면 바로
        if (online) {
          if (watchingNow) online.onLeave();
          else if (running) rHoldAt = performance.now();
          return;
        }
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
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "KeyR" || (online && e.code === "Escape")) rHoldAt = null;
      const lane = keys.indexOf(e.code);
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
      // 온라인: 멈추지 않고 뒤로가기만 다시 막아 둠 (나가기는 Esc 꾹·화면의 나가기)
      if (online) {
        window.history.pushState({ ...window.history.state, [PLAY_HISTORY_KEY]: true }, "");
        return;
      }
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
      video?.pause();
      cancelAnimationFrame(raf);
      for (const o of beeps) {
        try {
          o.stop();
        } catch {}
      }
      autoSfxStop();
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
    "pru-btn cursor-pointer px-[1.6cqw] py-[0.6cqw] text-[1.25cqw] whitespace-nowrap text-white";
  const rk = rankOf(pauseStats.acc);

  return (
    <div
      ref={wrapRef}
      className={`absolute inset-0 overflow-hidden ${portrait ? "flex items-center justify-center bg-black" : ""}`}
    >
      {domBg && !useVideo && song.bg && (
        /* 배경 전용 가로 그림: 그대로 꽉 채움 */
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: `url(${JSON.stringify(song.bg)})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      )}
      {domBg && !useVideo && !song.bg && (
        <>
          {/* 뒤: 화면을 꽉 채우는 짙게 흐린 사본 (재킷이 정사각이라 옆이 비는 자리 메움) */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: `url(${JSON.stringify(coverOf(song))})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              transform: "scale(1.1)",
              filter: "blur(28px) brightness(0.7)",
            }}
          />
          {/* 앞: 재킷 전체가 잘리지 않게 (contain) 살짝만 흐림 */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: `url(${JSON.stringify(coverOf(song))})`,
              backgroundSize: "contain",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "center",
              filter: "blur(4px) saturate(1.1)",
            }}
          />
        </>
      )}
      {useVideo && (
        <video
          ref={videoRef}
          src={song.video}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          style={{ opacity: 0.55 }}
        />
      )}
      <canvas
        ref={canvasRef}
        className={`touch-none select-none ${portrait ? "block" : "absolute inset-0 h-full w-full"}`}
      />
      {/* 세로 화면은 프레임 폭이 좁아서 버튼·일시정지 창을 크게 (zoom) */}
      <div
        className={`absolute z-10 flex gap-[0.6cqw] ${portrait ? "top-[1.2cqw] left-[1.2cqw]" : "top-[1.2cqw] right-[1.2cqw]"}`}
        style={portrait ? { zoom: 2.6 } : undefined}
      >
        {online ? (
          // 온라인은 멈출 수 없음 — 두 번 눌러야 나감 (실수 방지)
          <button
            type="button"
            onClick={() => {
              if (leaveArm || watching) online.onLeave();
              else {
                setLeaveArm(true);
                setTimeout(() => setLeaveArm(false), 2500);
              }
            }}
            className={`pru-btn cursor-pointer px-[0.9cqw] py-[0.3cqw] text-[1.05cqw] ${leaveArm ? "pru-pink" : "text-white/80 [--c:rgba(12,7,24,0.7)]"}`}
          >
            {watching
              ? "로비로 나가기"
              : leaveArm
                ? "한 번 더 누르면 나가기"
                : portrait
                  ? "나가기"
                  : "나가기 (Esc 꾹)"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => ctrl.current.pause()}
            className="pru-btn cursor-pointer px-[0.9cqw] py-[0.3cqw] text-[1.05cqw] text-white/80 [--c:rgba(12,7,24,0.7)]"
          >
            {portrait ? "II" : "II 일시정지 (Esc)"}
          </button>
        )}
        <button
          type="button"
          onClick={onToggleFs}
          title={fs ? "전체화면 끄기" : "전체화면"}
          className="pru-btn cursor-pointer px-[0.9cqw] py-[0.3cqw] text-[1.05cqw] text-white/80 [--c:rgba(12,7,24,0.7)]"
        >
          {fs ? "✕" : "⛶"}
        </button>
      </div>
      {paused && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pru-dither bg-[#0c0718]/60 [animation:modal-fade_200ms_steps(5)]">
          <div
            className={`flex flex-col items-center gap-[1cqw] ${portrait ? "w-[36cqw]" : "w-[52cqw]"}`}
            style={portrait ? { zoom: 2.6 } : undefined}
          >
            <p className="pru-t text-[3.4cqw] font-bold tracking-[0.2em] text-white drop-shadow-[0_0.2cqw_0_rgba(12,7,24,0.85)]">
              PAUSE
            </p>
            <div className="pru-win flex w-full items-center gap-[1.6cqw] px-[1.6cqw] py-[0.9cqw] [--wf:#17132f]">
              {pauseStats.judged > 0 ? (
                <RankEmblem rank={rk} className="h-[5.6cqw] w-[5.6cqw]" />
              ) : (
                <span className="flex h-[5.6cqw] w-[5.6cqw] items-center justify-center rounded-full border-[0.2cqw] border-dashed border-white/20 pru-t text-[2cqw] text-white/30 ">
                  ?
                </span>
              )}
              <div className="flex min-w-0 flex-col text-[1.1cqw] text-white/55">
                <span className="text-[2.2cqw] font-bold text-white tabular-nums">
                  {pauseStats.score.toLocaleString("en-US")}
                </span>
                <span>
                  정확도 {pauseStats.judged > 0 ? `${pauseStats.acc.toFixed(2)}%` : "—"} · 최대 콤보{" "}
                  {pauseStats.combo}
                </span>
              </div>
            </div>
            <div className="pru-win w-full px-[1.4cqw] py-[0.8cqw] [--wf:#17132f]">
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
                className={`${pbtn} pru-gold`}
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
  `/rhythm/px/rank-${rank === "S+" ? "splus" : rank === "D" ? "f" : rank.toLowerCase()}.webp`;
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

const KR_FONT = "'Galmuri11', 'Nanum Gothic', sans-serif";
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

/** 도트 글자 테두리: 검은 글자를 8방향으로 한 칸씩 찍고 오른쪽 아래 그림자 (둥근 stroke 대신 각진 테두리) */
function pxOutline(b: CanvasRenderingContext2D, text: string, x: number, y: number, o: number) {
  const fill = b.fillStyle;
  b.fillStyle = "rgba(0,0,0,0.55)";
  b.fillText(text, x + o * 1.6, y + o * 1.6);
  b.fillStyle = "#0c0718";
  for (const [dx, dy] of [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ])
    b.fillText(text, x + dx * o, y + dy * o);
  b.fillStyle = fill;
}

/** 정보판: 도트 창 (계단 모서리 이중 테두리 + 위 강조색 띠) — 한 칸 3px */
function glass(
  b: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  accent: string
) {
  const p = 3;
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  b.save();
  // 바깥 검은 테두리 (모서리 한 칸 비움 = 계단)
  b.fillStyle = "#0c0718";
  b.fillRect(x - p * 2, y, w + p * 4, h);
  b.fillRect(x, y - p * 2, w, h + p * 4);
  b.fillRect(x - p, y - p, w + p * 2, h + p * 2);
  // 안쪽 밝은 테두리
  b.fillStyle = "#7b62c4";
  b.fillRect(x - p, y, w + p * 2, h);
  b.fillRect(x, y - p, w, h + p * 2);
  // 판
  b.fillStyle = "rgba(21,14,41,0.9)";
  b.fillRect(x, y, w, h);
  // 위 밝은 줄 · 아래 그림자 줄
  b.fillStyle = "rgba(255,255,255,0.08)";
  b.fillRect(x, y, w, p);
  b.fillStyle = "rgba(0,0,0,0.3)";
  b.fillRect(x, y + h - p, w, p);
  // 강조색 띠
  b.fillStyle = accent;
  b.fillRect(x + 18, y - p, 66, p * 2);
  b.restore();
}

const fmtTime = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** 0~1 투명도 → "#rrggbb" 뒤에 붙일 두 자리 16진수 */

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
const CD_FONT = "'Galmuri11', 'Nanum Gothic', sans-serif";
let cdRing: HTMLImageElement | null = null;
/** 카운트다운 숫자 뒤에 터지는 링 그림 (ring.webp) */
const setCountdownRing = (im: HTMLImageElement) => {
  cdRing = im;
};
/** 테마 스킨의 카운트다운 색 (없으면 기본 분홍·보라 띠 · 파랑/노랑/빨강/분홍 숫자) */
let cdPal: SkinTheme["countdown"] | null = null;
const setCountdownTheme = (p: SkinTheme["countdown"] | null) => {
  cdPal = p;
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
  const [b0, b1] = cdPal?.band ?? ["219,39,119", "124,58,237"];
  band.addColorStop(0, `rgba(${b0},0)`);
  band.addColorStop(0.15, `rgba(${b0},0.85)`);
  band.addColorStop(0.85, `rgba(${b1},0.85)`);
  band.addColorStop(1, `rgba(${b1},0)`);
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
  g.font = `700 ${size}px ${CD_FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  if (ready) (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "8px";
  g.fillStyle = cdPal?.stroke ?? "rgba(20,6,40,0.9)";
  pxOutline(g, ph.label, 0, 4, ready ? 3 : 6);
  const numI = ["3", "2", "1", "GO!"].indexOf(ph.label);
  const col = cdPal && numI >= 0 ? cdPal.nums[numI] : ph.color;
  const gr = g.createLinearGradient(0, -size / 2, 0, size / 2);
  gr.addColorStop(0, "#FFFFFF");
  gr.addColorStop(0.5, ready ? (cdPal?.ready ?? "#F5D0FE") : col);
  gr.addColorStop(1, ready ? (cdPal?.ready ?? "#E9D5FF") : col);
  g.fillStyle = gr;
  g.shadowColor = ready ? (cdPal?.ready ?? "#F472B6") : col;
  g.shadowBlur = 18;
  g.fillText(ph.label, 0, 4);
  g.shadowBlur = 0;
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0px";
  g.restore();
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
// 앞자리 0은 채우지 않음 (0,711,333 처럼 보이던 것) — 711,333 / 1,000,000
const fmtScore = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

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
  "pru-btn h-[2.2cqw] w-[2.2cqw] shrink-0 cursor-pointer text-[1.2cqw] text-white disabled:opacity-30";

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
        className="min-w-0 flex-1"
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
      g.font = "700 64px 'Galmuri11', 'Nanum Gothic', sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "#F43F5E";
      g.fillText("FAILED", 0, 0);
    }
    g.globalAlpha = Math.min(1, Math.max(0, (el - 0.8) / 0.3));
    // 다른 HUD 글자처럼 굵은 기울임 + 자간, 붉은 빛
    const ls = g as CanvasRenderingContext2D & { letterSpacing?: string };
    g.font = `700 26px ${CD_FONT}`;
    ls.letterSpacing = "6px";
    g.textAlign = "center";
    g.textBaseline = "middle";
    pxOutline(g, "HP DEPLETED", 0, 150, 3);
    g.fillStyle = "#FFE4EA";
    g.fillText("HP DEPLETED", 0, 150);
    ls.letterSpacing = "0px";
  }
  g.restore();
}
