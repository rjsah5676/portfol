/*
 * 올인 러브 — 진짜 헤즈업 홀덤 (대결 모드)
 * 카드 번호는 ANIME POKER 와 같음: 숫자(0=2 … 12=A) × 4 + 무늬(0 s · 1 h · 2 d · 3 c)
 * 상대 AI: 몬테카를로 승률 + 캐릭터 성향. 행동마다 '버릇 단서'가 나옴 (알면 해석이 뜸)
 */
import { evaluate, handName } from "@/lib/poker/cards";
import type { CharKey } from "./types";

export type Seat = "me" | "opp";
export type ActKind = "fold" | "check" | "call" | "bet" | "raise" | "allin";
/** AI 속마음 분류 → 버릇 단서 */
export type Read = "strong" | "bluff" | "mid";

export interface Persona {
  /** 좋은 패로 크게 가는 정도 */
  aggr: number;
  /** 블러프 빈도 */
  bluff: number;
  /** 약한 패로도 따라오는 정도 */
  loose: number;
  /** 버릇이 진짜 속마음을 드러낼 확률 (나머지는 헛버릇) */
  acc: number;
  /** 읽기 노트 버릇 id */
  tellId: string;
}

export const PERSONA: Partial<Record<CharKey, Persona>> = {
  amy: { aggr: 0.7, bluff: 0.3, loose: 0.6, acc: 0.85, tellId: "amyLoud" },
  yeonseo: { aggr: 0.45, bluff: 0.2, loose: 0.3, acc: 0.85, tellId: "yeonTap" },
  boss: { aggr: 0.6, bluff: 0.12, loose: 0.4, acc: 0.9, tellId: "bossGlass" },
  taeyang: { aggr: 0.3, bluff: 0.12, loose: 0.85, acc: 0.9, tellId: "tyHum" },
  jeongmin: { aggr: 0.45, bluff: 0.25, loose: 0.35, acc: 0.85, tellId: "jmRecord" },
};

/** 버릇 단서: 겉으로 보이는 모습 (strong / bluff). mid 는 단서 없음 */
export const CUE: Partial<Record<CharKey, Record<"strong" | "bluff", string[]>>> = {
  amy: {
    strong: ["갑자기 조용해졌다. 트윈테일 끝을 손가락에 감는다.", "말이 없다. 눈이 칩이 아니라 내 손을 본다."],
    bluff: ["목소리가 커졌다. 칩을 달그락거린다.", "\"쫄리지?\" 하면서 의자 위에서 들썩인다."],
  },
  yeonseo: {
    strong: ["손이 펠트 위에서 미동도 없다. 목소리도 평평하다.", "아무 버릇도 없다. 숨소리까지 고르다."],
    bluff: ["칩을 밀기 직전, 손끝이 테이블을 두 번 두드렸다.", "손끝이 펠트를 톡, 톡. 두 번."],
  },
  boss: {
    strong: ["웃는 얼굴. 그리고 왼손 손가락 세 개가 테이블을 두 번, 가볍게 두드린다.", "손가락 세 개가 물잔 가장자리에 걸렸다."],
    bluff: ["웃는 얼굴. 늘 그렇듯이. 왼손은 무릎 위에 있다.", "웃음이 조금 더 커졌다. 손은 움직이지 않는다."],
  },
  taeyang: {
    strong: ["콧노래가 새어 나온다. 본인은 모르는 눈치다.", "흥얼흥얼. 칩을 밀면서도 멈추지 않는다."],
    bluff: ["\"형, 이건 진짜 진짜예요. 진짜로요.\" 말이 많다.", "묻지도 않았는데 자기 패 자랑을 시작했다."],
  },
  jeongmin: {
    strong: ["\"기록상, 이건 좋은 판입니다.\"", "\"기록상 제 승률이 높습니다.\""],
    bluff: ["\"…좋은 판입니다.\" 말끝이 짧다.", "\"승률이 높습니다.\" 평소의 그 말이 빠졌다."],
  },
};

/**
 * 테이블 토크 — 판마다 한 번, 내 첫 행동 전에 거는 한마디. 그 판 동안만 상대 성향(Persona)을 바꿈.
 * clue: 그 판에서 반응이 실제로 보이면(seen) 노트에 '반응 단서'로 적힘 (플래그 rcXX → 세이브에 남음 · clues.ts)
 */
export interface Mod {
  aggr?: number;
  bluff?: number;
  loose?: number;
  acc?: number;
  /** 버릇이 겉으로 보일 확률 (없으면 늘 보임, 0.25 = 거의 숨김) */
  show?: number;
  /** 이 속마음일 땐 그 판 동안 버릇이 확실히(정확하게) 나옴 */
  sure?: "strong" | "bluff";
}
export interface Talk {
  id: string;
  /** 버튼 글자 (내 말 · 행동) */
  label: string;
  /** 상대 대답 (말풍선, 음성 없음) */
  reply: string[];
  mod: Mod;
  /** 반응 단서 플래그 */
  clue?: string;
  /** 반응 확인 조건: 그 겉모습 버릇이 떴을 때 · any = 아무 버릇 · hide = 버릇이 숨겨졌을 때 */
  seen?: "strong" | "bluff" | "any" | "hide";
}
export const TALK: Partial<Record<CharKey, Talk[]>> = {
  amy: [
    { id: "taunt", label: "\"쫄았지? 오늘도 7·2 기다려?\"", reply: ["뭐? 쫄긴 누가! 이번 판 다 걸어 줄게!", "하, 두고 봐. 지금 레이즈할 거니까."], mod: { bluff: 0.25, aggr: 0.1, sure: "bluff" }, clue: "rcA1", seen: "bluff" },
    { id: "praise", label: "\"오늘 손 좋은데?\"", reply: ["그치? 오늘 나 좀 되는 날이야!", "헤헤. 칭찬받으면 더 세게 건다?"], mod: { aggr: 0.25, loose: 0.1 }, clue: "rcA2", seen: "any" },
    { id: "bet", label: "\"이번 판 지면 딸기우유.\"", reply: ["콜! 큰 거로!", "…좋아. 이번 건 진지하게 할 거야."], mod: { bluff: -0.15, acc: 0.1, sure: "strong" }, clue: "rcA3", seen: "strong" },
  ],
  yeonseo: [
    { id: "praise", label: "\"오늘도 계산 정확하네요.\"", reply: ["…칭찬은 계산에 없어요.", "그런 말 하면, 표정 관리를 더 해야 돼요."], mod: { show: 0.25, bluff: -0.05 }, clue: "rcY1", seen: "hide" },
    { id: "wait", label: "(아무 말 없이, 그녀가 먼저 움직이길 기다린다)", reply: ["……", "…기다리는 거, 반칙이에요."], mod: { sure: "bluff", bluff: 0.05 }, clue: "rcY2", seen: "bluff" },
    { id: "taunt", label: "\"확률로는 오늘 질 텐데요?\"", reply: ["그럼 확률대로 해 볼게요.", "…좋아요. 들어갈 판만 들어갈게요."], mod: { loose: -0.25, bluff: -0.1, aggr: 0.1, sure: "strong" }, clue: "rcY3", seen: "strong" },
  ],
  taeyang: [
    { id: "ask", label: "\"그 패 좋아요?\"", reply: ["형, 그걸 왜 물어봐요! 좋죠! 아마도! 진짜로요!", "에이 형, 비밀이에요. 근데 좋아요. 아마."], mod: { bluff: 0.15, sure: "bluff" }, clue: "rcT1", seen: "bluff" },
    { id: "praise", label: "\"오늘 감 좋네요.\"", reply: ["진짜요? 흥얼흥얼~ 아, 소리 났어요?", "형이 그러니까 기분 좋은데요!"], mod: { aggr: 0.2, sure: "strong" }, clue: "rcT2", seen: "strong" },
    { id: "record", label: "\"정민 씨가 이 판 기록한대요.\"", reply: ["야, 정민아! 그럼 잘해야 되잖아!", "기록이요? 으, 긴장된다."], mod: { aggr: -0.1, loose: -0.15 } },
  ],
  jeongmin: [
    { id: "record", label: "\"이 판도 기록하실 거죠?\"", reply: ["물론입니다. 기록상, 모든 판은 기록됩니다.", "기록하겠습니다. 기록상."], mod: { acc: 0.1, show: 1 }, clue: "rcJ1", seen: "any" },
    { id: "taunt", label: "\"오늘은 오차 크게 나겠는데요?\"", reply: ["…오차는 제 전문입니다.", "도발은 효과가 없습니다."], mod: { bluff: 0.2, sure: "bluff" }, clue: "rcJ2", seen: "bluff" },
    { id: "praise", label: "\"정민 씨 계산은 정확하던데요.\"", reply: ["사실입니다.", "…감사합니다. 기록해 두겠습니다."], mod: { aggr: 0.15 } },
  ],
};
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** 토크로 바뀐 그 판의 성향 */
export const withMod = (p: Persona, m?: Mod): Persona =>
  m
    ? {
        ...p,
        aggr: clamp01(p.aggr + (m.aggr ?? 0)),
        bluff: clamp01(p.bluff + (m.bluff ?? 0)),
        loose: clamp01(p.loose + (m.loose ?? 0)),
        acc: clamp01(p.acc + (m.acc ?? 0)),
      }
    : p;

/** 버릇을 알 때 붙는 해석 */
export const READ_TXT: Partial<Record<CharKey, Record<"strong" | "bluff", string>>> = {
  amy: { strong: "조용하면 진짜. 좋은 패다.", bluff: "시끄러우면 블러프." },
  yeonseo: { strong: "버릇 없이 조용하면 진짜.", bluff: "두 번 두드리면 보여 주는 수. 블러프." },
  boss: { strong: "손가락 세 개 = 이길 걸 안다.", bluff: "손가락이 안 움직였다. 웃음은 아무 뜻 없다." },
  taeyang: { strong: "콧노래 = 좋은 패.", bluff: "말이 많으면 블러프." },
  jeongmin: { strong: "'기록상'이 붙었다. 진짜다.", bluff: "'기록상'이 빠졌다. 블러프." },
};

/** 판 중간 한마디 (행동별) */
export const CHAT: Partial<Record<CharKey, Partial<Record<ActKind | "winHand" | "loseHand", string[]>>>> = {
  amy: {
    bet: ["베팅! 따라올 수 있으면 따라와 봐.", "이 정도는 걸어야 재밌지."],
    raise: ["레이즈! 쫄리면 지금 죽든가~", "올려. 더 올려."],
    call: ["콜. 구경은 해야지.", "…콜."],
    check: ["체크. 뭐, 일단은.", "체크~"],
    fold: ["죽어. 이번 건 봐준다.", "아 몰라, 접어!"],
    allin: ["올인! 전부!", "다 걸어. 아빠도 이렇게 했어."],
    winHand: ["봤지? 봤지?!", "딜러 잡았다!"],
    loseHand: ["아 진짜! 다음 판!", "…방금 건 연습이야."],
  },
  yeonseo: {
    bet: ["베팅할게요.", "이만큼요."],
    raise: ["올릴게요.", "…레이즈요."],
    call: ["콜이요.", "따라갈게요."],
    check: ["체크요.", "넘길게요."],
    fold: ["접을게요. 계산상 손해라서요.", "이번 판은 드릴게요."],
    allin: ["전부요.", "…올인이에요."],
    winHand: ["제 거네요.", "계산대로예요."],
    loseHand: ["…졌네요. 계산이 틀렸어요.", "딜러님 거예요."],
  },
  boss: {
    bet: ["조금만 걸죠.", "이 정도는 인사죠."],
    raise: ["올리죠. 재밌잖아요.", "하하. 레이즈요."],
    call: ["따라가 보죠.", "콜이요."],
    check: ["체크. 천천히 하죠.", "넘기죠. 우린 시간 많으니까요."],
    fold: ["이번 건 양보하죠.", "하하. 접죠."],
    allin: ["전부 가죠.", "올인이에요. 웃으면서요."],
    winHand: ["테이블은 공평하죠.", "하하. 제 거네요."],
    loseHand: ["손은 역시 아깝네요.", "괜찮아요. 판은 많으니까요."],
  },
  taeyang: {
    bet: ["형, 베팅이요!", "이거 걸게요!"],
    raise: ["레이즈! 형 오늘 각오해요!", "올려요 올려!"],
    call: ["콜! 무조건 콜!", "보고 싶어서 콜이요."],
    check: ["체크요~", "일단 체크."],
    fold: ["으악, 접어요.", "이건 아니다. 접을게요."],
    allin: ["올인! 인생 한 방!", "다 걸어요!"],
    winHand: ["이겼다! 형 이겼어요!", "봤죠? 정민아 기록해!"],
    loseHand: ["형 너무해요…", "아니 그게 왜 나와요."],
  },
  jeongmin: {
    bet: ["베팅합니다.", "이 정도 걸겠습니다."],
    raise: ["레이즈하겠습니다.", "올립니다."],
    call: ["콜하겠습니다.", "따라갑니다."],
    check: ["체크입니다.", "넘기겠습니다."],
    fold: ["폴드. 손실 최소화입니다.", "접겠습니다."],
    allin: ["올인입니다.", "전부 걸겠습니다."],
    winHand: ["예상 범위 안입니다.", "제 팟입니다."],
    loseHand: ["오차입니다.", "다음 판에 회수하겠습니다."],
  },
};

export const pick = <T,>(a: T[] | undefined, r = Math.random): T | undefined =>
  a && a.length ? a[Math.floor(r() * a.length)] : undefined;

function shuffled(r = Math.random): number[] {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/** 보이는 보드 기준 승률 (상대 패 무작위 가정) */
export function equity(hole: number[], board: number[], iters = 300, r = Math.random): number {
  const used = new Set([...hole, ...board]);
  const rest = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));
  let win = 0;
  for (let k = 0; k < iters; k++) {
    // 부분 셔플: 상대 2장 + 남은 보드
    const need = 2 + (5 - board.length);
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(r() * (rest.length - i));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    const opp = [rest[0], rest[1]];
    const full = [...board, ...rest.slice(2, need)];
    const a = evaluate([...hole, ...full]);
    const b = evaluate([...opp, ...full]);
    win += a > b ? 1 : a === b ? 0.5 : 0;
  }
  return win / iters;
}

export interface Hand {
  me: [number, number];
  opp: [number, number];
  board: number[]; // 5장 미리 정해 둠
  shown: 0 | 3 | 4 | 5;
  stack: Record<Seat, number>;
  bet: Record<Seat, number>;
  pot: number;
  button: Seat;
  toAct: Seat;
  /** 이번 거리에서 행동했는지 */
  acted: Record<Seat, boolean>;
  raises: number;
  over?: { winner: Seat | "split"; by: "fold" | "showdown" };
}

export const BB = 2;
const other = (s: Seat): Seat => (s === "me" ? "opp" : "me");

export function newHand(stack: Record<Seat, number>, button: Seat, r = Math.random): Hand {
  const d = shuffled(r);
  const sb = button;
  const bb = other(button);
  const h: Hand = {
    me: [d[0], d[2]],
    opp: [d[1], d[3]],
    board: d.slice(4, 9),
    shown: 0,
    stack: { ...stack },
    bet: { me: 0, opp: 0 },
    pot: 0,
    button,
    toAct: sb, // 헤즈업 프리플랍은 버튼(스몰)이 먼저
    acted: { me: false, opp: false },
    raises: 0,
  };
  post(h, sb, Math.min(1, h.stack[sb]));
  post(h, bb, Math.min(BB, h.stack[bb]));
  return h;
}

function post(h: Hand, s: Seat, n: number) {
  h.stack[s] -= n;
  h.bet[s] += n;
}

export const toCall = (h: Hand, s: Seat) => Math.max(0, h.bet[other(s)] - h.bet[s]);
const potNow = (h: Hand) => h.pot + h.bet.me + h.bet.opp;

/** 이 자리에서 할 수 있는 행동 + 금액 (베팅/레이즈는 '총 베팅액' 기준) */
export function options(h: Hand, s: Seat): { k: ActKind; to?: number }[] {
  const call = toCall(h, s);
  const st = h.stack[s];
  const oppSt = h.stack[other(s)];
  const out: { k: ActKind; to?: number }[] = [];
  if (call > 0) out.push({ k: "fold" });
  out.push(call > 0 ? { k: "call" } : { k: "check" });
  const canRaise = st > call && oppSt > 0 && h.raises < 3;
  if (canRaise) {
    const base = h.bet[other(s)];
    const size = Math.max(BB, Math.round(potNow(h) * (call > 0 ? 0.75 : 0.5)));
    const to = base + size;
    if (to - h.bet[s] < st) out.push({ k: call > 0 ? "raise" : "bet", to });
  }
  if (st > 0 && (call < st)) out.push({ k: "allin" });
  return out;
}

/** 행동 적용. 반환: 거리가 끝났는지 */
export function act(h: Hand, s: Seat, k: ActKind, to?: number): void {
  const o = other(s);
  h.acted[s] = true;
  if (k === "fold") {
    h.over = { winner: o, by: "fold" };
    return;
  }
  if (k === "check") {
    /* 그대로 */
  } else if (k === "call") {
    post(h, s, Math.min(toCall(h, s), h.stack[s]));
  } else if (k === "bet" || k === "raise") {
    post(h, s, Math.min((to ?? 0) - h.bet[s], h.stack[s]));
    h.raises++;
    h.acted[o] = false;
  } else if (k === "allin") {
    const before = h.bet[s];
    post(h, s, h.stack[s]);
    if (h.bet[s] > h.bet[o]) {
      h.raises++;
      h.acted[o] = false;
    }
    void before;
  }
  h.toAct = o;
}

/** 이번 거리 끝? (둘 다 행동했고 베팅이 같거나, 한쪽이 올인해서 더 못 냄) */
export function streetDone(h: Hand): boolean {
  if (h.over) return true;
  const even = h.bet.me === h.bet.opp;
  const allinShort =
    (h.stack.me === 0 && h.bet.me <= h.bet.opp && h.acted.opp) ||
    (h.stack.opp === 0 && h.bet.opp <= h.bet.me && h.acted.me);
  return (h.acted.me && h.acted.opp && even) || allinShort;
}

/** 다음 거리로 (남는 베팅 돌려주기 포함). 쇼다운까지 가면 over 설정 */
export function nextStreet(h: Hand): void {
  // 올인 금액 차이 돌려주기
  const m = Math.min(h.bet.me, h.bet.opp);
  for (const s of ["me", "opp"] as Seat[]) {
    h.stack[s] += h.bet[s] - m;
    h.bet[s] = m;
  }
  h.pot += h.bet.me + h.bet.opp;
  h.bet = { me: 0, opp: 0 };
  h.acted = { me: false, opp: false };
  h.raises = 0;
  const someoneAllin = h.stack.me === 0 || h.stack.opp === 0;
  if (h.shown === 5 || someoneAllin) {
    h.shown = 5;
    const a = evaluate([...h.me, ...h.board]);
    const b = evaluate([...h.opp, ...h.board]);
    h.over = { winner: a > b ? "me" : a < b ? "opp" : "split", by: "showdown" };
    return;
  }
  h.shown = h.shown === 0 ? 3 : h.shown === 3 ? 4 : 5;
  h.toAct = other(h.button); // 플랍부터는 빅 블라인드가 먼저
}

/** 판 정산 → 새 스택 */
export function settle(h: Hand): Record<Seat, number> {
  const st = { ...h.stack };
  const pot = h.pot + h.bet.me + h.bet.opp;
  const w = h.over?.winner;
  if (w === "split") {
    st.me += Math.floor(pot / 2);
    st.opp += pot - Math.floor(pot / 2);
  } else if (w) st[w] += pot;
  return st;
}

export const nameOf = (hole: number[], board: number[]) =>
  board.length >= 3 ? handName(evaluate([...hole, ...board])) : "";

/** AI 결정: 행동 + 속마음 분류 */
export function aiAct(h: Hand, who: CharKey, r = Math.random, mod?: Mod): { k: ActKind; to?: number; read: Read } {
  const p = withMod(PERSONA[who] ?? PERSONA.jeongmin!, mod);
  const board = h.board.slice(0, h.shown);
  const eq = equity(h.opp, board, 260, r);
  const ops = options(h, "opp");
  const has = (k: ActKind) => ops.find((o) => o.k === k);
  const call = toCall(h, "opp");
  const pot = potNow(h);
  const odds = call / (pot + call || 1);
  const strong = eq > 0.68;
  const good = eq > 0.52;

  if (call === 0) {
    if (strong && r() < p.aggr + 0.2) {
      if (eq > 0.85 && r() < p.aggr * 0.4 && has("allin")) return { k: "allin", read: "strong" };
      const b = has("bet");
      if (b) return { ...b, read: "strong" };
    }
    if (good && r() < p.aggr * 0.6) {
      const b = has("bet");
      if (b) return { ...b, read: "mid" };
    }
    if (!good && r() < p.bluff * (h.shown ? 1 : 0.5)) {
      const b = has("bet");
      if (b) return { ...b, read: "bluff" };
    }
    return { k: "check", read: strong ? "strong" : "mid" };
  }
  // 따라가야 할 때
  if (strong && r() < p.aggr) {
    if (eq > 0.85 && has("allin") && r() < 0.5) return { k: "allin", read: "strong" };
    const rr = has("raise");
    if (rr) return { ...rr, read: "strong" };
  }
  if (eq + p.loose * 0.18 > odds + 0.08) return { k: "call", read: strong ? "strong" : "mid" };
  if (r() < p.bluff * 0.35) {
    const rr = has("raise");
    if (rr) return { ...rr, read: "bluff" };
  }
  return { k: "fold", read: "mid" };
}

/**
 * 버릇 단서: 진짜 속마음(read) → 겉모습. acc 확률로 맞고, 아니면 반대 버릇(헛버릇)
 * mod.show 확률로만 보임 (안 보이면 hidden) · mod.sure 와 속마음이 같으면 확실히 맞게 나옴
 */
export function cueFor(
  who: CharKey,
  read: Read,
  r = Math.random,
  mod?: Mod
): { look: "strong" | "bluff"; text: string; hidden?: boolean } | null {
  if (read === "mid") return null;
  const p = PERSONA[who] ? withMod(PERSONA[who]!, mod) : undefined;
  if (mod?.show !== undefined && mod.sure !== read && r() > mod.show) return { look: read, text: "", hidden: true };
  const sure = mod?.sure === read;
  const look: "strong" | "bluff" = !sure && p && r() > p.acc ? (read === "strong" ? "bluff" : "strong") : read;
  const text = pick(CUE[who]?.[look], r);
  return text ? { look, text } : null;
}
