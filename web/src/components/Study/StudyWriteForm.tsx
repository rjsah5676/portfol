"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import {
  getStudyPost,
  addStudyPost,
  updateStudyPost,
  STUDY_CATEGORIES,
  STUDY_SECTIONS,
  SECTION_META,
  sectionOf,
  type StudySection,
} from "@/firestore/studyPosts";
import { useAuth } from "@/lib/AuthContext";
import "react-quill-new/dist/quill.snow.css";

// react-quill(-new)은 내부적으로 document를 직접 참조해서 SSR/정적 export 빌드 중에
// 실행되면 안 됨 -> ssr:false로 클라이언트에서만 로드
const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });

const categories = STUDY_CATEGORIES;

export default function StudyWriteForm() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const searchParams = useSearchParams();
  const postId = searchParams.get("id");
  const isEdit = !!postId;

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Java");
  const [section, setSection] = useState<StudySection>("study");
  const [content, setContent] = useState("");

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/admin/login/");
    }
  }, [loading, user, router]);

  useEffect(() => {
    const fetchPost = async () => {
      if (postId) {
        try {
          const post = await getStudyPost(postId);
          if (post) {
            setTitle(post.title);
            setCategory(post.category);
            setSection(sectionOf(post));
            setContent(post.content);
          } else {
            alert("글을 찾을 수 없습니다.");
            router.replace("/admin/?tab=posts");
          }
        } catch (err) {
          console.error(err);
        }
      }
    };

    fetchPost();
  }, [postId, router]);

  const submitPost = async () => {
    if (title === "" || content === "") {
      alert("제목과 내용을 모두 입력해주세요.");
      return;
    }

    const now = new Date();
    const formattedDate = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()} ${now.getHours()}:${now.getMinutes()}`;

    try {
      if (isEdit) {
        await updateStudyPost(postId!, { title, content, category, section, date: formattedDate });
        alert("글이 수정되었습니다! 사이트 반영은 재배포 후 적용됩니다.");
      } else {
        await addStudyPost({ title, content, category, section, date: formattedDate });
        alert("글이 저장되었습니다! 사이트 반영은 재배포 후 적용됩니다.");
      }

      router.push("/admin/?tab=posts");
    } catch (err) {
      console.error(err);
      alert("저장 중 오류 발생");
    }
  };

  if (loading || !user) {
    return <div className="px-6 py-16 text-center text-white/50">확인 중...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-6 pt-16 pb-24">
      <h2 className="mb-8 font-mono text-xl font-bold text-white sm:text-2xl">
        {isEdit ? "✏️ 글 수정" : "✏️ 글쓰기"}
      </h2>

      <input
        type="text"
        placeholder="제목을 입력하세요"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="mb-4 w-full rounded-lg border border-white/10 bg-[#1C1E24] px-4 py-2.5 text-white placeholder:text-white/30 focus:border-[#6C63FF]/50 focus:outline-none"
      />

      <div className="mb-4 flex gap-1.5">
        {STUDY_SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSection(s)}
            className={`cursor-pointer rounded-full border px-4 py-1.5 font-mono text-sm transition-colors ${
              section === s
                ? "border-[#6C63FF] bg-[#6C63FF]/15 text-white"
                : "border-white/10 text-white/50 hover:text-white/80"
            }`}
          >
            {SECTION_META[s].label}
          </button>
        ))}
      </div>

      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="mb-4 rounded-lg border border-white/10 bg-[#1C1E24] px-4 py-2.5 font-mono text-sm text-white focus:border-[#6C63FF]/50 focus:outline-none"
      >
        {categories.map((cat) => (
          <option key={cat} value={cat}>
            {cat}
          </option>
        ))}
      </select>

      <div className="quill-dark mb-4 overflow-hidden rounded-lg border border-white/10">
        <ReactQuill
          value={content}
          onChange={setContent}
          placeholder="내용을 입력하세요..."
          modules={{
            toolbar: [
              [{ header: [1, 2, false] }],
              ["bold", "italic", "underline", "strike", "code"],
              ["blockquote", "code-block"],
              ["link", "image"],
              [{ list: "ordered" }, { list: "bullet" }],
              ["clean"],
            ],
          }}
        />
      </div>

      <button
        type="button"
        onClick={submitPost}
        className="cursor-pointer rounded-full bg-[#6C63FF] px-6 py-2.5 font-mono text-sm text-white transition-colors hover:bg-[#5b52f0]"
      >
        {isEdit ? "수정하기" : "저장하기"}
      </button>
    </div>
  );
}
