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
import { WORD_COUNT } from "@/lib/sketch/words";

import titleImg from "@/img/Page/info/sketch/title.webp";
import lobbyImg from "@/img/Page/info/sketch/lobby.webp";
import createImg from "@/img/Page/info/sketch/create.webp";
import drawImg from "@/img/Page/info/sketch/draw.webp";
import revealImg from "@/img/Page/info/sketch/reveal.webp";
import mobileImg from "@/img/Page/info/sketch/mobile.webp";
import fakeImg from "@/img/Page/info/sketch/fake.webp";
import lieImg from "@/img/Page/info/sketch/lie.webp";
import relayImg from "@/img/Page/info/sketch/relay.webp";

// ───────────────────────── 데이터 ─────────────────────────

const STATS = [
  { value: "4가지", label: "모드 (맞히기 · 가짜 화가 · 거짓말 · 릴레이)" },
  { value: "8명", label: "한 방 최대 인원" },
  { value: `${WORD_COUNT.toLocaleString()}개`, label: "제시어 (쉬움 · 보통 · 어려움)" },
  { value: "PC · 폰", label: "가로 · 세로 전용 배치" },
];

const STACK: { group: string; items: string[] }[] = [
  {
    group: "화면",
    items: [
      "React 19",
      "TypeScript",
      "Tailwind CSS",
      "1280×720 무대를 통째로 확대·축소(PC) + 세로 전용 배치(폰)",
    ],
  },
  {
    group: "그리기",
    items: [
      "Canvas 2D — 2배 해상도, 중점 2차 베지어로 획 보간",
      "페인트통 채우기(허용 오차 플러드 필)",
      "50ms 묶음 전송 + 받는 쪽은 프레임마다 풀어서 그림",
    ],
  },
  {
    group: "서버",
    items: [
      "Express",
      "socket.io 게이트웨이(구독 · RPC)",
      "방 상태는 서버 메모리, 빈 방은 자동 정리",
    ],
  },
  {
    group: "소리",
    items: [
      "Web Audio — 파일이 없으면 합성음으로 대신",
      "배경음악은 곡 끝 2.5초 전에 겹쳐 틀어 끊김 없이 반복",
    ],
  },
];

const FEATURES: { title: string; items: string[] }[] = [
  {
    title: "게임",
    items: [
      "한 명이 3개(쉬움 · 보통 ×1.2 · 어려움 ×1.5) 중 하나를 골라 그리고, 나머지가 채팅으로 맞히기",
      "빨리 맞힐수록 20~100점, 첫 정답 +30, 그린 사람은 맞힌 사람 점수의 절반",
      "시간이 지나면 힌트(글자 수 → 첫 글자 → 초성), 이 방에서 나온 답 · 이 브라우저에서 최근 본 답은 덜 나옴",
      "게임 중에 들어와도 바로 참여, 그릴 차례도 자기 몫만큼 돌아옴",
    ],
  },
  {
    title: "모드",
    items: [
      "🕵️ 가짜 화가 — 한 명만 제시어 대신 주제를 받고, 모두 한 도화지에 내 색으로 한 획씩 두 바퀴. 투표로 가짜를 찾고, 들킨 가짜는 제시어를 맞히면 역전",
      "🤥 그림 속 거짓말 — 각자 엉뚱한 제시어(꾸밈말 + 대상 조합)를 동시에 그리고, 남의 그림에 가짜 제목. 진짜를 고르면 점수, 내 거짓말에 속여도 점수",
      "📞 그림 릴레이 — 문장 → 그림 → 문장으로 옆 사람에게 넘기고, 끝나면 앨범을 같이 넘겨 봄",
      "그림 맞히기엔 깜짝 챌린지(한붓그리기 · 눈 가리고 · 검정 한 색, ×1.5) · 따봉 · 건너뛰기 투표 · 정답 아는 사람끼리 비밀 채팅 · 주제 고르기 · 우리끼리 제시어",
    ],
  },
  {
    title: "편하게",
    items: [
      "빠른 시작 — 자리 있는 방에 바로, 없으면 기본 설정으로 새 방",
      "아무 글자나 누르면 정답 칸으로, 그리는 사람은 B · F · E · Ctrl+Z · [ ] 단축키, 제시어는 1 · 2 · 3",
      "초대 링크 하나로 비밀번호 방도 바로 입장(PC는 복사, 폰은 공유 창)",
      "전체화면 · 소리 설정(배경음악 · 효과음 따로), 폰은 세로 화면에 맞춘 배치",
    ],
  },
  {
    title: "연출",
    items: [
      "스케치북 · 크레용 테마 — 손으로 그린 테두리, 낙서가 그려지는 배경, 연필 마스코트",
      "내 차례 · 시작 · 정답 도장, 정답 · 우승 색종이, 남은 10초 째깍 소리, 최종 순위 시상대",
      "따봉을 누르면 엄지가 도화지 위로 떠오르고, 판이 끝나면 따봉 1등 그림을 알림",
      "업적 · 오늘의 미션으로 사이트 공용 GP 지급 (로비 위 📅 버튼에서 모두 받기)",
    ],
  },
];

const TROUBLES: Trouble[] = [
  {
    title: "서버에 타이머 없이 여러 단계 모드 돌리기",
    problem:
      "가짜 화가 · 거짓말 · 릴레이는 다 같이 동시에 내고 시간이 지나면 넘어가는 단계가 많다. 서버에 setTimeout 을 두면 배포로 서버가 다시 켜질 때 이어받기가 깨진다.",
    cause:
      "기존 그림 맞히기는 그리는 사람 · 방장 화면이 진행을 요청하는 구조라 서버가 시간을 모른다.",
    solution:
      "단계마다 번호(step)와 끝나는 시각만 상태에 두고, 다 냈으면 서버가 바로 넘기고, 시간이 지나면 방장 화면이 sketch.tick(step) 으로 알려 주면 서버가 시각을 확인해 넘겼다. 같은 단계 번호의 요청은 한 번만 반영되고, 상태 전체가 직렬화 가능한 값이라 배포 이어받기에 그대로 저장된다.",
  },
  {
    title: "나만 알아야 하는 것",
    problem:
      "가짜 화가의 제시어, 거짓말의 진짜 제목, 릴레이에서 이어받은 문장 · 그림은 사람마다 보이는 게 다르다.",
    cause: "방 상태 구독은 모두에게 같은 값을 보낸다.",
    solution:
      "사람마다 키가 다른 sketch.secret 채널을 두고 서버가 그 사람 몫만 계산해 보냈다. 그림 한 장(sketch.sheet)은 구독할 때 볼 수 있는 단계인지 서버가 확인하고, 거짓말 보기는 순서까지 섞어 id 로 진짜를 알 수 없게 했다.",
  },
  {
    title: "정답이 채팅에 새지 않게",
    problem:
      "정답 판정을 서버가 하려면 서버가 제시어를 알아야 하고, 채팅으로 그대로 흘리면 답이 보인다.",
    cause: "정답 시도와 일반 채팅이 같은 통로였기 때문.",
    solution:
      "그리는 동안 친 말은 '정답 시도' 통로로만 보내고 그리는 사람만 구독하게 했다. 그리는 사람이 판정해서 틀린 답만 채팅에 대신 올리고, 맞힌 답은 '○○님이 맞혔어요'로만 알린다. 제시어도 그리는 사람 전용 구독으로 분리.",
  },
  {
    title: "50ms마다 오는 획이 뚝뚝 끊겨 보이던 것",
    problem: "보는 사람 화면에서 선이 50ms 덩어리로 툭툭 그려지고 끝부분이 각졌다.",
    cause: "받은 점을 한꺼번에 직선으로 이었기 때문.",
    solution:
      "점 사이를 중점 기준 2차 베지어로 잇고, 받은 점은 대기열에 넣어 프레임마다 조금씩 풀어 그렸다. 아직 곡선이 확정되지 않은 마지막 구간은 위 레이어에만 그려 본 도화지에 삐죽한 꼬리가 남지 않게 했다.",
  },
  {
    title: "PC와 폰에서 같은 게임 화면",
    problem: "반응형으로 줄이면 PC에선 도화지가 작고, 폰에선 채팅 · 도구가 넘쳤다.",
    cause: "한 배치를 화면 크기마다 접고 펴려 했기 때문.",
    solution:
      "PC는 1280×720 기준으로 한 번만 그리고 무대 크기에 맞게 통째로 확대 · 축소, 폰은 세로 전용 배치(도화지 → 도구 → 참가자 줄 → 채팅)를 따로 두었다. 붓 커서 · 입력 좌표는 화면 크기 비율로 계산해 확대된 상태에서도 정확하다.",
  },
  {
    title: "나간 방이 로비에 남던 것",
    problem: "빠른 시작으로 방을 만들고 바로 나가면 0명짜리 방이 로비에 한참 남았다.",
    cause: "새로고침 · 재접속을 위해 빈 방을 30분 동안 지우지 않았기 때문.",
    solution:
      "마지막 사람이 직접 나가면 5초 뒤 정리, 접속이 끊긴 빈 방은 3분 뒤 정리로 나누고, 로비에는 사람이 있는 방만 보이게 했다.",
  },
];

// ───────────────────────── 페이지 ─────────────────────────

export default function SketchQuizProject() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 font-mono text-sm text-[#8B84FF]">game · gunmo.my</div>
      <h1 className="font-mono text-3xl font-bold text-white sm:text-4xl">DOODLE PARTY</h1>
      <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-white/60">
        최대 8명이 함께하는 실시간 그림 파티게임. 그림 맞히기 · 가짜 화가 · 그림 속 거짓말 · 그림
        릴레이 4가지 모드를 브라우저에서 바로 즐겨요. (예전 이름 스케치 퀴즈)
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-xs">
        <span className="rounded-full border border-white/10 px-3 py-1 text-white/50">
          2026.10 –
        </span>
        <Link
          href="/games/sketch/"
          className="rounded-full bg-[#6C63FF] px-4 py-1 text-white transition-colors hover:bg-[#5b52f0]"
        >
          플레이
        </Link>
      </div>

      <div className="mt-8">
        <Shot img={titleImg} alt="타이틀 화면 — 스케치북 · 크레용 테마" />
      </div>

      <StatGrid stats={STATS} />

      <Section num="01" title="개요">
        <div className="flex flex-col gap-3 font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/70">
          <p>
            처음엔 Firebase Realtime Database로 만든 그림 퀴즈였는데, 백엔드를 붙이면서
            서버(socket.io)로 옮기고 화면을 통째로 <b className="text-white">전용 게임 화면</b>으로
            다시 만들었습니다. 방 상태와 권한 검사는 서버가 맡고, 진행(제시어 고르기 · 정답 판정 ·
            힌트 · 시간 종료)은 그리는 사람과 방장이 나눠서 요청합니다. 서버는 차례 id와 단계를
            확인해 여러 명이 동시에 보내도 한 번만 반영합니다.
          </p>
        </div>
      </Section>

      <Section num="02" title="기술 스택">
        <StackTable rows={STACK} />
      </Section>

      <Section num="03" title="한 차례의 흐름">
        <div className="rounded-xl border border-white/10 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
            <FlowBox title="그리는 사람" sub="제시어 고르기 · 획 전송 · 정답 판정 · 힌트" />
            <Arrow />
            <FlowBox title="서버" sub="차례 · 단계 확인 → 방 상태 · 점수 갱신" accent />
            <Arrow />
            <div className="flex flex-col gap-2">
              <FlowBox title="모두가 구독" sub="방 상태 · 획 · 채팅" />
              <FlowBox title="그리는 사람만" sub="제시어 · 정답 시도" />
            </div>
          </div>
        </div>
        <div className="mt-4">
          <Bullets
            items={[
              "그리는 사람이 나가거나 응답이 없으면 방장이 차례를 넘김 — 방장이 나가면 먼저 들어온 사람이 이어받음",
              "끊겼다 다시 연결되면 원래 입장 순서 그대로 자리 복구",
            ]}
          />
        </div>
      </Section>

      <Section num="04" title="화면">
        <div className="grid gap-4 sm:grid-cols-2">
          <Shot img={lobbyImg} alt="로비 — 빠른 시작 · 방 만들기 · 열린 방" />
          <Shot img={createImg} alt="방 만들기 — 게임 길이 직접 설정" />
          <Shot img={drawImg} alt="그리는 사람 화면 — 16색 · 굵기 · 채우기 · 지우개" />
          <Shot img={revealImg} alt="정답 공개" />
          <Shot img={fakeImg} alt="가짜 화가 — 한 획씩 그리고 투표" />
          <Shot img={lieImg} alt="그림 속 거짓말 — 진짜 제목 고르기" />
        </div>
        <div className="mt-4">
          <Shot img={relayImg} alt="그림 릴레이 앨범" />
        </div>
        <div className="mx-auto mt-4 max-w-[260px]">
          <Shot img={mobileImg} alt="폰 세로 화면" />
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
