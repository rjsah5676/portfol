/**
 * 픽셀 운빨 디펜스 — 실제 플레이 기록 요약 (관리자 메뉴 「플레이 기록 받기」로 받은 JSON)
 *   npx tsx scripts/defense-plays-report.ts defense-plays-2026-10-20.json [--ver beta5]
 *
 * 상태 · 모드별 판 수, 오염 단계별 클리어율 · 죽은 웨이브, 그만둔 웨이브, 실제 걸린 시간,
 * 유물 · 연구 · 프로토콜(패치) 고른 비율과 그때 클리어율, 많이 만든 유닛, 다음 웨이브 부르기 · 배속 습관.
 * 더 깊은 것(죽은 순간 필드 · 막힌 보스 페이즈)은 seed · lo · log 로 sim 을 다시 돌려서 봄.
 */
import { readFileSync } from "node:fs";
import { BOSS_EVERY, TPS } from "../../web/src/lib/defense/balance";
import type { LogEntry } from "../../web/src/lib/defense/replay";
import type { DefensePlay } from "../src/games/defensePlays";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) throw new Error("JSON 파일 경로를 주세요");
const verArg = args.includes("--ver") ? args[args.indexOf("--ver") + 1] : null;
type Row = Omit<DefensePlay, "at" | "end"> & { at: number; end: number | null };
const raw = JSON.parse(readFileSync(file, "utf8")) as { plays: Row[] };
const plays = raw.plays.filter((p) => !verArg || p.ver === verArg);

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : "-");
const med = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const count = <T extends string | number>(xs: T[]) => {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};
const hr = (t: string) => console.log(`\n── ${t} ──`);
const solo = plays.filter((p) => p.mode !== "multi");

hr(`전체 ${plays.length}판 · 사람 ${new Set(plays.flatMap((p) => p.uids)).size}명 · 버전 ${[...new Set(plays.map((p) => p.ver))].join(", ")}`);
for (const [k, n] of count(plays.map((p) => `${p.mode}/${p.status}`))) console.log(`  ${k.padEnd(18)} ${n}`);

hr("오염 단계별 (끝낸 솔로 시즌 판)");
const done = solo.filter((p) => p.status === "done" && p.mode === "season" && p.res?.[0]);
const byG = new Map<number, Row[]>();
for (const p of done) {
  const g = p.lo[0]?.glitch ?? 0;
  byG.set(g, [...(byG.get(g) ?? []), p]);
}
console.log("  단계   판  클리어  죽은 웨이브 중앙 · 보스웨이브 사망 · 실제 분 중앙");
for (const [g, ps] of [...byG].sort((a, b) => a[0] - b[0])) {
  const wins = ps.filter((p) => p.res![0]!.win).length;
  const dead = ps.filter((p) => !p.res![0]!.win).map((p) => p.res![0]!.wave);
  const bossDeath = dead.filter((w) => w % BOSS_EVERY === 0).length;
  const mins = ps.map((p) => (p.secs ?? 0) / 60);
  console.log(`  ${String(g).padStart(4)} ${String(ps.length).padStart(4)}  ${pct(wins, ps.length).padStart(6)}  ${String(med(dead)).padStart(6)} · ${pct(bossDeath, dead.length).padStart(4)} · ${med(mins).toFixed(0)}`);
}

hr("죽은 웨이브 (상위)");
console.log("  " + count(done.filter((p) => !p.res![0]!.win).map((p) => p.res![0]!.wave)).slice(0, 15).map(([w, n]) => `W${w}:${n}`).join("  "));

hr("그만둔 판 (quit = 메뉴로 나감 · start = 창 닫기/새로고침, 이어하기로 돌아왔을 수도)");
const quit = solo.filter((p) => p.status === "quit");
console.log(`  나간 웨이브 상위: ${count(quit.map((p) => p.quit?.wave ?? 0)).slice(0, 12).map(([w, n]) => `W${w}:${n}`).join("  ")}`);
console.log(`  시작만 하고 기록 없음: ${solo.filter((p) => p.status === "start").length}`);
const rej = plays.filter((p) => p.status === "rejected");
if (rej.length) {
  hr(`확인 실패 ${rej.length}판 (버그 · 어긋남 의심)`);
  for (const [why, n] of count(rej.map((p) => (p.why ?? "?").replace(/\d+/g, "#")))) console.log(`  ${n} × ${why}`);
}

/** 고른 것별 판 수 · 클리어율 */
function pickTable(title: string, keys: (p: Row) => string[]) {
  hr(title);
  const m = new Map<string, { n: number; w: number }>();
  for (const p of done) for (const k of new Set(keys(p))) {
    const e = m.get(k) ?? { n: 0, w: 0 };
    e.n++;
    if (p.res![0]!.win) e.w++;
    m.set(k, e);
  }
  for (const [k, e] of [...m].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k.padEnd(16)} ${pct(e.n, done.length).padStart(4)} 장착 · 클리어 ${pct(e.w, e.n)}`);
}
const cmds = (p: Row, t: string) => (p.log ?? []).map((e: LogEntry) => e[2]).filter((c) => c.t === t) as { t: string; id?: string }[];
pickTable("유물", (p) => p.lo[0]?.relics ?? []);
pickTable("연구", (p) => p.lo[0]?.res ?? []);
pickTable("프로토콜(패치)", (p) => cmds(p, "patch").map((c) => c.id ?? "?"));

hr("많이 만든 유닛 (끝낸 판 합계)");
const made = new Map<string, number>();
for (const p of done) for (const [id, n] of Object.entries(p.res![0]!.made)) made.set(id, (made.get(id) ?? 0) + n);
console.log("  " + [...made].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id, n]) => `${id}:${n}`).join("  "));

hr("습관");
const withLog = solo.filter((p) => p.log?.length);
const per = (t: string) => med(withLog.map((p) => cmds(p, t).length));
console.log(`  판당 중앙: 소환 ${per("summon")} · 합성 ${per("merge")} · 자리바꿈 ${per("swap")} · 다음 웨이브 ${per("next")} · 도박 ${per("gamble")} · 균열 ${per("rift")}`);
console.log(`  다음 웨이브 한 번이라도 쓴 판 ${pct(withLog.filter((p) => cmds(p, "next").length).length, withLog.length)}`);
const speed = done.map((p) => p.res![0]!.tick / TPS / Math.max(1, p.secs ?? 1));
console.log(`  게임 속 시간 ÷ 실제 시간 중앙 ${med(speed).toFixed(2)} (배속 · 일시정지 습관)`);
const tre = done.filter((p) => p.res![0]!.treasure);
if (tre.length) console.log(`  보물방 ${tre.length}판 · 골렘 처치 ${pct(tre.filter((p) => p.res![0]!.treasure!.killed).length, tre.length)} · 피해 중앙 ${pct(med(tre.map((p) => p.res![0]!.treasure!.dmg / p.res![0]!.treasure!.max)), 1)}`);
