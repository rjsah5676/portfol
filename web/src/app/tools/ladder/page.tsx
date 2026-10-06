import Faded from "@/components/Faded";
import Ladder from "@/components/Tools/Ladder";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "사다리타기",
  description:
    "참가자와 결과(당첨·꽝, 순서 정하기)를 넣고 사다리를 타는 온라인 사다리 게임. 결과 가리기, 전체 결과 한 번에 보기 지원.",
  path: "/tools/ladder/",
});

export default function LadderPage() {
  return (
    <Faded>
      <div className="mx-auto max-w-4xl px-4 pt-12 pb-24 sm:px-6">
        <div className="mb-8">
          <div className="font-mono text-sm text-[#8B84FF]">tools</div>
          <h1 className="mt-1 font-mono text-2xl font-bold text-white">사다리타기</h1>
          <p className="mt-2 font-['Nanum_Gothic',sans-serif] text-sm text-white/45">
            한 명 뽑기, 순서 정하기, 벌칙 정하기까지.
          </p>
        </div>
        <Ladder />
      </div>
    </Faded>
  );
}
