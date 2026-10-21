/*
 * 캐릭터 명부 점검 — 명부(web/src/lib/cast.ts) 한 줄마다 게임별로 준비됐는지 표로.
 *   npx tsx scripts/cast-check.ts
 * 전용 = 그 게임 전용 키트 · 빌림 = 원래 캐릭터 키트로 합류 · 없음 = 그 게임에 안 나옴
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CAST } from "../../web/src/lib/cast";
import { CHARS } from "../../web/src/lib/marble/data";
import { HEROES, type HeroId } from "../../web/src/lib/survivor/data";
import { TEAM_NAME, teamOf } from "../../web/src/lib/survivor/progress";

const PUB = fileURLToPath(new URL("../../web/public", import.meta.url));
let bad = 0;
const rows = CAST.map((c) => {
  const m = CHARS.find((x) => x.id === c.id);
  const mk = !m ? "없음" : m.passive === CHARS.find((x) => x.id === c.base)?.passive && c.base !== c.id ? "빌림" : "전용";
  const h = HEROES[c.id as HeroId];
  const sv = !h ? "없음" : h.borrowed ? "빌림" : "전용";
  const sheet = existsSync(join(PUB, "fight", `${c.sprite}.json`));
  const art = existsSync(join(PUB, (c.art ?? `/fight/art/${c.sprite}.webp`).slice(1)));
  const miss = !sheet || !art || !c.on;
  if (miss || mk === "없음" || sv === "없음") bad++;
  return { id: c.id, 이름: `${c.name} (${c.title})`, 등급: c.grade, 공개: c.on ? "O" : "-", 도트: sheet ? "O" : "없음", 그림: art ? "O" : "없음", 다이스타운: mk, 서바이버: sv, 계열: h ? TEAM_NAME[teamOf(c.id as HeroId)] : "-" };
});
console.table(rows);
console.log(bad ? `손볼 캐릭터 ${bad}명` : `${CAST.length}명 모두 두 게임에 준비됨`);
process.exitCode = bad ? 1 : 0;
