"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@/css/Page/virus.css";
import GameHeader from "@/components/GameHeader";
import SpeakerIcon from "@/components/Rhythm/SpeakerIcon";
import { LEVEL } from "@/lib/soundLevel";
import { lockScroll } from "@/lib/scrollLock";
import { playVirusSfx, setVirusSfxVolume, unlockVirusSfx } from "@/lib/virus/sfx";
import { VIRUS_GUIDE } from "@/data/gameGuides";
import { ApexSprite, FileSprite, MyVirusSprite, VirusSprite } from "./VirusSprite";
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
  RecordsPanel,
  BackupPanel,
  Window,
  type VirusSettings,
} from "./Panels";
import {
  APEX,
  FINAL,
  MAX_STAGE,
  finalData,
  finalHp,
  BAL,
  BOSS_TIME,
  apexCount,
  apexData,
  apexHp,
  apexOf,
  isApexStage,
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
  formatStart,
  canAffordShop,
  isCoreItem,
  type UpgKey,
  zoneOf,
  type Save,
  type UpgDef,
  bossTimeOf,
  buyUpgrade,
  checkAch,
  checkChal,
  startChal,
  chalOpen,
  CHAL,
  upgLocked,
  randLocked,
  ACH,
  type ChalDef,
  type ChalKey,
  milestoneCore,
  dropFrag,
  dropKey,
  dropKind,
  gotoStage,
  rollBoss,
  compileMod,
  compileAll,
  compileReady,
  compileByp,
  planMod,
  fragCost,
  keyCost,
  modOpenable,
  DROP_NEW,
  DROP_AGAIN,
  type CompileItem,
  BUFF_MS,
  BURN_SECS,
  baseDps,
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
type Overlay = null | "menu" | "settings" | "archive" | "guide" | "notes" | "records" | "backup";
type Tab = "upgrade" | "module" | "bypass" | "shop" | "format";
/** 업그레이드 한 번에 몇 번 살지 */
type BuyMode = 1 | 10 | "max";

interface Enemy {
  hp: number;
  max: number;
  boss: boolean;
  /** 상위 보스 (10스테이지마다 보스 다음) */
  apex: boolean;
  /** 최종 보스 (마지막 스테이지 상위 보스 다음) */
  final: boolean;
  /** 파일 종류 (FILE_TYPES 번호) */
  file: number;
  /** 쓰러뜨리면 받는 데이터 (러브레터 미끼가 명중마다 미리 나눠 빼냄) */
  reward: number;
  /** 아직 한 발도 안 맞음 (부트 선점 — 첫 발 강타) */
  fresh: boolean;
  /** 약점 분석 중첩 수 */
  stacks: number;
  /** 점화가 꺼지는 시각 (performance.now, 0 = 안 탐) */
  burnUntil: number;
  /** 암호화 잠금으로 이번 전투에 늘린 보스 시간 (초) */
  locked: number;
  /** 백도어 이월만으로 쓰러진 적 (그 초과 피해는 다시 넘기지 않음) */
  carryKill: boolean;
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

/** 격퇴 보상 알림 — 모듈 (보스) · 특성과 외형 (상위 보스 처음 처치) */
interface Reward {
  name: string;
  seed: string;
  color: string;
  /** 보스에게서 얻은 코드 조각 */
  frag?: { index: number; n: number };
  /** 상위 보스에게서 얻은 우회 키 (처음 잡았으면 apex 로 보여 줌) */
  key?: { index: number; n: number };
  apex?: { index: number; trait: string; effect: string; look: string };
  /** 최종 보스 격퇴 (몇 번째인지) */
  final?: { clears: number; cores: number };
  /** 100스테이지마다 처음 넘어서 받은 커널 코어 (보유 수) */
  core?: number;
  /** 챌린지 변이 성공 */
  chal?: ChalDef;
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
  /** 취약점 노출(익스플로잇 뒤 피해 증가)이 켜져 있는지 */
  exposed: boolean;
  /** 지금 적이 점화로 불타는지 */
  burning: boolean;
  /** 보스 등장 · 격퇴 연출 중이면 그 내용 */
  cinema: Cinema | null;
}

const START_ENEMY: Enemy = {
  hp: 5,
  max: 5,
  boss: false,
  apex: false,
  final: false,
  file: 0,
  reward: 0,
  fresh: true,
  stacks: 0,
  burnUntil: 0,
  locked: 0,
  carryKill: false,
};

function spawn(s: Save): Enemy {
  const st = stats(s);
  const boss = s.kills >= MOBS_PER_STAGE && !s.bossFail;
  // 10스테이지마다 보스를 잡고 나면 그 자리에 상위 보스
  // 마지막 스테이지 상위 보스까지 잡으면 최종 보스
  const final = boss && s.finalReady;
  const apex = boss && s.bossDone && !final;
  const max = final
    ? finalHp(st, s.clears)
    : apex
      ? apexHp(s.stage, st)
      : boss
        ? bossHp(s.stage, st)
        : mobHp(s.stage, st);
  const reward = final
    ? finalData(st)
    : apex
      ? apexData(s.stage, st)
      : boss
        ? bossData(s.stage, st)
        : mobData(s.stage, st);
  return {
    ...START_ENEMY,
    hp: max,
    max,
    boss,
    apex,
    final,
    reward,
    file: Math.floor(Math.random() * FILE_TYPES.length),
  };
}

/** 이 적의 제한 시간 (상위 보스는 더 길게, 「로그 삭제」 특성이면 +5초) */
function timeFor(e: Enemy, s: Save) {
  return bossTimeOf(e.final ? "final" : e.apex ? "apex" : "boss", stats(s));
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
    exposed: false,
    burning: false,
    cinema: null,
  }));
  /** 취약점 노출이 꺼지는 시각 (performance.now) · DDoS 폭격까지 쌓인 시간 · 매크로 연사용 발사 수 */
  const buffUntil = useRef(0);
  const ddosAcc = useRef(0);
  const shotCount = useRef(0);
  /** 지금 연출 (끝나는 시각까지 공격 · 보스 시간이 멈춤) */
  const cinemaRef = useRef<Cinema | null>(null);
  /** 보스 격퇴 연출이 끝나면 상위 보스 등장 연출 */
  const apexIntro = useRef(false);
  /** 상위 보스(마지막 스테이지) 격퇴 연출이 끝나면 최종 보스 등장 연출 */
  const finalIntro = useRef(false);
  /** 격퇴 연출이 끝나면 띄울 보상 창 */
  const pendingReward = useRef<Reward | null>(null);
  /** 챌린지 성공 알림 — 연출이 없을 때 하나씩 (업적은 알림 대신 위 막대 🏅 에 느낌표) */
  const queued = useRef<Reward[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [scene, setScene] = useState<Scene>("title");
  const [entered, setEntered] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [tab, setTab] = useState<Tab>("upgrade");
  const [buyMode, setBuyMode] = useState<BuyMode>(1);
  /** 루트 상점 분류: 효율 강화 · 편의성 */
  const [shopCat, setShopCat] = useState<"power" | "util" | "core">("power");
  /** 아래 패널 목록의 페이지 (칸에 다 안 들어가면 나눔 — 스크롤 없음) */
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const onPages = useCallback((n: number) => setPages(n), []);
  const pickTab = (k: Tab) => {
    setTab(k);
    setPage(0);
    setPages(1);
  };
  // 화면 틀: 일반 화면 비율 = 모니터 비율(--ar), 배율(--vz) = 틀 크기 ÷ 기준 1180×664 (작으면 1)
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ar = window.screen.width / window.screen.height;
    el.style.setProperty("--ar", String(Math.min(2.4, Math.max(0.5, ar || 16 / 9))));
    const fit = () => {
      const z = Math.max(1, Math.min(el.clientWidth / 1180, el.clientHeight / 664));
      el.style.setProperty("--vz", z.toFixed(3));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
  /** 격퇴 알림 — 우측 상단에 잠깐 떴다 사라짐 */
  const [toasts, setToasts] = useState<{ id: number; r: Reward }[]>([]);
  const pushToast = useCallback((r: Reward) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-2), { id, r }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), r.apex ? 6500 : 4500);
  }, []);
  /** 게임 안 확인 창 — 브라우저 confirm() 은 전체화면을 풀어 버려서 직접 그림 */
  const [ask, setAsk] = useState<{
    title: string;
    body: string;
    yes: string;
    danger?: boolean;
    onYes: () => void;
  } | null>(null);
  /** 코드 모듈 탭에서 누른 모듈 · 특성 (크게 보기) */
  const [detail, setDetail] = useState<{ kind: "mod" | "apex"; i: number } | null>(null);
  /** 방금 랜덤 강화 결과 (잠깐 띄움) */
  const [randed, setRanded] = useState<{ id: number; key: UpgKey; n: number } | null>(null);
  /** 기록 창을 열 때 새로 본 업적 (NEW 표시) */
  const [freshAch, setFreshAch] = useState<string[]>([]);
  /** 방금 진화한 단계 (잠깐 띄움) */
  const [evolved, setEvolved] = useState<{ id: number; stage: number } | null>(null);
  /** 업그레이드 뒤 진화 단계가 올랐으면 알림 */
  const checkEvolve = useCallback((before: number) => {
    const after = evoStage(save.current.lv);
    if (after <= before) return;
    const id = Date.now();
    setEvolved({ id, stage: after });
    setTimeout(() => setEvolved((v) => (v?.id === id ? null : v)), 1800);
  }, []);

  const sync = useCallback((hit = false, fired = false) => {
    setView({
      save: { ...save.current, lv: { ...save.current.lv } },
      enemy: { ...enemy.current },
      bossLeft: bossLeft.current,
      hit,
      fired,
      exposed: buffUntil.current > performance.now(),
      burning: enemy.current.burnUntil > performance.now(),
      cinema: cinemaRef.current,
    });
  }, []);

  /** 보스 연출 시작 — 날아가던 코드는 지우고, 끝날 때까지 공격 · 보스 시간 멈춤 */
  const startCinema = useCallback(
    (kind: Cinema["kind"], stage: number, apex = false, final = false) => {
      // 탭이 가려져 있으면 연출 없이 바로 다음으로 (뒤에서 돌 때 시간이 멈추지 않게)
      if (document.visibilityState === "hidden") return;
      const { def, index } = bossOf(save.current);
      const ax = apexOf(stage);
      // 이 스테이지에 처음 합류하는 바이러스
      const joined =
        index >= 0 &&
        ROSTER[index].join === stage &&
        stage >= save.current.best &&
        kind === "appear";
      const now = performance.now();
      cinemaRef.current = {
        id: Math.floor(now),
        kind,
        seed: def.id,
        color: final ? FINAL.color : apex ? ax.def.color : def.color,
        name: final
          ? `${FINAL.role} ${FINAL.name}${tierLabel(save.current.clears + 1)}`
          : apex
            ? `${ax.def.role} ${ax.def.name}${tierLabel(ax.tier)}`
            : joined
              ? `NEW · ${def.name}`
              : def.name,
        apex: final ? 10 : apex ? ax.index : undefined,
        final,
        until: now + (kind === "appear" ? APPEAR_MS : kind === "down" ? DOWN_MS : FAIL_MS),
      };
      pending.current = [];
      atkAcc.current = 0;
      setShots([]);
      playVirusSfx(kind === "appear" ? "boss-appear" : kind === "down" ? "boss-down" : "boss-fail");
    },
    []
  );

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

  /** 새로 연 코드 모듈 소개 (처음 컴파일했을 때 한 번) */
  const [intro, setIntro] = useState<number[]>([]);
  /** 컴파일 막대를 닫은 때의 조각 · 키 합계 — 그보다 더 모이기 전엔 다시 안 띄움 */
  const [barHidden, setBarHidden] = useState(-1);
  /** 컴파일 뒤: 처음 연 모듈은 소개 */
  const afterCompile = useCallback((before: number[], items: CompileItem[]) => {
    const fresh = items.filter((c) => c.kind === "mod" && !before[c.i]).map((c) => c.i);
    if (fresh.length) setIntro((q) => [...q, ...fresh.filter((i) => !q.includes(i))]);
  }, []);
  /** 컴파일 (버튼 · F 키) */
  const doCompile = useCallback(
    (fn: (sv: Save) => CompileItem[]) => {
      const sv = save.current;
      const before = [...sv.mods];
      const items = fn(sv);
      if (!items.length) return;
      afterCompile(before, items);
      playVirusSfx("boss-down");
      persist();
      sync();
    },
    [afterCompile, persist, sync]
  );

  /**
   * 보스 · 상위 보스를 잡은 뒤 조각 · 키 — 자동 컴파일러가 있으면 바로 컴파일.
   */
  const lootRef = useRef<
    (apex: boolean) => { frag?: Reward["frag"]; key?: Reward["key"]; opened: boolean }
  >(() => ({ opened: false }));
  useEffect(() => {
    lootRef.current = (apex: boolean) => {
      const s = save.current;
      // 처음 가는 스테이지 · 이번 회차에 처음 오르는 스테이지 · 다시 도는 스테이지 (보스 전투 시간에 비례한 확률)
      const kind = dropKind(s);
      const fight = Math.max(0, timeFor(enemy.current, s) - bossLeft.current);
      let out: { frag?: Reward["frag"]; key?: Reward["key"]; opened: boolean };
      if (apex) {
        const k = dropKey(s, kind, fight);
        out = { key: k.opened || !k.n ? undefined : { index: k.index, n: k.n }, opened: k.opened };
      } else {
        const f = dropFrag(s, kind, fight);
        out = { frag: f.n ? f : undefined, opened: false };
      }
      if (s.shop.autoc) {
        const before = [...s.mods];
        afterCompile(before, compileAll(s));
      }
      return out;
    };
  }, [afterCompile]);

  /** damage 를 자기 안에서 다시 부를 때 (백도어 이월로 다음 적까지 쓰러질 때) */
  const damageRef = useRef<(amount: number) => void>(() => {});
  /** 적에게 피해를 주고, 쓰러뜨리면 보상·다음 적 */
  const damage = useCallback(
    (amount: number) => {
      const s = save.current;
      const e = enemy.current;
      e.hp -= amount;
      if (amount > s.rec.maxHit) s.rec.maxHit = amount;
      if (e.hp > 0) return;
      const st = stats(s);
      // 백도어 이월: 넘친 피해 (쓰러뜨린 적의 최대 체력까지) × 이월 비율 — 이월로 쓰러진 적의 초과분은 다시 안 넘김
      const over = e.carryKill ? 0 : Math.min(-e.hp, e.max) * st.fx.carry;
      if (e.boss) {
        if (bossLeft.current <= 1) s.rec.clutch++;
        if (e.final) {
          const took = timeFor(e, s) - bossLeft.current;
          if (!s.rec.bestFinal || took < s.rec.bestFinal) s.rec.bestFinal = took;
        } else if (e.apex) s.rec.apexes++;
        else s.rec.bosses++;
      }
      if (e.final) {
        // 최종 보스: 마지막 스테이지에 머물며 다시 파일부터 (반복해서 잡을 수 있음)
        startCinema("down", s.stage, false, true);
        duckBgm.current();
        gainData(s, finalData(st));
        s.clears += 1;
        s.cores += 1;
        s.finalReady = false;
        s.bossDone = false;
        s.kills = 0;
        pendingReward.current = {
          name: `${FINAL.role} ${FINAL.name}${tierLabel(s.clears)}`,
          seed: FINAL.id,
          color: FINAL.color,
          final: { clears: s.clears, cores: s.cores },
        };
        persist();
      } else if (e.boss && !e.apex && isApexStage(s.stage)) {
        // 10스테이지마다: 보스는 잡았고, 격퇴 연출이 끝나면 상위 보스가 나옴 (스테이지는 그대로)
        startCinema("down", s.stage);
        duckBgm.current();
        gainData(s, bossData(s.stage, st));
        lootRef.current(false);
        s.bossDone = true;
        apexIntro.current = true;
        persist();
      } else if (e.boss) {
        const { def } = bossOf(s);
        const ax = apexOf(s.stage);
        const wasApex = e.apex;
        const fresh = s.stage >= s.best;
        startCinema("down", s.stage, wasApex);
        duckBgm.current();
        gainData(s, wasApex ? apexData(s.stage, st) : bossData(s.stage, st));
        // 코드 조각 (보스) · 우회 키 (상위 보스 — 처음이면 우회 기술 v1)
        const got = lootRef.current(wasApex);
        // 상위 보스를 처음 잡으면 우회 기술 + 외형 (변이해도 남음) · 100스테이지마다 처음 넘으면 커널 코어
        const newApex = wasApex && s.stage > s.apexBest;
        const core = newApex && milestoneCore(s.stage);
        if (core) s.cores += 1;
        if (newApex) s.apexBest = s.stage;
        s.bossDone = false;
        s.kills = 0;
        // 마지막 스테이지의 상위 보스를 잡으면 더 나아가지 않고 최종 보스 (best 는 101 = 100 통과)
        const last = wasApex && s.stage >= MAX_STAGE;
        if (last) {
          s.finalReady = true;
          // 파일 없이 바로 최종 보스
          s.kills = MOBS_PER_STAGE;
          finalIntro.current = true;
        }
        const next = s.stage + 1;
        // 반복 중이면 이 스테이지에 머물고 파일부터 다시 (그래도 이 스테이지는 지나온 것으로)
        if (!last && !s.repeat) s.stage = next;
        if (next > s.best) s.best = next;
        if (!last) s.runTop = Math.max(s.runTop, next);
        if (!last) rollBoss(s);
        // 챌린지 목표를 넘었으면 제약이 풀리고 보상
        const cd = checkChal(s);
        if (cd) queued.current.push({ name: cd.name, seed: "", color: "#f9a8d4", chal: cd });
        // 알림은 처음 가 보는 스테이지에서 이겼을 때만 (변이 뒤 다시 오를 때는 조용히 — 조각은 컴파일 막대에 쌓임)
        if (fresh) {
          pendingReward.current = {
            name: wasApex ? `${ax.def.role} ${ax.def.name}${tierLabel(ax.tier)}` : def.name,
            seed: wasApex ? ax.def.id : def.id,
            color: wasApex ? ax.def.color : def.color,
            frag: got.frag,
            key: got.key,
            apex: got.opened
              ? {
                  index: ax.index,
                  trait: ax.def.trait,
                  effect: ax.def.cur(s.byp[ax.index]),
                  look: ax.def.look,
                }
              : undefined,
            core: core ? s.cores : undefined,
          };
        }
        persist();
      } else {
        gainData(s, mobData(s.stage, st));
        s.kills = Math.min(MOBS_PER_STAGE, s.kills + 1);
        s.rec.files++;
      }
      enemy.current = spawn(s);
      // 상위 보스 · 최종 보스는 앞 보스 격퇴 연출이 끝난 뒤에 등장 연출 (틱에서)
      if (enemy.current.boss && !apexIntro.current && !finalIntro.current)
        startCinema("appear", s.stage, enemy.current.apex, enemy.current.final);
      bossLeft.current = timeFor(enemy.current, save.current);
      // 백도어 이월: 남은 피해를 새 적에게 (이것만으로 쓰러지면 바로 다음으로)
      if (over > 0) {
        const ne = enemy.current;
        ne.hp -= over;
        if (ne.hp <= 0) {
          ne.carryKill = true;
          damageRef.current(0);
        }
      }
    },
    [persist, startCinema]
  );
  useEffect(() => {
    damageRef.current = damage;
  }, [damage]);

  /**
   * 코드 한 발이 적에게 닿음 — 코드 모듈 공격 효과를 붙여 피해 (부트 선점 · 약점 분석 · 취약점 노출 · 점화 ·
   * 러브레터 미끼 · 암호화 잠금). 준 피해를 돌려줌
   */
  const strike = useCallback(
    (crit: boolean, now: number) => {
      const s = save.current;
      const e = enemy.current;
      const st = stats(s);
      const fx = st.fx;
      let dmg = st.dmg * (crit ? st.critMul : 1) * (e.boss ? st.bossDmgMul : 1);
      if (e.fresh && fx.first > 1) dmg *= fx.first;
      e.fresh = false;
      if (fx.stackMax) {
        dmg *= 1 + fx.stack * e.stacks;
        e.stacks = Math.min(fx.stackMax, e.stacks + 1);
      }
      if (buffUntil.current > now) dmg *= 1 + fx.buff;
      if (crit && fx.buff) buffUntil.current = now + BUFF_MS;
      if (fx.burn) e.burnUntil = now + BURN_SECS * 1000;
      // 러브레터 미끼: 준 피해만큼 이 적의 데이터를 미리
      if (fx.leech) gainData(s, e.reward * fx.leech * (Math.min(dmg, Math.max(0, e.hp)) / e.max));
      // 암호화 잠금: 보스에게 익스플로잇이 터지면 제한 시간 + (전투당 상한)
      if (crit && e.boss && fx.lockT && e.locked < fx.lockCap) {
        const g = Math.min(fx.lockT, fx.lockCap - e.locked);
        e.locked += g;
        bossLeft.current += g;
      }
      damage(dmg);
      return dmg;
    },
    [damage]
  );

  /**
   * 시간에 따라 붙는 피해 — 점화(불타는 동안) · DDoS 폭격(ddosEvery 초마다 한 방). 쏜 피해의 기댓값(baseDps) 기준
   * DDoS 가 터졌으면 그 피해를 돌려줌
   */
  const tickEffects = useCallback(
    (dt: number, now: number) => {
      const st = stats(save.current);
      const fx = st.fx;
      const bossMul = () => (enemy.current.boss ? st.bossDmgMul : 1);
      if (fx.burn && enemy.current.burnUntil > now) damage(baseDps(st) * fx.burn * bossMul() * dt);
      if (!fx.ddosEvery) return 0;
      ddosAcc.current += dt;
      if (ddosAcc.current < fx.ddosEvery) return 0;
      ddosAcc.current -= fx.ddosEvery;
      const hit = baseDps(st) * fx.ddosMul * bossMul();
      damage(hit);
      return hit;
    },
    [damage]
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
        const awaySecs = (Date.now() - s.savedAt) / 1000;
        if (awaySecs >= 60) s.rec.offMax = Math.max(s.rec.offMax, awaySecs);
        const gain = offlineGain(s, awaySecs);
        if (gain.data > 0) {
          gainData(s, gain.data);
          s.rec.offData += gain.data;
          setAway(gain);
        }
      }
      pending.current = [];
      atkAcc.current = 0;
      setShots([]);
      setFloats([]);
      cinemaRef.current = null;
      pendingReward.current = null;
      queued.current = [];
      enemy.current = spawn(save.current);
      if (enemy.current.boss)
        startCinema("appear", save.current.stage, enemy.current.apex, enemy.current.final);
      bossLeft.current = timeFor(enemy.current, save.current);
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
    setDetail(null);
    setToasts([]);
    setScene("title");
    sync();
  };

  const newGame = () => {
    if (!hasProgress(save.current)) return startPlay(true);
    setAsk({
      title: "새 게임을 시작할까요?",
      body: "지금까지의 진행(루트 권한 · 모듈 포함)이 모두 지워져요.",
      yes: "새 게임",
      danger: true,
      onYes: () => startPlay(true),
    });
  };

  const wipe = () =>
    setAsk({
      title: "저장 데이터를 모두 지울까요?",
      body: "되돌릴 수 없어요.",
      yes: "모두 지우기",
      danger: true,
      onYes: wipeNow,
    });
  const wipeNow = () => {
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
      startCinema("fail", s.stage, enemy.current.apex, enemy.current.final);
      if (cinemaRef.current) duckBgm.current();
      s.bossFail = true;
      s.rec.fails++;
      enemy.current = spawn(s);
      bossLeft.current = timeFor(enemy.current, save.current);
    };
    /** 자동 최적 업그레이드 (크론 데몬) — 1초마다 */
    let lastAuto = 0;
    /** 마지막 업적 확인 · 마지막 챌린지 알림 */
    let lastAch = 0;
    let lastQueued = 0;
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
    /** 한 번 발사할 때 나가는 코드 수 (자가 복제 추가 발사 · 매크로 연사) */
    const volley = (st: ReturnType<typeof stats>) => {
      let n = 1 + st.fx.extraN + (Math.random() < st.fx.extraP ? 1 : 0);
      shotCount.current++;
      if (st.fx.burstEvery && shotCount.current % st.fx.burstEvery === 0) n += 2;
      return n;
    };
    const fastForward = (secs: number) => {
      const step = 0.1;
      const start = performance.now() - secs * 1000;
      for (let t = 0; t < secs && !cinemaRef.current; t += step) {
        const s = save.current;
        const st = stats(s);
        const at = start + t * 1000;
        atkAcc.current += st.aps * step;
        for (let k = 0; atkAcc.current >= 1 && k < 200 && !cinemaRef.current; k++) {
          atkAcc.current -= 1;
          for (let j = volley(st); j > 0 && !cinemaRef.current; j--)
            strike(Math.random() < st.critChance, at);
        }
        if (!cinemaRef.current) tickEffects(step, at);
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
      s.rec.play += real;
      // 업적은 1초마다 확인 (새 업적은 위 막대 🏅 에 느낌표)
      if (now - lastAch >= 1000) {
        lastAch = now;
        checkAch(s);
      }
      // 보스 연출 중엔 멈춤, 끝나면 (격퇴였으면) 보상 창
      const c = cinemaRef.current;
      if (c) {
        if (now < c.until) {
          sync();
          return;
        }
        cinemaRef.current = null;
      }
      if (!cinemaRef.current && apexIntro.current) {
        apexIntro.current = false;
        startCinema("appear", s.stage, true);
      }
      if (!cinemaRef.current && finalIntro.current) {
        finalIntro.current = false;
        startCinema("appear", s.stage, false, true);
      }
      if (!cinemaRef.current && pendingReward.current) {
        pushToast(pendingReward.current);
        pendingReward.current = null;
      }
      if (!cinemaRef.current && queued.current.length && now - lastQueued >= 900) {
        lastQueued = now;
        pushToast(queued.current.shift()!);
      }
      if (cinemaRef.current) {
        sync();
        return;
      }
      // 틱이 늦게 왔으면 밀린 시간을 먼저 계산
      if (real - dt > 0.15) fastForward(real - dt);
      runAuto(s);
      const st = stats(s);
      // 발사: 공격 속도만큼 코드를 쏘고, SHOT_MS 뒤에 닿음
      atkAcc.current += st.aps * dt;
      const launched: Shot[] = [];
      while (atkAcc.current >= 1 && launched.length < 40) {
        atkAcc.current -= 1;
        // 자가 복제 · 매크로 연사로 한 번에 여러 발 (조금씩 다른 높이로)
        for (let j = volley(st); j > 0; j--) {
          const id = ++floatId.current;
          const crit = Math.random() < st.critChance;
          pending.current.push({ id, landAt: now + SHOT_MS + j * 30, crit });
          launched.push({
            id,
            glyph: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
            crit,
            dy: Math.round((Math.random() - 0.5) * 24) + (j > 1 ? (j % 2 ? 14 : -14) : 0),
          });
        }
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
          const dmg = strike(p.crit, now);
          if (i < 3) addFloat(fmt(dmg), p.crit);
        });
      }
      // 점화 · DDoS 폭격
      if (!cinemaRef.current) {
        const ddos = tickEffects(dt, now);
        if (ddos > 0) addFloat(`💣 ${fmt(ddos)}`, true);
      }
      if (enemy.current.boss) {
        bossLeft.current -= dt;
        if (bossLeft.current <= 0) failBoss(s);
      }
      // 연출 없이 격퇴했으면 (탭이 가려져 있던 중) 보상 창은 바로
      if (!cinemaRef.current && pendingReward.current) {
        pushToast(pendingReward.current);
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
  }, [scene, strike, tickEffects, addFloat, persist, sync, startCinema, checkEvolve, pushToast]);

  /** 업그레이드 사기 — ×1 · ×10 · 최대 (×10 은 10번 다 살 수 있을 때만) */
  const buy = useCallback(
    (u: UpgDef) => {
      const s = save.current;
      const n = buyMode === "max" ? Infinity : buyMode;
      const before = evoStage(s.lv);
      if (!buyUpgrade(s, u, n)) return;
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

  /** 스테이지 고르기 (1 ~ 이번 회차에 오른 가장 높은 스테이지) — 파일부터 다시 */
  const moveStage = (d: number) => {
    const sv = save.current;
    if (!gotoStage(sv, sv.stage + d)) return;
    pending.current = [];
    setShots([]);
    cinemaRef.current = null;
    apexIntro.current = false;
    finalIntro.current = false;
    enemy.current = spawn(sv);
    bossLeft.current = timeFor(enemy.current, sv);
    persist();
    sync();
  };
  /** 스테이지 반복 켜기 · 끄기 */
  const toggleRepeat = () => {
    save.current.repeat = !save.current.repeat;
    persist();
    sync();
  };

  const retryBoss = () => {
    const s = save.current;
    s.bossFail = false;
    enemy.current = spawn(s);
    if (enemy.current.boss) startCinema("appear", s.stage, enemy.current.apex, enemy.current.final);
    bossLeft.current = timeFor(enemy.current, save.current);
    sync();
  };

  const doFormat = () => {
    const s = save.current;
    if (!canFormat(s)) return;
    setAsk({
      title: "☣️ 변이할까요?",
      body: `지금 몸(업그레이드 · 데이터)을 버리고 새 변종으로 스테이지 ${formatStart(s.best)}부터 다시 퍼져요.\n루트 권한 +${fmt(pendingRoot(s))}을 받아요 (빼앗은 모듈 · 우회 기술 · 루트 상점은 그대로).${s.chal ? "\n진행 중인 챌린지는 보상 없이 끝나요." : ""}`,
      yes: "변이하기",
      onYes: formatNow,
    });
  };
  const formatNow = () => {
    const s = save.current;
    if (!canFormat(s)) return;
    reborn(format(s));
  };
  /** 변이 · 챌린지 시작 뒤 새 몸으로 */
  const reborn = (next: Save) => {
    save.current = next;
    pending.current = [];
    enemy.current = spawn(save.current);
    bossLeft.current = timeFor(enemy.current, save.current);
    persist();
    sync();
  };

  /** 챌린지 변이 시작 — 스테이지 1부터 제약을 걸고 */
  const doChal = (key: ChalKey) => {
    const s = save.current;
    const d = CHAL.find((c) => c.key === key)!;
    if (!chalOpen(s) || s.chalDone.includes(key) || s.chal) return;
    const root = pendingRoot(s);
    setAsk({
      title: `${d.icon} 챌린지 「${d.name}」`,
      body: `제약: ${d.rule}\n목표: 스테이지 ${d.goal} 돌파 → ${d.reward} · 🧩 커널 코어 +1\n\n지금 몸(업그레이드 · 데이터)을 버리고 스테이지 1부터 시작해요${root > 0 ? ` (루트 권한 +${fmt(root)}은 받아요)` : ""}. 목표를 넘으면 제약이 풀리고 그대로 이어서 해요.`,
      yes: "도전하기",
      onYes: () => {
        const cur = save.current;
        if (!chalOpen(cur) || cur.chalDone.includes(key) || cur.chal) return;
        reborn(startChal(cur, key));
      },
    });
  };
  const quitChal = () => {
    const d = CHAL.find((c) => c.key === save.current.chal);
    if (!d) return;
    setAsk({
      title: "챌린지를 포기할까요?",
      body: `「${d.name}」 제약이 풀리고 지금 스테이지에서 그대로 이어서 해요. 보상은 받지 못해요 (나중에 다시 도전할 수 있어요).`,
      yes: "포기하기",
      danger: true,
      onYes: () => {
        save.current.chal = null;
        persist();
        sync();
      },
    });
  };

  /** 기록 창 열기 — 새 업적은 NEW 표시로 보여 주고, 본 것으로 (위 막대 🏅 느낌표가 꺼짐) */
  const openRecords = () => {
    const cur = save.current;
    setFreshAch(cur.ach.slice(cur.achSeen));
    if (cur.achSeen !== cur.ach.length) {
      cur.achSeen = cur.ach.length;
      persist();
      sync();
    }
    setOverlay("records");
  };

  /** 백업 불러오기 — 확인 뒤 저장본을 바꾸고 시작 화면으로 */
  const askImport = (next: Save) =>
    setAsk({
      title: "백업을 불러올까요?",
      body: `스테이지 ${next.stage} · 최고 ${Math.min(next.best, MAX_STAGE)} · 루트 권한 ${fmt(next.root)} · 업적 ${next.ach.length}개\n지금 진행은 이 백업으로 바뀌어요.`,
      yes: "불러오기",
      danger: true,
      onYes: () => {
        next.savedAt = Date.now();
        save.current = next;
        cinemaRef.current = null;
        pendingReward.current = null;
        queued.current = [];
        persist();
        setDetail(null);
        setToasts([]);
        setOverlay(null);
        setScene("title");
        sync();
      },
    });

  // 게임 화면 단축키: Esc 메뉴 · 1~3 업그레이드 · Q W E 랜덤 강화 · C 최적 업그레이드(크론잡)
  useEffect(() => {
    if (scene !== "play") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat && e.code === "Escape") return;
      if (e.code === "Escape") {
        e.preventDefault();
        if (ask) setAsk(null);
        else if (detail) setDetail(null);
        else if (intro.length) setIntro((q) => q.slice(1));
        else if (away) setAway(null);
        else setOverlay((o) => (o ? null : "menu"));
        return;
      }
      if (overlay || detail || away || ask || intro.length) return;
      // F: 컴파일
      if (e.code === "KeyF") doCompile((sv) => compileAll(sv));
      const n = Number(e.key);
      if (n >= 1 && n <= UPGRADES.length) buy(UPGRADES[n - 1]);
      if (e.code === "KeyC") runCron();
      const f = RAND_KEYS.indexOf(e.code);
      if (f >= 0 && f < UPGRADES.length) doRand(UPGRADES[f].key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scene, overlay, detail, away, ask, intro, buy, doRand, runCron, doCompile]);

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
  const mods = s.mods;
  const owned = mods.filter((m) => m > 0).length;
  /** 상위 보스에게서 빼앗은 우회 기술 수 */
  const bypassN = s.byp.filter((v) => v > 0).length;
  /** 우회 기술 버전 (못 잡은 것은 0) */
  const bv = s.byp;
  // 내 바이러스와 날아가는 코드의 색: 버전이 가장 높은 코드 모듈의 색 (없으면 기본 초록)
  const topMod = owned ? mods.indexOf(Math.max(...mods)) : -1;
  const myColor = topMod >= 0 ? ROSTER[topMod].color : ACCENT;
  const boss = bossOf(s);
  const apex = apexOf(s.stage);
  const file = FILE_TYPES[e.file];
  /** 이 적의 제한 시간 (막대 길이용) */
  const timeMax = timeFor(e, s);
  /** 상위 보스를 처음 잡을 때마다 붙은 외형 (그 보스 색) */
  const parts = APEX.slice(0, apexCount(s.apexBest)).map((a) => a.color);
  const stage = evoStage(s.lv);
  /** 내 바이러스 몸 둘레에 붙는 모듈 조각 (빼앗은 보스의 색) */
  const modColors = ROSTER.map((v, i) => (mods[i] ? v.color : null));
  /** 지금 적에게 들어가는 예상 초당 피해 */
  const curDps = dps(st) * (e.boss ? st.bossDmgMul * st.fxBossMul : 1);
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
  const achN = s.ach.length;
  /** 아직 기록 창에서 못 본 새 업적 수 */
  const achNew = Math.max(0, achN - s.achSeen);
  /** 진행 중인 챌린지 */
  const chal = CHAL.find((c) => c.key === s.chal) ?? null;
  /** 지금 띄울 새 모듈 소개 (자세히 보기 · 오프라인 수익 창이 없을 때) */
  const introNow = !detail && !away && intro.length ? intro[0] : null;
  const closeDetail = () => {
    if (detail) setDetail(null);
    else if (introNow != null) setIntro((q) => q.slice(1));
    else setAway(null);
  };
  /** 코드 모듈 하나를 모인 조각으로 컴파일 (자세히 보기 — 버튼의 data-mod) */
  const onCompileModule = (ev: React.MouseEvent<HTMLButtonElement>) => {
    const i = Number(ev.currentTarget.dataset.mod);
    doCompile((sv) => (compileMod(sv, i) ? [{ kind: "mod", i, to: sv.mods[i] }] : []));
  };
  // 컴파일 막대: 지금 「컴파일」을 누르면 오를 것
  const ready = s.shop.autoc || scene !== "play" ? [] : compileReady(s);
  const lootSum = s.frag.reduce((a, b) => a + b, 0) + s.keys.reduce((a, b) => a + b, 0);
  const showBar = ready.length > 0 && lootSum > barHidden;
  const itemName = (c: CompileItem) =>
    c.kind === "mod"
      ? `${ROSTER[c.i].icon} ${ROSTER[c.i].module} v${c.to}`
      : `🛡️ ${APEX[c.i].trait} v${c.to}`;

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
      {
        key: "records",
        label: "기록",
        en: "RECORDS",
        sub: `업적 ${achN}/${ACH.length}${achNew ? " · NEW" : ""}`,
        run: openRecords,
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
      { key: "backup", label: "세이브 백업", en: "BACKUP", run: () => setOverlay("backup") },
      {
        key: "fs",
        label: fs ? "창 모드" : "전체화면",
        en: fs ? "WINDOW" : "FULLSCREEN",
        run: toggleFs,
      },
    ],
    // newGame은 매 렌더 새로 만들어지지만 save.current만 읽어서 결과가 같음
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [progress, s.stage, s.root, owned, achN, achNew, fs, startPlay, toggleFs]
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
    { key: "bypass", label: "우회 기술", short: "우회", badge: `${bypassN}/${APEX.length}` },
    {
      key: "shop",
      label: "루트 상점",
      short: "상점",
      badge: rootLeft(s) > 0 ? `🔑${fmt(rootLeft(s))}` : undefined,
    },
    {
      key: "format",
      label: "☣️ 변이",
      short: "변이",
      badge: formatReady ? `+${fmt(rootGain)}` : undefined,
    },
  ];

  return (
    <section className="mx-auto w-full max-w-[1280px] px-4 pb-16 text-left">
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
            : "vg-window h-[min(720px,calc(100svh-110px))] min-h-[540px] rounded-3xl border border-emerald-400/20"
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
            blocked={overlay !== null || ask !== null}
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
                {chal && (
                  <button
                    type="button"
                    onClick={() => pickTab("format")}
                    title={`챌린지 「${chal.name}」: ${chal.rule} — 스테이지 ${chal.goal} 돌파하면 성공`}
                    className="ml-1.5 rounded-full border border-pink-300/50 bg-pink-400/15 px-1.5 vt-xs font-bold text-pink-100"
                  >
                    {chal.icon}
                    <span className="hidden @md/vg:inline"> {chal.name}</span> → {chal.goal}
                  </button>
                )}
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
                <button
                  type="button"
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={openRecords}
                  title={achNew ? `새 업적 ${achNew}개` : `업적 ${achN}/${ACH.length}`}
                  aria-label={achNew ? `업적 — 새 업적 ${achNew}개` : "업적"}
                  className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-black/50 text-base transition-colors hover:border-amber-300/70 ${
                    achNew ? "border-amber-300/70" : "border-white/15"
                  }`}
                >
                  <span aria-hidden>🏅</span>
                  {achNew > 0 && (
                    <span className="vg-ach-new absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 font-sans text-[11px] leading-none font-black text-white shadow-[0_0_8px_rgba(244,63,94,0.8)]">
                      !
                    </span>
                  )}
                </button>
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
                title="공격력 × 초당 발사 × 익스플로잇 평균 × 코드 모듈 효과 평균 (보스면 보스 피해 배율 · 약점 분석 최대 중첩까지)"
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
                {/* 지금 붙어 있는 공격 효과 */}
                {(view.exposed || view.burning || e.stacks > 0) && (
                  <div className="mt-0.5 flex gap-1.5 vt-xs font-bold">
                    {view.exposed && <span className="text-orange-200">🔓 노출</span>}
                    {view.burning && <span className="text-red-300">🔥 점화</span>}
                    {e.stacks > 0 && (
                      <span className="text-slate-200" title="약점 분석 중첩">
                        🎯 {e.stacks}
                      </span>
                    )}
                  </div>
                )}
              </div>
              {cinema && <BossCinema c={cinema} />}
              {/* 오른쪽 위: 스테이지 고르기 · 반복 */}
              <div className={`absolute top-2 right-3 z-10 flex flex-col items-end gap-1 ${KR}`}>
                <div className="flex items-center overflow-hidden rounded-lg border border-white/15 bg-black/55">
                  <button
                    type="button"
                    onClick={() => moveStage(-1)}
                    disabled={s.stage <= 1}
                    aria-label="이전 스테이지"
                    title="이전 스테이지로 (파일부터 다시)"
                    className="px-2 py-1 font-mono vt-sm text-white/85 enabled:hover:bg-white/10 disabled:opacity-30"
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    onClick={toggleRepeat}
                    aria-pressed={s.repeat}
                    title={`스테이지 반복: 보스를 잡아도 이 스테이지에 머물러요.\n이번 회차에 이미 지나온 스테이지에서는 코드 조각 · 우회 키가 보스를 잡는 데 걸린 시간에 비례한 확률로만 나와요 (${BAL.revisitSecs}초 이상이면 100%, 한 방에 잡히면 거의 0%).`}
                    className={`border-x border-white/15 px-2 py-1 vt-xs font-bold whitespace-nowrap ${
                      s.repeat ? "bg-sky-400/25 text-sky-100" : "text-white/80 hover:bg-white/10"
                    }`}
                  >
                    🔁 {s.repeat ? "반복 ON" : "반복"}
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStage(1)}
                    disabled={s.stage >= s.runTop}
                    aria-label="다음 스테이지"
                    title="다음 스테이지로 (이번 회차에 오른 곳까지)"
                    className="px-2 py-1 font-mono vt-sm text-white/85 enabled:hover:bg-white/10 disabled:opacity-30"
                  >
                    ▶
                  </button>
                </div>
                {s.stage < s.runTop && (
                  <span
                    className="rounded-md bg-black/55 px-1.5 vt-xs text-sky-200"
                    title={`보스를 ${BAL.revisitSecs}초 이상 걸려 잡으면 조각 100%`}
                  >
                    ↺ 다시 도는 중
                    <span className="hidden @xl/vg:inline">
                      {" "}
                      · 조각 확률 = 보스 전투 시간 ÷ {BAL.revisitSecs}초
                    </span>
                  </span>
                )}
              </div>
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
                        parts={parts}
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
                      · 모듈 {owned}/{ROSTER.length} · 우회 {bypassN}/{APEX.length}
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
                    className={`relative ${view.burning && !dying && !failing ? "vg-burn" : ""} ${
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
                          {dying.apex != null ? (
                            <ApexSprite index={dying.apex} color={dying.color} size={150} />
                          ) : (
                            <VirusSprite seed={dying.seed} color={dying.color} size={140} />
                          )}
                        </div>
                        <BossShards c={dying} />
                      </>
                    ) : failing ? (
                      <div className="vg-sprite vg-boss">
                        {failing.apex != null ? (
                          <ApexSprite index={failing.apex} color={failing.color} size={150} />
                        ) : (
                          <VirusSprite seed={failing.seed} color={failing.color} size={140} />
                        )}
                      </div>
                    ) : e.final ? (
                      <div className="vg-sprite vg-boss">
                        <ApexSprite index={10} color={FINAL.color} size={170} hit={hitNow} />
                      </div>
                    ) : e.apex ? (
                      <div className="vg-sprite vg-boss">
                        <ApexSprite
                          index={apex.index}
                          color={apex.def.color}
                          size={150}
                          hit={hitNow}
                        />
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
                    ) : e.final ? (
                      <b style={{ color: FINAL.color }}>
                        {FINAL.icon} {FINAL.role} {FINAL.name + tierLabel(s.clears + 1)}{" "}
                        <span className="vt-xs font-mono font-normal text-white/75">최종 보스</span>
                      </b>
                    ) : e.apex ? (
                      <b style={{ color: apex.def.color }}>
                        {apex.def.icon} {apex.def.role} {apex.def.name + tierLabel(apex.tier)}{" "}
                        <span className="vt-xs font-mono font-normal text-white/75">상위 보스</span>
                      </b>
                    ) : e.boss ? (
                      <b style={{ color: boss.def.color }}>
                        ☠️ {boss.def.name}{" "}
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
                  className={`vg-evo absolute top-12 left-1/2 z-10 -translate-x-1/2 rounded-full border border-emerald-300/60 bg-emerald-950/90 px-4 py-1.5 vt-sm whitespace-nowrap text-emerald-100 shadow-[0_0_24px_rgba(74,222,128,0.45)] ${KR}`}
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

              {/* 컴파일 막대 */}
              {showBar && !cinema && (
                <div
                  className={`vg-compile absolute inset-x-3 bottom-11 z-20 mx-auto flex max-w-[560px] items-center gap-2 rounded-xl border border-emerald-300/40 bg-[#07130d]/95 px-3 py-2 shadow-[0_0_18px_rgba(74,222,128,0.25)] ${KR}`}
                >
                  <span className="min-w-0 flex-1 truncate vt-sm text-white/90">
                    🧬 {ready.map(itemName).join(" · ")}
                  </span>
                  <button
                    type="button"
                    onClick={() => doCompile((sv) => compileAll(sv))}
                    className="shrink-0 rounded-lg bg-emerald-400 px-3 py-1 vt-xs font-bold text-black hover:bg-emerald-300"
                  >
                    컴파일<span className="ml-1 hidden font-mono opacity-70 md:inline">F</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBarHidden(lootSum)}
                    aria-label="컴파일 막대 닫기 (조각이 더 모이면 다시 떠요)"
                    title="닫기 — 조각이 더 모이면 다시 떠요"
                    className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full border border-white/25 bg-[#07130d] vt-xs text-white/80 hover:text-white"
                  >
                    ✕
                  </button>
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
                        style={{ width: `${(left / timeMax) * 100}%` }}
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
                className="flex flex-wrap items-end gap-x-1 overflow-hidden px-2 pt-2 @md/panel:px-3 @lg/panel:px-4"
              >
                <div className="flex shrink-0 items-end gap-0.5 @md/panel:gap-1">
                  {tabs.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => pickTab(t.key)}
                      className={`shrink-0 rounded-t-lg border-x border-t px-1.5 py-1.5 vt-sm font-bold whitespace-nowrap transition-colors @md/panel:px-2 @lg/panel:px-3 ${KR} ${
                        tab === t.key
                          ? "border-emerald-400/30 bg-emerald-400/10 text-white"
                          : "border-transparent text-white/70 hover:text-white/80"
                      }`}
                    >
                      <span className="@lg/panel:hidden">{t.short ?? t.label}</span>
                      <span className="hidden @lg/panel:inline">{t.label}</span>
                      {t.badge && (
                        <span
                          className={`ml-1.5 font-mono vt-xs ${t.key === "module" || t.key === "bypass" || t.key === "shop" ? "hidden @lg/panel:inline" : ""} ${
                            t.key === "format" ? "text-amber-200" : "text-white/70"
                          }`}
                        >
                          {t.key === "format" ? (
                            // 좁으면 점만 (받을 루트 권한이 커지면 숫자가 길어져 탭 줄이 넘침)
                            <>
                              <span className="@lg/panel:hidden" aria-hidden>
                                ●
                              </span>
                              <span className="hidden @lg/panel:inline">{t.badge}</span>
                            </>
                          ) : (
                            t.badge
                          )}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1.5 pb-1">
                  {tab === "shop" && (
                    <div className={`flex overflow-hidden rounded-lg border border-white/20 ${KR}`}>
                      {(
                        [
                          ["power", "⚔️", "효율 강화"],
                          ["util", "🛠️", "편의성"],
                          ...(s.clears > 0 || s.cores > 0
                            ? ([["core", "🧩", `커널 ${s.cores}`]] as const)
                            : []),
                        ] as const
                      ).map(([k, icon, label]) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => {
                            setShopCat(k);
                            setPage(0);
                            setPages(1);
                          }}
                          aria-pressed={shopCat === k}
                          title={label}
                          className={`vt-xs px-2 py-1 font-bold whitespace-nowrap transition-colors ${
                            shopCat === k
                              ? "bg-amber-300/20 text-amber-100"
                              : "text-white/75 hover:text-white"
                          }`}
                        >
                          {icon}
                          <span className="ml-1 hidden @md/panel:inline">{label}</span>
                        </button>
                      ))}
                    </div>
                  )}
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
                      // 챌린지 제약으로 못 사는 것
                      const locked = upgLocked(s, u.key);
                      const rLocked = randLocked(s, u.key);
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
                              disabled={locked || s.data < cost}
                              aria-label={`${u.name} 업그레이드 ${locked ? "봉인됨" : fmtBytes(cost)}`}
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
                                {locked ? "🔒 봉인" : fmtBytes(cost)}
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
                              disabled={rLocked || s.data < price}
                              aria-label={`${u.rand} ${rLocked ? "봉인됨" : fmtBytes(price)}`}
                              className={`relative flex h-10 min-w-[74px] shrink-0 flex-col items-center justify-center rounded-lg border px-2 transition-colors enabled:active:bg-violet-400/25 ${
                                randTop
                                  ? "border-violet-100 bg-violet-400/30 shadow-[0_0_14px_rgba(167,139,250,0.65)]"
                                  : "border-violet-300/40 bg-violet-400/10"
                              }`}
                            >
                              {randTop && <AdviceBadge />}
                              <span className="vt-xs leading-none text-violet-200/90">🎲 +1~3</span>
                              <span className="mt-0.5 font-mono vt-sm font-bold text-violet-200">
                                {rLocked ? "🔒 봉인" : fmtBytes(price)}
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
                              disabled={locked || s.data < cost}
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
                                  {locked ? "🔒 봉인" : fmtBytes(cost)}
                                  {!locked && many > 1 && (
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
                              disabled={rLocked || s.data < price}
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
                                {rLocked ? "🔒 봉인" : fmtBytes(price)}
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
                      const joined = v.join <= Math.max(s.best - 1, s.stage);
                      const cost = fragCost(lv);
                      const own = s.frag[i];
                      const ownUp = planMod(s, i).to > lv;
                      const ownPct = Math.min(100, (own / cost) * 100);
                      return (
                        <div
                          key={v.id}
                          className="flex flex-col gap-1 rounded-xl border px-2 py-1.5"
                          style={{
                            borderColor: lv ? `${v.color}66` : "rgba(255,255,255,0.12)",
                            background: lv ? `${v.color}12` : "transparent",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setDetail({ kind: "mod", i })}
                            className="flex min-w-0 items-center gap-2 text-left"
                            title={
                              lv
                                ? `${v.module} v${lv}: ${v.cur(lv)} — ${v.effect}`
                                : joined
                                  ? `${v.name}을 잡아 조각을 모으면 열려요`
                                  : `스테이지 ${v.join}에 합류`
                            }
                          >
                            <div className={`shrink-0 ${lv ? "" : "opacity-30 grayscale"}`}>
                              <VirusSprite seed={v.id} color={v.color} size={26} />
                            </div>
                            <div className={`min-w-0 ${KR}`}>
                              <div className="truncate vt-sm font-bold text-white/90">
                                {lv || joined ? `${v.icon} ${v.module}` : "??? 모듈"}
                                {lv > 0 && (
                                  <span className="ml-1 font-mono vt-xs text-white/75">v{lv}</span>
                                )}
                              </div>
                              <div className="truncate vt-xs text-white/70">
                                {lv ? v.cur(lv) : joined ? v.name : `스테이지 ${v.join} 합류`}
                              </div>
                            </div>
                          </button>
                          {joined && (
                            <div className="flex items-center gap-1.5">
                              <div
                                className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"
                                title={`조각 ${own} / ${cost}`}
                              >
                                <div
                                  className="absolute inset-y-0 left-0 rounded-full"
                                  style={{ width: `${ownPct}%`, background: v.color }}
                                />
                              </div>
                              <span className="font-mono vt-xs text-white/75 tabular-nums">
                                {own}/{cost}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  doCompile((sv) => {
                                    const n = compileMod(sv, i);
                                    return n ? [{ kind: "mod", i, to: sv.mods[i] }] : [];
                                  })
                                }
                                disabled={!ownUp}
                                aria-label={`${v.module} 컴파일`}
                                title="모인 조각으로 컴파일"
                                className="rounded-md border border-emerald-300/50 bg-emerald-400/15 px-1.5 vt-xs font-bold text-emerald-100 enabled:hover:bg-emerald-400/25 disabled:opacity-35"
                              >
                                ▲
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  />
                )}

                {tab === "bypass" && (
                  <FitPages
                    page={page}
                    onPages={onPages}
                    className="grid grid-cols-2 gap-2 @2xl/panel:grid-cols-5"
                    items={APEX.map((a, i) => {
                      const v = bv[i];
                      const got = v > 0;
                      const cost = keyCost(Math.max(1, v));
                      const ready = got && s.keys[i] >= cost;
                      return (
                        <div
                          key={a.id}
                          className="flex flex-col gap-1 rounded-xl border px-2 py-1.5"
                          style={{
                            borderColor: got ? `${a.color}88` : "rgba(255,255,255,0.15)",
                            background: got ? `${a.color}14` : "transparent",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setDetail({ kind: "apex", i })}
                            className="flex min-w-0 items-center gap-2 text-left"
                            title={
                              got
                                ? `${a.role} ${a.name}: ${a.trait} v${v} — ${a.cur(v)} · 외형 ${a.look}`
                                : `스테이지 ${(i + 1) * 10}의 상위 보스를 잡으면 열려요`
                            }
                          >
                            <div className={`shrink-0 ${got ? "" : "opacity-30 grayscale"}`}>
                              <ApexSprite index={i} color={a.color} size={26} />
                            </div>
                            <div className={`min-w-0 ${KR}`}>
                              <div className="vt-sm truncate font-bold text-white/90">
                                {got ? `🛡️ ${a.trait}` : "??? 우회 기술"}
                                {got && (
                                  <span className="ml-1 font-mono vt-xs text-white/75">v{v}</span>
                                )}
                              </div>
                              <div className="vt-xs truncate text-white/75">
                                {got ? a.cur(v) : `${(i + 1) * 10}스테이지 상위 보스`}
                              </div>
                            </div>
                          </button>
                          {got && (
                            <div className="flex items-center gap-1.5">
                              <div
                                className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"
                                title={`우회 키 ${s.keys[i]} / ${cost}`}
                              >
                                <div
                                  className="absolute inset-y-0 left-0 rounded-full"
                                  style={{
                                    width: `${Math.min(100, (s.keys[i] / cost) * 100)}%`,
                                    background: a.color,
                                  }}
                                />
                              </div>
                              <span className="font-mono vt-xs text-white/75 tabular-nums">
                                🔑{s.keys[i]}/{cost}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  doCompile((sv) =>
                                    compileByp(sv, i) ? [{ kind: "byp", i, to: sv.byp[i] }] : []
                                  )
                                }
                                disabled={!ready}
                                aria-label={`${a.trait} 컴파일`}
                                className="rounded-md border border-emerald-300/50 bg-emerald-400/15 px-1.5 vt-xs font-bold text-emerald-100 enabled:hover:bg-emerald-400/25 disabled:opacity-35"
                              >
                                ▲
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  />
                )}

                {tab === "shop" && (
                  <FitPages
                    key={shopCat}
                    page={page}
                    onPages={onPages}
                    className={`grid grid-cols-2 gap-2 @2xl/panel:grid-cols-3 ${KR}`}
                    items={SHOP.filter((d) => d.group === shopCat).map((d) => {
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
                          title={`${d.desc} — 루트 권한을 써도 피해 보너스(×${fmt(st.rootMul)})는 줄지 않고, 변이해도 남아요${
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
                            disabled={maxed || locked || !canAffordShop(s, d)}
                            className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-amber-300/50 bg-amber-300/15 px-2 transition-colors enabled:hover:bg-amber-300/25 @2xl/panel:h-10 @2xl/panel:min-w-[74px] @2xl/panel:flex-col @2xl/panel:gap-0"
                          >
                            <span className="vt-xs leading-none text-amber-100/90">
                              {maxed ? "완료" : locked ? "🔒 잠김" : "구매"}
                            </span>
                            <span className="vt-sm font-mono font-bold text-amber-200">
                              {maxed
                                ? "MAX"
                                : locked
                                  ? `${reqName} 먼저`
                                  : isCoreItem(d)
                                    ? `🧩${cost}`
                                    : `🔑${fmt(cost)}`}
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
                            최고 스테이지 {Math.min(s.best, MAX_STAGE)}
                            {s.formats > 0 && <span> · 변이 {s.formats}번</span>}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={doFormat}
                          disabled={!formatReady}
                          className="vt-base shrink-0 rounded-xl border border-amber-300/50 bg-amber-300/15 px-4 py-2.5 font-bold text-amber-100 transition-colors enabled:hover:bg-amber-300/25"
                        >
                          ☣️ 변이
                          {rootGain > 0 && (
                            <span className="vt-sm block font-normal">
                              루트 권한 +{fmt(rootGain)}
                            </span>
                          )}
                        </button>
                      </div>,
                      <p key="state" className="vt-sm text-white/90">
                        {formatReady
                          ? "더 나아가기 힘들면 지금 변이하세요."
                          : s.stage < BAL.formatStage
                            ? `스테이지 ${BAL.formatStage}부터 변이할 수 있어요.`
                            : "최고 스테이지를 넘어서야 루트 권한이 늘어나요."}
                      </p>,
                      <p key="desc" className="vt-sm leading-relaxed text-white/75">
                        변이하면 지금 몸(업그레이드·데이터)을 버리고 새 변종으로 스테이지{" "}
                        {formatStart(s.best)}부터 다시 퍼져요. 루트 권한 1마다 피해가{" "}
                        {+(BAL.rootBonus * 100).toFixed(1)}% 늘어나요. 빼앗은 모듈과 루트 상점은
                        남아요.
                      </p>,
                      // 챌린지 변이 (첫 KILLSWITCH 격퇴 뒤)
                      chalOpen(s) ? (
                        <p key="chal-h" className="vt-base mt-1 font-bold text-pink-200">
                          🎯 챌린지 변이{" "}
                          <span className="vt-sm font-normal text-white/75">
                            {s.chalDone.length}/{CHAL.length} · 스테이지 1부터 제약을 걸고 목표까지
                          </span>
                        </p>
                      ) : (
                        <p key="chal-h" className="vt-sm text-white/75">
                          🎯 챌린지 변이: 스테이지 100을 돌파하면 열려요.
                        </p>
                      ),
                      ...(chalOpen(s)
                        ? CHAL.map((d) => {
                            const done = s.chalDone.includes(d.key);
                            const now = s.chal === d.key;
                            return (
                              <div
                                key={d.key}
                                className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 ${
                                  now
                                    ? "border-pink-300/70 bg-pink-400/10"
                                    : done
                                      ? "border-emerald-300/40 bg-emerald-400/[0.06]"
                                      : "border-white/10"
                                }`}
                              >
                                <span className="text-xl" aria-hidden>
                                  {d.icon}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="vt-sm block font-bold text-white">
                                    {d.name}
                                    <span className="ml-1.5 font-mono font-normal text-white/75">
                                      → 스테이지 {d.goal}
                                    </span>
                                  </span>
                                  <span className="vt-xs block text-white/75">{d.rule}</span>
                                  <span className="vt-xs block text-amber-200/90">
                                    보상: {d.reward} · 🧩 커널 코어 +1
                                  </span>
                                </span>
                                {now ? (
                                  <button
                                    type="button"
                                    onClick={quitChal}
                                    className="vt-sm shrink-0 rounded-lg border border-rose-300/50 px-2.5 py-1.5 font-bold text-rose-200 hover:bg-rose-400/10"
                                  >
                                    포기
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => doChal(d.key)}
                                    disabled={done || !!s.chal}
                                    className="vt-sm shrink-0 rounded-lg border border-pink-300/50 bg-pink-400/15 px-2.5 py-1.5 font-bold text-pink-100 transition-colors enabled:hover:bg-pink-400/25 disabled:opacity-60"
                                  >
                                    {done ? "✓ 성공" : "도전"}
                                  </button>
                                )}
                              </div>
                            );
                          })
                        : []),
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
              <MenuButton
                label="기록 (업적 · 통계)"
                sub={`${achN}/${ACH.length}${achNew ? " · NEW" : ""}`}
                onClick={openRecords}
              />
              <MenuButton label="게임 방법" onClick={() => setOverlay("guide")} />
              <MenuButton
                label="패치노트"
                sub={PATCH_NOTES[0].ver}
                onClick={() => setOverlay("notes")}
              />
              <MenuButton label="설정" onClick={() => setOverlay("settings")} />
              <MenuButton label="세이브 백업" onClick={() => setOverlay("backup")} />
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
            <ArchivePanel s={s} />
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
        {overlay === "records" && (
          <Window
            title="records.log"
            wide
            fill
            onClose={() => setOverlay(scene === "play" ? "menu" : null)}
          >
            <RecordsPanel s={s} fresh={freshAch} />
          </Window>
        )}
        {overlay === "backup" && (
          <Window
            title="backup.sh"
            wide
            onClose={() => setOverlay(scene === "play" ? "menu" : null)}
          >
            <BackupPanel s={s} onImport={askImport} />
          </Window>
        )}

        {/* ── 확인 창 ── */}
        {ask && (
          <div
            className="absolute inset-0 z-[60] flex items-center justify-center bg-black/65 p-4"
            onClick={() => setAsk(null)}
          >
            <div
              role="dialog"
              aria-modal
              className={`virus-pop w-full max-w-sm rounded-2xl border border-white/15 bg-[#0f1a14] p-6 text-center ${KR}`}
              onClick={(ev) => ev.stopPropagation()}
            >
              <p className="text-lg font-bold text-white">{ask.title}</p>
              <p className="vt-base mt-2 whitespace-pre-line text-white/85">{ask.body}</p>
              <div className="mt-5 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setAsk(null)}
                  className="vt-base rounded-full border border-white/25 px-5 py-2 font-bold text-white/90 hover:border-white/50"
                >
                  취소
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => {
                    const f = ask.onYes;
                    setAsk(null);
                    f();
                  }}
                  className={`vt-base rounded-full px-5 py-2 font-bold text-black ${
                    ask.danger ? "bg-rose-400 hover:bg-rose-300" : "bg-amber-300 hover:bg-amber-200"
                  }`}
                >
                  {ask.yes}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 격퇴 알림: 우측 상단에 잠깐 ── */}
        {scene === "play" && toasts.length > 0 && (
          <div
            className={`vg-toasts pointer-events-none absolute top-14 right-3 z-40 flex max-h-[calc(100%-4.5rem)] w-[min(320px,calc(100%-24px))] flex-col items-stretch gap-2 overflow-hidden ${KR}`}
          >
            {toasts.map(({ id, r }) => (
              <div
                key={id}
                className="vg-toast pointer-events-auto flex shrink-0 cursor-pointer items-start gap-2.5 rounded-xl border bg-[#0b130f]/95 px-3 py-2 shadow-lg"
                style={{
                  borderColor: `${r.color}88`,
                  animationDuration: r.apex ? "6.5s" : "4.5s",
                }}
                onClick={() => setToasts((ts) => ts.filter((x) => x.id !== id))}
              >
                <div className="shrink-0">
                  {r.chal ? (
                    <span
                      className="flex h-10 w-10 items-center justify-center text-3xl"
                      aria-hidden
                    >
                      {r.chal.icon}
                    </span>
                  ) : r.final ? (
                    <ApexSprite index={10} color={r.color} size={44} />
                  ) : r.apex ? (
                    <ApexSprite index={r.apex.index} color={r.color} size={40} />
                  ) : (
                    <VirusSprite seed={r.seed} color={r.color} size={38} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className="vt-sm break-keep [overflow-wrap:anywhere] font-bold"
                    style={{ color: r.color }}
                  >
                    {r.chal
                      ? `🎯 챌린지 성공 · ${r.name}`
                      : r.final
                        ? `최종 보스 ${r.name} 격퇴!`
                        : r.apex
                          ? `상위 보스 ${r.name} 처치!`
                          : `${r.name} 격퇴!`}
                  </div>
                  {r.chal && (
                    <div className="vt-xs break-keep [overflow-wrap:anywhere] text-white/90">
                      제약이 풀렸어요 · 보상 {r.chal.reward} · 🧩 커널 코어 +1
                    </div>
                  )}
                  {r.core != null && (
                    <div className="vt-xs break-keep [overflow-wrap:anywhere] text-amber-200">
                      🧩 100스테이지 돌파 · 커널 코어 +1 (보유 {r.core})
                    </div>
                  )}
                  {r.final && (
                    <div className="vt-xs break-keep [overflow-wrap:anywhere] text-white/90">
                      🧩 커널 코어 +1 (보유 {r.final.cores}) — 루트 상점 「커널」에서 써요. 다음
                      KILLSWITCH{tierLabel(r.final.clears + 1)}는 체력 ×{BAL.finalGrowth}
                    </div>
                  )}
                  {r.apex && (
                    <>
                      <div className="vt-xs break-keep [overflow-wrap:anywhere] text-white/90">
                        🛡️ {r.apex.trait} · {r.apex.effect}
                      </div>
                      <div className="vt-xs break-keep [overflow-wrap:anywhere] text-emerald-200">
                        🧬 외형 · {r.apex.look}
                      </div>
                    </>
                  )}
                  {r.frag && (
                    <div className="vt-xs break-keep [overflow-wrap:anywhere] text-white/90">
                      {ROSTER[r.frag.index].icon} {ROSTER[r.frag.index].module} 조각 +{r.frag.n}
                    </div>
                  )}
                  {r.key && (
                    <div className="vt-xs break-keep [overflow-wrap:anywhere] text-white/90">
                      🔑 {APEX[r.key.index].trait} 우회 키 +{r.key.n}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── 모듈 · 우회 기술 크게 보기 · 새 모듈 소개 · 오프라인 수익 ── */}
        {scene === "play" && (detail || away || introNow != null) && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={closeDetail}
          >
            <div
              className={`virus-pop max-h-full w-full max-w-sm overflow-hidden rounded-2xl border border-white/15 bg-[#0f1a14] p-5 text-center ${KR}`}
              onClick={(ev) => ev.stopPropagation()}
            >
              {detail?.kind === "apex"
                ? (() => {
                    const i = detail.i;
                    const a = APEX[i];
                    const v = bv[i];
                    const got = v > 0;
                    const cost = keyCost(Math.max(1, v));
                    return (
                      <>
                        <div className="mb-1 flex items-center justify-center gap-3">
                          <div className={got ? "" : "opacity-30 grayscale"}>
                            <ApexSprite index={i} color={a.color} size={72} />
                          </div>
                          {got && (
                            <>
                              <span className="vt-base text-white/75">→</span>
                              <MyVirusSprite
                                color={myColor}
                                lv={s.lv}
                                stage={stage}
                                mods={modColors}
                                parts={parts}
                                size={80}
                              />
                            </>
                          )}
                        </div>
                        <p className="vt-base text-white/75">
                          {a.icon} {a.role} {a.name} · 스테이지 {(i + 1) * 10}부터
                        </p>
                        {got ? (
                          <>
                            <p className="mt-2 text-lg font-bold" style={{ color: a.color }}>
                              🛡️ 우회 기술 「{a.trait}」 v{v}
                            </p>
                            <p className="vt-base mt-1 font-bold text-white">{a.cur(v)}</p>
                            <p className="vt-sm mt-0.5 text-emerald-200/90">
                              다음 v{v + 1}: {a.cur(v + 1)}
                            </p>
                            <p className="vt-sm mt-2 text-white/80">
                              🔑 우회 키 {s.keys[i]} / {cost} — 이 상위 보스를 잡으면 모여요 (처음
                              가는 스테이지 {DROP_NEW}개 · 다시 {DROP_AGAIN}개)
                            </p>
                            <button
                              type="button"
                              disabled={s.keys[i] < cost}
                              onClick={() =>
                                doCompile((sv) =>
                                  compileByp(sv, i) ? [{ kind: "byp", i, to: sv.byp[i] }] : []
                                )
                              }
                              className="vt-base mt-2 rounded-full border border-emerald-300/60 bg-emerald-400/15 px-5 py-1.5 font-bold text-emerald-100 enabled:hover:bg-emerald-400/25 disabled:opacity-40"
                            >
                              ▲ 컴파일
                            </button>
                            <p className="vt-sm mt-2 font-bold text-emerald-200">
                              🧬 외형 · {a.look}
                            </p>
                          </>
                        ) : (
                          <p className="vt-base mt-2 text-white/90">
                            스테이지 {(i + 1) * 10}에서 보스를 격퇴한 뒤 나오는 상위 보스를 잡으면
                            우회 기술 v1과 새 외형을 얻어요.
                          </p>
                        )}
                      </>
                    );
                  })()
                : detail?.kind === "mod" || introNow != null
                  ? (() => {
                      const i = detail?.kind === "mod" ? detail.i : introNow!;
                      const isIntro = detail?.kind !== "mod";
                      const v = ROSTER[i];
                      const lv = mods[i];
                      const joined = v.join <= Math.max(s.best - 1, s.stage);
                      const openable = modOpenable(s, i);
                      const to = planMod(s, i).to;
                      return (
                        <>
                          {isIntro && (
                            <p className="mb-1 vt-sm font-bold tracking-widest text-amber-200">
                              🆕 새 코드 모듈
                            </p>
                          )}
                          <div
                            className={`mb-1 flex justify-center ${lv ? "" : "opacity-30 grayscale"}`}
                          >
                            <VirusSprite seed={v.id} color={v.color} size={isIntro ? 96 : 80} />
                          </div>
                          <p className="vt-base text-white/75">
                            {joined ? `${v.name} (${v.year})` : "???"}
                          </p>
                          {lv || joined ? (
                            <>
                              <p className="mt-1.5 text-lg font-bold" style={{ color: v.color }}>
                                {v.icon} 「{v.module}」 {lv ? `v${lv}` : "미컴파일"}
                              </p>
                              <p className="vt-sm mt-0.5 text-white/80">{v.effect}</p>
                              {lv > 0 && (
                                <p className="vt-base mt-1 font-bold text-white">{v.cur(lv)}</p>
                              )}
                            </>
                          ) : (
                            <p className="vt-base mt-2 text-white/90">
                              스테이지 {v.join}에 이 네트워크로 합류해요.
                            </p>
                          )}
                          {!isIntro && joined && (
                            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                              <p className="vt-sm text-white/85">
                                조각 <b className="font-mono">{s.frag[i]}</b> / 다음 버전{" "}
                                <b className="font-mono">{fragCost(lv)}</b>
                              </p>
                              {openable ? (
                                <>
                                  {to > lv && (
                                    <p className="vt-sm mt-1 text-emerald-200">
                                      → v{to}: {v.cur(to)}
                                    </p>
                                  )}
                                  <button
                                    type="button"
                                    disabled={to <= lv}
                                    data-mod={i}
                                    onClick={onCompileModule}
                                    className="mt-2 rounded-full bg-emerald-400 px-4 py-1.5 vt-sm font-bold text-black enabled:hover:bg-emerald-300 disabled:opacity-40"
                                  >
                                    {to > lv ? `▲ v${to}로 컴파일` : "조각이 더 필요해요"}
                                  </button>
                                </>
                              ) : (
                                <p className="vt-sm mt-1 text-white/75">
                                  {v.name}을 잡아 조각을 모으면 열 수 있어요 (처음 가는 스테이지{" "}
                                  {DROP_NEW}개 · 다시 {DROP_AGAIN}개).
                                </p>
                              )}
                            </div>
                          )}
                          {joined && !isIntro && (
                            <p className="vt-xs mt-2 text-left leading-relaxed text-white/70">
                              {v.desc}
                            </p>
                          )}
                        </>
                      );
                    })()
                  : away && (
                      <>
                        <p className="text-3xl">🖥️</p>
                        <p className="mt-2 vt-base text-white/75">
                          백그라운드에서 {fmtTime(away.secs)} 동안 몰래 실행
                        </p>
                        <p className="mt-1 text-lg font-bold text-emerald-300">
                          💾 {fmtBytes(away.data)} 탈취
                        </p>
                      </>
                    )}
              <button
                type="button"
                onClick={closeDetail}
                className="vt-base mt-4 rounded-full border border-white/25 px-6 py-2 font-bold text-white/90 hover:border-white/50"
              >
                {detail ? "닫기" : introNow != null ? "확인" : "받기"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
