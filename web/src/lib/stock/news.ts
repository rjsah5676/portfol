import type { Rng } from "./rng";

/*
 * 대전 속보 — 변동 3초 전에 종목 하나(가끔 둘)의 뉴스가 뜸. 모두에게 같은 시각에 같은 뉴스.
 * 다음 변동을 미리 뽑아 두고(battle.ts) 그걸 보고 만들지만, 일부러 틀리는 뉴스를 섞음 — 따라 샀다 물리는 맛.
 *   [속보]   그 종목에 대박 · 폭락이 걸렸을 때. 75% 맞음
 *   [단독]   대박 · 폭락이 없을 때 가장 크게 움직일 종목 (25% 넘게). 65% 맞음
 *   [찌라시] 아무 종목 · 아무 방향 (반반)
 * 뉴스 난수는 시세 난수와 따로라서, 뉴스를 넣어도 같은 시드의 시세는 예전과 같음.
 */

export type NewsTag = "속보" | "단독" | "찌라시";

export interface BNews {
  /** 몇 번째 변동에 대한 뉴스 (0부터) */
  k: number;
  stock: number;
  /** 호재 1 · 악재 -1 */
  dir: 1 | -1;
  tag: NewsTag;
  /** 제목 (종목 이름은 화면이 앞에 붙임) */
  text: string;
  /** 뜬 시각 (판 시작부터 ms) */
  at: number;
  /** 변동 뒤: 뉴스 방향대로 움직였는지 */
  hit?: boolean;
}

export const NEWS = {
  /** 변동 몇 ms 전에 뜨나 */
  leadMs: 3000,
  /** 변동 뒤에도 결과(적중 · 오보)를 이만큼 보여 줌 */
  afterMs: 3000,
  eventTrue: 0.75,
  bigP: 0.5,
  bigMin: Math.log(1.25),
  bigTrue: 0.65,
  rumorP: 0.25,
};

/** 종목 순서는 battle.ts 의 STOCKS 와 같음: 게임 · 연예 · IT · 서비스 · 국가 · 음식 · 테마 · 공업 · 연구 · 우주 */
const LINES: [good: string[], bad: string[]][] = [
  [
    ["신작 사전예약 500만 돌파", "글로벌 퍼블리싱 대형 계약", "분기 매출 역대 최대"],
    ["기대작 출시 무기한 연기", "서버 대란에 환불 요구 빗발", "확률 조작 의혹 제기"],
  ],
  [
    ["간판 그룹 월드투어 전석 매진", "드라마 시청률 30% 돌파", "해외 OTT 대형 계약"],
    ["간판 스타 열애설 터져", "소속 배우 전속계약 분쟁", "콘서트 줄줄이 취소"],
  ],
  [
    ["AI 신제품 공개 · 주문 폭주", "빅테크 인수설 솔솔", "어닝 서프라이즈"],
    ["대규모 개인정보 유출", "핵심 서비스 반나절 먹통", "수출 규제 직격탄"],
  ],
  [
    ["여행 · 배달 수요 폭발", "구독자 1천만 돌파", "정부 소비쿠폰 지급 결정"],
    ["수수료 갑질 논란 확산", "불매 운동 확산", "영업정지 처분"],
  ],
  [
    ["국가 신용등급 상향", "대규모 경기부양책 발표", "기준금리 인하 단행"],
    ["기준금리 깜짝 인상", "무역 분쟁 격화", "국가 부채 경고등"],
  ],
  [
    ["신제품 품절 대란", "해외 수출 역대 최대", "K-푸드 열풍"],
    ["제품서 이물질 검출", "원재료값 급등", "식중독 집단 발생"],
  ],
  [
    ["선거 테마 급부상", "초전도체 재현 성공설", "유명 투자자 매수 인증"],
    ["테마 거품 경고", "작전 세력 수사 착수", "대주주 지분 대량 매도"],
  ],
  [
    ["대규모 해외 수주", "공장 증설 발표", "배터리 장기 공급 계약"],
    ["공장 화재로 가동 중단", "노조 총파업 돌입", "원자재 공급 차질"],
  ],
  [
    ["신약 임상 3상 성공", "기술 수출 1조 계약", "노벨상 후보 거론"],
    ["임상 실패 공시", "논문 조작 의혹", "연구비 대폭 삭감"],
  ],
  [
    ["로켓 발사 성공", "위성 인터넷 대형 계약", "달 착륙선 착륙 성공"],
    ["발사체 공중 폭발", "발사 일정 또 연기", "위성 교신 두절"],
  ],
];

/** 같은 판에서 같은 제목이 되도록 안 겹치게 */
function pick(rng: Rng, stock: number, dir: 1 | -1, used: Set<string>): string {
  const list = LINES[stock % LINES.length][dir > 0 ? 0 : 1];
  const start = Math.floor(rng() * list.length);
  for (let i = 0; i < list.length; i++) {
    const t = list[(start + i) % list.length];
    if (!used.has(t)) return t;
  }
  return list[start];
}

/**
 * k 번째 변동의 뉴스. draws = 그 변동의 종목별 배수 · 대박(1)/폭락(-1)/보통(0).
 * used = 이 판에서 이미 쓴 제목 (여기서 추가함)
 */
export function makeNews(k: number, draws: { m: number; e: number }[], rng: Rng, at: number, used: Set<string>): BNews[] {
  const out: BNews[] = [];
  const add = (stock: number, dir: 1 | -1, tag: NewsTag) => {
    const text = pick(rng, stock, dir, used);
    used.add(text);
    out.push({ k, stock, dir, tag, text, at });
  };
  const events = draws.map((d, s) => ({ s, e: d.e })).filter((x) => x.e !== 0);
  for (const { s, e } of events.slice(0, 2)) add(s, (rng() < NEWS.eventTrue ? e : -e) as 1 | -1, "속보");
  if (!out.length && rng() < NEWS.bigP) {
    let best = 0;
    for (let s = 1; s < draws.length; s++) if (Math.abs(Math.log(draws[s].m)) > Math.abs(Math.log(draws[best].m))) best = s;
    const lm = Math.log(draws[best].m);
    if (Math.abs(lm) >= NEWS.bigMin) {
      const real: 1 | -1 = lm > 0 ? 1 : -1;
      add(best, rng() < NEWS.bigTrue ? real : (-real as 1 | -1), "단독");
    }
  }
  if (!out.length && rng() < NEWS.rumorP) add(Math.floor(rng() * draws.length), rng() < 0.5 ? 1 : -1, "찌라시");
  return out;
}
