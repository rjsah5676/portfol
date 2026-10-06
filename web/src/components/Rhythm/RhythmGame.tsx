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
  loadAutoSync,
  saveAutoSync,
  type AutoSyncState,
} from "@/lib/rhythm/autosync";
import { HIT_SOUNDS, NOTE_SIZES, setNoteSize, SKINS } from "@/lib/rhythm/fx";
import { audio, loadSfx, playBgm, setSfxVolume, sfx, stopBgm } from "@/lib/rhythm/sfx";
import Stage, {
  COVERS_OPT,
  FIELD_POS,
  PLAY_HISTORY_KEY,
  type LiveSettings,
  type Result,
} from "./Stage";
import { makeAutoCharts } from "@/lib/rhythm/autochart";
import { displayBpm } from "@/lib/rhythm/analyze";
import type { CustomTrack } from "./CustomMusic";
import { CUSTOM_COVER } from "./SongCarousel";
import GameHeader from "@/components/GameHeader";
import { RHYTHM_GUIDE } from "@/data/gameGuides";
import TitleScreen from "./TitleScreen";
import SongSelect from "./SongSelect";
import SettingsModal, { LANE_MODS, type LaneMod, type Settings } from "./SettingsModal";
import ResultScreen from "./ResultScreen";

const SETTINGS_KEY = "rhythm_settings";
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
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Screen = "title" | "select" | "play" | "result";

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
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
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
          ) as Record<Difficulty, ReturnType<typeof makeChart>>)
        : null,
    [track]
  );
  const customSong = useMemo<Song | null>(() => {
    if (!track) return null;
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
      desc: "내 음악",
      beatOffset: a.beats[0] ?? 0,
      custom: true,
    };
  }, [track]);
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
  const previewVol = settings.music;
  // 미리 듣기할 곡: 내장곡, 또는 내 음악(파일을 넣은 뒤)
  const previewSong = customSel ? (track ? customSong : null) : builtinSong;
  const previewing = screen === "select" && entered && !!previewSong;
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
        const v = previewVol * 0.55;
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
  const bgmOn = entered && (screen === "title" || (screen === "select" && customSel && !track));
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
  }, [loading, customSel, isCustom, enterFs, screen, stopPreview, track, song]);

  const finish = useCallback(
    (r: Result) => {
      const key = `${r.songId}:${r.diff}`;
      const prev = best[key];
      // 중간에 죽은 판은 기록에 안 남김
      const newBest = !r.failed && (!prev || r.score > prev.score);
      if (!r.failed && (newBest || (r.fc && !prev?.fc) || (r.ap && !prev?.ap))) {
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
        desc="DFJK 4키 리듬게임 — 곡·난이도별 랭킹, 내 mp3도 자동 채보"
        guide={RHYTHM_GUIDE}
      />
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
              onStart={start}
              starting={loading}
              launching={launching}
              canStart={!!chart}
              err={err}
              onBack={() => setScreen("title")}
              onSettings={() => setSettingsOpen(true)}
              blocked={settingsOpen}
              fs={fs}
              onToggleFs={toggleFs}
            />
          )}
          {screen === "play" && play && chart && (
            <Stage
              key={play.round}
              song={song}
              diff={diff}
              chart={applyLaneMod(chart, settings.lanes, play.seed)}
              cover={settings.cover}
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
              onFinish={finish}
              onQuit={toSelect}
              onRestart={() =>
                setPlay((p) => p && { ...p, round: p.round + 1, seed: Math.random() * 1e9 })
              }
            />
          )}
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
            />
          )}
        </div>
      </div>
    </>
  );
}
