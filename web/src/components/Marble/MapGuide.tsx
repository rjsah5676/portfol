"use client";

import { useState, type ReactNode } from "react";
import { CARDS, HANDS, HAND_ORDER, RULE } from "@/lib/marble/engine";
import { MAPS, type MapId } from "@/lib/marble/maps";
import { sfx } from "./audio";

/*
 * 맵 가이드 (맵 카드 · 판 위 맵 이름 옆 「?」) — 이 맵만의 규칙 + 공통 플레이 방식.
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-[#ffe08a]">{children}</b>;

const ONLY: Record<MapId, ReactNode[]> = {
  town: [
    <>
      별 자리 네 곳 중 한 곳에 <B>별</B>이 떠 있어요. 별 칸을 <B>지나가기만 해도</B> {RULE.starPrice}코인으로 사요 — 사면 별은 다른 자리로 이사 가요.
    </>,
    <>
      마지막 <B>{RULE.frenzyRounds}바퀴는 막판</B>: 파랑 · 빨강 칸이 두 배, 꼴찌는 코인 {RULE.catchup} + 아이템을 받아요.
    </>,
  ],
};

const COMMON: { t: string; d: ReactNode }[] = [
  {
    t: "한 차례",
    d: (
      <>
        주사위 <B>5개</B>를 굴리고, 마음에 드는 주사위를 눌러 <B>잠근 뒤 나머지를 {RULE.rerolls}번까지 다시</B> 굴려요 (야추처럼). 다 됐으면 주사위 <B>2개를 골라 그 합만큼</B> 이동!
      </>
    ),
  },
  {
    t: "족보 보상",
    d: (
      <>
        이동과 따로, 5개 전체 족보로 보상을 받아요:{" "}
        {HAND_ORDER.filter((h) => h !== "none")
          .map((h) => `${HANDS[h].name}(${HANDS[h].desc})`)
          .join(" · ")}
        . 족보를 노리면 이동 숫자가 굳고, 원하는 칸에 가려면 족보를 포기해야 해요!
      </>
    ),
  },
  {
    t: "칸",
    d: (
      <>
        <B>파랑</B> +{RULE.blue} · <B>빨강</B> −{RULE.red}(잭팟에 쌓임) · <B>럭키 박스</B> 아이템 · <B>VS</B> 상대 하나와 주사위 대결({RULE.vsStake}코인) · <B>마을 소식</B> 카드 한 장 · <B>함정</B> 다음 차례 다시 굴리기 0번 · <B>워프</B> 원하는 칸으로 · <B>축제</B> 주사위만큼 코인 · <B>황금 금고</B> 잭팟 몽땅 · <B>출발</B> 지나가면 +{RULE.start}
      </>
    ),
  },
  {
    t: "아이템 · 스킬",
    d: (
      <>
        아이템은 {RULE.maxCards}장까지 들고 굴리기 전 · 후에 써요 ({Object.values(CARDS)
          .map((c) => c.name)
          .join(" · ")}). 캐릭터 스킬은 <B>2바퀴부터</B>, 쓰면 몇 차례 쉬었다가 다시 쓸 수 있어요.
      </>
    ),
  },
  {
    t: "이기는 법",
    d: (
      <>
        {MAPS.town.rounds}바퀴가 끝났을 때 <B>별이 가장 많은</B> 사람 (같으면 코인). 판 끝에 <B>보너스 별 셋</B> — 코인왕(번 코인) · 족보왕(족보 점수) · 아이템왕(쓴 아이템)이 하나씩 더 받아요. 끝까지 몰라요!
      </>
    ),
  },
];

export function MapGuide({ map, onClose }: { map: MapId; onClose(): void }) {
  const m = MAPS[map];
  return (
    <div className="mbx absolute inset-0 z-[600] flex items-center justify-center bg-[rgba(10,8,30,0.6)] backdrop-blur-[2px]" onClick={onClose}>
      <div className="mbx-pop flex h-[500px] w-[760px] overflow-hidden rounded-2xl border border-white/15 bg-[#1b1650]/95 text-white shadow-[0_20px_50px_rgba(0,0,0,0.5)]" onClick={(e) => e.stopPropagation()}>
        <div className="relative w-[250px] shrink-0">
          <img src={`/marble/bg/center-${map}.webp`} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#120d33] via-[#120d33]/30 to-transparent" />
          <div className="absolute inset-x-4 bottom-4">
            <div className="text-[11px] font-bold tracking-[0.2em] text-[#ffe08a]">{m.en}</div>
            <b className="text-[24px]">{m.name}</b>
            <p className="mt-1 text-[12px] leading-[17px] text-white/75">{m.desc}</p>
            <p className="mt-2 text-[11px] text-white/55">
              32칸 · {m.rounds}바퀴 · 2~4명 · 별 {RULE.starPrice}코인
            </p>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center border-b border-white/10 px-4 py-3">
            <b className="text-[16px]">플레이 방식</b>
            <button type="button" onClick={onClose} className="ml-auto flex h-[28px] w-[28px] items-center justify-center rounded-full bg-white/10 text-[16px] hover:bg-white/20" aria-label="닫기">
              ×
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[12.5px] leading-[19px]">
            <div className="mb-3 rounded-xl border border-[#ffd23a]/40 bg-[#ffd23a]/10 px-3 py-2.5">
              <div className="mb-1 text-[12px] font-black text-[#ffd23a]">이 맵만의 규칙</div>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-white/90">
                {ONLY[map].map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-2">
              {COMMON.map((x) => (
                <div key={x.t} className="rounded-xl bg-white/[0.06] px-3 py-2">
                  <div className="text-[12px] font-bold text-white">{x.t}</div>
                  <div className="text-white/80">{x.d}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 맵 카드 · 판 위에 다는 「?」 (버튼 안에 들어가도 되게 span) */
export function GuideDot({ onOpen, className = "" }: { onOpen(): void; className?: string }) {
  return (
    <span
      role="button"
      tabIndex={0}
      title="플레이 방식"
      onClick={(e) => {
        e.stopPropagation();
        sfx("click");
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
          e.preventDefault();
          onOpen();
        }
      }}
      className={`flex h-[24px] w-[24px] cursor-pointer items-center justify-center rounded-full bg-black/55 text-[13px] font-black text-white ring-1 ring-white/40 backdrop-blur transition hover:scale-110 hover:bg-[#ffd23a] hover:text-[#3a2500] ${className}`}
    >
      ?
    </span>
  );
}

/** 상태까지 묶어서 (한 화면에 하나) */
export function useMapGuide() {
  const [open, setOpen] = useState<MapId | null>(null);
  const node = open ? <MapGuide map={open} onClose={() => setOpen(null)} /> : null;
  return { show: setOpen, node };
}
