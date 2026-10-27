/*
 * 올인 러브 — 마음 읽기 (그 사람을 알아본 순간)
 * 호감(하트)은 설렘, 마음은 이해. 그 히로인만의 정답을 고르면 플래그(mA01~ · mY01~)가 켜지고,
 * mindA · mindY 는 켜진 플래그 수로 엔진이 계산함 (대본은 플래그만 켬 — 두 번 세지지 않음)
 * 화면: 숫자 없음. 그 자리 반응 + 연필 소리, 다음 날 아침 "알게 된 것" 한 줄, 관계 화면 「그녀에 대해 아는 것」,
 * 결정적 순간에 열리는 ✎ 선택지, 엔딩 직전 「네가 알아준 것들」
 */
import type { Vars } from "./types";

/** both = 그랜드(셋이서) 루트: 두 사람을 동시에 읽어야 맞히는 순간 (mG01~ → mindG, 히로인 문턱과 따로 셈) */
export type MindWho = "amy" | "yeonseo" | "sera" | "both";
export interface MindMoment {
  id: string;
  who: MindWho;
  /** 몇 주차 (모를 때 빈칸 힌트) */
  week: number;
  /** 관계 화면 · 다음 날 아침에 보이는 문장 (그녀에 대해 알게 된 것) */
  note: string;
  /** 엔딩 직전 「네가 알아준 것들」 한 줄 (폴라로이드 캡션처럼 짧게) */
  cap: string;
}

export const MIND: MindMoment[] = [
  { id: "mA01", who: "amy", week: 1, note: "장난을 걸면, 진지하게 맞혀 주는 걸 좋아한다.", cap: "불닭은 3번." },
  { id: "mA02", who: "amy", week: 1, note: "목소리가 커지면 허세. 아빠 얘기 앞에서 제일 시끄럽다.", cap: "아빠, 같이 찾아보자." },
  { id: "mA03", who: "amy", week: 2, note: "돈을 빌려주면 싫어한다. 같이 버는 길은 좋아한다.", cap: "야간 알바 구함." },
  { id: "mA04", who: "amy", week: 2, note: "울 때 '괜찮아'는 싫어한다. 옆에 있어 주면 된다.", cap: "차양 아래, 나란히." },
  { id: "mA05", who: "amy", week: 2, note: "대신 해 주면 화낸다. 혼자 해내는 걸 봐 주길 바란다.", cap: "혼자 뽑은 곰." },
  { id: "mA13", who: "amy", week: 2, note: "삼각김밥은 참치마요. 그거 하나면 기분이 풀린다.", cap: "참치마요 두 개." },
  { id: "mA14", who: "amy", week: 2, note: "사탕은 딸기 맛. 받으면 꼭 갚겠다고 한다.", cap: "딸기 사탕 한 봉지." },
  { id: "mA06", who: "amy", week: 3, note: "돈을 대신 내주면 싫어한다. 같이 있을 곳이면 된다.", cap: "걸어서 십 분." },
  { id: "mA07", who: "amy", week: 3, note: "'괜찮아'를 두 번 하면, 안 괜찮은 거다.", cap: "차용증 위의 손." },
  { id: "mA08", who: "amy", week: 4, note: "숫자는 적어 두면 덜 무섭다. 같이 세면 더.", cap: "스물여섯 주." },
  { id: "mA09", who: "amy", week: 4, note: "바나나우유보다 딸기우유를 더 좋아한다.", cap: "딸기우유 두 개." },
  { id: "mA10", who: "amy", week: 4, note: "숨을 때도 주소는 흘린다. 찾으러 와 주길 바란다.", cap: "두 번 말하면, 안 괜찮은 거." },
  { id: "mA11", who: "amy", week: 4, note: "리스트 4번은 비워 둔다. 같이 채울 사람 몫으로.", cap: "리스트 4번." },
  { id: "mA12", who: "amy", week: 4, note: "어깨를 두 번 두드리면, 이제 일어나라는 뜻이다.", cap: "어깨 두 번." },
  { id: "mY01", who: "yeonseo", week: 1, note: "캐물으면 닫힌다. 대답 대신 손이 말하는 걸 좋아한다.", cap: "대답 대신 돌린 카드." },
  { id: "mY02", who: "yeonseo", week: 1, note: "부탁은 작게 한다. 들어주면 오래 기억한다.", cap: "셋을 셌다." },
  { id: "mY03", who: "yeonseo", week: 1, note: "괜찮냐고 물으면 괜찮다고 한다. 따뜻한 걸 건네면 된다.", cap: "따뜻한 물." },
  { id: "mY04", who: "yeonseo", week: 1, note: "묻지 않고 옆에 있어 주는 게 편하다.", cap: "한 칸 아래 계단." },
  { id: "mY05", who: "yeonseo", week: 2, note: "카드 섞는 소리를 들어야 잠든다.", cap: "소리 나게 섞은 카드." },
  { id: "mY06", who: "yeonseo", week: 2, note: "표정이 생길까 봐 술을 안 마신다. 물로 건배하면 된다.", cap: "물로 한 건배." },
  { id: "mY07", who: "yeonseo", week: 2, note: "약속보다 숫자를 믿는다. 같은 쪽으로 틀리면, 오차가 아니다.", cap: "같은 쪽으로 틀린 계산." },
  { id: "mY08", who: "yeonseo", week: 2, note: "거짓말 칸에 진짜를 숨긴다.", cap: "셋째, 하트 에이스." },
  { id: "mY14", who: "yeonseo", week: 2, note: "사탕은 박하. 이모 말고는 아무도 몰랐던 취향.", cap: "박하사탕 한 봉지." },
  { id: "mY09", who: "yeonseo", week: 3, note: "두 번 두드리면, 봐 달라는 신호다.", cap: "받지 마요, 두 번." },
  { id: "mY10", who: "yeonseo", week: 3, note: "얼굴은 거짓말을 한다. 손을 보면 된다.", cap: "장갑 낀 쪽." },
  { id: "mY11", who: "yeonseo", week: 3, note: "비 그친 다음 날 아침을 제일 좋아한다.", cap: "비 그친 다음 날 아침." },
  { id: "mY12", who: "yeonseo", week: 3, note: "말할 준비가 될 때까지, 기다려 주길 바란다.", cap: "수요일 두 시까지." },
  { id: "mY13", who: "yeonseo", week: 4, note: "목소리보다 카드 소리가 먼저 안심시킨다.", cap: "수화기 너머 셔플." },
  // 세라 규칙: 거짓말을 바로 앎 · 선물 · 돈 싫어함 · "기억나?"를 먼저 안 물음 · 두 번 두드리기는 진심일 때만
  { id: "mS01", who: "sera", week: 1, note: "약속을 받아 주면 웃는다. 다음엔 접으라는 말은, 아직 이르다.", cap: "내일 봬요." },
  { id: "mS02", who: "sera", week: 1, note: "거짓말은 바로 안다. 솔직하게 말하면 웃는다.", cap: "번호 카드, 봤어요." },
  { id: "mS03", who: "sera", week: 2, note: "작은 진짜를 좋아한다. 꾸민 대답은 손을 보고 안다.", cap: "자고, 셔플하고, 출근." },
  { id: "mS04", who: "sera", week: 2, note: "이유를 캐면 웃음으로 닫는다. 기다려 주면 조금 연다.", cap: "말해 줄 때까지." },
  { id: "mS05", who: "sera", week: 2, note: "선물은 갚아야 해서 싫어한다. 같이 하는 건 좋아한다.", cap: "빈손, 설거지." },
  { id: "mS06", who: "sera", week: 2, note: "'기억나?'는 절대 먼저 안 묻는다. 그녀가 꺼낼 때까지 기다린다.", cap: "다리 하나 더." },
  { id: "mS07", who: "sera", week: 2, note: "감싸 주는 거짓말보다, 아픈 진짜를 고른다.", cap: "좀 무섭대요." },
  { id: "mS08", who: "sera", week: 2, note: "돈은 싫어한다. 다 잃은 밤엔 옆에 있어 주면 된다.", cap: "마감은 딜러가." },
  { id: "mS09", who: "sera", week: 3, note: "이기는 법은 이미 안다. 혼자 해내는 걸 옆에서 세어 주면 된다.", cap: "하나, 둘, 지금." },
  { id: "mS10", who: "sera", week: 3, note: "주는 건 좋아하지만, 3년을 통째로 넘기면 무너진다. '같이'가 정답.", cap: "곰 옆에 두고, 같이 펴요." },
  { id: "mS11", who: "sera", week: 3, note: "'접어요'는 허락이 아니라 끝이다. 아직 살아야 할 때는 '아직'.", cap: "아직요." },
  { id: "mG01", who: "both", week: 4, note: "말없이 따라와 주길 바라는 사람과, 스스로는 칩을 못 집는 사람.", cap: "가운데 남은 칩." },
  { id: "mG02", who: "both", week: 4, note: "미워할 시간이 필요한 사람과, 용서받을 생각이 없는 사람.", cap: "같이 앉는 것과 용서는 별개." },
  { id: "mG03", who: "both", week: 4, note: "한 사람은 공평한 걸, 한 사람은 온전한 걸 좋아한다.", cap: "부서지지 않은 두부." },
  { id: "mG04", who: "both", week: 4, note: "둘 다, 같이 먹는 저녁을 오래 못 가져 봤다.", cap: "셋이서 김치찌개." },
];

export const MIND_VAR: Record<MindWho, string> = { amy: "mindA", yeonseo: "mindY", sera: "mindS", both: "mindG" };
const IS_MIND = /^m[AYGS]\d\d$/;
export const isMindKey = (k: string) => IS_MIND.test(k);
export const mindOf = (v: Vars, who: MindWho) => v[MIND_VAR[who]] ?? 0;
export const mindTotal = (who: MindWho) => MIND.filter((m) => m.who === who).length;
/** 그 히로인에 대해 알게 된 순간들 (대본 순서) */
export const mindGot = (v: Vars, who: MindWho) => MIND.filter((m) => m.who === who && (v[m.id] ?? 0) >= 1);
/** 「네가 알아준 것들」 캡션: 히로인 엔딩은 그 사람 몫, 그랜드는 에이미 · 연서 · 두 사람 몫 전부 (이 순서로) */
export const recallCaps = (v: Vars, who: MindWho) =>
  (who === "both" ? (["amy", "yeonseo", "both"] as MindWho[]) : [who]).flatMap((w) => mindGot(v, w).map((m) => m.cap));

/**
 * 효과를 더한 뒤 호출: 새로 켜진 마음 플래그는 그날 날짜(_md_<id>)를 남기고, mindA · mindY 를 다시 셈
 * (통계용 _ 수치라 흐름 · 길잡이 비교에는 안 끼어듦)
 */
/**
 * 혼자 하는 '노트 정리'로 얻는 '노트 힌트' (정답은 아니고 방향만). 일정 카드가 mHint (· 대상 지정 mHintA · mHintY · mHintG) 를 주면
 * 아직 못 알아본 순간 중 '다음에 올 것'(지금 주차 이후 먼저) 하나에 h_<id> 가 켜지고, 그녀 노트 ??? 칸에 이 문장이 보임
 */
export const MIND_HINT: Record<string, string> = {
  mA01: "에이미는 장난을 걸어 올 때, 대충 받아 주면 시시해한다.",
  mA02: "에이미 목소리가 커질 때, 그 말을 그대로 믿진 말 것.",
  mA03: "에이미는 돈 얘기에 예민한 것 같다. 빌려주는 건 특히.",
  mA04: "에이미가 울 때 필요한 건 말이 아닐지도 모른다.",
  mA05: "에이미는 혼자 해내고 싶은 일에 손대는 걸 싫어한다.",
  mA13: "에이미가 제일 좋아하는 삼각김밥이 있다더라.",
  mA14: "에이미가 좋아하는 사탕 맛이 있다. 연서가 '금발 손님 취향'이라고 한 그 맛.",
  mA06: "에이미 앞에서 지갑을 먼저 여는 건, 생각보다 조심할 일이다.",
  mA07: "에이미가 같은 말을 두 번 하면, 한 번 더 들어 볼 것.",
  mA08: "에이미는 숫자를 무서워한다. 혼자 세게 두지 말 것.",
  mA09: "에이미가 늘 사는 우유랑, 진짜 좋아하는 우유는 다르다.",
  mA10: "에이미는 숨을 때도 어디 있는지 흘린다.",
  mA11: "에이미 리스트에는 비워 둔 칸이 있다. 무엇을 같이 했는지 떠올려 볼 것.",
  mA12: "에이미랑 둘만의 신호를 정해 두면, 마지막에 쓸모가 있다.",
  mY01: "연서는 캐묻는 사람한테 닫힌다. 대답 대신 할 수 있는 게 있다.",
  mY02: "연서의 부탁은 늘 작다. 작다고 넘기면 안 된다.",
  mY03: "연서가 떨 때는 말보다 따뜻한 게 먼저다.",
  mY04: "연서 옆에서는 묻지 않는 쪽이 편하다고 한다.",
  mY05: "연서가 잠들 때 필요한 소리가 있다.",
  mY06: "연서는 술을 안 마시는 이유가 있다. 억지로 권하지 말 것.",
  mY07: "연서한테 약속은 숫자보다 가볍다.",
  mY08: "연서는 거짓말 칸에 진짜를 숨기는 버릇이 있다.",
  mY09: "연서의 손끝을 볼 것. 말과 다른 걸 말할 때가 있다.",
  mY10: "연서를 읽을 때는 얼굴보다 손이다.",
  mY11: "연서가 제일 좋아하는 아침이 있다. 2주차 어느 밤에 말했다.",
  mY12: "연서가 '묻지 마요'라고 할 때, 서두르지 말 것.",
  mY13: "연서를 안심시키는 건 목소리보다 다른 소리다.",
  mY14: "연서가 좋아하는 사탕이 있다. 이모가 계산하다 말고 옆 가게에서 집어 주던 맛.",
  mG01: "둘이 엇갈릴 때, 한 사람은 따라와 주길, 한 사람은 누가 집어 주길 기다린다.",
  mG02: "에이미는 용서를 남이 정해 주는 걸 싫어하고, 연서는 용서받을 생각이 없다.",
  mG03: "두 사람이 '좋다'고 하는 기준이 다르다. 하나는 나누는 쪽, 하나는 지키는 쪽.",
  mG04: "둘 다 오래 못 가져 본 게 있다. 아주 평범한 것.",
};
const IS_HINT = /^mHint[AYG]?$/;
export const isHintKey = (k: string) => IS_HINT.test(k);
/** 힌트가 켜진(아직 못 알아본) 순간들 */
export const mindHinted = (v: Vars, who: MindWho) =>
  MIND.filter((m) => m.who === who && (v[`h_${m.id}`] ?? 0) >= 1 && !((v[m.id] ?? 0) >= 1));
/**
 * 힌트 받기: 받을 사람(A · Y · G, 없으면 지금 루트 → 호감이 높은 쪽) 의 아직 모르고 힌트도 없는 순간 중
 * 지금 주차 이후 것을 먼저, 없으면 앞 주차 것. 고른 순간에 h_<id> · 그날 날짜 _hd_<id>
 */
export function withHint(prev: Vars, next: Vars, keys: string[]): Vars {
  const week = Math.max(1, Math.ceil((next.dayNo ?? 1) / 7));
  for (const k of keys) {
    if (!IS_HINT.test(k)) continue;
    const n = Math.max(0, (next[k] ?? 0) - (prev[k] ?? 0));
    const who: MindWho =
      k === "mHintA"
        ? "amy"
        : k === "mHintY"
          ? "yeonseo"
          : k === "mHintG"
            ? "both"
            : (next.routeA ?? 0) >= 1
              ? "amy"
              : (next.routeY ?? 0) >= 1
                ? "yeonseo"
                : (next.affA ?? 0) > (next.affY ?? 0)
                  ? "amy"
                  : "yeonseo";
    for (let i = 0; i < n; i++) {
      const open = MIND.filter((m) => m.who === who && !((next[m.id] ?? 0) >= 1) && !((next[`h_${m.id}`] ?? 0) >= 1));
      const pick = open.find((m) => m.week >= week) ?? open[open.length - 1];
      if (!pick) break;
      next[`h_${pick.id}`] = 1;
      next[`_hd_${pick.id}`] = next.dayNo ?? 0;
    }
  }
  return next;
}
/** 엔진 · 길잡이 공용: 효과를 더한 뒤 마음 · 힌트 처리 */
export function mindFx(prev: Vars, next: Vars, keys: string[]): Vars {
  let r = next;
  if (keys.some(isMindKey)) r = withMind(prev, r);
  if (keys.some(isHintKey)) r = withHint(prev, r, keys);
  return r;
}

export function withMind(prev: Vars, next: Vars): Vars {
  let changed = false;
  for (const m of MIND)
    if ((next[m.id] ?? 0) >= 1 && !((prev[m.id] ?? 0) >= 1)) {
      next[`_md_${m.id}`] = next.dayNo ?? 0;
      changed = true;
    }
  if (!changed) return next;
  next.mindA = mindGot(next, "amy").length;
  next.mindY = mindGot(next, "yeonseo").length;
  next.mindG = mindGot(next, "both").length;
  return next;
}
