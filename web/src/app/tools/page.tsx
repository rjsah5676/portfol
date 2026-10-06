import MenuHub from "@/components/Menu/MenuHub";
import { getNavGroup } from "@/data/navMenu";
import { pageMeta } from "@/lib/seo";

const group = getNavGroup("tools");

export const metadata = pageMeta({
  title: "도구",
  description: `${group.desc} ${group.items.map((i) => i.label).join(", ")}`,
  path: "/tools/",
});

export default function Page() {
  return <MenuHub group="tools" />;
}
