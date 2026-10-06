"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "@/firebase";
import { useAuth } from "@/lib/AuthContext";

const NICK_KEY = "chess_nick";

/**
 * 체스용 사용자 식별.
 * 로그인 안 돼 있으면 익명 로그인 → uid 는 브라우저에 유지되므로
 * 탭을 닫았다 다시 와도 같은 좌석으로 복귀할 수 있음.
 * 회원이면 닉네임을 묻지 않고 별명을 씀 (비회원만 직접 적음).
 */
export function useChessUser() {
  const [uid, setUid] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [nick, setNickState] = useState("");
  const [nickLoaded, setNickLoaded] = useState(false);
  const { profile, loading } = useAuth();
  const router = useRouter();

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
    // 회원의 이름은 별명 하나 → "닉네임 변경"은 내 정보에서
    if (profile) {
      router.push("/me");
      return;
    }
    const n = v.trim().slice(0, 10);
    setNickState(n);
    try {
      localStorage.setItem(NICK_KEY, n);
    } catch {}
  };

  // 로그인 상태를 확인하는 동안에는 닉네임 입력 화면을 띄우지 않음 (회원에게 잠깐 보였다 사라지지 않게)
  return { uid, nick: profile?.nick ?? nick, setNick, nickLoaded: nickLoaded && !loading, error };
}
