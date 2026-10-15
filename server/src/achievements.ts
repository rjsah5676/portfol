import type { Database } from "./db";
import type { UserDoc } from "./users";
import { START_MONEY } from "../../web/src/lib/poker/rules";
import { RHYTHM_CHARTS } from "./http/rhythmCharts";
import { FIGHT_CHAR_NAMES, type AchGame } from "../../web/src/lib/points";

/*
 * 업적이 보는 숫자를 기존 기록에서 계산 (업적 정의는 web/src/lib/points.ts 의 ACHIEVEMENTS).
 * 새로 쌓기 시작한 숫자(격투 최고 연승 · 디펜스 누적)는 그 전 기록이 없어서, 남아 있는 기록과 큰 쪽을 씀.
 */

type Doc = UserDoc & {
  poker?: { exch?: number };
  stats?: UserDoc["stats"] & { defense?: { runs?: number; wins?: number; kills?: number; wave?: number } };
};

export async function metricsOf(db: Database, uid: string, game: AchGame): Promise<Record<string, number>> {
  const users = db.col<UserDoc>("users");
  const m: Record<string, number> = {};

  if (game === "poker") {
    const d = (await users.findOne({ _id: uid }, { projection: { money: 1, "poker.exch": 1, "stats.poker": 1 } })) as Doc | null;
    const pk = d?.stats?.poker ?? {};
    // 환전으로 받은 칩은 빼고 (칩을 포인트로 내준 쪽은 빼지 않음)
    m["poker.chips"] = Math.max(0, (d?.money ?? START_MONEY) - Math.max(0, d?.poker?.exch ?? 0));
    m["poker.hands"] = pk.hands ?? 0;
    m["poker.wins"] = (pk.holdem?.wins ?? 0) + (pk.seven?.wins ?? 0);
    m["poker.best"] = pk.best ?? 0;
  }

  if (game === "fight") {
    const r = (await db.col("fight_rank_ratings").findOne({ uid })) as { n?: number; w?: number; peak?: number; streak?: number; bestStreak?: number } | null;
    m["fight.games"] = r?.n ?? 0;
    m["fight.wins"] = r?.w ?? 0;
    m["fight.streak"] = Math.max(r?.bestStreak ?? 0, r?.streak ?? 0, 0);
    m["fight.peak"] = r?.n ? (r.peak ?? 0) : 0;
    // 튜토리얼 · AI 대전 단계 (games/fight.ts fight.tutorialDone · fight.aiClear)
    const u = (await users.findOne({ _id: uid }, { projection: { "stats.fight": 1 } })) as Doc | null;
    m["fight.tut"] = u?.stats?.fight?.tut ?? 0;
    m["fight.ai"] = u?.stats?.fight?.ai ?? 0;
    const games = await db.col("fight_rank_games").find({ uids: uid }, { projection: { uids: 1, chars: 1 } }).toArray();
    FIGHT_CHAR_NAMES.forEach((_, i) => (m[`fight.char.${i}`] = 0));
    for (const g of games as unknown as { uids: string[]; chars: number[] }[]) {
      const c = g.chars[g.uids[0] === uid ? 0 : 1];
      m[`fight.char.${c}`] = (m[`fight.char.${c}`] ?? 0) + 1;
    }
  }

  if (game === "defense") {
    const d = (await users.findOne({ _id: uid }, { projection: { "stats.defense": 1 } })) as Doc | null;
    const s = d?.stats?.defense ?? {};
    const best = (await db.col("defense_rank").find({ uid }, { projection: { wave: 1, win: 1 } }).toArray()) as unknown as { wave?: number; win?: boolean }[];
    m["defense.runs"] = s.runs ?? 0;
    m["defense.wave"] = Math.max(s.wave ?? 0, ...best.map((b) => b.wave ?? 0));
    m["defense.wins"] = Math.max(s.wins ?? 0, best.some((b) => b.win) ? 1 : 0);
    m["defense.kills"] = s.kills ?? 0;
    // 판 밖 성장 (defenseMeta 의 defense_profile)
    const pf = (await db.col("defense_profile").findOne({ _id: uid } as never, { projection: { glitchWin: 1, lv: 1, relics: 1 } })) as { glitchWin?: number; lv?: Record<string, number>; relics?: string[] } | null;
    m["defense.glitch"] = (pf?.glitchWin ?? -1) + 1;
    m["defense.maxlv"] = Math.max(0, ...Object.values(pf?.lv ?? {}));
    m["defense.relics"] = pf?.relics?.length ?? 0;
  }

  if (game === "rhythm") {
    const d = (await users.findOne({ _id: uid }, { projection: { "stats.plays": 1 } })) as Doc | null;
    // 사이트에 들어 있는 곡만 (내 음악으로 만든 채보는 빼고)
    const recs = ((await db.col("rhythm_rankings").find({ uid }, { projection: { chart: 1, fc: 1, ap: 1 } }).toArray()) as unknown as { chart: string; fc?: boolean; ap?: boolean }[]).filter(
      (r) => RHYTHM_CHARTS.has(r.chart)
    );
    m["rhythm.plays"] = d?.stats?.plays?.rhythm ?? 0;
    m["rhythm.songs"] = new Set(recs.map((r) => r.chart.replace(/_[a-z]+$/, ""))).size;
    m["rhythm.fc"] = new Set(recs.filter((r) => r.fc).map((r) => r.chart)).size;
    m["rhythm.ap"] = new Set(recs.filter((r) => r.ap).map((r) => r.chart)).size;
    m["rhythm.nightmare"] = recs.filter((r) => r.chart.endsWith("_nightmare")).length;
  }

  if (game === "sketch") {
    const d = (await users.findOne({ _id: uid }, { projection: { "stats.sketch": 1 } })) as Doc | null;
    const k = d?.stats?.sketch ?? {};
    // games: 끝까지 한 판 (10.14부터 셈 — 시작만 센 예전 games 는 안 씀)
    m["sketch.games"] = k.done ?? 0;
    m["sketch.correct"] = k.correct ?? 0;
    m["sketch.first"] = k.first ?? 0;
    m["sketch.drew"] = k.drew ?? 0;
    m["sketch.wins"] = k.wins ?? 0;
    m["sketch.points"] = k.points ?? 0;
    m["sketch.likes"] = k.likes ?? 0;
    m["sketch.fakeWin"] = k.fakeWin ?? 0;
    m["sketch.fakeFound"] = k.fakeFound ?? 0;
    m["sketch.fooled"] = k.fooled ?? 0;
    m["sketch.relay"] = k.relay ?? 0;
  }

  if (game === "virus") {
    const d = (await users.findOne({ _id: uid }, { projection: { "stats.virus": 1 } })) as Doc | null;
    const v = d?.stats?.virus ?? {};
    // 게임이 보고한 기록 그대로 (http/virus.ts) — 키 이름이 업적 숫자 virus.<키>
    for (const [k, n] of Object.entries(v)) if (typeof n === "number") m[`virus.${k}`] = n;
    for (const k of ["best", "clears", "formats", "files", "bosses"]) m[`virus.${k}`] ??= 0;
  }

  return m;
}
