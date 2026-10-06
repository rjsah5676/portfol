import { ApiError } from "@/lib/api/errors";
import { api } from "@/lib/api/http";

// 이 파일은 Next 서버(Node)에서도 실행됨 — Firebase나 소켓 모듈을 여기서 직접 import하지 말 것
// (로그인 토큰이 필요한 쓰기 요청에서만 http.ts가 Firebase를 불러옴)
const BASE = "/api/study-posts";
const pathOf = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export const STUDY_CATEGORIES = [
  "Java",
  "Network",
  "Database",
  "Frontend",
  "Backend",
  "Algorithm",
  "Next/Express",
  "etc",
] as const;

// 글 구분: 개념 정리(개인 공부) / 실제 겪은 일과 배운 점(프로젝트 회고)
// 예전 글엔 section 필드가 없음 -> "study"로 취급
export const STUDY_SECTIONS = ["study", "retro"] as const;
export type StudySection = (typeof STUDY_SECTIONS)[number];
export const SECTION_META: Record<StudySection, { label: string; path: string; desc: string }> = {
  study: {
    label: "개인 공부",
    path: "/study",
    desc: "Java, 네트워크, 데이터베이스, 프론트엔드·백엔드, 알고리즘 등 개념 정리.",
  },
  retro: {
    label: "프로젝트 회고",
    path: "/retro",
    desc: "프로젝트에서 직접 겪은 문제와 해결 과정, 그리고 배운 점.",
  },
};
export const sectionOf = (p: { section?: string }): StudySection =>
  p.section === "retro" ? "retro" : "study";
export const postPath = (p: { id: string; section?: string }) =>
  `${SECTION_META[sectionOf(p)].path}/${p.id}/`;

export interface StudyPostInput {
  title: string;
  content: string;
  category: string;
  date: string;
  section?: StudySection;
}

export interface StudyPost extends StudyPostInput {
  id: string;
}

// 목록/사이드바용 (본문 제외)
export interface StudyPostListItem {
  id: string;
  title: string;
  category: string;
  date: string;
  section: StudySection;
  excerpt: string;
  /** 목록 검색용 본문 평문 (제목·분류 포함, 소문자) */
  searchText: string;
}

// 저장 포맷이 "2025-1-3 9:5" 같은 비정형 문자열이라 정렬/ISO 변환용으로 파싱 (KST 기준)
export function parseStudyDate(date: string): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/.exec(date ?? "");
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0"] = m;
  const pad = (v: string) => v.padStart(2, "0");
  return new Date(`${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00+09:00`);
}

// Quill HTML -> 검색 설명/미리보기용 평문
export function toPlainText(html: string, max = 150): string {
  const text = (html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

export function toListItem(post: StudyPost): StudyPostListItem {
  return {
    id: post.id,
    title: post.title,
    category: post.category,
    date: post.date,
    section: sectionOf(post),
    excerpt: toPlainText(post.content, 120),
    searchText: `${post.title} ${post.category} ${toPlainText(post.content, 4000)}`.toLowerCase(),
  };
}

/** 글이 바뀌면 Next 서버가 받아둔 목록을 비울 때 쓰는 캐시 이름 (app/internal/revalidate) */
export const STUDY_POSTS_TAG = "study-posts";

// 글 목록·글 페이지·사이트맵이 같이 씀. Next 서버에서는 받아온 목록을 잠깐(60초) 다시 쓰고,
// 관리자가 글을 쓰거나 고치면 백엔드가 Next에 알려서 바로 비움 → 다음 요청부터 새 글이 보임.
// (알림 설정이 없어도 60초 안에는 반영됨. 브라우저에서 부르면 캐시 없이 매번 조회)
// 개발 서버(npm run dev)에서는 캐시 없이 매번 새로 읽음.
// 서버에 못 닿으면 api()가 throw → 빈 목록으로 조용히 넘어가지 않고 오류 페이지가 됨.
const POSTS_CACHE = {
  revalidate: process.env.NODE_ENV === "development" ? 0 : 60,
  tags: [STUDY_POSTS_TAG],
};

export async function getAllStudyPosts(): Promise<StudyPost[]> {
  const posts = await api<StudyPost[]>(BASE, { next: POSTS_CACHE });
  return [...posts].sort(
    (a, b) => (parseStudyDate(b.date)?.getTime() ?? 0) - (parseStudyDate(a.date)?.getTime() ?? 0)
  );
}

export async function getSectionPosts(section: StudySection): Promise<StudyPost[]> {
  return (await getAllStudyPosts()).filter((p) => sectionOf(p) === section);
}

// 캐시 없이 항상 새로 조회 — 관리자 일괄 작업용
export async function fetchStudyPostsLive(): Promise<StudyPost[]> {
  return api<StudyPost[]>(BASE);
}

export async function getStudyPost(id: string): Promise<StudyPost | null> {
  try {
    return await api<StudyPost>(pathOf(id));
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

// 글 페이지(서버 렌더링)용: 목록과 같은 캐시 규칙 (60초, 글이 바뀌면 바로 비움)
export async function getStudyPostCached(id: string): Promise<StudyPost | null> {
  try {
    return await api<StudyPost>(pathOf(id), { next: POSTS_CACHE });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function addStudyPost({
  title,
  content,
  category,
  date,
  section = "study",
}: StudyPostInput): Promise<string> {
  const res = await api<{ id: string }>(BASE, {
    method: "POST",
    body: { title, content, category, date, section },
    auth: true,
  });
  return res.id;
}

export async function updateStudyPost(
  id: string,
  { title, content, category, date, section = "study" }: StudyPostInput
): Promise<void> {
  await api(pathOf(id), {
    method: "PUT",
    body: { title, content, category, date, section },
    auth: true,
  });
}

// 일괄 등록 페이지에서 기존 글(문서 id = URL 유지)의 작성일·구분만 맞출 때
export async function updateStudyPostMeta(
  id: string,
  meta: { date: string; section: StudySection }
): Promise<void> {
  await api(pathOf(id), {
    method: "PATCH",
    body: { date: meta.date, section: meta.section },
    auth: true,
  });
}

export async function deleteStudyPost(id: string): Promise<void> {
  await api(pathOf(id), { method: "DELETE", auth: true });
}
