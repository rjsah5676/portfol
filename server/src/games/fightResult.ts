/**
 * 격투 온라인 승패 정하기.
 *
 * 경기는 브라우저끼리(P2P) 해서 서버는 결과를 직접 모름 → 두 선수가 각자 본 결과를 알려 주고, 서버는 아래 규칙으로만 인정:
 *  - 둘 다 알려 왔고 같으면 그 결과. 다르면 기록 안 함 (서로 다른 경기를 본 것).
 *  - 한쪽만 알려 왔는데 다른 쪽이 이미 방을 나갔으면 알려 온 쪽 결과.
 *  - 스스로 기권하면(경기 중 메뉴에서 나가기) 기권한 쪽 패배. 자기에게 불리한 신고라 그대로 믿음.
 *  - 아무도 결과를 못 알렸는데 한쪽이 경기 중에 방을 나간 채로 경기가 끝나면(남은 쪽이 끝냄) 나간 쪽 패배.
 *    (잠깐 끊겼다 돌아오면 나간 걸로 치지 않음 — 그 사이에도 P2P 경기는 이어질 수 있어서)
 * 상대가 나갔다고 스스로 주장하는 신고는 받지 않음 (나간 건 서버가 직접 봄).
 */

/** 0 = 1P 승, 1 = 2P 승, 2 = 무승부 */
export type Outcome = 0 | 1 | 2;

export interface FightResult {
  match: string;
  /** 경기를 시작할 때 자리 주인 */
  uids: [string, string];
  /** 각 자리가 알려 온 결과 */
  reports: [Outcome | null, Outcome | null];
  /** 경기 중에 방을 나갔나 (돌아오면 false) */
  gone: [boolean, boolean];
  /** 정해졌거나(기록함) 정할 수 없게 됨 — 더는 안 바뀜 */
  done: boolean;
}

export const newResult = (match: string, uids: [string, string]): FightResult => ({
  match,
  uids,
  reports: [null, null],
  gone: [false, false],
  done: false,
});

/** 지금 정할 수 있으면 결과(void = 기록 안 함), 아직이면 null. 정해지면 done 이 됨 */
export function settle(r: FightResult): Outcome | "void" | null {
  if (r.done) return null;
  const [a, b] = r.reports;
  let out: Outcome | "void" | null = null;
  if (a !== null && b !== null) out = a === b ? a : "void";
  else if (a !== null && r.gone[1]) out = a;
  else if (b !== null && r.gone[0]) out = b;
  if (out !== null) r.done = true;
  return out;
}

/** 스스로 기권 — 아직 아무도 결과를 안 알렸을 때만 */
export function forfeit(r: FightResult, seat: 0 | 1): Outcome | null {
  if (r.done || r.reports[0] !== null || r.reports[1] !== null) return null;
  r.done = true;
  return (1 - seat) as Outcome;
}

/** 경기가 끝남(대기실로): 결과 신고가 없고 한쪽만 나가 있으면 나간 쪽 패배 */
export function onEnd(r: FightResult): Outcome | "void" | null {
  const s = settle(r);
  if (s !== null || r.done) return s;
  if (r.reports[0] === null && r.reports[1] === null && r.gone[0] !== r.gone[1]) {
    r.done = true;
    return r.gone[0] ? 1 : 0;
  }
  return null;
}
