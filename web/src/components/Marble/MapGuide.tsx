"use client";

import { useState, type ReactNode } from "react";
import { RULE, TOWN_EVENTS } from "@/lib/marble/engine";
import { MAPS, type MapId } from "@/lib/marble/maps";
import { sfx } from "./audio";

/*
 * 맵 가이드 (맵 카드 · 판 위 맵 이름 옆 「?」) — 이 맵만의 규칙 + 공통 플레이 방식.
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-[#ffe08a]">{children}</b>;

const ONLY: Record<MapId, ReactNode[]> = {
  town: [
    <>
      <B>3바퀴마다 마을 소식</B>이 바뀌어요:{" "}
      {Object.values(TOWN_EVENTS)
        .map((e) => `${e.name}(${e.desc})`)
        .join(" · ")}
    </>,
    <>
      <B>워프 게이트</B>에 서면 다음 차례에 아무 칸으로나 순간이동해요.
    </>,
  ],
  cross: [
    <>
      네 변 가운데 <B>기차역</B>에 서면 십자 철로로 다른 역까지 바로 갈 수 있어요 (그냥 남아도 돼요). 남의 땅을 건너뛰고 내 동네로 갈아타는 게 핵심!
    </>,
    <>
      워프 게이트 대신 <B>황금 다리</B>(+{RULE.bonus}코인 + <B>잭팟</B>: 세금 · 벌금 · 수리비로 은행에 낸 돈이 쌓였다가 서는 사람이 몽땅)가 있어요. 럭키 박스의 워프 카드는 그 자리에서 다음 차례 워프로 바뀌어요.
    </>,
  ],
  orgel: [
    <>
      <B>4바퀴마다 태엽이 감기며</B> 정원의 네 변이 시계 방향으로 한 변씩 돌아가요. 땅은 주인 · 건물째로 옮겨 가서, 내 땅 앞 길목이 계속 바뀌어요.
    </>,
    <>
      라인 독점은 돌아간 뒤의 <B>지금 자리</B> 기준이에요 — 돌기 직전에 한 변을 모으면 역전 기회!
    </>,
  ],
};

const COMMON: { t: string; d: ReactNode }[] = [
  {
    t: "굴리기",
    d: (
      <>
        주사위 버튼(또는 스페이스)을 <B>꾹 눌러 힘을 모아</B> 던져요. 세게 던지면 큰 수, 약하게 던지면 작은 수가 나올 확률이 올라가요 (기본 10%, 캐릭터 · 아이템으로 더). 더블이면 한 번 더!
      </>
    ),
  },
  {
    t: "땅 · 건물",
    d: (
      <>
        빈 땅에 서면 땅과 함께 <B>오두막 · 하우스 · 타워</B>까지 한 번에 지을 수 있어요. 타워가 선 내 땅에 다시 서면 <B>랜드마크</B> (인수 불가). 출발 포털에 딱 서면 내 땅 하나를 골라 바로 지을 수 있어요.
      </>
    ),
  },
  {
    t: "통행료 · 인수",
    d: (
      <>
        남의 땅에 서면 통행료를 내고, 랜드마크가 아니면 넣은 돈만큼 주고 <B>인수</B>할 수 있어요. 같은 색 동네를 다 가지면 통행료 2배 — 칸 구석의 <B>x2</B> 같은 숫자가 지금 배율이에요.
      </>
    ),
  },
  {
    t: "돈이 모자라면",
    d: (
      <>
        통행료가 가진 돈보다 많으면 <B>대출</B>(판마다 1번, 빌린 돈의 130% 를 월급 절반씩 갚음)을 받거나, 싼 땅부터 반값에 팔아요. 그래도 모자라면 파산.
      </>
    ),
  },
  {
    t: "이기는 법",
    d: (
      <>
        상대 모두 <B>파산</B> · <B>트리플 독점</B>(색 동네 3곳) · <B>라인 독점</B>(한 변 전부) · <B>명소 독점</B> 중 하나, 아니면 {MAPS.town.rounds}바퀴가 끝났을 때 총자산 1등.
      </>
    ),
  },
  {
    t: "특수 칸",
    d: (
      <>
        <B>럭키 박스</B> 카드 한 장 · <B>수리소</B>(더블이 나오거나 2번 쉬어야 나감, {RULE.jailPay}코인 내고 바로 나가도 됨) · <B>축제 무대</B>(내 땅 하나 통행료 2배) · <B>세관</B>(땅 · 건물 값의 {Math.round(RULE.taxRate * 100)}% 세금)
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
              32칸 · {m.rounds}바퀴 · 2~4명
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
