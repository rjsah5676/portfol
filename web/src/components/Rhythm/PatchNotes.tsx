/**
 * BEAT DASH 패치노트 — 타이틀 화면 오른쪽 위 버튼 → 모달. 맨 위가 최신. 패치마다 10줄 안으로.
 * 새 패치는 PATCHES 맨 앞에 추가.
 */
import { useEffect } from "react";
import { sfx } from "@/lib/rhythm/sfx";

const KR = "font-['Nanum_Gothic',sans-serif]";
const DISP = "font-['Arial_Black','Segoe_UI_Black',Impact,sans-serif] font-black italic";

export interface Patch {
  ver: string;
  name: string;
  date: string;
  lines: string[];
}

export const PATCHES: Patch[] = [
  {
    ver: "v1.1",
    name: "채보 개편",
    date: "2026.10.06",
    lines: [
      "난이도 레벨 새 기준 — 쉬움 1~3 · 보통 4~6 · 어려움 7~11 · 매우 어려움 12~14 · 나이트메어 15~18 (내장곡은 정한 레벨에 맞춰 채보를 다시 뽑음, 내 음악도 같은 구간으로 생성)",
      "자동 채보 밀도 · 최소 간격 · 동시치기를 난이도별로 다시 맞춤 — 난이도마다 목표 레벨에 맞을 때까지 다시 뽑음",
      "동시치기 늘림 — 정박에 많이, 반박 · 16분으로 갈수록 적게. 센 타격엔 3개 동시치기도",
      "동시치기 모양 다양하게 — D+K · F+J 만 번갈아 나오던 것 줄이고, 바로 앞 줄과 겹치는 연타도 줄임",
      "롱노트 정리 — 노트의 3~5%만, 너무 짧은 건 빼고 최소 한 박(0.33초)부터, 정박 · 소리가 남는 자리부터 곡 전체에 고르게",
      "잭(바로 앞 줄과 같은 레인) 비율을 난이도별로 맞춤 — 쉬움 · 보통은 거의 없고, 어려울수록 늘어남",
      "동시치기 모양 — 한 손(D+F · J+K)과 양끝(D+K)이 자주, 가운데(F+J)는 덜",
      "쉬움 · 보통 개선 — 최소 간격을 박 단위로(쉬움 한 박, 보통 반 박), 소리가 나는데 오래 비는 자리는 박 위에 채움. 같은 레벨에서 노트가 더 고르고 덜 휑함. 보통은 동시치기를 5% 안팎으로 줄이고 그만큼 노트를 더 깖",
      "어려움 이상 리듬 고르게 — 8분 · 16분 · 셋잇단이 뒤섞여 간격이 갑자기 바뀌던 자리를 정리(사이에 박을 넣거나 약한 노트를 뺌). 같은 레벨에서 초견이 훨씬 편해짐",
      "노트 모양 기본값이 메탈로 — 예전에 저장된 설정도 한 번 메탈로 바뀜(설정에서 다시 고를 수 있음)",
      "마디선 — 마디 첫 박마다 가로줄이 노트와 같이 내려옴(박자에 맞게, 전보다 잘 보이게)",
      "게임 가이드: 다음 장으로 넘기면 맨 위부터 보이게",
      "모바일에서 곡 선택으로 넘어가도 메뉴 BGM이 계속 나오던 문제 수정",
      "내 음악 — 재킷(사진)을 눌러도 파일 고르기, 곡이 들어가 있는 상태에서 다른 파일을 넣어도 분석 진행 화면이 나옴",
      "연습곡 「패턴 연습」 — 곡 목록 맨 끝. 계단 · 트릴 · 잭 · 동시치기 · 롱노트 · 섞어서를 구간마다 반복, 난이도별로 잘게 쪼갬 (랭킹 없음 · HP가 바닥나도 안 끝남)",
      "4/4 곡이 셋잇단(셔플)으로 잘못 잡혀 BPM이 1.5배로 보이고 16분 · 셋잇단이 섞여 나오던 문제 수정 (Monarch's Fall도 다시 뽑음)",
      "3개 동시치기가 실제로 안 나오던 문제 수정 — 센 정박에 어려움 1% · 매우 어려움 4% · 나이트메어 8% 안팎",
      "나이트메어 연타를 32분에서 16분 셋잇단으로 — 빠른 곡에서 못 칠 만큼 촘촘하던 연타 정리, 꽉 찬 16분 구간도 줄여 숨 쉴 틈을 둠",
      "내 음악 나이트메어 — 빠른 곡(170 BPM 이상 17, 200 이상 18)은 더 높게, 목표보다 어렵게는 안 나옴",
      "osu 랭크 채보 150곡(722개)을 난이도별로 다시 재서 자동 채보 규칙 조정 — 같은 레벨에서 노트는 더 많게, 동시치기·잭은 덜 튀게. 어려움은 8분 위주(16분은 레벨이 모자랄 때만), 쉬움·보통은 롱노트 조금 더, 셔플·12/8 곡은 셋잇단 자리를 4/4의 8분·16분과 같은 무게로",
      "싱크 개편 — 자동 싱크는 플레이 중 시스템이 알아서(화면엔 안 보임): 처음엔 6탭마다 크게 따라붙고(150ms 지연도 2~3마디) 맞은 뒤엔 조금씩만, 흔들림이 큰 초보도 표본이 쌓이면 보정, 빠른 연타에서 엉뚱한 노트에 붙던 표본 제외, 싱크가 잡히기 전 처음 24탭은 HP가 바닥나도 안 끝남, 키보드·터치 × 스피커·이어폰별로 따로 기억. 설정엔 수동 '싱크' 하나만(자동 싱크 위에 더해짐)",
      "판정 시각 정밀도 — 입력 시각을 오디오 시계와 바로 비교하던 것을 같은 시계끼리 비교(버퍼가 큰 모바일·블루투스에서 입력 일부가 5~20ms 일찍 판정되던 문제), 화면 시계는 프레임 시각 기준·주사율 무관, 판정 창이 닫힌 뒤 40ms 안에 늦게 처리된 입력이 다음 노트에 붙지 않게, 창 포커스를 잃으면 누르던 키를 뗀 걸로",
      "프레임 — 노트 머리는 스킨·색별로 한 번 그려 둔 그림을 찍고(매 프레임 그라데이션·그림자 계산 없음), 늘 같은 그라데이션·제목 말줄임은 재사용. 프레임이 계속 떨어지면 박자 빛 → 불꽃 절반·그림자 → 해상도 순으로 한 단계씩 내리고 가벼워지면 되돌림",
      "osu 랭크 106곡을 우리 자동 채보기로 돌려 같은 곡·같은 레벨의 osu 채보와 하나하나 대조 — 빠른 곡(170~280 BPM)을 절반 템포로 잡던 문제 고침(106곡 중 56곡 → 16곡), 동시치기를 센 마디에 몰지 않고 곡 전체에 고르게·세기→밀도 기울기도 완화해 같은 레벨에서 노트 수가 osu의 75~85% → 93~104%로. 내장곡 7곡 다시 뽑음(어려움 이상이 꽤 빽빽해짐)",
      "새 곡 — xi 「ANiMA」(184 BPM) · xi 「FREEDOM DiVE」(222 BPM), 쉬움부터 나이트메어까지. 제작자 xi는 곡 선택·플레이·결과·랭킹에 함께 표기",
      "새 곡 — xi 「Aragami」(196 BPM, 나이트메어 Lv17)",
      "내 음악으로 플레이를 곡 목록에서 빼서 곡 선택 오른쪽 맨 위 MY MUSIC 카드로 — 곡이 늘어도 바로 보이게, M 키로 바로 이동",
      "채보가 곡 흐름과 어긋나던 문제(Aragami 15~24초: 소리가 밀려치는 구간은 비고 잠잠해진 뒤 빽빽) — 타격 세기에 그 순간 음량을 섞고, 마디 세기도 음량 비중을 높이고 터지는 첫 마디가 직전 조용한 마디에 눌리지 않게. 비트 추적이 센 엇박에 끌려 반 박씩 미끄러지던 것도 템포를 세게 묶어 해결. 격자 채우기가 한꺼번에 켜지며 노트가 50% 뛰던 것 매끈하게, 레벨을 못 맞추면 두 시도 사이를 더 나눠 봄. 내장곡 10곡 다시 뽑음",
      "내장곡 7곡 채보 새로 뽑음",
    ],
  },
  {
    ver: "v1.0",
    name: "BEAT DASH",
    date: "2026.10.05",
    lines: [
      "BEAT DASH로 새 출발 — 타이틀 · 곡 선택 · 설정 · 플레이 · 결과까지 16:9 화면 하나에서, 창모드와 전체화면이 같은 모양으로",
      "새 플레이 화면 — 네온 레인 틀, 판정 · 타격 · 콤보 링 이펙트, 은색 콤보, 카운트다운 연출, 효과음과 메뉴 BGM",
      "레인 위치 왼쪽 · 가운데 · 오른쪽, 노트 두께 3단계, 기본 노트 스킨은 메탈",
      "곡 선택 — 큰 재킷, 난이도 탭, 내 최고 기록과 곡별 TOP 10 랭킹, 입력하면 바로 걸러지는 곡 검색",
      "결과 화면 — 배너 · 랭크 엠블럼 · 점수 올라가는 연출, 화면 안에서 바로 랭킹 등록",
      "R 키 — 플레이 중 꾹 누르면 다시 시작, 일시정지 · 결과 화면에선 한 번",
      "신곡 Full Combo!! (180 BPM, 나이트메어 Lv18), 내장곡 7곡 채보를 새 규칙으로 다시 뽑음",
      "내 음악 — 미리 듣기, mp3 속 앨범 사진을 재킷으로, 곡마다 노트 색 랜덤",
      "휴대폰 — 플레이는 레인만 세로 화면 가득 (위에 점수 띠)",
      "기타 — 전체화면에서 Esc는 일시정지, 박자 번쩍임 약하게, 70% 미만 랭크는 F",
    ],
  },
  {
    ver: "v0.3",
    name: "자동 싱크",
    date: "2026.10.04",
    lines: [
      "자동 싱크 — 치는 동안 타이밍 쏠림을 재서 알아서 맞춤 (블루투스처럼 소리가 늦어도 몇 마디면 따라잡음)",
      "채보 패턴 다양화 — 모양 48가지, 같은 모양은 최대 2마디, 반복 구간은 좌우 반전",
      "New Dimension 나이트메어 (Lv17)",
      "곡 선택에서 곡 미리 듣기",
      "게임 가이드 5장으로 정리",
    ],
  },
  {
    ver: "v0.2",
    name: "자작곡 · 내 음악",
    date: "2026.10.03",
    lines: [
      "AI 자작곡 음원 + 내 mp3를 넣으면 자동으로 채보를 만들어 주는 모드 (파일은 서버로 안 올라감)",
      "보스곡 Monarch's Fall · Maximum Velocity, 나이트메어 난이도",
      "채보에 계단 · 연타 · 트릴 같은 손맛 패턴, 난이도 사이 최소 3레벨 차이",
      "곡 검색, 일시정지 화면에 점수 · 정확도 · 평균 타이밍과 '타격 싱크에 적용'",
      "휴대폰 — 화면 깜빡임 수정, 뒤로가기는 일시정지, 플레이 중 전체화면",
    ],
  },
  {
    ver: "v0.1",
    name: "첫 공개",
    date: "2026.09.30",
    lines: [
      "DFJK 4키 리듬게임 첫 공개 — 롱노트, 난이도 4단계, 곡 · 난이도별 랭킹",
      "READY → 3 · 2 · 1 → GO! 카운트다운, 일시정지 뒤 3초 카운트다운으로 재개",
      "노트 속도 · 싱크(±400ms, 1ms 단위) · 음악 볼륨, 플레이 중 ↑ ↓ 로 속도",
      "타격음 · 노트 스킨, 판정선 타격 이펙트, HP와 FAILED, 롱노트 누르는 동안 콤보",
      "휴대폰 터치 지원",
    ],
  },
];

/** 타이틀 버튼에 쓰는 최신 패치 표시 */
export const LATEST = PATCHES[0];

export default function PatchNotes({ onClose }: { onClose: () => void }) {
  // 열린 동안엔 키 입력을 메뉴로 안 보냄 (Esc · Enter · Space = 닫기)
  useEffect(() => {
    sfx("ui-open", 0.7);
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (["Escape", "Enter", "Space", "Backspace"].includes(e.code)) {
        e.preventDefault();
        sfx("ui-back", 0.7);
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-[#05030f]/75 backdrop-blur-[3px] [animation:modal-fade_150ms_ease-out]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          sfx("ui-back", 0.7);
          onClose();
        }
      }}
    >
      <div
        className={`${KR} relative flex max-h-[86%] w-[64cqw] flex-col overflow-hidden rounded-[1.2cqw] border border-white/15 bg-[linear-gradient(160deg,#171431f5,#0b0a1cf8)] shadow-[0_0_4cqw_rgba(236,72,153,0.3)] [animation:modal-pop_200ms_ease-out]`}
      >
        <div className="absolute top-0 left-[2cqw] h-[0.3cqw] w-[8cqw] bg-[linear-gradient(90deg,#EC4899,#7C3AED)]" />
        <div className="flex items-center justify-between border-b border-white/10 px-[2.2cqw] py-[1.3cqw]">
          <span className={`${DISP} text-[2.4cqw] tracking-[0.08em] text-white`}>PATCH NOTES</span>
          <button
            type="button"
            onClick={() => {
              sfx("ui-back", 0.7);
              onClose();
            }}
            className="cursor-pointer rounded-[0.6cqw] border border-white/15 px-[1cqw] py-[0.35cqw] font-mono text-[1.1cqw] text-white/60 hover:border-white/40 hover:text-white"
          >
            닫기 (Esc)
          </button>
        </div>
        <div className="bd-scroll min-h-0 overflow-y-auto px-[2.2cqw] py-[1.4cqw]">
          {PATCHES.map((p, i) => (
            <section
              key={p.ver}
              className={i > 0 ? "mt-[1.8cqw] border-t border-white/10 pt-[1.6cqw]" : ""}
            >
              <div className="mb-[0.8cqw] flex items-center gap-[0.9cqw]">
                <span
                  className={`${DISP} -skew-x-12 rounded-[0.35cqw] px-[0.8cqw] py-[0.15cqw] text-[1.3cqw] text-white`}
                  style={{
                    background:
                      i === 0 ? "linear-gradient(90deg,#DB2777,#7C3AED)" : "rgba(255,255,255,0.1)",
                  }}
                >
                  <span className="inline-block skew-x-12">{p.ver}</span>
                </span>
                <span className="text-[1.7cqw] font-extrabold text-white">{p.name}</span>
                {i === 0 && (
                  <span className="rounded-[0.3cqw] bg-[#F472B6] px-[0.6cqw] py-[0.1cqw] text-[0.95cqw] font-extrabold text-white">
                    최신
                  </span>
                )}
                <span className="ml-auto font-mono text-[1.1cqw] text-white/45">{p.date}</span>
              </div>
              <ul className="flex flex-col gap-[0.5cqw]">
                {p.lines.map((l, k) => (
                  <li
                    key={k}
                    className="flex gap-[0.8cqw] text-[1.25cqw] leading-snug break-keep text-white/85"
                  >
                    <span className="mt-[0.55cqw] h-[0.5cqw] w-[0.5cqw] shrink-0 rotate-45 bg-[linear-gradient(135deg,#F472B6,#A78BFA)]" />
                    <span>{l}</span>
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
