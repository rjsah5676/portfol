import Link from "next/link";
import type { StaticImageData } from "next/image";
import {
  Arrow,
  Bullets,
  FlowBox,
  Section,
  Shot,
  StackTable,
  StatGrid,
  TroubleList,
  type Trouble,
} from "./ProjectDetailUI";

/*
 * 데이터만 넣으면 되는 프로젝트 상세 페이지 (moreProjects.ts 의 게임 · 실무 프로젝트).
 * 모양은 다른 상세 페이지(LuckyDefenseProject 등)와 같음: 머리 → 대표 그림 → 숫자 → 개요 → 기술 → 흐름 → 만든 것 → 문제와 해결.
 */

export interface DetailConfig {
  /** 맨 위 작은 글자 (예: "game · gunmo.my", "work · 커머스 플랫폼") */
  eyebrow: string;
  name: string;
  lead: string;
  period: string;
  role?: string;
  /** 플레이 · 바깥 링크 */
  play?: string;
  cover: StaticImageData;
  coverAlt: string;
  stats: { value: string; label: string }[];
  overview: string[];
  stack: { group: string; items: string[] }[];
  /** 한 판 · 한 요청의 흐름 (상자 3개 안팎) */
  flow?: { title: string; steps: { title: string; sub?: string; accent?: boolean }[]; notes?: string[] };
  features: { title: string; items: string[] }[];
  troubles: Trouble[];
  /** 이 일에서 나온 회고 글 제목 (프로젝트 회고에서 찾을 수 있게) */
  retros?: string[];
}

const KR = "font-['Nanum_Gothic',sans-serif]";

export default function DetailPage({ c }: { c: DetailConfig }) {
  let n = 0;
  const num = () => String(++n).padStart(2, "0");
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 font-mono text-sm text-[#8B84FF]">{c.eyebrow}</div>
      <h1 className="font-mono text-3xl font-bold break-keep text-white sm:text-4xl">{c.name}</h1>
      <p className={`mt-3 break-keep text-white/60 ${KR}`}>{c.lead}</p>

      <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-xs">
        <span className="rounded-full border border-white/10 px-3 py-1 text-white/50">{c.period}</span>
        {c.role && (
          <span className={`rounded-full border border-white/10 px-3 py-1 text-white/50 ${KR}`}>
            {c.role}
          </span>
        )}
        {c.play && (
          <Link
            href={c.play}
            className="rounded-full bg-[#6C63FF] px-4 py-1 text-white transition-colors hover:bg-[#5b52f0]"
          >
            플레이
          </Link>
        )}
      </div>

      <div className="mt-8">
        <Shot img={c.cover} alt={c.coverAlt} />
      </div>

      <StatGrid stats={c.stats} />

      <Section num={num()} title="개요">
        <div className={`flex flex-col gap-3 text-sm leading-relaxed break-keep text-white/70 ${KR}`}>
          {c.overview.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      </Section>

      <Section num={num()} title="기술 스택">
        <StackTable rows={c.stack} />
      </Section>

      {c.flow && (
        <Section num={num()} title={c.flow.title}>
          <div className="rounded-xl border border-white/10 p-4 sm:p-5">
            <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
              {c.flow.steps.map((s, i) => (
                <div key={s.title} className="contents">
                  {i > 0 && <Arrow />}
                  <div className="flex-1">
                    <FlowBox title={s.title} sub={s.sub} accent={s.accent} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          {c.flow.notes && (
            <div className="mt-4">
              <Bullets items={c.flow.notes} />
            </div>
          )}
        </Section>
      )}

      <Section num={num()} title="만든 것들">
        <div className="grid gap-6">
          {c.features.map((f) => (
            <div key={f.title} className="rounded-xl border border-white/10 p-4 sm:p-5">
              <div className={`mb-2 text-sm font-bold text-white ${KR}`}>{f.title}</div>
              <Bullets items={f.items} />
            </div>
          ))}
        </div>
      </Section>

      <Section num={num()} title="문제와 해결">
        <TroubleList items={c.troubles} />
      </Section>

      {c.retros && c.retros.length > 0 && (
        <Section num={num()} title="관련 회고">
          <Bullets items={c.retros} />
          <Link
            href="/retro/"
            className="mt-4 inline-block font-mono text-sm text-[#8B84FF] underline-offset-4 hover:underline"
          >
            프로젝트 회고 보기 →
          </Link>
        </Section>
      )}
    </div>
  );
}
