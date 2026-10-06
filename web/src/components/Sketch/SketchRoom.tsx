"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SketchCanvas from "@/components/Sketch/SketchCanvas";
import SketchChat from "@/components/Sketch/SketchChat";
import {
  addSeen,
  hintOf,
  LEVEL_BONUS,
  LEVEL_LABEL,
  loadSeen,
  normalizeAnswer,
  pickChoices,
} from "@/lib/sketch/words";
import {
  backToWaiting,
  chooseWord,
  claimHost,
  kickPlayer,
  remainingTurns,
  endTurn,
  getInvite,
  leaderOf,
  markCorrect,
  nextTurn,
  orderedPlayers,
  relayGuess,
  removeGuess,
  sendChat,
  sendGuess,
  serverNow,
  setChoices,
  setHint,
  startGame,
  subscribeGuesses,
  subscribeWords,
  syncLobby,
  type SketchRoom as Room,
  type TurnWords,
} from "@/realtime/sketch";

const LEVEL_STYLE = [
  "bg-emerald-400/15 text-emerald-300",
  "bg-sky-400/15 text-sky-300",
  "bg-rose-400/15 text-rose-300",
];

const TURN_MODE_LABEL = { winner: "정답자가 다음 차례", order: "입장 순서대로" } as const;

/** 남은 시간(ms) — 250ms마다 갱신 */
function useRemaining(endsAt: number) {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, endsAt - now);
}

export default function SketchRoom({
  room,
  uid,
  nick,
  onLeave,
}: {
  room: Room;
  uid: string;
  nick: string;
  onLeave: () => void;
}) {
  const { id: roomId, meta, state } = room;
  const players = orderedPlayers(room);
  const leader = leaderOf(room);
  const isLeader = leader === uid;
  const isDrawer =
    state.drawer === uid && (state.phase === "choosing" || state.phase === "drawing");
  const iCorrect = state.correct?.[uid] !== undefined;
  const remaining = useRemaining(state.endsAt);

  // ── 그리는 사람: 제시어 (본인만 읽을 수 있는 노드) ──
  const [words, setWords] = useState<TurnWords | null>(null);
  const amDrawer = state.drawer === uid;
  useEffect(() => {
    if (!amDrawer || !state.turnId) {
      setWords(null); // eslint-disable-line react-hooks/set-state-in-effect -- 그리는 사람이 아니면 비움
      return;
    }
    return subscribeWords(roomId, setWords);
  }, [roomId, amDrawer, state.turnId]);

  // 후보: 쉬움·보통·어려움 하나씩 (이 방에서 나온 정답, 이 브라우저에서 최근 본 단어는 피함)
  useEffect(() => {
    if (!isDrawer || state.phase !== "choosing") return;
    if (words && words.turnId === state.turnId) return;
    const choices = pickChoices(new Set(Object.keys(room.used)), loadSeen());
    setChoices(roomId, state.turnId, choices).catch(() => {});
  }, [isDrawer, state.phase, state.turnId, words, roomId, room.used]);

  const myWord = words?.turnId === state.turnId ? words.word : undefined;

  const pick = (w: string, level: number) => {
    addSeen(w);
    chooseWord(room, w, hintOf(w, 0), level).catch(() => {});
  };

  // 공개된 정답은 이 브라우저의 '최근 본 단어'에 추가 (다음 게임에서 덜 나오게)
  useEffect(() => {
    if (state.phase === "reveal" && state.reveal) addSeen(state.reveal);
  }, [state.phase, state.reveal]);

  // ── 그리는 사람: 정답 판정 ──
  // 구독 콜백에서 최신 방 상태·제시어를 읽기 위한 ref
  const roomRef = useRef(room);
  const wordRef = useRef(myWord);
  useEffect(() => {
    roomRef.current = room;
    wordRef.current = myWord;
  });
  useEffect(() => {
    if (!amDrawer) return;
    return subscribeGuesses(roomId, (g) => {
      const cur = roomRef.current;
      const word = wordRef.current;
      removeGuess(roomId, g.id);
      if (cur.state.phase !== "drawing" || g.turnId !== cur.state.turnId || !word) {
        relayGuess(roomId, g).catch(() => {});
        return;
      }
      if (normalizeAnswer(g.text) === normalizeAnswer(word)) markCorrect(cur, g).catch(() => {});
      else relayGuess(roomId, g).catch(() => {});
    });
  }, [amDrawer, roomId]);

  // ── 그리는 사람: 힌트 공개, 시간 종료, 모두 정답이면 종료 ──
  useEffect(() => {
    if (!amDrawer || state.phase !== "drawing" || !myWord) return;
    const guessers = players.filter((p) => p.uid !== uid);
    const allCorrect =
      guessers.length > 0 && guessers.every((p) => state.correct?.[p.uid] !== undefined);
    if (remaining <= 0 || allCorrect) {
      endTurn(roomId, state.turnId, myWord).catch(() => {});
      return;
    }
    if (meta.hints && myWord.length >= 2) {
      const ratio = remaining / (meta.drawTime * 1000);
      const level = ratio < 0.25 ? 2 : ratio < 0.5 ? 1 : 0;
      const h = hintOf(myWord, level);
      if (h !== state.hint) setHint(roomId, state.turnId, h).catch(() => {});
    }
  }, [amDrawer, state, myWord, remaining, players, uid, roomId, meta]);

  // ── 리더: 진행 (그리는 사람이 나가거나 응답 없을 때 정리, 다음 차례) ──
  useEffect(() => {
    if (!isLeader) return;
    const drawerHere = !!room.players[state.drawer];
    if (
      state.phase === "choosing" &&
      (!drawerHere || (remaining <= 0 && serverNow() > state.endsAt + 1500))
    )
      endTurn(roomId, state.turnId, "").catch(() => {});
    else if (state.phase === "drawing" && (!drawerHere || serverNow() > state.endsAt + 4000))
      endTurn(roomId, state.turnId, "").catch(() => {});
    else if (state.phase === "reveal" && remaining <= 0) nextTurn(room).catch(() => {});
  }, [isLeader, room, state, remaining, roomId]);

  // 방장이 나갔으면 리더가 방장 자리를 이어받음
  useEffect(() => {
    if (isLeader && meta.hostUid !== uid) claimHost(roomId, uid);
  }, [isLeader, meta.hostUid, uid, roomId]);

  // 방장: 강퇴 (한 번 더 눌러야 실행)
  const [kickTarget, setKickTarget] = useState("");
  useEffect(() => {
    if (!kickTarget) return;
    const t = setTimeout(() => setKickTarget(""), 3000);
    return () => clearTimeout(t);
  }, [kickTarget]);

  // 리더: 로비 요약 갱신
  const playerCount = players.length;
  useEffect(() => {
    if (isLeader) syncLobby(roomRef.current);
  }, [isLeader, playerCount, state.phase]);

  // ── 채팅 입력 ──
  const drawingNow = state.phase === "drawing";
  const disabledReason =
    drawingNow && amDrawer
      ? "그리는 중에는 채팅할 수 없어요"
      : drawingNow && iCorrect
        ? "정답! 다른 사람이 맞힐 때까지 기다려주세요"
        : "";
  const onSend = (text: string) => {
    if (drawingNow && !amDrawer && !iCorrect)
      sendGuess(roomId, { uid, nick, text, turnId: state.turnId }).catch(() => {});
    else sendChat(roomId, uid, nick, text).catch(() => {});
  };

  // ── 초대 링크 ──
  const [copied, setCopied] = useState(false);
  const copyInvite = async () => {
    const k = await getInvite(roomId);
    const url = `${location.origin}/games/sketch/?room=${roomId}${k ? `&k=${k}` : ""}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const ranking = useMemo(
    () =>
      Object.entries(room.scores)
        .map(([u, s]) => ({ uid: u, ...s }))
        .sort((a, b) => b.score - a.score),
    [room.scores]
  );

  const sec = Math.ceil(remaining / 1000);
  const turnsLeft = remainingTurns(room);
  const timeRatio =
    state.phase === "drawing"
      ? remaining / (meta.drawTime * 1000)
      : state.phase === "choosing"
        ? remaining / 15000
        : 0;

  // ── 캔버스 위 안내 오버레이 ──
  let overlay: React.ReactNode = null;
  if (state.phase === "waiting") {
    overlay = (
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="font-mono text-lg font-bold text-white">대기실</div>
        <p className="font-['Nanum_Gothic',sans-serif] text-sm text-white/60">
          {players.length}/{meta.max}명 · {meta.drawTime}초 · 한 사람당 {meta.rounds}번 ·{" "}
          {TURN_MODE_LABEL[meta.turnMode]}
          {meta.hints ? " · 힌트" : ""}
        </p>
        {isLeader ? (
          <button
            type="button"
            disabled={players.length < 2}
            onClick={() => startGame(room).catch(() => {})}
            className="cursor-pointer rounded-full bg-[#6C63FF] px-6 py-2.5 font-mono text-sm text-white transition-colors hover:bg-[#5b52f0] disabled:cursor-default disabled:opacity-40"
          >
            {players.length < 2 ? "2명 이상 모이면 시작할 수 있어요" : "게임 시작"}
          </button>
        ) : (
          <p className="font-mono text-xs text-white/40">방장이 시작하기를 기다리는 중…</p>
        )}
      </div>
    );
  } else if (state.phase === "choosing") {
    overlay = isDrawer ? (
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="font-mono text-sm text-white/70">그릴 제시어를 고르세요 ({sec}초)</div>
        <div className="flex flex-wrap justify-center gap-2">
          {(words?.turnId === state.turnId ? (words.choices ?? []) : []).map((w, i) => {
            const lv = words?.levels?.[i] ?? 0;
            return (
              <button
                key={w}
                type="button"
                onClick={() => pick(w, lv)}
                className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-white/15 bg-[#1C1E24] px-5 py-3 transition-all hover:-translate-y-0.5 hover:border-[#6C63FF]"
              >
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${LEVEL_STYLE[lv]}`}
                >
                  {LEVEL_LABEL[lv as 0 | 1 | 2]}
                  {lv > 0 && ` ×${LEVEL_BONUS[lv as 0 | 1 | 2]}`}
                </span>
                <span className="font-['Nanum_Gothic',sans-serif] text-lg font-bold text-white">
                  {w}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    ) : (
      <p className="font-['Nanum_Gothic',sans-serif] text-white/70">
        <b className="text-white">{state.drawerNick}</b>님이 제시어를 고르는 중… ({sec})
      </p>
    );
  } else if (state.phase === "reveal") {
    const got = Object.keys(state.correct ?? {}).map((u) => room.scores[u]?.nick ?? "?");
    overlay = (
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="font-mono text-xs text-white/50">정답</div>
        <div className="font-['Nanum_Gothic',sans-serif] text-3xl font-bold text-white">
          {state.reveal || "(건너뜀)"}
        </div>
        <p className="font-['Nanum_Gothic',sans-serif] text-sm text-white/60">
          {got.length ? `맞힌 사람: ${got.join(", ")}` : "아무도 못 맞혔어요"}
        </p>
      </div>
    );
  } else if (state.phase === "ended") {
    overlay = (
      <div className="flex w-full max-w-xs flex-col items-center gap-3 text-center">
        <div className="font-mono text-lg font-bold text-white">🏆 최종 순위</div>
        <ol className="w-full space-y-1">
          {ranking.map((p, i) => (
            <li
              key={p.uid}
              className={`flex justify-between rounded-lg px-3 py-1.5 font-mono text-sm ${
                i === 0 ? "bg-amber-400/15 text-amber-200" : "bg-white/5 text-white/80"
              }`}
            >
              <span>
                {i + 1}. {p.nick}
              </span>
              <span>{p.score}</span>
            </li>
          ))}
        </ol>
        {isLeader && (
          <button
            type="button"
            onClick={() => backToWaiting(roomId).catch(() => {})}
            className="mt-2 cursor-pointer rounded-full bg-[#6C63FF] px-5 py-2 font-mono text-sm text-white hover:bg-[#5b52f0]"
          >
            대기실로 (다시 하기)
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 pb-16 sm:px-6">
      {/* 상단 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onLeave}
            className="cursor-pointer rounded-full border border-white/15 px-3 py-1 font-mono text-xs text-white/60 hover:text-white"
          >
            ← 나가기
          </button>
          <h1 className="truncate font-mono text-base font-bold text-white">
            {meta.locked && "🔒 "}
            {meta.name}
          </h1>
        </div>
        <button
          type="button"
          onClick={copyInvite}
          className="cursor-pointer rounded-full border border-white/15 px-3 py-1 font-mono text-xs text-white/60 hover:border-[#6C63FF]/60 hover:text-white"
        >
          {copied ? "복사됨!" : "🔗 초대 링크 복사"}
        </button>
      </div>

      {/* 제시어·힌트·타이머 */}
      <div className="mb-3 flex items-center gap-3 rounded-xl border border-white/10 bg-[#1C1E24] px-4 py-2.5">
        <span className="shrink-0 font-mono text-xs text-white/40">
          {state.phase === "waiting"
            ? "대기 중"
            : state.phase === "ended"
              ? "게임 끝"
              : `${state.turnNo}번째 · ${turnsLeft ? `${turnsLeft}턴 남음` : "마지막"}`}
        </span>
        <div className="min-w-0 flex-1 text-center font-['Nanum_Gothic',sans-serif]">
          {state.phase === "drawing" &&
            (amDrawer ? (
              <span className="text-lg font-bold text-white">
                <span className="mr-2 font-mono text-xs font-normal text-[#A9A3FF]">제시어</span>
                {myWord}
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${LEVEL_STYLE[state.level] ?? LEVEL_STYLE[0]}`}
                >
                  {LEVEL_LABEL[state.level as 0 | 1 | 2] ?? ""}
                </span>
                <span className="text-xl font-bold tracking-[0.3em] text-white">{state.hint}</span>
              </span>
            ))}
          {state.phase === "choosing" && (
            <span className="text-sm text-white/60">{state.drawerNick}님 차례</span>
          )}
        </div>
        {(state.phase === "drawing" || state.phase === "choosing") && (
          <span
            className={`shrink-0 font-mono text-lg font-bold ${sec <= 10 ? "text-red-400" : "text-white"}`}
          >
            {sec}
          </span>
        )}
      </div>
      <div className="mb-3 h-1 overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full bg-gradient-to-r from-[#6C63FF] to-[#2dd4bf] transition-[width] duration-300 ease-linear"
          style={{ width: `${Math.max(0, Math.min(1, timeRatio)) * 100}%` }}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* 도화지 */}
        <div className="relative min-w-0">
          <SketchCanvas
            roomId={roomId}
            turnId={state.turnId}
            canDraw={amDrawer && state.phase === "drawing"}
          />
          {overlay && (
            <div className="absolute inset-x-0 top-0 flex aspect-[4/3] items-center justify-center rounded-xl bg-[#121212]/85 p-6 backdrop-blur-sm">
              {overlay}
            </div>
          )}
        </div>

        {/* 참가자·채팅 */}
        <div className="flex min-h-[360px] flex-col gap-3 lg:h-[calc(min(100vw,72rem)*0.75*0.72)] lg:max-h-[640px]">
          <ul className="grid grid-cols-2 gap-1.5 lg:grid-cols-1">
            {players.map((p) => {
              const sc = room.scores[p.uid]?.score ?? 0;
              const got = state.correct?.[p.uid];
              const drawingThis =
                p.uid === state.drawer && (state.phase === "drawing" || state.phase === "choosing");
              return (
                <li
                  key={p.uid}
                  className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 font-mono text-xs ${
                    got !== undefined
                      ? "border-emerald-400/40 bg-emerald-400/10"
                      : drawingThis
                        ? "border-[#6C63FF]/50 bg-[#6C63FF]/10"
                        : "border-white/10 bg-[#1C1E24]"
                  }`}
                >
                  <span className="min-w-0 truncate text-white/85">
                    {p.uid === leader && "👑 "}
                    {drawingThis && "✏️ "}
                    {p.nick}
                    {p.uid === uid && <span className="text-white/35"> (나)</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-white/50">
                    {got !== undefined && <span className="text-emerald-300">+{got}</span>}
                    {sc}
                    {isLeader && p.uid !== uid && (
                      <button
                        type="button"
                        title="강퇴"
                        onClick={() => {
                          if (kickTarget === p.uid) {
                            setKickTarget("");
                            kickPlayer(room, p.uid).catch(() => {});
                          } else setKickTarget(p.uid);
                        }}
                        className={`ml-0.5 cursor-pointer rounded px-1 transition-colors ${
                          kickTarget === p.uid
                            ? "bg-red-500/80 text-white"
                            : "text-white/25 hover:bg-red-500/20 hover:text-red-300"
                        }`}
                      >
                        {kickTarget === p.uid ? "강퇴?" : "✕"}
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <SketchChat
            roomId={roomId}
            uid={uid}
            disabledReason={disabledReason}
            placeholder={drawingNow && !amDrawer ? "정답을 입력하세요" : "채팅"}
            onSend={onSend}
          />
        </div>
      </div>
    </div>
  );
}
