import { Arrow, Bullets, FlowBox, LinkPill, Section, Shot, StackTable } from "./ProjectDetailUI";

import mainImg from "@/img/Page/info/yorijori/img_main.png";
import boardImg from "@/img/Page/info/yorijori/img_slide_5.png";
import writeImg from "@/img/Page/info/yorijori/img_write.png";
import detailImg from "@/img/Page/info/yorijori/img_slide_4.png";

const STACK = [
  {
    group: "Frontend",
    items: ["React", "React Router", "React Bootstrap", "CKEditor 4", "axios", "reCAPTCHA v3"],
  },
  { group: "Backend", items: ["Node.js", "Express", "express-session"] },
  { group: "DB", items: ["MongoDB", "Mongoose"] },
];

const FEATURES: { title: string; items: string[] }[] = [
  {
    title: "회원",
    items: [
      "비밀번호는 사용자별 랜덤 salt + PBKDF2(SHA-512, 10만 회)로 해시해 저장",
      "로그인 5회 연속 실패 시 로그인 차단, 로그인 페이지 reCAPTCHA v3 적용",
      "express-session 기반 로그인 유지",
    ],
  },
  {
    title: "레시피 게시판",
    items: [
      "CKEditor로 레시피 작성·수정·삭제, 카테고리 분류",
      "카테고리·제목 검색, 최신순·평점순 정렬, 페이지당 10개 페이징",
      "메인: 최신 레시피 10개와 평가 인원 기준 HOT 레시피 3개",
      "내가 쓴 글 모아보기",
    ],
  },
  {
    title: "별점 · 댓글",
    items: [
      "게시글별 별점 등록, 1인 1회 제한 후 평균 평점·평가 인원 갱신",
      "레시피별 댓글 작성·삭제",
    ],
  },
];

const RETRO = [
  "전체 게시글을 조회한 뒤 배열을 잘라 페이징 — DB 단의 skip/limit으로 바꾸면 데이터가 늘어도 부담이 적음",
  "검색어를 정규식에 그대로 넣는 구조 — 특수문자 이스케이프가 필요",
  "로그인 차단 이후 해제 절차가 없음 — 이메일 인증 등 잠금 해제 흐름 보완 필요",
];

export default function YorijoriProject() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 font-mono text-sm text-[#8B84FF]">
        personal project · 2019-2학기 웹 프로젝트
      </div>
      <h1 className="font-mono text-3xl font-bold text-white sm:text-4xl">요리조리</h1>
      <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-white/60">
        별점 리뷰로 좋은 레시피를 골라볼 수 있는 레시피 공유 커뮤니티
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-xs">
        <span className="rounded-full border border-white/10 px-3 py-1 text-white/50">
          2019.10 – 2019.12
        </span>
        <LinkPill href="https://github.com/rjsah5676/WebProject">GitHub ↗</LinkPill>
      </div>

      <div className="mt-8">
        <Shot img={mainImg} alt="메인 — 최신 · HOT 레시피" />
      </div>

      <Section num="01" title="개요">
        <p className="font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/70">
          레시피를 찾으려면 여전히 책이나 포털 검색에 의존해야 하고, 찾은 레시피가 맛있는지
          판단하려면 정보를 더 찾아봐야 한다는 불편함에서 출발했습니다. 사용자가 레시피를 공유하고
          별점과 댓글로 평가해, 평점순으로 검증된 레시피를 쉽게 찾을 수 있도록 만든 React + Express
          + MongoDB 풀스택 프로젝트입니다.
        </p>
      </Section>

      <Section num="02" title="기술 스택">
        <StackTable rows={STACK} />
      </Section>

      <Section num="03" title="구조">
        <div className="rounded-xl border border-white/10 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
            <FlowBox title="React SPA" sub="게시판 · 글쓰기 · 별점" />
            <Arrow />
            <FlowBox title="Express REST API" sub="member · board · comment 라우터, 세션" accent />
            <Arrow />
            <FlowBox title="MongoDB" sub="User · Board · Comment · Rating" />
          </div>
        </div>
      </Section>

      <Section num="04" title="주요 기능">
        <div className="grid gap-3 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-white/10 bg-[#1C1E24] p-5">
              <h3 className="mb-3 font-mono text-sm font-medium text-white">{f.title}</h3>
              <Bullets items={f.items} />
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Shot img={boardImg} alt="레시피 게시판 (검색 · 정렬 · 페이징)" />
          <Shot img={detailImg} alt="레시피 상세 (별점 · 댓글)" />
        </div>
        <div className="mt-3">
          <Shot img={writeImg} alt="레시피 작성 (CKEditor)" />
        </div>
      </Section>

      <Section num="05" title="회고">
        <Bullets items={RETRO} />
      </Section>
    </div>
  );
}
