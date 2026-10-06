import { makePostPage } from "@/components/Study/postRoute";
import "@/css/Page/study.css";

// output: "export"라 빌드 시점에 있는 글만 페이지로 생성됨 (새 글은 재배포 필요)
export const dynamicParams = false;

const route = makePostPage("retro");
export const generateStaticParams = route.generateStaticParams;
export const generateMetadata = route.generateMetadata;
export default route.Page;
