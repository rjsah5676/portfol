/**
 * 기술 가이드 — 메인 화면 왼쪽 위 버튼 → 모달 (패치노트와 같은 금테 판, 전체화면에서도 보임).
 * 왼쪽에서 고르고(↑↓) 오른쪽에서 읽음: 기본 콤보 · 기술 사전 · 상태 이상 · 캐릭터 6명.
 * 내용은 guideData.ts.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CHARS } from "@/lib/fight/chars";
import { sfxUi } from "@/lib/fight/sfx";
import { BASIC_COMBOS, CHAR_GUIDE, STATUS, TECH, type Combo } from "./guideData";
import { KeyCap, keyText } from "./KeyCap";

const KR = "font-['Nanum_Gothic',sans-serif]";
const TITLE = "font-['Black_Han_Sans',sans-serif]";
const PX = "[image-rendering:pixelated]";
const face = (id: string) => `/fight/art/${id}-face.webp`;

type Tab = { id: string; label: string; icon?: string; color?: string };
const TABS: Tab[] = [
  { id: "basic", label: "기본 콤보" },
  { id: "tech", label: "기술 사전" },
  { id: "status", label: "상태 이상" },
  ...CHARS.filter((c) => CHAR_GUIDE[c.id]).map((c) => ({
    id: c.id,
    label: c.name,
    icon: face(c.id),
    color: c.color,
  })),
];

/** 콤보 한 줄: 누르는 순서를 칸으로 나눠 보여 줌 */
function ComboRow({ c }: { c: Combo }) {
  const steps = c.keys.split("→").map((s) => s.trim());
  return (
    <div className="rounded-[0.6cqw] bg-white/[0.05] px-[1.2cqw] py-[0.9cqw]">
      <div className="flex flex-wrap items-center gap-x-[0.5cqw] gap-y-[0.5cqw]">
        <span className="mr-[0.6cqw] text-[1.3cqw] font-extrabold text-[#FFE9A8]">{c.name}</span>
        {steps.map((s, i) => (
          <span key={i} className="flex items-center gap-[0.5cqw]">
            {i > 0 && <span className="text-[1.1cqw] text-[#F2C35B]/70">▸</span>}
            <span className="rounded-[0.4cqw] bg-black/35 px-[0.7cqw] py-[0.25cqw] text-[1.25cqw] font-bold whitespace-nowrap text-white">
              {keyText(s)}
            </span>
          </span>
        ))}
      </div>
      {c.note && (
        <p className="mt-[0.5cqw] text-[1.15cqw] leading-snug break-keep text-white/60">
          {keyText(c.note)}
        </p>
      )}
    </div>
  );
}

function Head({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-[0.7cqw] flex items-center gap-[0.6cqw] text-[1.3cqw] font-extrabold text-[#F2C35B]">
      <span className="h-[1.2cqw] w-[0.3cqw] rounded-full bg-[#F2C35B]" />
      {children}
    </h3>
  );
}

function Basic() {
  return (
    <>
      <p className="mb-[1.2cqw] text-[1.25cqw] leading-relaxed break-keep text-white/75">
        콤보는 <b className="text-white">띄우고 → 따라 올라가서 → 공중에서 치고 → 내려찍기</b> 한
        흐름이에요. 버튼은 약 <KeyCap k="J" /> 발차기 <KeyCap k="K" /> 아이덴티티 <KeyCap k="L" />{" "}
        필살기 <KeyCap k="I" /> 네 개뿐이고, 같은 버튼을 이어 누르면 다음 동작이 나가요.
      </p>
      <Head>따라 해 보기 (모든 캐릭터)</Head>
      <div className="flex flex-col gap-[0.6cqw]">
        {BASIC_COMBOS.map((c) => (
          <ComboRow key={c.name} c={c} />
        ))}
      </div>
      <p className="mt-[1.2cqw] text-[1.15cqw] leading-relaxed break-keep text-white/50">
        콤보가 길어질수록 한 대의 피해가 줄고, 띄운 지 2초가 지나면 상대가 점점 빨리 떨어져서 무한
        콤보는 안 돼요. 메인 화면의 연습 모드에서 허수아비에게 넣어 보면 히트 수와 피해가 나와요.
      </p>
    </>
  );
}

function Tech() {
  return (
    <div className="flex flex-col gap-[1.4cqw]">
      {TECH.map((g) => (
        <section key={g.title}>
          <Head>{g.title}</Head>
          <dl className="grid grid-cols-[auto_1fr] gap-x-[1.2cqw] gap-y-[0.6cqw]">
            {g.items.map(([t, d]) => (
              <div key={t} className="contents">
                <dt className="text-[1.25cqw] font-bold whitespace-nowrap text-white">{t}</dt>
                <dd className="text-[1.2cqw] leading-snug break-keep text-white/65">{keyText(d)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function Status() {
  return (
    <>
      <p className="mb-[1.2cqw] text-[1.25cqw] leading-relaxed break-keep text-white/75">
        캐릭터마다 아이덴티티 <KeyCap k="L" /> · 필살기 <KeyCap k="I" /> 에 맞으면 걸리는 상태가
        달라요. 걸리면 머리 위에 표시가 떠요.
      </p>
      <div className="flex flex-col gap-[0.6cqw]">
        {STATUS.map(([n, who, col, d]) => (
          <div key={n} className="flex items-start gap-[1cqw] rounded-[0.6cqw] bg-white/[0.05] px-[1.2cqw] py-[0.8cqw]">
            <span
              className="mt-[0.1cqw] w-[6.4cqw] shrink-0 rounded-[0.3cqw] py-[0.15cqw] text-center text-[1.15cqw] font-extrabold text-black"
              style={{ background: col }}
            >
              {n}
            </span>
            <span className="w-[4cqw] shrink-0 text-[1.2cqw] font-bold text-white/80">{who}</span>
            <span className="min-w-0 text-[1.2cqw] leading-snug break-keep text-white/65">{d}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function Char({ id }: { id: string }) {
  const c = CHARS.find((x) => x.id === id)!;
  const g = CHAR_GUIDE[id];
  return (
    <>
      <div className="mb-[1.2cqw] flex items-center gap-[1.2cqw]">
        <img
          src={face(id)}
          alt=""
          className={`h-[7cqw] w-[8.4cqw] rounded-[0.6cqw] border-[0.25cqw] object-cover ${PX}`}
          style={{ borderColor: c.color }}
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-[0.9cqw]">
            <span className={`${TITLE} text-[2.2cqw]`} style={{ color: c.color }}>
              {c.name}
            </span>
            <span className="text-[1.2cqw] text-white/55">{g.style}</span>
            <span className="text-[1.1cqw] text-[#F2C35B]/80">
              난이도 {"★".repeat(c.difficulty)}
              {"☆".repeat(3 - c.difficulty)}
            </span>
          </div>
          <p className="mt-[0.4cqw] text-[1.2cqw] leading-snug break-keep text-white/75">{g.plan}</p>
        </div>
      </div>
      <Head>기술</Head>
      <ul className="mb-[1.3cqw] flex flex-col gap-[0.45cqw]">
        {g.points.map((p) => (
          <li key={p} className="flex gap-[0.7cqw] text-[1.2cqw] leading-snug break-keep text-white/75">
            <span className="mt-[0.5cqw] h-[0.5cqw] w-[0.5cqw] shrink-0 rotate-45 bg-[#F2C35B]/80" />
            <span>{keyText(p)}</span>
          </li>
        ))}
      </ul>
      <Head>{c.name} 콤보</Head>
      <div className="flex flex-col gap-[0.6cqw]">
        {g.combos.map((x) => (
          <ComboRow key={x.name} c={x} />
        ))}
      </div>
    </>
  );
}

export default function TechGuide({ onClose, initial }: { onClose: () => void; initial?: string }) {
  const [tab, setTab] = useState(() => (TABS.some((t) => t.id === initial) ? initial! : "basic"));
  const bodyRef = useRef<HTMLDivElement>(null);

  // 열린 동안엔 키 입력을 메뉴로 안 보냄. ↑↓(W·S) 항목 이동, Esc 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      const k = e.code;
      const d = k === "ArrowUp" || k === "KeyW" ? -1 : k === "ArrowDown" || k === "KeyS" ? 1 : 0;
      if (d) {
        e.preventDefault();
        sfxUi("move");
        setTab((cur) => TABS[(TABS.findIndex((t) => t.id === cur) + d + TABS.length) % TABS.length].id);
      } else if (k === "Escape" || k === "Backspace") {
        e.preventDefault();
        sfxUi("back");
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // 항목을 바꾸면 맨 위부터
  useEffect(() => {
    bodyRef.current?.scrollTo(0, 0);
  }, [tab]);

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-[2px] [animation:modal-fade_150ms_ease-out]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`${KR} relative flex h-[90%] w-[88cqw] flex-col rounded-[1cqw] bg-[linear-gradient(180deg,#F2C35B,#9A6A1E)] p-[0.25cqw] shadow-[0_1cqw_3cqw_rgba(0,0,0,0.6)] [animation:modal-pop_200ms_ease-out]`}
      >
        <div className="flex min-h-0 flex-1 flex-col rounded-[0.8cqw] bg-[linear-gradient(180deg,#2B1840,#140A22)]">
          <div className="flex items-center justify-between border-b border-[#F2C35B]/30 px-[2cqw] py-[1cqw]">
            <span className="flex items-baseline gap-[1cqw]">
              <span className={`${TITLE} text-[2.4cqw] tracking-wide text-[#FFE9A8] [text-shadow:0_0.2cqw_0_#12081F]`}>
                기술 가이드
              </span>
              <span className="text-[1.1cqw] text-white/40">↑ ↓ 항목 · Esc 닫기</span>
            </span>
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-full bg-white/10 px-[1.2cqw] py-[0.3cqw] text-[1.2cqw] text-white/75 hover:bg-white/20"
            >
              닫기 ✕
            </button>
          </div>
          <div className="flex min-h-0 flex-1">
            <nav className="gold-scroll flex w-[17cqw] shrink-0 flex-col gap-[0.35cqw] overflow-y-auto border-r border-white/10 p-[1cqw]">
              {TABS.map((t, i) => {
                const on = t.id === tab;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      sfxUi("move");
                      setTab(t.id);
                    }}
                    className={`flex cursor-pointer items-center gap-[0.7cqw] rounded-[0.5cqw] px-[0.9cqw] py-[0.55cqw] text-left text-[1.3cqw] font-bold transition-colors ${
                      on ? "bg-[#F2C35B] text-[#2A0E3A]" : "text-white/70 hover:bg-white/10 hover:text-white"
                    } ${i === 3 ? "mt-[0.8cqw]" : ""}`}
                  >
                    {t.icon ? (
                      <img src={t.icon} alt="" className={`h-[2.2cqw] w-[2.6cqw] rounded-[0.3cqw] object-cover ${PX}`} />
                    ) : (
                      <span className={`h-[0.6cqw] w-[0.6cqw] rotate-45 ${on ? "bg-[#2A0E3A]" : "bg-[#F2C35B]/70"}`} />
                    )}
                    {t.label}
                  </button>
                );
              })}
            </nav>
            <div ref={bodyRef} className="gold-scroll min-h-0 flex-1 overflow-y-auto px-[2cqw] py-[1.4cqw]">
              {tab === "basic" ? <Basic /> : tab === "tech" ? <Tech /> : tab === "status" ? <Status /> : <Char id={tab} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
