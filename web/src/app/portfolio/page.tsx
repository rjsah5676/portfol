import Faded from "@/components/Faded";
import Lineup from "@/components/Portfolio/Lineup";
import { allProjects } from "@/data/projects";
import { pageMeta } from "@/lib/seo";
import "@/css/Page/portfolio.css";

export const metadata = pageMeta({
  title: "포트폴리오",
  description: `이건모가 팀으로, 혼자서 만든 프로젝트와 이 사이트의 게임. ${allProjects.map((p) => p.name).join(", ")}`,
  path: "/portfolio/",
});

export default function PortfolioPage() {
  return (
    <Faded>
      <Lineup />
    </Faded>
  );
}
