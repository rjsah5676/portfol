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
  // 옮기거나 없앤 주소 → 지금 주소 (검색엔진에 남은 예전 링크용)
  async redirects() {
    return [
      { source: "/project", destination: "/portfolio/", permanent: true },
      { source: "/infoPage/2", destination: "/portfolio/", permanent: true },
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
