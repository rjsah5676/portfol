import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 서버 모드로 실행 (next start). 글·방명록처럼 자주 바뀌는 페이지는 요청 때 서버에서 그림.
  // standalone: 실행에 필요한 파일만 .next/standalone 에 모아줌 → Docker 이미지를 작게.
  // Docker 빌드에서만 켬 (web/Dockerfile 이 NEXT_OUTPUT=standalone 지정). 로컬은 평소대로 npm run build → npm start
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // 레포 루트에도 package-lock.json 이 있어서, 이 폴더(web)를 기준으로 삼도록 고정
  outputFileTracingRoot: path.join(__dirname),
  // 미리보기 이미지를 그릴 때 읽는 글꼴 파일도 standalone 출력에 같이 넣음
  outputFileTracingIncludes: {
    "/og/[...path]": ["./assets/og/**/*"],
  },
  // /about 같은 주소를 /about/ 으로 통일 (정적 호스팅 시절부터 쓰던 주소 형태 유지)
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  // 게임 그림 · 소리 (public/ 기본은 max-age=0 → 들어올 때마다 파일마다 서버에 다시 물어봄, 느린 인터넷에서 로딩 화면이 길어짐).
  // 1시간은 그대로 쓰고, 그 뒤 7일까지는 갖고 있던 걸 바로 쓰면서 뒤에서 새로 받음 → 그림을 바꾸면 다음 방문부터 보임.
  // 배포(next start)에서만 — 로컬 개발 중엔 그림을 바꾸면 바로 보여야 하므로 기본값 그대로
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    return [
      {
        source: "/:dir(fight|poker|defense|rhythm|sketch)/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=604800" }],
      },
    ];
  },
  // 옮기거나 없앤 주소 → 지금 주소 (검색엔진에 남은 예전 링크용)
  async redirects() {
    return [
      { source: "/project", destination: "/portfolio/", permanent: true },
      { source: "/infoPage/2", destination: "/portfolio/", permanent: true },
      // 체스·장기·오목은 온라인 보드게임 한 페이지로 합침 (방·초대 링크 쿼리는 그대로 붙어 감)
      { source: "/games/chess", destination: "/games/board/?g=chess", permanent: true },
      { source: "/games/janggi", destination: "/games/board/?g=janggi", permanent: true },
      { source: "/games/omok", destination: "/games/board/?g=omok", permanent: true },
    ];
  },
  // Turbopack은 이미지/폰트 등만 기본으로 asset 처리하고 mp3 같은 오디오는
  // 모르기 때문에, melongame/minesweeper 등에서 쓰는 효과음 import를 위해 등록.
  turbopack: {
    root: path.join(__dirname),
    // 화면 확인용(POKER_E2E=1): Firebase 로그인을 가짜로 바꿔 끼움 (server/scripts/dev-fake.ts 와 짝)
    ...(process.env.POKER_E2E
      ? {
          resolveAlias: {
            "firebase/auth": "./src/dev/fakeFirebaseAuth.ts",
            "@/firebase": "./src/dev/fakeFirebase.ts",
          },
        }
      : {}),
    rules: {
      "*.mp3": {
        type: "asset",
      },
    },
  },
};

export default nextConfig;
