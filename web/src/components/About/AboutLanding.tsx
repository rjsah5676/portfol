"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import HintBubble from "@/components/HintBubble";

export interface AboutProject {
  idx: number;
  name: string;
  desc: string;
  tech: string[];
  img: string;
}

// ───────────────────────── 데이터 ─────────────────────────

const ROLES = ["풀스택 개발자", "Spring · Next.js", "원인부터 찾는 사람"];

const STACK_ROW_1 = [
  "Java",
  "Spring Boot",
  "Spring MVC",
  "MyBatis",
  "JPA",
  "MariaDB",
  "MySQL",
  "JSP",
  "Redis",
  "Kubernetes",
];
// 기술별 브랜드 색을 어둡게 눌러 쓴 톤 [배경, 테두리, 글자]
export const STACK_COLORS: Record<string, [string, string, string]> = {
  Java: ["#2b1d12", "#6b4423", "#f0a868"],
  "Spring Boot": ["#14261a", "#2f5d3a", "#86d39a"],
  "Spring MVC": ["#14261a", "#2f5d3a", "#86d39a"],
  MyBatis: ["#2a1616", "#633030", "#e89a9a"],
  JPA: ["#1c2216", "#45532f", "#b9d48a"],
  MariaDB: ["#15212b", "#2f4d63", "#8fbfe0"],
  MySQL: ["#122229", "#285466", "#7cc4dd"],
  JSP: ["#2a2112", "#66502a", "#e3c27e"],
  Redis: ["#2b1514", "#6e2e2a", "#f08f86"],
  Kubernetes: ["#141c2e", "#2e4373", "#93b1ef"],
  TypeScript: ["#122033", "#28507e", "#86b6ec"],
  "Next.js": ["#1c1c1f", "#4a4a52", "#e4e4e7"],
  React: ["#11232a", "#25566a", "#7fd8f2"],
  "Tailwind CSS": ["#10252a", "#22606b", "#79d3e0"],
  "Node.js": ["#15241a", "#305a37", "#8fd18f"],
  Express: ["#1d1d20", "#47474e", "#cfcfd6"],
  WebRTC: ["#122126", "#295866", "#83cbe0"],
  WebSocket: ["#1f1a2b", "#4a3d6b", "#bfa9f0"],
  MongoDB: ["#13241a", "#2b5a39", "#7fd39a"],
  Firebase: ["#2b2010", "#6e5020", "#f3c46b"],
};

const STACK_ROW_2 = [
  "TypeScript",
  "Next.js",
  "React",
  "Tailwind CSS",
  "Node.js",
  "Express",
  "WebRTC",
  "WebSocket",
  "MongoDB",
  "Firebase",
];

const NUMBERS = [
  { value: 2016, label: "알고리즘 시작", from: 2006 },
  { value: 2021, label: "이 사이트 오픈", from: 2011 },
  { value: 2, label: "팀장 경험", suffix: "회", from: 0 },
  { value: 9, label: "프로젝트", from: 0 },
];

const TRAITS: { title: string; body: string; proof: { label: string; href: string }[] }[] = [
  {
    title: "끝까지 파고듭니다",
    body: "새로고침하면 끊기는 음성 통화, 뒤로가기에 안 닫히는 모달처럼 사용자가 한 번쯤 부딪힐 작은 틈을 찾아 원인까지 내려가 고칩니다.",
    proof: [
      { label: "Oh! Sori 통화 복구", href: "/infoPage/11/" },
      { label: "이 사이트의 트러블슈팅", href: "/infoPage/4/" },
    ],
  },
  {
    title: "레거시를 피하지 않습니다",
    body: "새로 짜는 것보다 안전하게 옮기는 쪽이 더 어렵다는 걸 압니다. 5년 된 CRA 사이트를 Next.js와 TypeScript로 옮겼고, 실무에서는 하드코딩된 권한 체크를 권한키 체계로 바꾸는 마이그레이션을 맡았습니다.",
    proof: [{ label: "작업 기록", href: "/archive/" }],
  },
  {
    title: "화면에서 서버까지 잇습니다",
    body: "JSP·MyBatis 레거시 모놀리스, Spring Boot 기반 MSA, Next.js 프론트엔드를 오가며 기능 하나를 처음부터 끝까지 책임집니다. 결제·배송처럼 여러 계층이 맞물리는 경계의 문제를 잡는 걸 좋아합니다.",
    proof: [{ label: "MIMYO 주문·결제 설계", href: "/infoPage/10/" }],
  },
  {
    title: "팀을 앞에서 끕니다",
    body: "두 번의 팀 프로젝트에서 팀장을 맡아 기획, 역할 분담, DB 설계, Git 브랜치 운영, 배포까지 이끌었습니다. 가장 무거운 부분을 먼저 가져가면 팀도 따라온다는 걸 배웠습니다.",
    proof: [
      { label: "MIMYO", href: "/infoPage/10/" },
      { label: "ArtPart", href: "/infoPage/8/" },
    ],
  },
  {
    title: "보안을 기능의 일부로 봅니다",
    body: "서버가 공격받아 DB가 날아가는 일을 겪은 뒤로, 기능보다 먼저 입력값과 권한과 노출된 설정을 봅니다. 저장형 XSS 대응, 계정 잠금, 본인인증 연동을 실무에서 다뤘습니다.",
    proof: [{ label: "프로젝트 회고", href: "/retro/" }],
  },
  {
    title: "오래 가꿉니다",
    body: "2016년에 시작한 알고리즘 풀이도, 2021년에 연 이 사이트도 아직 손보고 있습니다. 만들고 끝내기보다 쓰면서 불편한 걸 찾아 다듬습니다.",
    proof: [
      { label: "백준 풀이 정리", href: "/infoPage/5/" },
      { label: "Gunmo's Dev Life", href: "/infoPage/4/" },
    ],
  },
];

const JOURNEY: { year: string; title: string; body: string }[] = [
  {
    year: "2016",
    title: "알고리즘 문제 풀이 시작",
    body: "백준에서 문제를 풀기 시작. 지금도 가끔 풉니다.",
  },
  { year: "2017–18", title: "군 복무", body: "육군 5사단 복무." },
  {
    year: "2019",
    title: "첫 웹 프로젝트, 요리조리",
    body: "React·Node.js·MongoDB로 레시피 공유 커뮤니티를 만들었습니다.",
  },
  {
    year: "2021",
    title: "AirBoard · Gunmo's Dev Life",
    body: "캡스톤에서 WebRTC 화상 회의에 캠 필기를 붙인 AirBoard를 만들고, 인턴 실습을 거쳐 이 사이트를 열었습니다.",
  },
  {
    year: "2022",
    title: "아주대학교 소프트웨어학과 졸업",
    body: "졸업 무렵 팀 프로젝트로 영천시 세무조사 홈페이지(JSP·MySQL)를 만들었습니다.",
  },
  {
    year: "2025",
    title: "ArtPart · KickEat · MIMYO · Oh! Sori",
    body: "팀 프로젝트 세 개 중 두 번 팀장을 맡았고, 혼자서 WebRTC 음성채팅 커뮤니티를 만들어 배포했습니다.",
  },
  {
    year: "Now",
    title: "커머스 플랫폼 풀스택 개발",
    body: "실무 기능을 만들면서, 틈틈이 이 사이트에 게임과 도구를 하나씩 더하고 있습니다.",
  },
];

const FACTS = [
  { key: "Name", value: "Lee Gunmo" },
  { key: "Education", value: "Ajou Univ. Software Dept." },
  { key: "MBTI", value: "ISTP" },
  { key: "Job", value: "Fullstack Developer @ commerce platform" },
  { key: "Stack", value: "Spring Boot · MyBatis · Next.js · TypeScript" },
  { key: "Motto", value: "Seize the day." },
];

const QA = [
  { q: "혼자 일하는 거 좋아하세요?", a: "혼자 시작해서 함께 마무리하는 걸 좋아합니다." },
  {
    q: "가장 기억에 남는 버그는?",
    a: "새벽에 서버 공격받고 DB 날아가서 아침까지 콘솔 붙잡고 있었던 그날이요. 그 뒤로 보안부터 봅니다.",
  },
  {
    q: "개발하면서 가장 뿌듯했던 순간?",
    a: "팀원들이 만든 UI 보고 '와 이거 진짜 서비스 같아졌다'고 했을 때요.",
  },
  {
    q: "일할 때 가장 중요하게 보는 건?",
    a: "왜 그렇게 해야 하는지요. 근거가 납득되면 빠르게 움직이고, 아니면 납득될 때까지 묻습니다.",
  },
  {
    q: "앞으로 어떤 개발자가 되고 싶으세요?",
    a: "실력도 중요하지만, 결국 믿고 함께할 수 있는 개발자가 되고 싶어요.",
  },
];

// ───────────────────────── 공통 훅·컴포넌트 ─────────────────────────

/** 화면에 들어오면 true (한 번만) */
function useInView<T extends Element>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, inView]);
  return [ref, inView] as const;
}

export function Reveal({
  children,
  delay = 0,
  from = "up",
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  from?: "up" | "left" | "right";
  className?: string;
}) {
  const [ref, inView] = useInView<HTMLDivElement>(0.15);
  const dir = from === "left" ? "ab-reveal-left" : from === "right" ? "ab-reveal-right" : "";
  return (
    <div
      ref={ref}
      className={`ab-reveal ${dir} ${inView ? "ab-in" : ""} ${className}`}
      style={{ "--d": `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <Reveal className="mb-10">
      <div className="font-mono text-xs tracking-[0.2em] text-[#8B84FF] uppercase">{eyebrow}</div>
      <h2 className="mt-2 font-mono text-2xl font-bold text-white sm:text-3xl">{title}</h2>
    </Reveal>
  );
}

/** 마우스 위치를 CSS 변수(--x, --y)로 넘겨서 카드 테두리 빛이 따라오게 */
const trackSpot = (e: React.PointerEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--x", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--y", `${e.clientY - r.top}px`);
};

function CountUp({ to, from = 0, suffix = "" }: { to: number; from?: number; suffix?: string }) {
  const [ref, inView] = useInView<HTMLSpanElement>(0.6);
  const [n, setN] = useState(from);
  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    const dur = 1400;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 4);
      setN(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [inView, from, to]);
  return (
    <span ref={ref}>
      {n}
      {suffix}
    </span>
  );
}

// ───────────────────────── 섹션 ─────────────────────────

function Hero({ photos }: { photos: AboutProject[] }) {
  const heroRef = useRef<HTMLElement>(null);
  const [role, setRole] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setRole((r) => (r + 1) % ROLES.length), 2600);
    return () => clearInterval(id);
  }, []);

  // 마우스 위치(-1~1)로 배경 빛이 살짝 따라오게
  const onMove = (e: React.PointerEvent) => {
    const el = heroRef.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    el.style.setProperty("--my", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  };

  const words = ["만들고,", "끝까지", "다듬는"];

  return (
    <section
      ref={heroRef}
      onPointerMove={onMove}
      className="ab-hero relative flex min-h-[calc(100svh-6.5rem)] items-center overflow-hidden"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="ab-blob ab-blob-1" />
        <div className="ab-blob ab-blob-2" />
        <div className="ab-blob ab-blob-3" />
        <div className="ab-grid" />
      </div>

      <div className="relative mx-auto grid w-full max-w-5xl items-center gap-14 px-6 py-16 md:grid-cols-[1.15fr_1fr]">
        <div>
          <div
            className="ab-fade-up mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-xs text-white/60 backdrop-blur"
            style={{ "--d": "100ms" } as CSSProperties}
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            about me
          </div>

          <h1 className="font-mono text-[2.1rem] leading-[1.25] font-bold text-white sm:text-5xl sm:leading-[1.2]">
            {words.map((w, i) => (
              <span
                key={w}
                className="ab-word mr-[0.28em]"
                style={{ "--d": `${200 + i * 120}ms` } as CSSProperties}
              >
                {w}
              </span>
            ))}
            <br />
            <span className="ab-word" style={{ "--d": "600ms" } as CSSProperties}>
              개발자
            </span>{" "}
            <span className="ab-word" style={{ "--d": "720ms" } as CSSProperties}>
              <span className="ab-gradient-text">이건모</span>
            </span>
          </h1>

          <div
            className="ab-fade-up mt-6 h-8 overflow-hidden font-mono text-lg text-white/70 sm:text-xl"
            style={{ "--d": "950ms" } as CSSProperties}
          >
            <span className="text-white/35">&gt; </span>
            <span key={role} className="ab-role">
              {ROLES[role]}
            </span>
            <span className="ab-caret" />
          </div>

          <p
            className="ab-fade-up mt-6 max-w-md font-['Nanum_Gothic',sans-serif] leading-relaxed break-keep text-white/60"
            style={{ "--d": "1100ms" } as CSSProperties}
          >
            커머스 플랫폼에서 레거시 모놀리스와 MSA, 프론트엔드를 넘나들며 기능을 만들고 고칩니다.
            틈틈이 이 사이트를 뜯어고치고, 가끔은 알고리즘 문제를 풉니다.
          </p>

          <div
            className="ab-fade-up mt-9 flex flex-wrap gap-3"
            style={{ "--d": "1250ms" } as CSSProperties}
          >
            <Link
              href="/project/"
              className="group rounded-full bg-[#6C63FF] px-6 py-2.5 font-mono text-sm text-white shadow-[0_8px_30px_-8px_rgba(108,99,255,0.8)] transition-all hover:-translate-y-0.5 hover:bg-[#5b52f0]"
            >
              프로젝트 보기{" "}
              <span className="inline-block transition-transform group-hover:translate-x-1">→</span>
            </Link>
            <a
              href="#journey"
              className="rounded-full border border-white/15 px-6 py-2.5 font-mono text-sm text-white/70 backdrop-blur transition-colors hover:border-white/40 hover:text-white"
            >
              걸어온 길
            </a>
          </div>
        </div>

        {/* 프로젝트 사진 스택 — 마우스를 올리면 펼쳐짐 */}
        <div
          className="ab-fade-up relative mx-auto h-[300px] w-full max-w-[380px] sm:h-[340px]"
          style={{ "--d": "700ms" } as CSSProperties}
        >
          <HintBubble
            storageKey="hint:about-stack"
            device="pc"
            tail="bottom"
            maxShows={1}
            delay={2400}
            className="absolute -top-3 left-1/2 -translate-x-1/2"
          >
            사진에 <b className="text-white">마우스를 올려보세요</b>
          </HintBubble>
          <div className="ab-stack absolute inset-0 flex items-center justify-center">
            {photos.slice(0, 3).map((p, i) => (
              <Link
                key={p.idx}
                href={`/infoPage/${p.idx}/`}
                aria-label={p.name}
                className="ab-stack-card absolute w-[68%] overflow-hidden rounded-2xl border border-white/15 bg-[#1C1E24] shadow-2xl"
                style={
                  {
                    transform: `rotate(${(i - 1) * 7}deg) translate(${(i - 1) * 26}px, ${i === 1 ? -8 : 6}px)`,
                    zIndex: i === 1 ? 3 : 2 - Math.abs(i - 1),
                    "--bob": `${i * -2.2}s`,
                  } as CSSProperties
                }
              >
                <img
                  src={p.img}
                  alt=""
                  className="aspect-[4/3] w-full object-cover"
                  draggable={false}
                />
                <div className="border-t border-white/10 px-3 py-2 font-mono text-[11px] text-white/70">
                  {p.name}
                </div>
              </Link>
            ))}
          </div>
          {/* 이니셜 배지 */}
          <div className="absolute -bottom-2 left-2 z-10 h-20 w-20 sm:-left-4">
            <div className="ab-ring absolute inset-0 rounded-full" />
            <div className="absolute inset-[3px] flex items-center justify-center rounded-full bg-[#121212] font-mono text-xl font-bold text-white">
              GM
            </div>
          </div>
        </div>
      </div>

      <a
        href="#stack"
        aria-label="아래로"
        className="absolute bottom-6 left-1/2 hidden h-10 w-6 -translate-x-1/2 justify-center rounded-full border border-white/25 pt-2 sm:flex"
      >
        <span className="ab-scroll-dot h-2 w-1 rounded-full bg-white/70" />
      </a>
    </section>
  );
}

function Marquee() {
  const row = (items: string[], reverse: boolean, dur: string) => (
    <div className="ab-marquee overflow-hidden py-1.5">
      <div
        className={`ab-marquee-track ${reverse ? "ab-reverse" : ""}`}
        style={{ "--dur": dur } as CSSProperties}
      >
        {[...items, ...items].map((t, i) => {
          const [bg, border, color] = STACK_COLORS[t] ?? [
            "#1C1E24",
            "rgba(255,255,255,0.1)",
            "rgba(255,255,255,0.7)",
          ];
          return (
            <span
              key={i}
              className="mr-3 rounded-full border px-5 py-2 font-mono text-sm whitespace-nowrap"
              style={{ backgroundColor: bg, borderColor: border, color }}
            >
              {t}
            </span>
          );
        })}
      </div>
    </div>
  );
  return (
    <section id="stack" className="scroll-mt-28 border-y border-white/5 bg-white/[0.015] py-10">
      <Reveal>
        <p className="mb-5 text-center font-mono text-xs text-white/35">
          실무와 프로젝트에서 써온 기술
        </p>
        {row(STACK_ROW_1, false, "45s")}
        {row(STACK_ROW_2, true, "50s")}
      </Reveal>
    </section>
  );
}

function Numbers() {
  return (
    <section className="mx-auto max-w-5xl px-6 pt-20">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {NUMBERS.map((n, i) => (
          <Reveal key={n.label} delay={i * 90}>
            <div
              onPointerMove={trackSpot}
              className="ab-spot rounded-2xl border border-white/10 bg-[#1C1E24] px-5 py-6 text-center"
            >
              <div className="font-mono text-3xl font-bold text-white sm:text-4xl">
                <CountUp to={n.value} from={n.from} suffix={n.suffix} />
              </div>
              <div className="mt-2 font-mono text-xs text-white/40">{n.label}</div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Traits() {
  return (
    <section className="mx-auto max-w-5xl px-6 pt-28">
      <SectionTitle eyebrow="How I work" title="이런 개발자입니다" />
      <div className="grid gap-4 md:grid-cols-2">
        {TRAITS.map((t, i) => (
          <Reveal key={t.title} delay={(i % 2) * 120}>
            <div
              onPointerMove={trackSpot}
              className="ab-spot group h-full rounded-2xl border border-white/10 bg-[#1C1E24] p-6 transition-transform duration-500 hover:-translate-y-1"
            >
              <div className="relative">
                <div className="mb-4 font-mono text-4xl font-bold text-white/[0.07] transition-colors duration-500 group-hover:text-[#6C63FF]/40">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <h3 className="mb-2 font-mono text-lg font-medium text-white">{t.title}</h3>
                <p className="font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed break-keep text-white/60">
                  {t.body}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {t.proof.map((p) => (
                    <Link
                      key={p.label}
                      href={p.href}
                      className="rounded-full border border-white/10 px-2.5 py-0.5 font-mono text-[11px] text-white/50 transition-colors hover:border-[#6C63FF]/60 hover:text-white"
                    >
                      {p.label} →
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/** 가로 스크롤 영역용 커스텀 스크롤바 (드래그·트랙 클릭·화살표) */
function useHScroll() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState({ left: 0, width: 100, atStart: true, atEnd: false });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      const width = Math.max(12, (el.clientWidth / el.scrollWidth) * 100);
      const ratio = max > 0 ? el.scrollLeft / max : 0;
      setBar({
        left: ratio * (100 - width),
        width,
        atStart: el.scrollLeft < 4,
        atEnd: el.scrollLeft > max - 4,
      });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  // 트랙 위 위치(px) → 스크롤 위치
  const scrollToTrackX = (x: number, behavior: ScrollBehavior) => {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const ratio = Math.min(1, Math.max(0, x / track.clientWidth));
    el.scrollTo({ left: ratio * (el.scrollWidth - el.clientWidth), behavior });
  };

  const onThumbDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startLeft = el.scrollLeft;
    // 썸이 움직일 수 있는 거리만큼이 전체 스크롤 범위
    const scale =
      (el.scrollWidth - el.clientWidth) /
      (track.clientWidth * (1 - el.clientWidth / el.scrollWidth));
    el.style.scrollSnapType = "none";
    const move = (ev: PointerEvent) => (el.scrollLeft = startLeft + (ev.clientX - startX) * scale);
    const up = () => {
      el.style.scrollSnapType = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onTrackDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    scrollToTrackX(e.clientX - r.left, "smooth");
  };

  const step = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (el) el.scrollBy({ left: dir * Math.min(360, el.clientWidth * 0.8), behavior: "smooth" });
  };

  return { scrollRef, trackRef, bar, onThumbDown, onTrackDown, step };
}

function Projects({ projects }: { projects: AboutProject[] }) {
  const { scrollRef, trackRef, bar, onThumbDown, onTrackDown, step } = useHScroll();
  const [barRef, barInView] = useInView<HTMLDivElement>(0.8);
  const arrow =
    "flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/10 font-mono text-sm text-white/60 transition-all hover:border-[#6C63FF]/60 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:border-white/10 disabled:hover:text-white/60";
  return (
    <section className="pt-28">
      <div className="mx-auto max-w-5xl px-6">
        <SectionTitle eyebrow="Selected work" title="만들어 온 것들" />
      </div>
      <Reveal>
        <div
          ref={scrollRef}
          className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 [scrollbar-width:none] md:px-[max(1.5rem,calc((100vw-64rem)/2+1.5rem))] [&::-webkit-scrollbar]:hidden"
        >
          {projects.map((p) => (
            <Link
              key={p.idx}
              href={`/infoPage/${p.idx}/`}
              className="group relative w-[78vw] max-w-[340px] shrink-0 snap-start overflow-hidden rounded-2xl border border-white/10 bg-[#1C1E24] transition-colors hover:border-[#6C63FF]/50"
            >
              <div className="relative aspect-[16/10] overflow-hidden">
                <img
                  src={p.img}
                  alt={p.name}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#1C1E24] via-[#1C1E24]/20 to-transparent" />
              </div>
              <div className="p-5 pt-3">
                <h3 className="font-mono text-base font-medium text-white">{p.name}</h3>
                <p className="mt-1 line-clamp-2 font-['Nanum_Gothic',sans-serif] text-xs leading-relaxed break-keep text-white/50">
                  {p.desc}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {p.tech.slice(0, 4).map((t) => (
                    <span
                      key={t}
                      className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-white/45"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </Link>
          ))}
          <Link
            href="/project/"
            className="flex w-40 shrink-0 snap-start items-center justify-center rounded-2xl border border-dashed border-white/15 font-mono text-sm text-white/50 transition-colors hover:border-[#6C63FF]/60 hover:text-white"
          >
            전체 보기 →
          </Link>
        </div>
        <div ref={barRef} className="relative mx-auto mt-5 flex max-w-5xl items-center gap-4 px-6">
          {/* 화면에 들어왔을 때 넘기는 법 안내 */}
          <HintBubble
            storageKey="hint:about-gallery"
            tail="bottom"
            maxShows={2}
            delay={400}
            active={barInView}
            className="absolute bottom-full left-1/2 mb-3 -translate-x-1/2"
            mobile={<>옆으로 밀어서 넘겨보세요</>}
          >
            바를 <b className="text-white">드래그</b>하거나 <b className="text-white">← →</b> 로
            넘겨보세요
          </HintBubble>
          <div
            ref={trackRef}
            onPointerDown={onTrackDown}
            className="group relative h-6 flex-1 cursor-pointer"
            role="presentation"
          >
            <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/[0.07]" />
            <div
              onPointerDown={onThumbDown}
              className="absolute top-1/2 h-[3px] -translate-y-1/2 cursor-grab touch-none rounded-full bg-gradient-to-r from-[#6C63FF] to-[#2dd4bf] transition-[height] group-hover:h-[6px] active:cursor-grabbing"
              style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              aria-label="이전"
              onClick={() => step(-1)}
              disabled={bar.atStart}
              className={arrow}
            >
              ←
            </button>
            <button
              type="button"
              aria-label="다음"
              onClick={() => step(1)}
              disabled={bar.atEnd}
              className={arrow}
            >
              →
            </button>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Journey() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);

  // 스크롤 진행에 맞춰 세로 선이 채워짐
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = wrapRef.current;
      if (!el || !fillRef.current) return;
      const r = el.getBoundingClientRect();
      const mid = window.innerHeight * 0.6;
      const p = Math.min(1, Math.max(0, (mid - r.top) / r.height));
      fillRef.current.style.setProperty("--p", p.toFixed(3));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section id="journey" className="mx-auto max-w-3xl scroll-mt-28 px-6 pt-28">
      <SectionTitle eyebrow="Journey" title="여기까지 온 길" />
      <div ref={wrapRef} className="relative pl-8 sm:pl-10">
        <div className="absolute top-2 bottom-2 left-[7px] w-px bg-white/10 sm:left-[11px]" />
        <div
          ref={fillRef}
          className="ab-timeline-fill absolute top-2 bottom-2 left-[7px] w-px bg-gradient-to-b from-[#6C63FF] to-[#2dd4bf] sm:left-[11px]"
        />
        <ol className="flex flex-col gap-10">
          {JOURNEY.map((j) => (
            <JourneyItem key={j.year} {...j} />
          ))}
        </ol>
      </div>
    </section>
  );
}

function JourneyItem({ year, title, body }: { year: string; title: string; body: string }) {
  const [ref, inView] = useInView<HTMLLIElement>(0.3);
  return (
    <li ref={ref} className="relative">
      {/* 점은 Reveal(transform) 밖에 둬야 위치가 흔들리지 않음 */}
      <span
        className={`ab-dot absolute top-1.5 -left-8 h-[15px] w-[15px] rounded-full border-2 border-[#121212] bg-white/20 sm:-left-10 sm:h-[23px] sm:w-[23px] sm:border-4 ${inView ? "ab-dot-on" : ""}`}
      />
      <div className={`ab-reveal ab-reveal-right ${inView ? "ab-in" : ""}`}>
        <div className="font-mono text-sm text-[#8B84FF]">{year}</div>
        <h3 className="mt-1 font-mono text-lg font-medium text-white">{title}</h3>
        <p className="mt-1.5 font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed break-keep text-white/55">
          {body}
        </p>
      </div>
    </li>
  );
}

function Terminal() {
  const [ref, inView] = useInView<HTMLDivElement>(0.4);
  const [shown, setShown] = useState(0);
  const total = FACTS.length + 1;

  useEffect(() => {
    if (!inView || shown >= total) return;
    const id = setTimeout(() => setShown((s) => s + 1), shown === 0 ? 300 : 260);
    return () => clearTimeout(id);
  }, [inView, shown, total]);

  return (
    <section className="mx-auto max-w-3xl px-6 pt-28">
      <SectionTitle eyebrow="whoami" title="한 줄씩 보면" />
      <Reveal>
        <div
          ref={ref}
          className="overflow-hidden rounded-2xl border border-white/10 bg-[#16171c] shadow-[0_30px_80px_-30px_rgba(108,99,255,0.35)]"
        >
          <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/70" />
            <span className="ml-3 font-mono text-[11px] text-white/30">C:\Gunmo — cmd</span>
          </div>
          <div className="overflow-x-auto p-5 font-mono text-[13px] leading-7 text-white/70 sm:text-sm">
            {FACTS.map((f, i) => (
              <div
                key={f.key}
                className={`ab-type-line whitespace-nowrap ${i < shown ? "ab-shown" : ""}`}
              >
                <span className="text-[#8B84FF]">C:\Gunmo\{f.key}&gt;</span>{" "}
                <span className="text-white">{f.value}</span>
              </div>
            ))}
            <div className={`ab-type-line mt-3 text-white/40 ${shown >= total ? "ab-shown" : ""}`}>
              C:\Gunmo&gt; git commit -m &quot;keep going&quot;
              <span className="ab-caret" />
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function QnA() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="mx-auto max-w-3xl px-6 pt-28">
      <SectionTitle eyebrow="Q & A" title="자주 듣는 질문들" />
      <div className="flex flex-col gap-2">
        {QA.map((item, i) => {
          const isOpen = open === i;
          return (
            <Reveal key={item.q} delay={i * 60}>
              <div
                className={`rounded-2xl border transition-colors ${isOpen ? "border-[#6C63FF]/40 bg-[#1C1E24]" : "border-white/10"}`}
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left"
                >
                  <span className="font-['Nanum_Gothic',sans-serif] text-[15px] text-white">
                    Q. {item.q}
                  </span>
                  <span
                    className={`font-mono text-lg text-white/40 transition-transform duration-300 ${isOpen ? "rotate-45 text-[#A9A3FF]" : ""}`}
                  >
                    +
                  </span>
                </button>
                <div className={`ab-qa-body ${isOpen ? "ab-open" : ""}`}>
                  <div className="overflow-hidden">
                    <p className="px-5 pb-5 font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed break-keep text-white/60">
                      A. {item.a}
                    </p>
                  </div>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

function Outro() {
  return (
    <section className="mx-auto max-w-3xl px-6 pt-28 pb-28 text-center">
      <Reveal>
        <p className="font-mono text-xl leading-relaxed font-medium break-keep text-white sm:text-2xl">
          &ldquo;혼자 잘하는 사람보다,
          <br />
          <span className="ab-gradient-text">같이 잘할 수 있는 사람</span>이 되겠습니다.&rdquo;
        </p>
      </Reveal>
      <Reveal delay={150}>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link
            href="/works/"
            className="rounded-full bg-[#6C63FF] px-6 py-2.5 font-mono text-sm text-white transition-colors hover:bg-[#5b52f0]"
          >
            프로젝트 · 공부 기록
          </Link>
          <Link
            href="/archive/"
            className="rounded-full border border-white/15 px-6 py-2.5 font-mono text-sm text-white/70 transition-colors hover:border-white/40 hover:text-white"
          >
            작업 아카이브
          </Link>
          <a
            href="https://github.com/rjsah5676"
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-white/15 px-6 py-2.5 font-mono text-sm text-white/70 transition-colors hover:border-white/40 hover:text-white"
          >
            GitHub ↗
          </a>
        </div>
      </Reveal>
    </section>
  );
}

export default function AboutLanding({ projects }: { projects: AboutProject[] }) {
  // 히어로 사진 스택: 이미지가 화면 캡처인 대표 프로젝트 3개
  const heroPhotos = [10, 11, 1]
    .map((idx) => projects.find((p) => p.idx === idx))
    .filter((p): p is AboutProject => !!p);
  return (
    <div className="overflow-x-clip">
      <Hero photos={heroPhotos} />
      <Marquee />
      <Numbers />
      <Terminal />
      <Traits />
      <Projects projects={projects} />
      <Journey />
      <QnA />
      <Outro />
    </div>
  );
}
