/*
 * 유저봇의 별명 — 실제로 사람들이 쓰는 별명 틀(이름+숫자, 감성 단어, 직장인 자조, 대충 지은 아이디 …)을 섞어서 만듦.
 * 고정된 이름은 없고, 매번 새로 뽑음.
 */

const NAMES = [
  "지훈", "서연", "민수", "지은", "현우", "수빈", "준호", "예린", "도윤", "하은", "민재", "유진", "성민", "지원", "태현", "소희",
  "승우", "채원", "동현", "나연", "재민", "다은", "영호", "미경", "상철", "은주", "경수", "혜진", "진우", "유나", "건우", "서윤",
];
const NAME_TAIL = ["", "", "", "이", "이", "님", "짱", "아빠", "엄마", "오빠", "형", "누나", "쌤", "씨"];
const ROMAN = ["jh", "sy", "ms", "je", "hw", "sb", "jun", "min", "soo", "hyun", "kim", "lee", "park", "choi", "jang", "yoon", "kang", "dlwlrma", "wjdals", "tjdus", "ckdgus"];
const MOOD = [
  "바람", "노을", "구름", "달빛", "별하나", "여름밤", "소나기", "하늘색", "봄날", "밤하늘", "커피한잔", "새벽두시", "조용한밤", "오후세시",
  "겨울바다", "가을남자", "민들레", "라벤더", "흰구름", "파도소리", "무지개", "고요", "안개꽃", "비오는날", "햇살", "눈사람", "초승달", "들꽃",
];
const WORKER = [
  "퇴근하고싶다", "월급루팡", "야근중", "박대리", "김과장", "이부장", "최주임", "주말만기다려", "백수생활", "취준생", "공시생", "대학원생",
  "재택근무중", "점심뭐먹지", "출근싫어", "연차쓰고싶다", "회식싫어", "월요병", "불금", "칼퇴기원", "자영업자", "사장님", "알바중", "휴학생",
];
const LAZY = ["ㅇㅇ", "ㅎㅇ", "ㅋㅋ", "zzz", "qwer", "asdf", "ㄱㄴㄷ", "sss", "aaa", "ㅁㄴㅇㄹ", "ㅂㅂ", "ㅇㅈ", "ㄴㄴ", "qwe", "zxc", "ㅍㅍ"];
const LOCAL = [
  "부산갈매기", "대구사람", "인천토박이", "강남불패", "수원화성", "일산주민", "분당아재", "홍대앞", "광주형님", "대전촌놈", "울산큰애기",
  "제주도민", "강릉바다", "전주비빔", "춘천사람", "천안역", "구미공돌이", "창원사람", "목포항", "여수밤바다", "포항과메기", "안양사람",
];
const POKER = [
  "올인", "콜", "타짜", "초보에요", "포커초보", "하수", "고수", "한판만", "오늘만딴다", "본전만", "잃으면끝", "운빨", "포커페이스", "블러핑",
  "풀하우스", "로열", "하프", "따당", "삥", "에이스", "킹", "조커", "딜러", "갬블러", "복구하자", "오늘은간다", "한방", "다시시작",
];
const ENG = ["sky", "blue", "luna", "ryan", "max", "jay", "neo", "echo", "nova", "leo", "mia", "sol", "zero", "ace", "joy", "kai", "rio", "yuki", "ken", "tom", "sam", "bob", "amy", "jin"];
const FOOD = ["삼겹살에소주", "치킨먹고싶다", "떡볶이", "붕어빵", "라면한그릇", "김치찌개", "아메리카노", "마라탕", "곱창", "피자한판", "맥주한잔", "국밥한그릇", "순대국", "족발"];
const ADJ = ["행복한", "졸린", "배고픈", "조용한", "느긋한", "심심한", "외로운", "용감한", "소심한", "착한", "귀여운", "지친", "설레는", "우울한"];
const NOUN = ["하루", "오후", "토끼", "고양이", "강아지", "감자", "곰", "펭귄", "너구리", "두부", "참새", "다람쥐", "사람", "청년", "아재", "소녀"];

const pick = <T,>(arr: readonly T[], rand: () => number) => arr[Math.floor(rand() * arr.length)];
const pad = (n: number, w: number) => String(n).padStart(w, "0");
/** 사람들이 붙이는 숫자: 생년 2자리 · 생일 4자리 · 1004 · 777 같은 것 */
function digits(rand: () => number): string {
  const r = rand();
  if (r < 0.35) return String(85 + Math.floor(rand() * 21)); // 85~05
  if (r < 0.65) return pad(1 + Math.floor(rand() * 12), 2) + pad(1 + Math.floor(rand() * 28), 2);
  if (r < 0.8) return pick(["1004", "777", "486", "0101", "7", "2", "1", "99", "00", "123"], rand);
  return String(Math.floor(rand() * 1000));
}

export function nickname(rand: () => number = Math.random): string {
  const r = rand();
  let n: string;
  if (r < 0.16) {
    const name = pick(NAMES, rand);
    let tail = pick(NAME_TAIL, rand);
    // "지훈이"는 되지만 "민수이"는 어색함: 받침이 없으면 "이"를 안 붙임
    const last = name.charCodeAt(name.length - 1);
    if (tail === "이" && (last - 0xac00) % 28 === 0) tail = "";
    n = name + tail;
  }
  else if (r < 0.3) n = pick(ROMAN, rand) + digits(rand);
  else if (r < 0.42) n = pick(MOOD, rand) + (rand() < 0.3 ? digits(rand) : "");
  else if (r < 0.54) n = pick(WORKER, rand);
  else if (r < 0.6) n = pick(LAZY, rand) + (rand() < 0.5 ? digits(rand) : "");
  else if (r < 0.7) n = pick(LOCAL, rand);
  else if (r < 0.8) n = pick(POKER, rand) + (rand() < 0.4 ? digits(rand) : "");
  else if (r < 0.88) n = pick(ENG, rand) + (rand() < 0.7 ? digits(rand) : pick(ENG, rand));
  else if (r < 0.94) n = pick(FOOD, rand);
  else n = pick(ADJ, rand) + pick(NOUN, rand);
  return n.slice(0, 12);
}

/** 테이블 안에서 겹치지 않는 별명 */
export function uniqueNickname(taken: Iterable<string>, rand: () => number = Math.random): string {
  const set = new Set(taken);
  for (let i = 0; i < 20; i++) {
    const n = nickname(rand);
    if (!set.has(n)) return n;
  }
  return nickname(rand) + digits(rand);
}
