"use client";

/*
 * 올인 러브 (가제) — ANIME POKER 외전 미연시 · 1.0 알파
 * 로딩(진행률) → 타이틀 → 이름 → 본편. 대본은 lib/love/script.ts, 실행기는 lib/love/engine.ts
 * 저장: localStorage (못 쓰는 환경이어도 게임은 그대로 돌아감)
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BG,
  BG_FALLBACK,
  BGM,
  BGM_ONCE,
  CG,
  CG_ORDER,
  ENDINGS,
  FACE_ICON,
  NAME,
  NAME_COLOR,
  OUTFITS,
  FACE_NEAR,
  PHOTO,
  PORTRAIT,
  SUIT,
  RAIN_LOOP,
  SFX,
  STAND,
  TITLE,
  TITLE_ALT,
  cgKey,
  cgSrc,
  ICON,
  type IconId,
  ITEMS,
  planIcon,
  bgImage,
  preloadList,
} from "@/lib/love/assets";
import {
  type GState,
  check,
  goScene,
  ignorePhone,
  initState,
  jumpTo,
  lineKey,
  miniDone,
  next,
  pick,
  run,
} from "@/lib/love/engine";
import { type ReactLine, idleLine, lightMood, touchLine } from "@/lib/love/reactions";
import { type Heroine, SKILL_LINE, SKILL_NAME, SKILL_PRO, STAGE_LINE, STAGE_NAME, heroStage, skillOf, tiltName } from "@/lib/love/rel";
import { voiceOf } from "@/lib/love/voices";
import {
  type BgmId,
  type CgCam,
  type CgId,
  type CharKey,
  type EndingId,
  type Face,
  type Opt,
  type Outfit,
  type SfxId,
  SUBS,
  type Who,
} from "@/lib/love/types";
import { DealMini, HeadsUp, StoryPoker, TellMini } from "./Minis";
import { TELLS, knownTellIds, tellById, tellKnown } from "@/lib/love/tells";
import { MIND, MIND_HINT, isMindKey, mindGot, mindTotal } from "@/lib/love/mind";
import { REACT_CLUES, reactOf } from "@/lib/love/clues";
import { useStage } from "./Stage";
import VoiceReview, { type VoiceRow } from "./VoiceReview";
import AssetReview from "./AssetReview";
import { useAuth } from "@/lib/AuthContext";
import { type Guide, makeGuide } from "@/lib/love/route";
import { api } from "@/lib/api/http";

/** 개발 중에만 쓰는 주소 옵션 (?scene= · ?review=voices) */
const devParam = (k: string): string | null =>
  process.env.NODE_ENV !== "production" && typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get(k)
    : null;
/** 음성 검수 화면은 배포 사이트에서도 열림 (?review=voices, 메뉴엔 없음) */
const reviewParam = (): "voices" | "assets" | null => {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("review");
  return v === "voices" || v === "assets" ? v : null;
};

// ---------- 저장소 (실패해도 조용히) ----------
const LS = {
  get(k: string): string | null {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      window.localStorage.setItem(k, v);
    } catch {}
  },
};
const KEY = {
  save: (n: string) => `love:save:${n}`,
  endings: "love:endings",
  cg: "love:cg",
  /** 본 CG 차분 ("id~차분") — 갤러리에서 넘겨 보기 */
  cgv: "love:cgv",
  meta: "love:meta",
  cfg: "love:cfg",
  seen: "love:seen",
  name: "love:name",
  mute: "love:mute",
  /** 관리자 엔딩 길잡이 목표 */
  guide: "love:guide",
  /** 처음 가이드(코치마크) 본 기록 — 미연시 초기화 때 같이 지워짐 (새로 시작하는 사람에겐 다시 보여 줌) */
  coach: "love:coach",
  /** 이 브라우저 기록이 언제 기준인지 (관리자 '미연시 초기화' 시각과 비교) */
  resetAt: "love:resetAt",
};
/** 초기화해도 남기는 것: 설정 · 음소거 · 기준 시각 */
const KEEP_ON_RESET = new Set<string>([KEY.cfg, KEY.mute, KEY.resetAt]);
const loveDataKeys = (): string[] => {
  try {
    return Object.keys(window.localStorage).filter((k) => k.startsWith("love:") && !KEEP_ON_RESET.has(k));
  } catch {
    return [];
  }
};
/**
 * 관리자가 초기화한 시각보다 오래된 기록이면 지움 (지웠으면 true → 새로고침).
 * 기준 시각이 없는 브라우저: 기록이 없으면 지금이 기준(새로 시작), 기록이 있으면 초기화 이전 것으로 봄.
 */
async function applyLoveReset(): Promise<boolean> {
  const have = loveDataKeys();
  let mine = Number(LS.get(KEY.resetAt) ?? "0") || 0;
  if (!mine && !have.length) {
    mine = Date.now();
    LS.set(KEY.resetAt, String(mine));
  }
  const { at } = await api<{ at: number }>("/api/love/reset", { timeoutMs: 5000 });
  if (!at || at <= mine) return false;
  for (const k of have) {
    try {
      window.localStorage.removeItem(k);
    } catch {}
  }
  LS.set(KEY.resetAt, String(at));
  return have.length > 0;
}
interface SaveData {
  s: GState;
  name: string;
  ts: number;
  label: string;
}
const readSave = (n: string): SaveData | null => {
  const t = LS.get(KEY.save(n));
  if (!t) return null;
  try {
    return JSON.parse(t) as SaveData;
  } catch {
    return null;
  }
};
const SLOTS = ["1", "2", "3", "4", "5", "6"];
/** 회차를 넘어 남는 수치 (meta_*) */
const readMeta = (): Record<string, number> => {
  try {
    return JSON.parse(LS.get(KEY.meta) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
};

// ---------- 환경 설정 ----------
export interface Cfg {
  /** 글자 속도 1(느림)~5(즉시) */
  text: number;
  /** 오토 대기 1(길게)~5(짧게) */
  auto: number;
  bgm: number;
  sfx: number;
  voice: number;
  /** 대사창 불투명도 0.3~1 */
  box: number;
  /** 안 읽은 대사도 스킵 */
  skipAll: boolean;
  /** 시간제한 선택지 끄기 (침묵도 버튼으로 고를 수 있음) */
  noTimer: boolean;
  /** 다음 대사로 넘겨도 음성은 끝까지 (다음 음성이 시작될 때만 끊김) */
  voiceHold: boolean;
  /** 대사 글자 크기 배율 */
  fs: number;
}
const CFG0: Cfg = {
  text: 3,
  auto: 3,
  bgm: 0.7,
  sfx: 0.8,
  voice: 1,
  box: 0.85,
  skipAll: false,
  noTimer: false,
  voiceHold: false,
  fs: 1,
};
const readCfg = (): Cfg => {
  try {
    return { ...CFG0, ...(JSON.parse(LS.get(KEY.cfg) ?? "{}") as Partial<Cfg>) };
  } catch {
    return CFG0;
  }
};
const TYPE_MS = [0, 46, 34, 24, 14, 0];
const AUTO_MUL = [0, 1.7, 1.3, 1, 0.75, 0.5];

// ---------- 소리 ----------
/** 캐릭터별 음성 크기: 연서(y*-.mp3)는 에이미보다 약 2.7dB 크게 녹음돼 있어 0.7배(약 -3dB)로 맞춤 */
const voiceGain = (url: string) => (/\/y\d+-[^/]*\.mp3$/.test(url) ? 0.7 : 1);

function useSound(muted: boolean, cfg: Cfg) {
  const mute = useRef(muted);
  const vol = useRef(cfg);
  const bgmEl = useRef<HTMLAudioElement | null>(null);
  const cur = useRef<BgmId | null>(null);
  const bgmVol = () => (mute.current ? 0 : 0.42 * vol.current.bgm);
  useEffect(() => {
    mute.current = muted;
    vol.current = cfg;
    if (bgmEl.current)
      bgmEl.current.volume = voiceEl.current && !voiceEl.current.ended ? bgmVol() * 0.4 : bgmVol();
    if (voiceEl.current)
      voiceEl.current.volume = Math.min(1, 0.95 * cfg.voice * voiceGain(voiceEl.current.src));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted, cfg]);
  // 핵심 대사 음성: 하나만 재생, 재생 중엔 BGM 살짝 줄임
  const voiceEl = useRef<HTMLAudioElement | null>(null);
  const voiceEnd = useRef(0);
  const voice = useCallback((url: string | null) => {
    voiceEl.current?.pause();
    voiceEl.current = null;
    voiceEnd.current = 0;
    if (bgmEl.current) bgmEl.current.volume = bgmVol();
    if (!url || mute.current || vol.current.voice <= 0) return;
    const a = new Audio(url);
    a.volume = Math.min(1, 0.95 * vol.current.voice * voiceGain(url));
    voiceEl.current = a;
    a.onloadedmetadata = () => {
      voiceEnd.current = Date.now() + a.duration * 1000;
    };
    a.onended = () => {
      if (voiceEl.current === a && bgmEl.current) bgmEl.current.volume = bgmVol();
    };
    if (bgmEl.current) bgmEl.current.volume = bgmVol() * 0.4;
    a.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const play = useCallback((id: SfxId) => {
    if (mute.current || vol.current.sfx <= 0) return;
    const a = new Audio(SFX[id]);
    a.volume = Math.min(1, 0.6 * vol.current.sfx);
    a.play().catch(() => {});
  }, []);
  // 곡 전환은 크로스페이드 (뚝 끊기지 않게): 이전 곡 1.2초에 걸쳐 줄이고, 새 곡 1.6초에 걸쳐 올림
  const ramps = useRef(new Map<HTMLAudioElement, number>());
  const ramp = (a: HTMLAudioElement, to: () => number, ms: number, done?: () => void) => {
    const old = ramps.current.get(a);
    if (old) window.clearInterval(old);
    const from = a.volume;
    const t0 = performance.now();
    const id = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      a.volume = Math.max(0, Math.min(1, from + (to() - from) * t));
      if (t >= 1) {
        window.clearInterval(id);
        ramps.current.delete(a);
        done?.();
      }
    }, 40);
    ramps.current.set(a, id);
  };
  const musicMode = useRef<MusicMode | null>(null);
  const musicEnd = useRef<(() => void) | null>(null);
  const bgm = useCallback((id: BgmId | null) => {
    if (cur.current === id) return;
    cur.current = id;
    const prev = bgmEl.current;
    if (prev) ramp(prev, () => 0, id ? 1200 : 1000, () => prev.pause());
    bgmEl.current = null;
    const url = id ? BGM[id] : null;
    if (!id || !url) return;
    const a = new Audio(url);
    a.loop = musicMode.current ? musicMode.current === "one" : !BGM_ONCE.includes(id);
    // 음악실의 '전체 반복 · 셔플': 곡이 끝나면 다음 곡을 음악실이 고름
    a.onended = () => {
      if (bgmEl.current === a && musicMode.current) musicEnd.current?.();
    };
    a.volume = 0;
    bgmEl.current = a;
    ramp(a, () => (voiceEl.current && !voiceEl.current.ended ? bgmVol() * 0.4 : bgmVol()), 1600);
    // 자동 재생이 막히면(첫 화면) 첫 클릭 때 다시 시도
    a.play().catch(() => {
      const retry = () => {
        if (bgmEl.current === a) a.play().catch(() => {});
      };
      window.addEventListener("pointerdown", retry, { once: true });
      window.addEventListener("keydown", retry, { once: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 빗소리 루프 (비 오는 골목 · 비 CG) — 효과음 음량을 따름
  const rainEl = useRef<HTMLAudioElement | null>(null);
  const rainVol = () => (mute.current ? 0 : 0.35 * vol.current.sfx);
  const rain = useCallback((on: boolean) => {
    if (!on) {
      rainEl.current?.pause();
      rainEl.current = null;
      return;
    }
    if (rainEl.current) {
      rainEl.current.volume = rainVol();
      return;
    }
    const a = new Audio(RAIN_LOOP);
    a.loop = true;
    a.volume = rainVol();
    rainEl.current = a;
    a.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (rainEl.current) rainEl.current.volume = rainVol();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted, cfg]);
  useEffect(() => () => rainEl.current?.pause(), []);
  /** 대사 한 줄의 음성: 음성 없는 줄이면 설정에 따라 이전 음성을 끝까지 둠 */
  const voiceLine = useCallback(
    (url: string | null) => {
      if (!url && vol.current.voiceHold) return;
      voice(url);
    },
    [voice]
  );
  /** 음악실용: 지금 곡 위치 · 일시정지 · 이동 */
  const bgmCtl = useMemo(
    () => ({
      pos: (): [number, number, boolean] => {
        const a = bgmEl.current;
        return a ? [a.currentTime, a.duration || 0, a.paused] : [0, 0, true];
      },
      toggle: () => {
        const a = bgmEl.current;
        if (!a) return;
        if (a.paused) a.play().catch(() => {});
        else a.pause();
      },
      seek: (r: number) => {
        const a = bgmEl.current;
        if (a && a.duration) a.currentTime = r * a.duration;
      },
      /** 음악실 반복 방식 (null = 게임 기본) · 곡이 끝났을 때 부를 함수 */
      setMode: (m: MusicMode | null, onEnd?: () => void) => {
        musicMode.current = m;
        musicEnd.current = onEnd ?? null;
        const a = bgmEl.current;
        if (a) a.loop = m ? m === "one" : !BGM_ONCE.includes(cur.current as BgmId);
      },
    }),
    []
  );
  return { play, bgm, voice, voiceLine, voiceEnd, rain, bgmCtl };
}

type Phase = "title" | "name" | "game" | "gallery" | "review" | "assets" | "credits";
type Panel = "story" | null | "log" | "save" | "load" | "config" | "rel";

export default function LoveApp() {
  const [phase, setPhase] = useState<Phase>("title");
  // ---------- 관리자: 엔딩 길잡이 · 크레딧 미리 보기 ----------
  const auth = useAuth();
  const isAdmin = auth.admin || devParam("admin") === "1";
  const [guideTarget, setGuideTargetState] = useState<EndingId | null>(null);
  const setGuideTarget = (t: EndingId | null) => {
    setGuideTargetState(t);
    LS.set(KEY.guide, t ?? "");
  };
  const [guide, setGuide] = useState<Guide | null>(null);
  /** 엔딩에 닿은 순간의 이번 판 기록 (크레딧 롤) */
  const [rollStats, setRollStats] = useState<RollStats | null>(null);
  const [guideRes, setGuideRes] = useState<{ seq: number; cands: number[]; ok: boolean[] } | null>(null);
  const [creditPreview, setCreditPreview] = useState<EndingId | null>(null);
  /** 이번 판 플레이 시간 (초) — 선택할 때 · 저장할 때 대본 수치 _sec 에 더함 */
  const playMs = useRef(0);
  const stage = useStage();
  const [s, setS] = useState<GState | null>(null);
  const [name, setName] = useState("한도윤");
  const [typed, setTyped] = useState(0);
  const [auto, setAuto] = useState(false);
  const [skip, setSkip] = useState(false);
  const wheelAt = useRef(0);
  const hoverEl = useRef<HTMLButtonElement | null>(null);
  const hoverAt = useRef(0);
  const [log, setLog] = useState<LogLine[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  // 터치 화면(모바일): 하단 작은 글자 메뉴 대신 큰 버튼 메뉴 한 장
  const [touch, setTouch] = useState(false);
  const [qmOpen, setQmOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(pointer: coarse)");
    if (!mq) return;
    const f = () => setTouch(mq.matches);
    f();
    mq.addEventListener?.("change", f);
    return () => mq.removeEventListener?.("change", f);
  }, []);
  /** 오른쪽 위 나가기 → 확인 창 */
  const [askExit, setAskExit] = useState(false);
  const [endings, setEndings] = useState<EndingId[]>([]);
  /** 타이틀 버전: 깬 트루 · 그랜드 엔딩마다 열림. 기본 = 그랜드 > 가장 최근에 깬 트루, 고른 건 기억 */
  const [titlePick, setTitlePick] = useState<keyof typeof TITLE_ALT | "base" | null>(null);
  useEffect(() => {
    const v = LS.get("love:titlev");
    if (v) setTitlePick(v as keyof typeof TITLE_ALT | "base");
  }, []);
  const titleOpen = (Object.keys(TITLE_ALT) as (keyof typeof TITLE_ALT)[]).filter((k) => endings.includes(TITLE_ALT[k].end));
  const titleAuto = titleOpen.includes("grand")
    ? "grand"
    : ([...endings].reverse().map((e) => titleOpen.find((k) => TITLE_ALT[k].end === e)).find(Boolean) ?? null);
  const titleV = titlePick === "base" ? null : titlePick && titleOpen.includes(titlePick) ? titlePick : titleAuto;
  const titleBg = (titleV && TITLE_ALT[titleV].bg) || TITLE.bg;
  const titleBgm: BgmId = titleV ? TITLE_ALT[titleV].bgm : "title";
  /** 본 이벤트 CG (회상 갤러리) */
  const [cgs, setCgs] = useState<CgId[]>([]);
  const [cgvs, setCgvs] = useState<string[]>([]);
  const [muted, setMuted] = useState(false);
  const [cfg, setCfgState] = useState<Cfg>(CFG0);
  const setCfg = (p: Partial<Cfg>) =>
    setCfgState((c) => {
      const n = { ...c, ...p };
      LS.set(KEY.cfg, JSON.stringify(n));
      return n;
    });
  /** 호감이 오르면 구석에 작은 하트 */
  const [heartPop, setHeartPop] = useState<{ who: "amy" | "yeonseo"; n: number } | null>(null);
  /** 호감이 깎이면 (선택 · 방치) 금 간 회색 하트 — 수치는 안 보여 줌 */
  const [heartDown, setHeartDown] = useState<{ who: "amy" | "yeonseo"; n: number } | null>(null);
  const [tiltFx, setTiltFx] = useState<number | null>(null);
  const [hideUi, setHideUi] = useState(false);
  /** 선택지가 떠도 직전 대사를 대사창에 남겨 둠 (무슨 말에 대한 선택인지 보이게) */
  const [lastSay, setLastSay] = useState<{ who: Who; mood: string; text: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [phoneShown, setPhoneShown] = useState(0);
  /** 잠금 화면 알림을 눌러(또는 잠시 뒤) 대화방이 열렸는지 — 열린 뒤부터 말풍선이 하나씩 */
  const [phoneOpen, setPhoneOpen] = useState(false);
  /** 장면 전환 커튼 — 장소가 바뀌면 검게 닫혔다가 새 장면으로 열림 (닫히는 동안은 이전 장면을 그대로 보여 줌) */
  const [curtain, setCurtain] = useState<{ n: number; kind: "dip" | "in" } | null>(null);
  const [held, setHeld] = useState<GState | null>(null);
  const heldRef = useRef(false);
  useEffect(() => {
    heldRef.current = !!held;
  }, [held]);
  const shownRef = useRef<GState | null>(null);
  const curN = useRef(0);
  /** 퇴장 페이드: 방금 사라진 캐릭터 · CG 를 잠깐 더 그려서 서서히 사라지게 */
  const [ghosts, setGhosts] = useState<{ k: CharKey; c: NonNullable<GState["disp"]["chars"][CharKey]>; outfit?: Outfit; n: number }[]>([]);
  const [cgGhost, setCgGhost] = useState<{ id: CgId; v?: string | null; n: number } | null>(null);
  const prevDisp = useRef<GState["disp"] | null>(null);
  const ghostN = useRef(0);
  /** 방치 · 터치 반응 (말풍선 + 잠깐 표정) */
  const [react, setReact] = useState<(ReactLine & { who: CharKey; n: number; seq: number }) | null>(
    null
  );
  const [touchHint, setTouchHint] = useState(false);
  /** 스태프 롤을 본 엔딩 (상태 번호) */
  const [rolled, setRolled] = useState(-1);
  /** 지금 대사가 이미 읽은 줄인지 (대사창 "읽음" 표시) */
  const [readNow, setReadNow] = useState(false);
  const seen = useRef<Set<string>>(new Set());
  const wrap = useRef<HTMLDivElement>(null);
  // 폰 안내 화면(전체화면 · 가로 돌리기)이 덮고 있는 동안은 소리 없음
  const { play, bgm, voice, voiceLine, voiceEnd, rain, bgmCtl } = useSound(muted || stage.gate, cfg);
  // 비 오는 골목(CG 없을 때) · 비 CG 동안 빗소리
  const rainOn =
    phase === "game" && !!s && ((s.disp.bg === "alley" && !s.disp.cg) || (!!s.disp.cg && RAIN_CG.includes(s.disp.cg)));
  useEffect(() => rain(rainOn), [rainOn, rain]);

  const sub = useCallback((t: string) => t.replaceAll("{name}", name), [name]);
  const flash = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(null), 1400);
  };

  // ---------- 로딩: 그림 · 소리 전부 받은 뒤 시작 ----------
  useEffect(() => {
    try {
      setEndings(JSON.parse(LS.get(KEY.endings) ?? "[]"));
      setGuideTargetState((LS.get(KEY.guide) || null) as EndingId | null);
      setCgs(JSON.parse(LS.get(KEY.cg) ?? "[]"));
      setCgvs(JSON.parse(LS.get(KEY.cgv) ?? "[]"));
      seen.current = new Set(JSON.parse(LS.get(KEY.seen) ?? "[]"));
    } catch {}
    const n = LS.get(KEY.name);
    if (n) setName(n);
    setMuted(LS.get(KEY.mute) === "1");
    setCfgState(readCfg());
    // 그림 · 소리는 Stage 의 공용 로딩 화면(GameLoader)이 다 받은 뒤라 여기선 바로 타이틀
    const rv = reviewParam();
    if (rv === "voices") setPhase("review");
    if (rv === "assets") setPhase("assets");
    // 음성은 화면이 뜬 뒤 6개씩 뒤에서 받아 둠 (브라우저 캐시에 들어가서 대사 넘길 때 바로 재생)
    const { voice } = preloadList();
    let i = 0;
    let alive = true;
    const next = (): void => {
      const u = voice[i++];
      if (u && alive) fetch(u).then(next, next);
    };
    const t = window.setTimeout(() => {
      for (let k = 0; k < 6; k++) next();
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, []);
  // 관리자 '미연시 초기화' 이후 처음 들어온 브라우저면 예전 기록을 지우고 새로 시작
  useEffect(() => {
    applyLoveReset().then(
      (wiped) => {
        if (wiped) window.location.reload();
      },
      () => {}
    );
  }, []);

  // 사이트 퀵메뉴(≡) 버튼이 게임 오른쪽 아래 버튼(블러프다 · 레이즈 등)을 가려서 이 페이지에선 숨김
  useEffect(() => {
    const qm = document.querySelector<HTMLElement>("[data-quickmenu]");
    if (!qm) return;
    qm.style.display = "none";
    return () => {
      qm.style.display = "";
    };
  }, []);

  // ---------- 타이틀 · 이름 · 엔딩 수집 화면은 메인 테마 ----------
  useEffect(() => {
    if (phase === "title" || phase === "name") bgm(titleBgm);
    else if (phase === "gallery") bgm("title");
  }, [phase, bgm, titleBgm]);

  // ---------- 상태가 바뀔 때: 소리 · 백로그 · 타자 효과 초기화 ----------
  useEffect(() => {
    if (!s) return;
    s.fx.forEach(play);
    const b = s.block;
    // 스토리 포커 중엔 전용 곡, 배드 엔딩 카드엔 짧은 코다
    const endKind = b?.k === "ending" ? ENDINGS.find((e) => e.id === b.id)?.kind : null;
    bgm(
      b?.k === "mini" && (b.step.kind === "poker" || b.step.kind === "match")
        ? "spoker"
        : endKind === "bad"
          ? "badend"
          : endKind === "true"
            ? "ending"
            : s.disp.bgm
    );
    if (b?.k === "say") setLastSay({ who: b.who, mood: b.mood, text: b.text });
    else if (b && b.k !== "choice") setLastSay(null);
    if (b?.k === "say") {
      setReadNow(seen.current.has(lineKey(s)));
      setTyped(0);
      setLog((l) => [...l.slice(-199), { who: b.who, text: b.text, st: s }]);
      if (skip) voice(null);
      else voiceLine(voiceOf(b.who, b.text) ?? null);
    }
    // 회차 기억: meta_ 로 시작하는 수치는 다음 회차에도 남음 (진엔딩 잠금 해제 정보 등)
    const metaNew = Object.entries(s.vars).filter(
      ([k, v]) => k.startsWith("meta_") && v > (readMeta()[k] ?? 0)
    );
    if (metaNew.length)
      LS.set(KEY.meta, JSON.stringify({ ...readMeta(), ...Object.fromEntries(metaNew) }));
    const cg = s.disp.cg;
    if (cg)
      setCgs((l) => {
        if (l.includes(cg)) return l;
        const n = [...l, cg];
        LS.set(KEY.cg, JSON.stringify(n));
        return n;
      });
    const cv = s.disp.cgv;
    if (cg && cv)
      setCgvs((l) => {
        const k = cgKey(cg, cv);
        if (l.includes(k)) return l;
        const n = [...l, k];
        LS.set(KEY.cgv, JSON.stringify(n));
        return n;
      });
    if (b?.k === "phone") {
      setPhoneShown(0);
      setPhoneOpen(false);
      play("phone");
    }
    if (b?.k === "goTitle") {
      voice(null);
      bgm(null);
      setPhase("title");
    }
    if (b?.k === "ending") {
      setRollStats(statsOf(withTimePeek(s), cgs, endings));
      // 크레딧 롤이 있는 엔딩은 롤이 끝난 뒤 카드가 나오므로 도장 소리도 그때 (CreditRoll onDone)
      if (!ROLL_KINDS.includes(ENDINGS.find((e) => e.id === b.id)?.kind ?? ""))
        window.setTimeout(() => play("stamp"), 4400);
      setEndings((e) => {
        if (e.includes(b.id)) return e;
        const n = [...e, b.id];
        LS.set(KEY.endings, JSON.stringify(n));
        return n;
      });
    }
    if (b && b.k !== "say") setSkip(false);
    // 선택지 직전 자동 저장 (최근 3개 돌려 씀) — 분기점이면 알림음
    if (b?.k === "choice" || b?.k === "free") {
      const a1 = readSave("a1");
      if (!a1 || a1.s.scene !== s.scene || a1.s.i !== s.i) {
        const a2 = LS.get(KEY.save("a2"));
        if (a2) LS.set(KEY.save("a3"), a2);
        if (a1) LS.set(KEY.save("a2"), JSON.stringify(a1));
        const data: SaveData = {
          s,
          name,
          ts: Date.now(),
          label: `${s.disp.day ? `DAY ${s.disp.day.d} · ${s.disp.day.slot}` : "프롤로그"}  ${b.k === "free" ? "자유 행동" : (b.prompt ?? "선택지").slice(0, 22)}`,
        };
        LS.set(KEY.save("a1"), JSON.stringify(data));
      }
      if (b.big) play("heart");
    }
    // s.seq 로만 반응 (같은 상태 다시 그릴 때 소리 중복 X)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.seq]);

  // ---------- 장면 전환 커튼 ----------
  // 게임에 들어올 때: 검은 화면에서 천천히 열림
  useEffect(() => {
    if (phase !== "game") {
      shownRef.current = null;
      return;
    }
    const n = ++curN.current;
    setCurtain({ n, kind: "in" });
    // 첫 대사는 화면이 거의 열린 뒤에 타자 시작
    const t0 = window.setTimeout(() => setTyped(0), 650);
    const t = window.setTimeout(() => setCurtain((c) => (c?.n === n ? null : c)), 1500);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t);
    };
  }, [phase]);
  // 장소가 바뀔 때: 이전 장면을 잡아 둔 채 검게 닫고 → 새 장면으로 바꾼 뒤 → 열림 (스킵 중엔 바로)
  useEffect(() => {
    if (phase !== "game" || !s) return;
    const prev = shownRef.current;
    shownRef.current = s;
    if (!prev || skip || prev.disp.bg === s.disp.bg) return;
    const n = ++curN.current;
    setHeld(prev);
    setCurtain({ n, kind: "dip" });
    window.setTimeout(() => {
      if (curN.current !== n) return;
      setHeld(null);
      setTyped(0);
    }, 460);
    window.setTimeout(() => setCurtain((c) => (c?.n === n ? null : c)), 1250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.seq]);
  // 퇴장 페이드 (같은 장소 안에서만 — 장소가 바뀌면 커튼이 덮음)
  const viewDisp = (held ?? s)?.disp ?? null;
  useEffect(() => {
    const prev = prevDisp.current;
    prevDisp.current = viewDisp;
    if (!prev || !viewDisp || prev.bg !== viewDisp.bg || skip) return;
    const n = ++ghostN.current;
    const gone = (Object.keys(prev.chars) as CharKey[]).filter((k) => !viewDisp.chars[k]);
    if (gone.length) {
      setGhosts((g) => [
        ...g.filter((x) => !gone.includes(x.k) && !viewDisp.chars[x.k]),
        ...gone.map((k) => ({ k, c: prev.chars[k]!, outfit: prev.outfit?.[k], n })),
      ]);
      window.setTimeout(() => setGhosts((g) => g.filter((x) => x.n !== n)), 480);
    }
    if (prev.cg && !viewDisp.cg) {
      setCgGhost({ id: prev.cg, v: prev.cgv, n });
      window.setTimeout(() => setCgGhost((c) => (c?.n === n ? null : c)), 750);
    } else if (viewDisp.cg) setCgGhost(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewDisp]);

  // CG 가 처음 뜨는 순간엔 대사창을 1.5초 숨겨 그림만 보여 줌 (클릭하면 바로 대사창)
  const [cgIntro, setCgIntro] = useState<number | null>(null);
  const cgNow = viewDisp?.cg ?? null;
  const cgPrevRef = useRef<CgId | null>(null);
  useEffect(() => {
    const prev = cgPrevRef.current;
    cgPrevRef.current = cgNow;
    if (!cgNow || prev === cgNow || skip) return;
    const n = Date.now();
    setCgIntro(n);
    const id = window.setTimeout(() => setCgIntro((c) => (c === n ? null : c)), 1500);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cgNow]);

  const block = s?.block ?? null;
  const fullText = block?.k === "say" ? sub(block.text) : "";
  const typing = block?.k === "say" && typed < fullText.length;

  // 타자 효과
  useEffect(() => {
    if (!typing) return;
    const ms = TYPE_MS[cfg.text] ?? 24;
    if (skip || !ms) {
      setTyped(fullText.length);
      return;
    }
    // 숨 고르기: 말줄임표 · 문장 끝 · 쉼표 뒤에서 잠깐 멈춤 ("…진짜?" 의 '…' 다음, "알아. 근데" 의 '.' 다음)
    const ch = fullText[typed - 1];
    const nx = fullText[typed];
    let d = ms;
    if (typed > 0) {
      if (ch === "…" && nx !== "…") d = ms * 11;
      else if ((ch === "." || ch === "?" || ch === "!") && nx === " ") d = ms * 8;
      else if (ch === "," && nx === " ") d = ms * 4;
    }
    const id = window.setTimeout(() => setTyped((n) => Math.min(fullText.length, n + 1)), d);
    return () => window.clearTimeout(id);
  }, [typing, typed, skip, fullText, cfg.text]);

  const markSeen = useCallback(() => {
    if (!s) return;
    seen.current.add(lineKey(s));
    LS.set(KEY.seen, JSON.stringify([...seen.current]));
  }, [s]);

  const advance = useCallback(() => {
    if (!s || panel || heldRef.current) return;
    const b = s.block;
    if (!b) return;
    if (b.k === "say") {
      if (typed < sub(b.text).length) {
        setTyped(sub(b.text).length);
        return;
      }
      markSeen();
      play("click");
      setS(next(s));
    } else if (b.k === "day" || b.k === "title") {
      setS(next(s));
    } else if (b.k === "montage" || b.k === "recall") {
      play("click");
      setS(next(s));
    }
  }, [s, panel, typed, sub, markSeen, play]);

  // 몽타주: 스킵 중이면 바로 넘김 (평소엔 클릭)
  useEffect(() => {
    if ((block?.k !== "montage" && block?.k !== "recall") || !skip) return;
    const id = window.setTimeout(advance, 300);
    return () => window.clearTimeout(id);
  }, [block, advance, skip]);

  // 날짜 · 제목 카드는 잠깐 보여 주고 자동으로 넘어감
  useEffect(() => {
    if (block?.k !== "day" && block?.k !== "title") return;
    const id = window.setTimeout(advance, skip ? 200 : block.k === "day" ? 1500 : 2300);
    return () => window.clearTimeout(id);
  }, [block, advance, skip]);

  // 오토 · 스킵
  useEffect(() => {
    if (block?.k !== "say" || panel || askExit) return;
    if (skip) {
      if (!cfg.skipAll && !seen.current.has(lineKey(s!))) {
        setSkip(false);
        flash("읽지 않은 대사 — 스킵 멈춤");
        return;
      }
      const id = window.setTimeout(advance, 45);
      return () => window.clearTimeout(id);
    }
    if (auto && !typing) {
      // 음성이 있는 줄은 음성이 끝날 때까지 기다림
      const mul = AUTO_MUL[cfg.auto] ?? 1;
      const id = window.setTimeout(
        advance,
        Math.max((1100 + fullText.length * 38) * mul, voiceEnd.current - Date.now() + 700 * mul)
      );
      return () => window.clearTimeout(id);
    }
  }, [
    block,
    skip,
    auto,
    typing,
    advance,
    panel,
    fullText.length,
    s,
    voiceEnd,
    cfg.auto,
    cfg.skipAll,
    askExit,
  ]);

  // 메시지 말풍선 하나씩
  useEffect(() => {
    if (block?.k !== "phone" || !(phoneOpen || skip)) return;
    if (phoneShown >= block.step.msgs.length) return;
    // 긴 메시지일수록 '입력 중…'이 조금 더 길게
    const next = block.step.msgs[phoneShown] ?? "";
    const id = window.setTimeout(() => setPhoneShown((n) => n + 1), Math.min(1500, 550 + next.length * 28));
    return () => window.clearTimeout(id);
  }, [block, phoneShown, phoneOpen, skip]);

  // ---------- 살아 있는 스탠딩: 반응 ----------
  const showReact = useCallback(
    (who: CharKey, r: ReactLine, seq: number) => {
      setReact({ ...r, who, n: Date.now(), seq });
      if (r.heart) play("heart");
    },
    [play]
  );
  // 반응 말풍선은 잠깐만 (대사가 넘어가면 seq 가 달라져서 바로 안 보임)
  useEffect(() => {
    if (!react) return;
    const id = window.setTimeout(() => setReact(null), 2600);
    return () => window.clearTimeout(id);
  }, [react]);
  const liveReact = react && s && react.seq === s.seq ? react : null;
  // 방치: 대사를 다 띄워 둔 채 18초 그대로면 히로인이 먼저 말을 검 (한 대사에 한 번)
  useEffect(() => {
    if (phase !== "game" || !s || block?.k !== "say" || typing || panel || auto || skip || hideUi || askExit)
      return;
    if (!lightMood(s)) return;
    const on: CharKey[] = (Object.keys(s.disp.chars) as CharKey[]).filter(
      (k) => k === "yeonseo" || k === "amy"
    );
    if (!on.length) return;
    const who = on.includes(block.who as CharKey) ? (block.who as CharKey) : on[0];
    const id = window.setTimeout(() => showReact(who, idleLine(who, s.vars), s.seq), 18000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.seq, typing, panel, auto, skip, hideUi, phase, askExit]);
  /** 화면 숨김(HIDE) 중 캐릭터를 누르면 반응 — 머리는 쓰다듬기, 나머지는 콕 */
  const touchAt = (x: number, y: number): boolean => {
    if (!s) return false;
    for (const el of document.elementsFromPoint(x, y)) {
      const w = (el as HTMLElement).closest?.("[data-who]") as HTMLElement | null;
      if (!w) continue;
      const who = w.dataset.who as CharKey;
      if (who !== "yeonseo" && who !== "amy") continue;
      const r = w.getBoundingClientRect();
      // 그림 가장자리 투명한 곳은 빼고 가운데 몸통 쪽만
      if (Math.abs(x - (r.left + r.width / 2)) > r.width * 0.32) continue;
      const head = (y - r.top) / r.height < HEAD_Y + 0.03;
      if (!lightMood(s)) return true;
      showReact(who, touchLine(who, head ? "head" : "body", s.vars), s.seq);
      return true;
    }
    return false;
  };

  // 키보드: 스페이스 · 엔터 = 다음, Ctrl 누르는 동안 스킵, Esc = 창 닫기
  useEffect(() => {
    if (phase !== "game") return;
    const down = (e: KeyboardEvent) => {
      if (coachRef.current) {
        if (e.key === "Enter" || e.code === "Space" || e.key === "Escape") {
          e.preventDefault();
          coachNext(true);
        }
        return;
      }
      // Esc: 열린 창 닫기 → 아무 창도 없으면 나가기 확인
      if (e.key === "Escape") {
        if (askExit) setAskExit(false);
        else if (panel) setPanel(null);
        else setAskExit(true);
        return;
      }
      if (askExit) return;
      if (e.key === "Control") setSkip(true);
      if ((e.key === "h" || e.key === "H") && !panel) setHideUi((v) => !v);
      if ((e.key === "a" || e.key === "A") && !panel) setAuto((v) => !v);
      if ((e.key === "l" || e.key === "L" || e.key === "ArrowUp") && !panel) setPanel("log");
      // R = 관계 · 그녀 노트 (열려 있으면 닫기)
      if ((e.key === "r" || e.key === "R") && (!panel || panel === "rel")) setPanel(panel === "rel" ? null : "rel");
      // 숫자 1~9 = 그 번호 선택지 · 일정 카드
      if (/^[1-9]$/.test(e.key) && !panel) {
        const bs = wrap.current?.querySelectorAll<HTMLButtonElement>(".lv-choice:not(:disabled), .lv-plan, .lv-free");
        bs?.[Number(e.key) - 1]?.click();
      }
      if ((e.code === "Space" || e.code === "Enter") && !panel) {
        e.preventDefault();
        advance();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Control") setSkip(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [phase, advance, panel, askExit]);

  // ---------- 플레이 시간 · 길잡이 ----------
  /** 쌓인 플레이 시간을 대본 수치(_sec)에 넣은 상태 */
  const withTime = (st: GState): GState => {
    const add = Math.floor(playMs.current / 1000);
    if (!add) return st;
    playMs.current -= add * 1000;
    return { ...st, vars: { ...st.vars, _sec: (st.vars._sec ?? 0) + add } };
  };
  /** 쌓인 시간을 더해 보기만 (상태는 그대로) */
  const withTimePeek = (st: GState): GState => ({
    ...st,
    vars: { ...st.vars, _sec: (st.vars._sec ?? 0) + Math.floor(playMs.current / 1000) },
  });
  useEffect(() => {
    if (phase !== "game") return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") playMs.current += 1000;
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);
  // 길잡이: 선택지 · 메시지 · 미니게임이 뜨면 목표 엔딩에 닿는 후보를 찾음 (관리자만)
  const guideKey = s && phase === "game" && guide && s.block && ["choice", "free", "phone", "mini"].includes(s.block.k) ? s.seq : null;
  useEffect(() => {
    if (guideKey == null || !s || !guide) return;
    let alive = true;
    const g = guide;
    g.check({ scene: s.scene, i: s.i, vars: s.vars }, 1500, () => alive).then((r) => {
      if (alive) setGuideRes({ seq: guideKey, cands: r.cands, ok: r.ok });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideKey]);
  /** 길잡이 결과로 후보 하나가 보여야 하는지 (길잡이 꺼짐 · 계산 중 · 아무것도 못 찾음 → 다 보임) */
  const guideOn = !!guide && phase === "game";
  const guideReady = guideOn && guideRes?.seq === s?.seq;
  const guideAny = guideReady && guideRes!.ok.some(Boolean);
  const guideShow = (c: number) => {
    if (!guideReady || !guideAny) return true;
    const i = guideRes!.cands.indexOf(c);
    return i < 0 || guideRes!.ok[i];
  };

  // ---------- 동작 ----------
  const newGame = () => {
    LS.set(KEY.name, name);
    setLog([]);
    setAuto(false);
    setSkip(false);
    // 개발 중에만: ?scene=d4 로 원하는 장면부터 테스트
    const dev = devParam("scene");
    const st0 = { ...initState(), vars: readMeta() };
    playMs.current = 0;
    setGuide(guideTarget && isAdmin ? makeGuide(guideTarget) : null);
    setS(run(dev ? { ...st0, scene: dev, i: 0 } : st0));
    setReviewId(null);
    setPhase("game");
  };
  /** 음성 검수: 그 대사 줄을 실제 게임 화면으로 */
  const [reviewId, setReviewId] = useState<string | null>(null);
  const jumpReview = (r: VoiceRow) => {
    if (!r.scene) return;
    setLog([]);
    setAuto(false);
    setSkip(false);
    setPanel(null);
    setReviewId(r.id);
    setS(jumpTo(r.scene, r.i, { routeA: 1, routeY: 1, yeonName: 1, affY: 8, affA: 8 }));
    setPhase("game");
  };
  const backReview = () => {
    voice(null);
    bgm(null);
    setPhase("review");
  };
  const choose = (o: Opt) => {
    if (!s) return;
    play("chip");
    markSeen();
    setLog((l) => [...l.slice(-199), { who: "me", text: o.text, pick: true }]);
    // 마음 읽기: 그 사람을 알아본 선택이면 연필 소리 하나 (숫자 · 하트 변화 없음)
    if (Object.keys(o.eff ?? {}).some((k) => isMindKey(k) && !((s.vars[k] ?? 0) >= 1))) play("pencil");
    setS(pick(withTime(s), o));
    // 호감이 오른 선택이면 그 히로인 색 하트가 잠깐 떠오름 (수치는 안 보여 줌)
    const up = (o.eff?.affA ?? 0) > 0 ? "amy" : (o.eff?.affY ?? 0) > 0 ? "yeonseo" : null;
    if (up) setHeartPop({ who: up, n: Date.now() });
    const down = (o.eff?.affA ?? 0) < 0 ? "amy" : (o.eff?.affY ?? 0) < 0 ? "yeonseo" : null;
    if (down) {
      setHeartDown({ who: down, n: Date.now() });
      play("fold");
    }
    // 함정 대가: 손이 테이블을 기억하는 선택(틸트 · 에이미 도박욕)이면 화면 가장자리가 잠깐 어두워지고 미세하게 흔들림 (수치는 안 보여 줌)
    if ((o.eff?.tilt ?? 0) > 0 || (o.eff?.gambleA ?? 0) > 0) setTiltFx(Date.now());
  };
  useEffect(() => {
    if (!tiltFx) return;
    const id = window.setTimeout(() => setTiltFx(null), 1500);
    return () => window.clearTimeout(id);
  }, [tiltFx]);
  useEffect(() => {
    if (!heartPop) return;
    const id = window.setTimeout(() => setHeartPop(null), 1600);
    return () => window.clearTimeout(id);
  }, [heartPop]);
  useEffect(() => {
    if (!heartDown) return;
    const id = window.setTimeout(() => setHeartDown(null), 1900);
    return () => window.clearTimeout(id);
  }, [heartDown]);
  // 방치 감소 (사흘 넘게 안 만나면 -1): 엔진이 _dcA · _dcY 를 올리면 금 간 하트
  const dcA = s?.vars._dcA ?? 0;
  const dcY = s?.vars._dcY ?? 0;
  const dcRef = useRef<[number, number] | null>(null);
  useEffect(() => {
    if (phase !== "game") {
      dcRef.current = null;
      return;
    }
    const prev = dcRef.current;
    dcRef.current = [dcA, dcY];
    if (!prev) return;
    const who = dcA > prev[0] ? "amy" : dcY > prev[1] ? "yeonseo" : null;
    if (who) {
      setHeartDown({ who, n: Date.now() });
      play("fold");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dcA, dcY, phase]);
  // ---- 처음 가이드 (코치마크): 새 시스템을 처음 만날 때 한 번씩. 대상 UI 를 밝히고 한두 문장 + "알겠어" ----
  const coachSeen = useRef<Set<string> | null>(null);
  const coachRef = useRef<string | null>(null);
  const coachQ = useRef<string[]>([]);
  const [coachId, setCoachId] = useState<string | null>(null);
  const seenCoach = () => {
    if (!coachSeen.current) {
      try {
        coachSeen.current = new Set(JSON.parse(LS.get(KEY.coach) ?? "[]") as string[]);
      } catch {
        coachSeen.current = new Set();
      }
    }
    return coachSeen.current;
  };
  const coach = useCallback((id: string) => {
    if (!GUIDE[id] || seenCoach().has(id) || coachRef.current === id || coachQ.current.includes(id)) return;
    if (coachRef.current) {
      coachQ.current.push(id);
      return;
    }
    coachRef.current = id;
    setCoachId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** ok = 봤음으로 기록 · 아니면(대상이 화면에 없음) 다음 기회에 다시 */
  const coachNext = (ok: boolean) => {
    const id = coachRef.current;
    if (ok && id) {
      seenCoach().add(id);
      LS.set(KEY.coach, JSON.stringify([...seenCoach()]));
    }
    const nx = coachQ.current.shift() ?? null;
    coachRef.current = nx;
    setCoachId(nx);
  };
  const resetCoach = () => {
    coachSeen.current = new Set();
    LS.set(KEY.coach, "[]");
    flash("가이드를 처음부터 다시 보여 줄게요");
  };
  // 관계 단계가 오르면 위에 한 줄 알림 (대본 set 으로 오른 것도)
  const [stageUp, setStageUp] = useState<{ who: Heroine; stage: number; n: number } | null>(null);
  const stageRef = useRef<Record<Heroine, number> | null>(null);
  const affA = s?.vars.affA ?? 0;
  const affY = s?.vars.affY ?? 0;
  useEffect(() => {
    if (phase !== "game" || !s) {
      stageRef.current = null;
      return;
    }
    const now = { amy: heroStage(s.vars, "amy"), yeonseo: heroStage(s.vars, "yeonseo") };
    const prev = stageRef.current;
    stageRef.current = now;
    if (!prev) return;
    for (const who of ["amy", "yeonseo"] as Heroine[])
      if (now[who] > prev[who]) {
        setStageUp({ who, stage: now[who], n: Date.now() });
        play("heart");
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [affA, affY, phase]);
  // 마음 읽기: 날이 바뀌면 어제 알게 된 것 한 줄씩 (그날 새로 켜진 마음 플래그만)
  const [mindDay, setMindDay] = useState<{ day: number; items: typeof MIND; n: number } | null>(null);
  const dayNoRef = useRef<number | null>(null);
  const dayNo = s?.vars.dayNo ?? 0;
  useEffect(() => {
    if (phase !== "game" || !s) {
      dayNoRef.current = null;
      return;
    }
    const prev = dayNoRef.current;
    dayNoRef.current = dayNo;
    if (prev === null || dayNo <= prev) return;
    coach("relhud");
    const items = MIND.filter((m) => s.vars[`_md_${m.id}`] === prev && (s.vars[m.id] ?? 0) >= 1);
    if (items.length) setMindDay({ day: prev, items, n: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayNo, phase]);
  useEffect(() => {
    if (!mindDay || coachId === "mindday") return;
    const id = window.setTimeout(() => setMindDay(null), coachId === null ? 5200 : 2600);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mindDay, coachId]);
  // 읽기 노트: 새 버릇을 알게 되면 토스트
  const [tellUp, setTellUp] = useState<{ id: string; n: number } | null>(null);
  const tellRef = useRef<string[] | null>(null);
  const tellKey = s ? knownTellIds(s.vars).join(",") : "";
  useEffect(() => {
    if (phase !== "game" || !s) {
      tellRef.current = null;
      return;
    }
    const now = knownTellIds(s.vars);
    const prev = tellRef.current;
    tellRef.current = now;
    if (!prev) return;
    const fresh = now.find((id) => !prev.includes(id));
    if (fresh) {
      setTellUp({ id: fresh, n: Date.now() });
      play("pencil");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tellKey, phase]);
  useEffect(() => {
    if (!tellUp) return;
    const id = window.setTimeout(() => setTellUp(null), 3600);
    return () => window.clearTimeout(id);
  }, [tellUp]);
  useEffect(() => {
    if (!stageUp) return;
    const id = window.setTimeout(() => setStageUp(null), 3200);
    return () => window.clearTimeout(id);
  }, [stageUp]);
  // 딜러 실력 단계가 오르면 한 줄 (그 단계 효과까지) — 처음이면 가이드
  const [skillUp, setSkillUp] = useState<{ stage: number; n: number } | null>(null);
  const skillRef = useRef<number | null>(null);
  const skNow = s ? skillOf(s.vars) : 0;
  useEffect(() => {
    if (phase !== "game" || !s) {
      skillRef.current = null;
      return;
    }
    const prev = skillRef.current;
    skillRef.current = skNow;
    if (prev !== null && skNow > prev) {
      setSkillUp({ stage: skNow, n: Date.now() });
      play("pencil");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skNow, phase]);
  useEffect(() => {
    if (!skillUp || coachId === "skill") return;
    const id = window.setTimeout(() => setSkillUp(null), 4200);
    return () => window.clearTimeout(id);
  }, [skillUp, coachId]);
  useEffect(() => {
    if (skillUp) coach("skill");
  }, [skillUp, coach]);
  // 노트 힌트 (노트 정리) · 반응 단서(카드로 얻은 것 포함) · 주머니 물건(동네 한 바퀴) · 결전 단서(혼자 복기): 새로 생기면 한 줄
  const [noteUp, setNoteUp] = useState<{ head: string; text: string; n: number; icon?: IconId } | null>(null);
  const hintIds = s ? MIND.filter((m) => (s.vars[`h_${m.id}`] ?? 0) >= 1).map((m) => m.id) : [];
  const reactIds = s ? REACT_CLUES.filter((c) => (s.vars[c.id] ?? 0) >= 1).map((c) => c.id) : [];
  const itemIds: string[] = s ? ITEMS.filter((k) => (s.vars[k] ?? 0) >= 1) : [];
  const rigOn = s ? (s.vars.rigSeen ?? 0) >= 1 : false;
  const noteKeyStr = `${hintIds.join(",")}|${reactIds.join(",")}|${itemIds.join(",")}|${rigOn}`;
  const noteKeyRef = useRef<{ h: string[]; r: string[]; it: string[]; rig: boolean } | null>(null);
  useEffect(() => {
    if (phase !== "game" || !s) {
      noteKeyRef.current = null;
      return;
    }
    const prev = noteKeyRef.current;
    noteKeyRef.current = { h: hintIds, r: reactIds, it: itemIds, rig: rigOn };
    if (!prev) return;
    const h = hintIds.find((id) => !prev.h.includes(id));
    const r = reactIds.find((id) => !prev.r.includes(id));
    const it = itemIds.find((id) => !prev.it.includes(id)) as (typeof ITEMS)[number] | undefined;
    if (it) {
      setNoteUp({ head: `주머니 · ${ICON[it].name}`, text: "다음에 그녀를 만나면 건넬 수 있다. 누구 취향이었는지 떠올려 보자.", n: Date.now(), icon: it });
      play("pencil");
      coach("item");
    } else if (rigOn && !prev.rig) {
      setNoteUp({ head: "✎ 결전 단서 카드 · 바꿔치기", text: "딜러 손이 칩 트레이 쪽으로 반 뼘 내려가면, 덱이 바뀐다.", n: Date.now() });
      play("pencil");
    } else if (h) {
      const m = MIND.find((x) => x.id === h)!;
      setNoteUp({ head: `✎ 노트 힌트 · ${m.who === "both" ? "두 사람" : NAME[m.who]}`, text: MIND_HINT[h] ?? "", n: Date.now() });
      play("pencil");
      coach("hint");
    } else if (r) {
      // 매치에서 알아낸 건 매치 화면이 이미 알려 줌 — 일정 카드처럼 다른 데서 생긴 것만
      if (s.block?.k !== "mini") {
        setNoteUp({ head: "✎ 반응 단서", text: REACT_CLUES.find((c) => c.id === r)?.text ?? "", n: Date.now() });
        play("pencil");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteKeyStr, phase]);
  useEffect(() => {
    if (!noteUp || coachId === "hint" || coachId === "item") return;
    const id = window.setTimeout(() => setNoteUp(null), 4200);
    return () => window.clearTimeout(id);
  }, [noteUp, coachId]);

  // 관계 화면 새 소식: 하트 단계 · 그녀 노트 · 읽기 노트 · 반응 단서가 늘면 점 (열어 보면 꺼짐)
  const [relNew, setRelNew] = useState(false);
  const noteCount = s
    ? knownTellIds(s.vars).length +
      REACT_CLUES.filter((c) => (s.vars[c.id] ?? 0) >= 1).length +
      MIND.filter((m) => (s.vars[m.id] ?? 0) >= 1 || (s.vars[`h_${m.id}`] ?? 0) >= 1).length
    : 0;
  const noteRef = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== "game") {
      noteRef.current = null;
      return;
    }
    if (noteRef.current !== null && noteCount > noteRef.current) setRelNew(true);
    noteRef.current = noteCount;
  }, [noteCount, phase]);
  useEffect(() => {
    if (stageUp) {
      setRelNew(true);
      coach("relhud");
    }
  }, [stageUp, coach]);
  useEffect(() => {
    if (panel !== "rel") return;
    setRelNew(false);
    coach("relnote");
  }, [panel, coach]);
  useEffect(() => {
    if (mindDay) coach("mindday");
  }, [mindDay, coach]);
  const labelOf = (st: GState) => {
    const d = st.disp.day ? `DAY ${st.disp.day.d} · ${st.disp.day.slot}` : "프롤로그";
    const t = st.block?.k === "say" ? sub(st.block.text).slice(0, 26) : "";
    return `${d}  ${t}`;
  };
  const save = (n: string) => {
    if (!s) return;
    const data: SaveData = { s: withTime(s), name, ts: Date.now(), label: labelOf(s) };
    LS.set(KEY.save(n), JSON.stringify(data));
    play("save");
    if (n === "q") setHasQuick(true);
    flash(n === "q" ? "퀵세이브" : `${n}번에 저장`);
    setPanel(null);
  };
  const load = (n: string) => {
    const d = readSave(n);
    if (!d) return flash("저장된 게 없어요");
    setName(d.name);
    setLog([]);
    // 불러오기 전 화면의 대사가 선택지 밑에 남지 않게
    setLastSay(null);
    setS({ ...d.s, seq: d.s.seq + 1, fx: [] });
    // 불러온 직후 "지난 이야기" 한 장: 어디였는지 + 저장 직전 대사
    setRecap({ s: d.s, n: Date.now() });
    playMs.current = 0;
    setGuide(guideTarget && isAdmin ? makeGuide(guideTarget) : null);
    setPhase("game");
    setPanel(null);
  };
  /** 직전 선택지로: 지금 선택지 앞이면 그 전 것, 아니면 가장 최근 자동 저장 */
  const backToChoice = () => {
    if (!s) return;
    const a1 = readSave("a1");
    const atChoice =
      (block?.k === "choice" || block?.k === "free") &&
      a1 &&
      a1.s.scene === s.scene &&
      a1.s.i === s.i;
    const n = atChoice ? "a2" : "a1";
    if (!readSave(n)) return flash("돌아갈 선택지가 없어요");
    load(n);
    flash("직전 선택지로 돌아왔어요");
  };
  // 터치 화면: 「◀ 선택지」는 두 번 눌러야 돌아감 (선택지 누르다 잘못 닿는 것 방지)
  const [backArm, setBackArm] = useState(false);
  useEffect(() => {
    if (!backArm) return;
    const id = window.setTimeout(() => setBackArm(false), 2500);
    return () => window.clearTimeout(id);
  }, [backArm]);
  const tapBack = () => {
    const coarse = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
    if (coarse && !backArm) {
      setBackArm(true);
      flash("한 번 더 누르면 직전 선택지로 돌아가요");
      return;
    }
    setBackArm(false);
    backToChoice();
  };
  /** 터치 메뉴 시트 버튼 */
  const mmenu = (k: MmKey) => {
    play("click");
    setQmOpen(false);
    if (k === "save") setPanel("save");
    else if (k === "load") setPanel("load");
    else if (k === "qsave") save("q");
    else if (k === "qload") load("q");
    else if (k === "back") backToChoice();
    else if (k === "log") setPanel("log");
    else if (k === "rel") setPanel("rel");
    else if (k === "auto") setAuto((v) => !v);
    else if (k === "skip") setSkip((v) => !v);
    else if (k === "hide") {
      setHideUi(true);
      setTouchHint(true);
    }
  };
  const [hasQuick, setHasQuick] = useState(false);
  const [recap, setRecap] = useState<{ s: GState; n: number } | null>(null);
  useEffect(() => {
    if (!recap) return;
    const id = window.setTimeout(() => setRecap(null), 3600);
    return () => window.clearTimeout(id);
  }, [recap]);
  /** 지난 대사 → 그 줄로 되돌아가기 확인 (log 번호) */
  const [askJump, setAskJump] = useState<number | null>(null);
  const jumpToLine = (i: number) => {
    const st = log[i]?.st;
    if (!st || !s) return;
    voice(null);
    setLastSay(null);
    setLog((l) => l.slice(0, i));
    // 플레이 시간은 지금까지 그대로 (되감아도 시간은 흐른 것)
    setS({ ...st, vars: { ...st.vars, _sec: withTime(s).vars._sec ?? 0 }, seq: s.seq + 1, fx: [] });
    setPanel(null);
    flash("그 대사로 돌아왔어요");
  };
  /** 저장 칸 덮어쓰기 확인 */
  const [askOver, setAskOver] = useState<string | null>(null);
  useEffect(() => {
    if (phase === "game") setHasQuick(!!readSave("q"));
  }, [phase]);
  const latestSave = useMemo(() => {
    if (phase !== "title") return null;
    let best: { n: string; ts: number } | null = null;
    for (const n of [...SLOTS, "q"]) {
      const d = readSave(n);
      if (d && (!best || d.ts > best.ts)) best = { n, ts: d.ts };
    }
    return best?.n ?? null;
  }, [phase]);
  // 전체화면은 무대(Stage)가 맡음 — 진짜 전체화면 / 아이폰은 화면 덮기
  const toggleFull = () => stage.toggleFs();
  const toggleMute = () => {
    setMuted((m) => {
      LS.set(KEY.mute, m ? "0" : "1");
      return !m;
    });
  };

  // ---------- 그리기 ----------
  const disp = viewDisp ?? undefined;
  // 커튼이 닫히는 동안엔 새 대사 · 선택지 · 폰 등을 아직 안 보여 줌
  const rb = held ? null : block;
  const secretOpen = rb?.k === "choice" && rb.opts.some((o) => o.secret);
  const readOpen = rb?.k === "choice" && rb.opts.some((o) => o.read);
  // 일정 고르기 · ✦ 준비해 둔 덕분(선택지 · 서술) 첫 등장
  const planOpen = rb?.k === "free";
  const prepOpen = (rb?.k === "choice" && rb.opts.some((o) => o.prep)) || (rb?.k === "say" && rb.text.startsWith("✦"));
  useEffect(() => {
    if (planOpen) coach("plan");
  }, [planOpen, coach]);
  useEffect(() => {
    if (prepOpen) coach("prep");
  }, [prepOpen, coach]);
  // ★ 와 ✎ 가 같이 처음 뜨면 ★ 먼저, ✎ 는 줄 서서 다음에
  useEffect(() => {
    if (secretOpen) coach("secret");
  }, [secretOpen, coach]);
  const tellOpen = rb?.k === "choice" && !!rb.tell && !!s && tellKnown(rb.tell, s.vars);
  useEffect(() => {
    if (readOpen) coach("read");
  }, [readOpen, coach]);
  useEffect(() => {
    if (tellOpen) coach("tell");
  }, [tellOpen, coach]);
  // 서브 캐릭터를 먼저 그려서(뒤쪽) 히로인이 앞에 오게
  const chars = disp
    ? (Object.entries(disp.chars) as [CharKey, NonNullable<(typeof disp.chars)[CharKey]>][]).sort(
        (a, b) =>
          Number((SUBS as readonly string[]).includes(b[0])) -
          Number((SUBS as readonly string[]).includes(a[0]))
      )
    : [];
  const maxDist = chars.reduce((m, [, c]) => Math.max(m, c.dist), 0);
  const speaker = rb?.k === "say" ? rb.who : null;
  const ending = rb?.k === "ending" ? ENDINGS.find((e) => e.id === rb.id) : null;

  return (
    <div ref={wrap} className="lv-root" style={{ "--lv-box": cfg.box, "--lv-fs": cfg.fs } as React.CSSProperties}>
      <div
        className={`lv-stage ${phase === "game" && disp?.memory != null ? "lv-mem-on" : ""} ${phase === "game" && disp?.cg && disp.cgfx?.mono ? "lv-cgmono" : ""}`}
        onClick={() => {
          if (phase !== "game" || hideUi || held) return;
          if (cgIntro) return setCgIntro(null);
          advance();
        }}
        // 메뉴 버튼 소리: 마우스를 올리면 작은 틱, 누르면 확정음 (선택지 · 카드 · 미니게임은 자체 소리)
        onPointerOver={(e) => {
          if (e.pointerType !== "mouse") return;
          const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button:not(:disabled)");
          if (b === hoverEl.current) return;
          hoverEl.current = b;
          if (!b || b.closest(".lv-mini, .lv-sp") || Date.now() - hoverAt.current < 45) return;
          hoverAt.current = Date.now();
          play("hover");
        }}
        onClickCapture={(e) => {
          const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button:not(:disabled)");
          if (!b || b.closest(".lv-mini, .lv-sp, .lv-phone") || b.matches(".lv-choice, .lv-plan, .lv-free, .lv-voice, .lv-slot, [data-nosfx]")) return;
          play("select");
        }}
        // 휠: 전체화면에서만 (창 모드에선 페이지 스크롤과 겹침) — 위 = 지난 대사, 아래 = 다음
        onWheel={(e) => {
          if (phase !== "game" || !document.fullscreenElement || hideUi || held || panel) return;
          const now = Date.now();
          if (now - wheelAt.current < 280) return;
          wheelAt.current = now;
          if (e.deltaY < 0) setPanel("log");
          else if (e.deltaY > 0) advance();
        }}
        // 우클릭 = 대사창 숨기기
        onContextMenu={(e) => {
          if (phase !== "game") return;
          e.preventDefault();
          if (panel) setPanel(null);
          else setHideUi((v) => !v);
        }}
      >
        {/* ===== 타이틀 ===== */}
        {(phase === "title" || phase === "name" || phase === "gallery") && (
          <div className="absolute inset-0">
            {/* 타이틀 키아트 (GPT 시안 그대로 — 캐릭터 둘 + 펍) */}
            <div
              className="absolute inset-0 bg-cover bg-center transition-[filter] duration-500"
              style={{
                backgroundImage: `url("${titleBg}")`,
                filter: phase !== "title" ? "blur(4px) brightness(.55)" : undefined,
              }}
            />
            <div className="lv-title-sparks" />
            {phase === "title" && (
              <div className="absolute inset-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={TITLE.logo} alt="올인 러브" className="lv-title-logo" />
                <div className="absolute left-1/2 top-[47%] flex w-[21%] -translate-x-1/2 flex-col gap-[1.05cqw]">
                  <button className="lv-title-btn" onClick={() => setPhase("name")}>
                    <span className="lv-suit">♠</span>처음부터
                  </button>
                  <button
                    className="lv-title-btn"
                    disabled={!latestSave}
                    onClick={() => latestSave && load(latestSave)}
                  >
                    <span className="lv-suit text-[#e0505e]">♥</span>이어하기
                  </button>
                  <button className="lv-title-btn" onClick={() => setPanel("load")}>
                    <span className="lv-suit text-[#e0505e]">♦</span>불러오기
                  </button>
                  <button className="lv-title-btn" onClick={() => setPanel("config")}>
                    <span className="lv-suit">⚙</span>환경 설정
                  </button>
                  <button className="lv-title-btn" onClick={() => setPhase("gallery")}>
                    <span className="lv-suit">♣</span>엔딩 · 회상
                    <span className="lv-title-count">
                      <b>{endings.length + cgs.length}</b>
                      <i>/</i>
                      {ENDINGS.length + CG_ORDER.length}
                    </span>
                  </button>
                </div>
                {endings.length > 0 && (
                  <div className="lv-title-clear" title="트루 · 그랜드 엔딩">
                    {(
                      [
                        ["amy", "♥"],
                        ["yeon", "♠"],
                        ["grand", "★"],
                      ] as const
                    ).map(([k, ic]) => {
                      const on = titleOpen.includes(k);
                      return (
                        <button
                          key={k}
                          disabled={!on}
                          className={`${on ? "lv-clear-on" : ""} ${titleV === k ? "lv-clear-sel" : ""}`}
                          title={on ? (titleV === k ? "기본 타이틀로" : "이 타이틀로 바꾸기") : "트루 엔딩을 보면 열려요"}
                          onClick={() => {
                            const v = titleV === k ? "base" : k;
                            setTitlePick(v);
                            LS.set("love:titlev", v);
                          }}
                        >
                          <b>{ic}</b>
                          {TITLE_ALT[k].label}
                        </button>
                      );
                    })}
                  </div>
                )}
                <button className="lv-title-story" onClick={() => setPanel("story")}>
                  <span>◇</span> 줄거리 · 인물
                </button>
                <div className="absolute bottom-[2.2%] right-[2%] text-[1cqw] text-[#e9d9b0]/70">
                  ◇ Ver. 1.0 베타
                </div>
                {isAdmin && (
                  <div className="lv-admin-box" onClick={(e) => e.stopPropagation()}>
                    <div className="lv-admin-h">관리자 · 엔딩 길잡이</div>
                    <select
                      value={guideTarget ?? ""}
                      onChange={(e) => setGuideTarget((e.target.value || null) as EndingId | null)}
                    >
                      <option value="">끔 (모든 선택지)</option>
                      {ENDINGS.map((e) => (
                        <option key={e.id} value={e.id}>
                          #{e.no} {e.title} ({KIND_KO[e.kind]})
                        </option>
                      ))}
                    </select>
                    <div className="lv-admin-sub">
                      켜 두고 처음부터 · 불러오기 하면 그 엔딩으로 가는 선택지만 보여요
                    </div>
                  </div>
                )}
              </div>
            )}
            {phase === "name" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-[1.2cqw]">
                <div className="lv-name-teaser">
                  <p>3년 전, 손이 제일 빠른 꾼이었던 남자.</p>
                  <p>다시는 테이블에 앉지 않겠다고 정한 그가, 홀덤펍 「HOUSE」의 딜러가 된다.</p>
                  <button onClick={() => setPanel("story")}>줄거리 · 인물 먼저 보기 ›</button>
                </div>
                <div className="text-[1.8cqw] text-white/85">주인공 이름</div>
                <input
                  value={name}
                  maxLength={6}
                  onChange={(e) => setName(e.target.value.trim() || "")}
                  onKeyDown={(e) => e.key === "Enter" && name && newGame()}
                  className="w-[24cqw] rounded-[0.6cqw] border border-[#c9a25a] bg-black/60 px-[1cqw] py-[0.6cqw] text-center text-[2cqw] text-white outline-none"
                />
                <div className="flex gap-[1cqw]">
                  <button className="lv-btn-gold" disabled={!name} onClick={newGame}>
                    시작
                  </button>
                  <button className="lv-btn-ghost" onClick={() => setPhase("title")}>
                    돌아가기
                  </button>
                </div>
              </div>
            )}
            {phase === "gallery" && (
              <Gallery
                got={endings}
                cgs={cgs}
                cgvs={cgvs}
                isAdmin={isAdmin}
                onCredit={(id) => {
                  setCreditPreview(id);
                  setPhase("credits");
                }}
                onBack={() => setPhase("title")}
                onPlay={(id) => bgm(id)}
                ctl={bgmCtl}
              />
            )}
          </div>
        )}

        {/* ===== 관리자: 엔딩별 크레딧 미리 보기 ===== */}
        {phase === "credits" && creditPreview && (() => {
          const e = ENDINGS.find((x) => x.id === creditPreview)!;
          return (
            <CreditRoll
              ending={e}
              name={name}
              onMusic={() => bgm("credits")}
              stats={{ sec: 0, lA: 0, lY: 0, ch: 0, mini: 0, cg: cgs.length, cgAll: CG_ORDER.length, end: endings.length, endAll: ENDINGS.length, preview: true }}
              photos={rollPhotos(e.id, CG_ORDER)}
              onDone={() => setPhase("gallery")}
            />
          );
        })()}

        {/* ===== 음성 검수 (개발 중) ===== */}
        {phase === "review" && (
          <VoiceReview
            name={name}
            last={reviewId}
            onJump={jumpReview}
            onBack={() => setPhase("title")}
          />
        )}

        {/* ===== 그림 에셋 보기 (?review=assets) ===== */}
        {phase === "assets" && <AssetReview onBack={() => setPhase("title")} />}

        {/* ===== 본편 ===== */}
        {phase === "game" && s && disp && (
          <>
            <Bg id={disp.bg} blur={maxDist} />
            {/* 비 오는 골목 배경엔 빗줄기가 실제로 떨어짐 */}
            {disp.bg === "alley" && !disp.cg && <div className="lv-rain" />}
            {reviewId && (
              <button
                className="lv-btn-gold absolute left-[1.5cqw] top-[1.5cqw] z-[60] !text-[1.1cqw]"
                onClick={(e) => {
                  e.stopPropagation();
                  backReview();
                }}
              >
                ← 음성 목록
              </button>
            )}
            {ghosts
              .filter((g) => !disp.chars[g.k])
              .map((g) => (
                <Sprite
                  key={g.k}
                  who={g.k}
                  pos={g.c.pos}
                  dist={g.c.dist}
                  face={(g.c.face as Face) ?? "base"}
                  fxN={0}
                  dim={false}
                  sub={(SUBS as readonly string[]).includes(g.k) && g.k !== "boss"}
                  outfit={g.outfit}
                  leaving
                />
              ))}
            {chars.map(([k, c]) => {
              const pos = chars.length === 1 && c.dist > 0 ? "c" : c.pos;
              const face: Face =
                liveReact?.who === k ? liveReact.face : ((c.face as Face) ?? "base");
              // 말 꺼내는 순간: 동요 대사면 흔들림, 놀람 표정이면 폴짝 / 반응 때도 폴짝
              const fx =
                liveReact?.who === k
                  ? { kind: "hop" as const, n: liveReact.n }
                  : speaker === k &&
                      rb?.k === "say" &&
                      (rb.mood === "shake" || rb.mood === "shout")
                    ? { kind: "shake" as const, n: s.seq }
                    : speaker === k && face === "surprise"
                      ? { kind: "hop" as const, n: s.seq }
                      : null;
              // 서브(태양 · 정민 · 이모)는 작게 · 차분하게 · 히로인 뒤로 — 튀지 않게
              const isSub = (SUBS as readonly string[]).includes(k) && k !== "boss";
              return (
                <Sprite
                  key={k}
                  who={k}
                  pos={pos}
                  dist={c.dist}
                  face={face}
                  fxKind={fx?.kind}
                  fxN={fx?.n ?? 0}
                  dim={!!speaker && speaker !== k && chars.length > 1}
                  sub={isSub}
                  side={isSub && chars.length > 1}
                  outfit={disp.outfit?.[k]}
                />
              );
            })}
            {disp.cg ? (
              <CgView
                key={disp.cg}
                id={disp.cg}
                v={disp.cgv}
                cam={disp.cgcam}
                fx={disp.cgfx}
                beatVol={muted ? 0 : cfg.sfx}
              />
            ) : (
              cgGhost && <CgView key={cgGhost.id} id={cgGhost.id} v={cgGhost.v} leaving beatVol={0} />
            )}
            {disp.memory != null && <MemoryFx text={disp.memory} />}
            {liveReact && !disp.cg && disp.chars[liveReact.who] && (
              <ReactBubble
                x={
                  POS_X[
                    chars.length === 1 && disp.chars[liveReact.who]!.dist > 0
                      ? "c"
                      : disp.chars[liveReact.who]!.pos
                  ]
                }
                dist={disp.chars[liveReact.who]!.dist}
                text={sub(liveReact.text)}
              />
            )}
            {disp.day && !hideUi && (
              <div className="lv-day">
                <span className="text-[#ffd27a]">♠</span> DAY {disp.day.d} · {disp.day.slot}
              </div>
            )}
            {disp.day && !hideUi && (
              <RelHud vars={s.vars} dot={relNew} onOpen={() => setPanel("rel")} />
            )}
            {tellUp && tellById(tellUp.id) && (
              <div key={`tell-${tellUp.n}`} className="lv-tellup">
                <span className="text-[#ffd27a]">✎ 읽기 노트</span> {NAME[tellById(tellUp.id)!.who]} — {tellById(tellUp.id)!.name}
              </div>
            )}
            {mindDay && (
              <div
                key={mindDay.n}
                className={`lv-mindday${coachId === "mindday" ? " lv-hold" : ""}`}
                onClick={(e) => (e.stopPropagation(), setMindDay(null))}
              >
                <small>DAY {mindDay.day} · 알게 된 것</small>
                {mindDay.items.map((m) => (
                  <p key={m.id}>
                    <em style={{ color: m.who === "both" ? "#ffd27a" : NAME_COLOR[m.who] }}>
                      ✎ {m.who === "both" ? "두 사람" : NAME[m.who]}
                    </em>{" "}
                    {m.note}
                  </p>
                ))}
              </div>
            )}
            {skillUp && (
              <div
                key={`skill-${skillUp.n}`}
                className={`lv-skillup${coachId === "skill" ? " lv-hold" : ""}`}
              >
                <b>✦ 딜러 실력 — 「{SKILL_NAME[skillUp.stage]}」</b>
                <span>{SKILL_LINE[skillUp.stage]}</span>
              </div>
            )}
            {noteUp && (
              <div key={`note-${noteUp.n}`} className={`lv-noteup${coachId === "hint" || coachId === "item" ? " lv-hold" : ""}`}>
                {noteUp.icon && <SmallIcon id={noteUp.icon} className="lv-noteup-icon" />}
                <b>{noteUp.head}</b> {noteUp.text}
              </div>
            )}
            {stageUp && (
              <div key={`stage-${stageUp.n}`} className={`lv-stageup ${stageUp.who === "amy" ? "lv-heart-a" : "lv-heart-y"}`}>
                <span>♥</span> {NAME[stageUp.who]} — 「{STAGE_NAME[stageUp.who][stageUp.stage]}」
              </div>
            )}

            {/* 대사 */}
            {rb?.k === "say" && !hideUi && (
              <div className={`lv-dlg-gate ${cgIntro ? "lv-dlg-hold" : ""}`}>
              <Dialogue
                key={rb.mood === "shake" || rb.mood === "shout" ? s.seq : "box"}
                who={rb.who}
                mood={rb.mood}
                name={sub(NAME[rb.who])}
                portrait={portraitStyle(rb.who, disp)}
                text={fullText.slice(0, typed)}
                done={!typing}
                onReplay={
                  voiceOf(rb.who, rb.text) ? () => voice(voiceOf(rb.who, rb.text)!) : undefined
                }
                read={readNow}
              />
              </div>
            )}

            {/* 선택지 아래 직전 대사 (흐리게 · 넘김 표시 없이) */}
            {rb?.k === "choice" && !hideUi && lastSay && (
              <Dialogue
                key="box-under-choice"
                who={lastSay.who}
                mood={lastSay.mood === "whisper" || lastSay.mood === "think" ? lastSay.mood : "normal"}
                name={sub(NAME[lastSay.who])}
                portrait={portraitStyle(lastSay.who, disp)}
                text={sub(lastSay.text)}
                done={false}
              />
            )}

            {/* 하단 빠른 메뉴 — 왼쪽은 저장 · 불러오기, 오른쪽은 읽기 (테두리 없는 글자 버튼) */}
            {!hideUi && !touch && (rb?.k === "say" || rb?.k === "choice") && (
              <>
                <div className="lv-qm lv-qm-l" onClick={(e) => e.stopPropagation()}>
                  <QBtn onClick={() => setPanel("save")}>SAVE</QBtn>
                  <QBtn onClick={() => setPanel("load")}>LOAD</QBtn>
                  <i className="lv-qm-sep" />
                  <QBtn title="빠른 저장 (슬롯 하나)" nosfx onClick={() => save("q")}>
                    Q.SAVE
                  </QBtn>
                  <QBtn title="빠른 저장한 곳 불러오기" disabled={!hasQuick} onClick={() => load("q")}>
                    Q.LOAD
                  </QBtn>
                </div>
                <div className="lv-qm lv-qm-r" onClick={(e) => e.stopPropagation()}>
                  <QBtn title="직전 선택지로 돌아가기" on={backArm} onClick={tapBack}>
                    {backArm ? "◀ 한 번 더" : "◀ 선택지"}
                  </QBtn>
                  <QBtn title="지난 대사 (L)" onClick={() => setPanel("log")}>
                    LOG
                  </QBtn>
                  <QBtn title="두 사람과의 관계 · 그녀 노트 (R)" onClick={() => setPanel("rel")}>
                    <span className="relative">
                      관계
                      {relNew && <i className="lv-new-dot" />}
                    </span>
                  </QBtn>
                  <i className="lv-qm-sep" />
                  <QBtn title="자동 넘김 (A)" on={auto} onClick={() => setAuto((a) => !a)}>
                    AUTO
                  </QBtn>
                  <QBtn title="읽은 대사를 다음 선택지까지 넘겨요 (Ctrl 누르는 동안)" on={skip} onClick={() => setSkip((v) => !v)}>
                    SKIP
                  </QBtn>
                  <QBtn
                    title="대사창을 숨기고 그림 보기 (H · 캐릭터를 누르면 반응해요)"
                    onClick={() => {
                      setHideUi(true);
                      setTouchHint(true);
                    }}
                  >
                    HIDE
                  </QBtn>
                </div>
              </>
            )}
            {heartPop && (
              <div
                key={`hp-${heartPop.n}`}
                className={`lv-heart-pop ${heartPop.who === "amy" ? "lv-heart-a" : "lv-heart-y"}`}
              >
                ♥
              </div>
            )}
            {tiltFx && <div key={`tilt-${tiltFx}`} className="lv-tiltfx" />}
            {heartDown && (
              <div
                key={`hd-${heartDown.n}`}
                className={`lv-heart-down ${heartDown.who === "amy" ? "lv-heart-a" : "lv-heart-y"} ${heartPop ? "lv-heart-down-2" : ""}`}
              >
                <span className="lv-heart-down-l">♥</span>
                <span className="lv-heart-down-r">♥</span>
              </div>
            )}
            {touch && !hideUi && (rb?.k === "say" || rb?.k === "choice") && (
              <button
                type="button"
                className="lv-mmenu-btn"
                aria-label="메뉴"
                onClick={(e) => {
                  e.stopPropagation();
                  play("click");
                  setQmOpen(true);
                }}
              >
                <span aria-hidden="true">☰</span> 메뉴
                {relNew && <i className="lv-new-dot" />}
              </button>
            )}
            {touch && qmOpen && (
              <div className="lv-mmenu" onClick={(e) => (e.stopPropagation(), setQmOpen(false))}>
                <div className="lv-mmenu-sheet" onClick={(e) => e.stopPropagation()}>
                  {MM_ITEMS.map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className="lv-mmenu-item"
                      disabled={k === "qload" && !hasQuick}
                      onClick={() => mmenu(k)}
                    >
                      {k === "auto" && auto ? "자동 넘김 끄기" : k === "skip" && skip ? "스킵 끄기" : label}
                      {k === "rel" && relNew && <i className="lv-new-dot" />}
                    </button>
                  ))}
                  <button type="button" className="lv-mmenu-item lv-mmenu-close" onClick={() => setQmOpen(false)}>
                    닫기
                  </button>
                </div>
              </div>
            )}
            <div className="lv-top-right" onClick={(e) => e.stopPropagation()}>
              <IconBtn title="환경 설정" onClick={() => setPanel("config")}>
                <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
              </IconBtn>
              <IconBtn title={muted ? "소리 켜기" : "소리 끄기"} onClick={toggleMute}>
                <path d="M11 5 6 9H2v6h4l5 4V5Z" />
                {muted ? (
                  <path d="m23 9-6 6M17 9l6 6" />
                ) : (
                  <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
                )}
              </IconBtn>
              <IconBtn title="전체화면" onClick={toggleFull}>
                <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
              </IconBtn>
              <IconBtn title="메뉴로 나가기 (Esc)" onClick={() => setAskExit(true)}>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="m16 17 5-5-5-5M21 12H9" />
              </IconBtn>
            </div>
            {askExit && (
              <div
                className="lv-confirm"
                onClick={(e) => {
                  e.stopPropagation();
                  setAskExit(false);
                }}
              >
                <div className="lv-confirm-card" onClick={(e) => e.stopPropagation()}>
                  <b className="lv-confirm-title">정말 메뉴로 나가시겠습니까?</b>
                  <div className="lv-confirm-btns">
                    <button className="lv-btn-ghost" onClick={() => setAskExit(false)}>
                      계속하기
                    </button>
                    <button
                      className="lv-btn-ghost"
                      onClick={() => {
                        save("q");
                        setAskExit(false);
                        bgm(null);
                        setPhase("title");
                      }}
                    >
                      빠른 저장하고 나가기
                    </button>
                    <button
                      className="lv-btn-gold"
                      onClick={() => {
                        setAskExit(false);
                        bgm(null);
                        setPhase("title");
                      }}
                    >
                      나가기
                    </button>
                  </div>
                </div>
              </div>
            )}
            {hideUi && (
              <div
                className="absolute inset-0 z-50"
                onClick={(e) => {
                  e.stopPropagation();
                  // 화면 숨김 중엔 그림 감상 + 터치 반응: 캐릭터를 누르면 반응, 빈 곳을 누르면 대사창 복귀
                  if (touchAt(e.clientX, e.clientY)) return setTouchHint(false);
                  setHideUi(false);
                }}
              >
                {touchHint && chars.some(([k]) => k !== "boss") && (
                  <div className="lv-touch-hint">
                    캐릭터를 눌러 보세요 · 빈 곳을 누르면 돌아가요
                  </div>
                )}
              </div>
            )}

            {/* 선택지 */}
            {rb?.k === "choice" && (
              <div
                className={`lv-choice-in absolute inset-0 z-30 flex flex-col items-center justify-center gap-[1cqw] ${lastSay ? "pb-[13cqw]" : ""} ${rb.big ? "bg-black/55" : "bg-black/35"}`}
                onClick={(e) => e.stopPropagation()}
              >
                {rb.big && <BranchBanner onSave={() => setPanel("save")} />}
                {rb.prompt && (
                  <div className="mb-[0.5cqw] text-[1.6cqw] text-white/85 [text-shadow:0_2px_6px_#000]">
                    {rb.prompt}
                  </div>
                )}
                {rb.tell && tellKnown(rb.tell, s.vars) && tellById(rb.tell) && (
                  <div className="lv-choice-tell">
                    <span className="text-[#ffd27a]">✎ {tellById(rb.tell)!.name}</span> — {tellById(rb.tell)!.meaning}
                  </div>
                )}
                {guideOn && <GuideNote target={guide!.target} ready={guideReady} any={guideAny} />}
                {rb.timer && rb.timeout && !cfg.noTimer && !guideOn && (
                  <ChoiceTimer
                    key={s.seq}
                    sec={rb.timer}
                    paused={!!panel || hideUi}
                    onTick={() => play("tick")}
                    onEnd={() => choose(rb.timeout!)}
                  />
                )}
                {rb.opts.map((o, oi) => guideShow(oi) && (
                  <button
                    key={o.text}
                    className={`lv-choice ${o.secret ? "lv-choice-secret" : ""} ${o.read ? "lv-choice-read" : ""} ${o.prep ? "lv-choice-prep" : ""}`}
                    disabled={guideOn && !guideReady}
                    onClick={() => choose(o)}
                  >
                    {o.secret && <span className="mr-[0.6cqw] text-[#ffd27a]">★</span>}
                    {o.read && <span className="mr-[0.6cqw] text-[#ffe2a0]">✎</span>}
                    {o.prep && <span className="mr-[0.6cqw] text-[#9fe0c4]">✦</span>}
                    {sub(o.text)}
                  </button>
                ))}
                {/* 타이머를 끈 경우 · 관리자 길잡이: 침묵도 버튼으로 */}
                {rb.timer && rb.timeout && (cfg.noTimer || guideOn) && guideShow(rb.opts.length) && (
                  <button
                    className="lv-choice lv-choice-silent"
                    disabled={guideOn && !guideReady}
                    onClick={() => choose(rb.timeout!)}
                  >
                    {sub(rb.timeout.text)}
                  </button>
                )}
              </div>
            )}

            {/* 자유 슬롯 */}
            {rb?.k === "free" && (
              <div
                className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/55"
                onClick={(e) => e.stopPropagation()}
              >
                {rb.big && <BranchBanner onSave={() => setPanel("save")} />}
                <div className="mb-[1.5cqw] text-[2cqw] font-bold text-[#ffd27a]">
                  {rb.prompt}
                </div>
                {guideOn && <GuideNote target={guide!.target} ready={guideReady} any={guideAny} />}
                <div className="lv-free-wrap flex gap-[1.5cqw]">
                  {rb.opts.map((o, oi) => !guideShow(oi) ? null :
                    o.card ? (
                      <button key={o.text} className="lv-plan" onClick={() => choose(o)}>
                        <div className="lv-plan-icon">
                          {o.card.who && FACE_ICON[o.card.who] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={FACE_ICON[o.card.who]} alt="" />
                          ) : o.to && planIcon(o.to) ? (
                            <SmallIcon id={planIcon(o.to)!} fallback={o.card.icon} />
                          ) : (
                            <span>{o.card.icon ?? "◆"}</span>
                          )}
                        </div>
                        <div className="lv-plan-title">{sub(o.text)}</div>
                        <div className="lv-plan-place">{o.card.place}</div>
                        {o.card.who && (
                          <div className={`lv-plan-hearts ${o.card.who === "amy" ? "lv-heart-a" : "lv-heart-y"}`}>
                            {hearts(heroStage(s.vars, o.card.who))}
                          </div>
                        )}
                        {o.card.hint && <div className="lv-plan-hint">{o.card.hint}</div>}
                      </button>
                    ) : (
                      <button key={o.text} className="lv-free" onClick={() => choose(o)}>
                        {sub(o.text)}
                      </button>
                    )
                  )}
                </div>
              </div>
            )}

            {/* 메시지 */}
            {rb?.k === "phone" && (
              <div className="lv-phone-dim absolute inset-0 z-30 bg-black/45" onClick={(e) => e.stopPropagation()}>
                {guideOn && (
                  <div className="absolute left-1/2 top-[3%] -translate-x-1/2">
                    <GuideNote target={guide!.target} ready={guideReady} any={guideAny} />
                  </div>
                )}
                <Phone
                  key={s.seq}
                  from={rb.step.from}
                  msgs={rb.step.msgs.map(sub)}
                  shown={phoneShown}
                  replies={rb.step.replies
                    .filter((_, ri) => guideShow(ri))
                    .map((o) => (o.back ? { ...o, back: o.back.map(sub) } : o))}
                  noIgnore={!guideShow(-1)}
                  slot={disp.day?.slot}
                  open={phoneOpen || skip}
                  onOpen={() => setPhoneOpen(true)}
                  onReply={(o) => {
                    choose(o);
                    const who = rb.step.from;
                    if (o.back?.length) setLog((l) => [...l, ...o.back!.map((text) => ({ who, text }))].slice(-200));
                  }}
                  onIgnore={() => setS(ignorePhone(s, rb.step.ignore))}
                  play={play}
                />
              </div>
            )}

            {/* 걸려 오는 전화 */}
            {rb?.k === "call" && (
              <div className="lv-phone-dim absolute inset-0 z-30 bg-black/45" onClick={(e) => e.stopPropagation()}>
                <IncomingCall
                  key={s.seq}
                  name={rb.name}
                  who={rb.who}
                  onAccept={() => {
                    play("click");
                    setS(next(s));
                  }}
                />
              </div>
            )}
            {/* 통화 중 */}
            {disp?.call && rb?.k !== "call" && <CallChip key={disp.call.name} name={disp.call.name} who={disp.call.who} />}

            {/* 관리자 길잡이: 미니게임을 목표에 맞는 점수로 바로 넘기기 */}
            {rb?.k === "mini" && guideOn && (
              <div className="lv-guide-mini" onClick={(e) => e.stopPropagation()}>
                <GuideNote target={guide!.target} ready={guideReady} any={guideAny} />
                {guideReady &&
                  guideRes!.cands.map((c, ci) =>
                    guideRes!.ok[ci] || !guideAny ? (
                      <button key={c} className="lv-btn-ghost" onClick={() => setS(miniDone(s, rb.step.key, c))}>
                        점수 {c}로 넘기기
                      </button>
                    ) : null
                  )}
              </div>
            )}
            {/* 미니게임 */}
            {rb?.k === "mini" && (
              <div onClick={(e) => e.stopPropagation()}>
                {rb.step.kind === "deal" ? (
                  <DealMini play={play} onDone={(n) => setS(miniDone(s, rb.step.key, n))} />
                ) : rb.step.kind === "poker" ? (
                  <StoryPoker
                    spec={rb.step.poker}
                    play={play}
                    bg={disp.bg === "black" ? "pub" : disp.bg}
                    vars={s.vars}
                    outfit={disp.outfit?.[rb.step.poker.opp]}
                    coach={coach}
                    onDone={(n, eff) => setS(miniDone(s, rb.step.key, n, eff))}
                  />
                ) : rb.step.kind === "match" ? (
                  <HeadsUp
                    key={s.seq}
                    spec={rb.step.match}
                    play={play}
                    bg={disp.bg === "black" ? "pub" : disp.bg}
                    vars={s.vars}
                    outfit={disp.outfit?.[rb.step.match.opp]}
                    coach={coach}
                    onDone={(n, eff) => setS(miniDone(s, rb.step.key, n, eff))}
                  />
                ) : (
                  <TellMini
                    tell={rb.step.tell}
                    onDone={(n) => setS(miniDone(s, rb.step.key, n))}
                  />
                )}
              </div>
            )}

            {/* 날짜 · 제목 카드 */}
            {rb?.k === "day" && (
              <div className="lv-daycard">
                <div className="text-[6cqw] font-black tracking-widest text-white">
                  DAY {rb.d}
                </div>
                <div className="text-[2cqw] text-[#ffd27a]">{rb.slot}</div>
              </div>
            )}
            {rb?.k === "montage" && (
              <Montage key={s.seq} shots={rb.shots} caption={rb.caption} onShutter={() => play("shutter")} />
            )}
            {rb?.k === "recall" && (
              <div key={s.seq} className="lv-recall">
                <div className="lv-recall-t" style={{ color: rb.who === "both" ? "#ffd27a" : NAME_COLOR[rb.who] }}>
                  네가 알아준 것들
                </div>
                {rb.caps.map((c, i) => (
                  <div key={c} className="lv-recall-c" style={{ animationDelay: `${0.6 + i * 0.45}s` }}>
                    {c}
                  </div>
                ))}
              </div>
            )}
            {rb?.k === "title" && (
              <div className="absolute inset-0 z-40 grid place-items-center bg-black">
                <div className="lv-fadein text-center">
                  <div className="text-[4.5cqw] font-black text-white">{rb.text}</div>
                  {rb.sub && (
                    <div className="mt-[0.6cqw] text-[1.6cqw] text-white/60">{rb.sub}</div>
                  )}
                </div>
              </div>
            )}

            {curtain && <div key={curtain.n} className={`lv-curtain lv-curtain-${curtain.kind}`} />}
            {/* 제대로 된 엔딩(트루 · 굿 · 그랜드)은 엔딩 카드 전에 크레딧 롤 (클릭 = 빨리, 넘기기 버튼) */}
            {ending && ROLL_KINDS.includes(ending.kind) && rolled !== s.seq && (
              <CreditRoll
                ending={ending}
                name={name}
                onMusic={() => bgm("credits")}
                stats={rollStats ?? statsOf(s, cgs, endings)}
                photos={rollPhotos(ending.id, cgs)}
                onDone={() => {
                  setRolled(s.seq);
                  window.setTimeout(() => play("stamp"), 4400);
                }}
              />
            )}
            {/* 엔딩 */}
            {ending && (!ROLL_KINDS.includes(ending.kind) || rolled === s.seq) && (
              <div
                className="lv-end-wrap absolute inset-0 z-40 grid place-items-center"
                onClick={(e) => e.stopPropagation()}
              >
                <div className={`lv-end lv-k-${ending.kind}`}>
                  <div
                    className="lv-end-a text-[1.2cqw] tracking-[0.6em] text-white/55"
                    style={{ animationDelay: "0.9s" }}
                  >
                    ENDING {String(ending.no).padStart(2, "0")} / {ENDINGS.length}
                  </div>
                  <div
                    className="lv-end-a lv-end-title mt-[0.8cqw] text-[4.6cqw] font-black"
                    style={{ animationDelay: "1.7s" }}
                  >
                    {ending.title}
                  </div>
                  <div className="lv-end-line" style={{ animationDelay: "2.8s" }} />
                  <div
                    className="lv-end-a mt-[1cqw] text-[1.7cqw] text-white/85"
                    style={{ animationDelay: "3.3s" }}
                  >
                    {ending.copy}
                  </div>
                  {ending.kind === "bad" && (
                    <div
                      className="lv-end-a mt-[1.2cqw] text-[1.15cqw] text-white/45"
                      style={{ animationDelay: "4.1s" }}
                    >
                      다음엔 — {ending.hint}
                    </div>
                  )}
                  <div className="lv-end-stamp" style={{ animationDelay: "4.4s" }}>
                    수집 {endings.length} / {ENDINGS.length}
                  </div>
                  <div
                    className="lv-end-a mt-[2.4cqw] flex justify-center gap-[1cqw]"
                    style={{ animationDelay: "5.2s" }}
                  >
                    {ending.review && (
                      <button
                        className="lv-btn-gold"
                        onClick={() => setS(goScene(s, ending.review!))}
                      >
                        마감 후 반성회
                      </button>
                    )}
                    <button
                      className="lv-btn-ghost"
                      onClick={() => {
                        bgm(null);
                        setPhase("title");
                      }}
                    >
                      타이틀로
                    </button>
                  </div>
                </div>
              </div>
            )}
            {block?.k === "end" && (
              <div
                className="lv-end-wrap absolute inset-0 z-40 grid place-items-center"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="lv-end lv-k-good">
                  <div
                    className="lv-end-a text-[1.2cqw] tracking-[0.6em] text-white/55"
                    style={{ animationDelay: "0.9s" }}
                  >
                    TO BE CONTINUED
                  </div>
                  <div
                    className="lv-end-a lv-end-title mt-[0.8cqw] text-[4cqw] font-black"
                    style={{ animationDelay: "1.7s" }}
                  >
                    {block.text}
                  </div>
                  <div className="lv-end-line" style={{ animationDelay: "2.8s" }} />
                  {block.sub && (
                    <div
                      className="lv-end-a mt-[1cqw] text-[1.5cqw] text-white/75"
                      style={{ animationDelay: "3.3s" }}
                    >
                      {block.sub}
                    </div>
                  )}
                  <div
                    className="lv-end-a mt-[2.4cqw] flex justify-center gap-[1cqw]"
                    style={{ animationDelay: "4.4s" }}
                  >
                    <button
                      className="lv-btn-gold"
                      onClick={() => {
                        bgm(null);
                        setPhase("title");
                      }}
                    >
                      타이틀로
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ===== 백로그 · 저장 · 불러오기 ===== */}
        {panel && (
          <div
            className="lv-panel absolute inset-0 z-[60] flex flex-col bg-[#05070f]/92 p-[2.5cqw] backdrop-blur-[4px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-[1.2cqw] flex items-center justify-between">
              <b className="text-[2cqw] text-[#ffd27a]">
                {panel === "log"
                  ? "지난 대사"
                  : panel === "save"
                    ? "저장"
                    : panel === "config"
                      ? "환경 설정"
                      : panel === "rel"
                        ? "관계"
                        : panel === "story"
                          ? "줄거리 · 인물"
                          : "불러오기"}
              </b>
              <button className="lv-btn-ghost" onClick={() => setPanel(null)}>
                닫기
              </button>
            </div>
            {panel === "story" ? (
              <StoryPanel />
            ) : panel === "config" ? (
              <ConfigPanel cfg={cfg} setCfg={setCfg} onTest={() => play("chip")} onCoach={resetCoach} />
            ) : panel === "rel" ? (
              s && <RelPanel vars={s.vars} />
            ) : panel === "log" ? (
              <LogList
                log={log}
                sub={sub}
                onVoice={(u) => voice(u)}
                onClose={() => setPanel(null)}
                onJump={phase === "game" ? (i) => setAskJump(i) : undefined}
              />
            ) : (
              <div className="grid flex-1 auto-rows-min grid-cols-4 gap-[1cqw] overflow-y-auto pr-[0.6cqw]">
                {[...SLOTS, "q", ...(panel === "load" ? ["a1", "a2", "a3"] : [])].map((n) => {
                  const d = readSave(n);
                  const can = panel === "save" ? n !== "q" && phase === "game" : !!d;
                  return (
                    <Fragment key={n}>
                      {n === "a1" && <div className="lv-slot-sec">자동 저장 · 선택지 직전</div>}
                    <button
                      disabled={!can}
                      className={`lv-slot ${n.startsWith("a") ? "lv-slot-auto" : ""}`}
                      onClick={() => (panel === "save" ? (d ? setAskOver(n) : save(n)) : load(n))}
                    >
                      {d ? <SlotThumb s={d.s} /> : <div className="lv-slot-thumb lv-slot-empty">♠</div>}
                      <div className="text-[1.2cqw] text-[#ffd27a]">
                        {n === "q"
                          ? "QUICK"
                          : n.startsWith("a")
                            ? `자동 · 선택지 ${n.slice(1)}`
                            : `SLOT ${n}`}
                      </div>
                      <div className="mt-[0.4cqw] text-[1.25cqw] text-white/85">
                        {d ? d.label : "비어 있음"}
                      </div>
                      {d && (
                        <div className="mt-[0.3cqw] flex justify-between gap-[0.6cqw] text-[1cqw] text-white/45">
                          <span>{new Date(d.ts).toLocaleString("ko-KR")}</span>
                          {(d.s.vars._sec ?? 0) > 0 && <span>플레이 {fmtTime(d.s.vars._sec ?? 0)}</span>}
                        </div>
                      )}
                    </button>
                    </Fragment>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {askJump != null && (
          <div className="lv-confirm z-[75]" onClick={() => setAskJump(null)}>
            <div className="lv-confirm-card" onClick={(e) => e.stopPropagation()}>
              <b className="lv-confirm-title">이 대사로 돌아갈까요?</b>
              <div className="max-w-[40cqw] text-center text-[1.15cqw] text-white/60">
                「{sub(log[askJump]?.text ?? "")}」
                <br />그 뒤로 고른 선택은 다시 고를 수 있어요. 저장한 칸은 그대로예요.
              </div>
              <div className="lv-confirm-btns">
                <button className="lv-btn-ghost" onClick={() => setAskJump(null)}>
                  취소
                </button>
                <button
                  className="lv-btn-gold"
                  onClick={() => {
                    jumpToLine(askJump);
                    setAskJump(null);
                  }}
                >
                  돌아가기
                </button>
              </div>
            </div>
          </div>
        )}
        {/* 처음 가이드 (코치마크) */}
        {coachId && phase === "game" && GUIDE[coachId] && (
          <CoachMark key={coachId} root={wrap} guide={GUIDE[coachId]} vars={s?.vars ?? {}} onOk={() => coachNext(true)} onMiss={() => coachNext(false)} />
        )}
        {recap && phase === "game" && (
          <div key={recap.n} className="lv-recap" onClick={(e) => (e.stopPropagation(), setRecap(null))}>
            <small>지난 이야기</small>
            <b>{recap.s.disp.day ? `DAY ${recap.s.disp.day.d} · ${recap.s.disp.day.slot}` : "프롤로그"}</b>
            {(["amy", "yeonseo"] as const).map((h) => (
              <p key={h}>
                <em style={{ color: NAME_COLOR[h] }}>{NAME[h]}</em>
                <span className={h === "amy" ? "lv-heart-a" : "lv-heart-y"}>{hearts(heroStage(recap.s.vars, h))}</span>
                「{STAGE_NAME[h][heroStage(recap.s.vars, h)]}」
              </p>
            ))}
            {(recap.s.vars._sec ?? 0) > 0 && <p className="lv-recap-time">플레이 {fmtTime(recap.s.vars._sec ?? 0)}</p>}
          </div>
        )}
        {askOver && (
          <div className="lv-confirm z-[75]" onClick={() => setAskOver(null)}>
            <div className="lv-confirm-card" onClick={(e) => e.stopPropagation()}>
              <b className="lv-confirm-title">
                {askOver === "q" ? "빠른 저장" : `${askOver}번`} 칸에 덮어쓸까요?
              </b>
              <div className="text-[1.15cqw] text-white/55">{readSave(askOver)?.label}</div>
              <div className="lv-confirm-btns">
                <button className="lv-btn-ghost" onClick={() => setAskOver(null)}>
                  취소
                </button>
                <button
                  className="lv-btn-gold"
                  onClick={() => {
                    save(askOver);
                    setAskOver(null);
                  }}
                >
                  덮어쓰기
                </button>
              </div>
            </div>
          </div>
        )}
        {toast && <div className="lv-toast">{toast}</div>}
      </div>
    </div>
  );
}

// ---------- 부품 ----------
/** 배경 — 장소가 바뀌면 이전 배경 위로 새 배경이 천천히 겹쳐 들어옴 (크로스페이드) */
/** 같은 그림을 다른 시간대로 쓸 때의 색보정 */
/** 작은 그림 아이콘: 그림을 불러 보고, 없으면(실패) 이모지 — 그림 파일만 넣으면 바뀜 */
function SmallIcon({ id, className, fallback }: { id: IconId; className?: string; fallback?: string }) {
  const [st, setSt] = useState<"wait" | "ok" | "none">("wait");
  return (
    <>
      {st !== "ok" && <span className={`lv-icon-emoji ${className ?? ""}`}>{fallback ?? ICON[id].emoji}</span>}
      {st !== "none" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={ICON[id].src}
          alt=""
          className={className}
          style={st === "wait" ? { display: "none" } : undefined}
          onLoad={() => setSt("ok")}
          onError={() => setSt("none")}
        />
      )}
    </>
  );
}
const BG_GRADE: Partial<Record<keyof typeof BG, string>> = {};
function Bg({ id, blur }: { id: keyof typeof BG; blur: number }) {
  const [prev, setPrev] = useState<{ cur: keyof typeof BG; old: keyof typeof BG | null }>({
    cur: id,
    old: null,
  });
  if (prev.cur !== id) setPrev({ cur: id, old: prev.cur });
  const layer = (bid: keyof typeof BG, fade: boolean) => {
    const u = bgImage(bid);
    return (
      <div
        key={`${bid}-${fade ? "in" : "out"}`}
        className={`absolute inset-0 bg-cover bg-center transition-[filter] duration-700 ${fade ? "lv-bg-in" : ""}`}
        style={{
          ...(u ? { backgroundImage: u } : { background: BG_FALLBACK[bid] }),
          filter:
            [blur ? `blur(${blur * 3}px) brightness(${1 - blur * 0.13})` : "", BG_GRADE[bid] ?? ""].join(" ").trim() ||
            undefined,
          transform: blur ? "scale(1.04)" : undefined,
        }}
      />
    );
  };
  return (
    <>
      {prev.old && prev.old !== id && layer(prev.old, false)}
      {layer(id, !!prev.old)}
    </>
  );
}

/** 비 오는 바깥 장면 CG — 빗줄기를 위에 덧그림 */
const RAIN_CG: CgId[] = ["y_umbrella", "a_door"];
/**
 * 이벤트 CG: 하얗게 번쩍 → 흐릿하게 확대된 그림이 천천히 초점 잡히며 줌 아웃 · 위아래 시네마 띠 ·
 * 떠다니는 빛 입자 · 오른쪽 위에 잠깐 장면 제목
 */
/** 심장 박동 소리 — 낮은 '두-근' 두 번 (파일 없이 즉석 합성) */
let beatCtx: AudioContext | null = null;
function heartbeat(vol: number) {
  if (vol <= 0 || typeof window === "undefined") return;
  try {
    beatCtx ??= new AudioContext();
    const ctx = beatCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const thump = (at: number, gain: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(62, at);
      o.frequency.exponentialRampToValueAtTime(38, at + 0.16);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start(at);
      o.stop(at + 0.25);
    };
    const t = ctx.currentTime + 0.01;
    thump(t, 0.9 * vol);
    thump(t + 0.27, 0.55 * vol);
  } catch {}
}

function CgView({
  id,
  v,
  cam,
  fx,
  beatVol = 1,
  leaving,
}: {
  leaving?: boolean;
  id: CgId;
  v?: string | null;
  cam?: CgCam | null;
  fx?: { pulse?: boolean; mono?: boolean; slow?: boolean } | null;
  beatVol?: number;
}) {
  const c = CG[id];
  // 라이브 영상: 처음 불러올 땐 재생이 시작된 뒤에야 보이게 (정지 그림 → 영상으로 바뀌는 순간 튀지 않게)
  const [vidReady, setVidReady] = useState<string | null>(null);
  // 심장 박동: 켜져 있는 동안 0.9초마다 두근 (CSS 맥박과 같은 박자)
  const pulse = !!fx?.pulse;
  useEffect(() => {
    if (!pulse) return;
    heartbeat(beatVol);
    const t = window.setInterval(() => heartbeat(beatVol), 900);
    return () => window.clearInterval(t);
  }, [pulse, beatVol]);
  // 카메라: 그림의 (x, y) 를 화면 가운데로 옮긴 뒤 z 배 — 바뀔 때마다 천천히 이동
  const camStyle = cam
    ? { transform: `scale(${cam.z}) translate(${(0.5 - cam.x) * 100}%, ${(0.5 - cam.y) * 100}%)` }
    : undefined;
  return (
    <div
      className={`lv-cg ${leaving ? "lv-cg-out" : ""} ${c.video ? "lv-cg-live" : ""} ${c.tight ? "lv-cg-tight" : ""} ${pulse ? "lv-cg-pulse" : ""} ${fx?.mono ? "lv-cg-mono" : ""} ${fx?.slow ? "lv-cg-slow" : ""}`}
    >
      <div className="lv-cg-cam" style={camStyle}>
      <div className="lv-cg-img" style={{ backgroundImage: `url("${c.src}")` }}>
        {/* 차분: 모두 겹쳐 두고 지금 것만 보이게 — 바뀌면 크로스페이드 */}
        {Object.entries(c.vars ?? {}).map(([k, src]) => (
          <span
            key={k}
            className={`lv-cg-var ${k === v ? "lv-cg-var-on" : ""}`}
            style={{ backgroundImage: `url("${src}")` }}
          />
        ))}
        {/* 살아 있는 CG (그록 루프 mp4) — 있으면 정지 그림 위에서 재생 */}
        {/* 차분이 떠 있으면 영상은 숨김 (영상이 차분 그림을 덮지 않게) */}
        {c.video && (
          <video
            key={c.video}
            src={c.video}
            onPlaying={() => setVidReady(c.video ?? null)}
            autoPlay
            loop
            muted
            playsInline
            className="lv-cg-video absolute inset-0 h-full w-full object-cover"
            style={{ opacity: (v && c.vars?.[v]) || vidReady !== c.video ? 0 : 1 }}
          />
        )}
      </div>
      </div>
      <div className="lv-cg-vignette" />
      {/* 영상 CG 는 영상 안에 비가 있어서 덧그린 빗줄기는 생략 */}
      {RAIN_CG.includes(id) && !c.video && <div className="lv-rain" />}
      <div className="lv-cg-motes">
        {Array.from({ length: 14 }, (_, i) => (
          <i
            key={i}
            style={{
              left: `${(i * 37) % 100}%`,
              animationDelay: `${(i * 0.73) % 6}s`,
              animationDuration: `${7 + (i % 5)}s`,
            }}
          />
        ))}
      </div>
      {!c.tight && <div className="lv-cg-bar lv-cg-bar-t" />}
      <div className="lv-cg-bar lv-cg-bar-b" />
      <div className="lv-cg-title">
        <span className={c.who === "amy" ? "text-[#7fd3ff]" : "text-[#8fa8ff]"}>♥</span> EVENT ·{" "}
        {c.title}
      </div>
      <div className="lv-cg-flash" />
    </div>
  );
}

/**
 * 회상 필터: 종이 질감 · 세피아 · 가장자리 번짐 위에 손글씨 캡션 (지금 장면 그대로 '기억 속'으로).
 * 스탠딩 · 배경 · CG 모두 위에 덮고, 대사창은 그대로 보임
 */
function MemoryFx({ text }: { text: string }) {
  return (
    <div className="lv-memory">
      <div className="lv-memory-paper" />
      {text && (
        <div key={text} className="lv-memory-cap">
          {text}
        </div>
      )}
    </div>
  );
}

const DIST_H = [168, 235, 360];
const DIST_TOP = [3, -1, -9];
const POS_X = { l: 28, c: 50, r: 72 };
/** 서브 캐릭터가 히로인 옆에 설 때 — 화면 가장자리 (몸 절반쯤만 보이게) */
const POS_X_SIDE = { l: 12, c: 50, r: 88 };
/** 머리 위치 (스탠딩 높이 대비 비율) — 반응 말풍선 · 쓰다듬기 판정 */
const HEAD_Y = 0.17;

/**
 * 살아 있는 스탠딩: 숨쉬기 · 표정 갈아 끼우기(얼굴만 다른 같은 크기 그림을 겹쳐서 페이드) · 눈 깜빡임 ·
 * 놀람 폴짝 · 동요 흔들림. 거리 3단계는 위치 · 크기 전환
 */
function Sprite({
  who,
  pos,
  dist,
  dim,
  face: want,
  fxKind,
  fxN,
  sub,
  side,
  outfit,
  leaving,
}: {
  /** 퇴장 중 (서서히 사라짐) */
  leaving?: boolean;
  outfit?: Outfit;
  who: CharKey;
  pos: "l" | "c" | "r";
  dist: 0 | 1 | 2;
  dim: boolean;
  face: Face;
  fxKind?: "hop" | "shake";
  /** 바뀔 때마다 fxKind 애니메이션 한 번 */
  fxN: number;
  /** 서브 캐릭터 (작게 · 차분하게) */
  sub?: boolean;
  /** 서브가 히로인과 같이 있을 때 화면 가장자리로 */
  side?: boolean;
}) {
  // 의상 차분이 있으면 그 옷, 없으면 기본 옷
  const set = (outfit && OUTFITS[who]?.[outfit]) || STAND[who];
  // 그 옷에 없는 표정은 가까운 표정으로 (울음 → 슬픔, 소리 내 웃음 → 미소 …), 그것도 없으면 기본
  const face = [want, ...(FACE_NEAR[want] ?? [])].find((f) => f === "base" || set.faces[f]) ?? "base";
  const body = useRef<HTMLDivElement>(null);

  // 폴짝 · 흔들림 (다시 그리지 않고 애니메이션만)
  useEffect(() => {
    const el = body.current;
    if (!fxKind || !el?.animate) return;
    if (fxKind === "hop")
      el.animate(
        [
          { transform: "translateY(0)" },
          { transform: "translateY(-1.6%)" },
          { transform: "translateY(0)" },
          { transform: "translateY(-0.5%)" },
          { transform: "translateY(0)" },
        ],
        { duration: 420, easing: "ease-out" }
      );
    else
      el.animate(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(-0.9%)" },
          { transform: "translateX(0.9%)" },
          { transform: "translateX(-0.6%)" },
          { transform: "translateX(0.4%)" },
          { transform: "translateX(0)" },
        ],
        { duration: 380, easing: "linear" }
      );
    // fxN 이 바뀔 때만 (같은 대사에서 다시 그려질 땐 안 움직임)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fxN]);

  return (
    <div
      className={`${leaving ? "lv-char-out" : "lv-char-in"} absolute`}
      style={{
        left: `${side ? POS_X_SIDE[pos] : POS_X[pos]}%`,
        top: `${DIST_TOP[dist] + (sub ? 8 : 0)}%`,
        height: `${DIST_H[dist] * (sub ? 0.9 : 1)}%`,
        transform: "translateX(-50%)",
        transition:
          "left .6s cubic-bezier(.2,.8,.2,1), top .6s cubic-bezier(.2,.8,.2,1), height .6s cubic-bezier(.2,.8,.2,1), filter .3s",
        filter: sub
          ? `saturate(.8) brightness(${dim ? 0.55 : 0.92})`
          : dim
            ? "brightness(.62)"
            : undefined,
      }}
    >
      <div ref={body} className="h-full">
        {set.base ? (
          <div className="lv-breathe relative h-full" data-who={who}>
            {/* 기본 그림은 늘 깔아 둠 (표정 그림은 같은 실루엣이라 위에 겹치기만) — 표정이 바뀔 때 비치거나 깜빡이지 않게 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={set.base} alt={NAME[who]} draggable={false} className="h-full w-auto max-w-none" />
            {(Object.entries(set.faces) as [Face, string][]).map(([f, u]) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={f}
                src={u}
                alt=""
                draggable={false}
                className={`lv-face ${face === f ? "lv-face-on" : ""}`}
              />
            ))}
            {/* 평소 얼굴이면 숨쉬기 라이브 루프(있을 때만)를 그 그림 위에 겹쳐 재생 */}
            {set.live && (
              <video
                src={set.live.src}
                autoPlay
                loop
                muted
                playsInline
                className={`lv-face ${face === set.live.face ? "lv-face-on" : ""}`}
              />
            )}
          </div>
        ) : (
          <div className="lv-breathe flex h-full w-[22cqw] items-start justify-center rounded-t-full bg-gradient-to-b from-[#3a2c1e] to-transparent pt-[6cqw] text-[2cqw] text-[#e0b46a]/80">
            {NAME[who]}
          </div>
        )}
      </div>
    </div>
  );
}

/** 반응 말풍선 (방치 · 터치) — 캐릭터 머리 옆 */
function ReactBubble({ x, dist, text }: { x: number; dist: 0 | 1 | 2; text: string }) {
  const right = x <= 50;
  return (
    <div
      className="lv-react"
      style={{
        left: right ? `${x + [9, 12, 17][dist]}%` : undefined,
        right: right ? undefined : `${100 - x + [9, 12, 17][dist]}%`,
        top: `${[DIST_TOP[0] + DIST_H[0] * HEAD_Y * 0.55, 10, 14][dist]}%`,
      }}
    >
      {text}
    </div>
  );
}

/** 대사창 초상 카드: 지금 화면의 그 사람 그림(표정 · 옷 그대로)에서 얼굴만 확대 — 화면에 없으면 기본 그림 */
const PORTRAIT_W = 6.6; // cqw
function portraitStyle(who: Who, disp: GState["disp"] | undefined): React.CSSProperties | undefined {
  if (who === "me" || who === "narr" || !STAND[who]?.base) return undefined;
  const c = disp?.chars[who];
  const outfit = disp?.outfit?.[who];
  const dressed = outfit ? OUTFITS[who]?.[outfit] : undefined;
  const set = dressed || STAND[who];
  const want = (c?.face as Face) ?? "base";
  const face = [want, ...(FACE_NEAR[want] ?? [])].find((f) => f === "base" || set.faces[f]) ?? "base";
  const url = face === "base" ? set.base : set.faces[face];
  const p = (dressed && PORTRAIT[`${who}-${outfit}`]) || PORTRAIT[who];
  if (!url || !p) return undefined;
  const [ar, cx, cy, side] = p;
  const k = PORTRAIT_W / side; // 그림 높이 → cqw
  return {
    backgroundImage: `url(${url})`,
    backgroundSize: `${ar * k}cqw ${k}cqw`,
    backgroundPosition: `${-(cx * ar * k - PORTRAIT_W / 2)}cqw ${-(cy * k - PORTRAIT_W / 2)}cqw`,
  };
}

function Dialogue({
  who,
  mood,
  name,
  portrait,
  text,
  done,
  onReplay,
  read,
}: {
  who: Who;
  mood: string;
  name: string;
  portrait?: React.CSSProperties;
  text: string;
  done: boolean;
  onReplay?: () => void;
  read?: boolean;
}) {
  if (mood === "bare") {
    return (
      <div className="lv-bare pointer-events-none absolute inset-x-[10%] bottom-[10%] z-20 text-center text-[2.4cqw] leading-relaxed text-white [text-shadow:0_2px_10px_#000,0_0_24px_#000]">
        {text}
      </div>
    );
  }
  const narr = who === "narr";
  return (
    <div
      className={`lv-box ${read ? "lv-read" : ""} ${narr ? "lv-box-narr" : ""} ${mood === "whisper" ? "lv-box-whisper" : ""} ${mood === "heart" ? "lv-box-heart" : ""} ${mood === "shake" || mood === "shout" ? "lv-box-jolt" : ""}`}
      style={{ "--nc": NAME_COLOR[who] } as React.CSSProperties}
    >
      {!narr && portrait && (
        <div className="lv-portrait" style={portrait}>
          <span className="lv-portrait-suit">{SUIT[who]}</span>
        </div>
      )}
      {!narr && (
        <div className={`lv-name ${portrait ? "lv-name-p" : ""}`}>
          <span className="lv-name-suit">{SUIT[who]}</span>
          <span className="lv-name-t">{name}</span>
          {onReplay && (
            <button
              className="lv-voice"
              title="음성 다시 듣기"
              onClick={(e) => {
                e.stopPropagation();
                onReplay();
              }}
            >
              ♪
            </button>
          )}
        </div>
      )}
      <div
        className={`lv-text ${narr ? "lv-t-narr" : ""} ${mood === "whisper" ? "lv-t-whisper" : ""} ${mood === "shake" ? "lv-t-shake" : ""} ${mood === "shout" ? "lv-t-shout" : ""} ${mood === "think" ? "lv-t-think" : ""} ${mood === "heart" ? "lv-t-heart" : ""}`}
      >
        {mood === "think" ? `(${text}${done ? ")" : ""}` : text}
        {done && <span className="lv-next">◆</span>}
      </div>
    </div>
  );
}

/** 하단 빠른 메뉴 글자 버튼 */
function QBtn({
  children,
  onClick,
  on,
  title,
  nosfx,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  on?: boolean;
  title?: string;
  nosfx?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`lv-qb ${on ? "lv-qb-on" : ""}`}
      onClick={onClick}
      title={title}
      aria-pressed={on}
      disabled={disabled}
      data-nosfx={nosfx || undefined}
    >
      {children}
    </button>
  );
}

/** 오른쪽 위 아이콘 버튼 (선 아이콘) */
function IconBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button className="lv-ib" onClick={onClick} title={title} aria-label={title}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}

/** 하트 5칸 (단계 0 ~ 5) */
type MmKey = "save" | "load" | "qsave" | "qload" | "back" | "log" | "rel" | "auto" | "skip" | "hide";
const MM_ITEMS: [MmKey, string][] = [
  ["save", "저장"],
  ["load", "불러오기"],
  ["qsave", "빠른 저장"],
  ["qload", "빠른 불러오기"],
  ["back", "◀ 직전 선택지"],
  ["log", "지난 대사"],
  ["rel", "관계 · 그녀 노트"],
  ["auto", "자동 넘김"],
  ["skip", "읽은 대사 스킵"],
  ["hide", "그림만 보기"],
];
const hearts = (n: number) => {
  const k = Math.max(0, Math.min(5, Math.floor(n) || 0));
  return "♥".repeat(k) + "♡".repeat(5 - k);
};

/** 왼쪽 위 날짜 아래: 두 히로인 관계 하트 · 실력 (누르면 관계 화면) */
function RelHud({ vars, onOpen, dot }: { vars: Record<string, number>; onOpen: () => void; dot?: boolean }) {
  return (
    <button
      className="lv-relhud"
      data-coach="relhud"
      onClick={(e) => (e.stopPropagation(), onOpen())}
      title="관계 · 그녀 노트 (R)"
      aria-label="관계 · 그녀 노트 열기 (R)"
    >
      {dot && <i className="lv-new-dot lv-new-dot-hud" />}
      <span className="lv-heart-a">{hearts(heroStage(vars, "amy"))}</span>
      <span className="lv-heart-y">{hearts(heroStage(vars, "yeonseo"))}</span>
      <span className="text-[#ffd27a]">{"✦".repeat(skillOf(vars) + 1)}</span>
    </button>
  );
}

/** 관계 화면: 단계 이름 · 지금 마음 · 실력 · 마음 상태 */
function RelPanel({ vars }: { vars: Record<string, number> }) {
  return (
    <div className="grid flex-1 grid-cols-2 gap-[1.6cqw] overflow-y-auto">
      {(["amy", "yeonseo"] as Heroine[]).map((who) => {
        const st = heroStage(vars, who);
        return (
          <div key={who} className="lv-relcard">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {FACE_ICON[who] && <img src={FACE_ICON[who]} alt="" className="h-[7cqw] w-[7cqw] rounded-full" />}
            <div className="text-[1.9cqw] font-bold" style={{ color: NAME_COLOR[who] }}>
              {NAME[who]}
            </div>
            <div className={`text-[2cqw] tracking-[0.2em] ${who === "amy" ? "lv-heart-a" : "lv-heart-y"}`}>
              {hearts(st)}
            </div>
            <div className="text-[1.5cqw] text-[#ffd27a]">「{STAGE_NAME[who][st]}」</div>
            <div className="text-[1.3cqw] leading-[1.6] text-white/80">{STAGE_LINE[who][st]}</div>
          </div>
        );
      })}
      <MindNotes vars={vars} />
      <TellNotes vars={vars} />
      <div className="lv-relcard col-span-2 !flex-row !justify-around">
        <div>
          <div className="text-[1.2cqw] text-white/55">딜러 실력</div>
          <div className="text-[1.6cqw] text-[#ffd27a]">
            {"✦".repeat(skillOf(vars) + 1)} {SKILL_NAME[skillOf(vars)]}
          </div>
          <div className="max-w-[34cqw] text-[1.05cqw] leading-[1.45] text-white/60">{SKILL_LINE[skillOf(vars)]}</div>
        </div>
        <div>
          <div className="text-[1.2cqw] text-white/55">마음 상태</div>
          <div className="text-[1.6cqw] text-white/85">{tiltName(vars)}</div>
        </div>
        <div>
          <div className="text-[1.2cqw] text-white/55">주머니</div>
          <div className="flex items-center gap-[0.5cqw] text-[1.4cqw] text-white/85">
            {ITEMS.some((k) => (vars[k] ?? 0) >= 1)
              ? ITEMS.filter((k) => (vars[k] ?? 0) >= 1).map((k) => (
                  <span key={k} className="flex items-center gap-[0.3cqw]">
                    <SmallIcon id={k} className="h-[2cqw] w-[2cqw]" />
                    {ICON[k].name}
                  </span>
                ))
              : "비어 있음"}
          </div>
          <div className="max-w-[24cqw] text-[1.05cqw] leading-[1.45] text-white/60">동네 한 바퀴에서 산 물건 · 다음에 그녀를 만나면 건넬 수 있다</div>
          {(vars.tip ?? 0) >= 1 && (
            <div className="mt-[0.3cqw] text-[1.05cqw] text-[#ffd27a]/80">
              근무 팁 봉투 {vars.tip}개 · {(vars.tip ?? 0) >= 3 ? "넉넉하다. 쓸 데가 생길 것 같다" : "손이 풀리면 더 받는다"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 메신저 화면: 스마트폰 프레임 · 상태 표시줄 · 입력 중 표시 · 사진 말풍선 · 답장 (보낸 말풍선이 잠깐 보인 뒤 진행) */
const SLOT_TIME: Record<string, string> = {
  새벽: "03:12",
  아침: "08:40",
  낮: "13:25",
  저녁: "19:05",
  "밤 근무": "22:30",
  "마감 후": "02:14",
  자정: "00:07",
  밤: "23:48",
  "해 질 녘": "19:40",
};
function Phone({
  from,
  msgs,
  shown,
  replies,
  slot,
  open,
  onOpen,
  onReply,
  onIgnore,
  noIgnore,
  play,
}: {
  from: CharKey;
  msgs: string[];
  shown: number;
  replies: Opt[];
  slot?: string;
  open: boolean;
  onOpen: () => void;
  onReply: (o: Opt) => void;
  onIgnore: () => void;
  /** 관리자 길잡이: 무시하면 목표 엔딩에 못 감 → 무시 버튼 숨김 */
  noIgnore?: boolean;
  play: (id: SfxId) => void;
}) {
  const [sent, setSent] = useState<string | null>(null);
  // 보낸 뒤: 안 읽음 "1" → 잠시 뒤 "읽음" → 그다음에야 이야기로 (바로 넘어가면 허전함)
  const [read, setRead] = useState(false);
  // 상대 답장: 읽음 → 입력 중… → 말풍선 하나씩 → 잠깐 머문 뒤 이야기로
  const [back, setBack] = useState<string[]>([]);
  const [backTyping, setBackTyping] = useState(false);
  // 문자가 올 때마다 폰이 부르르 — 진동 소리 + 흔들림 (첫 줄은 벨소리와 겹치니 소리만 생략)
  const [buzz, setBuzz] = useState(false);
  useEffect(() => {
    if (shown < 1) return;
    if (shown > 1) play("buzz");
    setBuzz(true);
    const id = window.setTimeout(() => setBuzz(false), 450);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  const done = shown >= msgs.length;
  const time = (slot && SLOT_TIME[slot]) || "23:48";
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [shown, sent, back, backTyping]);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const send = (o: Opt) => {
    if (sent) return;
    const at = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms));
    // "(…)" 는 보내는 말이 아니라 행동 — 화면을 쥐는 건 말풍선 없이 잠깐 머문 뒤 넘어가고,
    // "(…녹음해서 보낸다)" 같은 건 음성 메시지 말풍선으로
    const act = o.text.startsWith("(");
    if (act && !o.text.includes("보낸다")) {
      setSent(" ");
      at(1100, () => onReply(o));
      return;
    }
    play("send");
    setSent(act ? "🎙 음성 메시지 0:07" : o.text);
    at(1000, () => setRead(true));
    const lines = o.back ?? [];
    let t = 1000;
    lines.forEach((line, i) => {
      at(t + 350, () => setBackTyping(true));
      t += 350 + Math.min(1700, 700 + line.length * 45);
      at(t, () => {
        setBackTyping(false);
        setBack((b) => [...b, line]);
        play("buzz");
      });
    });
    at(t + (lines.length ? 1700 : 1300), () => onReply(o));
  };
  // 잠금 화면: 알림 배너가 뜨고, 누르거나 1.4초 뒤 대화방으로
  useEffect(() => {
    if (open) return;
    const id = window.setTimeout(onOpen, 1400);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open)
    return (
      <div
        className={`lv-phone lv-phone-lock ${from === "amy" ? "lv-phone-a" : from === "yeonseo" ? "lv-phone-y" : ""}`}
        onClick={onOpen}
      >
        <div className="lv-phone-island" />
        <div className="lv-lock-time">{time}</div>
        <div className="lv-lock-date">{slot ?? "오늘"}</div>
        <button className="lv-lock-noti" onClick={onOpen}>
          {FACE_ICON[from] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={FACE_ICON[from]} alt="" />
          )}
          <span>
            <b>
              {NAME[from]} <small>지금</small>
            </b>
            <em>{msgs[0]?.startsWith("[사진]") ? "사진을 보냈습니다." : msgs[0]}</em>
            {msgs.length > 1 && <small>메시지 {msgs.length}개</small>}
          </span>
        </button>
        <div className="lv-lock-hint">눌러서 열기</div>
      </div>
    );
  return (
    <div
      className={`lv-phone ${from === "amy" ? "lv-phone-a" : from === "yeonseo" ? "lv-phone-y" : ""} ${buzz ? "lv-phone-buzz" : ""}`}
    >
      <div className="lv-phone-island" />
      <div className="lv-phone-status">
        <span>{time}</span>
        <span className="tracking-[0.15em]">▂▄▆ ◔ ▮▮▮</span>
      </div>
      <div className="lv-phone-head">
        <span className="text-[1.6cqw] text-white/60">‹</span>
        {FACE_ICON[from] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={FACE_ICON[from]} alt="" className="lv-phone-ava" />
        )}
        <div className="leading-tight">
          <b className="text-[1.35cqw]">{NAME[from]}</b>
          <div className="text-[0.85cqw] text-white/55">{done && !backTyping ? "방금" : "입력 중…"}</div>
        </div>
      </div>
      <div ref={list} className="lv-phone-chat">
        <div className="lv-phone-date">{slot ?? "오늘"}</div>
        {msgs.slice(0, shown).map((m, i) => {
          const photo = m.startsWith("[사진]");
          return (
            <div key={i} className="flex items-end gap-[0.5cqw]">
              {FACE_ICON[from] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={FACE_ICON[from]} alt="" className={`lv-phone-ava-s ${i ? "invisible" : ""}`} />
              )}
              {photo ? (
                <PhotoBubble cap={m.replace("[사진]", "").trim()} />
              ) : (
                <div className="lv-bubble">{m}</div>
              )}
              {i === shown - 1 && <span className="mb-[0.2cqw] text-[0.8cqw] text-white/40">{time}</span>}
            </div>
          );
        })}
        {!done && (
          <div className="flex items-end gap-[0.5cqw]">
            {FACE_ICON[from] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={FACE_ICON[from]} alt="" className={`lv-phone-ava-s ${shown ? "invisible" : ""}`} />
            )}
            <div className="lv-bubble lv-typing">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
        {sent?.trim() && (
          <div className="flex items-end justify-end gap-[0.4cqw]">
            <span className={`lv-rcpt ${read ? "on" : ""}`}>{read ? "읽음" : "1"}</span>
            <div className="lv-bubble lv-bubble-me">{sent}</div>
          </div>
        )}
        {back.map((m, i) => (
          <div key={`b${i}`} className="flex items-end gap-[0.5cqw]">
            {FACE_ICON[from] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={FACE_ICON[from]} alt="" className={`lv-phone-ava-s ${i ? "invisible" : ""}`} />
            )}
            <div className="lv-bubble">{m}</div>
            {i === back.length - 1 && !backTyping && (
              <span className="mb-[0.2cqw] text-[0.8cqw] text-white/40">{time}</span>
            )}
          </div>
        ))}
        {backTyping && (
          <div className="flex items-end gap-[0.5cqw]">
            {FACE_ICON[from] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={FACE_ICON[from]} alt="" className={`lv-phone-ava-s ${back.length ? "invisible" : ""}`} />
            )}
            <div className="lv-bubble lv-typing">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
      </div>
      <div className="lv-phone-input">
        {done && !sent ? (
          <>
            <div className="mb-[0.3cqw] text-[0.85cqw] text-white/45">답장 고르기</div>
            <div className="flex flex-col gap-[0.45cqw]">
              {replies.map((o) => (
                <button key={o.text} className="lv-reply" onClick={() => send(o)}>
                  {o.text}
                </button>
              ))}
            </div>
            {!noIgnore && (
              <button className="lv-reply-ignore" onClick={onIgnore}>
                읽고 답장 안 하기
              </button>
            )}
          </>
        ) : (
          <div className="lv-phone-field">{sent?.trim() ? "전송됨" : "메시지 입력"}</div>
        )}
      </div>
    </div>
  );
}

/** 문자 속 사진: 그림이 있으면 사진처럼, 없거나 못 불러오면 📷 자리표시 + 설명 */
function PhotoBubble({ cap }: { cap: string }) {
  const src = PHOTO[cap];
  const [bad, setBad] = useState(false);
  if (src && !bad)
    return (
      <div className="lv-bubble lv-bubble-photo lv-bubble-pic">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={cap} onError={() => setBad(true)} />
      </div>
    );
  return (
    <div className="lv-bubble lv-bubble-photo">
      <div className="lv-photo-pic">📷</div>
      <div className="px-[0.6cqw] py-[0.4cqw] text-[1.05cqw]">{cap}</div>
    </div>
  );
}

/** 걸려 오는 전화: 이름 · 얼굴 · 받기 (거절 없음 — 이야기는 받아야 이어짐) */
function IncomingCall({ name, who, onAccept }: { name: string; who?: CharKey; onAccept: () => void }) {
  const icon = who ? FACE_ICON[who] : undefined;
  return (
    <div className="lv-phone lv-call">
      <div className="lv-phone-island" />
      <div className="lv-call-label">{icon ? "휴대전화" : "발신번호 표시"}</div>
      <div className="lv-call-ava">
        {icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={icon} alt="" />
        ) : (
          <span>?</span>
        )}
        <i />
        <i />
      </div>
      <b className="lv-call-name">{name}</b>
      <div className="lv-call-sub">전화가 왔습니다…</div>
      <div className="lv-call-btns">
        <span className="lv-call-no" title="받아야 이어져요">✕</span>
        <button className="lv-call-yes" onClick={onAccept} title="받기" aria-label="받기">
          <svg viewBox="0 0 24 24" width="55%" height="55%" fill="currentColor" aria-hidden="true">
            <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" />
          </svg>
        </button>
      </div>
      <div className="lv-lock-hint">받기</div>
    </div>
  );
}
/** 통화 중 표시 (위 가운데): 이름 · 경과 시간 */
function CallChip({ name, who }: { name: string; who?: CharKey }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSec((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const icon = who ? FACE_ICON[who] : undefined;
  return (
    <div className="lv-callchip">
      <i />
      {icon && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={icon} alt="" />
      )}
      통화 중 · {name}
      <span>
        {String(Math.floor(sec / 60)).padStart(2, "0")}:{String(sec % 60).padStart(2, "0")}
      </span>
    </div>
  );
}

/** 관계 화면 아래: 읽기 노트 — 사람별로 알게 된 버릇 (모르는 건 ??? + 힌트) */
/** 마음 읽기: 그녀에 대해 아는 것 (모르는 칸은 ??? + 몇 주차) */
function MindNotes({ vars }: { vars: Record<string, number> }) {
  return (
    <div className="lv-relcard col-span-2 !items-stretch !text-left" data-coach="mindnotes">
      <div className="text-[1.6cqw] font-bold text-[#ffd27a]">✎ 그녀에 대해 아는 것</div>
      <div className="mt-[0.6cqw] grid grid-cols-2 gap-x-[2cqw] gap-y-[0.8cqw]">
        {(["amy", "yeonseo"] as const).map((who) => (
          <div key={who}>
            <div className="flex items-baseline justify-between">
              <span className="text-[1.25cqw] font-bold" style={{ color: NAME_COLOR[who] }}>
                {NAME[who]}
              </span>
              <span className="text-[1.05cqw] text-white/50">
                {mindGot(vars, who).length} / {mindTotal(who)}
              </span>
            </div>
            {MIND.filter((m) => m.who === who).map((m) =>
              (vars[m.id] ?? 0) >= 1 ? (
                <div key={m.id} className="text-[1.15cqw] leading-[1.5] text-white/90">
                  · {m.note}
                </div>
              ) : (vars[`h_${m.id}`] ?? 0) >= 1 ? (
                <div key={m.id} className="text-[1.1cqw] leading-[1.5] text-[#ffe2a0]/75">
                  · <b>힌트</b> {MIND_HINT[m.id]} <span className="text-[1cqw] text-white/35">({m.week}주차)</span>
                </div>
              ) : (
                <div key={m.id} className="text-[1.1cqw] leading-[1.5] text-white/35">
                  · ??? <span className="text-[1cqw]">({m.week}주차)</span>
                </div>
              )
            )}
          </div>
        ))}
        {(mindGot(vars, "both").length > 0 || ((vars.meta_trueA ?? 0) >= 1 && (vars.meta_trueY ?? 0) >= 1)) && (
          <div className="col-span-2">
            <div className="flex items-baseline justify-between">
              <span className="text-[1.25cqw] font-bold text-[#ffd27a]">두 사람</span>
              <span className="text-[1.05cqw] text-white/50">
                {mindGot(vars, "both").length} / {mindTotal("both")}
              </span>
            </div>
            {MIND.filter((m) => m.who === "both").map((m) =>
              (vars[m.id] ?? 0) >= 1 ? (
                <div key={m.id} className="text-[1.15cqw] leading-[1.5] text-white/90">
                  · {m.note}
                </div>
              ) : (
                <div key={m.id} className="text-[1.1cqw] leading-[1.5] text-white/35">
                  · ??? <span className="text-[1cqw]">(셋이서 · {m.week}주차)</span>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TellNotes({ vars }: { vars: Record<string, number> }) {
  const whos = [...new Set(TELLS.map((t) => t.who))];
  const got = TELLS.filter((t) => check(t.need, vars)).length;
  return (
    <div className="lv-relcard col-span-2 !items-stretch !text-left">
      <div className="flex items-baseline justify-between">
        <div className="text-[1.6cqw] font-bold text-[#ffd27a]">✎ 읽기 노트</div>
        <div className="text-[1.15cqw] text-white/55">
          {got} / {TELLS.length} · 포커에서 상대 버릇이 보이면 뜻이 같이 떠요
        </div>
      </div>
      <div className="mt-[0.6cqw] grid grid-cols-2 gap-x-[2cqw] gap-y-[0.8cqw]">
        {whos.map((who) => (
          <div key={who}>
            <div className="text-[1.25cqw] font-bold" style={{ color: NAME_COLOR[who] }}>
              {NAME[who]}
            </div>
            {TELLS.filter((t) => t.who === who).map((t) =>
              check(t.need, vars) ? (
                <div key={t.id} className="text-[1.15cqw] leading-[1.5] text-white/90">
                  · <b>{t.name}</b> <span className="text-white/60">— {t.meaning}</span>
                </div>
              ) : (
                <div key={t.id} className="text-[1.1cqw] leading-[1.5] text-white/35">
                  · ??? <span className="text-[1cqw]">({t.hint})</span>
                </div>
              )
            )}
            {reactOf(who)
              .filter((c) => check(c.need, vars))
              .map((c) => (
                <div key={c.id} className="text-[1.15cqw] leading-[1.5] text-white/90">
                  · <b className="text-[#ffe2a0]">반응</b> <span className="text-white/60">{c.text}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 큰 분기점 알림 — 잘 나가는 미연시들처럼 "여기서 저장해 두라"는 신호를 눈에 띄게 */
function BranchBanner({ onSave }: { onSave: () => void }) {
  return (
    <div className="lv-branch">
      <div className="text-[1.05cqw] tracking-[0.5em] text-[#ffd27a]">◆ 분기점 ◆</div>
      <div className="mt-[0.3cqw] text-[1.25cqw] text-white/85">
        이 선택에 따라 이야기가 갈려요. 선택 직전은 자동 저장됐어요.
      </div>
      <button className="lv-branch-save" onClick={onSave}>
        ♠ 지금 슬롯에 저장
      </button>
    </div>
  );
}

const MUSIC: [BgmId, string][] = [
  ["title", "올인 러브 — 메인 테마"],
  ["amy", "딱히, 너 때문은 아니거든 (에이미)"],
  ["yeonseo", "무표정의 온도 (연서)"],
  ["daily", "느슨한 낮"],
  ["comic", "태양과 정민"],
  ["heart", "두근"],
  ["confide", "털어놓는 밤"],
  ["rain", "비 오는 골목"],
  ["threat", "웃는 얼굴"],
  ["spoker", "스토리 포커"],
  ["pub", "HOUSE의 밤"],
  ["night", "마감 후"],
  ["vip", "지하"],
  ["allin", "올인"],
  ["summer", "장마 사이, 여름"],
  ["dawn", "파래지는 창"],
  ["truth", "5년 전 그 판"],
  ["tilt", "기울어진 테이블"],
  ["finale", "새벽 네 시, 마지막 판"],
  ["ending", "비 그친 다음 날 아침"],
  ["morning", "젖은 골목, 맑은 하늘"],
  ["amy_ace", "에이미 — 처음 듣는 목소리"],
  ["yeon_ace", "연서 — 장갑을 벗은 손"],
  ["credits", "엔딩 크레딧"],
  ["badend", "배드 엔딩"],
];

type MusicMode = "one" | "all" | "shuffle";
type MusicCtl = {
  pos: () => [number, number, boolean];
  toggle: () => void;
  seek: (r: number) => void;
  setMode: (m: MusicMode | null, onEnd?: () => void) => void;
};
const MODE_LABEL: Record<MusicMode, string> = { one: "🔂 한 곡 반복", all: "🔁 전체 반복", shuffle: "🔀 섞어 듣기" };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
/** 음악실 아래 재생 막대: 지금 곡 · 진행(눌러서 이동) · 이전/재생·멈춤/다음 */
function MusicBar({ ctl, title, onStep }: { ctl: MusicCtl; title: string; onStep: (d: number | "rand") => void }) {
  const [p, setP] = useState<[number, number, boolean]>([0, 0, true]);
  const [mode, setMode] = useState<MusicMode>("one");
  const stepRef = useRef(onStep);
  useEffect(() => {
    stepRef.current = onStep;
  });
  useEffect(() => {
    ctl.setMode(mode, () => stepRef.current(mode === "shuffle" ? "rand" : 1));
  }, [ctl, mode]);
  useEffect(() => () => ctl.setMode(null), [ctl]);
  useEffect(() => {
    const id = window.setInterval(() => setP(ctl.pos()), 250);
    return () => window.clearInterval(id);
  }, [ctl]);
  const [t, d, paused] = p;
  return (
    <div className="lv-mbar">
      <button onClick={() => onStep(-1)} title="이전 곡">⏮</button>
      <button className="lv-mbar-play" onClick={ctl.toggle} title={paused ? "재생" : "멈춤"}>
        {paused ? "▶" : "❚❚"}
      </button>
      <button onClick={() => onStep(1)} title="다음 곡">⏭</button>
      <div className="lv-mbar-title">♪ {title}</div>
      <div
        className="lv-mbar-track"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          ctl.seek((e.clientX - r.left) / r.width);
        }}
      >
        <i style={{ width: `${d ? (t / d) * 100 : 0}%` }} />
      </div>
      <div className="lv-mbar-time">
        {mmss(t)} / {d ? mmss(d) : "-:--"}
      </div>
      <button
        className="lv-mbar-mode"
        onClick={() => setMode((m) => (m === "one" ? "all" : m === "all" ? "shuffle" : "one"))}
        title="반복 방식 바꾸기"
      >
        {MODE_LABEL[mode]}
      </button>
    </div>
  );
}

/** 회상 CG 확대 보기: 휠 · 더블클릭 = 확대(그 지점 기준), 확대 중 드래그 = 이동, 확대 안 했을 때 클릭 = 다음 장 */
function ZoomMedia({ children, onTap }: { children: React.ReactNode; onTap: () => void }) {
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 });
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const clamp = (s: number, x: number, y: number) => {
    const m = (s - 1) / 2; // 가장자리 밖으로 안 나가게 (비율 단위)
    return { s, x: Math.max(-m, Math.min(m, x)), y: Math.max(-m, Math.min(m, y)) };
  };
  const zoomAt = (ns: number, cx: number, cy: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const s2 = Math.max(1, Math.min(3, ns));
    // 커서 아래 지점이 그대로 있도록 이동량 보정 (화면 비율 좌표)
    const fx = (cx - r.left) / r.width - 0.5;
    const fy = (cy - r.top) / r.height - 0.5;
    setZ((o) => clamp(s2, fx - ((fx - o.x) * s2) / o.s, fy - ((fy - o.y) * s2) / o.s));
  };
  return (
    <div
      ref={box}
      className={`lv-zoom ${z.s > 1 ? "lv-zoom-on" : ""}`}
      onWheel={(e) => {
        e.stopPropagation();
        zoomAt(z.s * (e.deltaY < 0 ? 1.18 : 1 / 1.18), e.clientX, e.clientY);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (z.s > 1) setZ({ s: 1, x: 0, y: 0 });
        else zoomAt(2, e.clientX, e.clientY);
      }}
      onPointerDown={(e) => {
        drag.current = { px: e.clientX, py: e.clientY, x: z.x, y: z.y, moved: false };
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        const r = box.current?.getBoundingClientRect();
        if (!d || !r) return;
        const dx = e.clientX - d.px;
        const dy = e.clientY - d.py;
        if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
        if (z.s > 1 && d.moved) setZ((o) => clamp(o.s, d.x + dx / r.width, d.y + dy / r.height));
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        // 확대 안 한 상태에서 그냥 누르면 다음 장 (확대 중엔 클릭으로 안 넘어감)
        if (d && !d.moved && z.s === 1) window.setTimeout(onTap, 0);
      }}
    >
      <div
        className="lv-zoom-inner"
        style={{ transform: `translate(${z.x * 100}%, ${z.y * 100}%) scale(${z.s})` }}
      >
        {children}
      </div>
      {z.s > 1 ? (
        <button
          className="lv-zoom-reset"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => (e.stopPropagation(), setZ({ s: 1, x: 0, y: 0 }))}
        >
          {Math.round(z.s * 100)}% · 원래대로
        </button>
      ) : (
        <div className="lv-zoom-hint">휠 · 더블클릭으로 확대</div>
      )}
    </div>
  );
}

function Gallery({
  isAdmin,
  onCredit,
  got,
  cgs,
  cgvs,
  onBack,
  onPlay,
  ctl,
}: {
  isAdmin?: boolean;
  onCredit?: (id: EndingId) => void;
  got: EndingId[];
  cgs: CgId[];
  cgvs: string[];
  onBack: () => void;
  onPlay: (id: BgmId) => void;
  ctl: MusicCtl;
}) {
  const [tab, setTab] = useState<"end" | "cg" | "music">("end");
  const [track, setTrack] = useState<BgmId>("title");
  const [view, setView] = useState<CgId | null>(null);
  const [page, setPage] = useState(0);
  // 회상 CG: 히로인별로 거르고 4x3 씩 페이지 넘김
  const [who, setWho] = useState<"all" | "amy" | "yeonseo">("all");
  const [gp, setGp] = useState(0);
  const PER = 12;
  const list = CG_ORDER.filter((id) => who === "all" || CG[id].who === who);
  const gpages = Math.max(1, Math.ceil(list.length / PER));
  const gpage = Math.min(gp, gpages - 1);
  const shown = list.slice(gpage * PER, gpage * PER + PER);
  const seenIn = (ids: CgId[]) => ids.filter((id) => cgs.includes(id)).length;
  // 크게 보기: 원본 + 본 차분 순서대로 (좌우 화살표 · 클릭 = 다음)
  const pages = view
    ? [null, ...Object.keys(CG[view].vars ?? {}).filter((k) => cgvs.includes(cgKey(view, k)))]
    : [];
  // 본 CG 끼리 이어서 넘기기 (크게 보기에서 마지막 차분 다음 → 다음 CG)
  const seenList = list.filter((id) => cgs.includes(id));
  const step = (d: 1 | -1) => {
    if (!view) return;
    const np = page + d;
    if (np >= 0 && np < pages.length) return setPage(np);
    const i = seenList.indexOf(view) + d;
    if (i < 0 || i >= seenList.length) return;
    const nid = seenList[i];
    const nvars = Object.keys(CG[nid].vars ?? {}).filter((k) => cgvs.includes(cgKey(nid, k)));
    setView(nid);
    setPage(d === 1 ? 0 : nvars.length);
    setGp(Math.floor(list.indexOf(nid) / PER));
  };
  useEffect(() => {
    if (tab !== "cg") return;
    const onKey = (e: KeyboardEvent) => {
      if (view) {
        if (e.key === "ArrowRight" || e.key === " ") step(1);
        else if (e.key === "ArrowLeft") step(-1);
        else if (e.key === "Escape") setView(null);
        else return;
      } else {
        if (e.key === "ArrowRight") setGp((p) => Math.min(gpages - 1, p + 1));
        else if (e.key === "ArrowLeft") setGp((p) => Math.max(0, p - 1));
        else return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  return (
    <div className="absolute inset-0 flex flex-col p-[2.5cqw]">
      <div className="mb-[1.2cqw] flex items-center gap-[1.2cqw]">
        <button
          className={`lv-gal-tab ${tab === "end" ? "lv-gal-tab-on" : ""}`}
          onClick={() => setTab("end")}
        >
          엔딩 {got.length} / {ENDINGS.length}
        </button>
        <button
          className={`lv-gal-tab ${tab === "cg" ? "lv-gal-tab-on" : ""}`}
          onClick={() => setTab("cg")}
        >
          회상 CG {cgs.length} / {CG_ORDER.length}
        </button>
        <button
          className={`lv-gal-tab ${tab === "music" ? "lv-gal-tab-on" : ""}`}
          onClick={() => setTab("music")}
        >
          음악
        </button>
        <div className="flex-1" />
        <button className="lv-btn-ghost" onClick={onBack}>
          돌아가기
        </button>
      </div>
      {tab === "cg" && (
        <div
          className="flex min-h-0 flex-1 flex-col"
          onWheel={(e) => {
            if (Math.abs(e.deltaY) < 20) return;
            setGp((p) => Math.max(0, Math.min(gpages - 1, p + (e.deltaY > 0 ? 1 : -1))));
          }}
        >
          <div className="lv-gal-filter">
            {(
              [
                ["all", "전체", CG_ORDER],
                ["amy", "에이미", CG_ORDER.filter((id) => CG[id].who === "amy")],
                ["yeonseo", "연서", CG_ORDER.filter((id) => CG[id].who === "yeonseo")],
              ] as const
            ).map(([k, label, ids]) => (
              <button
                key={k}
                className={`lv-gal-chip ${k === "amy" ? "lv-gal-chip-a" : k === "yeonseo" ? "lv-gal-chip-y" : ""} ${who === k ? "lv-gal-chip-on" : ""}`}
                onClick={() => {
                  setWho(k);
                  setGp(0);
                }}
              >
                {k !== "all" && <span className="lv-gal-chip-suit">{k === "amy" ? "♥" : "♠"}</span>}
                {label}
                <i>
                  {seenIn([...ids])}/{ids.length}
                </i>
              </button>
            ))}
          </div>
          <div key={`${who}-${gpage}`} className="lv-gal-grid">
            {shown.map((id) => {
              const ok = cgs.includes(id);
              const nv = Object.keys(CG[id].vars ?? {}).length;
              return (
                <button
                  key={id}
                  className={`lv-gal-cg ${ok ? "" : "lv-gal-cg-locked"}`}
                  disabled={!ok}
                  onClick={() => {
                    setView(id);
                    setPage(0);
                  }}
                >
                  {ok ? (
                    <span className="lv-gal-cg-img" style={{ backgroundImage: `url("${CG[id].src}")` }} />
                  ) : (
                    <span className="lv-gal-cg-q">
                      <span className={CG[id].who === "amy" ? "text-[#7fd3ff]/25" : "text-[#8fa8ff]/25"}>
                        {CG[id].who === "amy" ? "♥" : "♠"}
                      </span>
                    </span>
                  )}
                  {ok && (CG[id].video || nv > 0) && (
                    <span className="lv-gal-cg-n">
                      {CG[id].video && <b>LIVE</b>}
                      {nv > 0 && (
                        <>
                          {1 + Object.keys(CG[id].vars ?? {}).filter((k) => cgvs.includes(cgKey(id, k))).length}                          <span className="opacity-55">/</span>
                          {1 + nv}
                        </>
                      )}
                    </span>
                  )}
                  <span className="lv-gal-cg-cap">
                    <span className={CG[id].who === "amy" ? "text-[#7fd3ff]" : "text-[#8fa8ff]"}>
                      {CG[id].who === "amy" ? "♥" : "♠"}
                    </span>{" "}
                    {ok ? CG[id].title : "아직 못 본 장면"}
                  </span>
                </button>
              );
            })}
          </div>
          {gpages > 1 && (
            <div className="lv-gal-pager">
              <button className="lv-gal-arrow" disabled={gpage === 0} onClick={() => setGp(gpage - 1)} aria-label="이전 쪽">
                ‹
              </button>
              <div className="flex items-center gap-[0.6cqw]">
                {Array.from({ length: gpages }, (_, i) => (
                  <button
                    key={i}
                    className={`lv-gal-dot ${i === gpage ? "lv-gal-dot-on" : ""}`}
                    onClick={() => setGp(i)}
                    aria-label={`${i + 1}쪽`}
                  />
                ))}
              </div>
              <span className="lv-gal-pno">
                {gpage + 1} / {gpages}
              </span>
              <button className="lv-gal-arrow" disabled={gpage === gpages - 1} onClick={() => setGp(gpage + 1)} aria-label="다음 쪽">
                ›
              </button>
            </div>
          )}
        </div>
      )}
      {tab === "music" && (
        <div className="flex min-h-0 flex-1 flex-col gap-[1cqw]">
        <div className="grid flex-1 grid-cols-3 content-start gap-[0.8cqw] overflow-y-auto pr-[0.6cqw]">
          {MUSIC.map(([id, t], i) => (
            <button
              key={id}
              className={`lv-cfg-step !py-[0.9cqw] !text-left !text-[1.3cqw] ${track === id ? "lv-cfg-on" : ""}`}
              onClick={() => {
                setTrack(id);
                onPlay(id);
              }}
            >
              {String(i + 1).padStart(2, "0")} {track === id ? "♪ " : ""}
              {t}
            </button>
          ))}
        </div>
          <MusicBar
            ctl={ctl}
            title={MUSIC.find(([id]) => id === track)?.[1] ?? ""}
            onStep={(d) => {
              const i = MUSIC.findIndex(([id]) => id === track);
              const j = d === "rand" ? (i + 1 + Math.floor(Math.random() * (MUSIC.length - 1))) % MUSIC.length : i + d;
              const nx = MUSIC[(j + MUSIC.length) % MUSIC.length][0];
              setTrack(nx);
              onPlay(nx);
            }}
          />
        </div>
      )}
      {view && (
        <div className="lv-gal-view">
          <ZoomMedia key={`${view}-${page}`} onTap={() => step(1)}>
            {pages[page] == null && CG[view].video ? (
              <video src={CG[view].video} autoPlay loop muted playsInline className="lv-gal-view-media" />
            ) : (
              <div
                className="lv-gal-view-media lv-gal-view-img"
                style={{ backgroundImage: `url("${cgSrc(view, pages[page])}")` }}
              />
            )}
          </ZoomMedia>
          <div className="lv-gal-view-bar" onClick={(e) => e.stopPropagation()}>
            <span className={CG[view].who === "amy" ? "text-[#7fd3ff]" : "text-[#8fa8ff]"}>
              {CG[view].who === "amy" ? "♥" : "♠"}
            </span>
            <span className="lv-gal-view-title">{CG[view].title}</span>
            {pages.length > 1 && (
              <span className="lv-gal-view-n">
                {page + 1} / {pages.length}
              </span>
            )}
            <span className="flex-1" />
            <button className="lv-gal-arrow" onClick={() => step(-1)} aria-label="이전">
              ‹
            </button>
            <button className="lv-gal-arrow" onClick={() => step(1)} aria-label="다음">
              ›
            </button>
            <button className="lv-gal-close" onClick={() => setView(null)} aria-label="닫기">
              ✕
            </button>
          </div>
        </div>
      )}
      <div className={`grid flex-1 grid-cols-6 gap-[0.8cqw] ${tab === "end" ? "" : "hidden"}`}>
        {ENDINGS.map((e) => {
          const ok = got.includes(e.id);
          return (
            <div
              key={e.id}
              className={`lv-cell lv-k-${e.kind} ${ok ? "" : "lv-cell-locked"}`}
              style={
                ok && (`end_${e.id}` as CgId) in CG
                  ? ({ "--cell-bg": `url("${CG[`end_${e.id}` as CgId].src}")` } as React.CSSProperties)
                  : undefined
              }
            >
              <div className="flex items-center justify-between text-[0.95cqw] text-white/50">
                #{e.no}
                {ok && <span className="lv-cell-kind">{KIND_KO[e.kind]}</span>}
              </div>
              <div className="mt-[0.3cqw] text-[1.3cqw] font-bold">{ok ? e.title : "???"}</div>
              <div className="mt-[0.3cqw] text-[0.95cqw] text-white/60">
                {ok ? e.copy : `조건: ${e.hint}`}
              </div>
              {isAdmin && ROLL_KINDS.includes(e.kind) && (
                <button className="lv-admin-credit" onClick={() => onCredit?.(e.id)}>
                  크레딧 보기
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 환경 설정: 글자 · 오토 속도, 소리 셋, 대사창 투명도, 스킵 범위 (바로 저장) */
function ConfigPanel({
  cfg,
  setCfg,
  onTest,
  onCoach,
}: {
  cfg: Cfg;
  setCfg: (p: Partial<Cfg>) => void;
  onTest: () => void;
  /** 처음 가이드 다시 보기 */
  onCoach?: () => void;
}) {
  // 컴포넌트가 아니라 그냥 함수로 그림 (렌더마다 새 컴포넌트가 되면 슬라이더 드래그가 끊김)
  const row = (label: string, children: React.ReactNode, hint?: string) => (
    <div className="flex items-center gap-[1.5cqw] border-b border-white/10 py-[1cqw]">
      <div className="w-[16cqw] text-[1.45cqw] text-white/85">
        {label}
        {hint && <div className="text-[1cqw] text-white/40">{hint}</div>}
      </div>
      <div className="flex flex-1 items-center gap-[0.8cqw]">{children}</div>
    </div>
  );
  const steps = (v: number, on: (n: number) => void, labels: string[]) =>
    labels.map((l, i) => (
      <button
        key={l}
        className={`lv-cfg-step ${v === i + 1 ? "lv-cfg-on" : ""}`}
        onClick={() => on(i + 1)}
      >
        {l}
      </button>
    ));
  const slider = (v: number, on: (n: number) => void, min = 0) => (
    <>
      <input
        type="range"
        min={min}
        max={100}
        value={Math.round(v * 100)}
        onChange={(e) => on(Number(e.target.value) / 100)}
        onPointerUp={onTest}
        className="lv-cfg-range"
      />
      <span className="w-[4cqw] text-right text-[1.2cqw] text-white/60">{Math.round(v * 100)}</span>
    </>
  );
  return (
    <div className="flex-1 overflow-y-auto pr-[1cqw]">
      {row(
        "글자 속도",
        steps(cfg.text, (n) => setCfg({ text: n }), [
          "느리게",
          "조금 느리게",
          "보통",
          "빠르게",
          "즉시",
        ])
      )}
      {row(
        "오토 속도",
        steps(cfg.auto, (n) => setCfg({ auto: n }), [
          "여유 있게",
          "조금 여유",
          "보통",
          "빠르게",
          "아주 빠르게",
        ]),
        "음성이 있는 줄은 음성이 끝날 때까지 기다려요"
      )}
      {row(
        "배경음악",
        slider(cfg.bgm, (n) => setCfg({ bgm: n }))
      )}
      {row(
        "효과음",
        slider(cfg.sfx, (n) => setCfg({ sfx: n }))
      )}
      {row(
        "음성",
        slider(cfg.voice, (n) => setCfg({ voice: n }))
      )}
      {row(
        "대사창 진하기",
        slider(cfg.box, (n) => setCfg({ box: n }), 30)
      )}
      {row(
        "대사 글자 크기",
        <>
          {([
            [0.9, "작게"],
            [1, "보통"],
            [1.12, "크게"],
          ] as const).map(([v, l]) => (
            <button
              key={v}
              className={`lv-cfg-step ${cfg.fs === v ? "lv-cfg-on" : ""}`}
              onClick={() => setCfg({ fs: v })}
            >
              {l}
            </button>
          ))}
        </>
      )}
      {row(
        "넘길 때 음성",
        <>
          <button
            className={`lv-cfg-step ${cfg.voiceHold ? "lv-cfg-on" : ""}`}
            onClick={() => setCfg({ voiceHold: true })}
          >
            끝까지 듣기
          </button>
          <button
            className={`lv-cfg-step ${!cfg.voiceHold ? "lv-cfg-on" : ""}`}
            onClick={() => setCfg({ voiceHold: false })}
          >
            바로 끊기
          </button>
        </>,
        "끝까지 듣기를 고르면 넘겨도 음성이 끝까지 나와요"
      )}
      {onCoach &&
        row(
          "처음 가이드",
          <button className="lv-cfg-step" onClick={onCoach}>
            다시 보기
          </button>,
          "새 시스템을 처음 만날 때 뜨는 안내를 처음부터 다시 보여 줘요"
        )}
      {row(
        "스킵",
        <>
          <button
            className={`lv-cfg-step ${!cfg.skipAll ? "lv-cfg-on" : ""}`}
            onClick={() => setCfg({ skipAll: false })}
          >
            읽은 대사만
          </button>
          <button
            className={`lv-cfg-step ${cfg.skipAll ? "lv-cfg-on" : ""}`}
            onClick={() => setCfg({ skipAll: true })}
          >
            전부
          </button>
        </>,
        "Ctrl을 누르고 있어도 스킵돼요"
      )}
      {row(
        "시간제한 선택지",
        <>
          <button
            className={`lv-cfg-step ${!cfg.noTimer ? "lv-cfg-on" : ""}`}
            onClick={() => setCfg({ noTimer: false })}
          >
            켬 (10초)
          </button>
          <button
            className={`lv-cfg-step ${cfg.noTimer ? "lv-cfg-on" : ""}`}
            onClick={() => setCfg({ noTimer: true })}
          >
            끔
          </button>
        </>,
        "끄면 '침묵'도 선택지로 나와요"
      )}
      <div className="mt-[1.2cqw] text-[1.05cqw] leading-relaxed text-white/45">
        단축키 — 스페이스 · 엔터 · 클릭: 다음 / Ctrl: 누르는 동안 스킵 / H · 우클릭: 대사창 숨기기 /
        A: 오토 / L · ↑: 지난 대사 / 1~9: 선택지 고르기 / Esc: 창 닫기 / 전체화면에선 휠 ↑ 지난 대사 · 휠 ↓ 다음
      </div>
    </div>
  );
}

/** 지난 대사 — 음성 있는 줄은 ♪ 로 다시 듣기, 열면 맨 아래(최근)부터 */
/** 줄거리 · 인물 — 1주차 초반까지만 (스포일러 없음) */
const STORY_TEXT = [
  "3년 전, 사람들은 그를 \"손이 제일 빠른 꾼\"이라고 불렀다. 큰 판에서 한 번에 무너진 뒤 그는 규칙 하나를 정했다. 다시는 테이블에 앉지 않는다.",
  "남은 건 빚, 그리고 혼자 셔플을 하는 손가락 버릇뿐.",
  "그리고 지금, 성수동 골목 2층 홀덤펍 「HOUSE」. 딜러 알바 첫날.",
  "매일 밤 시끄럽게 지고 가는 금발 대학생과, 매일 밤 말없이 이기고 가는 검은 장갑의 여자. 월급 후한 사장, 밥부터 퍼 주는 주방 이모, 시끄러운 단골 둘. 그리고 지하에는 소문만 무성한 VIP룸.",
  "딜러는 보이지 않는 게 일인데. 첫날부터, 둘이나 나를 봤다.",
];
const STORY_CAST: { who: Who; name: string; tag: string; line: string; quote: string }[] = [
  {
    who: "amy",
    name: "에이미",
    tag: "22 · 대학생 · 편의점 알바",
    line: "매일 밤 7·2로 올인하고 지는 단골. 지면 뾰로통, 이기면 세상을 다 가진 얼굴. 목에는 낡은 군번줄.",
    quote: "\"오늘은 무조건 내가 이겨.\"",
  },
  {
    who: "yeonseo",
    name: "연서",
    tag: "29 · 구석 자리 단골",
    line: "큰 판은 한 번도 지지 않는 손님. 오른손에만 낀 검은 레이스 장갑, 칩은 손가락 세 개로 쌓는다. 첫날부터 딜러의 버릇을 알아봤다.",
    quote: "\"셔플할 때 엄지가 먼저 나가네요.\"",
  },
];
const STORY_SUBS: { who: Who; name: string; line: string }[] = [
  { who: "boss", name: "백상현", line: "「HOUSE」 사장. 늘 웃는 신사. \"테이블은 공평해요.\"" },
  { who: "chunhee", name: "춘희 이모", line: "주방 이모. 주인공의 3년 전을 아는 유일한 어른" },
  { who: "taeyang", name: "태양", line: "허세 담당 단골. 기적을 믿는다" },
  { who: "jeongmin", name: "정민", line: "측정 담당 단골. 모든 걸 기록한다" },
];
function StoryPanel() {
  return (
    <div className="lv-story flex-1 overflow-y-auto pr-[1cqw]">
      <div className="lv-story-text">
        {STORY_TEXT.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <div className="lv-story-cast">
        {STORY_CAST.map((c) => (
          <div key={c.who} className="lv-story-card" style={{ "--nc": NAME_COLOR[c.who] } as React.CSSProperties}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {FACE_ICON[c.who] && <img src={FACE_ICON[c.who]} alt="" />}
            <div>
              <b>{c.name}</b>
              <small>{c.tag}</small>
              <p>{c.line}</p>
              <q>{c.quote}</q>
            </div>
          </div>
        ))}
      </div>
      <div className="lv-story-subs">
        {STORY_SUBS.map((c) => (
          <div key={c.who}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {FACE_ICON[c.who] && <img src={FACE_ICON[c.who]} alt="" />}
            <span>
              <b>{c.name}</b> {c.line}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 지난 대사 한 줄 — st = 그 대사가 떴을 때의 상태 (그 줄로 되돌아가기) */
type LogLine = { who: Who; text: string; pick?: boolean; st?: GState };
function LogList({
  log,
  sub,
  onVoice,
  onClose,
  onJump,
}: {
  log: LogLine[];
  sub: (t: string) => string;
  onVoice: (u: string) => void;
  onClose: () => void;
  onJump?: (i: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, []);
  return (
    <div
      ref={box}
      className="flex-1 space-y-[0.8cqw] overflow-y-auto pr-[1cqw]"
      // 전체화면에서 맨 아래까지 내린 뒤 휠을 한 번 더 내리면 닫힘 (미연시 백로그 관례)
      onWheel={(e) => {
        const el = box.current;
        if (!el || e.deltaY <= 0 || !document.fullscreenElement) return;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) onClose();
      }}
    >
      {log.map((l, i) => {
        if (l.pick)
          return (
            <div key={i} className="lv-log-pick">
              <span>▶ 선택</span> {sub(l.text)}
            </div>
          );
        const v = voiceOf(l.who, l.text);
        return (
          <div key={i} className="lv-log-line flex gap-[0.6cqw] text-[1.45cqw] leading-relaxed">
            <span className="w-[2.2cqw] shrink-0">
              {v && (
                <button className="lv-voice !static" title="다시 듣기" onClick={() => onVoice(v)}>
                  ♪
                </button>
              )}
            </span>
            <span>
              {l.who !== "narr" && <b style={{ color: NAME_COLOR[l.who] }}>{sub(NAME[l.who])} </b>}
              <span
                className={
                  l.who === "narr"
                    ? "text-white/70"
                    : l.who === "me"
                      ? "text-white/90"
                      : "text-white"
                }
              >
                {sub(l.text)}
              </span>
            </span>
            {onJump && l.st && i < log.length - 1 && (
              <button className="lv-log-jump" title="이 대사로 돌아가기" onClick={() => onJump(i)}>
                ↩ 여기로
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 저장 칸 미리보기: 그때 배경(또는 CG) + 서 있던 캐릭터 */
function SlotThumb({ s }: { s: GState }) {
  const cg = s.disp.cg ? cgSrc(s.disp.cg, s.disp.cgv) : null;
  const bg = bgImage(s.disp.bg);
  const ks = (Object.keys(s.disp.chars) as CharKey[]).filter((k) => STAND[k].base);
  return (
    <div
      className="lv-slot-thumb"
      style={
        cg || bg
          ? { backgroundImage: cg ? `url("${cg}")` : bg! }
          : { background: BG_FALLBACK[s.disp.bg] }
      }
    >
      {!cg &&
        ks.slice(0, 3).map((k, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={k}
            src={STAND[k].base!}
            alt=""
            style={{ left: `${(ks.length === 1 ? 50 : 30 + i * 40) - 14}%` }}
          />
        ))}
    </div>
  );
}

/** 크레딧 롤이 나오는 엔딩 (시시한 엔딩엔 없음) */
const ROLL_KINDS: string[] = ["true", "good"];
const KIND_KO: Record<string, string> = { true: "트루", good: "굿", normal: "노멀", bad: "배드", hidden: "히든" };
type RollStats = {
  sec: number;
  lA: number;
  lY: number;
  ch: number;
  mini: number;
  cg: number;
  cgAll: number;
  end: number;
  endAll: number;
  preview?: boolean;
};
const statsOf = (st: GState, cgs: CgId[], endings: EndingId[]): RollStats => ({
  sec: st.vars._sec ?? 0,
  lA: st.vars._lA ?? 0,
  lY: st.vars._lY ?? 0,
  ch: st.vars._ch ?? 0,
  mini: st.vars._mini ?? 0,
  cg: cgs.length,
  cgAll: CG_ORDER.length,
  end: endings.length,
  endAll: ENDINGS.length,
});
/** 그 엔딩 루트에서 본 CG (앨범 사진) — 다른 엔딩의 엔딩 CG 는 빼고 */
function rollPhotos(id: EndingId, seen: CgId[]): { src: string; title: string }[] {
  const who = id.startsWith("amy") ? "amy" : id.startsWith("yeon") ? "yeonseo" : null;
  const own = `end_${id}`;
  return CG_ORDER.filter(
    (c) => seen.includes(c) && (!who || CG[c].who === who) && (!c.startsWith("end_") || c === own)
  ).map((c) => ({ src: CG[c].src, title: CG[c].title }));
}
const fmtTime = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}시간 ${m}분` : `${Math.max(1, m)}분`;
};

/**
 * 엔딩 크레딧 — 아래에서 위로 천천히 흐르고, 그 루트에서 본 CG 가 앨범 사진처럼 좌우에 끼어 지나감.
 * 클릭(누르고 있기)하면 4배 빠르게, 오른쪽 아래 버튼 · Esc 로 바로 넘김. 끝에 이번 판 기록.
 */
function CreditRoll({
  ending,
  name,
  stats,
  photos,
  onDone,
  onMusic,
}: {
  onMusic?: () => void;
  ending: (typeof ENDINGS)[number];
  name: string;
  stats: RollStats;
  photos: { src: string; title: string }[];
  onDone: () => void;
}) {
  const inner = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const fast = useRef(false);
  const done = useRef(false);
  useEffect(() => {
    onMusic?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDone();
  }, [onDone]);
  useEffect(() => {
    let raf = 0;
    let y = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(64, t - last);
      last = t;
      const H = box.current?.clientHeight ?? 600;
      const total = (inner.current?.scrollHeight ?? 0) + H;
      // 화면 높이 기준 속도 — 어느 화면에서나 비슷한 길이 (약 70초)
      y += (H / 11000) * dt * (fast.current ? 4 : 1);
      if (inner.current) inner.current.style.transform = `translateY(${H - y}px)`;
      if (y >= total) return finish();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const key = (e: KeyboardEvent) => e.key === "Escape" && finish();
    window.addEventListener("keydown", key);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", key);
    };
  }, [finish]);
  const who = (n: string) => n.replace("{name}", name || "당신");
  const STAFF: [string, string][] = [
    ["기획 · 시나리오 · 개발", "Lee G.M"],
    ["포커 룰 감수 (본인도 가끔 짐)", "Lee G.M"],
    ["CG 연출 · 컷 검수", "Lee G.M"],
    ["연서 장갑이 오른손에 있는지 매번 확인한 사람", "Lee G.M"],
    ["그록이랑 장갑 갖고 싸운 사람", "Lee G.M (전적 비공개)"],
    ["에이미 머리카락 한 올 한 올 이어 붙인 사람", "Lee G.M"],
    ["라이브 CG 눈 깜빡임 세던 사람", "Lee G.M"],
    ["작업하느라 밤 샌 사람", "Lee G.M"],
    ["커피 소비 담당", "Lee G.M (측정 불가)"],
    ["버그 제작", "Lee G.M"],
    ["버그 수리", "Lee G.M (아마도)"],
    ["음악 · 효과음 · 목소리", "Lee G.M & 기계 친구들"],
    ["빗소리", "하늘"],
    ["김치찌개 레시피", "춘희 이모 (영업 비밀)"],
    ["칩 닦기", "{name}"],
  ];
  const CAST: [string, string][] = [
    ["연서", "숫자로 말하는 하우스 플레이어"],
    ["에이미", "딱히, 네 편은 아니거든"],
    ["백상현", "HOUSE 사장 · 늘 웃는 얼굴"],
    ["춘희 이모", "HOUSE 주방 · 빨대는 늘 두 개"],
    ["태양 · 정민", "펍 단골 (from ANIME POKER)"],
    ["{name}", "딜러 · 그리고 당신"],
  ];
  // 크레딧 줄 사이사이에 사진 한 장씩 (좌우 번갈아)
  const rows: React.ReactNode[] = [];
  let p = 0;
  const photo = () => {
    const ph = photos[p];
    if (!ph) return null;
    const side = p % 2 === 0 ? "l" : "r";
    p++;
    return (
      <figure key={`p${p}`} className={`lv-roll-photo lv-roll-photo-${side}`} style={{ rotate: `${side === "l" ? -3.5 : 3}deg` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ph.src} alt="" />
        <figcaption>{ph.title}</figcaption>
      </figure>
    );
  };
  const section = (title: string, list: [string, string][], every: number) => {
    rows.push(
      <div key={`h${title}`} className="lv-roll-h">
        {title}
      </div>
    );
    list.forEach(([a, b], i) => {
      rows.push(
        <div key={`${title}${i}`} className="lv-roll-row">
          <div className="lv-roll-a">{who(a)}</div>
          <div className="lv-roll-b">{who(b)}</div>
        </div>
      );
      if ((i + 1) % every === 0) rows.push(photo());
    });
  };
  section("STAFF", STAFF, 2);
  section("CAST", CAST, 2);
  while (p < photos.length) rows.push(photo());
  const rec: [string, string][] = [
    ["플레이 시간", stats.preview ? "—" : fmtTime(stats.sec)],
    ["에이미와 나눈 대화", `${stats.lA}줄`],
    ["연서와 나눈 대화", `${stats.lY}줄`],
    ["고른 선택지", `${stats.ch}번`],
    ["테이블에 앉은 판", `${stats.mini}판`],
    ["모은 장면", `${stats.cg} / ${stats.cgAll}`],
    ["모은 엔딩", `${stats.end} / ${stats.endAll}`],
  ];
  return (
    <div
      ref={box}
      className="lv-roll absolute inset-0 z-[45] overflow-hidden bg-black"
      onPointerDown={(e) => (e.stopPropagation(), (fast.current = true))}
      onPointerUp={() => (fast.current = false)}
      onPointerLeave={() => (fast.current = false)}
      onClick={(e) => e.stopPropagation()}
    >
      <div ref={inner} className="lv-roll-track">
        <div className="lv-logo text-center text-[4.2cqw]">올인 러브</div>
        <div className="mt-[0.4cqw] text-center text-[1.2cqw] tracking-[0.4em] text-[#c9a25a]">ANIME POKER 외전</div>
        <div className="mt-[3cqw] text-center text-[1.1cqw] tracking-[0.5em] text-white/45">
          ENDING {String(ending.no).padStart(2, "0")} · {KIND_KO[ending.kind]}
        </div>
        <div className="mt-[0.6cqw] text-center text-[3cqw] font-black text-[#ffd27a]">{ending.title}</div>
        <div className="mx-auto mt-[0.8cqw] w-[40%] text-center text-[1.3cqw] text-white/70">{ending.copy}</div>
        <div className="h-[10cqw]" />
        {rows}
        <div className="lv-roll-h mt-[6cqw]">이번 판 기록</div>
        <div className="lv-roll-rec">
          {rec.map(([a, b]) => (
            <div key={a} className="lv-roll-row">
              <div className="lv-roll-a">{a}</div>
              <div className="lv-roll-b">{b}</div>
            </div>
          ))}
        </div>
        <div className="lv-roll-h mt-[6cqw]">SPECIAL THANKS</div>
        <div className="text-center text-[1.6cqw] text-white/85">ANIME POKER 를 해 준 모든 분</div>
        <div className="mt-[1cqw] text-center text-[1.6cqw] text-white/85">그리고 끝까지 테이블을 지켜 준 당신</div>
        <div className="mt-[12cqw] text-center text-[2.6cqw] font-black tracking-[0.2em] text-[#ffd27a]">
          THANK YOU FOR PLAYING
        </div>
        <div className="h-[30cqw]" />
      </div>
      <div className="pointer-events-none absolute bottom-[3%] left-[3%] text-[0.95cqw] text-white/35">
        누르고 있으면 빨리 감기
      </div>
      <button
        className="absolute bottom-[3%] right-[3%] text-[1cqw] text-white/45 hover:text-white"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => (e.stopPropagation(), finish())}
      >
        넘기기 ▶
      </button>
    </div>
  );
}

/** 시간제한 선택지: 줄어드는 바 + 1초마다 똑딱, 마지막 3초는 붉게. 창이 열려 있으면 멈춤 */
function ChoiceTimer({
  sec,
  paused,
  onTick,
  onEnd,
}: {
  sec: number;
  paused: boolean;
  onTick: () => void;
  onEnd: () => void;
}) {
  const [left, setLeft] = useState(sec * 1000);
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  const cb = useRef({ onTick, onEnd });
  useEffect(() => {
    cb.current = { onTick, onEnd };
  });
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let rest = sec * 1000;
    let lastSec = sec;
    const tick = (t: number) => {
      const dt = t - last;
      last = t;
      if (!pausedRef.current) rest -= dt;
      if (rest <= 0) {
        setLeft(0);
        cb.current.onEnd();
        return;
      }
      const s = Math.ceil(rest / 1000);
      if (s < lastSec) {
        lastSec = s;
        cb.current.onTick();
      }
      setLeft(rest);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sec]);
  const r = left / (sec * 1000);
  return (
    <div className={`lv-timer ${left < 3000 ? "lv-timer-hot" : ""}`}>
      <div className="lv-timer-bar" style={{ transform: `scaleX(${r})` }} />
      <div className="lv-timer-n">{Math.ceil(left / 1000)}</div>
    </div>
  );
}

/** 관리자 길잡이 상태 한 줄 */
function GuideNote({ target, ready, any }: { target: EndingId; ready: boolean; any: boolean }) {
  const e = ENDINGS.find((x) => x.id === target);
  return (
    <div className={`lv-guide-note ${ready && !any ? "lv-guide-bad" : ""}`}>
      🧭 {e ? e.title : target} ·{" "}
      {!ready ? "길 찾는 중…" : any ? "그 엔딩으로 가는 선택지만 보여 줘요" : "길을 못 찾았어요 (전부 보여 줌)"}
    </div>
  );
}

/** 사진 몽타주: 폴라로이드가 한 장씩 기울어져 놓임 (배경 + 인물 상반신 + 손글씨) */
function Montage({ shots, caption, onShutter }: { shots: import("@/lib/love/types").Shot[]; caption?: string; onShutter: () => void }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (n >= shots.length) return;
    const id = window.setTimeout(() => {
      onShutter();
      setN((x) => x + 1);
    }, n === 0 ? 250 : 650);
    return () => window.clearTimeout(id);
  }, [n, shots.length, onShutter]);
  const tilt = [-7, 5, -3, 8];
  return (
    <div className="lv-montage">
      <div className="lv-montage-row">
        {shots.slice(0, n).map((sh, i) => {
          const bg = bgImage(sh.bg);
          const set = sh.who ? (sh.outfit && OUTFITS[sh.who]?.[sh.outfit]) || STAND[sh.who] : null;
          const img = set ? (sh.face && sh.face !== "base" && set.faces[sh.face]) || set.base : null;
          return (
            <div key={i} className="lv-polaroid" style={{ transform: `rotate(${tilt[i % 4]}deg)` }}>
              <div
                className="lv-polaroid-pic"
                style={bg ? { backgroundImage: bg } : { background: BG_FALLBACK[sh.bg] }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {img && <img src={img} alt="" className="lv-polaroid-char" draggable={false} />}
              </div>
              {sh.text && <div className="lv-polaroid-text">{sh.text}</div>}
            </div>
          );
        })}
      </div>
      {caption && n >= shots.length && <div className="lv-montage-cap">{caption}</div>}
    </div>
  );
}

/**
 * 처음 가이드 (코치마크) — 대상 UI(sel) 를 밝히고 주변을 진하게 어둡게, 말풍선 + 화살표로 연결.
 * 말풍선: 실제 화면을 잘라 둔 예시 그림(img, 없거나 못 불러오면 생략) · 제목 · 단계 ①②③ · 예시 한 줄 · "알겠어"
 * 문장은 지금 세이브(vars)로 채울 수 있으면 채움 (예: "에이미 노트의 다음 ??? 칸은 2주차 일이야")
 * 대상이 지금 화면에 없으면(숨김 · 아직 안 그려짐) 잠깐 찾아보다가 다음 기회로 넘김 (본 걸로 안 침)
 */
type CoachVars = Record<string, number>;
interface CoachGuide {
  sel: string;
  title: string;
  /** 단계 (한 줄씩) — 2~4개 */
  steps: (v: CoachVars) => string[];
  /** 예시 한 줄 (선택) */
  ex?: (v: CoachVars) => string | null;
  /** 실제 화면에서 잘라 둔 예시 그림 (public/love/guide) */
  img?: string;
}
const G = "/love/guide";
/** 가장 최근에 받은 노트 힌트 */
const coachLastHint = (v: CoachVars) =>
  MIND.filter((m) => (v[`h_${m.id}`] ?? 0) >= 1 && !((v[m.id] ?? 0) >= 1)).sort(
    (a, b) => (v[`_hd_${b.id}`] ?? 0) - (v[`_hd_${a.id}`] ?? 0)
  )[0];
const NUM = ["①", "②", "③", "④"];
const GUIDE: Record<string, CoachGuide> = {
  plan: {
    sel: ".lv-free-wrap",
    title: "오늘 할 일 — 일정 카드",
    img: `${G}/plan.webp`,
    steps: () => [
      "하루에 카드 한 장. 누구를 만날지, 혼자 무엇을 준비할지 골라.",
      "카드 맨 아래 금색 글자가 그 카드로 얻는 거야.",
      "히로인만 만나기보다 셔플 연습 · 노트 정리 · 동네 한 바퀴를 섞으면 데이트도 포커도 달라져.",
    ],
    ex: () => "예) 셔플 연습 → 딜러 실력 ✦ · 동네 한 바퀴 → 그녀에게 건넬 물건",
  },
  relhud: {
    sel: '[data-coach="relhud"]',
    title: "관계 · 그녀 노트 열기",
    img: `${G}/relpanel.webp`,
    steps: () => [
      "왼쪽 위 하트 줄을 누르면 관계 화면이 열려. (PC는 R 키)",
      "파란 하트는 에이미, 보라 하트는 연서, 금색 ✦ 는 딜러 실력이야.",
      "빨간 점이 붙으면 노트에 새로 적힌 게 있다는 뜻이야.",
    ],
  },
  relnote: {
    sel: '[data-coach="mindnotes"]',
    title: "그녀 노트 — 그녀에 대해 아는 것",
    img: `${G}/mindnotes.webp`,
    steps: () => [
      "그녀를 제대로 알아본 순간은 문장으로 채워져.",
      "아직 못 알아본 순간은 ??? 로 남아.",
      "??? 옆 'N주차'는 그 순간이 있는 주야. 그 주에 그녀를 만날 때 말과 행동을 잘 봐.",
      "「노트 정리」 카드를 고르면 ??? 칸 하나에 방향 힌트가 붙어.",
    ],
  },
  mindday: {
    sel: ".lv-mindday",
    title: "알게 된 것",
    img: `${G}/mindday.webp`,
    steps: () => [
      "그녀를 제대로 알아본 날엔, 다음 날 아침 이렇게 한 줄이 남아.",
      "이런 순간이 쌓여야 엔딩이 달라져. 호감(하트)과는 따로 세.",
      "모아 둔 건 관계 화면의 그녀 노트(「그녀에 대해 아는 것」)에서 다시 볼 수 있어.",
    ],
  },
  read: {
    sel: ".lv-choice-read",
    title: "✎ 선택지 — 그녀를 알아본 만큼",
    img: `${G}/choice-read.webp`,
    steps: () => [
      "연노랑 ✎ 선택지는 그녀 노트에 쌓인 만큼 열려.",
      "맞히면 그녀가 알아봐 준 걸 기억해. 다음 날 아침 '알게 된 것'에 남아.",
      "단서로 열리는 금색 ★ 선택지와는 다른 거야.",
    ],
  },
  secret: {
    sel: ".lv-choice-secret",
    title: "★ 선택지 — 단서로 열린 길",
    img: `${G}/choice-secret.webp`,
    steps: () => [
      "금색 ★ 선택지는 모은 단서나 지난 회차의 기억이 있어야만 보여.",
      "고르면 이야기가 숨은 길로 갈 수 있어. 진엔딩도 이쪽이야.",
      "이번에 못 본 ★ 은 다음 회차에 다시 노려 봐.",
    ],
  },
  tell: {
    sel: ".lv-choice-tell",
    title: "버릇 읽기 — 읽기 노트",
    img: `${G}/choice-tell.webp`,
    steps: () => [
      "상대 버릇이 보이면, 아는 버릇은 선택지 위에 뜻이 같이 떠.",
      "뜻은 읽기 노트에 모아 둔 그대로야. 관계 화면에서 다시 볼 수 있어.",
      "믿고 따를지, 의심할지는 네가 정해. 버릇도 가끔 거짓말을 해.",
    ],
  },
  talk: {
    sel: '[data-coach="talk"]',
    title: "판 전에 한마디 — 테이블 토크",
    img: `${G}/talk.webp`,
    steps: (v) => [
      "매치가 시작되기 전, 이 줄에서 상대에게 한마디를 건넬 수 있어.",
      "말에 따라 상대 성향이 바뀌어. 도발하면 허세가 늘고, 내기를 걸면 진지해져.",
      "상대가 반응하면 그 반응이 '반응 단서'로 노트에 남아. 결전에서 쓸 수 있어.",
      ...(skillOf(v) >= SKILL_PRO ? ["딜러 실력 「예전의 손」이라 ✦ 고급 한마디도 쓸 수 있어. 그 판은 버릇이 다 보여."] : []),
    ],
    ex: () => "예) 에이미에게 \"이번 판 지면 딸기우유.\" → 좋은 패일 때 버릇이 확실히 보여",
  },
  react: {
    sel: '[data-coach="book"]',
    title: "반응 단서",
    img: `${G}/react.webp`,
    steps: () => [
      "방금 상대가 보인 반응이 노트(이 책)에 적혔어.",
      "반응 단서는 마지막 결전에서 단서 카드로 쓸 수 있어.",
      "모은 반응은 관계 화면 「읽기 노트」에 사람별로 남아.",
    ],
  },
  combo: {
    sel: '[data-coach="combo"]',
    title: "✎ 단서 조합",
    img: `${G}/combo.webp`,
    steps: (v) => [
      "이 버튼을 누르고, 아는 단서 카드 두 장을 골라 맞물려 봐.",
      "맞는 짝이면 이 판을 뒤집는 ✎ 행동이 열려.",
      skillOf(v) >= SKILL_PRO
        ? "기회는 두 번. 「예전의 손」이라 첫 실수 한 번은 상대가 못 봐."
        : "기회는 두 번. 틀리면 상대가 경계해서 마음이 흔들려.",
    ],
    ex: () => "예) 상대가 보인 버릇 + 이야기에서 얻은 단서 → 숨은 뜻",
  },
  skill: {
    sel: ".lv-skillup",
    title: "딜러 실력이 올랐어",
    img: `${G}/skill.webp`,
    steps: (v) => [
      `지금은 ${skillOf(v) + 1}단계 「${SKILL_NAME[skillOf(v)]}」. 셔플 연습 · 복기 같은 혼자 준비로 올라.`,
      "단계가 오를수록 매치에서 상대 버릇이 더 정확하게, 더 많이 보여.",
      "4단계 「예전의 손」부터 ✦ 고급 한마디와 결전 보험(첫 실수 한 번)이 생겨.",
    ],
  },
  hint: {
    sel: ".lv-noteup",
    title: "노트 힌트",
    img: `${G}/hint.webp`,
    steps: (v) => {
      const m = coachLastHint(v);
      return [
        m && m.who !== "both"
          ? `「노트 정리」로 ${NAME[m.who]} 노트의 ??? 칸 하나에 힌트가 붙었어. (그 칸은 ${m.week}주차 일)`
          : "「노트 정리」로 그녀 노트의 ??? 칸 하나에 힌트가 붙었어.",
        "답이 아니라 방향이야. 그 장면이 오면 이 문장을 떠올려 봐.",
        "다시 보려면 왼쪽 위 하트 줄 → 그녀 노트(「그녀에 대해 아는 것」).",
      ];
    },
  },
  item: {
    sel: ".lv-noteup",
    title: "주머니 속 물건",
    img: `${G}/item.webp`,
    steps: () => [
      "동네 한 바퀴에서 산 물건이 주머니에 들어갔어.",
      "다음에 히로인을 만나면 민트색 ✦ '건네기' 선택지가 떠.",
      "그녀 취향에 맞는 물건이면 마음이 움직여. 누가 뭘 좋아했는지 떠올려 봐.",
    ],
    ex: (v) => {
      const has = ITEMS.filter((k) => (v[k] ?? 0) >= 1).map((k) => ICON[k].name);
      return has.length ? `지금 주머니: ${has.join(" · ")}` : null;
    },
  },
  prep: {
    sel: ".lv-choice-prep, .lv-dlg-gate",
    title: "✦ 준비해 둔 덕분",
    img: `${G}/prep.webp`,
    steps: () => [
      "민트색 ✦ 는 미리 해 둔 혼자 준비 덕분에 열린 순간이야.",
      "셔플 연습(실력) · 근무 팁 · 동네 한 바퀴 물건 · 노트 정리가 이렇게 돌아와.",
      "같은 데이트라도 준비에 따라 장면이 달라져.",
    ],
  },
};

function CoachMark({
  root,
  guide,
  vars,
  onOk,
  onMiss,
}: {
  root: React.RefObject<HTMLDivElement | null>;
  guide: CoachGuide;
  vars: CoachVars;
  onOk: () => void;
  onMiss: () => void;
}) {
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number; W: number; H: number } | null>(null);
  const [tip, setTip] = useState<{ w: number; h: number } | null>(null);
  const [imgOk, setImgOk] = useState(!!guide.img);
  // 대상 둘레 어디에도 안 들어갈 때: 1 = 그림 빼기 → 2 = 예시 줄도 빼기 (다시 재서 맞춤)
  // 3 = 빽빽 모드: 가로로 꽉 · 버튼을 제목 줄로 · 남는 칸만큼만 높이 (넘치면 안에서 스크롤)
  const [compact, setCompact] = useState(0);
  const miss = useRef(onMiss);
  const tipEl = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    miss.current = onMiss;
  });
  useEffect(() => {
    let tries = 0;
    let raf = 0;
    const find = () => {
      const r = root.current;
      const el = r?.querySelector<HTMLElement>(guide.sel);
      const b = el?.getBoundingClientRect();
      if (!r || !el || !b || b.width === 0) {
        if (++tries > 45) miss.current();
        else raf = window.requestAnimationFrame(find);
        return;
      }
      const a = r.getBoundingClientRect();
      setBox({ x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height, W: a.width, H: a.height });
    };
    raf = window.requestAnimationFrame(find);
    const onResize = () => {
      tries = 0;
      find();
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [root, guide.sel]);
  // 말풍선 크기는 그려 본 뒤에 잼 (그림이 늦게 불러와져도 다시 맞춤)
  useEffect(() => {
    const el = tipEl.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTip({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [box]);
  if (!box) return null;
  const { W, H } = box;
  const pad = Math.max(5, W * 0.006);
  const m = Math.max(8, W * 0.012);
  // 가로로 짧은 화면(가로 폰): 그림을 왼쪽에 두는 옆 배치 · 넓게
  const short = H < 520;
  const tight = compact >= 3;
  const bw = tight ? Math.min(W - 2 * Math.max(8, W * 0.012), 760) : short ? Math.min(W * 0.72, 600) : W < 900 ? W * 0.62 : Math.min(Math.max(W * 0.38, 340), 540);
  const th = tip?.h ?? 0;
  const tw = tip?.w ?? bw;
  const tx = box.x - pad,
    ty = box.y - pad,
    tW = box.w + pad * 2,
    tH = box.h + pad * 2;
  const cx = tx + tW / 2,
    cy = ty + tH / 2;
  const gap = Math.max(14, W * 0.016);
  type Side = "below" | "above" | "right" | "left";
  const room: Record<Side, number> = {
    below: H - (ty + tH) - gap - m,
    above: ty - gap - m,
    right: W - (tx + tW) - gap - m,
    left: tx - gap - m,
  };
  const fits = (s: Side) => (s === "below" || s === "above" ? room[s] >= th : room[s] >= tw && th <= H - 2 * m);
  const order: Side[] = cy < H / 2 ? ["below", "above", "right", "left"] : ["above", "below", "right", "left"];
  const anyFit = order.some(fits);
  const hasImg = !!guide.img && imgOk;
  const hasEx = !!guide.ex?.(vars);
  if (tip && !anyFit && compact < 3) setCompact(compact === 0 && hasImg ? 1 : compact <= 1 && hasEx ? 2 : 3);
  // 빽빽 모드는 위 · 아래 중 넓은 쪽에만, 그 칸 높이까지만
  const side: Side = tight
    ? room.below >= room.above
      ? "below"
      : "above"
    : (order.find(fits) ??
      order.slice().sort((a, b) => room[b] / (b === "below" || b === "above" ? th || 1 : tw) - room[a] / (a === "below" || a === "above" ? th || 1 : tw))[0]);
  const maxH = tight ? Math.max(72, room[side]) : H - 2 * m;
  const clampX = (x: number) => Math.max(m, Math.min(x, W - m - tw));
  const clampY = (y: number) => Math.max(m, Math.min(y, H - m - th));
  let left: number, top: number;
  if (side === "below" || side === "above") {
    left = clampX(cx - tw / 2);
    top = side === "below" ? ty + tH + gap : ty - gap - th;
    top = clampY(top);
  } else {
    top = clampY(cy - th / 2);
    left = side === "right" ? tx + tW + gap : tx - gap - tw;
    left = Math.max(m, Math.min(left, W - m - tw));
  }
  // 화살표: 말풍선 가장자리에서 대상 쪽으로
  const ax = Math.max(18, Math.min(cx - left, tw - 18));
  const ay = Math.max(18, Math.min(cy - top, th - 18));
  const steps = guide.steps(vars);
  const ex = compact >= 2 ? null : (guide.ex?.(vars) ?? null);
  return (
    <div className="lv-coach" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="lv-coach-hole" style={{ left: tx, top: ty, width: tW, height: tH }} />
      <div
        ref={tipEl}
        className={`lv-coach-tip ${short && !compact ? "lv-coach-tip-row" : ""}${tight ? " lv-coach-tight" : ""}`}
        style={{ left, top, width: bw, maxHeight: maxH, visibility: tip ? undefined : "hidden" }}
      >
        <i
          className={`lv-coach-arrow lv-coach-arrow-${side}`}
          style={side === "below" || side === "above" ? { left: ax } : { top: ay }}
        />
        {guide.img && imgOk && !compact && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="lv-coach-img" src={guide.img} alt="" onError={() => setImgOk(false)} />
        )}
        <div className="lv-coach-body">
          <b>{guide.title}</b>
          <ol>
            {steps.map((t, i) => (
              <li key={i}>
                <span>{NUM[i] ?? "·"}</span>
                {t}
              </li>
            ))}
          </ol>
          {ex && <p className="lv-coach-ex">{ex}</p>}
          <button className="lv-coach-ok" onClick={onOk}>
            알겠어
          </button>
        </div>
      </div>
    </div>
  );
}
