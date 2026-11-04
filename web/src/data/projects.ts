import type { StaticImageData } from "next/image";
import mimyoImg from "@/img/Page/info/mimyo/mimyo_slide_1.jpg";
import airBoardImg from "@/img/Page/info/airboard/img_2.png";
import kickeatImg from "@/img/Page/info/kickeat/img_kickeat_1.jpg";
import artpartImg from "@/img/Page/info/artpart/slide_1.jpg";
import ohsoriImg from "@/img/Page/info/ohsori/landing.webp";
import devlifeImg from "@/img/Page/info/devlife/home.webp";
import bojImg from "@/img/Page/info/boj/categories.webp";
import beatdashImg from "@/img/Page/info/beatdash/title.webp";
import pixelfightImg from "@/img/Page/info/pixelfight/title.webp";
import yoriJoriImg from "@/img/Page/info/YoriJori.png";
import pokerImg from "@/img/Page/info/poker/title.webp";
import sketchImg from "@/img/Page/info/sketch/title.webp";
import defenseImg from "@/img/Page/info/defense/title.webp";
import loveImg from "@/img/menu/love.jpg";
import suspectImg from "@/img/menu/suspect.jpg";
import stockImg from "@/img/menu/stock.jpg";
import pixelmergeImg from "@/img/menu/pixelmerge.jpg";
import workDeliveryImg from "@/img/Page/info/work/work-delivery.webp";
import workPaymentImg from "@/img/Page/info/work/work-payment.webp";
import workSecurityImg from "@/img/Page/info/work/work-security.webp";
import workMsaImg from "@/img/Page/info/work/work-msa.webp";

export interface Project {
  /** 상세 페이지 주소: /infoPage/<idx> */
  idx: number;
  /** 짧은 이름 (포트폴리오 목록의 큰 글자) */
  name: string;
  /** 대표 화면 캡처 (목록 미리보기 · 공유 이미지) */
  imgLink: StaticImageData;
  title: string;
  desc: string;
  tech: string[];
  /** 만든 시기 */
  period: string;
  /** 맡은 자리 · 팀 규모 등 한마디 */
  role?: string;
  gitLink?: string;
  /** 바깥 링크 (운영 중인 사이트, 발표 자료 등)와 그 이름 */
  secondLink?: string;
  secondLabel?: string;
  /** 이 사이트 안에서 바로 해 볼 수 있는 주소 (게임) */
  playLink?: string;
}

export const teamProjects: Project[] = [
  {
    idx: 10,
    name: "MIMYO",
    imgLink: mimyoImg,
    gitLink: "https://github.com/rjsah5676/MIMYO",
    title: "커머스 핸드메이드 쇼핑몰 [MIMYO]",
    desc: "[실시간] [커뮤니케이션] [편의성]을 제공하는 핸드메이드 쇼핑몰",
    tech: ["React", "SpringBoot", "Redux", "WebSocket", "JPA"],
    period: "2025.03 – 2025.05",
    role: "팀장 · 6인",
    secondLink: "https://drive.google.com/file/d/1ZVTpuval2WbT_x1n-3tOS7dhkpnCJQ8C/view",
    secondLabel: "발표 자료",
  },
  {
    idx: 1,
    name: "AirBoard",
    imgLink: airBoardImg,
    gitLink: "https://github.com/rjsah5676/Capstone-Design-2021-1-",
    title: "캠 필기 웹 화상 회의 서비스 [AirBoard]",
    desc: "웹 캠을 통한 필기 기능을 제공하는 화상 회의 플랫폼입니다.",
    tech: ["Javascript", "WebRTC", "OpenCV", "NodeJS", "MongoDB"],
    period: "2021.03 – 2021.06",
    role: "캡스톤디자인",
    secondLink: "https://softcon.ajou.ac.kr/works/works_prev.asp?uid=421&wTerm=2021-1",
    secondLabel: "소프트콘",
  },
  {
    idx: 9,
    name: "KickEat",
    imgLink: kickeatImg,
    gitLink: "https://github.com/rjsah5676/KickEat",
    title: "당신을 위한 맛집 도우미 [KickEat]",
    desc: "서울시 음식점 검색 및 추천 사이트입니다.",
    tech: ["React", "Springboot", "JPA", "MySQL"],
    period: "2025.02",
  },
  {
    idx: 8,
    name: "ArtPart",
    imgLink: artpartImg,
    gitLink: "https://github.com/rjsah5676/ArtPart",
    title: "예술과 호텔의 만남 [ArtPart]",
    desc: "예술을 접할수 있는 호텔 사이트입니다.",
    tech: ["JSP", "Spring", "MyBatis", "MySQL"],
    period: "2025.02",
    role: "팀장",
  },
];

export const personalProjects: Project[] = [
  {
    idx: 11,
    name: "Oh! Sori",
    imgLink: ohsoriImg,
    gitLink: "https://github.com/rjsah5676/WooriBoard",
    title: "음성채팅 커뮤니티 [Oh! Sori]",
    desc: "실시간 채팅 음성채팅 제공 커뮤니티 사이트",
    tech: ["NextJS", "Express", "WebRTC", "TailWind", "MongoDB"],
    period: "2025.05 – 2025.07",
    secondLink: "https://ohsori.my/",
    secondLabel: "사이트",
  },
  {
    idx: 4,
    name: "Gunmo's Dev Life",
    imgLink: devlifeImg,
    title: "[Gunmo's Dev Life]",
    desc: "2021년부터 운영 중인 이 사이트(gunmo.my). 정적 사이트에서 Next.js 서버 + Express·MongoDB 백엔드로 옮겨 직접 서버에 올려 운영",
    tech: ["Next.js", "TypeScript", "Express", "socket.io", "MongoDB", "Docker"],
    period: "2021.07 – 운영 중",
    secondLink: "https://gunmo.my/",
    secondLabel: "사이트",
  },
  {
    idx: 5,
    name: "BAEKJOON",
    imgLink: bojImg,
    gitLink: "https://github.com/rjsah5676/ACMICPC",
    title: "알고리즘 [BAEKJOON Online Judge]",
    desc: "알고리즘을 배우기 위해 문제를 푼 사이트 입니다.",
    tech: ["C++", "Java", "Python"],
    period: "2016.06 –",
    secondLink: "https://solved.ac/profile/rjsah5676",
    secondLabel: "solved.ac",
  },
];

// 이 사이트에서 바로 해 볼 수 있는 게임 중 따로 소개할 만큼 큰 것
export const gameProjects: Project[] = [
  {
    idx: 12,
    name: "PIXEL Rhythm Up",
    imgLink: beatdashImg,
    title: "4키 리듬게임 [PIXEL Rhythm Up]",
    desc: "내 mp3를 넣으면 브라우저가 채보를 만들어 주는 4키 리듬게임. 곡·난이도별 랭킹",
    tech: ["TypeScript", "Web Audio API", "Canvas", "React"],
    period: "2026.09 –",
    playLink: "/games/rhythm/",
  },
  {
    idx: 13,
    name: "PIXEL FIGHT",
    imgLink: pixelfightImg,
    title: "1:1 플랫폼 격투 [PIXEL FIGHT]",
    desc: "캐릭터 6명, AI·2인·온라인 대전·랭크전(레이팅). 온라인은 롤백 넷코드로 지연을 숨김",
    tech: ["TypeScript", "Canvas", "WebRTC", "socket.io"],
    period: "2026.10 –",
    playLink: "/games/fight/",
  },
  {
    idx: 14,
    name: "ANIME POKER",
    imgLink: pokerImg,
    title: "홀덤 · 7포커 [ANIME POKER]",
    desc: "무료로 온라인 플레이하는 애니풍 포커. 캐릭터를 골라 홀덤 · 7포커를 실시간으로, PC · 모바일 지원",
    tech: ["TypeScript", "socket.io", "React", "MongoDB"],
    period: "2026.10 –",
    playLink: "/games/poker/",
  },
  {
    idx: 15,
    name: "DOODLE PARTY",
    imgLink: sketchImg,
    title: "그림 파티게임 [DOODLE PARTY]",
    desc: "최대 8명 실시간 그림 파티게임. 그림 맞히기 · 가짜 화가 · 그림 릴레이 3가지 모드, 스케치북 테마의 전용 게임 화면",
    tech: ["TypeScript", "Canvas", "socket.io", "React"],
    period: "2026.10 –",
    playLink: "/games/sketch/",
  },
  {
    idx: 16,
    name: "PIXEL LUCKY DEFENSE",
    imgLink: defenseImg,
    title: "운빨 랜덤 디펜스 [PIXEL LUCKY DEFENSE]",
    desc: "PIXEL FIGHT 외전. 수호자를 소환 · 합성해 60웨이브를 막는 랜덤 디펜스, 서버가 기록을 다시 돌려 검증하는 랭킹 · 최대 4명 멀티",
    tech: ["TypeScript", "Canvas", "socket.io", "Worker Threads"],
    period: "2026.10 –",
    playLink: "/games/defense/",
  },
  {
    idx: 17,
    name: "올인 러브",
    imgLink: loveImg,
    title: "ANIME POKER 외전 미연시 [올인 러브]",
    desc: "홀덤펍 딜러의 4주. 딜링 · 텔 읽기 · 각본 홀덤 미니게임, 히로인 셋 · 엔딩 수집 · 이벤트 CG",
    tech: ["TypeScript", "React", "대본 DSL", "ElevenLabs"],
    period: "2026.10 –",
    playLink: "/games/love/",
  },
  {
    idx: 18,
    name: "오늘의 용의자",
    imgLink: suspectImg,
    title: "하루 한 판 추리 퍼즐 [오늘의 용의자]",
    desc: "단서만으로 범인을 가려내는 데일리 퍼즐. 풀이기가 찍기 없이 끝까지 풀리는 판만 내고 난이도도 잼",
    tech: ["TypeScript", "React", "Web Worker", "MongoDB"],
    period: "2026.10 –",
    playLink: "/games/suspect/",
  },
  {
    idx: 19,
    name: "주식게임",
    imgLink: stockImg,
    title: "생성 차트 주식 대전 [주식게임]",
    desc: "차트 하나로 50턴 솔로 · 레버리지 코인 · 친구와 봇이 섞인 7분 실시간 대전. 모드별 차트 생성기와 사람처럼 매매하는 봇",
    tech: ["TypeScript", "Canvas", "socket.io", "MongoDB"],
    period: "2026.11 –",
    playLink: "/games/stock/",
  },
  {
    idx: 20,
    name: "픽셀 머지",
    imgLink: pixelmergeImg,
    title: "캐릭터 합치기 물리 퍼즐 [픽셀 머지]",
    desc: "PIXEL FIGHT 캐릭터 공을 떨어뜨려 합치고, 합칠 때마다 캐릭터 기술이 터지는 머지 퍼즐 · 오늘의 판 랭킹",
    tech: ["TypeScript", "React", "matter-js", "Canvas"],
    period: "2026.11 –",
    playLink: "/games/pixelmerge/",
  },
];

// 실무 (회사 이름 · 내부 코드 이름 없이)
export const workProjects: Project[] = [
  {
    idx: 21,
    name: "다중 배송지",
    imgLink: workDeliveryImg,
    title: "여러 배송지 주문 · 선물하기 [다중 배송지 V2]",
    desc: "한 주문을 여러 배송지로. 엑셀 일괄 등록 · 배송 가능 지역/지정일 검증 · 결제 전 배송 불가 검사, 선물하기 N:M 확장",
    tech: ["React", "TypeScript", "Java", "MyBatis", "Apache POI"],
    period: "2026.08",
    role: "실무 · 프론트 · 백엔드",
  },
  {
    idx: 22,
    name: "결제 · 장바구니",
    imgLink: workPaymentImg,
    title: "결제 · 장바구니 프론트엔드 [결제 · 장바구니]",
    desc: "결제 상태를 스토어 하나로, PG 세션 · 콜백 흐름 정리, 포인트 · 예치금 규칙, 장바구니 체크 동기화 큐, 쿠폰 최적 조합",
    tech: ["Next.js", "React", "TypeScript", "Zustand"],
    period: "2026.08",
    role: "실무 · 프론트엔드",
  },
  {
    idx: 23,
    name: "보안 · 권한",
    imgLink: workSecurityImg,
    title: "보안 · 인증 · 권한 [보안 · 권한]",
    desc: "저장형 XSS 허용 목록 정화, 로그인 실패 잠금, 휴대폰 본인인증(모놀리스 · MSA), 하드코딩 역할 체크 → 행위 단위 권한키",
    tech: ["Java", "Spring", "JSP", "Redis"],
    period: "2026.08",
    role: "실무 · 백엔드",
  },
  {
    idx: 24,
    name: "MSA 백엔드",
    imgLink: workMsaImg,
    title: "MSA 서비스 · 알림 · 이벤트 API [MSA 백엔드]",
    desc: "JWT 인증 전환, 다중 DataSource, 쿠버네티스 뒤의 URL, 알림 메시지 분할 발송, 레거시와 맞물린 이벤트 API",
    tech: ["Spring Boot", "JPA", "Feign", "Kubernetes"],
    period: "2026.08 – 2026.09",
    role: "실무 · 백엔드",
  },
];

/** 포트폴리오에 보이는 프로젝트 전부 */
export const allProjects: Project[] = [
  ...workProjects,
  ...teamProjects,
  ...personalProjects,
  ...gameProjects,
];

// 포트폴리오 목록에서는 뺐지만 상세 페이지는 남겨 둔 것 (아카이브·소개에서 링크)
const unlistedProjects: Project[] = [
  {
    idx: 3,
    name: "요리조리",
    imgLink: yoriJoriImg,
    gitLink: "https://github.com/rjsah5676/WebProject",
    title: "음식 레시피 공유 사이트 [요리조리]",
    desc: "음식 레시피를 공유하는 커뮤니티 웹 사이트입니다.",
    tech: ["React", "NodeJS", "Ajax", "JQuery", "MongoDB"],
    period: "2019.10 – 2019.12",
  },
];

/** 상세 페이지(/infoPage/<idx>)가 있는 프로젝트 전부 */
export const detailProjects: Project[] = [...allProjects, ...unlistedProjects];

export function getProjectByIdx(idx: number): Project | undefined {
  return detailProjects.find((p) => p.idx === idx);
}
