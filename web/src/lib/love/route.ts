/**
 * 관리자 엔딩 길잡이 — 목표 엔딩을 정하면, 지금 선택지 중 그 엔딩까지 이어지는 것만 골라 줌.
 * 대본의 흐름(set · goto · when · day · 선택지 · 메시지 · 미니게임)만 빠르게 흉내 내서
 * 무작위로 기운 플레이(가중치를 바꿔 가며) 수백 판을 끝까지 돌려 보고, 목표에 닿은 판이 있으면 "갈 수 있음".
 * 닿은 판의 선택 순서는 기억해 두었다가 다음 선택지에서 바로 추천 (다시 안 돌림).
 * 화면(배경 · 인물 · 소리)은 전혀 안 건드림.
 */
import { check } from "./engine";
import { SCENES } from "./script";
import type { Eff, EndingId, Opt, Step, Vars } from "./types";

export type RNode = { scene: string; i: number; vars: Vars };
export type RDecision =
  | { k: "opts"; opts: Opt[]; ignore?: Eff }
  | { k: "mini"; key: string }
  | { k: "end"; id: EndingId | null };

const addEff = (v: Vars, eff?: Eff): Vars => {
  if (!eff) return v;
  const o = { ...v };
  for (const [k, n] of Object.entries(eff)) o[k] = (o[k] ?? 0) + n;
  return o;
};
/** 통계용(_로 시작) 수치는 흐름과 무관 — 빼고 비교 */
const clean = (v: Vars): Vars => Object.fromEntries(Object.entries(v).filter(([k, x]) => x && !k.startsWith("_")));

/** 다음 결정 지점까지 진행 */
export function advance(n0: RNode): [RNode, RDecision] {
  let { scene, i, vars } = n0;
  for (let g = 0; g < 4000; g++) {
    if (scene === "__title") return [{ scene, i, vars }, { k: "end", id: null }];
    const steps = SCENES[scene];
    if (!steps) {
      const day = /^d([1-7])/.exec(scene)?.[1];
      if (day && SCENES[`d${day}`]) {
        scene = `d${day}`;
        i = 0;
        continue;
      }
      return [{ scene, i, vars }, { k: "end", id: null }];
    }
    const st: Step | undefined = steps[i];
    if (!st) return [{ scene, i, vars }, { k: "end", id: null }];
    switch (st.t) {
      case "set":
        vars = addEff(vars, st.eff);
        break;
      case "goto":
        scene = st.to;
        i = 0;
        continue;
      case "when": {
        const to = check(st.cond, vars) ? st.to : st.else;
        if (to) {
          scene = to;
          i = 0;
          continue;
        }
        break;
      }
      case "day":
        vars = { ...vars, dayNo: st.day };
        break;
      case "choice": {
        // 시간제한 선택지의 침묵도 후보 하나 (번호 = 보이는 선택지 수)
        const os = st.opts.filter((o) => !o.cond || check(o.cond, vars));
        return [{ scene, i, vars }, { k: "opts", opts: st.timer && st.timeout ? [...os, st.timeout] : os }];
      }
      case "free":
        return [{ scene, i, vars }, { k: "opts", opts: st.opts.filter((o) => !o.cond || check(o.cond, vars)) }];
      case "phone":
        return [{ scene, i, vars }, { k: "opts", opts: st.replies, ignore: st.ignore }];
      case "mini":
        return [{ scene, i, vars }, { k: "mini", key: st.key }];
      case "ending":
        return [{ scene, i, vars }, { k: "end", id: st.id }];
      case "end":
        return [{ scene, i, vars }, { k: "end", id: null }];
    }
    i++;
  }
  return [n0, { k: "end", id: null }];
}

/** 결정 지점의 후보: 선택지 번호 0..n-1, 메시지 무시 = -1, 미니게임 = 점수 */
const MINI_SCORES = [3, 2, 1, 0];
function apply(n: RNode, d: RDecision, c: number): RNode {
  if (d.k === "mini") return { scene: n.scene, i: n.i + 1, vars: { ...n.vars, [`mini_${d.key}`]: c } };
  if (d.k !== "opts") return n;
  if (c < 0) return { scene: n.scene, i: n.i + 1, vars: addEff(n.vars, d.ignore) };
  const o = d.opts[c];
  return o.to ? { scene: o.to, i: 0, vars: addEff(n.vars, o.eff) } : { scene: n.scene, i: n.i + 1, vars: addEff(n.vars, o.eff) };
}
const cands = (d: RDecision): number[] =>
  d.k === "mini" ? MINI_SCORES : d.k === "opts" ? [...d.opts.map((_, i) => i), ...(d.ignore ? [-1] : [])] : [];
const effOf = (d: RDecision, c: number): Eff | undefined =>
  d.k === "opts" ? (c < 0 ? d.ignore : d.opts[c]?.eff) : undefined;

export const nodeKey = (n: RNode) =>
  `${n.scene}|${n.i}|${Object.entries(clean(n.vars))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;

/** 선택지 효과에 나오는 수치 이름들 (가중치 대상) */
let VARS: string[] | null = null;
function varNames(): string[] {
  if (VARS) return VARS;
  const s = new Set<string>();
  for (const steps of Object.values(SCENES))
    for (const st of steps) {
      const os = st.t === "choice" || st.t === "free" ? st.opts : st.t === "phone" ? st.replies : [];
      for (const o of os) for (const k of Object.keys(o.eff ?? {})) s.add(k);
      if (st.t === "phone") for (const k of Object.keys(st.ignore ?? {})) s.add(k);
    }
  VARS = [...s];
  return VARS;
}

type Path = { key: string; c: number }[];
/** 한 판 끝까지: 가중치 w 쪽으로 기울어서, eps 확률로 아무거나 */
function rollout(n0: RNode, w: Record<string, number>, eps: number, target: EndingId): Path | null {
  let n = n0;
  const path: Path = [];
  for (let g = 0; g < 600; g++) {
    const [m, d] = advance(n);
    n = m;
    if (d.k === "end") return d.id === target ? path : null;
    const cs = cands(d);
    let pick = cs[0];
    if (Math.random() < eps) pick = cs[Math.floor(Math.random() * cs.length)];
    else {
      let best = -Infinity;
      for (const c of cs) {
        let sc = Math.random() * 0.6 + (d.k === "mini" ? c * (w.__mini ?? 0) : 0);
        for (const [k, v] of Object.entries(effOf(d, c) ?? {})) sc += (w[k] ?? 0) * v;
        if (sc > best) {
          best = sc;
          pick = c;
        }
      }
    }
    path.push({ key: nodeKey(n), c: pick });
    n = apply(n, d, pick);
  }
  return null;
}

/**
 * 목표 엔딩 길잡이. 상태 하나(목표 + 기억한 성공 경로)를 들고 다님.
 * check(): 지금 결정 지점에서 후보마다 갈 수 있는지 (true · false=못 찾음).
 */
export function makeGuide(target: EndingId) {
  /** 성공한 판의 결정 → 고른 후보 (같은 상태를 다시 만나면 바로 추천) */
  const known = new Map<string, Set<number>>();
  const fail = new Map<string, number>();
  const remember = (p: Path) => {
    for (const { key, c } of p) {
      const s = known.get(key) ?? new Set<number>();
      s.add(c);
      known.set(key, s);
    }
  };
  const sample = (mu: Record<string, number>, sig: number) => {
    const w: Record<string, number> = {};
    for (const k of [...varNames(), "__mini"]) w[k] = (mu[k] ?? 0) + (Math.random() * 2 - 1) * sig;
    return w;
  };
  /** 후보 하나를 골랐을 때 목표에 닿는 판을 찾음 (판 수 한도) */
  const tryCand = async (n: RNode, d: RDecision, c: number, tries: number, alive: () => boolean): Promise<boolean> => {
    const key = nodeKey(n);
    if (known.get(key)?.has(c)) return true;
    const fk = `${key}#${c}`;
    if ((fail.get(fk) ?? 0) >= tries) return false;
    const next = apply(n, d, c);
    let mu: Record<string, number> = {};
    let sig = 1;
    for (let t = fail.get(fk) ?? 0; t < tries; t++) {
      const p = rollout(next, sample(mu, sig), Math.random() * 0.35, target);
      if (p) {
        remember([{ key, c }, ...p]);
        return true;
      }
      // 한참 못 찾으면 가중치를 넓게 흔들어 다른 성향의 판도 시험
      // 화면이 멈추지 않게 40판마다 한 번 쉬어 감 · 선택지가 바뀌었으면 그만
      if (t % 40 === 39) {
        await new Promise((r) => setTimeout(r, 0));
        if (!alive()) return false;
      }
      if (t % 200 === 199) {
        mu = sample({}, 0.5);
        sig = 1.5;
      }
      fail.set(fk, t + 1);
    }
    return false;
  };
  return {
    target,
    /** 결정 지점에서 후보별 결과. tries = 후보당 최대 판 수 */
    async check(
      node: RNode,
      tries = 1500,
      alive: () => boolean = () => true,
    ): Promise<{ cands: number[]; ok: boolean[]; decision: RDecision }> {
      const n0 = { ...node, vars: clean(node.vars) };
      const [n, d] = advance(n0);
      const cs = cands(d);
      // 기억한 추천이 있으면 그것부터 (나머지는 짧게만)
      const rec = known.get(nodeKey(n));
      const ok: boolean[] = [];
      for (const c of cs) ok.push(rec?.has(c) ? true : await tryCand(n, d, c, rec ? Math.min(300, tries) : tries, alive));
      return { cands: cs, ok, decision: d };
    },
  };
}
export type Guide = ReturnType<typeof makeGuide>;
