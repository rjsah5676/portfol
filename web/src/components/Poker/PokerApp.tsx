"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import NickForm from "@/components/Account/NickForm";
import { useAuth } from "@/lib/AuthContext";
import { asset } from "@/lib/poker/assets";
import {
  getSound,
  onSoundChange,
  playBgm,
  refreshBgm,
  setSound,
  type SoundSettings,
} from "@/lib/poker/sfx";
import { fmtShort, type CharId } from "@/lib/poker/rules";
import type { RankRow, Wallet } from "@/lib/poker/types";
import { getRank, roomOpts, subscribeWallet, watchClock } from "@/realtime/poker";
import type { Orient } from "./layout";
import Lobby from "./Lobby";
import Shop, { type ShopTab } from "./Shop";
import { PlayingCard, useSize } from "./parts";
import TableView from "./TableView";

/*
 * ANIME POKER 의 몸통 = 무대(stage). PIXEL FIGHT 처럼 하나의 게임 화면 안에서 로비 → 테이블이 바뀜.
 *  - 무대는 자기 크기를 재서 세로판(폰) / 가로판(PC) 배치를 고름
 *  - 전체화면 버튼: 진짜 전체화면(되는 브라우저) 또는 화면을 꽉 채우는 흉내 전체화면(아이폰 사파리)
 *  - 회원만: 로그인 전 → 소개 + 로그인 / 별명 전 → 별명 정하기 / 회원 → 로비, 주소에 ?t=<테이블> 이 있으면 그 테이블
 */

export function useRank(): RankRow[] | null {
  const [rank, setRank] = useState<RankRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      getRank()
        .then((r) => alive && setRank(r))
        .catch(() => alive && setRank((cur) => cur ?? []));
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return rank;
}

/** 가로 전체화면에서 무대를 그리는 기준 크기 */
const DESIGN = { w: 1280, h: 720 };
const isIOS = () =>
  typeof navigator !== "undefined" &&
  /iP(hone|ad|od)/.test(navigator.userAgent) &&
  !("MSStream" in window);
/** 진짜 전체화면이 되는 기기인지 (아이폰 사파리는 안 됨 → 전체화면 버튼·띠를 아예 안 보임) */
const canFullscreen = () =>
  typeof document !== "undefined" &&
  !!(
    document.fullscreenEnabled ||
    (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled
  );
const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

export default function PokerApp({ rank }: { rank: RankRow[] | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const tableId = params.get("t");
  const { loading, account, profile, login } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [shop, setShop] = useState<ShopTab | "">("");
  const [failed, setFailed] = useState("");
  const [loginError, setLoginError] = useState("");
  const [revived, setRevived] = useState<{ text: string; key: number } | null>(null);
  useEffect(() => {
    if (!revived) return;
    const t = setTimeout(() => setRevived(null), 3200);
    return () => clearTimeout(t);
  }, [revived]);
  const nick = profile?.nick;

  useEffect(() => {
    if (!nick) return;
    watchClock();
    return subscribeWallet(
      (w) => {
        setWallet(w);
        setFailed("");
        if (w?.revived)
          setRevived({
            text: `기본 칩 ${fmtShort(w.revived.amount)}이 지급됐어요 · 오늘 ${w.revived.left}회 남았어요`,
            key: Date.now(),
          });
      },
      (e) => setFailed(e.message)
    );
  }, [nick]);

  // ── 무대 크기 · 전체화면 ──
  const [stageRef, size] = useSize<HTMLDivElement>();
  const rootRef = useRef<HTMLDivElement>(null);
  const [fsReal, setFsReal] = useState(false);
  const [pseudoFs, setPseudoFs] = useState(false);
  const fs = fsReal || pseudoFs;
  const standalone = typeof window !== "undefined" && isStandalone();
  // 전체화면이 안 되는 기기(아이폰 사파리)에서는 전체화면 버튼 · 띠를 아예 안 보임
  const [canFs, setCanFs] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저에서만 알 수 있는 값
    setCanFs(canFullscreen());
  }, []);
  useEffect(() => {
    const on = () => setFsReal(document.fullscreenElement === rootRef.current && !!rootRef.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  // 전체화면(가로 화면): 무대를 평소와 같은 1280×720 으로 그리고 화면에 맞게 통째로 키움 → 배치가 창 모드와 똑같음
  const [scr, setScr] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!fs) return;
    const on = () => setScr({ w: window.innerWidth, h: window.innerHeight });
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [fs]);
  const fit = fs && scr.w > scr.h * 1.2 ? Math.min(scr.w / DESIGN.w, scr.h / DESIGN.h) : 0;
  // 무대 위에 사이트의 떠 있는 메뉴 버튼이 겹치지 않게
  useEffect(() => {
    document.body.classList.add("game-full");
    return () => document.body.classList.remove("game-full");
  }, []);
  // 폰: 들어오면 무대가 사이트 메뉴 바로 아래에 오게 (무대 높이가 화면을 거의 다 쓰므로)
  const stageEl = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = stageEl.current;
    if (!el || window.innerWidth >= 640) return;
    const id = setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
    return () => clearTimeout(id);
  }, [tableId]);
  // 배경음악: 로그인 화면은 타이틀 곡, 로비는 로비 곡, 테이블은 TableView 가 판돈 단계별로 바꿈
  // (브라우저가 소리를 막아서 첫 터치 · 클릭 뒤부터 나옴)
  const onIntro = !loading && (!account || !profile);
  useEffect(() => {
    if (!tableId) playBgm(onIntro ? "bgm-intro" : "bgm-lobby");
  }, [tableId, onIntro]);
  // 포커 페이지를 떠나면 배경음악 끔 (사이트 안에서 다른 페이지로 가도 계속 나오던 것)
  useEffect(() => () => playBgm(null), []);
  const toggleFs = () => {
    const el = rootRef.current;
    if (!el) return;
    if (pseudoFs) return setPseudoFs(false);
    if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {});
    if (typeof el.requestFullscreen === "function")
      el.requestFullscreen({ navigationUI: "hide" }).catch(() => setPseudoFs(true));
    else setPseudoFs(true);
  };
  const o: Orient = size.w > size.h * 1.05 ? "h" : "v";
  const topRight = (
    <>
      <TopBtn label="상점" icon={SHOP_ICON} gold onClick={() => setShop("shop")} />
      <TopBtn label="옷장" icon={CLOSET_ICON} onClick={() => setShop("closet")} />
      <Settings tableId={tableId} />
      {(canFs || fs) && (
        <button
          type="button"
          onClick={toggleFs}
          title={fs ? "전체화면 끝내기" : "전체화면"}
          className="pk-btn pk-btn-ghost flex h-[30px] w-[34px] items-center justify-center"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-[16px] w-[16px]"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
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
      )}
    </>
  );

  const go = (id: string | null) => router.push(id ? `/games/poker/?t=${id}` : "/games/poker/");

  let screen: ReactNode;
  if (loading) screen = <Centered>로그인 상태를 확인하는 중…</Centered>;
  else if (!account || !profile)
    screen = (
      <Intro
        o={o}
        account={!!account}
        loginError={loginError}
        onLogin={() =>
          void login().catch(() => setLoginError("로그인하지 못했어요. 잠시 후 다시 시도해주세요."))
        }
      />
    );
  else if (failed && !wallet) screen = <Centered tone="error">{failed}</Centered>;
  else if (!wallet) screen = <Centered>지갑을 여는 중…</Centered>;
  else if (tableId)
    screen = (
      <TableView
        key={tableId}
        id={tableId}
        uid={account.uid}
        wallet={wallet}
        o={o}
        w={size.w}
        h={size.h}
        onExit={() => go(null)}
        onWallet={setWallet}
        topRight={topRight}
      />
    );
  else
    screen = (
      <Lobby
        wallet={wallet}
        rank={rank}
        myNick={profile.nick}
        o={o}
        w={size.w}
        h={size.h}
        onEnter={go}
        onWallet={setWallet}
        topRight={topRight}
      />
    );

  // 무대 크기: 전체화면이면 화면 전부, 아니면 PC 는 16:9 상자, 폰은 화면 높이에 맞춘 세로 상자
  const outer = pseudoFs
    ? "fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black"
    : fsReal
      ? "flex h-full w-full items-center justify-center overflow-hidden bg-black"
      : "mx-auto w-full max-w-[min(1280px,calc((100dvh-166px)*16/9))] px-0 sm:px-3";
  // (폰: 사이트 머리말 57px + 게임 메뉴 45px + 전체화면 권장 띠 62px 아래부터 화면 끝까지. 띠가 없는 기기(아이폰)는 그만큼 더 크게)
  const showFsBanner = !fs && canFs;
  const stageCls = fit
    ? "flex-none"
    : fs
      ? "h-full w-full"
      : `${showFsBanner ? "h-[calc(100dvh-166px)] scroll-mt-[166px]" : "h-[calc(100dvh-104px)] scroll-mt-[104px]"} min-h-[480px] w-full sm:aspect-video sm:h-auto sm:min-h-0 sm:rounded-2xl sm:border sm:border-white/10`;
  return (
    <div ref={rootRef} className={`pk ${outer}`}>
      {/* 전체화면 권장 — 폰에서만 (PC 는 창 모드로도 충분) */}
      {showFsBanner && (
        <button
          type="button"
          onClick={toggleFs}
          className="mx-3 mb-2 flex h-[54px] w-[calc(100%-24px)] cursor-pointer items-center justify-center gap-2.5 overflow-hidden rounded-xl border border-[#D6AF5C]/50 bg-[linear-gradient(90deg,rgba(214,175,92,0.2),rgba(122,20,32,0.25))] px-3 py-2 font-['Nanum_Gothic',sans-serif] text-[12.5px] text-white/85 shadow-[0_0_24px_-6px_rgba(214,175,92,0.55)] transition-colors hover:border-[#D6AF5C] hover:text-white sm:hidden"
        >
          <span className="rounded-md bg-[#D6AF5C] px-1.5 py-0.5 font-mono text-[13px] font-bold text-[#2a1e05]">
            ⛶
          </span>
          <span className="flex flex-col items-start leading-tight">
            <b className="font-bold text-white">
              전체화면 플레이 권장{" "}
              <span className="font-normal text-white/60">— 가로/세로 지원</span>
            </b>
            <span className="text-[11.5px] text-white/50">누르면 전체화면</span>
          </span>
        </button>
      )}
      <div
        ref={(el) => {
          stageEl.current = el;
          stageRef(el);
        }}
        className={`pk-stage ${stageCls}`}
        style={
          fit
            ? {
                width: DESIGN.w,
                height: DESIGN.h,
                transform: `scale(${fit})`,
                transformOrigin: "center",
              }
            : undefined
        }
        data-o={o}
      >
        {size.w > 0 && screen}
        {shop && wallet && (
          <Shop
            wallet={wallet}
            inGame={!!tableId}
            tab={shop}
            setTab={setShop}
            mobile={o === "v"}
            maxH={size.h - (o === "h" ? 24 : 8)}
            onClose={() => setShop("")}
          />
        )}
        {revived && (
          <div
            key={revived.key}
            role="status"
            className="pk-toast"
            style={{ bottom: o === "h" ? 90 : 120, animationDuration: "3.2s" }}
          >
            {revived.text}
          </div>
        )}
      </div>
      {!fs && !standalone && isIOS() && (
        <p className="mx-3 mt-2 text-center text-[11px] text-white/40 sm:mx-0">
          아이폰은 사파리 공유 → <b className="text-white/60">홈 화면에 추가</b>하면 전체화면 앱처럼
          할 수 있어요.
        </p>
      )}
      {!fs && (
        <p className="mx-3 mt-2 text-center text-[11px] text-white/30 sm:mx-0">
          칩을 다 잃으셨다면 몰래 문의 한번 남겨주세요. 드릴수도?
        </p>
      )}
    </div>
  );
}

/** 머리말 버튼 (상점 · 옷장) */
function TopBtn({
  label,
  icon,
  gold,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  gold?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`pk-btn ${gold ? "pk-btn-gold" : "pk-btn-ghost"} flex h-[30px] items-center gap-[0.3em] px-[0.6em] text-[0.78em]`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-[15px] w-[15px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {icon}
      </svg>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
const SHOP_ICON = (
  <>
    <path d="M5 8h14l-1.2 11.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8z" />
    <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
  </>
);
const CLOSET_ICON = (
  <path d="M12 6a2 2 0 1 1 2 2c-1 0-2 .7-2 1.6V10l8.4 5.6A1.5 1.5 0 0 1 19.6 18H4.4a1.5 1.5 0 0 1-.8-2.4L12 10" />
);

/** 설정 (톱니): 소리 */
function Settings({ tableId }: { tableId: string | null }) {
  const [open, setOpen] = useState(false);
  const [snd, setSnd] = useState<SoundSettings>(() => getSound());
  useEffect(() => onSoundChange(() => setSnd({ ...getSound() })), []);
  // 테이블 안: 방 설정 (열 때마다 지금 값을 받아 옴)
  const [room, setRoom] = useState<{ owner: boolean; quick: boolean; bots: boolean } | null>(null);
  const [roomErr, setRoomErr] = useState("");
  useEffect(() => {
    if (!open || !tableId) return;
    let alive = true;
    setRoomErr("");
    roomOpts(tableId)
      .then((r) => alive && setRoom(r))
      .catch(() => alive && setRoom(null));
    return () => {
      alive = false;
    };
  }, [open, tableId]);
  const setRoomOpt = (set: { quick?: boolean; bots?: boolean }) => {
    if (!tableId || !room?.owner) return;
    setRoom({ ...room, ...set, bots: (set.quick ?? room.quick) && (set.bots ?? room.bots) });
    roomOpts(tableId, set)
      .then(setRoom)
      .catch((e: { message?: string }) => setRoomErr(e?.message ?? "바꾸지 못했어요."));
  };
  const row = (label: string, key: "bgm" | "sfx" | "voice") => {
    const v = Math.round(snd[key] * 100);
    return (
      <label className={`grid gap-[0.15em] ${snd.mute ? "opacity-40" : ""}`}>
        <span className="flex items-baseline justify-between">
          <span className="text-white/85">{label}</span>
          <span className="pk-num text-[0.9em] text-white/55">{v}</span>
        </span>
        <input
          type="range"
          className="pk-range w-full min-w-0"
          min={0}
          max={100}
          step={5}
          value={v}
          disabled={snd.mute}
          onChange={(e) => setSound({ [key]: Number(e.target.value) / 100 })}
          style={{ "--fill": `${v}%`, height: "1.4em" } as CSSProperties}
          aria-label={`${label} 음량`}
        />
      </label>
    );
  };
  return (
    <span className="relative flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="설정"
        className="pk-btn pk-btn-ghost flex h-[30px] w-[34px] items-center justify-center"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-[16px] w-[16px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      </button>
      {open && (
        <div className="pk-frame pk-pop absolute top-[calc(100%+6px)] right-0 z-50 grid w-[15.5em] bg-[rgba(12,13,20,0.97)] max-w-[calc(100vw-24px)] gap-[0.65em] p-[0.75em] text-[0.82em]">
          <div className="flex items-center justify-between">
            <span className="pk-frame-title">소리</span>
            <button
              type="button"
              onClick={() => setSound({ mute: !snd.mute })}
              aria-pressed={!snd.mute}
              className={`pk-btn px-[0.8em] py-[0.2em] text-[0.9em] ${snd.mute ? "pk-btn-ghost" : "pk-btn-call"}`}
            >
              {snd.mute ? "꺼짐" : "켜짐"}
            </button>
          </div>
          {row("배경음악", "bgm")}
          {row("효과음", "sfx")}
          {row("캐릭터 음성", "voice")}
          <div className={`grid gap-[0.3em] ${snd.mute ? "opacity-40" : ""}`}>
            <span className="text-white/85">로비 곡</span>
            <div className="grid grid-cols-3 gap-[0.3em]">
              {(
                [
                  [1, "1번"],
                  [2, "2번"],
                  [0, "전체"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={snd.lobby === v}
                  title={v === 0 ? "들어올 때마다 1번 · 2번 중 하나" : undefined}
                  onClick={() => {
                    setSound({ lobby: v });
                    refreshBgm();
                  }}
                  className="pk-preset min-w-0 py-[0.35em] text-[0.92em]"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {tableId && room && (
            <div className="grid gap-[0.4em] border-t border-white/10 pt-[0.6em]">
              <span className="pk-frame-title">방 설정</span>
              <label
                className={`flex items-center gap-[0.55em] ${room.owner ? "cursor-pointer" : "opacity-60"}`}
              >
                <input
                  type="checkbox"
                  checked={room.quick}
                  disabled={!room.owner}
                  onChange={(e) => setRoomOpt({ quick: e.target.checked })}
                  className="h-[1.05em] w-[1.05em] accent-[#ffc93c]"
                />
                <span className="text-white/85">바로 입장 허용</span>
              </label>
              {room.quick && (
                <label
                  className={`ml-[1.2em] flex items-center gap-[0.55em] ${room.owner ? "cursor-pointer" : "opacity-60"}`}
                >
                  <input
                    type="checkbox"
                    checked={room.bots}
                    disabled={!room.owner}
                    onChange={(e) => setRoomOpt({ bots: e.target.checked })}
                    className="h-[1.05em] w-[1.05em] accent-[#ffc93c]"
                  />
                  <span className="text-white/85">봇 참가 가능</span>
                </label>
              )}
              <p className="text-[0.82em] leading-snug text-white/40">
                {room.owner
                  ? "봇을 끄면 지금 판이 끝나고 봇이 나가요."
                  : "방을 연 사람만 바꿀 수 있어요."}
              </p>
              {roomErr && <p className="text-[0.82em] text-[#ffb3b5]">{roomErr}</p>}
            </div>
          )}
          <p className="border-t border-white/10 pt-[0.5em] text-[0.82em] leading-relaxed text-white/40">
            BETA
          </p>
        </div>
      )}
    </span>
  );
}

function Centered({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0b0c12] text-center">
      <p
        role={tone ? "alert" : undefined}
        className={tone === "error" ? "text-[#ffb3b5]" : "text-white/50"}
      >
        {children}
      </p>
    </div>
  );
}

/** 타이틀 줄에서 캐릭터별 높이 보정 (전신 그림마다 서 있는 높이가 달라서, %) */
const LIFT: Partial<Record<CharId, number>> = {
  jinwoo: -16,
  yeonseo: -13,
  amy: -12,
  taeyang: -10,
  jeongmin: -10,
};

/** 타이틀 테이블 위 소품: x,y = 가로 화면 %, vx,vy = 세로 화면 % (card: null = 뒷면) */
const TABLE_PROPS: {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  card?: number | null;
  chip?: "red" | "gold" | "blue" | "black" | "green";
}[] = [
  { x: 14, y: 80, vx: 10, vy: 76, r: -24, card: 48 },
  { x: 19, y: 86, vx: 18, vy: 82, r: -6, card: 47 },
  { x: 26, y: 78, vx: 8, vy: 90, r: 14, card: null },
  { x: 9, y: 92, vx: 26, vy: 92, r: 0, chip: "red" },
  { x: 31, y: 90, vx: 30, vy: 74, r: 0, chip: "gold" },
  { x: 74, y: 79, vx: 90, vy: 76, r: 18, card: 45 },
  { x: 81, y: 86, vx: 82, vy: 83, r: 32, card: null },
  { x: 87, y: 78, vx: 92, vy: 90, r: -12, card: 44 },
  { x: 70, y: 91, vx: 72, vy: 92, r: 0, chip: "blue" },
  { x: 92, y: 92, vx: 70, vy: 75, r: 0, chip: "black" },
];

/** 로그인 전 · 별명 전: 타이틀 화면 — 테이블 뒤에 5명이 둘러앉은 장면, 위 로고, 테이블 위 시작 칸 */
function Intro({
  o,
  account,
  loginError,
  onLogin,
}: {
  o: Orient;
  account: boolean;
  loginError: string;
  onLogin: () => void;
}) {
  const h = o === "h";
  // 가운데 진우, 바로 옆 여캐 둘, 바깥쪽 남캐 둘
  const order: CharId[] = ["taeyang", "yeonseo", "jinwoo", "amy", "jeongmin"];
  // 떠다니는 카드 · 칩 (위치 %, 크기, 지연)
  // 떠다니는 카드 · 칩 (card: 카드 번호, null = 뒷면 / chip: 칩 색)
  const floats: {
    x: number;
    y: number;
    s: number;
    d: number;
    r: number;
    card?: number | null;
    chip?: "red" | "gold" | "blue";
  }[] = [
    { x: 6, y: 8, s: 1, d: 0, r: -18, card: 50 }, // A♦
    { x: 22, y: 20, s: 0.7, d: 2.1, r: 0, chip: "red" },
    { x: 3, y: 30, s: 0.75, d: 2.6, r: 22, card: null },
    { x: 86, y: 20, s: 0.95, d: 1.2, r: 16, card: 44 }, // K♠
    { x: 74, y: 30, s: 0.75, d: 0.6, r: 0, chip: "gold" },
    { x: 93, y: 38, s: 0.6, d: 1.7, r: 0, chip: "blue" },
  ];

  return (
    <div className="pk-intro absolute inset-0 overflow-hidden">
      <div
        className="pk-bg"
        style={{
          backgroundImage: `url(${asset.room(3, o)})`,
          filter: "brightness(0.55) saturate(1.1)",
        }}
      />
      {/* 무대 조명 */}
      <div className="pk-intro-spot absolute inset-0" />
      {/* 떠다니는 카드 · 칩 */}
      {floats.map((f, i) => (
        <span
          key={i}
          className="pk-float pointer-events-none absolute z-[6]"
          style={
            {
              left: `${f.x}%`,
              top: `${f.y}%`,
              animationDelay: `${f.d}s`,
              "--r": `${f.r}deg`,
            } as CSSProperties
          }
        >
          {f.chip ? (
            <img
              src={asset.chip(f.chip, "top")}
              alt=""
              draggable={false}
              style={{ width: (h ? 64 : 42) * f.s, height: (h ? 64 : 42) * f.s }}
            />
          ) : (
            <PlayingCard card={f.card ?? null} w={Math.round((h ? 62 : 40) * f.s)} tier={3} />
          )}
        </span>
      ))}
      {/* 캐릭터 줄 (가운데가 앞) — 아래는 테이블에 가려짐 */}
      <div
        className="pointer-events-none absolute inset-x-0 flex items-end justify-center"
        style={{ bottom: h ? "-41%" : "8%" }}
      >
        {order.map((c, i) => (
          <img
            key={c}
            src={asset.full(c)}
            alt=""
            draggable={false}
            className="pk-intro-char w-auto max-w-none"
            style={{
              // 키 기준 (그림마다 가로세로 비율이 달라서 폭으로 맞추면 마른 그림이 너무 크게 나옴)
              height: h ? "58cqw" : i === 2 ? "92cqw" : "80cqw",
              // 폰: 옆 사람은 조금 작게 · 덜 겹치게 (가운데로 몰려 보이던 것)
              marginLeft: i ? (h ? "-3%" : "-12%") : 0,
              zIndex: 5 - Math.abs(i - 2),
              transform: `translateY(${(LIFT[c] ?? 0) * (h ? 1 : 0.6) - Math.abs(i - 2) * (h ? 3 : 7)}%) scale(${(c === "jinwoo" ? 1.02 : 1) - Math.abs(i - 2) * (h ? 0.07 : 0.03)})`,
              transformOrigin: "bottom",
              filter: `drop-shadow(0 0 14px rgba(0,0,0,0.8)) brightness(${1 - Math.abs(i - 2) * 0.1})`,
              animationDelay: `${0.1 + Math.abs(i - 2) * 0.12}s`,
            }}
          />
        ))}
      </div>
      {/* 앞쪽 테이블 (캐릭터가 테이블 뒤에 둘러선 느낌) */}
      {}
      <img
        src={asset.table(1, "h")}
        alt=""
        draggable={false}
        className="pointer-events-none absolute left-1/2 z-10 max-w-none -translate-x-1/2"
        style={{ width: h ? "118%" : "230%", bottom: h ? "-44%" : "-12%" }}
      />
      <div
        className="absolute inset-0 z-10"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.65), rgba(0,0,0,0) 30%, rgba(0,0,0,0) 70%, rgba(0,0,0,0.6))",
        }}
      />
      {/* 테이블 위에 흩어진 카드 · 칩 */}
      <div className="pointer-events-none absolute inset-0 z-[11]">
        {TABLE_PROPS.map((p, i) => (
          <span
            key={i}
            className="absolute"
            style={{
              left: `${h ? p.x : p.vx}%`,
              top: `${h ? p.y : p.vy}%`,
              transform: `translate(-50%, -50%) rotate(${p.r}deg)`,
              filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.55))",
            }}
          >
            {p.card !== undefined ? (
              <PlayingCard card={p.card} w={h ? 56 : 40} tier={3} />
            ) : (
              <img
                src={asset.chip(p.chip!, "stack")}
                alt=""
                draggable={false}
                style={{ width: h ? 64 : 44, height: h ? 64 : 44 }}
              />
            )}
          </span>
        ))}
      </div>
      {/* 로고 + 한 줄 소개 */}
      <div
        className="absolute left-1/2 z-20 flex -translate-x-1/2 flex-col items-center"
        style={{ top: h ? "3%" : "5%", width: h ? "30%" : "84%" }}
      >
        {}
        <img
          src={asset.logo}
          alt="ANIME POKER"
          draggable={false}
          className="pk-intro-logo w-full drop-shadow-[0_8px_18px_rgba(0,0,0,0.85)]"
        />
      </div>
      {/* 게임 종류 (오른쪽 위) */}
      <div
        className={`absolute z-20 flex gap-[0.4em] ${h ? "top-[3%] right-[2.5%] flex-col items-end" : "top-[27%] left-1/2 -translate-x-1/2 items-center"}`}
        style={{ fontSize: h ? "1.25em" : "0.95em" }}
      >
        <span className="pk-intro-tag whitespace-nowrap">TEXAS HOLD&apos;EM</span>
        <span className="pk-intro-tag whitespace-nowrap">SEVEN POKER</span>
        <span className="rounded-[4px] bg-[var(--pk-danger)] px-[0.5em] text-[0.7em] leading-[1.7em] font-extrabold tracking-wider">
          BETA
        </span>
      </div>
      {/* 시작 칸 (테이블 위) */}
      <div
        className="absolute left-1/2 z-20 w-[min(23em,88%)] -translate-x-1/2"
        style={{ bottom: h ? "7%" : "6%" }}
      >
        <div className="pk-intro-panel text-center">
          {!account ? (
            <>
              <p className="pk-title mb-[0.5em] text-[1.4em] text-white">
                오늘 테이블의 주인공은 너야
              </p>
              <button
                type="button"
                onClick={onLogin}
                className="pk-btn pk-btn-gold pk-shine flex w-full items-center justify-center gap-[0.5em] py-[0.75em] text-[1em]"
              >
                <svg viewBox="0 0 24 24" className="h-[1.1em] w-[1.1em]" aria-hidden>
                  <path
                    fill="#4285F4"
                    d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"
                  />
                </svg>
                Google로 시작하기
              </button>
              <p className="mt-[0.5em] text-[0.68em] leading-relaxed text-white/50">
                실제 돈이 오가지 않는 게임이에요.
              </p>
              {loginError && (
                <p className="mt-[0.3em] text-[0.72em] text-[#ffb3b5]">{loginError}</p>
              )}
            </>
          ) : (
            <>
              <p className="mb-[0.5em] text-[0.82em] text-white/85">
                별명을 정하면 시작할 수 있어요.
              </p>
              <NickForm submitLabel="시작하기" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
