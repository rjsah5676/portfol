import Faded from "@/components/Faded";
import HomeHub, { type HomePosts } from "@/components/Main/HomeHub";
import meImg from "@/img/Page/info/me.webp";
import { getAllStudyPosts, sectionOf } from "@/firestore/studyPosts";
import { SITE_URL, SITE_NAME } from "@/lib/seo";

// 최근 글을 보여 주므로 요청 때 서버에서 그림 (글 목록은 /study 와 같은 서버 캐시를 씀)
export const dynamic = "force-dynamic";

// 검색엔진용 구조화 데이터 (사람/웹사이트 정보)
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Person",
      "@id": `${SITE_URL}/#person`,
      name: "이건모",
      alternateName: "Gunmo Lee",
      jobTitle: "Fullstack Developer",
      url: SITE_URL,
      image: `${SITE_URL}${meImg.src}`,
      alumniOf: { "@type": "CollegeOrUniversity", name: "아주대학교" },
      knowsAbout: ["React", "Next.js", "TypeScript", "Spring Boot", "Node.js", "MySQL"],
      sameAs: ["https://github.com/rjsah5676", "https://solved.ac/rjsah5676"],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      inLanguage: "ko-KR",
      author: { "@id": `${SITE_URL}/#person` },
    },
  ],
};

/** 구분(개인 공부 · 회고)마다 글 수와 최근 글 몇 개. 글 서버에 못 닿아도 메인은 떠야 하므로 실패하면 null */
async function loadPosts(): Promise<HomePosts | null> {
  try {
    const all = await getAllStudyPosts(); // 최신순
    const pick = (section: "study" | "retro") => {
      const list = all.filter((p) => sectionOf(p) === section);
      return {
        total: list.length,
        recent: list.slice(0, 4).map((p) => ({
          id: p.id,
          title: p.title,
          category: p.category,
          date: p.date,
          section,
        })),
      };
    };
    return { study: pick("study"), retro: pick("retro") };
  } catch {
    return null;
  }
}

export default async function Home() {
  const posts = await loadPosts();
  return (
    <Faded>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <HomeHub posts={posts} />
    </Faded>
  );
}
