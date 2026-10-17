"use client";

/**
 * 픽셀 순찰대 패치노트 — 처음 화면 · 로비의 「패치노트」 버튼 → 창. 맨 위가 최신, 패치마다 10줄 안으로.
 * 새 패치는 PATCHES 맨 앞에 추가.
 */
import { Modal } from "./ui";

export interface Patch {
  ver: string;
  name: string;
  date: string;
  lines: string[];
}

export const PATCHES: Patch[] = [
  {
    ver: "v0.1 ALPHA",
    name: "순찰 시작",
    date: "2026.10.18",
    lines: [
      "픽셀 순찰대 알파 오픈 — 순찰대원 반디 · 챕터 3개 × 스테이지 5개 (15스테이지)",
      "X-1 ~ X-4: 3분 버티고 미니 보스 / X-5: 5분 버티고 챕터 보스 · 스테이지마다 별 3개",
      "챕터 기믹: 1장 꺼진 가로등 · 2장 분수 물보라 · 3장 자정의 종",
      "장비 6칸 · 12종 · 5등급 — 고급 상자(천장 10 · 50) · 일반 상자(하루 한 번 무료) · 합성 · 강화",
      "합성 재료 · 강화 초기화한 장비의 강화비는 전액 환급",
      "순찰: 꺼 둬도 코인 · 설계도가 쌓여요 (최대 12시간) · 빠른 순찰 하루 3번",
      "필살기 「등대」 컷인 · 빛줄기 · 섬광, 무기별 타격음, 연속 · 동시 처치, 몹 죽는 연출",
      "챕터 · 보스 · 로비 BGM, 클리어 · 실패 징글",
      "랭킹 (깬 스테이지 → 별 합) · 업적 14개 · 일일 미션 3개",
      "다음 업데이트: 설희 · 루비 · 볼트 합류, 새 챕터 — 밸런스는 플레이 기록을 보며 계속 맞춰요",
    ],
  },
];
export const LATEST = PATCHES[0].ver;

export default function PatchNotes({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="패치노트" onClose={onClose} w={640} h={460}>
      <div className="mt-[12px] flex min-h-0 flex-1 flex-col gap-[16px] overflow-y-auto pr-[6px]">
        {PATCHES.map((p, i) => (
          <section key={p.ver} className={i > 0 ? "border-t-2 border-[#2a2468] pt-[12px]" : ""}>
            <div className="mb-[8px] flex items-center gap-[8px]">
              {i === 0 && (
                <span className="pts-tag text-[11px]" style={{ background: "#ff4fa3" }}>
                  최신
                </span>
              )}
              <b className="pts-title text-[18px]">
                {p.ver} {p.name}
              </b>
              <span className="ml-auto text-[12px] text-[#ffd23a]">{p.date}</span>
            </div>
            <ul className="flex flex-col gap-[6px]">
              {p.lines.map((l, k) => (
                <li key={k} className="flex gap-[8px] text-[13px] leading-[19px] text-[#d9d3f0]">
                  <span className="mt-[7px] h-[6px] w-[6px] shrink-0 bg-[#ffb03a]" />
                  <span className="break-keep">{l}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
