"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { gameProjects, personalProjects, teamProjects, type Project } from "@/data/projects";

/*
 * 포트폴리오 목록 (team / personal / games).
 *   넓은 화면: 왼쪽에 이름을 크게 쌓고, 마우스를 올린(또는 Tab 으로 고른) 프로젝트가 오른쪽 미리보기에 나옴. 이름을 누르면 상세 페이지.
 *   좁은 화면: 프로젝트마다 화면 캡처 + 설명을 차례로.
 * 탭은 주소의 #team / #personal / #games 로 기억 → 링크로 바로 열 수 있고 뒤로가기로 돌아감.
 */

const TABS = [
  { key: "team", desc: "팀으로 만든 것", list: teamProjects },
  { key: "personal", desc: "혼자 만든 것", list: personalProjects },
  { key: "games", desc: "이 사이트에서 바로 해 볼 수 있는 게임", list: gameProjects },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const KR = "font-['Nanum_Gothic',sans-serif]";

// "커머스 핸드메이드 쇼핑몰 [MIMYO]" → "커머스 핸드메이드 쇼핑몰" (이름은 따로 크게 보여 주므로)
const subtitleOf = (p: Project) => p.title.replace(/\s*\[.+?\]\s*/, "").trim();
const detailOf = (p: Project) => `/infoPage/${p.idx}/`;

const subscribeHash = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

function Shot({ p, className = "" }: { p: Project; className?: string }) {
  return (
    <img
      src={p.imgLink.src}
      width={p.imgLink.width}
      height={p.imgLink.height}
      alt={`${p.name} 화면`}
      className={`h-full w-full object-cover object-top ${className}`}
      draggable={false}
    />
  );
}

/** 설명 · 시기 · 기술 · 링크 (미리보기와 좁은 화면 카드가 같이 씀) */
function Info({ p }: { p: Project }) {
  const subtitle = subtitleOf(p);
  const out = "text-white/55 underline-offset-4 transition-colors hover:text-white hover:underline";
  return (
    <>
      {subtitle && <p className={`text-[15px] font-bold text-white ${KR}`}>{subtitle}</p>}
      <p className={`mt-1.5 text-sm leading-relaxed break-keep text-white/60 ${KR}`}>{p.desc}</p>
      <dl className="mt-4 grid grid-cols-[3.2rem_1fr] gap-y-1.5 font-mono text-xs">
        <dt className="text-white/30">when</dt>
        <dd className="text-white/70">
          {p.period}
          {p.role && <span className={`ml-2 text-white/45 ${KR}`}>{p.role}</span>}
        </dd>
        <dt className="text-white/30">with</dt>
        <dd className="flex flex-wrap gap-x-3 gap-y-1 text-white/70">
          {p.tech.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </dd>
      </dl>
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 font-mono text-sm">
        {p.playLink && (
          <Link
            href={p.playLink}
            className="rounded-full bg-[#6C63FF] px-5 py-2 text-white transition-colors hover:bg-[#5b52f0]"
          >
            플레이
          </Link>
        )}
        <Link
          href={detailOf(p)}
          className={
            p.playLink
              ? out
              : "rounded-full bg-white px-5 py-2 text-[#121212] transition-transform hover:-translate-y-0.5"
          }
        >
          자세히 보기
        </Link>
        {p.gitLink && (
          <a href={p.gitLink} target="_blank" rel="noopener noreferrer" className={out}>
            GitHub
          </a>
        )}
        {p.secondLink && (
          <a href={p.secondLink} target="_blank" rel="noopener noreferrer" className={out}>
            {p.secondLabel ?? "링크"}
          </a>
        )}
      </div>
    </>
  );
}

function Panel({ list }: { list: readonly Project[] }) {
  const [on, setOn] = useState(list[0].idx);
  const active = list.find((p) => p.idx === on) ?? list[0];

  return (
    <>
      {/* 넓은 화면: 이름 목록 + 미리보기 */}
      <div className="hidden items-start gap-14 lg:grid lg:grid-cols-[1.05fr_1fr]">
        <ul className="flex flex-col gap-3 pt-2">
          {list.map((p) => (
            <li key={p.idx}>
              <Link
                href={detailOf(p)}
                data-on={p.idx === on}
                onMouseEnter={() => setOn(p.idx)}
                onFocus={() => setOn(p.idx)}
                className="pf-row group flex w-fit items-start gap-3"
              >
                {/* 긴 이름은 한 줄에 들어가게 조금 작게 */}
                <span
                  className={`pf-name whitespace-nowrap ${
                    p.name.length > 12
                      ? "text-[clamp(2.6rem,4.7vw,4.3rem)]"
                      : "text-[clamp(3.6rem,6.6vw,6rem)]"
                  }`}
                >
                  {p.name}
                </span>
                <span
                  className={`mt-2 font-mono text-xs transition-colors ${
                    p.idx === on ? "text-[#8B84FF]" : "text-white/25"
                  }`}
                >
                  {p.period.slice(0, 4)}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="sticky top-32">
          <Link
            href={detailOf(active)}
            tabIndex={-1}
            aria-hidden="true"
            className="relative block aspect-[16/10] overflow-hidden rounded-xl border border-white/10 bg-[#0D0D10] shadow-[0_40px_90px_-40px_rgba(108,99,255,0.55)]"
          >
            {list.map((p) => (
              <div key={p.idx} data-on={p.idx === on} className="pf-shot absolute inset-0">
                <Shot p={p} />
              </div>
            ))}
          </Link>
          <div key={active.idx} className="pf-info mt-6">
            <Info p={active} />
          </div>
        </div>
      </div>

      {/* 좁은 화면: 차례로 */}
      <ul className="flex flex-col gap-14 lg:hidden">
        {list.map((p) => (
          <li key={p.idx}>
            <Link
              href={detailOf(p)}
              className="relative block aspect-[16/10] overflow-hidden rounded-xl border border-white/10 bg-[#0D0D10]"
            >
              <Shot p={p} />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-4 pt-16 pb-3">
                <span className="pf-name block text-[clamp(2.4rem,11vw,3.6rem)] text-white">
                  {p.name}
                </span>
              </span>
            </Link>
            <div className="mt-4">
              <Info p={p} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function Lineup() {
  // 서버에서 그릴 때와 주소에 #이 없을 때는 team
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash.slice(1),
    () => ""
  );
  const tab: TabKey = TABS.find((t) => t.key === hash)?.key ?? "team";

  return (
    <div className="mx-auto max-w-6xl px-5 pt-14 pb-24 sm:px-8">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-x-10 gap-y-5 border-b border-white/10 pb-5 lg:mb-14">
        <div>
          <h1 className="font-mono text-sm text-[#8B84FF]">portfolio</h1>
          <p className={`mt-2 text-sm text-white/50 ${KR}`}>
            {TABS.find((t) => t.key === tab)!.desc}
          </p>
        </div>
        <nav aria-label="프로젝트 구분" className="flex gap-6 font-mono text-lg sm:gap-8 sm:text-xl">
          {TABS.map((t) => (
            <a
              key={t.key}
              href={`#${t.key}`}
              aria-current={t.key === tab ? "true" : undefined}
              className={`relative transition-colors ${
                t.key === tab ? "text-white" : "text-white/35 hover:text-white/70"
              }`}
            >
              {t.key}
              <sup className="ml-1 text-[11px] text-white/40">{t.list.length}</sup>
              {t.key === tab && (
                <span className="absolute inset-x-0 -bottom-[21px] h-px bg-[#8B84FF]" />
              )}
            </a>
          ))}
        </nav>
      </div>

      {/* 세 목록을 모두 그려 두고 고른 것만 보임 → 검색엔진이 받는 HTML 에 프로젝트가 전부 들어감 */}
      {TABS.map((t) => (
        <section key={t.key} hidden={t.key !== tab} aria-label={t.key}>
          <Panel list={t.list} />
        </section>
      ))}
    </div>
  );
}
