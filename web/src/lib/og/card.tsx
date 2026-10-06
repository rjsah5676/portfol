import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { SITE_HOST, SITE_NAME } from "@/lib/seo";

/*
 * 링크 공유 미리보기 이미지(1200x630)를 페이지 제목·설명으로 그려냄.
 * 페이지마다 다른 이미지가 나가게 하려는 것 — 주소는 /og/<페이지 경로>.png (app/og/[...path]/route.ts)
 * 글꼴은 web/assets/og 의 파일을 씀 (한글 전체 포함. 라이선스 파일 같이 있음).
 */

export const OG_SIZE = { width: 1200, height: 630 };

interface Section {
  /** 좌상단에 "// label" 로 표시 */
  label: string;
  accent: string;
}

/** 페이지 경로의 첫 마디로 구역을 정함 (구역마다 강조색이 다름) */
const SECTIONS: Record<string, Section> = {
  "": { label: "fullstack developer", accent: "#8B84FF" },
  about: { label: "about", accent: "#8B84FF" },
  portfolio: { label: "portfolio", accent: "#8B84FF" },
  infoPage: { label: "portfolio", accent: "#8B84FF" },
  works: { label: "study", accent: "#8B84FF" },
  archive: { label: "archive", accent: "#8B84FF" },
  study: { label: "study note", accent: "#8B84FF" },
  retro: { label: "retrospective", accent: "#2DD4BF" },
  games: { label: "games", accent: "#F472B6" },
  tools: { label: "tools", accent: "#FBBF24" },
  devtools: { label: "dev tools", accent: "#38BDF8" },
  guest: { label: "guestbook", accent: "#A78BFA" },
};
export const sectionOfPath = (path: string): Section =>
  SECTIONS[path.split("/").filter(Boolean)[0] ?? ""] ?? SECTIONS[""];

let fonts: Promise<
  { name: string; data: Buffer; weight: 400 | 500 | 700; style: "normal" }[]
> | null = null;
function loadFonts() {
  const dir = join(process.cwd(), "assets/og");
  fonts ??= Promise.all([
    readFile(join(dir, "Pretendard-Bold.otf")),
    readFile(join(dir, "Pretendard-Regular.otf")),
    readFile(join(dir, "JetBrainsMono-Medium.woff")),
  ]).then(([bold, regular, mono]) => [
    { name: "Pretendard", data: bold, weight: 700 as const, style: "normal" as const },
    { name: "Pretendard", data: regular, weight: 400 as const, style: "normal" as const },
    { name: "JetBrains Mono", data: mono, weight: 500 as const, style: "normal" as const },
  ]);
  // 읽기에 실패하면 다음 요청에서 다시 시도
  fonts.catch(() => (fonts = null));
  return fonts;
}

// 이모지는 글꼴에 없어서(외부에서 받아오게 됨) 빼고 그림
const stripEmoji = (s: string) =>
  s
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/** 글자 너비 어림: 한글·한자 등 전각 = 1, 영문·숫자·기호 = 0.56 */
const widthOf = (ch: string) => (ch.charCodeAt(0) > 0x2e7f ? 1 : 0.56);
const textWidth = (s: string) => [...s].reduce((n, ch) => n + widthOf(ch), 0);
/** 너비(전각 글자 수 기준)가 max를 넘으면 잘라서 … 붙임 */
function clip(s: string, max: number): string {
  if (textWidth(s) <= max) return s;
  let w = 0;
  let out = "";
  for (const ch of s) {
    w += widthOf(ch);
    if (w > max - 1) break;
    out += ch;
  }
  return out.trimEnd() + "…";
}

export interface CardInput {
  /** 페이지 제목 (사이트 이름 제외) */
  title: string;
  description?: string;
  /** 페이지 경로 ("/games/chess/") — 구역 표시·강조색 결정 */
  path: string;
}

export async function renderCard({ title, description, path }: CardInput): Promise<ArrayBuffer> {
  const { label, accent } = sectionOfPath(path);
  const home = path === "/";
  const t = clip(stripEmoji(title) || SITE_NAME, 52);
  // 설명은 두 줄(한 줄에 전각 34자쯤)에 들어올 만큼만
  const d = clip(stripEmoji(description ?? ""), 64);
  // 제목이 길수록 작게 (세 줄 안에 들어오게)
  const tw = textWidth(t);
  const titleSize = tw <= 11 ? 96 : tw <= 16 ? 84 : tw <= 26 ? 70 : tw <= 38 ? 60 : 52;

  const res = new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        backgroundColor: "#111214",
        padding: "60px 76px 56px 86px",
        fontFamily: "Pretendard",
      }}
    >
      {/* 구역 색: 오른쪽 위 은은한 빛 + 왼쪽 띠 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          backgroundImage: `radial-gradient(circle at 86% 8%, ${accent}3d 0%, ${accent}14 30%, ${accent}00 55%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 12,
          height: "100%",
          backgroundColor: accent,
        }}
      />
      <div style={{ display: "flex", fontFamily: "JetBrains Mono", fontSize: 30, color: accent }}>
        {`// ${label}`}
      </div>
      <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center" }}>
        <div
          style={{
            display: "block",
            lineClamp: 3,
            fontSize: titleSize,
            fontWeight: 700,
            color: "#FFFFFF",
            lineHeight: 1.22,
            letterSpacing: "-0.02em",
            wordBreak: "keep-all",
          }}
        >
          {t}
        </div>
        {d && (
          <div
            style={{
              display: "block",
              lineClamp: 2,
              marginTop: 26,
              fontSize: 30,
              fontWeight: 400,
              color: "#9BA1AC",
              lineHeight: 1.5,
              wordBreak: "keep-all",
            }}
          >
            {d}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {/* 홈은 제목이 곧 사이트 이름이라 아래에는 주소만 */}
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#FFFFFF" }}>
          {home ? "" : SITE_NAME}
        </div>
        <div
          style={{ display: "flex", fontFamily: "JetBrains Mono", fontSize: 26, color: "#6B7280" }}
        >
          {SITE_HOST}
        </div>
      </div>
    </div>,
    { ...OG_SIZE, fonts: await loadFonts() }
  );
  return res.arrayBuffer();
}
