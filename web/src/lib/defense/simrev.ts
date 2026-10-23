/**
 * 판 검증 열쇠 SIM_KEY = SIM_REV(손으로 올리는 규칙 번호) + 수치 표 해시.
 * 서버는 판을 시작할 때 이 열쇠를 적어 두고, 끝낼 때 열쇠가 다르면(그 사이 업데이트) 다시 돌리지 않고 「업데이트됐어요」로 돌려보냄.
 * 화면은 시작 응답의 열쇠가 자기 것과 다르면(옛 화면) 새로고침부터.
 * 시뮬(sim.ts)은 이 파일을 안 씀 — 결정론과 상관없음.
 */
import { B, SIM_REV, TUNE } from "./balance";
import { CHEATS } from "./cheats";
import { ENGRAVES } from "./engrave";
import { GLITCH, RELIC_VAL, RESEARCH, TOWN_TUNE } from "./progress";
import { EXP_RELICS, OATH_P } from "./town";
import { UNITS } from "./units";

const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
};
const lvs = [1, 2, 3, 4, 5];
export const SIM_KEY = `${SIM_REV}.${fnv(
  JSON.stringify({
    B,
    TUNE,
    GLITCH,
    relic: Object.entries(RELIC_VAL).map(([k, f]) => [k, lvs.map((l) => f(l))]),
    res: RESEARCH.map((r) => [r.id, lvs.map((l) => r.val(l))]),
    UNITS,
    cheats: CHEATS.map((c) => [c.id, c.desc, c.tier]),
    ENGRAVES,
    EXP_RELICS,
    TOWN_TUNE,
    OATH_P,
  })
)}`;
