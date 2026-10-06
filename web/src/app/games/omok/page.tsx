"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Faded from "@/components/Faded";
import GameHeader from "@/components/GameHeader";
import OmokAIGame from "@/components/Omok/OmokAIGame";
import OmokLobby from "@/components/Omok/OmokLobby";
import OmokRoomView from "@/components/Omok/OmokRoomView";
import { useChessUser } from "@/components/Chess/useChessUser";
import { OMOK_GUIDE } from "@/data/gameGuides";
import { RankBoard, useAIRankTop } from "@/components/AIRank";
import { omokOppLabel } from "@/components/Omok/omokBots";
import { pointsOf } from "@/lib/aiScore";

const NUMBERS_KEY = "omok:numbers";

/** 온라인 대국: 닉네임 → 로비 / 방 (체스·장기와 같은 흐름) */
function Online({ numbers }: { numbers: boolean }) {
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
    router.push(id ? `/games/omok/?room=${id}${a ? `&as=${a}` : ""}` : "/games/omok/");

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
      <OmokRoomView
        key={roomId}
        roomId={roomId}
        uid={uid}
        nick={nick}
        intent={intent}
        invite={invite}
        onExit={() => go(null)}
        onGoRoom={(id) => go(id)}
        numbers={numbers}
      />
    );
  return (
    <OmokLobby
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

function OmokApp() {
  const router = useRouter();
  const params = useSearchParams();
  // 기본은 온라인 대국, ?mode=ai면 AI 대국
  const online = params.get("mode") !== "ai";
  const top = useAIRankTop("omok_ai_rankings");

  const [numbers, setNumbers] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 표시 방식 (마운트 1회)
      setNumbers(localStorage.getItem(NUMBERS_KEY) === "1");
    } catch {}
  }, []);
  const toggleNumbers = () =>
    setNumbers((h) => {
      try {
        localStorage.setItem(NUMBERS_KEY, h ? "0" : "1");
      } catch {}
      return !h;
    });

  const tab = (on: boolean) =>
    `cursor-pointer rounded-full px-4 py-1.5 font-['Nanum_Gothic',sans-serif] text-sm transition-colors ${
      on ? "bg-[#6C63FF] text-white" : "text-white/55 hover:text-white"
    }`;

  return (
    <div className="mx-auto max-w-6xl px-3 pt-6 pb-24 sm:px-6">
      <GameHeader
        icon="⚫"
        title="온라인 오목"
        en="Omok"
        accent="#E9C88A"
        desc="렌주룰 금수까지 그대로, 친구와 실시간 대국 또는 AI와 한 판"
        guide={OMOK_GUIDE}
        rank={{
          sub: "AI 랭킹전",
          top: top.map((r) => ({
            name: r.name,
            value: pointsOf(r.score).toLocaleString(),
            sub: `vs ${omokOppLabel(r.opp)}`,
          })),
          render: () => <RankBoard coll="omok_ai_rankings" oppLabel={omokOppLabel} bare skip={3} />,
        }}
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-full border border-white/10 bg-[#1C1E24] p-1">
          <button type="button" className={tab(online)} onClick={() => router.push("/games/omok/")}>
            온라인 대국
          </button>
          <button
            type="button"
            className={tab(!online)}
            onClick={() => router.push("/games/omok/?mode=ai")}
          >
            AI와 두기
          </button>
        </div>
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
      </div>
      {online ? <Online numbers={numbers} /> : <OmokAIGame numbers={numbers} />}
    </div>
  );
}

export default function OmokPage() {
  return (
    <Suspense fallback={null}>
      <Faded>
        <OmokApp />
      </Faded>
    </Suspense>
  );
}
