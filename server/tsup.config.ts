import { defineConfig } from "tsup";

// 서버 소스 + web/src/lib의 순수 게임 엔진(장기·오목)을 한 파일로 묶음. node_modules는 그대로 둠(런타임에 설치된 것 사용).
export default defineConfig({
  // fightSim.worker = 픽셀파이트 AI 시뮬레이션 작업 스레드 (games/fightSim.ts 가 dist/fightSim.worker.js 로 띄움)
  entry: {
    index: "src/index.ts",
    "fightSim.worker": "src/games/fightSim.worker.ts",
    // 글리치 디펜스 랭킹 기록 검증 (games/defense.ts 가 dist/defenseVerify.worker.js 로 띄움)
    "defenseVerify.worker": "src/games/defenseVerify.worker.ts",
  },
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: false,
});
