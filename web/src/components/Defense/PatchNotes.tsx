"use client";

/**
 * 패치노트 — 메뉴 왼쪽 아래 「패치노트」 버튼 → 창. 맨 위가 최신. 패치마다 10줄 안으로.
 * 새 패치는 PATCHES 맨 앞에 추가 (밸런스가 바뀌면 BALANCE_VER 도 같이 적기).
 */
import { Modal, TITLE } from "./ui";

export interface Patch {
  ver: string;
  name: string;
  date: string;
  lines: string[];
}

export const PATCHES: Patch[] = [
  {
    ver: "v0.1.1",
    name: "편의 개선",
    date: "2026.10.13",
    lines: [
      "PC 에서도 전체화면 — 메뉴 · 로비 · 방 · 게임 화면 어디서나 네모 버튼 (소리 버튼 옆)",
      "마우스 커서를 일반 마우스 크기로 줄임 (레티나 같은 고해상도 화면에서는 같은 크기로 더 선명하게)",
      "게임 가이드 추가 — 페이지 위 「가이드」 버튼에서 규칙 · 단축키 · 세력 상성 · 랭킹 방식을 볼 수 있어요",
      "패치노트 추가 — 메뉴 왼쪽 아래 (소리 · 전체화면 버튼 옆)",
    ],
  },
  {
    ver: "v0.1 ALPHA",
    name: "PIXEL LUCKY DEFENSE 오픈",
    date: "2026.10.13",
    lines: [
      "PIXEL FIGHT 외전 랜덤 디펜스 — 글리치에 먹힌 픽셀 세계를 60웨이브까지 지켜요. 10웨이브마다 오염된 파이터(릴리 · 소영 · 제나 · 이그나 · 이반 · 카이)가 보스로",
      "세 세력 기사단 · 기계공방 · 마도회 41종, 등급 노말 → 레어 → 에픽 → 레전드는 같은 유닛 3기 합성, 신화 · 히든은 조합식",
      "패치(10웨이브 전 하나 고르는 전략) 4종 · 미션 11종 · 글리치 균열(C · B · A) · 행운석 도박 · 보스 보상 골라 뽑기",
      "랭킹 — 회원은 혼자 하기가 바로 랭킹 판. 서버가 기록을 처음부터 다시 돌려 확인해요 (밸런스 버전마다 따로)",
      "함께 하기 — 최대 4명이 같은 시드로 각자 라인을 막는 생존 경쟁. 새로고침해도 진행 중인 판으로 돌아가요 (서로 돕기는 다음 버전)",
      "PC · 폰 지원 — 폰은 가로 화면 전용 (전체화면 권장)",
      "밸런스 a2 · 알파라서 수치가 자주 바뀌어요",
    ],
  },
];

export const LATEST = PATCHES[0].ver;

export default function PatchNotes({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="패치노트" onClose={onClose} accent="#ff5cd6">
      <div className="flex flex-col gap-5">
        {PATCHES.map((p, i) => (
          <section key={p.ver} className={i > 0 ? "border-t-2 border-[#2a2350] pt-4" : ""}>
            <div className="mb-2 flex items-center gap-2">
              {i === 0 && (
                <span className="bg-[var(--pink)] px-1.5 py-0.5 text-[11px] font-bold text-white">
                  최신
                </span>
              )}
              <span className={`${TITLE} px-shadow text-[17px] text-white`}>
                {p.ver} {p.name}
              </span>
              <span className="ml-auto text-[12px] text-[var(--gold)]">{p.date}</span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {p.lines.map((l, k) => (
                <li key={k} className="flex gap-2 text-[13px] leading-relaxed text-[#d9d3f0]">
                  <span className="mt-[7px] h-[6px] w-[6px] shrink-0 bg-[var(--pink)]" />
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
