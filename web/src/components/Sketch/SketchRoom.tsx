"use client";

import { plainName } from "@/components/Nick";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import SketchCanvas, {
  COLORS,
  WIDTHS,
  type CanvasApi,
  type Tool,
} from "@/components/Sketch/SketchCanvas";
import SketchChat from "@/components/Sketch/SketchChat";
import { AVATAR_COLOR, avatarOf, type StampName } from "@/lib/sketch/assets";
import { playBgm, playSfx, playVoice } from "@/lib/sketch/sfx";
import {
  addSeen,
  hintOf,
  isCloseAnswer,
  LEVEL_BONUS,
  LEVEL_LABEL,
  loadSeen,
  normalizeAnswer,
  pickChoices,
} from "@/lib/sketch/words";
import {
  backToWaiting,
  CHOOSE_MS,
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
  REVEAL_MS,
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
import { Avatar, Icon, Medal, Mascot, Stamp, Who, type IconName } from "./Art";
import { Confetti, FsButton, nextKey, SoundButton, tap, useStage } from "./stage";

const LEVEL_COLOR = ["#2EC4B6", "#4EA8DE", "#FF6B6B"];
const TURN_MODE_LABEL = { winner: "처음 맞힌 사람이 다음 차례", order: "들어온 순서대로" } as const;

/** 남은 시간(ms) — 250ms마다 갱신 */
function useRemaining(endsAt: number) {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, endsAt - now);
}

/** 남은 시간 원 */
function Timer({ sec, ratio, size = 54 }: { sec: number; ratio: number; size?: number }) {
  const r = 22;
  const len = 2 * Math.PI * r;
  const hurry = sec <= 10;
  const color = sec <= 10 ? "#FF6B6B" : ratio < 0.5 ? "#FF9F43" : "#2EC4B6";
  return (
    <span
      className="sk-timer relative inline-flex shrink-0 items-center justify-center"
      data-hurry={hurry && sec > 0}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 54 54" className="absolute inset-0 -rotate-90">
        <circle cx="27" cy="27" r="24.5" fill="#fff" stroke="#2B2D42" strokeWidth="2.5" />
        <circle className="track" cx="27" cy="27" r={r} fill="none" strokeWidth="5" />
        <circle
          className="bar"
          cx="27"
          cy="27"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={len * (1 - Math.max(0, Math.min(1, ratio)))}
        />
      </svg>
      <span
        className="sk-hand relative leading-none"
        style={{ fontSize: size * 0.44, color: hurry ? "#FF6B6B" : undefined }}
      >
        {sec}
      </span>
    </span>
  );
}

/** 힌트 글자 칸: ○ = 빈칸, 공백 = 띄움, 나머지 = 공개된 글자 */
function HintTiles({ hint, size }: { hint: string; size: number }) {
  return (
    <span
      className="inline-flex flex-wrap items-end justify-center gap-[0.18em]"
      style={{ fontSize: size }}
      aria-label={`힌트 ${hint.replace(/○/g, "_")}`}
    >
      {[...hint].map((ch, i) =>
        ch === " " ? (
          <span key={i} className="sk-tile-gap" />
        ) : (
          <span key={i} className="sk-tile" data-open={ch !== "○"}>
            {ch === "○" ? "" : ch}
          </span>
        )
      )}
    </span>
  );
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
  const { o } = useStage();
  const v = o === "v";
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
  const choices = words?.turnId === state.turnId ? (words.choices ?? []) : [];

  const pick = (w: string, level: number) => {
    playSfx("sfx-pick");
    addSeen(w);
    chooseWord(room, w, hintOf(w, 0), level).catch(() => {});
  };

  // 공개된 정답은 이 브라우저의 '최근 본 단어'에 추가 (다음 게임에서 덜 나오게)
  useEffect(() => {
    if (state.phase === "reveal" && state.reveal) addSeen(state.reveal);
  }, [state.phase, state.reveal]);

  // ── 그리는 사람: 정답 판정 ──
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
      else relayGuess(roomId, g, isCloseAnswer(g.text, word)).catch(() => {});
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
  const kick = (target: string) => {
    if (kickTarget === target) {
      setKickTarget("");
      playSfx("sfx-kick");
      kickPlayer(room, target).catch(() => {});
    } else {
      playSfx("sfx-click");
      setKickTarget(target);
    }
  };

  // 리더: 로비 요약 갱신
  const playerCount = players.length;
  useEffect(() => {
    if (isLeader) syncLobby(roomRef.current);
  }, [isLeader, playerCount, state.phase]);

  // ── 채팅 입력 ──
  const drawingNow = state.phase === "drawing";
  const guessing = drawingNow && !amDrawer && !iCorrect;
  const disabledReason =
    drawingNow && amDrawer
      ? "그리는 중에는 채팅할 수 없어요"
      : drawingNow && iCorrect
        ? "정답! 다른 사람이 맞힐 때까지 기다려요"
        : "";
  const onSend = (text: string) => {
    if (guessing) sendGuess(roomId, { uid, nick, text, turnId: state.turnId }).catch(() => {});
    else sendChat(roomId, uid, nick, text).catch(() => {});
  };
  const inputRef = useRef<HTMLInputElement>(null);

  // ── 초대 링크 (폰은 공유 창, PC 는 복사) ──
  const [toast, setToast] = useState<{ t: string; k: number } | null>(null);
  const say = (t: string) => setToast({ t, k: nextKey() });
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2300);
    return () => clearTimeout(id);
  }, [toast]);
  const invite = async () => {
    const k = await getInvite(roomId);
    const url = `${location.origin}/games/sketch/?room=${roomId}${k ? `&k=${k}` : ""}`;
    if (v && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: `스케치 퀴즈 · ${meta.name}`,
          text: "같이 그림 맞히기 하자! 🎨",
          url,
        });
        return;
      } catch {
        // 공유 창을 닫았거나 안 되면 복사로
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      playSfx("sfx-copy");
      say("초대 링크 복사됨! 친구에게 붙여넣어 보내요");
    } catch {
      playSfx("sfx-error");
      say("복사하지 못했어요. 주소창의 주소를 보내 주세요");
    }
  };

  const ranking = useMemo(
    () =>
      Object.entries(room.scores)
        .map(([u, s]) => ({ uid: u, ...s }))
        .sort((a, b) => b.score - a.score),
    [room.scores]
  );
  const rankOf = useMemo(() => new Map(ranking.map((p, i) => [p.uid, i + 1])), [ranking]);

  const sec = Math.ceil(remaining / 1000);
  const turnsLeft = remainingTurns(room);
  const timeRatio =
    state.phase === "drawing"
      ? remaining / (meta.drawTime * 1000)
      : state.phase === "choosing"
        ? remaining / CHOOSE_MS
        : state.phase === "reveal"
          ? remaining / REVEAL_MS
          : 0;

  // ───────────── 도구 ─────────────
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const apiRef = useRef<CanvasApi | null>(null);
  const pickTool = (t: Tool) => {
    playSfx("sfx-tool");
    setTool(t);
  };
  const pickColor = (c: string) => {
    playSfx("sfx-color");
    setColor(c);
    if (tool === "eraser") setTool("pen");
  };
  const pickWidth = (w: number) => {
    playSfx("sfx-tool");
    setWidth(w);
    if (tool === "fill") setTool("pen");
  };
  const canDraw = amDrawer && state.phase === "drawing";

  // ───────────── 연출: 소리 · 도장 · 색종이 ─────────────
  const [banner, setBanner] = useState<{ s: StampName; k: number } | null>(null);
  const [confetti, setConfetti] = useState(0);
  /** 방금 맞힌 사람 (이름표가 톡 튐) */
  const [flash, setFlash] = useState<string[]>([]);
  useEffect(() => {
    if (!flash.length) return;
    const id = setTimeout(() => setFlash([]), 1500);
    return () => clearTimeout(id);
  }, [flash]);
  useEffect(() => {
    if (!banner) return;
    const id = setTimeout(() => setBanner(null), 1700);
    return () => clearTimeout(id);
  }, [banner]);

  const guessersAll = players.filter((p) => p.uid !== state.drawer);
  const allCorrect =
    guessersAll.length > 0 && guessersAll.every((p) => state.correct?.[p.uid] !== undefined);
  /* eslint-disable react-hooks/set-state-in-effect -- 상태가 바뀐 순간에 맞춰 연출(도장 · 색종이)을 띄움 */
  const prev = useRef<{
    phase: string;
    turnId: string;
    correct: Set<string>;
    players: Set<string>;
    hint: string;
    sec: number;
  } | null>(null);
  useEffect(() => {
    const correctNow = new Set(Object.keys(state.correct ?? {}));
    const playersNow = new Set(Object.keys(room.players));
    const p = prev.current;
    prev.current = {
      phase: state.phase,
      turnId: state.turnId,
      correct: correctNow,
      players: playersNow,
      hint: state.hint,
      sec,
    };
    if (!p) return; // 처음 들어온 순간은 조용히
    const turnChanged = p.phase !== state.phase || p.turnId !== state.turnId;
    if (turnChanged) {
      if (state.phase === "choosing") {
        if (amDrawer) {
          playSfx("jingle-myturn");
          playVoice("myturn");
          setBanner({ s: "myturn", k: nextKey() });
          setTool("pen");
        } else playSfx("sfx-turn");
      } else if (state.phase === "drawing") {
        playSfx("sfx-start");
        playVoice("start");
        setBanner({ s: "ready", k: nextKey() });
      } else if (state.phase === "reveal") {
        const got = correctNow.size;
        if (!state.reveal) playSfx("sfx-leave");
        else {
          playSfx(allCorrect ? "jingle-allcorrect" : got ? "jingle-reveal" : "jingle-fail");
          playVoice(allCorrect ? "allcorrect" : "timeup");
        }
      } else if (state.phase === "ended") {
        const first = ranking[0]?.uid === uid && (ranking[0]?.score ?? 0) > 0;
        playSfx(first ? "jingle-win" : "jingle-end");
        playVoice(first ? "winner" : "end");
        setConfetti(nextKey());
      } else if (state.phase === "waiting" && p.phase === "ended") playSfx("sfx-open");
    } else if (state.phase === "drawing") {
      // 새 정답자
      const fresh = [...correctNow].filter((u) => !p.correct.has(u));
      if (fresh.length) {
        if (fresh.includes(uid)) {
          playSfx("jingle-correct-me");
          playVoice("correct");
          setBanner({ s: "correct", k: nextKey() });
          setConfetti(nextKey());
        } else playSfx("sfx-correct");
        setFlash((f) => [...new Set([...f, ...fresh])]);
      }
      if (state.hint !== p.hint && p.hint && state.hint.length === p.hint.length)
        playSfx("sfx-hint");
    }
    // 들어오고 나감
    const joined = [...playersNow].some((u) => !p.players.has(u));
    const left = [...p.players].some((u) => !playersNow.has(u));
    if (joined) playSfx("sfx-join");
    else if (left) playSfx("sfx-leave");
    // 째깍: 그리는 중 마지막 10초, 고르는 중(그리는 사람만) 마지막 5초
    if (sec !== p.sec && sec > 0 && !turnChanged) {
      if (state.phase === "drawing" && sec <= 10) playSfx(sec <= 3 ? "sfx-tick-last" : "sfx-tick");
      else if (state.phase === "choosing" && amDrawer && sec <= 5) playSfx("sfx-tick");
    }
  }, [
    state.phase,
    state.turnId,
    state.correct,
    state.hint,
    state.reveal,
    room.players,
    sec,
    amDrawer,
    uid,
    allCorrect,
    ranking,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 배경음악: 대기실 = 로비 곡, 게임 중 = 그리기 곡, 끝 = 결과 곡
  const bgm =
    state.phase === "waiting" ? "bgm-lobby" : state.phase === "ended" ? "bgm-result" : "bgm-draw";
  useEffect(() => playBgm(bgm), [bgm]);

  // ───────────── 키보드 ─────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const r = roomRef.current;
      // 제시어 고르기 1 · 2 · 3
      if (r.state.phase === "choosing" && r.state.drawer === uid && /^[123]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (choices[i]) pick(choices[i], words?.levels?.[i] ?? 0);
        return;
      }
      if (canDraw) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
          e.preventDefault();
          apiRef.current?.undo();
          return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key.toLowerCase();
        if (k === "b" || k === "p") pickTool("pen");
        else if (k === "f" || k === "g") pickTool("fill");
        else if (k === "e") pickTool("eraser");
        else if (k === "[" || k === "]") {
          const i = WIDTHS.indexOf(width);
          const n =
            WIDTHS[
              Math.max(0, Math.min(WIDTHS.length - 1, (i < 0 ? 1 : i) + (k === "]" ? 1 : -1)))
            ];
          pickWidth(n);
        }
        return;
      }
      // 아무 글자나 누르면 바로 채팅 · 정답 입력칸으로
      if (
        !disabledReason &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        (e.key.length === 1 || e.key === "Process" || e.key === "Enter")
      )
        inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ───────────── 조각들 ─────────────

  const statusCenter = (big: boolean): ReactNode => {
    if (state.phase === "drawing")
      return amDrawer ? (
        <span className="flex items-center gap-2">
          <span className="rounded-full border-2 border-[var(--ink)] bg-[var(--sun)] px-2 py-0.5 text-[12px] font-extrabold">
            제시어
          </span>
          <span className="sk-hand leading-none" style={{ fontSize: big ? 34 : 26 }}>
            {myWord}
          </span>
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <span
            className="shrink-0 rounded-full border-2 px-2 py-0.5 text-[11px] font-extrabold text-white"
            style={{
              background: LEVEL_COLOR[state.level] ?? LEVEL_COLOR[0],
              borderColor: "var(--ink)",
            }}
          >
            {LEVEL_LABEL[state.level as 0 | 1 | 2] ?? ""}
            {state.level > 0 && ` ×${LEVEL_BONUS[state.level as 0 | 1 | 2]}`}
          </span>
          <HintTiles hint={state.hint} size={big ? 26 : 20} />
          <span className="shrink-0 text-[11px] font-bold text-[var(--ink3)]">
            {[...state.hint].filter((c) => c !== " ").length}글자
          </span>
        </span>
      );
    if (state.phase === "choosing")
      return (
        <span className="sk-hand leading-none" style={{ fontSize: big ? 26 : 20 }}>
          {amDrawer ? (
            "그릴 제시어를 골라요!"
          ) : (
            <>
              <Who name={state.drawerNick} />
              님이 고르는 중…
            </>
          )}
        </span>
      );
    if (state.phase === "reveal")
      return (
        <span className="sk-hand leading-none" style={{ fontSize: big ? 26 : 20 }}>
          정답 공개!
        </span>
      );
    if (state.phase === "ended")
      return (
        <span className="sk-hand leading-none" style={{ fontSize: big ? 28 : 22 }}>
          🏆 게임 끝!
        </span>
      );
    return (
      <span className="sk-hand leading-none" style={{ fontSize: big ? 26 : 20 }}>
        대기실 · {players.length}/{meta.max}명
      </span>
    );
  };

  const turnInfo =
    state.phase === "waiting" || state.phase === "ended" ? null : (
      <span className="text-right text-[11.5px] leading-tight font-bold text-[var(--ink2)]">
        {state.turnNo}번째 그림
        <br />
        <span className="text-[var(--ink3)]">{turnsLeft ? `${turnsLeft}번 남음` : "마지막!"}</span>
      </span>
    );
  const timer =
    state.phase === "drawing" || state.phase === "choosing" ? (
      <Timer sec={sec} ratio={timeRatio} size={v ? 42 : 54} />
    ) : null;

  const iconBtn = (name: IconName, label: string, onClick: () => void, cls = "") => (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`sk-btn sk-btn-icon text-[15px] ${cls}`}
    >
      <Icon name={name} size={18} />
    </button>
  );

  // 참가자 한 명
  const playerCard = (p: (typeof players)[number], compact: boolean) => {
    const sc = room.scores[p.uid]?.score ?? 0;
    const got =
      state.phase === "drawing" || state.phase === "reveal" ? state.correct?.[p.uid] : undefined;
    const drawingThis =
      p.uid === state.drawer && (state.phase === "drawing" || state.phase === "choosing");
    const rank = rankOf.get(p.uid) ?? 0;
    const color = AVATAR_COLOR[avatarOf(p.uid)];
    const flashing = flash.includes(p.uid);
    if (compact)
      return (
        <li
          key={p.uid}
          className={`relative flex w-[58px] shrink-0 flex-col items-center ${flashing ? "sk-pop" : ""}`}
        >
          <button
            type="button"
            disabled={!isLeader || p.uid === uid}
            onClick={() => kick(p.uid)}
            className="relative"
          >
            <Avatar
              idx={avatarOf(p.uid)}
              size={40}
              ring={got !== undefined ? "#2EC4B6" : drawingThis ? "#FFC93C" : undefined}
            />
            {p.uid === leader && <span className="absolute -top-2 -left-1 text-[13px]">👑</span>}
            {drawingThis && <span className="absolute -right-1 -bottom-1 text-[13px]">✏️</span>}
            {got !== undefined && (
              <span className="absolute -right-1.5 -bottom-1 rounded-full border-2 border-[var(--ink)] bg-[var(--mint)] px-1 text-[9px] font-extrabold text-white">
                +{got}
              </span>
            )}
            {kickTarget === p.uid && (
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-[var(--coral)] text-[11px] font-extrabold text-white">
                강퇴?
              </span>
            )}
          </button>
          <span
            className={`mt-0.5 line-clamp-2 w-full text-center text-[10px] leading-tight font-bold break-all ${p.uid === uid ? "text-[var(--coral)]" : ""}`}
          >
            {plainName(p.nick)}
          </span>
          <span className="sk-hand text-[14px] leading-none">{sc}</span>
        </li>
      );
    return (
      <li
        key={p.uid}
        className={`relative flex items-center gap-1.5 rounded-xl border-2 py-1.5 pr-2 pl-1.5 transition-colors ${flashing ? "sk-pop" : ""}`}
        style={{
          borderColor: got !== undefined ? "#2EC4B6" : drawingThis ? "#2B2D42" : "transparent",
          background:
            got !== undefined
              ? "rgba(46,196,182,0.14)"
              : drawingThis
                ? "rgba(255,201,60,0.35)"
                : "rgba(255,255,255,0.7)",
        }}
      >
        <span className="sk-hand w-3 shrink-0 text-center text-[15px] text-[var(--ink3)]">
          {state.phase === "waiting" ? "" : rank}
        </span>
        <span className="relative">
          <Avatar idx={avatarOf(p.uid)} size={34} />
          {p.uid === leader && (
            <span className="absolute -top-2.5 -left-1.5 text-[13px]" title="방장">
              👑
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`line-clamp-2 leading-tight font-extrabold break-all ${plainName(p.nick).length > 6 ? "text-[12px]" : "text-[13.5px]"} ${p.uid === uid ? "underline decoration-2 underline-offset-2" : ""}`}
            style={{ textDecorationColor: color }}
          >
            <Who name={p.nick} />
          </span>
          <span className="flex items-center gap-1 overflow-hidden text-[11px] font-bold whitespace-nowrap text-[var(--ink2)]">
            {drawingThis ? (
              <span className="text-[#B7791F]">
                ✏️ {state.phase === "choosing" ? "고르는 중" : "그리는 중"}
              </span>
            ) : got !== undefined ? (
              <span className="whitespace-nowrap text-[#138a7f]">✓ 정답 +{got}</span>
            ) : p.uid === uid ? (
              <span className="text-[var(--ink3)]">나</span>
            ) : null}
          </span>
        </span>
        <span className="sk-hand shrink-0 text-[19px] leading-none">{sc}</span>
        {isLeader && p.uid !== uid && (
          <button
            type="button"
            title="강퇴"
            onClick={() => kick(p.uid)}
            className={`absolute top-0.5 right-0.5 rounded-md px-0.5 text-[10.5px] leading-none font-extrabold transition-colors ${
              kickTarget === p.uid
                ? "bg-[var(--coral)] px-1 py-0.5 text-white"
                : "text-[var(--ink3)] hover:bg-[#FF6B6B]/15 hover:text-[var(--coral)]"
            }`}
          >
            {kickTarget === p.uid ? "강퇴?" : <Icon name="kick" size={10} />}
          </button>
        )}
      </li>
    );
  };

  // 도구 모음 (그리는 사람)
  const toolbar = (compact: boolean) => (
    <div
      className={`sk-card-soft flex items-center ${compact ? "flex-col gap-2 px-2 py-2" : "gap-3 px-3 py-2"}`}
    >
      <div
        className={
          compact
            ? "grid w-full grid-cols-8 justify-items-center gap-y-1.5"
            : "grid grid-cols-8 gap-1.5"
        }
      >
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`색 ${c}`}
            data-on={color === c && tool !== "eraser"}
            onClick={() => pickColor(c)}
            className="sk-swatch shrink-0"
            style={{ backgroundColor: c, width: compact ? 25 : 22, height: compact ? 25 : 22 }}
          />
        ))}
      </div>
      <div className={`flex items-center ${compact ? "w-full justify-between gap-1" : "gap-3"}`}>
        <div className="flex items-center gap-0.5">
          {WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              aria-label={`굵기 ${w}`}
              onClick={() => pickWidth(w)}
              className={`flex h-9 w-7 cursor-pointer items-center justify-center rounded-lg ${width === w ? "bg-[var(--ink)]/10 ring-2 ring-[var(--ink)]" : "hover:bg-[var(--ink)]/5"}`}
            >
              <span
                className="rounded-full"
                style={{
                  width: Math.max(4, Math.min(24, w * 0.6)),
                  height: Math.max(4, Math.min(24, w * 0.6)),
                  background:
                    tool === "eraser" ? "#9a9db3" : color === "#FFFFFF" ? "#C9CED6" : color,
                }}
              />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {(
            [
              ["pen", "펜", "pen", "B"],
              ["fill", "채우기", "fill", "F"],
              ["eraser", "지우개", "eraser", "E"],
            ] as const
          ).map(([t, label, icon, key]) => (
            <button
              key={t}
              type="button"
              data-on={tool === t}
              onClick={() => pickTool(t)}
              title={`${label} (${key})`}
              className={`sk-tool ${compact ? "h-10 w-10 text-[10.5px]" : "h-12 w-12 text-[13px]"}`}
            >
              <Icon name={icon} size={compact ? 18 : 20} />
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => apiRef.current?.undo()}
            title="되돌리기 (Ctrl+Z)"
            className={`sk-tool ${compact ? "h-10 w-10 text-[10.5px]" : "h-12 w-12 text-[13px]"}`}
          >
            <Icon name="undo" size={compact ? 18 : 20} />
            되돌리기
          </button>
          <ClearButton compact={compact} onClear={() => apiRef.current?.clear()} />
        </div>
      </div>
    </div>
  );

  // 그리는 사람이 아닐 때 도화지 아래 안내
  const guesserBar = (
    <div className="sk-card-soft flex items-center gap-3 px-3 py-2">
      {state.phase === "drawing" || state.phase === "choosing" ? (
        <>
          <Avatar idx={avatarOf(state.drawer)} size={36} ring="#FFC93C" />
          <span className="min-w-0 flex-1 text-[13.5px] font-bold">
            <Who name={state.drawerNick} />
            님이 {state.phase === "choosing" ? "제시어를 고르는 중" : "그리는 중"}
            <span className="block text-[11.5px] font-normal text-[var(--ink2)]">
              {iCorrect
                ? "정답! 👏 다른 사람이 맞히길 기다려요"
                : "아무 글자나 누르면 바로 정답 칸으로 가요 · 몇 번이든 입력 OK"}
            </span>
          </span>
          {state.phase === "drawing" && meta.hints && (
            <span className="shrink-0 rounded-full bg-[var(--ink)]/8 px-2 py-1 text-[11px] font-bold text-[var(--ink2)]">
              💡 힌트 켜짐
            </span>
          )}
        </>
      ) : (
        <>
          <Mascot pose={state.phase === "ended" ? "cheer" : "idle"} size={44} bob={false} />
          <span className="text-[13px] font-bold text-[var(--ink2)]">
            {meta.drawTime}초 · 한 사람당 {meta.rounds}번 · {TURN_MODE_LABEL[meta.turnMode]}
            {meta.hints ? " · 힌트" : ""}
          </span>
        </>
      )}
    </div>
  );

  // ── 도화지 위 안내 ──
  let overlay: ReactNode = null;
  if (state.phase === "waiting") {
    const slots = Array.from({ length: meta.max }, (_, i) => players[i]);
    overlay = (
      <div className="sk-pop flex w-full max-w-[560px] flex-col items-center gap-3 text-center">
        <h3 className="sk-hand leading-none" style={{ fontSize: v ? 26 : 38 }}>
          대기실
        </h3>
        {v ? (
          <p className="text-[13px] font-bold text-[var(--ink2)]">
            {players.length}/{meta.max}명 · {meta.drawTime}초 · 한 사람당 {meta.rounds}번
          </p>
        ) : (
          <div className="flex flex-wrap justify-center gap-1.5">
            {slots.map((p, i) =>
              p ? (
                <span
                  key={p.uid}
                  className="flex w-[54px] flex-col items-center sk-pop"
                  style={{ animationDelay: `${i * 0.04}s` }}
                >
                  <Avatar idx={avatarOf(p.uid)} size={v ? 34 : 46} />
                  <span className="line-clamp-2 w-full text-[10px] leading-tight font-bold break-all">
                    {plainName(p.nick)}
                  </span>
                </span>
              ) : (
                <span key={i} className="flex w-[54px] flex-col items-center">
                  <span
                    className="rounded-full border-2 border-dashed border-[var(--ink3)]"
                    style={{ width: v ? 34 : 46, height: v ? 34 : 46 }}
                  />
                  <span className="text-[10.5px] text-[var(--ink3)]">빈자리</span>
                </span>
              )
            )}
          </div>
        )}
        {!v && (
          <p className="text-[13px] font-bold text-[var(--ink2)]">
            {meta.drawTime}초 · 한 사람당 {meta.rounds}번 · {TURN_MODE_LABEL[meta.turnMode]}
            {meta.hints ? " · 힌트" : ""}
          </p>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={tap(invite)}
            className={`sk-btn sk-btn-sky ${v ? "text-[18px]" : "text-[22px]"}`}
          >
            <Icon name="link" size={18} /> 친구 초대
          </button>
          {isLeader ? (
            <button
              type="button"
              disabled={players.length < 2}
              onClick={() => {
                playSfx("jingle-start");
                startGame(room).catch(() => {});
              }}
              className={`sk-btn sk-btn-coral ${v ? "text-[18px]" : "text-[24px]"}`}
            >
              {players.length < 2 ? "2명부터 시작할 수 있어요" : "▶ 게임 시작!"}
            </button>
          ) : (
            <span className="sk-hand flex items-center gap-1 text-[18px] text-[var(--ink2)]">
              <span className="sk-wiggle inline-block">⏳</span> 방장이 시작하길 기다리는 중
            </span>
          )}
        </div>
      </div>
    );
  } else if (state.phase === "choosing") {
    overlay = isDrawer ? (
      <div className="flex w-full flex-col items-center gap-3 text-center">
        <h3 className="sk-hand leading-none" style={{ fontSize: v ? 24 : 34 }}>
          무엇을 그릴까요?
        </h3>
        <div
          className={`grid w-full gap-2 ${v ? "grid-cols-3" : "max-w-[600px] grid-cols-3 gap-4"}`}
        >
          {choices.map((w, i) => {
            const lv = (words?.levels?.[i] ?? 0) as 0 | 1 | 2;
            return (
              <button
                key={w}
                type="button"
                onClick={() => pick(w, lv)}
                className="sk-btn sk-pop relative flex-col gap-1.5 px-1.5 whitespace-normal"
                style={{
                  animationDelay: `${i * 0.08}s`,
                  rotate: `${[-2, 1, -1][i]}deg`,
                  paddingTop: v ? 10 : 18,
                  paddingBottom: v ? 10 : 18,
                }}
              >
                {!v && (
                  <kbd className="absolute top-1.5 left-2 font-mono text-[11px] text-[var(--ink3)]">
                    {i + 1}
                  </kbd>
                )}
                <span
                  className="rounded-full border-2 border-[var(--ink)] px-2 py-0.5 font-['Nanum_Gothic',sans-serif] text-[11px] font-extrabold text-white"
                  style={{ background: LEVEL_COLOR[lv] }}
                >
                  {LEVEL_LABEL[lv]}
                  {lv > 0 && ` ×${LEVEL_BONUS[lv]}`}
                </span>
                <span className="leading-tight break-keep" style={{ fontSize: v ? 19 : 28 }}>
                  {w}
                </span>
              </button>
            );
          })}
          {choices.length === 0 && (
            <p className="col-span-3 text-[14px] text-[var(--ink2)]">제시어 뽑는 중…</p>
          )}
        </div>
        <p className="text-[12px] font-bold text-[var(--ink3)]">
          {v
            ? `${sec}초 안에 골라요 · 어려울수록 점수 UP`
            : `${sec}초 안에 골라요 · 키보드 1 2 3 · 어려울수록 점수 UP`}
        </p>
      </div>
    ) : (
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex items-end gap-2">
          <Avatar idx={avatarOf(state.drawer)} size={v ? 48 : 72} ring="#FFC93C" />
          <Mascot pose="think" size={v ? 70 : 100} />
        </div>
        <p className="sk-hand leading-tight" style={{ fontSize: v ? 20 : 28 }}>
          <Who name={state.drawerNick} />
          님이 그릴 제시어를 고르는 중…
        </p>
        <p className="text-[12.5px] text-[var(--ink2)]">
          곧 그림이 시작돼요. 떠오르는 대로 마구 입력하세요!
        </p>
      </div>
    );
  } else if (state.phase === "reveal") {
    const got = Object.entries(state.correct ?? {}).sort((a, b) => b[1] - a[1]);
    const stamp: StampName = !state.reveal ? "skip" : allCorrect ? "great" : "timeup";
    overlay = (
      <div className="flex w-full flex-col items-center gap-2 text-center">
        <Stamp name={stamp} size={v ? 0.6 : 0.9} />
        <div className="text-[12px] font-bold text-[var(--ink2)]">정답은</div>
        <div
          className="sk-hand sk-pop leading-none text-[var(--grape)]"
          style={{ fontSize: v ? 36 : 60, animationDelay: "0.2s" }}
        >
          {state.reveal || "(건너뜀)"}
        </div>
        {got.length ? (
          <ul className="mt-1 flex flex-wrap justify-center gap-1.5">
            {got.map(([u, pts], i) => (
              <li
                key={u}
                className="sk-pop flex items-center gap-1 rounded-full border-2 border-[var(--ink)] bg-white py-0.5 pr-2 pl-0.5 text-[12px] font-bold"
                style={{ animationDelay: `${0.3 + i * 0.06}s` }}
              >
                <Avatar idx={avatarOf(u)} size={22} />
                {plainName(room.scores[u]?.nick ?? "?")}
                <span className="text-[#138a7f]">+{pts}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] font-bold text-[var(--ink2)]">
            {state.reveal ? "아무도 못 맞혔어요 😢" : "그리는 사람이 자리를 비웠어요"}
          </p>
        )}
        <p className="text-[11.5px] text-[var(--ink3)]">
          {turnsLeft ? `${sec}초 뒤 다음 그림` : `${sec}초 뒤 최종 결과`}
        </p>
      </div>
    );
  } else if (state.phase === "ended") {
    const top = ranking.slice(0, 3);
    const podium = [top[1], top[0], top[2]];
    overlay = (
      <div className="flex w-full max-w-[560px] flex-col items-center gap-2 text-center">
        <h3 className="sk-hand leading-none" style={{ fontSize: v ? 26 : 38 }}>
          🏆 최종 순위
        </h3>
        <div className="flex items-end justify-center gap-2">
          {podium.map((p, i) => {
            if (!p) return <span key={i} className="w-[84px]" />;
            const rank = (i === 1 ? 1 : i === 0 ? 2 : 3) as 1 | 2 | 3;
            const h = (v ? [40, 58, 28] : [60, 88, 42])[i];
            return (
              <div
                key={p.uid}
                className="sk-pop flex w-[84px] flex-col items-center"
                style={{ animationDelay: `${[0.25, 0.05, 0.4][i]}s` }}
              >
                <Avatar
                  idx={avatarOf(p.uid)}
                  size={rank === 1 ? (v ? 46 : 62) : v ? 36 : 48}
                  ring={rank === 1 ? "#FFC93C" : undefined}
                />
                <span className="mt-0.5 line-clamp-2 w-full text-[11px] leading-tight font-extrabold break-all">
                  {plainName(p.nick)}
                </span>
                <span className="sk-hand text-[18px] leading-none">{p.score}</span>
                <div
                  className="mt-1 flex w-full items-start justify-center rounded-t-lg border-[2.5px] border-b-0 border-[var(--ink)] pt-1"
                  style={{ height: h, background: ["#E9ECF2", "#FFE08A", "#F6C8A0"][i] }}
                >
                  <Medal rank={rank} size={v ? 22 : 28} />
                </div>
              </div>
            );
          })}
        </div>
        {ranking.length > 3 && (
          <ol className="flex flex-wrap justify-center gap-1.5 text-[12px] font-bold">
            {ranking.slice(3).map((p, i) => (
              <li
                key={p.uid}
                className="rounded-full border-2 border-[var(--line)] bg-white px-2 py-0.5"
              >
                {i + 4}. {plainName(p.nick)} <span className="text-[var(--ink2)]">{p.score}</span>
              </li>
            ))}
          </ol>
        )}
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          {isLeader ? (
            <button
              type="button"
              onClick={() => {
                playSfx("sfx-pick");
                backToWaiting(roomId).catch(() => {});
              }}
              className={`sk-btn sk-btn-coral ${v ? "text-[18px]" : "text-[22px]"}`}
            >
              <Icon name="refresh" size={18} /> 한 판 더!
            </button>
          ) : (
            <span className="sk-hand self-center text-[17px] text-[var(--ink2)]">
              방장이 「한 판 더」를 누르면 다시 시작해요
            </span>
          )}
          <button
            type="button"
            onClick={tap(onLeave, "sfx-close")}
            className={`sk-btn ${v ? "text-[18px]" : "text-[22px]"}`}
          >
            로비로
          </button>
        </div>
      </div>
    );
  }

  const canvas = (
    <SketchCanvas
      roomId={roomId}
      turnId={state.turnId}
      canDraw={canDraw}
      tool={tool}
      color={color}
      width={width}
      apiRef={apiRef}
    >
      {overlay && <div className="sk-overlay sk-scroll overflow-y-auto">{overlay}</div>}
      {banner && (
        <div
          key={banner.k}
          className="sk-banner pointer-events-none absolute inset-x-0 top-[30%] z-[8] flex justify-center"
        >
          <Stamp name={banner.s} size={v ? 0.8 : 1.3} />
        </div>
      )}
    </SketchCanvas>
  );

  const leaveBtn = (
    <button
      type="button"
      onClick={tap(onLeave, "sfx-close")}
      className={`sk-btn shrink-0 ${v ? "sk-btn-icon text-[15px]" : "text-[19px]"}`}
      title="나가기"
      aria-label="나가기"
    >
      <Icon name="back" size={18} />
      {!v && "나가기"}
    </button>
  );

  const chat = (
    <SketchChat
      roomId={roomId}
      uid={uid}
      disabledReason={disabledReason}
      guessing={guessing}
      placeholder={guessing ? "정답을 입력하세요! (Enter)" : "채팅 입력 (Enter)"}
      onSend={onSend}
      inputRef={inputRef}
      compact={v}
    />
  );

  const extras = (
    <>
      {confetti > 0 && <Confetti key={confetti} />}
      {toast && (
        <div key={toast.k} className="sk-toast sk-card bottom-5 px-4 py-2 text-[14px] font-bold">
          {toast.t}
        </div>
      )}
    </>
  );

  // ───────────── 세로판 (폰) ─────────────
  if (v)
    return (
      <div className="relative flex h-full flex-col gap-2 px-2 pt-2 pb-2">
        <div className="flex items-center gap-1.5">
          {leaveBtn}
          <div className="flex min-w-0 flex-1 justify-center overflow-hidden">
            {statusCenter(false)}
          </div>
          {timer}
          {iconBtn("link", "친구 초대", tap(invite))}
          <SoundButton />
          <FsButton />
        </div>
        <div className="relative shrink-0">{canvas}</div>
        {canDraw ? toolbar(true) : null}
        <ul className="sk-scroll flex shrink-0 gap-1 overflow-x-auto px-1 pt-2 pb-0.5">
          {players.map((p) => playerCard(p, true))}
        </ul>
        <div className="flex min-h-[110px] flex-1 flex-col">{chat}</div>
        {extras}
      </div>
    );

  // ───────────── 가로판 (PC, 1280×720) ─────────────
  return (
    <div className="relative flex h-full flex-col pt-3 pr-4 pb-3 pl-8">
      {/* 머리 */}
      <div className="flex h-[58px] shrink-0 items-center gap-3">
        {leaveBtn}
        <div className="w-[190px] min-w-0">
          <div className="flex items-center gap-1 truncate text-[15px] font-extrabold">
            {meta.locked && <Icon name="lock" size={14} className="shrink-0 text-[var(--coral)]" />}
            <span className="truncate">{plainName(meta.name)}</span>
          </div>
          <div className="text-[11.5px] font-bold text-[var(--ink3)]">
            {players.length}/{meta.max}명 · {meta.drawTime}초
          </div>
        </div>
        <div className="sk-card-soft flex h-[52px] min-w-0 flex-1 items-center justify-center overflow-hidden px-4">
          {statusCenter(true)}
        </div>
        {turnInfo}
        {timer}
        <button
          type="button"
          onClick={tap(invite)}
          className="sk-btn sk-btn-sky text-[18px]"
          title="초대 링크 복사"
        >
          <Icon name="link" size={17} /> 초대
        </button>
        <SoundButton />
        <FsButton />
      </div>
      {/* 몸통 */}
      <div className="mt-3 flex min-h-0 flex-1 gap-3">
        <div className="flex w-[200px] shrink-0 flex-col gap-2">
          <div className="sk-hand flex items-baseline justify-between px-1 text-[19px] leading-none">
            참가자{" "}
            <span className="text-[14px] text-[var(--ink3)]">
              {state.phase === "waiting" ? "" : "점수"}
            </span>
          </div>
          <ul className="sk-scroll flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
            {players.map((p) => playerCard(p, false))}
          </ul>
        </div>
        <div className="flex w-[712px] shrink-0 flex-col gap-2.5">
          {canvas}
          {canDraw ? toolbar(false) : guesserBar}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">{chat}</div>
      </div>
      {extras}
    </div>
  );
}

/** 전체 지우기 — 한 번 더 눌러야 */
function ClearButton({ compact, onClear }: { compact: boolean; onClear: () => void }) {
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!sure) return;
    const t = setTimeout(() => setSure(false), 2500);
    return () => clearTimeout(t);
  }, [sure]);
  return (
    <button
      type="button"
      onClick={() => {
        if (sure) {
          setSure(false);
          onClear();
        } else {
          playSfx("sfx-click");
          setSure(true);
        }
      }}
      title="전체 지우기"
      data-on={sure}
      className={`sk-tool ${compact ? "h-10 w-10 text-[10.5px]" : "h-12 w-12 text-[13px]"} ${sure ? "!bg-[var(--coral)] !text-white" : ""}`}
    >
      <Icon name="trash" size={compact ? 18 : 20} />
      {sure ? "정말?" : "다 지움"}
    </button>
  );
}
