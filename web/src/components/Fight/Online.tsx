"use client";

/**
 * 온라인 대전 화면 (16:9 판 안): 로비(방 목록·방 만들기) → 대기실(캐릭터·준비·맵·채팅) → 둘 다 준비되면 경기.
 * 랭크전: 로비의 「⚔ 랭크전」 → 매칭 중 → 수락/거절 → 전용 대기실(맵 랜덤·캐릭터만 고름) → 한 판 → 레이팅 변화.
 *   12초 안에 사람을 못 찾으면 비슷한 레이팅의 AI와 매칭 → 캐릭터 고르기 → 이 브라우저에서 한 판 → 서버가 입력 기록으로 확인 → 레이팅.
 * 방 연결(RoomSession)은 FightGame이 들고 있어서, 경기 화면에 갔다 와도 대기실 자리가 그대로.
 */
import { useEffect, useReducer, useRef, useState } from "react";
import { CHARS, type CharDef } from "@/lib/fight/chars";
import { MAPS } from "@/lib/fight/maps";
import { BUILD_ID } from "@/lib/fight/sim";
import { AI_ID } from "@/lib/fight/ai";
import { rankTierOf } from "@/lib/fight/tiers";
import { getFightMe, type FightMe } from "@/firestore/fightRating";
import { TierEmblem } from "./TierBadge";
import { useAuth } from "@/lib/AuthContext";
import { loadSheet } from "@/lib/fight/sprites";
import { sfxUi } from "@/lib/fight/sfx";
import { keyText } from "./KeyCap";
import { useChessUser } from "@/components/Chess/useChessUser";
import Nick from "@/components/Nick";
import {
  cleanupEmptyRoom,
  createRoom,
  rankBotForfeit,
  rankBotStart,
  rankCancel,
  rankQueue,
  rankRespond,
  subscribeRank,
  type RankStatus,
  RoomFullError,
  RoomSession,
  serverNow,
  subscribeLobby,
  watchServerOffset,
  WatchSession,
  type LobbyRoom,
} from "@/realtime/fight";

const KR = "font-['Nanum_Gothic',sans-serif]";
const PX = "[image-rendering:pixelated]";
const MENU_BG = "/fight/bg/title.webp";
const face = (c: CharDef) => `/fight/art/${c.id}-face.webp`;
const art = (c: CharDef) => `/fight/art/${c.id}.webp`;
const SEAT_COL = ["#3B82F6", "#F43F5E"];
const pill = `${KR} cursor-pointer rounded-full bg-black/50 px-[1.4cqw] py-[0.5cqw] text-[1.2cqw] text-white/75 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40`;
const field = `${KR} min-w-0 rounded-[0.6cqw] border border-white/15 bg-black/55 px-[1cqw] py-[0.6cqw] text-[1.3cqw] text-white placeholder:text-white/30 focus:border-[#FDE047]/60 focus:outline-none`;
const bigBtn = `${KR} cursor-pointer whitespace-nowrap rounded-full bg-[#E8344E] px-[2.6cqw] py-[0.7cqw] text-[1.5cqw] font-extrabold text-white shadow-[0_0.3cqw_0_#7A1020] transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100`;
/** 랭크전 버튼 (노랑) · 수락 버튼 (초록) — bigBtn 과 색만 다름 */
const rankBtn = `${KR} cursor-pointer rounded-full border-[0.2cqw] border-[#FDE047]/80 bg-black/40 px-[2.6cqw] py-[0.6cqw] text-[1.4cqw] font-bold whitespace-nowrap text-[#FDE047] transition-colors hover:bg-[#FDE047] hover:text-black disabled:cursor-not-allowed disabled:border-white/30 disabled:text-white/40 disabled:hover:bg-black/40`;
const okBtn = bigBtn.replace("bg-[#E8344E]", "bg-[#22C55E]").replace("#7A1020", "#14532D");

export interface MatchCfg {
  match: string;
  seat: 0 | 1;
  chars: [number, number];
  map: number;
  delay: number;
  maxRb: number;
  names: [string, string];
  /** 관전 (seat는 안 씀) */
  spectate?: boolean;
  /** 관전하는 방 id */
  room?: string;
}

/** 랭크전 AI전 설정 (나 = 1P, AI = 2P) */
export interface BotCfg {
  id: string;
  chars: [number, number];
  map: number;
  seed: number;
  botR: number;
  names: [string, string];
}

export default function Online({
  session,
  setSession,
  initialRoom,
  played,
  onMatch,
  onBotMatch,
  onExit,
  watch,
  setWatch,
}: {
  session: RoomSession | null;
  /** 관전 중인 방 */
  watch: WatchSession | null;
  setWatch: (w: WatchSession | null) => void;
  /** 초대 링크로 들어온 방 */
  initialRoom?: string | null;
  setSession: (s: RoomSession | null) => void;
  /** 이미 치른 매치 id (대기실로 돌아왔을 때 같은 판으로 다시 들어가지 않게) */
  played: Set<string>;
  onMatch: (cfg: MatchCfg) => void;
  /** 랭크전 AI전 시작 */
  onBotMatch: (cfg: BotCfg) => void;
  onExit: () => void;
}) {
  const { uid, nick, setNick, nickLoaded, error } = useChessUser();
  const { profile } = useAuth();
  useEffect(() => watchServerOffset(), []);
  // 랭크전 매칭 상태 (서버가 알려 줌) — 매칭돼서 둘 다 수락하면 그 방으로
  const [rank, setRank] = useState<RankStatus>({ s: "idle" });
  const [rankErr, setRankErr] = useState("");
  useEffect(() => (uid ? subscribeRank(setRank) : undefined), [uid]);
  // AI전: 시작을 누르면 서버 상태가 바로 botplay 로 바뀜 → VS 화면이 끝나 경기로 넘어갈 때까지 같은 화면 유지
  // (렌더 중 ref 를 고치면 안 되니 state 로 — 이전 렌더 정보를 남기는 React 권장 방식)
  const [lastBot, setLastBot] = useState<Extract<RankStatus, { s: "bot" }> | null>(null);
  if (rank.s === "bot" && lastBot !== rank) setLastBot(rank);
  useEffect(() => {
    if (rank.s !== "room" || !uid || !nick) return;
    setWatch(null);
    setSession(new RoomSession(rank.room, uid, nick));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 방으로 넘어갔으니 매칭 화면은 닫음
    setRank({ s: "idle" });
  }, [rank, uid, nick, setSession, setWatch]);
  const startRank = () => {
    setRankErr("");
    sfxUi("ready");
    rankQueue(String(BUILD_ID), `${BUILD_ID}:${AI_ID}`, MAPS.length).catch((e) => setRankErr(e?.message || "랭크전에 들어가지 못했어요"));
  };
  // 초대 링크: 접속·닉네임이 준비되면 그 방으로
  const autoRef = useRef(false);
  useEffect(() => {
    if (!initialRoom || autoRef.current || session || !uid || !nick) return;
    autoRef.current = true;
    setSession(new RoomSession(initialRoom, uid, nick));
  }, [initialRoom, session, uid, nick, setSession]);

  const body = (() => {
    if (error) return <Center>{error}</Center>;
    if (!uid || !nickLoaded) return <Center>접속 중…</Center>;
    if (!nick) return <NickForm onSubmit={setNick} onBack={onExit} />;
    // 랭크전 AI전: 캐릭터 고르기 / 결과 / (새로고침 등으로 끊긴) 경기
    if (!session && (rank.s === "bot" || (rank.s === "botplay" && lastBot?.id === rank.id && !played.has(rank.id))))
      return <BotRoom key={rank.id} st={rank.s === "bot" ? rank : lastBot!} nick={nick} onMatch={onBotMatch} />;
    if (!session && rank.s === "botEnd") return <BotEnd st={rank} onAgain={startRank} onLobby={() => rankCancel()} />;
    if (!session && rank.s === "botplay") return <BotGone id={rank.id} />;
    if (session)
      return (
        <Room
          key={session.id}
          s={session}
          played={played}
          onMatch={onMatch}
          onLeave={() => setSession(null)}
          onRankAgain={() => (setSession(null), startRank())}
        />
      );
    if (watch) return <WatchRoom key={watch.id} w={watch} played={played} onMatch={onMatch} onLeave={() => setWatch(null)} />;
    return (
      <Lobby
        uid={uid}
        nick={nick}
        onNick={() => setNick("")}
        onBack={onExit}
        onEnter={(id) => setSession(new RoomSession(id, uid, nick))}
        onWatch={(id) => setWatch(new WatchSession(id, uid, nick))}
        member={!!profile}
        onRank={startRank}
        rankErr={rankErr}
      />
    );
  })();

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-[#0B0D14] select-none [container-type:inline-size]">
      <img src={MENU_BG} alt="" className={`absolute inset-0 h-full w-full object-cover opacity-35 ${PX}`} />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,#0B0D14_90%)]" />
      {body}
      {!session && (rank.s === "queue" || rank.s === "found") && <RankOverlay st={rank} />}
      {!session && rank.s === "idle" && rank.note && (
        <div className={`${KR} absolute inset-x-0 bottom-[1.6cqw] z-30 text-center text-[1.2cqw] text-[#FCA5A5]`}>{rank.note}</div>
      )}
    </div>
  );
}

// ───────────── 랭크전 매칭 ─────────────

/** 매칭 중 / 상대를 찾음(수락·거절) 화면 */
function RankOverlay({ st }: { st: Extract<RankStatus, { s: "queue" | "found" }> }) {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(t);
  }, []);
  // 찾았을 때 알림음 한 번
  const foundId = st.s === "found" ? st.id : "";
  useEffect(() => {
    if (foundId) sfxUi("ready");
  }, [foundId]);
  // 키보드: 매칭 중 Esc 취소 / 찾았을 때 J·Enter 수락, Esc 거절
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (st.s === "queue" && e.code === "Escape") rankCancel();
      else if (st.s === "found" && !st.accepted && (e.code === "KeyJ" || e.code === "Enter" || e.code === "Space")) rankRespond(st.id, true);
      else if (st.s === "found" && !st.accepted && e.code === "Escape") rankRespond(st.id, false);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [st]);
  const mmss = (ms: number) => {
    const t = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  };
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-[3px]">
      {st.s === "queue" ? (
        <div className="flex flex-col items-center gap-[1.4cqw]">
          <div className="relative h-[9cqw] w-[9cqw]">
            <div className="absolute inset-0 animate-spin rounded-full border-[0.5cqw] border-white/10 border-t-[#FDE047]" />
            <div className="absolute inset-0 flex items-center justify-center text-[3.6cqw]">⚔</div>
          </div>
          <div className="font-mono text-[2.6cqw] font-black tracking-[0.3em] text-white italic">MATCHING</div>
          <div className={`${KR} text-[1.6cqw] font-bold text-white`}>매칭 중입니다…</div>
          <div className="font-mono text-[1.6cqw] text-[#FDE047] tabular-nums">{mmss(now - st.since)}</div>
          <div className={`${KR} text-[1.1cqw] text-white/45`}>12초 이내 매칭이 잡히지 않을 시 비슷한 실력대의 AI와 매칭이 됩니다</div>
          {st.note && <div className={`${KR} text-[1.2cqw] text-[#FCA5A5]`}>{st.note}</div>}
          <button type="button" onClick={() => (sfxUi("back"), rankCancel())} className={pill}>
            취소 (Esc)
          </button>
        </div>
      ) : (
        <div className="flex w-[44cqw] flex-col items-center gap-[1.2cqw] rounded-[1.2cqw] border-[0.2cqw] border-[#FDE047]/60 bg-[#14101F]/95 px-[3cqw] py-[2.4cqw] shadow-[0_0_4cqw_rgba(253,224,71,0.25)] [animation:modal-fade_250ms_ease-out]">
          <div className="font-mono text-[2.4cqw] font-black tracking-[0.25em] text-[#FDE047] italic">MATCH FOUND</div>
          <div className={`${KR} text-[1.4cqw] text-white/70`}>상대를 찾았어요!</div>
          <div className="flex items-center gap-[2cqw]">
            <div className="flex flex-col items-center">
              <div className={`${KR} text-[1.2cqw] text-white/50`}>나</div>
              <div className="font-mono text-[2cqw] font-black text-white tabular-nums">{st.me.r}</div>
            </div>
            <div className="font-mono text-[3cqw] font-black text-[#FDE047] italic">VS</div>
            <div className="flex flex-col items-center">
              <div className={`${KR} max-w-[16cqw] truncate text-[1.5cqw] font-bold text-white`}>
                <Nick name={st.opp.nick} />
              </div>
              <div className="font-mono text-[2cqw] font-black text-white tabular-nums">
                {st.opp.r}
                {st.opp.n < 10 && <span className={`${KR} ml-[0.5cqw] text-[1cqw] font-normal text-white/45`}>배치 {st.opp.n}/10</span>}
              </div>
            </div>
          </div>
          <div className="h-[0.5cqw] w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-[#FDE047] transition-[width] duration-200"
              style={{ width: `${Math.max(0, Math.min(100, ((st.deadline - now) / 15_000) * 100))}%` }}
            />
          </div>
          {st.accepted ? (
            <div className={`${KR} text-[1.4cqw] text-[#4ADE80]`}>수락했어요 — 상대를 기다리는 중…</div>
          ) : (
            <div className="flex gap-[1.2cqw]">
              <button type="button" onClick={() => (sfxUi("ready"), rankRespond(st.id, true))} className={`${okBtn} min-w-[12cqw]`}>
                수락 (J)
              </button>
              <button type="button" onClick={() => (sfxUi("back"), rankRespond(st.id, false))} className={`${pill} min-w-[10cqw]`}>
                거절 (Esc)
              </button>
            </div>
          )}
          <div className={`${KR} text-[1.05cqw] text-white/40`}>맵은 랜덤 · 캐릭터는 다음 화면에서 골라요 · {mmss(st.deadline - now)} 안에</div>
        </div>
      )}
    </div>
  );
}

// ───────────── 랭크전 AI전 ─────────────

/** AI와 매칭됨: 내 캐릭터 고르기 → 준비하면 AI 캐릭터 공개(VS) → 경기 */
/** 랜덤 고르기 연출: 얼굴 칸을 슬롯머신처럼 돌다 하나에 멈춤 (선택 화면과 같은 박자) — cur = 지금 돌고 있는 칸 */
function useCharShuffle() {
  const [cur, setCur] = useState<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const run = (done: (pick: number) => void) => {
    if (cur !== null) return;
    const n = CHARS.length;
    const pick = Math.floor(Math.random() * n);
    const start = Math.floor(Math.random() * n);
    const count = 14 + ((pick - start - 14 + n * 4) % n) + 1;
    let t = 0;
    for (let k = 0; k < count; k++) {
      const q = k / Math.max(1, count - 1);
      t += Math.round(50 + 230 * q * q * q);
      const kk = k;
      timers.current.push(
        setTimeout(() => {
          sfxUi("shuffle");
          setCur((start + kk) % n);
        }, t)
      );
    }
    timers.current.push(
      setTimeout(() => {
        setCur(null);
        done(pick);
      }, t + 950)
    );
    setCur(start);
  };
  return { cur, run };
}

function BotRoom({ st, nick, onMatch }: { st: Extract<RankStatus, { s: "bot" }>; nick: string; onMatch: (cfg: BotCfg) => void }) {
  const [ch, setCh] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [vs, setVs] = useState<BotCfg | null>(null);
  const shuffle = useCharShuffle();
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 500);
    return () => clearInterval(t);
  }, []);
  const go = (picked?: number) => {
    if (busy || vs || (picked === undefined && shuffle.cur !== null)) return;
    // 랜덤: 먼저 얼굴 칸을 돌려 뽑은 뒤 시작
    if (picked === undefined && ch < 0) {
      shuffle.run((p) => {
        setCh(p);
        go(p);
      });
      return;
    }
    setBusy(true);
    setErr("");
    sfxUi("ready");
    const mine = picked ?? ch;
    rankBotStart(st.id, mine)
      .then((r) => {
        const cfg: BotCfg = { id: st.id, chars: [mine, r.botCh], map: r.map, seed: r.seed, botR: r.botR, names: [nick, st.opp.nick] };
        loadSheet(CHARS[mine].id).catch(() => {});
        loadSheet(CHARS[r.botCh].id).catch(() => {});
        if (MAPS[r.map]?.bg) new Image().src = MAPS[r.map].bg!;
        setVs(cfg);
      })
      .catch((e) => {
        setErr(e?.message || "시작하지 못했어요");
        setBusy(false);
      });
  };
  useEffect(() => {
    if (!vs) return;
    const t = setTimeout(() => onMatch(vs), 1600);
    return () => clearTimeout(t);
  }, [vs, onMatch]);
  // 키보드: A·D(←→) 고르기, J·Enter 시작, Esc 취소
  const ref = useRef({ ch, go, spinning: false });
  useEffect(() => {
    // (시작을 누른 뒤 · VS 화면에선 고르기 키를 안 받음 — A·D에 고르는 소리가 나던 것)
    ref.current = { ch, go, spinning: shuffle.cur !== null || busy || !!vs };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = CHARS.length;
      const k = e.code;
      if (k === "Escape") rankCancel();
      else if (ref.current.spinning) return;
      else if (k === "KeyA" || k === "ArrowLeft") (sfxUi("move"), setCh((c) => ((c + 1 - 1 + n + 1) % (n + 1)) - 1));
      else if (k === "KeyD" || k === "ArrowRight") (sfxUi("move"), setCh((c) => ((c + 1 + 1) % (n + 1)) - 1));
      else if (k === "KeyJ" || k === "Space" || k === "Enter") ref.current.go();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (vs) {
    const cs = [CHARS[vs.chars[0]], CHARS[vs.chars[1]]];
    return (
      <div className="absolute inset-0 flex items-center justify-center gap-[4cqw] bg-black/40">
        {cs.map((c, i) => (
          <div key={i} className={`flex flex-col items-center gap-[0.8cqw] ${i === 0 ? "order-1" : "order-3"}`}>
            <img
              src={face(c)}
              alt={c.name}
              className={`h-[18cqw] w-[22.5cqw] rounded-[0.8cqw] border-[0.4cqw] object-cover ${PX} [animation:modal-fade_300ms_ease-out]`}
              style={{ borderColor: c.color, transform: i === 1 ? "scaleX(-1)" : undefined }}
            />
            <div className={`${KR} text-[3.2cqw] leading-none font-extrabold`} style={{ color: c.color }}>
              {c.name}
            </div>
            <div className={`${KR} text-[1.5cqw] text-white/80`}>
              <Nick name={vs.names[i]} />
              {i === 0 && <span className="ml-[0.5cqw] text-[#FDE047]">(나)</span>}
            </div>
          </div>
        ))}
        <div className="order-2 flex flex-col items-center gap-[0.6cqw]">
          <div className="font-mono text-[9cqw] font-black text-[#FDE047] italic drop-shadow-[0_0.5cqw_0_#000]">VS</div>
          <div className={`${KR} text-[1.3cqw] text-white/70`}>{MAPS[vs.map]?.name}</div>
        </div>
      </div>
    );
  }
  const shown = shuffle.cur ?? ch;
  const c = shown >= 0 ? CHARS[shown] : null;
  return (
    <>
      <div className="absolute inset-x-[2cqw] top-[2cqw] z-20 flex items-center gap-[1cqw]">
        <button type="button" onClick={() => (sfxUi("back"), rankCancel())} className={pill}>
          ◀ 취소
        </button>
        <div className="flex min-w-0 flex-1 flex-col items-center">
          <div className={`${KR} text-[2cqw] font-extrabold text-white drop-shadow-[0_0.2cqw_0_#000]`}>⚔ 랭크전</div>
          <div className={`${KR} text-[1.15cqw] text-white/55`}>맵 {MAPS[st.map]?.name ?? "?"} · 한 판 승부</div>
        </div>
        <span className={`${KR} rounded-full bg-black/50 px-[1.4cqw] py-[0.5cqw] text-[1.2cqw] text-[#FDE047] tabular-nums`}>
          ⏱ {Math.max(0, Math.ceil((st.deadline - now) / 1000))}초 안에 시작
        </span>
      </div>
      {/* 나 */}
      {c ? (
        <img
          key={c.id}
          src={art(c)}
          alt={c.name}
          className={`absolute top-[16%] left-[1cqw] z-0 h-[64%] w-[22cqw] object-contain object-left-bottom ${PX} [animation:modal-fade_250ms_ease-out]`}
          style={{ filter: `drop-shadow(0 0 1cqw ${SEAT_COL[0]})` }}
        />
      ) : (
        <div className="absolute top-[22%] left-[4cqw] z-0 flex h-[50%] w-[16cqw] items-center justify-center font-mono text-[12cqw] font-black text-white/25">
          ?
        </div>
      )}
      <div className="absolute top-[8.4cqw] left-[2cqw] z-10 flex w-[20cqw] flex-col gap-[0.3cqw]">
        <div className="flex items-center gap-[0.6cqw]">
          <span className="rounded-[0.3cqw] px-[0.7cqw] font-mono text-[1.2cqw] font-black text-white" style={{ background: SEAT_COL[0] }}>
            1P
          </span>
          <span className={`${KR} truncate text-[1.5cqw] font-bold text-white drop-shadow-[0_0.2cqw_0_#000]`}>
            <Nick name={nick} />
            <span className="ml-[0.4cqw] text-[1.1cqw] text-[#FDE047]">(나)</span>
          </span>
        </div>
        <div className={`${KR} text-[2.4cqw] leading-none font-extrabold drop-shadow-[0_0.3cqw_0_#000]`} style={{ color: c?.color ?? "#fff" }}>
          {c ? c.name : "랜덤"}
        </div>
        <span className="font-mono text-[1.3cqw] text-white/60 tabular-nums">{st.me.r}</span>
      </div>
      {/* 상대 */}
      <div className="absolute top-[22%] right-[4cqw] z-0 flex h-[50%] w-[16cqw] items-center justify-center font-mono text-[12cqw] font-black text-white/25">
        ?
      </div>
      <div className="absolute top-[8.4cqw] right-[2cqw] z-10 flex w-[20cqw] flex-col items-end gap-[0.3cqw] text-right">
        <div className="flex flex-row-reverse items-center gap-[0.6cqw]">
          <span className="rounded-[0.3cqw] px-[0.7cqw] font-mono text-[1.2cqw] font-black text-white" style={{ background: SEAT_COL[1] }}>
            2P
          </span>
          <span className={`${KR} truncate text-[1.5cqw] font-bold text-white drop-shadow-[0_0.2cqw_0_#000]`}>
            <Nick name={st.opp.nick} />
          </span>
        </div>
        <span className={`${KR} text-[1.2cqw] text-white/50`}>캐릭터는 시작할 때 공개</span>
        <span className="font-mono text-[1.3cqw] text-white/60 tabular-nums">{st.opp.r}</span>
      </div>
      <div className="absolute top-[9cqw] left-1/2 z-10 flex w-[30cqw] -translate-x-1/2 flex-col items-center gap-[0.6cqw] rounded-[0.8cqw] bg-black/55 px-[1.4cqw] py-[1cqw] backdrop-blur-[2px]">
        <div className={`${KR} text-center text-[1.2cqw] leading-snug text-white/75`}>
          12초 안에 사람을 찾지 못해 <b className="text-white">비슷한 실력대의 AI</b>와 매칭됐어요
        </div>
        <div className={`${KR} text-center text-[1.02cqw] text-white/45`}>레이팅 반영 · 시작한 뒤에 나가면 패배</div>
      </div>
      {/* 아래: 캐릭터 고르기 + 시작 */}
      <div className="absolute bottom-[1cqw] left-1/2 z-10 flex -translate-x-1/2 items-end gap-[1.4cqw] rounded-[1cqw] bg-black/50 px-[1.2cqw] pt-[0.8cqw] pb-[0.7cqw] backdrop-blur-[2px]">
        <div className="flex flex-col items-center gap-[0.4cqw]">
          <div className="flex gap-[0.7cqw]">
            {[-1, ...CHARS.map((_, i) => i)].map((i) => {
              const on = shown === i;
              const cc = i >= 0 ? CHARS[i] : null;
              return (
                <button key={i} type="button" disabled={busy || shuffle.cur !== null} onClick={() => (sfxUi("move"), setCh(i))} className="cursor-pointer disabled:cursor-not-allowed">
                  {cc ? (
                    <img
                      src={face(cc)}
                      alt={cc.name}
                      className={`h-[5cqw] w-[6.2cqw] rounded-[0.4cqw] border-[0.25cqw] object-cover ${PX} ${on ? "" : "grayscale-[60%]"}`}
                      style={{ borderColor: on ? SEAT_COL[0] : "rgba(255,255,255,0.2)" }}
                    />
                  ) : (
                    <span
                      className="flex h-[5cqw] w-[5cqw] items-center justify-center rounded-[0.4cqw] border-[0.25cqw] bg-black/60 font-mono text-[3cqw] font-black text-white/80"
                      style={{ borderColor: on ? SEAT_COL[0] : "rgba(255,255,255,0.2)" }}
                    >
                      ?
                    </span>
                  )}
                  <span className={`${KR} block pt-[0.2cqw] text-center text-[1cqw] text-white/75`}>{cc ? cc.name : "랜덤"}</span>
                </button>
              );
            })}
          </div>
          <div className={`${KR} text-[1cqw] text-white/40`}>
            {err ? <span className="text-[#F87171]">{err}</span> : keyText("A·D(←→) 고르기 · J(Enter) 시작 · Esc 취소")}
          </div>
        </div>
        <button type="button" disabled={busy || shuffle.cur !== null} onClick={() => go()} className={`${bigBtn} mb-[1.6cqw] min-w-[12cqw]`}>
          {busy ? "시작하는 중…" : "시작"}
        </button>
      </div>
    </>
  );
}

/** 경기 화면이 아닌데 AI전이 진행 중: 막 끝나 결과를 확인하는 중이면 잠깐 기다리고, 아니면(새로고침 등) 기권 안내 */
function BotGone({ id }: { id: string }) {
  const [wait, setWait] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setWait(false), 6000);
    return () => clearTimeout(t);
  }, []);
  if (wait) return <Center>결과 확인 중…</Center>;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[1.4cqw]">
      <div className={`${KR} text-[2cqw] font-bold text-white`}>하던 랭크전 경기에서 나왔어요</div>
      <div className={`${KR} text-[1.3cqw] text-white/55`}>경기 중에 나가면 패배로 처리돼요</div>
      <button type="button" onClick={() => rankBotForfeit(id)} className={bigBtn}>
        확인
      </button>
    </div>
  );
}

/** AI전 결과 · 레이팅 변화 */
function BotEnd({ st, onAgain, onLobby }: { st: Extract<RankStatus, { s: "botEnd" }>; onAgain: () => void; onLobby: () => void }) {
  const win = st.out === 2 ? null : st.out === 0;
  const d = st.delta;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[1.4cqw]">
      <div className="font-mono text-[2.2cqw] font-black tracking-[0.3em] text-white/70 italic">RANKED</div>
      <div
        className={`${KR} text-[4.4cqw] leading-none font-extrabold drop-shadow-[0_0.3cqw_0_#000]`}
        style={{ color: win === true ? "#FDE047" : win === false ? "#F87171" : "#fff" }}
      >
        {win === null ? "무승부" : win ? "승리" : "패배"}
      </div>
      <div className={`${KR} text-[1.3cqw] text-white/55`}>
        vs <Nick name={st.opp.nick} /> ({st.opp.r})
      </div>
      {st.r !== undefined && d !== undefined ? (
        <div className="flex items-baseline gap-[1cqw] font-mono tabular-nums">
          <span className="text-[1.6cqw] text-white/55">{st.r - d}</span>
          <span className="text-[1.6cqw] text-white/40">→</span>
          <span className="text-[3.2cqw] font-black text-white">{st.r}</span>
          <span className={`text-[2.2cqw] font-black ${d > 0 ? "text-[#4ADE80]" : d < 0 ? "text-[#F87171]" : "text-white/60"}`}>
            {d > 0 ? `+${d}` : d}
          </span>
        </div>
      ) : (
        <div className={`${KR} text-[1.3cqw] text-white/55`}>레이팅을 저장하지 못했어요</div>
      )}
      {st.r !== undefined && d !== undefined && <TierChange before={st.r - d} after={st.r} />}
      {st.note && <div className={`${KR} text-[1.2cqw] text-[#FCA5A5]`}>{st.note}</div>}
      <div className="mt-[1cqw] flex gap-[1.2cqw]">
        <button type="button" onClick={onAgain} className={rankBtn}>
          ⚔ 다시 찾기
        </button>
        <button type="button" onClick={onLobby} className={pill}>
          로비로
        </button>
      </div>
    </div>
  );
}

/** 로비 랭크전 칸: 내 등급 · 점수 · 순위 */
function MyTier({ r, n, rank }: { r: number; n: number; rank: string }) {
  const info = rankTierOf(r, n);
  return (
    <div className="flex items-center gap-[0.9cqw] rounded-[0.7cqw] bg-white/[0.04] px-[0.9cqw] py-[0.6cqw]">
      <TierEmblem info={info} size={40} className="h-[3.4cqw] w-[3.4cqw]" />
      <div className="flex min-w-0 flex-col">
        <span className={`${KR} text-[1.3cqw] font-extrabold`} style={{ color: info.placing ? "#9AA3B2" : info.tier.color }}>
          {info.placing ? `배치 중 ${n}/10` : info.label}
        </span>
        <span className="font-mono text-[1.1cqw] text-white/55 tabular-nums">
          <b className="text-white">{r}</b> · <span className={KR}>{rank}</span>
        </span>
      </div>
    </div>
  );
}

/** 결과 화면: 바뀐 뒤 등급 (오르거나 내려갔으면 표시) */
function TierChange({ before, after }: { before: number; after: number }) {
  const a = rankTierOf(before);
  const b = rankTierOf(after);
  const moved = a.label !== b.label;
  const up = after > before;
  return (
    <div className="flex items-center gap-[0.8cqw]">
      <TierEmblem info={b} size={48} className={`h-[3.8cqw] w-[3.8cqw] ${moved ? "[animation:modal-pop_400ms_ease-out]" : ""}`} />
      <span className={`${KR} text-[1.6cqw] font-extrabold`} style={{ color: b.tier.color }}>
        {b.label}
      </span>
      {moved && (
        <span
          className={`${KR} rounded-full px-[0.8cqw] py-[0.15cqw] text-[1.1cqw] font-bold ${up ? "bg-[#4ADE80]/20 text-[#86EFAC]" : "bg-[#F87171]/20 text-[#FCA5A5]"}`}
        >
          {up ? "승급!" : "강등"}
        </span>
      )}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className={`${KR} absolute inset-0 flex items-center justify-center text-[1.6cqw] text-white/60`}>{children}</div>;
}

function Title({ en, ko }: { en: string; ko: string }) {
  return (
    <div className="flex flex-col items-center gap-[0.4cqw]">
      <div className="font-mono text-[2.6cqw] font-black tracking-[0.35em] text-white italic drop-shadow-[0_0.3cqw_0_#000]">{en}</div>
      <div className={`${KR} text-[1.2cqw] text-white/55`}>{ko}</div>
    </div>
  );
}

function NickForm({ onSubmit, onBack }: { onSubmit: (n: string) => void; onBack: () => void }) {
  const [v, setV] = useState("");
  const ok = () => v.trim() && onSubmit(v);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[1.6cqw]">
      <Title en="ONLINE" ko="온라인 대전에서 쓸 닉네임" />
      <div className="flex gap-[0.8cqw]">
        <input
          autoFocus
          maxLength={10}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && ok()}
          placeholder="닉네임 (10자)"
          className={`${field} w-[24cqw] text-center`}
        />
        <button type="button" onClick={ok} className={bigBtn}>
          확인
        </button>
      </div>
      <button type="button" onClick={onBack} className={pill}>
        ◀ 모드 선택
      </button>
    </div>
  );
}

// ───────────── 로비 ─────────────

function Lobby({
  uid,
  nick,
  onNick,
  onBack,
  onEnter,
  onWatch,
  member,
  onRank,
  rankErr,
}: {
  uid: string;
  nick: string;
  onNick: () => void;
  onBack: () => void;
  onEnter: (id: string) => void;
  /** 꽉 찼거나 대전 중인 방 → 관전 */
  onWatch: (id: string) => void;
  /** 회원인가 (랭크전은 회원만) */
  member: boolean;
  onRank: () => void;
  rankErr: string;
}) {
  const [rooms, setRooms] = useState<LobbyRoom[] | null>(null);
  // 내 랭크전 등급 (회원)
  const [my, setMy] = useState<FightMe["me"] | undefined>(undefined);
  useEffect(() => {
    if (!member) return;
    getFightMe()
      .then((d) => setMy(d.me))
      .catch(() => {});
  }, [member]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const checked = useRef(new Set<string>());
  useEffect(
    () =>
      subscribeLobby((list) => {
        setRooms(list);
        // 아무도 없는 1분 넘은 방 정리
        for (const r of list) {
          if (checked.current.has(r.id) || serverNow() - r.createdAt < 60_000) continue;
          checked.current.add(r.id);
          cleanupEmptyRoom(r.id);
        }
      }),
    []
  );
  // 키보드: Esc 뒤로
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.code === "Escape") {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const create = async () => {
    setBusy(true);
    setErr("");
    try {
      onEnter(await createRoom(uid, nick, name));
    } catch (e) {
      console.error(e);
      setErr("방을 만들지 못했어요");
      setBusy(false);
    }
  };
  const open = (rooms ?? []).filter((r) => r.count === 1 && !r.playing);

  return (
    <div className="absolute inset-0 flex flex-col gap-[1.4cqw] px-[3cqw] pt-[2.4cqw] pb-[2cqw]">
      <button type="button" onClick={onBack} className={`${pill} absolute top-[2.4cqw] left-[2cqw]`}>
        ◀ 모드 선택
      </button>
      <div className={`${KR} absolute top-[2.4cqw] right-[2cqw] flex items-center gap-[0.6cqw] text-[1.2cqw] text-white/60`}>
        <span>
          닉네임 <b className="text-white">{nick}</b>
        </span>
        <button type="button" onClick={onNick} className={pill}>
          바꾸기
        </button>
      </div>
      <Title en="ONLINE LOBBY" ko="방을 만들거나 들어가서 1:1 대전" />
      <div className="flex min-h-0 flex-1 gap-[2cqw]">
        {/* 방 목록 */}
        <div className="flex min-h-0 flex-1 flex-col rounded-[1cqw] bg-black/50 p-[1cqw] backdrop-blur-[2px]">
          <div className={`${KR} mb-[0.6cqw] flex items-center justify-between text-[1.2cqw] text-white/50`}>
            <span>열린 방 {rooms ? rooms.length : ""}</span>
            <span className="text-white/35">한 방에 2명 · 꽉 찬 방·대전 중인 방은 관전</span>
          </div>
          <div className="thin-scroll flex min-h-0 flex-1 flex-col gap-[0.6cqw] overflow-y-auto pr-[0.4cqw]">
            {rooms === null ? (
              <div className={`${KR} py-[4cqw] text-center text-[1.3cqw] text-white/35`}>불러오는 중…</div>
            ) : rooms.length === 0 ? (
              <div className={`${KR} py-[4cqw] text-center text-[1.3cqw] leading-relaxed text-white/40`}>
                열린 방이 없어요.
                <br />방을 만들고 친구에게 초대 링크를 보내 보세요!
              </div>
            ) : (
              rooms.map((r) => {
                const full = r.count >= 2;
                // 꽉 찼거나 대전 중인 방은 자리에 앉는 대신 관전으로 들어감
                const watchable = full || (r.playing && r.count > 0);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => (watchable ? onWatch(r.id) : onEnter(r.id))}
                    className="flex w-full cursor-pointer items-center justify-between gap-[1cqw] rounded-[0.6cqw] border border-white/10 bg-white/[0.04] px-[1.2cqw] py-[0.8cqw] text-left transition-colors hover:border-[#FDE047]/60 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span className="min-w-0">
                      <span className={`${KR} block truncate text-[1.4cqw] font-bold text-white`}>{r.name}</span>
                      <span className={`${KR} text-[1.05cqw] text-white/40`}>
                        방장 <Nick name={r.host} /> · {r.playing ? "대전 중" : full ? "꽉 참" : r.count === 0 ? "비어 있음" : "상대 기다리는 중"}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-[0.8cqw]">
                      {watchable && (
                        <span className={`${KR} rounded-full bg-[#22D3EE]/20 px-[0.9cqw] py-[0.2cqw] text-[1.1cqw] font-bold text-[#67E8F9]`}>
                          👁 관전
                        </span>
                      )}
                      <span className={`font-mono text-[1.5cqw] font-black ${full ? "text-[#F87171]" : "text-[#FDE047]"}`}>
                        {r.count}/2
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
        <div className="flex w-[30cqw] flex-col gap-[1.2cqw]">
        {/* 랭크전 */}
        <div className="flex flex-col gap-[1cqw] rounded-[1cqw] bg-black/50 p-[1.4cqw] backdrop-blur-[2px]">
          <div className="flex items-baseline justify-between">
            <span className={`${KR} text-[1.5cqw] font-extrabold text-white`}>랭크전</span>
            <span className={`${KR} text-[1.05cqw] text-white/40`}>회원 · 자동 매칭 · 맵 랜덤</span>
          </div>
          {member && my !== undefined && (
            <MyTier r={my?.r ?? 1000} n={my?.n ?? 0} rank={my ? `${my.rank}위 / ${my.of}명` : "첫 판을 해 보세요"} />
          )}
          <div className={`${KR} text-[1.02cqw] leading-snug text-white/45`}>
            비슷한 레이팅끼리 매칭 · 12초 이내 매칭이 잡히지 않을 시 비슷한 실력대의 AI와 매칭이 됩니다
          </div>
          <button type="button" disabled={!member} onClick={onRank} className={rankBtn}>
            {member ? "랭크전 매칭" : "회원만 할 수 있어요"}
          </button>
          {rankErr && <div className={`${KR} text-[1.05cqw] text-[#F87171]`}>{rankErr}</div>}
        </div>
        {/* 만들기 */}
        <div className="flex flex-1 flex-col gap-[1cqw] rounded-[1cqw] bg-black/50 p-[1.4cqw] backdrop-blur-[2px]">
          <div className={`${KR} text-[1.5cqw] font-extrabold text-white`}>방 만들기</div>
          <input
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && !busy && create()}
            placeholder={`${nick}의 방`}
            className={field}
          />
          <button type="button" disabled={busy} onClick={create} className={bigBtn}>
            {busy ? "만드는 중…" : "+ 만들기"}
          </button>
          {err && <div className={`${KR} text-[1.1cqw] text-[#F87171]`}>{err}</div>}
          <div className="my-[0.4cqw] h-px bg-white/10" />
          <button
            type="button"
            disabled={open.length === 0}
            onClick={() => open[0] && onEnter(open[0].id)}
            className={`${KR} cursor-pointer rounded-full border-[0.2cqw] border-white/70 bg-black/40 py-[0.6cqw] text-[1.4cqw] font-bold text-white hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-black/40 disabled:hover:text-white`}
          >
            ⚡ 빠른 입장
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

// ───────────── 관전 대기 ─────────────

/** 관전: 방 상태를 보다가 경기가 시작되면(이미 진행 중이어도) 바로 관전 화면으로 */
function WatchRoom({
  w,
  played,
  onMatch,
  onLeave,
}: {
  w: WatchSession;
  played: Set<string>;
  onMatch: (cfg: MatchCfg) => void;
  onLeave: () => void;
}) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const off = w.on(force);
    return () => void off();
  }, [w]);
  const room = w.room;
  const st = room?.state;
  const ps = w.players;
  useEffect(() => {
    if (!st || st.phase !== "play" || !st.match || played.has(st.match) || !ps[0] || !ps[1]) return;
    loadSheet(CHARS[st.chars[0]].id).catch(() => {});
    loadSheet(CHARS[st.chars[1]].id).catch(() => {});
    onMatch({
      match: st.match,
      seat: 0,
      chars: st.chars,
      map: st.map,
      delay: st.delay,
      maxRb: st.maxRb,
      names: [ps[0].nick, ps[1].nick],
      spectate: true,
      room: w.id,
    });
  }, [st, played, ps, w.id, onMatch]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        onLeave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onLeave]);

  if (w.lost)
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[1.4cqw]">
        <div className={`${KR} text-[2cqw] font-bold text-white`}>{w.lost}</div>
        <button type="button" onClick={onLeave} className={bigBtn}>
          로비로
        </button>
      </div>
    );
  if (!room) return <Center>방 불러오는 중…</Center>;
  const nWatch = Object.keys(room.watchers).length;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[2cqw]">
      <button type="button" onClick={onLeave} className={`${pill} absolute top-[2cqw] left-[2cqw]`}>
        ◀ 로비로
      </button>
      <Title en="SPECTATE" ko={`${room.name} · 👁 관전 ${nWatch}명`} />
      <div className="flex items-center gap-[4cqw]">
        {[0, 1].map((sd) => {
          const p = ps[sd];
          const c = p && p.ch >= 0 ? CHARS[p.ch] : null;
          return (
            <div key={sd} className={`flex flex-col items-center gap-[0.6cqw] ${sd === 0 ? "order-1" : "order-3"}`}>
              {c ? (
                <img
                  src={face(c)}
                  alt={c.name}
                  className={`h-[13cqw] w-[16cqw] rounded-[0.8cqw] border-[0.35cqw] object-cover ${PX}`}
                  style={{ borderColor: SEAT_COL[sd], transform: sd === 1 ? "scaleX(-1)" : undefined }}
                />
              ) : (
                <div className="flex h-[13cqw] w-[16cqw] items-center justify-center rounded-[0.8cqw] border-[0.35cqw] border-white/20 font-mono text-[6cqw] font-black text-white/25">
                  ?
                </div>
              )}
              <div className={`${KR} text-[1.5cqw] font-bold text-white`}>{p ? <Nick name={p.nick} /> : "빈자리"}</div>
              <div className={`${KR} text-[1.1cqw]`} style={{ color: p?.ready ? "#4ADE80" : "rgba(255,255,255,0.45)" }}>
                {p ? (p.ready ? "준비 완료" : c ? c.name : "랜덤") : ""}
              </div>
            </div>
          );
        })}
        <div className="order-2 font-mono text-[6cqw] font-black text-[#FDE047] italic drop-shadow-[0_0.4cqw_0_#000]">VS</div>
      </div>
      <div className={`${KR} text-[1.4cqw] text-white/60`}>
        {st?.phase === "play" && st.match && played.has(st.match)
          ? "지금 경기가 끝나길 기다리는 중… 다음 경기가 시작되면 바로 보여 줄게요"
          : "다음 경기를 기다리는 중… 시작되면 바로 관전 화면으로 넘어가요"}
      </div>
    </div>
  );
}

// ───────────── 대기실 ─────────────

function Room({
  s,
  played,
  onMatch,
  onLeave,
  onRankAgain,
}: {
  s: RoomSession;
  played: Set<string>;
  onMatch: (cfg: MatchCfg) => void;
  onLeave: () => void;
  /** 랭크전이 끝난 뒤 바로 다시 찾기 */
  onRankAgain: () => void;
}) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const [err, setErr] = useState("");
  const [joined, setJoined] = useState(!!s.me);
  const [vs, setVs] = useState<MatchCfg | null>(null);
  const [chatText, setChatText] = useState("");
  const [copied, setCopied] = useState(false);
  const shuffle = useCharShuffle();
  /** 준비 / 준비 취소 — 랜덤이면 먼저 얼굴 칸을 돌려 뽑은 캐릭터로 준비 */
  const toggleRef = useRef<() => void>(() => {});
  const chatRef = useRef<HTMLDivElement>(null);

  // 입장 (이미 들어가 있으면 그대로)
  useEffect(() => {
    const off = s.on(force);
    if (!s.room) {
      let ch = 0;
      try {
        const v = JSON.parse(localStorage.getItem("fight:setup") ?? "null") as { c1?: number } | null;
        if (v && typeof v.c1 === "number" && CHARS[v.c1]) ch = v.c1;
      } catch {}
      s.join(ch)
        .then(() => setJoined(true))
        .catch((e) => setErr(e instanceof RoomFullError ? "방이 꽉 찼어요" : "방에 들어가지 못했어요"));
    }
    return () => {
      off();
    };
  }, [s]);
  // 주소에 방 표시 (초대 링크 = 지금 주소)
  const isRank = !!s.room?.rank;
  useEffect(() => {
    if (isRank) return;
    const u = new URL(window.location.href);
    u.searchParams.set("room", s.id);
    window.history.replaceState(null, "", u);
    return () => {
      const v = new URL(window.location.href);
      v.searchParams.delete("room");
      window.history.replaceState(null, "", v);
    };
  }, [s.id, isRank]);
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [s.chat.length]);

  const room = s.room;
  const me = s.me;
  const foe = s.foe;
  const net = s.net;
  const st = room?.state;
  const rank = room?.rank ?? null;
  // 랭크전 방이었는지 (방이 닫혀도 기억 — 취소 안내)
  // (렌더 중 ref 를 고치면 안 되니 state 로 — 이전 렌더 정보를 남기는 React 권장 방식)
  const [wasRank, setWasRank] = useState(false);
  if (rank && !wasRank) setWasRank(true);
  // 랭크전 시작까지 남은 시간
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!rank || rank.used) return;
    const t = setInterval(() => setNow(serverNow()), 500);
    return () => clearInterval(t);
  }, [rank]);
  const leave = () => {
    s.leave();
    onLeave();
  };

  // 방장: 둘 다 준비 + 연결됨 → 시작
  const bothReady = !!me?.ready && !!foe?.ready && !!net?.alive;
  useEffect(() => {
    if (!bothReady || !s.isHost || st?.phase !== "wait" || vs) return;
    const t = setTimeout(() => s.startMatch(CHARS.length, MAPS.length), 700);
    return () => clearTimeout(t);
  }, [bothReady, s, st?.phase, vs]);

  // 경기 시작 신호 → VS 잠깐 → 경기 화면
  useEffect(() => {
    if (!st || st.phase !== "play" || !st.match || played.has(st.match) || vs || !foe || !me) return;
    const names: [string, string] = s.seat === 0 ? [me.nick, foe.nick] : [foe.nick, me.nick];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 방 상태 변화에 따라 VS 화면
    setVs({ match: st.match, seat: s.seat, chars: st.chars, map: st.map, delay: st.delay, maxRb: st.maxRb, names });
    loadSheet(CHARS[st.chars[0]].id).catch(() => {});
    loadSheet(CHARS[st.chars[1]].id).catch(() => {});
    if (MAPS[st.map]?.bg) new Image().src = MAPS[st.map].bg!;
    s.setReady(false);
  }, [st, played, vs, foe, me, s]);
  useEffect(() => {
    if (!vs) return;
    const t = setTimeout(() => onMatch(vs), 1600);
    return () => clearTimeout(t);
  }, [vs, onMatch]);

  // 키보드: A·D(←→) 캐릭터, J·Space·Enter 준비, Esc 나가기
  const stRef = useRef({ me, vs, spinning: false });
  useEffect(() => {
    stRef.current = { me, vs, spinning: shuffle.cur !== null };
    toggleRef.current = () => {
      if (!me || shuffle.cur !== null) return;
      if (!me.ready && me.ch < 0) {
        shuffle.run((pick) => {
          s.setChar(pick);
          sfxUi("ready");
          s.setReady(true);
        });
        return;
      }
      sfxUi(me.ready ? "back" : "ready");
      s.setReady(!me.ready);
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const { me, vs } = stRef.current;
      if (vs) return;
      const k = e.code;
      if (k === "Escape") {
        e.preventDefault();
        leave();
        return;
      }
      if (!me) return;
      const n = CHARS.length;
      const move = (d: number) => !me.ready && !stRef.current.spinning && (sfxUi("move"), s.setChar((((me.ch + 1 + d) % (n + 1)) + n + 1) % (n + 1) - 1));
      if (k === "KeyA" || k === "ArrowLeft") move(-1);
      else if (k === "KeyD" || k === "ArrowRight") move(1);
      else if (k === "KeyJ" || k === "Space" || k === "Enter") toggleRef.current();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 최신 값은 stRef로
  }, [s]);

  if (err || s.lost)
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[1.4cqw]">
        <div className={`${KR} text-[2cqw] font-bold text-white`}>
          {wasRank && !err ? "랭크전이 취소됐어요" : err || s.lost}
        </div>
        {wasRank && !err && (
          <div className={`${KR} text-[1.3cqw] text-white/55`}>상대가 나갔거나 시간 안에 준비하지 않았어요 (레이팅 변화 없음)</div>
        )}
        <button type="button" onClick={leave} className={bigBtn}>
          로비로
        </button>
      </div>
    );
  if (!joined || !room || !me) return <Center>입장 중…</Center>;

  // 랭크전 한 판이 끝남 → 결과·레이팅 변화
  if (rank?.used && st && (st.phase === "wait" || played.has(st.match)) && !vs) {
    const res = rank.result;
    const mySeat = s.seat;
    const win = res ? (res.out === 2 ? null : res.out === mySeat) : undefined;
    const d = res?.delta?.[mySeat];
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[1.4cqw]">
        <div className="font-mono text-[2.2cqw] font-black tracking-[0.3em] text-white/70 italic">RANKED</div>
        <div
          className={`${KR} text-[4.4cqw] leading-none font-extrabold drop-shadow-[0_0.3cqw_0_#000]`}
          style={{ color: win === true ? "#FDE047" : win === false ? "#F87171" : "#fff" }}
        >
          {win === undefined ? "결과 확인 중…" : win === null ? "무승부" : win ? "승리" : "패배"}
        </div>
        {res?.rated && res.r && d !== undefined ? (
          <div className="flex items-baseline gap-[1cqw] font-mono tabular-nums">
            <span className="text-[1.6cqw] text-white/55">{res.r[mySeat] - d}</span>
            <span className="text-[1.6cqw] text-white/40">→</span>
            <span className="text-[3.2cqw] font-black text-white">{res.r[mySeat]}</span>
            <span className={`text-[2.2cqw] font-black ${d > 0 ? "text-[#4ADE80]" : d < 0 ? "text-[#F87171]" : "text-white/60"}`}>
              {d > 0 ? `+${d}` : d}
            </span>
          </div>
        ) : null}
        {res?.rated && res.r && d !== undefined && <TierChange before={res.r[mySeat] - d} after={res.r[mySeat]} />}
        {res?.rated && res.r && d !== undefined ? null : res && !res.rated ? (
          <div className={`${KR} text-[1.3cqw] text-white/55`}>이번 판은 레이팅에 반영되지 않았어요 (같은 상대와는 하루 10판까지)</div>
        ) : (
          <div className={`${KR} text-[1.3cqw] text-white/55`}>{win === undefined ? "두 선수의 결과를 맞춰 보는 중이에요" : "레이팅 계산 중…"}</div>
        )}
        <div className="mt-[1cqw] flex gap-[1.2cqw]">
          <button type="button" onClick={() => (s.leave(), onRankAgain())} className={rankBtn}>
            ⚔ 다시 찾기
          </button>
          <button type="button" onClick={leave} className={pill}>
            로비로
          </button>
        </div>
      </div>
    );
  }

  if (vs) {
    const cs = [CHARS[vs.chars[0]], CHARS[vs.chars[1]]];
    const nm = vs.names;
    return (
      <div className="absolute inset-0 flex items-center justify-center gap-[4cqw] bg-black/40">
        {cs.map((c, i) => (
          <div key={i} className={`flex flex-col items-center gap-[0.8cqw] ${i === 0 ? "order-1" : "order-3"}`}>
            <img
              src={face(c)}
              alt={c.name}
              className={`h-[18cqw] w-[22.5cqw] rounded-[0.8cqw] border-[0.4cqw] object-cover ${PX} [animation:modal-fade_300ms_ease-out]`}
              style={{ borderColor: c.color, transform: i === 1 ? "scaleX(-1)" : undefined }}
            />
            <div className={`${KR} text-[3.2cqw] leading-none font-extrabold`} style={{ color: c.color }}>
              {c.name}
            </div>
            <div className={`${KR} text-[1.5cqw] text-white/80`}>
              {nm[i]}
              {i === s.seat && <span className="ml-[0.5cqw] text-[#FDE047]">(나)</span>}
            </div>
          </div>
        ))}
        <div className="order-2 flex flex-col items-center gap-[0.6cqw]">
          <div className="font-mono text-[9cqw] font-black text-[#FDE047] italic drop-shadow-[0_0.5cqw_0_#000]">VS</div>
          <div className={`${KR} text-[1.3cqw] text-white/70`}>{MAPS[vs.map]?.name}</div>
        </div>
      </div>
    );
  }

  const seats = [0, 1].map((sd) => {
    const u = room.seats[sd];
    return (u && room.players[u]) || null;
  });
  const status = net?.status ?? "connecting";
  const ms = net?.rtt ? `${Math.round(net.rtt)}ms` : "재는 중";
  const badge = !foe
    ? { t: "상대 기다리는 중", c: "text-white/45" }
    : status === "p2p"
      ? { t: `직접 연결 · ${ms}`, c: "text-[#4ADE80]" }
      : status === "relay"
        ? { t: `서버 경유 · ${ms}`, c: "text-[#FDE047]" }
        : { t: "연결 중…", c: "text-white/60" };
  const copy = () => {
    navigator.clipboard
      ?.writeText(window.location.href)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  const sendChat = () => {
    if (!chatText.trim()) return;
    s.sendChat(chatText);
    setChatText("");
  };
  const mapOpts = [-1, ...MAPS.map((_, i) => i)];
  const thumb = (i: number) => (i >= 0 ? MAPS[i].bg?.replace(".webp", "-thumb.webp") : undefined);

  return (
    <>
      {/* 위: 나가기 · 방 이름 · 연결 상태 */}
      <div className="absolute inset-x-[2cqw] top-[2cqw] z-20 flex items-center gap-[1cqw]">
        <button type="button" onClick={leave} className={pill}>
          ◀ 나가기
        </button>
        <div className="flex min-w-0 flex-1 flex-col items-center">
          <div className={`${KR} max-w-full truncate text-[2cqw] font-extrabold text-white drop-shadow-[0_0.2cqw_0_#000]`}>{room.name}</div>
          <div className={`${KR} text-[1.15cqw] ${badge.c}`}>● {badge.t}</div>
        </div>
        {rank ? (
          <span className={`${KR} rounded-full bg-black/50 px-[1.4cqw] py-[0.5cqw] text-[1.2cqw] text-[#FDE047] tabular-nums`}>
            ⏱ {Math.max(0, Math.ceil((rank.deadline - now) / 1000))}초 안에 준비
          </span>
        ) : (
          <button type="button" onClick={copy} className={pill}>
            {copied ? "복사됨!" : "🔗 초대 링크"}
          </button>
        )}
      </div>

      {/* 양쪽 자리 */}
      {[0, 1].map((sd) => {
        const p = seats[sd];
        const col = SEAT_COL[sd];
        const mine = sd === s.seat;
        // 내 자리는 랜덤을 돌리는 동안 도는 칸을 보여 줌
        const pch = mine && shuffle.cur !== null ? shuffle.cur : (p?.ch ?? -1);
        const c = p && pch >= 0 ? CHARS[pch] : null;
        return (
          <div key={sd} className="contents">
            {p && c ? (
              <img
                key={c.id}
                src={art(c)}
                alt={c.name}
                className={`absolute top-[16%] ${sd === 0 ? "left-[1cqw] object-left-bottom" : "right-[1cqw] object-right-bottom"} z-0 h-[64%] w-[22cqw] object-contain ${PX} [animation:modal-fade_250ms_ease-out] ${sd === 1 ? "scale-x-[-1]" : ""}`}
                style={{ filter: p.ready ? "drop-shadow(0 0 0.2cqw #fff)" : `drop-shadow(0 0 1cqw ${col})` }}
              />
            ) : (
              <div
                className={`absolute top-[22%] ${sd === 0 ? "left-[4cqw]" : "right-[4cqw]"} z-0 flex h-[50%] w-[16cqw] items-center justify-center font-mono text-[12cqw] font-black text-white/25`}
                style={{ textShadow: p ? `0 0 2cqw ${col}` : undefined }}
              >
                ?
              </div>
            )}
            <div
              className={`absolute top-[8.4cqw] z-10 ${sd === 0 ? "left-[2cqw]" : "right-[2cqw] items-end text-right"} flex w-[20cqw] flex-col gap-[0.3cqw]`}
            >
              <div className={`flex items-center gap-[0.6cqw] ${sd === 1 ? "flex-row-reverse" : ""}`}>
                <span className="rounded-[0.3cqw] px-[0.7cqw] font-mono text-[1.2cqw] font-black text-white" style={{ background: col }}>
                  {sd === 0 ? "1P" : "2P"}
                </span>
                <span className={`${KR} truncate text-[1.5cqw] font-bold text-white drop-shadow-[0_0.2cqw_0_#000]`}>
                  {p ? <Nick name={p.nick} /> : "빈자리"}
                  {mine && <span className="ml-[0.4cqw] text-[1.1cqw] text-[#FDE047]">(나)</span>}
                  {p && room.hostUid === p.uid && <span className="ml-[0.4cqw] text-[1.1cqw]">👑</span>}
                </span>
              </div>
              {p && (
                <div className={`${KR} text-[2.4cqw] leading-none font-extrabold drop-shadow-[0_0.3cqw_0_#000]`} style={{ color: c?.color ?? "#fff" }}>
                  {c ? c.name : "랜덤"}
                </div>
              )}
              {p ? (
                p.ready ? (
                  <span className="font-mono text-[1.6cqw] font-black text-[#FDE047] italic drop-shadow-[0_0.2cqw_0_#000]">READY!</span>
                ) : (
                  <span className={`${KR} text-[1.2cqw] text-white/50`}>고르는 중…</span>
                )
              ) : (
                <span className={`${KR} text-[1.2cqw] text-white/45`}>{rank ? "상대가 들어오는 중…" : "초대 링크를 보내 보세요"}</span>
              )}
            </div>
          </div>
        );
      })}

      {/* 가운데: 맵 · 채팅 */}
      <div className="absolute top-[8.6cqw] left-1/2 z-10 flex h-[24cqw] w-[34cqw] -translate-x-1/2 flex-col gap-[0.8cqw]">
        {rank ? (
          <div className="flex h-[6.4cqw] items-center justify-center gap-[1cqw] rounded-[0.8cqw] bg-black/55 backdrop-blur-[2px]">
            <span className="font-mono text-[3cqw] font-black text-white/70">?</span>
            <span className={`${KR} text-[1.3cqw] leading-snug text-white/75`}>
              <b className="text-white">랭크전</b> — 맵은 랜덤 (시작할 때 공개)
              <br />
              <span className="text-[1.05cqw] text-white/45">한 판 승부 · 나가면 취소 (경기 중엔 기권패)</span>
            </span>
          </div>
        ) : (
        <div className="rounded-[0.8cqw] bg-black/55 p-[0.7cqw] backdrop-blur-[2px]">
          <div className={`${KR} mb-[0.4cqw] text-[1.05cqw] text-white/50`}>맵 {s.isHost ? "(방장이 고름)" : `— 방장이 고름`}</div>
          <div className="flex gap-[0.5cqw]">
            {mapOpts.map((i) => (
              <button
                key={i}
                type="button"
                disabled={!s.isHost}
                onClick={() => s.setPick(i)}
                className={`relative h-[4.4cqw] flex-1 cursor-pointer overflow-hidden rounded-[0.4cqw] border-[0.2cqw] disabled:cursor-default ${
                  st?.pick === i ? "border-[#FDE047]" : "border-white/15 opacity-60"
                }`}
              >
                {thumb(i) ? (
                  <img src={thumb(i)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-black/60 font-mono text-[2cqw] text-white/70">?</span>
                )}
                <span className={`${KR} absolute inset-x-0 bottom-0 bg-black/65 text-[0.95cqw] text-white`}>{i >= 0 ? MAPS[i].name : "랜덤"}</span>
              </button>
            ))}
          </div>
        </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col rounded-[0.8cqw] bg-black/55 backdrop-blur-[2px]">
          <div ref={chatRef} className={`thin-scroll min-h-0 flex-1 overflow-y-auto px-[0.9cqw] py-[0.5cqw] ${KR} text-[1.1cqw] leading-relaxed`}>
            {s.chat.length === 0 && <p className="text-white/30">채팅</p>}
            {s.chat.map((m) => (
              <p key={m.id} className="break-all text-white/80">
                <span className={m.uid === s.uid ? "text-[#A9A3FF]" : "text-white/45"}><Nick name={m.nick} /></span> {m.text}
              </p>
            ))}
          </div>
          <div className="flex gap-[0.5cqw] border-t border-white/10 p-[0.5cqw]">
            <input
              value={chatText}
              maxLength={100}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) sendChat();
                if (e.key === "Escape") (e.target as HTMLInputElement).blur();
              }}
              placeholder="메시지 (Enter)"
              className={`${field} flex-1 py-[0.4cqw] text-[1.1cqw]`}
            />
          </div>
        </div>
      </div>

      {/* 아래: 내 캐릭터 고르기 + 준비 */}
      <div className="absolute bottom-[1cqw] left-1/2 z-10 flex -translate-x-1/2 items-end gap-[1.4cqw] rounded-[1cqw] bg-black/50 px-[1.2cqw] pt-[0.8cqw] pb-[0.7cqw] backdrop-blur-[2px]">
        <div className="flex flex-col items-center gap-[0.4cqw]">
          <div className="flex gap-[0.7cqw]">
            {[-1, ...CHARS.map((_, i) => i)].map((i) => {
              const on = (shuffle.cur ?? me.ch) === i;
              const c = i >= 0 ? CHARS[i] : null;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={me.ready || shuffle.cur !== null}
                  onClick={() => (sfxUi("move"), s.setChar(i))}
                  className="cursor-pointer disabled:cursor-not-allowed"
                >
                  {c ? (
                    <img
                      src={face(c)}
                      alt={c.name}
                      className={`h-[5cqw] w-[6.2cqw] rounded-[0.4cqw] border-[0.25cqw] object-cover ${PX} ${on ? "" : "grayscale-[60%]"}`}
                      style={{ borderColor: on ? SEAT_COL[s.seat] : "rgba(255,255,255,0.2)" }}
                    />
                  ) : (
                    <span
                      className="flex h-[5cqw] w-[5cqw] items-center justify-center rounded-[0.4cqw] border-[0.25cqw] bg-black/60 font-mono text-[3cqw] font-black text-white/80"
                      style={{ borderColor: on ? SEAT_COL[s.seat] : "rgba(255,255,255,0.2)" }}
                    >
                      ?
                    </span>
                  )}
                  <span className={`${KR} block pt-[0.2cqw] text-center text-[1cqw] text-white/75`}>{c ? c.name : "랜덤"}</span>
                </button>
              );
            })}
          </div>
          <div className={`${KR} text-[1cqw] text-white/40`}>{keyText("A·D(←→) 고르기 · J(Enter) 준비 · Esc 나가기 · 둘 다 준비하면 시작")}</div>
        </div>
        <button type="button" disabled={(!foe && !me.ready) || shuffle.cur !== null} onClick={() => toggleRef.current()} className={`${bigBtn} mb-[1.6cqw] min-w-[12cqw]`}>
          {me.ready ? "준비 취소" : foe ? "준비" : "상대 대기"}
        </button>
      </div>
      {me.ready && foe?.ready && !net?.alive && (
        <div className={`${KR} absolute inset-x-0 top-[34.5cqw] z-20 text-center text-[1.3cqw] text-[#FDE047]`}>상대와 연결 중…</div>
      )}
    </>
  );
}
