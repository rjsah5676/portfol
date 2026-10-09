"use client";

import { useEffect, useRef, useState } from "react";
import SketchRoom from "@/components/Sketch/SketchRoom";
import type { MascotPose } from "@/lib/sketch/assets";
import { playSfx } from "@/lib/sketch/sfx";
import { Icon, Mascot } from "./Art";
import { tap } from "./stage";
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
  const [pwTry, setPwTry] = useState(0);
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
      playSfx("sfx-error");
      setPwTry((n) => n + 1);
      setPwError(e instanceof WrongPasswordError ? e.message : "입장하지 못했어요.");
    }
  };

  const center = (pose: MascotPose, children: React.ReactNode) => (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <Mascot pose={pose} size={120} />
      {children}
    </div>
  );
  const backBtn = (
    <button type="button" onClick={tap(onExit, "sfx-close")} className="sk-btn text-[20px]">
      <Icon name="back" size={18} /> 로비로
    </button>
  );
  const msg = (t: string) => <p className="sk-hand text-[24px]">{t}</p>;

  if (gate === "kicked" || (gate === "in" && room?.kicked[uid]))
    return center(
      "sad",
      <>
        {msg("방장이 이 방에서 내보냈어요")}
        {backBtn}
      </>
    );
  if (gate === "in" && room)
    return <SketchRoom room={room} uid={uid} nick={nick} onLeave={onExit} />;
  if (gate === "missing")
    return center(
      "wow",
      <>
        {msg("방이 없거나 이미 끝났어요")}
        {backBtn}
      </>
    );
  if (gate === "full")
    return center(
      "sad",
      <>
        {msg("방이 가득 찼어요")}
        {backBtn}
      </>
    );
  if (gate === "password")
    return center(
      "think",
      <div className="sk-card relative flex w-full max-w-[360px] flex-col gap-3 p-5">
        <span className="sk-tape top" />
        <div className="sk-hand flex items-center justify-center gap-1.5 text-[24px]">
          <Icon name="lock" size={20} className="text-[var(--coral)]" /> {room?.meta.name}
        </div>
        <p className="text-[13px] text-[var(--ink2)]">비밀번호를 입력해 주세요</p>
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitPw()}
          className={`sk-input text-center text-[18px] ${pwError ? "sk-shake" : ""}`}
          key={pwError ? pwTry : 0}
        />
        {pwError && <p className="text-[13px] font-bold text-[var(--coral)]">{pwError}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={tap(onExit, "sfx-close")}
            className="sk-btn sk-btn-ghost flex-1 text-[20px]"
          >
            돌아가기
          </button>
          <button
            type="button"
            onClick={submitPw}
            className="sk-btn sk-btn-coral flex-1 text-[20px]"
          >
            입장
          </button>
        </div>
      </div>
    );
  return center(
    "draw",
    <p className="sk-hand text-[22px] text-[var(--ink2)]">방에 들어가는 중…</p>
  );
}
