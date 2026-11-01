"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import NickForm from "@/components/Account/NickForm";
import GameLoader from "@/components/GameLoader";
import { useAuth } from "@/lib/AuthContext";
import { asset } from "@/lib/poker/assets";
import { CHAR_IDS } from "@/lib/poker/rules";
import type { BGameWire, BResult, BRoomWire, CoinReview, HubStatus, SoloReview, StockMe } from "@/lib/stock/types";
import type { Building, StockScreen } from "@/lib/stock/village";
import { attend, battleGame, coinReview, getHub, getMe, joinRoom, leaveRoom, soloReview, subscribeRoom, subscribeWallet, watchClock } from "@/realtime/stock";
import { Lobby, Room } from "./BattleLobby";
import { Play, Result } from "./BattlePlay";
import Coin, { CoinReviewView } from "./Coin";
import Estate from "./Estate";
import Home from "./Home";
import Hub from "./Hub";
import Records, { type RecTab } from "./Records";
import Solo, { Review } from "./Solo";
import Stage from "./Stage";
import { sfx } from "@/lib/stock/sound";
import { C, Empty, TITLE, Toast, won } from "./ui";

/*
 * 애니메 차트 (ANIME CHART) — 화면 전환 · 지갑 · 로그인.
 *   마을(허브) → 증권거래소(솔로) · 트레이딩 홀(대전) · 부동산 · 명예의 전당 · 포커 하우스(애니메 포커로)
 * 회원만 (돈이 애니메 포커와 같은 지갑이라). 주소 ?r=방번호 로 대전 방에 바로 들어감.
 */

type Screen = StockScreen | "review" | "coinReview" | "records";

/** 처음 들어올 때 받아 둘 그림: 캐릭터 얼굴 · 표정 · 1등 컷인 */
const preload = () => CHAR_IDS.flatMap((c) => [asset.profile(c), asset.face(c, "joy"), asset.face(c, "smile"), asset.face(c, "sad"), asset.face(c, "shock"), asset.face(c, "idle"), asset.cutin(c)]);

export default function StockApp() {
  return (
    <GameLoader tasks={preload} title="ANIME CHART" accent={C.gold} className="mx-auto aspect-[2.1] w-full max-w-[1280px] rounded-[14px]">
      <Stage>{(s) => <Inner w={s.w} h={s.h} />}</Stage>
    </GameLoader>
  );
}

function Inner({ w, h }: { w: number; h: number }) {
  const { loading, account, profile, login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [screen, setScreen] = useState<Screen>(() => (params.get("r") ? "room" : "hub"));
  const [me, setMe] = useState<StockMe | null>(null);
  const [hub, setHub] = useState<HubStatus | null>(null);
  const [roomId, setRoomId] = useState<string | null>(params.get("r"));
  const [review, setReview] = useState<SoloReview | null>(null);
  const [cReview, setCReview] = useState<CoinReview | null>(null);
  const [homeUid, setHomeUid] = useState("");
  const attended = useRef(false);
  const [recTab, setRecTab] = useState<RecTab>("assets");
  const [shown, setShown] = useState<BResult | null>(null);
  const [toastMsg, setToastMsg] = useState<{ text: string; tone: "plain" | "up" | "down" | "warn"; k: number } | null>(null);
  const member = !!account && !!profile;
  const uid = account?.uid ?? "";

  const toast = useCallback((text: string, tone: "plain" | "up" | "down" | "warn" = "plain") => setToastMsg({ text, tone, k: Date.now() }), []);
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 2200);
    return () => clearTimeout(t);
  }, [toastMsg]);
  useEffect(() => watchClock(), []);

  const refresh = useCallback(() => {
    if (!member) return;
    void getMe().then(setMe, () => {});
  }, [member]);
  useEffect(() => {
    if (!member) return;
    refresh();
    // 포커 · 다른 탭에서 돈이 바뀌어도 지갑 칩이 맞게
    return subscribeWallet(() => refresh());
  }, [member, refresh]);
  useEffect(() => {
    if (member && screen === "hub") void getHub().then(setHub, () => {});
  }, [member, screen]);
  // 마을에 들어오면 집 출석 보너스 (하루 한 번)
  useEffect(() => {
    if (!member || attended.current) return;
    attended.current = true;
    void attend().then(
      (r) => {
        if (r) {
          sfx("cash");
          toast(`🏠 출석 보너스 +${won(r.amount)} (집 ${r.homes}채)`, "up");
          refresh();
        }
      },
      () => {}
    );
  }, [member, refresh, toast]);

  const go = (s: Screen) => setScreen(s);
  const enter = (b: Building) => {
    if (b.action.type === "link") return router.push(`${b.action.href}?from=stock`);
    if (b.action.type === "screen") go(b.action.screen);
  };
  const toHub = () => go("hub");
  const setRoom = (id: string | null) => {
    setRoomId(id);
    if (id) setScreen("room");
    const u = new URL(window.location.href);
    if (id) u.searchParams.set("r", id);
    else u.searchParams.delete("r");
    window.history.replaceState(null, "", u.toString());
    if (!id) go("lobby");
  };

  if (loading) return <Empty>로그인 상태를 확인하는 중…</Empty>;
  if (!member)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-[12px] px-[20px] text-center" style={{ background: "radial-gradient(ellipse at 50% 30%, #1f2b45, #0f1420 70%)" }}>
        <div className={`${TITLE} text-[38px] leading-none`} style={{ color: C.gold }}>
          ANIME CHART
        </div>
        <div className="text-[14px]">애니메 차트 · 차트 하나로 50턴, 코인 레버리지, 친구 · 봇과 7분 대전</div>
        <div className="text-[11px]" style={{ color: C.mute }}>
          애니메 포커와 같은 지갑을 써요 · 실제 돈이 오가지 않는 게임이에요
        </div>
        {!account ? (
          <button type="button" onClick={() => void login().catch(() => toast("로그인하지 못했어요. 잠시 후 다시 시도해 주세요.", "warn"))} className="mt-[6px] cursor-pointer rounded-full px-[22px] py-[10px] text-[14px] font-bold" style={{ background: C.gold, color: "#1A1408" }}>
            Google로 시작하기
          </button>
        ) : (
          <div className="w-[300px]">
            <p className="mb-[6px] text-[12px]">별명을 정하면 시작할 수 있어요.</p>
            <NickForm submitLabel="시작하기" />
          </div>
        )}
        {toastMsg && <Toast text={toastMsg.text} tone={toastMsg.tone} />}
      </div>
    );

  const total = me?.total ?? null;
  let body: React.ReactNode;
  switch (screen) {
    case "solo":
      body = <Solo w={w} h={h} total={total} onBack={toHub} onChanged={refresh} toast={toast} />;
      break;
    case "lobby":
      body = <Lobby total={total} onBack={toHub} onJoined={(id) => setRoom(id)} onRecords={() => (setRecTab("battle"), go("records"))} toast={toast} />;
      break;
    case "room":
      body = roomId ? <BattleCtl id={roomId} uid={uid} w={w} h={h} onLeave={() => setRoom(null)} toast={toast} /> : null;
      break;
    case "coin":
      body = <Coin w={w} h={h} total={total} onBack={toHub} onChanged={refresh} toast={toast} />;
      break;
    case "estate":
      body = <Estate total={total} cash={me?.money ?? 0} onBack={toHub} onChanged={refresh} onVisit={(u) => (setHomeUid(u), go("home"))} toast={toast} />;
      break;
    case "home":
      body = <Home uid={homeUid} me={uid} total={total} w={w} onBack={() => (setHomeUid(""), toHub())} onEstate={() => go("estate")} toast={toast} />;
      break;
    case "coinReview":
      body = cReview ? <CoinReviewView r={cReview} w={w} h={h} onBack={() => (setRecTab("coin"), go("records"))} /> : null;
      break;
    case "rank":
    case "records":
      body = (
        <Records
          me={me}
          total={total}
          tab={screen === "records" ? recTab : "assets"}
          onBack={toHub}
          onReview={(id) => void soloReview(id).then((r) => (setReview(r), go("review")), (e) => toast((e as Error).message, "warn"))}
          onCoinReview={(id) => void coinReview(id).then((r) => (setCReview(r), go("coinReview")), (e) => toast((e as Error).message, "warn"))}
          onVisit={(u) => (setHomeUid(u), go("home"))}
          onBattleGame={(id) => void battleGame(id).then(setShown, (e) => toast((e as Error).message, "warn"))}
        />
      );
      break;
    case "review":
      body = review ? <Review r={review} w={w} h={h} onBack={() => (setRecTab("solo"), go("records"))} toast={toast} /> : null;
      break;
    default:
      body = <Hub w={w} h={h} me={me ? { nick: me.nick, look: me.look } : null} total={total} status={hub} onEnter={enter} />;
  }
  return (
    <div className="relative h-full w-full">
      <div key={screen} className="stk-enter h-full w-full">
        {body}
      </div>
      {shown && <Result r={shown} myUid={uid} onClose={() => setShown(null)} />}
      {toastMsg && <Toast key={toastMsg.k} text={toastMsg.text} tone={toastMsg.tone} />}
    </div>
  );
}

/** 대전 방 하나: 구독 · 대기실 / 판 / 결과 */
function BattleCtl({ id, uid, w, h, onLeave, toast }: { id: string; uid: string; w: number; h: number; onLeave: () => void; toast: (t: string, tone?: "plain" | "up" | "down" | "warn") => void }) {
  const [room, setRoom] = useState<BRoomWire | null | undefined>(undefined);
  const [game, setGame] = useState<BGameWire | null>(null);
  const [result, setResult] = useState<BResult | null>(null);
  const leaving = useRef(false);
  useEffect(
    () =>
      subscribeRoom(id, {
        onRoom: (r) => {
          setRoom(r);
          if (r === null && !leaving.current) {
            toast("없어진 방이에요.", "warn");
            onLeave();
          }
        },
        onGame: (g) => setGame(g && !g.over ? g : null),
        onResult: (r) => {
          setGame(null);
          setResult(r);
        },
        onChat: () => {},
        onKicked: (k) => {
          if (k !== uid) return;
          toast("방장이 내보냈어요.", "warn");
          onLeave();
        },
        onError: (e) => {
          toast(e.message, "warn");
          onLeave();
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id]
  );
  // 내 자리가 없으면(주소로 들어온 경우) 앉기
  useEffect(() => {
    if (!room || room.seats.some((s) => s?.uid === uid) || room.phase === "play") return;
    void joinRoom(id).catch((e) => {
      toast((e as Error).message, "warn");
      onLeave();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id]);
  const leave = () => {
    leaving.current = true;
    void leaveRoom(id).finally(onLeave);
  };
  if (room === undefined) return <Empty>방에 들어가는 중…</Empty>;
  if (!room) return <Empty>없어진 방이에요.</Empty>;
  const seated = room.seats.some((s) => s?.uid === uid);
  return (
    <div className="relative h-full">
      {room.phase === "play" && game && seated ? (
        <Play room={room} game={game} myUid={uid} w={w} h={h} toast={toast} />
      ) : room.phase === "play" ? (
        <Empty>지금 대전 중인 방이에요. 끝나면 들어갈 수 있어요.</Empty>
      ) : (
        <Room room={room} myUid={uid} onLeave={leave} onLastResult={room.lastGame ? () => void battleGame(room.lastGame!).then(setResult, () => {}) : null} toast={toast} />
      )}
      {result && <Result r={result} myUid={uid} onClose={() => setResult(null)} />}
    </div>
  );
}
