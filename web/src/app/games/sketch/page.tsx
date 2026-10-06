"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Faded from "@/components/Faded";
import SketchLobby from "@/components/Sketch/SketchLobby";
import SketchRoomGate from "@/components/Sketch/SketchRoomGate";
import { useChessUser } from "@/components/Chess/useChessUser";
import { watchServerOffset } from "@/realtime/sketch";
import GameHeader from "@/components/GameHeader";
import { SKETCH_GUIDE } from "@/data/gameGuides";

// 정적 export라 ?room=ID(&k=초대키) 쿼리로 방을 구분
function SketchBody() {
  const router = useRouter();
  const params = useSearchParams();
  const roomId = params.get("room");
  const invite = params.get("k");

  // 닉네임·익명 로그인은 체스와 같은 걸 씀
  const { uid, nick, setNick, nickLoaded, error } = useChessUser();
  const [nickInput, setNickInput] = useState("");

  useEffect(() => watchServerOffset(), []);

  const go = (id: string | null) =>
    router.push(id ? `/games/sketch/?room=${id}` : "/games/sketch/");

  if (error) return <p className="pt-10 text-center font-mono text-sm text-red-400">{error}</p>;
  if (!uid || !nickLoaded)
    return <p className="pt-10 text-center font-mono text-sm text-white/40">접속 중…</p>;

  if (!nick) {
    const submit = () => nickInput.trim() && setNick(nickInput);
    return (
      <Faded>
        <div className="mx-auto flex max-w-sm flex-col items-center gap-4 px-6 pt-8 pb-24 text-center">
          <div className="font-mono text-sm text-[#8B84FF]">🎨 닉네임을 입력해주세요</div>
          <div className="flex w-full gap-2">
            <input
              autoFocus
              maxLength={10}
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
      </Faded>
    );
  }

  if (roomId)
    return (
      <SketchRoomGate
        key={roomId}
        roomId={roomId}
        invite={invite}
        uid={uid}
        nick={nick}
        onExit={() => go(null)}
      />
    );
  return (
    <Faded>
      <SketchLobby uid={uid} nick={nick} onEnter={go} />
    </Faded>
  );
}

function SketchApp() {
  return (
    <>
      <div className="mx-auto max-w-5xl px-3 pt-6 sm:px-6">
        <GameHeader
          icon="🎨"
          title="스케치 퀴즈"
          en="Sketch"
          accent="#F472B6"
          desc="한 명이 그리고 나머지가 맞히는 실시간 그림 퀴즈"
          guide={SKETCH_GUIDE}
          className="mb-0 sm:mb-0"
        />
      </div>
      <SketchBody />
    </>
  );
}

export default function SketchPage() {
  return (
    <Suspense fallback={null}>
      <SketchApp />
    </Suspense>
  );
}
