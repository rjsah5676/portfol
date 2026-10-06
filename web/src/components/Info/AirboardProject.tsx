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

import homeImg from "@/img/Page/info/airboard/img_2.png";
import roomImg from "@/img/Page/info/airboard/img_3.png";
import shareImg from "@/img/Page/info/airboard/img_4.png";
import gestureImg from "@/img/Page/info/airboard/img_5.png";
import camWriteImg from "@/img/Page/info/airboard/img_6.png";

// ───────────────────────── 데이터 ─────────────────────────

const STATS = [
  { value: "캡스톤", label: "아주대 SW학과" },
  { value: "2021-1", label: "소프트콘 출품" },
  { value: "120+", label: "커밋" },
  { value: "P2P", label: "WebRTC 화상회의" },
];

const STACK = [
  { group: "Frontend", items: ["JavaScript", "EJS", "Canvas API", "jQuery UI", "anime.js"] },
  { group: "Realtime", items: ["WebRTC (PeerJS)", "Socket.IO", "Screen Capture API"] },
  { group: "Backend", items: ["Node.js", "Express", "Passport (Local)", "express-session"] },
  { group: "DB", items: ["MongoDB", "Mongoose", "connect-mongodb-session"] },
  { group: "Vision (팀원)", items: ["OpenCV.js", "TensorFlow.js Handpose", "Fingerpose"] },
];

const ROLES: { title: string; items: string[] }[] = [
  {
    title: "WebRTC 화상회의",
    items: [
      "PeerJS 기반 P2P 영상·음성 연결, 참가자 입장/퇴장 시 연결 생성·정리",
      "캠 켜기/끄기·음소거 상태를 Socket.IO로 참가자 전원에게 동기화",
      "캠·마이크가 없는 사용자도 입장 가능하도록 대체 비디오 트랙으로 스트림 구성",
      "화면 공유(getDisplayMedia) 시작·종료, 공유자 퇴장 시 공유 화면 초기화",
    ],
  },
  {
    title: "서버 · 회의방",
    items: [
      "Express + Socket.IO 시그널링 서버, UUID 기반 회의방 생성·입장",
      "Passport Local 로그인·회원가입, MongoDB 세션 저장",
      "호스트 지정, 호스트 퇴장 시 남은 참가자에게 자동 양도, 마지막 인원 퇴장 시 방 삭제",
      "회의방 입장 인원 제한, 참가자 목록·이름 변경 동기화",
    ],
  },
  {
    title: "화이트보드 필기",
    items: [
      "마우스 필기 선분을 캔버스 크기와 함께 전송해 참가자별 해상도에 맞게 비율 변환",
      "서버에 방·사용자별 필기 기록을 저장해 늦게 입장한 참가자에게 재전송",
      "사용자 단위 되돌리기/다시 실행, 칠판 지우기, 펜 색상·굵기·지우개",
      "호스트의 공용 칠판 / 개인 칠판 모드 전환과 필기 권한 제어",
    ],
  },
  {
    title: "프론트엔드 UI",
    items: [
      "메인·로그인·회원가입·회의방 등 화면 대부분의 UI 구현",
      "회의방 레이아웃(참가자 영상·칠판·채팅), 채팅창, 주소 복사 창",
      "드래그 가능한 플로팅 버튼 (이후 이 포트폴리오 사이트 퀵메뉴의 원형)",
    ],
  },
];

const TROUBLES: Trouble[] = [
  {
    title: "참가자마다 화면 크기가 달라 필기 위치가 어긋남",
    problem: "같은 선을 그려도 창 크기가 다른 참가자 화면에서는 다른 위치에 그려짐",
    cause: "그린 사람 캔버스 기준의 절대 좌표를 그대로 전송",
    solution:
      "선분 좌표와 함께 보낸 쪽 캔버스 크기를 전송하고, 받는 쪽에서 자기 캔버스 크기 비율로 환산해 그리도록 변경",
  },
  {
    title: "늦게 들어온 참가자에게 기존 필기가 보이지 않음",
    problem: "회의 도중 입장하면 이전에 그려진 내용 없이 빈 칠판이 보임",
    cause: "필기 이벤트를 실시간으로 중계만 하고 서버에 남기지 않음",
    solution:
      "서버 메모리에 방·사용자별 필기 기록을 저장하고 입장·되돌리기·모드 전환 시 기록을 재전송해 다시 그리도록 처리",
  },
  {
    title: "캠이나 마이크가 없는 사용자가 입장하지 못함",
    problem: "장치가 없거나 권한을 거부하면 getUserMedia 실패로 회의 입장 자체가 막힘",
    cause: "영상·음성 스트림이 반드시 있어야 P2P 연결을 맺는 구조",
    solution:
      "영상+음성 → 음성만 → 둘 다 없음 순으로 폴백하고, 부족한 영상 트랙은 대체 비디오의 captureStream으로 채워 연결을 유지",
  },
  {
    title: "호스트가 나가면 회의방을 제어할 사람이 없어짐",
    problem: "캔버스 권한·모드 전환 등 호스트 전용 기능이 호스트 퇴장 후 사용 불가",
    cause: "호스트 정보가 최초 입장자에게 고정",
    solution:
      "퇴장 시 호스트 여부를 확인해 남은 참가자 중 한 명에게 호스트를 넘기고 전원에게 알림, 화면 공유자가 나가면 공유 화면도 초기화",
  },
];

const RETRO = [
  "필기 기록을 서버 메모리에만 두어 서버 재시작 시 사라지는 구조 — 방 단위 저장소(DB·Redis)로 분리할 여지",
  "일부 필기 이벤트를 전체 소켓에 브로드캐스트한 뒤 클라이언트에서 방 ID로 거르는 구조 — Socket.IO room 단위 전송으로 개선 가능",
  "P2P 메시 구조라 참가자가 늘수록 부하가 커짐 — 규모가 커지면 SFU 도입 필요",
  "팀원이 맡은 캠 필기(OpenCV)·제스처(Handpose)와 화상회의·칠판을 한 화면에 통합하며 모듈 간 이벤트 설계의 중요성을 경험",
];

// ───────────────────────── 페이지 ─────────────────────────

export default function AirboardProject() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 font-mono text-sm text-[#8B84FF]">team project · 캡스톤디자인</div>
      <h1 className="font-mono text-3xl font-bold text-white sm:text-4xl">AirBoard</h1>
      <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-white/60">
        웹캠으로 허공에 필기하고 손동작으로 조작하는 웹 화상회의 플랫폼
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-xs">
        <span className="rounded-full border border-white/10 px-3 py-1 text-white/50">
          2021.03 – 2021.06
        </span>
        <LinkPill href="https://github.com/rjsah5676/Capstone-Design-2021-1-">GitHub ↗</LinkPill>
        <LinkPill href="https://softcon.ajou.ac.kr/works/works_prev.asp?uid=421&wTerm=2021-1">
          소프트콘 ↗
        </LinkPill>
      </div>

      <div className="mt-8">
        <Shot img={camWriteImg} alt="회의방 — 필기와 채팅" />
      </div>

      <StatGrid stats={STATS} />

      <Section num="01" title="개요">
        <div className="flex flex-col gap-3 font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/70">
          <p>
            비대면 수업에서 마우스로 느리고 부정확하게 필기하는 모습을 보고, 누구나 가진 웹캠을 입력
            장치로 활용해보자는 아이디어에서 출발했습니다. 카메라·화면 공유, 음성·문자 채팅 등
            화상회의 기본 기능에 더해 웹캠 앞에서 펜이나 손을 움직이면 그 궤적이 칠판에 그려지고,
            손동작으로 칠판 지우기·화면 캡처 등을 실행할 수 있습니다.
          </p>
          <p>
            팀에서{" "}
            <b className="text-white">
              WebRTC 화상회의와 서버, 화이트보드 필기, 프론트엔드 UI 대부분
            </b>
            을 담당했습니다. 영상 인식 기반의 캠 필기(OpenCV.js)와 손 제스처 인식(Handpose)은 팀원이
            맡았고, 이를 회의방에 통합했습니다.
          </p>
        </div>
      </Section>

      <Section num="02" title="기술 스택">
        <StackTable rows={STACK} />
      </Section>

      <Section num="03" title="아키텍처">
        <div className="rounded-xl border border-white/10 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
            <FlowBox title="참가자 A" sub="캠 · 마이크 · 칠판" />
            <Arrow />
            <div className="flex flex-col gap-2">
              <FlowBox title="Express + Socket.IO" sub="시그널링 · 채팅 · 필기 중계/기록" accent />
              <FlowBox title="MongoDB" sub="회원 · 회의방 · 세션" />
            </div>
            <Arrow />
            <FlowBox title="참가자 B, C …" sub="캠 · 마이크 · 칠판" />
          </div>
          <p className="mt-4 font-['Nanum_Gothic',sans-serif] text-xs leading-relaxed text-white/45">
            영상·음성·화면 공유는 PeerJS로 참가자 간 P2P 직접 연결 · 필기·상태 동기화와 채팅은
            Socket.IO 서버 경유
          </p>
        </div>
      </Section>

      <Section num="04" title="담당 역할">
        <div className="grid gap-3 sm:grid-cols-2">
          {ROLES.map((r) => (
            <div key={r.title} className="rounded-xl border border-white/10 bg-[#1C1E24] p-5">
              <h3 className="mb-3 font-mono text-sm font-medium text-white">{r.title}</h3>
              <Bullets items={r.items} />
            </div>
          ))}
        </div>
      </Section>

      <Section num="05" title="주요 기능">
        <div className="flex flex-col gap-10">
          <div>
            <h3 className="mb-3 font-mono text-base font-medium text-white">회의 생성 · 참여</h3>
            <Bullets
              items={[
                "로그인 후 회의 생성 시 고유 주소 발급, 호스트에게 주소 복사 창 제공",
                "회의방: 참가자 영상, 기능 버튼(캠·마이크·화면 공유·캠 필기·제스처), 칠판, 채팅 영역",
              ]}
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Shot img={homeImg} alt="메인 (로그인 후)" />
              <Shot img={roomImg} alt="회의방 구성" />
            </div>
          </div>
          <div>
            <h3 className="mb-3 font-mono text-base font-medium text-white">화면 공유 + 필기</h3>
            <Bullets
              items={[
                "공유 화면 위에 칠판을 겹쳐 발표 자료에 바로 필기",
                "펜 색상·굵기, 지우개, 되돌리기/다시 실행, 칠판 지우기",
              ]}
            />
            <div className="mt-4">
              <Shot img={shareImg} alt="화면 공유 위 필기" />
            </div>
          </div>
          <div>
            <h3 className="mb-3 font-mono text-base font-medium text-white">
              캠 필기 · 제스처 (팀원 담당)
            </h3>
            <Bullets
              items={[
                "캠 필기: 지정한 펜 색상 영역을 OpenCV.js로 추출해 중심점을 커서로 추적",
                "제스처: 손바닥(칠판 지우기) · 브이(화면 캡처 저장) · 따봉(반응), 연속 프레임 누적으로 오인식 방지",
              ]}
            />
            <div className="mx-auto mt-4 w-full max-w-md">
              <Shot img={gestureImg} alt="지원 제스처" />
            </div>
          </div>
        </div>
      </Section>

      <Section num="06" title="트러블슈팅">
        <TroubleList items={TROUBLES} />
      </Section>

      <Section num="07" title="회고">
        <Bullets items={RETRO} />
      </Section>
    </div>
  );
}
