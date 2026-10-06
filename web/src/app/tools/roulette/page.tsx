import Faded from "@/components/Faded";
import Roulette from "@/components/Tools/Roulette";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "룰렛",
  description:
    "이름이나 항목을 넣고 돌려서 하나를 뽑는 온라인 룰렛. 항목별 가중치, 당첨 항목 빼고 다시 돌리기, 최근 결과 기록 지원.",
  path: "/tools/roulette/",
});

export default function RoulettePage() {
  return (
    <Faded>
      <div className="mx-auto max-w-5xl px-4 pt-12 pb-24 sm:px-6">
        <div className="mb-8">
          <div className="font-mono text-sm text-[#8B84FF]">tools</div>
          <h1 className="mt-1 font-mono text-2xl font-bold text-white">룰렛</h1>
          <p className="mt-2 font-['Nanum_Gothic',sans-serif] text-sm text-white/45">
            항목을 넣고 돌리면 하나를 뽑아요. 가중치를 주면 그만큼 칸이 커집니다.
          </p>
        </div>
        <Roulette />
      </div>
    </Faded>
  );
}
