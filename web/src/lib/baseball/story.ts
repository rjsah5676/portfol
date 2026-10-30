/*
 * 육성 메인 스토리 — 「해체 직전의 팀」
 * 3년 연속 꼴찌 픽셀 파이터즈 2군. 구단주가 「이번 시즌 우승 못 하면 2군 해체」를 못 박았고,
 * 무명 입단 테스트생인 내가 6주 안에 팀을 챔피언 결정전까지 끌고 간다.
 * 팀 사람들(감독 · 주장 · 주전 경쟁 선배 · 전력분석 · 후배)이 매주 챕터 장면으로 이야기를 끌고 가고,
 * 픽셀파이트 격투가들(인연 덱)은 감독 옛 친구의 도장에서 온 특별 트레이너.
 * 규칙(감독 지시 · 챕터 번호)은 career.ts, 여기는 대사만.
 */
import {
  ORDER_REWARD, PICK_POS, TRAINS, chapterOf, myRank, oppOf, posOf, standings,
  type Career, type GameSummary, type Order,
} from "./career";
import { TEAM_DEFS, charById } from "./data";
import { isBond, type BondId } from "./bonds";

/* ─────────────── 등장인물 ─────────────── */

export type CastId = "oh" | "seo" | "kang" | "min" | "naru";
export const CAST: Record<CastId, { name: string; role: string; img: string; color: string }> = {
  oh: { name: "오석진", role: "감독", img: "/baseball/ui/npc-manager.webp", color: "#ffcf4a" },
  seo: { name: "서지훈", role: "주장", img: "/baseball/ui/npc-captain.webp", color: "#7ad7ff" },
  kang: { name: "강태풍", role: "선배", img: "/baseball/ui/npc-senior.webp", color: "#ff7a7a" },
  min: { name: "민해성", role: "전력분석", img: "/baseball/ui/npc-glasses.webp", color: "#b6ffb0" },
  naru: { name: "나루", role: "후배", img: "/baseball/ui/npc-junior.webp", color: "#ffb0e6" },
};
export const isCast = (w: string): w is CastId => w in CAST;

/** 대사 한 줄: 누가(팀 사람 · 인연 캐릭터 · 나 · 해설) */
export type Speaker = CastId | BondId | "me" | "narr";
export interface SLine {
  who: Speaker;
  text: string;
}
export interface StoryChoice {
  text: string;
  reply: SLine;
  fx: { cond?: number; sp?: number; money?: number };
}
export interface StoryScene {
  /** 본 장면 기록 키 (판을 넘어 「본 장면」 표시) */
  key: string;
  /** 큰 띠 제목 · 부제 */
  title: string;
  sub: string;
  /** 배경 분위기 (CareerBonds PLACE_BG 키 또는 stadium · dugout · office) */
  place: string;
  lines: SLine[];
  choices?: StoryChoice[];
  /** 이번 챕터 감독 지시 (장면 끝 카드) */
  order?: Order;
}

/* ─────────────── 상대 팀 (TEAM_DEFS 1 ~ 3) ─────────────── */

/** 상대 팀 이야기: 색깔 · 에이스 · 전력분석 한 줄 */
export const RIVALS: Record<number, { ace: string; aceRole: string; style: string; scout: string[] }> = {
  1: {
    ace: "독고진",
    aceRole: "4번 타자 「괴물」",
    style: "리그 팀 타율 1위 — 치고받는 타격전",
    scout: ["글리치 몬스터즈는 1번부터 9번까지 다 칩니다. 점수 줄 각오하고, 우리도 그만큼 내야 해요.", "4번 독고진, 지난 시즌 홈런 1위. 걔 앞에 주자를 쌓으면 끝이에요."],
  },
  2: {
    ace: "하무열",
    aceRole: "사이드암 에이스 「뱀눈」",
    style: "평균자책 1위 투수 왕국 — 한 점 싸움",
    scout: ["버그 바이퍼스는 투수 왕국이에요. 많이 못 칩니다. 한 점이 크다는 뜻이죠.", "에이스 하무열은 옆으로 던지는 휘는 공이 무기예요. 끝까지 보고 짧게 치세요."],
  },
  3: {
    ace: "류건",
    aceRole: "강속구 에이스 「용」",
    style: "지난 시즌 우승팀 — 빈틈없는 균형형",
    scout: ["렉 드래곤즈는 지난 시즌 우승팀. 약점이 거의 없어요.", "선발 류건은 150km 직구가 주무기. 늦으면 끝이에요, 타이밍을 앞에 두세요."],
  },
};

/* ─────────────── 도우미 ─────────────── */

const L = (who: Speaker, text: string): SLine => ({ who, text });
const deckNames = (c: Career) => c.deck.map((id) => charById(id).name);
const posName = (c: Career) => PICK_POS.find((p) => p.pos === posOf(c))?.name ?? "주전";
const lastRes = (c: Career) => c.hist[c.hist.length - 1];
const josa = (w: string, a: string, b: string) => {
  const ch = w.charCodeAt(w.length - 1);
  return ch >= 0xac00 && ch <= 0xd7a3 && (ch - 0xac00) % 28 ? a : b;
};
/** 「카이, 이그나, 메이」 */
const list = (xs: string[]) => xs.join(", ");
export const orderText = (o: Order) => `${TRAINS[o.key].name} ${o.need}번`;

/* ─────────────── 프롤로그 (새 선수 만들고 바로) ─────────────── */

export function prologue(c: Career): StoryScene {
  const deck = deckNames(c);
  const lines: SLine[] = [
    L("narr", "3월, 픽셀시티 변두리. 페인트가 벗겨진 2군 연습 구장."),
    L("oh", `${c.name}. 입단 테스트 때 그 스윙, 아직 기억한다.`),
    L("oh", "돌려 말하지 않겠다. 우리 픽셀 파이터즈 2군은 라이징스타 리그 3년 연속 꼴찌다."),
    L("oh", "그리고 어제 구단주가 못을 박았다. 이번 시즌 우승 못 하면… 2군은 해체다."),
    L("seo", "주장 서지훈이다. 시즌은 6주, 매주 주말에 리그 경기가 한 번씩 있다."),
    L("seo", "4팀 중 1위만 챔피언 결정전에 간다. 거기서 이겨야 팀이 산다."),
    L("kang", `흥, 테스트생이 ${posName(c)} 자리 넘보는 거야? 주전은 이 강태풍 거다.`),
    L("min", "전력분석 민해성입니다. 상대 팀 데이터는 매주 경기 전에 드릴게요."),
    L("naru", "선배! 저 막내 나루예요! 같이 꼴찌 탈출해요!!"),
  ];
  if (deck.length)
    lines.push(
      L("oh", "하나 더. 내 옛 친구가 하는 격투 도장 「픽셀 파이트」에서 특별 트레이너를 보내 줬다."),
      L("oh", `${list(deck)}. 야구는 몰라도 몸 쓰는 건 프로들이다. 연습장에서 같이 훈련하면 배로 는다.`),
    );
  else lines.push(L("oh", "격투 도장 「픽셀 파이트」 녀석들도 가끔 연습장에 얼굴 비출 거다. 잘 지내 봐라."));
  lines.push(
    L("oh", "캠프는 나흘. 하루에 하나씩 — 훈련이든 휴식이든 네가 정해라."),
    L("oh", "캠프가 끝나면 이번 시즌 네 목표를 정한다. …자, 각오 한마디 해 봐라."),
  );
  return {
    key: "story:pro",
    title: "PROLOGUE",
    sub: "해체 직전의 팀",
    place: "stadium",
    lines,
    choices: [
      { text: "\"제가 우승시키겠습니다.\"", reply: L("oh", "…큰소리는 좋다. 그 말, 6주 뒤에 다시 듣자."), fx: { cond: 1 } },
      { text: "\"일단 주전부터 따겠습니다.\"", reply: L("kang", "하, 해 볼 테면 해 봐라."), fx: { sp: 15 } },
      { text: "(말없이 배트를 고쳐 쥔다)", reply: L("oh", "…마음에 드는군. 말보다 스윙이다."), fx: { money: 120 } },
    ],
  };
}

/* ─────────────── 주차 챕터 (주가 바뀌고 연습장에 처음 들어올 때) ─────────────── */

const CH_TITLE: Record<number, string> = {
  1: "개막",
  2: "한 점의 무게",
  3: "방출당한 남자",
  4: "빈자리",
  5: "벤치의 목소리",
  6: "마지막 정규전",
  7: "챔피언 결정전",
};

/** 지난 결과 · 순위로 시작하는 감독 한마디 */
function moodLine(c: Career): SLine | null {
  const r = lastRes(c);
  const rank = myRank(c);
  if (!r) return null;
  if (r === "W" && rank === 1) return L("oh", "지난주 이겼다. 지금 단독 1위다. 들뜨지 마라, 아직 반도 안 왔다.");
  if (r === "W") return L("oh", `지난주 승리로 분위기는 좋다. 그래도 아직 ${rank}위다. 한 경기씩이다.`);
  if (rank >= 3) return L("oh", `지난주는 졌다. 지금 ${rank}위… 이대로면 결승은 없다.`);
  return L("oh", "지난주 패배는 잊어라. 진 경기에서 배운 걸로 이번 주를 이긴다.");
}

export function chapter(c: Career): StoryScene | null {
  const ch = chapterOf(c);
  if (ch < 1 || ch > 7) return null;
  const o = c.story?.order;
  const oppI = oppOf(c);
  const opp = TEAM_DEFS[oppI];
  const rv = RIVALS[oppI];
  const rank = myRank(c);
  const lines: SLine[] = [];
  const mood = moodLine(c);
  const deck = c.deck;
  const buddy: BondId | undefined = deck[(ch - 1) % Math.max(1, deck.length)];
  if (ch === 1) {
    lines.push(
      L("narr", "개막전 아침. 라커룸 화이트보드에 선발 명단이 붙었다."),
      L("naru", `선배! 명단에 선배 이름 있어요! ${c.name}!`),
      L("min", `개막전 상대는 ${opp.name}. ${rv.style}이 될 겁니다.`),
      L("kang", "개막전부터 삼진이나 먹지 마라. 팀 망신이니까."),
    );
  } else if (ch === 2) {
    if (mood) lines.push(mood);
    lines.push(
      L("min", `이번 주는 ${opp.name}. ${rv.aceRole} ${rv.ace}${josa(rv.ace, "이", "가")} 나와요.`),
      L("kang", lastRes(c) === "W" ? "지난 경기? 운이 좋았던 거다. 이번엔 다를 거다." : "봐라, 아직 멀었잖아. 내 자리는 안 뺏긴다."),
    );
  } else if (ch === 3) {
    if (mood) lines.push(mood);
    lines.push(
      L("seo", `이번 상대는 ${opp.name}. …태풍이한테는 특별한 팀이야.`),
      L("seo", "작년에 저 팀에서 방출당하고 우리한테 왔거든."),
      L("narr", "그날 밤, 불 꺼진 배팅 케이지에 강태풍 혼자 남아 있었다."),
      L("kang", "…뭘 봐. 이번 경기는 꼭 이긴다. 네가 발목 잡으면 가만 안 둔다."),
    );
  } else if (ch === 4) {
    if (mood) lines.push(mood);
    lines.push(
      L("narr", "월요일 아침, 강태풍의 손목에 붕대가 감겨 있었다."),
      L("kang", "…지난 경기 슬라이딩하다 삐었다. 이번 주는 벤치다."),
      L("kang", `내 자리, 네가 지켜라. ${c.name}. …망치면 진짜 가만 안 둔다.`),
      L("naru", "태풍 선배가 저런 말을 하다니… 선배, 진짜 인정받은 거예요!"),
    );
  } else if (ch === 5) {
    if (mood) lines.push(mood);
    lines.push(
      L("kang", "벤치에서 보니까 네 스윙, 나쁘지 않더라. …쬐끔."),
      L("kang", "하나만 알려 주지. 2스트라이크 뒤엔 짧게 쥐어. 그거면 된다."),
      L("seo", rank === 1 ? "남은 건 두 경기. 지금 자리 지키면 결승이다." : "남은 건 두 경기. 아직 뒤집을 수 있어."),
    );
  } else if (ch === 6) {
    if (mood) lines.push(mood);
    lines.push(
      L("oh", rank === 1 ? "마지막 정규전. 이기면 결승 확정이다." : `마지막 정규전. 지금 ${rank}위… 무조건 이기고 다른 팀 결과를 봐야 한다.`),
      L("kang", "손목 다 나았다. 이번엔 같이 나간다. …같이 가자, 결승."),
      L("min", `상대는 ${opp.name}. ${rv.aceRole} ${rv.ace}. 데이터는 다 뽑아 왔어요.`),
    );
  } else {
    const st = standings(c);
    const second = st.find((r) => r.i === (c.finalOpp ?? 1));
    lines.push(
      L("narr", "챔피언 결정전 전날 밤. 구장 조명이 하나둘 꺼진다."),
      L("oh", "3년 꼴찌 팀이 여기까지 왔다. 내일은 구단주도 관중석에 온다."),
      L("min", `상대는 ${opp.name}${second ? ` (${second.w}승 ${second.l}패)` : ""}. ${rv.aceRole} ${rv.ace}${josa(rv.ace, "이", "가")} 선발로 나옵니다.`),
      L("seo", "주장으로서 말할게. …여기까지 와 줘서 고맙다."),
      L("kang", "중심 타선, 오늘은 네 거다. …치고 와라. 우리 팀 살리고."),
      L("naru", "선배!! 우승하면 제가 치킨 쏠게요!! 진짜로요!!"),
    );
  }
  // 인연 트레이너 한 줄 (덱이 있으면 주마다 돌아가며)
  if (buddy && isBond(buddy)) lines.push(L(buddy, BUDDY_LINE[(ch - 1) % BUDDY_LINE.length](charById(buddy).name)));
  if (o) lines.push(L("oh", `이번 주 지시다. ${ORDER_WHY[o.key]} ${orderText(o)} 해내면 스킬P ${ORDER_REWARD.sp} · 자금 ${ORDER_REWARD.money}.`));
  return { key: `story:ch${ch}`, title: ch === 7 ? "FINAL" : `${ch}주차`, sub: CH_TITLE[ch], place: ch === 7 ? "night" : ch === 3 ? "night" : "stadium", lines, order: o };
}

const BUDDY_LINE: ((n: string) => string)[] = [
  () => "도장 관장님이 그러더라. 이 팀, 우리가 좀 봐 주라고. …잘 부탁해.",
  () => "주먹이든 방망이든 똑같아. 이번 주도 연습장에서 기다릴게.",
  () => "네 팀 사람들, 다들 진지하더라. 나도 괜히 힘이 나.",
  () => "벌써 4주째네. 처음보다 스윙 소리가 달라졌어.",
  () => "끝까지 가자. 나도 끝까지 볼 거니까.",
  () => "마지막 주야. 쉬는 것도 훈련이란 거 잊지 마.",
  () => "관중석 맨 앞에 있을게. 소리 질러도 놀라지 마.",
];
const ORDER_WHY: Record<string, string> = {
  power: "타격전엔 맞불이다.",
  hit: "변화구에 버티려면 정확도다.",
  def: "균형 잡힌 팀은 수비 실책 하나로 무너진다.",
  run: "한 베이스 더 가는 쪽이 이긴다.",
  special: "마지막은 네 필살기다.",
};

/* ─────────────── 경기 전 전력분석 · 경기 뒤 감독 한마디 ─────────────── */

export function scouting(c: Career): SLine[] {
  const rv = RIVALS[oppOf(c)];
  if (!rv) return [];
  return [L("min", rv.scout[(c.week + (c.phase === "final" ? 1 : 0)) % rv.scout.length])];
}

/** 경기 평가 화면 감독 한마디 (applyGame 뒤 c 기준 · 등급 0 = S) */
export function postGame(c: Career, s: GameSummary): SLine[] {
  if (s.dnp) return [L("oh", "몸부터 고쳐라. 벤치에서 보는 것도 공부다.")];
  const g = s.grade ?? 2;
  const won = s.win;
  const out: SLine[] = [];
  if (g <= 0) out.push(L("oh", won ? "…오늘은 네 경기였다. 할 말이 없군." : "졌지만 너만큼은 완벽했다. 그게 더 분하군."));
  else if (g === 1) out.push(L("oh", won ? "좋았다. 이 감각 잊지 마라." : "잘 쳤다. 팀이 못 따라갔을 뿐이다."));
  else if (g === 2) out.push(L("oh", won ? "제 몫은 했다. 이긴 게 제일이다." : "나쁘지 않았다. 다음엔 한 방 더."));
  else if (g === 3) out.push(L("oh", won ? "팀이 이겨서 다행이다. 넌 아직 멀었다." : "오늘은 안 풀렸다. 훈련으로 갚아라."));
  else out.push(L("oh", won ? "이긴 날 반성하는 놈이 크는 거다. 알겠지?" : "…오늘 같은 날도 있다. 고개 들어라."));
  if (s.next === "final") out.push(L("seo", "1위다! 챔피언 결정전이다!! 다들 들었지!"));
  else if (s.next === "end" && c.phase === "end" && c.result !== "우승" && c.result !== "준우승") out.push(L("kang", "…결승엔 못 갔다. 그래도 너랑 뛴 시즌은 나쁘지 않았다."));
  else if (c.phase === "end" && c.result === "우승") out.push(L("naru", "우승이에요!!! 선배!!! 치킨!!!"));
  return out;
}

/* ─────────────── 엔딩 (시즌 결산 화면 처음 열 때) ─────────────── */

export function ending(c: Career): StoryScene {
  const r = c.result ?? "4위";
  const lines: SLine[] = [];
  if (r === "우승") {
    lines.push(
      L("narr", "픽셀 파이터즈 2군, 창단 첫 라이징스타 리그 우승."),
      L("oh", "구단주가 해체 얘기는 없던 걸로 하잔다. …아니, 다음 시즌 예산을 두 배로 주겠다더군."),
      L("kang", `…인정한다, ${c.name}. 넌 진짜다. 다음 시즌엔 1군에서 보자.`),
      L("naru", "치킨 열 마리 시켰어요!! 다들 오세요!!"),
    );
  } else if (r === "준우승") {
    lines.push(
      L("narr", "챔피언 결정전, 한 끗 차이로 졌다."),
      L("oh", "졌다. 그런데 구단주가 한 시즌만 더 보겠단다. 3년 꼴찌 팀이 결승에 간 건 네 덕이다."),
      L("seo", "내년엔 이 자리에서 이기자. 이번엔 진짜로."),
    );
  } else if (r === "2위" || r === "3위") {
    lines.push(
      L("narr", `정규 시즌 ${r}. 챔피언 결정전에는 가지 못했다.`),
      L("oh", "결승은 놓쳤다. 하지만 꼴찌 팀이 여기까지 온 건 처음이다. 해체는… 보류란다."),
      L("kang", "다음 시즌엔 같이 결승 가자. 약속이다."),
    );
  } else {
    lines.push(
      L("narr", "정규 시즌 4위. 또 꼴찌였다."),
      L("oh", "팀은 또 꼴찌다. …그래도 너만큼은 1군 스카우트 눈에 띄었다더군."),
      L("naru", "선배… 저 계속 선배 응원할 거예요."),
    );
  }
  return { key: `story:end:${r}`, title: "ENDING", sub: r === "우승" ? "우리가 살린 팀" : r === "준우승" ? "한 끗" : "다음 시즌", place: "stadium", lines };
}

/** 지금 보여 줄 스토리 장면 (없으면 null) — 프롤로그 → 챕터 */
export function pendingStory(c: Career): StoryScene | null {
  const st = c.story;
  if (!st) return null;
  if (!st.pro) return prologue(c);
  const ch = chapterOf(c);
  if (ch >= 1 && ch <= 7 && st.ch < ch) return chapter(c);
  return null;
}
