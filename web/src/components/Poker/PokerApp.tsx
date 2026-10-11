"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import NickForm from "@/components/Account/NickForm";
import { useAuth } from "@/lib/AuthContext";
import DevPanel from "./DevPanel";
import Mailbox from "./Mailbox";
import { asset } from "@/lib/poker/assets";
import {
  getSound,
  onSoundChange,
  playBgm,
  playVoice,
  refreshBgm,
  setSound,
  type SoundSettings,
} from "@/lib/poker/sfx";
import { fmtShort, lookOf } from "@/lib/poker/rules";
import type { RankRow, Wallet } from "@/lib/poker/types";
import { getRank, roomOpts, subscribeWallet, watchClock } from "@/realtime/poker";
import type { Orient } from "./layout";
import Lobby from "./Lobby";
import Shop, { type ShopTab } from "./Shop";
import { useSize } from "./parts";
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
  const { loading, account, profile, login, admin } = useAuth();
  // 관리자 전용 개발자 창 (테스트 방 · 음성 · 효과음)
  const [devOpen, setDevOpen] = useState(false);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [shop, setShop] = useState<ShopTab | "">("");
  const [failed, setFailed] = useState("");
  const [loginError, setLoginError] = useState("");
  const [revived, setRevived] = useState<{ text: string; key: number } | null>(null);
  // 우편함 · 오늘 첫 접속 출석 보상 안내
  const [mailOpen, setMailOpen] = useState(false);
  const [attendNote, setAttendNote] = useState<{ text: string; key: number } | null>(null);

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
        if (w?.attended)
          setAttendNote({
            text: `출석 보상 칩 ${fmtShort(w.attended)}이 우편함에 도착했어요 · 우편함에서 받아 주세요`,
            key: Date.now(),
          });
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
  // 폰에서 뒤로가기가 전체화면만 풀어 버리면(안드로이드 크롬) 방 안에서는 나가기 버튼으로 (TableView 가 "pk-back" 을 받음)
  const selfExit = useRef(false);
  const inTable = useRef(false);
  useEffect(() => {
    inTable.current = !!tableId;
  }, [tableId]);
  useEffect(() => {
    const on = () => {
      const now = document.fullscreenElement === rootRef.current && !!rootRef.current;
      if (!now && !selfExit.current && inTable.current && matchMedia("(pointer: coarse)").matches) {
        // 게임방에서 폰 뒤로가기: 전체화면이 풀린 채 끝나지 않게 — 화면은 계속 덮어 그리고(가짜 전체화면) 나가기로 처리,
        // 다음에 화면을 한 번 누르면 진짜 전체화면으로 되돌림 (전체화면은 터치가 있어야 다시 켤 수 있음)
        setPseudoFs(true);
        const el = rootRef.current;
        const again = () => {
          if (!el || document.fullscreenElement) return;
          el.requestFullscreen?.({ navigationUI: "hide" }).then(
            () => setPseudoFs(false),
            () => {}
          );
        };
        el?.addEventListener("pointerup", again, { once: true });
        window.dispatchEvent(new Event("pk-back"));
      }
      selfExit.current = false;
      setFsReal(now);
    };
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  // 전체화면(가로 화면): 무대를 평소와 같은 1280×720 으로 그리고 화면에 맞게 통째로 키움 → 배치가 창 모드와 똑같음
  const [scr, setScr] = useState({ w: 0, h: 0, touch: false });
  useEffect(() => {
    const on = () =>
      setScr({ w: window.innerWidth, h: window.innerHeight, touch: matchMedia("(pointer: coarse)").matches });
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  // 폰을 눕혀서(가로) 전체화면 없이 볼 때: 사이트 메뉴 밑 16:9 상자는 손바닥만 해지므로 화면을 덮어 전체화면처럼 그림 (세로로 돌리면 원래대로)
  // 폰은 가로 전용: 가로면 화면을 덮어 그리고, 세로면 "가로로 돌려 주세요"
  const phone = scr.touch && Math.min(scr.w, scr.h) < 600;
  const land = scr.w > scr.h * 1.2;
  const shortLand = !fs && phone && land;
  // 폰 가로는 1280×720 을 통째로 줄이면 글씨가 너무 작아서, 높이 540 짜리 무대(폭은 화면 비율대로)로 그려 키움
  const D = phone && land ? { w: Math.round(Math.min(1280, Math.max(960, (540 * scr.w) / scr.h))), h: 540 } : DESIGN;
  const fit = (fs || shortLand) && land ? Math.min(scr.w / D.w, scr.h / D.h) : 0;
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
  // 페이지에 들어와 로비가 처음 뜨면 내 캐릭터가 인사 (소리는 브라우저가 막으면 첫 터치 · 클릭 때 나옴)
  const greeted = useRef(false);
  // 폰에서 "전체화면으로 플레이해 주세요" · "가로로 돌려 주세요" 안내가 덮고 있는 동안은 인사 안 함 (로비가 보일 때 함)
  const gated = phone && ((!fs && canFs && !standalone) || !land);
  useEffect(() => {
    if (greeted.current || onIntro || tableId || !wallet || gated) return;
    const look = lookOf(wallet.char, wallet.wear);
    const say = () => {
      if (greeted.current) return;
      greeted.current = true;
      playVoice(look, "hello");
    };
    // 아직 페이지를 한 번도 누르지 않았으면(소리가 막힌 상태) 바로 틀지 않고 포커 화면을 처음 누를 때 —
    // 바로 틀어 두면 소리가 풀리는 순간(예: 사이트 메뉴를 눌러 다른 페이지로 갈 때) 뒤늦게 인사가 나왔음
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (!ua || ua.hasBeenActive) return say();
    const el = rootRef.current;
    if (!el) return;
    el.addEventListener("pointerdown", say, { once: true });
    window.addEventListener("keydown", say, { once: true });
    return () => {
      el.removeEventListener("pointerdown", say);
      window.removeEventListener("keydown", say);
    };
  }, [onIntro, tableId, wallet, gated]);
  // 출석 안내: 폰 전체화면 안내에 가려 안 보인 채 지나가지 않게, 로비가 보일 때부터 5초
  useEffect(() => {
    if (!attendNote || gated) return;
    const t = setTimeout(() => setAttendNote(null), 5000);
    return () => clearTimeout(t);
  }, [attendNote, gated]);
  // 포커 페이지를 떠나면 배경음악 끔 (사이트 안에서 다른 페이지로 가도 계속 나오던 것)
  useEffect(() => () => playBgm(null), []);
  const toggleFs = () => {
    const el = rootRef.current;
    if (!el) return;
    if (pseudoFs) return setPseudoFs(false);
    if (document.fullscreenElement) {
      selfExit.current = true;
      return void document.exitFullscreen().catch(() => {});
    }
    // 폰: 전체화면이 되면 가로로 고정 (안드로이드 크롬 등 되는 기기만 — 안 되면 "가로로 돌려 주세요" 안내)
    const lockLand = () => {
      if (!matchMedia("(pointer: coarse)").matches) return;
      const o = window.screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      void o?.lock?.("landscape").catch(() => {});
    };
    if (typeof el.requestFullscreen === "function")
      el.requestFullscreen({ navigationUI: "hide" }).then(lockLand, () => setPseudoFs(true));
    else setPseudoFs(true);
  };
  const o: Orient = size.w > size.h * 1.05 ? "h" : "v";
  /** 위 오른쪽 버튼들. exit = 게임방의 나가기 버튼 (설정 바로 왼쪽에 들어감) */
  const topRightFor = (exit?: ReactNode) => (
    <>
      {admin && <TopBtn label="테스트" icon={DEV_ICON} onClick={() => setDevOpen(true)} />}
      {/* 게임방 안에서는 상점 없이 옷장(지금 캐릭터 스킨 갈아입기)만 */}
      {!tableId && <TopBtn label="상점" icon={SHOP_ICON} gold onClick={() => setShop("shop")} />}
      <TopBtn label="옷장" icon={CLOSET_ICON} onClick={() => setShop("closet")} />
      {wallet && !tableId && (
        <button
          type="button"
          onClick={() => setMailOpen(true)}
          title="우편함"
          className={`pk-btn pk-btn-ghost relative flex h-[30px] items-center gap-[0.3em] px-[0.6em] text-[0.78em] ${wallet.mail ? "pk-mail-new" : ""}`}
        >
          <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
          </svg>
          <span className="hidden sm:inline">우편함</span>
          {wallet.mail > 0 && <span className="pk-mail-badge">{wallet.mail}</span>}
        </button>
      )}
      {exit}
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
        topRight={topRightFor}
        fs={fs}
      />
    );
  else
    screen = (
      <Lobby
        wallet={wallet}
        rank={rank}
        myNick={profile.nick}
        w={size.w}
        h={size.h}
        onEnter={go}
        onWallet={setWallet}
        onShop={setShop}
        topRight={topRightFor()}
      />
    );

  // 무대 크기: 전체화면이면 화면 전부, 아니면 PC 는 16:9 상자, 폰은 화면 높이에 맞춘 세로 상자
  const outer =
    pseudoFs || shortLand
      ? "fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black"
      : fsReal
        ? "flex h-full w-full items-center justify-center overflow-hidden bg-black"
        : "mx-auto w-full max-w-[min(1280px,calc((100dvh-166px)*16/9))] px-0 sm:px-3";
  // (폰: 사이트 머리말 57px + 게임 메뉴 45px + 전체화면 권장 띠 62px 아래부터 화면 끝까지. 띠가 없는 기기(아이폰)는 그만큼 더 크게)
  // 폰 로비: 전체화면이 아니면 로비를 가리고 전체화면부터 (전체화면이 안 되는 아이폰 · 홈 화면 앱은 제외)
  const ready = !!wallet && !!account && !!profile;
  const fsGate = !fs && canFs && !standalone && phone && ready;
  // 전체화면인데(또는 전체화면이 안 되는 기기에서) 세로로 들고 있음
  const rotateGate = !fsGate && phone && !land && ready;
  const showFsBanner = !fs && canFs && !shortLand && !fsGate;
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
                width: D.w,
                height: D.h,
                transform: `scale(${fit})`,
                fontSize: 15, // 무대 글씨 크기는 바깥 크기로 재는데, 통째로 줄인 무대는 PC 창(1280)과 같아야 하므로 고정
                transformOrigin: "center",
              }
            : undefined
        }
        data-o={o}
      >
        {size.w > 0 && screen}
        {fsGate && (
          <div className="pk-fsgate absolute inset-0 z-[60] flex flex-col items-center justify-center gap-[1.1em] overflow-hidden bg-black px-6 pt-[18%] text-center">
            <GateBg />
            <p className="relative font-['Black_Han_Sans',sans-serif] text-[1.6em] leading-tight text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
              전체화면으로 플레이해 주세요
            </p>
            <p className="relative text-[0.95em] text-white/75 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">폰은 가로 화면으로 쳐요 · 누르면 가로로 돌아가요</p>
            <button
              type="button"
              onClick={toggleFs}
              className="pk-btn pk-btn-gold pk-fsgate-btn relative flex items-center gap-[0.5em] px-[2em] py-[0.95em] text-[1.3em]"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-[1.1em] w-[1.1em]"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </svg>
              전체화면으로 시작
            </button>
          </div>
        )}
        {rotateGate && (
          <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-[1em] bg-black/85 px-6 text-center backdrop-blur-[3px]">
            <svg viewBox="0 0 24 24" className="h-[3.2em] w-[3.2em] text-[#ffd84a]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="7" y="2.5" width="10" height="19" rx="2" />
              <path d="M3 9a9 9 0 0 1 4-5M21 15a9 9 0 0 1-4 5" />
            </svg>
            <p className="font-['Black_Han_Sans',sans-serif] text-[1.5em] leading-tight text-white">폰을 가로로 돌려 주세요</p>
            <p className="text-[0.95em] text-white/60">폰에서는 가로 화면만 지원해요</p>
          </div>
        )}
        {shop && wallet && (
          <Shop
            wallet={wallet}
            inGame={!!tableId}
            tab={tableId ? "closet" : shop}
            setTab={setShop}
            mobile={o === "v"}
            maxH={size.h - (o === "h" ? 24 : 8)}
            onClose={() => setShop("")}
          />
        )}
        {admin && devOpen && (
          <DevPanel
            mobile={o === "v"}
            maxH={size.h - (o === "h" ? 24 : 8)}
            onClose={() => setDevOpen(false)}
            onEnter={(id) => {
              setDevOpen(false);
              go(id);
            }}
          />
        )}
        {mailOpen && wallet && (
          <Mailbox
            mobile={o === "v"}
            maxH={size.h - (o === "h" ? 24 : 8)}
            onClose={() => setMailOpen(false)}
            onWallet={setWallet}
          />
        )}
        {attendNote && !gated && (
          <button
            type="button"
            key={attendNote.key}
            className="pk-toast pk-attend-toast"
            style={{ top: 52, bottom: "auto", animationDuration: "5s" }}
            onClick={() => (setAttendNote(null), setMailOpen(true))}
          >
            🎁 {attendNote.text}
          </button>
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
      {!fs && !shortLand && !standalone && isIOS() && (
        <p className="mx-3 mt-2 text-center text-[11px] text-white/40 sm:mx-0">
          아이폰은 사파리 공유 → <b className="text-white/60">홈 화면에 추가</b>하면 전체화면 앱처럼
          할 수 있어요.
        </p>
      )}
      {!fs && !shortLand && (
        <p className="mx-3 mt-2 text-center text-[11px] text-white/30 sm:mx-0">
          칩을 다 잃으셨다면 몰래 문의 한번 남겨주세요. 드릴수도?
          <br />
          베타 버전 데이터는 정식 출시 때 초기화될 수 있어요.
        </p>
      )}
    </div>
  );
}

/** 머리말 버튼 (상점 · 옷장) */
/** 폰 전체화면 안내 뒤 배경: 타이틀 영상(세로) + 위 로고, 가운데 글자 · 버튼 뒤는 어둡게 */
function GateBg() {
  return (
    <>
      <video
        className="absolute inset-0 h-full w-full object-cover"
        src={asset.intro("v")}
        poster={asset.introPoster("v")}
        autoPlay
        muted
        loop
        playsInline
        aria-hidden
      />
      {/* 살짝 어둡게 (예전처럼 뒤가 흐려 보이게) — 로고 · 글자 · 버튼은 그 위라 그대로 또렷 */}
      <div className="absolute inset-0 bg-black/45" />
      <div className="absolute inset-x-0 top-0 h-[30%] bg-[linear-gradient(180deg,rgba(0,0,0,0.6),transparent)]" />
      <img src="/poker/ui/logo.webp" alt="ANIME POKER" className="absolute top-[4%] left-1/2 w-[62%] -translate-x-1/2 drop-shadow-[0_4px_12px_rgba(0,0,0,0.8)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_32%_at_50%_58%,rgba(0,0,0,0.82),rgba(0,0,0,0.35)_70%,transparent)]" />
    </>
  );
}

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
const DEV_ICON = <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />;
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

/** 로그인 전 · 별명 전: 타이틀 화면 — 여섯 캐릭터가 포커 치는 움직이는 그림(가로 · 세로 따로), 위 로고, 아래 시작 칸 */
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
  return (
    <div className="pk-intro absolute inset-0 overflow-hidden">
      {/* 배경: 짧게 반복되는 영상 (첫 장면 그림을 먼저 깔아 둠 · 움직임 줄이기 설정이면 그림만) */}
      <video
        key={o}
        className="pk-intro-video absolute inset-0 h-full w-full object-cover"
        src={asset.intro(o)}
        poster={asset.introPoster(o)}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden
      />
      <div
        className="absolute inset-0 z-10"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0) 26%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.7))",
        }}
      />
      {/* 로고 + 한 줄 소개 */}
      <div
        className="absolute left-1/2 z-20 flex -translate-x-1/2 flex-col items-center"
        style={{ top: h ? "2%" : "5%", width: h ? "29%" : "84%" }}
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
