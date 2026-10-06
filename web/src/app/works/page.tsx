import MenuHub from "@/components/Menu/MenuHub";
import { getNavGroup } from "@/data/navMenu";
import { pageMeta } from "@/lib/seo";

const group = getNavGroup("study");

export const metadata = pageMeta({
  title: "공부 · 회고",
  description: `${group.desc} ${group.items.map((i) => i.label).join(", ")}`,
  path: "/works/",
});

export default function Page() {
  return <MenuHub group="study" />;
}
