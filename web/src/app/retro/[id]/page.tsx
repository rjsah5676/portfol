import { makePostPage } from "@/components/Study/postRoute";
import "@/css/Page/study.css";

// 요청 때 서버에서 그림 → 새로 쓴 글도 재배포 없이 바로 열림 (없는 글은 404)
export const dynamic = "force-dynamic";

const route = makePostPage("retro");
export const generateMetadata = route.generateMetadata;
export default route.Page;
