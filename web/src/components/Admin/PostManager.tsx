"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useModal } from "@/components/Modal/ModalProvider";
import {
  deleteStudyPost,
  parseStudyDate,
  postPath,
  SECTION_META,
  sectionOf,
  type StudyPost,
  type StudySection,
} from "@/firestore/studyPosts";

const btn =
  "cursor-pointer rounded-full border border-white/15 px-3 py-1 font-mono text-xs whitespace-nowrap text-white/70 transition-colors hover:border-[#6C63FF]/60 hover:text-white";

export default function PostManager({
  posts,
  loaded,
  onChanged,
}: {
  posts: StudyPost[];
  loaded: boolean;
  onChanged: () => void;
}) {
  const modal = useModal();
  const [q, setQ] = useState("");
  const [sec, setSec] = useState<"all" | StudySection>("all");

  const list = useMemo(() => {
    const sorted = [...posts].sort(
      (a, b) => (parseStudyDate(b.date)?.getTime() ?? 0) - (parseStudyDate(a.date)?.getTime() ?? 0)
    );
    const t = q.trim().toLowerCase();
    return sorted
      .filter((p) => sec === "all" || sectionOf(p) === sec)
      .filter((p) => !t || `${p.title} ${p.category}`.toLowerCase().includes(t));
  }, [posts, q, sec]);

  const remove = async (p: StudyPost) => {
    const ok = await modal.confirm({
      title: "글 삭제",
      message: `'${p.title}' 글을 삭제할까요? 되돌릴 수 없습니다.`,
      confirmText: "삭제",
      cancelText: "취소",
    });
    if (!ok) return;
    try {
      await deleteStudyPost(p.id);
      onChanged();
    } catch (e) {
      console.error(e);
      await modal.alert({ title: "삭제 실패", message: "잠시 후 다시 시도해주세요." });
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="제목·분류로 찾기"
          className="min-w-0 flex-1 rounded-full border border-white/10 bg-[#1C1E24] px-4 py-2 font-['Nanum_Gothic',sans-serif] text-sm text-white placeholder:text-white/30 focus:border-[#6C63FF]/50 focus:outline-none"
        />
        <Link
          href="/admin/write/"
          className="shrink-0 rounded-full bg-[#6C63FF] px-5 py-2 text-center font-mono text-sm text-white transition-colors hover:bg-[#5b52f0]"
        >
          + 새 글 쓰기
        </Link>
      </div>
      <div className="mb-3 flex gap-1.5">
        {(["all", "study", "retro"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setSec(k)}
            className={`cursor-pointer rounded-full border px-3 py-1 font-mono text-xs transition-colors ${
              sec === k
                ? "border-[#6C63FF] bg-[#6C63FF]/15 text-white"
                : "border-white/10 text-white/50 hover:text-white/80"
            }`}
          >
            {k === "all" ? "전체" : SECTION_META[k].label}{" "}
            <span className="text-white/35">
              {k === "all" ? posts.length : posts.filter((p) => sectionOf(p) === k).length}
            </span>
          </button>
        ))}
      </div>
      <p className="mb-3 font-['Nanum_Gothic',sans-serif] text-xs text-white/35">
        작성·수정·삭제는 바로 저장되고, 사이트 목록에는 재배포 후 반영됩니다.
      </p>

      {!loaded ? (
        <p className="py-10 text-center font-mono text-sm text-white/30">불러오는 중…</p>
      ) : list.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-[#1C1E24] py-12 text-center font-['Nanum_Gothic',sans-serif] text-sm text-white/35">
          {q ? "검색 결과가 없습니다." : "아직 글이 없습니다."}
        </p>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-white/10 bg-[#1C1E24]">
          {list.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-2 border-b border-white/5 px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-['Nanum_Gothic',sans-serif] text-sm text-white/90">
                  {p.title}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-white/35">
                  <span className="text-white/55">{SECTION_META[sectionOf(p)].label}</span> ·{" "}
                  <span className="text-[#8B84FF]/80">{p.category}</span> · {p.date.split(" ")[0]}
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Link href={postPath(p)} className={btn} target="_blank">
                  보기
                </Link>
                <Link href={`/admin/write/?id=${p.id}`} className={btn}>
                  수정
                </Link>
                <button
                  type="button"
                  onClick={() => remove(p)}
                  className={`${btn} hover:border-red-400/60 hover:text-red-300`}
                >
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
