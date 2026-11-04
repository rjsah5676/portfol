/*
 * 예/아니오 추리 (프로토) — 사건 데이터. 서버 전용: truth · facts · falseBeliefs · rubric · judgeNotes 는 절대 클라이언트로 안 보냄.
 * 사건을 고치면 version 을 올릴 것 (판정 캐시 키에 들어감 → 옛 판정이 남지 않음).
 */

export interface Fact {
  id: string;
  statement: string;
  /** 맞히면 YES → KEY_YES 로 올라감 */
  key?: boolean;
}

/** 흔한 오답 가설 (문장 자체가 틀린 가설). 이걸 정면으로 물으면 NO → KEY_NO */
export interface FalseBelief {
  id: string;
  statement: string;
}

export interface RubricItem {
  id: string;
  category: "culprit" | "method" | "motive" | "trick" | "process" | "reveal" | "other";
  /** 화면에 보이는 유형 이름 (내용은 안 드러나게) */
  label: string;
  /** 채점 기준 (서버 전용) */
  requirement: string;
}

export interface Clue {
  id: string;
  /** 차감되는 질문이 이 개수에 닿으면 공개 */
  unlockAt: number;
  body: string;
}

export interface MysteryCase {
  id: string;
  version: number;
  title: string;
  level: "쉬움" | "보통" | "어려움";
  prompt: string;
  questionLimit: number;
  submitLimit: number;
  truth: string;
  facts: Fact[];
  falseBeliefs: FalseBelief[];
  rubric: RubricItem[];
  clues: Clue[];
  judgeNotes: string;
}

export const CASES: MysteryCase[] = [
  {
    id: "boxes",
    version: 2,
    title: "세 개의 상자",
    level: "쉬움",
    prompt:
      "아파트 경비원은 택배 상자 하나를 들어 올리더니 곧바로 119에 전화를 걸었다. 상자 안에 위험한 물건은 없었다. 왜일까?",
    questionLimit: 30,
    submitLimit: 5,
    truth:
      "상자는 1203호에 혼자 사는 할머니 앞으로 온 생수 묶음이었다. 할머니는 몇 년째 매주 같은 생수를 주문했고, 택배가 오면 그날 바로 경비실에 들러 찾아가던 분이었다. " +
      "그날 온 상자를 선반에 올리려고 경비원이 기존 상자를 들어 올리자, 그 아래에 똑같은 생수 상자가 두 개 더 쌓여 있었다. 할머니가 3주째 택배를 찾아가지 않았다는 뜻이었다. " +
      "경비원은 할머니 집에 무슨 일이 생겼다고 판단해 119에 신고했고, 구급대원이 문을 열고 들어가 집 안에 쓰러져 있던 할머니를 구조했다. 할머니는 목숨을 건졌다.",
    facts: [
      { id: "f01", statement: "들어 올린 상자 밑에 같은 상자가 더 쌓여 있었다 (같은 사람 앞으로 온 같은 생수 상자, 모두 3개)", key: true },
      { id: "f02", statement: "상자를 받을 사람은 혼자 사는 할머니다", key: true },
      { id: "f03", statement: "할머니는 평소 택배가 오면 그날 바로 경비실에 와서 찾아갔다", key: true },
      { id: "f04", statement: "할머니는 몇 년째 매주 같은 생수를 주문했다" },
      { id: "f05", statement: "할머니가 3주째 택배를 찾아가지 않아 상자가 쌓였다", key: true },
      { id: "f06", statement: "경비원은 할머니 집 안에 무슨 일이 생겼다고 판단해 119에 신고했다" },
      { id: "f07", statement: "할머니는 집 안에 쓰러져 있었다 (몸이 아파 쓰러진 것, 범죄 아님)", key: true },
      { id: "f08", statement: "구급대원이 문을 열고 들어가 할머니를 구조했고, 할머니는 살았다" },
      { id: "f09", statement: "상자 안에는 생수만 들어 있었다. 상자의 무게·냄새·모양 같은 상자 자체의 이상은 신고 이유가 아니다" },
      { id: "f10", statement: "범죄·범인·악의를 가진 사람은 없다" },
      { id: "f11", statement: "등장인물은 경비원, 할머니, 구급대원뿐이다. 택배 기사는 평소처럼 배달했을 뿐 사건과 관계없다" },
      { id: "f12", statement: "할머니는 같은 아파트 1203호에 살고, 경비원과 서로 얼굴을 아는 사이다" },
      { id: "f13", statement: "경비원은 상자를 열어 보지 않았다" },
      { id: "f14", statement: "초자연적인 요소는 없다" },
    ],
    falseBeliefs: [
      { id: "b01", statement: "상자 안에 폭탄·마약·동물 등 위험하거나 수상한 물건이 있었다" },
      { id: "b02", statement: "상자가 이상하게 무겁거나 가볍거나, 냄새가 나거나, 물이 새서 신고했다" },
      { id: "b03", statement: "누군가 범죄를 저질렀다 (범인이 있다)" },
      { id: "b04", statement: "경비원 본인이 상자를 들다 다치거나 아파서 신고했다" },
    ],
    rubric: [
      { id: "r01", category: "trick", label: "결정적 단서", requirement: "같은 사람 앞으로 온 택배(상자)가 찾아가지 않은 채 여러 개 쌓여 있었음을 서술" },
      { id: "r02", category: "process", label: "평소와 달랐던 점", requirement: "받는 사람이 평소엔 택배를 바로(그날) 찾아가던 사람이었음을 서술" },
      { id: "r03", category: "culprit", label: "받는 사람", requirement: "받는 사람이 혼자 사는 노인(할머니·할아버지 등 독거노인)임을 서술" },
      { id: "r04", category: "reveal", label: "경비원의 판단", requirement: "경비원이 그 사람 집 안에 무슨 일(쓰러짐·위급 상황)이 생겼다고 판단해 신고했음을 서술" },
    ],
    clues: [
      { id: "c1", unlockAt: 10, body: "경비원이 들어 올린 상자 밑에는, 송장 날짜만 다른 똑같은 상자가 놓여 있었다." },
      { id: "c2", unlockAt: 20, body: "받는 사람은 늘 '물 왔어요?' 하며 택배가 온 그날 오후에 경비실 문을 두드리던 사람이었다." },
    ],
    judgeNotes:
      "'상자'는 경비원이 들어 올린 상자. '들어 올렸더니 뭔가 보였다/발견했다'는 YES(아래 쌓인 상자들). " +
      "'상자 때문에 신고했나', '상자가 신고 계기냐'처럼 상자를 든 일 자체를 묻는 건 YES (상자를 들다 밑에 쌓인 상자를 본 게 계기 — 다만 문제에 이미 나온 내용이라 beyondPrompt=false). " +
      "'상자 안 물건 때문에 신고했나', '상자 무게·냄새 때문이냐'는 NO. 신고한 이유는 받는 사람(할머니)의 안전. " +
      "'누가 죽었나'는 NO(할머니는 살았음). '누가 다쳤나/아팠나'는 YES(할머니가 쓰러짐). " +
      "경비원이 직접 문을 따고 구한 것은 아님(구급대원이 구함). 할머니의 병명·나이·가족 관계는 진상에 없음 → UNKNOWN.",
  },
  {
    id: "window",
    version: 1,
    title: "깨진 창문",
    level: "보통",
    prompt: "한겨울 밤, 도둑이 빈집에 들어갔다가 아무것도 훔치지 못하고 달아났다. 다음 날 아침, 그 집 주인은 도둑 덕분에 살았다.",
    questionLimit: 35,
    submitLimit: 5,
    truth:
      "집주인이 외출한 저녁, 도둑은 집 뒤쪽 작은방 창문을 깨고 들어갔다. 하지만 값나갈 만한 물건이 없어서 아무것도 가져가지 못하고 같은 창문으로 달아났다. " +
      "밤늦게 지쳐 돌아온 집주인은 잘 쓰지 않는 작은방에 들어가 보지 않아 창문이 깨진 줄 몰랐고, 집이 춥다며 보일러를 세게 틀고 잠들었다. " +
      "그날 밤 낡은 보일러에서 일산화탄소가 새어 나왔지만, 깨진 창문으로 밤새 바깥 공기가 들어와 집 안 농도가 치명적인 수준까지 오르지 않았다. " +
      "다음 날 아침 집주인은 심한 두통으로 깼고, 부른 119 구급대원이 일산화탄소 수치를 재 보고 보일러 누출을 찾아냈다. 창문이 깨져 있지 않았다면 집주인은 자다가 중독돼 숨졌을 것이다.",
    facts: [
      { id: "f01", statement: "도둑은 창문을 깨고 들어갔고, 그 창문은 깨진 채로 남았다", key: true },
      { id: "f02", statement: "깨진 창문으로 밤새 바깥 공기가 들어왔다 (환기가 됐다)", key: true },
      { id: "f03", statement: "보일러에서 일산화탄소가 새고 있었다", key: true },
      { id: "f04", statement: "집주인은 그날 밤 그 집에서 잤다", key: true },
      { id: "f05", statement: "집주인은 창문이 깨진 줄 모르고 잠들었다 (잘 쓰지 않는 작은방 창문이었다)", key: true },
      { id: "f06", statement: "집주인은 집이 춥다며 보일러를 세게 틀었다" },
      { id: "f07", statement: "도둑은 값나갈 물건이 없어 아무것도 가져가지 못했다" },
      { id: "f08", statement: "도둑과 집주인은 마주치지 않았고, 서로 모르는 사이다" },
      { id: "f09", statement: "도둑은 집주인을 구하려는 의도가 전혀 없었다. 순전히 우연이다" },
      { id: "f10", statement: "다음 날 아침 집주인은 심한 두통으로 깼다 (가벼운 중독 증상)" },
      { id: "f11", statement: "집주인이 부른 119 구급대원이 일산화탄소 누출을 확인했다" },
      { id: "f12", statement: "창문이 깨지지 않았다면 집주인은 자다가 숨졌을 것이다", key: true },
      { id: "f13", statement: "불·폭발·도시가스(LPG) 누출은 없었다. 샌 것은 보일러의 일산화탄소(배기가스)다" },
      { id: "f14", statement: "집주인은 혼자 산다. 반려동물 없음" },
      { id: "f15", statement: "초자연적인 요소는 없다" },
    ],
    falseBeliefs: [
      { id: "b01", statement: "도둑이 집주인을 직접 구하거나 깨우거나 신고했다" },
      { id: "b02", statement: "불이 났거나 도시가스가 새서 폭발할 뻔했다" },
      { id: "b03", statement: "도둑이 가스 밸브를 잠그거나 보일러를 끄는 등 무언가를 손봤다" },
      { id: "b04", statement: "집주인이 도둑을 마주치거나 잡았다" },
      { id: "b05", statement: "도둑과 집주인은 원래 아는 사이였다" },
    ],
    rubric: [
      { id: "r01", category: "method", label: "도둑이 남긴 것", requirement: "도둑이 창문을 깨고 드나들어 창문이 깨진 채 남았음을 서술" },
      { id: "r02", category: "trick", label: "집에 숨은 위험", requirement: "보일러에서 일산화탄소(배기가스, 유독가스)가 새고 있었음을 서술. '가스'만 쓰고 보일러·중독 맥락이 있으면 인정" },
      { id: "r03", category: "process", label: "그날 밤의 집주인", requirement: "집주인이 창문이 깨진 걸 모른 채 그 집에서 잠들었음을 서술" },
      { id: "r04", category: "reveal", label: "살아남은 이유", requirement: "깨진 창문으로 바깥 공기가 들어와(환기돼) 중독을 피했음을 서술" },
    ],
    clues: [
      { id: "c1", unlockAt: 10, body: "그날 밤 집주인은 \"오늘따라 집이 왜 이렇게 춥지\" 하며 보일러 온도를 끝까지 올리고 잤다." },
      { id: "c2", unlockAt: 22, body: "다음 날 아침 집주인을 깨운 건 깨질 듯한 두통이었다." },
    ],
    judgeNotes:
      "'도둑이 일부러 도왔나/구했나'는 NO (b01). '가스'를 물으면: 도시가스·LPG 누출·폭발은 NO, '보일러에서 뭔가 샜나', '유독가스', '일산화탄소'는 YES. " +
      "'창문'은 도둑이 깬 작은방 창문. '도둑이 뭔가 남겼나/바꿔 놓았나'는 YES(깨진 창문). '도둑이 잡혔나', 도둑의 정체, 집주인의 나이·성별은 진상에 없음 → UNKNOWN. " +
      "'추위·겨울이 중요한가'는 YES(보일러를 세게 튼 이유).",
  },
  {
    id: "watercooler",
    version: 1,
    title: "목요일의 물통",
    level: "어려움",
    prompt:
      "점심시간이 끝나고 보니 사무실 금고에서 현금이 사라져 있었다. 그 시간 CCTV에 수상한 사람은 찍히지 않았다. 경리 직원은 정수기를 보자마자 범인을 알아냈다.",
    questionLimit: 40,
    submitLimit: 5,
    truth:
      "범인은 매주 목요일마다 이 사무실에 생수 물통을 배달하던 정수기 배달원이었다. 그는 몇 달 동안 배달하러 올 때마다 경리 직원이 금고를 여는 모습을 어깨너머로 보며 비밀번호를 외워 두었다. " +
      "사건 당일은 화요일이었다. 배달원은 직원들이 모두 점심을 먹으러 나간 틈에 평소처럼 배달 조끼를 입고 새 물통을 들고 들어왔다. " +
      "CCTV에는 그가 찍혔지만 매주 오는 낯익은 배달원이라 아무도 수상하게 보지 않았다. 그는 금고를 비밀번호로 열어 현금을 꺼낸 뒤, 정수기에서 빼낸 거의 빈 물통 안에 지폐를 말아 넣고, 빈 물통을 회수하는 것처럼 들고 나갔다. " +
      "점심을 먹고 돌아온 경리 직원은 목요일에만 바뀌는 정수기 물통이 화요일인 오늘 새것으로 바뀌어 있는 것을 보고, 배달원이 다녀갔다는 것을 알아챘다.",
    facts: [
      { id: "f01", statement: "범인은 이 사무실에 정수기 생수 물통을 배달하던 배달원이다", key: true },
      { id: "f02", statement: "CCTV에 배달원이 찍혔지만, 늘 오던 사람이라 아무도 수상하게 여기지 않았다", key: true },
      { id: "f03", statement: "배달원은 훔친 현금을 빈 물통 안에 넣어, 빈 물통을 회수하는 척 들고 나갔다", key: true },
      { id: "f04", statement: "배달원은 평소 배달 때 경리 직원이 금고 여는 걸 어깨너머로 보고 비밀번호를 외워 두었다", key: true },
      { id: "f05", statement: "정수기 물통은 원래 매주 목요일에만 바뀐다 (배달 날은 목요일)", key: true },
      { id: "f06", statement: "사건 당일은 화요일이다 (배달 날이 아니다)" },
      { id: "f07", statement: "경리 직원은 배달 날이 아닌데 정수기 물통이 새것으로 바뀌어 있는 걸 보고 알아챘다", key: true },
      { id: "f08", statement: "배달원은 직원들이 모두 점심 먹으러 나가 사무실이 빈 틈을 노렸다" },
      { id: "f09", statement: "금고는 비밀번호로 열었다. 부수거나 망가뜨리지 않았고 열쇠도 쓰지 않았다" },
      { id: "f10", statement: "배달원은 평소처럼 배달 조끼(유니폼) 차림으로 새 물통을 들고 들어왔다" },
      { id: "f11", statement: "범인은 배달원 한 명뿐이다. 공범·내부자 없음. 경리 직원과 다른 직원들은 범인이 아니다" },
      { id: "f12", statement: "배달원은 실제 그 정수기 회사 배달원이다 (다른 사람이 변장한 것이 아니다)" },
      { id: "f13", statement: "사라진 것은 현금(지폐)이다. 정수기 본체에는 아무것도 숨기지 않았다" },
      { id: "f14", statement: "CCTV는 정상 작동했고 아무도 손대지 않았다" },
      { id: "f15", statement: "초자연적인 요소는 없다" },
    ],
    falseBeliefs: [
      { id: "b01", statement: "경리 직원이나 사무실 직원(내부자)이 범인이다" },
      { id: "b02", statement: "범인이 CCTV를 피했거나, 가렸거나, 고장 냈거나, 조작했다" },
      { id: "b03", statement: "범인이 금고를 부수거나 열쇠를 훔쳐서 열었다" },
      { id: "b04", statement: "범인은 배달원으로 변장한 다른 사람이다" },
      { id: "b05", statement: "돈을 정수기 본체 안에 숨겨 두었다" },
    ],
    rubric: [
      { id: "r01", category: "culprit", label: "범인", requirement: "범인이 정수기(생수) 물통 배달원임을 서술" },
      { id: "r02", category: "trick", label: "CCTV의 함정", requirement: "배달원이 CCTV에 찍혔지만 늘 오는 사람이라 의심받지 않았음을 서술" },
      { id: "r03", category: "method", label: "돈을 빼돌린 방법", requirement: "현금을 빈 물통에 넣어(회수하는 척) 들고 나갔음을 서술" },
      { id: "r04", category: "process", label: "금고를 연 방법", requirement: "평소 배달하러 와서 비밀번호를 어깨너머로 봐 두었음을 서술" },
      { id: "r05", category: "reveal", label: "들킨 이유", requirement: "배달 날(목요일)이 아닌 날 물통이 새것으로 바뀌어 있어서 들켰음을 서술" },
    ],
    clues: [
      { id: "c1", unlockAt: 12, body: "경리 직원은 매주 목요일 오전이면, 금고 앞 자기 자리에서 그 주 현금을 정리한다." },
      { id: "c2", unlockAt: 24, body: "정수기에 꽂힌 물통 목에는 오늘 날짜가 찍힌 새 봉인 스티커가 붙어 있었다." },
    ],
    judgeNotes:
      "'정수기'와 '물통'을 구분할 것: 정수기 본체에 돈을 숨겼다는 NO(b05), 물통에 넣어 나갔다는 YES. " +
      "'범인이 CCTV에 찍혔나'는 YES. '범인이 외부인인가'는 YES(배달원은 직원이 아님). '경리 직원이 아는 사람인가/본 적 있는 사람인가'는 YES(낯익은 배달원). " +
      "'오늘이 배달 날인가'는 NO. '물통이 바뀌어 있었나/새것이었나'는 YES. 범행 동기·액수·범인이 잡혔는지는 진상에 없음 → UNKNOWN.",
  },
];

export const caseById = (id: string) => CASES.find((c) => c.id === id) ?? null;
