import { Bullets, LinkPill, Section, Shot, StackTable } from "./ProjectDetailUI";

import mainImg from "@/img/Page/info/artpart/slide_1.jpg";
import roomImg from "@/img/Page/info/artpart/slide_3.jpg";
import reservImg from "@/img/Page/info/artpart/slide_4.jpg";
import reviewImg from "@/img/Page/info/artpart/slide_5.jpg";
import dbImg from "@/img/Page/info/artpart/ppt_12.jpg";

const STACK = [
  { group: "Frontend", items: ["JSP / JSTL", "JavaScript", "jQuery"] },
  { group: "Backend", items: ["Spring MVC", "MyBatis", "Interceptor"] },
  { group: "DB", items: ["MySQL"] },
];

const ROLE = [
  "팀장으로 일정 관리와 Git 브랜치 병합 담당",
  "공용 기능(헤더·네비게이션·하단 메뉴), 메인 소개 페이지",
  "객실 예약 페이지: 날짜·인원 선택, 이미 예약된 날짜 표시, 예약 내역·취소",
  "후기 페이지: 다중 이미지 첨부 후기 작성·수정·삭제, 모달 후기 상세",
];

const FEATURES = [
  "회원가입·로그인·마이페이지(찜 목록, 예약 내역, 작성 후기)",
  "객실·다이닝·시설 소개 페이지, 반응형 레이아웃",
  "관리자 페이지: 회원·예약·후기 조회 및 관리 (로그인·관리자 인터셉터로 접근 제어)",
  "드래그로 옮길 수 있는 모달, 사진을 무작위로 흩뿌리는 갤러리 연출 등 JavaScript 인터랙션",
];

const RETRO = [
  "첫 팀장 프로젝트 — 체계적인 Spring MVC 계층 구조 덕분에 문제 지점을 빠르게 찾을 수 있다는 것을 체감",
  "후기 수정 시 기존 이미지보다 많거나 적게 올리는 경우, 같은 파일명 충돌까지 모든 경우를 고려해야 해 파일 처리의 까다로움을 경험",
  "React에 익숙한 상태에서 JSP의 느린 반영 주기를 겪으며 프론트엔드 개발 환경의 중요성을 느낌",
];

export default function ArtpartProject() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 font-mono text-sm text-[#8B84FF]">team project · 팀장</div>
      <h1 className="font-mono text-3xl font-bold text-white sm:text-4xl">ArtPart</h1>
      <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-white/60">
        예술(Art)과 공간(Apartment)을 결합한 콘셉트의 호텔 예약 사이트
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-xs">
        <span className="rounded-full border border-white/10 px-3 py-1 text-white/50">2025.02</span>
        <LinkPill href="https://github.com/rjsah5676/ArtPart">GitHub ↗</LinkPill>
      </div>

      <div className="mt-8">
        <Shot img={mainImg} alt="메인" />
      </div>

      <Section num="01" title="개요">
        <p className="font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/70">
          Spring MVC 패턴과 JSP/JSTL 문법을 익히기 위한 팀 프로젝트로, 규모는 작지만 디자인 완성도에
          공을 들였습니다. 객실 소개부터 예약, 후기, 관리자 기능까지 호텔 예약 사이트의 기본 흐름을
          구현했습니다.
        </p>
      </Section>

      <Section num="02" title="기술 스택">
        <StackTable rows={STACK} />
      </Section>

      <Section num="03" title="담당 역할">
        <Bullets items={ROLE} />
      </Section>

      <Section num="04" title="주요 기능">
        <Bullets items={FEATURES} />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Shot img={roomImg} alt="객실" />
          <Shot img={reservImg} alt="예약" />
        </div>
        <div className="mt-3">
          <Shot img={reviewImg} alt="후기" />
        </div>
      </Section>

      <Section num="05" title="DB 설계">
        <Shot img={dbImg} alt="ERD" />
      </Section>

      <Section num="06" title="회고">
        <Bullets items={RETRO} />
      </Section>
    </div>
  );
}
