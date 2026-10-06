import { Bullets, LinkPill, Section, Shot, StackTable } from "./ProjectDetailUI";

import mainImg from "@/img/Page/info/yctest/slide_1.jpg";

const STACK = [
  { group: "Frontend", items: ["JSP", "JavaScript", "HTML / CSS"] },
  { group: "Backend", items: ["Java", "JDBC", "DAO / VO 패턴"] },
  { group: "DB", items: ["MySQL"] },
];

const FEATURES = [
  "법인현황·주민세·지방세 특례 등 세무 신고서 작성 및 제출",
  "제출한 신고서 조회·출력, 세무조사 결과 조회",
  "세무대리인 등록·검색·관리",
  "고객센터: 공지사항, 자주 묻는 질문, 1:1 문의, 서식 자료실, 세무 용어 사전",
  "관리자: 회원·공지·문의 답변·자료실·용어 관리",
];

export default function TaxProject() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 font-mono text-sm text-[#8B84FF]">team project</div>
      <h1 className="font-mono text-3xl font-bold text-white sm:text-4xl">
        영천시 세무조사 홈페이지
      </h1>
      <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-white/60">
        법인 세무조사 신고서를 온라인으로 작성·제출·조회하는 인터넷 신고 시스템
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-xs">
        <span className="rounded-full border border-white/10 px-3 py-1 text-white/50">
          2021.10 – 2022.01
        </span>
        <LinkPill href="https://github.com/rjsah5676/Tax-Investigation">GitHub ↗</LinkPill>
      </div>

      <div className="mt-8">
        <Shot img={mainImg} alt="메인" />
      </div>

      <Section num="01" title="개요">
        <p className="font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/70">
          법인 세무조사 관련 신고서를 웹에서 작성·제출하고 결과를 조회할 수 있는 인터넷 신고
          시스템입니다. 프레임워크 없이 JSP와 JDBC 기반 DAO/VO 구조로 신고서 작성부터 관리자
          기능까지 구현했습니다.
        </p>
      </Section>

      <Section num="02" title="기술 스택">
        <StackTable rows={STACK} />
      </Section>

      <Section num="03" title="주요 기능">
        <Bullets items={FEATURES} />
      </Section>

      <Section num="04" title="회고">
        <Bullets
          items={[
            "화면(JSP)과 처리 로직(action JSP)이 한데 섞인 Model 1 구조 — 컨트롤러·서비스 계층을 분리하면 기능 추가와 유지보수가 쉬워짐",
          ]}
        />
      </Section>
    </div>
  );
}
