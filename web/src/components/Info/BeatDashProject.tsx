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

import titleImg from "@/img/Page/info/beatdash/title.webp";
import selectImg from "@/img/Page/info/beatdash/select.webp";
import playImg from "@/img/Page/info/beatdash/play.webp";

// ───────────────────────── 데이터 ─────────────────────────

const STATS = [
  { value: "4키", label: "D F J K" },
  { value: "21곡", label: "내장곡 + 내 음악" },
  { value: "5단계", label: "난이도 (Lv 1–18)" },
  { value: "v1.1", label: "2026.10" },
];

const STACK: { group: string; items: string[] }[] = [
  { group: "화면", items: ["React 19", "TypeScript", "Canvas 2D", "Tailwind CSS"] },
  { group: "소리", items: ["Web Audio API", "OfflineAudioContext", "오디오 시계 + 화면용 보정 시계"] },
  { group: "분석", items: ["STFT 스펙트럴 플럭스", "자기상관 템포 추정", "동적 계획법 비트 추적"] },
  { group: "랭킹", items: ["Express API", "MongoDB", "1회용 티켓 · 채보 대조"] },
];

const FEATURES: { title: string; items: string[] }[] = [
  {
    title: "플레이",
    items: [
      "DFJK 4키, 롱노트, 판정 PERFECT · GREAT · GOOD, FAST/SLOW 표시, HP와 FAILED",
      "난이도 5단계(쉬움 – 나이트메어), 곡마다 레벨 1–18",
      "노트 속도 · 싱크 · 볼륨 · 레인 위치 · 노트 두께 · 스킨 · 타격음 설정, 플레이 중 ↑ ↓ 로 속도",
      "타이틀부터 결과까지 16:9 화면 하나에서, 창모드와 전체화면이 같은 모양",
      "휴대폰은 레인만 세로 화면 가득, 터치로 플레이",
    ],
  },
  {
    title: "내 음악으로 플레이",
    items: [
      "mp3를 넣으면 브라우저 안에서 분석해 난이도별 채보를 만듦 — 파일은 서버로 올라가지 않음",
      "미리 듣기, mp3 속 앨범 사진을 재킷으로",
      "빠른 곡(170 BPM 이상)은 나이트메어 레벨을 더 높게",
    ],
  },
  {
    title: "곡 · 랭킹",
    items: [
      "내장곡 21곡: AI로 만든 자작곡 18곡 + xi의 곡 3곡(ANiMA · FREEDOM DiVE · Aragami, 제작자 표기)",
      "연습곡 「패턴 연습」 — 계단 · 트릴 · 잭 · 동시치기 · 롱노트를 구간마다 반복",
      "곡 · 난이도별 TOP 10, 결과 화면에서 바로 등록. 로그인한 회원은 별명으로 자동 등록",
      "서버가 점수 · 콤보를 그 채보의 노트 수와 맞춰 보고, 곡 길이보다 빨리 올라온 기록은 거절",
    ],
  },
];

const TROUBLES: Trouble[] = [
  {
    title: "노트가 분신처럼 겹쳐 보임",
    problem: "노트가 많이 내려오면 한 노트가 여러 개로 겹쳐 보이는 잔상이 생김",
    cause:
      "노트 위치를 오디오 시계(currentTime)로 계산했는데, 이 값은 오디오 버퍼 단위로 끊겨 올라감 (16.7ms 프레임마다 8.7ms · 20.3ms씩 들쭉날쭉)",
    solution:
      "화면용 시계를 performance.now()로 매끄럽게 흘리고 오디오 시계와의 차이만 천천히 따라가게 분리. 판정은 그대로 오디오 시계 기준",
  },
  {
    title: "블루투스 이어폰에서는 판정이 전부 늦음",
    problem: "소리가 늦게 나오는 기기에서는 박자에 맞게 쳐도 SLOW만 뜸",
    cause: "출력 지연은 기기마다 다르고, 브라우저가 알려 주는 값도 정확하지 않음",
    solution:
      "치는 동안 '입력 − 가장 가까운 노트' 차이의 중앙값을 재서 싱크를 알아서 옮김. 처음엔 6탭마다 크게, 맞은 뒤엔 24탭마다 조금씩 → 150ms 지연도 2~3마디면 따라잡음",
  },
  {
    title: "빠른 곡의 템포를 절반으로 잡음",
    problem: "170~280 BPM 곡이 절반 템포로 잡혀 채보가 박자와 어긋남",
    cause: "자기상관만으로는 배수 템포를 구분하지 못하고, 센 엇박에 비트 추적이 끌려감",
    solution:
      "osu 랭크 채보 106곡을 같은 곡 · 같은 레벨끼리 대조하면서 규칙을 조정 — 절반 템포로 잡던 곡이 56곡 → 16곡, 노트 수는 osu의 93~104% 수준으로",
  },
  {
    title: "곡 하나 렌더링에 100초 넘게 걸림",
    problem: "곡을 코드로 합성하던 초기, 곡 전체를 OfflineAudioContext 하나로 구우면 시작 버튼 뒤 한참 기다려야 했음",
    cause: "만든 노드는 렌더링이 끝날 때까지 계속 처리 비용이 들어 (노드 수 × 곡 길이)로 느려짐",
    solution: "4마디씩 잘라 여운만 붙여 따로 굽고 합치도록 변경, 필터는 악기별로 공유 → 2~5초",
  },
  {
    title: "노트가 많을 때 프레임이 떨어짐",
    problem: "나이트메어 구간에서 화면이 버벅여 판정까지 흔들림",
    cause: "노트마다 매 프레임 그라데이션 · 그림자를 새로 계산",
    solution:
      "노트 머리를 스킨 · 색별로 한 번 그려 두고 찍기만 함. 그래도 떨어지면 박자 빛 → 불꽃 · 그림자 → 해상도 순으로 한 단계씩 내리고, 가벼워지면 되돌림",
  },
];

// ───────────────────────── 페이지 ─────────────────────────

export default function BeatDashProject() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 font-mono text-sm text-[#8B84FF]">game · gunmo.my</div>
      <h1 className="font-mono text-3xl font-bold text-white sm:text-4xl">PIXEL Rhythm Up</h1>
      <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-white/60">
        브라우저에서 하는 4키 리듬게임. 내 mp3를 넣으면 채보를 직접 만들어 줍니다.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-xs">
        <span className="rounded-full border border-white/10 px-3 py-1 text-white/50">
          2026.09 – 업데이트 중
        </span>
        <Link
          href="/games/rhythm/"
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
            2026년 9월 말에 처음 공개한 DFJK 4키 리듬게임입니다. 그 뒤로{" "}
            <b className="text-white">판정이 음악과 어긋나지 않게 하는 것</b>과{" "}
            <b className="text-white">어떤 곡을 넣어도 칠 만한 채보가 나오게 하는 것</b>, 이 두
            가지를 중심으로 계속 고치고 있습니다.
          </p>
          <p>
            음원 분석 · 채보 생성 · 판정은 모두 브라우저 안에서 돌고, 서버는 랭킹만 맡습니다.
          </p>
        </div>
      </Section>

      <Section num="02" title="기술 스택">
        <StackTable rows={STACK} />
      </Section>

      <Section num="03" title="자동 채보가 만들어지는 과정">
        <div className="rounded-xl border border-white/10 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
            <FlowBox title="음원" sub="22.05kHz 모노로" />
            <Arrow />
            <FlowBox title="타격 찾기" sub="저 · 중 · 고 대역별 스펙트럴 플럭스" />
            <Arrow />
            <FlowBox title="템포 · 비트" sub="자기상관 + 동적 계획법" accent />
            <Arrow />
            <FlowBox title="노트 배치" sub="32분 격자에 맞춰 난이도별로" />
          </div>
        </div>
        <div className="mt-4">
          <Bullets
            items={[
              "타격 시각은 1.5ms 해상도의 에너지 곡선에서 실제 어택 지점으로 다시 맞춤",
              "난이도마다 밀도 · 최소 간격 · 동시치기 · 롱노트 · 잭 비율이 다르고, 목표 레벨에 맞을 때까지 다시 뽑음",
              "계단 · 트릴 · 연타 같은 손 모양 48가지를 섞고, 같은 모양은 최대 2마디까지만",
              "타격 세기에 그 순간의 음량을 섞어, 곡이 터지는 구간에 노트가 몰리게",
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
            <Shot img={selectImg} alt="곡 선택" />
            <Shot img={playImg} alt="플레이 화면" />
          </div>
        </div>
      </Section>

      <Section num="05" title="트러블슈팅">
        <TroubleList items={TROUBLES} />
      </Section>
    </div>
  );
}
