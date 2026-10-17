import type { Database } from "./db";
import type { UserDoc } from "./users";
import { START_MONEY } from "../../web/src/lib/poker/rules";
import { RHYTHM_CHARTS } from "./http/rhythmCharts";
import { FIGHT_CHAR_NAMES, type AchGame } from "../../web/src/lib/points";
import { CHAR as MARBLE_CHAR } from "../../web/src/lib/marble/data";

/*
 * 업적이 보는 숫자를 기존 기록에서 계산 (업적 정의는 web/src/lib/points.ts 의 ACHIEVEMENTS).
 * 새로 쌓기 시작한 숫자(격투 최고 연승 · 디펜스 누적)는 그 전 기록이 없어서, 남아 있는 기록과 큰 쪽을 씀.
 */

type Doc = UserDoc & {
  poker?: { exch?: number; vault?: number };
  stats?: UserDoc["stats"] & { defense?: { runs?: number; wins?: number; kills?: number; wave?: number } };
};

export async function metricsOf(db: Database, uid: string, game: AchGame): Promise<Record<string, number>> {
  const users = db.col<UserDoc>("users");
  const m: Record<string, number> = {};

  if (game === "poker") {
    const d = (await users.findOne({ _id: uid }, { projection: { money: 1, "poker.exch": 1, "poker.vault": 1, "stats.poker": 1 } })) as Doc | null;
    const pk = d?.stats?.poker ?? {};
    // 환전으로 받은 칩은 빼고 (칩을 포인트로 내준 쪽은 빼지 않음) · 금고에 넣어 둔 칩은 합침
    m["poker.chips"] = Math.max(0, (d?.money ?? START_MONEY) + Math.max(0, d?.poker?.vault ?? 0) - Math.max(0, d?.poker?.exch ?? 0));
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
    const recs = ((await db.col("rhythm_rankings").find({ uid }, { projection: { chart: 1, fc: 1, ap: 1, acc: 1, maxCombo: 1 } }).toArray()) as unknown as { chart: string; fc?: boolean; ap?: boolean; acc?: number; maxCombo?: number }[]).filter(
      (r) => RHYTHM_CHARTS.has(r.chart)
    );
    m["rhythm.plays"] = d?.stats?.plays?.rhythm ?? 0;
    m["rhythm.songs"] = new Set(recs.map((r) => r.chart.replace(/_[a-z]+$/, ""))).size;
    m["rhythm.fc"] = new Set(recs.filter((r) => r.fc).map((r) => r.chart)).size;
    m["rhythm.ap"] = new Set(recs.filter((r) => r.ap).map((r) => r.chart)).size;
    m["rhythm.nightmare"] = recs.filter((r) => r.chart.endsWith("_nightmare")).length;
    // 서로 다른 채보 수로 셈 (같은 채보 기록이 여러 줄이어도 한 번)
    const charts = (f: (r: (typeof recs)[number]) => boolean) => new Set(recs.filter(f).map((r) => r.chart)).size;
    m["rhythm.nmCharts"] = charts((r) => r.chart.endsWith("_nightmare"));
    m["rhythm.expert"] = charts((r) => r.chart.endsWith("_expert"));
    m["rhythm.ultima"] = charts((r) => r.chart.endsWith("_explus"));
    m["rhythm.nmFc"] = charts((r) => !!r.fc && (r.chart.endsWith("_nightmare") || r.chart.endsWith("_explus")));
    m["rhythm.sRank"] = charts((r) => (r.acc ?? 0) >= 94);
    m["rhythm.splus"] = charts((r) => (r.acc ?? 0) >= 97);
    m["rhythm.combo"] = Math.max(0, ...recs.map((r) => r.maxCombo ?? 0));
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

  if (game === "marble") {
    const d = (await users.findOne({ _id: uid }, { projection: { "stats.marble": 1 } })) as (Doc & { stats?: { marble?: { games?: number; wins?: number; lm?: number; mono?: number } } }) | null;
    const s = d?.stats?.marble ?? {};
    m["marble.games"] = s.games ?? 0;
    m["marble.wins"] = s.wins ?? 0;
    m["marble.lm"] = s.lm ?? 0;
    m["marble.mono"] = s.mono ?? 0;
    // 판 밖 성장 (games/marble/meta.ts 의 marble_profile)
    const pf = (await db.col("marble_profile").findOne({ _id: uid } as never, { projection: { chars: 1, pulls: 1 } })) as { chars?: Record<string, { lv: number }>; pulls?: { char?: number; item?: number } } | null;
    const chars = Object.entries(pf?.chars ?? {}).filter(([id]) => MARBLE_CHAR[id]);
    m["marble.chars"] = chars.length;
    m["marble.ssr"] = chars.filter(([id]) => MARBLE_CHAR[id].grade === "SSR" || MARBLE_CHAR[id].grade === "UR").length;
    m["marble.maxlv"] = chars.filter(([, c]) => c.lv >= 5).length;
    m["marble.pulls"] = (pf?.pulls?.char ?? 0) + (pf?.pulls?.item ?? 0);
  }

  if (game === "survivor") {
    // games/survivor.ts 의 survivor.finish 가 쌓음
    const d = (await users.findOne({ _id: uid }, { projection: { "stats.survivor": 1 } })) as (Doc & { stats?: { survivor?: { games?: number; wins?: number; kills?: number; bestSec?: number; bestLv?: number; heroWins?: Record<string, number>; stageWins?: Record<string, number> } } }) | null;
    const s = d?.stats?.survivor ?? {};
    m["survivor.games"] = s.games ?? 0;
    m["survivor.wins"] = s.wins ?? 0;
    m["survivor.kills"] = s.kills ?? 0;
    m["survivor.bestSec"] = s.bestSec ?? 0;
    m["survivor.bestLv"] = s.bestLv ?? 0;
    m["survivor.heroWins"] = Object.keys(s.heroWins ?? {}).length;
    m["survivor.clockWins"] = s.stageWins?.clock ?? 0;
  }

  if (game === "rogue") {
    // games/rogue.ts 의 rogue.finish 가 쌓음
    type RogueStats = Partial<Record<"runs" | "wins" | "full" | "kills" | "bosses" | "ch" | "floor" | "items" | "codex" | "secrets" | "noHit" | "cheats" | "speed" | "elites" | "specials" | "arcade" | "ignaRuns" | "ignaWins", number>>;
    const d = (await users.findOne({ _id: uid }, { projection: { "stats.rogue": 1 } })) as (Doc & { stats?: { rogue?: RogueStats } }) | null;
    const s = d?.stats?.rogue ?? {};
    for (const k of ["runs", "wins", "full", "kills", "bosses", "ch", "floor", "items", "codex", "secrets", "noHit", "cheats", "speed", "elites", "specials", "arcade", "ignaRuns", "ignaWins"] as const) m[`rogue.${k}`] = s[k] ?? 0;
  }

  if (game === "patrol") {
    // games/patrol.ts 의 patrol.finish 가 stats.patrol 을 쌓음 · 진행 · 장비는 patrol_profile
    const d = (await users.findOne({ _id: uid }, { projection: { "stats.patrol": 1 } })) as (Doc & { stats?: { patrol?: { runs?: number; wins?: number; kills?: number } } }) | null;
    const s = d?.stats?.patrol ?? {};
    m["patrol.runs"] = s.runs ?? 0;
    m["patrol.wins"] = s.wins ?? 0;
    m["patrol.kills"] = s.kills ?? 0;
    const pf = (await db.col("patrol_profile").findOne({ _id: uid } as never, { projection: { best: 1, bestSt: 1, stars: 1, boxes: 1, items: 1 } })) as {
      best?: number;
      bestSt?: number;
      stars?: Record<string, boolean[]>;
      boxes?: number;
      items?: { g: number; lv: number }[];
    } | null;
    m["patrol.stage"] = pf?.bestSt ?? (pf?.best ?? 0) * 5;
    // 스테이지 별만 셈 (예전 챕터 별 "1" · "2" · "3" 은 빼고)
    m["patrol.stars"] = Object.entries(pf?.stars ?? {})
      .filter(([k]) => k.startsWith("s"))
      .reduce((n, [, v]) => n + v.filter(Boolean).length, 0);
    m["patrol.boxes"] = pf?.boxes ?? 0;
    m["patrol.grade"] = Math.max(0, ...(pf?.items ?? []).map((x) => x.g));
    m["patrol.enh"] = Math.max(0, ...(pf?.items ?? []).map((x) => x.lv));
  }

  return m;
}
