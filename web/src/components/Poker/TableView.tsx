"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ApiError } from "@/lib/api/errors";
import { cardLabel } from "@/lib/poker/cards";
import { ACT_MS, CHOICE_MS, GAMES, REVIVE, TIERS, fmtShort, fmtWon } from "@/lib/poker/rules";
import { isMuted, setMuted, sfx } from "@/lib/poker/sfx";
import type { ChatMsg, HoldemAction, HoldemView, MyHand, PokerEvent, SeatWire, SevenAction, SevenView, TableWire, Wallet } from "@/lib/poker/types";
import { act, leave, revive, sendChat, serverNow, setSitOut, sit, subscribeMyHand, subscribeTable } from "@/realtime/poker";
import { HoldemActions, HoldemCenter, holdemHint, holdemSeatCards } from "./HoldemParts";
import { Chips, Money, Portrait } from "./parts";
import { SevenActions, SevenCenter, sevenHint, sevenSeatCards } from "./SevenParts";

/*
 * 포커 테이블 화면 (홀덤 · 7포커 공용 틀).
 * 서버가 보내는 테이블 상태를 그대로 그림: 자리(내 자리가 항상 아래 가운데), 가운데(바닥 카드 · 팟), 아래 행동 버튼, 옆에 기록 · 채팅.
 * 게임마다 다른 부분(가운데 · 자리의 카드 · 행동 버튼)은 HoldemParts / SevenParts.
 */

export const ACT_LABEL: Record<string, string> = {
  fold: "폴드",
  check: "체크",
  call: "콜",
  bet: "벳",
  raise: "레이즈",
  allin: "올인",
  die: "다이",
  bbing: "삥",
  ddadang: "따당",
  quarter: "쿼터",
  half: "하프",
  full: "풀",
};

/** 자리 위치 (% — 0번이 아래 가운데, 시계 방향) */
const SPOTS: Record<string, [number, number][]> = {
  "wide-6": [[50, 80], [9, 62], [17, 17], [50, 8], [83, 17], [91, 62]],
  "wide-5": [[50, 80], [9, 54], [27, 10], [73, 10], [91, 54]],
  // (아래쪽 옆자리는 화면이 낮은 폰에서 얼굴 · 카드가 바닥 카드에 닿지 않게 조금 더 아래)
  "tall-6": [[50, 84], [15, 66], [15, 28], [50, 7], [85, 28], [85, 66]],
  "tall-5": [[50, 84], [15, 57], [26, 11], [74, 11], [85, 57]],
};

export interface Sizes {
  compact: boolean;
  portrait: number;
  card: number;
  heroCard: number;
  boardCard: number;
}

function useMedia(query: string): boolean {
  const [hit, setHit] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setHit(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return hit;
}
const useCompact = () => useMedia("(max-width: 700px)");
/** 넓지만 낮은 화면 (노트북 등): 판의 높이가 줄어드는 만큼 카드 · 얼굴을 조금 작게 그려야 내 카드가 바닥 카드에 겹치지 않음 */
const useShort = () => useMedia("(max-height: 860px)");

/** 서버 시계 기준 현재 시각 (제한 시간이 흐르는 동안만 자주 갱신) */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

interface Bubble {
  text: string;
  until: number;
}
interface LogLine {
  id: number;
  text: ReactNode;
  tone?: "win" | "dim" | "street";
}

type SitState = "joining" | "seated" | "watching" | "password";

export default function TableView({
  id,
  uid,
  wallet,
  onExit,
  onWallet,
}: {
  id: string;
  uid: string;
  wallet: Wallet;
  onExit: () => void;
  onWallet: (w: Wallet) => void;
}) {
  const compact = useCompact();
  const short = useShort();
  const [table, setTable] = useState<TableWire | null | undefined>(undefined);
  const [myHand, setMyHand] = useState<MyHand | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [bubbles, setBubbles] = useState<Record<number, Bubble>>({});
  const [gains, setGains] = useState<Record<number, { amt: number; key: number }>>({});
  const [sitState, setSitState] = useState<SitState>("joining");
  const [notice, setNotice] = useState("");
  const [password, setPassword] = useState("");
  /** 내가 자리에서 내려온 이유 (입장컷 · 파산 등) */
  const [kicked, setKicked] = useState<"" | "cut" | "bust" | "idle">("");
  const [mute, setMute] = useState(() => typeof window !== "undefined" && isMuted());
  const [tab, setTab] = useState<"log" | "chat">("log");
  const [busy, setBusy] = useState(false);
  const seqRef = useRef(-1);
  const logId = useRef(0);
  const namesRef = useRef<Record<number, string>>({});
  /** 내가 앉아 있던 자리 (내려왔는지 알아채는 데 씀) */
  const seatedRef = useRef(-1);

  // 테이블에 있는 동안에는 사이트의 떠 있는 메뉴 버튼을 숨김 (행동 버튼을 가림)
  useEffect(() => {
    document.body.classList.add("game-full");
    return () => document.body.classList.remove("game-full");
  }, []);

  // 들어오면 테이블이 화면 맨 위에 오게
  const rootRef = useRef<HTMLDivElement>(null);
  const hasTable = !!table;
  useEffect(() => {
    if (!hasTable) return;
    const idt = setTimeout(() => rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
    return () => clearTimeout(idt);
  }, [hasTable]);

  // ── 일어난 일 → 소리 · 기록 · 말풍선 ──
  const digest = useCallback(
    (t: TableWire) => {
      for (const s of t.seats) if (s) namesRef.current[s.seat] = s.name;
      const nameOf = (seat: number) => namesRef.current[seat] ?? "?";
      const mySeat = t.seats.find((s) => s?.uid === uid)?.seat ?? -1;
      const lines: LogLine[] = [];
      const say: Record<number, Bubble> = {};
      const won: Record<number, { amt: number; key: number }> = {};
      const push = (text: ReactNode, tone?: LogLine["tone"]) => lines.push({ id: ++logId.current, text, tone });
      const until = Date.now() + 3200;
      for (const e of t.ev as PokerEvent[]) {
        switch (e.t) {
          case "hand":
            push(`── ${e.no}번째 판 ──`, "street");
            sfx.card();
            break;
          case "post":
            sfx.chip();
            break;
          case "act": {
            const label = ACT_LABEL[e.a] ?? e.a;
            // 홀덤 레이즈는 버튼에 적힌 것과 같은 금액(이번 구간에 낸 총액)으로 적음 — e.amt 는 이번에 더 낸 돈
            const last = t.hand?.game === "holdem" && e.a === "raise" ? t.hand.players[e.seat]?.last : null;
            const amt = last && last.a === "raise" ? last.amt : e.amt;
            push(
              <>
                <b className="text-white/85">{nameOf(e.seat)}</b> {label}
                {amt > 0 && ` ${fmtWon(amt)}`}
              </>
            );
            if (e.a === "fold" || e.a === "die") sfx.fold();
            else if (e.a === "check") sfx.check();
            else if (e.a === "allin") sfx.allin();
            else sfx.chip();
            break;
          }
          case "board":
            push(`${["", "플랍", "턴", "리버"][e.street] ?? ""} ${e.cards.map(cardLabel).join(" ")}`, "street");
            sfx.card();
            break;
          case "deal":
            if (e.round >= 4) push(`${e.round}구`, "street");
            sfx.card();
            break;
          case "open":
            sfx.card();
            break;
          case "show":
            if (e.name)
              push(
                <>
                  <b className="text-white/85">{nameOf(e.seat)}</b> {e.cards.map(cardLabel).join(" ")} — {e.name}
                </>
              );
            break;
          case "muck":
            push(
              <>
                <b className="text-white/85">{nameOf(e.seat)}</b> 패를 덮음
              </>,
              "dim"
            );
            break;
          case "win":
            push(
              <>
                <b>{nameOf(e.seat)}</b> +{fmtWon(e.amt)}
                {e.name && ` (${e.name})`}
              </>,
              "win"
            );
            won[e.seat] = { amt: (won[e.seat]?.amt ?? 0) + e.amt, key: logId.current };
            if (e.seat === mySeat) sfx.win();
            break;
          case "say":
            say[e.seat] = { text: e.text, until: until + e.text.length * 40 };
            break;
          case "sit":
            push(`${e.name} 입장`, "dim");
            break;
          case "leave":
            push(`${e.name} ${e.why === "bust" ? "파산" : e.why === "cashout" ? "자리에서 일어남 (수금)" : "퇴장"}`, "dim");
            break;
        }
      }
      if (lines.length) setLog((l) => [...l, ...lines].slice(-80));
      if (Object.keys(say).length) setBubbles((b) => ({ ...b, ...say }));
      if (Object.keys(won).length) setGains(won);
      // 내 차례가 됨
      const h = t.hand;
      if (h && !h.result && h.toAct === mySeat && mySeat >= 0 && t.ev.length) sfx.turn();
      // 내가 자리에서 내려옴 (입장컷 · 파산 · 오래 비움)
      if (seatedRef.current >= 0 && mySeat < 0) {
        const out = (t.ev as PokerEvent[]).find((e) => e.t === "leave" && e.seat === seatedRef.current);
        if (out && out.t === "leave" && out.why !== "leave" && out.why !== "cashout") setKicked(out.why);
        seatedRef.current = -1;
      }
    },
    [uid]
  );

  useEffect(() => {
    seqRef.current = -1;
    const offTable = subscribeTable(id, {
      onState(t) {
        if (t) {
          // 다시 연결됐을 때 같은 상태를 두 번 처리하지 않게
          if (t.seq > seqRef.current) {
            if (seqRef.current >= 0) digest(t);
            seqRef.current = t.seq;
          }
          const mine = t.seats.find((s) => s?.uid === uid);
          if (mine) seatedRef.current = mine.seat;
        }
        setTable(t);
      },
      onChat: (list) => setChat(list),
      onError: (e: ApiError) => {
        // 서버가 테이블을 닫으면서 구독을 끊은 것(CLOSED)은 오류가 아니라 "테이블이 닫혔어요"
        setNotice(e.code === "CLOSED" ? "" : e.message);
        setTable(null);
      },
    });
    const offHand = subscribeMyHand(id, setMyHand);
    return () => {
      offTable();
      offHand();
    };
  }, [id, uid, digest]);

  // 말풍선은 시간이 지나면 지움
  useEffect(() => {
    if (!Object.keys(bubbles).length) return;
    const idt = setInterval(() => {
      const now = Date.now();
      setBubbles((b) => {
        const next = Object.fromEntries(Object.entries(b).filter(([, v]) => v.until > now));
        return Object.keys(next).length === Object.keys(b).length ? b : next;
      });
    }, 400);
    return () => clearInterval(idt);
  }, [bubbles]);

  // ── 앉기 ──
  /** 앉기 요청이 가는 중 (버튼을 연달아 눌러도 한 번만 보냄 — 두 번째 요청의 "앉는 중" 거절이 화면을 덮지 않게) */
  const sittingRef = useRef(false);
  const trySit = useCallback(
    async (pw?: string) => {
      if (sittingRef.current) return;
      sittingRef.current = true;
      setNotice("");
      try {
        await sit(id, pw);
        setSitState("seated");
        setKicked("");
      } catch (e) {
        const err = e as ApiError;
        if (err.code === "WRONG_PASSWORD") {
          setSitState("password");
          if (pw !== undefined) setNotice(err.message);
        } else {
          setSitState("watching");
          // (입장컷 미달은 서버 문구가 "하우스은 … 50,000,000원부터"처럼 조사 · 금액 표기가 어색해서, 받은 금액으로 다시 적음)
          const min = err.code === "NEED_MONEY" ? (err.data as { min?: number } | undefined)?.min : undefined;
          setNotice(min ? `보유금액이 입장컷(${fmtWon(min)})보다 적어서 앉을 수 없어요.` : (err.message ?? "앉지 못했어요."));
        }
      } finally {
        sittingRef.current = false;
      }
    },
    [id]
  );
  const loaded = table !== undefined;
  const exists = !!table;
  useEffect(() => {
    // 테이블 상태를 받은 뒤 한 번 앉기를 시도
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 처음 한 번 서버에 앉기를 요청
    if (loaded && exists && sitState === "joining") void trySit();
  }, [loaded, exists, sitState, trySit]);

  const me: SeatWire | null = useMemo(() => table?.seats.find((s) => s?.uid === uid) ?? null, [table, uid]);
  const mySeat = me?.seat ?? -1;
  const hand = table?.hand ?? null;
  const deadline = hand && !hand.result ? hand.deadline : 0;
  const now = useNow(deadline > 0);

  // 시간이 3초 남으면 째깍
  const tickRef = useRef(0);
  useEffect(() => {
    if (!hand || hand.result || !deadline) return;
    // (구경 중이면 mySeat 도 toAct 도 -1 이라 같아짐 — 앉아 있을 때만)
    const mine = mySeat >= 0 && (hand.toAct === mySeat || (hand.game === "seven" && hand.phase === "choice" && hand.players[mySeat] && !hand.players[mySeat].chosen));
    const left = Math.ceil((deadline - now) / 1000);
    if (mine && left > 0 && left <= 3 && tickRef.current !== deadline * 10 + left) {
      tickRef.current = deadline * 10 + left;
      sfx.tick();
    }
  }, [now, deadline, hand, mySeat]);

  /** 행동 요청이 가는 중 (busy 는 다시 그려진 뒤에야 바뀌어서, 키를 연달아 누르면 두 번 나갈 수 있음) */
  const actingRef = useRef(false);
  const doAct = useCallback(
    async (action: HoldemAction | SevenAction) => {
      if (!table || actingRef.current) return;
      actingRef.current = true;
      setBusy(true);
      setNotice("");
      try {
        await act(id, table.handNo, action);
      } catch (e) {
        const err = e as ApiError;
        if (err.code !== "STALE" && err.code !== "NOT_YOUR_TURN") setNotice(err.message ?? "처리하지 못했어요.");
      } finally {
        actingRef.current = false;
        setBusy(false);
      }
    },
    [id, table]
  );

  const exit = async () => {
    try {
      await leave(id);
    } catch {}
    onExit();
  };

  if (table === undefined) return <p className="pk py-24 text-center text-sm text-white/40">테이블에 연결하는 중…</p>;
  if (table === null)
    return (
      <div className="pk mx-auto max-w-md px-6 py-20 text-center">
        <p className="text-sm text-white/60">{notice || "테이블이 닫혔어요."}</p>
        <button type="button" onClick={onExit} className="mt-5 cursor-pointer rounded-full bg-white px-5 py-2 text-sm font-bold text-[#15161a]">
          로비로 돌아가기
        </button>
      </div>
    );

  const tier = TIERS[table.tier - 1];
  const n = table.seats.length;
  const spots = SPOTS[`${compact ? "tall" : "wide"}-${n}`] ?? SPOTS["wide-6"];
  const sizes: Sizes = compact
    ? { compact, portrait: 42, card: 22, heroCard: 44, boardCard: 36 }
    : short
      ? { compact, portrait: 52, card: 28, heroCard: 54, boardCard: 50 }
      : { compact, portrait: 58, card: 30, heroCard: 62, boardCard: 56 };
  /** 자리 번호 → 화면 위치 (내 자리가 0번 위치) */
  const spotOf = (seat: number) => spots[(seat - Math.max(0, mySeat) + n) % n];
  const base = table.game === "holdem" ? tier.bb : tier.ante;
  const totalMs = hand?.game === "seven" && hand.phase === "choice" ? CHOICE_MS : ACT_MS;
  const frac = deadline ? Math.max(0, Math.min(1, (deadline - now) / totalMs)) : 0;
  const hv = hand?.game === "holdem" ? (hand as HoldemView) : null;
  const sv = hand?.game === "seven" ? (hand as SevenView) : null;
  const liveHand = myHand && myHand.handNo === table.handNo && hand ? myHand : null;
  const hint = !me || !liveHand ? "" : hv ? holdemHint(liveHand, hv) : sv ? sevenHint(liveHand) : "";
  const isWaiting = (seat: number) => !!hand && !hand.result && (hand.toAct === seat || (!!sv && sv.phase === "choice" && !!sv.players[seat] && !sv.players[seat].chosen && !sv.players[seat].folded));
  const actor = hand && !hand.result && hand.toAct >= 0 ? table.seats[hand.toAct] : null;

  return (
    <div ref={rootRef} className="pk mx-auto max-w-[1180px] scroll-mt-[108px] px-2 pb-28 sm:px-5 sm:pb-16">
      {/* 테이블 머리 */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 sm:mb-1">
        <button type="button" onClick={exit} className="cursor-pointer rounded-full border border-white/15 px-3 py-1 text-xs text-white/75 hover:border-white/40">
          ← 로비
        </button>
        <span className="min-w-0 truncate text-sm font-bold text-white">{table.name}</span>
        <span className="rounded-full bg-white/[0.07] px-2.5 py-0.5 text-[11px] text-white/65">
          {GAMES[table.game].name} · {tier.name} · {table.game === "holdem" ? `${fmtShort(tier.sb)}/${fmtShort(tier.bb)}` : `판돈 ${fmtShort(tier.ante)}`}
        </span>
        <span className="ml-auto flex items-center gap-2 text-xs text-white/50">
          보유 <Money won={wallet.money} className="text-base text-[var(--pk-brass)]" />
          <button
            type="button"
            aria-pressed={mute}
            onClick={() => {
              setMuted(!mute);
              setMute(!mute);
            }}
            className="cursor-pointer rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/70 hover:border-white/40"
          >
            {mute ? "소리 꺼짐" : "소리 켜짐"}
          </button>
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          {/* 판 */}
          <div
            className="relative mt-9 w-full select-none sm:mt-7"
            // (좁은 화면에서는 행동 버튼이 아래에 고정돼 있어서, 그 위로 내 자리의 이름표까지 보이도록 높이를 잡음)
            style={compact ? { aspectRatio: "3 / 3.9", maxHeight: "calc(100svh - 376px)", minHeight: 350 } : { aspectRatio: "16 / 9.2", maxHeight: "calc(100svh - 340px)", minHeight: 400 }}
          >
            <div
              className="pk-felt pk-table absolute"
              data-tier={table.tier}
              style={compact ? { inset: "10% 12% 17% 12%" } : { inset: "13% 8% 19% 8%" }}
            />
            {/* 가운데 */}
            <div className="absolute top-[42%] left-1/2 flex w-[64%] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 sm:gap-2">
              {hv && <HoldemCenter view={hv} tier={table.tier} sizes={sizes} seats={table.seats} />}
              {sv && <SevenCenter view={sv} seats={table.seats} />}
              {!hand && (
                <p className="rounded-full bg-black/35 px-4 py-1.5 text-center text-xs text-white/70">
                  {table.seats.filter((s) => s && s.status !== "out").length < 2 ? "같이 칠 사람을 기다리는 중…" : "곧 다음 판이 시작돼요"}
                </p>
              )}
            </div>

            {/* 자리 */}
            {table.seats.map((s, i) => {
              const [x, y] = spotOf(i);
              const p = hand?.players[i];
              // 시간 초과로 "자리 비움"이 됐어도 이번 판에는 아직 끼어 있을 수 있음 → 그동안은 칩 · 건 돈을 그대로 보여 줌
              const live = !!p && !!s && !p.folded && !hand?.result;
              const inHand = !!p && !!s && (s.status === "in" || live);
              const bet = inHand && !hand?.result ? p!.bet : 0;
              const hero = i === mySeat;
              // 건 돈은 자리와 가운데 사이에 (좁은 화면의 옆자리는 이름표를 피해 더 안쪽으로)
              const side = x < 25 || x > 75;
              const align: "left" | "center" | "right" = x < 25 ? "left" : x > 75 ? "right" : "center";
              // (7포커는 이름표 아래에 카드가 한 줄 더 있어서 더 안쪽)
              const bx = x + (50 - x) * (compact ? (side ? 0.62 : 0.3) : sv && side ? 0.42 : 0.34);
              // (홀덤의 맨 위 가운데 자리는 이름표 아래에 행동 표시가 붙으므로 조금 더 아래. 내 자리의 건 돈은 아래에서 내 카드 바로 위에 따로 그림)
              const by = y + (43 - y) * (compact ? (side ? (y > 50 ? 0.3 : 0.12) : sv ? 0.66 : 0.5) : sv ? (side ? 0.2 : 0.62) : side ? 0.4 : 0.48);
              // 옆자리는 화면 가장자리 쪽 끝을 고정 (카드가 늘어나도 얼굴이 밀리거나 화면 밖으로 나가지 않게)
              const edge = compact ? 52 : 58;
              // 내 자리는 아래 끝을 판 바닥에 고정 (카드를 받거나 행동 표시가 붙어도 얼굴 · 이름표가 움직이지 않고, 카드가 바닥 카드 쪽으로 올라가지 않게)
              const at: CSSProperties = hero
                ? { left: `${x}%`, bottom: 0 }
                : align === "left"
                  ? { left: `calc(${x}% - ${edge}px)`, top: `${y}%` }
                  : align === "right"
                    ? { right: `calc(${100 - x}% - ${edge}px)`, top: `${y}%` }
                    : { left: `${x}%`, top: `${y}%` };
              const wonHere = hand?.result?.won[i] ?? 0;
              const waiting = isWaiting(i);
              if (!s)
                return (
                  <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
                    {sitState !== "seated" && sitState !== "joining" ? (
                      <button
                        type="button"
                        onClick={() => void trySit()}
                        className="cursor-pointer rounded-full border border-dashed border-white/30 bg-black/30 px-3 py-2 text-xs text-white/70 hover:border-white/70 hover:text-white"
                      >
                        앉기
                      </button>
                    ) : (
                      <span className="block rounded-full border border-dashed border-white/15 text-center text-[10px] text-white/25" style={{ width: sizes.portrait, height: sizes.portrait, lineHeight: `${sizes.portrait}px` }}>
                        빈자리
                      </span>
                    )}
                  </div>
                );
              const cards = !hand
                ? null
                : hv
                  ? holdemSeatCards({ view: hv, seat: i, hero, myHand: hero ? liveHand : null, tier: table.tier, sizes })
                  : sevenSeatCards({ view: sv!, seat: i, hero, myHand: hero ? liveHand : null, tier: table.tier, sizes, align });
              const bubble = bubbles[i];
              // 마지막 행동(판이 끝나면 족보 이름)
              const tag =
                p?.last && !hand?.result ? (
                  <span
                    className={`pk-pop rounded-full px-2 py-px text-[10px] font-bold whitespace-nowrap sm:text-[11px] ${hero ? "" : "mt-1"} ${
                      p.last.a === "fold" || p.last.a === "die"
                        ? "bg-white/10 text-white/50"
                        : p.last.a === "check" || p.last.a === "call"
                          ? "bg-[var(--pk-call)] text-[#06231c]"
                          : "bg-[var(--pk-raise)] text-[#2a1903]"
                    }`}
                  >
                    {ACT_LABEL[p.last.a] ?? p.last.a}
                  </span>
                ) : hand?.result?.names[i] ? (
                  <span className={`pk-pop rounded-full bg-black/70 px-2 py-px text-[10px] whitespace-nowrap text-white sm:text-[11px] ${hero ? "" : "mt-1"}`}>{hand.result.names[i]}</span>
                ) : null;
              const isButton = hv ? hv.button === i : sv ? sv.boss === i && sv.round >= 4 : false;
              return (
                <div key={i}>
                  <div
                    className={`absolute z-10 flex flex-col ${hero ? "" : "-translate-y-1/2"} ${align === "left" ? "items-start" : align === "right" ? "items-end" : "-translate-x-1/2 items-center"}`}
                    style={at}
                  >
                    {bubble && (
                      <div
                        className={`pk-talk pk-pop pointer-events-none absolute z-30 w-max max-w-[170px] rounded-2xl bg-white px-3 py-1.5 text-center text-[13px] leading-snug text-[#17181c] shadow-lg sm:max-w-[230px] sm:text-sm ${
                          // 넓은 화면의 맨 윗줄 자리는 위에 띄우면 사이트 메뉴 밑으로 들어가 잘림 → 얼굴 옆(판 안쪽)에 띄움
                          !compact && y <= 12
                            ? x < 50
                              ? "top-0 left-full ml-2 rounded-tl-sm"
                              : "top-0 right-full mr-2 rounded-tr-sm"
                            : `bottom-full mb-2 ${align === "left" ? "left-0 rounded-bl-sm" : align === "right" ? "right-0 rounded-br-sm" : "pk-bubble left-1/2 -translate-x-1/2"}`
                        }`}
                      >
                        {bubble.text}
                      </div>
                    )}
                    {/* 내가 건 돈: 내 카드 바로 위 (자리 높이가 달라져도 카드에 가리지 않게 자리에 붙여 둠) */}
                    {hero && bet > 0 && (
                      <div className="pk-pop absolute bottom-full left-1/2 mb-1 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/55 py-0.5 pr-2 pl-1">
                        <Chips ratio={bet / base} className="text-[13px] sm:text-[15px]" />
                        <span className="pk-num text-xs whitespace-nowrap text-white sm:text-sm">{fmtShort(bet)}</span>
                      </div>
                    )}
                    {hero && cards && <div className="mb-1 flex justify-center">{cards}</div>}
                    <div className={`flex items-center gap-1.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
                      <div className="relative">
                        <Portrait
                          bot={s.bot}
                          name={s.name}
                          avatar={s.avatar}
                          size={sizes.portrait}
                          className={`${waiting ? "pk-turn" : wonHere > 0 ? "ring-2 ring-[var(--pk-brass)]" : "ring-2 ring-black/50"} ${p?.folded || (s.status !== "in" && !live) ? "opacity-45 grayscale" : ""}`}
                        />
                        {waiting && deadline > 0 && <TimerRing size={sizes.portrait} frac={frac} />}
                        {isButton && (
                          <span
                            title={hv ? "딜러 버튼" : "보스 (먼저 거는 사람)"}
                            className="absolute -right-1 -bottom-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-[#17181c] shadow"
                          >
                            {hv ? "D" : "보스"}
                          </span>
                        )}
                        {hv && (hv.sbSeat === i || hv.bbSeat === i) && hv.street === 0 && !hv.result && (
                          <span className="absolute -bottom-1 -left-1 rounded-full bg-[#17181c] px-1.5 text-[9px] leading-[16px] font-bold text-white/80 ring-1 ring-white/20">
                            {hv.bbSeat === i ? "BB" : "SB"}
                          </span>
                        )}
                        {gains[i] && wonHere > 0 && (
                          <span key={gains[i].key} className="pk-rise pk-num pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 text-lg whitespace-nowrap text-[var(--pk-brass)]">
                            +{fmtShort(gains[i].amt)}
                          </span>
                        )}
                      </div>
                      {!hero && !sv && cards && <div>{cards}</div>}
                    </div>
                    <div
                      className={`relative mt-1 min-w-[72px] rounded-lg border px-1.5 py-[3px] text-center leading-tight sm:min-w-[96px] sm:px-2 ${
                        hero ? "border-[var(--pk-brass)]/60 bg-[#221d0f]" : "border-white/10 bg-[#15161b]/95"
                      }`}
                    >
                      <div className="max-w-[92px] truncate text-[11px] text-white/80 sm:max-w-[120px] sm:text-xs">
                        {s.name}
                        {s.away && <span className="ml-1 text-white/35">· 끊김</span>}
                      </div>
                      <div className="pk-num text-[13px] text-white sm:text-[15px]">
                        {p?.allIn && !hand?.result ? <span className="text-[var(--pk-danger)]">올인</span> : s.status === "out" && !live ? <span className="font-['Nanum_Gothic'] text-[11px] font-normal text-white/40">자리 비움</span> : fmtShort(s.stack)}
                      </div>
                      {/* 내 자리의 행동 표시 · 족보는 이름표 옆에 (아래에 두면 자리가 길어져 안내 줄 · 행동 버튼을 가림) */}
                      {hero && tag && <span className="absolute top-1/2 left-full ml-1.5 flex -translate-y-1/2">{tag}</span>}
                    </div>
                    {/* 7포커: 다른 사람의 카드는 이름표 아래에 한 줄로 */}
                    {!hero && sv && cards && <div className="mt-1">{cards}</div>}
                    {!hero && tag}
                  </div>
                  {bet > 0 && !hero && (
                    <div className="pk-pop absolute z-[5] flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-black/45 py-0.5 pr-2 pl-1" style={{ left: `${bx}%`, top: `${by}%` }}>
                      <Chips ratio={bet / base} className="text-[13px] sm:text-[15px]" />
                      <span className="pk-num text-xs text-white sm:text-sm">{fmtShort(bet)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 내 패의 족보 · 안내 */}
          <div className="mt-1 flex min-h-[26px] flex-wrap items-center justify-center gap-2 px-2 text-center text-xs text-white/55 sm:mt-0.5">
            {hint && !hand?.result && <span className="rounded-full bg-white/[0.07] px-3 py-1 text-white/85">내 패: {hint}</span>}
            {notice && (
              <span role="alert" className="rounded-full bg-[var(--pk-danger)]/15 px-3 py-1 text-[#ffb3b5]">
                {notice}
              </span>
            )}
          </div>

          {/* 행동 (좁은 화면: 아래에 고정. 넓은 화면: 제자리에 있되, 화면 높이가 모자라면 아래에 붙어서 버튼이 잘리지 않게) */}
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#121316]/97 px-2 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] backdrop-blur sm:sticky sm:mt-1 sm:rounded-2xl sm:border sm:border-[var(--pk-line)] sm:bg-[var(--pk-panel)] sm:p-2.5">
            {sitState === "password" ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void trySit(password);
                }}
              >
                <input
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="테이블 비밀번호"
                  aria-label="테이블 비밀번호"
                  className="min-w-0 flex-1 rounded-xl border border-white/15 bg-[#15171c] px-3 py-2.5 text-sm text-white focus:border-[var(--pk-brass)] focus:outline-none"
                />
                <button type="submit" className="cursor-pointer rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-[#15161a]">
                  앉기
                </button>
              </form>
            ) : !me ? (
              <div className="flex flex-wrap items-center justify-center gap-3 py-1.5 text-sm text-white/60">
                {kicked ? (
                  <KickedNotice why={kicked} wallet={wallet} tierMin={tier.min} tierName={tier.name} onWallet={onWallet} onSit={() => void trySit()} onExit={onExit} />
                ) : sitState === "joining" ? (
                  "자리에 앉는 중…"
                ) : (
                  <>
                    구경하는 중이에요.
                    <button type="button" onClick={() => void trySit()} className="cursor-pointer rounded-full bg-white px-4 py-1.5 text-sm font-bold text-[#15161a]">
                      자리에 앉기
                    </button>
                  </>
                )}
              </div>
            ) : hv && hv.toAct === mySeat && !hv.result && hv.legal ? (
              <HoldemActions key={`${table.handNo}:${hv.street}:${hv.legal.minTo}`} view={hv} mySeat={mySeat} myStack={me.stack} busy={busy} onAct={doAct} unitBB={tier.bb} />
            ) : sv && !sv.result && (sv.toAct === mySeat || (sv.phase === "choice" && sv.players[mySeat] && !sv.players[mySeat].chosen && !sv.players[mySeat].folded)) ? (
              <SevenActions key={table.handNo} view={sv} mySeat={mySeat} myHand={liveHand} busy={busy} onAct={doAct} tier={table.tier} compact={compact} />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-1.5 text-sm text-white/55">
                <span>
                  {me.status === "out"
                    ? "자리 비움 상태예요. 돌아오면 다음 판부터 카드를 받아요."
                    : hand?.result
                      ? "판이 끝났어요. 곧 다음 판이 시작돼요."
                      : actor
                        ? `${actor.name} 차례…`
                        : me.status === "wait"
                          ? "다음 판부터 참가해요."
                          : "진행 중…"}
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void setSitOut(id, me.status !== "out").catch(() => {})}
                    className="cursor-pointer rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/75 hover:border-white/40"
                  >
                    {me.status === "out" ? "돌아오기" : "다음 판부터 쉬기"}
                  </button>
                  <button type="button" onClick={exit} className="cursor-pointer rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/75 hover:border-white/40">
                    나가기
                  </button>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 기록 · 채팅 */}
        <aside className="flex h-[260px] flex-col overflow-hidden rounded-2xl border border-[var(--pk-line)] bg-[var(--pk-panel)] lg:h-auto lg:max-h-[640px]">
          <div role="tablist" className="flex border-b border-[var(--pk-line)] text-sm">
            {(["log", "chat"] as const).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                type="button"
                onClick={() => setTab(k)}
                className={`flex-1 cursor-pointer py-2 ${tab === k ? "bg-white/[0.06] font-bold text-white" : "text-white/45 hover:text-white/75"}`}
              >
                {k === "log" ? "기록" : `채팅${chat.length ? ` ${chat.length}` : ""}`}
              </button>
            ))}
          </div>
          {tab === "log" ? <LogList lines={log} /> : <ChatBox id={id} chat={chat} uid={uid} canTalk={!!me} />}
        </aside>
      </div>
    </div>
  );
}

function TimerRing({ size, frac }: { size: number; frac: number }) {
  const r = size / 2 + 3;
  const c = 2 * Math.PI * r;
  const color = frac > 0.5 ? "var(--pk-call)" : frac > 0.2 ? "var(--pk-raise)" : "var(--pk-danger)";
  return (
    <svg className="pointer-events-none absolute -inset-[6px] -rotate-90" width={size + 12} height={size + 12} aria-hidden>
      <circle cx={size / 2 + 6} cy={size / 2 + 6} r={r} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="4" />
      <circle cx={size / 2 + 6} cy={size / 2 + 6} r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
    </svg>
  );
}

function LogList({ lines }: { lines: LogLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-xs leading-relaxed" aria-live="polite">
      {lines.length === 0 && <p className="py-6 text-center text-white/30">판이 시작되면 여기에 진행이 적혀요.</p>}
      {lines.map((l) => (
        <div
          key={l.id}
          className={l.tone === "win" ? "text-[var(--pk-brass)]" : l.tone === "street" ? "mt-1 text-white/40" : l.tone === "dim" ? "text-white/35" : "text-white/60"}
        >
          {l.text}
        </div>
      ))}
    </div>
  );
}

function ChatBox({ id, chat, uid, canTalk }: { id: string; chat: ChatMsg[]; uid: string; canTalk: boolean }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    sendChat(id, t).catch(() => {});
  };
  return (
    <>
      <div ref={ref} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-xs leading-relaxed">
        {chat.length === 0 && <p className="py-6 text-center text-white/30">같이 앉은 사람에게 인사해 보세요.</p>}
        {chat.map((m) => (
          <div key={m.id} className="break-words text-white/75">
            <b className={m.uid === uid ? "text-[var(--pk-brass)]" : "text-white/90"}>{m.name}</b> {m.text}
          </div>
        ))}
      </div>
      <form
        className="flex gap-1.5 border-t border-[var(--pk-line)] p-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={text}
          maxLength={80}
          disabled={!canTalk}
          onChange={(e) => setText(e.target.value)}
          placeholder={canTalk ? "메시지" : "자리에 앉으면 쓸 수 있어요"}
          aria-label="채팅 메시지"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#15171c] px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-[var(--pk-brass)] focus:outline-none disabled:opacity-50"
        />
        <button type="submit" disabled={!canTalk || !text.trim()} className="cursor-pointer rounded-lg bg-white/90 px-3 text-xs font-bold text-[#15161a] disabled:opacity-40">
          보내기
        </button>
      </form>
    </>
  );
}

/** 자리에서 내려왔을 때: 이유와 다음에 할 수 있는 일 */
function KickedNotice({
  why,
  wallet,
  tierMin,
  tierName,
  onWallet,
  onSit,
  onExit,
}: {
  why: "cut" | "bust" | "idle";
  wallet: Wallet;
  tierMin: number;
  tierName: string;
  onWallet: (w: Wallet) => void;
  onSit: () => void;
  onExit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const canRevive = wallet.money < REVIVE.under && wallet.reviveUsed < REVIVE.perDay;
  const canSit = wallet.money >= tierMin;
  const btn = "cursor-pointer rounded-full px-4 py-1.5 text-sm font-bold disabled:opacity-50";
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <p className="text-sm text-white/80">
        {why === "idle"
          ? "오래 자리를 비워서 자리에서 일어났어요."
          : `보유금액이 ${tierName} 입장컷(${fmtWon(tierMin)}) 아래로 내려가 자리에서 일어났어요.`}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {canRevive && (
          <button
            type="button"
            disabled={busy}
            className={`${btn} bg-[var(--pk-brass)] text-[#2a1e05]`}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                onWallet(await revive());
              } catch (e) {
                setErr(e instanceof Error ? e.message : "회생을 받지 못했어요.");
              } finally {
                setBusy(false);
              }
            }}
          >
            회생 받기 +{fmtWon(REVIVE.amount)} (오늘 {REVIVE.perDay - wallet.reviveUsed}번 남음)
          </button>
        )}
        {canSit && (
          <button type="button" className={`${btn} bg-white text-[#15161a]`} onClick={onSit}>
            다시 앉기
          </button>
        )}
        <button type="button" className={`${btn} border border-white/20 font-normal text-white/80`} onClick={onExit}>
          로비로
        </button>
      </div>
      {!canRevive && !canSit && <p className="text-xs text-white/45">로비에서 더 낮은 판돈의 테이블에 앉을 수 있어요.</p>}
      {err && <p className="text-xs text-[#ffb3b5]">{err}</p>}
    </div>
  );
}

export type SeatCardsProps<V> = {
  view: V;
  seat: number;
  hero: boolean;
  myHand: MyHand | null;
  tier: number;
  sizes: Sizes;
  align?: "left" | "center" | "right";
};
export type { CSSProperties };
