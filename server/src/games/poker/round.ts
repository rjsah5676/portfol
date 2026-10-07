import type { Card } from "../../../../web/src/lib/poker/cards";
import type { GameKind, Tier } from "../../../../web/src/lib/poker/rules";
import type { HoldemView, PokerEvent, SevenView } from "../../../../web/src/lib/poker/types";
import type { Brain, Cue } from "./personas";

/*
 * 테이블(table.ts)이 게임 한 판을 다루는 방식. 홀덤·7포커가 각자 이 모양으로 엔진을 감쌈.
 * 테이블은 자리·타이머·돈·봇 차례를 맡고, 규칙은 전부 Round 안에 있음.
 */

export interface RoundSeat {
  seat: number;
  stack: number;
  /** 상대 기록용 이름표 (사람 uid / "bot:이름") */
  key: string;
  human: boolean;
}

export interface Step {
  ev: PokerEvent[];
  /** 이 일을 화면이 보여 줄 동안 기다릴 시간 */
  pause: number;
}

export interface BotMove {
  input: unknown;
  thinkMs: number;
  cue?: Cue;
}

export interface Round {
  /** 지금 행동을 기다리는 자리들 (비어 있고 done 이 아니면 step 을 부를 차례) */
  waiting(): number[];
  /** 기다리는 종류: 베팅 차례인지, 7포커 카드 고르기인지 (제한 시간이 다름) */
  waitKind(): "act" | "choice";
  /** 행동. 규칙에 안 맞으면 RoundError */
  act(seat: number, input: unknown): PokerEvent[];
  /** 시간이 다 됐을 때 대신 하는 행동. fold = true 면 무조건 죽음(자리를 뜬 사람) */
  timeout(seat: number, fold?: boolean): PokerEvent[];
  step(): Step;
  done(): boolean;
  stack(seat: number): number;
  /** 아직 판에 남아 있는지 */
  alive(seat: number): boolean;
  view(deadline: number): HoldemView | SevenView;
  /** 그 자리만 볼 수 있는 것 */
  secret(seat: number): { cards: Card[]; down?: number[] } | null;
  botMove(seat: number, brain: Brain): BotMove;
  /** 끝난 뒤: 자리별 증감 · 가져간 돈 */
  deltas(): Record<number, number>;
  won(): Record<number, number>;
  /** 끝난 뒤: 봇이 한마디 할 만한 일 (센 패로 졌다 등) */
  cueFor(seat: number): Cue | undefined;
  /** 끝난 뒤: 블러프를 걸었다가 패를 보여 준 자리 (봇들이 기억함) */
  bluffers(): number[];
  /** 기록용 (핸드 로그) */
  audit(): unknown;
}

export interface StartOptions {
  tier: Tier;
  seats: RoundSeat[];
  handNo: number;
  /** 테이블에 남는 기억 (버튼 위치, 상대 기록 등 — 게임이 알아서 씀) */
  mem: Record<string, unknown>;
  randInt: (n: number) => number;
}

export interface GameDef {
  kind: GameKind;
  /** 한 판에 필요한 최소 칩 (이보다 적으면 봇은 파산 처리) */
  minStack(tier: Tier): number;
  /** 크게 이겼다·졌다를 재는 기준 판돈 */
  base(tier: Tier): number;
  start(o: StartOptions): { round: Round; ev: PokerEvent[]; pause: number };
  /** 판이 끝난 뒤 테이블 기억 갱신 (상대 기록 등) */
  learn?(round: Round, mem: Record<string, unknown>, keyOf: (seat: number) => string | undefined): void;
}

export class RoundError extends Error {}
