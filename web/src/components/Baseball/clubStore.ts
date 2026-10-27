/**
 * 구단 저장 (게스트도 됨: 이 브라우저 localStorage) — 카드 · 타선 · 대전 기록.
 * 서버 저장 · 실시간 매칭은 다음 단계.
 */
import { AREA_KIND, LINEUP_POS, SLOTS, cardById, newClub, syncHof, type Area, type Club, type Ghost } from "@/lib/baseball/club";
import { loadHof } from "./careerStore";

const KEY = "pxb:club:v1";

/** 저장된 구단 (명예의 전당 선수는 카드로 자동 등록) */
export function loadClub(): Club | null {
  let c: Club | null = null;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && v.v === 1 && Array.isArray(v.cards) && v.slots?.lineup?.length === 9) c = v as Club;
  } catch {
    return null;
  }
  if (!c) return null;
  c.record ??= { w: 0, l: 0, d: 0, rating: 1000, log: [] };
  c.nextSp ??= 0;
  const hofChanged = syncHof(c, loadHof());
  if (!repair(c)) return null;
  if (hofChanged) saveClub(c);
  return c;
}

/** 저장이 꼬였을 때: 없는 카드 칸은 비우고, 타순 빈 자리는 남는 타자로 채움 (못 채우면 false) */
function repair(c: Club): boolean {
  for (const a of Object.keys(SLOTS) as Area[]) {
    c.slots[a] = Array.from({ length: SLOTS[a] }, (_, i) => {
      const id = c.slots[a]?.[i] ?? null;
      const card = cardById(c, id);
      return card && card.kind === AREA_KIND[a] ? id : null;
    });
  }
  if (!Array.isArray(c.lpos) || c.lpos.length !== 9) c.lpos = [...LINEUP_POS];
  for (let i = 0; i < 9; i++) {
    if (c.slots.lineup[i]) continue;
    const free = c.cards.find((k) => k.kind === "bat" && !c.slots.lineup.includes(k.id) && !c.slots.bench.includes(k.id));
    if (!free) return false;
    c.slots.lineup[i] = free.id;
  }
  return true;
}

export function saveClub(c: Club) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {}
}

/** 첫 방문: 구단 고르기 → 새 구단 */
export function createClub(teamId: string): Club {
  const c = newClub(teamId);
  syncHof(c, loadHof());
  saveClub(c);
  return c;
}

/** 기록 대전 결과 반영 → 바뀐 점수 */
export function recordOnline(g: Ghost, win: boolean | null, score: string): number {
  const c = loadClub();
  if (!c) return 0;
  const delta = win === null ? 0 : win ? g.win : g.lose;
  const r = c.record;
  if (win === null) r.d++;
  else if (win) r.w++;
  else r.l++;
  r.rating = Math.max(0, r.rating + delta);
  r.log = [{ at: Date.now(), opp: g.def.name, oppShort: g.def.short, color: g.def.color, score, win, delta }, ...r.log].slice(0, 10);
  // 선발 로테이션 한 칸
  c.nextSp = (c.nextSp + 1) % 5;
  saveClub(c);
  return delta;
}
