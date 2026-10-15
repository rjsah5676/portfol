"use client";

/**
 * 튜토리얼 — 판 안에서 상황이 오면 한 장씩 나오는 안내 카드 (처음 하는 사람용).
 * 본 카드는 이 기기에 기억 (localStorage pgd-tut) · 「튜토리얼 끄기」 · 메뉴/일시정지의 「튜토리얼 다시 보기」 로 처음부터.
 * 카드가 떠 있는 동안은 판이 멈춤 (솔로 — 「알겠어요」를 누르면 다시 흐름). 순서대로 하나씩만.
 */
import { useEffect, useState } from "react";
import { B, BOSS_EVERY } from "@/lib/defense/balance";
import { STACK, buildBlock, PERIM, type Board } from "@/lib/defense/sim";
import { TOWN_NAME } from "@/lib/defense/town";
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

/** 해피 타운 안내 (처음 들어가면 — 글리치 시티 튜토리얼과 따로 기억) */
const TOWN_STEPS: Step[] = [
  {
    id: "t_hello",
    title: `${TOWN_NAME}에 온 걸 환영해요`,
    text: "적이 도는 길이 동네 칸이에요. 기본은 글리치 시티와 같고, 길에 건물을 지어 통행료를 받는 게 달라요.",
    when: (b) => !b.cheat,
  },
  {
    id: "t_build",
    title: "건물 짓기 (길 칸 누르기 · W)",
    text: "유닛 바로 바깥 길 칸을 누르면 아래에 그 칸 정보가 떠요. 골드로 오두막 → 2층집 → 빌딩. 초록 점이 깜빡이는 칸은 지금 지을 수 있어요.",
    when: (b) => !b.cheat && b.wave >= 2 && Array.from({ length: PERIM }, (_, t) => t).some((t) => !buildBlock(b, t)),
  },
  {
    id: "t_toll",
    title: "통행료",
    text: "건물 칸에서 쓰러진 적이 통행료(골드)를 내요. 적이 많이 쓰러지는 칸(센 유닛 앞)에 지을수록 이득! 안쪽 칸 유닛이 없어지면 휴업이에요.",
    when: (b) => !b.cheat && b.bld.some((x) => x > 0),
  },
  {
    id: "t_dice",
    title: "웨이브 주사위",
    text: "웨이브마다 주사위를 굴려요. 황금 칸(통행료 ×3) · 늪(그 칸 적이 느려짐) · 축제(처치 골드 +1) · 더블 — 위쪽 줄과 길 위 표시를 보세요.",
    when: (b) => !b.cheat && !!b.dice,
  },
  {
    id: "t_boss",
    title: "UR 보스",
    text: "10 · 30 · 50웨이브는 다이스 타운의 UR 셋이 글리치에 먹혀 나와요. DICE 는 주사위만큼 순간이동, MOA 는 건물을 빼앗고, FORTE 는 앙코르로 체력을 되찾아요.",
    when: (b) => b.phase === "boss" && b.wave % 20 === 10,
  },
];

const KEY = "pgd-tut";
const TOWN_KEY = "pgd-tut-town";
interface Saved {
  done: string[];
  off: boolean;
}
function load(key = KEY): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null") as Saved | null;
    if (v && Array.isArray(v.done)) return { done: v.done, off: !!v.off };
  } catch {}
  return { done: [], off: false };
}
function save(v: Saved, key = KEY) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}
/** 튜토리얼을 처음부터 다시 (메뉴 · 일시정지) */
export function resetTutorial() {
  save({ done: [], off: false });
  save({ done: [], off: false }, TOWN_KEY);
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
  const [main, setMain] = useState<Saved>(() => load());
  const [town, setTown] = useState<Saved>(() => load(TOWN_KEY));
  // 해피 타운이면 타운 안내가 먼저 (따로 기억), 다 보면 글리치 시티 안내
  const townStep = b.stage === "town" && !town.off ? TOWN_STEPS.find((s) => !town.done.includes(s.id) && s.when(b)) : undefined;
  const isTown = !!townStep;
  const st = isTown ? town : main;
  const steps = isTown ? TOWN_STEPS : STEPS;
  const step = townStep ?? (main.off ? undefined : STEPS.find((s) => !main.done.includes(s.id) && s.when(b)));
  // 카드가 떠 있는 동안 판을 멈춤 (읽을 시간) — 「알겠어요」를 누르면 다시 흘러감
  const id = step?.id;
  useEffect(() => {
    onHold?.(!!id);
    return () => onHold?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 카드가 바뀔 때만
  }, [id]);
  if (!step) return null;
  const n = steps.indexOf(step) + 1;
  const set = (v: Saved) => (isTown ? (save(v, TOWN_KEY), setTown(v)) : (save(v), setMain(v)));
  return (
    // 치트 고르는 창이 떠 있으면 카드를 가리지 않게 위쪽에
    <div className={`pointer-events-auto absolute inset-x-6 z-30 flex justify-center ${b.cheat ? "top-2" : "bottom-3"}`}>
      <div className="px-box dfn-pop flex max-w-[620px] items-start gap-3 p-3" style={{ "--b": "#5ff2ff" } as React.CSSProperties}>
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2">
            <b className={`${TITLE} px-shadow text-[16px] text-[#7ef3ff]`}>{step.title}</b>
            <span className="text-[12px] text-[var(--dim)]">
              {isTown ? TOWN_NAME : "튜토리얼"} {n}/{steps.length}
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
