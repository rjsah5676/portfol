import { Suspense } from "react";
import StudyWriteForm from "@/components/Study/StudyWriteForm";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({ title: "글쓰기", path: "/admin/write/", noindex: true });

export default function StudyWritePage() {
  return (
    <Suspense fallback={<div className="px-6 py-16 text-center text-white/50">로딩중...</div>}>
      <StudyWriteForm />
    </Suspense>
  );
}
