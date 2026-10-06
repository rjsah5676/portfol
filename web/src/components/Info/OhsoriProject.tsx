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

import landingImg from "@/img/Page/info/ohsori/landing.webp";
import loginImg from "@/img/Page/info/ohsori/login.webp";
import homeImg from "@/img/Page/info/ohsori/home.webp";
import dmImg from "@/img/Page/info/ohsori/dm.webp";
import dmLightImg from "@/img/Page/info/ohsori/dm_light.webp";

// ───────────────────────── 데이터 ─────────────────────────

const STATS = [
  { value: "1인", label: "개인 프로젝트" },
  { value: "110+", label: "커밋" },
  { value: "P2P", label: "WebRTC 음성통화" },
  { value: "Docker", label: "Compose 배포" },
];

const STACK = [
  {
    group: "Frontend",
    items: ["Next.js 15", "React 19", "TypeScript", "Redux Toolkit", "Tailwind CSS"],
  },
  {
    group: "Backend",
    items: ["Node.js", "Express", "TypeScript", "Socket.IO", "JWT (httpOnly 쿠키)", "Multer"],
  },
  { group: "Data", items: ["MongoDB · Mongoose", "Redis (ioredis)"] },
  { group: "Realtime", items: ["WebRTC", "STUN · TURN", "Screen Capture API", "Web Audio API"] },
  { group: "Infra / Auth", items: ["Docker Compose", "Google · Kakao · Naver OAuth"] },
];

const FEATURES: { title: string; items: string[] }[] = [
  {
    title: "계정 · 친구",
    items: [
      "Google·Kakao·Naver 소셜 로그인과 일반 회원가입, JWT를 httpOnly 쿠키로 발급",
      "닉네임#태그 방식 친구 추가·수락·거절·삭제, 받은 요청 수 배지",
      "온라인·자리 비움·방해 금지·오프라인 상태를 Redis에 저장하고 소켓으로 실시간 반영",
    ],
  },
  {
    title: "DM 채팅",
    items: [
      "Socket.IO 방 단위 1:1 실시간 메시지, 읽음 처리·안 읽은 메시지 수",
      "파일 첨부(Multer), 메시지 삭제, 무한 스크롤로 이전 메시지 20개씩 로드",
    ],
  },
  {
    title: "음성 통화 · 화면 공유",
    items: [
      "WebRTC P2P 음성 통화, Socket.IO로 offer/answer/ICE 시그널링",
      "수신 알림 토스트·링백음, 통화 중 화면 공유 시작/종료",
      "Web Audio API로 말하는 사람을 감지해 상대 화면에 발화 표시",
    ],
  },
  {
    title: "UI",
    items: [
      "디스코드형 3단 레이아웃(서버 바 · DM 목록 · 본문)",
      "다크/라이트 테마, 모바일 사이드바",
    ],
  },
];

const TROUBLES: Trouble[] = [
  {
    title: "새로고침하면 진행 중인 통화가 끊김",
    problem: "통화 중 한쪽이 새로고침하거나 잠시 이탈하면 통화 상태가 사라지고 다시 걸어야 함",
    cause: "통화 상태가 클라이언트 메모리와 소켓 연결에만 존재",
    solution:
      "Redis에 통화방 세션(caller·callee·시작 시각·각자 종료 여부)을 저장하고, 재접속 시 세션을 조회해 재연결(call:reconn). 한쪽만 종료된 경우 3분 유예 타이머 후 세션 정리",
  },
  {
    title: "통화 화면이 준비되기 전에 offer가 도착",
    problem: "수락 직후 통화 컴포넌트가 마운트되기 전에 offer·ICE candidate가 먼저 와서 유실",
    cause: "시그널링 수신 시점과 WebRTC 연결을 처리할 컴포넌트의 생성 시점이 다름",
    solution:
      "offer와 candidate를 sessionStorage에 임시 보관하고, 통화 컴포넌트가 준비되면 대기(waitForOffer) 후 꺼내 처리",
  },
  {
    title: "통화 중 화면 공유 시작·종료가 상대에게 반영되지 않음",
    problem:
      "연결을 새로 맺지 않으면 공유 화면이 안 보이고, 종료해도 상대 화면에 마지막 프레임이 남음",
    cause: "기존 연결에 트랙을 추가하려면 재협상이 필요하고, 트랙을 빼면 m-line 구성이 바뀜",
    solution:
      "트랙 추가 시 renegotiate offer/answer로 재협상, 종료 시 replaceTrack(null)로 같은 mid를 유지해 상대가 즉시 종료를 감지",
  },
  {
    title: "링백음 · 수신음이 재생되지 않음",
    problem: "통화 알림음이 브라우저에 따라 재생되지 않음",
    cause: "사용자 상호작용 전 오디오 재생을 막는 자동 재생 정책",
    solution: "첫 클릭 시 무음 오디오를 한 번 재생해 오디오를 언락",
  },
  {
    title: "일부 네트워크에서 P2P 연결 실패",
    problem: "같은 코드로도 사용자 네트워크 환경에 따라 음성이 연결되지 않음",
    cause: "대칭형 NAT 등에서는 STUN만으로 직접 연결 불가",
    solution: "STUN과 함께 자체 TURN 서버를 구성해 직접 연결이 안 되면 릴레이로 연결",
  },
];

const RETRO = [
  "TURN 계정이 클라이언트 코드에 고정 — 시간 제한이 있는 임시 자격 증명(TURN REST API) 방식으로 바꿀 필요",
  "Redis에서 KEYS로 통화방을 찾는 부분 — 사용자별 인덱스 키나 SCAN으로 교체 필요",
  "1:1 통화 중심 설계 — 그룹 통화로 확장하려면 SFU 구조 검토",
];

// ───────────────────────── 페이지 ─────────────────────────

export default function OhsoriProject() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 font-mono text-sm text-[#8B84FF]">personal project</div>
      <h1 className="font-mono text-3xl font-bold text-white sm:text-4xl">Oh! Sori</h1>
      <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-white/60">
        친구 · DM · 음성 통화 · 화면 공유를 제공하는 디스코드형 음성채팅 커뮤니티
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-xs">
        <span className="rounded-full border border-white/10 px-3 py-1 text-white/50">
          2025.05 – 2025.07
        </span>
        <LinkPill href="https://github.com/rjsah5676/WooriBoard">GitHub ↗</LinkPill>
      </div>

      <div className="mt-8">
        <Shot img={dmImg} alt="DM 채팅 (다크 테마)" />
      </div>

      <StatGrid stats={STATS} />

      <Section num="01" title="개요">
        <div className="flex flex-col gap-3 font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/70">
          <p>
            디스코드처럼 친구를 추가하고 DM과 음성 통화, 화면 공유로 소통하는 커뮤니티 서비스입니다.
            프론트엔드(Next.js)와 백엔드(Express + Socket.IO)를 모두 TypeScript로 직접 구현하고
            Docker Compose로 배포했습니다.
          </p>
          <p>
            특히 <b className="text-white">WebRTC 1:1 음성 통화</b>를 실제 서비스 수준으로 다듬는 데
            집중해, 새로고침 후 통화 복구, 통화 중 화면 공유, 발화 감지, NAT 환경 대응까지
            구현했습니다.
          </p>
        </div>
      </Section>

      <Section num="02" title="기술 스택">
        <StackTable rows={STACK} />
      </Section>

      <Section num="03" title="아키텍처">
        <div className="rounded-xl border border-white/10 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
            <FlowBox title="Next.js Client" sub="Redux · Socket.IO client" />
            <Arrow />
            <div className="flex flex-col gap-2">
              <FlowBox title="Express + Socket.IO" sub="REST · 채팅 · 통화 시그널링" accent />
              <div className="grid grid-cols-2 gap-2">
                <FlowBox title="MongoDB" sub="유저 · 친구 · DM" />
                <FlowBox title="Redis" sub="접속 상태 · 통화 세션" />
              </div>
            </div>
            <Arrow />
            <FlowBox title="상대 Client" sub="WebRTC P2P (STUN/TURN)" />
          </div>
          <p className="mt-4 font-['Nanum_Gothic',sans-serif] text-xs leading-relaxed text-white/45">
            음성·화면은 클라이언트끼리 WebRTC로 직접 연결하고, 서버는 시그널링과 상태 관리만 담당 ·
            client / server / mongo 컨테이너를 Docker Compose로 구성
          </p>
        </div>
      </Section>

      <Section num="04" title="주요 기능">
        <div className="grid gap-3 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-white/10 bg-[#1C1E24] p-5">
              <h3 className="mb-3 font-mono text-sm font-medium text-white">{f.title}</h3>
              <Bullets items={f.items} />
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Shot img={landingImg} alt="시작 화면" />
          <Shot img={loginImg} alt="소셜 로그인" />
          <Shot img={homeImg} alt="친구 목록 · 상태 표시" />
          <Shot img={dmLightImg} alt="DM 채팅 (라이트 테마)" />
        </div>
        <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-xs text-white/40">
          * 스크린샷은 로컬에서 데모 데이터로 재현한 화면입니다.
        </p>
      </Section>

      <Section num="05" title="트러블슈팅">
        <TroubleList items={TROUBLES} />
      </Section>

      <Section num="06" title="회고">
        <Bullets items={RETRO} />
      </Section>
    </div>
  );
}
