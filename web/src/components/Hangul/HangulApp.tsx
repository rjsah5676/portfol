"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { prepareRuns } from "@/lib/api/rankRun";
import { ApiError } from "@/lib/api/errors";
import {
  allSyllables,
  composeKeys,
  countTiles,
  DAILY_TIERS,
  dailyNo,
  dailyScore,
  HINT_MAX,
  HINT_SEC,
  isConsTile,
  isVowelTile,
  kstDay,
  pzKey,
  type DailyPuzzle,
  type DailyTier,
} from "@/lib/hangul/daily";
import { gradeName, hangulLen, withEnd, type Judge } from "@/lib/hangul/judge";
import {
  beginDaily,
  checkDaily,
  getDaily,
  getDailyRanking,
  giveUpDaily,
  hintDaily,
  judgeLine,
  likedDaily,
  likeDaily,
  reportHangul,
  submitDaily,
  type DailyRanking,
  type DailySort,
} from "@/firestore/hangulRankings";
import {
  getSound,
  onSoundChange,
  playBgm,
  playSfx,
  preloadSounds,
  setSound,
} from "@/lib/hangul/sound";
import { IMG, preloadImages, type ImgName } from "./assets";
import SfxReview from "./SfxReview";
import GameHeader from "@/components/GameHeader";
import { HANGUL_GUIDE } from "@/data/gameGuides";

/*
 * 니들이 한글을 알아? 「오늘의 자모」 — 매일 난이도마다 속담 하나를 자모로 흩어 줌.
 *   자모를 자판처럼 눌러(두벌식으로 저절로 글자가 됨) 주어진 자모를 다 써서 문장을 만들고 제출:
 *   원래 속담이면 정답, 다른 말이라도 판정기(Kiwi)가 문장이라고 하면 별해. 기록 = 시간 + 힌트 × 30초.
 *   규칙 lib/hangul/daily.ts · 서버 http/hangul.ts(문제 · 확인 · 힌트) · http/rankings.ts(랭킹)
 *   푸는 중인 상태는 localStorage(hangul-daily:<pz>)에 남아서 새로고침해도 이어 풂.
 */

/** 훈장님 한마디 (같은 상황이면 같은 말) */
const SAY = {
  idle: ["흩어진 자모를 다 써서 문장을 지어 보거라.", "니들이 한글을 알아?", "어디 한번 써 보거라."],
  left: ["아직 자모가 남았느니라.", "남김없이 다 써야 하느니라.", "흠, 계속 써 보거라."],
  loose: ["낱자가 굴러다니는구나.", "글자를 제대로 맞춰 보거라.", "받침 하나가 길을 잃었구나."],
  ready: ["옳거니, 제출해 보거라!", "그럴싸하구나. 내 보거라!", "다 썼구나. 어디 보자."],
  hmm: ["이대로는 말이 안 되느니라.", "흠… 이게 문장이라고?", "순서를 바꿔 보거라."],
  wrong: ["어허, 틀렸느니라!", "다시 써 오너라!", "이게 무슨 해괴한 소리냐!"],
  order: ["낱말은 옳다! 순서만 맞추거라.", "거의 다 왔느니라, 차례를 보거라.", "흠, 말의 차례가 틀렸구나."],
  solved: ["장원 급제로다!", "무릎을 탁 치게 하는구나!", "옳거니, 바로 그것이다!"],
  alt: ["허허, 그렇게도 되는구나!", "별해로다! 기특하구나.", "속담은 아니어도 말은 되는구나."],
  gave: ["포기도 공부니라. 내일 다시 오너라.", "정답은 이것이었느니라."],
} as const;
const pick = (arr: readonly string[], seed: string) =>
  arr[[...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % arr.length];

/** 실제 키보드(두벌식 자리) → 자모. Shift 면 된소리 · ㅒ ㅖ */
const KEYMAP: Record<string, [string, string?]> = {
  KeyQ: ["ㅂ", "ㅃ"],
  KeyW: ["ㅈ", "ㅉ"],
  KeyE: ["ㄷ", "ㄸ"],
  KeyR: ["ㄱ", "ㄲ"],
  KeyT: ["ㅅ", "ㅆ"],
  KeyY: ["ㅛ"],
  KeyU: ["ㅕ"],
  KeyI: ["ㅑ"],
  KeyO: ["ㅐ", "ㅒ"],
  KeyP: ["ㅔ", "ㅖ"],
  KeyA: ["ㅁ"],
  KeyS: ["ㄴ"],
  KeyD: ["ㅇ"],
  KeyF: ["ㄹ"],
  KeyG: ["ㅎ"],
  KeyH: ["ㅗ"],
  KeyJ: ["ㅓ"],
  KeyK: ["ㅏ"],
  KeyL: ["ㅣ"],
  KeyZ: ["ㅋ"],
  KeyX: ["ㅌ"],
  KeyC: ["ㅊ"],
  KeyV: ["ㅍ"],
  KeyB: ["ㅠ"],
  KeyN: ["ㅜ"],
  KeyM: ["ㅡ"],
};
/** 키보드로 겹모음 치기 (ㅗ 다음 ㅏ → ㅘ) */
const VCOMB: Record<string, string> = {
  ㅗㅏ: "ㅘ",
  ㅗㅐ: "ㅙ",
  ㅗㅣ: "ㅚ",
  ㅜㅓ: "ㅝ",
  ㅜㅔ: "ㅞ",
  ㅜㅣ: "ㅟ",
  ㅡㅣ: "ㅢ",
};

interface Done {
  kind: "정답" | "별해";
  /** 쓴 그대로(띄어쓰기 없음) · 띄어 쓴 모양 */
  text: string;
  spaced: string;
  answer: string;
  time: number;
  hint: number;
  score: number;
}
/** 퍼즐 하나의 진행 (localStorage) */
interface Saved {
  keys: string[];
  /** 푼 시간(초) — 화면이 보일 때만 흐름 */
  time: number;
  /** 본 힌트 단계 · 값 */
  hint: number;
  hints: Record<number, number[] | string>;
  tries: number;
  done?: Done;
  /** 포기 → 정답 */
  gaveUp?: string;
  /** 랭킹에 올린 기록 id */
  sent?: string;
}
const blank = (): Saved => ({ keys: [], time: 0, hint: 0, hints: {}, tries: 0 });
const saveKey = (pz: string) => `hangul-daily:${pz}`;
function loadSaved(pz: string): Saved | null {
  try {
    const raw = localStorage.getItem(saveKey(pz));
    return raw ? ({ ...blank(), ...(JSON.parse(raw) as Partial<Saved>) } as Saved) : null;
  } catch {
    return null;
  }
}
function storeSaved(pz: string, s: Saved) {
  try {
    localStorage.setItem(saveKey(pz), JSON.stringify(s));
  } catch {}
}

const NAME_KEY = "hangul-name";
const SECRET_KEY = "hangul-secret";
const fmtTime = (s: number) => {
  const t = Math.floor(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
/** 다음 문제까지 (한국 시간 자정) */
const untilNext = (now: number) => {
  const left = 864e5 - ((now + 9 * 3600e3) % 864e5);
  const h = Math.floor(left / 3600e3),
    m = Math.floor((left % 3600e3) / 60e3);
  return h ? `${h}시간 ${m}분` : `${m}분`;
};
const tierLabel = (t: DailyTier) => DAILY_TIERS.find((x) => x.id === t)!.label;

export default function HangulApp() {
  const [now, setNow] = useState(() => Date.now());
  // 날짜 · 남은 시간은 1분마다 (자정이 지나면 새 문제)
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const day = kstDay(now);

  const [tier, setTier] = useState<DailyTier | null>(null);
  const pz = tier ? pzKey(day, tier) : null;
  const [puzzle, setPuzzle] = useState<DailyPuzzle | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [s, setS] = useState<Saved>(blank);
  const sRef = useRef(s);
  useEffect(() => {
    sRef.current = s;
  });
  /** 진행 바꾸기 + 저장 */
  const update = useCallback(
    (f: (x: Saved) => Saved) => {
      setS((cur) => {
        const next = f(cur);
        if (pz) storeSaved(pz, next);
        return next;
      });
    },
    [pz]
  );
  // 시작 화면의 난이도별 상태 (localStorage — 서버 렌더와 어긋나지 않게 처음엔 비워 둠)
  const [stats, setStats] = useState<Partial<Record<DailyTier, Saved | null>>>({});
  const refreshStats = useCallback(() => {
    setStats(Object.fromEntries(DAILY_TIERS.map((t) => [t.id, loadSaved(pzKey(day, t.id))])));
  }, [day]);
  useEffect(() => {
    // localStorage 는 그린 뒤에 읽음
    const id = window.setTimeout(refreshStats, 0);
    return () => window.clearTimeout(id);
  }, [refreshStats, tier]);

  const playing = !!tier && !!puzzle && !s.done && !s.gaveUp;
  useEffect(() => {
    playBgm(playing ? "play" : "title");
  }, [playing]);
  useEffect(() => () => playBgm(null), []);
  useEffect(() => {
    prepareRuns();
  }, []);

  // 에셋(효과음 · 그림) 받기 — 시작 화면에 진행률
  const [assets, setAssets] = useState({ done: 0, total: 1 });
  const ready = assets.done >= assets.total;
  useEffect(() => {
    let alive = true;
    let snd = { done: 0, total: 1 },
      img = { done: 0, total: 1 };
    const sync = () =>
      alive && setAssets({ done: snd.done + img.done, total: snd.total + img.total });
    void preloadSounds((done, total) => ((snd = { done, total }), sync()));
    void preloadImages((done, total) => ((img = { done, total }), sync()));
    return () => {
      alive = false;
    };
  }, []);
  const muted = useSyncExternalStore(
    onSoundChange,
    () => getSound().mute,
    () => false
  );
  const review = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(location.search).get("review") === "sfx",
    () => false
  );

  // ── 퍼즐 열기 ──
  const open = (t: DailyTier) => {
    playSfx("start");
    const key = pzKey(day, t);
    const saved = loadSaved(key);
    setTier(t);
    setPuzzle(null);
    setLoadErr(null);
    setWrong(null);
    setS(saved ?? blank());
    // 처음 여는 퍼즐만 랭킹 티켓 (이어 풀면 받아 둔 티켓을 그대로 씀)
    if (!saved) {
      storeSaved(key, blank());
      beginDaily(key);
    }
    getDaily(key)
      .then(setPuzzle)
      .catch(() => setLoadErr("문제를 받아 오지 못했어요"));
  };
  const back = () => {
    playSfx("click");
    setTier(null);
    setPuzzle(null);
  };

  // ── 시간: 푸는 중 · 화면이 보일 때만 ──
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const t = performance.now();
      const dt = Math.min(1, (t - last) / 1000);
      last = t;
      if (document.hidden) return;
      update((x) => ({ ...x, time: Math.round((x.time + dt) * 10) / 10 }));
    }, 250);
    return () => window.clearInterval(id);
  }, [playing, update]);

  // ── 자판 ──
  const tiles = useMemo(() => puzzle?.tiles ?? [], [puzzle]);
  const total = useMemo(() => countTiles(tiles), [tiles]);
  const usedCount = useMemo(() => countTiles(s.keys), [s.keys]);
  const rem = (j: string) => (total.get(j) ?? 0) - (usedCount.get(j) ?? 0);
  const left = tiles.length - s.keys.length;
  const keyOrder = useMemo(() => [...new Set(tiles)], [tiles]);
  const cons = keyOrder.filter(isConsTile);
  const vows = keyOrder.filter(isVowelTile);
  const text = composeKeys(s.keys);
  const complete = left === 0 && allSyllables(text);
  /** 키보드 겹모음: ㅗ 를 이미 다 썼어도 ㅘ 를 치려고 ㅗ 를 누른 상태 */
  const [pend, setPend] = useState<string | null>(null);
  const [wrong, setWrong] = useState<{ why: "tiles" | "sentence" | "order"; text: string } | null>(
    null
  );
  const [bump, setBump] = useState<string | null>(null);

  const press = (j: string, fromKey = false) => {
    if (!playing) return;
    const last = s.keys.at(-1);
    if (fromKey && isVowelTile(j)) {
      const base = pend ?? last;
      const combo = base ? VCOMB[base + j] : undefined;
      if (combo && rem(combo) > 0) {
        setPend(null);
        playSfx("place");
        setWrong(null);
        update((x) => ({ ...x, keys: pend ? [...x.keys, combo] : [...x.keys.slice(0, -1), combo] }));
        return;
      }
      if (rem(j) <= 0 && Object.keys(VCOMB).some((k) => k[0] === j && rem(VCOMB[k]) > 0)) {
        setPend(j);
        return;
      }
    }
    setPend(null);
    if (rem(j) <= 0) {
      playSfx("discard");
      setBump(j);
      window.setTimeout(() => setBump((b) => (b === j ? null : b)), 300);
      return;
    }
    playSfx("place");
    setWrong(null);
    update((x) => ({ ...x, keys: [...x.keys, j] }));
  };
  const erase = () => {
    if (!playing) return;
    if (pend) return setPend(null);
    if (!s.keys.length) return;
    playSfx("erase");
    setWrong(null);
    update((x) => ({ ...x, keys: x.keys.slice(0, -1) }));
  };
  const clearAll = () => {
    if (!playing || !s.keys.length) return;
    playSfx("discard");
    setPend(null);
    setWrong(null);
    update((x) => ({ ...x, keys: [] }));
  };

  // ── 제출 ──
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!pz || !complete || checking || !playing) return;
    setChecking(true);
    setErr(null);
    try {
      const c = await checkDaily(pz, text);
      if (c.kind && c.answer) {
        const cur = sRef.current;
        const done: Done = {
          kind: c.kind,
          text,
          spaced: c.spaced,
          answer: c.answer,
          time: cur.time,
          hint: cur.hint,
          score: dailyScore(cur.time, cur.hint),
        };
        playSfx(c.kind === "정답" ? "sent-best" : "sent-good");
        update((x) => ({ ...x, done }));
      } else {
        playSfx("sent-meh");
        setWrong({ why: c.why ?? "sentence", text });
        update((x) => ({ ...x, tries: x.tries + 1 }));
      }
    } catch (e) {
      setErr(
        e instanceof ApiError && e.code === "JUDGE_OFF"
          ? "판정 서버가 아직 준비되지 않았어요"
          : "서버에 연결할 수 없어요"
      );
    } finally {
      setChecking(false);
    }
  };

  // ── 힌트 · 포기 ──
  const [hintBusy, setHintBusy] = useState(false);
  const askHint = async () => {
    if (!pz || hintBusy || !playing || s.hint >= HINT_MAX) return;
    setHintBusy(true);
    setErr(null);
    try {
      const n = s.hint + 1;
      const v = await hintDaily(pz, n);
      playSfx("open");
      update((x) => ({ ...x, hint: Math.max(x.hint, n), hints: { ...x.hints, [n]: v } }));
    } catch {
      setErr("힌트를 받아 오지 못했어요");
    } finally {
      setHintBusy(false);
    }
  };
  const [giveSure, setGiveSure] = useState(false);
  const giveUp = async () => {
    if (!pz || !playing) return;
    if (!giveSure) {
      playSfx("click");
      setGiveSure(true);
      window.setTimeout(() => setGiveSure(false), 3000);
      return;
    }
    setGiveSure(false);
    try {
      const a = await giveUpDaily(pz);
      playSfx("over");
      setWrong(null);
      update((x) => ({ ...x, gaveUp: a }));
    } catch {
      setErr("서버에 연결할 수 없어요");
    }
  };

  // 실제 키보드: 두벌식 자리 · Backspace · Enter (입력 칸에 있을 땐 안 가로챔)
  const keyRef = useRef({ press, erase, submit });
  useEffect(() => {
    keyRef.current = { press, erase, submit };
  });
  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "Backspace") {
        e.preventDefault();
        keyRef.current.erase();
      } else if (e.code === "Enter") {
        e.preventDefault();
        void keyRef.current.submit();
      } else if (KEYMAP[e.code]) {
        e.preventDefault();
        const [a, b] = KEYMAP[e.code];
        keyRef.current.press(e.shiftKey && b ? b : a, true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing]);

  // ── 지금 줄 판정 (훈장님 반응용) — 자모를 다 써서 글자가 다 됐을 때만 ──
  const [judge, setJudge] = useState<Judge | null>(null);
  useEffect(() => {
    if (!complete) return;
    let alive = true;
    const id = window.setTimeout(() => {
      judgeLine(text)
        .then((j) => alive && setJudge(j))
        .catch(() => {});
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [complete, text]);
  const j = complete && judge?.text === text ? judge : null;

  // 훈장님 표정 · 한마디
  const seed = `${pz}:${text}`;
  const teacher: { face: ImgName; say: string } = s.done
    ? s.done.kind === "정답"
      ? { face: "hunjangWow", say: pick(SAY.solved, seed) }
      : { face: "hunjangNod", say: pick(SAY.alt, seed) }
    : s.gaveUp
      ? { face: "hunjangHmm", say: pick(SAY.gave, seed) }
      : wrong && wrong.text === text
        ? wrong.why === "order"
          ? { face: "hunjangNod", say: pick(SAY.order, seed) }
          : { face: "hunjangAngry", say: pick(SAY.wrong, seed) }
        : !s.keys.length
          ? { face: "hunjang", say: pick(SAY.idle, seed) }
          : left > 0
            ? { face: "hunjang", say: pick(SAY.left, seed) }
            : !complete
              ? { face: "hunjangHmm", say: pick(SAY.loose, seed) }
              : j && !j.sentence
                ? { face: "hunjangHmm", say: pick(SAY.hmm, seed) }
                : { face: j && gradeName(j) === "명문" ? "hunjangWow" : "hunjangNod", say: pick(SAY.ready, seed) };
  const msg = !puzzle
    ? ""
    : s.done
      ? `${s.done.kind}! 띄어 쓰면 「${withEnd(s.done.spaced)}」`
      : s.gaveUp
        ? "포기한 판이에요"
    : wrong && wrong.text === text
      ? wrong.why === "order"
        ? "낱말은 다 맞았어요! 순서만 바꾼 건 별해로 안 쳐요 — 속담 순서를 찾아 보세요"
        : wrong.why === "sentence"
          ? "속담도 아니고, 판정기가 문장으로 안 읽어요. 순서를 바꿔 보세요"
          : "주어진 자모를 정확히 다 써야 해요"
      : left > 0
        ? `자모 ${left}개 남음`
        : !complete
          ? "글자가 안 된 낱자가 있어요 — 받침 · 첫소리를 맞춰 보세요"
          : j
            ? j.sentence
              ? `다 썼어요! 판정기: 문장 (${gradeName(j)}) — 제출해 보세요`
              : "다 썼어요! 판정기는 아직 문장이 아니래요 — 그래도 속담이면 정답"
            : "다 썼어요! 제출해 보세요";
  const [reported, setReported] = useState<Set<string>>(() => new Set());
  const report = () => {
    if (!wrong || reported.has(wrong.text)) return;
    const t = wrong.text;
    setReported((r) => new Set(r).add(t));
    void reportHangul(t).catch(() => {});
  };

  // ── 원고지: 힌트 1(띄어쓰기 틀)이 있으면 낱말마다 끊어서 ──
  const chars = [...text];
  const len = puzzle?.len ?? 0;
  const skeleton = (s.hints[1] as number[] | undefined) ?? null;
  const chos = typeof s.hints[3] === "string" ? (s.hints[3] as string).replace(/ /g, "") : "";
  const first = typeof s.hints[2] === "string" ? (s.hints[2] as string) : "";
  const groups: number[] = (() => {
    const n = Math.max(len, chars.length);
    if (!skeleton) return [n];
    const g = [...skeleton];
    const extra = n - len;
    if (extra > 0) g[g.length - 1] += extra;
    return g;
  })();
  const cellsOf = () => {
    let k = 0;
    return groups.map((n, gi) => (
      <div className="hg-word" key={gi}>
        {Array.from({ length: n }, () => {
          const i = k++;
          const ch = chars[i];
          const loose = ch && !/[가-힣]/.test(ch);
          const ph = chos[i] ?? (i === 0 ? first : "");
          return (
            <span
              key={i}
              className={`hg-cell${ch ? " is-on" : ""}${loose ? " is-loose" : ""}${
                i === chars.length && playing ? " is-caret" : ""
              }`}
            >
              {ph && <small className={i === 0 && first ? "is-first" : ""}>{i === 0 && first ? first : ph}</small>}
              {ch}
            </span>
          );
        })}
      </div>
    ));
  };

  // ── 랭킹 · 등록 ──
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [secret, setSecret] = useState(() => {
    try {
      return localStorage.getItem(SECRET_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [sending, setSending] = useState<"idle" | "sending" | "fail">("idle");
  const send = async () => {
    if (!pz || !s.done || sending === "sending" || s.sent) return;
    const nm = name.trim() || "무명";
    setSending("sending");
    try {
      try {
        localStorage.setItem(NAME_KEY, name.trim());
        localStorage.setItem(SECRET_KEY, secret ? "1" : "0");
      } catch {}
      const d = s.done;
      const id = await submitDaily(pz, {
        name: nm,
        time: d.time,
        hint: d.hint,
        score: d.score,
        text: d.text,
        ...(secret && { secret: true }),
      });
      playSfx("like");
      update((x) => ({ ...x, sent: id }));
      setSending("idle");
    } catch {
      setSending("fail");
    }
  };

  const [rankOpen, setRankOpen] = useState(false);
  const [rankTier, setRankTier] = useState<DailyTier>(1);
  const [rankSort, setRankSort] = useState<DailySort>("top");
  const [ranks, setRanks] = useState<DailyRanking[] | null>(null);
  const [liked, setLiked] = useState<Set<string>>(() => new Set());
  const [liking, setLiking] = useState<string | null>(null);
  const [rankMsg, setRankMsg] = useState<string | null>(null);
  const loadRanks = useCallback(
    (t: DailyTier, sort: DailySort) => {
      setRanks(null);
      getDailyRanking(pzKey(day, t), sort)
        .then((rs) => {
          setRanks(rs);
          if (sort !== "top")
            likedDaily(rs.map((r) => r.id))
              .then(setLiked)
              .catch(() => {});
        })
        .catch(() => setRanks([]));
    },
    [day]
  );
  const openRanks = (t: DailyTier = tier ?? 1, sort: DailySort = "top") => {
    playSfx(rankOpen ? "click" : "open");
    refreshStats();
    setRankTier(t);
    setRankSort(sort);
    setRankOpen(true);
    loadRanks(t, sort);
  };
  useEffect(() => {
    if (!rankOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setRankOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rankOpen]);
  const toggleLike = async (r: DailyRanking) => {
    if (liking) return;
    const on = !liked.has(r.id);
    setLiking(r.id);
    try {
      const n = await likeDaily(r.id, on);
      if (on) playSfx("like");
      setLiked((x) => {
        const t = new Set(x);
        if (on) t.add(r.id);
        else t.delete(r.id);
        return t;
      });
      setRanks((rs) => rs?.map((x) => (x.id === r.id ? { ...x, likes: n } : x)) ?? rs);
    } catch (e) {
      setRankMsg(
        e instanceof ApiError && e.code === "OWN_RECORD" ? "내 문장에는 누를 수 없어요" : "누르지 못했어요"
      );
      window.setTimeout(() => setRankMsg(null), 2000);
    }
    setLiking(null);
  };

  // ── 공유 (스포일러 없이) ──
  const [shared, setShared] = useState(false);
  const share = async () => {
    if (!tier || !(s.done || s.gaveUp)) return;
    playSfx("card");
    const no = dailyNo(day);
    const line = s.done
      ? `${s.done.kind === "정답" ? "🏆 정답" : "✨ 별해"} · ${fmtTime(s.done.time)}${s.done.hint ? ` · 힌트 ${s.done.hint}` : ""}`
      : "🏳️ 포기";
    const body = `니들이 한글을 알아? 오늘의 자모 #${no} (${tierLabel(tier)})\n${line}\n${location.origin}/games/hangul/`;
    try {
      if (navigator.share) await navigator.share({ text: body });
      else {
        await navigator.clipboard.writeText(body);
        setShared(true);
        window.setTimeout(() => setShared(false), 1800);
      }
    } catch {
      /* 공유 취소는 조용히 */
    }
  };

  const no = dailyNo(day);
  const solvedOf = (t: DailyTier) => {
    const x = stats[t];
    return !!(x?.done || x?.gaveUp);
  };

  return (
    <>
      {/* 사이트 공통 게임 머리말 (가이드) + 랭킹 · 소리 — hg-root 밖에 둬야 사이트 글자색(흰색)을 그대로 씀 */}
      <div className="mx-auto w-full max-w-[1180px]">
        <GameHeader
          icon="px:hangul"
          title="니들이 한글을 알아?"
          en="Daily Jamo Puzzle"
          accent="#E0533F"
          desc="매일 흩어진 자모를 다 써서 숨은 속담을 맞히는 한글 데일리 퍼즐"
          tags={["한글 게임", "데일리 퍼즐", "속담", "자모 퍼즐"]}
          guide={HANGUL_GUIDE}
          badge="NEW"
          extra={(pill) => (
            <>
              <button
                type="button"
                onClick={() => openRanks()}
                className={`${pill} border-[#E0533F]/35 bg-[#E0533F]/[0.08] text-[#FFB3A6] hover:border-[#E0533F]/65`}
              >
                <span aria-hidden>🏆</span>
                <span>랭킹</span>
              </button>
              <button
                type="button"
                onClick={() => setSound({ mute: !muted })}
                aria-label={muted ? "소리 켜기" : "소리 끄기"}
                className={`${pill} border-white/15 bg-white/[0.04] text-white/75 hover:border-white/35`}
              >
                <span aria-hidden>{muted ? "🔇" : "🔊"}</span>
                <span>{muted ? "소리 꺼짐" : "소리"}</span>
              </button>
            </>
          )}
        />
      </div>
      <div className="hg-root">
        <div className="hg-board">
          {!tier ? (
            // ── 시작 화면: 오늘의 자모 #N · 난이도 셋 ──
            <div className="hg-title">
              <img className="hg-title-teacher" src={IMG.hunjang} alt="" draggable={false} />
              <h2 className="hg-logo">
                니들이 <em>한글</em>을 알아?
              </h2>
              <p className="hg-title-sub">
                <b>오늘의 자모 #{no}</b> · 흩어진 자모를 <b>다 써서</b> 숨은 속담을 맞혀라
              </p>
              {ready ? (
                <div className="hg-tiers">
                  {DAILY_TIERS.map((t) => {
                    const x = stats[t.id];
                    const state = x?.done
                      ? `${x.done.kind} ✓ ${fmtTime(x.done.score)}`
                      : x?.gaveUp
                        ? "포기"
                        : x && (x.keys.length || x.time > 0)
                          ? `이어 풀기 · ${fmtTime(x.time)}`
                          : "풀기";
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={`hg-tier t${t.id}${x?.done ? " is-done" : ""}${x?.gaveUp ? " is-gave" : ""}`}
                        onClick={() => open(t.id)}
                      >
                        <b>{t.label}</b>
                        <small>{t.desc}</small>
                        <span>{state}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div
                  className="hg-loading"
                  role="progressbar"
                  aria-valuenow={Math.round((assets.done / assets.total) * 100)}
                >
                  <i style={{ transform: `scaleX(${assets.done / assets.total})` }} />
                  <span>먹을 가는 중… {Math.round((assets.done / assets.total) * 100)}%</span>
                </div>
              )}
              <p className="hg-title-rule">
                속담 그대로면 <b>정답</b>, 다른 문장이라도 말이 되면 <b>별해</b> · 기록 = 시간 + 힌트 ×
                {HINT_SEC}초 · 다음 문제까지 {untilNext(now)}
              </p>
            </div>
          ) : (
            <div className="hg-play">
              <div className="hg-top">
                <button type="button" className="hg-back" onClick={back} aria-label="난이도 고르기로">
                  ← 난이도
                </button>
                <b>
                  #{no} · {tierLabel(tier)}
                </b>
                <span className="hg-clock" aria-label="걸린 시간">
                  ⏱ {fmtTime(s.done?.time ?? s.time)}
                </span>
                {s.hint > 0 && <span className="hg-pen">힌트 +{s.hint * HINT_SEC}초</span>}
              </div>

              <section className="hg-sheet">
                <div className="hg-linehead">
                  <h3>
                    원고지 <small>{puzzle ? `${hangulLen(text)}/${puzzle.len}글자` : ""}</small>
                  </h3>
                  <div className={`hg-teacher is-${teacher.face}`} key={teacher.face}>
                    <p>{teacher.say}</p>
                    <img src={IMG[teacher.face]} alt="" draggable={false} />
                  </div>
                </div>
                {!puzzle ? (
                  <p className="hg-dim hg-wait">{loadErr ?? "문제를 펼치는 중…"}</p>
                ) : (
                  <>
                    <div className="hg-words" aria-label={text || "빈 원고지"}>
                      {cellsOf()}
                      {pend && <span className="hg-pend">{pend}+</span>}
                    </div>
                    <p className={`hg-msg${complete ? " is-ok" : ""}${wrong && wrong.text === text ? " is-bad" : ""}`}>
                      {msg}
                      {wrong?.why === "sentence" && wrong.text === text && (
                        <button
                          type="button"
                          className="hg-report"
                          onClick={report}
                          disabled={reported.has(wrong.text)}
                        >
                          {reported.has(wrong.text) ? "신고했어요 ✓" : "🙋 이거 말 되는데?"}
                        </button>
                      )}
                    </p>
                    {err && <p className="hg-err">{err}</p>}
                    {s.hint > 0 && (
                      <div className="hg-hintbox">
                        {s.hints[1] && <span>띄어쓰기 {(s.hints[1] as number[]).join(" · ")}</span>}
                        {s.hints[2] && <span>첫 글자 「{s.hints[2] as string}」</span>}
                        {s.hints[3] && <span>초성 {s.hints[3] as string}</span>}
                      </div>
                    )}
                  </>
                )}
              </section>

              {puzzle && playing && (
                <>
                  <div className="hg-keys">
                    {[cons, vows].map((row, ri) => (
                      <div key={ri} className={`hg-keyrow ${ri ? "is-v" : "is-c"}`}>
                        {row.map((k) => {
                          const n = rem(k);
                          return (
                            <button
                              key={k}
                              type="button"
                              className={`hg-key${n ? "" : " is-out"}${bump === k ? " is-bump" : ""}`}
                              onClick={() => press(k)}
                              disabled={!playing}
                              aria-label={`${k} ${n}개 남음`}
                            >
                              <span>{k}</span>
                              {(total.get(k) ?? 0) > 1 && <small>×{n}</small>}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  <div className="hg-acts">
                    <button type="button" onClick={erase} disabled={!playing || (!s.keys.length && !pend)}>
                      ⌫ 하나 지우기
                    </button>
                    <button type="button" onClick={clearAll} disabled={!playing || !s.keys.length}>
                      전부 지우기
                    </button>
                    <button
                      type="button"
                      onClick={askHint}
                      disabled={!playing || hintBusy || s.hint >= HINT_MAX}
                      title={`힌트마다 +${HINT_SEC}초`}
                    >
                      💡 힌트 {s.hint}/{HINT_MAX}
                      <small>
                        {s.hint >= HINT_MAX
                          ? "다 봤어요"
                          : ["띄어쓰기", "첫 글자", "초성"][s.hint] + ` +${HINT_SEC}초`}
                      </small>
                    </button>
                    <button type="button" className={giveSure ? "is-sure" : ""} onClick={giveUp} disabled={!playing}>
                      {giveSure ? "정말 포기?" : "🏳️ 포기"}
                    </button>
                    <button
                      type="button"
                      className="hg-go"
                      onClick={submit}
                      disabled={!playing || !complete || checking}
                    >
                      {checking ? "보는 중…" : "제출!"}
                    </button>
                  </div>
                  <p className="hg-kbd">키보드로도 쳐요 (두벌식 자리 · Shift 된소리 · ⌫ 지우기 · Enter 제출)</p>
                </>
              )}

              {/* ── 결과: 자판 자리에 ── */}
              {(s.done || s.gaveUp) && (
                <div className="hg-result">
                  <div className="hg-card">
                    <img
                      className="hg-cardteacher"
                      src={IMG[teacher.face]}
                      alt=""
                      draggable={false}
                    />
                    <h2>{s.done ? (s.done.kind === "정답" ? "장원 급제!" : "별해 인정!") : "포기했어요"}</h2>
                    {s.done && (
                      <p className="hg-best">
                        {withEnd(s.done.spaced)}
                        <small>{s.done.kind === "정답" ? "숨은 속담을 그대로 맞혔어요" : "내가 지은 문장"}</small>
                      </p>
                    )}
                    {(s.gaveUp || s.done?.kind === "별해") && (
                      <p className="hg-answer">
                        <small>오늘의 속담</small>
                        {s.gaveUp ?? s.done?.answer}
                      </p>
                    )}
                    {s.done && (
                      <p className="hg-recline">
                        ⏱ {fmtTime(s.done.time)}
                        {s.done.hint ? ` + 힌트 ${s.done.hint}개(${s.done.hint * HINT_SEC}초)` : ""} → 기록{" "}
                        <b>{fmtTime(s.done.score)}</b>
                        {s.tries ? <span className="hg-dim"> · 틀린 제출 {s.tries}번</span> : null}
                      </p>
                    )}
                    {s.done &&
                      (s.sent ? (
                        <p className="hg-dim">랭킹에 올렸어요 ✓</p>
                      ) : (
                        <>
                          <div className="hg-submit">
                            <input
                              value={secret ? "익명" : name}
                              onChange={(e) => setName(e.target.value.slice(0, 10))}
                              placeholder="이름 (회원은 별명으로)"
                              maxLength={10}
                              disabled={secret}
                              onKeyDown={(e) => e.key === "Enter" && void send()}
                            />
                            <button type="button" onClick={send} disabled={sending === "sending"}>
                              {sending === "sending" ? "올리는 중…" : "랭킹 올리기"}
                            </button>
                          </div>
                          <label className="hg-secret">
                            <input
                              type="checkbox"
                              checked={secret}
                              onChange={(e) => setSecret(e.target.checked)}
                            />
                            시크릿 (익명으로 올리기)
                          </label>
                          {sending === "fail" && (
                            <p className="hg-err">올리지 못했어요 (이미 올렸거나 연결이 안 돼요)</p>
                          )}
                        </>
                      ))}
                    <div className="hg-overbtns">
                      <button type="button" className="hg-ghost" onClick={share}>
                        {shared ? "복사했어요 ✓" : "📤 자랑하기"}
                      </button>
                      <button
                        type="button"
                        className="hg-ghost"
                        onClick={() => openRanks(tier, s.done?.kind === "별해" ? "fun" : "top")}
                      >
                        🏆 랭킹 · 별해 구경
                      </button>
                    </div>
                    <button type="button" className="hg-go" onClick={back}>
                      다른 난이도 풀기
                    </button>
                    <p className="hg-dim">다음 문제까지 {untilNext(now)}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {review && <SfxReview />}
      </div>

      {/* 랭킹 창 — 내가 아직 안 푼 난이도는 문장을 가림 (정답 스포일러) */}
      {rankOpen &&
        createPortal(
          <div className="hg-root hg-portal">
            <div
              className="hg-rankpop"
              role="dialog"
              aria-modal="true"
              aria-label="오늘의 자모 랭킹"
              onClick={(e) => e.target === e.currentTarget && setRankOpen(false)}
            >
              <div className="hg-ranks">
                <header>
                  <h2>#{no} 랭킹</h2>
                  <div className="hg-rtabs">
                    {DAILY_TIERS.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={rankTier === t.id ? "is-on" : ""}
                        onClick={() => (playSfx("click"), setRankTier(t.id), loadRanks(t.id, rankSort))}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="hg-rclose" onClick={() => setRankOpen(false)} aria-label="닫기">
                    ✕
                  </button>
                </header>
                <div className="hg-rtabs is-sort">
                  {(
                    [
                      ["top", "기록순"],
                      ["fun", "별해 자랑"],
                      ["new", "별해 최신"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className={rankSort === k ? "is-on" : ""}
                      onClick={() => (playSfx("click"), setRankSort(k), loadRanks(rankTier, k))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {!solvedOf(rankTier) && (
                  <p className="hg-rlock">🔒 {tierLabel(rankTier)}을 풀거나 포기하면 문장이 보여요</p>
                )}
                {rankMsg && <p className="hg-rmsg">{rankMsg}</p>}
                {!ranks ? (
                  <p className="hg-dim">불러오는 중…</p>
                ) : !ranks.length ? (
                  <p className="hg-dim">
                    {rankSort === "top" ? "아직 아무도 못 풀었어요. 첫 번째가 되어 보세요!" : "아직 별해가 없어요"}
                  </p>
                ) : (
                  <ol>
                    {ranks.map((r, i) => {
                      const show = solvedOf(rankTier);
                      return (
                        <li key={r.id} className={rankSort === "top" && i < 3 ? `is-top t${i + 1}` : ""}>
                          {rankSort === "top" && <span className="hg-rk">{i + 1}</span>}
                          <p className={`hg-rq${show ? "" : " is-none"}`}>
                            {show ? withEnd(r.spaced ?? r.text) : "🔒 풀면 보여요"}
                          </p>
                          <p className="hg-rn">
                            <span>{r.name}</span>
                            <span className={`hg-kind k-${r.kind === "별해" ? "alt" : "ans"}`}>{r.kind ?? "정답"}</span>
                            <span>
                              <b>{fmtTime(r.score)}</b>
                              {r.hint ? ` (힌트 ${r.hint})` : ""}
                            </span>
                            {rankSort !== "top" && (
                              <button
                                type="button"
                                className={`hg-like${liked.has(r.id) ? " is-on" : ""}`}
                                onClick={() => void toggleLike(r)}
                                disabled={!show || liking === r.id}
                              >
                                👍 <b>{r.likes ?? 0}</b>
                              </button>
                            )}
                          </p>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
