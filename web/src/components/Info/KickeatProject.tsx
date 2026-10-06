import {
  Arrow,
  Bullets,
  FlowBox,
  LinkPill,
  Section,
  Shot,
  StackTable,
  TroubleList,
  type Trouble,
} from "./ProjectDetailUI";

import mainImg from "@/img/Page/info/kickeat/img_kickeat_1.jpg";
import recommendImg from "@/img/Page/info/kickeat/img_kickeat_5.jpg";
import findImg from "@/img/Page/info/kickeat/img_kickeat_8.jpg";
import detailImg from "@/img/Page/info/kickeat/img_kickeat_6.jpg";
import techImg from "@/img/Page/info/kickeat/img_kickeat_tc.jpg";
import dbImg from "@/img/Page/info/kickeat/img_kickeat_db.jpg";

const STACK = [
  {
    group: "Frontend",
    items: [
      "React",
      "React Router",
      "TanStack Query",
      "styled-components",
      "CKEditor 5",
      "Chart.js",
    ],
  },
  { group: "Backend", items: ["Spring Boot", "Spring Data JPA"] },
  { group: "DB", items: ["MySQL"] },
  {
    group: "Data / API",
    items: [
      "서울시 공공데이터",
      "Kakao Maps SDK (Places)",
      "Selenium (Headless Chrome)",
      "Daum 우편번호",
    ],
  },
];

const FEATURES: { title: string; items: string[] }[] = [
  {
    title: "맛집 추천",
    items: [
      "선호 음식을 카트에 담으면 회원 주소와 선택한 카테고리로 음식점 추천",
      "갱신 버튼으로 다른 추천 받기, 주소 검색으로 다른 지역 기준 추천",
    ],
  },
  {
    title: "음식점 찾기 · 상세",
    items: [
      "상세 카테고리 + 검색어 검색, 조회순·평점순·리뷰순·찜순 정렬, 찜 등록",
      "카카오맵에서 수집한 메뉴·사진·영업 정보, 회원 주소와의 거리, 리뷰 작성·조회",
    ],
  },
  {
    title: "커뮤니티",
    items: [
      "자유게시판: 관리자 공지 상단 고정(2개), 댓글, 제목·내용 검색",
      "이벤트 게시판, 1:1 문의, 쪽지·신고, 마이페이지",
    ],
  },
];

const TROUBLES: Trouble[] = [
  {
    title: "공공데이터만으로는 메뉴 · 사진 정보가 없음",
    problem: "서울시 공공데이터의 약 12만 개 음식점 정보는 위치·카테고리·상호명 정도만 제공",
    cause: "상세 페이지에 필요한 메뉴·사진·영업시간은 공공데이터에 존재하지 않음",
    solution:
      "상호명으로 Kakao Places 키워드 검색을 해 카카오맵 장소 ID를 얻고, 서버에서 Selenium(Headless Chrome)으로 해당 장소 페이지를 크롤링해 상세 정보를 채움",
  },
];

const RETRO = [
  "상세 페이지 요청마다 Headless Chrome을 띄워 크롤링하는 구조라 응답이 느림 — 수집 결과를 DB에 캐싱하거나 배치로 미리 수집하는 방식이 적합",
  "외부 사이트 구조에 의존하는 크롤링은 페이지가 바뀌면 바로 깨짐 — 실패 시 기본 정보만 보여주는 대체 처리 필요",
];

export default function KickeatProject() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 font-mono text-sm text-[#8B84FF]">team project</div>
      <h1 className="font-mono text-3xl font-bold text-white sm:text-4xl">KickEat</h1>
      <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-white/60">
        취향과 위치를 기반으로 서울시 음식점을 추천하는 맛집 탐색 서비스
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-xs">
        <span className="rounded-full border border-white/10 px-3 py-1 text-white/50">2025.02</span>
        <LinkPill href="https://github.com/rjsah5676/KickEat">GitHub ↗</LinkPill>
      </div>

      <div className="mt-8">
        <Shot img={mainImg} alt="메인" />
      </div>

      <Section num="01" title="개요">
        <p className="font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/70">
          서울시 공공데이터의 음식점 정보를 기반으로, 사용자가 고른 음식 취향과 등록한 주소를 조합해
          음식점을 추천합니다. 공공데이터에 없는 메뉴·사진 정보는 카카오맵 API와 크롤링으로
          보완했고, 리뷰·찜·게시판 등 커뮤니티 기능을 함께 제공합니다.
        </p>
      </Section>

      <Section num="02" title="기술 스택">
        <StackTable rows={STACK} />
      </Section>

      <Section num="03" title="데이터 수집 구조">
        <div className="rounded-xl border border-white/10 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <FlowBox title="서울시 공공데이터" sub="약 12만 개 음식점 · 위치 · 카테고리" />
            <Arrow />
            <FlowBox title="Kakao Places 검색" sub="상호명 → 카카오맵 장소 ID" accent />
            <Arrow />
            <FlowBox title="Selenium 크롤링" sub="메뉴 · 사진 · 영업 정보" />
          </div>
        </div>
        <div className="mt-4">
          <Shot img={techImg} alt="카카오맵 API + Selenium" />
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
          <Shot img={recommendImg} alt="맛집 추천" />
          <Shot img={findImg} alt="음식점 찾기" />
        </div>
        <div className="mt-3">
          <Shot img={detailImg} alt="음식점 상세" />
        </div>
      </Section>

      <Section num="05" title="DB 설계">
        <Shot img={dbImg} alt="ERD" />
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
