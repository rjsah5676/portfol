/**
 * 격투 밸런스 시뮬레이션 — AI끼리 리그전을 돌려 승률표를 뽑는다.
 *
 *   npx tsx scripts/fight-balance.ts [판수=6] [AI단계=5] [--restrict]
 *
 *  - 캐릭터마다 모든 상대와 좌·우 자리를 바꿔 가며 판수만큼 (시드 다름)
 *  - 출력: 승률표(행 = 캐릭터, 열 = 상대), 캐릭터별 전체 승률, 평균 경기 시간,
 *          기술별 피해 비중(그 캐릭터의 장점이 실제로 드러나는지)
 *  - --restrict: '제한 플레이'(Jaffe 2012) — 소영이 긴 사거리 기술(H·S)을 못 쓰게 막고 승률이
 *    얼마나 떨어지는지 → 사거리가 실제 강점인지 측정
 */
import { CHARS } from "../src/lib/fight/chars";
import { AI_LEVELS, FightAI } from "../src/lib/fight/ai";
import { IN, newMatch, step } from "../src/lib/fight/sim";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const GAMES = Number(args[0] ?? 6);
const LEVEL = Number(args[1] ?? 5) - 1;
const RESTRICT = process.argv.includes("--restrict");
const MAX_F = 60 * 60 * 8;
const n = CHARS.length;

type Row = { wins: number; games: number; frames: number; dmg: Record<string, number> };
const stat: Row[] = CHARS.map(() => ({ wins: 0, games: 0, frames: 0, dmg: {} }));
const matrix = Array.from({ length: n }, () => Array(n).fill(0) as number[]);
const played = Array.from({ length: n }, () => Array(n).fill(0) as number[]);

function play(a0: number, b0: number, seed: number, restrictA = false) {
  const s = newMatch([a0, b0], 0);
  const a = new FightAI(AI_LEVELS[LEVEL], seed * 7919 + 1);
  const b = new FightAI(AI_LEVELS[LEVEL], seed * 104729 + 99);
  let k = 0;
  while (s.phase !== "over" && k < MAX_F) {
    let ia = a.next(s, 0);
    if (restrictA) ia &= ~(IN.B | IN.C); // 발차기·아이덴티티 금지
    step(s, [ia, b.next(s, 1)]);
    for (const e of s.ev)
      if (e.k === "hit" || e.k === "throw") {
        const ch = s.p[e.p].ch;
        const key = e.m ?? "?";
        stat[ch].dmg[key] = (stat[ch].dmg[key] ?? 0) + e.v;
      }
    k++;
  }
  return { winner: s.winner, frames: k };
}

if (!RESTRICT) {
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      for (let g = 0; g < GAMES; g++) {
        const { winner, frames } = play(i, j, g * 31 + i * 7 + j * 13);
        played[i][j]++;
        stat[i].games++;
        stat[j].games++;
        stat[i].frames += frames;
        stat[j].frames += frames;
        if (winner === 0) {
          matrix[i][j]++;
          stat[i].wins++;
        } else if (winner === 1) stat[j].wins++;
      }
    }
  const name = (i: number) => CHARS[i].name.padEnd(4, " ");
  console.log(`AI ${AI_LEVELS[LEVEL].name} · ${GAMES}판씩 (행이 1P 자리에서 열을 상대로 이긴 비율)`);
  console.log("      " + CHARS.map((c) => c.name.padStart(6)).join(""));
  for (let i = 0; i < n; i++) {
    const cells = CHARS.map((_, j) =>
      i === j ? "   -  " : `${Math.round((100 * matrix[i][j]) / played[i][j])}%`.padStart(6)
    );
    console.log(name(i) + "  " + cells.join(""));
  }
  console.log("\n전체 승률 / 평균 경기 시간");
  for (let i = 0; i < n; i++) {
    const r = stat[i];
    console.log(
      `${name(i)} ${Math.round((100 * r.wins) / r.games)}%  ${(r.frames / r.games / 60).toFixed(0)}초  ` +
        Object.entries(r.dmg)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k}:${Math.round((100 * v) / Object.values(r.dmg).reduce((x, y) => x + y, 0))}%`)
          .join(" ")
    );
  }
} else {
  // 제한 플레이: 소영(인덱스 찾기)이 H·S 없이 싸우면?
  const so = CHARS.findIndex((c) => c.id === "soyoung");
  for (const restrict of [false, true]) {
    let w = 0,
      g = 0;
    for (let j = 0; j < n; j++) {
      if (j === so) continue;
      for (let k = 0; k < GAMES; k++) {
        const { winner } = play(so, j, k * 17 + j * 5, restrict);
        g++;
        if (winner === 0) w++;
      }
    }
    console.log(`소영 ${restrict ? "발차기·채찍 금지" : "제한 없음"}: ${Math.round((100 * w) / g)}% (${w}/${g})`);
  }
}
