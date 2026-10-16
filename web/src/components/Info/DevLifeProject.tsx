import Link from "next/link";
import type { StaticImageData } from "next/image";
import {
  Arrow,
  Bullets,
  FlowBox,
  LinkPill,
  Section,
  Shot,
  StackTable,
  StatGrid,
  TroubleList,
  type Trouble,
} from "./ProjectDetailUI";

import homeImg from "@/img/Page/info/devlife/home.webp";
import projectImg from "@/img/Page/info/devlife/project.webp";
import infoPageImg from "@/img/Page/info/devlife/infopage.webp";
import archiveImg from "@/img/Page/info/devlife/archive.webp";
import melonImg from "@/img/Page/info/devlife/melon.webp";
import mineImg from "@/img/Page/info/devlife/mine.webp";
import chessImg from "@/img/Page/info/devlife/chess.webp";
import ladderImg from "@/img/Page/info/devlife/ladder.webp";
import rouletteImg from "@/img/Page/info/devlife/roulette.webp";
import mobileImg from "@/img/Page/info/devlife/mobile.webp";
import rhythmImg from "@/img/Page/info/devlife/rhythm.webp";
import calorieImg from "@/img/Page/info/devlife/calorie.webp";
import devtoolsImg from "@/img/Page/info/devlife/devtools.webp";

// ───────────────────────── 데이터 ─────────────────────────

const STATS = [
  { value: "2021", label: "운영 시작" },
  { value: "17", label: "게임 · 도구" },
  { value: "280+", label: "TS 파일 (web + server)" },
  { value: "90+", label: "서버 테스트" },
];

const STACK: { group: string; items: string[] }[] = [
  {
    group: "Frontend",
    items: ["Next.js 16 (App Router · 서버 렌더링)", "React 19", "TypeScript", "Tailwind CSS 4"],
  },
  { group: "Backend", items: ["Node.js 24", "Express 5", "socket.io", "zod"] },
  {
    group: "Data / Auth",
    items: ["MongoDB", "Firebase Authentication (Google · 익명)", "jose (ID 토큰 검증)"],
  },
  {
    group: "Infra / CI",
    items: ["AWS Lightsail", "Docker Compose", "Caddy (HTTPS)", "GitHub Actions", "GHCR"],
  },
  {
    group: "Library",
    items: ["Web Audio API", "Canvas API", "WebRTC", "chess.js", "Stockfish (WASM)", "sql-formatter", "React Quill"],
  },
  { group: "Tooling", items: ["Vitest", "ESLint", "Prettier"] },
];

interface Feature {
  title: string;
  items: string[];
  images?: { img: StaticImageData; alt: string }[];
}

const FEATURES: Feature[] = [
  {
    title: "메인 · 포트폴리오",
    items: [
      "메인: 메뉴(study · games · tools · devtools)에 있는 것들을 한 화면에 펼쳐 보여 주고, 최근 글을 서버에서 바로 그림",
      "포트폴리오: team · personal · games, 이름을 고르면 옆에 미리보기. 프로젝트마다 상세 페이지(/infoPage/[idx])",
      "사이트 검색(Ctrl+K): 메뉴 이름 일부 · 초성 · 설명으로 바로 이동",
    ],
    images: [
      { img: projectImg, alt: "포트폴리오" },
      { img: infoPageImg, alt: "프로젝트 상세" },
    ],
  },
  {
    title: "게임 9종",
    items: [
      "PIXEL Rhythm Up(4키 리듬게임) · PIXEL FIGHT(1:1 격투) — 포트폴리오 games에서 따로 소개",
      "온라인 체스 · 장기 · 오목: 방을 만들어 실시간 대국 · 관전 · 채팅, AI 랭킹전",
      "DOODLE PARTY: 최대 8명 그림 파티게임 — 그림 맞히기 · 가짜 화가 · 그림 속 거짓말 · 그림 릴레이",
      "멜론 게임(Canvas 드래그 퍼즐, 2분 타임어택) · 지뢰찾기(지뢰 99개) · 반응속도 테스트",
      "휴대폰: 터치 조작, 멜론 게임은 화면 폭에 맞춰 배율 고정",
    ],
    images: [
      { img: melonImg, alt: "멜론 게임" },
      { img: mineImg, alt: "지뢰찾기" },
      { img: rhythmImg, alt: "PIXEL Rhythm Up" },
    ],
  },
  {
    title: "온라인 대국 (체스 · 장기 · 오목)",
    items: [
      "수는 서버가 검증해서 저장 — 브라우저를 고쳐도 반칙 수를 둘 수 없음. 장기 · 오목 규칙 엔진은 직접 구현해 프론트와 서버가 같은 파일을 씀",
      "방 생성 · 참여 · 관전, 제한 시간 · 추가 시간 · 선후공, 무르기 · 무승부 제안 · 기권, 비밀번호 방, 다시 하기",
      "socket.io 연결 하나로 요청(rpc)과 구독(sub)을 처리, 끊겼다 붙으면 보고 있던 것을 자동으로 다시 구독",
      "로그인(익명 포함) uid로 자리를 기억해 새로고침 · 서버 재시작 뒤에도 같은 자리에서 이어 둠",
      "AI 상대: 체스는 Stockfish(WASM), 장기 · 오목은 직접 만든 탐색. 이기면 점수로 랭킹 등록",
    ],
    images: [{ img: chessImg, alt: "온라인 체스" }],
  },
  {
    title: "회원 · 랭킹",
    items: [
      "Google 로그인 + 별명(중복 불가 · 변경 가능). 로그인 없이도 모든 게임을 할 수 있고, 비회원 이름은 따로 표시",
      "회원은 랭킹 · 방명록 · 온라인 게임에 별명이 자동으로 들어가고, 기록은 결과 화면에서 자동 등록",
      "게임하던 익명 계정을 그대로 Google 계정으로 올려, 가입 전에 남긴 기록과 앉아 있던 자리가 이어짐",
      "내 정보: 게임별 최고 기록과 순위, 온라인 전적, 방문 횟수",
      "랭킹 조작 방지: 게임 시작 때 받은 1회용 티켓 + 그 기록이 나오려면 걸리는 시간 확인 + 점수 재계산, 한 사람당 최고 기록 하나",
    ],
  },
  {
    title: "도구 (tools · devtools)",
    items: [
      "사다리타기: 결과 칸 위치를 매번 섞어 누구든 확률 1/n, 룰렛: 결과를 먼저 뽑고 그 칸에 멈추도록 회전량 계산",
      "칼로리 계산기: 식약처 식품영양성분 DB 2만여 개 검색 · 식단 합계, 대표 음식 535개는 개별 페이지",
      "JSON Formatter, 정규식 테스터, MyBatis 로그 → SQL, DDL → Java DTO · resultMap · Mapper, JSON → Java DTO",
      "입력은 브라우저 밖으로 나가지 않음. 난수는 crypto.getRandomValues로 편향 없이",
    ],
    images: [
      { img: ladderImg, alt: "사다리타기" },
      { img: rouletteImg, alt: "룰렛" },
      { img: calorieImg, alt: "칼로리 계산기" },
      { img: devtoolsImg, alt: "MyBatis 로그 → SQL 변환기" },
    ],
  },
  {
    title: "개인 공부 · 회고 · 아카이브",
    items: [
      "관리자 계정으로 로그인하면 React Quill 에디터로 글 작성 · 수정 · 삭제",
      "글 목록과 글 페이지는 요청 때 서버에서 그려 검색엔진에 그대로 노출 (BlogPosting 구조화 데이터)",
      "서버가 글 목록을 60초 캐시하고, 글이 바뀌면 백엔드가 Next 서버에 알려 바로 비움",
      "아카이브: 사이트 변경 이력 · 프로젝트 · 실무를 타임라인으로 기록",
    ],
    images: [{ img: archiveImg, alt: "아카이브" }],
  },
  {
    title: "관리자 · 방명록 · 공통 UI",
    items: [
      "관리자 대시보드: 문의함(읽음 관리 · 메일 답장), 글 관리, 방명록 · 대국 방 정리",
      "방명록: 포스트잇 보드, 새 글이 실시간으로 올라옴",
      "푸터 방문자 수 · 달력 · 시계, 플로팅 퀵메뉴, 문의하기, 공통 모달(ESC · 뒤로가기로 닫기)",
      "페이지마다 제목 · 설명으로 그려 주는 공유 미리보기 이미지(/og/…)",
    ],
  },
];

const RENEWAL: { title: string; items: string[] }[] = [
  {
    title: "2026.09 — CRA → Next.js · TypeScript",
    items: [
      "React 17 · Create React App 구조를 Next.js App Router로 재구성",
      "전체 소스를 .ts/.tsx로 전환, 데이터 계층에 타입 정의",
      "페이지별 title · description · canonical, sitemap, JSON-LD",
      "스타일을 Tailwind CSS 중심으로 이전, ESLint · Prettier 도입",
    ],
  },
  {
    title: "2026.10 — 백엔드 분리",
    items: [
      "브라우저가 Firestore에 직접 읽고 쓰던 것을 Express API + MongoDB로",
      "화면 코드는 그대로 두고 데이터 함수의 이름 · 인자를 유지한 채 안쪽만 교체",
      "실시간(대국 · 채팅 · 방명록)은 socket.io 게이트웨이 하나로",
      "Firebase는 로그인(Auth)만 남기고, 서버가 ID 토큰을 공개키로 검증",
    ],
  },
  {
    title: "2026.10 — 정적 사이트 → 서버 운영",
    items: [
      "정적 export + GitHub Pages에서 Next 서버 모드 + AWS Lightsail로 이전 (gunmo.my)",
      "Docker Compose: MongoDB · API 서버 · Next 서버 · Caddy(HTTPS 자동)",
      "예전 주소는 페이지마다 새 주소로 넘기는 안내 페이지를 남김",
      "매일 DB 백업, 메모리 부족 대비 스왑",
    ],
  },
  {
    title: "빌드 · 배포 자동화",
    items: [
      "GitHub Actions: 서버 타입 검사 · 테스트(MongoDB 서비스), 프론트 린트 · 타입 검사 · 빌드",
      "main에 올리면 서버 · 프론트 이미지를 만들어 GHCR에 올림",
      "이어서 SSH로 서버에 접속해 새 이미지로 교체",
    ],
  },
];

const TROUBLES: Trouble[] = [
  {
    title: "랭킹 점수를 요청만 꾸며서 넣을 수 있음",
    problem: "점수는 브라우저에서 계산되므로, 게임을 하지 않고 등록 요청만 보내도 랭킹에 올라감",
    cause: "서버는 형식과 범위만 검사하고, 실제로 게임을 했는지는 알 방법이 없었음",
    solution:
      "게임을 시작할 때 1회용 티켓을 발급하고, 등록할 때 티켓을 받은 뒤 그 기록이 나올 만큼 시간이 지났는지 확인. AI 대국 점수는 같은 공식으로 다시 계산하고, 리듬게임은 채보의 노트 수와 대조",
  },
  {
    title: "익명으로 놀다가 로그인하면 기록이 끊김",
    problem: "게임은 익명 로그인으로 하는데, Google로 로그인하면 다른 계정이 돼서 앉아 있던 대국 자리와 남긴 기록을 잃음",
    cause: "익명 계정과 Google 계정의 uid가 서로 다름",
    solution:
      "익명 계정에 Google 계정을 연결(link)해 uid를 그대로 유지. 이미 가입한 Google 계정이면 그 계정으로 로그인하고, 소켓은 같은 연결에서 다시 인증",
  },
  {
    title: "글을 고쳐도 한동안 예전 내용이 보임",
    problem: "서버 렌더링 캐시 때문에 글을 쓰거나 고친 직후에는 목록 · 사이트맵에 반영되지 않음",
    cause: "Next 서버가 글 목록을 60초 동안 다시 쓰도록 캐시",
    solution:
      "글이 바뀌면 백엔드가 Next 서버의 내부 주소로 알려 캐시를 바로 비움. 이 주소는 프록시에서 바깥 접근을 막고 비밀값으로 확인",
  },
  {
    title: "칼로리 계산기 빌드 결과물이 581MB",
    problem: "음식 3,600개를 개별 페이지로 만들었더니 배포 용량이 감당할 수 없이 커짐",
    cause: "정적 export는 페이지마다 공통 레이아웃 데이터(약 150KB)를 HTML에 함께 담음",
    solution:
      "여러 조사에 공통으로 나오는 대표 음식 · 분류별 대표 원재료만 골라 535개로 줄이고, 나머지는 검색으로 제공 → 115MB",
  },
  {
    title: "개발 모드에서 저장한 설정이 기본값으로 초기화",
    problem: "새로고침하면 리듬게임 싱크 등 localStorage에 저장한 값이 기본값으로 돌아감",
    cause:
      "StrictMode에서 effect가 두 번 실행되면서, 복원 effect가 반영되기 전에 저장 effect가 기본값을 먼저 덮어씀",
    solution: "복원이 끝났다는 hydrated 상태를 두고 그 이후에만 저장하도록 8개 컴포넌트 수정",
  },
  {
    title: "모바일에서 지뢰찾기 첫 탭에 페이지가 죽음",
    problem: "세로 화면에서 칸을 누르는 순간 'This page couldn't load'가 뜸",
    cause:
      "첫 렌더는 가로(20x24) 기준으로 상태 배열을 만들고, 마운트 후 세로(24x20) 크기로 지뢰를 깔아 존재하지 않는 행을 읽음",
    solution:
      "판 크기를 상태로 관리하고 게임 시작 전에만 화면 방향에 맞춰 빈 판과 함께 다시 만들도록 변경",
  },
  {
    title: "모바일에서 멜론 게임이 거의 원본 크기로 보임",
    problem: "화면 폭에 맞춰 축소하도록 했는데 폰에서는 게임판이 화면 밖으로 넘침",
    cause:
      "1030px 캔버스가 먼저 그려지면서 모바일 브라우저가 레이아웃 폭을 넓혀버려, window.innerWidth가 실제 화면보다 큰 값으로 나옴",
    solution:
      "overflow:hidden 컨테이너의 폭으로 최초 1회 배율을 정해 transform으로 축소하고, 좌표는 캔버스 표시 크기 기준으로 환산해 포인터(터치) 이벤트로 처리",
  },
  {
    title: "룰렛을 두 번째 돌리면 회전이 순식간에 끝남",
    problem: "두 번째 판부터 회전이 확 빨라지고 최근 결과가 한 번에 여러 개 쌓임",
    cause:
      "당첨 강조를 풀 때 각 칸의 opacity 전환이 끝나며 발생한 transitionend가 휠까지 버블링돼 '회전 끝'으로 처리됨",
    solution: "이벤트 대상이 휠 자신이고 속성이 transform일 때만 회전 종료로 처리",
  },
  {
    title: "모달을 닫은 직후 페이지 이동이 되돌려짐",
    problem:
      "모바일 뒤로가기로 닫히도록 쌓아둔 히스토리를 정리하는 과정에서 직후의 router.push가 취소됨",
    cause: "모달 cleanup의 history.back()이 호출부의 이동보다 늦게 처리됨",
    solution: "히스토리 정리(popstate)가 끝난 뒤에 모달 Promise를 resolve하도록 순서를 보장",
  },
  {
    title: "게임 랭킹의 저장형 XSS",
    problem: "랭킹 이름에 HTML을 넣으면 방문자 브라우저에서 그대로 실행될 수 있음",
    cause: "저장된 사용자 입력을 innerHTML로 삽입",
    solution: "DOM 노드를 생성해 textContent로 삽입하도록 변경",
  },
];

const HISTORY = [
  { date: "2021.07", text: "Create React App으로 개발 시작, GitHub Pages 배포" },
  { date: "2021.08", text: "멜론 게임 제작" },
  { date: "2024.12", text: "프로젝트 상세·소개·방명록·아카이브 페이지 구성" },
  { date: "2025.01", text: "사이트 전면 리디자인, 퀵메뉴·Contact 모달 추가" },
  { date: "2025.05", text: "개인공부 게시판, 지뢰찾기 추가" },
  {
    date: "2026.09",
    text: "Next.js · TypeScript 전면 리뉴얼, SEO·배포 자동화, 온라인 체스·도구·관리자 대시보드, 리듬게임 첫 공개",
  },
  {
    date: "2026.10",
    text: "장기 · 오목 · 스케치 퀴즈 · PIXEL FIGHT 추가, 리듬게임을 BEAT DASH로 개편, 칼로리 계산기 · devtools 변환기",
  },
  {
    date: "2026.10",
    text: "백엔드(Express · socket.io · MongoDB) 분리, AWS 서버로 이전하고 주소를 gunmo.my로, 랭킹 조작 방지 · 회원제 · 메인 개편",
  },
];

// ───────────────────────── 페이지 ─────────────────────────

export default function DevLifeProject() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* 헤더 */}
      <div className="mb-3 font-mono text-sm text-[#8B84FF]">personal project</div>
      <h1 className="font-mono text-3xl font-bold text-white sm:text-4xl">Gunmo&apos;s Dev Life</h1>
      <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-white/60">
        2021년부터 운영 중인 이 사이트(gunmo.my). 포트폴리오이자, 새로 익힌 기술을 직접 적용해
        보는 개발 실험장
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-xs">
        <span className="rounded-full border border-white/10 px-3 py-1 text-white/50">
          2021.07 – 운영 중
        </span>
        <LinkPill href="https://gunmo.my/">사이트 ↗</LinkPill>
      </div>

      <div className="mt-8">
        <Shot img={homeImg} alt="메인 화면" />
      </div>

      <StatGrid stats={STATS} />

      <Section num="01" title="개요">
        <div className="flex flex-col gap-3 font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/70">
          <p>
            Create React App으로 시작한 개인 사이트로, 프로젝트 소개 외에 공부 기록, 방명록, 게임과
            도구를 함께 운영하며 새로 배운 기술을 실제 서비스 형태로 적용해 왔습니다.
          </p>
          <p>
            2026년 9월에 오래된 React 17 · CRA 구조를{" "}
            <b className="text-white">Next.js App Router와 TypeScript</b>로 옮겼고, 10월에는 정적
            호스팅 + Firestore로 버티던 구조에서 벗어나{" "}
            <b className="text-white">Express · socket.io · MongoDB 백엔드</b>를 따로 두고 직접
            서버에 올려 운영하는 형태로 바꿨습니다. 온라인 대국의 수 검증, 랭킹 조작 방지, 회원제는 이
            구조 위에서 만들었습니다.
          </p>
        </div>
      </Section>

      <Section num="02" title="기술 스택">
        <StackTable rows={STACK} />
      </Section>

      <Section num="03" title="아키텍처">
        <div className="rounded-xl border border-white/10 p-4 sm:p-5">
          <div className="mb-3 font-mono text-[11px] text-white/40">빌드 · 배포</div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1.3fr_auto_1fr]">
            <FlowBox title="GitHub" sub="main에 push" />
            <Arrow />
            <FlowBox
              title="GitHub Actions"
              sub="테스트 · 빌드 → 서버 · 프론트 이미지를 GHCR에"
              accent
            />
            <Arrow />
            <FlowBox title="AWS Lightsail" sub="SSH로 접속해 새 이미지로 교체" />
          </div>

          <div className="mt-6 mb-3 font-mono text-[11px] text-white/40">런타임</div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[0.8fr_auto_0.8fr_auto_1.3fr_auto_0.8fr]">
            <FlowBox title="브라우저" sub="로그인은 Firebase Auth" />
            <Arrow />
            <FlowBox title="Caddy" sub="HTTPS · 경로별 분기" />
            <Arrow />
            <div className="grid grid-cols-2 gap-2">
              <FlowBox title="Next 서버" sub="페이지 서버 렌더링 · 공유 이미지" />
              <FlowBox title="API 서버" sub="REST(/api) + socket.io" accent />
            </div>
            <Arrow />
            <FlowBox title="MongoDB" sub="글 · 랭킹 · 대국 · 회원" />
          </div>
          <p className="mt-4 font-['Nanum_Gothic',sans-serif] text-xs leading-relaxed text-white/45">
            격투게임의 경기 입력만 브라우저끼리 WebRTC로 직접 주고받고, 연결이 안 되면 API 서버가
            중계합니다. DOODLE PARTY · 격투의 방 상태는 서버 메모리에, 대국은 MongoDB에 둡니다.
          </p>
        </div>
      </Section>

      <Section num="04" title="주요 기능">
        <div className="flex flex-col gap-10">
          {FEATURES.map((f) => (
            <div key={f.title}>
              <h3 className="mb-3 font-mono text-base font-medium text-white">{f.title}</h3>
              <Bullets items={f.items} />
              {f.images && (
                <div className={`mt-4 grid gap-3 ${f.images.length > 1 ? "sm:grid-cols-2" : ""}`}>
                  {f.images.map((im) => (
                    <Shot key={im.alt} img={im.img} alt={im.alt} />
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="mx-auto w-full max-w-[240px]">
            <Shot img={mobileImg} alt="모바일 화면" />
          </div>
        </div>
      </Section>

      <Section num="05" title="2026년에 바꾼 것">
        <div className="grid gap-3 sm:grid-cols-2">
          {RENEWAL.map((r) => (
            <div key={r.title} className="rounded-xl border border-white/10 bg-[#1C1E24] p-5">
              <h3 className="mb-3 font-mono text-sm font-medium text-white">{r.title}</h3>
              <Bullets items={r.items} />
            </div>
          ))}
        </div>
      </Section>

      <Section num="06" title="트러블슈팅">
        <TroubleList items={TROUBLES} />
      </Section>

      <Section num="07" title="연혁">
        <ol className="relative ml-1 border-l border-white/10">
          {HISTORY.map((h) => (
            <li key={h.date} className="relative pb-4 pl-6 last:pb-0">
              <span className="absolute top-[7px] left-[-4.5px] h-2 w-2 rounded-full bg-[#6C63FF]" />
              <span className="mr-3 font-mono text-xs text-white/40">{h.date}</span>
              <span className="font-['Nanum_Gothic',sans-serif] text-sm text-white/75">
                {h.text}
              </span>
            </li>
          ))}
        </ol>
        <Link
          href="/archive/"
          className="mt-6 inline-block font-mono text-xs text-[#8B84FF] transition-colors hover:text-white"
        >
          전체 개발 기록 보기 →
        </Link>
      </Section>
    </div>
  );
}
