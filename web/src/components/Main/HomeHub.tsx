import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { NAV_GROUPS, getNavGroup, type NavGroup, type NavMenuItem } from "@/data/navMenu";
import { SECTION_META, postPath, type StudySection } from "@/firestore/studyPosts";

/*
 * 메인: 상단 메뉴(study · games · tools · devtools)에 있는 것들을 한 화면에 펼쳐 보여 줌.
 * 메뉴 데이터(data/navMenu)를 그대로 읽으므로 항목을 더하거나 빼면 여기도 같이 바뀜.
 * 구역마다 담긴 것이 달라서 보여 주는 방식도 다름 (위에서부터):
 *   games     화면이 주인공 → 큰 캡처 둘 + 나머지는 작은 캡처
 *   tools     작은 캡처 + 설명 한 줄
 *   devtools  이름과 하는 일 (변환기라 글자로 충분)
 *   study     글이 주인공 → 최근 글 제목
 * 소개(이건모)는 /about 으로 옮김.
 */

const KR = "font-['Nanum_Gothic',sans-serif]";

/** 구역별 강조색 (공유 미리보기 이미지 lib/og/card 와 같은 색) */
const ACCENT: Record<string, string> = {
  study: "#8B84FF",
  games: "#F472B6",
  tools: "#FBBF24",
  devtools: "#38BDF8",
};

export interface HomePost {
  id: string;
  title: string;
  category: string;
  date: string;
  section: StudySection;
}
export type HomePosts = Record<StudySection, { total: number; recent: HomePost[] }>;

// "2025-1-3 9:5" → "25.01.03"
const shortDate = (date: string) => {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(date ?? "");
  return m ? `${m[1].slice(2)}.${m[2].padStart(2, "0")}.${m[3].padStart(2, "0")}` : "";
};

function Section({ group, children }: { group: NavGroup; children: ReactNode }) {
  return (
    <section
      id={group.key}
      className="scroll-mt-32 border-t border-white/10 pt-10 pb-16 sm:pt-12 sm:pb-20"
      style={{ "--accent": ACCENT[group.key] } as CSSProperties}
    >
      <div className="mb-7 flex flex-wrap items-end justify-between gap-x-8 gap-y-2 sm:mb-9">
        <div>
          <h2 className="flex items-baseline gap-3 font-mono text-3xl font-bold text-white sm:text-4xl">
            {group.label}
            <span className="text-base font-medium text-[color:var(--accent)]">{group.items.length}</span>
          </h2>
          <p className={`mt-2 text-sm break-keep text-white/50 ${KR}`}>{group.desc}</p>
          {group.tags && (
            <p className={`mt-1.5 flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs text-[color:var(--accent)] opacity-80 ${KR}`}>
              {group.tags.map((t) => (
                <span key={t} className="whitespace-nowrap">
                  #{t}
                </span>
              ))}
            </p>
          )}
        </div>
        <Link
          href={`${group.href}/`}
          className="shrink-0 font-mono text-sm text-[color:var(--accent)] underline decoration-current/35 underline-offset-4 transition-colors hover:decoration-current"
        >
          {group.label} 전체 보기
        </Link>
      </div>
      {children}
    </section>
  );
}

// ───────── study: 최근 글 ─────────

function StudyColumn({ item, posts }: { item: NavMenuItem; posts?: HomePosts[StudySection] }) {
  return (
    // min-w-0: 긴 글 제목이 칸을 밀어내지 않고 말줄임 되게
    <div className="flex min-w-0 flex-col">
      <Link href={`${item.href}/`} className="group flex items-baseline justify-between gap-4">
        <h3
          className={`text-xl font-bold text-white transition-colors group-hover:text-[color:var(--accent)] ${KR}`}
        >
          {item.label}
        </h3>
        {posts && <span className="font-mono text-xs text-white/35">글 {posts.total}개</span>}
      </Link>
      <p className={`mt-1.5 text-sm break-keep text-white/50 ${KR}`}>{item.desc}</p>

      {posts && posts.recent.length > 0 && (
        <ul className="mt-5 border-t border-white/10">
          {posts.recent.map((p) => (
            <li key={p.id} className="border-b border-white/10">
              <Link
                href={postPath(p)}
                className="group flex items-baseline gap-3 py-3 transition-colors"
              >
                <span className="w-[4.2rem] shrink-0 font-mono text-[11px] text-[color:var(--accent)]/80">
                  {p.category}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate text-[15px] text-white/80 transition-colors group-hover:text-white ${KR}`}
                >
                  {p.title}
                </span>
                <span className="hidden shrink-0 font-mono text-[11px] text-white/30 sm:inline">
                  {shortDate(p.date)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────── games: 화면 캡처 ─────────

function FeaturedGame({ item }: { item: NavMenuItem }) {
  return (
    <Link href={`${item.href}/`} className="group block">
      <div className="aspect-[16/10] overflow-hidden rounded-2xl border border-white/10 transition-colors group-hover:border-[color:var(--accent)]/60">
        <img
          src={item.image.src}
          alt={`${item.label} 화면`}
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
        />
      </div>
      <div className="mt-3.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-mono text-xl font-bold text-white transition-colors group-hover:text-[color:var(--accent)]">
          {item.label}
        </span>
        <span className={`text-[13px] break-keep text-white/50 ${KR}`}>{item.desc}</span>
      </div>
    </Link>
  );
}

function Thumb({ item }: { item: NavMenuItem }) {
  return (
    <Link href={`${item.href}/`} className="group block">
      <div className="aspect-[16/10] overflow-hidden rounded-xl border border-white/10 transition-colors group-hover:border-[color:var(--accent)]/60">
        <img
          src={item.image.src}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover object-top transition-transform duration-700 group-hover:scale-105"
        />
      </div>
      <div
        className={`mt-2.5 text-[15px] font-bold text-white/90 transition-colors group-hover:text-[color:var(--accent)] ${KR}`}
      >
        {item.label}
      </div>
      <p className={`mt-0.5 line-clamp-2 text-xs leading-relaxed break-keep text-white/45 ${KR}`}>
        {item.desc}
      </p>
    </Link>
  );
}

// ───────── tools · devtools: 줄 목록 ─────────

function Row({ item, thumb }: { item: NavMenuItem; thumb: boolean }) {
  return (
    <li className="border-b border-white/10">
      <Link href={`${item.href}/`} className="group flex items-center gap-4 py-3.5">
        {thumb ? (
          <span className="h-[4.5rem] w-[7.2rem] shrink-0 overflow-hidden rounded-lg border border-white/10">
            <img
              src={item.image.src}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-110"
            />
          </span>
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] font-mono text-sm text-white/80 transition-colors group-hover:bg-[color:var(--accent)]/15">
            {item.icon}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-[15px] font-bold text-white/90 transition-colors group-hover:text-[color:var(--accent)] ${
              thumb ? KR : "font-mono font-medium"
            }`}
          >
            {item.label}
          </span>
          <span className={`mt-0.5 block truncate text-xs text-white/45 ${KR}`}>{item.desc}</span>
        </span>
      </Link>
    </li>
  );
}

function RowGroup({ group, thumb }: { group: NavGroup; thumb: boolean }) {
  return (
    <section
      id={group.key}
      className="min-w-0 scroll-mt-32"
      style={{ "--accent": ACCENT[group.key] } as CSSProperties}
    >
      <div className="flex items-end justify-between gap-4">
        <h2 className="flex items-baseline gap-3 font-mono text-3xl font-bold text-white sm:text-4xl">
          {group.label}
          <span className="text-base font-medium text-[color:var(--accent)]">{group.items.length}</span>
        </h2>
        <Link
          href={`${group.href}/`}
          className="shrink-0 font-mono text-sm text-[color:var(--accent)] underline decoration-current/35 underline-offset-4 transition-colors hover:decoration-current"
        >
          전체 보기
        </Link>
      </div>
      <p className={`mt-2 text-sm break-keep text-white/50 ${KR}`}>{group.desc}</p>
      {group.tags && (
        <p className={`mt-1.5 flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs text-[color:var(--accent)] opacity-80 ${KR}`}>
          {group.tags.map((t) => (
            <span key={t} className="whitespace-nowrap">
              #{t}
            </span>
          ))}
        </p>
      )}
      <ul className="mt-6 border-t border-white/10">
        {group.items.map((item) => (
          <Row key={item.href} item={item} thumb={thumb} />
        ))}
      </ul>
    </section>
  );
}

// ───────── 페이지 ─────────

/** 메인에서 보여 주는 순서: 눈으로 보는 것(게임·도구) 먼저, 읽는 것(study)은 맨 아래 */
const ORDER = [...NAV_GROUPS.filter((g) => g.key !== "study"), ...NAV_GROUPS.filter((g) => g.key === "study")];

export default function HomeHub({ posts }: { posts: HomePosts | null }) {
  const study = getNavGroup("study");
  const games = getNavGroup("games");
  const featured = games.items.filter((i) => i.featured);
  const rest = games.items.filter((i) => !i.featured);
  const sectionOfHref = (href: string): StudySection =>
    href === SECTION_META.retro.path ? "retro" : "study";

  return (
    <div className="mx-auto max-w-5xl px-5 pb-10 sm:px-6">
      {/* 한 줄 소개 + 구역으로 바로 가기 */}
      <div className="flex flex-col gap-6 py-10 sm:flex-row sm:items-end sm:justify-between sm:py-12">
        <p className={`max-w-md text-lg leading-relaxed break-keep text-white/80 ${KR}`}>
          공부한 것을 정리하고, 게임과 도구를 만들어 올려 두는 곳입니다.
        </p>
        <nav aria-label="구역 바로 가기" className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-sm">
          {ORDER.map((g) => (
            <a
              key={g.key}
              href={`#${g.key}`}
              className="group flex items-center gap-2 text-white/55 transition-colors hover:text-white"
            >
              <span
                className="h-1.5 w-1.5 rounded-full transition-transform group-hover:scale-150"
                style={{ backgroundColor: ACCENT[g.key] }}
              />
              {g.label}
            </a>
          ))}
        </nav>
      </div>

      <Section group={games}>
        <div className="grid gap-4 sm:grid-cols-2">
          {featured.map((item) => (
            <FeaturedGame key={item.href} item={item} />
          ))}
        </div>
        <div className="mt-9 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">
          {rest.map((item) => (
            <Thumb key={item.href} item={item} />
          ))}
        </div>
      </Section>

      <div className="grid gap-x-12 gap-y-16 border-t border-white/10 pt-10 pb-16 sm:pt-12 sm:pb-20 md:grid-cols-2">
        <RowGroup group={getNavGroup("tools")} thumb />
        <RowGroup group={getNavGroup("devtools")} thumb={false} />
      </div>

      <Section group={study}>
        <div className="grid gap-x-12 gap-y-12 md:grid-cols-2">
          {study.items.map((item) => (
            <StudyColumn key={item.href} item={item} posts={posts?.[sectionOfHref(item.href)]} />
          ))}
        </div>
      </Section>

      {/* 만든 사람 쪽으로 */}
      <div className="flex flex-col gap-5 border-t border-white/10 py-10 sm:flex-row sm:items-center sm:justify-between">
        <p className={`text-sm break-keep text-white/55 ${KR}`}>
          이 사이트를 만든 사람과, 지금까지 만든 것들이 궁금하다면
        </p>
        <div className="flex gap-3 font-mono text-sm">
          <Link
            href="/about/"
            className="rounded-full bg-white px-5 py-2 text-[#121212] transition-transform hover:-translate-y-0.5"
          >
            about
          </Link>
          <Link
            href="/portfolio/"
            className="rounded-full border border-white/15 px-5 py-2 text-white/75 transition-colors hover:border-white/40 hover:text-white"
          >
            portfolio
          </Link>
        </div>
      </div>
    </div>
  );
}
