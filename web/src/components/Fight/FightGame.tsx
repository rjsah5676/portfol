"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CHARS } from "@/lib/fight/chars";
import { MAPS } from "@/lib/fight/maps";
import { AI_LEVELS, FightAI, aiForRating, aiLevelFor } from "@/lib/fight/ai";
import {
  METER_MAX,
  ROUND_SEC,
  hpRatio,
  newMatch,
  step,
  type State,
} from "@/lib/fight/sim";
import { loadSheet } from "@/lib/fight/sprites";
import {
  sfxBell,
  sfxBlock,
  sfxDash,
  sfxLand,
  sfxHit,
  sfxJump,
  sfxKO,
  sfxProj,
  sfxSuper,
  sfxWhoosh,
  sfxJust,
  sfxCounter,
  sfxTech,
  sfxLaunch,
  sfxMeter,
  sfxRespawn,
  sfxSkill,
  sfxStatus,
  sfxIvan,
  hasSkillSfx,
  setFightVolume,
  type Element,
} from "@/lib/fight/sfx";

/** 캐릭터별 효과음 성격 */
const SFX_EL: Record<string, Element> = { kai: "wind", igna: "fire", soyoung: "whip", lily: "water", zena: "bolt", gunmo: "key", ivan: "fist" };
import { FightRenderer } from "./render";
import { FightInput } from "./input";
import HowTo from "./HowTo";
import { Banner, Combo, HUD_CSS, PlayerBottom, PlayerTop, TimerBox, WinQuote, type BannerKind } from "./Hud";
import Select, { type Setup } from "./Select";
import { scrollToGameTop } from "@/components/GameHeader";
import ResultPanel from "./Result";
import TouchControls, { loadMoveMode, saveMoveMode, type MoveMode } from "./Touch";
import { PauseMenu, SettingsBody } from "./Settings";
import { useNick } from "@/lib/AuthContext";
import { plainName } from "@/components/Nick";
import Online, { type BotCfg, type MatchCfg } from "./Online";
import { OnlineMatch } from "./onlineMatch";
import { InputLog, WatchFeed, rankBotForfeit, rankBotReport, type RoomSession, type WatchSession } from "@/realtime/fight";


const SAVE_KEY = "fight:setup";
const MENU_BGM = "/fight/bgm-menu.mp3";
const MUTE_KEY = "fight:mute";
const VOL_KEY = "fight:vol";
/** 관전: 받은 입력을 이만큼(프레임, 0.6초) 모아 두고 재생 */
const WATCH_LAG = 36;
/** 배경음악 최대 음량 (슬라이더 100%일 때) */
const BGM_MAX = 0.5;

const btn =
  "cursor-pointer rounded-full border border-white/15 px-3 py-1.5 font-mono text-xs whitespace-nowrap text-white/75 transition-colors hover:border-[#6C63FF]/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-30";

interface Hud {
  ch: [number, number];
  hp: [number, number];
  meter: [number, number];
  /** 아이덴티티 남은 대기 비율 (0 = 준비됨) */
  cd: [number, number];
  wins: [number, number];
  sec: number;
  phase: State["phase"];
  pt: number;
  round: number;
  roundWinner: number;
  winner: number;
  combo: [number, number];
  ko: boolean;
  timeUp: boolean;
}

function hudOf(s: State): Hud {
  return {
    ch: [s.p[0].ch, s.p[1].ch],
    hp: [hpRatio(s.p[0]), hpRatio(s.p[1])],
    meter: [s.p[0].meter, s.p[1].meter],
    cd: [s.p[0].cd / CHARS[s.p[0].ch].cd, s.p[1].cd / CHARS[s.p[1].ch].cd],
    wins: [s.wins[0], s.wins[1]],
    sec: Math.ceil(s.timer / 60),
    phase: s.phase,
    pt:
      s.phase === "intro"
        ? Math.min(s.pt, 70)
        : s.phase === "fight"
          ? Math.min(s.pt, 40)
          : Math.min(s.pt, s.phase === "over" ? 80 : 60),
    round: s.round,
    roundWinner: s.roundWinner,
    winner: s.winner,
    // 맞은 쪽의 연속 피격 수 = 때린 쪽 콤보
    combo: s.phase === "fight" ? [s.p[1].combo, s.p[0].combo] : [0, 0],
    ko: s.p[0].hp <= 0 || s.p[1].hp <= 0,
    timeUp: s.timer <= 0,
  };
}

const KR = "font-['Nanum_Gothic',sans-serif]";

export default function FightGame() {
  const [setup, setSetup] = useState<Setup>({ mode: "ai", c1: 0, c2: 1, level: 2, map: -1 });
  const [playing, setPlaying] = useState(false);
  // 내 이름: 회원이면 별명, 비회원이면 온라인 대전에서 적어 둔 닉네임 (없으면 빈 값 → "1P")
  const memberNick = useNick();
  const [guestNick, setGuestNick] = useState("");
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장해 둔 닉네임 읽기 (경기 시작 때마다)
      setGuestNick(localStorage.getItem("chess_nick") ?? "");
    } catch {}
  }, [playing]);
  const myName = memberNick ?? guestNick;
  const [paused, setPaused] = useState(false);
  const [hud, setHud] = useState<Hud | null>(null);
  const [muted, setMuted] = useState(false);
  /** 효과음·배경음 음량 (0~1) */
  const [vol, setVol] = useState({ sfx: 0.8, bgm: 0.7 });
  const volRef = useRef(vol);
  const [coarse, setCoarse] = useState(false);
  /** 휴대폰 이동 방식: 스틱 / 키 */
  const [moveMode, setMoveMode] = useState<MoveMode>("stick");
  /** 연습 모드: 마지막 콤보 (히트 수·피해)와 최고 피해 */
  const [prac, setPrac] = useState<{ hits: number; dmg: number; best: number }>({ hits: 0, dmg: 0, best: 0 });
  const [result, setResult] = useState<{
    win: boolean;
    seconds: number;
    hits: number;
    hp: number;
  } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [input] = useState(() => new FightInput());
  const pausedRef = useRef(false);
  const rendererRef = useRef<FightRenderer | null>(null);
  const restartRef = useRef<() => void>(() => {});
  // ── 온라인: 방 연결은 경기 화면을 오가도 유지 ──
  const [onlineOn, setOnlineOn] = useState(false);
  const [sess, setSessState] = useState<RoomSession | null>(null);
  const sessRef = useRef<RoomSession | null>(null);
  const setSess = useCallback((v: RoomSession | null) => {
    if (sessRef.current && sessRef.current !== v) sessRef.current.leave();
    sessRef.current = v;
    setSessState(v);
  }, []);
  useEffect(() => () => void sessRef.current?.leave(), []);
  // ── 관전: 지켜보는 방 ──
  const [wsess, setWsessState] = useState<WatchSession | null>(null);
  const wsessRef = useRef<WatchSession | null>(null);
  const setWsess = useCallback((v: WatchSession | null) => {
    if (wsessRef.current && wsessRef.current !== v) wsessRef.current.leave();
    wsessRef.current = v;
    setWsessState(v);
  }, []);
  useEffect(() => () => wsessRef.current?.leave(), []);
  /** 관전: 받은 입력이 모자라 기다리는 중 / 앞부분을 빨리 따라잡는 중 */
  const [watchWait, setWatchWait] = useState<"" | "buffer" | "catchup" | "stopped">("");
  const cfgRef = useRef<MatchCfg | null>(null);
  /** 랭크전 AI전 (12초 안에 사람을 못 찾아 AI와 매칭) — 경기는 여기서 돌리고 끝나면 입력 기록을 서버로 */
  const botRef = useRef<BotCfg | null>(null);
  const [botCfg, setBotCfg] = useState<BotCfg | null>(null);
  /** 그리기용 (cfgRef와 같은 값) */
  const [olCfg, setOlCfg] = useState<MatchCfg | null>(null);
  const [played] = useState(() => new Set<string>());
  /** 온라인 경기가 비정상으로 끝남 (상대가 나감·연결 끊김) */
  const [netEnd, setNetEnd] = useState("");
  const leaveMatchRef = useRef<(bye: boolean) => void>(() => {});
  const [initialRoom, setInitialRoom] = useState<string | null>(null);
  // 전체화면: 선택 화면·게임 화면이 같은 바깥 div 안에서 바뀌어서 화면이 넘어가도 전체화면 유지
  const rootRef = useRef<HTMLDivElement>(null);
  const [fsReal, setFs] = useState(false);
  /** 진짜 전체화면이 안 되는 브라우저(아이폰 사파리 등): 화면을 꽉 채우는 흉내 전체화면 */
  const [pseudoFs, setPseudoFs] = useState(false);
  const fs = fsReal || pseudoFs;
  useEffect(() => {
    const on = () => {
      const now = document.fullscreenElement === rootRef.current && !!rootRef.current;
      setFs(now);
      // 전체화면에선 Esc를 게임이 받게 (일시정지·뒤로) — 키보드 잠금이 되는 브라우저(크롬·엣지)만, 나머지는 Esc가 전체화면을 끔
      const kb = (navigator as Navigator & { keyboard?: { lock?: (k: string[]) => Promise<void>; unlock?: () => void } })
        .keyboard;
      if (now) kb?.lock?.(["Escape"]).catch(() => {});
      else kb?.unlock?.();
    };
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFs = () => {
    const el = rootRef.current;
    if (!el) return;
    if (pseudoFs) return setPseudoFs(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (typeof el.requestFullscreen === "function")
      el.requestFullscreen({ navigationUI: "hide" })
        .then(() => {
          // 휴대폰: 가로로 고정 (되는 브라우저만)
          const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
          o?.lock?.("landscape").catch(() => {});
        })
        .catch(() => setPseudoFs(true));
    else setPseudoFs(true);
  };
  const rootCls = fs
    ? `${pseudoFs ? "fixed inset-0 z-[100] " : ""}flex h-full w-full flex-col items-center justify-center bg-black [&>*:not(.fs-screen)]:hidden [&>.fs-screen]:w-[min(100vw,calc(100dvh*16/9))]`
    : "mx-auto w-full max-w-[min(960px,calc((100dvh-170px)*16/9))]";
  const fsBtn = (bottom = false) => (
    <button
      type="button"
      onClick={toggleFs}
      title={fs ? "전체화면 끝내기" : "전체화면"}
      className={`pointer-events-auto absolute ${bottom ? "bottom-[1.2cqw]" : "top-[1.2cqw]"} right-[1.2cqw] z-30 cursor-pointer rounded-[0.6cqw] bg-black/55 px-[0.9cqw] py-[0.3cqw] font-mono text-[1.6cqw] text-white/75 hover:bg-white/25`}
    >
      {fs ? "✕" : "⛶"}
    </button>
  );

  /* eslint-disable react-hooks/set-state-in-effect -- 지난 설정 복원 (마운트 1회) */
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null") as Setup | null;
      if (v && CHARS[v.c1] && CHARS[v.c2] && AI_LEVELS[v.level])
        setSetup({ ...v, rolled: undefined, map: typeof v.map === "number" && (v.map === -1 || MAPS[v.map]) ? v.map : -1 });
      const m = localStorage.getItem(MUTE_KEY) === "1";
      setMuted(m);
      const sv = JSON.parse(localStorage.getItem(VOL_KEY) ?? "null") as { sfx?: number; bgm?: number } | null;
      const vv = {
        sfx: typeof sv?.sfx === "number" ? Math.min(1, Math.max(0, sv.sfx)) : 0.8,
        bgm: typeof sv?.bgm === "number" ? Math.min(1, Math.max(0, sv.bgm)) : 0.7,
      };
      setVol(vv);
      setFightVolume(m ? 0 : vv.sfx);
    } catch {}
    setCoarse(window.matchMedia("(pointer: coarse)").matches);
    setMoveMode(loadMoveMode());
    // 초대 링크 (?room=ID) → 바로 온라인 방으로
    const room = new URLSearchParams(window.location.search).get("room");
    if (room && /^[-\w]{6,40}$/.test(room)) {
      setInitialRoom(room);
      setOnlineOn(true);
      setSetup((st) => ({ ...st, mode: "online" }));
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(setup));
    } catch {}
  }, [setup]);

  useEffect(() => {
    input.attach();
    return () => input.detach();
  }, [input]);

  useEffect(() => {
    pausedRef.current = paused;
    input.setMenu(paused);
  }, [paused, input]);

  // ── 배경음악: 맵마다 (대전 중, 맵 선택에서 그 맵에 커서가 있을 때만) ──
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const mutedRef = useRef(false);
  const wantRef = useRef<string | null>(null);
  const playBgm = useCallback((src: string | null, restart = false) => {
    wantRef.current = src;
    const cur = bgmRef.current;
    if (!src || mutedRef.current) {
      cur?.pause();
      return;
    }
    if (cur && cur.dataset.src === src) {
      // 판이 새로 시작하면 곡도 처음부터
      if (restart) cur.currentTime = 0;
      if (cur.paused) cur.play().catch(() => {});
      return;
    }
    cur?.pause();
    const a = new Audio(src);
    a.dataset.src = src;
    a.loop = true;
    a.volume = BGM_MAX * volRef.current.bgm;
    bgmRef.current = a;
    a.play().catch(() => {});
  }, []);
  const previewMap = useCallback(
    // 맵 선택에서 그 맵에 커서가 있으면 맵 곡, 그 밖의 메뉴에선 메인 곡
    (m: number | null) => playBgm(m !== null && m >= 0 ? (MAPS[m].bgm ?? MENU_BGM) : MENU_BGM),
    [playBgm]
  );
  // 브라우저는 클릭·키 입력 전엔 소리를 막으니, 첫 입력 때 다시 틀어 봄
  useEffect(() => {
    const kick = () => {
      const a = bgmRef.current;
      if (wantRef.current && !mutedRef.current && (!a || a.paused)) playBgm(wantRef.current);
    };
    window.addEventListener("pointerdown", kick);
    window.addEventListener("keydown", kick);
    return () => {
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
    };
  }, [playBgm]);
  useEffect(() => {
    mutedRef.current = muted;
    if (muted) bgmRef.current?.pause();
    else playBgm(wantRef.current);
  }, [muted, playBgm]);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") bgmRef.current?.pause();
      else playBgm(wantRef.current);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      bgmRef.current?.pause();
    };
  }, [playBgm]);
  // ── 게임 루프 ──
  useEffect(() => {
    if (!playing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = new FightRenderer(canvas);
    const ol = cfgRef.current;
    const bot = ol ? null : botRef.current;
    const watching = !!ol?.spectate;
    r.tags = watching
      ? ["1P", "2P"]
      : bot
        ? ["YOU", "2P"]
      : ol
        ? ol.seat === 0
          ? ["YOU", "2P"]
          : ["1P", "YOU"]
        : ["1P", setup.mode === "ai" ? "CPU" : setup.mode === "practice" ? "허수아비" : "2P"];
    rendererRef.current = r;
    input.configure(setup.mode === "2p");
    const pickMap = () =>
      setup.map >= 0 ? setup.map : Math.floor(Math.random() * MAPS.length);
    // 랜덤 맵: 첫 판은 선택 화면에서 섞어 뽑힌 맵, 다시하기는 새로 뽑음
    let s = ol
      ? newMatch(ol.chars, ol.map)
      : bot
        ? newMatch(bot.chars, bot.map)
      : newMatch(
          [setup.c1, setup.c2],
          setup.map < 0 && setup.rolled !== undefined && MAPS[setup.rolled] ? setup.rolled : pickMap()
        );
    const net = ol && !watching ? sessRef.current?.net : null;
    // 관전용: 내 확정 입력을 서버에 조금씩 올림 (관전자는 두 선수 입력으로 같은 경기를 다시 돌림)
    const log = ol && net && sessRef.current ? new InputLog(sessRef.current.id, ol.match, ol.seat, ol.delay) : null;
    let om = ol && net ? new OnlineMatch(s, ol.seat, net, ol.match, ol.delay, ol.maxRb, log) : null;
    if (om) s = om.state;
    // 관전: 두 선수 입력 기록을 받아 그대로 다시 돌림 (wf = 다음에 돌릴 프레임)
    const feed = watching && ol?.room ? new WatchFeed(ol.room, ol.match, ol.delay) : null;
    let wf = 0;
    let buffering = true;
    let waitSince = performance.now();
    let watchState = "";
    const setWatch = (v: "" | "buffer" | "catchup" | "stopped") => {
      if (v !== watchState) ((watchState = v), setWatchWait(v));
    };
    let netDead = ol !== null && !om && !watching;
    if (netDead) setNetEnd("상대와 연결되지 않았어요");
    leaveMatchRef.current = (bye) => {
      // 경기 중에 메뉴로 나감 = 기권 (상대가 먼저 나갔거나 연결이 끊긴 뒤엔 아님)
      if (bye && om && ol && !watching && !doneReported && !netDead) sessRef.current?.forfeit(ol.match);
      if (bye && bot && !doneReported) rankBotForfeit(bot.id);
      om?.close(bye && !doneReported);
      om = null;
      feed?.close();
    };
    playBgm(MAPS[s.map].bgm ?? MENU_BGM, true);
    // AI: AI 대전은 고른 단계(캐릭터 보정 포함), 랭크전 AI전은 상대 레이팅 그대로 (서버가 같은 씨앗으로 다시 돌려 확인)
    let ai = bot
      ? new FightAI(aiForRating(bot.botR, CHARS[bot.chars[1]].id), bot.seed)
      : new FightAI(aiLevelFor(setup.level, CHARS[setup.c2]?.id), (Date.now() & 0xffff) + 1);
    /** AI전: 프레임마다 내 입력 (경기가 끝날 때까지) */
    const botLog: number[] = [];
    // 연습 모드: 허수아비는 가만히, 둘 다 체력 무한·시간 멈춤·내 게이지 가득. 콤보 피해를 잼
    const practice = setup.mode === "practice" && !ol;
    let pracDmg = 0,
      pracHits = 0,
      pracBest = 0;
    setPrac({ hits: 0, dmg: 0, best: 0 });
    let hits = 0;
    const prevMeter = [0, 0];
    const prevChg = [0, 0];
    let lastHud = "";
    let acc = 0;
    let last = performance.now();
    let raf = 0;
    let doneReported = false;
    setResult(null);
    Promise.all([loadSheet(CHARS[s.p[0].ch].id), loadSheet(CHARS[s.p[1].ch].id)])
      .then(([a, b]) => {
        r.sheets = [a, b];
      })
      .catch(() => {});
    restartRef.current = () => {
      if (ol || bot) return;
      s = newMatch([setup.c1, setup.c2], pickMap());
      playBgm(MAPS[s.map].bgm ?? MENU_BGM, true);
      ai = new FightAI(aiLevelFor(setup.level, CHARS[setup.c2]?.id), (Date.now() & 0xffff) + 1);
      hits = 0;
      doneReported = false;
      setResult(null);
    };

    const onResize = () => r.resize();
    r.resize();
    window.addEventListener("resize", onResize);
    const onVis = () => {
      if (document.visibilityState === "hidden" && !ol && !bot) setPaused(true);
    };
    document.addEventListener("visibilitychange", onVis);
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.code === "Escape" || e.code === "KeyP") setPaused((p) => !p);
    };
    window.addEventListener("keydown", onKey);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(100, now - last);
      last = now;
      if (pausedRef.current && (!ol || watching) && !bot) {
        r.draw(s);
        return;
      }
      // 온라인 선수인데 상대와 연결이 없으면 멈춘 화면만 (관전은 연결 없이 입력 기록으로 돌림)
      if (ol && !watching && (netDead || !om)) {
        r.draw(s);
        return;
      }
      // 그림이 다 불러와질 때까지는 판을 멈춰 두고 검은 화면 (임시 그림이 잠깐 보이는 것 방지, 보통 한두 프레임)
      if (!r.ready(s)) {
        r.drawLoading();
        return;
      }
      if (feed && !doneReported && s.phase !== "over") {
        const lag = feed.ready - wf;
        if (lag > 180) {
          // 늦게 들어옴: 앞부분은 소리·효과 없이 빨리 돌려서 따라잡음.
          // 한 화면에 쓰는 시간을 6ms 로 묶어서, 오래 진행된 경기에 들어가도 화면이 멈추지 않게 함
          const until = performance.now() + 6;
          let n = lag - 30;
          while (n-- > 0 && (s.phase as State["phase"]) !== "over") {
            step(s, feed.input(wf));
            wf++;
            if ((n & 15) === 0 && performance.now() > until) break;
          }
          feed.drop(wf - 2);
          setWatch("catchup");
          r.draw(s);
          acc = 0;
          return;
        }
        // 입력이 0.25초치씩 오니까 WATCH_LAG 프레임쯤 모아 두고 재생. 선수 쪽은 서로 속도를 맞추느라 60fps보다 살짝 느리게
        // 진행되기도 해서, 같은 속도로 재생하면 모아 둔 게 조금씩 줄어 몇 초마다 멈췄음 → 모아 둔 양에 맞춰 재생 속도를
        // 0.85~1.3배로 조절해 늘 WATCH_LAG 근처를 유지 (멈추지 않게)
        if (buffering && lag >= WATCH_LAG) buffering = false;
        if (!buffering && lag < 0) ((buffering = true), (waitSince = now));
        if (buffering) {
          const rm = wsessRef.current?.room;
          const stopped = performance.now() - waitSince > 8000 && (!rm || rm.state.match !== ol!.match || rm.state.phase !== "play");
          setWatch(stopped ? "stopped" : "buffer");
          r.draw(s);
          acc = 0;
          return;
        }
        setWatch("");
        acc += dt * Math.min(0.3, Math.max(-0.15, (lag - WATCH_LAG) / 150));
      }
      acc += dt;
      let steps = 0;
      while (acc >= 1000 / 60 && steps < 4) {
        acc -= 1000 / 60;
        steps++;
        const prevSt = [s.p[0].st, s.p[1].st];
        const prevT = [s.p[0].t, s.p[1].t];
        const prevMv = [s.p[0].mv, s.p[1].mv];
        // 이번 프레임에 소리·이펙트로 낼 이벤트 (온라인은 되감기로 새로 생긴 것까지)
        let evs: State["ev"] | null = null;
        if (feed && s.phase === "over") {
          // 경기 끝: 결과는 정해졌으니 선수 입력 없이 승리 포즈·대사까지 진행 (선수가 먼저 나가 기록이 끊겨도)
          step(s, [0, 0]);
        } else if (feed) {
          if (wf > feed.ready) {
            // 받은 입력이 바닥남: 밀린 시간을 쌓아 두지 않음 (쌓아 두면 다음 묶음이 왔을 때 몰아서 빨리 감김)
            acc = 0;
            break;
          }
          step(s, feed.input(wf));
          wf++;
          if (wf % 120 === 0) feed.drop(wf - 2);
        } else if (om && s.phase === "over") {
          // 온라인 경기 끝: 결과는 이미 확정(라운드가 끝난 건 170프레임 전이라 되감길 일 없음) →
          // 상대 입력 없이 내 화면에서만 승리 포즈·대사까지 진행. 전엔 상대가 먼저 대기실로 나가면 입력이 끊겨
          // 화면이 그 자리에서 멈춰 승리 대사가 안 떴음. 상대가 아직 경기 끝까지 못 갔을 수 있으니 내 입력은 계속 보내 줌
          step(s, [0, 0]);
          om.flush();
        } else if (om) {
          // 온라인: 앞서 있으면 한 프레임 쉬고, 상대 입력이 너무 늦으면 기다림 (되감기는 세션이 알아서)
          if (om.shouldWait()) continue;
          // 일시정지 메뉴가 열려 있어도 경기는 계속 (입력만 안 보냄)
          if (!om.tick(pausedRef.current ? 0 : input.read(0))) continue;
          s = om.state;
          evs = om.events;
        } else if (bot) {
          // 랭크전 AI전: 멈추지 않음 (메뉴가 열려 있으면 내 입력은 0) — 끝난 뒤엔 승리 포즈만
          const p1 = s.phase === "over" || pausedRef.current ? 0 : input.read(0);
          if (s.phase !== "over") botLog.push(p1);
          step(s, [p1, s.phase === "over" ? 0 : ai.next(s, 1)]);
        } else {
          const p1 = input.read(0);
          const p2 = setup.mode === "2p" ? input.read(1) : practice ? 0 : ai.next(s, 1);
          const hp0 = s.p[1].hp;
          step(s, [p1, p2]);
          if (practice) {
            const d = s.p[1];
            if (d.combo > 0) {
              pracDmg += Math.max(0, hp0 - d.hp);
              pracHits = Math.max(pracHits, d.combo);
            } else if (pracHits > 0) {
              // 콤보가 끝남 → 결과 표시
              pracBest = Math.max(pracBest, pracDmg);
              setPrac({ hits: pracHits, dmg: pracDmg, best: pracBest });
              pracDmg = 0;
              pracHits = 0;
            }
            // 허수아비가 낭떠러지로 떨어지면 처음 자리(시작 위치)로 — 보통 대전처럼 떨어진 자리 위에서 다시 내려오면
            // 가만히 있는 허수아비는 또 떨어지기만 함
            if (s.ev.some((e) => e.k === "fall" && e.p === 1)) s.p[1] = newMatch([s.p[0].ch, s.p[1].ch], s.map).p[1];
            for (let k = 0; k < 2; k++) s.p[k].hp = CHARS[s.p[k].ch].hp;
            s.p[0].meter = METER_MAX;
            s.timer = ROUND_SEC * 60;
          }
        }
        // 소리
        const elOf = (p: number) => SFX_EL[CHARS[s.p[p].ch].id] ?? "wind";
        // 지금 쓰는 L·I에 캐릭터 소리 파일이 있으면 탄·돌진 합성음은 생략
        const skillFile = (p: number) => {
          const f = s.p[p];
          return (f.mv === "S" || f.mv === "X") && hasSkillSfx(CHARS[f.ch].id, f.mv === "S" ? "l" : "i", !!f.aerial);
        };
        evs ??= s.ev;
        for (const e of evs) {
          if (e.k === "hit") {
            sfxHit(e.m === "X" ? 2 : e.m === "H" || e.m === "S" || e.m === "K" ? 1 : 0, elOf(e.p));
            if (e.p === (ol?.seat ?? 0)) hits++;
          } else if (e.k === "block") sfxBlock();
          else if (e.k === "just") sfxJust();
          else if (e.k === "counter") sfxCounter();
          else if (e.k === "fall") sfxRespawn();
          else if (e.k === "throw") {
            sfxHit(1, elOf(e.p));
            if (e.p === (ol?.seat ?? 0)) hits++;
          } else if (e.k === "tech") sfxTech();
          else if (e.k === "launch") sfxLaunch();
          else if (e.k === "slam") {
            sfxHit(2, elOf(e.p));
            if (e.v === 1) sfxLand();
          }
          else if (e.k === "proj") {
            if (!skillFile(e.p)) sfxProj(elOf(e.p), s.p[e.p].mv === "X");
          } else if (e.k === "burn" || e.k === "shock" || e.k === "trap" || e.k === "pop" || e.k === "pause" || e.k === "swap") sfxStatus(e.k);
          else if (e.k === "charged") sfxIvan("max");
          else if (e.k === "crush") sfxIvan("crush");
          else if (e.k === "super") sfxSuper();
          else if (e.k === "ko") sfxKO();
          else if (e.k === "jump") sfxJump();
          else if (e.k === "land") sfxLand();
          else if (e.k === "dash") {
            if (!(e.v === 2 && skillFile(e.p))) sfxDash();
          }
          else if (e.k === "round") sfxBell(false);
          else if (e.k === "fight") sfxBell(true);
        }
        for (let i = 0; i < 2; i++) {
          const f = s.p[i];
          // 필살기 게이지가 막 찼을 때
          if (f.meter >= METER_MAX && prevMeter[i] < METER_MAX && s.phase === "fight") sfxMeter();
          prevMeter[i] = f.meter;
          if (f.st === "atk" && (prevSt[i] !== "atk" || f.t < prevT[i]) && f.mv !== "S")
            sfxWhoosh(f.mv === "H" || f.mv === "K" || f.mv === "X", SFX_EL[CHARS[f.ch].id] ?? "wind");
          // 이반 붕권: 기 모으기를 시작한 순간
          if (f.st === "atk" && f.mv === "S" && f.chg === 1 && prevChg[i] !== 1) sfxIvan("charge");
          prevChg[i] = f.st === "atk" ? f.chg : 0;
          // 아이덴티티·필살기가 실제로 나가는 순간 (발동 준비가 끝난 프레임)
          if (f.st === "atk" && (f.mv === "S" || f.mv === "X")) {
            const su = CHARS[f.ch].moves[f.mv].startup;
            const fresh = prevSt[i] !== "atk" || prevMv[i] !== f.mv || prevT[i] > f.t;
            if (f.t >= su && (fresh || prevT[i] < su)) sfxSkill(CHARS[f.ch].id, f.mv === "S" ? "l" : "i", !!f.aerial);
          }
        }
        if (process.env.NODE_ENV !== "production")
          (window as unknown as { __fight: State }).__fight = s;
        r.events(evs, s);
        r.tick(s);
        if (s.phase === "over" && !doneReported) {
          doneReported = true;
          const me = ol?.seat ?? 0;
          setResult({
            win: s.winner === me,
            seconds: Math.round(s.f / 60),
            hits,
            hp: Math.round(hpRatio(s.p[me]) * 100),
          });
          // 이긴 쪽 기준 라운드 차 · 남은 체력 (랭크전 배치 보정)
          const margin =
            s.winner === 0 || s.winner === 1 ? { rounds: Math.abs(s.wins[0] - s.wins[1]), hp: hpRatio(s.p[s.winner]) } : undefined;
          if (bot) {
            // 입력 기록을 [값, 연속 프레임 수]로 줄여 보냄 → 서버가 다시 돌려 확인 → 결과는 랭크전 상태로 옴
            const rle: [number, number][] = [];
            for (const v of botLog) {
              const t = rle[rle.length - 1];
              if (t && t[0] === v) t[1]++;
              else rle.push([v, 1]);
            }
            rankBotReport(bot.id, rle).catch(() => {});
          }
          if (ol && !watching) {
            // 내가 본 결과를 먼저 알리고(두 선수 결과가 맞으면 회원 전적에) 대기실 상태로
            sessRef.current?.reportResult(ol.match, s.winner, margin);
            sessRef.current?.endMatch(ol.match);
          }
          om?.flushLog();
        }
      }
      // 온라인: 상대가 나갔거나 연결이 끊김
      if (om && !doneReported) {
        const foeGone = sessRef.current?.room && !sessRef.current.foe;
        if (om.peerLeft || foeGone || om.lostPeer) {
          netDead = true;
          setNetEnd(om.peerLeft || foeGone ? "상대가 나갔어요 — 기권승!" : "상대와 연결이 끊겼어요");
          if (ol) sessRef.current?.endMatch(ol.match);
        } else if (om.versionMismatch || om.desync) {
          // 빌드가 다르면(한쪽만 예전 버전) 같은 입력이어도 결과가 달라 서로 다른 경기를 보게 됨 → 판을 멈춤
          netDead = true;
          setNetEnd(om.versionMismatch ? "상대와 게임 버전이 달라요 — 둘 다 새로고침해 주세요" : "경기가 서로 어긋났어요 — 새로고침하고 다시 해 주세요");
          if (ol) sessRef.current?.endMatch(ol.match);
        }
      }
      if (acc > 200) acc = 0;
      r.draw(s);
      const h = hudOf(s);
      const key = JSON.stringify(h);
      if (key !== lastHud) {
        lastHud = key;
        setHud(h);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("keydown", onKey);
      input.stop();
      rendererRef.current = null;
      leaveMatchRef.current(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 시작할 때의 설정으로 한 판
  }, [playing]);

  const start = useCallback(() => {
    cfgRef.current = null;
    setOlCfg(null);
    botRef.current = null;
    setBotCfg(null);
    setPaused(false);
    setPlaying(true);
    setTimeout(scrollToGameTop, 50);
  }, []);
  const startBot = useCallback((cfg: BotCfg) => {
    // 끝나고 돌아왔을 때 (결과 확인 중) 캐릭터 고르기 화면으로 다시 들어가지 않게
    played.add(cfg.id);
    cfgRef.current = null;
    setOlCfg(null);
    botRef.current = cfg;
    setBotCfg(cfg);
    setNetEnd("");
    setPaused(false);
    setPlaying(true);
    setTimeout(scrollToGameTop, 50);
  }, [played]);
  const startOnline = useCallback((cfg: MatchCfg) => {
    botRef.current = null;
    setBotCfg(null);
    played.add(cfg.match);
    setWatchWait("");
    cfgRef.current = cfg;
    setOlCfg(cfg);
    setNetEnd("");
    setPaused(false);
    setPlaying(true);
    setTimeout(scrollToGameTop, 50);
  }, [played]);

  const [entry, setEntry] = useState<"mode" | "char">("mode");
  const toMenu = useCallback(() => {
    // 온라인 경기에서 나오면 대기실로 (방에는 그대로) · 랭크전 AI전은 끝나기 전에 나가면 기권
    if (cfgRef.current || botRef.current) leaveMatchRef.current(true);
    cfgRef.current = null;
    setOlCfg(null);
    botRef.current = null;
    setBotCfg(null);
    setNetEnd("");
    setEntry("mode");
    playBgm(MENU_BGM, true);
    setPlaying(false);
    setPaused(false);
    setHud(null);
  }, [playBgm]);
  /** 온라인: 대기실로 (again = 바로 준비 — 방장은 빼고: 방장까지 준비돼 있으면 상대가 준비하자마자 바로 시작돼 버림) */
  const toRoom = useCallback(
    (again: boolean) => {
      toMenu();
      const sess = sessRef.current;
      if (again && sess && !sess.isHost) sess.setReady(true);
    },
    [toMenu]
  );
  const toChars = useCallback(() => {
    toMenu();
    setEntry("char");
  }, [toMenu]);
  // 음량 바뀌면 바로 반영 + 저장
  useEffect(() => {
    volRef.current = vol;
    if (!muted) setFightVolume(vol.sfx);
    if (bgmRef.current) bgmRef.current.volume = BGM_MAX * vol.bgm;
    try {
      localStorage.setItem(VOL_KEY, JSON.stringify(vol));
    } catch {}
  }, [vol, muted]);
  const toggleMute = () =>
    setMuted((m) => {
      setFightVolume(m ? volRef.current.sfx : 0);

      try {
        localStorage.setItem(MUTE_KEY, m ? "0" : "1");
      } catch {}
      return !m;
    });

  // 설정 (메인 ⚙ 설정 · 일시정지 화면 같은 내용)
  const settingsBody = (
    <SettingsBody
      vol={vol}
      onVol={setVol}
      muted={muted}
      onMute={toggleMute}
      fs={fs}
      onFs={toggleFs}
      moveMode={coarse ? moveMode : undefined}
      onMoveMode={(m) => {
        setMoveMode(m);
        saveMoveMode(m);
      }}
    />
  );

  const level = AI_LEVELS[setup.level] ?? AI_LEVELS[0];

  if (!playing) {
    return (
      <div ref={rootRef} className={rootCls}>
        {/* 전체화면 권장 (전체화면에선 .fs-screen 만 보임) */}
        <button
          type="button"
          onClick={toggleFs}
          className="mb-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#FF8A3D]/45 bg-[linear-gradient(90deg,rgba(255,138,61,0.18),rgba(224,48,106,0.18))] px-4 py-2 font-['Nanum_Gothic',sans-serif] text-[13px] text-white/85 shadow-[0_0_24px_-6px_rgba(255,138,61,0.55)] transition-colors hover:border-[#FF8A3D] hover:text-white"
        >
          <span className="shrink-0 rounded-md bg-[#FF8A3D] px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">
            ⛶
          </span>
          <b className="shrink-0 font-bold whitespace-nowrap text-white">전체화면 플레이 권장</b>
          {/* 키보드 안내는 PC 에서만, 휴대폰은 짧게 (긴 문장이 좁은 화면에서 제목까지 끊어 놓던 것) */}
          <span className="min-w-0 truncate text-white/55 [@media(pointer:coarse)]:hidden">
            — 여기를 누르면 전체화면으로 (Esc = 일시정지, 나올 땐 일시정지 메뉴나 ✕)
          </span>
          <span className="hidden whitespace-nowrap text-white/55 [@media(pointer:coarse)]:inline">— 눌러서 크게</span>
        </button>
        <div className="fs-screen relative isolate [container-type:inline-size]">
          {onlineOn ? (
            <Online
              session={sess}
              setSession={setSess}
              initialRoom={initialRoom}
              played={played}
              onMatch={startOnline}
              onBotMatch={startBot}
              watch={wsess}
              setWatch={setWsess}
              onExit={() => {
                setWsess(null);
                setSess(null);
                setInitialRoom(null);
                setOnlineOn(false);
              }}
            />
          ) : (
            <Select
              setup={setup}
              setSetup={setSetup}
              onStart={start}
              onOnline={() => setOnlineOn(true)}
              onPreview={previewMap}
              entry={entry}
              settings={settingsBody}
              onBack={() => {
                if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
              }}
            />
          )}
          {fsBtn()}
        </div>
        <HowTo mode={setup.mode} />
      </div>
    );
  }

  const ol = olCfg;
  const bot = ol ? null : botCfg;
  const watching = !!ol?.spectate;
  // 화면 위 이름: 온라인은 서로의 이름, 혼자 할 때는 내 이름(회원 별명, 비회원은 온라인에서 쓰던 닉네임이 있으면 그것)
  const names: [string, string] = watching
    ? [plainName(ol!.names[0]), plainName(ol!.names[1])]
    : ol
    ? [plainName(ol.names[0]) + (ol.seat === 0 ? " (나)" : ""), plainName(ol.names[1]) + (ol.seat === 1 ? " (나)" : "")]
    : bot
    ? [plainName(bot.names[0]) + " (나)", plainName(bot.names[1])]
    : [setup.mode === "2p" ? "1P" : myName || "1P", setup.mode === "ai" ? `CPU ${level.name}` : setup.mode === "practice" ? "허수아비" : "2P"];
  const meSeat = ol?.seat ?? 0;

  let banner: { kind: BannerKind; text: string; name?: string; nameColor?: string } | null = null;
  if (hud) {
    if (hud.phase === "intro") banner = hud.pt < 60 ? { kind: "round", text: `ROUND ${hud.round}` } : { kind: "fight", text: "FIGHT!" };
    else if (hud.phase === "fight" && hud.pt < 30) banner = { kind: "fight", text: "FIGHT!" };
    else if (hud.phase === "roundEnd") {
      const w = CHARS[hud.ch[hud.roundWinner]];
      banner =
        hud.pt < 50
          ? hud.timeUp
            ? { kind: "timeup", text: "TIME UP" }
            : { kind: "ko", text: "K.O." }
          : hud.roundWinner === 2
            ? { kind: "draw", text: "무승부" }
            : { kind: "roundWin", text: "승리", name: w.name, nameColor: w.color };
    } else if (hud.phase === "over")
      banner =
        hud.winner === 2
          ? { kind: "draw", text: "DRAW" }
          : (setup.mode === "ai" || ol || bot) && !watching
            ? hud.winner === meSeat
              ? { kind: "win", text: "YOU WIN!" }
              : { kind: "lose", text: "YOU LOSE" }
            : { kind: "win", text: `${hud.winner === 0 ? "1P" : "2P"} WIN!` };
  }

  const winCh = hud && hud.phase === "over" && hud.winner !== 2 ? CHARS[hud.ch[hud.winner]] : null;
  return (
    <div ref={rootRef} className={rootCls}>
      <div className="fs-screen relative isolate w-full overflow-hidden rounded-xl border border-white/10 bg-black [container-type:inline-size]">
        <canvas ref={canvasRef} className="block aspect-video w-full [image-rendering:pixelated]" />
        {fsBtn(true)}
        {winCh && hud && hud.pt >= 80 && <WinQuote ch={hud.ch[hud.winner]} right={hud.winner === 1} />}
        {hud && (
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between px-[1.6cqw] py-[1.4cqw]">
            <style>{HUD_CSS}</style>
            <div className="flex items-start gap-[1.4cqw]">
              <PlayerTop ch={hud.ch[0]} hp={hud.hp[0]} tag={names[0]} />
              <TimerBox sec={hud.sec} round={hud.round} wins={hud.wins} hurry={hud.sec <= 10 && hud.phase === "fight"} />
              <PlayerTop ch={hud.ch[1]} hp={hud.hp[1]} tag={names[1]} right />
            </div>
            <div className={`flex items-end justify-between ${result ? "invisible" : ""}`}>
              <PlayerBottom ch={hud.ch[0]} meter={hud.meter[0]} cd={hud.cd[0]} />
              <PlayerBottom ch={hud.ch[1]} meter={hud.meter[1]} cd={hud.cd[1]} right />
            </div>
            {hud.combo.map((c, i) => c >= 2 && <Combo key={i} n={c} right={i === 1} />)}
            {banner && <Banner {...banner} top={result ? "15%" : undefined} />}
          </div>
        )}
        {setup.mode === "practice" && !ol && hud && (
          <div className="pointer-events-none absolute top-[10.6cqw] left-1/2 z-10 flex -translate-x-1/2 items-center gap-[1cqw] rounded-full bg-black/60 px-[1.4cqw] py-[0.35cqw] font-['Nanum_Gothic',sans-serif] text-[1.15cqw] text-white/80">
            <span className="font-bold text-[#FFC86B]">연습 모드</span>
            <span>
              마지막 콤보 <b className="text-white">{prac.hits}</b>히트 · <b className="text-white">{prac.dmg}</b> 피해
            </span>
            <span className="text-white/50">최고 {prac.best}</span>
          </div>
        )}
        {watching && hud && (
          <div className="pointer-events-none absolute top-[8.6cqw] left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/55 px-[1.2cqw] py-[0.3cqw] font-['Nanum_Gothic',sans-serif] text-[1.2cqw] font-bold text-[#67E8F9]">
            👁 관전 중
            {watchWait === "buffer" ? " · 받는 중…" : watchWait === "catchup" ? " · 따라잡는 중…" : ""}
          </div>
        )}
        {watching && watchWait === "stopped" && !result && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-[1.6cqw] bg-black/60">
            <div className="font-['Nanum_Gothic',sans-serif] text-[2.4cqw] font-extrabold text-white">경기가 중단됐어요</div>
            <button
              type="button"
              onClick={toMenu}
              className="cursor-pointer rounded-full bg-[#6C63FF] px-[3cqw] py-[1cqw] font-['Nanum_Gothic',sans-serif] text-[1.8cqw] font-bold text-white"
            >
              관전 대기실로
            </button>
          </div>
        )}
        {coarse && hud && !paused && !result && !netEnd && !watching && (
          <TouchControls
            input={input}
            mode={moveMode}
            onMode={(m) => {
              setMoveMode(m);
              saveMoveMode(m);
            }}
            onPause={() => setPaused(true)}
          />
        )}
        {paused && (
          <PauseMenu
            title={(ol && !watching) || bot ? "MENU" : "PAUSED"}
            note={
              (ol && !watching) || bot
                ? `${bot ? "랭크전은" : "온라인 대전은"} 멈추지 않아요 — 메뉴가 열린 동안 내 캐릭터는 가만히 있어요`
                : undefined
            }
            actions={[
              { label: "계속하기", onClick: () => setPaused(false) },
              ...(!ol && !bot
                ? [
                    {
                      label: "다시하기",
                      onClick: () => {
                        restartRef.current();
                        setPaused(false);
                      },
                    },
                    { label: "캐릭터 선택", onClick: toChars },
                  ]
                : []),
              {
                label: watching ? "관전 대기실로" : ol ? "기권하고 대기실로" : bot ? "기권하고 나가기" : "메뉴로",
                onClick: toMenu,
                danger: (!!ol && !watching) || !!bot,
              },
            ]}
            settings={settingsBody}
          />
        )}
        {netEnd && !result && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-[1.6cqw] bg-black/60">
            <div className={`${KR} text-[3cqw] font-extrabold text-white drop-shadow-[0_0.3cqw_0_#000]`}>{netEnd}</div>
            <button
              type="button"
              onClick={() => toRoom(false)}
              className="cursor-pointer rounded-full bg-[#6C63FF] px-[3cqw] py-[1cqw] font-['Nanum_Gothic',sans-serif] text-[1.8cqw] font-bold text-white shadow-[0_0.4cqw_0_#2E2A7A] hover:bg-[#5b52f0]"
            >
              대기실로
            </button>
          </div>
        )}
        {result && (
          <ResultPanel
            side={!winCh ? "center" : hud?.winner === 1 ? "left" : "right"}
            title={
              hud?.winner === 2
                ? "무승부"
                : watching
                  ? `${names[hud?.winner ?? 0]} 승리`
                  : setup.mode === "ai" || ol || bot
                  ? result.win
                    ? "승리"
                    : "패배"
                  : `${hud?.winner === 0 ? "1P" : "2P"} 승리`
            }
            seconds={result.seconds}
            hits={watching ? undefined : result.hits}
            hp={watching ? undefined : result.hp}
            buttons={
              watching
                ? [
                    { label: "👁 다음 경기 보기", onClick: toMenu, primary: true },
                    { label: "로비로", onClick: () => (toMenu(), setWsess(null)) },
                  ]
                : bot
                ? [{ label: "레이팅 결과 보기", sub: "랭크전 · AI전", onClick: toMenu, primary: true }]
                : ol && sess?.room?.rank
                ? // 랭크전: 한 판뿐 → 대기실 화면에서 결과·레이팅 변화
                  [{ label: "레이팅 결과 보기", sub: "랭크전 · 한 판 승부", onClick: () => toRoom(false), primary: true }]
                : ol
                ? // 둘 다 같은 방 대기실로 감 — 한 판 더는 들어가면서 '준비'까지 눌러 줌. 방장은 상대가 준비하면 시작하는 쪽이라 하나만
                  sess?.isHost
                  ? [{ label: "대기실로", sub: "상대가 준비하면 시작", onClick: () => toRoom(false), primary: true }]
                  : [
                      { label: "↻ 한 판 더", sub: "바로 준비", onClick: () => toRoom(true), primary: true },
                      { label: "대기실로", sub: "준비는 나중에", onClick: () => toRoom(false) },
                    ]
                : [
                    { label: "↻ 다시하기", onClick: () => restartRef.current(), primary: true },
                    { label: "캐릭터 선택", onClick: toChars },
                  ]
            }
          />
        )}
      </div>


      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setPaused((p) => !p)} className={btn}>
          {paused ? "▶ 계속" : ol || bot ? "☰ 메뉴" : "⏸ 일시정지"}
        </button>
        <button type="button" onClick={toMenu} className={btn}>
          {ol ? "대기실로" : bot ? (result ? "나가기" : "기권하고 나가기") : "메뉴로"}
        </button>
        <button type="button" onClick={toggleFs} className={btn}>
          ⛶ 전체화면
        </button>
      </div>

      {!coarse && hud && <HowTo mode={ol || bot ? "online" : setup.mode} chars={hud.ch} />}

    </div>
  );
}
