import Link from "next/link";
import { Arrow, Bullets, FlowBox, Section, Shot, StackTable, StatGrid, TroubleList, type Trouble } from "./ProjectDetailUI";

import titleImg from "@/img/Page/info/poker/title.webp";
import lobbyImg from "@/img/Page/info/poker/lobby.webp";
import tableImg from "@/img/Page/info/poker/table.webp";
import sevenImg from "@/img/Page/info/poker/seven.webp";

// ───────────────────────── 데이터 ─────────────────────────

const STATS = [
  { value: "2종목", label: "홀덤 6인 · 7포커 5인" },
  { value: "6명", label: "애니풍 캐릭터" },
  { value: "3단계", label: "동네판 · 하우스 · VIP룸" },
  { value: "v1.0", label: "2026.10" },
];

const STACK: { group: string; items: string[] }[] = [
  { group: "화면", items: ["React 19", "TypeScript", "Tailwind CSS", "컨테이너 쿼리(cqmin) 무대 — 폰 세로 · PC 가로 자동 배치"] },
  { group: "서버", items: ["Express", "socket.io 게이트웨이(구독 · RPC)", "MongoDB (지갑 · 핸드 기록)"] },
  { group: "규칙", items: ["홀덤 · 7포커 엔진을 순수 TS 모듈로 — 웹과 서버가 같은 파일을 import", "엔진 단위 테스트 360여 개"] },
  { group: "에셋", items: ["AI 생성 원화 → 파이썬 가공(크로마키 · 셀 분리 · 덩어리 분리 · webp)"] },
];

const FEATURES: { title: string; items: string[] }[] = [
  {
    title: "게임",
    items: [
      "홀덤: 전원 기본 판돈(앤티) + SB/BB, 노리밋, 사이드팟 · 우선쇼 규칙까지 구현",
      "7포커: 버릴 카드 → 펼 카드 두 번 탭으로 시작, 체크 없이 삥 · 따당 · 쿼터 · 하프 또는 다이",
      "판돈 3단계 방 + 비밀번호 방, 자금 순위, 칩이 바닥나면 기본 칩 자동 지급(하루 10번)",
    ],
  },
  {
    title: "같이 치는 느낌",
    items: [
      "익명 유저봇이 수시로 들어오고 나감 — 별명 · 성향 · 실력 · 머무는 판 수가 모두 난수",
      "캐릭터가 테이블에 앉아 포즈 · 표정이 바뀌고, 이모티콘 · 대사 말풍선 · 올인 컷인",
      "이름표를 누르면 그 방에서 딴 돈 · 전적(승률)이 보임 — 봇도 똑같이 집계",
    ],
  },
  {
    title: "플레이 UX",
    items: [
      "외침(체크 · 레이즈 · 삥…)이 캐릭터에게서 판 가운데로 커지며 날아가는 대사 연출",
      "차례가 아닐 때도 같은 베팅 버튼 줄이 남아 미리 눌러 두면 차례에 자동 실행(한게임식 프리액션)",
      "3초 남으면 3 · 2 · 1 카운트다운, 지금 차례 표시 바, 메이드(트리플 이상)면 카드 뒤 금빛 버스트",
      "나가기는 판이 끝나면 나가는 예약 방식 — 중간 이탈로 판이 깨지지 않음",
    ],
  },
];

const TROUBLES: Trouble[] = [
  {
    title: "남의 패가 새지 않게",
    problem: "상태를 그대로 쏘면 개발자 도구만 열어도 남의 패 · 다음 카드가 보일 수 있다.",
    cause: "덱 · 패 같은 숨은 정보가 공개 상태와 한 덩어리로 다뤄졌기 때문.",
    solution:
      "덱과 패는 서버 메모리에만 두고, 모두가 보는 테이블 구독과 나만 받는 내 패 구독을 분리. 쇼다운 전에는 어떤 이벤트에도 남의 카드가 실리지 않는 걸 구경꾼 시점 테스트로 고정했다.",
  },
  {
    title: "봇이 봇처럼 보이던 것",
    problem: "몇 명이 즉답으로만 치니 한눈에 봇 티가 났다.",
    cause: "이름 · 성향 · 생각 시간이 고정값이었기 때문.",
    solution:
      "별명 생성기 + 성향(공격성 · 블러프 · 콜 기준 · 페이스) 난수로 매번 다른 '유저'를 만들고, 입장 간격 · 머무는 판 수 · 생각 시간(1.2초~제한 직전)을 전부 흔들었다. 패 평가에도 노이즈를 섞어 가끔 실수하게 했다.",
  },
  {
    title: "미리 행동 · 카운트다운의 경합",
    problem: "프리액션이 지난 차례에 나가거나, 행동한 뒤에도 카운트다운이 떴다.",
    cause: "행동 전송과 서버 상태 도착 사이의 짧은 틈 동안 화면은 아직 '내 차례'였기 때문.",
    solution:
      "차례마다 고유한 마감시각(deadline)을 '이미 행동한 차례'의 키로 기억해 그 차례의 자동 실행 · 카운트다운을 막았다. 콜 예약은 눌러 둔 시점의 베팅 금액이 그대로일 때만 나간다.",
  },
  {
    title: "AI 원화를 게임 에셋으로",
    problem: "받은 시트는 머리카락이 칸을 넘어가고 배경색이 비쳤다.",
    cause: "시트를 균등한 칸으로만 잘랐기 때문.",
    solution:
      "파이썬으로 크로마키 제거 · 셀 분리에 연결 요소(덩어리) 분석을 더해 옆 칸에서 넘어온 조각을 지웠다. 앉은 그림은 '테이블에 가려지는 선'을 기준으로 줄을 맞춰 어떤 캐릭터든 같은 좌표에 앉는다.",
  },
];

// ───────────────────────── 페이지 ─────────────────────────

export default function AnimePokerProject() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 font-mono text-sm text-[#8B84FF]">game · gunmo.my</div>
      <h1 className="font-mono text-3xl font-bold text-white sm:text-4xl">ANIME POKER</h1>
      <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-white/60">
        애니풍 캐릭터 6명과 치는 홀덤 · 7포커. 유저봇이 들락날락하는 실시간 테이블.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-xs">
        <span className="rounded-full border border-white/10 px-3 py-1 text-white/50">2026.10 – v1.0</span>
        <Link href="/games/poker/" className="rounded-full bg-[#6C63FF] px-4 py-1 text-white transition-colors hover:bg-[#5b52f0]">
          플레이
        </Link>
      </div>

      <div className="mt-8">
        <Shot img={titleImg} alt="타이틀 화면 — 여섯 캐릭터가 포커 치는 움직이는 배경" />
      </div>

      <StatGrid stats={STATS} />

      <Section num="01" title="개요">
        <div className="flex flex-col gap-3 font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/70">
          <p>
            캐릭터를 골라 테이블에 앉으면 익명 유저들이 수시로 들어오고 나가는 포커 게임입니다. 돈과 카드는 전부{" "}
            <b className="text-white">서버가 계산</b>하고, 화면은 "무엇을 할지"만 보냅니다. 홀덤 · 7포커 규칙 엔진은 순수
            TypeScript 모듈이라 웹과 서버가 같은 파일을 쓰고, 같은 테스트로 검증됩니다. 실제 돈이 아닌 사이트 안 점수로만
            칩니다.
          </p>
        </div>
      </Section>

      <Section num="02" title="기술 스택">
        <StackTable rows={STACK} />
      </Section>

      <Section num="03" title="한 판의 흐름">
        <div className="rounded-xl border border-white/10 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
            <FlowBox title="행동 보냄" sub="콜 · 레이즈 얼마 · 카드 고르기 (RPC)" />
            <Arrow />
            <FlowBox title="서버 엔진" sub="차례 · 금액 · 규칙 검사 → 상태 갱신" accent />
            <Arrow />
            <div className="flex flex-col gap-2">
              <FlowBox title="테이블 구독" sub="모두가 보는 공개 상태" />
              <FlowBox title="내 패 구독" sub="나만 받는 숨은 정보" />
            </div>
          </div>
        </div>
        <div className="mt-4">
          <Bullets
            items={[
              "쇼다운 전에는 어떤 이벤트에도 남의 패가 실리지 않음 (구경꾼 시점 테스트로 고정)",
              "판이 끝날 때마다 사람 몫의 증감을 DB에 반영하고 핸드 기록을 남김",
              "시간 초과 · 접속 끊김 · 중간 이탈은 서버가 대신 처리 — 판은 항상 끝까지 돈다",
            ]}
          />
        </div>
      </Section>

      <Section num="04" title="화면">
        <div className="grid gap-4 sm:grid-cols-2">
          <Shot img={lobbyImg} alt="로비 — 모드 · 판돈 3단계 · 열린 방" />
          <Shot img={tableImg} alt="홀덤 테이블" />
        </div>
        <div className="mt-4">
          <Shot img={sevenImg} alt="7포커 — 삥 · 쿼터 · 하프 베팅" />
        </div>
      </Section>

      <Section num="05" title="만든 것들">
        <div className="grid gap-6 sm:grid-cols-1">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-white/10 p-4 sm:p-5">
              <div className="mb-2 font-mono text-sm text-white">{f.title}</div>
              <Bullets items={f.items} />
            </div>
          ))}
        </div>
      </Section>

      <Section num="06" title="문제와 해결">
        <TroubleList items={TROUBLES} />
      </Section>
    </div>
  );
}
