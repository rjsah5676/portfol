import type { StaticImageData } from "next/image";
import airBoardImg from "@/img/Page/info/AirBoard.png";
import yoriJoriImg from "@/img/Page/info/YoriJori.png";
import logoImg from "@/img/Page/info/logo.png";
import taxImg from "@/img/Page/info/yctest/slide_1.jpg";
import acmicpcImg from "@/img/Page/info/acmicpc.png";
import artpartImg from "@/img/Page/info/artpart/artpart.jpg";
import kickeatImg from "@/img/Page/info/kickeat/img_kickeat_0.jpg";
import mimyoImg from "@/img/Page/info/mimyo/mimyo.jpg";
import wooriboardImg from "@/img/Page/info/wooriboard.jpg";

export interface Project {
  idx: number;
  imgLink: StaticImageData;
  gitLink: string;
  title: string;
  desc: string;
  tech: string[];
  secondLink?: string;
}

export const teamProjects: Project[] = [
  {
    idx: 10,
    imgLink: mimyoImg,
    gitLink: "https://github.com/rjsah5676/MIMYO",
    title: "커머스 핸드메이드 쇼핑몰 [MIMYO]",
    desc: "[실시간] [커뮤니케이션] [편의성]을 제공하는 핸드메이드 쇼핑몰",
    tech: ["React", "SpringBoot", "Redux", "WebSocket", "JPA"],
    secondLink: "https://drive.google.com/file/d/1ZVTpuval2WbT_x1n-3tOS7dhkpnCJQ8C/view",
  },
  {
    idx: 1,
    imgLink: airBoardImg,
    gitLink: "https://github.com/rjsah5676/Capstone-Design-2021-1-",
    title: "캠 필기 웹 화상 회의 서비스 [AirBoard]",
    desc: "웹 캠을 통한 필기 기능을 제공하는 화상 회의 플랫폼입니다.",
    tech: ["Javascript", "WebRTC", "OpenCV", "NodeJS", "MongoDB"],
    secondLink: "https://softcon.ajou.ac.kr/works/works_prev.asp?uid=421&wTerm=2021-1",
  },
  {
    idx: 9,
    imgLink: kickeatImg,
    gitLink: "https://github.com/rjsah5676/KickEat",
    title: "당신을 위한 맛집 도우미 [KickEat]",
    desc: "서울시 음식점 검색 및 추천 사이트입니다.",
    tech: ["React", "Springboot", "JPA", "MySQL"],
  },
  {
    idx: 8,
    imgLink: artpartImg,
    gitLink: "https://github.com/rjsah5676/ArtPart",
    title: "예술과 호텔의 만남 [ArtPart]",
    desc: "예술을 접할수 있는 호텔 사이트입니다.",
    tech: ["JSP", "Spring", "MyBatis", "MySQL"],
  },
  {
    idx: 2,
    imgLink: taxImg,
    gitLink: "https://github.com/rjsah5676/Tax-Investigation",
    title: "[영천시 세무조사 홈페이지]",
    desc: "세무 신고서 작성 및 조회기능을 제공하는 영천시 세무조사 웹 사이트 입니다.",
    tech: ["JSP", "JDBC", "JavaScript", "MySQL"],
  },
];

export const personalProjects: Project[] = [
  {
    idx: 11,
    imgLink: wooriboardImg,
    gitLink: "https://github.com/rjsah5676/WooriBoard",
    title: "음성채팅 커뮤니티 [Oh! Sori]",
    desc: "실시간 채팅 음성채팅 제공 커뮤니티 사이트",
    tech: ["NextJS", "Express", "WebRTC", "TailWind", "MongoDB"],
    secondLink: "https://ohsori.my/",
  },
  {
    idx: 4,
    imgLink: logoImg,
    gitLink: "https://github.com/rjsah5676/rjsah5676.github.io",
    title: "[Gunmo's Dev Life]",
    desc: "2021년부터 운영 중인 개인 포트폴리오 사이트. Next.js·TypeScript로 전면 리뉴얼",
    tech: ["Next.js", "TypeScript", "Tailwind", "Firebase"],
    secondLink: "https://rjsah5676.github.io/",
  },
  {
    idx: 5,
    imgLink: acmicpcImg,
    gitLink: "https://github.com/rjsah5676/ACMICPC",
    title: "알고리즘 [BAEKJOON Online Judge]",
    desc: "알고리즘을 배우기 위해 문제를 푼 사이트 입니다.",
    tech: ["C++", "Java", "Python"],
    secondLink: "https://solved.ac/profile/rjsah5676",
  },
  {
    idx: 3,
    imgLink: yoriJoriImg,
    gitLink: "https://github.com/rjsah5676/WebProject",
    title: "음식 레시피 공유 사이트 [요리조리]",
    desc: "음식 레시피를 공유하는 커뮤니티 웹 사이트입니다.",
    tech: ["React", "NodeJS", "Ajax", "JQuery", "MongoDB"],
  },
];

export const allProjects: Project[] = [...teamProjects, ...personalProjects];

export function getProjectByIdx(idx: number): Project | undefined {
  return allProjects.find((p) => p.idx === idx);
}
