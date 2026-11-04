"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { signInAnonymously } from "firebase/auth";
import { auth } from "@/firebase";
import GameIcon from "@/components/GameIcon";
import GameLoader from "@/components/GameLoader";
import { NAV_GROUPS } from "@/data/navMenu";
import { rpc, subscribe } from "@/lib/api/socket";
import { CHARS, charFiles } from "@/lib/gmtown/chars";
import type { ChannelList, CharId, ChatWire, HouseWire, MoveWire, PlayerWire, TownSnap } from "@/lib/gmtown/types";
import { BUILDINGS, CHAT_MAX, PLAZA, isLot, npcById, warps, type BStyle, type Building, type NpcId, type Warp } from "@/lib/gmtown/world";
import { TownEngine } from "./engine";
import MapModal from "./MapModal";
import NpcDialog from "./NpcDialog";
import HouseHud, { type HouseState } from "./HouseHud";
import { townFiles } from "./scene3d";
import { drawMiniRound } from "./townMap";

/*
 * GMTOWN 화면 — 3D 캔버스(엔진) + 이름표 캔버스 위에 HUD: 채널 · 사람 수 / 작은 지도 · 당기기 · 지도 / 채팅 / 문 앞 「들어가기」 / 건물 카드.
 * 로그인 안 했으면 게스트(익명)로 들어옴. 폰은 화면 전체(사이트 메뉴 없이), 왼쪽 아래 고정 조이스틱 · 한 손가락 끌기 = 시점 · 두 손가락 = 돌리기 · 당기기.
 * HUD 는 로아식: 왼쪽 아래 늘 떠 있는 채팅창(탭) · 오른쪽 위 원형 지도 · M = 전체 지도 창(순간이동 · 걸어서 이동).
 */

/** 시스템 줄 (채팅창 「시스템」 탭) */
type SysLine = { at: number; text: string };
type ChatTab = "all" | "talk" | "sys";
/** 지금 있는 곳 이름 (원형 지도 위): 가까운 지도 장소, 없으면 마을 */
function regionName(x: number, y: number): string {
  if (Math.hypot(x - PLAZA.x, y - PLAZA.y) < PLAZA.r + 4) return "중앙 광장";
  let best: Warp | null = null,
    bd = 16;
  for (const w of warps()) {
    const d = Math.hypot(w.x - x, w.y - y);
    if (d < bd) {
      bd = d;
      best = w;
    }
  }
  return best ? best.name : y < 60 ? "북쪽 언덕" : "ANIME TOWN";
}

const preload = () => [
  ...charFiles("amy"),
  ...BUILDINGS.filter((b) => b.icon.startsWith("px:")).map(
    (b) => `/icons/games/${b.icon.slice(3)}.webp`
  ),
  ...townFiles(),
  // 간판 글꼴 (캔버스에 그리기 전에 받아 둠)
  () =>
    Promise.all(
      [
        '400 40px "Black Han Sans"',
        '700 11px "Galmuri11"',
        '700 12px "Nanum Gothic"',
        '800 12px "Nanum Gothic"',
      ].map((f) =>
        typeof document !== "undefined" ? document.fonts.load(f).catch(() => null) : null
      )
    ),
];

const STYLE_NAME: Record<BStyle, string> = {
  pixel: "픽셀 건물",
  anime: "애니 건물",
  neon: "증권가",
  noir: "누아르",
  home: "우리 집",
  lot: "빈 터",
};
/** 고른 캐릭터: 주소 ?c=mio 로 바꾸면 기억해 둠 (고르는 화면은 나중에) */
const CHAR_PICK: CharId[] = ["amy", "mio", "sera"];
function pickedChar(): CharId {
  try {
    const q = new URLSearchParams(location.search).get("c") as CharId | null;
    if (q && CHAR_PICK.includes(q)) {
      localStorage.setItem("gmtown:c", q);
      return q;
    }
    const s = localStorage.getItem("gmtown:c") as CharId | null;
    if (s && CHAR_PICK.includes(s)) return s;
  } catch {
    /* 저장소 못 쓰면 기본 */
  }
  return "amy";
}

const navItem = (href: string | null) =>
  href ? (NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === href) ?? null) : null;

/** 진짜 전체화면이 되는 기기인지 (아이폰 사파리는 안 됨 → 전체화면 안내 없이 가로 화면만) */
const canFullscreen = () =>
  typeof document !== "undefined" &&
  !!(
    document.fullscreenEnabled ||
    (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled
  );

/*
 * 화면 틀 (포커와 같은 방식): PC 는 사이트 머리말 · 게임 머리말 아래 상자 (⛶ 로 전체화면),
 * 폰은 가로 전용 — 전체화면부터 (안 되는 기기는 가로면 화면을 덮어 그림), 세로면 「가로로 돌려 주세요」.
 */
export default function GMTownApp() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [scr, setScr] = useState({ w: 0, h: 0, touch: false });
  useEffect(() => {
    const on = () =>
      setScr({ w: window.innerWidth, h: window.innerHeight, touch: matchMedia("(pointer: coarse)").matches });
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const phone = scr.touch && Math.min(scr.w, scr.h) < 600;
  const land = scr.w > scr.h * 1.2;
  const [fsReal, setFsReal] = useState(false);
  const [pseudoFs, setPseudoFs] = useState(false);
  const [canFs, setCanFs] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저에서만 알 수 있는 값
    setCanFs(canFullscreen());
  }, []);
  useEffect(() => {
    const on = () => setFsReal(!!rootRef.current && document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const fs = fsReal || pseudoFs;
  const toggleFs = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (pseudoFs) return setPseudoFs(false);
    if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {});
    // 폰: 전체화면이 되면 가로로 고정 (되는 기기만 — 안 되면 「가로로 돌려 주세요」)
    const lockLand = () => {
      if (!matchMedia("(pointer: coarse)").matches) return;
      const o = window.screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      void o?.lock?.("landscape").catch(() => {});
    };
    if (typeof el.requestFullscreen === "function")
      el.requestFullscreen({ navigationUI: "hide" }).then(lockLand, () => setPseudoFs(true));
    else setPseudoFs(true);
  }, [pseudoFs]);
  // 무대 위에 사이트의 떠 있는 메뉴 버튼이 겹치지 않게
  useEffect(() => {
    document.body.classList.add("game-full");
    return () => document.body.classList.remove("game-full");
  }, []);
  // PC: 위에 붙어 있는 사이트 메뉴 높이만큼 비우고 화면 높이 그대로
  const [navH, setNavH] = useState(64);
  useEffect(() => {
    let h = 0;
    for (const el of document.querySelectorAll<HTMLElement>("header, nav")) {
      const pos = getComputedStyle(el).position;
      if (pos === "sticky" || pos === "fixed")
        h = Math.max(
          h,
          el.getBoundingClientRect().height + Math.max(0, parseFloat(getComputedStyle(el).top) || 0)
        );
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 화면에 그려진 메뉴 높이
    setNavH(h);
  }, []);
  // 폰을 눕혔는데 전체화면이 아니면(아이폰 등) 사이트 위를 덮어 전체화면처럼
  const cover = pseudoFs || (phone && land && !fsReal);
  const full = cover || fsReal;
  const fsGate = phone && !fs && canFs;
  const rotate = phone && !land && !fsGate;
  const outer = cover
    ? "fixed inset-0 z-[100] bg-black"
    : fsReal
      ? "h-full w-full bg-black"
      : "mx-auto w-full max-w-[1600px] px-0 pb-6 sm:px-3";
  const box = full
    ? "relative h-full w-full overflow-hidden"
    : "relative mx-auto min-h-[420px] w-full overflow-hidden sm:rounded-2xl sm:shadow-[0_10px_40px_rgba(0,0,0,0.35)]";
  const boxStyle = full
    ? undefined
    : { height: phone ? "calc(100dvh - 104px)" : `calc(100dvh - ${navH + 20}px)` };
  return (
    <div ref={rootRef} className={outer}>
      <GameLoader tasks={preload} title="ANIME TOWN" accent="#F2C14E" className={box} style={boxStyle}>
        <div className={`gmt ${box}`} style={{ background: "#3f7d4a", ...boxStyle }}>
          <Town phone={phone} fs={fs} canFs={canFs} toggleFs={toggleFs} />
          {fsGate && (
            <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_50%_40%,rgba(40,34,60,0.92),rgba(8,8,14,0.97))] p-6 text-center">
              <div className="gmt-lo-title text-[30px] leading-none">ANIME TOWN</div>
              <p className="text-[13px] text-white/75">웹 3D 실험용 놀이터 — 가로 전체화면으로 놀아요</p>
              <button
                type="button"
                onClick={toggleFs}
                className="gmt-gold-btn mt-1 flex h-12 cursor-pointer items-center gap-2 rounded-xl px-6 text-[15px] font-extrabold"
              >
                <span>⛶</span> 전체화면으로 플레이
              </button>
            </div>
          )}
          {rotate && (
            <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 bg-[#0b0a12]/95 p-6 text-center">
              <div className="text-[44px]">📱↻</div>
              <p className="font-['Black_Han_Sans',sans-serif] text-[22px] leading-tight text-white">폰을 가로로 돌려 주세요</p>
              <p className="text-[12px] text-white/60">마을은 가로 화면에서 돌아다닐 수 있어요</p>
            </div>
          )}
        </div>
      </GameLoader>
    </div>
  );
}

type Near = Building | "board" | NpcId | null;
const isNpc = (n: Near): n is NpcId => typeof n === "string" && n !== "board";

function Town({
  phone,
  fs,
  canFs,
  toggleFs,
}: {
  phone: boolean;
  fs: boolean;
  canFs: boolean;
  toggleFs: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const uiRef = useRef<HTMLCanvasElement | null>(null);
  const miniRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [engine, setEngine] = useState<TownEngine | null>(null);
  const [want, setWant] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [ch, setCh] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState<"join" | "on" | "error">("join");
  const [err, setErr] = useState("");
  const [log, setLog] = useState<ChatWire[]>([]);
  const [near, setNear] = useState<Near>(null);
  const [card, setCard] = useState<Near>(null);
  const [chanList, setChanList] = useState<ChannelList | null>(null);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  /** 폰 채팅창 펼침 (PC 는 늘 펼침) */
  const [logOpen, setLogOpen] = useState(false);
  const [overview, setOverview] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [sys, setSys] = useState<SysLine[]>([]);
  const [tab, setTab] = useState<ChatTab>("all");
  const [region, setRegion] = useState("ANIME TOWN");
  const [lastWarp, setLastWarp] = useState(0);
  const [myC, setMyC] = useState<CharId>("amy");
  const [picker, setPicker] = useState(false);
  // 집 안
  const [house, setHouse] = useState<HouseState | null>(null);
  const [houseDoor, setHouseDoor] = useState(false);
  const [hHover, setHHover] = useState<{ cx: number; cy: number } | null>(null);
  const hClick = useRef<((c: { cx: number; cy: number }) => void) | null>(null);
  const [meName, setMeName] = useState("나");
  const [hFloor, setHFloor] = useState(0);
  /** 받은 집 초대 (몇 초 동안 카드) */
  const [invite, setInvite] = useState<{ from: string; name: string; at: number } | null>(null);
  const houseRef = useRef<{ in: boolean; room: string | null }>({ in: false, room: null });
  useEffect(() => {
    houseRef.current = { in: !!house, room: house?.room ?? null };
  }, [house]);
  useEffect(() => {
    if (!invite) return;
    const t = window.setTimeout(() => setInvite((v) => (v === invite ? null : v)), 30_000);
    return () => window.clearTimeout(t);
  }, [invite]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장소(주소 · localStorage)에서만 알 수 있는 값
  useEffect(() => setMyC(pickedChar()), []);
  const chatEnd = useRef<HTMLDivElement | null>(null);
  const addSys = useCallback((text: string) => setSys((l) => [...l.slice(-29), { at: Date.now(), text }]), []);
  // 엔진 훅(키 입력)이 지금 값을 보게
  const cardRef = useRef<Near>(null);
  const nearRef = useRef<Near>(null);
  useEffect(() => {
    cardRef.current = card;
    nearRef.current = near;
  }, [card, near]);

  const say = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), 2400);
  }, []);

  // 엔진
  useEffect(() => {
    const c = canvasRef.current,
      u = uiRef.current;
    if (!c || !u) return;
    let e: TownEngine;
    try {
      e = new TownEngine(c, u, {
        onNear: (b) => setNear(b),
        onArrive: (b) => setCard(b),
        onInteract: () => {
          // 집 안의 E (문 앞 나가기) 는 HouseHud 가 받음
          if (houseRef.current.in) return;
          if (cardRef.current) return;
          if (nearRef.current) setCard(nearRef.current);
        },
        onHouseDoor: (at) => setHouseDoor(at),
        onHouseHover: (c) => setHHover(c),
        onHouseClick: (c) => hClick.current?.(c),
        onHouseFloor: (f) => setHFloor(f),
        send: (x, y, d, m, f) => void rpc("gmtown.move", { x, y, d, m, ...(f !== undefined ? { f } : {}) }).catch(() => {}),
        onOverview: (on) => setOverview(on),
        onMap: () => !houseRef.current.in && setMapOpen((o) => !o),
        onError: (m) => {
          setErr(m);
          setStatus("error");
        },
      });
    } catch {
      // 3D(WebGL)를 못 여는 기기 — 렌더 중이 아닌 다음 차례에 알림
      const id = window.setTimeout(() => {
        setErr(
          "이 기기 · 브라우저에서는 3D 마을을 열 수 없어요. 하드웨어 가속을 켜거나 다른 브라우저로 와 주세요."
        );
        setStatus("error");
      }, 0);
      return () => window.clearTimeout(id);
    }
    setEngine(e);
    try {
      if (!localStorage.getItem("gmtown:help")) setHelp(true);
    } catch {
      setHelp(true);
    }
    return () => e.destroy();
  }, []);

  // 채널 들어가기 (게스트면 익명 로그인부터)
  useEffect(() => {
    if (!engine) return;
    let off: (() => void) | null = null;
    let dead = false;
    void (async () => {
      try {
        await auth.authStateReady();
        if (!dead) setStatus("join");
        if (!auth.currentUser) await signInAnonymously(auth);
      } catch {
        if (!dead) {
          setErr("마을에 들어가지 못했어요. 잠시 후 다시 해 주세요.");
          setStatus("error");
        }
        return;
      }
      if (dead) return;
      const at = engine.pos();
      off = subscribe<TownSnap>(
        "gmtown.ch",
        { ch: want, c: pickedChar(), ...(at ?? {}) },
        {
          onSnapshot: (s) => {
            // 집 안에서 다시 이어지면(채널 옮김 · 끊김) 마을로 나와서 시작
            if (engine.inHouse()) {
              engine.exitHouse(s.players.find((p) => p.id === s.me)?.x ?? 0, s.players.find((p) => p.id === s.me)?.y ?? 0);
              setHouse(null);
            }
            engine.reset(s);
            // 우리 집 건물은 계약해야 섬
            void rpc<HouseWire>("gmtown.house").then(
              (h) => engine.setHomeBuilt(h.tier > 0),
              () => {}
            );
            setMeName(s.players.find((p) => p.id === s.me)?.name ?? "나");
            setCh(s.ch);
            setCount(s.players.length);
            setLog(s.chat);
            setStatus("on");
            setSys((l) => [...l.slice(-29), { at: Date.now(), text: `${s.ch}채널에 들어왔어요. (${s.players.length}명)` }]);
          },
          onEvent: (t, d) => {
            if (t === "join") engine.join(d as PlayerWire);
            else if (t === "leave") engine.leave(d as string);
            else if (t === "mv") engine.moves(d as MoveWire[]);
            else if (t === "snap")
              engine.snap((d as { x: number; y: number }).x, (d as { x: number; y: number }).y);
            else if (t === "home") {
              const v = d as { id: string; on: boolean; room?: string };
              engine.setAway(v.id, v.on, v.room ?? null);
            } else if (t === "invite") {
              const v = d as { from: string; name: string };
              setInvite({ ...v, at: Date.now() });
              setSys((l) => [...l.slice(-29), { at: Date.now(), text: `${v.name}님이 집에 초대했어요! 🏠` }]);
            } else if (t === "hlayout") {
              const v = d as { room: string; layout: HouseWire["layout"] };
              if (houseRef.current.room === v.room) {
                engine.houseLayout(v.layout as never);
                setHouse((h) => (h ? { ...h, layout: v.layout } : h));
              }
            } else if (t === "char") {
              const v = d as { id: string; c: CharId };
              engine.setChar(v.id, v.c);
            } else if (t === "chat") {
              engine.chat(d as ChatWire);
              setLog((l) => [...l.slice(-39), d as ChatWire]);
            }
            if (t === "join" || t === "leave") setCount(engine.count());
          },
          onError: (e) => {
            setErr(e.message || "연결이 끊겼어요.");
            setStatus("error");
          },
        }
      );
    })();
    return () => {
      dead = true;
      off?.();
    };
  }, [engine, want, retry]);

  // 작은 지도
  useEffect(() => {
    if (!engine) return;
    const id = window.setInterval(() => {
      const m = miniRef.current;
      if (!m) return;
      const ctx = m.getContext("2d");
      if (!ctx) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (m.width !== m.clientWidth * dpr) {
        m.width = m.clientWidth * dpr;
        m.height = m.clientHeight * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const st = engine.mapState();
      drawMiniRound(ctx, m.clientWidth, st.me, st.others, st.yaw);
      if (st.me) setRegion(regionName(st.me.x, st.me.y));
    }, 150);
    return () => window.clearInterval(id);
  }, [engine]);

  // 키: Enter 채팅 · Esc 닫기
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (cardRef.current) setCard(null);
        else if (picker) setPicker(false);
        else if (mapOpen) setMapOpen(false);
        else if (chanList) setChanList(null);
        else if (overview) engine?.setOverview(false);
        inputRef.current?.blur();
        return;
      }
      if (e.key === "Enter" && document.activeElement !== inputRef.current && !cardRef.current && !mapOpen && !picker) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [chanList, overview, engine, mapOpen, picker]);

  useEffect(() => {
    engine?.setTyping(typing || !!card || !!chanList || mapOpen || picker);
    engine?.setMapOpen(mapOpen || picker);
  }, [engine, typing, card, chanList, mapOpen, picker]);

  // 채팅창: 새 줄이 오면 맨 아래로
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "end" });
  }, [log, sys, tab]);

  const enterHome = () => {
    setCard(null);
    void rpc<HouseWire>("gmtown.house.enter").then(
      (w) => {
        engine?.enterHouse(w.tier, w.layout as never, w.room ?? null);
        setHouse({ ...w, owner: meName, guest: false });
        setMapOpen(false);
        addSys("내 집에 들어왔어요. 🔨 꾸미기로 가구를 놓아 보세요!");
      },
      (e) => say((e as Error).message || "들어가지 못했어요.")
    );
  };
  /** 초대받은 집으로 놀러 가기 */
  const visit = (from: string) => {
    setInvite(null);
    setCard(null);
    void rpc<HouseWire>("gmtown.house.visit", { from }).then(
      (w) => {
        engine?.enterHouse(w.tier, w.layout as never, w.room ?? null);
        setHouse({ ...w, owner: w.owner ?? "친구", guest: true });
        setMapOpen(false);
        addSys(`${w.owner ?? "친구"}님의 집에 놀러 왔어요! 🎉`);
      },
      (e) => say((e as Error).message || "놀러 가지 못했어요.")
    );
  };
  const leaveHome = () => {
    void rpc<{ x: number; y: number }>("gmtown.house.leave").then(
      (r) => {
        engine?.exitHouse(r.x, r.y);
        setHouse(null);
        setHouseDoor(false);
      },
      (e) => say((e as Error).message || "나가지 못했어요.")
    );
  };
  const warpTo = (w: Warp) => {
    void rpc<{ x: number; y: number }>("gmtown.warp", { to: w.id }).then(
      (r) => {
        engine?.snap(r.x, r.y);
        setLastWarp(Date.now());
        setMapOpen(false);
        addSys(`${w.name} 앞으로 순간이동했어요.`);
      },
      (e) => say((e as Error).message || "이동하지 못했어요.")
    );
  };
  const pickChar = (c: CharId) => {
    setPicker(false);
    if (c === myC) return;
    try {
      localStorage.setItem("gmtown:c", c);
    } catch {}
    setMyC(c);
    void rpc("gmtown.char", { c }).then(
      () => addSys(`${CHARS[c].name}(으)로 바꿨어요.`),
      (e) => say((e as Error).message || "바꾸지 못했어요.")
    );
  };
  const walkTo = (w: Warp) => {
    if (!engine) return;
    if (w.b) engine.walkToBuilding(w.b);
    else engine.walkTo(w.x, w.y, null);
    setMapOpen(false);
    addSys(`${w.name}(으)로 걸어가요.`);
  };

  const send = () => {
    const v = text.trim();
    if (!v) {
      inputRef.current?.blur();
      return;
    }
    setText("");
    void rpc("gmtown.chat", { text: v }).catch((e) =>
      say((e as Error).message || "보내지 못했어요.")
    );
    if (phone) inputRef.current?.blur();
  };

  const openChannels = () =>
    void rpc<ChannelList>("gmtown.channels").then(setChanList, (e) => say((e as Error).message));
  const closeHelp = () => {
    setHelp(false);
    try {
      localStorage.setItem("gmtown:help", "1");
    } catch {}
  };

  const nearName = near === "board" ? "마을 안내판" : isNpc(near) ? npcById(near)!.name : near?.sign;

  return (
    <div className="absolute inset-0 select-none">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block touch-none"
        aria-label="ANIME TOWN"
      />
      <canvas ref={uiRef} className="pointer-events-none absolute inset-0 block" aria-hidden />

      {/* 왼쪽 위: 나가기 · 이름 · 채널 */}
      <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2">
        {phone && (
          <Link
            href="/"
            className="gmt-glass pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full text-[16px]"
            aria-label="사이트로"
          >
            ←
          </Link>
        )}
        {/* 세로 폰(좁은 화면)은 채널 칩 · 작은 지도와 겹쳐서 이름판은 뺌 */}
        <button
          type="button"
          onClick={() => setPicker(true)}
          aria-label="캐릭터 바꾸기"
          title="캐릭터 바꾸기"
          className="pointer-events-auto relative h-11 w-11 shrink-0 cursor-pointer overflow-hidden rounded-full p-[2px]"
          style={{ background: "linear-gradient(160deg,#f3d68e,#8a6a2c 45%,#f0cf86)" }}
        >
          <img src={`/poker/char/${myC}/profile.webp`} alt="" className="h-full w-full rounded-full bg-[#1a1726] object-cover object-center" draggable={false} />
          <span className="absolute right-0 bottom-0 flex h-4 w-4 items-center justify-center rounded-full bg-[#1a1726] text-[9px] ring-1 ring-[#e9cf8e]">↻</span>
        </button>
        <div className="gmt-glass flex h-9 items-center rounded-full px-4 max-[520px]:hidden">
          <span className="gmt-brand text-[18px] leading-none">ANIME TOWN</span>
        </div>
        <button
          type="button"
          onClick={openChannels}
          className="gmt-glass pointer-events-auto flex h-9 cursor-pointer items-center gap-2 rounded-full px-3 text-[12px] font-bold"
        >
          <span
            className={`h-2 w-2 rounded-full ${status === "on" ? "bg-[#4FD1A5]" : status === "error" ? "bg-[#FF5C66]" : "animate-pulse bg-[#F2C14E]"}`}
          />
          {ch ? `${ch}채널` : "들어가는 중"}
          <span className="text-white/60">· {count}명</span>
          <span className="text-white/50">▾</span>
        </button>
        {canFs && (
          <button
            type="button"
            onClick={toggleFs}
            aria-label={fs ? "전체화면 끄기" : "전체화면"}
            title={fs ? "전체화면 끄기" : "전체화면"}
            className="gmt-glass pointer-events-auto flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-[15px]"
          >
            {fs ? "🗗" : "⛶"}
          </button>
        )}
      </div>

      {/* 오른쪽 위: 원형 지도 (누르면 전체 지도) · 지역 이름 · 채널 · 당기기 · 밀기 */}
      <div className={`absolute top-2.5 right-2.5 flex flex-col items-end gap-1 ${house ? "hidden" : ""}`}>
        <div className="gmt-lo-soft pointer-events-none flex h-6 items-center gap-1.5 rounded-full px-3 text-[11.5px] font-bold">
          <span className="text-[#FFE6A0]">{region}</span>
          {ch && <span className="text-white/55">· {ch}채널</span>}
        </div>
        <div className="flex items-start gap-1.5">
          <div className="flex flex-col gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => setMapOpen(true)}
              aria-label="전체 지도"
              className="gmt-lo-soft flex h-9 w-9 cursor-pointer flex-col items-center justify-center rounded-lg text-[15px] leading-none"
            >
              🗺<span className="mt-0.5 text-[8.5px] font-bold text-white/75">{phone ? "지도" : "M"}</span>
            </button>
            {(
              [
                ["+", "가까이", () => engine?.zoomBy(1 / 1.25)],
                ["−", "멀리", () => engine?.zoomBy(1.25)],
              ] as const
            ).map(([t, label, f]) => (
              <button
                key={t}
                type="button"
                onClick={f}
                aria-label={label}
                className="gmt-lo-soft flex h-7 w-9 cursor-pointer items-center justify-center rounded-lg text-[15px] font-bold leading-none"
              >
                {t}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setMapOpen(true)}
            aria-label="마을 전체 지도"
            className="relative cursor-pointer rounded-full p-[3px]"
            style={{ background: "linear-gradient(160deg,#f3d68e,#8a6a2c 45%,#f0cf86)" }}
          >
            <canvas
              ref={miniRef}
              className={`block rounded-full ${phone ? "h-[96px] w-[96px]" : "h-[150px] w-[150px]"}`}
            />
          </button>
        </div>
      </div>

      {/* 왼쪽 아래: 로아식 채팅창 (늘 떠 있음 · 탭 · 입력줄). 폰은 조이스틱 위에 작게 (누르면 펼침) */}
      <ChatBox
        phone={phone}
        open={logOpen}
        setOpen={setLogOpen}
        tab={tab}
        setTab={setTab}
        log={log}
        sys={sys}
        endRef={chatEnd}
        input={
          <form
            className="flex h-9 items-center gap-2 border-t border-[#c9a45c]/25 bg-black/35 pr-1 pl-3"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              ref={inputRef}
              value={text}
              maxLength={CHAT_MAX}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              placeholder={phone ? "말하기" : "Enter 로 채팅"}
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-white outline-none placeholder:text-white/40"
              enterKeyHint="send"
            />
            <button
              type="submit"
              className="gmt-gold-btn h-7 shrink-0 cursor-pointer rounded-md px-3 text-[11.5px] font-bold"
            >
              보내기
            </button>
          </form>
        }
      />

      {/* 아래 가운데: 문 앞 */}
      {near && !card && !house && phone && (
        <button
          type="button"
          onClick={() => setCard(near)}
          className="gmt-pop absolute right-5 bottom-5 flex h-[84px] w-[84px] cursor-pointer flex-col items-center justify-center rounded-full text-[12px] font-extrabold"
          style={{
            background: "radial-gradient(circle at 50% 35%, #3a3150, #15121f)",
            border: "2px solid #e9cf8e",
            boxShadow: "0 0 0 4px rgba(233,207,142,0.18), 0 6px 20px rgba(0,0,0,0.5)",
          }}
        >
          <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg text-[20px]">
            {near === "board" ? "📋" : isNpc(near) ? "💬" : <GameIcon icon={near.icon} />}
          </span>
          <span className="mt-0.5 text-[#FFE6A0]">{near === "board" ? "보기" : isNpc(near) ? "말 걸기" : "들어가기"}</span>
        </button>
      )}
      {near && !card && !house && !phone && (
        <div className="gmt-pop pointer-events-auto absolute bottom-6 left-1/2 -translate-x-1/2">

          <button
            type="button"
            onClick={() => setCard(near)}
            className="gmt-glass flex cursor-pointer items-center gap-3 rounded-2xl py-2 pr-4 pl-2 text-left"
          >
            <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white/10 text-[22px]">
              {near === "board" ? "📋" : isNpc(near) ? "💬" : <GameIcon icon={near.icon} />}
            </span>
            <span className="flex flex-col">
              <b className="text-[14px] leading-tight">{nearName}</b>
              <span className="text-[11px] text-white/60">
                {near === "board"
                  ? "마을 둘러보기 · 조작법"
                  : isNpc(near)
                    ? `${npcById(near)!.title} · 말 걸기`
                  : near.href
                    ? "들어가기"
                    : isLot(near)
                      ? near.sub
                      : "준비 중"}
              </span>
            </span>
            {!phone && (
              <kbd className="ml-1 rounded-md border border-white/25 bg-white/10 px-2 py-0.5 text-[11px] font-bold">
                E
              </kbd>
            )}
          </button>
        </div>
      )}

      {/* 집 안 */}
      {house && engine && (
        <HouseHud
          engine={engine}
          phone={phone}
          house={house}
          setHouse={setHouse}
          atDoor={houseDoor}
          onLeave={leaveHome}
          say={say}
          hover={hHover}
          clickRef={hClick}
          floor={hFloor}
        />
      )}

      {/* 집 초대 받음 */}
      {invite && (
        <div className="gmt-lo gmt-pop absolute top-14 left-1/2 z-20 flex w-[min(92%,380px)] -translate-x-1/2 items-center gap-3 rounded-xl px-3 py-2.5">
          <span className="text-[26px]">💌</span>
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[13.5px]">{invite.name}님의 집 초대</b>
            <span className="text-[11px] text-white/60">놀러 오래요! (5분 안에 갈 수 있어요)</span>
          </div>
          <button type="button" onClick={() => visit(invite.from)} className="gmt-gold-btn h-8 shrink-0 cursor-pointer rounded-lg px-3 text-[12px] font-extrabold">
            놀러 가기
          </button>
          <button type="button" onClick={() => setInvite(null)} aria-label="초대 닫기" className="gmt-dark-btn h-8 w-8 shrink-0 cursor-pointer rounded-lg text-[12px]">
            ✕
          </button>
        </div>
      )}

      {/* 처음 온 사람 도움말 */}
      {help && status === "on" && (
        <div className="gmt-pop absolute top-16 left-1/2 w-[min(92%,460px)] -translate-x-1/2">
          <div className="gmt-glass rounded-2xl px-5 py-4 text-[13px] leading-relaxed">
            <b className="gmt-brand text-[17px]">ANIME TOWN 에 오신 걸 환영해요</b>
            <p className="mt-1 text-white/85">
              {phone
                ? "왼쪽 아래 조이스틱으로 걸어요(끝까지 밀면 뛰어요) · 화면을 한 손가락으로 끌면 시점이 돌아가고, 두 손가락으로 돌리고 벌려서 당겨요 · 지도 버튼에서 가고 싶은 곳으로 순간이동해요."
                : "WASD · 방향키로 걷고(Shift 를 누르면 뛰어요), 오른쪽 버튼으로 누른 곳으로 가요(멀면 뛰어가요). 왼쪽 버튼으로 끌면 시점이 돌아가고(위아래로 끌면 높이), 휠로 당겨요. M 은 전체 지도 — 가고 싶은 곳으로 순간이동 · 걸어서 이동."}{" "}
              건물 문 앞에서 {phone ? "버튼" : "E"} 를 누르면 그 게임으로 들어가요. 같은 채널
              사람들끼리 보이고 말할 수 있어요.
            </p>
            <button
              type="button"
              onClick={closeHelp}
              className="mt-3 cursor-pointer rounded-full bg-[#F2C14E] px-4 py-1.5 text-[12px] font-bold text-[#1A1408]"
            >
              알겠어요
            </button>
          </div>
        </div>
      )}

      {/* 전체 지도 창 */}
      {mapOpen && engine && (
        <MapModal
          engine={engine}
          phone={phone}
          ch={ch}
          lastWarp={lastWarp}
          onClose={() => setMapOpen(false)}
          onWarp={warpTo}
          onWalk={walkTo}
        />
      )}

      {/* 캐릭터 바꾸기 */}
      {picker && <CharPicker cur={myC} phone={phone} onPick={pickChar} onClose={() => setPicker(false)} />}

      {/* 건물 카드 */}
      {card && isNpc(card) && (
        <NpcDialog id={card} phone={phone} onClose={() => setCard(null)} onSys={addSys} onGoHome={enterHome} onBought={() => engine?.setHomeBuilt(true)} />
      )}
      {card && !isNpc(card) && <Card near={card} onClose={() => setCard(null)} onHome={enterHome} />}

      {/* 채널 고르기 */}
      {chanList && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/45 p-4"
          onClick={() => setChanList(null)}
        >
          <div
            className="gmt-glass gmt-sheet gmt-pop max-h-full w-[min(100%,380px)] overflow-y-auto rounded-2xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <b className="text-[15px]">채널 고르기</b>
              <span className="text-[11px] text-white/55">채널마다 {chanList.cap}명까지</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {chanList.list.map((r) => {
                const full = r.n >= chanList.cap;
                const cur = r.ch === ch;
                return (
                  <button
                    key={r.ch}
                    type="button"
                    disabled={full && !cur}
                    onClick={() => {
                      setChanList(null);
                      if (!cur) setWant(r.ch);
                    }}
                    className={`flex cursor-pointer flex-col items-center rounded-xl border px-2 py-2 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ${cur ? "border-[#F2C14E] bg-[#F2C14E]/15 text-[#FFD36B]" : "border-white/15 bg-white/5 hover:bg-white/10"}`}
                  >
                    {r.ch}채널
                    <span className="mt-0.5 text-[11px] font-normal text-white/60">
                      {full ? "꽉 참" : `${r.n}명`}
                    </span>
                    <span className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/10">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.min(100, (r.n / chanList.cap) * 100)}%`,
                          background: r.n / chanList.cap > 0.8 ? "#FF5C66" : "#4FD1A5",
                        }}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 들어가는 중 · 오류 */}
      {status !== "on" && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0d1220]/70">
          <div className="gmt-glass rounded-2xl px-6 py-5 text-center">
            <div className="gmt-brand text-[22px]">ANIME TOWN</div>
            <p className="mt-1 text-[13px] text-white/80">
              {status === "error" ? err : "마을에 들어가는 중…"}
            </p>
            {status === "error" && (
              <button
                type="button"
                onClick={() => setRetry((r) => r + 1)}
                className="mt-3 cursor-pointer rounded-full bg-[#F2C14E] px-4 py-1.5 text-[12px] font-bold text-[#1A1408]"
              >
                다시 들어가기
              </button>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="gmt-glass gmt-pop absolute top-16 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-[12px]">
          {toast}
        </div>
      )}
    </div>
  );
}

const PICK_INFO: Record<CharId, { tag: string; color: string }> = {
  amy: { tag: "금발 트윈테일 · 하늘색 크롭티", color: "#7fc4ff" },
  mio: { tag: "파란 긴머리 · 고딕 로리타", color: "#8fa8ff" },
  sera: { tag: "분홍 긴머리 · 붉은 리본 드레스", color: "#ff8fb8" },
};
const pickPic = (c: CharId) => `/gmtown/char/pick_${c}.webp`;

function CharPicker({ cur, phone, onPick, onClose }: { cur: CharId; phone: boolean; onPick: (c: CharId) => void; onClose: () => void }) {
  const [sel, setSel] = useState<CharId>(cur);
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 p-3" onClick={onClose}>
      <div
        className={`gmt-lo gmt-pop relative flex flex-col overflow-hidden rounded-xl ${phone ? "h-full w-full" : "w-[min(100%,820px)]"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex h-11 shrink-0 items-center justify-center border-b border-[#c9a45c]/30 bg-gradient-to-b from-[#2a2438] to-[#16141f]">
          <span className="text-[#c9a45c]/70">❖</span>
          <b className="gmt-lo-title mx-3 text-[19px]">캐릭터 선택</b>
          <span className="text-[#c9a45c]/70">❖</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="absolute right-2 flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[18px] text-white/80 hover:bg-white/10"
          >
            ✕
          </button>
        </div>
        <div className={`grid min-h-0 flex-1 grid-cols-3 gap-2.5 p-3 ${phone ? "" : "sm:gap-4 sm:p-5"}`}>
          {CHAR_PICK.map((c) => {
            const on = c === sel;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setSel(c)}
                onDoubleClick={() => onPick(c)}
                className={`group relative flex min-h-0 cursor-pointer flex-col overflow-hidden rounded-lg border-2 text-left transition-transform ${
                  on ? "scale-[1.02] border-[#ffe7a8] shadow-[0_0_24px_rgba(242,193,78,0.35)]" : "border-white/10 hover:border-[#c9a45c]/60"
                }`}
                style={{ background: `linear-gradient(180deg, ${PICK_INFO[c].color}33, #14121c 70%)` }}
              >
                <img
                  src={pickPic(c)}
                  alt={CHARS[c].name}
                  className={`w-full object-cover object-top ${phone ? "min-h-0 flex-1" : "aspect-[4/5]"} ${on ? "" : "opacity-80 saturate-75 group-hover:opacity-100"}`}
                  draggable={false}
                />
                <div className="border-t border-white/10 bg-black/45 px-2.5 py-2">
                  <div className="flex items-center gap-1.5">
                    <b className={`text-[15px] ${on ? "text-[#FFE6A0]" : "text-white"}`}>{CHARS[c].name}</b>
                    {c === cur && (
                      <span className="rounded bg-[#4FD1A5]/20 px-1.5 py-[1px] text-[10px] font-bold text-[#9be7c4]">지금</span>
                    )}
                  </div>
                  {!phone && <div className="mt-0.5 truncate text-[11px] text-white/55">{PICK_INFO[c].tag}</div>}
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#c9a45c]/20 bg-black/25 px-3 py-2.5">
          <span className="mr-auto text-[11.5px] text-white/50">같은 채널 사람들에게도 바로 바뀌어 보여요</span>
          <button
            type="button"
            onClick={onClose}
            className="gmt-dark-btn h-9 cursor-pointer rounded-lg px-4 text-[13px] font-bold"
          >
            닫기
          </button>
          <button
            type="button"
            disabled={sel === cur}
            onClick={() => onPick(sel)}
            className="gmt-gold-btn h-9 cursor-pointer rounded-lg px-5 text-[13px] font-extrabold disabled:cursor-not-allowed"
          >
            {sel === cur ? "선택됨" : `${CHARS[sel].name}(으)로 바꾸기`}
          </button>
        </div>
      </div>
    </div>
  );
}

const TAB_LABEL: Record<ChatTab, string> = { all: "전체", talk: "대화", sys: "시스템" };

function ChatBox({
  phone,
  open,
  setOpen,
  tab,
  setTab,
  log,
  sys,
  endRef,
  input,
}: {
  phone: boolean;
  open: boolean;
  setOpen: (v: boolean) => void;
  tab: ChatTab;
  setTab: (t: ChatTab) => void;
  log: ChatWire[];
  sys: SysLine[];
  endRef: RefObject<HTMLDivElement | null>;
  input: ReactNode;
}) {
  type Row = { at: number; k: "chat" | "sys"; name?: string; guest?: boolean; text: string };
  const rows: Row[] = [
    ...(tab !== "sys"
      ? log.map((m) => ({ at: m.at, k: "chat" as const, name: m.name, guest: m.name.startsWith("◦"), text: m.text }))
      : []),
    ...(tab !== "talk" ? sys.map((m) => ({ at: m.at, k: "sys" as const, text: m.text })) : []),
  ].sort((a, b) => a.at - b.at);
  // 폰: 접으면 마지막 두 줄만 (조이스틱 위)
  const small = phone && !open;
  const shown = small ? rows.slice(-2) : rows.slice(-60);
  return (
    <div
      className={`gmt-lo-soft pointer-events-auto absolute left-2.5 flex flex-col overflow-hidden rounded-lg ${
        phone ? (open ? "bottom-2.5 w-[46%] max-w-[360px]" : "bottom-[150px] w-[38%] max-w-[300px]") : "bottom-3 w-[380px]"
      }`}
    >
      {!small && (
        <div className="flex h-7 shrink-0 items-center gap-0.5 border-b border-[#c9a45c]/25 bg-black/30 px-1">
          {(Object.keys(TAB_LABEL) as ChatTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`h-6 cursor-pointer rounded px-2.5 text-[11px] font-bold ${
                tab === t ? "bg-[#e9cf8e]/18 text-[#FFE6A0]" : "text-white/55 hover:text-white/85"
              }`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
          {phone && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-auto h-6 cursor-pointer px-2 text-[12px] text-white/60"
              aria-label="채팅 접기"
            >
              ▾
            </button>
          )}
        </div>
      )}
      <div
        className={`gmt-chat-scroll overflow-y-auto px-2.5 py-1.5 text-[12px] leading-[1.6] ${
          small ? "max-h-[46px] cursor-pointer" : phone ? "h-[120px]" : "h-[150px]"
        }`}
        onClick={small ? () => setOpen(true) : undefined}
      >
        {shown.map((r, i) =>
          r.k === "sys" ? (
            <div key={`s${r.at}-${i}`} className="text-[#F2D27A]">
              <span className="text-[#F2D27A]/70">[시스템]</span> {r.text}
            </div>
          ) : (
            <div key={`c${r.at}-${i}`} className={small ? "truncate" : "break-all"}>
              <b className={r.guest ? "text-white/55" : "text-[#9fd3ff]"}>{r.name}</b>
              <span className="text-white/45"> : </span>
              <span className="text-white/90">{r.text}</span>
            </div>
          )
        )}
        {!shown.length && (
          <div className="text-white/40">{small ? "눌러서 채팅" : "같은 채널 사람들과 이야기해요."}</div>
        )}
        <div ref={endRef} />
      </div>
      {!small && input}
    </div>
  );
}

function Card({ near, onClose, onHome }: { near: Building | "board"; onClose: () => void; onHome: () => void }) {
  if (near === "board")
    return (
      <Sheet onClose={onClose}>
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-[30px]">
            📋
          </span>
          <div>
            <div className="gmt-brand text-[22px] leading-tight">마을 안내판</div>
            <div className="text-[12px] text-white/60">ANIME TOWN 둘러보기</div>
          </div>
        </div>
        <ul className="mt-4 space-y-1.5 text-[13px] leading-relaxed text-white/85">
          <li>
            🏛 게임마다 건물이 하나씩 — 픽셀 게임은 픽셀 건물, 애니 게임은 애니 건물이에요. 광장에서
            길을 따라가면 다 나와요.
          </li>
          <li>🗺 오른쪽 위 원형 지도(또는 M)를 누르면 전체 지도 — 가고 싶은 곳을 골라 순간이동 · 걸어서 이동.</li>
          <li>🚧 「새 게임 자리」 팻말 — 새 게임이 생기면 여기에 건물이 들어서요.</li>
          <li>🚪 문 앞에 서서 E(폰은 버튼)를 누르면 그 게임으로 들어가요.</li>
          <li>💬 같은 채널 사람들끼리 보이고 말할 수 있어요. 위의 채널 버튼으로 옮겨요.</li>
          <li>🏠 우리 집: GP 로 사고 꾸미고 친구를 부르는 내 집 — 곧 열려요.</li>
          <li>
            ⌨ WASD · 방향키 걷기 · Shift 뛰기 · 오른쪽 버튼 = 누른 곳으로 · 왼쪽 끌기 = 시점 돌리기 · 높이 · 휠 · +/− 당기기 · M
            지도 · Enter 채팅 · Esc 닫기
          </li>
        </ul>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-full bg-[#F2C14E] px-5 py-2 text-[13px] font-bold text-[#1A1408]"
          >
            닫기
          </button>
        </div>
      </Sheet>
    );
  const b = near;
  const nav = navItem(b.href);
  return (
    <Sheet onClose={onClose} accent={b.accent}>
      <div className="flex items-center gap-3">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/10 text-[30px]">
          <GameIcon icon={b.icon} />
        </span>
        <div className="min-w-0">
          <div className="gmt-brand truncate text-[22px] leading-tight">{nav?.label ?? b.sign}</div>
          <div className="text-[12px] text-white/60">{b.sub}</div>
        </div>
        <span
          className="ml-auto shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold"
          style={{ borderColor: `${b.accent}88`, color: b.accent }}
        >
          {STYLE_NAME[b.style]}
        </span>
      </div>
      {b.href ? (
        <p className="mt-4 text-[13px] leading-relaxed text-white/85">{nav?.desc ?? b.sub}</p>
      ) : isLot(b) ? (
        <p className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3 text-[13px] leading-relaxed text-white/85">
          <b className="text-[#FFD36B]">{b.sub}</b> — 마을을 새로 짓는 중이에요. 곧 이 부지에 그
          게임 화풍의 건물이 들어서요.
        </p>
      ) : (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3 text-[13px] leading-relaxed text-white/85">
          <b className="text-[#FFD36B]">집 계약은 문 옆 중개인 민트에게</b>
          <ul className="mt-1 space-y-1">
            <li>🏠 GP 로 내 집 사기 (마을에 입구는 하나, 들어가면 나만의 집)</li>
            <li>🔨 원룸 → 투룸 → 2층 → 정원, 단계별 업그레이드</li>
            <li>💌 친구 초대해서 같이 놀기</li>
          </ul>
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded-full border border-white/20 px-4 py-2 text-[13px] text-white/85 hover:bg-white/10"
        >
          닫기
        </button>
        {b.href && (
          <Link
            href={b.href}
            className="rounded-full px-5 py-2 text-[13px] font-bold text-[#1A1408]"
            style={{ background: "#F2C14E" }}
          >
            들어가기 →
          </Link>
        )}
        {b.id === "home" && (
          <button
            type="button"
            onClick={onHome}
            className="cursor-pointer rounded-full px-5 py-2 text-[13px] font-bold text-[#1A1408]"
            style={{ background: "#F2C14E" }}
          >
            🏠 내 집 들어가기
          </button>
        )}
      </div>
    </Sheet>
  );
}

function Sheet({
  children,
  onClose,
  accent = "#F2C14E",
}: {
  children: ReactNode;
  onClose: () => void;
  accent?: string;
}) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
    >
      <div
        className="gmt-glass gmt-sheet gmt-pop relative max-h-full w-[min(100%,440px)] overflow-y-auto rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className="pointer-events-none absolute top-0 right-6 left-6 h-[2px] rounded-b"
          style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
        />
        {children}
      </div>
    </div>
  );
}
