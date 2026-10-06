"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/firebase";
import { useAuth } from "@/lib/AuthContext";
import Faded from "@/components/Faded";
import InquiryInbox from "@/components/Admin/InquiryInbox";
import PostManager from "@/components/Admin/PostManager";
import DataManager from "@/components/Admin/DataManager";
import { subscribeInquiries, type Inquiry } from "@/firestore/inquiries";
import { fetchStudyPostsLive, type StudyPost } from "@/firestore/studyPosts";

type Tab = "inbox" | "posts" | "data" | "links";
const TABS: { key: Tab; label: string }[] = [
  { key: "inbox", label: "문의함" },
  { key: "posts", label: "글 관리" },
  { key: "data", label: "데이터" },
  { key: "links", label: "바로가기" },
];
const isTab = (v: string | null): v is Tab => TABS.some((t) => t.key === v);

const LINKS = [
  { href: "/guest/", label: "방명록 관리", desc: "메모에 마우스를 올리면 ✕로 삭제" },
  { href: "/study/import/", label: "글 일괄 등록", desc: "시드 글 등록 · 작성일 맞춤" },
  { href: "/", label: "사이트 보기", desc: "메인 페이지" },
  {
    href: "https://console.firebase.google.com/project/gunmo-portfolio/overview",
    label: "Firebase 콘솔",
    desc: "규칙 · 인증 · 데이터",
  },
];

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#1C1E24] px-4 py-3.5">
      <div className="font-mono text-[11px] text-white/40">{label}</div>
      <div className={`mt-1 font-mono text-2xl ${accent ? "text-[#A9A3FF]" : "text-white"}`}>
        {value}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("inbox");

  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [inqLoaded, setInqLoaded] = useState(false);
  const [posts, setPosts] = useState<StudyPost[]>([]);
  const [postsLoaded, setPostsLoaded] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/admin/login/");
  }, [loading, user, router]);

  // 정적 export라 useSearchParams 대신 마운트 후 URL에서 탭 읽기
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL 기반 초기값(마운트 1회)
    if (isTab(t)) setTab(t);
  }, []);

  const selectTab = (t: Tab) => {
    setTab(t);
    router.replace(`/admin/?tab=${t}`, { scroll: false });
  };

  useEffect(() => {
    if (!user) return;
    return subscribeInquiries(
      (list) => {
        setInquiries(list);
        setInqLoaded(true);
      },
      (e) => {
        console.error(e);
        setInqLoaded(true);
      }
    );
  }, [user]);

  const loadPosts = useCallback(async () => {
    try {
      setPosts(await fetchStudyPostsLive());
    } catch (e) {
      console.error(e);
    } finally {
      setPostsLoaded(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 로그인 확인 후 1회 조회
    if (user) loadPosts();
  }, [user, loadPosts]);

  if (loading || !user) {
    return <p className="pt-24 text-center font-mono text-sm text-white/40">확인 중…</p>;
  }

  const unread = inquiries.filter((i) => !i.read).length;

  return (
    <Faded>
      <div className="mx-auto max-w-4xl px-4 pt-12 pb-24 sm:px-6">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-mono text-sm text-[#8B84FF]">admin</div>
            <h1 className="mt-1 font-mono text-2xl font-bold text-white">대시보드</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden font-mono text-xs text-white/35 sm:inline">{user.email}</span>
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="cursor-pointer rounded-full border border-white/15 px-4 py-1.5 font-mono text-xs text-white/60 transition-colors hover:border-red-400/60 hover:text-red-300"
            >
              로그아웃
            </button>
          </div>
        </div>

        <div className="mb-8 grid grid-cols-3 gap-2 sm:gap-3">
          <Stat label="안 읽은 문의" value={inqLoaded ? unread : "…"} accent={unread > 0} />
          <Stat label="전체 문의" value={inqLoaded ? inquiries.length : "…"} />
          <Stat label="공부·회고 글" value={postsLoaded ? posts.length : "…"} />
        </div>

        <div className="mb-6 flex gap-1 border-b border-white/10">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => selectTab(t.key)}
              className={`-mb-px cursor-pointer border-b-2 px-4 py-2.5 font-mono text-sm transition-colors ${
                tab === t.key
                  ? "border-[#6C63FF] text-white"
                  : "border-transparent text-white/45 hover:text-white/80"
              }`}
            >
              {t.label}
              {t.key === "inbox" && unread > 0 && (
                <span className="ml-1.5 rounded-full bg-[#6C63FF] px-1.5 py-0.5 text-[10px] text-white">
                  {unread}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === "inbox" && <InquiryInbox items={inquiries} loaded={inqLoaded} />}
        {tab === "posts" && (
          <PostManager posts={posts} loaded={postsLoaded} onChanged={loadPosts} />
        )}
        {tab === "data" && <DataManager />}
        {tab === "links" && (
          <div className="grid gap-2 sm:grid-cols-2">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                target={l.href.startsWith("http") ? "_blank" : undefined}
                className="rounded-xl border border-white/10 bg-[#1C1E24] px-4 py-3.5 transition-colors hover:border-[#6C63FF]/50"
              >
                <div className="font-['Nanum_Gothic',sans-serif] text-sm text-white/90">
                  {l.label} <span className="text-white/30">→</span>
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-white/35">{l.desc}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Faded>
  );
}
