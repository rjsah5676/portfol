"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { prepareRuns, signIn } from "@/lib/api/rankRun";
import { ApiError } from "@/lib/api/errors";
import { serverNow } from "@/lib/api/socket";
import { auth } from "@/firebase";
import { linkMorphs } from "@/lib/hangul/link";
import { counterTarget, seeded, type VsAttack, type VsRoom } from "@/lib/hangul/versus";
import {
  againVs,
  botVs,
  createVs,
  emoteVs,
  joinVs,
  leaveVs,
  loadVs,
  sentenceVs,
  startVs,
  voteVs,
  watchVs,
} from "@/realtime/hangulVs";
import { VsBar, VsCutin, VsFeed, VsLobby, VsResult, VsWaiting } from "./Versus";
import {
  addByIds,
  addPunct,
  autoPair,
  best,
  pieces,
  bindWord,
  CAP,
  combine,
  CONS_SLOTS,
  VOWEL_SLOTS,
  draw,
  incoming,
  STACK_C,
  STACK_V,
  START_DRAW,
  finishSentence,
  fromLine,
  lineCells,
  lineText,
  load,
  makeWord,
  say,
  LOAD_MAX,
  newGame,
  dropSentence,
  linkBonus,
  links,
  moveSentence,
  POS_STYLE,
  score,
  SHELF_ID,
  writingPower,
  discard,
  setPath,
  statsOf,
  step,
  toLine,
  type Game,
  type Sentence,
  type Zone,
} from "@/lib/hangul/game";
import {
  gradeName,
  HANGUL_WAVE_PTS,
  hangulLen,
  LINE_MAX,
  PUNCTS,
  withEnd,
  type Judge,
  type Morph,
} from "@/lib/hangul/judge";
import { shown } from "@/lib/hangul/jamo";
import {
  beginHangul,
  getHangulRanking,
  judgeLine,
  likedHangul,
  likeHangul,
  reportHangul,
  submitHangul,
  suggestLine,
  type HangulRanking,
  type HangulSort,
  type Suggestion,
} from "@/firestore/hangulRankings";
import { drawField } from "./draw";
import { shareCard } from "./shareCard";
import {
  getSound,
  onSoundChange,
  playAll,
  playBgm,
  playSfx,
  preloadSounds,
  setSound,
} from "@/lib/hangul/sound";
import { IMG, INK, preloadImages, type ImgName } from "./assets";
import SfxReview from "./SfxReview";
import GameHeader from "@/components/GameHeader";
import { HANGUL_GUIDE } from "@/data/gameGuides";

/** 훈장님 한마디 (표정마다 몇 개 — 같은 줄이면 같은 말) */
const TEACHER: Record<ImgName, string[]> = {
  hunjang: [
    "어디 한번 써 보거라.",
    "니들이 한글을 알아?",
    "글자를 모아 문장을 지어 보아라.",
    "먹물이 몰려온다, 서둘러라!",
  ],
  hunjangWow: [
    "명문이로다!",
    "오호, 이런 문장이!",
    "무릎을 탁 치게 하는구나!",
    "장원 급제감이로다!",
  ],
  hunjangNod: ["옳거니.", "그럭저럭 말이 되는구나.", "흠, 쓸 만하다.", "그래, 그거다."],
  hunjangHmm: [
    "억지로구나…",
    "말이 되긴… 하는 게냐?",
    "흠… 이게 문장이라고?",
    "애매하구나, 애매해.",
  ],
  hunjangAngry: [
    "이게 무슨 해괴한 소리냐!",
    "외계어를 쓰는 게냐!",
    "어허, 사전에 없는 말이다!",
    "다시 써 오너라!",
  ],
};
const GRADE_FACE: Record<string, ImgName> = {
  명문: "hunjangWow",
  "말 됨": "hunjangNod",
  억지: "hunjangHmm",
  막말: "hunjangAngry",
};
/** 막말(명사로 끝나는 문장) 한마디 — 얼굴은 버럭이지만 외계어와 다른 말 */
const RUDE_SAY = [
  "어허, 막말이로다!",
  "서술어는 어디다 두고 왔느냐?",
  "말끝을 맺거라, 말끝을!",
  "고얀 놈 같으니…",
];
const lineOf = (arr: string[], seed: string) =>
  arr[[...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % arr.length];

/*
 * 니들이 한글을 알아? — 아무 말이나 이어 붙여 먹물을 막는 무한 디펜스 (프로토)
 * 진행은 lib/hangul/game.ts, 문장 판정은 서버(형태소 분석기 Kiwi)
 */

const TAG: [RegExp, string][] = [
  [/^NNB/, "의존명사"],
  [/^NN/, "명사"],
  [/^NP/, "대명사"],
  [/^NR/, "수사"],
  [/^VV/, "동사"],
  [/^VA/, "형용사"],
  [/^VX/, "보조용언"],
  [/^VCP/, "이다"],
  [/^VCN/, "아니다"],
  [/^MM/, "관형사"],
  [/^MA/, "부사"],
  [/^IC/, "감탄사"],
  [/^J/, "조사"],
  [/^EP/, "시제"],
  [/^EF/, "끝맺음"],
  [/^EC/, "이음"],
  [/^ET/, "바꿈"],
  [/^XS/, "꼬리"],
  [/^XP/, "머리"],
  [/^XR/, "어근"],
];
const tagName = (m: Morph) => (m.k ? (TAG.find(([re]) => re.test(m.t))?.[1] ?? m.t) : "모르는 말");

const NAME_KEY = "hangul-name";
const SECRET_KEY = "hangul-secret";
const ago = (d: Date | null) => {
  if (!d) return "";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}일 전`;
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
};
const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

export default function HangulApp() {
  const [g, setG] = useState<Game>(newGame);
  const [, setTick] = useState(0);
  const [phase, setPhase] = useState<"ready" | "play" | "over">("ready");
  // ── 대전 「말싸움」: 고르는 화면 · 들어간 방 · 방 상태 (규칙 lib/hangul/versus.ts, 서버 games/hangulVs.ts) ──
  const [vsLobby, setVsLobby] = useState(false);
  const [vs, setVs] = useState<{ id: string; me: string } | null>(null);
  const [vsRoom, setVsRoom] = useState<VsRoom | null>(null);
  const [vsBusy, setVsBusy] = useState(false);
  const [vsErr, setVsErr] = useState<string | null>(null);
  const [emotes, setEmotes] = useState<{ uid: string; e: string; at: number }[]>([]);
  const [cutin, setCutin] = useState<VsAttack | null>(null);
  const vsRef = useRef<{ id: string; me: string; room: VsRoom | null } | null>(null);
  /** 지금 판을 시작한 시드 (같은 방 상태가 다시 와도 판을 새로 만들지 않게) · 이미 먹물로 받은 공격 */
  const vsSeedRef = useRef(0);
  const landedRef = useRef(new Set<string>());
  const vsOn = !!vs;
  // 배경음악: 판 중엔 play, 그 밖엔 title (파일 없으면 조용)
  useEffect(() => {
    playBgm(phase === "play" ? "play" : "title");
  }, [phase]);
  useEffect(() => () => playBgm(null), []);
  const [sel, setSel] = useState<{ z: Zone; i: number } | null>(null);
  const [wordBusy, setWordBusy] = useState(false);
  const [selling, setSelling] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [judge, setJudge] = useState<Judge | null>(null);
  const [judgeErr, setJudgeErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<Sentence | null>(null);
  const [ranks, setRanks] = useState<HangulRanking[] | null>(null);
  // 이름 칸은 판이 끝나야 그려서 서버 렌더와 어긋날 일 없음
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [sent, setSent] = useState<"idle" | "sending" | "done" | "fail">("idle");
  // 시크릿 등록 (익명) — 고른 걸 기억해 둠
  const [secret, setSecret] = useState(() => {
    try {
      return localStorage.getItem(SECRET_KEY) === "1";
    } catch {
      return false;
    }
  });
  // 랭킹 창 (열려 있는 동안 판은 멈춤)
  const [rankOpen, setRankOpen] = useState(false);
  const [rankSort, setRankSort] = useState<HangulSort>("top");
  // 👍 웃겨요: 내가 누른 기록 · 누르는 중인 기록
  const [liked, setLiked] = useState<Set<string>>(() => new Set());
  const [liking, setLiking] = useState<string | null>(null);
  // 사전에 없는 말 신고한 줄 (같은 줄은 한 번만)
  const [reported, setReported] = useState<Set<string>>(() => new Set());
  const [sharing, setSharing] = useState(false);
  const [rankMsg, setRankMsg] = useState<string | null>(null);
  const [sugs, setSugs] = useState<{
    line: string;
    list: (Suggestion & { ids: number[] })[];
  } | null>(null);
  const [sugBusy, setSugBusy] = useState(false);

  const fieldRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posRef = useRef(new Map<number, { x: number; y: number }>());
  const shelfRef = useRef<HTMLDivElement>(null);
  // 새 문장이 글 끝에 붙으면 목록을 맨 아래로
  const shelfLen = g.shelf.length;
  useEffect(() => {
    const el = shelfRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shelfLen]);
  const speedRef = useRef(1);
  const phaseRef = useRef(phase);
  const pauseRef = useRef(false);
  useEffect(() => {
    speedRef.current = speed;
    phaseRef.current = phase;
    // 대전은 실시간이라 랭킹 창을 열어도 안 멈춤
    pauseRef.current = rankOpen && !vs;
    vsRef.current = vs ? { ...vs, room: vsRoom } : null;
  }, [speed, phase, rankOpen, vs, vsRoom]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // 랭킹 · 이름
  const loadRanks = useCallback((sort: HangulSort) => {
    getHangulRanking(50, sort)
      .then((rs) => {
        setRanks(rs);
        likedHangul(rs.map((r) => r.id))
          .then(setLiked)
          .catch(() => {});
      })
      .catch(() => setRanks([]));
  }, []);
  useEffect(() => {
    prepareRuns();
  }, []);
  // 에셋(효과음 · 그림)을 다 받은 뒤 시작 — 시작 화면에 진행률
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
  // ?review=sfx — 효과음 후보 고르기 화면을 아래에 붙임
  const review = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(location.search).get("review") === "sfx",
    () => false
  );
  const toggleLike = async (r: HangulRanking) => {
    if (liking) return;
    const on = !liked.has(r.id);
    setLiking(r.id);
    try {
      const n = await likeHangul(r.id, on);
      if (on) playSfx("like");
      setLiked((s) => {
        const t = new Set(s);
        if (on) t.add(r.id);
        else t.delete(r.id);
        return t;
      });
      setRanks((rs) => rs?.map((x) => (x.id === r.id ? { ...x, likes: n } : x)) ?? rs);
    } catch (e) {
      setRankMsg(
        e instanceof ApiError && e.code === "OWN_RECORD"
          ? "내 문장에는 누를 수 없어요"
          : "누르지 못했어요"
      );
      setTimeout(() => setRankMsg(null), 2000);
    } finally {
      setLiking(null);
    }
  };
  const share = async (c: Parameters<typeof shareCard>[0]) => {
    if (sharing) return;
    setSharing(true);
    try {
      playSfx("card");
      await shareCard(c);
    } catch {
      /* 공유 취소 · 실패는 조용히 */
    } finally {
      setSharing(false);
    }
  };
  const openRanks = (sort: HangulSort = rankSort) => {
    playSfx(rankOpen ? "click" : "open");
    setRankSort(sort);
    setRanks(null);
    setRankOpen(true);
    loadRanks(sort);
  };
  useEffect(() => {
    if (!rankOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setRankOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rankOpen]);

  // 판 크기 → 캔버스 · 둘레 길
  useEffect(() => {
    const field = fieldRef.current,
      cv = canvasRef.current;
    if (!field || !cv) return;
    const fit = () => {
      const r = field.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      setPath(g, { x: 16, y: 16, w: r.width - 32, h: r.height - 32 });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(field);
    return () => ro.disconnect();
  }, [g]);

  // 칸 위치 (쏘는 선의 출발점) — 화면이 다시 그려질 때마다
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const base = field.getBoundingClientRect();
    const m = posRef.current;
    m.clear();
    field.querySelectorAll<HTMLElement>("[data-uid]").forEach((el) => {
      const r = el.getBoundingClientRect();
      m.set(Number(el.dataset.uid), {
        x: r.left - base.left + r.width / 2,
        y: r.top - base.top + r.height / 2,
      });
    });
  });

  // 진행 · 그리기
  useEffect(() => {
    // 개발 중 점검용 (콘솔에서 판 상태 보기)
    if (process.env.NODE_ENV !== "production") {
      const w = window as unknown as { __hangul?: Game; __hangulLine?: (t: string) => void };
      w.__hangul = g;
      // 개발 점검용: 원고지에 아무 줄이나 바로 써 넣기 (대전 받아치기 확인 등)
      w.__hangulLine = (t: string) => {
        g.line = [...t].map((ch) => ({
          id: g.seq++,
          kind: /[,.?!]/.test(ch) ? ("p" as const) : ("s" as const),
          text: ch,
          cd: 0,
        }));
        refresh();
      };
    }
    let raf = 0,
      last = performance.now(),
      ui = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const v = vsRef.current;
      // 대전: 카운트다운 동안은 멈춤
      const vsHold = !!v?.room && v.room.phase === "play" && serverNow() < v.room.startAt;
      if (phaseRef.current === "play" && !pauseRef.current && !vsHold) {
        for (let k = 0; k < speedRef.current; k++) step(g, dt);
        // 대전: 도착 시각이 지난 상대 공격 → 내 판에 먹물 (막혔으면 서버가 상태를 바꿔 둬서 안 들어옴)
        if (v?.room && g.vs) {
          const t = serverNow();
          for (const a of v.room.attacks)
            if (
              a.to === v.me &&
              a.status === "flying" &&
              a.arriveAt <= t &&
              !landedRef.current.has(a.id)
            ) {
              landedRef.current.add(a.id);
              incoming(g, a.blobs, a.heavy ? 1 : 0);
              setCutin(a);
              window.setTimeout(() => setCutin((c) => (c === a ? null : c)), 2200);
            }
        }
        if (g.over) {
          setPhase("over");
          if (v && g.vs) void loadVs(v.id, load(g)).catch(() => {});
        }
      }
      // 게임이 낸 소리 (판 진행 · 버튼으로 바꾼 것 모두 여기서 한 번에)
      if (g.sfx.length) {
        playAll(g.sfx);
        g.sfx.length = 0;
      }
      const cv = canvasRef.current;
      const cx = cv?.getContext("2d");
      if (cv && cx) {
        const dpr = window.devicePixelRatio || 1;
        cx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawField(cx, g, cv.width / dpr, cv.height / dpr, posRef.current);
      }
      if ((ui += dt) > 0.1) {
        ui = 0;
        refresh();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [g, refresh]);

  // 문장칸이 바뀌면 서버에 읽어 달라고 함
  const text = lineText(g);
  useEffect(() => {
    if (!text) return;
    let alive = true;
    judgeLine(text)
      .then((j) => alive && (setJudge(j), setJudgeErr(null)))
      .catch((e) => {
        if (!alive) return;
        setJudge(null);
        setJudgeErr(
          e instanceof ApiError && e.code === "JUDGE_OFF"
            ? "판정 서버에 모델이 없어요 (server 에서 npm run kiwi:model)"
            : "판정 서버에 연결할 수 없어요"
        );
      });
    return () => {
      alive = false;
    };
  }, [text]);
  const j = judge && judge.text === text ? judge : null;

  // ── 대전 ──
  const vsName = () => {
    try {
      return (localStorage.getItem(NAME_KEY) ?? "").slice(0, 10);
    } catch {
      return "";
    }
  };
  const setVsUrl = (id: string | null) => {
    const u = new URL(location.href);
    if (id) u.searchParams.set("vs", id);
    else u.searchParams.delete("vs");
    history.replaceState(history.state, "", u);
  };
  const enterVs = (id: string) => {
    const me = auth.currentUser?.uid;
    if (!me) throw new Error("로그인이 안 됐어요");
    landedRef.current.clear();
    vsSeedRef.current = 0;
    setVs({ id, me });
    setVsUrl(id);
  };
  const vsFail = (e: unknown) =>
    setVsErr(
      e instanceof ApiError
        ? e.code === "JUDGE_OFF"
          ? "판정 서버가 아직 준비되지 않았어요"
          : e.message
        : "서버에 연결할 수 없어요"
    );
  const vsFriend = async () => {
    setVsBusy(true);
    setVsErr(null);
    try {
      await signIn();
      enterVs(await createVs(vsName()));
    } catch (e) {
      vsFail(e);
    } finally {
      setVsBusy(false);
    }
  };
  const vsBot = async (level: number) => {
    setVsBusy(true);
    setVsErr(null);
    try {
      await signIn();
      const id = await createVs(vsName());
      await botVs(id, level);
      enterVs(id);
      await startVs(id);
    } catch (e) {
      vsFail(e);
    } finally {
      setVsBusy(false);
    }
  };
  const vsLeave = () => {
    if (vs) void leaveVs(vs.id);
    setVs(null);
    setVsRoom(null);
    setVsLobby(false);
    setVsUrl(null);
    setCutin(null);
    setG(newGame());
    setPhase("ready");
  };
  // 초대 링크(?vs=방)로 들어옴 → 바로 그 방에 앉음
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("vs");
    if (!id) return;
    void (async () => {
      await Promise.resolve();
      setVsLobby(true);
      setVsBusy(true);
      try {
        await signIn();
        await joinVs(id, vsName());
        enterVs(id);
      } catch (e) {
        vsFail(e);
        setVsUrl(null);
      } finally {
        setVsBusy(false);
      }
    })();
    // 처음 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 방 구독 — 방 상태가 바뀌면 판 시작 · 끝 · 대기실로
  useEffect(() => {
    if (!vs) return;
    const onRoom = (r: VsRoom | null) => {
      setVsRoom(r);
      if (!r) return setVsErr("방이 사라졌어요");
      if (r.phase === "play" && r.seed !== vsSeedRef.current) {
        vsSeedRef.current = r.seed;
        landedRef.current.clear();
        const ng = newGame();
        ng.vs = true;
        ng.rng = seeded(r.seed);
        draw(ng, START_DRAW);
        setG(ng);
        setSel(null);
        setSelling(false);
        setJudge(null);
        setSpeed(1);
        setPhase("play");
        playSfx("switch");
        window.setTimeout(() => playSfx("start"), 120);
      } else if (r.phase === "ended") setPhase("over");
      else if (r.phase === "waiting") {
        // 끝난 판에서 대기실로 돌아오면 판도 새로 (뒤에 지난 판이 비치지 않게)
        if (vsSeedRef.current) setG(newGame());
        vsSeedRef.current = 0;
        setPhase("ready");
      }
    };
    return watchVs(vs.id, {
      room: onRoom,
      emote: (uid, e) => setEmotes((l) => [...l.slice(-6), { uid, e, at: Date.now() }]),
    });
  }, [vs]);
  // 내 먹물 양을 상대에게 (바뀌었을 때만, 0.7초마다)
  useEffect(() => {
    if (!vs || phase !== "play") return;
    let sent = -1;
    const t = window.setInterval(() => {
      const ld = load(g);
      if (ld !== sent) {
        sent = ld;
        void loadVs(vs.id, ld).catch(() => {});
      }
    }, 700);
    return () => window.clearInterval(t);
  }, [vs, phase, g]);
  const vsNow = serverNow();
  const vsWait = !!vsRoom && vsRoom.phase === "play" && vsNow < vsRoom.startAt;
  const ctr =
    vs && vsRoom && j?.sentence ? counterTarget(vsRoom, vs.me, j.morphs, vsNow, linkMorphs) : null;
  /** 대전 문장 완성: 1인 모드처럼 내 판 공격 + 서버가 상대에게 보냄 (막기 · 보내기 고르기는 너무 어렵다 해서 뺌) */
  const onVsFinish = () => {
    if (!j || !vs) return;
    const line = j.text;
    const s = finishSentence(g, j);
    if (!s) return;
    setFlash(s);
    window.setTimeout(() => setFlash((f) => (f === s ? null : f)), 2200);
    playSfx(ctr ? "sent-best" : "link");
    sentenceVs(vs.id, line).catch((e) =>
      say(g, e instanceof ApiError ? `서버가 안 받았어요: ${e.message}` : "서버에 못 보냈어요")
    );
    refresh();
  };
  const incomingList =
    vs && vsRoom
      ? vsRoom.attacks
          .filter((a) => a.to === vs.me && a.status === "flying" && a.arriveAt > vsNow)
          .sort((a, b) => a.arriveAt - b.arriveAt)
      : [];
  const oppName = (uid: string) => vsRoom?.players.find((p) => p.uid === uid)?.name ?? "상대";

  const start = () => {
    const ng = newGame();
    // 처음엔 자모 한 줌을 쥐고 시작 (newGame 안에서 하면 서버 렌더와 무작위가 어긋나서 여기서)
    draw(ng, START_DRAW);
    setG(ng);
    setSel(null);
    setSelling(false);
    setJudge(null);
    setSent("idle");
    setPhase("play");
    beginHangul();
    // 훈장님 회초리 "딱!" + 꽹과리 — 시작
    playSfx("switch");
    window.setTimeout(() => playSfx("start"), 120);
  };

  const onSlot = (z: Zone, i: number) => {
    if (phase !== "play") return;
    const u = g.zones[z][i];
    if (selling) {
      if (u) discard(g, z, i);
      return refresh();
    }
    if (sel) {
      // 같은 칸을 또 누르면: 쌓인 것끼리 합치기(ㄱ×2 → ㄲ, ㆍ×2 → ㆍㆍ), 안 되면 선택 취소
      if (sel.z === z && sel.i === i) {
        if (combine(g, z, i, z, i)) refresh();
        return setSel(null);
      }
      if (combine(g, sel.z, sel.i, z, i)) {
        setSel(null);
        return refresh();
      }
      if (u?.kind === "j") playSfx("select");
      setSel(u?.kind === "j" ? { z, i } : null);
      return refresh();
    }
    if (!u) return;
    if (u.kind === "j") return (playSfx("select"), setSel({ z, i }));
    toLine(g, z, i);
    refresh();
  };

  const onBind = () => {
    if (j && bindWord(g, j)) refresh();
  };
  const onFinish = () => {
    if (!j) return;
    const s = finishSentence(g, j);
    if (!s) return;
    setFlash(s);
    window.setTimeout(() => setFlash((f) => (f === s ? null : f)), 2600);
    refresh();
  };
  const askSuggest = async () => {
    const ps = pieces(g);
    if (!ps.length) return;
    const line = text;
    setSugBusy(true);
    try {
      const list = await suggestLine(
        line,
        ps.map((u) => u.text)
      );
      setSugs({ line, list: list.map((s) => ({ ...s, ids: s.add.map((i) => ps[i].id) })) });
    } catch {
      setSugs({ line, list: [] });
    } finally {
      setSugBusy(false);
    }
  };
  /**
   * 낱말 짝짓기(무지성): 글자칸 글자들로 서버 '뭐 되지?'를 돌려 낱말이 되는 걸 찾아 바로 단어칸으로 — 더 안 나올 때까지
   * 고유명사(루드 · 오드 같은 것)는 건너뜀
   */
  const autoWord = async () => {
    setWordBusy(true);
    let made = 0;
    try {
      for (let round = 0; round < 8; round++) {
        const syl = g.zones.s.filter((u): u is NonNullable<typeof u> => !!u);
        if (syl.length < 2 || !g.zones.w.includes(null)) break;
        const list = await suggestLine(
          "",
          syl.map((u) => u.text)
        );
        const pick = list.find((s) => !s.sentence && s.word && !s.rare);
        if (
          !pick?.word ||
          !makeWord(
            g,
            pick.add.map((i) => syl[i].id),
            pick.text,
            pick.word
          )
        )
          break;
        made++;
        refresh();
      }
    } catch {
      // 판정 서버가 없으면 아래 안내로
    } finally {
      setWordBusy(false);
    }
    say(
      g,
      made
        ? `낱말 ${made}개를 만들었어요`
        : !g.zones.w.includes(null)
          ? "단어칸이 꽉 찼어요"
          : "글자칸 글자로 만들 낱말이 안 보여요"
    );
    refresh();
  };
  const applySug = (ids: number[]) => {
    addByIds(g, ids);
    setSugs(null);
    refresh();
  };
  const popLine = (k?: number) => {
    fromLine(g, k ?? g.line.length - 1);
    refresh();
  };
  const clearLine = () => {
    for (let k = g.line.length - 1; k >= 0; k--) fromLine(g, k);
    refresh();
  };

  const submit = async () => {
    const b = best(g);
    const nm = name.trim() || "익명";
    setSent("sending");
    try {
      if (!secret) localStorage.setItem(NAME_KEY, nm);
      localStorage.setItem(SECRET_KEY, secret ? "1" : "0");
    } catch {}
    try {
      await submitHangul({
        name: secret ? "익명" : nm,
        score: score(g),
        wave: g.wave,
        best: b?.text ?? "",
        bestPts: b?.points ?? 0,
        secret,
      });
      setSent("done");
    } catch {
      setSent("fail");
    }
  };

  const ld = load(g);
  const cells = lineCells(g);
  const lk = links(g);
  const selU = sel ? g.zones[sel.z][sel.i] : null;
  const note =
    g.note && g.t - g.note.at < 2.5
      ? g.note.text
      : selU?.kind === "j"
        ? `「${shown(selU.text)}」 골랐어요 — 다음에 누르는 자모 · 글자와 누른 순서대로 합쳐요${(selU.n ?? 1) > 1 ? " (같은 칸을 또 누르면 둘끼리)" : ""}`
        : null;
  const unknown = j?.morphs.filter((m) => !m.k) ?? [];
  const endsLikeSentence = !!j && j.morphs.length >= 2 && j.morphs[j.morphs.length - 1].t === "EF";
  // "이거 말 되는데?" — 사전에 없는 말이 있거나 외계어로 판정됐을 때만
  const canReport = !!j && !j.sentence && (unknown.length > 0 || (endsLikeSentence && !j.word));
  const report = () => {
    if (!j || reported.has(j.text)) return;
    setReported((s) => new Set(s).add(j.text));
    reportHangul(j.text).catch(() => {});
  };
  const lineMsg = !text
    ? "글자칸 · 단어칸의 글자를 누르면 여기 이어 붙어요"
    : judgeErr
      ? judgeErr
      : !j
        ? "읽는 중…"
        : j.sentence
          ? `문장이 됐어요! [${gradeName(j)}] 「${withEnd(j.spaced || j.text)}」 완성하면 +${fmt(j.points)}점${j.rude ? " (말끝을 맺으면 점수 더)" : ""}`
          : unknown.length
            ? `「${unknown.map((m) => m.f).join(", ")}」 — 사전에 없는 말이에요`
            : endsLikeSentence && !j.word
              ? `외계어예요 (말맛 ${j.nat}) — 사람이 쓰는 말처럼 이어 보세요`
              : j.word
                ? `낱말 「${j.text}」(${j.word}) — 묶으면 단어칸에서 ${POS_STYLE[j.word]?.desc ?? "싸워요"}`
                : "아직 문장이 아니에요 — ~다 · ~요 · ~임 으로 끝을 맺거나, ~님 · ~야 로 불러 보세요";
  const bestNow = best(g);
  // 훈장님 표정 · 한마디: 방금 완성한 문장(번쩍임) > 지금 줄 판정 > 기본
  const face: ImgName = flash
    ? (GRADE_FACE[flash.grade] ?? "hunjangNod")
    : !text || !j
      ? "hunjang"
      : j.sentence
        ? (GRADE_FACE[gradeName(j)] ?? "hunjangNod")
        : unknown.length || (endsLikeSentence && !j.word)
          ? "hunjangAngry"
          : "hunjang";
  const rudeNow = flash ? flash.grade === "막말" : !!j?.sentence && !!j.rude;
  const teacher = { face, say: lineOf(rudeNow ? RUDE_SAY : TEACHER[face], flash?.text ?? text) };

  const slot = (z: Zone, i: number) => {
    const u = g.zones[z][i];
    const on = sel?.z === z && sel.i === i;
    const st = u ? statsOf(g, u) : null;
    const len = u ? [...u.text].length : 0;
    // 자음칸 · 모음칸의 고정 자리는 비어 있어도 그 자리 글자를 흐리게 보여 줌 (자판처럼)
    const ph = z === "c" ? CONS_SLOTS[i] : z === "v" ? VOWEL_SLOTS[i] : undefined;
    return (
      <button
        key={i}
        type="button"
        className={`hg-slot hg-${z}${u ? "" : " is-empty"}${on ? " is-on" : ""}${selling && u ? " is-sell" : ""}`}
        data-uid={u?.id}
        onClick={() => onSlot(z, i)}
        aria-label={u ? u.text : "빈 칸"}
        style={st && "color" in st && u?.kind === "w" ? { color: st.color } : undefined}
      >
        {!u && ph && (
          <span className={`hg-glyph is-ph${shown(ph) !== ph ? " is-dot" : ""}`}>{shown(ph)}</span>
        )}
        {u && (
          <>
            <span
              className={`hg-glyph${u.kind === "j" && shown(u.text) !== u.text ? " is-dot" : ""}`}
              style={len > 2 ? { fontSize: `${Math.max(11, 26 - len * 3.2)}px` } : undefined}
            >
              {u.kind === "j" ? shown(u.text) : u.text}
            </span>
            {u.kind === "w" && <span className="hg-pos">{u.pos}</span>}
            {u.kind === "j" && (u.n ?? 1) > 1 && (
              <span
                className={`hg-n${(u.n ?? 1) >= (z === "c" ? STACK_C : STACK_V) ? " is-full" : ""}`}
              >
                ×{u.n}
              </span>
            )}
          </>
        )}
      </button>
    );
  };
  const zone = (z: Zone, title: string, cls = "") => (
    <section className={`hg-zone ${cls}`}>
      <h3>
        {title}
        {/* 자모마다 상한 — 그 자모가 차면 그 자모만 안 들어옴 (쓰면 다시). 다 찬 칸은 빨간 숫자 */}
        {(z === "c" || z === "v") && (
          <small className="hg-hold">같은 자모 ×{z === "c" ? STACK_C : STACK_V}까지</small>
        )}
      </h3>
      <div className={`hg-grid hg-grid-${z}`}>
        {Array.from({ length: CAP[z] }, (_, i) => slot(z, i))}
      </div>
    </section>
  );

  return (
    <>
      {/* 사이트 공통 게임 머리말 (가이드) + 이 게임 랭킹 창 · 소리 버튼 — 랭킹은 문장이 주인공이라 자체 창.
          hg-root 밖에 둬야 사이트 글자색(흰색)을 그대로 씀 */}
      <div className="mx-auto w-full max-w-[1180px]">
        <GameHeader
          icon="px:hangul"
          title="니들이 한글을 알아?"
          en="Korean Word Defense"
          accent="#E0533F"
          desc="자모로 아무 문장이나 지어서 먹물 괴물을 막는 한글 문장 디펜스"
          tags={["한글 게임", "문장 만들기", "형태소 분석", "웹 디펜스"]}
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
        {vs && vsRoom && vsRoom.phase !== "waiting" ? (
          <>
            <VsBar
              room={vsRoom}
              me={vs.me}
              myLoad={ld}
              left={vsRoom.phase === "play" ? Math.min(vsRoom.endAt - vsNow, 180_000) : 0}
              emotes={emotes}
              onEmote={(e) => void emoteVs(vs.id, e).catch(() => {})}
            />
            <VsFeed room={vsRoom} me={vs.me} incoming={incomingList} now={vsNow} />
          </>
        ) : (
          <div className="hg-hud">
            <div>
              <span>웨이브</span>
              <b>{g.wave}</b>
            </div>
            <div className={ld >= LOAD_MAX * 0.7 ? "is-warn" : ""}>
              <span>먹물</span>
              <b>
                {ld}/{LOAD_MAX}
              </b>
            </div>
            <div>
              <span>점수</span>
              <b>{fmt(score(g))}</b>
            </div>
            <div>
              <span>기세</span>
              <b>×{g.power.toFixed(2)}</b>
            </div>
          </div>
        )}

        <div className="hg-field" ref={fieldRef}>
          <canvas ref={canvasRef} className="hg-canvas" aria-hidden />
          <div className="hg-panel">
            <section className="hg-line">
              <div className="hg-linehead">
                <h3>
                  원고지{" "}
                  <small>
                    {hangulLen(text)}/{LINE_MAX}
                  </small>
                </h3>
                {/* 훈장님: 지금 쓰는 줄을 보고 반응 */}
                <div className={`hg-teacher is-${teacher.face}`} key={teacher.face}>
                  <p>{teacher.say}</p>
                  <img src={IMG[teacher.face]} alt="" draggable={false} />
                </div>
              </div>
              <div className="hg-paper" role="list">
                {Array.from(
                  { length: Math.max(LINE_MAX, Math.ceil(cells.length / 15) * 15) },
                  (_, k) => {
                    const c = cells[k];
                    return (
                      <button
                        key={k}
                        type="button"
                        role="listitem"
                        className={`hg-cell${c ? (c.k % 2 ? " is-b" : " is-a") : ""}`}
                        onClick={() => c && popLine(c.k)}
                        disabled={!c}
                      >
                        {c?.ch}
                      </button>
                    );
                  }
                )}
              </div>
              <div className="hg-morphs">
                {j?.morphs.map((m, k) => (
                  <span key={k} className={m.k ? "" : "is-unk"}>
                    {m.f}
                    <small>{tagName(m)}</small>
                  </span>
                ))}
              </div>
              <p className={`hg-msg${j?.sentence ? " is-ok" : ""}`}>
                {lineMsg}
                {canReport && (
                  <button
                    type="button"
                    className="hg-report"
                    onClick={report}
                    disabled={reported.has(j.text)}
                  >
                    {reported.has(j.text)
                      ? "신고했어요 ✓ 사전에 넣어 볼게요"
                      : "🙋 이거 말 되는데?"}
                  </button>
                )}
              </p>
              <div className="hg-sugs">
                <button
                  type="button"
                  className="hg-ask"
                  onClick={askSuggest}
                  disabled={sugBusy || phase !== "play" || !pieces(g).length}
                >
                  {sugBusy ? "찾는 중…" : text ? "뒤에 뭐 붙이지?" : "뭐 되지?"}
                </button>
                {sugs &&
                  sugs.line === text &&
                  (sugs.list.length ? (
                    sugs.list.map((s) => (
                      <button
                        key={s.text}
                        type="button"
                        className={s.sentence ? "is-sent" : ""}
                        onClick={() => applySug(s.ids)}
                      >
                        {s.text}
                        <small>{s.sentence ? `문장 +${fmt(s.points)}` : s.word}</small>
                      </button>
                    ))
                  ) : (
                    <span className="hg-dim">
                      가진 글자로는 안 보여요 — 자모가 더 들어오면 다시 눌러 보세요
                    </span>
                  ))}
              </div>
              <div className="hg-punct">
                <span>부호</span>
                {PUNCTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => (addPunct(g, p), refresh())}
                    disabled={!g.line.length || phase !== "play"}
                  >
                    {p}
                  </button>
                ))}
                <small>띄어쓰기는 완성할 때 알아서</small>
              </div>
              <div className="hg-line-btns">
                <button type="button" onClick={() => popLine()} disabled={!g.line.length}>
                  하나 빼기
                </button>
                <button type="button" onClick={clearLine} disabled={!g.line.length}>
                  비우기
                </button>
                <button type="button" onClick={onBind} disabled={!j?.word || phase !== "play"}>
                  낱말로 묶기
                </button>
                {vsOn ? (
                  // 대전: 문장 완성 = 내 판 공격 + 상대에게 공격 (날아오는 문장과 이어지면 받아치기)
                  <button
                    type="button"
                    className={`hg-go${ctr ? " is-counter" : ""}`}
                    onClick={onVsFinish}
                    disabled={!j?.sentence || phase !== "play" || vsWait}
                  >
                    {ctr ? "↩️ 받아치기!" : "⚔️ 문장 공격!"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="hg-go"
                    onClick={onFinish}
                    disabled={!j?.sentence || phase !== "play"}
                  >
                    문장 완성!
                  </button>
                )}
              </div>
              {/* 문장칸 = 글: 완성한 문장이 끝없이 쌓이고(스크롤) 순서를 바꿀 수 있음. 글 전체가 READ_SEC 초마다 낭독 */}
              <div className="hg-shelf" data-uid={SHELF_ID}>
                <h3>
                  문장칸 · 글{" "}
                  <small>
                    {g.shelf.length}문장 · 낭독 {fmt(writingPower(g) * g.power)} · 이음 +
                    {fmt(linkBonus(g))}점
                  </small>
                </h3>
                <i
                  className="hg-sbar"
                  style={{
                    transform: `scaleX(${g.shelf.length ? 1 - Math.max(0, Math.min(1, g.readCd)) : 0})`,
                  }}
                />
                <div className="hg-shelf-list" ref={shelfRef}>
                  {!g.shelf.length && (
                    <p className="hg-dim">
                      완성한 문장이 여기 차례로 쌓여 한 편의 글이 돼요. 앞뒤가 이어지면 이음 점수!
                    </p>
                  )}
                  {g.shelf.map((u, k) => (
                    <div key={u.id}>
                      {k > 0 && (
                        <p className={`hg-link l${lk[k - 1].level}`}>
                          <span>
                            {lk[k - 1].level === 2 ? "●●" : lk[k - 1].level === 1 ? "●○" : "○○"}
                          </span>
                          {lk[k - 1].why.length ? lk[k - 1].why.join(" · ") : "안 이어짐"}
                        </p>
                      )}
                      <div className="hg-sent">
                        <span className={`hg-sgrade g-${(u.grade ?? "").replace(" ", "")}`}>
                          {u.grade}
                        </span>
                        <span className="hg-stext">{u.spaced ?? withEnd(u.text)}</span>
                        <b>{fmt(u.points ?? 0)}</b>
                        <span className="hg-sact">
                          <button
                            type="button"
                            onClick={() => (moveSentence(g, k, -1), refresh())}
                            disabled={k === 0}
                            aria-label="위로"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            onClick={() => (moveSentence(g, k, 1), refresh())}
                            disabled={k === g.shelf.length - 1}
                            aria-label="아래로"
                          >
                            ▼
                          </button>
                          <button
                            type="button"
                            onClick={() => (dropSentence(g, k), refresh())}
                            aria-label="글에서 빼기"
                          >
                            ✕
                          </button>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
            <div className="hg-right">
              {zone("w", "단어칸")}
              {zone("s", "글자칸")}
              <div className="hg-jamo">
                {zone("c", "자음칸")}
                {zone("v", "모음칸 · 천지인")}
              </div>
            </div>
          </div>

          {flash && (
            <div className="hg-flash" aria-live="polite">
              <span className={`hg-grade g-${flash.grade.replace(" ", "")}`}>{flash.grade}</span>
              <p>{flash.spaced}</p>
              <b>+{fmt(flash.points)}</b>
            </div>
          )}

          {/* 대전: 날아오는 공격 · 도착한 공격 컷인 · 시작 카운트다운 */}
          {vsOn && cutin && <VsCutin a={cutin} name={oppName(cutin.from)} />}
          {vsWait && vsRoom && (
            <div className="hg-vscount" aria-live="assertive">
              <b>{Math.max(1, Math.ceil((vsRoom.startAt - vsNow) / 1000))}</b>
              <small>같은 자모로 시작! 문장을 완성해서 막거나 보내요</small>
            </div>
          )}

          {/* 메인 화면: 제목 · 훈장님 · 모드 고르기 (1인 / 대전) */}
          {phase === "ready" && (
            <div className="hg-over">
              {vs && vsRoom?.phase === "waiting" ? (
                <VsWaiting
                  room={vsRoom}
                  me={vs.me}
                  onStart={() => void startVs(vs.id).catch(vsFail)}
                  onBot={(lv) => void botVs(vs.id, lv).catch(vsFail)}
                  onLeave={vsLeave}
                />
              ) : vsLobby || (vs && !vsRoom) ? (
                <VsLobby
                  busy={vsBusy || !ready}
                  err={vsErr}
                  onFriend={vsFriend}
                  onBot={vsBot}
                  onBack={() => {
                    playSfx("click");
                    setVsErr(null);
                    if (vs) vsLeave();
                    else setVsLobby(false);
                  }}
                />
              ) : (
                <div className="hg-title">
                  <div className="hg-title-art" aria-hidden>
                    {INK.map((src, i) => (
                      <img
                        key={i}
                        className={`hg-title-ink i${i}`}
                        src={src}
                        alt=""
                        draggable={false}
                      />
                    ))}
                    <img className="hg-title-teacher" src={IMG.hunjang} alt="" draggable={false} />
                  </div>
                  <h2 className="hg-logo">
                    니들이 <em>한글</em>을 알아?
                  </h2>
                  <p className="hg-title-sub">
                    자모로 <b>아무 문장</b>이나 지어서 먹물 괴물을 막아라
                  </p>
                  {ready ? (
                    <div className="hg-modes">
                      <button type="button" className="hg-mode is-solo" onClick={start}>
                        <i aria-hidden>📜</i>
                        <b>1인 모드</b>
                        <small>혼자 먹물 막기 · 점수 랭킹</small>
                      </button>
                      <button
                        type="button"
                        className="hg-mode is-vs"
                        onClick={() => (playSfx("click"), setVsLobby(true))}
                      >
                        <i aria-hidden>⚔️</i>
                        <b>대전 모드</b>
                        <small>1:1 말싸움 · 문장으로 막고 보내고 받아치기</small>
                      </button>
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
                    「~다 · ~요 · ~임」으로 끝나면 문장 완성 · 길수록 점수가 확 커져요 · 먹물 얼룩{" "}
                    {LOAD_MAX}마리면 끝
                  </p>
                </div>
              )}
            </div>
          )}
          {/* 대전 중에 방이 사라짐 (서버 재시작 · 오래 비움) */}
          {vs && !vsRoom && phase !== "ready" && (
            <div className="hg-over">
              <div className="hg-card">
                <img className="hg-cardteacher" src={IMG.hunjangHmm} alt="" draggable={false} />
                <h2>방이 사라졌어요</h2>
                <p className="hg-dim">서버가 다시 켜졌거나 연결이 오래 끊겼어요</p>
                <button type="button" className="hg-go" onClick={vsLeave}>
                  처음 화면으로
                </button>
              </div>
            </div>
          )}
          {phase === "over" && vs && vsRoom && (
            <div className="hg-over">
              <VsResult
                room={vsRoom}
                me={vs.me}
                sharing={sharing}
                onVote={(m) =>
                  void voteVs(vs.id, m)
                    .then(() => playSfx("like"))
                    .catch(vsFail)
                }
                onAgain={() => void againVs(vs.id).catch(vsFail)}
                onLeave={vsLeave}
                onShare={(m) =>
                  share({
                    text: withEnd(m.spaced),
                    grade: m.grade,
                    line1: `말싸움 · ${vsRoom.players.map((p) => p.name).join(" vs ")}`,
                    line2: "오늘의 한 마디",
                  })
                }
              />
            </div>
          )}
          {phase === "over" && !vs && (
            <div className="hg-over">
              <div className="hg-card">
                <img
                  className="hg-cardteacher"
                  src={IMG.hunjangAngry}
                  alt="화난 훈장님"
                  draggable={false}
                />
                <h2>먹물에 덮였어요</h2>
                <p>
                  {g.wave}웨이브 · 문장 {g.sentences.length}개 · 점수 <b>{fmt(score(g))}</b>
                  <br />
                  <small>
                    (문장 점수 {fmt(g.points)} + 이음 {fmt(linkBonus(g))} + 웨이브 {g.wave} ×{" "}
                    {HANGUL_WAVE_PTS})
                  </small>
                </p>
                {bestNow ? (
                  <blockquote className="hg-best">
                    {bestNow.spaced}
                    <small>대표글 · {fmt(bestNow.points)}점</small>
                    <button
                      type="button"
                      className="hg-sharebtn"
                      disabled={sharing}
                      onClick={() =>
                        share({
                          text: withEnd(bestNow.spaced),
                          grade: bestNow.grade,
                          line1: `이 문장 ${fmt(bestNow.points)}점`,
                          line2: `${g.wave}웨이브 · 문장 ${g.sentences.length}개 · 총 ${fmt(score(g))}점`,
                        })
                      }
                    >
                      {sharing ? "만드는 중…" : "🖼 카드로 자랑하기"}
                    </button>
                  </blockquote>
                ) : (
                  <p className="hg-dim">완성한 문장이 없어요</p>
                )}
                <div className="hg-submit">
                  <input
                    value={secret ? "" : name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={10}
                    disabled={secret || sent === "done"}
                    placeholder={secret ? "🕶 익명으로 올라가요" : "이름 (로그인하면 별명)"}
                  />
                  <button
                    type="button"
                    onClick={submit}
                    disabled={sent === "sending" || sent === "done"}
                  >
                    {sent === "done" ? "등록됨" : sent === "sending" ? "등록 중…" : "랭킹 등록"}
                  </button>
                </div>
                <label className="hg-secret">
                  <input
                    type="checkbox"
                    checked={secret}
                    onChange={(e) => setSecret(e.target.checked)}
                    disabled={sent === "done"}
                  />
                  🕶 시크릿 — 이름 · 별명 없이 「익명」으로 올리기
                </label>
                {sent === "fail" && <p className="hg-dim">등록하지 못했어요</p>}
                {sent === "done" && (
                  <button type="button" className="hg-linkbtn" onClick={() => openRanks("new")}>
                    올라간 문장 보러 가기 →
                  </button>
                )}
                <div className="hg-overbtns">
                  <button
                    type="button"
                    className="hg-linkbtn"
                    onClick={() => (playSfx("click"), setG(newGame()), setPhase("ready"))}
                  >
                    ← 처음 화면
                  </button>
                  <button type="button" className="hg-go" onClick={start}>
                    다시 하기
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <p className="hg-note">{note}</p>

        <div className="hg-ctrl">
          <button
            type="button"
            onClick={() => (autoPair(g), refresh())}
            disabled={phase !== "play"}
          >
            글자 짝짓기<small>자음+모음 → 글자</small>
          </button>
          <button type="button" onClick={autoWord} disabled={phase !== "play" || wordBusy}>
            {wordBusy ? "찾는 중…" : "낱말 짝짓기"}
            <small>글자+글자 → 낱말</small>
          </button>
          <button
            type="button"
            onClick={() => (playSfx("click"), setSpeed((s) => (s === 1 ? 2 : s === 2 ? 3 : 1)))}
            disabled={vsOn}
          >
            배속<small>×{speed}</small>
          </button>
          {/* 버리기 모드: 켜면 누르는 칸을 버려요 (말 안 되는 낱말 정리용) */}
          <button
            type="button"
            className={selling ? "is-on" : undefined}
            onClick={() => (playSfx("click"), setSelling((s) => !s), setSel(null))}
            disabled={phase !== "play"}
          >
            🗑 버리기<small>{selling ? "누르는 칸 버림 · 끄기" : "꺼짐"}</small>
          </button>
        </div>

        {review && <SfxReview />}

        {/* 랭킹: 문장이 주인공 — 대표글을 크게, 누가 · 몇 점은 작게. 사이트 메뉴 버튼보다 위에 뜨게 body 로 (색 · 글꼴은 hg-root 그대로) */}
        {rankOpen &&
          createPortal(
            <div className="hg-root hg-portal">
              <div
                className="hg-rankpop"
                role="dialog"
                aria-modal="true"
                aria-label="랭킹"
                onClick={() => setRankOpen(false)}
              >
                <section className="hg-ranks" onClick={(e) => e.stopPropagation()}>
                  <header>
                    <h2>명예의 전당</h2>
                    <div className="hg-rtabs" role="tablist">
                      {(["top", "fun", "new"] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          role="tab"
                          aria-selected={rankSort === s}
                          className={rankSort === s ? "is-on" : ""}
                          onClick={() => openRanks(s)}
                        >
                          {s === "top" ? "점수순" : s === "fun" ? "😂 웃긴순" : "방금 올라온"}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="hg-rclose"
                      onClick={() => setRankOpen(false)}
                      aria-label="닫기"
                    >
                      ✕
                    </button>
                  </header>
                  {phase === "play" && (
                    <p className="hg-dim hg-rpause">보는 동안 판은 멈춰 있어요</p>
                  )}
                  {rankMsg && <p className="hg-rmsg">{rankMsg}</p>}
                  {!ranks ? (
                    <p className="hg-dim">불러오는 중…</p>
                  ) : !ranks.length ? (
                    <p className="hg-dim">
                      {rankSort === "fun"
                        ? "아직 👍 받은 문장이 없어요 — 「방금 올라온」에서 웃긴 문장에 👍 를 눌러 주세요"
                        : "아직 기록이 없어요"}
                    </p>
                  ) : (
                    <ol>
                      {ranks.map((r, k) => (
                        <li
                          key={r.id}
                          className={rankSort !== "new" && k < 3 ? `is-top t${k + 1}` : ""}
                        >
                          {rankSort !== "new" && <span className="hg-rk">{k + 1}</span>}
                          {r.best ? (
                            <blockquote className="hg-rq">
                              {withEnd(r.bestSpaced || r.best)}
                            </blockquote>
                          ) : (
                            <p className="hg-rq is-none">완성한 문장 없이 버텼어요</p>
                          )}
                          <p className="hg-rn">
                            <span>
                              {r.secret ? "🕶 익명" : r.member ? r.name : `${r.name} (손님)`}
                            </span>
                            <span>
                              <b>{fmt(r.score)}</b>점 · {r.wave}웨이브
                              {r.bestPts ? ` · 이 문장 ${fmt(r.bestPts)}점` : ""}
                            </span>
                            <span>{ago(r.createdAt)}</span>
                          </p>
                          {r.best && (
                            <p className="hg-ract">
                              <button
                                type="button"
                                className={liked.has(r.id) ? "is-on" : ""}
                                aria-pressed={liked.has(r.id)}
                                disabled={liking === r.id}
                                onClick={() => toggleLike(r)}
                              >
                                👍 웃겨요 <b>{r.likes ?? 0}</b>
                              </button>
                              <button
                                type="button"
                                disabled={sharing}
                                onClick={() =>
                                  share({
                                    text: withEnd(r.bestSpaced || r.best),
                                    line1: `이 문장 ${fmt(r.bestPts)}점`,
                                    line2: `${r.secret ? "익명" : r.name} · ${r.wave}웨이브 · 총 ${fmt(r.score)}점`,
                                  })
                                }
                              >
                                🖼 카드
                              </button>
                            </p>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </div>
            </div>,
            document.body
          )}
      </div>
    </>
  );
}
