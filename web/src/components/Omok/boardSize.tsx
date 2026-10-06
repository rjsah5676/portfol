/**
 * 오목판 표시 폭 — 줄 수(15·19)에 맞춰서 (19줄은 칸이 많아 더 넓게). 화면 높이가 모자라면 그만큼 줄어듦.
 * (예전 '판 크기 작게·보통·크게'는 뺌 — 둘 자리를 늘리는 건 판 줄 수 고르기로)
 */
const PX: Record<number, number> = { 15: 600, 19: 760 };

/** 판을 감싸는 칸의 최대 폭 (heightGap: 화면 높이에서 판 위아래 막대·헤더 몫으로 뺄 px) */
export const boardMaxWidth = (n: number, heightGap: number) =>
  `max(300px, min(${PX[n] ?? 600}px, calc(100dvh - ${heightGap}px)))`;
