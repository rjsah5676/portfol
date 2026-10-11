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
import { asset, chipColor, preloadChar, roomTint } from "@/lib/poker/assets";
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
import { topHands } from "@/lib/poker/showdown";
import { hasSound, isBig, playBgm, playSfx, playVoice, playVoiceNow, sfx, voiceDuration } from "@/lib/poker/sfx";
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
import { preflopGrade,
  HoldemActions,
  HoldemBoard,
  HoldemStage,
  holdemHint,
  holdemSeatCards,
} from "./HoldemParts";
import { layoutFor, type Orient } from "./layout";
import {
  Bet,
  CharSprite,
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
import { SevenBar, SevenChoice, SevenStage, sevenHint, sevenSeatCards } from "./SevenParts";

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
  /** 7포커 내 히든(7번째 장)을 아직 안 열어 봄 → 엎은 채로 맨 끝, 누르면 열림 */
  hiddenShut?: boolean;
  onPeek?: () => void;
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
  fs,
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
  /** 전체화면(흉내 포함)으로 보는 중 — 이때 뒤로가기는 나가기 버튼처럼 */
  fs?: boolean;
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
  /** 베팅 순간 아바타에서 건 돈 자리로 던져지는 칩 (여러 개가 포물선으로) */
  const [tosses, setTosses] = useState<{ key: number; seat: number; amt: number; n: number }[]>([]);
  /** 7포커: 던진 칩이 떨어진 자리에 그대로 남아 판 가운데가 점점 수북해짐 (판이 바뀌면 · 승자에게 쓸려 가면 사라짐) */
  const [pile, setPile] = useState<{ handNo: number; rd: number; x: number; y: number; amt: number; r: number; k: string }[]>([]);
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
  /** 7포커 히든(7번째 장)을 눌러서 열어 본 판 번호 — 안 열면 엎은 채로 두고, 족보 · 메이드도 6장으로만 셈 */
  const [peek, setPeek] = useState(0);
  /** 이름표를 눌러 보는 자리 정보 */
  const [statSeat, setStatSeat] = useState<number | null>(null);
  /** 기록 크게 보기 (가로판 오른쪽 패널의 기록) */
  const [logBig, setLogBig] = useState(false);
  /** 위 바의 「족보 · 기록」을 눌렀을 때 내려오는 상자 (기본은 닫힘 — 판을 넓게 쓰려고) */
  /** 7포커 오른쪽 아래 족보 · 기록 상자 (기본 열림) */
  const [dockOpen, setDockOpen] = useState(true);
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
    /** 카드는 이미 다 보이는 상태에서 족보만 차례로 읊음 (홀덤 올인 런아웃: 패를 먼저 깐 뒤 바닥이 다 깔리고 결과) */
    shown?: boolean;
    game: "holdem" | "seven";
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
      const tossNew: { key: number; seat: number; amt: number; n: number }[] = [];
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
              tossNew.push({ key: ++keyRef.current, seat: e.seat, amt: e.amt, n: 6 });
              pose[e.seat] = { v: "allin", until: now + 2600 };
              const s = t.seats[e.seat];
              if (s) setCutin({ char: s.look ?? s.char, name: s.name, key: ++keyRef.current });
              for (const q of t.seats)
                if (q && q.seat !== e.seat) face[q.seat] = { v: "shock", until: now + 2200 };
            } else {
              if (isBig(amt, ante)) sfx.chipBig();
              else sfx.chip();
              pose[e.seat] = { v: "bet", until: now + 1400 };
              // 칩 던지기: 건 돈이 클수록 여러 개
              const add = e.amt > 0 ? e.amt : amt;
              if (add > 0)
                tossNew.push({ key: ++keyRef.current, seat: e.seat, amt: add, n: Math.min(5, 1 + Math.floor(add / Math.max(1, ante) / 3)) });
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
        // 전부 0.75초 안에 (장수가 많으면 촘촘히)
        const step = Math.max(35, Math.min(90, Math.round(750 / items.length)));
        const fly = 220;
        setDealFx({ key: ++keyRef.current, handNo: t.handNo, items, step, fly });
        items.forEach((it) => setTimeout(sfx.card, it.k * step + fly * 0.6));
      }
      // 쇼다운: 패를 한 자리씩 깐다 — 내 자리부터 시계 방향 (이긴 사람도 제자리에서, 결과는 다 깐 뒤에)
      const resNow = t.hand?.result ?? null;
      let staged = false;
      // 홀덤 올인 런아웃: 패는 바닥이 다 깔리기 전에 이미 깠음 → 결과가 나온 지금, 족보만 차례로 읊음
      const voiceOnly =
        !shows.length &&
        Object.keys(won).length > 0 && // 결과가 막 나온 이번 한 번만 (뒤이은 갱신엔 결과가 그대로 실려 옴)
        !!t.hand &&
        !!resNow?.showdown &&
        Object.keys(resNow.names ?? {}).length > 0;
      if ((shows.length || voiceOnly) && t.hand) {
        const n = t.seats.length;
        const from = Math.max(0, mySeat);
        const order = (voiceOnly ? Object.keys(resNow!.names).map(Number) : shows.map((x) => x.seat))
          .sort((a, b) => ((a - from + n) % n) - ((b - from + n) % n));
        staged = true;
        // 깐 사람마다 자기 족보를 읊으며 패를 깜 (포커 쇼다운의 맛). 결과가 아직 없으면(런아웃 중 먼저 깐 패) 읊지 않음
        const say = order.map((seat) => {
          const look = charOf(seat);
          const line = resNow ? handLine(resNow.names[seat] ?? "") : null;
          if (!look || !line) return null;
          const has = (who: string) => hasSound(`voice/${who}/${who}-${line}`);
          return has(look) || has(lookChar(look)) ? { look, line } : null;
        });
        const rk = ++keyRef.current;
        // 대사 파일을 미리 받아 둠 (깔 때 받기 시작하면 늦게 나옴)
        for (const x of say) if (x) void voiceDuration(x.look, x.line);
        setReveal({ key: rk, handNo: t.handNo, order, step: 0, say, shown: voiceOnly, game: t.game });
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
          // 사이드 팟만 따 간 사람(족보는 2등)은 진 쪽 — 이긴 소리 · 대사는 족보가 제일 센 사람만
          const tops = topHands(t.hand);
          const topWin = (seat: number) => (tops ? tops.has(seat) : true);
          const mine = seats.some((x) => x.seat === mySeat) && topWin(mySeat);
          if (mine) (isBig(total, ante) ? sfx.bigwin : sfx.win)();
          else if (myShowed) sfx.lose();
          else sfx.pot();
          // 한마디: 끝까지 살아 있던 나 → 내 승/패 대사만. 죽었거나 구경 중 → 이긴 사람 대사만
          if (myShowed) {
            const ch = charOf(mySeat);
            const amt = seats.find((x) => x.seat === mySeat)?.amt ?? 0;
            if (ch) playVoice(ch, mine ? (isBig(amt, ante) ? "bigwin" : "win") : "lose");
          } else {
            const top = [...seats].filter((x) => topWin(x.seat)).sort((a, b) => b.amt - a.amt)[0] ?? seats[0];
            const ch = top ? charOf(top.seat) : null;
            if (ch) playVoice(ch, isBig(top.amt, ante) ? "bigwin" : "win");
          }
        };
        if (staged) pendingWinRef.current = apply;
        else apply();
      }
      if (shoutsNew.length) setShouts((cur) => [...cur.slice(-6), ...shoutsNew]);
      if (tossNew.length) setTosses((cur) => [...cur.slice(-8), ...tossNew]);
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
                : "시간 안에 안 골라서 나가기 예약됐어요 · 계속 치려면 「예약 취소」"
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

  // 패 까기 (한게임 템포): 내 자리부터 시계 방향으로 한 사람씩 — 카드가 뒤집히고, 뒤집힌 카드가 보일 즈음 그 사람이 족보를 읊음.
  // 다음 사람은 앞사람 대사가 60% 쯤 나왔을 때 깜 (대사가 없으면 7포커 0.38초 · 홀덤 0.09초). 다 깐 뒤 결과(승리 · 패배 동작과 대사)
  useEffect(() => {
    if (!reveal || reveal.step > reveal.order.length) return;
    const n = reveal.order.length;
    const seven = reveal.game === "seven";
    const step = reveal.step;
    /** 카드가 뒤집혀 앞면이 보일 즈음 대사 시작 (뒤집기 0.34초 · 7포커는 엎은 카드가 0.09초씩 차례로) */
    const lag = seven ? 300 : 260;
    const base = step === 0 ? 150 : step === n ? (seven ? 350 : 420) : seven ? 380 : 90;
    const key = reveal.key;
    let id: ReturnType<typeof setTimeout> | undefined;
    let dead = false;
    const run = () => {
      if (dead) return;
      if (step < n) {
        // 이 사람 카드 뒤집기 (step 이 하나 오르면 order[step] 자리가 깐 걸로 보임)
        if (!reveal.shown) sfx.flip();
        const say = reveal.say[step];
        // (단계가 넘어가며 이 효과가 정리돼도 대사는 그대로 나와야 해서 따로 안 지움)
        if (say) setTimeout(() => playVoiceNow(say.look, say.line), reveal.shown ? 0 : lag);
      } else {
        pendingWinRef.current?.();
        pendingWinRef.current = null;
      }
      setReveal((r) => (r && r.key === key ? { ...r, step: r.step + 1 } : r));
    };
    // 기다릴 시간: 앞사람 대사가 있으면 그 대사 길이에 맞춰서 (대사 파일은 쇼다운 시작 때 미리 받아 둠)
    const prev = step > 0 ? reveal.say[step - 1] : null;
    if (prev) {
      void voiceDuration(prev.look, prev.line).then((d) => {
        if (dead) return;
        const talk = (reveal.shown ? 0 : lag) + (d ?? 0) * 1000 * 0.6;
        id = setTimeout(run, Math.max(base, talk + (step === n ? 150 : 0)));
      });
    } else id = setTimeout(run, base);
    return () => {
      dead = true;
      if (id) clearTimeout(id);
    };
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
  /** 자리별로 늦게 친 횟수 (재촉 대사 빈도용) */
  const slowRef = useRef<Record<number, number>>({});
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
    // 남이 오래 고민하면 재촉: 한 사람이 늦게 친 게(남은 시간 2초까지 고민) 3번 쌓일 때마다 한 번. 카드 고르는 중에는 안 함
    const betting = hand.toAct >= 0 && !(hand.game === "seven" && hand.phase === "choice");
    if (!mine && betting && left === 2 && hurryRef.current !== deadline && table) {
      hurryRef.current = deadline;
      const slow = (slowRef.current[hand.toAct] ?? 0) + 1;
      slowRef.current[hand.toAct] = slow;
      const others = table.seats.filter(
        (x) => x && x.seat !== hand.toAct && x.seat !== mySeat && x.status === "in"
      );
      if (others.length && slow % 3 === 0) {
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

  /** 7포커: 히든을 아직 안 열었으면 그 장은 빼고 셈 (열어 보는 순간 메이드면 그때 대사) */
  const shutHidden = (mh: MyHand | null) =>
    !!mh && mh.cards.length === 7 && !!mh.down && peek !== mh.handNo && !table?.hand?.result;
  const seenCards = (mh: MyHand) => (shutHidden(mh) ? mh.cards.slice(0, 6) : mh.cards);
  // 내 패가 메이드(트리플 이상)가 되면 효과음 + 혼잣말
  const madeNow = (() => {
    if (!hand || hand.result || !myHand || !table || myHand.handNo !== table.handNo) return "";
    const cat =
      hand.game === "holdem"
        ? (hand as HoldemView).board.length >= 3
          ? categoryOf(evaluate([...myHand.cards, ...(hand as HoldemView).board]))
          : // 프리플랍 프리미엄(AA · KK · QQ · JJ · AK · AQs)도 메이드처럼 (효과음 · 대사 · 강조)
            preflopGrade(myHand.cards) === 2
            ? 99
            : -1
        : // 7포커는 카드를 고르자마자(3장부터) — 처음 받은 카드에 트리플이 있으면 고른 순간 바로 (예전엔 5장이 돼야 떴음)
          myHand.down && myHand.cards.length >= 3
          ? kCategory(bestK(seenCards(myHand)).score)
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
        const stack = me?.stack ?? 0;
        // 미리 눌러 둔 베팅이 그 사이 팟이 커져 올인이 돼 버리면 자동으로 안 함 — 칸이 「올인」으로 바뀌니 직접 눌러야 함
        const wouldAllIn = (() => {
          if (!lg) return false;
          if (pre === "call" || pre === "callbbing") return lg.toCall > 0 ? lg.toCall >= stack : (lg.bets.bbing ?? 0) >= stack;
          if (pre === "bbing" || pre === "ddadang" || pre === "quarter" || pre === "half") return (lg.bets[pre] ?? 0) >= stack;
          return false;
        })();
        if (sv2.phase === "bet" && lg && wouldAllIn) {
          setInfo({ text: "미리 누른 베팅이 올인이 돼서 직접 골라 주세요", key: Date.now() });
        } else if (sv2.phase === "bet" && lg) {
          if (pre === "die") void doAct({ a: "die" });
          else if (pre === "call" || pre === "callbbing") {
            // 받을 돈이 있으면 얼마든(삥·따당·하프…) 콜, 없으면 삥
            if (lg.toCall > 0) void doAct({ a: "call" });
            else if (lg.bets.bbing !== undefined) void doAct({ a: "bbing" });
          } else if (pre === "bbing" || pre === "ddadang" || pre === "quarter" || pre === "half") {
            // 눌러 둔 그대로만 (삥을 눌러 뒀는데 그 사이 누가 걸어 삥이 없어지면 따당으로 바꿔 치지 않고 안 함)
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

  // 전체화면으로 방 안에 있을 때 뒤로가기 = 나가기 버튼 (뒤로가기가 전체화면만 풀어 버리는 폰은 PokerApp 이 "pk-back" 으로 알려 줌)
  const backRef = useRef<() => void>(() => {});
  useEffect(() => {
    backRef.current = () => {
      if (me?.exit) return setNotice("나가기 예약 중이에요 · 이번 판이 끝나면 나가요");
      void exit();
    };
  });
  useEffect(() => {
    if (!fs) return;
    let last = 0;
    const back = () => {
      if (Date.now() - last < 1000) return; // 전체화면 풀림 + 뒤로가기가 한 번에 와도 한 번만
      last = Date.now();
      backRef.current();
    };
    const onPop = () => {
      history.pushState(history.state, "", location.href); // 방 화면은 그대로 두고
      back();
    };
    history.pushState(history.state, "", location.href);
    window.addEventListener("popstate", onPop);
    window.addEventListener("pk-back", back);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("pk-back", back);
    };
  }, [fs]);

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
  const L = layoutFor(n);
  // 카드가 주인공 — 한게임 비율(화면 높이 대비): 7포커 남의 편 카드 17.5% · 내 카드 21% · 캐릭터 상반신 18.5%. 홀덤은 9인이라 조금 작게
  const seven = table.game === "seven";
  /** 7포커: 자리마다 틀(프레임) 배치 — 무대 크기에 비례해서 PC · 폰 어디서든 같은 모양 */
  const SF = seven ? sevenFrames(w, h, 40, Math.round(Math.min(15, Math.max(12, u * 1.45 + 4.6)) * 1.75)) : null;
  const sizes: Sizes = {
    o: "h",
    u,
    card: SF ? SF.cardW : u * 10,
    heroCard: SF ? SF.me.cardW : u * 13,
    boardCard: u * 10.5,
    face: u * 8.4,
  };
  const base = table.game === "holdem" ? tier.bb : tier.ante;
  const totalMs = sv && sv.phase === "choice" ? CHOICE_MS : ACT_MS;
  const frac = deadline ? Math.max(0, Math.min(1, (deadline - now) / totalMs)) : 0;
  /** 남은 초 (3초 이하면 3 · 2 · 1 카운트다운) */
  const secLeft = deadline ? Math.ceil((deadline - now) / 1000) : 0;
  const counting = secLeft >= 1 && secLeft <= 3;
  const liveHand = myHand && myHand.handNo === table.handNo && hand ? myHand : null;
  const hint =
    !me || !liveHand ? "" : hv ? holdemHint(liveHand, hv) : sv ? sevenHint({ ...liveHand, cards: seenCards(liveHand) }) : "";
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
  const revealed = (seat: number) =>
    revealDone || !!reveal!.shown || reveal!.step > reveal!.order.indexOf(seat);
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
  /** 보여 줄 보유 칩: 패 까기 연출 중엔 딴 돈을 빼고 (결과보다 칩이 먼저 올라 스포일러가 되지 않게) */
  const stackShown = (seat: number, stack: number) =>
    rawRes && !revealDone ? stack - (rawRes.won[seat] ?? 0) : stack;
  const winners = res ? Object.keys(res.won).map(Number) : [];
  /**
   * 쇼다운에서 족보가 제일 센 사람(같으면 여럿). 사이드 팟을 따 간 두 번째 사람은 돈은 받아도 이긴 동작은 아님.
   * 쇼다운이 아니면(다 죽고 혼자 남음) null = 판 가져간 사람이 이김
   */
  const topSeats = topHands(hand);
  /** 이긴 동작 · 이긴 대사를 할 사람인지 */
  const isTop = (seat: number) => (topSeats ? topSeats.has(seat) : (rawRes?.won[seat] ?? 0) > 0);
  const poseOf = (seat: number): Pose => {
    const p = hand?.players[seat];
    const t = poses[seat]; // (시간이 지난 것은 주기적으로 지워짐)
    if (t) return t.v;
    if (res) {
      if ((res.won[seat] ?? 0) > 0) return isTop(seat) ? "win" : "lose";
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

  const tableW = (L.table.w / 100) * w;
  const tableH = tableW * (544 / 1400);
  const tableTop = (L.table.top / 100) * h;
  /** 판은 무대 전체 폭 (기록 · 족보는 오른쪽 위 작은 상자로) */
  const boardW = w;
  const px = (pct: number) => (pct / 100) * boardW;
  const py = (pct: number) => (pct / 100) * h;
  const bar = 40;
  /*
   * 자리 틀 (한게임처럼): [아바타][카드 칸] 한 줄 + 그 아래 이름 · 칩 띠. 아바타 키 = 카드 키 (캐릭터와 카드가 맞먹게)
   *   7포커: 앉은 캐릭터 그림(3:4) · 홀덤: 얼굴 아이콘(정사각)
   */
  const cardH = Math.round(sizes.card * 1.4);
  const avH = seven ? cardH : Math.round(cardH * 0.8);
  const avW = seven ? Math.round(cardH * 0.75) : avH;
  /** 카드 칸 폭: 7포커는 엎은 묶음 + 편 카드 4장이 들어가는 폭, 홀덤은 두 장 */
  const boxW = seven ? Math.round(sizes.card * 3.6) : Math.round(sizes.card * 2 + 4);
  const frameW = avW + 6 + boxW;
  /** 내 아바타: 왼쪽 아래를 크게 (7포커 앉은 그림은 무대 높이의 30%, 홀덤 얼굴은 20%) + 그 아래 내 정보 띠 */
  const heroAvH = seven ? Math.round(h * 0.29) : Math.round(h * 0.18);
  const heroAvW = seven ? Math.round(heroAvH * 0.75) : heroAvH;
  const heroW = Math.max(heroAvW, Math.round(u * 30));
  /** 이름 · 칩 띠의 높이 (무대 글자 크기 × 1.75 쯤) */
  const stripH = Math.round(Math.min(15, Math.max(12, u * 1.45 + 4.6)) * 1.75);
  /** 아바타 가운데 x — 틀이 무대 밖으로 안 나가게 */
  const seatX = (pct: number, dir: number) =>
    dir > 0 ? Math.max(avW / 2 + 4, px(pct)) : Math.min(boardW - avW / 2 - 4, px(pct));
  const myCat = !liveHand
    ? -1
    : hv
      ? hv.board.length >= 3
        ? holdemRankIdx(evaluate([...liveHand.cards, ...hv.board]))
        : preflopGrade(liveHand.cards) === 2
          ? 99
          : -1
      : sv && liveHand.down && liveHand.cards.length >= 3
        ? kCategory(bestK(seenCards(liveHand)).score)
        : -1;
  /** 건 돈 알약 폭의 절반 (어림: 칩 + 글자 다섯 자쯤) */
  const betHalfW = () => {
    const fpx = Math.min(15, Math.max(11, u * 1.45 + 4.6));
    return (Math.max(22, u * 3.4) * 1.25 + fpx * 1.5 * 3.6) / 2;
  };
  /** 건 돈 알약이 무대 밖으로 안 나가게 */
  const clampBetX = (x: number) => {
    const half = betHalfW();
    return Math.max(half + 4, Math.min(boardW - half - 4, x));
  };
  /** 자리 틀의 자리: 아바타 가운데(x) · 카드 줄 세로 가운데(y) · 카드 칸이 시작하는 x(x0) · 방향 */
  const cardsAt = (seat: number) => {
    const sp = spotOf(seat);
    const dir = sp.cards === "r" ? 1 : -1;
    const x = seatX(sp.x, dir);
    return { x, x0: x + dir * (avW / 2 + 6), dir, y: py(sp.y) };
  };
  /** 건 돈이 놓이는 곳 (칩 날리기 끝점): 옆자리는 카드 칸 바로 앞(판 쪽), 위쪽 자리는 띠 아래 */
  const betPoint = (seat: number) => {
    if (seat === mySeat) return { x: (L.heroX / 100) * boardW, y: (L.heroCards / 100) * h - 6 };
    const sp = spotOf(seat);
    const { x0, dir, y } = cardsAt(seat);
    // 위쪽 줄(위 가운데 · 양옆 맨 위)은 건 돈을 띠 아래에 — 옆으로 내면 이웃 자리를 덮음
    if (sp.side === "top" || sp.y < 20) return { x: x0 + dir * boxW * 0.5, y: y + cardH / 2 + stripH + 30 };
    return { x: clampBetX(x0 + dir * (boxW + 8 + betHalfW())), y };
  };
  /** 외침이 시작되는 곳: 아바타 머리 위 (카드 줄은 안 덮게) — 위쪽 자리는 위 바에 안 걸리게 */
  const shoutFrom = (seat: number) => {
    if (SF) {
      const f = frameOf(seat);
      return { x: charMid(seat).x, y: Math.max(bar + 30, f.y + 14) };
    }
    if (seat === mySeat) return { x: 12 + heroW / 2, y: h - 8 - stripH * 2 - heroAvH - 24 };
    const { x, dir, y } = cardsAt(seat);
    return { x: x - dir * avW * 0.25, y: Math.max(bar + 36, y - avH / 2 - 14) };
  };
  /** 메이드(트리플 이상): 키가 바뀔 때마다 터지는 효과가 한 번 재생됨 */
  const madeKey = myCat >= 3 ? `${table.handNo}:${myCat}` : "";
  const emote = (e: Emote) => {
    setDrawer("");
    sendEmote(id, e).catch((err: ApiError) => setNotice(err.message ?? ""));
  };
  /** 7포커 틀 자리: 내 자리(0번) = 왼쪽 아래 큰 틀, 나머지는 배치표의 왼쪽/오른쪽 · 윗줄/아랫줄 */
  const frameOf = (seat: number) => {
    const S = SF!;
    const k = (seat - Math.max(0, mySeat) + n) % n;
    if (k === 0) return { ...S.me, dir: 1 };
    const sp = L.spots[k];
    const left = sp.side === "left";
    return {
      x: left ? S.mx : w - S.mx - S.fw,
      y: sp.y < 30 ? S.row1 : S.row2,
      w: S.fw,
      h: S.F,
      cell: S.cell,
      charW: S.charW,
      cardW: S.cardW,
      areaW: S.areaW,
      strip: S.strip,
      dir: left ? 1 : -1,
    };
  };
  /** 틀의 캐릭터 칸 가운데 */
  const charMid = (seat: number) => {
    const f = frameOf(seat);
    return { x: f.dir > 0 ? f.x + f.charW / 2 : f.x + f.w - f.charW / 2, y: f.y + f.cell / 2 };
  };
  /** 판 가운데 칩 더미 (던진 칩이 쌓이는 곳): POT 아래 납작한 타원 안 아무 데나 (던질 때마다 다른 자리) */
  // 칩 더미는 판(초록 천) 한가운데 — POT 글자는 그 위에 고정
  const potPoint = { x: w / 2, y: tableTop + tableH * 0.63 };
  const pileSpot = (key: number) => {
    const a = ((key * 137.508) % 360) * (Math.PI / 180);
    const r = 0.15 + ((key * 7919) % 100) / 125;
    return { x: potPoint.x + Math.cos(a) * tableW * 0.11 * r, y: potPoint.y + Math.sin(a) * tableH * 0.06 * r };
  };
  /** 7포커 틀 하나: [캐릭터 칸][카드 칸] + 아래 이름 · 칩 띠. 빈자리도 틀은 늘 자리를 지킴 */
  const sevenFrame = (i: number) => {
    const f = frameOf(i);
    const s = table.seats[i];
    const hero = i === mySeat;
    const right = f.dir < 0;
    // 이모티콘이 떠 있는 동안은 그 틀을 다른 틀 · 위 바보다 위로 (말풍선이 위 틀 · 위 바에 가려지지 않게)
    const box: CSSProperties = { left: f.x, top: f.y, width: f.w, height: f.h, zIndex: emotes[i] ? 40 : hero ? 21 : 34 };
    if (!s)
      return (
        <div key={i} className="pk-sf pk-sf-empty absolute flex items-center justify-center" style={box}>
          {sitState === "watching" || sitState === "password" ? (
            <button type="button" onClick={() => void trySit()} className="pk-btn pk-btn-ghost px-[1em] py-[0.45em] text-[0.85em]">
              앉기
            </button>
          ) : (
            <span className="text-[0.8em] text-white/25">빈 자리</span>
          )}
        </div>
      );
    const p = hand?.players[i];
    const live = !!p && !p.folded && !rawRes;
    const wonHere = res?.won[i] ?? 0;
    const waiting = isWaiting(i);
    const dim = !!p?.folded || (s.status !== "in" && !live);
    const look = s.look ?? s.char;
    const stale = !!p && !p.folded && !p.allIn && !!hand && !hand.result && p.bet < hand.currentBet;
    const tag = p?.last && !res && !stale ? p.last.a : null;
    const resultName = hand?.result?.names[i] && revealed(i) ? hand.result.names[i] : res && p?.folded ? (table.game === "seven" ? "다이" : "폴드") : "";
    const net = res && p ? wonHere - p.invested : null;
    const bet = p && !rawRes ? p.bet : 0;
    const cards = !sv
      ? null
      : sevenSeatCards({
          view: sv,
          seat: i,
          hero,
          myHand: hero ? liveHand : null,
          tier: table.tier,
          sizes,
          side: "left",
          hide: !hero && !revealed(i),
          settled: revealDone,
          dealDelay: dealOf(i),
          maxW: f.areaW - 6,
          hiddenShut: hero && shutHidden(liveHand),
          onPeek: () => {
            sfx.flip();
            setPeek(table.handNo);
          },
        });
    return (
      <div
        key={i}
        className={`pk-sf absolute flex flex-col ${hero ? "pk-sf-me" : ""}`}
        data-turn={waiting ? "1" : undefined}
        data-win={wonHere > 0 && isTop(i) ? "1" : undefined}
        style={box}
      >
        <div className={`flex min-h-0 flex-1 ${right ? "flex-row-reverse" : ""}`}>
          {/* 캐릭터 칸: 누르면 자리 정보(전적 · 강퇴 투표). 위엔 이번 구에 건 돈, 아래엔 행동 글자. 남은 시간은 이 칸 테두리를 따라 */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setStatSeat(i)}
            onKeyDown={(e) => e.key === "Enter" && setStatSeat(i)}
            className={`pk-sf-char relative flex-none cursor-pointer ${right ? "pk-sf-char-r" : ""} ${wonHere > 0 ? "pk-seat-win" : waiting ? "pk-seat-turn" : ""}`}
            style={{ width: f.charW, height: f.cell }}
          >
            <span className="absolute inset-0 overflow-hidden" style={{ opacity: dim ? 0.5 : 1 }}>
              <CharSprite char={look} pose={poseOf(i)} seat="front" w={f.charW} dim={dim} />
            </span>
            {waiting && deadline > 0 && <PlateTimer frac={frac} />}
            {bet > 0 && (
              // 틀 크기에 비례 (내 틀이 크니 글씨도 같은 비율로 크게)
              <span className="pk-sf-bet pk-num" style={{ fontSize: `${(0.82 * f.cell) / SF!.cell}em` }}>
                <Money won={bet} />
              </span>
            )}
            {waiting && counting && (
              <span key={secLeft} className="pk-count-sm" aria-label={`${secLeft}초`}>
                {secLeft}
              </span>
            )}
            {tag && (
              <span className="pk-sf-act" key={`${table.handNo}-${tag}-${p?.bet ?? 0}`}>
                <ActWord a={tag} className={hero ? "pk-acttag-me" : ""} />
              </span>
            )}
            {gains[i] && wonHere > 0 && (
              <Rise key={gains[i].key} className="absolute top-[18%] left-1/2 -translate-x-1/2 text-[1.2em] text-[var(--pk-brass)]">
                +{fmtShort(gains[i].amt)}
              </Rise>
            )}
          </div>
          {/* 카드 칸: 캐릭터 칸에 딱 붙게, 엎은 카드 묶음 → 편 카드 차곡차곡. 족보 · 결과 글자는 카드 아랫단 위에 */}
          <div
            className={`pk-sf-cards relative flex min-w-0 flex-1 justify-start ${hero ? "items-start" : "items-center"}`}
            // 카드는 늘 왼쪽부터 차곡차곡. 내 카드: 위에 메이드 카드가 떠오를 틈, 아래에 족보 글자 자리를 남김
            style={{ padding: hero ? `${Math.round(f.cell * 0.075)}px 3px 0` : "0 3px" }}
          >
            {hero && madeKey && !res && <span key={`burst-${madeKey}`} className="pk-made-burst" aria-hidden />}
            {cards}
            {/* 판이 끝나면 이번 판 손익: 카드 칸 오른쪽 위에 크게 */}
            {net !== null && net !== 0 && revealed(i) && (
              <span key={`net-${table.handNo}`} className={`pk-sf-net pk-num ${net > 0 ? "pk-sf-net-up" : "pk-sf-net-down"}`}>
                {net > 0 ? "+" : "−"}
                {fmtShort(Math.abs(net))}
              </span>
            )}
            <span className="pk-sf-label" style={hero ? { bottom: 2 } : undefined}>
              {hero && hint && !res && !resultName && (
                <span className={`pk-handtag pk-pop ${madeKey ? "pk-made" : ""}`}>
                  <span className="pk-tag-t">{hint}</span>
                </span>
              )}
              {resultName && (
                <span
                  key={`${table.handNo}-${revealDone ? 1 : 0}`}
                  className={`pk-resulttag pk-stamp ${res && wonHere > 0 && isTop(i) ? "pk-resulttag-win" : resultName === "다이" || resultName === "폴드" ? "pk-resulttag-out" : ""}`}
                >
                  <span className="pk-tag-t">{resultName}</span>
                </span>
              )}
            </span>
          </div>
        </div>
        {/* 이름 · (나만) 이 방 총 득실 · 보유 칩 */}
        {/* 이름(나는 옆에 이 방 총 득실 작게) · 가운데 이번 판 총 베팅 · 보유 칩 */}
        <div className="pk-sf-strip relative" style={{ height: f.strip }}>
          <span className="flex min-w-0 flex-1 items-baseline gap-[0.35em]">
            <span className="pk-name min-w-0 truncate">{s.name}</span>
            {hero && s.net !== 0 && (
              <span className={`pk-num shrink-0 text-[0.7em] font-bold ${s.net > 0 ? "text-[#ff5a5f]" : "text-[#4aa3ff]"}`}>
                {s.net > 0 ? "+" : "−"}
                {fmtShort(Math.abs(s.net))}
              </span>
            )}
          </span>
          <span className="pk-sf-total pk-num shrink-0 whitespace-nowrap">
            {p && p.invested > 0 ? (
              <>
                <span className="pk-sf-total-l">베팅</span>
                <Money won={p.invested} />
              </>
            ) : null}
          </span>
          <span className="pk-stack pk-num flex-1 shrink-0 whitespace-nowrap" style={{ textAlign: "right" }}>
            {p?.allIn && !res ? (
              <span className="text-[var(--pk-danger)]">ALL IN</span>
            ) : s.status === "out" && !live ? (
              <span className="text-white/45">자리 비움</span>
            ) : (
              <>
                <img src={asset.chip("gold", "top")} alt="" className="mr-[0.25em] inline h-[0.9em] w-[0.9em] align-[-0.1em]" />
                <Money won={stackShown(i, s.stack)} />
              </>
            )}
          </span>
          {s.away && (
            <span className="pk-net-mark pk-net-in">
              <i />
              연결 불안정…
            </span>
          )}
        </div>
        {/* 나가기 예약 · 강퇴 투표: 틀 윗선 가운데에 걸쳐서 (아래에 두면 아래 틀 · 화면 끝에 묻힘) */}
        {(s.votes > 0 || s.exit) && (
          <div className="pointer-events-none absolute top-0 left-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-[0.3em]">
            {s.votes > 0 && <span className="pk-vote-mark">⚠ 강퇴 {s.votes}/3</span>}
            {s.exit && <span className="pk-exit-mark">나가기 예약</span>}
          </div>
        )}
        {/* 이모티콘: 캐릭터 머리 위 */}
        {emotes[i] &&
          (() => {
            const size = Math.round(Math.max(40, Math.min(104, f.cell * 0.5)));
            return (
              <div
                key={emotes[i].key}
                className="pk-emote pointer-events-none absolute"
                // 캐릭터 칸 바로 위 가운데, 꼬리는 아래(머리)를 가리킴
                style={{ [right ? "right" : "left"]: f.charW / 2 - size / 2 - 4, top: Math.max(bar + 2 - f.y, -Math.round(size * 0.7)), zIndex: 45 }}
              >
                <EmoteBubble tail="b">
                  <EmoteImg char={look} emote={emotes[i].v} size={size} />
                </EmoteBubble>
              </div>
            );
          })()}
      </div>
    );
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
            // 판 위 칩(7)보다 위 — 정보 줄이 날아온 칩에 안 가리게
            zIndex: 8,
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
            pileOn={!!SF && pile.some((c) => c.handNo === table.handNo)}
            myToCall={
              sv && mySeat >= 0 && sv.players[mySeat] && !sv.players[mySeat].folded && !sv.result
                ? Math.max(0, sv.currentBet - sv.players[mySeat].bet)
                : 0
            }
          />
        </div>

        {/* 다른 자리 틀: [아바타][카드 칸] + 아래 이름 · 칩 띠 (한게임처럼 한 덩어리), 판 쪽에 건 돈 */}
        {SF && table.seats.map((_, i) => sevenFrame(i))}
        {!SF && table.seats.map((s, i) => {
          if (i === mySeat) return null;
          const p = hand?.players[i];
          const live = !!p && !!s && !p.folded && !rawRes;
          const inHand = !!p && !!s && (s.status === "in" || live);
          const bet = inHand && !rawRes ? p!.bet : 0;
          const { x, dir, y } = cardsAt(i);
          const betAt = betPoint(i);
          const seven = table.game === "seven";
          /** 틀의 바깥쪽 모서리 (왼쪽 자리는 left, 오른쪽 자리는 right) */
          const edge = dir > 0 ? { left: x - avW / 2 } : { right: boardW - (x + avW / 2) };
          if (!s)
            return (
              <div
                key={i}
                className="absolute flex items-center justify-center"
                style={{ ...edge, top: y - cardH / 2, width: frameW, height: cardH + stripH, zIndex: 5 }}
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
                    className="block rounded-[10px] border border-dashed border-white/[0.09]"
                    style={{ width: frameW * 0.6, height: (cardH + stripH) * 0.6 }}
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
                  side: dir > 0 ? "left" : "right",
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
                  side: dir > 0 ? "left" : "right",
                  hide: !revealed(i),
                  settled: revealDone,
                  dealDelay: dealOf(i),
                  maxW: boxW,
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
          const waiting = isWaiting(i);
          // 결과: 깐 사람은 족보, 죽은 사람은 「다이」(홀덤은 「폴드」) (한게임처럼 누가 어떻게 끝났는지 한눈에)
          const resultName = hand?.result?.names[i] && revealed(i) ? hand.result.names[i] : res && p?.folded ? (table.game === "seven" ? "다이" : "폴드") : "";
          /** 결과가 난 뒤 이 자리의 손익 (딴 돈 − 넣은 돈) */
          const net = res && p ? (res.won[i] ?? 0) - p.invested : null;
          const look = s.look ?? s.char;
          return (
            <div key={i}>
              <div
                className={`pk-seat absolute flex flex-col ${dir > 0 ? "items-start" : "items-end"}`}
                style={{ ...edge, top: y - cardH / 2, width: frameW, zIndex: 34 }}
              >
                {/* 윗줄: 아바타 + 카드 칸 (아래 끝 맞춤) */}
                <div className={`flex items-end gap-[6px] ${dir > 0 ? "" : "flex-row-reverse"}`}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setStatSeat(i)}
                    onKeyDown={(e) => e.key === "Enter" && setStatSeat(i)}
                    className={`pk-av relative cursor-pointer ${wonHere > 0 ? "pk-seat-win" : waiting ? "pk-seat-turn" : ""}`}
                    data-turn={waiting ? "1" : undefined}
                    style={{ width: avW, height: avH, opacity: dim ? 0.55 : 1 }}
                  >
                    {seven ? (
                      <CharSprite char={look} pose={poseOf(i)} seat="front" w={avW} dim={dim} />
                    ) : (
                      <FaceIcon char={look} face={faceOf(i)} size={avW} />
                    )}
                    {waiting && deadline > 0 && (
                      <TimerRing size={avW} frac={frac} width={3} square={seven} />
                    )}
                    {badge && <span className="pk-badge">{badge}</span>}
                    {/* 이번 판 총 베팅: 얼굴 위 */}
                    {p && p.invested > 0 && !res && (
                      <span className="pk-face-bet pk-num">
                        <Money won={p.invested} />
                      </span>
                    )}
                    {waiting && counting && (
                      <span key={secLeft} className="pk-count-sm" aria-label={`${secLeft}초`}>
                        {secLeft}
                      </span>
                    )}
                  </div>
                  <div
                    className={`pk-seat-cards flex items-end ${dir > 0 ? "justify-start" : "justify-end"}`}
                    style={{ width: boxW, height: cardH }}
                  >
                    {cards}
                  </div>
                </div>
                {/* 아랫줄: 이름 · 칩 띠 (틀 폭 전부) */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setStatSeat(i)}
                  onKeyDown={(e) => e.key === "Enter" && setStatSeat(i)}
                  className="pk-plate pk-strip relative cursor-pointer"
                  data-turn={waiting ? "1" : undefined}
                  style={{ width: frameW, height: stripH, opacity: dim ? 0.75 : 1, borderColor: wonHere > 0 ? "var(--pk-brass)" : undefined }}
                >
                  {/* 행동 글자 · 결과 족보: 띠 위에 걸쳐서 (카드 아랫단을 살짝 덮음 — 한게임처럼) */}
                  {tag && <ActTag key={`${table.handNo}-${tag}-${p?.bet ?? 0}`} a={tag} over />}
                  {resultName && (
                    <span className="absolute left-1/2 z-20 -translate-x-1/2" style={{ bottom: "calc(100% - 0.4em)" }}>
                      <span
                        key={`${table.handNo}-${revealDone ? 1 : 0}`}
                        className={`pk-resulttag pk-stamp ${res && wonHere > 0 && isTop(i) ? "pk-resulttag-win" : resultName === "다이" || resultName === "폴드" ? "pk-resulttag-out" : ""}`}
                      >
                        <span className="pk-tag-t">{resultName}</span>
                      </span>
                    </span>
                  )}
                  {gains[i] && wonHere > 0 && (
                    <Rise
                      key={gains[i].key}
                      className="absolute -top-[2.3em] left-1/2 -translate-x-1/2 text-[1.2em] text-[var(--pk-brass)]"
                    >
                      +{fmtShort(gains[i].amt)}
                    </Rise>
                  )}
                  {net !== null && net !== 0 && (
                    <span className={`pk-net pk-num ${net > 0 ? "pk-net-up" : "pk-net-down"}`}>
                      {net > 0 ? "+" : "−"}
                      {fmtShort(Math.abs(net))}
                    </span>
                  )}
                  <span className="pk-name min-w-0 flex-1 truncate text-left">{s.name}</span>
                  <span className="pk-stack pk-num shrink-0 whitespace-nowrap">
                    {p?.allIn && !res ? (
                      <span className="text-[var(--pk-danger)]">ALL IN</span>
                    ) : s.status === "out" && !live ? (
                      <span className="text-white/45">자리 비움</span>
                    ) : (
                      <Money won={stackShown(i, s.stack)} />
                    )}
                  </span>
                  {s.away && (
                    <span className="pk-net-mark pk-net-in">
                      <i />
                      연결 불안정…
                    </span>
                  )}
                </div>
                {/* 띠 아래 꼬리표 */}
                {(s.votes > 0 || s.exit) && (
                  <div className="pointer-events-none flex flex-col items-center self-center">
                    {s.votes > 0 && (
                      <span className="pk-vote-mark" title="강퇴 투표">
                        ⚠ 강퇴 {s.votes}/3
                      </span>
                    )}
                    {s.exit && <span className="pk-exit-mark">나가기 예약</span>}
                  </div>
                )}
              </div>
              {/* 이모티콘 말풍선: 아바타 머리 위 */}
              {emotes[i] &&
                (() => {
                  // 얼굴 아이콘 바로 위, 말풍선 꼬리는 아래(얼굴)를 가리킴 · 이름표 · 카드보다 위에
                  const size = Math.round(Math.max(44, Math.min(84, avH * 0.85)));
                  const ex = Math.max(size / 2 + 8, Math.min(boardW - size / 2 - 8, x));
                  const ey = Math.max(bar + 4, y + cardH / 2 - avH - size - 18);
                  return (
                    <div
                      key={emotes[i].key}
                      className="pk-emote pointer-events-none absolute w-max"
                      style={{ left: ex - size / 2 - 4, top: ey, zIndex: 40 }}
                    >
                      <EmoteBubble tail="b">
                        <EmoteImg char={look} emote={emotes[i].v} size={size} />
                      </EmoteBubble>
                    </div>
                  );
                })()}
              {bet > 0 && (
                <div
                  className="absolute w-max -translate-x-1/2 -translate-y-1/2 whitespace-nowrap"
                  style={{ left: betAt.x, top: betAt.y, zIndex: 8 }}
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
              if (SF) {
                const f = frameOf(seat);
                const cx = f.dir > 0 ? f.x + f.charW + f.cardW * 0.6 : f.x + f.w - f.charW - f.cardW * 0.6;
                return { x: cx, y: f.y + f.cell / 2, s: f.cardW / cw };
              }
              if (seat === mySeat)
                return {
                  x: (L.heroX / 100) * boardW,
                  y: (L.heroCards / 100) * h + sizes.heroCard * 0.7,
                  s: sizes.heroCard / cw,
                };
              if (!spotOf(seat)) return null;
              const { x0, dir, y } = cardsAt(seat);
              return { x: x0 + dir * cw * 0.6, y, s: 1 };
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
              className="pk-cd pointer-events-none absolute"
              data-n={secLeft}
              style={{
                // 홀덤은 바닥 카드를 안 가리게 내 카드 오른쪽 옆에
                left: SF ? px(L.table.cx) : (L.heroX / 100) * boardW + sizes.heroCard * 1.75,
                top: SF ? tableTop + tableH * 0.63 : (L.heroCards / 100) * h + sizes.heroCard * 0.7,
                zIndex: 34,
                fontSize: Math.max(36, u * (SF ? 9 : 7.5)),
              }}
            >
              <svg viewBox="0 0 100 100" aria-hidden>
                <circle cx="50" cy="50" r="44" className="pk-cd-track" />
                <circle cx="50" cy="50" r="44" className="pk-cd-ring" pathLength={100} />
              </svg>
              <b>{secLeft}</b>
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
                  // 이름표 · 카드보다 위에 보이게 하되, 판 쪽으로 내려가지 않고 머리 높이에서 가운데 쪽으로만 날아감 (카드 줄을 덮지 않게)
                  zIndex: 36,
                  fontSize: Math.max(30, u * 6),
                  color: SHOUT_COLOR[sh.a] ?? "#fff",
                  // 내 외침은 내 카드 쪽으로 가지 않고 내 캐릭터 머리 위로만 살짝 떠오름
                  "--dx": `${sh.seat === mySeat ? 0 : (to.x - from.x) * 0.08}px`,
                  "--dy": `${-u * 4}px`,
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
              const to = SF ? charMid(seat) : betPoint(seat);
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
          !SF &&
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

        {/* 판 위에 흩어져 쌓인 칩 (결과가 나 승자에게 쓸려 가면 사라짐) */}
        {SF &&
          !(rawRes && revealDone) &&
          pile
            .filter((c) => c.handNo === table.handNo)
            .map((c, idx) => {
              const sz = Math.max(14, u * 2.3);
              // 구가 넘어가면 지난 구에 흩어져 있던 칩이 가운데로 쓸려 모여 한 더미가 됨
              const old = c.rd < (sv?.round ?? 0) || !!rawRes;
              const x = old ? potPoint.x + (c.x - potPoint.x) * 0.28 : c.x;
              const y = old ? potPoint.y + (c.y - potPoint.y) * 0.28 - (idx % 12) * 1.5 : c.y;
              return (
                <img
                  key={c.k}
                  src={asset.chip(chipColor(c.amt / base), "top")}
                  alt=""
                  draggable={false}
                  className="pk-pilechip pointer-events-none absolute"
                  style={{ left: x - sz / 2, top: y - sz / 2, width: sz, height: sz, zIndex: 7, transform: `rotate(${c.r}deg)` }}
                />
              );
            })}

        {/* 베팅 순간: 아바타(손)에서 건 돈 자리로 칩이 포물선으로 던져짐 */}
        {tosses.map((t) => {
          const from = SF
            ? charMid(t.seat)
            : t.seat === mySeat
              ? { x: 12 + heroW / 2 + 10, y: h - 8 - stripH * 2 - heroAvH * 0.55 }
              : (() => {
                  const { x, dir, y } = cardsAt(t.seat);
                  return { x: x + dir * avW * 0.3, y };
                })();
          // 7포커: 던진 칩은 판 가운데 칩 더미 둘레 아무 데나 떨어져 그대로 쌓임 (판 위에 자리별로 깔지 않음)
          const to = SF ? pileSpot(t.key) : betPoint(t.seat);
          const sz = Math.max(14, u * (SF ? 2.3 : 3));
          return Array.from({ length: t.n }, (_, i) => (
            <div
              key={`${t.key}-${i}`}
              className="pk-toss pointer-events-none absolute"
              style={
                {
                  left: from.x,
                  top: from.y,
                  zIndex: 12,
                  animationDelay: `${i * 70}ms`,
                  "--dx": `${to.x - from.x + ((i % 3) - 1) * 6}px`,
                  "--dy": `${to.y - from.y + (i % 2) * 4}px`,
                  "--arc": `${-Math.max(30, Math.abs(to.x - from.x) * 0.18)}px`,
                } as CSSProperties
              }
              onAnimationEnd={() => {
                if (i !== t.n - 1) return;
                setTosses((c) => c.filter((x) => x.key !== t.key));
                if (SF)
                  setPile((c) => [
                    ...c.filter((x) => x.handNo === table.handNo).slice(-60),
                    ...Array.from({ length: t.n }, (_, j) => ({
                      handNo: table.handNo,
                      rd: sv?.round ?? 0,
                      x: to.x + ((j % 3) - 1) * 6,
                      y: to.y + (j % 2) * 4 - j * 2.5,
                      amt: t.amt,
                      r: ((t.key * 37 + j * 53) % 60) - 30,
                      k: `${t.key}-${j}`,
                    })),
                  ]);
              }}
            >
              {}
              <img
                src={asset.chip(chipColor(t.amt / base), "top")}
                alt=""
                draggable={false}
                style={{ width: sz, height: sz }}
              />
            </div>
          ));
        })}

        {/* 내 자리 (홀덤 — 7포커는 틀로) */}
        {me && !SF && (
          <HeroArea
            me={{ ...me, stack: stackShown(mySeat, me.stack) }}
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
            avW={heroAvW}
            avH={heroAvH}
            frameW={heroW}
            isButton={!!hv && hv.button === mySeat}
            onStats={() => setStatSeat(mySeat)}
            madeKey={madeKey}
            settled={revealDone}
            collected={!!rawRes}
            myRevealed={revealed(mySeat)}
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

        {/* 승자 컷인: 쇼다운으로 끝났을 때만 — 내가 이기면 내 전신이 크게, 남이 이기면 그 캐릭터가 한쪽에서 작게 기뻐함 (진 건 내 틀에서만) */}
        {res &&
          res.showdown &&
          revealDone &&
          winners.length > 0 &&
          (() => {
            const top = winners.filter(isTop);
            const mineWin = top.includes(mySeat);
            const seat = mineWin ? mySeat : top[0];
            const ws = table.seats[seat];
            if (seat === undefined || !ws) return null;
            // 남 승자는 그 사람 자리 쪽에서 (7포커 틀 기준 왼쪽/오른쪽, 홀덤은 자리 x 로)
            // 남 승자: 7포커는 그 사람 틀 쪽 가운데 칸 가장자리, 홀덤은 늘 오른쪽 아래(결과 땐 버튼 줄이 비어 있는 자리)
            const side: "l" | "r" = mineWin ? "l" : SF ? (frameOf(seat).dir > 0 ? "l" : "r") : "r";
            return (
              <WinCutIn
                key={`cut-${table.handNo}`}
                look={ws.look ?? ws.char}
                mine={mineWin}
                side={side}
                h={h}
                // 7포커: 내 틀 위에 서서 (남 틀 바로 안쪽) · 홀덤: 화면 아래에 서서
                bottom={SF ? h - SF.me.y : 0}
                inset={SF ? `${((SF.fw + SF.mx * 2) / w) * 100}%` : "7%"}
              />
            );
          })()}
        {res && winners.length > 0 && (
          <WinBanner
            names={winners.filter(isTop).map((x) => table.seats[x]?.name ?? "?")}
            hand={res.names[winners.find(isTop) ?? winners[0]]}
            mine={winners.includes(mySeat) && isTop(mySeat)}
            shift={!!res.showdown && winners.includes(mySeat) && isTop(mySeat)}
            amt={winners.includes(mySeat) && isTop(mySeat) && hand?.players[mySeat] ? (res.won[mySeat] ?? 0) - hand.players[mySeat].invested : 0}
          />
        )}
        {info && !notice && (
          <div
            key={info.key}
            role="status"
            className="pk-toast"
            style={{ bottom: 190 }}
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
            style={{ bottom: 190 }}
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
        {/* 7포커 카드 고르기: 화면 가운데에 크게 */}
        {SF && sv && sv.phase === "choice" && !sv.result && me && liveHand && !liveHand.down && (
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2"
            // 판 가운데보다 살짝 아래, 무엇보다 위 (틀 · 위 바 · 컷인 위)
            style={{ left: w / 2, top: (SF.row1 + SF.me.y) / 2 + SF.gap + h * 0.05, zIndex: 60 }}
          >
            <SevenChoice
              key={table.handNo}
              myHand={liveHand}
              busy={busy}
              onAct={doAct}
              tier={table.tier}
              cw={Math.round(Math.min(SF.me.cardW * 1.1, (w - SF.fw * 2 - SF.mx * 2 - 40) / 4.4))}
            />
          </div>
        )}

        {/* 행동 바 */}
        <div
          className="pk-actwrap absolute"
          data-turn={myTurn ? "1" : undefined}
          // 버튼 · 글씨를 키움 (폰 가로 1.2배 · PC 1.1배 — 안의 크기가 전부 em 이라 같이 커짐)
          style={
            SF
              ? { left: SF.bar.x, top: SF.bar.y, width: SF.bar.w, height: SF.bar.h, zIndex: 30, fontSize: h <= 560 ? "1.2em" : "1.1em" }
              : { left: boardW * 0.5, right: 12, bottom: 10, zIndex: 30, fontSize: h <= 560 ? "1.2em" : "1.1em" }
          }
        >
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
            pre={pre}
            onPre={(a) => {
              if (pre === a) return setPre("");
              setPre(a);
            }}
          />
        </div>

      </div>

      {/* 7포커: 오른쪽 아래 족보 · 기록 상자 (기본 열림, 왼쪽 › 로 접음 · 접으면 ‹ 탭만) */}
      {SF &&
        (dockOpen ? (
          <>
            <InfoBox
              table={table}
              hand={hand}
              hv={hv}
              sv={sv}
              res={res}
              mySeat={mySeat}
              log={log}
              myCat={myCat}
              top={SF.info.y}
              box={SF.info}
              emoteChar={me ? (me.look ?? me.char) : undefined}
              onEmote={me ? emote : undefined}
              onLogBig={() => setLogBig(true)}
              onClose={() => setDockOpen(false)}
            />
            <button
              type="button"
              onClick={() => setDockOpen(false)}
              aria-label="족보 · 기록 접기"
              className="pk-dock-tab pk-dock-tab-in"
              style={{ left: SF.info.x + 1, top: SF.info.y + SF.info.h / 2, transform: "translate(-100%, -50%)" }}
            >
              ›
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setDockOpen(true)}
            aria-label="족보 · 기록 열기"
            className="pk-dock-tab"
            style={{ right: SF.mx, top: SF.info.y + SF.info.h / 2, transform: "translateY(-50%)" }}
          >
            ‹
          </button>
        ))}
      {/* 이모티콘: 내 정보 판 옆 말풍선 버튼 → 누르면 고르는 칸 (7포커는 내 틀 띠 안에) */}
      {me && !SF && (
        <div className="absolute" style={{ left: 12 + heroW + 6, bottom: 8, zIndex: 31 }}>
          <button
            type="button"
            onClick={() => setDrawer(drawer === "emote" ? "" : "emote")}
            className={`pk-btn pk-btn-ghost pk-emote-open flex h-[32px] w-[38px] items-center justify-center ${drawer === "emote" ? "pk-emote-open-on" : ""}`}
            aria-label="이모티콘"
            aria-expanded={drawer === "emote"}
          >
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 5h16v11H9l-5 4z" />
              <circle cx="9" cy="10.5" r="0.9" fill="currentColor" />
              <circle cx="12" cy="10.5" r="0.9" fill="currentColor" />
              <circle cx="15" cy="10.5" r="0.9" fill="currentColor" />
            </svg>
          </button>
          {/* 이모티콘 · 족보 · 시작패 · 기록 탭 상자 */}
          {drawer === "emote" && (
            <div className="pk-pop absolute left-0 w-[23em]" style={{ bottom: "calc(100% + 6px)" }}>
              <InfoBox
                table={table}
                hand={hand}
                hv={hv}
                sv={sv}
                res={res}
                mySeat={mySeat}
                log={log}
                myCat={myCat}
                top={0}
                inlineH={Math.round(Math.min(h * 0.6, 330))}
                emoteChar={me.look ?? me.char}
                onEmote={emote}
                startRow={liveHand && hv ? startRow(liveHand.cards) : -1}
                onLogBig={() => setLogBig(true)}
                onClose={() => setDrawer("")}
              />
            </div>
          )}
        </div>
      )}
      {/* 기록 크게 보기 */}
      {logBig && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/70"
          style={{ zIndex: 60 }}
          onClick={() => setLogBig(false)}
        >
          <div
            className="pk-frame flex max-h-[82%] w-[min(40em,86%)] flex-col overflow-hidden"
            style={{ height: "82%", background: "#12131b" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-[0.9em] py-[0.55em]">
              <span className="pk-side-title !m-0 !text-[1em]">
                기록
              </span>
              <button
                type="button"
                onClick={() => setLogBig(false)}
                aria-label="닫기"
                className="cursor-pointer rounded-[6px] px-[0.5em] text-[1.2em] leading-none text-white/60 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>
            <LogList lines={log} big />
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
        {hand && (
          <span className="pk-num shrink-0 text-[0.72em] font-bold text-[#ffd84a]">{table.handNo}판</span>
        )}
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
                  <Money won={stackShown(statSeat, s.stack)} className="text-[1.15em] text-[#ffd84a]" />
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
/**
 * 7포커 틀 배치 (그림 기준): 왼쪽 · 오른쪽에 남의 틀 두 줄, 왼쪽 아래 내 큰 틀, 오른쪽 아래 족보 · 기록 상자와 베팅 버튼 줄.
 * 틀 = [캐릭터 칸][카드 칸] + 아래 이름 · 칩 띠. 캐릭터 칸은 앉은 정면 그림(3:4)이 꽉 차게, 카드 칸은 바로 옆에 딱 붙게.
 * 길이는 전부 무대 높이(위 바 뺀)에 비례 → 무대가 커지든 작아지든(폰) 같은 비율로 보임. 넓은 화면은 가운데(판)만 넓어짐.
 */
function sevenFrames(w: number, h: number, bar: number, stripH: number) {
  const hp = h - bar;
  const gap = Math.round(hp * 0.014);
  const gRow = Math.round(hp * 0.034);
  const mx = Math.round(Math.max(6, hp * 0.012));
  const F = Math.round(hp * 0.27);
  const cell = F - stripH;
  const charW = Math.round(cell * 0.75);
  const cardW = Math.round((cell * 0.9) / 1.4);
  const areaW = Math.round(cardW * 3.05);
  const fw = charW + areaW;
  const row1 = bar + gap;
  const row2 = row1 + F + gRow;
  const mTop = row2 + F + gRow;
  const mh = h - gap - mTop;
  const mStrip = Math.round(stripH * 1.15);
  const mCell = mh - mStrip;
  const mCharW = Math.round(mCell * 0.75);
  const mCardW = Math.round((mCell * 0.78) / 1.4);
  const mAreaW = Math.round(mCardW * 3.1);
  const mw = mCharW + mAreaW;
  /** 베팅 버튼 줄: 내 틀 오른쪽 아래 끝까지 */
  const barH = Math.round(mh * 0.34);
  const barX = mx + mw + gap;
  return {
    gap,
    mx,
    F,
    cell,
    charW,
    cardW,
    areaW,
    fw,
    strip: stripH,
    row1,
    row2,
    me: { x: mx, y: mTop, w: mw, h: mh, cell: mCell, charW: mCharW, cardW: mCardW, areaW: mAreaW, strip: mStrip },
    bar: { x: barX, y: h - gap - barH, w: w - mx - barX, h: barH },
    info: { x: w - mx - fw, y: mTop, w: fw, h: h - gap - barH - gap - mTop },
    /** 판 가운데 칸 (남의 틀 사이) */
    center: { x: w / 2, top: bar, bottom: mTop },
  };
}

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

function ActTag({ a, over }: { a: string; over?: boolean }) {
  return (
    <span
      className="absolute left-1/2 z-20 -translate-x-1/2"
      style={{ bottom: over ? "calc(100% - 0.5em)" : "calc(100% + 4px)" }}
    >
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
function EmoteBubble({ tail, children }: { tail: "l" | "r" | "b"; children: ReactNode }) {
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
  pileOn,
  myToCall = 0,
}: {
  hand: HoldemView | SevenView | null;
  table: TableWire;
  base: number;
  sizes: Sizes;
  res: HoldemView["result"];
  settled: boolean;
  /** 판 위에 흩어진 칩 더미가 있음 (그러면 POT 옆 칩 더미 그림은 안 그림) */
  pileOn?: boolean;
  /** 7포커: 내가 지금 맞춰야 할 돈 (이번 구 정보 줄에) */
  myToCall?: number;
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
  // 7포커는 던진 칩이 바로 팟 더미로 가니 이번 구에 건 돈까지 팟에 다 셈
  const collected = res || hand.game === "seven" ? hand.pot : hand.pot - street;
  const shown = res || collected > 0 ? collected : hand.pot;
  const seven = hand.game === "seven";
  return (
    <>
      {/* 7포커: POT 자리는 고정 — 몇 구 글자는 위, 이번 구 정보는 아래에 따로 붙어서 생겼다 사라져도 POT 가 안 움직임 */}
      {seven ? (
        <span className="absolute bottom-[calc(100%+0.3em)] left-1/2 -translate-x-1/2">
          <SevenStage view={hand} />
        </span>
      ) : (
        <HoldemStage view={hand} />
      )}
      {/* 팟: 크게 · 금액이 바뀌면 살짝 튐 */}
      <div className="flex items-end gap-[0.35em]">
        {/* 진짜 칩 더미: 건 돈이 모일 때마다 쌓이고, 승자에게 날아가면 사라짐 */}
        {!(res && settled) && !pileOn && (
          <PotPile
            amount={collected > 0 || res ? shown : 0}
            base={base}
            size={Math.max(20, sizes.u * (hand.game === "seven" ? 3.2 : 4.4))}
          />
        )}
        <div key={shown} className="pk-pot">
          <PotChips ratio={shown / base} size={Math.max(20, sizes.u * (hand.game === "seven" ? 3.2 : 4))} />
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
      {/* 7포커 이번 구 정보: 내가 낼 콜 · 이번 구 최고 베팅 · 남은 사람 */}
      {seven && !res && (
        <div className="pk-roundinfo absolute top-[calc(100%+0.45em)] left-1/2 w-max -translate-x-1/2">
          {myToCall > 0 && (
            <span className="pk-ri pk-ri-call">
              콜 <Money won={myToCall} />
            </span>
          )}
          {hand.currentBet > 0 && (
            <span className="pk-ri">
              최고 <Money won={hand.currentBet} />
            </span>
          )}
          <span className="pk-ri">
            {Object.values(hand.players).filter((p) => !p.folded).length}/{Object.keys(hand.players).length}명
          </span>
        </div>
      )}
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
  /** 아바타 크기 (7포커: 앉은 캐릭터 그림 3:4 · 홀덤: 얼굴 아이콘) */
  avW: number;
  avH: number;
  /** 아바타 + 정보 띠 틀의 폭 */
  frameW: number;
  isButton: boolean;
  blind: string | null;
  onStats: () => void;
  madeKey: string;
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
    avW,
    avH,
    frameW,
    isButton,
    blind,
    onStats,
    madeKey,
    settled,
    collected,
    myRevealed,
    dealDelay,
  } = props;
  const seven = !!sv || (!hv && avH !== avW);
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
  const look = me.look ?? me.char;
  const net = res && p ? won - p.invested : null;
  return (
    <>
      {/* 왼쪽 아래: 내 아바타(크게 — 7포커 앉은 그림 · 홀덤 얼굴) 과 그 아래 내 정보 띠 */}
      <div
        className="absolute flex flex-col items-center"
        style={{ left: 12, bottom: 8, width: frameW, zIndex: 36, fontSize: "1.12em" }}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={onStats}
          onKeyDown={(e) => e.key === "Enter" && onStats()}
          className={`pk-av relative cursor-pointer ${won > 0 ? "pk-seat-win" : waiting ? "pk-seat-turn" : ""}`}
          data-turn={waiting ? "1" : undefined}
          style={{ width: avW, height: avH, opacity: dim ? 0.6 : 1 }}
        >
          {seven ? (
            <CharSprite char={look} pose={pose} seat="front" w={avW} dim={dim} />
          ) : (
            <FaceIcon char={look} face={face} size={avW} />
          )}
          {waiting && deadline > 0 && <TimerRing size={avW} frac={frac} width={3} square={seven} />}
          {/* 이번 판 총 베팅: 얼굴 오른쪽 위 (바로 위는 옆자리 이름표와 닿아서) */}
          {p && p.invested > 0 && !res && (
            <span className="pk-face-bet pk-face-bet-me pk-num">
              <Money won={p.invested} />
            </span>
          )}
          {(isButton || blind) && (
            // 남의 얼굴 아이콘 배지와 같은 비율로 (내 얼굴이 크니 배지도 크게)
            <span className="pk-badge" style={{ fontSize: Math.round(avH * 0.13) }}>
              {isButton ? "D" : blind}
            </span>
          )}
          {gain && (
            <Rise
              key={gain.key}
              className="absolute -top-[0.6em] left-1/2 -translate-x-1/2 text-[1.1em] text-[var(--pk-brass)]"
            >
              +{fmtShort(gain.amt)}
            </Rise>
          )}
          {/* 내 이모티콘: 머리 바로 위, 꼬리는 아래 */}
          {emote && (
            <div
              key={emote.key}
              className="pk-emote pointer-events-none absolute left-1/2 w-max"
              // 움직임(transform)과 겹치지 않게 가운데 맞춤은 translate 로
              style={{ bottom: "calc(100% + 12px)", translate: "-50% 0", zIndex: 45 }}
            >
              <EmoteBubble tail="b">
                <EmoteImg char={look} emote={emote.v} size={Math.round(Math.max(56, Math.min(96, avH * 0.55)))} />
              </EmoteBubble>
            </div>
          )}
        </div>
        {/* 내 정보 판: 이름 · 캐릭터 / 보유 칩 / 이번 판 베팅 · 상태 */}
        <div
          role="button"
          tabIndex={0}
          onClick={onStats}
          onKeyDown={(e) => e.key === "Enter" && onStats()}
          className="pk-hero-hud pk-hero-hud2 cursor-pointer"
          data-turn={waiting ? "1" : undefined}
          style={{ width: frameW }}
        >
          {me.exit && (
            // 얼굴 오른쪽 아래 D · SB 배지와 안 겹치게 왼쪽 위에
            <span className="pk-exit-mark absolute -top-[1.1em] left-[0.4em] z-20">나가기 예약</span>
          )}
          {/* 이름만 (스킨 이름은 자리를 먹어 이름이 잘려서 뺌) */}
          <div className="truncate text-[0.9em] font-extrabold text-white">{me.name}</div>
          <div className="flex items-center gap-[0.3em]">
            {}
            <img src={asset.chip("gold", "top")} alt="" className="h-[1em] w-[1em]" />
            <span className="pk-num text-[1.15em] leading-none text-[#ffd84a]">
              {p?.allIn && !res ? <span className="text-[var(--pk-danger)]">ALL IN</span> : <Money won={me.stack} />}
            </span>
          </div>
          <div className="mt-[0.15em] flex items-center gap-[0.5em] border-t border-white/10 pt-[0.2em] text-[0.7em]">
            <span className="whitespace-nowrap text-white/50">
              베팅 <Money won={p ? p.invested : 0} className="text-[1.15em] text-white" />
            </span>
            <span className={`ml-auto font-bold whitespace-nowrap ${waiting ? "text-[#ffd84a]" : net !== null && net < 0 ? "text-[#ff7d86]" : "text-white/55"}`}>
              {me.status === "out" && !live
                ? "자리 비움"
                : waiting
                  ? "내 차례"
                  : res && net !== null && net !== 0
                    ? `${net > 0 ? "+" : "−"}${fmtShort(Math.abs(net))}`
                    : p?.folded
                      ? "폴드"
                      : p
                        ? "진행 중"
                        : "대기 중"}
            </span>
          </div>
          {waiting && deadline > 0 && <PlateTimer frac={frac} />}
        </div>
      </div>
      {/* 내 카드 · 족보 · 건 돈 (테이블 앞쪽) */}
      <div
        className="absolute flex flex-col items-center gap-[0.4em]"
        style={{
          left: (L.heroX / 100) * boardW,
          top: (L.heroCards / 100) * h,
          transform: "translateX(-50%)",
          // 다른 자리 카드 · 날아가는 칩/카드(12~13)보다 위 — 내 족보 글자가 가려지지 않게
          zIndex: 20,
        }}
      >
        {bet > 0 && (
          <Bet won={bet} ratio={bet / base} size={Math.max(22, sizes.u * 3.4)} act={p?.last?.a} className="relative z-10 -mt-[1.2em]" />
        )}
        <div className="relative flex items-end">
          {madeKey && !res && <span key={`burst-${madeKey}`} className="pk-made-burst" aria-hidden />}
          {cards}
        </div>
        {/* 족보 · 행동 · 결과 글자는 카드보다 위에 (카드가 커지거나 떠오를 때 가리지 않게) */}
        <div className="relative z-20 flex flex-col items-center gap-[0.4em]">
          {hint && !res && !myName && (
            <span className={`pk-handtag pk-pop ${madeKey ? "pk-made" : ""}`}>
              <span className="pk-tag-t">{hint}</span>
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
              className={`pk-resulttag pk-stamp ${res && won > 0 && (topHands(hv ?? sv)?.has(me.seat) ?? true) ? "pk-resulttag-win" : ""}`}
            >
              <span className="pk-tag-t">{myName}</span>
            </span>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * 승자 컷인 (쇼다운 끝): 내가 이기면 내 전신(hero-win)이 왼쪽 아래에서 크게 올라와 WIN 글자와 같이 머물다 같이 사라짐,
 * 남이 이기면 그 캐릭터 전신이 그 사람 쪽에서 작게 튀어나와 3초쯤 기뻐함 (WINNER 글자보다 앞에).
 */
function WinCutIn({
  look,
  mine,
  side,
  h,
  bottom,
  inset,
}: {
  look: Look;
  mine: boolean;
  side: "l" | "r";
  h: number;
  /** 아래 끝 (7포커는 내 틀 위에서 남 컷인이 올라오게) */
  bottom: number;
  /** 남 컷인이 화면 가장자리에서 얼마나 안쪽에 서는지 */
  inset: string;
}) {
  const ch = Math.round(mine ? h * 0.92 : Math.min(h * 0.56, h - bottom - 46));
  return (
    <div
      className={`pk-cutwin pointer-events-none absolute ${mine ? "pk-cutwin-me" : "pk-cutwin-other"}`}
      data-side={side}
      style={{ [side === "l" ? "left" : "right"]: mine ? "4%" : inset, bottom: mine ? 0 : bottom, height: ch, zIndex: mine ? 41 : 43 }}
    >
      <span className="pk-cutwin-glow" aria-hidden />
      {}
      <img
        // 남 승자도 전신(발까지) 그림 — pose 그림은 무릎에서 잘린 캐릭터가 있음
        src={asset.hero(look, "win")}
        alt=""
        draggable={false}
        className="relative h-full w-auto max-w-none"
        style={{ transform: side === "r" ? "scaleX(-1)" : undefined }}
      />
    </div>
  );
}

function WinBanner({
  names,
  hand,
  mine,
  top,
  amt = 0,
  shift,
}: {
  names: string[];
  hand?: string;
  mine: boolean;
  top?: number;
  /** 내 전신 컷인이 왼쪽에 설 때만 글자를 오른쪽으로 비킴 (다 죽어서 이긴 판은 컷인이 없으니 가운데 그대로) */
  shift?: boolean;
  /** 내가 이겼을 때 이번 판에 딴 돈(넣은 돈 뺀) */
  amt?: number;
}) {
  return (
    <>
      <div
        className="pk-flash pointer-events-none absolute inset-0"
        style={{ zIndex: 29 }}
        aria-hidden
      />
      <div
        className="pk-banner pointer-events-none absolute flex flex-col items-center py-[0.35em]"
        style={{
          // 팟 자리에 (위쪽 자리 카드 · 꼬리표를 덮지 않게 가운데 폭만)
          top: top ?? "27%",
          // 내 승리는 왼쪽에 내 전신이 크게 서니 글자는 오른쪽으로 비켜서
          left: shift ? "40%" : "30%",
          right: shift ? "14%" : "30%",
          zIndex: 42,
          background:
            "linear-gradient(90deg, transparent, rgba(0,0,0,0.8) 18%, rgba(0,0,0,0.8) 82%, transparent)",
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
        {mine && amt > 0 ? (
          <div className="pk-winamt pk-num">+{fmtShort(amt)}</div>
        ) : (
          <div className="mt-[0.15em] text-[0.85em] font-bold text-white">{names.join(" · ")}</div>
        )}
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
  pre: string;
  onPre: (a: string) => void;
}) {
  const {
    revealing,
    o,
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
    busy,
    doAct,
    table,
    actor,
    myTurn,
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
  // 7포커: 베팅 버튼 줄은 절대 안 사라짐 — 같은 다섯 칸이 켜지고 잠기기만 (한게임식)
  if (table.game === "seven")
    return (
      <SevenBar view={sv} mySeat={mySeat} myStack={me.stack} busy={busy} myTurn={myTurn} onAct={doAct} pre={pre} onPre={onPre} />
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
      {/* 남의 차례: 그 사람 아바타가 빛나고 시간 고리가 도니 따로 안 알림 (자리만 먹어서) */}
      {actor && me.status !== "out" && me.status !== "wait" && !hv?.result && !sv?.result ? null : (
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
  // 홀덤 족보표에도 흔히 따로 적는 맨 위 (A 하이 스트레이트 플러시). 백스티플 · 마운틴 같은 구분은 홀덤엔 없음
  ["로티플", ex("As Ks Qs Js Ts")],
];
/** 홀덤 점수 → 족보표 줄 번호 (스트레이트 플러시 중 A 하이 = 로티플은 따로 한 줄) */
const holdemRankIdx = (score: number) => {
  const cat = categoryOf(score);
  return cat === 8 && Math.floor(score / 65536) % 16 === 12 ? 9 : cat;
};
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

/** 홀덤 시작패(첫 두 장) 표: 센 것부터 */
const HOLDEM_START: [string, number[]][] = [
  ["A 포켓 페어", ex("As Ah")],
  ["K 포켓 페어", ex("Ks Kh")],
  ["Q 포켓 페어", ex("Qs Qh")],
  ["A·K 수딧", ex("As Ks")],
  ["J 포켓 페어", ex("Js Jh")],
  ["A·Q 수딧 · A·K", ex("As Qs")],
  ["10 페어 · A·J 수딧 · K·Q 수딧", ex("Ts Th")],
  ["9~7 페어 · A·Q · A·10 수딧", ex("9s 9h")],
  ["6~2 페어 · A 수딧 · K·Q", ex("6s 6h")],
  ["수딧 커넥터 (J·10 ~ 5·4)", ex("Js Ts")],
  ["그 밖", ex("9s 4h")],
];
/** 내 첫 두 장 → 시작패 표 줄 번호 */
function startRow(cards: readonly number[]): number {
  if (cards.length < 2) return -1;
  const a = Math.floor(cards[0] / 4);
  const b = Math.floor(cards[1] / 4);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const suited = cards[0] % 4 === cards[1] % 4;
  if (a === b) return hi === 12 ? 0 : hi === 11 ? 1 : hi === 10 ? 2 : hi === 9 ? 4 : hi === 8 ? 6 : hi >= 5 ? 7 : 8;
  if (hi === 12 && lo === 11) return suited ? 3 : 5;
  if (hi === 12 && lo === 10) return suited ? 5 : 7;
  if (hi === 12 && lo === 9 && suited) return 6;
  if (hi === 11 && lo === 10) return suited ? 6 : 8;
  if (hi === 12 && lo === 8 && suited) return 7;
  if (hi === 12 && suited) return 8;
  if (suited && hi - lo === 1 && hi <= 9 && lo >= 2) return 9;
  return 10;
}

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
/** 오른쪽 위 작은 상자: 족보 ↔ 기록 탭, 접으면 한 줄 */
function InfoBox({
  table,
  hand,
  hv,
  sv,
  res,
  mySeat,
  log,
  myCat,
  top,
  onLogBig,
  onClose,
  box,
  emoteChar,
  onEmote,
  inlineH,
  startRow: myStart = -1,
}: {
  table: TableWire;
  hand: HoldemView | SevenView | null;
  hv: HoldemView | null;
  sv: SevenView | null;
  res: HoldemView["result"];
  mySeat: number;
  log: LogLine[];
  myCat: number;
  top: number;
  onLogBig: () => void;
  onClose: () => void;
  /** 붙박이 자리 (7포커 오른쪽 아래) — 없으면 위 바 아래 오른쪽에 뜨는 상자 */
  box?: { x: number; y: number; w: number; h: number };
  /** 있으면 「이모티콘」 탭 (7포커 붙박이 상자 · 홀덤 이모티콘 버튼 상자) */
  emoteChar?: Look;
  onEmote?: (e: Emote) => void;
  /** 홀덤 버튼 상자: 제자리(버튼 위)에 이 높이로 — 「시작패」 탭도 */
  inlineH?: number;
  /** 홀덤 내 첫 두 장이 시작패 표의 몇 번째 줄인지 */
  startRow?: number;
}) {
  // 이모티콘 탭이 있으면 이모티콘이 먼저
  const [tab, setTab] = useState<"rank" | "log" | "emote" | "start">(box || inlineH ? "emote" : "rank");
  const ranks = table.game === "holdem" ? HOLDEM_RANKS : SEVEN_RANKS;
  const steps = hv ? ["프리플랍", "플랍", "턴", "리버"] : ["고르기", "4구", "5구", "6구", "7구"];
  const at = !hand ? -1 : hv ? hv.street : sv!.phase === "choice" ? 0 : Math.max(1, sv!.round - 3);
  const alive = hand ? Object.values(hand.players).filter((p) => !p.folded).length : 0;
  const sitting = table.seats.filter((s) => s && s.status !== "out").length;
  void res;
  void mySeat;
  return (
    <div
      className={`pk-infobox pk-frame flex flex-col overflow-hidden ${inlineH ? "relative" : "absolute right-[8px]"}`}
      style={
        inlineH
          ? { width: "100%", maxHeight: inlineH, background: "#12131b" }
          : box
            ? { left: box.x, top: box.y, width: box.w, height: box.h, maxHeight: "none", zIndex: 25 }
            : { top, zIndex: 45 }
      }
    >
      <div className="flex items-center gap-[0.35em] px-[0.5em] py-[0.3em]">
        {/* 붙박이 상자는 탭만 꽉 차게 (몇 판 · 몇 구는 위 바 · 판 가운데에 있음) */}
        {!box && !inlineH && (
          <>
            <span className="pk-num text-[0.78em] font-bold text-[#ffd84a]">{hand ? `${table.handNo}판` : "판 사이"}</span>
            <span className="text-[0.7em] text-white/55">
              {hand && at >= 0 ? steps[at] : ""}
              {hand ? ` · ${alive}/${sitting}명` : `${sitting}명`}
            </span>
          </>
        )}
        <div role="tablist" className={`pk-seg ${box || inlineH ? "pk-seg-dock flex-1" : "pk-seg-sm ml-auto"}`}>
          {inlineH && emoteChar && onEmote && (
            <button role="tab" type="button" aria-selected={tab === "emote"} onClick={() => setTab("emote")}>
              이모티콘
            </button>
          )}
          <button role="tab" type="button" aria-selected={tab === "rank"} onClick={() => setTab("rank")}>
            족보
          </button>
          {inlineH && table.game === "holdem" && (
            <button role="tab" type="button" aria-selected={tab === "start"} onClick={() => setTab("start")}>
              시작패
            </button>
          )}
          <button role="tab" type="button" aria-selected={tab === "log"} onClick={() => setTab("log")}>
            기록
          </button>
          {!inlineH && emoteChar && onEmote && (
            <button role="tab" type="button" aria-selected={tab === "emote"} onClick={() => setTab("emote")}>
              이모티콘
            </button>
          )}
        </div>
        {!box && !inlineH && <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="cursor-pointer rounded-[4px] px-[0.3em] text-[0.95em] leading-none text-white/55 hover:bg-white/10 hover:text-white"
        >
          ✕
        </button>}
      </div>
      {(tab === "rank" || (tab === "emote" && !(emoteChar && onEmote))) && (
        <ol className="pk-ranks pk-ranks-dense pk-scroll min-h-0 overflow-y-auto">
          {ranks
            .map((r, cat) => [r, cat] as const)
            .reverse()
            .map(([[name, cards], cat], i) => {
              const mine = cat === myCat;
              return (
                <li key={name} data-mine={mine ? "1" : undefined}>
                  <span className="pk-num w-[1.1em] shrink-0 text-center text-[0.8em] text-white/35">{ranks.length - i}</span>
                  <span className={`min-w-0 flex-1 truncate text-[0.82em] ${mine ? "font-bold" : "font-normal"}`}>{name}</span>
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
      )}
      {tab === "start" && (
        <ol className="pk-ranks pk-ranks-dense pk-scroll min-h-0 overflow-y-auto">
          {HOLDEM_START.map(([name, cards], i) => {
            const mine = i === myStart;
            return (
              <li key={name} data-mine={mine ? "1" : undefined}>
                <span className="pk-num w-[1.1em] shrink-0 text-center text-[0.8em] text-white/35">{i + 1}</span>
                <span className={`min-w-0 flex-1 truncate text-[0.82em] ${mine ? "font-bold" : "font-normal"}`}>{name}</span>
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
      )}
      {tab === "emote" && emoteChar && onEmote && (
        <div className={box ? "flex min-h-0 flex-1" : "pk-scroll min-h-0 overflow-y-auto"}>
          <EmoteGrid char={emoteChar} onPick={onEmote} dense={!!box} />
        </div>
      )}
      {tab === "log" && (
        <div className="relative flex min-h-0 flex-col">
          <button
            type="button"
            onClick={onLogBig}
            aria-label="기록 크게 보기"
            title="크게 보기"
            className="absolute top-[0.2em] right-[0.3em] z-10 cursor-pointer rounded-[4px] p-[0.15em] text-white/55 hover:bg-white/10 hover:text-white"
          >
            <svg viewBox="0 0 16 16" className="h-[1em] w-[1em]" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <LogList lines={log} />
        </div>
      )}
    </div>
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
  dense,
}: {
  char: Look;
  onPick: (e: Emote) => void;
  big?: boolean;
  /** 붙박이 상자 안: 정사각형 칸 한 줄 · 좌우로 밀어 고름 */
  dense?: boolean;
}) {
  return (
    <div
      // 붙박이 상자: 정사각형 칸을 한 줄로 늘어놓고 좌우로 밀어서 고름 (폰에서 칸이 세로로 길쭉해지지 않게)
      className={
        dense
          ? "pk-emote-row pk-scroll border-t border-[rgba(214,175,92,0.2)]"
          : `grid grid-cols-4 gap-[0.3em] border-t border-[rgba(214,175,92,0.2)] p-[0.45em] ${big ? "gap-[0.5em] p-[0.8em]" : ""}`
      }
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
          <EmoteImg char={char} emote={e} size={big ? 72 : 48} className={dense ? "h-full w-full object-contain" : "mx-auto h-auto w-full"} />
          {/* 가리키면(폰은 누르는 동안) 이름이 떠오름 */}
          <span className="pk-emote-name" aria-hidden>
            {EMOTE_NAME[e]}
          </span>
        </button>
      ))}
    </div>
  );
}

function LogList({ lines, big }: { lines: LogLine[]; big?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <div
      ref={ref}
      className={`pk-scroll flex-1 overflow-y-auto px-[0.7em] pb-[0.5em] leading-relaxed ${big ? "min-h-0 py-[0.5em] text-[0.95em]" : "min-h-[7.5em] text-[0.78em]"}`}
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
