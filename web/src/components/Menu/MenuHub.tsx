import Link from "next/link";
import Faded from "@/components/Faded";
import { getNavGroup } from "@/data/navMenu";

// nav 대제목(project/games/tools/devtools)을 누르면 나오는 하위 메뉴 격자 페이지
export default function MenuHub({ group }: { group: string }) {
  const g = getNavGroup(group);
  return (
    <Faded duration={700}>
      <div className="mx-auto max-w-4xl px-6 pt-16 pb-24">
        <div className="mb-2 font-mono text-sm text-[#8B84FF]">{g.label}</div>
        <h1 className="font-mono text-2xl font-bold text-white sm:text-3xl">{g.title}</h1>
        <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-sm text-white/50">{g.desc}</p>

        <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {g.items.map((item, i) => (
            <li
              key={item.href}
              className="menu-hub-card"
              style={{ animationDelay: `${120 + i * 70}ms` }}
            >
              <Link
                href={item.href}
                className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#1C1E24] transition-all duration-300 hover:-translate-y-1 hover:border-[#6C63FF]/60 hover:shadow-[0_12px_40px_-12px_rgba(108,99,255,0.45)]"
              >
                <div className="relative aspect-[16/10] overflow-hidden border-b border-white/10">
                  <img
                    src={item.image.src}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover object-top transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#1C1E24] via-transparent to-transparent opacity-80" />
                  <span className="absolute top-3 left-3 flex h-8 w-8 items-center justify-center rounded-lg bg-black/50 font-mono text-sm text-white/90 backdrop-blur">
                    {item.icon}
                  </span>
                </div>
                <div className="flex flex-1 flex-col p-4 sm:p-5">
                  <span className="font-mono text-[15px] font-medium text-white sm:text-base">
                    {item.label}
                  </span>
                  <span className="mt-1.5 flex-1 font-['Nanum_Gothic',sans-serif] text-xs leading-relaxed break-keep text-white/45 sm:text-[13px]">
                    {item.desc}
                  </span>
                  <span className="mt-3 font-mono text-xs text-white/25 transition-all duration-300 group-hover:translate-x-1 group-hover:text-[#A9A3FF]">
                    →
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Faded>
  );
}
