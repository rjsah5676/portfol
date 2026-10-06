import AboutLanding, { type AboutProject } from "@/components/About/AboutLanding";
import type { SiteLink } from "@/components/SiteLinks";
import { allProjects } from "@/data/projects";
import githubIcon from "@/img/Page/info/github.png";
import acmicpcIcon from "@/img/Page/info/acmicpc_small.png";
import meImg from "@/img/Page/info/me.webp";
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

const sites: SiteLink[] = [
  { icon: githubIcon, label: "GitHub", href: "https://github.com/rjsah5676" },
  { icon: acmicpcIcon, label: "BAEKJOON", href: "https://www.acmicpc.net/user/rjsah5676" },
];

export default function AboutPage() {
  return <AboutLanding projects={projects} photo={meImg.src} sites={sites} />;
}
