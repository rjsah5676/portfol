import Link from "next/link";
import {
  Arrow,
  Bullets,
  FlowBox,
  Section,
  Shot,
  StackTable,
  StatGrid,
  TroubleList,
  type Trouble,
} from "./ProjectDetailUI";

import titleImg from "@/img/Page/info/pixelfight/title.webp";
import selectImg from "@/img/Page/info/pixelfight/select.webp";
import matchImg from "@/img/Page/info/pixelfight/match.webp";

// ───────────────────────── 데이터 ─────────────────────────

const STATS = [
  { value: "6명", label: "캐릭터" },
  { value: "4개", label: "맵" },
  { value: "6단계", label: "AI 난이도" },
  { value: "60fps", label: "고정 프레임 계산" },
];

const STACK: { group: string; items: string[] }[] = [
  { group: "게임 로직", items: ["TypeScript", "정수 연산 시뮬레이션", "프레임 데이터"] },
  { group: "화면 · 소리", items: ["Canvas 2D", "스프라이트 아틀라스", "Web Audio API", "React 19"] },
  { group: "온라인", items: ["WebRTC 데이터 채널", "롤백 넷코드", "socket.io (대기실 · 신호 · 중계)"] },
  { group: "도구", items: ["AI 리그전 밸런스 시뮬레이션", "스프라이트 시트 → 아틀라스 스크립트"] },
];

const FEATURES: { title: string; items: string[] }[] = [
  {
    title: "대전 방식",
    items: [
      "AI 대전: 입문부터 달인까지 6단계, 이기면 랭킹 등록",
      "2인 대전: 한 키보드로 둘이서 (게임패드 지원)",
      "온라인 대전: 방을 만들어 1:1, 대기실 채팅, 한 판 더",
      "연습 모드: 가만히 있는 허수아비 상대로 콤보 연습 (히트 수 · 피해 표시)",
    ],
  },
  {
    title: "격투 시스템",
    items: [
      "발판을 오르내리는 플랫폼 대전 — 2단 점프, 대시(공중 1번), 낭떠러지",
      "약 · 발차기 · 아이덴티티 기술 · 필살기, 캐릭터 6명이 기술과 상태 이상(화상 · 감전 · 방울 · 일시정지 · 혼란)이 모두 다름",
      "가드 · 저스트 가드 · 가드 반격, 잡기와 잡기 풀기, 돌진 잡기, 카운터 히트",
      "공중 콤보 — 같은 기술만 반복하면 덜 아프고, 내려찍기로 마무리하면 다운",
      "기술마다 발동 · 지속 · 후딜 · 막혔을 때 이득을 프레임 단위로 정의",
    ],
  },
  {
    title: "조작 · 화면",
    items: [
      "키보드 두 가지 배치 · 게임패드 · 휴대폰 터치(스틱/키 선택)",
      "전체화면, 일시정지 메뉴, 효과음 · 배경음악 설정, 맵별 배경음악",
      "게임 안 패치노트와 조작 · 기술 안내",
    ],
  },
];

const TROUBLES: Trouble[] = [
  {
    title: "양쪽 화면이 서로 다른 경기를 하고 있음",
    problem: "온라인에서 계산이 한 번 어긋나면 그대로 다른 결과로 흘러가는데, 양쪽 다 모르고 계속 진행",
    cause: "롤백 방식은 입력만 주고받으므로, 버전이 다르거나 계산이 한 군데만 달라도 상태가 갈라짐",
    solution:
      "캐릭터 · 맵 데이터와 계산 버전으로 만든 빌드 값을 입력과 함께 보내고, 60프레임마다 확정된 상태의 해시를 교환 → 다르면 판을 멈추고 알려 줌",
  },
  {
    title: "지연이 있으면 타격음 · 이펙트가 빠짐",
    problem: "상대 입력이 늦게 와서 되감은 프레임의 타격음과 이펙트가 재생되지 않음",
    cause: "소리 · 이펙트를 '새로 계산한 프레임'의 이벤트로만 재생해서, 되감아 다시 계산하며 새로 생긴 타격은 놓침",
    solution:
      "되감아 다시 계산할 때 전에 없던 이벤트만 골라 함께 내보내도록 변경 → 온라인 타격 이벤트 누락 0",
  },
  {
    title: "맞는 걸 보고 누른 버튼이 씹힘",
    problem: "히트스톱이나 필살기 연출 중에 누른 캔슬 · 연타가 나가지 않음",
    cause: "화면이 멈춘 동안에도 입력 기록이 한 칸씩 밀려, 멈춤이 풀릴 때는 이미 기록에서 사라짐",
    solution: "멈춘 동안에는 기록을 밀지 않고 마지막 칸에 누적, 풀리는 순간 바로 나가게",
  },
  {
    title: "잡기만 반복하는 무한 콤보",
    problem: "잡기 → 내려찍기 → 누운 상대 다시 잡기를 끝없이 반복할 수 있었음",
    cause: "누운 상대를 다시 띄우는 잡기에 횟수 제한이 없었음",
    solution: "누운 상대 잡기는 콤보마다 한 번으로 제한 (반복해도 3.3초 4히트에서 끊김)",
  },
  {
    title: "낭떠러지로 떨어져서 버티면 이김",
    problem: "떨어지면 무적으로 다시 내려오는 규칙을 이용해, 일부러 계속 떨어지며 시간을 끄는 쪽이 유리",
    cause: "다시 내려온 뒤의 무적이 조건 없이 매번 주어짐",
    solution:
      "땅에서 4초를 버티기 전에 또 떨어지면 무적 없이 체력 6% 감소, 무적은 공격하면 끝 → 시뮬레이션에서 이 전략의 승률 88% → 0%",
  },
];

// ───────────────────────── 페이지 ─────────────────────────

export default function PixelFightProject() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 font-mono text-sm text-[#8B84FF]">game · gunmo.my</div>
      <h1 className="font-mono text-3xl font-bold text-white sm:text-4xl">PIXEL FIGHT</h1>
      <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-white/60">
        브라우저에서 하는 1:1 플랫폼 격투게임. AI · 한 키보드 2인 · 온라인 대전.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-xs">
        <span className="rounded-full border border-white/10 px-3 py-1 text-white/50">
          2026.10 – 업데이트 중
        </span>
        <Link
          href="/games/fight/"
          className="rounded-full bg-[#6C63FF] px-4 py-1 text-white transition-colors hover:bg-[#5b52f0]"
        >
          플레이
        </Link>
      </div>

      <div className="mt-8">
        <Shot img={titleImg} alt="타이틀 화면" />
      </div>

      <StatGrid stats={STATS} />

      <Section num="01" title="개요">
        <div className="flex flex-col gap-3 font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/70">
          <p>
            도트 캐릭터 6명이 발판 위에서 싸우는 1:1 격투게임입니다. 게임 로직은 그림 · 소리 ·
            시간과 분리된 <b className="text-white">결정론적 시뮬레이션</b>으로 짰습니다. 같은
            상태에 같은 입력을 넣으면 어느 기기에서 돌려도 같은 결과가 나오고, 온라인 대전 · AI ·
            밸런스 시뮬레이션이 모두 이 한 가지 계산을 같이 씁니다.
          </p>
        </div>
      </Section>

      <Section num="02" title="기술 스택">
        <StackTable rows={STACK} />
      </Section>

      <Section num="03" title="온라인 대전 구조">
        <div className="rounded-xl border border-white/10 p-4 sm:p-5">
          <div className="mb-3 font-mono text-[11px] text-white/40">연결</div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
            <FlowBox title="대기실" sub="방 · 자리 · 캐릭터 · 준비 (서버)" />
            <Arrow />
            <FlowBox title="WebRTC 연결" sub="서버로 연결 정보 교환" accent />
            <Arrow />
            <div className="flex flex-col gap-2">
              <FlowBox title="P2P 데이터 채널" sub="입력만 주고받음" />
              <FlowBox title="서버 중계" sub="P2P가 안 될 때" />
            </div>
          </div>

          <div className="mt-6 mb-3 font-mono text-[11px] text-white/40">한 프레임</div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <FlowBox title="내 입력 예약" sub="몇 프레임 뒤에 적용 + 상대에게 전송" />
            <Arrow />
            <FlowBox title="상대 입력 예측" sub="아직 안 왔으면 마지막 입력이 이어진다고 봄" />
            <Arrow />
            <FlowBox title="틀렸으면 되감기" sub="저장해 둔 상태에서 다시 계산" accent />
          </div>
        </div>
        <div className="mt-4">
          <Bullets
            items={[
              "계산은 실수 없이 정수만(1px = 256), 난수 · 시계를 쓰지 않음 → 양쪽이 같은 입력을 받으면 같은 상태",
              "데이터 채널은 순서 보장 · 재전송 없이 쓰고, 상대가 아직 확인 안 한 입력을 매번 묶어서 다시 보냄",
              "한쪽이 계속 앞서 가면 앞선 쪽이 가끔 한 프레임 쉬어 속도를 맞춤",
              "입력은 프레임마다 9비트(방향 4 + 버튼 5)",
            ]}
          />
        </div>
      </Section>

      <Section num="04" title="주요 기능">
        <div className="flex flex-col gap-10">
          {FEATURES.map((f) => (
            <div key={f.title}>
              <h3 className="mb-3 font-mono text-base font-medium text-white">{f.title}</h3>
              <Bullets items={f.items} />
            </div>
          ))}
          <div className="grid gap-3 sm:grid-cols-2">
            <Shot img={selectImg} alt="캐릭터 선택" />
            <Shot img={matchImg} alt="대전 화면" />
          </div>
        </div>
      </Section>

      <Section num="05" title="AI와 밸런스">
        <Bullets
          items={[
            "AI는 매 프레임 상태를 보고 사람처럼 입력을 만듦 — 반응 속도(몇 프레임 뒤에 알아채나)와 가드 · 대공 · 콤보 확률로 6단계를 나눔",
            "AI끼리 리그전을 돌려 캐릭터별 승률표 · 평균 경기 시간 · 기술별 피해 비중을 뽑고, 그 수치를 보며 조정",
            "수정 뒤에는 무작위 입력 270만 프레임을 돌려 멈추거나 어긋나는 경우가 없는지 확인",
          ]}
        />
      </Section>

      <Section num="06" title="트러블슈팅">
        <TroubleList items={TROUBLES} />
      </Section>
    </div>
  );
}
