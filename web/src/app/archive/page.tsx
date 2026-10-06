import Faded from "@/components/Faded";
import ArchiveTimeline from "@/components/ArchiveTimeline";
import { archiveEntries } from "@/data/archive";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "아카이브",
  description:
    "이건모의 개발 기록. 사이트 개발 변경 이력, 팀·개인 프로젝트, 실무 작업, 학습 이력을 시간순으로 정리합니다.",
  path: "/archive/",
});

export default function ArchivePage() {
  return (
    <Faded>
      <div className="mx-auto max-w-2xl px-6 pt-16 pb-24">
        <div className="mb-3 font-mono text-sm text-[#8B84FF]">archive</div>
        <p className="mb-8 font-['Nanum_Gothic',sans-serif] text-sm text-white/50">
          사이트 변경 이력과 프로젝트, 실무 작업을 시간순으로 기록합니다.
        </p>
        <ArchiveTimeline entries={archiveEntries} />
      </div>
    </Faded>
  );
}
