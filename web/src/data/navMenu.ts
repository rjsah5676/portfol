import type { StaticImageData } from "next/image";
import imgStudy from "@/img/menu/study.jpg";
import imgRetro from "@/img/menu/retro.jpg";
import imgMelongame from "@/img/menu/melongame.jpg";
import imgRspeed from "@/img/menu/rspeed.jpg";
import imgMine from "@/img/menu/mine.jpg";
import imgBoard from "@/img/menu/board.jpg";
import imgFight from "@/img/menu/fight.jpg";
import imgRhythm from "@/img/menu/rhythm.jpg";
import imgSketch from "@/img/menu/sketch.jpg";
import imgPoker from "@/img/menu/poker.jpg";
import imgVirus from "@/img/menu/virus.jpg";
import imgLadder from "@/img/menu/ladder.jpg";
import imgRoulette from "@/img/menu/roulette.jpg";
import imgCalorie from "@/img/menu/calorie.jpg";
import imgJson from "@/img/menu/json.jpg";
import imgDdlToJava from "@/img/menu/ddl-to-java.jpg";
import imgJsonToJava from "@/img/menu/json-to-java.jpg";
import imgMybatisLog from "@/img/menu/mybatis-log.jpg";
import imgRegex from "@/img/menu/regex.jpg";

// 상단 nav 메뉴 정의 — Nav 드롭다운과 대제목 클릭 시 나오는 목록(허브) 페이지가 같이 씀

export interface NavMenuItem {
  href: string;
  label: string;
  desc: string;
  icon: string;
  /** 목록 페이지 카드 썸네일 (각 페이지 화면 캡처) */
  image: StaticImageData;
  /** 메인에서 크게 보여 줄 항목 */
  featured?: boolean;
}

export interface NavGroup {
  key: string;
  /** nav에 보이는 이름 */
  label: string;
  /** 대제목 클릭 시 이동하는 목록 페이지 */
  href: string;
  title: string;
  desc: string;
  items: NavMenuItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    // 프로젝트 목록(포트폴리오)은 메뉴에서 빼서 푸터에 둠 — /portfolio
    key: "study",
    label: "study",
    href: "/works",
    title: "Study",
    desc: "공부하면서 정리한 개념과, 프로젝트에서 직접 겪고 배운 것들.",
    items: [
      {
        href: "/study",
        image: imgStudy,
        label: "개인 공부",
        desc: "면접 단골 개념을 교재처럼 정리",
        icon: "📚",
      },
      {
        href: "/retro",
        image: imgRetro,
        label: "프로젝트 회고",
        desc: "직접 겪은 문제와 해결, 배운 점",
        icon: "📝",
      },
    ],
  },
  {
    key: "games",
    label: "games",
    href: "/games",
    title: "Games",
    desc: "직접 만든 브라우저 게임. 대부분 랭킹이 있습니다.",
    items: [
      {
        href: "/games/rhythm",
        image: imgRhythm,
        label: "BEAT DASH",
        desc: "4키 리듬게임, 곡·난이도별 랭킹",
        icon: "🎹",
        featured: true,
      },
      {
        href: "/games/fight",
        image: imgFight,
        label: "PIXEL FIGHT",
        desc: "1:1 플랫폼 격투, AI 모드 · 2인 모드 · 온라인 모드",
        icon: "🥊",
        featured: true,
      },
      {
        href: "/games/poker",
        image: imgPoker,
        label: "ANIME POKER",
        desc: "애니풍 캐릭터와 즐기는 홀덤 · 7포커",
        icon: "♠",
        featured: true,
      },
      {
        href: "/games/sketch",
        image: imgSketch,
        label: "스케치 퀴즈",
        desc: "최대 8명, 한 명이 그리고 나머지가 맞히기",
        icon: "🎨",
        featured: true,
      },
      {
        href: "/games/virus",
        image: imgVirus,
        label: "바이러스 키우기",
        desc: "파일을 감염시키고 전설의 바이러스를 격퇴하는 방치형",
        icon: "👾",
      },
      {
        href: "/games/melongame",
        image: imgMelongame,
        label: "멜론 게임",
        desc: "합이 10·20이 되게 묶어 지우는 2분 타임어택",
        icon: "🍈",
      },
      {
        href: "/games/board",
        image: imgBoard,
        label: "온라인 보드게임",
        desc: "체스·장기·오목 한곳에서, 실시간 대국·관전·AI 랭킹전",
        icon: "♟️",
      },
      {
        href: "/games/mine",
        image: imgMine,
        label: "지뢰찾기",
        desc: "지뢰 99개 고급 난이도, 클리어 시간 랭킹",
        icon: "💣",
      },
      {
        href: "/games/rspeed",
        image: imgRspeed,
        label: "반응속도 테스트",
        desc: "파란색이 되는 순간 클릭, 5회 평균",
        icon: "⚡",
      },
    ],
  },
  {
    key: "tools",
    label: "tools",
    href: "/tools",
    title: "Tools",
    desc: "일상에서 가끔 필요한 작은 도구들.",
    items: [
      {
        href: "/tools/ladder",
        image: imgLadder,
        label: "사다리타기",
        desc: "참가자와 결과를 넣고 사다리 타기",
        icon: "🪜",
      },
      {
        href: "/tools/roulette",
        image: imgRoulette,
        label: "룰렛",
        desc: "항목을 넣고 돌려서 하나 고르기",
        icon: "🎯",
      },
      {
        href: "/tools/calorie",
        image: imgCalorie,
        label: "칼로리 계산기",
        desc: "식약처 데이터 기반 음식 칼로리",
        icon: "🍱",
      },
    ],
  },
  {
    key: "devtools",
    label: "devtools",
    href: "/devtools",
    title: "Dev Tools",
    desc: "실무에서 자주 쓰는 변환·정리 도구. 입력은 브라우저 밖으로 나가지 않습니다.",
    items: [
      {
        href: "/devtools/json",
        image: imgJson,
        label: "JSON Formatter",
        desc: "JSON 정렬·검증·압축",
        icon: "{ }",
      },
      {
        href: "/devtools/ddl-to-java",
        image: imgDdlToJava,
        label: "DDL → Java DTO",
        desc: "CREATE TABLE → DTO·resultMap·Mapper",
        icon: "🗄️",
      },
      {
        href: "/devtools/json-to-java",
        image: imgJsonToJava,
        label: "JSON → Java DTO",
        desc: "JSON 샘플로 DTO 클래스 생성",
        icon: "☕",
      },
      {
        href: "/devtools/mybatis-log",
        image: imgMybatisLog,
        label: "MyBatis 로그 → SQL",
        desc: "Preparing/Parameters 로그를 실행 SQL로",
        icon: "🧾",
      },
      {
        href: "/devtools/regex",
        image: imgRegex,
        label: "정규식 테스터",
        desc: "패턴 테스트·만들기·찾기/치환",
        icon: ".*",
      },
    ],
  },
];

export const getNavGroup = (key: string) => NAV_GROUPS.find((g) => g.key === key)!;
