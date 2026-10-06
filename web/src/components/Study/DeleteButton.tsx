"use client";

import { deleteStudyPost } from "@/firestore/studyPosts";
import { useAuth } from "@/lib/AuthContext";

interface DeleteButtonProps {
  postId: string;
  onDeleteSuccess: () => void;
}

export default function DeleteButton({ postId, onDeleteSuccess }: DeleteButtonProps) {
  const { user } = useAuth();

  if (!user) return null;

  const handleDelete = async () => {
    if (!window.confirm("정말 삭제하시겠습니까?")) return;
    try {
      await deleteStudyPost(postId);
      onDeleteSuccess();
    } catch (err) {
      console.error(err);
      alert("삭제 중 오류 발생");
    }
  };

  return (
    <button
      type="button"
      onClick={handleDelete}
      className="cursor-pointer rounded-full border border-red-500/30 px-4 py-2 font-mono text-sm text-red-400 transition-colors hover:border-red-500/60 hover:text-red-300"
    >
      🗑 글삭제
    </button>
  );
}
