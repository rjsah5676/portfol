import type { BotId, TierId } from "../../../../web/src/lib/poker/rules";

/*
 * 봇 4명의 성격. 숫자 하나하나가 "이 사람은 이렇게 친다"는 뜻이고, 홀덤·7포커 봇이 같이 씀.
 * 봇은 사람과 똑같은 정보만 봄: 자기 패, 바닥에 깔린 카드, 남들이 한 행동. 남의 패·덱은 넘겨받지 않음.
 */

export interface Persona {
  id: BotId;
  /** 들어오는 패의 폭 (1 = 정석, 클수록 아무 패나 침) */
  loose: number;
  /** 들어올 때 레이즈로 여는 비율 (낮으면 콜로 따라 들어옴) */
  raiseShare: number;
  /** 다시 올리는(3벳) 빈도 배수 */
  reraise: number;
  /** 주도권이 있을 때 이어서 거는 빈도 배수 */
  cbet: number;
  /** 블러프 빈도 배수 */
  bluff: number;
  /** 드로우로 세게 치는 빈도 */
  semiBluff: number;
  /** 콜 기준을 얼마나 낮추는지 (음수 = 더 잘 받아줌, 양수 = 잘 죽음) */
  callMargin: number;
  /** 밸류로 걸기 시작하는 승률 기준을 얼마나 옮기는지 (음수 = 얇게도 침) */
  valueShift: number;
  /** 센 패를 숨기고 체크·콜하는 빈도 */
  slowplay: number;
  /** 벳 크기 배수 */
  sizing: number;
  /** 크게 잃었을 때 흔들리는 정도. 양수 = 흥분(더 풀고 더 지름), 음수 = 움츠러듦 */
  tilt: number;
  /** 생각하는 시간 배수 */
  pace: number;
  /** 말이 많은 정도 (0~1) */
  chatty: number;
}

export const PERSONAS: Record<BotId, Persona> = {
  // 계산형: 정석에 가깝게, 균형 잡힌 빈도
  gunmo: { id: "gunmo", loose: 1.0, raiseShare: 0.88, reraise: 1.0, cbet: 1.0, bluff: 0.9, semiBluff: 0.28, callMargin: 0.01, valueShift: 0, slowplay: 0.08, sizing: 1.0, tilt: 0.05, pace: 1.0, chatty: 0.3 },
  // 끈질긴 콜러: 넓게 따라 들어오고 잘 안 죽음. 레이즈는 진짜 셀 때만
  chunhee: { id: "chunhee", loose: 1.5, raiseShare: 0.3, reraise: 0.4, cbet: 0.55, bluff: 0.25, semiBluff: 0.1, callMargin: -0.07, valueShift: 0.05, slowplay: 0.12, sizing: 0.85, tilt: 0.5, pace: 0.95, chatty: 0.55 },
  // 노련한 타이트: 좁게 들어오고, 덫을 놓고, 아주 가끔 크게 속임
  deokpal: { id: "deokpal", loose: 0.66, raiseShare: 0.8, reraise: 0.7, cbet: 0.8, bluff: 0.45, semiBluff: 0.15, callMargin: 0.04, valueShift: 0.02, slowplay: 0.34, sizing: 1.1, tilt: -0.4, pace: 1.35, chatty: 0.4 },
  // 공격형: 넓게 열고, 자주 올리고, 계속 누름
  yeonseo: { id: "yeonseo", loose: 1.45, raiseShare: 0.92, reraise: 1.9, cbet: 1.3, bluff: 1.6, semiBluff: 0.45, callMargin: -0.02, valueShift: -0.04, slowplay: 0.04, sizing: 1.2, tilt: 0.8, pace: 0.75, chatty: 0.6 },
};

/** 단계별 실력: 동네판 봇은 읽기가 거칠고 실수가 있고, VIP 봇은 상대 성향까지 반영 */
export interface Skill {
  /** 승률 계산 횟수 (많을수록 정확) */
  sims: number;
  /** 승률 판단에 섞이는 오차 (표준편차) */
  noise: number;
  /** 상대의 행동으로 패를 좁혀 읽는 정도 (0 = 안 읽음, 1 = 다 읽음) */
  read: number;
  /** 상대 성향(통계)을 반영하는 정도 */
  adapt: number;
}
export const SKILL: Record<TierId, Skill> = {
  1: { sims: 160, noise: 0.07, read: 0.5, adapt: 0 },
  2: { sims: 260, noise: 0.035, read: 0.8, adapt: 0.5 },
  3: { sims: 400, noise: 0.012, read: 1, adapt: 1 },
};

/** 봇 한 명의 테이블 안 상태 (자리에 앉아 있는 동안 유지) */
export interface Brain {
  id: BotId;
  persona: Persona;
  skill: Skill;
  /** 흔들림 (0~1). 크게 잃으면 오르고 판마다 가라앉음 */
  heat: number;
  /** 상대별 앙금: 나한테 블러프를 보여 준 사람은 다음에 더 잘 받아줌 */
  grudge: Map<string, number>;
  rand: () => number;
}

export function newBrain(id: BotId, tier: TierId, rand: () => number = Math.random): Brain {
  return { id, persona: PERSONAS[id], skill: SKILL[tier], heat: 0, grudge: new Map(), rand };
}

/** 판이 끝날 때: 흔들림을 가라앉히고, 크게 잃었으면 올림 (lossBB = 이번 판에 잃은 돈 / 기준 판돈) */
export function coolDown(b: Brain, lossBB: number) {
  b.heat *= 0.8;
  if (lossBB >= 25) b.heat = Math.min(1, b.heat + Math.min(0.6, lossBB / 120) + 0.15);
  for (const [k, v] of b.grudge) {
    if (v < 0.1) b.grudge.delete(k);
    else b.grudge.set(k, v * 0.92);
  }
}

/** 흔들림이 반영된 지금의 성격 */
export function moodOf(b: Brain): Persona {
  const p = b.persona;
  const h = b.heat * p.tilt;
  if (!h) return p;
  if (h > 0)
    return { ...p, loose: p.loose * (1 + 0.5 * h), bluff: p.bluff * (1 + 0.9 * h), reraise: p.reraise * (1 + 0.6 * h), callMargin: p.callMargin - 0.06 * h, sizing: p.sizing * (1 + 0.25 * h) };
  // 움츠러드는 쪽: 더 좁게, 블러프를 줄임
  return { ...p, loose: p.loose * (1 + 0.45 * h), bluff: p.bluff * (1 + 0.7 * h), callMargin: p.callMargin - 0.05 * h };
}

// ───────────── 대사 ─────────────

export type Cue =
  | "sit"
  | "raise"
  | "bigRaise"
  | "allin"
  | "call"
  | "heroCall"
  | "fold"
  | "bigFold"
  | "check"
  | "win"
  | "bigWin"
  | "lose"
  | "badBeat"
  | "bust"
  | "humanAllin"
  | "humanBluffShown"
  | "cashout";

const LINES: Record<BotId, Partial<Record<Cue, string[]>>> = {
  gunmo: {
    sit: ["안녕하세요, 잘 부탁드립니다.", "한 판 배우러 왔습니다."],
    raise: ["레이즈하겠습니다.", "여긴 올리는 게 맞아요."],
    bigRaise: ["기댓값이 플러스라서요.", "이 사이즈가 맞습니다."],
    allin: ["올인입니다. 계산은 끝났어요.", "전부 넣겠습니다."],
    call: ["팟 오즈가 맞네요. 콜.", "콜할게요."],
    heroCall: ["블러프 빈도가 높아 보여서요. 콜.", "이건 받아야 하는 자리예요."],
    fold: ["이건 접겠습니다.", "폴드요."],
    bigFold: ["아깝지만 숫자가 안 나와요.", "여기선 접는 게 맞습니다."],
    win: ["감사합니다.", "잘 먹겠습니다."],
    bigWin: ["오늘 빌드가 잘 되네요.", "예상한 범위 안이었어요."],
    lose: ["나이스 핸드.", "잘 치셨어요."],
    badBeat: ["…확률은 확률일 뿐이죠.", "롤백하고 싶네요."],
    bust: ["재배포하고 오겠습니다.", "잠깐 자금 좀 채워 올게요."],
    humanAllin: ["흠, 올인이라…", "잠깐만요, 계산 좀 할게요."],
    humanBluffShown: ["아, 블러프였군요. 기록해 둘게요.", "다음엔 받아 드리겠습니다."],
    cashout: ["오늘은 여기까지 하겠습니다."],
  },
  chunhee: {
    sit: ["아이고, 자리 있네. 같이 좀 칩시다.", "오늘은 좀 따 볼까."],
    raise: ["이번엔 좀 올려 볼게.", "받아 봐."],
    bigRaise: ["이건 진짜야, 알아서 해.", "내가 올릴 땐 이유가 있어."],
    allin: ["에라, 다 넣는다!", "올인! 볼 테면 봐."],
    call: ["일단 보고 얘기하자. 콜.", "궁금해서 못 죽겠네. 콜.", "따라갈게."],
    heroCall: ["뻥인 거 다 알아. 콜!", "죽으면 잠이 안 와서 말이지. 콜."],
    fold: ["이번엔 쉴게.", "에이, 죽어."],
    bigFold: ["아이고 아까워라… 죽는다.", "이건 못 따라가겠네."],
    win: ["거 봐, 따라가길 잘했지.", "잘 먹을게~"],
    bigWin: ["오늘 저녁은 내가 쏜다!", "이 맛에 치는 거지."],
    lose: ["아이고, 그걸 들고 있었어?", "다음 판, 다음 판."],
    badBeat: ["어머, 마지막 장에 그게 떠?", "이건 좀 너무하다 얘."],
    bust: ["돈 좀 찾아올게, 자리 맡아 놔.", "잠깐 나갔다 올게."],
    humanAllin: ["어머, 화끈하네.", "진짜야? 얼굴 좀 보자."],
    humanBluffShown: ["내 그럴 줄 알았어!", "다음부턴 다 받아 버릴 거야."],
    cashout: ["많이 땄으니 오늘은 들어갈게."],
  },
  deokpal: {
    sit: ["허허, 한 자리 끼겠네.", "오랜만에 손 좀 풀어 볼까."],
    raise: ["올리겠네.", "값을 좀 쳐야지."],
    bigRaise: ["패는 거짓말을 안 하지.", "이쯤은 받아야 구경하지."],
    allin: ["다 걸겠네. 볼 텐가?", "허허, 올인일세."],
    call: ["받지.", "한 번 보세."],
    heroCall: ["그 벳은 냄새가 나는구먼. 받지.", "자네 손이 떨리던데. 콜."],
    fold: ["쉬어 가지.", "이 패는 아닐세."],
    bigFold: ["좋은 패도 버릴 줄 알아야지.", "오늘은 자네가 가져가게."],
    check: ["급할 것 없네."],
    win: ["허허, 고맙네.", "기다린 보람이 있구먼."],
    bigWin: ["한 방이면 되는 걸세.", "판은 기다리는 사람 것이지."],
    lose: ["잘 쳤네.", "그 패면 자네 것이지."],
    badBeat: ["허허… 이런 날도 있는 게지.", "카드가 야속하구먼."],
    bust: ["밑천 좀 가져오겠네.", "잠시 바람 좀 쐬고 오지."],
    humanAllin: ["젊은 사람이 겁이 없구먼.", "허허, 급하기도 하지."],
    humanBluffShown: ["허, 당했구먼. 기억해 두지.", "배짱 한번 좋네."],
    cashout: ["딸 만큼 땄으니 일어나겠네."],
  },
  yeonseo: {
    sit: ["안녕하세요~ 살살 해 드릴게요.", "자리 있죠? 앉을게요!"],
    raise: ["레이즈요~", "조금만 더 올릴게요."],
    bigRaise: ["무서우면 죽어도 돼요 ㅎㅎ", "이번엔 진짜일 수도 있어요?"],
    allin: ["올인~ 받을 수 있어요?", "전부요. 고민해 보세요 ㅎㅎ"],
    call: ["콜이요.", "따라갈게요~"],
    heroCall: ["거짓말 못 하시네요. 콜!", "그거 블러프죠? 콜."],
    fold: ["이번 판은 양보할게요.", "폴드~"],
    bigFold: ["아 진짜… 죽을게요.", "이번만 봐드리는 거예요."],
    win: ["감사합니다~", "ㅎㅎ 잘 받을게요."],
    bigWin: ["이거 맛있네요!", "오늘 좀 되는 날인가 봐요."],
    lose: ["오, 잘 치시네요?", "다음 판에 받아 갈게요."],
    badBeat: ["아니 그게 왜 떠요?!", "말도 안 돼…"],
    bust: ["충전하고 올게요, 기다려요!", "금방 다시 올 거예요."],
    humanAllin: ["오~ 세게 나오시네요.", "어, 쫄리는데요?"],
    humanBluffShown: ["와, 속았다. 인정!", "이제 안 믿을 거예요."],
    cashout: ["많이 땄으니까 저 먼저 갈게요~"],
  },
};

/** 상황에 맞는 한마디 (없거나 말수가 적으면 undefined). force 는 꼭 말해야 하는 상황 */
export function line(b: Brain, cue: Cue, force = false): string | undefined {
  const list = LINES[b.id][cue];
  if (!list?.length) return undefined;
  if (!force && b.rand() > b.persona.chatty * 0.5) return undefined;
  return list[Math.floor(b.rand() * list.length)];
}
