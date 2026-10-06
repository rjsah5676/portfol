"use client";

import type { StaticImageData } from "next/image";
import { useModal } from "@/components/Modal/ModalProvider";

export interface SiteLink {
  icon: StaticImageData;
  label: string;
  href: string;
  // 서비스 종료 등으로 지금은 열 수 없는 사이트 — 클릭 시 안내 모달
  unavailable?: boolean;
}

const pillClass =
  "flex cursor-pointer items-center gap-2 rounded-full border border-white/10 py-2 pr-4 pl-2 font-mono text-sm text-white/70 transition-colors hover:border-[#6C63FF]/50 hover:text-white";

export default function SiteLinks({ sites }: { sites: SiteLink[] }) {
  const modal = useModal();

  return (
    <div className="flex flex-wrap gap-3">
      {sites.map((site) => {
        const content = (
          <>
            <img src={site.icon.src} alt="" className="h-5 w-5 rounded-full object-cover" />
            {site.label}
          </>
        );

        if (site.unavailable) {
          return (
            <button
              key={site.label}
              type="button"
              className={pillClass}
              onClick={() =>
                modal.alert({
                  title: site.label,
                  message:
                    "현재 접근할 수 없는 사이트입니다. 자세한 내용은 프로젝트 페이지에서 확인해주세요.",
                })
              }
            >
              {content}
            </button>
          );
        }

        return (
          <a
            key={site.label}
            href={site.href}
            target="_blank"
            rel="noopener noreferrer"
            className={pillClass}
          >
            {content}
          </a>
        );
      })}
    </div>
  );
}
