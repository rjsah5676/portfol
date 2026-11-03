/*
 * 오늘의 사건 파일 — 살인 · 시간표 알리바이 사건 생성기 · 풀이기
 *
 *  사건 = 용의자 n명 · 방 n개 · 시간대 T개 · 물건 n개
 *   - 시간대마다 방 하나에 한 명, 시간대가 바뀔 땐 제자리이거나 문으로 바로 이어진 방으로만
 *   - 한 사람이 물건 하나 (그날 밤 내내)
 *   - 마지막 시간대에 현장 방에 있던 사람이 범인, 사인 종류(둔기 등) 물건을 가짐
 *   - 범인만 거짓 진술, 나머지 진술은 참. 단서(증거 문서)는 모두 참
 *  생성: 정답 세계 → 진술 → (진술만으로 범인이 정해지면 · 범인을 알아도 표가 절반 넘게 정해지면 버림)
 *        → 단서를 해가 가장 많이 줄어드는 순서로 더해 해가 하나가 되면 → 빼도 되는 단서 빼기
 */

export type TierId = "easy" | "normal" | "hard" | "hell";
export type Cat = "blunt" | "blade" | "cord" | "poison";
export type Sex = "f" | "m";
export type Hand = "왼손" | "오른손";
export type Weight = "무거움" | "가벼움";

export interface Room {
  id: string;
  name: string;
  /** 도면 3×2 격자 칸 좌표 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 바깥 공간 (정원 · 마당) — 점선 벽 */
  open?: boolean;
}
export interface Item {
  name: string;
  cat: Cat;
  mat: string;
  wt: Weight;
}
export interface Person {
  name: string;
  role: string;
  sex: Sex;
  /** 키 (cm, 사람마다 다름) */
  h: number;
  hand: Hand;
}
interface Setting {
  id: string;
  name: string;
  victim: string[];
  weather: string;
  rooms: Room[];
  doors: [string, string][];
  sizes: Record<number, string[]>;
  /** "관계" 또는 "관계:f|m" (성별이 정해진 관계) */
  roles: string[];
  items: Item[];
}

export type Clue =
  | { k: "own"; p: number; i: number; yes: boolean }
  | { k: "at"; p: number; t: number; r: number; yes: boolean }
  | { k: "iat"; i: number; t: number; r: number; yes: boolean }
  | { k: "rattr"; t: number; r: number; a: "h" | "hand"; op: ">=" | "<" | "="; v: number | string }
  | { k: "iattr"; i: number; a: "h" | "hand"; op: ">=" | "<" | "="; v: number | string }
  | { k: "ritem"; t: number; r: number; a: "mat" | "wt"; v: string }
  | { k: "pitem"; p: number; a: "mat" | "wt"; v: string; yes: boolean }
  | { k: "with"; p: number; q: number; t: number; yes: boolean };
/** 진술 = 말한 사람(by) + 내용. 범인이면 거짓, 아니면 참 */
export type Stmt = Clue & { by: number };
type Weighted = Clue & { w?: number };

export interface World {
  tierId: TierId;
  n: number;
  T: number;
  setting: { id: string; name: string; weather: string };
  rooms: Room[];
  /** adj[a] = a 에서 한 시간대 사이에 갈 수 있는 방 (자기 자신 포함) */
  adj: number[][];
  people: Person[];
  items: Item[];
  /** pos[t][p] = t 시간대에 p 가 있던 방 */
  pos: number[][];
  /** item[p] = p 의 물건 */
  item: number[];
  crimeRoom: number;
  culprit: number;
  cause: Cat;
  victim: { name: string; title: string; age: number };
  /** 시간대 [시작, 끝] (자정부터 분) */
  slots: [number, number][];
}
export interface Case extends World {
  clues: Clue[];
  stmts: Stmt[];
  seed: number;
}

// ───────── 난수 ─────────
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length)];
function shuffle<T>(r: () => number, src: readonly T[]): T[] {
  const a = src.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function hashStr(s: string): number {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ───────── 배경 ─────────
export const CAT: Record<Cat, string> = {
  blunt: "둔기",
  blade: "날붙이",
  cord: "끈",
  poison: "독극물",
};
export const CAUSE: Record<Cat, string> = {
  blunt: "둔기에 의한 두부 손상",
  blade: "날붙이에 의한 자상",
  cord: "끈에 의한 경부 압박",
  poison: "독극물 중독",
};
const SETTINGS: Setting[] = [
  {
    id: "lodge",
    name: "산장",
    victim: ["회장", "산장 주인"],
    weather: "비 오는 밤",
    rooms: [
      { id: "study", name: "서재", x: 0, y: 0, w: 1, h: 1 },
      { id: "living", name: "거실", x: 1, y: 0, w: 1, h: 1 },
      { id: "kitchen", name: "주방", x: 2, y: 0, w: 1, h: 1 },
      { id: "garden", name: "정원", x: 1, y: 1, w: 2, h: 1, open: true },
      { id: "bed", name: "침실", x: 0, y: 1, w: 1, h: 1 },
    ],
    doors: [
      ["study", "living"],
      ["living", "kitchen"],
      ["living", "garden"],
      ["kitchen", "garden"],
      ["study", "bed"],
    ],
    sizes: {
      3: ["study", "living", "kitchen"],
      4: ["study", "living", "kitchen", "garden"],
      5: ["study", "living", "kitchen", "garden", "bed"],
    },
    roles: ["장남:m", "둘째 딸:f", "비서", "산장 관리인", "주치의", "변호사", "사위:m", "요리사"],
    items: [
      { name: "청동 문진", cat: "blunt", mat: "금속", wt: "무거움" },
      { name: "은촛대", cat: "blunt", mat: "금속", wt: "무거움" },
      { name: "장작 패는 망치", cat: "blunt", mat: "나무", wt: "무거움" },
      { name: "사냥칼", cat: "blade", mat: "금속", wt: "가벼움" },
      { name: "편지칼", cat: "blade", mat: "금속", wt: "가벼움" },
      { name: "등산 로프", cat: "cord", mat: "천", wt: "가벼움" },
      { name: "커튼 끈", cat: "cord", mat: "천", wt: "가벼움" },
      { name: "수면제 병", cat: "poison", mat: "유리", wt: "가벼움" },
      { name: "쥐약 깡통", cat: "poison", mat: "금속", wt: "가벼움" },
    ],
  },
  {
    id: "hanok",
    name: "고택",
    victim: ["종손", "고택 주인"],
    weather: "첫눈 오던 밤",
    rooms: [
      { id: "sarang", name: "사랑채", x: 0, y: 0, w: 1, h: 1 },
      { id: "daecheong", name: "대청", x: 1, y: 0, w: 1, h: 1 },
      { id: "anchae", name: "안채", x: 2, y: 0, w: 1, h: 1 },
      { id: "madang", name: "마당", x: 1, y: 1, w: 1, h: 1, open: true },
      { id: "bueok", name: "부엌", x: 2, y: 1, w: 1, h: 1 },
    ],
    doors: [
      ["sarang", "daecheong"],
      ["daecheong", "anchae"],
      ["daecheong", "madang"],
      ["madang", "bueok"],
      ["anchae", "bueok"],
    ],
    sizes: {
      3: ["sarang", "daecheong", "anchae"],
      4: ["sarang", "daecheong", "anchae", "madang"],
      5: ["sarang", "daecheong", "anchae", "madang", "bueok"],
    },
    roles: [
      "맏며느리:f",
      "작은아들:m",
      "집사",
      "한의사",
      "먼 친척",
      "서예 선생",
      "손녀:f",
      "정원사",
    ],
    items: [
      { name: "놋쇠 화로", cat: "blunt", mat: "금속", wt: "무거움" },
      { name: "다듬이 방망이", cat: "blunt", mat: "나무", wt: "무거움" },
      { name: "벼루", cat: "blunt", mat: "돌", wt: "무거움" },
      { name: "은장도", cat: "blade", mat: "금속", wt: "가벼움" },
      { name: "낫", cat: "blade", mat: "금속", wt: "무거움" },
      { name: "명주 끈", cat: "cord", mat: "천", wt: "가벼움" },
      { name: "새끼줄", cat: "cord", mat: "짚", wt: "가벼움" },
      { name: "비상 주머니", cat: "poison", mat: "천", wt: "가벼움" },
      { name: "투구꽃 달인 약", cat: "poison", mat: "도자기", wt: "가벼움" },
    ],
  },
  {
    id: "museum",
    name: "미술관",
    victim: ["관장", "미술관 이사장"],
    weather: "폐관 뒤 밤",
    rooms: [
      { id: "galA", name: "전시실 A", x: 0, y: 0, w: 1, h: 1 },
      { id: "galB", name: "전시실 B", x: 1, y: 0, w: 1, h: 1 },
      { id: "vault", name: "수장고", x: 2, y: 0, w: 1, h: 1 },
      { id: "lobby", name: "로비", x: 1, y: 1, w: 2, h: 1 },
      { id: "cafe", name: "카페", x: 0, y: 1, w: 1, h: 1 },
    ],
    doors: [
      ["galA", "galB"],
      ["galB", "vault"],
      ["galB", "lobby"],
      ["lobby", "cafe"],
      ["cafe", "galA"],
    ],
    sizes: {
      3: ["galA", "galB", "vault"],
      4: ["galA", "galB", "lobby", "cafe"],
      5: ["galA", "galB", "vault", "lobby", "cafe"],
    },
    roles: ["큐레이터", "경비원", "복원가", "후원회장", "작가", "부관장", "평론가", "수집가"],
    items: [
      { name: "청동 조각상", cat: "blunt", mat: "금속", wt: "무거움" },
      { name: "대리석 받침", cat: "blunt", mat: "돌", wt: "무거움" },
      { name: "액자 망치", cat: "blunt", mat: "나무", wt: "가벼움" },
      { name: "커터 칼", cat: "blade", mat: "금속", wt: "가벼움" },
      { name: "조각칼", cat: "blade", mat: "금속", wt: "가벼움" },
      { name: "전시 차단줄", cat: "cord", mat: "천", wt: "가벼움" },
      { name: "와이어", cat: "cord", mat: "금속", wt: "가벼움" },
      { name: "복원 용제", cat: "poison", mat: "유리", wt: "가벼움" },
      { name: "청산가리 앰플", cat: "poison", mat: "유리", wt: "가벼움" },
    ],
  },
];
const SURNAME = [
  "김",
  "이",
  "박",
  "최",
  "정",
  "강",
  "조",
  "윤",
  "장",
  "임",
  "한",
  "오",
  "서",
  "신",
  "권",
  "황",
  "안",
  "송",
  "류",
  "홍",
];
// 이름은 성별이 드러나는 것만 (키가 성별 범위 안에서 정해짐)
const GIVEN: Record<Sex, string[]> = {
  f: [
    "가을",
    "하린",
    "수아",
    "다인",
    "유나",
    "소율",
    "나연",
    "예린",
    "채원",
    "서연",
    "은비",
    "지혜",
  ],
  m: [
    "정우",
    "도현",
    "민재",
    "태오",
    "은호",
    "재윤",
    "시우",
    "준혁",
    "건우",
    "성민",
    "동현",
    "우진",
  ],
};
// 키 사다리 (3cm 간격 — 단서 기준선이 사이에 들어가게). 여자 155–170, 남자 164–188
const HEIGHTS: Record<Sex, number[]> = {
  f: [155, 158, 161, 164, 167, 170],
  m: [164, 167, 170, 173, 176, 179, 182, 185, 188],
};

/** 난이도: 인원(= 방 수) · 시간대 수 */
export const TIERS: Record<TierId, { label: string; n: number; T: number }> = {
  easy: { label: "쉬움", n: 3, T: 2 },
  normal: { label: "보통", n: 4, T: 2 },
  hard: { label: "어려움", n: 4, T: 3 },
  hell: { label: "지옥", n: 5, T: 3 },
};
export const TIER_IDS: TierId[] = ["easy", "normal", "hard", "hell"];
export const isTier = (v: string): v is TierId => Object.hasOwn(TIERS, v);

// ───────── 사건 세계 ─────────
function perms(n: number): number[][] {
  const out: number[][] = [];
  const a = [...Array(n).keys()];
  const go = (k: number) => {
    if (k === n) {
      out.push(a.slice());
      return;
    }
    for (let i = k; i < n; i++) {
      [a[k], a[i]] = [a[i], a[k]];
      go(k + 1);
      [a[k], a[i]] = [a[i], a[k]];
    }
  };
  go(0);
  return out;
}

function makeWorld(r: () => number, tierId: TierId): World {
  const { n, T } = TIERS[tierId];
  const S = pick(r, SETTINGS);
  const rooms = S.sizes[n].map((id) => S.rooms.find((x) => x.id === id)!);
  const ri = new Map(rooms.map((x, i) => [x.id, i]));
  const adj = rooms.map((_, i) => [i]);
  for (const [a, b] of S.doors) {
    const ia = ri.get(a);
    const ib = ri.get(b);
    if (ia === undefined || ib === undefined) continue;
    adj[ia].push(ib);
    adj[ib].push(ia);
  }

  // 인물: 성별 → 이름 · 키(서로 다름) · 손
  const sur = shuffle(r, SURNAME);
  const roles = shuffle(r, S.roles)
    .slice(0, n)
    .map((x) => x.split(":"));
  const giv = { f: shuffle(r, GIVEN.f), m: shuffle(r, GIVEN.m) };
  const sexes: Sex[] = roles.map(([, sx]) =>
    sx === "f" || sx === "m" ? sx : r() < 0.5 ? "f" : "m"
  );
  const usedH = new Set<number>();
  const heights = sexes.map((sx) => {
    const h = pick(
      r,
      HEIGHTS[sx].filter((x) => !usedH.has(x))
    );
    usedH.add(h);
    return h;
  });
  let hands: Hand[];
  do hands = [...Array(n)].map(() => (r() < 0.35 ? "왼손" : "오른손"));
  while (new Set(hands).size < 2);
  const people: Person[] = [...Array(n)].map((_, i) => ({
    name: sur[i] + giv[sexes[i]].pop()!,
    role: roles[i][0],
    sex: sexes[i],
    h: heights[i],
    hand: hands[i],
  }));

  // 시간대별 위치
  const P = perms(n);
  const pos = [pick(r, P)];
  for (let t = 1; t < T; t++) {
    const ok = P.filter((q) => q.every((room, p) => adj[pos[t - 1][p]].includes(room)));
    const moving = ok.filter((q) => q.some((room, p) => room !== pos[t - 1][p]));
    pos.push(pick(r, moving.length ? moving : ok));
  }
  const crimeRoom = Math.floor(r() * n);
  const culprit = pos[T - 1].indexOf(crimeRoom);

  // 물건: 사인 종류 물건이 2개 (범인 후보를 좁히는 재미), 범인이 그중 하나
  const cause = pick(r, Object.keys(CAT) as Cat[]);
  const same = shuffle(
    r,
    S.items.filter((x) => x.cat === cause)
  ).slice(0, 2);
  const rest = shuffle(
    r,
    S.items.filter((x) => x.cat !== cause)
  ).slice(0, n - 2);
  const items = shuffle(r, [...same, ...rest]);
  let item: number[];
  do item = pick(r, P);
  while (items[item[culprit]].cat !== cause);

  const victim = {
    name: pick(r, SURNAME) + pick(r, ["명철", "기훈", "정숙", "상목", "영자", "만수"]),
    title: pick(r, S.victim),
    age: 60 + Math.floor(r() * 20),
  };
  const t0 = 21 * 60 + 20 + Math.floor(r() * 3) * 10;
  const slots = [...Array(T)].map((_, t) => [t0 + t * 20, t0 + t * 20 + 20] as [number, number]);
  return {
    tierId,
    n,
    T,
    setting: { id: S.id, name: S.name, weather: S.weather },
    rooms,
    adj,
    people,
    items,
    pos,
    item,
    crimeRoom,
    culprit,
    cause,
    victim,
    slots,
  };
}

// ───────── 단서 평가 ─────────
/** 부분 배정 (-1 = 모름) */
interface Assign {
  pos: number[][];
  item: number[];
}
const occ = (st: Assign, t: number, room: number) => st.pos[t].indexOf(room);
const holder = (st: Assign, i: number) => st.item.indexOf(i);
// "<" 는 기준선 미만 (글은 "N cm 미만")
const cmp = (v: number | string, op: ">=" | "<" | "=", x: number | string) =>
  op === ">=" ? v >= x : op === "<" ? v < x : v === x;

/** true / false / null(아직 모름) */
export function evalClue(c: Clue, st: Assign, W: World): boolean | null {
  switch (c.k) {
    case "own": {
      const v = st.item[c.p];
      return v < 0 ? null : (v === c.i) === c.yes;
    }
    case "at": {
      const v = st.pos[c.t][c.p];
      return v < 0 ? null : (v === c.r) === c.yes;
    }
    case "iat": {
      const h = holder(st, c.i);
      if (h < 0) return null;
      const v = st.pos[c.t][h];
      return v < 0 ? null : (v === c.r) === c.yes;
    }
    case "rattr": {
      const p = occ(st, c.t, c.r);
      return p < 0 ? null : cmp(W.people[p][c.a], c.op, c.v);
    }
    case "iattr": {
      const h = holder(st, c.i);
      return h < 0 ? null : cmp(W.people[h][c.a], c.op, c.v);
    }
    case "ritem": {
      const p = occ(st, c.t, c.r);
      if (p < 0) return null;
      const i = st.item[p];
      return i < 0 ? null : W.items[i][c.a] === c.v;
    }
    case "pitem": {
      const i = st.item[c.p];
      return i < 0 ? null : (W.items[i][c.a] === c.v) === c.yes;
    }
    case "with": {
      // 방마다 한 명이라 같은 방일 일은 없음 → "문으로 바로 이어진 두 방"
      const a = st.pos[c.t][c.p];
      const b = st.pos[c.t][c.q];
      return a < 0 || b < 0 ? null : W.adj[a].includes(b) === c.yes;
    }
  }
}

function trueClues(W: World): Weighted[] {
  const { n, T, people, items, pos, item } = W;
  const out: Weighted[] = [];
  const hs = people.map((x) => x.h).sort((a, b) => a - b);
  const cuts = hs.slice(0, -1).map((h) => h + 1); // 키 기준선 (바로 위 사람과 사이)
  for (let p = 0; p < n; p++) {
    for (let i = 0; i < n; i++) out.push({ k: "own", p, i, yes: item[p] === i });
    for (let t = 0; t < T; t++)
      for (let r = 0; r < n; r++)
        out.push(
          pos[t][p] === r
            ? { k: "at", p, t, r, yes: true, w: 0.25 }
            : { k: "at", p, t, r, yes: false }
        );
    for (let q = p + 1; q < n; q++)
      for (let t = 0; t < T; t++)
        out.push({ k: "with", p, q, t, yes: W.adj[pos[t][p]].includes(pos[t][q]), w: 0.6 });
  }
  for (let i = 0; i < n; i++) {
    const h = item.indexOf(i);
    for (let t = 0; t < T; t++)
      for (let r = 0; r < n; r++)
        out.push({ k: "iat", i, t, r, yes: pos[t][h] === r, w: pos[t][h] === r ? 1 : 0.5 });
    for (const c of cuts)
      out.push({ k: "iattr", i, a: "h", op: people[h].h >= c ? ">=" : "<", v: c });
    out.push({ k: "iattr", i, a: "hand", op: "=", v: people[h].hand });
  }
  for (let t = 0; t < T; t++)
    for (let r = 0; r < n; r++) {
      const p = pos[t].indexOf(r);
      for (const c of cuts)
        out.push({ k: "rattr", t, r, a: "h", op: people[p].h >= c ? ">=" : "<", v: c });
      out.push({ k: "rattr", t, r, a: "hand", op: "=", v: people[p].hand });
      out.push({ k: "ritem", t, r, a: "mat", v: items[item[p]].mat });
      out.push({ k: "ritem", t, r, a: "wt", v: items[item[p]].wt });
    }
  return out;
}

// 진술: 칸 하나를 바로 확정하는 말("나는 t에 r에 있었다")은 거의 안 씀 —
//  거짓말쟁이를 정해도 표가 한 번에 채워지지 않고 후보만 줄게 (부정 · 관계 · 물건 속성 위주)
function makeStatements(r: () => number, W: World): Stmt[] {
  const { n, T, pos, item, items } = W;
  return [...Array(n)].map((_, p) => {
    const lie = p === W.culprit;
    const opts: { c: Clue; w: number }[] = [];
    const add = (c: Clue, truth: boolean, w: number) => {
      if (truth !== lie) opts.push({ c, w });
    };
    for (let t = 0; t < T; t++)
      for (let rr = 0; rr < n; rr++) {
        add({ k: "at", p, t, r: rr, yes: false }, pos[t][p] !== rr, 1.2);
        add({ k: "at", p, t, r: rr, yes: true }, pos[t][p] === rr, 0.12);
      }
    for (let i = 0; i < n; i++)
      add({ k: "own", p, i, yes: false }, item[p] !== i, items[i].cat === W.cause ? 1.6 : 0.8);
    for (let q = 0; q < n; q++)
      if (q !== p)
        for (let t = 0; t < T; t++) {
          const near = W.adj[pos[t][p]].includes(pos[t][q]);
          add({ k: "with", p, q, t, yes: true }, near, 1);
          add({ k: "with", p, q, t, yes: false }, !near, 1);
        }
    const attrs: ["wt" | "mat", string[]][] = [
      ["wt", ["무거움", "가벼움"]],
      ["mat", [...new Set(items.map((x) => x.mat))]],
    ];
    for (const [a, vals] of attrs)
      for (const v of vals) {
        const truth = items[item[p]][a] === v;
        add({ k: "pitem", p, a, v, yes: true }, truth, 0.7);
        add({ k: "pitem", p, a, v, yes: false }, !truth, 0.9);
      }
    const tot = opts.reduce((s, o) => s + o.w, 0);
    let x = r() * tot;
    let chosen = opts[opts.length - 1];
    for (const o of opts) {
      x -= o.w;
      if (x <= 0) {
        chosen = o;
        break;
      }
    }
    return { ...chosen.c, by: p };
  });
}

// ───────── 풀이기 ─────────
/**
 * 해 개수 (cap 에서 멈춤). clues 는 모두 참, stmts 는 말한 사람이 범인이 아니면 참 · 범인이면 거짓.
 * wantCulprits: 해마다 범인을 모아서 2명 이상 나오면 멈춤 (진술만으로 범인이 정해지는지 볼 때)
 * keep: 모아 둘 해 수
 */
export function count(
  W: World,
  clues: Clue[],
  stmts: Stmt[],
  cap: number,
  wantCulprits = false,
  keep = 2
) {
  const culprits = wantCulprits ? new Set<number>() : null;
  const { n, T, adj, crimeRoom } = W;
  const st: Assign = { pos: [...Array(T)].map(() => Array(n).fill(-1)), item: Array(n).fill(-1) };
  const usedR = [...Array(T)].map(() => Array(n).fill(false));
  const usedI = Array(n).fill(false);
  let found = 0;
  const sol: { pos: number[][]; item: number[] }[] = [];
  const culpritOf = () => occ(st, T - 1, crimeRoom);

  const ok = () => {
    for (const c of clues) if (evalClue(c, st, W) === false) return false;
    const cul = culpritOf();
    for (const s of stmts) {
      const v = evalClue(s, st, W);
      if (v === null) continue;
      if (cul >= 0) {
        if (v !== (s.by !== cul)) return false;
      } else if (v === false) {
        // 거짓말한 사람 = 범인 → 마지막 시간대에 현장이어야 함
        const lp = st.pos[T - 1][s.by];
        if (lp >= 0 && lp !== crimeRoom) return false;
      }
    }
    if (cul >= 0) {
      const ci = st.item[cul];
      if (ci >= 0 && W.items[ci].cat !== W.cause) return false;
    }
    return true;
  };
  const go = (k: number): void => {
    if (found >= cap) return;
    const tot = T * n;
    if (k < tot) {
      const t = Math.floor(k / n);
      const p = k % n;
      for (let room = 0; room < n; room++) {
        if (usedR[t][room]) continue;
        if (t > 0 && !adj[st.pos[t - 1][p]].includes(room)) continue;
        st.pos[t][p] = room;
        usedR[t][room] = true;
        if (ok()) go(k + 1);
        st.pos[t][p] = -1;
        usedR[t][room] = false;
        if (found >= cap) return;
      }
      return;
    }
    const p = k - tot;
    if (p === n) {
      found++;
      if (sol.length < keep) sol.push({ pos: st.pos.map((a) => a.slice()), item: st.item.slice() });
      if (culprits) {
        culprits.add(culpritOf());
        if (culprits.size >= 2) found = cap;
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      if (usedI[i]) continue;
      st.item[p] = i;
      usedI[i] = true;
      if (ok()) go(k + 1);
      st.item[p] = -1;
      usedI[i] = false;
      if (found >= cap) return;
    }
  };
  go(0);
  return { found, sol, culprits };
}

/** 범인을 알려 줬을 때 진술 + 도면 + 검시만으로 아직 안 정해지는 칸 비율 (동선표 + 물건) */
const OPEN_MIN = 0.5;
function openness(W: World, stmts: Stmt[]): number {
  const pin: Clue[] = [{ k: "at", p: W.culprit, t: W.T - 1, r: W.crimeRoom, yes: true }];
  const { sol } = count(W, pin, stmts, 600, false, 600);
  if (!sol.length) return 0;
  let open = 0;
  let tot = 0;
  for (let t = 0; t < W.T; t++)
    for (let p = 0; p < W.n; p++) {
      tot++;
      if (sol.some((x) => x.pos[t][p] !== sol[0].pos[t][p])) open++;
    }
  for (let p = 0; p < W.n; p++) {
    tot++;
    if (sol.some((x) => x.item[p] !== sol[0].item[p])) open++;
  }
  return open / tot;
}

// ───────── 생성 ─────────
const BASE_W: Record<Clue["k"], number> = {
  own: 0.8,
  at: 0.7,
  iat: 1,
  rattr: 1.2,
  iattr: 1.1,
  ritem: 1,
  pitem: 1,
  with: 0.6,
};
const weightOf = (c: Weighted) => BASE_W[c.k] * (c.w ?? 1);
function strip(c: Weighted): Clue {
  const o = { ...c };
  delete o.w;
  return o;
}

export function generate(seed: number, tierId: TierId): Case {
  for (let attempt = 0; attempt < 40; attempt++) {
    const r = rng(seed + attempt * 7919);
    const W = makeWorld(r, tierId);
    const stmts = makeStatements(r, W);
    // 진술만으로 범인이 정해지는 판 · 범인을 알면 표가 절반 넘게 정해지는 판은 버림
    if (count(W, [], stmts, Infinity, true).culprits!.size < 2) continue;
    if (openness(W, stmts) < OPEN_MIN) continue;
    // 범행 도구 소유는 직접 안 줌
    const pool = shuffle(r, trueClues(W)).filter(
      (c) => !(c.k === "own" && c.yes && W.items[c.i].cat === W.cause)
    );
    const clues: Clue[] = [];
    let cur = count(W, clues, stmts, 400).found;
    let guard = 0;
    while (cur > 1 && pool.length && guard++ < 60) {
      // 가중 추첨한 후보 몇 개 중 해를 가장 많이 줄이는 것
      const tot = pool.reduce((s, c) => s + weightOf(c), 0);
      const cand = new Set<number>();
      for (let j = 0; j < 8 && j < pool.length; j++) {
        let x = r() * tot;
        let idx = 0;
        for (; idx < pool.length; idx++) {
          x -= weightOf(pool[idx]);
          if (x <= 0) break;
        }
        cand.add(Math.min(idx, pool.length - 1));
      }
      let best = -1;
      let bestN = Infinity;
      for (const idx of cand) {
        const f = count(W, [...clues, strip(pool[idx])], stmts, Math.min(cur, 400)).found;
        if (f < bestN && f >= 1) {
          bestN = f;
          best = idx;
        }
      }
      if (best < 0) break;
      clues.push(strip(pool[best]));
      pool.splice(best, 1);
      cur = bestN;
    }
    if (cur !== 1) continue;
    // 줄이기: 빼도 해가 하나면 뺌
    for (const c of shuffle(r, clues.slice())) {
      const rest = clues.filter((x) => x !== c);
      if (count(W, rest, stmts, 2).found === 1) clues.splice(clues.indexOf(c), 1);
    }
    // 직접 위치를 주는 단서가 2개 이상이면 너무 쉬움
    if (clues.filter((c) => c.k === "at" && c.yes).length > 1) continue;
    return { ...W, clues, stmts, seed };
  }
  throw new Error("사건을 만들지 못했어요");
}

// ───────── 날짜 · 사건 번호 · 기록 ─────────
/** KST 날짜 "YYYYMMDD" */
export function kstDay(now = Date.now()): string {
  const d = new Date(now + 9 * 3600e3);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}
/** 사건 #1 = 처음 연 날 */
export const FIRST_CASE_DAY = "20261104";
const utcOf = (day: string) => Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8));
export const caseNo = (day: string) => Math.floor((utcOf(day) - utcOf(FIRST_CASE_DAY)) / 864e5) + 1;
export const dayLabel = (day: string) => `${+day.slice(4, 6)}월 ${+day.slice(6, 8)}일`;
/** 랭킹 칸 이름 "YYYYMMDD_tier" */
export const caseKey = (day: string, tier: TierId) => `${day}_${tier}`;
export const CASE_RE = /^(\d{8})_(easy|normal|hard|hell)$/;
/** 회원이 사건을 처음 풀었을 때 GP */
export const DAILY_GP: Record<TierId, number> = { easy: 200, normal: 300, hard: 500, hell: 1000 };
/** 제출한 동선표가 정답인지 (서버가 같은 시드로 사건을 다시 만들어서 확인) */
export const isSolution = (C: World, cell: number[][], it: number[]) =>
  cell.length === C.T &&
  it.length === C.n &&
  C.pos.every((a, t) => cell[t]?.length === C.n && a.every((r, p) => cell[t][p] === r)) &&
  C.item.every((i, p) => it[p] === i);
/** 오늘의 사건 시드 — 같은 날 같은 난이도는 누구나 같은 사건 */
export const dailySeed = (day: string, tier: TierId) => hashStr(`${day}:${tier}:casefile-v1`);

/** 기록 (초) = 걸린 시간 + 오답 × 2분 */
export const PENALTY = 120;
export const scoreOf = (time: number, wrong: number) =>
  Math.round((time + wrong * PENALTY) * 10) / 10;

// ───────── 글 ─────────
const hasBatchim = (w: string) => {
  const c = w.charCodeAt(w.length - 1) - 44032;
  return c >= 0 && c <= 11171 && c % 28 !== 0;
};
export const josa = (w: string, a: string, b: string) => w + (hasBatchim(w) ? a : b);
const cop = (w: string) => w + (hasBatchim(w) ? "이다" : "다");
/** 「로 / 으로」 (ㄹ 받침은 로) */
export const ro = (w: string) => {
  const c = w.charCodeAt(w.length - 1) - 44032;
  const j = c >= 0 && c <= 11171 ? c % 28 : 0;
  return w + (j === 0 || j === 8 ? "로" : "으로");
};
export const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
export const slotLabel = (W: World, t: number) => `${hhmm(W.slots[t][0])}–${hhmm(W.slots[t][1])}`;

function attrText(a: string, op: string, v: number | string): string {
  if (a === "h") return op === ">=" ? `키 ${v}cm 이상` : `키 ${v}cm 미만`;
  if (a === "hand") return `${v}잡이`;
  if (a === "wt") return v === "무거움" ? "무거운 물건" : "가벼운 물건";
  return "";
}

/** 단서 글 (증거 문서 말투) + 출처 */
export function clueText(W: World, c: Clue): [string, string] {
  const P = (p: number) => W.people[p].name;
  const R = (r: number) => W.rooms[r].name;
  const I = (i: number) => W.items[i].name;
  const t = (x: number) => slotLabel(W, x);
  switch (c.k) {
    case "own":
      return c.yes
        ? [`${josa(I(c.i), "은", "는")} ${P(c.p)}의 것이다.`, "소지품 조사"]
        : [`${P(c.p)}에게서 ${josa(I(c.i), "은", "는")} 나오지 않았다.`, "소지품 조사"];
    case "at":
      return c.yes
        ? [`${josa(P(c.p), "은", "는")} ${t(c.t)}에 ${R(c.r)}에 있었다.`, "출입 기록"]
        : [`${josa(P(c.p), "은", "는")} ${t(c.t)}에 ${R(c.r)}에 없었다.`, "출입 기록"];
    case "iat":
      return c.yes
        ? [
            `${josa(I(c.i), "을", "를")} 가진 사람은 ${t(c.t)}에 ${R(c.r)}에 있었다.`,
            `${R(c.r)}에서 나온 흔적`,
          ]
        : [`${josa(I(c.i), "을", "를")} 가진 사람은 ${t(c.t)}에 ${R(c.r)}에 없었다.`, "흔적 감식"];
    case "iattr":
      return [
        `${josa(I(c.i), "을", "를")} 가진 사람은 ${cop(attrText(c.a, c.op, c.v))}.`,
        c.a === "h" ? "손자국 높이 감정" : "쥔 자국 감정",
      ];
    case "rattr":
      return [
        `${t(c.t)}에 ${R(c.r)}에 있던 사람은 ${cop(attrText(c.a, c.op, c.v))}.`,
        c.a === "h" ? "창에 비친 그림자" : "문고리 지문 방향",
      ];
    case "ritem":
      return [
        `${t(c.t)}에 ${R(c.r)}에 있던 사람은 ${c.a === "mat" ? `${ro(c.v)} 된 물건을` : `${attrText(c.a, "=", c.v)}을`} 지니고 있었다.`,
        c.a === "mat" ? "바닥에 떨어진 부스러기" : "바닥에 눌린 자국",
      ];
    case "pitem":
      return [`${P(c.p)}의 물건은 ${ro(c.v)} 된 것${c.yes ? "이다" : "이 아니다"}.`, "소지품 조사"];
    case "with":
      return c.yes
        ? [
            `${t(c.t)}에 ${josa(P(c.p), "과", "와")} ${josa(P(c.q), "은", "는")} 문으로 바로 이어진 두 방에 있었다.`,
            "문 너머로 나눈 대화",
          ]
        : [
            `${t(c.t)}에 ${josa(P(c.p), "과", "와")} ${josa(P(c.q), "은", "는")} 문으로 바로 이어진 방에 있지 않았다.`,
            "서로 소리를 못 들음",
          ];
  }
}

/** 진술 글 (말한 사람 말투) */
export function stmtText(W: World, s: Stmt): string {
  const R = (r: number) => W.rooms[r].name;
  const I = (i: number) => W.items[i].name;
  const N = (q: number) => W.people[q].name;
  const t = (x: number) => slotLabel(W, x);
  const salt =
    s.by * 7 +
    ("t" in s ? s.t * 3 : 0) +
    ("r" in s ? s.r : 0) +
    ("i" in s ? s.i : 0) +
    ("q" in s ? s.q : 0);
  const v = (a: string[]) => a[salt % a.length];
  switch (s.k) {
    case "own":
      return v([
        `${josa(I(s.i), "은", "는")} 제 것이 아닙니다. 손도 안 댔어요.`,
        `${josa(I(s.i), "이", "가")} 어디 있었는지도 몰랐습니다.`,
        `저는 ${josa(I(s.i), "을", "를")} 만진 적도 없어요.`,
      ]);
    case "at":
      return s.yes
        ? v([`${t(s.t)}에는 ${R(s.r)}에 있었습니다.`, `그 시간(${t(s.t)})엔 ${R(s.r)}에 있었죠.`])
        : v([
            `${t(s.t)}에 ${R(s.r)}엔 간 적도 없어요.`,
            `${t(s.t)}에 저는 ${R(s.r)} 근처에도 없었습니다.`,
            `${t(s.t)}엔 ${R(s.r)}에 들른 적도 없어요.`,
          ]);
    case "with":
      return s.yes
        ? v([
            `${t(s.t)}에 ${N(s.q)} 씨랑은 문 하나 사이였어요. 목소리가 들렸거든요.`,
            `${t(s.t)}엔 ${N(s.q)} 씨 바로 옆방에 있었습니다.`,
          ])
        : v([
            `${t(s.t)}에 ${N(s.q)} 씨랑은 떨어져 있었어요. 바로 옆방도 아니었고요.`,
            `${t(s.t)}엔 ${N(s.q)} 씨 옆방에 없었습니다.`,
          ]);
    case "pitem":
      if (s.a === "wt")
        return (s.v === "무거움") === s.yes
          ? "제가 들고 있던 건 꽤 무거운 물건이었어요."
          : "저는 무거운 건 들고 있지도 않았어요.";
      return s.yes ? `제 물건은 ${ro(s.v)} 된 거예요.` : `제 물건은 ${ro(s.v)} 된 게 아닙니다.`;
    default:
      return "";
  }
}
