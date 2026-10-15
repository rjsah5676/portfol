"use client";

/**
 * 튜토리얼 — 판 안에서 상황이 오면 한 장씩 나오는 안내 카드 (처음 하는 사람용).
 * 본 카드는 이 기기에 기억 (localStorage pgd-tut) · 「튜토리얼 끄기」 · 메뉴/일시정지의 「튜토리얼 다시 보기」 로 처음부터.
 * 카드가 떠 있는 동안은 판이 멈춤 (솔로 — 「알겠어요」를 누르면 다시 흐름). 순서대로 하나씩만.
 */
import { useEffect, useState } from "react";
import { B, BOSS_EVERY } from "@/lib/defense/balance";
import { STACK, type Board } from "@/lib/defense/sim";
import { UNIT } from "@/lib/defense/units";
import { Btn, TITLE } from "./ui";

interface Step {
  id: string;
  title: string;
  text: string;
  when(b: Board): boolean;
}

const STEPS: Step[] = [
  {
    id: "start",
    title: "시작 치트 코드",
    text: "이 판의 운영 방식을 하나 골라요. 처음이면 「연합 프로토콜」(레전드를 얻을 때마다 무료 소환 2회)이 무난해요.",
    when: (b) => b.cheat?.kind === "patch",
  },
  {
    id: "summon",
    title: "소환 (Q)",
    text: "골드로 수호자를 불러요. 가운데 칸에 놓이고, 둘레 길을 도는 적을 알아서 공격해요. 필드에 적이 100마리 쌓이면 패배!",
    when: (b) => !b.cheat && b.wave <= 2,
  },
  {
    id: "merge",
    title: "합성 (W)",
    text: "같은 유닛 3기가 한 칸에 모이면 그 칸을 누르고 합성 → 한 등급 위 유닛이 나와요 (노말 → 레어 → 에픽 → 레전드). 칸을 끌어 자리를 바꿀 수 있어요.",
    when: (b) => b.cells.some((c) => c.def && c.units.length >= STACK && UNIT[c.def].grade < 3),
  },
  {
    id: "up",
    title: "강화 · 소환 확률",
    text: "강화는 세력마다 피해 +10%/Lv — 필드에 많은 세력부터. 소환 확률(5)을 올리면 에픽 · 레전드가 더 잘 나와요.",
    when: (b) => b.wave >= 3 && !b.cheat,
  },
  {
    id: "stone",
    title: "행운석 · 균열",
    text: `행운석으로 에픽(${B.gamble.E.from}웨이브~) · 레전드(${B.gamble.L.from}웨이브~) 도박을 할 수 있어요. 균열을 열어 센 적을 잡으면 행운석을 더 받아요.`,
    when: (b) => b.wave >= B.gamble.E.from && !b.cheat,
  },
  {
    id: "boss",
    title: "보스!",
    text: "보스는 제한 시간 안에 잡아야 해요. 잡으면 골드 · 행운석 · 골라 뽑기권, 그리고 치트 코드를 하나 고를 수 있어요.",
    when: (b) => b.phase === "boss" && b.wave % BOSS_EVERY === 0,
  },
  {
    id: "cheat",
    title: "치트 코드",
    text: "3장 중 하나를 골라 이 판 끝까지 써요. 마음에 안 들면 카드마다 「다시 뽑기」 1번. 고른 코드는 위쪽 「필드의 적」 옆에 쌓여요.",
    when: (b) => b.cheat?.kind === "cheat",
  },
  {
    id: "recipe",
    title: "조합식 (R)",
    text: "레전드부터는 합성 대신 조합식 — 재료를 모으면 신화 · 히든을 만들어요. 만들 수 있는 조합이 맨 위에 떠요.",
    when: (b) => !b.cheat && b.cells.some((c) => c.def && UNIT[c.def].grade >= 3),
  },
  {
    id: "end",
    title: "판이 끝나면",
    text: "회원은 픽셀 조각 · 유닛 카드 · 글리치 코어를 받아요. 정비소에서 유닛 강화 · 연구 · 유물로 영구 성장 → 더 높은 오염 단계에 도전!",
    when: (b) => !!b.result,
  },
];

const KEY = "pgd-tut";
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
/** 튜토리얼을 처음부터 다시 (메뉴 · 일시정지) */
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

/** 지금 보여 줄 안내 카드 (필드 아래쪽에 겹쳐 그림) */
export function TutorialCard({ b, onHold }: { b: Board; onHold?: (on: boolean) => void }) {
  const [st, setSt] = useState<Saved>(load);
  const step = st.off ? undefined : STEPS.find((s) => !st.done.includes(s.id) && s.when(b));
  // 카드가 떠 있는 동안 판을 멈춤 (읽을 시간) — 「알겠어요」를 누르면 다시 흘러감
  const id = step?.id;
  useEffect(() => {
    onHold?.(!!id);
    return () => onHold?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 카드가 바뀔 때만
  }, [id]);
  if (!step) return null;
  const n = STEPS.indexOf(step) + 1;
  const set = (v: Saved) => (save(v), setSt(v));
  return (
    // 치트 고르는 창이 떠 있으면 카드를 가리지 않게 위쪽에
    <div className={`pointer-events-auto absolute inset-x-6 z-30 flex justify-center ${b.cheat ? "top-2" : "bottom-3"}`}>
      <div className="px-box dfn-pop flex max-w-[620px] items-start gap-3 p-3" style={{ "--b": "#5ff2ff" } as React.CSSProperties}>
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2">
            <b className={`${TITLE} px-shadow text-[16px] text-[#7ef3ff]`}>{step.title}</b>
            <span className="text-[12px] text-[var(--dim)]">
              튜토리얼 {n}/{STEPS.length}
            </span>
          </p>
          <p className="mt-1 text-[13px] leading-snug text-[var(--text)]">{step.text}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <Btn tone="cyan" className="h-8 px-3 text-[12px] font-bold" onClick={() => set({ ...st, done: [...st.done, step.id] })}>
            알겠어요
          </Btn>
          <Btn className="h-7 px-2 text-[12px]" onClick={() => set({ ...st, off: true })}>
            튜토리얼 끄기
          </Btn>
        </div>
      </div>
    </div>
  );
}
