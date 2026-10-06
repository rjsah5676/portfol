import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";
import { allProjects } from "@/data/projects";
import { loadFoods } from "@/lib/foodServer";
import { getAllStudyPosts, parseStudyDate, postPath } from "@/firestore/studyPosts";

// output: "export"에서는 빌드 시 정적 파일(sitemap.xml)로 생성돼야 함
export const dynamic = "force-static";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const studyPosts = await getAllStudyPosts();

  const pages: { path: string; priority: number; changeFrequency: "weekly" | "monthly" }[] = [
    { path: "/", priority: 1, changeFrequency: "monthly" },
    { path: "/about/", priority: 0.9, changeFrequency: "monthly" },
    { path: "/project/", priority: 0.9, changeFrequency: "monthly" },
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
    { path: "/games/chess/", priority: 0.5, changeFrequency: "monthly" },
    { path: "/games/janggi/", priority: 0.5, changeFrequency: "monthly" },
    { path: "/games/omok/", priority: 0.5, changeFrequency: "monthly" },
    { path: "/games/fight/", priority: 0.5, changeFrequency: "monthly" },
    { path: "/games/rhythm/", priority: 0.5, changeFrequency: "monthly" },
    { path: "/games/sketch/", priority: 0.5, changeFrequency: "monthly" },
    { path: "/devtools/json/", priority: 0.6, changeFrequency: "monthly" },
    { path: "/devtools/mybatis-log/", priority: 0.6, changeFrequency: "monthly" },
    { path: "/devtools/ddl-to-java/", priority: 0.6, changeFrequency: "monthly" },
    { path: "/devtools/json-to-java/", priority: 0.6, changeFrequency: "monthly" },
    { path: "/devtools/regex/", priority: 0.6, changeFrequency: "monthly" },
    { path: "/tools/ladder/", priority: 0.6, changeFrequency: "monthly" },
    { path: "/tools/roulette/", priority: 0.6, changeFrequency: "monthly" },
    { path: "/tools/calorie/", priority: 0.7, changeFrequency: "monthly" },
  ];

  return [
    ...pages.map((p) => ({
      url: `${SITE_URL}${p.path}`,
      changeFrequency: p.changeFrequency,
      priority: p.priority,
    })),
    ...allProjects.map((p) => ({
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
