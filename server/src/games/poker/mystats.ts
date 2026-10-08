import type { GameKind } from "../../../../web/src/lib/poker/rules";
import type { PlayStats } from "../../../../web/src/lib/poker/types";

/*
 * 마이페이지 통계: poker_hands 기록(핸드마다 "구간 자리 행동 낸돈" 줄)에서 한 사람의 베팅 성향을 계산.
 * 기록은 30일 뒤 지워지므로 "최근 30일" 기준. 순수 함수라 테스트에서 그대로 씀.
 */

export interface HandDoc {
  at: Date | number;
  game: GameKind;
  who: { seat: number; uid: string | null; delta: number }[];
  hand?: {
    players?: { seat: number; start: number; folded: boolean }[];
    actions?: string[];
  };
}

export const emptyStats = (): PlayStats => ({
  hands: 0,
  wins: 0,
  acts: {},
  folds: 0,
  showdowns: 0,
  sdWins: 0,
  vpip: 0,
  pfr: 0,
  threeBet: 0,
  threeBetChance: 0,
  trend: [],
  best: 0,
  worst: 0,
});

const TREND_POINTS = 60;

/** docs 는 순서 상관없음 (안에서 시간순으로 정렬) */
export function playStats(
  docs: HandDoc[],
  uid: string,
): { holdem: PlayStats; seven: PlayStats } {
  const out = { holdem: emptyStats(), seven: emptyStats() };
  const sorted = [...docs].sort((a, b) => +new Date(a.at) - +new Date(b.at));
  const deltas: Record<GameKind, number[]> = { holdem: [], seven: [] };
  for (const d of sorted) {
    const me = d.who.find((w) => w.uid === uid);
    if (!me || (d.game !== "holdem" && d.game !== "seven")) continue;
    const st = out[d.game];
    st.hands++;
    if (me.delta > 0) st.wins++;
    st.best = Math.max(st.best, me.delta);
    st.worst = Math.min(st.worst, me.delta);
    deltas[d.game].push(me.delta);

    const players = d.hand?.players ?? [];
    const left = new Map(players.map((p) => [p.seat, p.start]));
    const mine = players.find((p) => p.seat === me.seat);
    if (mine?.folded) st.folds++;
    else if (mine && players.filter((p) => !p.folded).length >= 2) {
      st.showdowns++;
      if (me.delta > 0) st.sdWins++;
    }

    let street = -1;
    let opened = false; // 이번 구간에 누가 벳/레이즈(프리플랍은 빅블라인드)를 했나
    let raises = 0; // 프리플랍 레이즈 수
    let vpip = false;
    let pfr = false;
    let faced3 = false;
    let did3 = false;
    for (const line of d.hand?.actions ?? []) {
      const [sStr, seatStr, type, addStr] = line.split(" ");
      const s = Number(sStr);
      const seat = Number(seatStr);
      const add = Number(addStr) || 0;
      if (s !== street) {
        street = s;
        opened = false;
      }
      const before = left.get(seat) ?? 0;
      left.set(seat, before - add);
      if (type === "ante" || type === "sb") continue;
      if (type === "bb") {
        opened = true;
        continue;
      }
      const allIn = add > 0 && before - add <= 0;
      if (seat === me.seat) {
        if (d.game === "holdem") {
          const key = allIn
            ? "allin"
            : type === "raise"
              ? s > 0 && !opened
                ? "bet"
                : "raise"
              : type;
          st.acts[key] = (st.acts[key] ?? 0) + 1;
          if (s === 0) {
            if (type === "call" || type === "raise") vpip = true;
            if (type === "raise") pfr = true;
            if (
              raises === 1 &&
              (type === "raise" || type === "call" || type === "fold")
            ) {
              faced3 = true;
              if (type === "raise") did3 = true;
            }
          }
        } else {
          const key = allIn ? "allin" : type;
          st.acts[key] = (st.acts[key] ?? 0) + 1;
        }
      }
      if (type === "raise") {
        opened = true;
        if (s === 0) raises++;
      }
    }
    if (vpip) st.vpip++;
    if (pfr) st.pfr++;
    if (faced3) st.threeBetChance++;
    if (did3) st.threeBet++;
  }
  for (const g of ["holdem", "seven"] as const) {
    const ds = deltas[g];
    // 판이 많으면 묶어서 60점으로: 누적값을 일정 간격으로 뽑음
    let acc = 0;
    const cum = ds.map((x) => (acc += x));
    if (cum.length <= TREND_POINTS) out[g].trend = cum;
    else
      out[g].trend = Array.from(
        { length: TREND_POINTS },
        (_, i) => cum[Math.round(((i + 1) / TREND_POINTS) * cum.length) - 1],
      );
  }
  return out;
}
