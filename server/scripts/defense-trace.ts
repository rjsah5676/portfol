/**
 * 픽셀 글리치 디펜스 한 판 추적 — 봇 한 판을 돌리며 웨이브마다(또는 보스전 3초마다) 상태를 찍음. 밸런스 원인 찾기용.
 *
 *   npx tsx scripts/defense-trace.ts                 균형 봇 · 시드 1000
 *   npx tsx scripts/defense-trace.ts -b 마도회 --seed 7
 */
import { botByName, botTurn } from "../../web/src/lib/defense/bot";
import { TPS } from "../../web/src/lib/defense/balance";
import { BOSSES } from "../../web/src/lib/defense/enemies";
import { newGame, step, unitCount } from "../../web/src/lib/defense/sim";
import { GRADE_NAME, UNIT } from "../../web/src/lib/defense/units";

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const cfg = botByName(opt("-b") ?? "균형");
const g = newGame(Number(opt("--seed") ?? 1000), 1);
const b = g.boards[0];
let lastWave = -1;
while (!g.over) {
  for (const c of botTurn(g, 0, cfg)) if (c.t !== "summon" && c.t !== "up") console.log(`  t${g.tick} ${JSON.stringify(c)}`);
  step(g);
  if (b.wave !== lastWave) {
    lastWave = b.wave;
    const best = b.cells.reduce((m, c) => (c.def ? Math.max(m, UNIT[c.def].grade) : m), 0);
    console.log(
      `w${b.wave} ${(g.tick / TPS).toFixed(0)}s  적 ${b.enemies.length}  골드 ${b.gold}  행운석 ${b.stones}  유닛 ${unitCount(b)}  최고 ${GRADE_NAME[best]}  강화 ${b.up.knight}/${b.up.mech}/${b.up.arcane}  확률 ${b.luck}`
    );
  }
  if (b.phase === "boss" && g.tick % (TPS * 3) === 0) {
    const boss = b.enemies.find((e) => e.boss >= 0);
    if (boss) console.log(`    ${BOSSES[boss.boss].name} ${Math.round(boss.hp)}/${Math.round(boss.max)}  남은 ${Math.round(b.bossT / TPS)}s  필드 ${b.enemies.length}`);
  }
}
console.log(b.result);
console.log(
  b.cells.map((c) => (c.def ? `${UNIT[c.def].name}×${c.units.length}` : "·")).join(" | ")
);
