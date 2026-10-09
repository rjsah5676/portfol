"use client";

/**
 * 온라인 보드게임: 체스·장기·오목을 한 페이지에서.
 *   /games/board/                    로비 (세 게임 방 한 목록)
 *   /games/board/?g=omok             로비 (오목만 거름)
 *   /games/board/?g=chess&room=ID    대국 방 (as=play|watch, k=초대키)
 *   /games/board/?mode=ai&g=janggi   AI와 두기
 * 예전 주소(/games/chess 등)는 next.config 에서 ?g= 를 붙여 여기로 넘김.
 */
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import { useChessUser } from "@/components/Chess/useChessUser";
import ChessRoomView from "@/components/Chess/ChessRoomView";
import JanggiRoomView from "@/components/Janggi/JanggiRoomView";
import OmokRoomView from "@/components/Omok/OmokRoomView";
import ChessAIGame from "@/components/Chess/ChessAIGame";
import JanggiAIGame from "@/components/Janggi/JanggiAIGame";
import OmokAIGame from "@/components/Omok/OmokAIGame";
import BoardLobby, { GameBadge } from "@/components/Board/BoardLobby";
import { GAMES, GAME_KEYS, boardPath, isGameKey, type GameKey } from "@/components/Board/games";
import { BOARD_GUIDE, CHESS_GUIDE, JANGGI_GUIDE, OMOK_GUIDE } from "@/data/gameGuides";
import { RankBoard, useAIRankTop } from "@/components/AIRank";
import { chessOppLabel } from "@/components/Chess/chessBots";
import { janggiOppLabel } from "@/components/Janggi/janggiBots";
import { omokOppLabel } from "@/components/Omok/omokBots";
import { pointsOf } from "@/lib/aiScore";

const KR = "font-['Nanum_Gothic',sans-serif]";
const GUIDES = { chess: CHESS_GUIDE, janggi: JANGGI_GUIDE, omok: OMOK_GUIDE };
const OPP = { chess: chessOppLabel, janggi: janggiOppLabel, omok: omokOppLabel };
/** 기존 페이지와 같은 저장 키 (장기 한글 기물 · 오목 수 번호) */
const HANGUL_KEY = "janggi:hangul";
const NUMBERS_KEY = "omok:numbers";
const LAST_KEY = "board:last";

function useStoredFlag(key: string) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 표시 방식 (마운트 1회)
      setOn(localStorage.getItem(key) === "1");
    } catch {}
  }, [key]);
  const toggle = () =>
    setOn((v) => {
      try {
        localStorage.setItem(key, v ? "0" : "1");
      } catch {}
      return !v;
    });
  return [on, toggle] as const;
}

function NickForm({ initial, onSubmit }: { initial: string; onSubmit: (n: string) => void }) {
  const [v, setV] = useState(initial);
  const submit = () => v.trim() && onSubmit(v);
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-4 pt-12 pb-24 text-center">
      <div className={`${KR} text-sm text-[#B9B4FF]`}>대국에서 쓸 닉네임을 정해주세요</div>
      <div className="flex w-full gap-2">
        <input
          autoFocus
          maxLength={10}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && submit()}
          className="min-w-0 flex-1 rounded-full border border-white/10 bg-[#1C1E24] px-4 py-2 text-center text-white placeholder:text-white/30 focus:border-[#6C63FF]/50 focus:outline-none"
          placeholder="닉네임 (10자)"
        />
        <button
          type="button"
          onClick={submit}
          className="cursor-pointer rounded-full bg-[#6C63FF] px-5 py-2 font-mono text-sm text-white transition-colors hover:bg-[#5b52f0]"
        >
          입력
        </button>
      </div>
    </div>
  );
}

/** 온라인: 닉네임 → 통합 로비 / 게임별 대국 방 */
function Online({ g, hangul, numbers }: { g: GameKey | null; hangul: boolean; numbers: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const roomId = params.get("room");
  const as = params.get("as");
  const invite = params.get("k");
  const intent: "play" | "watch" | null = as === "play" || as === "watch" ? as : null;
  const { uid, nick, setNick, nickLoaded, error } = useChessUser();
  const [editingNick, setEditingNick] = useState(false);

  const enter = (game: GameKey, id: string, a?: "play" | "watch") => router.push(boardPath(game, { room: id, as: a }));
  const toLobby = (filter: GameKey | null) => router.push(boardPath(filter));

  if (error) return <p className="pt-12 text-center font-mono text-sm text-red-400">{error}</p>;
  if (!uid || !nickLoaded) return <p className="pt-12 text-center font-mono text-sm text-white/40">접속 중…</p>;
  if (!nick || editingNick)
    return (
      <NickForm
        initial={nick}
        onSubmit={(n) => {
          setNick(n);
          setEditingNick(false);
        }}
      />
    );

  if (roomId) {
    const game = g ?? "chess";
    const k = `${game}:${roomId}`;
    const common = {
      roomId,
      uid,
      nick,
      intent,
      invite,
      onExit: () => toLobby(null),
      onGoRoom: (id: string) => enter(game, id),
    };
    return (
      <div className="pt-2">
        {game === "chess" && <ChessRoomView key={k} {...common} />}
        {game === "janggi" && <JanggiRoomView key={k} {...common} hangul={hangul} />}
        {game === "omok" && <OmokRoomView key={k} {...common} numbers={numbers} />}
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl">
      <BoardLobby
        uid={uid}
        nick={nick}
        filter={g}
        onFilter={(f) => router.replace(boardPath(f), { scroll: false })}
        onChangeNick={() => setEditingNick(true)}
        onEnter={enter}
      />
    </div>
  );
}

/** AI: 게임 고르기 카드 + 그 게임 AI 대국 */
function AIPanel({ g, hangul, numbers }: { g: GameKey; hangul: boolean; numbers: boolean }) {
  const router = useRouter();
  return (
    <div className="pt-1 pb-24">
      <div className="mb-5 grid grid-cols-3 gap-2 sm:gap-3">
        {GAME_KEYS.map((k) => {
          const m = GAMES[k];
          const on = k === g;
          return (
            <button
              key={k}
              type="button"
              onClick={() => router.replace(boardPath(k, { mode: "ai" }), { scroll: false })}
              className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors sm:px-4 ${
                on ? "" : "border-white/10 bg-[#1C1E24] hover:border-white/25"
              }`}
              style={on ? { borderColor: m.accent, background: `${m.accent}1a` } : undefined}
            >
              <GameBadge g={k} />
              <span className="min-w-0">
                <span className={`block ${KR} text-sm font-bold ${on ? "text-white" : "text-white/75"}`}>{m.name}</span>
                <span className={`hidden ${KR} text-[11px] text-white/40 sm:block`}>{m.blurb}</span>
              </span>
            </button>
          );
        })}
      </div>
      {g === "chess" && <ChessAIGame key="chess" />}
      {g === "janggi" && <JanggiAIGame key="janggi" hangul={hangul} />}
      {g === "omok" && <OmokAIGame key="omok" numbers={numbers} />}
    </div>
  );
}

function BoardApp() {
  const router = useRouter();
  const params = useSearchParams();
  const ai = params.get("mode") === "ai";
  const gParam = params.get("g");
  const g = isGameKey(gParam) ? gParam : null;
  const inRoom = !!params.get("room");

  // AI 탭에서 게임을 안 골랐으면 마지막으로 고른 게임
  const [last, setLast] = useState<GameKey>("chess");
  useEffect(() => {
    try {
      const v = localStorage.getItem(LAST_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 값 (마운트 1회)
      if (isGameKey(v)) setLast(v);
    } catch {}
  }, []);
  useEffect(() => {
    if (!g) return;
    try {
      localStorage.setItem(LAST_KEY, g);
    } catch {}
  }, [g]);
  const aiGame = g ?? last;

  const [hangul, toggleHangul] = useStoredFlag(HANGUL_KEY);
  const [numbers, toggleNumbers] = useStoredFlag(NUMBERS_KEY);

  // 랭킹: 게임별 탭 (세 게임 1~3위는 미리 받아 둠)
  const tops = { chess: useAIRankTop("chess_ai_rankings"), janggi: useAIRankTop("janggi_ai_rankings"), omok: useAIRankTop("omok_ai_rankings") };
  const [rankG, setRankG] = useState<GameKey | null>(null);
  const rg = rankG ?? (ai ? aiGame : (g ?? "chess"));
  const topOf = (k: GameKey) =>
    tops[k].map((r) => ({
      name: r.name,
      member: r.member,
      avatar: r.avatar,
      value: pointsOf(r.score).toLocaleString(),
      sub: `vs ${OPP[k](r.opp)}`,
    }));

  const shownGame = ai ? aiGame : g;
  const tab = (on: boolean) =>
    `cursor-pointer rounded-full px-4 py-1.5 ${KR} text-sm transition-colors ${on ? "bg-[#6C63FF] text-white" : "text-white/55 hover:text-white"}`;

  return (
    <div className={`mx-auto px-3 pt-6 sm:px-6 ${inRoom || ai ? "max-w-6xl" : "max-w-5xl"}`}>
      <GameHeader
        icon="♟️"
        title="온라인 보드게임"
        en="Board Games"
        accent={shownGame ? GAMES[shownGame].accent : "#8B84FF"}
        desc="체스·장기·오목을 한곳에서 — 실시간 대국·관전, AI와 한 판"
        guide={shownGame ? GUIDES[shownGame] : BOARD_GUIDE}
        rank={{
          sub: `${GAMES[rg].name} AI 랭킹전`,
          top: topOf(rg),
          head: () => (
            <div className="mb-3 flex justify-center gap-1.5">
              {GAME_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setRankG(k)}
                  className={`cursor-pointer rounded-full border px-3 py-1 ${KR} text-xs ${
                    k === rg ? "font-bold text-white" : "border-white/10 text-white/55 hover:text-white"
                  }`}
                  style={k === rg ? { borderColor: GAMES[k].accent, background: `${GAMES[k].accent}26` } : undefined}
                >
                  {GAMES[k].glyph} {GAMES[k].name}
                </button>
              ))}
            </div>
          ),
          render: () => <RankBoard key={rg} coll={GAMES[rg].rankColl} oppLabel={OPP[rg]} bare skip={3} />,
        }}
      />

      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-full border border-white/10 bg-[#1C1E24] p-1">
          <button type="button" className={tab(!ai)} onClick={() => router.push(boardPath(g))}>
            온라인 대국
          </button>
          <button type="button" className={tab(ai)} onClick={() => router.push(boardPath(aiGame, { mode: "ai" }))}>
            AI와 두기
          </button>
        </div>
        {/* 지금 보는 판에 맞는 표시 설정 */}
        {(ai || inRoom) && shownGame === "janggi" && (
          <button
            type="button"
            onClick={toggleHangul}
            className="cursor-pointer rounded-full border border-white/15 px-3 py-1.5 font-mono text-xs text-white/70 hover:text-white"
            title="기물 글자를 한자/한글로"
          >
            {hangul ? "漢 한자로 보기" : "가 한글로 보기"}
          </button>
        )}
        {(ai || inRoom) && shownGame === "omok" && (
          <button
            type="button"
            onClick={toggleNumbers}
            className={`cursor-pointer rounded-full border px-3 py-1.5 font-mono text-xs hover:text-white ${
              numbers ? "border-[#6C63FF]/60 text-white" : "border-white/15 text-white/70"
            }`}
            title="돌 위에 둔 순서 표시"
          >
            {numbers ? "① 수 번호 끄기" : "① 수 번호 보기"}
          </button>
        )}
      </div>

      {ai ? (
        <AIPanel g={aiGame} hangul={hangul} numbers={numbers} />
      ) : (
        <Online g={g} hangul={hangul} numbers={numbers} />
      )}
    </div>
  );
}

export default function BoardPage() {
  return (
    <Suspense fallback={null}>
      <Faded>
        <BoardApp />
      </Faded>
    </Suspense>
  );
}
