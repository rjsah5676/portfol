import { evaluate, type Card } from "../../../../../web/src/lib/poker/cards";
import { autoChoice, bestK, kCategory, openRank } from "../../../../../web/src/lib/poker/seven";
import { moodOf, type Brain, type Cue } from "../personas";
import type { SevenAct, SevenBet, SevenHistory, SevenLegal } from "./engine";

/*
 * 7포커 봇의 판단. 봇이 보는 것: 자기 카드 전부, 모두의 펴 놓은 카드, 각자의 칩·벳, 지금까지의 행동.
 *
 * 남은 카드를 무작위로 채워 가며 끝까지 갔을 때 내가 이길 확률을 계산함.
 * 수읽기: 상대의 엎은 카드를 뽑을 때마다 지금까지의 행동(세게 쳤는지 · 따라만 왔는지)과 맞는 만큼 무게를 줌 (베이즈).
 * 기다리는 카드가 남들 펴 놓은 카드로 다 나와 버린 드로우(죽은 드로우)로는 세게 치지 않음.
 * 받을 때는 팟 오즈와 비교, 걸 때는 승률에 맞는 크기(삥 · 따당 · 쿼터 · 하프 · 풀)를 고름.
 */

export interface SevenBotPlayer {
  seat: number;
  key: string;
  up: Card[];
  folded: boolean;
  allIn: boolean;
  stack: number;
  bet: number;
  invested: number;
}

export interface SevenBotView {
  seat: number;
  cards: Card[];
  round: number;
  pot: number;
  ante: number;
  legal: SevenLegal;
  players: SevenBotPlayer[];
  history: SevenHistory[];
}

export interface SevenDecision {
  type: SevenAct;
  thinkMs: number;
  cue?: Cue;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const gauss = (rand: () => number) => (rand() + rand() + rand() - 1.5) * 1.15;

/**
 * 지금 들고 있는 카드(엎은 것 포함)가 어느 정도인지 거칠게: 0 잡패 · 0.6 드로우 · 1 원페어 · 2 투페어 · 3 트리플 이상(스트 · 플러시 포함)
 * 승률 계산 안에서 수천 번 부르므로 족보 계산 없이 숫자 · 무늬만 셈
 */
const cntR = new Int8Array(13);
const cntSu = new Int8Array(4);
function strengthNow(cards: Card[], len: number): number {
  cntR.fill(0);
  cntSu.fill(0);
  let mask = 0;
  for (let i = 0; i < len; i++) {
    const c = cards[i];
    cntR[c >> 2]++;
    cntSu[c & 3]++;
    mask |= 1 << (c >> 2);
  }
  let pairs = 0;
  for (let r = 0; r < 13; r++) {
    if (cntR[r] >= 3) return 3;
    if (cntR[r] === 2) pairs++;
  }
  let flush = 0;
  for (let s = 0; s < 4; s++) flush = Math.max(flush, cntSu[s]);
  if (flush >= 5) return 3;
  const low = (mask << 1) | ((mask >> 12) & 1); // 0번 칸 = A(1로), 1~13번 칸 = 2~A
  let run = 0;
  let best = 0;
  for (let r = 0; r <= 13; r++) {
    run = (low >> r) & 1 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  if (best >= 5) return 3;
  if (pairs >= 2) return 2;
  if (pairs === 1) return 1;
  return flush === 4 || best === 4 ? 0.6 : 0;
}

/** 그 패였다면 이렇게 쳤을 그럴듯함: 세게 칠 때마다 약한 패일수록 크게 깎이고, 콜만 해도 잡패는 조금 깎임 */
function likelihood(st: number, aggr: number, calls: number): number {
  if (!aggr && !calls) return 1;
  const a = st >= 3 ? 1 : st >= 2 ? 0.85 : st >= 1 ? 0.62 : st > 0 ? 0.55 : 0.28;
  const c = st > 0 ? 1 : 0.72;
  return a ** aggr * c ** calls;
}

/**
 * 남은 카드를 무작위로 채워 가며 끝까지 갔을 때 내가 이길 확률.
 * 수읽기: 상대의 엎은 카드를 뽑을 때마다 "그 카드였다면 지금까지처럼 쳤을까"를 무게로 줌 — 세게 친 상대가 잡패로 뽑힌 경우는 적게 셈.
 * 펴진 카드와 이미 나온 카드(죽은 카드)는 덱에서 빠져 있으므로 남은 아웃츠도 저절로 반영됨.
 */
function equity(v: SevenBotView, brain: Brain, heavy = false): number {
  const rand = brain.rand;
  const opps = v.players.filter((p) => !p.folded && p.seat !== v.seat);
  if (!opps.length) return 1;
  const seen = new Uint8Array(52);
  for (const c of v.cards) seen[c] = 1;
  for (const p of v.players) for (const c of p.up) seen[c] = 1;
  const deck: Card[] = [];
  for (let c = 0; c < 52; c++) if (!seen[c]) deck.push(c);

  // 상대마다 지금까지 세게 친 횟수 · 따라간 횟수 (최근 구일수록 패가 많이 드러나 있으므로 그대로 셈, 너무 쌓이면 자름)
  const acts = opps.map((p) => {
    let aggr = 0;
    let calls = 0;
    for (const h of v.history) {
      if (h.seat !== p.seat || h.type === "ante") continue;
      if (h.aggressive) aggr++;
      else if (h.type === "call") calls++;
    }
    return { aggr: Math.min(3, aggr), calls: Math.min(2, calls) };
  });
  // 읽기의 깊이: 0 이면 무게 없이(아무 패나), 1 이면 행동대로 다 믿음. 스택이 걸린 콜은 서툰 봇도 제대로 읽음
  const read = heavy ? 1 : brain.skill.read;
  const cur = v.cards.length;
  const mine = [...v.cards];
  const myNeed = 7 - cur;
  const hand: Card[] = [0, 0, 0, 0, 0, 0, 0];
  const sims = brain.skill.sims;
  let total = 0;
  let wsum = 0;
  for (let it = 0; it < sims; it++) {
    let n = deck.length;
    const draw = (): Card => {
      const j = Math.floor(rand() * n);
      const c = deck[j];
      deck[j] = deck[n - 1];
      deck[n - 1] = c;
      n--;
      return c;
    };
    for (let i = 0; i < myNeed; i++) mine[cur + i] = draw();
    const me = evaluate(mine);
    let w = 1;
    let best = -1;
    let ties = 0;
    for (let k = 0; k < opps.length; k++) {
      const up = opps[k].up;
      for (let i = 0; i < up.length; i++) hand[i] = up[i];
      // 지금 들고 있을 엎은 카드 → 그걸로 행동이 그럴듯한지 → 남은 장
      for (let i = up.length; i < cur; i++) hand[i] = draw();
      if (read > 0) w *= likelihood(strengthNow(hand, cur), acts[k].aggr, acts[k].calls) ** read;
      for (let i = cur; i < 7; i++) hand[i] = draw();
      const s = evaluate(hand);
      if (s > best) {
        best = s;
        ties = 1;
      } else if (s === best) ties++;
    }
    total += w * (me > best ? 1 : me === best ? 1 / (ties + 1) : 0);
    wsum += w;
  }
  return wsum > 0 ? total / wsum : 0;
}

/** 내 펴 놓은 카드가 세 보이는지 (페어가 보이거나 같은 무늬 3장 이상) */
function looksScary(up: Card[]): boolean {
  const ranks = new Map<number, number>();
  const suits = [0, 0, 0, 0];
  for (const c of up) {
    ranks.set(c >> 2, (ranks.get(c >> 2) ?? 0) + 1);
    suits[c & 3]++;
  }
  return [...ranks.values()].some((n) => n >= 2) || Math.max(...suits) >= 3;
}

/** 다음 장으로 완성을 노리는 패인지: 같은 무늬 4장, 또는 4장 연속(양쪽 열림) */
function hasDraw(cards: Card[]): boolean {
  const suits = [0, 0, 0, 0];
  const ranks = new Set<number>();
  for (const c of cards) {
    suits[c & 3]++;
    ranks.add(c >> 2);
  }
  if (Math.max(...suits) === 4) return true;
  if (ranks.has(12)) ranks.add(-1); // A 는 1 로도
  for (let lo = -1; lo <= 8; lo++) if ([0, 1, 2, 3].every((k) => ranks.has(lo + k)) && !ranks.has(lo - 1) && !ranks.has(lo + 4)) return true;
  return false;
}

/** 드로우가 아직 살아 있는지: 기다리는 카드가 남들 펴 놓은 카드로 거의 다 나와 버렸으면(남은 장 3장 이하) 죽은 드로우 */
function liveDraw(v: SevenBotView): boolean {
  if (!hasDraw(v.cards)) return false;
  const seen = new Uint8Array(52);
  for (const c of v.cards) seen[c] = 1;
  for (const p of v.players) for (const c of p.up) seen[c] = 1;
  const suits = [0, 0, 0, 0];
  const ranks = new Set<number>();
  for (const c of v.cards) {
    suits[c & 3]++;
    ranks.add(c >> 2);
  }
  let outs = 0;
  const fs = suits.indexOf(4);
  if (fs >= 0) for (let r = 0; r < 13; r++) if (!seen[r * 4 + fs]) outs++;
  // 양쪽 열린 4장 연속: 양 끝 숫자 남은 장
  if (ranks.has(12)) ranks.add(-1);
  for (let lo = -1; lo <= 8; lo++) {
    if (![0, 1, 2, 3].every((k) => ranks.has(lo + k)) || ranks.has(lo - 1) || ranks.has(lo + 4)) continue;
    for (const r of [lo - 1, lo + 4]) {
      const rr = r === -1 ? 12 : r;
      if (rr < 0 || rr > 12) continue;
      for (let su = 0; su < 4; su++) if (!seen[rr * 4 + su] && !(fs >= 0 && su === fs)) outs++;
    }
  }
  return outs >= 4;
}

export function chooseSeven(dealt: Card[], brain: Brain): { discard: number; open: number; thinkMs: number } {
  const c = autoChoice(dealt);
  return { ...c, thinkMs: Math.round((900 + brain.rand() * 2200) * brain.persona.pace) };
}

export function decideSeven(v: SevenBotView, brain: Brain): SevenDecision {
  const p = moodOf(brain);
  const r = brain.rand;
  const me = v.players.find((x) => x.seat === v.seat)!;
  const { toCall, bets } = v.legal;
  const n = v.players.filter((x) => !x.folded && x.seat !== v.seat).length;
  const heavy = toCall >= me.stack * 0.4;
  const eq = clamp(equity(v, brain, heavy) + gauss(r) * (heavy ? Math.min(brain.skill.noise, 0.03) : brain.skill.noise), 0, 1);
  const last = v.round === 7;
  const think = (lo: number, hi: number) => Math.round((lo + (hi - lo) * r()) * p.pace);

  /** 세기(0~1)에 맞는 베팅을 고름: 작은 것부터 삥/따당 · 쿼터 · 하프 (풀은 게임에서 뺐음) */
  const order: SevenBet[] = ["bbing", "ddadang", "quarter", "half"];
  const avail = order.filter((b) => bets[b] !== undefined);
  const pickBet = (s: number): SevenBet | undefined => {
    if (!avail.length) return undefined;
    const i = clamp(Math.round(s * p.sizing * (avail.length - 1) + (r() - 0.5) * 0.8), 0, avail.length - 1);
    let b = avail[i];
    // 스택의 절반 넘게 들어가는 베팅은 확실할 때만
    while ((bets[b] ?? 0) > me.stack * 0.5 && eq < 0.8 && avail.indexOf(b) > 0) b = avail[avail.indexOf(b) - 1];
    return b;
  };
  const allIn = (b: SevenBet | "call") => (b === "call" ? toCall : (bets[b] ?? 0)) >= me.stack;

  // 마지막 구: 남이 편 카드만으로도 내 패(7장 전부)를 이기고 있으면 더 넣지 않음 (상대 원페어 · 투페어가 보이는데 탑으로 받던 것)
  // (족보 등급으로만 비교 — 상대가 투페어를 펴 놨는데 나는 원페어 이하일 때. 같은 원페어끼리 키커 · 무늬 차이로는 안 죽음)
  const mine = kCategory(bestK(v.cards).score);
  const shown = Math.max(-1, ...v.players.filter((x) => !x.folded && x.seat !== v.seat).map((x) => (x.up.length ? kCategory(openRank(x.up)) : -1)));
  if (last && shown > mine) return { type: "die", thinkMs: think(900, 2200), cue: toCall > 0 ? "fold" : undefined };

  // 좋은 시작(초반 페어 · 같은 무늬 4장 · 4장 연속): 사람처럼 세게 나옴
  const ranksMine = v.cards.map((c) => c >> 2);
  const pairRank = Math.max(-1, ...ranksMine.filter((x, i) => ranksMine.indexOf(x) !== i));
  // 이번 구에서 내가 이미 한 행동 — 한 번 콜로 따라간 봇이 같은 구에서 갑자기 다시 올리면 어색하므로(아주 센 패만 예외) 막음
  const mineNow = v.history.filter((h) => h.round === v.round && h.seat === v.seat && h.type !== "ante");
  const calledNow = mineNow.some((h) => h.type === "call");
  // 이번 구에 이미 올린 횟수: 올림이 쌓일수록 다시 올리는 기준을 높임 (레이즈 난사 방지)
  const raisesNow = v.history.filter((h) => h.round === v.round && h.aggressive).length;
  const strongStart = v.round === 4 && !mineNow.length && avail.length > 0 && (pairRank >= 0 || liveDraw(v));
  const pushStart = strongStart && raisesNow <= 1 && r() < (pairRank >= 8 || liveDraw(v) ? 0.45 : 0.3) * (0.7 + 0.3 * p.loose);

  if (toCall > 0) {
    const need = toCall / (v.pot + toCall);
    const big = toCall >= v.pot * 0.4 || toCall >= me.stack * 0.5;
    let margin = p.callMargin + 0.03 * (n - 1) + (last ? 0.01 : 0.035);
    // 칩의 큰 몫(올인 받기 등): 걸리는 몫 · 상대 수만큼 더 조심하고, 최소한 제 몫 정도는 이길 패여야 받음
    const risk = Math.min(1, toCall / Math.max(1, me.stack));
    if (risk >= 0.4) margin = Math.max(margin, 0.02) + 0.06 * risk + 0.03 * (n - 1);
    const floorEq = risk >= 0.4 ? 0.95 / (n + 1) + 0.03 : 0;
    // 재미 보정: 싼 베팅은 다음 장을 보러 잘 따라감 (마지막 구 전)
    if (!last && toCall <= v.pot * 0.3 && toCall < me.stack * 0.12) margin -= 0.045 * brain.skill.fun;
    const valueThr = 0.7 + 0.05 * (n - 1) + p.valueShift + 0.06 * Math.max(0, raisesNow - 1) + (calledNow ? 0.12 : 0);
    if (avail.length && eq >= valueThr) {
      if (!last && eq > 0.88 && r() < p.slowplay) return { type: "call", thinkMs: think(1400, 3000) };
      const b = pickBet(eq >= 0.88 ? 0.9 : eq >= 0.78 ? 0.6 : 0.3)!;
      return { type: b, thinkMs: think(1600, 3800), cue: allIn(b) ? "allin" : eq >= 0.8 ? "bigRaise" : "raise" };
    }
    // 드로우로 되받아침 (마지막 구 전, 판이 너무 크지 않을 때)
    if (avail.length && !calledNow && raisesNow <= 1 && !last && !big && eq < valueThr && liveDraw(v) && r() < p.semiBluff * 0.35) {
      const b = pickBet(0.45)!;
      return { type: b, thinkMs: think(1700, 3600), cue: allIn(b) ? "allin" : "raise" };
    }
    if (avail.length && !calledNow && raisesNow <= 1 && n === 1 && eq < 0.3 && !big && looksScary(me.up) && r() < 0.05 * p.bluff) {
      const b = pickBet(0.5)!;
      return { type: b, thinkMs: think(2000, 4200), cue: "bigRaise" };
    }
    // 괜찮은 패(기준 조금 아래)는 가끔 되받아 올림 — 너무 콜만 하지 않게 (같은 구에 아직 안 따라갔고, 올림이 하나뿐일 때)
    if (avail.length && !calledNow && raisesNow <= 1 && toCall < me.stack * 0.25 && eq >= Math.min(valueThr - 0.12, 0.15 + 1 / (n + 1)) && r() < 0.5 * (0.6 + 0.4 * p.reraise)) {
      const b = pickBet(0.5)!;
      return { type: b, thinkMs: think(1500, 3200), cue: allIn(b) ? "allin" : "raise" };
    }
    if (pushStart && toCall < me.stack * 0.15) {
      const b = pickBet(0.65)!;
      return { type: b, thinkMs: think(1300, 2800), cue: allIn(b) ? "allin" : "raise" };
    }
    // 초반(4 · 5구)에 내 칩에 비해 싼 벳이면 하프라도 "한 장 더 보자": 남은 카드가 많아(뒷심) 기준을 낮추고, 잡패도 가끔은 그냥 따라감
    const cheapEarly = !last && v.round <= 5 && toCall < me.stack * 0.06 && risk < 0.4;
    if (cheapEarly) {
      if (eq >= need * 0.7 + margin - 0.06 - 0.06 * brain.skill.fun) return { type: "call", thinkMs: think(900, 2200), cue: "call" };
      if (r() < 0.2 + 0.25 * brain.skill.fun) return { type: "call", thinkMs: think(1200, 2600), cue: "call" };
    }
    // 메이드 원페어 이상 · 편 카드로 지고 있지 않음 · 판에 비해 싼 콜이면 그냥 받음 (A 페어를 들고 첫 콜에 죽던 것)
    if (mine >= 1 && shown <= mine && toCall <= v.pot * 0.2 && risk < 0.2) return { type: "call", thinkMs: think(900, 2000), cue: "call" };
    if (eq >= need + margin && eq >= floorEq) return { type: "call", thinkMs: think(big ? 2000 : 1000, big ? 4800 : 2400), cue: allIn("call") ? "allin" : big && eq < 0.55 ? "heroCall" : "call" };
    return { type: "die", thinkMs: think(big ? 1600 : 800, big ? 3800 : 2000), cue: big && eq > 0.3 ? "bigFold" : "fold" };
  }

  // 받을 돈이 없음: 체크가 없으니 삥 이상을 걸거나 죽어야 함
  if (!avail.length) return { type: "die", thinkMs: think(600, 1200) };
  // 먼저 거는 차례인데 삥 값이 판에 비해 싸고 메이드 원페어 이상이면 죽지 않음
  const cheapLead = mine >= 1 && shown <= mine && (bets[avail[0]] ?? v.ante) <= v.pot * 0.15;
  const valueThr = 0.6 + 0.05 * (n - 1) + p.valueShift;
  if (eq >= valueThr) {
    // 센 패를 숨길 때는 가장 작은 삥만
    if (!last && eq > 0.85 && r() < p.slowplay) return { type: avail[0], thinkMs: think(1100, 2400) };
    const b = pickBet(eq >= 0.85 ? (last ? 1 : 0.8) : eq >= 0.72 ? 0.55 : 0.2)!;
    return { type: b, thinkMs: think(1200, 3000), cue: allIn(b) ? "allin" : "raise" };
  }
  if (pushStart) {
    const b = pickBet(0.65)!;
    return { type: b, thinkMs: think(1100, 2600), cue: allIn(b) ? "allin" : "raise" };
  }
  // 드로우로 먼저 세게 (완성되면 크게 먹고, 상대가 죽으면 그냥 먹음)
  if (!last && liveDraw(v) && r() < p.semiBluff * 0.8) {
    const b = pickBet(0.4)!;
    return { type: b, thinkMs: think(1300, 3000), cue: allIn(b) ? "allin" : "raise" };
  }
  if (eq < 0.4 && r() < 0.1 * p.bluff * (n === 1 ? 1 : 0.4) * (looksScary(me.up) ? 1.7 : 0.8)) {
    const b = pickBet(0.55)!;
    return { type: b, thinkMs: think(1500, 3400), cue: "bigRaise" };
  }
  // 삥 한 번 값으로 다음 장을 볼 만한지
  const bbing = bets[avail[0]] ?? v.ante;
  const need = bbing / (v.pot + bbing);
  if (cheapLead || eq >= need + p.callMargin + 0.02 * (n - 1) + (last ? 0.08 : 0)) return { type: avail[0], thinkMs: think(700, 1800) };
  return { type: "die", thinkMs: think(600, 1500), cue: "fold" };
}
