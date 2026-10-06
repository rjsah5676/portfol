import MenuHub from "@/components/Menu/MenuHub";
import { getNavGroup } from "@/data/navMenu";
import { pageMeta } from "@/lib/seo";

const group = getNavGroup("project");

export const metadata = pageMeta({
  title: "프로젝트 · 공부",
  description: `${group.desc} ${group.items.map((i) => i.label).join(", ")}`,
  path: "/works/",
});

export default function Page() {
  return <MenuHub group="project" />;
}
