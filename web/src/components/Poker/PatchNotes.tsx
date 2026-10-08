"use client";

/**
 * ANIME POKER 패치노트 — 로비 위 버튼 → 창. 맨 위가 최신. 새 패치는 PATCHES 맨 앞에 추가.
 */

export interface Patch {
  ver: string;
  name: string;
  date: string;
  lines: string[];
}

export const PATCHES: Patch[] = [
  {
    ver: "v0.3 BETA",
    name: "폰에서도 편하게",
    date: "2026.10.08",
    lines: [
      "폰에서 전체화면이 아닐 때도 자리 · 카드 · 팟이 겹치지 않게 배치를 새로 짰어요 (화면이 짧으면 조금씩 작아져요)",
      "폰에서도 내 캐릭터가 내 이름표 위에 보여요",
      "건 돈 표시가 상대 카드(족보)를 가리지 않게 자리를 옮겼어요",
      "연결이 불안정한 사람은 이름표에 「연결 불안정…」, 내 연결이 끊기면 위에 「다시 연결하는 중」 표시",
      "쇼다운 연출 — 베팅이 끝나면 건 돈이 팟으로 모이고, 패를 한 자리씩 뒤집으며 족보가 도장처럼 찍혀요. 이긴 사람은 맨 마지막에 까고, 그 뒤 이긴 5장이 빛나고 나머지는 어두워져요",
      "배경음악이 들어왔어요 — 로비 · 동네판 · 하우스 · VIP룸 · 올인 긴장 곡. 설정에서 배경음악 · 효과음 · 음성 음량을 따로, 로비 곡은 1번 · 2번 · 번갈아 중에 골라요",
      "판이 시작되면 딜러 자리에서 카드가 한 장씩 각 자리로 날아가요 (7포커는 4구 · 5구 … 카드가 올 때도)",
      "효과음이 전부 새 소리로 — 카드 · 칩 · 체크 · 폴드 · 차례 알림 · 카운트다운 · 승리 / 패배 / 올인 / 메이드 징글 · 쇼다운 북 · 족보 도장",
      "포커 페이지를 떠나면 배경음악이 꺼지고, 탭을 가리면 멈춰요",
      "7포커 콜 버튼을 삥 자리(두 번째)로 — 미리 행동 줄의 「삥 / 콜」과 같은 자리라 안 헷갈려요",
    ],
  },
  {
    ver: "v0.2 BETA",
    name: "잘 보이게",
    date: "2026.10.08",
    lines: [
      "한 번에 주는 시간 7초 → 12초, 3초 남으면 3 · 2 · 1 카운트다운",
      "미리 행동 — 차례가 아닐 때도 베팅 버튼이 그대로 있어서 「체크/폴드」 「콜」을 미리 눌러 두면 차례가 오자마자 자동으로 (다시 누르면 풀림. 미리 콜은 얼마가 걸리든 콜)",
      "체크 · 레이즈 · 삥 같은 외침이 캐릭터한테서 나와 판 가운데로 커지며 날아가요",
      "트리플 이상 메이드가 되면 내 카드 뒤에서 빛이 터지고 족보 띠가 금빛으로 빛나요",
      "이름표를 누르면 그 사람이 이 방에서 딴 돈 · 전적(승률)이 보여요 (내 것도)",
      "나가기 예약을 걸고 다이하면 판이 끝날 때까지 기다리지 않고 바로 로비로",
      "홀덤에 프리플랍 · 플랍 · 턴 · 리버 표시, 보스 표시는 뺐어요",
      "건 돈은 행동 이름 · 색과 함께 크게, 라운드가 끝나면 칩이 팟으로 모이고 승자에게 날아가요",
      "지금 누구 차례인지 아래에 얼굴 · 이름 · 남은 시간으로 크게 보여요",
      "카드 · 이름표 · 내 정보 판을 키웠어요",
      "7포커 「풀」 베팅을 없앴어요 (삥 · 따당 · 쿼터 · 하프)",
      "이모티콘에 옆 캐릭터 머리카락이 섞여 보이던 것, 클로버가 스페이드와 헷갈리던 무늬 모양",
      "칩이 바닥나면 기본 칩이 자동으로 들어와요 (회생 버튼 없음)",
    ],
  },
  {
    ver: "v0.1 BETA",
    name: "ANIME POKER 오픈",
    date: "2026.10.08",
    lines: [
      "포커가 ANIME POKER 로 새로 태어났어요 — 진우 · 연서 · 태양 · 정민 · 에이미 다섯 캐릭터 중 하나를 골라 테이블에 앉아요",
      "홀덤(6인) · 7포커(5인), 판돈 3단계(동네판 · 하우스 · VIP룸). 매 판 기본 판돈(앤티)을 내고 시작",
      "7포커는 체크 없이 삥 이상 또는 다이, 카드 고르기는 버릴 카드 → 펼 카드 두 번 누르면 끝",
      "다른 유저들이 수시로 들어오고 나가요. 방을 만들 때 「바로 입장 허용」으로 끌 수 있어요",
      "이모티콘 8종, 체크 · 콜 · 레이즈 외침, 올인 컷인, 차례인 캐릭터는 금빛 윤곽선",
      "나가기는 판이 끝날 때 나가는 예약 방식. 오래 자리를 비우면 자동으로 예약돼요",
      "모바일 세로 화면 · 전체화면 지원. 상점 · 옷장 · 스킨 변경은 추가 예정",
      "BETA 버전이라 배경음악 · 캐릭터 음성은 준비 중이에요",
    ],
  },
];

export const LATEST = PATCHES[0].ver;

export default function PatchNotes({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-[0.8em]"
      onClick={onClose}
    >
      <div
        className="pk-frame pk-pop flex max-h-full w-full max-w-[34em] flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-[0.5em] border-b border-[rgba(214,175,92,0.25)] bg-black/40 px-[0.9em] py-[0.6em]">
          <span className="pk-frame-title text-[1.05em]">패치노트</span>
          <button
            type="button"
            onClick={onClose}
            className="pk-btn pk-btn-ghost ml-auto px-[0.8em] py-[0.25em] text-[0.82em]"
          >
            닫기
          </button>
        </div>
        <div className="pk-scroll grid min-h-0 gap-[0.9em] overflow-y-auto p-[0.9em]">
          {PATCHES.map((p) => (
            <section key={p.ver}>
              <div className="mb-[0.35em] flex items-baseline gap-[0.5em]">
                <span className="rounded-[4px] bg-[var(--pk-brass)] px-[0.45em] text-[0.8em] font-extrabold text-[#2a1e05]">
                  {p.ver}
                </span>
                <span className="text-[1em] font-extrabold">{p.name}</span>
                <span className="ml-auto text-[0.75em] text-white/45">{p.date}</span>
              </div>
              <ul className="grid gap-[0.3em] pl-[1.1em] text-[0.86em] leading-relaxed text-white/80">
                {p.lines.map((l) => (
                  <li key={l} className="list-disc marker:text-[var(--pk-brass)]">
                    {l}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
