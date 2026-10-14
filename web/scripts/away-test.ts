import { createAwaySim, newSave, parseSave, type Save } from "../src/lib/virus/logic";

function run(label: string, base: Save, secs: number, power = 1) {
  const before = JSON.stringify(base);
  const sim = createAwaySim(base, secs, power);
  const t0 = Date.now();
  let n = 0;
  while (!sim.advance(12)) n++;
  const r = sim.finish();
  const rep = r.report;
  const bad = Object.entries(rep).filter(([, v]) =>
    Array.isArray(v) ? v.some((x) => !Number.isFinite(x) || x < 0) : !Number.isFinite(v as number)
  );
  console.log(
    `${label}: ${Date.now() - t0}ms (${n} steps) stage ${rep.stageFrom}->${rep.stageTo} best ${rep.bestTo}`,
    `data ${rep.data.toExponential(2)} files ${rep.files} bosses ${rep.bosses} apex ${rep.apexes} fails ${rep.fails}`,
    `ups ${rep.ups} formats ${rep.formats} root ${rep.root} cores ${rep.cores} ach ${rep.ach}`
  );
  if (bad.length)
    console.log(
      "  !! bad fields",
      bad.map(([k]) => k)
    );
  if (JSON.stringify(base) !== before) console.log("  !! original save mutated");
  if (!parseSave(JSON.stringify(r.save))) console.log("  !! reparse failed");
  return r.save;
}

// 새 저장본 (자동화 없음)
run("fresh 3h", newSave(), 3 * 3600);
// 크론 데몬 + 자동 업그레이드
const d = newSave();
d.shop.daemon = 1;
d.shop.cron = 1;
d.auto = true;
const d2 = run("daemon 3h", d, 3 * 3600);
// 커널 권한까지 (자동 변이 · 자동 재도전 · 자동 컴파일)
const k = newSave();
Object.assign(k.shop, { daemon: 1, cron: 1, kformat: 1, kretry: 1, autoc: 1 });
k.auto = true;
k.autoFmt = true;
run("kernel 24h", k, 24 * 3600);
run("kernel 72h @50%", k, 72 * 3600, 0.5);
// 이어서 한 번 더 (시뮬레이션 결과 저장본으로)
run("daemon +12h", d2, 12 * 3600);
