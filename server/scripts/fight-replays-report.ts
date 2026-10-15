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
  if (r.mode === "ai") return `CPU ${r.level}단계`;
  const x = r.rs[seat];
  if (x == null) return "레이팅 없음";
  return x < 900 ? "~900" : x < 1100 ? "900~1100" : x < 1300 ? "1100~1300" : "1300~";
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
}
const newAgg = (): Agg => ({ games: 0, frames: 0, presses: new Map(), guard: 0, idle: 0, react: [], reactGuard: 0, reactN: 0, moveByDist: new Map(), next: new Map(), wins: 0 });
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
    human = [0];
  } else {
    ins = [fromChunks(r.chunks?.[0] ?? []), fromChunks(r.chunks?.[1] ?? [])];
    human = [0, 1];
  }
  const len = Math.max(ins[0].length, ins[1].length);
  const lastIn = [0, 0];
  const atkStart = [-1, -1]; // 상대 공격 시작 프레임 (반응 재기)
  const lastMv = ["", ""];
  const keyOf = human.map((seat) => `${r.mode === "pvp" || r.mode === "rank" ? "사람vs사람" : r.mode === "rankbot" ? "랭크 봇전" : "CPU전"} · ${bucket(r, seat)}`);
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
    step(s, inp);
    k++;
  }
  replayed++;
  const w = s.phase === "over" ? (s.winner === 0 || s.winner === 1 ? s.winner : 2) : null;
  if (w === r.out) matched++;
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : "-");
const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
const top = <K>(m: Map<K, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
const hr = (t: string) => console.log(`\n── ${t} ──`);

console.log("기술: L 약 · H 발차기(강) · J 위+약 · K 아래+발차기 · S 아이덴티티 · X 필살기 · T 잡기 · G 가드 반격 (실제 키 조합은 캐릭터마다 조금 다름)");
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
  console.log(`  상대 공격 시작 → 입력 바꾸기: 중앙 ${med(a.react)}프레임 (${(med(a.react) / 60 * 1000).toFixed(0)}ms) · 그때 가드 ${pct(a.reactGuard, a.reactN)} (${a.reactN}번)`);
  for (const [d, m] of [...a.moveByDist].sort()) console.log(`  ${d}: ${top(m, 5).map(([n, v]) => `${n} ${v}`).join(" · ")}`);
  console.log(`  자주 이은 기술: ${top(a.next, 8).map(([n, v]) => `${n} ${v}`).join(" · ")}`);
}
if (jsonlOut) {
  writeFileSync(jsonlOut, lines.join("\n"));
  console.log(`\n프레임 줄 ${lines.length.toLocaleString()}개 → ${jsonlOut}`);
}
