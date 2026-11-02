/** 주식게임 전용 돈 규칙 · 표시 (서버도 이 파일을 그대로 import) */

/** 처음 시작 자금 */
export const START_CASH = 100_000_000;
/** 판이 끝났을 때 총자산이 이보다 적으면 회생 */
export const REVIVE_UNDER = 5_000_000;
/** 회생하면 현금을 이만큼으로 */
export const REVIVE_TO = 10_000_000;

const EOK = 100_000_000;
const MAN = 10_000;
const comma = (n: number) => n.toLocaleString("ko-KR");

/** 1억 2,340만 5,678 (빠짐없이) */
export function fmtWon(won: number): string {
  const neg = won < 0;
  let n = Math.abs(Math.round(won));
  if (n === 0) return "0";
  const eok = Math.floor(n / EOK);
  n -= eok * EOK;
  const man = Math.floor(n / MAN);
  const rest = n - man * MAN;
  const parts: string[] = [];
  if (eok) parts.push(`${comma(eok)}억`);
  if (man) parts.push(`${comma(man)}만`);
  if (rest || !parts.length) parts.push(comma(rest));
  return (neg ? "-" : "") + parts.join(" ");
}

/** 1억 2,340만 (만 아래는 버림) */
export function fmtEok(won: number): string {
  const neg = won < 0 ? "-" : "";
  const n = Math.abs(Math.round(won));
  const eok = Math.floor(n / EOK);
  const man = Math.floor((n - eok * EOK) / MAN);
  if (!eok) return man ? `${neg}${comma(man)}만` : neg + comma(n);
  return `${neg}${comma(eok)}억${man ? ` ${comma(man)}만` : ""}`;
}
