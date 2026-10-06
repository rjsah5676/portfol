import { makeListPage } from "@/components/Study/postRoute";
import "@/css/Page/study.css";

// 요청 때 서버에서 그림 → 글 목록이 재배포 없이 최신으로 보임
export const dynamic = "force-dynamic";

const route = makeListPage("study");
export const metadata = route.metadata;
export default route.Page;
