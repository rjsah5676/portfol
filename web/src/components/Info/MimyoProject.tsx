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

import mainImg from "@/img/Page/info/mimyo/mimyo_slide_1.jpg";
import popularImg from "@/img/Page/info/mimyo/mimyo_slide_2.jpg";
import searchImg from "@/img/Page/info/mimyo/mimyo_slide_3.jpg";
import eventImg from "@/img/Page/info/mimyo/mimyo_slide_4.jpg";
import auctionImg from "@/img/Page/info/mimyo/mimyo_slide_5.jpg";
import profileImg from "@/img/Page/info/mimyo/mimyo_slide_6.jpg";
import statsImg from "@/img/Page/info/mimyo/mimyo_slide_7.jpg";
import chatImg from "@/img/Page/info/mimyo/mimyo_slide_8.jpg";
import erdImg from "@/img/Page/info/mimyo/mimyo_db.jpg";

// ───────────────────────── 데이터 ─────────────────────────

const STATS = [
  { value: "6인", label: "팀 (팀장)" },
  { value: "5.5주", label: "개발 기간" },
  { value: "39", label: "담당 기능" },
  { value: "HTTPS", label: "실서버 배포" },
];

const STACK = [
  {
    group: "Frontend",
    items: [
      "React",
      "Redux Toolkit",
      "styled-components",
      "Chart.js",
      "CKEditor 5",
      "STOMP.js · SockJS",
    ],
  },
  {
    group: "Backend",
    items: [
      "Spring Boot 3",
      "Spring Security",
      "JWT",
      "OAuth2 Client",
      "JPA · Native Query",
      "WebSocket(STOMP)",
    ],
  },
  { group: "DB", items: ["MySQL"] },
  {
    group: "External API",
    items: ["Toss Payments", "Google · Kakao · Naver OAuth", "Daum 우편번호", "JavaMail"],
  },
  { group: "Infra", items: ["Naver Cloud (Ubuntu)", "Nginx", "Let's Encrypt · Certbot"] },
];

// 담당 파트 (발표 자료 역할분담 기준, 성격별로 묶음)
const ROLES: { title: string; items: string[] }[] = [
  {
    title: "주문 · 결제",
    items: [
      "주문 그룹 – 주문 – 주문 옵션 3단 구조 설계 및 결제 상태에 따른 주문 프로세스 구현",
      "Toss Payments 결제 / 전체·부분 취소 / 부분 환불",
      "결제 중 재고 경합 차단, 배송지 등록·쿠폰 적용 옵션 처리",
      "주문 내역(취소·환불·구매 확정)·판매 내역(주문 확인·배송 등록) 상태 처리 및 UI",
      "스케줄러 기반 2주 후 자동 구매 확정, 정산 내역",
    ],
  },
  {
    title: "실시간 경매 · 커뮤니케이션",
    items: [
      "경매 등록, STOMP 기반 실시간 입찰, 스케줄러 경매 마감 처리",
      "마감 경매 낙찰·즉시 구매 시 주문 생성 및 결제 연결",
      "유저 오버레이(정보 보기·쪽지·채팅·신고) 설계 및 구현",
      "쪽지·신고·신고 처리, 1:1 채팅 이미지 전송",
      "결제·배송·입찰 등 프로세스 결과 자동 쪽지 알림",
    ],
  },
  {
    title: "인증 · 회원",
    items: [
      "JWT 인증 기반 로그인, Google·Naver·Kakao OAuth2 소셜 로그인",
      "이메일 인증을 통한 비밀번호 찾기",
      "사용자 등급·등급 포인트 지급, 스케줄러 기반 등급 처리",
    ],
  },
  {
    title: "상품 · 추천 · 이벤트",
    items: [
      "상품 – 옵션 – 카테고리 구조 설계 및 상품 등록·수정·삭제",
      "카테고리별 검색·주제별 정렬, 무한 스크롤 페이징(useInView)",
      "상품 추천 알고리즘, 메인 인기 카테고리·인기 작품·인기 작가 필터링",
      "이벤트 등록·기간별 진행/종료 처리, 출석 룰렛·멜론 게임 이벤트(쿠폰·등급 포인트 연계)",
      "검색·접속 등 사용자 활동 로그 저장",
    ],
  },
  {
    title: "프론트 구조 · 팀 운영 · 배포",
    items: [
      "Redux로 검색어·모달·상호작용·로그인 상태 전역 관리",
      "헤더·마이페이지·관리자 대시보드 초기 구조 및 라우터 구성, 드래그 가능한 플로팅 버튼",
      "DB 관리, Git 브랜치 전략·파일 시스템 총괄",
      "Naver Cloud 서버 배포, Nginx 리버스 프록시, SSL 인증서·도메인 연결",
    ],
  },
];

interface Feature {
  title: string;
  items: string[];
  images?: { img: StaticImageData; alt: string }[];
}

const FEATURES: Feature[] = [
  {
    title: "상품 판매 · 검색 · 추천",
    items: [
      "옵션 대분류/소분류 단위 재고, 가격·할인율·배송비 설정, 이미지 1~5장 드래그 앤 드롭 첨부",
      "이벤트·대상·카테고리 다중 필터와 다양한 정렬, 무한 스크롤",
      "메인: 기간별 이벤트 배너, 관리자 등록 서브메뉴, 월간 인기 카테고리·작품·작가",
    ],
    images: [
      { img: mainImg, alt: "메인 이벤트 배너" },
      { img: searchImg, alt: "상품 검색" },
    ],
  },
  {
    title: "실시간 경매",
    items: [
      "STOMP 채널을 경매방 ID별로 분리해 참여자에게만 입찰 정보 브로드캐스트",
      "시작가·현재가·즉시 구매가·남은 시간·입찰 인원 실시간 반영",
      "보증금(시작가 10%) 기반 입찰, 상회 입찰·낙찰·즉시 구매 시 자동 쪽지",
      "인기(입찰자 수)·마감 임박 Top 50 목록",
    ],
    images: [{ img: auctionImg, alt: "경매 상세" }],
  },
  {
    title: "채팅 · 쪽지 · 커뮤니티",
    items: [
      "작가–구매자 1:1 실시간 채팅(상품 문의 채팅은 상품 정보 표시), 이미지 다중 전송, 읽음 표시",
      "어디서든 같은 컴포넌트로 동작하는 유저 상호작용 메뉴(정보 보기·쪽지·채팅·신고)",
      "프로필 방명록·팔로우, 리뷰(별점·이미지·좋아요)",
    ],
    images: [
      { img: chatImg, alt: "1:1 채팅" },
      { img: profileImg, alt: "마이페이지 프로필" },
    ],
  },
  {
    title: "이벤트 · 관리자",
    items: [
      "월별 이벤트 페이지, 하루 1회 출석 룰렛, 멜론 게임 이벤트(점수 기반 쿠폰·등급 포인트)",
      "관리자: 신고 처리, 정산 처리, 기간별·상품별 판매 통계, 쿠폰 지급, 서브메뉴 관리",
      "마이페이지 활동·구매·판매 통계(Chart.js), 판매 내역 엑셀 다운로드",
    ],
    images: [
      { img: eventImg, alt: "이벤트" },
      { img: statsImg, alt: "관리자 판매 통계" },
    ],
  },
];

const TROUBLES: Trouble[] = [
  {
    title: "결제 도중 다른 사용자가 먼저 구매해 재고가 초과되는 문제",
    problem: "같은 옵션 상품을 여러 명이 동시에 결제하면 실제 재고보다 많이 팔릴 수 있음",
    cause: "장바구니·결제 페이지에서 확인한 재고와 결제 승인 시점의 재고가 달라질 수 있음",
    solution:
      "Toss 결제 승인 요청 직전에 옵션 소분류 단위로 재고를 다시 검증하고, 초과 시 주문 그룹을 폐기한 뒤 결제를 중단(quantity_over 응답)",
  },
  {
    title: "묶음 주문의 부분 취소 · 부분 환불",
    problem: "한 번의 결제에 여러 상품·옵션이 섞여 있어 일부 상품만 취소·환불하기 어려움",
    cause: "결제 단위와 상품·옵션 단위의 주문 상태가 하나로 묶여 있으면 개별 상태 관리가 불가",
    solution:
      "결제 1회 = 주문 그룹, 상품 1개 = 주문, 옵션 소분류 1개 = 주문 옵션으로 분리해 그룹 상태(부분 취소·부분 환불)와 주문 상태(배송·정산 등)를 따로 관리",
  },
  {
    title: "경매 마감 직전 입찰(스나이핑)",
    problem: "마감 직전에 입찰이 몰리면 다른 참여자가 대응할 시간이 없음",
    cause: "고정된 종료 시간 기준으로만 마감 처리",
    solution:
      "마감 5분 이내 입찰 시 종료 시간을 1분 연장하고, 서버 스케줄러가 주기적으로 마감된 경매를 정리해 낙찰 주문을 생성",
  },
  {
    title: "추천 결과 중복 · 후보 소진",
    problem:
      "새로고침마다 같은 상품이 반복 추천되거나, 활동 이력이 적은 사용자는 추천할 상품이 없음",
    cause: "찜·장바구니·조회·리뷰·검색 이력 기반 후보군이 작고 이미 보여준 상품을 구분하지 않음",
    solution:
      "후보를 섞은 뒤 이미 추천한 상품을 제외하고, 후보가 모두 소진되면 평점·리뷰·찜·조회·주문 수 가중 점수 기반 기본 추천으로 대체",
  },
];

const RETRO = [
  "기능이 늘어날수록 코드 복잡도가 커지는 것을 겪으며, 초기 구조 설계와 DB 정규화의 중요성을 체감",
  "실시간 기능(경매·채팅)에서 동시성과 데이터 동기화 처리의 어려움을 경험 — 재고 검증은 애플리케이션 레벨 확인이라 DB 락이나 조건부 차감으로 보강할 여지가 있음",
  "배포 직후 자동화 봇의 무차별 접근을 겪으며 방화벽·SSH 보안 등 인프라 보안까지 고민하게 됨",
  "팀장으로서 기획·역할 분담부터 개발·배포까지 전 과정을 리드",
];

// ───────────────────────── 페이지 ─────────────────────────

export default function MimyoProject() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 font-mono text-sm text-[#8B84FF]">team project · 팀장</div>
      <h1 className="font-mono text-3xl font-bold text-white sm:text-4xl">MIMYO</h1>
      <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-white/60">
        실시간 경매와 작가–구매자 소통을 결합한 핸드메이드 커머스 플랫폼
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-xs">
        <span className="rounded-full border border-white/10 px-3 py-1 text-white/50">
          2025.03.31 – 2025.05.08
        </span>
        <LinkPill href="https://github.com/rjsah5676/MIMYO">GitHub ↗</LinkPill>
        <LinkPill href="https://drive.google.com/file/d/1ZVTpuval2WbT_x1n-3tOS7dhkpnCJQ8C/view">
          발표 자료 ↗
        </LinkPill>
      </div>

      <div className="mt-8">
        <Shot img={popularImg} alt="메인 — 인기 작품" />
      </div>

      <StatGrid stats={STATS} />

      <Section num="01" title="개요">
        <div className="flex flex-col gap-3 font-['Nanum_Gothic',sans-serif] text-sm leading-relaxed text-white/70">
          <p>
            대량 생산 제품과 차별화된 핸드메이드 상품을 거래하는 커머스 플랫폼입니다. 일반 판매에
            더해 <b className="text-white">실시간 경매</b>, 작가와 구매자의{" "}
            <b className="text-white">1:1 실시간 채팅</b>, 사용자 활동 기반{" "}
            <b className="text-white">상품 추천</b>을 제공하는 것을 목표로 했습니다.
          </p>
          <p>
            6인 팀의 팀장으로 기획·역할 분담·DB 설계·Git 브랜치 운영을 맡았고, 주문·결제·경매·인증
            등 핵심 도메인 대부분을 직접 구현한 뒤 Naver Cloud에 HTTPS로 배포했습니다.
          </p>
        </div>
      </Section>

      <Section num="02" title="기술 스택">
        <StackTable rows={STACK} />
      </Section>

      <Section num="03" title="아키텍처">
        <div className="rounded-xl border border-white/10 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
            <FlowBox title="Browser" sub="React · Redux" />
            <Arrow />
            <div className="flex flex-col gap-2">
              <FlowBox title="Nginx" sub="HTTPS · 리버스 프록시" accent />
              <div className="grid grid-cols-2 gap-2">
                <FlowBox title="React 정적 파일" />
                <FlowBox title="Spring Boot API" sub="REST · STOMP" />
              </div>
            </div>
            <Arrow />
            <div className="flex flex-col gap-2">
              <FlowBox title="MySQL" />
              <FlowBox title="Toss · OAuth · Mail" sub="외부 API" />
            </div>
          </div>
          <p className="mt-4 font-['Nanum_Gothic',sans-serif] text-xs leading-relaxed text-white/45">
            Naver Cloud Ubuntu 인스턴스 1대 · Let&apos;s Encrypt 인증서 자동 갱신 · HTTP → HTTPS
            리다이렉트
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
        </div>
      </Section>

      <Section num="06" title="DB 설계">
        <Shot img={erdImg} alt="ERD" />
        <div className="mt-4">
          <Bullets
            items={[
              "상품 – 옵션(대분류) – 옵션 카테고리(소분류) 구조로 옵션 조합별 재고 관리",
              "주문 그룹 – 주문 – 주문 옵션 구조로 상품 구조와 대응시켜 주문·판매 내역을 세부 단위로 조회",
              "주문 그룹 상태: 결제 전·결제 취소·결제 환불·부분 환불·부분 취소 / 주문 상태: 결제 완료·배송 전·배송 중·배송 완료·판매자 취소·구매자 취소·환불·정산 완료",
            ]}
          />
        </div>
      </Section>

      <Section num="07" title="트러블슈팅">
        <TroubleList items={TROUBLES} />
      </Section>

      <Section num="08" title="회고">
        <Bullets items={RETRO} />
      </Section>
    </div>
  );
}
