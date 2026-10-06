import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Faded from "@/components/Faded";
import StudyBrowser from "@/components/Study/StudyBrowser";
import RetroBrowser from "@/components/Study/RetroBrowser";
import StudyPostActions from "@/components/Study/StudyPostActions";
import {
  getSectionPosts,
  parseStudyDate,
  postPath,
  SECTION_META,
  toListItem,
  toPlainText,
  type StudySection,
} from "@/firestore/studyPosts";
import { pageMeta, SITE_URL } from "@/lib/seo";

// /study 와 /retro 가 같은 컬렉션(studyPosts)을 section 필드로 나눠 씀.
// 라우트 파일은 이 팩토리 결과만 export (dynamicParams 같은 세그먼트 설정은 각 파일에 리터럴로)

type Params = { params: Promise<{ id: string }> };

export function makeListPage(section: StudySection) {
  const meta = SECTION_META[section];
  const metadata = pageMeta({ title: meta.label, description: meta.desc, path: `${meta.path}/` });
  async function Page() {
    const posts = (await getSectionPosts(section)).map(toListItem);
    return section === "retro" ? (
      <RetroBrowser posts={posts} />
    ) : (
      <StudyBrowser posts={posts} section={section} />
    );
  }
  return { metadata, Page };
}

export function makePostPage(section: StudySection) {
  const meta = SECTION_META[section];

  async function findPost(id: string) {
    return (await getSectionPosts(section)).find((p) => p.id === id);
  }

  async function generateStaticParams() {
    const posts = await getSectionPosts(section);
    // 정적 export는 빈 배열이면 빌드 에러가 나서, 글이 없을 땐 404용 자리만 하나 만듦
    if (posts.length === 0) return [{ id: "_" }];
    return posts.map((p) => ({ id: p.id }));
  }

  async function generateMetadata({ params }: Params): Promise<Metadata> {
    const { id } = await params;
    const post = await findPost(id);
    if (!post)
      return pageMeta({ title: "글을 찾을 수 없음", path: `${meta.path}/${id}/`, noindex: true });

    const m = pageMeta({
      title: post.title,
      description: toPlainText(post.content) || `${post.category} ${meta.label}`,
      path: postPath(post),
    });
    const published = parseStudyDate(post.date)?.toISOString();
    m.openGraph = {
      ...m.openGraph,
      type: "article",
      ...(published && { publishedTime: published }),
      section: post.category,
    };
    return m;
  }

  async function Page({ params }: Params) {
    const { id } = await params;
    const post = await findPost(id);
    if (!post) notFound();

    const url = `${SITE_URL}${postPath(post)}`;
    const published = parseStudyDate(post.date)?.toISOString();
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title,
      description: toPlainText(post.content),
      articleSection: post.category,
      inLanguage: "ko-KR",
      url,
      mainEntityOfPage: url,
      ...(published && { datePublished: published }),
      author: { "@id": `${SITE_URL}/#person` },
    };

    return (
      <Faded>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <article
          className={`mx-auto max-w-3xl px-6 pt-16 pb-24 ${section === "retro" ? "retro-post" : ""}`}
        >
          <Link
            href={`${meta.path}/?category=${encodeURIComponent(post.category)}`}
            className="mb-6 block w-fit font-mono text-sm text-white/40 transition-colors hover:text-white"
          >
            ← {meta.label} · {post.category}
          </Link>
          {/* 개인 공부(교재, 보라) / 회고(기록, 민트) 구분 배지 */}
          <div
            className={`mb-3 inline-flex rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${
              section === "retro"
                ? "border-[#2dd4bf]/40 bg-[#2dd4bf]/10 text-[#7ff0dd]"
                : "border-[#6C63FF]/40 bg-[#6C63FF]/10 text-[#A9A3FF]"
            }`}
          >
            {section === "retro" ? "RETROSPECTIVE · 회고" : "STUDY NOTE · 개념 정리"}
          </div>
          <h1 className="font-mono text-2xl font-bold text-white sm:text-3xl">{post.title}</h1>
          <div className="mt-3 flex gap-3 font-mono text-xs text-white/40">
            <span className={section === "retro" ? "text-[#2dd4bf]" : "text-[#8B84FF]"}>
              {post.category}
            </span>
            <time dateTime={published}>{post.date}</time>
          </div>
          <div
            dangerouslySetInnerHTML={{ __html: post.content }}
            className="quill-content mt-10 leading-relaxed text-white/80 [word-break:break-word]"
          />
          <StudyPostActions postId={post.id} listPath={`${meta.path}/`} />
        </article>
      </Faded>
    );
  }

  return { generateStaticParams, generateMetadata, Page };
}
