import { redirect } from "next/navigation";

// 예전 주소 → 게임 목록의 ANIME TOWN
export default function Page() {
  redirect("/games/animetown/");
}
