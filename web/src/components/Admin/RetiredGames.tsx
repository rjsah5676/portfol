import Link from "next/link";

/*
 * 관리자 · 내린 게임: 메뉴 · 사이트맵에서 뺀 게임을 관리자만 들어가 해 보게.
 * 각 페이지는 AdminGate + noindex, 서버는 그 게임 요청 · 구독을 관리자에게만 받음 (server.ts gateway.adminOnly).
 * 업적 · 일일 미션은 꺼진 그대로 (web/src/lib/points.ts 주석). 코드 원형 · 되살리는 법은 archive/README.md
 */

const GAMES = [
  { href: "/games/marble/", name: "DICE TOWN", desc: "주사위 보드게임 (부루마블 스타일) · 최대 4명, 빈자리는 AI", at: "2026.10.16 내림" },
  { href: "/games/survivor/", name: "PIXEL TOWN SURVIVOR", desc: "다이스 타운 캐릭터로 하는 뱀서라이크", at: "2026.10.17 내림" },
  { href: "/games/patrol/", name: "PIXEL PATROL", desc: "뱀서라이크 + 장비 뽑기 (픽셀 순찰대)", at: "2026.10.18 내림" },
  { href: "/games/rogue/", name: "PIXEL RESET STORY", desc: "PIXEL FIGHT 외전 탑뷰 로그라이크 (ALPHA)", at: "2026.10.19 내림" },
  { href: "/games/town/", name: "TABLE TOWN", desc: "마을을 돌아다니다 들어가는 원카드 보드게임", at: "2026.10.22 내림" },
];

export default function RetiredGames() {
  return (
    <div className="font-['Nanum_Gothic',sans-serif]">
      <ul className="grid gap-2 sm:grid-cols-2">
        {GAMES.map((g) => (
          <li key={g.href}>
            <Link
              href={g.href}
              target="_blank"
              className="flex h-full flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-[#6C63FF]/60"
            >
              <span className="flex items-baseline justify-between gap-2">
                <b className="font-mono text-sm text-white">{g.name}</b>
                <span className="shrink-0 font-mono text-[10px] text-white/30">{g.at}</span>
              </span>
              <span className="text-xs leading-relaxed break-keep text-white/55">{g.desc}</span>
              <span className="mt-1 font-mono text-[11px] text-[#8B84FF]">{g.href} ↗</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[11px] leading-relaxed break-keep text-white/35">
        메뉴 · 사이트맵 · 검색엔진에는 안 보이고, 관리자 계정으로만 들어가져요. 업적 · 일일 미션은 꺼져 있고, 게임 안의 GP 상점은 그대로라
        사면 진짜 GP가 빠져요.
      </p>
    </div>
  );
}
