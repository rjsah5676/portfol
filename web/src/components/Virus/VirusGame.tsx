"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@/css/Page/virus.css";
import GameHeader from "@/components/GameHeader";
import SpeakerIcon from "@/components/Rhythm/SpeakerIcon";
import { LEVEL } from "@/lib/soundLevel";
import { lockScroll } from "@/lib/scrollLock";
import { playVirusSfx, setVirusSfxVolume, unlockVirusSfx } from "@/lib/virus/sfx";
import { VIRUS_GUIDE } from "@/data/gameGuides";
import { FileSprite, MyVirusSprite, VirusSprite } from "./VirusSprite";
import TitleScreen, { type TitleItem } from "./TitleScreen";
import FitPages, { Pager } from "./FitPages";
import BossCinema, { BossShards, type Cinema } from "./BossCinema";
import {
  ArchivePanel,
  PATCH_NOTES,
  PagedGuide,
  PatchNotesPanel,
  DEFAULT_SETTINGS,
  MenuButton,
  SETTINGS_KEY,
  SettingsPanel,
  Window,
  type VirusSettings,
} from "./Panels";
import {
  BAL,
  BOSS_TIME,
  EVOLUTION,
  evoStage,
  FILE_TYPES,
  MOBS_PER_STAGE,
  ROSTER,
  SAVE_KEY,
  SHOT_MS,
  UPGRADES,
  bossData,
  bossHp,
  bossOf,
  canFormat,
  dps,
  fmt,
  fmtBytes,
  fmtTime,
  format,
  gainData,
  mobData,
  mobHp,
  moduleLevels,
  newSave,
  offlineGain,
  parseSave,
  pendingRoot,
  stats,
  tierLabel,
  upgCost,
  RAND_ODDS,
  randUpgrade,
  randPrice,
  SHOP,
  applyPlan,
  optimalPlan,
  shopLocked,
  bulkCost,
  buyShop,
  rootLeft,
  shopCost,
  upgradeAdvice,
  rootAdvice,
  type UpgKey,
  zoneOf,
  type Save,
  type UpgDef,
} from "@/lib/virus/logic";

const TICK_MS = 100;
/** 보스 연출 길이 — virus.css 의 vb-* (2.3s) · vd-* (1.7s) 와 같게, 효과음 길이에 맞춘 값 */
const APPEAR_MS = 2300;
const DOWN_MS = 1700;
/** 격퇴 실패 (보스에게 소멸) — virus.css 의 vf-* (2s) · boss-fail 효과음 1.95초 */
const FAIL_MS = 2000;
const BGM_SRC = "/virus/bgm-theme.mp3";
/** 익스플로잇(치명타) 색 — 날아가는 코드 · 피해 숫자 */
const CRIT_COLOR = "#fbbf24";
/** 피해 숫자 테두리 (어두운 테두리 + 은은한 빛) */
const outline = (glow: string) =>
  `0 0 2px #020604, 0 0 2px #020604, 1px 1px 0 #020604, -1px -1px 0 #020604, 1px -1px 0 #020604, -1px 1px 0 #020604, 0 0 12px ${glow}`;
const ACCENT = "#4ade80";
const KR = "font-['Nanum_Gothic',sans-serif]";
/** 프로파일러 추천 배지 (버튼 위에 걸침) */
function AdviceBadge() {
  return (
    <span className="pointer-events-none absolute -top-2 -right-1 z-10 rounded-full border border-emerald-200/80 bg-[#06120b] px-1.5 font-mono vt-xs leading-4 font-bold whitespace-nowrap text-emerald-200 shadow-[0_0_8px_rgba(74,222,128,0.5)]">
      ★ 추천
    </span>
  );
}

/** 초당 피해 상승 % (작으면 소수점 더) */
function pct(n: number) {
  return `${n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(1) : n.toFixed(2)}%`;
}

/** 받침이 있으면 "이", 없으면 "가" (오버클럭이 · 페이로드가) */
function subj(word: string) {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 ? "이" : "가";
}

/** 업그레이드별 랜덤 강화 단축키 (1~3 업그레이드 바로 아래 줄) */
const RAND_KEYS = ["KeyQ", "KeyW", "KeyE"];
/** 날아가는 코드 조각에 찍히는 글자 */
const GLYPHS = ["01", "</>", "0x", "{}", "#!", "&&", "rm", "fn", ">>", "$_"];

type Scene = "title" | "play";
type Overlay = null | "menu" | "settings" | "archive" | "guide" | "notes";
type Tab = "upgrade" | "module" | "shop" | "format";
/** 업그레이드 한 번에 몇 번 살지 */
type BuyMode = 1 | 10 | "max";

interface Enemy {
  hp: number;
  max: number;
  boss: boolean;
  /** 파일 종류 (FILE_TYPES 번호) */
  file: number;
}

interface Float {
  id: number;
  text: string;
  x: number;
  /** 세로로도 조금씩 흩어지게 (px) — 연달아 뜬 숫자가 겹쳐 읽히지 않게 */
  y: number;
  crit: boolean;
}

/** 날아가는 바이러스 코드 (화면용) */
interface Shot {
  id: number;
  glyph: string;
  crit: boolean;
  /** 위아래로 조금씩 흩어지게 (px) */
  dy: number;
}

/** 아직 닿지 않은 코드 — 닿는 시각에 피해 */
interface Pending {
  id: number;
  landAt: number;
  crit: boolean;
}

/** 격퇴 보상 알림 */
interface Reward {
  name: string;
  module: string;
  effect: string;
  seed: string;
  level: number;
  color: string;
}

/** 화면에 그릴 때 쓰는 복사본 (ref는 렌더 중에 읽지 않음) */
interface View {
  save: Save;
  enemy: Enemy;
  bossLeft: number;
  /** 이번 틱에 맞았는지 (반짝임) */
  hit: boolean;
  /** 이번 틱에 발사했는지 */
  fired: boolean;
  /** 보스 등장 · 격퇴 연출 중이면 그 내용 */
  cinema: Cinema | null;
}

const START_ENEMY: Enemy = { hp: 5, max: 5, boss: false, file: 0 };

function spawn(s: Save): Enemy {
  const st = stats(s);
  const boss = s.kills >= MOBS_PER_STAGE && !s.bossFail;
  const max = boss ? bossHp(s.stage, st) : mobHp(s.stage, st);
  return { hp: max, max, boss, file: Math.floor(Math.random() * FILE_TYPES.length) };
}

/** 터치 폰 · 태블릿이면 게임을 시작할 때 화면을 꽉 채움 */
function wantsAutoFull() {
  return window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 1100;
}

/** 이어 할 만한 진행이 있는지 */
function hasProgress(s: Save) {
  return s.stage > 1 || s.kills > 0 || s.data > 0 || s.formats > 0 || s.best > 1;
}

export default function VirusGame() {
  const frameRef = useRef<HTMLDivElement>(null);
  const save = useRef<Save>(newSave());
  const enemy = useRef<Enemy>(START_ENEMY);
  const bossLeft = useRef(BOSS_TIME);
  const atkAcc = useRef(0);
  const floatId = useRef(0);
  const pending = useRef<Pending[]>([]);
  const [floats, setFloats] = useState<Float[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [view, setView] = useState<View>(() => ({
    save: newSave(),
    enemy: START_ENEMY,
    bossLeft: BOSS_TIME,
    hit: false,
    fired: false,
    cinema: null,
  }));
  /** 지금 연출 (끝나는 시각까지 공격 · 보스 시간이 멈춤) */
  const cinemaRef = useRef<Cinema | null>(null);
  /** 격퇴 연출이 끝나면 띄울 보상 창 */
  const pendingReward = useRef<Reward | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [scene, setScene] = useState<Scene>("title");
  const [entered, setEntered] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [tab, setTab] = useState<Tab>("upgrade");
  const [buyMode, setBuyMode] = useState<BuyMode>(1);
  /** 아래 패널 목록의 페이지 (칸에 다 안 들어가면 나눔 — 스크롤 없음) */
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const onPages = useCallback((n: number) => setPages(n), []);
  const pickTab = (k: Tab) => {
    setTab(k);
    setPage(0);
    setPages(1);
  };
  /** 마지막 틱 시각 — 실제로 흐른 시간만큼 진행 (뒤로 간 탭은 브라우저가 타이머를 늦춤) */
  const lastTick = useRef(0);
  const [settings, setSettings] = useState<VirusSettings>(DEFAULT_SETTINGS);
  const [fs, setFs] = useState(false);
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  /** 이 시각(performance.now)까지 배경음악을 줄임 */
  const duckUntil = useRef(0);
  /** 사용자가 한 번 눌러서 소리를 낼 수 있게 된 뒤인지 (브라우저 자동 재생 막기) */
  const [audioOk, setAudioOk] = useState(false);
  const [away, setAway] = useState<{ data: number; secs: number } | null>(null);
  const [reward, setReward] = useState<Reward | null>(null);
  /** 방금 랜덤 강화 결과 (잠깐 띄움) */
  const [randed, setRanded] = useState<{ id: number; key: UpgKey; n: number } | null>(null);
  /** 방금 진화한 단계 (잠깐 띄움) */
  const [evolved, setEvolved] = useState<{ id: number; stage: number } | null>(null);
  /** 업그레이드 뒤 진화 단계가 올랐으면 알림 */
  const checkEvolve = useCallback((before: number) => {
    const after = evoStage(save.current.lv);
    if (after <= before) return;
    const id = Date.now();
    setEvolved({ id, stage: after });
    setTimeout(() => setEvolved((v) => (v?.id === id ? null : v)), 3200);
  }, []);

  const sync = useCallback((hit = false, fired = false) => {
    setView({
      save: { ...save.current, lv: { ...save.current.lv } },
      enemy: { ...enemy.current },
      bossLeft: bossLeft.current,
      hit,
      fired,
      cinema: cinemaRef.current,
    });
  }, []);

  /** 보스 연출 시작 — 날아가던 코드는 지우고, 끝날 때까지 공격 · 보스 시간 멈춤 */
  const startCinema = useCallback((kind: Cinema["kind"], stage: number) => {
    // 탭이 가려져 있으면 연출 없이 바로 다음으로 (뒤에서 돌 때 시간이 멈추지 않게)
    if (document.visibilityState === "hidden") return;
    const { def, tier } = bossOf(stage);
    const now = performance.now();
    cinemaRef.current = {
      id: Math.floor(now),
      kind,
      seed: def.id,
      color: def.color,
      name: def.name + tierLabel(tier),
      until: now + (kind === "appear" ? APPEAR_MS : kind === "down" ? DOWN_MS : FAIL_MS),
    };
    pending.current = [];
    atkAcc.current = 0;
    setShots([]);
    playVirusSfx(kind === "appear" ? "boss-appear" : kind === "down" ? "boss-down" : "boss-fail");
  }, []);

  const persist = useCallback(() => {
    save.current.savedAt = Date.now();
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save.current));
    } catch {}
  }, []);

  const addFloat = useCallback((text: string, crit: boolean) => {
    const id = ++floatId.current;
    setFloats((f) => [
      ...f.slice(-14),
      { id, text, x: 22 + Math.random() * 56, y: Math.round(Math.random() * 28), crit },
    ]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1000);
  }, []);

  /** 보스 격퇴 소리가 나는 동안 배경음악을 줄이는 함수 (배경음악 코드가 아래에 있어서 ref로 연결) */
  const duckBgm = useRef<() => void>(() => {});

  /** 적에게 피해를 주고, 쓰러뜨리면 보상·다음 적 */
  const damage = useCallback(
    (amount: number) => {
      const s = save.current;
      const e = enemy.current;
      e.hp -= amount;
      if (e.hp > 0) return;
      const st = stats(s);
      if (e.boss) {
        const { def, index, tier } = bossOf(s.stage);
        startCinema("down", s.stage);
        duckBgm.current();
        gainData(s, bossData(s.stage, st));
        s.stage += 1;
        s.kills = 0;
        // 처음 가 보는 스테이지에서 이겼을 때만 모듈 버전이 오름 (포맷 뒤 다시 이기는 건 보상 없음)
        if (s.stage > s.best) {
          s.best = s.stage;
          pendingReward.current = {
            name: def.name + tierLabel(tier),
            module: def.module,
            effect: def.cur
              ? `${def.cur(moduleLevels(s.best)[index])} (${def.effect})`
              : def.effect,
            seed: def.id,
            level: moduleLevels(s.best)[index],
            color: def.color,
          };
        }
        persist();
      } else {
        gainData(s, mobData(s.stage, st));
        s.kills = Math.min(MOBS_PER_STAGE, s.kills + 1);
      }
      enemy.current = spawn(s);
      if (enemy.current.boss) startCinema("appear", s.stage);
      bossLeft.current = BOSS_TIME;
    },
    [persist, startCinema]
  );

  // 저장본 · 설정 불러오기 (자리 비운 동안 수익은 "이어하기"를 누를 때 계산)
  useEffect(() => {
    try {
      save.current = parseSave(localStorage.getItem(SAVE_KEY));
      const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 설정 복원(마운트 1회)
      if (raw) setSettings({ ...DEFAULT_SETTINGS, ...raw });
    } catch {}
    setLoaded(true);
    sync();
  }, [sync]);

  const changeSettings = (next: VirusSettings) => {
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {}
  };

  // ── 배경음악: 테마곡을 반복 재생, 음소거 · 크기는 설정 따라 ──
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  /** 지금 설정대로 틀거나 멈춤 (클릭·키 입력 안에서 부르면 바로 재생됨) */
  const applyBgm = useCallback((on: boolean) => {
    const cur = settingsRef.current;
    let a = bgmRef.current;
    if (!a) {
      a = new Audio(BGM_SRC);
      a.loop = true;
      a.preload = "auto";
      bgmRef.current = a;
    }
    // 보스 격퇴 소리가 나는 동안은 1/3 크기로
    const duck = performance.now() < duckUntil.current ? 0.35 : 1;
    a.volume = Math.min(1, cur.bgm * LEVEL.virus.bgm * duck);
    const play = on && !cur.bgmMute && cur.bgm > 0 && document.visibilityState === "visible";
    if (play) a.play().catch(() => {});
    else a.pause();
  }, []);

  useEffect(() => {
    if (audioOk) applyBgm(true);
  }, [audioOk, settings.bgm, settings.bgmMute, applyBgm]);

  useEffect(() => {
    duckBgm.current = () => {
      duckUntil.current = performance.now() + 1800;
      applyBgm(true);
      setTimeout(() => applyBgm(true), 1850);
    };
  }, [applyBgm]);

  // 효과음 크기
  useEffect(() => {
    setVirusSfxVolume(settings.sfx);
  }, [settings.sfx]);

  // 탭을 가리면 멈추고, 돌아오면 다시 · 페이지를 떠나면 끔
  useEffect(() => {
    const onVis = () => {
      if (audioOk) applyBgm(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [audioOk, applyBgm]);
  useEffect(
    () => () => {
      bgmRef.current?.pause();
      bgmRef.current = null;
    },
    []
  );

  const unlockAudio = useCallback(() => {
    unlockVirusSfx();
    setAudioOk(true);
    applyBgm(true);
  }, [applyBgm]);

  const toggleMute = useCallback(() => {
    const next = { ...settingsRef.current, bgmMute: !settingsRef.current.bgmMute };
    settingsRef.current = next;
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {}
    setAudioOk(true);
    applyBgm(true);
  }, [applyBgm]);

  // M 키: 배경음악 끄기 · 켜기 (시작 화면에서 메뉴가 열린 뒤 · 게임 중)
  useEffect(() => {
    if (!entered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyM" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      toggleMute();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entered, toggleMute]);

  // ── 전체화면: 되는 브라우저는 진짜 전체화면, 안 되면(아이폰 사파리 등) 게임 틀이 화면을 덮음 ──
  const nativeFs = useRef(false);
  const enterFull = useCallback(() => {
    setFs(true);
    const el = frameRef.current;
    if (el?.requestFullscreen && !document.fullscreenElement)
      el.requestFullscreen({ navigationUI: "hide" })
        .then(() => (nativeFs.current = true))
        .catch(() => {});
  }, []);
  const exitFull = useCallback(() => {
    setFs(false);
    nativeFs.current = false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);
  const toggleFs = useCallback(() => (fs ? exitFull() : enterFull()), [fs, enterFull, exitFull]);
  // 브라우저에서 나간 경우 (Esc · 뒤로 가기 몸짓)
  useEffect(() => {
    const on = () => {
      if (!document.fullscreenElement && nativeFs.current) {
        nativeFs.current = false;
        setFs(false);
      }
    };
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  // 전체화면 동안: 뒤 페이지 스크롤 잠금 · 사이트 떠 있는 메뉴 버튼 숨김
  useEffect(() => {
    if (!fs) return;
    const unlock = lockScroll();
    document.body.classList.add("game-full");
    return () => {
      unlock();
      document.body.classList.remove("game-full");
    };
  }, [fs]);

  // ── 장면 바꾸기 ──

  const startPlay = useCallback(
    (fresh: boolean) => {
      if (wantsAutoFull()) enterFull();
      if (fresh) {
        save.current = newSave();
      } else {
        const s = save.current;
        const gain = offlineGain(s, (Date.now() - s.savedAt) / 1000);
        if (gain.data > 0) {
          gainData(s, gain.data);
          setAway(gain);
        }
      }
      pending.current = [];
      atkAcc.current = 0;
      setShots([]);
      setFloats([]);
      cinemaRef.current = null;
      pendingReward.current = null;
      enemy.current = spawn(save.current);
      if (enemy.current.boss) startCinema("appear", save.current.stage);
      bossLeft.current = BOSS_TIME;
      persist();
      setOverlay(null);
      setTab("upgrade");
      setScene("play");
      sync();
    },
    [persist, sync, startCinema, enterFull]
  );

  const toTitle = () => {
    cinemaRef.current = null;
    pendingReward.current = null;
    persist();
    setOverlay(null);
    setReward(null);
    setScene("title");
    sync();
  };

  const newGame = () => {
    if (
      hasProgress(save.current) &&
      !confirm("새 게임을 시작할까요? 지금까지의 진행(루트 권한·모듈 포함)이 모두 지워집니다.")
    )
      return;
    startPlay(true);
  };

  const wipe = () => {
    if (!confirm("저장 데이터를 모두 지울까요? 되돌릴 수 없어요.")) return;
    save.current = newSave();
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {}
    setOverlay(null);
    setScene("title");
    sync();
  };

  // ── 자동 공격 · 보스 시간 (게임 화면에서만) ──
  useEffect(() => {
    if (scene !== "play") return;
    lastTick.current = performance.now();
    /** 보스 시간 초과 — 보스에게 소멸당하는 연출 뒤, 파일을 감염시키며 더 강해진 뒤 재도전 */
    const failBoss = (s: Save) => {
      startCinema("fail", s.stage);
      if (cinemaRef.current) duckBgm.current();
      s.bossFail = true;
      enemy.current = spawn(s);
      bossLeft.current = BOSS_TIME;
    };
    /** 자동 최적 업그레이드 (크론 데몬) — 1초마다 */
    let lastAuto = 0;
    const runAuto = (s: Save, force = false) => {
      if (!s.auto || !s.shop.daemon) return;
      const now = performance.now();
      if (!force && now - lastAuto < 1000) return;
      lastAuto = now;
      const before = evoStage(s.lv);
      if (applyPlan(s, optimalPlan(s, 400))) checkEvolve(before);
    };
    /**
     * 화면 없이 빨리 돌리기 — 틱 사이가 길게 벌어졌을 때 (탭을 뒤로 보내면 브라우저가 타이머를 1초~1분에 한 번으로 늦춤).
     * 0.1초씩 끊어서 공격 · 보스 시간을 그대로 계산 (코드는 날리지 않고 바로 맞음)
     */
    const fastForward = (secs: number) => {
      const step = 0.1;
      for (let t = 0; t < secs && !cinemaRef.current; t += step) {
        const s = save.current;
        const st = stats(s);
        atkAcc.current += st.aps * step;
        for (let k = 0; atkAcc.current >= 1 && k < 200 && !cinemaRef.current; k++) {
          atkAcc.current -= 1;
          const crit = Math.random() < st.critChance;
          damage(st.dmg * (crit ? st.critMul : 1) * (enemy.current.boss ? st.bossDmgMul : 1));
        }
        if (enemy.current.boss && !cinemaRef.current) {
          bossLeft.current -= step;
          if (bossLeft.current <= 0) failBoss(s);
        }
        if (Math.round(t * 10) % 10 === 0) runAuto(s, true);
      }
    };
    const id = setInterval(() => {
      const s = save.current;
      const dt = TICK_MS / 1000;
      const now = performance.now();
      // 실제로 흐른 시간 (최대 1시간 — 그보다 길면 오프라인 수익으로)
      const real = Math.min(3600, (now - lastTick.current) / 1000);
      lastTick.current = now;
      // 보스 연출 중엔 멈춤, 끝나면 (격퇴였으면) 보상 창
      const c = cinemaRef.current;
      if (c) {
        if (now < c.until) {
          sync();
          return;
        }
        cinemaRef.current = null;
        if (pendingReward.current) {
          setReward(pendingReward.current);
          pendingReward.current = null;
        }
      }
      // 틱이 늦게 왔으면 밀린 시간을 먼저 계산
      if (real - dt > 0.15) fastForward(real - dt);
      runAuto(s);
      const st = stats(s);
      // 발사: 공격 속도만큼 코드를 쏘고, SHOT_MS 뒤에 닿음
      atkAcc.current += st.aps * dt;
      const launched: Shot[] = [];
      while (atkAcc.current >= 1 && launched.length < 20) {
        atkAcc.current -= 1;
        const id = ++floatId.current;
        const crit = Math.random() < st.critChance;
        pending.current.push({ id, landAt: now + SHOT_MS, crit });
        launched.push({
          id,
          glyph: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
          crit,
          dy: Math.round((Math.random() - 0.5) * 24),
        });
      }
      if (launched.length) setShots((sh) => [...sh.slice(-24), ...launched]);
      // 닿은 코드: 그때의 적에게 피해
      const landed = pending.current.filter((p) => p.landAt <= now);
      if (landed.length) {
        pending.current = pending.current.filter((p) => p.landAt > now);
        const ids = new Set(landed.map((p) => p.id));
        setShots((sh) => sh.filter((x) => !ids.has(x.id)));
        // 소리는 틱마다 하나 — 익스플로잇이 섞였으면 익스플로잇 소리
        playVirusSfx(landed.some((p) => p.crit) ? "exploit" : "hit");
        landed.forEach((p, i) => {
          // 이 틱에 보스가 나타나거나 쓰러졌으면 나머지는 버림 (연출 시작)
          if (cinemaRef.current) return;
          const dmg = st.dmg * (p.crit ? st.critMul : 1) * (enemy.current.boss ? st.bossDmgMul : 1);
          if (i < 3) addFloat(fmt(dmg), p.crit);
          damage(dmg);
        });
      }
      if (enemy.current.boss) {
        bossLeft.current -= dt;
        if (bossLeft.current <= 0) failBoss(s);
      }
      // 연출 없이 격퇴했으면 (탭이 가려져 있던 중) 보상 창은 바로
      if (!cinemaRef.current && pendingReward.current) {
        setReward(pendingReward.current);
        pendingReward.current = null;
      }
      sync(landed.length > 0, launched.length > 0);
    }, TICK_MS);
    const saveId = setInterval(persist, 5000);
    const onHide = () => document.visibilityState === "hidden" && persist();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", persist);
    return () => {
      clearInterval(id);
      clearInterval(saveId);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", persist);
      persist();
    };
  }, [scene, damage, addFloat, persist, sync, startCinema, checkEvolve]);

  /** 업그레이드 사기 — ×1 · ×10 · 최대 (×10 은 10번 다 살 수 있을 때만) */
  const buy = useCallback(
    (u: UpgDef) => {
      const s = save.current;
      const n = buyMode === "max" ? Infinity : buyMode;
      const { cost, count } = bulkCost(s, u, n);
      if (!count || s.data < cost) return;
      const before = evoStage(s.lv);
      s.data -= cost;
      s.lv[u.key] += count;
      checkEvolve(before);
      sync();
    },
    [sync, checkEvolve, buyMode]
  );

  /** 루트 권한 상점에서 사기 */
  const buyRoot = (key: (typeof SHOP)[number]["key"]) => {
    const s = save.current;
    const before = evoStage(s.lv);
    if (!buyShop(s, key)) return;
    checkEvolve(before);
    persist();
    sync();
  };

  /** 크론잡: 가진 데이터를 다 써서 최적 조합으로 업그레이드 */
  const runCron = useCallback(() => {
    const s = save.current;
    if (!s.shop.cron) return;
    const before = evoStage(s.lv);
    if (!applyPlan(s, optimalPlan(s))) return;
    checkEvolve(before);
    sync();
  }, [sync, checkEvolve]);

  const toggleAuto = () => {
    const s = save.current;
    if (!s.shop.daemon) return;
    s.auto = !s.auto;
    persist();
    sync();
  };

  /** 랜덤 강화: 값을 치르고 그 업그레이드가 1~3레벨 무작위로 오름 */
  const doRand = useCallback(
    (key: UpgKey) => {
      const before = evoStage(save.current.lv);
      const n = randUpgrade(save.current, key);
      if (!n) return;
      const id = Date.now();
      setRanded({ id, key, n });
      setTimeout(() => setRanded((f) => (f?.id === id ? null : f)), 2600);
      checkEvolve(before);
      sync();
    },
    [sync, checkEvolve]
  );

  const retryBoss = () => {
    const s = save.current;
    s.bossFail = false;
    enemy.current = spawn(s);
    if (enemy.current.boss) startCinema("appear", s.stage);
    bossLeft.current = BOSS_TIME;
    sync();
  };

  const doFormat = () => {
    const s = save.current;
    if (!canFormat(s)) return;
    const gain = pendingRoot(s);
    if (
      !confirm(
        `시스템을 포맷할까요?\n\n스테이지·업그레이드·데이터는 처음으로 돌아가고,\n루트 권한 +${gain}을 받아요 (빼앗은 모듈은 그대로).`
      )
    )
      return;
    save.current = format(s);
    pending.current = [];
    enemy.current = spawn(save.current);
    bossLeft.current = BOSS_TIME;
    persist();
    sync();
  };

  // 게임 화면 단축키: Esc 메뉴 · 1~3 업그레이드 · Q W E 랜덤 강화 · C 최적 업그레이드(크론잡)
  useEffect(() => {
    if (scene !== "play") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat && e.code === "Escape") return;
      if (e.code === "Escape") {
        e.preventDefault();
        if (reward) setReward(null);
        else if (away) setAway(null);
        else setOverlay((o) => (o ? null : "menu"));
        return;
      }
      if (overlay || reward || away) return;
      const n = Number(e.key);
      if (n >= 1 && n <= UPGRADES.length) buy(UPGRADES[n - 1]);
      if (e.code === "KeyC") runCron();
      const f = RAND_KEYS.indexOf(e.code);
      if (f >= 0 && f < UPGRADES.length) doRand(UPGRADES[f].key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scene, overlay, reward, away, buy, doRand, runCron]);

  // 시작 화면의 창은 Esc로 닫기
  useEffect(() => {
    if (scene !== "title" || !overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      e.preventDefault();
      setOverlay(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scene, overlay]);

  const { save: s, enemy: e, bossLeft: left, hit, fired, cinema } = view;
  const dying = cinema?.kind === "down" ? cinema : null;
  /** 격퇴 실패 연출 중이면: 보스는 그대로 보이고 내 바이러스가 소멸 */
  const failing = cinema?.kind === "fail" ? cinema : null;
  const st = stats(s);
  const mods = moduleLevels(s.best);
  const owned = mods.filter((m) => m > 0).length;
  // 내 바이러스와 날아가는 코드의 색: 마지막으로 빼앗은 모듈의 색
  const last = s.best > 1 ? bossOf(s.best - 1).def : null;
  const myColor = last?.color ?? ACCENT;
  const boss = bossOf(s.stage);
  const file = FILE_TYPES[e.file];
  const stage = evoStage(s.lv);
  /** 내 바이러스 몸 둘레에 붙는 모듈 조각 (빼앗은 보스의 색) */
  const modColors = ROSTER.map((v, i) => (mods[i] ? v.color : null));
  /** 지금 적에게 들어가는 예상 초당 피해 */
  const curDps = dps(st) * (e.boss ? st.bossDmgMul : 1);
  /** 프로파일러가 있으면: 데이터 대비 초당 피해가 가장 많이 오르는 업그레이드 · 랜덤 강화 */
  const advice = s.shop.profiler ? upgradeAdvice(s, buyMode === "max" ? Infinity : buyMode) : null;
  const gainOf = (id: string) => advice?.list.find((a) => a.id === id)?.gain ?? 0;
  /** 크론잡이 있으면: 지금 데이터로 할 수 있는 최적 업그레이드 미리 보기 (화면용 — 누를 때 다시 계산) */
  const cronPlan = s.shop.cron && tab === "upgrade" ? optimalPlan(s, 300) : null;
  /** 커널 프로파일러가 있으면: 루트 상점의 루트킷 · 데이터 마이닝 · 폴리모픽 엔진 추천 */
  const rAdvice = s.shop.kprof && tab === "shop" ? rootAdvice(s) : null;
  const rootGain = pendingRoot(s);
  const formatReady = canFormat(s);
  const hitNow = hit && settings.effects;
  const progress = hasProgress(s);

  const titleItems = useMemo<TitleItem[]>(
    () => [
      {
        key: "continue",
        label: "이어하기",
        en: "CONTINUE",
        sub: progress ? `스테이지 ${s.stage} · 루트 권한 ${fmt(s.root)}` : "저장된 진행 없음",
        disabled: !progress,
        run: () => startPlay(false),
      },
      { key: "new", label: "새 게임", en: "NEW GAME", run: newGame },
      {
        key: "archive",
        label: "바이러스 도감",
        en: "ARCHIVE",
        sub: `${owned}/${ROSTER.length}`,
        run: () => setOverlay("archive"),
      },
      { key: "guide", label: "게임 방법", en: "HOW TO PLAY", run: () => setOverlay("guide") },
      {
        key: "notes",
        label: "패치노트",
        en: "PATCH NOTES",
        sub: PATCH_NOTES[0].ver,
        run: () => setOverlay("notes"),
      },
      { key: "settings", label: "설정", en: "SETTINGS", run: () => setOverlay("settings") },
      {
        key: "fs",
        label: fs ? "창 모드" : "전체화면",
        en: fs ? "WINDOW" : "FULLSCREEN",
        run: toggleFs,
      },
    ],
    // newGame은 매 렌더 새로 만들어지지만 save.current만 읽어서 결과가 같음
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [progress, s.stage, s.root, owned, fs, startPlay, toggleFs]
  );

  const muted = settings.bgmMute || settings.bgm === 0;
  /** 오른쪽 위 배경음악 끄기 · 켜기 (시작 화면 · 게임 화면 공통) */
  const muteButton = (
    <button
      type="button"
      onPointerDown={(ev) => ev.stopPropagation()}
      onClick={toggleMute}
      title={muted ? "배경음악 켜기 (M)" : "배경음악 끄기 (M)"}
      aria-label={muted ? "배경음악 켜기" : "배경음악 끄기"}
      aria-pressed={muted}
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg border bg-black/50 px-2 font-mono vt-sm transition-colors hover:border-emerald-300/60 ${
        muted ? "border-white/15 text-white/70" : "border-emerald-300/40 text-emerald-200"
      }`}
    >
      <SpeakerIcon muted={muted} className="h-4 w-4" />
      <span className="hidden rounded border border-white/20 px-1 leading-tight md:inline">M</span>
    </button>
  );

  /** 전체화면 켜기 · 끄기 (음소거 버튼 옆) */
  const fsButton = (
    <button
      type="button"
      onPointerDown={(ev) => ev.stopPropagation()}
      onClick={toggleFs}
      title={fs ? "창 모드" : "전체화면"}
      aria-label={fs ? "창 모드로" : "전체화면으로"}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-black/50 text-white/70 transition-colors hover:border-emerald-300/60 hover:text-white"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        aria-hidden
      >
        {fs ? (
          <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
        ) : (
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        )}
      </svg>
    </button>
  );

  const tabs: { key: Tab; label: string; short?: string; badge?: string }[] = [
    { key: "upgrade", label: "업그레이드", short: "강화" },
    { key: "module", label: "코드 모듈", short: "모듈", badge: `${owned}/${ROSTER.length}` },
    {
      key: "shop",
      label: "루트 상점",
      short: "상점",
      badge: rootLeft(s) > 0 ? `🔑${fmt(rootLeft(s))}` : undefined,
    },
    {
      key: "format",
      label: "시스템 포맷",
      short: "포맷",
      badge: formatReady ? `+${fmt(rootGain)}` : undefined,
    },
  ];

  return (
    <section className="mx-auto w-full max-w-[960px] px-4 pb-16 text-left">
      <GameHeader
        icon="👾"
        title="바이러스 키우기"
        en="VIRUS IDLE"
        desc="파일을 감염시켜 데이터를 훔치고, 네트워크를 장악한 악명 높은 바이러스를 격퇴해 코드를 빼앗기"
        accent={ACCENT}
        guide={VIRUS_GUIDE}
      />

      <div
        ref={frameRef}
        data-virus-frame
        className={`vg-frame relative flex w-full flex-col overflow-hidden bg-[#050806] ${
          fs
            ? "vg-safe fixed inset-0 z-[100] h-[100dvh]"
            : "h-[min(720px,calc(100svh-110px))] min-h-[540px] rounded-3xl border border-emerald-400/20 md:aspect-[16/10] md:h-auto md:min-h-0"
        } ${settings.effects ? "" : "virus-calm"} ${settings.big ? "vg-big" : ""}`}
      >
        {scene === "title" && (
          <div className="absolute top-3 right-3 z-30 flex gap-1.5">
            {fsButton}
            {muteButton}
          </div>
        )}
        {scene === "title" ? (
          <TitleScreen
            entered={entered && loaded}
            onEnter={() => {
              if (!loaded) return;
              setEntered(true);
              unlockAudio();
              if (wantsAutoFull()) enterFull();
            }}
            items={titleItems}
            blocked={overlay !== null}
          />
        ) : (
          <div className="vg-play flex min-h-0 flex-1 flex-col">
            {/* ── 위 막대: 메뉴 · 위치 · 진행 · 재화 ── */}
            <div className="vg-top flex items-center gap-2 border-b border-emerald-400/15 bg-[#070b09] px-3 py-2 @md/vg:gap-3 @md/vg:px-4">
              <button
                type="button"
                onClick={() => setOverlay("menu")}
                aria-label="메뉴 (Esc)"
                title="메뉴 (Esc)"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/15 font-mono text-white/70 hover:border-emerald-300/60 hover:text-white"
              >
                ≡
              </button>
              <div className={`min-w-0 truncate vt-sm text-white/70 @xl/vg:text-sm ${KR}`}>
                <span className="font-mono text-emerald-400/90">&gt; </span>
                <b className="text-white">{zoneOf(s.stage)}</b>
                <span className="ml-1">· 스테이지 {s.stage}</span>
              </div>
              <div className="hidden flex-1 items-center gap-1 @3xl/vg:flex">
                {Array.from({ length: MOBS_PER_STAGE }, (_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full ${i < s.kills ? "bg-emerald-400" : "bg-white/10"}`}
                  />
                ))}
                <span className="ml-1 vt-base">☠️</span>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2 font-mono vt-sm font-bold @md/vg:gap-3 @md/vg:text-sm @3xl/vg:ml-0">
                <span className="text-emerald-300">💾 {fmtBytes(s.data)}</span>
                <span className="hidden text-amber-200 @xl/vg:inline" title="루트 권한">
                  🔑 {fmt(s.root)}
                </span>
                {fsButton}
                {muteButton}
              </div>
            </div>
            {/* 좁은 화면: 진행 막대를 따로 한 줄 */}
            <div className="vg-prog flex items-center gap-1 px-3 pt-2 @3xl/vg:hidden">
              {Array.from({ length: MOBS_PER_STAGE }, (_, i) => (
                <div
                  key={i}
                  className={`h-1.5 flex-1 rounded-full ${i < s.kills ? "bg-emerald-400" : "bg-white/10"}`}
                />
              ))}
              <span className="ml-1 vt-base">☠️</span>
            </div>

            {/* ── 전투 ── */}
            <div className="vg-battle virus-screen relative min-h-0 flex-1">
              {/* 왼쪽 위: 지금 적에게 들어가는 예상 초당 피해 */}
              <div
                className={`pointer-events-none absolute top-2 left-3 z-10 rounded-lg border border-emerald-400/20 bg-black/55 px-2.5 py-1 ${KR}`}
                title="공격력 × 초당 발사 × 익스플로잇 평균 (보스면 보스 피해 배율까지)"
              >
                <div className="vt-xs text-emerald-300/90">예상 DPS</div>
                <div className="font-mono text-base leading-tight font-bold text-emerald-200 tabular-nums">
                  {fmt(curDps)}
                  {e.boss && st.bossDmgMul > 1 && (
                    <span className="ml-1 vt-xs font-normal text-amber-200/80">
                      보스 ×{fmt(st.bossDmgMul)}
                    </span>
                  )}
                </div>
              </div>
              {cinema && <BossCinema c={cinema} />}
              <div
                key={cinema?.id ?? 0}
                className={`absolute inset-0 grid grid-cols-2 items-center select-none ${
                  cinema
                    ? cinema.kind === "appear"
                      ? "vb-shake"
                      : cinema.kind === "down"
                        ? "vd-shake"
                        : "vf-shake"
                    : ""
                }`}
              >
                <div className="flex flex-col items-center gap-2">
                  <div className="relative">
                    <div className={`vg-sprite vg-me ${failing ? "vf-me" : ""}`}>
                      <MyVirusSprite
                        color={myColor}
                        lv={s.lv}
                        stage={stage}
                        mods={modColors}
                        aps={st.aps}
                        firing={fired}
                      />
                    </div>
                    {failing && <BossShards c={failing} color={myColor} className="vf-frag" />}
                  </div>
                  <span className={`text-center vt-sm text-white/75 ${KR}`}>
                    <b className="font-mono" style={{ color: myColor }}>
                      me.exe
                    </b>{" "}
                    · {EVOLUTION[stage].name}
                    <span className="hidden @md/vg:inline">
                      {" "}
                      · 모듈 {owned}/{ROSTER.length}
                    </span>
                  </span>
                </div>

                {/* 날아가는 바이러스 코드 */}
                <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
                  {shots.map((sh) => (
                    <span
                      key={sh.id}
                      className={`virus-shot absolute font-mono font-bold whitespace-nowrap ${
                        sh.crit ? "vt-base" : "vt-sm"
                      }`}
                      style={{
                        top: `calc(42% + ${sh.dy}px)`,
                        color: sh.crit ? CRIT_COLOR : myColor,
                        textShadow: `0 0 8px ${sh.crit ? CRIT_COLOR : myColor}`,
                        animationDuration: `${SHOT_MS}ms`,
                      }}
                    >
                      {sh.glyph}
                    </span>
                  ))}
                </div>

                <div className="relative flex flex-col items-center gap-2">
                  <div
                    key={`${s.stage}-${s.kills}-${e.boss}`}
                    className={`relative ${
                      dying
                        ? ""
                        : failing
                          ? "vf-boss"
                          : cinema?.kind === "appear" && e.boss
                            ? "vb-slam"
                            : "virus-pop"
                    }`}
                  >
                    {dying ? (
                      <>
                        <div className="vd-boss vg-sprite vg-boss">
                          <VirusSprite seed={dying.seed} color={dying.color} size={140} />
                        </div>
                        <BossShards c={dying} />
                      </>
                    ) : failing ? (
                      <div className="vg-sprite vg-boss">
                        <VirusSprite seed={failing.seed} color={failing.color} size={140} />
                      </div>
                    ) : e.boss ? (
                      <div className="vg-sprite vg-boss">
                        <VirusSprite
                          seed={boss.def.id}
                          color={boss.def.color}
                          size={140}
                          hit={hitNow}
                        />
                      </div>
                    ) : (
                      <div className="vg-sprite vg-file">
                        <FileSprite
                          ext={file.ext}
                          color={file.color}
                          hit={hitNow}
                          infected={1 - e.hp / e.max}
                        />
                      </div>
                    )}
                  </div>
                  <span className={`vt-sm text-white/80 ${KR}`}>
                    {dying ? (
                      <b style={{ color: dying.color }} className="line-through opacity-60">
                        ☠️ {dying.name}
                      </b>
                    ) : failing ? (
                      <b style={{ color: failing.color }}>☠️ {failing.name}</b>
                    ) : e.boss ? (
                      <b style={{ color: boss.def.color }}>
                        ☠️ {boss.def.name + tierLabel(boss.tier)}{" "}
                        <span className="font-mono vt-xs font-normal text-white/70">
                          ({boss.def.year})
                        </span>
                      </b>
                    ) : (
                      <span className="font-mono">
                        {file.name}.{file.ext}
                      </span>
                    )}
                  </span>
                  <div
                    className="h-2 w-[70%] overflow-hidden rounded-full bg-white/10"
                    title="보안 등급"
                  >
                    <div
                      className="h-full rounded-full bg-sky-400 transition-[width] duration-100"
                      style={{ width: `${dying ? 0 : Math.max(0, (e.hp / e.max) * 100)}%` }}
                    />
                  </div>
                  <span className="font-mono vt-sm text-white/75">
                    🛡 {dying ? "0" : `${fmt(Math.max(0, e.hp))} / ${fmt(e.max)}`}
                  </span>
                  {settings.numbers &&
                    floats.map((f) => (
                      <span
                        key={f.id}
                        className={`absolute z-10 font-mono font-black tabular-nums ${
                          f.crit ? "virus-float-crit text-3xl" : "virus-float text-xl"
                        }`}
                        style={{
                          left: `${f.x}%`,
                          top: `${8 + f.y}px`,
                          color: f.crit ? CRIT_COLOR : "#bbf7d0",
                          textShadow: outline(f.crit ? "#f59e0b" : "#22c55e"),
                        }}
                      >
                        {f.text}
                      </span>
                    ))}
                </div>
              </div>

              {/* 진화 알림 */}
              {evolved && (
                <div
                  key={evolved.id}
                  className={`virus-pop absolute top-12 left-1/2 z-10 -translate-x-1/2 rounded-full border border-emerald-300/60 bg-emerald-950/90 px-4 py-1.5 vt-sm whitespace-nowrap text-emerald-100 shadow-[0_0_24px_rgba(74,222,128,0.45)] ${KR}`}
                >
                  🧬 진화! {evolved.stage + 1}단계 <b>{EVOLUTION[evolved.stage].name}</b>{" "}
                  <span className="font-mono vt-xs text-emerald-300/90">
                    {EVOLUTION[evolved.stage].en}
                  </span>
                </div>
              )}

              {/* 랜덤 강화 결과 */}
              {randed && (
                <div
                  key={randed.id}
                  className={`virus-pop absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-violet-300/50 bg-violet-950/85 px-4 py-1.5 vt-sm whitespace-nowrap text-violet-100 shadow-[0_0_20px_rgba(167,139,250,0.35)] ${KR}`}
                >
                  🎲 {UPGRADES.find((u) => u.key === randed.key)?.rand} · +{randed.n}레벨
                  {randed.n === RAND_ODDS.length && " 잭팟!"}
                </div>
              )}

              {/* 보스 시간 / 재도전 / 안내 */}
              <div className="absolute inset-x-3 bottom-2 sm:inset-x-4">
                {e.boss ? (
                  <div className="flex items-center gap-2">
                    <span className="w-12 font-mono vt-sm text-rose-300">{left.toFixed(1)}s</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-rose-400"
                        style={{ width: `${(left / BOSS_TIME) * 100}%` }}
                      />
                    </div>
                  </div>
                ) : s.bossFail ? (
                  <div
                    className={`flex items-center justify-between gap-2 vt-sm text-white/75 ${KR}`}
                  >
                    <span>보스에게 차단당했어요. 더 강해진 뒤 다시 침투하세요.</span>
                    <button
                      type="button"
                      onClick={retryBoss}
                      className="shrink-0 rounded-full bg-rose-400 px-4 py-1.5 font-bold text-black hover:bg-rose-300"
                    >
                      ☠️ 보스 재도전
                    </button>
                  </div>
                ) : (
                  <p className={`text-center vt-sm text-white/70 ${KR}`}>
                    파일 {MOBS_PER_STAGE}개를 감염시키면 이 네트워크의 보스 등장
                    <span className="hidden md:inline">
                      {" "}
                      · Esc 메뉴 · 1~3 업그레이드 · Q W E 랜덤 강화
                    </span>
                  </p>
                )}
              </div>
            </div>

            {/* ── 아래 패널: 탭 ── */}
            <div className="vg-panel @container/panel flex shrink-0 flex-col bg-[#070b09]">
              <div
                data-fit="tabs"
                className="flex items-end gap-1 overflow-hidden px-3 pt-2 @lg/panel:px-4"
              >
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => pickTab(t.key)}
                    className={`shrink-0 rounded-t-lg border-x border-t px-2 py-1.5 vt-sm font-bold whitespace-nowrap transition-colors @lg/panel:px-3 ${KR} ${
                      tab === t.key
                        ? "border-emerald-400/30 bg-emerald-400/10 text-white"
                        : "border-transparent text-white/70 hover:text-white/80"
                    }`}
                  >
                    <span className="@lg/panel:hidden">{t.short ?? t.label}</span>
                    <span className="hidden @lg/panel:inline">{t.label}</span>
                    {t.badge && (
                      <span
                        className={`ml-1.5 font-mono vt-xs ${t.key === "module" || t.key === "shop" ? "hidden @lg/panel:inline" : ""} ${
                          t.key === "format" ? "text-amber-200" : "text-white/70"
                        }`}
                      >
                        {t.badge}
                      </span>
                    )}
                  </button>
                ))}
                <div className="ml-auto flex shrink-0 items-center gap-1.5 pb-1">
                  {tab === "upgrade" && (
                    <>
                      {/* 넓으면 ×1 · ×10 · MAX 버튼, 좁으면 누를 때마다 바뀌는 버튼 하나 */}
                      <div className="hidden overflow-hidden rounded-lg border border-white/20 @lg/panel:flex">
                        {([1, 10, "max"] as BuyMode[]).map((m) => (
                          <button
                            key={String(m)}
                            type="button"
                            onClick={() => setBuyMode(m)}
                            aria-pressed={buyMode === m}
                            className={`vt-sm px-2.5 py-1 font-mono font-bold transition-colors ${
                              buyMode === m
                                ? "bg-emerald-400/25 text-emerald-100"
                                : "text-white/75 hover:text-white"
                            }`}
                          >
                            {m === "max" ? "MAX" : `×${m}`}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setBuyMode((m) => (m === 1 ? 10 : m === 10 ? "max" : 1))}
                        aria-label="한 번에 살 개수 바꾸기"
                        className="vt-sm rounded-lg border border-emerald-300/50 bg-emerald-400/15 px-2 py-1 font-mono font-bold text-emerald-100 @lg/panel:hidden"
                      >
                        {buyMode === "max" ? "MAX" : `×${buyMode}`}
                      </button>
                      {s.shop.cron > 0 && (
                        <button
                          type="button"
                          onClick={runCron}
                          disabled={!cronPlan?.count}
                          title={
                            cronPlan?.count
                              ? `크론잡: 데이터를 다 써서 ${UPGRADES.filter(
                                  (u) => cronPlan.add[u.key]
                                )
                                  .map((u) => `${u.name} +${cronPlan.add[u.key]}`)
                                  .join(" · ")} → DPS ×${cronPlan.mul.toFixed(2)} (C 키)`
                              : "크론잡: 살 수 있는 업그레이드가 없어요"
                          }
                          className={`vt-sm rounded-lg border border-amber-300/70 bg-amber-300/20 px-2 py-1 font-bold whitespace-nowrap text-amber-100 transition-colors enabled:hover:bg-amber-300/30 ${KR}`}
                        >
                          ⚡<span className="hidden @lg/panel:inline"> 최적</span>
                          <span className="hidden @md/panel:inline">
                            {cronPlan?.count ? ` +${pct((cronPlan.mul - 1) * 100)}` : ""}
                          </span>
                        </button>
                      )}
                      {s.shop.daemon > 0 && (
                        <button
                          type="button"
                          onClick={toggleAuto}
                          aria-pressed={s.auto}
                          title="자동 최적 업그레이드 (크론 데몬)"
                          className={`vt-sm rounded-lg border px-2 py-1 font-bold whitespace-nowrap transition-colors ${KR} ${
                            s.auto
                              ? "border-sky-300/70 bg-sky-400/20 text-sky-100"
                              : "border-white/20 text-white/75 hover:text-white"
                          }`}
                        >
                          ⏱<span className="hidden @lg/panel:inline"> 자동</span>{" "}
                          {s.auto ? "ON" : "OFF"}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div
                data-fit="panel"
                className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-emerald-400/15 p-2.5 @lg/panel:p-3 @lg/panel:px-4"
              >
                {tab === "upgrade" && (
                  <FitPages
                    page={page}
                    onPages={onPages}
                    className="grid gap-2 @2xl/panel:grid-cols-3 @2xl/panel:gap-3"
                    items={UPGRADES.map((u, i) => {
                      const lv = s.lv[u.key];
                      const bulk = bulkCost(s, u, buyMode === "max" ? Infinity : buyMode);
                      // ×1 · ×10 은 그만큼의 값 · 최대는 살 수 있는 만큼 (하나도 못 사면 다음 1레벨 값)
                      const cost = bulk.count ? bulk.cost : upgCost(u, lv, st);
                      const many = buyMode === "max" ? bulk.count : buyMode;
                      const price = randPrice(s, u.key);
                      const upTop = advice?.best === u.key;
                      const randTop = advice?.best === `rand:${u.key}`;
                      return (
                        <div key={u.key}>
                          {/* 좁은 패널(폰): 한 줄에 [정보] [▲ 업그레이드] [🎲 랜덤 강화] */}
                          <div
                            className={`flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] py-1.5 pr-1.5 pl-2.5 @2xl/panel:hidden ${KR}`}
                          >
                            <span className="text-lg" aria-hidden>
                              {u.icon}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate vt-md font-bold text-white">
                                {u.name}{" "}
                                <span className="font-mono vt-sm text-white/75">Lv.{lv}</span>
                              </span>
                              <span className="block truncate vt-xs text-white/75">
                                {u.label(st, lv)}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => buy(u)}
                              disabled={s.data < cost}
                              aria-label={`${u.name} 업그레이드 ${fmtBytes(cost)}`}
                              className={`relative flex h-10 min-w-[74px] shrink-0 flex-col items-center justify-center rounded-lg border px-2 transition-colors enabled:active:bg-emerald-400/25 ${
                                upTop
                                  ? "border-emerald-200 bg-emerald-400/25 shadow-[0_0_14px_rgba(74,222,128,0.6)]"
                                  : "border-emerald-400/40 bg-emerald-400/10"
                              }`}
                            >
                              {upTop && <AdviceBadge />}
                              <span className="vt-xs leading-none text-emerald-200/90">
                                ▲ 업그레이드
                              </span>
                              <span className="mt-0.5 font-mono vt-sm font-bold text-emerald-300">
                                {fmtBytes(cost)}
                              </span>
                              {(many > 1 || advice) && (
                                <span className="vt-xs leading-none text-emerald-200/90">
                                  {many > 1 && `×${many}`}
                                  {advice && ` DPS+${pct(gainOf(u.key))}`}
                                </span>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => doRand(u.key)}
                              disabled={s.data < price}
                              aria-label={`${u.rand} ${fmtBytes(price)}`}
                              className={`relative flex h-10 min-w-[74px] shrink-0 flex-col items-center justify-center rounded-lg border px-2 transition-colors enabled:active:bg-violet-400/25 ${
                                randTop
                                  ? "border-violet-100 bg-violet-400/30 shadow-[0_0_14px_rgba(167,139,250,0.65)]"
                                  : "border-violet-300/40 bg-violet-400/10"
                              }`}
                            >
                              {randTop && <AdviceBadge />}
                              <span className="vt-xs leading-none text-violet-200/90">🎲 +1~3</span>
                              <span className="mt-0.5 font-mono vt-sm font-bold text-violet-200">
                                {fmtBytes(price)}
                              </span>
                              {advice && (
                                <span className="vt-xs leading-none text-violet-200/90">
                                  DPS+{pct(gainOf(`rand:${u.key}`))}
                                </span>
                              )}
                            </button>
                          </div>
                          {/* 넓은 패널: 업그레이드 카드 + 아래 랜덤 강화 */}
                          <div className="hidden flex-col gap-1 @2xl/panel:flex">
                            <button
                              type="button"
                              onClick={() => buy(u)}
                              disabled={s.data < cost}
                              className={`relative flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors enabled:hover:border-emerald-400/50 ${
                                upTop
                                  ? "border-emerald-300/80 bg-emerald-400/[0.1] shadow-[0_0_16px_rgba(74,222,128,0.35)]"
                                  : "border-white/10 bg-white/[0.03]"
                              }`}
                            >
                              {upTop && <AdviceBadge />}
                              <span className="text-xl" aria-hidden>
                                {u.icon}
                              </span>
                              <span className={`min-w-0 flex-1 ${KR}`}>
                                <span className="block vt-base font-bold text-white">
                                  {u.name}{" "}
                                  <span className="font-mono vt-sm text-white/75">Lv.{lv}</span>
                                </span>
                                <span className="block truncate vt-sm text-white/75">
                                  {u.label(st, lv)}
                                </span>
                                {advice && (
                                  <span
                                    className={`block font-mono vt-xs ${upTop ? "text-emerald-200" : "text-white/70"}`}
                                  >
                                    DPS +{pct(gainOf(u.key))}
                                  </span>
                                )}
                              </span>
                              <span className="flex shrink-0 flex-col items-end">
                                <span className="font-mono vt-base font-bold text-emerald-300">
                                  {fmtBytes(cost)}
                                  {many > 1 && (
                                    <span className="ml-1 vt-xs text-emerald-200/90">×{many}</span>
                                  )}
                                </span>
                                <span className="hidden rounded border border-white/15 px-1 font-mono vt-xs text-white/70 md:inline">
                                  {i + 1}
                                </span>
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => doRand(u.key)}
                              disabled={s.data < price}
                              title={`랜덤 강화: ${u.name}${subj(u.name)} ${RAND_ODDS.map((p, k) => `${k + 1}레벨 ${Math.round(p * 100)}%`).join(" · ")} 확률로 올라요.`}
                              className={`relative flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left vt-sm transition-colors enabled:hover:border-violet-300/70 ${KR} ${
                                randTop
                                  ? "border-violet-200/90 bg-violet-400/[0.18] shadow-[0_0_14px_rgba(167,139,250,0.45)]"
                                  : "border-violet-300/25 bg-violet-400/[0.06]"
                              }`}
                            >
                              {randTop && <AdviceBadge />}
                              <span aria-hidden>🎲</span>
                              <span className="truncate font-bold text-violet-100">{u.rand}</span>
                              {!advice && <span className="text-white/70">+1~3</span>}
                              {advice && (
                                <span
                                  className={`shrink-0 font-mono vt-xs whitespace-nowrap ${randTop ? "text-violet-100" : "text-white/70"}`}
                                >
                                  DPS +{pct(gainOf(`rand:${u.key}`))}
                                </span>
                              )}
                              <span className="ml-auto font-mono font-bold text-violet-200">
                                {fmtBytes(price)}
                              </span>
                              <span className="hidden rounded border border-white/15 px-1 font-mono vt-xs text-white/70 md:inline">
                                {RAND_KEYS[i].slice(3)}
                              </span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  />
                )}

                {tab === "module" && (
                  <FitPages
                    page={page}
                    onPages={onPages}
                    className="grid grid-cols-2 gap-2 @2xl/panel:grid-cols-5"
                    items={ROSTER.map((v, i) => {
                      const lv = mods[i];
                      return (
                        <div
                          key={v.id}
                          className="flex items-center gap-2 rounded-xl border px-2 py-2"
                          style={{
                            borderColor: lv ? `${v.color}66` : "rgba(255,255,255,0.08)",
                            background: lv ? `${v.color}12` : "transparent",
                          }}
                          title={
                            lv
                              ? `${v.module}: ${v.cur ? `${v.cur(lv)} — ${v.effect}` : `${v.effect} (버전마다)`}`
                              : `스테이지 ${i + 1} 보스를 격퇴하면 획득`
                          }
                        >
                          <div className={lv ? "" : "opacity-25 grayscale"}>
                            <VirusSprite seed={v.id} color={v.color} size={30} />
                          </div>
                          <div className={`min-w-0 ${KR}`}>
                            <div className="truncate vt-sm font-bold text-white/90">
                              {lv ? v.module : "???"}
                              {lv > 0 && (
                                <span className="ml-1 font-mono vt-xs text-white/75">v{lv}</span>
                              )}
                            </div>
                            <div className="truncate vt-xs text-white/70">
                              {lv ? (v.cur ? v.cur(lv) : v.effect) : v.name}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  />
                )}

                {tab === "shop" && (
                  <FitPages
                    page={page}
                    onPages={onPages}
                    className={`grid grid-cols-2 gap-2 @2xl/panel:grid-cols-3 ${KR}`}
                    items={SHOP.map((d) => {
                      const lv = s.shop[d.key];
                      const maxed = d.max != null && lv >= d.max;
                      const cost = shopCost(d, lv);
                      const locked = shopLocked(s, d);
                      const reqName = SHOP.find((x) => x.key === d.req)?.name;
                      const ra = rAdvice?.list.find((a) => a.key === d.key);
                      const top = rAdvice?.best === d.key;
                      return (
                        <div
                          key={d.key}
                          className={`relative flex flex-col gap-1.5 rounded-xl border p-2 ${
                            top
                              ? "border-emerald-300/80 bg-emerald-400/[0.1] shadow-[0_0_16px_rgba(74,222,128,0.35)]"
                              : "border-amber-300/25 bg-amber-300/[0.05]"
                          } @2xl/panel:flex-row @2xl/panel:items-center @2xl/panel:gap-2.5 @2xl/panel:py-2 @2xl/panel:pr-2 @2xl/panel:pl-2.5`}
                          title={`${d.desc} — 루트 권한을 써도 피해 보너스(×${fmt(st.rootMul)})는 줄지 않고, 포맷해도 남아요${
                            ra?.converted
                              ? " · DPS 수치는 데이터 · 랜덤 강화 효율이 늘어난 만큼 업그레이드를 더 산다고 보고 환산한 값"
                              : ""
                          }`}
                        >
                          {top && <AdviceBadge />}
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="text-lg" aria-hidden>
                              {d.icon}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="vt-md block truncate font-bold text-white">
                                {d.name}{" "}
                                <span className="vt-sm font-mono text-white/75">
                                  {d.max === 1 ? (lv ? "보유" : "") : `Lv.${lv}`}
                                </span>
                              </span>
                              <span className="vt-xs block truncate text-white/75">
                                {d.label(lv)}
                              </span>
                              {ra && (
                                <span
                                  className={`vt-xs block truncate font-mono ${top ? "text-emerald-200" : "text-white/75"}`}
                                >
                                  DPS ×{ra.mul.toFixed(2)} · 🔑100당 +{pct(ra.per100)}
                                  {ra.converted ? " (환산)" : ""}
                                </span>
                              )}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => buyRoot(d.key)}
                            disabled={maxed || locked || rootLeft(s) < cost}
                            className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-amber-300/50 bg-amber-300/15 px-2 transition-colors enabled:hover:bg-amber-300/25 @2xl/panel:h-10 @2xl/panel:min-w-[74px] @2xl/panel:flex-col @2xl/panel:gap-0"
                          >
                            <span className="vt-xs leading-none text-amber-100/90">
                              {maxed ? "완료" : locked ? "🔒 잠김" : "구매"}
                            </span>
                            <span className="vt-sm font-mono font-bold text-amber-200">
                              {maxed ? "MAX" : locked ? `${reqName} 먼저` : `🔑${fmt(cost)}`}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  />
                )}

                {tab === "format" && (
                  <FitPages
                    page={page}
                    onPages={onPages}
                    className={`flex flex-col gap-2 ${KR}`}
                    items={[
                      <div key="main" className="flex items-center gap-3">
                        <div className="vt-sm min-w-0 flex-1 text-white/90">
                          <div className="vt-base">
                            <b className="text-amber-200">🔑 루트 권한 {fmt(s.root)}</b>
                            <span className="ml-1 text-white/75">(피해 ×{fmt(st.rootMul)})</span>
                          </div>
                          <div className="mt-0.5 text-white/75">
                            최고 스테이지 {s.best}
                            {s.formats > 0 && <span> · 포맷 {s.formats}번</span>}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={doFormat}
                          disabled={!formatReady}
                          className="vt-base shrink-0 rounded-xl border border-amber-300/50 bg-amber-300/15 px-4 py-2.5 font-bold text-amber-100 transition-colors enabled:hover:bg-amber-300/25"
                        >
                          💽 시스템 포맷
                          {rootGain > 0 && (
                            <span className="vt-sm block font-normal">
                              루트 권한 +{fmt(rootGain)}
                            </span>
                          )}
                        </button>
                      </div>,
                      <p key="state" className="vt-sm text-white/90">
                        {formatReady
                          ? "더 나아가기 힘들면 지금 포맷하세요."
                          : s.stage < BAL.formatStage
                            ? `스테이지 ${BAL.formatStage}부터 포맷할 수 있어요.`
                            : "최고 스테이지를 넘어서야 루트 권한이 늘어나요."}
                      </p>,
                      <p key="desc" className="vt-sm leading-relaxed text-white/75">
                        포맷하면 스테이지·업그레이드·데이터는 처음으로 돌아가지만, 루트 권한 1마다
                        피해가 {Math.round(BAL.rootBonus * 100)}% 늘어나요. 빼앗은 모듈과 루트
                        상점은 남아요.
                      </p>,
                    ]}
                  />
                )}
                {pages > 1 && (
                  <div className="flex shrink-0 justify-end pt-1.5">
                    <Pager page={Math.min(page, pages - 1)} pages={pages} onPage={setPage} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── 창들 ── */}
        {overlay === "menu" && (
          <Window title="menu.exe" onClose={() => setOverlay(null)}>
            <div className="vw-list flex flex-col gap-2">
              <MenuButton label="계속하기" sub="Esc" onClick={() => setOverlay(null)} />
              <MenuButton
                label="바이러스 도감"
                sub={`${owned}/${ROSTER.length}`}
                onClick={() => setOverlay("archive")}
              />
              <MenuButton label="게임 방법" onClick={() => setOverlay("guide")} />
              <MenuButton
                label="패치노트"
                sub={PATCH_NOTES[0].ver}
                onClick={() => setOverlay("notes")}
              />
              <MenuButton label="설정" onClick={() => setOverlay("settings")} />
              <MenuButton label={fs ? "창 모드" : "전체화면"} onClick={toggleFs} />
              <MenuButton label="시작 화면으로" sub="진행은 저장돼요" onClick={toTitle} />
            </div>
          </Window>
        )}
        {overlay === "settings" && (
          <Window
            title="settings.cfg"
            fill
            onClose={() => setOverlay(scene === "play" ? "menu" : null)}
          >
            <SettingsPanel settings={settings} onChange={changeSettings} onWipe={wipe} />
          </Window>
        )}
        {overlay === "notes" && (
          <Window
            title="patch_notes.txt"
            wide
            fill
            onClose={() => setOverlay(scene === "play" ? "menu" : null)}
          >
            <PatchNotesPanel />
          </Window>
        )}
        {overlay === "archive" && (
          <Window
            title="archive.db"
            wide
            onClose={() => setOverlay(scene === "play" ? "menu" : null)}
          >
            <ArchivePanel best={s.best} />
          </Window>
        )}
        {overlay === "guide" && (
          <Window
            title="readme.txt"
            wide
            fill
            onClose={() => setOverlay(scene === "play" ? "menu" : null)}
          >
            <PagedGuide doc={VIRUS_GUIDE} />
          </Window>
        )}

        {/* ── 알림: 모듈 획득 · 오프라인 수익 ── */}
        {scene === "play" && (reward || away) && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => (reward ? setReward(null) : setAway(null))}
          >
            <div
              className={`virus-pop w-full max-w-sm rounded-2xl border border-white/15 bg-[#0f1a14] p-6 text-center ${KR}`}
              onClick={(ev) => ev.stopPropagation()}
            >
              {reward ? (
                <>
                  <div className="mb-2 flex justify-center">
                    <VirusSprite seed={reward.seed} color={reward.color} size={90} />
                  </div>
                  <p className="vt-base text-white/75">{reward.name} 격퇴! 코드를 분석했어요</p>
                  <p className="mt-2 text-lg font-bold" style={{ color: reward.color }}>
                    📦 모듈 「{reward.module}」{" "}
                    {reward.level > 1 ? `v${reward.level}로 업데이트` : "획득"}
                  </p>
                  <p className="mt-1 vt-base text-white/80">{reward.effect}</p>
                  {reward.level === 1 && (
                    <p className="mt-1 vt-sm text-white/70">바이러스 도감에 기록됐어요</p>
                  )}
                  <button
                    type="button"
                    onClick={() => setReward(null)}
                    className="mt-5 rounded-full bg-emerald-400 px-6 py-2 vt-base font-bold text-black hover:bg-emerald-300"
                  >
                    설치하기
                  </button>
                </>
              ) : (
                away && (
                  <>
                    <p className="text-3xl">🖥️</p>
                    <p className="mt-2 vt-base text-white/75">
                      백그라운드에서 {fmtTime(away.secs)} 동안 몰래 실행
                    </p>
                    <p className="mt-1 text-lg font-bold text-emerald-300">
                      💾 {fmtBytes(away.data)} 탈취
                    </p>
                    <button
                      type="button"
                      onClick={() => setAway(null)}
                      className="mt-5 rounded-full bg-emerald-400 px-6 py-2 vt-base font-bold text-black hover:bg-emerald-300"
                    >
                      받기
                    </button>
                  </>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
