/*
 * 올인 러브 — 대본 실행기 (순수 함수). 화면은 components/Love 에서 이 상태만 보고 그림
 * 상태 전체가 JSON 이라 세이브 = 상태 저장
 */
import { SCENES, START } from "./script";
import type { BgId, BgmId, CharKey, Cond, Dist, Eff, EndingId, Face, Mood, Opt, Pos, SfxId, Step, Vars, Who } from "./types";

export interface CharState {
  pos: Pos;
  dist: Dist;
  face: Face;
  /** 표정 지정 없는 대사에서 돌아가는 얼굴 (없으면 캐릭터 기본) */
  rest?: Face;
}
/**
 * 캐릭터 기본 얼굴 — 시선 연출: 연서는 평소 시선을 피하고(away) 핵심 대사만 정면(base),
 * 에이미는 늘 정면으로 들이댐
 */
export const REST: Record<CharKey, Face> = { yeonseo: "away", amy: "base", boss: "base" };
export interface Display {
  bg: BgId;
  chars: Partial<Record<CharKey, CharState>>;
  day: { d: number; slot: string } | null;
  bgm: BgmId | null;
}
export type Block =
  | { k: "say"; who: Who; text: string; mood: Mood }
  | { k: "choice"; prompt?: string; opts: Opt[]; big?: boolean }
  | { k: "mini"; step: Extract<Step, { t: "mini" }> }
  | { k: "phone"; step: Extract<Step, { t: "phone" }> }
  | { k: "free"; prompt: string; opts: Opt[]; big?: boolean }
  | { k: "title"; text: string; sub?: string }
  | { k: "day"; d: number; slot: string }
  | { k: "ending"; id: EndingId }
  | { k: "end"; text: string; sub?: string }
  | { k: "goTitle" };

export interface GState {
  scene: string;
  i: number;
  vars: Vars;
  disp: Display;
  block: Block | null;
  /** 이번 진행에서 울릴 소리 (화면이 한 번 재생하고 무시) */
  fx: SfxId[];
  /** 소리 재생 구분용 번호 */
  seq: number;
}

export const initState = (): GState => ({
  scene: START,
  i: 0,
  vars: {},
  disp: { bg: "black", chars: {}, day: null, bgm: null },
  block: null,
  fx: [],
  seq: 0,
});

export function check(c: Cond, v: Vars): boolean {
  if ("all" in c) return c.all.every((x) => check(x, v));
  if ("any" in c) return c.any.some((x) => check(x, v));
  const a = v[c.v] ?? 0;
  switch (c.op) {
    case ">=": return a >= c.n;
    case "<=": return a <= c.n;
    case ">": return a > c.n;
    case "<": return a < c.n;
    case "==": return a === c.n;
  }
}

const addEff = (v: Vars, eff?: Eff): Vars => {
  if (!eff) return v;
  const o = { ...v };
  for (const [k, n] of Object.entries(eff)) o[k] = (o[k] ?? 0) + n;
  return o;
};

/** 현재 위치부터 막히는 줄(대사 · 선택지 등)이 나올 때까지 실행 */
export function run(s0: GState): GState {
  const s: GState = { ...s0, disp: { ...s0.disp, chars: { ...s0.disp.chars } }, fx: [], seq: s0.seq + 1 };
  for (let guard = 0; guard < 2000; guard++) {
    if (s.scene === "__title") {
      s.block = { k: "goTitle" };
      return s;
    }
    const steps = SCENES[s.scene];
    if (!steps) throw new Error(`없는 장면: ${s.scene}`);
    const st = steps[s.i];
    if (!st) {
      // 장면 끝까지 갔는데 이어지는 게 없으면 타이틀로
      s.block = { k: "goTitle" };
      return s;
    }
    switch (st.t) {
      case "bg":
        s.disp.bg = st.id;
        break;
      case "show": {
        const f = st.face ?? REST[st.who];
        s.disp.chars[st.who] = { pos: st.pos ?? s.disp.chars[st.who]?.pos ?? "c", dist: st.dist ?? 0, face: f, rest: f };
        break;
      }
      case "face": {
        const c = s.disp.chars[st.who];
        if (c) s.disp.chars[st.who] = { ...c, face: st.face };
        break;
      }
      case "dist": {
        const c = s.disp.chars[st.who];
        if (c) s.disp.chars[st.who] = { ...c, dist: st.dist };
        break;
      }
      case "hide":
        if (st.who) delete s.disp.chars[st.who];
        else s.disp.chars = {};
        break;
      case "set":
        s.vars = addEff(s.vars, st.eff);
        break;
      case "goto":
        s.scene = st.to;
        s.i = 0;
        continue;
      case "when": {
        const to = check(st.cond, s.vars) ? st.to : st.else;
        if (to) {
          s.scene = to;
          s.i = 0;
          continue;
        }
        break;
      }
      case "sfx":
        s.fx = [...s.fx, st.id];
        break;
      case "bgm":
        s.disp.bgm = st.id;
        break;
      case "day":
        s.disp.day = { d: st.day, slot: st.slot };
        s.block = { k: "day", d: st.day, slot: st.slot };
        return s;
      case "say": {
        // 말하는 캐릭터: 지정한 표정, 없으면 기본 얼굴로 (듣는 쪽은 직전 표정 유지 = 리액션)
        const c = s.disp.chars[st.who as CharKey];
        if (c) s.disp.chars[st.who as CharKey] = { ...c, face: st.face ?? c.rest ?? REST[st.who as CharKey] };
        s.block = { k: "say", who: st.who, text: st.text, mood: st.mood ?? "normal" };
        return s;
      }
      case "choice":
        s.block = { k: "choice", prompt: st.prompt, big: st.big, opts: st.opts.filter((o) => !o.cond || check(o.cond, s.vars)) };
        return s;
      case "free":
        s.block = { k: "free", prompt: st.prompt, big: st.big, opts: st.opts.filter((o) => !o.cond || check(o.cond, s.vars)) };
        return s;
      case "mini":
        s.block = { k: "mini", step: st };
        return s;
      case "phone":
        s.block = { k: "phone", step: st };
        return s;
      case "title":
        s.block = { k: "title", text: st.text, sub: st.sub };
        return s;
      case "ending":
        s.block = { k: "ending", id: st.id };
        return s;
      case "end":
        s.block = { k: "end", text: st.text, sub: st.sub };
        return s;
    }
    s.i++;
  }
  throw new Error("대본이 끝없이 돌아요 (goto 순환)");
}

/** 막힌 줄을 지나 다음으로 */
export const next = (s: GState): GState => run({ ...s, i: s.i + 1 });

/** 선택지 · 자유 슬롯 · 메시지 답장 고르기 */
export function pick(s: GState, opt: Opt): GState {
  const vars = addEff(s.vars, opt.eff);
  if (opt.to) return run({ ...s, vars, scene: opt.to, i: 0 });
  return run({ ...s, vars, i: s.i + 1 });
}

/** 메시지 무시 */
export function ignorePhone(s: GState, eff: Eff): GState {
  return run({ ...s, vars: addEff(s.vars, eff), i: s.i + 1 });
}

/** 미니게임 결과 기록 후 다음으로 (mini_<key> = 점수) */
export function miniDone(s: GState, key: string, score: number, eff?: Eff): GState {
  return run({ ...s, vars: addEff({ ...s.vars, [`mini_${key}`]: score }, eff), i: s.i + 1 });
}

/** 반성회 장면으로 */
export const goScene = (s: GState, scene: string): GState => run({ ...s, scene, i: 0 });

/** 읽은 대사 표시용 키 */
export const lineKey = (s: GState) => `${s.scene}:${s.i}`;
