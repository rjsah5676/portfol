"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "@/firebase";
import { useAuth } from "@/lib/AuthContext";
import { onConnection } from "@/lib/api/socket";
import {
  createRoom,
  joinRoom,
  leaveRoom,
  watchLobby,
  watchRoom,
  type LiveRow,
  type OnlineLobbyRoom,
  type OnlineRoom,
} from "@/realtime/rhythmOnline";
import type { OnlineBoardRow } from "../Stage";

/** 비회원 이름 (다른 온라인 게임과 같은 곳에 저장) */
const NICK_KEY = "chess_nick";

/**
 * 리듬게임 온라인 상태: 로그인(비회원은 익명) · 로비 · 지금 방 · 점수판.
 * active 일 때만 연결·구독함 (혼자 치는 사람에게는 아무 부담 없게).
 * 점수판은 렌더 없이 board(ref)만 바꿈 — 플레이 화면(Stage)이 매 프레임 읽음.
 */
export function useRhythmOnline(active: boolean) {
  const { profile } = useAuth();
  const [uid, setUid] = useState<string | null>(null);
  // 비회원 이름: 처음 렌더에서 바로 읽음 (브라우저에서만 — 온라인 화면은 늘 브라우저에서 열림)
  const [typed, setTyped] = useState(() => {
    try {
      return typeof window === "undefined" ? "" : (localStorage.getItem(NICK_KEY) ?? "");
    } catch {
      return "";
    }
  });
  const [err, setErr] = useState("");
  const [lobby, setLobby] = useState<OnlineLobbyRoom[] | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<OnlineRoom | null>(null);
  const roomRef = useRef<OnlineRoom | null>(null);
  /** 점수판 (Stage 가 읽음) */
  const board = useRef<{ ver: number; rows: OnlineBoardRow[] }>({ ver: 0, rows: [] });
  /** 마지막으로 받은 점수 (방 화면의 관전·대기 점수판용) */
  const [live, setLive] = useState<{ round: number; rows: Record<string, LiveRow> } | null>(null);
  const nick = profile?.nick ?? typed;

  const setNick = useCallback((v: string) => {
    const n = v.trim().slice(0, 10);
    setTyped(n);
    try {
      localStorage.setItem(NICK_KEY, n);
    } catch {}
  }, []);

  // 로그인: 비회원은 익명 로그인 (온라인을 처음 열 때만)
  useEffect(() => {
    if (!active) return;
    return onAuthStateChanged(auth, (u) => {
      if (u) setUid(u.uid);
      else
        signInAnonymously(auth).catch((e) => {
          console.error(e);
          setErr("접속에 실패했어요. 잠시 후 다시 해주세요.");
        });
    });
  }, [active]);

  // 로비 목록 (방에 없을 때만)
  useEffect(() => {
    if (!active || !uid || roomId) return;
    return watchLobby(setLobby);
  }, [active, uid, roomId]);

  const rebuildBoard = useCallback(
    (rows: Record<string, LiveRow>, r: OnlineRoom | null) => {
      if (!r) return;
      // 같은 객체를 고쳐 씀 — 플레이 화면은 처음 받은 객체를 계속 읽음
      board.current.ver++;
      board.current.rows = Object.entries(rows).map(([u, v]) => ({
        uid: u,
        nick: r.players[u]?.nick ?? r.round?.results[u]?.nick ?? "?",
        score: v[0],
        acc: v[2],
        dead: !!v[4],
        done: !!v[5],
        me: u === uid,
      }));
    },
    [uid]
  );

  // 지금 방
  useEffect(() => {
    if (!active || !uid || !roomId) return;
    return watchRoom(roomId, {
      room: (r) => {
        roomRef.current = r;
        setRoom(r);
        if (!r) {
          setRoomId(null);
          setErr("방이 없어졌어요.");
        }
      },
      live: (round, rows) => {
        setLive({ round, rows });
        rebuildBoard(rows, roomRef.current);
      },
    });
  }, [active, uid, roomId, rebuildBoard]);

  // 연결이 끊겼다 붙으면 자리 복구 (서버는 끊긴 소켓의 자리를 비움)
  const joinedRef = useRef<{ id: string; nick: string } | null>(null);
  useEffect(() => {
    if (!active) return;
    let was = true;
    return onConnection((on) => {
      const j = joinedRef.current;
      if (on && !was && j) joinRoom(j.id, j.nick, true).catch(() => {});
      was = on;
    });
  }, [active]);

  const join = useCallback(
    async (id: string) => {
      setErr("");
      try {
        await joinRoom(id, nick);
        joinedRef.current = { id, nick };
        board.current.ver++;
        board.current.rows = [];
        setLive(null);
        setRoomId(id);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "들어가지 못했어요.");
      }
    },
    [nick]
  );
  const create = useCallback(
    async (name: string, max: number) => {
      setErr("");
      try {
        const id = await createRoom(nick, name, max);
        await join(id);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "방을 만들지 못했어요.");
      }
    },
    [nick, join]
  );
  const leave = useCallback(() => {
    const id = joinedRef.current?.id ?? roomId;
    joinedRef.current = null;
    roomRef.current = null;
    setRoom(null);
    setRoomId(null);
    setLive(null);
    if (id) leaveRoom(id).catch(() => {});
  }, [roomId]);

  // 온라인을 닫으면(타이틀로) 방에서 나감
  useEffect(() => {
    if (!active && joinedRef.current) leave();
  }, [active, leave]);
  // 탭을 닫을 때도
  useEffect(() => {
    const off = () => {
      if (joinedRef.current) leaveRoom(joinedRef.current.id).catch(() => {});
    };
    window.addEventListener("pagehide", off);
    return () => window.removeEventListener("pagehide", off);
  }, []);

  return {
    uid,
    nick,
    member: !!profile,
    setNick,
    err,
    setErr,
    lobby,
    roomId,
    room,
    live,
    board,
    join,
    create,
    leave,
  };
}

export type RhythmOnline = ReturnType<typeof useRhythmOnline>;
