"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/firebase";
import { useAuth } from "@/lib/AuthContext";
import Faded from "@/components/Faded";

const input =
  "w-full rounded-lg border border-white/10 bg-[#15171c] px-4 py-2.5 font-['Nanum_Gothic',sans-serif] text-sm text-white placeholder:text-white/30 transition-colors focus:border-[#6C63FF]/60 focus:outline-none";
const primaryBtn =
  "w-full cursor-pointer rounded-full bg-[#6C63FF] px-5 py-2.5 font-mono text-sm text-white transition-colors hover:bg-[#5b52f0] disabled:cursor-not-allowed disabled:opacity-40";

function Card({ children }: { children: React.ReactNode }) {
  return (
    <Faded>
      <div className="mx-auto flex max-w-sm flex-col px-6 pt-20 pb-28">
        <div className="mb-2 font-mono text-sm text-[#8B84FF]">admin</div>
        <div className="rounded-2xl border border-white/10 bg-[#1C1E24] p-6 shadow-[0_20px_40px_-20px_rgba(0,0,0,.8)] sm:p-7">
          {children}
        </div>
      </div>
    </Faded>
  );
}

export default function AdminLoginPage() {
  const router = useRouter();
  const { user, tester, loading, account, login, logout } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 이미 로그인돼 있으면 대시보드로
  useEffect(() => {
    if (!loading && (user || tester)) router.replace("/admin/");
  }, [loading, user, tester, router]);

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      // 아이디만 적으면 테스터 계정 주소로 (예: njontest → njontest@gunmo.my)
      const id = email.trim();
      await signInWithEmailAndPassword(auth, id.includes("@") ? id : `${id}@gunmo.my`, password);
      // 관리자인지는 서버가 확인함 → 확인되면 위의 effect 가 대시보드로 보냄
    } catch (err) {
      console.error(err);
      setError("이메일 또는 비밀번호를 확인해주세요.");
      setSubmitting(false);
    }
  };

  if (loading) {
    return <p className="pt-24 text-center font-mono text-sm text-white/40">확인 중…</p>;
  }

  if (user || tester) {
    return <p className="pt-24 text-center font-mono text-sm text-white/40">대시보드로 이동 중…</p>;
  }

  // 로그인은 했지만 관리자 계정이 아님
  if (account) {
    return (
      <Card>
        <h1 className="font-mono text-lg font-bold text-white">관리자 전용</h1>
        <p className="mt-1 mb-6 font-['Nanum_Gothic',sans-serif] text-xs leading-relaxed text-white/40">
          지금 로그인한 계정은 관리자가 아니에요.
        </p>
        <button type="button" onClick={logout} className={primaryBtn}>
          로그아웃
        </button>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="font-mono text-lg font-bold text-white">관리자 로그인</h1>
      <p className="mt-1 mb-6 font-['Nanum_Gothic',sans-serif] text-xs text-white/40">
        글 작성·방명록 관리는 관리자만 할 수 있어요.
      </p>
      {/* 관리자 Google 계정으로 로그인하면 바로 관리자 (상단의 로그인 버튼과 같은 동작) */}
      <button
        type="button"
        onClick={() => login().catch(() => setError("로그인하지 못했어요. 다시 시도해주세요."))}
        className={`${primaryBtn} mb-5`}
      >
        Google 계정으로 로그인
      </button>
      <form onSubmit={handleLogin} className="flex flex-col gap-3">
        <input
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          placeholder="이메일 또는 아이디"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={input}
        />
        <input
          type="password"
          autoComplete="current-password"
          placeholder="비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={input}
        />
        {error && <p className="font-mono text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !email || !password}
          className={`${primaryBtn} mt-2`}
        >
          {submitting ? "로그인 중…" : "로그인"}
        </button>
      </form>
    </Card>
  );
}
