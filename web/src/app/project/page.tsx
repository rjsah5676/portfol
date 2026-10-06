"use client";

import { useState } from "react";
import Faded from "@/components/Faded";
import InfoBox from "@/components/Info/InfoBox";
import { teamProjects, personalProjects } from "@/data/projects";

function TechPills({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((t) => (
        <span
          key={t}
          className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-xs text-white/50"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

export default function ProjectPage() {
  const [tab, setTab] = useState<"team" | "personal">("team");
  const list = tab === "team" ? teamProjects : personalProjects;

  return (
    <Faded>
      <div className="mx-auto max-w-3xl px-6 pt-16 pb-24">
        <div className="mb-8 font-mono text-sm text-[#8B84FF]">project</div>

        <div className="mb-10 flex gap-2 font-mono text-sm">
          <button
            type="button"
            onClick={() => setTab("team")}
            className={`cursor-pointer rounded-full border px-4 py-1.5 transition-colors ${
              tab === "team"
                ? "border-[#6C63FF] bg-[#6C63FF]/10 text-white"
                : "border-white/10 text-white/50 hover:text-white"
            }`}
          >
            team
          </button>
          <button
            type="button"
            onClick={() => setTab("personal")}
            className={`cursor-pointer rounded-full border px-4 py-1.5 transition-colors ${
              tab === "personal"
                ? "border-[#6C63FF] bg-[#6C63FF]/10 text-white"
                : "border-white/10 text-white/50 hover:text-white"
            }`}
          >
            personal
          </button>
        </div>

        <div className="flex flex-col gap-5">
          {list.map((p) => (
            <InfoBox
              key={p.idx}
              idx={p.idx}
              imgLink={p.imgLink}
              gitLink={p.gitLink}
              title={p.title}
              desc={p.desc}
              tech={<TechPills items={p.tech} />}
              secondLink={p.secondLink}
            />
          ))}
        </div>
      </div>
    </Faded>
  );
}
