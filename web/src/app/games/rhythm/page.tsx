import Faded from "@/components/Faded";
import RhythmGame from "@/components/Rhythm/RhythmGame";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "리듬게임",
  description:
    "4키(DFJK) 리듬게임. AI 자작곡 4곡 + 내 mp3를 넣으면 자동 채보로 플레이, 쉬움~나이트메어 최대 5단계, 롱노트, 노트 속도·싱크 조절, HP·롱노트 콤보, 모바일 터치 지원.",
  path: "/games/rhythm/",
});

export default function RhythmPage() {
  return (
    <Faded>
      <div className="mx-auto max-w-6xl px-4 pt-6 pb-24 sm:px-6">
        <RhythmGame />
      </div>
    </Faded>
  );
}
