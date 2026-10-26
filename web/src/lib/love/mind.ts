/*
 * 올인 러브 — 마음 읽기 (그 사람을 알아본 순간)
 * 호감(하트)은 설렘, 마음은 이해. 그 히로인만의 정답을 고르면 플래그(mA01~ · mY01~)가 켜지고,
 * mindA · mindY 는 켜진 플래그 수로 엔진이 계산함 (대본은 플래그만 켬 — 두 번 세지지 않음)
 * 화면: 숫자 없음. 그 자리 반응 + 연필 소리, 다음 날 아침 "알게 된 것" 한 줄, 관계 화면 「그녀에 대해 아는 것」,
 * 결정적 순간에 열리는 ✎ 선택지, 엔딩 직전 「네가 알아준 것들」
 */
import type { Vars } from "./types";

/** both = 그랜드(셋이서) 루트: 두 사람을 동시에 읽어야 맞히는 순간 (mG01~ → mindG, 히로인 문턱과 따로 셈) */
export type MindWho = "amy" | "yeonseo" | "both";
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
  { id: "mY09", who: "yeonseo", week: 3, note: "두 번 두드리면, 봐 달라는 신호다.", cap: "받지 마요, 두 번." },
  { id: "mY10", who: "yeonseo", week: 3, note: "얼굴은 거짓말을 한다. 손을 보면 된다.", cap: "장갑 낀 쪽." },
  { id: "mY11", who: "yeonseo", week: 3, note: "비 그친 다음 날 아침을 제일 좋아한다.", cap: "비 그친 다음 날 아침." },
  { id: "mY12", who: "yeonseo", week: 3, note: "말할 준비가 될 때까지, 기다려 주길 바란다.", cap: "수요일 두 시까지." },
  { id: "mY13", who: "yeonseo", week: 4, note: "목소리보다 카드 소리가 먼저 안심시킨다.", cap: "수화기 너머 셔플." },
  { id: "mG01", who: "both", week: 4, note: "말없이 따라와 주길 바라는 사람과, 스스로는 칩을 못 집는 사람.", cap: "가운데 남은 칩." },
  { id: "mG02", who: "both", week: 4, note: "미워할 시간이 필요한 사람과, 용서받을 생각이 없는 사람.", cap: "같이 앉는 것과 용서는 별개." },
  { id: "mG03", who: "both", week: 4, note: "한 사람은 공평한 걸, 한 사람은 온전한 걸 좋아한다.", cap: "부서지지 않은 두부." },
  { id: "mG04", who: "both", week: 4, note: "둘 다, 같이 먹는 저녁을 오래 못 가져 봤다.", cap: "셋이서 김치찌개." },
];

export const MIND_VAR: Record<MindWho, string> = { amy: "mindA", yeonseo: "mindY", both: "mindG" };
const IS_MIND = /^m[AYG]\d\d$/;
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
