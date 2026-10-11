"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@/css/Page/virus.css";
import GameHeader from "@/components/GameHeader";
import GuideView from "@/components/GuideView";
import SpeakerIcon from "@/components/Rhythm/SpeakerIcon";
import { LEVEL } from "@/lib/soundLevel";
import { playVirusSfx, setVirusSfxVolume, unlockVirusSfx } from "@/lib/virus/sfx";
import { VIRUS_GUIDE } from "@/data/gameGuides";
import { FileSprite, HackerSprite, VirusSprite } from "./VirusSprite";
import TitleScreen, { type TitleItem } from "./TitleScreen";
import BossCinema, { BossShards, type Cinema } from "./BossCinema";
import {
  ArchivePanel,
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
  type UpgKey,
  zoneOf,
  type Save,
  type UpgDef,
} from "@/lib/virus/logic";

const TICK_MS = 100;
/** 보스 연출 길이 — virus.css 의 vb-* (2.3s) · vd-* (1.7s) 와 같게, 효과음 길이에 맞춘 값 */
const APPEAR_MS = 2300;
const DOWN_MS = 1700;
const BGM_SRC = "/virus/bgm-theme.mp3";
/** 익스플로잇(치명타) 색 — 날아가는 코드 · 피해 숫자 */
const CRIT_COLOR = "#fbbf24";
/** 피해 숫자 테두리 (어두운 테두리 + 은은한 빛) */
const outline = (glow: string) =>
  `0 0 2px #020604, 0 0 2px #020604, 1px 1px 0 #020604, -1px -1px 0 #020604, 1px -1px 0 #020604, -1px 1px 0 #020604, 0 0 12px ${glow}`;
const ACCENT = "#4ade80";
const KR = "font-['Nanum_Gothic',sans-serif]";
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
type Overlay = null | "menu" | "settings" | "archive" | "guide";
type Tab = "upgrade" | "module" | "format";

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
    const { def, tier } = bossOf(stage);
    const now = performance.now();
    cinemaRef.current = {
      id: Math.floor(now),
      kind,
      seed: def.id,
      color: def.color,
      name: def.name + tierLabel(tier),
      until: now + (kind === "appear" ? APPEAR_MS : DOWN_MS),
    };
    pending.current = [];
    atkAcc.current = 0;
    setShots([]);
    playVirusSfx(kind === "appear" ? "boss-appear" : "boss-down");
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

  // 전체화면 상태 따라가기
  useEffect(() => {
    const on = () => setFs(document.fullscreenElement === frameRef.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFs = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else frameRef.current?.requestFullscreen?.().catch(() => {});
  }, []);

  // ── 장면 바꾸기 ──

  const startPlay = useCallback(
    (fresh: boolean) => {
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
    [persist, sync, startCinema]
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
    const id = setInterval(() => {
      const s = save.current;
      const st = stats(s);
      const dt = TICK_MS / 1000;
      const now = performance.now();
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
        if (bossLeft.current <= 0) {
          // 시간 초과 — 파일을 감염시키며 더 강해진 뒤 재도전
          s.bossFail = true;
          enemy.current = spawn(s);
          bossLeft.current = BOSS_TIME;
        }
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
  }, [scene, damage, addFloat, persist, sync]);

  const buy = useCallback(
    (u: UpgDef) => {
      const s = save.current;
      const lv = s.lv[u.key];
      const cost = upgCost(u, lv, stats(s));
      if (s.data < cost) return;
      s.data -= cost;
      s.lv[u.key] = lv + 1;
      sync();
    },
    [sync]
  );

  /** 랜덤 강화: 값을 치르고 그 업그레이드가 1~3레벨 무작위로 오름 */
  const doRand = useCallback(
    (key: UpgKey) => {
      const n = randUpgrade(save.current, key);
      if (!n) return;
      const id = Date.now();
      setRanded({ id, key, n });
      setTimeout(() => setRanded((f) => (f?.id === id ? null : f)), 2600);
      sync();
    },
    [sync]
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

  // 게임 화면 단축키: Esc 메뉴 · 1~3 업그레이드 · Q W E 랜덤 강화
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
      const f = RAND_KEYS.indexOf(e.code);
      if (f >= 0 && f < UPGRADES.length) doRand(UPGRADES[f].key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scene, overlay, reward, away, buy, doRand]);

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
  const st = stats(s);
  const mods = moduleLevels(s.best);
  const owned = mods.filter((m) => m > 0).length;
  // 해커의 눈·노트북 빛과 날아가는 코드: 마지막으로 빼앗은 모듈의 색
  const last = s.best > 1 ? bossOf(s.best - 1).def : null;
  const myColor = last?.color ?? ACCENT;
  const boss = bossOf(s.stage);
  const file = FILE_TYPES[e.file];
  /** 지금 적에게 들어가는 예상 초당 피해 */
  const curDps = dps(st) * (e.boss ? st.bossDmgMul : 1);
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
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg border bg-black/50 px-2 font-mono text-[11px] transition-colors hover:border-emerald-300/60 ${
        muted ? "border-white/15 text-white/40" : "border-emerald-300/40 text-emerald-200"
      }`}
    >
      <SpeakerIcon muted={muted} className="h-4 w-4" />
      <span className="hidden rounded border border-white/20 px-1 leading-tight md:inline">M</span>
    </button>
  );

  const tabs: { key: Tab; label: string; badge?: string }[] = [
    { key: "upgrade", label: "업그레이드" },
    { key: "module", label: "코드 모듈", badge: `${owned}/${ROSTER.length}` },
    { key: "format", label: "시스템 포맷", badge: formatReady ? `+${fmt(rootGain)}` : undefined },
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
        className={`relative flex w-full flex-col overflow-hidden border border-emerald-400/20 bg-[#050806] ${
          fs ? "h-full" : "h-[680px] rounded-3xl md:h-auto md:aspect-[16/10]"
        } ${settings.effects ? "" : "virus-calm"}`}
      >
        {scene === "title" && <div className="absolute top-3 right-3 z-30">{muteButton}</div>}
        {scene === "title" ? (
          <TitleScreen
            entered={entered && loaded}
            onEnter={() => {
              if (!loaded) return;
              setEntered(true);
              unlockAudio();
            }}
            items={titleItems}
            blocked={overlay !== null}
          />
        ) : (
          <>
            {/* ── 위 막대: 메뉴 · 위치 · 진행 · 재화 ── */}
            <div className="flex items-center gap-3 border-b border-emerald-400/15 bg-black/40 px-3 py-2 sm:px-4">
              <button
                type="button"
                onClick={() => setOverlay("menu")}
                aria-label="메뉴 (Esc)"
                title="메뉴 (Esc)"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/15 font-mono text-white/70 hover:border-emerald-300/60 hover:text-white"
              >
                ≡
              </button>
              <div className={`min-w-0 text-xs text-white/70 sm:text-sm ${KR}`}>
                <span className="font-mono text-emerald-400/70">&gt; </span>
                <b className="text-white">{zoneOf(s.stage)}</b>
                <span className="ml-1">· 스테이지 {s.stage}</span>
              </div>
              <div className="hidden flex-1 items-center gap-1 md:flex">
                {Array.from({ length: MOBS_PER_STAGE }, (_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full ${i < s.kills ? "bg-emerald-400" : "bg-white/10"}`}
                  />
                ))}
                <span className="ml-1 text-sm">☠️</span>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-3 font-mono text-sm font-bold md:ml-0">
                <span className="text-emerald-300">💾 {fmtBytes(s.data)}</span>
                <span className="hidden text-amber-200 sm:inline" title="루트 권한">
                  🔑 {fmt(s.root)}
                </span>
                {muteButton}
              </div>
            </div>
            {/* 좁은 화면: 진행 막대를 따로 한 줄 */}
            <div className="flex items-center gap-1 px-3 pt-2 md:hidden">
              {Array.from({ length: MOBS_PER_STAGE }, (_, i) => (
                <div
                  key={i}
                  className={`h-1.5 flex-1 rounded-full ${i < s.kills ? "bg-emerald-400" : "bg-white/10"}`}
                />
              ))}
              <span className="ml-1 text-sm">☠️</span>
            </div>

            {/* ── 전투 ── */}
            <div className="virus-screen relative min-h-0 flex-1">
              {/* 왼쪽 위: 지금 적에게 들어가는 예상 초당 피해 */}
              <div
                className={`pointer-events-none absolute top-2 left-3 z-10 rounded-lg border border-emerald-400/20 bg-black/55 px-2.5 py-1 ${KR}`}
                title="공격력 × 초당 발사 × 익스플로잇 평균 (보스면 보스 피해 배율까지)"
              >
                <div className="text-[10px] text-emerald-300/60">예상 DPS</div>
                <div className="font-mono text-base leading-tight font-bold text-emerald-200 tabular-nums">
                  {fmt(curDps)}
                  {e.boss && st.bossDmgMul > 1 && (
                    <span className="ml-1 text-[10px] font-normal text-amber-200/80">
                      보스 ×{fmt(st.bossDmgMul)}
                    </span>
                  )}
                </div>
              </div>
              {cinema && <BossCinema c={cinema} />}
              <div
                key={cinema?.id ?? 0}
                className={`absolute inset-0 grid grid-cols-2 items-center select-none ${
                  cinema ? (cinema.kind === "appear" ? "vb-shake" : "vd-shake") : ""
                }`}
              >
                <div className="flex flex-col items-center gap-2">
                  <HackerSprite color={myColor} firing={fired} />
                  <span className={`text-xs text-white/60 ${KR}`}>
                    나 · 모듈 {owned}/{ROSTER.length}
                  </span>
                </div>

                {/* 날아가는 바이러스 코드 */}
                <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
                  {shots.map((sh) => (
                    <span
                      key={sh.id}
                      className={`virus-shot absolute font-mono font-bold whitespace-nowrap ${
                        sh.crit ? "text-sm" : "text-xs"
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
                      dying ? "" : cinema?.kind === "appear" && e.boss ? "vb-slam" : "virus-pop"
                    }`}
                  >
                    {dying ? (
                      <>
                        <div className="vd-boss">
                          <VirusSprite seed={dying.seed} color={dying.color} size={140} />
                        </div>
                        <BossShards c={dying} />
                      </>
                    ) : e.boss ? (
                      <VirusSprite
                        seed={boss.def.id}
                        color={boss.def.color}
                        size={140}
                        hit={hitNow}
                        title={boss.def.id}
                      />
                    ) : (
                      <FileSprite
                        ext={file.ext}
                        color={file.color}
                        hit={hitNow}
                        infected={1 - e.hp / e.max}
                      />
                    )}
                  </div>
                  <span className={`text-xs text-white/80 ${KR}`}>
                    {dying ? (
                      <b style={{ color: dying.color }} className="line-through opacity-60">
                        ☠️ {dying.name}
                      </b>
                    ) : e.boss ? (
                      <b style={{ color: boss.def.color }}>
                        ☠️ {boss.def.name + tierLabel(boss.tier)}{" "}
                        <span className="font-mono text-[10px] font-normal text-white/40">
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
                  <span className="font-mono text-[11px] text-white/50">
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

              {/* 랜덤 강화 결과 */}
              {randed && (
                <div
                  key={randed.id}
                  className={`virus-pop absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-violet-300/50 bg-violet-950/85 px-4 py-1.5 text-xs whitespace-nowrap text-violet-100 shadow-[0_0_20px_rgba(167,139,250,0.35)] ${KR}`}
                >
                  🎲 {UPGRADES.find((u) => u.key === randed.key)?.rand} · +{randed.n}레벨
                  {randed.n === RAND_ODDS.length && " 잭팟!"}
                </div>
              )}

              {/* 보스 시간 / 재도전 / 안내 */}
              <div className="absolute inset-x-3 bottom-2 sm:inset-x-4">
                {e.boss ? (
                  <div className="flex items-center gap-2">
                    <span className="w-12 font-mono text-xs text-rose-300">{left.toFixed(1)}s</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-rose-400"
                        style={{ width: `${(left / BOSS_TIME) * 100}%` }}
                      />
                    </div>
                  </div>
                ) : s.bossFail ? (
                  <div
                    className={`flex items-center justify-between gap-2 text-xs text-white/60 ${KR}`}
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
                  <p className={`text-center text-[11px] text-white/35 ${KR}`}>
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
            <div className="flex h-[250px] shrink-0 flex-col border-t border-emerald-400/15 bg-black/40 md:h-[31%]">
              <div className="flex gap-1 px-3 pt-2 sm:px-4">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={`rounded-t-lg border-x border-t px-3 py-1.5 text-xs font-bold transition-colors ${KR} ${
                      tab === t.key
                        ? "border-emerald-400/30 bg-emerald-400/10 text-white"
                        : "border-transparent text-white/45 hover:text-white/80"
                    }`}
                  >
                    {t.label}
                    {t.badge && (
                      <span
                        className={`ml-1.5 font-mono text-[10px] ${
                          t.key === "format" ? "text-amber-200" : "text-white/40"
                        }`}
                      >
                        {t.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto border-t border-emerald-400/15 p-3 sm:px-4">
                {tab === "upgrade" && (
                  <div className="grid gap-3 md:grid-cols-3">
                    {UPGRADES.map((u, i) => {
                      const lv = s.lv[u.key];
                      const cost = upgCost(u, lv, st);
                      const price = randPrice(s, u.key);
                      return (
                        <div key={u.key} className="flex flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => buy(u)}
                            disabled={s.data < cost}
                            className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition-colors enabled:hover:border-emerald-400/50 disabled:opacity-50"
                          >
                            <span className="text-xl" aria-hidden>
                              {u.icon}
                            </span>
                            <span className={`min-w-0 flex-1 ${KR}`}>
                              <span className="block text-sm font-bold text-white">
                                {u.name}{" "}
                                <span className="font-mono text-xs text-white/50">Lv.{lv}</span>
                              </span>
                              <span className="block truncate text-[11px] text-white/55">
                                {u.label(st, lv)}
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end">
                              <span className="font-mono text-sm font-bold text-emerald-300">
                                {fmtBytes(cost)}
                              </span>
                              <span className="hidden rounded border border-white/15 px-1 font-mono text-[9px] text-white/40 md:inline">
                                {i + 1}
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => doRand(u.key)}
                            disabled={s.data < price}
                            title={`랜덤 강화: ${u.name}${subj(u.name)} ${RAND_ODDS.map((p, k) => `${k + 1}레벨 ${Math.round(p * 100)}%`).join(" · ")} 확률로 올라요.`}
                            className={`flex items-center gap-2 rounded-lg border border-violet-300/25 bg-violet-400/[0.06] px-3 py-1.5 text-left text-[11px] transition-colors enabled:hover:border-violet-300/70 disabled:opacity-45 ${KR}`}
                          >
                            <span aria-hidden>🎲</span>
                            <span className="font-bold text-violet-100">{u.rand}</span>
                            <span className="text-white/45">+1~3</span>
                            <span className="ml-auto font-mono font-bold text-violet-200">
                              {fmtBytes(price)}
                            </span>
                            <span className="hidden rounded border border-white/15 px-1 font-mono text-[9px] text-white/40 md:inline">
                              {RAND_KEYS[i].slice(3)}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {tab === "module" && (
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                    {ROSTER.map((v, i) => {
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
                            <div className="truncate text-[11px] font-bold text-white/90">
                              {lv ? v.module : "???"}
                              {lv > 0 && (
                                <span className="ml-1 font-mono text-[10px] text-white/50">
                                  v{lv}
                                </span>
                              )}
                            </div>
                            <div className="truncate text-[10px] text-white/45">
                              {lv ? (v.cur ? v.cur(lv) : v.effect) : v.name}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {tab === "format" && (
                  <div className={`flex flex-col gap-3 sm:flex-row sm:items-center ${KR}`}>
                    <div className="min-w-0 flex-1 text-xs text-white/60">
                      <div className="text-sm">
                        <b className="text-amber-200">🔑 루트 권한 {fmt(s.root)}</b>
                        <span className="ml-1 text-white/50">(피해 ×{fmt(st.rootMul)})</span>
                      </div>
                      <div className="mt-1">
                        최고 스테이지 {s.best}
                        {s.formats > 0 && (
                          <span className="ml-2 text-white/40">· 포맷 {s.formats}번</span>
                        )}
                      </div>
                      <p className="mt-2 leading-relaxed text-white/45">
                        포맷하면 스테이지·업그레이드·데이터는 처음으로 돌아가지만, 루트 권한 1마다
                        피해가 {Math.round(BAL.rootBonus * 100)}% 늘어나요. 빼앗은 모듈은 남아요.
                        <br />
                        {formatReady
                          ? "더 나아가기 힘들면 지금 포맷하세요."
                          : s.stage < BAL.formatStage
                            ? `스테이지 ${BAL.formatStage}부터 포맷할 수 있어요.`
                            : "최고 스테이지를 넘어서야 루트 권한이 늘어나요."}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={doFormat}
                      disabled={!formatReady}
                      className="shrink-0 rounded-xl border border-amber-300/40 bg-amber-300/10 px-5 py-3 text-sm font-bold text-amber-200 transition-colors enabled:hover:bg-amber-300/20 disabled:opacity-40"
                    >
                      💽 시스템 포맷
                      {rootGain > 0 && (
                        <span className="block text-xs font-normal">
                          루트 권한 +{fmt(rootGain)}
                        </span>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── 창들 ── */}
        {overlay === "menu" && (
          <Window title="menu.exe" onClose={() => setOverlay(null)}>
            <div className="flex flex-col gap-2">
              <MenuButton label="계속하기" sub="Esc" onClick={() => setOverlay(null)} />
              <MenuButton
                label="바이러스 도감"
                sub={`${owned}/${ROSTER.length}`}
                onClick={() => setOverlay("archive")}
              />
              <MenuButton label="게임 방법" onClick={() => setOverlay("guide")} />
              <MenuButton label="설정" onClick={() => setOverlay("settings")} />
              <MenuButton label={fs ? "창 모드" : "전체화면"} onClick={toggleFs} />
              <MenuButton label="시작 화면으로" sub="진행은 저장돼요" onClick={toTitle} />
            </div>
          </Window>
        )}
        {overlay === "settings" && (
          <Window title="settings.cfg" onClose={() => setOverlay(scene === "play" ? "menu" : null)}>
            <SettingsPanel settings={settings} onChange={changeSettings} onWipe={wipe} />
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
            onClose={() => setOverlay(scene === "play" ? "menu" : null)}
          >
            <GuideView
              doc={VIRUS_GUIDE}
              accent={ACCENT}
              onDone={() => setOverlay(scene === "play" ? "menu" : null)}
            />
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
                  <p className="text-sm text-white/60">{reward.name} 격퇴! 코드를 분석했어요</p>
                  <p className="mt-2 text-lg font-bold" style={{ color: reward.color }}>
                    📦 모듈 「{reward.module}」{" "}
                    {reward.level > 1 ? `v${reward.level}로 업데이트` : "획득"}
                  </p>
                  <p className="mt-1 text-sm text-white/80">{reward.effect}</p>
                  {reward.level === 1 && (
                    <p className="mt-1 text-[11px] text-white/40">바이러스 도감에 기록됐어요</p>
                  )}
                  <button
                    type="button"
                    onClick={() => setReward(null)}
                    className="mt-5 rounded-full bg-emerald-400 px-6 py-2 text-sm font-bold text-black hover:bg-emerald-300"
                  >
                    설치하기
                  </button>
                </>
              ) : (
                away && (
                  <>
                    <p className="text-3xl">🖥️</p>
                    <p className="mt-2 text-sm text-white/60">
                      백그라운드에서 {fmtTime(away.secs)} 동안 몰래 실행
                    </p>
                    <p className="mt-1 text-lg font-bold text-emerald-300">
                      💾 {fmtBytes(away.data)} 탈취
                    </p>
                    <button
                      type="button"
                      onClick={() => setAway(null)}
                      className="mt-5 rounded-full bg-emerald-400 px-6 py-2 text-sm font-bold text-black hover:bg-emerald-300"
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
