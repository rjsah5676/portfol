"use client";

/**
 * 튜토리얼 — 게임 중 상황이 오면 한 장씩 나오는 안내 카드 (처음 하는 사람용, 디펜스와 같은 방식).
 * 본 카드는 이 기기에 기억 (localStorage virus-idle-tut) · 「튜토리얼 끄기」 · 메뉴의 「튜토리얼」 로 처음부터.
 * 게임을 멈추지 않음. 순서대로 하나씩만 — 조건이 아직 안 된 카드는 건너뛰고 뒤 카드가 먼저 나올 수 있음.
 */
import { useState } from "react";
import { BAL, MOBS_PER_STAGE, isFinalStage, type Save } from "@/lib/virus/logic";

const KR = "font-['Nanum_Gothic',sans-serif]";

/** 카드 조건이 보는 것 (저장본 + 지금 화면) */
export interface TutCtx {
  s: Save;
  /** 지금 적 */
  e: { boss: boolean; apex: boolean; final: boolean };
  /** 지금 변이할 수 있음 */
  formatReady: boolean;
}

interface Step {
  id: string;
  icon: string;
  title: string;
  text: string;
  when(c: TutCtx): boolean;
}

const STEPS: Step[] = [
  {
    id: "start",
    icon: "🦠",
    title: "me.exe 가 퍼지는 중",
    text: `내 바이러스가 코드를 알아서 쏘아 파일을 감염시키고 데이터를 훔쳐 와요. 따로 누를 건 없어요. 파일 ${MOBS_PER_STAGE}개를 감염시키면 그 네트워크의 보스가 나와요.`,
    when: () => true,
  },
  {
    id: "upgrade",
    icon: "⬆️",
    title: "업그레이드",
    text: "훔친 데이터로 아래 「업그레이드」 탭에서 페이로드(피해) · 오버클럭(발사 속도) · 익스플로잇(치명타)을 올려요. ▲ 는 한 레벨씩, 🎲 랜덤 강화는 1~3레벨이 무작위로 올라요.",
    when: ({ s }) => s.rec.files >= 3,
  },
  {
    id: "boss",
    icon: "☠️",
    title: "보스!",
    text: "아래 시간 줄이 다 닳기 전에 격퇴하면 다음 스테이지로. 보스를 잡으면 그 바이러스의 코드 조각도 얻어요.",
    when: ({ e }) => e.boss && !e.apex && !e.final,
  },
  {
    id: "fail",
    icon: "🚫",
    title: "차단당했어요",
    text: "괜찮아요 — 파일을 감염시키며 데이터를 모으고 업그레이드한 뒤 「보스 재도전」을 누르세요. (커널 권한 「자동 재도전」을 열면 알아서)",
    when: ({ s }) => s.bossFail,
  },
  {
    id: "module",
    icon: "📦",
    title: "코드 모듈",
    text: "보스에게서 빼앗은 코드 조각이 모이면 「코드 모듈」 탭의 ▲ (또는 F 키)로 컴파일 — 첫 발 강타 · 추가 발사 · DDoS 폭격 같은 공격 효과가 붙어요. 조각 · 모듈은 변이해도 남아요.",
    when: ({ s }) => s.frag.some((v) => v > 0) || s.mods.some((v) => v > 0),
  },
  {
    id: "apex",
    icon: "🛡️",
    title: "상위 보스",
    text: "10스테이지마다 보스 다음에 그 네트워크의 보안 시스템이 나와요 (체력 2배 · 45초). 처음 잡으면 영구 「우회 기술」과 새 외형을 얻어요.",
    when: ({ e }) => e.apex,
  },
  {
    id: "bypass",
    icon: "🔑",
    title: "우회 기술",
    text: "「우회 기술」 탭에서 상위 보스가 주는 🔑 우회 키로 버전을 올려요. 키는 공용이라 어느 기술에 써도 돼요.",
    when: ({ s }) => s.byp.some((v) => v > 0),
  },
  {
    id: "format",
    icon: "🧬",
    title: "변이할 수 있어요",
    text: "막혔다면 「변이」 탭에서 변이 — 업그레이드 · 데이터를 버리고 앞 스테이지부터 다시 퍼지는 대신 루트 권한을 받아요 (1당 피해 +3%). 최고 기록을 넘을수록 많이 받아요.",
    when: ({ formatReady }) => formatReady,
  },
  {
    id: "root",
    icon: "🛒",
    title: "루트 상점",
    text: "루트 권한은 「루트 상점」에서 써요 (써도 피해 보너스는 그대로). ⚔️ 효율 강화부터 — 🛠️ 편의성(프로파일러 → 크론잡 → 크론 데몬 …)은 최고 스테이지를 넘으면 차례로 열려요.",
    when: ({ s }) => s.formats > 0 && s.root > 0,
  },
  {
    id: "gp",
    icon: "💎",
    title: "업적 · GP",
    text: "업적을 달성하면 피해 +2%, 로그인했다면 위 🏅 [업적]에서 사이트 GP도 받아요. 💎 GP 상점에는 패키지 · 커널 코어 · 시간 가속 · 스킨이 있어요 (편의성은 노력으로도 다 열려요).",
    when: ({ s }) => s.ach.length > 0 && s.formats > 0,
  },
  {
    id: "core",
    icon: "🧩",
    title: "커널 코어",
    text: "100스테이지마다 처음 넘으면 커널 코어를 받아요. 루트 상점 「커널」에서 자동 재도전 · 장기 잠복 · 자동 변이 … 를 위에서부터 차례로 열어요.",
    when: ({ s }) => s.cores > 0,
  },
  {
    id: "ks",
    icon: "☢️",
    title: "KILLSWITCH — 무한 모드",
    text: `잡을 때마다 다음 버전이 나와요. 잡으면 「각인」 모든 피해 ×${BAL.ksBonus} (영구), 지면 「패치 분석」 다음 도전 피해 ×${BAL.ksStudy}씩 쌓여요. 버전마다 루트 권한도 더 — 변이를 섞어 가며 올라가 보세요.`,
    when: ({ s }) => isFinalStage(s.stage),
  },
];

const KEY = "virus-idle-tut";
interface Saved {
  done: string[];
  off: boolean;
}
function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
    if (v && Array.isArray(v.done)) return { done: v.done, off: !!v.off };
  } catch {}
  return { done: [], off: false };
}
function save(v: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {}
}
/** 튜토리얼을 처음부터 다시 (메뉴) */
export function resetTutorial() {
  save({ done: [], off: false });
}
/** 끄기 (메뉴 버튼을 한 번 더 누르면) */
export function stopTutorial() {
  save({ ...load(), off: true });
}
/** 지금 켜져 있나 (꺼지지 않았고 아직 볼 카드가 남음) */
export function tutorialOn() {
  const v = load();
  return !v.off && v.done.length < STEPS.length;
}
/**
 * 튜토리얼이 생기기 전(v1.4 까지)부터 하던 사람은 처음엔 꺼 둠 — 메뉴에서 켤 수 있음.
 * 이 기기에 튜토리얼 기록이 없고 이미 멀리 갔으면 (최고 스테이지 31 이상)
 */
export function initTutorial(s: Save) {
  try {
    if (localStorage.getItem(KEY) == null && s.best > 31) stopTutorial();
  } catch {}
}

/** 지금 보여 줄 안내 카드 (전투 화면 위쪽 가운데에 겹쳐 그림) */
export function TutorialCard({ ctx }: { ctx: TutCtx }) {
  const [st, setSt] = useState<Saved>(load);
  if (st.off) return null;
  const step = STEPS.find((x) => !st.done.includes(x.id) && x.when(ctx));
  if (!step) return null;
  const n = STEPS.indexOf(step) + 1;
  const set = (v: Saved) => (save(v), setSt(v));
  return (
    <div className={`pointer-events-none absolute inset-x-3 top-14 z-20 flex justify-center ${KR}`}>
      <div
        className="vg-tut pointer-events-auto flex w-full max-w-[560px] items-start gap-2.5 rounded-xl border border-emerald-300/50 bg-[#030806]/95 p-2.5 backdrop-blur-sm shadow-[0_0_24px_rgba(52,211,153,0.25)]"
        role="status"
        onPointerDown={(ev) => ev.stopPropagation()}
      >
        <span className="text-xl leading-none" aria-hidden>
          {step.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <b className="vt-sm text-emerald-200">{step.title}</b>
            <span className="font-mono vt-xs whitespace-nowrap text-white/70">
              튜토리얼 {n}/{STEPS.length}
            </span>
          </p>
          <p className="mt-0.5 vt-xs leading-snug text-white/90">{step.text}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            onClick={() => set({ ...st, done: [...st.done, step.id] })}
            className="rounded-lg border border-emerald-300/60 bg-emerald-400/20 px-2.5 py-1 vt-xs font-bold text-emerald-100 hover:bg-emerald-400/30"
          >
            알겠어요
          </button>
          <button
            type="button"
            onClick={() => set({ ...st, off: true })}
            className="rounded-lg border border-white/20 px-2 py-0.5 vt-xs text-white/70 hover:text-white"
          >
            끄기
          </button>
        </div>
      </div>
    </div>
  );
}
