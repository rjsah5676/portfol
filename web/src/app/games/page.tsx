import MenuHub from "@/components/Menu/MenuHub";
import { getNavGroup } from "@/data/navMenu";
import { pageMeta } from "@/lib/seo";

const group = getNavGroup("games");

export const metadata = pageMeta({
  title: "게임",
  description: `${group.desc} ${group.items.map((i) => i.label).join(", ")}`,
  path: "/games/",
});

export default function Page() {
  return <MenuHub group="games" />;
}
