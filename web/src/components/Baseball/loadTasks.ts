/**
 * 야구 로딩 화면(GameLoader)에 넘길 할 일 — M1 은 격투게임 그림(얼굴 · 컷인)과 글꼴만.
 * 새 그림 · 소리를 넣으면 여기에도 추가할 것.
 */
import { CHARS, cutinUrl, faceUrl } from "@/lib/baseball/data";
import { keyed, type LoadTask } from "@/lib/preload";

const FONTS = ['16px "Black Han Sans"', '16px "Jua"', '700 16px "JetBrains Mono"', '800 16px "JetBrains Mono"', '700 16px "Nanum Gothic"', '800 16px "Nanum Gothic"'];
const FONT_TEXT = "픽셀 프로야구 나만의 리그 훈련 휴식 외출 상점 은퇴 스트라이크 볼 파울 헛스윙 삼진 안타 홈런 2루타 3루타 아웃 득점 0123456789 km/h 마구 필살타법 미션";
const fontsTask = keyed("baseball:fonts", () =>
  typeof document === "undefined" || !document.fonts
    ? Promise.resolve()
    : Promise.all(FONTS.map((f) => document.fonts.load(f, FONT_TEXT).catch(() => null)))
);

export function baseballTasks(): LoadTask[] {
  const t: LoadTask[] = [];
  for (const c of CHARS) t.push(faceUrl(c.id), cutinUrl(c.id), `/fight/art/${c.id}.webp`);
  t.push(fontsTask);
  return t;
}
