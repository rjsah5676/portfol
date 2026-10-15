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
import { CHARS, ITEMS } from "@/lib/marble/data";
import { MAP_IDS } from "@/lib/marble/maps";

import titleImg from "@/img/Page/info/marble/title.webp";
import boardImg from "@/img/Page/info/marble/board.webp";
import diceImg from "@/img/Page/info/marble/dice.webp";
import ladderImg from "@/img/Page/info/marble/ladder.webp";
import skillImg from "@/img/Page/info/marble/skill.webp";
import gachaImg from "@/img/Page/info/marble/gacha.webp";

// ───────────────────────── 데이터 ─────────────────────────

const STATS = [
  { value: `${MAP_IDS.length}개`, label: "맵 (둘레 32칸 · 20바퀴)" },
  { value: `${CHARS.length}명`, label: "캐릭터 (R · SR · SSR · UR)" },
  { value: `${ITEMS.length}종`, label: "장착 아이템 (주사위 · 동행 등)" },
  { value: "최대 4명", label: "빈자리는 AI" },
];

const STACK: { group: string; items: string[] }[] = [
  {
    group: "화면",
    items: [
      "React 19 · TypeScript",
      "1024×576 무대를 통째로 확대 · 축소, 폰은 가로 전용",
      "말은 PIXEL FIGHT 도트 캐릭터, 보드 · UI 는 매끈한 카드형",
      "Web Audio — 배경음 6곡 · 효과음",
    ],
  },
  {
    group: "엔진",
    items: [
      "결정적 상태 기계 하나를 서버 · 화면 · AI 가 같이 씀 (시드 난수)",
      "차례마다 묻는 것(굴리기 · 사기 · 인수 · 축제 · 대출 …)을 프롬프트로 정리",
      "밸런스 시뮬레이터 — 등급 · 캐릭터 · 아이템별로 수천 판 돌려 승률 확인",
    ],
  },
  {
    group: "서버",
    items: [
      "Express · socket.io 게이트웨이(구독 · RPC)",
      "판 진행은 서버가 엔진으로 직접 — 화면은 요청만 보냄",
      "MongoDB — 캐릭터 · 아이템 · 재화 프로필, 업적 · 일일 미션 · GP",
    ],
  },
];

const FEATURES: { title: string; items: string[] }[] = [
  {
    title: "게임",
    items: [
      "주사위로 동네를 돌며 땅을 사고, 건물을 올리고, 남의 땅은 인수 — 20바퀴 뒤 자산이 가장 많은 사람이 승리",
      "해피 타운 · 크로스 익스프레스(네 변 기차역을 오가는 철도) · 오르골 정원, 맵마다 다른 규칙과 마을 소식(축제 · 장마 · 건설 붐 …)",
      "힘 조절 굴리기 — 게이지로 약 · 중 · 강을 고르면 그 구간 합이 나올 확률이 올라감",
      "사다리로 차례 정하기, 통행료가 모자라면 판마다 한 번 대출, 출발 포털에 서면 내 땅 하나 바로 짓기",
    ],
  },
  {
    title: "캐릭터 · 성장",
    items: [
      "PIXEL FIGHT 와 같은 세계관의 캐릭터 — 각자 판을 바꾸는 스킬 하나 (ROLL 옆 큰 버튼으로 바로 씀)",
      "등급 R · SR · SSR · UR, 강화 단계까지 한 숫자(파워)로 효과 계산, 뽑기 · 가방 · 상점",
      "올강화 대 기본 캐릭터 승률을 75 : 25 근처로 맞춰 운이 남는 게임으로",
    ],
  },
  {
    title: "편하게",
    items: [
      "바로 시작 — 열린 방에 들어가거나 새 방을 열고, 빈자리는 AI 가 채움",
      "방장 강퇴(사람이면 그 방 재입장 막음), 정한 시간이 지나면 자동 진행",
      "아이폰 「홈 화면에 추가」로 주소창 없는 전체화면",
    ],
  },
];

const TROUBLES: Trouble[] = [
  {
    title: "누가 굴려도 같은 판",
    problem:
      "화면마다 주사위 · 카드 · 마을 소식을 따로 뽑으면 사람마다 판이 달라지고, 결과를 조작할 수도 있다.",
    cause: "운이 들어가는 계산이 브라우저에 있었기 때문.",
    solution:
      "판의 모든 진행을 시드 난수를 쓰는 결정적 엔진 하나로 모으고, 서버만 그 엔진을 돌린다. 브라우저는 「굴린다 · 산다 · 넘긴다」 같은 요청만 보내고, 서버가 바뀐 상태를 모두에게 뿌린다. AI 도 같은 엔진 위에서 같은 요청을 만든다.",
  },
  {
    title: "강한 캐릭터만 이기는 문제",
    problem:
      "뽑기 등급이 높을수록 너무 쉽게 이겨서 기본 캐릭터로는 할 맛이 안 났다.",
    cause:
      "스킬 · 아이템 효과를 감으로 정해 등급 차이가 그대로 승률 차이가 됐다.",
    solution:
      "효과를 「등급 바닥 + 강화 단계」 한 숫자로 계산하게 바꾸고, 시뮬레이터로 캐릭터 · 아이템 · 등급별 수천 판을 돌려 올강화 대 기본 승률이 75 : 25 근처가 되도록 수치를 맞췄다.",
  },
  {
    title: "자리를 비운 사람 때문에 멈추는 판",
    problem: "한 사람이 응답하지 않으면 나머지 셋이 계속 기다려야 했다.",
    cause: "묻는 단계마다 사람의 대답을 끝없이 기다렸기 때문.",
    solution:
      "굴리기 · 사기 · 인수 같은 단계마다 제한 시간을 두고, 시간이 지나면 서버가 엔진의 기본 행동으로 대신 진행한다. 그 자리는 「자동」 표시가 붙고, 돌아오면 바로 이어서 할 수 있다.",
  },
];

// ───────────────────────── 페이지 ─────────────────────────

export default function DiceTownProject() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 font-mono text-sm text-[#8B84FF]">
        game · gunmo.my
      </div>
      <h1 className="font-mono text-3xl font-bold text-white sm:text-4xl">
        DICE TOWN
      </h1>
      <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-white/60">
        주사위를 굴려 동네를 돌며 땅을 사고, 짓고, 인수하는 웹 보드게임. PIXEL
        FIGHT 와 같은 세계관의 캐릭터로 최대 4명이 함께해요.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-xs">
        <span className="rounded-full border border-white/10 px-3 py-1 text-white/50">
          2026.10 –
        </span>
        <Link
          href="/games/marble/"
          className="rounded-full bg-[#6C63FF] px-4 py-1 text-white transition-colors hover:bg-[#5b52f0]"
        >
          플레이
        </Link>
      </div>

      <div className="mt-8">
        <Shot img={boardImg} alt="해피 타운 — 땅 · 건물 · 세 사람의 말" />
      </div>

      <StatGrid stats={STATS} />

      <Section num="01" title="개요">
        <div className="flex flex-col gap-3 font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/70">
          <p>
            어릴 때 하던 부루마블 · 모두의마블 같은 보드게임을 웹에서, 이
            사이트의 다른 게임 캐릭터로 즐기도록 만들었습니다. 캐릭터마다 스킬이
            하나씩 있고, 장착 아이템과 맵 규칙이 더해져 판마다 흐름이
            달라집니다.
          </p>
          <p>
            판의 진행은 <b className="text-white">결정적 엔진 하나</b>가
            맡습니다. 서버가 그 엔진으로 판을 돌리고, 화면은 요청만 보내며, AI
            와 밸런스 시뮬레이터도 같은 엔진을 씁니다.
          </p>
        </div>
      </Section>

      <Section num="02" title="기술 스택">
        <StackTable rows={STACK} />
      </Section>

      <Section num="03" title="한 차례의 흐름">
        <div className="rounded-xl border border-white/10 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
            <FlowBox
              title="내 화면 · AI"
              sub="굴리기 · 사기 · 인수 · 스킬 요청"
            />
            <Arrow />
            <FlowBox
              title="서버 (엔진)"
              sub="차례 · 제한 시간 확인 → 상태 진행"
              accent
            />
            <Arrow />
            <FlowBox title="모두에게" sub="바뀐 판 · 다음에 물을 것" />
          </div>
        </div>
        <div className="mt-4">
          <Bullets
            items={[
              "다음 사람에게 물을 것(굴리기 · 사기 · 인수 · 축제 · 대출 …)도 엔진이 정해서 같이 보냄",
              "제한 시간이 지나면 서버가 기본 행동으로 대신 진행 — 자리는 「자동」 표시",
            ]}
          />
        </div>
      </Section>

      <Section num="04" title="화면">
        <div className="grid gap-4 sm:grid-cols-2">
          <Shot img={titleImg} alt="메뉴 — 내 캐릭터 · 맵 고르기 · 열린 방" />
          <Shot img={ladderImg} alt="사다리로 차례 정하기" />
          <Shot img={diceImg} alt="주사위 굴리기" />
          <Shot img={skillImg} alt="이동 전 스킬 쓰기 (질풍 다시 굴리기)" />
        </div>
        <div className="mt-4">
          <Shot img={gachaImg} alt="뽑기 — 한정 배너" />
        </div>
      </Section>

      <Section num="05" title="만든 것들">
        <div className="grid gap-6 sm:grid-cols-1">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-white/10 p-4 sm:p-5"
            >
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
