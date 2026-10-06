/**
 * 패치노트 — 메인 화면 오른쪽 위 버튼 → 모달. 맨 위가 최신. 패치마다 10줄 안으로.
 * 새 패치는 PATCHES 맨 앞에 추가.
 */
import { useEffect } from "react";
import { keyText } from "./KeyCap";

const KR = "font-['Nanum_Gothic',sans-serif]";

export interface Patch {
  ver: string;
  name: string;
  date: string;
  lines: string[];
}

export const PATCHES: Patch[] = [
  {
    ver: "v0.5",
    name: "시스템 패치",
    date: "2026.10.06",
    lines: [
      "입력 — 히트스톱·필살기 연출 중에 누른 버튼도 기억했다가 풀리는 순간 나가요 (맞는 걸 보고 누른 캔슬 · 연타가 씹히던 문제)",
      "잡기 풀기 — 풀면 피해가 안 들어가요 (전엔 풀어도 60). 풀 수 있는 시간은 0.3초 → 0.23초, 잡기 피해 · 게이지는 던지는 순간에",
      "가드 — 기본기도 막으면 피해의 15%가 깎여요. 저스트 가드는 ↓ 를 맞기 직전에 새로 눌러야 해요 (다운 · 경직 중부터 누르고 있으면 보통 가드)",
      "누운 상대 다시 잡기는 콤보마다 한 번 (잡기 → 내려찍기 → 다시 잡기 무한 반복 막음) · 막는 경직 중인 상대는 안 잡혀요",
      "낭떠러지 — 떨어진 뒤 땅에서 4초를 못 버티고 또 떨어지면 무적 없이 체력 6% 깎임. 다시 내려온 뒤의 무적은 공격하면 끝",
      "돌진 잡기 — 게이지가 있어도 대시 중 J · K 단독이 바로 나가요 (4프레임 지연 없앰). 하나를 먼저 누르고 곧바로 나머지를 눌러도 돌진 잡기",
      "건모 — L Ctrl+A로 ⏸ 멈춘 상대가 잡기에 안 잡히던 문제, 공중 L Alt+Tab 뒤 점프하면 꼭대기에서 또 멈추던 문제, 달밤 마천루에서 건물 속으로 들어가던 문제",
      "건모 — 공중 L Alt+Tab: 판정 아래쪽을 줄임 (발 아래 96 → 56px), 모션을 두 손으로 화면을 넘기는 손짓으로 새로 그림 (땅 L과 구분되게), 맞히는 순간 두 사람을 감싸는 창이 떠요 (전엔 맞히자마자 창이 사라지고 자리만 바뀜)",
      "판정 — 동시에 맞으면 1P만 마무리 보너스 · 띄우기가 붙던 문제, 공중에서 쏜 탄이 띄워진 상대를 맞히면 쏜 쪽이 끌려가던 문제, 업화주가 늘 오른쪽으로만 밀던 문제, 가드하다 발판에서 밀려 떨어지면 공중에서 가드 자세이던 문제",
      "조작 — 뜬 직후 누른 2단 점프가 씹히던 문제, 라운드 시작 전부터 누르고 있던 버튼이 시작하자마자 나가던 문제, 휴대폰에서 아주 짧게 친 버튼을 놓치던 문제",
      "온라인 — 서로 버전이 다르거나 경기가 어긋나면 알려 주고 멈춰요 · 지연이 있을 때 타격음 · 이펙트가 빠지던 문제 · AI는 가드로 버티는 상대에게 돌진 잡기를 써요",
    ],
  },
  {
    ver: "v0.4",
    name: "10.06 패치",
    date: "2026.10.06",
    lines: [
      "카이 — L 질풍권: 돌진하는 동안 경직 면역, 맞히면 0.85초 기절 (띄우기는 뺌). 대신 피해 78→44, 재사용 2.3초→4초, 체력 1350→1250",
      "카이 — 공중 L: 바닥을 쾅 찍어 양옆 넓게(46→76px) 충격파로 띄움 · 공중 I 천풍난무는 그 높이에서 버티며 6연타",
      "건모 — L Ctrl+A 범위 크게(앞 120px, 위로는 점프한 상대까지), ⏸ 일시정지 0.8초→1초, 후딜 26→22프레임. 끌어오기는 뺌",
      "건모 — 공중 L Alt+Tab: 자리를 바꾼 뒤 상대를 바로 앞까지 끌어오고, 건모는 상대 높이에서 0.3초 동안 안 떨어져 바로 공중 J · K. 💫 혼란 24→46프레임",
      "카이 — 기본기 너프: J 약 44→40, K 발차기 102→92",
      "소영 — 상향: K 발차기 피해 80→90, L 지도편달 피해 45→55",
      "릴리 — 너프: 갇힌 상대를 비눗방울로 맞히면 터지기만 하고 다시 안 가둬요",
      "이그나 — 화상 길게(화염구 2→2.5초, 업화주 3→3.7초), 화상 중인 상대는 이그나 공격에 10% 더 아프게. I 업화주가 꺼진 자리에 2초 동안 불 장판 — 밟고 있으면 계속 피해 + 화상",
      "돌진 잡기 — 대시 중뿐 아니라 대시 직후에도, J · K를 조금 어긋나게 눌러도 돼요. 미끄러지듯 두 배쯤 길게 파고듦 (게이지 있을 땐 대시 중 J · K 단독이 4프레임 늦게 나감)",
      "온라인 결과 화면 — 한 판 더(바로 준비) / 대기실로(준비는 나중에) 구분, 방장은 대기실로 하나만",
      "연습 모드 — 메인에서 고름. 가만히 있는 허수아비 상대로 콤보 연습 (체력 무한 · 시간 멈춤 · 게이지 가득), 마지막 콤보 히트 수 · 피해 · 최고 피해 표시",
      "일시정지 화면 새로 — 게임 화면 안에서 계속 · 다시하기 · 캐릭터 선택 · 메뉴로(↑↓ · Enter), 효과음 · 배경음악 · 소리 끄기 · 전체화면 설정",
      "메인 화면 ⚙ 설정 — 같은 설정을 메인에서도 (휴대폰은 이동 조작 스틱 · 키도)",
      "온라인 관전 뺌 — 따라잡을 때 너무 무겁고 끊겨서. 꽉 찬 방·대전 중인 방은 못 들어가요",
    ],
  },
  {
    ver: "v0.3",
    name: "10.05 패치",
    date: "2026.10.05",
    lines: [
      "새 캐릭터 건모(디버거) — L Ctrl+A 박스로 눈앞까지 끌어와 ⏸ 일시정지, 공중 L Alt+Tab으로 자리 바꿔 💫 혼란, I 금요일 배포",
      "새 맵 — 천공 구름길(구름 발판 9개), 달밤 마천루(2단 점프 + 공중 대시로 건너는 두 건물). 맵별 새 배경음악",
      "HUD 새 디자인 — 금테 체력바, 육각 시계, 라운드·K.O.·승리 배너, L 기술 아이콘",
      "공중 콤보 — 점프마다 J 4번 + K 2번(2단 점프하면 다시), 기술을 섞어 맞히면 더 아프고 같은 것만 반복하면 덜 아파요. 공중 ↓ + K 마무리 내려찍기(점프마다 1번, 발차기 횟수와 따로)로 바닥에 꽂아 다운. 띄워진 지 2초가 지나면 점점 빨리 떨어져요",
      "점프 우선 — J · K 공격 중에도 점프가 바로 나가요 (L · I 는 끝나자마자)",
      "다운 공격 — 누운 상대도 맞아요 (못 막음, 피해 절반). J + K 로 잡으면 다시 띄워요",
      "효과음 — 캐릭터별 L · I 소리, 화상·감전·방울 소리",
      "밸런스 — 돌진 잡기 추가(대시 중 J + K, 게이지 25: 막고 기다리는 상대를 멀리서 잡음) / 소영: 공중 L 이 바로 아래부터 앞쪽 사선 아래까지 / 카이: 공중 필살기가 착지해도 끊기지 않음 / 릴리: 방울에 갇힌 상대를 때려 터뜨리면 +20 피해, 갇힌 상대도 잡기 가능 / 감전된 상대도 잡기 가능 / 이그나: 발차기 K 발동 2프레임 느려지고 막혔을 때 이득 2프레임 줄임 / 카이: 질풍권 재사용 2.5초→2.3초",
      "AI — 달인 반응·가드·대공 강화 (고수 상대 승률 55%→77%), 낭떠러지 건너기, 누운 상대 공격",
      "기타 — 온라인 관전(꽉 찬 방·대전 중인 방, 중간에 들어가도 따라잡음), 휴대폰 조작 새로(전체화면에서도 화면 위 버튼, 이동은 스틱·키 중 선택), 결과 화면 새 디자인(AI전 승리 시 게임 화면 안에서 바로 랭킹 등록, 전체화면 포함), 떨어진 바로 그 자리 화면 꼭대기에서 다시 등장, 온라인 ‘한 판 더’에서 방장은 준비가 풀린 채로",
    ],
  },
  {
    ver: "v0.2",
    name: "베타",
    date: "2026.10.04",
    lines: [
      "새 캐릭터 소영(채찍)·릴리(우산·물)·제나(번개 창), 새 맵 노을 옥상",
      "모든 캐릭터 그림 교체 — 동작별 애니메이션·이펙트·프로필·전신 그림",
      "격투 시스템 — 잡기 J + K, 가드 반격, 저스트 가드, 카운터 히트",
      "띄우기 공중 콤보(점프 캔슬), 상태 이상: 화상·감전·방울 가두기",
      "온라인 대전 — 로비·대기실·P2P 롤백 넷코드(안 되면 중계)",
      "8bit 효과음, 메인 화면 새 디자인, 전체화면, 승리 포즈·도발 대사",
      "조작감 — 방향키 우선, 가드 중 입력 바로 실행, 기술 아이콘·가이드",
    ],
  },
  {
    ver: "v0.1",
    name: "알파",
    date: "2026.10.03",
    lines: [
      "픽셀 격투 첫 공개 — 1:1 플랫폼 대전",
      "카이(바람 주먹)·이그나(불꽃), 맵 운해 학당",
      "AI 대전 6단계 + 랭킹, 한 키보드 2인 대전, 게임패드·휴대폰 터치",
      "약 J 4단·발차기 K 2단 연속기, 대시·2단 점프·공중 공격",
      "아이덴티티 L · 필살기 I, 떨어지면 체력이 깎이고 다시 등장",
      "캐릭터·맵 선택 화면, 맵별 배경음악",
    ],
  },
];

/** 메인 화면 버튼에 쓰는 최신 패치 표시 */
export const LATEST = PATCHES[0];

export default function PatchNotes({ onClose }: { onClose: () => void }) {
  // 열린 동안엔 키 입력을 메뉴로 안 보냄 (Esc·Enter·J·Space = 닫기)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (["Escape", "Enter", "Space", "KeyJ", "Backspace"].includes(e.code)) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-[2px] [animation:modal-fade_150ms_ease-out]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`${KR} relative flex max-h-[86%] w-[64cqw] flex-col rounded-[1cqw] bg-[linear-gradient(180deg,#F2C35B,#9A6A1E)] p-[0.25cqw] shadow-[0_1cqw_3cqw_rgba(0,0,0,0.6)] [animation:modal-pop_200ms_ease-out]`}
      >
        <div className="flex min-h-0 flex-col rounded-[0.8cqw] bg-[linear-gradient(180deg,#2B1840,#140A22)]">
          <div className="flex items-center justify-between border-b border-[#F2C35B]/30 px-[2cqw] py-[1.2cqw]">
            <span className="font-['Black_Han_Sans',sans-serif] text-[2.4cqw] tracking-wide text-[#FFE9A8] [text-shadow:0_0.2cqw_0_#12081F]">
              패치노트
            </span>
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-full bg-white/10 px-[1.2cqw] py-[0.3cqw] text-[1.2cqw] text-white/75 hover:bg-white/20"
            >
              닫기 ✕
            </button>
          </div>
          <div className="gold-scroll min-h-0 overflow-y-auto px-[2cqw] py-[1.4cqw]">
            {PATCHES.map((p, i) => (
              <section
                key={p.ver}
                className={i > 0 ? "mt-[1.8cqw] border-t border-white/10 pt-[1.6cqw]" : ""}
              >
                <div className="mb-[0.8cqw] flex items-center gap-[0.8cqw]">
                  {i === 0 && (
                    <span className="rounded-[0.3cqw] bg-[#FF4F8B] px-[0.6cqw] py-[0.1cqw] text-[1cqw] font-extrabold text-white">
                      최신
                    </span>
                  )}
                  <span className="font-['Black_Han_Sans',sans-serif] text-[1.9cqw] text-white">
                    {p.ver} {p.name}
                  </span>
                  <span className="font-mono text-[1.15cqw] text-[#F2C35B]/80">{p.date}</span>
                </div>
                <ul className="flex flex-col gap-[0.45cqw]">
                  {p.lines.map((l, k) => (
                    <li
                      key={k}
                      className="flex gap-[0.7cqw] text-[1.25cqw] leading-snug break-keep text-white/85"
                    >
                      <span className="mt-[0.55cqw] h-[0.5cqw] w-[0.5cqw] shrink-0 rotate-45 bg-[#F2C35B]/80" />
                      <span>{keyText(l)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
