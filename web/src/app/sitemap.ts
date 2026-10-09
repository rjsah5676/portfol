import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";
import { detailProjects } from "@/data/projects";
import { loadFoods } from "@/lib/foodServer";
import { getAllStudyPosts, parseStudyDate, postPath } from "@/firestore/studyPosts";

// 요청 때 만듦 → 새 글이 재배포 없이 사이트맵에 들어감 (글 목록은 서버 캐시를 같이 씀)
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const studyPosts = await getAllStudyPosts();

  const pages: { path: string; priority: number; changeFrequency: "weekly" | "monthly" }[] = [
    { path: "/", priority: 1, changeFrequency: "monthly" },
    { path: "/about/", priority: 0.9, changeFrequency: "monthly" },
    { path: "/portfolio/", priority: 0.9, changeFrequency: "monthly" },
    { path: "/works/", priority: 0.6, changeFrequency: "monthly" },
    { path: "/games/", priority: 0.6, changeFrequency: "monthly" },
    { path: "/tools/", priority: 0.6, changeFrequency: "monthly" },
    { path: "/devtools/", priority: 0.6, changeFrequency: "monthly" },
    { path: "/study/", priority: 0.7, changeFrequency: "weekly" },
    { path: "/retro/", priority: 0.7, changeFrequency: "weekly" },
    { path: "/archive/", priority: 0.5, changeFrequency: "monthly" },
    { path: "/guest/", priority: 0.3, changeFrequency: "weekly" },
    { path: "/games/melongame/", priority: 0.5, changeFrequency: "monthly" },
    { path: "/games/rspeed/", priority: 0.5, changeFrequency: "monthly" },
    { path: "/games/mine/", priority: 0.5, changeFrequency: "monthly" },
    { path: "/games/board/", priority: 0.6, changeFrequency: "monthly" },
    { path: "/games/fight/", priority: 0.5, changeFrequency: "monthly" },
    { path: "/games/rhythm/", priority: 0.5, changeFrequency: "monthly" },
    { path: "/games/sketch/", priority: 0.5, changeFrequency: "monthly" },
    { path: "/games/poker/", priority: 0.5, changeFrequency: "monthly" },
    { path: "/devtools/json/", priority: 0.6, changeFrequency: "monthly" },
    { path: "/devtools/mybatis-log/", priority: 0.6, changeFrequency: "monthly" },
    { path: "/devtools/ddl-to-java/", priority: 0.6, changeFrequency: "monthly" },
    { path: "/devtools/json-to-java/", priority: 0.6, changeFrequency: "monthly" },
    { path: "/devtools/regex/", priority: 0.6, changeFrequency: "monthly" },
    { path: "/tools/ladder/", priority: 0.6, changeFrequency: "monthly" },
    { path: "/tools/roulette/", priority: 0.6, changeFrequency: "monthly" },
    { path: "/tools/calorie/", priority: 0.7, changeFrequency: "monthly" },
    { path: "/privacy/", priority: 0.2, changeFrequency: "monthly" },
  ];

  return [
    ...pages.map((p) => ({
      url: `${SITE_URL}${p.path}`,
      changeFrequency: p.changeFrequency,
      priority: p.priority,
    })),
    ...detailProjects.map((p) => ({
      url: `${SITE_URL}/infoPage/${p.idx}/`,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    ...loadFoods()
      .foods.filter((f) => f.page)
      .map((f) => ({
        url: `${SITE_URL}/tools/calorie/${f.id}/`,
        changeFrequency: "yearly" as const,
        priority: 0.5,
      })),
    ...studyPosts.map((p) => ({
      url: `${SITE_URL}${postPath(p)}`,
      lastModified: parseStudyDate(p.date) ?? undefined,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
