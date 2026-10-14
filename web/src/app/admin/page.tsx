"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import Overview from "@/components/Admin/Overview";
import Traffic from "@/components/Admin/Traffic";
import Members from "@/components/Admin/Members";
import LiveRooms from "@/components/Admin/LiveRooms";
import InquiryInbox from "@/components/Admin/InquiryInbox";
import PostManager from "@/components/Admin/PostManager";
import DataManager from "@/components/Admin/DataManager";
import DefenseReset from "@/components/Admin/DefenseReset";
import MailSender from "@/components/Admin/MailSender";
import { subscribeInquiries, type Inquiry } from "@/firestore/inquiries";
import { fetchStudyPostsLive, type StudyPost } from "@/firestore/studyPosts";

/*
 * 관리자 화면. 왼쪽(좁은 화면은 위)에서 구역을 고르고 오른쪽에서 그 데이터를 다룸.
 *   한눈에 보기 · 유입 분석 · 회원 · 우편 · 문의함 · 글 · 랭킹 · 방명록 · 방 · 방문자 · 전체 데이터
 * 구역은 주소의 ?tab= 으로 기억. 사이트의 큰 제목·메뉴·푸터는 이 화면에서만 숨김.
 */

const SECTIONS = [
  { key: "overview", label: "한눈에 보기", desc: "지금 사이트에서 일어나는 일" },
  { key: "traffic", label: "유입 분석", desc: "어디서 · 어떤 환경으로 들어왔는지" },
  { key: "members", label: "회원", desc: "별명·꾸밈 바꾸기, 올린 사진 지우기, 회원 지우기" },
  { key: "mail", label: "우편", desc: "회원에게 우편 보내기 (GP 첨부) · 보낸 우편 회수" },
  { key: "inbox", label: "문의함", desc: "소개 페이지에서 들어온 문의" },
  { key: "posts", label: "글", desc: "개인 공부 · 프로젝트 회고" },
  { key: "rankings", label: "랭킹", desc: "게임별 기록 고치기 · 지우기 · 초기화" },
  { key: "guest", label: "방명록", desc: "방명록 메모 고치기 · 지우기" },
  { key: "rooms", label: "방", desc: "지금 열려 있는 방과 남아 있는 대국 방" },
  { key: "visitors", label: "방문자", desc: "누적 · 날짜별 방문자 수" },
  { key: "data", label: "전체 데이터", desc: "모든 컬렉션을 문서 단위로 보기 · 고치기 · 지우기" },
] as const;
type Tab = (typeof SECTIONS)[number]["key"];
const isTab = (v: string | null): v is Tab => SECTIONS.some((t) => t.key === v);

// DataManager 에 넘기는 묶음 (렌더마다 새 배열이 되지 않게 밖에 둠)
const G_RANK = ["랭킹"];
const G_GUEST = ["방명록"];
const G_ROOMS = ["대국 방"];
const G_VISIT = ["방문자"];

const KR = "font-['Nanum_Gothic',sans-serif]";
const action =
  "rounded-full border border-white/15 px-3.5 py-1.5 font-mono text-xs whitespace-nowrap text-white/70 transition-colors hover:border-[#6C63FF]/60 hover:text-white";

const LINKS = [
  { href: "/", label: "사이트 보기" },
  { href: "/admin/write/", label: "글 쓰기" },
  { href: "/study/import/", label: "글 일괄 등록" },
  { href: "https://console.firebase.google.com/project/gunmo-portfolio/authentication/users", label: "Firebase 로그인 설정" },
];

function SubHeading({ children }: { children: ReactNode }) {
  return <h2 className={`mt-10 mb-3 text-sm font-bold text-white/80 first:mt-0 ${KR}`}>{children}</h2>;
}

export default function AdminDashboard() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");

  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [inqLoaded, setInqLoaded] = useState(false);
  const [posts, setPosts] = useState<StudyPost[]>([]);
  const [postsLoaded, setPostsLoaded] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/admin/login/");
  }, [loading, user, router]);

  // 마운트 후 주소에서 구역 읽기
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL 기반 초기값(마운트 1회)
    if (isTab(t)) setTab(t);
  }, []);

  // 좁은 화면의 가로 목록에서 고른 구역이 보이게
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    navRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [tab, user]);

  const go = useCallback(
    (t: string) => {
      if (!isTab(t)) return;
      setTab(t);
      router.replace(t === "overview" ? "/admin/" : `/admin/?tab=${t}`, { scroll: false });
      window.scrollTo({ top: 0 });
    },
    [router]
  );

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

  // 사이트의 큰 제목 · 메뉴 · 푸터 · 떠 있는 메뉴 버튼은 관리자 화면에서 숨기고, 맨 위 줄은 이 화면 폭에 맞춤
  const chrome = (
    <style>
      {"#site-header,#site-nav,#site-footer,[data-quickmenu]{display:none}#site-top{max-width:80rem}"}
    </style>
  );

  if (loading || !user) {
    return (
      <>
        {chrome}
        <p className="pt-40 text-center font-mono text-sm text-white/40">확인 중…</p>
      </>
    );
  }

  const unread = inquiries.filter((i) => !i.read).length;
  const section = SECTIONS.find((s) => s.key === tab)!;

  return (
    <div className="mx-auto max-w-7xl px-4 pt-14 pb-24 sm:px-6 lg:flex lg:gap-10">
      {chrome}

      {/* 구역 고르기: 넓은 화면은 왼쪽 고정, 좁은 화면은 위에 가로로 */}
      <aside className="sticky top-14 z-20 -mx-4 border-b border-white/10 bg-[#121212] px-4 sm:-mx-6 sm:px-6 lg:top-14 lg:mx-0 lg:h-[calc(100dvh-3.5rem)] lg:w-48 lg:shrink-0 lg:border-0 lg:px-0 lg:pt-10 lg:pb-8">
        <div className="lg:flex lg:h-full lg:flex-col">
          <div className="hidden font-mono text-sm text-[#8B84FF] lg:mb-5 lg:block">admin</div>
          <nav
            ref={navRef}
            aria-label="관리 구역"
            className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none] lg:flex-col lg:gap-0.5 lg:overflow-visible lg:py-0"
          >
            {SECTIONS.map((s) => {
              const on = s.key === tab;
              return (
                <button
                  key={s.key}
                  type="button"
                  aria-current={on ? "page" : undefined}
                  onClick={() => go(s.key)}
                  className={`flex shrink-0 cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${KR} ${
                    on ? "bg-white/[0.08] text-white" : "text-white/50 hover:bg-white/[0.04] hover:text-white/85"
                  }`}
                >
                  {s.label}
                  {s.key === "inbox" && unread > 0 && (
                    <span className="rounded-full bg-[#FBBF24] px-1.5 font-mono text-[10px] leading-4 font-bold text-[#121212]">
                      {unread}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="mt-auto hidden flex-col gap-1.5 border-t border-white/10 pt-4 lg:flex">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                target={l.href.startsWith("http") ? "_blank" : undefined}
                className={`px-3 text-xs text-white/45 transition-colors hover:text-white ${KR}`}
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-3 truncate px-3 font-mono text-[11px] text-white/30" title={user.email ?? ""}>
              {user.email}
            </div>
            <button
              type="button"
              onClick={logout}
              className={`cursor-pointer px-3 text-left text-xs text-white/45 transition-colors hover:text-red-300 ${KR}`}
            >
              로그아웃
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 pt-6 lg:pt-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className={`text-2xl font-bold text-white ${KR}`}>{section.label}</h1>
            <p className={`mt-1 text-sm text-white/45 ${KR}`}>{section.desc}</p>
          </div>
          {tab === "posts" && (
            <div className="flex gap-2">
              <Link href="/study/import/" className={action}>
                일괄 등록
              </Link>
              <Link
                href="/admin/write/"
                className="rounded-full bg-[#6C63FF] px-4 py-1.5 font-mono text-xs whitespace-nowrap text-white transition-colors hover:bg-[#5b52f0]"
              >
                글 쓰기
              </Link>
            </div>
          )}
          {tab === "guest" && (
            <Link href="/guest/" className={action}>
              방명록 페이지 열기
            </Link>
          )}
        </div>

        {tab === "overview" && <Overview onGo={go} />}
        {tab === "traffic" && <Traffic />}
        {tab === "members" && <Members />}
        {tab === "mail" && <MailSender />}
        {tab === "inbox" && <InquiryInbox items={inquiries} loaded={inqLoaded} />}
        {tab === "posts" && <PostManager posts={posts} loaded={postsLoaded} onChanged={loadPosts} />}
        {tab === "rankings" && (
          <div>
            <DataManager key="rankings" groups={G_RANK} />
            <SubHeading>픽셀 운빨 디펜스</SubHeading>
            <DefenseReset />
          </div>
        )}
        {tab === "guest" && <DataManager key="guest" groups={G_GUEST} />}
        {tab === "rooms" && (
          <div>
            <SubHeading>지금 열려 있는 방 (스케치 퀴즈 · 픽셀 격투)</SubHeading>
            <LiveRooms />
            <SubHeading>대국 방 (체스 · 장기 · 오목)</SubHeading>
            <DataManager key="rooms" groups={G_ROOMS} />
          </div>
        )}
        {tab === "visitors" && <DataManager key="visitors" groups={G_VISIT} />}
        {tab === "data" && <DataManager key="data" />}

        {/* 좁은 화면: 바로가기 · 로그아웃 */}
        <div className={`mt-14 flex flex-wrap gap-x-5 gap-y-2 border-t border-white/10 pt-5 text-xs text-white/45 lg:hidden ${KR}`}>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} target={l.href.startsWith("http") ? "_blank" : undefined}>
              {l.label}
            </Link>
          ))}
          <button type="button" onClick={logout} className="cursor-pointer">
            로그아웃
          </button>
        </div>
      </main>
    </div>
  );
}
