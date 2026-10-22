"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  GoogleAuthProvider,
  linkWithPopup,
  onIdTokenChanged,
  signInWithCredential,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { auth } from "@/firebase";
import { api } from "@/lib/api/http";

/*
 * 로그인 상태.
 *   비회원  로그인 안 했거나 게임용 익명 로그인 — 이름은 그때그때 직접 적음
 *   회원    Google 로 로그인하고 별명을 정한 사람 — 이름이 필요한 곳에 별명이 자동으로 들어감
 *   관리자  관리자 계정으로 로그인한 회원 (서버가 판단)
 * 로그인 자체는 Firebase Auth, 별명·기록은 백엔드(/api/me)가 가짐.
 */

export interface Profile {
  nick: string;
  /** 관리자가 붙여 준 꾸밈 (없으면 null) */
  badge: string | null;
  createdAt: number;
  /** 방문 횟수 */
  visits: number;
  /** 지금까지 한 게임 수 */
  plays: number;
  /** 직접 올린 프로필 사진 주소 ("/api/avatars/…", 없으면 null → 로그인 계정의 사진) */
  avatar: string | null;
}

interface AuthState {
  /** 관리자로 로그인했을 때만 값이 있음 (글쓰기·삭제 버튼 등 관리자 화면이 쓰는 값) */
  user: User | null;
  /** 로그인 상태를 확인하는 중 */
  loading: boolean;
  /** 익명이 아닌 로그인 계정 (별명을 아직 안 정했을 수도 있음) */
  account: User | null;
  /** 회원 프로필 (별명을 정한 뒤) */
  profile: Profile | null;
  admin: boolean;
  /** 테스터 계정 (서버 TESTER_EMAILS): /admin 에서 「내린 게임」만 들어감 */
  tester: boolean;
  /** Google 로그인 창을 띄움. 창을 그냥 닫으면 아무 일도 없음 */
  login(): Promise<void>;
  logout(): Promise<void>;
  /** 별명 정하기(가입) · 바꾸기. 규칙에 안 맞거나 겹치면 ApiError(message) */
  setNick(nick: string): Promise<void>;
  /** 프로필(방문·게임 수)을 다시 받아옴 */
  refresh(): Promise<void>;
  /** 프로필 사진 올리기 (null 이면 올린 사진을 지움) */
  setAvatar(photo: Blob | null): Promise<void>;
  /** 포인트 (회원만, 아니면 null) — 업적 받기 · 구매 · 환전 뒤에는 setPoints 로 맞춤 */
  points: number | null;
  setPoints(points: number): void;
}

const noop = async () => {};
const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  account: null,
  profile: null,
  admin: false,
  tester: false,
  login: noop,
  logout: noop,
  setNick: noop,
  refresh: noop,
  setAvatar: noop,
  points: null,
  setPoints: () => {},
});

interface Me {
  admin: boolean;
  tester?: boolean;
  profile: Profile | null;
  points?: number | null;
  /** 오늘 첫 접속이라 출석 포인트가 막 들어왔으면 그 양 */
  attended?: number;
}

/** 출석 포인트가 들어왔을 때 (화면 한쪽에 잠깐 알림 — components/Points/PointToast) */
export const POINTS_ATTEND_EVENT = "points:attend";

/** 로그인 창을 닫았거나 겹쳐 띄운 경우 — 오류로 치지 않음 */
const cancelled = (e: unknown) =>
  ["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"].includes(
    (e as { code?: string })?.code ?? ""
  );

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<User | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    // 직전에 확인한 계정 (처음엔 아직 모름)
    let last: string | null = null;
    // 프로필을 못 받아 다시 시도하려고 기다리는 중이면 그 타이머
    let retry: ReturnType<typeof setTimeout> | undefined;
    let reload = () => {};
    // 로그인·로그아웃뿐 아니라 익명 계정이 Google 계정으로 바뀐 것(uid 는 그대로)도 알아야 해서 토큰 기준으로 봄
    const off = onIdTokenChanged(auth, (u) => {
      const member = u && !u.isAnonymous ? u : null;
      const key = member ? member.uid : "";
      if (key === last) return;
      last = key;
      clearTimeout(retry);
      retry = undefined;
      setAccount(member);
      setMe(null);
      if (!member) {
        setLoading(false);
        return;
      }
      setLoading(true);
      // 받아올 때까지 다시 시도 (서버 재시작·잠깐 끊김을 "별명 없음"으로 착각해 별명 정하기 창을 띄우지 않게).
      // 그동안은 확인 중(loading)으로 둠. 1·2·4·8·15초… 간격, 창으로 돌아오거나 인터넷이 다시 붙으면 바로.
      let tries = 0;
      const load = () => {
        clearTimeout(retry);
        retry = undefined;
        api<Me>("/api/me", { auth: true })
          .then((res) => {
            if (!alive || last !== key) return;
            setMe(res);
            setLoading(false);
            if (res.attended) window.dispatchEvent(new CustomEvent(POINTS_ATTEND_EVENT, { detail: res.attended }));
          })
          .catch(() => {
            if (!alive || last !== key) return;
            retry = setTimeout(load, Math.min(15_000, 1000 * 2 ** tries++));
          });
      };
      reload = load;
      load();
    });
    const again = () => {
      if (document.visibilityState === "visible" && retry) reload();
    };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("online", again);
    return () => {
      alive = false;
      clearTimeout(retry);
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("online", again);
      off();
    };
  }, []);

  const login = useCallback(async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      const cur = auth.currentUser;
      if (cur?.isAnonymous) {
        // 게임하던 익명 계정을 그대로 Google 계정으로 올림 → 앉아 있던 자리·남긴 기록이 이어짐
        try {
          await linkWithPopup(cur, provider);
          await cur.getIdToken(true);
          return;
        } catch (e) {
          // 이미 가입한 Google 계정(또는 같은 이메일의 기존 계정)이면 그 계정으로 로그인
          const cred = ["auth/credential-already-in-use", "auth/email-already-in-use"].includes(
            (e as { code?: string })?.code ?? ""
          )
            ? GoogleAuthProvider.credentialFromError(e as never)
            : null;
          if (!cred) throw e;
          await signInWithCredential(auth, cred);
          return;
        }
      }
      await signInWithPopup(auth, provider);
    } catch (e) {
      if (!cancelled(e)) throw e;
    }
  }, []);

  const logout = useCallback(() => signOut(auth), []);

  const setNick = useCallback(async (nick: string) => {
    const res = await api<{ profile: Profile }>("/api/me/nick", {
      method: "PUT",
      auth: true,
      body: { nick },
    });
    setMe((m) => ({ ...m, admin: m?.admin ?? false, profile: res.profile, points: m?.points }));
    // 가입한 날도 출석 포인트 (가입 전엔 회원이 아니라 못 받았음)
    api<Me>("/api/me", { auth: true })
      .then((r) => {
        setMe(r);
        if (r.attended) window.dispatchEvent(new CustomEvent(POINTS_ATTEND_EVENT, { detail: r.attended }));
      })
      .catch(() => {});
  }, []);

  const setAvatar = useCallback(async (photo: Blob | null) => {
    const res = await api<{ profile: Profile | null }>("/api/me/avatar", {
      method: photo ? "PUT" : "DELETE",
      auth: true,
      ...(photo && { blob: photo }),
    });
    setMe((m) => ({ ...m, admin: m?.admin ?? false, profile: res.profile, points: m?.points }));
  }, []);

  const setPoints = useCallback((points: number) => setMe((m) => (m ? { ...m, points } : m)), []);

  const refresh = useCallback(async () => {
    const cur = auth.currentUser;
    if (!cur || cur.isAnonymous) return;
    try {
      const res = await api<Me>("/api/me", { auth: true });
      // 그 사이 로그아웃했거나 계정이 바뀌었으면 버림
      if (auth.currentUser?.uid === cur.uid) setMe(res);
    } catch {}
  }, []);

  const value = useMemo<AuthState>(() => {
    const admin = !!account && !!me?.admin;
    return {
      user: admin ? account : null,
      loading,
      account,
      profile: account ? (me?.profile ?? null) : null,
      admin,
      tester: !!account && !!me?.tester,
      login,
      logout,
      setNick,
      refresh,
      setAvatar,
      points: account && me?.profile ? (me.points ?? 0) : null,
      setPoints,
    };
  }, [account, me, loading, login, logout, setNick, refresh, setAvatar, setPoints]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

/** 회원의 별명 (비회원이면 null) */
export function useNick(): string | null {
  return useContext(AuthContext).profile?.nick ?? null;
}
