import { defineConfig, globalIgnores } from "eslint/config";
import nextConfig from "eslint-config-next";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextConfig,
  prettier,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
  {
    rules: {
      // 이 프로젝트는 <img> 태그를 곳곳에서 그대로 씀 (next/image 전환은 별개 작업) - 경고 끔
      "@next/next/no-img-element": "off",
      // 한국어/영어 텍스트에 따옴표/아포스트로피가 자주 섞여있어서 꺼둠
      "react/no-unescaped-entities": "off",
      // 미사용 변수/import는 경고로만 (막지는 않음)
      "no-unused-vars": "warn",
      // 의존성 배열 관련도 경고로만 - 게임/캔버스 코드처럼 의도적으로 빼는 경우가 많음
      "react-hooks/exhaustive-deps": "warn",
      // eslint-plugin-react-hooks v7의 React Compiler 대비용 신규 규칙들 -
      // 캔버스/게임 코드처럼 의도적으로 명령형인 부분이 많아서 error 대신 warn으로
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    // TS는 기본 규칙이 함수 타입의 매개변수 이름까지 잡아서 TS 버전으로 대체 (플러그인이 TS 파일에만 등록돼 있음)
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;
