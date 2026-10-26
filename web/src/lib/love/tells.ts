/*
 * 올인 러브 — 읽기 노트 (버릇 기록)
 * 이야기에서 알게 된 상대 버릇. 알면 포커에서 해석이 같이 뜬다 ("텔 = 연애": 아는 만큼 읽힌다)
 * need = 이 수치가 켜지면 노트에 적힘. 플래그는 대본이 켬 (새 플래그: tAmyOk · tBoss · tTY · tJM)
 */
import { check } from "./engine";
import type { CharKey, Cond, Vars } from "./types";

export interface Tell {
  id: string;
  who: CharKey;
  /** 노트 제목 (짧게) */
  name: string;
  /** 뜻 — 포커 판에서 해석으로도 쓰임 */
  meaning: string;
  need: Cond;
  /** 아직 모를 때 보이는 힌트 */
  hint: string;
}

const on = (v: string): Cond => ({ v, op: ">=", n: 1 });

export const TELLS: Tell[] = [
  {
    id: "amyLoud",
    who: "amy",
    name: "시끄러우면 블러프, 조용하면 진짜",
    meaning: "떠들며 칩을 달그락대면 허세. 갑자기 조용해지고 트윈테일 끝을 감으면 좋은 패.",
    need: { any: [on("readA"), on("amyTell")] },
    hint: "에이미가 갑자기 조용해지는 순간을 볼 것",
  },
  {
    id: "amyNail",
    who: "amy",
    name: "손톱 밑 초록 보풀",
    meaning: "테이블에 앉은 날은 손톱 밑에 펠트 보풀이 낀다. 없으면 안 앉은 날.",
    need: on("mini_tellA1"),
    hint: "에이미가 '안 앉았다'고 할 때 손을 볼 것",
  },
  {
    id: "amyOk",
    who: "amy",
    name: "'괜찮아' 두 번",
    meaning: "괜찮다는 말을 두 번 연달아 하면 괜찮지 않다.",
    need: on("tAmyOk"),
    hint: "에이미가 괜찮다고 할 때 몇 번 말하는지 셀 것",
  },
  {
    id: "yeonTap",
    who: "yeonseo",
    name: "손끝으로 두 번 두드리기",
    meaning: "누가 봐 주길 바라는 수. 두 번 두드리면 블러프. 아무 버릇 없이 조용하면 진짜.",
    need: on("knowY"),
    hint: "연서가 말하기 직전, 손끝을 볼 것",
  },
  {
    id: "bossGlass",
    who: "boss",
    name: "손가락 세 개",
    meaning: "이길 걸 알 때만 손가락 세 개로 테이블(물잔)을 두드린다. 웃음은 아무 뜻 없음.",
    need: { any: [on("tBoss"), on("rigKnow")] },
    hint: "사장의 웃음 말고 왼손을 볼 것",
  },
  {
    id: "amyTap",
    who: "amy",
    name: "어깨 두 번",
    meaning: "에이미가 뒤에서 어깨를 두 번 두드리면: 이제 일어나. 이기고 있어도.",
    need: { v: "mindA", op: ">=", n: 8 },
    hint: "에이미를 끝까지 알아볼 것",
  },
  {
    id: "yeonDeal",
    who: "yeonseo",
    name: "딜러 연서의 손끝 한 번",
    meaning: "7년 동안 사장에게 보내던 손끝 신호. 오늘 처음으로 반대쪽에 보낸다 — 저 사람, 지금 비어 있어요.",
    need: { v: "mindY", op: ">=", n: 8 },
    hint: "연서를 끝까지 알아볼 것",
  },
  {
    id: "tyHum",
    who: "taeyang",
    name: "콧노래",
    meaning: "좋은 패면 콧노래가 나온다. 말이 많아지면 블러프.",
    need: on("tTY"),
    hint: "태양이랑 마감 후에 한 판 해 볼 것",
  },
  {
    id: "jmRecord",
    who: "jeongmin",
    name: "'기록상'이 빠진다",
    meaning: "평소엔 말끝마다 '기록상'. 블러프할 땐 그 말을 빼먹는다.",
    need: on("tJM"),
    hint: "정민이랑 마감 후에 한 판 해 볼 것",
  },
];

export const tellById = (id: string) => TELLS.find((t) => t.id === id);
export const tellKnown = (id: string, v: Vars) => {
  const t = tellById(id);
  return !!t && check(t.need, v);
};
/** 지금 아는 버릇 id 목록 (새로 알게 된 것 토스트용) */
export const knownTellIds = (v: Vars) => TELLS.filter((t) => check(t.need, v)).map((t) => t.id);
