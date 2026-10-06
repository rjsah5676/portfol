import Link from "next/link";
import type { ReactNode } from "react";
import type { StaticImageData } from "next/image";

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.5 0 12.3c0 5.44 3.44 10.05 8.21 11.68.6.11.82-.27.82-.6 0-.3-.01-1.08-.02-2.12-3.34.75-4.04-1.65-4.04-1.65-.55-1.44-1.34-1.82-1.34-1.82-1.09-.77.08-.75.08-.75 1.2.09 1.84 1.27 1.84 1.27 1.07 1.87 2.81 1.33 3.49 1.02.11-.79.42-1.33.76-1.64-2.67-.31-5.47-1.38-5.47-6.13 0-1.35.46-2.46 1.22-3.32-.12-.31-.53-1.56.12-3.25 0 0 1-.33 3.3 1.27.96-.27 1.98-.41 3-.41s2.04.14 3 .41c2.3-1.6 3.3-1.27 3.3-1.27.65 1.69.24 2.94.12 3.25.76.86 1.22 1.97 1.22 3.32 0 4.76-2.81 5.81-5.48 6.12.43.38.81 1.14.81 2.3 0 1.66-.02 3-.02 3.41 0 .33.22.72.83.6C20.57 22.34 24 17.74 24 12.3 24 5.5 18.63 0 12 0Z" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 5h5v5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 5L10 14" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface InfoBoxProps {
  idx: number;
  imgLink: StaticImageData;
  gitLink: string;
  title: string;
  desc: string;
  tech: ReactNode;
  secondLink?: string;
}

export default function InfoBox({ imgLink, gitLink, title, desc, tech, idx, secondLink }: InfoBoxProps) {
  return (
    <div className="flex flex-col gap-5 rounded-xl border border-white/10 bg-[#1C1E24] p-5 sm:flex-row">
      <Link
        href={`/infoPage/${idx}`}
        className="aspect-video w-full flex-shrink-0 rounded-lg bg-cover bg-center transition-transform duration-300 hover:scale-[1.03] sm:aspect-square sm:w-48"
        style={{ backgroundImage: `url(${imgLink.src})` }}
      />
      <div className="flex flex-1 flex-col">
        <Link
          href={`/infoPage/${idx}`}
          className="font-mono text-lg font-medium text-white transition-colors hover:text-[#8B84FF]"
        >
          {title}
        </Link>
        <p className="mt-2 font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/60">
          {desc}
        </p>
        <div className="mt-3">{tech}</div>
        <div className="mt-auto flex items-center gap-3 pt-4">
          <a
            href={gitLink}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-white/60 transition-colors hover:border-[#6C63FF]/50 hover:text-white"
            aria-label="GitHub"
          >
            <GithubIcon />
          </a>
          {secondLink && (
            <a
              href={secondLink}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-white/60 transition-colors hover:border-[#6C63FF]/50 hover:text-white"
              aria-label="Live site"
            >
              <ExternalLinkIcon />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
