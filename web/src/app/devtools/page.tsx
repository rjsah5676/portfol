import MenuHub from "@/components/Menu/MenuHub";
import { getNavGroup } from "@/data/navMenu";
import { pageMeta } from "@/lib/seo";

const group = getNavGroup("devtools");

export const metadata = pageMeta({
  title: "개발 도구",
  description: `${group.desc} ${group.items.map((i) => i.label).join(", ")}`,
  path: "/devtools/",
});

export default function Page() {
  return <MenuHub group="devtools" />;
}
