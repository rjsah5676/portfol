import Link from "next/link";
import type { ArchiveEntry, ArchiveTag } from "@/data/archive";

export const TAG_STYLE: Record<ArchiveTag, { dot: string; pill: string }> = {
  사이트: { dot: "bg-[#6C63FF]", pill: "border-[#6C63FF]/30 bg-[#6C63FF]/10 text-[#8B84FF]" },
  프로젝트: {
    dot: "bg-emerald-400",
    pill: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  },
  실무: { dot: "bg-amber-400", pill: "border-amber-400/25 bg-amber-400/10 text-amber-300" },
  학습: { dot: "bg-sky-400", pill: "border-sky-400/25 bg-sky-400/10 text-sky-300" },
  이력: { dot: "bg-white/50", pill: "border-white/15 bg-white/5 text-white/60" },
};

export default function ArchiveBox({ entry }: { entry: ArchiveEntry }) {
  const style = TAG_STYLE[entry.tag];

  return (
    <article className="relative pb-8 pl-7 sm:pl-9">
      {/* 타임라인 점 (세로선은 부모 목록에서 그림) */}
      <span
        className={`absolute top-[7px] left-[-5.5px] h-2.5 w-2.5 rounded-full ring-4 ring-[#121212] ${style.dot}`}
      />

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <time className="font-mono text-xs text-white/40">{entry.date}</time>
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${style.pill}`}>
          {entry.tag}
        </span>
      </div>

      <h3 className="mb-2 font-mono text-base font-medium text-white">
        {entry.href ? (
          <Link href={entry.href} className="transition-colors hover:text-[#8B84FF]">
            {entry.title} <span className="text-white/30">↗</span>
          </Link>
        ) : (
          entry.title
        )}
      </h3>

      <ul className="flex flex-col gap-1 font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/65">
        {entry.items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-[9px] h-1 w-1 flex-shrink-0 rounded-full bg-white/25" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
