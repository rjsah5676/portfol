/* B02호 벽 4면 · 도입 컷 픽셀 그림. 좌표는 b02.tsx 의 핫스팟과 맞춰야 함 */
import { basementWindow, bevel, box, dither, lines, PAL, rect, roomBase, type G } from "./pixel";
import type { State } from "./types";

/** 북 · 현관: 신발장 [36,92,64,44] · 현관문 [128,38,64,98] · 도어락 [176,72,10,16] · 우산꽂이 [214,104,18,32] · 창 [240,16,56,26] */
export function paintNorth(g: G) {
  roomBase(g);
  basementWindow(g, 240, 16, 56, 26);
  // 현관문
  box(g, 124, 34, 72, 103, PAL.woodD);
  box(g, 128, 38, 64, 98, PAL.wood);
  bevel(g, 128, 38, 64, 98, PAL.woodL, PAL.woodD);
  box(g, 134, 46, 52, 34, PAL.woodL, PAL.woodD);
  box(g, 134, 86, 52, 42, PAL.woodL, PAL.woodD);
  rect(g, 182, 96, 7, 3, PAL.metalL);
  rect(g, 182, 99, 7, 1, PAL.metalD);
  // 도어락
  box(g, 176, 72, 10, 16, "#2c2f36");
  for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) rect(g, 178 + i * 4, 75 + j * 4, 2, 2, "#5f6b7a");
  // 현관 바닥 (타일) + 발매트
  rect(g, 112, 140, 96, 14, "#6b6a70");
  for (let x = 112; x < 208; x += 12) rect(g, x, 140, 1, 14, "#57565c");
  rect(g, 132, 146, 56, 6, "#7a2f2f");
  // 신발장
  box(g, 36, 92, 64, 44, "#8d7d64");
  bevel(g, 36, 92, 64, 44, "#a08f74", "#6e6150");
  rect(g, 67, 94, 1, 40, PAL.ink);
  rect(g, 62, 112, 3, 3, PAL.metalD);
  rect(g, 70, 112, 3, 3, PAL.metalD);
  // 신발장 위 화분 · 열쇠 접시(빈)
  rect(g, 42, 84, 8, 8, "#7a4a33");
  rect(g, 41, 78, 10, 6, "#4f7a46");
  rect(g, 78, 89, 14, 3, "#9aa0a8");
  // 우산꽂이
  box(g, 214, 112, 18, 24, "#4a5566");
  rect(g, 218, 98, 2, 16, "#1f6b8a");
  rect(g, 224, 102, 2, 12, "#8a2f4f");
  rect(g, 216, 96, 6, 3, "#1f6b8a");
  // 벽 스위치
  box(g, 108, 84, 6, 9, PAL.white);
}

/** 동 · 부엌: 냉장고 종이 [36,74,36,40] · 냉동실 [30,30,60,40] · 저금통 [248,82,20,14] · 찬장 [140,26,130,34] */
export function paintEast(g: G, s: State) {
  roomBase(g);
  // 냉장고
  box(g, 28, 28, 64, 109, PAL.white);
  bevel(g, 28, 28, 64, 109, "#eef0ec", PAL.whiteD);
  rect(g, 29, 70, 62, 1, PAL.whiteD);
  rect(g, 84, 40, 3, 22, PAL.metalD);
  rect(g, 84, 78, 3, 30, PAL.metalD);
  // 냉동실 문틈에 성에
  if (!s.flags.ice) dither(g, 32, 64, 40, 4, "#c9e3ee", 2);
  // 냉장고 문에 붙은 종이: 긴 출력물(출입 기록) + 노란 공지문 + 자석
  box(g, 38, 76, 16, 34, PAL.paper);
  lines(g, 40, 80, 12, 14, "#8b8678");
  box(g, 56, 78, 16, 20, PAL.paperY);
  lines(g, 58, 82, 12, 7, "#8b7b45");
  rect(g, 44, 75, 4, 3, PAL.red);
  rect(g, 62, 77, 4, 3, PAL.blue);
  // 싱크대 · 하부장
  box(g, 110, 96, 190, 41, "#8a8a92");
  rect(g, 111, 96, 188, 4, "#a3a4ab");
  for (let x = 116; x < 296; x += 45) {
    box(g, x, 104, 41, 31, "#9b9ca3");
    rect(g, x + 18, 108, 6, 2, PAL.metalD);
  }
  // 개수대 · 수도꼭지
  rect(g, 150, 96, 44, 3, "#6b6c73");
  rect(g, 170, 84, 3, 12, PAL.metalL);
  rect(g, 170, 84, 10, 3, PAL.metalL);
  // 찬장
  box(g, 140, 26, 130, 34, "#9b9ca3");
  for (let x = 140; x < 270; x += 43) rect(g, x, 27, 1, 32, "#7d7e85");
  // 냄비 · 컵
  rect(g, 206, 88, 18, 8, "#3f4148");
  rect(g, 232, 86, 6, 10, "#d7d0bf");
  // 돼지 저금통
  rect(g, 250, 85, 16, 10, PAL.pink);
  rect(g, 248, 88, 3, 4, PAL.pink);
  rect(g, 264, 86, 4, 4, "#e9a3b5");
  rect(g, 252, 95, 3, 2, "#b86a7f");
  rect(g, 261, 95, 3, 2, "#b86a7f");
  rect(g, 256, 85, 5, 1, PAL.ink);
  rect(g, 265, 87, 1, 1, PAL.ink);
}

/** 남 · 책상 · 침대: 시간표 [28,40,34,36] · 달력 [70,36,26,32] · 사진 [102,46,16,18] · 서랍 [70,100,44,14] · 콘센트 [20,118,8,8] · 노트북 [32,86,30,8] · 침대 밑 [160,126,140,12] · 침대 [160,92,140,34] */
export function paintSouth(g: G, s: State) {
  roomBase(g);
  basementWindow(g, 200, 16, 70, 24);
  // 벽 종이: 알바 시간표
  box(g, 28, 40, 34, 36, PAL.paper);
  rect(g, 30, 42, 30, 3, "#3d5a80");
  for (let j = 0; j < 6; j++) rect(g, 30, 48 + j * 4, 30, 1, "#b4ad9c");
  for (let i = 0; i < 5; i++) rect(g, 30 + i * 7, 46, 1, 28, "#b4ad9c");
  rect(g, 37, 54, 6, 10, "#f0b36a");
  rect(g, 51, 54, 6, 10, "#f0b36a");
  // 달력
  box(g, 70, 36, 26, 32, PAL.white);
  rect(g, 71, 37, 24, 5, PAL.red);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) rect(g, 72 + i * 4, 45 + j * 5, 2, 2, "#8c8f8a");
  rect(g, 75, 49, 4, 4, "#e05a4f");
  rect(g, 87, 59, 4, 4, "#4f86e0");
  // 찢긴 사진 액자
  box(g, 102, 46, 16, 18, "#3b2c22");
  rect(g, 104, 48, 12, 14, "#d9c7a8");
  rect(g, 105, 51, 4, 9, "#6b4c3b");
  rect(g, 110, 48, 1, 14, "#3b2c22");
  rect(g, 111, 50, 1, 2, "#3b2c22");
  // 책상
  rect(g, 20, 96, 100, 4, PAL.woodL);
  rect(g, 20, 100, 100, 2, PAL.woodD);
  rect(g, 22, 102, 4, 34, PAL.woodD);
  rect(g, 114, 102, 4, 34, PAL.woodD);
  box(g, 68, 100, 48, 16, PAL.wood);
  // 서랍 (자물쇠)
  if (s.flags.drawerOpen) {
    box(g, 70, 112, 44, 10, PAL.woodL);
    rect(g, 72, 113, 40, 4, "#3a2a1c");
  } else {
    box(g, 70, 102, 44, 12, PAL.woodL);
    rect(g, 88, 106, 8, 5, "#c9a227");
    rect(g, 90, 104, 4, 2, "#c9a227");
  }
  // 노트북 (닫힘) · 머그
  box(g, 32, 89, 30, 7, "#5a5f68");
  rect(g, 66, 89, 6, 7, "#c46a4a");
  // 콘센트 (충전기 없음)
  box(g, 20, 118, 8, 8, PAL.white);
  rect(g, 22, 121, 1, 2, PAL.ink);
  rect(g, 25, 121, 1, 2, PAL.ink);
  // 침대
  rect(g, 160, 104, 140, 22, "#5b4232");
  box(g, 160, 92, 140, 18, "#cfc8bb");
  rect(g, 186, 92, 114, 18, PAL.blue);
  dither(g, 186, 92, 114, 18, PAL.blueL, 4);
  box(g, 164, 88, 22, 10, PAL.white);
  rect(g, 296, 70, 6, 66, "#5b4232");
  // 침대 밑 어둠 (+ 끈 끄트머리)
  rect(g, 162, 126, 136, 10, "#1c1a1f");
  if (!s.flags.lace) rect(g, 230, 133, 5, 1, PAL.red);
}

/** 서 · 욕실 · 보일러실: 욕실 문 [18,38,64,98] · TV [118,66,74,42] · 리모컨 [176,104,14,5] · 편지 [124,104,18,6] · 보일러실 문 [226,38,58,98] · 키패드 [290,76,12,20] */
export function paintWest(g: G, s: State) {
  roomBase(g);
  // 욕실 문 (살짝 열림)
  box(g, 14, 34, 72, 103, "#c9c2b4");
  box(g, 18, 38, 64, 98, "#e2dccd");
  rect(g, 18, 38, 6, 98, "#262229");
  rect(g, 70, 88, 6, 3, PAL.metalL);
  box(g, 38, 50, 26, 10, "#9fb8c4");
  // TV 장 · TV
  box(g, 108, 108, 94, 29, PAL.wood);
  bevel(g, 108, 108, 94, 29, PAL.woodL, PAL.woodD);
  rect(g, 154, 110, 1, 25, PAL.woodD);
  box(g, 118, 66, 74, 42, "#202127");
  rect(g, 121, 69, 68, 34, "#15161b");
  dither(g, 121, 69, 68, 34, "#1d2027", 4);
  rect(g, 150, 106, 10, 2, "#202127");
  // 리모컨 · 군사우편 봉투
  box(g, 176, 104, 14, 5, "#2e3038");
  rect(g, 179, 105, 2, 1, PAL.red);
  box(g, 124, 103, 18, 7, "#e6dcc3");
  rect(g, 125, 104, 5, 2, "#3e6b45");
  // 보일러실 문 (철문)
  if (s.flags.boilerOpen) {
    box(g, 226, 38, 58, 98, "#0d0d10");
    rect(g, 230, 120, 50, 16, "#2a2b30");
    rect(g, 240, 60, 30, 3, "#6b6f78");
  } else {
    box(g, 226, 38, 58, 98, PAL.metal);
    bevel(g, 226, 38, 58, 98, PAL.metalL, PAL.metalD);
    rect(g, 232, 46, 46, 1, PAL.metalD);
    rect(g, 232, 126, 46, 1, PAL.metalD);
    rect(g, 274, 86, 6, 3, "#3d4047");
    box(g, 240, 52, 30, 9, "#d8d2c0");
    rect(g, 243, 55, 24, 2, "#6b5a3a");
  }
  // 키패드
  box(g, 290, 76, 12, 20, "#26282e");
  for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) rect(g, 292 + i * 3, 78 + j * 4, 2, 2, "#677382");
  rect(g, 292, 94, 8, 1, s.flags.boilerOpen ? "#5fd38a" : "#d35f5f");
}

/** 도입 컷: 열린 현관에 선 민규 (빨간 끈 운동화) */
export function paintIntro(g: G) {
  rect(g, 0, 0, 320, 180, "#1d1c22");
  // 바깥 계단 · 빛
  rect(g, 100, 10, 120, 150, "#7d8590");
  dither(g, 100, 10, 120, 150, "#8e96a1", 2);
  for (let y = 120; y < 160; y += 10) rect(g, 100, y, 120, 2, "#5f666f");
  // 문틀
  rect(g, 92, 6, 8, 160, PAL.woodD);
  rect(g, 220, 6, 8, 160, PAL.woodD);
  rect(g, 92, 2, 136, 8, PAL.woodD);
  // 민규 (후드티 · 청바지)
  rect(g, 146, 34, 28, 24, "#e2b58f"); // 얼굴
  rect(g, 144, 30, 32, 8, "#2a221d"); // 머리
  rect(g, 152, 44, 4, 2, PAL.ink);
  rect(g, 164, 44, 4, 2, PAL.ink);
  rect(g, 154, 52, 12, 2, "#9a5a4a"); // 웃는 입
  rect(g, 136, 58, 48, 46, "#5a6b4c"); // 후드티
  rect(g, 128, 62, 10, 36, "#5a6b4c");
  rect(g, 182, 62, 10, 36, "#5a6b4c");
  rect(g, 128, 96, 10, 8, "#e2b58f");
  rect(g, 182, 96, 10, 8, "#e2b58f");
  rect(g, 186, 98, 10, 3, PAL.metalL); // 손에 열쇠
  rect(g, 142, 104, 36, 40, "#3c4f78"); // 청바지
  rect(g, 159, 112, 2, 32, "#2c3c5e");
  // 운동화 (흰색 + 빨간 끈) — 단서
  rect(g, 136, 144, 22, 10, "#f2f2ee");
  rect(g, 162, 144, 22, 10, "#f2f2ee");
  rect(g, 136, 152, 22, 2, "#9a9a96");
  rect(g, 162, 152, 22, 2, "#9a9a96");
  for (let i = 0; i < 3; i++) {
    rect(g, 141 + i * 4, 146, 3, 1, PAL.red);
    rect(g, 167 + i * 4, 146, 3, 1, PAL.red);
  }
  rect(g, 152, 147, 2, 4, PAL.red);
  rect(g, 178, 147, 2, 4, PAL.red);
  // 실내 쪽 어둠
  rect(g, 0, 0, 92, 180, "#141318");
  rect(g, 228, 0, 92, 180, "#141318");
  rect(g, 0, 166, 320, 14, "#2a2830");
}
