"use client";

/*
 * 올인 러브 (가제) — ANIME POKER 외전 미연시 · M1 프로토
 * 로딩(진행률) → 타이틀 → 이름 → 본편. 대본은 lib/love/script.ts, 실행기는 lib/love/engine.ts
 * 저장: localStorage (못 쓰는 환경이어도 게임은 그대로 돌아감)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  SFX,
  STAND,
  TITLE,
  preloadList,
} from "@/lib/love/assets";
import {
  type GState,
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
import { type ReactLine, idleLine, touchLine } from "@/lib/love/reactions";
import { VOICE_BY_TEXT } from "@/lib/love/voices";
import {
  type BgmId,
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
import { DealMini, StoryPoker, TellMini } from "./Minis";
import VoiceReview, { type VoiceRow } from "./VoiceReview";

/** 개발 중에만 쓰는 주소 옵션 (?scene= · ?review=voices) */
const devParam = (k: string): string | null =>
  process.env.NODE_ENV !== "production" && typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get(k)
    : null;

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
  meta: "love:meta",
  cfg: "love:cfg",
  seen: "love:seen",
  name: "love:name",
  mute: "love:mute",
};
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
}
const CFG0: Cfg = { text: 3, auto: 3, bgm: 0.7, sfx: 0.8, voice: 1, box: 0.85, skipAll: false };
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
    if (voiceEl.current) voiceEl.current.volume = Math.min(1, 0.95 * cfg.voice);
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
    a.volume = Math.min(1, 0.95 * vol.current.voice);
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
  const bgm = useCallback((id: BgmId | null) => {
    if (cur.current === id) return;
    cur.current = id;
    bgmEl.current?.pause();
    bgmEl.current = null;
    const url = id ? BGM[id] : null;
    if (!id || !url) return;
    const a = new Audio(url);
    a.loop = !BGM_ONCE.includes(id);
    a.volume = bgmVol();
    bgmEl.current = a;
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
  return { play, bgm, voice, voiceEnd };
}

type Phase = "loading" | "title" | "name" | "game" | "gallery" | "review";
type Panel = null | "log" | "save" | "load" | "config";

export default function LoveApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [prog, setProg] = useState(0);
  const [s, setS] = useState<GState | null>(null);
  const [name, setName] = useState("한도윤");
  const [typed, setTyped] = useState(0);
  const [auto, setAuto] = useState(false);
  const [skip, setSkip] = useState(false);
  const [log, setLog] = useState<{ who: Who; text: string }[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [endings, setEndings] = useState<EndingId[]>([]);
  /** 본 이벤트 CG (회상 갤러리) */
  const [cgs, setCgs] = useState<CgId[]>([]);
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
  const [hideUi, setHideUi] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [phoneShown, setPhoneShown] = useState(0);
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
  const { play, bgm, voice, voiceEnd } = useSound(muted, cfg);

  const sub = useCallback((t: string) => t.replaceAll("{name}", name), [name]);
  const flash = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(null), 1400);
  };

  // ---------- 로딩: 그림 · 소리 전부 받은 뒤 시작 ----------
  useEffect(() => {
    try {
      setEndings(JSON.parse(LS.get(KEY.endings) ?? "[]"));
      setCgs(JSON.parse(LS.get(KEY.cg) ?? "[]"));
      seen.current = new Set(JSON.parse(LS.get(KEY.seen) ?? "[]"));
    } catch {}
    const n = LS.get(KEY.name);
    if (n) setName(n);
    setMuted(LS.get(KEY.mute) === "1");
    setCfgState(readCfg());
    const { img, audio, voice } = preloadList();
    const total = img.length + audio.length;
    let done = 0;
    // 음성은 화면이 다 뜬 뒤 6개씩 뒤에서 받아 둠 (브라우저 캐시에 들어가서 대사 넘길 때 바로 재생)
    const warmVoices = () => {
      let i = 0;
      const next = (): void => {
        const u = voice[i++];
        if (u) fetch(u).then(next, next);
      };
      for (let k = 0; k < 6; k++) next();
    };
    const tick = () => {
      done++;
      setProg(Math.round((done / total) * 100));
      if (done >= total) {
        window.setTimeout(() => setPhase(devParam("review") ? "review" : "title"), 250);
        window.setTimeout(warmVoices, 400);
      }
    };
    img.forEach((u) => {
      const im = new Image();
      im.onload = tick;
      im.onerror = tick;
      im.src = u;
    });
    audio.forEach((u) => {
      fetch(u).then(tick, tick);
    });
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
    if (phase === "title" || phase === "name" || phase === "gallery") bgm("title");
  }, [phase, bgm]);

  // ---------- 상태가 바뀔 때: 소리 · 백로그 · 타자 효과 초기화 ----------
  useEffect(() => {
    if (!s) return;
    s.fx.forEach(play);
    const b = s.block;
    // 스토리 포커 중엔 전용 곡, 배드 엔딩 카드엔 짧은 코다
    const endKind = b?.k === "ending" ? ENDINGS.find((e) => e.id === b.id)?.kind : null;
    bgm(
      b?.k === "mini" && b.step.kind === "poker"
        ? "spoker"
        : endKind === "bad"
          ? "badend"
          : s.disp.bgm
    );
    if (b?.k === "say") {
      setReadNow(seen.current.has(lineKey(s)));
      setTyped(0);
      setLog((l) => [...l.slice(-199), { who: b.who, text: b.text }]);
      voice(skip ? null : (VOICE_BY_TEXT[b.text] ?? null));
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
    if (b?.k === "phone") {
      setPhoneShown(0);
      play("phone");
    }
    if (b?.k === "goTitle") {
      voice(null);
      bgm(null);
      setPhase("title");
    }
    if (b?.k === "ending") {
      // 트루 엔딩은 스태프 롤이 끝난 뒤 카드가 나오므로 도장 소리도 그때 (StaffRoll onDone)
      if (ENDINGS.find((e) => e.id === b.id)?.kind !== "true")
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
    const id = window.setInterval(() => setTyped((n) => Math.min(fullText.length, n + 1)), ms);
    return () => window.clearInterval(id);
  }, [typing, skip, fullText.length, cfg.text]);

  const markSeen = useCallback(() => {
    if (!s) return;
    seen.current.add(lineKey(s));
    LS.set(KEY.seen, JSON.stringify([...seen.current]));
  }, [s]);

  const advance = useCallback(() => {
    if (!s || panel) return;
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
    }
  }, [s, panel, typed, sub, markSeen, play]);

  // 날짜 · 제목 카드는 잠깐 보여 주고 자동으로 넘어감
  useEffect(() => {
    if (block?.k !== "day" && block?.k !== "title") return;
    const id = window.setTimeout(advance, skip ? 200 : block.k === "day" ? 1500 : 2300);
    return () => window.clearTimeout(id);
  }, [block, advance, skip]);

  // 오토 · 스킵
  useEffect(() => {
    if (block?.k !== "say" || panel) return;
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
  ]);

  // 메시지 말풍선 하나씩
  useEffect(() => {
    if (block?.k !== "phone") return;
    if (phoneShown >= block.step.msgs.length) return;
    const id = window.setTimeout(() => setPhoneShown((n) => n + 1), 650);
    return () => window.clearTimeout(id);
  }, [block, phoneShown]);

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
    if (phase !== "game" || !s || block?.k !== "say" || typing || panel || auto || skip || hideUi)
      return;
    const on: CharKey[] = (Object.keys(s.disp.chars) as CharKey[]).filter(
      (k) => k === "yeonseo" || k === "amy"
    );
    if (!on.length) return;
    const who = on.includes(block.who as CharKey) ? (block.who as CharKey) : on[0];
    const id = window.setTimeout(() => showReact(who, idleLine(who, s.vars), s.seq), 18000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.seq, typing, panel, auto, skip, hideUi, phase]);
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
      showReact(who, touchLine(who, head ? "head" : "body", s.vars), s.seq);
      return true;
    }
    return false;
  };

  // 키보드: 스페이스 · 엔터 = 다음, Ctrl 누르는 동안 스킵, Esc = 창 닫기
  useEffect(() => {
    if (phase !== "game") return;
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
      if (e.key === "Control") setSkip(true);
      if ((e.key === "h" || e.key === "H") && !panel) setHideUi((v) => !v);
      if ((e.key === "a" || e.key === "A") && !panel) setAuto((v) => !v);
      if ((e.key === "l" || e.key === "L" || e.key === "ArrowUp") && !panel) setPanel("log");
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
  }, [phase, advance, panel]);

  // ---------- 동작 ----------
  const newGame = () => {
    LS.set(KEY.name, name);
    setLog([]);
    setAuto(false);
    setSkip(false);
    // 개발 중에만: ?scene=d4 로 원하는 장면부터 테스트
    const dev = devParam("scene");
    const st0 = { ...initState(), vars: readMeta() };
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
    setS(pick(s, o));
    // 호감이 오른 선택이면 그 히로인 색 하트가 잠깐 떠오름 (수치는 안 보여 줌)
    const up = (o.eff?.affA ?? 0) > 0 ? "amy" : (o.eff?.affY ?? 0) > 0 ? "yeonseo" : null;
    if (up) setHeartPop({ who: up, n: Date.now() });
  };
  useEffect(() => {
    if (!heartPop) return;
    const id = window.setTimeout(() => setHeartPop(null), 1600);
    return () => window.clearTimeout(id);
  }, [heartPop]);
  const labelOf = (st: GState) => {
    const d = st.disp.day ? `DAY ${st.disp.day.d} · ${st.disp.day.slot}` : "프롤로그";
    const t = st.block?.k === "say" ? sub(st.block.text).slice(0, 26) : "";
    return `${d}  ${t}`;
  };
  const save = (n: string) => {
    if (!s) return;
    const data: SaveData = { s, name, ts: Date.now(), label: labelOf(s) };
    LS.set(KEY.save(n), JSON.stringify(data));
    flash(n === "q" ? "퀵세이브" : `${n}번에 저장`);
    setPanel(null);
  };
  const load = (n: string) => {
    const d = readSave(n);
    if (!d) return flash("저장된 게 없어요");
    setName(d.name);
    setLog([]);
    setS({ ...d.s, seq: d.s.seq + 1, fx: [] });
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
  const latestSave = useMemo(() => {
    if (phase !== "title") return null;
    let best: { n: string; ts: number } | null = null;
    for (const n of [...SLOTS, "q"]) {
      const d = readSave(n);
      if (d && (!best || d.ts > best.ts)) best = { n, ts: d.ts };
    }
    return best?.n ?? null;
  }, [phase]);
  const toggleFull = () => {
    const el = wrap.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };
  const toggleMute = () => {
    setMuted((m) => {
      LS.set(KEY.mute, m ? "0" : "1");
      return !m;
    });
  };

  // ---------- 그리기 ----------
  const disp = s?.disp;
  // 서브 캐릭터를 먼저 그려서(뒤쪽) 히로인이 앞에 오게
  const chars = disp
    ? (Object.entries(disp.chars) as [CharKey, NonNullable<(typeof disp.chars)[CharKey]>][]).sort(
        (a, b) =>
          Number((SUBS as readonly string[]).includes(b[0])) -
          Number((SUBS as readonly string[]).includes(a[0]))
      )
    : [];
  const maxDist = chars.reduce((m, [, c]) => Math.max(m, c.dist), 0);
  const speaker = block?.k === "say" ? block.who : null;
  const ending = block?.k === "ending" ? ENDINGS.find((e) => e.id === block.id) : null;

  return (
    <div ref={wrap} className="lv-root" style={{ "--lv-box": cfg.box } as React.CSSProperties}>
      <div
        className="lv-stage"
        onClick={() => phase === "game" && !hideUi && advance()}
        // 미연시 국룰: 휠 위로 = 지난 대사, 우클릭 = 대사창 숨기기
        onWheel={(e) => {
          if (phase === "game" && !panel && e.deltaY < 0 && block?.k === "say") setPanel("log");
        }}
        onContextMenu={(e) => {
          if (phase !== "game") return;
          e.preventDefault();
          if (panel) setPanel(null);
          else setHideUi((v) => !v);
        }}
      >
        {/* ===== 로딩 ===== */}
        {phase === "loading" && (
          <div className="absolute inset-0 grid place-items-center bg-[#0b0806]">
            <div className="w-[46%] text-center">
              <div className="lv-logo text-[4.2cqw]">올인 러브</div>
              <div className="mt-[1.4cqw] h-[0.7cqw] overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-gradient-to-r from-[#c9a25a] to-[#ffd27a] transition-all"
                  style={{ width: `${prog}%` }}
                />
              </div>
              <div className="mt-[0.8cqw] text-[1.3cqw] text-white/60">불러오는 중 {prog}%</div>
            </div>
          </div>
        )}

        {/* ===== 타이틀 ===== */}
        {(phase === "title" || phase === "name" || phase === "gallery") && (
          <div className="absolute inset-0">
            {/* 타이틀 키아트 (GPT 시안 그대로 — 캐릭터 둘 + 펍) */}
            <div
              className="absolute inset-0 bg-cover bg-center transition-[filter] duration-500"
              style={{
                backgroundImage: `url("${TITLE.bg}")`,
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
                    <span className="lv-suit">♣</span>엔딩 · 회상{" "}
                    <small className="ml-[0.4cqw] text-[1cqw] text-[#e9d9b0]/70">
                      {endings.length + cgs.length}/{ENDINGS.length + CG_ORDER.length}
                    </small>
                  </button>
                </div>
                <div className="absolute bottom-[2.2%] right-[2%] text-[1cqw] text-[#e9d9b0]/70">
                  ◇ M1 프로토 · Ver. 0.1
                </div>
              </div>
            )}
            {phase === "name" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-[1.2cqw]">
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
                onBack={() => setPhase("title")}
                onPlay={(id) => bgm(id)}
              />
            )}
          </div>
        )}

        {/* ===== 음성 검수 (개발 중) ===== */}
        {phase === "review" && (
          <VoiceReview
            name={name}
            last={reviewId}
            onJump={jumpReview}
            onBack={() => setPhase("title")}
          />
        )}

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
            {chars.map(([k, c]) => {
              const pos = chars.length === 1 && c.dist > 0 ? "c" : c.pos;
              const face: Face =
                liveReact?.who === k ? liveReact.face : ((c.face as Face) ?? "base");
              // 말 꺼내는 순간: 동요 대사면 흔들림, 놀람 표정이면 폴짝 / 반응 때도 폴짝
              const fx =
                liveReact?.who === k
                  ? { kind: "hop" as const, n: liveReact.n }
                  : speaker === k &&
                      block?.k === "say" &&
                      (block.mood === "shake" || block.mood === "shout")
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
            {disp.cg && <CgView key={disp.cg} id={disp.cg} />}
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

            {/* 대사 */}
            {block?.k === "say" && !hideUi && (
              <Dialogue
                key={block.mood === "shake" || block.mood === "shout" ? s.seq : "box"}
                who={block.who}
                mood={block.mood}
                name={sub(NAME[block.who])}
                text={fullText.slice(0, typed)}
                done={!typing}
                onReplay={
                  VOICE_BY_TEXT[block.text] ? () => voice(VOICE_BY_TEXT[block.text]) : undefined
                }
                read={readNow}
              />
            )}

            {/* 하단 버튼 */}
            {!hideUi && (block?.k === "say" || block?.k === "choice") && (
              <div className="lv-ctrl" onClick={(e) => e.stopPropagation()}>
                <Chip on={auto} onClick={() => setAuto((a) => !a)}>
                  AUTO
                </Chip>
                <Chip
                  on={skip}
                  title="읽은 대사를 다음 선택지까지 넘겨요"
                  onClick={() => setSkip((v) => !v)}
                >
                  SKIP
                </Chip>
                <Chip title="직전 선택지로 돌아가기" onClick={backToChoice}>
                  ◀ 선택지
                </Chip>
                <Chip onClick={() => setPanel("log")}>LOG</Chip>
                <Chip onClick={() => setPanel("save")}>SAVE</Chip>
                <Chip onClick={() => setPanel("load")}>LOAD</Chip>
                <Chip onClick={() => save("q")}>Q.SAVE</Chip>
                <Chip onClick={() => load("q")}>Q.LOAD</Chip>
                <Chip
                  title="대사창을 숨기고 그림 보기 (캐릭터를 누르면 반응해요)"
                  onClick={() => {
                    setHideUi(true);
                    setTouchHint(true);
                  }}
                >
                  HIDE
                </Chip>
              </div>
            )}
            {heartPop && (
              <div
                key={heartPop.n}
                className={`lv-heart-pop ${heartPop.who === "amy" ? "lv-heart-a" : "lv-heart-y"}`}
              >
                ♥
              </div>
            )}
            <div className="lv-top-right" onClick={(e) => e.stopPropagation()}>
              <Chip title="환경 설정" onClick={() => setPanel("config")}>
                ⚙
              </Chip>
              <Chip onClick={toggleMute}>{muted ? "🔇" : "♪"}</Chip>
              <Chip onClick={toggleFull}>⛶</Chip>
              <Chip
                onClick={() => {
                  bgm(null);
                  setPhase("title");
                }}
              >
                ≡
              </Chip>
            </div>
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
            {block?.k === "choice" && (
              <div
                className={`absolute inset-0 z-30 flex flex-col items-center justify-center gap-[1cqw] ${block.big ? "bg-black/55" : "bg-black/35"}`}
                onClick={(e) => e.stopPropagation()}
              >
                {block.big && <BranchBanner onSave={() => setPanel("save")} />}
                {block.prompt && (
                  <div className="mb-[0.5cqw] text-[1.6cqw] text-white/85 [text-shadow:0_2px_6px_#000]">
                    {block.prompt}
                  </div>
                )}
                {block.opts.map((o) => (
                  <button
                    key={o.text}
                    className={`lv-choice ${o.secret ? "lv-choice-secret" : ""}`}
                    onClick={() => choose(o)}
                  >
                    {o.secret && <span className="mr-[0.6cqw] text-[#ffd27a]">★</span>}
                    {sub(o.text)}
                  </button>
                ))}
              </div>
            )}

            {/* 자유 슬롯 */}
            {block?.k === "free" && (
              <div
                className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/55"
                onClick={(e) => e.stopPropagation()}
              >
                {block.big && <BranchBanner onSave={() => setPanel("save")} />}
                <div className="mb-[1.5cqw] text-[2cqw] font-bold text-[#ffd27a]">
                  {block.prompt}
                </div>
                <div className="flex gap-[1.5cqw]">
                  {block.opts.map((o) => (
                    <button key={o.text} className="lv-free" onClick={() => choose(o)}>
                      {sub(o.text)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 메시지 */}
            {block?.k === "phone" && (
              <div
                className="absolute inset-0 z-30 bg-black/40"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="lv-phone">
                  <div className="flex items-center gap-[0.8cqw] border-b border-white/10 pb-[0.8cqw]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {FACE_ICON[block.step.from] && (
                      <img
                        src={FACE_ICON[block.step.from]}
                        alt=""
                        className="h-[3cqw] w-[3cqw] rounded-full"
                      />
                    )}
                    <b className="text-[1.5cqw]">{NAME[block.step.from]}</b>
                  </div>
                  <div className="flex flex-1 flex-col gap-[0.6cqw] overflow-hidden py-[1cqw]">
                    {block.step.msgs.slice(0, phoneShown).map((m) => (
                      <div key={m} className="lv-bubble">
                        {m}
                      </div>
                    ))}
                  </div>
                  {phoneShown >= block.step.msgs.length && (
                    <div className="flex flex-col gap-[0.5cqw]">
                      {block.step.replies.map((o) => (
                        <button key={o.text} className="lv-reply" onClick={() => choose(o)}>
                          {o.text}
                        </button>
                      ))}
                      <button
                        className="lv-reply opacity-60"
                        onClick={() => setS(ignorePhone(s, block.step.ignore))}
                      >
                        (읽고 답장 안 하기)
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 미니게임 */}
            {block?.k === "mini" && (
              <div onClick={(e) => e.stopPropagation()}>
                {block.step.kind === "deal" ? (
                  <DealMini play={play} onDone={(n) => setS(miniDone(s, block.step.key, n))} />
                ) : block.step.kind === "poker" ? (
                  <StoryPoker
                    spec={block.step.poker}
                    play={play}
                    bg={disp.bg === "black" ? "pub" : disp.bg}
                    onDone={(n, eff) => setS(miniDone(s, block.step.key, n, eff))}
                  />
                ) : (
                  <TellMini
                    tell={block.step.tell}
                    onDone={(n) => setS(miniDone(s, block.step.key, n))}
                  />
                )}
              </div>
            )}

            {/* 날짜 · 제목 카드 */}
            {block?.k === "day" && (
              <div className="lv-daycard">
                <div className="text-[6cqw] font-black tracking-widest text-white">
                  DAY {block.d}
                </div>
                <div className="text-[2cqw] text-[#ffd27a]">{block.slot}</div>
              </div>
            )}
            {block?.k === "title" && (
              <div className="absolute inset-0 z-40 grid place-items-center bg-black">
                <div className="lv-fadein text-center">
                  <div className="text-[4.5cqw] font-black text-white">{block.text}</div>
                  {block.sub && (
                    <div className="mt-[0.6cqw] text-[1.6cqw] text-white/60">{block.sub}</div>
                  )}
                </div>
              </div>
            )}

            {/* 트루 · 그랜드 엔딩은 엔딩 카드 전에 스태프 롤 (클릭하면 넘김) */}
            {ending && ending.kind === "true" && rolled !== s.seq && (
              <StaffRoll
                title={ending.title}
                onDone={() => {
                  setRolled(s.seq);
                  window.setTimeout(() => play("stamp"), 4400);
                }}
              />
            )}
            {/* 엔딩 */}
            {ending && (ending.kind !== "true" || rolled === s.seq) && (
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
            className="absolute inset-0 z-[60] flex flex-col bg-black/85 p-[2.5cqw]"
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
                      : "불러오기"}
              </b>
              <button className="lv-btn-ghost" onClick={() => setPanel(null)}>
                닫기
              </button>
            </div>
            {panel === "config" ? (
              <ConfigPanel cfg={cfg} setCfg={setCfg} onTest={() => play("chip")} />
            ) : panel === "log" ? (
              <LogList log={log} sub={sub} onVoice={(u) => voice(u)} />
            ) : (
              <div className="grid flex-1 grid-cols-3 gap-[1cqw] overflow-y-auto">
                {[...SLOTS, "q", ...(panel === "load" ? ["a1", "a2", "a3"] : [])].map((n) => {
                  const d = readSave(n);
                  const can = panel === "save" ? n !== "q" && phase === "game" : !!d;
                  return (
                    <button
                      key={n}
                      disabled={!can}
                      className={`lv-slot ${n.startsWith("a") ? "lv-slot-auto" : ""}`}
                      onClick={() => (panel === "save" ? save(n) : load(n))}
                    >
                      {d && <SlotThumb s={d.s} />}
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
                        <div className="mt-[0.3cqw] text-[1cqw] text-white/45">
                          {new Date(d.ts).toLocaleString("ko-KR")}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {toast && <div className="lv-toast">{toast}</div>}
      </div>
      <div className="lv-rotate">가로로 돌려 주세요</div>
    </div>
  );
}

// ---------- 부품 ----------
/** 배경 — 장소가 바뀌면 이전 배경 위로 새 배경이 천천히 겹쳐 들어옴 (크로스페이드) */
function Bg({ id, blur }: { id: keyof typeof BG; blur: number }) {
  const [prev, setPrev] = useState<{ cur: keyof typeof BG; old: keyof typeof BG | null }>({
    cur: id,
    old: null,
  });
  if (prev.cur !== id) setPrev({ cur: id, old: prev.cur });
  const layer = (bid: keyof typeof BG, fade: boolean) => {
    const u = BG[bid];
    return (
      <div
        key={`${bid}-${fade ? "in" : "out"}`}
        className={`absolute inset-0 bg-cover bg-center transition-[filter] duration-700 ${fade ? "lv-bg-in" : ""}`}
        style={{
          ...(u ? { backgroundImage: `url("${u}")` } : { background: BG_FALLBACK[bid] }),
          filter: blur ? `blur(${blur * 3}px) brightness(${1 - blur * 0.13})` : undefined,
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
function CgView({ id }: { id: CgId }) {
  const c = CG[id];
  return (
    <div className="lv-cg">
      <div className="lv-cg-img" style={{ backgroundImage: `url("${c.src}")` }}>
        {/* 살아 있는 CG (그록 루프 mp4) — 있으면 정지 그림 위에서 재생 */}
        {c.video && (
          <video
            src={c.video}
            autoPlay
            loop
            muted
            playsInline
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <div className="lv-cg-vignette" />
      {RAIN_CG.includes(id) && <div className="lv-rain" />}
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
      <div className="lv-cg-bar lv-cg-bar-t" />
      <div className="lv-cg-bar lv-cg-bar-b" />
      <div className="lv-cg-title">
        <span className={c.who === "amy" ? "text-[#7fd3ff]" : "text-[#8fa8ff]"}>♥</span> EVENT ·{" "}
        {c.title}
      </div>
      <div className="lv-cg-flash" />
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
}: {
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
      className="lv-char-in absolute"
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
            {/* 표정 그림이 원본이라 윤곽이 조금씩 달라서, 표정이 떠 있는 동안 기본 그림은 숨김 (크기 기준으로만 남김) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={set.base}
              alt={NAME[who]}
              draggable={false}
              className="h-full w-auto max-w-none transition-opacity duration-200"
              style={{ opacity: set.faces[face] ? 0 : 1 }}
            />
            {(Object.entries(set.faces) as [Face, string][]).map(([f, u]) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={f}
                src={u}
                alt=""
                draggable={false}
                className="lv-face"
                style={{ opacity: face === f ? 1 : 0 }}
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
                className="lv-face transition-opacity duration-200"
                style={{ opacity: face === set.live.face ? 1 : 0 }}
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

function Dialogue({
  who,
  mood,
  name,
  text,
  done,
  onReplay,
  read,
}: {
  who: Who;
  mood: string;
  name: string;
  text: string;
  done: boolean;
  onReplay?: () => void;
  read?: boolean;
}) {
  if (mood === "bare") {
    return (
      <div className="pointer-events-none absolute inset-x-[10%] bottom-[10%] z-20 text-center text-[2.4cqw] font-semibold leading-relaxed text-white [text-shadow:0_2px_10px_#000,0_0_24px_#000]">
        {text}
      </div>
    );
  }
  const narr = who === "narr";
  return (
    <div
      className={`lv-box ${read ? "lv-read" : ""} ${mood === "whisper" ? "lv-box-whisper" : ""} ${mood === "heart" ? "lv-box-heart" : ""} ${mood === "shake" || mood === "shout" ? "lv-box-jolt" : ""}`}
    >
      {!narr && (
        <div className="lv-name" style={{ color: NAME_COLOR[who] }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {FACE_ICON[who] && (
            <img src={FACE_ICON[who]} alt="" className="h-[2.4cqw] w-[2.4cqw] rounded-full" />
          )}
          <span className="text-[#ffd27a]">♠</span> {name}
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
        className={`lv-text ${narr ? "italic text-white/85" : ""} ${mood === "whisper" ? "lv-t-whisper" : ""} ${mood === "shake" ? "lv-t-shake" : ""} ${mood === "shout" ? "lv-t-shout" : ""} ${mood === "think" ? "text-[#cfc6b0]" : ""} ${mood === "heart" ? "lv-t-heart" : ""}`}
      >
        {mood === "think" ? `(${text}${done ? ")" : ""}` : text}
        {done && <span className="lv-next">◆</span>}
      </div>
    </div>
  );
}

function Chip({
  children,
  onClick,
  on,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  on?: boolean;
  title?: string;
}) {
  return (
    <button className={`lv-chip ${on ? "lv-chip-on" : ""}`} onClick={onClick} title={title}>
      {children}
    </button>
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
  ["badend", "배드 엔딩"],
];

function Gallery({
  got,
  cgs,
  onBack,
  onPlay,
}: {
  got: EndingId[];
  cgs: CgId[];
  onBack: () => void;
  onPlay: (id: BgmId) => void;
}) {
  const [tab, setTab] = useState<"end" | "cg" | "music">("end");
  const [track, setTrack] = useState<BgmId>("title");
  const [view, setView] = useState<CgId | null>(null);
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
        <div className="grid flex-1 grid-cols-3 content-start gap-[1.2cqw]">
          {CG_ORDER.map((id) => {
            const ok = cgs.includes(id);
            return (
              <button
                key={id}
                className={`lv-gal-cg ${ok ? "" : "lv-gal-cg-locked"}`}
                disabled={!ok}
                onClick={() => setView(id)}
              >
                {ok ? (
                  <span
                    className="lv-gal-cg-img"
                    style={{ backgroundImage: `url("${CG[id].src}")` }}
                  />
                ) : (
                  <span className="lv-gal-cg-q">?</span>
                )}
                <span className="lv-gal-cg-cap">
                  <span className={CG[id].who === "amy" ? "text-[#7fd3ff]" : "text-[#8fa8ff]"}>
                    ♥
                  </span>{" "}
                  {ok ? CG[id].title : "아직 못 본 장면"}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {tab === "music" && (
        <div className="grid flex-1 grid-cols-3 content-start gap-[0.8cqw]">
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
      )}
      {view && (
        <button
          className="absolute inset-0 z-50 bg-black bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: `url("${CG[view].src}")` }}
          onClick={() => setView(null)}
          aria-label="닫기"
        />
      )}
      <div className={`grid flex-1 grid-cols-6 gap-[0.8cqw] ${tab === "end" ? "" : "hidden"}`}>
        {ENDINGS.map((e) => {
          const ok = got.includes(e.id);
          return (
            <div key={e.id} className={`lv-cell lv-k-${e.kind} ${ok ? "" : "lv-cell-locked"}`}>
              <div className="text-[0.95cqw] text-white/50">#{e.no}</div>
              <div className="mt-[0.3cqw] text-[1.3cqw] font-bold">{ok ? e.title : "???"}</div>
              <div className="mt-[0.3cqw] text-[0.95cqw] text-white/60">
                {ok ? e.copy : `조건: ${e.hint}`}
              </div>
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
}: {
  cfg: Cfg;
  setCfg: (p: Partial<Cfg>) => void;
  onTest: () => void;
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
      <div className="mt-[1.2cqw] text-[1.05cqw] leading-relaxed text-white/45">
        단축키 — 스페이스 · 엔터 · 클릭: 다음 / Ctrl: 누르는 동안 스킵 / H · 우클릭: 대사창 숨기기 /
        A: 오토 / L · ↑ · 휠 위로: 지난 대사 / Esc: 창 닫기
      </div>
    </div>
  );
}

/** 지난 대사 — 음성 있는 줄은 ♪ 로 다시 듣기, 열면 맨 아래(최근)부터 */
function LogList({
  log,
  sub,
  onVoice,
}: {
  log: { who: Who; text: string }[];
  sub: (t: string) => string;
  onVoice: (u: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, []);
  return (
    <div ref={box} className="flex-1 space-y-[0.8cqw] overflow-y-auto pr-[1cqw]">
      {log.map((l, i) => {
        const v = VOICE_BY_TEXT[l.text];
        return (
          <div key={i} className="flex gap-[0.6cqw] text-[1.45cqw] leading-relaxed">
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
          </div>
        );
      })}
    </div>
  );
}

/** 저장 칸 미리보기: 그때 배경(또는 CG) + 서 있던 캐릭터 */
function SlotThumb({ s }: { s: GState }) {
  const cg = s.disp.cg ? CG[s.disp.cg].src : null;
  const bg = BG[s.disp.bg];
  const ks = (Object.keys(s.disp.chars) as CharKey[]).filter((k) => STAND[k].base);
  return (
    <div
      className="lv-slot-thumb"
      style={
        cg || bg
          ? { backgroundImage: `url("${cg ?? bg}")` }
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

/** 스태프 롤 — 트루 엔딩 직전. 아래에서 위로 천천히, 클릭하면 바로 넘김 */
function StaffRoll({ title, onDone }: { title: string; onDone: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onDone, 21000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rows: [string, string][] = [
    ["", "올인 러브"],
    ["", "ANIME POKER 외전"],
    ["", ""],
    ["기획 · 시나리오 · 개발", "Gunmo"],
    ["", ""],
    ["연서", "무표정의 하우스 플레이어"],
    ["에이미", "딱히, 네 편은 아니거든"],
    ["백상현", "HOUSE 사장"],
    ["태양 · 정민", "펍 단골 (from ANIME POKER)"],
    ["춘희 이모", "HOUSE 주방"],
    ["", ""],
    ["", "그리고 끝까지 테이블을 지켜 준 당신"],
  ];
  return (
    <div
      className="lv-roll absolute inset-0 z-[45] overflow-hidden bg-black"
      onClick={(e) => (e.stopPropagation(), onDone())}
    >
      <div className="lv-roll-inner">
        {rows.map(([a, b], i) => (
          <div key={i} className="mb-[1.6cqw] text-center">
            {a && <div className="text-[1.1cqw] tracking-[0.3em] text-[#c9a25a]">{a}</div>}
            <div className={i < 2 ? "lv-logo text-[3.4cqw]" : "text-[1.8cqw] text-white/85"}>
              {b}
            </div>
          </div>
        ))}
        <div className="mt-[6cqw] text-center text-[2.4cqw] font-black text-[#ffd27a]">{title}</div>
      </div>
      <div className="absolute bottom-[3%] right-[3%] text-[1cqw] text-white/35">
        클릭해서 넘기기
      </div>
    </div>
  );
}
