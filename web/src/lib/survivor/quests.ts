/*
 * 픽셀 타운 서바이버 — 해금 퀘스트 (메가봉크식: "이거 하면 열림")
 * 판이 끝나면 서버가 판 기록(RunQ) · 누적 기록으로 판정 → 무기 · 유물 · 기능 · 별사탕 해금.
 * 시뮬 · 화면 · 서버 공용, "@/" import 금지.
 */
import { BASE_WEAPONS, HEROES, HERO_IDS, RUN_SEC, type HeroId, type WeaponId } from "./data";
import { BASE_RELICS, type RelicId } from "./relics";

/** 한 판 동안 센 것 (퀘스트 판정용) */
export interface RunQ {
  /** 킹 젤리 나와서 쓰러뜨리기까지 (초, 못 잡으면 0) */
  jelly: number;
  /** 시계지기 */
  clock: number;
  /** 연속으로 안 맞은 최대 시간 (초) */
  noHit: number;
  chests: number;
  boxes: number;
  shrines: number;
  statues: number;
  bells: number;
  flags: number;
  buys: number;
  fountains: number;
  trials: number;
  evos: number;
  awakens: number;
  fuses: number;
  relics: number;
  legends: number;
  /** 주운 금화 합 */
  gold: number;
  elites: number;
  ults: number;
}
export const emptyQ = (): RunQ => ({ jelly: 0, clock: 0, noHit: 0, chests: 0, boxes: 0, shrines: 0, statues: 0, bells: 0, flags: 0, buys: 0, fountains: 0, trials: 0, evos: 0, awakens: 0, fuses: 0, relics: 0, legends: 0, gold: 0, elites: 0, ults: 0 });
export const Q_KEYS = Object.keys(emptyQ()) as (keyof RunQ)[];

/** 퀘스트 판정에 쓰는 한 판 보고 */
export interface QuestRun {
  hero: HeroId;
  sec: number;
  kills: number;
  lv: number;
  win: boolean;
  depth: number;
  q: RunQ;
}
/** 누적 (프로필) */
export interface QuestTotals {
  games: number;
  wins: number;
  kills: number;
  trials: number;
  shrines: number;
  chests: number;
  /** 깊이별 최고 클리어 */
  depth: number;
}

export type Feat = "reroll" | "skip" | "banish" | "gold";
export const FEAT_NAME: Record<Feat, string> = { reroll: "다시 뽑기 +1", skip: "건너뛰기 +1", banish: "카드 지우기 +1", gold: "시작 금화 +40" };

export type QuestReward = { k: "weapon"; id: WeaponId } | { k: "relic"; id: RelicId } | { k: "feat"; id: Feat } | { k: "stars"; n: number };

export interface QuestDef {
  id: string;
  name: string;
  desc: string;
  goal: number;
  /** 한 판 기준 (run) · 누적 기준 (total) */
  value(run: QuestRun, tot: QuestTotals): number;
  reward: QuestReward;
  /** 한 판 기록으로만 (진행도가 안 쌓임) */
  per: "run" | "total";
}

const run = (id: string, name: string, desc: string, goal: number, value: (r: QuestRun) => number, reward: QuestReward): QuestDef => ({ id, name, desc, goal, value: (r) => value(r), reward, per: "run" });
const tot = (id: string, name: string, desc: string, goal: number, value: (t: QuestTotals) => number, reward: QuestReward): QuestDef => ({ id, name, desc, goal, value: (_r, t) => value(t), reward, per: "total" });
const W = (id: WeaponId): QuestReward => ({ k: "weapon", id });
const RL = (id: RelicId): QuestReward => ({ k: "relic", id });
const F = (id: Feat): QuestReward => ({ k: "feat", id });
const S = (n: number): QuestReward => ({ k: "stars", n });

export const QUESTS: QuestDef[] = [
  // 버티기 · 보스
  run("sec3", "첫 밤", "한 판에 3분 버티기", 180, (r) => r.sec, RL("glasses")),
  run("jelly", "젤리 왕 퇴치", "킹 젤리 쓰러뜨리기", 1, (r) => (r.q.jelly > 0 ? 1 : 0), W("missile")),
  run("dawn", "새벽이 왔다", "10분 버티고 자정의 시계지기 쓰러뜨리기", 1, (r) => (r.win ? 1 : 0), W("ball")),
  run("jellyfast", "젤리 순삭", "킹 젤리를 나오고 45초 안에 쓰러뜨리기", 1, (r) => (r.q.jelly > 0 && r.q.jelly <= 45 ? 1 : 0), F("banish")),
  run("clockfast", "자정의 칼퇴", "시계지기를 나오고 75초 안에 쓰러뜨리기", 1, (r) => (r.q.clock > 0 && r.q.clock <= 75 ? 1 : 0), RL("fork")),
  run("nohit", "털끝 하나", "2분 동안 한 대도 안 맞기", 120, (r) => r.q.noHit, RL("pillow")),
  run("kills3k", "몬스터 소탕", "한 판에 3,000마리 처치", 3000, (r) => r.kills, RL("backpack")),
  run("kills6k", "밤의 청소부", "한 판에 6,000마리 처치", 6000, (r) => r.kills, S(40)),
  run("lv40", "쑥쑥", "한 판에 레벨 40", 40, (r) => r.lv, RL("tailwind")),
  run("lv60", "끝없는 성장", "한 판에 레벨 60", 60, (r) => r.lv, RL("shadow")),
  run("ot60", "새벽 연장", "오버타임에서 1분 더 버티기", RUN_SEC + 60, (r) => (r.win ? r.sec : 0), S(40)),
  // 맵 오브젝트
  run("shrine5", "성소 순례", "한 판에 성소 5번 충전", 5, (r) => r.q.shrines, F("reroll")),
  run("statue3", "욕심쟁이", "한 판에 황금 고양이상 3번 만지기", 3, (r) => r.q.statues, RL("scythe")),
  run("bell3", "도전자", "한 판에 도전의 종 3번 치기", 3, (r) => r.q.bells, RL("balloon")),
  run("trial2", "달빛 시험", "한 판에 달빛 시련 2번 이기기", 2, (r) => r.q.trials, RL("poison")),
  run("buy3", "단골손님", "한 판에 상인에게 3번 사기", 3, (r) => r.q.buys, F("gold")),
  run("box6", "상자 수집가", "한 판에 금화 상자 6개 열기", 6, (r) => r.q.boxes, RL("zap")),
  run("flag4", "응원단장", "한 판에 응원 깃발 4번 세우기", 4, (r) => r.q.flags, F("skip")),
  run("gold500", "부자 고양이", "한 판에 금화 500 줍기", 500, (r) => r.q.gold, F("reroll")),
  // 빌드
  run("evo1", "진화!", "무기 하나 진화시키기", 1, (r) => r.q.evos, F("banish")),
  run("awake1", "각성!", "고유 무기 각성시키기", 1, (r) => r.q.awakens, S(30)),
  run("fuse1", "합체!", "무기 합체하기", 1, (r) => r.q.fuses, RL("goldendice")),
  run("evo3", "진화 박사", "한 판에 진화 · 합체 · 각성 3번", 3, (r) => r.q.evos + r.q.fuses + r.q.awakens, F("banish")),
  run("relic12", "유물 상자", "한 판에 유물 12개 모으기", 12, (r) => r.q.relics, S(30)),
  run("legend", "전설의 시작", "전설 유물 얻기", 1, (r) => r.q.legends, RL("phoenix")),
  run("ult10", "필살 연타", "한 판에 필살기 10번", 10, (r) => r.q.ults, S(20)),
  // 깊이
  ...[1, 3, 5, 7, 10].map((d, i) => run(`depth${d}`, `깊은 밤 ${d}`, `밤의 깊이 ${d} 클리어`, 1, (r) => (r.win && r.depth >= d ? 1 : 0), [F("reroll"), S(60), S(80), S(100), S(200)][i])),
  // 누적
  tot("games10", "단골 손님", "10판 하기", 10, (t) => t.games, S(30)),
  tot("games50", "불면증", "50판 하기", 50, (t) => t.games, S(80)),
  tot("wins5", "새벽 단골", "5번 클리어", 5, (t) => t.wins, S(50)),
  tot("wins20", "새벽의 지배자", "20번 클리어", 20, (t) => t.wins, S(120)),
  tot("kill20k", "천적", "누적 20,000마리 처치", 20_000, (t) => t.kills, S(40)),
  tot("kill100k", "학살자", "누적 100,000마리 처치", 100_000, (t) => t.kills, S(100)),
  tot("trial10", "시련의 달인", "달빛 시련 누적 10번 이기기", 10, (t) => t.trials, S(50)),
  tot("shrine40", "성소 지기", "성소 누적 40번 충전", 40, (t) => t.shrines, F("skip")),
  // 캐릭터별 클리어
  ...HERO_IDS.map((h) => run(`hero-${h}`, `${HEROES[h].title}의 새벽`, `${HEROES[h].title}(으)로 클리어`, 1, (r) => (r.win && r.hero === h ? 1 : 0), S(HEROES[h].grade === "UR" ? 40 : HEROES[h].grade === "SSR" ? 30 : 20))),
];
export const QUEST: Record<string, QuestDef> = Object.fromEntries(QUESTS.map((q) => [q.id, q]));

/** 해금 상태 → 판 시작 설정 */
export interface Unlocks {
  weapons: WeaponId[];
  relics: RelicId[];
  rerolls: number;
  skips: number;
  banish: number;
  gold: number;
}
export function unlocksOf(done: string[]): Unlocks {
  const u: Unlocks = { weapons: [...BASE_WEAPONS], relics: [...BASE_RELICS], rerolls: 1, skips: 1, banish: 0, gold: 0 };
  for (const id of done) {
    const q = QUEST[id];
    if (!q) continue;
    const rw = q.reward;
    if (rw.k === "weapon" && !u.weapons.includes(rw.id)) u.weapons.push(rw.id);
    else if (rw.k === "relic" && !u.relics.includes(rw.id)) u.relics.push(rw.id);
    else if (rw.k === "feat") {
      if (rw.id === "reroll") u.rerolls++;
      else if (rw.id === "skip") u.skips++;
      else if (rw.id === "banish") u.banish++;
      else if (rw.id === "gold") u.gold += 40;
    }
  }
  return u;
}

/** 새로 깬 퀘스트 */
export function newlyDone(done: string[], r: QuestRun, t: QuestTotals): string[] {
  const out: string[] = [];
  for (const q of QUESTS) if (!done.includes(q.id) && q.value(r, t) >= q.goal) out.push(q.id);
  return out;
}
