"use client";

/**
 * BEAT DASH — 리듬게임 전체를 16:9 화면 하나 안에서: 타이틀 → 곡 선택(설정 창) → 플레이 → 결과.
 * 화면 크기는 프레임 폭(cqw) 기준이라 창모드·전체화면이 같은 모양으로 커지고 줄어듦.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SONGS, type Song } from "@/lib/rhythm/music";
import { DIFFICULTIES, makeChart, type Chart, type Difficulty } from "@/lib/rhythm/chart";
import { renderSong } from "@/lib/rhythm/synth";
import {
  autoSyncProfile,
  clearAutoSync,
  loadAutoSync,
  saveAutoSync,
  type AutoSyncState,
} from "@/lib/rhythm/autosync";
import { HIT_SOUNDS, NOTE_SIZES, setNoteSize, SKINS } from "@/lib/rhythm/fx";
import { audio, loadSfx, playBgm, setSfxVolume, sfx, stopBgm } from "@/lib/rhythm/sfx";
import { fitGain, LEVEL } from "@/lib/soundLevel";
import { accelSettingsUrl, gpuInfo } from "@/lib/rhythm/gpu";
import Stage, {
  COVERS_OPT,
  FIELD_POS,
  PLAY_HISTORY_KEY,
  type LiveSettings,
  type OnlineStage,
  type Result,
} from "./Stage";
import { useRhythmOnline } from "./online/useRhythmOnline";
import OnlineLobby from "./online/OnlineLobby";
import OnlineRoom, { type RoomSongView } from "./online/OnlineRoom";
import {
  audioToWav,
  backToRoom,
  chartsToWire,
  downloadCustom,
  markLoaded,
  sendDone,
  sendProgress,
  serverNow,
  setDiff as setOnlineDiff,
  setReady,
  setSong as setOnlineSong,
  startGame,
  uploadCustom,
  type LiveRow,
} from "@/realtime/rhythmOnline";
import { makeAutoCharts } from "@/lib/rhythm/autochart";
import { displayBpm } from "@/lib/rhythm/analyze";
import type { CustomTrack } from "./CustomMusic";
import { CUSTOM_COVER, coverOf } from "./SongCarousel";
import { useAuth } from "@/lib/AuthContext";
import GameHeader from "@/components/GameHeader";
import { RHYTHM_GUIDE } from "@/data/gameGuides";
import TitleScreen from "./TitleScreen";
import SongSelect from "./SongSelect";
import SettingsModal, { LANE_MODS, type LaneMod, type Settings } from "./SettingsModal";
import ResultScreen from "./ResultScreen";
import { beginRun } from "@/lib/api/rankRun";
import { getBpTop, rhythmBoard, type BpRanking } from "@/firestore/rhythmRankings";
import RankList from "@/components/RankList";
import { bpChartLabel } from "./RankingBoard";

const SETTINGS_KEY = "rhythm_settings";
const BGM_MUTE_KEY = "rhythm_bgm_mute";
/** 저장 설정 버전 — 2: 노트 모양 기본값을 메탈로 바꾼 뒤 (그 전에 저장된 설정은 한 번 메탈로) */
const SETTINGS_VER = 3;
const BEST_KEY = "rhythm_best";

/** 레인 옵션 적용: 미러는 3-lane, 랜덤은 판마다 다른 순열 (동시치기는 그대로 동시치기) */
function applyLaneMod(chart: Chart, mod: LaneMod, seed: number): Chart {
  if (mod === "none") return chart;
  let perm = [3, 2, 1, 0];
  if (mod === "random") {
    perm = [0, 1, 2, 3];
    let a = seed >>> 0 || 1;
    for (let i = 3; i > 0; i--) {
      a = (a * 1103515245 + 12345) & 0x7fffffff;
      const j = a % (i + 1);
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
  }
  return { ...chart, notes: chart.notes.map((n) => ({ ...n, lane: perm[n.lane] })) };
}
export interface Best {
  score: number;
  acc: number;
  rank: string;
  fc: boolean;
  ap: boolean;
}

// 곡 렌더링은 한 번만 (페이지 안에서 재사용)
const buffers = new Map<string, Promise<AudioBuffer>>();
const loadSong = (s: Song) => {
  if (!buffers.has(s.id))
    buffers.set(
      s.id,
      s.audio
        ? // 음원 곡: 파일을 받아서 디코딩 (신스 곡은 직접 렌더)
          fetch(s.audio)
            .then((r) => {
              if (!r.ok) throw new Error(`audio ${r.status}`);
              return r.arrayBuffer();
            })
            .then((ab) => audio().then((ctx) => ctx.decodeAudioData(ab)))
        : renderSong(s)
    );
  const p = buffers.get(s.id)!;
  p.catch(() => buffers.delete(s.id)); // 실패하면 다음에 다시 시도
  return p;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** 내 음악 곡 색 후보 (노트·연출 색) */
const CUSTOM_COLORS = [
  "#22D3EE",
  "#F472B6",
  "#A78BFA",
  "#34D399",
  "#FBBF24",
  "#FB7185",
  "#60A5FA",
  "#F97316",
];
/** 내 음악 → 곡 정보 (곡 선택·플레이, 온라인 방장이 자기 파일로 칠 때) */
function trackSong(track: CustomTrack): Song {
  const a = track.analysis;
  return {
    id: `custom:${track.key}`,
    title: track.name,
    bpm: a.bpm,
    bpmLabel: displayBpm(a),
    bars: Math.ceil(a.duration / ((60 / a.bpm) * 4)),
    duration: a.duration,
    events: [],
    sections: [[0, ""]],
    sound: { lead: "sine", arp: "sine", delaySteps: 0 },
    // 채보(노트) 색: 곡마다 랜덤 (같은 파일이면 늘 같은 색)
    color: CUSTOM_COLORS[parseInt(track.key, 36) % CUSTOM_COLORS.length],
    cover: track.cover ?? CUSTOM_COVER,
    video: track.video,
    desc: "내 음악",
    beatOffset: a.beats[0] ?? 0,
    custom: true,
  };
}

/** 온라인: 방장이 올린 내 음악 → 곡 정보 (재킷·영상은 안 옴) */
function guestSong(s: {
  id: string;
  title: string;
  duration: number;
  info?: { bpm: number; bpmLabel: number; beatOffset: number; color: string };
}): Song {
  const i = s.info ?? { bpm: 120, bpmLabel: 120, beatOffset: 0, color: "#F472B6" };
  return {
    id: `online:${s.id}`,
    title: s.title,
    bpm: i.bpm,
    bpmLabel: i.bpmLabel,
    bars: Math.ceil(s.duration / ((60 / i.bpm) * 4)),
    duration: s.duration,
    events: [],
    sections: [[0, ""]],
    sound: { lead: "sine", arp: "sine", delaySteps: 0 },
    color: i.color,
    cover: CUSTOM_COVER,
    desc: "방장의 음악",
    beatOffset: i.beatOffset,
    custom: true,
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Screen = "title" | "select" | "play" | "result" | "online";

export default function RhythmGame() {
  const [screen, setScreen] = useState<Screen>("title");
  /** 타이틀에서 첫 입력을 받았는지 (그 전엔 브라우저가 소리를 막음) */
  const [entered, setEntered] = useState(false);
  /** 곡 목록 위치: 0..SONGS.length-1 = 내장곡, SONGS.length = 내 음악 */
  const [sel, setSel] = useState(0);
  const [diffSel, setDiff] = useState<Difficulty>("normal");
  const [settings, setSettings] = useState<Settings>({
    speed: 3,
    sync: 0,
    hit: 0.3,
    music: 1,
    sfx: 0.7,
    hitSound: "thump",
    skin: "metal",
    noteSize: "normal",
    lanes: "none",
    cover: "none",
    field: "left",
    bg: "cover",
    fps: "60",
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 회원 BP 랭킹: 게임 머리말(랭킹 버튼·창)에 — 들어올 때와 판이 끝날 때마다 다시 불러옴
  const [rankOpen, setRankOpen] = useState(false);
  const [bpTop, setBpTop] = useState<BpRanking[] | null>(null);
  const [bpRefresh, setBpRefresh] = useState(0);
  useEffect(() => {
    let alive = true;
    getBpTop(100)
      .then((list) => alive && setBpTop(list))
      .catch(() => alive && setBpTop([]));
    return () => {
      alive = false;
    };
  }, [bpRefresh]);
  // 분석 모드(관리자만): 채보를 올퍼펙으로 자동 연주해서 곡과 맞는지 감상. 기록·랭킹에 안 올림
  const { admin } = useAuth();
  const [analyze, setAnalyze] = useState(false);
  const autoplay = admin && analyze;
  /** 자동 싱크(사용자에겐 안 보임): 기기·입력 방식별 프로필로 저장. 플레이 시작 때 불러오고 판이 끝나면 저장 */
  const autoKey = useRef("");
  const [auto, setAuto] = useState<AutoSyncState>({ judge: 0, offset: 0 });
  const migratedAuto = useRef<AutoSyncState | null>(null);
  const onAutoSync = useCallback((next: AutoSyncState) => {
    if (autoKey.current) saveAutoSync(autoKey.current, next);
    setAuto(next);
  }, []);
  // 노트 두께는 그리기 모듈에 바로 반영 (플레이 화면·미리보기 공용)
  useEffect(() => setNoteSize(settings.noteSize), [settings.noteSize]);
  useEffect(() => setSfxVolume(settings.sfx), [settings.sfx]);
  const [best, setBest] = useState<Record<string, Best>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [play, setPlay] = useState<{
    ctx: AudioContext;
    buffer: AudioBuffer;
    round: number;
    /** 랜덤 레인 배치용 (판마다 새로) */
    seed: number;
  } | null>(null);
  const [result, setResult] = useState<(Result & { newBest: boolean }) | null>(null);

  // ── 전체화면: 게임 화면 전체(프레임)를 — 화면이 바뀌어도 그대로 유지 ──
  const rootRef = useRef<HTMLDivElement>(null);
  const [fsReal, setFsReal] = useState(false);
  /** 진짜 전체화면이 안 되는 브라우저(아이폰 사파리 등): 화면을 꽉 채우는 흉내 전체화면 */
  const [pseudoFs, setPseudoFs] = useState(false);
  const fs = fsReal || pseudoFs;
  useEffect(() => {
    const on = () => {
      const now = !!rootRef.current && document.fullscreenElement === rootRef.current;
      setFsReal(now);
      // 전체화면에선 Esc를 게임이 받게 (일시정지·뒤로) — 키보드 잠금이 되는 브라우저(크롬·엣지)만
      const kb = (
        navigator as Navigator & {
          keyboard?: { lock?: (k: string[]) => Promise<void>; unlock?: () => void };
        }
      ).keyboard;
      if (now) kb?.lock?.(["Escape"]).catch(() => {});
      else kb?.unlock?.();
    };
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  /** 전체화면 켜기 — 휴대폰은 화면 방향도 고정 (메뉴는 가로, 플레이는 세로 레인) */
  const enterFs = useCallback((orient: "landscape" | "portrait") => {
    const el = rootRef.current;
    if (!el || document.fullscreenElement) return;
    if (typeof el.requestFullscreen === "function")
      el.requestFullscreen({ navigationUI: "hide" })
        .then(() => {
          const o = window.screen.orientation as ScreenOrientation & {
            lock?: (o: string) => Promise<void>;
          };
          o?.lock?.(orient).catch(() => {});
        })
        .catch(() => setPseudoFs(true));
    else setPseudoFs(true);
  }, []);
  const toggleFs = useCallback(() => {
    if (pseudoFs) return setPseudoFs(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else enterFs("landscape");
  }, [pseudoFs, enterFs]);
  /** 휴대폰 세로로 플레이: 레인만 세로 화면 가득 */
  const [portrait, setPortrait] = useState(false);
  // 플레이가 끝나면 세로 고정을 풂 (메뉴는 원래대로)
  useEffect(() => {
    if (!portrait || screen === "play") return;
    const o = window.screen.orientation as ScreenOrientation & { unlock?: () => void };
    try {
      o?.unlock?.();
    } catch {}
  }, [portrait, screen]);

  // 사이트 플로팅 메뉴가 게임 화면 구석(시작 버튼)을 가려서 이 페이지에선 숨김
  useEffect(() => {
    const qm = document.querySelector<HTMLElement>("[data-quickmenu]");
    if (!qm) return;
    qm.style.display = "none";
    return () => {
      qm.style.display = "";
    };
  }, []);
  // 창모드에서 방향키·스페이스로 페이지가 스크롤되지 않게 (입력칸·슬라이더 조작은 그대로)
  useEffect(() => {
    const keys = new Set([
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Space",
      "PageUp",
      "PageDown",
    ]);
    const onKey = (e: KeyboardEvent) => {
      if (!keys.has(e.code)) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, select, [contenteditable=true]")) return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── 내 음악 ──
  const [track, setTrack] = useState<CustomTrack | null>(null);
  const customCharts = useMemo(
    () =>
      track
        ? (makeAutoCharts(
            track.analysis,
            DIFFICULTIES.map((d) => d.key)
          ) as Partial<Record<Difficulty, ReturnType<typeof makeChart>>>)
        : null,
    [track]
  );
  const customSong = useMemo<Song | null>(() => (track ? trackSong(track) : null), [track]);
  const customSel = sel === SONGS.length;
  const isCustom = customSel && !!customSong && !!customCharts;

  const builtinSong = SONGS[Math.min(sel, SONGS.length - 1)];

  const charts = useMemo(
    () =>
      Object.fromEntries(
        SONGS.map((s) => [
          s.id,
          s.charts ?? Object.fromEntries(DIFFICULTIES.map((d) => [d.key, makeChart(s, d.key)])),
        ])
      ) as Record<string, Partial<Record<Difficulty, Chart>>>,
    []
  );
  const song = isCustom ? customSong! : builtinSong;
  // 고를 수 있는 난이도: 내 음악은 전부, 내장곡은 채보가 있는 것만 (나이트메어는 일부 곡만)
  const diffs = useMemo(
    () => (customSel ? DIFFICULTIES : DIFFICULTIES.filter((d) => !!charts[builtinSong.id][d.key])),
    [customSel, charts, builtinSong.id]
  );
  const diff: Difficulty = diffs.some((d) => d.key === diffSel)
    ? diffSel
    : diffs[diffs.length - 1].key;
  const chart: Chart | null = customSel
    ? (customCharts?.[diff] ?? null)
    : charts[builtinSong.id][diff]!;

  // ── 곡 미리 듣기: 곡 선택에서 커서가 곡에 머물면 하이라이트 구간을 잠깐 틀어 줌 ──
  const previewRef = useRef<{
    src: AudioBufferSourceNode;
    gain: GainNode;
    ctx: AudioContext;
  } | null>(null);
  const stopPreview = useCallback((fade = 0.25) => {
    const p = previewRef.current;
    if (!p) return;
    previewRef.current = null;
    const t = p.ctx.currentTime;
    try {
      p.gain.gain.cancelScheduledValues(t);
      p.gain.gain.setValueAtTime(p.gain.gain.value, t);
      p.gain.gain.linearRampToValueAtTime(0, t + fade);
      p.src.stop(t + fade + 0.02);
    } catch {}
  }, []);
  // 브라우저 하드웨어 가속이 꺼져 있으면 안내 (켜기 전엔 전체화면에서 프레임이 크게 떨어짐)
  const [accelOff, setAccelOff] = useState<{ browser: string; url: string } | null>(null);
  const [accelCopied, setAccelCopied] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저에서만 잴 수 있음(마운트 1회)
    if (gpuInfo().software) setAccelOff(accelSettingsUrl());
  }, []);
  // 메뉴 배경음(타이틀 BGM·곡 미리 듣기) 끄기 — 🔊 버튼 / B 키. 플레이 중 음악은 그대로
  const [bgmMute, setBgmMute] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 값 복원(마운트 1회)
      setBgmMute(localStorage.getItem(BGM_MUTE_KEY) === "1");
    } catch {}
  }, []);
  const toggleBgm = useCallback(() => {
    setBgmMute((m) => {
      try {
        localStorage.setItem(BGM_MUTE_KEY, m ? "0" : "1");
      } catch {}
      return !m;
    });
    sfx("ui-move", 0.6);
  }, []);
  const previewVol = settings.music;
  // 미리 듣기할 곡: 내장곡, 또는 내 음악(파일을 넣은 뒤)
  const previewSong = customSel ? (track ? customSong : null) : builtinSong;
  const previewing = screen === "select" && entered && !!previewSong && !bgmMute;
  useEffect(() => {
    if (!previewing) return;
    let alive = true;
    // 커서가 멈춘 뒤 잠깐 있다가 (빠르게 넘길 땐 안 틀음)
    const timer = setTimeout(async () => {
      try {
        const ctx = await audio();
        if (ctx.state !== "running") return;
        const ps = previewSong!;
        const buffer = customSel && track ? track.buffer : await loadSong(ps);
        if (!alive) return;
        stopPreview(0.1);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const gain = ctx.createGain();
        src.connect(gain).connect(ctx.destination);
        // 하이라이트: 곡의 1/3 지점 근처 마디 시작부터 18초
        const beat = 60 / ps.bpm;
        const barSec = beat * 4;
        const from = Math.max(
          0,
          Math.floor(buffer.duration / 3 / barSec) * barSec + (ps.beatOffset ?? 0)
        );
        const len = Math.min(18, Math.max(4, buffer.duration - from - 0.5));
        const t = ctx.currentTime;
        const v = previewVol * 0.55 * fitGain(buffer, LEVEL.rhythm.musicLufs);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(v, t + 0.6);
        gain.gain.setValueAtTime(v, t + len - 1.2);
        gain.gain.linearRampToValueAtTime(0, t + len);
        src.start(t, from, len);
        previewRef.current = { src, gain, ctx };
        src.onended = () => {
          if (previewRef.current?.src === src) previewRef.current = null;
        };
      } catch {}
    }, 450);
    return () => {
      alive = false;
      clearTimeout(timer);
      stopPreview();
    };
  }, [previewing, previewSong, customSel, track, previewVol, stopPreview]);

  // 메뉴 BGM: 타이틀, 그리고 미리 듣기가 없는 화면(내 음악 고를 때)
  const bgmOn =
    entered && !bgmMute && (screen === "title" || (screen === "select" && customSel && !track));
  // B 키: 타이틀·곡 선택에서 배경음 켜고 끄기 (입력칸·설정 창에선 안 받음)
  useEffect(() => {
    if (!entered || settingsOpen || (screen !== "title" && screen !== "select")) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyB" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest?.("input, textarea")) return;
      e.preventDefault();
      toggleBgm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entered, settingsOpen, screen, toggleBgm]);
  useEffect(() => {
    if (bgmOn) playBgm(settings.music);
    else stopBgm();
  }, [bgmOn, settings.music]);
  useEffect(() => () => stopBgm(0.2), []);

  // ── 저장된 설정·기록 ──
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
      const b = JSON.parse(localStorage.getItem(BEST_KEY) ?? "null");
      /* eslint-disable react-hooks/set-state-in-effect -- 저장된 설정·기록 복원(마운트 1회) */
      if (s) {
        setSettings({
          speed: clamp(Number(s.speed) || 3, 1, 8),
          sync: clamp(Number(s.sync) || 0, -400, 400),
          hit: typeof s.hit === "number" ? clamp(s.hit, 0, 1) : 0.3,
          music: typeof s.music === "number" ? clamp(s.music, 0, 1) : 1,
          sfx: typeof s.sfx === "number" ? clamp(s.sfx, 0, 1) : 0.7,
          hitSound: HIT_SOUNDS.some((h) => h.key === s.hitSound) ? s.hitSound : "thump",
          skin:
            (Number(s.v) || 1) >= SETTINGS_VER && SKINS.some((k) => k.key === s.skin)
              ? s.skin
              : "metal",
          noteSize: NOTE_SIZES.some((k) => k.key === s.noteSize) ? s.noteSize : "normal",
          lanes: LANE_MODS.some((k) => k.key === s.lanes) ? s.lanes : "none",
          cover: COVERS_OPT.some((k) => k.key === s.cover) ? s.cover : "none",
          field: FIELD_POS.some((k) => k.key === s.field) ? s.field : "left",
          bg: s.bg === "stage" ? "stage" : "cover",
          fps: s.fps === "max" ? "max" : "60",
        });
        // 예전 설정(v2 이하)의 음악·타격 싱크는 자동 싱크가 들고 있던 값 → 자동 싱크 저장소로 옮김 (수동 싱크는 0부터)
        if ((Number(s.v) || 1) < 3 && (Number(s.offset) || Number(s.judge))) {
          const old = {
            judge: clamp(Number(s.judge) || 0, -400, 400),
            offset: clamp(Number(s.offset) || 0, -400, 400),
          };
          for (const touch of [false, true]) saveAutoSync(autoSyncProfile(touch, undefined), old);
          migratedAuto.current = old;
        }
        // 곡은 id로 기억 (새 곡이 맨 앞에 끼어들어도 고르던 곡 그대로)
        const si = SONGS.findIndex((x) => x.id === s.songId);
        if (si >= 0) setSel(si);
        if (DIFFICULTIES.some((d) => d.key === s.diff)) setDiff(s.diff);
      }
      if (b) setBest(b);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {}
    // 저장된 값을 불러온 뒤부터 저장 (개발 모드에서 effect가 두 번 돌 때 기본값이 덮어쓰는 것 방지)
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ ...settings, songId: builtinSong.id, diff, v: SETTINGS_VER })
      );
    } catch {}
  }, [hydrated, settings, builtinSong.id, diff]);

  // 고른 곡은 미리 받아 둬서 시작을 빠르게
  useEffect(() => {
    if (entered) loadSong(builtinSong).catch(() => {});
  }, [builtinSong, entered]);

  /** 타이틀에서 첫 입력: 소리 켜고 효과음·BGM 준비 */
  const enter = useCallback(async () => {
    if (entered) return;
    setEntered(true);
    try {
      await audio();
      await loadSfx();
      sfx("title-start");
    } catch {}
  }, [entered]);

  // 곡 시작 연출 (재킷이 들어오고 GET READY) — 곡을 받는 동안 보여 줌
  const [launching, setLaunching] = useState(false);
  const start = useCallback(async () => {
    if (loading) return;
    if (customSel && !isCustom) return;
    setErr("");
    setLoading(true);
    setSettingsOpen(false);
    // 랭킹 등록용 (직접 넣은 곡은 랭킹이 없음)
    if (!isCustom) beginRun(rhythmBoard(song.id, diff));
    // 휴대폰: 플레이는 늘 레인만 세로 화면 가득 — 전체화면으로 켜고 세로로 고정 (되는 브라우저만)
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    setPortrait(coarse);
    if (coarse) {
      if (!document.fullscreenElement) enterFs("portrait");
      else {
        const o = window.screen.orientation as ScreenOrientation & {
          lock?: (o: string) => Promise<void>;
        };
        o?.lock?.("portrait").catch(() => {});
      }
    }
    const fromResult = screen === "result";
    if (!fromResult) {
      sfx("song-decide");
      setLaunching(true);
    }
    stopPreview(0.3);
    try {
      const ctx = await audio();
      const [buffer] = await Promise.all([
        isCustom ? Promise.resolve(track!.buffer) : loadSong(song),
        wait(fromResult ? 0 : 1500),
      ]);
      // 자동 싱크 프로필: 키보드/터치 × 출력 지연(스피커↔블루투스가 바뀌면 다른 프로필)
      const key = autoSyncProfile(
        coarse,
        (ctx as AudioContext & { outputLatency?: number }).outputLatency
      );
      let state = loadAutoSync(key);
      // 예전 설정에서 옮겨 온 값이 있고 이 프로필이 비어 있으면 그 값부터 시작
      if (migratedAuto.current && state.judge === 0 && state.offset === 0)
        state = migratedAuto.current;
      autoKey.current = key;
      setAuto(state);
      setPlay((p) => ({ ctx, buffer, round: (p?.round ?? 0) + 1, seed: Math.random() * 1e9 }));
      setScreen("play");
    } catch (e) {
      console.error(e);
      setErr("이 브라우저에서 오디오를 재생할 수 없습니다.");
    } finally {
      setLoading(false);
      setLaunching(false);
    }
  }, [loading, customSel, isCustom, enterFs, screen, stopPreview, track, song, diff]);

  const finish = useCallback(
    (r: Result) => {
      const key = `${r.songId}:${r.diff}`;
      const prev = best[key];
      if (!r.failed && !r.auto) setTimeout(() => setBpRefresh((n) => n + 1), 4000); // 랭킹 등록 뒤 BP 다시
      // 중간에 죽은 판·자동 연주(분석 모드)는 기록에 안 남김
      const newBest = !r.failed && !r.auto && (!prev || r.score > prev.score);
      if (!r.failed && !r.auto && (newBest || (r.fc && !prev?.fc) || (r.ap && !prev?.ap))) {
        const next = {
          ...best,
          [key]: {
            score: Math.max(r.score, prev?.score ?? 0),
            acc: newBest ? r.acc : prev.acc,
            rank: newBest ? r.rank : prev.rank,
            fc: r.fc || !!prev?.fc,
            ap: r.ap || !!prev?.ap,
          },
        };
        setBest(next);
        try {
          localStorage.setItem(BEST_KEY, JSON.stringify(next));
        } catch {}
      }
      setResult({ ...r, newBest });
      setScreen("result");
    },
    [best]
  );

  // 플레이 화면 동안 같은 주소로 기록을 하나 쌓아 둠 → 모바일 뒤로가기가 페이지를 떠나지 않고
  // Stage의 popstate(일시정지)로 감. 화면을 나갈 때 그 기록이 아직 맨 위면 back()으로 소비
  useEffect(() => {
    if (screen !== "play") return;
    const timer = setTimeout(() => {
      window.history.pushState({ ...window.history.state, [PLAY_HISTORY_KEY]: true }, "");
    }, 0);
    return () => {
      clearTimeout(timer);
      if (window.history.state?.[PLAY_HISTORY_KEY]) window.history.back();
    };
  }, [screen]);

  // 플레이 중(일시정지 화면·속도 단축키)에 바꾼 설정 저장
  const onLiveSettings = useCallback(
    (p: Partial<LiveSettings>) => setSettings((s) => ({ ...s, ...p })),
    []
  );

  const toSelect = useCallback(() => {
    setScreen("select");
  }, []);

  // ───────────── 온라인 (같이 치기) ─────────────
  // 연결·구독은 온라인 화면을 열었을 때만. 플레이 중에 오가는 건 0.5초마다 점수 한 줄뿐 (Stage 는 그림만 찍음)
  const [onlineOn, setOnlineOn] = useState(false);
  const net = useRhythmOnline(onlineOn);
  const oRoom = net.room;
  /** 방장이 곡 선택 화면에서 방 곡을 고르는 중 */
  const [pickMode, setPickMode] = useState(false);
  /** 방장: 내 음악 올리는 진행 */
  const [upload, setUpload] = useState<{ ratio: number; error: string } | null>(null);
  /** 방장이 올린 내 음악 — 그 버전(ver) 곡이면 방장은 받지 않고 내 파일·내 채보로 침 */
  const [hosted, setHosted] = useState<{
    ver: string;
    track: CustomTrack;
    charts: Partial<Record<Difficulty, Chart>>;
  } | null>(null);
  /** 받아 둔 내 음악 (같은 곡으로 또 치면 다시 안 받음) */
  const [got, setGot] = useState<{
    ver: string;
    buffer: AudioBuffer;
    charts: Partial<Record<Difficulty, Chart>>;
  } | null>(null);
  const oRoomId = oRoom?.id;
  /** 이번 판 준비물 (받아서 디코딩까지 끝난 것) */
  type Prepared = {
    /** 방 id + 판 번호 (판 번호는 방마다 1부터라 방을 옮기면 겹침) */
    key: string;
    round: number;
    ctx: AudioContext;
    buffer: AudioBuffer;
    song: Song;
    chart: Chart;
    diff: Difficulty;
  };
  const [oPrep, setOPrep] = useState<Prepared | null>(null);
  const preparing = useRef("");
  const [oLoad, setOLoad] = useState<{ ratio: number; label: string; error: string } | null>(null);
  /** 지금 치고 있는 온라인 판 번호 (0 = 아님) */
  const [oPlaying, setOPlaying] = useState(0);
  /** 끝냈거나 나간 판 (다시 들어가지 않게) — 방 id + 판 번호 */
  const doneRounds = useRef(new Set<string>());
  const lastProg = useRef<LiveRow>([0, 0, 100, 100, 0, 0, 0, 0, 0, 0]);

  const openOnline = useCallback(() => {
    setOnlineOn(true);
    setScreen("online");
  }, []);
  const closeOnline = useCallback(() => {
    setOnlineOn(false);
    setPickMode(false);
    setScreen("title");
  }, []);

  /** 방 곡 → 곡 정보. 곡이 바뀔 때만 새로 (준비 등으로 방 상태가 와도 그대로 — 미리 듣기가 처음부터 다시 나오지 않게) */
  const roomSongKey = oRoom?.song ? `${oRoom.song.kind}:${oRoom.song.id}` : "";
  // 곡 id 가 바뀔 때만 새 객체 (방 상태 객체는 이벤트마다 새로 옴)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableSong = useMemo(() => oRoom?.song ?? null, [roomSongKey]);
  const onlineSong = useMemo<Song | null>(() => {
    const s = stableSong;
    if (!s) return null;
    if (s.kind === "builtin") return SONGS.find((x) => x.id === s.id) ?? null;
    return hosted?.ver === s.id ? trackSong(hosted.track) : guestSong(s);
  }, [stableSong, hosted]);
  const roomSongView = useMemo<RoomSongView | null>(() => {
    const s = oRoom?.song;
    if (!s || !onlineSong) return null;
    const ch =
      s.kind === "builtin"
        ? charts[s.id]
        : hosted?.ver === s.id
          ? hosted.charts
          : got?.ver === s.id
            ? got.charts
            : undefined;
    return {
      cover: coverOf(onlineSong),
      color: onlineSong.color,
      bpm: onlineSong.bpmLabel ?? onlineSong.bpm,
      artist: onlineSong.artist,
      levels: ch
        ? Object.fromEntries(Object.entries(ch).map(([d, c]) => [d, c!.level]))
        : (s.levels ?? {}),
    };
  }, [oRoom?.song, onlineSong, charts, hosted, got]);

  /** 방장의 음악 받기 — 같은 곡은 한 번만 (대기실에서 미리 받던 것이 있으면 그걸 이어서 기다림) */
  const gotJob = useRef<{
    ver: string;
    p: Promise<{ ver: string; buffer: AudioBuffer; charts: Partial<Record<Difficulty, Chart>> }>;
    onProgress?: (r: number) => void;
  } | null>(null);
  const fetchGot = useCallback((roomId: string, ver: string, onProgress?: (r: number) => void) => {
    const cur = gotJob.current;
    if (cur?.ver === ver) {
      cur.onProgress = onProgress;
      return cur.p;
    }
    // 진행 표시는 나중에 기다리는 쪽(판 준비)이 바꿔 끼울 수 있게
    const prog: { fn?: (r: number) => void } = { fn: onProgress };
    const p = (async () => {
      const d = await downloadCustom(roomId, (r) => prog.fn?.(r));
      prog.fn?.(1);
      const ctx = await audio();
      const g = { ver, buffer: await ctx.decodeAudioData(d.audio), charts: d.charts };
      setGot(g);
      return g;
    })();
    const job = {
      ver,
      p,
      get onProgress() {
        return prog.fn;
      },
      set onProgress(f) {
        prog.fn = f;
      },
    };
    // 실패하면 다음에 다시 받게
    job.p.catch(() => {
      if (gotJob.current === job) gotJob.current = null;
    });
    gotJob.current = job;
    return job.p;
  }, []);
  // 대기실: 방장이 내 음악을 다 올리면 미리 받아 둠 (시작을 누르면 바로 칠 수 있게)
  useEffect(() => {
    const s = oRoom?.song;
    if (!oRoom || !s || s.kind !== "custom" || !s.ready) return;
    if (oRoom.phase !== "lobby" && oRoom.phase !== "result") return;
    if (hosted?.ver === s.id || got?.ver === s.id || gotJob.current?.ver === s.id) return;
    fetchGot(oRoom.id, s.id).catch((e) => console.warn("미리 받기 실패", e));
  }, [oRoom, hosted, got, fetchGot]);

  // loading: 내 음원·채보 준비 → 서버에 "받음"
  const oRound = oRoom?.round;
  useEffect(() => {
    const uid = net.uid;
    if (!oRoom || !uid || oRoom.phase !== "loading" || !oRound || !oRound.roster.includes(uid))
      return;
    const no = oRound.no;
    const key = `${oRoom.id}#${no}`;
    if (oPrep?.key === key || preparing.current === key) return;
    preparing.current = key;
    const s = oRoom.song!;
    const diff = oRoom.players[uid]?.diff ?? "normal";
    const id = oRoom.id;
    void (async () => {
      try {
        setOLoad({ ratio: 0, label: "곡 받는 중", error: "" });
        const ctx = await audio();
        let buffer: AudioBuffer;
        let chart: Chart | undefined;
        let song: Song;
        if (s.kind === "builtin") {
          song = SONGS.find((x) => x.id === s.id)!;
          buffer = await loadSong(song);
          chart = charts[s.id]?.[diff];
        } else if (hosted?.ver === s.id) {
          song = trackSong(hosted.track);
          buffer = hosted.track.buffer;
          chart = hosted.charts[diff];
        } else {
          const g =
            got?.ver === s.id
              ? got
              : await fetchGot(id, s.id, (r) =>
                  setOLoad({
                    ratio: r * 0.95,
                    label: r < 1 ? "곡 받는 중" : "곡 여는 중",
                    error: "",
                  })
                );
          song = guestSong(s);
          buffer = g.buffer;
          chart = g.charts[diff];
        }
        if (!chart) throw new Error("이 난이도 채보가 없어요.");
        setOPrep({ key, round: no, ctx, buffer, song, chart, diff });
        setOLoad({ ratio: 1, label: "준비 완료", error: "" });
        await markLoaded(id, no);
      } catch (e) {
        console.error(e);
        setOLoad({
          ratio: 0,
          label: "",
          error: e instanceof Error ? e.message : "곡을 받지 못했어요.",
        });
      } finally {
        if (preparing.current === key) preparing.current = "";
      }
    })();
  }, [oRoom, oRound, net.uid, oPrep?.key, hosted, got, charts, fetchGot]);

  // playing: 준비가 끝난 판이면 플레이 화면으로 (시작 시각은 서버가 정함 — Stage 가 맞춰 기다림)
  useEffect(() => {
    const uid = net.uid;
    const r = oRoom?.round;
    if (!oRoom || oRoom.phase !== "playing" || !r || !uid || !r.roster.includes(uid)) return;
    const rk = `${oRoom.id}#${r.no}`;
    if (screen !== "online" || oPlaying === r.no || doneRounds.current.has(rk)) return;
    if (!oPrep || oPrep.key !== rk) return;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const key = autoSyncProfile(
      coarse,
      (oPrep.ctx as AudioContext & { outputLatency?: number }).outputLatency
    );
    autoKey.current = key;
    /* eslint-disable react-hooks/set-state-in-effect -- 서버가 판을 시작하면 플레이 화면으로 */
    setAuto(loadAutoSync(key));
    setPortrait(coarse);
    lastProg.current = [0, 0, 100, 100, 0, 0, 0, 0, 0, 0];
    setOPlaying(r.no);
    setPlay((p) => ({
      ctx: oPrep.ctx,
      buffer: oPrep.buffer,
      round: (p?.round ?? 0) + 1,
      seed: Math.random() * 1e9,
    }));
    setScreen("play");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [oRoom, net.uid, screen, oPlaying, oPrep]);
  // 대기실로 돌아오면 받는 중 표시 지움
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 판이 끝나면 정리
    if (oRoom?.phase === "lobby" || oRoom?.phase === "result") setOLoad(null);
  }, [oRoom?.phase]);

  /** 내 판 결과를 서버에 (죽었을 땐 화면은 그대로 두고 이것만) */
  const reportOnline = useCallback(
    (r: Result) => {
      const id = oRoomId;
      const no = oPlaying;
      doneRounds.current.add(`${id}#${no}`);
      if (id && no)
        sendDone(id, no, {
          score: r.score,
          acc: Math.round(r.acc * 100) / 100,
          rank: r.rank,
          maxCombo: r.maxCombo,
          failed: r.failed,
          fc: r.fc,
          ap: r.ap,
          counts: r.counts,
        }).catch(() => {});
    },
    [oRoomId, oPlaying]
  );
  // 죽고 나서 보던 판이 끝나면(결과·대기실) 방 화면으로
  useEffect(() => {
    if (screen !== "play" || !oPlaying || !oRoom) return;
    if (oRoom.phase === "result" || oRoom.phase === "lobby" || oRoom.round?.no !== oPlaying) {
      /* eslint-disable react-hooks/set-state-in-effect -- 서버가 판을 끝내면 결과 화면으로 */
      setOPlaying(0);
      setScreen("online");
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [screen, oPlaying, oRoom]);
  const finishOnline = useCallback(
    (r: Result) => {
      const id = oRoomId;
      const no = oPlaying;
      doneRounds.current.add(`${id}#${no}`);
      if (id && no)
        sendDone(id, no, {
          score: r.score,
          acc: Math.round(r.acc * 100) / 100,
          rank: r.rank,
          maxCombo: r.maxCombo,
          failed: r.failed,
          fc: r.fc,
          ap: r.ap,
          counts: r.counts,
        }).catch(() => {});
      setOPlaying(0);
      setScreen("online");
    },
    [oRoomId, oPlaying]
  );
  /** 치다가 나가기 (Esc 꾹 · 나가기 버튼) — 그때 점수로 실패 처리, 방에는 남음 */
  const leaveOnlinePlay = useCallback(() => {
    const id = oRoomId;
    const no = oPlaying;
    const l = lastProg.current;
    doneRounds.current.add(`${id}#${no}`);
    if (id && no)
      sendDone(id, no, {
        score: l[0],
        acc: l[2],
        rank: "F",
        maxCombo: 0,
        failed: true,
        fc: false,
        ap: false,
        counts: { perfect: 0, great: 0, good: 0, miss: 0 },
      }).catch(() => {});
    setOPlaying(0);
    setScreen("online");
  }, [oRoomId, oPlaying]);
  /** 지금 온라인 판을 치는 중 */
  const playingOnline = oPlaying > 0 && oRoom?.round?.no === oPlaying;
  const onlineStage = useMemo<OnlineStage | undefined>(() => {
    const r = oRoom?.round;
    if (!oPlaying || !oRoom || !r || r.no !== oPlaying) return undefined;
    const id = oRoom.id;
    return {
      startAt: r.startAt,
      serverNow,
      board: net.board,
      onProgress: (row) => {
        lastProg.current = row;
        sendProgress(id, oPlaying, row);
      },
      onLeave: leaveOnlinePlay,
      onDead: reportOnline,
    };
    // 판이 시작될 때 한 번만 (점수판은 같은 객체를 계속 고쳐 씀)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oPlaying, oRoom?.id, oRoom?.round?.startAt, leaveOnlinePlay, reportOnline]);

  /** 방장: 곡 선택 화면에서 고른 곡을 방 곡으로 (내 음악은 뒤에서 올림) */
  const pickForRoom = useCallback(async () => {
    const id = oRoomId;
    if (!id) return;
    setPickMode(false);
    setScreen("online");
    sfx("song-decide", 0.7);
    try {
      if (!isCustom) {
        await setOnlineSong(id, builtinSong.id, diff, builtinSong.title);
        return;
      }
      const t = track!;
      const ch = customCharts!;
      const ts = trackSong(t);
      setUpload({ ratio: 0, error: "" });
      // 영상은 너무 커서 소리만 (WAV), 소리 파일은 그대로 (서버 한도 60MB를 넘는 무손실 파일 등도 WAV로 줄여서)
      const blob =
        t.file && !t.isVideo && t.file.size <= 55 * 1024 * 1024
          ? t.file
          : await audioToWav(t.buffer);
      await uploadCustom(
        id,
        {
          // 파일 이름의 밑줄은 띄어쓰기로 (QWER_-_My_Name → QWER - My Name)
          title: (t.name.replace(/_+/g, " ").replace(/\s+/g, " ").trim() || t.name).slice(0, 80),
          diff,
          duration: t.buffer.duration,
          info: {
            bpm: ts.bpm,
            bpmLabel: ts.bpmLabel ?? ts.bpm,
            beatOffset: ts.beatOffset ?? 0,
            color: ts.color,
          },
        },
        blob,
        chartsToWire(ch),
        (r) => setUpload({ ratio: r, error: "" }),
        (ver) => setHosted({ ver, track: t, charts: ch })
      );
      setUpload(null);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "올리지 못했어요";
      setUpload({ ratio: 0, error: msg });
      net.setErr(msg);
    }
  }, [oRoomId, isCustom, builtinSong, diff, track, customCharts, net]);
  // 방에서 곡을 골라 두면 메뉴 BGM 대신 그 곡 하이라이트(8마디)를 반복 — 참가자는 내 음악을 받기 전까진 BGM
  const roomSong = oRoom?.song;
  const roomHostBuf = roomSong && hosted?.ver === roomSong.id ? hosted.track.buffer : null;
  const roomGotBuf = roomSong && got?.ver === roomSong.id ? got.buffer : null;
  const roomPreviewOn =
    screen === "online" &&
    entered &&
    !bgmMute &&
    !!onlineSong &&
    (roomSong?.kind === "builtin" || !!roomHostBuf || !!roomGotBuf);
  useEffect(() => {
    if (screen !== "online") return;
    if (entered && !bgmMute && !roomPreviewOn) playBgm(settings.music);
    else stopBgm();
  }, [screen, entered, bgmMute, roomPreviewOn, settings.music]);
  useEffect(() => {
    if (!roomPreviewOn || !onlineSong) return;
    let alive = true;
    let node: { src: AudioBufferSourceNode; gain: GainNode; ctx: AudioContext } | null = null;
    void (async () => {
      try {
        const ctx = await audio();
        if (ctx.state !== "running") return;
        const buffer = roomHostBuf ?? roomGotBuf ?? (await loadSong(onlineSong));
        if (!alive) return;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const gain = ctx.createGain();
        src.connect(gain).connect(ctx.destination);
        const barSec = (60 / onlineSong.bpm) * 4;
        const from = Math.max(
          0,
          Math.floor(buffer.duration / 3 / barSec) * barSec + (onlineSong.beatOffset ?? 0)
        );
        const len = Math.min(barSec * 8, Math.max(4, buffer.duration - from - 0.5));
        src.loop = true;
        src.loopStart = from;
        src.loopEnd = from + len;
        const t = ctx.currentTime;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(
          settings.music * 0.55 * fitGain(buffer, LEVEL.rhythm.musicLufs),
          t + 0.8
        );
        src.start(t, from);
        node = { src, gain, ctx };
      } catch {}
    })();
    return () => {
      alive = false;
      if (!node) return;
      const { src, gain, ctx } = node;
      const t = ctx.currentTime;
      try {
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.3);
        src.stop(t + 0.35);
      } catch {}
    };
  }, [roomPreviewOn, onlineSong, roomHostBuf, roomGotBuf, settings.music]);

  const roomAct = useCallback(
    (p: Promise<unknown>) =>
      p.catch((e) => net.setErr(e instanceof Error ? e.message : "요청을 처리하지 못했어요.")),
    [net]
  );

  const portraitPlay = portrait && screen === "play";
  const frameCls = portraitPlay
    ? // 세로 레인: 화면 전체 (전체화면이 안 되는 브라우저도 화면을 덮음)
      "fixed inset-0 z-[120] isolate h-[100dvh] w-screen overflow-hidden bg-black select-none [container-type:inline-size]"
    : `fs-screen relative isolate aspect-video w-full overflow-hidden bg-black select-none [container-type:inline-size] ${
        fs ? "" : "rounded-xl border border-white/10 shadow-[0_0_60px_rgba(108,99,255,0.18)]"
      }`;
  const rootCls = fs
    ? `${pseudoFs ? "fixed inset-0 z-[100] " : ""}flex h-full w-full items-center justify-center bg-black [&>.fs-screen]:w-[min(100vw,calc(100dvh*16/9))]`
    : "mx-auto w-full max-w-[min(1120px,calc((100dvh-190px)*16/9))]";

  return (
    <>
      {/* 다른 게임 페이지와 같은 머리말 (창모드에서만 보임 — 전체화면은 게임 화면만) */}
      <GameHeader
        icon="🎹"
        title="BEAT DASH"
        en="Rhythm Game"
        accent="#EC4899"
        desc="DFJK 4키 리듬게임"
        tags={["랭킹모드", "온라인모드", "mp3 자동 채보", "웹 리듬게임"]}
        ach="rhythm"
        guide={RHYTHM_GUIDE}
        rank={{
          top: bpTop?.slice(0, 3).map((r) => ({
            name: r.name,
            member: r.member,
            avatar: r.avatar,
            value: `${r.bp.toLocaleString("en-US")} BP`,
            sub: `${r.songs}곡`,
          })),
          sub: "BP — 회원 랭킹 · 곡마다 가장 좋은 판 하나, 상위 20곡 합",
          open: rankOpen,
          onOpenChange: setRankOpen,
          render: () =>
            bpTop === null ? (
              <p className="py-3 font-mono text-xs text-white/30">불러오는 중…</p>
            ) : (
              <RankList
                rows={bpTop.map((r) => ({
                  name: r.name,
                  member: r.member,
                  avatar: r.avatar,
                  value: `${r.bp.toLocaleString("en-US")} BP`,
                  sub: `${r.songs}곡${r.best ? ` · 최고 ${bpChartLabel(r.best.chart)} ${r.best.bp}` : ""}`,
                }))}
                skip={3}
                empty="아직 BP 기록이 없어요. 회원으로 곡을 끝까지 치면 쌓여요."
              />
            ),
        }}
      />
      {accelOff && !fs && (
        <div className="mx-auto mb-2 flex w-full max-w-[min(1120px,calc((100dvh-190px)*16/9))] flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-xl border border-[#F59E0B]/60 bg-[#F59E0B]/12 px-4 py-2 font-['Nanum_Gothic',sans-serif] text-[13px] text-white/85">
          <span className="rounded-md bg-[#F59E0B] px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#1a1000]">
            !
          </span>
          <b className="font-bold text-[#FDE68A]">브라우저 그래픽 가속이 꺼져 있어요</b>
          <span className="text-white/60">
            — 화면이 끊길 수 있어요. {accelOff.browser} 주소창에
          </span>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard
                ?.writeText(accelOff.url.split(" ")[0])
                .then(() => setAccelCopied(true))
                .catch(() => {});
            }}
            title="주소 복사"
            className="cursor-pointer rounded-md border border-white/20 bg-black/30 px-1.5 py-0.5 font-mono text-[12px] text-white transition-colors hover:border-white/50"
          >
            {accelOff.url}
            <span className="ml-1.5 text-white/45">{accelCopied ? "복사됨" : "복사"}</span>
          </button>
          <span className="text-white/60">
            → &lsquo;그래픽 가속 사용&rsquo; 켜고 브라우저 다시 시작
          </span>
        </div>
      )}
      {!fs && (
        <button
          type="button"
          onClick={toggleFs}
          className="group mx-auto mb-3 flex w-full max-w-[min(1120px,calc((100dvh-190px)*16/9))] cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#EC4899]/45 bg-[linear-gradient(90deg,rgba(236,72,153,0.18),rgba(124,58,237,0.18))] px-4 py-2 font-['Nanum_Gothic',sans-serif] text-[13px] text-white/85 shadow-[0_0_24px_-6px_rgba(236,72,153,0.55)] transition-colors hover:border-[#EC4899] hover:text-white"
        >
          <span className="rounded-md bg-[#EC4899] px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">
            ⛶
          </span>
          <b className="font-bold text-white">전체화면 플레이 권장</b>
          <span className="text-white/55">
            — 여기를 누르면 전체화면으로 (게임 안에서도 켜고 끌 수 있어요)
          </span>
        </button>
      )}
      <div ref={rootRef} className={rootCls}>
        <div className={frameCls}>
          {screen === "title" && (
            <TitleScreen
              entered={entered}
              onEnter={enter}
              onStart={() => setScreen("select")}
              onSettings={() => setSettingsOpen(true)}
              onRanking={() => setRankOpen(true)}
              onOnline={openOnline}
              bgmMute={bgmMute}
              onToggleBgm={toggleBgm}
              fs={fs}
              onToggleFs={toggleFs}
              blocked={settingsOpen}
            />
          )}
          {screen === "select" && (
            <SongSelect
              songs={SONGS}
              sel={sel}
              onSel={setSel}
              charts={charts}
              diffs={diffs}
              diff={diff}
              onDiff={setDiff}
              best={best}
              track={track}
              onTrack={setTrack}
              customCharts={customCharts}
              song={customSel ? customSong : builtinSong}
              onStart={pickMode ? pickForRoom : start}
              starting={loading}
              launching={launching}
              canStart={!!chart}
              startLabel={pickMode ? "PICK" : "START"}
              err={err}
              onBack={() => {
                if (pickMode) {
                  setPickMode(false);
                  setScreen("online");
                } else setScreen("title");
              }}
              onSettings={() => setSettingsOpen(true)}
              bgmMute={bgmMute}
              onToggleBgm={toggleBgm}
              blocked={settingsOpen}
              fs={fs}
              onToggleFs={toggleFs}
              analyze={admin && !pickMode ? analyze : undefined}
              onAnalyze={setAnalyze}
            />
          )}
          {screen === "play" && play && (playingOnline ? !!oPrep : !!chart) && (
            <Stage
              key={play.round}
              song={playingOnline ? oPrep!.song : song}
              diff={playingOnline ? oPrep!.diff : diff}
              chart={applyLaneMod(playingOnline ? oPrep!.chart : chart!, settings.lanes, play.seed)}
              cover={settings.cover}
              bg={settings.bg}
              fps={settings.fps}
              buffer={play.buffer}
              ctx={play.ctx}
              speed={settings.speed}
              sync={settings.sync}
              auto={auto}
              onAutoSync={onAutoSync}
              hitVolume={settings.hit}
              musicVolume={settings.music}
              onSettings={onLiveSettings}
              hitSound={settings.hitSound}
              skin={settings.skin}
              field={settings.field}
              fs={fs}
              onToggleFs={toggleFs}
              portrait={portrait}
              autoplay={playingOnline ? false : autoplay}
              online={onlineStage}
              onFinish={playingOnline ? finishOnline : finish}
              onQuit={playingOnline ? leaveOnlinePlay : toSelect}
              onRestart={() =>
                setPlay((p) => p && { ...p, round: p.round + 1, seed: Math.random() * 1e9 })
              }
            />
          )}
          {screen === "online" &&
            (oRoom && net.uid ? (
              <OnlineRoom
                room={oRoom}
                uid={net.uid}
                live={net.live}
                songView={roomSongView}
                upload={upload}
                load={oLoad}
                err={net.err}
                onPick={() => {
                  net.setErr("");
                  setPickMode(true);
                  // 지금 방 곡이 내장곡이면 그 곡에 커서를
                  const si = SONGS.findIndex((x) => x.id === oRoom.song?.id);
                  if (si >= 0) setSel(si);
                  setScreen("select");
                }}
                onDiff={(d) => void roomAct(setOnlineDiff(oRoom.id, d))}
                onReady={(r) => void roomAct(setReady(oRoom.id, r))}
                onStart={() => {
                  sfx("song-decide", 0.8);
                  void roomAct(startGame(oRoom.id));
                }}
                onBack={() => void roomAct(backToRoom(oRoom.id))}
                onLeave={() => {
                  net.leave();
                  setUpload(null);
                }}
                fs={fs}
                onToggleFs={toggleFs}
                onSettings={() => setSettingsOpen(true)}
                blocked={settingsOpen}
              />
            ) : (
              <OnlineLobby
                rooms={net.lobby}
                nick={net.nick}
                member={net.member}
                avatar={net.avatar}
                onNick={net.setNick}
                onCreate={net.create}
                onJoin={net.join}
                onBack={closeOnline}
                err={net.err}
                ready={!!net.uid}
                fs={fs}
                onToggleFs={toggleFs}
                onSettings={() => setSettingsOpen(true)}
                blocked={settingsOpen}
              />
            ))}
          {screen === "result" && result && (
            <ResultScreen
              result={result}
              song={song}
              onRetry={start}
              onSelect={toSelect}
              starting={loading}
            />
          )}
          {settingsOpen && (
            <SettingsModal
              settings={settings}
              setSettings={setSettings}
              color={song?.color ?? "#A78BFA"}
              onClose={() => setSettingsOpen(false)}
              onResetAuto={() => {
                clearAutoSync();
                migratedAuto.current = null;
                setAuto({ judge: 0, offset: 0 });
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}
