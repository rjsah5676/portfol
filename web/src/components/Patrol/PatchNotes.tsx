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
    ver: "v0.1.3 ALPHA",
    name: "진화 · 친절한 안내",
    date: "2026.10.18",
    lines: [
      "새 무기 진화: 물방울 우산 + 하트 사탕 → 폭우 우산 · 수류탄 + 확성기 → 집속 수류탄 · 음표 파동 + 모래시계 → 교향곡 · 금화 샷건 + 네잎 클로버 → 황금 소나기",
      "레벨업 카드에 진화 힌트: 무기 카드엔 짝 능력치, 능력치 카드엔 「진화 재료」",
      "무기 칸 왼쪽 위에 짝 능력치 아이콘 — 모으면 반짝, 진화 준비되면 알림",
      "무기 덱 창에 무기마다 진화 공식",
      "기믹 안내: 처음 나오면 할 일 카드 (브라우저마다 3번) · 가로등 · 분수 · 등불 · 보물 도깨비 위에 말풍선",
      "로비 스테이지 설명에 이번 판 기믹과 할 일",
    ],
  },
  {
    ver: "v0.1.2 ALPHA",
    name: "무기 덱 · 상점",
    date: "2026.10.18",
    lines: [
      "무기 덱 6칸 — 덱에 넣은 무기만 판 안 레벨업 카드에 나와요 (로비 「무기」)",
      "새 무기 4종: 물방울 우산 · 수류탄 · 음표 파동 · 금화 샷건 — 무기마다 전용 타격음 · 타격 이펙트",
      "무기 별 ★1~5: 같은 무기를 또 얻으면 조각 → 별마다 피해 +5% · ★3 고유 효과 · ★5 Lv5 +1개",
      "무기 상자 (보석 200 · 10번 1,800 · 티켓) — 15번 안에 안 가진 새 무기 확정",
      "1-3 · 2-3 · 3-3 첫 클리어 보상에 새 무기",
      "상점 (GP): 첫 순찰 꾸러미 · 일일 순찰 꾸러미 · 주간 보급 꾸러미 · 재화 직구",
      "가시 오라 개편: 주기적으로 가시가 사방으로 솟아 찌르고 밀어내요 (범위 · 피해 크게 ↑)",
    ],
  },
  {
    ver: "v0.1.1 ALPHA",
    name: "판마다 다르게",
    date: "2026.10.18",
    lines: [
      "스테이지 5개가 종류별로 달라졌어요 — X-1 기본 · X-2 기믹 · X-3 특수 · X-4 포위 · X-5 보스",
      "기믹 판: 챕터 기믹이 두 배 (가로등 세 번 · 분수 25초마다 · 종 45초마다)",
      "특수 판: 1장 보물 도깨비 (맞을 때마다 금화, 15초 뒤 도망) · 2장 정예 러시 (정예 8마리) · 3장 등불 지키기",
      "특수 판의 별 2는 목표 달성 — 도깨비 셋 다 잡기 · 정예 다 처치 · 등불 지켜내기",
      "포위 판: 30초마다 사방에서 몰려와요",
      "스테이지 칸에 판 종류 표시",
    ],
  },
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
