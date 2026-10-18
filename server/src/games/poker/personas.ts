import type { CharId, TierId } from "../../../../web/src/lib/poker/rules";

/*
 * 유저봇의 성격. 봇마다 앉을 때 난수로 새로 뽑아서 같은 봇은 둘도 없음.
 * 숫자 하나하나가 "이 사람은 이렇게 친다"는 뜻이고, 홀덤·7포커 봇이 같이 씀.
 * 봇은 사람과 똑같은 정보만 봄: 자기 패, 바닥에 깔린 카드, 남들이 한 행동. 남의 패·덱은 넘겨받지 않음.
 */

export interface Persona {
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

/** 성격의 뼈대 4가지. 실제 봇은 이 중 하나 근처에서 흔들린 값 */
const ARCHETYPES: Persona[] = [
  // 정석
  { loose: 1.0, raiseShare: 0.88, reraise: 1.0, cbet: 1.0, bluff: 0.9, semiBluff: 0.28, callMargin: 0.01, valueShift: 0, slowplay: 0.08, sizing: 1.0, tilt: 0.05, pace: 1.0, chatty: 0.3 },
  // 끈질긴 콜러
  { loose: 1.5, raiseShare: 0.3, reraise: 0.4, cbet: 0.55, bluff: 0.25, semiBluff: 0.1, callMargin: -0.07, valueShift: 0.05, slowplay: 0.12, sizing: 0.85, tilt: 0.5, pace: 0.95, chatty: 0.55 },
  // 타이트, 덫
  { loose: 0.66, raiseShare: 0.8, reraise: 0.7, cbet: 0.8, bluff: 0.45, semiBluff: 0.15, callMargin: 0.04, valueShift: 0.02, slowplay: 0.34, sizing: 1.1, tilt: -0.4, pace: 1.35, chatty: 0.4 },
  // 공격형
  { loose: 1.45, raiseShare: 0.92, reraise: 1.9, cbet: 1.3, bluff: 1.6, semiBluff: 0.45, callMargin: -0.02, valueShift: -0.04, slowplay: 0.04, sizing: 1.2, tilt: 0.8, pace: 0.75, chatty: 0.6 },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 성격을 난수로 하나 뽑음: 뼈대 둘을 섞고 항목마다 조금씩 흔듦 */
export function randomPersona(rand: () => number = Math.random): Persona {
  const a = ARCHETYPES[Math.floor(rand() * ARCHETYPES.length)];
  const b = ARCHETYPES[Math.floor(rand() * ARCHETYPES.length)];
  const w = rand() * 0.5; // b 쪽 비중 (0~0.5)
  const mix = (k: keyof Persona, jitter: number, lo: number, hi: number) =>
    clamp(a[k] * (1 - w) + b[k] * w + (rand() * 2 - 1) * jitter, lo, hi);
  return {
    loose: mix("loose", 0.2, 0.5, 2.0),
    raiseShare: mix("raiseShare", 0.12, 0.1, 1),
    reraise: mix("reraise", 0.25, 0.2, 2.5),
    cbet: mix("cbet", 0.15, 0.3, 1.6),
    bluff: mix("bluff", 0.25, 0.1, 2.0),
    semiBluff: mix("semiBluff", 0.08, 0.03, 0.6),
    callMargin: mix("callMargin", 0.02, -0.1, 0.08),
    valueShift: mix("valueShift", 0.02, -0.08, 0.08),
    slowplay: mix("slowplay", 0.06, 0, 0.45),
    sizing: mix("sizing", 0.1, 0.7, 1.4),
    tilt: mix("tilt", 0.2, -0.8, 1.0),
    pace: mix("pace", 0.2, 0.55, 1.6),
    chatty: mix("chatty", 0.15, 0.05, 0.8),
  };
}

/** 단계별 실력 기준 (승률 계산 횟수 · 재미 보정은 여기서도 가져다 씀 — 실제 봇은 아래 randomSkill 의 세 부류로) */
export interface Skill {
  /** 승률 계산 횟수 (많을수록 정확) */
  sims: number;
  /** 승률 판단에 섞이는 오차 (표준편차) */
  noise: number;
  /** 상대의 행동으로 패를 좁혀 읽는 정도 (0 = 안 읽음, 1 = 다 읽음) */
  read: number;
  /** 상대 성향(통계)을 반영하는 정도 */
  adapt: number;
  /** 재미 보정 (0 = 정석대로, 1 = 동네판 아재): 넓게 들어오고 잘 안 죽고 자주 지름 — 판이 자주 쇼다운까지 가게 */
  fun: number;
  /** 실력 부류 (못 치는 봇 · 보통 · 센 봇) */
  level?: SkillLevel;
}
export const SKILL: Record<TierId, Skill> = {
  // 일반
  1: { sims: 160, noise: 0.07, read: 0.5, adapt: 0, fun: 1 },
  2: { sims: 260, noise: 0.035, read: 0.8, adapt: 0.5, fun: 0.6 },
  3: { sims: 400, noise: 0.012, read: 1, adapt: 1, fun: 0.35 },
  // 도박꾼: 정석에 가깝되 판이 커서 오히려 잘 지름
  4: { sims: 400, noise: 0.012, read: 1, adapt: 1, fun: 0.35 },
  5: { sims: 450, noise: 0.01, read: 1, adapt: 1, fun: 0.3 },
  6: { sims: 450, noise: 0.01, read: 1, adapt: 1, fun: 0.3 },
  // 타짜
  7: { sims: 500, noise: 0.008, read: 1, adapt: 1, fun: 0.25 },
  8: { sims: 500, noise: 0.008, read: 1, adapt: 1, fun: 0.25 },
  9: { sims: 550, noise: 0.006, read: 1, adapt: 1, fun: 0.25 },
};

/**
 * 봇 실력은 세 부류로 나눠 뽑음 — 한 테이블에 잘 치는 봇 · 보통 봇 · 못 치는 봇이 섞여 있어야 재미있음.
 * 낮은 단계일수록 못 치는 봇(호구)이 많고, 높은 단계일수록 센 봇이 많음. 부류 안에서도 봇마다 조금씩 다름.
 */
export type SkillLevel = "weak" | "mid" | "strong";
const LEVEL: Record<SkillLevel, Omit<Skill, "fun" | "level"> & { fun: number }> = {
  // 못 치는 봇: 승률 계산이 거칠고 상대 행동을 잘 안 읽음, 넓게 들어와서 잘 안 죽음
  weak: { sims: 160, noise: 0.075, read: 0.35, adapt: 0, fun: 1 },
  mid: { sims: 300, noise: 0.03, read: 0.8, adapt: 0.5, fun: 0.5 },
  // 센 봇: 계산이 정확하고 행동 · 성향을 다 읽음
  strong: { sims: 500, noise: 0.008, read: 1, adapt: 1, fun: 0.15 },
};
/** 단계별 부류 비율 [못 치는 봇, 보통, 센 봇] */
export const LEVEL_MIX: Record<TierId, [number, number, number]> = {
  1: [0.55, 0.35, 0.1],
  2: [0.42, 0.43, 0.15],
  3: [0.3, 0.48, 0.22],
  4: [0.3, 0.45, 0.25],
  5: [0.25, 0.45, 0.3],
  6: [0.2, 0.45, 0.35],
  7: [0.15, 0.4, 0.45],
  8: [0.1, 0.4, 0.5],
  9: [0.08, 0.32, 0.6],
};
export function randomSkill(tier: TierId, rand: () => number = Math.random): Skill {
  const [w, m] = LEVEL_MIX[tier];
  const x = rand();
  const level: SkillLevel = x < w ? "weak" : x < w + m ? "mid" : "strong";
  const s = LEVEL[level];
  const f = 0.85 + rand() * 0.3;
  return {
    sims: level === "strong" ? Math.max(s.sims, SKILL[tier].sims) : s.sims,
    noise: clamp(s.noise * (2 - f), 0.005, 0.12),
    read: clamp(s.read * f, 0, 1),
    adapt: clamp(s.adapt * f, 0, 1),
    // 판이 클수록(단계가 높을수록) 재미 보정은 줄어듦 — 부류 기준과 단계 기준의 가운데
    fun: clamp((s.fun + SKILL[tier].fun) / 2 + (rand() - 0.5) * 0.2, 0, 1),
    level,
  };
}

/** 봇 한 명의 테이블 안 상태 (자리에 앉아 있는 동안 유지) */
export interface Brain {
  /** 상대 기록용 열쇠 ("bot:" + 고유값) */
  key: string;
  /** 말투 · 그림 */
  char: CharId;
  persona: Persona;
  skill: Skill;
  /** 흔들림 (0~1). 크게 잃으면 오르고 판마다 가라앉음 */
  heat: number;
  /** 상대별 앙금: 나한테 블러프를 보여 준 사람은 다음에 더 잘 받아줌 */
  grudge: Map<string, number>;
  /** 이 테이블에서 친 판 수 · 이만큼 치면 일어남 */
  hands: number;
  stayHands: number;
  /** 수금 기준: 들고 온 칩의 몇 배가 되면 일어날까 고민하기 시작하는지 (봇마다 다름, 욕심 많은 봇은 높음) */
  cashAt: number;
  rand: () => number;
}

let seq = 0;
export function newBrain(char: CharId, tier: TierId, rand: () => number = Math.random, persona = randomPersona(rand)): Brain {
  return {
    key: `bot:${Date.now().toString(36)}${(seq++).toString(36)}`,
    char,
    persona,
    skill: randomSkill(tier, rand),
    heat: 0,
    grudge: new Map(),
    hands: 0,
    stayHands: 8 + Math.floor(rand() * 30),
    cashAt: 1.8 + rand() * 2.7,
    rand,
  };
}

/** 판이 끝날 때: 흔들림을 가라앉히고, 크게 잃었으면 올림 (lossBB = 이번 판에 잃은 돈 / 기준 판돈) */
export function coolDown(b: Brain, lossBB: number) {
  b.hands++;
  b.heat *= 0.8;
  if (lossBB >= 25) b.heat = Math.min(1, b.heat + Math.min(0.6, lossBB / 120) + 0.15);
  for (const [k, v] of b.grudge) {
    if (v < 0.1) b.grudge.delete(k);
    else b.grudge.set(k, v * 0.92);
  }
}

/** 흔들림이 반영된 지금의 성격 */
export function moodOf(b: Brain): Persona {
  const p = funOf(b.persona, b.skill.fun);
  const h = b.heat * p.tilt;
  if (!h) return p;
  if (h > 0)
    return { ...p, loose: p.loose * (1 + 0.5 * h), bluff: p.bluff * (1 + 0.9 * h), reraise: p.reraise * (1 + 0.6 * h), callMargin: p.callMargin - 0.06 * h, sizing: p.sizing * (1 + 0.25 * h) };
  // 움츠러드는 쪽: 더 좁게, 블러프를 줄임
  return { ...p, loose: p.loose * (1 + 0.45 * h), bluff: p.bluff * (1 + 0.7 * h), callMargin: p.callMargin - 0.05 * h };
}

/** 재미 보정: 패를 넓게 치고, 받는 기준을 낮추고(잘 안 죽음), 가끔 더 지름 */
function funOf(p: Persona, fun: number): Persona {
  if (fun <= 0) return p;
  return {
    ...p,
    loose: Math.min(2.2, p.loose * (1 + 0.55 * fun)),
    callMargin: p.callMargin - 0.06 * fun,
    bluff: p.bluff * (1 + 0.3 * fun),
    semiBluff: Math.min(0.7, p.semiBluff * (1 + 0.3 * fun)),
    slowplay: p.slowplay * (1 - 0.3 * fun),
  };
}

// ───────────── 대사 (캐릭터 말투) ─────────────

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
  | "cashout"
  | "leave";

const LINES: Record<CharId, Partial<Record<Cue, string[]>>> = {
  jinwoo: {
    sit: ["왔다. 한 판 붙자.", "자리 비었지? 들어간다.", "ㅎㅇ 오늘 다 가져간다"],
    raise: ["올려.", "레이즈. 받아 봐.", "여기서 안 올리면 남자가 아니지"],
    bigRaise: ["겁나면 죽어.", "자, 진짜 승부다.", "이거 받을 배짱 있어?"],
    allin: ["올인!! 다 걸었다!", "전부 다 넣는다. 와 봐.", "승부!!"],
    call: ["콜.", "받아.", "그 정도는 받지"],
    heroCall: ["뻥이지? 콜.", "그 얼굴 다 보인다. 콜!", "너 지금 떨고 있어. 콜"],
    fold: ["쳇, 다음 판.", "이건 패스.", "죽어 줄게. 이번만."],
    bigFold: ["아… 아깝다. 죽는다.", "이건 못 받겠네… 젠장.", "다음 판에 두 배로 받는다"],
    win: ["ㅋㅋ 잘 먹었다!", "이게 승부지!", "봤지? 이게 나야."],
    bigWin: ["으하하하! 전부 내 거다!", "오늘 완전 불 붙었다!!", "누가 날 막아!"],
    lose: ["큭… 잘 쳤다.", "다음엔 안 봐준다.", "아 뭐야 ㅋㅋ"],
    badBeat: ["뭐?! 그게 왜 떠!!", "말도 안 돼… 리버 미쳤네", "으아아아 열받아!!"],
    bust: ["돈 채워서 바로 온다. 기다려!", "잠깐 충전하고 복귀한다"],
    humanAllin: ["오? 세게 나오네.", "올인? 재밌어지는데 ㅋㅋ", "좋아, 그 배짱 마음에 든다"],
    humanBluffShown: ["아 뭐야 뻥이었어?! 다음엔 다 받아버린다", "하… 당했다. 기억했다 너"],
    cashout: ["오늘 많이 땄으니 간다 ㅋㅋ", "수고~ 다음에 또 털러 온다"],
    leave: ["나 간다. 수고들~", "밥 먹으러 감 ㅂㅂ", "다음에 또 붙자"],
  },
  yeonseo: {
    sit: ["안녕하세요.", "잘 부탁드려요.", "한 자리 앉을게요."],
    raise: ["올릴게요.", "레이즈.", "조금 더요."],
    bigRaise: ["…이 정도면 되겠죠.", "받으실 건가요.", "생각할 시간 드릴게요."],
    allin: ["올인이에요.", "전부 걸게요. 후회는 없어요.", "…다 넣을게요."],
    call: ["콜.", "받을게요.", "네."],
    heroCall: ["…블러프 같네요. 콜.", "손이 너무 빨랐어요. 콜.", "확인해 볼게요."],
    fold: ["접을게요.", "다이.", "이번엔 쉬어요."],
    bigFold: ["…아쉽지만 접어요.", "좋은 패인데… 다이.", "여기까지요."],
    check: ["체크."],
    win: ["감사합니다.", "잘 받았어요.", "운이 좋았네요."],
    bigWin: ["…후. 감사합니다.", "기다린 보람이 있네요.", "이 판은 제 거였어요."],
    lose: ["잘 치셨어요.", "그 패였군요.", "다음 판이요."],
    badBeat: ["…마지막 장이라니.", "그럴 수도 있죠. …네.", "…(한숨)"],
    bust: ["잠깐 다녀올게요.", "자금 좀 채우고 올게요."],
    humanAllin: ["…올인이군요.", "흥미롭네요.", "조금만 생각할게요."],
    humanBluffShown: ["…그랬군요. 기억할게요.", "다음엔 안 속아요."],
    cashout: ["오늘은 여기까지 할게요.", "충분히 땄어요. 먼저 갈게요."],
    leave: ["먼저 일어날게요.", "즐거웠어요.", "다음에 또 봬요."],
  },
  taeyang: {
    sit: ["ㅎㅇㅎㅇ 형 왔다", "자리 있네? 끼자 끼자", "오 여기 돈 냄새 난다 ㅋㅋ"],
    raise: ["올려올려~", "레이즈 ㄱㄱ", "쫄?"],
    bigRaise: ["이건 진짜임 ㅋㅋ 아마도", "받을 수 있으면 받아 봐~", "형이 쏜다~"],
    allin: ["올인!! 가즈아!!", "다 박는다 ㅋㅋㅋ", "인생 한 방이지~"],
    call: ["콜~", "ㅇㅋ 받음", "그 정도야 뭐"],
    heroCall: ["뻥 티 난다 ㅋㅋㅋ 콜", "야 너 그거 아무것도 없지? 콜", "형은 다 보여~ 콜"],
    fold: ["에바 ㅋㅋ 죽을게", "패스~", "이번 판 쉼"],
    bigFold: ["아… 이건 못 받겠다 ㅠ", "젠장 다이", "ㅅㅂ 아까워"],
    win: ["ㅋㅋㅋㅋ 개꿀", "잘 먹었습니다~", "이게 되네 ㅋㅋ"],
    bigWin: ["개이득!!! 오늘 치킨이다", "ㅋㅋㅋㅋㅋ 다 내 거", "야 이거 실화냐"],
    lose: ["아 뭐야 ㅋㅋ", "ㅇㅈ 잘 쳤다", "운 좋네~"],
    badBeat: ["아 ㅅㅂ 리버 뭔데", "이게 말이 됨?? 미친", "에바에바에바"],
    bust: ["돈 뽑아 올게 ㅋㅋ 기다려", "알바비 들어오면 다시 옴"],
    humanAllin: ["오~ 쎄게 나오네 ㅋㅋ", "올인? 간지 ㅇㅈ", "흠… 고민되네"],
    humanBluffShown: ["아 당했다 ㅋㅋㅋ 인정", "ㅋㅋㅋ 다음엔 다 받는다"],
    cashout: ["많이 땄으니 튄다 ㅋㅋ", "오늘 수익 굿~ 간다"],
    leave: ["나 감 ㅂㅂ", "친구 불러서 감~", "다음에 또 봐 ㅋㅋ"],
  },
  jeongmin: {
    sit: ["안녕하세요.", "한 자리 실례하겠습니다.", "잘 부탁드립니다."],
    raise: ["레이즈하겠습니다.", "올리는 게 맞는 자리네요.", "레이즈."],
    bigRaise: ["기댓값이 플러스입니다.", "이 사이즈가 정확해요.", "계산은 끝났습니다."],
    allin: ["올인입니다.", "전부 넣겠습니다. 수치상 맞아요.", "…올인."],
    call: ["팟 오즈가 맞네요. 콜.", "콜.", "받겠습니다."],
    heroCall: ["블러프 빈도가 높아 보여서요. 콜.", "확률적으로 받아야 해요. 콜.", "…콜."],
    fold: ["접겠습니다.", "다이.", "이건 아니네요."],
    bigFold: ["숫자가 안 나와요. 접습니다.", "아쉽지만 폴드.", "여기선 접는 게 맞습니다."],
    check: ["체크."],
    win: ["감사합니다.", "예상 범위 안이었어요.", "잘 받겠습니다."],
    bigWin: ["계산대로네요.", "…후, 수치가 맞았어요.", "이게 확률입니다."],
    lose: ["잘 치셨어요.", "나이스 핸드.", "그 레인지였군요."],
    badBeat: ["…확률은 확률일 뿐이죠.", "4%가 떴네요.", "…재계산이 필요하겠어요."],
    bust: ["자금을 보충하고 오겠습니다.", "잠시 자리 비울게요."],
    humanAllin: ["흠, 올인이라…", "잠깐 계산 좀 할게요.", "…흥미로운 선택이네요."],
    humanBluffShown: ["블러프였군요. 기록해 두겠습니다.", "데이터에 반영할게요."],
    cashout: ["목표 수익 달성. 일어나겠습니다.", "오늘은 여기까지 하겠습니다."],
    leave: ["먼저 가 보겠습니다.", "수고하셨습니다.", "다음에 뵙죠."],
  },
  amy: {
    sit: ["…앉을게. 딱히 너희랑 치고 싶어서는 아니거든.", "자리 비었네. 흥.", "안녕… 뭐, 잘 부탁해."],
    raise: ["올릴 거야.", "레이즈. 뭐 어때서.", "흥, 올려."],
    bigRaise: ["무서우면 죽어도 돼.", "이, 이건 진짜거든?!", "받을 수 있으면 받아 보든가."],
    allin: ["오, 올인! 후회 안 해!", "전부 다! …떨리는 거 아니거든.", "올인이야. 봐 봐."],
    call: ["콜.", "…받아 줄게.", "뭐, 콜."],
    heroCall: ["그거 뻥이지? 다 보여. 콜!", "흥, 속을 줄 알고? 콜.", "콜! …틀리면 어쩌지"],
    fold: ["이번 판은 양보해 줄게.", "다이. 딱히 무서워서는 아니야.", "…접을래."],
    bigFold: ["아, 아까워… 다이.", "이번만 봐주는 거야!", "…흥. 죽어."],
    win: ["당연하지. 흥.", "ㅎ, 잘 먹을게.", "별거 아니었어."],
    bigWin: ["봤지?! …아니 딱히 기쁜 건 아니고.", "에헤헤… 아니 흠흠. 당연한 결과야.", "이, 이 정도는 기본이거든!"],
    lose: ["…잘 쳤네. 인정.", "흥, 운이 좋았을 뿐이야.", "다음 판엔 안 봐줘."],
    badBeat: ["뭐?! 그게 왜 떠?!", "말도 안 돼!! 으으…", "…울지 않아. 안 운다고."],
    bust: ["돈 채워 올게! 기다리라고 한 건 아니야!", "잠깐… 금방 올 거야."],
    humanAllin: ["오, 올인…? 흥, 겁 안 나거든.", "세, 세게 나오네…", "잠깐만. 생각 좀."],
    humanBluffShown: ["속였어?! 두고 봐!", "…흥. 다음엔 다 받아 버릴 거야."],
    cashout: ["많이 땄으니까 갈래. 흥.", "오늘은 여기까지. 고마운 거 아니야."],
    leave: ["나 갈래. …안녕.", "먼저 가. 재밌었던 건 아니고.", "다음에 또… 아니 아무것도."],
  },
  // 미오는 사야 쓰는 캐릭터라 봇으로는 안 앉음 (타입을 맞추려고 짧게만)
  mio: {
    sit: ["…미오예요.", "…앉을게요."],
    allin: ["…올인."],
    win: ["…이겼어요."],
    lose: ["…졌어요."],
    leave: ["…갈게요."],
  },
  // 세라도 사야 쓰는 캐릭터라 봇으로는 안 앉음
  sera: {
    sit: ["에헤헤, 왔다.", "옆자리… 비어 있지?"],
    allin: ["올인. 도망 못 가."],
    win: ["에헤헤, 내 거."],
    lose: ["…괜찮아. 다음엔 안 놓쳐."],
    leave: ["금방 다시 올게."],
  },
};

/** 상황에 맞는 한마디 (없거나 말수가 적으면 undefined). force 는 꼭 말해야 하는 상황 */
export function line(b: Brain, cue: Cue, force = false): string | undefined {
  const list = LINES[b.char][cue];
  if (!list?.length) return undefined;
  if (!force && b.rand() > b.persona.chatty * 0.5) return undefined;
  return list[Math.floor(b.rand() * list.length)];
}
