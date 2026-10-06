import { makeListPage } from "@/components/Study/postRoute";
import "@/css/Page/study.css";

const route = makeListPage("retro");
export const metadata = route.metadata;
export default route.Page;
