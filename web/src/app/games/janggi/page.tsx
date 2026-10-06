"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import JanggiAIGame from "@/components/Janggi/JanggiAIGame";
import JanggiLobby from "@/components/Janggi/JanggiLobby";
import JanggiRoomView from "@/components/Janggi/JanggiRoomView";
import { useChessUser } from "@/components/Chess/useChessUser";
import { JANGGI_GUIDE } from "@/data/gameGuides";
import { RankBoard, useAIRankTop } from "@/components/AIRank";
import { janggiOppLabel } from "@/components/Janggi/janggiBots";
import { pointsOf } from "@/lib/aiScore";

const HANGUL_KEY = "janggi:hangul";

/** 온라인 대국: 닉네임 → 로비 / 방 (체스와 같은 흐름) */
function Online({ hangul }: { hangul: boolean }) {
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
    router.push(id ? `/games/janggi/?room=${id}${a ? `&as=${a}` : ""}` : "/games/janggi/");

  if (error) return <p className="pt-12 text-center font-mono text-sm text-red-400">{error}</p>;
  if (!uid || !nickLoaded)
    return <p className="pt-12 text-center font-mono text-sm text-white/40">접속 중…</p>;

  if (!nick || editingNick) {
    const submit = () => {
      if (!nickInput.trim()) return;
      setNick(nickInput);
      setEditingNick(false);
    };
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-4 pt-10 text-center">
        <div className="font-mono text-sm text-[#8B84FF]">닉네임을 입력해주세요</div>
        <div className="flex w-full gap-2">
          <input
            autoFocus
            maxLength={10}
            defaultValue={nick}
            onChange={(e) => setNickInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="min-w-0 flex-1 rounded-full border border-white/10 bg-[#1C1E24] px-4 py-2 text-center text-white focus:border-[#6C63FF]/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={submit}
            className="cursor-pointer rounded-full bg-[#6C63FF] px-5 py-2 font-mono text-sm text-white hover:bg-[#5b52f0]"
          >
            입력
          </button>
        </div>
      </div>
    );
  }

  if (roomId)
    return (
      <JanggiRoomView
        key={roomId}
        roomId={roomId}
        uid={uid}
        nick={nick}
        intent={intent}
        invite={invite}
        onExit={() => go(null)}
        onGoRoom={(id) => go(id)}
        hangul={hangul}
      />
    );
  return (
    <JanggiLobby
      uid={uid}
      nick={nick}
      onChangeNick={() => {
        setNickInput(nick);
        setEditingNick(true);
      }}
      onEnter={go}
    />
  );
}

function JanggiApp() {
  const router = useRouter();
  const params = useSearchParams();
  // 기본은 온라인 대국, ?mode=ai면 AI 대국
  const online = params.get("mode") !== "ai";
  const top = useAIRankTop("janggi_ai_rankings");

  const [hangul, setHangul] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 표시 방식 (마운트 1회)
      setHangul(localStorage.getItem(HANGUL_KEY) === "1");
    } catch {}
  }, []);
  const toggleHangul = () =>
    setHangul((h) => {
      try {
        localStorage.setItem(HANGUL_KEY, h ? "0" : "1");
      } catch {}
      return !h;
    });

  const tab = (on: boolean) =>
    `cursor-pointer rounded-full px-4 py-1.5 font-['Nanum_Gothic',sans-serif] text-sm transition-colors ${
      on ? "bg-[#6C63FF] text-white" : "text-white/55 hover:text-white"
    }`;

  return (
    <div className="mx-auto max-w-5xl px-3 pt-6 pb-24 sm:px-6">
      <GameHeader
        icon="將"
        title="온라인 장기"
        en="Janggi"
        accent="#F08A8F"
        desc="친구와 실시간 대국, 또는 위인 AI와 한 판"
        guide={JANGGI_GUIDE}
        rank={{
          sub: "AI 랭킹전",
          top: top.map((r) => ({
            name: r.name,
            value: pointsOf(r.score).toLocaleString(),
            sub: `vs ${janggiOppLabel(r.opp)}`,
          })),
          render: () => (
            <RankBoard coll="janggi_ai_rankings" oppLabel={janggiOppLabel} bare skip={3} />
          ),
        }}
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-full border border-white/10 bg-[#1C1E24] p-1">
          <button
            type="button"
            className={tab(online)}
            onClick={() => router.push("/games/janggi/")}
          >
            온라인 대국
          </button>
          <button
            type="button"
            className={tab(!online)}
            onClick={() => router.push("/games/janggi/?mode=ai")}
          >
            AI와 두기
          </button>
        </div>
        <button
          type="button"
          onClick={toggleHangul}
          className="cursor-pointer rounded-full border border-white/15 px-3 py-1.5 font-mono text-xs text-white/70 hover:text-white"
          title="기물 글자를 한자/한글로"
        >
          {hangul ? "漢 한자로 보기" : "가 한글로 보기"}
        </button>
      </div>
      {online ? <Online hangul={hangul} /> : <JanggiAIGame hangul={hangul} />}
    </div>
  );
}

export default function JanggiPage() {
  return (
    <Suspense fallback={null}>
      <Faded>
        <JanggiApp />
      </Faded>
    </Suspense>
  );
}
