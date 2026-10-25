/*
 * 올인 러브 — 대본 실행기 (순수 함수). 화면은 components/Love 에서 이 상태만 보고 그림
 * 상태 전체가 JSON 이라 세이브 = 상태 저장
 */
import { SCENES, START } from "./script";
import { CG } from "./assets";
import { dayDecay } from "./rel";
import {
  type BgId,
  type BgmId,
  type CgCam,
  type CgId,
  type CharKey,
  type Cond,
  type Dist,
  type Eff,
  type EndingId,
  type Face,
  type Mood,
  type Opt,
  type Outfit,
  type Pos,
  type SfxId,
  type Shot,
  type Step,
  SUBS,
  type Vars,
  type Who,
} from "./types";

export interface CharState {
  pos: Pos;
  dist: Dist;
  face: Face;
  /** 표정 지정 없는 대사에서 돌아가는 얼굴 (없으면 캐릭터 기본) */
  rest?: Face;
  /** 자동으로 나온 서브 캐릭터 — 말 안 한 대사 수 (4줄 넘으면 들어감) */
  auto?: number;
}
/**
 * 캐릭터 기본 얼굴 — 시선 연출: 연서는 평소 시선을 피하고(away) 핵심 대사만 정면(base),
 * 에이미는 늘 정면으로 들이댐
 */
export const REST: Record<CharKey, Face> = {
  yeonseo: "away",
  amy: "base",
  boss: "base",
  taeyang: "base",
  jeongmin: "base",
  chunhee: "base",
};
/** 장소 옷 — 이 배경에 들어가면 자동으로 입는 옷 */
const PLACE_OUTFIT: Partial<Record<BgId, Partial<Record<CharKey, Outfit>>>> = {
  waterpark: { amy: "swim" },
  amyroom: { amy: "home" },
  sea: { yeonseo: "summer" },
  vip: { yeonseo: "dress" },
};
/** 장소 옷을 입고 있어도 되는 배경 (밖으로 나가면 벗음) */
const PLACE_OUTFIT_BG: Partial<Record<Outfit, BgId[]>> = {
  swim: ["waterpark"],
  home: ["amyroom"],
  summer: ["sea"],
  summerbare: ["sea"],
  dress: ["vip"],
};
const AUTO_LEAVE = 4;
export interface Display {
  bg: BgId;
  chars: Partial<Record<CharKey, CharState>>;
  day: { d: number; slot: string } | null;
  bgm: BgmId | null;
  /** 이벤트 CG — 켜져 있으면 배경 · 스탠딩 대신 그림 한 장 */
  cg?: CgId | null;
  /** 지금 입고 있는 옷 (없으면 기본) — 캐릭터가 들어갔다 나와도 유지 */
  outfit?: Partial<Record<CharKey, Outfit>>;
  /** 켜진 CG 의 차분 이름 (없으면 원본) */
  cgv?: string | null;
  /** CG 카메라 (없으면 전체 보기) */
  cgcam?: CgCam | null;
  /** CG 연출 (심장 박동 · 흑백) · 차분/카메라를 천천히 바꿀지 */
  cgfx?: { pulse?: boolean; mono?: boolean; slow?: boolean } | null;
  /** 회상 필터 — 켜져 있으면 캡션 글 (빈 글 = 캡션 없이 필터만) */
  memory?: string | null;
  /** 연서가 장갑을 벗었음 (한 번 벗으면 계속 — 날이 바뀌면 "bare" 로 돌아감, 장갑 낀 드레스는 안 입음) */
  bareY?: boolean;
  /** 통화 중 — 위에 '통화 중 · 이름 00:00' 표시 */
  call?: { name: string; who?: CharKey } | null;
}
export type Block =
  | { k: "say"; who: Who; text: string; mood: Mood }
  | { k: "choice"; prompt?: string; opts: Opt[]; big?: boolean; timer?: number; timeout?: Opt }
  | { k: "mini"; step: Extract<Step, { t: "mini" }> }
  | { k: "phone"; step: Extract<Step, { t: "phone" }> }
  | { k: "free"; prompt: string; opts: Opt[]; big?: boolean }
  | { k: "title"; text: string; sub?: string }
  | { k: "montage"; shots: Shot[]; caption?: string }
  | { k: "day"; d: number; slot: string }
  | { k: "ending"; id: EndingId }
  | { k: "end"; text: string; sub?: string }
  | { k: "goTitle" }
  | { k: "call"; name: string; who?: CharKey };

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
    case ">=":
      return a >= c.n;
    case "<=":
      return a <= c.n;
    case ">":
      return a > c.n;
    case "<":
      return a < c.n;
    case "==":
      return a === c.n;
  }
}

const addEff = (v: Vars, eff?: Eff): Vars => {
  if (!eff) return v;
  const o = { ...v };
  for (const [k, n] of Object.entries(eff)) o[k] = (o[k] ?? 0) + n;
  return o;
};

/** 현재 위치부터 막히는 줄(대사 · 선택지 등)이 나올 때까지 실행 */
/** 원룸 배경: 시간대별 (대본은 그냥 "room") */
const ROOMS: BgId[] = ["room", "room_day", "room_night"];
const roomFor = (slot?: string): BgId =>
  !slot
    ? "room"
    : ["낮", "오전", "아침", "오후", "휴식 시간"].includes(slot)
      ? "room_day"
      : ["밤 근무", "마감 후", "새벽", "밤", "자정"].includes(slot)
        ? "room_night"
        : "room";

export function run(s0: GState): GState {
  const s: GState = {
    ...s0,
    disp: { ...s0.disp, chars: { ...s0.disp.chars } },
    fx: [],
    seq: s0.seq + 1,
  };
  for (let guard = 0; guard < 2000; guard++) {
    if (s.scene === "__title") {
      s.block = { k: "goTitle" };
      return s;
    }
    const steps = SCENES[s.scene];
    if (!steps) {
      // 개편으로 없어진 1주차 장면(예전 세이브) → 그날 아침부터 다시
      const day = /^d([1-7])/.exec(s.scene)?.[1];
      if (day && SCENES[`d${day}`]) {
        s.scene = `d${day}`;
        s.i = 0;
        continue;
      }
      throw new Error(`없는 장면: ${s.scene}`);
    }
    const st = steps[s.i];
    if (!st) {
      // 장면 끝까지 갔는데 이어지는 게 없으면 타이틀로
      s.block = { k: "goTitle" };
      return s;
    }
    switch (st.t) {
      case "bg": {
        // 원룸은 시간대에 맞는 그림으로 (낮 · 밤 · 노을)
        const bid: BgId = st.id === "room" ? roomFor(s.disp.day?.slot) : st.id;
        // 장소가 바뀌면 말하다가 자동으로 나와 있던 서브 캐릭터(태양 · 정민 등)는 그 장소에 두고 감
        if (bid !== s.disp.bg)
          for (const k of Object.keys(s.disp.chars) as CharKey[])
            if (s.disp.chars[k]?.auto !== undefined) delete s.disp.chars[k];
        s.disp.bg = bid;
        // 장소 옷: 그 장소에 가면 자동으로 갈아입고, 다른 장소로 가면 벗음 (black = 장면 전환이라 그대로)
        if (bid !== "black") {
          const o: Partial<Record<CharKey, Outfit>> = { ...s.disp.outfit };
          for (const [k, id] of Object.entries(o) as [CharKey, Outfit][])
            if (PLACE_OUTFIT_BG[id] && !PLACE_OUTFIT_BG[id]!.includes(bid))
              o[k] = k === "yeonseo" && s.disp.bareY ? "bare" : undefined;
          for (const [k, id] of Object.entries(PLACE_OUTFIT[bid] ?? {}) as [CharKey, Outfit][]) {
            const cur = o[k];
            // 직접 갈아입힌 옷(편의점 · 티셔츠 · 니트)이 있으면 그대로
            if (cur && cur !== "default" && cur !== "bare") continue;
            if (k === "yeonseo" && s.disp.bareY && id === "dress") continue;
            // 장갑 벗은 뒤 바다에 가면 맨손 원피스
            o[k] = k === "yeonseo" && s.disp.bareY && id === "summer" ? "summerbare" : id;
          }
          s.disp.outfit = Object.fromEntries(Object.entries(o).filter(([, v]) => v)) as typeof o;
        }
        break;
      }
      case "show": {
        const f = st.face ?? REST[st.who];
        const pos = st.pos ?? s.disp.chars[st.who]?.pos ?? "c";
        // 자동으로 나와 있던 서브 캐릭터가 그 자리에 있으면 옆으로 비켜 줌
        for (const k of Object.keys(s.disp.chars) as CharKey[]) {
          const ch = s.disp.chars[k];
          if (k !== st.who && ch?.auto !== undefined && ch.pos === pos)
            s.disp.chars[k] = { ...ch, pos: pos === "r" ? "l" : "r" };
        }
        s.disp.chars[st.who] = { pos, dist: st.dist ?? 0, face: f, rest: f };
        break;
      }
      case "outfit": {
        let id = st.id;
        if (st.who === "yeonseo") {
          if (id === "bare") s.disp.bareY = true;
          // 같은 시간대 안에서 다시 끼면(기본 · 드레스 · 니트 · 원피스) 장갑 낀 상태로 되돌림
          else if (!s.vars.yGloveOff && ["default", "dress", "knit", "summer"].includes(id)) s.disp.bareY = false;
          // 장갑 벗은 뒤엔 장갑 낀 옷(기본 · 드레스) 대신 장갑 벗은 기본
          // 장갑을 아예 안 끼기로 한 뒤(yGloveOff)엔 장갑 낀 옷(기본 · 드레스) 대신 장갑 벗은 기본
          if (s.vars.yGloveOff && (id === "default" || id === "dress")) id = "bare";
        }
        s.disp.outfit = { ...s.disp.outfit, [st.who]: id };
        break;
      }
      case "cg":
        // 그림이 아직 없는 CG 는 건너뜀 (스탠딩 그대로)
        if (st.id && CG[st.id].pending) break;
        s.disp.cg = st.id;
        s.disp.cgv = st.id ? (st.v ?? null) : null;
        s.disp.cgcam = st.id ? (st.cam ?? null) : null;
        s.disp.cgfx = null;
        if (st.id) s.fx = [...s.fx, "heart"];
        break;
      case "cgv":
        if (s.disp.cg) {
          s.disp.cgv = st.v;
          s.disp.cgfx = { ...s.disp.cgfx, slow: !!st.slow };
        }
        break;
      case "cgfx":
        if (s.disp.cg) s.disp.cgfx = { pulse: st.pulse, mono: st.mono, slow: s.disp.cgfx?.slow };
        break;
      case "cgcam":
        if (s.disp.cg) s.disp.cgcam = st.cam;
        break;
      case "memory":
        s.disp.memory = st.off ? null : (st.text ?? "");
        break;
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
        else {
          s.disp.chars = {};
          s.disp.cg = null;
          s.disp.cgv = null;
          s.disp.cgcam = null;
          s.disp.cgfx = null;
        }
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
        s.disp.call = null;
        s.disp.cg = null;
        s.disp.cgv = null;
        s.disp.cgcam = null;
        s.disp.cgfx = null;
        s.disp.memory = null;
        // 오늘 날짜 (대본에서 dayNo 로 읽음: 낮 일정이 끝나면 그날 저녁으로 돌아가기)
        s.vars = dayDecay({ ...s.vars, dayNo: st.day }, st.day);
        // 시간대가 바뀌면 옷도 기본으로 (단, 장갑 벗은 "bare"는 한 번 벗으면 계속)
        // 장갑은 그 장면에서만 벗음 — 다음 시간대엔 다시 낌. 아예 안 끼기로 한 뒤(yGloveOff)부터만 계속 맨손
        s.disp.bareY = !!s.vars.yGloveOff;
        s.disp.outfit = s.disp.bareY ? { yeonseo: "bare" } : {};
        s.disp.day = { d: st.day, slot: st.slot };
        if (ROOMS.includes(s.disp.bg)) s.disp.bg = roomFor(st.slot);
        s.block = { k: "day", d: st.day, slot: st.slot };
        return s;
      case "say": {
        // 서브 캐릭터: 말하면 자동 등장(혼자면 가운데, 아니면 옆자리), 자동으로 나온 서브는 몇 줄 안 말하면 퇴장
        for (const k of Object.keys(s.disp.chars) as CharKey[]) {
          const ch = s.disp.chars[k];
          if (!ch || ch.auto === undefined || k === st.who) continue;
          if (ch.auto + 1 >= AUTO_LEAVE) delete s.disp.chars[k];
          else s.disp.chars[k] = { ...ch, auto: ch.auto + 1 };
        }
        if ((SUBS as readonly string[]).includes(st.who)) {
          const k = st.who as CharKey;
          const cur = s.disp.chars[k];
          if (!cur) {
            const others = Object.keys(s.disp.chars) as CharKey[];
            const used = new Set(others.map((o) => s.disp.chars[o]!.pos));
            const pos: Pos =
              others.length === 0 ? "c" : !used.has("r") ? "r" : !used.has("l") ? "l" : "r";
            s.disp.chars[k] = { pos, dist: 0, face: REST[k], rest: REST[k], auto: 0 };
          } else if (cur.auto !== undefined) s.disp.chars[k] = { ...cur, auto: 0 };
        }
        // 말하는 캐릭터: 지정한 표정, 없으면 기본 얼굴로 (듣는 쪽은 직전 표정 유지 = 리액션)
        const c = s.disp.chars[st.who as CharKey];
        if (c)
          s.disp.chars[st.who as CharKey] = {
            ...c,
            face: st.face ?? c.rest ?? REST[st.who as CharKey],
          };
        // 엔딩 크레딧용 기록: 히로인과 나눈 대사 수 (_ 로 시작하는 수치는 흐름에 안 씀)
        if (st.who === "amy" || st.who === "yeonseo") {
          const k = st.who === "amy" ? "_lA" : "_lY";
          s.vars = { ...s.vars, [k]: (s.vars[k] ?? 0) + 1 };
        }
        s.block = { k: "say", who: st.who, text: st.text, mood: st.mood ?? "normal" };
        return s;
      }
      case "choice":
        s.block = {
          k: "choice",
          prompt: st.prompt,
          big: st.big,
          opts: st.opts.filter((o) => !o.cond || check(o.cond, s.vars)),
          ...(st.timer && st.timeout && { timer: st.timer, timeout: st.timeout }),
        };
        return s;
      case "free":
        s.block = {
          k: "free",
          prompt: st.prompt,
          big: st.big,
          opts: st.opts.filter((o) => !o.cond || check(o.cond, s.vars)),
        };
        return s;
      case "mini":
        s.block = { k: "mini", step: st };
        return s;
      case "phone":
        s.block = { k: "phone", step: st };
        return s;
      case "call":
        // 받기 전까지 멈춤 (화면: 전화 수신 창) — 받으면 다음 줄부터 '통화 중'
        s.block = { k: "call", name: st.name, who: st.who };
        s.disp.call = { name: st.name, who: st.who };
        s.fx = [...s.fx, "phone"];
        return s;
      case "hangup":
        s.disp.call = null;
        break;
      case "title":
        s.block = { k: "title", text: st.text, sub: st.sub };
        return s;
      case "montage":
        s.block = { k: "montage", shots: st.shots, caption: st.caption };
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
  const vars = addEff(s.vars, { ...opt.eff, _ch: 1 });
  if (opt.to) return run({ ...s, vars, scene: opt.to, i: 0 });
  return run({ ...s, vars, i: s.i + 1 });
}

/** 메시지 무시 */
export function ignorePhone(s: GState, eff: Eff): GState {
  return run({ ...s, vars: addEff(s.vars, eff), i: s.i + 1 });
}

/** 미니게임 결과 기록 후 다음으로 (mini_<key> = 점수) */
export function miniDone(s: GState, key: string, score: number, eff?: Eff): GState {
  return run({ ...s, vars: addEff({ ...s.vars, [`mini_${key}`]: score }, { ...eff, _mini: 1 }), i: s.i + 1 });
}

/** 반성회 장면으로 */
export const goScene = (s: GState, scene: string): GState => run({ ...s, scene, i: 0 });

/** 대본에서 대사 위치 찾기 (음성 검수용) */
export function findLine(text: string): { scene: string; i: number } | null {
  for (const [scene, steps] of Object.entries(SCENES)) {
    const i = steps.findIndex((st) => st.t === "say" && st.text === text);
    if (i >= 0) return { scene, i };
  }
  return null;
}

/** 그 장면 처음부터 화면(배경 · 인물 · 곡)만 쌓으며 그 대사 줄까지 바로 이동 — 선택지 · 미니게임은 건너뜀 */
export function jumpTo(scene: string, i: number, vars: Vars = {}): GState {
  // 배경 · 곡을 앞 장면에서 물려받는 장면이면, 이 장면으로 넘어오는 장면을 거슬러 올라가 찾아 둠
  const base = initState();
  let bg: BgId | null = null;
  let bgm: BgmId | null = null;
  const seen = new Set<string>();
  let cur = scene;
  for (let d = 0; d < 6 && (!bg || !bgm) && !seen.has(cur); d++) {
    seen.add(cur);
    const target = cur;
    const from = Object.entries(SCENES).find(([, steps]) =>
      steps.some(
        (st) =>
          (st.t === "goto" && st.to === target) ||
          (st.t === "when" && (st.to === target || st.else === target)) ||
          ((st.t === "choice" || st.t === "free") && st.opts.some((o) => o.to === target))
      )
    );
    if (!from) break;
    // 가장 가까운 앞 장면의 마지막 값이 맞음
    const lastBg = [...from[1]].reverse().find((st) => st.t === "bg");
    const lastBgm = [...from[1]].reverse().find((st) => st.t === "bgm");
    if (!bg && lastBg?.t === "bg") bg = lastBg.id;
    if (!bgm && lastBgm?.t === "bgm") bgm = lastBgm.id;
    cur = from[0];
  }
  base.disp = { ...base.disp, bg: bg ?? base.disp.bg, bgm };
  let s = run({ ...base, scene, i: 0, vars });
  for (let g = 0; g < 400 && !(s.scene === scene && s.i === i); g++) {
    if (s.scene !== scene || s.i > i || s.block?.k === "goTitle") break;
    s = run({ ...s, i: s.i + 1 });
  }
  if (s.scene !== scene || s.i !== i) s = run({ ...s, scene, i });
  return s;
}

/** 읽은 대사 표시용 키 */
export const lineKey = (s: GState) => `${s.scene}:${s.i}`;
