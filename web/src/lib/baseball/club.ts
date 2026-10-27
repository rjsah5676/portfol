/**
 * 구단 (구단 관리 · 온라인 대전) — 카드 · 등급 · 종합(OVR) · 타선 → 경기 팀.
 *
 * 종합(OVR, 0~1000)
 *   타자: 맞히기 32% · 파워 28% · 수비 22% · 주루 18%
 *   투수: 제구 34% · 변화 34% · 구속 22% (120~165km/h → 0~1000) · 체력 10%
 * 등급: C < 300 · B 300~499 · A 500~699 · S 700~849 · SS 850+
 * 처음 구단은 전부 C (종합 200~299). 육성 모드에서 은퇴한 선수(명예의 전당)는 카드로 자동 등록.
 */
import { CLUB_DEFS, FAMILY, GIVEN, clubDefById, type Batter, type ClubDef, type Pitcher, type Team } from "./data";
import type { HofEntry } from "./career";
import type { Look } from "./look";
import type { PitchKind } from "./pitch";
import { clamp, makeRng, type Rng } from "./rng";

/* ─────────────── 등급 · 종합 ─────────────── */

export type Grade = "C" | "B" | "A" | "S" | "SS";
export const GRADES: Grade[] = ["C", "B", "A", "S", "SS"];
/** 등급별 종합 하한 */
export const GRADE_MIN: Record<Grade, number> = { C: 0, B: 300, A: 500, S: 700, SS: 850 };
export const GRADE_COLOR: Record<Grade, string> = { C: "#9aa3b8", B: "#4fb3ff", A: "#b46bff", S: "#ffcf3a", SS: "#ff4d8d" };
export const gradeOf = (ovr: number): Grade => (ovr >= 850 ? "SS" : ovr >= 700 ? "S" : ovr >= 500 ? "A" : ovr >= 300 ? "B" : "C");

const W_BAT = { hit: 0.32, power: 0.28, def: 0.22, run: 0.18 } as const;
const W_PIT = { control: 0.34, brk: 0.34, velo: 0.22, stamina: 0.1 } as const;
/** 구속 → 0~1000 */
export const veloN = (kmh: number) => clamp(((kmh - 120) / 45) * 1000, 0, 1000);
export const batOvr = (b: { hit: number; power: number; run: number; def: number }) =>
  Math.round(b.hit * W_BAT.hit + b.power * W_BAT.power + b.def * W_BAT.def + b.run * W_BAT.run);
export const pitOvr = (p: { control: number; brk: number; velo: number; stamina: number }) =>
  Math.round(p.control * W_PIT.control + p.brk * W_PIT.brk + veloN(p.velo) * W_PIT.velo + p.stamina * W_PIT.stamina);

/* ─────────────── 카드 ─────────────── */

export type CardKind = "bat" | "pit" | "coach" | "cheer";
export const KIND_NAME: Record<CardKind, string> = { bat: "타자", pit: "투수", coach: "코치", cheer: "치어리더" };

export interface BatCard {
  kind: "bat";
  id: string;
  name: string;
  num: number;
  /** 주 포지션 (타순 칸 포지션과 다를 수 있음) */
  pos: string;
  bats: "R" | "L";
  hit: number;
  power: number;
  run: number;
  def: number;
  look?: Look;
  /** 명예의 전당 출신 (육성 모드 은퇴 선수) */
  hof?: { nick: string; seasons: number; hr: number; avg: number };
}
export interface PitCard {
  kind: "pit";
  id: string;
  name: string;
  num: number;
  role: Pitcher["role"];
  throws: "R" | "L";
  control: number;
  velo: number;
  brk: number;
  stamina: number;
  rep: PitchKind[];
}
/** 코치 · 치어리더: 경기 팀 능력치에 작은 보너스 */
export type BuffStat = "hit" | "power" | "run" | "def" | "control" | "brk";
export const BUFF_NAME: Record<BuffStat, string> = { hit: "맞히기", power: "파워", run: "주루", def: "수비", control: "제구", brk: "변화" };
export interface StaffCard {
  kind: "coach" | "cheer";
  id: string;
  name: string;
  /** 직함 (타격 코치 · 응원단장 …) */
  title: string;
  ovr: number;
  buff: BuffStat[];
}
export type Card = BatCard | PitCard | StaffCard;

export const ovrOf = (c: Card) => (c.kind === "bat" ? batOvr(c) : c.kind === "pit" ? pitOvr(c) : c.ovr);
export const gradeOfCard = (c: Card) => gradeOf(ovrOf(c));
/** 코치 · 치어리더 보너스 크기: 종합 25당 +1 (C 등급 ≈ +8 ~ +11), 치어리더는 절반 */
export const buffOf = (c: StaffCard) => Math.round(c.ovr / 25 / (c.kind === "cheer" ? 2 : 1));

/* ─────────────── 구단 ─────────────── */

export const LINEUP_POS = ["CF", "2B", "RF", "1B", "3B", "LF", "C", "SS", "DH"];
export const POS_NAME: Record<string, string> = { C: "포수", "1B": "1루수", "2B": "2루수", "3B": "3루수", SS: "유격수", LF: "좌익수", CF: "중견수", RF: "우익수", DH: "지명타자", P: "투수" };
export const SLOTS = { lineup: 9, bench: 4, rotation: 5, bullpen: 5, closer: 1, coach: 4, cheer: 3 } as const;
export type Area = keyof typeof SLOTS;
export const AREA_KIND: Record<Area, CardKind> = { lineup: "bat", bench: "bat", rotation: "pit", bullpen: "pit", closer: "pit", coach: "coach", cheer: "cheer" };

export interface ClubRecord {
  w: number;
  l: number;
  d: number;
  /** 대전 점수 (처음 1000) */
  rating: number;
  /** 최근 대전 (새 것이 앞) */
  log: { at: number; opp: string; oppShort: string; color: string; score: string; win: boolean | null; delta: number }[];
}

export interface Club {
  v: 1;
  teamId: string;
  createdAt: number;
  seq: number;
  cards: Card[];
  /** 칸마다 카드 id (빈 칸 null) — lineup 은 타순 1~9, lpos 는 그 타순의 수비 위치 */
  slots: Record<Area, (string | null)[]>;
  lpos: string[];
  /** 다음 선발 (선발 5명 중 몇 번째) */
  nextSp: number;
  record: ClubRecord;
}

const REPS: PitchKind[][] = [
  ["FB", "SL", "CB", "CH"],
  ["FB", "SK", "SL", "FK"],
  ["FB", "CT", "CB", "CH"],
  ["FB", "SL", "FK"],
  ["FB", "TS", "CH", "CB"],
];

/** 이름 겹치지 않게 */
function namer(rng: Rng) {
  const used = new Set<string>();
  return (pool: readonly string[] = GIVEN) => {
    for (let i = 0; ; i++) {
      const n = rng.pick(FAMILY) + rng.pick(pool);
      if (!used.has(n) || i > 50) {
        used.add(n);
        return n;
      }
    }
  };
}
const CHEER_GIVEN = ["지아", "하린", "서아", "유나", "다은", "예린", "소율", "채원", "나연", "수빈"];

/** 종합이 정확히 target 이 되도록 타자 능력치 맞추기 (모양 tilt + 흔들림) */
export function genBatStats(rng: Rng, target: number, tilt: Partial<Record<"hit" | "power" | "run" | "def", number>> = {}) {
  const st = { hit: 0, power: 0, run: 0, def: 0 };
  for (const k of ["hit", "power", "run", "def"] as const) st[k] = target + (tilt[k] ?? 0) + Math.round(rng.gauss() * 25);
  // 가중치 합 = 1 → 전부 같은 만큼 옮기면 종합도 그만큼
  const d = target - batOvr(st);
  for (const k of ["hit", "power", "run", "def"] as const) st[k] = clamp(Math.round(st[k] + d), 1, 999);
  for (let i = 0; i < 40 && batOvr(st) !== target; i++) st.hit = clamp(st.hit + (batOvr(st) < target ? 1 : -1), 1, 999);
  return st;
}

/** 종합이 target 인 투수 능력치 (구속 · 체력은 역할 따라, 나머지로 맞춤) */
export function genPitStats(rng: Rng, target: number, role: Pitcher["role"]) {
  const vN = clamp(target + (role === "SP" ? -20 : 40) + rng.gauss() * 60, 0, 1000);
  const velo = Math.round(120 + (vN / 1000) * 45);
  const stamina = Math.round(role === "SP" ? 560 + rng() * 120 : role === "RP" ? 320 + rng() * 70 : 280 + rng() * 50);
  const rest = (target - veloN(velo) * W_PIT.velo - stamina * W_PIT.stamina) / W_PIT.control; // 제구 + 변화 합
  const split = 0.5 + rng.gauss() * 0.08;
  const st = { control: clamp(Math.round(rest * split), 1, 999), brk: clamp(Math.round(rest * (1 - split)), 1, 999), velo, stamina };
  // 한쪽이 끝(1 · 999)에 닿으면 다른 쪽으로 · 그래도 모자라면 구속으로
  for (let i = 0; i < 2000 && pitOvr(st) !== target; i++) {
    const up = pitOvr(st) < target;
    const k = i % 2 ? "control" : "brk";
    const o = k === "brk" ? "control" : "brk";
    const can = (x: "control" | "brk") => (up ? st[x] < 999 : st[x] > 1);
    if (can(k)) st[k] += up ? 1 : -1;
    else if (can(o)) st[o] += up ? 1 : -1;
    else if (up ? st.velo < 165 : st.velo > 120) st.velo += up ? 1 : -1;
    else break;
  }
  return st;
}

/** 타순 모양: 1·2번 맞히기 · 발, 3~5번 힘, 포수 · 유격수 수비 */
const BAT_TILT: Record<string, Partial<Record<"hit" | "power" | "run" | "def", number>>> = {
  CF: { hit: 30, power: -40, run: 60, def: 20 },
  "2B": { hit: 40, power: -30, run: 20, def: 10 },
  RF: { hit: 10, power: 30, run: 0, def: 0 },
  "1B": { hit: 0, power: 60, run: -50, def: -10 },
  "3B": { hit: 0, power: 40, run: -20, def: 10 },
  LF: { hit: 10, power: 20, run: 0, def: -10 },
  C: { hit: -20, power: 0, run: -50, def: 60 },
  SS: { hit: 0, power: -40, run: 30, def: 60 },
  DH: { hit: 20, power: 60, run: -60, def: -80 },
};

/** 새 구단 (전부 C 등급, 종합 200~299) */
export function newClub(teamId: string, seed = (Math.random() * 2 ** 32) >>> 0): Club {
  const rng = makeRng(seed);
  const name = namer(rng);
  const nums = new Set<number>();
  const num = () => {
    for (;;) {
      const n = 1 + Math.floor(rng() * 99);
      if (!nums.has(n)) {
        nums.add(n);
        return n;
      }
    }
  };
  const ovrC = () => 200 + Math.floor(rng() * 100);
  let seq = 0;
  const id = (p: string) => `${p}${++seq}`;
  const cards: Card[] = [];
  const bat = (pos: string): BatCard => ({ kind: "bat", id: id("b"), name: name(), num: num(), pos, bats: rng() < 0.35 ? "L" : "R", ...genBatStats(rng, ovrC(), BAT_TILT[pos]) });
  const pit = (role: Pitcher["role"]): PitCard => ({ kind: "pit", id: id("p"), name: name(), num: num(), role, throws: rng() < 0.3 ? "L" : "R", rep: rng.pick(REPS), ...genPitStats(rng, ovrC(), role) });
  const starters = LINEUP_POS.map(bat);
  const bench = ["C", "SS", "CF", "1B"].map(bat);
  const rotation = Array.from({ length: 5 }, () => pit("SP"));
  const bullpen = Array.from({ length: 4 }, () => pit("RP"));
  const closer = pit("CL");
  const coachDefs: [string, BuffStat[]][] = [
    ["타격 코치", ["hit"]],
    ["투수 코치", ["control", "brk"]],
    ["수비 코치", ["def"]],
    ["주루 코치", ["run"]],
  ];
  const coaches: StaffCard[] = coachDefs.map(([title, buff]) => ({ kind: "coach", id: id("s"), name: name(), title, ovr: ovrC(), buff }));
  const cheerDefs: [string, BuffStat[]][] = [
    ["응원단장", ["power"]],
    ["치어리더", ["hit"]],
    ["치어리더", ["control"]],
  ];
  const cheers: StaffCard[] = cheerDefs.map(([title, buff]) => ({ kind: "cheer", id: id("s"), name: name(CHEER_GIVEN), title, ovr: ovrC(), buff }));
  cards.push(...starters, ...bench, ...rotation, ...bullpen, closer, ...coaches, ...cheers);
  return {
    v: 1,
    teamId,
    createdAt: Date.now(),
    seq,
    cards,
    slots: {
      lineup: starters.map((c) => c.id),
      bench: bench.map((c) => c.id),
      rotation: rotation.map((c) => c.id),
      bullpen: [...bullpen.map((c) => c.id), null],
      closer: [closer.id],
      coach: coaches.map((c) => c.id),
      cheer: cheers.map((c) => c.id),
    },
    lpos: [...LINEUP_POS],
    nextSp: 0,
    record: { w: 0, l: 0, d: 0, rating: 1000, log: [] },
  };
}

/* ─────────────── 명예의 전당 → 카드 ─────────────── */

export const hofCardId = (id: string) => `hof:${id}`;
/** 문자열 → 등번호 (예전 저장엔 번호가 없어서) */
const hashNum = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 1 + (h % 99);
};
const HOF_POS: Record<HofEntry["type"], string> = { contact: "2B", power: "1B", speed: "CF", defense: "SS", all: "3B" };
export function hofCard(e: HofEntry): BatCard {
  return {
    kind: "bat",
    id: hofCardId(e.id),
    name: e.name,
    num: e.num ?? hashNum(e.id),
    pos: HOF_POS[e.type] ?? "DH",
    bats: e.bats ?? "R",
    hit: e.stats.hit,
    power: e.stats.power,
    run: e.stats.run,
    def: e.stats.def,
    look: e.look,
    hof: { nick: e.nick, seasons: e.seasons, hr: e.hr, avg: e.avg },
  };
}
/** 명예의 전당 선수를 카드 목록에 넣기 (id 로 중복 없이, 능력치는 전당 기록으로 맞춤). 바뀌면 true */
export function syncHof(club: Club, hof: HofEntry[]): boolean {
  let changed = false;
  for (const e of hof) {
    const card = hofCard(e);
    const i = club.cards.findIndex((c) => c.id === card.id);
    if (i < 0) {
      club.cards.push(card);
      changed = true;
    } else if (JSON.stringify(club.cards[i]) !== JSON.stringify(card)) {
      club.cards[i] = card;
      changed = true;
    }
  }
  return changed;
}

/* ─────────────── 칸 바꾸기 ─────────────── */

export const cardById = (club: Club, id: string | null | undefined) => (id ? club.cards.find((c) => c.id === id) : undefined);
/** 카드가 놓인 칸 */
export function whereIs(club: Club, id: string): { area: Area; i: number } | null {
  for (const a of Object.keys(SLOTS) as Area[]) {
    const i = club.slots[a].indexOf(id);
    if (i >= 0) return { area: a, i };
  }
  return null;
}

/** 칸 ← 카드 (카드가 다른 칸에 있었으면 서로 자리 바꿈). 종류가 다르면 그대로 */
export function placeCard(club: Club, to: { area: Area; i: number }, cardId: string): Club {
  const card = cardById(club, cardId);
  if (!card || card.kind !== AREA_KIND[to.area]) return club;
  const slots = Object.fromEntries((Object.keys(club.slots) as Area[]).map((a) => [a, [...club.slots[a]]])) as Club["slots"];
  const prev = slots[to.area][to.i];
  const from = whereIs(club, cardId);
  if (from && from.area === to.area && from.i === to.i) return club;
  // 타순은 비울 수 없음 — 다른 칸에서 온 카드면 그 자리에 원래 카드를 보냄
  if (from) slots[from.area][from.i] = prev;
  slots[to.area][to.i] = cardId;
  if (from?.area === "lineup" && !slots.lineup[from.i]) return club;
  return { ...club, slots };
}
/** 두 칸 맞바꾸기 (같은 종류끼리) */
export function swapSlots(club: Club, a: { area: Area; i: number }, b: { area: Area; i: number }): Club {
  if (AREA_KIND[a.area] !== AREA_KIND[b.area]) return club;
  const slots = Object.fromEntries((Object.keys(club.slots) as Area[]).map((k) => [k, [...club.slots[k]]])) as Club["slots"];
  const t = slots[a.area][a.i];
  slots[a.area][a.i] = slots[b.area][b.i];
  slots[b.area][b.i] = t;
  if (slots.lineup.some((x) => !x)) return club;
  // 타순끼리 바꾸면 수비 위치도 선수를 따라감
  const lpos = [...club.lpos];
  if (a.area === "lineup" && b.area === "lineup") [lpos[a.i], lpos[b.i]] = [lpos[b.i], lpos[a.i]];
  return { ...club, slots, lpos };
}
/** 칸 비우기 (타순은 안 됨) */
export function clearSlot(club: Club, at: { area: Area; i: number }): Club {
  if (at.area === "lineup") return club;
  const slots = { ...club.slots, [at.area]: club.slots[at.area].map((x, j) => (j === at.i ? null : x)) };
  return { ...club, slots };
}

/* ─────────────── 팀 평점 · 보너스 ─────────────── */

const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const ovrs = (club: Club, ids: (string | null)[]) => ids.map((id) => cardById(club, id)).filter((c): c is Card => !!c).map(ovrOf);

/** 코치 · 치어리더 보너스 합 */
export function staffBuffs(club: Club): Record<BuffStat, number> {
  const out: Record<BuffStat, number> = { hit: 0, power: 0, run: 0, def: 0, control: 0, brk: 0 };
  for (const id of [...club.slots.coach, ...club.slots.cheer]) {
    const c = cardById(club, id);
    if (c && (c.kind === "coach" || c.kind === "cheer")) for (const b of c.buff) out[b] += buffOf(c);
  }
  return out;
}

/** 팀 평점 = 타선 55% · 선발 30% · 불펜+마무리 15% */
export function teamRating(club: Club): number {
  const bat = avg(ovrs(club, club.slots.lineup));
  const sp = avg(ovrs(club, club.slots.rotation));
  const rp = avg(ovrs(club, [...club.slots.bullpen, ...club.slots.closer]));
  return Math.round(bat * 0.55 + sp * 0.3 + (rp || sp) * 0.15);
}

/* ─────────────── 경기 팀 만들기 ─────────────── */

/** 구단 → 경기 팀 (타순 그대로 · 이번 선발 → 불펜 → 마무리, 스태프 보너스 반영) */
export function buildTeam(club: Club): Team {
  const def = clubDefById(club.teamId);
  const bf = staffBuffs(club);
  const up = (v: number, k: BuffStat) => clamp(v + bf[k], 1, 999);
  const batters: Batter[] = club.slots.lineup.map((id, i) => {
    const c = cardById(club, id) as BatCard;
    return { name: c.name, num: c.num, pos: club.lpos[i], bats: c.bats, hit: up(c.hit, "hit"), power: up(c.power, "power"), run: up(c.run, "run"), def: up(c.def, "def"), look: c.look };
  });
  const pit = (c: Card | undefined, role: Pitcher["role"]): Pitcher | null =>
    c && c.kind === "pit" ? { name: c.name, num: c.num, role, throws: c.throws, control: up(c.control, "control"), velo: c.velo, brk: up(c.brk, "brk"), stamina: c.stamina, rep: c.rep } : null;
  const rot = club.slots.rotation.filter((x): x is string => !!x);
  const spId = rot.length ? rot[club.nextSp % rot.length] : null;
  const pitchers = [
    pit(cardById(club, spId), "SP"),
    ...club.slots.bullpen.map((id) => pit(cardById(club, id), "RP")),
    pit(cardById(club, club.slots.closer[0]), "CL"),
  ].filter((p): p is Pitcher => !!p);
  // 선발이 없으면 아무 투수나 (경기는 투수 1명 이상 필요)
  if (!pitchers.length) {
    const any = club.cards.find((c) => c.kind === "pit");
    const p = pit(any, "SP");
    if (p) pitchers.push(p);
  }
  return { id: def.id, name: def.name, short: def.short, color: def.color, dark: def.dark, batters, pitchers };
}
/** 이번 선발 카드 */
export function nextStarter(club: Club): PitCard | undefined {
  const rot = club.slots.rotation.filter((x): x is string => !!x);
  const c = rot.length ? cardById(club, rot[club.nextSp % rot.length]) : undefined;
  return c?.kind === "pit" ? c : undefined;
}

/* ─────────────── 상대 구단 (기록 대전용 가상 구단) ─────────────── */

export interface Ghost {
  def: ClubDef;
  owner: string;
  rating: number;
  /** 0 쉬움 · 1 비슷 · 2 강함 → 봇 난이도 */
  tier: 0 | 1 | 2;
  win: number;
  lose: number;
  team: Team;
  /** 상대 타선 대표 (화면용) */
  star: string;
}
const OWNER = ["야구왕", "홈런공장", "직구장인", "도루왕", "새벽타격", "불펜지기", "만루포", "삼진머신", "외야석", "치맥러버", "구단주", "번트장인"];
/** 내 평점 근처(±10%)로 상대 3팀: 약간 약함 · 비슷 · 약간 강함 */
export function findGhosts(club: Club, seed = (Math.random() * 2 ** 32) >>> 0): Ghost[] {
  const rng = makeRng(seed);
  const mine = teamRating(club);
  const pool = CLUB_DEFS.filter((d) => d.id !== club.teamId);
  const picks: ClubDef[] = [];
  while (picks.length < 3) {
    const d = rng.pick(pool);
    if (!picks.includes(d)) picks.push(d);
  }
  const bands: [number, number][] = [
    [-0.1, -0.04],
    [-0.03, 0.03],
    [0.04, 0.1],
  ];
  return picks.map((def, tier) => {
    const [a, b] = bands[tier];
    const rating = Math.max(50, Math.round(mine * (1 + rng.range(a, b))));
    const team = ghostTeam(def, rating, rng);
    const star = team.batters.reduce((x, y) => (batOvr(y) > batOvr(x) ? y : x));
    return {
      def,
      owner: `${rng.pick(OWNER)}${Math.floor(rng() * 900 + 100)}`,
      rating,
      tier: tier as 0 | 1 | 2,
      win: [15, 20, 25][tier],
      lose: [-20, -15, -10][tier],
      team,
      star: `${star.name} (종합 ${batOvr(star)})`,
    };
  });
}
/** 평점 근처 능력치로 가상 구단 팀 */
export function ghostTeam(def: ClubDef, rating: number, rng: Rng): Team {
  const name = namer(rng);
  const nums = new Set<number>();
  const num = () => {
    for (;;) {
      const n = 1 + Math.floor(rng() * 99);
      if (!nums.has(n)) {
        nums.add(n);
        return n;
      }
    }
  };
  const around = () => Math.max(60, Math.round(rating + rng.gauss() * 18));
  const batters: Batter[] = LINEUP_POS.map((pos) => ({ name: name(), num: num(), pos, bats: rng() < 0.35 ? "L" : "R", ...genBatStats(rng, around(), BAT_TILT[pos]) }));
  const p = (role: Pitcher["role"]): Pitcher => ({ name: name(), num: num(), role, throws: rng() < 0.3 ? "L" : "R", rep: rng.pick(REPS), ...genPitStats(rng, around(), role) });
  return { id: def.id, name: def.name, short: def.short, color: def.color, dark: def.dark, batters, pitchers: [p("SP"), p("RP"), p("RP"), p("RP"), p("CL")] };
}
