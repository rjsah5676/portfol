import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocsFromServer,
} from "firebase/firestore";
import { db } from "../firebase";

const COLLECTION = "studyPosts";

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

// 빌드 시(generateStaticParams/페이지/사이트맵)에서 여러 번 불리므로 한 번만 가져오게 메모.
// getDocs는 서버에 못 붙으면 에러 없이 빈 결과(캐시)로 resolve해버려서, CI 네트워크가 한 번 삐끗하면
// 글 0개로 배포될 수 있음 -> getDocsFromServer로 서버 응답이 아니면 throw해서 빌드를 실패시킴.
let allPostsPromise: Promise<StudyPost[]> | null = null;
export function getAllStudyPosts(): Promise<StudyPost[]> {
  allPostsPromise ??= getDocsFromServer(collection(db, COLLECTION)).then((snapshot) =>
    snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }) as StudyPost)
      .sort(
        (a, b) =>
          (parseStudyDate(b.date)?.getTime() ?? 0) - (parseStudyDate(a.date)?.getTime() ?? 0)
      )
  );
  return allPostsPromise;
}

export async function getSectionPosts(section: StudySection): Promise<StudyPost[]> {
  return (await getAllStudyPosts()).filter((p) => sectionOf(p) === section);
}

// 캐시(메모) 없이 항상 서버에서 새로 조회 — 관리자 일괄 작업용
export async function fetchStudyPostsLive(): Promise<StudyPost[]> {
  const snapshot = await getDocsFromServer(collection(db, COLLECTION));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as StudyPost);
}

export async function getStudyPost(id: string): Promise<StudyPost | null> {
  const snapshot = await getDoc(doc(db, COLLECTION, id));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as StudyPost) : null;
}

export async function addStudyPost({
  title,
  content,
  category,
  date,
  section = "study",
}: StudyPostInput): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTION), { title, content, category, date, section });
  return ref.id;
}

export async function updateStudyPost(
  id: string,
  { title, content, category, date, section = "study" }: StudyPostInput
): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), { title, content, category, date, section });
}

// 일괄 등록 페이지에서 기존 글(문서 id = URL 유지)의 작성일·구분만 맞출 때
export async function updateStudyPostMeta(
  id: string,
  meta: { date: string; section: StudySection }
): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), meta);
}

export async function deleteStudyPost(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
}
