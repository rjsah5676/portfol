import AboutLanding, { type AboutProject } from "@/components/About/AboutLanding";
import { allProjects } from "@/data/projects";
import { pageMeta } from "@/lib/seo";
import "@/css/Page/about.css";

export const metadata = pageMeta({
  title: "소개",
  description:
    "레거시부터 새 서비스까지 끝까지 파고들어 완성하는 풀스택 개발자 이건모. 일하는 방식과 지금까지의 궤적을 소개합니다.",
  path: "/about/",
});

// "커머스 핸드메이드 쇼핑몰 [MIMYO]" -> 이름 "MIMYO"
const nameOf = (title: string) => /\[(.+?)\]/.exec(title)?.[1] ?? title;

const projects: AboutProject[] = allProjects.map((p) => ({
  idx: p.idx,
  name: nameOf(p.title),
  desc: p.desc,
  tech: p.tech,
  img: p.imgLink.src,
}));

export default function AboutPage() {
  return <AboutLanding projects={projects} />;
}
