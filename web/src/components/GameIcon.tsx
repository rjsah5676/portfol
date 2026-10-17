/*
 * 메뉴 · 메인 · 검색의 게임 아이콘. navMenu 의 icon 이 "px:<키>" 면 앱 아이콘 그림(public/icons/games/<키>.webp, 256×256),
 * 아니면 그 글자(이모지) 그대로. 그림은 감싼 칸을 꽉 채우고 모서리는 칸의 둥글기를 따라감.
 */
export default function GameIcon({ icon }: { icon: string }) {
  if (!icon.startsWith("px:")) return <>{icon}</>;
  return (
    <img
      src={`/icons/games/${icon.slice(3)}.webp`}
      alt=""
      width={40}
      height={40}
      loading="lazy"
      draggable={false}
      className="h-full w-full rounded-[inherit] object-cover"
    />
  );
}
