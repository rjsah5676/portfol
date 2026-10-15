/**
 * 격투 경기 기록 분석 (관리자 데이터 관리 「격투 경기 기록 → 전체 JSON 받기」로 받은 파일)
 *   npx tsx scripts/fight-replays-report.ts fight-replays-2026-10-15.json [--jsonl out.jsonl]
 *
 * 기록은 입력만 있어서 같은 빌드 sim 으로 다시 돌림 → 사람 자리의 프레임마다 상황 + 입력을 보고
 *   · 다시 돌린 결과가 저장된 승패와 맞나 (빌드가 다르면 안 맞음)
 *   · 버튼 습관 (분당 입력, 버튼별 비율, 가드 · 점프 · 가만히 비율)
 *   · 반응: 상대 공격이 시작된 뒤 처음 입력을 바꾸기까지 프레임, 그때 가드했나
 *   · 거리별로 고른 기술, 기술 다음 기술 (자주 쓰는 연결)
 * 를 모드 · 레이팅 구간별로 요약. --jsonl 이면 프레임 줄(상황 + 입력)을 파일로도 씀 (학습용)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { CHARS } from "../../web/src/lib/fight/chars";
import { BUILD_ID, IN, newMatch, step, type State } from "../../web/src/lib/fight/sim";
import { AI_ID, FightAI, aiForRating } from "../../web/src/lib/fight/ai";

type Rle = [number, number][];
interface Replay {
  _id: string;
  at: number;
  mode: "pvp" | "rank" | "rankbot" | "ai";
  build: string;
  uids: [string | null, string | null];
  guest?: [boolean, boolean];
  rs: [number | null, number | null];
  chars: [number, number];
  map: number;
  out: 0 | 1 | 2 | null;
  seed?: number;
  botR?: number;
  level?: number;
  delay?: number;
  inputs?: [Rle | null, Rle | null];
  chunks?: [{ f: number; i: string }[], { f: number; i: string }[]];
  frames?: number;
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--jsonl");
if (!file) throw new Error("JSON 파일 경로를 주세요");
const byPlayer = args.includes("--by-player");
const anon = new Map<string, string>();
const who = (uid: string | null) => (uid ? (anon.has(uid) ? anon.get(uid)! : (anon.set(uid, `사람${String.fromCharCode(65 + anon.size)}`), anon.get(uid)!)) : "?");
const jsonlOut = args.includes("--jsonl") ? args[args.indexOf("--jsonl") + 1] : null;
const all = (JSON.parse(readFileSync(file, "utf8")) as { replays: Replay[] }).replays;
const MY_BUILD = `${BUILD_ID}:${AI_ID}`;

const unRle = (r: Rle | null | undefined) => {
  const out: number[] = [];
  for (const [v, n] of r ?? []) for (let k = 0; k < n; k++) out.push(v);
  return out;
};
const dec = (v: string) => (v ? v.split(",").map((x) => parseInt(x, 36) || 0) : []);
const fromChunks = (cs: { f: number; i: string }[]) => {
  const out: number[] = [];
  for (const c of cs) dec(c.i).forEach((x, k) => (out[c.f + k] = x));
  for (let k = 0; k < out.length; k++) out[k] ??= 0;
  return out;
};
const bucket = (r: Replay, seat: number) => {
  if (byPlayer) return `${who(r.uids[seat])}${r.rs[seat] != null ? `(${r.rs[seat]})` : ""}`;
  if (r.mode === "ai") return `CPU ${r.level}단계`;
  const x = r.rs[seat];
  if (x == null) return "레이팅 없음";
  return x < 900 ? "~900" : x < 1100 ? "900~1100" : x < 1300 ? "1100~1300" : x < 1600 ? "1300~1600" : x < 1900 ? "1600~1900" : "1900~";
};
const BTN: [string, number][] = [
  ["약(J)", IN.A],
  ["발차기(K)", IN.B],
  ["아이덴티티(L)", IN.C],
  ["필살기(I)", IN.X],
  ["점프", IN.J | IN.U],
];

interface Agg {
  games: number;
  frames: number;
  presses: Map<string, number>;
  guard: number;
  idle: number;
  react: number[];
  reactGuard: number;
  reactN: number;
  moveByDist: Map<string, Map<string, number>>;
  next: Map<string, number>;
  wins: number;
  /** 상대 공격 시작 때 자유로운 상태였으면: 처음 새로 누른 것까지 프레임 · 뭘 눌렀나 */
  react2: number[];
  reactKind: Map<string, number>;
  /** 상대 공격이 나한테 맞음 / 막음 */
  gotHit: number;
  blocked: number;
  /** 내 기술 끝났는데 안 닿음 / 닿음 */
  whiff: number;
  landed: number;
  /** 일어난 뒤 1초 안에 처음 한 것 */
  wake: Map<string, number>;
  /** 콤보: 내가 상대를 연속으로 때린 묶음 */
  combos: { n: number; dmg: number; seq: string; air: number; start: string }[];
  /** 이벤트 수 (대시 · 필살기 · 잡기 · 잡기 풀기 · 저스트 가드 · 카운터 · 띄우기) */
  ev: Map<string, number>;
  grabbedN: number;
  /** 게이지 꽉 찬 뒤 필살기 쓰기까지 프레임 */
  superWait: number[];
  fullFrames: number;
  /** 상대 기술 헛침 → 20프레임 안에 내가 때림 */
  whiffOpp: number;
  whiffPun: number;
  /** 기술 끝날 때 약·발차기 연속 동작 단계 */
  chainEnd: Map<number, number>;
  /** 상대가 공중 · 내가 땅일 때 처음 한 것 (대공) */
  aa: Map<string, number>;
  /** 내가 다운시킨 뒤 상대 일어날 때 내가 한 것 (압박) */
  oki: Map<string, number>;
}
const newAgg = (): Agg => ({ games: 0, frames: 0, presses: new Map(), guard: 0, idle: 0, react: [], reactGuard: 0, reactN: 0, moveByDist: new Map(), next: new Map(), wins: 0, react2: [], reactKind: new Map(), gotHit: 0, blocked: 0, whiff: 0, landed: 0, wake: new Map(), combos: [], ev: new Map(), grabbedN: 0, superWait: [], fullFrames: 0, whiffOpp: 0, whiffPun: 0, chainEnd: new Map(), aa: new Map(), oki: new Map() });
const aggs = new Map<string, Agg>();
const agg = (k: string) => (aggs.has(k) ? aggs.get(k)! : (aggs.set(k, newAgg()), aggs.get(k)!));
const inc = <K>(m: Map<K, number>, k: K, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

let replayed = 0;
let matched = 0;
let skippedBuild = 0;
const lines: string[] = [];

for (const r of all) {
  if (r.build !== MY_BUILD) {
    skippedBuild++;
    continue;
  }
  const s: State = newMatch(r.chars, r.map);
  let ins: [number[], number[]];
  let ai: FightAI | null = null;
  let human: number[];
  if (r.mode === "ai" || r.mode === "rankbot") {
    ins = [unRle(r.inputs?.[0]), []];
    ai = new FightAI(aiForRating(r.botR ?? 0, CHARS[r.chars[1]].id), r.seed ?? 0);
    human = [0, 1];
  } else {
    ins = [fromChunks(r.chunks?.[0] ?? []), fromChunks(r.chunks?.[1] ?? [])];
    human = [0, 1];
  }
  const len = Math.max(ins[0].length, ins[1].length);
  const lastIn = [0, 0];
  const atkStart = [-1, -1]; // 상대 공격 시작 프레임 (반응 재기)
  const lastMv = ["", ""];
  const modeName = r.mode === "pvp" || r.mode === "rank" ? "사람vs사람" : r.mode === "rankbot" ? "랭크 봇전" : "CPU전";
  const keyOf = human.map((seat) =>
    ai && seat === 1 ? `[AI] ${modeName} 상대 봇` : `${modeName} · ${bucket(r, seat)}`
  );
  const pend = [-1, -1];
  const prevSt = ["", ""];
  const prevHit = [0, 0];
  const wakeAt = [-1, -1];
  const cur: ({ n: number; dmg: number; seq: string[]; air: number; start: string } | null)[] = [null, null];
  const fullAt = [-1, -1];
  const foeWhiff = [-1, -1];
  const prevFoeSt = ["", ""];
  const prevFoeHit = [0, 0];
  const aaPend = [false, false];
  const okiAt = [-1, -1];
  const prevGrab = [0, 0];
  const closeCombo = (seat: number, i: number) => {
    const c = cur[seat];
    if (!c) return;
    const seq: string[] = [];
    for (const m of c.seq) {
      const last = seq[seq.length - 1];
      const mm = /^(.+?)(?:×(\d+))?$/.exec(last ?? "");
      if (mm && mm[1] === m) seq[seq.length - 1] = `${m}×${(+(mm[2] ?? 1)) + 1}`;
      else seq.push(m);
    }
    agg(keyOf[i]).combos.push({ n: c.n, dmg: c.dmg, seq: seq.join(" "), air: c.air, start: c.start });
    cur[seat] = null;
  };
  human.forEach((seat, i) => (agg(keyOf[i]).games++, agg(keyOf[i]).wins += r.out === seat ? 1 : 0));
  let k = 0;
  while (s.phase !== "over" && k < len) {
    const inp: [number, number] = [ins[0][k] ?? 0, ai ? ai.next(s, 1) : (ins[1][k] ?? 0)];
    if (s.phase === "fight") {
      human.forEach((seat, i) => {
        const a = agg(keyOf[i]);
        const me = s.p[seat];
        const foe = s.p[1 - seat];
        const v = inp[seat];
        const pressed = v & ~lastIn[seat];
        const dist = Math.abs(me.x - foe.x) / 100; // 화면 px
        const dBucket = dist < 80 ? "붙음(<80)" : dist < 180 ? "가까움(80~180)" : dist < 320 ? "중간(180~320)" : "멂(320~)";
        a.frames++;
        if (v & IN.D) a.guard++;
        if (!v) a.idle++;
        for (const [name, b] of BTN) if (pressed & b) inc(a.presses, name);
        // 상대가 공격을 시작한 프레임 → 내가 입력을 바꾸기까지
        if (foe.st === "atk" && foe.t === 1) atkStart[seat] = k;
        if (atkStart[seat] >= 0 && v !== lastIn[seat]) {
          const dt = k - atkStart[seat];
          if (dt <= 40) {
            a.react.push(dt);
            a.reactN++;
            if (v & IN.D) a.reactGuard++;
          }
          atkStart[seat] = -1;
        }
        // 기술을 새로 낸 순간 (거리 · 이전 기술)
        if (me.st === "atk" && me.t === 1 && me.mv) {
          const mv = `${me.mv}${me.aerial ? "(공중)" : ""}`;
          if (!a.moveByDist.has(dBucket)) a.moveByDist.set(dBucket, new Map());
          inc(a.moveByDist.get(dBucket)!, mv);
          if (lastMv[seat]) inc(a.next, `${lastMv[seat]} → ${mv}`);
          lastMv[seat] = mv;
        }
        if (me.st !== "atk" && me.st !== "hit" && me.t > 60) lastMv[seat] = "";
        // 반응(새로): 상대 공격이 시작될 때 내가 자유로우면(가만히 · 걷기) 처음 새로 누른 것까지
        const free = me.st === "idle" || me.st === "walk";
        if (foe.st === "atk" && foe.t === 1 && free && !(v & IN.D)) pend[seat] = k;
        if (pend[seat] >= 0) {
          const dt = k - pend[seat];
          const np = pressed & (IN.D | IN.A | IN.B | IN.C | IN.X | IN.J | IN.U | IN.L | IN.R);
          if (np) {
            a.react2.push(dt);
            inc(a.reactKind, np & IN.D ? "가드" : np & (IN.J | IN.U) ? "점프" : np & (IN.A | IN.B | IN.C | IN.X) ? "맞받아치기" : (np & (me.face > 0 ? IN.R : IN.L)) ? "앞으로 걷기" : "뒤로 빠지기");
            pend[seat] = -1;
          } else if (dt > 45 || me.st === "hit" || me.st === "block") {
            inc(a.reactKind, me.st === "hit" ? "맞음(반응 없음)" : me.st === "block" ? "가드(이미 누름)" : "반응 없음");
            pend[seat] = -1;
          }
        }
        // 내 기술이 끝날 때 닿았나
        if (prevSt[seat] === "atk" && me.st !== "atk") prevHit[seat] ? a.landed++ : a.whiff++;
        prevHit[seat] = me.hit;
        // 일어난 뒤 첫 행동
        if (prevSt[seat] === "rise" && me.st !== "rise") wakeAt[seat] = k;
        if (wakeAt[seat] >= 0) {
          const np = pressed & (IN.D | IN.A | IN.B | IN.C | IN.X | IN.J | IN.U);
          if (np || k - wakeAt[seat] > 60) {
            inc(a.wake, !np ? "가만히" : np & IN.D ? "가드" : np & (IN.J | IN.U) ? "점프" : np & IN.X ? "필살기" : np & IN.C ? "아이덴티티" : "약·발차기");
            wakeAt[seat] = -1;
          }
        }
        // 게이지 꽉 참 → 필살기까지
        if (me.meter >= 100) {
          a.fullFrames++;
          if (fullAt[seat] < 0) fullAt[seat] = k;
        } else fullAt[seat] = -1;
        // 상대 헛침 → 내가 벌줬나
        if (prevFoeSt[seat] === "atk" && foe.st !== "atk" && !prevFoeHit[seat]) ((foeWhiff[seat] = k), a.whiffOpp++);
        if (foeWhiff[seat] >= 0 && k - foeWhiff[seat] > 20) foeWhiff[seat] = -1;
        prevFoeSt[seat] = foe.st;
        prevFoeHit[seat] = foe.hit;
        // 기술 끝 → 연속 동작 단계
        if (prevSt[seat] === "atk" && me.st !== "atk" && me.chain) inc(a.chainEnd, Math.min(me.chain, 4));
        // 대공: 상대가 공중으로 뜨고 가까울 때 내가 땅이면 처음 한 것
        const foeAir = foe.st === "jump" || (foe.st === "atk" && !!foe.aerial);
        const meAir = me.st === "jump" || (me.st === "atk" && !!me.aerial);
        if (foeAir && !meAir && free && dist < 180 && !aaPend[seat]) aaPend[seat] = true;
        if (aaPend[seat]) {
          const np = pressed & (IN.D | IN.A | IN.B | IN.C | IN.X | IN.J | IN.U);
          if (np) ((aaPend[seat] = false), inc(a.aa, np & IN.D ? "가드" : np & (IN.J | IN.U) ? "같이 점프" : np & IN.X ? "필살기" : np & IN.C ? "아이덴티티" : np & IN.B ? "발차기" : "약"));
          else if (!foeAir || me.st === "hit" || me.st === "block") ((aaPend[seat] = false), inc(a.aa, me.st === "hit" ? "맞음" : me.st === "block" ? "가드(이미)" : "안 함"));
        }
        // 압박: 상대가 일어나는 동안 · 직후 내가 한 것
        if (foe.st === "rise" && okiAt[seat] < 0) okiAt[seat] = k;
        if (okiAt[seat] >= 0 && foe.st !== "rise" && foe.st !== "down") {
          const np = pressed & (IN.D | IN.A | IN.B | IN.C | IN.X | IN.J | IN.U);
          const back = pressed & (me.face > 0 ? IN.L : IN.R);
          if (np || back || k - okiAt[seat] > 90) {
            inc(a.oki, !np && !back ? "기다림" : np & IN.D ? "가드" : np & (IN.J | IN.U) ? "점프" : np & (IN.A | IN.B) ? (dist < 80 ? "붙어서 약·발차기" : "멀리서 약·발차기") : np & (IN.C | IN.X) ? "아이덴티티·필살기" : "뒤로");
            okiAt[seat] = -1;
          }
        }
        if (me.grabbed && !prevGrab[seat]) a.grabbedN++;
        prevGrab[seat] = me.grabbed;
        prevSt[seat] = me.st;
        if (jsonlOut && k % 2 === 0)
          lines.push(
            JSON.stringify({
              id: r._id, mode: r.mode, b: bucket(r, seat), f: k, me: CHARS[me.ch].id, foe: CHARS[foe.ch].id,
              dx: Math.round(((foe.x - me.x) * me.face) / 100), dh: Math.round((foe.h - me.h) / 100), h: Math.round(me.h / 100),
              st: me.st, fst: foe.st, fmv: foe.mv, ft: foe.t, hp: me.hp, fhp: foe.hp, m: me.meter, in: v,
            })
          );
      });
    }
    lastIn[0] = inp[0];
    lastIn[1] = inp[1];
    const comboBefore = [s.p[0].combo, s.p[1].combo];
    const inAir = (q: State["p"][number]) => q.st === "jump" || (q.st === "atk" && !!q.aerial) || (q.st === "dash" && q.airDash > 0 && q.jumps > 0);
    const airBefore = [inAir(s.p[0]), inAir(s.p[1])];
    const meterBefore = [s.p[0].meter, s.p[1].meter];
    step(s, inp);
    for (const e of s.ev)
      human.forEach((seat, i) => {
        const a = agg(keyOf[i]);
        if (e.k === "hit" || e.k === "block" || e.k === "just") {
          if (e.p === 1 - seat) e.k === "hit" ? a.gotHit++ : a.blocked++;
        }
        if (e.k === "just" && e.p === 1 - seat) inc(a.ev, "저스트 가드");
        if (e.k === "hit" && e.p === seat) {
          if (!cur[seat] || comboBefore[1 - seat] === 0) {
            closeCombo(seat, i);
            cur[seat] = { n: 0, dmg: 0, seq: [], air: 0, start: `${e.m ?? "?"}${airBefore[seat] ? "(공중)" : ""}` };
          }
          const c = cur[seat]!;
          c.n++;
          c.dmg += e.v;
          c.seq.push(e.m ?? "?");
          if (airBefore[seat]) c.air++;
          if (foeWhiff[seat] >= 0) ((a.whiffPun++), (foeWhiff[seat] = -1));
        }
        if (e.p !== seat) return;
        if (e.k === "dash") inc(a.ev, e.v === 1 ? "공중 대시" : "대시");
        if (e.k === "super") {
          inc(a.ev, "필살기");
          if (fullAt[seat] >= 0) a.superWait.push(k - fullAt[seat]);
          void meterBefore;
        }
        if (e.k === "throw") inc(a.ev, "잡기 성공");
        if (e.k === "tech") inc(a.ev, "잡기 풂");
        if (e.k === "counter") inc(a.ev, "카운터 히트");
        if (e.k === "launch" || e.k === "pop") inc(a.ev, "띄움");
      });
    human.forEach((seat, i) => {
      if (cur[seat] && s.p[1 - seat].combo === 0 && s.p[1 - seat].st !== "hit") closeCombo(seat, i);
    });
    k++;
  }
  human.forEach((seat, i) => closeCombo(seat, i));
  replayed++;
  const w = s.phase === "over" ? (s.winner === 0 || s.winner === 1 ? s.winner : 2) : null;
  if (w === r.out) matched++;
  else console.log(`  (안 맞음: ${r._id} ${r.mode} 저장 ${r.out} · 다시 돌림 ${w} · 프레임 ${k}/${len})`);
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : "-");
const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
const top = <K>(m: Map<K, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
const hr = (t: string) => console.log(`\n── ${t} ──`);

console.log("기술: L 약 · H 발차기 · J 공중 약 · K 공중 발차기 · S 아이덴티티 · X 필살기 · T 잡기 · G 가드 반격");
const modes = new Map<string, number>();
for (const r of all) inc(modes, `${r.mode}`);
hr(`전체 ${all.length}판 · 사람 ${new Set(all.flatMap((r) => r.uids.filter(Boolean))).size}명`);
console.log(`  모드: ${[...modes].map(([k, v]) => `${k} ${v}`).join(" · ")}`);
console.log(`  다시 돌림 ${replayed}판 · 저장된 승패와 일치 ${matched}판 (${pct(matched, replayed)}) · 빌드 달라 건너뜀 ${skippedBuild}판`);
const chars = new Map<string, number>();
for (const r of all) inc(chars, CHARS[r.chars[0]]?.name ?? "?");
console.log(`  1P 캐릭터: ${top(chars, 10).map(([k, v]) => `${k} ${v}`).join(" · ")}`);

for (const [k, a] of [...aggs].sort()) {
  const min = a.frames / 3600;
  hr(`${k} — ${a.games}판 · 승률 ${pct(a.wins, a.games)} · 경기 ${min.toFixed(1)}분`);
  console.log(`  분당 입력: ${[...a.presses].map(([n, v]) => `${n} ${(v / min).toFixed(0)}`).join(" · ")}`);
  console.log(`  가드(↓) 누름 ${pct(a.guard, a.frames)} · 아무것도 안 누름 ${pct(a.idle, a.frames)}`);
  const q = (xs: number[], p: number) => (xs.length ? [...xs].sort((x, y) => x - y)[Math.floor(xs.length * p)] : NaN);
  console.log(`  상대 공격 시작(내가 자유로울 때) → 처음 새로 누름: 25% ${q(a.react2, 0.25)} · 중앙 ${q(a.react2, 0.5)} · 75% ${q(a.react2, 0.75)}프레임 (${a.react2.length}번)`);
  console.log(`    그때 한 것: ${top(a.reactKind, 7).map(([n, v]) => `${n} ${v}`).join(" · ")}`);
  console.log(`  상대 공격 막음 ${pct(a.blocked, a.blocked + a.gotHit)} (막음 ${a.blocked} · 맞음 ${a.gotHit}) · 내 기술 헛침 ${pct(a.whiff, a.whiff + a.landed)}`);
  console.log(`  일어난 뒤 첫 행동: ${top(a.wake, 6).map(([n, v]) => `${n} ${v}`).join(" · ")}`);
  for (const [d, m] of [...a.moveByDist].sort()) console.log(`  ${d}: ${top(m, 5).map(([n, v]) => `${n} ${v}`).join(" · ")}`);
  console.log(`  자주 이은 기술: ${top(a.next, 8).map(([n, v]) => `${n} ${v}`).join(" · ")}`);
  const cs = a.combos;
  if (cs.length) {
    const nb = (lo: number, hi: number) => cs.filter((c) => c.n >= lo && c.n <= hi).length;
    const sum = (xs: number[]) => xs.reduce((x, y) => x + y, 0);
    console.log(`  [콤보] 분당 ${(cs.length / min).toFixed(1)}번 · 평균 ${(sum(cs.map((c) => c.n)) / cs.length).toFixed(1)}타 · 평균 피해 ${(sum(cs.map((c) => c.dmg)) / cs.length).toFixed(0)} · 최대 ${Math.max(...cs.map((c) => c.n))}타`);
    console.log(`    길이: 1타 ${pct(nb(1, 1), cs.length)} · 2타 ${pct(nb(2, 2), cs.length)} · 3~4타 ${pct(nb(3, 4), cs.length)} · 5~7타 ${pct(nb(5, 7), cs.length)} · 8타+ ${pct(nb(8, 999), cs.length)}`);
    console.log(`    피해 비중: 3타+ 콤보가 전체 피해의 ${pct(sum(cs.filter((c) => c.n >= 3).map((c) => c.dmg)), sum(cs.map((c) => c.dmg)))} · 공중 타격 ${pct(sum(cs.map((c) => c.air)), sum(cs.map((c) => c.n)))}`);
    const st = new Map<string, number>();
    for (const c of cs) inc(st, c.start);
    console.log(`    시작 기술: ${top(st, 6).map(([n, v]) => `${n} ${v}`).join(" · ")}`);
    const conv = new Map<string, [number, number]>();
    for (const c of cs) {
      const x = conv.get(c.start) ?? [0, 0];
      x[0]++;
      if (c.n >= 3) x[1]++;
      conv.set(c.start, x);
    }
    console.log(`    3타+로 이어간 비율(시작 기술별): ${[...conv].filter(([, v]) => v[0] >= 5).sort((x, y) => y[1][0] - x[1][0]).slice(0, 6).map(([n, v]) => `${n} ${pct(v[1], v[0])}`).join(" · ")}`);
    const rt = new Map<string, number>();
    for (const c of cs) if (c.n >= 3) inc(rt, c.seq);
    console.log(`    자주 쓴 3타+ 루트: ${top(rt, 6).map(([n, v]) => `[${n}] ${v}`).join(" · ")}`);
    const best = [...cs].sort((x, y) => y.dmg - x.dmg).slice(0, 2);
    console.log(`    제일 아팠던 콤보: ${best.map((c) => `[${c.seq}] ${c.n}타 ${c.dmg}`).join(" · ")}`);
  }
  console.log(`  [연속 동작] 기술 끝날 때 단계: ${[...a.chainEnd].sort((x, y) => x[0] - y[0]).map(([n, v]) => `${n}단${n === 4 ? "+" : ""} ${v}`).join(" · ")}`);
  console.log(`  [이벤트 분당] ${[...a.ev].map(([n, v]) => `${n} ${(v / min).toFixed(1)}`).join(" · ")} · 잡힘 ${(a.grabbedN / min).toFixed(1)} (푼 비율 ${pct(a.ev.get("잡기 풂") ?? 0, a.grabbedN)})`);
  console.log(`  [게이지] 꽉 찬 채로 있던 시간 ${pct(a.fullFrames, a.frames)} · 꽉 찬 뒤 필살기까지 중앙 ${med(a.superWait)}프레임 (${a.superWait.length}번)`);
  console.log(`  [헛친 것 벌주기] 상대 헛침 ${a.whiffOpp}번 중 20프레임 안에 때림 ${pct(a.whiffPun, a.whiffOpp)}`);
  console.log(`  [대공] 상대가 가까이 뛰었을 때: ${top(a.aa, 7).map(([n, v]) => `${n} ${v}`).join(" · ")}`);
  console.log(`  [일어나는 상대 앞] ${top(a.oki, 6).map(([n, v]) => `${n} ${v}`).join(" · ")}`);
}
if (jsonlOut) {
  writeFileSync(jsonlOut, lines.join("\n"));
  console.log(`\n프레임 줄 ${lines.length.toLocaleString()}개 → ${jsonlOut}`);
}
