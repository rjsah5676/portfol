"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { ApiError } from "@/lib/api/errors";
import { asset, chipColor, heroReady, preloadChar, roomTint } from "@/lib/poker/assets";
import { cardLabel, categoryOf, evaluate } from "@/lib/poker/cards";
import {
  ACT_MS,
  CHARS,
  CHOICE_MS,
  EMOTES,
  FACES,
  GAMES,
  POSES,
  TIERS,
  fmtShort,
  fmtWon,
  type Emote,
  type Face,
  type Look,
  type Pose,
  tierLabel,
  type TierId,
  lookChar,
  lookName,
} from "@/lib/poker/rules";
import { bestK, kCategory } from "@/lib/poker/seven";
import { hasSound, isBig, playBgm, playSfx, playVoice, sfx } from "@/lib/poker/sfx";
import type {
  HoldemAction,
  HoldemView,
  MyHand,
  PokerEvent,
  SeatWire,
  SevenAction,
  SevenView,
  TableWire,
  Wallet,
} from "@/lib/poker/types";
import { onConnection } from "@/lib/api/socket";
import {
  act,
  leave,
  sendEmote,
  serverNow,
  kickVote,
  setExit,
  setSitOut,
  sit,
  subscribeMyHand,
  subscribeTable,
} from "@/realtime/poker";
import {
  HoldemActions,
  HoldemBoard,
  HoldemStage,
  holdemHint,
  holdemSeatCards,
} from "./HoldemParts";
import { COMPACT_RATIO, compactV, layoutFor, type Orient, type Spot } from "./layout";
import {
  Bet,
  CharSprite,
  HeroSprite,
  CutIn,
  EmoteImg,
  FaceIcon,
  Money,
  PotChips,
  Profile,
  Rise,
  Suit,
  PotPile,
  TimerRing,
} from "./parts";
import { SevenActions, SevenStage, sevenHint, sevenSeatCards } from "./SevenParts";

/*
 * 테이블 화면 (홀덤 · 7포커 공용). 무대(stage) 안에서 그려지고, 무대의 가로·세로에 따라 세로판(폰) / 가로판(PC)으로 배치가 바뀜.
 *  배경(방) → 자리에 서 있는 캐릭터 → 테이블 → 카드 · 칩 · 이름표 → 내 카드 · 행동 버튼 → 채팅.
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

/** 외침 색 (행동별) · 느낌표 붙는 행동 */
const SHOUT_COLOR: Record<string, string> = {
  fold: "#c3c9d6",
  die: "#c3c9d6",
  check: "#3fe29a",
  call: "#3fe29a",
  bet: "#ffa23e",
  raise: "#ffa23e",
  quarter: "#ffa23e",
  bbing: "#6cabff",
  ddadang: "#3bd4d4",
  half: "#ff5f72",
  full: "#b78cff",
  allin: "#ffd23f",
};
const SHOUT_BANG = new Set([
  "bet",
  "raise",
  "allin",
  "bbing",
  "ddadang",
  "quarter",
  "half",
  "full",
]);

/** 게임 조각들이 받는 크기 (px) */
export interface Sizes {
  o: Orient;
  u: number;
  card: number;
  heroCard: number;
  boardCard: number;
  face: number;
}

export type SeatCardsProps<V> = {
  view: V;
  seat: number;
  hero: boolean;
  myHand: MyHand | null;
  tier: TierId;
  sizes: Sizes;
  side: "left" | "right" | "top";
  /** 쇼다운인데 아직 안 깐 자리 (패 까기 연출 중) */
  hide?: boolean;
  /** 패를 다 깠음 → 이긴 카드 빛남 · 진 카드 어두움 */
  settled?: boolean;
  /** 카드 나눠 주기 연출 중: i 번째 카드(전체 n장)가 손에 도착하는 시각(ms, 없으면 그냥) */
  dealDelay?: (i: number, n: number) => number | undefined;
  /** 옆으로 늘어놓을 수 있는 최대 폭(px) — 넘치면 더 촘촘히 겹침 (폰 세로판 양옆 자리끼리 안 겹치게) */
  maxW?: number;
};

/** 카드 나눠 주기 연출: 딜러(판 가운데)에서 한 장씩 날아감. k = 날아가는 순서, idx = 그 자리의 몇 번째 카드(-1 = 마지막 장) */
interface DealFx {
  key: number;
  handNo: number;
  items: { seat: number; k: number; idx: number }[];
  step: number;
  fly: number;
}

/** 서버 시계 기준 현재 시각 (제한 시간이 흐르는 동안만 자주 갱신) */
/** 앉은 그림(384×512)에서 테이블 선의 높이 비율 */
const SEAT_LINE = 470 / 512;

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

interface Timed<T> {
  v: T;
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
  o,
  w,
  h,
  onExit,
  onWallet,
  topRight,
}: {
  id: string;
  uid: string;
  wallet: Wallet;
  o: Orient;
  /** 무대 크기 (px) */
  w: number;
  h: number;
  onExit: () => void;
  onWallet: (w: Wallet) => void;
  /** 무대 공통 버튼 (전체화면 등) */
  topRight?: ReactNode;
}) {
  const [table, setTable] = useState<TableWire | null | undefined>(undefined);
  const [myHand, setMyHand] = useState<MyHand | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [emotes, setEmotes] = useState<Record<number, Timed<Emote> & { key: number }>>({});
  const [poses, setPoses] = useState<Record<number, Timed<Pose>>>({});
  const [faces, setFaces] = useState<Record<number, Timed<Face>>>({});
  const [gains, setGains] = useState<Record<number, { amt: number; key: number }>>({});
  const [cutin, setCutin] = useState<{ char: Look; name: string; key: number } | null>(null);
  const [sitState, setSitState] = useState<SitState>("joining");
  const [notice, setNotice] = useState("");
  const [password, setPassword] = useState("");
  const [kicked, setKicked] = useState<"" | "cut" | "bust" | "idle" | "vote">("");
  // 알림은 3초 뒤 사라짐
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(t);
  }, [notice]);
  const exitRef = useRef(onExit);
  useEffect(() => {
    exitRef.current = onExit;
  });
  const [tab, setTab] = useState<"log" | "rank">("rank");
  /** 세로판: 기록 · 족보 서랍 / 이모티콘 고르기 */
  const [drawer, setDrawer] = useState<"" | "info" | "emote">("");
  const [busy, setBusy] = useState(false);
  const seqRef = useRef(-1);
  const logId = useRef(0);
  const namesRef = useRef<Record<number, string>>({});
  /** 자리 → 캐릭터 (나간 뒤에도 작별 인사를 그 캐릭터 목소리로) */
  const charsRef = useRef<Record<number, Look>>({});
  const seatedRef = useRef(-1);
  const keyRef = useRef(0);
  /** 직전 상태의 자리별 건 돈 (라운드가 끝나 팟으로 모일 때 칩 날리기용) */
  const prevBetsRef = useRef<Record<number, number>>({});
  const prevHandRef = useRef(-1);
  const [info, setInfo] = useState<{ text: string; key: number } | null>(null);
  const exitMineRef = useRef<boolean | null>(null);
  const exitAskRef = useRef(false);
  const [flying, setFlying] = useState<{
    key: number;
    seats: { seat: number; amt: number }[];
  } | null>(null);
  /** 승자에게 날아가는 칩 */
  const [winFly, setWinFly] = useState<{
    key: number;
    seats: { seat: number; amt: number }[];
  } | null>(null);
  /** 행동 외침: 자리에서 판 가운데로 날아가는 큰 대사 */
  const [shouts, setShouts] = useState<{ key: number; seat: number; a: string }[]>([]);
  /** 미리 행동 (내 차례가 오면 자동으로): cf = 체크/폴드(7포커는 다이), call = 콜 */
  const [pre, setPre] = useState("");
  /** 이름표를 눌러 보는 자리 정보 */
  const [statSeat, setStatSeat] = useState<number | null>(null);
  /** 내가 강퇴 투표한 자리들 (이 판 기준) */
  const [voted, setVoted] = useState<Set<number>>(() => new Set());
  /** 쇼다운 패 까기 연출: order 순서로 한 자리씩 깜(step = 깐 자리 수). 다 깐 뒤 한 박자 쉬고 결과(step > order.length) */
  /** 카드 나눠 주기 연출 */
  const [dealFx, setDealFx] = useState<DealFx | null>(null);
  const [reveal, setReveal] = useState<{
    key: number;
    handNo: number;
    order: number[];
    step: number;
    /** 깔 때 그 사람이 읊는 족보 대사 (order 와 같은 순서, 음성 파일이 없으면 null) */
    say: ({ look: string; line: string } | null)[];
  } | null>(null);
  /** 패를 다 깐 뒤에 보여줄 승리 연출 (칩 · +금액 · 소리) */
  const pendingWinRef = useRef<(() => void) | null>(null);
  const myCharRef = useRef<Look | null>(null);

  // ── 일어난 일 → 소리 · 기록 · 말풍선 · 포즈 ──
  const digest = useCallback(
    (t: TableWire) => {
      for (const s of t.seats)
        if (s) {
          namesRef.current[s.seat] = s.name;
          charsRef.current[s.seat] = s.look ?? s.char;
        }
      const nameOf = (seat: number) => namesRef.current[seat] ?? "?";
      const mySeat = t.seats.find((s) => s?.uid === uid)?.seat ?? -1;
      const lines: LogLine[] = [];
      const emo: Record<number, Timed<Emote> & { key: number }> = {};
      const pose: Record<number, Timed<Pose>> = {};
      const face: Record<number, Timed<Face>> = {};
      const won: Record<number, { amt: number; key: number }> = {};
      const shoutsNew: { key: number; seat: number; a: string }[] = [];
      const push = (text: ReactNode, tone?: LogLine["tone"]) =>
        lines.push({ id: ++logId.current, text, tone });
      const now = Date.now();
      const ante = TIERS[t.tier - 1]?.ante ?? 1;
      const charOf = (seat: number) => t.seats[seat]?.look ?? t.seats[seat]?.char ?? null;
      const anyAllIn = Object.values(t.hand?.players ?? {}).some((p) => p.allIn);
      if (prevHandRef.current !== t.handNo) {
        // 새 판: 지난 판 연출은 버림
        pendingWinRef.current = null;
        setReveal(null);
      }
      const shows: { seat: number; cards: number[] }[] = [];
      /** 이번에 나눠 줄 카드: 자리별 장수, last = 그 자리의 마지막 장만 새 카드 */
      let dealPlan: { counts: [number, number][]; last: boolean } | null = null;
      for (const e of t.ev as PokerEvent[]) {
        switch (e.t) {
          case "hand":
            push(`── ${e.no}번째 판 ──`, "street");
            playSfx("sfx-shuffle");
            // 홀덤: 패 2장씩 나눠 주기 (7포커는 "deal" 이벤트로)
            if (t.hand?.game === "holdem")
              dealPlan = {
                counts: Object.keys(t.hand.players).map((k) => [Number(k), 2]),
                last: false,
              };
            break;
          case "post":
            sfx.chip();
            break;
          case "act": {
            const label = ACT_LABEL[e.a] ?? e.a;
            const last =
              t.hand?.game === "holdem" && e.a === "raise" ? t.hand.players[e.seat]?.last : null;
            const amt = last && last.a === "raise" ? last.amt : e.amt;
            push(
              <>
                <b className="text-white/85">{nameOf(e.seat)}</b> {label}
                {amt > 0 && ` ${fmtWon(amt)}`}
              </>
            );
            shoutsNew.push({ key: ++keyRef.current, seat: e.seat, a: e.a });
            {
              // 캐릭터 음성: 판돈의 100배 이상 걸면 크게 외치는 버전, 남의 올인을 받는 콜은 따로
              const ch = charOf(e.seat);
              const big = isBig(amt, ante);
              if (ch)
                playVoice(ch, e.a === "call" && anyAllIn && !e.allIn ? "allin-call" : e.a, big);
            }
            if (e.a === "fold" || e.a === "die") {
              sfx.fold();
              pose[e.seat] = { v: "die", until: now + 1600 };
            } else if (e.a === "check") {
              sfx.check();
              pose[e.seat] = { v: "check", until: now + 1200 };
            } else if (e.a === "allin") {
              sfx.allin();
              pose[e.seat] = { v: "allin", until: now + 2600 };
              const s = t.seats[e.seat];
              if (s) setCutin({ char: s.look ?? s.char, name: s.name, key: ++keyRef.current });
              for (const q of t.seats)
                if (q && q.seat !== e.seat) face[q.seat] = { v: "shock", until: now + 2200 };
            } else {
              if (isBig(amt, ante)) sfx.chipBig();
              else sfx.chip();
              pose[e.seat] = { v: "bet", until: now + 1400 };
              if (e.a === "raise" || e.a === "half" || e.a === "full" || e.a === "ddadang")
                face[e.seat] = { v: "taunt", until: now + 1600 };
            }
            break;
          }
          case "board":
            push(
              `${["", "플랍", "턴", "리버"][e.street] ?? ""} ${e.cards.map(cardLabel).join(" ")}`,
              "street"
            );
            sfx.card();
            break;
          case "deal": {
            if (e.round >= 4) push(`${e.round}구`, "street");
            const cnt = new Map<number, number>();
            for (const c of e.cards) cnt.set(c.seat, (cnt.get(c.seat) ?? 0) + 1);
            dealPlan = { counts: [...cnt.entries()], last: e.round >= 4 };
            break;
          }
          case "open":
            sfx.card();
            break;
          case "show":
            if (e.cards.length) shows.push({ seat: e.seat, cards: e.cards });
            if (e.name)
              push(
                <>
                  <b className="text-white/85">{nameOf(e.seat)}</b>{" "}
                  {e.cards.map(cardLabel).join(" ")} — {e.name}
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
            won[e.seat] = { amt: (won[e.seat]?.amt ?? 0) + e.amt, key: ++keyRef.current };
            break;
          // 대사(say)는 말풍선 없이 음성으로만
          case "emote": {
            emo[e.seat] = { v: e.emote, until: now + 2600, key: ++keyRef.current };
            // 이모티콘마다 다른 효과음 (없으면 공통 "뿅")
            if (hasSound(`sfx-emote-${e.emote}`)) playSfx(`sfx-emote-${e.emote}`);
            else sfx.emote();
            break;
          }
          case "kick": {
            const who = nameOf(e.by);
            const whom = nameOf(e.seat);
            push(
              <>
                <b className="text-white/85">{who}</b> → <b className="text-white/85">{whom}</b>{" "}
                강퇴 투표 ({e.votes}/{e.need})
              </>,
              "dim"
            );
            if (e.seat === mySeat)
              setInfo({
                text: `${who} 님이 나에게 강퇴 투표했어요 (${e.votes}/${e.need})`,
                key: Date.now(),
              });
            else if (e.by !== mySeat)
              setInfo({
                text: `${who} → ${whom} 강퇴 투표 (${e.votes}/${e.need})`,
                key: Date.now(),
              });
            break;
          }
          case "sit": {
            push(`${e.name} 입장`, "dim");
            if (e.seat === mySeat) sfx.entry();
            else sfx.join();
            const ch = charOf(e.seat);
            if (ch) playVoice(ch, "hello");
            break;
          }
          case "leave":
            push(
              `${e.name} ${e.why === "bust" ? "파산" : e.why === "cashout" ? "자리에서 일어남" : e.why === "vote" ? "투표로 강퇴" : "퇴장"}`,
              e.why === "vote" ? "street" : "dim"
            );
            if (e.why === "vote" && e.seat !== mySeat)
              setInfo({ text: `${e.name} 님이 투표로 강퇴됐어요`, key: Date.now() });
            if (e.seat === mySeat && e.why === "bust" && myCharRef.current)
              playVoice(myCharRef.current, "broke");
            else if (e.seat !== mySeat) {
              sfx.join();
              const ch = charsRef.current[e.seat];
              if (ch && e.why !== "bust") playVoice(ch, "bye");
            }
            break;
        }
      }
      if (lines.length) setLog((l) => [...l, ...lines].slice(-80));
      if (Object.keys(emo).length) setEmotes((b) => ({ ...b, ...emo }));
      if (Object.keys(pose).length) setPoses((b) => ({ ...b, ...pose }));
      if (Object.keys(face).length) setFaces((b) => ({ ...b, ...face }));
      // 카드 나눠 주기: 내 다음 자리부터 시계 방향으로 한 바퀴에 한 장씩, 나는 맨 끝
      if (dealPlan && dealPlan.counts.length) {
        const n = t.seats.length;
        const from = Math.max(0, mySeat);
        const seats = dealPlan.counts
          .map(([seat]) => seat)
          .sort((a, b) => ((a - from - 1 + n) % n) - ((b - from - 1 + n) % n));
        const per = new Map(dealPlan.counts);
        const rounds = Math.max(...dealPlan.counts.map(([, c]) => c));
        const items: DealFx["items"] = [];
        for (let r = 0; r < rounds; r++)
          for (const seat of seats)
            if ((per.get(seat) ?? 0) > r)
              items.push({ seat, k: items.length, idx: dealPlan.last ? -1 : r });
        // 전부 1.1초 안에 (장수가 많으면 촘촘히)
        const step = Math.max(45, Math.min(120, Math.round(1100 / items.length)));
        const fly = 260;
        setDealFx({ key: ++keyRef.current, handNo: t.handNo, items, step, fly });
        items.forEach((it) => setTimeout(sfx.card, it.k * step + fly * 0.6));
      }
      // 쇼다운: 패를 한 자리씩 깐다 — 내 자리부터 시계 방향, 이긴 사람은 맨 마지막에
      const resNow = t.hand?.result ?? null;
      let staged = false;
      if (shows.length && t.hand) {
        const n = t.seats.length;
        const wonSeats = Object.keys(won).map(Number);
        const from = Math.max(0, mySeat);
        const ord = shows
          .map((x) => x.seat)
          .sort((a, b) => ((a - from + n) % n) - ((b - from + n) % n));
        const order = [
          ...ord.filter((x) => !wonSeats.includes(x)),
          ...ord.filter((x) => wonSeats.includes(x)),
        ];
        staged = true;
        const say = order.map((seat) => {
          const look = charOf(seat);
          const line = handLine(resNow?.names[seat] ?? "");
          if (!look || !line) return null;
          const has = (who: string) => hasSound(`voice/${who}/${who}-${line}`);
          return has(look) || has(lookChar(look)) ? { look, line } : null;
        });
        setReveal({ key: ++keyRef.current, handNo: t.handNo, order, step: 0, say });
        if (resNow?.showdown) sfx.drum();
        // 마지막 구의 건 돈은 깔기 전에 팟으로
        const lastBets = Object.entries(prevBetsRef.current)
          .filter(([, amt]) => amt > 0)
          .map(([k, amt]) => ({ seat: Number(k), amt }));
        if (resNow && lastBets.length) {
          setFlying({ key: ++keyRef.current, seats: lastBets });
          sfx.collect();
          prevBetsRef.current = {};
        }
      }
      if (Object.keys(won).length) {
        const seats = Object.entries(won).map(([k, v]) => ({ seat: Number(k), amt: v.amt }));
        const myShowed = mySeat >= 0 && !!t.hand?.players[mySeat] && !t.hand.players[mySeat].folded;
        const total = seats.reduce((a, b) => a + b.amt, 0);
        const apply = () => {
          setGains(won);
          setWinFly({ key: ++keyRef.current, seats });
          const mine = seats.some((x) => x.seat === mySeat);
          if (mine) (isBig(total, ante) ? sfx.bigwin : sfx.win)();
          else if (myShowed) sfx.lose();
          else sfx.pot();
          // 한마디: 끝까지 살아 있던 나 → 내 승/패 대사만. 죽었거나 구경 중 → 이긴 사람 대사만
          if (myShowed) {
            const ch = charOf(mySeat);
            const amt = seats.find((x) => x.seat === mySeat)?.amt ?? 0;
            if (ch) playVoice(ch, mine ? (isBig(amt, ante) ? "bigwin" : "win") : "lose");
          } else {
            const top = [...seats].sort((a, b) => b.amt - a.amt)[0];
            const ch = top ? charOf(top.seat) : null;
            if (ch) playVoice(ch, isBig(top.amt, ante) ? "bigwin" : "win");
          }
        };
        if (staged) pendingWinRef.current = apply;
        else apply();
      }
      if (shoutsNew.length) setShouts((cur) => [...cur.slice(-6), ...shoutsNew]);
      // 라운드가 끝나 건 돈이 팟으로 모였으면 칩이 팟으로 날아감
      const nowBets: Record<number, number> = {};
      for (const [k, v] of Object.entries(t.hand?.players ?? {})) nowBets[Number(k)] = v.bet;
      const moved = Object.entries(prevBetsRef.current)
        .filter(([k, amt]) => amt > 0 && (nowBets[Number(k)] ?? 0) === 0)
        .map(([k, amt]) => ({ seat: Number(k), amt }));
      if (moved.length && t.hand && prevHandRef.current === t.handNo) {
        setFlying({ key: ++keyRef.current, seats: moved });
        sfx.collect();
      }
      prevBetsRef.current = nowBets;
      prevHandRef.current = t.handNo;
      const hd = t.hand;
      if (hd && !hd.result && hd.toAct === mySeat && mySeat >= 0 && t.ev.length) sfx.turn();
      if (seatedRef.current >= 0 && mySeat < 0) {
        const out = (t.ev as PokerEvent[]).find(
          (e) => e.t === "leave" && e.seat === seatedRef.current
        );
        if (out && out.t === "leave" && out.why !== "leave" && out.why !== "cashout")
          setKicked(out.why);
        else if (out && out.t === "leave" && out.why === "leave") exitRef.current();
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
          if (t.seq > seqRef.current) {
            if (seqRef.current >= 0) digest(t);
            seqRef.current = t.seq;
          }
          const mine = t.seats.find((s) => s?.uid === uid);
          if (mine) seatedRef.current = mine.seat;
          // 나가기 예약이 켜지거나 꺼지면 알림 (내가 누르지 않았는데 켜졌으면 오래 비워서)
          const ex = !!mine?.exit;
          if (mine && exitMineRef.current !== null && ex !== exitMineRef.current) {
            const text = ex
              ? exitAskRef.current
                ? "나가기 예약 · 이번 판이 끝나면 나가요"
                : "자리를 오래 비워서 나가기 예약됐어요"
              : "나가기 예약을 취소했어요";
            setInfo({ text, key: Date.now() });
            exitAskRef.current = false;
          }
          exitMineRef.current = mine ? ex : null;
          for (const s of t.seats) if (s) preloadChar(s.look ?? s.char, POSES, FACES);
        }
        setTable(t);
      },
      onChat: () => {},
      onError: (e: ApiError) => {
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

  // 시간이 지난 말풍선 · 포즈 · 표정은 지움
  const transient =
    Object.keys(poses).length +
    Object.keys(faces).length +
    Object.keys(emotes).length;
  useEffect(() => {
    if (!transient) return;
    const idt = setInterval(() => {
      const now = Date.now();
      const prune = <T extends { until: number }>(m: Record<number, T>) => {
        const next = Object.fromEntries(
          Object.entries(m).filter(([, v]) => v.until > now)
        ) as Record<number, T>;
        return Object.keys(next).length === Object.keys(m).length ? m : next;
      };
      setPoses(prune);
      setFaces(prune);
      setEmotes(prune);
    }, 250);
    return () => clearInterval(idt);
  }, [transient]);

  // 나눠 주기 연출이 끝나면 지움 (그 뒤로 카드가 다시 그려져도 늦게 나타나지 않게)
  useEffect(() => {
    if (!dealFx) return;
    const total = dealFx.items.length * dealFx.step + dealFx.fly + 400;
    const key = dealFx.key;
    const id = setTimeout(() => setDealFx((d) => (d && d.key === key ? null : d)), total);
    return () => clearTimeout(id);
  }, [dealFx]);

  // 패 까기: 한 자리씩 뒤집고(촥 → 족보 도장 쾅 → 그 사람이 자기 족보를 읊음), 이긴 사람 앞에서 한 박자 더,
  // 다 깐 뒤 결과(승리 · 패배 동작과 대사). 족보 대사가 있으면 다 듣고 다음 사람으로
  useEffect(() => {
    if (!reveal || reveal.step > reveal.order.length) return;
    const n = reveal.order.length;
    const beforeLast = reveal.step === n - 1 && n > 1;
    const spoke = reveal.step > 0 && !!reveal.say[reveal.step - 1];
    const delay =
      reveal.step === n
        ? spoke
          ? 1500
          : 650
        : reveal.step === 0
          ? 520
          : spoke
            ? beforeLast
              ? 1900
              : 1600
            : beforeLast
              ? 820
              : 460;
    const key = reveal.key;
    const id = setTimeout(() => {
      if (reveal.step < n) {
        sfx.flip();
        setTimeout(sfx.stamp, 230);
        const say = reveal.say[reveal.step];
        if (say) setTimeout(() => playVoice(say.look, say.line), 380);
      } else {
        pendingWinRef.current?.();
        pendingWinRef.current = null;
      }
      setReveal((r) => (r && r.key === key ? { ...r, step: r.step + 1 } : r));
    }, delay);
    return () => clearTimeout(id);
  }, [reveal]);

  // ── 앉기 ──
  const sittingRef = useRef(false);
  const trySit = useCallback(
    async (pw?: string, again?: boolean) => {
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
        } else if (again && err.code === "TABLE_FULL") {
          // 다시 앉으려는데 자리가 꽉 참 → 알리고 로비로
          setNotice("자리가 꽉 찼어요. 로비로 돌아갈게요.");
          setTimeout(() => exitRef.current(), 1600);
        } else {
          setSitState("watching");
          const min =
            err.code === "NEED_MONEY" ? (err.data as { min?: number } | undefined)?.min : undefined;
          setNotice(
            min
              ? `칩이 입장컷(${fmtWon(min)})보다 적어서 앉을 수 없어요.`
              : (err.message ?? "앉지 못했어요.")
          );
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 처음 한 번 서버에 앉기를 요청
    if (loaded && exists && sitState === "joining") void trySit();
  }, [loaded, exists, sitState, trySit]);

  const me: SeatWire | null = useMemo(
    () => table?.seats.find((s) => s?.uid === uid) ?? null,
    [table, uid]
  );
  const mySeat = me?.seat ?? -1;
  const hand = table?.hand ?? null;
  const deadline = hand && !hand.result ? hand.deadline : 0;
  const now = useNow(deadline > 0);

  const tickRef = useRef(0);
  const hurryRef = useRef(0);
  useEffect(() => {
    if (!hand || hand.result || !deadline) return;
    const mine =
      mySeat >= 0 &&
      (hand.toAct === mySeat ||
        (hand.game === "seven" &&
          hand.phase === "choice" &&
          hand.players[mySeat] &&
          !hand.players[mySeat].chosen));
    const left = Math.ceil((deadline - now) / 1000);
    // 남이 오래 고민하면(베팅 차례에서 8초 넘게) 가끔 다른 사람이 재촉 (차례마다 한 번, 40%). 카드 고르는 중에는 안 함
    const betting = hand.toAct >= 0 && !(hand.game === "seven" && hand.phase === "choice");
    if (!mine && betting && left === 4 && hurryRef.current !== deadline && table) {
      hurryRef.current = deadline;
      const others = table.seats.filter(
        (x) => x && x.seat !== hand.toAct && x.seat !== mySeat && x.status === "in"
      );
      if (others.length && Math.random() < 0.4) {
        const who = others[Math.floor(Math.random() * others.length)]!;
        playVoice(who.look ?? who.char, "hurry");
      }
    }
    if (mine && left > 0 && left <= 3 && tickRef.current !== deadline * 10 + left) {
      tickRef.current = deadline * 10 + left;
      if (left === 1) sfx.tickLast();
      else sfx.tick();
    }
  }, [now, deadline, hand, mySeat, table]);

  const myChar = me ? (me.look ?? me.char) : null;
  useEffect(() => {
    myCharRef.current = myChar;
  }, [myChar]);

  // 배경음악: 판돈 단계별, 누가 올인해서 끝까지 가는 동안은 긴장 곡
  const tense = !!hand && !hand.result && Object.values(hand.players).some((p) => p.allIn);
  const tierId = table?.tier ?? 0;
  useEffect(() => {
    if (tierId) playBgm(tense ? "bgm-allin" : `bgm-${["low", "mid", "vip"][tierId - 1]}`);
  }, [tierId, tense]);

  // 내 패가 메이드(트리플 이상)가 되면 효과음 + 혼잣말
  const madeNow = (() => {
    if (!hand || hand.result || !myHand || !table || myHand.handNo !== table.handNo) return "";
    const cat =
      hand.game === "holdem"
        ? (hand as HoldemView).board.length >= 3
          ? categoryOf(evaluate([...myHand.cards, ...(hand as HoldemView).board]))
          : -1
        : myHand.down && myHand.cards.length >= 5
          ? kCategory(bestK(myHand.cards).score)
          : -1;
    return cat >= 3 ? `${table.handNo}:${cat}` : "";
  })();
  useEffect(() => {
    if (!madeNow) return;
    sfx.made();
    if (myCharRef.current) playVoice(myCharRef.current, "made");
  }, [madeNow]);

  // 판·구가 바뀌면 미리 행동은 지움
  const preKey = `${table?.handNo ?? 0}:${table?.hand?.game === "holdem" ? (table.hand as HoldemView).street : table?.hand?.game === "seven" ? (table.hand as SevenView).round : 0}`;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 구가 바뀌면 미리 행동을 지움
    setPre("");
  }, [preKey]);

  const actingRef = useRef(false);
  /** 이미 행동한 차례의 deadline (그 차례의 카운트다운을 숨김) */
  const [actedDeadline, setActedDeadline] = useState(0);
  const doAct = useCallback(
    async (action: HoldemAction | SevenAction) => {
      if (!table || actingRef.current) return;
      actingRef.current = true;
      setBusy(true);
      setNotice("");
      // 이 차례(deadline 가 차례마다 다름)에는 이미 행동했으니 카운트다운을 숨김 — 서버 상태가 늦게 와도 안 뜸
      setActedDeadline(table.hand && !table.hand.result ? table.hand.deadline : 0);
      setPre("");
      try {
        await act(id, table.handNo, action);
      } catch (e) {
        const err = e as ApiError;
        if (err.code !== "STALE" && err.code !== "NOT_YOUR_TURN") {
          setNotice(err.message ?? "처리하지 못했어요.");
          setActedDeadline(0);
        }
      } finally {
        actingRef.current = false;
        setBusy(false);
      }
    },
    [id, table]
  );

  // 미리 행동: 내 차례가 오면 잠깐 뒤 자동으로. 금액이 상대적인 베팅(삥·따당·쿼터·하프)은 그때 금액으로, 콜은 얼마가 됐든 콜
  useEffect(() => {
    if (!pre || busy) return;
    const hd = table?.hand;
    const seat = me?.seat ?? -1;
    if (!hd || hd.result || seat < 0 || hd.toAct !== seat) return;
    const run = setTimeout(() => {
      if (hd.game === "holdem") {
        const lg = (hd as HoldemView).legal;
        if (lg) {
          if (pre === "fold") void doAct({ a: "fold" });
          else if (pre === "cf") void doAct(lg.canCheck ? { a: "check" } : { a: "fold" });
          else if (pre === "call") {
            // 받을 돈이 생기면 얼마든 콜, 없으면 체크
            if (lg.toCall === 0) void doAct({ a: "check" });
            else void doAct({ a: "call" });
          }
        }
      } else {
        const sv2 = hd as SevenView;
        const lg = sv2.legal;
        if (sv2.phase === "bet" && lg) {
          if (pre === "die") void doAct({ a: "die" });
          else if (pre === "callbbing") {
            // 받을 돈이 있으면 얼마든(삥·따당·하프…) 콜, 없으면 삥
            if (lg.toCall > 0) void doAct({ a: "call" });
            else if (lg.bets.bbing !== undefined) void doAct({ a: "bbing" });
          } else if (pre === "ddadang" || pre === "quarter" || pre === "half") {
            if (lg.bets[pre] !== undefined) void doAct({ a: pre });
          }
        }
      }
      setPre("");
    }, 400);
    return () => clearTimeout(run);
  }, [pre, busy, table, me, doAct]);

  // 나가기 예약 중에 다이(폴드)하면 더 칠 게 없으니 바로 로비로 (자리 정리 · 정산은 판이 끝날 때 서버가 함)
  const myFolded = !!(me?.exit && hand && !hand.result && hand.players[me.seat]?.folded);
  useEffect(() => {
    if (!myFolded) return;
    const t = setTimeout(() => exitRef.current(), 700);
    return () => clearTimeout(t);
  }, [myFolded]);

  /** 내 연결이 끊겼다가 다시 붙는 중 (잠깐 끊긴 건 1.2초 뒤에야 표시) */
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let tm: ReturnType<typeof setTimeout> | undefined;
    const off = onConnection((c) => {
      clearTimeout(tm);
      if (c) setOffline(false);
      else tm = setTimeout(() => setOffline(true), 1200);
    });
    return () => {
      clearTimeout(tm);
      off();
    };
  }, []);

  /** 아래 행동 바의 실제 높이 (세로판에서 내 이름표 · 작은 버튼을 그 위에 붙임) */
  const [actH, setActH] = useState(48);
  const actObs = useRef<ResizeObserver | null>(null);
  const actRef = useCallback((el: HTMLDivElement | null) => {
    actObs.current?.disconnect();
    if (!el) return;
    const ro = new ResizeObserver(() => setActH(Math.round(el.offsetHeight)));
    ro.observe(el);
    actObs.current = ro;
  }, []);

  /** 나가기: 앉아 있지 않으면 바로 로비로. 판 중이면 서버에 나가기 예약을 켜고/끄고, 판에 안 끼어 있으면 서버가 바로 내보냄 */
  const exit = async () => {
    if (!me) {
      try {
        await leave(id);
      } catch {}
      return onExit();
    }
    try {
      exitAskRef.current = true;
      const r = await setExit(id, !me.exit);
      if (r.left) onExit();
    } catch (e) {
      setNotice((e as ApiError).message ?? "처리하지 못했어요.");
    }
  };

  const u = Math.min(w, h) / 100;
  if (table === undefined)
    return (
      <Shell o={o} tier={2}>
        <p className="absolute inset-0 flex items-center justify-center text-white/60">
          테이블에 연결하는 중…
        </p>
      </Shell>
    );
  if (table === null)
    return (
      <Shell o={o} tier={2}>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
          <p className="text-white/70">{notice || "테이블이 닫혔어요."}</p>
          <button type="button" onClick={onExit} className="pk-btn pk-btn-white px-6 py-3">
            로비로 돌아가기
          </button>
        </div>
      </Shell>
    );

  const tier = TIERS[table.tier - 1];
  const n = table.seats.length;
  const hv = hand?.game === "holdem" ? (hand as HoldemView) : null;
  const sv = hand?.game === "seven" ? (hand as SevenView) : null;
  /** 세로판인데 덜 길쭉함(폰 · 전체화면 아님): 줄 단위 픽셀 배치 */
  const C =
    o === "v" && h < w * COMPACT_RATIO
      ? compactV(w, h, n, table.game === "seven", table.game === "seven" ? 72 : 140)
      : null;
  const L = C ? C.L : layoutFor(o, n);
  const sizes: Sizes = C
    ? { o, u, ...C.sizes }
    : o === "h"
      ? {
          o,
          u,
          card: sv ? u * 6 : u * 6.2,
          heroCard: sv ? u * 9 : u * 11.5,
          boardCard: u * 9.5,
          face: u * 8.5,
        }
      : {
          o,
          u,
          card: sv ? u * 7.2 : u * 7,
          heroCard: sv ? u * 11.5 : u * 15,
          boardCard: u * 13.5,
          face: u * 12,
        };
  /** 세로판: 내 이름표 아래 끝(무대 아래에서 px) — 행동 바 바로 위, 좁은 배치면 내 줄 */
  const heroPlateBottom = C ? Math.max(h - C.heroBottom, actH + 14) : actH + 14;
  const base = table.game === "holdem" ? tier.bb : tier.ante;
  const totalMs = sv && sv.phase === "choice" ? CHOICE_MS : ACT_MS;
  const frac = deadline ? Math.max(0, Math.min(1, (deadline - now) / totalMs)) : 0;
  /** 남은 초 (3초 이하면 3 · 2 · 1 카운트다운) */
  const secLeft = deadline ? Math.ceil((deadline - now) / 1000) : 0;
  const counting = secLeft >= 1 && secLeft <= 3;
  const liveHand = myHand && myHand.handNo === table.handNo && hand ? myHand : null;
  const hint =
    !me || !liveHand ? "" : hv ? holdemHint(liveHand, hv) : sv ? sevenHint(liveHand) : "";
  const isWaiting = (seat: number) =>
    !!hand &&
    !hand.result &&
    (hand.toAct === seat ||
      (!!sv &&
        sv.phase === "choice" &&
        !!sv.players[seat] &&
        !sv.players[seat].chosen &&
        !sv.players[seat].folded));
  const myTurn = mySeat >= 0 && isWaiting(mySeat);
  const actor = hand && !hand.result && hand.toAct >= 0 ? table.seats[hand.toAct] : null;
  /** 자리 번호 → 배치 (내 자리가 0번) */
  const spotOf = (seat: number) => L.spots[(seat - Math.max(0, mySeat) + n) % n];
  /** 패 까기 연출이 끝났나 (그 전엔 결과를 숨김) */
  const revealDone = !reveal || reveal.handNo !== table.handNo || reveal.step > reveal.order.length;
  /** 그 자리의 패를 깠나 */
  const revealed = (seat: number) => revealDone || reveal!.step > reveal!.order.indexOf(seat);
  /** 나눠 주기 연출 중이면 그 자리 카드가 손에 도착하는 시각 */
  const dealOf = (seat: number): SeatCardsProps<unknown>["dealDelay"] => {
    if (!dealFx || dealFx.handNo !== table.handNo) return undefined;
    const mine = dealFx.items.filter((x) => x.seat === seat);
    if (!mine.length) return undefined;
    return (i, n) => {
      const it = mine.find((x) => x.idx === i || (x.idx === -1 && i === n - 1));
      return it ? it.k * dealFx.step + dealFx.fly : undefined;
    };
  };
  /** 결과 (판은 끝났지만 패 까기 연출 중이면 아직 숨김) */
  const rawRes = hand?.result ?? null;
  const res = revealDone ? rawRes : null;
  const winners = res ? Object.keys(res.won).map(Number) : [];
  const poseOf = (seat: number): Pose => {
    const p = hand?.players[seat];
    const t = poses[seat]; // (시간이 지난 것은 주기적으로 지워짐)
    if (t) return t.v;
    if (res) {
      if ((res.won[seat] ?? 0) > 0) return "win";
      if (res.showdown && p && !p.folded) return "lose";
      return "idle";
    }
    if (p?.folded) return "die";
    if (hand && !hand.result && hand.toAct === seat) return "think";
    return "idle";
  };
  const faceOf = (seat: number): Face => {
    const p = hand?.players[seat];
    const t = faces[seat];
    if (t) return t.v;
    if (res)
      return (res.won[seat] ?? 0) > 0 ? "smile" : res.showdown && p && !p.folded ? "sad" : "idle";
    if (hand && !hand.result && isWaiting(seat)) return "think";
    if (p?.folded) return "sad";
    return "idle";
  };

  const H = o === "h";
  const tableW = (L.table.w / 100) * w;
  const tableH = tableW * (H ? 544 / 1400 : 1111 / 900);
  const tableTop = (L.table.top / 100) * h;
  const heroSprH = (L.heroSpriteH / 100) * h;
  const sprH = (L.spriteH / 100) * h;
  const sprW = (sprH * 3) / 4;
  const panelW = H ? Math.min(260, Math.max(200, w * 0.2)) : 0;
  /** 가로판: 오른쪽 패널만큼 판을 왼쪽으로 */
  const boardW = w - panelW;
  const px = (pct: number) => (pct / 100) * boardW;
  const py = (pct: number) => (pct / 100) * h;
  const bar = 40;
  /** 자리의 가로 위치: 캐릭터 그림도 이름표(최소 폭)도 무대 밖으로 안 나가게 */
  const plateHalf = Math.max(84, sprW * 0.62) / 2 + 6;
  const seatX = (pct: number) =>
    Math.max(
      Math.max(sprW * 0.5, plateHalf),
      Math.min(boardW - Math.max(sprW * 0.5, plateHalf), px(pct))
    );
  /**
   * 자리의 세로 위치. 가로판 왼쪽 자리는 내 캐릭터(왼쪽 아래) 머리 위로 올려 이름표·카드가 안 가려지게 —
   * 단 그 위 맞은편 자리와는 안 겹치게.
   */
  const seatY = (sp: Spot) => {
    const y = py(sp.y);
    if (!H || sp.side !== "left") return y;
    const heroTop = h - 8 - (sizes.face * 1.3 + 10) + 8 - heroSprH;
    const above = L.spots.reduce(
      (m, q) => (q.side === "top" && q.y < sp.y ? Math.max(m, q.y) : m),
      0
    );
    const lo = above > 0 ? py(above) + 64 : bar + 8;
    return Math.max(Math.min(y, heroTop - 84), Math.min(y, lo));
  };
  const myCat = !liveHand
    ? -1
    : hv
      ? hv.board.length >= 3
        ? categoryOf(evaluate([...liveHand.cards, ...hv.board]))
        : -1
      : sv && liveHand.down && liveHand.cards.length >= 5
        ? kCategory(bestK(liveHand.cards).score)
        : -1;
  /** 그 자리의 건 돈이 놓이는 곳 (칩 날리기 시작점) */
  const betPoint = (seat: number) => {
    if (seat === mySeat) return { x: (L.heroX / 100) * boardW, y: (L.heroCards / 100) * h - 18 };
    const idx = (seat - Math.max(0, mySeat) + n) % n;
    const sp = L.spots[idx];
    const x = seatX(sp.x);
    const y = seatY(sp);
    if (H) {
      const f = sp.side === "top" ? 0.45 : 0.5;
      return { x: x + (px(L.table.cx) - x) * f, y: y + (py(L.center.board) - y) * f };
    }
    // 세로판: 건 돈이 그 사람 카드(= 족보)를 가리지 않게 카드가 없는 쪽에
    const half = Math.max(84, sprW * 0.62) / 2;
    const cardH = sizes.card * 1.4;
    if (sp.side === "top") return { x, y: y + 52 + 4 + cardH + 14 }; // 카드 아래
    const dir = sp.side === "left" ? 1 : -1;
    if (C?.cardSide[idx] === "below") {
      // 이름표 위 안쪽 (카드는 아래). 바로 위 자리의 건 돈(그 사람 엎은 카드 위)과 겹치면 이름표 옆 안쪽으로
      const up = { x: x + dir * (half + 22), y: y - 14 };
      const pillHalf = betHalfW();
      const clash = L.spots.some((o, j) => {
        if (j === idx || !o || o.side !== sp.side || C.cardSide[j] === "below") return false;
        const ox = seatX(o.x) + dir * (half + 6 + sizes.card * 1.3);
        const oy = seatY(o) + 26;
        return Math.abs(clampBetX(ox) - clampBetX(up.x)) < pillHalf * 2 && Math.abs(oy - up.y) < 34;
      });
      return clash ? { x: x + dir * (half + pillHalf + 6), y: y + 30 } : up;
    }
    // 카드가 옆이면: 촘촘한 판에선 엎어 둔 카드 위에 겹쳐 둠(뒷면이라 가려도 됨), 아니면 이름표 아래.
    // 좁은 폰에서 그 자리가 다른 사람 이름표에 걸리면 이름표 아래 → 이름표 위 순으로 비킴
    const cands = [
      ...(C ? [{ x: x + dir * (half + 6 + sizes.card * 1.3), y: y + 26 }] : []),
      { x: x + dir * half * 0.35, y: y + 52 + 14 },
      { x: x + dir * half * 0.35, y: y - 14 },
    ];
    const pillHalf = betHalfW();
    const hits = (c: { x: number; y: number }) => {
      const cx = clampBetX(c.x);
      for (let j = 0; j < n; j++) {
        if (j === idx || !L.spots[j]) continue;
        const o = L.spots[j];
        const ox = seatX(o.x);
        const oy = seatY(o);
        if (Math.abs(cx - ox) < pillHalf + half && c.y + 13 > oy - 2 && c.y - 13 < oy + 54) return true;
      }
      return false;
    };
    return cands.find((c) => !hits(c)) ?? cands[0];
  };
  /** 건 돈 알약 폭의 절반 (어림: 칩 + 글자 다섯 자쯤) */
  const betHalfW = () => {
    const fpx = Math.min(15, Math.max(11, u * 1.45 + 4.6));
    return (Math.max(22, u * 3.4) * 1.25 + fpx * 1.5 * 3.6) / 2;
  };
  /** 건 돈 알약이 무대 밖으로 안 나가게 (폭은 어림: 칩 + 글자 다섯 자쯤) */
  const clampBetX = (x: number) => {
    const half = betHalfW();
    return Math.max(half + 4, Math.min(boardW - half - 4, x));
  };
  /** 외침이 시작되는 곳: 그 캐릭터의 머리 근처 */
  const shoutFrom = (seat: number) => {
    if (seat === mySeat)
      return H
        ? { x: 24 + (heroSprH * 3) / 8, y: h - 8 - heroSprH * 0.8 }
        : { x: (L.heroX / 100) * boardW, y: (L.heroCards / 100) * h - 16 };
    const sp = spotOf(seat);
    const x = seatX(sp.x);
    if (sp.y >= 99) return { x, y: py(sp.y) - sizes.face * 1.6 };
    return { x, y: seatY(sp) - sprH * 0.78 };
  };
  /** 세로판: 내 이름표 위에 서 있는 내 캐릭터 — 옆 아랫자리 묶음 아래 빈 곳만큼 (내 차례 기준 크기로 고정) */
  const heroSprV = (() => {
    if (H) return 0;
    const sp1 = L.spots[1];
    const above = C ? C.sideBottom + 4 : sp1 ? py(sp1.y) - 6 + 52 + 6 : bar + 8;
    const refBottom = C ? h - C.heroBottom : sv ? 92 : 152;
    const v = Math.min(h * 0.2, (h - refBottom - 58 - above) / 0.68);
    return v >= 56 ? v : 0;
  })();
  /** 메이드(트리플 이상): 키가 바뀔 때마다 터지는 효과가 한 번 재생됨 */
  const madeKey = myCat >= 3 ? `${table.handNo}:${myCat}` : "";
  const emote = (e: Emote) => {
    setDrawer("");
    sendEmote(id, e).catch((err: ApiError) => setNotice(err.message ?? ""));
  };

  return (
    <Shell o={o} tier={table.tier} turn={myTurn}>
      <div className="absolute inset-y-0 left-0" style={{ width: boardW }}>
        {/* 테이블 */}
        {}
        <img
          src={asset.table(table.tier, o)}
          alt=""
          draggable={false}
          className="pk-table-img"
          style={{
            left: px(L.table.cx) - tableW / 2,
            top: tableTop,
            width: tableW,
            height: tableH,
            zIndex: 3,
          }}
        />

        {/* 가운데: 팟 · 바닥 카드 · 상태 */}
        <div
          className="absolute flex flex-col items-center gap-[0.5em]"
          style={{
            left: px(L.table.cx),
            top: py(L.center.pot),
            transform: "translateX(-50%)",
            zIndex: 6,
            width: tableW * 0.7,
          }}
        >
          <Center
            hand={hand}
            table={table}
            base={base}
            sizes={sizes}
            res={rawRes}
            settled={revealDone}
          />
        </div>

        {/* 다른 자리: 얼굴 틀 · 이름표 · 카드 · 건 돈 */}
        {table.seats.map((s, i) => {
          if (i === mySeat) return null;
          const sp = spotOf(i);
          const p = hand?.players[i];
          const live = !!p && !!s && !p.folded && !rawRes;
          const inHand = !!p && !!s && (s.status === "in" || live);
          const bet = inHand && !rawRes ? p!.bet : 0;
          const x = seatX(sp.x);
          const y = seatY(sp);
          const betAt = betPoint(i);
          if (!s)
            return (
              <div
                key={i}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: x, top: y - sizes.face * 0.3, zIndex: 5 }}
              >
                {sitState === "watching" || sitState === "password" ? (
                  <button
                    type="button"
                    onClick={() => void trySit()}
                    className="pk-btn pk-btn-ghost px-[0.9em] py-[0.4em] text-[0.8em]"
                  >
                    앉기
                  </button>
                ) : (
                  <span
                    title="빈자리"
                    className="block rounded-[12px] border border-dashed border-white/[0.08]"
                    style={{ width: sizes.face, height: sizes.face }}
                  />
                )}
              </div>
            );
          const cards = !hand
            ? null
            : hv
              ? holdemSeatCards({
                  view: hv,
                  seat: i,
                  hero: false,
                  myHand: null,
                  tier: table.tier,
                  sizes,
                  side: sp.side,
                  hide: !revealed(i),
                  settled: revealDone,
                  dealDelay: dealOf(i),
                })
              : sevenSeatCards({
                  view: sv!,
                  seat: i,
                  hero: false,
                  myHand: null,
                  tier: table.tier,
                  sizes,
                  side: sp.side,
                  hide: !revealed(i),
                  settled: revealDone,
                  dealDelay: dealOf(i),
                  // 폰 세로판(길쭉한 화면): 양옆 자리 카드는 판 가운데까지만
                  maxW:
                    o === "v" && !C && sp.side !== "top"
                      ? Math.max(
                          60,
                          sp.side === "left"
                            ? px(L.table.cx) - (x + plateHalf + 6) - 5
                            : x - plateHalf - 6 - px(L.table.cx) - 5
                        )
                      : undefined,
                });
          const wonHere = res?.won[i] ?? 0;
          // 누가 더 올리면(하프 · 레이즈) 그 전에 삥 · 콜 · 체크로 맞춰 둔 사람의 꼬리표는 지움 — 다시 행동해야 하니까
          const stale =
            !!p && !p.folded && !p.allIn && !!hand && !hand.result && p.bet < hand.currentBet;
          const tag = p?.last && !res && !stale ? p.last.a : null;
          const badge =
            hv && hv.button === i
              ? "D"
              : hv && hv.street === 0 && !hv.result && (hv.sbSeat === i || hv.bbSeat === i)
                ? hv.bbSeat === i
                  ? "BB"
                  : "SB"
                : null;
          const dim = p?.folded || (s.status !== "in" && !live);
          // 앉은 캐릭터: 그림의 테이블 선(470/512)이 자리 y 에 오게, 테이블 그림 뒤에
          const sprTop = y - sprH * SEAT_LINE;
          // 구경 중일 때 6시(내 자리였을 곳)에 오는 사람: 등을 보이는 그림이 없으니 캐릭터는 안 그림
          const hideSprite = sp.y >= 99;
          // 카드는 이름표 옆(테이블 안쪽), 위 자리는 아래
          const cardSide =
            C?.cardSide[(i - Math.max(0, mySeat) + n) % n] === "below"
              ? "below"
              : sp.side === "right"
                ? "left"
                : sp.side === "left" || o === "h"
                  ? "right"
                  : "below";
          const waiting = isWaiting(i);
          const resultName = hand?.result?.names[i] && revealed(i) ? hand.result.names[i] : "";
          /** 이름표 아래 꼬리표들의 높이(em) — 카드가 아래로 올 때 그만큼 내림 */
          const tagsEm = (resultName ? 2.2 : 0) + (s.votes > 0 ? 1.1 : 0) + (s.exit ? 1.1 : 0);
          // 가로판 맞은편 가운데 자리: 아래 꼬리표가 팟을 덮으면 이름표 위(캐릭터 몸통)에
          const tagAbove = H && Math.abs(x - px(L.table.cx)) < 140 && y + 91 > py(L.center.pot);
          // 무대 가장자리에 붙은 자리: 이름표 아래 꼬리표(족보·강퇴 등)가 밖으로 안 나가게 안쪽으로 붙임
          const edgeAlign =
            sp.side === "right" && x + plateHalf > boardW - 40
              ? "items-end"
              : sp.side === "left" && x - plateHalf < 40
                ? "items-start"
                : "items-center";
          return (
            <div key={i}>
              {!hideSprite && (
                <div
                  className={`pk-seat-char pointer-events-none absolute ${wonHere > 0 ? "pk-seat-win" : waiting ? "pk-seat-turn" : ""}`}
                  style={{ left: x - sprW / 2, top: sprTop, zIndex: sp.side === "top" ? 2 : 4 }}
                >
                  <CharSprite
                    char={s.look ?? s.char}
                    pose={poseOf(i)}
                    seat={sp.side === "top" ? "front" : "side"}
                    flip={sp.side === "right"}
                    w={sprW}
                    dim={dim}
                  />
                </div>
              )}
              {/* 말풍선: 머리 위 */}
              <div
                className="pointer-events-none absolute"
                style={{ left: x, top: sprTop + sprH * 0.05, zIndex: 40 }}
              >
              </div>
              {/* 이모티콘 말풍선: 캐릭터를 가리지 않게 머리 옆(테이블 안쪽)에, 꼬리가 머리를 가리킴 — 무대 밖으로 안 나가게 */}
              {emotes[i] &&
                (() => {
                  const size = Math.round(Math.max(44, Math.min(96, u * 13)));
                  const dir =
                    sp.side === "right" ? -1 : sp.side === "left" ? 1 : x < px(L.table.cx) ? 1 : -1;
                  const headW = hideSprite ? sizes.face : sprW * 0.42;
                  const ex = Math.max(
                    size / 2 + 4,
                    Math.min(boardW - size / 2 - 4, x + dir * (headW / 2 + size / 2 + 10))
                  );
                  const headTop = hideSprite ? y - sizes.face * 2.2 : sprTop + sprH * 0.04;
                  const ey = Math.max(bar + 4, headTop);
                  return (
                    <div
                      key={emotes[i].key}
                      className="pk-emote pointer-events-none absolute"
                      style={{ left: ex - size / 2, top: ey, zIndex: 40 }}
                    >
                      <EmoteBubble tail={dir > 0 ? "l" : "r"}>
                        <EmoteImg char={s.look ?? s.char} emote={emotes[i].v} size={size} />
                      </EmoteBubble>
                    </div>
                  );
                })()}
              <div
                className="absolute w-max"
                style={{
                  left: x,
                  top: hideSprite ? y - sizes.face * 1.6 : y - 6,
                  transform: "translateX(-50%)",
                  zIndex: 7,
                }}
              >
                <div className="relative flex flex-col items-center">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setStatSeat(i)}
                    onKeyDown={(e) => e.key === "Enter" && setStatSeat(i)}
                    className="pk-plate relative cursor-pointer"
                    data-turn={waiting ? "1" : undefined}
                    style={{
                      minWidth: Math.max(84, sprW * 0.62),
                      opacity: dim ? 0.7 : 1,
                      borderColor: wonHere > 0 ? "var(--pk-brass)" : undefined,
                    }}
                  >
                    {tag && (
                      // 행동 글자는 언제나 그 사람 이름표 바로 위 가운데 (구석으로 붙이면 잘 안 보여서)
                      <ActTag key={`${table.handNo}-${tag}-${p?.bet ?? 0}`} a={tag} />
                    )}
                    {badge && <span className="pk-badge">{badge}</span>}
                    {gains[i] && wonHere > 0 && (
                      <Rise
                        key={gains[i].key}
                        className="absolute -top-[1.2em] left-1/2 -translate-x-1/2 text-[1.2em] text-[var(--pk-brass)]"
                      >
                        +{fmtShort(gains[i].amt)}
                      </Rise>
                    )}
                    <div
                      className="pk-name truncate"
                      style={{ maxWidth: Math.max(96, sprW * 0.8) }}
                    >
                      {s.name}
                    </div>
                    <div className="pk-stack pk-num whitespace-nowrap">
                      {p?.allIn && !res ? (
                        <span className="text-[var(--pk-danger)]">ALL IN</span>
                      ) : s.status === "out" && !live ? (
                        <span className="text-white/45">자리 비움</span>
                      ) : (
                        <Money won={s.stack} />
                      )}
                    </div>
                    {s.away ? (
                      <span className="pk-net-mark pk-net-in">
                        <i />
                        연결 불안정…
                      </span>
                    ) : (
                      p &&
                      !res && (
                        <div className="text-[0.7em] leading-tight whitespace-nowrap text-white/55">
                          베팅 <Money won={p.invested} className="text-[1.1em] text-white/80" />
                        </div>
                      )
                    )}
                    {waiting && deadline > 0 && (
                      <PlateTimer frac={frac} />
                    )}
                    {waiting && counting && (
                      <span key={secLeft} className="pk-count-sm" aria-label={`${secLeft}초`}>
                        {secLeft}
                      </span>
                    )}
                  </div>
                  {/* 이름표 아래 꼬리표: 이름표 폭에 맞춰 두고, 가장자리 자리에선 안쪽으로 붙여 무대 밖으로 안 나가게 */}
                  {(s.votes > 0 || s.exit || resultName) && (
                    <div
                      className={`pointer-events-none absolute inset-x-0 flex w-full ${tagAbove ? "bottom-full flex-col-reverse pb-[0.3em]" : "top-full flex-col"} ${edgeAlign}`}
                    >
                      {s.votes > 0 && (
                        <span className="pk-vote-mark" title="강퇴 투표">
                          ⚠ 강퇴 {s.votes}/3
                        </span>
                      )}
                      {s.exit && <span className="pk-exit-mark">나가기 예약</span>}
                      {resultName && (
                        <span
                          key={`${table.handNo}-${revealDone ? 1 : 0}`}
                          className={`pk-resulttag pk-stamp mt-[0.25em] ${res && wonHere > 0 ? "pk-resulttag-win" : ""}`}
                        >
                          <span className="pk-tag-t">{resultName}</span>
                        </span>
                      )}
                    </div>
                  )}
                  {cards && (
                    <div
                      className="absolute"
                      style={
                        cardSide === "right"
                          ? { left: "100%", top: 0, marginLeft: 6 }
                          : cardSide === "left"
                            ? { right: "100%", top: 0, marginRight: 6 }
                            : {
                                top: "100%",
                                marginTop: `calc(4px + ${tagsEm}em)`,
                                left: "50%",
                                transform: "translateX(-50%)",
                              }
                      }
                    >
                      {cards}
                    </div>
                  )}
                </div>
              </div>
              {bet > 0 && (
                <div
                  className="absolute w-max -translate-x-1/2 -translate-y-1/2 whitespace-nowrap"
                  style={{ left: clampBetX(betAt.x), top: betAt.y, zIndex: 8 }}
                >
                  <Bet
                    won={bet}
                    ratio={bet / base}
                    size={Math.max(22, u * 3.4)}
                    act={stale ? undefined : p?.last?.a}
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* 카드 나눠 주기: 판 가운데(딜러)에서 각 자리로 한 장씩 날아감 */}
        {dealFx &&
          dealFx.handNo === table.handNo &&
          (() => {
            const ox = px(L.table.cx);
            const oy = py(L.center.pot) + 20;
            const cw = sizes.card;
            const target = (seat: number) => {
              if (seat === mySeat)
                return {
                  x: (L.heroX / 100) * boardW,
                  y: (L.heroCards / 100) * h + sizes.heroCard * 0.7,
                  s: sizes.heroCard / cw,
                };
              const idx = (seat - Math.max(0, mySeat) + n) % n;
              const sp = L.spots[idx];
              if (!sp) return null;
              const x = seatX(sp.x);
              const y = seatY(sp);
              const half = Math.max(84, sprW * 0.62) / 2;
              const below = C?.cardSide[idx] === "below" || (sp.side === "top" && !H);
              if (below) return { x, y: y + 52 + 4 + cw * 0.7, s: 1 };
              const dir = sp.side === "right" ? -1 : 1;
              return { x: x + dir * (half + 6 + cw * 0.6), y: y + cw * 0.7, s: 1 };
            };
            return dealFx.items.map((it) => {
              const tg = target(it.seat);
              if (!tg) return null;
              return (
                <span
                  key={`${dealFx.key}-${it.k}`}
                  className="pk-dealfly pointer-events-none absolute"
                  style={
                    {
                      left: ox,
                      top: oy,
                      width: cw,
                      zIndex: 13,
                      backgroundImage: `url(${asset.back(table.tier)})`,
                      animationDelay: `${it.k * dealFx.step}ms`,
                      animationDuration: `${dealFx.fly}ms`,
                      "--dx": `${tg.x - ox}px`,
                      "--dy": `${tg.y - oy}px`,
                      "--s": tg.s,
                      "--r": `${(it.k % 3) * 6 - 6}deg`,
                    } as CSSProperties
                  }
                />
              );
            });
          })()}

        {/* 내 차례 3 · 2 · 1 */}
        {myTurn &&
          counting &&
          !busy &&
          deadline !== actedDeadline &&
          !(sv && sv.phase === "choice" && liveHand?.down) && (
            <div
              key={secLeft}
              className="pk-count pointer-events-none absolute"
              style={{
                left: px(L.table.cx),
                top: py(L.center.board) + sizes.boardCard * 0.7,
                zIndex: 34,
                fontSize: Math.max(64, u * 16),
              }}
            >
              {secLeft}
            </div>
          )}

        {/* 행동 외침: 자리에서 판 가운데로 날아가는 대사 */}
        {shouts.map((sh) => {
          const from = shoutFrom(sh.seat);
          const to = { x: px(L.table.cx), y: py(L.center.board) };
          return (
            <div
              key={sh.key}
              className="pk-shout pointer-events-none absolute"
              style={
                {
                  left: from.x,
                  top: from.y,
                  zIndex: 36,
                  fontSize: Math.max(30, u * 6),
                  color: SHOUT_COLOR[sh.a] ?? "#fff",
                  "--dx": `${(to.x - from.x) * 0.62}px`,
                  "--dy": `${(to.y - from.y) * 0.62}px`,
                } as CSSProperties
              }
              onAnimationEnd={() => setShouts((c) => c.filter((x) => x.key !== sh.key))}
            >
              {ACT_LABEL[sh.a] ?? sh.a}
              {SHOUT_BANG.has(sh.a) ? "!" : ""}
            </div>
          );
        })}

        {/* 이긴 사람에게 날아가는 칩 */}
        {winFly &&
          winFly.seats.flatMap(({ seat }) =>
            [0, 1, 2].map((i) => {
              const from = { x: px(L.table.cx), y: py(L.center.pot) + 14 };
              const to = betPoint(seat);
              return (
                <div
                  key={`${winFly.key}-${seat}-${i}`}
                  className="pk-fly pointer-events-none absolute"
                  style={
                    {
                      left: from.x,
                      top: from.y,
                      zIndex: 12,
                      animationDelay: `${i * 110}ms`,
                      "--dx": `${to.x - from.x}px`,
                      "--dy": `${to.y - from.y}px`,
                    } as CSSProperties
                  }
                  onAnimationEnd={() =>
                    i === 2 && setWinFly((f) => (f && f.key === winFly.key ? null : f))
                  }
                >
                  {}
                  <img
                    src={asset.chip("gold", "stack")}
                    alt=""
                    draggable={false}
                    style={{ width: Math.max(26, u * 4), height: Math.max(26, u * 4) }}
                  />
                </div>
              );
            })
          )}

        {/* 팟으로 모이는 칩 */}
        {flying &&
          flying.seats.map(({ seat, amt }) => {
            const from = betPoint(seat);
            const to = { x: px(L.table.cx), y: py(L.center.pot) + 14 };
            return (
              <div
                key={`${flying.key}-${seat}`}
                className="pk-fly pointer-events-none absolute"
                style={
                  {
                    left: from.x,
                    top: from.y,
                    zIndex: 12,
                    "--dx": `${to.x - from.x}px`,
                    "--dy": `${to.y - from.y}px`,
                  } as CSSProperties
                }
                onAnimationEnd={() => setFlying((f) => (f && f.key === flying.key ? null : f))}
              >
                {}
                <img
                  src={asset.chip(chipColor(amt / base), amt / base >= 2 ? "side" : "top")}
                  alt=""
                  draggable={false}
                  style={{ width: Math.max(26, u * 4), height: Math.max(26, u * 4) }}
                />
              </div>
            );
          })}

        {/* 내 자리 */}
        {me && (
          <HeroArea
            me={me}
            p={hand?.players[mySeat] ?? null}
            hv={hv}
            sv={sv}
            liveHand={liveHand}
            tier={table.tier}
            sizes={sizes}
            L={L}
            boardW={boardW}
            h={h}
            base={base}
            hint={hint}
            res={res}
            face={faceOf(mySeat)}
            pose={poseOf(mySeat)}
            waiting={myTurn}
            frac={frac}
            deadline={deadline}
            gain={gains[mySeat] && (res?.won[mySeat] ?? 0) > 0 ? gains[mySeat] : null}
            emote={emotes[mySeat] ?? null}
            heroSprH={heroSprH}
            isButton={!!hv && hv.button === mySeat}
            onStats={() => setStatSeat(mySeat)}
            madeKey={madeKey}
            settled={revealDone}
            collected={!!rawRes}
            myRevealed={revealed(mySeat)}
            plateBottom={heroPlateBottom}
            compact={!!C}
            sprV={heroSprV}
            dealDelay={dealOf(mySeat)}
            blind={
              hv && hv.street === 0 && !hv.result && (hv.sbSeat === mySeat || hv.bbSeat === mySeat)
                ? hv.bbSeat === mySeat
                  ? "BB"
                  : "SB"
                : null
            }
          />
        )}

        {res && winners.length > 0 && (
          <WinBanner
            names={winners.map((x) => table.seats[x]?.name ?? "?")}
            hand={res.names[winners[0]]}
            mine={winners.includes(mySeat)}
            o={o}
            top={C ? py(L.center.pot) - 6 : undefined}
          />
        )}
        {info && !notice && (
          <div
            key={info.key}
            role="status"
            className="pk-toast"
            style={{ bottom: H ? 190 : 210 }}
            onAnimationEnd={() => setInfo(null)}
          >
            {info.text}
          </div>
        )}
        {notice && (
          <div
            key={notice}
            role="alert"
            className="pk-toast pk-toast-stay"
            style={{ bottom: H ? 190 : 210 }}
          >
            {notice}
          </div>
        )}

        {offline && (
          <div role="status" className="pk-net-mark pk-net-top" style={{ top: bar + 8 }}>
            <i />
            연결 불안정… 다시 연결하는 중
          </div>
        )}

        {/* 가운데 알림: 자리에서 일어남 · 자리 비움 */}
        {(!me && kicked) || me?.status === "out" ? (
          <div
            className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{
              left: px(L.table.cx),
              top: py(L.center.board) + sizes.boardCard * 0.5,
              zIndex: 33,
            }}
          >
            <div className="pk-center-notice pk-pop">
              {!me && kicked ? (
                <KickedNotice
                  why={kicked}
                  wallet={wallet}
                  tierMin={tier.min}
                  tierName={tierLabel(tier.id)}
                  onSit={() => void trySit(undefined, true)}
                  onExit={onExit}
                />
              ) : (
                <div className="flex flex-col items-center gap-[0.55em] text-center">
                  <p className="text-[1.05em] font-bold">자리 비움 중</p>
                  <p className="text-[0.8em] text-white/65">다음 판부터 다시 칠 수 있어요.</p>
                  <div className="flex gap-[0.4em]">
                    <button
                      type="button"
                      onClick={() => void setSitOut(id, false).catch(() => {})}
                      className="pk-btn pk-btn-call px-[1.1em] py-[0.45em] text-[0.88em]"
                    >
                      다시 치기
                    </button>
                    <button
                      type="button"
                      onClick={exit}
                      className="pk-btn pk-btn-ghost px-[1em] py-[0.45em] text-[0.88em]"
                    >
                      나가기
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* 내 차례 시작: 무대 테두리가 한 번 번쩍 */}
        {myTurn && (
          <div
            key={`edge-${table.handNo}-${hv ? hv.street : (sv?.round ?? 0)}`}
            className="pk-turn-edge pointer-events-none absolute inset-0"
            style={{ zIndex: 29 }}
            aria-hidden
          />
        )}
        {/* 행동 바 */}
        <div
          ref={actRef}
          className="pk-actwrap absolute"
          data-turn={myTurn ? "1" : undefined}
          style={
            H
              ? { left: boardW * 0.48, right: 10, bottom: 10, zIndex: 30 }
              : { left: 8, right: 8, bottom: 8, zIndex: 30 }
          }
        >
          {myTurn && !busy && (
            <div
              key={`${table.handNo}-${hand?.toAct}-${hv ? hv.street : (sv?.round ?? 0)}`}
              className="pk-turn-flag pointer-events-none"
              aria-hidden
            >
              내 차례!
            </div>
          )}
          <ActionBar
            revealing={!revealDone}
            o={o}
            u={u}
            me={me}
            sitState={sitState}
            password={password}
            setPassword={setPassword}
            trySit={trySit}
            kicked={kicked}
            wallet={wallet}
            tier={tier}
            onWallet={onWallet}
            onExit={onExit}
            hv={hv}
            sv={sv}
            mySeat={mySeat}
            liveHand={liveHand}
            busy={busy}
            doAct={doAct}
            table={table}
            actor={actor}
            myTurn={myTurn}
            frac={frac}
            pre={pre}
            onPre={(a) => {
              if (pre === a) return setPre("");
              setPre(a);
            }}
          />
        </div>

        {/* 세로판: 오른쪽 아래 작은 버튼 (이모티콘 · 기록/족보) */}
        {!H && (
          <div
            className="absolute right-[8px] flex flex-col gap-[6px]"
            style={{
              bottom: C?.btnAbove ? h - (L.heroCards / 100) * h + 6 : heroPlateBottom,
              zIndex: 31,
            }}
          >
            {me && (
              <button
                type="button"
                onClick={() => setDrawer(drawer === "emote" ? "" : "emote")}
                className={`pk-btn pk-btn-ghost text-[1.1em] ${C ? "h-[34px] w-[34px]" : "h-[38px] w-[38px]"}`}
                aria-label="이모티콘"
              >
                😊
              </button>
            )}
            <button
              type="button"
              onClick={() => setDrawer(drawer === "info" ? "" : "info")}
              className={`pk-btn pk-btn-ghost text-[0.72em] ${C ? "h-[34px] w-[34px]" : "h-[38px] w-[38px]"}`}
              aria-label="기록 · 족보"
            >
              족보
            </button>
          </div>
        )}
      </div>

      {/* 가로판: 오른쪽 패널 (기록 · 족보, 아래 이모티콘) */}
      {H && (
        <aside
          className="pk-frame absolute right-[8px] flex flex-col overflow-hidden"
          style={{ width: panelW - 16, top: bar + 8, bottom: 8, zIndex: 25 }}
        >
          <SidePanel
            table={table}
            hand={hand}
            hv={hv}
            sv={sv}
            res={res}
            mySeat={mySeat}
            log={log}
            myCat={myCat}
            u={u}
          />
          {me && <EmoteGrid char={me.look ?? me.char} onPick={emote} />}
        </aside>
      )}
      {/* 세로판 서랍 */}
      {!H && drawer && (
        <div
          className="absolute inset-0 z-40 flex items-end bg-black/50"
          onClick={() => setDrawer("")}
        >
          <div
            className="pk-frame pk-fade-in flex w-full flex-col overflow-hidden rounded-b-none"
            style={{ height: drawer === "emote" ? "auto" : h * 0.55 }}
            onClick={(e) => e.stopPropagation()}
          >
            {drawer === "info" ? (
              <InfoTabs tab={tab} setTab={setTab} log={log} game={table.game} myCat={myCat} />
            ) : (
              me && <EmoteGrid char={me.look ?? me.char} onPick={emote} big />
            )}
          </div>
        </div>
      )}

      {/* 위 바 */}
      <div
        className="absolute inset-x-0 top-0 flex items-center gap-[0.5em] px-[0.6em]"
        style={{
          height: bar,
          zIndex: 35,
          background: "linear-gradient(180deg, rgba(0,0,0,0.8), rgba(0,0,0,0.25))",
          borderBottom: "1px solid rgba(214,175,92,0.2)",
        }}
      >
        <span className="min-w-0 truncate pl-[0.2em] text-[0.85em] font-bold">{table.name}</span>
        <span className="hidden shrink-0 text-[0.7em] text-white/50 sm:inline">
          {GAMES[table.game].name} · {tierLabel(tier.id)} · 판돈 {fmtShort(tier.ante)}
          {hv && ` · ${fmtShort(tier.sb)}/${fmtShort(tier.bb)}`}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-[0.5em]">
          <span
            className="flex shrink-0 items-center gap-[0.3em] rounded-[6px] border border-[rgba(214,175,92,0.35)] bg-black/50 px-[0.5em] py-[0.1em] whitespace-nowrap"
            title={`${fmtWon(wallet.money)}칩`}
          >
            {}
            <img src={asset.chip("gold", "top")} alt="" className="h-[1em] w-[1em]" />
            {/* 폰처럼 좁으면 짧게(1.1억), 넓으면 전부(1억 1,040만) */}
            {w < 520 ? (
              <span className="pk-num text-[0.95em] text-[var(--pk-brass)]">
                {fmtShort(wallet.money)}
              </span>
            ) : (
              <Money won={wallet.money} className="text-[0.95em] text-[var(--pk-brass)]" />
            )}
          </span>
          {/* 나가기: 판 중이면 예약(누르면 예약 취소로 바뀜), 대기 중이면 바로 */}
          <button
            type="button"
            onClick={exit}
            className="pk-btn pk-btn-half flex h-[30px] items-center gap-[0.35em] px-[0.7em] text-[0.78em] whitespace-nowrap"
          >
            {!me?.exit && (
              <svg
                viewBox="0 0 24 24"
                className="h-[14px] w-[14px]"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
              </svg>
            )}
            {me?.exit ? "예약 취소" : "나가기"}
          </button>
          {topRight}
        </span>
      </div>
      {/* 자리 정보: 이 방에서 딴 돈 · 전적 */}
      {statSeat !== null && table.seats[statSeat] && (
        <div
          className="absolute inset-0 z-[55] flex items-center justify-center bg-black/55"
          onClick={() => setStatSeat(null)}
        >
          {(() => {
            const s = table.seats[statSeat]!;
            const lost = s.hands - s.wins;
            return (
              <div
                className="pk-frame pk-pop flex w-[19em] flex-col items-center gap-[0.5em] p-[1em]"
                onClick={(e) => e.stopPropagation()}
              >
                <Profile
                  char={s.look ?? s.char}
                  size={64}
                  className="ring-2 ring-[var(--pk-brass)]"
                />
                <div className="text-center leading-tight">
                  <div className="text-[1.15em] font-extrabold">{s.name}</div>
                  <div className="text-[0.8em] font-bold" style={{ color: CHARS[s.char].color }}>
                    {lookName(s.look ?? s.char)}
                  </div>
                </div>
                <div className="grid w-full grid-cols-2 gap-[0.4em] text-center">
                  <div className="rounded-[8px] bg-white/[0.06] px-[0.4em] py-[0.45em]">
                    <div className="text-[0.68em] text-white/50">이 방에서 딴 돈</div>
                    <Money
                      won={s.net}
                      sign
                      className={`text-[1.2em] ${s.net > 0 ? "text-[#5ff0b5]" : s.net < 0 ? "text-[#ff8a97]" : "text-white/70"}`}
                    />
                  </div>
                  <div className="rounded-[8px] bg-white/[0.06] px-[0.4em] py-[0.45em]">
                    <div className="text-[0.68em] text-white/50">이 방 전적</div>
                    <div className="pk-num text-[1.2em] text-white">
                      {s.wins}승 {lost}패
                      {s.hands > 0 && (
                        <span className="ml-[0.3em] text-[0.7em] text-white/55">
                          ({Math.round((s.wins / s.hands) * 100)}%)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex w-full items-center justify-between text-[0.78em] text-white/60">
                  <span>보유 칩</span>
                  <Money won={s.stack} className="text-[1.15em] text-[#ffd84a]" />
                </div>
                {/* 강퇴 투표: 남의 자리 · 내가 이 방에서 3판 이상 쳤을 때. 3표면 강퇴, 표는 10판 지나면 사라짐 */}
                {me && s.seat !== mySeat && (
                  <div className="grid w-full gap-[0.3em]">
                    <button
                      type="button"
                      disabled={me.hands < 3 || voted.has(s.seat)}
                      onClick={() => {
                        const seat = s.seat;
                        kickVote(id, seat)
                          .then((r) => {
                            setVoted((v) => new Set(v).add(seat));
                            setInfo({
                              text: r.kicked
                                ? `${s.name} 님이 강퇴됐어요`
                                : `강퇴 투표했어요 (${r.votes}/${r.need})`,
                              key: Date.now(),
                            });
                            setStatSeat(null);
                          })
                          .catch((e: ApiError) => {
                            if (e.code === "ALREADY_VOTED") setVoted((v) => new Set(v).add(seat));
                            setNotice(e.message ?? "투표하지 못했어요.");
                          });
                      }}
                      className="pk-btn pk-btn-fold w-full py-[0.45em] text-[0.85em] disabled:opacity-40"
                    >
                      {voted.has(s.seat) ? "강퇴 투표함" : "강퇴 투표"}
                      <span className="ml-[0.4em] text-[0.85em] opacity-80">{s.votes}/3</span>
                    </button>
                    <p className="text-center text-[0.68em] leading-snug text-white/40">
                      {me.hands < 3
                        ? `이 방에서 ${3 - me.hands}판 더 치면 투표할 수 있어요`
                        : "3표가 모이면 강퇴 · 표는 10판 지나면 사라져요"}
                    </p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setStatSeat(null)}
                  className="pk-btn pk-btn-ghost w-full py-[0.45em] text-[0.85em]"
                >
                  닫기
                </button>
              </div>
            );
          })()}
        </div>
      )}

      {cutin && (
        <CutIn
          key={cutin.key}
          char={cutin.char}
          name={cutin.name}
          top={py(L.center.board) + sizes.boardCard * 0.7}
          onDone={() => setCutin(null)}
        />
      )}
    </Shell>
  );
}

/** 무대 배경 (방) */
function Shell({
  o,
  tier,
  turn,
  children,
}: {
  o: Orient;
  tier: TierId;
  /** 내 차례: 무대 테두리가 금빛으로 숨 쉬듯 빛남 */
  turn?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="absolute inset-0">
      <div
        className="pk-bg"
        style={{
          backgroundImage: `url(${asset.room(tier, o)})`,
          filter: `brightness(0.72) saturate(0.9) ${roomTint(tier) ?? ""}`,
        }}
      />
      {children}
      {turn && <div className="pk-turn-glow pointer-events-none absolute inset-0" aria-hidden />}
    </div>
  );
}

/** 행동 꼬리표: 행동 색의 칠기 판 + 금속 느낌 글자 (색은 외침과 같음) */
/** 행동 글자 그림 (/poker/ui/act-{행동}.webp) 이 있으면 그걸, 없으면 CSS 글자. 파일 유무는 한 번만 확인 */
const actImgOk = new Map<string, boolean>();
const actImg = (a: string) => `/poker/ui/act-${a}.webp`;

/** 행동 글자: 그림이 있으면 그림, 없으면 CSS 글자 */
function ActWord({ a, className = "" }: { a: string; className?: string }) {
  const [ok, setOk] = useState(() => actImgOk.get(a));
  useEffect(() => {
    if (actImgOk.has(a)) return;
    const im = new Image();
    im.onload = () => (actImgOk.set(a, true), setOk(true));
    im.onerror = () => (actImgOk.set(a, false), setOk(false));
    im.src = actImg(a);
  }, [a]);
  if (ok)
    return (
      <img src={actImg(a)} alt={ACT_LABEL[a] ?? a} draggable={false} className={`pk-acttag-img ${className}`} />
    );
  return (
    <span
      className={`pk-acttag ${className}`}
      data-a={a}
      style={{ "--ac": SHOUT_COLOR[a] ?? "#c3c9d6", visibility: ok === undefined ? "hidden" : undefined } as CSSProperties}
    >
      <span className="pk-acttag-t">{ACT_LABEL[a] ?? a}</span>
    </span>
  );
}

function ActTag({ a }: { a: string }) {
  return (
    <span className="absolute bottom-[calc(100%+4px)] left-1/2 z-20 -translate-x-1/2">
      <ActWord a={a} />
    </span>
  );
}

/**
 * 쇼다운 족보 이름(서버가 보낸 "A 원페어", "K 탑", "로열 플러시" …) → 족보 대사 이름 (voice/{캐릭터}/{캐릭터}-hand-*.mp3)
 * 탑은 숫자별(A·K·Q·J·10·9 — 7장이면 9 아래 탑은 안 나옴), 나머지는 족보별 하나.
 */
function handLine(name: string): string | null {
  const n = name.replace(/\s+/g, " ").trim();
  if (!n) return null;
  if (n.startsWith("로열")) return "hand-royal";
  if (n.startsWith("백 스트레이트 플러시")) return "hand-backsf";
  if (n.includes("스트레이트 플러시")) return "hand-sf";
  if (n.endsWith("포카드")) return "hand-quads";
  if (n.endsWith("풀하우스")) return "hand-fullhouse";
  if (n.endsWith("플러시")) return "hand-flush";
  if (n === "마운틴") return "hand-mountain";
  if (n === "백스트레이트") return "hand-backstraight";
  if (n.endsWith("스트레이트")) return "hand-straight";
  if (n.endsWith("트리플")) return "hand-trips";
  if (n.endsWith("투페어")) return "hand-twopair";
  if (n.endsWith("원페어")) return "hand-pair";
  const top = n.match(/^(10|[2-9AKQJ]) (탑|하이)$/);
  if (top) return `hand-top-${top[1]}`;
  return null;
}

/** 전신 그림(hero)은 예전 허벅지까지 그림보다 몇 배 높게 그려야 머리 크기가 같아짐 */
const HERO_K = 1.7;
/** 가로판: 예전처럼 크게 (머리 크기 · 위치 그대로), 허리 아래는 이름표 · 화면 끝 뒤로 이어짐 */
const HERO_KH = 1.7;

/** 이름표 테두리를 따라 줄어드는 남은 시간 (초록 → 노랑 → 빨강) */
function PlateTimer({ frac }: { frac: number }) {
  const color = frac > 0.5 ? "#4be38a" : frac > 0.25 ? "#ffd84a" : "#ff4d5e";
  return (
    <svg className="pk-plate-ring" aria-hidden>
      <rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        rx="7"
        pathLength={100}
        style={{ stroke: color, strokeDasharray: `${(frac * 100).toFixed(2)} 100`, filter: `drop-shadow(0 0 4px ${color})` }}
      />
    </svg>
  );
}

/** 이모티콘 말풍선: 누가 던졌는지 꼬리로 가리킴 (l = 꼬리가 왼쪽 아래) */
function EmoteBubble({ tail, children }: { tail: "l" | "r"; children: ReactNode }) {
  return (
    <span className="pk-emote-bubble" data-tail={tail}>
      {children}
    </span>
  );
}

function Center({
  hand,
  table,
  base,
  sizes,
  res,
  settled,
}: {
  hand: HoldemView | SevenView | null;
  table: TableWire;
  base: number;
  sizes: Sizes;
  res: HoldemView["result"];
  settled: boolean;
}) {
  if (!hand) {
    const n = table.seats.filter((s) => s && s.status !== "out").length;
    return (
      <div className="pk-status">
        {n < 2
          ? table.bots
            ? "곧 다른 사람이 들어와요…"
            : "같이 칠 사람을 기다리는 중…"
          : "곧 다음 판이 시작돼요"}
      </div>
    );
  }
  const street = Object.values(hand.players).reduce((a, p) => a + p.bet, 0);
  const collected = res ? hand.pot : hand.pot - street;
  const shown = res || collected > 0 ? collected : hand.pot;
  return (
    <>
      {hand.game === "seven" ? <SevenStage view={hand} /> : <HoldemStage view={hand} />}
      {/* 팟: 크게 · 금액이 바뀌면 살짝 튐 */}
      <div className="flex items-end gap-[0.35em]">
        {/* 진짜 칩 더미: 건 돈이 모일 때마다 쌓이고, 승자에게 날아가면 사라짐 */}
        {!(res && settled) && (
          <PotPile
            amount={collected > 0 || res ? shown : 0}
            base={base}
            size={Math.max(24, sizes.u * 4.4)}
          />
        )}
        <div key={shown} className="pk-pot">
          <PotChips ratio={shown / base} size={Math.max(24, sizes.u * 4)} />
          {/* 이번 구에 건 돈은 POT 글자 옆에 작게 (옆으로 길어져 자리를 가리지 않게) */}
          <span className="flex shrink-0 flex-col items-start leading-none whitespace-nowrap">
            <span className="flex items-center gap-[0.4em]">
              <span className="pk-pot-label">POT</span>
              {/* 세로판(폰)은 길어지니 안 보여 줌 */}
              {sizes.o !== "v" && !res && street > 0 && collected > 0 && (
                <span className="mb-[0.1em] rounded-[3px] bg-white/10 px-[0.35em] py-[0.05em] text-[0.6em] text-white/75">
                  +{fmtShort(street)}
                </span>
              )}
            </span>
            <Money won={shown} className="text-[1.55em] text-white" />
          </span>
        </div>
      </div>
      {hand.game === "holdem" && (
        <HoldemBoard view={hand} tier={table.tier} sizes={sizes} settled={settled} />
      )}
      {hand.pots.length > 1 && !res && Object.values(hand.players).some((p) => p.allIn) && (
        <div className="flex flex-wrap justify-center gap-x-[0.8em] text-[0.72em] text-white/60">
          {hand.pots.map((p, i) => (
            <span key={i}>
              {i === 0 ? "메인" : `사이드${hand.pots.length > 2 ? ` ${i}` : ""}`}{" "}
              {fmtShort(p.amount)}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

/** 내 자리: 캐릭터(가로판) · 얼굴 틀 · 이름표, 가운데 내 카드 · 족보 · 건 돈 */
function HeroArea(props: {
  me: SeatWire;
  p: HoldemView["players"][number] | SevenView["players"][number] | null;
  hv: HoldemView | null;
  sv: SevenView | null;
  liveHand: MyHand | null;
  tier: TierId;
  sizes: Sizes;
  L: ReturnType<typeof layoutFor>;
  boardW: number;
  h: number;
  base: number;
  hint: string;
  res: HoldemView["result"];
  face: Face;
  pose: Pose;
  waiting: boolean;
  frac: number;
  deadline: number;
  gain: { amt: number; key: number } | null;
  emote: (Timed<Emote> & { key: number }) | null;
  heroSprH: number;
  isButton: boolean;
  blind: string | null;
  onStats: () => void;
  madeKey: string;
  plateBottom: number;
  compact: boolean;
  sprV: number;
  settled: boolean;
  collected: boolean;
  myRevealed: boolean;
  dealDelay?: SeatCardsProps<unknown>["dealDelay"];
}) {
  const {
    me,
    p,
    hv,
    sv,
    liveHand,
    tier,
    sizes,
    L,
    boardW,
    h,
    base,
    hint,
    res,
    face,
    pose,
    waiting,
    frac,
    deadline,
    gain,
    emote,
    heroSprH,
    isButton,
    blind,
    onStats,
    madeKey,
    plateBottom,
    compact,
    sprV,
    settled,
    collected,
    myRevealed,
    dealDelay,
  } = props;
  const H = sizes.o === "h";
  const cards =
    !hv && !sv
      ? null
      : hv
        ? holdemSeatCards({
            view: hv,
            seat: me.seat,
            hero: true,
            myHand: liveHand,
            tier,
            sizes,
            side: "top",
            settled,
            dealDelay,
          })
        : sevenSeatCards({
            view: sv!,
            seat: me.seat,
            hero: true,
            myHand: liveHand,
            tier,
            sizes,
            side: "top",
            settled,
            dealDelay,
          });
  const myName = (hv ?? sv)?.result?.names[me.seat];
  const bet = p && !res && !collected ? p.bet : 0;
  const live = !!p && !p.folded && !res && !collected;
  const dim = me.status === "out" || (!!p?.folded && !res);
  const won = res?.won[me.seat] ?? 0;
  // 좁은 폰 배치(compact)는 내 줄 폭이 정해져 있어서 예전 크기 그대로
  const fs = H ? sizes.face * 1.4 : compact ? sizes.face * 1.05 : sizes.face * 1.2;
  const plate = (
    <div className="flex items-center gap-[0.45em]" style={{ fontSize: H ? "1.18em" : "1.08em" }}>
      <div
        className="pk-avatar"
        data-turn={waiting ? "1" : undefined}
        style={{
          opacity: dim ? 0.6 : 1,
          boxShadow:
            won > 0 ? "0 0 0 3px var(--pk-brass), 0 0 16px rgba(255,201,60,0.6)" : undefined,
        }}
      >
        <FaceIcon char={me.look ?? me.char} face={face} size={fs} />
        {waiting && deadline > 0 && <TimerRing size={fs + 4} frac={frac} width={3} square />}
        {(isButton || blind) && <span className="pk-badge">{isButton ? "D" : blind}</span>}
        {gain && (
          <Rise
            key={gain.key}
            className="absolute -top-[0.6em] left-1/2 -translate-x-1/2 text-[1.1em] text-[var(--pk-brass)]"
          >
            +{fmtShort(gain.amt)}
          </Rise>
        )}
      </div>
      {/* 내 정보 판: 이름 · 캐릭터 / 보유 칩 / 이번 판 베팅 · 상태 */}
      <div
        role="button"
        tabIndex={0}
        onClick={onStats}
        onKeyDown={(e) => e.key === "Enter" && onStats()}
        className="pk-hero-hud cursor-pointer"
        data-turn={waiting ? "1" : undefined}
        style={compact ? { minWidth: "8em", maxWidth: "9.4em", fontSize: "1em" } : undefined}
      >
        {me.exit && (
          <span className="pk-exit-mark absolute -top-[1.1em] right-[0.4em]">나가기 예약</span>
        )}
        {/* 이름 / 캐릭터(스킨) 이름은 다음 줄 — 길면 말줄임 */}
        <div className="truncate text-[0.9em] font-extrabold text-white">{me.name}</div>
        <div
          className="-mt-[0.1em] truncate text-[0.72em] font-bold"
          style={{ color: CHARS[me.char].color }}
        >
          {lookName(me.look ?? me.char)}
        </div>
        <div className="flex items-center gap-[0.3em]">
          {}
          <img src={asset.chip("gold", "top")} alt="" className="h-[1em] w-[1em]" />
          <span className="pk-num text-[1.15em] leading-none text-[#ffd84a]">
            {p?.allIn && !res ? (
              <span className="text-[var(--pk-danger)]">ALL IN</span>
            ) : (
              <Money won={me.stack} />
            )}
          </span>
        </div>
        <div className="mt-[0.15em] flex items-center gap-[0.5em] border-t border-white/10 pt-[0.2em] text-[0.7em]">
          <span className="text-white/50">
            베팅 <Money won={p ? p.invested : 0} className="text-[1.15em] text-white" />
          </span>
          <span className={`ml-auto font-bold ${waiting ? "text-[#ffd84a]" : "text-white/55"}`}>
            {me.status === "out" && !live
              ? "자리 비움"
              : waiting
                ? "내 차례"
                : p?.folded
                  ? "폴드"
                  : res
                    ? won > 0
                      ? "승리"
                      : ""
                    : p
                      ? "진행 중"
                      : "대기 중"}
          </span>
        </div>
        {waiting && deadline > 0 && (
          <PlateTimer frac={frac} />
        )}
      </div>
    </div>
  );
  const hero = heroReady(me.look ?? me.char);
  return (
    <>
      {/* 가로판: 왼쪽 아래 내 캐릭터 + 이름표 */}
      {H ? (
        <div className="absolute bottom-[8px] left-[24px]" style={{ zIndex: 6 }}>
          {hero ? (
            // 전신 그림: 예전 그림과 같은 크기 · 위치, 몸은 이름표 뒤로 이어져 허리에서 끊기지 않음
            <div
              className={`pk-seat-sprite pointer-events-none absolute ${waiting ? "pk-seat-turn" : ""}`}
              style={{
                bottom: `calc(100% - 8px - ${Math.round(heroSprH * (HERO_KH - 1))}px)`,
                left: Math.round(heroSprH * (0.375 - HERO_KH / 3)),
              }}
            >
              <HeroSprite char={me.look ?? me.char} pose={pose} h={heroSprH * HERO_KH} dim={dim} />
            </div>
          ) : (
            <div
              className={`pk-seat-sprite pointer-events-none absolute bottom-[calc(100%-8px)] left-0 ${waiting ? "pk-seat-turn" : ""}`}
            >
              <CharSprite char={me.look ?? me.char} pose={pose} w={(heroSprH * 3) / 4} dim={dim} />
            </div>
          )}
          {/* 내 이모티콘 말풍선: 머리 오른쪽 옆, 꼬리가 머리를 가리킴 */}
          {emote && (
            <div
              key={emote.key}
              className="pk-emote pointer-events-none absolute"
              style={{
                left: heroSprH * 0.56,
                bottom: `calc(100% - 8px + ${Math.round(heroSprH * 0.76)}px)`,
                zIndex: 45,
              }}
            >
              <EmoteBubble tail="l">
                <EmoteImg
                  char={me.look ?? me.char}
                  emote={emote.v}
                  size={Math.round(Math.max(64, Math.min(100, heroSprH * 0.34)))}
                />
              </EmoteBubble>
            </div>
          )}
          {plate}
        </div>
      ) : (
        <div className="absolute left-[8px]" style={{ bottom: plateBottom, zIndex: 9 }}>
          {sprV > 0 && (
            <div
              className={`pk-seat-sprite pointer-events-none absolute ${waiting ? "pk-seat-turn" : ""}`}
              style={
                hero
                  ? {
                      bottom: `calc(100% - ${Math.round(sprV * 0.3 + sprV * (HERO_K - 1))}px)`,
                      left: Math.round(sprV * (0.375 - HERO_K / 3)),
                    }
                  : { bottom: `calc(100% - ${Math.round(sprV * 0.3)}px)`, left: 0 }
              }
            >
              {hero ? (
                <HeroSprite char={me.look ?? me.char} pose={pose} h={sprV * HERO_K} dim={dim} />
              ) : (
                <CharSprite char={me.look ?? me.char} pose={pose} w={(sprV * 3) / 4} dim={dim} />
              )}
            </div>
          )}
          {/* 내 이모티콘: 캐릭터가 있으면 그 어깨 옆, 없으면 내 이름표 위 오른쪽 */}
          {emote && (
            <div
              key={emote.key}
              className="pk-emote pointer-events-none absolute"
              style={{
                zIndex: 45,
                left: sprV > 0 ? Math.round(sprV * 0.56) : "40%",
                bottom: sprV > 0 ? `calc(100% + ${Math.round(sprV * 0.22)}px)` : "calc(100% + 2px)",
              }}
            >
              <EmoteBubble tail="l">
                <EmoteImg
                  char={me.look ?? me.char}
                  emote={emote.v}
                  size={Math.round(Math.max(52, Math.min(80, sprV > 0 ? sprV * 0.42 : 60)))}
                />
              </EmoteBubble>
            </div>
          )}
          {plate}
        </div>
      )}
      {/* 내 카드 · 족보 · 건 돈 (테이블 앞쪽 가운데) */}
      <div
        className="absolute flex flex-col items-center gap-[0.4em]"
        style={{
          left: (L.heroX / 100) * boardW,
          top: (L.heroCards / 100) * h,
          transform: "translateX(-50%)",
          zIndex: 14,
        }}
      >
        {bet > 0 && (
          <Bet
            won={bet}
            ratio={bet / base}
            size={Math.max(22, sizes.u * 3.4)}
            act={p?.last?.a}
            className={
              compact
                ? // 좁은 폰: 카드 위 왼쪽 (카드 왼쪽에 두면 내 이름표 · 카드에 걸려 잘림)
                  "absolute bottom-[calc(100%+2px)] left-0 z-20"
                : "relative z-10 -mt-[1.6em]"
            }
          />
        )}
        <div className="relative flex items-end">
          {madeKey && !res && (
            <span key={`burst-${madeKey}`} className="pk-made-burst" aria-hidden />
          )}
          {cards}
        </div>
        <div className={compact ? "flex items-center gap-[0.35em] whitespace-nowrap" : "contents"}>
          {hint && !res && !myName && (
            <span className={`pk-handtag pk-pop ${madeKey ? "pk-made" : ""}`}>
              <span className="pk-tag-t">
                {hint}
              </span>
            </span>
          )}
          {p?.last &&
            !res &&
            !(!p.folded && !p.allIn && (hv ?? sv) && p.bet < (hv ?? sv)!.currentBet) && (
              <ActWord key={p.last.a} a={p.last.a} className="pk-acttag-me" />
            )}
          {myName && myRevealed && (
            <span
              key={settled ? 1 : 0}
              className={`pk-resulttag pk-stamp ${res && won > 0 ? "pk-resulttag-win" : ""}`}
            >
              <span className="pk-tag-t">{myName}</span>
            </span>
          )}
        </div>
      </div>
    </>
  );
}

function WinBanner({
  names,
  hand,
  mine,
  o,
  top,
}: {
  names: string[];
  hand?: string;
  mine: boolean;
  o: Orient;
  top?: number;
}) {
  return (
    <>
      <div
        className="pk-flash pointer-events-none absolute inset-0"
        style={{ zIndex: 29 }}
        aria-hidden
      />
      <div
        className="pk-banner pointer-events-none absolute inset-x-0 flex flex-col items-center py-[0.35em]"
        style={{
          top: top ?? (o === "v" ? "24%" : "9%"),
          zIndex: 30,
          background:
            "linear-gradient(90deg, transparent, rgba(0,0,0,0.75) 25%, rgba(0,0,0,0.75) 75%, transparent)",
        }}
      >
        <div className="flex items-center gap-[0.35em]">
          <span className="pk-winner-star" aria-hidden>
            ✦
          </span>
          <span
            className={`pk-winner ${mine ? "pk-winner-mine" : ""}`}
            data-text={mine ? "WIN!" : "WINNER"}
          >
            {mine ? "WIN!" : "WINNER"}
          </span>
          <span className="pk-winner-star" aria-hidden>
            ✦
          </span>
        </div>
        <div className="mt-[0.15em] text-[0.85em] font-bold text-white">{names.join(" · ")}</div>
        {hand && (
          <div className="pk-shine mt-[0.25em] rounded-[4px] bg-[var(--pk-brass)] px-[0.8em] py-[0.05em] text-[0.78em] font-extrabold text-[#2a1e05]">
            {hand}
          </div>
        )}
      </div>
    </>
  );
}

/** 아래 행동 바 (앉기 · 비밀번호 · 행동 버튼 · 상태) */
function ActionBar(props: {
  revealing: boolean;
  o: Orient;
  u: number;
  me: SeatWire | null;
  sitState: SitState;
  password: string;
  setPassword: (v: string) => void;
  trySit: (pw?: string) => void;
  kicked: "" | "cut" | "bust" | "idle" | "vote";
  wallet: Wallet;
  tier: (typeof TIERS)[number];
  onWallet: (w: Wallet) => void;
  onExit: () => void;
  hv: HoldemView | null;
  sv: SevenView | null;
  mySeat: number;
  liveHand: MyHand | null;
  busy: boolean;
  doAct: (a: HoldemAction | SevenAction) => void;
  table: TableWire;
  actor: SeatWire | null;
  myTurn: boolean;
  frac: number;
  pre: string;
  onPre: (a: string) => void;
}) {
  const {
    revealing,
    o,
    u,
    me,
    sitState,
    password,
    setPassword,
    trySit,
    kicked,
    tier,
    onExit,
    hv,
    sv,
    mySeat,
    liveHand,
    busy,
    doAct,
    table,
    actor,
    myTurn,
    frac,
    pre,
    onPre,
  } = props;
  if (sitState === "password")
    return (
      <form
        className="pk-frame pk-fade-in flex items-center gap-[0.4em] p-[0.5em]"
        onSubmit={(e) => {
          e.preventDefault();
          trySit(password);
        }}
      >
        <input
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="테이블 비밀번호"
          aria-label="테이블 비밀번호"
          className="min-w-0 flex-1 rounded-[6px] border border-white/15 bg-black/50 px-[0.7em] py-[0.5em] text-[0.85em] text-white focus:border-[var(--pk-brass)] focus:outline-none"
        />
        <button type="submit" className="pk-btn pk-btn-gold px-[1em] py-[0.5em] text-[0.85em]">
          앉기
        </button>
      </form>
    );
  if (!me)
    return (
      <div className="pk-frame pk-fade-in flex flex-wrap items-center justify-center gap-[0.5em] p-[0.6em] text-[0.85em] text-white/70">
        {kicked ? (
          "자리에서 일어났어요"
        ) : sitState === "joining" ? (
          "자리에 앉는 중…"
        ) : (
          <>
            구경 중
            <button
              type="button"
              onClick={() => trySit()}
              className="pk-btn pk-btn-gold px-[1em] py-[0.4em] text-[0.85em]"
            >
              앉기
            </button>
            <button
              type="button"
              onClick={onExit}
              className="pk-btn pk-btn-ghost px-[0.9em] py-[0.4em] text-[0.85em]"
            >
              로비로
            </button>
          </>
        )}
      </div>
    );
  if (hv && hv.toAct === mySeat && !hv.result && hv.legal)
    return (
      <HoldemActions
        key={`${table.handNo}:${hv.street}:${hv.legal.minTo}`}
        view={hv}
        mySeat={mySeat}
        myStack={me.stack}
        busy={busy}
        onAct={doAct}
        unitBB={tier.bb}
        o={o}
      />
    );
  if (sv && !sv.result && myTurn)
    return (
      <SevenActions
        key={table.handNo}
        view={sv}
        mySeat={mySeat}
        myStack={me.stack}
        myHand={liveHand}
        busy={busy}
        onAct={doAct}
        tier={table.tier}
        u={u}
        o={o}
      />
    );
  // 판이 없을 때는 가운데 안내로 충분
  if (!hv && !sv && me.status !== "out") return null;
  // 내가 이 판에 살아 있으면 미리 행동을 걸 수 있음
  const myP2 = hv?.players[mySeat] ?? sv?.players[mySeat];
  // (7포커는 베팅 중일 때만 — 카드 고르기 · 카드 돌리는 동안 눌러 둔 건 구가 바뀌며 풀리니 아예 안 보여 줌)
  const canPre =
    !!myP2 &&
    !myP2.folded &&
    !myP2.allIn &&
    !hv?.result &&
    !sv?.result &&
    !(sv && sv.phase !== "bet");
  // 이번 구에 내 차례가 또 올 때만 누를 수 있음: 아직 안 쳤거나, 내가 낸 뒤 누가 더 올렸을 때. 이미 맞춰 놨으면 한 바퀴 돌고 끝나니 잠금
  const curBet = (hv ?? sv)?.currentBet ?? 0;
  const preOpen = canPre && (!myP2!.last || myP2!.bet < curBet);
  return (
    <div className="flex flex-col items-center gap-[0.4em]">
      {actor && me.status !== "out" && me.status !== "wait" && !hv?.result && !sv?.result ? (
        // 누구 차례인지: 얼굴 + 이름 + 남은 시간
        <div key={actor.seat} className="pk-turnbar pk-fade-in">
          {}
          <img src={asset.profile(actor.look ?? actor.char)} alt="" className="pk-turnbar-face" />
          <span className="min-w-0">
            <span className="block text-[0.7em] font-bold tracking-wider text-[#ffd84a]">
              지금 차례
            </span>
            <span className="block truncate text-[1.1em] font-extrabold">{actor.name}</span>
          </span>
          <span className="pk-turnbar-time" style={{ transform: `scaleX(${frac})` }} />
        </div>
      ) : (
        <div className="pk-status pk-fade-in">
          {me.status === "out"
            ? "자리 비움 중"
            : hv?.result || sv?.result
              ? revealing
                ? "쇼다운! 패를 깝니다…"
                : "곧 다음 판이 시작돼요"
              : me.status === "wait"
                ? "이번 판이 끝나면 카드를 받아요"
                : "진행 중"}
        </div>
      )}
      {/* 차례가 아닐 때도 같은 베팅 버튼 줄: 미리 눌러 두면 차례에 자동, 다시 누르면 풀림 */}
      {canPre && (
        <div className="pk-frame flex w-full gap-[0.3em] p-[0.45em]">
          {(hv
            ? ([
                ["fold", "폴드", "pk-btn-fold"],
                ["cf", "체크/폴드", "pk-btn-call"],
                ["call", "콜", "pk-btn-bbing"],
              ] as const)
            : ([
                // 삥과 콜은 같은 순간에 있을 수 없는 행동 → 한 버튼 (받을 돈 없으면 삥, 있으면 콜)
                ["die", "다이", "pk-btn-fold"],
                ["ddadang", "따당", "pk-btn-ddadang"],
                ["callbbing", "삥 / 콜", "pk-btn-call"],
                ["quarter", "쿼터", "pk-btn-quarter"],
                ["half", "하프", "pk-btn-half"],
              ] as const)
          ).map(([k, label, cls]) => (
            <button
              key={k}
              type="button"
              disabled={!preOpen}
              aria-pressed={pre === k}
              onClick={() => onPre(k)}
              className={`pk-btn ${cls} pk-prebig relative flex min-w-0 flex-1 flex-col items-center justify-center px-[0.2em] py-[0.55em] whitespace-nowrap`}
            >
              <span className="text-[1.02em]">{label}</span>
              {/* 진짜 베팅 버튼(금액 줄 포함)과 높이를 맞추는 자리 */}
              <span className="pk-num text-[1.08em] opacity-0" aria-hidden>
                0
              </span>
              {pre === k && (
                <span className="pk-pre-check" aria-hidden>
                  <svg viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2.4 6.3 4.9 8.7 9.6 3.6"
                      stroke="currentColor"
                      strokeWidth="2.1"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const c = (r: string, su: string) => "23456789TJQKA".indexOf(r) * 4 + "shdc".indexOf(su);
const ex = (t: string) => t.split(" ").map((x) => c(x[0], x[1]));
/** 족보 이름 + 예시 5장 (약한 것부터, 인덱스 = 족보 번호) */
const HOLDEM_RANKS: [string, number[]][] = [
  ["하이카드", ex("As Qd 9c 5h 3s")],
  ["원페어", ex("Th Tc Ks 7d 3h")],
  ["투페어", ex("Js Jd 4h 4c As")],
  ["트리플", ex("7s 7h 7d Kc 2s")],
  ["스트레이트", ex("9c 8h 7s 6d 5h")],
  ["플러시", ex("Ad Jd 8d 6d 3d")],
  ["풀하우스", ex("Qs Qh Qd 9c 9s")],
  ["포카드", ex("Ks Kh Kd Kc 2s")],
  ["스티플", ex("9h 8h 7h 6h 5h")],
];
const SEVEN_RANKS: [string, number[]][] = [
  ["탑", ex("As Qd 9c 5h 3s")],
  ["원페어", ex("Th Tc Ks 7d 3h")],
  ["투페어", ex("Js Jd 4h 4c As")],
  ["트리플", ex("7s 7h 7d Kc 2s")],
  ["스트레이트", ex("9c 8h 7s 6d 5h")],
  ["백스트레이트", ex("5c 4h 3s 2d Ah")],
  ["마운틴", ex("Ac Kh Qs Jd Th")],
  ["플러시", ex("Ad Jd 8d 6d 3d")],
  ["풀하우스", ex("Qs Qh Qd 9c 9s")],
  ["포카드", ex("Ks Kh Kd Kc 2s")],
  ["스티플", ex("9h 8h 7h 6h 5h")],
  ["백스티플", ex("5s 4s 3s 2s As")],
  ["로티플", ex("As Ks Qs Js Ts")],
];

/** 족보표용 아주 작은 카드 */
function MiniCard({ card }: { card: number }) {
  const r = "23456789TJQKA"[card >> 2];
  const su = card & 3;
  const red = su === 1 || su === 2;
  return (
    <span
      className="inline-flex h-[1.9em] w-[1.35em] flex-col items-center justify-center rounded-[3px] bg-[#fbf8f1] leading-none shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
      style={{ color: red ? "#e0323a" : "#17181c" }}
    >
      <span className="pk-num text-[0.82em]">{r === "T" ? "10" : r}</span>
      <span className="text-[0.62em]">
        <Suit s={su} />
      </span>
    </span>
  );
}

/**
 * 가로판 오른쪽 패널 (탭 없이 한 번에): ① 이 판 상황(판 번호 · 구간 · 팟 · 남은 사람) ② 족보표(내 패 강조) ③ 기록(남는 자리 전부, 최신이 아래)
 * 아래에는 이모티콘. 빈 공간이 없게, 눈이 가는 순서대로.
 */
function SidePanel({
  table,
  hand,
  hv,
  sv,
  res,
  mySeat,
  log,
  myCat,
  u,
}: {
  table: TableWire;
  hand: HoldemView | SevenView | null;
  hv: HoldemView | null;
  sv: SevenView | null;
  res: HoldemView["result"];
  mySeat: number;
  log: LogLine[];
  myCat: number;
  u: number;
}) {
  const ranks = table.game === "holdem" ? HOLDEM_RANKS : SEVEN_RANKS;
  // 구간: 홀덤 프리플랍 → 리버, 7포커 카드 고르기 → 4구 → 7구
  const steps = hv ? ["프리플랍", "플랍", "턴", "리버"] : ["고르기", "4구", "5구", "6구", "7구"];
  const at = !hand ? -1 : hv ? hv.street : sv!.phase === "choice" ? 0 : Math.max(1, sv!.round - 3);
  const alive = hand ? Object.values(hand.players).filter((p) => !p.folded).length : 0;
  const sitting = table.seats.filter((s) => s && s.status !== "out").length;
  const pot = hand ? hand.pot : 0;
  const me = mySeat >= 0 ? hand?.players[mySeat] : undefined;
  const myState = !hand
    ? ""
    : !me
      ? "구경 중"
      : me.folded
        ? "폴드"
        : res
          ? (res.won[mySeat] ?? 0) > 0
            ? "이김!"
            : "짐"
          : hand.toAct === mySeat
            ? "내 차례"
            : "진행 중";
  const dense = u < 7; // 작은 창: 족보표 글씨를 줄임
  return (
    <>
      {/* ① 이 판 */}
      <div className="pk-side-head">
        <div className="flex items-baseline gap-[0.4em]">
          <span className="pk-frame-title">{hand ? `${table.handNo}번째 판` : "판 사이"}</span>
          <span className="ml-auto text-[0.72em] text-white/50">
            {sitting}명 앉음{hand ? ` · ${alive}명 남음` : ""}
          </span>
        </div>
        <ol className="pk-steps" aria-label="진행 구간">
          {steps.map((nm, i) => (
            <li key={nm} data-on={i === at ? "1" : undefined} data-done={i < at ? "1" : undefined}>
              {nm}
            </li>
          ))}
        </ol>
        <div className="flex items-center gap-[0.5em]">
          <span className="flex items-center gap-[0.3em] text-[0.78em] text-white/60">
            {}
            <img src={asset.chip("gold", "top")} alt="" className="h-[1.1em] w-[1.1em]" />팟
          </span>
          <Money won={pot} className="pk-num text-[1.05em] text-[#ffd84a]" />
          {myState && (
            <span
              className={`ml-auto rounded-[4px] px-[0.5em] py-[0.05em] text-[0.74em] font-extrabold ${myState === "내 차례" ? "bg-[#ffd84a] text-[#2a1e05]" : myState === "이김!" ? "bg-[#5ff0b5] text-[#06321f]" : "bg-white/10 text-white/70"}`}
            >
              {myState}
            </span>
          )}
        </div>
      </div>

      {/* ② 족보표 */}
      <div className="pk-side-title">
        족보 <span className="text-white/40">{table.game === "holdem" ? "홀덤" : "7포커"}</span>
      </div>
      <ol className={`pk-ranks ${dense ? "pk-ranks-dense" : ""}`}>
        {ranks
          .map((r, cat) => [r, cat] as const)
          .reverse()
          .map(([[name, cards], cat], i) => {
            const mine = cat === myCat;
            return (
              <li key={name} data-mine={mine ? "1" : undefined}>
                <span className="pk-num w-[1.1em] shrink-0 text-center text-[0.8em] text-white/35">
                  {ranks.length - i}
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.8em] font-bold">{name}</span>
                {mine && <span className="pk-ranks-me">내 패</span>}
                <span className="flex shrink-0 gap-[1px] text-[0.64em]">
                  {cards.map((cc, k) => (
                    <MiniCard key={k} card={cc} />
                  ))}
                </span>
              </li>
            );
          })}
      </ol>

      {/* ③ 기록 */}
      <div className="pk-side-title mt-[0.2em]">
        기록 <span className="text-white/40">이 테이블에서 일어난 일</span>
      </div>
      <LogList lines={log} />
    </>
  );
}

/** 기록 · 족보표 탭 (세로판 서랍) */
function InfoTabs({
  tab,
  setTab,
  log,
  game,
  myCat,
}: {
  tab: "log" | "rank";
  setTab: (t: "log" | "rank") => void;
  log: LogLine[];
  game: "holdem" | "seven";
  myCat: number;
}) {
  const ranks = game === "holdem" ? HOLDEM_RANKS : SEVEN_RANKS;
  return (
    <>
      <div className="p-[0.45em]">
        <div role="tablist" className="pk-seg">
          <button
            role="tab"
            type="button"
            aria-selected={tab === "log"}
            onClick={() => setTab("log")}
          >
            기록
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={tab === "rank"}
            onClick={() => setTab("rank")}
          >
            족보
          </button>
        </div>
      </div>
      {tab === "log" ? (
        <LogList lines={log} />
      ) : (
        <ol className="pk-scroll grid min-h-0 flex-1 content-start gap-[0.25em] overflow-x-hidden overflow-y-auto px-[0.45em] pb-[0.5em]">
          {ranks
            .map((r, cat) => [r, cat] as const)
            .reverse()
            .map(([[name, cards], cat], i) => {
              const mine = cat === myCat;
              const top = i < 3;
              return (
                <li
                  key={name}
                  className={`relative flex items-center gap-[0.35em] rounded-[6px] border px-[0.4em] py-[0.3em] ${mine ? "border-[var(--pk-brass)] bg-[linear-gradient(90deg,rgba(255,201,60,0.28),rgba(255,201,60,0.06))] shadow-[0_0_10px_rgba(255,201,60,0.25)]" : "border-white/[0.06] bg-white/[0.025]"}`}
                >
                  <span
                    className={`pk-num w-[1.1em] shrink-0 text-center text-[0.85em] ${mine ? "text-[#ffe28a]" : top ? "text-[#e9c879]" : "text-white/35"}`}
                  >
                    {ranks.length - i}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className={`truncate text-[0.82em] font-bold ${mine ? "text-[#ffe28a]" : top ? "text-white" : "text-white/80"}`}
                    >
                      {name}
                      {mine && (
                        <span className="ml-[0.4em] rounded-[3px] bg-[var(--pk-brass)] px-[0.3em] text-[0.8em] text-[#2b1d00]">
                          내 패
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="flex shrink-0 gap-[1px] text-[0.6em]">
                    {cards.map((cc, k) => (
                      <MiniCard key={k} card={cc} />
                    ))}
                  </span>
                </li>
              );
            })}
          <li className="px-[0.3em] pt-[0.3em] text-[0.7em] leading-relaxed text-white/40">
            {game === "holdem"
              ? "같은 족보면 높은 숫자 · 킥커로 가려요."
              : "같은 족보 · 숫자면 무늬로: ♠ > ◆ > ♥ > ♣"}
          </li>
        </ol>
      )}
    </>
  );
}

/** 이모티콘 이름 (고르는 칸에서 가리키면 보임) */
const EMOTE_NAME: Record<Emote, string> = {
  hi: "안녕!",
  good: "좋아!",
  lol: "ㅋㅋㅋ",
  cry: "엉엉",
  angry: "화났어",
  huh: "뭐라고?",
  tease: "메롱~",
  wow: "놀람!",
};

function EmoteGrid({
  char,
  onPick,
  big,
}: {
  char: Look;
  onPick: (e: Emote) => void;
  big?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-4 gap-[0.3em] border-t border-[rgba(214,175,92,0.2)] p-[0.45em] ${big ? "gap-[0.5em] p-[0.8em]" : ""}`}
    >
      {EMOTES.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => onPick(e)}
          className="pk-emote-btn"
          aria-label={EMOTE_NAME[e]}
          title={EMOTE_NAME[e]}
        >
          <EmoteImg char={char} emote={e} size={big ? 72 : 48} className="mx-auto h-auto w-full" />
          {/* 가리키면(폰은 누르는 동안) 이름이 떠오름 */}
          <span className="pk-emote-name" aria-hidden>
            {EMOTE_NAME[e]}
          </span>
        </button>
      ))}
    </div>
  );
}

function LogList({ lines }: { lines: LogLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <div
      ref={ref}
      className="pk-scroll min-h-0 flex-1 overflow-y-auto px-[0.7em] pb-[0.5em] text-[0.74em] leading-relaxed"
      aria-live="polite"
    >
      {lines.length === 0 && (
        <p className="py-6 text-center text-white/30">판이 시작되면 진행이 적혀요.</p>
      )}
      {lines.map((l) => (
        <div
          key={l.id}
          className={
            l.tone === "win"
              ? "text-[#ffe28a]"
              : l.tone === "street"
                ? "mt-1 text-white/40"
                : l.tone === "dim"
                  ? "text-white/35"
                  : "text-white/65"
          }
        >
          {l.text}
        </div>
      ))}
    </div>
  );
}

/** 자리에서 내려왔을 때: 이유와 다음에 할 수 있는 일 */
function KickedNotice({
  why,
  wallet,
  tierMin,
  tierName,
  onSit,
  onExit,
}: {
  why: "cut" | "bust" | "idle" | "vote";
  wallet: Wallet;
  tierMin: number;
  tierName: string;
  onSit: () => void;
  onExit: () => void;
}) {
  const canSit = wallet.money >= tierMin;
  return (
    <div className="flex flex-col items-center gap-[0.4em] text-center">
      <p className="text-[1em] font-bold text-white">
        {why === "vote"
          ? "강퇴 투표로 자리에서 일어났어요"
          : why === "idle"
            ? "오래 자리를 비워서 일어났어요"
            : why === "bust"
              ? "칩을 모두 잃어서 일어났어요"
              : `칩이 ${tierName} 입장컷(${fmtShort(tierMin)}) 아래라 일어났어요`}
      </p>
      <div className="flex flex-wrap justify-center gap-[0.4em]">
        {why === "vote" && (
          <p className="text-[0.78em] text-white/55">이 방에는 30분 동안 다시 앉을 수 없어요.</p>
        )}
        {canSit && why !== "vote" && (
          <button
            type="button"
            className="pk-btn pk-btn-call px-[1.1em] py-[0.45em] text-[0.88em]"
            onClick={onSit}
          >
            다시 앉기
          </button>
        )}
        <button
          type="button"
          className="pk-btn pk-btn-ghost px-[1em] py-[0.45em] text-[0.88em]"
          onClick={onExit}
        >
          로비로
        </button>
      </div>
    </div>
  );
}

export { CHARS };
