"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { chessSoundInfo, useMoveSound } from "@/hooks/useMoveSound";
import { Chess } from "chess.js";
import ChessBoard from "./ChessBoard";
import ChessChat from "./ChessChat";
import { timeLabel, useActiveRoomPrompt } from "./ChessLobby";
import {
  ABANDON_AFTER_MS,
  ADD_TIME_MS,
  PAUSE_LIMIT_MS,
  addTime,
  expirePausedGame,
  isPauseExpired,
  pauseGame,
  resumeGame,
  HEARTBEAT_MS,
  MAX_SPECTATORS,
  OFFLINE_AFTER_MS,
  beat,
  cancelUndo,
  claimAbandon,
  claimTimeout,
  colorOf,
  ActiveRoomError,
  joinAsPlayer,
  startGame,
  joinAsSpectator,
  hasRoomAccess,
  inviteLink,
  unlockChessRoom,
  leaveRoom,
  liveClock,
  makeMove,
  offerDraw,
  replay,
  repetitionCount,
  requestUndo,
  resign,
  respondDraw,
  respondUndo,
  requestRematch,
  cancelRematch,
  serverNow,
  subscribePresence,
  subscribeRoom,
  turnOf,
  undoPlies,
  uciToMove,
  type ChessRoom,
  type Color,
  type EndReason,
  type Presence,
} from "@/firestore/chessGame";

const REASON: Record<EndReason, string> = {
  "": "",
  checkmate: "체크메이트",
  timeout: "시간 초과",
  resign: "기권",
  abandon: "상대 이탈",
  stalemate: "스테일메이트",
  insufficient: "기물 부족",
  threefold: "3회 동형반복",
  fifty: "50수 규칙",
  agreement: "합의",
  paused: "2시간 넘게 일시정지",
};
const COLOR_KO = { w: "백", b: "흑" } as const;
const HOLLOW: Record<string, string> = {
  q: "♕\uFE0E",
  r: "♖\uFE0E",
  b: "♗\uFE0E",
  n: "♘\uFE0E",
  p: "♙\uFE0E",
};
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const START_COUNT: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };

const btn =
  "cursor-pointer rounded-full border border-white/15 px-3 py-1.5 font-mono text-xs whitespace-nowrap text-white/75 transition-colors hover:border-[#6C63FF]/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-30";
const primaryBtn =
  "cursor-pointer rounded-full bg-[#6C63FF] px-4 py-1.5 font-mono text-xs whitespace-nowrap text-white transition-colors hover:bg-[#5b52f0] disabled:cursor-not-allowed disabled:opacity-40";

function fmtClock(ms: number) {
  if (ms < 10_000) return (Math.max(0, ms) / 1000).toFixed(1);
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 남은 시간을 "1시간 59분" / "12분" 형태로 */
function fmtLeft(ms: number) {
  const min = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(min / 60);
  return h > 0 ? `${h}시간 ${min % 60}분` : `${min}분`;
}

/** color 쪽이 잡은 상대 기물 목록 + 기물 점수 차이 */
function captured(game: Chess) {
  const count = {
    w: { ...Object.fromEntries(Object.keys(START_COUNT).map((k) => [k, 0])) },
    b: {},
  } as Record<Color, Record<string, number>>;
  count.b = { ...count.w };
  game
    .board()
    .flat()
    .forEach((p) => {
      if (p && p.type !== "k") count[p.color][p.type]++;
    });
  const out = { w: [] as string[], b: [] as string[] };
  const points = { w: 0, b: 0 };
  for (const t of ["q", "r", "b", "n", "p"]) {
    // 프로모션으로 기물 수가 시작보다 많아질 수 있어서 0 미만은 무시
    const takenByW = Math.max(0, START_COUNT[t] - count.b[t]); // 백이 잡은 흑 기물
    const takenByB = Math.max(0, START_COUNT[t] - count.w[t]);
    for (let i = 0; i < takenByW; i++) out.w.push(t);
    for (let i = 0; i < takenByB; i++) out.b.push(t);
    points.w += takenByW * VALUE[t];
    points.b += takenByB * VALUE[t];
  }
  return { list: out, points };
}

function PlayerBar({
  name,
  color,
  clockMs,
  timed,
  active,
  online,
  isMe,
  caps,
  points,
  diff,
}: {
  name: string;
  color: Color;
  clockMs: number;
  timed: boolean;
  active: boolean;
  online: boolean | null;
  isMe: boolean;
  caps: string[];
  /** 잡은 기물 점수 합 (폰1 · 나이트/비숍3 · 룩5 · 퀸9) */
  points: number;
  /** 상대보다 앞선 점수 (0 이하면 표시 안 함) */
  diff: number;
}) {
  const low = timed && clockMs < 20_000;
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${online === null ? "bg-white/20" : online ? "bg-emerald-400" : "bg-red-400"}`}
            title={online === null ? "빈 자리" : online ? "접속 중" : "연결 끊김"}
          />
          <span className="truncate font-['Nanum_Gothic',sans-serif] text-sm text-white/90">
            {name || "대기 중…"}
            {isMe && <span className="ml-1 text-[#8B84FF]">(나)</span>}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-white/35">{COLOR_KO[color]}</span>
        </div>
        {/* 잡은 기물 + 점수 (어두운 배경에서도 보이게 외곽선 글리프) */}
        <div className="flex min-h-[18px] min-w-0 items-center gap-1.5 pl-4">
          <span className="flex min-w-0 items-center overflow-hidden">
            {caps.map((t, i) => (
              <span key={i} className="-mr-0.5 text-[17px] leading-none text-white/65">
                {HOLLOW[t]}
              </span>
            ))}
          </span>
          {points > 0 && (
            <span className="shrink-0 font-mono text-[11px] text-white/40">{points}점</span>
          )}
          {diff > 0 && (
            <span className="shrink-0 rounded bg-[#6C63FF]/25 px-1.5 font-mono text-[11px] text-[#B7B2FF]">
              +{diff}
            </span>
          )}
        </div>
      </div>
      {timed && (
        <div
          className={`shrink-0 rounded-md px-2.5 py-1 font-mono text-lg tabular-nums transition-colors ${
            active
              ? low
                ? "bg-red-500/85 text-white"
                : "bg-[#E9E6F7] text-[#16141d]"
              : "bg-white/5 text-white/45"
          }`}
        >
          {fmtClock(clockMs)}
        </div>
      )}
    </div>
  );
}

interface Props {
  roomId: string;
  uid: string;
  nick: string;
  intent: "play" | "watch" | null;
  /** 초대 링크의 키 (비밀번호 방도 비번 없이 입장) */
  invite: string | null;
  onExit: () => void;
  /** 다른 방으로 이동 (이미 진행중인 내 게임으로 보낼 때) */
  onGoRoom: (roomId: string) => void;
}

export default function ChessRoomView({
  roomId,
  uid,
  nick,
  intent,
  invite,
  onExit,
  onGoRoom,
}: Props) {
  const [room, setRoom] = useState<ChessRoom | null | undefined>(undefined);
  const [presence, setPresence] = useState<Record<string, Presence>>({});
  const [now, setNow] = useState(() => serverNow());
  const [flip, setFlip] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirmResign, setConfirmResign] = useState(false);
  const [copied, setCopied] = useState(false);
  // 낙관적 업데이트: 서버 응답 전에 보드에 먼저 반영
  const [pending, setPending] = useState<{ base: number; uci: string } | null>(null);
  const intentDone = useRef(false);
  const promptActive = useActiveRoomPrompt(onGoRoom);
  const timeoutClaimed = useRef("");
  const topRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  useEffect(
    () =>
      subscribeRoom(
        roomId,
        (r) => setRoom(r),
        () => setRoom(null)
      ),
    [roomId]
  );
  useEffect(() => subscribePresence(roomId, uid, setPresence), [roomId, uid]);

  const me = room ? colorOf(room, uid) : null;
  const isSpectator = !!room && room.spectators[uid] !== undefined;
  const participating = !!me || isSpectator;
  const hostWaiting = !!room && room.status === "waiting" && room.hostUid === uid;
  const timed = !!room && room.timeMin > 0;
  const playing = room?.status === "playing";
  const paused = playing && !!room?.pausedAt;
  const isHost = !!room && room.hostUid === uid;

  // 비밀번호 방: 권한 확인 (초대 링크로 왔으면 키로 바로 통과)
  const [access, setAccess] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState("");
  const accessChecked = useRef(false);
  useEffect(() => {
    if (!room || accessChecked.current) return;
    accessChecked.current = true;
    (async () => {
      if (await hasRoomAccess(room, uid)) return setAccess(true);
      if (invite) {
        try {
          await unlockChessRoom(roomId, uid, { invite });
          return setAccess(true);
        } catch {}
      }
      setAccess(false);
    })();
  }, [room, uid, roomId, invite]);
  const submitPw = async () => {
    setPwError("");
    try {
      await unlockChessRoom(roomId, uid, { password: pw });
      setAccess(true);
    } catch (e) {
      setPwError((e as Error).message);
    }
  };

  // 로비에서 참여/관전 누르고 들어온 경우 자동 처리
  useEffect(() => {
    if (!room || intentDone.current || participating || !access) return;
    intentDone.current = true;
    if (!intent) return;
    const run =
      intent === "play" ? joinAsPlayer(roomId, uid, nick) : joinAsSpectator(roomId, uid, nick);
    run.catch((e: Error) => {
      if (e instanceof ActiveRoomError) promptActive(e.room);
      else setMsg(e.message);
    });
  }, [room, intent, participating, roomId, uid, nick, promptActive, access]);

  // 하트비트 (탭이 백그라운드로 가도 브라우저가 허용하는 한 계속 전송,
  // 돌아오면 즉시 전송)
  useEffect(() => {
    if (!participating) return;
    const send = () => beat(roomId, uid, nick, hostWaiting).catch(() => {});
    send();
    const t = setInterval(send, HEARTBEAT_MS);
    const onVis = () => document.visibilityState === "visible" && send();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [participating, roomId, uid, nick, hostWaiting]);

  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), timed && playing && !paused ? 100 : 1000);
    return () => clearInterval(t);
  }, [timed, playing, paused]);

  // 상단 헤더가 커서 입장 시 보드 쪽으로 스크롤 (모바일에서 특히)
  useEffect(() => {
    if (!room || scrolled.current) return;
    scrolled.current = true;
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [room]);

  const moves = room?.moves;
  const game = useMemo(() => replay(moves ?? []), [moves]);
  const history = useMemo(() => game.history(), [game]);
  const repeats = useMemo(() => repetitionCount(moves ?? []), [moves]);

  // 서버 반영되면 낙관적 수 제거
  const [prevLen, setPrevLen] = useState(moves?.length ?? 0);
  if (moves && moves.length !== prevLen) {
    setPrevLen(moves.length);
    setPending(null);
  }

  const display = useMemo(() => {
    if (!room || !pending || pending.base !== room.moves.length)
      return { fen: room?.fen ?? "", last: room?.moves.at(-1) };
    const g = new Chess(room.fen);
    try {
      g.move(uciToMove(pending.uci));
      return { fen: g.fen(), last: pending.uci };
    } catch {
      return { fen: room.fen, last: room.moves.at(-1) };
    }
  }, [room, pending]);
  // 낙관적 수까지 포함한 화면상 수 — 서버 반영 때 한 번 더 울리지 않도록
  useMoveSound(
    room && display.fen ? room.moves.length + (display.fen !== room.fen ? 1 : 0) : -1,
    chessSoundInfo(display.fen, display.last, me),
    "chess"
  );

  const clock = room ? liveClock(room, now) : { w: 0, b: 0 };
  const turn = room ? turnOf(room) : "w";

  // 시간 초과 판정 (대국자 쪽에서 감지해서 기록)
  useEffect(() => {
    if (!room || !playing || !timed || !me) return;
    const key = `${room.moves.length}`;
    if (liveClock(room, now)[turnOf(room)] <= 0 && timeoutClaimed.current !== key) {
      timeoutClaimed.current = key;
      claimTimeout(roomId).catch(() => (timeoutClaimed.current = ""));
    }
  }, [room, playing, timed, me, now, roomId]);

  // 2시간 넘게 멈춘 대국은 종료 처리 (대국자 쪽에서 감지)
  const expireClaimed = useRef(false);
  useEffect(() => {
    if (!room || !me || expireClaimed.current || !isPauseExpired(room, now)) return;
    expireClaimed.current = true;
    expirePausedGame(roomId).catch(() => (expireClaimed.current = false));
  }, [room, me, now, roomId]);

  if (room === undefined) {
    return <p className="pt-24 text-center font-mono text-sm text-white/40">방에 접속하는 중…</p>;
  }
  if (room === null || room.status === "closed") {
    return (
      <div className="flex flex-col items-center gap-4 pt-24 text-center">
        <p className="font-['Nanum_Gothic',sans-serif] text-white/60">
          {room === null ? "존재하지 않는 방입니다." : "방장이 방을 닫았습니다."}
        </p>
        <button type="button" onClick={onExit} className={primaryBtn}>
          로비로
        </button>
      </div>
    );
  }

  if (room.locked && access === false && !participating) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-4 px-6 pt-24 pb-24 text-center">
        <div className="font-mono text-sm text-[#8B84FF]">🔒 {room.name}</div>
        <p className="font-['Nanum_Gothic',sans-serif] text-sm text-white/60">
          비밀번호를 입력해주세요
        </p>
        <div className="flex w-full gap-2">
          <input
            type="password"
            autoFocus
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitPw()}
            className="min-w-0 flex-1 rounded-full border border-white/10 bg-[#1C1E24] px-4 py-2 text-center text-white focus:border-[#6C63FF]/50 focus:outline-none"
          />
          <button type="button" onClick={submitPw} className={primaryBtn}>
            입장
          </button>
        </div>
        {pwError && <p className="font-mono text-xs text-red-300">{pwError}</p>}
        <button
          type="button"
          onClick={onExit}
          className="font-mono text-xs text-white/40 hover:text-white"
        >
          ← 로비로
        </button>
      </div>
    );
  }

  const orientation: Color = me ?? (flip ? "b" : "w");
  const opp: Color = orientation === "w" ? "b" : "w";
  const seat = (c: Color) => ({
    uid: c === "w" ? room.whiteUid : room.blackUid,
    name: c === "w" ? room.whiteName : room.blackName,
  });
  const isOnline = (c: Color): boolean | null => {
    const s = seat(c);
    if (!s.uid) return null;
    if (s.uid === uid) return true;
    const p = presence[s.uid];
    return !!p && now - p.lastSeen < OFFLINE_AFTER_MS;
  };
  const oppColor: Color | null = me ? (me === "w" ? "b" : "w") : null;
  const oppSeat = oppColor ? seat(oppColor) : null;
  const oppLastSeen = oppSeat?.uid
    ? (presence[oppSeat.uid]?.lastSeen ?? room.updatedAt?.toMillis() ?? now)
    : now;
  const oppOffline = !!oppColor && playing && !paused && isOnline(oppColor) === false;
  const oppAwayMs = now - oppLastSeen;

  const caps = captured(game);
  const canMove = playing && !paused && !!me && turn === me && !pending;
  const pauseLeftMs =
    paused && room.pausedAt ? PAUSE_LIMIT_MS - (now - room.pausedAt.toMillis()) : 0;
  const undoReq = room.undoReq;
  const myUndoPlies = me ? undoPlies(room, me) : 0;
  const specNames = Object.entries(room.spectators);
  const seatOpen = room.status === "waiting" && (!room.whiteUid || !room.blackUid);

  const run = (p: Promise<unknown>) =>
    p.catch((e: Error) => {
      if (e instanceof ActiveRoomError) return promptActive(e.room);
      console.error(e);
      setMsg(e.message || "요청에 실패했습니다.");
    });

  const onMove = (uci: string) => {
    setMsg("");
    setPending({ base: room.moves.length, uci });
    makeMove(roomId, uid, uci).catch((e: Error) => {
      setPending(null);
      setMsg(e.message || "수를 둘 수 없습니다.");
    });
  };

  const exit = async () => {
    await leaveRoom(room, uid).catch(() => {});
    onExit();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(await inviteLink(roomId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  let status: React.ReactNode;
  if (room.status === "waiting") {
    status = seatOpen ? "상대를 기다리는 중…" : "시작 대기 중";
  } else if (room.status === "ended") {
    const winner: Color | null = room.result === "1-0" ? "w" : room.result === "0-1" ? "b" : null;
    const head = winner ? `${COLOR_KO[winner]} 승리` : "무승부";
    const mine = me ? (winner === null ? " · 무승부" : winner === me ? " · 승리!" : " · 패배") : "";
    status = (
      <>
        <span className="text-white">{head}</span>
        <span className="text-white/50"> ({REASON[room.reason]})</span>
        <span className="text-[#8B84FF]">{mine}</span>
      </>
    );
  } else if (paused) {
    status = (
      <>
        <span className="text-amber-200">⏸ 일시정지</span>
        <span className="text-white/50"> · 방장이 재개하면 이어집니다</span>
      </>
    );
  } else {
    status = (
      <>
        {me ? (turn === me ? "내 차례" : "상대 차례") : `${COLOR_KO[turn]} 차례`}
        {game.inCheck() && <span className="ml-2 text-red-400">체크!</span>}
        {repeats === 2 && (
          <span className="ml-2 text-amber-300/90">같은 국면 2회째 · 한 번 더 나오면 무승부</span>
        )}
      </>
    );
  }

  const pairs: [string, string | undefined][] = [];
  for (let i = 0; i < history.length; i += 2) pairs.push([history[i], history[i + 1]]);

  return (
    <div ref={topRef} className="mx-auto max-w-5xl scroll-mt-28 px-3 pt-8 pb-24 sm:px-6">
      {/* 헤더 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={exit} className={btn}>
            ← {hostWaiting ? "방 닫기" : me && room.status === "waiting" ? "나가기" : "로비"}
          </button>
          <span className="truncate font-['Nanum_Gothic',sans-serif] text-white/90">
            {room.name}
          </span>
          <span className="shrink-0 font-mono text-xs text-white/40">{timeLabel(room)}</span>
        </div>
        <div className="flex gap-1.5">
          {!me && (
            <button type="button" onClick={() => setFlip((f) => !f)} className={btn}>
              ⇅ 뒤집기
            </button>
          )}
          <button type="button" onClick={copyLink} className={btn}>
            {copied ? "복사됨!" : "🔗 초대 링크"}
          </button>
        </div>
      </div>

      <div className="flex flex-col items-center gap-5 lg:flex-row lg:items-start lg:justify-center">
        {/* 보드 */}
        <div className="w-full max-w-[max(300px,min(560px,calc(100dvh-190px)))]">
          <PlayerBar
            {...seat(opp)}
            color={opp}
            clockMs={clock[opp]}
            timed={timed}
            active={playing && !paused && turn === opp}
            online={isOnline(opp)}
            isMe={seat(opp).uid === uid}
            caps={caps.list[opp]}
            points={caps.points[opp]}
            diff={caps.points[opp] - caps.points[orientation]}
          />
          <div className="relative">
            <ChessBoard
              fen={display.fen}
              orientation={orientation}
              canMove={canMove}
              lastMove={display.last}
              onMove={onMove}
            />
            {paused && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-black/60 p-4 text-center">
                <span className="mb-1 flex gap-1.5" aria-hidden>
                  <span className="h-7 w-2.5 rounded-sm bg-white/90" />
                  <span className="h-7 w-2.5 rounded-sm bg-white/90" />
                </span>
                <p className="font-['Nanum_Gothic',sans-serif] text-white">일시정지됨</p>
                <p className="font-mono text-xs text-white/55">
                  {fmtLeft(pauseLeftMs)} 안에 재개하지 않으면 무승부로 종료됩니다
                </p>
                {isHost && (
                  <button
                    type="button"
                    onClick={() => run(resumeGame(roomId, uid))}
                    className={`${primaryBtn} mt-1`}
                  >
                    ▶ 재개
                  </button>
                )}
              </div>
            )}
            {room.status === "waiting" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-black/55 p-4 text-center">
                {!seatOpen ? (
                  room.hostUid === uid ? (
                    <>
                      <p className="font-['Nanum_Gothic',sans-serif] text-white">
                        상대가 입장했습니다
                      </p>
                      <button
                        type="button"
                        onClick={() => run(startGame(roomId, uid))}
                        className={primaryBtn}
                      >
                        ▶ 게임 시작
                      </button>
                    </>
                  ) : (
                    <p className="font-['Nanum_Gothic',sans-serif] text-white">
                      방장이 시작하기를 기다리는 중…
                    </p>
                  )
                ) : me ? (
                  <>
                    <p className="font-['Nanum_Gothic',sans-serif] text-white">
                      상대를 기다리는 중…
                    </p>
                    <p className="font-mono text-xs text-white/60">
                      초대 링크를 보내거나 로비에서 참여를 기다리세요
                    </p>
                    <button type="button" onClick={copyLink} className={primaryBtn}>
                      {copied ? "복사됨!" : "초대 링크 복사"}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="font-['Nanum_Gothic',sans-serif] text-white">
                      상대를 기다리는 중…
                    </p>
                    <button
                      type="button"
                      onClick={() => run(joinAsPlayer(roomId, uid, nick))}
                      className={primaryBtn}
                    >
                      대국 참여하기
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <PlayerBar
            {...seat(orientation)}
            color={orientation}
            clockMs={clock[orientation]}
            timed={timed}
            active={playing && !paused && turn === orientation}
            online={isOnline(orientation)}
            isMe={seat(orientation).uid === uid}
            caps={caps.list[orientation]}
            points={caps.points[orientation]}
            diff={caps.points[orientation] - caps.points[opp]}
          />
        </div>

        {/* 사이드 패널 */}
        <div className="flex w-full max-w-[560px] flex-col gap-3 lg:w-72 lg:max-w-none">
          <div className="rounded-xl border border-white/10 bg-[#1C1E24] px-4 py-3 font-['Nanum_Gothic',sans-serif] text-sm text-white/80">
            {status}
          </div>

          {msg && (
            <div
              className="rounded-lg bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300"
              onClick={() => setMsg("")}
            >
              {msg}
            </div>
          )}

          {/* 관전/참여 안내 */}
          {!participating && room.status !== "waiting" && room.status !== "ended" && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#1C1E24] px-4 py-3">
              <span className="font-mono text-xs text-white/50">
                관전 {specNames.length}/{MAX_SPECTATORS}
              </span>
              <button
                type="button"
                disabled={specNames.length >= MAX_SPECTATORS}
                onClick={() => run(joinAsSpectator(roomId, uid, nick))}
                className={primaryBtn}
              >
                관전하기
              </button>
            </div>
          )}

          {/* 상대 연결 끊김 */}
          {me && oppOffline && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 font-['Nanum_Gothic',sans-serif] text-xs text-amber-200">
              상대 연결이 끊겼습니다 ({Math.floor(oppAwayMs / 1000)}초). 돌아오면 이어서 진행됩니다.
              {oppAwayMs >= ABANDON_AFTER_MS ? (
                <button
                  type="button"
                  onClick={() => run(claimAbandon(roomId, uid))}
                  className={`${primaryBtn} mt-2 block`}
                >
                  승리 선언
                </button>
              ) : (
                <div className="mt-1 text-amber-200/60">
                  {Math.ceil((ABANDON_AFTER_MS - oppAwayMs) / 1000)}초 후 승리 선언 가능
                </div>
              )}
            </div>
          )}

          {/* 무르기 / 무승부 요청 */}
          {me && playing && undoReq && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-[#6C63FF]/40 bg-[#6C63FF]/10 px-4 py-3">
              {undoReq.uid === uid ? (
                <>
                  <span className="font-['Nanum_Gothic',sans-serif] text-xs text-white/80">
                    무르기 요청 중…
                  </span>
                  <button type="button" onClick={() => run(cancelUndo(roomId))} className={btn}>
                    취소
                  </button>
                </>
              ) : (
                <>
                  <span className="font-['Nanum_Gothic',sans-serif] text-xs text-white/80">
                    상대가 무르기를 요청했습니다
                  </span>
                  <span className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => run(respondUndo(roomId, uid, true))}
                      className={primaryBtn}
                    >
                      수락
                    </button>
                    <button
                      type="button"
                      onClick={() => run(respondUndo(roomId, uid, false))}
                      className={btn}
                    >
                      거절
                    </button>
                  </span>
                </>
              )}
            </div>
          )}
          {me && playing && room.drawOffer && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-[#6C63FF]/40 bg-[#6C63FF]/10 px-4 py-3">
              {room.drawOffer === uid ? (
                <span className="font-['Nanum_Gothic',sans-serif] text-xs text-white/80">
                  무승부 제안 중…
                </span>
              ) : (
                <>
                  <span className="font-['Nanum_Gothic',sans-serif] text-xs text-white/80">
                    상대가 무승부를 제안했습니다
                  </span>
                  <span className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => run(respondDraw(roomId, uid, true))}
                      className={primaryBtn}
                    >
                      수락
                    </button>
                    <button
                      type="button"
                      onClick={() => run(respondDraw(roomId, uid, false))}
                      className={btn}
                    >
                      거절
                    </button>
                  </span>
                </>
              )}
            </div>
          )}

          {/* 방장 컨트롤 */}
          {isHost && playing && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-white/10 bg-[#1C1E24] px-3 py-2.5">
              <span className="mr-1 font-mono text-[10px] text-white/35">방장</span>
              {paused ? (
                <button
                  type="button"
                  onClick={() => run(resumeGame(roomId, uid))}
                  className={primaryBtn}
                >
                  ▶ 재개
                </button>
              ) : (
                <button type="button" onClick={() => run(pauseGame(roomId, uid))} className={btn}>
                  ⏸ 일시정지
                </button>
              )}
              {timed && me && (
                <>
                  <button
                    type="button"
                    onClick={() => run(addTime(roomId, uid, me === "w" ? "b" : "w"))}
                    className={btn}
                  >
                    상대 +{ADD_TIME_MS / 1000}초
                  </button>
                  <button
                    type="button"
                    onClick={() => run(addTime(roomId, uid, me))}
                    className={btn}
                  >
                    내 시간 +{ADD_TIME_MS / 1000}초
                  </button>
                </>
              )}
            </div>
          )}

          {/* 대국자 액션 */}
          {me && playing && (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={paused || myUndoPlies === 0 || !!undoReq}
                onClick={() => run(requestUndo(room, uid))}
                className={btn}
              >
                ↶ 무르기 요청
              </button>
              <button
                type="button"
                disabled={paused || !!room.drawOffer}
                onClick={() => run(offerDraw(roomId, uid))}
                className={btn}
              >
                ½ 무승부 제안
              </button>
              {confirmResign ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmResign(false);
                      run(resign(roomId, uid));
                    }}
                    className="cursor-pointer rounded-full bg-red-500/85 px-3 py-1.5 font-mono text-xs text-white hover:bg-red-500"
                  >
                    네, 기권할게요
                  </button>
                  <button type="button" onClick={() => setConfirmResign(false)} className={btn}>
                    계속 둘래요
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmResign(true)} className={btn}>
                  ⚑ 기권
                </button>
              )}
            </div>
          )}

          {room.status === "ended" && me && (
            // 다시 하기: 방 그대로, 선후를 바꿔 한 판 더 (둘 다 누르면 바로 시작)
            <div className="flex flex-wrap items-center gap-2">
              {room.rematch === uid ? (
                <>
                  <span className="font-mono text-xs text-white/55">상대 응답 기다리는 중…</span>
                  <button type="button" onClick={() => run(cancelRematch(roomId))} className={btn}>
                    취소
                  </button>
                </>
              ) : room.rematch ? (
                <>
                  <span className="font-mono text-xs text-[#9BE7FF]">상대가 한 판 더 원해요</span>
                  <button type="button" onClick={() => run(requestRematch(roomId, uid))} className={primaryBtn}>
                    ↻ 다시 하기
                  </button>
                  <button type="button" onClick={() => run(cancelRematch(roomId))} className={btn}>
                    거절
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => run(requestRematch(roomId, uid))} className={primaryBtn}>
                  ↻ 다시 하기 (선후 교대)
                </button>
              )}
            </div>
          )}
          {room.status === "ended" && (
            <button type="button" onClick={onExit} className={me ? btn : primaryBtn}>
              로비로 돌아가기
            </button>
          )}

          {/* 기보 */}
          <div className="thin-scroll max-h-44 overflow-y-auto rounded-xl border border-white/10 bg-[#1C1E24] p-2 lg:max-h-72">
            {pairs.length === 0 ? (
              <p className="py-3 text-center font-mono text-xs text-white/30">
                아직 둔 수가 없습니다
              </p>
            ) : (
              <div className="grid grid-cols-[2.2rem_1fr_1fr] gap-y-0.5 font-mono text-xs">
                {pairs.map(([w, b], i) => (
                  <div key={i} className="contents">
                    <span className="px-1 text-white/30">{i + 1}.</span>
                    <span className="px-1 text-white/80">{w}</span>
                    <span className="px-1 text-white/80">{b ?? ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 채팅 */}
          <ChessChat room={room} uid={uid} nick={nick} canSend={participating} />

          {/* 관전자 */}
          <div className="px-1 font-mono text-[11px] text-white/35">
            관전 {specNames.length}/{MAX_SPECTATORS}
            {specNames.length > 0 && ` · ${specNames.map(([, n]) => n).join(", ")}`}
          </div>
          {me && playing && (
            <p className="px-1 font-['Nanum_Gothic',sans-serif] text-[11px] leading-relaxed text-white/30">
              로비로 나가도 대국은 유지됩니다. 같은 브라우저로 다시 들어오면 이어서 둘 수 있어요.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
