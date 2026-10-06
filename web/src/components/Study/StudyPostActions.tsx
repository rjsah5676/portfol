"use client";

import { useRouter } from "next/navigation";
import EditButton from "@/components/Study/EditButton";
import DeleteButton from "@/components/Study/DeleteButton";

// 관리자 로그인 시에만 보이는 수정/삭제 버튼 (각 버튼이 내부에서 useAuth로 체크)
export default function StudyPostActions({
  postId,
  listPath,
}: {
  postId: string;
  listPath: string;
}) {
  const router = useRouter();

  return (
    <div className="mt-12 flex gap-3">
      <EditButton post={{ id: postId }} />
      <DeleteButton
        postId={postId}
        onDeleteSuccess={() => {
          alert("삭제되었습니다. 사이트 반영은 재배포 후 적용됩니다.");
          router.push(listPath);
        }}
      />
    </div>
  );
}
