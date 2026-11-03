"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { signInAnonymously } from "firebase/auth";
import { auth } from "@/firebase";
import GameIcon from "@/components/GameIcon";
import GameLoader from "@/components/GameLoader";
import { NAV_GROUPS } from "@/data/navMenu";
import { rpc, subscribe } from "@/lib/api/socket";
import { charFiles } from "@/lib/gmtown/chars";
import type { ChannelList, ChatWire, MoveWire, PlayerWire, TownSnap } from "@/lib/gmtown/types";
import { BUILDINGS, CHAT_MAX, isLot, type BStyle, type Building } from "@/lib/gmtown/world";
import { TownEngine } from "./engine";
import { townFiles } from "./scene3d";

/*
 * GMTOWN 화면 — 3D 캔버스(엔진) + 이름표 캔버스 위에 HUD: 채널 · 사람 수 / 작은 지도 · 당기기 · 지도 / 채팅 / 문 앞 「들어가기」 / 건물 카드.
 * 로그인 안 했으면 게스트(익명)로 들어옴. 폰은 화면 전체(사이트 메뉴 없이), 왼쪽 손가락 조이스틱 · 누른 곳으로 걷기 · 두 손가락으로 당기기.
 */

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
const navItem = (href: string | null) =>
  href ? (NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === href) ?? null) : null;

function usePhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const on = () =>
      setPhone(
        matchMedia("(pointer: coarse)").matches &&
          Math.min(window.innerWidth, window.innerHeight) < 600
      );
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return phone;
}

export default function GMTownApp() {
  const phone = usePhone();
  useEffect(() => {
    if (!phone) return;
    document.body.classList.add("game-full");
    return () => document.body.classList.remove("game-full");
  }, [phone]);
  // PC: 화면 높이 그대로 쓰고, 들어오면 마을이 화면에 꽉 차게 내려 줌 (사이트 머리말은 위로 스크롤하면 보임)
  const wrap = useRef<HTMLDivElement | null>(null);
  const [navH, setNavH] = useState(64);
  useEffect(() => {
    if (phone || !wrap.current) return;
    // 위에 붙어 있는 사이트 메뉴 높이만큼 비움
    let h = 0;
    for (const el of document.querySelectorAll<HTMLElement>("header, nav")) {
      const pos = getComputedStyle(el).position;
      if (pos === "sticky" || pos === "fixed")
        h = Math.max(
          h,
          el.getBoundingClientRect().height + Math.max(0, parseFloat(getComputedStyle(el).top) || 0)
        );
    }
    setNavH(h);
    const top = wrap.current.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: Math.max(0, top - h), behavior: "smooth" });
  }, [phone]);
  const box = phone
    ? "fixed inset-0 z-[60]"
    : "relative mx-auto min-h-[480px] w-full max-w-[1600px] overflow-hidden rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.35)]";
  const boxStyle = phone ? undefined : { height: `calc(100dvh - ${navH + 20}px)` };
  return (
    <div ref={wrap} className={phone ? "" : "px-2 pt-2 pb-6 sm:px-4"}>
      <GameLoader tasks={preload} title="GMTOWN" accent="#F2C14E" className={box} style={boxStyle}>
        <div className={`gmt ${box}`} style={{ background: "#3f7d4a", ...boxStyle }}>
          <Town phone={phone} />
        </div>
      </GameLoader>
    </div>
  );
}

type Near = Building | "board" | null;

function Town({ phone }: { phone: boolean }) {
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
  const [logOpen, setLogOpen] = useState(true);
  const [overview, setOverview] = useState(false);
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
          if (cardRef.current) return;
          if (nearRef.current) setCard(nearRef.current);
        },
        send: (x, y, d, m) => void rpc("gmtown.move", { x, y, d, m }).catch(() => {}),
        onOverview: (on) => setOverview(on),
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
        { ch: want, ...(at ?? {}) },
        {
          onSnapshot: (s) => {
            engine.reset(s);
            setCh(s.ch);
            setCount(s.players.length);
            setLog(s.chat);
            setStatus("on");
          },
          onEvent: (t, d) => {
            if (t === "join") engine.join(d as PlayerWire);
            else if (t === "leave") engine.leave(d as string);
            else if (t === "mv") engine.moves(d as MoveWire[]);
            else if (t === "snap")
              engine.snap((d as { x: number; y: number }).x, (d as { x: number; y: number }).y);
            else if (t === "chat") {
              engine.chat(d as ChatWire);
              setLog((l) => [...l.slice(-39), d as ChatWire]);
              setLogOpen(true);
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
      engine.drawMinimap(ctx, m.clientWidth, m.clientHeight);
    }, 200);
    return () => window.clearInterval(id);
  }, [engine]);

  // 키: Enter 채팅 · Esc 닫기
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (cardRef.current) setCard(null);
        else if (chanList) setChanList(null);
        else if (overview) engine?.setOverview(false);
        inputRef.current?.blur();
        return;
      }
      if (e.key === "Enter" && document.activeElement !== inputRef.current && !cardRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [chanList, overview, engine]);

  useEffect(() => {
    engine?.setTyping(typing || !!card || !!chanList);
  }, [engine, typing, card, chanList]);

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

  const nearName = near === "board" ? "마을 안내판" : near?.sign;

  return (
    <div className="absolute inset-0 select-none">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block touch-none"
        aria-label="GMTOWN 마을"
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
        <div className="gmt-glass flex h-9 items-center rounded-full px-4 max-[520px]:hidden">
          <span className="gmt-brand text-[18px] leading-none">GMTOWN</span>
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
      </div>

      {/* 오른쪽 위: 작은 지도 (누르면 마을 전체) · 당기기 · 밀기 */}
      <div className="absolute top-3 right-3 flex items-start gap-1.5">
        <div className="flex flex-col gap-1.5">
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
              className="gmt-glass flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-[16px] font-bold leading-none"
            >
              {t}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => engine?.setOverview(!overview)}
          aria-label={overview ? "지도 닫기" : "마을 전체 지도"}
          className={`gmt-glass relative cursor-pointer overflow-hidden rounded-xl p-1 ${overview ? "ring-2 ring-[#F2C14E]" : ""}`}
        >
          <canvas
            ref={miniRef}
            className={phone ? "block h-[70px] w-[108px]" : "block h-[104px] w-[160px]"}
          />
          <span className="absolute right-1.5 bottom-1 rounded bg-black/45 px-1 text-[10px] font-bold text-white/90">
            {overview ? "닫기" : !phone ? "지도 M" : "지도"}
          </span>
        </button>
      </div>
      {overview && (
        <div className="gmt-glass gmt-pop pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-[12px]">
          가고 싶은 건물 · 땅을 누르면 거기로 걸어가요
        </div>
      )}

      {/* 왼쪽 아래: 채팅 */}
      <div
        className={`absolute bottom-3 left-3 flex flex-col gap-1.5 ${phone ? "w-[46%] max-w-[340px]" : "w-[340px]"}`}
      >
        {logOpen && log.length > 0 && (
          <div
            className="gmt-glass pointer-events-auto max-h-[150px] overflow-y-auto rounded-xl px-3 py-2 text-[12px] leading-[1.55]"
            onClick={() => setLogOpen(false)}
          >
            {log.slice(-8).map((m, i) => (
              <div key={`${m.at}-${i}`} className="truncate">
                <b className={m.name.startsWith("◦") ? "text-white/60" : "text-[#FFD36B]"}>
                  {m.name}
                </b>{" "}
                <span className="text-white/90">{m.text}</span>
              </div>
            ))}
          </div>
        )}
        <form
          className="gmt-glass pointer-events-auto flex h-10 items-center gap-2 rounded-full pr-1 pl-4"
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
            placeholder={phone ? "말하기" : "Enter 로 말하기"}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/45"
            enterKeyHint="send"
          />
          <button
            type="submit"
            className="h-8 shrink-0 cursor-pointer rounded-full bg-[#F2C14E] px-3 text-[12px] font-bold text-[#1A1408]"
          >
            보내기
          </button>
        </form>
      </div>

      {/* 아래 가운데: 문 앞 */}
      {near && !card && (
        <div
          className={`gmt-pop pointer-events-auto absolute left-1/2 -translate-x-1/2 ${phone ? "bottom-3" : "bottom-6"}`}
          style={phone ? { left: "72%" } : undefined}
        >
          <button
            type="button"
            onClick={() => setCard(near)}
            className="gmt-glass flex cursor-pointer items-center gap-3 rounded-2xl py-2 pr-4 pl-2 text-left"
          >
            <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white/10 text-[22px]">
              {near === "board" ? "📋" : <GameIcon icon={near.icon} />}
            </span>
            <span className="flex flex-col">
              <b className="text-[14px] leading-tight">{nearName}</b>
              <span className="text-[11px] text-white/60">
                {near === "board"
                  ? "마을 둘러보기 · 조작법"
                  : near.href
                    ? "들어가기"
                    : isLot(near)
                      ? "새 게임 준비 중"
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

      {/* 처음 온 사람 도움말 */}
      {help && status === "on" && (
        <div className="gmt-pop absolute top-16 left-1/2 w-[min(92%,460px)] -translate-x-1/2">
          <div className="gmt-glass rounded-2xl px-5 py-4 text-[13px] leading-relaxed">
            <b className="gmt-brand text-[17px]">GMTOWN 에 오신 걸 환영해요</b>
            <p className="mt-1 text-white/85">
              {phone
                ? "왼쪽을 누른 채 끌면 걸어요(끝까지 밀면 뛰어요) · 가고 싶은 곳을 누르면 거기로 가요 · 두 손가락으로 당기고 돌려요(같이 위아래로 밀면 높이)."
                : "WASD · 방향키로 걷고(Shift 를 누르면 뛰어요), 오른쪽 버튼으로 누른 곳으로 가요(멀면 뛰어가요). 왼쪽 버튼으로 끌면 시점이 돌아가고(위아래로 끌면 높이), 휠로 당겨요. M 은 마을 전체 지도."}{" "}
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

      {/* 건물 카드 */}
      {card && <Card near={card} onClose={() => setCard(null)} />}

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
            <div className="gmt-brand text-[22px]">GMTOWN</div>
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

function Card({ near, onClose }: { near: Building | "board"; onClose: () => void }) {
  if (near === "board")
    return (
      <Sheet onClose={onClose}>
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-[30px]">
            📋
          </span>
          <div>
            <div className="gmt-brand text-[22px] leading-tight">마을 안내판</div>
            <div className="text-[12px] text-white/60">GMTOWN 둘러보기</div>
          </div>
        </div>
        <ul className="mt-4 space-y-1.5 text-[13px] leading-relaxed text-white/85">
          <li>
            🏛 게임마다 건물이 하나씩 — 픽셀 게임은 픽셀 건물, 애니 게임은 애니 건물이에요. 광장에서
            길을 따라가면 다 나와요.
          </li>
          <li>🗺 오른쪽 위 작은 지도를 누르면 마을 전체 — 거기서 건물을 누르면 걸어가요.</li>
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
          <b className="text-[#FFD36B]">새 게임 자리</b> — 다음 게임이 나오면 이 빈 터에 그 게임
          화풍의 건물이 들어서요.
        </p>
      ) : (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3 text-[13px] leading-relaxed text-white/85">
          <b className="text-[#FFD36B]">곧 열려요</b>
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
