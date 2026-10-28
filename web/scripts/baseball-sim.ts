/**
 * 야구 밸런스 시뮬: npx tsx scripts/baseball-sim.ts [경기 수] [난이도 0~2] [사람 타이밍 표준편차 ms]
 * 봇 대 봇 경기를 돌려 타율 · 출루율 · 장타율 · 홈런 · 삼진 · 볼넷 · 경기당 득점,
 * 그리고 "사람" 타자(타이밍 σ)가 봇 투수를 상대할 때 같은 지표를 냄.
 */
import { cpuGauge, cpuPlan, cpuSwing, cpuUseSpecial, humanSwing, SPEED_SCALE, type Diff } from "../src/lib/baseball/ai";
import { CHARS, TEAM_DEFS, makeTeam } from "../src/lib/baseball/data";
import { batSide, batter, cpuManage, fieldSide, newGame, nextHalf, pitcher, stamina01, type GameState } from "../src/lib/baseball/game";
import { makePitch } from "../src/lib/baseball/pitch";
import { commit, evaluate } from "../src/lib/baseball/resolve";
import { makeRng } from "../src/lib/baseball/rng";

const N = Number(process.argv[2] ?? 200);
const diff = Number(process.argv[3] ?? 1) as Diff;
const humanSigma = Number(process.argv[4] ?? 0) / 1000;

const rng = makeRng(12345);
const tot = { pa: 0, ab: 0, h: 0, hr: 0, bb: 0, k: 0, tb: 0, runs: 0, games: 0, pitches: 0, d2: 0, d3: 0, dp: 0, specialPitch: 0, specialHit: 0 };
const results: Record<string, number> = {};
const labels: Record<string, number> = {};
let hbpN = 0;

function play(s: GameState, humanSide: number) {
  let guard = 0;
  while (!s.over && guard++ < 5000) {
    cpuManage(s, fieldSide(s));
    const fs = s.sides[fieldSide(s)];
    const p = pitcher(s);
    const plan = cpuPlan(p, s.balls, s.strikes, batter(s).bats, rng);
    const risp = s.bases[1] !== null || s.bases[2] !== null;
    const useSp = p.special && cpuUseSpecial(fs.ballLeft, s.inning, s.strikes, risp, rng);
    if (useSp) fs.ballLeft--;
    const pitch = makePitch(p, { kind: plan.kind, target: plan.target, quality: cpuGauge(diff, rng), special: useSp ? p.special : undefined }, SPEED_SCALE[diff], rng, stamina01(s));
    const fbDur = 17 / (p.velo / 3.6) / SPEED_SCALE[diff];
    const b = batter(s);
    const at = { x: pitch.target.x, y: pitch.target.y };
    const human = batSide(s) === humanSide;
    const d = human ? humanSwing(pitch, at, s.strikes, humanSigma, rng) : cpuSwing(b, pitch, at, s.strikes, s.balls, diff, rng, fbDur);
    const o = evaluate(s, pitch, d, rng);
    tot.pitches++;
    if (o.call === "hbp" && (human || humanSide < 0)) hbpN++;
    if (useSp) tot.specialPitch++;
    if (useSp && o.call === "bip" && o.field && /HR|1B|2B|3B/.test(o.field.result)) tot.specialHit++;
    if (o.field && !o.field.foul) { results[o.field.result] = (results[o.field.result] ?? 0) + 1; const lb = o.field.label.replace(/^(투수|포수|1루수|2루수|3루수|유격수) (라이너|팝플라이|플라이)$/, "내야 $2").replace(/^(좌익수|중견수|우익수) (라이너|팝플라이|플라이)$/, "외야 $2").replace(/^.* 땅볼$/, "땅볼").replace(/^.* (안타|2루타|3루타)$/, "$1"); labels[lb] = (labels[lb] ?? 0) + 1; }
    const pa = commit(s, o);
    if (pa) {
      if (human || humanSide < 0) {
        tot.pa++;
        if (pa.kind === "BB") tot.bb++;
        else if (pa.kind !== "SAC") tot.ab++;
        if (pa.kind === "K") tot.k++;
        if (pa.kind === "HIT" || pa.kind === "HR") {
          tot.h++;
          const tb = pa.kind === "HR" ? 4 : /3루타/.test(pa.text) ? 3 : /2루타/.test(pa.text) ? 2 : 1;
          tot.tb += tb;
          if (tb === 2) tot.d2++;
          if (tb === 3) tot.d3++;
        }
        if (pa.kind === "HR") tot.hr++;
        if (pa.kind === "DP") tot.dp++;
      }
      if (pa.halfOver && !s.over) nextHalf(s);
    }
  }
}

for (let g = 0; g < N; g++) {
  const a = TEAM_DEFS[g % 4];
  const h = TEAM_DEFS[(g + 1) % 4];
  const c1 = CHARS[g % 8].id;
  const c2 = CHARS[(g + 3) % 8].id;
  const s = newGame({
    innings: 9,
    diff,
    userHome: true,
    away: makeTeam(a, rng, { bat: c1, pit: c2 }),
    home: makeTeam(h, rng, { bat: c2, pit: c1 }),
  });
  play(s, humanSigma > 0 ? 1 : -1);
  tot.games++;
  tot.runs += humanSigma > 0 ? s.score[1] : s.score[0] + s.score[1];
}

const f = (n: number) => n.toFixed(3).replace(/^0/, "");
const obp = (tot.h + tot.bb) / tot.pa;
console.log(`${N}경기 · 난이도 ${diff}${humanSigma ? ` · 사람 σ ${humanSigma * 1000}ms` : " · 봇 대 봇"}`);
console.log(`타율 ${f(tot.h / tot.ab)}  출루율 ${f(obp)}  장타율 ${f(tot.tb / tot.ab)}`);
console.log(`홈런/타석 ${(tot.hr / tot.pa * 100).toFixed(1)}%  2루타 ${tot.d2} 3루타 ${tot.d3}  삼진 ${(tot.k / tot.pa * 100).toFixed(1)}%  볼넷 ${(tot.bb / tot.pa * 100).toFixed(1)}%  병살 ${tot.dp}`);
console.log(`경기당 득점 ${(tot.runs / tot.games).toFixed(2)} (${humanSigma ? "사람 팀" : "양 팀 합"})  경기당 공 ${(tot.pitches / tot.games).toFixed(0)}`);
console.log(`마구 ${tot.specialPitch}개 중 안타 ${tot.specialHit}`);
console.log("인플레이 결과:", results);
const lt = Object.values(labels).reduce((a, b) => a + b, 0);
console.log("타구 결과 (%):", Object.entries(labels).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${k} ${(v / lt * 100).toFixed(1)}`).join(" · "));
console.log(`사구/타석 ${(hbpN / tot.pa * 100).toFixed(2)}%`);
