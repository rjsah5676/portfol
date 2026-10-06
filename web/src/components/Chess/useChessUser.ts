"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "@/firebase";

const NICK_KEY = "chess_nick";

/**
 * 체스용 사용자 식별.
 * 로그인 안 돼 있으면 익명 로그인 → uid 는 브라우저에 유지되므로
 * 탭을 닫았다 다시 와도 같은 좌석으로 복귀할 수 있음.
 */
export function useChessUser() {
  const [uid, setUid] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [nick, setNickState] = useState("");
  const [nickLoaded, setNickLoaded] = useState(false);

  useEffect(() => {
    try {
      setNickState(localStorage.getItem(NICK_KEY) ?? "");
    } catch {}
    setNickLoaded(true);

    return onAuthStateChanged(auth, (u) => {
      if (u) {
        setUid(u.uid);
        return;
      }
      signInAnonymously(auth).catch((e) => {
        console.error(e);
        setError("접속에 실패했습니다. 잠시 후 다시 시도해주세요.");
      });
    });
  }, []);

  const setNick = (v: string) => {
    const n = v.trim().slice(0, 10);
    setNickState(n);
    try {
      localStorage.setItem(NICK_KEY, n);
    } catch {}
  };

  return { uid, nick, setNick, nickLoaded, error };
}
