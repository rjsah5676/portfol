"use client";

import { useEffect, useRef, useState } from "react";
import SketchRoom from "@/components/Sketch/SketchRoom";
import {
  hasAccess,
  joinRoom,
  leaveRoom,
  subscribeRoom,
  systemChat,
  unlockRoom,
  watchConnection,
  WrongPasswordError,
  type SketchRoom as Room,
} from "@/realtime/sketch";

type Gate = "loading" | "missing" | "password" | "full" | "kicked" | "joining" | "in";

/** 방 입장 전 확인: 존재 여부 → 비번(초대 링크면 생략) → 정원 → 입장 */
export default function SketchRoomGate({
  roomId,
  invite,
  uid,
  nick,
  onExit,
}: {
  roomId: string;
  invite: string | null;
  uid: string;
  nick: string;
  onExit: () => void;
}) {
  const [room, setRoom] = useState<Room | null | undefined>(undefined);
  const [gate, setGate] = useState<Gate>("loading");
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState("");
  const joinedRef = useRef(false);

  useEffect(() => subscribeRoom(roomId, setRoom), [roomId]);

  const tryJoin = async (r: Room) => {
    if (joinedRef.current) return;
    if (r.kicked[uid]) {
      setGate("kicked");
      return;
    }
    if (!r.players[uid] && Object.keys(r.players).length >= r.meta.max) {
      setGate("full");
      return;
    }
    joinedRef.current = true;
    setGate("joining");
    try {
      const wasHere = !!r.players[uid];
      await joinRoom(roomId, uid, nick);
      setGate("in");
      if (!wasHere)
        systemChat(
          roomId,
          r.state.phase === "waiting" || r.state.phase === "ended"
            ? `${nick}님이 들어왔어요.`
            : `${nick}님이 게임 중에 참가했어요. 바로 맞히고, 한 사람당 ${r.meta.rounds}번씩 그릴 차례도 와요.`
        );
    } catch (e) {
      console.error(e);
      joinedRef.current = false;
      setGate(r.meta.locked ? "password" : "missing");
    }
  };

  // 처음 한 번: 접근 권한 확인
  const checkedRef = useRef(false);
  useEffect(() => {
    if (room === undefined || checkedRef.current) return;
    if (room === null) {
      setGate("missing"); // eslint-disable-line react-hooks/set-state-in-effect -- 방 조회 결과 반영
      return;
    }
    checkedRef.current = true;
    (async () => {
      if (room.meta.locked && room.meta.hostUid !== uid && !(await hasAccess(roomId, uid))) {
        if (invite) {
          try {
            await unlockRoom(roomId, uid, { invite });
          } catch {
            setGate("password");
            return;
          }
        } else {
          setGate("password");
          return;
        }
      }
      tryJoin(room);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 방 정보가 처음 도착했을 때 한 번
  }, [room]);

  // 나갈 때(언마운트) 자리 비우기 + 재연결 시 자리 복구
  useEffect(() => {
    if (gate !== "in") return;
    const off = watchConnection(roomId, uid, nick);
    return () => {
      off();
      leaveRoom(roomId, uid, nick).catch(() => {});
    };
  }, [gate, roomId, uid, nick]);

  const submitPw = async () => {
    if (!room) return;
    setPwError("");
    try {
      await unlockRoom(roomId, uid, { password: pw });
      tryJoin(room);
    } catch (e) {
      setPwError(e instanceof WrongPasswordError ? e.message : "입장하지 못했어요.");
    }
  };

  const center = (children: React.ReactNode) => (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-4 px-6 pt-8 pb-24 text-center">
      {children}
    </div>
  );
  const backBtn = (
    <button
      type="button"
      onClick={onExit}
      className="cursor-pointer rounded-full border border-white/15 px-4 py-1.5 font-mono text-xs text-white/60 hover:text-white"
    >
      ← 로비로
    </button>
  );

  if (gate === "kicked" || (gate === "in" && room?.kicked[uid]))
    return center(
      <>
        <p className="font-['Nanum_Gothic',sans-serif] text-white/60">
          방장이 이 방에서 내보냈어요.
        </p>
        {backBtn}
      </>
    );
  if (gate === "in" && room)
    return <SketchRoom room={room} uid={uid} nick={nick} onLeave={onExit} />;
  if (gate === "missing")
    return center(
      <>
        <p className="font-['Nanum_Gothic',sans-serif] text-white/60">방이 없거나 이미 끝났어요.</p>
        {backBtn}
      </>
    );
  if (gate === "full")
    return center(
      <>
        <p className="font-['Nanum_Gothic',sans-serif] text-white/60">방이 가득 찼어요.</p>
        {backBtn}
      </>
    );
  if (gate === "password")
    return center(
      <>
        <div className="font-mono text-sm text-[#8B84FF]">🔒 {room?.meta.name}</div>
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
          <button
            type="button"
            onClick={submitPw}
            className="cursor-pointer rounded-full bg-[#6C63FF] px-5 py-2 font-mono text-sm text-white hover:bg-[#5b52f0]"
          >
            입장
          </button>
        </div>
        {pwError && <p className="font-mono text-xs text-red-300">{pwError}</p>}
        {backBtn}
      </>
    );
  return center(<p className="font-mono text-sm text-white/40">입장 중…</p>);
}
