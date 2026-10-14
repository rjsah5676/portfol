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
import { UNITS } from "@/lib/defense/units";
import { BOSSES } from "@/lib/defense/enemies";
import { CHEATS } from "@/lib/defense/cheats";

import titleImg from "@/img/Page/info/defense/title.webp";
import playImg from "@/img/Page/info/defense/play.webp";
import bossImg from "@/img/Page/info/defense/boss.webp";
import waveImg from "@/img/Page/info/defense/wave.webp";
import codexImg from "@/img/Page/info/defense/codex.webp";
import hubImg from "@/img/Page/info/defense/hub.webp";

// ───────────────────────── 데이터 ─────────────────────────

const STATS = [
  { value: `${UNITS.length}종`, label: "유닛 (세 세력 · 히든 · 초월)" },
  {
    value: `60웨이브 · 보스 ${BOSSES.length}`,
    label: "10웨이브마다 오염된 파이터",
  },
  { value: `${CHEATS.length}장`, label: "보스를 잡으면 고르는 치트 코드" },
  { value: "최대 4명", label: "멀티 (락스텝)" },
];

const STACK: { group: string; items: string[] }[] = [
  {
    group: "화면",
    items: [
      "React 19 · TypeScript",
      "Canvas 2D — 도트 2.5D 필드 (발 위치 순서로 겹침)",
      "1024×576 무대를 정수 배율로 확대 · 축소, 폰은 가로 전용",
      "도트 UI (계단 테두리 · steps() 움직임 · 갈무리 글꼴)",
    ],
  },
  {
    group: "엔진",
    items: [
      "결정론 시뮬 하나를 화면 · 서버 · 밸런스 봇이 같이 씀",
      "시드 난수(mulberry32) · 명령 기록 다시 돌리기",
      "봇 전략 8종 × 판 수로 밸런스 표 · 웨이브별 체력 vs DPS 곡선",
    ],
  },
  {
    group: "서버",
    items: [
      "Express · socket.io 게이트웨이",
      "기록 검증은 작업 스레드(worker_threads)",
      "MongoDB — 랭킹 · 판 밖 성장 프로필 · GP 원장",
    ],
  },
  {
    group: "소리",
    items: [
      "Web Audio — 효과음 종류별 최소 간격 · 동시 14개 제한",
      "웨이브 · 보스에 맞춰 배경음이 바뀜",
    ],
  },
];

const FEATURES: { title: string; items: string[] }[] = [
  {
    title: "게임",
    items: [
      "소환은 운, 배치는 실력 — 기사단(소형 킬러) · 기계공방(대형 · 범위) · 마도회(마법 · 방어 무시)가 적 크기별 상성",
      "같은 유닛 3기를 합치면 한 등급 위 (노말 → 레어 → 에픽 → 레전드), 신화 · 히든은 조합식, 그 위로 초월",
      "10웨이브마다 글리치에 오염된 PIXEL FIGHT 파이터가 보스로 — 회복 · 돌진 · 보호막 · 소환 · 회피 기술",
      "보스를 잡으면 치트 코드 3장 중 하나 (고르는 동안 멈춤), 균열 미션 · 도박 웨이브로 한 판마다 갈림길",
    ],
  },
  {
    title: "판 밖 성장",
    items: [
      "유닛 강화 · 연구 · 유물 · 블록 테마, 오염 단계를 올릴수록 적이 세지고 보상 · 시즌 점수가 커짐",
      "하루 · 주 미션, 4주 시즌 패스 30단계, 상점(패키지 · 상자 · 초월 소환)",
      "사이트 공용 GP와 연결 — 재화를 GP로 바꾸거나 GP로 패스 · 패키지를 사고, 원장에 그대로 남음",
    ],
  },
  {
    title: "편하게",
    items: [
      "끌어서 자리 바꾸기(같은 유닛이면 한곳에 모음), 단축키 Q 소환 · W 합성 · E 판매 · F 배속 · Space 멈춤",
      "판 안 튜토리얼 카드 9장, 도감(유닛 · 조합식 · 보스), 패치노트",
      "새로고침 · 탭을 닫아도 진행 중인 멀티 판으로 돌아가기",
    ],
  },
];

const TROUBLES: Trouble[] = [
  {
    title: "랭킹 기록을 믿을 수 있게",
    problem:
      "디펜스는 수천 tick 동안 유닛 수십 기가 싸우는 게임이라, 브라우저가 보낸 점수만 받으면 얼마든지 고칠 수 있다.",
    cause: "결과를 계산하는 곳이 브라우저 하나뿐이었기 때문.",
    solution:
      "판을 시작할 때 서버가 시드와 로드아웃(강화 · 연구 · 유물)을 정해 주고, 브라우저는 결과 대신 명령 기록만 보낸다. 서버는 작업 스레드에서 같은 시뮬로 처음부터 다시 돌려 점수를 낸다. 실제 걸린 시간이 최대 배속으로도 불가능하게 짧으면 거절하고, 밸런스 버전이 바뀌면 순위표를 따로 쌓는다.",
  },
  {
    title: "어디서 돌려도 같은 결과",
    problem: "같은 기록을 서버에서 다시 돌렸는데 결과가 조금씩 달랐다.",
    cause:
      "Math.random · Date는 물론이고 Math.pow · sin 같은 함수도 엔진마다 끝자리가 다를 수 있어, 수천 tick이 지나면 차이가 커졌다.",
    solution:
      "시뮬 안에서는 시드 난수와 사칙연산 · sqrt · 반올림만 쓰기로 정하고, 거듭제곱은 표로 미리 곱해 두었다. 실패한 명령은 상태를 하나도 바꾸지 않게 검사 → 변경 순서로 짜고, 밸런스 봇이 매 판 기록을 다시 돌려 결과를 비교해 깨지면 바로 알게 했다.",
  },
  {
    title: "멀티 화면이 어긋나지 않게",
    problem:
      "최대 4명이 같은 시드로 겨루는데, 서버가 시뮬을 돌리면 방마다 부하가 크다.",
    cause: "모든 판을 서버에서 진행하는 구조였기 때문.",
    solution:
      "서버는 100ms마다 모인 명령을 차례 번호와 함께 뿌리기만 하고(락스텝), 각자 같은 시뮬을 돌린다. 5초마다 상태 해시를 보내 다르면 서버 로그와 화면에 바로 표시하고, 끊긴 사람은 60초를 기다린 뒤 순위를 낸다.",
  },
  {
    title: "PC에서 도트 글자가 깨지던 것",
    problem: "무대를 화면에 맞춰 줄이면 도트 글꼴 획이 빠지거나 흐려졌다.",
    cause: "무대 배율과 위치가 소수점이라 글자가 픽셀 사이에 걸렸기 때문.",
    solution:
      "무대 배율을 (배율 × 화면 배율)이 정수가 되게 맞추고 위치도 정수 px로 밀었다. 갈무리 글꼴이 또렷한 12px 아래로는 쓰지 않는다.",
  },
];

// ───────────────────────── 페이지 ─────────────────────────

export default function LuckyDefenseProject() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 font-mono text-sm text-[#8B84FF]">
        game · gunmo.my
      </div>
      <h1 className="font-mono text-3xl font-bold text-white sm:text-4xl">
        PIXEL LUCKY DEFENSE
      </h1>
      <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-white/60">
        PIXEL FIGHT 외전 운빨 랜덤 디펜스. 수호자를 소환 · 합성해서 글리치에
        오염된 파이터들을 60웨이브까지 막아요.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-xs">
        <span className="rounded-full border border-white/10 px-3 py-1 text-white/50">
          2026.10 –
        </span>
        <Link
          href="/games/defense/"
          className="rounded-full bg-[#6C63FF] px-4 py-1 text-white transition-colors hover:bg-[#5b52f0]"
        >
          플레이
        </Link>
      </div>

      <div className="mt-8">
        <Shot
          img={titleImg}
          alt="메뉴 — 시즌 도전 · 상점 · 정비소 · 함께 하기"
        />
      </div>

      <StatGrid stats={STATS} />

      <Section num="01" title="개요">
        <div className="flex flex-col gap-3 font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/70">
          <p>
            격투 게임 PIXEL FIGHT의 세계관을 이어, 버그(글리치)가 픽셀 세계를
            먹어 가는 이야기로 만든 랜덤 디펜스입니다. 여러 랜덤 디펜스의 장점을
            골라 섞었습니다. 단순한 소환 · 합성, 조합식, 보스마다 고르는 강화,
            칸 쌓기 UX를 가져왔습니다.
          </p>
          <p>
            핵심은 <b className="text-white">결정론 시뮬 하나</b>입니다. 같은
            시드와 같은 명령 기록이면 브라우저 · 서버 · 밸런스 봇 어디서 돌려도
            결과가 같아서, 랭킹 검증 · 멀티 동기화 · 밸런스 실험이 모두 이 엔진
            위에서 돌아갑니다.
          </p>
        </div>
      </Section>

      <Section num="02" title="기술 스택">
        <StackTable rows={STACK} />
      </Section>

      <Section num="03" title="랭킹 한 판의 흐름">
        <div className="rounded-xl border border-white/10 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
            <FlowBox title="서버" sub="시드 · 로드아웃 발급" />
            <Arrow />
            <FlowBox
              title="브라우저"
              sub="같은 시뮬로 플레이 · 명령만 기록"
              accent
            />
            <Arrow />
            <FlowBox
              title="서버 작업 스레드"
              sub="처음부터 다시 돌려 점수 · 보상"
            />
          </div>
        </div>
        <div className="mt-4">
          <Bullets
            items={[
              "멀티는 서버가 100ms마다 명령 묶음을 뿌리고, 각자 같은 시뮬을 돌리는 락스텝",
              "5초마다 상태 해시를 비교해 어긋나면 바로 알림",
            ]}
          />
        </div>
      </Section>

      <Section num="04" title="화면">
        <div className="grid gap-4 sm:grid-cols-2">
          <Shot img={playImg} alt="28웨이브 — 세 세력이 섞인 필드" />
          <Shot img={bossImg} alt="10웨이브 보스 「글리치 릴리」 등장" />
          <Shot img={waveImg} alt="몰려오는 글리치 몬스터" />
          <Shot img={codexImg} alt="도감 — 세력 · 등급 · 스킬" />
        </div>
        <div className="mt-4">
          <Shot img={hubImg} alt="정비소 — 오염 단계 · 연구 · 유물 장착" />
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
