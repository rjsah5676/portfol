import type { StaticImageData } from "next/image";
import type { ReactNode } from "react";

// 프로젝트 상세 페이지(DevLifeProject, MimyoProject 등) 공용 UI 조각

export function Section({
  num,
  title,
  children,
}: {
  num: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-16">
      <h2 className="mb-6 flex items-center gap-3 font-mono text-lg font-bold text-white">
        <span className="text-sm text-[#8B84FF]">{num}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-1.5 font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/70">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="mt-[9px] h-1 w-1 flex-shrink-0 rounded-full bg-[#8B84FF]/60" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function Shot({ img, alt }: { img: StaticImageData; alt: string }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-white/10 bg-[#1C1E24]">
      <img
        src={img.src}
        width={img.width}
        height={img.height}
        alt={alt}
        loading="lazy"
        className="h-auto w-full"
      />
      <figcaption className="px-3 py-2 font-mono text-[11px] text-white/40">{alt}</figcaption>
    </figure>
  );
}

export function FlowBox({ title, sub, accent }: { title: string; sub?: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 text-center ${
        accent ? "border-[#6C63FF]/50 bg-[#6C63FF]/10" : "border-white/10 bg-[#1C1E24]"
      }`}
    >
      <div className="font-mono text-xs font-medium text-white">{title}</div>
      {sub && (
        <div className="mt-0.5 font-['Nanum_Gothic',sans-serif] text-[11px] text-white/45">
          {sub}
        </div>
      )}
    </div>
  );
}

export const Arrow = () => (
  <div className="flex items-center justify-center font-mono text-white/25" aria-hidden="true">
    <span className="md:hidden">↓</span>
    <span className="hidden md:inline">→</span>
  </div>
);

export function Chips({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full border border-[#6C63FF]/20 bg-[#6C63FF]/10 px-2.5 py-0.5 font-mono text-xs text-[#8B84FF]"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

export function StackTable({ rows }: { rows: { group: string; items: string[] }[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      {rows.map((row, i) => (
        <div
          key={row.group}
          className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 ${i > 0 ? "border-t border-white/5" : ""}`}
        >
          <div className="w-28 flex-shrink-0 font-mono text-xs text-white/40">{row.group}</div>
          <Chips items={row.items} />
        </div>
      ))}
    </div>
  );
}

export interface Trouble {
  title: string;
  problem: string;
  cause: string;
  solution: string;
}

export function TroubleList({ items }: { items: Trouble[] }) {
  return (
    <div className="flex flex-col gap-4">
      {items.map((t) => (
        <div key={t.title} className="rounded-xl border border-white/10 p-5">
          <h3 className="mb-3 font-mono text-sm font-medium text-white">{t.title}</h3>
          <dl className="grid gap-2 font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed sm:grid-cols-[3.5rem_1fr]">
            <dt className="font-mono text-xs text-red-300/70 sm:pt-0.5">문제</dt>
            <dd className="text-white/70">{t.problem}</dd>
            <dt className="font-mono text-xs text-amber-300/70 sm:pt-0.5">원인</dt>
            <dd className="text-white/70">{t.cause}</dd>
            <dt className="font-mono text-xs text-emerald-300/70 sm:pt-0.5">해결</dt>
            <dd className="text-white/70">{t.solution}</dd>
          </dl>
        </div>
      ))}
    </div>
  );
}

export function StatGrid({ stats }: { stats: { value: string; label: string }[] }) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-xl border border-white/10 bg-[#1C1E24] px-4 py-3 text-center"
        >
          <div className="font-mono text-2xl font-bold text-white">{s.value}</div>
          <div className="mt-1 font-mono text-[11px] text-white/40">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

export function LinkPill({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-full border border-white/10 px-3 py-1 text-white/70 transition-colors hover:border-[#6C63FF]/60 hover:text-white"
    >
      {children}
    </a>
  );
}
