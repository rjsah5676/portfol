import { addToSyllable, CONS_W, decompose, isCons, joinJamo, JUNG, pick, syllableStroke, VOWEL_RECIPES, VOWS_W } from "./jamo";
import { gradeOf, hangulLen, LINE_MAX, type Judge } from "./judge";

/*
 * 니들이 한글을 알아? — 게임 진행 (화면과 따로, 숫자만)
 *
 *   뽑기 → 자음칸 · 모음칸에 자모가 쌓임
 *   자모를 합치면 글자칸에 글자 (글자는 약하게 싸움)
 *   글자 · 낱말을 누르면 문장칸(원고지)에 이어 붙음 → 서버가 읽어 줌(형태소 분석)
 *     · 낱말 하나면 [낱말로 묶기] → 단어칸에 낱말 (품사마다 싸우는 방식이 다름)
 *     · 종결어미로 끝나면 [문장 완성] → 화면 전체 낭독 공격 + 점수 + 기세(모든 피해) 영구 상승, 쓴 글자는 사라짐
 *   먹물 얼룩은 판 둘레를 끝없이 돌고, 쌓인 양이 LOAD_MAX 를 넘으면 끝. 웨이브는 끝없이.
 */

export type Zone = "c" | "v" | "s" | "w";
/** 칸 수. 자음 · 모음칸은 같은 자모가 한 칸에 STACK_MAX 개까지 쌓임 */
export const CAP: Record<Zone, number> = { c: 10, v: 6, s: 16, w: 12 };
export const STACK_MAX = 99;
export const ZONE_NAME: Record<Zone, string> = { c: "자음칸", v: "모음칸", s: "글자칸", w: "단어칸" };

export interface Unit {
  id: number;
  /** j = 자모 · s = 글자 · w = 낱말 */
  kind: "j" | "s" | "w";
  text: string;
  /** 낱말의 품사 (명사 · 동사 · 형용사 · 부사 · 감탄사 …) */
  pos?: string;
  cd: number;
  /** 문장칸에 넣기 전에 있던 칸 (되돌릴 때) */
  from?: Zone;
  /** 자모: 이 칸에 쌓인 개수 */
  n?: number;
}

export interface Enemy {
  id: number;
  d: number;
  hp: number;
  max: number;
  boss: boolean;
  slow: number;
  slowT: number;
  stun: number;
  x: number;
  y: number;
  seed: number;
}

export interface Shot {
  from: number;
  to: Enemy;
  t: number;
  color: string;
  glyph: string;
  r?: number;
}
export interface Fx {
  x: number;
  y: number;
  t: number;
  kind: "die" | "boom" | "read";
  r?: number;
  color?: string;
}

export interface Sentence {
  text: string;
  points: number;
  wave: number;
  /** 말맛 등급 (명문 · 말 됨 · 억지) */
  grade: string;
}

// 주인공은 문장 만들기 — 디펜스는 가벼운 압박만 (뽑기 싸게, 체력은 천천히)
export const DRAW_COST = 1;
export const LOAD_MAX = 100;
const WAVE_SEC = 20;
const LAP_SEC = 15;

export const waveHp = (w: number) => Math.round(14 * 1.1 ** (w - 1));

/** 낱말 품사마다 싸우는 방식 (dmg = 기본 × 글자 수^1.5) */
export const POS_STYLE: Record<string, { dmg: number; rate: number; splash?: number; slow?: number; stun?: number; color: string; desc: string }> = {
  명사: { dmg: 8, rate: 0.9, color: "#1e1b18", desc: "한 놈을 세게" },
  대명사: { dmg: 8, rate: 0.9, color: "#1e1b18", desc: "한 놈을 세게" },
  수사: { dmg: 8, rate: 0.9, color: "#1e1b18", desc: "한 놈을 세게" },
  동사: { dmg: 5, rate: 0.7, splash: 70, color: "#b3261e", desc: "맞은 곳 둘레까지" },
  형용사: { dmg: 4, rate: 0.8, splash: 50, slow: 0.4, color: "#2f5e8c", desc: "둘레를 느리게" },
  부사: { dmg: 3.5, rate: 2.2, color: "#7a5a1e", desc: "빠르게 연사" },
  관형사: { dmg: 3.5, rate: 2.2, color: "#7a5a1e", desc: "빠르게 연사" },
  감탄사: { dmg: 4, rate: 0.5, splash: 60, stun: 0.6, color: "#7a3b8f", desc: "둘레를 기절" },
};
const styleOf = (pos?: string) => POS_STYLE[pos ?? "명사"] ?? POS_STYLE["명사"];

export interface Game {
  t: number;
  gold: number;
  wave: number;
  nextWave: number;
  spawnLeft: number;
  spawnT: number;
  spawnBoss: boolean;
  zones: Record<Zone, (Unit | null)[]>;
  line: Unit[];
  enemies: Enemy[];
  shots: Shot[];
  fx: Fx[];
  /** 기세: 모든 피해에 곱함. 문장을 완성할 때마다 오름 */
  power: number;
  sentences: Sentence[];
  /** 문장 점수 합 */
  points: number;
  kills: number;
  over: boolean;
  /** 판 둘레 (그리는 쪽이 정함) */
  path: { x: number; y: number; w: number; h: number };
  seq: number;
  /** 화면에 띄울 한 줄 알림 */
  note: { text: string; at: number } | null;
}

export function newGame(): Game {
  return {
    t: 0,
    gold: 36,
    wave: 0,
    nextWave: 4,
    spawnLeft: 0,
    spawnT: 0,
    spawnBoss: false,
    zones: { c: Array(CAP.c).fill(null), v: Array(CAP.v).fill(null), s: Array(CAP.s).fill(null), w: Array(CAP.w).fill(null) },
    line: [],
    enemies: [],
    shots: [],
    fx: [],
    power: 1,
    sentences: [],
    points: 0,
    kills: 0,
    over: false,
    path: { x: 0, y: 0, w: 100, h: 100 },
    seq: 1,
    note: null,
  };
}

export const say = (g: Game, text: string) => (g.note = { text, at: g.t });
export const load = (g: Game) => g.enemies.reduce((s, e) => s + (e.boss ? 10 : 1), 0);
export const score = (g: Game) => g.points + g.wave * 100;
export const lineText = (g: Game) => g.line.map((u) => u.text).join("");
export const best = (g: Game): Sentence | null =>
  g.sentences.reduce<Sentence | null>((b, s) => (!b || s.points > b.points ? s : b), null);

const free = (g: Game, z: Zone) => g.zones[z].indexOf(null);
const unit = (g: Game, kind: Unit["kind"], text: string, pos?: string): Unit => ({ id: g.seq++, kind, text, pos, cd: Math.random() });

function put(g: Game, z: Zone, u: Unit, at = free(g, z)): boolean {
  if (at < 0) return false;
  g.zones[z][at] = u;
  return true;
}

export const zoneOfJamo = (j: string): Zone => (isCons(j) ? "c" : "v");
const countOf = (u: Unit | null) => (u ? (u.n ?? 1) : 0);

/** 자모 하나 넣기: 같은 자모가 있으면 그 칸에 쌓고(×n), 없으면 빈 칸에 */
function addJamo(g: Game, j: string): boolean {
  const z = zoneOfJamo(j);
  const same = g.zones[z].find((u) => u?.text === j && countOf(u) < STACK_MAX);
  if (same) return (same.n = countOf(same) + 1), true;
  const u = unit(g, "j", j);
  u.n = 1;
  return put(g, z, u);
}
/** 자모 칸에서 하나 덜어냄 (다 쓰면 칸이 빔) */
function takeJamo(g: Game, z: Zone, i: number) {
  const u = g.zones[z][i];
  if (!u) return;
  if (countOf(u) > 1) u.n = countOf(u) - 1;
  else g.zones[z][i] = null;
}
const hasRoomFor = (g: Game, j: string) => {
  const z = zoneOfJamo(j);
  return g.zones[z].some((u) => !u || (u.text === j && countOf(u) < STACK_MAX));
};

/** 뽑기 한 번: 자음 42% · 모음 재료(천지인) 58% — 모음은 보통 재료 두 개가 듦. 쌓을 데가 없는 자모가 나오면 쌓을 수 있는 걸로 다시 뽑음 */
export function draw(g: Game, n = 1): number {
  let got = 0;
  for (let k = 0; k < n; k++) {
    if (g.gold < DRAW_COST) break;
    let j = "";
    for (let t = 0; t < 12 && !j; t++) {
      const c = pick(Math.random() < 0.42 ? CONS_W : VOWS_W);
      if (hasRoomFor(g, c)) j = c;
    }
    if (!j) break;
    g.gold -= DRAW_COST;
    addJamo(g, j);
    got++;
  }
  if (!got) say(g, g.gold < DRAW_COST ? "엽전이 모자라요" : "자음칸 · 모음칸이 꽉 찼어요");
  return got;
}

/**
 * 자모(먼저 누른 a)를 b 에 합치기. 합쳤으면 true. 누른 순서가 곧 천지인 입력 순서 (a → b).
 * 같은 칸을 두 번 누르면 그 칸끼리 (ㄱ×2 → ㄲ, ㆍ×2 → ㆍㆍ)
 */
export function combine(g: Game, za: Zone, ia: number, zb: Zone, ib: number): boolean {
  const A = g.zones[za][ia], B = g.zones[zb][ib];
  if (!A || !B || A.kind !== "j") return false;
  const self = za === zb && ia === ib;
  if (B.kind === "j") {
    if (self && countOf(A) < 2) return false;
    const r = joinJamo(A.text, B.text);
    if (!r) return false;
    if ("syllable" in r) {
      const at = free(g, "s");
      if (at < 0) return say(g, "글자칸이 꽉 찼어요"), false;
      takeJamo(g, za, ia);
      takeJamo(g, zb, ib);
      put(g, "s", unit(g, "s", r.syllable), at);
    } else {
      takeJamo(g, za, ia);
      takeJamo(g, zb, ib);
      if (!addJamo(g, r.jamo)) {
        addJamo(g, A.text);
        addJamo(g, B.text);
        return say(g, "칸이 꽉 차서 못 합쳐요"), false;
      }
    }
    return true;
  }
  if (B.kind === "s") {
    const s = addToSyllable(B.text, A.text);
    if (!s) return false;
    takeJamo(g, za, ia);
    B.text = s;
    return true;
  }
  return false;
}

/**
 * 자동 짝짓기: 자음마다 가진 재료로 만들 수 있는 모음을 하나 골라(자주 쓰는 모음일수록 잘 고름) 글자로.
 * 이미 만들어 둔 모음(ㅏ 등)이 있으면 그것부터 씀.
 */
export function autoPair(g: Game): number {
  let n = 0;
  const stock = () => {
    const m = new Map<string, number>();
    for (const u of g.zones.v) if (u) m.set(u.text, (m.get(u.text) ?? 0) + countOf(u));
    return m;
  };
  const slotOf = (z: Zone, j: string) => g.zones[z].findIndex((u) => u?.text === j);
  for (let guard = 0; guard < 40 && free(g, "s") >= 0; guard++) {
    const cs = g.zones.c.map((u, i) => (u ? i : -1)).filter((i) => i >= 0);
    if (!cs.length) break;
    const st = stock();
    // 이미 만들어 둔 모음(ㅏ ㅓ …)부터. ㅡ ㅣ 는 재료이기도 해서 여기선 빼고 아래 만드는 법에서 같이 고름
    const ready = [...st.keys()].filter((v) => JUNG.includes(v) && v !== "ㅡ" && v !== "ㅣ");
    let vowel: string | null = null;
    if (ready.length) vowel = ready[Math.floor(Math.random() * ready.length)];
    else {
      const ok = VOWEL_RECIPES.filter((r) => {
        const need = new Map<string, number>();
        for (const x of r.need) need.set(x, (need.get(x) ?? 0) + 1);
        return [...need].every(([x, c]) => (st.get(x) ?? 0) >= c);
      });
      if (!ok.length) break;
      let roll = Math.random() * ok.reduce((s, r) => s + r.w, 0);
      const r = ok.find((x) => (roll -= x.w) < 0) ?? ok[0];
      for (const x of r.need) takeJamo(g, "v", slotOf("v", x));
      if (!addJamo(g, r.v)) {
        for (const x of r.need) addJamo(g, x);
        break;
      }
      vowel = r.v;
    }
    const ci = cs[Math.floor(Math.random() * cs.length)];
    if (!combine(g, "c", ci, "v", slotOf("v", vowel))) break;
    n++;
  }
  if (!n) say(g, free(g, "s") < 0 ? "글자칸이 꽉 찼어요" : "짝지을 자음 · 모음이 없어요");
  return n;
}

/** 글자 · 낱말을 문장칸 끝에 붙임 */
export function toLine(g: Game, z: Zone, i: number): boolean {
  const u = g.zones[z][i];
  if (!u || u.kind === "j") return false;
  if (hangulLen(lineText(g)) + hangulLen(u.text) > LINE_MAX) return say(g, `문장칸은 ${LINE_MAX}글자까지예요`), false;
  g.zones[z][i] = null;
  u.from = z;
  g.line.push(u);
  return true;
}

/** 문장칸에 넣을 수 있는 것들 (글자칸 · 단어칸, 최대 18개) — 뭐 되지? 에 보냄 */
export const pieces = (g: Game): Unit[] =>
  [...g.zones.s, ...g.zones.w].filter((u): u is Unit => !!u).slice(0, 18);

/** 유닛 id 순서대로 문장칸에 붙임 (그 사이 없어졌으면 안 붙임) */
export function addByIds(g: Game, ids: number[]): boolean {
  const at = ids.map((id) => {
    for (const z of ["s", "w"] as const) {
      const i = g.zones[z].findIndex((u) => u?.id === id);
      if (i >= 0) return { z, i };
    }
    return null;
  });
  if (at.some((x) => !x)) return say(g, "그 사이 글자가 바뀌었어요"), false;
  for (const x of at) toLine(g, x!.z, x!.i);
  return true;
}

/** 문장칸에서 하나 빼서 원래 칸으로 (자리가 없으면 다른 칸 아무 데나) */
export function fromLine(g: Game, k: number): boolean {
  const u = g.line[k];
  if (!u) return false;
  const z = u.from ?? (u.kind === "w" ? "w" : "s");
  const at = free(g, z);
  if (at < 0) return say(g, `${ZONE_NAME[z]}이 꽉 차서 못 빼요`), false;
  g.line.splice(k, 1);
  put(g, z, u, at);
  return true;
}

/** 문장칸 전체를 낱말 하나로 묶어 단어칸에 */
export function bindWord(g: Game, j: Judge): boolean {
  if (!j.word || j.text !== lineText(g)) return false;
  const at = free(g, "w");
  if (at < 0) return say(g, "단어칸이 꽉 찼어요 (팔거나 문장에 쓰세요)"), false;
  g.line = [];
  put(g, "w", unit(g, "w", j.text, j.word), at);
  return true;
}

/** 문장 완성: 낭독 공격 + 점수 + 기세 */
export function finishSentence(g: Game, j: Judge): Sentence | null {
  if (!j.sentence || j.text !== lineText(g)) return null;
  const n = hangulLen(j.text);
  const s = { text: j.text, points: j.points, wave: g.wave, grade: gradeOf(j.nat)?.name ?? "" };
  g.sentences.push(s);
  g.points += j.points;
  g.line = [];
  const dmg = j.points * 0.6 * g.power;
  for (const e of g.enemies) e.hp -= dmg;
  g.power += 0.02 * n;
  g.gold += n * 2;
  g.fx.push({ x: g.path.x + g.path.w / 2, y: g.path.y + g.path.h / 2, t: 0, kind: "read", r: Math.max(g.path.w, g.path.h) });
  return s;
}

export function sell(g: Game, z: Zone, i: number): number {
  const u = g.zones[z][i];
  if (!u) return 0;
  const v = u.kind === "j" ? 1 : u.kind === "s" ? 2 : hangulLen(u.text) * 3;
  if (u.kind === "j") takeJamo(g, z, i); // 쌓인 자모는 하나씩
  else g.zones[z][i] = null;
  g.gold += v;
  return v;
}

/** 유닛 하나가 싸우는 값 (설명용으로도 씀) */
export function statsOf(g: Game, u: Unit) {
  if (u.kind === "j") return null;
  if (u.kind === "s") {
    const st = syllableStroke(u.text);
    return { dmg: (3 + st * 0.8) * g.power, rate: 1, color: "#5a5248" } as const;
  }
  const s = styleOf(u.pos);
  const n = Math.max(1, hangulLen(u.text));
  return { ...s, dmg: s.dmg * n ** 1.5 * g.power };
}

// ── 판 둘레 ──
function perimeter(g: Game) {
  return 2 * (g.path.w + g.path.h);
}
function pathPos(g: Game, d: number): [number, number] {
  const { x, y, w, h } = g.path;
  const P = perimeter(g);
  d = ((d % P) + P) % P;
  if (d < w) return [x + d, y];
  d -= w;
  if (d < h) return [x + w, y + d];
  d -= h;
  if (d < w) return [x + w - d, y + h];
  d -= w;
  return [x, y + h - d];
}

function spawn(g: Game, boss: boolean) {
  const hp = waveHp(g.wave) * (boss ? 20 : 1);
  g.enemies.push({ id: g.seq++, d: 0, hp, max: hp, boss, slow: 0, slowT: 0, stun: 0, x: g.path.x, y: g.path.y, seed: Math.random() * 1000 });
}

function hit(g: Game, e: Enemy, dmg: number, st: { slow?: number; stun?: number }) {
  e.hp -= dmg;
  if (st.slow) (e.slow = st.slow), (e.slowT = 2);
  if (st.stun && !e.boss) e.stun = Math.max(e.stun, st.stun);
}

export function step(g: Game, dt: number) {
  if (g.over) return;
  g.t += dt;
  g.nextWave -= dt;
  if (g.nextWave <= 0) {
    g.wave++;
    const boss = g.wave % 10 === 0;
    g.spawnLeft = boss ? 1 : 8 + Math.min(22, g.wave);
    g.spawnBoss = boss;
    g.spawnT = 0;
    g.nextWave = WAVE_SEC;
    g.gold += 8 + g.wave;
    if (boss) say(g, `${g.wave}웨이브 · 왕먹물 (얼룩 10마리 몫)`);
  }
  // 뽑기 주구장창: 1초에 1냥씩 꾸준히 들어옴
  if (Math.floor(g.t) > Math.floor(g.t - dt)) g.gold += 1;
  if (g.spawnLeft > 0 && (g.spawnT -= dt) <= 0) {
    spawn(g, g.spawnBoss);
    g.spawnLeft--;
    g.spawnT = 0.5;
  }
  const speed = perimeter(g) / LAP_SEC;
  for (const e of g.enemies) {
    if (e.stun > 0) e.stun -= dt;
    else e.d += speed * (e.boss ? 0.6 : 1) * (e.slowT > 0 ? 1 - e.slow : 1) * dt;
    if (e.slowT > 0) e.slowT -= dt;
    [e.x, e.y] = pathPos(g, e.d);
  }
  // 글자칸 · 단어칸 유닛이 쏨 (문장칸에 올린 건 안 쏨). 판 어디든 닿음 — 가장 오래 돈 얼룩부터
  const live = g.enemies.filter((e) => e.hp > 0).sort((a, b) => b.d - a.d);
  for (const z of ["s", "w"] as const)
    for (const u of g.zones[z]) {
      if (!u) continue;
      const st = statsOf(g, u);
      if (!st) continue;
      u.cd -= dt * st.rate;
      if (u.cd > 0) continue;
      if (!live.length) {
        u.cd = 0;
        continue;
      }
      u.cd = 1;
      const target = live[Math.min(live.length - 1, Math.floor(Math.random() * 3))];
      const splash = "splash" in st ? st.splash : undefined;
      const hitList = splash ? live.filter((e) => Math.hypot(e.x - target.x, e.y - target.y) <= splash) : [target];
      for (const e of hitList) hit(g, e, st.dmg, st as { slow?: number; stun?: number });
      g.shots.push({ from: u.id, to: target, t: 0, color: st.color, glyph: u.text[0], r: splash });
    }
  for (const s of g.shots) s.t += dt;
  g.shots = g.shots.filter((s) => s.t < 0.25);
  for (const e of g.enemies)
    if (e.hp <= 0) {
      g.kills++;
      g.gold += e.boss ? 30 : 2;
      g.fx.push({ x: e.x, y: e.y, t: 0, kind: "die" });
    }
  g.enemies = g.enemies.filter((e) => e.hp > 0);
  for (const f of g.fx) f.t += dt;
  g.fx = g.fx.filter((f) => f.t < (f.kind === "read" ? 1.2 : 0.6));
  if (load(g) >= LOAD_MAX) g.over = true;
}

/** 판 둘레 바꾸기 (화면 크기가 바뀔 때) — 얼룩은 같은 비율 자리로 */
export function setPath(g: Game, p: Game["path"]) {
  const before = perimeter(g);
  g.path = p;
  const k = perimeter(g) / before;
  for (const e of g.enemies) e.d *= k;
}

/** 문장칸 글자들이 어느 유닛 것인지 (원고지 칸 색 구분용) */
export function lineCells(g: Game): { ch: string; unit: number; k: number }[] {
  const out: { ch: string; unit: number; k: number }[] = [];
  g.line.forEach((u, k) => [...u.text].forEach((ch) => out.push({ ch, unit: u.id, k })));
  return out;
}

export { decompose };
