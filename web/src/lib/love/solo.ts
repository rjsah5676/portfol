/*
 * 올인 러브 — 혼자 하는 준비 (일정 카드)
 * 「노트 정리」: 그녀 노트 ??? 칸에 방향 힌트 1 (mHint → mind.ts withHint)
 * 「동네 한 바퀴」: 주머니에 작은 물건 1 (itemStraw 딸기 사탕 = 에이미 취향 · itemMint 박하사탕 = 연서 취향)
 *   → 다음 히로인 장면에서 '건네기' 선택지(✦). 맞는 취향이면 호감 · 신뢰 + 마음 순간(mA14 · mY14)
 * 서브 캐릭터 대사 없음: 주인공 속마음 · 서술 + 히로인 반응만
 */
import { A, card, ME, N, TH, Y } from "./dsl";
import type { Cond, Opt, Scenes, Step } from "./types";

const has = (v: string): Cond => ({ v, op: ">=", n: 1 });
const none = (v: string): Cond => ({ v, op: "<=", n: 0 });

/** 일정 카드: 노트 정리 (scene = 장면 id, cond = 횟수 제한) */
export const noteCard = (scene: string, cond?: Cond, eff: Record<string, number> = {}): Opt =>
  card("노트 정리", "원룸 · 혼자 복기", scene, { icon: "✎", hint: "혼자 · 그녀 노트 힌트 1", eff: { mHint: 1, ...eff }, ...(cond && { cond }) });

/** 일정 카드: 동네 한 바퀴 */
export const walkCard = (scene: string, cond?: Cond, eff: Record<string, number> = {}): Opt =>
  card("동네 한 바퀴", "혼자 · 편의점 · 시장 · 골목", scene, {
    icon: "🍬",
    hint: "혼자 · 건넬 물건 하나",
    ...(Object.keys(eff).length && { eff }),
    ...(cond && { cond }),
  });

/** 노트 정리 장면 */
export const noteScene = (id: string, back: Step): Scenes => ({
  [id]: [
    { t: "bg", id: "room" },
    { t: "bgm", id: "confide" },
    { t: "sfx", id: "pen" },
    N("원룸 책상. 카드 대신 수첩을 폈다. 이번 주에 그녀가 한 말, 지은 표정을 한 줄씩 적어 내려갔다."),
    TH("…그때 그 표정. 그냥 넘긴 게 하나 있다."),
    N("빈칸 옆에 작은 물음표를 그렸다. 답은 아니어도, 어디를 봐야 할지는 알 것 같았다."),
    back,
  ],
});

/** 동네 한 바퀴 장면 (물건은 종류별로 하나까지) */
export const walkScene = (id: string, back: Step): Scenes => ({
  [id]: [
    { t: "bg", id: "alley_after" },
    { t: "bgm", id: "daily" },
    N("혼자 동네를 한 바퀴 돌았다. 편의점, 시장 골목, 펍 뒷골목. 3년 동안 고개 숙이고 지나다니던 길이다."),
    TH("…그녀한테 건넬 만한 게, 하나쯤 있을까."),
    {
      t: "choice",
      prompt: "주머니에 뭘 넣어 갈까?",
      opts: [
        { text: "(편의점 계산대 옆, 딸기 사탕 한 봉지)", cond: none("itemStraw"), eff: { itemStraw: 1 }, to: `${id}_s` },
        { text: "(시장 할머니 가게, 박하사탕 한 봉지)", cond: none("itemMint"), eff: { itemMint: 1 }, to: `${id}_m` },
        { text: "(빈손으로 걷기만 한다)", eff: { tilt: -1 }, to: `${id}_0` },
      ],
    },
  ],
  [`${id}_s`]: [
    { t: "bg", id: "store" },
    N("딸기 사탕 한 봉지를 주머니에 넣었다. 분홍 포장이 걸을 때마다 바스락거렸다."),
    TH("이 맛을 좋아할 사람. 생각해 보면, 알 것 같다."),
    back,
  ],
  [`${id}_m`]: [
    { t: "bg", id: "market" },
    N("시장 골목에 빗방울이 다시 흩뿌렸다. 차양 밑 할머니가 박하사탕을 한 국자 더 얹어 주었다. 하얀 봉지가 주머니 속에서 묵직했다."),
    TH("이 맛을 좋아할 사람. 생각해 보면, 알 것 같다."),
    back,
  ],
  [`${id}_0`]: [
    N("아무것도 사지 않고 골목 끝까지 걸었다. 바람이 차가웠고, 머리가 조금 맑아졌다."),
    back,
  ],
});

/**
 * 히로인 장면의 '건네기' 훅: 장면 X 에서 히로인이 등장한 직후
 *   { t:"when", cond: giftCond(who, wk), to: X_gift } → 끝나면 X_c 로
 * wk = 주차 (1 · 2 · 3): 주마다 한 번만 건넨다. 첫 '맞는 선물'과 두 번째부터는 반응이 다름 (giftA · giftY 횟수)
 */
type Wk = 1 | 2 | 3;
const GK = (who: "amy" | "yeonseo", wk: Wk) => `g${who === "amy" ? "A" : "Y"}${wk}`;
export const giftCond = (who: "amy" | "yeonseo", wk: Wk): Cond => ({
  all: [{ any: [has("itemStraw"), has("itemMint")] }, none(GK(who, wk))],
});
export const giftHook = (x: string, who: "amy" | "yeonseo", wk: Wk): Step => ({ t: "when", cond: giftCond(who, wk), to: `${x}_gift` });

export const giftScenes = (x: string, who: "amy" | "yeonseo", wk: Wk): Scenes => {
  const gk = GK(who, wk);
  const back: Step = { t: "goto", to: `${x}_gx` };
  const amy = who === "amy";
  const cnt = amy ? "giftA" : "giftY";
  const good: Record<string, number> = amy ? { affA: 2, trustA: 1, giftA: 1, mA14: 1 } : { affY: 2, trustY: 1, giftY: 1, mY14: 1 };
  const right = amy ? "itemStraw" : "itemMint";
  const wrong = amy ? "itemMint" : "itemStraw";
  const label = (k: string) => (k === "itemStraw" ? "(딸기 사탕 봉지를 내민다)" : "(박하사탕 봉지를 내민다)");
  const okFirst: Step[] = amy
    ? [
        A("…딸기? 너 내 취향 어떻게 알았어?", "surprise"),
        ME("그냥. 보면 알지."),
        A("이건 공짜 아니야. 다음에 사탕으로 갚을 거야.", "blush"),
        N("그녀가 한 알을 까서 입에 넣고, 남은 봉지를 가방 제일 앞주머니에 넣었다."),
      ]
    : [
        Y("…박하사탕이요.", "surprise"),
        Y("이모가 사 주던 거예요. 그거 아는 사람, 이모 말고 처음이에요.", "blush"),
        N("그녀가 봉지를 주머니에 넣었다. 손이 한 번, 주머니 위에 머물렀다."),
      ];
  const okAgain: Step[] = amy
    ? [A("또 딸기야? …너 나 길들이는 중이지.", "smug"), N("투덜대면서도 봉지를 먼저 낚아챘다. 볼이 사탕 하나만큼 볼록해졌다.")]
    : [Y("…또 박하사탕. 이제 주머니에 이거 없으면 허전하겠어요.", "away"), N("말과 달리, 봉지는 바로 주머니 안으로 사라졌다.")];
  const mehLines: Step[] = amy
    ? [A("박하? 이거 할머니 사탕이잖아. …그래도 먹을게.", "pout"), N("한 알 물고 인상을 쓰다가, 봉지는 끝내 돌려주지 않았다.")]
    : [Y("…딸기 맛이네요. 이거, 금발 손님 취향인데.", "base"), N("그래도 그녀는 봉지를 돌려주지 않았다. 조용히 주머니에 넣었다.")];
  return {
    [`${x}_gift`]: [
      N("주머니 속에서 사탕 봉지가 바스락거렸다. 혼자 동네 한 바퀴 돌다 산 것."),
      {
        t: "choice",
        prompt: "지금 건넬까?",
        opts: [
          { text: label(right), prep: true, cond: has(right), eff: { [right]: -1, [gk]: 1, ...good }, to: `${x}_gok` },
          { text: label(wrong), prep: true, cond: has(wrong), eff: { [wrong]: -1, [gk]: 1 }, to: `${x}_gmeh` },
          { text: "(나중에 주자)", to: `${x}_gx` },
        ],
      },
    ],
    [`${x}_gok`]: [
      N("✦ 동네 한 바퀴 돌다 산 봉지. 그녀 취향이었다."),
      { t: "when", cond: { v: cnt, op: ">=", n: 2 }, to: `${x}_gok2` },
      ...okFirst,
      back,
    ],
    [`${x}_gok2`]: [...okAgain, back],
    [`${x}_gmeh`]: [...mehLines, TH("…다음엔 그녀 취향을 생각해 보자."), back],
  };
};
