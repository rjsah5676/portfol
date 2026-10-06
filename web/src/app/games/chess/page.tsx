"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Faded from "@/components/Faded";
import ChessLobby from "@/components/Chess/ChessLobby";
import ChessRoomView from "@/components/Chess/ChessRoomView";
import { useChessUser } from "@/components/Chess/useChessUser";
import ChessAIGame from "@/components/Chess/ChessAIGame";
import GameHeader from "@/components/GameHeader";
import { CHESS_GUIDE } from "@/data/gameGuides";
import { RankBoard, useAIRankTop } from "@/components/AIRank";
import { chessOppLabel } from "@/components/Chess/chessBots";
import { pointsOf } from "@/lib/aiScore";

// 정적 export라 동적 라우트 대신 ?room=ID 쿼리로 방을 구분 (기본은 로비, ?mode=ai면 AI 대국)
function OnlineChess() {
  const router = useRouter();
  const params = useSearchParams();
  const roomId = params.get("room");
  const as = params.get("as");
  const invite = params.get("k");
  const intent = as === "play" || as === "watch" ? as : null;

  const { uid, nick, setNick, nickLoaded, error } = useChessUser();
  const [editingNick, setEditingNick] = useState(false);
  const [nickInput, setNickInput] = useState("");

  const go = (id: string | null, a?: "play" | "watch") =>
    router.push(id ? `/games/chess/?room=${id}${a ? `&as=${a}` : ""}` : "/games/chess/");

  if (error) return <p className="pt-10 text-center font-mono text-sm text-red-400">{error}</p>;
  if (!uid || !nickLoaded)
    return <p className="pt-10 text-center font-mono text-sm text-white/40">접속 중…</p>;

  if (!nick || editingNick) {
    const submit = () => {
      if (!nickInput.trim()) return;
      setNick(nickInput);
      setEditingNick(false);
    };
    return (
      <Faded>
        <div className="mx-auto flex max-w-sm flex-col items-center gap-4 px-6 pt-10 pb-24 text-center">
          <div className="font-mono text-sm text-[#8B84FF]">♞ 닉네임을 입력해주세요</div>
          <div className="flex w-full gap-2">
            <input
              autoFocus
              maxLength={10}
              defaultValue={nick}
              onChange={(e) => setNickInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="min-w-0 flex-1 rounded-full border border-white/10 bg-[#1C1E24] px-4 py-2 text-center text-white placeholder:text-white/30 focus:border-[#6C63FF]/50 focus:outline-none"
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
      </Faded>
    );
  }

  if (roomId) {
    return (
      <ChessRoomView
        key={roomId}
        roomId={roomId}
        uid={uid}
        nick={nick}
        intent={intent}
        invite={invite}
        onExit={() => go(null)}
        onGoRoom={(id) => go(id)}
      />
    );
  }
  return (
    <Faded>
      <ChessLobby
        uid={uid}
        nick={nick}
        onChangeNick={() => {
          setNickInput(nick);
          setEditingNick(true);
        }}
        onEnter={go}
      />
    </Faded>
  );
}

function ChessApp() {
  const router = useRouter();
  const params = useSearchParams();
  // 기본은 온라인 대국, ?mode=ai면 AI 대국
  const online = params.get("mode") !== "ai";
  const top = useAIRankTop("chess_ai_rankings");
  const tab = (on: boolean) =>
    `cursor-pointer rounded-full px-4 py-1.5 font-['Nanum_Gothic',sans-serif] text-sm transition-colors ${
      on ? "bg-[#6C63FF] text-white" : "text-white/55 hover:text-white"
    }`;
  return (
    <div className="mx-auto max-w-5xl px-3 pt-6 sm:px-6">
      <GameHeader
        icon="♟️"
        title="온라인 체스"
        en="Chess"
        accent="#8B84FF"
        desc="친구와 실시간 대국, 또는 AI와 한 판"
        guide={CHESS_GUIDE}
        rank={{
          sub: "AI 랭킹전",
          top: top.map((r) => ({
            name: r.name,
            value: pointsOf(r.score).toLocaleString(),
            sub: `vs ${chessOppLabel(r.opp)}`,
          })),
          render: () => (
            <RankBoard coll="chess_ai_rankings" oppLabel={chessOppLabel} bare skip={3} />
          ),
        }}
      />
      <div className="flex rounded-full border border-white/10 bg-[#1C1E24] p-1 w-fit">
        <button type="button" className={tab(online)} onClick={() => router.push("/games/chess/")}>
          온라인 대국
        </button>
        <button
          type="button"
          className={tab(!online)}
          onClick={() => router.push("/games/chess/?mode=ai")}
        >
          AI와 두기
        </button>
      </div>
      {online ? (
        <OnlineChess />
      ) : (
        <div className="pt-5 pb-24">
          <ChessAIGame />
        </div>
      )}
    </div>
  );
}

export default function ChessPage() {
  return (
    <Suspense fallback={null}>
      <Faded>
        <ChessApp />
      </Faded>
    </Suspense>
  );
}
