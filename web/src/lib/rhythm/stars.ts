/**
 * osu!mania 4키 별점 계산 (lazer 알고리즘 그대로 옮김, rosu-pp와 103개 채보에서 오차 0)
 * → 레벨 = 별점 × 4 (1★ = Lv4, 3★ = Lv12, 5★ = Lv20). 상한 없음 — 나이트메어 위 등급도 같은 자로 잼
 *
 * 노트마다 두 가지 부담을 쌓고, 400ms 구간마다 최고값을 모아 센 구간부터 0.9배씩 줄여 더함
 *  - 같은 레인 부담: 같은 레인을 빨리 다시 칠수록 커짐 (1초에 1/8로 식음)
 *  - 전체 부담: 어느 레인이든 빨리 칠수록 커짐 (1초에 0.3배로 식음)
 *  - 다른 롱노트를 누르고 있는 동안이면 ×1.25, 롱노트 끝을 따로따로 떼야 하면 가산
 */
import type { Note } from "./chart";

const SECTION = 400;

export function starRating(notes: Note[]): number {
  const o = notes
    .map((n) => ({ s: n.t * 1000, c: n.lane, e: (n.end ?? n.t) * 1000 }))
    .sort((a, b) => Math.round(a.s) - Math.round(b.s));
  if (o.length < 2) return 0;
  const st = [0, 0, 0, 0];
  const en = [0, 0, 0, 0];
  const ind = [0, 0, 0, 0];
  let indS = 0;
  let ov = 1;
  const peaks: number[] = [];
  let peak = 0;
  let secEnd = Math.ceil(o[1].s / SECTION) * SECTION;
  for (let i = 1; i < o.length; i++) {
    const { s, c, e } = o[i];
    const ps = o[i - 1].s;
    const dt = s - ps;
    while (s > secEnd) {
      peaks.push(peak);
      const t = (secEnd - ps) / 1000;
      peak = indS * 0.125 ** t + ov * 0.3 ** t;
      secEnd += SECTION;
    }
    let over = false;
    let hold = 1;
    let close = Math.abs(e - s);
    for (let k = 0; k < 4; k++) {
      over ||= en[k] > s + 1 && e > en[k] + 1 && s > st[k] + 1;
      if (en[k] > e + 1 && s > st[k] + 1) hold = 1.25;
      close = Math.min(close, Math.abs(e - en[k]));
    }
    const add = over ? 1 / (1 + Math.exp(-0.27 * (close - 30))) : 0;
    ind[c] = ind[c] * 0.125 ** ((s - st[c]) / 1000) + 2 * hold;
    indS = dt <= 1 ? Math.max(indS, ind[c]) : ind[c];
    ov = ov * 0.3 ** (dt / 1000) + (1 + add) * hold;
    st[c] = s;
    en[c] = e;
    peak = Math.max(peak, indS + ov);
  }
  peaks.push(peak);
  let d = 0;
  let w = 1;
  for (const p of peaks.filter((p) => p > 0).sort((a, b) => b - a)) {
    d += p * w;
    w *= 0.9;
  }
  return d * 0.018;
}
