/** 메뉴 이름 옆 작은 딱지 (navMenu 의 badge — 예: ALPHA) */
export default function NavBadge({ badge }: { badge?: string }) {
  if (!badge) return null;
  return (
    <span className="ml-1.5 inline-block rounded border border-[#FF3D5E]/50 bg-[#FF3D5E]/15 px-1 py-px align-middle font-mono text-[9px] leading-none font-bold tracking-wider text-[#FF8FA3]">
      {badge}
    </span>
  );
}
