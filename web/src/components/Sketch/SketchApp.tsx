"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useChessUser } from "@/components/Chess/useChessUser";
import { useAuth } from "@/lib/AuthContext";
import { playBgm, playSfx } from "@/lib/sketch/sfx";
import { watchServerOffset } from "@/realtime/sketch";
import { Doodles, Logo, Mascot } from "./Art";
import SketchLobby from "./SketchLobby";
import SketchRoomGate from "./SketchRoomGate";
import { artUrl, hasArt } from "@/lib/sketch/assets";
import { DESIGN, FsButton, SoundButton, StageCtx, useStage, type Orient } from "./stage";

/*
 * 스케치 퀴즈 = 하나의 게임 화면(무대) 안에서 타이틀 → 로비 → 방이 바뀜 (ANIME POKER · PIXEL FIGHT 처럼).
 *  - 가로판(PC): 1280×720 으로 그리고 무대 크기에 맞게 통째로 줄이고 키움
 *  - 세로판(폰): 화면 높이를 꽉 채우는 세로 배치
 *  - 방은 ?room=ID(&k=초대키) 쿼리로 구분 — 초대 링크로 오면 타이틀 없이 바로 입장
 */

const SEEN_TITLE = "sketch_title_seen";

const canFullscreen = () =>
  typeof document !== "undefined" &&
  !!(
    document.fullscreenEnabled ||
    (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled
  );

/** 무대 상자 크기 */
function useBox() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height })
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size] as const;
}

export default function SketchApp() {
  const router = useRouter();
  const params = useSearchParams();
  const roomId = params.get("room");
  const invite = params.get("k");
  const { uid, nick, setNick, nickLoaded, error } = useChessUser();
  const { profile } = useAuth();

  useEffect(() => watchServerOffset(), []);

  // 타이틀은 처음 한 번 (이번 탭에서 로비에 들어간 적 있으면 생략)
  const [titleDone, setTitleDone] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저에서만 아는 값
      if (sessionStorage.getItem(SEEN_TITLE)) setTitleDone(true);
    } catch {}
  }, []);
  const finishTitle = () => {
    setTitleDone(true);
    try {
      sessionStorage.setItem(SEEN_TITLE, "1");
    } catch {}
  };

  // ── 무대 · 전체화면 ──
  const rootRef = useRef<HTMLDivElement>(null);
  const [boxRef, box] = useBox();
  const boxEl = useRef<HTMLDivElement | null>(null);
  const [fsReal, setFsReal] = useState(false);
  const [pseudoFs, setPseudoFs] = useState(false);
  const fs = fsReal || pseudoFs;
  const [canFs, setCanFs] = useState(false);
  const fsByUs = useRef(false); // 우리 버튼으로 끈 건지
  const typedAt = useRef(0); // 마지막으로 입력칸을 누른 때
  useEffect(() => {
    setCanFs(canFullscreen()); // eslint-disable-line react-hooks/set-state-in-effect -- 브라우저에서만 아는 값
    const on = () => {
      const root = rootRef.current;
      const real = !!root && document.fullscreenElement === root;
      setFsReal(real);
      if (real || !root) return;
      // 폰: 채팅 치려고 키보드를 올리면 브라우저가 전체화면을 풀어 버림 → 흉내 전체화면으로 이어감
      const a = document.activeElement;
      const typing =
        (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) && root.contains(a);
      if (!fsByUs.current && (typing || Date.now() - typedAt.current < 1500)) setPseudoFs(true);
      fsByUs.current = false;
    };
    const focusIn = (e: FocusEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)
        typedAt.current = Date.now();
    };
    document.addEventListener("fullscreenchange", on);
    document.addEventListener("focusin", focusIn);
    return () => {
      document.removeEventListener("fullscreenchange", on);
      document.removeEventListener("focusin", focusIn);
    };
  }, []);
  // 전체화면 동안엔 뒤 페이지가 같이 밀리지 않게 잠그고,
  // 흉내 전체화면은 키보드가 올라와도 보이는 영역(visualViewport)에 딱 맞춤
  const [vv, setVv] = useState<{ top: number; h: number } | null>(null);
  useEffect(() => {
    if (!fs) return;
    const html = document.documentElement;
    html.classList.add("sk-lock");
    const v = window.visualViewport;
    const fit = () => {
      if (!v) return;
      setVv({ top: v.offsetTop, h: v.height });
      // iOS 가 입력칸을 보이게 하려고 페이지를 밀어 올린 것 되돌리기
      if (!document.activeElement?.matches("input, textarea") && window.scrollY)
        window.scrollTo(0, 0);
    };
    if (pseudoFs && v) {
      fit();
      v.addEventListener("resize", fit);
      v.addEventListener("scroll", fit);
    }
    return () => {
      html.classList.remove("sk-lock");
      v?.removeEventListener("resize", fit);
      v?.removeEventListener("scroll", fit);
      setVv(null);
    };
  }, [fs, pseudoFs]);
  // 흉내 전체화면은 Esc 로도 끝냄
  useEffect(() => {
    if (!pseudoFs) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setPseudoFs(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [pseudoFs]);
  const toggleFs = () => {
    const el = rootRef.current;
    if (!el) return;
    if (pseudoFs) return setPseudoFs(false);
    if (document.fullscreenElement) {
      fsByUs.current = true;
      return void document.exitFullscreen().catch(() => {});
    }
    if (typeof el.requestFullscreen === "function")
      el.requestFullscreen({ navigationUI: "hide" }).catch(() => setPseudoFs(true));
    else setPseudoFs(true);
  };
  useEffect(() => {
    document.body.classList.add("game-full");
    return () => {
      document.body.classList.remove("game-full");
      playBgm(null);
    };
  }, []);
  // 폰: 들어오면 무대가 사이트 메뉴 바로 아래에 오게
  useEffect(() => {
    const el = boxEl.current;
    if (!el || window.innerWidth >= 640) return;
    const id = setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
    return () => clearTimeout(id);
  }, [roomId]);

  // 세로판: 좁은 화면이거나 세로로 긴 태블릿
  const o: Orient = box.w > 0 && (box.w < 640 || (box.w < 900 && box.h > box.w)) ? "v" : "h";
  const scale = o === "h" && box.w ? Math.min(box.w / DESIGN.w, box.h / DESIGN.h) : 1;

  const go = (id: string | null) => {
    playSfx(id ? "sfx-open" : "sfx-close");
    router.push(id ? `/games/sketch/?room=${id}` : "/games/sketch/");
  };

  let screen: ReactNode;
  if (error) screen = <Center>{error}</Center>;
  else if (!uid || !nickLoaded) screen = <Center>접속 중…</Center>;
  else if (!nick || (!titleDone && !roomId))
    screen = (
      <Title
        nick={nick}
        member={!!profile}
        onStart={(n) => {
          if (!profile && n !== nick) setNick(n);
          finishTitle();
        }}
      />
    );
  else if (roomId)
    screen = (
      <SketchRoomGate
        key={roomId}
        roomId={roomId}
        invite={invite}
        uid={uid}
        nick={nick}
        onExit={() => go(null)}
      />
    );
  else
    screen = (
      <SketchLobby
        uid={uid}
        nick={nick}
        member={!!profile}
        onNick={(n) => setNick(n)}
        onEnter={go}
        onTitle={() => {
          try {
            sessionStorage.removeItem(SEEN_TITLE);
          } catch {}
          setTitleDone(false);
        }}
      />
    );

  // 무대 상자: 전체화면이면 화면 전부 / PC 는 16:9 / 폰은 화면 높이에 맞춘 세로 상자
  const outer = pseudoFs
    ? "fixed inset-0 z-[100] flex items-center justify-center bg-[#2B2D42]"
    : fsReal
      ? "flex h-full w-full items-center justify-center bg-[#2B2D42]"
      : "mx-auto w-full max-w-[min(1280px,calc((100dvh-176px)*16/9))] px-0 pb-10 sm:px-3";
  // (폰: 사이트 머리말 57px + 게임 메뉴 45px + 전체화면 띠 52px 아래부터 화면 끝까지)
  const boxCls = fs
    ? "h-full w-full"
    : "h-[calc(100dvh-156px)] min-h-[500px] w-full scroll-mt-[156px] sm:aspect-video sm:h-auto sm:min-h-0 sm:scroll-mt-[104px]";

  return (
    <StageCtx.Provider value={{ o, fs, canFs, toggleFs }}>
      <div
        ref={rootRef}
        className={`sk ${outer}`}
        style={pseudoFs && vv ? { top: vv.top, height: vv.h, bottom: "auto" } : undefined}
      >
        {/* 전체화면 띠 (다른 게임들처럼 무대 위에) */}
        {!fs && (
          <button
            type="button"
            onClick={() => {
              playSfx("sfx-open");
              toggleFs();
            }}
            className="group mx-2 mb-2 flex h-[44px] w-[calc(100%-16px)] cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#FF6B6B]/50 bg-[linear-gradient(90deg,rgba(255,107,107,0.2),rgba(255,201,60,0.18))] px-3 font-['Nanum_Gothic',sans-serif] text-[13px] text-white/85 shadow-[0_0_24px_-6px_rgba(255,107,107,0.55)] transition-colors hover:border-[#FF6B6B] hover:text-white sm:mx-0 sm:mb-3 sm:w-full"
          >
            <span className="rounded-md bg-[#FF6B6B] px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">
              ⛶
            </span>
            <b className="shrink-0 font-bold text-white">전체화면 플레이 가능</b>
            <span className="hidden truncate text-white/55 sm:inline">
              — 여기를 누르면 전체화면으로 (게임 안 오른쪽 위 버튼으로도 켜고 끌 수 있어요)
            </span>
            <span className="truncate text-white/55 sm:hidden">— 화면을 꽉 채워 더 크게</span>
          </button>
        )}
        <div
          ref={(el) => {
            boxEl.current = el;
            boxRef(el);
          }}
          className={`relative ${boxCls}`}
        >
          {box.w > 0 &&
            (o === "h" ? (
              <div
                className="sk-stage sk-rings absolute top-1/2 left-1/2 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)]"
                data-o="h"
                style={{
                  width: DESIGN.w,
                  height: DESIGN.h,
                  transform: `translate(-50%,-50%) scale(${scale})`,
                }}
              >
                {screen}
              </div>
            ) : (
              <div className="sk-stage absolute inset-0 sm:rounded-2xl" data-o="v">
                {screen}
              </div>
            ))}
        </div>
      </div>
    </StageCtx.Provider>
  );
}

function Center({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <Mascot pose="think" size={110} />
      <p className="sk-hand text-[22px] text-[var(--ink2)]">{children}</p>
    </div>
  );
}

// ───────────── 타이틀 ─────────────

const TITLE_DOODLES: [number, number, number, number][] = [
  [6, 10, 54, -12],
  [86, 8, 48, 10],
  [12, 70, 46, 8],
  [80, 66, 60, -6],
  [30, 6, 34, 14],
  [64, 84, 40, -10],
  [46, 88, 36, 4],
  [92, 38, 38, 18],
  [3, 42, 40, -4],
  [70, 20, 30, 0],
];

function Title({
  nick,
  member,
  onStart,
}: {
  nick: string;
  member: boolean;
  onStart: (nick: string) => void;
}) {
  const { o } = useStage();
  const key = o === "v" ? "key-v" : "key-h";
  const [name, setName] = useState(nick);
  const [shake, setShake] = useState(0);
  useEffect(() => playBgm("bgm-title"), []);
  const start = () => {
    const n = name.trim();
    if (!n) {
      playSfx("sfx-error");
      setShake((v) => v + 1);
      return;
    }
    playSfx("jingle-start");
    onStart(n);
  };
  const STEPS = [
    ["🎨", "한 명이 제시어를 그림"],
    ["💬", "나머지는 채팅으로 맞히기"],
    ["⚡", "빨리 맞힐수록 높은 점수"],
  ];
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-5 px-5 py-6">
      {hasArt(key) ? (
        // 키아트: 위쪽은 로고 · 아래는 이름 칸이 올라가니 가운데를 살짝 밝게 덮음
        <div className="absolute inset-0">
          <img src={artUrl(key)} alt="" className="h-full w-full object-cover" draggable={false} />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,249,236,0.55),rgba(255,249,236,0.1)_70%)]" />
        </div>
      ) : (
        <Doodles items={TITLE_DOODLES} />
      )}
      <div className="relative flex items-end gap-3 sk-rise">
        <Mascot pose="wave" size={150} className="hidden sm:inline-block" />
        <Logo size={1.25} />
        <Mascot
          pose="draw"
          size={120}
          className="hidden -scale-x-100 sm:inline-block"
          bob={false}
        />
      </div>
      <p
        className="sk-hand relative text-center text-[22px] text-[var(--ink2)] sk-rise"
        style={{ animationDelay: "0.1s" }}
      >
        그리고, 맞히고, 웃고! 최대 8명 실시간 그림 퀴즈
      </p>
      <div
        className="relative flex flex-wrap justify-center gap-2 sk-rise"
        style={{ animationDelay: "0.18s" }}
      >
        {STEPS.map(([e, t], i) => (
          <span
            key={t}
            className="sk-note px-3 py-1.5 text-[13.5px] font-bold"
            style={{ rotate: `${[-2, 1.5, -1][i]}deg` }}
          >
            {e} {t}
          </span>
        ))}
      </div>
      <div
        key={shake}
        className={`sk-card relative mt-2 flex w-full max-w-[420px] flex-col gap-3 p-5 sk-rise ${shake ? "sk-shake" : ""}`}
        style={{ animationDelay: "0.25s" }}
      >
        <span className="sk-tape tl" />
        <span className="sk-tape tr" />
        {member ? (
          <p className="sk-hand text-center text-[22px]">
            <b className="text-[var(--coral)]">{nick}</b> 님, 어서 와요!
          </p>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className="sk-hand text-[20px]">내 이름</span>
            <input
              autoFocus
              value={name}
              maxLength={10}
              placeholder="10글자까지"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && start()}
              className="sk-input text-center text-[18px]"
            />
          </label>
        )}
        <button type="button" onClick={start} className="sk-btn sk-btn-coral py-3 text-[26px]">
          시작하기 ✏️
        </button>
        {!member && (
          <p className="text-center text-[11.5px] text-[var(--ink3)]">
            로그인하면 회원 별명으로 플레이해요
          </p>
        )}
      </div>
      <div className="absolute top-4 right-4 flex gap-2">
        <SoundButton />
        <FsButton />
      </div>
    </div>
  );
}
